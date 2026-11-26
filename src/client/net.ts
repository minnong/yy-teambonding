// Client socket layer: reconnect with backoff, hello replay, clock offset from server timestamps.
// No JSON pings: keep-alive is the runtime's raw ping/pong (uncounted); every JSON message costs budget.
import type { ClientMsg, PlayerWireAction, HostAction, ServerMsg } from '@shared/protocol';
import { ActBudget, localBudgetStore } from './actBudget';

export type ClientHello = Extract<ClientMsg, { t: 'hello' | 'addSelf' | 'hostHello' }>;
export type Intro = ClientHello | { t: 'peek' };
export type NetState = 'connecting' | 'open' | 'reconnecting' | 'closed';
export interface ClockSample { sent: number; server: number; received: number }
export interface CloseInfo { code: number; reason: string }

export const RECONNECT_DELAYS = [500, 1000, 2000, 5000];
/** 4000 replaced, 4001 bad pin, 4003 removed: reconnecting would be wrong (or ping-pong). 4002 reset reconnects at once. */
const NO_RECONNECT = new Set([4000, 4001, 4003]);
const RESET_CODE = 4002;
const MAX_SAMPLES = 5;
/** Must match the Room's WebSocketRequestResponsePair('ping', 'pong'). */
const PING = 'ping';
const PONG = 'pong';

/** Median of `server - (sent+received)/2`. */
export function clockOffset(samples: ClockSample[]): number {
  if (samples.length === 0) return 0;
  const v = samples.map((s) => s.server - (s.sent + s.received) / 2).sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

export interface VisibilitySource { readonly state: string; onVisible(fn: () => void): void }

export interface NetOptions {
  WebSocketCtor?: typeof WebSocket;
  url?: string;
  visibility?: VisibilitySource;
  /** R28 cap on every act frame. Defaults to one persisted in localStorage. */
  budget?: ActBudget;
}

type Events = { [K in ServerMsg['type']]: Extract<ServerMsg, { type: K }> } & { close: CloseInfo; state: NetState; pong: null; throttled: { type: string } };
type Handler<T> = (m: T) => void;

function defaultUrl(): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}
function defaultVisibility(): VisibilitySource {
  return {
    get state() { return document.visibilityState; },
    onVisible(fn) { document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') fn(); }); },
  };
}

export class Net {
  state: NetState = 'connecting';
  private ws: WebSocket | null = null;
  private intro: Intro | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private offset = 0;
  private samples: ClockSample[] = [];
  private introSentAt = 0;
  private handlers = new Map<string, Set<Handler<never>>>();
  private readonly Ctor: typeof WebSocket;
  private readonly url: string | undefined;
  private readonly vis: VisibilitySource | undefined;
  private visBound = false;
  /** R28: every `act` frame is charged here; over the cap it is refused locally and never sent. */
  readonly budget: ActBudget;

  constructor(opts: NetOptions = {}) {
    this.Ctor = opts.WebSocketCtor ?? WebSocket;
    this.url = opts.url;
    this.vis = opts.visibility;
    this.budget = opts.budget ?? new ActBudget(localBudgetStore());
  }

  /** Opens a fresh socket (dropping any current one) and sends `intro` on open. Reconnects replay it. */
  connect(intro: Intro): void {
    this.intro = intro;
    this.firstSend = true;
    this.attempt = 0;
    if (!this.visBound) {
      this.visBound = true;
      (this.vis ?? defaultVisibility()).onVisible(() => this.onVisible());
    }
    this.open('connecting');
  }

  /** Changes what reconnects replay (e.g. the plain hello once a join succeeded) without touching the socket. */
  remember(intro: Intro): void { this.intro = intro; }

  /** Tab became visible: if not open, reconnect now and reset the backoff. */
  onVisible(): void {
    if (this.state === 'closed' || this.state === 'open' || !this.intro) return;
    this.attempt = 0;
    this.open('reconnecting');
  }

  /**
   * Sends a raw client message if the socket is open. Returns false if it was dropped. This is the
   * only way out for acts, so the R28 cap here covers every caller (`act()` included): an act over
   * the cap emits 'throttled' and sends nothing. hello/addSelf/peek/host frames are not capped.
   */
  send(msg: ClientMsg): boolean {
    if (!this.ws || this.ws.readyState !== 1) return false;
    if (msg.t === 'act' && !this.budget.take(msg.a.type, Date.now())) {
      this.emit('throttled', { type: msg.a.type });
      return false;
    }
    if (msg.t === 'hello' || msg.t === 'addSelf') this.introSentAt = Date.now();
    this.ws.send(JSON.stringify(msg));
    return true;
  }
  act(a: PlayerWireAction): boolean { return this.send({ t: 'act', a }); }
  /**
   * Raw keep-alive probe. The Room answers `ping` with `pong` via setWebSocketAutoResponse, so it
   * is not counted in msgCount and does not wake the object. Emits 'pong' when the answer comes.
   */
  ping(): boolean {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(PING);
    return true;
  }
  host(a: HostAction): boolean { return this.send({ t: 'host', a }); }

  on<K extends keyof Events>(type: K, fn: Handler<Events[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => { set!.delete(fn as Handler<never>); };
  }

  serverNow(): number { return Date.now() + this.offset; }

  close(): void {
    this.clearTimer();
    this.detach();
    this.setState('closed');
  }

  // ---------- internals ----------

  private emit<K extends keyof Events>(type: K, m: Events[K]): void {
    for (const fn of [...(this.handlers.get(type) ?? [])]) (fn as Handler<Events[K]>)(m);
  }
  private setState(s: NetState): void {
    if (this.state === s) return;
    this.state = s;
    this.emit('state', s);
  }
  private clearTimer(): void { if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; } }
  private detach(): void {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try { ws.close(); } catch { /* already closed */ }
  }

  private open(state: NetState): void {
    this.clearTimer();
    this.detach();
    this.setState(state);
    const ws = new this.Ctor(this.url ?? defaultUrl());
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.setState('open');
      // Peek is not answered by a welcome; a later addSelf stamps its own send time in send().
      this.introSentAt = this.intro?.t === 'peek' ? 0 : Date.now();
      const intro = this.intro!;
      // A replayed takeover could kick a device that legitimately took over since: only the first send carries it.
      const out = intro.t === 'hello' && intro.takeover && !this.firstSend ? { ...intro, takeover: undefined } : intro;
      ws.send(JSON.stringify(out));
      this.firstSend = false;
    };
    ws.onmessage = (e) => this.onMessage(e.data as string);
    ws.onclose = (e) => this.onClose(e.code, e.reason);
    ws.onerror = () => { /* onclose follows */ };
  }
  private firstSend = true;

  private onMessage(raw: string): void {
    if (raw === PONG) { this.emit('pong', null); return; }
    let m: ServerMsg;
    try { m = JSON.parse(raw) as ServerMsg; } catch { return; }
    const now = Date.now();
    if (m.type === 'welcome') { if (this.introSentAt > 0) this.sample({ sent: this.introSentAt, server: m.serverNow, received: now }); this.introSentAt = 0; }
    else if (m.type === 'snapshot' && typeof m.snapshot?.serverNow === 'number') {
      this.sample({ sent: now, server: m.snapshot.serverNow, received: now });
    }
    this.emit(m.type, m as never);
  }
  private sample(s: ClockSample): void {
    this.samples.push(s);
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
    this.offset = clockOffset(this.samples);
  }

  private onClose(code: number, reason: string): void {
    this.ws = null;
    this.emit('close', { code, reason });
    if (NO_RECONNECT.has(code)) { this.setState('closed'); return; }
    if (code === RESET_CODE) { this.attempt = 0; this.open('reconnecting'); return; }
    this.setState('reconnecting');
    const delay = RECONNECT_DELAYS[Math.min(this.attempt, RECONNECT_DELAYS.length - 1)]!;
    this.attempt++;
    this.clearTimer();
    this.timer = setTimeout(() => { this.timer = null; this.open('reconnecting'); }, delay);
  }
}

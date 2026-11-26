// 35-bot load test: joins bots through addSelf, walks them around at a human rate, plays the
// activities, and measures the server's msgCount against the free-plan budget.
//
//   npm run bots -- --url http://localhost:5173 --bots 35 --minutes 5 --pin 1234 --reset --start
//
// --reset  host.reset before (bots need warm-up to addSelf) and after (removes the bots)
// --start  host.startCompetition once every bot has joined, and one quiz half-way through
// --allow-remote  required for any URL that is not localhost/127.0.0.1. A remote room in the
//          competition is never reset, with or without this flag.
//
// Rate per bot: one `move` every 3–6 s, plus occasional icebreakers, emotes, riddle attempts (a
// wrong answer, then skip) and random quiz answers. Departed teams and a paused room go quiet,
// because the server ignores their moves and real phones would be back in a pocket.
import { MESSAGE_BUDGET, PROXIMITY } from '../src/shared/constants';
import { nearTable, randomOpenSpot, spawnFor } from '../src/shared/layout';
import { positionAt } from '../src/shared/motion';
import type { ClientMsg, PlayerWireAction, PublicSnapshot, ServerMsg } from '../src/shared/protocol';
import type { AvatarLook, Motion, PlayerId, TeamId } from '../src/shared/types';
import { AVATAR_OPTIONS } from '../src/shared/constants';

type HostState = Extract<ServerMsg, { type: 'hostState' }>;

// ---------- args ----------

function parseArgs(argv: string[]) {
  const o = { url: 'http://localhost:5173', bots: 35, minutes: 5, pin: process.env.HOST_PIN ?? '1234', reset: false, start: false, allowRemote: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const val = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v; };
    if (a === '--url') o.url = val();
    else if (a === '--bots') o.bots = Number(val());
    else if (a === '--minutes') o.minutes = Number(val());
    else if (a === '--pin') o.pin = val();
    else if (a === '--reset') o.reset = true;
    else if (a === '--start') o.start = true;
    else if (a === '--allow-remote') o.allowRemote = true;
    else throw new Error(`unknown flag ${a}`);
  }
  if (!Number.isInteger(o.bots) || o.bots < 1 || o.bots > 99) throw new Error('--bots must be 1..99');
  if (!(o.minutes > 0)) throw new Error('--minutes must be > 0');
  return o;
}

const args = parseArgs(process.argv.slice(2));
const WS_URL = `${args.url.replace(/^http/, 'ws').replace(/\/$/, '')}/ws`;
const HOSTNAME = new URL(args.url).hostname;
const IS_LOCAL = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(HOSTNAME);
if (!IS_LOCAL && !args.allowRemote) {
  console.error(`Refusing to run bots against ${HOSTNAME}: pass --allow-remote for a non-local room.`);
  process.exit(1);
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...m: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...m);

// ---------- host socket ----------

let hostSent = 0;

/** A host socket; `act` resolves with the following hostState and rejects on an error reply. */
async function openHost(): Promise<{ state: () => HostState; act: (a: Extract<ClientMsg, { t: 'host' }>['a']) => Promise<HostState>; close: () => void }> {
  const ws = new WebSocket(WS_URL);
  let last: HostState | null = null;
  const waiters: { ok(h: HostState): void; fail(e: Error): void }[] = [];
  const next = () => new Promise<HostState>((ok, fail) => {
    const t = setTimeout(() => fail(new Error('no hostState within 15 s')), 15_000);
    waiters.push({ ok: (h) => { clearTimeout(t); ok(h); }, fail: (e) => { clearTimeout(t); fail(e); } });
  });
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(String(e.data)) as ServerMsg;
    if (m.type === 'hostState') { last = m; waiters.shift()?.ok(m); }
    else if (m.type === 'error') waiters.shift()?.fail(new Error(m.message));
  });
  ws.addEventListener('close', (e) => {
    if (e.code === 4001) { console.error('Wrong host PIN (closed 4001). Pass --pin.'); process.exit(1); }
  });
  await new Promise<void>((ok, fail) => {
    ws.addEventListener('open', () => ok());
    ws.addEventListener('error', () => fail(new Error(`cannot connect to ${WS_URL} (is the dev server running?)`)));
  });
  const first = next();
  ws.send(JSON.stringify({ t: 'hostHello', pin: args.pin }));
  hostSent++;
  await first;
  return {
    state: () => last!,
    act: (a) => { const r = next(); ws.send(JSON.stringify({ t: 'host', a })); hostSent++; return r; },
    close: () => ws.close(),
  };
}

/** A fresh hostHello: the hostState it returns carries the msgCount as of now. */
async function readMsgCount(): Promise<number> {
  const h = await openHost();
  const n = h.state().msgCount;
  h.close();
  return n;
}

// ---------- shared world model (one process, so bots can coordinate like people in a room) ----------

const world = {
  snap: null as PublicSnapshot | null,
  motions: new Map<PlayerId, Motion>(),
  offset: 0,
  quizSeen: new Set<number>(),
  riddleBusy: new Set<TeamId>(),
};
const now = () => Date.now() + world.offset;
const posOf = (id: PlayerId) => { const m = world.motions.get(id); return m ? positionAt(m, now()) : null; };
const teamPlaying = (team: TeamId) => world.snap?.teams[team]?.status === 'playing';

// ---------- bots ----------

let botSent = 0;
const sentByType = new Map<string, number>();
const bots: Bot[] = [];

function randomLook(): AvatarLook {
  const r = (n: number) => Math.floor(Math.random() * n);
  return {
    skin: r(AVATAR_OPTIONS.skin), hair: r(AVATAR_OPTIONS.hair), hairColor: r(AVATAR_OPTIONS.hairColor), top: r(AVATAR_OPTIONS.top),
    topColor: r(AVATAR_OPTIONS.topColor), bottomsColor: r(AVATAR_OPTIONS.bottomsColor), accessory: r(AVATAR_OPTIONS.accessory),
  };
}

class Bot {
  id: PlayerId | null = null;
  ws: WebSocket | null = null;
  readonly token = crypto.randomUUID();
  sent = 0;
  stopped = false;
  /** Busy until: an icebreaker partner or someone walking to their table stays put. */
  holdUntil = 0;
  card: { id: string; a: PlayerId; b: PlayerId; answeredBy: PlayerId | null } | null = null;
  seeking: PlayerId | null = null;
  riddle: { q: string | null; lockedUntil: number } | null = null;
  riddleStep: 'none' | 'walking' | 'answered' = 'none';
  private timer: ReturnType<typeof setTimeout> | null = null;
  joined!: Promise<void>;

  constructor(readonly n: number, readonly name: string, readonly team: TeamId, readonly listener: boolean) {}

  send(msg: ClientMsg): void {
    if (this.stopped || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
    this.sent++;
    botSent++;
    const kind = msg.t === 'act' ? msg.a.type : msg.t;
    sentByType.set(kind, (sentByType.get(kind) ?? 0) + 1);
  }
  act(a: PlayerWireAction): void { this.send({ t: 'act', a }); }

  connect(): Promise<void> {
    this.joined = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      this.ws = ws;
      let triedAlt = false;
      ws.addEventListener('open', () => {
        if (this.id) this.send({ t: 'hello', playerId: this.id, token: this.token });
        else this.send({ t: 'addSelf', name: this.name, teamId: this.team, token: this.token });
      });
      ws.addEventListener('message', (e) => {
        const m = JSON.parse(String(e.data)) as ServerMsg;
        if (m.type === 'welcome') {
          const first = this.id === null;
          this.id = m.you;
          if (first) { this.act({ type: 'setLook', look: randomLook() }); resolve(); }
          if (this.listener) { world.offset = m.serverNow - Date.now(); this.absorb(m.snapshot); }
        } else if (m.type === 'error') {
          // A leftover bot of the same name from an earlier run without --reset: take a fresh name once.
          if (!this.id && m.message === 'That name is already on the list' && !triedAlt) {
            triedAlt = true;
            this.send({ t: 'addSelf', name: `${this.name} ${Math.floor(rand(10, 99))}`, teamId: this.team, token: this.token });
          } else if (!this.id) reject(new Error(`${this.name}: ${m.message}`));
        } else this.onMsg(m);
      });
      ws.addEventListener('close', (e) => {
        if (this.stopped) return;
        if (!this.id) { reject(new Error(`${this.name}: closed ${e.code} before welcome`)); return; }
        if (e.code === 4000 || e.code === 4002 || e.code === 4003) { this.stop(); return; }
        setTimeout(() => { if (!this.stopped) void this.connect().catch(() => undefined); }, 1000);
      });
    });
    return this.joined;
  }

  private absorb(s: PublicSnapshot): void {
    world.snap = s;
    world.motions = new Map(Object.entries(s.motions));
  }

  private onMsg(m: ServerMsg): void {
    if (this.listener) {
      if (m.type === 'snapshot') this.absorb(m.snapshot);
      else if (m.type === 'motion') world.motions.set(m.playerId, m.motion);
    }
    if (m.type === 'icebreaker') this.onCard(m);
    else if (m.type === 'riddle') this.riddle = { q: m.q, lockedUntil: m.lockedUntil };
    else if (m.type === 'quiz') {
      if (!teamPlaying(this.team)) return;
      // People answer most quizzes, a few miss them.
      if (Math.random() < 0.85) this.later(rand(2000, 12000), () => this.act({ type: 'quizAnswer', choice: Math.floor(Math.random() * m.choices.length) }));
    }
  }

  private onCard(m: Extract<ServerMsg, { type: 'icebreaker' }>): void {
    const c = m.card;
    this.card = c ? { id: c.id, a: c.a, b: c.b, answeredBy: c.answeredBy } : null;
    if (!c) { this.holdUntil = 0; return; }
    this.holdUntil = now() + 30_000;
    this.seeking = null;
    // The person who was asked answers out loud and taps "We answered it!"; the other one confirms.
    if (c.answeredBy === null && c.b === this.id) this.later(rand(4000, 9000), () => { if (this.card?.id === c.id && !this.card.answeredBy) this.act({ type: 'icebreakerAnswered', id: c.id }); });
    else if (c.answeredBy !== null && c.answeredBy !== this.id) this.later(rand(1500, 4000), () => { if (this.card?.id === c.id) this.act({ type: 'icebreakerConfirm', id: c.id }); });
  }

  private later(ms: number, fn: () => void): void { setTimeout(() => { if (!this.stopped) fn(); }, ms); }

  start(): void { this.schedule(); }
  private schedule(): void { this.timer = setTimeout(() => { this.tick(); if (!this.stopped) this.schedule(); }, rand(3000, 6000)); }

  /** One decision every 3–6 s: normally a single `move`, sometimes an activity instead. */
  private tick(): void {
    const s = world.snap;
    if (!s || !this.id || s.paused || !teamPlaying(this.team)) return;
    const me = posOf(this.id);
    if (this.card || now() < this.holdUntil) return; // standing still with a partner

    // Riddle: walk to the table, try a wrong answer, then skip (locks the riddle for 30 s).
    if (this.riddleStep === 'walking' && me) {
      if (nearTable(me, s.teamOrder.indexOf(this.team))) { this.act({ type: 'riddleAnswer', text: 'is it a teapot' }); this.riddleStep = 'answered'; return; }
    } else if (this.riddleStep === 'answered') {
      this.act({ type: 'riddleSkip' });
      this.riddleStep = 'none';
      setTimeout(() => world.riddleBusy.delete(this.team), 30_000);
      return;
    } else if (s.phase === 'competition' && this.riddle?.q && now() >= this.riddle.lockedUntil && !world.riddleBusy.has(this.team) && Math.random() < 0.04) {
      world.riddleBusy.add(this.team);
      this.riddleStep = 'walking';
      this.act({ type: 'move', to: spawnFor(s.teamOrder.indexOf(this.team), Math.floor(rand(0, 6))) });
      return;
    }
    if (this.riddleStep === 'walking') return; // still on the way

    // Icebreaker: walk up to someone from another team, then start one when close.
    if (this.seeking && me) {
      const other = bots.find((b) => b.id === this.seeking);
      const there = posOf(this.seeking);
      if (other && there && !other.card && Math.hypot(there.x - me.x, there.y - me.y) <= PROXIMITY - 8) {
        this.act({ type: 'icebreakerStart', target: this.seeking });
        this.seeking = null;
        return;
      }
      if (other && there && !other.card) { this.act({ type: 'move', to: { x: Math.round(there.x + 24), y: Math.round(there.y) } }); return; }
      this.seeking = null;
    } else if (Math.random() < 0.08) {
      const partner = pick(bots.filter((b) => b !== this && b.id && b.team !== this.team && !b.card && !b.seeking && teamPlaying(b.team) && now() >= b.holdUntil));
      const there = partner?.id ? posOf(partner.id) : null;
      if (partner?.id && there) {
        this.seeking = partner.id;
        partner.holdUntil = now() + 15_000; // they notice and wait
        this.act({ type: 'move', to: { x: Math.round(there.x + 24), y: Math.round(there.y) } });
        return;
      }
    }

    if (Math.random() < 0.04) { this.act({ type: 'emote', kind: pick(['wave', 'highfive', 'laugh', 'heart'] as const) }); return; }
    this.act({ type: 'move', to: randomOpenSpot(Math.random) });
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
  close(): void { this.stop(); try { this.ws?.close(); } catch { /* gone */ } }
}

// ---------- run ----------

async function main(): Promise<void> {
  log(`bots: ${args.bots}, minutes: ${args.minutes}, url: ${args.url}, reset: ${args.reset}, start: ${args.start}`);
  const host = await openHost();
  if (host.state().snapshot.phase !== 'warmup') {
    if (!IS_LOCAL) {
      // A live event: never reset it, and do not suggest how to.
      console.error(args.reset
        ? `Refusing to reset ${HOSTNAME}: that room is in the competition.`
        : `The room at ${HOSTNAME} is in the competition: bots can only join during warm-up.`);
      host.close();
      process.exit(1);
    }
    if (!args.reset) {
      console.error('The room is already in the competition: bots join with addSelf, which only works in warm-up. Re-run with --reset.');
      host.close();
      process.exit(1);
    }
  }
  // From here on, an interrupt or a crash still closes the bots and (with --reset) removes them.
  let cleaned = false;
  cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    for (const b of bots) b.close();
    if (args.reset) {
      await host.act({ type: 'host.reset' }).then(() => log('room reset (bots removed)'), (e: Error) => log(`final reset failed: ${e.message}`));
    }
    host.close();
  };
  if (args.reset) { await host.act({ type: 'host.reset' }); log('room reset'); }
  const startCount = host.state().msgCount;
  const hostSentAtStart = hostSent;
  const t0 = Date.now();

  const teams = host.state().snapshot.teamOrder;
  for (let i = 0; i < args.bots; i++) {
    const n = String(i + 1).padStart(2, '0');
    bots.push(new Bot(i, `Bot ${n}`, teams[i % teams.length]!, i === 0));
  }
  // Staggered arrivals, like people scanning the QR code.
  const joins: Promise<void>[] = [];
  for (const b of bots) { joins.push(b.connect()); await sleep(rand(80, 220)); }
  await Promise.all(joins);
  log(`all ${bots.length} bots joined (${Date.now() - t0} ms)`);
  await sleep(1500);

  if (args.start) {
    const h = await host.act({ type: 'host.startCompetition' });
    log(`competition started, ${h.snapshot.departures[0]} went first`);
  }
  for (const b of bots) b.start();

  const runMs = args.minutes * 60_000;
  const quizAt = runMs / 2;
  let quizDone = !args.start;
  const end = Date.now() + runMs;
  while (Date.now() < end) {
    await sleep(Math.min(10_000, end - Date.now()));
    const elapsed = runMs - (end - Date.now());
    if (!quizDone && elapsed >= quizAt) {
      quizDone = true;
      await host.act({ type: 'host.quizStart' }).then(() => log('quiz started')).catch((e: Error) => log(`quiz: ${e.message}`));
    }
    log(`elapsed ${Math.round(elapsed / 1000)} s, sent by bots so far: ${botSent}`);
  }

  for (const b of bots) b.stop();
  await sleep(500);
  const endCount = await readMsgCount();
  const delta = endCount - startCount;
  const hostInWindow = hostSent - hostSentAtStart;
  const projected = Math.round((delta * 35) / args.minutes);
  // The server delta = 35 bots + this script's host frames. A real session has 36 players and ~1 host.
  const hostShare = Math.min(delta, hostInWindow);
  const per36 = Math.round((((delta - hostShare) * 36) / args.bots + hostShare) * 35 / args.minutes);

  console.log('');
  console.log(`sent by bots: ${botSent}`);
  console.log(`bot messages by type: ${[...sentByType].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`sent by host script in the window: ${hostInWindow}`);
  console.log(`server msgCount delta: ${delta}`);
  console.log(`projected 35-min messages: ${projected}`);
  console.log(`projected 35-min messages for 36 players + 1 host: ${per36} (budget ${MESSAGE_BUDGET.toLocaleString('en-US')}: ${per36 < MESSAGE_BUDGET ? 'OK' : 'OVER'})`);
  console.log(`server msgCount today: ${endCount}`);

  await cleanup();
  await sleep(200);
  process.exit(per36 < MESSAGE_BUDGET ? 0 : 2);
}

let cleanup: (() => Promise<void>) | null = null;
const bail = (code: number) => { void (cleanup?.() ?? Promise.resolve()).finally(() => process.exit(code)); };
process.on('SIGINT', () => { log('interrupted: cleaning up'); bail(130); });
process.on('SIGTERM', () => bail(143));

main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); bail(1); });

// The single Room Durable Object: WebSockets (hibernatable), persistence, the tick alarm, host auth
// and message fan-out around the pure reducer in src/shared/game.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './worker';
import type { GameState, PlayerId, TeamId } from '../shared/types';
import type { Action, ServerMsg } from '../shared/protocol';
import { TICK_MS } from '../shared/constants';
import { loadContent } from '../shared/content';
import {
  apply, catchUp, createState, isPlayingTeam, nextLeader, persistable, publicSnapshot, restore,
  riddleState, utcDay, type Ctx, type Outbound, type Persisted, type Result,
} from '../shared/game/index';
import { close, decode, encode, send, sendError } from './wire';
import { attachmentOf, isFor, isHostSock, isPlayerSock, listSockets, socketsOf } from './sockets';

/** Close codes sent to clients. */
export const CLOSE = {
  /** Another socket took over this player (a `kicked` message precedes it when the token differs). */
  replaced: 4000,
  badPin: 4001,
  /** host.reset: start the join flow again. */
  reset: 4002,
  /** The player no longer exists (host.removePlayer, or gone from a restored state). */
  removed: 4003,
} as const;

const MSG_COUNT_WRITE_MS = 10_000;
type MsgCount = GameState['msgCount'];

/**
 * msgCount is kept in two places: inside the `state` blob (written on every persist) and under
 * its own `msgCount` key (written at most every 10 s, and on every persist). On load the later
 * UTC day wins, and within the same day the larger count, which is the fresher of the two.
 */
function fresherCount(a: MsgCount, b: MsgCount | undefined): MsgCount {
  if (!b || typeof b.day !== 'string' || typeof b.count !== 'number') return a;
  if (a.day !== b.day) return a.day > b.day ? a : b;
  return a.count >= b.count ? a : b;
}

function pinMatches(given: string, expected: string | undefined): boolean {
  if (!expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export class Room extends DurableObject<Env> {
  private readonly content = loadContent();
  /** The live game. Rebuilt from storage whenever the object starts; public for tests. */
  game!: GameState;
  private msgCountWrittenAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep-alive pings are answered by the runtime: they never wake the object or count as messages.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    void ctx.blockConcurrencyWhile(() => this.load());
  }

  private ctxAt(now: number): Ctx { return { now, rng: Math.random, content: this.content }; }

  private async load(): Promise<void> {
    const now = Date.now();
    const saved = await this.ctx.storage.get<Persisted>('state');
    const counted = await this.ctx.storage.get<MsgCount>('msgCount');
    try {
      this.game = saved ? restore(saved, now) : createState(this.content, now);
    } catch (e) {
      // Never brick the room: keep the unreadable save for manual recovery and start fresh.
      console.error('room: could not restore saved state', e);
      await this.ctx.storage.put(`state-unreadable-${now}`, saved);
      this.game = createState(this.content, now);
    }
    this.game.msgCount = fresherCount(this.game.msgCount, counted);

    // Woken from hibernation (or restarted with sockets still attached): `online` came back
    // empty, so mark everyone who still holds a socket as connected again.
    let reconnected = false;
    for (const s of listSockets(this.ctx)) {
      if (!isPlayerSock(s)) continue;
      if (apply(this.game, { type: 'connect', playerId: s.att.playerId }, this.ctxAt(now)).error) {
        close(s.ws, CLOSE.removed, 'removed');
      } else reconnected = true;
    }
    if (reconnected) this.broadcastSnapshot(now);
    await this.ensureAlarm();
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket upgrade', { status: 426 });
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    try {
      await this.onMessage(ws, raw);
    } catch (e) {
      console.error('room: message failed', e);
      sendError(ws, 'server error');
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    close(ws, 1000, 'bye');
    await this.onGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.onGone(ws);
  }

  async alarm(): Promise<void> {
    try {
      const now = Date.now();
      await this.commit(apply(this.game, { type: 'tick' }, this.ctxAt(now)), null, now);
    } catch (e) {
      console.error('room: tick failed', e);
    }
    if (this.shouldTick()) await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
  }

  // ---------- incoming ----------

  private async onMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const now = Date.now();
    await this.countMessage(now);
    const msg = decode(raw);
    if (!msg) { sendError(ws, 'bad message'); return; }
    const att = attachmentOf(ws);
    switch (msg.t) {
      case 'peek': return; // Task 9
      case 'hello':
        if (att) { sendError(ws, 'already said hello'); return; }
        return this.hello(ws, msg.playerId, msg.token, msg.takeover === true, now);
      case 'addSelf': {
        if (att) { sendError(ws, 'already said hello'); return; }
        const r = apply(this.game, { type: 'addSelf', name: msg.name, teamId: msg.teamId }, this.ctxAt(now));
        // The hello below broadcasts the snapshot that includes the new player.
        await this.commit({ ...r, snapshot: false }, ws, now);
        if (r.addedPlayerId) await this.hello(ws, r.addedPlayerId, msg.token, false, now);
        return;
      }
      case 'hostHello':
        if (att) { sendError(ws, 'already said hello'); return; }
        if (!pinMatches(msg.pin, this.env.HOST_PIN)) { close(ws, CLOSE.badPin, 'bad pin'); return; }
        ws.serializeAttachment({ kind: 'host' });
        send(ws, this.hostState(now));
        return;
      case 'act':
        if (!att) { sendError(ws, 'say hello first'); return; }
        if (att.kind !== 'player') { sendError(ws, 'players only'); return; }
        return this.run({ ...msg.a, playerId: att.playerId } as Action, ws, now);
      case 'host':
        if (!att) { sendError(ws, 'say hello first'); return; }
        if (att.kind !== 'host') { sendError(ws, 'host only'); return; }
        return this.run(msg.a, ws, now);
    }
  }

  private async countMessage(now: number): Promise<void> {
    const day = utcDay(now);
    if (this.game.msgCount.day !== day) this.game.msgCount = { day, count: 0 };
    this.game.msgCount.count++;
    if (now - this.msgCountWrittenAt >= MSG_COUNT_WRITE_MS) {
      this.msgCountWrittenAt = now;
      await this.ctx.storage.put('msgCount', this.game.msgCount);
    }
  }

  /**
   * Binds `ws` to a player. A different token on another open socket wins unless `takeover`;
   * otherwise older sockets are closed (told `kicked` only if their token differs).
   */
  private async hello(ws: WebSocket, playerId: PlayerId, token: string, takeover: boolean, now: number): Promise<void> {
    const p = Object.hasOwn(this.game.players, playerId) ? this.game.players[playerId] : undefined;
    if (!p || p.removed) { sendError(ws, 'unknown player'); return; }
    const others = socketsOf(listSockets(this.ctx), playerId, ws);
    if (!takeover && others.some((s) => s.att.token !== token)) { send(ws, { type: 'nameTaken', playerId }); return; }

    ws.serializeAttachment({ kind: 'player', playerId, token });
    for (const s of others) {
      if (s.att.token !== token) send(s.ws, { type: 'kicked' });
      close(s.ws, CLOSE.replaced, 'replaced');
    }
    const ctx = this.ctxAt(now);
    const r = apply(this.game, { type: 'connect', playerId }, ctx);
    if (r.error) { ws.serializeAttachment(null); sendError(ws, r.error); return; }
    send(ws, { type: 'welcome', you: playerId, token, serverNow: now, snapshot: publicSnapshot(this.game, ctx) });
    for (const m of catchUp(this.game, playerId, ctx)) send(ws, m);
    await this.commit(r, ws, now, ws);
    await this.ensureAlarm();
  }

  /** Runs one validated player or host action and everything the Room does around it. */
  private async run(action: Action, ws: WebSocket, now: number): Promise<void> {
    const undone = action.type === 'host.undoCall' ? this.game.departures.at(-1) : undefined;
    const r = apply(this.game, action, this.ctxAt(now));
    if (!r.error) {
      // Close before fan-out so the closed sockets are skipped (their webSocketClose then
      // marks them offline). Host sockets stay open.
      if (action.type === 'host.reset') {
        for (const s of listSockets(this.ctx)) if (isPlayerSock(s)) close(s.ws, CLOSE.reset, 'reset');
      }
      if (action.type === 'host.removePlayer') {
        for (const s of socketsOf(listSockets(this.ctx), action.playerId)) close(s.ws, CLOSE.removed, 'removed');
      }
    }
    await this.commit(r, ws, now);
    if (r.error) return;
    // Teams that start (or resume) playing need their riddle text, which the snapshot never carries.
    const playing = (id: TeamId | undefined): id is TeamId => id !== undefined && isPlayingTeam(this.game, id);
    const teams = action.type === 'host.startCompetition' ? this.game.teamOrder.filter(playing)
      : playing(undone) ? [undone] : [];
    this.route(teams.map((team) => ({ to: { team }, msg: riddleState(this.game, team, this.ctxAt(now)) })));
    await this.ensureAlarm();
  }

  private async onGone(ws: WebSocket): Promise<void> {
    const att = attachmentOf(ws);
    if (att?.kind !== 'player' || !this.game.online[att.playerId]) return;
    if (socketsOf(listSockets(this.ctx), att.playerId, ws).length > 0) return;
    const now = Date.now();
    await this.commit(apply(this.game, { type: 'disconnect', playerId: att.playerId }, this.ctxAt(now)), null, now);
  }

  // ---------- outgoing ----------

  /**
   * Applies a reducer Result: the error goes to the sender only; otherwise route `out`, broadcast
   * the snapshot (skipping `except`) and persist.
   */
  private async commit(r: Result, sender: WebSocket | null, now: number, except: WebSocket | null = null): Promise<void> {
    if (r.error) { if (sender) sendError(sender, r.error); return; }
    this.route(r.out);
    if (r.snapshot) this.broadcastSnapshot(now, except);
    if (r.persist) await this.persist();
  }

  private route(out: Outbound[]): void {
    if (out.length === 0) return;
    const socks = listSockets(this.ctx);
    for (const o of out) {
      const frame = encode(o.msg);
      for (const s of socks) if (isFor(o.to, s, this.game)) send(s.ws, frame);
    }
  }

  /** `snapshot` to every player socket and `hostState` to every host socket. */
  private broadcastSnapshot(now: number, except: WebSocket | null = null): void {
    const snapshot = publicSnapshot(this.game, this.ctxAt(now));
    const forPlayers = encode({ type: 'snapshot', snapshot });
    const forHosts = encode(this.hostState(now, snapshot));
    for (const s of listSockets(this.ctx)) {
      if (s.ws === except) continue;
      if (isPlayerSock(s)) send(s.ws, forPlayers);
      else if (isHostSock(s)) send(s.ws, forHosts);
    }
  }

  private hostState(now: number, snapshot = publicSnapshot(this.game, this.ctxAt(now))): ServerMsg {
    const g = this.game;
    const connectedPerTeam: Record<TeamId, { online: number; total: number }> = {};
    for (const id of g.teamOrder) connectedPerTeam[id] = { online: 0, total: 0 };
    for (const p of Object.values(g.players)) {
      const c = connectedPerTeam[p.teamId];
      if (!c || p.removed) continue;
      c.total++;
      if (g.online[p.id]) c.online++;
    }
    const leader = nextLeader(g);
    const t = leader === null ? undefined : g.teams[leader];
    return {
      type: 'hostState', snapshot, connectedPerTeam, msgCount: g.msgCount.count,
      nextLeader: t ? { id: t.id, name: t.name, score: t.score } : null,
      lastCallAt: g.lastCallAt,
    };
  }

  // ---------- storage and alarm ----------

  private async persist(): Promise<void> {
    await this.ctx.storage.put({ state: persistable(this.game), msgCount: this.game.msgCount });
    this.msgCountWrittenAt = Date.now();
  }

  /**
   * Tick while there is something to tick for: the competition with a team still playing (or a
   * quiz running), and at least one socket attached. Alarms count against the daily request
   * limit, so a room left in competition overnight must not tick forever; the next hello re-arms.
   */
  private shouldTick(): boolean {
    const g = this.game;
    const live = g.quiz !== null || g.teamOrder.some((id) => isPlayingTeam(g, id));
    return g.phase === 'competition' && live && this.ctx.getWebSockets().length > 0;
  }

  private async ensureAlarm(): Promise<void> {
    if (!this.shouldTick()) return;
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
  }
}

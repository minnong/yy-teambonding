import { env } from 'cloudflare:workers';
import { SELF, evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServerMsg } from '@shared/protocol';
import type { Persisted } from '@shared/game/index';
import { loadContent } from '@shared/content';
import type { Room } from '../../src/server/room';

const content = loadContent();
type Type = ServerMsg['type'];
type Of<T extends Type> = Extract<ServerMsg, { type: T }>;
interface Closed { code: number; reason: string }

/** One client socket with a message queue. `next(type)` awaits the first unconsumed message of that type. */
class Client {
  /** Every message ever received, in order (never consumed). */
  readonly seen: ServerMsg[] = [];
  private queue: ServerMsg[] = [];
  private waiters: { type: Type; pred: (m: ServerMsg) => boolean; resolve: (m: ServerMsg) => void }[] = [];
  readonly closed: Promise<Closed>;

  constructor(readonly ws: WebSocket) {
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data as string) as ServerMsg;
      this.seen.push(m);
      const i = this.waiters.findIndex((w) => w.type === m.type && w.pred(m));
      if (i >= 0) this.waiters.splice(i, 1)[0]!.resolve(m);
      else this.queue.push(m);
    });
    this.closed = new Promise((resolve) => ws.addEventListener('close', (e) => {
      try { ws.close(); } catch { /* already closing */ }
      resolve({ code: e.code, reason: e.reason });
    }));
  }

  send(msg: unknown): void { this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); }

  next<T extends Type>(type: T, pred: (m: Of<T>) => boolean = () => true, ms = 4000): Promise<Of<T>> {
    const p = pred as (m: ServerMsg) => boolean;
    const i = this.queue.findIndex((m) => m.type === type && p(m));
    if (i >= 0) return Promise.resolve(this.queue.splice(i, 1)[0] as Of<T>);
    return new Promise((resolve, reject) => {
      const w = { type, pred: p, resolve: (m: ServerMsg) => { clearTimeout(timer); resolve(m as Of<T>); } };
      const timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        reject(new Error(`timed out waiting for ${type}; seen: ${this.seen.map((m) => m.type).join(',')}`));
      }, ms);
      this.waiters.push(w);
    });
  }

  /** All received messages of a type. */
  all<T extends Type>(type: T): Of<T>[] { return this.seen.filter((m) => m.type === type) as Of<T>[]; }

  close(): void { try { this.ws.close(1000, 'done'); } catch { /* already closed */ } }
}

const open: Client[] = [];
afterEach(() => { for (const c of open.splice(0)) c.close(); });

let seq = 0;
/** A fresh Room per test, so tests never share state. */
const freshRoom = () => env.ROOM.get(env.ROOM.idFromName(`test-${++seq}-${crypto.randomUUID()}`));
type Stub = ReturnType<typeof freshRoom>;

async function connect(stub: Stub | null = null): Promise<Client> {
  const res = stub
    ? await stub.fetch('http://x/ws', { headers: { Upgrade: 'websocket' } })
    : await SELF.fetch('http://x/ws', { headers: { Upgrade: 'websocket' } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  const c = new Client(ws);
  open.push(c);
  return c;
}

const tokenOf = (id: string) => `token-${id}-0000`;

async function player(stub: Stub, playerId: string, token = tokenOf(playerId)): Promise<Client> {
  const c = await connect(stub);
  c.send({ t: 'hello', playerId, token });
  await c.next('welcome');
  return c;
}

async function host(stub: Stub): Promise<[Client, Of<'hostState'>]> {
  const c = await connect(stub);
  c.send({ t: 'hostHello', pin: env.HOST_PIN });
  return [c, await c.next('hostState')];
}

const hostDo = (h: Client, a: unknown) => h.send({ t: 'host', a });
const act = (c: Client, a: unknown) => c.send({ t: 'act', a });
const stored = (stub: Stub) =>
  runInDurableObject(stub, (_i, state) => state.storage.get<Persisted>('state'));
const alarmOf = (stub: Stub) => runInDurableObject(stub, (_i, state) => state.storage.getAlarm());

/** Starts the competition and waits until the host sees it (otter, goesFirst, departs). */
async function start(h: Client) {
  hostDo(h, { type: 'host.startCompetition' });
  return h.next('hostState', (m) => m.snapshot.phase === 'competition');
}

/** Waits until `c` has processed everything sent before: emotes are echoed to the sender. */
async function sync(c: Client) {
  act(c, { type: 'emote', kind: 'wave' });
  await c.next('emote');
}

describe('room: hello and sessions', () => {
  it('hello with roster id gets welcome with snapshot', async () => {
    const c = await connect(); // through the Worker's /ws route
    c.send({ t: 'hello', playerId: 'p01', token: tokenOf('p01') });
    const w = await c.next('welcome');
    expect(w.you).toBe('p01');
    expect(w.token).toBe(tokenOf('p01'));
    expect(typeof w.serverNow).toBe('number');
    expect(w.snapshot.players.p01?.name).toBe(content.players[0]!.name);
    expect(w.snapshot.online.p01).toBe(true);
    expect(w.snapshot.phase).toBe('warmup');

    const stub = freshRoom();
    const u = await connect(stub);
    u.send({ t: 'hello', playerId: 'nobody', token: tokenOf('x') });
    expect((await u.next('error')).message).toBe('unknown player');
    // the token must be a string of 8-64 characters
    u.send({ t: 'hello', playerId: 'p01', token: 'short' });
    expect((await u.next('error')).message).toBe('bad message');
    u.send({ t: 'hello', playerId: 'p01', token: 'x'.repeat(65) });
    expect((await u.next('error')).message).toBe('bad message');
    expect(u.all('welcome')).toEqual([]);
  });

  it('say hello first', async () => {
    const stub = freshRoom();
    const c = await connect(stub);
    act(c, { type: 'emote', kind: 'wave' });
    expect((await c.next('error')).message).toBe('say hello first');
    hostDo(c, { type: 'host.pause' });
    expect((await c.next('error')).message).toBe('say hello first');
    // peek (Task 9) is allowed before hello and is ignored for now
    c.send({ t: 'peek' });
    c.send({ t: 'hello', playerId: 'p01', token: tokenOf('p01') });
    await c.next('welcome');
    expect(c.all('error')).toHaveLength(2);
  });

  it('second device with different token gets nameTaken; takeover kicks the first', async () => {
    const stub = freshRoom();
    const a = await player(stub, 'p01', 'device-a-token');
    const b = await connect(stub);
    b.send({ t: 'hello', playerId: 'p01', token: 'device-b-token' });
    expect(await b.next('nameTaken')).toEqual({ type: 'nameTaken', playerId: 'p01' });
    expect(a.all('kicked')).toEqual([]);

    b.send({ t: 'hello', playerId: 'p01', token: 'device-b-token', takeover: true });
    const w = await b.next('welcome');
    expect(w.you).toBe('p01');
    expect(w.token).toBe('device-b-token');
    await a.next('kicked');
    expect((await a.closed).code).toBe(4000);

    // the old socket closing does not take p01 offline: b still holds it
    const [, hs] = await host(stub);
    expect(hs.snapshot.online.p01).toBe(true);
    expect(hs.connectedPerTeam.otter).toEqual({ online: 1, total: 5 });
    await sync(b);
  });

  it('reconnect with same token replaces old socket silently', async () => {
    const stub = freshRoom();
    const a = await player(stub, 'p01');
    const a2 = await player(stub, 'p01');
    expect((await a.closed).code).toBe(4000);
    expect(a.all('kicked')).toEqual([]);
    expect(a2.all('nameTaken')).toEqual([]);
    const [, hs] = await host(stub);
    expect(hs.snapshot.online.p01).toBe(true);
    await sync(a2);
  });

  it('closing the last socket of a player marks them offline', async () => {
    const stub = freshRoom();
    const [h] = await host(stub);
    const p = await player(stub, 'p06');
    await h.next('hostState', (m) => m.snapshot.online.p06 === true);
    p.close();
    const hs = await h.next('hostState', (m) => !m.snapshot.online.p06);
    expect(hs.connectedPerTeam.pixel).toEqual({ online: 0, total: 5 });
  });

  it('addSelf over the wire joins and welcomes', async () => {
    const stub = freshRoom();
    const c = await connect(stub);
    c.send({ t: 'addSelf', name: 'Zed', teamId: 'nope', token: tokenOf('zed') });
    expect((await c.next('error')).message).toBe('unknown team');
    c.send({ t: 'addSelf', name: 'x'.repeat(25), teamId: 'pixel', token: tokenOf('zed') });
    expect((await c.next('error')).message).toBe('bad message');

    c.send({ t: 'addSelf', name: 'Zed', teamId: 'pixel', token: tokenOf('zed') });
    const w = await c.next('welcome');
    expect(w.you).toBe('x-zed-1');
    expect(w.token).toBe(tokenOf('zed'));
    expect(w.snapshot.players['x-zed-1']).toMatchObject({ name: 'Zed', teamId: 'pixel', addedOnDay: true });
    expect(w.snapshot.online['x-zed-1']).toBe(true);
    expect((await stored(stub))?.players['x-zed-1']?.name).toBe('Zed');
    await sync(c);

    // the new id works like a roster id from then on, e.g. a reload with the same token
    const again = await player(stub, 'x-zed-1', tokenOf('zed'));
    expect((await c.closed).code).toBe(4000);
    await sync(again);
  });
});

describe('room: validation and host auth', () => {
  it('invalid JSON returns bad message', async () => {
    const stub = freshRoom();
    const c = await connect(stub);
    for (const raw of ['not json{', '"hello"', 'null', '[]', '{}', JSON.stringify({ t: 'hello' }),
      JSON.stringify({ t: 'nope' }), JSON.stringify({ t: 'hello', playerId: 'p01', token: tokenOf('p01'), extra: 1 }),
      'x'.repeat(10000)]) {
      c.send(raw);
      expect((await c.next('error')).message).toBe('bad message');
    }
    c.ws.send(new Uint8Array([1, 2, 3]));
    expect((await c.next('error')).message).toBe('bad message');

    // after hello, malformed actions are bad messages too and leave the socket usable
    c.send({ t: 'hello', playerId: 'p01', token: tokenOf('p01') });
    await c.next('welcome');
    for (const a of [{ type: 'move' }, { type: 'move', to: { x: 'a', y: 1 } }, { type: 'emote', kind: 'wave', target: 'x'.repeat(65) },
      { type: 'riddleAnswer', text: 'x'.repeat(201) }, { type: 'quizAnswer', choice: 1.5 }, { type: 'connect' },
      { type: 'disconnect' }, { type: 'addSelf', name: 'A', teamId: 'pixel' }, { type: 'tick' }, { type: 'toString' }]) {
      act(c, a);
      expect((await c.next('error')).message).toBe('bad message');
    }
    await sync(c);
  });

  it('host with wrong pin is closed 4001', async () => {
    const stub = freshRoom();
    const c = await connect(stub);
    c.send({ t: 'hostHello', pin: '0000' });
    expect(await c.closed).toEqual({ code: 4001, reason: 'bad pin' });
    expect(c.all('hostState')).toEqual([]);

    const [, hs] = await host(stub);
    expect(hs.snapshot.phase).toBe('warmup');
    expect(Object.keys(hs.connectedPerTeam)).toEqual(content.teams.map((t) => t.id));
    expect(hs.connectedPerTeam.maple).toEqual({ online: 0, total: 6 });
    expect(hs.nextLeader).toBeNull();
    expect(hs.lastCallAt).toBeNull();
  });

  it('player cannot send host actions', async () => {
    const stub = freshRoom();
    const p = await player(stub, 'p01');
    hostDo(p, { type: 'host.startCompetition' });
    expect((await p.next('error')).message).toBe('host only');
    // nor smuggle one through act, or act as someone else
    act(p, { type: 'host.startCompetition' });
    expect((await p.next('error')).message).toBe('bad message');
    act(p, { type: 'emote', kind: 'wave', playerId: 'p02' });
    expect((await p.next('error')).message).toBe('bad message');
    await sync(p);
    expect(p.all('emote')).toEqual([{ type: 'emote', from: 'p01', kind: 'wave' }]);
    const [, hs] = await host(stub);
    expect(hs.snapshot.phase).toBe('warmup');
  });
});

describe('room: routing', () => {
  it('move broadcasts motion to other sockets', async () => {
    const stub = freshRoom();
    const a = await player(stub, 'p01');
    const b = await player(stub, 'p06');
    const to = { x: 10 * 32 + 16, y: 12 * 32 + 16 };
    act(a, { type: 'move', to });
    const m = await b.next('motion');
    expect(m.playerId).toBe('p01');
    expect(m.motion.path.length).toBeGreaterThan(0);
    expect(await a.next('motion')).toEqual(m);
  });

  it('team-addressed riddle message only reaches that team', async () => {
    const stub = freshRoom();
    const [h] = await host(stub);
    const p06 = await player(stub, 'p06'); // pixel
    const p07 = await player(stub, 'p07'); // pixel
    const p11 = await player(stub, 'p11'); // comet
    await start(h);
    // competition start hands each playing team its first riddle
    for (const c of [p06, p07, p11])
      expect(await c.next('riddle')).toEqual({ type: 'riddle', index: 0, q: content.riddles[0]!.q, lockedUntil: 0 });

    act(p06, { type: 'riddleSkip' });
    const r = await p07.next('riddle');
    expect(r.index).toBe(1);
    expect(r.q).toBe(content.riddles[1]!.q);
    expect(r.lockedUntil).toBeGreaterThan(Date.now());
    expect(await p06.next('riddle')).toEqual(r);
    await sync(p11);
    expect(p11.all('riddle').map((m) => m.index)).toEqual([0]);
    expect(h.all('riddle')).toEqual([]);
  });

  it('errors go only to the sender', async () => {
    const stub = freshRoom();
    const a = await player(stub, 'p01');
    const b = await player(stub, 'p06');
    act(a, { type: 'emote', kind: 'dance' });
    expect((await a.next('error')).message).toBe('Unknown emote');
    await sync(b);
    expect(b.all('error')).toEqual([]);
  });
});

describe('room: late state after welcome (R16)', () => {
  it('welcome during the competition is followed by the team riddle, but not for departed teams', async () => {
    const stub = freshRoom();
    const [h] = await host(stub);
    await start(h);
    const p06 = await connect(stub);
    p06.send({ t: 'hello', playerId: 'p06', token: tokenOf('p06') });
    await p06.next('welcome');
    expect(await p06.next('riddle')).toEqual({ type: 'riddle', index: 0, q: content.riddles[0]!.q, lockedUntil: 0 });
    expect(p06.seen.slice(0, 2).map((m) => m.type)).toEqual(['welcome', 'riddle']);
    expect(p06.all('boss')).toEqual([]);

    const p01 = await player(stub, 'p01'); // otter went first
    await sync(p01);
    expect(p01.all('riddle')).toEqual([]);
  });

  it('the sole playing team gets its boss step (with intro at step 0) after welcome', async () => {
    const stub = freshRoom();
    const [h] = await host(stub);
    await start(h);
    const order = ['pixel', 'comet', 'mango', 'koala', 'nova']; // all on 0 points: teamOrder decides
    for (const [i, id] of order.entries()) {
      hostDo(h, { type: 'host.callNext', expectedTeamId: id });
      await h.next('hostState', (m) => m.snapshot.departures.length === i + 2);
    }
    const p31 = await connect(stub);
    p31.send({ t: 'hello', playerId: 'p31', token: tokenOf('p31') });
    await p31.next('welcome');
    await p31.next('riddle');
    expect(await p31.next('boss')).toEqual({
      type: 'boss', index: 0, q: content.boss.steps[0]!.q, done: false, intro: content.boss.intro,
    });
    const p26 = await player(stub, 'p26'); // nova has gone
    await sync(p26);
    expect(p26.all('boss')).toEqual([]);
  });
});

describe('room: host actions with socket side effects', () => {
  it('undo hands the restored team its riddle again', async () => {
    const stub = freshRoom();
    const [h] = await host(stub);
    const p06 = await player(stub, 'p06'); // pixel
    await start(h);
    await p06.next('riddle');
    hostDo(h, { type: 'host.callNext', expectedTeamId: 'pixel' });
    await p06.next('youreUp');
    hostDo(h, { type: 'host.undoCall' });
    expect(await p06.next('riddle')).toEqual({ type: 'riddle', index: 0, q: content.riddles[0]!.q, lockedUntil: 0 });
  });

  it('a removed player is closed with 4003 and cannot hello again', async () => {
    const stub = freshRoom();
    const [h] = await host(stub);
    const p = await player(stub, 'p06');
    hostDo(h, { type: 'host.removePlayer', playerId: 'p06' });
    expect(await p.closed).toEqual({ code: 4003, reason: 'removed' });
    const hs = await h.next('hostState', (m) => !m.snapshot.players.p06);
    expect(hs.connectedPerTeam.pixel).toEqual({ online: 0, total: 4 });
    const again = await connect(stub);
    again.send({ t: 'hello', playerId: 'p06', token: tokenOf('p06') });
    expect((await again.next('error')).message).toBe('unknown player');
  });
});

describe('room: persistence, alarm and counters', () => {
  it('state survives object restart and alarm is re-armed', async () => {
    const stub = freshRoom();
    const [h] = await host(stub);
    const p = await player(stub, 'p06');
    expect(await alarmOf(stub)).toBeNull(); // warm-up: no tick
    await start(h);
    expect(await alarmOf(stub)).not.toBeNull();
    hostDo(h, { type: 'host.adjustScore', teamId: 'koala', delta: 50 });
    hostDo(h, { type: 'host.adjustScore', teamId: 'pixel', delta: 20 });
    hostDo(h, { type: 'host.callNext', expectedTeamId: 'koala' });
    await h.next('hostState', (m) => m.snapshot.departures.length === 2);

    const saved = await stored(stub);
    expect(saved?.teams.koala?.score).toBe(50);
    expect(saved?.teams.pixel?.score).toBe(20);
    expect(saved?.departures).toEqual(['otter', 'koala']);
    expect(saved).not.toHaveProperty('motions');
    expect(saved).not.toHaveProperty('online');
    // Drop the alarm so the check below proves the restarted object re-arms it.
    await runInDurableObject(stub, (_i, state) => state.storage.deleteAlarm());

    // Restart: tear the instance down (sockets closed, in-memory state gone, storage kept).
    await evictDurableObject(stub, { webSockets: 'close' });
    await Promise.all([p.closed, h.closed]);

    const p2 = await player(stub, 'p06');
    expect(p2.all('welcome')[0]!.snapshot.teams.koala?.score).toBe(50);
    const w = p2.all('welcome')[0]!.snapshot;
    expect(w.teams.pixel?.score).toBe(20);
    expect(w.departures).toEqual(['otter', 'koala']);
    expect(w.teams.koala?.status).toBe('departed');
    expect(w.phase).toBe('competition');
    expect(await p2.next('riddle')).toMatchObject({ index: 0 });
    expect(await alarmOf(stub)).not.toBeNull();
    const [, hs] = await host(stub);
    expect(hs.nextLeader).toEqual({ id: 'pixel', name: 'Pixel', score: 20 });
    expect(hs.lastCallAt).toBe(saved?.lastCallAt);
  });

  it('players stay online when the object wakes from hibernation', async () => {
    const stub = freshRoom();
    const p = await player(stub, 'p06');
    await evictDurableObject(stub); // hibernates sockets: they stay connected with their attachments
    const [, hs] = await host(stub); // wakes it: the constructor runs again
    expect(hs.snapshot.online.p06).toBe(true);
    expect(hs.connectedPerTeam.pixel).toEqual({ online: 1, total: 5 });
    // the hibernated socket still acts as p06
    await sync(p);
    expect(p.all('emote').at(-1)).toEqual({ type: 'emote', from: 'p06', kind: 'wave' });
  });

  it('alarm ticks while competing and re-arms', async () => {
    const stub = freshRoom();
    const [h] = await host(stub);
    await start(h);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    // the first tick spawns a collectible and broadcasts it
    const hs = await h.next('hostState', (m) => m.snapshot.collectibles.length > 0);
    expect(hs.snapshot.collectibles).toHaveLength(1);
    expect(await alarmOf(stub)).not.toBeNull();
    expect((await stored(stub))?.collectibles).toHaveLength(1);
  });

  it('msgCount increments per incoming message', async () => {
    const stub = freshRoom();
    const [h, hs1] = await host(stub);
    expect(hs1.msgCount).toBe(1); // hostHello
    const p = await player(stub, 'p01'); // 2: hello
    p.send('garbage'); // 3: invalid ones count too
    await p.next('error');
    act(p, { type: 'emote', kind: 'wave' }); // 4
    await p.next('emote');
    hostDo(h, { type: 'host.pause' }); // 5
    expect((await h.next('hostState', (m) => m.snapshot.paused)).msgCount).toBe(5);
    const today = new Date().toISOString().slice(0, 10);
    expect(await runInDurableObject(stub, (_i, s) => s.storage.get('msgCount'))).toEqual({ day: today, count: 5 });
    expect((await stored(stub))?.msgCount).toEqual({ day: today, count: 5 });

    // a new UTC day starts from zero
    await runInDurableObject<Room, void>(stub, (room) => { room.game.msgCount = { day: '2000-01-01', count: 99 }; });
    p.send('{'); // 1 (emotes are ignored while paused, so probe with an invalid frame)
    await p.next('error');
    hostDo(h, { type: 'host.resume' }); // 2
    expect((await h.next('hostState', (m) => !m.snapshot.paused)).msgCount).toBe(2);

    // on load the larger same-day count wins (the msgCount key is written more often than state)
    await runInDurableObject(stub, (_i, s) => s.storage.put('msgCount', { day: today, count: 500 }));
    await evictDurableObject(stub, { webSockets: 'close' });
    const [, hs2] = await host(stub);
    expect(hs2.msgCount).toBe(501);
  });

  it('host reset closes player sockets with 4002', async () => {
    const stub = freshRoom();
    const [h] = await host(stub);
    const a = await player(stub, 'p01');
    const b = await player(stub, 'p06');
    await start(h);
    hostDo(h, { type: 'host.reset' });
    expect(await a.closed).toEqual({ code: 4002, reason: 'reset' });
    expect(await b.closed).toEqual({ code: 4002, reason: 'reset' });
    const hs = await h.next('hostState', (m) => m.snapshot.phase === 'warmup');
    expect(hs.snapshot.departures).toEqual([]);
    // host sockets stay open and keep working
    hostDo(h, { type: 'host.pause' });
    await h.next('hostState', (m) => m.snapshot.paused);
    // players can join again
    await player(stub, 'p01');
  });
});

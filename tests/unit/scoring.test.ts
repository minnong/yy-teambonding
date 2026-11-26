import { describe, it, expect } from 'vitest';
import { apply, createState, type Ctx, type Result } from '@shared/game/index';
import { addPoints, onTeamDeparted } from '@shared/game/scoring';
import type { Action } from '@shared/protocol';
import type { GameState, Vec } from '@shared/types';
import { loadContent } from '@shared/content';
import { isWalkable, nearTable, spawnFor, toTile, toWorld } from '@shared/layout';
import { POINTS, QUIZ_MS, RIDDLE_SKIP_LOCK_MS, TABLE_REACH, TILE } from '@shared/constants';

const content = loadContent();
const ctx = (now: number, rng: () => number = () => 0.5): Ctx => ({ now, rng, content });
const run = (s: GameState, a: Action, now: number, rng?: () => number): Result => apply(s, a, ctx(now, rng));
const clone = (s: GameState) => structuredClone(s);

// Roster: otter p01–p05 (goesFirst), pixel p06–p10, comet p11–p15, ..., maple p31–p36.
const members = (team: string) => content.players.filter((p) => p.teamId === team).map((p) => p.id);
const ALL = content.players.map((p) => p.id);

function room(now = 1000, ids = ALL): GameState {
  const s = createState(content, now);
  for (const id of ids) run(s, { type: 'connect', playerId: id }, now);
  return s;
}
/** Competition started at `now`; otter (goesFirst) has departed. Collectible spawning pushed far out. */
function competing(now = 1000, ids = ALL): GameState {
  const s = room(now, ids);
  run(s, { type: 'host.startCompetition' }, now);
  s.nextCollectibleAt = 1e12;
  return s;
}
const place = (s: GameState, id: string, pos: Vec, now = 0) => { s.motions[id] = { path: [pos], startedAt: now }; };
const SPOT = toWorld(5, 25);
const NEXT_TO = toWorld(6, 25); // 32 px away
const FAR = toWorld(20, 30);
const ibMsgs = (r: Result) => r.out.filter((o) => o.msg.type === 'icebreaker');
const floats = (r: Result) => r.out.filter((o) => o.msg.type === 'float').map((o) => o.msg);

function startIb(s: GameState, a: string, b: string, now: number): string {
  place(s, a, SPOT); place(s, b, NEXT_TO);
  const r = run(s, { type: 'icebreakerStart', playerId: a, target: b }, now);
  expect(r.error).toBeUndefined();
  return Object.values(s.icebreakers).find((ib) => ib.a === a && ib.b === b)!.id;
}

describe('scoring: icebreakers', () => {
  it('icebreaker needs proximity and different teams', () => {
    const s = room();
    place(s, 'p06', SPOT); place(s, 'p07', NEXT_TO); place(s, 'p11', FAR);
    const before = clone(s);
    // same team
    expect(run(s, { type: 'icebreakerStart', playerId: 'p06', target: 'p07' }, 2000).error).toBeTruthy();
    // too far
    expect(run(s, { type: 'icebreakerStart', playerId: 'p06', target: 'p11' }, 2000).error).toBeTruthy();
    // self, unknown, offline
    expect(run(s, { type: 'icebreakerStart', playerId: 'p06', target: 'p06' }, 2000).error).toBeTruthy();
    expect(run(s, { type: 'icebreakerStart', playerId: 'p06', target: 'nope' }, 2000).error).toBeTruthy();
    expect(s).toEqual(before);

    // within PROXIMITY and different teams: card with the prompt text goes to both
    place(s, 'p11', NEXT_TO);
    const r = run(s, { type: 'icebreakerStart', playerId: 'p06', target: 'p11' }, 2000);
    expect(r.error).toBeUndefined();
    const ib = Object.values(s.icebreakers)[0]!;
    expect(ib).toMatchObject({ a: 'p06', b: 'p11', prompt: 0, answeredBy: null });
    expect(s.promptCursor).toBe(1);
    const card = { id: ib.id, a: 'p06', b: 'p11', prompt: content.icebreakers[0], answeredBy: null };
    expect(ibMsgs(r)).toEqual([
      { to: { player: 'p06' }, msg: { type: 'icebreaker', card } },
      { to: { player: 'p11' }, msg: { type: 'icebreaker', card } },
    ]);

    // neither may already be in an open icebreaker
    place(s, 'p12', NEXT_TO);
    const busy = clone(s);
    expect(run(s, { type: 'icebreakerStart', playerId: 'p12', target: 'p06' }, 2000).error).toBeTruthy();
    expect(s).toEqual(busy);

    // a target who is offline cannot be started with
    run(s, { type: 'disconnect', playerId: 'p13' }, 2000);
    place(s, 'p13', NEXT_TO); place(s, 'p08', SPOT);
    const off = clone(s);
    expect(run(s, { type: 'icebreakerStart', playerId: 'p08', target: 'p13' }, 2000).error).toBeTruthy();
    expect(s).toEqual(off);
  });

  it('icebreaker ids are deterministic and the prompt cursor wraps', () => {
    const s = room();
    s.promptCursor = content.icebreakers.length - 1;
    const id1 = startIb(s, 'p06', 'p11', 2000);
    expect(s.icebreakers[id1]!.prompt).toBe(content.icebreakers.length - 1);
    const id2 = startIb(s, 'p07', 'p12', 2000);
    expect(s.icebreakers[id2]!.prompt).toBe(0);
    expect(id1).not.toBe(id2);
    const t = room();
    t.promptCursor = content.icebreakers.length - 1;
    expect(startIb(t, 'p06', 'p11', 2000)).toBe(id1);
  });

  it('icebreakerAnswered sets answeredBy and sends the updated card to both', () => {
    const s = room();
    const id = startIb(s, 'p06', 'p11', 2000);
    const outsider = clone(s);
    expect(run(s, { type: 'icebreakerAnswered', playerId: 'p12', id }, 2100).error).toBeTruthy();
    expect(run(s, { type: 'icebreakerAnswered', playerId: 'p06', id: 'nope' }, 2100).error).toBeTruthy();
    expect(s).toEqual(outsider);
    const r = run(s, { type: 'icebreakerAnswered', playerId: 'p11', id }, 2100);
    expect(r.error).toBeUndefined();
    expect(s.icebreakers[id]!.answeredBy).toBe('p11');
    const card = { id, a: 'p06', b: 'p11', prompt: content.icebreakers[0], answeredBy: 'p11' };
    expect(r.out).toEqual([
      { to: { player: 'p06' }, msg: { type: 'icebreaker', card } },
      { to: { player: 'p11' }, msg: { type: 'icebreaker', card } },
    ]);
  });

  it('icebreaker confirm by other person gives +10 to both teams and records pair', () => {
    const s = competing();
    const id = startIb(s, 'p11', 'p06', 2000);
    run(s, { type: 'icebreakerAnswered', playerId: 'p11', id }, 2100);
    const r = run(s, { type: 'icebreakerConfirm', playerId: 'p06', id }, 2200);
    expect(r.error).toBeUndefined();
    expect(s.icebreakers[id]).toBeUndefined();
    expect(s.teams.comet!.score).toBe(POINTS.icebreaker);
    expect(s.teams.pixel!.score).toBe(POINTS.icebreaker);
    expect(s.teams.comet!.scoreChangedAt).toBe(2200);
    expect(s.metPairs).toEqual(['p06|p11']);
    expect(floats(r)).toEqual([
      { type: 'float', teamId: 'comet', text: '+10 icebreaker' },
      { type: 'float', teamId: 'pixel', text: '+10 icebreaker' },
    ]);
    expect(ibMsgs(r)).toEqual([
      { to: { player: 'p11' }, msg: { type: 'icebreaker', card: null, closedReason: 'done' } },
      { to: { player: 'p06' }, msg: { type: 'icebreaker', card: null, closedReason: 'done' } },
    ]);
    expect(r.persist).toBe(true);
    expect(r.snapshot).toBe(true);
  });

  it('confirm by the answerer themselves is rejected', () => {
    const s = competing();
    const id = startIb(s, 'p06', 'p11', 2000);
    // confirm before anyone answered
    expect(run(s, { type: 'icebreakerConfirm', playerId: 'p11', id }, 2050).error).toBeTruthy();
    run(s, { type: 'icebreakerAnswered', playerId: 'p06', id }, 2100);
    const before = clone(s);
    const r = run(s, { type: 'icebreakerConfirm', playerId: 'p06', id }, 2200);
    expect(r.error).toBeTruthy();
    expect(r.out).toEqual([]);
    expect(s).toEqual(before);
  });

  it('same pair a second time gets "already met! 🎉"', () => {
    const s = competing();
    const id = startIb(s, 'p06', 'p11', 2000);
    run(s, { type: 'icebreakerAnswered', playerId: 'p06', id }, 2100);
    run(s, { type: 'icebreakerConfirm', playerId: 'p11', id }, 2200);
    const before = clone(s);
    // either direction
    expect(run(s, { type: 'icebreakerStart', playerId: 'p11', target: 'p06' }, 3000).error).toBe('already met! 🎉');
    expect(run(s, { type: 'icebreakerStart', playerId: 'p06', target: 'p11' }, 3000).error).toBe('already met! 🎉');
    expect(s).toEqual(before);
  });

  it('warm-up icebreaker gives no points and does not record pair', () => {
    const s = room();
    const id = startIb(s, 'p06', 'p11', 2000);
    run(s, { type: 'icebreakerAnswered', playerId: 'p06', id }, 2100);
    const r = run(s, { type: 'icebreakerConfirm', playerId: 'p11', id }, 2200);
    expect(r.error).toBeUndefined();
    expect(s.icebreakers[id]).toBeUndefined();
    expect(s.teams.pixel!.score).toBe(0);
    expect(s.teams.comet!.score).toBe(0);
    expect(s.metPairs).toEqual([]);
    expect(floats(r)).toEqual([]);
    expect(ibMsgs(r)).toHaveLength(2);
    // they can do another one together
    expect(startIb(s, 'p06', 'p11', 2300)).toBeTruthy();
  });

  it('icebreakerCancel comes from either person', () => {
    const s = room();
    const id = startIb(s, 'p06', 'p11', 2000);
    const before = clone(s);
    expect(run(s, { type: 'icebreakerCancel', playerId: 'p12', id }, 2100).error).toBeTruthy();
    expect(s).toEqual(before);
    const r = run(s, { type: 'icebreakerCancel', playerId: 'p11', id }, 2100);
    expect(r.error).toBeUndefined();
    expect(s.icebreakers[id]).toBeUndefined();
    expect(r.out).toEqual([
      { to: { player: 'p06' }, msg: { type: 'icebreaker', card: null, closedReason: 'cancelled' } },
      { to: { player: 'p11' }, msg: { type: 'icebreaker', card: null, closedReason: 'cancelled' } },
    ]);
  });

  it('departure cancels pending icebreakers', () => {
    const s = competing();
    const id1 = startIb(s, 'p06', 'p11', 2000);
    const id2 = startIb(s, 'p16', 'p07', 2000);
    const id3 = startIb(s, 'p12', 'p21', 2000);
    s.teams.pixel!.status = 'departed';
    const out = onTeamDeparted(s, 'pixel');
    expect(s.icebreakers[id1]).toBeUndefined();
    expect(s.icebreakers[id2]).toBeUndefined();
    expect(s.icebreakers[id3]).toBeDefined();
    expect(out).toEqual(expect.arrayContaining([
      { to: { player: 'p06' }, msg: { type: 'icebreaker', card: null, closedReason: 'departed' } },
      { to: { player: 'p11' }, msg: { type: 'icebreaker', card: null, closedReason: 'departed' } },
      { to: { player: 'p16' }, msg: { type: 'icebreaker', card: null, closedReason: 'departed' } },
      { to: { player: 'p07' }, msg: { type: 'icebreaker', card: null, closedReason: 'departed' } },
    ]));
    expect(out).toHaveLength(4);
  });

  it("icebreaker with a departed team's player is refused during competition", () => {
    const s = competing(); // otter (p01–p05) departed
    place(s, 'p01', SPOT); place(s, 'p06', NEXT_TO);
    const before = clone(s);
    expect(run(s, { type: 'icebreakerStart', playerId: 'p06', target: 'p01' }, 2000).error).toBe("They've headed out!");
    expect(run(s, { type: 'icebreakerStart', playerId: 'p01', target: 'p06' }, 2000).error).toBe("They've headed out!");
    expect(s).toEqual(before);
  });
});

describe('scoring: points', () => {
  it('departed team cannot score', () => {
    const s = competing(); // otter departed
    expect(addPoints(s, 'otter', 30, 'riddle', 2000)).toEqual([]);
    expect(s.teams.otter!.score).toBe(0);
    // riddle from a departed team's player
    place(s, 'p01', spawnFor(0, 0));
    const before = clone(s);
    expect(run(s, { type: 'riddleAnswer', playerId: 'p01', text: content.riddles[0]!.answers[0]! }, 2000).error).toBeTruthy();
    expect(s).toEqual(before);
    // walking through a sparkle does not collect it
    s.collectibles.push({ id: 'c1', pos: SPOT });
    s.motions.p01 = { path: [{ x: SPOT.x - 100, y: SPOT.y }, { x: SPOT.x + 100, y: SPOT.y }], startedAt: 1000 };
    s.lastTickAt = 1000;
    run(s, { type: 'tick' }, 3000);
    expect(s.collectibles).toHaveLength(1);
    expect(s.teams.otter!.score).toBe(0);
  });

  it('addPoints updates score and scoreChangedAt and returns a float', () => {
    const s = competing();
    expect(addPoints(s, 'pixel', 15, 'sparkle', 4000)).toEqual([
      { to: 'all', msg: { type: 'float', teamId: 'pixel', text: '+15 sparkle' } },
    ]);
    expect(s.teams.pixel!.score).toBe(15);
    expect(s.teams.pixel!.scoreChangedAt).toBe(4000);
    // no-op outside competition or for an unknown team
    const w = room();
    expect(addPoints(w, 'pixel', 15, 'sparkle', 4000)).toEqual([]);
    expect(w.teams.pixel!.score).toBe(0);
    expect(addPoints(s, 'nope', 15, 'sparkle', 4000)).toEqual([]);
  });

  it('while paused, scoring actions are refused without changing state', () => {
    const s = competing();
    const id = startIb(s, 'p06', 'p11', 2000);
    run(s, { type: 'icebreakerAnswered', playerId: 'p06', id }, 2100);
    place(s, 'p07', SPOT); place(s, 'p12', NEXT_TO);
    place(s, 'p08', spawnFor(1, 0));
    run(s, { type: 'host.pause' }, 2200);
    const before = clone(s);
    expect(run(s, { type: 'icebreakerConfirm', playerId: 'p11', id }, 2300).error).toBe('Paused');
    expect(run(s, { type: 'icebreakerStart', playerId: 'p07', target: 'p12' }, 2300).error).toBe('Paused');
    expect(run(s, { type: 'riddleAnswer', playerId: 'p08', text: content.riddles[0]!.answers[0]! }, 2300).error).toBe('Paused');
    expect(run(s, { type: 'riddleSkip', playerId: 'p08' }, 2300).error).toBe('Paused');
    expect(run(s, { type: 'host.quizStart' }, 2300).error).toBe('Paused');
    expect(s).toEqual(before);
    // after resume the pending confirm scores normally
    run(s, { type: 'host.resume' }, 3000);
    expect(run(s, { type: 'icebreakerConfirm', playerId: 'p11', id }, 3100).error).toBeUndefined();
    expect(s.teams.pixel!.score).toBe(POINTS.icebreaker);
  });

  it('addPoints is a no-op while paused', () => {
    const s = competing();
    run(s, { type: 'host.pause' }, 2000);
    const before = clone(s);
    expect(addPoints(s, 'pixel', 10, 'icebreaker', 3000)).toEqual([]);
    expect(s).toEqual(before);
  });

  it('adjustScore updates scoreChangedAt', () => {
    const s = competing();
    const r = run(s, { type: 'host.adjustScore', teamId: 'pixel', delta: 25 }, 5000);
    expect(r.error).toBeUndefined();
    expect(s.teams.pixel!.score).toBe(25);
    expect(s.teams.pixel!.scoreChangedAt).toBe(5000);
    expect(r.out).toEqual([{ to: 'all', msg: { type: 'float', teamId: 'pixel', text: '+25 adjusted' } }]);
    expect(r.persist).toBe(true);
    expect(r.snapshot).toBe(true);
    const neg = run(s, { type: 'host.adjustScore', teamId: 'pixel', delta: -5 }, 6000);
    expect(s.teams.pixel!.score).toBe(20);
    expect(neg.out[0]!.msg).toEqual({ type: 'float', teamId: 'pixel', text: '-5 adjusted' });
    // bypasses pause and phase, including departed teams
    run(s, { type: 'host.pause' }, 6500);
    expect(run(s, { type: 'host.adjustScore', teamId: 'otter', delta: 500 }, 7000).error).toBeUndefined();
    expect(s.teams.otter!.score).toBe(500);
    expect(s.teams.otter!.scoreChangedAt).toBe(7000);
    const w = room();
    expect(run(w, { type: 'host.adjustScore', teamId: 'pixel', delta: -500 }, 2000).error).toBeUndefined();
    expect(w.teams.pixel!.score).toBe(-500);
    // invalid deltas and unknown teams
    const before = clone(s);
    for (const delta of [501, -501, 1.5, Number.NaN, Infinity, 0]) {
      expect(run(s, { type: 'host.adjustScore', teamId: 'pixel', delta }, 8000).error).toBeTruthy();
    }
    expect(run(s, { type: 'host.adjustScore', teamId: 'nope', delta: 5 }, 8000).error).toBeTruthy();
    expect(s).toEqual(before);
  });
});

describe('scoring: collectibles and tick', () => {
  it('tick spawns at most 2 collectibles with 20–30 s spacing', () => {
    const s = competing(1000, []); // nobody online, so nothing is collected
    s.nextCollectibleAt = null;
    const r1 = run(s, { type: 'tick' }, 2000, () => 0);
    expect(s.collectibles).toHaveLength(1);
    expect(s.nextCollectibleAt).toBe(2000 + 20000);
    expect(r1.snapshot).toBe(true);
    expect(r1.persist).toBe(true);
    expect(s.lastTickAt).toBe(2000);
    const c = s.collectibles[0]!.pos;
    expect(isWalkable(toTile(c).x, toTile(c).y)).toBe(true);
    for (let slot = 0; slot < 7; slot++) expect(nearTable(c, slot)).toBe(false);

    const r2 = run(s, { type: 'tick' }, 21999, () => 0);
    expect(s.collectibles).toHaveLength(1);
    expect(r2.snapshot).toBe(false);
    expect(r2.persist).toBe(false);
    expect(s.lastTickAt).toBe(21999);

    run(s, { type: 'tick' }, 22000, () => 0.99999);
    expect(s.collectibles).toHaveLength(2);
    const gap = s.nextCollectibleAt! - 22000;
    expect(gap).toBeGreaterThanOrEqual(20000);
    expect(gap).toBeLessThanOrEqual(30000);
    expect(gap).toBeGreaterThan(29000);
    expect(new Set(s.collectibles.map((x) => x.id)).size).toBe(2);

    const r4 = run(s, { type: 'tick' }, 60000, () => 0.5);
    expect(s.collectibles).toHaveLength(2);
    expect(r4.snapshot).toBe(false);
  });

  it('tick does not spawn in warm-up, and while paused only updates lastTickAt', () => {
    const w = room(1000, []);
    run(w, { type: 'tick' }, 50000);
    expect(w.collectibles).toEqual([]);
    expect(w.lastTickAt).toBe(50000);

    const s = competing(1000);
    s.nextCollectibleAt = null;
    s.collectibles.push({ id: 'c1', pos: SPOT });
    s.motions.p06 = { path: [{ x: SPOT.x - 100, y: SPOT.y }, { x: SPOT.x + 100, y: SPOT.y }], startedAt: 1000 };
    s.lastTickAt = 1000;
    run(s, { type: 'host.pause' }, 1100); // truncates p06 before reaching the sparkle
    const before = clone(s);
    const r = run(s, { type: 'tick' }, 5000);
    expect(r.snapshot).toBe(false);
    expect(r.persist).toBe(false);
    expect({ ...s, lastTickAt: 0 }).toEqual({ ...before, lastTickAt: 0 });
    expect(s.lastTickAt).toBe(5000);
  });

  it('walking through a collectible between ticks collects it once', () => {
    const s = competing(1000);
    s.collectibles.push({ id: 'c1', pos: SPOT });
    s.lastTickAt = 1000;
    // p16 (mango) and p11 (comet) both walk through it during the same interval; p11 sorts first
    const through = { path: [{ x: SPOT.x - 100, y: SPOT.y }, { x: SPOT.x + 100, y: SPOT.y }], startedAt: 1000 };
    s.motions.p16 = structuredClone(through);
    s.motions.p11 = structuredClone(through);
    // p06 (pixel, still playing) sorts before both and stands on it, but is offline
    run(s, { type: 'disconnect', playerId: 'p06' }, 1000);
    place(s, 'p06', SPOT);
    const r = run(s, { type: 'tick' }, 3000);
    expect(s.collectibles).toEqual([]);
    expect(s.teams.comet!.score).toBe(POINTS.collectible);
    expect(s.teams.pixel!.score).toBe(0);
    expect(s.teams.mango!.score).toBe(0);
    expect(floats(r)).toEqual([{ type: 'float', teamId: 'comet', text: '+15 sparkle' }]);
    expect(r.snapshot).toBe(true);
    expect(r.persist).toBe(true);
    expect(s.lastTickAt).toBe(3000);
    const r2 = run(s, { type: 'tick' }, 4000);
    expect(s.teams.comet!.score).toBe(POINTS.collectible);
    expect(floats(r2)).toEqual([]);
  });

  it('a path that stays outside TILE*0.75 does not collect', () => {
    const s = competing(1000);
    s.collectibles.push({ id: 'c1', pos: SPOT });
    s.lastTickAt = 1000;
    const off = TILE * 0.75 + 1;
    s.motions.p06 = { path: [{ x: SPOT.x - 100, y: SPOT.y + off }, { x: SPOT.x + 100, y: SPOT.y + off }], startedAt: 1000 };
    run(s, { type: 'tick' }, 3000);
    expect(s.collectibles).toHaveLength(1);
  });
});

describe('scoring: riddles', () => {
  const near = (slot: number) => spawnFor(slot, 0);
  const ans = (i: number) => content.riddles[i]!.answers[0]!;

  it('riddle needs to be near own table', () => {
    const s = competing();
    expect(nearTable(near(1), 1)).toBe(true);
    place(s, 'p06', near(2)); // at comet's table, not pixel's
    const before = clone(s);
    expect(run(s, { type: 'riddleAnswer', playerId: 'p06', text: ans(0) }, 2000).error).toBeTruthy();
    expect(run(s, { type: 'riddleSkip', playerId: 'p06' }, 2000).error).toBeTruthy();
    expect(s).toEqual(before);
    // just inside reach of own table works
    const t = { x: 14 * TILE + 10, y: (6 + 2) * TILE + TABLE_REACH - 1 };
    place(s, 'p06', t);
    expect(run(s, { type: 'riddleAnswer', playerId: 'p06', text: ans(0) }, 2000).error).toBeUndefined();
    // riddles are competition-only
    const w = room();
    place(w, 'p06', near(1));
    expect(run(w, { type: 'riddleAnswer', playerId: 'p06', text: ans(0) }, 2000).error).toBeTruthy();
  });

  it('correct riddle +30 and next riddle sent to team only', () => {
    const s = competing();
    place(s, 'p07', near(1));
    const r = run(s, { type: 'riddleAnswer', playerId: 'p07', text: `  THE ${ans(0)}! ` }, 2000);
    expect(r.error).toBeUndefined();
    expect(s.teams.pixel!.score).toBe(POINTS.riddle);
    expect(s.teams.pixel!.riddleIndex).toBe(1);
    expect(r.out).toEqual([
      { to: 'all', msg: { type: 'float', teamId: 'pixel', text: '+30 riddle' } },
      { to: { team: 'pixel' }, msg: { type: 'riddle', index: 1, q: content.riddles[1]!.q, lockedUntil: 0 } },
    ]);
    expect(r.persist).toBe(true);
    expect(r.snapshot).toBe(true);

    // wrong answer
    const before = clone(s);
    const w = run(s, { type: 'riddleAnswer', playerId: 'p07', text: 'definitely not it' }, 2100);
    expect(w.error).toBe('Not quite, try again!');
    expect(s).toEqual(before);

    // last riddle: next q is null, and no more answers are accepted
    const last = content.riddles.length - 1;
    s.teams.pixel!.riddleIndex = last;
    const r2 = run(s, { type: 'riddleAnswer', playerId: 'p07', text: ans(last) }, 2200);
    expect(r2.out.find((o) => o.msg.type === 'riddle')).toEqual(
      { to: { team: 'pixel' }, msg: { type: 'riddle', index: last + 1, q: null, lockedUntil: 0 } },
    );
    expect(run(s, { type: 'riddleAnswer', playerId: 'p07', text: ans(0) }, 2300).error).toBeTruthy();
  });

  it('skip locks for 30 s', () => {
    const s = competing();
    place(s, 'p06', near(1));
    const r = run(s, { type: 'riddleSkip', playerId: 'p06' }, 2000);
    expect(r.error).toBeUndefined();
    expect(s.teams.pixel!.riddleIndex).toBe(1);
    expect(s.teams.pixel!.riddleLockedUntil).toBe(2000 + RIDDLE_SKIP_LOCK_MS);
    expect(s.teams.pixel!.score).toBe(0);
    expect(r.out).toEqual([
      { to: { team: 'pixel' }, msg: { type: 'riddle', index: 1, q: content.riddles[1]!.q, lockedUntil: 32000 } },
    ]);
    expect(r.persist).toBe(true);
    const before = clone(s);
    expect(run(s, { type: 'riddleAnswer', playerId: 'p07', text: ans(1) }, 31999).error).toBeTruthy();
    expect(run(s, { type: 'riddleSkip', playerId: 'p06' }, 31999).error).toBeTruthy();
    expect(s).toEqual(before);
    expect(run(s, { type: 'riddleAnswer', playerId: 'p06', text: ans(1) }, 32000).error).toBeUndefined();
    expect(s.teams.pixel!.riddleIndex).toBe(2);
  });
});

describe('scoring: quiz', () => {
  const Q = (s: GameState) => content.quiz[s.quiz!.questionIndex]!;

  it('host.quizStart sends the question without the answer to everyone', () => {
    const s = competing();
    s.nextQuizIndex = content.quiz.length; // wraps to 0
    const r = run(s, { type: 'host.quizStart' }, 2000);
    expect(r.error).toBeUndefined();
    expect(s.quiz).toEqual({ questionIndex: 0, endsAt: 2000 + QUIZ_MS, answers: {} });
    expect(s.nextQuizIndex).toBe(content.quiz.length + 1);
    expect(r.out).toEqual([
      { to: 'all', msg: { type: 'quiz', q: content.quiz[0]!.q, choices: content.quiz[0]!.choices, endsAt: 22000 } },
    ]);
    expect(r.persist).toBe(true);
    expect(r.snapshot).toBe(true);
    // warm-up refuses
    const w = room();
    const wb = clone(w);
    expect(run(w, { type: 'host.quizStart' }, 2000).error).toBeTruthy();
    expect(w).toEqual(wb);
  });

  it('quizStart while active errors', () => {
    const s = competing();
    run(s, { type: 'host.quizStart' }, 2000);
    const before = clone(s);
    expect(run(s, { type: 'host.quizStart' }, 3000).error).toBeTruthy();
    expect(s).toEqual(before);
  });

  it('quiz: second answer ignored; late answer ignored', () => {
    const s = competing();
    run(s, { type: 'host.quizStart' }, 2000);
    const c = Q(s).correct;
    const wrong = (c + 1) % Q(s).choices.length;
    expect(run(s, { type: 'quizAnswer', playerId: 'p06', choice: wrong }, 3000).error).toBeUndefined();
    const r2 = run(s, { type: 'quizAnswer', playerId: 'p06', choice: c }, 3100);
    expect(r2.error).toBeUndefined();
    expect(r2.out).toEqual([]);
    expect(s.quiz!.answers).toEqual({ p06: wrong });
    // at endsAt is too late
    run(s, { type: 'quizAnswer', playerId: 'p07', choice: c }, 2000 + QUIZ_MS);
    expect(s.quiz!.answers.p07).toBeUndefined();
    // departed team's answers are not recorded; bad choices error
    run(s, { type: 'quizAnswer', playerId: 'p01', choice: c }, 3200);
    expect(s.quiz!.answers.p01).toBeUndefined();
    const before = clone(s);
    expect(run(s, { type: 'quizAnswer', playerId: 'p08', choice: 99 }, 3300).error).toBeTruthy();
    expect(run(s, { type: 'quizAnswer', playerId: 'p08', choice: 0.5 }, 3300).error).toBeTruthy();
    expect(s).toEqual(before);

    const r = run(s, { type: 'tick' }, 2000 + QUIZ_MS);
    expect(s.quiz).toBeNull();
    expect(s.teams.pixel!.score).toBe(0);
    expect(r.out).toContainEqual({ to: 'all', msg: { type: 'quizResult', correct: c, perTeam: expect.objectContaining({ pixel: 0 }) } });
  });

  it('quiz points use percentage: 3 of 6 correct and 3 of 5 correct give 25 and 30', () => {
    const s = competing();
    run(s, { type: 'host.quizStart' }, 2000);
    const c = Q(s).correct;
    const wrong = (c + 1) % Q(s).choices.length;
    for (const id of ['p31', 'p32', 'p33']) run(s, { type: 'quizAnswer', playerId: id, choice: c }, 3000); // maple: 6
    run(s, { type: 'quizAnswer', playerId: 'p34', choice: wrong }, 3000);
    for (const id of ['p06', 'p07', 'p08']) run(s, { type: 'quizAnswer', playerId: id, choice: c }, 3000); // pixel: 5
    for (const id of members('comet')) run(s, { type: 'quizAnswer', playerId: id, choice: c }, 3000); // all 5

    const early = clone(s);
    run(s, { type: 'tick' }, 21999);
    expect(s.quiz).not.toBeNull();
    expect(s.teams.maple!.score).toBe(early.teams.maple!.score);

    const r = run(s, { type: 'tick' }, 22000);
    expect(s.quiz).toBeNull();
    expect(s.teams.maple!.score).toBe(25);
    expect(s.teams.pixel!.score).toBe(30);
    expect(s.teams.comet!.score).toBe(50);
    expect(s.teams.nova!.score).toBe(0);
    const res = r.out.find((o) => o.msg.type === 'quizResult')!;
    expect(res).toEqual({
      to: 'all',
      msg: { type: 'quizResult', correct: c, perTeam: { pixel: 30, comet: 50, mango: 0, koala: 0, nova: 0, maple: 25 } },
    });
    expect(floats(r)).toEqual(expect.arrayContaining([
      { type: 'float', teamId: 'maple', text: '+25 quiz' },
      { type: 'float', teamId: 'pixel', text: '+30 quiz' },
      { type: 'float', teamId: 'comet', text: '+50 quiz' },
    ]));
    expect(r.persist).toBe(true);
    expect(r.snapshot).toBe(true);
  });

  it('quiz denominator ignores departed teams', () => {
    const s = competing();
    run(s, { type: 'host.quizStart' }, 2000);
    const c = Q(s).correct;
    for (const id of members('pixel')) run(s, { type: 'quizAnswer', playerId: id, choice: c }, 3000);
    // comet: 2 correct of 5, then a non-answerer leaves → 2 of 4 online
    run(s, { type: 'quizAnswer', playerId: 'p11', choice: c }, 3000);
    run(s, { type: 'quizAnswer', playerId: 'p12', choice: c }, 3000);
    run(s, { type: 'disconnect', playerId: 'p15' }, 4000);
    // pixel departs mid-quiz
    s.teams.pixel!.status = 'departed';
    onTeamDeparted(s, 'pixel');
    const r = run(s, { type: 'tick' }, 22000);
    expect(s.teams.pixel!.score).toBe(0);
    expect(s.teams.comet!.score).toBe(25);
    const res = r.out.find((o) => o.msg.type === 'quizResult')!.msg as { perTeam: Record<string, number> };
    expect(res.perTeam).not.toHaveProperty('pixel');
    expect(res.perTeam).not.toHaveProperty('otter');
    expect(res.perTeam.comet).toBe(25);
  });

  it('quiz numerator counts only players still online at close: 2 correct of 5, one leaves → 1 of 4 → 13', () => {
    const s = competing();
    run(s, { type: 'host.quizStart' }, 2000);
    const c = Q(s).correct;
    run(s, { type: 'quizAnswer', playerId: 'p11', choice: c }, 3000);
    run(s, { type: 'quizAnswer', playerId: 'p12', choice: c }, 3000);
    run(s, { type: 'disconnect', playerId: 'p12' }, 4000); // a correct answerer leaves
    const r = run(s, { type: 'tick' }, 22000);
    expect(s.teams.comet!.score).toBe(Math.round((POINTS.quizMax * 1) / 4));
    expect(s.teams.comet!.score).toBe(13);
    const res = r.out.find((o) => o.msg.type === 'quizResult')!.msg as { perTeam: Record<string, number> };
    expect(res.perTeam.comet).toBe(13);
  });

  it('quiz does not close while paused; resume extends it', () => {
    const s = competing();
    run(s, { type: 'host.quizStart' }, 2000);
    run(s, { type: 'host.pause' }, 3000);
    run(s, { type: 'tick' }, 30000);
    expect(s.quiz).not.toBeNull();
    run(s, { type: 'host.resume' }, 33000); // endsAt 22000 → 52000
    run(s, { type: 'tick' }, 40000);
    expect(s.quiz).not.toBeNull();
    run(s, { type: 'tick' }, 52000);
    expect(s.quiz).toBeNull();
  });
});

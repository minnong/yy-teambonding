import { describe, it, expect } from 'vitest';
import {
  apply, createState, publicSnapshot, persistable, restore, slotOf, isPlayingTeam, activePlayers,
  type Ctx, type Result,
} from '@shared/game/index';
import type { Action } from '@shared/protocol';
import type { AvatarLook, GameState } from '@shared/types';
import { loadContent } from '@shared/content';
import { spawnFor, toWorld, isWalkable } from '@shared/layout';
import { positionAt } from '@shared/motion';

const content = loadContent();
const ctx = (now: number): Ctx => ({ now, rng: () => 0.5, content });
const run = (s: GameState, a: Action, now: number): Result => apply(s, a, ctx(now));
const LOOK: AvatarLook = { skin: 1, hair: 2, hairColor: 3, top: 0, topColor: 4, bottomsColor: 5, accessory: 1 };

function room(now = 1000, ids = ['p01', 'p06', 'p07']): GameState {
  const s = createState(content, now);
  for (const id of ids) run(s, { type: 'connect', playerId: id }, now);
  return s;
}
const clone = (s: GameState) => structuredClone(s);

describe('game core: players', () => {
  it('connect spawns at own table', () => {
    const s = createState(content, 1000);
    const r = run(s, { type: 'connect', playerId: 'p07' }, 1000);
    expect(r.error).toBeUndefined();
    expect(r.snapshot).toBe(true);
    expect(s.online.p07).toBe(true);
    // p07 is the 2nd pixel player; pixel is slot 1
    expect(slotOf(s, 'pixel')).toBe(1);
    expect(s.motions.p07).toEqual({ path: [spawnFor(1, 1)], startedAt: 1000 });
    // reconnect keeps the existing motion
    s.motions.p07 = { path: [{ x: 400, y: 400 }], startedAt: 1200 };
    run(s, { type: 'connect', playerId: 'p07' }, 2000);
    expect(s.motions.p07!.path[0]).toEqual({ x: 400, y: 400 });
  });

  it('connect for an unknown player errors without changing state', () => {
    const s = room();
    const before = clone(s);
    const r = run(s, { type: 'connect', playerId: 'nope' }, 2000);
    expect(r.error).toBeTruthy();
    expect(s).toEqual(before);
  });

  it('disconnect clears online and cancels open icebreakers, telling the other person', () => {
    const s = room();
    s.icebreakers.ib1 = { id: 'ib1', a: 'p01', b: 'p06', prompt: 0, answeredBy: null };
    s.icebreakers.ib2 = { id: 'ib2', a: 'p07', b: 'p02', prompt: 1, answeredBy: null };
    const r = run(s, { type: 'disconnect', playerId: 'p01' }, 2000);
    expect(s.online.p01).toBeFalsy();
    expect(s.icebreakers.ib1).toBeUndefined();
    expect(s.icebreakers.ib2).toBeDefined();
    expect(r.out).toEqual([{ to: { player: 'p06' }, msg: { type: 'icebreaker', card: null, closedReason: 'left' } }]);
    expect(r.snapshot).toBe(true);
  });

  it('addSelf creates a player in warm-up and refuses during competition', () => {
    const s = room();
    const r = run(s, { type: 'addSelf', name: '  Ana Lopez ', teamId: 'comet' }, 2000);
    expect(r.error).toBeUndefined();
    expect(r.addedPlayerId).toBe('x-ana-lopez-1');
    expect(s.players['x-ana-lopez-1']).toEqual({
      id: 'x-ana-lopez-1', name: 'Ana Lopez', teamId: 'comet', look: null, addedOnDay: true, removed: false,
    });
    expect(r.persist).toBe(true);
    expect(r.snapshot).toBe(true);
    // same slug in another team gets the smallest unused n
    const r2 = run(s, { type: 'addSelf', name: 'ana lopez!', teamId: 'mango' }, 2000);
    expect(r2.addedPlayerId).toBe('x-ana-lopez-2');

    expect(run(s, { type: 'addSelf', name: 'Bo', teamId: 'nope' }, 2000).error).toBeTruthy();
    expect(run(s, { type: 'addSelf', name: '   ', teamId: 'comet' }, 2000).error).toBeTruthy();
    expect(run(s, { type: 'addSelf', name: 'x'.repeat(25), teamId: 'comet' }, 2000).error).toBeTruthy();
    expect(run(s, { type: 'addSelf', name: 'x'.repeat(24), teamId: 'comet' }, 2000).error).toBeUndefined();

    run(s, { type: 'host.startCompetition' }, 3000);
    const before = clone(s);
    const r3 = run(s, { type: 'addSelf', name: 'Late Larry', teamId: 'comet' }, 4000);
    expect(r3.error).toBeTruthy();
    expect(s).toEqual(before);
  });

  it('addSelf refuses a duplicate name in the same team', () => {
    const s = room();
    const r = run(s, { type: 'addSelf', name: 'player 01', teamId: 'otter' }, 2000);
    expect(r.error).toBe('That name is already on the list');
    // same name on another team is fine
    expect(run(s, { type: 'addSelf', name: 'player 01', teamId: 'pixel' }, 2000).error).toBeUndefined();
  });

  it('move produces a motion message whose path starts at the current interpolated position', () => {
    const s = room();
    const start = s.motions.p01!.path[0]!;
    const target = toWorld(10, 25);
    const r1 = run(s, { type: 'move', playerId: 'p01', to: target }, 1000);
    expect(r1.snapshot).toBe(false);
    expect(r1.persist).toBe(false);
    const m1 = s.motions.p01!;
    expect(m1.path[0]).toEqual(start);
    expect(m1.path[m1.path.length - 1]).toEqual(target);
    expect(r1.out).toEqual([{ to: 'all', msg: { type: 'motion', playerId: 'p01', motion: m1 } }]);

    const mid = positionAt(m1, 1700);
    run(s, { type: 'move', playerId: 'p01', to: toWorld(20, 30) }, 1700);
    expect(s.motions.p01!.path[0]).toEqual(mid);
    expect(s.motions.p01!.startedAt).toBe(1700);
  });

  it('move while paused is ignored', () => {
    const s = room();
    run(s, { type: 'host.pause' }, 1500);
    const before = clone(s);
    const r = run(s, { type: 'move', playerId: 'p01', to: toWorld(10, 25) }, 2000);
    expect(r).toEqual({ out: [], persist: false, snapshot: false });
    expect(s).toEqual(before);
  });

  it('move/walk/stop from a departed team are ignored silently', () => {
    const s = room();
    run(s, { type: 'host.startCompetition' }, 1500); // otter departs
    const before = clone(s);
    for (const a of [
      { type: 'move', playerId: 'p01', to: toWorld(10, 25) },
      { type: 'walk', playerId: 'p01', dir: 'down' },
      { type: 'stop', playerId: 'p01' },
    ] as Action[]) {
      expect(run(s, a, 2000)).toEqual({ out: [], persist: false, snapshot: false });
    }
    expect(s).toEqual(before);
    // playing teams can still move
    expect(run(s, { type: 'move', playerId: 'p06', to: toWorld(10, 25) }, 2000).out).toHaveLength(1);
  });

  it('walk goes to the furthest walkable tile in a straight line', () => {
    const s = room();
    s.motions.p06 = { path: [toWorld(10, 25)], startedAt: 1000 };
    run(s, { type: 'walk', playerId: 'p06', dir: 'down' }, 1000);
    let path = s.motions.p06!.path;
    expect(path[path.length - 1]).toEqual(toWorld(10, 34)); // row 35 is wall
    s.motions.p06 = { path: [toWorld(10, 25)], startedAt: 1000 };
    run(s, { type: 'walk', playerId: 'p06', dir: 'up' }, 1000);
    path = s.motions.p06!.path;
    // column 10 is blocked by table 6 at rows 18-19, so up stops at row 20
    expect(isWalkable(10, 19)).toBe(false);
    expect(path[path.length - 1]).toEqual(toWorld(10, 20));
    s.motions.p06 = { path: [toWorld(10, 25)], startedAt: 1000 };
    run(s, { type: 'walk', playerId: 'p06', dir: 'left' }, 1000);
    path = s.motions.p06!.path;
    expect(path[path.length - 1]).toEqual(toWorld(1, 25));
    s.motions.p06 = { path: [toWorld(10, 25)], startedAt: 1000 };
    const r = run(s, { type: 'walk', playerId: 'p06', dir: 'right' }, 1000);
    path = s.motions.p06!.path;
    expect(path[path.length - 1]).toEqual(toWorld(22, 25));
    expect(r.out[0]!.msg.type).toBe('motion');
  });

  it('stop truncates the motion at the current position', () => {
    const s = room();
    run(s, { type: 'move', playerId: 'p01', to: toWorld(10, 25) }, 1000);
    const pos = positionAt(s.motions.p01!, 1600);
    const r = run(s, { type: 'stop', playerId: 'p01' }, 1600);
    expect(s.motions.p01).toEqual({ path: [pos], startedAt: 1600 });
    expect(r.out).toEqual([{ to: 'all', msg: { type: 'motion', playerId: 'p01', motion: s.motions.p01 } }]);
  });

  it('setLook rejects out-of-range indexes', () => {
    const s = room();
    const ok = run(s, { type: 'setLook', playerId: 'p01', look: LOOK }, 1000);
    expect(ok.error).toBeUndefined();
    expect(ok.persist).toBe(true);
    expect(ok.snapshot).toBe(true);
    expect(s.players.p01!.look).toEqual(LOOK);
    const before = clone(s);
    for (const bad of [
      { ...LOOK, skin: 6 }, { ...LOOK, top: 3 }, { ...LOOK, hairColor: -1 }, { ...LOOK, accessory: 1.5 },
      { ...LOOK, bottomsColor: 6 }, { ...LOOK, topColor: 8 }, { ...LOOK, hair: 6 },
    ]) {
      expect(run(s, { type: 'setLook', playerId: 'p01', look: bad }, 1000).error).toBeTruthy();
    }
    expect(s).toEqual(before);
  });

  it('emote with far target is rejected', () => {
    const s = room();
    // p01 at otter table, p06 at pixel table: far apart
    const r = run(s, { type: 'emote', playerId: 'p01', kind: 'wave', target: 'p06' }, 1000);
    expect(r.error).toBeTruthy();
    expect(r.out).toEqual([]);
    // near target works
    s.motions.p06 = { path: [{ x: s.motions.p01!.path[0]!.x + 40, y: s.motions.p01!.path[0]!.y }], startedAt: 0 };
    const ok = run(s, { type: 'emote', playerId: 'p01', kind: 'wave', target: 'p06' }, 1000);
    expect(ok.out).toEqual([{ to: 'all', msg: { type: 'emote', from: 'p01', kind: 'wave', target: 'p06' } }]);
    // untargeted, any phase
    expect(run(s, { type: 'emote', playerId: 'p01', kind: 'heart' }, 1000).out).toHaveLength(1);
    expect(run(s, { type: 'emote', playerId: 'p01', kind: 'dance' }, 1000).error).toBeTruthy();
    run(s, { type: 'host.pause' }, 1100);
    expect(run(s, { type: 'emote', playerId: 'p01', kind: 'heart' }, 1200).out).toEqual([]);
  });
});

describe('game core: phases', () => {
  it('startCompetition departs the goesFirst team as 1st, zeroes scores, emits youreUp and exact banner', () => {
    const s = room();
    s.teams.pixel!.score = 40;
    const r = run(s, { type: 'host.startCompetition' }, 5000);
    expect(r.error).toBeUndefined();
    expect(s.phase).toBe('competition');
    expect(s.competitionStartedAt).toBe(5000);
    expect(s.lastCallAt).toBe(5000);
    expect(s.teams.otter!.status).toBe('departed');
    expect(s.teams.otter!.departedOrder).toBe(1);
    expect(s.departures).toEqual(['otter']);
    for (const t of Object.values(s.teams)) {
      expect(t.score).toBe(0);
      expect(t.scoreChangedAt).toBe(5000);
    }
    expect(isPlayingTeam(s, 'otter')).toBe(false);
    expect(isPlayingTeam(s, 'pixel')).toBe(true);
    expect(r.out).toContainEqual({ to: { team: 'otter' }, msg: { type: 'youreUp', teamId: 'otter' } });
    expect(r.out).toContainEqual({
      to: 'all', msg: { type: 'banner', text: "🎉 Team Otter, you're up! Head to the next activity." },
    });
    expect(r.persist).toBe(true);
    expect(r.snapshot).toBe(true);
  });

  it('startCompetition twice errors', () => {
    const s = room();
    run(s, { type: 'host.startCompetition' }, 5000);
    const before = clone(s);
    const r = run(s, { type: 'host.startCompetition' }, 6000);
    expect(r.error).toBeTruthy();
    expect(r.out).toEqual([]);
    expect(s).toEqual(before);
  });

  it('pause freezes motions; resume shifts deadlines by paused duration', () => {
    const s = room();
    run(s, { type: 'host.startCompetition' }, 1000);
    run(s, { type: 'move', playerId: 'p06', to: toWorld(10, 25) }, 1000);
    const pos = positionAt(s.motions.p06!, 1800);
    s.nextCollectibleAt = 12_000;
    s.quiz = { questionIndex: 0, endsAt: 15_000, answers: {} };
    s.teams.pixel!.riddleLockedUntil = 20_000;
    const rp = run(s, { type: 'host.pause' }, 1800);
    expect(rp.out).toEqual([{ to: 'all', msg: { type: 'banner', text: 'Paused' } }]);
    expect(rp.persist).toBe(true);
    expect(s.paused).toBe(true);
    expect(s.pausedAt).toBe(1800);
    expect(s.motions.p06).toEqual({ path: [pos], startedAt: 1800 });
    expect(positionAt(s.motions.p06!, 9000)).toEqual(pos);
    expect(run(s, { type: 'host.pause' }, 1900).error).toBeTruthy();

    const rr = run(s, { type: 'host.resume' }, 6800);
    expect(rr.out).toEqual([{ to: 'all', msg: { type: 'banner', text: '' } }]);
    expect(rr.persist).toBe(true);
    expect(s.paused).toBe(false);
    expect(s.pausedAt).toBeNull();
    expect(s.nextCollectibleAt).toBe(17_000);
    expect(s.quiz!.endsAt).toBe(20_000);
    expect(s.teams.pixel!.riddleLockedUntil).toBe(25_000);
    expect(run(s, { type: 'host.resume' }, 6900).error).toBeTruthy();
  });

  it('reset restores the content roster, drops on-day additions, keeps roster looks, clears scores and departures', () => {
    const s = room();
    s.msgCount = { day: '2026-11-26', count: 77 };
    run(s, { type: 'setLook', playerId: 'p01', look: LOOK }, 1000);
    run(s, { type: 'addSelf', name: 'Zed', teamId: 'nova' }, 1000);
    run(s, { type: 'host.movePlayer', playerId: 'p02', teamId: 'maple' }, 1000);
    run(s, { type: 'host.removePlayer', playerId: 'p03' }, 1000);
    run(s, { type: 'host.startCompetition' }, 2000);
    s.teams.pixel!.score = 55;
    s.metPairs.push('p01|p06');
    const p06Motion = s.motions.p06;

    const r = run(s, { type: 'host.reset' }, 3000);
    expect(r.persist).toBe(true);
    expect(r.snapshot).toBe(true);
    const fresh = createState(content, 3000);
    expect(Object.keys(s.players)).toEqual(Object.keys(fresh.players));
    expect(s.players['x-zed-1']).toBeUndefined();
    expect(s.players.p02!.teamId).toBe('otter');
    expect(s.players.p03!.removed).toBe(false);
    expect(s.players.p01!.look).toEqual(LOOK);
    expect(s.phase).toBe('warmup');
    expect(s.departures).toEqual([]);
    expect(s.metPairs).toEqual([]);
    expect(s.lastCallAt).toBeNull();
    for (const t of Object.values(s.teams)) {
      expect(t.score).toBe(0);
      expect(t.status).toBe('playing');
    }
    expect(s.online).toEqual({ p01: true, p06: true, p07: true });
    expect(s.motions.p06).toEqual(p06Motion);
    expect(s.msgCount).toEqual({ day: '2026-11-26', count: 77 });
  });
});

describe('game core: roster host actions', () => {
  it('roster host actions only in warm-up', () => {
    const s = room();
    expect(run(s, { type: 'host.movePlayer', playerId: 'p01', teamId: 'pixel' }, 1000).error).toBeUndefined();
    expect(s.players.p01!.teamId).toBe('pixel');
    expect(run(s, { type: 'host.setGoesFirst', teamId: 'maple' }, 1000).error).toBeUndefined();
    expect(Object.values(s.teams).filter((t) => t.goesFirst).map((t) => t.id)).toEqual(['maple']);
    const rr = run(s, { type: 'host.removePlayer', playerId: 'p06' }, 1000);
    expect(rr.persist).toBe(true);
    expect(rr.snapshot).toBe(true);
    expect(s.players.p06!.removed).toBe(true);
    expect(s.online.p06).toBeFalsy();
    expect(s.motions.p06).toBeUndefined();
    expect(publicSnapshot(s, ctx(1000)).players.p06).toBeUndefined();
    expect(activePlayers(s, 'pixel')).toEqual(['p01', 'p07']);

    run(s, { type: 'host.startCompetition' }, 2000);
    expect(s.teams.maple!.status).toBe('departed');
    const before = clone(s);
    for (const a of [
      { type: 'host.movePlayer', playerId: 'p02', teamId: 'pixel' },
      { type: 'host.removePlayer', playerId: 'p02' },
      { type: 'host.setGoesFirst', teamId: 'otter' },
    ] as Action[]) {
      expect(run(s, a, 3000).error).toBe('Only before the competition starts');
    }
    expect(s).toEqual(before);
  });

  it('roster host actions validate ids', () => {
    const s = room();
    expect(run(s, { type: 'host.movePlayer', playerId: 'nope', teamId: 'pixel' }, 1000).error).toBeTruthy();
    expect(run(s, { type: 'host.movePlayer', playerId: 'p01', teamId: 'nope' }, 1000).error).toBeTruthy();
    expect(run(s, { type: 'host.setGoesFirst', teamId: 'nope' }, 1000).error).toBeTruthy();
    expect(run(s, { type: 'host.removePlayer', playerId: 'nope' }, 1000).error).toBeTruthy();
  });
});

describe('game core: dispatcher, snapshot and persistence', () => {
  it('actions owned by later tasks return an error and leave state unchanged', () => {
    const s = room();
    const before = clone(s);
    for (const a of [
      { type: 'icebreakerStart', playerId: 'p01', target: 'p06' },
      { type: 'riddleAnswer', playerId: 'p01', text: 'x' },
      { type: 'host.callNext', expectedTeamId: 'pixel' },
      { type: 'host.adjustScore', teamId: 'pixel', delta: 5 },
      { type: 'tick' },
    ] as Action[]) {
      const r = run(s, a, 2000);
      expect(r.error).toMatch(/not implemented/i);
      expect(r.out).toEqual([]);
    }
    expect(s).toEqual(before);
  });

  it('publicSnapshot has no secrets and includes serverNow and the active quiz question', () => {
    const s = room();
    s.quiz = { questionIndex: 2, endsAt: 9000, answers: { p01: 1 } };
    s.icebreakers.ib1 = { id: 'ib1', a: 'p01', b: 'p06', prompt: 3, answeredBy: null };
    const snap = publicSnapshot(s, ctx(4321));
    expect(snap.serverNow).toBe(4321);
    expect(snap.quizActive).toEqual({ q: content.quiz[2]!.q, choices: content.quiz[2]!.choices, endsAt: 9000 });
    expect(Object.keys(snap).sort()).toEqual([
      'collectibles', 'departures', 'lastCallAt', 'motions', 'online', 'paused', 'phase', 'players',
      'quizActive', 'serverNow', 'teamOrder', 'teams',
    ]);
    const json = JSON.stringify(snap);
    expect(json).not.toContain(content.icebreakers[3]!);
    expect(json).not.toContain('"answers"');
    expect(json).not.toContain('"correct"');
    expect(snap.online.p01).toBe(true);
    expect(snap.motions.p01).toEqual(s.motions.p01);
    // snapshot is a copy, not a live view
    snap.teams.pixel!.score = 999;
    expect(s.teams.pixel!.score).toBe(0);
  });

  it('persistable+restore round-trips everything except motions/online', () => {
    const s = room();
    run(s, { type: 'setLook', playerId: 'p01', look: LOOK }, 1000);
    run(s, { type: 'addSelf', name: 'Zed', teamId: 'nova' }, 1000);
    run(s, { type: 'host.startCompetition' }, 2000);
    s.teams.pixel!.score = 25;
    s.metPairs.push('p06|p11');
    s.collectibles.push({ id: 'c1', pos: { x: 100, y: 200 } });
    s.msgCount = { day: '2026-11-26', count: 9 };
    const saved = persistable(s);
    expect('motions' in saved).toBe(false);
    expect('online' in saved).toBe(false);
    expect('lastTickAt' in saved).toBe(false);
    const back = restore(JSON.parse(JSON.stringify(saved)), 9000);
    expect(back.motions).toEqual({});
    expect(back.online).toEqual({});
    expect(back.lastTickAt).toBe(9000);
    const { motions: _m, online: _o, lastTickAt: _l, ...rest } = s;
    const { motions: _m2, online: _o2, lastTickAt: _l2, ...rest2 } = back;
    expect(rest2).toEqual(rest);
    // reconnect recreates motion
    run(back, { type: 'connect', playerId: 'p01' }, 9000);
    expect(back.motions.p01!.path).toEqual([spawnFor(0, 0)]);
  });
});

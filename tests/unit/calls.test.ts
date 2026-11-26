import { describe, it, expect } from 'vitest';
import { apply, addPoints, createState, type Ctx, type Result } from '@shared/game/index';
import { nextLeader, ordinal } from '@shared/game/calls';
import type { Action } from '@shared/protocol';
import type { GameState, Vec } from '@shared/types';
import { loadContent } from '@shared/content';
import { spawnFor, toWorld } from '@shared/layout';
import { positionAt } from '@shared/motion';
import { POINTS } from '@shared/constants';

const content = loadContent();
const ctx = (now: number): Ctx => ({ now, rng: () => 0.5, content });
const run = (s: GameState, a: Action, now: number): Result => apply(s, a, ctx(now));
const clone = (s: GameState) => structuredClone(s);
const ALL = content.players.map((p) => p.id);
const STEPS = content.boss.steps;
const LEADER_CHANGED = 'The leader changed, check again';

// Roster: otter p01–p05 (goesFirst, slot 0), pixel p06–p10 (1), comet p11–p15 (2), mango p16–p20 (3),
// koala p21–p25 (4), nova p26–p30 (5), maple p31–p36 (6).
function room(now = 1000): GameState {
  const s = createState(content, now);
  for (const id of ALL) run(s, { type: 'connect', playerId: id }, now);
  return s;
}
/** Competition started at `now`; otter (goesFirst) has departed. Collectible spawning pushed far out. */
function competing(now = 1000): GameState {
  const s = room(now);
  run(s, { type: 'host.startCompetition' }, now);
  s.nextCollectibleAt = 1e12;
  return s;
}
const place = (s: GameState, id: string, pos: Vec, now = 0) => { s.motions[id] = { path: [pos], startedAt: now }; };
const callNext = (s: GameState, now: number) => run(s, { type: 'host.callNext', expectedTeamId: nextLeader(s)! }, now);
const banners = (r: Result) => r.out.filter((o) => o.msg.type === 'banner').map((o) => o.msg);
const bossMsgs = (r: Result) => r.out.filter((o) => o.msg.type === 'boss');
const playing = (s: GameState) => s.teamOrder.filter((id) => s.teams[id]!.status === 'playing');

/** Calls (by leader) until only maple is playing; scores are all 0 so teamOrder decides. */
function onlyMapleLeft(now = 1000): GameState {
  const s = competing(now);
  for (let i = 0; i < 5; i++) expect(callNext(s, now + (i + 1) * 1000).error).toBeUndefined();
  expect(playing(s)).toEqual(['maple']);
  return s;
}

describe('calls: nextLeader and ordinal', () => {
  it('nextLeader picks highest score', () => {
    const s = competing();
    s.teams.pixel!.score = 30;
    s.teams.comet!.score = 40;
    s.teams.nova!.score = 35;
    expect(nextLeader(s)).toBe('comet');
    // departed teams never lead, however high their score
    s.teams.otter!.score = 999;
    expect(nextLeader(s)).toBe('comet');
    // not during warm-up, and null once nobody is playing
    expect(nextLeader(room())).toBeNull();
    for (const t of Object.values(s.teams)) t.status = 'departed';
    expect(nextLeader(s)).toBeNull();
  });

  it('tie goes to team that reached the score first', () => {
    const s = competing();
    for (const id of ['pixel', 'mango', 'maple']) s.teams[id]!.score = 30;
    s.teams.pixel!.scoreChangedAt = 5000;
    s.teams.mango!.scoreChangedAt = 4000;
    s.teams.maple!.scoreChangedAt = 4500;
    expect(nextLeader(s)).toBe('mango');
    // same score at the same moment: lowest teamOrder index
    s.teams.maple!.scoreChangedAt = 4000;
    expect(nextLeader(s)).toBe('mango');
    s.teams.mango!.scoreChangedAt = 4500;
    expect(nextLeader(s)).toBe('maple');
    // all zero at the start: teamOrder decides (otter has gone, so pixel)
    expect(nextLeader(competing())).toBe('pixel');
  });

  it('ordinal 1..7', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(ordinal)).toEqual(['1ST', '2ND', '3RD', '4TH', '5TH', '6TH', '7TH']);
    expect([11, 12, 13, 21, 22, 23].map(ordinal)).toEqual(['11TH', '12TH', '13TH', '21ST', '22ND', '23RD']);
  });
});

describe('calls: host.callNext', () => {
  it('callNext departs the leader as 2ND with exact banner and youreUp', () => {
    const s = competing(1000);
    s.teams.koala!.score = 50;
    // an open icebreaker between koala and pixel closes when koala leaves
    s.icebreakers['ib-0'] = { id: 'ib-0', a: 'p21', b: 'p06', prompt: 0, answeredBy: null };
    const r = run(s, { type: 'host.callNext', expectedTeamId: 'koala' }, 300000);
    expect(r.error).toBeUndefined();
    const k = s.teams.koala!;
    expect(k.status).toBe('departed');
    expect(k.departedOrder).toBe(2);
    expect(ordinal(k.departedOrder!)).toBe('2ND');
    expect(k.score).toBe(50);
    expect(s.departures).toEqual(['otter', 'koala']);
    expect(s.lastCallAt).toBe(300000);
    expect(s.icebreakers).toEqual({});
    expect(r.out).toEqual([
      { to: { player: 'p21' }, msg: { type: 'icebreaker', card: null, closedReason: 'departed' } },
      { to: { player: 'p06' }, msg: { type: 'icebreaker', card: null, closedReason: 'departed' } },
      { to: { team: 'koala' }, msg: { type: 'youreUp', teamId: 'koala' } },
      { to: 'all', msg: { type: 'banner', text: "🎉 Team Koala, you're up! Head to the next activity." } },
    ]);
    expect(r.persist).toBe(true);
    expect(r.snapshot).toBe(true);
    // the next call gets 3RD
    s.teams.pixel!.score = 10;
    expect(run(s, { type: 'host.callNext', expectedTeamId: 'pixel' }, 400000).error).toBeUndefined();
    expect(s.teams.pixel!.departedOrder).toBe(3);
    expect(ordinal(s.teams.pixel!.departedOrder!)).toBe('3RD');
  });

  it('callNext with stale expectedTeamId is rejected', () => {
    const s = competing();
    s.teams.koala!.score = 50;
    const before = clone(s);
    for (const expectedTeamId of ['pixel', 'otter', 'nope', '']) {
      const r = run(s, { type: 'host.callNext', expectedTeamId }, 2000);
      expect(r.error).toBe(LEADER_CHANGED);
      expect(r.out).toEqual([]);
    }
    expect(s).toEqual(before);

    // nobody left to call: nextLeader is null, so any expectation is stale
    for (const t of Object.values(s.teams)) t.status = 'departed';
    const gone = clone(s);
    expect(run(s, { type: 'host.callNext', expectedTeamId: 'koala' }, 2000).error).toBe(LEADER_CHANGED);
    expect(s).toEqual(gone);
  });

  it('callNext errors in warm-up and while paused, leaving state unchanged', () => {
    const w = room();
    const wb = clone(w);
    expect(run(w, { type: 'host.callNext', expectedTeamId: 'pixel' }, 2000).error).toBeTruthy();
    expect(w).toEqual(wb);

    const s = competing();
    run(s, { type: 'host.pause' }, 2000);
    const before = clone(s);
    expect(run(s, { type: 'host.callNext', expectedTeamId: 'pixel' }, 3000).error).toBe('Paused');
    expect(s).toEqual(before);
  });

  it("departing stops the team's moving players where they are", () => {
    const s = competing(1000);
    s.teams.koala!.score = 50;
    const walk = { path: [toWorld(5, 25), toWorld(15, 25)], startedAt: 1000 };
    s.motions.p21 = structuredClone(walk);
    s.motions.p06 = structuredClone(walk); // another team: keeps walking
    expect(run(s, { type: 'host.callNext', expectedTeamId: 'koala' }, 2000).error).toBeUndefined();
    expect(s.motions.p21).toEqual({ path: [positionAt(walk, 2000)], startedAt: 2000 });
    expect(s.motions.p21!.path[0]).not.toEqual(walk.path[0]);
    expect(s.motions.p06).toEqual(walk);
  });

  it('startCompetition also stops the goesFirst team where they are', () => {
    const s = room(1000);
    const walk = { path: [toWorld(5, 25), toWorld(15, 25)], startedAt: 1000 };
    s.motions.p01 = structuredClone(walk);
    s.motions.p06 = structuredClone(walk);
    run(s, { type: 'host.startCompetition' }, 2000);
    expect(s.motions.p01).toEqual({ path: [positionAt(walk, 2000)], startedAt: 2000 });
    expect(s.motions.p06).toEqual(walk);
  });

  it('scores of departed teams are frozen', () => {
    const s = competing();
    s.teams.koala!.score = 50;
    s.teams.koala!.scoreChangedAt = 1500;
    run(s, { type: 'host.callNext', expectedTeamId: 'koala' }, 2000);
    expect(addPoints(s, 'koala', POINTS.riddle, 'riddle', 3000)).toEqual([]);
    expect(s.teams.koala!.score).toBe(50);
    expect(s.teams.koala!.scoreChangedAt).toBe(1500);
    // and a departed team cannot score through an activity either
    place(s, 'p21', spawnFor(4, 0));
    expect(run(s, { type: 'riddleAnswer', playerId: 'p21', text: content.riddles[0]!.answers[0]! }, 3000).error).toBeTruthy();
    expect(s.teams.koala!.score).toBe(50);
  });
});

describe('calls: host.undoCall', () => {
  it('undo restores last called team but never the goesFirst team', () => {
    const s = competing(1000);
    s.teams.koala!.score = 50;
    run(s, { type: 'host.callNext', expectedTeamId: 'koala' }, 300000);
    const r = run(s, { type: 'host.undoCall' }, 310000);
    expect(r.error).toBeUndefined();
    const k = s.teams.koala!;
    expect(k.status).toBe('playing');
    expect(k.departedOrder).toBeNull();
    expect(k.score).toBe(50);
    expect(s.departures).toEqual(['otter']);
    expect(banners(r)).toEqual([{ type: 'banner', text: 'Team Koala is back in the game!' }]);
    expect(r.snapshot).toBe(true);
    expect(r.persist).toBe(true);
    // koala can score again
    expect(addPoints(s, 'koala', 10, 'icebreaker', 320000)).not.toEqual([]);
    expect(k.score).toBe(60);
    expect(nextLeader(s)).toBe('koala');

    // goesFirst stays departed
    const before = clone(s);
    const r2 = run(s, { type: 'host.undoCall' }, 330000);
    expect(r2.error).toBe('Nothing to undo');
    expect(r2.out).toEqual([]);
    expect(s).toEqual(before);
    expect(s.teams.otter!.status).toBe('departed');
    expect(s.teams.otter!.departedOrder).toBe(1);

    // warm-up and paused refuse
    const w = room();
    const wb = clone(w);
    expect(run(w, { type: 'host.undoCall' }, 2000).error).toBeTruthy();
    expect(w).toEqual(wb);
    run(s, { type: 'host.callNext', expectedTeamId: 'koala' }, 340000);
    run(s, { type: 'host.pause' }, 341000);
    const paused = clone(s);
    expect(run(s, { type: 'host.undoCall' }, 342000).error).toBe('Paused');
    expect(s).toEqual(paused);
  });

  it('undo resets lastCallAt to previous call', () => {
    const s = competing(1000);
    s.teams.koala!.score = 50;
    s.teams.pixel!.score = 40;
    run(s, { type: 'host.callNext', expectedTeamId: 'koala' }, 300000);
    run(s, { type: 'host.callNext', expectedTeamId: 'pixel' }, 600000);
    expect(s.lastCallAt).toBe(600000);
    run(s, { type: 'host.undoCall' }, 700000);
    expect(s.lastCallAt).toBe(300000);
    expect(s.departures).toEqual(['otter', 'koala']);
    expect(s.teams.pixel!.status).toBe('playing');
    run(s, { type: 'host.undoCall' }, 710000);
    expect(s.lastCallAt).toBe(1000); // competitionStartedAt
    expect(s.departures).toEqual(['otter']);
    // a re-call after an undo takes the freed order and time
    run(s, { type: 'host.callNext', expectedTeamId: 'koala' }, 800000);
    expect(s.teams.koala!.departedOrder).toBe(2);
    expect(s.lastCallAt).toBe(800000);
  });
});

describe('calls: final boss', () => {
  it('last team standing gets FINAL BOSS banner and step 0', () => {
    const s = competing(1000);
    for (let i = 0; i < 4; i++) {
      const r = callNext(s, 2000 + i * 1000);
      expect(banners(r).map((b) => b.type === 'banner' && b.text)).not.toContain('FINAL BOSS: escape the lobby!');
      expect(bossMsgs(r)).toEqual([]);
    }
    expect(nextLeader(s)).toBe('nova');
    const r = callNext(s, 9000);
    expect(r.error).toBeUndefined();
    expect(playing(s)).toEqual(['maple']);
    expect(s.teams.nova!.departedOrder).toBe(6);
    expect(r.out).toContainEqual({ to: { team: 'nova' }, msg: { type: 'youreUp', teamId: 'nova' } });
    expect(banners(r)).toEqual([
      { type: 'banner', text: "🎉 Team Nova, you're up! Head to the next activity." },
      { type: 'banner', text: 'FINAL BOSS: escape the lobby!' },
    ]);
    expect(r.out).toContainEqual({ to: 'all', msg: { type: 'banner', text: 'FINAL BOSS: escape the lobby!' } });
    expect(bossMsgs(r)).toEqual([
      { to: { team: 'maple' }, msg: { type: 'boss', index: 0, q: STEPS[0]!.q, done: false } },
    ]);
  });

  it('boss chain completes with celebrate', () => {
    const s = onlyMapleLeft(1000);
    place(s, 'p31', spawnFor(6, 0));
    // wrong answer: riddle copy, nothing changes
    const before = clone(s);
    expect(run(s, { type: 'bossAnswer', playerId: 'p31', text: 'definitely not it' }, 20000).error).toBe('Not quite, try again!');
    expect(run(s, { type: 'bossAnswer', playerId: 'p31', text: 'x'.repeat(500) }, 20000).error).toBe('Not quite, try again!');
    expect(s).toEqual(before);
    // away from the table
    place(s, 'p32', toWorld(5, 25));
    const away = clone(s);
    expect(run(s, { type: 'bossAnswer', playerId: 'p32', text: STEPS[0]!.answers[0]! }, 20000).error).toBeTruthy();
    expect(s).toEqual(away);

    for (let i = 0; i < STEPS.length - 1; i++) {
      const r = run(s, { type: 'bossAnswer', playerId: 'p31', text: ` THE ${STEPS[i]!.answers[0]!}! ` }, 21000 + i);
      expect(r.error).toBeUndefined();
      expect(s.teams.maple!.bossIndex).toBe(i + 1);
      expect(r.out).toEqual([
        { to: { team: 'maple' }, msg: { type: 'boss', index: i + 1, q: STEPS[i + 1]!.q, done: false } },
      ]);
      expect(r.persist).toBe(true);
    }
    expect(s.teams.maple!.bossDone).toBe(false);
    const last = STEPS.length - 1;
    const r = run(s, { type: 'bossAnswer', playerId: 'p31', text: STEPS[last]!.answers.at(-1)! }, 30000);
    expect(r.error).toBeUndefined();
    expect(s.teams.maple!.bossDone).toBe(true);
    expect(s.teams.maple!.bossIndex).toBe(STEPS.length);
    expect(r.out).toEqual([
      { to: 'all', msg: { type: 'celebrate', teamId: 'maple' } },
      { to: { team: 'maple' }, msg: { type: 'boss', index: STEPS.length, q: null, done: true } },
    ]);
    expect(r.persist).toBe(true);
    expect(r.snapshot).toBe(true);
    // the boss gives no points
    expect(s.teams.maple!.score).toBe(0);

    // done: further answers error
    const done = clone(s);
    expect(run(s, { type: 'bossAnswer', playerId: 'p31', text: STEPS[0]!.answers[0]! }, 31000).error).toBeTruthy();
    expect(s).toEqual(done);
  });

  it('bossAnswer from a team when 2+ are playing is rejected', () => {
    const s = competing();
    place(s, 'p06', spawnFor(1, 0));
    const before = clone(s);
    const r = run(s, { type: 'bossAnswer', playerId: 'p06', text: STEPS[0]!.answers[0]! }, 2000);
    expect(r.error).toBeTruthy();
    expect(r.out).toEqual([]);
    expect(s).toEqual(before);
    // warm-up, unknown player, departed team and paused are refused too
    const w = room();
    place(w, 'p06', spawnFor(1, 0));
    const wb = clone(w);
    expect(run(w, { type: 'bossAnswer', playerId: 'p06', text: STEPS[0]!.answers[0]! }, 2000).error).toBeTruthy();
    expect(run(w, { type: 'bossAnswer', playerId: 'nope', text: STEPS[0]!.answers[0]! }, 2000).error).toBeTruthy();
    expect(w).toEqual(wb);
    const m = onlyMapleLeft();
    place(m, 'p26', spawnFor(5, 0)); // nova has departed
    place(m, 'p31', spawnFor(6, 0));
    run(m, { type: 'host.pause' }, 50000);
    const mb = clone(m);
    expect(run(m, { type: 'bossAnswer', playerId: 'p26', text: STEPS[0]!.answers[0]! }, 51000).error).toBeTruthy();
    expect(run(m, { type: 'bossAnswer', playerId: 'p31', text: STEPS[0]!.answers[0]! }, 51000).error).toBe('Paused');
    expect(m).toEqual(mb);
  });

  it('boss progress survives an undo', () => {
    const s = onlyMapleLeft(1000);
    place(s, 'p31', spawnFor(6, 0));
    run(s, { type: 'bossAnswer', playerId: 'p31', text: STEPS[0]!.answers[0]! }, 20000);
    run(s, { type: 'bossAnswer', playerId: 'p31', text: STEPS[1]!.answers[0]! }, 20100);
    expect(s.teams.maple!.bossIndex).toBe(2);

    const u = run(s, { type: 'host.undoCall' }, 21000);
    expect(u.error).toBeUndefined();
    expect(playing(s)).toEqual(['nova', 'maple']);
    expect(s.teams.maple!.bossIndex).toBe(2);
    // the boss is no longer active for maple
    expect(bossMsgs(u)).toEqual([{ to: { team: 'maple' }, msg: { type: 'boss', index: 2, q: null, done: false } }]);
    const before = clone(s);
    expect(run(s, { type: 'bossAnswer', playerId: 'p31', text: STEPS[2]!.answers[0]! }, 21100).error).toBeTruthy();
    expect(s).toEqual(before);

    // re-calling nova brings the boss back where maple left off
    const r = run(s, { type: 'host.callNext', expectedTeamId: 'nova' }, 22000);
    expect(banners(r)).toContainEqual({ type: 'banner', text: 'FINAL BOSS: escape the lobby!' });
    expect(bossMsgs(r)).toEqual([{ to: { team: 'maple' }, msg: { type: 'boss', index: 2, q: STEPS[2]!.q, done: false } }]);
    expect(run(s, { type: 'bossAnswer', playerId: 'p31', text: STEPS[2]!.answers[0]! }, 22100).error).toBeUndefined();
    expect(s.teams.maple!.bossIndex).toBe(3);
  });
});

import { describe, it, expect } from 'vitest';
import { BANNER_MIN_MS, BannerQueue, youreUpKey, youreUpMissed } from '../../src/client/ui/uiState';
import { moveHeldText, MOVE_HELD_NOTICE_MS } from '../../src/client/room/moveThrottle';
import { snapTapToSparkle, SPARKLE_DRAW_DY } from '../../src/client/room/sparkleTap';
import { rosterKey } from '../../src/client/join/namePicker';
import { NAME_TAKEN } from '@shared/game/players';
import { FINAL_BOSS_BANNER, upBanner } from '@shared/game/calls';
import type { PublicSnapshot } from '@shared/protocol';
import type { Player, Team } from '@shared/types';

const team = (id: string, extra: Partial<Team> = {}): Team => ({
  id, name: id[0]!.toUpperCase() + id.slice(1), color: '#fff', goesFirst: false, score: 0, scoreChangedAt: 0,
  status: 'playing', departedOrder: null, riddleIndex: 0, riddleLockedUntil: 0, bossIndex: 0, bossDone: false, ...extra,
});
const player = (id: string, teamId: string, name = id): Player => ({ id, name, teamId, look: null, addedOnDay: false, removed: false });
function snap(teams: Team[], players: Player[] = [], over: Partial<PublicSnapshot> = {}): PublicSnapshot {
  return {
    phase: 'competition', paused: false, teamOrder: teams.map((t) => t.id),
    teams: Object.fromEntries(teams.map((t) => [t.id, t])), players: Object.fromEntries(players.map((p) => [p.id, p])),
    motions: {}, online: {}, collectibles: [], departures: [], lastCallAt: null, quizActive: null, serverNow: 0, ...over,
  };
}

describe('banner queue (M2): the FINAL BOSS banner no longer wipes "you\'re up"', () => {
  it('a second banner waits until the first has shown for at least BANNER_MIN_MS', () => {
    const q = new BannerQueue();
    const up = upBanner('Comet');
    q.push(up, 6000, 0);
    q.push(FINAL_BOSS_BANNER, 6000, 0); // sent back to back by callNext
    expect(q.current(0)).toBe(up);
    expect(q.nextChangeAt()).toBe(BANNER_MIN_MS);
    expect(q.current(BANNER_MIN_MS - 1)).toBe(up);
    expect(q.current(BANNER_MIN_MS)).toBe(FINAL_BOSS_BANNER);
    expect(q.nextChangeAt()).toBe(BANNER_MIN_MS + 6000);
    expect(q.current(BANNER_MIN_MS + 6000)).toBeNull();
    expect(q.nextChangeAt()).toBeNull();
  });

  it('a lone banner keeps its full time; a late second one cuts the first short at once', () => {
    const q = new BannerQueue();
    q.push('a', 6000, 0);
    expect(q.nextChangeAt()).toBe(6000);
    q.push('b', 6000, 5000);
    expect(q.current(5000)).toBe('b');
    expect(q.nextChangeAt()).toBe(11000);
  });

  it('drops duplicates, keeps at most 3 waiting, and clear() empties it', () => {
    const q = new BannerQueue();
    q.push('a', 6000, 0);
    q.push('a', 6000, 0);
    for (const t of ['b', 'c', 'd', 'e']) q.push(t, 6000, 0);
    const seen: string[] = [];
    for (let now = 0; now < 60_000; now += 100) { const c = q.current(now); if (c && seen.at(-1) !== c) seen.push(c); }
    expect(seen).toEqual(['a', 'c', 'd', 'e']);
    q.push('x', 6000, 70_000);
    q.clear();
    expect(q.current(70_000)).toBeNull();
  });
});

describe('"You\'re up!" for a phone that slept through the call (M7)', () => {
  it('shows once when my team departed and this call was not seen', () => {
    const s = snap([team('otter', { status: 'departed', departedOrder: 1 }), team('comet', { status: 'departed', departedOrder: 2 })],
      [player('p01', 'comet')], { departures: ['otter', 'comet'] });
    const seen = new Set<string>();
    expect(youreUpMissed(s, 'p01', seen)).toBe(youreUpKey('comet', 2));
    seen.add(youreUpKey('comet', 2));
    expect(youreUpMissed(s, 'p01', seen)).toBeNull();
  });
  it('nothing while my team plays, in warm-up, or for an unknown player', () => {
    const s = snap([team('comet')], [player('p01', 'comet')]);
    expect(youreUpMissed(s, 'p01', new Set())).toBeNull();
    expect(youreUpMissed({ ...s, phase: 'warmup' }, 'p01', new Set())).toBeNull();
    expect(youreUpMissed(s, 'nobody', new Set())).toBeNull();
  });
});

describe('held move feedback (T12)', () => {
  it('says nothing for a short wait, and how long for a long one', () => {
    expect(MOVE_HELD_NOTICE_MS).toBe(2000);
    expect(moveHeldText(1000)).toBeNull();
    expect(moveHeldText(2000)).toBeNull();
    expect(moveHeldText(2001)).toBe('Slow down a little! You will walk there in 3 s 🙂');
    expect(moveHeldText(41_500)).toBe('Slow down a little! You will walk there in 42 s 🙂');
  });
});

describe('sparkle taps (M1)', () => {
  const c = [{ id: 'c1', pos: { x: 400, y: 304 } }];
  it('a tap on the drawn sprite (above its tile) walks to the sparkle itself', () => {
    expect(SPARKLE_DRAW_DY).toBe(-12);
    expect(snapTapToSparkle({ x: 402, y: 304 - 12 - 4 }, c, 1)).toEqual({ x: 400, y: 304 });
    expect(snapTapToSparkle({ x: 400, y: 304 - 30 }, c, 1)).toEqual({ x: 400, y: 304 }); // the tile above
  });
  it('taps elsewhere are unchanged; the radius is at least 22 CSS px at any zoom', () => {
    expect(snapTapToSparkle({ x: 460, y: 304 }, c, 1)).toBeNull();
    expect(snapTapToSparkle({ x: 440, y: 292 }, c, 1)).toBeNull();
    expect(snapTapToSparkle({ x: 440, y: 292 }, c, 0.5)).toEqual({ x: 400, y: 304 }); // zoomed out: 44 world px
  });
  it('picks the nearest of two', () => {
    const two = [...c, { id: 'c2', pos: { x: 420, y: 304 } }];
    expect(snapTapToSparkle({ x: 418, y: 292 }, two, 1)).toEqual({ x: 420, y: 304 });
  });
});

describe('name picker roster (T9 newcomer lockout)', () => {
  it('rosterKey changes when a name is added, moved or removed, not on other changes', () => {
    const a = snap([team('otter'), team('comet')], [player('p01', 'otter', 'Ana')]);
    const k = rosterKey(a);
    expect(rosterKey({ ...a, serverNow: 99, online: { p01: true } })).toBe(k);
    expect(rosterKey(snap([team('otter'), team('comet')], [player('p01', 'otter', 'Ana'), player('x-zed-1', 'comet', 'Zed')]))).not.toBe(k);
    expect(rosterKey(snap([team('otter'), team('comet')], [player('p01', 'comet', 'Ana')]))).not.toBe(k);
  });
  it('the server error the picker reacts to is exported', () => {
    expect(NAME_TAKEN).toBe('That name is already on the list');
  });
});

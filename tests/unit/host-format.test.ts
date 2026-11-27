import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { Heartbeat } from '../../src/client/heartbeat';
import {
  budgetLevel, budgetPercent, budgetText, buttonStates, callConfirmText, callTimerState, formatElapsed,
  leaderboardRows, nextUpText, sinceLastCall, teamCountText, undoTarget, type HostState,
  guardUntil, isLocked, MODAL_GUARD_MS, REPLY_COOLDOWN_MS, type Guard,
} from '../../src/client/host/hostModel';
import { CALL_AMBER_MS, CALL_GREEN_MS, MESSAGE_BUDGET } from '@shared/constants';
import type { PublicSnapshot } from '@shared/protocol';
import type { Team } from '@shared/types';

const team = (id: string, score: number, extra: Partial<Team> = {}): Team => ({
  id, name: id[0]!.toUpperCase() + id.slice(1), color: '#fff', goesFirst: false, score, scoreChangedAt: 0,
  status: 'playing', departedOrder: null, riddleIndex: 0, riddleLockedUntil: 0, bossIndex: 0, bossDone: false, ...extra,
});

function snap(over: Partial<PublicSnapshot> = {}, teams: Team[] = [
  team('otter', 0, { goesFirst: true }), team('pixel', 0), team('comet', 0),
]): PublicSnapshot {
  return {
    epoch: 'e-test', phase: 'warmup', paused: false, teamOrder: teams.map((t) => t.id),
    teams: Object.fromEntries(teams.map((t) => [t.id, t])), players: {}, motions: {}, online: {},
    collectibles: [], departures: [], lastCallAt: null, quizActive: null, serverNow: 0, ...over,
  };
}

function hs(s: PublicSnapshot, over: Partial<HostState> = {}): HostState {
  return {
    type: 'hostState', snapshot: s, msgCount: 0, lastCallAt: s.lastCallAt, nextLeader: null,
    connectedPerTeam: Object.fromEntries(s.teamOrder.map((id) => [id, { online: 0, total: 5 }])), ...over,
  };
}

/** Competition: otter went first, pixel was called second; comet and koala still playing. */
function competition(over: Partial<PublicSnapshot> = {}): PublicSnapshot {
  return snap({ phase: 'competition', departures: ['otter', 'pixel'], lastCallAt: 1000, ...over }, [
    team('otter', 0, { goesFirst: true, status: 'departed', departedOrder: 1 }),
    team('pixel', 120, { status: 'departed', departedOrder: 2 }),
    team('comet', 40), team('koala', 210),
  ]);
}

describe('callTimerState', () => {
  const t0 = 1_000_000;
  it('4:29 normal, 4:30 amber, 5:00 green', () => {
    expect(callTimerState(t0, t0 + 4 * 60_000 + 29_000)).toBe('normal');
    expect(callTimerState(t0, t0 + 4 * 60_000 + 30_000)).toBe('amber');
    expect(callTimerState(t0, t0 + 4 * 60_000 + 59_999)).toBe('amber');
    expect(callTimerState(t0, t0 + 5 * 60_000)).toBe('green');
    expect(callTimerState(t0, t0 + 12 * 60_000)).toBe('green');
  });
  it('uses the shared thresholds and is normal before the competition', () => {
    expect(CALL_AMBER_MS).toBe(270_000);
    expect(CALL_GREEN_MS).toBe(300_000);
    expect(callTimerState(t0, t0 + CALL_AMBER_MS - 1)).toBe('normal');
    expect(callTimerState(null, t0)).toBe('normal');
  });
});

describe('formatElapsed', () => {
  it('formats m:ss', () => {
    expect(formatElapsed(65000)).toBe('1:05');
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(59_999)).toBe('0:59');
    expect(formatElapsed(5 * 60_000)).toBe('5:00');
    expect(formatElapsed(61 * 60_000 + 9_000)).toBe('61:09');
  });
  it('never shows a negative time (clock skew)', () => {
    expect(formatElapsed(-4000)).toBe('0:00');
  });
  it('sinceLastCall shows a dash before the competition', () => {
    expect(sinceLastCall(null, 5000)).toBe('—');
    expect(sinceLastCall(1000, 66_000)).toBe('1:05');
  });
});

describe('callConfirmText', () => {
  it('is the verbatim copy with the name in upper case', () => {
    expect(callConfirmText({ name: 'Pixel', score: 210 })).toBe('This will call TEAM PIXEL (210 pts)');
    expect(callConfirmText({ name: 'Nova', score: 0 })).toBe('This will call TEAM NOVA (0 pts)');
  });
  it('nextUpText names the leader or shows a dash', () => {
    expect(nextUpText({ id: 'pixel', name: 'Pixel', score: 210 })).toBe('Next up: PIXEL · 210 pts');
    expect(nextUpText(null)).toBe('Next up: —');
  });
});

describe('undoTarget', () => {
  it('is the last departure when it is not the goesFirst team', () => {
    expect(undoTarget(competition())?.id).toBe('pixel');
  });
  it('is null when only the goesFirst team has gone, or in warm-up', () => {
    expect(undoTarget(competition({ departures: ['otter'] }))).toBeNull();
    expect(undoTarget(snap())).toBeNull();
  });
});

describe('message budget', () => {
  it('percentage of MESSAGE_BUDGET', () => {
    expect(MESSAGE_BUDGET).toBe(30000);
    expect(budgetPercent(15000)).toBe(50);
    expect(budgetPercent(0)).toBe(0);
  });
  it('turns red above 80%', () => {
    expect(budgetLevel(24000)).toBe('ok');
    expect(budgetLevel(24001)).toBe('red');
  });
  it('footer text with thousands separators', () => {
    expect(budgetText(1234)).toBe('Messages today: 1,234 / 30,000 budget');
  });
});

describe('teamCountText and leaderboardRows', () => {
  it('"Pixel 5/5"', () => {
    expect(teamCountText('Pixel', { online: 5, total: 5 })).toBe('Pixel 5/5');
    expect(teamCountText('Pixel', undefined)).toBe('Pixel 0/0');
  });
  it('ranks playing teams by score, then departed teams in order as ✅ {ordinal} {name}', () => {
    const rows = leaderboardRows(hs(competition()));
    expect(rows.map((r) => r.kind)).toEqual(['playing', 'playing', 'departed', 'departed']);
    expect(rows.map((r) => r.teamId)).toEqual(['koala', 'comet', 'otter', 'pixel']);
    expect(rows[0]!.rank).toBe(1);
    expect(rows[0]!.score).toBe(210);
    expect(rows[2]!.label).toBe('✅ 1ST Otter');
    expect(rows[3]!.label).toBe('✅ 2ND Pixel');
    expect(rows[0]!.label).toBe('Koala');
    expect(rows[0]!.count).toBe('0/5');
  });
  it('ties keep team order', () => {
    const rows = leaderboardRows(hs(snap()));
    expect(rows.map((r) => r.teamId)).toEqual(['otter', 'pixel', 'comet']);
  });
});

describe('buttonStates', () => {
  it('nothing is enabled before the first hostState', () => {
    const b = buttonStates(null, false);
    expect(b.start || b.callNext || b.quiz || b.undo || b.pause || b.resume || b.adjust || b.reset || b.people).toBe(false);
  });
  it('warm-up: start and people enabled, call/quiz/undo disabled', () => {
    const b = buttonStates(hs(snap()), false);
    expect(b).toMatchObject({ start: true, callNext: false, quiz: false, undo: false, people: true, reset: true });
    expect(b.showPause).toBe(true);
  });
  it('competition: call next needs a leader; start and people disabled', () => {
    const s = competition();
    const b = buttonStates(hs(s, { nextLeader: { id: 'koala', name: 'Koala', score: 210 } }), false);
    expect(b).toMatchObject({ start: false, callNext: true, quiz: true, undo: true, people: false, adjust: true });
    expect(b.undoLabel).toBe('Undo last call (bring back PIXEL)');
    expect(buttonStates(hs(s), false).callNext).toBe(false);
  });
  it('quiz is disabled while a quiz is active', () => {
    const s = competition({ quizActive: { q: 'q', choices: ['a', 'b'], endsAt: 5 } });
    expect(buttonStates(hs(s, { nextLeader: { id: 'koala', name: 'Koala', score: 210 } }), false).quiz).toBe(false);
  });
  it('paused: shows resume instead of pause, call next and quiz disabled, undo still allowed', () => {
    const s = competition({ paused: true });
    const b = buttonStates(hs(s, { nextLeader: { id: 'koala', name: 'Koala', score: 210 } }), false);
    expect(b.showPause).toBe(false);
    expect(b).toMatchObject({ resume: true, callNext: false, quiz: false, undo: true });
  });
  it('a pending call disables every host button', () => {
    const s = competition();
    const b = buttonStates(hs(s, { nextLeader: { id: 'koala', name: 'Koala', score: 210 } }), true);
    expect(b.start || b.callNext || b.quiz || b.undo || b.pause || b.resume || b.adjust || b.reset || b.people).toBe(false);
  });
  it('undo label when there is nothing to undo', () => {
    expect(buttonStates(hs(snap()), false).undoLabel).toBe('Undo last call');
  });
});

describe('action guard timing (fix round 1)', () => {
  const base: Guard = { pending: false, connected: true, lastReplyAt: null, modalChangedAt: null };
  it('a second tap 150 ms after the first is swallowed even when the reply came back at 60 ms', () => {
    // tap 1 at t=1000 sends; the reply lands at 1060; tap 2 at 1150 (a real double-tap gap)
    const g: Guard = { ...base, lastReplyAt: 1060 };
    expect(isLocked(g, 1150)).toBe(true);
    expect(isLocked(g, 1060 + REPLY_COOLDOWN_MS - 1)).toBe(true);
    expect(isLocked(g, 1060 + REPLY_COOLDOWN_MS)).toBe(false);
    expect(REPLY_COOLDOWN_MS).toBeGreaterThanOrEqual(500);
  });
  it('taps are swallowed for ~400 ms after a modal opens or closes', () => {
    const g: Guard = { ...base, modalChangedAt: 2000 };
    expect(isLocked(g, 2150)).toBe(true);
    expect(isLocked(g, 2000 + MODAL_GUARD_MS - 1)).toBe(true);
    expect(isLocked(g, 2000 + MODAL_GUARD_MS)).toBe(false);
    expect(MODAL_GUARD_MS).toBeGreaterThanOrEqual(400);
  });
  it('locked while a send is pending or the socket is not open', () => {
    expect(isLocked({ ...base, pending: true }, 1e9)).toBe(true);
    expect(isLocked({ ...base, connected: false }, 1e9)).toBe(true);
    expect(isLocked(base, 0)).toBe(false);
  });
  it('guardUntil is when the timing lock ends (to schedule a re-render)', () => {
    expect(guardUntil(base)).toBe(0);
    expect(guardUntil({ ...base, lastReplyAt: 1000, modalChangedAt: 1300 })).toBe(Math.max(1000 + REPLY_COOLDOWN_MS, 1300 + MODAL_GUARD_MS));
  });
});

describe('Heartbeat (fix round 1)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it('pings every interval and reports a miss when no pong comes within the deadline', () => {
    const pings: number[] = [];
    let misses = 0;
    const hb = new Heartbeat(() => { pings.push(Date.now()); return true; }, () => { misses++; }, 15000, 5000);
    hb.start();
    vi.advanceTimersByTime(14999);
    expect(pings).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(pings).toHaveLength(1);
    hb.pong();
    vi.advanceTimersByTime(5000);
    expect(misses).toBe(0);
    vi.advanceTimersByTime(10000); // second ping, unanswered
    expect(pings).toHaveLength(2);
    vi.advanceTimersByTime(4999);
    expect(misses).toBe(0);
    vi.advanceTimersByTime(1);
    expect(misses).toBe(1);
    hb.stop();
    vi.advanceTimersByTime(60000);
    expect(pings).toHaveLength(2);
  });
  it('probe() pings once now; a second probe waits for the outstanding one (I3)', () => {
    let pings = 0, misses = 0;
    const hb = new Heartbeat(() => { pings++; return true; }, () => { misses++; }, 15000, 5000);
    hb.probe();
    hb.probe();
    expect(pings).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(misses).toBe(1);
    hb.probe();
    hb.pong();
    vi.advanceTimersByTime(60000);
    expect(pings).toBe(2);
    expect(misses).toBe(1); // no interval was started by probe()
  });
  it('a ping that could not be sent (socket not open) sets no deadline', () => {
    let misses = 0;
    const hb = new Heartbeat(() => false, () => { misses++; }, 1000, 500);
    hb.start();
    vi.advanceTimersByTime(5000);
    expect(misses).toBe(0);
    hb.stop();
  });
});

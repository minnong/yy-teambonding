import { describe, it, expect } from 'vitest';
import { PendingGuard, PENDING_MS, quizKey, quizStillOpen, quizToShow } from '../../src/client/ui/uiState';
import { AnsweredQuizzes } from '../../src/client/ui/store';
import type { PublicSnapshot } from '@shared/protocol';
import type { Team } from '@shared/types';

const team = (id: string, extra: Partial<Team> = {}): Team => ({
  id, name: id, color: '#123456', goesFirst: false, score: 0, scoreChangedAt: 0, status: 'playing',
  departedOrder: null, riddleIndex: 0, riddleLockedUntil: 0, bossIndex: 0, bossDone: false, ...extra,
});
const quiz = { q: 'Capital?', choices: ['A', 'B', 'C', 'D'], endsAt: 50_000 };
function snap(extra: Partial<PublicSnapshot> = {}): PublicSnapshot {
  return {
    epoch: 'e-test', phase: 'competition', paused: false, teamOrder: ['pixel', 'otter'],
    teams: { pixel: team('pixel'), otter: team('otter') },
    players: { me: { id: 'me', name: 'Mia', teamId: 'pixel', look: null, addedOnDay: false, removed: false } },
    motions: {}, online: { me: true }, collectibles: [], departures: [], lastCallAt: null,
    quizActive: quiz, serverNow: 0, ...extra,
  };
}

describe('pending guard for one-shot sends', () => {
  it('a second tap while pending sends nothing', () => {
    const g = new PendingGuard();
    const sent: string[] = [];
    const tap = (now: number) => { if (g.begin('card', now)) sent.push('icebreakerAnswered'); };
    tap(0);
    tap(100);
    tap(PENDING_MS - 1);
    expect(sent).toEqual(['icebreakerAnswered']);
    expect(g.pending('card', 100)).toBe(true);
  });
  it('the matching reply clears it, so the next tap sends', () => {
    const g = new PendingGuard();
    expect(g.begin('riddle', 0)).toBe(true);
    expect(g.begin('riddle', 10)).toBe(false);
    g.clear('riddle');
    expect(g.pending('riddle', 20)).toBe(false);
    expect(g.begin('riddle', 20)).toBe(true);
  });
  it('a lost reply frees the button after the ~3 s safety timeout', () => {
    const g = new PendingGuard();
    expect(PENDING_MS).toBeGreaterThanOrEqual(2500);
    expect(PENDING_MS).toBeLessThanOrEqual(3500);
    g.begin('riddle', 1000);
    expect(g.begin('riddle', 1000 + PENDING_MS - 1)).toBe(false);
    expect(g.pending('riddle', 1000 + PENDING_MS)).toBe(false);
    expect(g.begin('riddle', 1000 + PENDING_MS)).toBe(true);
  });
  it('keys are independent', () => {
    const g = new PendingGuard();
    g.begin('card', 0);
    expect(g.begin('riddle', 0)).toBe(true);
    g.clear('card');
    expect(g.pending('riddle', 1)).toBe(true);
  });
});

describe('open quiz modal closes when it no longer applies', () => {
  it('stays while my team plays and the same quiz is active', () => {
    expect(quizStillOpen(snap(), 'me', 50_000, 40_000)).toBe(true);
  });
  it('closes when my team departs', () => {
    const gone = snap({ teams: { pixel: team('pixel', { status: 'departed', departedOrder: 1 }), otter: team('otter') } });
    expect(quizStillOpen(gone, 'me', 50_000, 40_000)).toBe(false);
  });
  it('closes when the quiz ended, changed, or expired', () => {
    expect(quizStillOpen(snap({ quizActive: null }), 'me', 50_000, 40_000)).toBe(false);
    expect(quizStillOpen(snap({ quizActive: { ...quiz, endsAt: 90_000 } }), 'me', 50_000, 40_000)).toBe(false);
    expect(quizStillOpen(snap(), 'me', 50_000, 50_000)).toBe(false);
  });
});

describe('answered quizzes survive a reload', () => {
  const fakeStorage = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
  };
  it('keys a quiz by endsAt and question', () => {
    expect(quizKey(quiz)).toBe('50000|Capital?');
    expect(quizKey({ ...quiz, q: 'Other?' })).not.toBe(quizKey(quiz));
  });
  it('an answer saved in one page load is seen by the next', () => {
    const storage = fakeStorage();
    new AnsweredQuizzes(() => storage).add(quizKey(quiz));
    const next = new AnsweredQuizzes(() => storage);
    expect(next.has(quizKey(quiz))).toBe(true);
    expect(quizToShow(snap(), 'me', next, 40_000)).toBeNull();
  });
  it('falls back to memory when storage throws', () => {
    const broken = () => { throw new Error('denied'); };
    const a = new AnsweredQuizzes(broken);
    a.add('k');
    expect(a.has('k')).toBe(true);
  });
  it('ignores corrupt stored data', () => {
    const storage = fakeStorage();
    storage.setItem('lobby.quizAnswered', '{not json');
    expect(new AnsweredQuizzes(() => storage).has('x')).toBe(false);
  });
});

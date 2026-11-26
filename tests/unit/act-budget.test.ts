import { describe, it, expect } from 'vitest';
import {
  ActBudget, ACT_CAP, ACT_RESERVED, ACT_WINDOW_MS, RESERVED_TYPES, SESSION_WORST_CASE,
  JOIN_LOOK_MAX, JOIN_LOOK_WINDOW_MS,
} from '../../src/client/actBudget';

const MIN = 60_000;

describe('ActBudget (R28)', () => {
  it('constants: 20 acts per rolling 60 s, 3 of them reserved for quiz answers and confirms', () => {
    expect(ACT_CAP).toBe(20);
    expect(ACT_WINDOW_MS).toBe(MIN);
    expect(ACT_RESERVED).toBe(3);
    expect([...RESERVED_TYPES].sort()).toEqual(['icebreakerConfirm', 'quizAnswer']);
    // 36 players × 36 window positions in 35 min × 20, plus joins (216), the cap-exempt
    // join looks (36 × 3 = 108, I1) and the host (50)
    expect(SESSION_WORST_CASE).toBe(36 * 36 * 20 + 216 + 36 * JOIN_LOOK_MAX + 50);
    expect(SESSION_WORST_CASE).toBe(26_294);
    expect(SESSION_WORST_CASE).toBeLessThanOrEqual(27_000);
  });

  it('the cap holds over 35 minutes of spam of every kind', () => {
    const b = new ActBudget();
    const kinds = ['move', 'emote', 'icebreakerStart', 'icebreakerAnswered', 'icebreakerConfirm', 'icebreakerCancel',
      'riddleAnswer', 'riddleSkip', 'bossAnswer', 'quizAnswer', 'setLook', 'walk', 'stop'] as const;
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const sent: number[] = [];
    for (let now = 0; now <= 35 * MIN; now += 50) {
      const k = kinds[Math.floor(rnd() * kinds.length)]!;
      if (b.take(k, now)) sent.push(now);
    }
    expect(sent.length).toBeLessThanOrEqual(36 * ACT_CAP); // every 60 s window position in [0, 35 min]
    expect(sent.length).toBeGreaterThan(30 * ACT_CAP);     // and the cap is not starving play
    // Any rolling 60 s: at most the cap, plus one prepaid stop whose walk was charged earlier.
    for (let i = 0; i + ACT_CAP + 1 < sent.length; i++) expect(sent[i + ACT_CAP + 1]! - sent[i]!).toBeGreaterThanOrEqual(MIN);
  });

  it('a player who spammed emotes can still answer the quiz and confirm an icebreaker', () => {
    const b = new ActBudget();
    let emotes = 0;
    for (let t = 0; t < 10_000; t += 100) if (b.take('emote', t)) emotes++;
    expect(emotes).toBe(ACT_CAP - ACT_RESERVED);
    expect(b.take('move', 10_000)).toBe(false);
    expect(b.take('quizAnswer', 10_000)).toBe(true);
    expect(b.take('icebreakerConfirm', 10_100)).toBe(true);
    expect(b.take('quizAnswer', 10_200)).toBe(true);
    expect(b.take('quizAnswer', 10_300)).toBe(false); // the reserve is used up too
  });

  it('stop after a sent walk is never refused, even with the budget full', () => {
    const b = new ActBudget();
    expect(b.take('walk', 0)).toBe(true); // charged 2: itself and its stop
    for (let t = 1; t < 5000; t += 10) b.take('emote', t);
    expect(b.take('quizAnswer', 5000)).toBe(true);
    for (let t = 5001; t < 6000; t += 10) b.take('quizAnswer', t);
    expect(b.take('icebreakerConfirm', 6000)).toBe(false); // completely full
    expect(b.take('stop', 6001)).toBe(true);
    // walk / stop pairs while full: a refused walk sends nothing, so its stop is a no-op
    expect(b.take('walk', 6002)).toBe(false);
  });

  it('stop is never refused across many walk/stop pairs', () => {
    const b = new ActBudget();
    for (let t = 0; t < 120_000; t += 200) {
      const walked = b.take('walk', t);
      if (walked) expect(b.take('stop', t + 100)).toBe(true);
    }
  });

  it('allowedAt tells when a type fits again (moves coalesce until then)', () => {
    const b = new ActBudget();
    for (let i = 0; i < ACT_CAP - ACT_RESERVED; i++) expect(b.take('move', i * 1000)).toBe(true);
    expect(b.allowedAt('move', 20_000)).toBe(MIN); // when the first move leaves the window
    expect(b.allowedAt('quizAnswer', 20_000)).toBe(20_000);
    expect(b.take('move', MIN - 1)).toBe(false);
    expect(b.take('move', MIN)).toBe(true);
  });

  it('survives a reload through its store', () => {
    let saved: number[] = [];
    const store = { load: () => saved, save: (ts: number[]) => { saved = ts; } };
    const a = new ActBudget(store);
    for (let i = 0; i < 17; i++) a.take('emote', i);
    const b = new ActBudget(store);
    expect(b.take('emote', 100)).toBe(false);
    expect(b.take('quizAnswer', 100)).toBe(true);
  });
});

describe('ActBudget join look (I1)', () => {
  const MIN35 = 35 * MIN;
  it('a join setLook is never refused by the act cap, up to JOIN_LOOK_MAX per session', () => {
    expect(JOIN_LOOK_MAX).toBe(3);
    expect(JOIN_LOOK_WINDOW_MS).toBe(MIN35);
    const b = new ActBudget();
    for (let i = 0; i < ACT_CAP; i++) b.take('quizAnswer', 0); // cap exhausted
    expect(b.take('setLook', 0)).toBe(false);
    expect(b.takeJoinLook(0)).toBe(true);
    expect(b.takeJoinLook(1)).toBe(true);
    expect(b.takeJoinLook(2)).toBe(true);
    expect(b.takeJoinLook(3)).toBe(false); // allowance used: back to the ordinary cap
    expect(b.takeJoinLook(MIN35 + 1)).toBe(true); // a fresh session window
    // exempt sends charge nothing to the ordinary cap
    const c = new ActBudget();
    c.takeJoinLook(0);
    let ok = 0;
    for (let i = 0; i < 30; i++) if (c.take('emote', 0)) ok++;
    expect(ok).toBe(ACT_CAP - ACT_RESERVED);
  });

  it('the join-look allowance survives a reload through its store', () => {
    let saved: number[] = [];
    const store = { load: () => saved, save: (c: number[]) => { saved = [...c]; } };
    const a = new ActBudget(null, store);
    for (let i = 0; i < JOIN_LOOK_MAX; i++) expect(a.takeJoinLook(i)).toBe(true);
    const b = new ActBudget(null, store);
    expect(b.takeJoinLook(10)).toBe(false);
  });
});

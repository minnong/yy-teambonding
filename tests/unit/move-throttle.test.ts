import { describe, it, expect } from 'vitest';
import { MoveThrottle, MOVE_MIN_GAP_MS, MOVE_WINDOW_MS, MOVE_WINDOW_MAX } from '../../src/client/room/moveThrottle';

const p = (x: number) => ({ x, y: 100 });

describe('MoveThrottle (R27)', () => {
  it('constants: 1 move per second, 20 per rolling 60 s', () => {
    expect(MOVE_MIN_GAP_MS).toBe(1000);
    expect(MOVE_WINDOW_MS).toBe(60000);
    expect(MOVE_WINDOW_MAX).toBe(20);
  });
  it('the first tap sends at once; taps inside the next second fold into one trailing move of the latest target', () => {
    const t = new MoveThrottle();
    expect(t.request(p(1), 0)).toEqual(p(1));
    expect(t.request(p(2), 200)).toBeNull();
    expect(t.request(p(3), 600)).toBeNull();
    expect(t.nextAt()).toBe(1000);
    expect(t.flush(999)).toBeNull();
    expect(t.flush(1000)).toEqual(p(3));
    expect(t.nextAt()).toBeNull();
    expect(t.flush(5000)).toBeNull();
  });
  it('a tap after the gap sends straight away', () => {
    const t = new MoveThrottle();
    t.request(p(1), 0);
    expect(t.request(p(2), 1000)).toEqual(p(2));
    expect(t.request(p(3), 2500)).toEqual(p(3));
  });
  it('never more than 20 moves in any 60 s window; the excess folds into one trailing move', () => {
    const t = new MoveThrottle();
    const sent: number[] = [];
    // a tap every 100 ms for 3 minutes, flushing whenever allowed
    for (let now = 0; now <= 180_000; now += 100) {
      if (t.request(p(now), now)) sent.push(now);
      const next = t.nextAt();
      if (next !== null && next <= now && t.flush(now)) sent.push(now);
    }
    for (let i = 0; i + 20 < sent.length; i++) expect(sent[i + 20]! - sent[i]!).toBeGreaterThanOrEqual(60_000);
    for (let i = 1; i < sent.length; i++) expect(sent[i]! - sent[i - 1]!).toBeGreaterThanOrEqual(1000);
    expect(sent.length).toBeLessThanOrEqual(3 * 20 + 1);
    expect(sent.length).toBeGreaterThanOrEqual(3 * 20 - 1);
  });
  it('when the window is full, the trailing move goes when the oldest send leaves the window', () => {
    const t = new MoveThrottle();
    for (let i = 0; i < 20; i++) expect(t.request(p(i), i * 1000)).toEqual(p(i)); // 0..19 s
    expect(t.request(p(99), 20_000)).toBeNull();
    expect(t.nextAt()).toBe(60_000);
    expect(t.flush(59_999)).toBeNull();
    expect(t.flush(60_000)).toEqual(p(99));
  });
  it('clear drops a pending trailing move (a keyboard walk takes over)', () => {
    const t = new MoveThrottle();
    t.request(p(1), 0);
    t.request(p(2), 100);
    t.clear();
    expect(t.nextAt()).toBeNull();
    expect(t.flush(2000)).toBeNull();
  });
});

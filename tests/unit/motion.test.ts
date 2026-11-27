import { describe, it, expect } from 'vitest';
import { positionAt, isMoving, truncateAt, pathPassesNear } from '@shared/motion';
import type { Motion } from '@shared/types';

const m: Motion = { path: [{ x: 0, y: 0 }, { x: 128, y: 0 }], startedAt: 1000 };

describe('motion', () => {
  it('positionAt is start at startedAt, end after length/WALK_SPEED, and linear between', () => {
    expect(positionAt(m, 1000)).toEqual({ x: 0, y: 0 });
    expect(positionAt(m, 500)).toEqual({ x: 0, y: 0 });
    expect(positionAt(m, 1500)).toEqual({ x: 64, y: 0 });
    expect(positionAt(m, 2000)).toEqual({ x: 128, y: 0 });
    expect(positionAt(m, 9000)).toEqual({ x: 128, y: 0 });
    expect(isMoving(m, 1500)).toBe(true);
    expect(isMoving(m, 2000)).toBe(false);
  });

  it('positionAt follows multi-segment paths', () => {
    const mm: Motion = { path: [{ x: 0, y: 0 }, { x: 128, y: 0 }, { x: 128, y: 128 }], startedAt: 0 };
    expect(positionAt(mm, 1500)).toEqual({ x: 128, y: 64 });
  });

  it('truncateAt mid-path freezes position', () => {
    const t = truncateAt(m, 1500);
    expect(t.path).toEqual([{ x: 64, y: 0 }]);
    expect(t.startedAt).toBe(1500);
    expect(positionAt(t, 5000)).toEqual({ x: 64, y: 0 });
    expect(isMoving(t, 1600)).toBe(false);
  });

  it('pathPassesNear detects a pass-through between ticks, but not a near-miss beyond r', () => {
    const p = { x: 64, y: 10 };
    expect(pathPassesNear(m, 1000, 1010, p, 20)).toBe(false);
    expect(pathPassesNear(m, 1000, 2000, p, 20)).toBe(true); // passes by in between
    expect(pathPassesNear(m, 1000, 2000, { x: 64, y: 30 }, 20)).toBe(false);
    expect(pathPassesNear(m, 1800, 1900, p, 20)).toBe(false);
    expect(pathPassesNear(m, 3000, 4000, { x: 128, y: 5 }, 10)).toBe(true); // standing at end
  });

  it('isMoving is false before startedAt', () => {
    expect(isMoving(m, 500)).toBe(false);
  });

  it('handles a 1-point path', () => {
    const one: Motion = { path: [{ x: 10, y: 10 }], startedAt: 0 };
    expect(positionAt(one, 5000)).toEqual({ x: 10, y: 10 });
    expect(isMoving(one, 100)).toBe(false);
    expect(pathPassesNear(one, 0, 1000, { x: 12, y: 10 }, 5)).toBe(true);
    expect(pathPassesNear(one, 0, 1000, { x: 30, y: 10 }, 5)).toBe(false);
  });

  it('accepts t0 > t1', () => {
    expect(pathPassesNear(m, 2000, 1000, { x: 64, y: 10 }, 20)).toBe(true);
    expect(pathPassesNear(m, 2000, 1000, { x: 64, y: 50 }, 20)).toBe(false);
  });

  it('handles a zero-length segment', () => {
    const z: Motion = { path: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 128, y: 0 }], startedAt: 0 };
    expect(positionAt(z, 500)).toEqual({ x: 64, y: 0 });
    expect(pathPassesNear(z, 0, 1000, { x: 100, y: 5 }, 10)).toBe(true);
  });

  it('L-shaped path: only the corner is within r', () => {
    const L: Motion = { path: [{ x: 0, y: 0 }, { x: 128, y: 0 }, { x: 128, y: 128 }], startedAt: 0 };
    // Window sampled at ends is far from p, but the corner (t=1000) passes within r.
    const p = { x: 138, y: -8 };
    expect(pathPassesNear(L, 0, 2000, p, 15)).toBe(true);
    expect(pathPassesNear(L, 0, 2000, { x: 150, y: -30 }, 15)).toBe(false);
    // Same path, window entirely before the corner: p is >r away.
    expect(pathPassesNear(L, 0, 800, p, 15)).toBe(false);
  });

  it('window starting before startedAt', () => {
    expect(pathPassesNear(m, -5000, 500, { x: 0, y: 5 }, 10)).toBe(true);
    expect(pathPassesNear(m, -5000, 500, { x: 128, y: 0 }, 10)).toBe(false);
  });
});

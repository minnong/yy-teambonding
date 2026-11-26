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
});

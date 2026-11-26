import { describe, it, expect } from 'vitest';
import { LAYOUT, isWalkable, toTile, toWorld, spawnFor, nearTable, randomOpenSpot } from '@shared/layout';
import { findPath, findPathWith } from '@shared/path';
import { TILE, TABLE_REACH } from '@shared/constants';

describe('layout', () => {
  it('wall rows and table tiles are not walkable; aisles are', () => {
    for (let x = 0; x < LAYOUT.cols; x++) for (let y = 0; y < LAYOUT.wallRows; y++) expect(isWalkable(x, y)).toBe(false);
    for (const t of Object.values(LAYOUT.tables))
      for (let x = t.x; x < t.x + t.w; x++) for (let y = t.y; y < t.y + t.h; y++) expect(isWalkable(x, y)).toBe(false);
    expect(isWalkable(0, 10)).toBe(false);
    expect(isWalkable(23, 10)).toBe(false);
    expect(isWalkable(5, 35)).toBe(false);
    expect(isWalkable(1, 4)).toBe(true);
    expect(isWalkable(12, 25)).toBe(true);
    expect(Object.keys(LAYOUT.tables)).toHaveLength(7);
  });

  it('every spawn is walkable and distinct for n=0..5', () => {
    for (let slot = 0; slot < 7; slot++) {
      const seen = new Set<string>();
      for (let n = 0; n < 8; n++) {
        const p = spawnFor(slot, n);
        const t = toTile(p);
        expect(isWalkable(t.x, t.y)).toBe(true);
        expect(nearTable(p, slot)).toBe(true);
        if (n < 6) seen.add(`${p.x},${p.y}`);
      }
      expect(seen.size).toBe(6);
    }
  });

  it('randomOpenSpot is walkable, away from tables, deterministic', () => {
    let s = 7;
    const rng = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 200; i++) {
      const p = randomOpenSpot(rng);
      const t = toTile(p);
      expect(isWalkable(t.x, t.y)).toBe(true);
      for (let slot = 0; slot < 7; slot++) expect(nearTable(p, slot)).toBe(false);
    }
    expect(randomOpenSpot(() => 0.3)).toEqual(randomOpenSpot(() => 0.3));
    expect(TABLE_REACH).toBe(48);
  });

  it('all tables are mutually reachable', () => {
    const a = spawnFor(0, 0);
    for (let slot = 1; slot < 7; slot++) {
      const p = findPath(a, spawnFor(slot, 0));
      expect(p.length).toBeGreaterThan(1);
    }
  });
});

describe('findPath', () => {
  it('never steps on a blocked tile around a table', () => {
    const t = LAYOUT.tables[0]!;
    const from = toWorld(t.x - 1, t.y);
    const to = toWorld(t.x + t.w, t.y + t.h - 1);
    const path = findPath(from, to);
    expect(path[0]).toEqual(from);
    expect(path[path.length - 1]!).toEqual(to);
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i]!, b = path[i + 1]!;
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4);
      for (let k = 0; k <= steps; k++) {
        const tt = toTile({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps });
        expect(isWalkable(tt.x, tt.y)).toBe(true);
      }
    }
  });

  it('to a blocked target ends next to it', () => {
    const t = LAYOUT.tables[3]!;
    const target = toWorld(t.x + 1, t.y);
    const path = findPath(toWorld(1, 20), target);
    const end = toTile(path[path.length - 1]!);
    expect(isWalkable(end.x, end.y)).toBe(true);
    expect(Math.hypot(end.x - (t.x + 1), end.y - t.y)).toBeLessThanOrEqual(1.5);
  });

  it('with no route returns [from]', () => {
    const from = toWorld(5, 20);
    const walled = (x: number, y: number) => isWalkable(x, y) && x < 10 && !(x === 8);
    expect(findPathWith(from, toWorld(15, 20), walled)).toEqual([from]);
  });

  it('does not cut corners', () => {
    const blocked = new Set(['5,5']);
    const w = (x: number, y: number) => isWalkable(x, y) && !blocked.has(`${x},${y}`);
    const path = findPathWith(toWorld(4, 6), toWorld(6, 4), w);
    expect(path.length).toBeGreaterThan(2);
  });

  it('compresses collinear points', () => {
    const path = findPath(toWorld(2, 25), toWorld(20, 25));
    expect(path).toHaveLength(2);
    expect(TILE).toBe(32);
  });
});

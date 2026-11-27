import { TILE, TABLE_REACH } from './constants';
import type { Vec } from './types';

type Rect = { x: number; y: number; w: number; h: number };

/** Table rects in tile units. Staggered rows of 2/2/2/1 below the 4-row back wall. */
const TABLES: Record<number, Rect> = {
  0: { x: 3, y: 6, w: 3, h: 2 },
  1: { x: 14, y: 6, w: 3, h: 2 },
  2: { x: 8, y: 10, w: 3, h: 2 },
  3: { x: 19, y: 10, w: 3, h: 2 },
  4: { x: 3, y: 14, w: 3, h: 2 },
  5: { x: 14, y: 14, w: 3, h: 2 },
  6: { x: 10, y: 18, w: 3, h: 2 },
};

export const LAYOUT = { cols: 24 as const, rows: 36 as const, wallRows: 4 as const, tables: TABLES };

const blocked: boolean[][] = [];
for (let y = 0; y < LAYOUT.rows; y++) {
  blocked.push([]);
  for (let x = 0; x < LAYOUT.cols; x++) {
    blocked[y]!.push(y < LAYOUT.wallRows || x === 0 || x === LAYOUT.cols - 1 || y === LAYOUT.rows - 1);
  }
}
for (const t of Object.values(TABLES))
  for (let y = t.y; y < t.y + t.h; y++) for (let x = t.x; x < t.x + t.w; x++) blocked[y]![x] = true;

export function isWalkable(tx: number, ty: number): boolean {
  if (!Number.isInteger(tx) || !Number.isInteger(ty)) return false;
  if (tx < 0 || ty < 0 || tx >= LAYOUT.cols || ty >= LAYOUT.rows) return false;
  return !blocked[ty]![tx];
}

export const toTile = (p: Vec): Vec => ({ x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) });
export const toWorld = (tx: number, ty: number): Vec => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });

function distToRect(p: Vec, t: Rect): number {
  const dx = Math.max(t.x * TILE - p.x, 0, p.x - (t.x + t.w) * TILE);
  const dy = Math.max(t.y * TILE - p.y, 0, p.y - (t.y + t.h) * TILE);
  return Math.hypot(dx, dy);
}

export function nearTable(p: Vec, slot: number): boolean {
  const t = TABLES[slot];
  return !!t && distToRect(p, t) <= TABLE_REACH;
}

/** Walkable tiles in the 1-tile ring around a table, front (below) first. */
function ring(t: Rect): Vec[] {
  const out: Vec[] = [];
  const add = (x: number, y: number) => { if (isWalkable(x, y)) out.push(toWorld(x, y)); };
  for (let x = t.x; x < t.x + t.w; x++) add(x, t.y + t.h);
  add(t.x - 1, t.y + t.h - 1); add(t.x + t.w, t.y + t.h - 1);
  add(t.x - 1, t.y); add(t.x + t.w, t.y);
  for (let x = t.x; x < t.x + t.w; x++) add(x, t.y - 1);
  add(t.x - 1, t.y + t.h); add(t.x + t.w, t.y + t.h);
  add(t.x - 1, t.y - 1); add(t.x + t.w, t.y - 1);
  return out;
}

/** Walkable spot beside the table; distinct for n = 0..5, wraps beyond the ring size. */
export function spawnFor(slot: number, n: number): Vec {
  const t = TABLES[slot] ?? TABLES[0]!;
  const r = ring(t);
  return r[((Math.floor(n) % r.length) + r.length) % r.length]!;
}

let openSpots: Vec[] | null = null;
/** Walkable tile centre not within TABLE_REACH of any table. Deterministic given rng() in [0,1). */
export function randomOpenSpot(rng: () => number): Vec {
  if (!openSpots) {
    openSpots = [];
    for (let y = 0; y < LAYOUT.rows; y++)
      for (let x = 0; x < LAYOUT.cols; x++) {
        if (!isWalkable(x, y)) continue;
        const p = toWorld(x, y);
        if (Object.keys(TABLES).every((s) => !nearTable(p, Number(s)))) openSpots.push(p);
      }
  }
  const i = Math.min(openSpots.length - 1, Math.floor(rng() * openSpots.length));
  return { ...openSpots[i]! };
}

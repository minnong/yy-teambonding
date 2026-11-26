import { isWalkable, toTile, toWorld, LAYOUT } from './layout';
import type { Vec } from './types';

type Walkable = (tx: number, ty: number) => boolean;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

function nearestWalkable(p: Vec, w: Walkable): Vec | null {
  const t = toTile(p);
  if (w(t.x, t.y)) return t;
  let best: Vec | null = null, bd = Infinity;
  for (let y = 0; y < LAYOUT.rows; y++)
    for (let x = 0; x < LAYOUT.cols; x++) {
      if (!w(x, y)) continue;
      const c = toWorld(x, y);
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bd) { bd = d; best = { x, y }; }
    }
  return best;
}

function astar(s: Vec, g: Vec, w: Walkable): Vec[] | null {
  const W = LAYOUT.cols, N = W * LAYOUT.rows;
  const gs = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const h = (x: number, y: number) => {
    const dx = Math.abs(x - g.x), dy = Math.abs(y - g.y);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const si = s.y * W + s.x, gi = g.y * W + g.x;
  gs[si] = 0;
  const open: number[] = [si];
  const ow = (i: number) => open[i]!;
  const f = (i: number) => gs[i]! + h(i % W, Math.floor(i / W));
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (f(ow(k)) < f(ow(bi))) bi = k;
    const cur = ow(bi);
    open[bi] = ow(open.length - 1); open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === gi) {
      const out: Vec[] = [];
      for (let i = cur; i !== -1; i = prev[i]!) out.push({ x: i % W, y: Math.floor(i / W) });
      return out.reverse();
    }
    const cx = cur % W, cy = Math.floor(cur / W);
    for (const [dx, dy] of DIRS as [number, number][]) {
      const nx = cx + dx, ny = cy + dy;
      if (!w(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && !(w(cx + dx, cy) && w(cx, cy + dy))) continue;
      const ni = ny * W + nx;
      if (closed[ni]) continue;
      const ng = gs[cur]! + (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1);
      if (ng < gs[ni]!) { gs[ni] = ng; prev[ni] = cur; open.push(ni); }
    }
  }
  return null;
}

/** Drop zero-length steps and collinear middle points. */
function compress(pts: Vec[]): Vec[] {
  const out: Vec[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    while (out.length >= 2) {
      const a = out[out.length - 2]!, b = out[out.length - 1]!;
      const cross = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x);
      const dot = (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y);
      if (Math.abs(cross) < 1e-6 && dot > 0) out.pop(); else break;
    }
    out.push(p);
  }
  return out;
}

/** findPath with an injectable walkability predicate (used by tests). */
export function findPathWith(from: Vec, to: Vec, w: Walkable): Vec[] {
  const s = nearestWalkable(from, w), g = nearestWalkable(to, w);
  if (!s || !g) return [from];
  const tiles = astar(s, g, w);
  if (!tiles) return [from];
  return compress([from, ...tiles.map((t) => toWorld(t.x, t.y))]);
}

export function findPath(from: Vec, to: Vec): Vec[] {
  return findPathWith(from, to, isWalkable);
}

import { WALK_SPEED } from './constants';
import type { Motion, Vec } from './types';

const len = (a: Vec, b: Vec) => Math.hypot(b.x - a.x, b.y - a.y);

function totalLength(path: Vec[]): number {
  let L = 0;
  for (let i = 0; i + 1 < path.length; i++) L += len(path[i]!, path[i + 1]!);
  return L;
}

/** Position after walking `d` px along the polyline (clamped). */
function along(path: Vec[], d: number): Vec {
  if (path.length === 0) return { x: 0, y: 0 };
  if (d <= 0) return { ...path[0]! };
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!, b = path[i + 1]!, l = len(a, b);
    if (d <= l) return l === 0 ? { ...b } : { x: a.x + ((b.x - a.x) * d) / l, y: a.y + ((b.y - a.y) * d) / l };
    d -= l;
  }
  return { ...path[path.length - 1]! };
}

const distAt = (m: Motion, now: number) => Math.max(0, ((now - m.startedAt) / 1000) * WALK_SPEED);

export function positionAt(m: Motion, now: number): Vec {
  return along(m.path, distAt(m, now));
}

export function isMoving(m: Motion, now: number): boolean {
  return m.path.length > 1 && now < m.startedAt + (totalLength(m.path) / WALK_SPEED) * 1000;
}

export function truncateAt(m: Motion, now: number): Motion {
  return { path: [positionAt(m, now)], startedAt: now };
}

function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** True if the avatar is within r of p at any time in [t0, t1] (exact segment geometry). */
export function pathPassesNear(m: Motion, t0: number, t1: number, p: Vec, r: number): boolean {
  if (t1 < t0) [t0, t1] = [t1, t0];
  // Breakpoints: t0, each vertex time inside (t0,t1), t1. Position is linear between them.
  const times = [t0];
  let d = 0;
  for (let i = 1; i < m.path.length; i++) {
    d += len(m.path[i - 1]!, m.path[i]!);
    const t = m.startedAt + (d / WALK_SPEED) * 1000;
    if (t > t0 && t < t1) times.push(t);
  }
  times.push(t1);
  let prev = positionAt(m, t0);
  if (len(prev, p) <= r) return true;
  for (let i = 1; i < times.length; i++) {
    const cur = positionAt(m, times[i]!);
    if (distToSegment(p, prev, cur) <= r) return true;
    prev = cur;
  }
  return false;
}

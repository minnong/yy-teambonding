// M1: sparkles are drawn above their tile (and bob higher still), so a tap on the sprite often
// lands in the tile above and the walk stops 32 px short, out of pickup range. A tap near a drawn
// sparkle walks to the sparkle's own position instead. Pure, for unit tests.
import type { Collectible, Vec } from '@shared/types';

/** How far above its position a sparkle is drawn (RoomScene adds a 4 px bob on top). */
export const SPARKLE_DRAW_DY = -12;
const MIN_RADIUS = 24; // world px
const MIN_RADIUS_CSS = 22; // half the 44 CSS px tap target

/** The position of the sparkle the tap at `w` was aimed at, or null. `zoom` is CSS px per world px. */
export function snapTapToSparkle(w: Vec, collectibles: readonly Collectible[], zoom: number): Vec | null {
  const r = Math.max(MIN_RADIUS, MIN_RADIUS_CSS / Math.max(zoom, 1e-6));
  let best: Collectible | null = null;
  let bestD = Infinity;
  for (const c of collectibles) {
    const d = Math.hypot(w.x - c.pos.x, w.y - (c.pos.y + SPARKLE_DRAW_DY));
    if (d <= r && d < bestD) { best = c; bestD = d; }
  }
  return best ? { x: best.pos.x, y: best.pos.y } : null;
}

// Pure camera maths (no Phaser): zoom levels, layout choice and clamping. All sizes are CSS px;
// the scene multiplies zoom by the device pixel ratio when it applies it.
import { TILE } from '@shared/constants';

/** Tiles visible across a phone in follow mode. */
export const FOLLOW_TILES = 12;
export const MAX_FOLLOW_ZOOM = 2;
/** Non-phone layouts show the whole room when it fits at least this large. */
export const AUTO_FIT_MIN = 0.75;
export const ZOOM_TWEEN_MS = 450;

export type ViewMode = 'fit' | 'follow';
export interface View { mode: ViewMode; zoom: number }

/** Largest zoom at which the whole world fits inside the view. */
export function fitZoom(viewW: number, viewH: number, worldW: number, worldH: number): number {
  return Math.min(viewW / worldW, viewH / worldH);
}

/** About FOLLOW_TILES tiles across, capped at MAX_FOLLOW_ZOOM on wide screens. */
export function followZoom(viewW: number): number {
  return Math.min(MAX_FOLLOW_ZOOM, viewW / (FOLLOW_TILES * TILE));
}

/** A phone held upright: portrait and narrower than 600 CSS px. */
export function isPhoneLayout(viewW: number, viewH: number): boolean {
  return viewH > viewW && viewW < 600;
}

export function chooseView(viewW: number, viewH: number, worldW: number, worldH: number, zoomedOut: boolean): View {
  const fit = fitZoom(viewW, viewH, worldW, worldH);
  if (zoomedOut) return { mode: 'fit', zoom: fit };
  if (!isPhoneLayout(viewW, viewH) && fit >= AUTO_FIT_MIN) return { mode: 'fit', zoom: fit };
  return { mode: 'follow', zoom: followZoom(viewW) };
}

/**
 * Camera centre on one axis so the view stays inside [0, worldLen]. If the world is smaller than
 * the view on this axis, it is centred instead.
 */
export function clampCenter(target: number, viewLen: number, zoom: number, worldLen: number): number {
  const half = viewLen / (2 * zoom);
  if (2 * half >= worldLen) return worldLen / 2;
  return Math.min(worldLen - half, Math.max(half, target));
}

export const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// Room input: tap-vs-drag on the canvas and WASD/arrow walking. Intents only: one `move` per tap,
// one `walk` per key press and one `stop` per release.
import type Phaser from 'phaser';
import type { WalkDir } from '@shared/protocol';
import type { Vec } from '@shared/types';

export const TAP_MAX_PX = 10;
export const TAP_MAX_MS = 300;

export function isTap(dx: number, dy: number, dtMs: number): boolean {
  return dx * dx + dy * dy <= TAP_MAX_PX * TAP_MAX_PX && dtMs < TAP_MAX_MS;
}

const KEYS: Record<string, WalkDir> = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
};
export const keyDir = (code: string): WalkDir | null => KEYS[code] ?? null;

export function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable === true;
}

/** Held direction keys in press order. The latest held key is the active one. */
export class KeyStack {
  private held: WalkDir[] = [];

  /** Returns the direction to walk, or null if the key was already held (repeat). */
  press(dir: WalkDir): WalkDir | null {
    if (this.held.includes(dir)) return null;
    this.held.push(dir);
    return dir;
  }

  /** Returns the fallback direction, 'stop', or null if nothing changes. */
  release(dir: WalkDir): WalkDir | 'stop' | null {
    const i = this.held.indexOf(dir);
    if (i < 0) return null;
    const wasActive = i === this.held.length - 1;
    this.held.splice(i, 1);
    if (!wasActive) return null;
    return this.held[this.held.length - 1] ?? 'stop';
  }

  clear(): 'stop' | null {
    const any = this.held.length > 0;
    this.held = [];
    return any ? 'stop' : null;
  }
}

export interface WalkSink { walk(dir: WalkDir): void; stop(): void }

/** Window-level keyboard walking. Key downs inside text fields are ignored. Returns a detach fn. */
export function attachKeyboard(sink: WalkSink, target: Window = window): () => void {
  const keys = new KeyStack();
  const apply = (r: WalkDir | 'stop' | null) => {
    if (r === 'stop') sink.stop();
    else if (r) sink.walk(r);
  };
  const down = (e: KeyboardEvent) => {
    const dir = keyDir(e.code);
    if (!dir || e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTextEntry(e.target as Element | null) || isTextEntry(target.document.activeElement)) return;
    e.preventDefault();
    if (e.repeat) return;
    apply(keys.press(dir));
  };
  // Releases are honoured even from a text field, so a key held while focusing one still stops.
  const up = (e: KeyboardEvent) => {
    const dir = keyDir(e.code);
    if (dir) apply(keys.release(dir));
  };
  const blur = () => apply(keys.clear());
  // A tab hidden mid-press may never see the keyup (R25b): stop now rather than walk on.
  const doc = target.document;
  const vis = () => { if (doc.visibilityState === 'hidden') apply(keys.clear()); };
  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  target.addEventListener('blur', blur);
  doc.addEventListener('visibilitychange', vis);
  return () => {
    target.removeEventListener('keydown', down);
    target.removeEventListener('keyup', up);
    target.removeEventListener('blur', blur);
    doc.removeEventListener('visibilitychange', vis);
  };
}

/** A tracked pointerdown older than this, or whose pointer is no longer held, is treated as lost. */
export const STALE_DOWN_MS = 2000;

/** True if the earlier tracked down should be forgotten rather than count as a second finger. */
export function isStaleDown(prevDownAt: number, nowDownAt: number, prevStillHeld: boolean): boolean {
  return !prevStillHeld || nowDownAt - prevDownAt > STALE_DOWN_MS;
}

export interface TapHandlers {
  /** World-space tap. Return nothing; the scene decides avatar vs floor. */
  onTap(world: Vec): void;
}

/**
 * Taps on the scene: a pointerup within TAP_MAX_PX and TAP_MAX_MS of its pointerdown. Only the
 * first touch counts; drags and multi-touch do nothing (there is no panning).
 */
export function attachTaps(scene: Phaser.Scene, h: TapHandlers): () => void {
  let downId = -1, downX = 0, downY = 0, downAt = 0, cancelled = false;
  const held = (id: number) => scene.input.manager.pointers.some((q) => q.id === id && q.isDown);
  const onDown = (p: Phaser.Input.Pointer) => {
    // A lost pointerup (R25a) would otherwise leave downId set and swallow every later tap.
    if (downId !== -1 && downId !== p.id && !isStaleDown(downAt, p.downTime, held(downId))) { cancelled = true; return; } // a second finger cancels the tap
    downId = p.id; downX = p.x; downY = p.y; downAt = p.downTime; cancelled = false;
  };
  const onUp = (p: Phaser.Input.Pointer) => {
    if (p.id !== downId) return;
    downId = -1;
    if (cancelled) return;
    // Pointer x/y are in canvas pixels (CSS px x DPR); the threshold is in CSS px.
    const s = scene.scale.displayScale;
    if (!isTap((p.x - downX) / s.x, (p.y - downY) / s.y, p.upTime - downAt)) return;
    p.updateWorldPoint(scene.cameras.main);
    h.onTap({ x: p.worldX, y: p.worldY });
  };
  const input = scene.input;
  input.on('pointerdown', onDown);
  input.on('pointerup', onUp);
  input.on('pointerupoutside', onUp);
  return () => {
    input.off('pointerdown', onDown);
    input.off('pointerup', onUp);
    input.off('pointerupoutside', onUp);
  };
}

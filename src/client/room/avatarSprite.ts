// One player's avatar: a container of LPC layer sprites (all on the same frame), plus a name label,
// a ✅ badge for departed teams and, for me, a bobbing arrow. Labels live in a top layer so they are
// never hidden behind tables or other avatars.
import type Phaser from 'phaser';
import { DIRECTION_ROW, FRAME, WALK_FRAMES, layersFor } from '../avatar/layers';
import { positionAt, isMoving } from '@shared/motion';
import { WALK_SPEED } from '@shared/constants';
import type { WalkDir } from '@shared/protocol';
import type { AvatarLook, Motion } from '@shared/types';
import { ART, COLORS, mono, smoothText } from './roomArt';

/** LPC feet touch y≈60 of the 64 px frame (soles end at 61). */
const FOOT_Y = 60;
export const ORIGIN_Y = FOOT_Y / FRAME;
/** The body spans about 48 px above the feet. */
export const BODY_H = 48;
export const LABEL_DEPTH = 100000;
const WALK_FPS = 9;
const FADE_PER_MS = 1 / 1000;
const HOP_MS = 320;
const HOP_PX = 8;

const grey = (rgb: number): number => {
  const l = Math.round((0.3 * ((rgb >> 16) & 255) + 0.59 * ((rgb >> 8) & 255) + 0.11 * (rgb & 255)) * 0.9);
  return (l << 16) | (l << 8) | l;
};
const DEPARTED_TINT = 0xa0a0a0;

export interface AvatarInit { id: string; name: string; look: AvatarLook; motion: Motion; isMe: boolean }

export class AvatarSprite {
  readonly id: string;
  readonly isMe: boolean;
  readonly container: Phaser.GameObjects.Container;
  x = 0;
  y = 0;
  online = true;
  private layers: Phaser.GameObjects.Sprite[] = [];
  private tints: (number | null)[] = [];
  private readonly label: Phaser.GameObjects.Text;
  private readonly arrow: Phaser.GameObjects.Image | null;
  private badge: Phaser.GameObjects.Text | null = null;
  private motion!: Motion;
  private cum: number[] = [];
  private dir: WalkDir = 'down';
  private frame = -1;
  private alpha = 1;
  private departed = false;
  private labelOn = false;
  private lookKey = '';
  private hopAt = -1;

  constructor(private readonly scene: Phaser.Scene, init: AvatarInit) {
    this.id = init.id;
    this.isMe = init.isMe;
    this.container = scene.add.container(0, 0);
    const first = init.name.trim().split(/\s+/)[0] || init.name;
    this.label = smoothText(scene.add.text(0, 0, first, mono(10, init.isMe ? COLORS.gold : '#ffffff', {
      backgroundColor: 'rgba(20,16,32,0.78)', padding: { x: 4, y: 2 },
    })).setOrigin(0.5, 1).setDepth(LABEL_DEPTH + (init.isMe ? 2 : 0)).setVisible(false));
    this.arrow = init.isMe ? scene.add.image(0, 0, ART.arrow).setOrigin(0.5, 1).setDepth(LABEL_DEPTH + 3) : null;
    this.setLook(init.look);
    this.setMotion(init.motion);
  }

  setLook(look: AvatarLook): void {
    const key = JSON.stringify(look);
    if (key === this.lookKey) return;
    this.lookKey = key;
    for (const s of this.layers) s.destroy();
    const layers = layersFor(look);
    this.tints = layers.map((l) => l.tint);
    this.layers = layers.map((l) => this.scene.add.sprite(0, 0, l.key, 0).setOrigin(0.5, ORIGIN_Y));
    this.container.add(this.layers);
    this.frame = -1;
    this.applyTint();
  }

  setMotion(m: Motion): void {
    if (m === this.motion) return;
    this.motion = m;
    this.cum = [0];
    for (let i = 1; i < m.path.length; i++) {
      const a = m.path[i - 1]!, b = m.path[i]!;
      this.cum.push(this.cum[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
    }
  }
  get currentMotion(): Motion { return this.motion; }

  setDeparted(d: boolean): void {
    if (d === this.departed) return;
    this.departed = d;
    this.applyTint();
    if (d && !this.badge) {
      this.badge = smoothText(this.scene.add.text(0, 0, '✅', mono(10, '#ffffff')).setOrigin(0.5, 1).setDepth(LABEL_DEPTH));
    } else if (!d && this.badge) {
      this.badge.destroy();
      this.badge = null;
    }
  }

  setOnline(on: boolean): void { this.online = on; }

  /** Start invisible (so a newcomer fades in). */
  startHidden(): void { this.alpha = 0; this.container.setAlpha(0).setVisible(false); }

  /** Jump straight to the online/offline alpha (first snapshot: no fades). */
  snapFade(): void {
    this.alpha = this.online ? 1 : 0;
    this.container.setAlpha(this.alpha);
  }

  /** A small jump (high-five), played on the next frames. */
  hop(): void { this.hopAt = performance.now(); }

  /** Top of the label area above the head, in world px. */
  get top(): number { return this.y - BODY_H - 4 - (this.labelOn ? 14 : 0); }

  /** Proximity decides; my own label always shows. */
  setLabelVisible(on: boolean): void { this.labelOn = on || this.isMe; }

  /** True if the world point is on this avatar's body (hit box at least minW x minH). */
  hits(wx: number, wy: number, minW: number, minH: number): boolean {
    if (!this.container.visible || this.alpha < 0.5) return false;
    const hw = Math.max(16, minW / 2), h = Math.max(BODY_H, minH);
    return Math.abs(wx - this.x) <= hw && wy <= this.y + 4 && wy >= this.y + 4 - h;
  }

  update(now: number, dtMs: number, wallMs: number): void {
    const m = this.motion;
    const p = positionAt(m, now);
    this.x = p.x;
    this.y = p.y;
    const moving = isMoving(m, now);
    if (moving) this.dir = this.segmentDir(((now - m.startedAt) / 1000) * WALK_SPEED);
    const row = DIRECTION_ROW[this.dir] * WALK_FRAMES;
    const f = moving ? row + 1 + (Math.floor(((now - m.startedAt) * WALK_FPS) / 1000) % (WALK_FRAMES - 1)) : row;
    if (f !== this.frame) {
      this.frame = f;
      for (const s of this.layers) s.setFrame(f);
    }

    // Offline: fade out over 1 s, then hide; back online fades in. Large dt (backgrounded tab) snaps.
    const target = this.online ? 1 : 0;
    if (this.alpha !== target) {
      const step = Math.min(1, dtMs * FADE_PER_MS);
      this.alpha = target > this.alpha ? Math.min(target, this.alpha + step) : Math.max(target, this.alpha - step);
      this.container.setAlpha(this.alpha);
    }
    const visible = this.alpha > 0;
    let hopY = 0;
    if (this.hopAt >= 0) {
      const t = (wallMs - this.hopAt) / HOP_MS;
      if (t >= 1 || t < 0) this.hopAt = -1;
      else hopY = Math.round(Math.sin(Math.PI * t) * HOP_PX);
    }
    this.container.setVisible(visible).setPosition(this.x, this.y - hopY);
    if (this.container.depth !== this.y) this.container.setDepth(this.y); // feet decide draw order

    const top = this.y - BODY_H - 4;
    const showLabel = visible && this.labelOn;
    this.label.setVisible(showLabel);
    if (showLabel) this.label.setPosition(Math.round(this.x), Math.round(top)).setAlpha(this.alpha);
    if (this.badge) {
      this.badge.setVisible(visible);
      if (visible) this.badge.setPosition(Math.round(this.x + (showLabel ? this.label.width / 2 + 7 : 0)), Math.round(top)).setAlpha(this.alpha);
    }
    if (this.arrow) {
      const bob = Math.round(Math.sin(wallMs / 220) * 2);
      this.arrow.setVisible(visible).setPosition(Math.round(this.x), Math.round(top - (showLabel ? this.label.height : 0) - 2 + bob));
    }
  }

  destroy(): void {
    this.container.destroy();
    this.label.destroy();
    this.arrow?.destroy();
    this.badge?.destroy();
  }

  private applyTint(): void {
    this.layers.forEach((s, i) => {
      const t = this.tints[i] ?? null;
      if (this.departed) s.setTint(t === null ? DEPARTED_TINT : grey(t));
      else if (t === null) s.clearTint();
      else s.setTint(t);
    });
  }

  /** Facing from the dominant axis of the path segment the avatar is on at distance d. */
  private segmentDir(d: number): WalkDir {
    const path = this.motion.path, cum = this.cum;
    let i = 0;
    while (i < path.length - 2 && cum[i + 1]! <= d) i++;
    const a = path[i]!, b = path[i + 1]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    if (dx === 0 && dy === 0) return this.dir;
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
  }
}

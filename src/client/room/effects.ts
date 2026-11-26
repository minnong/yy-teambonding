// Transient scene effects driven by server events: rising "+30 riddle" floats over a table, emoji
// bubbles over avatars (and a hop for a high-five), and a "you're up" table flash. The DOM layer
// calls these through RoomApi.effects and never touches Phaser itself.
import type Phaser from 'phaser';
import { LAYOUT } from '@shared/layout';
import { TILE } from '@shared/constants';
import type { PlayerId } from '@shared/types';
import { COLORS, MONO, TEXT_RES, smoothText } from './roomArt';
import { LABEL_DEPTH } from './avatarSprite';
import { EMOTE_EMOJI } from '../ui/uiState';

export const FLOAT_MS = 1500;
export const BUBBLE_MS = 2000;
export const FLASH_MS = 2400;
const FLOAT_RISE = 40;

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';

export interface RoomEffects {
  /** Rising text over a team's table for ~1.5 s. */
  float(teamId: string, text: string): void;
  /** Emoji bubble over the sender for ~2 s; a high-five also shows over the target and both hop. */
  emote(from: PlayerId, kind: string, target?: PlayerId): void;
  /** Pulses a table (by slot) gold for a couple of seconds. */
  flashTable(slot: number): void;
}

export interface EffectHost {
  scene: Phaser.Scene;
  /** World x and the top of the body (above the label) for an avatar, or null if not shown. */
  anchorOf(id: PlayerId): { x: number; top: number } | null;
  hop(id: PlayerId): void;
  slotOf(teamId: string): number;
}

interface Bubble { id: PlayerId; text: Phaser.GameObjects.Text; until: number }

export class SceneEffects implements RoomEffects {
  private readonly bubbles: Bubble[] = [];

  constructor(private readonly host: EffectHost) {}

  float(teamId: string, text: string): void {
    const r = LAYOUT.tables[this.host.slotOf(teamId)];
    if (!r) return;
    const scene = this.host.scene;
    const cx = (r.x + r.w / 2) * TILE, y = r.y * TILE - 40;
    const neg = text.trim().startsWith('-');
    const t = smoothText(scene.add.text(cx, y, text, {
      fontFamily: MONO, fontSize: '15px', fontStyle: 'bold', color: neg ? '#ff9a8a' : COLORS.gold,
      stroke: '#1d1d1d', strokeThickness: 4, resolution: TEXT_RES,
    })).setOrigin(0.5, 1).setDepth(LABEL_DEPTH + 20).setScale(0.7);
    scene.tweens.add({ targets: t, scale: 1, duration: 160, ease: 'Back.easeOut' });
    scene.tweens.add({
      targets: t, y: y - FLOAT_RISE, duration: FLOAT_MS, ease: 'Sine.easeOut',
      onComplete: () => t.destroy(),
    });
    scene.tweens.add({ targets: t, alpha: 0, delay: FLOAT_MS * 0.6, duration: FLOAT_MS * 0.4 });
  }

  emote(from: PlayerId, kind: string, target?: PlayerId): void {
    const emoji = EMOTE_EMOJI[kind];
    if (!emoji) return;
    this.bubble(from, emoji);
    if (kind === 'highfive' && target) {
      this.bubble(target, emoji);
      this.host.hop(from);
      this.host.hop(target);
    }
  }

  flashTable(slot: number): void {
    const r = LAYOUT.tables[slot];
    if (!r) return;
    const scene = this.host.scene;
    const pad = 6;
    const rect = scene.add.rectangle(r.x * TILE - pad, r.y * TILE - pad, r.w * TILE + pad * 2, r.h * TILE + pad * 2, 0xffe066, 0)
      .setOrigin(0, 0).setDepth((r.y + r.h) * TILE + 0.25).setStrokeStyle(3, 0xffe066, 1);
    scene.tweens.add({
      targets: rect, fillAlpha: 0.5, duration: FLASH_MS / 8, yoyo: true, repeat: 3, ease: 'Sine.easeInOut',
      onComplete: () => rect.destroy(),
    });
  }

  /** Per frame: bubbles follow their avatar and expire. */
  update(wall: number): void {
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i]!;
      const a = this.host.anchorOf(b.id);
      if (wall >= b.until || !a) {
        b.text.destroy();
        this.bubbles.splice(i, 1);
        continue;
      }
      b.text.setPosition(Math.round(a.x), Math.round(a.top - 2));
      const left = b.until - wall;
      if (left < 300) b.text.setAlpha(left / 300);
    }
  }

  destroy(): void {
    for (const b of this.bubbles) b.text.destroy();
    this.bubbles.length = 0;
  }

  private bubble(id: PlayerId, emoji: string): void {
    const a = this.host.anchorOf(id);
    if (!a) return;
    // One bubble per avatar: a new emote replaces the old one.
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      if (this.bubbles[i]!.id === id) { this.bubbles[i]!.text.destroy(); this.bubbles.splice(i, 1); }
    }
    const scene = this.host.scene;
    const text = smoothText(scene.add.text(a.x, a.top - 2, emoji, {
      fontFamily: EMOJI_FONT, fontSize: '20px', resolution: TEXT_RES,
      backgroundColor: 'rgba(255,255,255,0.92)', padding: { x: 5, y: 3 },
    })).setOrigin(0.5, 1).setDepth(LABEL_DEPTH + 10).setScale(0.4);
    scene.tweens.add({ targets: text, scale: 1, duration: 220, ease: 'Back.easeOut' });
    this.bubbles.push({ id, text, until: performance.now() + BUBBLE_MS });
  }
}

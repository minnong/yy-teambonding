// One team table: wood (or grey once departed) art, team-colour flag, name card and floating sign.
import type Phaser from 'phaser';
import { LAYOUT } from '@shared/layout';
import { TILE } from '@shared/constants';
import { ordinal } from '@shared/ordinal';
import type { Team } from '@shared/types';
import { ART, COLORS, TABLE_TEX, mono, smoothText } from './roomArt';

/** `★ {score}` while playing, `✅ WENT {ordinal}` once the team has left. */
export function signText(team: Team): string {
  return team.status === 'departed' ? `✅ WENT ${ordinal(team.departedOrder ?? 0)}` : `★ ${team.score}`;
}

/** Longest prefix of `text` (plus an ellipsis) whose measured width fits `maxW`. */
export function truncateToFit(text: string, maxW: number, measure: (s: string) => number): string {
  if (measure(text) <= maxW) return text;
  const chars = [...text];
  for (let n = chars.length - 1; n > 0; n--) {
    const s = `${chars.slice(0, n).join('').trimEnd()}…`;
    if (measure(s) <= maxW) return s;
  }
  return '…';
}

const CARD_TEXT_W = 62;
const SIGN_H = 22;

export class TableView {
  private readonly img: Phaser.GameObjects.Image;
  private readonly flag: Phaser.GameObjects.Image;
  private readonly name: Phaser.GameObjects.Text;
  private readonly sign: Phaser.GameObjects.Container;
  private readonly signBg: Phaser.GameObjects.Graphics;
  private readonly signLabel: Phaser.GameObjects.Text;
  private readonly signY: number;
  private shown = { name: '', sign: '', departed: false, color: '' };

  constructor(scene: Phaser.Scene, private readonly slot: number) {
    const r = LAYOUT.tables[slot]!;
    const x0 = r.x * TILE, y0 = r.y * TILE, cx = x0 + (r.w * TILE) / 2;
    const depth = (r.y + r.h) * TILE; // footprint bottom: avatars below it draw in front
    this.img = scene.add.image(x0 - TABLE_TEX.fx, y0 - TABLE_TEX.fy, ART.table).setOrigin(0, 0).setDepth(depth);
    this.flag = scene.add.image(cx, y0 + 38, ART.flag).setDepth(depth + 0.1);
    this.name = smoothText(scene.add.text(cx, y0 + 14, '', mono(10, COLORS.cardInk)).setOrigin(0.5, 0.5).setDepth(depth + 0.2));
    this.signY = y0 - 19;
    this.signBg = scene.add.graphics();
    this.signLabel = smoothText(scene.add.text(0, 0, '', mono(13, COLORS.gold)).setOrigin(0.5, 0.5));
    this.sign = scene.add.container(cx, this.signY, [this.signBg, this.signLabel]).setDepth(depth + 0.3);
  }

  update(team: Team | undefined): void {
    const departed = team?.status === 'departed';
    if (departed !== this.shown.departed) {
      this.shown.departed = departed;
      this.img.setTexture(departed ? ART.tableDone : ART.table);
      this.shown.sign = ''; // force a sign redraw in the new colour
      this.shown.color = '';
    }
    const color = team ? (departed ? '#8a8a8a' : team.color) : '#8a8a8a';
    if (color !== this.shown.color) {
      this.shown.color = color;
      this.flag.setTint(parseInt(color.slice(1, 7), 16) || 0x8a8a8a);
    }
    const name = team?.name ?? '';
    if (name !== this.shown.name) {
      this.shown.name = name;
      this.name.setText(truncateToFit(name.toUpperCase(), CARD_TEXT_W, (s) => this.name.setText(s).width));
    }
    const sign = team ? signText(team) : '';
    this.sign.setVisible(!!team);
    if (sign !== this.shown.sign) {
      this.shown.sign = sign;
      const col = departed ? COLORS.done : COLORS.gold;
      this.signLabel.setColor(col).setText(sign);
      const w = Math.ceil(this.signLabel.width) + 16;
      const g = this.signBg.clear();
      g.fillStyle(0x000000, 0.3).fillRect(-w / 2 + 2, -SIGN_H / 2 + 2, w, SIGN_H);
      g.fillStyle(parseInt(col.slice(1), 16), 1).fillRect(-w / 2, -SIGN_H / 2, w, SIGN_H);
      g.fillStyle(parseInt(COLORS.signBg.slice(1), 16), 1).fillRect(-w / 2 + 2, -SIGN_H / 2 + 2, w - 4, SIGN_H - 4);
    }
  }

  /** Gentle float; whole pixels only so the sign stays crisp. */
  bob(now: number): void {
    this.sign.y = this.signY + Math.round(Math.sin(now / 650 + this.slot * 1.3) * 1.5);
  }
}

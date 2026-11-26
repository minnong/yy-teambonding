// The chalkboard on the back wall: ranking rules (pure) and the text drawn over the board frame.
import type Phaser from 'phaser';
import { ordinal } from '@shared/ordinal';
import type { PublicSnapshot } from '@shared/protocol';
import type { Team } from '@shared/types';
import { BOARD, COLORS, mono, smoothText } from './roomArt';

export type BoardRowKind = 'leader' | 'team' | 'departed';
export interface BoardRow { kind: BoardRowKind; text: string }

/** `1 OTTER .....240`: exactly `width` chars, dots before the score, long names truncated with … */
export function boardLine(rank: number, name: string, score: number, width: number): string {
  const right = String(score);
  const maxLeft = width - right.length - 3; // a space and at least two dots
  let left = `${rank} ${name.toUpperCase()}`;
  if ([...left].length > maxLeft) left = `${[...left].slice(0, maxLeft - 1).join('').trimEnd()}…`;
  const dots = width - [...left].length - 1 - right.length;
  return `${left} ${'.'.repeat(Math.max(2, dots))}${right}`;
}

/** Playing teams by score descending, ties by teamOrder. Shared with the HUD leaderboard overlay. */
export function rankPlaying(s: PublicSnapshot): Team[] {
  const order = new Map(s.teamOrder.map((id, i) => [id, i]));
  return Object.values(s.teams)
    .filter((t) => t.status === 'playing')
    .sort((a, b) => b.score - a.score || (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
}

/**
 * Playing teams by score (ties by teamOrder), the leader marked when they have points, then
 * departed teams in departure order as `✅ {ordinal} {name}`.
 */
export function rankBoard(s: PublicSnapshot, width: number): BoardRow[] {
  const playing = rankPlaying(s);
  const rows: BoardRow[] = playing.map((t, i) => ({
    kind: i === 0 && t.score > 0 ? 'leader' : 'team',
    text: boardLine(i + 1, t.name, t.score, width),
  }));
  s.departures.forEach((id, i) => {
    const t = s.teams[id];
    if (!t) return;
    const text = `✅ ${ordinal(t.departedOrder ?? i + 1)} ${t.name.toUpperCase()}`;
    rows.push({ kind: 'departed', text: [...text].length > width + 1 ? `${[...text].slice(0, width).join('')}…` : text });
  });
  return rows;
}

const ROWS_PER_COL = 4;
const COL_CHARS = 22;
const ROW_H = 18;

/** Header plus two columns of four rows; only rows whose text or colour changed are re-rendered. */
export class BoardView {
  private readonly rows: Phaser.GameObjects.Text[] = [];
  private readonly glow: Phaser.GameObjects.Rectangle;
  private shown: string[] = [];

  constructor(scene: Phaser.Scene) {
    const depth = 3;
    const cx = BOARD.x + BOARD.w / 2;
    smoothText(scene.add.text(cx, BOARD.y + 17, 'LEADERBOARD', mono(16, COLORS.gold)).setOrigin(0.5, 0.5).setDepth(depth));
    const colX = [BOARD.x + 16, BOARD.x + BOARD.w / 2 + 6];
    this.glow = scene.add.rectangle(0, 0, BOARD.w / 2 - 18, ROW_H - 2, 0xffe066, 0.16).setOrigin(0, 0.5).setDepth(depth).setVisible(false);
    for (let i = 0; i < 8; i++) {
      const x = colX[Math.floor(i / ROWS_PER_COL)]!, y = BOARD.y + 37 + (i % ROWS_PER_COL) * ROW_H;
      this.rows.push(smoothText(scene.add.text(x, y, '', mono(12, '#f4f4ee')).setOrigin(0, 0.5).setDepth(depth + 0.1)));
    }
  }

  update(s: PublicSnapshot): void {
    const rows = rankBoard(s, COL_CHARS);
    this.glow.setVisible(false);
    this.rows.forEach((t, i) => {
      const r = rows[i];
      const key = r ? `${r.kind}|${r.text}` : '';
      if (r?.kind === 'leader') this.glow.setPosition(t.x - 4, t.y).setVisible(true);
      if (this.shown[i] === key) return;
      this.shown[i] = key;
      t.setColor(r?.kind === 'leader' ? COLORS.gold : r?.kind === 'departed' ? COLORS.done : '#f4f4ee');
      t.setText(r?.text ?? '');
    });
  }
}

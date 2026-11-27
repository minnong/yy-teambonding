// Procedural "A+" room art (see .superpowers/gen_style_v2.py option_a2): flat-colour shapes go
// through Phaser Graphics -> generateTexture; soft light (glow, beam, vignette) uses canvas gradients.
// Wall pieces are the mockup at 2x (its 64 px wall is our 4 rows of 32 px).
import type Phaser from 'phaser';
import { LAYOUT } from '@shared/layout';
import { TILE } from '@shared/constants';

export const WORLD_W = LAYOUT.cols * TILE;
export const WORLD_H = LAYOUT.rows * TILE;
export const WALL_H = LAYOUT.wallRows * TILE;
const FILTER_LINEAR = 0; // Phaser.Textures.FilterMode.LINEAR

export const ART = {
  bg: 'room-bg', glow: 'room-glow', vignette: 'room-vignette', lampGlow: 'room-lamp-glow',
  table: 'room-table', tableDone: 'room-table-done', flag: 'room-table-flag',
  marker: 'room-tap-marker', sparkle: 'room-sparkle', arrow: 'room-me-arrow',
} as const;

export const COLORS = {
  void: '#1e1a2b',
  plank: '#b07a48', plankAlt: ['#b07a48', '#ab7543', '#b5804e', '#a97341'], plankSeam: '#8a5a32', plankHi: '#c08a58',
  paper: '#6d5a8c', paperStripe: '#665384', baseboard: '#3a2a22', baseboardHi: '#5a4436',
  frame: '#4a3424', paneTop: '#9fd3ff', paneBottom: '#7cc0f5', glint: '#e8f6ff', beam: '#fff3c4',
  boardFrame: '#5a3a1e', chalk: '#12402e', gold: '#ffe066', done: '#9be89b', signBg: '#1d1d1d',
  card: '#f4ecd8', cardInk: '#3a2a1a',
  pot: '#8b4a2b', potRim: '#a85f3a', leaf: ['#3f8f4a', '#4fae5a', '#357a3f'], shade: '#ffd27a', pole: '#333333',
} as const;

/** Table palettes: top, edge, front, highlight, legs. */
const TABLE_WOOD = { top: '#a8703f', edge: '#8f5c32', front: '#7a4a26', hi: '#c9915c', legs: '#4a2a12' };
const TABLE_GREY = { top: '#9a9a9a', edge: '#808080', front: '#6a6a6a', hi: '#b5b5b5', legs: '#4a4a4a' };

/** Table texture: footprint (3x2 tiles) top-left sits at (TABLE_TEX.fx, TABLE_TEX.fy) inside it. */
export const TABLE_TEX = { w: 112, h: 74, fx: 8, fy: 2 };
/** Chalkboard placement in world px (centred on the back wall). */
export const BOARD = { x: 184, y: 6, w: 400, h: 108 };

const hex = (c: string): number => parseInt(c.slice(1), 16);
function shade(c: string, f: number): string {
  const n = hex(c);
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/** Deterministic pseudo-random sequence for plank tones and knots. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

type G = Phaser.GameObjects.Graphics;
function R(g: G, x: number, y: number, w: number, h: number, c: string, a = 1): void {
  g.fillStyle(hex(c), a);
  g.fillRect(x, y, w, h);
}

function drawFloor(g: G): void {
  const rand = rng(7);
  const PH = 16, PL = 96;
  for (let y = WALL_H, row = 0; y < WORLD_H; y += PH, row++) {
    const off = (row * 37) % PL;
    for (let x = -off; x < WORLD_W; x += PL) {
      R(g, x, y, PL, PH, COLORS.plankAlt[Math.floor(rand() * COLORS.plankAlt.length)]!);
      R(g, x, y + 1, PL, 2, COLORS.plankHi);
      R(g, x, y, 2, PH - 2, COLORS.plankSeam); // butt joint
      if (rand() < 0.35) R(g, x + 8 + Math.floor(rand() * 70), y + 6, 3, 2, COLORS.plankSeam, 0.8); // knot
      if (rand() < 0.5) R(g, x + 10 + Math.floor(rand() * 60), y + 9, 18 + Math.floor(rand() * 20), 1, shade(COLORS.plank, 0.9));
    }
    R(g, 0, y + PH - 2, WORLD_W, 2, COLORS.plankSeam);
  }
  R(g, 0, WALL_H, WORLD_W, 6, '#000000', 0.18); // contact shadow under the baseboard
  R(g, 0, WALL_H + 6, WORLD_W, 4, '#000000', 0.08);
}

function drawRug(g: G): void {
  // Open-floor rug, rows 22-32: a warm patterned rectangle so the big lower floor reads as a space.
  const x = 4 * TILE, y = 22 * TILE, w = 16 * TILE, h = 10 * TILE;
  R(g, x + 4, y + h, w - 4, 6, '#000000', 0.22);
  R(g, x, y, w, h, '#7d2f3a');
  R(g, x + 6, y + 6, w - 12, h - 12, '#c79a3e');
  R(g, x + 10, y + 10, w - 20, h - 20, '#9b3b47');
  for (let i = x + 18; i < x + w - 18; i += 16) { R(g, i, y + 16, 8, 4, '#e0b75a'); R(g, i, y + h - 20, 8, 4, '#e0b75a'); }
  R(g, x + 40, y + 40, w - 80, h - 80, '#a8434f');
  R(g, x + w / 2 - 40, y + h / 2 - 24, 80, 48, '#c79a3e');
  R(g, x + w / 2 - 32, y + h / 2 - 16, 64, 32, '#7d2f3a');
  for (let i = x; i < x + w; i += 8) { R(g, i + 2, y - 4, 3, 4, '#e8d7b0'); R(g, i + 2, y + h, 3, 4, '#e8d7b0'); } // fringe
}

function drawWall(g: G): void {
  R(g, 0, 0, WORLD_W, WALL_H, COLORS.paper);
  for (let x = 0; x < WORLD_W; x += 24) R(g, x, 0, 12, WALL_H, COLORS.paperStripe);
  R(g, 0, 0, WORLD_W, 4, shade(COLORS.paper, 0.75)); // crown shadow
  R(g, 0, WALL_H - 12, WORLD_W, 12, COLORS.baseboard);
  R(g, 0, WALL_H - 12, WORLD_W, 2, COLORS.baseboardHi);
}

function drawSides(g: G): void {
  // Blocked outer tiles (column 0, column 23, row 35): the tops of the side and front walls.
  const cap = '#3b2f52', edge = '#2a2140';
  R(g, 0, 0, 22, WORLD_H, cap); R(g, 22, WALL_H, 3, WORLD_H - WALL_H, edge); R(g, 25, WALL_H, 4, WORLD_H - WALL_H, '#000000', 0.15);
  R(g, WORLD_W - 22, 0, 22, WORLD_H, cap); R(g, WORLD_W - 25, WALL_H, 3, WORLD_H - WALL_H, edge); R(g, WORLD_W - 29, WALL_H, 4, WORLD_H - WALL_H, '#000000', 0.15);
  R(g, 0, WORLD_H - 22, WORLD_W, 22, cap); R(g, 0, WORLD_H - 25, WORLD_W, 3, edge);
}

function drawWindow(g: G, x: number, y: number): void {
  R(g, x, y, 108, 80, COLORS.frame);
  R(g, x + 6, y + 6, 46, 32, COLORS.paneTop); R(g, x + 56, y + 6, 46, 32, COLORS.paneTop);
  R(g, x + 6, y + 42, 46, 32, COLORS.paneBottom); R(g, x + 56, y + 42, 46, 32, COLORS.paneBottom);
  R(g, x + 10, y + 10, 12, 4, COLORS.glint); R(g, x + 60, y + 10, 8, 4, COLORS.glint); R(g, x + 10, y + 16, 4, 6, COLORS.glint);
  R(g, x - 6, y + 80, 120, 6, '#5a4030'); R(g, x - 6, y + 80, 120, 2, '#7a5a44'); // sill
  // light beam falling across the floor
  g.fillStyle(hex(COLORS.beam), 0.16);
  g.fillPoints([{ x, y: WALL_H }, { x: x + 108, y: WALL_H }, { x: x + 224, y: 340 }, { x: x + 84, y: 340 }] as Phaser.Math.Vector2[], true);
}

function drawBoardFrame(g: G): void {
  const { x, y, w, h } = BOARD;
  R(g, x + 4, y + 4, w, h, '#000000', 0.25);
  R(g, x, y, w, h, COLORS.boardFrame);
  R(g, x, y, w, 2, '#7a5230'); R(g, x, y + h - 2, w, 2, '#3e2712');
  R(g, x + 6, y + 6, w - 12, h - 12, COLORS.chalk);
  R(g, x + 30, y + 70, 90, 6, '#1a4d38', 0.6); R(g, x + 250, y + 20, 70, 5, '#1a4d38', 0.5); // smudges
  R(g, x + 40, y + h - 4, w - 80, 4, '#6b4626'); // chalk tray
  R(g, x + 60, y + h - 6, 10, 3, '#f0f0e8'); R(g, x + 80, y + h - 6, 7, 3, '#ffe066');
}

function drawLamp(g: G, x: number): void {
  R(g, x - 4, WALL_H - 16, 30, 4, '#222222');
  R(g, x + 7, 60, 8, WALL_H - 74, COLORS.pole);
  R(g, x - 11, 40, 44, 20, COLORS.shade); R(g, x - 11, 40, 44, 3, '#ffe3a3'); R(g, x - 11, 57, 44, 3, '#e0b45a');
}

function drawPlant(g: G, x: number): void {
  R(g, x + 6, 48, 12, 40, COLORS.leaf[0]); R(g, x + 22, 36, 12, 52, COLORS.leaf[1]);
  R(g, x - 6, 60, 14, 24, COLORS.leaf[2]); R(g, x + 32, 56, 14, 28, COLORS.leaf[2]);
  R(g, x + 24, 40, 4, 20, '#6cc777'); R(g, x + 8, 52, 3, 14, '#56a862');
  R(g, x, 88, 36, 34, COLORS.pot); R(g, x, 88, 36, 6, COLORS.potRim); R(g, x + 30, 94, 6, 28, shade(COLORS.pot, 0.8));
  R(g, x + 2, WALL_H - 6, 34, 4, '#000000', 0.25);
}

function drawTable(g: G, p: typeof TABLE_WOOD): void {
  const ox = TABLE_TEX.fx, oy = TABLE_TEX.fy, w = 3 * TILE;
  g.fillStyle(0x000000, 0.35); g.fillEllipse(ox + w / 2, oy + 62, 108, 16);
  for (const lx of [4, w - 11]) { R(g, ox + lx, oy + 42, 7, 18, p.legs); R(g, ox + lx, oy + 42, 2, 18, shade(p.legs, 1.3)); }
  R(g, ox, oy + 32, w, 12, p.front); R(g, ox, oy + 42, w, 2, shade(p.front, 0.8)); R(g, ox, oy + 32, w, 1, shade(p.front, 1.15));
  R(g, ox, oy, w, 32, p.top);
  R(g, ox + 4, oy + 9, 30, 1, shade(p.top, 0.92)); R(g, ox + 50, oy + 20, 40, 1, shade(p.top, 0.92)); R(g, ox + 8, oy + 25, 22, 1, shade(p.top, 0.92));
  R(g, ox, oy, w, 2, p.hi); R(g, ox, oy + 29, w, 3, p.edge);
  // cream name card
  R(g, ox + 15, oy + 23, 66, 2, '#000000', 0.25);
  R(g, ox + 14, oy + 5, 68, 18, COLORS.card); R(g, ox + 14, oy + 21, 68, 2, '#d9cdb0');
}

/** Elliptical radial alpha gradient filling the texture; radius and centre y are in half-size units. */
function radial(
  scene: Phaser.Scene, key: string, w: number, h: number, color: string, stops: [number, number][], radius = 1, cy = 0,
): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h)!;
  const ctx = tex.getContext();
  const n = hex(color), r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(w / 2, h / 2);
  const grad = ctx.createRadialGradient(0, cy, 0, 0, cy, radius);
  for (const [at, a] of stops) grad.addColorStop(at, `rgba(${r},${gg},${b},${a})`);
  ctx.fillStyle = grad;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
  tex.refresh();
  tex.setFilter(FILTER_LINEAR);
}

function gen(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: G) => void): void {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({}, false);
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

/** Window x, lamp x and plant x on the back wall. */
export const WALL_DECOR = { windowX: 48, lampX: 612, plantX: 680 };

export function makeRoomTextures(scene: Phaser.Scene): void {
  gen(scene, ART.bg, WORLD_W, WORLD_H, (g) => {
    R(g, 0, 0, WORLD_W, WORLD_H, COLORS.void);
    drawFloor(g);
    drawRug(g);
    drawWall(g);
    drawWindow(g, WALL_DECOR.windowX, 20);
    drawBoardFrame(g);
    drawLamp(g, WALL_DECOR.lampX);
    drawPlant(g, WALL_DECOR.plantX);
    drawSides(g);
  });
  gen(scene, ART.table, TABLE_TEX.w, TABLE_TEX.h, (g) => drawTable(g, TABLE_WOOD));
  gen(scene, ART.tableDone, TABLE_TEX.w, TABLE_TEX.h, (g) => drawTable(g, TABLE_GREY));
  gen(scene, ART.flag, 26, 10, (g) => { R(g, 0, 0, 26, 10, '#222222'); R(g, 1, 1, 24, 8, '#ffffff'); R(g, 1, 1, 24, 2, '#ffffff'); });
  gen(scene, ART.marker, 24, 12, (g) => {
    g.lineStyle(2, 0xffffff, 1); g.strokeEllipse(12, 6, 22, 10);
    g.fillStyle(0xffe066, 0.5); g.fillEllipse(12, 6, 8, 4);
  });
  gen(scene, ART.sparkle, 20, 20, (g) => {
    R(g, 9, 0, 2, 20, '#fff7c2'); R(g, 0, 9, 20, 2, '#fff7c2');
    R(g, 8, 4, 4, 12, '#ffe066'); R(g, 4, 8, 12, 4, '#ffe066'); R(g, 9, 9, 2, 2, '#ffffff');
  });
  gen(scene, ART.arrow, 12, 9, (g) => {
    g.fillStyle(0x1d1d1d, 1); g.fillTriangle(0, 0, 12, 0, 6, 9);
    g.fillStyle(hex(COLORS.gold), 1); g.fillTriangle(2, 1, 10, 1, 6, 7);
  });
  radial(scene, ART.glow, 256, 128, '#ffe9a8', [[0, 0.35], [1, 0]]);
  radial(scene, ART.lampGlow, 64, 64, '#ffe9a8', [[0, 0.55], [0.5, 0.2], [1, 0]]);
  // Mockup vignette: cx 50%, cy 55%, r 70% (about 1.19 half-widths), clear to 60% then 45% black.
  radial(scene, ART.vignette, 256, 256, '#000000', [[0, 0], [0.6, 0], [1, 0.45]], 1.19, 0.1);
}

/** Static scenery: background, lamp glows. All below tables and avatars. */
export function addRoomBackdrop(scene: Phaser.Scene): void {
  scene.add.image(0, 0, ART.bg).setOrigin(0, 0).setDepth(0);
  // Warm pools of light, like the mockup's central lamp glow, over the table area and the open floor.
  scene.add.image(WORLD_W / 2, 470, ART.glow).setDisplaySize(660, 420).setDepth(1);
  scene.add.image(WORLD_W / 2, 880, ART.glow).setDisplaySize(660, 380).setDepth(1);
  scene.add.image(WALL_DECOR.lampX + 11, 52, ART.lampGlow).setDisplaySize(130, 110).setDepth(1);
}

export const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Roboto Mono", monospace';
const dpr = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1);
/** Text canvases render at up to 4x so labels stay crisp at follow zoom on 2x screens. */
export const TEXT_RES = Math.min(4, Math.ceil(dpr * 2));

export function mono(size: number, color: string, extra: Phaser.Types.GameObjects.Text.TextStyle = {}): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: MONO, fontSize: `${size}px`, fontStyle: 'bold', color, resolution: TEXT_RES, ...extra };
}

/**
 * Linear sampling for a text texture so it stays legible when zoomed out. Phaser resets the filter
 * to NEAREST (pixelArt) on every re-render, so it is re-applied after each updateText.
 */
export function smoothText<T extends Phaser.GameObjects.Text>(t: T): T {
  const render = t.updateText.bind(t);
  t.updateText = () => {
    const r = render();
    t.texture.setFilter(FILTER_LINEAR);
    return r;
  };
  t.texture.setFilter(FILTER_LINEAR);
  return t;
}

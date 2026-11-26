import { AVATAR_OPTIONS, ACCESSORIES } from '@shared/constants';
import type { AvatarLook } from '@shared/types';
import {
  layersFor, randomLook, manifestFiles, assetUrl, FRAME, WALK_FRAMES, DIRECTION_ROW,
  HAIR_COLORS, TOP_COLORS, BOTTOMS_COLORS,
} from '../avatar/layers';

const images = new Map<string, HTMLImageElement>();
function loadImages(): void {
  for (const f of manifestFiles) {
    if (images.has(f.key)) continue;
    const img = new Image();
    img.src = assetUrl(f.file);
    images.set(f.key, img);
  }
}

const css = `
.ab{position:fixed;inset:0;z-index:1000;background:#1a1a2e;color:#fff;font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;overflow:hidden;touch-action:manipulation;user-select:none;-webkit-user-select:none;box-sizing:border-box;padding:max(8px,env(safe-area-inset-top)) 12px max(10px,env(safe-area-inset-bottom))}
.ab *{box-sizing:border-box}
.ab-inner{width:100%;max-width:420px;height:100%;display:flex;flex-direction:column;gap:6px}
.ab h1{margin:0;font-size:20px;text-align:center;line-height:28px}
.ab-prev{flex:0 0 auto;align-self:center;width:176px;height:176px;border-radius:16px;background:#2b2b4a;display:flex;align-items:center;justify-content:center}
.ab-prev canvas{width:160px;height:160px;image-rendering:pixelated}
.ab-rows{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;justify-content:space-evenly;gap:2px}
.ab-row{display:flex;flex-direction:column;gap:2px}
.ab-label{font-size:13px;opacity:.75;padding-left:4px}
.ab-step{display:flex;align-items:center;gap:8px}
.ab-val{flex:1;text-align:center;font-size:16px}
.ab button{font:inherit;color:inherit;border:0;cursor:pointer;-webkit-tap-highlight-color:transparent}
.ab-arrow{width:56px;height:44px;border-radius:12px;background:#3a3a63;font-size:26px;line-height:1}
.ab-arrow:active{background:#55558f}
.ab-sw{display:flex}
.ab-sw button{flex:1 1 0;min-width:44px;height:44px;background:transparent;padding:0;display:flex;align-items:center;justify-content:center}
.ab-sw i{display:block;width:32px;height:32px;border-radius:50%;border:3px solid transparent;outline:1px solid rgba(255,255,255,.25)}
.ab-sw button[aria-pressed=true] i{border-color:#fff}
.ab-actions{flex:0 0 auto;display:flex;gap:10px}
.ab-actions button{flex:1;height:52px;border-radius:14px;font-size:17px;font-weight:600}
.ab-rand{background:#3a3a63}
.ab-go{background:#ff7a3d;color:#1a1a2e}
@media (max-height:780px){.ab-prev{width:120px;height:120px}.ab-prev canvas{width:104px;height:104px}.ab h1{font-size:16px;line-height:22px}.ab-label{font-size:12px}}
@media (max-height:660px){.ab h1{display:none}.ab-prev{width:84px;height:84px}.ab-prev canvas{width:72px;height:72px}.ab-actions button{height:46px}}
`;
function injectCss(): void {
  if (document.getElementById('ab-css')) return;
  const s = document.createElement('style');
  s.id = 'ab-css';
  s.textContent = css;
  document.head.appendChild(s);
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

/** Draws the layered walk-down frame onto ctx, tinting via canvas compositing. */
function drawLook(ctx: CanvasRenderingContext2D, tmp: CanvasRenderingContext2D, look: AvatarLook, frame: number): void {
  ctx.clearRect(0, 0, FRAME, FRAME);
  const sx = frame * FRAME, sy = DIRECTION_ROW.down * FRAME;
  for (const l of layersFor(look)) {
    const img = images.get(l.key);
    if (!img || !img.complete || !img.naturalWidth) continue;
    if (l.tint === null) { ctx.drawImage(img, sx, sy, FRAME, FRAME, 0, 0, FRAME, FRAME); continue; }
    tmp.globalCompositeOperation = 'source-over';
    tmp.clearRect(0, 0, FRAME, FRAME);
    tmp.drawImage(img, sx, sy, FRAME, FRAME, 0, 0, FRAME, FRAME);
    tmp.globalCompositeOperation = 'multiply';
    tmp.fillStyle = hex(l.tint);
    tmp.fillRect(0, 0, FRAME, FRAME);
    tmp.globalCompositeOperation = 'destination-in'; // restore the sprite's alpha
    tmp.drawImage(img, sx, sy, FRAME, FRAME, 0, 0, FRAME, FRAME);
    ctx.drawImage(tmp.canvas, 0, 0);
  }
}

export function openAvatarBuilder(initial: AvatarLook | null, onDone: (look: AvatarLook) => void): void {
  injectCss();
  loadImages();
  const look: AvatarLook = { ...(initial ?? randomLook(Math.random)) };

  const root = el('div', 'ab');
  const inner = el('div', 'ab-inner');
  root.appendChild(inner);
  inner.appendChild(el('h1', undefined, 'Build your character'));

  const prev = el('div', 'ab-prev');
  const canvas = el('canvas');
  canvas.width = FRAME; canvas.height = FRAME;
  prev.appendChild(canvas);
  inner.appendChild(prev);
  const ctx = canvas.getContext('2d')!;
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = FRAME; tmpCanvas.height = FRAME;
  const tmp = tmpCanvas.getContext('2d')!;

  const rows = el('div', 'ab-rows');
  inner.appendChild(rows);
  const refreshers: (() => void)[] = [];
  const changed = () => refreshers.forEach((r) => r());

  const stepper = (label: string, field: keyof AvatarLook, name: (i: number) => string) => {
    const row = el('div', 'ab-row');
    row.appendChild(el('div', 'ab-label', label));
    const line = el('div', 'ab-step');
    const prevB = el('button', 'ab-arrow', '‹');
    const nextB = el('button', 'ab-arrow', '›');
    prevB.setAttribute('aria-label', `Previous ${label}`);
    nextB.setAttribute('aria-label', `Next ${label}`);
    const val = el('div', 'ab-val');
    const n = AVATAR_OPTIONS[field];
    prevB.onclick = () => { look[field] = (look[field] + n - 1) % n; changed(); };
    nextB.onclick = () => { look[field] = (look[field] + 1) % n; changed(); };
    line.appendChild(prevB); line.appendChild(val); line.appendChild(nextB);
    row.appendChild(line);
    rows.appendChild(row);
    refreshers.push(() => { val.textContent = `${name(look[field])} (${look[field] + 1}/${n})`; });
  };

  const swatches = (label: string, field: keyof AvatarLook, colors: number[]) => {
    const row = el('div', 'ab-row');
    row.appendChild(el('div', 'ab-label', label));
    const sw = el('div', 'ab-sw');
    const btns = colors.map((c, i) => {
      const b = el('button');
      b.setAttribute('aria-label', `${label} ${i + 1}`);
      const dot = el('i');
      dot.style.background = hex(c);
      b.appendChild(dot);
      b.onclick = () => { look[field] = i; changed(); };
      sw.appendChild(b);
      return b;
    });
    row.appendChild(sw);
    rows.appendChild(row);
    refreshers.push(() => btns.forEach((b, i) => b.setAttribute('aria-pressed', String(i === look[field]))));
  };

  stepper('Skin', 'skin', (i) => `Tone ${i + 1}`);
  stepper('Hairstyle', 'hair', (i) => `Style ${i + 1}`);
  swatches('Hair colour', 'hairColor', HAIR_COLORS);
  stepper('Top', 'top', (i) => `Top ${i + 1}`);
  swatches('Top colour', 'topColor', TOP_COLORS);
  swatches('Trousers colour', 'bottomsColor', BOTTOMS_COLORS);
  stepper('Accessory', 'accessory', (i) => ACCESSORIES[i]![0]!.toUpperCase() + ACCESSORIES[i]!.slice(1));

  const actions = el('div', 'ab-actions');
  const rand = el('button', 'ab-rand', 'Randomise');
  const go = el('button', 'ab-go', 'Enter room');
  actions.appendChild(rand); actions.appendChild(go);
  inner.appendChild(actions);

  rand.onclick = () => { Object.assign(look, randomLook(Math.random)); changed(); };

  let frame = 1;
  const timer = window.setInterval(() => {
    frame = frame % (WALK_FRAMES - 1) + 1; // frames 1..8; 0 is the standing pose
    drawLook(ctx, tmp, look, frame);
  }, 110);

  const close = () => { clearInterval(timer); root.remove(); };
  go.onclick = () => { const result = { ...look }; close(); onDone(result); };

  changed();
  drawLook(ctx, tmp, look, frame);
  document.body.appendChild(root);
}

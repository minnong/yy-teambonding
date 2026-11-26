// The shared room: Phaser scene (scenery, tables, wall board, avatars, sparkles, camera) and the
// startRoom() bootstrap that owns the DOM host, the Phaser game, resizing and net subscriptions.
import Phaser from 'phaser';
import type { Net } from '../net';
import type { Me } from '../identity';
import type { PublicSnapshot } from '@shared/protocol';
import type { Motion, PlayerId, Vec } from '@shared/types';
import { PROXIMITY } from '@shared/constants';
import { nearTable } from '@shared/layout';
import { preloadAvatarLayers } from '../avatar/layers';
import { ART, COLORS, WORLD_H, WORLD_W, addRoomBackdrop, makeRoomTextures } from './roomArt';
import { AvatarSprite } from './avatarSprite';
import { TableView } from './tables';
import { BoardView } from './leaderboard';
import { ZOOM_TWEEN_MS, chooseView, clampCenter, easeInOut, lerp } from './camera';
import { attachKeyboard, attachTaps } from './input';
import { SceneEffects, type RoomEffects } from './effects';

export interface RoomApi {
  scene: RoomScene;
  /** Tap on another player's avatar. Returns an unsubscribe fn. */
  onTapAvatar(fn: (playerId: PlayerId) => void): () => void;
  /**
   * Online players within PROXIMITY of me (nearest first, me excluded) and whether I am at my own
   * table. Fires on subscribe with the current value, then only when the set or the flag changes.
   */
  onNearChange(fn: (others: PlayerId[], nearOwnTable: boolean) => void): () => void;
  setZoomedOut(b: boolean): void;
  /** Transient scene effects for server events (float, emote bubble, table flash). */
  effects: RoomEffects;
  destroy(): void;
}

const TABLE_SLOTS = 7;
const VIGNETTE_DEPTH = 1_000_000;

export class RoomScene extends Phaser.Scene {
  private snap: PublicSnapshot;
  private snapDirty = true;
  private firstApply = true;
  private readonly motions = new Map<PlayerId, Motion>();
  private readonly avatars = new Map<PlayerId, AvatarSprite>();
  private readonly tables: TableView[] = [];
  private board!: BoardView;
  private readonly sparkles = new Map<string, Phaser.GameObjects.Image>();
  private marker!: Phaser.GameObjects.Image;
  private vignette!: Phaser.GameObjects.Image;
  private detach: (() => void)[] = [];
  private lastWall = 0;

  // camera, in CSS px; Phaser zoom = zoom * dpr
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private zoomedOut = false;
  private view = { zoom: 1, cx: WORLD_W / 2, cy: WORLD_H / 2 };
  private tween: { start: number; zoom: number; cx: number; cy: number } | null = null;

  // proximity
  private readonly nearBuf: AvatarSprite[] = [];
  private nearIds: PlayerId[] = [];
  private nearSet = new Set<PlayerId>();
  private nearOwn = false;
  private readonly mePt: Vec = { x: 0, y: 0 };
  readonly tapFns = new Set<(id: PlayerId) => void>();
  /** Effects requested before create() are dropped: they are momentary by nature. */
  private fx: SceneEffects | null = null;
  readonly nearFns = new Set<(others: PlayerId[], nearOwnTable: boolean) => void>();

  constructor(private readonly net: Net, private readonly me: Me, snapshot: PublicSnapshot) {
    super({ key: 'room' });
    this.snap = snapshot;
    this.setSnapshot(snapshot);
  }

  // ---------- data in (safe before create) ----------

  setSnapshot(s: PublicSnapshot): void {
    this.snap = s;
    this.snapDirty = true;
    for (const [id, m] of Object.entries(s.motions)) this.motions.set(id, m);
    for (const id of [...this.motions.keys()]) if (!s.players[id]) this.motions.delete(id);
  }

  setMotion(id: PlayerId, m: Motion): void { this.motions.set(id, m); }

  setViewSize(cssW: number, cssH: number, dpr: number): void {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.dpr = dpr;
  }

  setZoomedOut(b: boolean): void {
    if (b === this.zoomedOut) return;
    this.zoomedOut = b;
    this.tween = { start: performance.now(), ...this.view };
  }

  /** My feet in world px, or null before my avatar exists. */
  myPos(): Vec | null {
    const a = this.avatars.get(this.me.playerId);
    return a ? { x: a.x, y: a.y } : null;
  }

  get nearState(): { others: PlayerId[]; nearOwnTable: boolean } { return { others: [...this.nearIds], nearOwnTable: this.nearOwn }; }

  // ---------- lifecycle ----------

  preload(): void { preloadAvatarLayers(this); }

  create(): void {
    makeRoomTextures(this);
    addRoomBackdrop(this);
    for (let i = 0; i < TABLE_SLOTS; i++) this.tables.push(new TableView(this, i));
    this.board = new BoardView(this);
    this.marker = this.add.image(0, 0, ART.marker).setDepth(2).setVisible(false);
    this.vignette = this.add.image(0, 0, ART.vignette).setScrollFactor(0).setDepth(VIGNETTE_DEPTH);
    this.detach.push(attachTaps(this, { onTap: (w) => this.onTap(w) }));
    this.fx = new SceneEffects({
      scene: this,
      anchorOf: (id) => {
        const a = this.avatars.get(id);
        return a && a.online && a.container.visible ? { x: a.x, top: a.top } : null;
      },
      hop: (id) => this.avatars.get(id)?.hop(),
      slotOf: (teamId) => this.snap.teamOrder.indexOf(teamId),
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.shutdown());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.shutdown());
    this.lastWall = performance.now();
    this.update();
  }

  update(): void {
    const now = this.net.serverNow();
    const wall = performance.now();
    const dt = wall - this.lastWall;
    this.lastWall = wall;
    if (this.snapDirty) this.applySnapshot();
    for (const a of this.avatars.values()) {
      const m = this.motions.get(a.id);
      if (m) a.setMotion(m);
      a.update(now, dt, wall);
    }
    this.updateProximity();
    this.fx?.update(wall);
    for (const t of this.tables) t.bob(wall);
    this.updateCamera(wall);
  }

  get effects(): RoomEffects {
    return {
      float: (teamId, text) => this.fx?.float(teamId, text),
      emote: (from, kind, target) => this.fx?.emote(from, kind, target),
      flashTable: (slot) => this.fx?.flashTable(slot),
    };
  }

  private shutdown(): void {
    for (const d of this.detach) d();
    this.detach = [];
    this.fx?.destroy();
    this.fx = null;
  }

  // ---------- snapshot -> scene ----------

  private applySnapshot(): void {
    this.snapDirty = false;
    const s = this.snap;
    for (const [id, a] of this.avatars) {
      if (!s.players[id]?.look || !this.motions.has(id)) { a.destroy(); this.avatars.delete(id); }
    }
    for (const p of Object.values(s.players)) {
      const m = this.motions.get(p.id);
      if (!p.look || !m) continue; // still in the avatar builder, or never connected
      const isMe = p.id === this.me.playerId;
      let a = this.avatars.get(p.id);
      if (!a) {
        a = new AvatarSprite(this, { id: p.id, name: p.name, look: p.look, motion: m, isMe });
        if (!this.firstApply) a.startHidden(); // newcomers fade in
        this.avatars.set(p.id, a);
      } else {
        a.setLook(p.look);
      }
      a.setOnline(isMe || !!s.online[p.id]);
      a.setDeparted(s.teams[p.teamId]?.status === 'departed');
    }
    if (this.firstApply) for (const a of this.avatars.values()) a.snapFade();
    this.firstApply = false;

    for (let i = 0; i < this.tables.length; i++) {
      const id = s.teamOrder[i];
      this.tables[i]!.update(id ? s.teams[id] : undefined);
    }
    this.board.update(s);
    this.syncSparkles(s);
  }

  private syncSparkles(s: PublicSnapshot): void {
    const live = new Set(s.collectibles.map((c) => c.id));
    for (const [id, img] of this.sparkles) {
      if (live.has(id)) continue;
      this.tweens.killTweensOf(img);
      img.destroy();
      this.sparkles.delete(id);
    }
    for (const c of s.collectibles) {
      if (this.sparkles.has(c.id)) continue;
      const img = this.add.image(c.pos.x, c.pos.y - 12, ART.sparkle).setDepth(c.pos.y);
      this.tweens.add({ targets: img, scale: { from: 0.7, to: 1.15 }, alpha: { from: 0.65, to: 1 }, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.tweens.add({ targets: img, y: img.y - 4, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.sparkles.set(c.id, img);
    }
  }

  // ---------- input ----------

  private onTap(w: Vec): void {
    // Hit boxes are at least 44 CSS px, whatever the zoom.
    const min = 44 / this.view.zoom;
    let best: AvatarSprite | null = null;
    for (const a of this.avatars.values()) {
      if (a.isMe || !a.online || !a.hits(w.x, w.y, min, min)) continue;
      if (!best || a.y > best.y) best = a;
    }
    if (best) {
      for (const fn of this.tapFns) fn(best.id);
      return;
    }
    const to = { x: Math.round(Phaser.Math.Clamp(w.x, 0, WORLD_W)), y: Math.round(Phaser.Math.Clamp(w.y, 0, WORLD_H)) };
    this.net.act({ type: 'move', to });
    this.tweens.killTweensOf(this.marker);
    this.marker.setPosition(to.x, to.y).setVisible(true).setAlpha(1).setScale(0.6);
    this.tweens.add({ targets: this.marker, scale: 1.3, alpha: 0, duration: 650, ease: 'Quad.easeOut', onComplete: () => this.marker.setVisible(false) });
  }

  // ---------- proximity ----------

  private updateProximity(): void {
    const meA = this.avatars.get(this.me.playerId);
    if (!meA) {
      // My avatar is gone (removed, or look reset): nobody is near and I am at no table (R25c).
      if (this.nearIds.length === 0 && !this.nearOwn) return;
      this.nearIds = [];
      this.nearSet = new Set();
      this.nearOwn = false;
      for (const fn of this.nearFns) fn([], false);
      return;
    }
    const buf = this.nearBuf;
    buf.length = 0;
    for (const a of this.avatars.values()) {
      if (a === meA) { a.setLabelVisible(true); continue; }
      const near = a.online && Math.hypot(a.x - meA.x, a.y - meA.y) <= PROXIMITY;
      a.setLabelVisible(near);
      if (near) buf.push(a);
    }
    let changed = buf.length !== this.nearSet.size;
    for (let i = 0; !changed && i < buf.length; i++) changed = !this.nearSet.has(buf[i]!.id);
    const myTeam = this.snap.players[this.me.playerId]?.teamId;
    const slot = myTeam ? this.snap.teamOrder.indexOf(myTeam) : -1;
    this.mePt.x = meA.x;
    this.mePt.y = meA.y;
    const own = slot >= 0 && nearTable(this.mePt, slot);
    if (!changed && own === this.nearOwn) return;
    const d = (a: AvatarSprite) => Math.hypot(a.x - meA.x, a.y - meA.y);
    this.nearIds = [...buf].sort((a, b) => d(a) - d(b)).map((a) => a.id);
    this.nearSet = new Set(this.nearIds);
    this.nearOwn = own;
    for (const fn of this.nearFns) fn([...this.nearIds], own);
  }

  // ---------- camera ----------

  private updateCamera(wall: number): void {
    const target = chooseView(this.cssW, this.cssH, WORLD_W, WORLD_H, this.zoomedOut);
    const meA = this.avatars.get(this.me.playerId);
    const fx = meA ? meA.x : WORLD_W / 2, fy = meA ? meA.y - 24 : WORLD_H / 2; // frame the body, not the feet
    let zoom = target.zoom;
    let cx = clampCenter(fx, this.cssW, zoom, WORLD_W), cy = clampCenter(fy, this.cssH, zoom, WORLD_H);
    if (this.tween) {
      // Wall-clock driven, so a tab backgrounded mid-tween simply lands on the target.
      const t = Math.min(1, Math.max(0, (wall - this.tween.start) / ZOOM_TWEEN_MS));
      const e = easeInOut(t);
      zoom = lerp(this.tween.zoom, zoom, e);
      cx = clampCenter(lerp(this.tween.cx, cx, e), this.cssW, zoom, WORLD_W);
      cy = clampCenter(lerp(this.tween.cy, cy, e), this.cssH, zoom, WORLD_H);
      if (t >= 1) this.tween = null;
    }
    this.view.zoom = zoom;
    this.view.cx = cx;
    this.view.cy = cy;
    const cam = this.cameras.main;
    const z = zoom * this.dpr;
    if (cam.zoom !== z) cam.setZoom(z);
    cam.centerOn(cx, cy);
    // Screen-space vignette: scroll factor 0 objects still scale with zoom about the view centre.
    const vw = cam.width / z, vh = cam.height / z;
    if (this.vignette.displayWidth !== vw || this.vignette.displayHeight !== vh || this.vignette.x !== cam.width / 2) {
      this.vignette.setPosition(cam.width / 2, cam.height / 2).setDisplaySize(vw, vh);
    }
  }
}

// ---------- bootstrap ----------

function el(cls: string, id: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  d.id = id;
  return d;
}

/**
 * Mounts the room into #app: `#lb-room` holds the canvas, `#lb-hud` (above it, pointer-events off
 * except on its children) is where Task 11 mounts DOM overlays.
 */
export function startRoom(net: Net, me: Me, snapshot: PublicSnapshot): RoomApi {
  const app = document.querySelector<HTMLElement>('#app')!;
  app.replaceChildren();
  const host = el('lb-room', 'lb-room');
  const hud = el('lb-hud', 'lb-hud');
  app.appendChild(host);
  app.appendChild(hud);

  const scene = new RoomScene(net, me, snapshot);
  const size = () => ({ w: Math.max(1, host.clientWidth), h: Math.max(1, host.clientHeight), dpr: Math.min(2, window.devicePixelRatio || 1) });
  const s0 = size();
  scene.setViewSize(s0.w, s0.h, s0.dpr);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    width: Math.round(s0.w * s0.dpr),
    height: Math.round(s0.h * s0.dpr),
    backgroundColor: COLORS.void,
    pixelArt: true,
    roundPixels: true,
    banner: false,
    disableContextMenu: true,
    audio: { noAudio: true },
    input: { activePointers: 2 },
    // The canvas is CSS size x DPR (capped at 2) and shown at CSS size: crisp but bounded fill cost.
    scale: { mode: Phaser.Scale.NONE, zoom: 1 / s0.dpr },
    scene,
  });

  let raf = 0;
  const resize = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const { w, h, dpr } = size();
      scene.setViewSize(w, h, dpr);
      game.scale.setZoom(1 / dpr);
      game.scale.resize(Math.round(w * dpr), Math.round(h * dpr));
      const c = game.canvas;
      if (c) { c.style.width = `${w}px`; c.style.height = `${h}px`; }
    });
  };
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  resize();

  const detachKeys = attachKeyboard({
    walk: (dir) => { net.act({ type: 'walk', dir }); },
    stop: () => { net.act({ type: 'stop' }); },
  });
  const unsubs = [
    detachKeys,
    net.on('snapshot', (m) => scene.setSnapshot(m.snapshot)),
    net.on('welcome', (m) => scene.setSnapshot(m.snapshot)), // reconnect: full state
    net.on('motion', (m) => scene.setMotion(m.playerId, m.motion)),
  ];

  const api: RoomApi = {
    scene,
    onTapAvatar(fn) { scene.tapFns.add(fn); return () => { scene.tapFns.delete(fn); }; },
    onNearChange(fn) {
      scene.nearFns.add(fn);
      const cur = scene.nearState;
      fn(cur.others, cur.nearOwnTable);
      return () => { scene.nearFns.delete(fn); };
    },
    setZoomedOut(b) { scene.setZoomedOut(b); },
    effects: scene.effects,
    destroy() {
      for (const u of unsubs) u();
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      scene.tapFns.clear();
      scene.nearFns.clear();
      game.destroy(true);
      host.remove();
      hud.remove();
      if (import.meta.env.DEV) delete (window as { __lobbyDebug?: unknown }).__lobbyDebug;
    },
  };

  if (import.meta.env.DEV) {
    (window as { __lobbyDebug?: unknown }).__lobbyDebug = { me: () => scene.myPos(), room: api };
  }
  return api;
}

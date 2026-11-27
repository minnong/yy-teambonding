import type Phaser from 'phaser';
import { AVATAR_OPTIONS, ACCESSORIES } from '@shared/constants';
import type { AvatarLook } from '@shared/types';
import manifest from '../../../assets/lpc-manifest.json';

export const LAYER_ORDER = ['body', 'bottoms', 'shoes', 'top', 'hair', 'accessory'] as const;
export const FRAME = 64;
export const WALK_FRAMES = 9;
/** Rows in each 576x256 walk sheet. */
export const DIRECTION_ROW = { up: 0, left: 1, down: 2, right: 3 } as const;

// Tints multiply the grey-ramp art.
export const HAIR_COLORS = [0x2b1d14, 0x5a3825, 0x8a5a33, 0xd6a24f, 0xc4452b, 0x9aa0a6, 0x3f7fd9, 0xe05aa8];
export const TOP_COLORS = [0xe8503f, 0xf2a03d, 0xf2d24b, 0x5cb85c, 0x3fa7d6, 0x4f5fd6, 0x9b59d6, 0xf4f1ea];
export const BOTTOMS_COLORS = [0x2d3a5a, 0x4a4f57, 0x7a5a3a, 0x3f6b4a, 0x8a8f99, 0x1c1c22];

export interface Layer { key: string; tint: number | null }

export const textureKey = {
  body: (i: number) => `lpc-body-${i}`,
  hair: (i: number) => `lpc-hair-${i}`,
  top: (i: number) => `lpc-top-${i}`,
  bottoms: () => 'lpc-bottoms-0',
  shoes: () => 'lpc-shoes-0',
  accessory: (i: number) => `lpc-acc-${ACCESSORIES[i]}`,
};

/** Layers in draw order (bottom to top). */
export function layersFor(look: AvatarLook): Layer[] {
  const out: Layer[] = [
    { key: textureKey.body(look.skin), tint: null },
    { key: textureKey.bottoms(), tint: BOTTOMS_COLORS[look.bottomsColor]! },
    { key: textureKey.shoes(), tint: null },
    { key: textureKey.top(look.top), tint: TOP_COLORS[look.topColor]! },
    { key: textureKey.hair(look.hair), tint: HAIR_COLORS[look.hairColor]! },
  ];
  if (look.accessory > 0) out.push({ key: textureKey.accessory(look.accessory), tint: null });
  return out;
}

export function randomLook(rng: () => number = Math.random): AvatarLook {
  const pick = (n: number) => Math.min(n - 1, Math.floor(rng() * n));
  return {
    skin: pick(AVATAR_OPTIONS.skin), hair: pick(AVATAR_OPTIONS.hair), hairColor: pick(AVATAR_OPTIONS.hairColor),
    top: pick(AVATAR_OPTIONS.top), topColor: pick(AVATAR_OPTIONS.topColor),
    bottomsColor: pick(AVATAR_OPTIONS.bottomsColor), accessory: pick(AVATAR_OPTIONS.accessory),
  };
}

export const assetUrl = (file: string) => `/assets/lpc/${file}`;
export const manifestFiles = manifest.files as { key: string; file: string }[];

export function preloadAvatarLayers(scene: Phaser.Scene): void {
  for (const f of manifestFiles) {
    if (!scene.textures.exists(f.key)) scene.load.spritesheet(f.key, assetUrl(f.file), { frameWidth: FRAME, frameHeight: FRAME });
  }
}

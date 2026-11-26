import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AVATAR_OPTIONS, ACCESSORIES } from '../../src/shared/constants';
import type { AvatarLook } from '../../src/shared/types';
import { layersFor, randomLook, LAYER_ORDER, HAIR_COLORS, TOP_COLORS, BOTTOMS_COLORS } from '../../src/client/avatar/layers';

const root = resolve(import.meta.dirname, '../..');
const manifest = JSON.parse(readFileSync(resolve(root, 'assets/lpc-manifest.json'), 'utf8')) as { files: { key: string; file: string }[] };
const keys = new Set(manifest.files.map((f) => f.key));
const base: AvatarLook = { skin: 0, hair: 0, hairColor: 0, top: 0, topColor: 0, bottomsColor: 0, accessory: 0 };
const kind = (k: string) => k.split('-')[1]!;
const order = (k: string) => LAYER_ORDER.indexOf((({ body: 'body', bottoms: 'bottoms', shoes: 'shoes', top: 'top', hair: 'hair', acc: 'accessory' }) as Record<string, (typeof LAYER_ORDER)[number]>)[kind(k)]!);

describe('layersFor', () => {
  it('puts layers in LAYER_ORDER', () => {
    const l = layersFor({ ...base, accessory: 2 });
    const idx = l.map((x) => order(x.key));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    expect(l.map((x) => kind(x.key))).toEqual(['body', 'bottoms', 'shoes', 'top', 'hair', 'acc']);
  });
  it('accessory none adds no layer', () => {
    expect(layersFor(base).some((x) => kind(x.key) === 'acc')).toBe(false);
    expect(layersFor(base)).toHaveLength(5);
  });
  it('tints hair, top and bottoms only', () => {
    const l = layersFor({ ...base, hairColor: 1, topColor: 2, bottomsColor: 3, accessory: 1 });
    for (const x of l) expect(typeof x.tint === 'number' || x.tint === null).toBe(true);
    expect(l.find((x) => kind(x.key) === 'hair')!.tint).toBe(HAIR_COLORS[1]);
    expect(l.find((x) => kind(x.key) === 'top')!.tint).toBe(TOP_COLORS[2]);
    expect(l.find((x) => kind(x.key) === 'bottoms')!.tint).toBe(BOTTOMS_COLORS[3]);
    for (const k of ['body', 'shoes', 'acc']) expect(l.find((x) => kind(x.key) === k)!.tint).toBeNull();
  });
  it('palette sizes match AVATAR_OPTIONS', () => {
    expect(HAIR_COLORS).toHaveLength(AVATAR_OPTIONS.hairColor);
    expect(TOP_COLORS).toHaveLength(AVATAR_OPTIONS.topColor);
    expect(BOTTOMS_COLORS).toHaveLength(AVATAR_OPTIONS.bottomsColor);
  });
  it('every key for all option combinations exists in the manifest, and its file exists', () => {
    for (const dim of Object.keys(AVATAR_OPTIONS) as (keyof AvatarLook)[]) {
      for (let i = 0; i < AVATAR_OPTIONS[dim]; i++) {
        for (const l of layersFor({ ...base, [dim]: i })) expect(keys.has(l.key), l.key).toBe(true);
      }
    }
    for (const f of manifest.files) expect(existsSync(resolve(root, 'public/assets/lpc', f.file)), f.file).toBe(true);
    expect(ACCESSORIES.length).toBe(AVATAR_OPTIONS.accessory);
  });
});

describe('randomLook', () => {
  it('stays in range', () => {
    for (const rng of [() => 0, () => 0.999999, Math.random]) {
      for (let n = 0; n < 50; n++) {
        const l = randomLook(rng);
        for (const dim of Object.keys(AVATAR_OPTIONS) as (keyof AvatarLook)[]) {
          expect(Number.isInteger(l[dim])).toBe(true);
          expect(l[dim]).toBeGreaterThanOrEqual(0);
          expect(l[dim]).toBeLessThan(AVATAR_OPTIONS[dim]);
        }
      }
    }
  });
});

import { describe, it, expect } from 'vitest';
import { fitZoom, followZoom, isPhoneLayout, chooseView, clampCenter, FOLLOW_TILES } from '../../src/client/room/camera';
import { TILE } from '@shared/constants';

const W = 768, H = 1152;

describe('camera', () => {
  it('fitZoom fits 768x1152 in 390x700', () => {
    // The brief's "≈0.338" is 390/1152, i.e. the room's height squeezed into the phone's width.
    // Fitting means the tighter of the two axes: min(390/768, 700/1152) = 0.5078.
    expect(fitZoom(390, 700, W, H)).toBeCloseTo(0.5078, 3);
    expect(W * fitZoom(390, 700, W, H)).toBeLessThanOrEqual(390);
    expect(H * fitZoom(390, 700, W, H)).toBeLessThanOrEqual(700);
    expect(fitZoom(1440, 900, W, H)).toBeCloseTo(900 / 1152, 5);
  });

  it('followZoom(390) shows ~12 tiles', () => {
    const tiles = 390 / followZoom(390) / TILE;
    expect(tiles).toBeCloseTo(FOLLOW_TILES, 5);
    expect(tiles).toBeGreaterThanOrEqual(11.5);
    expect(tiles).toBeLessThanOrEqual(12.5);
  });

  it('followZoom(1440) is capped at 2', () => {
    expect(followZoom(1440)).toBe(2);
    expect(followZoom(5000)).toBe(2);
  });

  it('isPhoneLayout(390,844) true, (1440,900) false', () => {
    expect(isPhoneLayout(390, 844)).toBe(true);
    expect(isPhoneLayout(1440, 900)).toBe(false);
    expect(isPhoneLayout(844, 390)).toBe(false); // landscape phone
    expect(isPhoneLayout(599, 900)).toBe(true);
    expect(isPhoneLayout(600, 900)).toBe(false);
  });

  it('chooseView: phones follow, roomy laptops fit, cramped ones follow, zoom-out always fits', () => {
    expect(chooseView(390, 844, W, H, false)).toEqual({ mode: 'follow', zoom: followZoom(390) });
    expect(chooseView(390, 844, W, H, true)).toEqual({ mode: 'fit', zoom: fitZoom(390, 844, W, H) });
    expect(chooseView(1440, 900, W, H, false)).toEqual({ mode: 'fit', zoom: fitZoom(1440, 900, W, H) });
    expect(chooseView(1280, 720, W, H, false)).toEqual({ mode: 'follow', zoom: 2 }); // fit 0.625 < 0.75
    expect(chooseView(844, 390, W, H, false).mode).toBe('follow');
  });

  it('clampCenter keeps the view inside the world, or centres a world smaller than the view', () => {
    // view 390 css px at zoom 1: half = 195
    expect(clampCenter(10, 390, 1, W)).toBe(195);
    expect(clampCenter(760, 390, 1, W)).toBe(W - 195);
    expect(clampCenter(400, 390, 1, W)).toBe(400);
    // zoom 0.4: the view spans 975 world px > 768, so centre the room
    expect(clampCenter(100, 390, 0.4, W)).toBe(W / 2);
  });
});

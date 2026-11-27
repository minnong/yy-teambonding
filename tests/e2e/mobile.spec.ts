// Phone checks: join flow, no zoom/scroll anywhere, and tap-to-walk. Each test resets the room.
import { test, expect, type Page } from '@playwright/test';
import { expectInputsAtLeast16px, expectNoZoomOrScroll, joinAsNewcomer, myPos, resetRoom, TEAM } from './helpers';

test.beforeEach(async ({ baseURL }) => { await resetRoom(baseURL!); });

const vp = (page: Page) => page.viewportSize()!;

async function tapFloor(page: Page, fx: number, fy: number): Promise<void> {
  const { width, height } = vp(page);
  await page.touchscreen.tap(Math.round(width * fx), Math.round(height * fy));
}

async function doubleTap(page: Page, fx: number, fy: number): Promise<void> {
  await tapFloor(page, fx, fy);
  await page.waitForTimeout(60);
  await tapFloor(page, fx, fy);
}

test('mobile: join, build avatar, enter room', async ({ page }) => {
  await joinAsNewcomer(page, 'E2E Joiner');
  const box = await page.locator('#lb-room canvas').boundingBox();
  expect(box!.width).toBeGreaterThan(300);
  expect(box!.height).toBeGreaterThan(500);
  expect(await myPos(page)).not.toBeNull();
});

test('mobile: no zoom or scroll', async ({ page }) => {
  // Fresh context, before joining: hammer the picker, then focus the "I'm not on the list" input.
  await page.goto('/');
  await expect(page.getByRole('button', { name: "I'm not on the list" })).toBeVisible();
  for (let i = 0; i < 5; i++) await tapFloor(page, 0.5, 0.06);
  await doubleTap(page, 0.5, 0.06);
  await page.getByRole('button', { name: "I'm not on the list" }).tap();
  const input = page.getByRole('textbox', { name: 'Your name' });
  await input.tap();
  await expect(input).toBeFocused();
  await page.waitForTimeout(400);
  await expectNoZoomOrScroll(page);
  expect(await expectInputsAtLeast16px(page)).toBeGreaterThan(0);

  // In the room: 5 floor taps and a double tap must not zoom or scroll the page either.
  await page.getByRole('button', { name: 'Back' }).tap();
  await joinAsNewcomer(page, 'E2E Zoomer', TEAM.comet);
  for (let i = 0; i < 5; i++) { await tapFloor(page, 0.3 + i * 0.1, 0.6); await page.waitForTimeout(120); }
  await doubleTap(page, 0.5, 0.55);
  await page.waitForTimeout(400);
  await expectNoZoomOrScroll(page);
  await expectInputsAtLeast16px(page);
});

test('mobile: tap moves my avatar', async ({ page }) => {
  await joinAsNewcomer(page, 'E2E Walker', TEAM.mango);
  await page.waitForTimeout(300);
  const before = await myPos(page);
  expect(before).not.toBeNull();
  await tapFloor(page, 0.5, 0.68); // below me on the open floor, clear of the HUD corners and chips
  await page.waitForTimeout(1500);
  const after = await myPos(page);
  expect(after).not.toBeNull();
  expect(Math.hypot(after!.x - before!.x, after!.y - before!.y)).toBeGreaterThan(16);
});

test('mobile: rapid taps coalesce into one move per second (R27)', async ({ page }) => {
  const moves: number[] = [];
  page.on('websocket', (ws) => ws.on('framesent', (f) => {
    if (typeof f.payload === 'string' && f.payload.includes('"type":"move"')) moves.push(Date.now());
  }));
  await joinAsNewcomer(page, 'E2E Tapper', TEAM.nova);
  const t0 = Date.now();
  let lastTapAt = 0;
  for (let i = 0; i < 6; i++) {
    lastTapAt = Date.now();
    await tapFloor(page, 0.3 + i * 0.08, 0.66);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(1500); // room for the trailing move
  // Timing-independent checks (a loaded machine stretches the burst): the first tap goes at once,
  // sends are at least ~1 s apart (timed here as frames arrive, so allow some jitter), the burst
  // folds into fewer moves than taps, and the latest target goes last as a trailing move.
  expect(moves.length).toBeGreaterThanOrEqual(2);
  expect(moves[0]! - t0).toBeLessThan(900);
  for (let i = 1; i < moves.length; i++) expect(moves[i]! - moves[i - 1]!).toBeGreaterThanOrEqual(950);
  expect(moves.length).toBeLessThan(6);
  expect(moves.at(-1)!).toBeGreaterThanOrEqual(lastTapAt);
});

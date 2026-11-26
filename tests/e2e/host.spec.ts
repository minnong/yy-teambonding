// The facilitator console: PIN, start, call next with the exact confirm copy, undo, stale leader.
import { test, expect, type Page } from '@playwright/test';
import { PIN, hostSocket, resetRoom } from './helpers';

test.beforeEach(async ({ baseURL }) => { await resetRoom(baseURL!); });

/**
 * Types the PIN and enters. Retried because the dev server may reload the page once on the first
 * visit after a source edit, which would wipe a PIN typed in the meantime.
 */
async function enterPin(page: Page, phase: 'WARM-UP' | 'COMPETITION'): Promise<void> {
  await page.goto('/host');
  await expect(async () => {
    if (await page.locator('.h-pill').count() === 0) {
      await page.getByLabel('Host PIN').fill(PIN, { timeout: 2000 });
      await page.getByRole('button', { name: 'Enter' }).click({ timeout: 2000 });
    }
    await expect(page.locator('.h-pill')).toHaveText(phase, { timeout: 3000 });
  }).toPass({ timeout: 20_000 });
}
const openHost = (page: Page) => enterPin(page, 'WARM-UP');
const openHostInCompetition = (page: Page) => enterPin(page, 'COMPETITION');

const board = (page: Page) => page.locator('.h-board');
const callBtn = (page: Page) => page.getByRole('button', { name: 'CALL NEXT TEAM' });
const dialog = (page: Page) => page.getByRole('dialog');

test('host: start, call next shows confirm with exact copy, undo', async ({ page }) => {
  await openHost(page);
  await expect(page.locator('.h-timer-value')).toHaveText('—');
  await expect(callBtn(page)).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Undo last call' })).toBeDisabled();

  await page.getByRole('button', { name: 'START COMPETITION' }).click();
  await expect(dialog(page)).toContainText('TEAM OTTER goes first');
  await dialog(page).getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('.h-pill')).toHaveText('COMPETITION');
  await expect(page.getByRole('button', { name: 'START COMPETITION' })).toBeDisabled();
  await expect(board(page)).toContainText('✅ 1ST Otter');
  await expect(page.locator('.h-timer-value')).toHaveText(/^0:0\d$/);

  // Give Pixel the lead from the Scores tab, so the next call is deterministic.
  await page.getByRole('tab', { name: 'Scores' }).click();
  // A double tap sends once: the one-shot guard disables every host button until the reply.
  await page.getByRole('button', { name: 'Add 10 points to Pixel' }).dblclick();
  await expect(page.locator('.h-adj', { hasText: 'Pixel' })).toContainText('10 pts');
  await page.waitForTimeout(300);
  await expect(page.locator('.h-adj', { hasText: 'Pixel' })).toContainText('10 pts');
  await page.getByRole('tab', { name: 'Run' }).click();
  await expect(page.locator('.h-next')).toHaveText('Next up: PIXEL · 10 pts');

  await callBtn(page).click();
  await expect(page.locator('#h-confirm-text')).toHaveText('This will call TEAM PIXEL (10 pts)');
  await dialog(page).getByRole('button', { name: 'Yes, call them' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(board(page)).toContainText('✅ 2ND Pixel');

  const undo = page.getByRole('button', { name: 'Undo last call (bring back PIXEL)' });
  await expect(undo).toBeEnabled();
  await undo.click();
  await dialog(page).getByRole('button', { name: 'Bring them back' }).click();
  await expect(board(page).locator('.h-row-departed')).toHaveCount(1);
  await expect(board(page).locator('.h-row-playing', { hasText: 'Pixel' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Undo last call', exact: true })).toBeDisabled();
});

test('host: a changed leader shows the error and the confirm stays closed', async ({ page, baseURL }) => {
  const side = await hostSocket(baseURL!);
  try {
    await side.act({ type: 'host.startCompetition' });
    await side.act({ type: 'host.adjustScore', teamId: 'comet', delta: 10 });
    await openHostInCompetition(page);
    await expect(page.locator('.h-next')).toHaveText('Next up: COMET · 10 pts');
    await callBtn(page).click();
    await expect(page.locator('#h-confirm-text')).toHaveText('This will call TEAM COMET (10 pts)');
    // Someone else's points land while the confirm is open: the leader is now Nova.
    await side.act({ type: 'host.adjustScore', teamId: 'nova', delta: 50 });
    await dialog(page).getByRole('button', { name: 'Yes, call them' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'The leader changed, check again' })).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    await expect(board(page).locator('.h-row-departed')).toHaveCount(1);
    await callBtn(page).click();
    await expect(page.locator('#h-confirm-text')).toHaveText('This will call TEAM NOVA (50 pts)');
  } finally { side.close(); }
});

test('host: wrong PIN is cleared and shown', async ({ page }) => {
  await page.goto('/host');
  await page.getByLabel('Host PIN').fill('0000');
  await page.getByRole('button', { name: 'Enter' }).click();
  await expect(page.locator('.h-error')).toHaveText('Wrong PIN');
  expect(await page.evaluate(() => sessionStorage.getItem('lobby.hostPin'))).toBeNull();
  await page.getByLabel('Host PIN').fill(PIN);
  await page.getByRole('button', { name: 'Enter' }).click();
  await expect(page.locator('.h-pill')).toHaveText('WARM-UP');
  expect(await page.evaluate(() => sessionStorage.getItem('lobby.hostPin'))).toBe(PIN);
});

test('host: people panel moves a player in warm-up only', async ({ page }) => {
  await openHost(page);
  await page.getByRole('tab', { name: 'People' }).click();
  await page.getByLabel('Move Player 01 to another team').selectOption('pixel');
  await expect(page.locator('.h-team-head', { hasText: 'Pixel' })).toHaveText('Pixel 0/6');
  await expect(page.locator('.h-team-head', { hasText: 'Otter' })).toHaveText('Otter 0/4');
  await expect(page.getByLabel('Goes first')).toHaveValue('otter');
});

// Shared e2e helpers: a Node-side host socket (Node 22+ global WebSocket) to reset the shared room,
// and the player join flow.
import { expect, type Page } from '@playwright/test';
import type { HostAction, ServerMsg } from '../../src/shared/protocol';

type HostState = Extract<ServerMsg, { type: 'hostState' }>;
export const PIN = process.env.HOST_PIN ?? '1234';

/** The e2e helpers reset the room: refuse anything that is not a local dev server. */
export function assertLocal(baseURL: string): void {
  const h = new URL(baseURL).hostname;
  if (h !== 'localhost' && h !== '127.0.0.1') throw new Error(`refusing to touch a non-local room (${h}) from e2e tests`);
}

export function wsUrl(baseURL: string): string {
  assertLocal(baseURL);
  return `${baseURL.replace(/^http/, 'ws')}/ws`;
}

/** A host socket that resolves each action with the following hostState (or rejects on error). */
export async function hostSocket(baseURL: string) {
  const ws = new WebSocket(wsUrl(baseURL));
  let last: HostState | null = null;
  const waiters: { ok(h: HostState): void; fail(e: Error): void }[] = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(String(e.data)) as ServerMsg;
    if (m.type === 'hostState') { last = m; waiters.shift()?.ok(m); }
    else if (m.type === 'error') waiters.shift()?.fail(new Error(m.message));
  });
  const next = () => new Promise<HostState>((ok, fail) => {
    const t = setTimeout(() => fail(new Error('no hostState within 10 s')), 10_000);
    waiters.push({ ok: (h) => { clearTimeout(t); ok(h); }, fail: (e) => { clearTimeout(t); fail(e); } });
  });
  await new Promise<void>((ok, fail) => { ws.addEventListener('open', () => ok()); ws.addEventListener('error', () => fail(new Error('ws error'))); });
  const first = next();
  ws.send(JSON.stringify({ t: 'hostHello', pin: PIN }));
  await first;
  return {
    get state() { return last!; },
    async act(a: HostAction): Promise<HostState> {
      const r = next();
      ws.send(JSON.stringify({ t: 'host', a }));
      return r;
    },
    close() { ws.close(); },
  };
}

/** Back to a fresh warm-up so every test starts from the same room. */
export async function resetRoom(baseURL: string): Promise<void> {
  assertLocal(baseURL);
  const h = await hostSocket(baseURL);
  try { await h.act({ type: 'host.reset' }); } finally { h.close(); }
}

/** Picker → "I'm not on the list" → name + team → avatar builder → room canvas. */
export async function joinAsNewcomer(page: Page, name: string, team = 'Pixel'): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: "I'm not on the list" }).click();
  await page.getByRole('textbox', { name: 'Your name' }).fill(name);
  await page.getByRole('button', { name: team, exact: true }).click();
  await page.getByRole('button', { name: 'Join' }).click();
  await page.getByRole('button', { name: 'Enter room' }).click();
  await expect(page.locator('#lb-room canvas')).toBeVisible();
  await page.waitForFunction(() => {
    const d = (window as { __lobbyDebug?: { me(): unknown } }).__lobbyDebug;
    return !!d && d.me() !== null;
  });
}

export type Pos = { x: number; y: number };
export const myPos = (page: Page) =>
  page.evaluate(() => (window as unknown as { __lobbyDebug: { me(): Pos | null } }).__lobbyDebug.me());

/** Asserts the page is unzoomed and unscrolled. */
export async function expectNoZoomOrScroll(page: Page): Promise<void> {
  const v = await page.evaluate(() => ({
    scale: window.visualViewport?.scale ?? 1,
    top: document.scrollingElement?.scrollTop ?? 0,
    left: document.scrollingElement?.scrollLeft ?? 0,
  }));
  expect(v).toEqual({ scale: 1, top: 0, left: 0 });
}

/** Every input currently in the DOM has a computed font-size of at least 16 px. */
export async function expectInputsAtLeast16px(page: Page): Promise<number> {
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll('input')].map((i) => parseFloat(getComputedStyle(i).fontSize)));
  for (const s of sizes) expect(s).toBeGreaterThanOrEqual(16);
  return sizes.length;
}

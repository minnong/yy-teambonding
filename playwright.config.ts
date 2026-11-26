import { defineConfig, devices } from '@playwright/test';

// Mobile end-to-end checks against the dev server (Vite + the Worker/Durable Object in workerd).
// Every test shares the one "main" Room, so tests run serially and each one resets the room first.
// WebKit is not installed for this Playwright version, so both phone profiles run in Chromium
// (system Chrome) with the device's viewport, DPR, touch and user agent.
const port = Number(process.env.E2E_PORT ?? 5173);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;
const chrome = { browserName: 'chromium' as const, channel: 'chrome' };
// Every test resets the room: never let a stray E2E_BASE_URL point this at a deployed event.
const e2eHost = new URL(baseURL).hostname;
if (e2eHost !== 'localhost' && e2eHost !== '127.0.0.1') {
  throw new Error(`e2e tests reset the room, so they only run against localhost/127.0.0.1, not ${e2eHost}`);
}

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'iphone-13', use: { ...devices['iPhone 13'], ...chrome } },
    { name: 'pixel-7', use: { ...devices['Pixel 7'], ...chrome } },
  ],
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

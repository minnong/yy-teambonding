import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { resolve } from 'node:path';

/**
 * Unit and worker tests run against a frozen copy of the placeholder roster
 * (tests/fixtures/event.json), so editing the real content/event.json never breaks them.
 * The real file is still validated by tests/unit/real-content.test.ts and by `npm run deploy`.
 */
const alias = [
  { find: '@shared', replacement: resolve(import.meta.dirname, 'src/shared') },
  { find: /^.*\/content\/event\.json$/, replacement: resolve(import.meta.dirname, 'tests/fixtures/event.json') },
];
/**
 * Worker tests bind their own HOST_PIN, so `npm test` works from a fresh clone without the
 * gitignored .dev.vars (M11). A test-only value, never a real secret.
 */
export const TEST_HOST_PIN = 'test-only-pin';

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        resolve: { alias },
        test: { name: 'unit', environment: 'node', include: ['tests/unit/**/*.test.ts'] },
      },
      {
        resolve: { alias },
        plugins: [cloudflareTest({
          wrangler: { configPath: './wrangler.jsonc' },
          miniflare: { bindings: { HOST_PIN: TEST_HOST_PIN } },
        })],
        test: { name: 'worker', include: ['tests/worker/**/*.test.ts'] },
      },
    ],
  },
});

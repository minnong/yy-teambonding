import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { resolve } from 'node:path';

const alias = { '@shared': resolve(import.meta.dirname, 'src/shared') };
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

import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { resolve } from 'node:path';

// Root is src/client so index.html is served at / and host.html at /host.html.
// /host is served from host.html by the assets default html_handling (auto-trailing-slash), not by Worker code.
export default defineConfig({
  root: 'src/client',
  publicDir: resolve(import.meta.dirname, 'public'),
  envDir: import.meta.dirname,
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared') } },
  plugins: [
    {
      name: 'host-route',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/host') req.url = '/host.html';
          next();
        });
      },
    },
    cloudflare({ configPath: resolve(import.meta.dirname, 'wrangler.jsonc') })],
  environments: {
    team_lobby: {
      build: { outDir: resolve(import.meta.dirname, 'dist/team_lobby'), emptyOutDir: true },
    },
    client: {
      build: {
        outDir: resolve(import.meta.dirname, 'dist/client'),
        emptyOutDir: true,
        rollupOptions: {
          input: {
            index: resolve(import.meta.dirname, 'src/client/index.html'),
            host: resolve(import.meta.dirname, 'src/client/host.html'),
          },
        },
      },
    },
  },
});

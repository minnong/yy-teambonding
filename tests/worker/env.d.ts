import type { Env as WorkerEnv } from '../../src/server/worker';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}

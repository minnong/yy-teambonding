import { Room } from './room';

export { Room };

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
  ASSETS: Fetcher;
  HOST_PIN: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }
      return env.ROOM.get(env.ROOM.idFromName('main')).fetch(req);
    }
    if (url.pathname === '/host') {
      url.pathname = '/host.html';
      return env.ASSETS.fetch(new Request(url, req));
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;

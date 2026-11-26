import { SELF } from 'cloudflare:test';
import { it, expect } from 'vitest';

it('upgrades /ws and the Room echoes a message', async () => {
  const res = await SELF.fetch('http://x/ws', { headers: { Upgrade: 'websocket' } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  const reply = new Promise<string>((resolve) =>
    ws.addEventListener('message', (e) => resolve(e.data as string)),
  );
  ws.send('ping');
  expect(await reply).toBe('echo:ping');
  ws.close();
});

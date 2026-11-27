import { SELF } from 'cloudflare:test';
import { it, expect } from 'vitest';

it('serves the join page at / and the Worker fallthrough does not throw', async () => {
  const res = await SELF.fetch('http://x/');
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('Team Lobby');
});

it('serves the host page at /host', async () => {
  const res = await SELF.fetch('http://x/host');
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('Host');
});

it('rejects /ws without a WebSocket upgrade', async () => {
  const res = await SELF.fetch('http://x/ws');
  expect(res.status).toBe(426);
});

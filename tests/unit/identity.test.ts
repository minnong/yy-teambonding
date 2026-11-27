import { beforeEach, describe, expect, it } from 'vitest';
import { ClientMsgSchema } from '@shared/protocol';
import { clearMe, helloFor, loadMe, saveMe } from '../../src/client/identity';

beforeEach(() => clearMe());

describe('identity: lobby.me carries the room epoch', () => {
  it('saveMe/loadMe round-trips {playerId, token, epoch}', () => {
    saveMe({ playerId: 'p01', token: 'tok-12345678', epoch: 'e-abc-12' });
    expect(loadMe()).toEqual({ playerId: 'p01', token: 'tok-12345678', epoch: 'e-abc-12' });
  });

  it('an identity stored before epochs existed loads without one', () => {
    saveMe({ playerId: 'p01', token: 'tok-12345678' });
    expect(loadMe()).toEqual({ playerId: 'p01', token: 'tok-12345678' });
  });

  it('helloFor puts the stored epoch on the hello (and on a takeover), and it passes the wire schema', () => {
    const me = { playerId: 'p01', token: 'tok-12345678', epoch: 'e-abc-12' };
    const h = helloFor(me);
    expect(h).toEqual({ t: 'hello', playerId: 'p01', token: 'tok-12345678', epoch: 'e-abc-12' });
    expect(helloFor(me, true)).toEqual({ ...h, takeover: true });
    expect(ClientMsgSchema.safeParse(h).success).toBe(true);
  });

  it('without a stored epoch the hello carries none (the Room then sends it to the picker)', () => {
    const h = helloFor({ playerId: 'p01', token: 'tok-12345678' });
    expect('epoch' in h).toBe(false);
    expect(ClientMsgSchema.safeParse(h).success).toBe(true);
  });
});

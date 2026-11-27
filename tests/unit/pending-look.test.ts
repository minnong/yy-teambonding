import { describe, it, expect } from 'vitest';
import { PendingLook, LOOK_RESEND_MS } from '../../src/client/pendingLook';
import type { PublicSnapshot } from '@shared/protocol';
import type { AvatarLook } from '@shared/types';

const LOOK: AvatarLook = { skin: 1, hair: 2, hairColor: 3, top: 0, topColor: 4, bottomsColor: 5, accessory: 1 };
const ME = 'p01';
const snap = (look: AvatarLook | null, present = true): PublicSnapshot => ({
  epoch: 'e-test', phase: 'warmup', paused: false, teamOrder: ['otter'], teams: {}, motions: {}, online: {},
  players: present ? { [ME]: { id: ME, name: 'Ana', teamId: 'otter', look, addedOnDay: false, removed: false } } : {},
  collectibles: [], departures: [], lastCallAt: null, quizActive: null, serverNow: 0,
});

function mk(open = true) {
  let now = 0;
  const sock = { open };
  const sent: AvatarLook[] = [];
  const p = new PendingLook((l) => { if (!sock.open) return false; sent.push(l); return true; }, () => now);
  return { p, sent, sock, tick: (ms: number) => { now += ms; } };
}

describe('PendingLook (I1)', () => {
  it('sends at once and is held until a snapshot shows my look', () => {
    const { p, sent } = mk();
    p.set(LOOK);
    expect(sent).toHaveLength(1);
    expect(p.value).toEqual(LOOK);
    p.onSnapshot(snap(LOOK), ME);
    expect(p.value).toBeNull();
    p.onWelcome(snap(null), ME); // settled: a later null (e.g. a host reset) is not ours to fix
    expect(sent).toHaveLength(1);
  });

  it('a send that never left (socket not open) goes on the next welcome', () => {
    const { p, sent, sock } = mk(false);
    p.set(LOOK);
    expect(sent).toHaveLength(0);
    sock.open = true;
    p.onWelcome(snap(null), ME);
    expect(sent).toHaveLength(1);
  });

  it('a lost send (dead socket) is resent on every welcome while my look is still null', () => {
    const { p, sent } = mk();
    p.set(LOOK);
    p.onWelcome(snap(null), ME); // reconnected: the first frame may have died with the old socket
    p.onWelcome(snap(null), ME);
    expect(sent).toHaveLength(3);
    p.onWelcome(snap(LOOK), ME);
    p.onWelcome(snap(null), ME);
    expect(sent).toHaveLength(3);
  });

  it('snapshots resend only after LOOK_RESEND_MS (one in flight is not doubled)', () => {
    const { p, sent, tick } = mk();
    p.set(LOOK);
    p.onSnapshot(snap(null), ME); // someone else's change raced my setLook
    expect(sent).toHaveLength(1);
    tick(LOOK_RESEND_MS);
    p.onSnapshot(snap(null), ME);
    expect(sent).toHaveLength(2);
    tick(1);
    p.onSnapshot(snap(null), ME);
    expect(sent).toHaveLength(2);
  });

  it('a refused send is retried on the next snapshot', () => {
    const { p, sent, sock } = mk(false);
    p.set(LOOK);
    sock.open = true;
    p.onSnapshot(snap(null), ME);
    expect(sent).toHaveLength(1);
  });

  it('forgets the look when I am no longer in the snapshot (removed or reset)', () => {
    const { p, sent } = mk();
    p.set(LOOK);
    p.onWelcome(snap(null, false), ME);
    expect(p.value).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it('patch() shows my pending look in a snapshot the server has not caught up on', () => {
    const { p } = mk();
    const s = snap(null);
    expect(p.patch(s, ME)).toBe(s);
    p.set(LOOK);
    expect(p.patch(s, ME).players[ME]!.look).toEqual(LOOK);
    expect(s.players[ME]!.look).toBeNull(); // not mutated
    const other: AvatarLook = { ...LOOK, skin: 5 };
    expect(p.patch(snap(other), ME).players[ME]!.look).toEqual(other);
  });
});

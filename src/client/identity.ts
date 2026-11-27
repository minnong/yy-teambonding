// Persistent identity: lobby.me = {playerId, token, epoch}. The token is generated once per browser and
// reused for every player picked on it. `epoch` is the room epoch the identity was chosen in: every
// hello carries it, and after a Reset the Room refuses it, which sends the phone to the name picker.
// localStorage can throw (private mode): fall back to memory.
import type { HelloMsg } from '@shared/protocol';

/** `epoch` is missing only for an identity stored before epochs existed (the Room refuses it). */
export interface Me { playerId: string; token: string; epoch?: string }

const ME_KEY = 'lobby.me';
const TOKEN_KEY = 'lobby.token';
const mem = new Map<string, string>();

function get(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return mem.get(k) ?? null; }
}
function set(k: string, v: string): void {
  mem.set(k, v);
  try { localStorage.setItem(k, v); } catch { /* memory only */ }
}
function del(k: string): void {
  mem.delete(k);
  try { localStorage.removeItem(k); } catch { /* memory only */ }
}

export function browserToken(): string {
  let t = get(TOKEN_KEY);
  if (!t || t.length < 8) { t = crypto.randomUUID(); set(TOKEN_KEY, t); }
  return t;
}

export function loadMe(): Me | null {
  try {
    const m = JSON.parse(get(ME_KEY) ?? 'null') as Partial<Me> | null;
    if (m && typeof m.playerId === 'string' && typeof m.token === 'string') {
      return typeof m.epoch === 'string' && m.epoch.length > 0
        ? { playerId: m.playerId, token: m.token, epoch: m.epoch }
        : { playerId: m.playerId, token: m.token };
    }
  } catch { /* corrupt */ }
  return null;
}
export function saveMe(me: Me): void { set(ME_KEY, JSON.stringify(me)); }
export function clearMe(): void { del(ME_KEY); }

/** The hello for an identity, carrying its epoch (omitted when there is none, never sent empty). */
export function helloFor(me: Me, takeover = false): HelloMsg {
  const h: HelloMsg = { t: 'hello', playerId: me.playerId, token: me.token };
  if (takeover) h.takeover = true;
  if (me.epoch) h.epoch = me.epoch;
  return h;
}

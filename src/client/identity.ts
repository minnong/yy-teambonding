// Persistent identity: lobby.me = {playerId, token}. The token is generated once per browser and reused
// for every player picked on it. localStorage can throw (private mode): fall back to memory.
export interface Me { playerId: string; token: string }

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
    if (m && typeof m.playerId === 'string' && typeof m.token === 'string') return { playerId: m.playerId, token: m.token };
  } catch { /* corrupt */ }
  return null;
}
export function saveMe(me: Me): void { set(ME_KEY, JSON.stringify(me)); }
export function clearMe(): void { del(ME_KEY); }

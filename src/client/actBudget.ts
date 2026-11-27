// R28: one client-side rolling cap on every player `act` frame, a hard bound on the free-plan
// message budget. Pure (the clock is passed in); Net applies it to every act it sends.
//
// Sizing. With a rolling 60 s window, 35 minutes ([0, 2100] s) holds 36 window positions, so one
// client can send at most 36 × ACT_CAP acts per session:
//   36 players × 36 × 20 = 25,920 acts
//   + joins outside the cap: hello + peek per player, budgeted ×3 for reconnects = 216
//   + join looks outside the cap (I1): at most JOIN_LOOK_MAX = 3 per player per 35 min = 108
//   + the host: about 50 frames
//   = 26,294 ≤ 27,000 (the R28 target), against the 30,000 a session may use.
// ACT_CAP = 21 would give 27,216 acts alone, so 20 is the largest cap that fits.
//
// Rules:
// - Every act costs 1, except `walk`, which costs 2: itself plus the `stop` that will follow it.
// - That prepaid `stop` is never refused, so a held key can always be released (no endless walk).
//   A `stop` with no walk outstanding is a no-op and is treated like any other act.
// - Quiz answers and icebreaker confirms may use the whole cap. Everything else stops
//   ACT_RESERVED short of it, so a player who spammed emotes can still answer the quiz.
// - The setLook that finishes joining (takeJoinLook) never touches the cap: without it the player
//   is invisible to everyone. It has its own small allowance, JOIN_LOOK_MAX per JOIN_LOOK_WINDOW_MS,
//   which covers a resend after a lost frame; past that it falls back to the ordinary cap.
//   Ordinary edits from the 👕 button stay capped.
export const ACT_WINDOW_MS = 60_000;
export const ACT_CAP = 20;
export const ACT_RESERVED = 3;
export const RESERVED_TYPES: ReadonlySet<string> = new Set(['quizAnswer', 'icebreakerConfirm']);

export const JOIN_LOOK_MAX = 3;
export const JOIN_LOOK_WINDOW_MS = 35 * 60_000; // one session

const SESSION_WINDOWS = 36; // window positions in a 35-minute session
const PLAYERS = 36;
const JOIN_FRAMES = PLAYERS * 2 * 3;
const JOIN_LOOK_FRAMES = PLAYERS * JOIN_LOOK_MAX;
const HOST_FRAMES = 50;
/** The whole-session upper bound this cap guarantees (documented above). */
export const SESSION_WORST_CASE = PLAYERS * SESSION_WINDOWS * ACT_CAP + JOIN_FRAMES + JOIN_LOOK_FRAMES + HOST_FRAMES;

export interface BudgetStore { load(): number[]; save(charges: number[]): void }

export class ActBudget {
  /** One timestamp per unit charged, ascending. */
  private charges: number[];
  /** A charged walk is outstanding: its stop is prepaid. */
  private walking = false;
  /** Send times of cap-exempt join looks, ascending. */
  private joinLooks: number[];

  constructor(private readonly store: BudgetStore | null = null, private readonly lookStore: BudgetStore | null = null) {
    this.charges = clean(store?.load());
    this.joinLooks = clean(lookStore?.load());
  }

  /**
   * The setLook that completes a join (I1): true (and recorded) while this browser has sent fewer
   * than JOIN_LOOK_MAX of them in the last JOIN_LOOK_WINDOW_MS. Never charged to the act cap.
   */
  takeJoinLook(now: number): boolean {
    while (this.joinLooks.length > 0 && this.joinLooks[0]! <= now - JOIN_LOOK_WINDOW_MS) this.joinLooks.shift();
    if (this.joinLooks.length >= JOIN_LOOK_MAX) return false;
    this.joinLooks.push(now);
    this.lookStore?.save(this.joinLooks);
    return true;
  }

  private prune(now: number): void {
    while (this.charges.length > 0 && this.charges[0]! <= now - ACT_WINDOW_MS) this.charges.shift();
  }

  private limit(type: string): number { return RESERVED_TYPES.has(type) ? ACT_CAP : ACT_CAP - ACT_RESERVED; }
  private cost(type: string): number { return type === 'walk' ? 2 : 1; }

  /** The earliest time `type` would be accepted (`now` if it would be accepted now). */
  allowedAt(type: string, now: number): number {
    if (type === 'stop' && this.walking) return now;
    this.prune(now);
    const over = this.charges.length + this.cost(type) - this.limit(type);
    if (over <= 0) return now;
    return this.charges[over - 1]! + ACT_WINDOW_MS;
  }

  /** Charges and returns true if `type` may be sent at `now`; returns false (no charge) otherwise. */
  take(type: string, now: number): boolean {
    if (type === 'stop' && this.walking) { this.walking = false; return true; }
    if (this.allowedAt(type, now) > now) return false;
    for (let i = 0; i < this.cost(type); i++) this.charges.push(now);
    if (type === 'walk') this.walking = true;
    if (type === 'stop') this.walking = false;
    this.store?.save(this.charges);
    return true;
  }
}

function clean(loaded: unknown): number[] {
  return Array.isArray(loaded) ? loaded.filter((n): n is number => Number.isFinite(n)).sort((a, b) => a - b) : [];
}

/** Keeps the charges across reloads, so reloading the page does not refill the budget. */
export function localBudgetStore(key = 'lobby.actBudget'): BudgetStore | null {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    return {
      load: () => { try { return JSON.parse(ls.getItem(key) ?? '[]') as number[]; } catch { return []; } },
      save: (c) => { try { ls.setItem(key, JSON.stringify(c)); } catch { /* full or blocked */ } },
    };
  } catch { return null; }
}

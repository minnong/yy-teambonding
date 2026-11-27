// Pure view rules for the in-room HUD: which buttons show, the icebreaker card's state, quiz and
// riddle countdowns, banners and leaderboard rows. No DOM, no Net: unit-tested in Node.
import { ordinal } from '@shared/ordinal';
import type { IcebreakerCard, IcebreakerClosedReason, PublicSnapshot } from '@shared/protocol';
import type { PlayerId, TeamId } from '@shared/types';
import { rankPlaying } from '../room/leaderboard';

export interface RiddleInfo { index: number; q: string | null; lockedUntil: number }
export interface BossInfo { index: number; q: string | null; done: boolean; intro?: string }
export interface QuizInfo { q: string; choices: string[]; endsAt: number }

/** Exactly the four emotes from the global constraints, in button order. */
export const EMOTE_EMOJI: Record<string, string> = { wave: '👋', highfive: '🙌', laugh: '😂', heart: '❤️' };

export const BANNER_MS = 6000;
export const TOAST_MS = 3000;
export const PAUSED_TEXT = 'Paused';
export const WRONG_TEXT = 'Not quite, try again!';

const playing = (s: PublicSnapshot, teamId: TeamId | undefined): boolean =>
  !!teamId && s.teams[teamId]?.status === 'playing';

export const teamOf = (s: PublicSnapshot, id: PlayerId): TeamId | undefined => s.players[id]?.teamId;

/** The final boss is on for `teamId`: it is the sole playing team, has not escaped, and the latest boss step has a question. */
export function bossActive(s: PublicSnapshot, teamId: TeamId | undefined, boss: BossInfo | null): boolean {
  if (s.phase !== 'competition' || !teamId || !playing(s, teamId)) return false;
  const left = s.teamOrder.filter((id) => playing(s, id));
  return left.length === 1 && left[0] === teamId && !s.teams[teamId]!.bossDone && !!boss && !boss.done && boss.q !== null;
}

/** The table button: Riddle at my own table during an unpaused competition, Final boss while the boss is on. */
export function tableButton(s: PublicSnapshot, me: PlayerId, nearOwnTable: boolean, boss: BossInfo | null): 'riddle' | 'boss' | null {
  const t = teamOf(s, me);
  if (!nearOwnTable || s.phase !== 'competition' || s.paused || !playing(s, t)) return null;
  return bossActive(s, t, boss) ? 'boss' : 'riddle';
}

/** Who the proximity sheet is about: the tapped (pinned) player while still near, else the nearest. */
export function sheetTarget(near: readonly PlayerId[], pinned: PlayerId | null): PlayerId | null {
  if (pinned && near.includes(pinned)) return pinned;
  return near[0] ?? null;
}

/** Icebreaker is offered for someone on another team; during the competition both teams must still be playing. */
export function canIcebreak(s: PublicSnapshot, me: PlayerId, other: PlayerId): boolean {
  const a = teamOf(s, me), b = teamOf(s, other);
  if (!a || !b || a === b) return false;
  return s.phase !== 'competition' || (playing(s, a) && playing(s, b));
}

export interface CardView {
  id: string;
  prompt: string;
  otherId: PlayerId;
  otherName: string;
  /** answer: "We answered it!"; waiting: I answered, they confirm; confirm: they answered, I confirm. */
  mode: 'answer' | 'waiting' | 'confirm';
  waitingText?: string;
}

export function cardView(card: IcebreakerCard | null, me: PlayerId, nameOf: (id: PlayerId) => string): CardView | null {
  if (!card || (card.a !== me && card.b !== me)) return null;
  const otherId = card.a === me ? card.b : card.a;
  const otherName = nameOf(otherId);
  const base = { id: card.id, prompt: card.prompt, otherId, otherName };
  if (!card.answeredBy) return { ...base, mode: 'answer' };
  if (card.answeredBy === me) return { ...base, mode: 'waiting', waitingText: `Waiting for ${otherName}…` };
  return { ...base, mode: 'confirm' };
}

/** Toast when a card closes under me. Done cards show their points as a float instead. */
export function closedToast(reason: IcebreakerClosedReason | undefined, otherName: string): string | null {
  if (reason === 'left') return `${otherName} left`;
  if (reason === 'departed') return `${otherName}'s team headed out`;
  return null;
}

export const quizSecondsLeft = (endsAt: number, now: number): number => Math.max(0, Math.ceil((endsAt - now) / 1000));
export const quizCountdown = (endsAt: number, now: number): string => `${quizSecondsLeft(endsAt, now)}s`;
export const quizExpired = (endsAt: number, now: number): boolean => now >= endsAt;

/** Identifies one quiz run: its close time plus the question. */
export const quizKey = (q: { endsAt: number; q: string }): string => `${q.endsAt}|${q.q}`;

/** The active quiz from a snapshot, if I am on a playing team and have not answered it. */
export function quizToShow(s: PublicSnapshot, me: PlayerId, answered: { has(key: string): boolean }, now: number): QuizInfo | null {
  const q = s.quizActive;
  if (!q || !playing(s, teamOf(s, me)) || answered.has(quizKey(q)) || quizExpired(q.endsAt, now)) return null;
  return q;
}

/**
 * An open quiz modal (answered or not) stays only while my team plays, that same quiz is still
 * active on the server, and it has not run out. Out messages precede the snapshot on the wire, so
 * every snapshot after a `quiz` message already carries it in quizActive.
 */
export function quizStillOpen(s: PublicSnapshot, me: PlayerId, endsAt: number, now: number): boolean {
  return playing(s, teamOf(s, me)) && s.quizActive?.endsAt === endsAt && !quizExpired(endsAt, now);
}

/** Safety timeout for a one-shot send whose reply never comes. */
export const PENDING_MS = 3000;

/**
 * One-shot send guard: begin() succeeds once per key until the matching reply clears it, or
 * PENDING_MS passes. Keeps a double tap or repeated Enter from sending the same intent twice.
 */
export class PendingGuard {
  private readonly since = new Map<string, number>();
  begin(key: string, now: number): boolean {
    if (this.pending(key, now)) return false;
    this.since.set(key, now);
    return true;
  }
  pending(key: string, now: number): boolean {
    const t = this.since.get(key);
    return t !== undefined && now - t < PENDING_MS;
  }
  clear(key: string): void { this.since.delete(key); }
}

export function quizResultText(choices: readonly string[] | null, correct: number): string | null {
  const c = choices?.[correct];
  return c === undefined ? null : `Answer: ${c}`;
}

/** Remaining skip lockout as `12s`, or null when the riddle is unlocked. */
export function skipLockText(lockedUntil: number, now: number): string | null {
  return now < lockedUntil ? quizCountdown(lockedUntil, now) : null;
}

export type BannerPlan = { kind: 'clear' } | { kind: 'sticky'; text: string } | { kind: 'timed'; text: string; ms: number };

export function bannerPlan(text: string): BannerPlan {
  if (!text) return { kind: 'clear' };
  if (text === PAUSED_TEXT) return { kind: 'sticky', text };
  return { kind: 'timed', text, ms: BANNER_MS };
}

/** A timed banner with another waiting behind it still shows at least this long. */
export const BANNER_MIN_MS = 3000;
const MAX_WAITING_BANNERS = 3;

/**
 * Timed banners, one at a time (M2). callNext sends "🎉 Team X, you're up!" and the FINAL BOSS
 * banner back to back; replacing one with the next meant the room never saw the first. A banner
 * with others waiting is cut to BANNER_MIN_MS (never shorter); the last one keeps its full time.
 */
export class BannerQueue {
  private cur: { text: string; from: number; until: number } | null = null;
  private waiting: { text: string; ms: number }[] = [];

  push(text: string, ms: number, now: number): void {
    this.advance(now);
    if (this.cur?.text === text || this.waiting.some((w) => w.text === text)) return;
    if (!this.cur) { this.cur = { text, from: now, until: now + ms }; return; }
    this.waiting.push({ text, ms });
    if (this.waiting.length > MAX_WAITING_BANNERS) this.waiting.shift();
    this.cur.until = Math.min(this.cur.until, Math.max(this.cur.from + BANNER_MIN_MS, now));
    this.advance(now);
  }

  clear(): void { this.cur = null; this.waiting = []; }

  /** The banner to show at `now`, or null. */
  current(now: number): string | null {
    this.advance(now);
    return this.cur?.text ?? null;
  }

  /** When current() next changes, or null when nothing is showing. */
  nextChangeAt(): number | null { return this.cur?.until ?? null; }

  private advance(now: number): void {
    while (this.cur && now >= this.cur.until) {
      const n = this.waiting.shift();
      if (!n) { this.cur = null; return; }
      const from = this.cur.until;
      this.cur = { text: n.text, from, until: from + (this.waiting.length > 0 ? Math.min(n.ms, BANNER_MIN_MS) : n.ms) };
    }
  }
}

/** Identifies one call of a team, for "have I shown its You're up! overlay". */
export const youreUpKey = (teamId: TeamId, departedOrder: number): string => `${teamId}:${departedOrder}`;

/**
 * M7: the key of my team's call when the snapshot says we have been called but this tab never
 * showed "You're up!" for it (the phone was asleep at the call); null otherwise.
 */
export function youreUpMissed(s: PublicSnapshot, me: PlayerId, seen: { has(key: string): boolean }): string | null {
  if (s.phase !== 'competition') return null;
  const id = teamOf(s, me);
  const t = id && Object.hasOwn(s.teams, id) ? s.teams[id]! : undefined;
  if (!t || t.status !== 'departed' || t.departedOrder === null) return null;
  const key = youreUpKey(t.id, t.departedOrder);
  return seen.has(key) ? null : key;
}

export function celebrateView(s: PublicSnapshot, me: PlayerId, teamId: TeamId): { mine: true } | { mine: false; text: string } {
  if (teamOf(s, me) === teamId) return { mine: true };
  return { mine: false, text: `${s.teams[teamId]?.name ?? 'A team'} escaped the lobby! 🎉` };
}

export interface LeaderRow {
  kind: 'leader' | 'team' | 'departed';
  rank: number | null;
  name: string;
  score: number;
  color: string;
  text: string;
}

/** Same ranking as the wall board: playing teams by score (leader only with points), then departed in order. */
export function leaderboardRows(s: PublicSnapshot): LeaderRow[] {
  const rows: LeaderRow[] = rankPlaying(s).map((t, i) => ({
    kind: i === 0 && t.score > 0 ? 'leader' : 'team', rank: i + 1, name: t.name, score: t.score, color: t.color,
    text: `${i + 1} ${t.name}`,
  }));
  s.departures.forEach((id, i) => {
    const t = s.teams[id];
    if (!t) return;
    rows.push({ kind: 'departed', rank: null, name: t.name, score: t.score, color: t.color, text: `✅ ${ordinal(t.departedOrder ?? i + 1)} ${t.name}` });
  });
  return rows;
}

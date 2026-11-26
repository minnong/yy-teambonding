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

/** The active quiz from a snapshot, if I am on a playing team and have not answered it (quizzes are keyed by endsAt). */
export function quizToShow(s: PublicSnapshot, me: PlayerId, answered: ReadonlySet<number>, now: number): QuizInfo | null {
  const q = s.quizActive;
  if (!q || !playing(s, teamOf(s, me)) || answered.has(q.endsAt) || quizExpired(q.endsAt, now)) return null;
  return q;
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

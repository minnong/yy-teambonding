// Pure host-console logic: timers, copy, button enable rules, leaderboard rows and the budget footer.
// No DOM here, so every rule the facilitator relies on is unit-tested (tests/unit/host-format.test.ts).
import { CALL_AMBER_MS, CALL_GREEN_MS, MESSAGE_BUDGET } from '@shared/constants';
import { ordinal } from '@shared/ordinal';
import type { PublicSnapshot, ServerMsg } from '@shared/protocol';
import type { Team, TeamId } from '@shared/types';

export type HostState = Extract<ServerMsg, { type: 'hostState' }>;
export type NextLeader = HostState['nextLeader'];
export type CallTimer = 'normal' | 'amber' | 'green';

/** Amber from CALL_AMBER_MS (4:30) and green from CALL_GREEN_MS (5:00) since the last call. */
export function callTimerState(lastCallAt: number | null, now: number): CallTimer {
  if (lastCallAt === null) return 'normal';
  const ms = now - lastCallAt;
  return ms >= CALL_GREEN_MS ? 'green' : ms >= CALL_AMBER_MS ? 'amber' : 'normal';
}

/** `m:ss`; minutes are not capped at 59, negatives (clock skew) show 0:00. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The big timer: a dash before the competition starts. */
export function sinceLastCall(lastCallAt: number | null, now: number): string {
  return lastCallAt === null ? '—' : formatElapsed(now - lastCallAt);
}

/** Verbatim copy (global constraints). */
export function callConfirmText(t: { name: string; score: number }): string {
  return `This will call TEAM ${t.name.toUpperCase()} (${t.score} pts)`;
}

export function nextUpText(nl: NextLeader): string {
  return nl ? `Next up: ${nl.name.toUpperCase()} · ${nl.score} pts` : 'Next up: —';
}

/** The team an undo would bring back: the last departure, never the goesFirst team (server rule). */
export function undoTarget(s: PublicSnapshot): Team | null {
  if (s.phase !== 'competition' || s.departures.length <= 1) return null;
  const t = s.teams[s.departures.at(-1)!];
  return t && !t.goesFirst ? t : null;
}

export function budgetPercent(count: number, budget: number = MESSAGE_BUDGET): number {
  return (count / budget) * 100;
}

/** Red above 80% of the budget. */
export function budgetLevel(count: number, budget: number = MESSAGE_BUDGET): 'ok' | 'red' {
  return budgetPercent(count, budget) > 80 ? 'red' : 'ok';
}

export function budgetText(count: number, budget: number = MESSAGE_BUDGET): string {
  const f = (n: number) => n.toLocaleString('en-US');
  return `Messages today: ${f(count)} / ${f(budget)} budget`;
}

export function teamCountText(name: string, c: { online: number; total: number } | undefined): string {
  return `${name} ${c?.online ?? 0}/${c?.total ?? 0}`;
}

export interface BoardRow {
  kind: 'playing' | 'departed';
  teamId: TeamId;
  /** 1-based rank among playing teams; the departure order for departed teams. */
  rank: number;
  /** Team name, or `✅ {ordinal} {name}` once departed. */
  label: string;
  score: number;
  color: string;
  /** Connected players, e.g. "5/5". */
  count: string;
}

/** Playing teams by score (ties by teamOrder), then departed teams in departure order. */
export function leaderboardRows(h: HostState): BoardRow[] {
  const s = h.snapshot;
  const order = new Map(s.teamOrder.map((id, i) => [id, i]));
  const count = (id: TeamId) => {
    const c = h.connectedPerTeam[id];
    return `${c?.online ?? 0}/${c?.total ?? 0}`;
  };
  const playing = Object.values(s.teams)
    .filter((t) => t.status === 'playing')
    .sort((a, b) => b.score - a.score || (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
  const rows: BoardRow[] = playing.map((t, i) => ({
    kind: 'playing', teamId: t.id, rank: i + 1, label: t.name, score: t.score, color: t.color, count: count(t.id),
  }));
  s.departures.forEach((id, i) => {
    const t = s.teams[id];
    if (!t) return;
    const n = t.departedOrder ?? i + 1;
    rows.push({ kind: 'departed', teamId: id, rank: n, label: `✅ ${ordinal(n)} ${t.name}`, score: t.score, color: t.color, count: count(id) });
  });
  return rows;
}

export interface ButtonStates {
  start: boolean;
  callNext: boolean;
  quiz: boolean;
  undo: boolean;
  undoLabel: string;
  /** Pause shows while running, Resume while paused. */
  showPause: boolean;
  pause: boolean;
  resume: boolean;
  adjust: boolean;
  reset: boolean;
  /** The People panel (move, remove, goes first) works in warm-up only. */
  people: boolean;
}

/**
 * Which host buttons are usable. `pending` is the one-shot guard: after any host send, everything
 * stays disabled until the next hostState or error, so a double tap can never send twice.
 */
export function buttonStates(h: HostState | null, pending: boolean): ButtonStates {
  const s = h?.snapshot;
  const target = s ? undoTarget(s) : null;
  const undoLabel = target ? `Undo last call (bring back ${target.name.toUpperCase()})` : 'Undo last call';
  const showPause = !s?.paused;
  if (!h || !s || pending) {
    return { start: false, callNext: false, quiz: false, undo: false, undoLabel, showPause, pause: false, resume: false, adjust: false, reset: false, people: false };
  }
  const competing = s.phase === 'competition';
  return {
    start: s.phase === 'warmup',
    callNext: competing && !s.paused && h.nextLeader !== null,
    quiz: competing && !s.paused && s.quizActive === null,
    undo: target !== null,
    undoLabel,
    showPause,
    pause: !s.paused,
    resume: s.paused,
    adjust: true,
    reset: true,
    people: s.phase === 'warmup',
  };
}

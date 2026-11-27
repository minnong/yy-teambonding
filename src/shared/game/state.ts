// State construction, persistence and read-only queries over GameState.
import type { Content, GameState, Icebreaker, PlayerId, TeamId, Vec } from '../types';
import type { IcebreakerClosedReason } from '../protocol';
import { spawnFor } from '../layout';
import type { Outbound } from './result';

/** The UTC calendar day (YYYY-MM-DD) msgCount is bucketed by. */
export const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);

/** A short room-epoch id, `e-<base36 now>-<base36 rng>`. Deterministic given `now` and `rng`. */
export const newEpoch = (now: number, rng: () => number): string =>
  `e-${Math.max(0, Math.floor(now)).toString(36)}-${Math.floor(rng() * 36 ** 6).toString(36)}`;

/** `rng` only seeds the epoch; pass ctx.rng where there is one. */
export function createState(content: Content, now: number, rng: () => number = Math.random): GameState {
  const teams: GameState['teams'] = {};
  for (const t of content.teams) {
    teams[t.id] = {
      id: t.id, name: t.name, color: t.color, goesFirst: !!t.goesFirst,
      score: 0, scoreChangedAt: now, status: 'playing', departedOrder: null,
      riddleIndex: 0, riddleLockedUntil: 0, bossIndex: 0, bossDone: false,
    };
  }
  const players: GameState['players'] = {};
  for (const p of content.players) {
    players[p.id] = { id: p.id, name: p.name, teamId: p.teamId, look: null, addedOnDay: false, removed: false };
  }
  return {
    epoch: newEpoch(now, rng),
    phase: 'warmup', paused: false, pausedAt: null,
    teamOrder: content.teams.map((t) => t.id), teams, players,
    metPairs: [], icebreakers: {},
    collectibles: [], nextCollectibleAt: null,
    quiz: null, nextQuizIndex: 0, promptCursor: 0,
    departures: [], lastCallAt: null, competitionStartedAt: null, callTimes: [],
    msgCount: { day: utcDay(now), count: 0 },
    motions: {}, online: {}, lastTickAt: now,
  };
}

export type Persisted = Omit<GameState, 'motions' | 'online' | 'lastTickAt'>;

export function persistable(state: GameState): Persisted {
  const { motions: _m, online: _o, lastTickAt: _l, ...rest } = state;
  return structuredClone(rest);
}

/**
 * Rebuilds a live state from a save. Icebreakers are dropped: every socket reconnects after a
 * restart, and a stale card would lock its two players out with "Already in an icebreaker".
 */
export function restore(saved: Persisted, now: number, rng: () => number = Math.random): GameState {
  const s: GameState = { ...structuredClone(saved), icebreakers: {}, motions: {}, online: {}, lastTickAt: now };
  // Saves from before epochs existed: a fresh one, so every identity stored until now re-picks.
  if (typeof s.epoch !== 'string' || s.epoch.length === 0) s.epoch = newEpoch(now, rng);
  // Saves from before callTimes existed: exact times are lost, so the latest call keeps lastCallAt
  // and earlier ones fall back to the competition start.
  if (!Array.isArray(s.callTimes)) {
    const start = s.competitionStartedAt ?? 0;
    s.callTimes = s.departures.map((_, i) => (i === s.departures.length - 1 ? s.lastCallAt ?? start : start));
  }
  return s;
}

/** Table slot of a team (its index in teamOrder), or -1 if unknown. */
export const slotOf = (state: GameState, teamId: TeamId): number => state.teamOrder.indexOf(teamId);

/** A team id from the roster (own key only: '__proto__' or 'constructor' are never teams). */
export const hasTeam = (state: GameState, teamId: TeamId): boolean => Object.hasOwn(state.teams, teamId);

export const isPlayingTeam = (state: GameState, teamId: TeamId): boolean =>
  hasTeam(state, teamId) && state.teams[teamId]!.status === 'playing';

/** Online, non-removed members of a team, in roster order. */
export const activePlayers = (state: GameState, teamId: TeamId): PlayerId[] =>
  Object.values(state.players)
    .filter((p) => p.teamId === teamId && !p.removed && state.online[p.id])
    .map((p) => p.id);

/** A live (known, non-removed) player, or undefined. */
export const livePlayer = (state: GameState, id: PlayerId) => {
  const p = Object.hasOwn(state.players, id) ? state.players[id] : undefined;
  return p && !p.removed ? p : undefined;
};

/** Spawn spot beside the player's own table; n is their index among the team's non-removed players. */
export function spawnPoint(state: GameState, id: PlayerId): Vec {
  const p = state.players[id]!;
  const mates = Object.values(state.players).filter((q) => q.teamId === p.teamId && !q.removed);
  return spawnFor(slotOf(state, p.teamId), Math.max(0, mates.findIndex((q) => q.id === id)));
}

/**
 * Deletes every open icebreaker matching `pred` and tells each participant who is currently
 * online that the card closed. Call after updating `online` (e.g. on disconnect, so only the
 * other person is told).
 */
export function closeIcebreakers(
  state: GameState, pred: (ib: Icebreaker) => boolean, reason: IcebreakerClosedReason,
): Outbound[] {
  const out: Outbound[] = [];
  for (const ib of Object.values(state.icebreakers)) {
    if (!pred(ib)) continue;
    delete state.icebreakers[ib.id];
    for (const who of [ib.a, ib.b])
      if (state.online[who]) out.push({ to: { player: who }, msg: { type: 'icebreaker', card: null, closedReason: reason } });
  }
  return out;
}

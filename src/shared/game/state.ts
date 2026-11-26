// State construction, persistence and read-only queries over GameState.
import type { Content, GameState, Icebreaker, PlayerId, TeamId, Vec } from '../types';
import type { IcebreakerClosedReason } from '../protocol';
import { spawnFor } from '../layout';
import type { Outbound } from './result';

const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);

export function createState(content: Content, now: number): GameState {
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

export function restore(saved: Persisted, now: number): GameState {
  return { ...structuredClone(saved), motions: {}, online: {}, lastTickAt: now };
}

/** Table slot of a team (its index in teamOrder), or -1 if unknown. */
export const slotOf = (state: GameState, teamId: TeamId): number => state.teamOrder.indexOf(teamId);

export const isPlayingTeam = (state: GameState, teamId: TeamId): boolean =>
  state.teams[teamId]?.status === 'playing';

/** Online, non-removed members of a team, in roster order. */
export const activePlayers = (state: GameState, teamId: TeamId): PlayerId[] =>
  Object.values(state.players)
    .filter((p) => p.teamId === teamId && !p.removed && state.online[p.id])
    .map((p) => p.id);

/** A live (known, non-removed) player, or undefined. */
export const livePlayer = (state: GameState, id: PlayerId) => {
  const p = state.players[id];
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

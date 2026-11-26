// Reducer-facing protocol types. Zod wire schemas are added in Task 7.
import type {
  AvatarLook, Collectible, Motion, Phase, Player, PlayerId, Team, TeamId, Vec,
} from './types';

// ---------- Actions (input to the reducer) ----------

export type WalkDir = 'up' | 'down' | 'left' | 'right';

export type PlayerAction =
  | { type: 'connect'; playerId: PlayerId }
  | { type: 'disconnect'; playerId: PlayerId }
  | { type: 'setLook'; playerId: PlayerId; look: AvatarLook }
  | { type: 'move'; playerId: PlayerId; to: Vec }
  | { type: 'walk'; playerId: PlayerId; dir: WalkDir }
  | { type: 'stop'; playerId: PlayerId }
  | { type: 'emote'; playerId: PlayerId; kind: string; target?: PlayerId }
  | { type: 'icebreakerStart'; playerId: PlayerId; target: PlayerId }
  | { type: 'icebreakerAnswered'; playerId: PlayerId; id: string }
  | { type: 'icebreakerConfirm'; playerId: PlayerId; id: string }
  | { type: 'icebreakerCancel'; playerId: PlayerId; id: string }
  | { type: 'riddleAnswer'; playerId: PlayerId; text: string }
  | { type: 'riddleSkip'; playerId: PlayerId }
  | { type: 'bossAnswer'; playerId: PlayerId; text: string }
  | { type: 'quizAnswer'; playerId: PlayerId; choice: number };

/** Creates a player, so it has no playerId. On success Result.addedPlayerId holds the new id. */
export type AddSelfAction = { type: 'addSelf'; name: string; teamId: TeamId };

export type HostAction =
  | { type: 'host.startCompetition' }
  | { type: 'host.callNext'; expectedTeamId: TeamId }
  | { type: 'host.undoCall' }
  | { type: 'host.quizStart' }
  | { type: 'host.adjustScore'; teamId: TeamId; delta: number }
  | { type: 'host.pause' }
  | { type: 'host.resume' }
  | { type: 'host.reset' }
  | { type: 'host.movePlayer'; playerId: PlayerId; teamId: TeamId }
  | { type: 'host.removePlayer'; playerId: PlayerId }
  | { type: 'host.setGoesFirst'; teamId: TeamId };

export type TickAction = { type: 'tick' };

export type Action = PlayerAction | AddSelfAction | HostAction | TickAction;
export type ActionType = Action['type'];
export type ActionOf<T extends ActionType> = Extract<Action, { type: T }>;

// ---------- Snapshot ----------

export interface PublicSnapshot {
  phase: Phase;
  paused: boolean;
  teamOrder: TeamId[];
  /** Team carries progress counters only; riddle/boss answers live in Content and are never sent. */
  teams: Record<TeamId, Team>;
  /** Non-removed players only. */
  players: Record<PlayerId, Player>;
  motions: Record<PlayerId, Motion>;
  online: Record<PlayerId, boolean>;
  collectibles: Collectible[];
  departures: TeamId[];
  lastCallAt: number | null;
  /** The active quiz question without its correct index or anyone's answers. */
  quizActive: { q: string; choices: string[]; endsAt: number } | null;
  serverNow: number;
}

// ---------- Server messages ----------

export interface IcebreakerCard {
  id: string; a: PlayerId; b: PlayerId; prompt: string; answeredBy: PlayerId | null;
}
export type IcebreakerClosedReason = 'left' | 'departed' | 'cancelled' | 'done';

export type ServerMsg =
  // session
  | { type: 'welcome'; you: PlayerId; token: string; serverNow: number; snapshot: PublicSnapshot }
  | { type: 'snapshot'; snapshot: PublicSnapshot }
  | { type: 'nameTaken'; playerId: PlayerId }
  | { type: 'kicked' }
  | { type: 'error'; message: string }
  // room events
  | { type: 'motion'; playerId: PlayerId; motion: Motion }
  | { type: 'emote'; from: PlayerId; kind: string; target?: PlayerId }
  | { type: 'float'; teamId: TeamId; text: string }
  | { type: 'banner'; text: string }
  // activities
  | { type: 'icebreaker'; card: IcebreakerCard | null; closedReason?: IcebreakerClosedReason }
  | { type: 'riddle'; index: number; q: string | null; lockedUntil: number }
  | { type: 'boss'; index: number; q: string | null; done: boolean }
  | { type: 'quiz'; q: string; choices: string[]; endsAt: number }
  | { type: 'quizResult'; correct: number; perTeam: Record<TeamId, number> }
  // team status
  | { type: 'youreUp'; teamId: TeamId }
  | { type: 'celebrate'; teamId: TeamId }
  // host only
  | {
      type: 'hostState'; snapshot: PublicSnapshot; connectedPerTeam: Record<TeamId, number>;
      msgCount: number; nextLeader: { id: TeamId; name: string; score: number } | null;
      lastCallAt: number | null;
    };

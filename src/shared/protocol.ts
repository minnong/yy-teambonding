// Reducer-facing protocol types, server messages, and the zod schemas for client frames.
import { z } from 'zod';
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
  /** `intro` (content.boss.intro) comes with an active step 0. */
  | { type: 'boss'; index: number; q: string | null; done: boolean; intro?: string }
  | { type: 'quiz'; q: string; choices: string[]; endsAt: number }
  | { type: 'quizResult'; correct: number; perTeam: Record<TeamId, number> }
  // team status
  | { type: 'youreUp'; teamId: TeamId }
  | { type: 'celebrate'; teamId: TeamId }
  // host only
  | {
      type: 'hostState'; snapshot: PublicSnapshot;
      /** online = connected now; total = non-removed players on the team. */
      connectedPerTeam: Record<TeamId, { online: number; total: number }>;
      msgCount: number; nextLeader: { id: TeamId; name: string; score: number } | null;
      lastCallAt: number | null;
    };

// ---------- Wire schemas (client → server) ----------
// Every client frame is validated here before it reaches the reducer. Objects are strict, so an
// `act` payload can never carry a playerId (the Room injects it) and unknown fields are rejected.

export const MAX_NAME_LEN = 24;
export const MAX_ANSWER_LEN = 200;
export const MAX_ID_LEN = 64;
export const TOKEN_MIN_LEN = 8;
export const TOKEN_MAX_LEN = 64;
/** Frames longer than this are rejected before JSON.parse. */
export const MAX_FRAME_LEN = 4096;

const id = z.string().min(1).max(MAX_ID_LEN);
const answer = z.string().max(MAX_ANSWER_LEN);
const coord = z.number().min(-1e6).max(1e6);
const lookField = z.number().int().min(0).max(100);
const act = <T extends string, S extends z.ZodRawShape = {}>(type: T, shape?: S) =>
  z.strictObject({ type: z.literal(type), ...(shape ?? ({} as S)) });

/** Player actions as sent on the wire: no playerId, and no connect/disconnect/addSelf/tick/host.*. */
export const PlayerWireActionSchema = z.discriminatedUnion('type', [
  act('setLook', {
    look: z.strictObject({
      skin: lookField, hair: lookField, hairColor: lookField, top: lookField,
      topColor: lookField, bottomsColor: lookField, accessory: lookField,
    }),
  }),
  act('move', { to: z.strictObject({ x: coord, y: coord }) }),
  act('walk', { dir: z.enum(['up', 'down', 'left', 'right']) }),
  act('stop'),
  act('emote', { kind: z.string().max(MAX_ID_LEN), target: id.optional() }),
  act('icebreakerStart', { target: id }),
  act('icebreakerAnswered', { id }),
  act('icebreakerConfirm', { id }),
  act('icebreakerCancel', { id }),
  act('riddleAnswer', { text: answer }),
  act('riddleSkip'),
  act('bossAnswer', { text: answer }),
  act('quizAnswer', { choice: z.number().int().min(0).max(100) }),
]);

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type PlayerWireAction = DistributiveOmit<
  Exclude<PlayerAction, { type: 'connect' | 'disconnect' }>, 'playerId'>;

export const HostActionSchema = z.discriminatedUnion('type', [
  act('host.startCompetition'),
  act('host.callNext', { expectedTeamId: id }),
  act('host.undoCall'),
  act('host.quizStart'),
  act('host.adjustScore', { teamId: id, delta: z.number().int().min(-10000).max(10000) }),
  act('host.pause'),
  act('host.resume'),
  act('host.reset'),
  act('host.movePlayer', { playerId: id, teamId: id }),
  act('host.removePlayer', { playerId: id }),
  act('host.setGoesFirst', { teamId: id }),
]);

const token = z.string().min(TOKEN_MIN_LEN).max(TOKEN_MAX_LEN);

export const ClientMsgSchema = z.discriminatedUnion('t', [
  z.strictObject({ t: z.literal('hello'), playerId: id, token, takeover: z.boolean().optional() }),
  z.strictObject({ t: z.literal('addSelf'), name: z.string().max(MAX_NAME_LEN), teamId: id, token }),
  z.strictObject({ t: z.literal('hostHello'), pin: z.string().max(MAX_ID_LEN) }),
  /** Task 9: a pre-hello roster peek. Accepted and ignored until then. */
  z.strictObject({ t: z.literal('peek') }),
  z.strictObject({ t: z.literal('act'), a: PlayerWireActionSchema }),
  z.strictObject({ t: z.literal('host'), a: HostActionSchema }),
]);
export type ClientMsg = z.infer<typeof ClientMsgSchema>;

// Compile-time guards: the wire schemas produce exactly the reducer's action shapes.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _hostOk: Same<z.infer<typeof HostActionSchema>, HostAction> = true;
const _playerOk: Same<z.infer<typeof PlayerWireActionSchema>, PlayerWireAction> = true;
void _hostOk; void _playerOk;

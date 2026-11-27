// Reducer entry point: the action dispatcher and the public snapshot.
// Handler files export a map of action type → Handler; register new ones in HANDLERS below.
import type { GameState } from '../types';
import type { Action, ActionType, PublicSnapshot } from '../protocol';
import { type Ctx, type Handler, type Result, err } from './result';
import { playerHandlers } from './players';
import { phaseHandlers } from './phase';
import { scoringHandlers } from './scoring';
import { callsHandlers } from './calls';

export type { Ctx, To, Outbound, Result, Handler, HandlerMap } from './result';
export { ok, err, ignored } from './result';
export { addPoints, onTeamDeparted } from './scoring';
export { nextLeader, ordinal, departTeam, bossTeam } from './calls';
export { catchUp } from './catchup';
export { riddleState } from './scoring';
export {
  createState, persistable, restore, slotOf, isPlayingTeam, activePlayers, utcDay, type Persisted,
} from './state';

/** Total over every Action type: the compiler flags any action without a handler. */
const HANDLERS: { [T in ActionType]: Handler<T> } = {
  ...playerHandlers,
  ...phaseHandlers,
  ...scoringHandlers,
  ...callsHandlers,
};

/** Mutates `state`. On `error`, state is unchanged and nothing is sent except the error. */
export function apply(state: GameState, action: Action, ctx: Ctx): Result {
  // Indexing a mapped type by a union loses the type/handler pairing; HANDLERS guarantees it.
  // hasOwn: an untrusted type such as 'toString' must not reach Object.prototype.
  if (!Object.hasOwn(HANDLERS, action.type)) return err('unknown action');
  const h = HANDLERS[action.type] as (s: GameState, a: Action, c: Ctx) => Result;
  return h(state, action, ctx);
}

/** What every client may see: no riddle/boss answers, no quiz answers, no icebreaker prompts. */
export function publicSnapshot(state: GameState, ctx: Ctx): PublicSnapshot {
  const players: PublicSnapshot['players'] = {};
  for (const p of Object.values(state.players)) if (!p.removed) players[p.id] = p;
  const q = state.quiz ? ctx.content.quiz[state.quiz.questionIndex] : undefined;
  return structuredClone({
    phase: state.phase,
    paused: state.paused,
    teamOrder: state.teamOrder,
    teams: state.teams,
    players,
    motions: state.motions,
    online: state.online,
    collectibles: state.collectibles,
    departures: state.departures,
    lastCallAt: state.lastCallAt,
    quizActive: state.quiz && q ? { q: q.q, choices: q.choices, endsAt: state.quiz.endsAt } : null,
    serverNow: ctx.now,
  });
}

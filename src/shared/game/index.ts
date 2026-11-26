// Reducer entry point: the action dispatcher and the public snapshot.
// Handler files export a map of action type → Handler; register new ones in HANDLERS below.
import type { GameState } from '../types';
import type { Action, ActionType, PublicSnapshot } from '../protocol';
import { type Ctx, type Handler, type Result, err } from './result';
import { playerHandlers } from './players';
import { phaseHandlers } from './phase';

export type { Ctx, To, Outbound, Result, Handler, HandlerMap } from './result';
export { ok, err, ignored } from './result';
export {
  createState, persistable, restore, slotOf, isPlayingTeam, activePlayers, type Persisted,
} from './state';

// ---- NOT YET IMPLEMENTED (Tasks 5 and 6) ----
// Each later task deletes its keys here and spreads its own handler map into HANDLERS.
const notYet = (_s: GameState, a: Action): Result => err(`Not implemented yet: ${a.type}`);
const notYetImplemented = {
  // Task 5 (game/scoring.ts)
  icebreakerStart: notYet, icebreakerAnswered: notYet, icebreakerConfirm: notYet, icebreakerCancel: notYet,
  riddleAnswer: notYet, riddleSkip: notYet, quizAnswer: notYet,
  'host.quizStart': notYet, 'host.adjustScore': notYet, tick: notYet,
  // Task 6 (game/calls.ts)
  bossAnswer: notYet, 'host.callNext': notYet, 'host.undoCall': notYet,
};

/** Total over every Action type: the compiler flags any action without a handler. */
const HANDLERS: { [T in ActionType]: Handler<T> } = {
  ...notYetImplemented,
  ...playerHandlers,
  ...phaseHandlers,
};

/** Mutates `state`. On `error`, state is unchanged and nothing is sent except the error. */
export function apply(state: GameState, action: Action, ctx: Ctx): Result {
  // Indexing a mapped type by a union loses the type/handler pairing; HANDLERS guarantees it.
  const h = HANDLERS[action.type] as ((s: GameState, a: Action, c: Ctx) => Result) | undefined;
  if (!h) return err('unknown action');
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

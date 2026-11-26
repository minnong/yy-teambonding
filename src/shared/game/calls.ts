// Calling teams out (host.callNext), undoing a call, and the final boss for the last team standing.
import type { GameState, TeamId } from '../types';
import { nearTable } from '../layout';
import { positionAt, truncateAt } from '../motion';
import { matchesAnswer } from '../answers';
import { type Ctx, type Handler, type HandlerMap, type Outbound, ok, err } from './result';
import { isPlayingTeam, livePlayer, slotOf } from './state';
import { onTeamDeparted } from './scoring';

export { ordinal } from '../ordinal';

const PAUSED = 'Paused';
const NOT_COMPETING = 'The competition has not started';
const WRONG = 'Not quite, try again!';
const MAX_ANSWER = 200;
export const FINAL_BOSS_BANNER = 'FINAL BOSS: escape the lobby!';

export const upBanner = (name: string) => `🎉 Team ${name}, you're up! Head to the next activity.`;
export const backBanner = (name: string) => `Team ${name} is back in the game!`;

const playingTeams = (state: GameState): TeamId[] => state.teamOrder.filter((id) => isPlayingTeam(state, id));

/**
 * The team the next call would send out: highest score among playing teams, ties to the earliest
 * scoreChangedAt, then the lowest teamOrder index. Null outside the competition or when nobody
 * is left playing.
 */
export function nextLeader(state: GameState): TeamId | null {
  if (state.phase !== 'competition') return null;
  let best: TeamId | null = null;
  for (const id of playingTeams(state)) {
    if (best === null) { best = id; continue; }
    const t = state.teams[id]!, b = state.teams[best]!;
    if (t.score > b.score || (t.score === b.score && t.scoreChangedAt < b.scoreChangedAt)) best = id;
  }
  return best;
}

/**
 * Sends a team out: departed with the next departedOrder, recorded in departures/callTimes, its
 * players parked where they stand, its icebreakers closed. Returns those closes plus youreUp (to
 * the team) and the "you're up" banner (to all). Does not touch lastCallAt or scores.
 */
export function departTeam(state: GameState, teamId: TeamId, now: number): Outbound[] {
  const t = state.teams[teamId]!;
  t.status = 'departed';
  t.departedOrder = state.departures.length + 1;
  state.departures.push(teamId);
  state.callTimes.push(now);
  for (const p of Object.values(state.players)) {
    const m = state.motions[p.id];
    if (p.teamId === teamId && m) state.motions[p.id] = truncateAt(m, now);
  }
  const out = onTeamDeparted(state, teamId);
  out.push(
    { to: { team: teamId }, msg: { type: 'youreUp', teamId } },
    { to: 'all', msg: { type: 'banner', text: upBanner(t.name) } },
  );
  return out;
}

/** The boss message for a team at its current step (q is null once done). */
function bossMsg(state: GameState, teamId: TeamId, ctx: Ctx, active = true): Outbound {
  const t = state.teams[teamId]!;
  const q = active && !t.bossDone ? ctx.content.boss.steps[t.bossIndex]?.q ?? null : null;
  return { to: { team: teamId }, msg: { type: 'boss', index: t.bossIndex, q, done: t.bossDone } };
}

/** The sole playing team during the competition (the boss is on), else null. */
function bossTeam(state: GameState): TeamId | null {
  const left = playingTeams(state);
  return state.phase === 'competition' && left.length === 1 ? left[0]! : null;
}

const callNext: Handler<'host.callNext'> = (state, a, ctx) => {
  if (state.phase !== 'competition') return err(NOT_COMPETING);
  if (state.paused) return err(PAUSED);
  const leader = nextLeader(state);
  if (leader === null || a.expectedTeamId !== leader) return err('The leader changed, check again');
  const out = departTeam(state, leader, ctx.now);
  state.lastCallAt = ctx.now;
  const last = bossTeam(state);
  if (last) out.push({ to: 'all', msg: { type: 'banner', text: FINAL_BOSS_BANNER } }, bossMsg(state, last, ctx));
  return ok(out, { persist: true, snapshot: true });
};

/**
 * Reverts the latest call, never the goesFirst departure. The team plays (and scores) again with
 * its score untouched; boss progress (bossIndex/bossDone) is kept for whoever had it.
 */
const undoCall: Handler<'host.undoCall'> = (state, _a, ctx) => {
  if (state.phase !== 'competition') return err(NOT_COMPETING);
  if (state.paused) return err(PAUSED);
  const id = state.departures.at(-1);
  const t = id === undefined ? undefined : state.teams[id];
  if (!t || t.goesFirst || state.departures.length <= 1) return err('Nothing to undo');
  const hadBoss = bossTeam(state);
  t.status = 'playing';
  t.departedOrder = null;
  state.departures.pop();
  state.callTimes.pop();
  state.lastCallAt = state.callTimes.at(-1) ?? state.competitionStartedAt;
  const out: Outbound[] = [{ to: 'all', msg: { type: 'banner', text: backBanner(t.name) } }];
  // The previous last team standing loses the boss for now (q: null, done: false).
  if (hadBoss) out.push(bossMsg(state, hadBoss, ctx, false));
  return ok(out, { persist: true, snapshot: true });
};

const bossAnswer: Handler<'bossAnswer'> = (state, a, ctx) => {
  const p = livePlayer(state, a.playerId);
  if (!p) return err('unknown player');
  if (state.phase !== 'competition') return err('The final boss comes at the end of the competition');
  if (state.paused) return err(PAUSED);
  if (!isPlayingTeam(state, p.teamId)) return err("They've headed out!");
  if (bossTeam(state) !== p.teamId) return err('The final boss appears when only your team is left');
  const t = state.teams[p.teamId]!;
  if (t.bossDone) return err('You already escaped!');
  const step = ctx.content.boss.steps[t.bossIndex];
  if (!step) return err('No boss puzzle');
  const m = state.motions[p.id];
  if (!m || !nearTable(positionAt(m, ctx.now), slotOf(state, p.teamId))) return err('Head to your table to answer');
  if (typeof a.text !== 'string' || a.text.length > MAX_ANSWER || !matchesAnswer(a.text, step.answers)) return err(WRONG);
  t.bossIndex++;
  if (t.bossIndex >= ctx.content.boss.steps.length) {
    t.bossDone = true;
    return ok([{ to: 'all', msg: { type: 'celebrate', teamId: t.id } }, bossMsg(state, t.id, ctx)],
      { persist: true, snapshot: true });
  }
  return ok([bossMsg(state, t.id, ctx)], { persist: true, snapshot: true });
};

export const callsHandlers = {
  'host.callNext': callNext, 'host.undoCall': undoCall, bossAnswer,
} satisfies HandlerMap;

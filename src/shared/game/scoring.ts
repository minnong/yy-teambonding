// Scoring activities: icebreakers, collectibles, riddles, the quiz, host score adjustment and tick.
import type { GameState, Icebreaker, PlayerId, TeamId } from '../types';
import type { IcebreakerCard } from '../protocol';
import {
  COLLECTIBLE_MAX_MS, COLLECTIBLE_MIN_MS, MAX_COLLECTIBLES, POINTS, PROXIMITY, QUIZ_MS,
  RIDDLE_SKIP_LOCK_MS, TILE,
} from '../constants';
import { nearTable, randomOpenSpot } from '../layout';
import { pathPassesNear, positionAt } from '../motion';
import { matchesAnswer } from '../answers';
import { type Ctx, type Handler, type HandlerMap, type Outbound, ok, err, ignored } from './result';
import { activePlayers, closeIcebreakers, isPlayingTeam, livePlayer, slotOf } from './state';

const UNKNOWN_PLAYER = 'unknown player';
const PAUSED = 'Paused';
const HEADED_OUT = "They've headed out!";
const ALREADY_MET = 'already met! 🎉';
const MAX_ANSWER = 200;
const MAX_ADJUST = 500;

const competing = (state: GameState) => state.phase === 'competition' && !state.paused;
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const float = (teamId: TeamId, text: string): Outbound => ({ to: 'all', msg: { type: 'float', teamId, text } });

/**
 * Adds `n` points to a team, stamping scoreChangedAt. A no-op (returns []) unless the phase is
 * competition, the game is not paused, and the team is playing.
 */
export function addPoints(state: GameState, teamId: TeamId, n: number, reason: string, now: number): Outbound[] {
  if (!competing(state) || !isPlayingTeam(state, teamId)) return [];
  const t = state.teams[teamId]!;
  t.score += n;
  t.scoreChangedAt = now;
  return [float(teamId, `${signed(n)} ${reason}`)];
}

/** Closes every open icebreaker involving a member of `teamId` (closedReason 'departed'). */
export function onTeamDeparted(state: GameState, teamId: TeamId): Outbound[] {
  const onTeam = (id: PlayerId) => state.players[id]?.teamId === teamId;
  return closeIcebreakers(state, (ib) => onTeam(ib.a) || onTeam(ib.b), 'departed');
}

// ---------- icebreakers ----------

const pairKey = (a: PlayerId, b: PlayerId) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const inIcebreaker = (state: GameState, id: PlayerId) =>
  Object.values(state.icebreakers).some((ib) => ib.a === id || ib.b === id);

function cardOf(ib: Icebreaker, ctx: Ctx): IcebreakerCard {
  return { id: ib.id, a: ib.a, b: ib.b, prompt: ctx.content.icebreakers[ib.prompt] ?? '', answeredBy: ib.answeredBy };
}
const sendCard = (ib: Icebreaker, ctx: Ctx): Outbound[] =>
  [ib.a, ib.b].map((who) => ({ to: { player: who }, msg: { type: 'icebreaker', card: cardOf(ib, ctx) } }));

/** The open icebreaker `id` if `playerId` is one of its two participants, else an error message. */
function ownIcebreaker(state: GameState, id: string, playerId: PlayerId): Icebreaker | string {
  const ib = Object.hasOwn(state.icebreakers, id) ? state.icebreakers[id] : undefined;
  if (!ib) return 'That icebreaker has ended';
  if (ib.a !== playerId && ib.b !== playerId) return 'Not your icebreaker';
  return ib;
}

const icebreakerStart: Handler<'icebreakerStart'> = (state, a, ctx) => {
  const me = livePlayer(state, a.playerId), them = livePlayer(state, a.target);
  if (!me || !them || me.id === them.id) return err(UNKNOWN_PLAYER);
  if (!state.online[me.id] || !state.online[them.id]) return err("They're not here right now");
  if (state.paused) return err(PAUSED);
  if (me.teamId === them.teamId) return err('Find someone from another team!');
  if (state.phase === 'competition' && (!isPlayingTeam(state, me.teamId) || !isPlayingTeam(state, them.teamId)))
    return err(HEADED_OUT);
  if (inIcebreaker(state, me.id) || inIcebreaker(state, them.id)) return err('Already in an icebreaker');
  const ma = state.motions[me.id], mb = state.motions[them.id];
  if (!ma || !mb) return err('Too far away');
  const pa = positionAt(ma, ctx.now), pb = positionAt(mb, ctx.now);
  if (Math.hypot(pa.x - pb.x, pa.y - pb.y) > PROXIMITY) return err('Too far away');
  if (state.metPairs.includes(pairKey(me.id, them.id))) return err(ALREADY_MET);
  const len = ctx.content.icebreakers.length;
  if (len === 0) return err('No icebreakers available');

  // promptCursor only ever increases (until reset, which also clears icebreakers), so it doubles
  // as a unique, deterministic id counter without adding a field to GameState.
  const n = state.promptCursor++;
  const ib: Icebreaker = { id: `ib-${n}`, a: me.id, b: them.id, prompt: n % len, answeredBy: null };
  state.icebreakers[ib.id] = ib;
  return ok(sendCard(ib, ctx));
};

const icebreakerAnswered: Handler<'icebreakerAnswered'> = (state, a, ctx) => {
  const ib = ownIcebreaker(state, a.id, a.playerId);
  if (typeof ib === 'string') return err(ib);
  if (ib.answeredBy === a.playerId) return ignored();
  if (ib.answeredBy) return err('Waiting for you to confirm');
  ib.answeredBy = a.playerId;
  return ok(sendCard(ib, ctx));
};

const icebreakerConfirm: Handler<'icebreakerConfirm'> = (state, a, ctx) => {
  const ib = ownIcebreaker(state, a.id, a.playerId);
  if (typeof ib === 'string') return err(ib);
  if (!ib.answeredBy) return err('Nobody has answered yet');
  if (ib.answeredBy === a.playerId) return err('The other person needs to confirm');
  if (state.paused) return err(PAUSED);
  const ta = state.players[ib.a]!.teamId, tb = state.players[ib.b]!.teamId;
  const out = closeIcebreakers(state, (x) => x.id === ib.id, 'done');
  if (state.phase === 'competition' && isPlayingTeam(state, ta) && isPlayingTeam(state, tb)) {
    out.push(
      ...addPoints(state, ta, POINTS.icebreaker, 'icebreaker', ctx.now),
      ...addPoints(state, tb, POINTS.icebreaker, 'icebreaker', ctx.now),
    );
    state.metPairs.push(pairKey(ib.a, ib.b));
    return ok(out, { persist: true, snapshot: true });
  }
  return ok(out);
};

const icebreakerCancel: Handler<'icebreakerCancel'> = (state, a) => {
  const ib = ownIcebreaker(state, a.id, a.playerId);
  if (typeof ib === 'string') return err(ib);
  return ok(closeIcebreakers(state, (x) => x.id === ib.id, 'cancelled'));
};

// ---------- riddles ----------

/** Shared riddle gate: returns the player's team id, or an error message. */
function riddleTeam(state: GameState, playerId: PlayerId, ctx: Ctx): TeamId | { error: string } {
  const p = livePlayer(state, playerId);
  if (!p) return { error: UNKNOWN_PLAYER };
  if (state.phase !== 'competition') return { error: 'Riddles open when the competition starts' };
  if (state.paused) return { error: PAUSED };
  if (!isPlayingTeam(state, p.teamId)) return { error: HEADED_OUT };
  const m = state.motions[playerId];
  if (!m || !nearTable(positionAt(m, ctx.now), slotOf(state, p.teamId))) return { error: 'Head to your table to answer' };
  const t = state.teams[p.teamId]!;
  if (ctx.now < t.riddleLockedUntil) return { error: 'Riddle locked, hang on!' };
  if (t.riddleIndex >= ctx.content.riddles.length) return { error: 'No more riddles' };
  return p.teamId;
}

function riddleMsg(state: GameState, teamId: TeamId, ctx: Ctx): Outbound {
  const t = state.teams[teamId]!;
  return {
    to: { team: teamId },
    msg: { type: 'riddle', index: t.riddleIndex, q: ctx.content.riddles[t.riddleIndex]?.q ?? null, lockedUntil: t.riddleLockedUntil },
  };
}

const riddleAnswer: Handler<'riddleAnswer'> = (state, a, ctx) => {
  const teamId = riddleTeam(state, a.playerId, ctx);
  if (typeof teamId !== 'string') return err(teamId.error);
  if (typeof a.text !== 'string' || a.text.length > MAX_ANSWER) return err('Not quite, try again!');
  const t = state.teams[teamId]!;
  if (!matchesAnswer(a.text, ctx.content.riddles[t.riddleIndex]!.answers)) return err('Not quite, try again!');
  const out = addPoints(state, teamId, POINTS.riddle, 'riddle', ctx.now);
  t.riddleIndex++;
  out.push(riddleMsg(state, teamId, ctx));
  return ok(out, { persist: true, snapshot: true });
};

const riddleSkip: Handler<'riddleSkip'> = (state, a, ctx) => {
  const teamId = riddleTeam(state, a.playerId, ctx);
  if (typeof teamId !== 'string') return err(teamId.error);
  const t = state.teams[teamId]!;
  t.riddleIndex++;
  t.riddleLockedUntil = ctx.now + RIDDLE_SKIP_LOCK_MS;
  return ok([riddleMsg(state, teamId, ctx)], { persist: true, snapshot: true });
};

// ---------- quiz ----------

const quizStart: Handler<'host.quizStart'> = (state, _a, ctx) => {
  if (state.phase !== 'competition') return err('The quiz runs during the competition');
  if (state.paused) return err(PAUSED);
  if (state.quiz) return err('A quiz is already running');
  const len = ctx.content.quiz.length;
  if (len === 0) return err('No quiz questions');
  const questionIndex = state.nextQuizIndex++ % len;
  const q = ctx.content.quiz[questionIndex]!;
  state.quiz = { questionIndex, endsAt: ctx.now + QUIZ_MS, answers: {} };
  return ok([{ to: 'all', msg: { type: 'quiz', q: q.q, choices: q.choices, endsAt: state.quiz.endsAt } }],
    { persist: true, snapshot: true });
};

const quizAnswer: Handler<'quizAnswer'> = (state, a, ctx) => {
  const p = livePlayer(state, a.playerId);
  if (!p) return err(UNKNOWN_PLAYER);
  const quiz = state.quiz;
  if (!quiz || state.paused || ctx.now >= quiz.endsAt || !isPlayingTeam(state, p.teamId)) return ignored();
  if (Object.hasOwn(quiz.answers, p.id)) return ignored();
  const choices = ctx.content.quiz[quiz.questionIndex]?.choices.length ?? 0;
  if (!Number.isInteger(a.choice) || a.choice < 0 || a.choice >= choices) return err('Invalid choice');
  quiz.answers[p.id] = a.choice;
  return ok([], { persist: true });
};

/** Scores and closes the quiz. Teams are judged by who is playing and online right now. */
function closeQuiz(state: GameState, ctx: Ctx): Outbound[] {
  const quiz = state.quiz!;
  const correct = ctx.content.quiz[quiz.questionIndex]?.correct ?? -1;
  const perTeam: Record<TeamId, number> = {};
  const out: Outbound[] = [];
  for (const teamId of state.teamOrder) {
    if (!isPlayingTeam(state, teamId)) continue;
    // Numerator and denominator are the same group: the team's active players at close.
    const active = activePlayers(state, teamId);
    const right = active.filter((id) => Object.hasOwn(quiz.answers, id) && quiz.answers[id] === correct).length;
    const denom = Math.max(1, active.length);
    const pts = Math.min(POINTS.quizMax, Math.round((POINTS.quizMax * right) / denom));
    perTeam[teamId] = pts;
    if (pts > 0) out.push(...addPoints(state, teamId, pts, 'quiz', ctx.now));
  }
  state.quiz = null;
  out.push({ to: 'all', msg: { type: 'quizResult', correct, perTeam } });
  return out;
}

// ---------- host score adjustment ----------

const adjustScore: Handler<'host.adjustScore'> = (state, a, ctx) => {
  const t = Object.hasOwn(state.teams, a.teamId) ? state.teams[a.teamId] : undefined;
  if (!t) return err('unknown team');
  const d = a.delta;
  if (!Number.isInteger(d) || d === 0 || Math.abs(d) > MAX_ADJUST)
    return err(`Adjustment must be a whole number from -${MAX_ADJUST} to ${MAX_ADJUST}, not 0`);
  t.score += d;
  t.scoreChangedAt = ctx.now;
  return ok([float(t.id, `${signed(d)} adjusted`)], { persist: true, snapshot: true });
}

// ---------- tick ----------

/**
 * Periodic housekeeping. Order: close a due quiz, collect sparkles walked through since the last
 * tick, spawn a new one if due; then lastTickAt = now. While paused only lastTickAt moves (motions
 * are truncated on pause, so no pickups are missed or invented).
 */
const tick: Handler<'tick'> = (state, _a, ctx) => {
  const now = ctx.now;
  const from = state.lastTickAt;
  state.lastTickAt = now;
  if (!competing(state)) return ok();
  const out: Outbound[] = [];
  let changed = false;

  if (state.quiz && now >= state.quiz.endsAt) {
    out.push(...closeQuiz(state, ctx));
    changed = true;
  }

  if (state.collectibles.length > 0) {
    const collectors = Object.keys(state.online).filter((id) => {
      const p = livePlayer(state, id);
      return p && state.online[id] && state.motions[id] && isPlayingTeam(state, p.teamId);
    }).sort();
    state.collectibles = state.collectibles.filter((c) => {
      const who = collectors.find((id) => pathPassesNear(state.motions[id]!, from, now, c.pos, TILE * 0.75));
      if (!who) return true;
      out.push(...addPoints(state, state.players[who]!.teamId, POINTS.collectible, 'sparkle', now));
      changed = true;
      return false;
    });
  }

  if ((state.nextCollectibleAt === null || now >= state.nextCollectibleAt) && state.collectibles.length < MAX_COLLECTIBLES) {
    state.collectibles.push({ id: `c-${now}`, pos: randomOpenSpot(ctx.rng) });
    state.nextCollectibleAt = now + Math.round(COLLECTIBLE_MIN_MS + ctx.rng() * (COLLECTIBLE_MAX_MS - COLLECTIBLE_MIN_MS));
    changed = true;
  }

  return changed ? ok(out, { persist: true, snapshot: true }) : ok(out);
};

export const scoringHandlers = {
  tick, icebreakerStart, icebreakerAnswered, icebreakerConfirm, icebreakerCancel,
  riddleAnswer, riddleSkip, quizAnswer, 'host.quizStart': quizStart, 'host.adjustScore': adjustScore,
} satisfies HandlerMap;

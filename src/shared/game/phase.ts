// Phase transitions: start competition, pause/resume, reset.
import { truncateAt } from '../motion';
import { type Handler, type HandlerMap, ok, err } from './result';
import { createState } from './state';
import { departTeam } from './calls';

export { upBanner } from './calls';

const startCompetition: Handler<'host.startCompetition'> = (state, _a, ctx) => {
  if (state.phase !== 'warmup') return err('The competition has already started');
  const first = Object.values(state.teams).find((t) => t.goesFirst);
  if (!first) return err('No team is set to go first');
  const now = ctx.now;
  state.phase = 'competition';
  state.competitionStartedAt = now;
  state.lastCallAt = now;
  state.lastTickAt = now;
  for (const t of Object.values(state.teams)) { t.score = 0; t.scoreChangedAt = now; }
  return ok(departTeam(state, first.id, now), { persist: true, snapshot: true });
};

const pause: Handler<'host.pause'> = (state, _a, ctx) => {
  if (state.paused) return err('Already paused');
  for (const [id, m] of Object.entries(state.motions)) state.motions[id] = truncateAt(m, ctx.now);
  state.paused = true;
  state.pausedAt = ctx.now;
  return ok([{ to: 'all', msg: { type: 'banner', text: 'Paused' } }], { persist: true, snapshot: true });
};

const resume: Handler<'host.resume'> = (state, _a, ctx) => {
  if (!state.paused) return err('Not paused');
  const pausedAt = state.pausedAt ?? ctx.now;
  const d = Math.max(0, ctx.now - pausedAt);
  if (state.nextCollectibleAt !== null) state.nextCollectibleAt += d;
  if (state.quiz) state.quiz.endsAt += d;
  // Only locks still running at pause time need extending; expired ones stay expired.
  for (const t of Object.values(state.teams)) if (t.riddleLockedUntil > pausedAt) t.riddleLockedUntil += d;
  state.paused = false;
  state.pausedAt = null;
  return ok([{ to: 'all', msg: { type: 'banner', text: '' } }], { persist: true, snapshot: true });
};

/**
 * Back to a fresh createState(content): the content roster, warm-up, no scores. Keeps roster
 * players' looks, and online/motions for players that still exist, plus msgCount.
 * The Room then closes every player socket with code 4002 so clients re-hello.
 */
const reset: Handler<'host.reset'> = (state, _a, ctx) => {
  const fresh = createState(ctx.content, ctx.now);
  for (const p of Object.values(fresh.players)) {
    const old = state.players[p.id];
    if (old && !old.addedOnDay) p.look = old.look;
    if (state.online[p.id]) fresh.online[p.id] = true;
    const m = state.motions[p.id];
    if (m) fresh.motions[p.id] = m;
  }
  fresh.msgCount = state.msgCount;
  Object.assign(state, fresh);
  return ok([], { persist: true, snapshot: true });
};

export const phaseHandlers = {
  'host.startCompetition': startCompetition, 'host.pause': pause, 'host.resume': resume, 'host.reset': reset,
} satisfies HandlerMap;

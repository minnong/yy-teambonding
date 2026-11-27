// Phase transitions: start competition, pause/resume, reset.
import { truncateAt } from '../motion';
import { type Handler, type HandlerMap, ok, err } from './result';
import { createState, newEpoch } from './state';
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

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Back to a fresh createState(content): the content roster, warm-up, no scores, a new epoch.
 * A roster slot keeps its look only if its name is unchanged (so nobody inherits someone else's
 * avatar); online/motions are kept for players that still exist, plus msgCount.
 * The Room then closes every player and picker socket with code 4002; the new epoch makes every
 * phone that joined before (online or not) go back to the name picker.
 */
const reset: Handler<'host.reset'> = (state, _a, ctx) => {
  const fresh = createState(ctx.content, ctx.now, ctx.rng);
  // A repeat of the old epoch (same instant, same rng draw) would let stale identities back in.
  for (let t = ctx.now + 1; fresh.epoch === state.epoch; t++) fresh.epoch = newEpoch(t, ctx.rng);
  for (const p of Object.values(fresh.players)) {
    const old = state.players[p.id];
    if (old && !old.addedOnDay && sameName(old.name, p.name)) p.look = old.look;
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

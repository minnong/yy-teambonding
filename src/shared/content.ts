import type { Content } from './types';
import eventJson from '../../content/event.json';

export const MIN_ICEBREAKERS = 60;
export const MIN_RIDDLES = 15;
export const MIN_QUIZ = 12;
export const MIN_BOSS_STEPS = 4;
export const MAX_BOSS_STEPS = 5;

export function validateContent(c: Content): string[] {
  const p: string[] = [];
  const teamIds = new Set<string>();
  for (const t of c.teams) {
    if (teamIds.has(t.id)) p.push(`duplicate team id: ${t.id}`);
    teamIds.add(t.id);
  }
  const first = c.teams.filter((t) => t.goesFirst).length;
  if (first !== 1) p.push(`exactly one team must have goesFirst (found ${first})`);

  const playerIds = new Set<string>();
  for (const pl of c.players) {
    if (playerIds.has(pl.id)) p.push(`duplicate player id: ${pl.id}`);
    playerIds.add(pl.id);
    if (!teamIds.has(pl.teamId)) p.push(`player ${pl.id} has unknown team: ${pl.teamId}`);
    if (!pl.name.trim()) p.push(`player ${pl.id} has an empty name`);
  }

  if (c.icebreakers.length < MIN_ICEBREAKERS) p.push(`need at least ${MIN_ICEBREAKERS} icebreakers (have ${c.icebreakers.length})`);
  if (c.riddles.length < MIN_RIDDLES) p.push(`need at least ${MIN_RIDDLES} riddles (have ${c.riddles.length})`);
  if (c.quiz.length < MIN_QUIZ) p.push(`need at least ${MIN_QUIZ} quiz questions (have ${c.quiz.length})`);
  const steps = c.boss.steps.length;
  if (steps < MIN_BOSS_STEPS) p.push(`boss chain needs at least ${MIN_BOSS_STEPS} steps (have ${steps})`);
  if (steps > MAX_BOSS_STEPS) p.push(`boss chain needs at most ${MAX_BOSS_STEPS} steps (have ${steps})`);

  c.riddles.forEach((r, i) => {
    if (!r.q.trim()) p.push(`riddle ${i + 1} has an empty question`);
    if (r.answers.length === 0) p.push(`riddle ${i + 1} needs at least one answer`);
  });
  c.boss.steps.forEach((s, i) => {
    if (!s.q.trim()) p.push(`boss step ${i + 1} has an empty question`);
    if (s.answers.length === 0) p.push(`boss step ${i + 1} needs at least one answer`);
  });
  c.quiz.forEach((q, i) => {
    if (q.choices.length < 2) p.push(`quiz question ${i + 1} needs at least 2 choices`);
    if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.choices.length) {
      p.push(`quiz question ${i + 1} has a correct index out of range (${q.correct})`);
    }
  });
  return p;
}

export function loadContent(): Content {
  const c = eventJson as Content;
  const problems = validateContent(c);
  if (problems.length) throw new Error(`Invalid content/event.json:\n- ${problems.join('\n- ')}`);
  return c;
}

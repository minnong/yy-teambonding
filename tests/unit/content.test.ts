import { describe, it, expect } from 'vitest';
import { loadContent, validateContent } from '@shared/content';
import type { Content } from '@shared/types';

const fresh = (): Content => structuredClone(loadContent());

describe('content', () => {
  it('default content is valid', () => {
    expect(validateContent(loadContent())).toEqual([]);
  });

  // The rest of the unit tests are written against this placeholder roster (p01–p36), so a real
  // roster is checked with `npm run check-content`, not `npm test` (README §2).
  it('default content has 36 players in 7 teams of 5,5,5,5,5,5,6', () => {
    const c = loadContent();
    expect(c.players).toHaveLength(36);
    expect(c.teams).toHaveLength(7);
    const sizes = c.teams.map((t) => c.players.filter((p) => p.teamId === t.id).length);
    expect(sizes.sort((a, b) => a - b)).toEqual([5, 5, 5, 5, 5, 5, 6]);
  });

  it('rejects zero or two goesFirst teams', () => {
    const none = fresh();
    none.teams.forEach((t) => delete t.goesFirst);
    expect(validateContent(none).join('\n')).toContain('exactly one team must have goesFirst');
    const two = fresh();
    two.teams[1]!.goesFirst = true;
    expect(validateContent(two).join('\n')).toContain('exactly one team must have goesFirst');
  });

  it('rejects a player whose teamId is unknown', () => {
    const c = fresh();
    c.players[0]!.teamId = 'nope';
    expect(validateContent(c).join('\n')).toContain('unknown team');
  });

  it('rejects duplicate player ids', () => {
    const c = fresh();
    c.players[1]!.id = c.players[0]!.id;
    expect(validateContent(c).join('\n')).toContain('duplicate player id');
  });

  it('rejects too little content', () => {
    const a = fresh(); a.icebreakers = a.icebreakers.slice(0, 59);
    expect(validateContent(a).join('\n')).toContain('at least');
    const b = fresh(); b.riddles = b.riddles.slice(0, 14);
    expect(validateContent(b).join('\n')).toContain('at least');
    const q = fresh(); q.quiz = q.quiz.slice(0, 11);
    expect(validateContent(q).join('\n')).toContain('at least');
    const s = fresh(); s.boss.steps = s.boss.steps.slice(0, 3);
    expect(validateContent(s).join('\n')).toContain('at least');
    const l = fresh(); l.boss.steps = [...l.boss.steps, ...l.boss.steps];
    expect(validateContent(l).join('\n')).toMatch(/at most|4.5/);
  });

  it('rejects quiz correct index out of range', () => {
    const c = fresh();
    c.quiz[0]!.correct = 4;
    expect(validateContent(c).join('\n')).toContain('correct index');
  });

  it('rejects answers that can never match (blank after normalising), blank choices and blank icebreakers', () => {
    const r = fresh(); r.riddles[0]!.answers = ['egg', '  ', '?!'];
    expect(validateContent(r).join('\n')).toContain('riddle 1 has an answer that can never match');
    const b = fresh(); b.boss.steps[2]!.answers = ['!!'];
    expect(validateContent(b).join('\n')).toContain('boss step 3 has an answer that can never match');
    const q = fresh(); q.quiz[1]!.choices[0] = ' ';
    expect(validateContent(q).join('\n')).toContain('quiz question 2 has an empty choice');
    const d = fresh(); d.quiz[1]!.choices[1] = d.quiz[1]!.choices[0]!;
    expect(validateContent(d).join('\n')).toContain('quiz question 2 has duplicate choices');
    const i = fresh(); i.icebreakers[4] = '';
    expect(validateContent(i).join('\n')).toContain('icebreaker 5 is empty');
  });
});


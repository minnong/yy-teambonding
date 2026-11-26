import { describe, it, expect } from 'vitest';
import { loadContent, validateContent } from '@shared/content';
import type { Content } from '@shared/types';

const fresh = (): Content => structuredClone(loadContent());

describe('content', () => {
  it('default content is valid', () => {
    expect(validateContent(loadContent())).toEqual([]);
  });

  it('default content has 36 players in 7 teams of 5,5,5,5,5,5,6', () => {
    const c = loadContent();
    expect(c.players).toHaveLength(36);
    expect(c.teams).toHaveLength(7);
    const sizes = c.teams.map((t) => c.players.filter((p) => p.teamId === t.id).length);
    expect(sizes.sort()).toEqual([5, 5, 5, 5, 5, 5, 6]);
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
});

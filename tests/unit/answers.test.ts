import { describe, it, expect } from 'vitest';
import { matchesAnswer } from '@shared/answers';

describe('answers', () => {
  it('"  The Piano! " matches ["piano"]; "pianos" does not', () => {
    expect(matchesAnswer('  The Piano! ', ['piano'])).toBe(true);
    expect(matchesAnswer('pianos', ['piano'])).toBe(false);
  });

  it('normalises both sides: case, whitespace, punctuation and a leading article', () => {
    expect(matchesAnswer('an   EGG', ['egg'])).toBe(true);
    expect(matchesAnswer('egg', ['An egg.'])).toBe(true);
    expect(matchesAnswer('a  towel?!', ['towel'])).toBe(true);
    expect(matchesAnswer('your  name', ['Your name'])).toBe(true);
    expect(matchesAnswer('umbrellas', ['umbrella', 'umbrellas'])).toBe(true);
  });

  it('only strips a leading article, and only as a whole word', () => {
    expect(matchesAnswer('theatre', ['atre'])).toBe(false);
    expect(matchesAnswer('another', ['nother'])).toBe(false);
    expect(matchesAnswer('piano the', ['piano'])).toBe(false);
  });

  it('hyphens, slashes and underscores count as spaces', () => {
    expect(matchesAnswer('ice-cream', ['ice cream'])).toBe(true);
    expect(matchesAnswer('ice cream', ['ice-cream'])).toBe(true);
    expect(matchesAnswer('foot/steps', ['foot steps'])).toBe(true);
    expect(matchesAnswer('foot_steps', ['foot steps'])).toBe(true);
    expect(matchesAnswer('the-piano', ['piano'])).toBe(true);
    expect(matchesAnswer('ice-cream', ['icecream'])).toBe(false);
  });

  it('empty input never matches', () => {
    expect(matchesAnswer('   ', [''])).toBe(false);
    expect(matchesAnswer('!!', ['piano'])).toBe(false);
    expect(matchesAnswer('piano', [])).toBe(false);
  });
});

describe('answers: typographic dashes (iOS Smart Punctuation)', () => {
  it('en, em, figure, minus and other Unicode dashes count as spaces like "-"', () => {
    for (const d of ['\u2010', '\u2011', '\u2012', '\u2013', '\u2014', '\u2015', '\u2212']) {
      expect(matchesAnswer(`ice${d}cream`, ['ice cream'])).toBe(true);
      expect(matchesAnswer(`foot${d}steps`, ['foot-steps'])).toBe(true);
    }
  });
});

describe('answers: riddle alternates (T2)', () => {
  it('common valid answers are accepted', async () => {
    const { loadContent } = await import('@shared/content');
    const c = loadContent();
    const riddle = (start: string) => c.riddles.find((r) => r.q.startsWith(start))!.answers;
    for (const a of ['saw', 'gear', 'a cog', 'comb']) expect(matchesAnswer(a, riddle('What has teeth'))).toBe(true);
    for (const a of ['storm', 'a hurricane', 'potato', 'needle']) expect(matchesAnswer(a, riddle('What has an eye'))).toBe(true);
    for (const a of ['newspaper', 'a dictionary', 'book']) expect(matchesAnswer(a, riddle('What has words'))).toBe(true);
    for (const a of ['computer', 'a laptop', 'keyboard']) expect(matchesAnswer(a, c.boss.steps[0]!.answers)).toBe(true);
  });
});


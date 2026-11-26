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

  it('empty input never matches', () => {
    expect(matchesAnswer('   ', [''])).toBe(false);
    expect(matchesAnswer('!!', ['piano'])).toBe(false);
    expect(matchesAnswer('piano', [])).toBe(false);
  });
});

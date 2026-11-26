// Free-text answer matching for riddles and the boss.

/**
 * Lowercase, strip accents and punctuation, collapse whitespace, trim, and drop one leading
 * "a " / "an " / "the ".
 */
export function normalizeAnswer(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ').trim()
    .replace(/^(?:a|an|the) /, '');
}

/** True if `input` equals one of `accepted` after both are normalised. Empty input never matches. */
export function matchesAnswer(input: string, accepted: string[]): boolean {
  if (typeof input !== 'string') return false;
  const n = normalizeAnswer(input);
  return n !== '' && accepted.some((a) => normalizeAnswer(a) === n);
}

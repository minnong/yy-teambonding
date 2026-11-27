import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateContent } from '@shared/content';
import type { Content } from '@shared/types';

// The other tests use tests/fixtures/event.json; this one checks the file that actually ships.
describe('real content/event.json', () => {
  it('is valid', () => {
    const path = resolve(import.meta.dirname, '../../content/event.json');
    const c = JSON.parse(readFileSync(path, 'utf8')) as Content;
    expect(validateContent(c)).toEqual([]);
  });
});

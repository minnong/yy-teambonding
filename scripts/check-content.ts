// Checks content/event.json the way the server will (validateContent) and prints the roster shape.
// Use this after editing the real roster: `npm test` is written against the placeholder roster.
//   npm run check-content
import { readFileSync } from 'node:fs';
import { validateContent } from '../src/shared/content';
import type { Content } from '../src/shared/types';

const path = new URL('../content/event.json', import.meta.url);
let c: Content;
try {
  c = JSON.parse(readFileSync(path, 'utf8')) as Content;
} catch (e) {
  console.error(`content/event.json is not valid JSON: ${(e as Error).message}`);
  process.exit(1);
}
const problems = validateContent(c);
for (const t of c.teams ?? []) {
  const n = (c.players ?? []).filter((p) => p.teamId === t.id).length;
  console.log(`${t.goesFirst ? '★' : ' '} ${t.name.padEnd(16)} ${n} players`);
}
console.log(`${c.players?.length ?? 0} players in ${c.teams?.length ?? 0} teams`);
if (problems.length) {
  console.error(`\nProblems:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('content/event.json is OK');

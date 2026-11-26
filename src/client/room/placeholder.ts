// Placeholder room. Task 10 replaces this module (or the single import in main.ts) with the real scene.
import type { Net } from '../net';
import type { Me } from '../identity';
import type { PublicSnapshot } from '@shared/protocol';

export function startRoom(_net: Net, me: Me, snapshot: PublicSnapshot): void {
  const p = snapshot.players[me.playerId];
  const team = p ? snapshot.teams[p.teamId] : undefined;
  const root = document.querySelector('#app')!;
  root.replaceChildren();
  const box = document.createElement('div');
  box.className = 'lb-center';
  const h = document.createElement('h1');
  h.textContent = "You're in! Room coming soon";
  const who = document.createElement('p');
  who.textContent = p?.name ?? me.playerId;
  const t = document.createElement('p');
  t.textContent = team ? `Team ${team.name}` : '';
  if (team) t.style.color = team.color;
  box.replaceChildren(h, who, t);
  root.appendChild(box);
}

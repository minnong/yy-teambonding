// Name picker: roster from a read-only peek, grouped by team; or add yourself on the day.
import type { PublicSnapshot } from '@shared/protocol';
import { MAX_NAME_LEN } from '@shared/protocol';
import type { Net } from '../net';

export interface PickerHandlers {
  onPick(playerId: string): void;
  onAddSelf(name: string, teamId: string): void;
}
export interface PickerView {
  /** Shows a server error under the add-yourself form. */
  showError(message: string): void;
  destroy(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function creditsLink(): HTMLAnchorElement {
  const a = el('a', 'lb-credits', 'Credits');
  a.href = '/CREDITS.md';
  return a;
}

/** Waits for the roster: call `net.connect({t:'peek'})` first. Returns a view that can show errors. */
export function showNamePicker(root: HTMLElement, net: Net, h: PickerHandlers): PickerView {
  const wrap = el('div', 'lb-picker');
  root.replaceChildren(wrap);
  wrap.replaceChildren(el('h1', undefined, 'Who are you?'), el('p', 'lb-status', 'Connecting…'));
  let error: HTMLElement | null = null;
  let snap: PublicSnapshot | null = null;
  let rendered = false;

  // Render once: a later snapshot (peek replay after a reconnect) must not wipe the add-yourself form.
  const off = net.on('snapshot', (m) => { snap = m.snapshot; if (!rendered) { rendered = true; renderList(); } });
  const offState = net.on('state', (s) => {
    if (!snap && s === 'reconnecting') wrap.querySelector('.lb-status')?.replaceChildren('Connecting…');
  });

  function renderList(): void {
    const s = snap!;
    const list = el('div', 'lb-list');
    for (const id of s.teamOrder) {
      const team = s.teams[id];
      if (!team) continue;
      const players = Object.values(s.players).filter((p) => !p.removed && p.teamId === id)
        .sort((a, b) => a.name.localeCompare(b.name));
      if (players.length === 0) continue;
      const head = el('h2', 'lb-team', team.name);
      head.style.borderLeftColor = team.color;
      list.appendChild(head);
      for (const p of players) {
        const b = el('button', 'lb-row', p.name);
        b.style.borderLeftColor = team.color;
        b.addEventListener('click', () => h.onPick(p.id));
        list.appendChild(b);
      }
    }
    const add = el('button', 'lb-add', "I'm not on the list");
    add.addEventListener('click', () => renderAdd());
    const foot = el('div', 'lb-foot', undefined);
    foot.replaceChildren(add, creditsLink());
    wrap.replaceChildren(el('h1', undefined, 'Who are you?'), list, foot);
  }

  function renderAdd(): void {
    const s = snap!;
    const form = el('div', 'lb-form');
    const input = el('input');
    input.type = 'text';
    input.maxLength = MAX_NAME_LEN;
    input.placeholder = 'Your name';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Your name');
    let teamId: string | null = null;
    const teams = el('div', 'lb-teams');
    const go = el('button', 'lb-go', 'Join');
    const back = el('button', 'lb-back', 'Back');
    error = el('p', 'lb-error');
    error.setAttribute('role', 'alert');
    const teamBtns: HTMLButtonElement[] = [];
    for (const id of s.teamOrder) {
      const t = s.teams[id];
      if (!t) continue;
      const b = el('button', 'lb-team-btn', t.name);
      b.style.setProperty('--c', t.color);
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => {
        teamId = id;
        for (const o of teamBtns) o.setAttribute('aria-pressed', String(o === b));
      });
      teamBtns.push(b);
      teams.appendChild(b);
    }
    go.addEventListener('click', () => {
      const name = input.value.trim();
      if (!name) { error!.textContent = 'Type your name'; return; }
      if (!teamId) { error!.textContent = 'Pick your team'; return; }
      error!.textContent = '';
      h.onAddSelf(name, teamId);
    });
    back.addEventListener('click', () => renderList());
    form.replaceChildren(input, el('p', 'lb-hint', 'Your team'), teams, error, go, back);
    wrap.replaceChildren(el('h1', undefined, "I'm not on the list"), form);
  }

  return {
    showError(message) { if (error) error.textContent = message; },
    destroy() { off(); offState(); wrap.remove(); },
  };
}

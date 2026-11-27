// Name picker: roster from a read-only peek, grouped by team; or add yourself on the day.
import type { PublicSnapshot } from '@shared/protocol';
import { MAX_NAME_LEN } from '@shared/protocol';
import { NAME_TAKEN } from '@shared/game/players';
import type { Net } from '../net';

export interface PickerHandlers {
  /** `epoch` is that of the snapshot the tapped list was drawn from (read at tap time). */
  onPick(playerId: string, epoch: string): void;
  onAddSelf(name: string, teamId: string): void;
}
export interface PickerView {
  /** Shows a server error under the add-yourself form. */
  showError(message: string): void;
  destroy(): void;
}

/** Changes only when the list the picker shows would change: names, teams, removals. */
export function rosterKey(s: PublicSnapshot): string {
  return JSON.stringify([
    s.teamOrder.map((id) => [id, s.teams[id]?.name ?? '']),
    Object.values(s.players).filter((p) => !p.removed).map((p) => [p.id, p.name, p.teamId]).sort(),
  ]);
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
  /** What is on screen: nothing yet, the list (with the roster it was drawn from), or the add form. */
  let view: 'none' | 'list' | 'add' = 'none';
  let shownKey = '';

  // A later snapshot (peek replay after a reconnect) redraws the list only if the roster changed,
  // and never wipes the add-yourself form being typed into.
  const off = net.on('snapshot', (m) => {
    snap = m.snapshot;
    if (view === 'none' || (view === 'list' && rosterKey(snap) !== shownKey)) renderList();
  });
  const offState = net.on('state', (s) => {
    if (!snap && s === 'reconnecting') wrap.querySelector('.lb-status')?.replaceChildren('Connecting…');
  });

  function renderList(notice?: string): void {
    const s = snap!;
    const prevList = wrap.querySelector<HTMLElement>('.lb-list');
    const scroll = view === 'list' && prevList ? prevList.scrollTop : 0;
    view = 'list';
    shownKey = rosterKey(s);
    error = null;
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
        b.addEventListener('click', () => h.onPick(p.id, snap?.epoch ?? s.epoch));
        list.appendChild(b);
      }
    }
    const add = el('button', 'lb-add', "I'm not on the list");
    add.addEventListener('click', () => renderAdd());
    const foot = el('div', 'lb-foot', undefined);
    foot.replaceChildren(add, creditsLink());
    const head: HTMLElement[] = [el('h1', undefined, 'Who are you?')];
    if (notice) {
      const n = el('p', 'lb-error', notice);
      n.setAttribute('role', 'alert');
      head.push(n);
    }
    wrap.replaceChildren(...head, list, foot);
    list.scrollTop = scroll;
  }

  function renderAdd(): void {
    const s = snap!;
    view = 'add';
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
    showError(message) {
      // T9: an addSelf whose welcome was lost to a reconnect already added the name. Re-adding it
      // says it is taken, so show the (re-peeked) list where the name can simply be tapped.
      if (message === NAME_TAKEN && snap) { renderList(`${NAME_TAKEN}. Find your name below and tap it.`); return; }
      if (error) error.textContent = message;
    },
    destroy() { off(); offState(); wrap.remove(); },
  };
}

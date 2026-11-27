// Full-screen HUD layers: the riddle / final-boss modal, the quiz, the leaderboard and the
// "You're up!" / "You escaped!" overlays. Each is one direct child of #lb-hud (so it gets taps)
// and returns a handle; the HUD decides when to open, update and close them.
import type { PublicSnapshot } from '@shared/protocol';
import { add, button, el } from './dom';
import {
  WRONG_TEXT, leaderboardRows, quizCountdown, quizExpired, skipLockText,
  type BossInfo, type QuizInfo, type RiddleInfo,
} from './uiState';

const TICK_MS = 250;

interface Layer { root: HTMLDivElement; box: HTMLDivElement; remove(): void }

function layer(hud: HTMLElement, cls: string, onBackdrop?: () => void): Layer {
  const root = el('div', `lb-layer ${cls}`);
  const box = el('div', 'lb-modal');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  root.appendChild(box);
  if (onBackdrop) root.addEventListener('click', (e) => { if (e.target === root) onBackdrop(); });
  hud.appendChild(root);
  return { root, box, remove: () => root.remove() };
}

function header(title: string, onClose: () => void): HTMLDivElement {
  const h = el('div', 'lb-modal-head');
  add(h, el('h2', '', title), button('lb-x', '✕', onClose, 'Close'));
  return h;
}

// ---------- riddle / final boss ----------

export interface RiddleModal {
  readonly kind: 'riddle' | 'boss';
  /** Re-reads the riddle/boss (a new question clears the field and the inline error). */
  update(): void;
  /** Shows "Not quite, try again!" inline. */
  wrong(): void;
  close(): void;
}

export interface RiddleModalOpts {
  kind: 'riddle' | 'boss';
  get(): RiddleInfo | BossInfo | null;
  now(): number;
  /** True while a submit/skip is in flight: both buttons stay disabled (re-read every tick). */
  pending(): boolean;
  submit(text: string): void;
  skip(): void;
  onClose(): void;
}

export function openRiddleModal(hud: HTMLElement, o: RiddleModalOpts): RiddleModal {
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    l.remove();
    o.onClose();
  };
  const l = layer(hud, 'lb-riddle-layer');
  const isBoss = o.kind === 'boss';
  const intro = el('p', 'lb-intro');
  const q = el('p', 'lb-question');
  const err = el('p', 'lb-inline-err');
  err.setAttribute('role', 'alert');
  const form = el('form', 'lb-answer');
  const input = el('input');
  input.type = 'text';
  input.maxLength = 200;
  input.autocomplete = 'off';
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('autocorrect', 'off');
  input.spellcheck = false;
  input.placeholder = 'Your answer';
  input.setAttribute('aria-label', 'Your answer');
  const submit = el('button', 'lb-primary', 'Submit');
  submit.type = 'submit';
  add(form, input, submit);
  const lock = el('p', 'lb-hint');
  const skip = isBoss ? null : button('lb-secondary', 'Skip', () => o.skip());
  add(l.box, header(isBoss ? 'Final boss' : 'Riddle', close), intro, q, form, err, lock);
  if (skip) l.box.appendChild(skip);
  l.box.classList.toggle('lb-boss', isBoss);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || submit.disabled) return;
    err.textContent = '';
    o.submit(text);
  });

  let shownIndex = -1;
  const render = () => {
    const r = o.get();
    if (!r) { q.textContent = 'Loading…'; form.hidden = true; return; }
    if (r.index !== shownIndex) { shownIndex = r.index; input.value = ''; err.textContent = ''; }
    const boss = isBoss ? (r as BossInfo) : null;
    intro.hidden = !boss?.intro;
    intro.textContent = boss?.intro ?? '';
    if (r.q === null) {
      q.textContent = isBoss ? 'You escaped!' : 'All riddles solved!';
      form.hidden = true;
      lock.hidden = true;
      if (skip) skip.hidden = true;
      return;
    }
    q.textContent = r.q;
    form.hidden = false;
    const locked = isBoss ? null : skipLockText((r as RiddleInfo).lockedUntil, o.now());
    const busy = o.pending();
    submit.disabled = !!locked || busy;
    lock.hidden = !locked;
    lock.textContent = locked ? `Skipped! This riddle unlocks in ${locked}` : '';
    if (skip) {
      skip.hidden = false;
      skip.disabled = !!locked || busy;
      skip.textContent = locked ? `Skip (${locked})` : 'Skip';
    }
  };
  const timer = setInterval(render, TICK_MS); // display only: never sends
  render();
  setTimeout(() => { if (!closed && !form.hidden) input.focus(); }, 50);

  return {
    kind: o.kind,
    update: render,
    wrong() { err.textContent = WRONG_TEXT; input.select(); },
    close,
  };
}

// ---------- quiz ----------

export interface QuizModal { readonly endsAt: number; close(): void }

/** `answer` returns false when the answer could not be sent; the choices then stay open. */
export function openQuizModal(hud: HTMLElement, quiz: QuizInfo, o: { now(): number; answer(choice: number): boolean | void; onClose(): void }): QuizModal {
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    l.remove();
    o.onClose();
  };
  const l = layer(hud, 'lb-quiz-layer');
  const head = el('div', 'lb-modal-head');
  const clock = el('span', 'lb-clock');
  add(head, el('h2', '', 'Quiz!'), clock);
  const q = el('p', 'lb-question', quiz.q);
  const grid = el('div', 'lb-choices');
  const locked = el('p', 'lb-locked', 'Answer locked in');
  locked.hidden = true;
  quiz.choices.forEach((c, i) => {
    grid.appendChild(button('lb-choice', c, () => {
      if (!locked.hidden) return;
      if (o.answer(i) === false) return;
      grid.querySelectorAll('button').forEach((b, j) => { b.disabled = true; b.classList.toggle('lb-picked', j === i); });
      locked.hidden = false;
    }));
  });
  add(l.box, head, q, grid, locked);

  const tick = () => {
    const now = o.now();
    if (quizExpired(quiz.endsAt, now)) { close(); return; }
    clock.textContent = quizCountdown(quiz.endsAt, now);
  };
  const timer = setInterval(tick, TICK_MS); // display only: never sends
  tick();
  return { endsAt: quiz.endsAt, close };
}

// ---------- leaderboard ----------

export interface LeaderboardModal { update(s: PublicSnapshot): void; close(): void }

export function openLeaderboard(hud: HTMLElement, s: PublicSnapshot, onClose: () => void): LeaderboardModal {
  let closed = false;
  const close = () => { if (closed) return; closed = true; l.remove(); onClose(); };
  const l = layer(hud, 'lb-board-layer', close);
  const list = el('ol', 'lb-board');
  add(l.box, header('Leaderboard', close), list);
  const update = (snap: PublicSnapshot) => {
    list.replaceChildren(...leaderboardRows(snap).map((r) => {
      const li = el('li', `lb-board-row lb-row-${r.kind}`);
      li.style.setProperty('--c', r.color);
      li.appendChild(el('span', 'lb-board-name', r.text));
      if (r.kind !== 'departed') li.appendChild(el('span', 'lb-board-score', `★ ${r.score}`));
      return li;
    }));
  };
  update(s);
  return { update, close };
}

// ---------- "You're up!" / "You escaped!" ----------

export interface Announce { setText(text: string): void; close(): void }

export function openAnnounce(hud: HTMLElement, o: { title: string; text: string; color?: string; onClose(): void }): Announce {
  let closed = false;
  const close = () => { if (closed) return; closed = true; l.remove(); o.onClose(); };
  const l = layer(hud, 'lb-announce-layer');
  if (o.color) l.root.style.setProperty('--c', o.color);
  const text = el('p', 'lb-announce-text', o.text);
  text.hidden = !o.text;
  add(l.box, el('h1', 'lb-announce-title', o.title), text, button('lb-primary', 'Close', close));
  return {
    setText(t) { text.textContent = t; text.hidden = !t; },
    close,
  };
}

// The facilitator's console at /host: PIN screen, live status, the big CALL NEXT TEAM button and
// the other host actions, people management, the join QR and the message budget. All rules live
// in hostModel.ts; this file only draws them. Dynamic text always goes through textContent.
import './host.css';
import QRCode from 'qrcode';
import { Net, clockOffset, type ClockSample } from '../net';
import { add, button, el } from '../ui/dom';
import type { HostAction } from '@shared/protocol';
import type { TeamId } from '@shared/types';
import {
  budgetLevel, budgetText, buttonStates, callConfirmText, callTimerState, guardUntil, isLocked, leaderboardRows,
  MODAL_GUARD_MS, nextUpText, sinceLastCall, teamCountText, undoTarget, type ButtonStates, type Guard, type HostState,
} from './hostModel';
import { Heartbeat } from './heartbeat';

const PIN_KEY = 'lobby.hostPin';
/** A reply that never comes (socket died mid-send) must not lock the console for good. */
const PENDING_TIMEOUT_MS = 8000;
/** Hidden this long (phone locked): reconnect on unlock even if the socket still claims to be open. */
const STALE_HIDDEN_MS = 15000;
const LEADER_CHANGED = 'The leader changed, check again';
const LAST_CALL_CHANGED = 'The last call changed, check again';

type Tab = 'run' | 'scores' | 'people' | 'qr';

const root = document.getElementById('host')!;
const net = new Net();

let pin: string | null = readPin();
let hs: HostState | null = null;
let authed = false;
/** The one-shot guard plus its timing (see hostModel isLocked). */
const guard: Guard = { pending: false, connected: false, lastReplyAt: null, modalChangedAt: null };
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let unlockTimer: ReturnType<typeof setTimeout> | null = null;
const locked = () => isLocked(guard, Date.now());
let tab: Tab = 'run';
const samples: ClockSample[] = [];
let offset = 0;

function readPin(): string | null {
  try { return sessionStorage.getItem(PIN_KEY); } catch { return null; }
}
function writePin(v: string | null): void {
  try { if (v === null) sessionStorage.removeItem(PIN_KEY); else sessionStorage.setItem(PIN_KEY, v); } catch { /* private mode */ }
}
const serverNow = () => Date.now() + offset;

// ---------- toasts and modals ----------

const toasts = el('div', 'h-toasts');
toasts.setAttribute('aria-live', 'polite');
document.body.appendChild(toasts);

function toast(text: string, kind: 'error' | 'info' = 'error'): void {
  const t = el('div', `h-toast h-toast-${kind}`, text);
  t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  toasts.appendChild(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3000);
}

/** Re-render when the timing lock ends, so buttons come back without waiting for the next hostState. */
function scheduleUnlock(): void {
  const wait = guardUntil(guard) - Date.now();
  if (wait <= 0) return;
  if (unlockTimer !== null) clearTimeout(unlockTimer);
  unlockTimer = setTimeout(() => { unlockTimer = null; render(); }, wait + 10);
}

let modal: HTMLElement | null = null;
function modalChanged(): void {
  guard.modalChangedAt = Date.now();
  render();
  scheduleUnlock();
}
function closeModal(): void {
  if (!modal) return;
  modal.remove();
  modal = null;
  modalChanged();
}

interface ConfirmOpts {
  text: string;
  ok: string;
  danger?: boolean;
  /** Require this word typed before OK is enabled (case-insensitive). */
  typeWord?: string;
  onOk(): void;
}
function confirmBox(o: ConfirmOpts): void {
  closeModal();
  const back = el('div', 'h-modal');
  back.setAttribute('role', 'dialog');
  back.setAttribute('aria-modal', 'true');
  const box = el('div', 'h-modal-box');
  const msg = el('p', 'h-modal-text', o.text);
  msg.id = 'h-confirm-text';
  back.setAttribute('aria-labelledby', msg.id);
  const openedAt = Date.now();
  let typed = !o.typeWord;
  const okB = button(`h-btn ${o.danger ? 'h-danger' : 'h-go'}`, o.ok, () => {
    if (okB.disabled || Date.now() - openedAt < MODAL_GUARD_MS) return;
    // Send first, then close: closing starts the after-modal tap guard, which must not block this send.
    const mine = modal;
    o.onOk();
    if (modal === mine) closeModal();
  });
  // The tap that opened this dialog must not land on OK: OK wakes up after MODAL_GUARD_MS.
  okB.disabled = true;
  setTimeout(() => { okB.disabled = !typed; }, MODAL_GUARD_MS);
  const cancel = button('h-btn h-plain', 'Cancel', closeModal);
  add(box, msg);
  if (o.typeWord) {
    const word = o.typeWord;
    const input = el('input', 'h-input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.setAttribute('autocapitalize', 'characters');
    input.setAttribute('aria-label', `Type ${word} to confirm`);
    input.placeholder = `Type ${word}`;
    input.addEventListener('input', () => {
      typed = input.value.trim().toUpperCase() === word;
      okB.disabled = !typed || Date.now() - openedAt < MODAL_GUARD_MS;
    });
    add(box, el('p', 'h-hint', `Type ${word} to confirm.`), input);
    setTimeout(() => input.focus(), 0);
  }
  add(box, add(el('div', 'h-modal-actions'), cancel, okB));
  back.addEventListener('click', (e) => { if (e.target === back) closeModal(); });
  back.appendChild(box);
  document.body.appendChild(back);
  modal = back;
  modalChanged();
}

// ---------- sending (one-shot guard) ----------

function clearPending(): void {
  guard.pending = false;
  if (pendingTimer !== null) { clearTimeout(pendingTimer); pendingTimer = null; }
}

/** The answer to our send arrived: unlock after the reply cooldown (a double tap's second half is swallowed). */
function replied(): void {
  if (guard.pending) guard.lastReplyAt = Date.now();
  clearPending();
  scheduleUnlock();
}

/** A fresh socket and hostHello (Net drops the old one). */
function rehello(): void {
  if (pin) net.connect({ t: 'hostHello', pin });
}

/**
 * Sends one host action. Every host button is disabled until the next hostState or error, then
 * for the reply cooldown; taps while locked are ignored.
 */
function send(a: HostAction): void {
  if (!guard.connected) { toast('Not connected right now, try again in a moment'); return; }
  if (locked()) return;
  if (!net.host(a)) { toast('Not connected right now, try again in a moment'); return; }
  guard.pending = true;
  pendingTimer = setTimeout(() => {
    clearPending();
    toast('No reply from the server — reconnecting…');
    rehello();
    render();
  }, PENDING_TIMEOUT_MS);
  render();
}

// ---------- PIN screen ----------

function showPin(error?: string): void {
  authed = false;
  closeModal();
  const wrap = el('div', 'h-pin');
  const input = el('input', 'h-input h-pin-input');
  input.type = 'password';
  input.inputMode = 'numeric';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Host PIN');
  input.placeholder = 'PIN';
  const err = el('p', 'h-error', error ?? '');
  err.setAttribute('role', 'alert');
  const go = button('h-btn h-go', 'Enter', () => {
    const v = input.value.trim();
    if (!v) { err.textContent = 'Type the host PIN'; return; }
    pin = v;
    writePin(v);
    err.textContent = '';
    go.disabled = true;
    go.textContent = 'Connecting…';
    net.connect({ t: 'hostHello', pin: v });
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
  add(wrap, el('h1', '', 'Team Lobby host'), el('p', 'h-hint', 'Enter the host PIN to run the event.'), input, err, go);
  root.replaceChildren(wrap);
  setTimeout(() => input.focus(), 0);
}

// ---------- console ----------

const view = {
  phase: el('span', 'h-pill'),
  conn: el('span', 'h-conn'),
  tabs: new Map<Tab, HTMLButtonElement>(),
  panels: new Map<Tab, HTMLElement>(),
  timer: el('div', 'h-timer'),
  timerValue: el('div', 'h-timer-value', '—'),
  timerHint: el('div', 'h-timer-hint'),
  nextUp: el('div', 'h-next'),
  call: null as HTMLButtonElement | null,
  callHint: el('p', 'h-hint h-call-hint'),
  start: null as HTMLButtonElement | null,
  quiz: null as HTMLButtonElement | null,
  pause: null as HTMLButtonElement | null,
  resume: null as HTMLButtonElement | null,
  undo: null as HTMLButtonElement | null,
  board: el('ol', 'h-board'),
  scores: el('div', 'h-scores'),
  reset: null as HTMLButtonElement | null,
  people: el('div', 'h-people'),
  peopleSig: '',
  footer: el('footer', 'h-footer'),
  built: false,
};

function buildConsole(): void {
  const shell = el('div', 'h-shell');
  const head = add(el('header', 'h-head'), el('h1', '', 'Team Lobby host'), view.phase, view.conn);
  const nav = el('nav', 'h-tabs');
  nav.setAttribute('role', 'tablist');
  const labels: [Tab, string][] = [['run', 'Run'], ['scores', 'Scores'], ['people', 'People'], ['qr', 'QR']];
  for (const [id, label] of labels) {
    const b = button('h-tab', label, () => { tab = id; render(); });
    b.setAttribute('role', 'tab');
    view.tabs.set(id, b);
    nav.appendChild(b);
  }
  const main = el('main', 'h-main');
  view.panels.set('run', buildRun());
  view.panels.set('scores', buildScores());
  view.panels.set('people', add(el('section', 'h-panel'), el('h2', '', 'People'), view.people));
  view.panels.set('qr', buildQr());
  for (const p of view.panels.values()) main.appendChild(p);
  add(shell, head, nav, main, view.footer);
  root.replaceChildren(shell);
  view.built = true;
}

function buildRun(): HTMLElement {
  const p = el('section', 'h-panel h-run');
  view.timer.replaceChildren(el('div', 'h-timer-label', 'Time since last call'), view.timerValue, view.timerHint);
  view.call = button('h-call', 'CALL NEXT TEAM', () => {
    const s = buttonStates(hs, locked());
    const nl = hs?.nextLeader;
    if (!s.callNext || !nl) return;
    // The leader is fixed when the confirm opens; the server rejects it if it changed since.
    const expected = { id: nl.id, name: nl.name, score: nl.score };
    confirmBox({ text: callConfirmText(expected), ok: 'Yes, call them', onOk: () => send({ type: 'host.callNext', expectedTeamId: expected.id }) });
  });
  view.start = button('h-btn h-go', 'START COMPETITION', () => {
    if (!buttonStates(hs, locked()).start || !hs) return;
    const first = Object.values(hs.snapshot.teams).find((t) => t.goesFirst);
    const who = first ? `TEAM ${first.name.toUpperCase()} goes first and is sent out straight away.` : 'No team is set to go first.';
    confirmBox({ text: `Start the competition? ${who}`, ok: 'Start', onOk: () => send({ type: 'host.startCompetition' }) });
  });
  view.quiz = button('h-btn', 'QUICK-FIRE QUIZ', () => { if (buttonStates(hs, locked()).quiz) send({ type: 'host.quizStart' }); });
  view.pause = button('h-btn', 'Pause', () => { if (buttonStates(hs, locked()).pause) send({ type: 'host.pause' }); });
  view.resume = button('h-btn h-go', 'Resume', () => { if (buttonStates(hs, locked()).resume) send({ type: 'host.resume' }); });
  view.undo = button('h-btn', 'Undo last call', () => {
    if (!buttonStates(hs, locked()).undo || !hs) return;
    const t = undoTarget(hs.snapshot);
    if (!t) return;
    // R26: the team is fixed when the confirm opens; the server refuses if the last call changed.
    const expectedTeamId = t.id;
    confirmBox({ text: `Bring TEAM ${t.name.toUpperCase()} back into the game?`, ok: 'Bring them back', onOk: () => send({ type: 'host.undoCall', expectedTeamId }) });
  });
  const grid = add(el('div', 'h-grid'), view.start, view.quiz, view.pause, view.resume, view.undo);
  add(p, view.timer, view.nextUp, view.call, view.callHint, grid, el('h2', '', 'Leaderboard'), view.board);
  return p;
}

function buildScores(): HTMLElement {
  const p = el('section', 'h-panel');
  view.reset = button('h-btn h-danger', 'Reset event', () => {
    if (!buttonStates(hs, locked()).reset) return;
    confirmBox({
      text: 'Reset the whole event? Scores, calls and people added today are all cleared, and everyone goes back to the start.',
      ok: 'Continue', danger: true,
      onOk: () => confirmBox({
        text: 'Are you sure? This cannot be undone.', ok: 'Reset event', danger: true, typeWord: 'RESET',
        onOk: () => send({ type: 'host.reset' }),
      }),
    });
  });
  add(p, el('h2', '', 'Adjust scores'), view.scores, el('h2', 'h-danger-head', 'Danger zone'), view.reset);
  return p;
}

let qrUrl = '';
function joinUrl(): string { return `${location.origin}/`; }
function qrImg(cls: string): HTMLImageElement {
  const img = el('img', cls);
  img.alt = `QR code for ${joinUrl()}`;
  img.src = qrUrl;
  return img;
}

function buildQr(): HTMLElement {
  const p = el('section', 'h-panel h-qr');
  const holder = el('div', 'h-qr-holder');
  const url = el('p', 'h-qr-url', joinUrl());
  const full = button('h-btn h-go', 'Show QR full-screen', showQrFull);
  add(p, el('h2', '', 'Join the lobby'), holder, url, full);
  void QRCode.toDataURL(joinUrl(), { width: 1024, margin: 2, errorCorrectionLevel: 'M' }).then((d) => {
    qrUrl = d;
    holder.replaceChildren(qrImg('h-qr-img'));
  }).catch(() => holder.replaceChildren(el('p', 'h-error', 'Could not draw the QR code')));
  return p;
}

function showQrFull(): void {
  closeModal();
  const back = el('div', 'h-qr-full');
  back.setAttribute('role', 'dialog');
  const close = button('h-btn h-plain h-qr-close', 'Close', closeModal);
  add(back, qrUrl ? qrImg('h-qr-full-img') : el('p', '', 'Loading…'), el('p', 'h-qr-full-url', joinUrl()), close);
  back.addEventListener('click', (e) => { if (e.target !== close) closeModal(); });
  document.body.appendChild(back);
  modal = back;
}

// ---------- rendering ----------

function render(): void {
  if (!authed || !hs) return;
  if (!view.built) buildConsole();
  const s = hs.snapshot;
  const b = buttonStates(hs, locked());

  view.phase.textContent = s.paused ? 'PAUSED' : s.phase === 'warmup' ? 'WARM-UP' : 'COMPETITION';
  view.phase.className = `h-pill ${s.paused ? 'h-pill-paused' : s.phase === 'warmup' ? 'h-pill-warm' : 'h-pill-live'}`;
  for (const [id, t] of view.tabs) {
    t.setAttribute('aria-selected', String(id === tab));
    view.panels.get(id)!.hidden = id !== tab;
  }

  renderRun(b);
  renderScores(b);
  renderPeople(b);
  const lvl = budgetLevel(hs.msgCount);
  view.footer.textContent = budgetText(hs.msgCount);
  view.footer.classList.toggle('h-red', lvl === 'red');
  tickTimer();
}

function setBtn(btn: HTMLButtonElement | null, enabled: boolean): void { if (btn) btn.disabled = !enabled; }

function renderRun(b: ButtonStates): void {
  const s = hs!.snapshot;
  view.nextUp.textContent = nextUpText(hs!.nextLeader);
  setBtn(view.call, b.callNext);
  view.callHint.textContent = s.phase === 'warmup' ? 'Press START COMPETITION first.'
    : s.paused ? 'Paused: resume to call the next team.'
    : !hs!.nextLeader ? 'Every team has been called.'
    : guard.pending ? 'Sending…' : '';
  setBtn(view.start, b.start);
  setBtn(view.quiz, b.quiz);
  view.quiz!.textContent = s.quizActive ? 'QUIZ RUNNING…' : 'QUICK-FIRE QUIZ';
  view.pause!.hidden = !b.showPause;
  view.resume!.hidden = b.showPause;
  setBtn(view.pause, b.pause);
  setBtn(view.resume, b.resume);
  setBtn(view.undo, b.undo);
  view.undo!.textContent = b.undoLabel;

  const rows = leaderboardRows(hs!);
  view.board.replaceChildren(...rows.map((r) => {
    const li = el('li', `h-row h-row-${r.kind}`);
    li.style.setProperty('--c', r.color);
    li.dataset.team = r.teamId;
    const name = el('span', 'h-row-name', r.kind === 'playing' ? `${r.rank}. ${r.label}` : r.label);
    const score = el('span', 'h-row-score', r.kind === 'playing' ? `${r.score} pts` : '');
    const count = el('span', 'h-row-count', r.count);
    count.title = 'Connected now / on the team';
    add(li, name, score, count);
    return li;
  }));
}

interface ScoreRow { count: HTMLElement; score: HTMLElement; btns: HTMLButtonElement[] }
/** Built once per team and updated in place, so a tap never lands on a button that was just replaced. */
const scoreRows = new Map<TeamId, ScoreRow>();

function renderScores(b: ButtonStates): void {
  const s = hs!.snapshot;
  const key = s.teamOrder.join('|');
  if (view.scores.dataset.key !== key) {
    view.scores.dataset.key = key;
    scoreRows.clear();
    const kids: HTMLElement[] = [];
    for (const id of s.teamOrder) {
      const t = s.teams[id];
      if (!t) continue;
      const row = el('div', 'h-adj');
      row.style.setProperty('--c', t.color);
      const r: ScoreRow = { count: el('span'), score: el('strong'), btns: [] };
      const btns = el('div', 'h-adj-btns');
      for (const d of [-10, -5, 5, 10]) {
        const bt = button('h-btn h-small', d > 0 ? `+${d}` : `−${-d}`, () => {
          if (buttonStates(hs, locked()).adjust) send({ type: 'host.adjustScore', teamId: id, delta: d });
        }, `${d > 0 ? 'Add' : 'Take'} ${Math.abs(d)} points ${d > 0 ? 'to' : 'from'} ${t.name}`);
        r.btns.push(bt);
        btns.appendChild(bt);
      }
      add(row, add(el('div', 'h-adj-name'), r.count, r.score), btns);
      scoreRows.set(id, r);
      kids.push(row);
    }
    view.scores.replaceChildren(...kids);
  }
  for (const [id, r] of scoreRows) {
    const t = s.teams[id];
    if (!t) continue;
    r.count.textContent = teamCountText(t.name, hs!.connectedPerTeam[id]);
    r.score.textContent = `${t.score} pts`;
    for (const bt of r.btns) bt.disabled = !b.adjust;
  }
  setBtn(view.reset, b.reset);
}

function setPeopleDisabled(off: boolean): void {
  // Plain casts: the workers types shadow HTMLSelectElement's DOM shape in querySelectorAll generics.
  for (const c of view.people.querySelectorAll('button,select')) (c as HTMLButtonElement).disabled = off;
}

function renderPeople(b: ButtonStates): void {
  const s = hs!.snapshot;
  const tabBtn = view.tabs.get('people')!;
  tabBtn.classList.toggle('h-tab-off', s.phase !== 'warmup');
  // A select the facilitator is using must not be rebuilt under their finger.
  if (view.people.contains(document.activeElement) && document.activeElement instanceof HTMLSelectElement) return;
  const players = Object.values(s.players).filter((p) => !p.removed);
  const sig = JSON.stringify([s.phase, b.people, s.teamOrder.map((id) => [id, s.teams[id]?.goesFirst]),
    players.map((p) => [p.id, p.name, p.teamId, !!s.online[p.id]])]);
  if (sig === view.peopleSig) {
    setPeopleDisabled(!b.people);
    return;
  }
  view.peopleSig = sig;
  if (s.phase !== 'warmup') {
    view.people.replaceChildren(el('p', 'h-hint', 'People can only be moved or removed before the competition starts.'));
    return;
  }
  const teamOptions = (sel: HTMLSelectElement, current: TeamId | null, placeholder: string | null) => {
    if (placeholder) {
      const o = el('option', '', placeholder);
      o.value = '';
      o.selected = true;
      o.disabled = true;
      sel.appendChild(o);
    }
    for (const id of s.teamOrder) {
      const t = s.teams[id];
      if (!t || (placeholder && id === current)) continue;
      const o = el('option', '', t.name);
      o.value = id;
      if (!placeholder && id === current) o.selected = true;
      sel.appendChild(o);
    }
  };

  const first = el('label', 'h-first');
  const firstSel = el('select', 'h-select');
  firstSel.setAttribute('aria-label', 'Goes first');
  teamOptions(firstSel, Object.values(s.teams).find((t) => t.goesFirst)?.id ?? null, null);
  firstSel.addEventListener('change', () => { send({ type: 'host.setGoesFirst', teamId: firstSel.value }); firstSel.blur(); });
  add(first, el('span', '', 'Goes first'), firstSel);
  const kids: HTMLElement[] = [first];

  for (const id of s.teamOrder) {
    const t = s.teams[id];
    if (!t) continue;
    const mine = players.filter((p) => p.teamId === id).sort((a, c) => a.name.localeCompare(c.name));
    const online = mine.filter((p) => s.online[p.id]).length;
    const head = el('h3', 'h-team-head', `${t.name} ${online}/${mine.length}`);
    head.style.setProperty('--c', t.color);
    kids.push(head);
    for (const p of mine) {
      const row = el('div', 'h-person');
      const name = el('span', `h-person-name ${s.online[p.id] ? 'h-on' : ''}`, p.name);
      const sel = el('select', 'h-select');
      sel.setAttribute('aria-label', `Move ${p.name} to another team`);
      teamOptions(sel, id, 'Move to…');
      sel.addEventListener('change', () => {
        const to = sel.value;
        sel.blur();
        if (to) send({ type: 'host.movePlayer', playerId: p.id, teamId: to });
      });
      const rm = button('h-btn h-small h-danger-outline', 'Remove', () => {
        confirmBox({ text: `Remove ${p.name} from the event?`, ok: 'Remove', danger: true, onOk: () => send({ type: 'host.removePlayer', playerId: p.id }) });
      }, `Remove ${p.name}`);
      add(row, name, sel, rm);
      kids.push(row);
    }
  }
  view.people.replaceChildren(...kids);
  setPeopleDisabled(!b.people);
}

function tickTimer(): void {
  if (!hs || !view.built) return;
  const s = hs.snapshot;
  const last = s.phase === 'competition' ? hs.lastCallAt : null;
  const now = serverNow();
  const state = callTimerState(last, now);
  view.timerValue.textContent = sinceLastCall(last, now);
  view.timer.className = `h-timer h-timer-${state}`;
  view.timerHint.textContent = last === null ? 'Starts when the competition starts'
    : state === 'green' ? 'Time to call the next team' : state === 'amber' ? 'Get ready to call' : '';
}
setInterval(tickTimer, 500);

function renderConn(): void {
  const st = net.state;
  view.conn.textContent = st === 'open' ? '● Live' : st === 'closed' ? '● Offline' : '● Reconnecting…';
  view.conn.className = `h-conn ${st === 'open' ? 'h-conn-ok' : 'h-conn-bad'}`;
}

// ---------- network ----------

net.on('hostState', (m) => {
  hs = m;
  samples.push({ sent: Date.now(), server: m.snapshot.serverNow, received: Date.now() });
  if (samples.length > 5) samples.shift();
  offset = clockOffset(samples);
  replied();
  if (!authed) { authed = true; view.built = false; }
  render();
  renderConn();
});

net.on('error', (m) => {
  replied();
  if (m.message === LEADER_CHANGED || m.message === LAST_CALL_CHANGED) closeModal();
  toast(m.message);
  render();
});

net.on('close', ({ code }) => {
  clearPending();
  if (code === 4001) {
    writePin(null);
    pin = null;
    hs = null;
    view.built = false;
    showPin('Wrong PIN');
  }
});

// While visible and open, a raw ping every 15 s must be answered within 5 s, or we re-hello. This
// catches a socket that looks open but is dead, which no close event would ever report.
const heartbeat = new Heartbeat(() => net.ping(), () => {
  toast('Reconnecting…', 'info');
  rehello();
  renderConn();
});
net.on('pong', () => heartbeat.pong());
function syncHeartbeat(): void {
  if (net.state === 'open' && document.visibilityState === 'visible') heartbeat.start();
  else heartbeat.stop();
}

net.on('state', () => {
  guard.connected = net.state === 'open';
  syncHeartbeat();
  if (net.state !== 'open') clearPending();
  if (view.built) { renderConn(); render(); }
});

// Unlocking a phone after a long lock: the socket may look open but be dead. Net already reconnects
// at once when it knows the socket is down; this covers the "looks open" case with a fresh hello.
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  syncHeartbeat();
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
  const away = Date.now() - hiddenAt;
  setTimeout(() => {
    if (pin && authed && net.state === 'open' && hiddenAt > 0 && away >= STALE_HIDDEN_MS) net.connect({ t: 'hostHello', pin });
  }, 0);
});

if (pin) {
  root.replaceChildren(el('p', 'h-center', 'Connecting…'));
  net.connect({ t: 'hostHello', pin });
} else {
  showPin();
}

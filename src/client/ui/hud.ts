// In-room DOM layer over the canvas: corner buttons, the Riddle / Final boss button, the proximity
// sheet, the icebreaker card, and the wiring from server messages to modals, banners and scene
// effects. Pure rules live in uiState.ts; this file only reads them and touches the DOM.
// Intents only: every net.act below runs from a user's tap or submit, never from a timer.
import type { Net } from '../net';
import type { Me } from '../identity';
import type { RoomApi } from '../room/RoomScene';
import type { IcebreakerCard, PublicSnapshot } from '@shared/protocol';
import type { PlayerId } from '@shared/types';
import { EMOTES } from '@shared/constants';
import { upBanner } from '@shared/game/calls';
import { openAvatarBuilder } from '../join/avatarBuilder';
import type { UiStore } from './store';
import { add, button, el } from './dom';
import { createBanners } from './banners';
import { confetti } from './confetti';
import {
  openAnnounce, openLeaderboard, openQuizModal, openRiddleModal,
  type Announce, type LeaderboardModal, type QuizModal, type RiddleModal,
} from './modals';
import {
  EMOTE_EMOJI, PAUSED_TEXT, PENDING_MS, PendingGuard, WRONG_TEXT, canIcebreak, cardView, celebrateView,
  closedToast, quizKey, quizResultText, quizStillOpen, quizToShow, sheetTarget, tableButton, teamOf,
} from './uiState';

const EMOTE_LABEL: Record<string, string> = { wave: 'Wave', highfive: 'High-five', laugh: 'Laugh', heart: 'Heart' };
/** Client-side spam guard for emote taps (message budget). */
const EMOTE_COOLDOWN_MS = 900;
/** R28 nudge when the rolling act cap refuses a tap (at most one toast per SLOW_TOAST_MS). */
export const SLOW_DOWN_TEXT = 'Whoa, slow down a little! 🙂';
const SLOW_TOAST_MS = 3000;
/** Guard keys: one in-flight send each, cleared by the matching reply (or any error), else after PENDING_MS. */
const CARD = 'card', RIDDLE = 'riddle', START_IB = 'icebreakerStart';
const QUIET_ERRORS = new Set(['unknown player']);

export interface RoomUi { destroy(): void }

export function mountRoomUi(net: Net, me: Me, room: RoomApi, store: UiStore, initial: PublicSnapshot): RoomUi {
  const hud = document.getElementById('lb-hud')!;
  const myId = me.playerId;
  let snap = store.snap ?? initial;
  let near: PlayerId[] = [];
  /** The open icebreaker card I am part of, tracked by id. */
  let card: IcebreakerCard | null = null;
  let nearOwn = false;
  const banners = createBanners(hud);
  const guard = new PendingGuard();
  const wallNow = () => performance.now();

  const nameOf = (id: PlayerId) => snap.players[id]?.name ?? 'Someone';
  const unsubs: (() => void)[] = [];
  const on: Net['on'] = (type, fn) => { const u = net.on(type, fn); unsubs.push(u); return u; };

  // ---------- corner buttons ----------

  let zoomed = false;
  const zoomBtn = button('lb-corner lb-corner-tl', '🗺️', () => {
    zoomed = !zoomed;
    room.setZoomedOut(zoomed);
    zoomBtn.setAttribute('aria-pressed', String(zoomed));
    zoomBtn.textContent = zoomed ? '🎯' : '🗺️';
    zoomBtn.title = zoomed ? 'Back to me' : 'See the whole room';
  }, 'See the whole room');
  zoomBtn.setAttribute('aria-pressed', 'false');

  let board: LeaderboardModal | null = null;
  const boardBtn = button('lb-corner lb-corner-tr', '🏆', () => {
    if (board) return;
    board = openLeaderboard(hud, snap, () => { board = null; });
  }, 'Leaderboard');

  const lookBtn = button('lb-corner lb-corner-tr2', '👕', () => {
    openAvatarBuilder(snap.players[myId]?.look ?? null, (look) => { net.act({ type: 'setLook', look }); });
  }, 'Edit avatar');
  add(hud, zoomBtn, boardBtn, lookBtn);

  // ---------- Riddle / Final boss ----------

  let riddle: RiddleModal | null = null;
  const tableBtn = button('lb-table-btn', '', () => {
    const kind = tableButton(snap, myId, nearOwn, store.boss());
    if (!kind || riddle) return;
    riddle = openRiddleModal(hud, {
      kind,
      get: () => (kind === 'boss' ? store.boss() : store.riddle()),
      now: () => net.serverNow(),
      pending: () => guard.pending(RIDDLE, wallNow()),
      submit: (text) => {
        if (!guard.begin(RIDDLE, wallNow())) return;
        net.act(kind === 'boss' ? { type: 'bossAnswer', text } : { type: 'riddleAnswer', text });
        riddle?.update();
      },
      skip: () => {
        if (!guard.begin(RIDDLE, wallNow())) return;
        net.act({ type: 'riddleSkip' });
        riddle?.update();
      },
      onClose: () => { riddle = null; },
    });
  });
  tableBtn.hidden = true;
  hud.appendChild(tableBtn);

  const renderTable = () => {
    const kind = tableButton(snap, myId, nearOwn, store.boss());
    tableBtn.hidden = !kind;
    tableBtn.textContent = kind === 'boss' ? '💀 Final boss' : '🧩 Riddle';
    tableBtn.classList.toggle('lb-boss', kind === 'boss');
    // An open modal closes if it no longer applies (paused, team left, boss started or beaten).
    // Proximity alone does not close it: the field keeps what was typed.
    if (riddle && tableButton(snap, myId, true, store.boss()) !== riddle.kind) riddle.close();
  };

  // ---------- proximity sheet ----------

  const sheet = el('div', 'lb-sheet');
  sheet.hidden = true;
  hud.appendChild(sheet);
  let pinned: PlayerId | null = null;
  let expanded = false;
  let emoteAt = 0;

  const chip = button('lb-chip', '', () => { expanded = true; pinned = sheetTarget(near, pinned); renderSheet(); });
  const head = el('div', 'lb-sheet-head');
  const who = el('div', 'lb-who');
  const whoName = el('strong', 'lb-who-name');
  const whoTeam = el('span', 'lb-who-team');
  add(who, whoName, whoTeam);
  add(head, who, button('lb-x', '▾', () => { expanded = false; pinned = null; renderSheet(); }, 'Collapse'));
  const emotes = el('div', 'lb-emotes');
  for (const kind of EMOTES) {
    emotes.appendChild(button('lb-emote', EMOTE_EMOJI[kind]!, () => {
      const target = sheetTarget(near, pinned);
      const now = performance.now();
      if (!target || now - emoteAt < EMOTE_COOLDOWN_MS) return;
      emoteAt = now;
      net.act(kind === 'highfive' ? { type: 'emote', kind, target } : { type: 'emote', kind });
    }, EMOTE_LABEL[kind]));
  }
  const ibBtn = button('lb-primary lb-ib-btn', '🧊 Icebreaker', () => {
    const target = sheetTarget(near, pinned);
    if (!target || !guard.begin(START_IB, wallNow())) return;
    net.act({ type: 'icebreakerStart', target });
  });
  const body = el('div', 'lb-sheet-body');
  add(body, head, emotes, ibBtn);
  add(sheet, chip, body);

  const renderSheet = () => {
    // The icebreaker card takes the sheet's place while open (the sheet keeps its state).
    const target = card ? null : sheetTarget(near, pinned);
    if (!target) { sheet.hidden = true; hud.classList.remove('lb-sheet-open'); return; }
    sheet.hidden = false;
    const p = snap.players[target];
    const t = p ? snap.teams[p.teamId] : undefined;
    const color = t?.color ?? '#888';
    sheet.style.setProperty('--c', color);
    chip.hidden = expanded;
    body.hidden = !expanded;
    chip.replaceChildren(el('i', 'lb-dot'), el('span', '', p?.name ?? 'Someone'), el('span', 'lb-chip-hint', expanded ? '' : '· say hi'));
    whoName.textContent = p?.name ?? 'Someone';
    whoTeam.textContent = t ? `Team ${t.name}` : '';
    ibBtn.hidden = !canIcebreak(snap, myId, target);
    hud.classList.toggle('lb-sheet-open', expanded);
  };

  // ---------- icebreaker card ----------

  const cardEl = el('div', 'lb-card');
  cardEl.hidden = true;
  hud.appendChild(cardEl);

  const renderCard = () => {
    const v = cardView(card, myId, nameOf);
    cardEl.hidden = !v;
    hud.classList.toggle('lb-card-open', !!v);
    if (!v) { renderSheet(); return; }
    const id = v.id;
    // One send per card step: the buttons stay disabled until the next `icebreaker` (or an error),
    // with a re-render after the safety timeout in case no reply comes.
    const busy = guard.pending(CARD, wallNow());
    const send = (a: Parameters<Net['act']>[0]) => {
      if (!guard.begin(CARD, wallNow())) return;
      net.act(a);
      renderCard();
      setTimeout(renderCard, PENDING_MS + 50); // display only
    };
    const actions = el('div', 'lb-card-actions');
    const btns: HTMLButtonElement[] = [];
    if (v.mode === 'answer') btns.push(button('lb-primary', 'We answered it!', () => send({ type: 'icebreakerAnswered', id })));
    else if (v.mode === 'confirm') btns.push(button('lb-primary', 'Confirm', () => send({ type: 'icebreakerConfirm', id })));
    else actions.appendChild(el('p', 'lb-waiting', v.waitingText));
    btns.push(button('lb-secondary', 'Cancel', () => send({ type: 'icebreakerCancel', id })));
    for (const b of btns) { b.disabled = busy; actions.appendChild(b); }
    const sub = v.mode === 'confirm' ? `${v.otherName} says you answered it. Confirm?` : 'Both of you answer, out loud:';
    cardEl.replaceChildren(
      el('div', 'lb-card-title', `🧊 Icebreaker with ${v.otherName}`),
      el('p', 'lb-hint', sub),
      el('p', 'lb-card-prompt', v.prompt),
      actions,
    );
    renderSheet();
  };

  // ---------- quiz ----------

  let quiz: QuizModal | null = null;
  const openQuiz = (q: { q: string; choices: string[]; endsAt: number }) => {
    if (quiz?.endsAt === q.endsAt) return;
    quiz?.close();
    quiz = openQuizModal(hud, q, {
      now: () => net.serverNow(),
      // Not locked in unless it was really sent (offline, or over the R28 cap: try again).
      answer: (choice) => {
        if (!net.act({ type: 'quizAnswer', choice })) return false;
        store.answered.add(quizKey(q));
        return true;
      },
      onClose: () => { quiz = null; },
    });
  };
  const maybeQuizFromSnap = () => {
    const q = quizToShow(snap, myId, store.answered, net.serverNow());
    if (q) openQuiz(q);
  };

  // ---------- announcements ----------

  let announce: Announce | null = null;
  const announceOpen = (title: string, text: string, color?: string) => {
    announce?.close();
    announce = openAnnounce(hud, { title, text, ...(color ? { color } : {}), onClose: () => { announce = null; } });
  };

  // ---------- wiring ----------

  const applySnap = (s: PublicSnapshot) => {
    snap = s;
    if (!s.paused && banners.sticky === PAUSED_TEXT) banners.setSticky(null);
    if (s.paused && !banners.sticky) banners.setSticky(PAUSED_TEXT);
    renderTable();
    renderSheet();
    board?.update(s);
    // My team left, or the quiz ended or changed: an open quiz modal goes (answered or not).
    if (quiz && !quizStillOpen(s, myId, quiz.endsAt, net.serverNow())) quiz.close();
    maybeQuizFromSnap();
  };

  unsubs.push(room.onNearChange((others, own) => {
    near = others;
    nearOwn = own;
    if (pinned && !near.includes(pinned)) pinned = null;
    if (near.length === 0) expanded = false;
    renderSheet();
    renderTable();
  }));
  unsubs.push(room.onTapAvatar((id) => {
    if (!near.includes(id)) { banners.toast(`Walk closer to ${nameOf(id)}`); return; }
    pinned = id;
    expanded = true;
    renderSheet();
  }));

  on('snapshot', (m) => applySnap(m.snapshot));
  on('welcome', (m) => {
    // Reconnected: the server dropped any open card when I went offline.
    card = null;
    renderCard();
    applySnap(m.snapshot);
  });
  on('error', (m) => {
    // Errors are not tied to a request: free every pending send so the player can retry.
    guard.clear(CARD); guard.clear(RIDDLE); guard.clear(START_IB);
    riddle?.update();
    if (cardEl.hidden === false) renderCard();
    if (QUIET_ERRORS.has(m.message)) return;
    if (riddle && m.message === WRONG_TEXT) { riddle.wrong(); return; }
    banners.toast(m.message);
  });
  // R28: Net refused an act over the rolling cap and sent nothing. Moves just wait (they coalesce),
  // a released key's stop is never refused; anything else gets a gentle nudge and its buttons back.
  let slowToastAt = -Infinity;
  on('throttled', (m) => {
    if (m.type === 'move' || m.type === 'stop') return;
    guard.clear(CARD); guard.clear(RIDDLE); guard.clear(START_IB);
    riddle?.update();
    if (cardEl.hidden === false) renderCard();
    const now = performance.now();
    if (now - slowToastAt < SLOW_TOAST_MS) return;
    slowToastAt = now;
    banners.toast(SLOW_DOWN_TEXT);
  });
  on('icebreaker', (m) => {
    guard.clear(CARD);
    guard.clear(START_IB);
    if (m.card) {
      if (m.card.a !== myId && m.card.b !== myId) return;
      card = m.card;
    } else if (card) {
      const other = card.a === myId ? card.b : card.a;
      const t = closedToast(m.closedReason, nameOf(other));
      if (t) banners.toast(t);
      card = null;
      expanded = false; // back to the small chip, so the floor is free to walk again
      pinned = null;
    }
    renderCard();
  });
  on('riddle', () => { guard.clear(RIDDLE); riddle?.update(); renderTable(); });
  on('boss', () => { guard.clear(RIDDLE); riddle?.update(); renderTable(); });
  on('quiz', (m) => {
    if (snap.teams[teamOf(snap, myId) ?? '']?.status !== 'playing') return;
    if (store.answered.has(quizKey(m))) return; // same rule as the snapshot path
    openQuiz({ q: m.q, choices: m.choices, endsAt: m.endsAt });
  });
  on('quizResult', (m) => {
    quiz?.close();
    const t = quizResultText(store.quiz?.choices ?? null, m.correct);
    if (t) banners.toast(t, 3000);
  });
  on('float', (m) => room.effects.float(m.teamId, m.text));
  on('emote', (m) => room.effects.emote(m.from, m.kind, m.target));
  on('banner', (m) => {
    banners.banner(m.text);
    // The "you're up" text follows youreUp; show it in the overlay too.
    const mine = snap.teams[teamOf(snap, myId) ?? ''];
    if (announce && mine && m.text === upBanner(mine.name)) announce.setText(m.text);
  });
  on('youreUp', (m) => {
    if (m.teamId !== teamOf(snap, myId)) return;
    room.effects.flashTable(snap.teamOrder.indexOf(m.teamId));
    riddle?.close();
    quiz?.close();
    const t = snap.teams[m.teamId];
    announceOpen("You're up!", t ? upBanner(t.name) : '', t?.color);
  });
  on('celebrate', (m) => {
    const v = celebrateView(snap, myId, m.teamId);
    if (v.mine) {
      riddle?.close();
      confetti(hud);
      announceOpen('You escaped!', '', snap.teams[m.teamId]?.color);
    } else {
      banners.timed(v.text);
    }
  });

  applySnap(snap);

  return {
    destroy() {
      for (const u of unsubs) u();
      riddle?.close();
      quiz?.close();
      board?.close();
      announce?.close();
      banners.destroy();
      for (const e of [zoomBtn, boardBtn, lookBtn, tableBtn, sheet, cardEl]) e.remove();
    },
  };
}

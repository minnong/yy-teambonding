// Client-side game state the snapshot does not carry: my team's latest riddle and boss step, the
// last quiz's choices (for the result toast) and which quizzes I answered. Created at page load,
// before any hello, so the catch-up riddle/boss sent right after `welcome` is never missed (even
// while the avatar builder is still open). Listens only; it never sends.
import type { Net } from '../net';
import type { PublicSnapshot } from '@shared/protocol';
import type { PlayerId, TeamId } from '@shared/types';
import type { BossInfo, QuizInfo, RiddleInfo } from './uiState';

const ANSWERED_KEY = 'lobby.quizAnswered';
const MAX_ANSWERED = 50;
interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

/**
 * Quiz keys (quizKey) I answered, mirrored to sessionStorage so a reload mid-quiz does not reopen
 * an answered quiz. Storage can throw (private mode, disabled): memory still works.
 */
export class AnsweredQuizzes {
  private readonly keys = new Set<string>();

  constructor(private readonly storage: () => KV = () => sessionStorage, private readonly key = ANSWERED_KEY) {
    try {
      const v: unknown = JSON.parse(this.storage().getItem(this.key) ?? '[]');
      if (Array.isArray(v)) for (const k of v) if (typeof k === 'string') this.keys.add(k);
    } catch { /* missing, corrupt or unavailable: start empty */ }
  }

  has(key: string): boolean { return this.keys.has(key); }

  add(key: string): void {
    this.keys.add(key);
    try { this.storage().setItem(this.key, JSON.stringify([...this.keys].slice(-MAX_ANSWERED))); } catch { /* memory only */ }
  }
}

export class UiStore {
  me: PlayerId | null = null;
  snap: PublicSnapshot | null = null;
  readonly riddles = new Map<TeamId, RiddleInfo>();
  readonly bosses = new Map<TeamId, BossInfo>();
  /** The latest quiz seen (message or snapshot); kept after it closes so quizResult can name the answer. */
  quiz: QuizInfo | null = null;
  /** Quizzes I answered (by quizKey), kept across reloads in this tab. */
  readonly answered = new AnsweredQuizzes();
  /** Calls of my team whose "You're up!" this tab has shown (youreUpKey), kept across reloads (M7). */
  readonly youreUpSeen = new AnsweredQuizzes(() => sessionStorage, 'lobby.youreUpSeen');

  constructor(net: Net) {
    net.on('welcome', (m) => { this.me = m.you; this.setSnap(m.snapshot); });
    net.on('snapshot', (m) => this.setSnap(m.snapshot));
    net.on('riddle', (m) => {
      const t = this.myTeam();
      if (t) this.riddles.set(t, { index: m.index, q: m.q, lockedUntil: m.lockedUntil });
    });
    net.on('boss', (m) => {
      const t = this.myTeam();
      if (t) this.bosses.set(t, { index: m.index, q: m.q, done: m.done, ...(m.intro !== undefined ? { intro: m.intro } : {}) });
    });
    net.on('quiz', (m) => { this.quiz = { q: m.q, choices: m.choices, endsAt: m.endsAt }; });
  }

  myTeam(): TeamId | undefined {
    return this.me && this.snap ? this.snap.players[this.me]?.teamId : undefined;
  }
  riddle(): RiddleInfo | null { const t = this.myTeam(); return (t && this.riddles.get(t)) || null; }
  boss(): BossInfo | null { const t = this.myTeam(); return (t && this.bosses.get(t)) || null; }

  private setSnap(s: PublicSnapshot): void {
    this.snap = s;
    if (s.quizActive) this.quiz = s.quizActive;
  }
}

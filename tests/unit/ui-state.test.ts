import { describe, it, expect } from 'vitest';
import {
  bannerPlan, bossActive, canIcebreak, cardView, celebrateView, closedToast, leaderboardRows,
  quizCountdown, quizExpired, quizResultText, quizSecondsLeft, quizToShow, sheetTarget, skipLockText,
  tableButton, quizKey,
} from '../../src/client/ui/uiState';
import type { BossInfo } from '../../src/client/ui/uiState';
import type { IcebreakerCard, PublicSnapshot } from '@shared/protocol';
import type { Player, Team } from '@shared/types';

const team = (id: string, extra: Partial<Team> = {}): Team => ({
  id, name: id[0]!.toUpperCase() + id.slice(1), color: '#123456', goesFirst: false, score: 0, scoreChangedAt: 0,
  status: 'playing', departedOrder: null, riddleIndex: 0, riddleLockedUntil: 0, bossIndex: 0, bossDone: false, ...extra,
});
const player = (id: string, teamId: string, name = id): Player =>
  ({ id, name, teamId, look: null, addedOnDay: false, removed: false });

function snap(extra: Partial<PublicSnapshot> = {}): PublicSnapshot {
  return {
    epoch: 'e-test', phase: 'competition', paused: false, teamOrder: ['otter', 'pixel', 'comet'],
    teams: { otter: team('otter'), pixel: team('pixel'), comet: team('comet') },
    players: { me: player('me', 'pixel', 'Mia'), bo: player('bo', 'otter', 'Bo'), cy: player('cy', 'pixel', 'Cy') },
    motions: {}, online: { me: true, bo: true, cy: true }, collectibles: [], departures: [],
    lastCallAt: null, quizActive: null, serverNow: 0, ...extra,
  };
}
/** Only my team (pixel) is still playing: the final boss is on for us. */
function bossSnap(extra: Partial<Team> = {}): PublicSnapshot {
  return snap({
    teams: {
      otter: team('otter', { status: 'departed', departedOrder: 1 }),
      pixel: team('pixel', extra),
      comet: team('comet', { status: 'departed', departedOrder: 2 }),
    },
    departures: ['otter', 'comet'],
  });
}
const bossQ: BossInfo = { index: 0, q: 'What has keys but no locks?', done: false, intro: 'Escape!' };

describe('riddle / boss button', () => {
  it('shows Riddle at my own table during an unpaused competition while my team plays', () => {
    expect(tableButton(snap(), 'me', true, null)).toBe('riddle');
  });
  it('is hidden away from my table, in warm-up, while paused, or after my team left', () => {
    expect(tableButton(snap(), 'me', false, null)).toBeNull();
    expect(tableButton(snap({ phase: 'warmup' }), 'me', true, null)).toBeNull();
    expect(tableButton(snap({ paused: true }), 'me', true, null)).toBeNull();
    const gone = snap({ teams: { ...snap().teams, pixel: team('pixel', { status: 'departed', departedOrder: 1 }) } });
    expect(tableButton(gone, 'me', true, null)).toBeNull();
    expect(tableButton(snap(), 'ghost', true, null)).toBeNull();
  });
  it('becomes Final boss when my team is the sole playing team, not done, and the boss has a q', () => {
    expect(bossActive(bossSnap(), 'pixel', bossQ)).toBe(true);
    expect(tableButton(bossSnap(), 'me', true, bossQ)).toBe('boss');
    expect(tableButton(bossSnap(), 'me', false, bossQ)).toBeNull();
  });
  it('stays Riddle when the boss is done, has no q, or other teams still play', () => {
    expect(tableButton(bossSnap({ bossDone: true }), 'me', true, bossQ)).toBe('riddle');
    expect(tableButton(bossSnap(), 'me', true, { ...bossQ, q: null })).toBe('riddle');
    expect(tableButton(bossSnap(), 'me', true, { ...bossQ, done: true })).toBe('riddle');
    expect(tableButton(bossSnap(), 'me', true, null)).toBe('riddle');
    expect(tableButton(snap(), 'me', true, bossQ)).toBe('riddle');
  });
});

describe('proximity sheet', () => {
  it('targets the tapped player while they are near, else the nearest', () => {
    expect(sheetTarget(['a', 'b'], null)).toBe('a');
    expect(sheetTarget(['a', 'b'], 'b')).toBe('b');
    expect(sheetTarget(['a'], 'b')).toBe('a');
    expect(sheetTarget([], 'b')).toBeNull();
  });
  it('offers Icebreaker only for someone on another team', () => {
    expect(canIcebreak(snap(), 'me', 'bo')).toBe(true);
    expect(canIcebreak(snap(), 'me', 'cy')).toBe(false);
    expect(canIcebreak(snap(), 'me', 'nobody')).toBe(false);
  });
  it('keeps Icebreaker in warm-up even with a team marked departed', () => {
    const s = snap({ phase: 'warmup', teams: { ...snap().teams, otter: team('otter', { status: 'departed' }) } });
    expect(canIcebreak(s, 'me', 'bo')).toBe(true);
  });
  it('hides Icebreaker in competition when either team has departed', () => {
    const theirsGone = snap({ teams: { ...snap().teams, otter: team('otter', { status: 'departed', departedOrder: 1 }) } });
    expect(canIcebreak(theirsGone, 'me', 'bo')).toBe(false);
    const mineGone = snap({ teams: { ...snap().teams, pixel: team('pixel', { status: 'departed', departedOrder: 1 }) } });
    expect(canIcebreak(mineGone, 'me', 'bo')).toBe(false);
  });
});

describe('icebreaker card view', () => {
  const names: Record<string, string> = { me: 'Mia', bo: 'Bo' };
  const nameOf = (id: string) => names[id] ?? id;
  const card = (answeredBy: string | null): IcebreakerCard =>
    ({ id: 'ib-1', a: 'me', b: 'bo', prompt: 'Best snack?', answeredBy });

  it('before anyone answers both people see the prompt and "We answered it!"', () => {
    expect(cardView(card(null), 'me', nameOf)).toEqual({ id: 'ib-1', prompt: 'Best snack?', otherId: 'bo', otherName: 'Bo', mode: 'answer' });
    expect(cardView(card(null), 'bo', nameOf)).toMatchObject({ otherId: 'me', otherName: 'Mia', mode: 'answer' });
  });
  it('the answerer waits for the other person', () => {
    expect(cardView(card('me'), 'me', nameOf)).toMatchObject({ mode: 'waiting', waitingText: 'Waiting for Bo…' });
  });
  it('the other person confirms', () => {
    expect(cardView(card('me'), 'bo', nameOf)).toMatchObject({ mode: 'confirm', prompt: 'Best snack?' });
    expect(cardView(card('bo'), 'me', nameOf)).toMatchObject({ mode: 'confirm', otherName: 'Bo' });
  });
  it('a stranger, or no card, sees nothing', () => {
    expect(cardView(card(null), 'cy', nameOf)).toBeNull();
    expect(cardView(null, 'me', nameOf)).toBeNull();
  });
});

describe('icebreaker close toast', () => {
  it('says who left or whose team headed out', () => {
    expect(closedToast('left', 'Bo')).toBe('Bo left');
    expect(closedToast('departed', 'Bo')).toBe("Bo's team headed out");
  });
  it('is silent for done, cancelled and no reason', () => {
    expect(closedToast('done', 'Bo')).toBeNull();
    expect(closedToast('cancelled', 'Bo')).toBeNull();
    expect(closedToast(undefined, 'Bo')).toBeNull();
  });
});

describe('quiz countdown', () => {
  it('counts whole seconds up, never below 0', () => {
    expect(quizSecondsLeft(20_000, 0)).toBe(20);
    expect(quizSecondsLeft(20_000, 100)).toBe(20);
    expect(quizSecondsLeft(20_000, 19_001)).toBe(1);
    expect(quizSecondsLeft(20_000, 20_000)).toBe(0);
    expect(quizSecondsLeft(20_000, 25_000)).toBe(0);
  });
  it('formats as seconds', () => {
    expect(quizCountdown(20_000, 0)).toBe('20s');
    expect(quizCountdown(20_000, 12_500)).toBe('8s');
    expect(quizCountdown(20_000, 30_000)).toBe('0s');
  });
  it('expires at endsAt', () => {
    expect(quizExpired(20_000, 19_999)).toBe(false);
    expect(quizExpired(20_000, 20_000)).toBe(true);
  });
  it('the result toast names the correct choice', () => {
    expect(quizResultText(['Red', 'Blue', 'Green', 'Gold'], 2)).toBe('Answer: Green');
    expect(quizResultText(['Red'], 5)).toBeNull();
    expect(quizResultText(null, 0)).toBeNull();
  });
});

describe('quiz after reconnect', () => {
  const active = { q: 'Capital?', choices: ['A', 'B', 'C', 'D'], endsAt: 50_000 };
  it('shows an active quiz I have not answered', () => {
    expect(quizToShow(snap({ quizActive: active }), 'me', new Set(), 40_000)).toEqual(active);
  });
  it('does not show it once I answered it', () => {
    expect(quizToShow(snap({ quizActive: active }), 'me', new Set([quizKey(active)]), 40_000)).toBeNull();
  });
  it('a different (later) quiz still shows', () => {
    expect(quizToShow(snap({ quizActive: { ...active, endsAt: 90_000 } }), 'me', new Set([quizKey(active)]), 80_000)).not.toBeNull();
  });
  it('not when expired, when there is none, or when my team is no longer playing', () => {
    expect(quizToShow(snap({ quizActive: active }), 'me', new Set(), 50_000)).toBeNull();
    expect(quizToShow(snap(), 'me', new Set(), 0)).toBeNull();
    const gone = snap({ quizActive: active, teams: { ...snap().teams, pixel: team('pixel', { status: 'departed', departedOrder: 1 }) } });
    expect(quizToShow(gone, 'me', new Set(), 40_000)).toBeNull();
  });
});

describe('riddle skip lock', () => {
  it('counts down from lockedUntil, then nothing', () => {
    expect(skipLockText(30_000, 0)).toBe('30s');
    expect(skipLockText(30_000, 29_500)).toBe('1s');
    expect(skipLockText(30_000, 30_000)).toBeNull();
    expect(skipLockText(0, 10)).toBeNull();
  });
});

describe('banners', () => {
  it('Paused sticks, empty text clears, anything else lasts 6 s', () => {
    expect(bannerPlan('Paused')).toEqual({ kind: 'sticky', text: 'Paused' });
    expect(bannerPlan('')).toEqual({ kind: 'clear' });
    expect(bannerPlan('FINAL BOSS: escape the lobby!')).toEqual({ kind: 'timed', text: 'FINAL BOSS: escape the lobby!', ms: 6000 });
  });
  it('celebrate: my team escaped, or a small banner for another team', () => {
    expect(celebrateView(snap(), 'me', 'pixel')).toEqual({ mine: true });
    expect(celebrateView(snap(), 'me', 'otter')).toEqual({ mine: false, text: 'Otter escaped the lobby! 🎉' });
  });
});

describe('leaderboard overlay rows', () => {
  it('ranks playing teams like the wall board, then departed teams as ✅ {ordinal} {name}', () => {
    const s = snap({
      teams: {
        otter: team('otter', { status: 'departed', departedOrder: 1, score: 5 }),
        pixel: team('pixel', { score: 40 }),
        comet: team('comet', { score: 90 }),
      },
      departures: ['otter'],
    });
    expect(leaderboardRows(s)).toEqual([
      { kind: 'leader', rank: 1, name: 'Comet', score: 90, color: '#123456', text: '1 Comet' },
      { kind: 'team', rank: 2, name: 'Pixel', score: 40, color: '#123456', text: '2 Pixel' },
      { kind: 'departed', rank: null, name: 'Otter', score: 5, color: '#123456', text: '✅ 1ST Otter' },
    ]);
  });
  it('ties keep table order and nobody leads at 0', () => {
    const rows = leaderboardRows(snap());
    expect(rows.map((r) => r.name)).toEqual(['Otter', 'Pixel', 'Comet']);
    expect(rows.every((r) => r.kind === 'team')).toBe(true);
  });
});

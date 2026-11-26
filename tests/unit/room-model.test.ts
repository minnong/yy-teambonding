import { describe, it, expect } from 'vitest';
import { KeyStack, isTap, keyDir, isTextEntry } from '../../src/client/room/input';
import { rankBoard, boardLine } from '../../src/client/room/leaderboard';
import { signText, truncateToFit } from '../../src/client/room/tables';
import type { PublicSnapshot } from '@shared/protocol';
import type { Team } from '@shared/types';

const team = (id: string, score: number, extra: Partial<Team> = {}): Team => ({
  id, name: id, color: '#fff', goesFirst: false, score, scoreChangedAt: 0, status: 'playing',
  departedOrder: null, riddleIndex: 0, riddleLockedUntil: 0, bossIndex: 0, bossDone: false, ...extra,
});

describe('tap vs drag', () => {
  it('a tap is under ~10 px and 300 ms', () => {
    expect(isTap(3, 4, 120)).toBe(true);
    expect(isTap(0, 0, 299)).toBe(true);
    expect(isTap(12, 0, 100)).toBe(false);
    expect(isTap(0, 0, 400)).toBe(false);
  });
});

describe('KeyStack', () => {
  it('press sends walk, a held key repeating sends nothing', () => {
    const k = new KeyStack();
    expect(k.press('up')).toBe('up');
    expect(k.press('up')).toBeNull();
  });
  it('latest key wins and releasing it falls back to the other held key', () => {
    const k = new KeyStack();
    k.press('up');
    expect(k.press('left')).toBe('left');
    expect(k.release('left')).toBe('up');
    expect(k.release('up')).toBe('stop');
  });
  it('releasing a key that is not the active one sends nothing', () => {
    const k = new KeyStack();
    k.press('up'); k.press('left');
    expect(k.release('up')).toBeNull();
    expect(k.release('left')).toBe('stop');
    expect(k.release('left')).toBeNull();
  });
  it('clear stops only if something was held', () => {
    const k = new KeyStack();
    expect(k.clear()).toBeNull();
    k.press('down');
    expect(k.clear()).toBe('stop');
    expect(k.press('down')).toBe('down');
  });
  it('maps WASD and arrows, and spots text fields', () => {
    expect(keyDir('KeyW')).toBe('up');
    expect(keyDir('ArrowLeft')).toBe('left');
    expect(keyDir('KeyS')).toBe('down');
    expect(keyDir('KeyD')).toBe('right');
    expect(keyDir('KeyQ')).toBeNull();
    expect(isTextEntry({ tagName: 'INPUT' } as unknown as Element)).toBe(true);
    expect(isTextEntry({ tagName: 'TEXTAREA' } as unknown as Element)).toBe(true);
    expect(isTextEntry({ tagName: 'DIV', isContentEditable: true } as unknown as Element)).toBe(true);
    expect(isTextEntry({ tagName: 'BUTTON' } as unknown as Element)).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});

describe('table signs', () => {
  it('playing shows ★ score, departed shows ✅ WENT ordinal', () => {
    expect(signText(team('a', 240))).toBe('★ 240');
    expect(signText(team('a', 10, { status: 'departed', departedOrder: 2 }))).toBe('✅ WENT 2ND');
  });
  it('truncateToFit shortens with an ellipsis', () => {
    const measure = (s: string) => s.length * 6;
    expect(truncateToFit('OTTERS', 60, measure)).toBe('OTTERS');
    expect(truncateToFit('MAGNIFICENT OTTERS', 60, measure)).toBe('MAGNIFICE…');
  });
});

describe('wall leaderboard', () => {
  const snap = (teams: Team[], departures: string[]): PublicSnapshot => ({
    phase: 'competition', paused: false, teamOrder: teams.map((t) => t.id),
    teams: Object.fromEntries(teams.map((t) => [t.id, t])), players: {}, motions: {}, online: {},
    collectibles: [], departures, lastCallAt: null, quizActive: null, serverNow: 0,
  });

  it('ranks playing teams by score, ties by teamOrder, leader highlighted, departed below in order', () => {
    const rows = rankBoard(snap([
      team('otter', 180), team('pixel', 240), team('comet', 180),
      team('mango', 300, { status: 'departed', departedOrder: 2 }),
      team('koala', 90, { status: 'departed', departedOrder: 1 }),
    ], ['koala', 'mango']), 20);
    expect(rows.map((r) => r.kind)).toEqual(['leader', 'team', 'team', 'departed', 'departed']);
    expect(rows[0]!.text).toBe(boardLine(1, 'pixel', 240, 20));
    expect(rows[1]!.text).toContain('OTTER');
    expect(rows[2]!.text).toContain('COMET');
    expect(rows[3]!.text).toBe('✅ 1ST KOALA');
    expect(rows[4]!.text).toBe('✅ 2ND MANGO');
  });

  it('no leader highlight while everyone is on 0', () => {
    const rows = rankBoard(snap([team('a', 0), team('b', 0)], []), 20);
    expect(rows.map((r) => r.kind)).toEqual(['team', 'team']);
  });

  it('boardLine pads with dots to a fixed width and truncates long names', () => {
    expect(boardLine(1, 'Otter', 240, 16)).toBe('1 OTTER .....240');
    const long = boardLine(2, 'The Magnificent Otters', 5, 16);
    expect(long).toHaveLength(16);
    expect(long).toBe('2 THE MAGNI… ..5');
  });
});

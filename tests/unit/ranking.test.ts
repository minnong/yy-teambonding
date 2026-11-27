import { describe, it, expect } from 'vitest';
import { createState, publicSnapshot, type Ctx } from '@shared/game/index';
import { nextLeader } from '@shared/game/calls';
import { compareTeams, rankPlayingTeams } from '@shared/ranking';
import { loadContent } from '@shared/content';
import { rankBoard } from '../../src/client/room/leaderboard';
import { leaderboardRows as phoneRows } from '../../src/client/ui/uiState';
import { leaderboardRows as hostRows, type HostState } from '../../src/client/host/hostModel';

const content = loadContent();
const ctx = (now: number): Ctx => ({ now, rng: () => 0.5, content });

/** Competition with pixel and comet tied on 60: comet got there first, pixel is earlier in teamOrder. */
function tied() {
  const s = createState(content, 1000);
  s.phase = 'competition';
  s.teams.otter!.status = 'departed';
  s.teams.otter!.departedOrder = 1;
  s.departures = ['otter'];
  s.teams.pixel!.score = 60; s.teams.pixel!.scoreChangedAt = 3000;
  s.teams.comet!.score = 60; s.teams.comet!.scoreChangedAt = 2000;
  return s;
}

describe('one ranking for every view (I2)', () => {
  it('ties go to the team that reached the score first, then teamOrder', () => {
    const s = tied();
    expect(s.teamOrder.indexOf('pixel')).toBeLessThan(s.teamOrder.indexOf('comet'));
    expect(rankPlayingTeams(s).map((t) => t.id).slice(0, 2)).toEqual(['comet', 'pixel']);
    // Equal score and time: teamOrder decides.
    s.teams.comet!.scoreChangedAt = 3000;
    expect(rankPlayingTeams(s).map((t) => t.id).slice(0, 2)).toEqual(['pixel', 'comet']);
    const order = new Map(s.teamOrder.map((id, i) => [id, i]));
    expect(compareTeams(order)(s.teams.pixel!, s.teams.comet!)).toBeLessThan(0);
  });

  it('CALL NEXT, the wall board, the phone overlay and the host board agree on a tie', () => {
    const s = tied();
    const snap = publicSnapshot(s, ctx(5000));
    expect(snap.teams.comet!.scoreChangedAt).toBe(2000); // the client can sort by it
    const leader = nextLeader(s);
    expect(leader).toBe('comet');
    const wall = rankBoard(snap, 20);
    expect(wall[0]!.kind).toBe('leader');
    expect(wall[0]!.text).toContain('COMET');
    expect(phoneRows(snap)[0]!.name).toBe('Comet');
    const hs: HostState = {
      type: 'hostState', snapshot: snap, msgCount: 0, lastCallAt: null, nextLeader: null,
      connectedPerTeam: Object.fromEntries(snap.teamOrder.map((id) => [id, { online: 0, total: 5 }])),
    };
    expect(hostRows(hs)[0]!.teamId).toBe(leader);
  });
});

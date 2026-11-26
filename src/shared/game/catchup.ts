// What a player who (re)joins needs beyond the snapshot: their team's private riddle/boss text.
// Sent by the Room right after `welcome`, so a reconnect, an object restart or an undo never
// leaves a client without the question it should be looking at.
import type { GameState, PlayerId } from '../types';
import type { ServerMsg } from '../protocol';
import type { Ctx } from './result';
import { isPlayingTeam, livePlayer } from './state';
import { riddleState } from './scoring';
import { bossState, bossTeam } from './calls';

export function catchUp(state: GameState, playerId: PlayerId, ctx: Ctx): ServerMsg[] {
  const p = livePlayer(state, playerId);
  if (!p || state.phase !== 'competition' || !isPlayingTeam(state, p.teamId)) return [];
  const out = [riddleState(state, p.teamId, ctx)];
  if (bossTeam(state) === p.teamId && !state.teams[p.teamId]!.bossDone) out.push(bossState(state, p.teamId, ctx));
  return out;
}

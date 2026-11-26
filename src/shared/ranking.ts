// The one team ranking used everywhere a "leader" is shown or called (I2): CALL NEXT TEAM, the wall
// board, the phone leaderboard and the host board. Score descending, then whichever team reached
// that score first (earliest scoreChangedAt), then teamOrder.
import type { Team, TeamId } from './types';

/** Comparator for Array.sort; `order` maps a team id to its teamOrder index. */
export function compareTeams(order: ReadonlyMap<TeamId, number>): (a: Team, b: Team) => number {
  const idx = (t: Team) => order.get(t.id) ?? Number.MAX_SAFE_INTEGER;
  return (a, b) => b.score - a.score || a.scoreChangedAt - b.scoreChangedAt || idx(a) - idx(b);
}

/** Playing teams, best first. Works on the server state and on a PublicSnapshot alike. */
export function rankPlayingTeams(s: { teamOrder: TeamId[]; teams: Record<TeamId, Team> }): Team[] {
  const order = new Map(s.teamOrder.map((id, i) => [id, i]));
  return s.teamOrder
    .filter((id) => Object.hasOwn(s.teams, id) && s.teams[id]!.status === 'playing')
    .map((id) => s.teams[id]!)
    .sort(compareTeams(order));
}

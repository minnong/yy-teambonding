export type TeamId = string; export type PlayerId = string;
export interface Vec { x: number; y: number }                       // world px
export interface AvatarLook { skin: number; hair: number; hairColor: number; top: number;
  topColor: number; bottomsColor: number; accessory: number }      // indexes into AVATAR_OPTIONS
export interface Motion { path: Vec[]; startedAt: number }          // path[0] = start; speed WALK_SPEED
export type Phase = 'warmup' | 'competition';
export interface Team { id: TeamId; name: string; color: string; goesFirst: boolean;
  score: number; scoreChangedAt: number; status: 'playing' | 'departed';
  departedOrder: number | null; riddleIndex: number; riddleLockedUntil: number;
  bossIndex: number; bossDone: boolean }
export interface Player { id: PlayerId; name: string; teamId: TeamId; look: AvatarLook | null;
  addedOnDay: boolean; removed: boolean }
export interface Icebreaker { id: string; a: PlayerId; b: PlayerId; prompt: number;
  answeredBy: PlayerId | null }
export interface Quiz { questionIndex: number; endsAt: number;
  answers: Record<PlayerId, number> }
export interface Collectible { id: string; pos: Vec }
export interface GameState {
  /**
   * Changes on every Reset (and on the first load of a save without one). A hello must carry the
   * current epoch, so a phone that joined before a Reset goes back to the name picker.
   */
  epoch: string;
  phase: Phase; paused: boolean; pausedAt: number | null;
  teamOrder: TeamId[]; teams: Record<TeamId, Team>; players: Record<PlayerId, Player>;
  metPairs: string[];                     // `${minId}|${maxId}`
  icebreakers: Record<string, Icebreaker>;
  collectibles: Collectible[]; nextCollectibleAt: number | null;
  quiz: Quiz | null; nextQuizIndex: number; promptCursor: number;
  departures: TeamId[]; lastCallAt: number | null; competitionStartedAt: number | null;
  callTimes: number[];                    // callTimes[i] = when departures[i] left (for undo)
  msgCount: { day: string; count: number };
  // runtime only, never persisted:
  motions: Record<PlayerId, Motion>; online: Record<PlayerId, boolean>; lastTickAt: number;
}
export interface Content { teams: { id: TeamId; name: string; color: string; goesFirst?: boolean }[];
  players: { id: PlayerId; name: string; teamId: TeamId }[];
  icebreakers: string[]; riddles: { q: string; answers: string[] }[];
  quiz: { q: string; choices: string[]; correct: number }[];
  boss: { intro: string; steps: { q: string; answers: string[] }[] } }

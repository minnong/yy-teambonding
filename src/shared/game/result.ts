// Reducer plumbing shared by every handler file: context, addressing, results and handler types.
import type { Content, GameState, PlayerId, TeamId } from '../types';
import type { ActionOf, ActionType, ServerMsg } from '../protocol';

export interface Ctx { now: number; rng: () => number; content: Content }
export type To = 'all' | 'host' | { player: PlayerId } | { team: TeamId };
export interface Outbound { to: To; msg: ServerMsg }
export interface Result {
  out: Outbound[]; persist: boolean; snapshot: boolean; error?: string;
  /** Set only by a successful `addSelf`: the id of the player that was created. */
  addedPlayerId?: PlayerId;
}

/**
 * A handler for one action type. It must validate before mutating: when it returns an error,
 * `state` must be exactly as it was.
 */
export type Handler<T extends ActionType> = (state: GameState, action: ActionOf<T>, ctx: Ctx) => Result;
export type HandlerMap = { [T in ActionType]?: Handler<T> };

export const ok = (out: Outbound[] = [], opts: { persist?: boolean; snapshot?: boolean } = {}): Result =>
  ({ out, persist: opts.persist ?? false, snapshot: opts.snapshot ?? false });

/** Silently ignored: nothing changed, nothing to send, no error for the sender. */
export const ignored = (): Result => ({ out: [], persist: false, snapshot: false });

export const err = (message: string): Result => ({ out: [], persist: false, snapshot: false, error: message });

export const ONLY_WARMUP = 'Only before the competition starts';

// Who each socket is, and who a message is for. Identity lives only in socket attachments, which
// survive hibernation, so routing is rebuilt from ctx.getWebSockets() every time and never from
// in-memory maps.
import type { GameState, PlayerId } from '../shared/types';
import type { To } from '../shared/game/index';
import { isOpen } from './wire';

export type Attachment = { kind: 'player'; playerId: PlayerId; token: string } | { kind: 'host' };
export interface Sock { ws: WebSocket; att: Attachment | null }
export type PlayerSock = Sock & { att: Extract<Attachment, { kind: 'player' }> };

export function attachmentOf(ws: WebSocket): Attachment | null {
  try {
    return (ws.deserializeAttachment() as Attachment | null) ?? null;
  } catch {
    return null;
  }
}

export const listSockets = (ctx: DurableObjectState): Sock[] =>
  ctx.getWebSockets().map((ws) => ({ ws, att: attachmentOf(ws) }));

export const isPlayerSock = (s: Sock): s is PlayerSock => s.att?.kind === 'player';
export const isHostSock = (s: Sock): boolean => s.att?.kind === 'host';

/** Open sockets that hold `playerId`, other than `except`. */
export const socketsOf = (socks: Sock[], playerId: PlayerId, except: WebSocket | null = null): PlayerSock[] =>
  socks.filter((s): s is PlayerSock => isPlayerSock(s) && s.att.playerId === playerId && s.ws !== except && isOpen(s.ws));

/**
 * Whether an outbound addressed `to` goes to this socket. Sockets that have not said hello get
 * nothing; 'all' reaches players and hosts; a team is resolved from the current roster, so a
 * host.movePlayer takes effect immediately.
 */
export function isFor(to: To, s: Sock, state: GameState): boolean {
  const a = s.att;
  if (!a) return false;
  if (to === 'all') return true;
  if (to === 'host') return a.kind === 'host';
  if (a.kind !== 'player') return false;
  if ('player' in to) return a.playerId === to.player;
  return state.players[a.playerId]?.teamId === to.team;
}

// The only place frames are (de)serialized. decode validates against the zod schemas; send never
// throws and never writes to a socket that is not OPEN.
import { ClientMsgSchema, MAX_FRAME_LEN, type ClientMsg, type ServerMsg } from '../shared/protocol';

const OPEN = 1; // WebSocket.readyState

export const isOpen = (ws: WebSocket): boolean => ws.readyState === OPEN;

/** A validated client frame, or null for anything malformed (binary, oversized, bad JSON, bad shape). */
export function decode(raw: string | ArrayBuffer): ClientMsg | null {
  if (typeof raw !== 'string' || raw.length > MAX_FRAME_LEN) return null;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return null; }
  const r = ClientMsgSchema.safeParse(data);
  return r.success ? r.data : null;
}

export const encode = (msg: ServerMsg): string => JSON.stringify(msg);

/** Sends a message (or a pre-encoded frame, for fan-out). Returns whether it was handed to the socket. */
export function send(ws: WebSocket, msg: ServerMsg | string): boolean {
  if (!isOpen(ws)) return false;
  try {
    ws.send(typeof msg === 'string' ? msg : encode(msg));
    return true;
  } catch {
    return false;
  }
}

export const sendError = (ws: WebSocket, message: string): boolean => send(ws, { type: 'error', message });

export function close(ws: WebSocket, code: number, reason: string): void {
  try { ws.close(code, reason); } catch { /* already closing or closed */ }
}

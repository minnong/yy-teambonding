// R27: client-side move coalescing, a hard bound on the message budget. At most one `move` per
// second (a trailing send of the latest target), and at most 20 in any rolling 60 s. Taps beyond
// that fold into one trailing move that goes as soon as the window allows. Pure: the caller owns
// the timer (schedule `flush` at `nextAt()`).
import type { Vec } from '@shared/types';

export const MOVE_MIN_GAP_MS = 1000;
export const MOVE_WINDOW_MS = 60_000;
export const MOVE_WINDOW_MAX = 20;

export class MoveThrottle {
  private sent: number[] = [];
  private pending: Vec | null = null;

  constructor(
    private readonly gapMs = MOVE_MIN_GAP_MS,
    private readonly windowMs = MOVE_WINDOW_MS,
    private readonly maxPerWindow = MOVE_WINDOW_MAX,
  ) {}

  /** Earliest time the next move may be sent. */
  private allowedAt(): number {
    const lastSent = this.sent.at(-1);
    const byGap = lastSent === undefined ? -Infinity : lastSent + this.gapMs;
    const byWindow = this.sent.length >= this.maxPerWindow ? this.sent[this.sent.length - this.maxPerWindow]! + this.windowMs : -Infinity;
    return Math.max(byGap, byWindow);
  }

  private record(now: number): void {
    this.sent.push(now);
    while (this.sent.length > 0 && this.sent[0]! <= now - this.windowMs) this.sent.shift();
  }

  /** A tap: returns the target to send now, or null if it was queued as the trailing move. */
  request(to: Vec, now: number): Vec | null {
    if (this.pending === null && now >= this.allowedAt()) { this.record(now); return to; }
    this.pending = to;
    return null;
  }

  /** When the queued move may go, or null if nothing is queued. */
  nextAt(): number | null {
    return this.pending === null ? null : this.allowedAt();
  }

  /** Returns the queued target if it may be sent at `now` (and records it), else null. */
  flush(now: number): Vec | null {
    if (this.pending === null || now < this.allowedAt()) return null;
    const to = this.pending;
    this.pending = null;
    this.record(now);
    return to;
  }

  /** Drops the queued move (a keyboard walk took over, or the scene is going away). */
  clear(): void { this.pending = null; }
}

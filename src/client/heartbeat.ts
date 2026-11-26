// Liveness check over the raw `ping` the Room's auto-response answers (uncounted, never wakes the
// object). The host page runs it every 15 s while visible; Net probes once on every unlock (I3).
export const HEARTBEAT_MS = 15_000;
export const PONG_DEADLINE_MS = 5_000;

export class Heartbeat {
  private every: ReturnType<typeof setInterval> | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;

  /** `ping` returns false when nothing could be sent (socket not open: Net already reconnects). */
  constructor(
    private readonly ping: () => boolean,
    private readonly onMiss: () => void,
    private readonly intervalMs = HEARTBEAT_MS,
    private readonly deadlineMs = PONG_DEADLINE_MS,
  ) {}

  start(): void {
    this.stop();
    this.every = setInterval(() => this.beat(), this.intervalMs);
  }

  stop(): void {
    if (this.every !== null) { clearInterval(this.every); this.every = null; }
    this.pong();
  }

  /** The answer arrived (or the socket was replaced): no miss for the outstanding ping. */
  pong(): void {
    if (this.deadline !== null) { clearTimeout(this.deadline); this.deadline = null; }
  }

  /** One ping now, outside the interval (the page just became visible). Waits on an outstanding one. */
  probe(): void { this.beat(); }

  private beat(): void {
    if (this.deadline !== null) return; // still waiting on the last one
    if (!this.ping()) return;
    this.deadline = setTimeout(() => { this.deadline = null; this.onMiss(); }, this.deadlineMs);
  }
}

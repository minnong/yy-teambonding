// Host-only liveness check while the page is visible: a raw `ping` every 15 s that must be answered
// within 5 s. The Room's auto-response answers it without counting it or waking the object.
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

  private beat(): void {
    if (this.deadline !== null) return; // still waiting on the last one
    if (!this.ping()) return;
    this.deadline = setTimeout(() => { this.deadline = null; this.onMiss(); }, this.deadlineMs);
  }
}

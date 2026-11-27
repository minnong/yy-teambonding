// I1: the look chosen in the avatar builder, held until a snapshot shows the server has it. A lost
// setLook (socket not open, socket dead after a phone lock, or a frame lost on reconnect) would
// otherwise leave the player invisible to everyone, and nothing would ever resend it.
// Pure: the send function and the clock are passed in; main.ts wires it to Net.sendJoinLook.
import type { PublicSnapshot } from '@shared/protocol';
import type { AvatarLook, PlayerId } from '@shared/types';

/** A snapshot without my look this long after a send means the send was probably lost. */
export const LOOK_RESEND_MS = 4000;

export class PendingLook {
  private look: AvatarLook | null = null;
  /** When the current look last left the device, or null if it has not (yet) been sent. */
  private sentAt: number | null = null;

  constructor(
    private readonly send: (look: AvatarLook) => boolean,
    private readonly now: () => number = Date.now,
    private readonly resendMs = LOOK_RESEND_MS,
  ) {}

  /** The look still waiting for the server, or null. */
  get value(): AvatarLook | null { return this.look; }

  /** The builder finished: send it now, and keep it until the server shows it. */
  set(look: AvatarLook): void {
    this.look = look;
    this.sentAt = null;
    this.flush();
  }

  /** A welcome is a fresh socket: whatever went down the old one may be lost, so resend now. */
  onWelcome(s: PublicSnapshot, me: PlayerId): void {
    if (this.settle(s, me)) return;
    this.sentAt = null;
    this.flush();
  }

  /** Resends only if nothing went out yet, or the last send is older than resendMs. */
  onSnapshot(s: PublicSnapshot, me: PlayerId): void {
    if (this.settle(s, me)) return;
    if (this.sentAt === null || this.now() - this.sentAt >= this.resendMs) this.flush();
  }

  /** `s` with my pending look filled in while the server still shows none (so my avatar stays). */
  patch(s: PublicSnapshot, me: PlayerId): PublicSnapshot {
    const p = s.players[me];
    if (!this.look || !p || p.look) return s;
    return { ...s, players: { ...s.players, [me]: { ...p, look: this.look } } };
  }

  /** True when there is nothing left to do: no pending look, the server has one, or I am gone. */
  private settle(s: PublicSnapshot, me: PlayerId): boolean {
    if (!this.look) return true;
    const p = Object.hasOwn(s.players, me) ? s.players[me] : undefined;
    if (!p || p.look) { this.look = null; this.sentAt = null; return true; }
    return false;
  }

  private flush(): void {
    if (this.look && this.send(this.look)) this.sentAt = this.now();
  }
}

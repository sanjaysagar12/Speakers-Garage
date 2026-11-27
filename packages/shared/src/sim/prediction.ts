import { applyCommand, quantizeAxis, quantizeYaw, seqNewer, type InputCommand, type PlayerSim } from './commands';
import type { MoveEnv } from './step';

const RING = 256;

/**
 * Client-side prediction with server reconciliation.
 *
 *  - every fixed step: `step()` builds a quantized command, applies it locally at once (no input delay)
 *    and keeps it until the server acknowledges it
 *  - every snapshot: `reconcile()` rewinds to the authoritative state, drops acknowledged commands and
 *    replays the rest. Because both sides run the same applyCommand on the same quantized commands, the
 *    replayed state equals the prediction unless the server disagreed (dropped or corrected input).
 *
 * Commands live in a fixed ring (no allocation per step).
 */
export class Predictor {
  readonly state: PlayerSim;
  private readonly ring: InputCommand[] = Array.from({ length: RING }, () => ({ seq: 0, dx: 0, dz: 0, run: false, yaw: 0 }));
  /** ring index of the oldest unacknowledged command, and how many are pending */
  private head = 0;
  private count = 0;
  private nextSeq = 0;
  /** commands produced but not yet sent */
  private unsent = 0;
  lastTurnRate = 0;

  constructor(initial: PlayerSim) {
    this.state = { ...initial };
  }

  get pending(): number {
    return this.count;
  }

  /** Produce and apply one command. Directions are -1..1 world space; yaw is the camera yaw (radians). */
  step(dirX: number, dirZ: number, run: boolean, yaw: number, env: MoveEnv): InputCommand {
    if (this.count === RING) {
      // the server has not acknowledged anything for RING steps: forget the oldest (it will be corrected)
      this.head = (this.head + 1) % RING;
      this.count--;
      this.unsent = Math.min(this.unsent, this.count);
    }
    const c = this.ring[(this.head + this.count) % RING];
    c.seq = this.nextSeq;
    c.dx = quantizeAxis(dirX);
    c.dz = quantizeAxis(dirZ);
    c.run = run;
    c.yaw = quantizeYaw(yaw);
    this.nextSeq = (this.nextSeq + 1) % 65536;
    this.count++;
    this.unsent++;
    this.lastTurnRate = applyCommand(this.state, c, env);
    return c;
  }

  /** Commands not sent yet, oldest first, into `out` (reused). Marks them as sent. */
  takeUnsent(out: InputCommand[]): number {
    const n = this.unsent;
    const start = this.count - n;
    for (let i = 0; i < n; i++) out[i] = this.ring[(this.head + start + i) % RING];
    this.unsent = 0;
    return n;
  }

  /** Re-send everything not yet acknowledged (after a reconnect). */
  resendAll(): void {
    this.unsent = this.count;
  }

  /**
   * Apply an authoritative snapshot of our own player. `ackSeq` is the last command the server applied
   * (65535 + no commands yet is handled by `hasAck`). Returns the distance between the predicted position
   * before and after reconciling (0 when the prediction was right): the caller smooths small errors and
   * snaps on large ones.
   */
  reconcile(server: Readonly<PlayerSim>, ackSeq: number, hasAck: boolean, env: MoveEnv): number {
    const px = this.state.x;
    const pz = this.state.z;
    if (hasAck) {
      // drop acknowledged commands (ackSeq and everything older)
      while (this.count > 0) {
        const c = this.ring[this.head];
        if (seqNewer(c.seq, ackSeq)) break;
        this.head = (this.head + 1) % RING;
        this.count--;
      }
      this.unsent = Math.min(this.unsent, this.count);
    }
    Object.assign(this.state, server);
    for (let i = 0; i < this.count; i++) this.lastTurnRate = applyCommand(this.state, this.ring[(this.head + i) % RING], env);
    return Math.hypot(this.state.x - px, this.state.z - pz);
  }

  /** Teleport / respawn: forget pending input. */
  reset(s: Readonly<PlayerSim>): void {
    Object.assign(this.state, s);
    this.count = 0;
    this.unsent = 0;
  }
}

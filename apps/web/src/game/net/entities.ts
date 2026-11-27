import { ANIM, fromFixed, fromHeading, fromSpeedByte, type PlayerInfo, type Snapshot } from '@shoreline/shared';

/**
 * Remote players for the render loop: a mutable store, never React state. Snapshots (20 Hz) are buffered
 * per entity and played back `delay` ms in the past, interpolating between the two samples around the
 * render time. When a snapshot is late, motion is extrapolated along the last velocity for up to 200 ms,
 * then held. The delay adapts to the peak arrival jitter (100 ms at a steady 20 Hz, up to 300 ms on a bad
 * network or a busy device), and a visual smoothing layer turns any remaining correction into a short
 * catch-up instead of a jump.
 *
 * Everything here is preallocated per entity; a snapshot allocates nothing.
 */

const RING = 10;
const MAX_EXTRAPOLATE_MS = 200;

interface Sample {
  t: number;
  x: number;
  z: number;
  y: number;
  h: number;
  anim: number;
  speed: number;
}

export interface RenderState {
  x: number;
  z: number;
  y: number;
  heading: number;
  /** horizontal velocity from the interpolated motion (drives the gait) */
  vx: number;
  vz: number;
  speed: number;
  anim: number;
  /** false until the first sample arrives */
  ready: boolean;
}

/** fastest the rendered position may catch up (m/s): 1.5x run speed; beyond 3 m it's a teleport (snap) */
const CATCH_UP_SPEED = 10;
const SNAP_DISTANCE = 3;

export class RemoteEntity {
  readonly samples: Sample[] = Array.from({ length: RING }, () => ({ t: 0, x: 0, z: 0, y: 0, h: 0, anim: 0, speed: 0 }));
  /** index of the newest sample, and how many are valid */
  head = -1;
  count = 0;
  readonly render: RenderState = { x: 0, z: 0, y: 0, heading: 0, vx: 0, vz: 0, speed: 0, anim: 0, ready: false };
  /** the interpolated/extrapolated state for this frame, before visual smoothing */
  private readonly target: RenderState = { x: 0, z: 0, y: 0, heading: 0, vx: 0, vz: 0, speed: 0, anim: 0, ready: false };
  /** speech bubble */
  chat: { text: string; until: number } | null = null;
  constructor(readonly id: number) {}

  push(t: number, x: number, z: number, y: number, h: number, anim: number, speed: number): void {
    this.head = (this.head + 1) % RING;
    const s = this.samples[this.head];
    s.t = t;
    s.x = x;
    s.z = z;
    s.y = y;
    s.h = h;
    s.anim = anim;
    s.speed = speed;
    this.count = Math.min(RING, this.count + 1);
  }

  /** repeat the newest sample at time t (entity unchanged in this snapshot: delta compression) */
  repeat(t: number): void {
    if (this.count === 0) return;
    const s = this.samples[this.head];
    this.push(t, s.x, s.z, s.y, s.h, s.anim, s.speed);
  }

  private at(back: number): Sample {
    return this.samples[(this.head - back + RING * 2) % RING];
  }

  /**
   * Update `render` for render time `rt` (server ms); `dt` = seconds since the last frame. The rendered
   * position follows the interpolated target but never faster than CATCH_UP_SPEED, so a late burst of data
   * becomes a short quick catch-up instead of a jump.
   */
  sample(rt: number, dt: number): void {
    if (this.count === 0) return;
    this.interpolate(rt);
    const t = this.target;
    const r = this.render;
    const dx = t.x - r.x;
    const dz = t.z - r.z;
    const d = Math.hypot(dx, dz);
    const maxStep = Math.max(Math.hypot(t.vx, t.vz), CATCH_UP_SPEED) * dt;
    if (!r.ready || d > SNAP_DISTANCE || d <= maxStep) {
      r.x = t.x;
      r.z = t.z;
    } else {
      r.x += (dx / d) * maxStep;
      r.z += (dz / d) * maxStep;
    }
    r.y += (t.y - r.y) * Math.min(1, dt * 15);
    if (!r.ready) r.y = t.y;
    r.heading = t.heading;
    r.vx = t.vx;
    r.vz = t.vz;
    r.speed = t.speed;
    r.anim = t.anim;
    r.ready = true;
  }

  private interpolate(rt: number): void {
    const r = this.target;
    const newest = this.at(0);
    if (this.count === 1 || rt >= newest.t) {
      // late snapshot: extrapolate briefly along the last velocity, then hold
      const prev = this.count > 1 ? this.at(1) : newest;
      const span = Math.max(1, newest.t - prev.t);
      const vx = ((newest.x - prev.x) / span) * 1000;
      const vz = ((newest.z - prev.z) / span) * 1000;
      const ahead = Math.min(Math.max(0, rt - newest.t), MAX_EXTRAPOLATE_MS) / 1000;
      const moving = (newest.anim & ANIM.moving) !== 0 && ahead < MAX_EXTRAPOLATE_MS / 1000;
      r.x = newest.x + (moving ? vx * ahead : 0);
      r.z = newest.z + (moving ? vz * ahead : 0);
      r.y = newest.y;
      r.heading = newest.h;
      r.vx = moving ? vx : 0;
      r.vz = moving ? vz : 0;
      r.speed = moving ? newest.speed : 0;
      r.anim = newest.anim;
      r.ready = true;
      return;
    }
    // find the pair a (older) <= rt < b (newer)
    for (let back = 1; back < this.count; back++) {
      const a = this.at(back);
      const b = this.at(back - 1);
      if (a.t <= rt || back === this.count - 1) {
        const span = Math.max(1, b.t - a.t);
        const k = Math.min(1, Math.max(0, (rt - a.t) / span));
        r.x = a.x + (b.x - a.x) * k;
        r.z = a.z + (b.z - a.z) * k;
        r.y = a.y + (b.y - a.y) * k;
        let dh = b.h - a.h;
        if (dh > Math.PI) dh -= Math.PI * 2;
        if (dh < -Math.PI) dh += Math.PI * 2;
        r.heading = a.h + dh * k;
        r.vx = ((b.x - a.x) / span) * 1000;
        r.vz = ((b.z - a.z) / span) * 1000;
        r.speed = a.speed + (b.speed - a.speed) * k;
        r.anim = k < 0.5 ? a.anim : b.anim;
        r.ready = true;
        return;
      }
    }
  }
}

class RemoteStore {
  readonly entities = new Map<number, RemoteEntity>();
  /** everyone in the room (roster), including players outside the area of interest */
  readonly roster = new Map<number, PlayerInfo>();
  selfId = -1;
  tickMs = 50;
  /** server time - local time (ms), smoothed */
  private offset = 0;
  private synced = false;
  private lastArrival = 0;
  /** decaying peak of |inter-arrival - tickMs| (ms) */
  jitter = 0;
  /** current interpolation delay (ms) */
  delay = 100;
  private lastRender = 0;
  private lastNow = 0;
  /** bumped whenever the roster or the set of entities changes (UI polls this at a low rate) */
  version = 0;

  reset(selfId: number, tickRate: number): void {
    this.entities.clear();
    this.roster.clear();
    this.selfId = selfId;
    this.tickMs = 1000 / tickRate;
    this.synced = false;
    this.jitter = 0;
    this.delay = this.tickMs * 2;
    this.version++;
  }

  spawn(id: number): void {
    if (!this.entities.has(id)) this.entities.set(id, new RemoteEntity(id));
    this.version++;
  }

  despawn(id: number): void {
    this.entities.delete(id);
    this.version++;
  }

  /** Apply one snapshot (already decoded). `now` = performance.now(). */
  applySnapshot(s: Readonly<Snapshot>, now: number): void {
    const t = s.tick * this.tickMs;
    // clock: server time ~ local time + offset; track the minimum delay (late packets don't pull it back)
    const off = t - now;
    if (!this.synced) {
      this.offset = off;
      this.synced = true;
    } else this.offset += (off - this.offset) * (off > this.offset ? 0.2 : 0.05);
    // ease toward early arrivals (less delay) faster than toward late ones; never jump: a jump in the
    // render clock shows as a speed spike in every remote player
    if (this.lastArrival) {
      // peak (decaying) deviation of the arrival interval: bursts must be covered, not averaged away
      const dev = Math.abs(now - this.lastArrival - this.tickMs);
      this.jitter = Math.max(dev, this.jitter * 0.97);
    }
    this.lastArrival = now;
    this.delay = Math.min(300, Math.max(100, this.tickMs * 2 + this.jitter));

    // entities in the snapshot get a new sample; others in view repeat their last (unchanged)
    for (let i = 0; i < s.count; i++) {
      const e = s.entities[i];
      let ent = this.entities.get(e.id);
      if (!ent) {
        ent = new RemoteEntity(e.id);
        this.entities.set(e.id, ent);
        this.version++;
      }
      ent.push(t, fromFixed(e.x), fromFixed(e.z), fromFixed(e.y), fromHeading(e.heading), e.anim, fromSpeedByte(e.speed));
    }
    for (const ent of this.entities.values()) if (ent.count && ent.samples[ent.head].t < t) ent.repeat(t);
  }

  /**
   * Server-time render clock, `delay` ms behind the newest data. It is never set, only steered: it advances
   * by real elapsed time at 90-110% speed toward the target, so arrival bursts (a busy main thread, network
   * jitter) can't make remote players jump. Only an error over 500 ms (tab was hidden) snaps it.
   */
  renderTime(now: number): number {
    const target = now + this.offset - this.delay;
    if (!this.lastNow || Math.abs(target - this.lastRender) > 500) {
      this.lastRender = target;
      this.lastNow = now;
      return target;
    }
    const dt = now - this.lastNow;
    this.lastNow = now;
    const err = target - (this.lastRender + dt);
    const rate = 1 + Math.max(-0.1, Math.min(0.1, err / 1000));
    this.lastRender += dt * rate;
    return this.lastRender;
  }

  private lastSampleAt = 0;
  sampleAll(now: number): void {
    const rt = this.renderTime(now);
    const dt = this.lastSampleAt ? Math.min(0.25, (now - this.lastSampleAt) / 1000) : 0;
    this.lastSampleAt = now;
    for (const e of this.entities.values()) e.sample(rt, dt);
  }

  clear(): void {
    this.entities.clear();
    this.roster.clear();
    this.selfId = -1;
    this.lastRender = 0;
    this.lastNow = 0;
    this.lastSampleAt = 0;
    this.version++;
  }
}

export const remotes = new RemoteStore();

import { NET } from './constants';
import type { InputCommand, PlayerSim } from '../sim/commands';

/**
 * Binary protocol for the hot paths (inputs, snapshots, ping). Little-endian. Every binary message starts
 * with a u8 message type; JSON messages travel as text frames (see messages.ts).
 *
 * Encoders write into a caller-owned Writer (one reusable buffer per connection), and decoders fill
 * caller-owned objects, so neither side allocates per message on the hot path.
 */
export const BIN = {
  input: 1,
  ping: 2,
  snapshot: 101,
  pong: 102,
} as const;

const FP_MIN = -32768;
const FP_MAX = 32767;

/** metres -> int16 fixed point (1/100 m). Quantization error ≤ 0.005 m. */
export const toFixed = (m: number): number => Math.max(FP_MIN, Math.min(FP_MAX, Math.round(m * NET.posScale)));
export const fromFixed = (q: number): number => q / NET.posScale;

/** radians -> u16 heading. Error ≤ π/65536. */
export const toHeading = (a: number): number => ((Math.round((a / (Math.PI * 2)) * 65536) % 65536) + 65536) % 65536;
export const fromHeading = (q: number): number => {
  const a = (q / 65536) * Math.PI * 2;
  return a > Math.PI ? a - Math.PI * 2 : a;
};

/** m/s -> u8 (0.05 m/s steps) */
export const toSpeedByte = (v: number): number => Math.max(0, Math.min(255, Math.round(v * NET.speedScale)));
export const fromSpeedByte = (b: number): number => b / NET.speedScale;

/** Growable byte writer over one reusable ArrayBuffer. */
export class Writer {
  private buf: ArrayBuffer;
  private view: DataView;
  private bytes: Uint8Array<ArrayBuffer>;
  pos = 0;
  constructor(size = 1024) {
    this.buf = new ArrayBuffer(size);
    this.view = new DataView(this.buf);
    this.bytes = new Uint8Array(this.buf);
  }
  reset(): this {
    this.pos = 0;
    return this;
  }
  private ensure(n: number): void {
    if (this.pos + n <= this.buf.byteLength) return;
    const next = new ArrayBuffer(Math.max(this.buf.byteLength * 2, this.pos + n));
    new Uint8Array(next).set(this.bytes.subarray(0, this.pos));
    this.buf = next;
    this.view = new DataView(next);
    this.bytes = new Uint8Array(next);
  }
  u8(v: number): void {
    this.ensure(1);
    this.view.setUint8(this.pos, v);
    this.pos += 1;
  }
  i8(v: number): void {
    this.ensure(1);
    this.view.setInt8(this.pos, v);
    this.pos += 1;
  }
  u16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.pos, v, true);
    this.pos += 2;
  }
  i16(v: number): void {
    this.ensure(2);
    this.view.setInt16(this.pos, v, true);
    this.pos += 2;
  }
  u32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.pos, v >>> 0, true);
    this.pos += 4;
  }
  f64(v: number): void {
    this.ensure(8);
    this.view.setFloat64(this.pos, v, true);
    this.pos += 8;
  }
  /** a view of the written bytes (valid until the next write); copy it if it must outlive that */
  view8(): Uint8Array<ArrayBuffer> {
    return this.bytes.subarray(0, this.pos);
  }
  /** overwrite a u8 written earlier (e.g. a count known only at the end) */
  patchU8(at: number, v: number): void {
    this.view.setUint8(at, v);
  }
}

/** Bounds-checked reader. Any read past the end throws (the server treats that as a malformed message). */
export class Reader {
  pos = 0;
  private readonly view: DataView;
  constructor(data: ArrayBuffer | ArrayBufferView) {
    this.view = ArrayBuffer.isView(data) ? new DataView(data.buffer, data.byteOffset, data.byteLength) : new DataView(data);
  }
  get remaining(): number {
    return this.view.byteLength - this.pos;
  }
  private need(n: number): void {
    if (this.pos + n > this.view.byteLength) throw new RangeError('message truncated');
  }
  u8(): number {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }
  i8(): number {
    this.need(1);
    return this.view.getInt8(this.pos++);
  }
  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f64(): number {
    this.need(8);
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }
}

// ---------------------------------------------------------------- input (client -> server)
// u8 type, u16 firstSeq, u8 n, n x { i8 dx, i8 dz, u8 flags (bit0 run), u16 yaw }  = 4 + 5n bytes

export function encodeInput(w: Writer, cmds: readonly InputCommand[], from = 0, to = cmds.length): Uint8Array<ArrayBuffer> {
  const n = Math.min(to - from, NET.maxCommandsPerPacket);
  w.reset();
  w.u8(BIN.input);
  w.u16(n > 0 ? cmds[from].seq : 0);
  w.u8(n);
  for (let i = 0; i < n; i++) {
    const c = cmds[from + i];
    w.i8(c.dx);
    w.i8(c.dz);
    w.u8(c.run ? 1 : 0);
    w.u16(c.yaw);
  }
  return w.view8();
}

/** Decodes into `out` (reusing its objects). Returns the number of commands. Sequence numbers are consecutive. */
export function decodeInput(r: Reader, out: InputCommand[]): number {
  const first = r.u16();
  const n = r.u8();
  if (n > NET.maxCommandsPerPacket) throw new RangeError('too many commands');
  for (let i = 0; i < n; i++) {
    const c = out[i] ?? (out[i] = { seq: 0, dx: 0, dz: 0, run: false, yaw: 0 });
    c.seq = (first + i) % 65536;
    c.dx = Math.max(-127, r.i8());
    c.dz = Math.max(-127, r.i8());
    c.run = (r.u8() & 1) === 1;
    c.yaw = r.u16();
  }
  return n;
}

// ---------------------------------------------------------------- ping / pong

export function encodePing(w: Writer, clientTime: number): Uint8Array<ArrayBuffer> {
  w.reset();
  w.u8(BIN.ping);
  w.u32(clientTime);
  return w.view8();
}

export function encodePong(w: Writer, clientTime: number, serverTick: number): Uint8Array<ArrayBuffer> {
  w.reset();
  w.u8(BIN.pong);
  w.u32(clientTime);
  w.u32(serverTick);
  return w.view8();
}

// ---------------------------------------------------------------- snapshot (server -> client)
// u8 type, u32 tick, u16 ackSeq, self { f64 x, z, y, vx, vz, facing } (exact: needed for replay), u8 n,
// n x { u16 id, i16 x, i16 z, i16 y, u16 heading, u8 anim, u8 speed }  = 56 + 12n bytes

/** One remote entity as sent in a snapshot (quantized). */
export interface EntityState {
  id: number;
  /** fixed point, 1/100 m */
  x: number;
  z: number;
  y: number;
  heading: number;
  anim: number;
  speed: number;
}

export const ENTITY_BYTES = 12;
export const SNAPSHOT_HEADER_BYTES = 1 + 4 + 2 + 6 * 8 + 1;

export function beginSnapshot(w: Writer, tick: number, ackSeq: number, self: Readonly<PlayerSim>): number {
  w.reset();
  w.u8(BIN.snapshot);
  w.u32(tick);
  w.u16(ackSeq);
  w.f64(self.x);
  w.f64(self.z);
  w.f64(self.y);
  w.f64(self.vx);
  w.f64(self.vz);
  w.f64(self.facing);
  const countAt = w.pos;
  w.u8(0);
  return countAt;
}

export function writeEntity(w: Writer, e: Readonly<EntityState>): void {
  w.u16(e.id);
  w.i16(e.x);
  w.i16(e.z);
  w.i16(e.y);
  w.u16(e.heading);
  w.u8(e.anim);
  w.u8(e.speed);
}

export function endSnapshot(w: Writer, countAt: number, n: number): Uint8Array<ArrayBuffer> {
  w.patchU8(countAt, n);
  return w.view8();
}

/** Decoded snapshot; reuse one instance (entities array grows as needed). */
export interface Snapshot {
  tick: number;
  ackSeq: number;
  self: PlayerSim;
  count: number;
  entities: EntityState[];
}

export const newSnapshot = (): Snapshot => ({ tick: 0, ackSeq: 0, self: { x: 0, z: 0, y: 0, vx: 0, vz: 0, facing: 0 }, count: 0, entities: [] });

/** Decodes after the type byte has been read. */
export function decodeSnapshot(r: Reader, out: Snapshot): Snapshot {
  out.tick = r.u32();
  out.ackSeq = r.u16();
  out.self.x = r.f64();
  out.self.z = r.f64();
  out.self.y = r.f64();
  out.self.vx = r.f64();
  out.self.vz = r.f64();
  out.self.facing = r.f64();
  out.count = r.u8();
  for (let i = 0; i < out.count; i++) {
    const e = out.entities[i] ?? (out.entities[i] = { id: 0, x: 0, z: 0, y: 0, heading: 0, anim: 0, speed: 0 });
    e.id = r.u16();
    e.x = r.i16();
    e.z = r.i16();
    e.y = r.i16();
    e.heading = r.u16();
    e.anim = r.u8();
    e.speed = r.u8();
  }
  return out;
}

/** Quantize a sim state into an entity record (server side). */
export function quantizeEntity(id: number, s: Readonly<PlayerSim>, anim: number, out: EntityState): EntityState {
  out.id = id;
  out.x = toFixed(s.x);
  out.z = toFixed(s.z);
  out.y = toFixed(s.y);
  out.heading = toHeading(s.facing);
  out.anim = anim;
  out.speed = toSpeedByte(Math.hypot(s.vx, s.vz));
  return out;
}

export const sameEntity = (a: Readonly<EntityState>, b: Readonly<EntityState>): boolean =>
  a.x === b.x && a.z === b.z && a.y === b.y && a.heading === b.heading && a.anim === b.anim && a.speed === b.speed;

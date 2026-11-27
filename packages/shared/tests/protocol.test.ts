import { describe, expect, it } from 'vitest';
import {
  BIN,
  NET,
  Reader,
  Writer,
  beginSnapshot,
  decodeInput,
  decodeSnapshot,
  encodeInput,
  endSnapshot,
  fromFixed,
  fromHeading,
  fromSpeedByte,
  newSnapshot,
  quantizeEntity,
  sanitizeAvatar,
  sanitizeChat,
  sanitizeName,
  sanitizeRoomId,
  seqNewer,
  writeEntity,
  type EntityState,
  type InputCommand,
} from '../src';
import { rng } from '../src/util/rng';
import { parseClientMessage } from '../src/net/schemas';

describe('binary codec', () => {
  it('round-trips input batches (sequence numbers wrap)', () => {
    const w = new Writer(16);
    const cmds: InputCommand[] = [
      { seq: 65534, dx: -127, dz: 127, run: true, yaw: 0 },
      { seq: 65535, dx: 0, dz: -64, run: false, yaw: 65535 },
      { seq: 0, dx: 50, dz: 1, run: true, yaw: 12345 },
    ];
    const bytes = encodeInput(w, cmds);
    expect(bytes.byteLength).toBe(4 + 5 * cmds.length);
    const r = new Reader(bytes);
    expect(r.u8()).toBe(BIN.input);
    const out: InputCommand[] = [];
    expect(decodeInput(r, out)).toBe(3);
    expect(out.slice(0, 3)).toEqual(cmds);
  });

  it('caps a batch at maxCommandsPerPacket and rejects oversized ones', () => {
    const cmds = Array.from({ length: 40 }, (_, i) => ({ seq: i, dx: 1, dz: 1, run: false, yaw: 0 }));
    const bytes = encodeInput(new Writer(), cmds);
    const r = new Reader(bytes);
    r.u8();
    expect(decodeInput(r, [])).toBe(NET.maxCommandsPerPacket);
    const bad = new Uint8Array([BIN.input, 0, 0, 200]);
    const rb = new Reader(bad);
    rb.u8();
    expect(() => decodeInput(rb, [])).toThrow();
  });

  it('throws on truncated messages instead of reading garbage', () => {
    const r = new Reader(new Uint8Array([BIN.input, 1, 0, 2, 5]));
    r.u8();
    expect(() => decodeInput(r, [])).toThrow(RangeError);
  });

  it('round-trips snapshots; quantization error stays within bounds', () => {
    const rand = rng(7);
    const w = new Writer(64);
    const self = { x: 12.345678901, z: -3.25, y: 0.75, vx: 1.5, vz: -2.25, facing: 2.9 };
    const at = beginSnapshot(w, 123456, 4321, self);
    const sent: Array<{ x: number; z: number; y: number; h: number; v: number }> = [];
    const e: EntityState = { id: 0, x: 0, z: 0, y: 0, heading: 0, anim: 0, speed: 0 };
    for (let i = 0; i < 50; i++) {
      const s = { x: rand() * 300 - 20, z: rand() * 300 - 20, y: rand() * 6 - 1, vx: rand() * 8 - 4, vz: rand() * 8 - 4, facing: rand() * Math.PI * 2 - Math.PI };
      sent.push({ x: s.x, z: s.z, y: s.y, h: s.facing, v: Math.hypot(s.vx, s.vz) });
      writeEntity(w, quantizeEntity(i + 1, s, 3, e));
    }
    const bytes = endSnapshot(w, at, 50);
    expect(bytes.byteLength).toBe(56 + 12 * 50);
    const r = new Reader(bytes);
    expect(r.u8()).toBe(BIN.snapshot);
    const snap = decodeSnapshot(r, newSnapshot());
    expect(snap.tick).toBe(123456);
    expect(snap.ackSeq).toBe(4321);
    expect(snap.self).toEqual(self); // exact: reconciliation needs it
    expect(snap.count).toBe(50);
    for (let i = 0; i < 50; i++) {
      const d = snap.entities[i];
      const s = sent[i];
      expect(d.id).toBe(i + 1);
      expect(Math.abs(fromFixed(d.x) - s.x)).toBeLessThanOrEqual(0.005 + 1e-9);
      expect(Math.abs(fromFixed(d.z) - s.z)).toBeLessThanOrEqual(0.005 + 1e-9);
      expect(Math.abs(fromFixed(d.y) - s.y)).toBeLessThanOrEqual(0.005 + 1e-9);
      const dh = Math.abs(((fromHeading(d.heading) - s.h + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      expect(dh).toBeLessThanOrEqual(Math.PI / 65536 + 1e-9);
      expect(Math.abs(fromSpeedByte(d.speed) - s.v)).toBeLessThanOrEqual(0.025 + 1e-9);
      expect(d.anim).toBe(3);
    }
    expect(r.remaining).toBe(0);
  });

  it('compares wrapping sequence numbers', () => {
    expect(seqNewer(1, 0)).toBe(true);
    expect(seqNewer(0, 65535)).toBe(true);
    expect(seqNewer(65535, 0)).toBe(false);
    expect(seqNewer(5, 5)).toBe(false);
  });
});

describe('JSON messages and sanitizing', () => {
  it('accepts a valid join and rejects junk', () => {
    const ok = parseClientMessage(JSON.stringify({ t: 'join', v: 1, name: 'Ana', avatar: sanitizeAvatar({}), room: 'beach-1' }));
    expect(ok?.t).toBe('join');
    expect(parseClientMessage('{not json')).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'teleport', x: 1 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'chat', text: 'x'.repeat(5000) }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'emote', emote: 'fly' }))).toBeNull();
  });

  it('cleans names', () => {
    expect(sanitizeName('  <b>Ana</b>  ')).toBe('bAnab');
    expect(sanitizeName('Zoë   Smith')).toBe('Zoë Smith');
    expect(sanitizeName('‮evil\u0000')).toBe('evil');
    expect(sanitizeName('a'.repeat(50))?.length).toBe(NET.nameMaxLength);
    expect(sanitizeName('   ')).toBeNull();
    expect(sanitizeName(42)).toBeNull();
    expect(sanitizeName('shit happens')).toBe('s**t happens');
  });

  it('cleans chat and room ids', () => {
    expect(sanitizeChat('hi <script>alert(1)</script>')).toBe('hi scriptalert(1)/script');
    expect(sanitizeChat('a\n\n b')).toBe('a b');
    expect(sanitizeChat('x'.repeat(500))?.length).toBe(NET.chatMaxLength);
    expect(sanitizeChat('   ')).toBeNull();
    expect(sanitizeRoomId('Beach Party!')).toBe('beachparty');
  });

  it('whitelists avatar items and colour formats', () => {
    const a = sanitizeAvatar({ hairStyle: 'mohawk-of-doom', topId: 'hoodie', topColor: 'red', skin: '#AABBCC', hatColor: '#12345' });
    expect(a.hairStyle).toBe('short');
    expect(a.topId).toBe('hoodie');
    expect(a.topColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(a.skin).toBe('#AABBCC');
    expect(a.hatColor).not.toBe('#12345');
  });
});

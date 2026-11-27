/**
 * Room-level tests with a fake transport and a controllable clock: area of interest, anti-cheat (speed hack,
 * walking into water / through props), reconnect window expiry, voice relay distance checks.
 */
import { describe, expect, it } from 'vitest';
import { NET, SIM, STEP_DT, VOICE, createMapData, quantizeAxis, sanitizeAvatar, standHeight } from '@shoreline/shared';
import { Room } from '../src/rooms/Room';
import { MemoryPlayerStore } from '../src/store/PlayerStore';
import { FakeTransport, cmds } from './helpers';

const quiet = { info: () => undefined, warn: () => undefined };

function makeRoom(over: Partial<{ aoiRadius: number; capacity: number }> = {}) {
  let t = 1000;
  const room = new Room({
    id: 'r',
    mapId: 'beach',
    capacity: over.capacity ?? 50,
    tickRate: 20,
    aoiRadius: over.aoiRadius ?? NET.aoiRadius,
    iceFor: () => [],
    store: new MemoryPlayerStore(),
    log: quiet,
    onEmpty: () => undefined,
    now: () => t,
  });
  const advance = (ms: number) => (t += ms);
  /** run `ticks` ticks of 50 ms */
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) {
      advance(50);
      room.step();
    }
  };
  const join = async (name: string) => {
    const tr = new FakeTransport();
    const p = await room.join(tr, name, sanitizeAvatar({}));
    return { p, tr };
  };
  return { room, advance, run, join, now: () => t };
}

const binary = (cs: ReturnType<typeof cmds>) => {
  // build an input packet the way the client does
  const buf = new Uint8Array(4 + 5 * cs.length);
  const v = new DataView(buf.buffer);
  v.setUint8(0, 1);
  v.setUint16(1, cs[0].seq, true);
  v.setUint8(3, cs.length);
  cs.forEach((c, i) => {
    v.setInt8(4 + i * 5, c.dx);
    v.setInt8(5 + i * 5, c.dz);
    v.setUint8(6 + i * 5, c.run ? 1 : 0);
    v.setUint16(7 + i * 5, c.yaw, true);
  });
  return buf;
};

describe('area of interest', () => {
  it('sends only entities within the radius, with spawn/despawn and hysteresis', async () => {
    const { room, run, join } = makeRoom({ aoiRadius: 10 });
    const a = await join('A');
    const b = await join('B');
    run(1);
    expect(a.tr.text.some((m) => m.t === 'spawn' && m.id === b.p.id)).toBe(true);
    expect(a.tr.lastSnapshot()!.entities.map((e) => e.id)).toContain(b.p.id);

    // move B 12 m away: inside radius + hysteresis (14) -> still in view
    b.p.sim.x = a.p.sim.x + 12;
    b.p.sim.z = a.p.sim.z;
    run(1);
    expect(a.tr.text.some((m) => m.t === 'despawn')).toBe(false);
    // 20 m: out of view -> despawn, and B no longer appears in A's snapshots
    b.p.sim.x = a.p.sim.x + 20;
    run(2);
    expect(a.tr.text.some((m) => m.t === 'despawn' && m.id === b.p.id)).toBe(true);
    expect(a.tr.lastSnapshot()!.entities.map((e) => e.id)).not.toContain(b.p.id);
    // back to 12 m: NOT inside the entry radius (10) yet
    b.p.sim.x = a.p.sim.x + 12;
    run(1);
    expect(a.tr.text.filter((m) => m.t === 'spawn' && m.id === b.p.id)).toHaveLength(1);
    // 8 m: spawns again
    b.p.sim.x = a.p.sim.x + 8;
    run(1);
    expect(a.tr.text.filter((m) => m.t === 'spawn' && m.id === b.p.id)).toHaveLength(2);
    room.stop();
  });

  it('delta-compresses: idle entities are not resent', async () => {
    const { run, join } = makeRoom();
    const a = await join('A');
    await join('B');
    run(1);
    expect(a.tr.lastSnapshot()!.count).toBe(1);
    run(1);
    expect(a.tr.lastSnapshot()!.count).toBe(0); // nothing changed
  });

  it('a crowd of 49 others in view stays under 15 KB/s per client', async () => {
    const { room, run, join } = makeRoom();
    const a = await join('A');
    const others = [];
    for (let i = 0; i < 49; i++) others.push(await join(`B${i}`));
    run(1);
    const before = a.p.bytesOut;
    // everyone walks every tick (worst case: every entity changes every snapshot)
    for (let t = 0; t < 40; t++) {
      for (const o of others) room.handleBinary(o.p, binary(cmds(t * 3, 3, quantizeAxis(Math.sin(t + o.p.id)), quantizeAxis(Math.cos(t + o.p.id)))));
      run(1);
    }
    const perSec = (a.p.bytesOut - before) / 2; // 40 ticks = 2 s
    expect(perSec / 1024).toBeLessThan(15);
    room.stop();
  });
});

describe('anti-cheat', () => {
  it('a speed hack (10x the input rate) moves no faster than real time + burst', async () => {
    const { room, run, join } = makeRoom();
    const { p } = await join('Cheater');
    const x0 = p.sim.x;
    const z0 = p.sim.z;
    // 600 commands in one second (normal: 60)
    let seq = 0;
    for (let t = 0; t < 20; t++) {
      for (let k = 0; k < 2; k++) {
        room.handleBinary(p, binary(cmds(seq, 15, 0, 127, true)));
        seq += 15;
      }
      run(1);
    }
    const dist = Math.hypot(p.sim.x - x0, p.sim.z - z0);
    // at most (60 + burst 20) steps at run speed
    expect(dist).toBeLessThanOrEqual(SIM.player.runSpeed * STEP_DT * (NET.commandRate + NET.commandBurst) + 0.01);
    room.stop();
  });

  it('cannot walk into deep water or through solid props', async () => {
    const { room, run, join } = makeRoom();
    const { p } = await join('Swimmer');
    const map = createMapData('beach');
    // seaward direction = downhill of the shore distance field
    const sd = map.shoreDistance!;
    const g = [sd(p.sim.x + 1, p.sim.z) - sd(p.sim.x - 1, p.sim.z), sd(p.sim.x, p.sim.z + 1) - sd(p.sim.x, p.sim.z - 1)];
    const l = Math.hypot(g[0], g[1]);
    const dx = quantizeAxis(-g[0] / l);
    const dz = quantizeAxis(-g[1] / l);
    // 30 s of running at the sea
    for (let t = 0; t < 600; t++) {
      room.handleBinary(p, binary(cmds(t * 3, 3, dx, dz, true)));
      run(1);
      expect(map.blockedAt(p.sim.x, p.sim.z)).toBe(false);
    }
    expect(map.terrainAt(p.sim.x, p.sim.z)).not.toBe('deep');
    room.stop();
  });

  it('never places anyone inside a prop footprint', async () => {
    const { room, run, join } = makeRoom();
    const players = [];
    for (let i = 0; i < 6; i++) players.push((await join(`W${i}`)).p);
    const map = createMapData('beach');
    for (let t = 0; t < 400; t++) {
      for (const p of players) {
        const a = (t >> 4) * 1.7 + p.id;
        room.handleBinary(p, binary(cmds(t * 3, 3, quantizeAxis(Math.sin(a)), quantizeAxis(Math.cos(a)), t % 50 > 25)));
      }
      run(1);
    }
    for (const p of players) {
      expect(map.blockedAt(p.sim.x, p.sim.z)).toBe(false);
      expect(Math.abs(p.sim.y - standHeight(map, p.sim.x, p.sim.z))).toBeLessThan(0.5);
    }
    room.stop();
  });
});

describe('lifecycle and voice', () => {
  it('keeps a disconnected player for the reconnect window, then removes them', async () => {
    const { room, run, join } = makeRoom();
    const a = await join('A');
    const b = await join('B');
    room.disconnect(b.p, b.tr);
    run(Math.floor(NET.reconnectWindowMs / 50) - 2);
    expect(room.players.has(b.p.id)).toBe(true);
    run(4);
    expect(room.players.has(b.p.id)).toBe(false);
    expect(a.tr.text.some((m) => m.t === 'left' && m.id === b.p.id)).toBe(true);
    room.stop();
  });

  it('after the window, the stored session restores the same id and position', async () => {
    const { room, run, join } = makeRoom();
    await join('A');
    const b = await join('B');
    b.p.sim.x += 3;
    const { id, resumeToken } = b.p;
    const x = b.p.sim.x;
    room.disconnect(b.p, b.tr);
    await new Promise((r) => setTimeout(r, 10)); // store.put is async
    run(Math.ceil(NET.reconnectWindowMs / 50) + 2);
    expect(room.players.has(id)).toBe(false);
    const again = await room.join(new FakeTransport(), 'B', sanitizeAvatar({}), resumeToken);
    expect(again.id).toBe(id);
    expect(again.sim.x).toBeCloseTo(x, 6);
    room.stop();
  });

  it('relays voice signaling only between nearby players who joined voice', async () => {
    const { room, join } = makeRoom();
    const a = await join('A');
    const b = await join('B');
    const offer = { t: 'voice' as const, to: b.p.id, kind: 'offer' as const, sdp: 'v=0' };
    room.handleJson(a.p, offer);
    expect(b.tr.text.some((m) => m.t === 'voice')).toBe(false); // nobody joined voice yet
    room.handleJson(a.p, { t: 'voiceState', joined: true, muted: false, speaking: false });
    room.handleJson(b.p, { t: 'voiceState', joined: true, muted: false, speaking: false });
    room.handleJson(a.p, offer);
    expect(b.tr.text.filter((m) => m.t === 'voice')).toHaveLength(1);
    // too far: dropped
    b.p.sim.x = a.p.sim.x + VOICE.relayRadius + 1;
    room.handleJson(a.p, offer);
    expect(b.tr.text.filter((m) => m.t === 'voice')).toHaveLength(1);
    // 'bye' always goes through (so peers can clean up after walking apart)
    room.handleJson(a.p, { t: 'voice', to: b.p.id, kind: 'bye' });
    expect(b.tr.text.filter((m) => m.t === 'voice')).toHaveLength(2);
    room.stop();
  });

  it('drops a disconnected player out of voice for everyone', async () => {
    const { room, join } = makeRoom();
    const a = await join('A');
    const b = await join('B');
    room.handleJson(b.p, { t: 'voiceState', joined: true, muted: false, speaking: true });
    room.disconnect(b.p, b.tr);
    const last = a.tr.text.filter((m) => m.t === 'voiceState').pop();
    expect(last).toMatchObject({ id: b.p.id, joined: false });
    room.stop();
  });
});

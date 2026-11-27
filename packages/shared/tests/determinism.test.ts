/**
 * Client/server determinism: one recorded input sequence runs through
 *   (a) the server path: commands queued and applied in 20 Hz ticks with applyCommand, and
 *   (b) the client path: Predictor (immediate local apply), batched sends, snapshots that arrive 100 ms
 *       late, rewind + replay on every snapshot,
 * and both must end at bit-identical positions. A second run drops packets and checks that the client is
 * corrected to the server's state exactly. A third replays the same commands on a second "server" built
 * from a fresh map instance (two processes must agree).
 */
import { describe, expect, it } from 'vitest';
import { createBeachMapData } from '../src/map/beach';
import { CollisionGrid } from '../src/sim/collision';
import { applyCommand, newPlayerSim, quantizeAxis, type InputCommand, type PlayerSim } from '../src/sim/commands';
import { Predictor } from '../src/sim/prediction';
import { rng } from '../src/util/rng';
import { standHeight } from '../src/map/deck';
import { NET } from '../src/net/constants';

const map = createBeachMapData();
const env = { map, grid: new CollisionGrid(map) };
const STEPS = 20 * 60; // 20 s
const PER_TICK = NET.stepHz / NET.tickRate; // 3 commands per server tick

/** Recorded input: wandering with direction changes, running bursts, click-to-walk-style partial speeds,
 *  and long pushes toward the sea and into props so collisions and sliding are exercised. */
function recordInputs(seed: number): Array<{ x: number; z: number; run: boolean; yaw: number }> {
  const r = rng(seed);
  const out: Array<{ x: number; z: number; run: boolean; yaw: number }> = [];
  let a = r() * Math.PI * 2;
  let mag = 1;
  let run = false;
  for (let i = 0; i < STEPS; i++) {
    if (i % 45 === 0) {
      a += (r() - 0.5) * 2.4;
      mag = r() < 0.2 ? 0.35 + r() * 0.6 : 1;
      run = r() < 0.35;
    }
    const idle = i % 300 > 270;
    out.push({ x: idle ? 0 : Math.sin(a) * mag, z: idle ? 0 : Math.cos(a) * mag, run, yaw: a });
  }
  return out;
}

const spawn = (): PlayerSim => newPlayerSim(map.spawn.x, map.spawn.z, standHeight(map, map.spawn.x, map.spawn.z), map.spawn.facing);

interface Packet {
  deliverAt: number;
  cmds: InputCommand[];
}

/** Runs client + server together. lossEvery: drop every n-th input packet (0 = none). */
function simulate(inputs: ReturnType<typeof recordInputs>, lossEvery = 0) {
  const server = { sim: spawn(), queue: [] as InputCommand[], ack: -1 };
  const client = new Predictor(spawn());
  const toServer: Packet[] = [];
  const toClient: Array<{ deliverAt: number; state: PlayerSim; ack: number }> = [];
  const LAT = 6; // one way, in steps (100 ms)
  const out: InputCommand[] = [];
  let packets = 0;
  let maxError = 0;
  let corrections = 0;
  for (let step = 0; step < STEPS + 60; step++) {
    if (step < STEPS) {
      const inp = inputs[step];
      client.step(inp.x, inp.z, inp.run, inp.yaw, env);
    }
    // send every 3 steps (20 Hz)
    if (step % PER_TICK === PER_TICK - 1) {
      const n = client.takeUnsent(out);
      if (n) {
        packets++;
        // WebSocket is TCP: within a connection nothing is lost; dropped input only happens around a reconnect.
        // Loss is modelled mid-session (not in the last second), the server skips the missing sequence numbers.
        const lost = lossEvery && packets % lossEvery === 0 && step < STEPS - 60;
        if (!lost) toServer.push({ deliverAt: step + LAT, cmds: out.slice(0, n).map((c) => ({ ...c })) });
      }
    }
    // server: receive packets, then tick at 20 Hz
    while (toServer.length && toServer[0].deliverAt <= step) {
      for (const c of toServer.shift()!.cmds) {
        // drop duplicates/old (a resend after loss would repeat sequence numbers)
        if (server.ack >= 0 && ((c.seq - server.ack + 65536) % 65536 === 0 || (c.seq - server.ack + 65536) % 65536 > 32768)) continue;
        server.queue.push(c);
      }
    }
    if (step % PER_TICK === 0) {
      while (server.queue.length) {
        const c = server.queue.shift()!;
        applyCommand(server.sim, c, env);
        server.ack = c.seq;
      }
      toClient.push({ deliverAt: step + LAT, state: { ...server.sim }, ack: server.ack });
    }
    while (toClient.length && toClient[0].deliverAt <= step) {
      const s = toClient.shift()!;
      const err = client.reconcile(s.state, s.ack < 0 ? 0 : s.ack, s.ack >= 0, env);
      maxError = Math.max(maxError, err);
      if (err > 0) corrections++;
    }
  }
  return { server: server.sim, client: client.state, pending: client.pending, maxError, corrections };
}

describe('client prediction vs server authority', () => {
  it('end at bit-identical positions, and prediction is never wrong without loss', () => {
    const inputs = recordInputs(2024);
    const r = simulate(inputs);
    expect(r.pending).toBe(0);
    expect(r.client).toEqual(r.server);
    expect(r.maxError).toBe(0);
    expect(r.corrections).toBe(0);
    // the walk really went somewhere and hit things
    expect(Math.hypot(r.server.x - map.spawn.x, r.server.z - map.spawn.z)).toBeGreaterThan(5);
  });

  it('when input is lost mid-session the server corrects the client, and both still agree exactly', () => {
    const r = simulate(recordInputs(99), 10);
    expect(r.corrections).toBeGreaterThan(0);
    expect(r.pending).toBe(0);
    expect(r.client).toEqual(r.server);
  });

  it('two independently built maps (two processes) give the same result', () => {
    const map2 = createBeachMapData();
    const env2 = { map: map2, grid: new CollisionGrid(map2) };
    const inputs = recordInputs(5);
    const a = spawn();
    const b = spawn();
    for (let i = 0; i < STEPS; i++) {
      const c = { seq: i % 65536, dx: quantizeAxis(inputs[i].x), dz: quantizeAxis(inputs[i].z), run: inputs[i].run, yaw: 0 };
      applyCommand(a, c, env);
      applyCommand(b, c, env2);
    }
    expect(b).toEqual(a);
  });
});

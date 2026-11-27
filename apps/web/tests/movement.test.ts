/**
 * Headless pier movement test (npm run test:movement).
 * Spawns the player on the beach pier and holds every key combination for 4 s at camera yaw -60/0/+60,
 * walking and running, logging the position every 0.25 s. A run FAILS if the player ever leaves the planks
 * anywhere but the shore entrance (i.e. drops into the water from the side or the end of the pier).
 *
 * MOVE_IMPL=legacy runs the original controller for diagnosis.
 */
import { describe, expect, it } from 'vitest';
import { createBeachMap } from '../src/game/maps/beach';
import { CollisionGrid } from '../src/game/systems/CollisionGrid';
import { deckAt, standHeight } from '../src/game/maps/deck';
import { stepMovementLegacy, type MoveState } from '../src/game/engine/controller';
import * as controller from '../src/game/engine/controller';

const LEGACY = process.env.MOVE_IMPL === 'legacy';
const VERBOSE = process.env.MOVE_VERBOSE === '1';
const map = createBeachMap();
const grid = new CollisionGrid(map);
const env = { map, grid };
const step = LEGACY ? stepMovementLegacy : (controller as unknown as { stepMovement: typeof stepMovementLegacy }).stepMovement;

const pier = map.props.find((p) => p.type === 'pier')!;
/** pier-local coordinates: u across (+ = local x), v along (0 = shore end, + = out to sea) */
const toLocal = (x: number, z: number) => {
  const dx = x - pier.x;
  const dz = z - pier.z;
  const c = Math.cos(pier.rot);
  const s = Math.sin(pier.rot);
  return { u: dx * c - dz * s, v: dx * s + dz * c };
};
const fromLocal = (u: number, v: number) => ({
  x: pier.x + u * Math.cos(pier.rot) + v * Math.sin(pier.rot),
  z: pier.z - u * Math.sin(pier.rot) + v * Math.cos(pier.rot),
});

const KEYS: Record<string, [number, number]> = { W: [0, 1], S: [0, -1], A: [-1, 0], D: [1, 0], WA: [-0.707, 0.707], WD: [0.707, 0.707], SA: [-0.707, -0.707], SD: [0.707, -0.707] };
const YAWS = [-60, 0, 60];
const STARTS: Record<string, number> = { entrance: 1.2, middle: 12 };

interface Result {
  name: string;
  fellOff: boolean;
  where: string;
  /** body (centre + radius) hung over the side of the planks */
  overhang: number;
  /** largest single sub-step (m) */
  maxStep: number;
  trace: string[];
}
const R = 0.28;
const W = 2.4;
const L = Number(pier.params.length ?? 24);

function simulate(start: string, key: string, yawDeg: number, run: boolean, dt = 1 / 60): Result {
  const p0 = fromLocal(0, STARTS[start]);
  let s: MoveState = { x: p0.x, z: p0.z, y: standHeight(map, p0.x, p0.z), vx: 0, vz: 0 };
  const [ix, iy] = KEYS[key];
  const yaw = (yawDeg * Math.PI) / 180;
  const trace: string[] = [];
  let wasOn = !!deckAt(map, s.x, s.z);
  let fellOff = false;
  let where = '';
  let overhang = 0;
  let maxStep = 0;
  const frames = Math.round(4 / dt);
  const every = Math.max(1, Math.round(0.25 / dt));
  for (let f = 1; f <= frames; f++) {
    const info = { hitX: false, hitZ: false, substeps: 1 };
    const prev = s;
    s = (step as (...a: unknown[]) => MoveState)(s, { x: ix, y: iy, run, yaw }, dt, env, undefined, info);
    maxStep = Math.max(maxStep, Math.hypot(s.x - prev.x, s.z - prev.z) / info.substeps);
    const on = !!deckAt(map, s.x, s.z);
    const l = toLocal(s.x, s.z);
    // leaving the deck is fine only through the shore end (v near 0, back onto the sand)
    if (wasOn && !on && l.v > 1.0 && !fellOff) {
      fellOff = true;
      where = `t=${(f * dt).toFixed(2)}s at u=${l.u.toFixed(2)} v=${l.v.toFixed(2)} ground=${map.groundHeight(s.x, s.z).toFixed(2)} wade=${map.wadeDepth(s.x, s.z).toFixed(2)}`;
    }
    wasOn = on;
    // on the main span (past the shore entrance) the whole body must stay on the planks
    if (on && l.v > 1.0 && l.v < L - 0.2) overhang = Math.max(overhang, Math.abs(l.u) + R - W / 2);
    if (f % every === 0) trace.push(`t=${(f * dt).toFixed(2)} x=${s.x.toFixed(2)} z=${s.z.toFixed(2)} y=${s.y.toFixed(2)} u=${l.u.toFixed(2)} v=${l.v.toFixed(2)} ${on ? 'deck' : 'OFF'}`);
  }
  return { name: `${start} ${key.padEnd(2)} yaw ${String(yawDeg).padStart(3)} ${run ? 'run ' : 'walk'}`, fellOff, where, overhang, maxStep, trace };
}

describe(`pier movement (${LEGACY ? 'LEGACY controller' : 'current controller'})`, () => {
  const results: Result[] = [];
  for (const start of Object.keys(STARTS)) for (const key of Object.keys(KEYS)) for (const yaw of YAWS) for (const run of [false, true]) results.push(simulate(start, key, yaw, run));

  it('logs every case', () => {
    const cell = grid.cell;
    const pierCells = Math.round(2.4 / cell);
    console.log(`collision cell ${cell} m -> pier is ~${pierCells} cells wide; player radius ${0.28}`);
    for (const r of results) {
      console.log(`${r.fellOff ? 'FELL OFF' : 'ok      '} ${r.name}  overhang ${Math.max(0, r.overhang).toFixed(3)} m  max step ${r.maxStep.toFixed(3)} m${r.fellOff ? `  <- ${r.where}` : ''}`);
      if (VERBOSE || r.fellOff) for (const t of r.trace) console.log(`    ${t}`);
    }
    const bad = results.filter((r) => r.fellOff).length;
    console.log(`\n${bad} / ${results.length} runs left the pier somewhere other than the shore entrance`);
  });

  it('never leaves the planks except through the shore entrance', () => {
    expect(results.filter((r) => r.fellOff).map((r) => `${r.name}: ${r.where}`)).toEqual([]);
  });

  it('keeps the whole collider on the planks (no overhang beyond 6 cm of rounding)', () => {
    expect(results.filter((r) => r.overhang > 0.06).map((r) => `${r.name}: ${r.overhang.toFixed(3)}`)).toEqual([]);
  });

  it('never moves more than half the collider radius in one sub-step, even at 20 fps while running', () => {
    const slow = Object.keys(KEYS).flatMap((k) => YAWS.map((y) => simulate('middle', k, y, true, 1 / 20)));
    expect(slow.filter((r) => r.fellOff || r.overhang > 0.06).map((r) => r.name)).toEqual([]);
    expect(Math.max(...results.map((r) => r.maxStep), ...slow.map((r) => r.maxStep))).toBeLessThanOrEqual(R / 2 + 1e-6);
  });

  it('slides along the pier edge instead of stopping dead when pushing into it at an angle', () => {
    // at yaw 0 the pier runs at ~33 degrees to the screen: D (+x) pushes into its side but has a component along it
    for (const yaw of [0, 60]) {
      const p0 = fromLocal(0, 12);
      let s: MoveState = { x: p0.x, z: p0.z, y: standHeight(map, p0.x, p0.z), vx: 0, vz: 0 };
      for (let f = 0; f < 120; f++) s = (step as (...a: unknown[]) => MoveState)(s, { x: 1, y: 0, run: false, yaw: (yaw * Math.PI) / 180 }, 1 / 60, env);
      const a = toLocal(p0.x, p0.z);
      const b = toLocal(s.x, s.z);
      console.log(`slide test yaw ${yaw}: moved ${Math.abs(b.v - a.v).toFixed(2)} m along the pier, u=${b.u.toFixed(2)}`);
      expect(Math.abs(b.v - a.v)).toBeGreaterThan(1.5);
      expect(deckAt(map, s.x, s.z)).not.toBeNull();
    }
  });

  it('can walk up the ramp from the sand and down again, but not climb on from the water', () => {
    // from the sand in front of the entrance straight up the pier
    const sand = fromLocal(0, -2);
    let s: MoveState = { x: sand.x, z: sand.z, y: standHeight(map, sand.x, sand.z), vx: 0, vz: 0 };
    const along = { dx: Math.sin(pier.rot), dz: Math.cos(pier.rot) };
    for (let f = 0; f < 300; f++) s = (step as (...a: unknown[]) => MoveState)(s, { x: 0, y: 0, run: false, yaw: 0 }, 1 / 60, env, along);
    const top = toLocal(s.x, s.z);
    expect(top.v).toBeGreaterThan(8);
    expect(s.y).toBeGreaterThan(0.7);
    // from the water beside the pier, pushing into its side
    const water = fromLocal(-2.2, 4);
    let w: MoveState = { x: water.x, z: water.z, y: standHeight(map, water.x, water.z), vx: 0, vz: 0 };
    const across = { dx: Math.cos(pier.rot), dz: -Math.sin(pier.rot) };
    for (let f = 0; f < 240; f++) w = (step as (...a: unknown[]) => MoveState)(w, { x: 0, y: 0, run: false, yaw: 0 }, 1 / 60, env, across);
    expect(deckAt(map, w.x, w.z)).toBeNull();
  });
});

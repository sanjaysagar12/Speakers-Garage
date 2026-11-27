import { SIM } from '../config';
import { guardZone, standHeight } from '../map/deck';
import type { MapData } from '../map/types';
import type { CollisionGrid } from './collision';

/**
 * Pure player movement step, shared by the in-game controller and the headless movement test.
 * No three.js objects, no React: state in, state out.
 */
export interface MoveState {
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
}

export interface MoveInput {
  /** -1..1, + = right of the camera */
  x: number;
  /** -1..1, + = away from the camera */
  y: number;
  run: boolean;
  /** camera yaw (0 = looking north / -z) */
  yaw: number;
}

export interface MoveEnv {
  map: MapData;
  grid: CollisionGrid;
}

/** Camera-relative input -> world direction. forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw). */
function inputDirection(inp: MoveInput): { dx: number; dz: number } {
  const dx = Math.cos(inp.yaw) * inp.x - Math.sin(inp.yaw) * inp.y;
  const dz = -Math.sin(inp.yaw) * inp.x - Math.cos(inp.yaw) * inp.y;
  return { dx, dz };
}

/**
 * ORIGINAL behaviour, kept verbatim for the diagnosis test: one unsubdivided axis-separated move per frame,
 * the collision grid is the only constraint (no height/step rule), height applied afterwards.
 */
export function stepMovementLegacy(s: MoveState, inp: MoveInput, dt: number, env: MoveEnv, desired?: { dx: number; dz: number }): MoveState {
  const { map, grid } = env;
  const { dx, dz } = desired ?? inputDirection(inp);
  const wade = map.wadeDepth(s.x, s.z);
  const slow = wade > 0.02 ? SIM.player.shallowMultiplier : 1;
  const speed = (inp.run ? SIM.player.runSpeed : SIM.player.walkSpeed) * slow;
  const k = 1 - Math.exp(-SIM.player.acceleration * dt);
  const out = { ...s };
  out.vx += (dx * speed - out.vx) * k;
  out.vz += (dz * speed - out.vz) * k;
  const r = SIM.player.radius;
  const nx = out.x + out.vx * dt;
  if (!grid.blockedCircle(nx, out.z, r)) out.x = nx;
  else out.vx = 0;
  const nz = out.z + out.vz * dt;
  if (!grid.blockedCircle(out.x, nz, r)) out.z = nz;
  else out.vz = 0;
  const target = standHeight(map, out.x, out.z);
  out.y += (target - out.y) * (1 - Math.exp(-14 * dt));
  return out;
}

const RIM = 24;
/** contact skin: a slide also steps this far off the contact so estimation error never re-blocks it */
const SKIN = 0.004;
const RIM_DIRS = Array.from({ length: RIM }, (_, i) => [Math.cos((i / RIM) * Math.PI * 2), Math.sin((i / RIM) * Math.PI * 2)] as const);

export interface StepInfo {
  /** collision stopped the x / z component this frame */
  hitX: boolean;
  hitZ: boolean;
  substeps: number;
}

/**
 * The movement step used by the game:
 *  - circle collider (radius from config) against the collision grid, checked BEFORE each move
 *  - sliding: the contact normal is estimated from the collider rim points that fail; the move and the
 *    velocity lose only their component into that normal, so edges at any angle slide at full tangential speed
 *  - guarded decks (the pier) have walls on every side except the open shore entrance, at any height
 *  - sub-stepping: no single move is longer than half the radius, so running can never skip a thin boundary
 *  - height rule: a move is refused if the walkable height under the centre OR any point on the collider's
 *    rim differs by more than stepHeight. The pier deck is a real raised surface: the body stays fully on the
 *    planks, can't step on from the water, and enters only up the ramp. Exact for edges at any angle.
 *  - height is sampled every frame and smoothed
 */
export function stepMovement(s: MoveState, inp: MoveInput, dt: number, env: MoveEnv, desired?: { dx: number; dz: number }, info?: StepInfo): MoveState {
  const { map, grid } = env;
  const P = SIM.player;
  const { dx, dz } = desired ?? inputDirection(inp);
  const wade = map.wadeDepth(s.x, s.z);
  const slow = wade > 0.02 ? P.shallowMultiplier : 1;
  const speed = (inp.run ? P.runSpeed : P.walkSpeed) * slow;
  const k = 1 - Math.exp(-P.acceleration * dt);
  const out = { ...s };
  out.vx += (dx * speed - out.vx) * k;
  out.vz += (dz * speed - out.vz) * k;

  const r = P.radius;
  const travel = Math.hypot(out.vx, out.vz) * dt;
  const n = Math.max(1, Math.ceil(travel / (r / 2)));
  const sx = (out.vx * dt) / n;
  const sz = (out.vz * dt) / n;
  let h = standHeight(map, out.x, out.z);
  const here = guardZone(map, out.x, out.z);
  /** Returns null if the body fits at (x,z); otherwise an outward contact normal (unnormalised). */
  const probe = (x: number, z: number): [number, number] | null => {
    let nx = 0;
    let nz = 0;
    let hit = false;
    const nh = standHeight(map, x, z);
    const centreBad = grid.blockedCircle(x, z, r, false) || Math.abs(nh - h) > P.stepHeight;
    const g = guardZone(map, x, z);
    const cDeck = g.deck ?? (here.deck && g.entrance === here.deck ? here.deck : null);
    for (let i = 0; i < RIM; i++) {
      const [dxr, dzr] = RIM_DIRS[i];
      const px = x + dxr * r;
      const pz = z + dzr * r;
      let bad = Math.abs(standHeight(map, px, pz) - nh) > P.stepHeight || grid.blockedCircle(px, pz, 0.02, false);
      if (!bad && (here.deck || g.deck)) {
        // guarded deck sides are walls at any height: a rim point may only leave the deck through its entrance
        const pg = guardZone(map, px, pz);
        const pDeck = pg.deck ?? null;
        const ref = cDeck ?? here.deck;
        if (ref && pDeck !== ref && pg.entrance !== ref) bad = true;
        if (!ref && pDeck && !(g.entrance === pDeck)) bad = true;
      }
      if (bad) {
        nx -= dxr;
        nz -= dzr;
        hit = true;
      }
    }
    if (!hit && !centreBad) return null;
    if (!hit) {
      // centre-only failure (a step): push back against the move
      nx = -(x - out.x);
      nz = -(z - out.z);
    }
    return [nx, nz];
  };
  let hitX = false;
  let hitZ = false;
  for (let i = 0; i < n; i++) {
    let mx = sx;
    let mz = sz;
    for (let attempt = 0; attempt < 3 && (mx !== 0 || mz !== 0); attempt++) {
      const c = probe(out.x + mx, out.z + mz);
      if (!c) {
        out.x += mx;
        out.z += mz;
        break;
      }
      // slide: remove the component of the move (and velocity) going into the contact normal
      const l = Math.hypot(c[0], c[1]) || 1;
      const nx = c[0] / l;
      const nz = c[1] / l;
      const into = mx * nx + mz * nz;
      if (into < 0) {
        mx -= into * nx - SKIN * nx;
        mz -= into * nz - SKIN * nz;
      } else {
        mx = SKIN * nx;
        mz = SKIN * nz;
      }
      const vin = out.vx * nx + out.vz * nz;
      if (vin < 0) {
        out.vx -= vin * nx;
        out.vz -= vin * nz;
      }
      hitX = hitX || Math.abs(nx) > 0.3;
      hitZ = hitZ || Math.abs(nz) > 0.3;
      if (Math.hypot(mx, mz) < 1e-5) {
        mx = 0;
        mz = 0;
      }
    }
    h = standHeight(map, out.x, out.z);
  }
  out.y += (h - out.y) * (1 - Math.exp(-14 * dt));
  if (info) Object.assign(info, { hitX, hitZ, substeps: n });
  return out;
}

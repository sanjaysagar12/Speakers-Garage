import { SIM } from '../config';
import { NET } from '../net/constants';
import { stepMovement, type MoveEnv } from './step';

/**
 * The fixed-step command layer. Both the client (prediction + replay) and the server (authority) advance a
 * player ONLY through applyCommand, one command per 1/60 s step, so for the same commands and the same map
 * they produce bit-identical positions. dt is not part of a command: a client-chosen dt would be a speed hack.
 */
export const STEP_DT = 1 / NET.stepHz;

/** Authoritative player state. */
export interface PlayerSim {
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  /** body yaw, radians (0 = facing +z) */
  facing: number;
}

/** One movement step of input. Directions are quantized to int8 BEFORE use, on both sides. */
export interface InputCommand {
  /** u16 sequence number (wraps) */
  seq: number;
  /** desired world-space direction, -127..127 each (length ≤ 127; less = slower, for click-to-walk easing) */
  dx: number;
  dz: number;
  run: boolean;
  /** camera yaw, u16 (informational: listener orientation; not used by the simulation) */
  yaw: number;
}

export const newPlayerSim = (x: number, z: number, y: number, facing = 0): PlayerSim => ({ x, z, y, vx: 0, vz: 0, facing });

/** -1..1 -> int8 (-127..127). */
export const quantizeAxis = (v: number): number => Math.max(-127, Math.min(127, Math.round(v * 127)));
/** radians -> u16 */
export const quantizeYaw = (a: number): number => (Math.round((a / (Math.PI * 2)) * 65536) % 65536 + 65536) % 65536;
export const dequantizeYaw = (q: number): number => (q / 65536) * Math.PI * 2;

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Turn the body toward the movement direction (no snapping). Returns the turn rate (rad/s) for animation. */
export function integrateFacing(s: PlayerSim, dt: number): number {
  const hs = Math.hypot(s.vx, s.vz);
  if (hs <= 0.15) return 0;
  const target = Math.atan2(s.vx, s.vz);
  const diff = wrapAngle(target - s.facing);
  const step = Math.sign(diff) * Math.min(Math.abs(diff), SIM.player.turnSpeed * dt * (0.5 + Math.min(1, Math.abs(diff))));
  s.facing = wrapAngle(s.facing + step);
  return step / Math.max(dt, 1e-4);
}

/** Advance one fixed step. Mutates `s`; returns the turn rate. Identical on client and server. */
export function applyCommand(s: PlayerSim, cmd: Readonly<InputCommand>, env: MoveEnv): number {
  let dx = Math.max(-127, Math.min(127, cmd.dx | 0)) / 127;
  let dz = Math.max(-127, Math.min(127, cmd.dz | 0)) / 127;
  const l = Math.hypot(dx, dz);
  if (l > 1) {
    dx /= l;
    dz /= l;
  }
  const next = stepMovement(s, { x: 0, y: 0, run: !!cmd.run, yaw: 0 }, STEP_DT, env, { dx, dz });
  s.x = next.x;
  s.z = next.z;
  s.y = next.y;
  s.vx = next.vx;
  s.vz = next.vz;
  return integrateFacing(s, STEP_DT);
}

/** Animation state byte: bit0 moving, bit1 running, bit2 wading, bits 4-7 emote (0 = none, 1 + EMOTES index). */
export const ANIM = { moving: 1, running: 2, wading: 4 } as const;

export function animByte(s: PlayerSim, run: boolean, wade: number, emote: number): number {
  const hs = Math.hypot(s.vx, s.vz);
  let a = 0;
  if (hs > 0.2) a |= ANIM.moving;
  if (run && hs > SIM.player.walkSpeed * (wade > 0.02 ? SIM.player.shallowMultiplier : 1) * 1.05) a |= ANIM.running;
  if (wade > 0.05) a |= ANIM.wading;
  return a | ((emote & 15) << 4);
}

/** u16 sequence comparison with wrap-around: is a newer than b? */
export const seqNewer = (a: number, b: number): boolean => {
  const d = (a - b + 65536) % 65536;
  return d > 0 && d < 32768;
};

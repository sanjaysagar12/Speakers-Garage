/**
 * Single source of truth for tunable constants. World units are metres: x = east, z = south, y = up.
 * Map "north" is -z, and the default camera yaw looks north.
 */
export const GAME_CONFIG = {
  player: {
    walkSpeed: 3.4,
    runSpeed: 6.4,
    shallowMultiplier: 0.55,
    /** units/s² style responsiveness of the velocity filter */
    acceleration: 11,
    /** radians/s the body turns toward the movement direction */
    turnSpeed: 10,
    /** collider: circle approximated by a square half-extent */
    radius: 0.28,
    /** largest height change walkable in one step (deck edges are taller; ramps are not) */
    stepHeight: 0.4,
    height: 1.7,
    stride: { walk: 1.25, run: 2.1 },
  },

  camera: {
    fov: 38,
    pitchDeg: 55,
    pitchMinDeg: 45,
    pitchMaxDeg: 65,
    distance: 16,
    distanceMin: 10.5,
    distanceMax: 21,
    yawLimitDeg: 60,
    /** follow smoothing (1/s) */
    followLerp: 6,
    rotateLerp: 8,
    /** metres of look-ahead at full run speed */
    lookAhead: 1.6,
    keyYawSpeedDeg: 90,
  },

  collision: {
    cell: 0.25,
    pathCell: 0.5,
  },

  effects: {
    maxFootprints: 64,
    footprintLife: 9,
    maxRipples: 24,
    maxParticles: 160,
  },

  wind: {
    base: 0.35,
    gust: 0.55,
    /** direction the wind blows toward, radians in the xz plane (toward south-east, with the shadows) */
    angle: 0.55,
  },

  dayCycle: {
    /** seconds for midday -> golden hour -> sunset -> back */
    cycleSeconds: 240,
  },

  net: { sendIntervalMs: 100 },
  ui: { positionPublishMs: 80 },
} as const;

export type Quality = 'low' | 'med' | 'high';

export interface QualityProfile {
  shadowMapSize: number;
  shadowExtent: number;
  dpr: [number, number];
  grain: number;
  sparkles: number;
  propDensity: number;
  post: boolean;
  bloom: boolean;
  stipple: boolean;
}

export const QUALITY: Record<Quality, QualityProfile> = {
  low: { shadowMapSize: 1024, shadowExtent: 15, dpr: [1, 1], grain: 0.0, sparkles: 0.45, propDensity: 0.45, post: false, bloom: false, stipple: false },
  med: { shadowMapSize: 2048, shadowExtent: 19, dpr: [1, 1.5], grain: 0.6, sparkles: 0.75, propDensity: 0.75, post: true, bloom: true, stipple: true },
  high: { shadowMapSize: 4096, shadowExtent: 22, dpr: [1, 2], grain: 1.0, sparkles: 1.0, propDensity: 1.0, post: true, bloom: true, stipple: true },
};

export const DEG = Math.PI / 180;

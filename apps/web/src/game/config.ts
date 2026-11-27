import { DEG, SIM } from '@shoreline/shared';

/**
 * Single source of truth for tunable constants. World units are metres: x = east, z = south, y = up.
 * Map "north" is -z, and the default camera yaw looks north.
 */
export const GAME_CONFIG = {
  /** movement constants come from the shared simulation (the server runs the same numbers) */
  player: {
    ...SIM.player,
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

  collision: SIM.collision,

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
  /** HUD / minimap position updates: ~8 Hz is plenty and keeps React out of the frame loop */
  ui: { positionPublishMs: 125 },
} as const;

/** Rendering tiers, lowest to highest. 'auto' (the default setting) lets detection + the governor pick. */
export type Quality = 'ultralow' | 'low' | 'med' | 'high';
export const QUALITY_ORDER: Quality[] = ['ultralow', 'low', 'med', 'high'];
export type QualityMode = Quality | 'auto';

export interface QualityProfile {
  label: string;
  /** device-pixel-ratio range; the governor lowers DPR inside it before dropping a tier */
  dpr: [number, number];
  /** 0 = no shadow map */
  shadowMapSize: number;
  /** half-size of the shadow box around the player (shadow distance) */
  shadowExtent: number;
  /** tiny props (shells, flip-flops, starfish, stools) cast shadows */
  smallShadows: boolean;
  /** fraction of small decoration kept (shells, pebbles, flowers, grass) */
  propDensity: number;
  /** prop chunks beyond this distance (m) are not rendered */
  viewDistance: number;
  /** palms beyond this distance use the low-detail mesh */
  lodDistance: number;
  /** ground mesh vertices per metre */
  groundRes: 0.5 | 1;
  /** 'none' | 'fxaa' (cheap AA only) | 'full' (MSAA + grain + bloom + vignette + grade) */
  post: 'none' | 'fxaa' | 'full';
  /** warm grade applied inside the world shaders (used when there is no post pass) */
  gradeInShader: boolean;
  /** film grain / stipple strength in the world shaders */
  grain: number;
  /** water: 0 = depth bands + main foam, 1 = + second foam line, sparkles, fragments, 2 = + lace foam and ripple lines */
  waterDetail: 0 | 1 | 2;
  sparkles: number;
  cloudShadows: boolean;
  /** caps for pooled effects and ambient life */
  particles: number;
  drift: number;
  gulls: number;
  crabs: number;
  smoke: boolean;
  /** characters / creatures beyond this distance animate at a reduced rate */
  animDistance: number;
}

export const QUALITY: Record<Quality, QualityProfile> = {
  ultralow: {
    label: 'Ultra-Low', dpr: [0.6, 1], shadowMapSize: 0, shadowExtent: 0, smallShadows: false, propDensity: 0.3, viewDistance: 45, lodDistance: 18, groundRes: 0.5,
    post: 'none', gradeInShader: true, grain: 0, waterDetail: 0, sparkles: 0, cloudShadows: false, particles: 40, drift: 0, gulls: 0, crabs: 0, smoke: false, animDistance: 20,
  },
  low: {
    label: 'Low', dpr: [0.75, 1], shadowMapSize: 512, shadowExtent: 14, smallShadows: false, propDensity: 0.5, viewDistance: 60, lodDistance: 28, groundRes: 1,
    post: 'fxaa', gradeInShader: true, grain: 0.3, waterDetail: 1, sparkles: 0.45, cloudShadows: false, particles: 80, drift: 20, gulls: 3, crabs: 4, smoke: true, animDistance: 30,
  },
  med: {
    label: 'Medium', dpr: [1, 1.5], shadowMapSize: 1024, shadowExtent: 19, smallShadows: true, propDensity: 0.8, viewDistance: 95, lodDistance: 45, groundRes: 1,
    post: 'full', gradeInShader: false, grain: 0.6, waterDetail: 2, sparkles: 0.75, cloudShadows: true, particles: 160, drift: 60, gulls: 5, crabs: 9, smoke: true, animDistance: 45,
  },
  high: {
    label: 'High', dpr: [1, 2], shadowMapSize: 2048, shadowExtent: 22, smallShadows: true, propDensity: 1, viewDistance: 220, lodDistance: 70, groundRes: 1,
    post: 'full', gradeInShader: false, grain: 1, waterDetail: 2, sparkles: 1, cloudShadows: true, particles: 160, drift: 90, gulls: 7, crabs: 9, smoke: true, animDistance: 70,
  },
};

/** Governor: FPS below `down` for `downSeconds` -> lower DPR, then the tier; above `up` for `upSeconds` -> one step up. */
export const GOVERNOR = { down: 45, up: 58, downSeconds: 3, upSeconds: 10, cooldownSeconds: 8, maxFlips: 4 };

export { DEG };

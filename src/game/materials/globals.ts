import { Color, Vector3, Vector4 } from 'three';
import { GAME_CONFIG } from '../config';

/**
 * Uniform objects shared by reference across every world material, so one write per frame updates
 * the sun, wind, clouds and time for the whole scene.
 */
export const G = {
  uTime: { value: 0 },
  /** world-space unit vector pointing toward the sun */
  uSunDir: { value: new Vector3(-0.5, 1.0, -0.28).normalize() },
  /** multiplies lit colour; white at midday, warm at golden hour */
  uSunColor: { value: new Color(1, 1, 1) },
  /** what near-white surfaces turn into in shade (light grey-teal, never grey) */
  uShadeTint: { value: new Color('#A9C7D0') },
  /** x,z: direction the wind blows toward; y: strength 0..1 */
  uWind: { value: new Vector3(Math.cos(GAME_CONFIG.wind.angle), GAME_CONFIG.wind.base, Math.sin(GAME_CONFIG.wind.angle)) },
  /** x,z offset of the drifting cloud field, z: shadow amount, w: noise frequency */
  uCloud: { value: new Vector4(0, 0, 0.32, 0.018) },
  uGrain: { value: 1 },
  uSparkle: { value: 1 },
  /** 0 at midday, 1 at sunset: used by water and foam colour grading */
  uWarm: { value: 0 },
};

export type GlobalUniforms = typeof G;

import { Color, DataTexture, LinearFilter, RedFormat, RepeatWrapping, Vector3, Vector4 } from 'three';
import { GAME_CONFIG } from '../config';

/** 256x256 tileable random lattice, sampled with smoothstep-remapped bilinear filtering = value noise in one fetch. */
function makeNoiseTexture(): DataTexture {
  const N = 256;
  const data = new Uint8Array(N * N);
  let s = 1234567;
  for (let i = 0; i < data.length; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    data[i] = s >>> 24;
  }
  const t = new DataTexture(data, N, N, RedFormat);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

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
  /** 1 when there is no post pass: the warm colour grade is applied inside the world shaders instead */
  uGradeBaked: { value: 0 },
  /** shared noise lattice (replaces procedural value noise in every world shader) */
  uNoise: { value: makeNoiseTexture() },
};

export type GlobalUniforms = typeof G;

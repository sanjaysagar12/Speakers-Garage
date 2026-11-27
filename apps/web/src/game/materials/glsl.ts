/** GLSL shared by the toon, ground and depth materials. */

export const GLOBALS_GLSL = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uShadeTint;
uniform vec3 uWind;
uniform vec4 uCloud;
uniform float uGrain;
uniform float uSparkle;
uniform float uWarm;
uniform float uGradeBaked;
`;

export const NOISE_GLSL = /* glsl */ `
uniform sampler2D uNoise;
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  // value noise from the shared 256^2 lattice texture: smoothstep-remapped coordinates make the hardware
  // bilinear filter interpolate like the old hash version, with one fetch instead of four hashes
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return texture2D(uNoise, (i + f + 0.5) / 256.0).r;
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return v;
}
`;

export const COLOR_GLSL = /* glsl */ `
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
/** The shade tone of a surface colour: darker and more saturated, near-whites go cool grey-teal. */
vec3 shadeOf(vec3 c) {
  vec3 h = rgb2hsv(c);
  float hue = h.x;
  // warm hues lean a touch toward red-orange in shade, cool hues toward blue
  hue += (hue < 0.2 || hue > 0.9) ? -0.012 : 0.01;
  vec3 sat = hsv2rgb(vec3(fract(hue), clamp(h.y * 1.22 + 0.06, 0.0, 1.0), h.z * 0.66));
  vec3 cool = c * uShadeTint;
  return mix(cool, sat, smoothstep(0.08, 0.3, h.y));
}
float cloudShadow(vec2 xz) {
  if (uCloud.z <= 0.0) return 1.0;
  float n = fbm((xz + uCloud.xy) * uCloud.w);
  return 1.0 - uCloud.z * smoothstep(0.6, 0.64, n);
}
/** The post pass's warm grade, for tiers without post-processing (same maths, applied in the material). */
vec3 bakedGrade(vec3 c) {
  if (uGradeBaked < 0.5) return c;
  c *= vec3(1.025, 1.0, 0.955);
  float g = dot(c, vec3(0.3333));
  c = mix(vec3(g), c, 1.07);
  return mix(c, c * vec3(1.1, 0.94, 0.82), uWarm * 0.45);
}
/** screen-space stipple: 1 where a darker speck should go */
float stipple(float density) {
  if (uGrain <= 0.0) return 0.0;
  float g = hash12(floor(gl_FragCoord.xy / 1.5));
  return step(1.0 - density, g);
}
`;

/** World-space wind displacement shared by the toon vertex shader and the depth material. */
export const SWAY_GLSL = /* glsl */ `
vec3 windDisp(vec3 originW, float w, float amp) {
  float ph = dot(originW.xz, vec2(0.37, 0.71));
  float gust = 0.5 + 0.5 * sin(uTime * 0.9 + ph * 0.6) * sin(uTime * 0.37 + ph * 0.23);
  float s = uWind.y * (0.55 + 0.9 * gust);
  float flutter = sin(uTime * 5.3 + ph * 3.1 + w * 2.6);
  vec2 dir = uWind.xz;
  vec2 h = dir * s * (0.8 + 0.2 * flutter) * w * amp;
  float lift = flutter * 0.06 * w * amp * (0.4 + s);
  return vec3(h.x, lift - 0.25 * length(h) * w, h.y);
}
`;

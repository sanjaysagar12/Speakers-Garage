import { Color, ShaderMaterial, UniformsLib, UniformsUtils, Vector4, type DataTexture } from 'three';
import { G } from '../../materials/globals';
import { COLOR_GLSL, GLOBALS_GLSL, NOISE_GLSL } from '../../materials/glsl';
import { PAL } from '../../models/palette';

const VERT = /* glsl */ `
#include <common>
#include <shadowmap_pars_vertex>
varying vec3 vWorld;
void main() {
  #include <beginnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <project_vertex>
  #include <worldpos_vertex>
  #include <shadowmap_vertex>
  vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
${GLOBALS_GLSL}
${NOISE_GLSL}
${COLOR_GLSL}
uniform sampler2D uField;
uniform vec4 uFieldRect;
uniform vec3 cSand;
uniform vec3 cSandBand;
uniform vec3 cDamp;
uniform vec3 cFoam;
uniform vec3 cShallow;
uniform vec3 cTeal;
uniform vec3 cDeep;
uniform vec3 cDeepest;
uniform vec3 cGrass;
uniform vec3 cGrassDark;
uniform vec3 cRock;
varying vec3 vWorld;

vec2 voronoi(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash22(n + g);
      o = 0.5 + 0.45 * sin(uTime * 0.5 + 6.2831 * o);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  return vec2(sqrt(f1), sqrt(f2));
}
float aastep(float threshold, float value) {
  float w = max(fwidth(value) * 0.75, 1e-4);
  return smoothstep(threshold - w, threshold + w, value);
}
/** dithered (stippled) transition from a to a + width */
float stipBand(float v, float a, float width, vec2 cell) {
  float k = clamp((v - a) / width, 0.0, 1.0);
  return step(hash12(cell), k);
}

void main() {
  vec2 xz = vWorld.xz;
  vec4 F = texture2D(uField, (xz - uFieldRect.xy) / uFieldRect.zw);
  float d = F.r;
  float s = F.g;
  float t = uTime;
  vec2 cell = floor(xz * 11.0);

  // ---- waves: the waterline (in shore-distance units) advances and retreats, phase varies along the shore
  float ph = t * 0.45 - s * 0.07;
  float swl = 0.5 + 0.5 * sin(ph);
  swl = swl * swl * (3.0 - 2.0 * swl);
  float wob = (vnoise(vec2(s * 0.45, t * 0.25)) - 0.5) * 0.9 + 0.25 * sin(s * 1.3 + t * 0.7);
  float edge = mix(-1.0, 1.7, swl) + wob;
  float lag = 0.5 + 0.5 * sin(ph - 1.2);
  lag = lag * lag * (3.0 - 2.0 * lag);
  float wetLine = max(edge, mix(-1.0, 1.7, lag) + wob) + 0.7;

  // ---- land
  float bands = vnoise(xz * 0.045 + vec2(3.1, 7.7)) * 0.65 + vnoise(xz * 0.12) * 0.35;
  vec3 land = mix(cSand, cSandBand, aastep(0.62, bands) * 0.55);
  float g1 = hash12(cell);
  land = mix(land, cSandBand * 0.93, step(0.965, g1) * 0.6);
  float damp = 1.0 - aastep(wetLine, d);
  float nearW = 1.0 - smoothstep(edge, edge + 1.4, d);
  land = mix(land, cDamp, damp * 0.78);
  land = mix(land, cDamp * 0.9, nearW * damp * 0.5);
  float gEdge = F.b + (vnoise(xz * 0.9) - 0.5) * 0.35;
  float gm = aastep(0.5, gEdge);
  vec3 grassCol = mix(cGrass, cGrassDark, aastep(0.58, vnoise(xz * 0.35 + 9.0)) * 0.6);
  grassCol = mix(grassCol, cGrassDark, step(0.93, g1) * 0.7);
  land = mix(land, grassCol, gm);
  float rEdge = F.a + (vnoise(xz * 0.7 + 4.0) - 0.5) * 0.4;
  land = mix(land, mix(cRock, cRock * 0.86, step(0.6, vnoise(xz * 1.7))), aastep(0.5, rEdge));

  // ---- water: stippled depth bands
  float wd = -d;
  float jitter = (vnoise(xz * 0.25 + t * 0.03) - 0.5) * 1.6;
  vec3 water = cShallow;
  water = mix(water, cTeal, stipBand(wd + jitter, 1.6, 2.6, cell));
  water = mix(water, cDeep, stipBand(wd + jitter * 1.5, 8.5, 4.5, cell + 17.0));
  water = mix(water, cDeepest, stipBand(wd + jitter * 2.0, 20.0, 8.0, cell + 31.0));
  #if WATER_DETAIL >= 2
  // ripple lines drifting along the shore
  vec2 sp = vec2(s * 0.08 + t * 0.012, wd * 0.22 + vnoise(vec2(s * 0.05, wd * 0.1)) * 1.4);
  float rl = abs(fract(sp.y * 1.3 + vnoise(sp * 1.7) * 0.8) - 0.5);
  float rip = (1.0 - aastep(0.035, rl)) * step(0.62, vnoise(vec2(s * 0.18, wd * 0.12) + t * 0.02)) * smoothstep(3.0, 6.0, wd);
  water = mix(water, mix(water, cFoam, 0.5), rip);
  #endif

  // ---- foam
  float fw = 0.9 + 0.7 * vnoise(vec2(s * 0.6, t * 0.3));
  #if WATER_DETAIL >= 2
  vec2 vor = voronoi(xz * 0.9 + vec2(t * 0.05, 0.0));
  float lace = 1.0 - aastep(0.06 + 0.06 * smoothstep(edge - fw - 3.5, edge - fw, d), vor.y - vor.x);
  float laceZone = smoothstep(edge - fw - 4.0, edge - fw - 0.2, d);
  #else
  vec2 vor = vec2(0.4, 1.0);
  float lace = 0.0;
  float laceZone = 0.0;
  #endif
  #if WATER_DETAIL >= 1
  float l2 = -7.0 + 1.1 * sin(ph * 0.8 + 1.7) + (vnoise(vec2(s * 0.3, t * 0.2)) - 0.5) * 1.6;
  float line2 = (1.0 - aastep(0.16, abs(d - l2))) * step(0.38, vnoise(vec2(s * 0.35, t * 0.15) + 5.0));
  float frag = aastep(0.82, vnoise(xz * 1.4 + vec2(t * 0.06, -t * 0.03))) * smoothstep(-9.0, -3.0, d) * (1.0 - smoothstep(-2.0, 0.0, d - edge + fw));
  #else
  float line2 = 0.0;
  float frag = 0.0;
  #endif
  float inner = edge - fw + (vor.x - 0.4) * 0.35;
  float band = aastep(inner, d) * (1.0 - aastep(edge, d));
  float foam = max(max(line2, band), max(lace * laceZone, frag));

  float isWater = 1.0 - aastep(edge, d);
  vec3 col = mix(land, water, isWater);
  col = mix(col, cFoam * 1.06, foam * isWater);

  // ---- sparkles: 4-point stars that twinkle on open water
  #if WATER_DETAIL >= 1
  vec2 sc = xz / 2.4;
  vec2 ci = floor(sc);
  vec2 cf = fract(sc) - 0.5 - (hash22(ci) - 0.5) * 0.6;
  float on = step(1.0 - 0.32 * uSparkle, hash12(ci + 7.3));
  float tw = pow(max(0.0, sin(t * 1.7 + hash12(ci) * 40.0)), 10.0) * on * smoothstep(1.5, 4.0, wd);
  vec2 q = abs(cf) * 2.4;
  float L = 0.42 * tw + 1e-3;
  float star = max(1.0 - aastep(0.024 * (1.0 - q.x / L), q.y), 1.0 - aastep(0.024 * (1.0 - q.y / L), q.x));
  star *= step(q.x, L) * step(q.y, L) * step(0.02, tw);
  #else
  float star = 0.0;
  #endif

  // ---- shadows: a darker tone of whatever they fall on
  float sh = getShadowMask() * cloudShadow(xz);
  sh = smoothstep(0.35, 0.65, sh);
  vec3 shade = shadeOf(col);
  shade = mix(shade, mix(col, cDeepest, 0.5), isWater * (1.0 - foam));
  col = mix(shade, col, sh);
  col *= 1.0 - 0.08 * uGrain * (1.0 - sh) * stipple(0.3);
  col *= uSunColor;
  col += vec3(2.4) * star * sh * mix(vec3(1.0), uSunColor, 0.5);
  gl_FragColor = vec4(bakedGrade(col), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function makeBeachGroundMaterial(field: DataTexture, rect: [number, number, number, number], waterDetail: 0 | 1 | 2 = 2): ShaderMaterial {
  const c = (h: string) => ({ value: new Color(h) });
  return new ShaderMaterial({
    name: 'beach-ground',
    uniforms: {
      ...UniformsUtils.clone(UniformsLib.lights),
      ...G,
      uField: { value: field },
      uFieldRect: { value: new Vector4(...rect) },
      cSand: c(PAL.sand),
      cSandBand: c(PAL.sandBand),
      cDamp: c(PAL.sandDamp),
      cFoam: c(PAL.foam),
      cShallow: c(PAL.shallow),
      cTeal: c(PAL.teal),
      cDeep: c(PAL.deep),
      cDeepest: c(PAL.deepest),
      cGrass: c(PAL.grass),
      cGrassDark: c(PAL.grassDark),
      cRock: c(PAL.rock),
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    defines: { WATER_DETAIL: waterDetail },
    lights: true,
  });
}

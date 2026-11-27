import {
  Color,
  DoubleSide,
  FrontSide,
  MeshDepthMaterial,
  RGBADepthPacking,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  type ColorRepresentation,
  type Material,
  type Mesh,
  type Object3D,
  Vector3,
} from 'three';
import { G } from './globals';
import { COLOR_GLSL, GLOBALS_GLSL, NOISE_GLSL, SWAY_GLSL } from './glsl';

/**
 * Procedural stripe patterns, evaluated in the geometry's own "pattern space" (attribute `aPat`, which
 * the model builder fills with each part's pre-transform position so merging never breaks a pattern).
 *  radial  - alternating panels around the local Y axis (umbrella canopies, beach balls, pool rings)
 *  rings   - concentric rings around the local Y axis
 *  mixed   - panels XOR rings
 *  stripes - bands across local X (towels, loungers)
 *  bands   - horizontal bands along local Y (lighthouse, buoy)
 *  grid    - net: only the lines are drawn, the rest is discarded
 */
export type Pattern = 'none' | 'radial' | 'rings' | 'mixed' | 'stripes' | 'bands' | 'grid';

export interface ToonOpts {
  /** multiplies vertex colours (white by default) */
  color?: ColorRepresentation;
  /** second pattern colour */
  colorB?: ColorRepresentation;
  /** back-face colour for double-sided cards (palm frond undersides) */
  back?: ColorRepresentation;
  pattern?: Pattern;
  freq?: number;
  offset?: number;
  /** fraction of each period painted with colorB */
  duty?: number;
  /** wind sway amplitude; the per-vertex weight comes from attribute aSway (or height, see swayByHeight) */
  sway?: number;
  /** use local Y * this as the sway weight instead of aSway (instanced grass) */
  swayByHeight?: number;
  unlit?: boolean;
  /** HDR multiplier for unlit colours (>1 blooms) */
  emissive?: number;
  double?: boolean;
  /** faceted normals from screen derivatives (rocks) */
  flat?: boolean;
  transparent?: boolean;
  opacity?: number;
  /** how strongly the shade band stipples (0..1) */
  grain?: number;
  /** enable the per-material uSwing offset (unique materials only) */
  swing?: boolean;
  /** geometry merged from several props: sway phase comes from the aOrigin attribute */
  merged?: boolean;
}

const VERT = /* glsl */ `
#include <common>
#include <color_pars_vertex>
#include <shadowmap_pars_vertex>
#include <skinning_pars_vertex>
${GLOBALS_GLSL}
${SWAY_GLSL}
attribute vec3 aPat;
#if defined(SWAY) || defined(SWING)
attribute float aSway;
#endif
#ifdef MERGED
/** world origin of the prop this vertex came from (props merged per chunk keep their own sway phase) */
attribute vec3 aOrigin;
#endif
#ifdef SWAY
uniform float uSwayAmp;
uniform float uSwayH;
#endif
#ifdef SWING
uniform vec3 uSwing;
#endif
varying vec3 vPat;
varying vec3 vWorld;
varying vec3 vWN;
void main() {
  #include <color_vertex>
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  mat4 M = modelMatrix;
  #ifdef USE_INSTANCING
  M = modelMatrix * instanceMatrix;
  #endif
  #ifdef SWAY
  #ifdef SWAY_BY_HEIGHT
  float sw = max(position.y, 0.0) * uSwayH;
  #else
  float sw = aSway;
  #endif
  #ifdef MERGED
  vec3 swOrigin = aOrigin;
  #else
  vec3 swOrigin = M[3].xyz;
  #endif
  transformed += inverse(mat3(M)) * windDisp(swOrigin, sw, uSwayAmp);
  #endif
  #ifdef SWING
  // movement-driven secondary motion (hair, scarf tails): a local-space offset weighted by aSway
  transformed += uSwing * aSway * aSway;
  #endif
  // characters are skinned meshes: bones move the (rest-pose) model after the secondary motion
  #include <skinning_vertex>
  #include <project_vertex>
  #include <worldpos_vertex>
  #include <shadowmap_vertex>
  vWorld = (M * vec4(transformed, 1.0)).xyz;
  vWN = normalize(inverseTransformDirection(transformedNormal, viewMatrix));
  vPat = aPat;
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <packing>
#include <color_pars_fragment>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
${GLOBALS_GLSL}
${NOISE_GLSL}
${COLOR_GLSL}
uniform vec3 uColor;
uniform vec3 uColorB;
uniform vec3 uBack;
uniform float uFreq;
uniform float uOffset;
uniform float uDuty;
uniform float uEmissive;
uniform float uOpacity;
uniform float uGrainMat;
varying vec3 vPat;
varying vec3 vWorld;
varying vec3 vWN;

float sq(float t, float w, float duty) {
  float f = fract(t);
  float inside = f < duty ? min(f, duty - f) : -min(f - duty, 1.0 - f);
  return smoothstep(-w, w, inside);
}

void main() {
  vec3 base = uColor;
  #if defined(PAT_RADIAL) || defined(PAT_MIXED)
  float r = max(length(vPat.xz), 1e-4);
  float ta = (atan(vPat.z, vPat.x) / 6.2831853) * uFreq + uOffset;
  float wa = max((fwidth(vPat.x) + fwidth(vPat.z)) / r / 6.2831853 * uFreq, 1e-4);
  float pr = sq(ta, wa, uDuty);
  #ifdef PAT_MIXED
  float tr = r * uFreq * 0.55;
  float prr = sq(tr, max(fwidth(tr), 1e-4), 0.5);
  pr = abs(pr - prr);
  #endif
  base = mix(uColor, uColorB, pr);
  #endif
  #ifdef PAT_RINGS
  float tr2 = length(vPat.xz) * uFreq + uOffset;
  base = mix(uColor, uColorB, sq(tr2, max(fwidth(tr2), 1e-4), uDuty));
  #endif
  #ifdef PAT_STRIPES
  float ts = vPat.x * uFreq + uOffset;
  base = mix(uColor, uColorB, sq(ts, max(fwidth(ts), 1e-4), uDuty));
  #endif
  #ifdef PAT_BANDS
  float tb = vPat.y * uFreq + uOffset;
  base = mix(uColor, uColorB, sq(tb, max(fwidth(tb), 1e-4), uDuty));
  #endif
  #ifdef PAT_GRID
  float gx = vPat.x * uFreq;
  float gy = vPat.y * uFreq;
  float lx = abs(fract(gx) - 0.5);
  float ly = abs(fract(gy) - 0.5);
  if (lx < 0.38 && ly < 0.38) discard;
  #endif

  #if defined(USE_COLOR) || defined(USE_COLOR_ALPHA)
  base *= vColor.rgb;
  #endif
  #ifdef BACKCOLOR
  if (!gl_FrontFacing) base = uBack;
  #endif

  #ifdef UNLIT
  gl_FragColor = vec4(base * uEmissive * mix(vec3(1.0), uSunColor, 0.35), uOpacity);
  #else
  #ifdef FLAT
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  #else
  vec3 N = normalize(vWN) * (gl_FrontFacing ? 1.0 : -1.0);
  #endif
  float hl = dot(N, uSunDir) * 0.5 + 0.5;
  float aa = clamp(fwidth(hl), 0.002, 0.05);
  float full = smoothstep(0.58 - aa, 0.58 + aa, hl);
  float mid = smoothstep(0.34 - aa, 0.34 + aa, hl);
  float sh = getShadowMask() * cloudShadow(vWorld.xz);
  sh = smoothstep(0.35, 0.65, sh);
  vec3 sc = shadeOf(base);
  vec3 mc = mix(sc, base, 0.5);
  vec3 col = mix(sc, mix(mc, base, full), mid);
  col = mix(sc, col, sh);
  float shadeAmt = 1.0 - min(sh, mix(0.35, 1.0, full) * mid);
  col *= 1.0 - 0.09 * uGrain * uGrainMat * shadeAmt * stipple(0.24);
  col *= uSunColor;
  gl_FragColor = vec4(bakedGrade(col), uOpacity);
  #endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const cache = new Map<string, ShaderMaterial>();
const depthCache = new Map<string, MeshDepthMaterial>();

const col = (c: ColorRepresentation | undefined, d: string) => new Color(c ?? d);

/** Cached toon material. Identical options always return the same instance. */
export function toon(opts: ToonOpts = {}): ShaderMaterial {
  const key = JSON.stringify(opts);
  const hit = cache.get(key);
  if (hit) return hit;
  const m = makeToon(opts);
  cache.set(key, m);
  return m;
}

/** A toon material owned by the caller (per-character colours, swing). The caller must dispose it. */
export function toonUnique(opts: ToonOpts = {}): ShaderMaterial {
  return makeToon(opts);
}

function makeToon(opts: ToonOpts): ShaderMaterial {
  const defines: Record<string, string | number> = {};
  const pat = opts.pattern ?? 'none';
  if (pat !== 'none') defines[`PAT_${pat.toUpperCase()}`] = 1;
  if (opts.back !== undefined) defines.BACKCOLOR = 1;
  if (opts.unlit) defines.UNLIT = 1;
  if (opts.flat) defines.FLAT = 1;
  if (opts.sway) defines.SWAY = 1;
  if (opts.swayByHeight) defines.SWAY_BY_HEIGHT = 1;
  if (opts.swing) defines.SWING = 1;
  if (opts.merged) defines.MERGED = 1;

  const uniforms = {
    ...UniformsUtils.clone(UniformsLib.lights),
    ...G,
    uColor: { value: col(opts.color, '#ffffff') },
    uColorB: { value: col(opts.colorB, '#ffffff') },
    uBack: { value: col(opts.back, '#ffffff') },
    uFreq: { value: opts.freq ?? 8 },
    uOffset: { value: opts.offset ?? 0 },
    uDuty: { value: opts.duty ?? 0.5 },
    uEmissive: { value: opts.emissive ?? 1 },
    uOpacity: { value: opts.opacity ?? 1 },
    uGrainMat: { value: opts.grain ?? 1 },
    uSwayAmp: { value: opts.sway ?? 0 },
    uSwayH: { value: opts.swayByHeight ?? 0 },
    uSwing: { value: new Vector3() },
  };
  const m = new ShaderMaterial({
    name: `toon:${pat}${opts.sway ? ':sway' : ''}`,
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    defines,
    lights: true,
    vertexColors: true,
    side: opts.double || opts.back !== undefined || pat === 'grid' ? DoubleSide : FrontSide,
    transparent: !!opts.transparent,
    depthWrite: !opts.transparent,
  });
  m.userData.toonOpts = opts;
  return m;
}

/** The chunk-merge variant of a cached toon material (same look; sway phase from aOrigin), or null. */
export function mergedVariant(mat: Material): ShaderMaterial | null {
  const opts = mat.userData?.toonOpts as ToonOpts | undefined;
  if (!opts) return null;
  return opts.sway ? toon({ ...opts, merged: true }) : (mat as ShaderMaterial);
}

/** Shadow-pass material that applies the same wind displacement, so swaying things cast swaying shadows. */
function swayDepth(amp: number, byHeight = 0, merged = false): MeshDepthMaterial {
  const key = `${amp}:${byHeight}:${merged ? 'm' : ''}`;
  const hit = depthCache.get(key);
  if (hit) return hit;
  const m = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, G, { uSwayAmp: { value: amp }, uSwayH: { value: byHeight } });
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\n${GLOBALS_GLSL}\n${SWAY_GLSL}\nattribute float aSway;\n${merged ? 'attribute vec3 aOrigin;' : ''}\nuniform float uSwayAmp;\nuniform float uSwayH;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        mat4 swM = modelMatrix;
        #ifdef USE_INSTANCING
        swM = modelMatrix * instanceMatrix;
        #endif
        float swW = ${byHeight ? 'max(position.y, 0.0) * uSwayH' : 'aSway'};
        transformed += inverse(mat3(swM)) * windDisp(${merged ? 'aOrigin' : 'swM[3].xyz'}, swW, uSwayAmp);`,
      );
  };
  m.customProgramCacheKey = () => `swaydepth:${key}`;
  depthCache.set(key, m);
  return m;
}

/** Wire the matching depth material onto every swaying mesh under `root`. */
export function attachSwayDepth(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as ShaderMaterial;
    if (mat?.defines?.SWAY) {
      const amp = (mat.uniforms.uSwayAmp?.value as number) ?? 0;
      const h = (mat.uniforms.uSwayH?.value as number) ?? 0;
      mesh.customDepthMaterial = swayDepth(amp, mat.defines.SWAY_BY_HEIGHT ? h : 0, !!mat.defines.MERGED);
    }
  });
}


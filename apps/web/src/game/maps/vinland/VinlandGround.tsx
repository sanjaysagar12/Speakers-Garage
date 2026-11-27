import { useEffect, useMemo } from 'react';
import {
  Color,
  DataTexture,
  LinearFilter,
  Mesh,
  PlaneGeometry,
  RGBAFormat,
  SRGBColorSpace,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
} from 'three';
import { G } from '../../materials/globals';
import { COLOR_GLSL, GLOBALS_GLSL, NOISE_GLSL } from '../../materials/glsl';
import { VINLAND_KIND_COLOURS } from '@shoreline/shared';
import type { GameMap } from '../types';

const VERT = /* glsl */ `
#include <common>
#include <shadowmap_pars_vertex>
varying vec3 vWorld;
varying vec3 vN;
void main() {
  #include <beginnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <project_vertex>
  #include <worldpos_vertex>
  #include <shadowmap_vertex>
  vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vN = normalize(mat3(modelMatrix) * objectNormal);
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
uniform sampler2D uTiles;
uniform vec2 uSize;
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vec2 uv = vWorld.xz / uSize;
  // slight noise warp so tile edges read as organic patches, not squares
  uv += (vec2(vnoise(vWorld.xz * 0.6), vnoise(vWorld.xz * 0.6 + 7.0)) - 0.5) * (0.9 / uSize);
  vec3 col = texture2D(uTiles, uv).rgb;
  col *= 0.94 + 0.12 * step(0.55, vnoise(vWorld.xz * 0.3));
  float hl = dot(normalize(vN), uSunDir) * 0.5 + 0.5;
  float lit = smoothstep(0.55, 0.6, hl);
  float sh = smoothstep(0.35, 0.65, getShadowMask() * cloudShadow(vWorld.xz)) * mix(0.45, 1.0, lit);
  col = mix(shadeOf(col), col, sh);
  col *= 1.0 - 0.08 * uGrain * (1.0 - sh) * stipple(0.3);
  gl_FragColor = vec4(col * uSunColor, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createVinlandGround(map: GameMap & { kinds: string[]; heights: Float32Array; tilesW: number; tilesH: number }) {
  return function VinlandGround() {
    const built = useMemo(() => {
      const { tilesW: tw, tilesH: th, kinds } = map;
      const data = new Uint8Array(tw * th * 4);
      const c = new Color();
      kinds.forEach((k, i) => {
        c.set(VINLAND_KIND_COLOURS[k] ?? '#7FA85C');
        data[i * 4] = Math.round(c.r * 255);
        data[i * 4 + 1] = Math.round(c.g * 255);
        data[i * 4 + 2] = Math.round(c.b * 255);
        data[i * 4 + 3] = 255;
      });
      const tex = new DataTexture(data, tw, th, RGBAFormat);
      tex.colorSpace = SRGBColorSpace;
      tex.magFilter = LinearFilter;
      tex.minFilter = LinearFilter;
      tex.needsUpdate = true;
      const mat = new ShaderMaterial({
        uniforms: { ...UniformsUtils.clone(UniformsLib.lights), ...G, uTiles: { value: tex }, uSize: { value: new Vector2(map.width, map.height) } },
        vertexShader: VERT,
        fragmentShader: FRAG,
        lights: true,
      });
      const geo = new PlaneGeometry(map.width + 60, map.height + 60, tw / 2 + 30, th / 2 + 30);
      geo.rotateX(-Math.PI / 2);
      geo.translate(map.width / 2, 0, map.height / 2);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, map.groundHeight(p.getX(i), p.getZ(i)));
      geo.computeVertexNormals();
      const mesh = new Mesh(geo, mat);
      mesh.receiveShadow = true;
      return { mesh, tex, mat, geo };
    }, []);
    useEffect(
      () => () => {
        built.geo.dispose();
        built.mat.dispose();
        built.tex.dispose();
      },
      [built],
    );
    return <primitive object={built.mesh} dispose={null} />;
  };
}

import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { EffectComposer, Bloom, FXAA, Noise, Vignette } from '@react-three/postprocessing';
import { BlendFunction, Effect } from 'postprocessing';
import { Uniform } from 'three';
import { G } from '../materials/globals';
import type { QualityProfile } from '../config';

const FRAG = /* glsl */ `
uniform float uStipple;
uniform float uWarm;
float h12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // halftone stipple only in shade and gradient regions (linear luminance)
  float mask = smoothstep(0.42, 0.08, l);
  float dots = step(0.82, h12(floor(gl_FragCoord.xy / 1.5)));
  c *= 1.0 - uStipple * 0.07 * mask * dots;
  // warm grade: a touch warmer in the mids, a little more saturation
  c *= vec3(1.025, 1.0, 0.955);
  float g = dot(c, vec3(0.3333));
  c = mix(vec3(g), c, 1.07);
  // golden hour / sunset push
  c = mix(c, c * vec3(1.1, 0.94, 0.82), uWarm * 0.45);
  outputColor = vec4(c, inputColor.a);
}
`;

class StippleGradeEffect extends Effect {
  constructor() {
    super('StippleGrade', FRAG, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uStipple', new Uniform(1)],
        ['uWarm', new Uniform(0)],
      ]),
    });
  }
}

/**
 * Post-processing by tier. postprocessing merges the grade, grain and vignette into ONE effect pass (bloom
 * adds its own half-resolution mip chain). 'fxaa' is a single cheap AA pass; 'none' skips the composer
 * entirely and the warm grade is applied inside the world shaders instead (G.uGradeBaked).
 */
export function PostFX({ q }: { q: QualityProfile }) {
  const grade = useMemo(() => new StippleGradeEffect(), []);
  // Effect has no dispose() in this postprocessing version: calling it threw and aborted the rest of the
  // world's unmount (a leak on every re-enter). Free the effect's material resources if present.
  useEffect(() => () => (grade as unknown as { dispose?: () => void }).dispose?.(), [grade]);
  useFrame(() => {
    grade.uniforms.get('uStipple')!.value = q.grain > 0 ? 1 : 0;
    grade.uniforms.get('uWarm')!.value = G.uWarm.value;
  });
  if (q.post === 'none') return null;
  if (q.post === 'fxaa')
    return (
      <EffectComposer multisampling={0} enableNormalPass={false}>
        <FXAA />
      </EffectComposer>
    );
  return (
    <EffectComposer multisampling={4} enableNormalPass={false}>
      {/* only HDR whites (foam is slightly >1, sparkles and bulbs far above) bloom; half-resolution mips */}
      <Bloom intensity={0.45} luminanceThreshold={1.0} luminanceSmoothing={0.15} mipmapBlur resolutionScale={0.5} />
      <primitive object={grade} dispose={null} />
      <Noise premultiply opacity={0.32 * q.grain} blendFunction={BlendFunction.SOFT_LIGHT} />
      <Vignette offset={0.32} darkness={0.42} />
    </EffectComposer>
  );
}

import { useEffect, useMemo, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { DirectionalLight, Vector3 } from 'three';
import { G } from '../materials/globals';

const up = new Vector3(0, 1, 0);
const right = new Vector3();
const upv = new Vector3();
const dir = new Vector3();
const snapped = new Vector3();

/**
 * The one sun. Hard shadows in a tight orthographic frustum that follows `target`, snapped to shadow-map
 * texels so edges never shimmer while walking. Direction comes from the shared G.uSunDir uniform.
 */
export function Sun({ target, extent, mapSize }: { target: MutableRefObject<Vector3>; extent: number; mapSize: number }) {
  const light = useMemo(() => {
    const l = new DirectionalLight(0xffffff, 1);
    l.castShadow = true;
    l.shadow.bias = -0.0006;
    l.shadow.normalBias = 0.025;
    l.shadow.radius = 1;
    return l;
  }, []);

  useEffect(() => {
    const cam = light.shadow.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = 1;
    cam.far = 140;
    cam.updateProjectionMatrix();
    // tier 'shadows off': no caster pass at all (three recompiles lit materials without shadow sampling)
    light.castShadow = mapSize > 0;
    light.shadow.mapSize.set(Math.max(mapSize, 1), Math.max(mapSize, 1));
    if (light.shadow.map) {
      light.shadow.map.dispose();
      light.shadow.map = null;
    }
  }, [light, extent, mapSize]);

  useEffect(() => () => light.dispose(), [light]);

  useFrame(() => {
    const t = target.current;
    dir.copy(G.uSunDir.value).negate();
    right.crossVectors(dir, up).normalize();
    upv.crossVectors(right, dir).normalize();
    const texel = (2 * Math.max(extent, 1)) / Math.max(mapSize, 1);
    const u = t.dot(right);
    const v = t.dot(upv);
    snapped
      .copy(t)
      .addScaledVector(right, Math.round(u / texel) * texel - u)
      .addScaledVector(upv, Math.round(v / texel) * texel - v);
    light.target.position.copy(snapped);
    light.position.copy(snapped).addScaledVector(G.uSunDir.value, 60);
    light.target.updateMatrixWorld();
  });

  return (
    <>
      <primitive object={light} />
      <primitive object={light.target} />
    </>
  );
}

import { useThree } from '@react-three/fiber';
import { useLayoutEffect } from 'react';
import type { BufferGeometry, Material, Mesh, Object3D, Texture } from 'three';

/**
 * Releases everything a scene uses from the renderer that is about to be torn down.
 *
 * Materials, textures and geometries are cached at module level (toon material cache, shared structure
 * materials, the noise texture, the map's field texture) and outlive a Canvas. three.js attaches a
 * `dispose` listener from each renderer to every material/texture/geometry it uploads, so without this an
 * old renderer (and its compiled programs) stays reachable through the caches after leaving the world:
 * about 1 MB of heap per re-entry. `dispose()` frees the GPU side and drops those listeners; the objects
 * themselves stay valid and are simply uploaded again by the next renderer.
 */
export function releaseGpu(root: Object3D): void {
  const mats = new Set<Material>();
  const geos = new Set<BufferGeometry>();
  const texs = new Set<Texture>();
  const addTex = (v: unknown) => {
    if (v && (v as Texture).isTexture) texs.add(v as Texture);
  };
  const addMat = (m: Material | undefined) => {
    if (!m || mats.has(m)) return;
    mats.add(m);
    for (const v of Object.values(m as unknown as Record<string, unknown>)) addTex(v);
    const uniforms = (m as unknown as { uniforms?: Record<string, { value: unknown }> }).uniforms;
    if (uniforms) for (const u of Object.values(uniforms)) addTex(u?.value);
  };
  root.traverse((o) => {
    const m = o as Mesh;
    if (m.geometry) geos.add(m.geometry);
    if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(addMat);
    addMat(m.customDepthMaterial);
    addMat(m.customDistanceMaterial);
  });
  mats.forEach((m) => m.dispose());
  texs.forEach((t) => t.dispose());
  geos.forEach((g) => g.dispose());
}

/**
 * Mount inside a Canvas: runs releaseGpu on the scene when the Canvas unmounts. Layout-effect cleanup of
 * the top component runs before React detaches the scene's children, so the full scene graph is still there.
 */
export function useReleaseGpuOnUnmount(): void {
  const scene = useThree((s) => s.scene);
  useLayoutEffect(() => () => releaseGpu(scene), [scene]);
}

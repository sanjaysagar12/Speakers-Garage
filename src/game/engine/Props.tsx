import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, InstancedMesh, Matrix4, Object3D, Quaternion, Vector3, type Material, type BufferGeometry } from 'three';
import { DENSITY_SCALED, PROPS } from '../models/catalog';
import { disposeObject } from '../models/util/builder';
import { G } from '../materials/globals';
import type { GameMap } from '../maps/types';

interface Floater {
  obj: Object3D;
  y: number;
  rot: number;
  phase: number;
  amp: number;
}

/**
 * Renders a map's placements. Full models are built once per placement (merged per material, so most props
 * are 1-3 draw calls); small repeated things are instanced per variant. Density thins decoration only.
 */
export function Props({ map, density }: { map: GameMap; density: number }) {
  const built = useMemo(() => {
    const root = new Group();
    root.name = 'props';
    const floaters: Floater[] = [];
    const flames: Object3D[] = [];
    const instGeos: Array<{ geometry: BufferGeometry; material: Material }> = [];
    const buckets = new Map<string, Matrix4[]>();
    const m = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);

    for (const p of map.props) {
      const def = PROPS[p.type];
      if (!def) continue;
      const floats = p.params.__float === true;
      const y = p.y ?? map.groundHeight(p.x, p.z);
      if (def.instanced) {
        if (DENSITY_SCALED.has(p.type) && (p.seed % 997) / 997 > density) continue;
        const variant = p.seed % def.instanced.variants;
        const key = `${p.type}#${variant}`;
        const s = (0.85 + ((p.seed >> 3) % 30) / 100) * p.scale;
        q.setFromAxisAngle(up, p.rot);
        m.compose(new Vector3(p.x, y, p.z), q, new Vector3(s, s, s));
        (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(m.clone());
        continue;
      }
      if (!def.build) continue;
      const obj = def.build(p.params, p.seed);
      obj.position.set(p.x, y, p.z);
      obj.rotation.y = p.rot;
      obj.scale.setScalar(p.scale);
      root.add(obj);
      if (floats) floaters.push({ obj, y, rot: p.rot, phase: (p.seed % 628) / 100, amp: p.type === 'sailboat' ? 0.05 : 0.07 });
      const flame = obj.getObjectByName('flame');
      if (flame) flames.push(flame);
    }

    for (const [key, mats] of buckets) {
      const [type, v] = key.split('#');
      const def = PROPS[type].instanced!;
      const { geometry, material } = def.build(Number(v), {}).buildGeometry();
      const inst = new InstancedMesh(geometry, material, mats.length);
      mats.forEach((mm, i) => inst.setMatrixAt(i, mm));
      inst.castShadow = def.castShadow ?? false;
      inst.receiveShadow = true;
      inst.computeBoundingSphere();
      instGeos.push({ geometry, material });
      root.add(inst);
    }
    root.updateMatrixWorld(true);
    return { root, floaters, flames };
  }, [map, density]);

  useEffect(() => () => disposeObject(built.root), [built]);

  useFrame(() => {
    const t = G.uTime.value;
    for (const f of built.floaters) {
      f.obj.position.y = f.y + Math.sin(t * 1.3 + f.phase) * f.amp;
      f.obj.rotation.y = f.rot + Math.sin(t * 0.35 + f.phase) * 0.18;
      f.obj.rotation.x = Math.sin(t * 1.1 + f.phase * 2) * 0.05;
      f.obj.rotation.z = Math.cos(t * 0.9 + f.phase) * 0.05;
    }
    for (const fl of built.flames) {
      fl.children.forEach((c, i) => {
        const k = 1 + 0.18 * Math.sin(t * (9 + i * 3) + i) * Math.sin(t * 5.3 + i * 2);
        c.scale.set(1 - (k - 1) * 0.5, k, 1 - (k - 1) * 0.5);
        c.rotation.y = t * (0.6 + i * 0.4);
        c.position.x = Math.sin(t * 3 + i) * 0.02 + G.uWind.value.x * 0.04 * G.uWind.value.y;
      });
    }
  });

  return <primitive object={built.root} dispose={null} />;
}

import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, Object3D, Quaternion, Vector3, type BufferGeometry, type Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DENSITY_SCALED, PROPS } from '../models/catalog';
import { disposeObject } from '../models/util/builder';
import { attachSwayDepth, mergedVariant } from '../materials/toon';
import { G } from '../materials/globals';
import type { QualityProfile } from '../config';
import { devLog } from '../../util/devlog';
import type { GameMap, PropPlacement } from '../maps/types';

/** chunk size (m) for merging, culling and LOD */
const CHUNK = 24;
/** props built at runtime that must stay individual objects (animated children) */
const DYNAMIC = new Set(['campfire']);
/** small instanced decoration that only casts shadows on tiers with smallShadows */
const SMALL = new Set(['starfish', 'conch', 'scallop', 'pebble', 'stool', 'flower', 'grass', 'stone']);

interface Floater {
  obj: Object3D;
  y: number;
  rot: number;
  phase: number;
  amp: number;
}

/** One chunk: static props merged per material, palms in two LODs, instanced decoration. */
interface Chunk {
  cx: number;
  cz: number;
  common: Group;
  near: Group;
  far: Group;
}

type Buckets = Map<string, { mat: Material; geos: BufferGeometry[]; cast: boolean }>;

const tmpQ = new Quaternion();
const tmpS = new Vector3();
const tmpP = new Vector3();
const UP = new Vector3(0, 1, 0);

/** Bake a built prop's meshes (world transform + per-vertex origin) into material buckets. Returns false if a mesh can't merge. */
function bake(obj: Object3D, origin: Vector3, buckets: Buckets): boolean {
  obj.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  let ok = true;
  obj.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    if (!mergedVariant(m.material as Material)) ok = false;
    meshes.push(m);
  });
  if (!ok) return false;
  for (const m of meshes) {
    const mat = mergedVariant(m.material as Material)!;
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    const n = g.attributes.position.count;
    const o = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) o.set([origin.x, origin.y, origin.z], i * 3);
    g.setAttribute('aOrigin', new BufferAttribute(o, 3));
    const key = `${mat.uuid}:${m.castShadow ? 1 : 0}`;
    const b = buckets.get(key) ?? { mat, geos: [], cast: m.castShadow };
    b.geos.push(g);
    buckets.set(key, b);
  }
  return true;
}

function flush(buckets: Buckets, into: Group): void {
  for (const b of buckets.values()) {
    const merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
    if (b.geos.length > 1) b.geos.forEach((g) => g.dispose());
    if (!merged) {
      devLog('[props] merge failed (mismatched attributes) for', b.mat.name);
      continue;
    }
    merged.computeBoundingSphere();
    const mesh = new Mesh(merged, b.mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = true;
    into.add(mesh);
  }
  attachSwayDepth(into);
}

/**
 * Renders a map's placements cheaply:
 *  - static props are merged per chunk and per material (a whole chunk of umbrellas, palms, loungers and
 *    cliffs is a handful of draw calls); each vertex keeps its prop's origin so sway phases stay distinct
 *  - palms have a full-detail and a distant version; chunks switch by camera distance (tier lodDistance)
 *  - small repeated decoration is instanced per chunk and variant; density thins it per tier
 *  - chunks beyond the tier's view distance are not rendered
 *  - floating props and the campfire stay individual objects (they animate)
 */
export function Props({ map, q }: { map: GameMap; q: QualityProfile }) {
  const camera = useThree((s) => s.camera);
  const density = q.propDensity;
  const smallShadows = q.smallShadows;
  const built = useMemo(() => {
    const root = new Group();
    root.name = 'props';
    const floaters: Floater[] = [];
    const flames: Object3D[] = [];
    const singles: Object3D[] = [];
    const chunkData = new Map<string, { cx: number; cz: number; common: Buckets; near: Buckets; far: Buckets; inst: Map<string, Matrix4[]> }>();
    const chunkOf = (p: PropPlacement) => {
      const key = `${Math.floor(p.x / CHUNK)},${Math.floor(p.z / CHUNK)}`;
      let c = chunkData.get(key);
      if (!c) {
        c = { cx: (Math.floor(p.x / CHUNK) + 0.5) * CHUNK, cz: (Math.floor(p.z / CHUNK) + 0.5) * CHUNK, common: new Map(), near: new Map(), far: new Map(), inst: new Map() };
        chunkData.set(key, c);
      }
      return c;
    };

    for (const p of map.props) {
      const def = PROPS[p.type];
      if (!def) continue;
      const floats = p.params.__float === true;
      const y = p.y ?? map.groundHeight(p.x, p.z);
      if (def.instanced) {
        if (DENSITY_SCALED.has(p.type) && (p.seed % 997) / 997 > density) continue;
        const key = `${p.type}#${p.seed % def.instanced.variants}`;
        const s = (0.85 + ((p.seed >> 3) % 30) / 100) * p.scale;
        tmpQ.setFromAxisAngle(UP, p.rot);
        const list = chunkOf(p).inst;
        (list.get(key) ?? list.set(key, []).get(key)!).push(new Matrix4().compose(tmpP.set(p.x, y, p.z), tmpQ, tmpS.set(s, s, s)));
        continue;
      }
      if (!def.build) continue;
      const place = (o: Object3D) => {
        o.position.set(p.x, y, p.z);
        o.rotation.y = p.rot;
        o.scale.setScalar(p.scale);
        return o;
      };
      const obj = place(def.build(p.params, p.seed));
      const dynamic = floats || DYNAMIC.has(p.type) || !!obj.getObjectByName('flame');
      if (!dynamic) {
        const c = chunkOf(p);
        const origin = new Vector3(p.x, y, p.z);
        const isPalm = p.type === 'palm';
        if (bake(obj, origin, isPalm ? c.near : c.common)) {
          if (isPalm) bake(place(def.build({ ...p.params, lod: 1 }, p.seed)), origin, c.far);
          disposeObject(obj);
          continue;
        }
      }
      root.add(obj);
      singles.push(obj);
      if (floats) floaters.push({ obj, y, rot: p.rot, phase: (p.seed % 628) / 100, amp: p.type === 'sailboat' ? 0.05 : 0.07 });
      const flame = obj.getObjectByName('flame');
      if (flame) flames.push(flame);
    }

    // build chunk groups
    const chunks: Chunk[] = [];
    const instSources = new Map<string, { geometry: BufferGeometry; material: Material }>();
    for (const c of chunkData.values()) {
      const chunk: Chunk = { cx: c.cx, cz: c.cz, common: new Group(), near: new Group(), far: new Group() };
      flush(c.common, chunk.common);
      flush(c.near, chunk.near);
      flush(c.far, chunk.far);
      for (const [key, mats] of c.inst) {
        const [type, v] = key.split('#');
        const def = PROPS[type].instanced!;
        let src = instSources.get(key);
        if (!src) {
          src = def.build(Number(v), {}).buildGeometry();
          instSources.set(key, src);
        }
        const inst = new InstancedMesh(src.geometry, src.material, mats.length);
        mats.forEach((mm, i) => inst.setMatrixAt(i, mm));
        inst.castShadow = (def.castShadow ?? false) && (smallShadows || !SMALL.has(type));
        inst.receiveShadow = true;
        inst.computeBoundingSphere();
        chunk.common.add(inst);
      }
      attachSwayDepth(chunk.common);
      root.add(chunk.common, chunk.near, chunk.far);
      chunks.push(chunk);
    }
    root.updateMatrixWorld(true);
    return { root, floaters, flames, chunks, singles, instSources };
  }, [map, density, smallShadows]);

  useEffect(
    () => () => {
      disposeObject(built.root);
      built.instSources.forEach((s) => s.geometry.dispose());
      built.root.traverse((o) => (o as InstancedMesh).isInstancedMesh && (o as InstancedMesh).dispose());
    },
    [built],
  );

  const frame = useMemo(() => ({ n: 0 }), []);
  useFrame(() => {
    const t = G.uTime.value;
    for (const f of built.floaters) {
      f.obj.position.y = f.y + Math.sin(t * 1.3 + f.phase) * f.amp;
      f.obj.rotation.y = f.rot + Math.sin(t * 0.35 + f.phase) * 0.18;
      f.obj.rotation.x = Math.sin(t * 1.1 + f.phase * 2) * 0.05;
      f.obj.rotation.z = Math.cos(t * 0.9 + f.phase) * 0.05;
    }
    for (const fl of built.flames) {
      for (let i = 0; i < fl.children.length; i++) {
        const c = fl.children[i];
        const k = 1 + 0.18 * Math.sin(t * (9 + i * 3) + i) * Math.sin(t * 5.3 + i * 2);
        c.scale.set(1 - (k - 1) * 0.5, k, 1 - (k - 1) * 0.5);
        c.rotation.y = t * (0.6 + i * 0.4);
        c.position.x = Math.sin(t * 3 + i) * 0.02 + G.uWind.value.x * 0.04 * G.uWind.value.y;
      }
    }
    // distance culling + palm LOD, a few times per second
    if (frame.n++ % 6) return;
    const cx = camera.position.x;
    const cz = camera.position.z;
    const view = q.viewDistance + CHUNK * 0.7;
    const lod = q.lodDistance;
    for (const c of built.chunks) {
      const d = Math.hypot(c.cx - cx, c.cz - cz);
      c.common.visible = d < view;
      c.near.visible = d < lod;
      c.far.visible = d >= lod && d < view;
    }
    for (const o of built.singles) o.visible = Math.hypot(o.position.x - cx, o.position.z - cz) < view;
  });

  return <primitive object={built.root} dispose={null} />;
}

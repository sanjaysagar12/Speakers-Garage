import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Euler,
  Group,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type ColorRepresentation,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { attachSwayDepth, toon } from '../../materials/toon';

export interface PartOpts {
  color?: ColorRepresentation;
  /** defaults to the shared vertex-colour toon material */
  mat?: Material;
  pos?: [number, number, number];
  rot?: [number, number, number];
  scale?: number | [number, number, number];
  matrix?: Matrix4;
  /** per-vertex sway weight from the transformed (model-space) position */
  sway?: (p: Vector3) => number;
  /** keep an existing aPat attribute instead of copying the pre-transform position */
  keepPat?: boolean;
}

const tmp = new Vector3();

function partMatrix(o: Pick<PartOpts, 'pos' | 'rot' | 'scale' | 'matrix'>): Matrix4 {
  if (o.matrix) return o.matrix;
  const s = o.scale ?? 1;
  const sv = typeof s === 'number' ? new Vector3(s, s, s) : new Vector3(...s);
  const q = new Quaternion().setFromEuler(new Euler(...(o.rot ?? [0, 0, 0])));
  return new Matrix4().compose(new Vector3(...(o.pos ?? [0, 0, 0])), q, sv);
}

/** Normalise a geometry to exactly the attributes the toon shader uses: position, normal, color, aPat, aSway. */
function prepGeometry(src: BufferGeometry, opts: PartOpts = {}): BufferGeometry {
  let g = src.index ? src.clone() : src.clone();
  if (!g.index) {
    const n = g.attributes.position.count;
    const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new BufferAttribute(idx, 1));
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  if (!(opts.keepPat && g.attributes.aPat)) g.setAttribute('aPat', g.attributes.position.clone());
  g.applyMatrix4(partMatrix(opts));
  const c = new Color(opts.color ?? '#ffffff');
  const ca = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    ca[i * 3] = c.r;
    ca[i * 3 + 1] = c.g;
    ca[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new BufferAttribute(ca, 3));
  const sw = new Float32Array(n);
  if (opts.sway) {
    const p = g.attributes.position;
    for (let i = 0; i < n; i++) sw[i] = opts.sway(tmp.fromBufferAttribute(p, i));
  }
  g.setAttribute('aSway', new BufferAttribute(sw, 1));
  for (const k of Object.keys(g.attributes)) {
    if (!['position', 'normal', 'color', 'aPat', 'aSway'].includes(k)) g.deleteAttribute(k);
  }
  g.morphAttributes = {};
  g.clearGroups();
  if (g.index && g.index.array instanceof Uint16Array && n > 65535) g = g.toNonIndexed();
  return g;
}

/**
 * Collects coloured parts and merges them per material, so a whole prop is usually one or two draw calls.
 * Pattern meshes (stripes, panels) keep their own material but still merge with same-material parts.
 */
export class ModelBuilder {
  private readonly groups = new Map<Material, BufferGeometry[]>();

  add(geo: BufferGeometry, opts: PartOpts = {}): this {
    const mat = opts.mat ?? toon();
    const list = this.groups.get(mat) ?? [];
    list.push(prepGeometry(geo, opts));
    this.groups.set(mat, list);
    return this;
  }

  get empty(): boolean {
    return this.groups.size === 0;
  }

  /** Merge into meshes. Source geometries passed to add() are not consumed; callers may reuse them. */
  build(name = 'model', shadows = true): Group {
    const root = new Group();
    root.name = name;
    for (const [mat, geos] of this.groups) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!merged) continue;
      if (geos.length > 1) geos.forEach((g) => g.dispose());
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new Mesh(merged, mat);
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
    attachSwayDepth(root);
    return root;
  }

  /** Single merged geometry (for instancing). Only valid when every part used the same material. */
  buildGeometry(): { geometry: BufferGeometry; material: Material } {
    const [[mat, geos]] = [...this.groups];
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false)!;
    merged.computeBoundingSphere();
    return { geometry: merged, material: mat };
  }
}

/** Dispose every geometry under a root. Materials are shared (cached) and are not disposed here. */
export function disposeObject(root: { traverse: (cb: (o: unknown) => void) => void }): void {
  root.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh) m.geometry?.dispose();
  });
}

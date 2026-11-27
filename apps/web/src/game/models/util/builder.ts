import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Euler,
  Group,
  Matrix4,
  Mesh,
  Quaternion,
  Skeleton,
  SkinnedMesh,
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
  /**
   * Skinning: a bone index (rigid), or a function of the model-space position (before the builder's
   * frame) returning [bone, weight] pairs. Only for builders made with { skinned: true }.
   */
  skin?: number | ((p: Vector3) => Array<[number, number]>);
}

/** Per-vertex mask applied in model space after the part transform (hair under a hat). */
export interface VertexMask {
  /** true = this vertex must not be visible (it is moved by hide()) */
  hidden(p: Vector3): boolean;
  /** move a hidden vertex somewhere invisible (inside the head) */
  hide(p: Vector3): void;
  /** adjust a visible vertex (tuck hair under a brim); may be a no-op */
  adjust?(p: Vector3): void;
}

const tmp = new Vector3();

export function partMatrix(o: Pick<PartOpts, 'pos' | 'rot' | 'scale' | 'matrix'>): Matrix4 {
  if (o.matrix) return o.matrix;
  const s = o.scale ?? 1;
  const sv = typeof s === 'number' ? new Vector3(s, s, s) : new Vector3(...s);
  const q = new Quaternion().setFromEuler(new Euler(...(o.rot ?? [0, 0, 0])));
  return new Matrix4().compose(new Vector3(...(o.pos ?? [0, 0, 0])), q, sv);
}

/** Normalise a geometry to exactly the attributes the toon shader uses: position, normal, color, aPat, aSway (+ skin). */
function prepGeometry(src: BufferGeometry, opts: PartOpts = {}, frame: Frame | null = null, mask: VertexMask | null = null): BufferGeometry {
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
  const p = g.attributes.position;
  if (opts.sway) {
    for (let i = 0; i < n; i++) sw[i] = opts.sway(tmp.fromBufferAttribute(p, i));
  }
  g.setAttribute('aSway', new BufferAttribute(sw, 1));
  if (mask) applyMask(g, mask);
  const skin = opts.skin ?? frame?.skin;
  if (skin !== undefined) {
    const si = new Uint16Array(n * 4);
    const sk = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      if (typeof skin === 'number') {
        si[i * 4] = skin;
        sk[i * 4] = 1;
        continue;
      }
      const pairs = skin(tmp.fromBufferAttribute(p, i));
      let sum = 0;
      for (let k = 0; k < Math.min(4, pairs.length); k++) sum += pairs[k][1];
      for (let k = 0; k < Math.min(4, pairs.length); k++) {
        si[i * 4 + k] = pairs[k][0];
        sk[i * 4 + k] = sum > 0 ? pairs[k][1] / sum : k === 0 ? 1 : 0;
      }
    }
    g.setAttribute('skinIndex', new BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new BufferAttribute(sk, 4));
  }
  if (frame) g.applyMatrix4(frame.matrix);
  for (const k of Object.keys(g.attributes)) {
    if (!KEEP.includes(k)) g.deleteAttribute(k);
  }
  g.morphAttributes = {};
  g.clearGroups();
  if (g.index && g.index.array instanceof Uint16Array && n > 65535) g = g.toNonIndexed();
  return g;
}

const KEEP = ['position', 'normal', 'color', 'aPat', 'aSway', 'skinIndex', 'skinWeight'];

/** Hide masked vertices; drop triangles whose three vertices are all hidden. */
function applyMask(g: BufferGeometry, mask: VertexMask): void {
  const p = g.attributes.position;
  const n = p.count;
  const hidden = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    tmp.fromBufferAttribute(p, i);
    if (mask.hidden(tmp)) {
      hidden[i] = 1;
      mask.hide(tmp);
    } else if (mask.adjust) {
      mask.adjust(tmp);
      // an adjustment may move a vertex somewhere it must not be: hide it then
      if (mask.hidden(tmp)) {
        hidden[i] = 1;
        mask.hide(tmp);
      }
    }
    p.setXYZ(i, tmp.x, tmp.y, tmp.z);
  }
  const idx = g.index!;
  const keep: number[] = [];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t);
    const b = idx.getX(t + 1);
    const c = idx.getX(t + 2);
    if (!(hidden[a] && hidden[b] && hidden[c])) keep.push(a, b, c);
  }
  g.setIndex(keep);
  g.computeVertexNormals();
}

interface Frame {
  matrix: Matrix4;
  skin?: PartOpts['skin'];
}

/**
 * Collects coloured parts and merges them per material, so a whole prop is usually one or two draw calls.
 * Pattern meshes (stripes, panels) keep their own material but still merge with same-material parts.
 */
export class ModelBuilder {
  private readonly groups = new Map<Material, BufferGeometry[]>();
  /** per material, the tag and triangle count of each part in merge order (fit test bookkeeping) */
  private readonly partInfo = new Map<Material, Array<{ tag: string; tris: number }>>();
  /**
   * Material for parts added without one (vertex colours). Defaults to the shared cached toon(); a model
   * drawn by several renderers (the avatar in the world, the preview and the thumbnails) passes its own,
   * because a material's light uniforms are written by whichever renderer used it last.
   */
  defaultMat: Material | null = null;
  /** label recorded for the following parts (e.g. the body segment a garment piece sits on) */
  tag = '';
  private frameState: Frame | null = null;
  /** optional mask for every following part (cleared with setMask(null)) */
  private maskState: VertexMask | null = null;

  /**
   * Parts added after this are given in a bone's space: `matrix` takes them to model space and `skin`
   * (a bone index) is their default skinning. Pass null to go back to plain model space.
   */
  setFrame(matrix: Matrix4 | null, skin?: PartOpts['skin']): this {
    this.frameState = matrix ? { matrix, skin } : null;
    return this;
  }

  setMask(mask: VertexMask | null): this {
    this.maskState = mask;
    return this;
  }

  add(geo: BufferGeometry, opts: PartOpts = {}): this {
    const mat = opts.mat ?? this.defaultMat ?? toon();
    const list = this.groups.get(mat) ?? [];
    const g = prepGeometry(geo, opts, this.frameState, this.maskState);
    list.push(g);
    const info = this.partInfo.get(mat) ?? [];
    info.push({ tag: this.tag, tris: (g.index ? g.index.count : g.attributes.position.count) / 3 });
    this.partInfo.set(mat, info);
    this.groups.set(mat, list);
    return this;
  }

  get empty(): boolean {
    return this.groups.size === 0;
  }

  /** Merge into meshes. Source geometries passed to add() are not consumed; callers may reuse them. */
  build(name = 'model', shadows = true, skeleton?: Skeleton): Group {
    const root = new Group();
    root.name = name;
    for (const [mat, geos] of this.groups) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!merged) continue;
      if (geos.length > 1) geos.forEach((g) => g.dispose());
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      let mesh: Mesh;
      if (skeleton) {
        const sm = new SkinnedMesh(merged, mat);
        // bind in model space: the mesh sits at the model root, bone inverses are the rest pose
        sm.bind(skeleton, new Matrix4());
        mesh = sm;
      } else mesh = new Mesh(merged, mat);
      mesh.userData.parts = this.partInfo.get(mat) ?? [];
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

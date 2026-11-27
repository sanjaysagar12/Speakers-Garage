import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  IcosahedronGeometry,
  LatheGeometry,
  Shape,
  ExtrudeGeometry,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const range = (r: () => number, a: number, b: number) => a + (b - a) * r();

/** Lathe from [radius, y] pairs, bottom to top. */
export function lathe(profile: Array<[number, number]>, segments = 16, phiStart = 0, phiLength = Math.PI * 2): BufferGeometry {
  const g = new LatheGeometry(
    profile.map(([r, y]) => new Vector2(Math.max(r, 0.0001), y)),
    segments,
    phiStart,
    phiLength,
  );
  g.computeVertexNormals();
  return g;
}

export function ellipsoid(rx: number, ry: number, rz: number, ws = 14, hs = 10): BufferGeometry {
  const g = new SphereGeometry(1, ws, hs);
  g.scale(rx, ry, rz);
  g.computeVertexNormals();
  return g;
}

/**
 * Swept tube with a varying (optionally elliptical) cross-section along a smooth curve.
 * radius(t) gives [rx, ry] in the curve's normal/binormal frame. Ends are capped.
 */
export function sweep(
  pts: Vector3[],
  radiusIn: ((t: number) => [number, number] | number) | number | [number, number],
  radial = 8,
  segs = 12,
  up = new Vector3(0, 1, 0),
): BufferGeometry {
  const radius = typeof radiusIn === 'function' ? radiusIn : () => radiusIn;
  const curve = new CatmullRomCurve3(pts, false, 'centripetal');
  const pos: number[] = [];
  const idx: number[] = [];
  const frames: Array<{ p: Vector3; n: Vector3; b: Vector3; r: [number, number] }> = [];
  let prevN: Vector3 | null = null;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t).normalize();
    let n: Vector3;
    if (prevN) {
      // parallel transport
      n = prevN.clone().sub(tan.clone().multiplyScalar(prevN.dot(tan))).normalize();
    } else {
      const ref = Math.abs(tan.dot(up)) > 0.95 ? new Vector3(1, 0, 0) : up;
      n = new Vector3().crossVectors(tan, ref).cross(tan).normalize().negate();
    }
    prevN = n;
    const b = new Vector3().crossVectors(tan, n).normalize();
    const rr = radius(t);
    frames.push({ p, n, b, r: typeof rr === 'number' ? [rr, rr] : rr });
  }
  for (const f of frames) {
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const v = f.p
        .clone()
        .addScaledVector(f.n, Math.cos(a) * f.r[0])
        .addScaledVector(f.b, Math.sin(a) * f.r[1]);
      pos.push(v.x, v.y, v.z);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      const c = (i + 1) * radial + j;
      const d = (i + 1) * radial + ((j + 1) % radial);
      idx.push(a, c, b, b, c, d);
    }
  }
  // caps
  const capStart = pos.length / 3;
  pos.push(frames[0].p.x, frames[0].p.y, frames[0].p.z);
  for (let j = 0; j < radial; j++) idx.push(capStart, j, (j + 1) % radial);
  const capEnd = pos.length / 3;
  const last = frames[frames.length - 1].p;
  pos.push(last.x, last.y, last.z);
  const base = segs * radial;
  for (let j = 0; j < radial; j++) idx.push(capEnd, base + ((j + 1) % radial), base + j);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A ribbon along a curve. width(t) is the half-width, fold(t) lifts the centre line (V-shaped cross
 * section, like a palm frond or a hair clump), edge(t, side) optionally perturbs the outline (serrations).
 */
export function ribbon(
  pts: Vector3[],
  width: (t: number) => number,
  opts: {
    segs?: number;
    across?: number;
    fold?: (t: number) => number;
    edge?: (t: number, side: number) => number;
    up?: Vector3;
    thickness?: number;
  } = {},
): BufferGeometry {
  const segs = opts.segs ?? 16;
  const across = opts.across ?? 2;
  const up = opts.up ?? new Vector3(0, 1, 0);
  const curve = new CatmullRomCurve3(pts, false, 'centripetal');
  const pos: number[] = [];
  const idx: number[] = [];
  const cols = across * 2 + 1;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t).normalize();
    const side = new Vector3().crossVectors(up, tan);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const nrm = new Vector3().crossVectors(tan, side).normalize();
    const w = width(t);
    const f = opts.fold?.(t) ?? 0;
    for (let k = -across; k <= across; k++) {
      const u = k / across;
      const e = k === 0 ? 1 : 1 + (opts.edge?.(t, Math.sign(k)) ?? 0);
      const v = p
        .clone()
        .addScaledVector(side, u * w * e)
        .addScaledVector(nrm, (1 - Math.abs(u)) * f);
      pos.push(v.x, v.y, v.z);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let k = 0; k < cols - 1; k++) {
      const a = i * cols + k;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      // wound so the front face looks along +normal (up for a horizontal ribbon)
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Faceted rock: icosahedron, noise-displaced, squashed. Flat normals. */
export function rockGeo(seed: number, rx: number, ry: number, rz: number, detail = 1): BufferGeometry {
  const r = rng(seed);
  const g = new IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const v = new Vector3();
  const offs = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let o = offs.get(key);
    if (o === undefined) {
      o = 0.78 + r() * 0.36;
      offs.set(key, o);
    }
    v.multiplyScalar(o);
    if (v.y < -0.35) v.y = -0.35 - (v.y + 0.35) * 0.2;
    p.setXYZ(i, v.x * rx, v.y * ry, v.z * rz);
  }
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  g.dispose();
  return ng;
}

/** Flat extruded outline (starfish, signs, flip-flop soles). Shape in x/y, extruded along +z, then laid flat (y up). */
export function slab(outline: Array<[number, number]>, depth: number, bevel = 0.0): BufferGeometry {
  const s = new Shape(outline.map(([x, y]) => new Vector2(x, y)));
  const g = new ExtrudeGeometry(s, {
    depth,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: 6,
  });
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

/** Points on a circle-ish star outline. */
export function starOutline(points: number, rOuter: number, rInner: number, roundness = 3): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const n = points * roundness * 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / 2;
    const t = (i / n) * points;
    const f = Math.abs(((t % 1) + 1) % 1 - 0.5) * 2; // 1 at tips, 0 between
    const r = rInner + (rOuter - rInner) * Math.pow(f, 1.6);
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

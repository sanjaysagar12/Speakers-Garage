import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { ringAt, segBottom, segTop, type EllipsoidSeg, type Ring, type TubeSeg } from './rig';

/**
 * Surface generators shared by the body and every garment. A garment is the body's own surface pushed
 * outward: same rings, same radial columns, plus an offset (gap + cloth thickness) and optional flare,
 * folds and hems. Because the columns line up, a garment polygon can never cut into the body polygon
 * under it (the offset is larger than any chord sag).
 */

/** A ring of the output grid: ellipse plus an optional extra radial offset per angle (folds). */
interface GridRing extends Required<Ring> {
  extra?: (theta: number) => number;
}

/** Angle of column j: theta = 0 is +x (left side), pi/2 is +z (front). */
const theta = (j: number, n: number) => (j / n) * Math.PI * 2;

/**
 * Build an indexed grid of rings (bottom to top) with optional poles. Faces point outward (away from the
 * ring centre). Columns wrap without a seam so normals are smooth all round.
 */
export function ringGrid(rings: GridRing[], n: number, bottomPole?: Vector3, topPole?: Vector3): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const r of rings) {
    for (let j = 0; j < n; j++) {
      const t = theta(j, n);
      const e = r.extra ? r.extra(t) : 0;
      pos.push(r.cx + (r.rx + e) * Math.cos(t), r.y, r.cz + (r.rz + e) * Math.sin(t));
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      const a = i * n + j;
      const b = i * n + ((j + 1) % n);
      const c = a + n;
      const d = b + n;
      idx.push(a, c, b, b, c, d);
    }
  }
  if (bottomPole) {
    const p = pos.length / 3;
    pos.push(bottomPole.x, bottomPole.y, bottomPole.z);
    for (let j = 0; j < n; j++) idx.push(j, (j + 1) % n, p);
  }
  if (topPole) {
    const p = pos.length / 3;
    pos.push(topPole.x, topPole.y, topPole.z);
    const base = (rings.length - 1) * n;
    for (let j = 0; j < n; j++) idx.push(base + j, p, base + ((j + 1) % n));
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface ShellOpts {
  /** lower bound for the offset at height y (an outer layer clears the layer beneath it) */
  minOffset?: (y: number) => number;
  /** y range in bone space; defaults to the whole segment (including its ends) */
  from?: number;
  to?: number;
  /** distance from the body surface (gap + cloth thickness) */
  offset: number;
  /** extra offset reached at the bottom/top open end, eased in over flareLen (loose hems) */
  flareBottom?: number;
  flareTop?: number;
  flareLen?: number;
  /** soft folds: radial displacement amp * (0.5 + 0.5 sin), always outward */
  folds?: { amp: number; freq: number; phase?: number; twist?: number };
  /** hem lip (turned-in edge with thickness) at an open end */
  hemBottom?: number;
  hemTop?: number;
  /** include the segment's end (ball hemisphere or pole) when the range reaches it */
  endBottom?: boolean;
  endTop?: boolean;
  /** largest spacing between rings (folds need more rings) */
  step?: number;
  /** scale the ellipse radii (body hiding uses 1, shells use 1) */
  shrink?: number;
}

const BALL_RINGS = 4;

/** Offset shell (or the body itself with offset 0) of a tube segment between from and to. */
export function tubeShell(seg: TubeSeg, o: ShellOpts): BufferGeometry {
  const lo = segBottom(seg);
  const hi = segTop(seg);
  const from = Math.max(lo, o.from ?? lo);
  const to = Math.min(hi, o.to ?? hi);
  const step = o.step ?? 0.04;
  const flareLen = o.flareLen ?? 0.08;
  // y samples: knots inside the range plus subdivisions
  const knots = [from, ...seg.rings.map((r) => r.y).filter((y) => y > from + 1e-6 && y < to - 1e-6), to];
  const ys: number[] = [];
  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i];
    const b = knots[i + 1];
    const k = Math.max(1, Math.ceil((b - a) / step));
    for (let s = 0; s < k; s++) ys.push(a + ((b - a) * s) / k);
  }
  ys.push(to);
  const atBottom = from <= lo + 1e-6 && o.endBottom !== false;
  const atTop = to >= hi - 1e-6 && o.endTop !== false;
  const offsetAt = (y: number) => {
    let d = o.offset;
    if (o.flareBottom && !atBottom) d += o.flareBottom * Math.max(0, 1 - (y - from) / flareLen) ** 2;
    if (o.flareTop && !atTop) d += o.flareTop * Math.max(0, 1 - (to - y) / flareLen) ** 2;
    return o.minOffset ? Math.max(d, o.minOffset(y)) : d;
  };
  const f = o.folds;
  const foldAt = (y: number) =>
    f ? (t: number) => f.amp * (0.5 + 0.5 * Math.sin(t * f.freq + (f.phase ?? 0) + y * (f.twist ?? 0) * 40)) * Math.min(1, (y - from) / 0.03 + 0.2, (to - y) / 0.03 + 0.2) : undefined;
  const sh = o.shrink ?? 1;
  const ring = (y: number, extraD = 0, folds = true): GridRing => {
    const r = ringAt(seg, y);
    const d = offsetAt(y) + extraD;
    return { y, rx: r.rx * sh + d, rz: r.rz * sh + d, cx: r.cx, cz: r.cz, extra: folds ? foldAt(y) : undefined };
  };
  const rings: GridRing[] = ys.map((y) => ring(y));
  let bottomPole: Vector3 | undefined;
  let topPole: Vector3 | undefined;
  // bottom end
  if (atBottom && seg.bottom === 'ball') {
    const r0 = rings[0];
    const R = r0.rx;
    const cap: GridRing[] = [];
    for (let k = BALL_RINGS; k >= 1; k--) {
      const a = (k / (BALL_RINGS + 1)) * (Math.PI / 2);
      cap.push({ ...r0, y: r0.y - R * Math.sin(a), rx: R * Math.cos(a), rz: r0.rz * Math.cos(a), extra: undefined });
    }
    rings[0] = { ...r0, extra: undefined };
    rings.unshift(...cap);
    bottomPole = new Vector3(r0.cx, r0.y - R, r0.cz);
  } else if (atBottom && seg.bottom === 'pole') {
    const r0 = rings[0];
    bottomPole = new Vector3(r0.cx, r0.y - 0.012 - o.offset, r0.cz);
  } else if (o.hemBottom) {
    // lip: edge pushed out by the hem thickness, then turned in and up under the cloth
    const r0 = rings[0];
    const inB = Math.min(o.offset * 0.55, offsetAt(r0.y) - Math.max(o.offset * 0.45, (o.minOffset?.(r0.y + 0.014) ?? 0) - 0.002));
    rings.unshift({ ...r0, y: r0.y + 0.014, rx: r0.rx - inB, rz: r0.rz - inB, extra: undefined }, { ...r0, y: r0.y - 0.002, rx: r0.rx + o.hemBottom * 0.5, rz: r0.rz + o.hemBottom * 0.5, extra: undefined });
    rings[2] = { ...r0, rx: r0.rx + o.hemBottom, rz: r0.rz + o.hemBottom, extra: undefined };
  }
  // top end
  if (atTop && seg.top === 'ball') {
    const r1 = rings[rings.length - 1];
    const R = r1.rx;
    rings[rings.length - 1] = { ...r1, extra: undefined };
    for (let k = 1; k <= BALL_RINGS; k++) {
      const a = (k / (BALL_RINGS + 1)) * (Math.PI / 2);
      rings.push({ ...r1, y: r1.y + R * Math.sin(a), rx: R * Math.cos(a), rz: r1.rz * Math.cos(a), extra: undefined });
    }
    topPole = new Vector3(r1.cx, r1.y + R, r1.cz);
  } else if (atTop && seg.top === 'pole') {
    const r1 = rings[rings.length - 1];
    topPole = new Vector3(r1.cx, r1.y + 0.012 + o.offset, r1.cz);
  } else if (o.hemTop) {
    const r1 = rings[rings.length - 1];
    rings[rings.length - 1] = { ...r1, rx: r1.rx + o.hemTop, rz: r1.rz + o.hemTop, extra: undefined };
    rings.push({ ...r1, y: r1.y + 0.002, rx: r1.rx + o.hemTop * 0.5, rz: r1.rz + o.hemTop * 0.5, extra: undefined }, { ...r1, y: r1.y - 0.014, rx: r1.rx - o.offset * 0.55, rz: r1.rz - o.offset * 0.55, extra: undefined });
  }
  return ringGrid(rings, seg.sides, bottomPole, topPole);
}

/** A rolled band (waistband, collar, cuff) around a tube segment at height y. */
export function band(seg: TubeSeg, y: number, offset: number, thickness: number, height = thickness * 2, sides = seg.sides): BufferGeometry {
  const rings: GridRing[] = [];
  const K = 4;
  for (let k = 0; k <= K; k++) {
    const a = -Math.PI / 2 + (k / K) * Math.PI;
    const out = offset + thickness * Math.cos(a);
    const yy = y + (height / 2) * Math.sin(a);
    // each ring follows the surface at its own height (bands on sloping shoulders or tapering limbs)
    const r = ringAt(seg, yy);
    rings.push({ y: yy, rx: r.rx + out, rz: r.rz + out, cx: r.cx, cz: r.cz });
  }
  return ringGrid(rings, sides * 2);
}

/**
 * A patch that conforms to a tube segment (pocket, panel, stripe): y0..y1 and angles t0..t1 (theta
 * convention of ringGrid), at the given offset. Single grid, faces outward.
 */
export function tubePatch(seg: TubeSeg, y0: number, y1: number, t0: number, t1: number, offset: number | ((u: number, v: number) => number), cols = 6, rows = 4): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rows; i++) {
    const y = y0 + ((y1 - y0) * i) / rows;
    const r = ringAt(seg, y);
    for (let j = 0; j <= cols; j++) {
      const t = t0 + ((t1 - t0) * j) / cols;
      const d = typeof offset === 'number' ? offset : offset(j / cols, i / rows);
      pos.push(r.cx + (r.rx + d) * Math.cos(t), y, r.cz + (r.rz + d) * Math.sin(t));
    }
  }
  const w = cols + 1;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * w + j;
      idx.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Point on a tube's offset surface at (y, theta). */
export function onTube(seg: TubeSeg, y: number, t: number, offset: number, out = new Vector3()): Vector3 {
  const r = ringAt(seg, y);
  return out.set(r.cx + (r.rx + offset) * Math.cos(t), y, r.cz + (r.rz + offset) * Math.sin(t));
}

/**
 * Offset shell of an ellipsoid segment, optionally keeping only the part where keep(unit direction) is
 * true (whole latitude rows are kept or dropped by their centre, so the edge stays a clean ring).
 */
export function ellipsoidShell(seg: EllipsoidSeg, offset: number, ws = seg.sides, hs = 10, keepRow?: (v: number) => boolean): BufferGeometry {
  const [cx, cy, cz] = seg.centre;
  const [a, b, c] = seg.radii;
  const rings: GridRing[] = [];
  let bottomPole: Vector3 | undefined = new Vector3(cx, cy - b - offset, cz);
  let topPole: Vector3 | undefined = new Vector3(cx, cy + b + offset, cz);
  for (let k = 1; k < hs; k++) {
    const v = -Math.PI / 2 + (k / hs) * Math.PI;
    if (keepRow && !keepRow(v)) {
      if (v < 0) bottomPole = undefined;
      else topPole = undefined;
      continue;
    }
    const cv = Math.cos(v);
    rings.push({ y: cy + (b + offset) * Math.sin(v), rx: (a + offset) * cv, rz: (c + offset) * cv, cx, cz });
  }
  if (keepRow && !keepRow(-Math.PI / 2)) bottomPole = undefined;
  if (keepRow && !keepRow(Math.PI / 2)) topPole = undefined;
  return ringGrid(rings, ws, bottomPole, topPole);
}

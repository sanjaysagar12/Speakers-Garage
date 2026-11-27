import { BufferAttribute, BufferGeometry, CatmullRomCurve3, SphereGeometry, Vector3, type Material } from 'three';
import { smoothstep } from '@speakersgarage/shared';
import type { ModelBuilder, VertexMask } from '../util/builder';
import { HEAD } from './rig';

/**
 * Hats are fitted to the head from the rig: the dome is the head ellipsoid grown by `margin` (room for
 * flattened hair), cut by a tilted band plane that runs from the forehead line to above the nape and stays
 * above the ears. Brims start on that band. The same fit drives the hair mask (hair inside the hat is not
 * drawn, hair below the band is tucked to the scalp), so no combination needs hand fixing.
 *
 * Head space: origin = head centre, +y up, +z = face.
 */

export interface HatFit {
  id: string;
  /** dome = head radii + margin; crown scales the dome's height */
  margin: number;
  crown: number;
  /** flat top (sun hat) at this height, or none */
  flatTop?: number;
  /** band plane: y = bandY0 + bandSlope * z */
  bandY0: number;
  bandSlope: number;
  /** rolled edge radius at the band */
  rim: number;
  /** back opening (cap adjuster): half-width and height above the band at the back, or none */
  opening?: { halfWidth: number; height: number };
  brim: { kind: 'front' | 'round'; width: number; droop: number; thick: number; spread?: number };
  /** how far below the band hair is pulled in towards the scalp */
  tuck: number;
  /** wide brims flatten the hair under them (0..1, 1 = no change) */
  squash: number;
}

export const HAT_FITS: Record<string, HatFit> = {
  cap: {
    id: 'cap',
    margin: 0.014,
    crown: 1,
    bandY0: 0.03,
    bandSlope: 0.3,
    rim: 0.0045,
    opening: { halfWidth: 0.036, height: 0.045 },
    brim: { kind: 'front', width: 0.078, droop: 0.016, thick: 0.006, spread: 1.15 },
    tuck: 0.05,
    squash: 1,
  },
  sun_hat: {
    id: 'sun_hat',
    margin: 0.016,
    crown: 1.16,
    flatTop: 0.142,
    bandY0: 0.045,
    bandSlope: 0.1,
    rim: 0.004,
    brim: { kind: 'round', width: 0.1, droop: 0.032, thick: 0.007 },
    tuck: 0.08,
    squash: 0.7,
  },
};

/** how much a cap bill's sides curve down (m at the tips) */
const SIDE_CURL = 0.006;

export const hatFit = (id: string): HatFit | null => HAT_FITS[id] ?? null;

export const bandY = (f: HatFit, z: number) => f.bandY0 + f.bandSlope * z;

const domeRadii = (f: HatFit): [number, number, number] => [HEAD.radii[0] + f.margin, (HEAD.radii[1] + f.margin) * f.crown, HEAD.radii[2] + f.margin];

/** Point on the dome at azimuth theta (0 = +x, pi/2 = +z front) and polar angle phi (0 = top). */
export function domePoint(f: HatFit, theta: number, phi: number, extra = 0, out = new Vector3()): Vector3 {
  const [a, b, c] = domeRadii(f);
  out.set((a + extra) * Math.sin(phi) * Math.cos(theta), (b + extra) * Math.cos(phi), (c + extra) * Math.sin(phi) * Math.sin(theta));
  if (f.flatTop !== undefined && out.y > f.flatTop + extra) out.y = f.flatTop + extra;
  return out;
}

const PHI_TABLE = 256;
const phiTables = new WeakMap<HatFit, Float64Array>();

/** Polar angle where the dome meets the band plane at azimuth theta (tabulated per hat, interpolated). */
export function bandPhi(f: HatFit, theta: number): number {
  let tab = phiTables.get(f);
  if (!tab) {
    tab = new Float64Array(PHI_TABLE + 1);
    for (let i = 0; i <= PHI_TABLE; i++) tab[i] = solveBandPhi(f, (i / PHI_TABLE) * Math.PI * 2);
    phiTables.set(f, tab);
  }
  const u = ((((theta / (Math.PI * 2)) % 1) + 1) % 1) * PHI_TABLE;
  const i = Math.floor(u);
  return tab[i] + (tab[i + 1] - tab[i]) * (u - i);
}

function solveBandPhi(f: HatFit, theta: number): number {
  let lo = 0.05;
  let hi = Math.PI * 0.95;
  const p = new Vector3();
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    domePoint(f, theta, mid, 0, p);
    if (p.y > bandY(f, p.z)) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Inside the back opening (looking from behind, an arch above the band). */
function inOpening(f: HatFit, p: Vector3): boolean {
  if (!f.opening || p.z > -0.04) return false;
  const h = p.y - bandY(f, p.z);
  const w = f.opening.halfWidth * Math.sqrt(Math.max(0, 1 - (h / f.opening.height) ** 2));
  return h >= -0.004 && h <= f.opening.height && Math.abs(p.x) <= w;
}

/** Dome shell between the band (plus `fromH`) and the top, at an extra offset. Faces outward. */
function dome(f: HatFit, extra: number, fromH = 0, toH = Infinity, n = 28, rows = 9): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const p = new Vector3();
  const grid: number[][] = [];
  for (let i = 0; i <= rows; i++) grid.push([]);
  for (let j = 0; j < n; j++) {
    const t = (j / n) * Math.PI * 2;
    const pb = bandPhi(f, t);
    for (let i = 0; i <= rows; i++) {
      // rows from the band (i = 0) up to near the top
      let phi = pb * (1 - i / (rows + 1));
      domePoint(f, t, phi, extra, p);
      const h = p.y - bandY(f, p.z);
      if (h < fromH) {
        // bisect phi for the requested height above the band
        let lo = phi * 0.2;
        let hi = pb;
        for (let k = 0; k < 30; k++) {
          const mid = (lo + hi) / 2;
          domePoint(f, t, mid, extra, p);
          if (p.y - bandY(f, p.z) > fromH) lo = mid;
          else hi = mid;
        }
        phi = (lo + hi) / 2;
        domePoint(f, t, phi, extra, p);
      }
      grid[i][j] = pos.length / 3;
      pos.push(p.x, p.y, p.z);
    }
  }
  const top = pos.length / 3;
  pos.push(0, f.flatTop !== undefined ? f.flatTop + extra : domeRadii(f)[1] + extra, 0);
  const keepFace = (ids: number[]) => {
    const c = new Vector3();
    for (const id of ids) c.add(new Vector3(pos[id * 3], pos[id * 3 + 1], pos[id * 3 + 2]));
    c.divideScalar(ids.length);
    const h = c.y - bandY(f, c.z);
    return !inOpening(f, c) && h <= toH;
  };
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < n; j++) {
      const a = grid[i][j];
      const b = grid[i][(j + 1) % n];
      const c = grid[i + 1][j];
      const d = grid[i + 1][(j + 1) % n];
      if (keepFace([a, b, c, d])) idx.push(a, c, b, b, c, d);
    }
  }
  if (toH === Infinity) for (let j = 0; j < n; j++) idx.push(grid[rows][j], top, grid[rows][(j + 1) % n]);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Closed tube along a closed loop of points (rolled hat band). */
function loopTube(pts: Vector3[], r: number, radial = 6, segs = 48): BufferGeometry {
  const curve = new CatmullRomCurve3(pts, true, 'centripetal');
  const pos: number[] = [];
  const idx: number[] = [];
  const frames = curve.computeFrenetFrames(segs, true);
  for (let i = 0; i < segs; i++) {
    const c = curve.getPointAt(i / segs);
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const v = c.clone().addScaledVector(frames.normals[i], Math.cos(a) * r).addScaledVector(frames.binormals[i], Math.sin(a) * r);
      pos.push(v.x, v.y, v.z);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let k = 0; k < radial; k++) {
      const a = i * radial + k;
      const b = i * radial + ((k + 1) % radial);
      const c = ((i + 1) % segs) * radial + k;
      const d = ((i + 1) % segs) * radial + ((k + 1) % radial);
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // make sure faces point outward from the loop's axis (Frenet frames may flip handedness)
  const n = g.attributes.normal;
  const p = g.attributes.position;
  let dot = 0;
  for (let i = 0; i < p.count; i++) dot += n.getX(i) * p.getX(i) + n.getZ(i) * p.getZ(i);
  if (dot < 0) {
    const ix = g.index!;
    for (let t = 0; t < ix.count; t += 3) {
      const a = ix.getX(t + 1);
      ix.setX(t + 1, ix.getX(t + 2));
      ix.setX(t + 2, a);
    }
    g.computeVertexNormals();
  }
  return g;
}

/** Band loop at the dome edge. */
function bandLoop(f: HatFit, extra: number, n = 32): Vector3[] {
  const out: Vector3[] = [];
  for (let j = 0; j < n; j++) {
    const t = (j / n) * Math.PI * 2;
    out.push(domePoint(f, t, bandPhi(f, t), extra));
  }
  return out;
}

/**
 * Brim as a closed slab: top and bottom surfaces from the band outward, plus the outer edge. For a front
 * brim (cap bill) the width tapers to zero at the ends of the arc and the sides curve down.
 */
function brim(f: HatFit): BufferGeometry {
  const B = f.brim;
  const front = B.kind === 'front';
  const n = front ? 16 : 40;
  const rows = 5;
  const spread = B.spread ?? 1.15;
  const pos: number[] = [];
  const idx: number[] = [];
  const at = (j: number) => (front ? Math.PI / 2 - spread + (2 * spread * j) / n : (j / n) * Math.PI * 2);
  const cols = front ? n + 1 : n;
  const layer = (dy: number) => {
    const base = pos.length / 3;
    for (let j = 0; j < cols; j++) {
      const t = at(j);
      const root = domePoint(f, t, bandPhi(f, t), f.rim * 0.6);
      const out = new Vector3(root.x, 0, root.z).normalize();
      const u = front ? (t - Math.PI / 2) / spread : 0;
      const L = front ? B.width * Math.pow(Math.max(0, 1 - u * u), 0.55) : B.width;
      for (let i = 0; i <= rows; i++) {
        const s = i / rows;
        const p = root.clone().addScaledVector(out, L * s);
        p.y = root.y - B.droop * s * s - (front ? SIDE_CURL * u * u * s : 0) + dy;
        // the bill rises very slightly where it leaves the band so it never dips into the forehead
        if (front) p.y += 0.002 * (1 - s);
        pos.push(p.x, p.y, p.z);
      }
    }
    return base;
  };
  const top = layer(0);
  const bot = layer(-B.thick);
  const w = rows + 1;
  const quads = (base: number, flip: boolean) => {
    for (let j = 0; j < (front ? cols - 1 : cols); j++) {
      const j2 = (j + 1) % cols;
      for (let i = 0; i < rows; i++) {
        const a = base + j * w + i;
        const b = base + j * w + i + 1;
        const c = base + j2 * w + i;
        const d = base + j2 * w + i + 1;
        if (flip) idx.push(a, b, c, c, b, d);
        else idx.push(a, c, b, c, d, b);
      }
    }
  };
  quads(top, false);
  quads(bot, true);
  // outer edge strip
  for (let j = 0; j < (front ? cols - 1 : cols); j++) {
    const j2 = (j + 1) % cols;
    const a = top + j * w + rows;
    const b = top + j2 * w + rows;
    const c = bot + j * w + rows;
    const d = bot + j2 * w + rows;
    idx.push(a, c, b, b, c, d);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Build a hat into `b` (already in the head bone's frame). */
export function buildHat(b: ModelBuilder, mat: Material, trim: Material, id: string): void {
  const f = hatFit(id);
  if (!f) return;
  b.add(dome(f, 0), { mat });
  b.add(loopTube(bandLoop(f, f.rim * 0.6), f.rim), { mat });
  b.add(brim(f), { mat });
  if (id === 'cap') {
    // button on top, six seams, and the adjuster strap across the back opening
    b.add(new SphereGeometry(0.011, 8, 6), { mat, pos: [0, domeRadii(f)[1] + 0.004, 0] });
    for (let k = 0; k < 6; k++) {
      const t = (k / 6) * Math.PI * 2 + Math.PI / 6;
      const pts: Vector3[] = [];
      const pb = bandPhi(f, t);
      for (let i = 1; i <= 6; i++) pts.push(domePoint(f, t, pb * (1 - i / 7), 0.0015));
      if (pts.some((p) => inOpening(f, p))) continue;
      b.add(seam(pts), { mat, color: '#C9C9C9' });
    }
    b.add(seamTube(strapPoints(f), 0.0055, 0.0025), { mat, color: '#9A9A9A' });
  } else if (id === 'sun_hat') {
    // coloured ribbon round the crown, just above the brim
    b.add(dome(f, 0.0025, 0.002, 0.03, 40, 9), { mat: trim });
  }
}

/** The adjuster strap across the bottom of a cap's back opening. */
function strapPoints(f: HatFit): Vector3[] {
  const o = f.opening!;
  const zb = -HEAD.radii[2] - f.margin;
  const y = bandY(f, zb) + 0.007;
  return [new Vector3(-o.halfWidth - 0.006, y, zb + 0.012), new Vector3(0, y - 0.002, zb - 0.004), new Vector3(o.halfWidth + 0.006, y, zb + 0.012)];
}

function nearStrap(f: HatFit, p: Vector3, r: number): boolean {
  if (!f.opening || p.z > -0.08) return false;
  const pts = strapPoints(f);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const ab = pts[i + 1].clone().sub(a);
    const t = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / ab.lengthSq()));
    if (a.clone().addScaledVector(ab, t).distanceTo(p) < r) return true;
  }
  return false;
}

function seam(pts: Vector3[]): BufferGeometry {
  return seamTube(pts, 0.0018, 0.0018);
}

function seamTube(pts: Vector3[], rx: number, ry: number): BufferGeometry {
  const curve = new CatmullRomCurve3(pts, false, 'centripetal');
  const g = new BufferGeometry();
  const pos: number[] = [];
  const idx: number[] = [];
  const segs = 10;
  const radial = 5;
  const frames = curve.computeFrenetFrames(segs, false);
  for (let i = 0; i <= segs; i++) {
    const c = curve.getPointAt(i / segs);
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const v = c.clone().addScaledVector(frames.normals[i], Math.cos(a) * rx).addScaledVector(frames.binormals[i], Math.sin(a) * ry);
      pos.push(v.x, v.y, v.z);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let k = 0; k < radial; k++) {
      const a = i * radial + k;
      const b = i * radial + ((k + 1) % radial);
      idx.push(a, b, a + radial, b, b + radial, a + radial);
    }
  }
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ---------------------------------------------------------------- hair vs hat ----------------------------- */

/**
 * The hat's volume (for the mask and the fit test): the space under the dome above the band (minus the
 * back opening), the rolled band, and the brim slab. Points inside the head do not count.
 */
export function insideHat(f: HatFit, p: Vector3, pad = 0): boolean {
  const u = p.clone().normalize();
  const dist = p.length();
  if (dist < HEAD.surface(u) - 1e-4) return false;
  const [a, b, c] = domeRadii(f);
  const h = p.y - bandY(f, p.z);
  if (nearStrap(f, p, 0.0065 + pad)) return true;
  // dome cavity + shell
  const outer = (p.x / (a + 0.003 + pad)) ** 2 + (Math.min(p.y, f.flatTop ?? Infinity) / (b + 0.003 + pad)) ** 2 + (p.z / (c + 0.003 + pad)) ** 2;
  if (h > 0 && outer <= 1 && !inOpening(f, p)) return true;
  // the rolled rim along the band
  const tr = Math.atan2(p.z, p.x);
  const rp = domePoint(f, tr, bandPhi(f, tr), f.rim * 0.6);
  if (rp.distanceTo(p) < f.rim + pad && !inOpening(f, p)) return true;
  if (f.flatTop !== undefined && p.y > f.flatTop + 0.003 + pad && h > 0) return false;
  // brim slab
  const horiz = Math.hypot(p.x, p.z);
  const t = Math.atan2(p.z, p.x);
  const B = f.brim;
  if (B.kind === 'front') {
    const u2 = (t - Math.PI / 2) / (B.spread ?? 1.15);
    if (Math.abs(u2) > 1) return false;
  }
  const root = domePoint(f, t, bandPhi(f, t), f.rim * 0.6);
  const r0 = Math.hypot(root.x, root.z);
  const uu = B.kind === 'front' ? (t - Math.PI / 2) / (B.spread ?? 1.15) : 0;
  const L = B.kind === 'front' ? B.width * Math.pow(Math.max(0, 1 - uu * uu), 0.55) : B.width;
  if (horiz < r0 - pad || horiz > r0 + L + pad) return false;
  const s = Math.min(1, Math.max(0, (horiz - r0) / Math.max(L, 1e-6)));
  const yTop = root.y - B.droop * s * s - (B.kind === 'front' ? SIDE_CURL * uu * uu * s : 0) + (B.kind === 'front' ? 0.002 * (1 - s) : 0);
  return p.y <= yTop + pad && p.y >= yTop - B.thick - pad;
}

/** Hair lying on the scalp keeps 2 mm off the skin (no shimmer); hair deliberately sunk into the skull stays. */
export function skinClear(p: Vector3): void {
  const len = p.length();
  if (len < 1e-6) return;
  const surf = HEAD.surface(p.clone().divideScalar(len));
  const s = len - surf;
  if (s > -0.003 && s < 0.002) p.multiplyScalar((surf + 0.002) / len);
  // ears: hair passing over an ear lies on it, a few millimetres off
  const E = HEAD.ear;
  if (Math.abs(p.x) > 0.06) {
    const sx = Math.sign(p.x);
    // into the ear's own frame (the body turns each ear by sx * 0.3 about y)
    const a = -sx * 0.3;
    const wx = p.x - sx * E.x;
    const wz = p.z - E.z;
    const dx = wx * Math.cos(a) + wz * Math.sin(a);
    const dz = -wx * Math.sin(a) + wz * Math.cos(a);
    const dy = p.y - E.y;
    const k = Math.sqrt((dx / (E.rx + 0.012)) ** 2 + (dy / (E.ry + 0.012)) ** 2 + (dz / (E.rz + 0.012)) ** 2);
    if (k < 1 && k > 0.2 && dx * sx > -0.004) {
      const lx = dx / k;
      const lz = dz / k;
      p.set(sx * E.x + lx * Math.cos(a) - lz * Math.sin(a), E.y + dy / k, E.z + lx * Math.sin(a) + lz * Math.cos(a));
    }
  }
}

/** Mask for hair without a hat: only the skin clearance. */
export const bareHairMask: VertexMask = {
  hidden: deepInSkull,
  // sink it further, so a triangle reaching out of the skull leaves it steeply (not along the ear top)
  hide: (p) => {
    const len = p.length();
    if (len > 1e-6) p.multiplyScalar((HEAD.surface(p.clone().divideScalar(len)) * 0.85) / len);
  },
  adjust: skinClear,
};

/** Hair pulled well inside the skull (the hair cap below the hair line): never visible, its faces are dropped. */
function deepInSkull(p: Vector3): boolean {
  const len = p.length();
  return len > 1e-6 && len - HEAD.surface(p.clone().divideScalar(len)) < -0.004;
}

/**
 * The hair mask for a hat: hair inside the hat volume is hidden (pulled inside the skull and its triangles
 * dropped when fully hidden); hair hanging below the band is tucked towards the scalp so it comes out
 * from under the rim instead of bulging through it; wide brims squash the hair under them.
 */
export function hairMask(f: HatFit): VertexMask {
  const m = f.margin - f.rim * 2 - 0.0015;
  const u = new Vector3();
  return {
    hidden: (p) => {
      const h = p.y - bandY(f, p.z);
      // everything above the band near the head is under the hat, except what leaves through the opening
      if (h > -0.001 && !inOpening(f, p)) {
        u.copy(p).normalize();
        return p.length() < HEAD.surface(u) + 0.07;
      }
      return deepInSkull(p) || insideHat(f, p, 0.003);
    },
    hide: (p) => {
      u.copy(p).normalize();
      p.copy(u).multiplyScalar(HEAD.surface(u) * 0.9);
    },
    adjust: (p) => {
      const dd = bandY(f, p.z) - p.y;
      if (dd < 0 || dd > f.tuck * 1.6) return skinClear(p);
      u.copy(p).normalize();
      const surf = HEAD.surface(u);
      const s = p.length() - surf;
      if (s <= 0) return;
      let k = smoothstep(0, f.tuck, dd);
      if (f.squash < 1) k *= f.squash + (1 - f.squash) * smoothstep(f.tuck * 0.6, f.tuck * 1.6, dd);
      const allowed = s > m ? m + (s - m) * k : s;
      p.copy(u).multiplyScalar(surf + allowed);
      // pulling in towards the centre raises points at the back: never above the band
      p.y = Math.min(p.y, bandY(f, p.z) - 0.002);
      skinClear(p);
    },
  };
}

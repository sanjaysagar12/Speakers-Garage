import { ConeGeometry, CylinderGeometry, Group, IcosahedronGeometry, Matrix4, Quaternion, Vector3 } from 'three';
import { ModelBuilder } from './util/builder';
import { ellipsoid, lathe, ribbon, rng, range, rockGeo, slab, starOutline, sweep } from './util/geo';
import { toon } from '../materials/toon';
import { PAL } from './palette';

const UP = new Vector3(0, 1, 0);

/** Matrix that places a +Y-aligned part from a to b. */
function alignY(a: Vector3, b: Vector3, scaleXZ = 1): Matrix4 {
  const d = new Vector3().subVectors(b, a);
  const len = d.length();
  const q = new Quaternion().setFromUnitVectors(UP, d.clone().normalize());
  return new Matrix4().compose(a, q, new Vector3(scaleXZ, len, scaleXZ));
}

/* ------------------------------------------------------------------ palm ------------------------------ */

export interface PalmParams {
  variant?: 0 | 1 | 2;
  height?: number;
  /** 0 = full detail, 1 = distant (same silhouette: same random sequence, coarser meshes, no coconuts) */
  lod?: 0 | 1;
}

function palmTrunk(b: ModelBuilder, base: Vector3, height: number, lean: number, leanDir: number, rBase: number, lod: number): Vector3 {
  const dir = new Vector3(Math.cos(leanDir), 0, Math.sin(leanDir));
  const at = (t: number) =>
    base
      .clone()
      .addScaledVector(dir, lean * height * Math.pow(t, 1.7))
      .add(new Vector3(0, height * t, 0));
  const segs = Math.round(height / (lod ? 0.7 : 0.34));
  // a base flare that sinks into the sand so the palm never floats
  b.add(lathe([[rBase * 1.9, -0.35], [rBase * 1.55, 0.02], [rBase * 1.12, 0.22], [rBase, 0.42]], lod ? 6 : 8), {
    color: PAL.trunkDark,
    pos: [base.x, base.y, base.z],
  });
  const unit = lathe([[1.0, 0], [1.12, 0.12], [0.98, 0.62], [0.86, 1.0]], lod ? 5 : 7);
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    // per-segment jitter from the index (not the shared rng) so every LOD keeps the same random sequence
    const rad = rBase * (1 - 0.42 * t0) * (1 + 0.04 * Math.sin(i * 12.9898 + height * 7.31));
    b.add(unit, { color: i % 2 ? PAL.trunk : PAL.trunkDark, matrix: alignY(at(t0), at(t1).add(new Vector3(0, 0.02, 0)), rad) });
  }
  return at(1);
}

function palmCrown(b: ModelBuilder, r: () => number, top: Vector3, fronds: number, size: number, lod: number): void {
  const frondMat = toon({ back: PAL.palmUnder, sway: 0.55 });
  const a0 = r() * Math.PI * 2;
  for (let k = 0; k < fronds; k++) {
    const az = a0 + (k / fronds) * Math.PI * 2 + range(r, -0.18, 0.18);
    const len = size * range(r, 0.85, 1.12);
    const rise = range(r, 0.05, 0.55); // some fronds stand up, others droop
    const dir = new Vector3(Math.cos(az), 0, Math.sin(az));
    const p = (f: number, h: number) => top.clone().addScaledVector(dir, len * f).add(new Vector3(0, len * h, 0));
    const pts = [p(0, 0), p(0.28, 0.12 + rise * 0.22), p(0.56, 0.08 + rise * 0.16), p(0.8, -0.1 + rise * 0.02), p(1.0, -0.36 + rise * 0.06)];
    const teeth = 13;
    const geo = ribbon(pts, (t) => (t < 0.08 ? 0.03 : 0.46 * size * 0.22 * Math.sin(Math.PI * Math.pow(t, 0.7)) * (1 - t * 0.2)), {
      // 2 segments per serration tooth at full detail; distant palms drop the serration
      segs: lod ? 10 : 26,
      across: 1,
      fold: (t) => 0.07 * size * 0.22 * Math.sin(Math.PI * t),
      // serrated leaflet edge: a sawtooth that cuts deeper toward the tip
      edge: lod ? undefined : (t, side) => -(0.34 + 0.3 * t) * (((t * teeth + (side > 0 ? 0 : 0.5)) % 1) ** 1.6),
    });
    b.add(geo, {
      color: k % 2 ? PAL.palmLight : PAL.palmMid,
      mat: frondMat,
      sway: (v) => Math.min(1, v.distanceTo(top) / len) ** 1.3 + 0.12,
    });
    geo.dispose();
  }
  // crown knot + coconuts
  b.add(ellipsoid(0.22, 0.2, 0.22, lod ? 6 : 8, lod ? 5 : 6), { color: PAL.trunkDark, pos: [top.x, top.y - 0.08, top.z] });
  const nuts = 3 + Math.floor(r() * 3);
  for (let i = 0; i < nuts; i++) {
    // two draws per nut at every LOD, so LOD0 and LOD1 stay the same tree
    const a = r() * Math.PI * 2;
    const dy = r() * 0.08;
    if (lod) continue;
    b.add(ellipsoid(0.13, 0.15, 0.13, 8, 6), {
      color: i % 2 ? PAL.coconut : '#8C6438',
      pos: [top.x + Math.cos(a) * 0.17, top.y - 0.2 - dy, top.z + Math.sin(a) * 0.17],
    });
  }
}

export function buildPalm(p: PalmParams = {}, seed = 1): Group {
  const r = rng(seed);
  const variant = p.variant ?? (Math.floor(r() * 3) as 0 | 1 | 2);
  const lod = p.lod ?? 0;
  const b = new ModelBuilder();
  const leanDir = r() * Math.PI * 2;
  if (variant === 0) {
    const h = p.height ?? range(r, 5.8, 7.2);
    const top = palmTrunk(b, new Vector3(0, 0, 0), h, range(r, 0.22, 0.36), leanDir, 0.2, lod);
    palmCrown(b, r, top, 10 + Math.floor(r() * 3), 3.1, lod);
  } else if (variant === 1) {
    const h = p.height ?? range(r, 3.6, 4.6);
    const top = palmTrunk(b, new Vector3(0, 0, 0), h, range(r, 0.04, 0.1), leanDir, 0.22, lod);
    palmCrown(b, r, top, 9 + Math.floor(r() * 2), 2.6, lod);
  } else {
    // twin palm: two trunks diverging from one root
    const h = p.height ?? range(r, 5.2, 6.4);
    const top1 = palmTrunk(b, new Vector3(0.12, 0, 0), h, range(r, 0.42, 0.58), leanDir, 0.18, lod);
    const top2 = palmTrunk(b, new Vector3(-0.12, 0, 0.05), h * 0.78, range(r, 0.3, 0.42), leanDir + Math.PI * range(r, 0.6, 0.9), 0.17, lod);
    palmCrown(b, r, top1, 9 + Math.floor(r() * 3), 2.9, lod);
    palmCrown(b, r, top2, 8 + Math.floor(r() * 2), 2.5, lod);
  }
  return b.build('palm');
}

/* ------------------------------------------------------------------ rocks ----------------------------- */

export function buildRock(p: { size?: number; tone?: 'warm' | 'cool' } = {}, seed = 1): Group {
  const r = rng(seed);
  const s = p.size ?? range(r, 0.5, 1.2);
  const b = new ModelBuilder();
  const mat = toon({ flat: true });
  const main = rockGeo(seed, s * range(r, 0.9, 1.3), s * range(r, 0.45, 0.7), s * range(r, 0.8, 1.1), 1);
  b.add(main, { color: p.tone === 'cool' ? PAL.rockCool : PAL.rock, mat, pos: [0, s * 0.18, 0], rot: [0, r() * 6, 0] });
  const n = 1 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const ss = s * range(r, 0.3, 0.55);
    b.add(rockGeo(seed * 7 + i, ss, ss * 0.6, ss * 0.9, 0), {
      color: i % 2 ? PAL.rockDark : PAL.rock,
      mat,
      pos: [Math.cos(a) * s * 0.95, ss * 0.12, Math.sin(a) * s * 0.95],
      rot: [0, r() * 6, 0],
    });
  }
  return b.build('rock');
}

/** Tall faceted cliff block used for the headland and the map's land-side rim. */
export function buildCliff(p: { w?: number; h?: number; d?: number } = {}, seed = 1): Group {
  const r = rng(seed);
  const w = p.w ?? 6;
  const h = p.h ?? 4;
  const d = p.d ?? 4;
  const b = new ModelBuilder();
  const mat = toon({ flat: true });
  const n = 3 + Math.floor(w / 2.2);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const hh = h * range(r, 0.65, 1.1);
    b.add(rockGeo(seed * 13 + i, w / n * range(r, 0.9, 1.3), hh, d * range(r, 0.4, 0.6), 1), {
      color: i % 3 === 0 ? PAL.rockDark : PAL.rock,
      mat,
      pos: [(t - 0.5) * w, hh * 0.55, range(r, -0.3, 0.3) * d * 0.4],
      rot: [range(r, -0.1, 0.1), r() * 6, range(r, -0.1, 0.1)],
    });
  }
  // a few green tufts of scrub on top so the cliff tops read as land
  for (let i = 0; i < 3; i++) {
    b.add(new IcosahedronGeometry(0.5, 1), {
      color: i % 2 ? PAL.bush : PAL.grassDark,
      pos: [range(r, -0.4, 0.4) * w, h * range(r, 0.8, 1.0), range(r, -0.2, 0.2) * d],
      scale: [range(r, 0.8, 1.6), 0.6, range(r, 0.8, 1.4)],
    });
  }
  return b.build('cliff');
}

/* ------------------------------------------------------------------ plants ---------------------------- */

export function buildBush(p: { size?: number; flowers?: boolean } = {}, seed = 1): Group {
  const r = rng(seed);
  const s = p.size ?? range(r, 0.55, 1.0);
  const b = new ModelBuilder();
  const mat = toon({ sway: 0.12 });
  const n = 4 + Math.floor(r() * 4);
  const blob = new IcosahedronGeometry(1, 2);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const d = i === 0 ? 0 : range(r, 0.3, 0.7) * s;
    const rr = s * range(r, 0.42, 0.62) * (i === 0 ? 1.2 : 1);
    b.add(blob, {
      color: i % 3 === 0 ? PAL.bushLight : PAL.bush,
      mat,
      pos: [Math.cos(a) * d, rr * 0.75 + (i === 0 ? s * 0.15 : 0), Math.sin(a) * d],
      scale: [rr, rr * 0.85, rr],
      sway: (v) => Math.max(0, v.y) * 0.6,
    });
  }
  if (p.flowers) {
    for (let i = 0; i < 6; i++) {
      const a = r() * Math.PI * 2;
      b.add(new IcosahedronGeometry(0.07, 0), {
        color: i % 2 ? PAL.pink : PAL.offWhite,
        pos: [Math.cos(a) * s * 0.6, s * range(r, 0.7, 1.1), Math.sin(a) * s * 0.6],
      });
    }
  }
  blob.dispose();
  return b.build('bush');
}

/** One grass tuft (geometry only; instanced by the world). Blades are curved tapered ribbons. */
export function buildGrassTuft(seed = 1, tall = 1): ModelBuilder {
  const r = rng(seed);
  const b = new ModelBuilder();
  const mat = toon({ swayByHeight: 1.6, sway: 0.25, double: true, grain: 0.5 });
  const n = 6 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.6;
    const h = range(r, 0.28, 0.55) * tall;
    const lean = range(r, 0.12, 0.3) * tall;
    const dir = new Vector3(Math.cos(a), 0, Math.sin(a));
    const pts = [new Vector3(0, -0.02, 0), dir.clone().multiplyScalar(lean * 0.3).setY(h * 0.55), dir.clone().multiplyScalar(lean).setY(h)];
    b.add(ribbon(pts, (t) => 0.035 * (1 - t), { segs: 4, across: 1, up: dir }), {
      color: i % 2 ? PAL.grass : PAL.grassDark,
      mat,
    });
  }
  return b;
}

export function buildFlower(color: string, seed = 1): ModelBuilder {
  const r = rng(seed);
  const b = new ModelBuilder();
  const mat = toon({ swayByHeight: 2.2, sway: 0.18 });
  const stems = 3;
  for (let s = 0; s < stems; s++) {
    const a = r() * Math.PI * 2;
    const x = Math.cos(a) * 0.08;
    const z = Math.sin(a) * 0.08;
    const h = range(r, 0.18, 0.32);
    b.add(new CylinderGeometry(0.008, 0.01, h, 4), { color: PAL.grassDark, mat, pos: [x, h / 2, z] });
    for (let k = 0; k < 5; k++) {
      const pa = (k / 5) * Math.PI * 2;
      b.add(ellipsoid(0.035, 0.012, 0.022, 5, 3), {
        color,
        mat,
        pos: [x + Math.cos(pa) * 0.03, h, z + Math.sin(pa) * 0.03],
        rot: [0, -pa, 0],
      });
    }
    b.add(new IcosahedronGeometry(0.018, 0), { color: PAL.yellow, mat, pos: [x, h + 0.01, z] });
  }
  return b;
}

/* ------------------------------------------------------------------ shore bits ------------------------ */

export function buildStarfish(color: string = PAL.orange, seed = 1): ModelBuilder {
  const r = rng(seed);
  const b = new ModelBuilder();
  const s = range(r, 0.8, 1.15);
  b.add(slab(starOutline(5, 0.17 * s, 0.06 * s, 3), 0.025, 0.012), { color });
  // raised dotted texture
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + Math.PI / 2;
    const d = 0.07 * s;
    b.add(new IcosahedronGeometry(0.009, 0), { color: '#9C3B2E', pos: [Math.cos(a) * d, 0.04, -Math.sin(a) * d] });
  }
  return b;
}

export function buildConch(seed = 1): ModelBuilder {
  const r = rng(seed);
  const b = new ModelBuilder();
  const prof: Array<[number, number]> = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const bump = 1 + 0.18 * Math.sin(t * Math.PI * 4);
    prof.push([0.06 * Math.sin(Math.PI * Math.pow(t, 0.6)) * bump * (1 - t * 0.6) + 0.004, t * 0.2]);
  }
  const g = lathe(prof, 10);
  g.rotateZ(Math.PI / 2 - 0.25);
  b.add(g, { color: range(r, 0, 1) > 0.5 ? PAL.offWhite : '#F4E3CF', pos: [0.1, 0.05, 0] });
  b.add(ellipsoid(0.03, 0.015, 0.05, 8, 6), { color: '#F2B9A6', pos: [0.02, 0.06, 0.025] });
  return b;
}

export function buildScallop(color: string = PAL.coral): ModelBuilder {
  const b = new ModelBuilder();
  const ribs = 9;
  const outline: Array<[number, number]> = [[0, 0]];
  for (let i = 0; i <= ribs * 4; i++) {
    const a = -1.15 + (i / (ribs * 4)) * 2.3;
    const rr = 0.09 * (1 + 0.06 * Math.cos(i * Math.PI / 2));
    outline.push([Math.sin(a) * rr, Math.cos(a) * rr]);
  }
  b.add(slab(outline, 0.018, 0.012), { color });
  for (let i = 0; i < ribs; i++) {
    const a = -1.0 + (i / (ribs - 1)) * 2.0;
    b.add(new CylinderGeometry(0.005, 0.003, 0.085, 4), {
      color: '#C8584F',
      pos: [Math.sin(a) * 0.045, 0.032, -Math.cos(a) * 0.045],
      rot: [Math.PI / 2, 0, -a],
    });
  }
  return b;
}

export function buildPebble(seed = 1): ModelBuilder {
  const r = rng(seed);
  const b = new ModelBuilder();
  const s = range(r, 0.05, 0.11);
  b.add(rockGeo(seed, s, s * 0.45, s * 0.8, 0), { color: r() > 0.5 ? '#C9BBA8' : '#A9A099', mat: toon({ flat: true }), pos: [0, s * 0.15, 0] });
  return b;
}

export function buildDriftwood(p: { length?: number } = {}, seed = 1): Group {
  const r = rng(seed);
  const L = p.length ?? range(r, 1.6, 2.8);
  const b = new ModelBuilder();
  const pts = [new Vector3(-L / 2, 0.08, 0), new Vector3(-L / 6, 0.12, range(r, -0.15, 0.15)), new Vector3(L / 6, 0.1, range(r, -0.2, 0.2)), new Vector3(L / 2, 0.06, range(r, -0.1, 0.1))];
  b.add(sweep(pts, (t) => 0.11 * (1 - 0.45 * t) + 0.02 * Math.sin(t * 9), 7, 14), { color: PAL.driftwood });
  const br = [new Vector3(0, 0.1, 0), new Vector3(0.25, 0.18, 0.3), new Vector3(0.4, 0.2, 0.62)];
  b.add(sweep(br, (t) => 0.05 * (1 - 0.7 * t), 6, 6), { color: '#C9B391' });
  b.add(lathe([[0.1, 0], [0.12, 0.02], [0.02, 0.05]], 7), { color: '#C9B391', pos: [-L / 2, 0.08, 0], rot: [0, 0, Math.PI / 2] });
  return b.build('driftwood');
}

/* ------------------------------------------------------------------ inland trees (Vinland) ------------ */

export function buildConifer(p: { height?: number } = {}, seed = 1): Group {
  const r = rng(seed);
  const h = p.height ?? range(r, 4, 7);
  const b = new ModelBuilder();
  const mat = toon({ sway: 0.12 });
  b.add(new CylinderGeometry(0.1, 0.18, h * 0.4, 7), { color: PAL.woodDark, pos: [0, h * 0.2 - 0.1, 0] });
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const rad = h * 0.26 * (1 - t * 0.7);
    const ch = h * 0.34;
    b.add(new ConeGeometry(rad, ch, 9), {
      color: i % 2 ? '#3C6042' : '#2E4A35',
      mat,
      pos: [0, h * 0.28 + t * h * 0.55 + ch / 2, 0],
      rot: [0, r() * 3, 0],
      sway: (v) => Math.max(0, v.y / h) * 0.6,
    });
  }
  return b.build('conifer');
}

export function buildBroadleaf(p: { height?: number; color?: string } = {}, seed = 1): Group {
  const r = rng(seed);
  const h = p.height ?? range(r, 3.5, 5.5);
  const b = new ModelBuilder();
  const mat = toon({ sway: 0.1 });
  b.add(new CylinderGeometry(0.12, 0.2, h * 0.6, 7), { color: PAL.woodDark, pos: [0, h * 0.3 - 0.1, 0] });
  const blob = new IcosahedronGeometry(1, 2);
  for (let i = 0; i < 6; i++) {
    const a = r() * Math.PI * 2;
    const d = i === 0 ? 0 : range(r, 0.5, 1.0) * h * 0.18;
    const rr = h * range(r, 0.17, 0.24);
    b.add(blob, {
      color: i % 2 ? (p.color ?? '#5F8740') : '#7BA253',
      mat,
      pos: [Math.cos(a) * d, h * range(r, 0.65, 0.85), Math.sin(a) * d],
      scale: rr,
      sway: (v) => Math.max(0, v.y / h) * 0.5,
    });
  }
  blob.dispose();
  return b.build('broadleaf');
}

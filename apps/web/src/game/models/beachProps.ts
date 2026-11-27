import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ModelBuilder } from './util/builder';
import { ellipsoid, lathe, rng, range, slab, sweep } from './util/geo';
import { toon, type Pattern } from '../materials/toon';
import { PAL } from './palette';

/* ------------------------------------------------------------------ umbrella -------------------------- */

export type UmbrellaStyle = 'radial' | 'rings' | 'mixed';
export interface UmbrellaParams {
  style?: UmbrellaStyle;
  a?: string;
  b?: string;
  radius?: number;
  tilt?: number;
}

/** 8-panel scalloped canopy, apex at origin + (0, h, 0) in its own pattern space. */
function canopyGeometry(R: number, panels = 8): BufferGeometry {
  const perPanel = 6;
  const rings = 7;
  const pos: number[] = [];
  const idx: number[] = [];
  const cols = panels * perPanel;
  pos.push(0, 0.02, 0);
  for (let i = 1; i <= rings; i++) {
    const t = i / rings;
    for (let j = 0; j < cols; j++) {
      const u = (j % perPanel) / perPanel; // 0 at a rib
      const a = (j / cols) * Math.PI * 2;
      const scallop = 1 - 0.075 * Math.sin(Math.PI * u) * Math.pow(t, 3);
      const rr = R * t * scallop;
      const sag = 0.07 * Math.sin(Math.PI * u) * t;
      const y = -0.5 * Math.pow(t, 1.35) * R * 0.5 - sag;
      pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
    }
  }
  for (let j = 0; j < cols; j++) idx.push(0, 1 + ((j + 1) % cols), 1 + j);
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < cols; j++) {
      const a = 1 + i * cols + j;
      const b = 1 + i * cols + ((j + 1) % cols);
      const c = a + cols;
      const d = b + cols;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildUmbrella(p: UmbrellaParams = {}, seed = 1): Group {
  const r = rng(seed);
  const style = p.style ?? (['radial', 'rings', 'mixed'] as const)[Math.floor(r() * 3)];
  const R = p.radius ?? range(r, 1.15, 1.35);
  const a = p.a ?? PAL.offWhite;
  const bcol = p.b ?? PAL.coral;
  const tilt = p.tilt ?? range(r, 0.06, 0.16);
  const tiltDir = r() * Math.PI * 2;
  const H = 2.3;
  const freq = style === 'radial' ? 4 : style === 'rings' ? 3.2 / R : 4;
  const mat = toon({ pattern: style as Pattern, colorB: bcol, color: a, freq, duty: 0.5, double: true });
  const b = new ModelBuilder();
  // the canopy and pole are built upright, then the whole group is tilted
  b.add(canopyGeometry(R), { mat, pos: [0, H, 0] });
  b.add(new CylinderGeometry(0.025, 0.03, H + 0.45, 6), { color: PAL.offWhite, pos: [0, (H - 0.45) / 2, 0] });
  b.add(new SphereGeometry(0.05, 8, 6), { color: bcol, pos: [0, H + 0.04, 0] });
  // ribs under the canopy edge (visible from the low side)
  for (let k = 0; k < 8; k++) {
    const ang = (k / 8) * Math.PI * 2;
    const end = new Vector3(Math.cos(ang) * R * 0.92, H - 0.27, Math.sin(ang) * R * 0.92);
    b.add(sweep([new Vector3(0, H - 0.02, 0), end.clone().lerp(new Vector3(0, H, 0), 0.5).setY(H - 0.1), end], 0.008, 4, 4), {
      color: '#E9E2D6',
    });
  }
  const g = b.build('umbrella');
  // tilt around the base so the pole stays planted
  const pivot = new Group();
  pivot.add(g);
  g.rotation.set(Math.sin(tiltDir) * tilt, 0, Math.cos(tiltDir) * tilt);
  pivot.name = 'umbrella';
  return pivot;
}

/* ------------------------------------------------------------------ lounger & towels ------------------ */

export function buildLounger(p: { a?: string; b?: string; frame?: string } = {}, seed = 1): Group {
  const r = rng(seed);
  const a = p.a ?? PAL.offWhite;
  const bcol = p.b ?? (r() > 0.5 ? PAL.navy : PAL.coral);
  const frame = p.frame ?? (r() > 0.4 ? PAL.offWhite : PAL.woodLight);
  const b = new ModelBuilder();
  const L = 1.95;
  const W = 0.66;
  const seatH = 0.34;
  const legs: Array<[number, number]> = [[-L / 2 + 0.1, -W / 2 + 0.05], [-L / 2 + 0.1, W / 2 - 0.05], [L / 2 - 0.1, -W / 2 + 0.05], [L / 2 - 0.1, W / 2 - 0.05]];
  for (const [x, z] of legs) b.add(new BoxGeometry(0.05, seatH, 0.05), { color: frame, pos: [x, seatH / 2 - 0.05, z] });
  b.add(new BoxGeometry(L, 0.05, 0.05), { color: frame, pos: [0, seatH - 0.02, -W / 2 + 0.03] });
  b.add(new BoxGeometry(L, 0.05, 0.05), { color: frame, pos: [0, seatH - 0.02, W / 2 - 0.03] });
  // striped pad: flat seat part + raised backrest (head end at -x)
  const stripe = toon({ pattern: 'stripes', color: a, colorB: bcol, freq: 5.5, duty: 0.5 });
  const seatLen = L * 0.62;
  b.add(new RoundedBoxGeometry(seatLen, 0.07, W - 0.04, 2, 0.03), { mat: stripe, pos: [L / 2 - seatLen / 2 - 0.02, seatH + 0.03, 0] });
  const backLen = L * 0.4;
  const ang = 0.62;
  const hx = L / 2 - seatLen - 0.02;
  b.add(new RoundedBoxGeometry(backLen, 0.07, W - 0.04, 2, 0.03), {
    mat: stripe,
    pos: [hx - Math.cos(ang) * backLen / 2, seatH + 0.03 + Math.sin(ang) * backLen / 2, 0],
    rot: [0, 0, -ang],
  });
  // back support struts seen from behind
  b.add(new BoxGeometry(0.04, 0.38, 0.04), { color: frame, pos: [hx - backLen * 0.75, seatH + 0.1, -W / 2 + 0.06], rot: [0, 0, 0.5] });
  b.add(new BoxGeometry(0.04, 0.38, 0.04), { color: frame, pos: [hx - backLen * 0.75, seatH + 0.1, W / 2 - 0.06], rot: [0, 0, 0.5] });
  return b.build('lounger');
}

export function buildTowel(p: { a?: string; b?: string; w?: number; l?: number } = {}, seed = 1): Group {
  const r = rng(seed);
  const a = p.a ?? PAL.offWhite;
  const bcol = p.b ?? ([PAL.coral, PAL.navy, PAL.teal] as const)[Math.floor(r() * 3)];
  const L = p.l ?? 1.7;
  const W = p.w ?? 0.85;
  const geo = new BoxGeometry(L, 0.012, W, 14, 1, 6);
  const mat = toon({ pattern: 'stripes', color: a, colorB: bcol, freq: 6, duty: 0.45, sway: 0.16 });
  const b = new ModelBuilder();
  b.add(geo, {
    mat,
    pos: [0, 0.012, 0],
    // corners and the downwind end lift and flap; the middle stays weighted down
    sway: (v) => {
      const ex = Math.abs(v.x) / (L / 2);
      const ez = Math.abs(v.z) / (W / 2);
      return Math.pow(Math.max(0, ex * ez), 3) * 1.2 + Math.pow(Math.max(0, ex - 0.8) * 5, 2) * 0.25;
    },
  });
  return b.build('towel', false);
}

export function buildBeachBall(p: { a?: string; b?: string } = {}, seed = 1): Group {
  const r = rng(seed);
  const b = new ModelBuilder();
  const mat = toon({ pattern: 'radial', color: p.a ?? PAL.offWhite, colorB: p.b ?? (r() > 0.5 ? PAL.coral : PAL.teal), freq: 3, duty: 0.5 });
  b.add(new SphereGeometry(0.22, 18, 12), { mat, pos: [0, 0.21, 0], rot: [0.3, 0, 0.2] });
  return b.build('ball');
}

export function buildFlipFlops(p: { color?: string } = {}, seed = 1): Group {
  const r = rng(seed);
  const c = p.color ?? ([PAL.coral, PAL.teal, PAL.yellow] as const)[Math.floor(r() * 3)];
  const b = new ModelBuilder();
  const sole: Array<[number, number]> = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const rr = 0.13 * (1 + 0.18 * Math.sin(a));
    sole.push([Math.cos(a) * 0.045 * (Math.sin(a) > 0 ? 1.1 : 0.9), Math.sin(a) * rr]);
  }
  for (const side of [-1, 1]) {
    const x = side * 0.07;
    const rot = side * 0.12 + range(r, -0.1, 0.1);
    b.add(slab(sole, 0.018), { color: c, pos: [x, 0, 0], rot: [0, rot, 0] });
    b.add(sweep([new Vector3(x - 0.04, 0.02, 0.03), new Vector3(x, 0.04, -0.06), new Vector3(x + 0.04, 0.02, 0.03)], 0.008, 4, 6), { color: PAL.offWhite });
  }
  return b.build('flipflops', true);
}

/* ------------------------------------------------------------------ sandcastle, surfboard, sign ------- */

export function buildSandcastle(_p: object = {}, seed = 1): Group {
  const r = rng(seed);
  const b = new ModelBuilder();
  const sand = '#EDC478';
  const damp = '#D9A95E';
  b.add(lathe([[1.05, -0.05], [1.0, 0.02], [0.9, 0.04]], 24), { color: damp });
  b.add(lathe([[0.75, -0.05], [0.72, 0.08], [0.6, 0.13], [0.001, 0.14]], 16), { color: damp });
  const tower = (x: number, z: number, h: number, rr: number) => {
    b.add(new CylinderGeometry(rr * 0.92, rr, h, 10), { color: sand, pos: [x, h / 2 + 0.1, z] });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      b.add(new BoxGeometry(rr * 0.4, 0.06, rr * 0.4), { color: sand, pos: [x + Math.cos(a) * rr * 0.75, h + 0.13, z + Math.sin(a) * rr * 0.75], rot: [0, -a, 0] });
    }
  };
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    tower(Math.cos(a) * 0.46, Math.sin(a) * 0.46, range(r, 0.36, 0.46), 0.13);
  }
  tower(0, 0, 0.62, 0.2);
  b.add(new CylinderGeometry(0.001, 0.14, 0.24, 10), { color: sand, pos: [0, 0.86, 0] });
  // walls between the corner towers
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    b.add(new BoxGeometry(0.62, 0.22, 0.08), { color: sand, pos: [Math.cos(a) * 0.46, 0.2, Math.sin(a) * 0.46], rot: [0, -a + Math.PI / 2, 0] });
  }
  b.add(slab([[0, 0], [0.14, 0.045], [0, 0.09]], 0.005), { color: PAL.coral, pos: [0, 1.1, 0], rot: [Math.PI / 2, 0, 0] });
  b.add(new CylinderGeometry(0.005, 0.005, 0.26, 4), { color: PAL.woodDark, pos: [0, 1.02, 0] });
  // a couple of shells pressed into the walls
  b.add(new IcosahedronGeometry(0.03, 0), { color: PAL.offWhite, pos: [0.35, 0.2, 0.55] });
  b.add(new IcosahedronGeometry(0.03, 0), { color: PAL.pink, pos: [-0.5, 0.18, 0.32] });
  return b.build('sandcastle');
}

export function buildSurfboard(p: { a?: string; b?: string; lean?: number } = {}, seed = 1): Group {
  const r = rng(seed);
  const b = new ModelBuilder();
  const c = p.a ?? ([PAL.offWhite, PAL.yellow, PAL.teal, PAL.coral] as const)[Math.floor(r() * 4)];
  const mat = toon({ pattern: 'bands', color: c, colorB: p.b ?? (c === PAL.coral ? PAL.offWhite : PAL.coral), freq: 1.1, duty: 0.14, offset: 0.35 });
  const prof: Array<[number, number]> = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    prof.push([0.27 * Math.pow(Math.sin(Math.PI * t), 0.7) * (1 - 0.25 * t) + 0.002, t * 2.1]);
  }
  const g = lathe(prof, 14);
  g.scale(1, 1, 0.16);
  b.add(g, { mat, pos: [0, -0.35, 0] });
  b.add(new BoxGeometry(0.008, 0.18, 0.1), { color: PAL.black, pos: [0, 0.05, -0.05] });
  const grp = b.build('surfboard');
  const pivot = new Group();
  grp.rotation.set(p.lean ?? range(r, -0.2, 0.2), 0, range(r, -0.18, 0.18));
  pivot.add(grp);
  return pivot;
}

export function buildSignpost(p: { color?: string } = {}, seed = 1): Group {
  const r = rng(seed);
  const b = new ModelBuilder();
  b.add(new BoxGeometry(0.12, 2.1, 0.12), { color: PAL.woodDark, pos: [0, 0.95, 0] });
  const arrow = (len: number): Array<[number, number]> => [[0, -0.13], [len, -0.13], [len + 0.16, 0], [len, 0.13], [0, 0.13]];
  const boards: Array<[number, number, string]> = [
    [1.75, range(r, -0.5, -0.2), p.color ?? PAL.coral],
    [1.42, range(r, 2.4, 2.9), PAL.offWhite],
    [1.1, range(r, 0.9, 1.4), PAL.teal],
  ];
  for (const [y, rot, c] of boards) {
    const g = slab(arrow(0.62), 0.04);
    g.rotateX(Math.PI / 2);
    b.add(g, { color: c, pos: [0, y, 0], rot: [0, rot, 0] });
  }
  b.add(new CylinderGeometry(0.0, 0.1, 0.12, 4), { color: PAL.woodDark, pos: [0, 2.06, 0], rot: [0, Math.PI / 4, 0] });
  return b.build('signpost');
}

/* ------------------------------------------------------------------ volleyball court ------------------ */

export function buildVolleyball(p: { w?: number; l?: number } = {}): Group {
  const W = p.w ?? 8;
  const L = p.l ?? 15;
  const b = new ModelBuilder();
  const line = PAL.offWhite;
  const lw = 0.07;
  // court lines: L runs along x, net at x = 0 spanning z
  b.add(new BoxGeometry(L, 0.012, lw), { color: line, pos: [0, 0.01, -W / 2] });
  b.add(new BoxGeometry(L, 0.012, lw), { color: line, pos: [0, 0.01, W / 2] });
  b.add(new BoxGeometry(lw, 0.012, W), { color: line, pos: [-L / 2, 0.01, 0] });
  b.add(new BoxGeometry(lw, 0.012, W), { color: line, pos: [L / 2, 0.01, 0] });
  b.add(new BoxGeometry(lw, 0.012, W), { color: line, pos: [0, 0.01, 0] });
  const netW = W + 1.2;
  for (const z of [-netW / 2, netW / 2]) {
    b.add(new CylinderGeometry(0.05, 0.06, 2.75, 8), { color: PAL.offWhite, pos: [0, 1.2, z] });
    b.add(new CylinderGeometry(0.08, 0.08, 0.04, 8), { color: PAL.coral, pos: [0, 2.58, z] });
    // guy rope
    b.add(sweep([new Vector3(0, 2.5, z), new Vector3(0, 0.02, z + Math.sign(z) * 1.2)], 0.008, 4, 2), { color: '#E9E2D6' });
  }
  const net = new BoxGeometry(netW - 0.1, 0.9, 0.01, 1, 1, 1);
  b.add(net, { mat: toon({ pattern: 'grid', color: '#F3F0EA', freq: 9 }), pos: [0, 1.98, 0], rot: [0, Math.PI / 2, 0] });
  b.add(new BoxGeometry(0.02, 0.06, netW - 0.1), { color: PAL.offWhite, pos: [0, 2.44, 0] });
  b.add(new BoxGeometry(0.02, 0.03, netW - 0.1), { color: PAL.offWhite, pos: [0, 1.54, 0] });
  return b.build('volleyball');
}

/* ------------------------------------------------------------------ water craft & floaties ------------ */

/** Triangle a-b-c subdivided, bellied along +z by `belly` at its centre. */
function triSail(a: Vector3, b: Vector3, c: Vector3, belly: number, n = 8): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const row = (i: number) => (i * (i + 1)) / 2;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= i; j++) {
      const u = 1 - i / n;
      const v = i === 0 ? 0 : (j / i) * (i / n);
      const w = 1 - u - v;
      const p = a.clone().multiplyScalar(u).addScaledVector(b, v).addScaledVector(c, w);
      p.z += belly * 27 * u * v * w;
      pos.push(p.x, p.y, p.z);
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      idx.push(row(i) + j, row(i + 1) + j, row(i + 1) + j + 1);
      if (j < i) idx.push(row(i) + j, row(i + 1) + j + 1, row(i) + j + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Lofted open hull: U sections along x, pointed bow at +x. Outside colour + inside (back face) colour. */
function hullGeometry(L: number, W: number, D: number, sections = 16, across = 10): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= sections; i++) {
    const t = i / sections;
    const x = (t - 0.5) * L;
    const bow = t > 0.6 ? 1 - Math.pow((t - 0.6) / 0.4, 1.8) : 1;
    const stern = t < 0.12 ? 0.82 + 0.18 * (t / 0.12) : 1;
    const w = (W / 2) * Math.max(0.02, bow) * stern;
    const sheer = D + 0.06 * Math.pow(Math.abs(t - 0.45) * 2, 2);
    for (let j = 0; j <= across; j++) {
      const a = Math.PI * (j / across);
      const y = sheer - D * Math.sin(a) * (0.55 + 0.45 * Math.max(0.2, bow));
      pos.push(x, y, -Math.cos(a) * w);
    }
  }
  const cols = across + 1;
  for (let i = 0; i < sections; i++) {
    for (let j = 0; j < across; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildRowboat(p: { color?: string; length?: number } = {}, seed = 1): Group {
  const r = rng(seed);
  const L = p.length ?? 3.2;
  const b = new ModelBuilder();
  const outside = p.color ?? ([PAL.offWhite, PAL.teal, PAL.coral] as const)[Math.floor(r() * 3)];
  b.add(hullGeometry(L, 1.25, 0.5), { mat: toon({ color: outside, back: PAL.woodLight }), pos: [0, -0.1, 0] });
  for (const x of [-0.6, 0.35]) b.add(new BoxGeometry(0.22, 0.04, 1.05), { color: PAL.wood, pos: [x, 0.2, 0] });
  b.add(new BoxGeometry(L * 0.86, 0.05, 0.05), { color: PAL.navyDark, pos: [-0.05, 0.42, 0.56], rot: [0.1, 0, 0] });
  b.add(new BoxGeometry(L * 0.86, 0.05, 0.05), { color: PAL.navyDark, pos: [-0.05, 0.42, -0.56], rot: [-0.1, 0, 0] });
  // oars resting inside
  for (const z of [-0.25, 0.25]) {
    b.add(new CylinderGeometry(0.02, 0.02, 2.0, 5), { color: PAL.woodLight, pos: [0.05, 0.28, z], rot: [0, 0, Math.PI / 2 + 0.05] });
    b.add(new BoxGeometry(0.45, 0.02, 0.12), { color: PAL.woodLight, pos: [-0.95, 0.27, z] });
  }
  return b.build('rowboat');
}

export function buildSailboat(p: { color?: string } = {}, seed = 1): Group {
  const r = rng(seed);
  const b = new ModelBuilder();
  b.add(hullGeometry(4.6, 1.6, 0.65, 18, 10), { mat: toon({ color: p.color ?? PAL.offWhite, back: PAL.woodLight }), pos: [0, -0.15, 0] });
  b.add(new BoxGeometry(2.6, 0.05, 1.3), { color: PAL.woodLight, pos: [-0.3, 0.35, 0] });
  b.add(new CylinderGeometry(0.05, 0.06, 5.2, 6), { color: PAL.offWhite, pos: [0.5, 2.9, 0] });
  b.add(new CylinderGeometry(0.035, 0.035, 2.4, 5), { color: PAL.offWhite, pos: [-0.65, 1.1, 0], rot: [0, 0, Math.PI / 2] });
  // mainsail and jib: subdivided triangles with a wind belly
  const sailMat = toon({ color: PAL.offWhite, double: true, sway: 0.06 });
  b.add(triSail(new Vector3(0.42, 0.75, 0), new Vector3(0.42, 5.3, 0), new Vector3(-1.8, 0.8, 0), 0.28), {
    mat: sailMat,
    sway: (v) => Math.min(1, Math.max(0, (0.42 - v.x) / 2.2)) * 0.5,
  });
  b.add(triSail(new Vector3(0.6, 4.9, 0), new Vector3(2.25, 0.55, 0), new Vector3(0.62, 0.7, 0), 0.22), {
    mat: toon({ color: r() > 0.5 ? PAL.coral : PAL.teal, double: true, sway: 0.06 }),
    sway: (v) => Math.min(1, Math.max(0, v.x - 0.6) / 1.6) * 0.5,
  });
  return b.build('sailboat');
}

export function buildKayak(p: { color?: string } = {}, seed = 1): Group {
  const r = rng(seed);
  const c = p.color ?? ([PAL.yellow, PAL.orange, PAL.teal, PAL.coral] as const)[Math.floor(r() * 4)];
  const b = new ModelBuilder();
  const prof: Array<[number, number]> = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    prof.push([0.34 * Math.pow(Math.sin(Math.PI * t), 0.85) + 0.004, (t - 0.5) * 3.2]);
  }
  const g = lathe(prof, 12);
  g.rotateZ(Math.PI / 2);
  g.scale(1, 0.45, 1);
  b.add(g, { color: c, pos: [0, 0.12, 0] });
  b.add(new TorusGeometry(0.26, 0.035, 6, 16), { color: PAL.black, pos: [0.15, 0.27, 0], rot: [Math.PI / 2, 0, 0], scale: [1.5, 1, 1] });
  b.add(ellipsoid(0.36, 0.03, 0.2, 10, 4), { color: '#33404A', pos: [0.15, 0.25, 0] });
  // paddle resting across the cockpit
  const yaw = 1.15;
  b.add(new CylinderGeometry(0.018, 0.018, 2.1, 5), { color: PAL.metal, pos: [0.1, 0.33, 0], rot: [0, yaw, Math.PI / 2] });
  for (const s of [-1, 1]) {
    b.add(ellipsoid(0.17, 0.015, 0.075, 8, 4), { color: PAL.black, pos: [0.1 + Math.cos(yaw) * s * 1.05, 0.33, -Math.sin(yaw) * s * 1.05], rot: [0, yaw, 0] });
  }
  return b.build('kayak');
}

export function buildPoolRing(p: { a?: string; b?: string } = {}, seed = 1): Group {
  const r = rng(seed);
  const b = new ModelBuilder();
  const g = new TorusGeometry(0.42, 0.15, 10, 28);
  g.rotateX(Math.PI / 2);
  b.add(g, { mat: toon({ pattern: 'radial', color: p.a ?? PAL.offWhite, colorB: p.b ?? (r() > 0.5 ? PAL.coral : PAL.red), freq: 4, duty: 0.5 }), pos: [0, 0.06, 0] });
  return b.build('ring');
}

export function buildMattress(p: { color?: string } = {}): Group {
  const b = new ModelBuilder();
  const c = p.color ?? PAL.coral;
  b.add(new RoundedBoxGeometry(1.8, 0.16, 0.72, 3, 0.07), { mat: toon({ pattern: 'stripes', color: c, colorB: PAL.coralDeep, freq: 6, duty: 0.25 }), pos: [0, 0.04, 0] });
  b.add(new RoundedBoxGeometry(0.34, 0.12, 0.68, 3, 0.06), { color: c, pos: [-0.72, 0.15, 0] });
  return b.build('mattress');
}

export function buildBuoy(p: { color?: string } = {}): Group {
  const b = new ModelBuilder();
  const mat = toon({ pattern: 'bands', color: PAL.offWhite, colorB: p.color ?? PAL.red, freq: 3.2, duty: 0.5 });
  b.add(lathe([[0.001, -0.3], [0.32, -0.15], [0.34, 0.05], [0.2, 0.5], [0.08, 0.75], [0.001, 0.8]], 14), { mat });
  b.add(new CylinderGeometry(0.02, 0.02, 0.35, 5), { color: PAL.black, pos: [0, 0.95, 0] });
  b.add(new SphereGeometry(0.06, 8, 6), { color: PAL.yellow, pos: [0, 1.13, 0] });
  return b.build('buoy');
}

/* ------------------------------------------------------------------ seating, path ------------------- */

export function buildLogSeat(p: { length?: number } = {}, seed = 1): Group {
  const r = rng(seed);
  const L = p.length ?? range(r, 1.4, 2.0);
  const b = new ModelBuilder();
  b.add(new CylinderGeometry(0.2, 0.22, L, 10), { color: PAL.woodDark, pos: [0, 0.2, 0], rot: [0, 0, Math.PI / 2] });
  b.add(new CylinderGeometry(0.17, 0.17, 0.02, 10), { color: PAL.woodLight, pos: [L / 2 + 0.005, 0.2, 0], rot: [0, 0, Math.PI / 2] });
  b.add(new CylinderGeometry(0.17, 0.17, 0.02, 10), { color: PAL.woodLight, pos: [-L / 2 - 0.005, 0.2, 0], rot: [0, 0, Math.PI / 2] });
  return b.build('log');
}

export function buildStoneSlab(seed = 1): ModelBuilder {
  const r = rng(seed);
  const b = new ModelBuilder();
  const n = 9;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = range(r, 0.26, 0.36);
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  b.add(slab(pts, 0.06, 0.02), { color: r() > 0.5 ? '#CDBFAE' : '#BFB2A2', mat: toon({ flat: true }) });
  return b;
}

export function buildBarStool(seed = 1): ModelBuilder {
  const r = rng(seed);
  const b = new ModelBuilder();
  b.add(new CylinderGeometry(0.04, 0.05, 0.72, 6), { color: PAL.woodDark, pos: [0, 0.36, 0] });
  b.add(new CylinderGeometry(0.2, 0.18, 0.07, 12), { color: r() > 0.5 ? PAL.coral : PAL.teal, pos: [0, 0.75, 0] });
  b.add(new CylinderGeometry(0.11, 0.13, 0.03, 10), { color: PAL.wood, pos: [0, 0.02, 0] });
  return b;
}


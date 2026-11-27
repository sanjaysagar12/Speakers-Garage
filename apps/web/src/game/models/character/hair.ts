import { Color, SphereGeometry, TorusGeometry, Vector3, type Material } from 'three';
import { ModelBuilder } from '../util/builder';
import { smoothstep } from '../../util/noise';
import { ellipsoid, ribbon, rng, sweep } from '../util/geo';

/**
 * Hair is built in head space (origin = head centre, +z = face, +y = up, head radius ≈ 0.11).
 * Every style = a skull cap + layered clumps. Clumps grow from roots on the scalp along a flow field
 * (down and away from the parting/crown), so the parting and crown read naturally from above and behind.
 * Hanging lengths carry an aSway weight that the character's spring drives (uSwing).
 */

const HEAD_R = 0.112;
const CAP_R = HEAD_R * 1.06;


/** Hairline height (unit-sphere y) as a function of direction: high at the forehead, low at the nape. */
const hairline = (u: Vector3) => -0.38 + 0.66 * smoothstep(-0.1, 0.85, u.z) - 0.06 * Math.abs(u.x);

/** Shared weight so anything below the nape trails with movement. */
export const hairSwayWeight = (v: Vector3) => Math.min(1, Math.max(0, (-v.y - 0.07) / 0.42));

interface Style {
  part: number; // parting x offset
  kx: number; // sideways divergence from the parting
  kz: number; // front/back divergence from the crown
  /** stop height for a clump at position p (head space) */
  endY: (p: Vector3) => number;
  /** convergence point (ponytail/bun/braid) or null */
  tie: Vector3 | null;
  hang: 'none' | 'long' | 'wavy';
  hangTo: number;
  width: number;
  roots: number;
  puff: number;
}

const zone = (p: Vector3) => ({
  front: p.z > 0.055 && Math.abs(p.x) < 0.075,
  temple: p.z > 0.025 && Math.abs(p.x) >= 0.06,
  back: p.z < -0.02,
});

const STYLES: Record<string, Style> = {
  short: {
    part: 0.022, kx: 2.2, kz: 1.6, tie: null, hang: 'none', hangTo: 0, width: 0.042, roots: 100, puff: 1.05,
    endY: (p) => (zone(p).front ? 0.05 : zone(p).temple ? 0.005 : zone(p).back ? -0.085 : -0.03),
  },
  buzz: {
    part: 0, kx: 1, kz: 1, tie: null, hang: 'none', hangTo: 0, width: 0, roots: 0, puff: 1.0,
    endY: () => 1,
  },
  bob: {
    part: -0.025, kx: 2.4, kz: 1.2, tie: null, hang: 'none', hangTo: 0, width: 0.044, roots: 120, puff: 1.09,
    endY: (p) => (zone(p).front ? 0.04 : zone(p).temple ? -0.1 : -0.13),
  },
  long: {
    part: 0.0, kx: 2.6, kz: 1.1, tie: null, hang: 'long', hangTo: -0.52, width: 0.05, roots: 130, puff: 1.07,
    endY: (p) => (zone(p).front ? 0.042 : -0.04),
  },
  wavy: {
    part: 0.03, kx: 2.6, kz: 1.1, tie: null, hang: 'wavy', hangTo: -0.48, width: 0.054, roots: 130, puff: 1.12,
    endY: (p) => (zone(p).front ? 0.04 : -0.04),
  },
  ponytail: {
    part: 0, kx: 0.4, kz: 0.2, tie: new Vector3(0, 0.035, -0.128), hang: 'none', hangTo: 0, width: 0.032, roots: 90, puff: 1.08,
    endY: (p) => (zone(p).front ? 0.05 : -1),
  },
  bun: {
    part: 0, kx: 0.4, kz: 0.2, tie: new Vector3(0, 0.105, -0.07), hang: 'none', hangTo: 0, width: 0.032, roots: 90, puff: 1.08,
    endY: (p) => (zone(p).front ? 0.05 : -1),
  },
  braid: {
    part: 0.0, kx: 0.5, kz: 0.25, tie: new Vector3(0, -0.06, -0.112), hang: 'none', hangTo: 0, width: 0.032, roots: 90, puff: 1.08,
    endY: (p) => (zone(p).front ? 0.05 : -1),
  },
};

function fibonacci(n: number): Vector3[] {
  const out: Vector3[] = [];
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    out.push(new Vector3(Math.cos(g * i) * r, y, Math.sin(g * i) * r));
  }
  return out;
}

/** Walk a root along the scalp until the style says stop. */
function scalpPath(root: Vector3, st: Style, R: number): Vector3[] {
  const pts: Vector3[] = [];
  const p = root.clone().multiplyScalar(R);
  const ds = 0.016;
  for (let i = 0; i < 26; i++) {
    pts.push(p.clone());
    if (st.tie && p.distanceTo(st.tie) < 0.03) break;
    if (p.y < st.endY(p)) break;
    // never run over the face
    if (p.z > 0.06 && p.y < 0.03 && Math.abs(p.x) < 0.08) break;
    let d: Vector3;
    if (st.tie && !(zone(p).front && p.y < 0.075)) d = st.tie.clone().sub(p);
    else d = new Vector3((p.x - st.part) * st.kx * 10, -1, p.z * st.kz * 10);
    const n = p.clone().normalize();
    d.addScaledVector(n, -d.dot(n));
    if (d.lengthSq() < 1e-8) d.set(Math.sign(p.x - st.part) || 1, 0, 0);
    d.normalize();
    p.addScaledVector(d, ds);
    const rr = R * (1 + 0.035 * (i / 26));
    p.setLength(rr);
  }
  return pts;
}

/** Continue a clump below the head: behind the shoulders, or in front of them for front locks. */
function hangPath(pts: Vector3[], st: Style, r: () => number): void {
  const last = pts[pts.length - 1].clone();
  const front = last.z > 0.02 && Math.abs(last.x) > 0.05;
  const steps = 9;
  const y0 = last.y;
  const phase = r() * 6;
  // stagger lengths so the ends form a soft V/U instead of a straight comb
  const centre = 1 - Math.min(1, Math.abs(last.x) / 0.12);
  const hangTo = st.hangTo * (0.72 + 0.22 * centre + 0.12 * r()) - (front ? -0.06 : 0);
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const y = y0 + (hangTo - y0) * t;
    let x = last.x * (1 + 0.35 * t) ;
    let z: number;
    if (front) {
      // over the shoulder and down the chest
      x = Math.sign(last.x) * Math.max(Math.abs(last.x), 0.1 + 0.03 * t);
      z = last.z + (0.14 - last.z) * smoothstep(0, 0.5, t);
    } else {
      // clear the shoulder blades: shoulders sit at y≈-0.19, |x|≈0.18
      const out = Math.abs(last.x) > 0.06 ? -0.15 : -0.14;
      z = last.z + (out - last.z) * smoothstep(0, 0.45, t) - 0.015 * t;
      if (Math.abs(x) > 0.13) x = Math.sign(x) * (0.13 + (Math.abs(x) - 0.13) * 0.3);
    }
    if (st.hang === 'wavy') {
      x += 0.018 * Math.sin(t * 9 + phase) * t;
      z += 0.012 * Math.cos(t * 9 + phase) * t;
    }
    pts.push(new Vector3(x, y, z));
  }
}

function addClump(b: ModelBuilder, mat: Material, pts: Vector3[], width: number, tone: Color): void {
  if (pts.length < 3) return;
  const mid = pts[Math.floor(pts.length / 3)].clone().normalize();
  const up = mid.lengthSq() > 0 ? mid : new Vector3(0, 1, 0);
  const n = pts.length;
  const segs = Math.min(24, n * 2);
  const long = pts.length > 14;
  const w = long
    ? (t: number) => width * (0.6 + 0.5 * Math.min(1, t * 3)) * (1 - Math.pow(Math.max(0, (t - 0.8) / 0.2), 1.6) * 0.85)
    : (t: number) => width * (0.55 + 0.6 * Math.sin(Math.PI * Math.min(1, t * 1.4 + 0.1))) * (1 - Math.pow(t, 2.4));
  const outer = ribbon(pts, w, { segs, across: 2, fold: (t) => width * 0.5 * Math.sin(Math.PI * t), up });
  const inner = ribbon(pts, (t) => w(t) * 0.9, { segs, across: 1, fold: (t) => -width * 0.15 * Math.sin(Math.PI * t), up });
  b.add(outer, { mat, color: tone, sway: hairSwayWeight });
  b.add(inner, { mat, color: tone, sway: hairSwayWeight });
}

/** Builds the hair for `style` into `b` with the (unique, swinging) hair material. Vertex colours are tone factors. */
export function buildHair(b: ModelBuilder, mat: Material, style: string, seed = 7): void {
  const st = STYLES[style] ?? STYLES.short;
  const r = rng(seed + style.length * 31);
  // tone factors multiply the hair colour; >1 gives the anime sheen on a few top clumps
  const tones = [new Color(1, 1, 1), new Color(0.86, 0.86, 0.86), new Color(1.12, 1.12, 1.12), new Color(0.76, 0.76, 0.76), new Color(1.35, 1.32, 1.3)];

  // skull cap: vertices below the hairline are pulled inside the head so the edge never shows
  const cap = new SphereGeometry(style === 'buzz' ? HEAD_R * 1.025 : CAP_R, 26, 18);
  const pos = cap.attributes.position;
  const u = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    u.fromBufferAttribute(pos, i).normalize();
    const hl = hairline(u) + (style === 'buzz' ? 0.06 : 0);
    const k = smoothstep(hl - 0.12, hl + 0.02, u.y);
    const rr = (style === 'buzz' ? HEAD_R * 1.025 : CAP_R) * (0.86 + 0.14 * k);
    pos.setXYZ(i, u.x * rr * 0.95, u.y * rr, u.z * rr);
  }
  cap.computeVertexNormals();
  b.add(cap, { mat, color: style === 'buzz' ? '#C8C8C8' : '#C4C4C4' });
  if (st.roots === 0) return;

  // roots: fibonacci points on the hair region, plus an explicit row along each side of the parting
  const roots: Vector3[] = fibonacci(st.roots * 2).filter((v) => v.y > hairline(v) + 0.08);
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const ang = -0.95 + t * 1.75; // from crown (back) to forehead
    for (const s of [-1, 1]) roots.push(new Vector3(st.part / HEAD_R + s * 0.1, Math.cos(ang), Math.sin(ang)).normalize());
  }
  // a fringe row so bangs are always present
  for (let i = 0; i < 6; i++) {
    const a = -0.55 + (i / 5) * 1.1;
    roots.push(new Vector3(Math.sin(a) * 0.55, 0.72, 0.42 + Math.cos(a) * 0.1).normalize());
  }

  const R = CAP_R * 1.02;
  for (const root of roots) {
    const path = scalpPath(root, st, R * (st.puff + (r() - 0.5) * 0.04));
    if (st.hang !== 'none' && path[path.length - 1].y < 0.02 && !(zone(path[path.length - 1]).front)) hangPath(path, st, r);
    // anime-style pointed tips flick slightly outward
    if (path.length >= 2 && st.hang === 'none') {
      const a = path[path.length - 1];
      const d = a.clone().sub(path[path.length - 2]).normalize();
      const out = a.clone().setY(0).normalize().multiplyScalar(0.006);
      path.push(a.clone().addScaledVector(d, 0.014).add(out));
    }
    addClump(b, mat, path, st.width * (0.85 + r() * 0.35), tones[Math.floor(r() * tones.length)]);
  }

  // tied styles
  if (style === 'ponytail' && st.tie) {
    const t = st.tie;
    b.add(new TorusGeometry(0.026, 0.009, 6, 12), { color: '#7A7A7A', mat, pos: [t.x, t.y, t.z - 0.01], rot: [0.4, 0, 0] });
    const tail = [t.clone(), t.clone().add(new Vector3(0, -0.04, -0.06)), t.clone().add(new Vector3(0, -0.16, -0.085)), t.clone().add(new Vector3(0, -0.3, -0.07)), t.clone().add(new Vector3(0.01, -0.4, -0.05))];
    b.add(sweep(tail, (k) => [0.042 * (1 - k * 0.75) + 0.004, 0.032 * (1 - k * 0.75) + 0.004], 9, 16), { mat, color: '#EDEDED', sway: hairSwayWeight });
    for (let i = 0; i < 5; i++) {
      const o = new Vector3((r() - 0.5) * 0.03, 0, (r() - 0.5) * 0.02);
      addClump(b, mat, tail.map((p, k) => p.clone().add(o.clone().multiplyScalar(k))), 0.026, tones[i % tones.length]);
    }
  }
  if (style === 'bun' && st.tie) {
    const t = st.tie;
    b.add(ellipsoid(0.058, 0.05, 0.058, 14, 10), { mat, color: '#EDEDED', pos: [t.x, t.y + 0.03, t.z - 0.005] });
    b.add(new TorusGeometry(0.05, 0.014, 6, 16), { mat, color: '#D8D8D8', pos: [t.x, t.y + 0.025, t.z - 0.005], rot: [Math.PI / 2 - 0.3, 0, 0] });
  }
  if (style === 'braid' && st.tie) {
    const t = st.tie;
    for (let i = 0; i < 10; i++) {
      const s = 1 - i * 0.055;
      b.add(ellipsoid(0.03 * s, 0.032, 0.026 * s, 10, 8), {
        mat,
        color: i % 2 ? '#E3E3E3' : '#FFFFFF',
        pos: [t.x + (i % 2 ? 0.01 : -0.01), t.y - 0.02 - i * 0.042, t.z - 0.03 - Math.min(i, 3) * 0.008],
        rot: [0.2, 0, i % 2 ? 0.45 : -0.45],
        sway: hairSwayWeight,
      });
    }
    b.add(new TorusGeometry(0.018, 0.007, 6, 10), { mat, color: '#7A7A7A', pos: [t.x, t.y - 0.46, t.z - 0.055], rot: [Math.PI / 2, 0, 0], sway: hairSwayWeight });
  }
}


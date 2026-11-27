import { Matrix4, Vector3 } from 'three';

/**
 * The body rig reference: the ONE place that defines the character's proportions. Bones, segment
 * surfaces (rings with elliptical cross-sections and ball joints), and anchors for hats, glasses, hems and
 * cuffs all live here. The body mesh, every garment shell, the hats, the hair masks and the fit test
 * (scripts/fit-check.ts) are all derived from these numbers, so nothing is placed "by eye".
 *
 * Frames: the character's root space has the feet at y = 0 and faces +z. Each segment is described in its
 * bone's space at rest (rest pose = all bone rotations zero; bones only translate from their parent).
 */

export type BoneName = 'hips' | 'spine' | 'head' | 'thighL' | 'thighR' | 'shinL' | 'shinR' | 'footL' | 'footR' | 'armL' | 'armR' | 'foreL' | 'foreR';

/** Skin index order (bone i in the skeleton). Parents come before children. */
export const BONES: readonly BoneName[] = ['hips', 'spine', 'head', 'thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR', 'armL', 'armR', 'foreL', 'foreR'];
export const BONE_INDEX = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<BoneName, number>;

/** Lengths (m). The character is ~1.7 m tall, ~6.5 heads. */
export const DIM = {
  hipY: 0.88,
  hipX: 0.082,
  thigh: 0.42,
  shin: 0.41,
  shoulderX: 0.185,
  shoulderY: 0.39,
  upperArm: 0.27,
  forearm: 0.24,
  neckY: 0.6,
} as const;

/** Bone -> [parent, rest offset from the parent]. */
export const BONE_REST: Record<BoneName, [BoneName | null, [number, number, number]]> = {
  hips: [null, [0, DIM.hipY, 0]],
  spine: ['hips', [0, 0.1, 0]],
  head: ['spine', [0, DIM.neckY, 0.005]],
  thighL: ['hips', [DIM.hipX, -0.02, 0]],
  thighR: ['hips', [-DIM.hipX, -0.02, 0]],
  shinL: ['thighL', [0, -DIM.thigh, 0]],
  shinR: ['thighR', [0, -DIM.thigh, 0]],
  footL: ['shinL', [0, -DIM.shin, 0]],
  footR: ['shinR', [0, -DIM.shin, 0]],
  armL: ['spine', [DIM.shoulderX, DIM.shoulderY, -0.005]],
  armR: ['spine', [-DIM.shoulderX, DIM.shoulderY, -0.005]],
  foreL: ['armL', [0, -DIM.upperArm, 0]],
  foreR: ['armR', [0, -DIM.upperArm, 0]],
};

/** Rest position of a bone in root space. */
export function restOrigin(bone: BoneName): Vector3 {
  const v = new Vector3();
  let b: BoneName | null = bone;
  while (b) {
    const [parent, o]: [BoneName | null, [number, number, number]] = BONE_REST[b];
    v.x += o[0];
    v.y += o[1];
    v.z += o[2];
    b = parent;
  }
  return v;
}

/** Bone space -> root space at rest (pure translations). */
export const REST: Record<BoneName, Matrix4> = Object.fromEntries(
  BONES.map((b) => {
    const o = restOrigin(b);
    return [b, new Matrix4().makeTranslation(o.x, o.y, o.z)];
  }),
) as Record<BoneName, Matrix4>;

/* ---------------------------------------------------------------- segments ------------------------------ */

/** One cross-section of a tube segment: an ellipse at height y (bone space), centred at (cx, cz). */
export interface Ring {
  y: number;
  rx: number;
  rz: number;
  cx?: number;
  cz?: number;
}

export type SegName =
  | 'torso'
  | 'neck'
  | 'pelvis'
  | 'upperArmL'
  | 'upperArmR'
  | 'forearmL'
  | 'forearmR'
  | 'thighL'
  | 'thighR'
  | 'shinL'
  | 'shinR'
  | 'footL'
  | 'footR'
  | 'head'
  | 'jaw';

interface SegBase {
  name: SegName;
  bone: BoneName;
  /** radial resolution; garments on this segment use the same count so their columns line up */
  sides: number;
}

/**
 * A tube: rings ascending in y. `ball` ends are hemispheres centred on the end ring (ball joints: a
 * hemisphere around a pivot looks the same at any rotation, so limbs never tear at elbows and knees).
 * `pole` ends close to a point just past the end ring.
 */
export interface TubeSeg extends SegBase {
  kind: 'tube';
  rings: Ring[];
  bottom: 'ball' | 'pole' | 'open';
  top: 'ball' | 'pole' | 'open';
}

export interface EllipsoidSeg extends SegBase {
  kind: 'ellipsoid';
  centre: [number, number, number];
  radii: [number, number, number];
}

export type Segment = TubeSeg | EllipsoidSeg;

const circle = (y: number, r: number, cz = 0): Ring => ({ y, rx: r, rz: r, cz });

const limbs = (side: 'L' | 'R'): Segment[] => [
  // upper arm: ball at the shoulder (the deltoid) and at the elbow
  { name: `upperArm${side}`, bone: `arm${side}`, kind: 'tube', sides: 12, bottom: 'ball', top: 'ball', rings: [circle(-DIM.upperArm, 0.037), circle(-0.135, 0.043), circle(0, 0.046)] },
  { name: `forearm${side}`, bone: `fore${side}`, kind: 'tube', sides: 12, bottom: 'ball', top: 'ball', rings: [circle(-DIM.forearm, 0.029), circle(-0.12, 0.034), circle(0, 0.035)] },
  { name: `thigh${side}`, bone: `thigh${side}`, kind: 'tube', sides: 14, bottom: 'ball', top: 'ball', rings: [circle(-DIM.thigh, 0.05), circle(-0.21, 0.06), circle(-0.11, 0.065), circle(0, 0.062)] },
  { name: `shin${side}`, bone: `shin${side}`, kind: 'tube', sides: 12, bottom: 'ball', top: 'ball', rings: [circle(-DIM.shin, 0.034), circle(-0.3, 0.04), circle(-0.12, 0.05), circle(0, 0.047)] },
  { name: `foot${side}`, bone: `foot${side}`, kind: 'ellipsoid', sides: 12, centre: [0, -0.04, 0.045], radii: [0.044, 0.034, 0.108] },
] as Segment[];

export const SEGMENTS: Record<SegName, Segment> = Object.fromEntries(
  (
    [
      {
        name: 'torso',
        bone: 'spine',
        kind: 'tube',
        sides: 20,
        bottom: 'pole',
        top: 'pole',
        rings: [
          // below the waist the torso matches the pelvis exactly (same surface for layering)
          { y: -0.12, rx: 0.149, rz: 0.104, cz: -0.0096 },
          { y: -0.06, rx: 0.148, rz: 0.102, cz: -0.0064 },
          { y: 0.02, rx: 0.13, rz: 0.091, cz: 0 },
          { y: 0.14, rx: 0.14, rz: 0.096, cz: 0.006 },
          { y: 0.26, rx: 0.16, rz: 0.106, cz: 0.01 },
          { y: 0.34, rx: 0.17, rz: 0.108, cz: 0.006 },
          // shoulder line reaches the top of the arm's ball joint, so the deltoid rounds off the line
          { y: 0.4, rx: 0.182, rz: 0.1, cz: -0.002 },
          { y: 0.435, rx: 0.168, rz: 0.088, cz: -0.006 },
          { y: 0.46, rx: 0.12, rz: 0.074, cz: -0.006 },
          { y: 0.478, rx: 0.072, rz: 0.058, cz: -0.004 },
          { y: 0.49, rx: 0.05, rz: 0.046, cz: 0 },
        ],
      },
      { name: 'neck', bone: 'spine', kind: 'tube', sides: 12, bottom: 'open', top: 'open', rings: [circle(0.44, 0.05), circle(0.6, 0.044)] },
      {
        name: 'pelvis',
        bone: 'hips',
        kind: 'tube',
        sides: 20,
        bottom: 'pole',
        top: 'pole',
        rings: [
          { y: -0.1, rx: 0.07, rz: 0.06, cz: -0.004 },
          { y: -0.075, rx: 0.12, rz: 0.088, cz: -0.006 },
          { y: -0.03, rx: 0.148, rz: 0.104, cz: -0.01 },
          { y: 0.02, rx: 0.152, rz: 0.105, cz: -0.008 },
          { y: 0.07, rx: 0.142, rz: 0.098, cz: -0.004 },
          { y: 0.12, rx: 0.13, rz: 0.091, cz: 0 },
        ],
      },
      ...limbs('L'),
      ...limbs('R'),
      { name: 'head', bone: 'head', kind: 'ellipsoid', sides: 20, centre: [0, 0, 0], radii: [0.103, 0.112, 0.108] },
      { name: 'jaw', bone: 'head', kind: 'ellipsoid', sides: 14, centre: [0, -0.058, 0.026], radii: [0.074, 0.07, 0.08] },
    ] as Segment[]
  ).map((s) => {
    // right-side limbs are mirrored: nothing to change (they are symmetric about their own axis)
    return [s.name, s];
  }),
) as Record<SegName, Segment>;

/** Segments a limb garment uses on each side. */
export const SIDE = {
  L: { upperArm: 'upperArmL', forearm: 'forearmL', thigh: 'thighL', shin: 'shinL', foot: 'footL' },
  R: { upperArm: 'upperArmR', forearm: 'forearmR', thigh: 'thighR', shin: 'shinR', foot: 'footR' },
} as const;

/** Ellipse of a tube segment at height y (linear between rings; clamped to the end rings). */
export function ringAt(seg: TubeSeg, y: number): Required<Ring> {
  const r = seg.rings;
  if (y <= r[0].y) return { cx: 0, cz: 0, ...r[0], y };
  for (let i = 0; i < r.length - 1; i++) {
    const a = r[i];
    const b = r[i + 1];
    if (y <= b.y) {
      const t = (y - a.y) / (b.y - a.y);
      return { y, rx: a.rx + (b.rx - a.rx) * t, rz: a.rz + (b.rz - a.rz) * t, cx: (a.cx ?? 0) + ((b.cx ?? 0) - (a.cx ?? 0)) * t, cz: (a.cz ?? 0) + ((b.cz ?? 0) - (a.cz ?? 0)) * t };
    }
  }
  return { cx: 0, cz: 0, ...r[r.length - 1], y };
}

export const segTop = (s: TubeSeg) => s.rings[s.rings.length - 1].y;
export const segBottom = (s: TubeSeg) => s.rings[0].y;

/**
 * How far inside the body surface a point (in the segment's bone space) is, in metres: > 0 inside,
 * < 0 outside. Tubes use the elliptical cross-section at the point's height (radial distance from the
 * segment axis, as the fit test defines "inside"), ball ends are spheres, pole ends are ignored (they sit
 * inside a neighbour).
 */
export function depthInside(seg: Segment, p: Vector3): number {
  if (seg.kind === 'ellipsoid') {
    const [cx, cy, cz] = seg.centre;
    const [a, b, c] = seg.radii;
    const x = (p.x - cx) / a;
    const y = (p.y - cy) / b;
    const z = (p.z - cz) / c;
    const k = Math.sqrt(x * x + y * y + z * z);
    // radial depth, scaled by the mean radius along that direction
    const rr = Math.hypot(p.x - cx, p.y - cy, p.z - cz) / Math.max(k, 1e-9);
    return rr * (1 - k);
  }
  const lo = segBottom(seg);
  const hi = segTop(seg);
  let best = -Infinity;
  if (p.y >= lo && p.y <= hi) {
    const r = ringAt(seg, p.y);
    const dx = p.x - r.cx;
    const dz = p.z - r.cz;
    const k = Math.sqrt((dx / r.rx) ** 2 + (dz / r.rz) ** 2);
    const rr = Math.hypot(dx, dz) / Math.max(k, 1e-9);
    best = rr * (1 - k);
  }
  const ball = (end: Ring) => {
    const d = Math.hypot(p.x - (end.cx ?? 0), p.y - end.y, p.z - (end.cz ?? 0));
    return end.rx - d;
  };
  if (seg.bottom === 'ball' && p.y < lo) best = Math.max(best, ball(seg.rings[0]));
  if (seg.top === 'ball' && p.y > hi) best = Math.max(best, ball(seg.rings[seg.rings.length - 1]));
  return best;
}

/* ---------------------------------------------------------------- anchors ------------------------------- */

const H = SEGMENTS.head as EllipsoidSeg;

/** Head anchors, head bone space (+z = face). Everything that sits on the head is placed from these. */
export const HEAD = {
  radii: H.radii,
  /** where the hair line meets the forehead (front centre) */
  forehead: new Vector3(0, 0.058, 0.096),
  /** top of the skull */
  crown: new Vector3(0, H.radii[1], 0),
  /** back of the head just above the nape (cap adjuster opening) */
  back: new Vector3(0, 0.0, -0.105),
  /** ear centres and their half-height; a hat band must stay above earTop */
  ear: { x: 0.1, y: -0.012, z: -0.004, rx: 0.018, ry: 0.03, rz: 0.016 },
  earTop: -0.012 + 0.03,
  /** y of the temple line at depth z (linear between the points of `temple`) */
  templeY(z: number): number {
    const t = HEAD.temple;
    if (z >= t[0][0]) return t[0][1];
    for (let i = 0; i < t.length - 1; i++) {
      const [z0, y0] = t[i];
      const [z1, y1] = t[i + 1];
      if (z >= z1) return y0 + ((y1 - y0) * (z - z0)) / (z1 - z0);
    }
    return t[t.length - 1][1];
  },
  /** eye line, nose bridge (glasses rest here) and the ear line the temples run back to */
  eyeY: -0.012,
  noseBridge: new Vector3(0, -0.006, 0.108),
  /**
   * The line a glasses temple follows from the lens hinge back over the ear: [z, y] pairs, head space.
   * Hair lying over this line is lifted so it rests on the temple (hair.ts uses it through the mask).
   */
  temple: [
    [0.098, -0.006],
    [0.07, 0.0],
    [0.035, 0.008],
    [0.004, 0.022],
    [-0.018, 0.014],
    [-0.03, -0.002],
  ] as ReadonlyArray<readonly [number, number]>,
  /** distance of a head-surface point from the centre along unit direction u */
  surface(u: Vector3): number {
    const [a, b, c] = H.radii;
    return 1 / Math.sqrt((u.x / a) ** 2 + (u.y / b) ** 2 + (u.z / c) ** 2);
  },
};

/** Joint centres in bone space of the segment above them (for joint-gap checks). */
export const JOINTS: Array<{ name: string; seg: SegName; at: [number, number, number] }> = [
  { name: 'shoulderL', seg: 'upperArmL', at: [0, 0, 0] },
  { name: 'shoulderR', seg: 'upperArmR', at: [0, 0, 0] },
  { name: 'elbowL', seg: 'upperArmL', at: [0, -DIM.upperArm, 0] },
  { name: 'elbowR', seg: 'upperArmR', at: [0, -DIM.upperArm, 0] },
  { name: 'hipL', seg: 'thighL', at: [0, 0, 0] },
  { name: 'hipR', seg: 'thighR', at: [0, 0, 0] },
  { name: 'kneeL', seg: 'thighL', at: [0, -DIM.thigh, 0] },
  { name: 'kneeR', seg: 'thighR', at: [0, -DIM.thigh, 0] },
  { name: 'ankleL', seg: 'shinL', at: [0, -DIM.shin, 0] },
  { name: 'ankleR', seg: 'shinR', at: [0, -DIM.shin, 0] },
];

import { BufferGeometry, Vector3, type Material, type Matrix4 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { smoothstep } from '@shoreline/shared';
import { ModelBuilder } from '../util/builder';
import { slab, sweep } from '../util/geo';
import { BONE_INDEX, SEGMENTS, ringAt, type BoneName, type EllipsoidSeg, type SegName, type TubeSeg } from './rig';
import { band, ellipsoidShell, onTube, ringGrid, tubePatch, tubeShell, type ShellOpts } from './shell';

/**
 * Garments as data + shells. Every piece of cloth is an offset shell of the body segment it sits on
 * (shell.ts), so it follows the body by construction. A garment records:
 *  - covers:   which body ranges are under it (the body is not drawn there: no z-fighting, no poke-through)
 *  - envelope: how far it stands off the torso/pelvis (an outer layer must clear it)
 *  - backDepth: how far it sticks out at the upper back (long hair hangs over it)
 *  - joints:   which joint balls it wraps (for the joint-gap check)
 */

export interface Cover {
  seg: SegName;
  from?: number;
  to?: number;
}

/** Parts that layer rules can hide (see LAYER_RULES in fitRules.ts). */
export type GarmentPart = 'hood' | 'drawstrings' | 'collar';

export interface FitCtx {
  b: ModelBuilder;
  main: Material;
  trim: Material;
  /** lower-layer offset from the torso/pelvis surface at root-space height Y (0 if none) */
  under: (rootY: number) => number;
  hidden: ReadonlySet<GarmentPart>;
  /** filled while building */
  covers: Cover[];
  envelope: Array<{ y0: number; y1: number; d: number }>;
  backDepth: number;
}

type Rest = Record<BoneName, Matrix4>;

const HIP_Y = 0.88;
const SPINE_Y = 0.98;

/** Waist blend: torso and pelvis surfaces (body and cloth alike) bend between spine and hips. */
export const waistWeight = (rootY: number) => smoothstep(HIP_Y + 0.03, HIP_Y + 0.15, rootY);

const boneY: Partial<Record<BoneName, number>> = { spine: SPINE_Y, hips: HIP_Y };

/** Put the builder into a bone's frame; spine/hips parts get the waist blend. */
export function onBone(b: ModelBuilder, bone: BoneName, rest: Rest): void {
  const by = boneY[bone];
  if (by === undefined) {
    b.setFrame(rest[bone], BONE_INDEX[bone]);
    return;
  }
  b.setFrame(rest[bone], (p: Vector3): Array<[number, number]> => {
    const w = waistWeight(p.y + by);
    return [
      [BONE_INDEX.spine, w],
      [BONE_INDEX.hips, 1 - w],
    ];
  });
}

const tube = (s: SegName) => SEGMENTS[s] as TubeSeg;
const SIDES = [
  { s: 1, up: 'upperArmL', fore: 'forearmL', thigh: 'thighL', shin: 'shinL', foot: 'footL' },
  { s: -1, up: 'upperArmR', fore: 'forearmR', thigh: 'thighR', shin: 'shinR', foot: 'footR' },
] as const;

/** Body-space height of a segment's bone origin (root space), to express envelopes in root Y. */
const ORIGIN_Y: Partial<Record<SegName, number>> = { torso: SPINE_Y, pelvis: HIP_Y };


/** A shell piece: geometry + its cover (and envelope for torso/pelvis pieces). */
function piece(ctx: FitCtx, rest: Rest, segName: SegName, o: ShellOpts & { mat?: Material; hides?: boolean; color?: string }): void {
  const seg = tube(segName);
  onBone(ctx.b, seg.bone, rest);
  ctx.b.tag = segName;
  ctx.b.add(tubeShell(seg, o), { mat: o.mat ?? ctx.main, color: o.color });
  if (o.hides !== false) ctx.covers.push({ seg: segName, from: o.from, to: o.to });
  const oy = ORIGIN_Y[segName];
  if (oy !== undefined) {
    const lo = (o.from ?? seg.rings[0].y) + oy;
    const hi = (o.to ?? seg.rings[seg.rings.length - 1].y) + oy;
    ctx.envelope.push({ y0: lo, y1: hi, d: o.offset + (o.hemBottom ?? 0) + (o.flareBottom ?? 0) });
  }
}

/** Offset needed at root height Y to clear the lower layers, with a soft ramp so shells never step. */
function clearUnder(ctx: FitCtx, origin: number, gap = 0.005) {
  return (y: number) => {
    const Y = y + origin;
    let m = 0;
    for (let k = -2; k <= 2; k++) m = Math.max(m, ctx.under(Y + k * 0.01));
    return m > 0 ? m + gap : 0;
  };
}

function waistband(ctx: FitCtx, rest: Rest, y: number, offset: number, mat: Material, thickness = 0.006, height = 0.022): void {
  onBone(ctx.b, 'hips', rest);
  ctx.b.tag = 'pelvis';
  ctx.b.add(band(tube('pelvis'), y, offset, thickness, height), { mat });
  ctx.envelope.push({ y0: HIP_Y + y - height / 2, y1: HIP_Y + y + height / 2, d: offset + thickness });
}

/** Cords hanging from a point (drawstrings, laces) in the current frame. */
function cord(ctx: FitCtx, pts: Vector3[], r: number, color: string): void {
  ctx.b.add(sweep(pts, r, 5, Math.max(4, pts.length * 3)), { color, mat: ctx.trim });
}

/* ---------------------------------------------------------------- tops --------------------------------- */

interface TopSpec {
  /** torso shell: hem height (spine space), offset, hem flare */
  hem: number;
  offset: number;
  flare: number;
  folds?: ShellOpts['folds'];
  /** sleeve end: upper-arm y (short) or forearm y (long); null = sleeveless */
  sleeve: { upper: number } | { fore: number } | null;
  collar: number;
}

const TOPS: Record<string, TopSpec> = {
  tee: { hem: -0.07, offset: 0.011, flare: 0.007, folds: { amp: 0.003, freq: 7, twist: 0.3 }, sleeve: { upper: -0.125 }, collar: 0.006 },
  swim_shirt: { hem: -0.07, offset: 0.007, flare: 0.002, sleeve: { fore: -0.2 }, collar: 0.005 },
  hoodie: { hem: -0.1, offset: 0.017, flare: 0.002, folds: { amp: 0.005, freq: 9, twist: 0.5 }, sleeve: { fore: -0.215 }, collar: 0.011 },
  tank: { hem: -0.07, offset: 0.008, flare: 0.004, sleeve: null, collar: 0 },
};

export function topBackDepth(id: string, hidden: ReadonlySet<GarmentPart>): number {
  if (id === 'hoodie') return hidden.has('hood') ? 0.03 : 0.075;
  return (TOPS[id] ?? TOPS.tee).offset + 0.006;
}

/** Offset of a top's torso shell around the neck (scarves and backpack straps sit outside it). */
export function topOffset(id: string): number {
  const t = TOPS[id] ?? TOPS.tee;
  return t.offset + t.collar;
}

export function buildTop(ctx: FitCtx, rest: Rest, id: string): void {
  const t = TOPS[id] ?? TOPS.tee;
  const torso = tube('torso');
  const minOffset = clearUnder(ctx, SPINE_Y);
  const neck = id === 'tank' ? 0.3 : 0.47;
  piece(ctx, rest, 'torso', { from: t.hem, to: neck, offset: t.offset, flareBottom: t.flare, flareLen: 0.1, hemBottom: 0.004, hemTop: id === 'tank' ? 0.004 : 0, folds: t.folds, minOffset, step: 0.03 });
  if (id === 'tank') {
    // straps over the shoulders, following the torso surface
    onBone(ctx.b, 'spine', rest);
    ctx.b.tag = 'torso';
    for (const s of [-1, 1]) {
      const pts: Vector3[] = [];
      const ys = [0.29, 0.35, 0.4, 0.43, 0.452];
      const at = (y: number, front: boolean) => {
        const r = ringAt(torso, y);
        const x = s * 0.1;
        const k = Math.min(0.98, Math.abs(x) / (r.rx + 0.015));
        const z = r.cz + (front ? 1 : -1) * (r.rz + 0.015) * Math.sqrt(1 - k * k);
        return new Vector3(x, y, z);
      };
      for (const y of ys) pts.push(at(y, true));
      const topR = ringAt(torso, 0.462);
      pts.push(new Vector3(s * 0.1, 0.462 + 0.016, topR.cz));
      for (const y of [...ys].reverse()) pts.push(at(y, false));
      ctx.b.add(sweep(pts, [0.007, 0.0035], 6, 24), { mat: ctx.main });
    }
    ctx.covers.push({ seg: 'torso', from: t.hem, to: 0.3 });
    return;
  }
  // collar
  onBone(ctx.b, 'spine', rest);
    ctx.b.tag = 'torso';
  if (!ctx.hidden.has('collar')) ctx.b.add(band(torso, 0.468, t.offset, t.collar, t.collar * 2.2), { mat: id === 'swim_shirt' ? ctx.trim : ctx.main });
  // sleeves: one shell per arm segment, meeting on the shared ball joints (shoulder, elbow)
  for (const side of SIDES) {
    if (!t.sleeve) break;
    const upperEnd = 'upper' in t.sleeve ? t.sleeve.upper : undefined;
    piece(ctx, rest, side.up, { from: upperEnd, offset: t.offset, flareBottom: upperEnd !== undefined ? 0.008 : 0, flareLen: 0.07, hemBottom: upperEnd !== undefined ? 0.004 : 0, folds: t.folds && { ...t.folds, amp: t.folds.amp * 0.6 } });
    if ('fore' in t.sleeve) {
      piece(ctx, rest, side.fore, { from: t.sleeve.fore, offset: t.offset * 0.85, flareBottom: 0.004, flareLen: 0.06, folds: t.folds && { ...t.folds, amp: t.folds.amp * 0.6 } });
      // cuff
      onBone(ctx.b, tube(side.fore).bone, rest);
      ctx.b.tag = side.fore;
      ctx.b.add(band(tube(side.fore), t.sleeve.fore + 0.012, t.offset * 0.85, 0.005, 0.022), { mat: id === 'swim_shirt' ? ctx.trim : ctx.main });
    }
  }
  if (id === 'swim_shirt') {
    // contrasting side panels, conforming to the torso
    onBone(ctx.b, 'spine', rest);
    ctx.b.tag = 'torso';
    for (const c of [0, Math.PI]) ctx.b.add(tubePatch(torso, 0.0, 0.36, c - 0.22, c + 0.22, t.offset + 0.0015, 4, 8), { mat: ctx.trim });
  }
  if (id === 'hoodie') {
    onBone(ctx.b, 'spine', rest);
    ctx.b.tag = 'torso';
    // ribbed hem band
    ctx.b.add(band(torso, t.hem + 0.012, Math.max(t.offset, minOffset(t.hem + 0.012)), 0.006, 0.026), { mat: ctx.main, color: '#E6E6E6' });
    // kangaroo pocket: a raised panel on the belly
    const fa = t.folds?.amp ?? 0;
    ctx.b.add(tubePatch(torso, 0.0, 0.12, Math.PI / 2 - 0.62, Math.PI / 2 + 0.62, (u, v) => Math.max(t.offset, minOffset(v * 0.12)) + fa + 0.004 + 0.004 * Math.sin(Math.PI * u) * (1 - v * 0.5), 8, 4), { mat: ctx.main, color: '#E8E8E8' });
    if (!ctx.hidden.has('hood')) {
      // hood lying down on the upper back: a soft pillow-shaped panel on the back of the torso
      const back = -Math.PI / 2;
      ctx.b.add(
        tubePatch(torso, 0.27, 0.452, back - 0.95, back + 0.95, (u, v) => t.offset + fa + 0.004 + 0.04 * Math.sin(Math.PI * u) ** 0.7 * Math.sin(Math.PI * (0.15 + 0.85 * v)) ** 0.8, 12, 6),
        { mat: ctx.main },
      );
      // the hood's opening: a darker rolled rim along its top edge
      const rim: Vector3[] = [];
      for (let k = 0; k <= 8; k++) {
        const a = back - 0.85 + (1.7 * k) / 8;
        rim.push(onTube(torso, 0.44 - 0.03 * Math.sin((Math.PI * k) / 8), a, t.offset + fa + 0.01 + 0.03 * Math.sin((Math.PI * k) / 8) ** 0.7));
      }
      ctx.b.add(sweep(rim, 0.008, 6, 20), { mat: ctx.main, color: '#8F8F8F' });
    }
    if (!ctx.hidden.has('drawstrings')) {
      // cords lie on the chest: each point on the shell's surface (plus folds), hanging from the collar
      for (const s of [-1, 1]) {
        const pts = [0.455, 0.42, 0.38, 0.34].map((y, k) => onTube(torso, y, Math.PI / 2 + s * (0.32 - 0.02 * k), t.offset + fa + 0.006));
        cord(ctx, pts, 0.0035, '#FBF6EE');
      }
    }
  }
}

/* ---------------------------------------------------------------- bottoms ------------------------------ */

interface BottomSpec {
  leg: number | 'full';
  offset: number;
  band: 'self' | 'trim' | 'belt';
  stripe?: boolean;
  pockets?: boolean;
}

const BOTTOMS: Record<string, BottomSpec> = {
  shorts: { leg: -0.24, offset: 0.008, band: 'self', pockets: true },
  trunks: { leg: -0.15, offset: 0.008, band: 'trim', stripe: true },
  trousers: { leg: 'full', offset: 0.01, band: 'belt', pockets: true },
};

export function buildBottom(ctx: FitCtx, rest: Rest, id: string): void {
  if (id === 'skirt') return buildSkirt(ctx, rest);
  const s = BOTTOMS[id] ?? BOTTOMS.shorts;
  const pelvis = tube('pelvis');
  piece(ctx, rest, 'pelvis', { to: 0.1, offset: s.offset, endTop: false, step: 0.03 });
  const bandMat = s.band === 'trim' ? ctx.trim : ctx.main;
  waistband(ctx, rest, 0.092, s.offset, bandMat, s.band === 'belt' ? 0.005 : 0.006, s.band === 'belt' ? 0.026 : 0.022);
  onBone(ctx.b, 'hips', rest);
  ctx.b.tag = 'pelvis';
  if (s.band === 'belt') {
    const p = onTube(pelvis, 0.092, Math.PI / 2, s.offset + 0.005);
    ctx.b.add(new RoundedBoxGeometry(0.034, 0.026, 0.008, 2, 0.003), { color: '#C9B27A', mat: ctx.trim, pos: [p.x, p.y, p.z + 0.002] });
    ctx.envelope.push({ y0: HIP_Y + 0.092 - 0.013, y1: HIP_Y + 0.092 + 0.013, d: s.offset + 0.005 + 0.002 + 0.008 });
  } else {
    for (const k of [-1, 1]) {
      const p = onTube(pelvis, 0.085, Math.PI / 2 + k * 0.1, s.offset + 0.007);
      cord(ctx, [p, p.clone().add(new Vector3(k * 0.004, -0.035, 0.004)), p.clone().add(new Vector3(k * 0.006, -0.07, 0.006))], 0.003, '#FBF6EE');
    }
  }
  if (s.pockets) {
    // back pockets: slightly raised, conforming panels
    for (const k of [-1, 1]) {
      const c = -Math.PI / 2 + k * 0.42;
      ctx.b.add(tubePatch(pelvis, -0.02, 0.06, c - 0.26, c + 0.26, s.offset + 0.0018, 4, 3), { mat: ctx.main, color: '#D9D9D9' });
    }
  }
  for (const side of SIDES) {
    const full = s.leg === 'full';
    piece(ctx, rest, side.thigh, { from: full ? undefined : (s.leg as number), offset: s.offset, flareBottom: full ? 0 : 0.008, flareLen: 0.08, hemBottom: full ? 0 : 0.004, folds: { amp: 0.0025, freq: 5, phase: side.s } });
    if (s.stripe) {
      const th = tube(side.thigh);
      onBone(ctx.b, th.bone, rest);
      ctx.b.tag = side.thigh;
      const c = side.s > 0 ? 0 : Math.PI;
      ctx.b.add(tubePatch(th, (s.leg as number) + 0.01, 0, c - 0.18, c + 0.18, s.offset + 0.0035, 3, 6), { mat: ctx.trim });
    }
    if (full) {
      piece(ctx, rest, side.shin, { from: -0.37, offset: s.offset, flareBottom: 0.01, flareLen: 0.12, hemBottom: 0.004, folds: { amp: 0.003, freq: 4, phase: side.s * 2 } });
    }
  }
}

/** Skirt: fitted over the hips, flared below; the flare is skinned to the thighs so legs never cut through. */
function buildSkirt(ctx: FitCtx, rest: Rest): void {
  const pelvis = tube('pelvis');
  const off = 0.008;
  const hem = -0.3;
  const n = 40;
  const rings = [];
  for (let k = 0; k <= 14; k++) {
    const y = hem + ((0.1 - hem) * k) / 14;
    const r = ringAt(pelvis, Math.max(y, -0.02));
    const flare = Math.max(0, -0.02 - y);
    const pleat = flare > 0 ? (t: number) => 0.006 * (0.5 + 0.5 * Math.sin(t * 12)) * Math.min(1, flare / 0.06) : undefined;
    rings.push({ y, rx: r.rx + off + flare * 0.24, rz: r.rz + off + flare * 0.36, cx: 0, cz: r.cz, extra: pleat });
  }
  // hem lip
  const r0 = rings[0];
  rings.unshift({ ...r0, y: hem + 0.012, rx: r0.rx - 0.004, rz: r0.rz - 0.004, extra: undefined });
  const g: BufferGeometry = ringGrid(rings, n);
  ctx.b.setFrame(rest.hips);
  ctx.b.tag = 'skirt';
  const skin = (p: Vector3): Array<[number, number]> => {
    // waist: hips (+ spine blend); flare: follows the nearer thigh more the lower it is
    const front = smoothstep(-0.04, 0.08, p.z);
    const d = smoothstep(-0.02, -0.26, p.y) * (1 - front) + smoothstep(0.07, -0.05, p.y) * front;
    const side = smoothstep(-0.05, 0.05, p.x);
    const w = waistWeight(p.y + HIP_Y);
    const legs = d * (0.82 + 0.16 * front);
    return [
      [BONE_INDEX.hips, (1 - legs) * (1 - w)],
      [BONE_INDEX.spine, (1 - legs) * w],
      [BONE_INDEX.thighL, legs * side],
      [BONE_INDEX.thighR, legs * (1 - side)],
    ];
  };
  ctx.b.add(g, { mat: ctx.main, skin });
  ctx.covers.push({ seg: 'pelvis', from: -0.02, to: 0.1 });
  ctx.envelope.push({ y0: HIP_Y - 0.02, y1: HIP_Y + 0.1, d: off });
  waistband(ctx, rest, 0.092, off, ctx.main, 0.006, 0.024);
}

/* ---------------------------------------------------------------- shoes -------------------------------- */

/** The foot's outline at its sole (ellipse), scaled out by `grow`. */
function soleOutline(foot: EllipsoidSeg, growX: number, growZ: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const [, , cz] = foot.centre;
  const [a, , c] = foot.radii;
  for (let i = 0; i < 20; i++) {
    const t = (i / 20) * Math.PI * 2;
    // slab() lays the outline flat with outline-y -> -z
    out.push([(a + growX) * Math.cos(t), -(cz + (c + growZ) * Math.sin(t))]);
  }
  return out;
}

/** Point on the foot's offset surface above (x, z), for straps and laces. */
function onFootTop(foot: EllipsoidSeg, x: number, z: number, offset: number): Vector3 {
  const [cx, cy, cz] = foot.centre;
  const [a, b, c] = foot.radii;
  const u = (x - cx) / (a + offset);
  const w = (z - cz) / (c + offset);
  const k = Math.max(0, 1 - u * u - w * w);
  return new Vector3(x, cy + (b + offset) * Math.sqrt(k), z);
}

/** Point on the foot's offset surface at depth z and angle phi around the foot's cross-section (pi/2 = top). */
function onFootSide(foot: EllipsoidSeg, z: number, phi: number, offset: number): Vector3 {
  const [cx, cy, cz] = foot.centre;
  const [a, b, c] = foot.radii;
  const k = Math.sqrt(Math.max(0.02, 1 - ((z - cz) / c) ** 2));
  return new Vector3(cx + (a * k + offset) * Math.cos(phi), cy + (b * k + offset) * Math.sin(phi), z);
}

export function buildShoes(ctx: FitCtx, rest: Rest, id: string): void {
  for (const side of SIDES) {
    const foot = SEGMENTS[side.foot] as EllipsoidSeg;
    const [, cy] = foot.centre;
    const bottom = cy - foot.radii[1];
    if (id === 'sneakers') {
      onBone(ctx.b, 'foot' + (side.s > 0 ? 'L' : 'R') as BoneName, rest);
      ctx.b.tag = side.foot;
      ctx.b.add(ellipsoidShell(foot, 0.009, 16, 10), { mat: ctx.main });
      // sole: thick, a little wider than the upper
      ctx.b.add(slab(soleOutline(foot, 0.013, 0.016), 0.022, 0.003), { color: '#FBF6EE', mat: ctx.trim, pos: [0, bottom - 0.012, 0] });
      // toe cap and laces
      ctx.b.add(slab(soleOutline(foot, 0.012, 0.015).filter((_, i) => i <= 10), 0.019), { color: '#FBF6EE', mat: ctx.trim, pos: [0, bottom - 0.004, 0] });
      for (let k = 0; k < 3; k++) {
        const z = 0.05 + k * 0.022;
        const a = onFootTop(foot, -0.018, z, 0.011);
        const b = onFootTop(foot, 0, z + 0.004, 0.013);
        const c = onFootTop(foot, 0.018, z, 0.011);
        ctx.b.add(sweep([a, b, c], 0.0028, 4, 6), { color: '#FBF6EE', mat: ctx.trim });
      }
      ctx.covers.push({ seg: side.foot });
      // collar around the ankle (on the shin: wraps the ankle ball)
      piece(ctx, rest, side.shin, { from: undefined, to: -0.37, offset: 0.009, hemTop: 0.005, endTop: false });
    } else if (id === 'sandals') {
      onBone(ctx.b, 'foot' + (side.s > 0 ? 'L' : 'R') as BoneName, rest);
      ctx.b.tag = side.foot;
      ctx.b.add(slab(soleOutline(foot, 0.008, 0.014), 0.014, 0.002), { mat: ctx.main, pos: [0, bottom - 0.0165, 0] });
      // thong straps: from a post between the toes, over the top of the foot, down to the sole at the arch,
      // every point on the foot's surface (offset) so the strap never cuts a corner through the foot
      for (const k of [-1, 1]) {
        const pts: Vector3[] = [];
        for (let i = 0; i <= 8; i++) {
          const u = i / 8;
          pts.push(onFootSide(foot, 0.112 - 0.072 * u, Math.PI / 2 - k * (Math.PI / 2 + 0.45) * u ** 1.4, 0.006));
        }
        ctx.b.add(sweep(pts, 0.003, 5, 16), { mat: ctx.main });
      }
    }
  }
}

/** Dry-run a garment to read its covers/envelope/back depth without keeping the geometry. */
export function garmentInfo(slot: 'top' | 'bottom' | 'shoes', id: string, rest: Rest, hidden: ReadonlySet<GarmentPart> = new Set()): Pick<FitCtx, 'covers' | 'envelope' | 'backDepth'> {
  const ctx: FitCtx = { b: new ModelBuilder(), main: null as unknown as Material, trim: null as unknown as Material, under: () => 0, hidden, covers: [], envelope: [], backDepth: 0 };
  if (slot === 'top') buildTop(ctx, rest, id);
  else if (slot === 'bottom') buildBottom(ctx, rest, id);
  else buildShoes(ctx, rest, id);
  ctx.backDepth = slot === 'top' ? topBackDepth(id, hidden) : 0;
  return ctx;
}

/** Envelope lookup: the largest offset any of these entries has at root height Y. */
export function envelopeAt(env: FitCtx['envelope'], Y: number): number {
  let m = 0;
  for (const e of env) if (Y >= e.y0 && Y <= e.y1) m = Math.max(m, e.d);
  return m;
}

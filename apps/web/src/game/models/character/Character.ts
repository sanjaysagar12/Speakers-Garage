import { Bone, BoxGeometry, Color, Group, MathUtils, type Mesh, ShaderMaterial, Skeleton, SkinnedMesh, Sphere, TorusGeometry, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ModelBuilder, disposeObject } from '../util/builder';
import { ellipsoid, sweep } from '../util/geo';
import { toon, toonUnique } from '../../materials/toon';
import { PAL } from '../palette';
import { buildHair } from './hair';
import { buildHat, hatFit } from './hats';
import { BONES, BONE_REST, DIM, HEAD, REST, SEGMENTS, ringAt, segBottom, segTop, type BoneName, type EllipsoidSeg, type SegName, type TubeSeg } from './rig';
import { tubeShell, ellipsoidShell } from './shell';
import { buildBottom, buildShoes, buildTop, envelopeAt, onBone, topBackDepth, topOffset, type Cover, type FitCtx } from './garments';
import { resolveFit } from './fitRules';
import type { AvatarConfig } from '../../../types';

/**
 * Procedural anime-leaning character (~1.7 m, ~6.5 heads), built from the rig reference (rig.ts):
 *  - the body is generated from the rig's segments (rings + ball joints),
 *  - clothes are offset shells of those same segments (garments.ts), hats are fitted to the head (hats.ts),
 *  - hair is masked/tucked by the hat (hats.ts hairMask) and pushed out by what is on the back,
 *  - body parts under clothes are not drawn.
 * One skinned mesh per material: the bones are the old pivots (same names, same animation code), so the
 * waist bends smoothly and a skirt follows the legs. Colours are per-character uniforms (recolouring is
 * free); a style change rebuilds only the slots that depend on it.
 *
 * Local frame: feet at y = 0, facing +z.
 */

/** frame-loop scratch (no allocation per frame) */
const SWING_TARGET = new Vector3();

const HIP_Y = DIM.hipY;
const FOREARM = DIM.forearm;

export interface CharacterMotion {
  /** horizontal speed, m/s */
  speed: number;
  running: boolean;
  /** 0..1 how deep in water (wading pose, shorter steps) */
  wade: number;
  /** body yaw rate, rad/s (leans into turns) */
  turnRate: number;
  /** local-space velocity (x right, z forward), for hair trailing */
  localVel: Vector3;
  /** emote: 0 none, 1 wave, 2 dance, 3 sit (same encoding as the network animation byte) */
  emote?: number;
}

type Pivots = Record<BoneName, Bone>;

type MatKey = 'skin' | 'hair' | 'top' | 'bottom' | 'shoes' | 'hat' | 'accessory';

/** Depth bias per material layer (0 = none): skin < hair < accessories. Exported for the fit test. */
export const DEPTH_LAYER: Record<MatKey, number> = { skin: 0, bottom: 0, top: 0, shoes: 0, hat: 0, hair: 1, accessory: 2 };

/** Body ranges hidden under a cover start this far inside the garment's edge (no gaps when looking in). */
const COVER_MARGIN = 0.03;

/** The parts of a tube segment left visible by the covers (open ends where they are cut). */
export function visibleRanges(seg: TubeSeg, covers: readonly Cover[]): Array<[number, number]> {
  const lo = segBottom(seg);
  const hi = segTop(seg);
  let ranges: Array<[number, number]> = [[-Infinity, Infinity]];
  for (const c of covers) {
    if (c.seg !== seg.name) continue;
    const a = c.from === undefined ? -Infinity : c.from + COVER_MARGIN;
    const b = c.to === undefined ? Infinity : c.to - COVER_MARGIN;
    if (b <= a) continue;
    const next: Array<[number, number]> = [];
    for (const [x, y] of ranges) {
      if (b <= x || a >= y) next.push([x, y]);
      else {
        if (a > x) next.push([x, a]);
        if (b < y) next.push([b, y]);
      }
    }
    ranges = next;
  }
  return ranges.filter(([a, b]) => Math.min(b, hi) - Math.max(a, lo) > 0.004 || (a < lo && b > lo) || (b > hi && a < hi));
}

/** Dependencies of each slot's geometry on the config (colours never rebuild anything). */
const DEPS: Record<string, Array<keyof AvatarConfig>> = {
  bottom: ['bottomId'],
  top: ['topId', 'bottomId', 'accessoryId'],
  shoes: ['shoesId'],
  body: ['topId', 'bottomId', 'shoesId'],
  hat: ['hatId'],
  hair: ['hairStyle', 'hatId', 'topId', 'accessoryId'],
  accessory: ['accessoryId', 'topId'],
};
/** How far an accessory sticks out behind the upper back (long hair hangs over it). */
function accessoryBackDepth(id: string, topOff: number): number {
  if (id === 'backpack') return topOff + 0.004 + 0.13 + 0.04;
  if (id === 'scarf') return 0.05;
  return 0;
}

const ORDER = ['bottom', 'top', 'shoes', 'body', 'hat', 'hair', 'accessory'] as const;

export class Character {
  readonly root = new Group();
  private readonly p: Pivots;
  readonly skeleton: Skeleton;
  private readonly mats: Record<MatKey, ShaderMaterial>;
  private cfg: AvatarConfig | null = null;
  /** slot -> meshes that belong to it (removed on rebuild) */
  private readonly slotParts = new Map<string, Group[]>();
  private readonly slotKeys = new Map<string, string>();
  /** what the current clothes cover and how far they stand off (for the body and outer layers) */
  private fit: { covers: Cover[]; under: FitCtx['envelope']; back: number } = { covers: [], under: [], back: 0 };
  private phase = 0;
  private time = Math.random() * 10;
  private gait = 0; // 0 idle .. 1 walk .. 2 run (smoothed)
  private readonly swing = new Vector3();
  private readonly swingVel = new Vector3();
  private lean = 0;
  /** emote blend (0..1) and the emote being shown or faded out */
  private emoteW = 0;
  private emoteShown = 0;
  /** called with 0 (left) or 1 (right) when a foot plants */
  onStep: ((foot: 0 | 1) => void) | null = null;

  constructor(cfg: AvatarConfig) {
    const bones = {} as Pivots;
    for (const name of BONES) {
      const [parent, o] = BONE_REST[name];
      const b = new Bone();
      b.name = name;
      b.position.set(...o);
      (parent ? bones[parent] : this.root).add(b);
      bones[name] = b;
    }
    this.p = bones;
    this.root.name = 'character';
    // bind pose = rest (bones only translate); inverses in model space
    this.skeleton = new Skeleton(
      BONES.map((b) => bones[b]),
      BONES.map((b) => REST[b].clone().invert()),
    );

    this.mats = {
      skin: toonUnique({ grain: 0.6 }),
      hair: toonUnique({ swing: true, double: true, grain: 0.8 }),
      top: toonUnique({ swing: true }),
      bottom: toonUnique({ double: true }),
      shoes: toonUnique({}),
      hat: toonUnique({ double: true }),
      accessory: toonUnique({ swing: true }),
    };
    // depth layers: where a surface touches the one under it tangentially (hair over the top of an ear,
    // glasses temples in the hair), the outer layer wins the depth test instead of flickering
    for (const [k, layer] of Object.entries(DEPTH_LAYER) as Array<[MatKey, number]>) {
      if (!layer) continue;
      const m = this.mats[k];
      m.polygonOffset = true;
      m.polygonOffsetFactor = -layer;
      m.polygonOffsetUnits = -layer * 2;
    }
    this.setConfig(cfg);
  }

  /* ---------------------------------------------------------------- building ---------------------------- */

  /**
   * Build `b` as skinned meshes at the model root, tracked under `slot` for rebuilds. With `rigidOn`, the
   * parts are plain meshes in that bone's space instead (hair and hats only follow the head: no skinning
   * cost for the character's densest geometry).
   */
  private attach(slot: string, b: ModelBuilder, rigidOn?: BoneName): void {
    if (b.empty) return;
    if (rigidOn) {
      const grp = b.build(slot, true);
      this.p[rigidOn].add(grp);
      const list = this.slotParts.get(slot) ?? [];
      list.push(grp);
      this.slotParts.set(slot, list);
      return;
    }
    const grp = b.build(slot, true, this.skeleton);
    grp.traverse((o) => {
      const m = o as SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      // a generous fixed bound: poses (sitting, waving) move vertices far from the rest pose
      m.boundingSphere = new Sphere(new Vector3(0, 0.9, 0), 1.25);
      m.castShadow = true;
      m.receiveShadow = true;
    });
    this.root.add(grp);
    const list = this.slotParts.get(slot) ?? [];
    list.push(grp);
    this.slotParts.set(slot, list);
  }

  private clearSlot(slot: string): void {
    for (const grp of this.slotParts.get(slot) ?? []) {
      grp.removeFromParent();
      disposeObject(grp);
    }
    this.slotParts.delete(slot);
  }

  private ctx(b: ModelBuilder, main: ShaderMaterial, trim = toon({ color: PAL.offWhite }), hidden = resolveFit(this.cfg!).hidden): FitCtx {
    const under = this.fit.under;
    return { b, main, trim, under: (Y) => envelopeAt(under, Y), hidden, covers: [], envelope: [], backDepth: 0 };
  }

  private buildBody(covers: readonly Cover[]): void {
    const m = this.mats.skin;
    const b = new ModelBuilder();
    // tubes: torso, neck, pelvis, limbs, minus what clothes cover
    for (const name of Object.keys(SEGMENTS) as SegName[]) {
      const seg = SEGMENTS[name];
      if (seg.kind !== 'tube') continue;
      onBone(b, seg.bone, REST);
      for (const [lo, hi] of visibleRanges(seg, covers)) {
        b.add(tubeShell(seg, { from: lo, to: hi, offset: 0, step: 0.06 }), { mat: m });
      }
    }
    // feet (shoes may cover them)
    for (const f of ['footL', 'footR'] as const) {
      if (covers.some((c) => c.seg === f)) continue;
      const seg = SEGMENTS[f] as EllipsoidSeg;
      onBone(b, seg.bone, REST);
      b.add(ellipsoidShell(seg, 0, 12, 8), { mat: m });
    }
    // head: cranium + jaw + ears + face (eyes, brows, nose, mouth)
    onBone(b, 'head', REST);
    for (const s of ['head', 'jaw'] as const) {
      const seg = SEGMENTS[s] as EllipsoidSeg;
      b.add(ellipsoid(...seg.radii, s === 'head' ? 20 : 14, s === 'head' ? 16 : 10), { mat: m, pos: seg.centre });
    }
    const E = HEAD.ear;
    for (const s of [-1, 1]) {
      b.add(ellipsoid(E.rx, E.ry, E.rz, 8, 6), { mat: m, pos: [s * E.x, E.y, E.z], rot: [0, s * 0.3, 0] });
      b.add(ellipsoid(0.017, 0.024, 0.008, 10, 8), { color: '#2B2E3A', pos: [s * 0.037, HEAD.eyeY, 0.1], rot: [0, s * 0.35, 0] });
      b.add(ellipsoid(0.006, 0.007, 0.003, 6, 4), { color: '#FFFFFF', pos: [s * 0.041, HEAD.eyeY + 0.008, 0.106], rot: [0, s * 0.35, 0] });
      b.add(new BoxGeometry(0.03, 0.005, 0.006), { color: '#3B2A24', pos: [s * 0.038, 0.022, 0.1], rot: [0, s * 0.35, s * -0.12] });
    }
    b.add(ellipsoid(0.008, 0.012, 0.01, 6, 5), { mat: m, pos: [0, -0.04, 0.112] });
    b.add(new BoxGeometry(0.022, 0.004, 0.005), { color: '#B5615A', pos: [0, -0.078, 0.1] });
    // hands
    for (const [bone, s] of [['foreL', 1], ['foreR', -1]] as const) {
      onBone(b, bone, REST);
      b.add(ellipsoid(0.03, 0.05, 0.022, 8, 6), { mat: m, pos: [0, -FOREARM - 0.05, 0.005] });
      b.add(ellipsoid(0.012, 0.028, 0.012, 6, 5), { mat: m, pos: [s * -0.022, -FOREARM - 0.035, 0.018], rot: [0, 0, s * 0.5] });
    }
    this.attach('body', b);
  }

  private buildHairSlot(cfg: AvatarConfig): void {
    const b = new ModelBuilder();
    // long hair hangs behind whatever is on the upper back (head space z; the back sits ~0.1 behind the neck)
    const backDepth = Math.max(this.fit.back, accessoryBackDepth(cfg.accessoryId, topOffset(cfg.topId)));
    buildHair(b, this.mats.hair, cfg.hairStyle, { hat: hatFit(cfg.hatId), back: -(0.124 + backDepth), glasses: cfg.accessoryId === 'sunglasses' });
    this.attach('hair', b, 'head');
  }

  private buildAccessory(cfg: AvatarConfig): void {
    const m = this.mats.accessory;
    const id = cfg.accessoryId;
    const b = new ModelBuilder();
    const torso = SEGMENTS.torso as TubeSeg;
    const off = topOffset(cfg.topId) + (cfg.topId === 'hoodie' ? 0.004 : 0);
    if (id === 'sunglasses') {
      onBone(b, 'head', REST);
      // lenses in front of the eyes, bridge on the nose bridge, temples along the head to the ear line
      for (const s of [-1, 1]) {
        b.add(ellipsoid(0.03, 0.022, 0.006, 12, 8), { mat: m, pos: [s * 0.039, HEAD.eyeY + 0.002, 0.117], rot: [0, s * 0.3, 0] });
        const pts: Vector3[] = [];
        for (const [z, y] of HEAD.temple) {
          const u = new Vector3(0, y / HEAD.radii[1], z / HEAD.radii[2]);
          const x = HEAD.radii[0] * Math.sqrt(Math.max(0, 1 - u.y * u.y - u.z * u.z)) + 0.006;
          pts.push(new Vector3(s * x, y, z));
        }
        b.add(sweep(pts, [0.0035, 0.0022], 5, 14), { mat: m });
      }
      b.add(sweep([new Vector3(-0.012, HEAD.noseBridge.y, HEAD.noseBridge.z + 0.008), new Vector3(0, HEAD.noseBridge.y + 0.004, HEAD.noseBridge.z + 0.01), new Vector3(0.012, HEAD.noseBridge.y, HEAD.noseBridge.z + 0.008)], 0.0025, 4, 6), { mat: m });
    } else if (id === 'scarf') {
      onBone(b, 'spine', REST);
      // a soft ring that rests on the top of the shoulders, outside the top's collar
      const y = 0.5 + off * 0.4;
      const R = 0.08 + off * 0.5;
      b.add(new TorusGeometry(R, 0.027, 8, 22), { mat: m, pos: [0, y, -0.004], rot: [Math.PI / 2 - 0.08, 0, 0], scale: [1, 0.86, 0.8] });
      // tails hang down the back, just off the back of the top
      for (const [x, len, w] of [[0.03, 0.3, 0.032], [-0.022, 0.22, 0.03]] as const) {
        const pts: Vector3[] = [];
        for (let k = 0; k <= 4; k++) {
          const yy = y - 0.02 - (len * k) / 4;
          const r = ringAt(torso, Math.max(yy, 0));
          pts.push(new Vector3(x + 0.006 * k, yy, r.cz - r.rz - off - 0.012 - 0.01 * (k === 0 ? 0 : 1)));
        }
        pts[0].z = -R * 0.8;
        b.add(sweep(pts, [w, 0.008], 6, 12), { mat: m, sway: (v) => Math.min(1, Math.max(0, (0.45 - v.y) / 0.3)) });
      }
    } else if (id === 'backpack') {
      onBone(b, 'spine', REST);
      const backAt = (y: number) => {
        const r = ringAt(torso, y);
        return r.cz - r.rz - off;
      };
      const zf = Math.min(backAt(0.22), backAt(0.34)) - 0.004;
      const d = 0.13;
      b.add(new RoundedBoxGeometry(0.27, 0.33, d, 3, 0.04), { mat: m, pos: [0, 0.22, zf - d / 2] });
      b.add(new RoundedBoxGeometry(0.27, 0.12, d + 0.01, 3, 0.04), { mat: m, pos: [0, 0.36, zf - d / 2 - 0.004], rot: [0.12, 0, 0] });
      b.add(new RoundedBoxGeometry(0.17, 0.12, 0.05, 2, 0.02), { mat: m, pos: [0, 0.14, zf - d - 0.02] });
      b.add(new BoxGeometry(0.06, 0.012, 0.012), { color: PAL.offWhite, pos: [0, 0.2, zf - d - 0.046] });
      // straps over the shoulders, following the top's surface
      for (const s of [-1, 1]) {
        const at = (y: number, front: boolean) => {
          const r = ringAt(torso, y);
          const x = s * 0.095;
          const k = Math.min(0.97, Math.abs(x) / (r.rx + off + 0.016));
          return new Vector3(x, y, r.cz + (front ? 1 : -1) * (r.rz + off + 0.016) * Math.sqrt(1 - k * k));
        };
        const pts = [new Vector3(s * 0.09, 0.32, zf - 0.01), at(0.4, false), at(0.44, false), new Vector3(s * 0.095, ringAt(torso, 0.455).y + 0.026 + off, -0.006), at(0.44, true), at(0.38, true), at(0.26, true), at(0.13, true)];
        b.add(sweep(pts, [0.011, 0.004], 5, 22), { color: '#2A2F38' });
      }
    }
    this.attach('accessory', b);
  }

  /** Apply a config: style changes rebuild the slots that depend on them, colour changes only touch uniforms. */
  setConfig(cfg: AvatarConfig): void {
    const c = (m: ShaderMaterial, hex: string) => (m.uniforms.uColor.value as Color).set(hex);
    c(this.mats.skin, cfg.skin);
    c(this.mats.hair, cfg.hairColor);
    c(this.mats.top, cfg.topColor);
    c(this.mats.bottom, cfg.bottomColor);
    c(this.mats.shoes, cfg.shoesColor);
    c(this.mats.hat, cfg.hatColor);
    c(this.mats.accessory, cfg.accessoryColor);
    this.cfg = { ...cfg };
    const fit = resolveFit(cfg);
    const covers: Cover[] = [];
    let under: FitCtx['envelope'] = this.fit.under;
    let back = this.fit.back;
    for (const slot of ORDER) {
      const key = DEPS[slot].map((k) => cfg[k]).join('|');
      const dirty = this.slotKeys.get(slot) !== key;
      if (slot === 'bottom') {
        const ctx = this.ctx(new ModelBuilder(), this.mats.bottom, toon({ color: PAL.offWhite }), fit.hidden);
        ctx.under = () => 0;
        buildBottom(ctx, REST, cfg.bottomId);
        covers.push(...ctx.covers);
        under = ctx.envelope;
        this.fit.under = under;
        if (dirty) {
          this.clearSlot('bottom');
          this.attach('bottom', ctx.b);
        }
      } else if (slot === 'top') {
        const ctx = this.ctx(new ModelBuilder(), this.mats.top, toon({ color: PAL.offWhite }), fit.hidden);
        buildTop(ctx, REST, cfg.topId);
        covers.push(...ctx.covers);
        back = topBackDepth(cfg.topId, fit.hidden);
        if (dirty) {
          this.clearSlot('top');
          this.attach('top', ctx.b);
        }
      } else if (slot === 'shoes') {
        const ctx = this.ctx(new ModelBuilder(), this.mats.shoes, toon({ color: PAL.offWhite }), fit.hidden);
        buildShoes(ctx, REST, cfg.shoesId);
        covers.push(...ctx.covers);
        if (dirty) {
          this.clearSlot('shoes');
          this.attach('shoes', ctx.b);
        }
      } else if (!dirty) {
        continue;
      } else if (slot === 'body') {
        this.clearSlot('body');
        this.buildBody(covers);
      } else if (slot === 'hat') {
        this.clearSlot('hat');
        const b = new ModelBuilder();
        buildHat(b, this.mats.hat, toon({ color: PAL.coral }), cfg.hatId);
        this.attach('hat', b, 'head');
      } else if (slot === 'hair') {
        this.fit = { covers, under, back };
        this.clearSlot('hair');
        this.buildHairSlot(cfg);
      } else if (slot === 'accessory') {
        this.clearSlot('accessory');
        this.buildAccessory(cfg);
      }
      this.slotKeys.set(slot, key);
    }
    this.fit = { covers, under, back };
  }

  /** Meshes of one slot (for the fit test). */
  slotMeshes(slot: string): Mesh[] {
    const out: Mesh[] = [];
    for (const g of this.slotParts.get(slot) ?? []) g.traverse((o) => (o as Mesh).isMesh && out.push(o as Mesh));
    return out;
  }

  /** Depth layer of a material (for the fit test): pairs on different layers cannot z-fight. */
  depthLayer(m: unknown): number {
    for (const [k, mat] of Object.entries(this.mats)) if (mat === m) return DEPTH_LAYER[k as MatKey];
    return 0;
  }

  /** The skin material (for the fit test). */
  get skinMaterial(): ShaderMaterial {
    return this.mats.skin;
  }

  /** Bone by name (for the fit test). */
  bone(name: BoneName): Bone {
    return this.p[name];
  }

  /** What the current clothes cover (for the fit test and debugging). */
  get covers(): readonly Cover[] {
    return this.fit.covers;
  }

  /* ---------------------------------------------------------------- animation --------------------------- */

  /** Advance the procedural animation. Distance-driven gait so feet never slide. */
  update(dt: number, mo: CharacterMotion): void {
    const P = this.p;
    this.time += dt;
    const t = this.time;
    const target = mo.speed < 0.15 ? 0 : mo.running ? 2 : 1;
    this.gait = MathUtils.damp(this.gait, target, 8, dt);
    const walkW = Math.min(1, this.gait);
    const runW = Math.max(0, this.gait - 1);
    const stride = MathUtils.lerp(1.25, 2.1, runW) * (1 - 0.3 * mo.wade);
    const prevPhase = this.phase;
    if (mo.speed > 0.05) this.phase += (mo.speed * dt * Math.PI * 2) / stride;
    else this.phase = MathUtils.damp(this.phase, Math.round(this.phase / Math.PI) * Math.PI, 6, dt);
    const ph = this.phase;
    // footstep events at each half cycle
    if (mo.speed > 0.3 && Math.floor(prevPhase / Math.PI) !== Math.floor(ph / Math.PI)) this.onStep?.((Math.floor(ph / Math.PI) % 2) as 0 | 1);

    const legA = MathUtils.lerp(0.36, 0.6, runW) * walkW * (1 - 0.35 * mo.wade);
    const kneeA = MathUtils.lerp(0.45, 1.1, runW) * walkW;
    const armA = MathUtils.lerp(0.3, 0.55, runW) * walkW;
    const s = Math.sin(ph);
    P.thighL.rotation.x = -s * legA;
    P.thighR.rotation.x = s * legA;
    // knee flexes while that leg swings forward
    P.shinL.rotation.x = Math.max(0, Math.cos(ph)) * kneeA + 0.04;
    P.shinR.rotation.x = Math.max(0, -Math.cos(ph)) * kneeA + 0.04;
    P.footL.rotation.x = -P.shinL.rotation.x * 0.3 + P.thighL.rotation.x * -0.2;
    P.footR.rotation.x = -P.shinR.rotation.x * 0.3 + P.thighR.rotation.x * -0.2;

    // arms: counter-swing, elbows bend more when running, wading lifts them out
    const breathe = Math.sin(t * 1.9);
    const idleW = 1 - walkW;
    P.armL.rotation.x = s * armA + idleW * 0.03 * breathe;
    P.armR.rotation.x = -s * armA - idleW * 0.03 * breathe;
    const outZ = 0.09 + mo.wade * 0.35 + idleW * 0.015 * breathe;
    P.armL.rotation.z = outZ;
    P.armR.rotation.z = -outZ;
    P.foreL.rotation.x = -(MathUtils.lerp(0.22, 1.1, runW) * walkW + 0.12 + idleW * 0.05);
    P.foreR.rotation.x = P.foreL.rotation.x;

    // body: bob, lean, twist, breathing
    const bob = walkW * MathUtils.lerp(0.028, 0.06, runW) * Math.cos(ph * 2);
    P.hips.position.y = HIP_Y - Math.abs(bob) * 0.6 + bob * 0.4 - mo.wade * 0.02 + idleW * 0.004 * breathe;
    P.hips.rotation.y = s * 0.09 * walkW;
    P.spine.rotation.y = -s * 0.14 * walkW;
    const leanTarget = runW * 0.2 + walkW * 0.04;
    this.lean = MathUtils.damp(this.lean, leanTarget, 5, dt);
    P.spine.rotation.x = this.lean;
    P.spine.scale.set(1 + idleW * 0.006 * breathe, 1 + idleW * 0.01 * breathe, 1 + idleW * 0.012 * breathe);
    this.root.rotation.z = MathUtils.clamp(-mo.turnRate * 0.04 * (0.4 + runW), -0.18, 0.18);
    P.head.rotation.x = -this.lean * 0.6 + idleW * 0.02 * Math.sin(t * 0.7);
    P.head.rotation.y = idleW * 0.12 * Math.sin(t * 0.31) * Math.sin(t * 0.17);

    // hair / scarf spring: trails opposite to velocity, bounces with the gait, nudged by wind
    const targetSwing = SWING_TARGET.set(-mo.localVel.x * 0.012, -Math.abs(bob) * 0.5, -mo.localVel.z * 0.011 - 0.004);
    targetSwing.x += Math.sin(t * 1.3) * 0.006;
    const k = 70;
    const damp = 9;
    const acc = targetSwing.sub(this.swing).multiplyScalar(k).addScaledVector(this.swingVel, -damp);
    this.swingVel.addScaledVector(acc, Math.min(dt, 0.05));
    this.swing.addScaledVector(this.swingVel, Math.min(dt, 0.05));
    this.swing.clampLength(0, 0.075);
    (this.mats.hair.uniforms.uSwing.value as Vector3).copy(this.swing);
    (this.mats.accessory.uniforms.uSwing.value as Vector3).copy(this.swing).multiplyScalar(1.4);
    (this.mats.top.uniforms.uSwing.value as Vector3).copy(this.swing).multiplyScalar(0.5);
    this.applyEmote(dt, mo.emote ?? 0);
  }

  /** Emote poses layered over the gait, blended in and out (wave, dance, sit). */
  private applyEmote(dt: number, emote: number): void {
    if (emote) this.emoteShown = emote;
    this.emoteW = MathUtils.damp(this.emoteW, emote ? 1 : 0, 7, dt);
    const w = this.emoteW;
    const P = this.p;
    // channels the gait never sets: reset every frame so an emote can't leave them bent
    P.spine.rotation.z = 0;
    P.foreR.rotation.z = 0;
    if (w < 0.001) return;
    const t = this.time;
    const mix = (cur: number, target: number) => cur + (target - cur) * w;
    if (this.emoteShown === 1) {
      // wave: right arm up and out, forearm swinging
      P.armR.rotation.z = mix(P.armR.rotation.z, -2.55);
      P.armR.rotation.x = mix(P.armR.rotation.x, -0.15);
      P.foreR.rotation.x = mix(P.foreR.rotation.x, -0.35);
      P.foreR.rotation.z = mix(P.foreR.rotation.z, 0.45 * Math.sin(t * 10));
    } else if (this.emoteShown === 2) {
      // dance: bounce, hip sway, arms up alternating
      const b = Math.abs(Math.sin(t * 5.5));
      P.hips.position.y = mix(P.hips.position.y, HIP_Y - 0.05 + b * 0.06);
      P.hips.rotation.y = mix(P.hips.rotation.y, Math.sin(t * 2.75) * 0.4);
      P.spine.rotation.z = mix(P.spine.rotation.z, Math.sin(t * 2.75 + 1) * 0.12);
      P.armL.rotation.z = mix(P.armL.rotation.z, 2.3 + 0.35 * Math.sin(t * 5.5));
      P.armR.rotation.z = mix(P.armR.rotation.z, -2.3 - 0.35 * Math.sin(t * 5.5 + Math.PI));
      P.foreL.rotation.x = mix(P.foreL.rotation.x, -0.5);
      P.foreR.rotation.x = mix(P.foreR.rotation.x, -0.5);
      P.thighL.rotation.x = mix(P.thighL.rotation.x, -0.25 * b);
      P.shinL.rotation.x = mix(P.shinL.rotation.x, 0.45 * b);
    } else if (this.emoteShown === 3) {
      // sit on the ground: legs forward, knees up, hands resting back
      P.hips.position.y = mix(P.hips.position.y, HIP_Y - 0.6);
      P.thighL.rotation.x = mix(P.thighL.rotation.x, -1.35);
      P.thighR.rotation.x = mix(P.thighR.rotation.x, -1.25);
      P.shinL.rotation.x = mix(P.shinL.rotation.x, 1.0);
      P.shinR.rotation.x = mix(P.shinR.rotation.x, 0.85);
      P.armL.rotation.x = mix(P.armL.rotation.x, 0.45);
      P.armR.rotation.x = mix(P.armR.rotation.x, 0.45);
      P.spine.rotation.x = mix(P.spine.rotation.x, -0.12);
    }
  }

  /** world-space positions of the feet (for footprints) */
  footWorld(foot: 0 | 1, out: Vector3): Vector3 {
    const f = foot === 0 ? this.p.footL : this.p.footR;
    return f.getWorldPosition(out);
  }

  dispose(): void {
    disposeObject(this.root);
    this.root.removeFromParent();
    Object.values(this.mats).forEach((m) => m.dispose());
  }
}


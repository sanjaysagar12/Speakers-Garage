import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  FrontSide,
  Group,
  MathUtils,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ModelBuilder, disposeObject } from '../util/builder';
import { ellipsoid, lathe, slab, sweep } from '../util/geo';
import { toon, toonUnique } from '../../materials/toon';
import { PAL } from '../palette';
import { buildHair } from './hair';
import type { AvatarConfig } from '../../../types';

/**
 * Procedural anime-leaning character (~1.7 m, ~6.5 heads). Rig = nested pivot groups; parts are merged
 * per pivot and per material. Colours live in per-character materials (uniform uColor), so recolouring is
 * free and only a style change rebuilds that slot.
 *
 * Local frame: feet at y = 0, facing +z.
 */

/** frame-loop scratch (no allocation per frame) */
const SWING_TARGET = new Vector3();

const HIP_Y = 0.88;
const THIGH = 0.42;
const SHIN = 0.41;
const UPPER_ARM = 0.27;
const FOREARM = 0.24;

/** Tapered limb hanging from its pivot (y = 0 down to y = -len) with rounded ends. */
function limb(len: number, r0: number, r1: number, seg = 10): BufferGeometry {
  return lathe(
    [
      [0.001, -len - r1 * 0.75],
      [r1 * 0.75, -len - r1 * 0.5],
      [r1, -len],
      [(r0 + r1) / 2 * 1.04, -len / 2],
      [r0, 0],
      [r0 * 0.75, r0 * 0.5],
      [0.001, r0 * 0.75],
    ],
    seg,
  );
}

/** Open sleeve/tube without caps (cloth). */
function tube(top: number, bottom: number, r0: number, r1: number, seg = 12): BufferGeometry {
  return lathe([[r1, bottom], [(r0 + r1) / 2 * 1.02, (top + bottom) / 2], [r0, top]], seg);
}

/** Torso profile in spine space (spine pivot sits at y = 0.98 when standing). [radius, y] bottom to top. */
const TORSO: Array<[number, number]> = [
  [0.135, -0.12],
  [0.15, -0.05],
  [0.128, 0.04],
  [0.14, 0.16],
  [0.158, 0.28],
  [0.165, 0.37],
  [0.13, 0.43],
  [0.06, 0.47],
];
const TORSO_Z = 0.7;

function torsoGeo(scale: number, from: number, to: number, add = 0, closed = false): BufferGeometry {
  const pts = TORSO.filter(([, y]) => y >= from - 1e-6 && y <= to + 1e-6).map(([r, y]) => [r * scale + add, y] as [number, number]);
  // exact cut points
  const at = (y: number) => {
    for (let i = 0; i < TORSO.length - 1; i++) {
      const [ra, ya] = TORSO[i];
      const [rb, yb] = TORSO[i + 1];
      if (y >= ya && y <= yb) return ra + ((rb - ra) * (y - ya)) / (yb - ya);
    }
    return TORSO[TORSO.length - 1][0];
  };
  if (pts.length === 0 || pts[0][1] > from) pts.unshift([at(from) * scale + add, from]);
  if (pts[pts.length - 1][1] < to) pts.push([at(to) * scale + add, to]);
  if (closed) {
    pts.unshift([0.001, from - 0.02]);
    pts.push([0.04, to + 0.02], [0.001, to + 0.03]);
  }
  const g = lathe(pts, 18);
  g.scale(1, 1, TORSO_Z);
  return g;
}

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

type Pivots = Record<
  'hips' | 'spine' | 'head' | 'thighL' | 'thighR' | 'shinL' | 'shinR' | 'footL' | 'footR' | 'armL' | 'armR' | 'foreL' | 'foreR',
  Group
>;

type MatKey = 'skin' | 'hair' | 'top' | 'bottom' | 'shoes' | 'hat' | 'accessory';

export class Character {
  readonly root = new Group();
  private readonly p: Pivots;
  private readonly mats: Record<MatKey, ShaderMaterial>;
  private cfg: AvatarConfig | null = null;
  /** slot -> groups that belong to it (removed on rebuild) */
  private readonly slotParts = new Map<string, Group[]>();
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
    const g = (name: string, parent: Group, x = 0, y = 0, z = 0) => {
      const n = new Group();
      n.name = name;
      n.position.set(x, y, z);
      parent.add(n);
      return n;
    };
    const hips = g('hips', this.root, 0, HIP_Y, 0);
    const spine = g('spine', hips, 0, 0.1, 0);
    const head = g('head', spine, 0, 0.6, 0.005);
    const thighL = g('thighL', hips, 0.088, -0.02, 0);
    const thighR = g('thighR', hips, -0.088, -0.02, 0);
    const shinL = g('shinL', thighL, 0, -THIGH, 0);
    const shinR = g('shinR', thighR, 0, -THIGH, 0);
    const footL = g('footL', shinL, 0, -SHIN, 0);
    const footR = g('footR', shinR, 0, -SHIN, 0);
    const armL = g('armL', spine, 0.185, 0.39, -0.005);
    const armR = g('armR', spine, -0.185, 0.39, -0.005);
    const foreL = g('foreL', armL, 0, -UPPER_ARM, 0);
    const foreR = g('foreR', armR, 0, -UPPER_ARM, 0);
    this.p = { hips, spine, head, thighL, thighR, shinL, shinR, footL, footR, armL, armR, foreL, foreR };
    this.root.name = 'character';

    this.mats = {
      skin: toonUnique({ grain: 0.6 }),
      hair: toonUnique({ swing: true, double: true, grain: 0.8 }),
      top: toonUnique({ swing: true }),
      bottom: toonUnique({}),
      shoes: toonUnique({}),
      hat: toonUnique({ double: true }),
      accessory: toonUnique({ swing: true }),
    };
    this.buildBody();
    this.setConfig(cfg);
  }

  /* ---------------------------------------------------------------- building ---------------------------- */

  /** Attach a freshly built mesh group to a pivot, tracked under `slot` for rebuilds. */
  private attach(slot: string, pivot: Group, b: ModelBuilder): void {
    if (b.empty) return;
    const grp = b.build(slot);
    pivot.add(grp);
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

  private buildBody(): void {
    const m = this.mats.skin;
    const P = this.p;
    // torso + neck
    const torso = new ModelBuilder().add(torsoGeo(1, -0.12, 0.47, 0, true), { mat: m });
    torso.add(new CylinderGeometry(0.043, 0.05, 0.14, 10), { mat: m, pos: [0, 0.52, 0.0] });
    this.attach('body', P.spine, torso);
    // pelvis
    this.attach('body', P.hips, new ModelBuilder().add(ellipsoid(0.15, 0.11, 0.105, 14, 10), { mat: m, pos: [0, 0.0, 0] }));
    // head: cranium + jaw + ears + face (eyes, brows, nose)
    const head = new ModelBuilder();
    head.add(ellipsoid(0.103, 0.112, 0.108, 20, 16), { mat: m, pos: [0, 0, 0] });
    head.add(ellipsoid(0.074, 0.07, 0.08, 14, 10), { mat: m, pos: [0, -0.058, 0.026] });
    for (const s of [-1, 1]) {
      head.add(ellipsoid(0.018, 0.03, 0.016, 8, 6), { mat: m, pos: [s * 0.1, -0.012, -0.004], rot: [0, s * 0.3, 0] });
      head.add(ellipsoid(0.017, 0.024, 0.008, 10, 8), { color: '#2B2E3A', pos: [s * 0.037, -0.012, 0.1], rot: [0, s * 0.35, 0] });
      head.add(ellipsoid(0.006, 0.007, 0.003, 6, 4), { color: '#FFFFFF', pos: [s * 0.041, -0.004, 0.106], rot: [0, s * 0.35, 0] });
      head.add(new BoxGeometry(0.03, 0.005, 0.006), { color: '#3B2A24', pos: [s * 0.038, 0.022, 0.1], rot: [0, s * 0.35, s * -0.12] });
    }
    head.add(ellipsoid(0.008, 0.012, 0.01, 6, 5), { mat: m, pos: [0, -0.04, 0.112] });
    head.add(new BoxGeometry(0.022, 0.004, 0.005), { color: '#B5615A', pos: [0, -0.078, 0.1] });
    this.attach('body', P.head, head);
    // arms
    for (const [up, fore, s] of [[P.armL, P.foreL, 1], [P.armR, P.foreR, -1]] as const) {
      this.attach('body', up, new ModelBuilder().add(ellipsoid(0.06, 0.055, 0.058, 10, 8), { mat: m, pos: [s * 0.012, -0.01, 0] }).add(limb(UPPER_ARM, 0.044, 0.036), { mat: m }));
      const fb = new ModelBuilder().add(limb(FOREARM, 0.036, 0.029), { mat: m });
      fb.add(ellipsoid(0.03, 0.05, 0.022, 8, 6), { mat: m, pos: [0, -FOREARM - 0.05, 0.005] });
      fb.add(ellipsoid(0.012, 0.028, 0.012, 6, 5), { mat: m, pos: [s * -0.022, -FOREARM - 0.035, 0.018], rot: [0, 0, s * 0.5] });
      this.attach('body', fore, fb);
    }
    // legs (feet belong to the shoes slot because barefoot/sandals/sneakers change them)
    for (const [th, sh] of [[P.thighL, P.shinL], [P.thighR, P.shinR]] as const) {
      this.attach('body', th, new ModelBuilder().add(limb(THIGH, 0.07, 0.05), { mat: m }));
      this.attach('body', sh, new ModelBuilder().add(limb(SHIN, 0.05, 0.034), { mat: m }));
    }
  }

  private buildHairSlot(style: string): void {
    const b = new ModelBuilder();
    buildHair(b, this.mats.hair, style);
    this.attach('hair', this.p.head, b);
  }

  private buildTop(id: string): void {
    const m = this.mats.top;
    const trim = toon({ color: PAL.offWhite });
    const P = this.p;
    const b = new ModelBuilder();
    const loose = id === 'hoodie' ? 1.12 : id === 'swim_shirt' ? 1.035 : 1.07;
    const add = id === 'hoodie' ? 0.012 : 0.006;
    if (id === 'tank') {
      b.add(torsoGeo(1.06, -0.07, 0.32, 0.006), { mat: m });
      for (const s of [-1, 1]) {
        b.add(sweep([new Vector3(s * 0.09, 0.3, 0.1), new Vector3(s * 0.11, 0.43, 0.02), new Vector3(s * 0.1, 0.3, -0.1)], [0.016, 0.006], 6, 8), { mat: m });
      }
    } else {
      b.add(torsoGeo(loose, -0.07, 0.44, add), { mat: m });
      // collar
      b.add(new TorusGeometry(0.062, id === 'hoodie' ? 0.02 : 0.011, 6, 18), { mat: id === 'swim_shirt' ? trim : m, pos: [0, 0.445, 0.0], rot: [Math.PI / 2 - 0.12, 0, 0], scale: [1.05, 0.85, 1] });
      // hem band
      b.add(torsoGeo(loose * 1.02, -0.075, -0.045, add + 0.003), { mat: m });
    }
    if (id === 'hoodie') {
      // hood lying on the upper back: the part you see most from the chase camera
      b.add(ellipsoid(0.115, 0.075, 0.045, 14, 10), { mat: m, pos: [0, 0.405, -0.085], rot: [-0.5, 0, 0] });
      b.add(ellipsoid(0.08, 0.045, 0.02, 12, 8), { color: '#3A3F4A', pos: [0, 0.445, -0.095], rot: [-0.5, 0, 0] });
      b.add(new RoundedBoxGeometry(0.2, 0.09, 0.04, 2, 0.015), { mat: m, pos: [0, 0.02, 0.12] });
      for (const s of [-1, 1]) b.add(new CylinderGeometry(0.004, 0.004, 0.13, 4), { color: PAL.offWhite, pos: [s * 0.03, 0.36, 0.12] });
    }
    if (id === 'swim_shirt') {
      // contrasting side panels
      for (const s of [-1, 1]) b.add(new BoxGeometry(0.012, 0.42, 0.07), { mat: trim, pos: [s * 0.155, 0.12, 0], rot: [0, 0, s * -0.04] });
    }
    this.attach('top', P.spine, b);
    // sleeves
    if (id !== 'tank') {
      for (const [arm, fore] of [[P.armL, P.foreL], [P.armR, P.foreR]] as const) {
        const sb = new ModelBuilder();
        sb.add(ellipsoid(0.07, 0.064, 0.066, 10, 8), { mat: m, pos: [0, -0.008, 0] });
        const len = id === 'tee' ? 0.13 : UPPER_ARM + 0.02;
        sb.add(tube(0.02, -len, 0.058, id === 'tee' ? 0.056 : 0.046), { mat: m });
        this.attach('top', arm, sb);
        if (id === 'swim_shirt' || id === 'hoodie') {
          const fb = new ModelBuilder().add(tube(0.02, -FOREARM + 0.01, 0.045, 0.038), { mat: m });
          fb.add(new TorusGeometry(0.036, 0.008, 5, 12), { mat: id === 'swim_shirt' ? trim : m, pos: [0, -FOREARM + 0.01, 0], rot: [Math.PI / 2, 0, 0] });
          this.attach('top', fore, fb);
        }
      }
    }
  }

  private buildBottom(id: string): void {
    const m = this.mats.bottom;
    const P = this.p;
    const white = toon({ color: PAL.offWhite });
    if (id === 'skirt') {
      const b = new ModelBuilder();
      const prof: Array<[number, number]> = [[0.215, -0.3], [0.19, -0.18], [0.158, -0.02], [0.142, 0.1]];
      const g = lathe(prof, 20);
      // soft pleats
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const y = pos.getY(i);
        const a = Math.atan2(z, x);
        const k = 1 + 0.05 * Math.sin(a * 10) * Math.min(1, (0.05 - y) / 0.3);
        pos.setXYZ(i, x * k, y, z * k * 0.85);
      }
      g.computeVertexNormals();
      b.add(g, { mat: m });
      this.mats.bottom.side = DoubleSide;
      this.attach('bottom', P.hips, b);
      return;
    }
    this.mats.bottom.side = FrontSide;
    const b = new ModelBuilder();
    b.add(lathe([[0.162, -0.11], [0.163, -0.02], [0.148, 0.05], [0.136, 0.1]], 18), { mat: m, scale: [1, 1, 0.76] });
    b.add(new TorusGeometry(0.138, 0.01, 5, 20), { mat: id === 'trunks' ? white : m, pos: [0, 0.095, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 0.76, 1] });
    if (id === 'shorts' || id === 'trunks') for (const s of [-1, 1]) b.add(new CylinderGeometry(0.004, 0.004, 0.08, 4), { color: PAL.offWhite, pos: [s * 0.02, 0.07, 0.12] });
    this.attach('bottom', P.hips, b);
    for (const [th, sh, s] of [[P.thighL, P.shinL, 1], [P.thighR, P.shinR, -1]] as const) {
      const lb = new ModelBuilder();
      const len = id === 'trunks' ? 0.15 : id === 'shorts' ? 0.24 : THIGH + 0.02;
      lb.add(tube(0.04, -len, 0.088, id === 'trousers' ? 0.068 : 0.08), { mat: m });
      if (id === 'trunks') lb.add(new BoxGeometry(0.008, len, 0.03), { mat: white, pos: [s * 0.083, -len / 2 + 0.02, 0] });
      this.attach('bottom', th, lb);
      if (id === 'trousers') {
        const sb = new ModelBuilder().add(tube(0.03, -SHIN + 0.04, 0.066, 0.058), { mat: m });
        this.attach('bottom', sh, sb);
      }
    }
  }

  private buildShoes(id: string): void {
    const P = this.p;
    for (const foot of [P.footL, P.footR]) {
      const b = new ModelBuilder();
      if (id === 'sneakers') {
        b.add(ellipsoid(0.052, 0.045, 0.118, 12, 8), { mat: this.mats.shoes, pos: [0, -0.035, 0.045] });
        b.add(new RoundedBoxGeometry(0.1, 0.03, 0.235, 2, 0.012), { color: PAL.offWhite, pos: [0, -0.068, 0.045] });
        b.add(new BoxGeometry(0.04, 0.006, 0.07), { color: PAL.offWhite, pos: [0, -0.0, 0.08], rot: [0.5, 0, 0] });
        b.add(tube(0.03, -0.03, 0.042, 0.046), { mat: this.mats.shoes });
      } else {
        b.add(ellipsoid(0.044, 0.034, 0.108, 10, 8), { mat: this.mats.skin, pos: [0, -0.04, 0.045] });
        if (id === 'sandals') {
          const sole: Array<[number, number]> = [];
          for (let i = 0; i < 14; i++) {
            const a = (i / 14) * Math.PI * 2;
            sole.push([Math.cos(a) * 0.05, Math.sin(a) * 0.125]);
          }
          b.add(slab(sole, 0.018), { mat: this.mats.shoes, pos: [0, -0.078, 0.045] });
          b.add(new TorusGeometry(0.044, 0.008, 4, 14, Math.PI), { mat: this.mats.shoes, pos: [0, -0.06, 0.07], rot: [0, 0, 0], scale: [1.05, 0.9, 1] });
          b.add(new TorusGeometry(0.04, 0.007, 4, 14, Math.PI), { mat: this.mats.shoes, pos: [0, -0.06, -0.015], rot: [0, 0, 0] });
        }
      }
      this.attach('shoes', foot, b);
    }
  }

  private buildHat(id: string): void {
    if (id === 'none') return;
    const m = this.mats.hat;
    const b = new ModelBuilder();
    if (id === 'sun_hat') {
      const brim = lathe([[0.225, -0.03], [0.18, -0.008], [0.135, 0.0], [0.13, 0.005]], 28);
      b.add(brim, { mat: m, pos: [0, 0.055, -0.005] });
      b.add(lathe([[0.132, 0.0], [0.13, 0.05], [0.115, 0.1], [0.07, 0.125], [0.001, 0.13]], 22), { mat: m, pos: [0, 0.055, -0.005] });
      b.add(tube(0.03, 0.0, 0.133, 0.135, 22), { color: PAL.coral, pos: [0, 0.058, -0.005] });
      this.attach('hat', this.p.head, b);
      return;
    }
    // cap: dome + bill + button + back strap opening
    b.add(lathe([[0.122, 0.0], [0.122, 0.035], [0.105, 0.085], [0.06, 0.118], [0.001, 0.125]], 22), { mat: m, pos: [0, 0.03, -0.004], scale: [0.98, 1, 1.03] });
    b.add(ellipsoid(0.095, 0.008, 0.08, 14, 4), { mat: m, pos: [0, 0.035, 0.145], rot: [0.12, 0, 0] });
    b.add(new SphereGeometry(0.012, 6, 5), { mat: m, pos: [0, 0.157, -0.004] });
    b.add(ellipsoid(0.028, 0.018, 0.01, 8, 6), { color: '#3A3F4A', pos: [0, 0.05, -0.122] });
    this.attach('hat', this.p.head, b);
  }

  private buildAccessory(id: string): void {
    const m = this.mats.accessory;
    if (id === 'sunglasses') {
      const b = new ModelBuilder();
      for (const s of [-1, 1]) {
        b.add(ellipsoid(0.03, 0.022, 0.008, 12, 8), { mat: m, pos: [s * 0.039, -0.01, 0.112], rot: [0, s * 0.3, 0] });
        b.add(new BoxGeometry(0.006, 0.006, 0.12), { mat: m, pos: [s * 0.098, -0.002, 0.045], rot: [0, s * 0.08, 0] });
      }
      b.add(new BoxGeometry(0.02, 0.005, 0.005), { mat: m, pos: [0, -0.002, 0.118] });
      this.attach('accessory', this.p.head, b);
    } else if (id === 'scarf') {
      const b = new ModelBuilder();
      b.add(new TorusGeometry(0.068, 0.03, 8, 18), { mat: m, pos: [0, 0.46, 0.0], rot: [Math.PI / 2 - 0.1, 0, 0], scale: [1.1, 0.9, 1] });
      const tail = (x: number, len: number) => [new Vector3(x, 0.45, -0.09), new Vector3(x + 0.01, 0.38, -0.13), new Vector3(x + 0.02, 0.45 - len, -0.14)];
      b.add(sweep(tail(0.03, 0.3), [0.032, 0.008], 6, 10), { mat: m, sway: (v) => Math.min(1, Math.max(0, (0.45 - v.y) / 0.3)) });
      b.add(sweep(tail(-0.02, 0.22), [0.03, 0.008], 6, 10), { mat: m, sway: (v) => Math.min(1, Math.max(0, (0.45 - v.y) / 0.3)) });
      this.attach('accessory', this.p.spine, b);
    } else if (id === 'backpack') {
      const b = new ModelBuilder();
      b.add(new RoundedBoxGeometry(0.27, 0.33, 0.13, 3, 0.04), { mat: m, pos: [0, 0.22, -0.17] });
      b.add(new RoundedBoxGeometry(0.27, 0.12, 0.14, 3, 0.04), { mat: m, pos: [0, 0.36, -0.17], rot: [0.12, 0, 0] });
      b.add(new RoundedBoxGeometry(0.17, 0.12, 0.05, 2, 0.02), { mat: m, pos: [0, 0.14, -0.245] });
      b.add(new BoxGeometry(0.06, 0.012, 0.012), { color: PAL.offWhite, pos: [0, 0.2, -0.272] });
      for (const s of [-1, 1]) {
        b.add(sweep([new Vector3(s * 0.08, 0.3, -0.11), new Vector3(s * 0.09, 0.44, -0.03), new Vector3(s * 0.1, 0.36, 0.1), new Vector3(s * 0.1, 0.12, 0.115)], [0.02, 0.006], 5, 12), { color: '#2A2F38' });
      }
      this.attach('accessory', this.p.spine, b);
    }
  }

  /** Apply a config: style changes rebuild their slot, colour changes only touch uniforms. */
  setConfig(cfg: AvatarConfig): void {
    const prev = this.cfg;
    const c = (m: ShaderMaterial, hex: string) => (m.uniforms.uColor.value as Color).set(hex);
    c(this.mats.skin, cfg.skin);
    c(this.mats.hair, cfg.hairColor);
    c(this.mats.top, cfg.topColor);
    c(this.mats.bottom, cfg.bottomColor);
    c(this.mats.shoes, cfg.shoesColor);
    c(this.mats.hat, cfg.hatColor);
    c(this.mats.accessory, cfg.accessoryColor);
    if (!prev || prev.hairStyle !== cfg.hairStyle || prev.hatId !== cfg.hatId) {
      this.clearSlot('hair');
      // a hat flattens the hair under it: rebuild with a slightly tighter puff by using the same style
      this.buildHairSlot(cfg.hairStyle);
    }
    if (!prev || prev.topId !== cfg.topId) {
      this.clearSlot('top');
      this.buildTop(cfg.topId);
    }
    if (!prev || prev.bottomId !== cfg.bottomId) {
      this.clearSlot('bottom');
      this.buildBottom(cfg.bottomId);
    }
    if (!prev || prev.shoesId !== cfg.shoesId) {
      this.clearSlot('shoes');
      this.buildShoes(cfg.shoesId);
    }
    if (!prev || prev.hatId !== cfg.hatId) {
      this.clearSlot('hat');
      this.buildHat(cfg.hatId);
    }
    if (!prev || prev.accessoryId !== cfg.accessoryId) {
      this.clearSlot('accessory');
      this.buildAccessory(cfg.accessoryId);
    }
    this.cfg = { ...cfg };
    this.root.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
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


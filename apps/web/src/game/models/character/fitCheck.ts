import { Matrix4, Vector3, type Mesh, type SkinnedMesh } from 'three';
import { AVATAR_SLOTS, DEFAULT_AVATAR, rng } from '@speakersgarage/shared';
import type { AvatarConfig, Slot } from '../../../types';
import { Character, type CharacterMotion } from './Character';
import { hatFit, insideHat } from './hats';
import { SEGMENTS, depthInside, restOrigin, segBottom, segTop, type SegName } from './rig';

/**
 * Automated poke-through test (pnpm test:fit). Builds avatar combinations and checks, in the rest pose
 * and in animation poses:
 *  - inside-body: no garment vertex lies inside the body segment it sits on (closer to the segment axis
 *    than the body surface),
 *  - posed-inside: in walk/run/sit/wave/dance poses, the legs never come through a skirt,
 *  - hair-in-hat / glasses-in-hat: no hair or glasses vertex inside a hat's volume,
 *  - joint-gap: cloth at the joints (shoulder, elbow, hip, knee, ankle) stays within 0.02 of the body,
 *  - z-fight: no coplanar overlapping triangles between different parts (cloth, body, hat, accessories).
 */

export type CheckName = 'inside-body' | 'posed-inside' | 'hair-in-hat' | 'glasses-in-hat' | 'joint-gap' | 'z-fight';

export interface FitFailure {
  check: CheckName;
  /** the item(s) at fault, e.g. "top:hoodie" or "hair:long + hat:sun_hat" */
  item: string;
  detail: string;
  /** how bad: depth/gap in metres, or the number of offending vertices/triangles */
  value: number;
  combo: string;
  /** where (segment/head/model space, metres) */
  at?: string;
}
const fmt = (v: { x: number; y: number; z: number }) => `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;

const TOL = 0.0005;
const MAX_JOINT_GAP = 0.02;

/* ---------------------------------------------------------------- combinations ------------------------- */

const ITEM_SLOTS: Slot[] = ['hair', 'hat', 'top', 'bottom', 'shoes', 'accessory'];
const FIELD: Record<Slot, keyof AvatarConfig> = { hair: 'hairStyle', hat: 'hatId', top: 'topId', bottom: 'bottomId', shoes: 'shoesId', accessory: 'accessoryId' };
const PAIRS: Array<[Slot, Slot]> = [
  ['hair', 'hat'],
  ['top', 'bottom'],
  ['top', 'accessory'],
  ['hat', 'accessory'],
  ['bottom', 'shoes'],
  ['hair', 'top'],
  ['hair', 'accessory'],
];

export const comboKey = (c: AvatarConfig) => ITEM_SLOTS.map((s) => `${s}:${c[FIELD[s]]}`).join(' ');

/** Size of the full product of item options (one body shape exists). */
export const fullProduct = () => ITEM_SLOTS.reduce((n, s) => n * AVATAR_SLOTS[s].length, 1);

/**
 * At least `n` combinations: first a greedy set that covers every option pair in PAIRS, then seeded
 * random ones (no duplicates). If the full product is small enough, all of it.
 */
export function makeCombos(n: number, seed = 1): AvatarConfig[] & { pairCover?: number } {
  const ids = (s: Slot) => AVATAR_SLOTS[s].map((o) => o.id);
  if (fullProduct() <= n) {
    let out: AvatarConfig[] = [{ ...DEFAULT_AVATAR }];
    for (const s of ITEM_SLOTS) out = out.flatMap((c) => ids(s).map((id) => ({ ...c, [FIELD[s]]: id })));
    return out;
  }
  const r = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const random = (): AvatarConfig => {
    const c = { ...DEFAULT_AVATAR };
    for (const s of ITEM_SLOTS) (c[FIELD[s]] as string) = pick(ids(s));
    return c;
  };
  const need = new Set<string>();
  for (const [a, b] of PAIRS) for (const x of ids(a)) for (const y of ids(b)) need.add(`${a}:${x}|${b}:${y}`);
  const covers = (c: AvatarConfig) => PAIRS.map(([a, b]) => `${a}:${c[FIELD[a]]}|${b}:${c[FIELD[b]]}`).filter((k) => need.has(k));
  const out: AvatarConfig[] = [];
  const seen = new Set<string>();
  while (need.size) {
    let best = random();
    let bestN = -1;
    for (let k = 0; k < 60; k++) {
      const c = random();
      const m = covers(c).length;
      if (m > bestN && !seen.has(comboKey(c))) {
        best = c;
        bestN = m;
      }
    }
    for (const k of covers(best)) need.delete(k);
    seen.add(comboKey(best));
    out.push(best);
  }
  (out as AvatarConfig[] & { pairCover?: number }).pairCover = out.length;
  while (out.length < n) {
    const c = random();
    if (seen.has(comboKey(c))) continue;
    seen.add(comboKey(c));
    out.push(c);
  }
  return out;
}

/* ---------------------------------------------------------------- helpers ------------------------------- */

/** Model-space (rest) positions of a mesh's vertices. Skinned meshes are already in model space. */
function restPositions(m: Mesh, headOrigin: Vector3): Vector3[] {
  const p = m.geometry.attributes.position;
  const out: Vector3[] = [];
  const rigid = !(m as SkinnedMesh).isSkinnedMesh;
  for (let i = 0; i < p.count; i++) {
    const v = new Vector3().fromBufferAttribute(p, i);
    if (rigid) v.add(headOrigin);
    out.push(v);
  }
  return out;
}

/** For each triangle, the part tag it came from (builder bookkeeping). */
function triTags(m: Mesh): string[] {
  const parts = (m.userData.parts ?? []) as Array<{ tag: string; tris: number }>;
  const out: string[] = [];
  parts.forEach((p, i) => {
    for (let k = 0; k < p.tris; k++) out.push(`${p.tag}#${i}`);
  });
  return out;
}

const POSES: Array<{ name: string; motion: CharacterMotion; frames: number }> = [
  { name: 'walk', motion: { speed: 3.4, running: false, wade: 0, turnRate: 0, localVel: new Vector3(0, 0, 3.4) }, frames: 50 },
  { name: 'run', motion: { speed: 6.4, running: true, wade: 0, turnRate: 0, localVel: new Vector3(0, 0, 6.4) }, frames: 50 },
  { name: 'sit', motion: { speed: 0, running: false, wade: 0, turnRate: 0, localVel: new Vector3(), emote: 3 }, frames: 90 },
  { name: 'wave', motion: { speed: 0, running: false, wade: 0, turnRate: 0, localVel: new Vector3(), emote: 1 }, frames: 90 },
  { name: 'dance', motion: { speed: 0, running: false, wade: 0, turnRate: 0, localVel: new Vector3(), emote: 2 }, frames: 90 },
];

/* ---------------------------------------------------------------- checks -------------------------------- */

export interface CheckOpts {
  /** run the (slower) z-fight check */
  zfight?: boolean;
  /** run the posed checks */
  poses?: boolean;
}

export function checkCombo(cfg: AvatarConfig, opts: CheckOpts = {}): FitFailure[] {
  const fails: FitFailure[] = [];
  const combo = comboKey(cfg);
  const c = new Character(cfg);
  c.root.updateMatrixWorld(true);
  const headO = restOrigin('head');
  const item = (slot: Slot) => `${slot}:${cfg[FIELD[slot]]}`;

  // inside-body + joint-gap: every garment piece against the segment it was built on
  for (const slot of ['top', 'bottom', 'shoes'] as Slot[]) {
    let worstIn = 0;
    let inCount = 0;
    let inSeg = '';
    let inAt = '';
    let worstGap = 0;
    let gapSeg = '';
    for (const m of c.slotMeshes(slot)) {
      const pos = restPositions(m, headO);
      const tags = triTags(m);
      const idx = m.geometry.index!;
      const seen = new Set<number>();
      for (let t = 0; t < idx.count / 3; t++) {
        const tag = tags[t]?.split('#')[0] ?? '';
        const segName = (tag === 'skirt' ? 'pelvis' : tag) as SegName;
        const seg = SEGMENTS[segName];
        if (!seg) continue;
        const o = restOrigin(seg.bone);
        for (let k = 0; k < 3; k++) {
          const vi = idx.getX(t * 3 + k);
          if (seen.has(vi)) continue;
          seen.add(vi);
          const p = pos[vi].clone().sub(o);
          if (tag === 'skirt' && p.y < -0.02) continue; // the flare is checked against the legs in poses
          const d = depthInside(seg, p);
          if (d > TOL) {
            inCount++;
            if (d > worstIn) {
              worstIn = d;
              inSeg = segName;
              inAt = `${tags[t]} ${fmt(p)}`;
            }
          }
          // joint gap: cloth on a ball joint (beyond the tube's end rings)
          if (seg.kind === 'tube' && ((seg.bottom === 'ball' && p.y < segBottom(seg)) || (seg.top === 'ball' && p.y > segTop(seg)))) {
            const gap = -d;
            if (gap > worstGap) {
              worstGap = gap;
              gapSeg = segName;
            }
          }
        }
      }
    }
    if (inCount) fails.push({ check: 'inside-body', item: item(slot), detail: `${inCount} vertices inside ${inSeg} (worst ${(worstIn * 1000).toFixed(1)} mm)`, value: worstIn, combo, at: inAt });
    if (worstGap > MAX_JOINT_GAP) fails.push({ check: 'joint-gap', item: item(slot), detail: `${(worstGap * 1000).toFixed(1)} mm from the body at the ${gapSeg} joint`, value: worstGap, combo });
  }

  // hair and glasses vs the hat volume (head space)
  const fit = hatFit(cfg.hatId);
  if (fit) {
    let n = 0;
    let at = '';
    for (const m of c.slotMeshes('hair')) {
      const p = m.geometry.attributes.position;
      const v = new Vector3();
      for (let i = 0; i < p.count; i++)
        if (insideHat(fit, v.fromBufferAttribute(p, i))) {
          n++;
          at = fmt(v);
        }
    }
    if (n) fails.push({ check: 'hair-in-hat', item: `${item('hair')} + ${item('hat')}`, detail: `${n} hair vertices inside the hat`, value: n, combo, at });
    if (cfg.accessoryId === 'sunglasses') {
      let g = 0;
      for (const m of c.slotMeshes('accessory')) for (const v of restPositions(m, headO)) if (insideHat(fit, v.clone().sub(headO))) g++;
      if (g) fails.push({ check: 'glasses-in-hat', item: `accessory:sunglasses + ${item('hat')}`, detail: `${g} glasses vertices inside the hat`, value: g, combo });
    }
  }

  if (opts.zfight !== false) fails.push(...zfight(c, cfg, combo));

  // posed: the legs must stay inside a skirt
  if (opts.poses !== false && cfg.bottomId === 'skirt') {
    for (const pose of POSES) {
      for (let f = 0; f < pose.frames; f++) c.update(1 / 60, pose.motion);
      c.root.updateMatrixWorld(true);
      let n = 0;
      let worst = 0;
      let at = '';
      const inv = { L: new Matrix4().copy(c.bone('thighL').matrixWorld).invert(), R: new Matrix4().copy(c.bone('thighR').matrixWorld).invert() };
      for (const m of c.slotMeshes('bottom') as SkinnedMesh[]) {
        const tags = triTags(m);
        const idx = m.geometry.index!;
        const p = m.geometry.attributes.position;
        const seen = new Set<number>();
        for (let t = 0; t < idx.count / 3; t++) {
          if (!tags[t]?.startsWith('skirt')) continue;
          for (let k = 0; k < 3; k++) {
            const vi = idx.getX(t * 3 + k);
            if (seen.has(vi)) continue;
            seen.add(vi);
            const v = new Vector3().fromBufferAttribute(p, vi);
            m.applyBoneTransform(vi, v);
            for (const s of ['L', 'R'] as const) {
              const d = depthInside(SEGMENTS[`thigh${s}`], v.clone().applyMatrix4(inv[s]));
              if (d > 0.002) {
                n++;
                if (d > worst) at = `${s} rest ${fmt(new Vector3().fromBufferAttribute(p, vi))}`;
                worst = Math.max(worst, d);
              }
            }
          }
        }
      }
      if (n) fails.push({ check: 'posed-inside', item: item('bottom'), detail: `${pose.name}: ${n} skirt vertices inside a thigh (worst ${(worst * 1000).toFixed(1)} mm)`, value: worst, combo, at });
    }
  }

  c.dispose();
  return fails;
}

/** Positions of a mesh's vertices in the current pose (model space; the root sits at the origin). */
function posedPositions(m: Mesh): Float32Array {
  const p = m.geometry.attributes.position;
  const out = new Float32Array(p.count * 3);
  const v = new Vector3();
  const skinned = (m as SkinnedMesh).isSkinnedMesh;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    if (skinned) (m as SkinnedMesh).applyBoneTransform(i, v);
    else v.applyMatrix4(m.matrixWorld);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  return out;
}

/**
 * Coplanar overlapping triangles between different parts, in the idle pose (hair clumps among themselves
 * are skipped: they are one material and layered on purpose).
 */
function zfight(c: Character, cfg: AvatarConfig, combo: string): FitFailure[] {
  for (let f = 0; f < 30; f++) c.update(1 / 60, { speed: 0, running: false, wade: 0, turnRate: 0, localVel: new Vector3() });
  c.root.updateMatrixWorld(true);
  const partNames: string[] = [];
  const partSlot: string[] = [];
  const cx: number[] = [];
  const nx: number[] = [];
  const vx: number[] = [];
  const part: number[] = [];
  const hair: number[] = [];
  /** skin triangles of the body: two overlapping ones render identically (same material, colour, normal) */
  const bodySkin: number[] = [];
  /** depth-bias layer of the triangle's material (Character DEPTH_LAYER) */
  const layer: number[] = [];
  for (const slot of ['body', 'top', 'bottom', 'shoes', 'hat', 'hair', 'accessory']) {
    for (const m of c.slotMeshes(slot)) {
      const pos = posedPositions(m);
      const tags = triTags(m);
      const idx = m.geometry.index!;
      const ids = new Map<string, number>();
      for (let t = 0; t < idx.count / 3; t++) {
        const a = idx.getX(t * 3) * 3;
        const b = idx.getX(t * 3 + 1) * 3;
        const d = idx.getX(t * 3 + 2) * 3;
        const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
        const e2x = pos[d] - pos[a], e2y = pos[d + 1] - pos[a + 1], e2z = pos[d + 2] - pos[a + 2];
        let n0 = e1y * e2z - e1z * e2y, n1 = e1z * e2x - e1x * e2z, n2 = e1x * e2y - e1y * e2x;
        const len = Math.hypot(n0, n1, n2);
        if (len < 1e-9) continue;
        n0 /= len;
        n1 /= len;
        n2 /= len;
        const tag = `${slot}:${(tags[t] ?? '').split('#')[0]}`;
        const key = `${m.uuid}/${tags[t] ?? ''}`;
        let pid = ids.get(key);
        if (pid === undefined) {
          pid = partNames.length;
          partNames.push(tag);
          partSlot.push(slot);
          ids.set(key, pid);
        }
        part.push(pid);
        hair.push(slot === 'hair' ? 1 : 0);
        bodySkin.push(slot === 'body' && m.material === c.skinMaterial ? 1 : 0);
        layer.push(c.depthLayer(m.material));
        cx.push((pos[a] + pos[b] + pos[d]) / 3, (pos[a + 1] + pos[b + 1] + pos[d + 1]) / 3, (pos[a + 2] + pos[b + 2] + pos[d + 2]) / 3);
        nx.push(n0, n1, n2);
        vx.push(pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2], pos[d], pos[d + 1], pos[d + 2]);
      }
    }
  }
  const T = part.length;
  const cell = 0.01;
  const K = (x: number, y: number, z: number) => ((x + 600) * 1200 + (y + 600)) * 1200 + (z + 600);
  const grid = new Map<number, number[]>();
  const cellOf = new Int32Array(T * 3);
  for (let i = 0; i < T; i++) {
    const x = Math.floor(cx[i * 3] / cell), y = Math.floor(cx[i * 3 + 1] / cell), z = Math.floor(cx[i * 3 + 2] / cell);
    cellOf[i * 3] = x;
    cellOf[i * 3 + 1] = y;
    cellOf[i * 3 + 2] = z;
    const k = K(x, y, z);
    const l = grid.get(k);
    if (l) l.push(i);
    else grid.set(k, [i]);
  }
  // point (px,py,pz) inside triangle j (barycentric, in its plane)
  const inTri = (px: number, py: number, pz: number, j: number) => {
    const o = j * 9;
    const ax = vx[o], ay = vx[o + 1], az = vx[o + 2];
    const v0x = vx[o + 6] - ax, v0y = vx[o + 7] - ay, v0z = vx[o + 8] - az;
    const v1x = vx[o + 3] - ax, v1y = vx[o + 4] - ay, v1z = vx[o + 5] - az;
    const v2x = px - ax, v2y = py - ay, v2z = pz - az;
    const d00 = v0x * v0x + v0y * v0y + v0z * v0z;
    const d01 = v0x * v1x + v0y * v1y + v0z * v1z;
    const d02 = v0x * v2x + v0y * v2y + v0z * v2z;
    const d11 = v1x * v1x + v1y * v1y + v1z * v1z;
    const d12 = v1x * v2x + v1y * v2y + v1z * v2z;
    const den = d00 * d11 - d01 * d01;
    if (Math.abs(den) < 1e-14) return false;
    const u = (d11 * d02 - d01 * d12) / den;
    const w = (d00 * d12 - d01 * d02) / den;
    return u > 0.02 && w > 0.02 && u + w < 0.98;
  };
  const counts = new Map<string, number>();
  const where = new Map<string, string>();
  for (let i = 0; i < T; i++) {
    const x = cellOf[i * 3], y = cellOf[i * 3 + 1], z = cellOf[i * 3 + 2];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const l = grid.get(K(x + dx, y + dy, z + dz));
          if (!l) continue;
          for (const j of l) {
            if (j <= i || part[i] === part[j] || (hair[i] && hair[j])) continue;
            // skin on skin (two body parts, same material and colour): no visible flicker
            if (bodySkin[i] && bodySkin[j]) continue;
            // different depth layers: the polygon offset decides, no flicker
            if (layer[i] !== layer[j]) continue;
            const dot = nx[i * 3] * nx[j * 3] + nx[i * 3 + 1] * nx[j * 3 + 1] + nx[i * 3 + 2] * nx[j * 3 + 2];
            if (Math.abs(dot) < 0.995) continue;
            // coplanar: every vertex of B within 1 mm of A's plane (surfaces that merely cross are not z-fighting)
            let far = false;
            for (let k = 0; k < 3 && !far; k++) {
              const o = j * 9 + k * 3;
              const dist = (vx[o] - cx[i * 3]) * nx[i * 3] + (vx[o + 1] - cx[i * 3 + 1]) * nx[i * 3 + 1] + (vx[o + 2] - cx[i * 3 + 2]) * nx[i * 3 + 2];
              far = Math.abs(dist) > 0.001;
            }
            if (far) continue;
            if (!inTri(cx[j * 3], cx[j * 3 + 1], cx[j * 3 + 2], i) && !inTri(cx[i * 3], cx[i * 3 + 1], cx[i * 3 + 2], j)) continue;
            const name = [partNames[part[i]], partNames[part[j]]].sort().join(' vs ');
            counts.set(name, (counts.get(name) ?? 0) + 1);
            const tri = (q: number) => [0, 1, 2].map((k) => `(${[0, 1, 2].map((e) => vx[q * 9 + k * 3 + e].toFixed(4)).join(',')})`).join(' ');
            where.set(name, `(${cx[i * 3].toFixed(3)}, ${cx[i * 3 + 1].toFixed(3)}, ${cx[i * 3 + 2].toFixed(3)}) n=(${nx[i * 3].toFixed(2)}, ${nx[i * 3 + 1].toFixed(2)}, ${nx[i * 3 + 2].toFixed(2)})` + (process.env.FIT_DEBUG ? `\n      A ${partNames[part[i]]} ${tri(i)}\n      B ${partNames[part[j]]} ${tri(j)}` : ''));
          }
        }
  }
  const slotItem = (s: string) => (s === 'body' ? 'body' : s in FIELD ? `${s}:${cfg[FIELD[s as Slot]]}` : s);
  return [...counts].map(([name, n]) => {
    const slots = [...new Set(name.split(' vs ').map((p) => p.split(':')[0]))];
    return { check: 'z-fight' as const, item: slots.map(slotItem).join(' + '), detail: `${n} coplanar triangle pairs (${name})`, value: n, combo, at: where.get(name) };
  });
}

/* ---------------------------------------------------------------- report -------------------------------- */

export interface FitReport {
  combos: number;
  /** combinations that also got the z-fight check */
  zfightCombos: number;
  ms: number;
  failures: FitFailure[];
}

export function runFitCheck(n: number, opts: CheckOpts & { seed?: number; onProgress?: (i: number, total: number) => void } = {}): FitReport {
  const t0 = performance.now();
  const list = makeCombos(n, opts.seed ?? 1);
  const failures: FitFailure[] = [];
  // z-fighting happens between items that touch, so the pair-covering combinations (plus every 5th
  // other one) are enough for it; everything else runs on every combination
  const cover = list.pairCover ?? list.length;
  let z = 0;
  list.forEach((cfg, i) => {
    const zf = opts.zfight !== false && (i < cover || i % 5 === 0);
    if (zf) z++;
    failures.push(...checkCombo(cfg, { ...opts, zfight: zf }));
    opts.onProgress?.(i + 1, list.length);
  });
  return { combos: list.length, zfightCombos: z, ms: performance.now() - t0, failures };
}

/** Failures grouped by item and check: count, worst value, one example combination. */
export function groupFailures(f: FitFailure[]): Array<{ item: string; check: CheckName; count: number; worst: number; example: FitFailure }> {
  const m = new Map<string, { item: string; check: CheckName; count: number; worst: number; example: FitFailure }>();
  for (const x of f) {
    const k = `${x.item}|${x.check}`;
    const g = m.get(k) ?? { item: x.item, check: x.check, count: 0, worst: 0, example: x };
    g.count++;
    if (x.value > g.worst) {
      g.worst = x.value;
      g.example = x;
    }
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => a.item.localeCompare(b.item) || a.check.localeCompare(b.check));
}

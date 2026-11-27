/**
 * Generates src/game/maps/vinland.json — a Tiled-format map, 240 x 180 tiles of 64 world px
 * (15360 x 11520 px). Run after `npm run assets`; re-run with `npm run map`.
 *
 * Layout: a mountain ring with three trail gaps, a big lake in the west fed by a waterfall, a river
 * winding south-east, the farmstead in the middle, pine forest north-east, meadow south-west,
 * vineyard hillside east, and a forest glade in the south. Lake, river and roads all run at 20-35
 * degrees so the composition reads diagonally rather than axis-aligned.
 *
 * Layers: ground | collision | objects (y-sorted) | overlay (canopies) | blockers | interactions |
 *         spawns (animals) | spawn (player)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rng } from './art/util.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tiles = JSON.parse(fs.readFileSync(path.join(root, 'public/assets/tiles.json'), 'utf8')) as {
  tileSize: number; margin: number; spacing: number; columns: number; imageWidth: number; imageHeight: number;
  tiles: Array<{ id: number; key: string; kind: string }>; keyToId: Record<string, number>;
  blobs: Record<string, Record<string, number>>;
};
interface CatSprite { w: number; h: number; ox: number; oy: number; layer: string; sway: string; atlas: string; collide: { x: number; y: number; w: number; h: number } | null; crown: { key: string; dx: number; dy: number } | null; coverRadius: number | null }
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'public/assets/catalog.json'), 'utf8')) as {
  sprites: Record<string, CatSprite>;
  animals: Array<{ key: string; frameW: number; frameH: number }>;
};

const W = 240;
const H = 180;
const TS = tiles.tileSize; // 64
const R = rng(0x5eed17);
const gid = (k: string): number => {
  const v = tiles.keyToId[k];
  if (v === undefined) throw new Error('unknown tile ' + k);
  return v + 1;
};
const blobGid = (fam: string, sig: number): number => {
  const id = tiles.blobs[fam]?.[String(sig)];
  if (id === undefined) throw new Error(`no blob ${fam}_${sig}`);
  return id + 1;
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** Smooth value noise, so variant choices form patches instead of per-tile speckle. */
function patchNoise(x: number, y: number, freq: number): number {
  const h = (a: number, b: number) => {
    let n = (a * 374761393 + b * 668265263) >>> 0;
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const fx = x * freq;
  const fy = y * freq;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = h(x0, y0), b = h(x0 + 1, y0), c = h(x0, y0 + 1), d = h(x0 + 1, y0 + 1);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

const hash2 = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/* ------------------------------------------------------------------ geometry ------------- */

const rot = (x: number, y: number, cx: number, cy: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  return [dx * Math.cos(a) + dy * Math.sin(a), -dx * Math.sin(a) + dy * Math.cos(a)];
};

/** fractal wobble so nothing is a clean geometric primitive */
const wob = (t: number, amp: number, seed: number) =>
  amp * (Math.sin(t * 0.21 + seed) + 0.5 * Math.sin(t * 0.47 + seed * 2.3) + 0.25 * Math.sin(t * 0.93 + seed * 3.7));

// --- mountain ring -------------------------------------------------------
const GAPS = {
  north: [152, 170] as [number, number],
  east: [84, 102] as [number, number],
  south: [118, 136] as [number, number],
};
/** depth of the mountain band at a point on the border */
function ringDepth(side: 'n' | 'e' | 's' | 'w', t: number): number {
  const base = side === 'n' ? 14 : side === 's' ? 12 : 11;
  return base + wob(t, 4.5, side.charCodeAt(0));
}
function inMountain(x: number, y: number): boolean {
  const n = ringDepth('n', x) - (x >= GAPS.north[0] && x <= GAPS.north[1] ? 40 : 0);
  const s = ringDepth('s', x) - (x >= GAPS.south[0] && x <= GAPS.south[1] ? 40 : 0);
  const w = ringDepth('w', y);
  const e = ringDepth('e', y) - (y >= GAPS.east[0] && y <= GAPS.east[1] ? 40 : 0);
  return y < n || y > H - 1 - s || x < w || x > W - 1 - e;
}
/** snow sits on the high northern band only */
function inSnow(x: number, y: number): boolean {
  if (!inMountain(x, y)) return false;
  return y < ringDepth('n', x) * 0.62 || (x < 10 && y < 46);
}

// --- lake ----------------------------------------------------------------
const LAKE = { cx: 56, cy: 68, rx: 36, ry: 25, deg: 25 };
function lakeField(x: number, y: number): number {
  const [u, v] = rot(x + 0.5, y + 0.5, LAKE.cx, LAKE.cy, LAKE.deg);
  const r = Math.hypot(u / LAKE.rx, v / LAKE.ry);
  // ragged shoreline
  const ang = Math.atan2(v / LAKE.ry, u / LAKE.rx);
  return r - (0.07 * Math.sin(ang * 3 + 1.2) + 0.05 * Math.sin(ang * 5 - 0.4) + 0.035 * Math.sin(ang * 8 + 2.1));
}

// --- river ---------------------------------------------------------------
/** polyline from the lake's south-east shore to the southern gap, running at roughly 30 degrees */
const RIVER: Array<[number, number]> = [
  [74, 84], [86, 96], [96, 110], [104, 124], [112, 138], [120, 152], [127, 166], [130, 180],
];
function distToPolyline(x: number, y: number, pts: Array<[number, number]>): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1);
    best = Math.min(best, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
  }
  return best;
}
const riverWidth = (y: number) => 3.4 + wob(y, 0.9, 5) + y * 0.004;

// --- roads ---------------------------------------------------------------
const ROADS: Array<Array<[number, number]>> = [
  // dock -> farmstead -> east gap
  [[80, 70], [94, 78], [108, 86], [122, 90], [140, 94], [160, 96], [184, 94], [206, 93]],
  // farmstead -> south gap through the glade
  [[120, 96], [124, 112], [126, 128], [124, 144], [127, 158], [127, 172]],
  // farmstead -> north pine forest -> north gap
  [[124, 88], [136, 76], [148, 62], [156, 48], [160, 34], [161, 20]],
  // field track
  [[134, 96], [148, 104], [164, 108]],
];

// --- regions -------------------------------------------------------------
const inRect = (x: number, y: number, a: number, b: number, c: number, d: number) => x >= a && x <= c && y >= b && y <= d;
/**
 * Soft-edged region test. The rectangle's boundary is pushed in and out by a couple of harmonics and
 * then feathered, so a meadow or a vineyard blends into the grass instead of ending on a straight line.
 */
function inSoftRect(x: number, y: number, r: { x0: number; y0: number; x1: number; y1: number }, seed = 0): boolean {
  const cx = (r.x0 + r.x1) / 2;
  const cy = (r.y0 + r.y1) / 2;
  const hx = (r.x1 - r.x0) / 2;
  const hy = (r.y1 - r.y0) / 2;
  const u = (x - cx) / hx;
  const v = (y - cy) / hy;
  // squircle distance keeps the shape broadly rectangular but rounds the corners
  const d = Math.pow(Math.abs(u), 3) + Math.pow(Math.abs(v), 3);
  const ang = Math.atan2(v, u);
  const edge = 1 + 0.22 * Math.sin(ang * 3 + seed) + 0.14 * Math.sin(ang * 5 - seed * 1.7) + 0.09 * Math.sin(ang * 8 + seed * 2.3);
  if (d > edge) return false;
  // feather the inner band so the fill thins out towards the boundary
  const t = 1 - d / edge;
  return t > 0.12 || patchNoise(x * 1.7, y * 1.7, 0.5) < t * 7;
}
const FIELDS = [
  { x0: 136, y0: 74, x1: 164, y1: 92, crop: 'crop_wheat' },
  { x0: 140, y0: 98, x1: 172, y1: 116, crop: 'crop_barley' },
  { x0: 100, y0: 70, x1: 116, y1: 82, crop: 'soil' },
];
const MEADOW = { x0: 24, y0: 104, x1: 86, y1: 150 };
const VINEYARD = { x0: 176, y0: 110, x1: 214, y1: 142 };
const PINE_FOREST = { x0: 146, y0: 26, x1: 212, y1: 74 };
const SOUTH_FOREST = { x0: 30, y0: 138, x1: 114, y1: 170 };
const GLADE = { cx: 124, cy: 150, r: 11 };

/* ------------------------------------------------------------------ materials ------------ */

const enum M { Grass, TallGrass, Flower, Dirt, Mud, Soil, CropW, CropB, Rock, Snow, Gravel, Path, Road, Shallow, Mid, Deep }

const mat: Uint8Array = new Uint8Array(W * H);
const at = (x: number, y: number): M => mat[clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1)] as M;
const isWater = (x: number, y: number) => {
  const m = at(x, y);
  return m === M.Shallow || m === M.Mid || m === M.Deep;
};
const isDeepish = (x: number, y: number) => {
  const m = at(x, y);
  return m === M.Mid || m === M.Deep;
};
const isDeep = (x: number, y: number) => at(x, y) === M.Deep;
const isRockish = (x: number, y: number) => at(x, y) === M.Rock || at(x, y) === M.Snow;
const isSnow = (x: number, y: number) => at(x, y) === M.Snow;
const isRoadish = (x: number, y: number) => {
  const m = at(x, y);
  return m === M.Road || m === M.Dirt || m === M.Path || m === M.Mud;
};

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let m: M = M.Grass;
    const lf = lakeField(x, y);
    const riv = distToPolyline(x + 0.5, y + 0.5, RIVER) - riverWidth(y);
    const inLake = lf < 1;
    const inRiver = riv < 0;
    if (inMountain(x, y)) {
      m = inSnow(x, y) ? M.Snow : M.Rock;
    } else if (inLake || inRiver) {
      // depth from how far inside the water body we are
      const d = inLake ? (1 - lf) * Math.min(LAKE.rx, LAKE.ry) : -riv;
      m = d > 9 ? M.Deep : d > 4 ? M.Mid : M.Shallow;
    } else {
      const field = FIELDS.find((f) => inRect(x, y, f.x0, f.y0, f.x1, f.y1));
      const margin = FIELDS.find((f) => inRect(x, y, f.x0 - 2, f.y0 - 2, f.x1 + 2, f.y1 + 2));
      if (field) m = field.crop === 'crop_wheat' ? M.CropW : field.crop === 'crop_barley' ? M.CropB : M.Soil;
      else if (margin) m = M.Dirt; // headland round the crop, which the dirt-edge blob then blends
      else if (inSoftRect(x, y, MEADOW, 1.3)) m = patchNoise(x, y, 0.14) > 0.58 ? M.Flower : M.TallGrass;
      else if (inSoftRect(x, y, VINEYARD, 2.7)) m = patchNoise(x, y, 0.16) > 0.62 ? M.Grass : M.TallGrass;
    }
    mat[y * W + x] = m;
  }
}
// roads last, so they cut across everything except water and mountains
for (const road of ROADS) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (isWater(x, y) || inMountain(x, y)) continue;
      const d = distToPolyline(x + 0.5, y + 0.5, road);
      if (d < 1.9 + wob(x + y, 0.35, 9)) mat[y * W + x] = M.Road;
    }
  }
}
// stone path around the longhouse yard
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (isWater(x, y)) continue;
    const d = Math.hypot(x - 118, y - 92);
    if (d < 9 && d > 5.5 && at(x, y) !== M.Road) mat[y * W + x] = M.Path;
  }
}
// muddy trampled ring near the well and the farmyard
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (isWater(x, y) || isRockish(x, y)) continue;
    if (Math.hypot(x - 118, y - 92) < 5.5) mat[y * W + x] = M.Dirt;
  }
}

/* ------------------------------------------------------------------ tiles ---------------- */

function blobSig(x: number, y: number, pred: (a: number, b: number) => boolean): number {
  const n = pred(x, y - 1), e = pred(x + 1, y), s = pred(x, y + 1), w = pred(x - 1, y);
  const ne = pred(x + 1, y - 1), se = pred(x + 1, y + 1), sw = pred(x - 1, y + 1), nw = pred(x - 1, y - 1);
  let sig = (n ? 1 : 0) | (e ? 2 : 0) | (s ? 4 : 0) | (w ? 8 : 0);
  if (ne && !n && !e) sig |= 16;
  if (se && !s && !e) sig |= 32;
  if (sw && !s && !w) sig |= 64;
  if (nw && !n && !w) sig |= 128;
  return sig;
}

const ground = new Array<number>(W * H).fill(0);
const collision = new Array<number>(W * H).fill(0);

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const m = at(x, y);
    const v3 = Math.floor(hash2(x, y) * 3);
    let g: number;
    if (m === M.Deep) {
      g = gid(`water_deep_${v3}`);
    } else if (m === M.Mid) {
      const sig = blobSig(x, y, isDeep);
      g = sig ? blobGid('depth2', sig) : gid(`water_mid_${v3}`);
    } else if (m === M.Shallow) {
      const sig = blobSig(x, y, isDeepish);
      g = sig ? blobGid('depth1', sig) : gid(`water_shallow_${v3}`);
    } else {
      // land: water edge wins, then rock/snow, then road
      const wsig = blobSig(x, y, isWater);
      if (wsig) g = blobGid('shore', wsig);
      else if (m === M.Snow) {
        // Solid snow; the rock side of the boundary paints the transition. `snow_rock` is chosen by
        // smooth noise so it forms patches — picking it per tile by hash checkerboarded the ridges.
        g = gid(patchNoise(x, y, 0.09) > 0.62 ? 'snow_rock' : 'snow');
      } else if (m === M.Rock) {
        const ssig = blobSig(x, y, isSnow);
        if (ssig) g = blobGid('snowedge', ssig);
        else g = gid(patchNoise(x, y, 0.11) > 0.68 ? 'gravel' : 'rocky');
      } else if (m === M.Road || m === M.Dirt) {
        g = gid(m === M.Dirt ? 'dirt' : 'road');
      } else if (m === M.Path) {
        g = gid('stone_path');
      } else if (m === M.Mud) {
        g = gid('mud');
      } else if (m === M.Soil) {
        g = gid('soil');
      } else if (m === M.CropW) {
        g = gid('crop_wheat');
      } else if (m === M.CropB) {
        g = gid('crop_barley');
      } else if (m === M.TallGrass) {
        g = gid('grass_tall');
      } else if (m === M.Flower) {
        g = gid('grass_flower');
      } else {
        // plain grass, with transitions painted where rock or road intrudes
        const rockSig = blobSig(x, y, isRockish);
        const roadSig = blobSig(x, y, isRoadish);
        if (rockSig) g = blobGid('rockedge', rockSig);
        else if (roadSig) g = blobGid('dirtedge', roadSig);
        else g = gid(`grass_${Math.floor(hash2(x, y) * 4)}`);
      }
    }
    ground[y * W + x] = g;
    // blocked: deep water and the mountain ring
    if (m === M.Mid || m === M.Deep || inMountain(x, y)) collision[y * W + x] = 1;
  }
}

/* ------------------------------------------------------------------ objects -------------- */

interface Obj { id: number; name: string; type: string; x: number; y: number; width: number; height: number; rotation: number; visible: boolean; point?: boolean; properties?: Array<{ name: string; type: string; value: string | number | boolean }> }
let nextId = 1;
const objects: Obj[] = [];
const overlay: Obj[] = [];
const blockers: Obj[] = [];
const occupied: Array<{ x: number; y: number; r: number }> = [];

const px = (t: number) => Math.round(t * TS);
const free = (x: number, y: number, r: number) => occupied.every((o) => Math.hypot(o.x - x, o.y - y) >= o.r + r);
const walkable = (x: number, y: number) => {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 1 || ty < 1 || tx >= W - 1 || ty >= H - 1) return false;
  if (collision[ty * W + tx]) return false;
  return !isWater(tx, ty);
};
const onRoad = (x: number, y: number, pad = 1.5) => {
  for (let dy = -pad; dy <= pad; dy += 1) for (let dx = -pad; dx <= pad; dx += 1) {
    if (isRoadish(Math.floor(x + dx), Math.floor(y + dy))) return true;
  }
  return false;
};

function place(key: string, x: number, y: number, o: { r?: number; flip?: boolean; props?: Obj['properties'] } = {}): void {
  const c = catalog.sprites[key];
  if (!c) throw new Error('unknown sprite ' + key);
  const obj: Obj = { id: nextId++, name: key, type: key, x: px(x), y: px(y), width: c.w, height: c.h, rotation: 0, visible: true };
  const props = [...(o.props ?? [])];
  if (o.flip) props.push({ name: 'flipX', type: 'bool', value: true });
  if (props.length) obj.properties = props;
  objects.push(obj);
  if (o.r) occupied.push({ x, y, r: o.r });
  if (c.collide) {
    const cl = c.collide;
    const fx = o.flip ? -(cl.x + cl.w) : cl.x;
    blockers.push({ id: nextId++, name: key + '_b', type: 'blocker', x: Math.round(px(x) + fx), y: Math.round(px(y) + cl.y), width: Math.round(cl.w), height: Math.round(cl.h), rotation: 0, visible: true });
  }
  if (c.crown) {
    const cr = catalog.sprites[c.crown.key];
    overlay.push({
      id: nextId++, name: c.crown.key, type: c.crown.key,
      x: Math.round(px(x) + (o.flip ? -c.crown.dx : c.crown.dx)), y: Math.round(px(y) + c.crown.dy),
      width: cr.w, height: cr.h, rotation: 0, visible: true,
      properties: [{ name: 'coverRadius', type: 'float', value: c.coverRadius ?? 160 }, ...(o.flip ? [{ name: 'flipX' as const, type: 'bool' as const, value: true }] : [])],
    });
  }
}
const tryPlace = (key: string, x: number, y: number, r: number, flip = false, ok: (a: number, b: number) => boolean = walkable): boolean => {
  if (!ok(x, y) || !free(x, y, r)) return false;
  place(key, x, y, { r, flip });
  return true;
};

// --- mountains: ridge sprites along the inner edge of the ring -----------
{
  const ridges = ['ridge_snow', 'ridge_snow_tall', 'ridge_pine', 'ridge_rock', 'ridge_low'];
  const step = 5;
  // Three staggered rows per side: the band is deep, and one row along the inner edge leaves the
  // rest reading as flat grey ground rather than mountains.
  for (let row = 0; row < 3; row++) {
    const back = row * 4.5;
    for (let x = 2 - row * 2; x < W - 2; x += step) {
      if (x >= GAPS.north[0] - 3 && x <= GAPS.north[1] + 3) continue;
      const key = row === 0 ? (R() > 0.5 ? 'ridge_snow' : 'ridge_rock') : x < 60 || x > 180 ? 'ridge_snow_tall' : 'ridge_snow';
      place(key, x + R() * 2, ringDepth('n', x) - 1 - back + R() * 2, { flip: R() > 0.5 });
    }
    for (let x = 4 - row * 2; x < W - 2; x += step) {
      if (x >= GAPS.south[0] - 3 && x <= GAPS.south[1] + 3) continue;
      place(row === 0 ? (R() > 0.5 ? 'ridge_pine' : 'ridge_low') : 'ridge_rock', x + R() * 2, H - ringDepth('s', x) + 2 + back * 0.6 + R() * 2, { flip: R() > 0.5 });
    }
    for (let y = 6 - row * 2; y < H - 4; y += step) {
      place(row === 0 ? (R() > 0.6 ? 'ridge_rock' : 'ridge_pine') : 'ridge_rock', ringDepth('w', y) - 3 - back + R() * 2, y, { flip: R() > 0.5 });
      if (y >= GAPS.east[0] - 3 && y <= GAPS.east[1] + 3) continue;
      place(row === 0 ? (R() > 0.6 ? 'ridge_rock' : 'ridge_low') : 'ridge_rock', W - ringDepth('e', y) + 3 + back + R() * 2, y, { flip: R() > 0.5 });
    }
  }
  void ridges;
}
// waterfall feeding the lake from the north mountains
place('waterfall', 48, 32);
for (let i = 0; i < 3; i++) place(`mist_${i}`, 40 + i * 26, 30 + i * 6);

// --- farmstead -----------------------------------------------------------
place('longhouse', 116, 86, { r: 8 });
place('barn', 142, 84, { r: 6 });
place('storehouse', 104, 96, { r: 4 });
place('smokehouse', 130, 100, { r: 3.5 });
place('well', 118, 95, { r: 2.5 });
place('cart', 109, 90, { r: 2.5 });
place('chopping_block', 126, 94, { r: 2 });
place('drying_rack', 112, 100, { r: 3 });
for (const [x, y] of [[107, 93], [108.6, 94], [131, 96], [132.4, 97.2]] as Array<[number, number]>) place(R() > 0.5 ? 'barrel' : 'barrel_tipped', x, y, { r: 1 });
place('haystack', 148, 92, { r: 3 });
place('hay_small', 151, 94, { r: 2 });
place('haystack', 138, 112, { r: 3 });

// fences round the two big fields, with a gate on the road side
for (const f of FIELDS.slice(0, 2)) {
  for (let x = f.x0; x <= f.x1; x += 2) {
    if (!onRoad(x, f.y0 - 1, 1)) tryPlace('fence_h', x + 1, f.y0 - 1, 0.8);
    if (!onRoad(x, f.y1 + 1, 1)) tryPlace('fence_h', x + 1, f.y1 + 1, 0.8);
  }
  for (let y = f.y0; y <= f.y1; y += 1.5) {
    if (!onRoad(f.x0 - 1, y, 1)) tryPlace('fence_v', f.x0 - 1, y + 0.75, 0.6);
    if (!onRoad(f.x1 + 1, y, 1)) tryPlace('fence_v', f.x1 + 1, y + 0.75, 0.6);
  }
}
place('fence_gate', 137, 93.2, { r: 1 });

// --- lake: dock, boat, reeds -------------------------------------------
place('jetty', 78, 69);
place('jetty', 76, 69);
place('jetty', 74, 69);
place('rowboat', 71, 72, { props: [{ name: 'water', type: 'bool', value: true }] });
{
  let n = 0;
  for (let i = 0; i < 2600 && n < 150; i++) {
    const x = 16 + R() * 80;
    const y = 36 + R() * 76;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (at(tx, ty) !== M.Shallow) continue;
    // reeds on the water side, cattails and lily pads too
    const k = R();
    const key = k > 0.72 ? 'lily_pads' : k > 0.4 ? 'reeds' : 'cattails';
    if (tryPlace(key, x, y, 0.8, R() > 0.5, () => true)) n++;
  }
}
// river reeds
for (let i = 0; i < 600; i++) {
  const t = R();
  const seg = Math.min(RIVER.length - 2, Math.floor(t * (RIVER.length - 1)));
  const f = t * (RIVER.length - 1) - seg;
  const x = RIVER[seg][0] + (RIVER[seg + 1][0] - RIVER[seg][0]) * f + (R() - 0.5) * 11;
  const y = RIVER[seg][1] + (RIVER[seg + 1][1] - RIVER[seg][1]) * f + (R() - 0.5) * 5;
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (at(tx, ty) !== M.Shallow) continue;
  tryPlace(R() > 0.5 ? 'reeds' : 'cattails', x, y, 0.9, R() > 0.5, () => true);
}

// --- forests -------------------------------------------------------------
function forest(area: { x0: number; y0: number; x1: number; y1: number }, count: number, kinds: string[], minGap: number) {
  let n = 0;
  for (let i = 0; i < count * 40 && n < count; i++) {
    const x = area.x0 + R() * (area.x1 - area.x0);
    const y = area.y0 + R() * (area.y1 - area.y0);
    if (onRoad(x, y, 2.2)) continue;
    if (tryPlace(kinds[Math.floor(R() * kinds.length)], x, y, minGap, R() > 0.5)) n++;
  }
  return n;
}
forest(PINE_FOREST, 190, ['pine_trunk', 'pine_trunk', 'spruce_trunk', 'spruce_trunk', 'birch1_trunk', 'birch2_trunk'], 2.6);
forest(SOUTH_FOREST, 150, ['pine_trunk', 'spruce_trunk', 'birch1_trunk', 'birch2_trunk', 'oak1_trunk'], 2.8);
// scattered broadleaves through the valley
forest({ x0: 24, y0: 96, x1: 112, y1: 160 }, 46, ['oak1_trunk', 'oak2_trunk', 'birch1_trunk', 'birch2_trunk'], 4.5);
forest({ x0: 96, y0: 60, x1: 180, y1: 130 }, 26, ['oak1_trunk', 'oak2_trunk', 'birch1_trunk'], 5.5);
// dead trees and stumps at the forest edges
for (let i = 0; i < 26; i++) {
  const x = 30 + R() * 180;
  const y = 30 + R() * 140;
  tryPlace(R() > 0.5 ? 'dead_tree' : R() > 0.5 ? 'stump' : 'fallen_log', x, y, 2.4, R() > 0.5);
}

// --- glade: campfire, standing stone, logs -------------------------------
place('standing_stone', GLADE.cx - 5, GLADE.cy - 4, { r: 3 });
place('campfire', GLADE.cx, GLADE.cy, { r: 2.6 });
place('flame_0', GLADE.cx, GLADE.cy, { props: [{ name: 'anim', type: 'string', value: 'flame' }] });
for (const [dx, dy] of [[-3.2, 1.2], [3.2, 1.0], [0, 2.6]] as Array<[number, number]>) place('fallen_log', GLADE.cx + dx, GLADE.cy + dy, { r: 1.4 });

// --- vineyard ------------------------------------------------------------
for (let row = 0; row < 7; row++) {
  for (let i = 0; i < 9; i++) {
    // rows run diagonally across the hillside
    const x = VINEYARD.x0 + 3 + i * 3.6 + row * 1.5;
    const y = VINEYARD.y0 + 4 + row * 4.2 - i * 0.9;
    tryPlace('grapevine', x, y, 1.6);
  }
}

// --- notice post and props near the spawn --------------------------------
place('notice_post', 108, 84, { r: 1.5 });

// --- scatter: bushes, ferns, rocks, flowers, mushrooms -------------------
function scatter(key: string[], count: number, pick: (x: number, y: number) => boolean, gap: number) {
  let n = 0;
  for (let i = 0; i < count * 30 && n < count; i++) {
    const x = 6 + R() * (W - 12);
    const y = 6 + R() * (H - 12);
    if (!pick(x, y)) continue;
    if (onRoad(x, y, 1)) continue;
    if (tryPlace(key[Math.floor(R() * key.length)], x, y, gap, R() > 0.5)) n++;
  }
  return n;
}
const isMeadow = (x: number, y: number) => inRect(x, y, MEADOW.x0, MEADOW.y0, MEADOW.x1, MEADOW.y1);
const isForest = (x: number, y: number) =>
  inRect(x, y, PINE_FOREST.x0, PINE_FOREST.y0, PINE_FOREST.x1, PINE_FOREST.y1) ||
  inRect(x, y, SOUTH_FOREST.x0, SOUTH_FOREST.y0, SOUTH_FOREST.x1, SOUTH_FOREST.y1);
scatter(['bush_a', 'bush_b', 'bush_c'], 180, () => true, 2.2);
scatter(['fern_a', 'fern_b'], 160, isForest, 1.6);
scatter(['mushroom_red', 'mushroom_tan'], 70, isForest, 1.2);
scatter(['flowers_white', 'flowers_yellow', 'flowers_pink', 'flowers_blue'], 220, isMeadow, 1.1);
scatter(['flowers_white', 'flowers_yellow'], 90, () => true, 1.4);
scatter(['tuft_a', 'tuft_b'], 320, () => true, 1.0);
scatter(['rock_s', 'rock_m'], 120, () => true, 2.0);
scatter(['rock_l', 'boulder'], 34, (x, y) => !isMeadow(x, y), 3.4);
// extra rocks hugging the mountain feet
for (let i = 0; i < 160; i++) {
  const x = 4 + R() * (W - 8);
  const y = 4 + R() * (H - 8);
  if (!inMountain(x + 2, y + 2) && !inMountain(x - 2, y - 2)) continue;
  tryPlace(R() > 0.6 ? 'boulder' : R() > 0.5 ? 'rock_l' : 'rock_m', x, y, 2.4, R() > 0.5);
}

/* ------------------------------------------------------------------ interactions --------- */

const prop = (name: string, type: string, value: string | number | boolean) => ({ name, type, value });
const interactions = [
  { name: 'notice', x: 108, y: 85.5, r: 3.0, kind: 'bubble', title: 'Welcome to Vinland', text: 'Welcome to Vinland. Walk with WASD or click to move, hold Shift to run. Press E at a ✦ to look closer.', icon: 'sign' },
  { name: 'longhouse', x: 116, y: 88, r: 4.5, kind: 'modal', title: 'The Longhouse', text: 'Smoke curls from the roof hole and there is a smell of barley stew. The hall is warm, and the benches are being laid out for the evening meal.', icon: 'house' },
  { name: 'well', x: 118, y: 96.5, r: 3.0, kind: 'bubble', title: 'The Well', text: 'The water is cold and clean. A wooden bucket knocks against the stone.', icon: 'well' },
  { name: 'jetty', x: 76, y: 70.5, r: 3.4, kind: 'bubble', title: 'The Jetty', text: 'The lake is still today. Good water for fishing, and a boat ready if you want it.', icon: 'boat' },
  { name: 'standing_stone', x: 119, y: 147, r: 3.4, kind: 'modal', title: 'The Standing Stone', text: 'Runes are cut deep into the grey stone, worn soft by weather. Nobody living remembers who raised it, or for whom.', icon: 'stone' },
  { name: 'campfire', x: 124, y: 152.5, r: 3.6, kind: 'modal', title: 'The Glade Fire', text: 'The fire has been kept alive. Someone will come back for it. Sit a while — this is where people will gather once there are others here.', icon: 'fire' },
  { name: 'vineyard', x: 190, y: 124, r: 4.0, kind: 'bubble', title: 'The Vines', text: 'Wild grapes, heavy on the trellis. This is the land they named for them.', icon: 'grape' },
  { name: 'waterfall', x: 48, y: 36, r: 5.0, kind: 'bubble', title: 'The Falls', text: 'Meltwater off the northern ridge, loud and cold. The spray reaches you from here.', icon: 'water' },
];
const interactionObjs: Obj[] = interactions.map((it) => ({
  id: nextId++, name: it.name, type: 'interaction', x: px(it.x), y: px(it.y), width: 0, height: 0, rotation: 0, visible: true, point: true,
  properties: [
    prop('kind', 'string', it.kind), prop('title', 'string', it.title), prop('text', 'string', it.text),
    prop('radius', 'float', it.r * TS), prop('icon', 'string', it.icon),
    prop('action', 'string', JSON.stringify({ type: it.kind === 'modal' ? 'modal' : 'message' })),
  ],
}));

/* ------------------------------------------------------------------ animal spawns -------- */

const animalSpawns: Obj[] = [];
const addAnimals = (key: string, n: number, cx: number, cy: number, roam: number) => {
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2;
    const d = R() * roam;
    animalSpawns.push({
      id: nextId++, name: key, type: key,
      x: px(cx + Math.cos(a) * d), y: px(cy + Math.sin(a) * d),
      width: 0, height: 0, rotation: 0, visible: true, point: true,
      properties: [prop('roam', 'float', roam * TS), prop('homeX', 'float', px(cx)), prop('homeY', 'float', px(cy))],
    });
  }
};
addAnimals('cow', 5, 152, 120, 9);
addAnimals('sheep', 8, 100, 108, 10);
addAnimals('chicken', 7, 120, 92, 5);
addAnimals('dog', 1, 117, 91, 14);

/* ------------------------------------------------------------------ write ---------------- */

const tilelayer = (id: number, name: string, data: number[]) => ({ id, name, type: 'tilelayer', x: 0, y: 0, width: W, height: H, opacity: 1, visible: true, data });
const objlayer = (id: number, name: string, objs: unknown[]) => ({ id, name, type: 'objectgroup', draworder: 'topdown', x: 0, y: 0, opacity: 1, visible: true, objects: objs });
const tileProps = tiles.tiles.map((t) => ({ id: t.id, properties: [{ name: 'kind', type: 'string', value: t.kind }] }));

/**
 * Pick a spawn that a player-sized box actually fits in. The farmyard is dense with props, and a
 * hand-picked tile can easily end up inside a fence or a barrel's collision rect — which reads in
 * game as the player being unable to move.
 */
function findSpawn(wantX: number, wantY: number): { x: number; y: number } {
  const HALF = 17 / TS; // player half-width and height in tiles, from GAME_CONFIG.player
  const HGT = 18 / TS;
  const boxClear = (cx: number, cy: number): boolean => {
    const x0 = px(cx - HALF) - 6;
    const x1 = px(cx + HALF) + 6;
    const y0 = px(cy - HGT) - 6;
    const y1 = px(cy) + 6;
    for (let ty = Math.floor(y0 / TS); ty <= Math.floor(y1 / TS); ty++) {
      for (let tx = Math.floor(x0 / TS); tx <= Math.floor(x1 / TS); tx++) {
        if (tx < 0 || ty < 0 || tx >= W || ty >= H) return false;
        if (collision[ty * W + tx]) return false;
        if (isWater(tx, ty)) return false;
      }
    }
    return !blockers.some((b) => x1 > b.x && x0 < b.x + b.width && y1 > b.y && y0 < b.y + b.height);
  };
  for (let r = 0; r < 60; r++) {
    for (let a = 0; a < Math.max(1, r * 8); a++) {
      const ang = (a / Math.max(1, r * 8)) * Math.PI * 2;
      const cx = wantX + Math.cos(ang) * r * 0.5;
      const cy = wantY + Math.sin(ang) * r * 0.5;
      if (boxClear(cx, cy)) return { x: px(cx), y: px(cy) };
    }
  }
  return { x: px(wantX), y: px(wantY) };
}
const spawnPos = findSpawn(110, 88);
const spawn = { id: nextId++, name: 'spawn', type: 'spawn', x: spawnPos.x, y: spawnPos.y, width: 0, height: 0, rotation: 0, visible: true, point: true };
const map = {
  compressionlevel: -1, type: 'map', version: '1.10', tiledversion: '1.10.2', orientation: 'orthogonal', renderorder: 'right-down',
  width: W, height: H, tilewidth: TS, tileheight: TS, infinite: false, nextlayerid: 12, nextobjectid: nextId,
  properties: [
    prop('assetScale', 'int', 2),
    prop('note', 'string', 'Generated by scripts/gen-vinland.ts. Authored at 2x texture px (64px tiles = 32 logical).'),
  ],
  tilesets: [
    {
      firstgid: 1, name: 'terrain', image: 'terrain.png',
      imagewidth: tiles.imageWidth, imageheight: tiles.imageHeight,
      tilewidth: TS, tileheight: TS, margin: tiles.margin, spacing: tiles.spacing,
      columns: tiles.columns, tilecount: tiles.tiles.length, tiles: tileProps,
    },
  ],
  layers: [
    tilelayer(1, 'ground', ground),
    tilelayer(2, 'collision', collision),
    objlayer(3, 'objects', objects),
    objlayer(4, 'overlay', overlay),
    objlayer(5, 'blockers', blockers),
    objlayer(6, 'interactions', interactionObjs),
    objlayer(7, 'animals', animalSpawns),
    objlayer(8, 'spawn', [spawn]),
  ],
};
const outFile = path.join(root, 'src/game/maps/vinland.json');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(map));
const kb = (fs.statSync(outFile).size / 1024).toFixed(0);
console.log(
  `spawn: ${(spawnPos.x / TS).toFixed(1)}, ${(spawnPos.y / TS).toFixed(1)} tiles`,
);
console.log(
  `map: ${W}x${H} tiles (${W * TS}x${H * TS}px), ${objects.length} props, ${overlay.length} canopies, ` +
    `${blockers.length} blockers, ${interactions.length} interactions, ${animalSpawns.length} animals -> ${path.relative(root, outFile)} (${kb} KB)`,
);

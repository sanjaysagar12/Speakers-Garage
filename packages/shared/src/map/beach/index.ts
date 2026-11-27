import beachJson from './beach.json';
import { buildField, sampleField, shoreFrame, type Field, type ShoreFrame } from './field';
import { PROP_META, type Params } from '../props';
import { rng } from '../../util/rng';
import { smoothstep, vnoise } from '../../util/noise';
import { DEG } from '../../config';
import type { Deck, MapData, PropPlacement, TerrainKind } from '../types';
import { deckAtIn, pointInDeck } from '../deck';
import { hexToRgb } from '../../util/color';
import { boardwalkParams, pierLayout } from '../pier';
import type { InteractionAction, InteractionDef } from '../../types';

type SD = [number, number];
interface RawPlacement {
  type: string;
  at: SD;
  face?: number;
  params?: Params;
  y?: number;
  offsetX?: number;
  float?: boolean;
}
interface RawDeck {
  id: string;
  at: SD;
  face: number;
  w: number;
  len: number;
  y: number;
  centered?: boolean;
  offsetX?: number;
  head?: { w: number; d: number };
}
interface RawScatter {
  type: string;
  band?: [number, number];
  s?: [number, number];
  zone?: 'grass';
  count: number;
}
interface RawInteraction {
  id: string;
  at: SD;
  radius: number;
  kind: 'bubble' | 'modal';
  icon?: string;
  title: string;
  text: string;
  action?: InteractionAction;
}

const RAW = beachJson as unknown as {
  id: string;
  name: string;
  tagline: string;
  size: [number, number];
  domain: [number, number, number, number];
  fieldRes: number;
  shore: { origin: [number, number]; angleDeg: number; offsets: Array<[number, number]> };
  deepFrom: number;
  spawn: { at: SD; face: number };
  zones: { grass: Array<{ at: SD; r: number }>; rock: Array<{ at: SD; r: number }> };
  decks: RawDeck[];
  path: { points: SD[]; spacing: number; branch: SD[] };
  props: RawPlacement[];
  palms: { band: { s: SD; d: SD; count: number }; grove: { s: SD; d: SD; count: number }; explicit: SD[] };
  rim: { cliffSpacing: number; palmSpacing: number };
  scatter: RawScatter[];
  interactions: RawInteraction[];
};

/** Exposed for tools and the ground component. */
export interface BeachData {
  frame: ShoreFrame;
  field: Field;
  domain: [number, number, number, number];
}


/** The beach: shoreline distance field, terrain, decks, every placement and interaction. Deterministic. */
export function createBeachMapData(): MapData & { data: BeachData } {
  const frame = shoreFrame(RAW.shore);
  const P = (at: SD) => frame.point(at[0], at[1]);
  const seaYaw = Math.atan2(frame.N[0], frame.N[1]);
  const [W, H] = RAW.size;

  const zone = (z: { at: SD; r: number }) => {
    const [x, zz] = P(z.at);
    return { x, z: zz, r: z.r };
  };
  const field = buildField(frame, RAW.domain, RAW.fieldRes, { grass: RAW.zones.grass.map(zone), rock: RAW.zones.rock.map(zone) });
  const D = (x: number, z: number) => sampleField(field, field.d, x, z);

  const groundHeight = (x: number, z: number): number => {
    const d = D(x, z);
    if (d <= 0) return 0;
    const dune = (vnoise(x * 0.06, z * 0.06) - 0.5) * 0.6 + (vnoise(x * 0.15 + 7, z * 0.15) - 0.5) * 0.2;
    const rockLift = sampleField(field, field.rock, x, z) * 0.25;
    return 0.16 * smoothstep(0, 10, d) + 0.42 * smoothstep(8, 40, d) + dune * smoothstep(14, 32, d) * 0.45 + rockLift;
  };

  // ---- decks (walkable floors)
  const decks: Deck[] = [];
  for (const dk of RAW.decks) {
    const rot = seaYaw + (dk.face * DEG);
    const [ax, az] = P(dk.at);
    const fx = Math.sin(rot);
    const fz = Math.cos(rot);
    const lx = Math.cos(rot);
    const lz = -Math.sin(rot);
    const off = dk.offsetX ?? 0;
    const bx = ax + lx * off;
    const bz = az + lz * off;
    const onWater = dk.id === 'pier';
    const center = dk.centered ? [bx, bz] : [bx + fx * (dk.len / 2), bz + fz * (dk.len / 2)];
    const baseY = onWater ? 0 : groundHeight(center[0], center[1]);
    decks.push({ x: center[0], z: center[1], w: dk.w, d: dk.len, rot, y: baseY + dk.y });
    if (dk.head) {
      const hz = dk.len - 0.5;
      decks.push({ x: bx + fx * hz, z: bz + fz * hz, w: dk.head.w, d: dk.head.d, rot, y: baseY + dk.y });
    }
  }
  const deckAt = (x: number, z: number): Deck | null => deckAtIn(decks, x, z);

  // ---- placements
  const props: PropPlacement[] = [];
  let seedN = 1;
  const place = (type: string, x: number, z: number, rot: number, params: Params = {}, extra: Partial<PropPlacement> = {}) => {
    props.push({ type, x, z, rot, scale: 1, seed: seedN++ * 7919, params, ...extra });
  };
  for (const p of RAW.props) {
    let [x, z] = P(p.at);
    const rot = seaYaw + ((p.face ?? 0) * DEG);
    if (p.offsetX) {
      x += Math.cos(rot) * p.offsetX;
      z += -Math.sin(rot) * p.offsetX;
    }
    const def = PROP_META[p.type];
    const floats = p.float || def?.floats;
    place(p.type, x, z, rot, p.params ?? {}, { y: p.y ?? (floats ? 0 : undefined) });
    if (floats) props[props.length - 1].params = { ...props[props.length - 1].params, __float: true };
  }

  // piers and boardwalks: the walkable decks come from the same layout that builds their planks
  for (const p of props) {
    if (p.type !== 'pier' && p.type !== 'boardwalk') continue;
    const base = p.y ?? groundHeight(p.x, p.z);
    const fx = Math.sin(p.rot);
    const fz = Math.cos(p.rot);
    const lx = Math.cos(p.rot);
    const lz = -Math.sin(p.rot);
    // the ramp starts at the ground height of the shore end
    if (p.type === 'pier') p.params = { ...p.params, rampFrom: Math.max(0, groundHeight(p.x + fx * 0.2, p.z + fz * 0.2) - base) + 0.02 };
    const lay = pierLayout(p.type === 'boardwalk' ? boardwalkParams(p.params) : p.params);
    for (const r of lay.rects) {
      const cu = (r.u0 + r.u1) / 2;
      const cv = (r.v0 + r.v1) / 2;
      decks.push({
        x: p.x + lx * cu + fx * cv,
        z: p.z + lz * cu + fz * cv,
        w: r.u1 - r.u0,
        d: r.v1 - r.v0,
        rot: p.rot,
        y: base + r.y1,
        ramp: r.rampLen > 0 ? { len: r.rampLen, y0: base + r.y0 } : undefined,
        guard: p.type === 'pier',
        openStart: r.openStart,
      });
    }
  }

  // occupancy for scatter rejection: major props with a footprint radius
  const occ: Array<{ x: number; z: number; r: number }> = props.map((p) => {
    const f = PROP_META[p.type]?.footprint;
    const r = !f || f.kind === 'none' ? 0.6 : f.kind === 'circle' ? f.r + 0.4 : f.kind === 'box' ? Math.hypot(f.w, f.d) / 2 + 0.3 : 3;
    return { x: p.x, z: p.z, r: p.type === 'beachbar' ? 5.5 : p.type === 'lighthouse' ? 4.5 : p.type === 'volleyball' ? 9 : r };
  });
  const free = (x: number, z: number, r: number) => {
    for (const o of occ) if ((o.x - x) ** 2 + (o.z - z) ** 2 < (o.r + r) ** 2) return false;
    for (const dk of decks) if (pointInDeck(dk, x, z, r + 0.3)) return false;
    return true;
  };
  const inDomain = (x: number, z: number, m = 6) =>
    x > RAW.domain[0] + m && z > RAW.domain[1] + m && x < RAW.domain[0] + RAW.domain[2] - m && z < RAW.domain[1] + RAW.domain[3] - m;

  // stone path (instanced slabs)
  const pathLine = (pts: SD[]) => {
    const w = pts.map(P);
    const r = rng(77);
    for (let i = 0; i < w.length - 1; i++) {
      const [ax, az] = w[i];
      const [bx, bz] = w[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / RAW.path.spacing));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const x = ax + (bx - ax) * t + (r() - 0.5) * 0.25;
        const z = az + (bz - az) * t + (r() - 0.5) * 0.25;
        place('stone', x, z, r() * 6);
        occ.push({ x, z, r: 0.5 });
      }
    }
  };
  pathLine(RAW.path.points);
  pathLine(RAW.path.branch);

  // palms: explicit, a band behind the umbrellas and the grove along the land edge
  const palmAt = (x: number, z: number, r: () => number) => {
    if (!free(x, z, 1.6) || !inDomain(x, z)) return false;
    place('palm', x, z, r() * Math.PI * 2, { variant: Math.floor(r() * 3) });
    occ.push({ x, z, r: 1.6 });
    return true;
  };
  {
    const r = rng(1234);
    for (const sd of RAW.palms.explicit) {
      const [x, z] = P(sd);
      palmAt(x, z, r);
    }
    for (const g of [RAW.palms.band, RAW.palms.grove]) {
      let placed = 0;
      for (let tries = 0; tries < g.count * 30 && placed < g.count; tries++) {
        const s = g.s[0] + r() * (g.s[1] - g.s[0]);
        const d = g.d[0] + r() * (g.d[1] - g.d[0]);
        const [x, z] = frame.point(s, d);
        if (palmAt(x, z, r)) placed++;
      }
    }
  }

  // rim: cliffs just outside the land-side map edges, with a belt of palms inside
  {
    const r = rng(999);
    const sp = RAW.rim.cliffSpacing;
    const edges: Array<{ from: [number, number]; to: [number, number]; out: [number, number] }> = [
      { from: [-2, -2], to: [W + 2, -2], out: [0, -1] },
      { from: [-2, -2], to: [-2, H + 2], out: [-1, 0] },
      { from: [-2, H + 2], to: [W + 2, H + 2], out: [0, 1] },
      { from: [W + 2, -2], to: [W + 2, H + 2], out: [1, 0] },
    ];
    for (const e of edges) {
      const len = Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]);
      for (let k = 0; k <= len / sp; k++) {
        const t = (k * sp) / len;
        const x = e.from[0] + (e.to[0] - e.from[0]) * t + e.out[0] * (3 + r() * 2);
        const z = e.from[1] + (e.to[1] - e.from[1]) * t + e.out[1] * (3 + r() * 2);
        if (D(x, z) < 4) continue;
        const rot = Math.atan2(-e.out[0], -e.out[1]) + (r() - 0.5) * 0.5;
        place('cliff', x, z, rot, { w: sp + 1.5, h: 3 + r() * 2.5, d: 4 });
        // a palm or two in front of the cliff, inside the map
        const ix = x - e.out[0] * (5 + r() * 3) + (r() - 0.5) * 3;
        const iz = z - e.out[1] * (5 + r() * 3) + (r() - 0.5) * 3;
        if (D(ix, iz) > 8 && r() > 0.35) palmAt(ix, iz, r);
      }
    }
  }

  // scatter rules
  {
    const r = rng(4242);
    const grassZones = RAW.zones.grass.map(zone);
    const totalArea = grassZones.reduce((a, g) => a + g.r * g.r, 0);
    for (const rule of RAW.scatter) {
      let placed = 0;
      const def = PROP_META[rule.type];
      const rad = def.footprint.kind === 'circle' ? def.footprint.r : 0.15;
      for (let tries = 0; tries < rule.count * 20 && placed < rule.count; tries++) {
        let x: number;
        let z: number;
        if (rule.zone === 'grass') {
          let pick = r() * totalArea;
          let g = grassZones[0];
          for (const gz of grassZones) {
            pick -= gz.r * gz.r;
            if (pick <= 0) {
              g = gz;
              break;
            }
          }
          const a = r() * Math.PI * 2;
          const rr = Math.sqrt(r()) * g.r;
          x = g.x + Math.cos(a) * rr;
          z = g.z + Math.sin(a) * rr;
          if (sampleField(field, field.grass, x, z) < 0.55) continue;
        } else {
          const [s0, s1] = rule.s ?? [-20, 140];
          const [d0, d1] = rule.band ?? [0, 10];
          [x, z] = frame.point(s0 + r() * (s1 - s0), d0 + r() * (d1 - d0));
        }
        if (!inDomain(x, z) || !free(x, z, rad)) continue;
        place(rule.type, x, z, r() * Math.PI * 2, rule.type === 'bush' ? { flowers: r() > 0.6 } : {});
        if (def.footprint.kind !== 'none') occ.push({ x, z, r: rad + 0.3 });
        placed++;
      }
    }
  }

  // ---- interactions
  const interactions: InteractionDef[] = RAW.interactions.map((i) => {
    const [x, z] = P(i.at);
    return { id: i.id, x, y: z, radius: i.radius, kind: i.kind, title: i.title, text: i.text, icon: i.icon, action: i.action ?? { type: i.kind === 'modal' ? 'modal' : 'message' } };
  });

  const [spx, spz] = P(RAW.spawn.at);
  const deepFrom = RAW.deepFrom;

  const terrainAt = (x: number, z: number): TerrainKind => {
    if (deckAt(x, z)) return 'deck';
    const d = D(x, z);
    if (d < deepFrom) return 'deep';
    if (d < 0.2) return 'shallow';
    if (d < 2.5) return 'wet';
    if (sampleField(field, field.rock, x, z) > 0.5) return 'rock';
    if (sampleField(field, field.grass, x, z) > 0.5) return 'grass';
    return 'sand';
  };

  const hex = hexToRgb;
  const C = {
    sand: hex('#FCD484'),
    wet: hex('#E9B565'),
    shallow: hex('#74DCD4'),
    teal: hex('#04A4B4'),
    deep: hex('#047484'),
    deepest: hex('#144454'),
    grass: hex('#7DBE62'),
    rock: hex('#B8A894'),
    deck: hex('#C98A4B'),
  };

  const map: MapData & { data: BeachData } = {
    id: RAW.id,
    name: RAW.name,
    tagline: RAW.tagline,
    width: W,
    height: H,
    spawn: { x: spx, z: spz, facing: seaYaw + RAW.spawn.face * DEG },
    interactions,
    props,
    decks,
    ambient: { gulls: 7, crabs: 9, drift: 'sand', fire: (() => { const c = props.find((p) => p.type === 'campfire'); return c ? { x: c.x, z: c.z } : undefined; })() },
    background: '#144454',
    groundHeight,
    terrainAt,
    wadeDepth: (x, z) => {
      if (deckAt(x, z)) return 0;
      const d = D(x, z);
      return d >= 0 ? 0 : Math.min(0.55, -d * 0.1);
    },
    shoreDistance: D,
    blockedAt: (x, z) => !deckAt(x, z) && D(x, z) < deepFrom,
    minimapColor: (x, z) => {
      if (deckAt(x, z)) return C.deck;
      const d = D(x, z);
      if (d < 0) return d > -2 ? C.shallow : d > -9 ? C.teal : d > -20 ? C.deep : C.deepest;
      if (d < 2) return C.wet;
      if (sampleField(field, field.rock, x, z) > 0.5) return C.rock;
      if (sampleField(field, field.grass, x, z) > 0.5) return C.grass;
      return C.sand;
    },
    data: { frame, field, domain: RAW.domain },
  };
  return map;
}

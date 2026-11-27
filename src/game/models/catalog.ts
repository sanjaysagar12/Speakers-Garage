import type { Group } from 'three';
import type { ModelBuilder } from './util/builder';
import {
  buildBroadleaf,
  buildBush,
  buildCliff,
  buildConch,
  buildConifer,
  buildDriftwood,
  buildFlower,
  buildGrassTuft,
  buildPalm,
  buildPebble,
  buildRock,
  buildScallop,
  buildStarfish,
} from './nature';
import {
  buildBarStool,
  buildBeachBall,
  buildBuoy,
  buildFlipFlops,
  buildKayak,
  buildLogSeat,
  buildLounger,
  buildMattress,
  buildPoolRing,
  buildRowboat,
  buildSailboat,
  buildSandcastle,
  buildSignpost,
  buildStoneSlab,
  buildSurfboard,
  buildTowel,
  buildUmbrella,
  buildVolleyball,
} from './beachProps';
import { buildBeachBar, buildCampfire, buildHut, buildLifeguardTower, buildLighthouse, buildPier, type PierParams } from './structures';

/** Boardwalks are low piers without rails or a T-head. */
export const boardwalkParams = (p: Record<string, unknown>): PierParams => ({ length: 8, width: 1.8, deckY: 0.12, ...(p as PierParams), head: false, rail: false, posts: 0.3 });
import { PAL } from './palette';

/** Collision footprint in the prop's local frame (rotated with it). */
export type Footprint =
  | { kind: 'none' }
  | { kind: 'circle'; r: number; x?: number; z?: number }
  | { kind: 'box'; w: number; d: number; x?: number; z?: number }
  | { kind: 'multi'; parts: Footprint[] };

export type Params = Record<string, unknown>;

export interface PropDef {
  /** full model; params come from map data, seed makes variants deterministic */
  build?: (params: Params, seed: number) => Group;
  /** instanced props return a single-material builder per variant */
  instanced?: { variants: number; build: (variant: number, params: Params) => ModelBuilder; castShadow?: boolean };
  footprint: Footprint;
  /** the world animates these (bobbing on water, flame, flapping) */
  floats?: boolean;
  label: string;
}

const P = <T,>(p: Params, k: string, d: T): T => (p[k] as T) ?? d;

export const PROPS: Record<string, PropDef> = {
  palm: { label: 'Palm', build: (p, s) => buildPalm({ variant: p.variant as 0 | 1 | 2 | undefined, height: p.height as number | undefined }, s), footprint: { kind: 'circle', r: 0.35 } },
  umbrella: {
    label: 'Umbrella',
    build: (p, s) => buildUmbrella({ style: P(p, 'style', undefined), a: P(p, 'a', undefined), b: P(p, 'b', undefined), tilt: P(p, 'tilt', undefined) }, s),
    footprint: { kind: 'circle', r: 0.15 },
  },
  lounger: { label: 'Lounger', build: (p, s) => buildLounger({ a: P(p, 'a', undefined), b: P(p, 'b', undefined) }, s), footprint: { kind: 'box', w: 2.0, d: 0.7 } },
  towel: { label: 'Towel', build: (p, s) => buildTowel({ a: P(p, 'a', undefined), b: P(p, 'b', undefined) }, s), footprint: { kind: 'none' } },
  ball: { label: 'Beach ball', build: (p, s) => buildBeachBall({ b: P(p, 'b', undefined) }, s), footprint: { kind: 'circle', r: 0.22 } },
  flipflops: { label: 'Flip-flops', build: (p, s) => buildFlipFlops({ color: P(p, 'color', undefined) }, s), footprint: { kind: 'none' } },
  sandcastle: { label: 'Sandcastle', build: (_p, s) => buildSandcastle({}, s), footprint: { kind: 'circle', r: 0.85 } },
  surfboard: { label: 'Surfboard', build: (p, s) => buildSurfboard({ a: P(p, 'a', undefined) }, s), footprint: { kind: 'circle', r: 0.25 } },
  volleyball: { label: 'Volleyball court', build: () => buildVolleyball(), footprint: { kind: 'multi', parts: [{ kind: 'circle', r: 0.12, z: -4.6 }, { kind: 'circle', r: 0.12, z: 4.6 }, { kind: 'box', w: 0.1, d: 9.0 }] } },
  signpost: { label: 'Sign post', build: (p, s) => buildSignpost({ color: P(p, 'color', undefined) }, s), footprint: { kind: 'circle', r: 0.2 } },
  beachbar: {
    label: 'Beach bar',
    build: (_p, s) => buildBeachBar({}, s),
    // the deck itself is walkable (raised floor), only the counter/shelf/posts block
    footprint: {
      kind: 'multi',
      parts: [
        { kind: 'box', w: 4.4, d: 0.6, x: -0.84, z: 1.4 },
        { kind: 'box', w: 0.6, d: 1.9, x: 1.58, z: 0.55 },
        { kind: 'box', w: 5.0, d: 0.5, x: -0.56, z: -2.05 },
        { kind: 'circle', r: 0.15, x: -3.2, z: -2.2 },
        { kind: 'circle', r: 0.15, x: 3.2, z: -2.2 },
        { kind: 'circle', r: 0.15, x: -3.2, z: 2.2 },
        { kind: 'circle', r: 0.15, x: 3.2, z: 2.2 },
      ],
    },
  },
  lifeguard: { label: 'Lifeguard tower', build: () => buildLifeguardTower(), footprint: { kind: 'box', w: 2.0, d: 2.0 } },
  pier: { label: 'Pier', build: (p, s) => buildPier(p as PierParams, s), footprint: { kind: 'none' } },
  boardwalk: { label: 'Boardwalk', build: (p, s) => buildPier(boardwalkParams(p), s), footprint: { kind: 'none' } },
  lighthouse: { label: 'Lighthouse', build: () => buildLighthouse(), footprint: { kind: 'multi', parts: [{ kind: 'circle', r: 2.0 }, { kind: 'box', w: 2.6, d: 2.2, x: -2.6, z: 0.6 }] } },
  campfire: { label: 'Campfire', build: (_p, s) => buildCampfire(s), footprint: { kind: 'circle', r: 0.75 } },
  log: { label: 'Log seat', build: (p, s) => buildLogSeat({ length: P(p, 'length', undefined) }, s), footprint: { kind: 'box', w: 1.8, d: 0.4 } },
  driftwood: { label: 'Driftwood', build: (p, s) => buildDriftwood({ length: P(p, 'length', undefined) }, s), footprint: { kind: 'box', w: 2.0, d: 0.3 } },
  rock: { label: 'Rock', build: (p, s) => buildRock({ size: P(p, 'size', undefined), tone: P(p, 'tone', undefined) }, s), footprint: { kind: 'circle', r: 0.9 } },
  cliff: { label: 'Cliff', build: (p, s) => buildCliff({ w: P(p, 'w', 6), h: P(p, 'h', 4), d: P(p, 'd', 4) }, s), footprint: { kind: 'box', w: 6, d: 3.4 } },
  bush: { label: 'Bush', build: (p, s) => buildBush({ size: P(p, 'size', undefined), flowers: P(p, 'flowers', false) }, s), footprint: { kind: 'circle', r: 0.6 } },
  kayak: { label: 'Kayak', build: (p, s) => buildKayak({ color: P(p, 'color', undefined) }, s), footprint: { kind: 'box', w: 3.2, d: 0.7 }, floats: false },
  rowboat: { label: 'Rowboat', build: (p, s) => buildRowboat({ color: P(p, 'color', undefined) }, s), footprint: { kind: 'box', w: 3.2, d: 1.3 }, floats: true },
  sailboat: { label: 'Sailboat', build: (p, s) => buildSailboat({ color: P(p, 'color', undefined) }, s), footprint: { kind: 'box', w: 4.6, d: 1.6 }, floats: true },
  ring: { label: 'Pool ring', build: (p, s) => buildPoolRing({ b: P(p, 'b', undefined) }, s), footprint: { kind: 'none' }, floats: true },
  mattress: { label: 'Air mattress', build: (p) => buildMattress({ color: P(p, 'color', undefined) }), footprint: { kind: 'none' }, floats: true },
  buoy: { label: 'Buoy', build: (p) => buildBuoy({ color: P(p, 'color', undefined) }), footprint: { kind: 'circle', r: 0.35 }, floats: true },
  hut: { label: 'Hut', build: (p) => buildHut({ w: P(p, 'w', 6), d: P(p, 'd', 4), h: P(p, 'h', 2.2), wall: P(p, 'wall', undefined), roof: P(p, 'roof', undefined) }), footprint: { kind: 'box', w: 6, d: 4 } },
  conifer: { label: 'Conifer', build: (p, s) => buildConifer({ height: P(p, 'height', undefined) }, s), footprint: { kind: 'circle', r: 0.3 } },
  broadleaf: { label: 'Broadleaf tree', build: (p, s) => buildBroadleaf({ height: P(p, 'height', undefined) }, s), footprint: { kind: 'circle', r: 0.3 } },

  /** invisible collision-only placement (footprint comes from the placement) */
  blocker: { label: 'Blocker', footprint: { kind: 'none' } },

  // ---- instanced small things ----
  grass: { label: 'Grass tuft', instanced: { variants: 3, build: (v) => buildGrassTuft(v + 1, 1 + v * 0.25), castShadow: false }, footprint: { kind: 'none' } },
  flower: {
    label: 'Flowers',
    instanced: { variants: 4, build: (v) => buildFlower([PAL.pink, PAL.offWhite, PAL.yellow, PAL.lilac][v], v + 3), castShadow: false },
    footprint: { kind: 'none' },
  },
  starfish: { label: 'Starfish', instanced: { variants: 4, build: (v) => buildStarfish([PAL.orange, PAL.coral, PAL.lilac, PAL.red][v], v + 1), castShadow: true }, footprint: { kind: 'none' } },
  conch: { label: 'Conch shell', instanced: { variants: 2, build: (v) => buildConch(v + 1), castShadow: true }, footprint: { kind: 'none' } },
  scallop: { label: 'Scallop shell', instanced: { variants: 3, build: (v) => buildScallop([PAL.coral, PAL.pink, '#F2C6A0'][v]), castShadow: true }, footprint: { kind: 'none' } },
  pebble: { label: 'Pebble', instanced: { variants: 4, build: (v) => buildPebble(v + 11), castShadow: true }, footprint: { kind: 'none' } },
  stone: { label: 'Path stone', instanced: { variants: 4, build: (v) => buildStoneSlab(v + 21), castShadow: false }, footprint: { kind: 'none' } },
  stool: { label: 'Bar stool', instanced: { variants: 2, build: (v) => buildBarStool(v + 1), castShadow: true }, footprint: { kind: 'circle', r: 0.22 } },
};

export type PropType = keyof typeof PROPS;

/** Placements thinned by the quality setting (small instanced decoration without collision). */
export const DENSITY_SCALED = new Set(['grass', 'flower', 'pebble', 'conch', 'scallop', 'starfish']);

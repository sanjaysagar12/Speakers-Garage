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
import { buildBeachBar, buildCampfire, buildHut, buildLifeguardTower, buildLighthouse, buildPier } from './structures';
import { PROP_META, boardwalkParams, type Params, type PierParams, type PropMeta } from '@speakersgarage/shared';

import { PAL } from './palette';

export type { Footprint, Params } from '@speakersgarage/shared';

/** The 3D side of a prop type. Collision footprint, label and floating come from PROP_META (shared). */
interface PropBuilders {
  /** full model; params come from map data, seed makes variants deterministic */
  build?: (params: Params, seed: number) => Group;
  /** instanced props return a single-material builder per variant */
  instanced?: { variants: number; build: (variant: number, params: Params) => ModelBuilder; castShadow?: boolean };
}
export type PropDef = PropBuilders & PropMeta;

const P = <T,>(p: Params, k: string, d: T): T => (p[k] as T) ?? d;

const BUILDERS: Record<string, PropBuilders> = {
  palm: { build: (p, s) => buildPalm({ variant: p.variant as 0 | 1 | 2 | undefined, height: p.height as number | undefined }, s) },
  umbrella: { build: (p, s) => buildUmbrella({ style: P(p, 'style', undefined), a: P(p, 'a', undefined), b: P(p, 'b', undefined), tilt: P(p, 'tilt', undefined) }, s) },
  lounger: { build: (p, s) => buildLounger({ a: P(p, 'a', undefined), b: P(p, 'b', undefined) }, s) },
  towel: { build: (p, s) => buildTowel({ a: P(p, 'a', undefined), b: P(p, 'b', undefined) }, s) },
  ball: { build: (p, s) => buildBeachBall({ b: P(p, 'b', undefined) }, s) },
  flipflops: { build: (p, s) => buildFlipFlops({ color: P(p, 'color', undefined) }, s) },
  sandcastle: { build: (_p, s) => buildSandcastle({}, s) },
  surfboard: { build: (p, s) => buildSurfboard({ a: P(p, 'a', undefined) }, s) },
  volleyball: { build: () => buildVolleyball() },
  signpost: { build: (p, s) => buildSignpost({ color: P(p, 'color', undefined) }, s) },
  beachbar: { build: (_p, s) => buildBeachBar({}, s) },
  lifeguard: { build: () => buildLifeguardTower() },
  pier: { build: (p, s) => buildPier(p as PierParams, s) },
  boardwalk: { build: (p, s) => buildPier(boardwalkParams(p), s) },
  lighthouse: { build: () => buildLighthouse() },
  campfire: { build: (_p, s) => buildCampfire(s) },
  log: { build: (p, s) => buildLogSeat({ length: P(p, 'length', undefined) }, s) },
  driftwood: { build: (p, s) => buildDriftwood({ length: P(p, 'length', undefined) }, s) },
  rock: { build: (p, s) => buildRock({ size: P(p, 'size', undefined), tone: P(p, 'tone', undefined) }, s) },
  cliff: { build: (p, s) => buildCliff({ w: P(p, 'w', 6), h: P(p, 'h', 4), d: P(p, 'd', 4) }, s) },
  bush: { build: (p, s) => buildBush({ size: P(p, 'size', undefined), flowers: P(p, 'flowers', false) }, s) },
  kayak: { build: (p, s) => buildKayak({ color: P(p, 'color', undefined) }, s) },
  rowboat: { build: (p, s) => buildRowboat({ color: P(p, 'color', undefined) }, s) },
  sailboat: { build: (p, s) => buildSailboat({ color: P(p, 'color', undefined) }, s) },
  ring: { build: (p, s) => buildPoolRing({ b: P(p, 'b', undefined) }, s) },
  mattress: { build: (p) => buildMattress({ color: P(p, 'color', undefined) }) },
  buoy: { build: (p) => buildBuoy({ color: P(p, 'color', undefined) }) },
  hut: { build: (p) => buildHut({ w: P(p, 'w', 6), d: P(p, 'd', 4), h: P(p, 'h', 2.2), wall: P(p, 'wall', undefined), roof: P(p, 'roof', undefined) }) },
  conifer: { build: (p, s) => buildConifer({ height: P(p, 'height', undefined) }, s) },
  broadleaf: { build: (p, s) => buildBroadleaf({ height: P(p, 'height', undefined) }, s) },

  /** invisible collision-only placement (footprint comes from the placement) */
  blocker: {},

  // ---- instanced small things ----
  grass: { instanced: { variants: 3, build: (v) => buildGrassTuft(v + 1, 1 + v * 0.25), castShadow: false } },
  flower: { instanced: { variants: 4, build: (v) => buildFlower([PAL.pink, PAL.offWhite, PAL.yellow, PAL.lilac][v], v + 3), castShadow: false } },
  starfish: { instanced: { variants: 4, build: (v) => buildStarfish([PAL.orange, PAL.coral, PAL.lilac, PAL.red][v], v + 1), castShadow: true } },
  conch: { instanced: { variants: 2, build: (v) => buildConch(v + 1), castShadow: true } },
  scallop: { instanced: { variants: 3, build: (v) => buildScallop([PAL.coral, PAL.pink, '#F2C6A0'][v]), castShadow: true } },
  pebble: { instanced: { variants: 4, build: (v) => buildPebble(v + 11), castShadow: true } },
  stone: { instanced: { variants: 4, build: (v) => buildStoneSlab(v + 21), castShadow: false } },
  stool: { instanced: { variants: 2, build: (v) => buildBarStool(v + 1), castShadow: true } },
};

/** Every prop type: shared metadata (footprint, label, floats) + the client's builders. */
export const PROPS: Record<string, PropDef> = Object.fromEntries(Object.entries(PROP_META).map(([k, meta]) => [k, { ...meta, ...BUILDERS[k] }]));

export type PropType = keyof typeof PROPS;

/** Placements thinned by the quality setting (small instanced decoration without collision). */
export const DENSITY_SCALED = new Set(['grass', 'flower', 'pebble', 'conch', 'scallop', 'starfish']);

/** Collision footprint in the prop's local frame (rotated with it). */
export type Footprint =
  | { kind: 'none' }
  | { kind: 'circle'; r: number; x?: number; z?: number }
  | { kind: 'box'; w: number; d: number; x?: number; z?: number }
  | { kind: 'multi'; parts: Footprint[] };

export type Params = Record<string, unknown>;

/** What the simulation and map builders need to know about a prop type (the client adds the 3D builders). */
export interface PropMeta {
  label: string;
  footprint: Footprint;
  /** bobs on the water (placed at the water surface) */
  floats?: boolean;
}

export const PROP_META: Record<string, PropMeta> = {
  palm: { label: 'Palm', footprint: { kind: 'circle', r: 0.35 } },
  umbrella: { label: 'Umbrella', footprint: { kind: 'circle', r: 0.15 } },
  lounger: { label: 'Lounger', footprint: { kind: 'box', w: 2.0, d: 0.7 } },
  towel: { label: 'Towel', footprint: { kind: 'none' } },
  ball: { label: 'Beach ball', footprint: { kind: 'circle', r: 0.22 } },
  flipflops: { label: 'Flip-flops', footprint: { kind: 'none' } },
  sandcastle: { label: 'Sandcastle', footprint: { kind: 'circle', r: 0.85 } },
  surfboard: { label: 'Surfboard', footprint: { kind: 'circle', r: 0.25 } },
  volleyball: { label: 'Volleyball court', footprint: { kind: 'multi', parts: [{ kind: 'circle', r: 0.12, z: -4.6 }, { kind: 'circle', r: 0.12, z: 4.6 }, { kind: 'box', w: 0.1, d: 9.0 }] } },
  signpost: { label: 'Sign post', footprint: { kind: 'circle', r: 0.2 } },
  // the bar deck itself is walkable (a raised floor): only the counter, shelf and posts block
  beachbar: { label: 'Beach bar', footprint: { kind: 'multi', parts: [ { kind: 'box', w: 4.4, d: 0.6, x: -0.84, z: 1.4 }, { kind: 'box', w: 0.6, d: 1.9, x: 1.58, z: 0.55 }, { kind: 'box', w: 5.0, d: 0.5, x: -0.56, z: -2.05 }, { kind: 'circle', r: 0.15, x: -3.2, z: -2.2 }, { kind: 'circle', r: 0.15, x: 3.2, z: -2.2 }, { kind: 'circle', r: 0.15, x: -3.2, z: 2.2 }, { kind: 'circle', r: 0.15, x: 3.2, z: 2.2 }, ], } },
  lifeguard: { label: 'Lifeguard tower', footprint: { kind: 'box', w: 2.0, d: 2.0 } },
  pier: { label: 'Pier', footprint: { kind: 'none' } },
  boardwalk: { label: 'Boardwalk', footprint: { kind: 'none' } },
  lighthouse: { label: 'Lighthouse', footprint: { kind: 'multi', parts: [{ kind: 'circle', r: 2.0 }, { kind: 'box', w: 2.6, d: 2.2, x: -2.6, z: 0.6 }] } },
  campfire: { label: 'Campfire', footprint: { kind: 'circle', r: 0.75 } },
  log: { label: 'Log seat', footprint: { kind: 'box', w: 1.8, d: 0.4 } },
  driftwood: { label: 'Driftwood', footprint: { kind: 'box', w: 2.0, d: 0.3 } },
  rock: { label: 'Rock', footprint: { kind: 'circle', r: 0.9 } },
  cliff: { label: 'Cliff', footprint: { kind: 'box', w: 6, d: 3.4 } },
  bush: { label: 'Bush', footprint: { kind: 'circle', r: 0.6 } },
  kayak: { label: 'Kayak', footprint: { kind: 'box', w: 3.2, d: 0.7 } },
  rowboat: { label: 'Rowboat', footprint: { kind: 'box', w: 3.2, d: 1.3 }, floats: true },
  sailboat: { label: 'Sailboat', footprint: { kind: 'box', w: 4.6, d: 1.6 }, floats: true },
  ring: { label: 'Pool ring', footprint: { kind: 'none' }, floats: true },
  mattress: { label: 'Air mattress', footprint: { kind: 'none' }, floats: true },
  buoy: { label: 'Buoy', footprint: { kind: 'circle', r: 0.35 }, floats: true },
  hut: { label: 'Hut', footprint: { kind: 'box', w: 6, d: 4 } },
  conifer: { label: 'Conifer', footprint: { kind: 'circle', r: 0.3 } },
  broadleaf: { label: 'Broadleaf tree', footprint: { kind: 'circle', r: 0.3 } },
  blocker: { label: 'Blocker', footprint: { kind: 'none' } },
  grass: { label: 'Grass tuft', footprint: { kind: 'none' } },
  flower: { label: 'Flowers', footprint: { kind: 'none' } },
  starfish: { label: 'Starfish', footprint: { kind: 'none' } },
  conch: { label: 'Conch shell', footprint: { kind: 'none' } },
  scallop: { label: 'Scallop shell', footprint: { kind: 'none' } },
  pebble: { label: 'Pebble', footprint: { kind: 'none' } },
  stone: { label: 'Path stone', footprint: { kind: 'none' } },
  stool: { label: 'Bar stool', footprint: { kind: 'circle', r: 0.22 } },
};

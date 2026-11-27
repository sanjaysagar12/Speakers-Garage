import type { ComponentType } from 'react';
import type { Footprint, Params } from '../models/catalog';
import type { InteractionDef } from '../../types';

export type TerrainKind = 'sand' | 'wet' | 'shallow' | 'deep' | 'grass' | 'rock' | 'deck' | 'path' | 'dirt' | 'snow';

/** One placed prop, fully resolved to world coordinates. */
export interface PropPlacement {
  type: string;
  x: number;
  z: number;
  /** yaw, radians */
  rot: number;
  scale: number;
  seed: number;
  params: Params;
  /** overrides the catalog footprint */
  footprint?: Footprint;
  /** explicit base height; defaults to the ground height (or the water surface for floating props) */
  y?: number;
}

/** A walkable raised floor (pier, bar deck, boardwalk): oriented rectangle with a deck height. */
export interface Deck {
  x: number;
  z: number;
  w: number;
  d: number;
  rot: number;
  /** deck height (at the far end when there is a ramp) */
  y: number;
  /** height ramps from y0 at the start edge (local v = -d/2) up to y over len metres */
  ramp?: { len: number; y0: number };
  /** collision blocks a band just outside the edges (elevated decks), except an open start edge */
  guard?: boolean;
  openStart?: boolean;
}

export interface MapAmbient {
  gulls: number;
  crabs: number;
  /** drifting things in the wind: petals or sand grains */
  drift: 'petals' | 'sand' | 'leaves';
  /** world-space point the campfire audio and glow come from, if any */
  fire?: { x: number; z: number };
}

/**
 * Everything the engine needs from a map. Maps are free to build these however they like
 * (the beach builds a shoreline distance field; Vinland reads a Tiled tile layer).
 */
export interface GameMap {
  id: string;
  name: string;
  tagline: string;
  /** walkable bounds: [0,width] x [0,height] in world x/z */
  width: number;
  height: number;
  spawn: { x: number; z: number; facing: number };
  interactions: InteractionDef[];
  props: PropPlacement[];
  decks: Deck[];
  ambient: MapAmbient;
  background: string;
  /** terrain surface height (decks excluded) */
  groundHeight(x: number, z: number): number;
  terrainAt(x: number, z: number): TerrainKind;
  /** metres below the water surface the feet are (0 on land). Drives wading and ripples. */
  wadeDepth(x: number, z: number): number;
  /** signed distance to the shore (positive inland) if the map has one */
  shoreDistance?(x: number, z: number): number;
  /** extra collision rules (deep water, cliffs) at a point */
  blockedAt(x: number, z: number): boolean;
  minimapColor(x: number, z: number): [number, number, number];
  /** terrain mesh(es) */
  Ground: ComponentType;
}

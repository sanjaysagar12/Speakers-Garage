/** How a sprite reacts to the global wind value. */
export type Sway =
  | 'none'
  /** tree canopy: rotates about its attach point (the trunk top) */
  | 'canopy'
  /** bush/fern: small rotate + squash */
  | 'bush'
  /** grass, wheat: shear from the base */
  | 'grass'
  /** floats on water */
  | 'bob'
  /** banner/flag: strong flutter */
  | 'banner';

export interface Collide {
  /** rectangle relative to the sprite origin, in logical px */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PropDef {
  key: string;
  /** logical canvas size */
  w: number;
  h: number;
  /** origin: the point placed on the map coordinate — the foot/base for anything standing on ground */
  ox: number;
  oy: number;
  svg: string;
  collide?: Collide;
  sway?: Sway;
  /** 'sort' = y-sorted with the player, 'ground' = flat decal, 'overlay' = always above the player */
  layer: 'sort' | 'ground' | 'overlay';
  /**
   * A second sprite attached at an offset from this one's origin and drawn in the overlay layer.
   * Trees use it for the canopy: the trunk keeps the collision box and the y-sort, the canopy sways
   * and passes over the player. The canopy's own origin is its pivot.
   */
  crown?: { key: string; dx: number; dy: number };
  /** canopy radius used to fade it out while the player is underneath (logical px) */
  coverRadius?: number;
}

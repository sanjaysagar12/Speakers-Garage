import type { Deck, GameMap } from './types';

/** Is (x,z) on the deck rectangle (three's rotation.y convention), with optional padding. */
export function pointInDeck(dk: Deck, x: number, z: number, pad = 0): boolean {
  const dx = x - dk.x;
  const dz = z - dk.z;
  const c = Math.cos(dk.rot);
  const s = Math.sin(dk.rot);
  return Math.abs(dx * c - dz * s) <= dk.w / 2 + pad && Math.abs(dx * s + dz * c) <= dk.d / 2 + pad;
}

/** Deck-local coordinates: u across, v along (v = -d/2 is the start edge). */
export function deckLocal(dk: Deck, x: number, z: number): { u: number; v: number } {
  const dx = x - dk.x;
  const dz = z - dk.z;
  const c = Math.cos(dk.rot);
  const s = Math.sin(dk.rot);
  return { u: dx * c - dz * s, v: dx * s + dz * c };
}

/** Walkable height of a deck at a point (follows the entrance ramp). */
export function deckHeight(dk: Deck, x: number, z: number): number {
  if (!dk.ramp || dk.ramp.len <= 0) return dk.y;
  const t = (deckLocal(dk, x, z).v + dk.d / 2) / dk.ramp.len;
  return t >= 1 ? dk.y : dk.ramp.y0 + (dk.y - dk.ramp.y0) * Math.max(0, t);
}

/** Highest deck under a point, if any. */
export function deckAt(map: GameMap, x: number, z: number): Deck | null {
  return deckAtIn(map.decks, x, z);
}

/** Highest deck of a list under a point (used while a map is still being built). */
export function deckAtIn(decks: readonly Deck[], x: number, z: number): Deck | null {
  let best: Deck | null = null;
  let bestY = -Infinity;
  for (const dk of decks) {
    if (!pointInDeck(dk, x, z)) continue;
    const y = deckHeight(dk, x, z);
    if (y > bestY) {
      best = dk;
      bestY = y;
    }
  }
  return best;
}

/** Height the feet stand at: deck floor, else ground minus wading depth. */
export function standHeight(map: GameMap, x: number, z: number): number {
  const dk = deckAt(map, x, z);
  if (dk) return deckHeight(dk, x, z);
  return map.groundHeight(x, z) - map.wadeDepth(x, z);
}

/**
 * The guarded deck (pier) a point belongs to, for edge rules. A point just beyond a deck's open start edge
 * (the shore entrance) counts as connected to it, so the entrance stays walkable while the sides are walls.
 */
export function guardZone(map: GameMap, x: number, z: number): { deck: Deck | null; entrance: Deck | null } {
  let deck: Deck | null = null;
  let entrance: Deck | null = null;
  for (const dk of map.decks) {
    if (!dk.guard) continue;
    if (pointInDeck(dk, x, z)) deck = dk;
    else if (dk.openStart) {
      const { u, v } = deckLocal(dk, x, z);
      if (Math.abs(u) <= dk.w / 2 + 0.02 && v < -dk.d / 2 && v > -dk.d / 2 - 1.5) entrance = dk;
    }
  }
  return { deck, entrance };
}

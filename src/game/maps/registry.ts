import type { GameMap } from './types';
import { createBeachMap } from './beach';
import { createVinlandMap } from './vinland';

/** Every playable map. Maps build lazily and are cached; beach is the default. */
export const MAP_REGISTRY: Record<string, { name: string; create: () => GameMap }> = {
  beach: { name: 'Shoreline (beach)', create: createBeachMap },
  vinland: { name: 'Vinland (valley)', create: createVinlandMap },
};
export const DEFAULT_MAP = 'beach';

const cache = new Map<string, GameMap>();
export function getMap(id: string): GameMap {
  const key = MAP_REGISTRY[id] ? id : DEFAULT_MAP;
  let m = cache.get(key);
  if (!m) {
    m = MAP_REGISTRY[key].create();
    cache.set(key, m);
  }
  return m;
}

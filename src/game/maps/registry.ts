import type { GameMap } from './types';
import { DEFAULT_MAP, MAP_NAMES } from './ids';

/**
 * Every playable map. Each map's code and data (Vinland's tile JSON is ~600 KB) is its own chunk, loaded
 * only when that map is entered; built maps are cached for the session. Beach is the default.
 */
const LOADERS: Record<string, () => Promise<() => GameMap>> = {
  beach: () => import('./beach').then((m) => m.createBeachMap),
  vinland: () => import('./vinland').then((m) => m.createVinlandMap),
};

export const MAP_REGISTRY: Record<string, { name: string }> = Object.fromEntries(Object.keys(LOADERS).map((id) => [id, { name: MAP_NAMES[id] ?? id }]));

const cache = new Map<string, Promise<GameMap>>();

/** Load (once) and build (once) a map. */
export function loadMap(id: string): Promise<GameMap> {
  const key = LOADERS[id] ? id : DEFAULT_MAP;
  let p = cache.get(key);
  if (!p) {
    p = LOADERS[key]().then((create) => create());
    cache.set(key, p);
  }
  return p;
}

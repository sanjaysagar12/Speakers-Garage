import { createBeachMapData } from './beach';
import { createVinlandMapData } from './vinland';
import type { MapData } from './types';

const BUILDERS: Record<string, () => MapData> = { beach: createBeachMapData, vinland: createVinlandMapData };
const cache = new Map<string, MapData>();

/** Map data by id (built once, then cached). The server uses this; the client loads maps lazily per chunk. */
export function createMapData(id: string): MapData {
  const hit = cache.get(id);
  if (hit) return hit;
  const build = BUILDERS[id];
  if (!build) throw new Error(`unknown map '${id}'`);
  const m = build();
  cache.set(id, m);
  return m;
}

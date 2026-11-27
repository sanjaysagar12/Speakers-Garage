import { createVinlandMapData, type VinlandData } from '@shoreline/shared';
import { createVinlandGround } from './VinlandGround';
import type { GameMap } from '../types';

/** Vinland's shared data (also used by the server) plus the client's terrain mesh. */
export function createVinlandMap(): GameMap & VinlandData {
  const map = createVinlandMapData() as GameMap & VinlandData;
  map.Ground = createVinlandGround(map);
  return map;
}

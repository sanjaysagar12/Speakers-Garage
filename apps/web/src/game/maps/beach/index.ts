import { createBeachMapData, type BeachData } from '@shoreline/shared';
import { createBeachGround } from './BeachGround';
import type { GameMap } from '../types';
import { devLog } from '../../../util/devlog';

/** The shared beach data (also used by the server) plus the client's terrain mesh. */
export function createBeachMap(): GameMap & { data: BeachData } {
  const t0 = performance.now();
  const map = createBeachMapData() as GameMap & { data: BeachData };
  map.Ground = createBeachGround(map);
  devLog(`[beach] built in ${(performance.now() - t0).toFixed(0)} ms: ${map.props.length} placements, ${map.decks.length} decks`);
  return map;
}

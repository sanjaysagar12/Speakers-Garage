import { createContext, useContext } from 'react';
import { devLog } from '../../util/devlog';
import { Vector3 } from 'three';
import { GAME_CONFIG, DEG } from '../config';
import { CollisionGrid } from '@shoreline/shared';
import { Pathfinding } from '../systems/Pathfinding';
import { standHeight } from '@shoreline/shared';
import type { GameMap } from '../maps/types';
import type { InputController } from './input';
import type { FxEmitter } from './fx';

/**
 * The mutable per-world state shared by the frame-loop components (player, camera, effects, ambient).
 * One instance per mounted world; React never re-renders from it.
 */
/** Live movement stats for the F3 panel (one world at a time). */
export const debugStats = { x: 0, z: 0, y: 0, ground: 0, deck: false, terrain: '', yawDeg: 0, speed: 0, moveX: 0, moveZ: 0, blocked: false };

export class WorldRuntime {
  readonly grid: CollisionGrid;
  readonly path: Pathfinding;
  readonly player = {
    pos: new Vector3(),
    vel: new Vector3(),
    facing: 0,
    moving: false,
    running: false,
    wade: 0,
  };
  readonly camera = {
    yaw: 0,
    yawTarget: 0,
    dist: GAME_CONFIG.camera.distance as number,
    distTarget: GAME_CONFIG.camera.distance as number,
    pitch: GAME_CONFIG.camera.pitchDeg * DEG,
    /** smoothed point the camera looks at; also the shadow frustum centre */
    focus: new Vector3(),
  };
  /** desired movement direction this frame (debug overlay) */
  readonly debugMove = new Vector3();
  input: InputController | null = null;
  fx: FxEmitter | null = null;
  /** set by the hotspot system; the player calls it on arrival */
  triggerInteraction: ((id: string) => void) | null = null;

  constructor(readonly map: GameMap) {
    const t0 = performance.now();
    this.grid = new CollisionGrid(map);
    this.path = new Pathfinding(this.grid);
    this.player.pos.set(map.spawn.x, standHeight(map, map.spawn.x, map.spawn.z), map.spawn.z);
    this.player.facing = map.spawn.facing;
    this.camera.focus.copy(this.player.pos);
    devLog(`[world] collision + pathfinding ${(performance.now() - t0).toFixed(0)} ms`);
  }
}

export const WorldContext = createContext<WorldRuntime | null>(null);
export function useWorld(): WorldRuntime {
  const w = useContext(WorldContext);
  if (!w) throw new Error('useWorld outside <World>');
  return w;
}

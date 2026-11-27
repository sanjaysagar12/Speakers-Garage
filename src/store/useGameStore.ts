import { useStore } from 'zustand';
import { gameStore } from './gameStore';
import type { GameState } from './gameStore';

/** React hook wrapper; Phaser code must import `gameStore`/`gameBridge` instead. */
export function useGameStore<T>(selector: (s: GameState) => T): T {
  return useStore(gameStore, selector);
}

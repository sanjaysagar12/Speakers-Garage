import type { PlayerProfile, PlayerState } from '../../types';

export type Unsubscribe = () => void;

/**
 * Transport-agnostic multiplayer seam. A WebSocket/Colyseus implementation only needs to satisfy this interface;
 * BeachScene already spawns/moves/removes `Player` instances in response to these callbacks.
 */
export interface NetworkAdapter {
  join(profile: PlayerProfile, state: PlayerState): Promise<void>;
  leave(): void;
  sendMove(state: PlayerState): void;
  onPlayerJoined(cb: (profile: PlayerProfile, state: PlayerState) => void): Unsubscribe;
  onPlayerLeft(cb: (id: string) => void): Unsubscribe;
  onPlayerMoved(cb: (id: string, state: PlayerState) => void): Unsubscribe;
}

/** Offline stub: nothing is sent, nobody else ever shows up. */
export class LocalAdapter implements NetworkAdapter {
  join(): Promise<void> {
    return Promise.resolve();
  }
  leave(): void {
    /* no-op */
  }
  sendMove(): void {
    /* no-op */
  }
  onPlayerJoined(): Unsubscribe {
    return () => undefined;
  }
  onPlayerLeft(): Unsubscribe {
    return () => undefined;
  }
  onPlayerMoved(): Unsubscribe {
    return () => undefined;
  }
}

import type { AvatarConfig, ClientMessage, Emote, InputCommand, ServerMessage, Snapshot } from '@speakersgarage/shared';
import type { PlayerProfile, PlayerState } from '../../types';

export type Unsubscribe = () => void;

export type NetStatus = 'offline' | 'connecting' | 'online' | 'reconnecting' | 'full' | 'version' | 'error';

/**
 * Transport-agnostic multiplayer seam.
 *
 * The first six methods are the original interface (kept unchanged). The optional members below extend it
 * for an authoritative server: the local player streams fixed-step input commands and reconciles against
 * its own state in snapshots; remote players come in through snapshots into the entity store
 * (net/entities.ts). An adapter without them (LocalAdapter) is simply single-player.
 */
export interface NetworkAdapter {
  join(profile: PlayerProfile, state: PlayerState): Promise<void>;
  leave(): void;
  sendMove(state: PlayerState): void;
  onPlayerJoined(cb: (profile: PlayerProfile, state: PlayerState) => void): Unsubscribe;
  onPlayerLeft(cb: (id: string) => void): Unsubscribe;
  onPlayerMoved(cb: (id: string, state: PlayerState) => void): Unsubscribe;

  /** true when positions are decided by a server (the local player must send commands, not positions) */
  readonly authoritative?: boolean;
  /** send fixed-step input commands (oldest first) */
  sendCommands?(cmds: readonly InputCommand[], n: number): void;
  /** our own authoritative state, every server tick */
  onSelfSnapshot?(cb: (s: Readonly<Snapshot>) => void): Unsubscribe;
  /** every JSON event from the server (welcome, chat, emote, voice, ...) */
  onEvent?(cb: (m: ServerMessage) => void): Unsubscribe;
  sendChat?(text: string): void;
  sendEmote?(emote: Emote | null): void;
  sendAvatar?(avatar: AvatarConfig): void;
  /** voice signaling / state (relayed by the server) */
  sendVoice?(msg: Extract<ClientMessage, { t: 'voice' | 'voiceState' }>): void;
}

/** Offline stub: nothing is sent, nobody else ever shows up. */
export class LocalAdapter implements NetworkAdapter {
  readonly authoritative = false;
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

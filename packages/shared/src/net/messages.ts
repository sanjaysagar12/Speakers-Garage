import type { EMOTES } from './constants';
import type { AvatarConfig } from '../types';
import type { ClientMessage, IceCandidateMessage } from './schemas';

export type { ClientMessage };

/**
 * JSON messages (text frames): rare events. Hot paths (inputs, snapshots, ping) are binary (codec.ts).
 * Client -> server messages are defined by zod schemas in ./schemas (server only: the web bundle never
 * loads zod); the types here are shared.
 */

/** A player as every client in the room knows them (the roster). */
export interface PlayerInfo {
  id: number;
  name: string;
  avatar: AvatarConfig;
  voice: { joined: boolean; muted: boolean; speaking: boolean };
}

export interface IceServerInfo {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export type ErrorCode = 'version' | 'full' | 'name' | 'rate' | 'bad' | 'replaced' | 'room' | 'server';

export type ServerMessage =
  | {
      t: 'welcome';
      selfId: number;
      resume: string;
      tickRate: number;
      stepHz: number;
      room: string;
      map: string;
      /** everyone in the room, including self */
      players: PlayerInfo[];
      ice: IceServerInfo[];
      aoiRadius: number;
      spawn: { x: number; z: number; y: number; facing: number };
    }
  | { t: 'joined'; player: PlayerInfo }
  | { t: 'left'; id: number }
  /** entity entered / left this client's area of interest (snapshots carry its state) */
  | { t: 'spawn'; id: number }
  | { t: 'despawn'; id: number }
  | { t: 'avatar'; id: number; avatar: AvatarConfig }
  | { t: 'chat'; id: number; name: string; text: string }
  | { t: 'emote'; id: number; emote: (typeof EMOTES)[number] | null }
  | { t: 'voice'; from: number; kind: 'offer' | 'answer' | 'ice' | 'bye'; sdp?: string; ice?: IceCandidateMessage }
  | { t: 'voiceState'; id: number; joined: boolean; muted: boolean; speaking: boolean }
  | { t: 'error'; code: ErrorCode; message: string };

/** Light runtime check for server messages on the client (the server is trusted, but versions can differ). */
export function parseServerMessage(text: string): ServerMessage | null {
  try {
    const m = JSON.parse(text) as ServerMessage;
    return m && typeof m === 'object' && typeof m.t === 'string' ? m : null;
  } catch {
    return null;
  }
}

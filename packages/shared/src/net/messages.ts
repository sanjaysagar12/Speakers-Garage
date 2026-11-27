import { z } from 'zod';
import { EMOTES, NET } from './constants';
import type { AvatarConfig } from '../types';

/**
 * JSON messages (text frames): rare events. Hot paths (inputs, snapshots, ping) are binary (codec.ts).
 * The server parses every client message with these schemas; anything that doesn't parse is dropped and
 * counted as a violation. Field contents are re-sanitized after parsing (names, chat, avatar whitelist).
 */

const avatarSchema = z.object({
  skin: z.string().max(7),
  hairStyle: z.string().max(24),
  hairColor: z.string().max(7),
  topId: z.string().max(24),
  topColor: z.string().max(7),
  bottomId: z.string().max(24),
  bottomColor: z.string().max(7),
  shoesId: z.string().max(24),
  shoesColor: z.string().max(7),
  hatId: z.string().max(24),
  hatColor: z.string().max(7),
  accessoryId: z.string().max(24),
  accessoryColor: z.string().max(7),
});

const iceCandidate = z.object({
  candidate: z.string().max(1024),
  sdpMid: z.string().max(64).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional(),
});

export const clientMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('join'),
    v: z.number().int(),
    name: z.string().max(64),
    avatar: avatarSchema,
    room: z.string().max(64),
    map: z.string().max(24).optional(),
    resume: z.string().max(64).optional(),
  }),
  z.object({ t: z.literal('chat'), text: z.string().max(NET.chatMaxLength * 2) }),
  z.object({ t: z.literal('emote'), emote: z.enum(EMOTES).nullable() }),
  z.object({ t: z.literal('avatar'), avatar: avatarSchema }),
  z.object({
    t: z.literal('voice'),
    to: z.number().int().min(0).max(65535),
    kind: z.enum(['offer', 'answer', 'ice', 'bye']),
    sdp: z.string().max(12_000).optional(),
    ice: iceCandidate.optional(),
  }),
  z.object({ t: z.literal('voiceState'), joined: z.boolean(), muted: z.boolean(), speaking: z.boolean() }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

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
  | { t: 'voice'; from: number; kind: 'offer' | 'answer' | 'ice' | 'bye'; sdp?: string; ice?: z.infer<typeof iceCandidate> }
  | { t: 'voiceState'; id: number; joined: boolean; muted: boolean; speaking: boolean }
  | { t: 'error'; code: ErrorCode; message: string };

/** Parse a client text frame. Returns null on anything invalid (bad JSON, unknown type, wrong shape). */
export function parseClientMessage(text: string): ClientMessage | null {
  if (text.length > NET.maxMessageBytes) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const r = clientMessageSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** Light runtime check for server messages on the client (the server is trusted, but versions can differ). */
export function parseServerMessage(text: string): ServerMessage | null {
  try {
    const m = JSON.parse(text) as ServerMessage;
    return m && typeof m === 'object' && typeof m.t === 'string' ? m : null;
  } catch {
    return null;
  }
}

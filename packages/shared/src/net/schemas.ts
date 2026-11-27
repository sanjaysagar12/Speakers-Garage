import { z } from 'zod';
import { EMOTES, NET } from './constants';

/**
 * zod schemas for client -> server JSON messages. Server only (exported as '@speakersgarage/shared/schemas',
 * not from the main entry, so the web bundle never includes zod). Anything that doesn't parse is dropped
 * and counted as a violation; contents are re-sanitized after parsing (names, chat, avatar whitelist).
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

export const iceCandidate = z.object({
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

export type IceCandidateMessage = z.infer<typeof iceCandidate>;

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


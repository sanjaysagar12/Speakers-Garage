import { z } from 'zod';
import { NET } from '@shoreline/shared';

const list = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((s) =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    );

/** Server configuration from the environment, validated at startup (the process exits on bad values). */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(0).max(65535).default(8787),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** browser origins allowed to open the WebSocket and call the HTTP API */
  ALLOWED_ORIGINS: list('http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173'),
  TICK_RATE: z.coerce.number().int().min(5).max(60).default(NET.tickRate),
  MAX_PLAYERS_PER_ROOM: z.coerce.number().int().min(1).max(500).default(NET.maxPlayersPerRoom),
  MAX_ROOMS: z.coerce.number().int().min(1).max(10_000).default(200),
  AOI_RADIUS: z.coerce.number().min(5).max(300).default(NET.aoiRadius),
  DEFAULT_MAP: z.enum(['beach', 'vinland']).default('beach'),
  /** STUN fallback (public) */
  STUN_URLS: list('stun:stun.l.google.com:19302'),
  /** coturn: e.g. turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp */
  TURN_URLS: list(''),
  /** coturn static-auth-secret (use-auth-secret): short-lived credentials are derived from it */
  TURN_SECRET: z.string().default(''),
  TURN_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3600),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const r = envSchema.safeParse(source);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid server environment:\n${msg}`);
  }
  if (r.data.TURN_URLS.length && !r.data.TURN_SECRET) throw new Error('Invalid server environment:\n  TURN_SECRET is required when TURN_URLS is set');
  return r.data;
}

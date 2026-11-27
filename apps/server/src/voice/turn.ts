import { createHmac } from 'node:crypto';
import type { IceServerInfo } from '@speakersgarage/shared';
import type { Env } from '../env';

/**
 * ICE servers for a player. With coturn (`use-auth-secret` + `static-auth-secret`), credentials follow the
 * TURN REST API scheme: username = "<expiry unix seconds>:<user>", credential = base64(HMAC-SHA1(secret,
 * username)). They expire after TURN_TTL_SECONDS, so a leaked credential is useless soon after.
 * Without TURN configured, only STUN is returned (works on the same network and most home NATs).
 */
export function iceServersFor(env: Pick<Env, 'STUN_URLS' | 'TURN_URLS' | 'TURN_SECRET' | 'TURN_TTL_SECONDS'>, user: string, nowMs = Date.now()): IceServerInfo[] {
  const out: IceServerInfo[] = [];
  if (env.STUN_URLS.length) out.push({ urls: env.STUN_URLS });
  if (env.TURN_URLS.length && env.TURN_SECRET) {
    const username = `${Math.floor(nowMs / 1000) + env.TURN_TTL_SECONDS}:${user}`;
    const credential = createHmac('sha1', env.TURN_SECRET).update(username).digest('base64');
    out.push({ urls: env.TURN_URLS, username, credential });
  }
  return out;
}

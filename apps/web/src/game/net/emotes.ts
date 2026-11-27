import { EMOTES, type Emote } from '@speakersgarage/shared';
import { session } from './session';

/** The local player's emote: 0 = none, 1 + EMOTES index (same encoding as the animation byte). */
export const localEmote = { id: 0, until: 0 };

const WAVE_MS = 2500;

/** Start (or stop, with null) an emote locally and tell the server, which relays it to the others. */
export function setLocalEmote(e: Emote | null): void {
  const id = e ? EMOTES.indexOf(e) + 1 : 0;
  if (id === localEmote.id && id !== 1) return;
  localEmote.id = id;
  localEmote.until = e === 'wave' ? performance.now() + WAVE_MS : Infinity;
  session.adapter.sendEmote?.(e);
}

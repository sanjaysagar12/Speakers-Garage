import { NET } from './constants';

/**
 * Text that other players will see. The client renders it as React text (never as HTML), but the server
 * still cleans it: no control characters, no markup characters, bounded length, a mild profanity mask.
 */

/** control, zero-width, bidi-override and line/paragraph separator characters */
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u2028-\\u202E\\u2060-\\u206F\\uFEFF]', 'g');
const MARKUP = /[<>&"`\\]/g;
/** names: letters, digits, space and a few joiners */
const NAME_CHARS = /[^\p{L}\p{N} _.'-]/gu;

/** Small list, matched as whole words (case-insensitive); masks the middle letters. Not meant to be exhaustive. */
const BLOCKED = ['fuck', 'shit', 'cunt', 'bitch', 'nigger', 'nigga', 'faggot', 'retard', 'whore', 'slut', 'rape', 'nazi'];
const BLOCKED_RE = new RegExp(`\\b(${BLOCKED.join('|')})(s|es|ed|ing)?\\b`, 'giu');

export const maskProfanity = (s: string): string => s.replace(BLOCKED_RE, (w) => w[0] + '*'.repeat(Math.max(1, w.length - 2)) + w[w.length - 1]);

/** Returns a clean display name, or null if nothing usable is left. */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = maskProfanity(
    raw
      .normalize('NFKC')
      .replace(CONTROL, '')
      .replace(NAME_CHARS, '')
      .replace(/\s+/g, ' ')
      .trim(),
  ).slice(0, NET.nameMaxLength);
  return s.length >= 1 ? s.trim() : null;
}

/** Returns clean chat text, or null if empty. */
export function sanitizeChat(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = maskProfanity(raw.normalize('NFKC').replace(CONTROL, '').replace(MARKUP, '').replace(/\s+/g, ' ').trim()).slice(0, NET.chatMaxLength);
  return s.length ? s : null;
}

/** Room ids: lowercase letters, digits and dashes. */
export function sanitizeRoomId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, NET.roomIdMaxLength);
  return s.length ? s : null;
}

/**
 * Browser storage keys, and the one-time migration from the old brand's keys (Shoreline / Vinland), so
 * saved names, avatars, settings and the device benchmark survive the rename. Runs when this module is
 * first imported, which is before any store reads its key (every reader imports its key from here).
 */
export const KEYS = {
  profile: 'speakersgarage.profile.v2',
  detect: 'speakersgarage.detect.v1',
  /** sessionStorage (per tab) */
  resume: 'speakersgarage.resume.v1',
  blocked: 'speakersgarage.blocked.v1',
} as const;

/** old key -> new key, newest first per target (the first old key found wins) */
const LOCAL_MOVES: Array<[string, string]> = [
  ['shoreline.profile.v2', KEYS.profile],
  ['vinland.profile.v1', KEYS.profile],
  ['shoreline.detect.v1', KEYS.detect],
];
const SESSION_MOVES: Array<[string, string]> = [
  ['shoreline.resume.v1', KEYS.resume],
  ['shoreline.blocked.v1', KEYS.blocked],
];

/** Copy old values to their new keys (never overwriting a new one), then remove the old keys. */
export function migrateStorage(store: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, moves: Array<[string, string]>): number {
  let moved = 0;
  for (const [from, to] of moves) {
    const old = store.getItem(from);
    if (old === null) continue;
    if (store.getItem(to) === null) {
      store.setItem(to, old);
      moved++;
    }
    store.removeItem(from);
  }
  return moved;
}

try {
  migrateStorage(localStorage, LOCAL_MOVES);
  migrateStorage(sessionStorage, SESSION_MOVES);
} catch {
  /* storage unavailable (private mode, blocked cookies): nothing to migrate */
}

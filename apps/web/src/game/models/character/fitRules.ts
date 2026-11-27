import type { AvatarConfig, Slot } from '../../../types';
import { SLOT_FIELDS } from '@shoreline/shared';
import type { GarmentPart } from './garments';

/**
 * Layer and conflict rules, as data. The character builder applies them (hidden parts, hair modes) and the
 * customizer shows them (a note under the preview), so what you pick is always what gets drawn.
 *
 * Layer order, inside to outside: body < bottom < top < accessory (scarf, backpack); the hat and its hair
 * mask sit on the head; long hair hangs over whatever is on the upper back (see garments.ts backDepth).
 */

interface Match {
  slot: Slot;
  /** the item id, or '*' for anything but "none" */
  is: string;
}

export interface LayerRule {
  when: Match;
  /** what gets hidden or changed */
  hides: { slot: Slot; part: GarmentPart | 'crown' | 'volume' };
  /** short note for the customizer */
  note: string;
}

export const LAYER_RULES: readonly LayerRule[] = [
  { when: { slot: 'hat', is: '*' }, hides: { slot: 'hair', part: 'crown' }, note: 'Hair under the hat is tucked in' },
  { when: { slot: 'hat', is: 'sun_hat' }, hides: { slot: 'hair', part: 'volume' }, note: 'The wide brim flattens the hair' },
  { when: { slot: 'accessory', is: 'backpack' }, hides: { slot: 'top', part: 'hood' }, note: 'The hood is flattened by the backpack' },
  { when: { slot: 'accessory', is: 'scarf' }, hides: { slot: 'top', part: 'drawstrings' }, note: 'The scarf covers the drawstrings' },
  { when: { slot: 'accessory', is: 'scarf' }, hides: { slot: 'top', part: 'collar' }, note: 'The scarf covers the collar' },
];

/**
 * Pairs that cannot be worn together: picking one replaces the other with its fallback. With the current
 * catalog every combination can be fitted (the rules above adapt instead), so this list is empty; the
 * mechanism is kept (and tested) for future items such as a full hood or a helmet.
 */
export interface Conflict {
  a: Match;
  b: Match;
  /** what `b`'s slot falls back to when `a` is chosen (and vice versa) */
  fallbackA: string;
  fallbackB: string;
}
export const CONFLICTS: readonly Conflict[] = [];

/** Combinations that are fitted on purpose and must keep working (checked by the fit test). */
export const COMPATIBLE: ReadonlyArray<[Match, Match]> = [
  // glasses rest on the nose bridge and the ear line, under every hat band and brim
  [
    { slot: 'accessory', is: 'sunglasses' },
    { slot: 'hat', is: '*' },
  ],
];

const matches = (cfg: AvatarConfig, m: Match) => {
  const v = cfg[SLOT_FIELDS[m.slot].id];
  return m.is === '*' ? v !== 'none' : v === m.is;
};

export interface FitState {
  /** garment parts not drawn */
  hidden: Set<GarmentPart>;
  /** notes for the customizer, in rule order */
  notes: string[];
}

export function resolveFit(cfg: AvatarConfig): FitState {
  const hidden = new Set<GarmentPart>();
  const notes: string[] = [];
  for (const r of LAYER_RULES) {
    if (!matches(cfg, r.when)) continue;
    // a rule only matters if the thing it hides is there
    if (r.hides.slot === 'top' && cfg.topId !== 'hoodie' && r.hides.part !== 'collar') continue;
    if (r.hides.slot === 'top' && r.hides.part === 'collar' && cfg.topId === 'tank') continue;
    if (r.hides.slot === 'hair' && cfg.hairStyle === 'buzz' && r.hides.part === 'volume') continue;
    if (r.hides.slot !== 'hair') hidden.add(r.hides.part as GarmentPart);
    notes.push(r.note);
  }
  return { hidden, notes };
}

/** Apply conflicts after `changed` was picked: the other item of a conflicting pair falls back. */
export function enforceConflicts(cfg: AvatarConfig, changed: Slot, rules: readonly Conflict[] = CONFLICTS): AvatarConfig {
  const out = { ...cfg };
  for (const c of rules) {
    if (!matches(out, c.a) || !matches(out, c.b)) continue;
    if (changed === c.a.slot) (out[SLOT_FIELDS[c.b.slot].id] as string) = c.fallbackB;
    else (out[SLOT_FIELDS[c.a.slot].id] as string) = c.fallbackA;
  }
  return out;
}

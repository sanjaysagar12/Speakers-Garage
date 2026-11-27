import { describe, expect, it } from 'vitest';
import { DEFAULT_AVATAR } from '@shoreline/shared';
import { checkCombo, groupFailures, makeCombos } from './fitCheck';
import { enforceConflicts, resolveFit, type Conflict } from './fitRules';
import { visibleRanges } from './Character';
import { SEGMENTS, type TubeSeg } from './rig';

// The full sweep (600 combinations) is `pnpm test:fit`; this runs the pair-covering set without the
// slow z-fight pass so `pnpm test` stays quick.
describe('avatar fit', () => {
  it('every option pair fits (garments, hats, hair, joints, poses)', () => {
    const combos = makeCombos(0, 1);
    expect(combos.length).toBeGreaterThan(20);
    const fails = combos.flatMap((c) => checkCombo(c, { zfight: false }));
    expect(groupFailures(fails).map((g) => `${g.item} [${g.check}] ${g.example.detail}`)).toEqual([]);
  }, 120_000);

  it('layer rules hide what is covered and say so', () => {
    const f = resolveFit({ ...DEFAULT_AVATAR, topId: 'hoodie', accessoryId: 'backpack', hatId: 'cap' });
    expect([...f.hidden]).toContain('hood');
    expect(f.notes).toContain('Hair under the hat is tucked in');
    expect(resolveFit({ ...DEFAULT_AVATAR, topId: 'tee', accessoryId: 'backpack' }).hidden.has('hood')).toBe(false);
  });

  it('conflicts: picking one item falls the other back', () => {
    const rules: Conflict[] = [{ a: { slot: 'hat', is: 'cap' }, b: { slot: 'accessory', is: 'sunglasses' }, fallbackA: 'none', fallbackB: 'none' }];
    const both = { ...DEFAULT_AVATAR, hatId: 'cap', accessoryId: 'sunglasses' };
    expect(enforceConflicts(both, 'hat', rules).accessoryId).toBe('none');
    expect(enforceConflicts(both, 'accessory', rules).hatId).toBe('none');
  });

  it('covered body ranges are not drawn (with an overlap under the hem)', () => {
    const arm = SEGMENTS.upperArmL as TubeSeg;
    expect(visibleRanges(arm, [{ seg: 'upperArmL', from: -0.125 }])).toEqual([[-Infinity, -0.095]]);
    expect(visibleRanges(arm, [{ seg: 'upperArmL' }])).toEqual([]);
  });
});

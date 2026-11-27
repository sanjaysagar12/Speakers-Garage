import { describe, expect, it } from 'vitest';
import { migrateStorage } from './storage';

class Mem {
  m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, v);
  removeItem = (k: string) => void this.m.delete(k);
}

describe('storage migration from the old brand', () => {
  it('moves old keys to the new ones and removes them', () => {
    const s = new Mem();
    s.setItem('shoreline.profile.v2', '{"name":"Ana"}');
    s.setItem('vinland.profile.v1', '{"name":"Old"}');
    expect(migrateStorage(s, [['shoreline.profile.v2', 'speakersgarage.profile.v2'], ['vinland.profile.v1', 'speakersgarage.profile.v2']])).toBe(1);
    expect(s.getItem('speakersgarage.profile.v2')).toBe('{"name":"Ana"}');
    expect(s.getItem('shoreline.profile.v2')).toBeNull();
    expect(s.getItem('vinland.profile.v1')).toBeNull();
  });
  it('never overwrites a value saved under the new key', () => {
    const s = new Mem();
    s.setItem('speakersgarage.profile.v2', 'new');
    s.setItem('shoreline.profile.v2', 'old');
    migrateStorage(s, [['shoreline.profile.v2', 'speakersgarage.profile.v2']]);
    expect(s.getItem('speakersgarage.profile.v2')).toBe('new');
  });
});

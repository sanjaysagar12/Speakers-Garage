import type { AvatarConfig, Slot, SlotOption } from '../../../types';

/** Everything the customizer can offer. Ids are persisted, so only ever add to these lists. */
export const AVATAR_SLOTS: Record<Slot, SlotOption[]> = {
  hair: [
    { id: 'short', label: 'Short layered' },
    { id: 'buzz', label: 'Buzz' },
    { id: 'bob', label: 'Bob' },
    { id: 'long', label: 'Long straight' },
    { id: 'wavy', label: 'Long wavy' },
    { id: 'ponytail', label: 'Ponytail' },
    { id: 'bun', label: 'Top bun' },
    { id: 'braid', label: 'Braid' },
  ],
  top: [
    { id: 'tee', label: 'Tee' },
    { id: 'tank', label: 'Tank top' },
    { id: 'swim_shirt', label: 'Swim shirt' },
    { id: 'hoodie', label: 'Hoodie' },
  ],
  bottom: [
    { id: 'shorts', label: 'Shorts' },
    { id: 'trunks', label: 'Swim trunks' },
    { id: 'skirt', label: 'Skirt' },
    { id: 'trousers', label: 'Long trousers' },
  ],
  shoes: [
    { id: 'barefoot', label: 'Barefoot' },
    { id: 'sandals', label: 'Sandals' },
    { id: 'sneakers', label: 'Sneakers' },
  ],
  hat: [
    { id: 'none', label: 'No hat' },
    { id: 'sun_hat', label: 'Sun hat' },
    { id: 'cap', label: 'Cap' },
  ],
  accessory: [
    { id: 'none', label: 'Nothing' },
    { id: 'sunglasses', label: 'Sunglasses' },
    { id: 'scarf', label: 'Scarf' },
    { id: 'backpack', label: 'Backpack' },
  ],
};

export const SKIN_TONES = ['#F6DCC0', '#EFC6A0', '#E0AC80', '#C68A5C', '#9C6440', '#6E4430'];
export const HAIR_COLOURS = ['#1E1A1F', '#3B2A24', '#5A3A22', '#8A5A33', '#C08A4A', '#E8C878', '#C9622F', '#7A8FA6', '#E9E4DA', '#E58FA8'];
export const CLOTH_COLOURS = [
  '#EC847C', '#D9665E', '#F6C945', '#F08A3C', '#FBF6EE', '#F4E3C9',
  '#74DCD4', '#04A4B4', '#11738A', '#1F5F73', '#144454', '#5CA464',
  '#A79BE0', '#F49AB0', '#C98A4B', '#8E8072', '#3A3F4A', '#22252B',
];

export const DEFAULT_AVATAR: AvatarConfig = {
  skin: '#E0AC80',
  hairStyle: 'short',
  hairColor: '#3B2A24',
  topId: 'tee',
  topColor: '#FBF6EE',
  bottomId: 'shorts',
  bottomColor: '#11738A',
  shoesId: 'sandals',
  shoesColor: '#1F5F73',
  hatId: 'none',
  hatColor: '#F4E3C9',
  accessoryId: 'none',
  accessoryColor: '#22252B',
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const has = (slot: Slot, id: unknown) => typeof id === 'string' && AVATAR_SLOTS[slot].some((o) => o.id === id);
const hex = (v: unknown, d: string) => (typeof v === 'string' && HEX.test(v) ? v : d);

/** Accepts anything (old saves, other clients) and returns a valid config; unknown ids fall back to defaults. */
export function sanitizeAvatar(raw: Partial<Record<keyof AvatarConfig, unknown>> | null | undefined): AvatarConfig {
  const r = raw ?? {};
  const d = DEFAULT_AVATAR;
  return {
    skin: hex(r.skin, d.skin),
    hairStyle: has('hair', r.hairStyle) ? (r.hairStyle as string) : d.hairStyle,
    hairColor: hex(r.hairColor, d.hairColor),
    topId: has('top', r.topId) ? (r.topId as string) : d.topId,
    topColor: hex(r.topColor, d.topColor),
    bottomId: has('bottom', r.bottomId) ? (r.bottomId as string) : d.bottomId,
    bottomColor: hex(r.bottomColor, d.bottomColor),
    shoesId: has('shoes', r.shoesId) ? (r.shoesId as string) : d.shoesId,
    shoesColor: hex(r.shoesColor, d.shoesColor),
    hatId: has('hat', r.hatId) ? (r.hatId as string) : d.hatId,
    hatColor: hex(r.hatColor, d.hatColor),
    accessoryId: has('accessory', r.accessoryId) ? (r.accessoryId as string) : d.accessoryId,
    accessoryColor: hex(r.accessoryColor, d.accessoryColor),
  };
}

export const SLOT_FIELDS: Record<Slot, { id: keyof AvatarConfig; colour: keyof AvatarConfig }> = {
  hair: { id: 'hairStyle', colour: 'hairColor' },
  top: { id: 'topId', colour: 'topColor' },
  bottom: { id: 'bottomId', colour: 'bottomColor' },
  shoes: { id: 'shoesId', colour: 'shoesColor' },
  hat: { id: 'hatId', colour: 'hatColor' },
  accessory: { id: 'accessoryId', colour: 'accessoryColor' },
};

/** Vinland palette. Every colour used by the art lives here so the whole world can be retuned in one place. */
export const P = {
  // grass / meadow
  grassLight: '#9CC06E',
  grass: '#7FA85C',
  grassMid: '#5E8C47',
  grassDeep: '#426B36',
  grassDry: '#A8B063',

  // crops & tall grass
  wheat: '#C8B45E',
  wheatLight: '#E0CE80',
  barley: '#BFA85A',
  hay: '#D2B96A',

  // soil
  dirt: '#8A6A4A',
  dirtDark: '#6B4F38',
  mud: '#5E4733',
  mudDark: '#4E3A2A',
  soil: '#74573E',
  gravel: '#9A9289',

  // rock
  rock: '#7C7A82',
  rockDark: '#5A5862',
  rockDeep: '#3E3C46',
  rockLight: '#9E9BA4',

  // snow
  snow: '#F2F4F6',
  snowShade: '#C9D6E0',

  // foliage
  pineDeep: '#2E4A35',
  pine: '#3C6042',
  pineLight: '#547A4E',
  birchLeaf: '#79A356',
  birchLeafLight: '#95BC6A',
  oakLeaf: '#5F8740',
  oakLeafLight: '#7BA253',
  shrub: '#4F7A42',
  shrubLight: '#6D9A52',
  fern: '#4A7A45',
  vine: '#5B7F3E',
  grape: '#5B3A6B',

  // bark
  bark: '#6B543E',
  barkDark: '#4A3A2C',
  barkLight: '#8A6E52',
  birchBark: '#E3DED2',
  birchBarkShade: '#C5BFB0',

  // water
  waterDeep: '#2C5A74',
  waterDeeper: '#214A63',
  waterMid: '#3E7E96',
  waterShallow: '#6FB3BE',
  waterShallowLight: '#8FCBD2',
  foam: '#EAF4F5',

  // built
  timber: '#8A6440',
  timberDark: '#5E4428',
  timberLight: '#A88155',
  thatch: '#C0A057',
  thatchDark: '#94773C',
  turf: '#6E8C4A',
  turfDark: '#536C37',
  stone: '#8E8A84',
  stoneDark: '#6A665F',
  iron: '#4C4A50',
  cloth: '#D8CBA8',

  // accents
  flowerWhite: '#FFFBF0',
  flowerYellow: '#F3D158',
  flowerPink: '#E68FA8',
  flowerBlue: '#7E9FD4',
  fire: '#FF9A3C',
  fireCore: '#FFE08A',

  // light & shadow
  shadow: '#2A4A5E',
  sunWarm: '#FFE9C4',
  mist: '#D8E6EA',
  ink: '#33281F',
} as const;

/** All shadows in the world fall the same way: down-right, cool blue-teal. */
export const SHADOW = {
  color: P.shadow,
  /** multiplied by the object's height to get the shadow offset */
  dx: 0.34,
  dy: 0.15,
  opacity: 0.26,
} as const;

/** Sun direction for shading (light comes from the upper-left, so shadows fall to the lower-right). */
export const LIGHT = { x: -0.62, y: -0.78 } as const;

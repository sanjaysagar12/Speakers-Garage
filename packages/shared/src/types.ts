/** Types that cross the wire or are shared by the client and the server. */

/** The six customizable slots. `hair` also carries a style id. */
export type Slot = 'hair' | 'top' | 'bottom' | 'shoes' | 'hat' | 'accessory';

export interface AvatarConfig {
  skin: string;
  hairStyle: string;
  hairColor: string;
  topId: string;
  topColor: string;
  bottomId: string;
  bottomColor: string;
  shoesId: string;
  shoesColor: string;
  hatId: string;
  hatColor: string;
  accessoryId: string;
  accessoryColor: string;
}

/** Everything another client needs to draw a player. This is what goes over the wire later. */
export interface PlayerState {
  /** map plane position: x = east, y = south (world z) */
  x: number;
  y: number;
  /** body yaw in radians (0 = facing +z / south) */
  facing: number;
  moving: boolean;
  running: boolean;
  inWater: boolean;
}

export interface PlayerProfile {
  id: string;
  name: string;
  avatar: AvatarConfig;
}

export type InteractionKind = 'bubble' | 'modal';

export type InteractionAction =
  | { type: 'message' }
  | { type: 'modal' }
  | { type: 'link'; url: string }
  | { type: 'call'; room: string };

export interface InteractionDef {
  id: string;
  /** map plane position (world x, world z) */
  x: number;
  y: number;
  radius: number;
  kind: InteractionKind;
  title: string;
  text: string;
  icon?: string;
  action: InteractionAction;
}

export interface Vec2 {
  x: number;
  y: number;
}

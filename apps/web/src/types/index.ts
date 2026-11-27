export type { AvatarConfig, InteractionAction, InteractionDef, InteractionKind, PlayerProfile, PlayerState, Slot, Vec2 } from '@shoreline/shared';

export interface DialogContent {
  title: string;
  text: string;
  icon?: string;
  link?: string;
}
export interface NearbyInteraction {
  id: string;
  title: string;
}

export interface SlotOption {
  id: string;
  label: string;
}

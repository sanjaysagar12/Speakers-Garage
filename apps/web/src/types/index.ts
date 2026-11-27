export type { AvatarConfig, InteractionAction, InteractionDef, InteractionKind, PlayerProfile, PlayerState, Slot, SlotOption, Vec2 } from '@speakersgarage/shared';

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

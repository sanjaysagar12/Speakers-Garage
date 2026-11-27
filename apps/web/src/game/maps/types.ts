import type { ComponentType } from 'react';
import type { MapData } from '@speakersgarage/shared';

export type { Deck, MapAmbient, MapData, PropPlacement, TerrainKind } from '@speakersgarage/shared';

/** A map as the client uses it: the shared map data plus its terrain mesh(es). */
export interface GameMap extends MapData {
  Ground: ComponentType;
}

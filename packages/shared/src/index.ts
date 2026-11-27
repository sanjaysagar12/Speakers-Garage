/**
 * @speakersgarage/shared: everything the client and the server must agree on. Pure TypeScript: no DOM, no
 * three.js, no Node APIs, so the same code runs in the browser (prediction) and on the server (authority).
 */
export * from './types';
export * from './avatar';
export * from './config';
export * from './util/noise';
export * from './util/rng';
export * from './util/color';
export * from './map/types';
export * from './map/props';
export * from './map/pier';
export * from './map/deck';
export * from './map/ids';
export * from './map/beach/field';
export { createBeachMapData, type BeachData } from './map/beach';
export { createVinlandMapData, type VinlandData } from './map/vinland';
export { VINLAND_KIND_COLOURS } from './map/vinland/colours';
export { createMapData } from './map/index';
export * from './sim/collision';
export * from './sim/step';
export * from './sim/commands';
export * from './sim/prediction';
export * from './net/constants';
export * from './net/codec';
export * from './net/messages';
export * from './net/text';

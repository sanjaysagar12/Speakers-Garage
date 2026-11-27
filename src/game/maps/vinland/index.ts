import mapJson from './vinland.json';
import { createVinlandGround } from './VinlandGround';
import { vnoise } from '../../util/noise';
import { VINLAND_KIND_COLOURS } from './colours';
import type { GameMap, PropPlacement, TerrainKind } from '../types';
import type { InteractionAction, InteractionDef } from '../../../types';

/**
 * Vinland, the previous Tiled map, kept playable inside the 3D engine. Tiles are 64 px; 128 px = 1 m,
 * so 240 x 180 tiles become 120 x 90 m. Tile kinds become ground colour and height (rock and snow ridges
 * rise into real terrain); Tiled objects map onto the procedural models.
 */

interface TiledProp {
  name: string;
  value: string | number | boolean;
}
interface TiledObject {
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  properties?: TiledProp[];
}
interface TiledLayer {
  name: string;
  data?: number[];
  objects?: TiledObject[];
}
interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  layers: TiledLayer[];
  tilesets: Array<{ tiles: Array<{ id: number; properties: TiledProp[] }> }>;
}

const PX = 1 / 128;
const prop = (o: TiledObject, n: string) => o.properties?.find((p) => p.name === n)?.value;


/** Tiled object type -> procedural prop type (+ params). Anything not listed is skipped. */
function mapObject(t: string): { type: string; params?: Record<string, unknown> } | null {
  if (/^(spruce|pine)_trunk$/.test(t)) return { type: 'conifer' };
  if (/^(birch\d|oak\d)_trunk$/.test(t)) return { type: 'broadleaf' };
  if (t === 'dead_tree' || t === 'stump' || t === 'fallen_log') return { type: 'log' };
  if (t === 'longhouse') return { type: 'hut', params: { w: 11, d: 5, h: 2.6 } };
  if (t === 'barn') return { type: 'hut', params: { w: 7, d: 5, h: 2.8, roof: '#8A6440' } };
  if (t === 'storehouse' || t === 'smokehouse') return { type: 'hut', params: { w: 3.6, d: 3, h: 2, roof: '#6E8C4A' } };
  if (t === 'rock_s' || t === 'rock_m' || t === 'standing_stone' || t === 'well') return { type: 'rock', params: { size: t === 'rock_s' ? 0.5 : 0.9, tone: 'cool' } };
  if (/^bush_/.test(t)) return { type: 'bush' };
  if (/^tuft_/.test(t) || t === 'cattails' || t === 'reeds' || t === 'fern_b') return { type: 'grass' };
  if (/^flowers_/.test(t)) return { type: 'flower' };
  if (t === 'campfire') return { type: 'campfire' };
  if (t === 'jetty') return { type: 'boardwalk', params: { length: 6, width: 2, deckY: 0.15 } };
  if (t === 'rowboat') return { type: 'rowboat' };
  if (t === 'notice_post') return { type: 'signpost' };
  return null;
}

export function createVinlandMap(): GameMap & { kinds: string[]; heights: Float32Array; tilesW: number; tilesH: number } {
  const raw = mapJson as unknown as TiledMap;
  const layer = (n: string) => raw.layers.find((l) => l.name === n);
  const tw = raw.width;
  const th = raw.height;
  const tileM = raw.tilewidth * PX;
  const kindByGid: string[] = [];
  for (const t of raw.tilesets[0].tiles) kindByGid[t.id + 1] = String(t.properties.find((p) => p.name === 'kind')?.value ?? 'grass');
  const ground = layer('ground')?.data ?? [];
  const collision = layer('collision')?.data ?? [];
  const kinds = ground.map((g) => kindByGid[g] ?? 'grass');

  // heights: ridges from rock/snow tiles, blurred so the terrain rises smoothly
  const raw0 = new Float32Array(tw * th);
  kinds.forEach((k, i) => (raw0[i] = k === 'snow' ? 5.5 : k === 'rock' ? 2.6 : k === 'deep' ? -0.3 : 0));
  const heights = new Float32Array(tw * th);
  const R = 3;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const xx = Math.min(tw - 1, Math.max(0, x + dx));
          const yy = Math.min(th - 1, Math.max(0, y + dy));
          sum += raw0[yy * tw + xx];
          n++;
        }
      }
      const k = kinds[y * tw + x];
      const water = k === 'deep' || k === 'shallow';
      heights[y * tw + x] = water ? 0 : Math.max(0.05, sum / n) + (vnoise(x * 0.11, y * 0.11) - 0.5) * 0.25;
    }
  }
  const tileAt = (x: number, z: number) => {
    const tx = Math.min(tw - 1, Math.max(0, Math.floor(x / tileM)));
    const ty = Math.min(th - 1, Math.max(0, Math.floor(z / tileM)));
    return ty * tw + tx;
  };
  const groundHeight = (x: number, z: number) => {
    const fx = Math.min(tw - 1.001, Math.max(0, x / tileM - 0.5));
    const fz = Math.min(th - 1.001, Math.max(0, z / tileM - 0.5));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const a = heights[j * tw + i] + (heights[j * tw + i + 1] - heights[j * tw + i]) * (fx - i);
    const b = heights[(j + 1) * tw + i] + (heights[(j + 1) * tw + i + 1] - heights[(j + 1) * tw + i]) * (fx - i);
    return a + (b - a) * (fz - j);
  };

  const props: PropPlacement[] = [];
  let seed = 1;
  for (const o of layer('objects')?.objects ?? []) {
    const m = mapObject(o.type);
    if (!m) continue;
    props.push({ type: m.type, x: o.x * PX, z: o.y * PX, rot: ((seed * 2.39996) % (Math.PI * 2)), scale: 1, seed: seed++ * 7919, params: m.params ?? {} });
  }
  // blockers become footprint-only placements
  for (const b of layer('blockers')?.objects ?? []) {
    props.push({
      type: 'blocker',
      x: (b.x + b.width / 2) * PX,
      z: (b.y + b.height / 2) * PX,
      rot: 0,
      scale: 1,
      seed: 0,
      params: {},
      footprint: { kind: 'box', w: b.width * PX, d: b.height * PX },
    });
  }

  const interactions: InteractionDef[] = (layer('interactions')?.objects ?? []).map((o) => {
    let action: InteractionAction = { type: 'message' };
    try {
      action = JSON.parse(String(prop(o, 'action') ?? '{}')) as InteractionAction;
    } catch {
      /* default */
    }
    return {
      id: o.name,
      x: o.x * PX,
      y: o.y * PX,
      radius: Number(prop(o, 'radius') ?? 200) * PX * 1.6,
      kind: String(prop(o, 'kind')) === 'modal' ? 'modal' : 'bubble',
      title: String(prop(o, 'title') ?? o.name),
      text: String(prop(o, 'text') ?? ''),
      icon: prop(o, 'icon') ? String(prop(o, 'icon')) : undefined,
      action,
    };
  });
  const sp = layer('spawn')?.objects?.[0];
  const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const kindTerrain: Record<string, TerrainKind> = { deep: 'deep', shallow: 'shallow', rock: 'rock', snow: 'snow', path: 'path', dirt: 'dirt', mud: 'dirt', soil: 'dirt', gravel: 'path' };
  const fire = props.find((p) => p.type === 'campfire');

  const map = {
    id: 'vinland',
    name: 'Vinland',
    tagline: 'A green valley, a lake, and a farm being built into the land.',
    width: tw * tileM,
    height: th * tileM,
    spawn: { x: (sp?.x ?? 7000) * PX, z: (sp?.y ?? 5600) * PX, facing: Math.PI },
    interactions,
    props,
    decks: [],
    ambient: { gulls: 2, crabs: 0, drift: 'leaves' as const, fire: fire ? { x: fire.x, z: fire.z } : undefined },
    background: '#2E4A35',
    groundHeight,
    terrainAt: (x: number, z: number) => kindTerrain[kinds[tileAt(x, z)]] ?? 'grass',
    wadeDepth: (x: number, z: number) => (kinds[tileAt(x, z)] === 'shallow' ? 0.3 : 0),
    blockedAt: (x: number, z: number) => collision[tileAt(x, z)] !== 0 || kinds[tileAt(x, z)] === 'deep',
    minimapColor: (x: number, z: number) => hex(VINLAND_KIND_COLOURS[kinds[tileAt(x, z)]] ?? '#7FA85C'),
    Ground: (() => null) as GameMap['Ground'],
    kinds,
    heights,
    tilesW: tw,
    tilesH: th,
  };
  map.Ground = createVinlandGround(map);
  return map;
}

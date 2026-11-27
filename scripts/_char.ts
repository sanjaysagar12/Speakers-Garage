/**
 * Character contact sheets.
 *   npx tsx scripts/_char.ts <outDir> hair      all hair styles x 4 directions x walk frames
 *   npx tsx scripts/_char.ts <outDir> outfit    clothing options on one body
 *   npx tsx scripts/_char.ts <outDir> anim      one avatar, every frame of every animation
 */
import fs from 'node:fs';
import sharp from 'sharp';
import type { OverlayOptions } from 'sharp';
import { rasterize, tint } from './art/raster.js';
import { allLayers, layerSheetSvg, animOfColumn } from './art/character/sheets.js';
import type { LayerDef } from './art/character/sheets.js';
import { COLS, CW, CH, DIRS } from './art/character/rig.js';
import { HAIR_STYLES } from './art/character/hair.js';
import { TOPS, BOTTOMS, SHOES, CLOAKS, ACCESSORIES } from './art/character/clothing.js';

const out = process.argv[2];
const mode = process.argv[3] ?? 'hair';
const S = 2;
const FW = CW * S;
const FH = CH * S;

const layers = allLayers();
const byName = new Map(layers.map((l) => [l.name, l]));
const cache = new Map<string, Buffer>();
async function sheet(name: string, colour: string | null): Promise<Buffer | null> {
  const key = `${name}|${colour ?? '-'}`;
  if (cache.has(key)) return cache.get(key)!;
  const l = byName.get(name);
  if (!l) return null;
  let buf = await rasterize(layerSheetSvg(l as LayerDef));
  if (colour) buf = await tint(buf, colour);
  cache.set(key, buf);
  return buf;
}

interface Cfg {
  skin: string; hair: string; top: string; bottom: string; shoes: string; cloak: string; accessory: string;
  hairStyle: string; topId: string; bottomId: string; shoesId: string; cloakId: string; accessoryId: string;
}
const BASE: Cfg = {
  skin: '#E8B98E', hair: '#5A3A22', top: '#A8603C', bottom: '#4A5B74', shoes: '#6B4A30', cloak: '#7A4A3A', accessory: '#6B4A30',
  hairStyle: 'short', topId: 'linen_tunic', bottomId: 'trousers', shoesId: 'boots', cloakId: 'none', accessoryId: 'belt_pouch',
};

/** layer name -> tint colour, in draw order, for one config */
function layerPlan(c: Cfg): Array<[string, string | null]> {
  const want = new Set([
    `cloakback_${c.cloakId}`, `hairback_${c.hairStyle}`, 'body',
    `bottom_${c.bottomId}`, `bottom_${c.bottomId}__ink`,
    `shoes_${c.shoesId}`, `shoes_${c.shoesId}__ink`, 'arms',
    `top_${c.topId}`, `top_${c.topId}__ink`,
    `accessory_${c.accessoryId}`, `accessory_${c.accessoryId}__ink`,
    'face', `hairfront_${c.hairStyle}`, `cloak_${c.cloakId}`, `cloak_${c.cloakId}__ink`,
  ]);
  const colourOf: Record<string, string> = {
    skin: c.skin, hair: c.hair, top: c.top, bottom: c.bottom, shoes: c.shoes, cloak: c.cloak, accessory: c.accessory,
  };
  return layers
    .filter((l) => want.has(l.name))
    .sort((a, b) => a.order - b.order)
    .map((l) => [l.name, l.tint ? colourOf[l.tint] : null] as [string, string | null]);
}

/** Compose one avatar sheet (full 20x4) for a config. */
async function compose(c: Cfg): Promise<Buffer> {
  const comps: OverlayOptions[] = [];
  for (const [name, colour] of layerPlan(c)) {
    const b = await sheet(name, colour);
    if (b) comps.push({ input: b, left: 0, top: 0 });
  }
  return sharp({ create: { width: COLS * FW, height: DIRS.length * FH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(comps)
    .png()
    .toBuffer();
}

const crop = (buf: Buffer, col: number, row: number) =>
  sharp(buf).extract({ left: col * FW, top: row * FH, width: FW, height: FH }).png().toBuffer();

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const comps: OverlayOptions[] = [];
  let W = 0;
  let H = 0;

  if (mode === 'hair') {
    // rows: style x direction ; cols: idle0 + 4 walk frames + 2 run frames
    const cols = [0, 4, 6, 8, 10, 12, 16];
    const rowsPerStyle = DIRS.length;
    W = cols.length * FW;
    H = HAIR_STYLES.length * rowsPerStyle * FH;
    for (let si = 0; si < HAIR_STYLES.length; si++) {
      const buf = await compose({ ...BASE, hairStyle: HAIR_STYLES[si].id, cloakId: 'none' });
      for (let d = 0; d < rowsPerStyle; d++) {
        for (let ci = 0; ci < cols.length; ci++) {
          comps.push({ input: await crop(buf, cols[ci], d), left: ci * FW, top: (si * rowsPerStyle + d) * FH });
        }
      }
    }
  } else if (mode === 'outfit') {
    const variants: Cfg[] = [];
    for (const t of TOPS) variants.push({ ...BASE, topId: t.id });
    for (const b of BOTTOMS) variants.push({ ...BASE, bottomId: b.id, topId: 'wool_tunic' });
    for (const s of SHOES) variants.push({ ...BASE, shoesId: s.id, topId: 'leather_jerkin' });
    for (const c of CLOAKS) variants.push({ ...BASE, cloakId: c.id, topId: 'wool_tunic' });
    for (const a of ACCESSORIES) variants.push({ ...BASE, accessoryId: a.id, topId: 'linen_tunic' });
    const cols = 4;
    W = variants.length * 0 + cols * FW * 2;
    const perRow = Math.floor(W / (FW * 2));
    H = Math.ceil(variants.length / perRow) * FH;
    for (let i = 0; i < variants.length; i++) {
      const buf = await compose(variants[i]);
      comps.push({ input: await crop(buf, 0, 0), left: (i % perRow) * FW * 2, top: Math.floor(i / perRow) * FH });
      comps.push({ input: await crop(buf, 8, 2), left: (i % perRow) * FW * 2 + FW, top: Math.floor(i / perRow) * FH });
    }
  } else {
    const buf = await compose({ ...BASE, hairStyle: 'long', cloakId: 'fur_cloak' });
    W = COLS * FW;
    H = DIRS.length * FH;
    comps.push({ input: buf, left: 0, top: 0 });
    console.log('columns:', Array.from({ length: COLS }, (_, i) => `${i}:${animOfColumn(i).anim}${animOfColumn(i).frame}`).join(' '));
  }

  await sharp({ create: { width: W, height: H, channels: 4, background: { r: 150, g: 165, b: 140, alpha: 255 } } })
    .composite(comps)
    .png()
    .toFile(`${out}/char_${mode}.png`);
  console.log(`${out}/char_${mode}.png ${W}x${H}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

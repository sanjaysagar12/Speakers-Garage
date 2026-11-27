/**
 * Dev tool: render a labelled contact sheet of an asset group so defects are visible at a glance.
 *   npx tsx scripts/contact.ts <group> <outDir> [cols]
 * Groups: terrain, trees, flora, structures, mountains, animals, hair, clothing, ambient, tiling
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { OverlayOptions } from 'sharp';
import { SCALE } from './art/util.js';
import { rasterize } from './art/raster.js';
import { buildTileDefs, T } from './art/terrain.js';
import { treeProps } from './art/trees.js';
import { floraProps } from './art/flora.js';
import { structureProps } from './art/structures.js';
import { mountainProps } from './art/mountains.js';
import { animalProps } from './art/animals.js';
import { ambientProps } from './art/ambient.js';
import type { PropDef } from './art/propdef.js';

const group = process.argv[2] ?? 'terrain';
const outDir = process.argv[3] ?? '.';
const colsArg = Number(process.argv[4] ?? 0);

const BG = { r: 120, g: 140, b: 120, alpha: 1 };

async function sheetFromSvgs(items: Array<{ key: string; svg: string }>, cols: number, cell: number): Promise<Buffer> {
  const rows = Math.ceil(items.length / cols);
  const comps: OverlayOptions[] = [];
  for (let i = 0; i < items.length; i++) {
    let buf = await rasterize(items[i].svg);
    const meta = await sharp(buf).metadata();
    if (meta.width! > cell || meta.height! > cell) {
      buf = await sharp(buf).resize(cell, cell, { fit: 'inside' }).png().toBuffer();
    }
    const m2 = await sharp(buf).metadata();
    comps.push({
      input: buf,
      left: (i % cols) * cell + Math.floor((cell - m2.width!) / 2),
      top: Math.floor(i / cols) * cell + (cell - m2.height!),
    });
  }
  return sharp({ create: { width: cols * cell, height: rows * cell, channels: 4, background: BG } })
    .composite(comps)
    .png()
    .toBuffer();
}

async function propSheet(props: PropDef[], cols: number): Promise<Buffer> {
  // scale every prop into a common cell so proportions are comparable
  const maxH = Math.max(...props.map((p) => p.h));
  const cell = Math.min(360, Math.max(140, Math.round(maxH * SCALE * 0.5)));
  return sheetFromSvgs(
    props.map((p) => ({ key: p.key, svg: p.svg })),
    cols,
    cell,
  );
}

/** 3x3 repeat of each tile, to expose seams. */
async function tilingSheet(): Promise<Buffer> {
  const defs = buildTileDefs().filter((d) => !/_\d+$/.test(d.key) || /^grass_\d$/.test(d.key));
  const pick = defs.filter((d) => !d.key.includes('_') || /^(grass|water)_/.test(d.key)).slice(0, 12);
  const TS = T * SCALE;
  const comps: OverlayOptions[] = [];
  const cols = 4;
  for (let i = 0; i < pick.length; i++) {
    const buf = await rasterize(pick[i].svg);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        comps.push({ input: buf, left: (i % cols) * TS * 3 + x * TS, top: Math.floor(i / cols) * TS * 3 + y * TS });
      }
    }
  }
  const rows = Math.ceil(pick.length / cols);
  return sharp({ create: { width: cols * TS * 3, height: rows * TS * 3, channels: 4, background: BG } })
    .composite(comps)
    .png()
    .toBuffer();
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  let buf: Buffer;
  let name = group;
  switch (group) {
    case 'terrain': {
      const defs = buildTileDefs();
      const base = defs.filter((d) => !/_(\d+)$/.test(d.key) || /^grass_\d$/.test(d.key));
      const blobs = ['shore', 'depth1', 'depth2', 'dirtedge', 'rockedge', 'snowedge'].flatMap((p) =>
        defs.filter((d) => d.key.startsWith(p + '_')).slice(0, 8),
      );
      buf = await sheetFromSvgs([...base, ...blobs], colsArg || 10, T * SCALE);
      break;
    }
    case 'tiling':
      buf = await tilingSheet();
      break;
    case 'trees':
      buf = await propSheet(treeProps(), colsArg || 8);
      break;
    case 'flora':
      buf = await propSheet(floraProps(), colsArg || 10);
      break;
    case 'structures':
      buf = await propSheet(structureProps(), colsArg || 7);
      break;
    case 'mountains':
      buf = await propSheet(mountainProps(), colsArg || 5);
      break;
    case 'animals':
      buf = await propSheet(animalProps(), colsArg || 8);
      break;
    case 'ambient':
      buf = await propSheet(ambientProps(), colsArg || 8);
      break;
    default:
      throw new Error('unknown group ' + group);
  }
  const file = path.join(outDir, `contact_${name}.png`);
  fs.writeFileSync(file, buf);
  const m = await sharp(buf).metadata();
  console.log(`${file}  ${m.width}x${m.height}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

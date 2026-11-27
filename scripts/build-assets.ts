/**
 * Asset pipeline: SVG art (scripts/art/*) -> PNG textures, atlases and JSON metadata in public/assets.
 * Everything renders at 2x (SCALE) so the engine can downscale for crisp edges.
 *
 *   terrain.png / tiles.json        tileset (64px tiles, 2px extruded) + tile id/kind/blob tables
 *   world.png,  world.json          atlas of normal-sized sprites (Phaser JSON hash)
 *   world_big.png, world_big.json   atlas of the oversized ones (mountains, longhouse, clouds)
 *   catalog.json                    per-sprite metadata: origin, collision, sway, layer, atlas
 *   avatar/<layer>.png              one tintable sheet per character layer (20 x 4 frames)
 *   avatar/thumbs.png + .json       one frame per option, for the customizer UI
 *   avatar.json                     slot/option/layer catalogue + frame geometry
 *   overlay_*.png                   full-screen vignette and macro-variation textures
 *
 * Skips everything when nothing under scripts/ changed; `npm run assets -- --force` rebuilds.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { SCALE } from './art/util.js';
import { rasterize, composeAtlas } from './art/raster.js';
import type { Placed } from './art/raster.js';
import { buildTileDefs, T, allBlobSignatures } from './art/terrain.js';
import { treeProps } from './art/trees.js';
import { floraProps } from './art/flora.js';
import { structureProps } from './art/structures.js';
import { mountainProps } from './art/mountains.js';
import { animalProps, ANIMAL_INFO } from './art/animals.js';
import { ambientProps, overlaySvgs } from './art/ambient.js';
import type { PropDef } from './art/propdef.js';
import { allLayers, layerSheetSvg, layerThumbSvg, avatarCatalog } from './art/character/sheets.js';
import { CW, CH, COLS, DIRS } from './art/character/rig.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public/assets');
const stampFile = path.join(root, '.generated/assets.hash');
/** sprites bigger than this on either side go to the second atlas page */
const BIG_PX = 700;

function hashSources(): string {
  const h = crypto.createHash('sha1');
  const walk = (dir: string) => {
    for (const f of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(f)) h.update(f).update(fs.readFileSync(p));
    }
  };
  walk(path.join(root, 'scripts/art'));
  h.update(fs.readFileSync(path.join(root, 'scripts/build-assets.ts')));
  return h.digest('hex');
}

const write = (rel: string, data: Buffer | string) => {
  const p = path.join(out, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
};

async function pool<A, R>(items: A[], n: number, fn: (x: A, i: number) => Promise<R>): Promise<R[]> {
  const res: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        res[k] = await fn(items[k], k);
      }
    }),
  );
  return res;
}

/* ------------------------------------------------------------------ terrain -------------- */

async function buildTileset() {
  const defs = buildTileDefs();
  const TS = T * SCALE;
  const EXT = 2;
  const SPACING = EXT * 2;
  const cell = TS + SPACING;
  const cols = 24;
  const rows = Math.ceil(defs.length / cols);
  const bufs = await pool(defs, 8, async (d) => {
    const png = await rasterize(d.svg);
    // extrude the border so linear filtering never samples the neighbouring tile
    return sharp(png).extend({ top: EXT, bottom: EXT, left: EXT, right: EXT, extendWith: 'copy' }).png().toBuffer();
  });
  const sheet = await sharp({ create: { width: cols * cell, height: rows * cell, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(bufs.map((b, i) => ({ input: b, left: (i % cols) * cell, top: Math.floor(i / cols) * cell })))
    .png({ compressionLevel: 9 })
    .toBuffer();
  write('terrain.png', sheet);

  const keyToId: Record<string, number> = {};
  defs.forEach((d, i) => (keyToId[d.key] = i));
  const blobs: Record<string, Record<string, number>> = {};
  for (const d of defs) {
    const m = /^([a-z0-9]+)_(\d+)$/.exec(d.key);
    if (!m) continue;
    const fam = m[1];
    if (!['shore', 'depth1', 'depth2', 'dirtedge', 'rockedge', 'snowedge'].includes(fam)) continue;
    (blobs[fam] ??= {})[m[2]] = keyToId[d.key];
  }
  write(
    'tiles.json',
    JSON.stringify({
      tileSize: TS,
      margin: EXT,
      spacing: SPACING,
      columns: cols,
      imageWidth: cols * cell,
      imageHeight: rows * cell,
      tiles: defs.map((d, i) => ({ id: i, key: d.key, kind: d.kind })),
      keyToId,
      blobs,
    }),
  );
  console.log(`  tileset: ${defs.length} tiles (${allBlobSignatures().length}-piece blob sets x ${Object.keys(blobs).length})`);
}

/* ------------------------------------------------------------------ world atlases -------- */

async function buildAtlases() {
  const props: PropDef[] = [
    ...treeProps(),
    ...floraProps(),
    ...structureProps(),
    ...mountainProps(),
    ...animalProps(),
    ...ambientProps(),
  ];
  const seen = new Set<string>();
  for (const p of props) {
    if (seen.has(p.key)) throw new Error(`duplicate sprite key: ${p.key}`);
    seen.add(p.key);
  }
  const rendered = await pool(props, 8, async (p) => {
    const buf = await rasterize(p.svg);
    const m = await sharp(buf).metadata();
    return { def: p, buf, w: m.width!, h: m.height! };
  });

  const small: Placed[] = [];
  const big: Placed[] = [];
  const atlasOf: Record<string, string> = {};
  for (const r of rendered) {
    const target = Math.max(r.w, r.h) > BIG_PX ? big : small;
    target.push({ name: r.def.key, buf: r.buf, w: r.w, h: r.h });
    atlasOf[r.def.key] = target === big ? 'world_big' : 'world';
  }

  for (const [name, items] of [
    ['world', small],
    ['world_big', big],
  ] as Array<[string, Placed[]]>) {
    if (!items.length) continue;
    const atlas = await composeAtlas(items, 4096);
    (atlas.json as { meta: { image: string } }).meta.image = `${name}.png`;
    write(`${name}.png`, atlas.png);
    write(`${name}.json`, JSON.stringify(atlas.json));
    console.log(`  atlas ${name}: ${items.length} sprites -> ${atlas.width}x${atlas.height}`);
  }

  const sprites: Record<string, unknown> = {};
  for (const p of props) {
    sprites[p.key] = {
      w: p.w * SCALE,
      h: p.h * SCALE,
      ox: p.ox * SCALE,
      oy: p.oy * SCALE,
      layer: p.layer,
      sway: p.sway ?? 'none',
      atlas: atlasOf[p.key],
      collide: p.collide
        ? { x: p.collide.x * SCALE, y: p.collide.y * SCALE, w: p.collide.w * SCALE, h: p.collide.h * SCALE }
        : null,
      crown: p.crown ? { key: p.crown.key, dx: p.crown.dx * SCALE, dy: p.crown.dy * SCALE } : null,
      coverRadius: p.coverRadius ? p.coverRadius * SCALE : null,
    };
  }
  write(
    'catalog.json',
    JSON.stringify({
      scale: SCALE,
      sprites,
      animals: ANIMAL_INFO.map((a) => ({
        key: a.key,
        frameW: a.frameW * SCALE,
        frameH: a.frameH * SCALE,
        collide: { x: a.collide.x * SCALE, y: a.collide.y * SCALE, w: a.collide.w * SCALE, h: a.collide.h * SCALE },
      })),
    }),
  );
}

/* ------------------------------------------------------------------ character ------------ */

async function buildAvatar() {
  const layers = allLayers();
  const sheets = await pool(layers, 6, async (l) => ({ name: l.name, buf: await rasterize(layerSheetSvg(l)) }));
  for (const s of sheets) write(`avatar/${s.name}.png`, s.buf);

  // one idle-down frame per layer, packed, for the customizer's option thumbnails
  const thumbItems: Placed[] = await pool(layers, 6, async (l) => {
    const buf = await rasterize(layerThumbSvg(l));
    const m = await sharp(buf).metadata();
    return { name: l.name, buf, w: m.width!, h: m.height! };
  });
  const thumbs = await composeAtlas(thumbItems, 2048);
  (thumbs.json as { meta: { image: string } }).meta.image = 'thumbs.png';
  write('avatar/thumbs.png', thumbs.png);
  write('avatar/thumbs.json', JSON.stringify(thumbs.json));

  const cat = avatarCatalog();
  write(
    'avatar.json',
    JSON.stringify({
      ...cat,
      frameW: CW * SCALE,
      frameH: CH * SCALE,
      cols: COLS,
      rows: DIRS.length,
      // feet sit on y = 70 of 76
      originX: 0.5,
      originY: 70 / CH,
    }),
  );
  console.log(`  character: ${layers.length} layer sheets (${COLS}x${DIRS.length} frames of ${CW * SCALE}x${CH * SCALE})`);
}

/* ------------------------------------------------------------------ overlays ------------- */

async function buildOverlays() {
  const o = overlaySvgs();
  for (const [k, svg] of Object.entries(o)) write(`${k}.png`, await rasterize(svg, 1));
  console.log(`  overlays: ${Object.keys(o).join(', ')}`);
}

/* ------------------------------------------------------------------ main ----------------- */

async function main() {
  const force = process.argv.includes('--force');
  const hash = hashSources();
  if (!force && fs.existsSync(stampFile) && fs.readFileSync(stampFile, 'utf8') === hash && fs.existsSync(path.join(out, 'world.png'))) {
    console.log('assets: up to date (npm run assets -- --force to rebuild)');
    return;
  }
  const t0 = Date.now();
  console.log('assets: building...');
  fs.mkdirSync(out, { recursive: true });
  await buildTileset();
  await buildAtlases();
  await buildAvatar();
  await buildOverlays();
  fs.mkdirSync(path.dirname(stampFile), { recursive: true });
  fs.writeFileSync(stampFile, hash);
  console.log(`assets: done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


/**
 * Dev tool: renders a top-down preview PNG of the generated map without running Phaser.
 *   npx tsx scripts/map-preview.ts <outDir> [scale] [x0 y0 x1 y1 in tiles]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import type { OverlayOptions } from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2] ?? '.';
const S = Number(process.argv[3] ?? 0.12);
const crop = process.argv.length > 7 ? process.argv.slice(4, 8).map(Number) : null;

const map = JSON.parse(fs.readFileSync(path.join(root, 'src/game/maps/vinland.json'), 'utf8'));
const tiles = JSON.parse(fs.readFileSync(path.join(root, 'public/assets/tiles.json'), 'utf8'));
const cat = JSON.parse(fs.readFileSync(path.join(root, 'public/assets/catalog.json'), 'utf8')).sprites;
const atlasJson: Record<string, { frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }> }> = {
  world: JSON.parse(fs.readFileSync(path.join(root, 'public/assets/world.json'), 'utf8')),
  world_big: JSON.parse(fs.readFileSync(path.join(root, 'public/assets/world_big.json'), 'utf8')),
};
const atlasImg: Record<string, ReturnType<typeof sharp>> = {
  world: sharp(path.join(root, 'public/assets/world.png')),
  world_big: sharp(path.join(root, 'public/assets/world_big.png')),
};
const terrain = sharp(path.join(root, 'public/assets/terrain.png'));

const TS: number = map.tilewidth;
const cell = TS + tiles.spacing;
const ts = Math.max(1, Math.round(TS * S));
const X0 = crop ? crop[0] : 0;
const Y0 = crop ? crop[1] : 0;
const X1 = crop ? crop[2] : map.width;
const Y1 = crop ? crop[3] : map.height;
const Wpx = (X1 - X0) * ts;
const Hpx = (Y1 - Y0) * ts;

const layer = (n: string) => map.layers.find((l: { name: string }) => l.name === n);
const comps: OverlayOptions[] = [];
const tileCache = new Map<number, Buffer>();

async function main() {
  const ground = layer('ground').data as number[];
  for (let y = Y0; y < Y1; y++) {
    for (let x = X0; x < X1; x++) {
      const g = ground[y * map.width + x];
      if (!g) continue;
      if (!tileCache.has(g)) {
        const id = g - 1;
        const sx = (id % tiles.columns) * cell + tiles.margin;
        const sy = Math.floor(id / tiles.columns) * cell + tiles.margin;
        tileCache.set(g, await terrain.clone().extract({ left: sx, top: sy, width: TS, height: TS }).resize(ts, ts).png().toBuffer());
      }
      comps.push({ input: tileCache.get(g)!, left: (x - X0) * ts, top: (y - Y0) * ts });
    }
  }

  interface Drawable { key: string; x: number; y: number; z: number; flip: boolean }
  const sprites: Drawable[] = [];
  for (const [name, zBase] of [
    ['objects', 0],
    ['overlay', 1e7],
  ] as Array<[string, number]>) {
    for (const o of layer(name).objects as Array<{ type: string; x: number; y: number; properties?: Array<{ name: string; value: unknown }> }>) {
      const c = cat[o.type];
      if (!c) continue;
      const flip = !!o.properties?.find((p) => p.name === 'flipX');
      sprites.push({ key: o.type, x: o.x, y: o.y, z: zBase + (c.layer === 'ground' ? -1e6 : o.y), flip });
    }
  }
  sprites.sort((a, b) => a.z - b.z);

  const sCache = new Map<string, Buffer>();
  for (const sp of sprites) {
    const c = cat[sp.key];
    const left = Math.round((sp.x - (sp.flip ? c.w - c.ox : c.ox)) * S) - X0 * ts;
    const top = Math.round((sp.y - c.oy) * S) - Y0 * ts;
    const w = Math.max(1, Math.round(c.w * S));
    const h = Math.max(1, Math.round(c.h * S));
    if (left + w < 0 || top + h < 0 || left > Wpx || top > Hpx) continue;
    const ck = sp.key + (sp.flip ? '|f' : '');
    if (!sCache.has(ck)) {
      const fr = atlasJson[c.atlas].frames[sp.key].frame;
      let img = atlasImg[c.atlas].clone().extract({ left: fr.x, top: fr.y, width: fr.w, height: fr.h });
      if (sp.flip) img = img.flop();
      sCache.set(ck, await img.resize(w, h).png().toBuffer());
    }
    comps.push({ input: sCache.get(ck)!, left, top });
  }

  const img = await sharp({ create: { width: Wpx, height: Hpx, channels: 4, background: { r: 40, g: 60, b: 50, alpha: 255 } } })
    .composite(comps.filter((c) => (c.left ?? 0) > -3000 && (c.top ?? 0) > -3000))
    .png()
    .toBuffer();
  const f = path.join(outDir, crop ? 'map_crop.png' : 'map.png');
  fs.writeFileSync(f, img);
  console.log(`${f} ${Wpx}x${Hpx}  (${sprites.length} sprites)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

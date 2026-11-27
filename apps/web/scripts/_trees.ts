// Composites trunk+canopy exactly as the engine will, on grass, with a player-sized marker for scale.
import sharp from 'sharp';
import type { OverlayOptions } from 'sharp';
import { treeProps } from './art/trees.js';
import { floraProps } from './art/flora.js';
import { rasterize } from './art/raster.js';
import { buildTileDefs, T } from './art/terrain.js';
import type { PropDef } from './art/propdef.js';

const out = process.argv[2];
const which = process.argv[3] ?? 'trees';
const S = 2;
const props: PropDef[] = which === 'flora' ? floraProps() : treeProps();
const byKey = new Map(props.map((p) => [p.key, p]));
const mains = props.filter((p) => !p.key.endsWith('_canopy'));

const cols = which === 'flora' ? 7 : 5;
const CELLW = which === 'flora' ? 200 : 360;
const CELLH = which === 'flora' ? 220 : 560;
const rows = Math.ceil(mains.length / cols);
const Wpx = cols * CELLW;
const Hpx = rows * CELLH;

const grass = await rasterize(buildTileDefs().find((d) => d.key === 'grass_0')!.svg);
const comps: OverlayOptions[] = [];
const GT = T * S;
for (let y = 0; y * GT < Hpx; y++) for (let x = 0; x * GT < Wpx; x++) comps.push({ input: grass, left: x * GT, top: y * GT });

// player reference: 56x72 logical = 112x144 px
for (let i = 0; i < mains.length; i++) {
  const t = mains[i];
  const cx = (i % cols) * CELLW + CELLW / 2;
  const cy = Math.floor(i / cols) * CELLH + CELLH - 30;
  comps.push({ input: { create: { width: 112, height: 144, channels: 4, background: '#cf4a4a' } }, left: Math.round(cx + 40), top: Math.round(cy - 144) });
  comps.push({ input: await rasterize(t.svg), left: Math.round(cx - t.ox * S), top: Math.round(cy - t.oy * S) });
  if (t.crown) {
    const c = byKey.get(t.crown.key)!;
    comps.push({ input: await rasterize(c.svg), left: Math.round(cx + t.crown.dx * S - c.ox * S), top: Math.round(cy + t.crown.dy * S - c.oy * S) });
  }
}
const clipped = comps.filter((c) => (c.left ?? 0) > -4000 && (c.top ?? 0) > -4000);
await sharp({ create: { width: Wpx, height: Hpx, channels: 4, background: '#7FA85C' } })
  .composite(clipped)
  .png()
  .toFile(`${out}/${which}.png`);
console.log(`${which}: ${mains.map((t) => t.key).join(' ')}  ${Wpx}x${Hpx}`);

import sharp from 'sharp';
import { SCALE, hexToRgb } from './util.js';

/** Rasterize an SVG string at SCALE x, returning a PNG buffer. */
export async function rasterize(svg: string, scale = SCALE): Promise<Buffer> {
  return sharp(Buffer.from(svg), { density: 72 * scale }).png().toBuffer();
}

export async function raw(buf: Buffer): Promise<{ data: Buffer; w: number; h: number }> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/** Multiply-tint an RGBA PNG buffer with a colour, preserving alpha. */
export async function tint(buf: Buffer, hex: string): Promise<Buffer> {
  const { data, w, h } = await raw(buf);
  const [r, g, b] = hexToRgb(hex);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (data[i] * r) / 255;
    data[i + 1] = (data[i + 1] * g) / 255;
    data[i + 2] = (data[i + 2] * b) / 255;
  }
  return sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

export interface Placed {
  name: string;
  buf: Buffer;
  w: number;
  h: number;
}

export interface PackedFrame {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Simple shelf packer with padding (padding avoids bleeding when linear-filtered/zoomed). */
export function pack(items: Placed[], maxW: number, pad = 4): { frames: PackedFrame[]; width: number; height: number } {
  const sorted = [...items].sort((a, b) => b.h - a.h || b.w - a.w);
  const frames: PackedFrame[] = [];
  let x = pad;
  let y = pad;
  let rowH = 0;
  let width = 0;
  for (const it of sorted) {
    if (x + it.w + pad > maxW) {
      x = pad;
      y += rowH + pad;
      rowH = 0;
    }
    frames.push({ name: it.name, x, y, w: it.w, h: it.h });
    x += it.w + pad;
    rowH = Math.max(rowH, it.h);
    width = Math.max(width, x);
  }
  const height = y + rowH + pad;
  const pot = (n: number) => 2 ** Math.ceil(Math.log2(n));
  return { frames, width: pot(width), height: pot(height) };
}

export async function composeAtlas(
  items: Placed[],
  maxW: number,
): Promise<{ png: Buffer; json: unknown; width: number; height: number }> {
  const { frames, width, height } = pack(items, maxW);
  const byName = new Map(items.map((i) => [i.name, i]));
  const png = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(frames.map((f) => ({ input: byName.get(f.name)!.buf, left: f.x, top: f.y })))
    .png({ compressionLevel: 9 })
    .toBuffer();
  const json = {
    frames: Object.fromEntries(
      frames.map((f) => [
        f.name,
        {
          frame: { x: f.x, y: f.y, w: f.w, h: f.h },
          rotated: false,
          trimmed: false,
          spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h },
          sourceSize: { w: f.w, h: f.h },
        },
      ]),
    ),
    meta: { app: 'shoreline build-assets', version: '1.0', image: '', format: 'RGBA8888', size: { w: width, h: height }, scale: 1 },
  };
  return { png, json, width, height };
}

/**
 * Watercolour / gouache primitives.
 *
 * Everything is authored as SVG and rasterised by librsvg (via sharp), which supports feTurbulence,
 * feDisplacementMap and feMorphology — the three filters the painterly look needs:
 *   - displacement turns geometric edges into wobbly, brush-like ones
 *   - morphology + blur gives the dark pigment ring watercolour leaves at the edge of a wash
 *   - turbulence again, at high frequency, gives paper grain and speckle splatter
 *
 * Use `Art` to accumulate <defs> and body markup without threading ids around by hand.
 */
import { hexToRgb, shade, mix } from './util.js';

let seq = 0;
export const nid = (p = 'x'): string => `${p}${(seq += 1).toString(36)}`;

/**
 * Seamless tiles need the noise to be periodic. feTurbulence does that with stitchTiles="stitch",
 * but only when the filter region is exactly the tile — hence TILE_REGION and the `stitch` flag.
 */
export const TILE_REGION = { x: 0, y: 0, w: 32, h: 32 };
const regionAttrs = (stitch: boolean | undefined, pad: number): string =>
  stitch
    ? `x="${TILE_REGION.x}" y="${TILE_REGION.y}" width="${TILE_REGION.w}" height="${TILE_REGION.h}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse"`
    : `x="-${pad}%" y="-${pad}%" width="${100 + pad * 2}%" height="${100 + pad * 2}%"`;
const stitchAttr = (stitch?: boolean): string => (stitch ? ' stitchTiles="stitch"' : '');

export interface WashOpts {
  /** displacement amount in px: how ragged the edge is */
  wobble?: number;
  /** turbulence base frequency: low = big lazy waves, high = fine fuzz */
  freq?: number;
  octaves?: number;
  seed?: number;
  /** inner edge darkening strength (0 = off) */
  edge?: number;
  /** how far the edge ring reaches inward, px */
  edgeWidth?: number;
  /** colour of the edge ring; defaults to a darker version of the fill */
  edgeColor?: string;
  /** clamp the filter to one tile and make the noise periodic (for seamless terrain) */
  stitch?: boolean;
}

export class Art {
  private readonly defsParts: string[] = [];
  private readonly bodyParts: string[] = [];

  def(markup: string): void {
    this.defsParts.push(markup);
  }
  add(markup: string): void {
    this.bodyParts.push(markup);
  }
  /** wrap everything added so far in a group (used for filters applied to a whole layer) */
  wrapAll(open: string, close = '</g>'): void {
    const inner = this.bodyParts.splice(0, this.bodyParts.length).join('');
    this.bodyParts.push(open + inner + close);
  }
  get defs(): string {
    return this.defsParts.join('');
  }
  get body(): string {
    return this.bodyParts.join('');
  }
  svg(w: number, h: number, extraAttrs = ''): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"${extraAttrs ? ' ' + extraAttrs : ''}>${
      this.defsParts.length ? `<defs>${this.defs}</defs>` : ''
    }${this.body}</svg>`;
  }

  /**
   * A watercolour wash filter: ragged displaced edge + optional inner pigment ring.
   * Returns the filter id; apply it to a <g> holding flat shapes.
   */
  washFilter(o: WashOpts = {}): string {
    const id = nid('w');
    const wobble = o.wobble ?? 3.2;
    const freq = o.freq ?? 0.035;
    const octaves = o.octaves ?? 3;
    const seed = o.seed ?? Math.floor(Math.random() * 9000);
    const edge = o.edge ?? 0.3;
    const ew = o.edgeWidth ?? 1.6;
    const [er, eg, eb] = hexToRgb(o.edgeColor ?? '#2b2118');
    let f = `<filter id="${id}" ${regionAttrs(o.stitch, 30)} color-interpolation-filters="sRGB">`;
    f += `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${octaves}" seed="${seed}"${stitchAttr(o.stitch)} result="n"/>`;
    f += `<feDisplacementMap in="SourceGraphic" in2="n" scale="${wobble}" xChannelSelector="R" yChannelSelector="G" result="sh"/>`;
    if (edge > 0) {
      f += `<feMorphology in="sh" operator="erode" radius="${ew}" result="inner"/>`;
      f += `<feComposite in="sh" in2="inner" operator="out" result="ring"/>`;
      f += `<feGaussianBlur in="ring" stdDeviation="${(ew * 0.75).toFixed(2)}" result="rs"/>`;
      f += `<feColorMatrix in="rs" type="matrix" values="0 0 0 0 ${(er / 255).toFixed(3)} 0 0 0 0 ${(eg / 255).toFixed(3)} 0 0 0 0 ${(eb / 255).toFixed(3)} 0 0 0 ${edge.toFixed(2)} 0" result="rc"/>`;
      f += `<feComposite in="rc" in2="sh" operator="in" result="rim"/>`;
      f += `<feMerge><feMergeNode in="sh"/><feMergeNode in="rim"/></feMerge>`;
    }
    f += `</filter>`;
    this.def(f);
    return id;
  }

  /** Paper grain applied multiplicatively to whatever the filter is attached to. */
  grainFilter(strength = 0.26, freq = 0.75, seed = 11, stitch?: boolean): string {
    const id = nid('g');
    const lo = (1 - strength).toFixed(3);
    this.def(
      `<filter id="${id}" ${regionAttrs(stitch, 0)} color-interpolation-filters="sRGB">` +
        `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="3" seed="${seed}"${stitchAttr(stitch)} result="n"/>` +
        `<feColorMatrix in="n" type="saturate" values="0" result="ng"/>` +
        // squeeze the noise into [lo, 1] so it only ever darkens a little
        `<feComponentTransfer in="ng" result="nt"><feFuncR type="linear" slope="${strength}" intercept="${lo}"/>` +
        `<feFuncG type="linear" slope="${strength}" intercept="${lo}"/><feFuncB type="linear" slope="${strength}" intercept="${lo}"/>` +
        `<feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer>` +
        `<feComposite in="SourceGraphic" in2="nt" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="m"/>` +
        `<feComposite in="m" in2="SourceGraphic" operator="in"/>` +
        `</filter>`,
    );
    return id;
  }

  /** Soft blur, for pigment bleed and mist. */
  blurFilter(sd: number): string {
    const id = nid('b');
    this.def(
      `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`,
    );
    return id;
  }

  /**
   * Thresholded turbulence → scattered flecks of `color`. Used for foam speckle, flower fields and pollen.
   * `density` 0..1 (higher = more flecks), `size` controls the blob scale.
   */
  speckleFilter(color: string, density = 0.5, size = 0.3, seed = 5, stitch?: boolean): string {
    const id = nid('s');
    const [r, g, b] = hexToRgb(color);
    const cut = 1 - density;
    this.def(
      `<filter id="${id}" ${regionAttrs(stitch, 0)} color-interpolation-filters="sRGB">` +
        `<feTurbulence type="fractalNoise" baseFrequency="${size}" numOctaves="2" seed="${seed}"${stitchAttr(stitch)} result="n"/>` +
        `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="a"/>` +
        // hard threshold: everything below `cut` disappears, above becomes solid
        `<feComponentTransfer in="a" result="t"><feFuncA type="linear" slope="${(1 / Math.max(0.02, 1 - cut)).toFixed(2)}" intercept="${(-cut / Math.max(0.02, 1 - cut)).toFixed(2)}"/></feComponentTransfer>` +
        `<feColorMatrix in="t" type="matrix" values="0 0 0 0 ${(r / 255).toFixed(3)} 0 0 0 0 ${(g / 255).toFixed(3)} 0 0 0 0 ${(b / 255).toFixed(3)} 0 0 0 1 0" result="c"/>` +
        `<feComposite in="c" in2="SourceGraphic" operator="in"/>` +
        `</filter>`,
    );
    return id;
  }

  /** A soft cool-blue cast shadow blob, offset down-right. Call before drawing the object. */
  castShadow(cx: number, cy: number, rx: number, ry: number, opacity: number, blur = 3): void {
    const f = this.blurFilter(blur);
    this.add(
      `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="#2A4A5E" opacity="${opacity}" filter="url(#${f})"/>`,
    );
  }
}

/** A painterly polygon/path: base wash plus 1-3 tonal washes, all behind one displacement filter. */
export function washShape(
  art: Art,
  d: string,
  color: string,
  o: WashOpts & { tones?: Array<{ d: string; shade: number; alpha?: number }>; opacity?: number } = {},
): void {
  const f = art.washFilter({ edgeColor: shade(color, -0.55), ...o });
  let inner = `<path d="${d}" fill="${color}"/>`;
  for (const t of o.tones ?? []) {
    inner += `<path d="${t.d}" fill="${shade(color, t.shade)}" opacity="${t.alpha ?? 0.75}"/>`;
  }
  art.add(`<g filter="url(#${f})"${o.opacity !== undefined ? ` opacity="${o.opacity}"` : ''}>${inner}</g>`);
}

/** Irregular blob path around a centre — the workhorse for foliage clusters, rocks and stones. */
export function blobPath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rnd: () => number,
  points = 9,
  jitter = 0.22,
): string {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const j = 1 - jitter + rnd() * jitter * 2;
    pts.push([cx + Math.cos(a) * rx * j, cy + Math.sin(a) * ry * j]);
  }
  // Catmull-Rom through the points → closed smooth path
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[(i - 1 + pts.length) % pts.length];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];
    const p3 = pts[(i + 2) % pts.length];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d + 'Z';
}

/**
 * A leafy cluster: irregular blob with a bumpy, lobed silhouette (so canopies never read as circles).
 * `lobes` controls how many bumps the outline has.
 */
export function leafCluster(cx: number, cy: number, r: number, rnd: () => number, lobes = 7, bump = 1.09): string {
  const pts: Array<[number, number]> = [];
  const n = lobes * 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.2;
    const rr = (i % 2 === 0 ? 1 : 0.84 + rnd() * 0.12) * r * (0.84 + rnd() * 0.3);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.88]);
  }
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];
    const mx = (p1[0] + p2[0]) / 2;
    const my = (p1[1] + p2[1]) / 2;
    const push = i % 2 === 0 ? bump : 2 - bump;
    d += ` Q${((mx - cx) * push + cx).toFixed(1)} ${((my - cy) * push + cy).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d + 'Z';
}

/** Brush stroke along a polyline: tapered, slightly wobbly. */
export function stroke(pts: Array<[number, number]>, w0: number, w1: number): string {
  const top: string[] = [];
  const bot: string[] = [];
  for (let i = 0; i < pts.length; i++) {
    const t = i / (pts.length - 1);
    const w = w0 + (w1 - w0) * t;
    const p = pts[i];
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l;
    const ny = dx / l;
    top.push(`${(p[0] + nx * w).toFixed(1)},${(p[1] + ny * w).toFixed(1)}`);
    bot.unshift(`${(p[0] - nx * w).toFixed(1)},${(p[1] - ny * w).toFixed(1)}`);
  }
  return `M${top.join(' L')} L${bot.join(' L')} Z`;
}

export { shade, mix };

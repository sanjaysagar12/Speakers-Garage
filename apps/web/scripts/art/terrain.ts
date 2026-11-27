/**
 * Vinland terrain tiles, painted in watercolour.
 *
 * Tiles are 64 logical px (128 px at 2x) and must tile seamlessly, so:
 *   - every filter region is exactly the tile and every feTurbulence uses stitchTiles="stitch",
 *     which makes the noise periodic with the tile;
 *   - shapes that cross an edge are also drawn wrapped at ±T, so the two halves line up.
 *
 * Transitions (land→water, shallow→mid, mid→deep) use a 47-piece "blob" autotile indexed by an
 * 8-neighbour mask, so shorelines and depth contours read as organic curves rather than steps.
 */
import { Art, blobPath, stroke, nid } from './wc.js';
import { P } from './palette.js';
import { rng, shade, mix } from './util.js';

export const T = 32;
/**
 * Art is authored against a 64px reference tile; K rescales every length and count to the real tile
 * size. Tiles are deliberately small (32 logical = 64 world px) because the blob autotile can only
 * turn a coastline in whole-tile steps — halving the tile halves the staircase on diagonal shores.
 */
const K = T / 64;
const KA = K * K;
const n = (v: number) => Math.max(1, Math.round(v * KA));

export interface TileDef {
  key: string;
  kind: string;
  svg: string;
}

/* ------------------------------------------------------------------ blob autotile ------- */

export function allBlobSignatures(): number[] {
  const out: number[] = [];
  for (let c = 0; c < 16; c++) {
    const n = !!(c & 1), e = !!(c & 2), s = !!(c & 4), w = !!(c & 8);
    const valid = [!n && !e, !s && !e, !s && !w, !n && !w];
    const idxs = valid.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    for (let m = 0; m < 1 << idxs.length; m++) {
      let sig = c;
      idxs.forEach((di, bi) => {
        if (m & (1 << bi)) sig |= 16 << di;
      });
      out.push(sig);
    }
  }
  return out; // 47
}

export function blobSignature(n: boolean, e: boolean, s: boolean, w: boolean, ne: boolean, se: boolean, sw: boolean, nw: boolean): number {
  let sig = (n ? 1 : 0) | (e ? 2 : 0) | (s ? 4 : 0) | (w ? 8 : 0);
  if (ne && !n && !e) sig |= 16;
  if (se && !s && !e) sig |= 32;
  if (sw && !s && !w) sig |= 64;
  if (nw && !n && !w) sig |= 128;
  return sig;
}

/**
 * How far the `over` material reaches in from one edge, as a function of position along that edge.
 *
 * Every harmonic is an integer multiple of 2*pi/T, so the profile is exactly periodic with the tile:
 * two tiles sharing an edge evaluate the same value there and the boundary meets seamlessly. Doing
 * the wobble as geometry rather than as a displacement filter matters -- a filter's region has to be
 * the tile for its noise to stay periodic, and it then samples transparency just outside the border
 * and bites notches out of the edge.
 */
function edgeProfile(band: number, phase: number): (t: number) => number {
  // No first harmonic. The profile's period is exactly one tile, so a k=1 term puts one clean
  // scallop in every tile and the coastline reads as a repeating row of bubbles. Starting at k=2
  // gives two or three differently sized bumps per tile, which passes for fine coastline detail;
  // the large-scale shape comes from the map's own outline.
  const amp = [0.19, 0.11, 0.06];
  const harm = [2, 3, 5];
  return (t: number) => {
    let v = band;
    for (let i = 0; i < amp.length; i++) {
      v += band * amp[i] * Math.sin((2 * Math.PI * harm[i] * t) / T + phase * (i + 1) * 1.73 + i * 2.1);
    }
    return v;
  };
}

type Side = 'N' | 'E' | 'S' | 'W';
type Profiles = Record<Side, (t: number) => number>;
const OVER = 24 * K; // how far geometry runs past the tile, so neighbouring bands always overlap

/** Closed polygon for the band intruding from one side, following that side's wavy profile. */
function bandPath(side: Side, f: (t: number) => number, delta: number): string {
  const step = Math.max(0.5, T / 48);
  const pts: Array<[number, number]> = [];
  for (let t = -OVER; t <= T + OVER + 0.001; t += step) {
    const d = f(t) + delta;
    if (side === 'N') pts.push([t, d]);
    else if (side === 'S') pts.push([t, T - d]);
    else if (side === 'W') pts.push([d, t]);
    else pts.push([T - d, t]);
  }
  const tail: Array<[number, number]> =
    side === 'N'
      ? [[T + OVER, -OVER], [-OVER, -OVER]]
      : side === 'S'
        ? [[T + OVER, T + OVER], [-OVER, T + OVER]]
        : side === 'W'
          ? [[-OVER, T + OVER], [-OVER, -OVER]]
          : [[T + OVER, T + OVER], [T + OVER, -OVER]];
  return `M${[...pts, ...tail].map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L')} Z`;
}

const SIDES: Side[] = ['N', 'E', 'S', 'W'];
/** diagonal bit -> the two cardinal sides whose bands intersect to form that corner patch */
const DIAG: Array<[number, Side, Side]> = [
  [16, 'N', 'E'],
  [32, 'S', 'E'],
  [64, 'S', 'W'],
  [128, 'N', 'W'],
];

/**
 * White-painted region (for use inside a <mask>) covering the part of the tile the `over` material
 * takes. `delta` grows or shrinks it, which is how the foam ring and the spray band are derived.
 */
function blobRegion(art: Art, sig: number, profiles: Profiles, delta: number, white: boolean): string {
  const fill = white ? '#fff' : '#000';
  let out = '';
  SIDES.forEach((side, i) => {
    if (sig & (1 << i)) out += `<path d="${bandPath(side, profiles[side], delta)}" fill="${fill}"/>`;
  });
  for (const [bit, a, b] of DIAG) {
    if (!(sig & bit)) continue;
    // Corner patch = the two (absent) neighbouring bands intersected. Its reach along each edge then
    // equals the band the adjacent tile draws there, which is what makes the corner case line up.
    const clip = nid('cp');
    art.def(`<clipPath id="${clip}" clipPathUnits="userSpaceOnUse"><path d="${bandPath(b, profiles[b], delta)}"/></clipPath>`);
    out += `<g clip-path="url(#${clip})"><path d="${bandPath(a, profiles[a], delta)}" fill="${fill}"/></g>`;
  }
  return out;
}


/* ------------------------------------------------------------------ ground painting ------ */

interface GroundOpts {
  mottle?: Array<{ color: string; count: number; r: number; alpha: number }>;
  /** diagonal brush strokes, the "flow" of the ground (degrees) */
  flow?: { color: string; count: number; alpha: number; len: number; w: number; angle?: number };
  speck?: { color: string; density: number; size: number; alpha: number };
  grain?: number;
  seed: number;
}

/** Base wash + tonal mottling + diagonal brush flow + paper grain, tileable. */
function ground(base: string, o: GroundOpts): string {
  const art = new Art();
  const r = rng(o.seed);
  art.add(`<rect x="0" y="0" width="${T}" height="${T}" fill="${base}"/>`);

  for (const m of o.mottle ?? []) {
    const f = art.washFilter({ wobble: 2.6 * K, freq: 0.05 / K, seed: Math.floor(r() * 9000), edge: 0, stitch: true });
    let inner = '';
    for (let i = 0, mc = n(m.count); i < mc; i++) {
      const x = r() * T;
      const y = r() * T;
      const rx = m.r * K * (0.6 + r() * 0.8);
      const ry = m.r * K * (0.4 + r() * 0.6);
      const rot = (r() * 60 - 30 + 28).toFixed(0);
      for (const dx of [-T, 0, T]) {
        for (const dy of [-T, 0, T]) {
          if (x + dx < -rx * 2 || x + dx > T + rx * 2 || y + dy < -ry * 2 || y + dy > T + ry * 2) continue;
          inner += `<ellipse cx="${(x + dx).toFixed(1)}" cy="${(y + dy).toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" transform="rotate(${rot} ${(x + dx).toFixed(1)} ${(y + dy).toFixed(1)})"/>`;
        }
      }
    }
    art.add(`<g fill="${m.color}" opacity="${m.alpha}" filter="url(#${f})">${inner}</g>`);
  }

  if (o.flow) {
    const fl = o.flow;
    const ang = ((fl.angle ?? 28) * Math.PI) / 180;
    const f = art.washFilter({ wobble: 1.8 * K, freq: 0.08 / K, seed: Math.floor(r() * 9000), edge: 0, stitch: true });
    let inner = '';
    for (let i = 0, fc = n(fl.count); i < fc; i++) {
      const x = r() * T;
      const y = r() * T;
      const len = fl.len * K * (0.6 + r() * 0.8);
      const jitter = (r() - 0.5) * 0.25;
      const pts: Array<[number, number]> = [];
      for (let k = 0; k <= 4; k++) {
        const t = (k / 4 - 0.5) * len;
        pts.push([Math.cos(ang + jitter) * t, Math.sin(ang + jitter) * t + Math.sin(k * 1.3) * 0.6]);
      }
      const d = stroke(pts, fl.w * K * 0.35, fl.w * K);
      for (const dx of [-T, 0, T]) {
        for (const dy of [-T, 0, T]) {
          if (x + dx < -len || x + dx > T + len || y + dy < -len || y + dy > T + len) continue;
          inner += `<path d="${d}" transform="translate(${(x + dx).toFixed(1)} ${(y + dy).toFixed(1)})"/>`;
        }
      }
    }
    art.add(`<g fill="${fl.color}" opacity="${fl.alpha}" filter="url(#${f})">${inner}</g>`);
  }

  if (o.speck) {
    const sp = o.speck;
    const f = art.speckleFilter(sp.color, sp.density, sp.size / K, Math.floor(r() * 90), true);
    art.add(`<rect x="0" y="0" width="${T}" height="${T}" filter="url(#${f})" opacity="${sp.alpha}"/>`);
  }

  if (o.grain !== 0) {
    const g = art.grainFilter(o.grain ?? 0.2, 0.8 / K, Math.floor(r() * 90), true);
    art.wrapAll(`<g filter="url(#${g})">`);
  }
  return art.svg(T, T);
}

/* ------------------------------------------------------------------ tiles ---------------- */

// Variants stay close in tone: a visible brightness step between them turns a meadow into a quilt.
const grassTile = (i: number): string =>
  ground([P.grass, '#82AA5F', '#7CA659', '#85AC63'][i], {
    seed: 100 + i * 37,
    mottle: [
      { color: P.grassDeep, count: 3, r: 26, alpha: 0.09 },
      { color: P.grassLight, count: 3, r: 24, alpha: 0.1 },
    ],
    flow: { color: P.grassDeep, count: 44, alpha: 0.22, len: 10, w: 0.75 },
    speck: { color: P.grassLight, density: 0.17, size: 0.42, alpha: 0.3 },
    grain: 0.18,
  });

const tallGrassTile = (): string =>
  ground(P.grassMid, {
    seed: 311,
    mottle: [
      { color: P.grassDeep, count: 8, r: 12, alpha: 0.3 },
      { color: P.grass, count: 6, r: 10, alpha: 0.32 },
    ],
    flow: { color: P.grassLight, count: 52, alpha: 0.45, len: 19, w: 1.3, angle: 24 },
    speck: { color: P.grassLight, density: 0.2, size: 0.5, alpha: 0.45 },
    grain: 0.18,
  });

function flowerGrassTile(): string {
  const base = grassTile(0).replace(/<\/svg>$/, '');
  const r = rng(707);
  let s = '';
  for (let i = 0, fc = n(22); i < fc; i++) {
    const x = r() * T;
    const y = r() * T;
    const c = [P.flowerWhite, P.flowerYellow, P.flowerPink, P.flowerBlue][Math.floor(r() * 4)];
    for (const dx of [-T, 0, T]) {
      for (const dy of [-T, 0, T]) {
        if (x + dx < -4 || x + dx > T + 4 || y + dy < -4 || y + dy > T + 4) continue;
        s += `<circle cx="${(x + dx).toFixed(1)}" cy="${(y + dy).toFixed(1)}" r="${((0.9 + r() * 0.9) * Math.max(0.7, K)).toFixed(1)}" fill="${c}" opacity="0.92"/>`;
      }
    }
  }
  return `${base}${s}</svg>`;
}

const dirtTile = (): string =>
  ground(P.dirt, {
    seed: 420,
    mottle: [
      { color: P.dirtDark, count: 8, r: 12, alpha: 0.3 },
      { color: shade(P.dirt, 0.2), count: 6, r: 10, alpha: 0.28 },
    ],
    flow: { color: P.dirtDark, count: 16, alpha: 0.24, len: 15, w: 1.2 },
    speck: { color: P.gravel, density: 0.1, size: 0.6, alpha: 0.5 },
    grain: 0.22,
  });

const mudTile = (): string =>
  ground(mix(P.mud, P.dirt, 0.4), {
    seed: 421,
    mottle: [
      { color: P.mudDark, count: 8, r: 13, alpha: 0.3 },
      { color: shade(P.mud, 0.34), count: 6, r: 9, alpha: 0.34 },
    ],
    flow: { color: '#7A6148', count: 12, alpha: 0.24, len: 14, w: 1.6 },
    speck: { color: '#9C8468', density: 0.08, size: 0.7, alpha: 0.4 },
    grain: 0.22,
  });

/** Ploughed farm soil: strong diagonal furrows with lit crests and dark troughs. */
function soilTile(): string {
  const art = new Art();
  const r = rng(515);
  art.add(`<rect x="0" y="0" width="${T}" height="${T}" fill="${P.soil}"/>`);
  const f = art.washFilter({ wobble: 2.0 * K, freq: 0.07 / K, seed: 71, edge: 0, stitch: true });
  const ang = (28 * Math.PI) / 180;
  const step = 7.5 * K;
  let dark = '';
  let light = '';
  // furrows perpendicular to the flow direction, repeated far enough to cover the rotated tile
  const kn = Math.ceil(14 / K);
  for (let k = -kn; k <= kn; k++) {
    const off = k * step;
    const nx = Math.cos(ang + Math.PI / 2) * off;
    const ny = Math.sin(ang + Math.PI / 2) * off;
    const pts: Array<[number, number]> = [];
    for (let t = -1.4; t <= 1.4; t += 0.35) {
      pts.push([T / 2 + nx + Math.cos(ang) * T * t, T / 2 + ny + Math.sin(ang) * T * t + Math.sin(t * 4 + k) * 0.8 * K]);
    }
    dark += `<path d="${stroke(pts, 2.0 * K, 2.0 * K)}"/>`;
    const lp = pts.map(([x, y]) => [x + Math.cos(ang + Math.PI / 2) * 2.6 * K, y + Math.sin(ang + Math.PI / 2) * 2.6 * K] as [number, number]);
    light += `<path d="${stroke(lp, 1.1 * K, 1.1 * K)}"/>`;
  }
  art.add(`<g fill="${P.mudDark}" opacity="0.5" filter="url(#${f})">${dark}</g>`);
  art.add(`<g fill="${shade(P.soil, 0.26)}" opacity="0.42" filter="url(#${f})">${light}</g>`);
  const sp = art.speckleFilter(P.gravel, 0.08, 0.7 / K, 12, true);
  art.add(`<rect x="0" y="0" width="${T}" height="${T}" filter="url(#${sp})" opacity="0.45"/>`);
  void r;
  const g = art.grainFilter(0.22, 0.8 / K, 31, true);
  art.wrapAll(`<g filter="url(#${g})">`);
  return art.svg(T, T);
}

/** Standing crop: dense leaning stalks with grain heads, packed tight enough to hide the soil. */
function cropTile(color: string, headColor: string, seed: number): string {
  const art = new Art();
  const r = rng(seed);
  art.add(`<rect x="0" y="0" width="${T}" height="${T}" fill="${shade(color, -0.42)}"/>`);
  // soft underpainting so gaps between stalks read as shaded crop, not bare soil
  const uf = art.washFilter({ wobble: 2.4 * K, freq: 0.05 / K, seed: seed + 11, edge: 0, stitch: true });
  let under = '';
  for (let i = 0, uc = n(9); i < uc; i++) {
    const x = r() * T;
    const y = r() * T;
    for (const dx of [-T, 0, T]) {
      for (const dy of [-T, 0, T]) {
        if (x + dx < -18 || x + dx > T + 18 || y + dy < -18 || y + dy > T + 18) continue;
        under += `<ellipse cx="${(x + dx).toFixed(1)}" cy="${(y + dy).toFixed(1)}" rx="${((9 + r() * 7) * K).toFixed(1)}" ry="${((7 + r() * 5) * K).toFixed(1)}"/>`;
      }
    }
  }
  art.add(`<g fill="${shade(color, -0.2)}" opacity="0.8" filter="url(#${uf})">${under}</g>`);

  const f = art.washFilter({ wobble: 0.9 * K, freq: 0.12 / K, seed: seed + 3, edge: 0, stitch: true });
  const lean = (16 * Math.PI) / 180;
  // draw back-to-front in bands so nearer stalks overlap farther ones
  let stalks = '';
  let heads = '';
  const N = n(260);
  const items: Array<{ x: number; y: number; h: number; lx: number; tone: number }> = [];
  for (let i = 0; i < N; i++) {
    const x = r() * T;
    const y = r() * T;
    const h = (12 + r() * 8) * Math.max(0.62, K);
    items.push({ x, y, h, lx: Math.sin(lean + (r() - 0.5) * 0.35) * h, tone: r() });
  }
  items.sort((a, b) => a.y - b.y);
  for (const it of items) {
    for (const dx of [-T, 0, T]) {
      for (const dy of [-T, 0, T]) {
        const px = it.x + dx;
        const py = it.y + dy;
        if (px < -14 || px > T + 14 || py < -24 || py > T + 24) continue;
        const col = it.tone > 0.66 ? shade(color, 0.16) : it.tone > 0.33 ? color : shade(color, -0.16);
        stalks += `<path fill="${col}" d="${stroke(
          [
            [px, py],
            [px + it.lx * 0.45, py - it.h * 0.5],
            [px + it.lx, py - it.h],
          ],
          0.7 * Math.max(0.62, K),
          0.34 * Math.max(0.62, K),
        )}"/>`;
        heads += `<ellipse cx="${(px + it.lx).toFixed(1)}" cy="${(py - it.h).toFixed(1)}" rx="${(1.25 * Math.max(0.62, K)).toFixed(2)}" ry="${(2.4 * Math.max(0.62, K)).toFixed(2)}" fill="${it.tone > 0.5 ? headColor : shade(headColor, -0.14)}" transform="rotate(${((lean * 180) / Math.PI).toFixed(0)} ${(px + it.lx).toFixed(1)} ${(py - it.h).toFixed(1)})"/>`;
      }
    }
  }
  art.add(`<g filter="url(#${f})">${stalks}${heads}</g>`);
  const g = art.grainFilter(0.16, 0.8 / K, seed, true);
  art.wrapAll(`<g filter="url(#${g})">`);
  return art.svg(T, T);
}

const rockyTile = (): string =>
  ground(P.rock, {
    seed: 808,
    mottle: [
      { color: P.rockDeep, count: 9, r: 13, alpha: 0.34 },
      { color: P.rockLight, count: 7, r: 10, alpha: 0.3 },
    ],
    flow: { color: P.rockDeep, count: 12, alpha: 0.26, len: 17, w: 1.5, angle: 32 },
    speck: { color: P.rockLight, density: 0.12, size: 0.55, alpha: 0.5 },
    grain: 0.26,
  });

const gravelTile = (): string =>
  ground(mix(P.gravel, P.rockLight, 0.45), {
    seed: 809,
    mottle: [
      { color: P.rockDark, count: 7, r: 9, alpha: 0.24 },
      { color: '#C2C0BC', count: 8, r: 8, alpha: 0.32 },
    ],
    speck: { color: P.rockDeep, density: 0.22, size: 0.75, alpha: 0.4 },
    grain: 0.22,
  });

const snowTile = (): string =>
  ground(P.snow, {
    seed: 900,
    mottle: [
      { color: P.snowShade, count: 8, r: 13, alpha: 0.4 },
      { color: '#FFFFFF', count: 6, r: 10, alpha: 0.7 },
    ],
    flow: { color: P.snowShade, count: 10, alpha: 0.25, len: 16, w: 1.4 },
    grain: 0.1,
  });

const snowRockTile = (): string =>
  ground(mix(P.snow, P.rock, 0.45), {
    seed: 901,
    mottle: [
      { color: P.rockDark, count: 9, r: 12, alpha: 0.42 },
      { color: P.snow, count: 7, r: 11, alpha: 0.62 },
    ],
    flow: { color: P.rockDeep, count: 10, alpha: 0.3, len: 15, w: 1.5, angle: 32 },
    grain: 0.18,
  });

/** Stone path: flat laid stones with mossy gaps. */
function stonePathTile(): string {
  const art = new Art();
  const r = rng(555);
  art.add(`<rect x="0" y="0" width="${T}" height="${T}" fill="${shade(P.dirtDark, -0.1)}"/>`);
  const f = art.washFilter({ wobble: 2.2 * K, freq: 0.06 / K, seed: 44, edge: 0.34, edgeWidth: 1.6 * K, edgeColor: '#3A3129', stitch: true });
  let stones = '';
  const cells = 3;
  const cs = T / cells;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const cx = (i + 0.5) * cs + (r() - 0.5) * 7;
      const cy = (j + 0.5) * cs + (r() - 0.5) * 7;
      const col = mix(P.stone, r() > 0.5 ? P.rockLight : P.stoneDark, r() * 0.6);
      const d = blobPath(cx, cy, cs * 0.44 + r() * 2, cs * 0.4 + r() * 2, r, 8, 0.2);
      for (const dx of [-T, 0, T]) {
        for (const dy of [-T, 0, T]) {
          if (cx + dx < -cs || cx + dx > T + cs || cy + dy < -cs || cy + dy > T + cs) continue;
          stones += `<g transform="translate(${dx} ${dy})"><path d="${d}" fill="${col}"/>` +
            `<path d="${d}" fill="#FFFFFF" opacity="0.18" transform="translate(${(-1.2 * K).toFixed(2)} ${(-1.4 * K).toFixed(2)})"/></g>`;
        }
      }
    }
  }
  art.add(`<g filter="url(#${f})">${stones}</g>`);
  const sp = art.speckleFilter(P.grassMid, 0.07, 0.8 / K, 21, true);
  art.add(`<rect x="0" y="0" width="${T}" height="${T}" filter="url(#${sp})" opacity="0.5"/>`);
  const g = art.grainFilter(0.2, 0.8 / K, 55, true);
  art.wrapAll(`<g filter="url(#${g})">`);
  return art.svg(T, T);
}

const roadTile = (): string =>
  ground(mix(P.dirt, P.gravel, 0.3), {
    seed: 606,
    mottle: [
      { color: P.dirtDark, count: 7, r: 12, alpha: 0.28 },
      { color: '#A08866', count: 6, r: 10, alpha: 0.26 },
    ],
    flow: { color: P.dirtDark, count: 18, alpha: 0.26, len: 20, w: 1.4 },
    speck: { color: P.rockDark, density: 0.12, size: 0.7, alpha: 0.45 },
    grain: 0.22,
  });

/** Open water at a given depth: wash + drifting tonal bands + speckled sparkle. */
function waterTile(depth: 'shallow' | 'mid' | 'deep', variant: number): string {
  const base = depth === 'shallow' ? P.waterShallow : depth === 'mid' ? P.waterMid : P.waterDeep;
  const dark = depth === 'shallow' ? P.waterMid : depth === 'mid' ? P.waterDeep : P.waterDeeper;
  const light = depth === 'shallow' ? P.waterShallowLight : depth === 'mid' ? P.waterShallow : P.waterMid;
  // Water mottling stays very low contrast and very broad: anything punchier repeats once per tile
  // and reads as a grid of dots across an open lake. The animated shimmer adds the sparkle instead.
  return ground(base, {
    seed: (depth === 'shallow' ? 1001 : depth === 'mid' ? 1002 : 1003) + variant * 71,
    mottle: [
      { color: dark, count: 3, r: 26, alpha: 0.075 },
      { color: light, count: 3, r: 22, alpha: 0.075 },
    ],
    flow: { color: light, count: 22, alpha: 0.14, len: 30, w: 0.8, angle: 22 },
    speck: { color: '#FFFFFF', density: 0.05, size: 0.45, alpha: 0.3 },
    grain: 0.07,
  });
}

/**
 * Transition tile: the `over` material intrudes into `under` along a wavy, periodic boundary.
 * `foam` adds the broken white shoreline line and the speckled spray either side of it.
 *
 * `phase` must be constant across every signature in a family so all its tiles share one boundary
 * profile; that is what lets the shoreline run unbroken from tile to tile.
 */
function transitionTile(sig: number, underSvg: string, overSvg: string, band: number, foam: boolean, phase: number): string {
  const art = new Art();
  const inner = underSvg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const over = overSvg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  // No clip path: the SVG viewport already crops on an exact pixel boundary, whereas a clipPath
  // antialiases and leaves a translucent 1px rim that shows up as a grid of seams once tiles abut.
  art.add(inner);
  if (!sig) return art.svg(T, T);

  const profiles: Profiles = {
    N: edgeProfile(band, phase),
    E: edgeProfile(band, phase + 1.9),
    S: edgeProfile(band, phase + 3.7),
    W: edgeProfile(band, phase + 5.2),
  };
  const maskOf = (lo: number, hi: number | null): string => {
    const id = nid('m');
    const outer = blobRegion(art, sig, profiles, hi ?? 0, true);
    const cut = hi === null ? '' : blobRegion(art, sig, profiles, lo, false);
    art.def(`<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${T}" height="${T}">${outer}${cut}</mask>`);
    return id;
  };

  if (!foam) {
    // Two half-strength steps outside the main edge, so a depth contour fades in like a gradient
    // instead of landing as a cut line.
    art.add(`<g mask="url(#${maskOf(0, 5 * K)})" opacity="0.34">${over}</g>`);
    art.add(`<g mask="url(#${maskOf(0, 2.4 * K)})" opacity="0.45">${over}</g>`);
  }
  art.add(`<g mask="url(#${maskOf(0, null)})">${over}</g>`);
  if (foam) {
    const fill = `<rect x="0" y="0" width="${T}" height="${T}"`;
    // the foam line sits just inside the water edge
    art.add(`<g mask="url(#${maskOf(-1.1 * K, 2.2 * K)})">${fill} fill="${P.foam}" opacity="0.82"/></g>`);
    // and breaks up into speckled spray on both sides of it
    const sp = art.speckleFilter(P.foam, 0.5, 1.1 / K, 17, true);
    art.add(`<g mask="url(#${maskOf(-6 * K, 7 * K)})">${fill} fill="#fff" filter="url(#${sp})"/></g>`);
  }
  return art.svg(T, T);
}


/* ------------------------------------------------------------------ catalogue ------------ */

export function buildTileDefs(): TileDef[] {
  const defs: TileDef[] = [];
  const add = (key: string, kind: string, svg: string) => defs.push({ key, kind, svg });

  const grass = [grassTile(0), grassTile(1), grassTile(2), grassTile(3)];
  grass.forEach((s, i) => add(`grass_${i}`, 'grass', s));
  const tall = tallGrassTile();
  add('grass_tall', 'tallgrass', tall);
  add('grass_flower', 'grass', flowerGrassTile());
  const dirt = dirtTile();
  add('dirt', 'dirt', dirt);
  add('mud', 'mud', mudTile());
  add('soil', 'soil', soilTile());
  add('crop_wheat', 'crop', cropTile(P.wheat, P.wheatLight, 1200));
  add('crop_barley', 'crop', cropTile(P.barley, P.hay, 1300));
  const rocky = rockyTile();
  add('rocky', 'rock', rocky);
  add('gravel', 'gravel', gravelTile());
  const snow = snowTile();
  add('snow', 'snow', snow);
  add('snow_rock', 'snow', snowRockTile());
  const path = stonePathTile();
  add('stone_path', 'path', path);
  const road = roadTile();
  add('road', 'path', road);

  const shallow = waterTile('shallow', 0);
  const midw = waterTile('mid', 0);
  const deep = waterTile('deep', 0);
  // three variants of each depth, scattered by the map generator, to break up tile repetition
  for (let v = 0; v < 3; v++) {
    add(`water_shallow_${v}`, 'shallow', v === 0 ? shallow : waterTile('shallow', v));
    add(`water_mid_${v}`, 'deep', v === 0 ? midw : waterTile('mid', v));
    add(`water_deep_${v}`, 'deep', v === 0 ? deep : waterTile('deep', v));
  }

  // One seed per family (never per signature) so the boundary is continuous across tile edges.
  const sigs = allBlobSignatures();
  // land → shallow water, with the broken white foam line
  for (const sig of sigs) add(`shore_${sig}`, 'shallow', transitionTile(sig, grass[0], shallow, 20 * K, true, 31));
  // shallow → mid and mid → deep: organic depth contours, no foam
  for (const sig of sigs) add(`depth1_${sig}`, 'deep', transitionTile(sig, shallow, midw, 22 * K, false, 57));
  for (const sig of sigs) add(`depth2_${sig}`, 'deep', transitionTile(sig, midw, deep, 22 * K, false, 83));
  // grass → dirt road/path edges and grass → soil field edges
  for (const sig of sigs) add(`dirtedge_${sig}`, 'dirt', transitionTile(sig, grass[0], dirt, 22 * K, false, 109));
  for (const sig of sigs) add(`rockedge_${sig}`, 'rock', transitionTile(sig, grass[0], rocky, 22 * K, false, 131));
  for (const sig of sigs) add(`snowedge_${sig}`, 'snow', transitionTile(sig, rocky, snow, 22 * K, false, 157));

  return defs;
}

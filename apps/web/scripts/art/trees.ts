/**
 * Trees, built as two sprites each:
 *   <name>_trunk   static, y-sorted, carries the collision box (trunk base only)
 *   <name>_canopy  overlay sprite, drawn above the player, sways about its origin (= the trunk top)
 *
 * Canopies are 8-15 overlapping leaf clusters with three tones (light up-left, mid, shadow
 * down-right), lobed irregular silhouettes and highlight flecks, so they never read as flat circles.
 */
import { Art, leafCluster, stroke, shade, mix } from './wc.js';
import { P, SHADOW } from './palette.js';
import { rng } from './util.js';
import type { PropDef } from './propdef.js';

export interface Tones {
  light: string;
  mid: string;
  dark: string;
  deep: string;
}

const foliage = (base: string): Tones => ({
  light: shade(base, 0.3),
  mid: base,
  dark: shade(base, -0.22),
  deep: shade(base, -0.42),
});

interface ClusterSpec {
  x: number;
  y: number;
  r: number;
}

/** Cluster centres for a rounded (broadleaf) crown: a ring plus an inner scatter. */
function roundClusters(w: number, h: number, rnd: () => number, count: number): ClusterSpec[] {
  const out: ClusterSpec[] = [];
  const ring = Math.round(count * 0.62);
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2 + rnd() * 0.5;
    const rr = 0.64 + rnd() * 0.26;
    out.push({ x: Math.cos(a) * (w / 2) * rr, y: Math.sin(a) * (h / 2) * rr, r: h * (0.2 + rnd() * 0.1) });
  }
  for (let i = ring; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = rnd() * 0.42;
    out.push({ x: Math.cos(a) * (w / 2) * rr, y: Math.sin(a) * (h / 2) * rr - h * 0.06, r: h * (0.22 + rnd() * 0.12) });
  }
  return out;
}

/**
 * One conifer branch tier: a wide shallow arch with a jagged, drooping lower edge, so the crown
 * reads as stacked spruce branches rather than a stack of circles.
 */
function coniferTier(cx: number, y: number, halfW: number, tierH: number, rnd: () => number): string {
  const notches = Math.max(3, Math.round(halfW / 7));
  let d = `M${(cx - halfW).toFixed(1)} ${y.toFixed(1)}`;
  d += ` Q${(cx - halfW * 0.42).toFixed(1)} ${(y - tierH * 0.95).toFixed(1)} ${cx.toFixed(1)} ${(y - tierH).toFixed(1)}`;
  d += ` Q${(cx + halfW * 0.42).toFixed(1)} ${(y - tierH * 0.95).toFixed(1)} ${(cx + halfW).toFixed(1)} ${y.toFixed(1)}`;
  // jagged underside: alternating droop tips and notches, walking back to the left
  for (let i = notches; i >= 0; i--) {
    const t = i / notches;
    const x = cx - halfW + 2 * halfW * t;
    const edge = 1 - Math.abs(t - 0.5) * 2; // 0 at the tips, 1 in the middle
    const droop = tierH * (0.12 + 0.22 * edge) * (0.75 + rnd() * 0.5);
    const notch = tierH * 0.05 * edge;
    const hx = x + halfW / notches / 2;
    // rounded scallops rather than hard triangles, so branches read as needled sprays
    d += ` Q${hx.toFixed(1)} ${(y + droop).toFixed(1)} ${(x + halfW / notches / 6).toFixed(1)} ${(y + droop * 0.72).toFixed(1)}`;
    d += ` Q${(x - halfW / notches / 6).toFixed(1)} ${(y + droop * 0.3).toFixed(1)} ${x.toFixed(1)} ${(y - notch).toFixed(1)}`;
  }
  return d + 'Z';
}

function paintConifer(art: Art, cx: number, cy: number, w: number, h: number, tones: Tones, rnd: () => number, seed: number, tiers: number): void {
  const f = art.washFilter({ wobble: 2.2, freq: 0.06, octaves: 3, seed, edge: 0.24, edgeColor: tones.deep, edgeWidth: 2 });
  let dark = '';
  let mid = '';
  let light = '';
  // bottom tier first so higher tiers overlap it
  for (let i = tiers - 1; i >= 0; i--) {
    const t = i / (tiers - 1); // 0 = top
    const y = cy - h * 0.5 + h * t + h * 0.04;
    const halfW = (w / 2) * (0.12 + 0.88 * Math.pow(t, 0.78)) * (0.93 + rnd() * 0.14);
    const tierH = h * (0.1 + 0.075 * t);
    dark += `<path d="${coniferTier(cx + halfW * 0.06, y + tierH * 0.1, halfW, tierH, rnd)}"/>`;
    mid += `<path d="${coniferTier(cx, y, halfW * 0.95, tierH * 0.98, rnd)}"/>`;
    if (t > 0.08) light += `<path d="${coniferTier(cx - halfW * 0.17, y - tierH * 0.16, halfW * 0.6, tierH * 0.8, rnd)}"/>`;
  }
  art.add(`<g filter="url(#${f})"><g fill="${tones.dark}">${dark}</g><g fill="${tones.mid}">${mid}</g><g fill="${tones.light}">${light}</g></g>`);
}

/**
 * Paints a crown of clusters. Draws back-to-front so lower clusters sit behind higher ones, and
 * puts a dark pass down-right, the body colour in the middle and a light pass up-left on each.
 */
function paintCrown(art: Art, cx: number, cy: number, clusters: ClusterSpec[], tones: Tones, rnd: () => number, seed: number): void {
  const f = art.washFilter({ wobble: 2.6, freq: 0.05, octaves: 3, seed, edge: 0.26, edgeColor: tones.deep, edgeWidth: 2.2 });
  const sorted = [...clusters].sort((a, b) => b.y - a.y);
  let dark = '';
  let mid = '';
  let light = '';
  for (const c of sorted) {
    const x = cx + c.x;
    const y = cy + c.y;
    const lob = 8 + Math.floor(rnd() * 5);
    dark += `<path d="${leafCluster(x + c.r * 0.16, y + c.r * 0.18, c.r, rnd, lob, 1.1)}"/>`;
    mid += `<path d="${leafCluster(x, y, c.r * 0.9, rnd, lob, 1.08)}"/>`;
    if (rnd() > 0.42) {
      light += `<path d="${leafCluster(x - c.r * 0.3, y - c.r * 0.34, c.r * 0.42, rnd, lob - 2, 1.07)}"/>`;
    }
  }
  art.add(`<g filter="url(#${f})"><g fill="${tones.dark}">${dark}</g><g fill="${tones.mid}">${mid}</g><g fill="${tones.light}">${light}</g></g>`);
  // highlight flecks catching the light on the upper-left of the crown
  let fleck = '';
  for (const c of sorted) {
    if (rnd() > 0.5) continue;
    for (let i = 0; i < 2; i++) {
      const a = Math.PI * (1.05 + rnd() * 0.5);
      const d = c.r * (0.3 + rnd() * 0.4);
      fleck += `<ellipse cx="${(cx + c.x + Math.cos(a) * d).toFixed(1)}" cy="${(cy + c.y + Math.sin(a) * d).toFixed(1)}" rx="${(c.r * 0.17).toFixed(1)}" ry="${(c.r * 0.1).toFixed(1)}" transform="rotate(${(-28 + rnd() * 26).toFixed(0)} ${(cx + c.x + Math.cos(a) * d).toFixed(1)} ${(cy + c.y + Math.sin(a) * d).toFixed(1)})"/>`;
    }
  }
  art.add(`<g fill="${shade(tones.light, 0.3)}" opacity="0.5">${fleck}</g>`);
}

/* ------------------------------------------------------------------ trunks --------------- */

interface TrunkOpts {
  w: number;
  h: number;
  /** half-width at the base and at the top */
  baseHalf: number;
  topHalf: number;
  lean: number;
  bark: string;
  barkDark: string;
  /** birch-style light bark with dark marks */
  birch?: boolean;
  /** branch stubs reaching out towards the crown */
  branches?: number;
  seed: number;
}

function trunkSvg(o: TrunkOpts): { svg: string; attach: [number, number]; ox: number; oy: number } {
  const art = new Art();
  const rnd = rng(o.seed);
  const bx = o.w / 2;
  const by = o.h - 6;
  const topY = 8;
  const topX = bx + o.lean;
  art.castShadow(bx + o.h * SHADOW.dx * 0.3, by - 1 + o.h * SHADOW.dy * 0.08, o.baseHalf * 3.2, o.baseHalf * 1.25, SHADOW.opacity + 0.08, 3);

  const f = art.washFilter({ wobble: 1.5, freq: 0.07, seed: o.seed + 3, edge: 0.34, edgeColor: shade(o.bark, -0.5), edgeWidth: 1.8 });
  // flared root base -> tapering trunk
  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const y = by - (by - topY) * t;
    const flare = 1 + Math.pow(1 - t, 4) * 0.42;
    const hw = (o.baseHalf + (o.topHalf - o.baseHalf) * t) * flare;
    const x = bx + o.lean * t * t + Math.sin(t * 3.1 + rnd()) * o.baseHalf * 0.12;
    left.push([x - hw, y]);
    right.push([x + hw, y]);
  }
  const d = `M${left.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')} L${right
    .reverse()
    .map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' L')} Z`;
  let inner = `<path d="${d}" fill="${o.bark}"/>`;
  // Shaded right-hand third: the light comes from the upper left, so the far side of the cylinder
  // darkens. `right` was reversed in place while building `d`, so re-sort both edges bottom-to-top.
  const rightUp = right.slice().reverse();
  const fmt = (p: [number, number]) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
  const innerEdge: Array<[number, number]> = rightUp.map(([x, y], i) => [x - (x - left[i][0]) * 0.42, y]);
  inner += `<path d="M${rightUp.map(fmt).join(' L')} L${innerEdge.reverse().map(fmt).join(' L')} Z" fill="${o.barkDark}" opacity="0.45"/>`;
  art.add(`<g filter="url(#${f})">${inner}</g>`);

  // bark detail
  let marks = '';
  if (o.birch) {
    for (let i = 0; i < 9; i++) {
      const t = 0.08 + rnd() * 0.84;
      const y = by - (by - topY) * t;
      const x = bx + o.lean * t * t;
      const hw = (o.baseHalf + (o.topHalf - o.baseHalf) * t) * (0.7 + rnd() * 0.5);
      marks += `<path d="M${(x - hw).toFixed(1)} ${y.toFixed(1)} q${(hw * 0.7).toFixed(1)} ${(1.6 + rnd() * 2).toFixed(1)} ${(hw * 1.5).toFixed(1)} ${(rnd() * 1.4 - 0.4).toFixed(1)}" stroke="${P.barkDark}" stroke-width="${(1.4 + rnd() * 1.6).toFixed(1)}" fill="none" stroke-linecap="round" opacity="${(0.55 + rnd() * 0.35).toFixed(2)}"/>`;
    }
  } else {
    for (let i = 0; i < 7; i++) {
      const t0 = rnd() * 0.8;
      const len = 0.1 + rnd() * 0.22;
      const pts: Array<[number, number]> = [];
      for (let k = 0; k <= 3; k++) {
        const t = t0 + (len * k) / 3;
        pts.push([bx + o.lean * t * t + (rnd() - 0.5) * o.baseHalf * 1.1, by - (by - topY) * t]);
      }
      marks += `<path d="${stroke(pts, 0.9, 0.5)}" fill="${shade(o.bark, -0.3)}" opacity="0.6"/>`;
    }
  }
  art.add(marks);

  // branch stubs angling up toward the crown
  if (o.branches) {
    let br = '';
    for (let i = 0; i < o.branches; i++) {
      const t = 0.5 + (i / o.branches) * 0.42;
      const y = by - (by - topY) * t;
      const x = bx + o.lean * t * t;
      const dir = i % 2 === 0 ? -1 : 1;
      const len = o.w * (0.17 + rnd() * 0.13);
      br += `<path d="${stroke(
        [
          [x, y],
          [x + dir * len * 0.55, y - len * 0.42],
          [x + dir * len, y - len * 0.95],
        ],
        o.topHalf * 0.5,
        o.topHalf * 0.2,
      )}" fill="${o.birch ? P.birchBarkShade : shade(o.bark, -0.12)}"/>`;
    }
    art.add(br);
  }
  return { svg: art.svg(o.w, o.h), attach: [topX - bx, topY - by], ox: bx, oy: by };
}

/* ------------------------------------------------------------------ species -------------- */

interface Species {
  name: string;
  trunk: Omit<TrunkOpts, 'seed'>;
  crownW: number;
  crownH: number;
  /** crown centre relative to the attach point */
  crownDy: number;
  clusters: number;
  conifer?: boolean;
  base: string;
  collide: { halfW: number; h: number };
}

const SPECIES: Species[] = [
  {
    name: 'pine',
    trunk: { w: 62, h: 150, baseHalf: 7.5, topHalf: 4.2, lean: 3, bark: P.bark, barkDark: P.barkDark, branches: 3 },
    crownW: 124,
    crownH: 208,
    crownDy: -62,
    clusters: 8,
    conifer: true,
    base: P.pine,
    collide: { halfW: 11, h: 13 },
  },
  {
    name: 'spruce',
    trunk: { w: 58, h: 132, baseHalf: 6.8, topHalf: 3.8, lean: -2, bark: P.barkDark, barkDark: shade(P.barkDark, -0.3), branches: 3 },
    crownW: 108,
    crownH: 178,
    crownDy: -54,
    clusters: 7,
    conifer: true,
    base: P.pineDeep,
    collide: { halfW: 10, h: 12 },
  },
  {
    name: 'birch1',
    trunk: { w: 58, h: 160, baseHalf: 5.6, topHalf: 3.2, lean: 7, bark: P.birchBark, barkDark: P.birchBarkShade, birch: true, branches: 4 },
    crownW: 150,
    crownH: 132,
    crownDy: -44,
    clusters: 11,
    base: P.birchLeaf,
    collide: { halfW: 9, h: 11 },
  },
  {
    name: 'birch2',
    trunk: { w: 56, h: 140, baseHalf: 5.2, topHalf: 3.0, lean: -8, bark: P.birchBark, barkDark: P.birchBarkShade, birch: true, branches: 4 },
    crownW: 138,
    crownH: 122,
    crownDy: -40,
    clusters: 10,
    base: shade(P.birchLeafLight, -0.06),
    collide: { halfW: 9, h: 11 },
  },
  {
    name: 'oak1',
    trunk: { w: 92, h: 128, baseHalf: 12, topHalf: 7, lean: 5, bark: P.bark, barkDark: P.barkDark, branches: 4 },
    crownW: 204,
    crownH: 158,
    crownDy: -44,
    clusters: 15,
    base: P.oakLeaf,
    collide: { halfW: 16, h: 16 },
  },
  {
    name: 'oak2',
    trunk: { w: 84, h: 112, baseHalf: 10.5, topHalf: 6.2, lean: -6, bark: P.barkLight, barkDark: P.bark, branches: 4 },
    crownW: 182,
    crownH: 144,
    crownDy: -40,
    clusters: 13,
    base: P.oakLeafLight,
    collide: { halfW: 15, h: 15 },
  },
];

function canopySvg(sp: Species, seed: number): { svg: string; w: number; h: number; ox: number; oy: number } {
  const rnd = rng(seed);
  const pad = 22;
  const w = sp.crownW + pad * 2;
  const h = sp.crownH + pad * 2 + Math.abs(sp.crownDy);
  // origin is the pivot: the trunk top, which sits below the crown centre
  const ox = w / 2;
  const oy = pad + sp.crownH / 2 - sp.crownDy;
  const art = new Art();
  if (sp.conifer) paintConifer(art, ox, oy + sp.crownDy, sp.crownW, sp.crownH, foliage(sp.base), rnd, seed, sp.clusters);
  else paintCrown(art, ox, oy + sp.crownDy, roundClusters(sp.crownW, sp.crownH, rnd, sp.clusters), foliage(sp.base), rnd, seed);
  return { svg: art.svg(w, h), w, h, ox, oy };
}

export function treeProps(): PropDef[] {
  const out: PropDef[] = [];
  SPECIES.forEach((sp, i) => {
    const seed = 400 + i * 61;
    const t = trunkSvg({ ...sp.trunk, seed });
    const c = canopySvg(sp, seed + 17);
    out.push({
      key: `${sp.name}_canopy`,
      w: c.w,
      h: c.h,
      ox: c.ox,
      oy: c.oy,
      svg: c.svg,
      sway: 'canopy',
      layer: 'overlay',
    });
    out.push({
      key: `${sp.name}_trunk`,
      w: sp.trunk.w,
      h: sp.trunk.h,
      ox: t.ox,
      oy: t.oy,
      svg: t.svg,
      // collision covers the trunk base only, never the canopy
      collide: { x: -sp.collide.halfW, y: -sp.collide.h, w: sp.collide.halfW * 2, h: sp.collide.h },
      layer: 'sort',
      crown: { key: `${sp.name}_canopy`, dx: t.attach[0], dy: t.attach[1] },
      coverRadius: sp.crownW * 0.5,
    });
  });

  // --- stump, fallen log, dead tree: no canopy ---
  {
    const art = new Art();
    const rnd = rng(900);
    const w = 56;
    const h = 44;
    const bx = w / 2;
    const by = h - 6;
    art.castShadow(bx + 7, by - 2, 17, 6, SHADOW.opacity, 3);
    const f = art.washFilter({ wobble: 1.4, freq: 0.08, seed: 901, edge: 0.3, edgeColor: shade(P.bark, -0.5) });
    art.add(
      `<g filter="url(#${f})"><path d="M${bx - 15} ${by} L${bx - 13} ${by - 20} Q${bx} ${by - 26} ${bx + 13} ${by - 20} L${bx + 15} ${by} Q${bx} ${by + 5} ${bx - 15} ${by} Z" fill="${P.bark}"/>` +
        `<ellipse cx="${bx}" cy="${by - 21}" rx="13.5" ry="6" fill="${P.barkLight}"/></g>`,
    );
    let rings = '';
    for (let i = 1; i <= 3; i++) rings += `<ellipse cx="${bx}" cy="${by - 21}" rx="${13.5 * (i / 4)}" ry="${6 * (i / 4)}" fill="none" stroke="${shade(P.bark, -0.25)}" stroke-width="0.9" opacity="0.7"/>`;
    art.add(rings);
    void rnd;
    out.push({ key: 'stump', w, h, ox: bx, oy: by, svg: art.svg(w, h), collide: { x: -14, y: -11, w: 28, h: 11 }, layer: 'sort' });
  }
  {
    const art = new Art();
    const rnd = rng(910);
    const w = 180;
    const h = 62;
    const bx = w / 2;
    const by = h - 8;
    art.castShadow(bx + 10, by - 3, 76, 10, SHADOW.opacity, 4);
    const f = art.washFilter({ wobble: 1.6, freq: 0.06, seed: 911, edge: 0.3, edgeColor: shade(P.bark, -0.5) });
    art.add(
      `<g filter="url(#${f})"><path d="M${bx - 78} ${by - 10} Q${bx} ${by - 22} ${bx + 76} ${by - 12} L${bx + 76} ${by} Q${bx} ${by - 8} ${bx - 78} ${by + 2} Z" fill="${P.bark}"/>` +
        `<path d="M${bx - 78} ${by - 10} Q${bx} ${by - 22} ${bx + 76} ${by - 12} L${bx + 76} ${by - 7} Q${bx} ${by - 17} ${bx - 78} ${by - 5} Z" fill="${P.barkLight}" opacity="0.75"/>` +
        `<ellipse cx="${bx + 76}" cy="${by - 6}" rx="5" ry="7" fill="${P.barkLight}"/></g>`,
    );
    // moss along the top
    let moss = '';
    for (let i = 0; i < 14; i++) {
      const x = bx - 70 + rnd() * 140;
      moss += `<ellipse cx="${x.toFixed(1)}" cy="${(by - 14 + rnd() * 4).toFixed(1)}" rx="${(5 + rnd() * 7).toFixed(1)}" ry="${(2 + rnd() * 2).toFixed(1)}" fill="${P.shrub}" opacity="0.65"/>`;
    }
    art.add(moss);
    out.push({ key: 'fallen_log', w, h, ox: bx, oy: by, svg: art.svg(w, h), collide: { x: -78, y: -14, w: 156, h: 14 }, layer: 'sort' });
  }
  {
    const seed = 920;
    const t = trunkSvg({ w: 72, h: 150, baseHalf: 7, topHalf: 2.6, lean: 9, bark: '#6F6354', barkDark: '#4E4538', branches: 5, seed });
    out.push({
      key: 'dead_tree',
      w: 72,
      h: 150,
      ox: t.ox,
      oy: t.oy,
      svg: t.svg,
      collide: { x: -10, y: -12, w: 20, h: 12 },
      layer: 'sort',
    });
  }
  void mix;
  return out;
}

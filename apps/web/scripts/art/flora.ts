/**
 * Ground-level vegetation and scatter: bushes, ferns, grapevines, reeds, lily pads, mushrooms,
 * flowers, haystacks, rocks. Everything painterly and shadowed down-right like the rest of the world.
 */
import { Art, leafCluster, blobPath, stroke, shade, mix } from './wc.js';
import { P, SHADOW } from './palette.js';
import { rng } from './util.js';
import type { PropDef } from './propdef.js';

const sh = (art: Art, bx: number, by: number, rx: number, ry: number, op: number = SHADOW.opacity) =>
  art.castShadow(bx + rx * 0.55, by - ry * 0.25, rx, ry, op, Math.max(1.6, ry * 0.5));

/** Leafy mound built from overlapping lobed clusters, three tones. */
function leafMound(art: Art, cx: number, cy: number, w: number, h: number, base: string, rnd: () => number, seed: number, count = 7): void {
  const tones = { light: shade(base, 0.3), mid: base, dark: shade(base, -0.2), deep: shade(base, -0.44) };
  const f = art.washFilter({ wobble: 2.2, freq: 0.07, seed, edge: 0.26, edgeColor: tones.deep, edgeWidth: 1.8 });
  let dark = '';
  let mid = '';
  let light = '';
  const specs: Array<{ x: number; y: number; r: number }> = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const x = cx - w * 0.38 + t * w * 0.76 + (rnd() - 0.5) * w * 0.1;
    const rr = h * (0.3 + 0.26 * Math.sin(Math.PI * t) + rnd() * 0.1);
    specs.push({ x, y: cy - rr * 0.72, r: rr });
  }
  for (const c of specs.sort((a, b) => b.y - a.y)) {
    const lob = 7 + Math.floor(rnd() * 4);
    dark += `<path d="${leafCluster(c.x + c.r * 0.16, c.y + c.r * 0.18, c.r, rnd, lob, 1.1)}"/>`;
    mid += `<path d="${leafCluster(c.x, c.y, c.r * 0.9, rnd, lob, 1.08)}"/>`;
    if (rnd() > 0.4) light += `<path d="${leafCluster(c.x - c.r * 0.3, c.y - c.r * 0.32, c.r * 0.44, rnd, lob - 2, 1.07)}"/>`;
  }
  art.add(`<g filter="url(#${f})"><g fill="${tones.dark}">${dark}</g><g fill="${tones.mid}">${mid}</g><g fill="${tones.light}">${light}</g></g>`);
}

function bush(key: string, w: number, h: number, base: string, seed: number, berries: string | null): PropDef {
  const W = w + 20;
  const H = h + 18;
  const bx = W / 2;
  const by = H - 7;
  const art = new Art();
  const rnd = rng(seed);
  sh(art, bx, by, w * 0.48, h * 0.17);
  leafMound(art, bx, by, w, h, base, rnd, seed, 7);
  if (berries) {
    let b = '';
    for (let i = 0; i < 12; i++) {
      const x = bx + (rnd() - 0.5) * w * 0.72;
      const y = by - h * (0.18 + rnd() * 0.62);
      b += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(1.8 + rnd() * 0.9).toFixed(1)}" fill="${berries}"/>`;
      b += `<circle cx="${(x - 0.6).toFixed(1)}" cy="${(y - 0.7).toFixed(1)}" r="0.6" fill="#fff" opacity="0.6"/>`;
    }
    art.add(b);
  }
  return {
    key,
    w: W,
    h: H,
    ox: bx,
    oy: by,
    svg: art.svg(W, H),
    collide: { x: -w * 0.3, y: -h * 0.34, w: w * 0.6, h: h * 0.34 },
    sway: 'bush',
    layer: 'sort',
  };
}

function fern(key: string, w: number, h: number, seed: number): PropDef {
  const W = w + 16;
  const H = h + 14;
  const bx = W / 2;
  const by = H - 6;
  const art = new Art();
  const rnd = rng(seed);
  sh(art, bx, by, w * 0.4, h * 0.13, 0.2);
  const f = art.washFilter({ wobble: 1.2, freq: 0.1, seed, edge: 0.24, edgeColor: shade(P.fern, -0.5), edgeWidth: 1.2 });
  let fronds = '';
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / (n - 1) - 0.5) * 2.1;
    const len = h * (0.62 + rnd() * 0.38);
    const col = i % 2 ? shade(P.fern, 0.16) : P.fern;
    // central rib
    const pts: Array<[number, number]> = [];
    for (let k = 0; k <= 5; k++) {
      const t = k / 5;
      pts.push([bx + Math.cos(a) * len * t * (1 + t * 0.22), by - Math.sin(-a) * 0 - Math.abs(Math.sin(a)) * 0 + Math.sin(a) * len * t - 0]);
    }
    const rib: Array<[number, number]> = [];
    for (let k = 0; k <= 5; k++) {
      const t = k / 5;
      rib.push([bx + Math.cos(a) * len * t, by + Math.sin(a) * len * t + t * t * h * 0.12]);
    }
    fronds += `<path d="${stroke(rib, h * 0.07, h * 0.012)}" fill="${col}"/>`;
    // leaflets
    for (let k = 1; k <= 5; k++) {
      const t = k / 6;
      const px = bx + Math.cos(a) * len * t;
      const py = by + Math.sin(a) * len * t + t * t * h * 0.12;
      const ll = h * 0.1 * (1 - t * 0.5);
      for (const s of [-1, 1]) {
        fronds += `<ellipse cx="${(px + s * ll * 0.8).toFixed(1)}" cy="${(py + ll * 0.3).toFixed(1)}" rx="${ll.toFixed(1)}" ry="${(ll * 0.42).toFixed(1)}" fill="${col}" transform="rotate(${((a * 180) / Math.PI + (s > 0 ? 28 : -28)).toFixed(0)} ${(px + s * ll * 0.8).toFixed(1)} ${(py + ll * 0.3).toFixed(1)})"/>`;
      }
    }
    void pts;
  }
  art.add(`<g filter="url(#${f})">${fronds}</g>`);
  return { key, w: W, h: H, ox: bx, oy: by, svg: art.svg(W, H), sway: 'bush', layer: 'sort' };
}

/** Grass tuft / reeds / cattails: tall blades that shear in the wind. */
function blades(key: string, w: number, h: number, colA: string, colB: string, seed: number, cattail: boolean): PropDef {
  const W = w + 14;
  const H = h + 12;
  const bx = W / 2;
  const by = H - 5;
  const art = new Art();
  const rnd = rng(seed);
  const f = art.washFilter({ wobble: 0.9, freq: 0.12, seed, edge: 0 });
  let b = '';
  const n = cattail ? 9 : 13;
  for (let i = 0; i < n; i++) {
    const x = bx + (rnd() - 0.5) * w * 0.8;
    const hh = h * (0.55 + rnd() * 0.45);
    const lean = (rnd() - 0.5) * w * 0.34;
    const pts: Array<[number, number]> = [
      [x, by],
      [x + lean * 0.35, by - hh * 0.5],
      [x + lean, by - hh],
    ];
    b += `<path d="${stroke(pts, w * 0.035, w * 0.01)}" fill="${i % 2 ? colA : colB}"/>`;
    if (cattail && i % 3 === 0) {
      b += `<ellipse cx="${(x + lean).toFixed(1)}" cy="${(by - hh - h * 0.05).toFixed(1)}" rx="${(w * 0.05).toFixed(1)}" ry="${(h * 0.1).toFixed(1)}" fill="${P.barkDark}"/>`;
    }
  }
  art.add(`<g filter="url(#${f})">${b}</g>`);
  return { key, w: W, h: H, ox: bx, oy: by, svg: art.svg(W, H), sway: 'grass', layer: 'sort' };
}

function lilyPads(seed: number): PropDef {
  const W = 92;
  const H = 62;
  const art = new Art();
  const rnd = rng(seed);
  const f = art.washFilter({ wobble: 1.6, freq: 0.08, seed, edge: 0.24, edgeColor: shade(P.shrub, -0.5), edgeWidth: 1.4 });
  let pads = '';
  for (let i = 0; i < 6; i++) {
    const cx = 14 + rnd() * 64;
    const cy = 12 + rnd() * 38;
    const r = 8 + rnd() * 7;
    const a0 = rnd() * Math.PI * 2;
    // Pad outline with the wedge genuinely cut out: walk the rim from one side of the notch round
    // to the other and close through the centre. Filling the notch with a water colour would show
    // as a blue shard whenever a pad sits on anything but open water.
    const gap = 0.34;
    const steps = 26;
    let d = `M${cx.toFixed(1)} ${cy.toFixed(1)}`;
    for (let k = 0; k <= steps; k++) {
      const a = a0 + gap + ((Math.PI * 2 - gap * 2) * k) / steps;
      const rr = r * (0.92 + rnd() * 0.16);
      d += ` L${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr * 0.72).toFixed(1)}`;
    }
    d += ' Z';
    pads += `<path d="${d}" fill="${i % 2 ? P.shrub : shade(P.shrub, 0.16)}"/>`;
    pads += `<path d="M${cx.toFixed(1)} ${cy.toFixed(1)} L${(cx + Math.cos(a0 + 1.6) * r * 0.62).toFixed(1)} ${(cy + Math.sin(a0 + 1.6) * r * 0.45).toFixed(1)}" stroke="${shade(P.shrub, -0.3)}" stroke-width="0.8" opacity="0.6" fill="none"/>`;
  }
  art.add(`<g filter="url(#${f})">${pads}</g>`);
  art.add(
    `<circle cx="34" cy="26" r="4" fill="${P.flowerWhite}"/><circle cx="34" cy="26" r="1.6" fill="${P.flowerYellow}"/>` +
      `<circle cx="68" cy="40" r="3.4" fill="${P.flowerPink}"/>`,
  );
  return { key: 'lily_pads', w: W, h: H, ox: W / 2, oy: H / 2, svg: art.svg(W, H), sway: 'bob', layer: 'ground' };
}

function mushrooms(key: string, cap: string, seed: number): PropDef {
  const W = 40;
  const H = 34;
  const bx = W / 2;
  const by = H - 5;
  const art = new Art();
  const rnd = rng(seed);
  sh(art, bx, by, 9, 3, 0.18);
  const f = art.washFilter({ wobble: 1.0, freq: 0.1, seed, edge: 0.3, edgeColor: shade(cap, -0.5), edgeWidth: 1.2 });
  let m = '';
  for (let i = 0; i < 3; i++) {
    const x = bx + (i - 1) * (5 + rnd() * 4);
    const hh = 7 + rnd() * 8;
    const r = 4 + rnd() * 3.5;
    m += `<rect x="${(x - 1.5).toFixed(1)}" y="${(by - hh).toFixed(1)}" width="3" height="${hh.toFixed(1)}" rx="1.4" fill="${P.cloth}"/>`;
    m += `<path d="M${(x - r).toFixed(1)} ${(by - hh).toFixed(1)} Q${x.toFixed(1)} ${(by - hh - r * 1.5).toFixed(1)} ${(x + r).toFixed(1)} ${(by - hh).toFixed(1)} Q${x.toFixed(1)} ${(by - hh + r * 0.4).toFixed(1)} ${(x - r).toFixed(1)} ${(by - hh).toFixed(1)} Z" fill="${cap}"/>`;
    m += `<circle cx="${(x - r * 0.3).toFixed(1)}" cy="${(by - hh - r * 0.5).toFixed(1)}" r="1" fill="#fff" opacity="0.8"/>`;
  }
  art.add(`<g filter="url(#${f})">${m}</g>`);
  return { key, w: W, h: H, ox: bx, oy: by, svg: art.svg(W, H), layer: 'sort' };
}

function flowers(key: string, petal: string, seed: number): PropDef {
  const W = 52;
  const H = 42;
  const bx = W / 2;
  const by = H - 5;
  const art = new Art();
  const rnd = rng(seed);
  const f = art.washFilter({ wobble: 0.8, freq: 0.12, seed, edge: 0 });
  let s = '';
  for (let i = 0; i < 8; i++) {
    const x = 8 + rnd() * (W - 16);
    const hh = 9 + rnd() * 12;
    const lean = (rnd() - 0.5) * 5;
    s += `<path d="${stroke(
      [
        [x, by],
        [x + lean * 0.4, by - hh * 0.55],
        [x + lean, by - hh],
      ],
      1.0,
      0.5,
    )}" fill="${P.grassMid}"/>`;
    const fx = x + lean;
    const fy = by - hh;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + rnd();
      s += `<ellipse cx="${(fx + Math.cos(a) * 2.4).toFixed(1)}" cy="${(fy + Math.sin(a) * 2.4).toFixed(1)}" rx="2.1" ry="1.5" fill="${petal}" transform="rotate(${((a * 180) / Math.PI).toFixed(0)} ${(fx + Math.cos(a) * 2.4).toFixed(1)} ${(fy + Math.sin(a) * 2.4).toFixed(1)})"/>`;
    }
    s += `<circle cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="1.4" fill="${P.flowerYellow}"/>`;
  }
  art.add(`<g filter="url(#${f})">${s}</g>`);
  return { key, w: W, h: H, ox: bx, oy: by, svg: art.svg(W, H), sway: 'grass', layer: 'sort' };
}

/** Grapevine on a trellis — the nod to Vinland. */
function grapevine(seed: number): PropDef {
  const W = 120;
  const H = 120;
  const bx = W / 2;
  const by = H - 8;
  const art = new Art();
  const rnd = rng(seed);
  sh(art, bx, by, 34, 8);
  // trellis posts and crossbar
  const f = art.washFilter({ wobble: 1.1, freq: 0.08, seed, edge: 0.3, edgeColor: shade(P.timber, -0.5), edgeWidth: 1.4 });
  let t = '';
  for (const x of [bx - 30, bx + 30]) t += `<rect x="${x - 3.5}" y="${by - 76}" width="7" height="76" rx="2.5" fill="${P.timber}"/>`;
  t += `<rect x="${bx - 36}" y="${by - 80}" width="72" height="6" rx="2.5" fill="${P.timberLight}"/>`;
  t += `<rect x="${bx - 34}" y="${by - 52}" width="68" height="4" rx="2" fill="${P.timberDark}" opacity="0.8"/>`;
  art.add(`<g filter="url(#${f})">${t}</g>`);
  // vine leaves along the bars
  leafMound(art, bx, by - 48, 92, 46, P.vine, rnd, seed + 1, 8);
  leafMound(art, bx, by - 74, 76, 34, shade(P.vine, 0.12), rnd, seed + 2, 6);
  // grape bunches
  let g = '';
  for (const gx of [bx - 22, bx + 8, bx + 28]) {
    const gy = by - 40 + rnd() * 8;
    for (let i = 0; i < 9; i++) {
      const row = Math.floor(i / 3);
      const col = (i % 3) - 1 + (row % 2 ? 0.5 : 0);
      g += `<circle cx="${(gx + col * 4.2).toFixed(1)}" cy="${(gy + row * 3.8).toFixed(1)}" r="2.6" fill="${P.grape}"/>`;
      g += `<circle cx="${(gx + col * 4.2 - 0.8).toFixed(1)}" cy="${(gy + row * 3.8 - 0.9).toFixed(1)}" r="0.9" fill="#A77FC0" opacity="0.7"/>`;
    }
  }
  art.add(g);
  return {
    key: 'grapevine',
    w: W,
    h: H,
    ox: bx,
    oy: by,
    svg: art.svg(W, H),
    collide: { x: -34, y: -10, w: 68, h: 10 },
    sway: 'bush',
    layer: 'sort',
  };
}

function haystack(key: string, w: number, h: number, seed: number): PropDef {
  const W = w + 18;
  const H = h + 16;
  const bx = W / 2;
  const by = H - 7;
  const art = new Art();
  const rnd = rng(seed);
  sh(art, bx, by, w * 0.5, h * 0.17);
  const f = art.washFilter({ wobble: 1.8, freq: 0.07, seed, edge: 0.3, edgeColor: shade(P.hay, -0.5), edgeWidth: 2 });
  art.add(
    `<g filter="url(#${f})"><path d="M${bx - w / 2} ${by} Q${bx - w * 0.42} ${by - h * 0.78} ${bx} ${by - h} Q${bx + w * 0.42} ${by - h * 0.78} ${bx + w / 2} ${by} Q${bx} ${by + h * 0.08} ${bx - w / 2} ${by} Z" fill="${P.hay}"/>` +
      `<path d="M${bx + w * 0.05} ${by - h * 0.96} Q${bx + w * 0.42} ${by - h * 0.74} ${bx + w / 2} ${by} Q${bx + w * 0.2} ${by + h * 0.05} ${bx + w * 0.05} ${by} Z" fill="${shade(P.hay, -0.2)}" opacity="0.75"/></g>`,
  );
  let straw = '';
  for (let i = 0; i < 26; i++) {
    const a = -Math.PI / 2 + (rnd() - 0.5) * 2.6;
    const rr = rnd();
    const x = bx + Math.cos(a) * (w / 2) * rr * 0.9;
    const y = by + Math.sin(a) * h * rr * 0.9;
    straw += `<path d="M${x.toFixed(1)} ${y.toFixed(1)} l${(Math.cos(a) * 6).toFixed(1)} ${(Math.sin(a) * 6).toFixed(1)}" stroke="${rnd() > 0.5 ? P.wheatLight : shade(P.hay, -0.3)}" stroke-width="1" opacity="0.7" stroke-linecap="round"/>`;
  }
  art.add(straw);
  return {
    key,
    w: W,
    h: H,
    ox: bx,
    oy: by,
    svg: art.svg(W, H),
    collide: { x: -w * 0.42, y: -h * 0.42, w: w * 0.84, h: h * 0.42 },
    layer: 'sort',
  };
}

function rock(key: string, w: number, h: number, seed: number, mossy: boolean): PropDef {
  const W = w + 16;
  const H = h + 16;
  const bx = W / 2;
  const by = H - 6;
  const art = new Art();
  const rnd = rng(seed);
  sh(art, bx, by, w * 0.5, h * 0.2);
  const f = art.washFilter({ wobble: 1.6, freq: 0.06, seed, edge: 0.32, edgeColor: P.rockDeep, edgeWidth: 2 });
  const d = blobPath(bx, by - h * 0.42, w * 0.5, h * 0.46, rnd, 9, 0.2);
  art.add(
    `<g filter="url(#${f})"><path d="${d}" fill="${P.rock}"/>` +
      `<path d="${blobPath(bx - w * 0.1, by - h * 0.55, w * 0.3, h * 0.26, rnd, 8, 0.24)}" fill="${P.rockLight}" opacity="0.85"/>` +
      `<path d="${blobPath(bx + w * 0.17, by - h * 0.26, w * 0.26, h * 0.24, rnd, 8, 0.24)}" fill="${P.rockDark}" opacity="0.6"/></g>`,
  );
  // a soft lit rim up-left rather than a drawn facet line, which read as a pencil scratch
  art.add(
    `<path d="M${(bx - w * 0.3).toFixed(1)} ${(by - h * 0.46).toFixed(1)} q${(w * 0.16).toFixed(1)} ${(-h * 0.3).toFixed(1)} ${(w * 0.42).toFixed(1)} ${(-h * 0.33).toFixed(1)}" stroke="#FFFFFF" stroke-width="${(h * 0.09).toFixed(1)}" fill="none" opacity="0.26" stroke-linecap="round"/>`,
  );
  if (mossy) {
    let moss = '';
    for (let i = 0; i < 5; i++) {
      moss += `<ellipse cx="${(bx + (rnd() - 0.5) * w * 0.7).toFixed(1)}" cy="${(by - h * (0.05 + rnd() * 0.25)).toFixed(1)}" rx="${(w * 0.12).toFixed(1)}" ry="${(h * 0.06).toFixed(1)}" fill="${P.shrub}" opacity="0.6"/>`;
    }
    art.add(moss);
  }
  return {
    key,
    w: W,
    h: H,
    ox: bx,
    oy: by,
    svg: art.svg(W, H),
    collide: { x: -w * 0.42, y: -h * 0.4, w: w * 0.84, h: h * 0.4 },
    layer: 'sort',
  };
}

export function floraProps(): PropDef[] {
  return [
    bush('bush_a', 70, 50, P.shrub, 1101, null),
    bush('bush_b', 86, 58, shade(P.shrubLight, -0.05), 1102, null),
    bush('bush_c', 62, 44, P.shrub, 1103, '#B4406A'),
    fern('fern_a', 72, 52, 1201),
    fern('fern_b', 58, 44, 1202),
    blades('tuft_a', 44, 34, P.grassMid, P.grassLight, 1301, false),
    blades('tuft_b', 54, 44, P.grassDeep, P.grass, 1302, false),
    blades('reeds', 62, 78, shade(P.grassMid, 0.08), P.grassDry, 1303, false),
    blades('cattails', 58, 86, P.grassMid, P.grassDry, 1304, true),
    lilyPads(1401),
    mushrooms('mushroom_red', '#C44A3A', 1501),
    mushrooms('mushroom_tan', '#C8A26A', 1502),
    flowers('flowers_white', P.flowerWhite, 1601),
    flowers('flowers_yellow', P.flowerYellow, 1602),
    flowers('flowers_pink', P.flowerPink, 1603),
    flowers('flowers_blue', P.flowerBlue, 1604),
    grapevine(1701),
    haystack('haystack', 86, 66, 1801),
    haystack('hay_small', 54, 42, 1802),
    rock('rock_s', 36, 26, 1901, false),
    rock('rock_m', 62, 44, 1902, true),
    rock('rock_l', 98, 68, 1903, true),
    rock('boulder', 136, 96, 1904, true),
  ];
}
void mix;

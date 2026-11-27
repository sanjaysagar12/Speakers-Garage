/**
 * Norse farmstead buildings and props. Everything is drawn in a 3/4 oblique: you see the front wall
 * and a little of the roof plane, and the base sits on the sprite origin so y-sorting works.
 */
import { Art, stroke, blobPath, shade, mix } from './wc.js';
import { P, SHADOW } from './palette.js';
import { rng } from './util.js';
import type { PropDef } from './propdef.js';

const p2 = (n: number) => n.toFixed(1);
const shadowFor = (art: Art, bx: number, by: number, rx: number, ry: number, op: number = SHADOW.opacity) =>
  art.castShadow(bx + rx * 0.42, by - ry * 0.3, rx, ry, op, Math.max(2, ry * 0.45));

/** Timber plank wall with visible boards. */
function plankWall(x: number, y: number, w: number, h: number, base: string, vertical: boolean, seed: number): string {
  const r = rng(seed);
  let s = `<rect x="${p2(x)}" y="${p2(y)}" width="${p2(w)}" height="${p2(h)}" fill="${base}"/>`;
  const n = vertical ? Math.round(w / 11) : Math.round(h / 9);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const tone = r() > 0.5 ? shade(base, 0.12) : shade(base, -0.12);
    if (vertical) s += `<rect x="${p2(x + t * w)}" y="${p2(y)}" width="${p2(w / n)}" height="${p2(h)}" fill="${tone}" opacity="0.55"/>`;
    else s += `<rect x="${p2(x)}" y="${p2(y + t * h)}" width="${p2(w)}" height="${p2(h / n)}" fill="${tone}" opacity="0.55"/>`;
  }
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (vertical) s += `<line x1="${p2(x + t * w)}" y1="${p2(y)}" x2="${p2(x + t * w)}" y2="${p2(y + h)}" stroke="${shade(base, -0.45)}" stroke-width="0.8" opacity="0.6"/>`;
    else s += `<line x1="${p2(x)}" y1="${p2(y + t * h)}" x2="${p2(x + w)}" y2="${p2(y + t * h)}" stroke="${shade(base, -0.45)}" stroke-width="0.8" opacity="0.6"/>`;
  }
  return s;
}

/** Grass-covered turf roof: a long sweeping ridge with a mossy top and a thick cut edge. */
function turfRoof(art: Art, cx: number, ridgeY: number, eaveY: number, halfW: number, seed: number): string {
  const r = rng(seed);
  const f = art.washFilter({ wobble: 2.2, freq: 0.05, seed, edge: 0.22, edgeColor: shade(P.turfDark, -0.4), edgeWidth: 2.4 });
  let s = '';
  const d =
    `M${p2(cx - halfW)} ${p2(eaveY)} Q${p2(cx - halfW * 0.72)} ${p2(ridgeY + 3)} ${p2(cx)} ${p2(ridgeY)} ` +
    `Q${p2(cx + halfW * 0.72)} ${p2(ridgeY + 3)} ${p2(cx + halfW)} ${p2(eaveY)} ` +
    `Q${p2(cx)} ${p2(eaveY + 7)} ${p2(cx - halfW)} ${p2(eaveY)} Z`;
  s += `<path d="${d}" fill="${P.turf}"/>`;
  // sun side lighter, shaded side darker
  s += `<path d="M${p2(cx + halfW * 0.1)} ${p2(ridgeY + 0.6)} Q${p2(cx + halfW * 0.72)} ${p2(ridgeY + 3)} ${p2(cx + halfW)} ${p2(eaveY)} Q${p2(cx + halfW * 0.5)} ${p2(eaveY + 5)} ${p2(cx + halfW * 0.1)} ${p2(eaveY + 3)} Z" fill="${P.turfDark}" opacity="0.6"/>`;
  s += `<path d="M${p2(cx - halfW * 0.95)} ${p2(eaveY - 1)} Q${p2(cx - halfW * 0.6)} ${p2(ridgeY + 4)} ${p2(cx - halfW * 0.08)} ${p2(ridgeY + 1)} Q${p2(cx - halfW * 0.5)} ${p2(ridgeY + 8)} ${p2(cx - halfW * 0.95)} ${p2(eaveY - 4)} Z" fill="${shade(P.turf, 0.26)}" opacity="0.55"/>`;
  // grass tufts along the ridge
  let tufts = '';
  for (let i = 0; i < 22; i++) {
    const t = r();
    const x = cx - halfW * 0.92 + t * halfW * 1.84;
    const y = ridgeY + Math.abs(x - cx) / halfW * (eaveY - ridgeY) * 0.9 + r() * 4;
    tufts += `<path d="${stroke(
      [
        [x, y],
        [x + 1, y - 3],
        [x + 2.4, y - 5.5],
      ],
      1.0,
      0.3,
    )}" fill="${r() > 0.5 ? P.grassLight : P.grassMid}" opacity="0.85"/>`;
  }
  s += tufts;
  // cut turf edge under the eave
  s += `<path d="M${p2(cx - halfW)} ${p2(eaveY)} Q${p2(cx)} ${p2(eaveY + 7)} ${p2(cx + halfW)} ${p2(eaveY)} L${p2(cx + halfW)} ${p2(eaveY + 4)} Q${p2(cx)} ${p2(eaveY + 11)} ${p2(cx - halfW)} ${p2(eaveY + 4)} Z" fill="${P.dirtDark}"/>`;
  return `<g filter="url(#${f})">${s}</g>`;
}

function longhouse(): PropDef {
  const W = 420;
  const H = 300;
  const bx = W / 2;
  const by = H - 10;
  const art = new Art();
  shadowFor(art, bx, by, 180, 26);
  const wallTop = by - 86;
  const eaveY = wallTop + 4;
  const ridgeY = by - 212;
  // gable walls
  art.add(plankWall(bx - 168, wallTop, 336, 86, P.timber, true, 11));
  art.add(
    `<path d="M${p2(bx - 168)} ${p2(wallTop)} L${p2(bx + 168)} ${p2(wallTop)} L${p2(bx + 168)} ${p2(wallTop + 10)} L${p2(bx - 168)} ${p2(wallTop + 10)} Z" fill="${P.timberDark}" opacity="0.5"/>`,
  );
  // door
  const dx = bx - 20;
  art.add(
    `<path d="M${p2(dx)} ${p2(by)} L${p2(dx)} ${p2(by - 44)} Q${p2(dx + 20)} ${p2(by - 60)} ${p2(dx + 40)} ${p2(by - 44)} L${p2(dx + 40)} ${p2(by)} Z" fill="${P.timberDark}"/>`,
  );
  art.add(plankWall(dx + 3, by - 46, 34, 46, shade(P.timber, -0.25), true, 12));
  art.add(
    `<path d="M${p2(dx + 3)} ${p2(by - 44)} Q${p2(dx + 20)} ${p2(by - 58)} ${p2(dx + 37)} ${p2(by - 44)} L${p2(dx + 37)} ${p2(by - 38)} Q${p2(dx + 20)} ${p2(by - 50)} ${p2(dx + 3)} ${p2(by - 38)} Z" fill="${P.iron}" opacity="0.8"/>`,
  );
  art.add(`<circle cx="${p2(dx + 32)}" cy="${p2(by - 22)}" r="2.6" fill="${P.iron}"/>`);
  // small shuttered windows
  for (const wx of [bx - 120, bx - 70, bx + 70, bx + 120]) {
    art.add(`<rect x="${p2(wx - 13)}" y="${p2(by - 66)}" width="26" height="22" rx="2" fill="${P.timberDark}"/>`);
    art.add(`<rect x="${p2(wx - 10)}" y="${p2(by - 63)}" width="20" height="16" rx="1.5" fill="#3A2E22"/>`);
    art.add(`<rect x="${p2(wx - 10)}" y="${p2(by - 63)}" width="20" height="16" rx="1.5" fill="${P.fireCore}" opacity="0.35"/>`);
    art.add(`<line x1="${p2(wx)}" y1="${p2(by - 63)}" x2="${p2(wx)}" y2="${p2(by - 47)}" stroke="${P.timberDark}" stroke-width="2"/>`);
  }
  // corner posts
  for (const px of [bx - 168, bx + 162]) art.add(`<rect x="${p2(px)}" y="${p2(wallTop)}" width="7" height="86" fill="${P.timberDark}"/>`);
  // roof
  art.add(turfRoof(art, bx, ridgeY, eaveY, 196, 21));
  // carved dragon-head ridge posts
  for (const sgn of [-1, 1]) {
    const x = bx + sgn * 186;
    art.add(
      `<path d="M${p2(x)} ${p2(eaveY + 4)} L${p2(x - sgn * 8)} ${p2(eaveY - 34)} Q${p2(x - sgn * 14)} ${p2(eaveY - 46)} ${p2(x - sgn * 2)} ${p2(eaveY - 44)} L${p2(x + sgn * 2)} ${p2(eaveY - 32)} Z" fill="${P.timberDark}"/>`,
    );
  }
  return {
    key: 'longhouse',
    w: W,
    h: H,
    ox: bx,
    oy: by,
    svg: art.svg(W, H),
    collide: { x: -172, y: -92, w: 344, h: 92 },
    layer: 'sort',
  };
}

function outbuilding(key: string, w: number, h: number, thatch: boolean, seed: number, doorW: number): PropDef {
  const W = w + 60;
  const H = h + 50;
  const bx = W / 2;
  const by = H - 8;
  const art = new Art();
  const rnd = rng(seed);
  shadowFor(art, bx, by, w * 0.55, h * 0.1);
  const wallH = h * 0.5;
  const wallTop = by - wallH;
  const ridgeY = by - h;
  art.add(plankWall(bx - w / 2, wallTop, w, wallH, P.timber, true, seed));
  // door
  art.add(`<rect x="${p2(bx - doorW / 2)}" y="${p2(by - wallH * 0.86)}" width="${p2(doorW)}" height="${p2(wallH * 0.86)}" rx="2" fill="${P.timberDark}"/>`);
  art.add(plankWall(bx - doorW / 2 + 2, by - wallH * 0.86 + 2, doorW - 4, wallH * 0.86 - 2, shade(P.timber, -0.3), true, seed + 1));
  art.add(
    `<path d="M${p2(bx - doorW / 2 + 3)} ${p2(by - wallH * 0.8)} L${p2(bx + doorW / 2 - 3)} ${p2(by - wallH * 0.3)}" stroke="${P.iron}" stroke-width="2" opacity="0.7"/>`,
  );
  if (thatch) {
    const f = art.washFilter({ wobble: 2.0, freq: 0.06, seed: seed + 5, edge: 0.26, edgeColor: shade(P.thatchDark, -0.4), edgeWidth: 2.2 });
    let s = `<path d="M${p2(bx - w / 2 - 12)} ${p2(wallTop + 4)} L${p2(bx)} ${p2(ridgeY)} L${p2(bx + w / 2 + 12)} ${p2(wallTop + 4)} Q${p2(bx)} ${p2(wallTop + 12)} ${p2(bx - w / 2 - 12)} ${p2(wallTop + 4)} Z" fill="${P.thatch}"/>`;
    s += `<path d="M${p2(bx + 2)} ${p2(ridgeY + 1)} L${p2(bx + w / 2 + 12)} ${p2(wallTop + 4)} Q${p2(bx + w / 4)} ${p2(wallTop + 10)} ${p2(bx + 2)} ${p2(wallTop + 7)} Z" fill="${P.thatchDark}" opacity="0.6"/>`;
    for (let i = 0; i < 9; i++) {
      const t = i / 9;
      const y = ridgeY + t * (wallTop + 4 - ridgeY);
      const hw = (w / 2 + 12) * t;
      s += `<path d="M${p2(bx - hw)} ${p2(y)} Q${p2(bx)} ${p2(y + 5)} ${p2(bx + hw)} ${p2(y)}" stroke="${shade(P.thatch, -0.22)}" stroke-width="1.2" fill="none" opacity="0.7"/>`;
    }
    art.add(`<g filter="url(#${f})">${s}</g>`);
  } else {
    art.add(turfRoof(art, bx, ridgeY, wallTop + 4, w / 2 + 14, seed + 5));
  }
  void rnd;
  return {
    key,
    w: W,
    h: H,
    ox: bx,
    oy: by,
    svg: art.svg(W, H),
    collide: { x: -w / 2 - 4, y: -wallH - 4, w: w + 8, h: wallH + 4 },
    layer: 'sort',
  };
}

function well(): PropDef {
  const W = 120;
  const H = 150;
  const bx = W / 2;
  const by = H - 8;
  const art = new Art();
  shadowFor(art, bx, by, 42, 12);
  const f = art.washFilter({ wobble: 1.4, freq: 0.07, seed: 61, edge: 0.3, edgeColor: P.rockDeep, edgeWidth: 2 });
  const rnd = rng(61);
  // stone ring
  let s = `<ellipse cx="${p2(bx)}" cy="${p2(by - 14)}" rx="38" ry="15" fill="${P.stoneDark}"/>`;
  s += `<path d="M${p2(bx - 38)} ${p2(by - 14)} L${p2(bx - 38)} ${p2(by - 30)} A38 15 0 0 1 ${p2(bx + 38)} ${p2(by - 30)} L${p2(bx + 38)} ${p2(by - 14)} A38 15 0 0 1 ${p2(bx - 38)} ${p2(by - 14)} Z" fill="${P.stone}"/>`;
  s += `<ellipse cx="${p2(bx)}" cy="${p2(by - 30)}" rx="38" ry="15" fill="${P.stoneDark}"/>`;
  s += `<ellipse cx="${p2(bx)}" cy="${p2(by - 30)}" rx="29" ry="11" fill="#1E2A30"/>`;
  s += `<ellipse cx="${p2(bx)}" cy="${p2(by - 28)}" rx="22" ry="8" fill="${P.waterDeep}" opacity="0.8"/>`;
  art.add(`<g filter="url(#${f})">${s}</g>`);
  // stone courses
  let courses = '';
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI;
    const x = bx - Math.cos(a) * 36;
    courses += `<path d="M${p2(x)} ${p2(by - 28)} L${p2(x)} ${p2(by - 14)}" stroke="${P.stoneDark}" stroke-width="1.2" opacity="0.6"/>`;
    courses += `<ellipse cx="${p2(x)}" cy="${p2(by - 21 + rnd() * 2)}" rx="5" ry="3.5" fill="${rnd() > 0.5 ? P.rockLight : P.stoneDark}" opacity="0.35"/>`;
  }
  art.add(courses);
  // posts and roof
  const f2 = art.washFilter({ wobble: 1.2, freq: 0.08, seed: 62, edge: 0.3, edgeColor: shade(P.timber, -0.5), edgeWidth: 1.6 });
  let t = '';
  for (const x of [bx - 30, bx + 30]) t += `<rect x="${p2(x - 4)}" y="${p2(by - 104)}" width="8" height="76" fill="${P.timber}"/>`;
  t += `<path d="M${p2(bx - 48)} ${p2(by - 100)} L${p2(bx)} ${p2(by - 132)} L${p2(bx + 48)} ${p2(by - 100)} Q${p2(bx)} ${p2(by - 94)} ${p2(bx - 48)} ${p2(by - 100)} Z" fill="${P.thatch}"/>`;
  t += `<path d="M${p2(bx + 1)} ${p2(by - 131)} L${p2(bx + 48)} ${p2(by - 100)} Q${p2(bx + 24)} ${p2(by - 96)} ${p2(bx + 1)} ${p2(by - 97)} Z" fill="${P.thatchDark}" opacity="0.65"/>`;
  art.add(`<g filter="url(#${f2})">${t}</g>`);
  // crossbar, rope and bucket
  art.add(`<rect x="${p2(bx - 34)}" y="${p2(by - 96)}" width="68" height="6" rx="2.5" fill="${P.timberDark}"/>`);
  art.add(`<line x1="${p2(bx + 6)}" y1="${p2(by - 90)}" x2="${p2(bx + 6)}" y2="${p2(by - 62)}" stroke="${P.cloth}" stroke-width="2"/>`);
  art.add(
    `<path d="M${p2(bx - 3)} ${p2(by - 62)} L${p2(bx + 15)} ${p2(by - 62)} L${p2(bx + 12)} ${p2(by - 46)} L${p2(bx)} ${p2(by - 46)} Z" fill="${P.timber}"/>` +
      `<ellipse cx="${p2(bx + 6)}" cy="${p2(by - 62)}" rx="9" ry="3" fill="${P.timberLight}"/>` +
      `<path d="M${p2(bx - 3)} ${p2(by - 57)} L${p2(bx + 15)} ${p2(by - 57)}" stroke="${P.iron}" stroke-width="1.4"/>`,
  );
  return { key: 'well', w: W, h: H, ox: bx, oy: by, svg: art.svg(W, H), collide: { x: -40, y: -34, w: 80, h: 34 }, layer: 'sort' };
}

function fence(key: string, kind: 'h' | 'v' | 'post' | 'gate'): PropDef {
  const horizontal = kind === 'h' || kind === 'gate';
  const W = horizontal ? 128 : 64;
  const H = 96;
  const bx = W / 2;
  const by = H - 8;
  const art = new Art();
  const f = art.washFilter({ wobble: 1.1, freq: 0.08, seed: 71, edge: 0.3, edgeColor: shade(P.timber, -0.5), edgeWidth: 1.5 });
  let s = '';
  const postH = 52;
  const post = (x: number) => {
    s += `<path d="M${p2(x - 5)} ${p2(by)} L${p2(x - 4)} ${p2(by - postH)} L${p2(x)} ${p2(by - postH - 5)} L${p2(x + 4)} ${p2(by - postH)} L${p2(x + 5)} ${p2(by)} Z" fill="${P.timber}"/>`;
    s += `<path d="M${p2(x + 1)} ${p2(by)} L${p2(x + 1)} ${p2(by - postH - 2)} L${p2(x + 4)} ${p2(by - postH)} L${p2(x + 5)} ${p2(by)} Z" fill="${P.timberDark}" opacity="0.55"/>`;
  };
  if (kind === 'post') {
    post(bx);
  } else if (horizontal) {
    for (const y of [by - 42, by - 24]) {
      s += `<rect x="0" y="${p2(y)}" width="${W}" height="7" rx="2.5" fill="${kind === 'gate' ? P.timberLight : P.timber}"/>`;
      s += `<rect x="0" y="${p2(y + 4.5)}" width="${W}" height="2.5" fill="${P.timberDark}" opacity="0.6"/>`;
    }
    if (kind === 'gate') {
      s += `<path d="${stroke(
        [
          [6, by - 18],
          [W / 2, by - 30],
          [W - 6, by - 42],
        ],
        3.4,
        3.4,
      )}" fill="${P.timberLight}"/>`;
    }
    post(6);
    post(W - 6);
  } else {
    for (const x of [bx - 9, bx + 9]) {
      s += `<rect x="${p2(x - 3.5)}" y="0" width="7" height="${H}" rx="2.5" fill="${P.timber}"/>`;
      s += `<rect x="${p2(x + 1)}" y="0" width="2.5" height="${H}" fill="${P.timberDark}" opacity="0.6"/>`;
    }
    post(bx);
  }
  art.add(`<g filter="url(#${f})">${s}</g>`);
  art.castShadow(bx + 10, by - 2, horizontal ? W * 0.5 : 14, 5, SHADOW.opacity, 2);
  return {
    key,
    w: W,
    h: H,
    ox: bx,
    oy: by,
    svg: art.svg(W, H),
    collide:
      kind === 'post'
        ? { x: -6, y: -8, w: 12, h: 8 }
        : horizontal
          ? { x: -W / 2, y: -8, w: W, h: 8 }
          : { x: -12, y: -H + 8, w: 24, h: H - 8 },
    layer: 'sort',
  };
}

function barrel(key: string, tipped: boolean): PropDef {
  const W = 60;
  const H = 72;
  const bx = W / 2;
  const by = H - 6;
  const art = new Art();
  shadowFor(art, bx, by, 19, 6);
  const f = art.washFilter({ wobble: 1.1, freq: 0.08, seed: 81, edge: 0.3, edgeColor: shade(P.timber, -0.5), edgeWidth: 1.6 });
  let s = '';
  if (tipped) {
    s += `<rect x="${p2(bx - 24)}" y="${p2(by - 26)}" width="48" height="26" rx="11" fill="${P.timber}"/>`;
    s += `<ellipse cx="${p2(bx + 23)}" cy="${p2(by - 13)}" rx="5" ry="13" fill="${P.timberLight}"/>`;
    for (const x of [bx - 12, bx + 8]) s += `<rect x="${p2(x)}" y="${p2(by - 26)}" width="4" height="26" fill="${P.iron}" opacity="0.7"/>`;
  } else {
    s += `<path d="M${p2(bx - 17)} ${p2(by)} Q${p2(bx - 22)} ${p2(by - 22)} ${p2(bx - 17)} ${p2(by - 44)} L${p2(bx + 17)} ${p2(by - 44)} Q${p2(bx + 22)} ${p2(by - 22)} ${p2(bx + 17)} ${p2(by)} Q${p2(bx)} ${p2(by + 3)} ${p2(bx - 17)} ${p2(by)} Z" fill="${P.timber}"/>`;
    s += `<path d="M${p2(bx + 4)} ${p2(by - 44)} Q${p2(bx + 22)} ${p2(by - 22)} ${p2(bx + 17)} ${p2(by)} Q${p2(bx + 10)} ${p2(by + 2)} ${p2(bx + 4)} ${p2(by + 1)} Z" fill="${P.timberDark}" opacity="0.5"/>`;
    s += `<ellipse cx="${p2(bx)}" cy="${p2(by - 44)}" rx="17" ry="6" fill="${P.timberLight}"/>`;
    for (const y of [by - 36, by - 12]) s += `<path d="M${p2(bx - 20)} ${p2(y)} Q${p2(bx)} ${p2(y + 3)} ${p2(bx + 20)} ${p2(y)} L${p2(bx + 20)} ${p2(y + 4)} Q${p2(bx)} ${p2(y + 7)} ${p2(bx - 20)} ${p2(y + 4)} Z" fill="${P.iron}" opacity="0.75"/>`;
  }
  art.add(`<g filter="url(#${f})">${s}</g>`);
  return { key, w: W, h: H, ox: bx, oy: by, svg: art.svg(W, H), collide: { x: -18, y: -20, w: 36, h: 20 }, layer: 'sort' };
}

function cart(): PropDef {
  const W = 180;
  const H = 120;
  const bx = W / 2;
  const by = H - 8;
  const art = new Art();
  shadowFor(art, bx, by, 66, 12);
  const f = art.washFilter({ wobble: 1.2, freq: 0.07, seed: 91, edge: 0.3, edgeColor: shade(P.timber, -0.5), edgeWidth: 1.8 });
  let s = '';
  // bed
  s += `<path d="M${p2(bx - 62)} ${p2(by - 46)} L${p2(bx + 62)} ${p2(by - 46)} L${p2(bx + 56)} ${p2(by - 20)} L${p2(bx - 56)} ${p2(by - 20)} Z" fill="${P.timber}"/>`;
  s += plankWall(bx - 62, by - 64, 124, 20, P.timberLight, true, 92);
  s += `<path d="M${p2(bx - 62)} ${p2(by - 64)} L${p2(bx + 62)} ${p2(by - 64)} L${p2(bx + 62)} ${p2(by - 60)} L${p2(bx - 62)} ${p2(by - 60)} Z" fill="${P.timberDark}" opacity="0.5"/>`;
  // shafts
  s += `<path d="${stroke(
    [
      [bx - 60, by - 40],
      [bx - 86, by - 34],
    ],
    3,
    2,
  )}" fill="${P.timberDark}"/>`;
  art.add(`<g filter="url(#${f})">${s}</g>`);
  // wheels
  for (const [wx, scale, tone] of [
    [bx - 34, 1, P.timberDark],
    [bx + 34, 1, P.timber],
  ] as Array<[number, number, string]>) {
    art.add(`<circle cx="${p2(wx)}" cy="${p2(by - 18)}" r="${p2(18 * scale)}" fill="${tone}"/>`);
    art.add(`<circle cx="${p2(wx)}" cy="${p2(by - 18)}" r="${p2(13 * scale)}" fill="none" stroke="${shade(tone, -0.3)}" stroke-width="2"/>`);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      art.add(
        `<line x1="${p2(wx)}" y1="${p2(by - 18)}" x2="${p2(wx + Math.cos(a) * 16 * scale)}" y2="${p2(by - 18 + Math.sin(a) * 16 * scale)}" stroke="${shade(tone, -0.25)}" stroke-width="2.2"/>`,
      );
    }
    art.add(`<circle cx="${p2(wx)}" cy="${p2(by - 18)}" r="4" fill="${P.iron}"/>`);
  }
  // hay load
  const rnd = rng(93);
  let hay = '';
  for (let i = 0; i < 26; i++) {
    const x = bx - 56 + rnd() * 112;
    const y = by - 66 - rnd() * 10;
    hay += `<path d="M${p2(x)} ${p2(y)} l${p2((rnd() - 0.5) * 10)} ${p2(-4 - rnd() * 5)}" stroke="${rnd() > 0.5 ? P.hay : P.wheatLight}" stroke-width="1.6" stroke-linecap="round"/>`;
  }
  art.add(hay);
  return { key: 'cart', w: W, h: H, ox: bx, oy: by, svg: art.svg(W, H), collide: { x: -64, y: -34, w: 128, h: 34 }, layer: 'sort' };
}

function dryingRack(): PropDef {
  const W = 160;
  const H = 130;
  const bx = W / 2;
  const by = H - 8;
  const art = new Art();
  shadowFor(art, bx, by, 56, 10);
  const f = art.washFilter({ wobble: 1.1, freq: 0.08, seed: 101, edge: 0.3, edgeColor: shade(P.timber, -0.5), edgeWidth: 1.6 });
  let s = '';
  for (const x of [bx - 54, bx + 54]) {
    s += `<path d="${stroke(
      [
        [x - 12, by],
        [x, by - 96],
      ],
      3.4,
      2.6,
    )}" fill="${P.timber}"/>`;
    s += `<path d="${stroke(
      [
        [x + 12, by],
        [x, by - 96],
      ],
      3.4,
      2.6,
    )}" fill="${P.timberDark}"/>`;
  }
  s += `<rect x="${p2(bx - 60)}" y="${p2(by - 98)}" width="120" height="6" rx="2.5" fill="${P.timberLight}"/>`;
  s += `<rect x="${p2(bx - 56)}" y="${p2(by - 74)}" width="112" height="5" rx="2" fill="${P.timber}"/>`;
  art.add(`<g filter="url(#${f})">${s}</g>`);
  // hanging fish
  const rnd = rng(102);
  for (let i = 0; i < 7; i++) {
    const x = bx - 48 + i * 16 + rnd() * 3;
    const y = by - 92;
    const len = 26 + rnd() * 8;
    art.add(`<line x1="${p2(x)}" y1="${p2(y)}" x2="${p2(x)}" y2="${p2(y + 6)}" stroke="${P.cloth}" stroke-width="1"/>`);
    art.add(
      `<path d="M${p2(x)} ${p2(y + 6)} Q${p2(x - 6)} ${p2(y + 6 + len * 0.5)} ${p2(x)} ${p2(y + 6 + len)} Q${p2(x + 6)} ${p2(y + 6 + len * 0.5)} ${p2(x)} ${p2(y + 6)} Z" fill="${i % 2 ? '#B9C4C9' : '#A6B2B8'}"/>`,
    );
    art.add(`<path d="M${p2(x - 4)} ${p2(y + 6 + len)} L${p2(x)} ${p2(y + len)} L${p2(x + 4)} ${p2(y + 6 + len)} Z" fill="#8E9AA0"/>`);
    art.add(`<circle cx="${p2(x - 1.6)}" cy="${p2(y + 12)}" r="1" fill="#33403F"/>`);
  }
  return { key: 'drying_rack', w: W, h: H, ox: bx, oy: by, svg: art.svg(W, H), collide: { x: -60, y: -12, w: 120, h: 12 }, layer: 'sort' };
}

function choppingBlock(): PropDef {
  const W = 90;
  const H = 80;
  const bx = W / 2;
  const by = H - 6;
  const art = new Art();
  shadowFor(art, bx, by, 26, 8);
  const f = art.washFilter({ wobble: 1.2, freq: 0.08, seed: 111, edge: 0.3, edgeColor: shade(P.bark, -0.5), edgeWidth: 1.8 });
  let s = `<path d="M${p2(bx - 20)} ${p2(by)} L${p2(bx - 19)} ${p2(by - 28)} L${p2(bx + 19)} ${p2(by - 28)} L${p2(bx + 20)} ${p2(by)} Q${p2(bx)} ${p2(by + 3)} ${p2(bx - 20)} ${p2(by)} Z" fill="${P.bark}"/>`;
  s += `<ellipse cx="${p2(bx)}" cy="${p2(by - 28)}" rx="19" ry="7" fill="${P.barkLight}"/>`;
  art.add(`<g filter="url(#${f})">${s}</g>`);
  for (let i = 1; i <= 3; i++) {
    art.add(`<ellipse cx="${p2(bx)}" cy="${p2(by - 28)}" rx="${p2(19 * (i / 4))}" ry="${p2(7 * (i / 4))}" fill="none" stroke="${shade(P.bark, -0.3)}" stroke-width="0.9" opacity="0.6"/>`);
  }
  // axe
  art.add(`<path d="${stroke([[bx + 4, by - 30], [bx + 20, by - 62]], 2.4, 2.0)}" fill="${P.timberLight}"/>`);
  art.add(
    `<path d="M${p2(bx + 16)} ${p2(by - 58)} L${p2(bx + 30)} ${p2(by - 66)} Q${p2(bx + 34)} ${p2(by - 58)} ${p2(bx + 26)} ${p2(by - 50)} Z" fill="#9BA3A8"/>`,
  );
  // split logs on the ground
  const rnd = rng(112);
  for (let i = 0; i < 4; i++) {
    const x = bx - 34 + rnd() * 14;
    const y = by - 4 - i * 3;
    art.add(`<rect x="${p2(x)}" y="${p2(y)}" width="22" height="7" rx="3" fill="${i % 2 ? P.bark : P.barkLight}" transform="rotate(${p2(rnd() * 24 - 12)} ${p2(x + 11)} ${p2(y + 3)})"/>`);
  }
  return { key: 'chopping_block', w: W, h: H, ox: bx, oy: by, svg: art.svg(W, H), collide: { x: -22, y: -26, w: 44, h: 26 }, layer: 'sort' };
}

function jetty(): PropDef {
  const W = 128;
  const H = 96;
  const bx = W / 2;
  const by = H - 10;
  const art = new Art();
  const f = art.washFilter({ wobble: 1.2, freq: 0.07, seed: 121, edge: 0.3, edgeColor: shade(P.timber, -0.5), edgeWidth: 1.6 });
  let s = '';
  // posts going into the water
  for (const x of [bx - 46, bx + 46]) {
    s += `<rect x="${p2(x - 5)}" y="${p2(by - 26)}" width="10" height="34" rx="3" fill="${P.timberDark}"/>`;
  }
  // deck boards running across
  s += `<rect x="0" y="${p2(by - 40)}" width="${W}" height="22" fill="${P.timber}"/>`;
  for (let i = 0; i < 7; i++) {
    const y = by - 40 + i * 3.2;
    s += `<line x1="0" y1="${p2(y)}" x2="${W}" y2="${p2(y)}" stroke="${shade(P.timber, -0.35)}" stroke-width="0.9" opacity="0.6"/>`;
  }
  s += `<rect x="0" y="${p2(by - 42)}" width="${W}" height="4" fill="${P.timberLight}"/>`;
  s += `<rect x="0" y="${p2(by - 20)}" width="${W}" height="4" fill="${P.timberDark}" opacity="0.7"/>`;
  art.add(`<g filter="url(#${f})">${s}</g>`);
  return { key: 'jetty', w: W, h: H, ox: bx, oy: by, svg: art.svg(W, H), layer: 'sort' };
}

function rowboat(): PropDef {
  const W = 170;
  const H = 96;
  const bx = W / 2;
  const by = H - 16;
  const art = new Art();
  art.castShadow(bx + 10, by + 6, 70, 11, 0.2, 5);
  const f = art.washFilter({ wobble: 1.5, freq: 0.06, seed: 131, edge: 0.3, edgeColor: shade(P.timber, -0.55), edgeWidth: 2 });
  let s = '';
  s += `<path d="M${p2(bx - 76)} ${p2(by - 26)} Q${p2(bx)} ${p2(by + 10)} ${p2(bx + 76)} ${p2(by - 26)} Q${p2(bx + 60)} ${p2(by + 18)} ${p2(bx)} ${p2(by + 22)} Q${p2(bx - 60)} ${p2(by + 18)} ${p2(bx - 76)} ${p2(by - 26)} Z" fill="${P.timber}"/>`;
  s += `<path d="M${p2(bx - 76)} ${p2(by - 26)} Q${p2(bx)} ${p2(by + 10)} ${p2(bx + 76)} ${p2(by - 26)} Q${p2(bx)} ${p2(by - 2)} ${p2(bx - 76)} ${p2(by - 26)} Z" fill="${P.timberDark}"/>`;
  s += `<path d="M${p2(bx - 66)} ${p2(by - 24)} Q${p2(bx)} ${p2(by + 4)} ${p2(bx + 66)} ${p2(by - 24)} Q${p2(bx)} ${p2(by - 8)} ${p2(bx - 66)} ${p2(by - 24)} Z" fill="${shade(P.timber, -0.12)}"/>`;
  // planking lines along the hull
  for (let i = 1; i <= 3; i++) {
    s += `<path d="M${p2(bx - 76 + i * 3)} ${p2(by - 24 + i * 4)} Q${p2(bx)} ${p2(by + 12 + i * 2)} ${p2(bx + 76 - i * 3)} ${p2(by - 24 + i * 4)}" stroke="${shade(P.timber, -0.3)}" stroke-width="1.1" fill="none" opacity="0.6"/>`;
  }
  // thwarts
  for (const tx of [bx - 26, bx + 26]) s += `<rect x="${p2(tx - 18)}" y="${p2(by - 14)}" width="36" height="6" rx="2" fill="${P.timberLight}"/>`;
  art.add(`<g filter="url(#${f})">${s}</g>`);
  // oar
  art.add(`<path d="${stroke([[bx + 20, by - 12], [bx + 74, by - 40]], 2.4, 2.0)}" fill="${P.timberLight}"/>`);
  art.add(`<ellipse cx="${p2(bx + 80)}" cy="${p2(by - 43)}" rx="9" ry="4" fill="${P.timberLight}" transform="rotate(-28 ${p2(bx + 80)} ${p2(by - 43)})"/>`);
  return { key: 'rowboat', w: W, h: H, ox: bx, oy: by, svg: art.svg(W, H), sway: 'bob', collide: { x: -70, y: -24, w: 140, h: 36 }, layer: 'sort' };
}

function standingStone(): PropDef {
  const W = 120;
  const H = 210;
  const bx = W / 2;
  const by = H - 10;
  const art = new Art();
  const rnd = rng(141);
  shadowFor(art, bx, by, 38, 12, 0.3);
  const f = art.washFilter({ wobble: 1.8, freq: 0.05, seed: 141, edge: 0.32, edgeColor: P.rockDeep, edgeWidth: 2.4 });
  let s = `<path d="M${p2(bx - 26)} ${p2(by)} L${p2(bx - 22)} ${p2(by - 150)} Q${p2(bx - 16)} ${p2(by - 168)} ${p2(bx + 2)} ${p2(by - 170)} Q${p2(bx + 22)} ${p2(by - 164)} ${p2(bx + 24)} ${p2(by - 142)} L${p2(bx + 28)} ${p2(by)} Q${p2(bx)} ${p2(by + 5)} ${p2(bx - 26)} ${p2(by)} Z" fill="${P.rock}"/>`;
  s += `<path d="M${p2(bx + 6)} ${p2(by - 166)} Q${p2(bx + 22)} ${p2(by - 160)} ${p2(bx + 24)} ${p2(by - 142)} L${p2(bx + 28)} ${p2(by)} Q${p2(bx + 14)} ${p2(by + 2)} ${p2(bx + 8)} ${p2(by)} Z" fill="${P.rockDark}" opacity="0.6"/>`;
  s += `<path d="M${p2(bx - 24)} ${p2(by - 20)} Q${p2(bx - 20)} ${p2(by - 110)} ${p2(bx - 10)} ${p2(by - 160)}" stroke="${P.rockLight}" stroke-width="6" fill="none" opacity="0.4" stroke-linecap="round"/>`;
  art.add(`<g filter="url(#${f})">${s}</g>`);
  // runes
  let runes = '';
  for (let i = 0; i < 5; i++) {
    const y = by - 40 - i * 22;
    const x = bx - 4;
    runes += `<path d="M${p2(x)} ${p2(y)} l0 -12 M${p2(x)} ${p2(y - 10)} l${p2(4 + rnd() * 4)} ${p2(-4 - rnd() * 3)} M${p2(x)} ${p2(y - 4)} l${p2(-4 - rnd() * 3)} ${p2(-4 - rnd() * 2)}" stroke="${P.rockDeep}" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.8"/>`;
  }
  art.add(runes);
  // moss at the base
  for (let i = 0; i < 6; i++) {
    art.add(`<ellipse cx="${p2(bx + (rnd() - 0.5) * 44)}" cy="${p2(by - rnd() * 14)}" rx="${p2(5 + rnd() * 7)}" ry="${p2(2.5 + rnd() * 2)}" fill="${P.shrub}" opacity="0.55"/>`);
  }
  return { key: 'standing_stone', w: W, h: H, ox: bx, oy: by, svg: art.svg(W, H), collide: { x: -28, y: -24, w: 56, h: 24 }, layer: 'sort' };
}

function noticePost(): PropDef {
  const W = 110;
  const H = 150;
  const bx = W / 2;
  const by = H - 8;
  const art = new Art();
  shadowFor(art, bx, by, 22, 7);
  const f = art.washFilter({ wobble: 1.1, freq: 0.08, seed: 151, edge: 0.3, edgeColor: shade(P.timber, -0.5), edgeWidth: 1.6 });
  let s = `<rect x="${p2(bx - 5)}" y="${p2(by - 108)}" width="10" height="108" rx="3" fill="${P.timber}"/>`;
  s += `<rect x="${p2(bx + 1)}" y="${p2(by - 108)}" width="4" height="108" fill="${P.timberDark}" opacity="0.55"/>`;
  s += `<path d="M${p2(bx - 38)} ${p2(by - 110)} L${p2(bx + 38)} ${p2(by - 110)} L${p2(bx + 38)} ${p2(by - 70)} L${p2(bx - 38)} ${p2(by - 70)} Z" fill="${P.timberLight}"/>`;
  s += `<path d="M${p2(bx - 44)} ${p2(by - 116)} L${p2(bx + 44)} ${p2(by - 116)} L${p2(bx + 40)} ${p2(by - 108)} L${p2(bx - 40)} ${p2(by - 108)} Z" fill="${P.timberDark}"/>`;
  art.add(`<g filter="url(#${f})">${s}</g>`);
  // carved rune marks standing in for text
  const rnd = rng(152);
  let marks = '';
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 7; i++) {
      const x = bx - 30 + i * 9;
      const y = by - 102 + row * 11;
      if (rnd() > 0.78) continue;
      marks += `<path d="M${p2(x)} ${p2(y)} l0 6 M${p2(x)} ${p2(y + 1)} l${p2(3 + rnd() * 2)} ${p2(2)}" stroke="${shade(P.timber, -0.55)}" stroke-width="1.3" fill="none" stroke-linecap="round" opacity="0.8"/>`;
    }
  }
  art.add(marks);
  return { key: 'notice_post', w: W, h: H, ox: bx, oy: by, svg: art.svg(W, H), collide: { x: -8, y: -10, w: 16, h: 10 }, layer: 'sort' };
}

function campfire(): PropDef {
  const W = 110;
  const H = 76;
  const bx = W / 2;
  const by = H - 10;
  const art = new Art();
  const rnd = rng(161);
  art.castShadow(bx + 8, by - 2, 38, 12, 0.22, 3);
  // stone ring
  const f = art.washFilter({ wobble: 1.4, freq: 0.07, seed: 161, edge: 0.3, edgeColor: P.rockDeep, edgeWidth: 1.6 });
  let s = `<ellipse cx="${p2(bx)}" cy="${p2(by - 6)}" rx="34" ry="14" fill="#3A322C"/>`;
  s += `<ellipse cx="${p2(bx)}" cy="${p2(by - 7)}" rx="24" ry="9" fill="#241E1A"/>`;
  art.add(`<g filter="url(#${f})">${s}</g>`);
  let stones = '';
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const x = bx + Math.cos(a) * 33;
    const y = by - 6 + Math.sin(a) * 13;
    stones += `<path d="${blobPath(x, y, 7 + rnd() * 2, 5 + rnd() * 2, rnd, 8, 0.2)}" fill="${i % 2 ? P.rock : P.rockDark}"/>`;
    stones += `<path d="${blobPath(x - 1.6, y - 1.6, 3.6, 2.4, rnd, 7, 0.22)}" fill="${P.rockLight}" opacity="0.6"/>`;
  }
  art.add(stones);
  // logs
  for (let i = 0; i < 3; i++) {
    const a = -0.5 + i * 0.9;
    art.add(
      `<g transform="rotate(${p2((a * 180) / Math.PI)} ${p2(bx)} ${p2(by - 12)})"><rect x="${p2(bx - 22)}" y="${p2(by - 16)}" width="44" height="9" rx="4" fill="${i % 2 ? P.bark : P.barkLight}"/>` +
        `<ellipse cx="${p2(bx + 22)}" cy="${p2(by - 11.5)}" rx="3" ry="4.5" fill="${P.barkLight}"/></g>`,
    );
  }
  return { key: 'campfire', w: W, h: H, ox: bx, oy: by, svg: art.svg(W, H), collide: { x: -32, y: -16, w: 64, h: 16 }, layer: 'sort' };
}

/** Animated flame frames, drawn above the campfire. */
function flame(i: number): PropDef {
  const W = 72;
  const H = 110;
  const bx = W / 2;
  const by = H - 8;
  const art = new Art();
  const t = (i / 6) * Math.PI * 2;
  const sway = Math.sin(t) * 4;
  const h = 62 + Math.cos(t * 2) * 8;
  const lick = (sc: number, fill: string, dx: number) => {
    const w = 20 * sc;
    return (
      `<path d="M${p2(bx - w + dx)} ${p2(by)} Q${p2(bx - w * 1.25 + dx)} ${p2(by - h * 0.42 * sc)} ${p2(bx - w * 0.25 + dx + sway * sc)} ${p2(by - h * 0.68 * sc)} ` +
      `Q${p2(bx + sway * 1.7 * sc + dx)} ${p2(by - h * sc)} ${p2(bx + w * 0.16 + dx + sway * sc)} ${p2(by - h * 0.74 * sc)} ` +
      `Q${p2(bx + w * 0.9 + dx)} ${p2(by - h * 0.46 * sc)} ${p2(bx + w + dx)} ${p2(by)} Q${p2(bx + dx)} ${p2(by + 5 * sc)} ${p2(bx - w + dx)} ${p2(by)} Z" fill="${fill}"/>`
    );
  };
  art.add(lick(1, '#E8562A', 0));
  art.add(lick(0.78, P.fire, 1.5));
  art.add(lick(0.46, '#FFC24D', 0.5));
  art.add(lick(0.22, P.fireCore, 0));
  // sparks
  const rnd = rng(170 + i);
  for (let k = 0; k < 4; k++) {
    art.add(
      `<circle cx="${p2(bx + (rnd() - 0.5) * 30)}" cy="${p2(by - h - rnd() * 22)}" r="${p2(0.9 + rnd() * 1.3)}" fill="${P.fireCore}" opacity="${p2(0.5 + rnd() * 0.5)}"/>`,
    );
  }
  return { key: `flame_${i}`, w: W, h: H, ox: bx, oy: by, svg: art.svg(W, H), layer: 'sort' };
}

/** Smoke puff frames for the longhouse roof and the campfire. */
function smoke(i: number): PropDef {
  const W = 72;
  const H = 72;
  const art = new Art();
  const rnd = rng(180 + i);
  const b = art.blurFilter(3.2);
  let s = '';
  for (let k = 0; k < 4; k++) {
    s += `<circle cx="${p2(26 + rnd() * 20)}" cy="${p2(26 + rnd() * 20)}" r="${p2(10 + rnd() * 9)}" fill="#E7EAEC" opacity="0.5"/>`;
  }
  art.add(`<g filter="url(#${b})">${s}</g>`);
  return { key: `smoke_${i}`, w: W, h: H, ox: W / 2, oy: H / 2, svg: art.svg(W, H), layer: 'overlay' };
}

export function structureProps(): PropDef[] {
  return [
    longhouse(),
    outbuilding('barn', 220, 190, false, 201, 70),
    outbuilding('storehouse', 150, 140, true, 211, 48),
    outbuilding('smokehouse', 110, 130, true, 221, 40),
    well(),
    fence('fence_h', 'h'),
    fence('fence_v', 'v'),
    fence('fence_post', 'post'),
    fence('fence_gate', 'gate'),
    barrel('barrel', false),
    barrel('barrel_tipped', true),
    cart(),
    dryingRack(),
    choppingBlock(),
    jetty(),
    rowboat(),
    standingStone(),
    noticePost(),
    campfire(),
    flame(0), flame(1), flame(2), flame(3), flame(4), flame(5),
    smoke(0), smoke(1), smoke(2), smoke(3),
  ];
}
void mix;

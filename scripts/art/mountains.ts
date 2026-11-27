/**
 * The mountain ring. Tall oblique ridge sprites that stand along the map border: you see the rock
 * face from slightly above, snow on the northern caps, pine-covered lower slopes. They y-sort like
 * any other prop, so the player can walk in front of the lowest slopes.
 */
import { Art, blobPath, stroke, shade } from './wc.js';
import { P, SHADOW } from './palette.js';
import { rng } from './util.js';
import type { PropDef } from './propdef.js';

const p2 = (n: number) => n.toFixed(1);

interface RidgeOpts {
  key: string;
  w: number;
  h: number;
  peaks: number;
  snow: number;
  /** 0 = bare rock, 1 = dense pines on the lower slope */
  pines: number;
  seed: number;
}

function ridge(o: RidgeOpts): PropDef {
  const W = o.w;
  const H = o.h;
  const bx = W / 2;
  const by = H - 6;
  const art = new Art();
  const rnd = rng(o.seed);
  const f = art.washFilter({ wobble: 2.6, freq: 0.035, octaves: 4, seed: o.seed, edge: 0.26, edgeColor: P.rockDeep, edgeWidth: 3 });

  // silhouette: a run of jagged peaks
  const pts: Array<[number, number]> = [[-10, by]];
  // Peak positions are recorded, not re-rolled: the shading and the snow caps must use exactly the
  // same peaks as the silhouette or the snow floats off the summit.
  const peaks: Array<{ x: number; y: number; hw: number }> = [];
  for (let i = 0; i < o.peaks; i++) {
    const t = (i + 0.5) / o.peaks;
    const px = t * W + (rnd() - 0.5) * (W / o.peaks) * 0.4;
    const ph = by - H * (0.52 + rnd() * 0.46);
    peaks.push({ x: px, y: ph, hw: W / o.peaks / 2.1 });
    // up the shoulder
    pts.push([px - W / o.peaks / 2.1, by - (by - ph) * (0.35 + rnd() * 0.2)]);
    pts.push([px - W / o.peaks / 6, ph + H * 0.05 * rnd()]);
    pts.push([px, ph]);
    pts.push([px + W / o.peaks / 5, ph + H * 0.06 * rnd()]);
    pts.push([px + W / o.peaks / 2.1, by - (by - ph) * (0.3 + rnd() * 0.22)]);
  }
  pts.push([W + 10, by]);
  const outline = `M${pts.map(([x, y]) => `${p2(x)} ${p2(y)}`).join(' L')} L${W + 10} ${p2(by + 20)} L-10 ${p2(by + 20)} Z`;

  let s = `<path d="${outline}" fill="${P.rock}"/>`;
  // lit left faces / shaded right faces per peak
  for (const pk of peaks) {
    const px = pk.x;
    const ph = pk.y;
    const halfW = pk.hw;
    s += `<path d="M${p2(px)} ${p2(ph)} L${p2(px + halfW)} ${p2(by)} L${p2(px)} ${p2(by)} Z" fill="${P.rockDark}" opacity="0.55"/>`;
    s += `<path d="M${p2(px)} ${p2(ph)} L${p2(px - halfW * 0.7)} ${p2(by)} L${p2(px - halfW * 0.2)} ${p2(by)} Z" fill="${P.rockLight}" opacity="0.4"/>`;
  }
  art.add(`<g filter="url(#${f})">${s}</g>`);

  // snow caps
  if (o.snow > 0) {
    const sf = art.washFilter({ wobble: 2.2, freq: 0.05, seed: o.seed + 3, edge: 0.18, edgeColor: P.snowShade, edgeWidth: 2 });
    let snow = '';
    for (let i = 0; i < peaks.length; i++) {
      const px = peaks[i].x;
      const ph = peaks[i].y;
      const depth = Math.min((by - ph) * 0.55, H * o.snow * (0.22 + rnd() * 0.16));
      // the cap must stay inside the silhouette, which narrows to the summit
      const hw = peaks[i].hw * (depth / (by - ph)) * 1.9;
      // drippy snowline
      let d = `M${p2(px - hw)} ${p2(ph + depth)}`;
      d += ` L${p2(px)} ${p2(ph + 1)} L${p2(px + hw)} ${p2(ph + depth)}`;
      for (let k = 5; k >= 0; k--) {
        const t = k / 5;
        const x = px - hw + 2 * hw * t;
        d += ` L${p2(x)} ${p2(ph + depth * (0.45 + 0.55 * Math.abs(Math.sin(t * 6 + i))))}`;
      }
      snow += `<path d="${d} Z" fill="${P.snow}"/>`;
      snow += `<path d="M${p2(px)} ${p2(ph + 1)} L${p2(px + hw)} ${p2(ph + depth)} L${p2(px + hw * 0.3)} ${p2(ph + depth * 0.8)} Z" fill="${P.snowShade}" opacity="0.7"/>`;
    }
    art.add(`<g filter="url(#${sf})">${snow}</g>`);
  }

  // pine-covered lower slope
  if (o.pines > 0) {
    const pf = art.washFilter({ wobble: 1.8, freq: 0.07, seed: o.seed + 9, edge: 0.2, edgeColor: shade(P.pineDeep, -0.3), edgeWidth: 1.6 });
    let trees = '';
    const n = Math.round(o.pines * W * 0.1);
    for (let i = 0; i < n; i++) {
      const x = rnd() * W;
      const yBase = by - rnd() * H * 0.3;
      const th = 14 + rnd() * 18;
      const hw = th * 0.32;
      const tone = rnd() > 0.5 ? P.pineDeep : P.pine;
      trees += `<path d="M${p2(x)} ${p2(yBase - th)} L${p2(x + hw)} ${p2(yBase - th * 0.42)} L${p2(x + hw * 0.6)} ${p2(yBase - th * 0.42)} L${p2(x + hw * 1.1)} ${p2(yBase)} L${p2(x - hw * 1.1)} ${p2(yBase)} L${p2(x - hw * 0.6)} ${p2(yBase - th * 0.42)} L${p2(x - hw)} ${p2(yBase - th * 0.42)} Z" fill="${tone}"/>`;
    }
    art.add(`<g filter="url(#${pf})">${trees}</g>`);
  }

  // haze at the foot, so ridges melt into the valley
  const hz = art.blurFilter(7);
  art.add(`<ellipse cx="${p2(bx)}" cy="${p2(by - 4)}" rx="${p2(W * 0.55)}" ry="${p2(H * 0.08)}" fill="${P.mist}" opacity="0.5" filter="url(#${hz})"/>`);

  return {
    key: o.key,
    w: W,
    h: H,
    ox: bx,
    oy: by,
    svg: art.svg(W, H),
    layer: 'sort',
  };
}

/** A waterfall pouring off a cliff, animated by scrolling in the engine. */
function waterfall(): PropDef {
  const W = 180;
  const H = 320;
  const bx = W / 2;
  const by = H - 8;
  const art = new Art();
  const rnd = rng(301);
  const f = art.washFilter({ wobble: 2.2, freq: 0.05, seed: 301, edge: 0.14, edgeColor: P.waterMid, edgeWidth: 2 });
  let s = `<path d="M${p2(bx - 34)} 0 L${p2(bx + 34)} 0 L${p2(bx + 46)} ${p2(by - 30)} Q${p2(bx)} ${p2(by - 14)} ${p2(bx - 46)} ${p2(by - 30)} Z" fill="${P.waterShallowLight}"/>`;
  s += `<path d="M${p2(bx - 20)} 0 L${p2(bx + 8)} 0 L${p2(bx + 16)} ${p2(by - 36)} Q${p2(bx - 4)} ${p2(by - 26)} ${p2(bx - 26)} ${p2(by - 36)} Z" fill="#FFFFFF" opacity="0.72"/>`;
  art.add(`<g filter="url(#${f})">${s}</g>`);
  // falling streaks
  let streaks = '';
  for (let i = 0; i < 22; i++) {
    const x = bx - 40 + rnd() * 80;
    const y0 = rnd() * (by - 60);
    const len = 24 + rnd() * 60;
    streaks += `<path d="${stroke(
      [
        [x, y0],
        [x + 2, y0 + len],
      ],
      1.3,
      0.7,
    )}" fill="#FFFFFF" opacity="${p2(0.25 + rnd() * 0.4)}"/>`;
  }
  art.add(streaks);
  // plunge pool foam
  const b = art.blurFilter(5);
  art.add(`<ellipse cx="${p2(bx)}" cy="${p2(by - 18)}" rx="62" ry="20" fill="#FFFFFF" opacity="0.55" filter="url(#${b})"/>`);
  let foam = '';
  for (let i = 0; i < 26; i++) {
    foam += `<circle cx="${p2(bx + (rnd() - 0.5) * 118)}" cy="${p2(by - 26 + rnd() * 26)}" r="${p2(1.4 + rnd() * 3)}" fill="#FFFFFF" opacity="${p2(0.4 + rnd() * 0.5)}"/>`;
  }
  art.add(foam);
  return { key: 'waterfall', w: W, h: H, ox: bx, oy: by, svg: art.svg(W, H), layer: 'sort' };
}

/** Soft mist band drifting between the ridges. */
function mistBand(i: number): PropDef {
  const W = 420;
  const H = 150;
  const art = new Art();
  const rnd = rng(320 + i);
  const b = art.blurFilter(16);
  let s = '';
  for (let k = 0; k < 9; k++) {
    s += `<ellipse cx="${p2(40 + rnd() * 340)}" cy="${p2(40 + rnd() * 70)}" rx="${p2(50 + rnd() * 70)}" ry="${p2(18 + rnd() * 20)}" fill="${P.mist}" opacity="0.6"/>`;
  }
  art.add(`<g filter="url(#${b})">${s}</g>`);
  return { key: `mist_${i}`, w: W, h: H, ox: W / 2, oy: H / 2, svg: art.svg(W, H), layer: 'overlay' };
}

export function mountainProps(): PropDef[] {
  return [
    ridge({ key: 'ridge_snow', w: 520, h: 300, peaks: 3, snow: 1, pines: 0.25, seed: 401 }),
    ridge({ key: 'ridge_snow_tall', w: 460, h: 400, peaks: 2, snow: 1.15, pines: 0.15, seed: 402 }),
    ridge({ key: 'ridge_pine', w: 540, h: 250, peaks: 4, snow: 0, pines: 1, seed: 403 }),
    ridge({ key: 'ridge_rock', w: 480, h: 220, peaks: 4, snow: 0, pines: 0.3, seed: 404 }),
    ridge({ key: 'ridge_low', w: 560, h: 160, peaks: 5, snow: 0, pines: 0.8, seed: 405 }),
    waterfall(),
    mistBand(0),
    mistBand(1),
    mistBand(2),
  ];
}
void blobPath;
void SHADOW;

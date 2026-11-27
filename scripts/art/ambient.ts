/**
 * Atmosphere and effect sprites: clouds and their shadows, birds, drifting leaves and pollen,
 * fireflies, splashes, ripples, footprints, dust, plus the full-screen light and vignette overlays.
 */
import { Art, stroke, shade } from './wc.js';
import { P } from './palette.js';
import { rng } from './util.js';
import type { PropDef } from './propdef.js';

const p2 = (n: number) => n.toFixed(1);

function cloud(key: string, w: number, h: number, seed: number): PropDef {
  const art = new Art();
  const rnd = rng(seed);
  const f = art.washFilter({ wobble: 4.2, freq: 0.02, octaves: 4, seed, edge: 0 });
  const b = art.blurFilter(2.6);
  let s = '';
  const n = 7 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = w * 0.14 + t * w * 0.72;
    const r = h * (0.2 + Math.sin(Math.PI * t) * 0.26 + rnd() * 0.07);
    s += `<circle cx="${p2(x)}" cy="${p2(h * 0.56 - Math.sin(Math.PI * t) * h * 0.16)}" r="${p2(r)}" fill="#FFFFFF"/>`;
  }
  s += `<rect x="${p2(w * 0.12)}" y="${p2(h * 0.5)}" width="${p2(w * 0.76)}" height="${p2(h * 0.24)}" rx="${p2(h * 0.12)}" fill="#FFFFFF"/>`;
  // soft grey underside
  let under = '';
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    under += `<circle cx="${p2(w * 0.14 + t * w * 0.72)}" cy="${p2(h * 0.66)}" r="${p2(h * (0.14 + rnd() * 0.08))}" fill="#C9D6E0"/>`;
  }
  art.add(`<g filter="url(#${f})"><g filter="url(#${b})">${under}${s}</g></g>`);
  return { key, w, h, ox: w / 2, oy: h / 2, svg: art.svg(w, h), layer: 'overlay' };
}

/** The blue-grey blob a cloud drops on the ground. */
function cloudShadow(key: string, w: number, h: number, seed: number): PropDef {
  const art = new Art();
  const rnd = rng(seed);
  const b = art.blurFilter(10);
  let s = '';
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    s += `<ellipse cx="${p2(w * 0.14 + t * w * 0.72)}" cy="${p2(h * 0.5 + (rnd() - 0.5) * h * 0.2)}" rx="${p2(w * 0.12)}" ry="${p2(h * 0.26)}" fill="${P.shadow}"/>`;
  }
  art.add(`<g filter="url(#${b})" opacity="0.5">${s}</g>`);
  return { key, w, h, ox: w / 2, oy: h / 2, svg: art.svg(w, h), layer: 'ground' };
}

function bird(i: number): PropDef {
  const W = 48;
  const H = 32;
  const cx = W / 2;
  const cy = H / 2;
  const art = new Art();
  const t = (i / 4) * Math.PI * 2;
  const up = Math.sin(t);
  const span = 15;
  const wing = (sgn: 1 | -1) =>
    `<path d="M${p2(cx)} ${p2(cy)} Q${p2(cx - sgn * 4)} ${p2(cy - up * 7 - 2)} ${p2(cx - sgn * span)} ${p2(cy - up * 10)} Q${p2(cx - sgn * 7)} ${p2(cy + 1)} ${p2(cx)} ${p2(cy + 2)} Z" fill="#4A4A52"/>`;
  art.add(wing(1) + wing(-1));
  art.add(`<ellipse cx="${p2(cx)}" cy="${p2(cy + 0.5)}" rx="4.2" ry="2.4" fill="#5A5A62"/>`);
  return { key: `bird_${i}`, w: W, h: H, ox: cx, oy: cy, svg: art.svg(W, H), layer: 'overlay' };
}

function simple(key: string, w: number, h: number, body: string, layer: PropDef['layer'] = 'ground'): PropDef {
  const art = new Art();
  art.add(body);
  return { key, w, h, ox: w / 2, oy: h / 2, svg: art.svg(w, h), layer };
}

function leaf(key: string, colour: string, seed: number): PropDef {
  const art = new Art();
  const rnd = rng(seed);
  const W = 16;
  const H = 16;
  art.add(
    `<path d="M8 2 Q${p2(13 + rnd())} 6 8 14 Q3 6 8 2 Z" fill="${colour}"/><path d="M8 3 L8 13" stroke="${shade(colour, -0.35)}" stroke-width="0.7"/>`,
  );
  return { key, w: W, h: H, ox: 8, oy: 8, svg: art.svg(W, H), layer: 'overlay' };
}

function footprint(key: string, wet: boolean): PropDef {
  const W = 16;
  const H = 22;
  const art = new Art();
  const col = wet ? '#4E6A74' : '#6E5A42';
  const op = wet ? 0.5 : 0.42;
  art.add(
    `<ellipse cx="8" cy="13" rx="3.6" ry="6" fill="${col}" opacity="${op}"/>` +
      `<ellipse cx="8.6" cy="4.6" rx="3.0" ry="2.6" fill="${col}" opacity="${op}"/>`,
  );
  return { key, w: W, h: H, ox: 8, oy: 11, svg: art.svg(W, H), layer: 'ground' };
}

export function ambientProps(): PropDef[] {
  const out: PropDef[] = [];
  out.push(cloud('cloud_a', 300, 140, 601), cloud('cloud_b', 230, 110, 602), cloud('cloud_c', 380, 160, 603));
  out.push(cloudShadow('cloudshadow_a', 300, 140, 601), cloudShadow('cloudshadow_b', 230, 110, 602), cloudShadow('cloudshadow_c', 380, 160, 603));
  out.push(bird(0), bird(1), bird(2), bird(3));
  out.push(leaf('leaf_a', '#C98A3C', 611), leaf('leaf_b', '#A86B2E', 612), leaf('leaf_c', P.grassLight, 613));
  out.push(footprint('footprint_dry', false), footprint('footprint_wet', true));

  // splash droplet, ripple ring, dust puff, pollen mote, firefly glow, spark
  out.push(simple('fx_drop', 12, 12, `<circle cx="6" cy="6" r="4" fill="#DFF2F5"/><circle cx="4.6" cy="4.6" r="1.5" fill="#FFFFFF"/>`, 'overlay'));
  out.push(
    simple(
      'fx_ripple',
      72,
      36,
      `<ellipse cx="36" cy="18" rx="30" ry="13" fill="none" stroke="#FFFFFF" stroke-width="2.6" opacity="0.8"/>` +
        `<ellipse cx="36" cy="18" rx="22" ry="9" fill="none" stroke="#FFFFFF" stroke-width="1.4" opacity="0.45"/>`,
    ),
  );
  out.push(simple('fx_dust', 24, 24, `<circle cx="12" cy="12" r="9" fill="#C9B894" opacity="0.6"/><circle cx="9" cy="10" r="5" fill="#E0D2B2" opacity="0.5"/>`, 'overlay'));
  out.push(simple('fx_pollen', 10, 10, `<circle cx="5" cy="5" r="3" fill="#FFF3C4" opacity="0.85"/>`, 'overlay'));
  out.push(simple('fx_spark', 10, 10, `<circle cx="5" cy="5" r="3" fill="${P.fireCore}"/>`, 'overlay'));
  out.push(
    simple(
      'fx_sparkle',
      28,
      28,
      `<path d="M14 0 L16.6 11.4 L28 14 L16.6 16.6 L14 28 L11.4 16.6 L0 14 L11.4 11.4 Z" fill="#FFF3C4"/>` +
        `<path d="M14 5 L15.4 12.6 L23 14 L15.4 15.4 L14 23 L12.6 15.4 L5 14 L12.6 12.6 Z" fill="#FFFFFF"/>`,
      'overlay',
    ),
  );
  {
    const art = new Art();
    const b = art.blurFilter(3);
    art.add(`<circle cx="16" cy="16" r="7" fill="#DFFF9E" filter="url(#${b})"/><circle cx="16" cy="16" r="2.6" fill="#FFFFD8"/>`);
    out.push({ key: 'fx_firefly', w: 32, h: 32, ox: 16, oy: 16, svg: art.svg(32, 32), layer: 'overlay' });
  }
  {
    // warm radial glow for the campfire and lit windows
    const art = new Art();
    const id = 'glowg';
    art.def(
      `<radialGradient id="${id}"><stop offset="0" stop-color="#FFB45A" stop-opacity="0.75"/><stop offset="0.45" stop-color="#FF8A3C" stop-opacity="0.3"/><stop offset="1" stop-color="#FF7A2A" stop-opacity="0"/></radialGradient>`,
    );
    art.add(`<circle cx="128" cy="128" r="128" fill="url(#${id})"/>`);
    out.push({ key: 'fx_glow', w: 256, h: 256, ox: 128, oy: 128, svg: art.svg(256, 256), layer: 'ground' });
  }
  {
    // soft blue shadow blob used for the player and the animals
    const art = new Art();
    const b = art.blurFilter(4);
    art.add(`<ellipse cx="40" cy="14" rx="26" ry="9" fill="${P.shadow}" opacity="0.3" filter="url(#${b})"/>`);
    out.push({ key: 'fx_shadow', w: 80, h: 28, ox: 40, oy: 14, svg: art.svg(80, 28), layer: 'ground' });
  }
  {
    // wind gust streak, drawn as a faint light smear travelling over the grass
    const art = new Art();
    const b = art.blurFilter(6);
    const rnd = rng(640);
    let s = '';
    for (let i = 0; i < 8; i++) {
      s += `<path d="${stroke(
        [
          [10 + rnd() * 30, 20 + rnd() * 30],
          [120 + rnd() * 60, 10 + rnd() * 40],
          [250 + rnd() * 40, 20 + rnd() * 30],
        ],
        3,
        1,
      )}" fill="#FFFFFF" opacity="0.5"/>`;
    }
    art.add(`<g filter="url(#${b})">${s}</g>`);
    out.push({ key: 'fx_gust', w: 320, h: 70, ox: 160, oy: 35, svg: art.svg(320, 70), layer: 'ground' });
  }
  return out;
}

/** Full-screen overlays, rendered once at 1x. */
export function overlaySvgs(): Record<string, string> {
  const out: Record<string, string> = {};
  {
    const art = new Art();
    art.def(
      `<radialGradient id="vg" cx="0.5" cy="0.5" r="0.72">` +
        `<stop offset="0.5" stop-color="#1A2A1E" stop-opacity="0"/>` +
        `<stop offset="0.82" stop-color="#16242C" stop-opacity="0.18"/>` +
        `<stop offset="1" stop-color="#101C22" stop-opacity="0.46"/></radialGradient>`,
    );
    art.add(`<rect width="512" height="512" fill="url(#vg)"/>`);
    out.overlay_vignette = art.svg(512, 512);
  }
  {
    // Tileable macro variation: a large, low-frequency wash laid over the whole ground layer so the
    // 64px terrain tiles stop reading as a grid. Deliberately not a multiple of the tile size.
    const art = new Art();
    const f = art.washFilter({ wobble: 14, freq: 0.004, octaves: 5, seed: 31, edge: 0, stitch: false });
    const rnd = rng(900);
    let s = '';
    for (let i = 0; i < 26; i++) {
      const x = rnd() * 384;
      const y = rnd() * 384;
      const r = 40 + rnd() * 90;
      const dark = rnd() > 0.5;
      for (const dx of [-384, 0, 384]) {
        for (const dy of [-384, 0, 384]) {
          if (x + dx < -r || x + dx > 384 + r || y + dy < -r || y + dy > 384 + r) continue;
          s += `<circle cx="${p2(x + dx)}" cy="${p2(y + dy)}" r="${p2(r)}" fill="${dark ? '#000000' : '#FFFFFF'}" opacity="0.055"/>`;
        }
      }
    }
    art.add(`<g filter="url(#${f})">${s}</g>`);
    out.overlay_macro = art.svg(384, 384);
  }
  return out;
}

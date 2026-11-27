/**
 * Farm animals: cow, sheep, chicken, dog. Each is a 4-frame walk in 4 directions, emitted as
 * individual atlas frames named `<animal>_<dir>_<frame>` so the engine can build animations.
 */
import { Art, blobPath, shade } from './wc.js';
import { P, SHADOW } from './palette.js';
import { rng } from './util.js';
import type { PropDef } from './propdef.js';

const p2 = (n: number) => n.toFixed(1);
const DIRS = ['down', 'left', 'right', 'up'] as const;
type Dir = (typeof DIRS)[number];

interface Spec {
  key: string;
  w: number;
  h: number;
  /** body size in logical px */
  bodyW: number;
  bodyH: number;
  body: string;
  belly: string;
  dark: string;
  legLen: number;
  /** horns / comb / ears */
  head: 'cow' | 'sheep' | 'chicken' | 'dog';
  fluffy: boolean;
  patches: boolean;
  seed: number;
}

function animalFrame(sp: Spec, dir: Dir, frame: number): string {
  const art = new Art();
  const rnd = rng(sp.seed + frame * 7);
  const W = sp.w;
  const H = sp.h;
  const bx = W / 2;
  const by = H - 4;
  const side = dir === 'left' || dir === 'right';
  const back = dir === 'up';
  const phase = (frame / 4) * Math.PI * 2;
  const swing = Math.sin(phase);
  const bob = -Math.abs(Math.cos(phase)) * 1.2;

  art.castShadow(bx + sp.bodyW * 0.22, by - 1, sp.bodyW * 0.48, sp.bodyH * 0.2, SHADOW.opacity, 2.4);

  const bodyY = by - sp.legLen - sp.bodyH / 2 + bob;
  const bodyHalfW = side ? sp.bodyW / 2 : sp.bodyW * 0.36;

  // legs
  const legW = Math.max(2.2, sp.bodyW * 0.07);
  const legs: Array<[number, number]> = side
    ? [
        [bx - sp.bodyW * 0.3, swing],
        [bx - sp.bodyW * 0.22, -swing],
        [bx + sp.bodyW * 0.26, -swing],
        [bx + sp.bodyW * 0.34, swing],
      ]
    : [
        [bx - bodyHalfW * 0.6, swing],
        [bx + bodyHalfW * 0.6, -swing],
      ];
  for (const [lx, ph] of legs) {
    const lift = Math.max(0, ph) * 2.2;
    art.add(
      `<path d="M${p2(lx - legW / 2)} ${p2(bodyY + sp.bodyH * 0.35)} L${p2(lx + legW / 2)} ${p2(bodyY + sp.bodyH * 0.35)} L${p2(lx + legW / 2 + ph * 1.6)} ${p2(by - lift)} L${p2(lx - legW / 2 + ph * 1.6)} ${p2(by - lift)} Z" fill="${sp.dark}"/>`,
    );
    art.add(`<ellipse cx="${p2(lx + ph * 1.6)}" cy="${p2(by - lift)}" rx="${p2(legW * 0.75)}" ry="${p2(legW * 0.5)}" fill="${shade(sp.dark, -0.25)}"/>`);
  }

  // body
  const f = art.washFilter({ wobble: 1.3, freq: 0.08, seed: sp.seed, edge: 0.26, edgeColor: shade(sp.dark, -0.3), edgeWidth: 1.6 });
  let s = '';
  if (sp.fluffy) {
    // sheep: a cloud of wool lumps
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      s += `<circle cx="${p2(bx + Math.cos(a) * bodyHalfW * 0.75)}" cy="${p2(bodyY + Math.sin(a) * sp.bodyH * 0.34)}" r="${p2(sp.bodyH * 0.3)}" fill="${i % 2 ? sp.body : sp.belly}"/>`;
    }
    s += `<ellipse cx="${p2(bx)}" cy="${p2(bodyY)}" rx="${p2(bodyHalfW * 0.9)}" ry="${p2(sp.bodyH * 0.45)}" fill="${sp.body}"/>`;
  } else {
    s += `<path d="${blobPath(bx, bodyY, bodyHalfW, sp.bodyH * 0.5, rnd, 9, 0.1)}" fill="${sp.body}"/>`;
    s += `<ellipse cx="${p2(bx + bodyHalfW * 0.24)}" cy="${p2(bodyY + sp.bodyH * 0.16)}" rx="${p2(bodyHalfW * 0.6)}" ry="${p2(sp.bodyH * 0.3)}" fill="${sp.dark}" opacity="0.35"/>`;
    s += `<ellipse cx="${p2(bx - bodyHalfW * 0.3)}" cy="${p2(bodyY - sp.bodyH * 0.2)}" rx="${p2(bodyHalfW * 0.45)}" ry="${p2(sp.bodyH * 0.22)}" fill="${sp.belly}" opacity="0.65"/>`;
  }
  art.add(`<g filter="url(#${f})">${s}</g>`);

  if (sp.patches) {
    let patch = '';
    for (let i = 0; i < 3; i++) {
      patch += `<path d="${blobPath(bx + (rnd() - 0.5) * bodyHalfW * 1.1, bodyY + (rnd() - 0.5) * sp.bodyH * 0.5, sp.bodyW * 0.11, sp.bodyH * 0.17, rnd, 8, 0.3)}" fill="${sp.dark}" opacity="0.9"/>`;
    }
    art.add(patch);
  }

  // head
  const hx = side ? bx + bodyHalfW * (dir === 'right' ? 0.92 : -0.92) : bx;
  const hy = back ? bodyY - sp.bodyH * 0.42 : bodyY + (side ? -sp.bodyH * 0.22 : sp.bodyH * 0.42);
  const hr = sp.bodyH * (sp.head === 'chicken' ? 0.34 : 0.42);
  if (!back || sp.head === 'chicken') {
    art.add(`<ellipse cx="${p2(hx)}" cy="${p2(hy)}" rx="${p2(hr * (side ? 1.1 : 0.95))}" ry="${p2(hr)}" fill="${sp.fluffy ? sp.dark : sp.body}"/>`);
  }
  const faceVisible = !back;
  if (sp.head === 'cow') {
    for (const sgn of side ? [1] : [-1, 1]) {
      art.add(`<path d="M${p2(hx + sgn * hr * 0.8)} ${p2(hy - hr * 0.5)} q${p2(sgn * 5)} ${p2(-4)} ${p2(sgn * 3)} ${p2(-7)}" stroke="#E8DCC0" stroke-width="2.4" fill="none" stroke-linecap="round"/>`);
      art.add(`<ellipse cx="${p2(hx + sgn * hr * 0.95)}" cy="${p2(hy - hr * 0.1)}" rx="${p2(hr * 0.4)}" ry="${p2(hr * 0.26)}" fill="${sp.dark}"/>`);
    }
    if (faceVisible) {
      art.add(`<ellipse cx="${p2(hx + (side ? hr * 0.4 : 0))}" cy="${p2(hy + hr * 0.42)}" rx="${p2(hr * 0.5)}" ry="${p2(hr * 0.34)}" fill="#E0A8A0"/>`);
      for (const sgn of side ? [1] : [-1, 1]) art.add(`<circle cx="${p2(hx + sgn * hr * 0.4)}" cy="${p2(hy - hr * 0.2)}" r="1.5" fill="#2E2622"/>`);
    }
  } else if (sp.head === 'sheep') {
    for (const sgn of side ? [1] : [-1, 1]) art.add(`<ellipse cx="${p2(hx + sgn * hr * 0.9)}" cy="${p2(hy - hr * 0.05)}" rx="${p2(hr * 0.42)}" ry="${p2(hr * 0.22)}" fill="${shade(sp.dark, -0.2)}"/>`);
    if (faceVisible) for (const sgn of side ? [1] : [-1, 1]) art.add(`<circle cx="${p2(hx + sgn * hr * 0.34)}" cy="${p2(hy - hr * 0.1)}" r="1.4" fill="#2E2622"/>`);
  } else if (sp.head === 'chicken') {
    art.add(`<path d="M${p2(hx - hr * 0.3)} ${p2(hy - hr * 0.85)} q${p2(hr * 0.3)} ${p2(-hr * 0.5)} ${p2(hr * 0.6)} 0 q${p2(hr * 0.25)} ${p2(-hr * 0.35)} ${p2(hr * 0.4)} ${p2(hr * 0.2)}" fill="#C8453A"/>`);
    if (faceVisible) {
      art.add(`<path d="M${p2(hx + (side ? hr * 0.85 : 0))} ${p2(hy + hr * 0.1)} l${p2(side ? hr * 0.7 : 0)} ${p2(hr * 0.25)} l${p2(side ? -hr * 0.7 : 0)} ${p2(hr * 0.3)} Z" fill="#E8A33C"/>`);
      art.add(`<circle cx="${p2(hx + (side ? hr * 0.4 : 0))}" cy="${p2(hy - hr * 0.12)}" r="1.3" fill="#2E2622"/>`);
    }
  } else {
    // dog: snout + floppy ears + wagging tail
    if (faceVisible) {
      art.add(`<ellipse cx="${p2(hx + (side ? hr * 0.72 : 0))}" cy="${p2(hy + hr * 0.36)}" rx="${p2(hr * 0.5)}" ry="${p2(hr * 0.34)}" fill="${sp.belly}"/>`);
      art.add(`<circle cx="${p2(hx + (side ? hr * 1.0 : 0))}" cy="${p2(hy + hr * 0.34)}" r="1.7" fill="#2E2622"/>`);
      for (const sgn of side ? [1] : [-1, 1]) art.add(`<circle cx="${p2(hx + sgn * hr * 0.36)}" cy="${p2(hy - hr * 0.16)}" r="1.4" fill="#2E2622"/>`);
    }
    for (const sgn of side ? [-1] : [-1, 1]) {
      art.add(`<ellipse cx="${p2(hx + sgn * hr * 0.82)}" cy="${p2(hy - hr * 0.1)}" rx="${p2(hr * 0.3)}" ry="${p2(hr * 0.52)}" fill="${sp.dark}"/>`);
    }
  }
  // tail
  if (sp.head !== 'chicken') {
    const tx = side ? bx - bodyHalfW * (dir === 'right' ? 0.95 : -0.95) : bx;
    const ty = bodyY - sp.bodyH * 0.2;
    const wag = Math.sin(phase * 2) * 4;
    art.add(
      `<path d="M${p2(tx)} ${p2(ty)} q${p2(-8 + wag)} ${p2(sp.head === 'dog' ? -8 : 6)} ${p2(-10 + wag)} ${p2(sp.head === 'dog' ? -12 : 12)}" stroke="${sp.dark}" stroke-width="${p2(sp.head === 'dog' ? 3 : 2.2)}" fill="none" stroke-linecap="round"/>`,
    );
  } else {
    const tx = side ? bx - bodyHalfW * (dir === 'right' ? 0.9 : -0.9) : bx;
    art.add(`<path d="M${p2(tx)} ${p2(bodyY - sp.bodyH * 0.2)} q${-8} ${-10} ${-2} ${-16} q${6} ${4} ${8} ${12} Z" fill="${sp.dark}"/>`);
  }

  const svg = art.svg(W, H);
  return dir === 'left' ? svg.replace(/(<svg[^>]*>)/, `$1<g transform="translate(${W} 0) scale(-1 1)">`).replace(/<\/svg>$/, '</g></svg>') : svg;
}

const SPECS: Spec[] = [
  { key: 'cow', w: 120, h: 96, bodyW: 76, bodyH: 42, body: '#F0EBE2', belly: '#FFFFFF', dark: '#4A3F38', legLen: 20, head: 'cow', fluffy: false, patches: true, seed: 501 },
  { key: 'sheep', w: 96, h: 80, bodyW: 56, bodyH: 36, body: '#F4F1E8', belly: '#FFFFFF', dark: '#6B6358', legLen: 15, head: 'sheep', fluffy: true, patches: false, seed: 511 },
  { key: 'chicken', w: 56, h: 52, bodyW: 26, bodyH: 20, body: '#E8DFCE', belly: '#FFFFFF', dark: '#B08A52', legLen: 7, head: 'chicken', fluffy: false, patches: false, seed: 521 },
  { key: 'dog', w: 86, h: 66, bodyW: 46, bodyH: 24, body: '#B5884F', belly: '#E0C79A', dark: '#6E4F2A', legLen: 12, head: 'dog', fluffy: false, patches: false, seed: 531 },
];

export function animalProps(): PropDef[] {
  const out: PropDef[] = [];
  for (const sp of SPECS) {
    for (const dir of DIRS) {
      for (let f = 0; f < 4; f++) {
        out.push({
          key: `${sp.key}_${dir}_${f}`,
          w: sp.w,
          h: sp.h,
          ox: sp.w / 2,
          oy: sp.h - 4,
          svg: animalFrame(sp, dir, f),
          layer: 'sort',
        });
      }
    }
  }
  return out;
}

/** Collision + speed metadata the engine needs for each species. */
export const ANIMAL_INFO = SPECS.map((s) => ({
  key: s.key,
  frameW: s.w,
  frameH: s.h,
  collide: { x: -s.bodyW * 0.38, y: -s.bodyH * 0.5, w: s.bodyW * 0.76, h: s.bodyH * 0.5 },
}));
void P;

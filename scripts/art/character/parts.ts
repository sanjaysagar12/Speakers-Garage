/**
 * Character layer painters.
 *
 * Every tintable layer is drawn in GREYSCALE where white = "take the chosen colour at full
 * strength" and darker greys = shading. At runtime the layer is multiplied by the slot's colour, so
 * any hex works and the shading survives. Non-tintable detail (eyes, buckles, bark-like trim) lives
 * in separate `ink` layers drawn on top.
 */
import { anchors, limbPath, torsoPath, CW, FEET } from './rig.js';
import type { Anchors, Pose } from './rig.js';

/** greyscale ramp: V.base multiplies to exactly the chosen colour */
export const V = {
  hi: '#FFFFFF',
  base: '#F2F2F2',
  mid: '#D2D2D2',
  shade: '#AEAEAE',
  deep: '#8A8A8A',
  line: '#5E5E5E',
};

const INK = '#2E2622';

export type Slot = 'body' | 'hair' | 'top' | 'bottom' | 'shoes' | 'cloak' | 'accessory';

const p2 = (n: number) => n.toFixed(1);
const path = (d: string, fill: string, extra = '') => `<path d="${d}" fill="${fill}"${extra ? ' ' + extra : ''}/>`;
const ell = (cx: number, cy: number, rx: number, ry: number, fill: string, extra = '') =>
  `<ellipse cx="${p2(cx)}" cy="${p2(cy)}" rx="${p2(rx)}" ry="${p2(ry)}" fill="${fill}"${extra ? ' ' + extra : ''}/>`;

/* ------------------------------------------------------------------ body ---------------- */

/** Legs + torso + head + the far arm. Tinted with skin. */
export function drawBody(p: Pose): string {
  const a = anchors(p);
  let s = '';
  const legW0 = p.side ? 3.4 : 3.2;
  const legW1 = 2.6;
  // far leg first
  const far = p.side ? (p.swing > 0 ? a.footL : a.footR) : a.footL;
  const near = p.side ? (p.swing > 0 ? a.footR : a.footL) : a.footR;
  s += path(limbPath(a.bodyX - (p.side ? 0 : a.hipHalf * 0.55), a.hipY, far[0], far[1] - 2, legW0, legW1), V.shade);
  s += path(limbPath(a.bodyX + (p.side ? 0 : a.hipHalf * 0.55), a.hipY, near[0], near[1] - 2, legW0, legW1), V.base);

  // far arm, behind the torso
  if (p.side) {
    const h = p.swing > 0 ? a.handL : a.handR;
    s += path(limbPath(a.bodyX, a.shoulderY + 1, h[0], h[1], 3.0, 2.3), V.shade);
    s += ell(h[0], h[1] + 0.6, 2.5, 2.7, V.shade);
  }

  // torso
  s += path(torsoPath(a), V.base);
  // body shading down the right side
  s += path(torsoPath(a, -1.2).replace(/^M/, 'M'), V.base);
  s += path(
    `M${p2(a.bodyX + a.chestHalf * 0.3)} ${p2(a.shoulderY - 0.6)} L${p2(a.shoulderR)} ${p2(a.shoulderY + 1)} L${p2(a.bodyX + a.hipHalf)} ${p2(a.hipY)} L${p2(a.bodyX + a.hipHalf * 0.3)} ${p2(a.hipY)} Z`,
    V.mid,
    'opacity="0.55"',
  );

  // neck
  s += path(
    `M${p2(a.headX - 2.8)} ${p2(a.neckY - 3)} L${p2(a.headX + 2.8)} ${p2(a.neckY - 3)} L${p2(a.headX + 3.2)} ${p2(a.shoulderY + 0.6)} L${p2(a.headX - 3.2)} ${p2(a.shoulderY + 0.6)} Z`,
    V.mid,
  );

  // head: slightly egg-shaped, narrower at the chin
  const hx = a.headX + (p.side ? 1.1 : 0);
  s += path(
    `M${p2(hx - a.headR)} ${p2(a.headY - 0.5)} Q${p2(hx - a.headR)} ${p2(a.headY - a.headR * 1.25)} ${p2(hx)} ${p2(a.headY - a.headR * 1.25)} ` +
      `Q${p2(hx + a.headR)} ${p2(a.headY - a.headR * 1.25)} ${p2(hx + a.headR)} ${p2(a.headY - 0.5)} ` +
      `Q${p2(hx + a.headR * 0.92)} ${p2(a.headY + a.headR * 0.95)} ${p2(hx)} ${p2(a.headY + a.headR * 1.0)} ` +
      `Q${p2(hx - a.headR * 0.92)} ${p2(a.headY + a.headR * 0.95)} ${p2(hx - a.headR)} ${p2(a.headY - 0.5)} Z`,
    V.base,
  );
  // cheek/jaw shading on the shaded side
  s += ell(hx + a.headR * 0.5, a.headY + a.headR * 0.25, a.headR * 0.45, a.headR * 0.6, V.mid, 'opacity="0.5"');
  // ears
  if (p.side) {
    s += ell(hx - a.headR * 0.55, a.headY + 0.6, 1.9, 2.5, V.mid);
  } else {
    s += ell(hx - a.headR * 0.96, a.headY + 1, 1.9, 2.6, V.mid);
    s += ell(hx + a.headR * 0.96, a.headY + 1, 1.9, 2.6, V.mid);
  }
  return s;
}

/** The near arm(s), drawn over the torso so sleeves can sit on top of them. */
export function drawArms(p: Pose): string {
  const a = anchors(p);
  let s = '';
  if (p.side) {
    const h = p.swing > 0 ? a.handR : a.handL;
    s += path(limbPath(a.bodyX + 0.6, a.shoulderY + 1, h[0], h[1], 3.1, 2.4), V.base);
    s += ell(h[0], h[1] + 0.6, 2.6, 2.8, V.base);
  } else {
    for (const [h, tone] of [
      [a.handL, V.base],
      [a.handR, V.base],
    ] as Array<[[number, number], string]>) {
      const sx = h[0] < a.bodyX ? a.shoulderL + 0.8 : a.shoulderR - 0.8;
      s += path(limbPath(sx, a.shoulderY + 1.5, h[0], h[1], 3.0, 2.3), tone);
      s += ell(h[0], h[1] + 0.6, 2.5, 2.7, tone);
    }
  }
  return s;
}

/* ------------------------------------------------------------------ face ---------------- */

export function drawFace(p: Pose): string {
  if (p.back) return '';
  const a = anchors(p);
  const hx = a.headX + (p.side ? 1.1 : 0);
  const eyeY = a.headY + 1.2;
  let s = '';
  const eye = (x: number, w: number) => {
    if (p.blink) return `<path d="M${p2(x - w)} ${p2(eyeY)} q${p2(w)} ${1.4} ${p2(w * 2)} 0" stroke="${INK}" stroke-width="1.1" fill="none" stroke-linecap="round"/>`;
    return (
      ell(x, eyeY, w * 0.78, w * 1.15, INK) +
      `<circle cx="${p2(x + w * 0.2)}" cy="${p2(eyeY - w * 0.42)}" r="${p2(w * 0.3)}" fill="#FFFFFF" opacity="0.9"/>`
    );
  };
  const brow = (x: number, w: number) =>
    `<path d="M${p2(x - w)} ${p2(eyeY - 4.2)} q${p2(w)} ${-1.1} ${p2(w * 2)} 0" stroke="${INK}" stroke-width="1.1" fill="none" stroke-linecap="round" opacity="0.8"/>`;
  if (p.side) {
    s += eye(hx + a.headR * 0.42, 1.5);
    s += brow(hx + a.headR * 0.42, 1.7);
    s += `<path d="M${p2(hx + a.headR * 0.5)} ${p2(eyeY + 4.4)} q${1.4} ${0.9} ${2.6} ${-0.4}" stroke="${INK}" stroke-width="1" fill="none" stroke-linecap="round"/>`;
    // nose
    s += `<path d="M${p2(hx + a.headR * 0.68)} ${p2(eyeY + 1.2)} l${1.3} ${1.5} l${-1.5} ${0.5}" stroke="${INK}" stroke-width="0.9" fill="none" stroke-linejoin="round" opacity="0.6"/>`;
  } else {
    s += eye(hx - 3.6, 1.6) + eye(hx + 3.6, 1.6);
    s += brow(hx - 3.6, 1.8) + brow(hx + 3.6, 1.8);
    s += `<path d="M${p2(hx - 1.8)} ${p2(eyeY + 5)} q${1.8} ${1.5} ${3.6} 0" stroke="${INK}" stroke-width="1.1" fill="none" stroke-linecap="round"/>`;
  }
  s += ell(hx - (p.side ? 2.4 : 6.4), eyeY + 2.8, 2.0, 1.2, '#E8846E', 'opacity="0.38"');
  if (!p.side) s += ell(hx + 6.4, eyeY + 2.8, 2.0, 1.2, '#E8846E', 'opacity="0.38"');
  return s;
}

/* ------------------------------------------------------------------ helpers ------------- */

export { anchors, torsoPath, limbPath, CW, FEET, p2, path, ell };
export type { Anchors, Pose };

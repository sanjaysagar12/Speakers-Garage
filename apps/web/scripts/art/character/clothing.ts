/**
 * Clothing, in six slots. Every garment is drawn greyscale (white = full tint) so any colour can be
 * applied at runtime; sharp non-tinted details (buckles, stitching, fur, metal) go in a matching
 * `ink` layer that is composited on top untouched.
 */
import { anchors, torsoPath, limbPath, V } from './parts.js';
import type { Pose } from './rig.js';

const p2 = (n: number) => n.toFixed(1);
const path = (d: string, fill: string, extra = '') => `<path d="${d}" fill="${fill}"${extra ? ' ' + extra : ''}/>`;
const ell = (cx: number, cy: number, rx: number, ry: number, fill: string, extra = '') =>
  `<ellipse cx="${p2(cx)}" cy="${p2(cy)}" rx="${p2(rx)}" ry="${p2(ry)}" fill="${fill}"${extra ? ' ' + extra : ''}/>`;

export interface Option {
  id: string;
  label: string;
  draw: (p: Pose) => string;
  ink?: (p: Pose) => string;
}

/* ------------------------------------------------------------------ tops ---------------- */

/** Garment body with a hem, shoulder shading and a few fold lines. */
function garment(p: Pose, lengthen: number, grow: number, collar: 'round' | 'v' | 'none'): string {
  const a = anchors(p);
  let s = path(torsoPath(a, grow, lengthen), V.base);
  // shading down the shaded side
  s += path(
    `M${p2(a.bodyX + a.chestHalf * 0.25)} ${p2(a.shoulderY - 0.6)} L${p2(a.shoulderR + grow)} ${p2(a.shoulderY)} L${p2(a.bodyX + a.hipHalf + grow * 0.8)} ${p2(a.hipY + lengthen)} L${p2(a.bodyX + a.hipHalf * 0.2)} ${p2(a.hipY + lengthen)} Z`,
    V.mid,
    'opacity="0.75"',
  );
  // hem shadow
  s += path(
    `M${p2(a.bodyX - a.hipHalf - grow * 0.8)} ${p2(a.hipY + lengthen - 2.4)} L${p2(a.bodyX + a.hipHalf + grow * 0.8)} ${p2(a.hipY + lengthen - 2.4)} L${p2(a.bodyX + a.hipHalf + grow * 0.8)} ${p2(a.hipY + lengthen)} L${p2(a.bodyX - a.hipHalf - grow * 0.8)} ${p2(a.hipY + lengthen)} Z`,
    V.shade,
    'opacity="0.6"',
  );
  // fold lines
  for (let i = -1; i <= 1; i++) {
    if (i === 0 && collar === 'v') continue;
    const x = a.bodyX + i * a.chestHalf * 0.55;
    s += `<path d="M${p2(x)} ${p2(a.shoulderY + 4)} q${p2(i * 0.8)} ${p2((a.hipY - a.shoulderY) * 0.5)} ${p2(i * 1.4)} ${p2(a.hipY - a.shoulderY - 5 + lengthen)}" stroke="${V.shade}" stroke-width="0.8" fill="none" opacity="0.55"/>`;
  }
  if (!p.back) {
    if (collar === 'round') {
      s += ell(a.headX, a.shoulderY - 0.4, 3.4, 1.9, V.shade, 'opacity="0.8"');
    } else if (collar === 'v') {
      s += path(
        `M${p2(a.headX - 3.6)} ${p2(a.shoulderY - 1)} L${p2(a.headX)} ${p2(a.shoulderY + 5)} L${p2(a.headX + 3.6)} ${p2(a.shoulderY - 1)} Z`,
        V.shade,
        'opacity="0.8"',
      );
    }
  }
  return s;
}

/** Sleeves covering the upper arm, leaving forearm and hand as skin. */
function sleeves(p: Pose, len: number, grow = 0): string {
  const a = anchors(p);
  let s = '';
  const mk = (sx: number, sy: number, h: [number, number], tone: string) => {
    const dx = h[0] - sx;
    const dy = h[1] - sy;
    const l = Math.hypot(dx, dy) || 1;
    const ex = sx + (dx / l) * l * len;
    const ey = sy + (dy / l) * l * len;
    s += path(limbPath(sx, sy, ex, ey, 3.9 + grow, 3.2 + grow), tone);
    s += ell(ex, ey, 3.3 + grow, 1.8, V.shade, 'opacity="0.7"');
  };
  if (p.side) {
    const near = p.swing > 0 ? a.handR : a.handL;
    const far = p.swing > 0 ? a.handL : a.handR;
    mk(a.bodyX, a.shoulderY + 0.5, far, V.mid);
    mk(a.bodyX + 0.6, a.shoulderY + 0.5, near, V.base);
  } else {
    mk(a.shoulderL + 0.8, a.shoulderY + 1, a.handL, V.base);
    mk(a.shoulderR - 0.8, a.shoulderY + 1, a.handR, V.mid);
  }
  return s;
}

export const TOPS: Option[] = [
  {
    id: 'linen_tunic',
    label: 'Linen tunic',
    draw: (p) => garment(p, 7, 1.2, 'v') + sleeves(p, 0.52),
    ink: (p) => {
      const a = anchors(p);
      if (p.back) return '';
      return `<path d="M${p2(a.headX - 3.4)} ${p2(a.shoulderY - 0.6)} L${p2(a.headX)} ${p2(a.shoulderY + 5.4)} L${p2(a.headX + 3.4)} ${p2(a.shoulderY - 0.6)}" stroke="#6B5B44" stroke-width="0.9" fill="none" opacity="0.7"/>`;
    },
  },
  {
    id: 'wool_tunic',
    label: 'Wool tunic',
    draw: (p) => garment(p, 9, 1.6, 'round') + sleeves(p, 0.74, 0.3),
    ink: (p) => {
      const a = anchors(p);
      let s = '';
      for (let i = 0; i < 3; i++) {
        const y = a.shoulderY + 6 + i * 5;
        s += `<path d="M${p2(a.bodyX - a.chestHalf * 0.8)} ${p2(y)} q${p2(a.chestHalf * 0.8)} 1.2 ${p2(a.chestHalf * 1.6)} 0" stroke="#5C4A33" stroke-width="0.7" fill="none" opacity="0.45"/>`;
      }
      return s;
    },
  },
  {
    id: 'leather_jerkin',
    label: 'Leather jerkin',
    draw: (p) => garment(p, 5, 1.8, 'none') + sleeves(p, 0.3),
    ink: (p) => {
      const a = anchors(p);
      let s = '';
      // lacing up the front
      if (!p.back) {
        for (let i = 0; i < 4; i++) {
          const y = a.shoulderY + 3 + i * 3.6;
          s += `<path d="M${p2(a.bodyX - 2.6)} ${p2(y)} L${p2(a.bodyX + 2.6)} ${p2(y + 1.8)}" stroke="#4A3A28" stroke-width="0.9" opacity="0.85"/>`;
          s += `<path d="M${p2(a.bodyX + 2.6)} ${p2(y)} L${p2(a.bodyX - 2.6)} ${p2(y + 1.8)}" stroke="#4A3A28" stroke-width="0.9" opacity="0.85"/>`;
        }
      }
      // shoulder studs
      s += `<circle cx="${p2(a.shoulderL + 1.6)}" cy="${p2(a.shoulderY + 1.4)}" r="0.9" fill="#8A7A55"/>`;
      s += `<circle cx="${p2(a.shoulderR - 1.6)}" cy="${p2(a.shoulderY + 1.4)}" r="0.9" fill="#8A7A55"/>`;
      return s;
    },
  },
  {
    id: 'dress',
    label: 'Simple dress',
    draw: (p) => {
      const a = anchors(p);
      // bodice plus a flared skirt that reaches the shins
      let s = garment(p, 4, 1.0, 'round') + sleeves(p, 0.38);
      const hemY = a.hipY + 17;
      const flare = a.hipHalf + 6.5;
      s += path(
        `M${p2(a.bodyX - a.hipHalf - 1)} ${p2(a.hipY + 1)} L${p2(a.bodyX + a.hipHalf + 1)} ${p2(a.hipY + 1)} ` +
          `L${p2(a.bodyX + flare)} ${p2(hemY - 2)} Q${p2(a.bodyX)} ${p2(hemY + 2.6)} ${p2(a.bodyX - flare)} ${p2(hemY - 2)} Z`,
        V.base,
      );
      s += path(
        `M${p2(a.bodyX + a.hipHalf * 0.2)} ${p2(a.hipY + 1)} L${p2(a.bodyX + a.hipHalf + 1)} ${p2(a.hipY + 1)} L${p2(a.bodyX + flare)} ${p2(hemY - 2)} Q${p2(a.bodyX + flare * 0.4)} ${p2(hemY + 1.4)} ${p2(a.bodyX + a.hipHalf * 0.2)} ${p2(hemY - 1)} Z`,
        V.mid,
        'opacity="0.7"',
      );
      for (let i = -2; i <= 2; i++) {
        if (!i) continue;
        s += `<path d="M${p2(a.bodyX + i * a.hipHalf * 0.4)} ${p2(a.hipY + 3)} L${p2(a.bodyX + i * flare * 0.42)} ${p2(hemY - 2)}" stroke="${V.shade}" stroke-width="0.8" fill="none" opacity="0.5"/>`;
      }
      return s;
    },
  },
  {
    id: 'vest',
    label: 'Fur vest',
    draw: (p) => {
      let s = garment(p, 4, 2.2, 'none');
      const a = anchors(p);
      // fluffy outline
      for (let i = 0; i < 14; i++) {
        const t = i / 13;
        const y = a.shoulderY + t * (a.hipY - a.shoulderY + 4);
        for (const sgn of [-1, 1]) {
          const x = a.bodyX + sgn * (a.chestHalf + 2.4 + Math.sin(t * 9) * 0.8);
          s += ell(x, y, 2.2, 2.0, sgn < 0 ? V.base : V.mid);
        }
      }
      return s;
    },
    ink: (p) => {
      const a = anchors(p);
      if (p.back) return '';
      return `<path d="M${p2(a.headX - 3)} ${p2(a.shoulderY)} L${p2(a.headX)} ${p2(a.hipY - 2)} L${p2(a.headX + 3)} ${p2(a.shoulderY)}" stroke="#4A3A28" stroke-width="0.8" fill="none" opacity="0.5"/>`;
    },
  },
  {
    id: 'bare',
    label: 'Bare chest',
    draw: () => '',
  },
];

/* ------------------------------------------------------------------ bottoms ------------ */

function trousers(p: Pose, length: number, baggy: number): string {
  const a = anchors(p);
  let s = '';
  const legW0 = 4.2 + baggy;
  const legW1 = 3.4 + baggy * 0.6;
  const far = p.side ? (p.swing > 0 ? a.footL : a.footR) : a.footL;
  const near = p.side ? (p.swing > 0 ? a.footR : a.footL) : a.footR;
  const trim = (from: [number, number], to: [number, number]): [number, number] => [
    from[0] + (to[0] - from[0]) * length,
    from[1] + (to[1] - from[1]) * length,
  ];
  const hipL: [number, number] = [a.bodyX - (p.side ? 0 : a.hipHalf * 0.55), a.hipY - 2];
  const hipR: [number, number] = [a.bodyX + (p.side ? 0 : a.hipHalf * 0.55), a.hipY - 2];
  s += path(limbPath(hipL[0], hipL[1], ...trim(hipL, [far[0], far[1] - 2]), legW0, legW1), V.mid);
  s += path(limbPath(hipR[0], hipR[1], ...trim(hipR, [near[0], near[1] - 2]), legW0, legW1), V.base);
  // waist band
  s += path(
    `M${p2(a.bodyX - a.hipHalf - 1)} ${p2(a.hipY - 6)} L${p2(a.bodyX + a.hipHalf + 1)} ${p2(a.hipY - 6)} L${p2(a.bodyX + a.hipHalf + 1)} ${p2(a.hipY)} L${p2(a.bodyX - a.hipHalf - 1)} ${p2(a.hipY)} Z`,
    V.base,
  );
  return s;
}

export const BOTTOMS: Option[] = [
  { id: 'trousers', label: 'Trousers', draw: (p) => trousers(p, 0.88, 0) },
  { id: 'baggy', label: 'Baggy trousers', draw: (p) => trousers(p, 0.8, 1.4) },
  { id: 'short', label: 'Short breeches', draw: (p) => trousers(p, 0.46, 0.6) },
  {
    id: 'wrapped',
    label: 'Wrapped leg bands',
    draw: (p) => {
      let s = trousers(p, 0.5, 0.4);
      const a = anchors(p);
      const far = p.side ? (p.swing > 0 ? a.footL : a.footR) : a.footL;
      const near = p.side ? (p.swing > 0 ? a.footR : a.footL) : a.footR;
      for (const [foot, tone] of [
        [far, V.mid],
        [near, V.base],
      ] as Array<[[number, number], string]>) {
        const hip: [number, number] = [a.bodyX + (foot === near ? 1 : -1) * (p.side ? 0 : a.hipHalf * 0.55), a.hipY];
        for (let i = 0; i < 5; i++) {
          const t = 0.5 + (i / 5) * 0.46;
          const x = hip[0] + (foot[0] - hip[0]) * t;
          const y = hip[1] + (foot[1] - 2 - hip[1]) * t;
          s += ell(x, y, 3.8, 1.5, i % 2 ? tone : V.shade, `transform="rotate(${p2((i % 2 ? 8 : -8))} ${p2(x)} ${p2(y)})"`);
        }
      }
      return s;
    },
  },
  { id: 'skirt_none', label: 'None (dress)', draw: (p) => trousers(p, 0.3, 0) },
];

/* ------------------------------------------------------------------ shoes -------------- */

function footwear(p: Pose, height: number, cuff: boolean): string {
  const a = anchors(p);
  let s = '';
  const far = p.side ? (p.swing > 0 ? a.footL : a.footR) : a.footL;
  const near = p.side ? (p.swing > 0 ? a.footR : a.footL) : a.footR;
  for (const [f, tone] of [
    [far, V.mid],
    [near, V.base],
  ] as Array<[[number, number], string]>) {
    const toe = p.side ? 1.6 : 0;
    s += path(
      `M${p2(f[0] - 3.4)} ${p2(f[1] - height)} L${p2(f[0] + 3.4)} ${p2(f[1] - height)} L${p2(f[0] + 3.8 + toe)} ${p2(f[1] - 1.4)} ` +
        `Q${p2(f[0] + 3.8 + toe)} ${p2(f[1])} ${p2(f[0] + 2.4 + toe)} ${p2(f[1])} L${p2(f[0] - 3)} ${p2(f[1])} Q${p2(f[0] - 4)} ${p2(f[1])} ${p2(f[0] - 3.4)} ${p2(f[1] - 1.4)} Z`,
      tone,
    );
    if (cuff) s += ell(f[0] + toe * 0.3, f[1] - height, 4.2, 1.6, V.shade);
    s += path(`M${p2(f[0] - 3.2)} ${p2(f[1] - 0.9)} L${p2(f[0] + 3.6 + toe)} ${p2(f[1] - 0.9)} L${p2(f[0] + 3.6 + toe)} ${p2(f[1])} L${p2(f[0] - 3.2)} ${p2(f[1])} Z`, V.deep, 'opacity="0.8"');
  }
  return s;
}

export const SHOES: Option[] = [
  { id: 'boots', label: 'Leather boots', draw: (p) => footwear(p, 7, true) },
  { id: 'tall_boots', label: 'Tall boots', draw: (p) => footwear(p, 12, true) },
  { id: 'shoes', label: 'Soft shoes', draw: (p) => footwear(p, 3.4, false) },
  { id: 'barefoot', label: 'Barefoot', draw: () => '' },
];

/* ------------------------------------------------------------------ cloaks ------------- */

/**
 * Cloaks draw in two passes: `back` goes behind the body (the hanging cloth) and `draw` goes in
 * front (collar and the part over the shoulders).
 */
export interface CloakOption extends Option {
  back: (p: Pose) => string;
}

function cloakBody(p: Pose, length: number, width: number): string {
  const a = anchors(p);
  const topY = a.shoulderY - 1;
  const hemY = a.hipY + length;
  const halfTop = a.chestHalf + 2.6;
  const halfBot = a.chestHalf + width;
  // trails behind on the move
  const drift = -p.hairLag * 0.9 - (p.anim === 'run' ? 2.4 : p.anim === 'walk' ? 1.0 : 0) * (p.side ? 1 : 0);
  let s = path(
    `M${p2(a.bodyX - halfTop)} ${p2(topY)} L${p2(a.bodyX + halfTop)} ${p2(topY)} ` +
      `L${p2(a.bodyX + halfBot + drift)} ${p2(hemY - 3)} Q${p2(a.bodyX + drift * 0.5)} ${p2(hemY + 3)} ${p2(a.bodyX - halfBot + drift)} ${p2(hemY - 3)} Z`,
    V.base,
  );
  s += path(
    `M${p2(a.bodyX + a.chestHalf * 0.2)} ${p2(topY)} L${p2(a.bodyX + halfTop)} ${p2(topY)} L${p2(a.bodyX + halfBot + drift)} ${p2(hemY - 3)} Q${p2(a.bodyX + halfBot * 0.4 + drift)} ${p2(hemY + 1)} ${p2(a.bodyX + a.chestHalf * 0.2)} ${p2(hemY - 2)} Z`,
    V.mid,
    'opacity="0.8"',
  );
  for (let i = -1; i <= 1; i++) {
    s += `<path d="M${p2(a.bodyX + i * halfTop * 0.5)} ${p2(topY + 3)} L${p2(a.bodyX + i * halfBot * 0.6 + drift * 0.7)} ${p2(hemY - 4)}" stroke="${V.shade}" stroke-width="0.9" fill="none" opacity="0.5"/>`;
  }
  return s;
}

function furCollar(p: Pose): string {
  const a = anchors(p);
  let s = '';
  for (let i = 0; i < 13; i++) {
    const t = i / 12;
    const x = a.bodyX - (a.chestHalf + 1.8) + t * (a.chestHalf + 1.8) * 2;
    const y = a.shoulderY - 0.2 + Math.sin(t * Math.PI) * -1.1;
    s += ell(x, y, 1.7, 1.5, i % 2 ? V.base : V.mid);
  }
  return s;
}

export const CLOAKS: CloakOption[] = [
  { id: 'none', label: 'No cloak', draw: () => '', back: () => '' },
  { id: 'cloak', label: 'Wool cloak', draw: (p) => (p.back ? '' : furCollar(p).replace(/#F2F2F2/g, V.mid)), back: (p) => cloakBody(p, 11, 5) },
  { id: 'fur_cloak', label: 'Fur-collar cloak', draw: (p) => furCollar(p), back: (p) => cloakBody(p, 13, 6) },
  { id: 'short_cape', label: 'Short cape', draw: (p) => (p.back ? '' : furCollar(p)), back: (p) => cloakBody(p, 1, 4) },
  { id: 'hooded', label: 'Hooded cloak', draw: () => '', back: (p) => {
    const a = anchors(p);
    let s = cloakBody(p, 12, 5.5);
    // hood bunched behind the neck
    s += ell(a.headX, a.shoulderY - 2.5, a.headR * 0.95, a.headR * 0.6, V.mid);
    s += ell(a.headX, a.shoulderY - 3.6, a.headR * 0.7, a.headR * 0.42, V.base);
    return s;
  } },
];

/* ------------------------------------------------------------------ accessories -------- */

export const ACCESSORIES: Option[] = [
  { id: 'none', label: 'None', draw: () => '' },
  {
    id: 'belt',
    label: 'Belt',
    draw: (p) => {
      const a = anchors(p);
      return path(
        `M${p2(a.bodyX - a.hipHalf - 1.6)} ${p2(a.hipY - 7)} L${p2(a.bodyX + a.hipHalf + 1.6)} ${p2(a.hipY - 7)} L${p2(a.bodyX + a.hipHalf + 1.6)} ${p2(a.hipY - 3.4)} L${p2(a.bodyX - a.hipHalf - 1.6)} ${p2(a.hipY - 3.4)} Z`,
        V.base,
      );
    },
    ink: (p) => {
      const a = anchors(p);
      if (p.back) return '';
      return `<rect x="${p2(a.bodyX - 2)} " y="${p2(a.hipY - 7.4)}" width="4" height="4.4" rx="1" fill="#C9A24A"/><rect x="${p2(a.bodyX - 0.7)}" y="${p2(a.hipY - 6.6)}" width="1.4" height="2.8" fill="#7A6023"/>`;
    },
  },
  {
    id: 'belt_pouch',
    label: 'Belt & pouch',
    draw: (p) => {
      const a = anchors(p);
      let s = path(
        `M${p2(a.bodyX - a.hipHalf - 1.6)} ${p2(a.hipY - 7)} L${p2(a.bodyX + a.hipHalf + 1.6)} ${p2(a.hipY - 7)} L${p2(a.bodyX + a.hipHalf + 1.6)} ${p2(a.hipY - 3.4)} L${p2(a.bodyX - a.hipHalf - 1.6)} ${p2(a.hipY - 3.4)} Z`,
        V.base,
      );
      const px = a.bodyX + (p.side ? -4 : a.hipHalf + 0.4);
      s += path(
        `M${p2(px - 3)} ${p2(a.hipY - 4)} L${p2(px + 3)} ${p2(a.hipY - 4)} L${p2(px + 3.4)} ${p2(a.hipY + 2.6)} Q${p2(px)} ${p2(a.hipY + 4.4)} ${p2(px - 3.4)} ${p2(a.hipY + 2.6)} Z`,
        V.mid,
      );
      s += ell(px, a.hipY - 3.4, 3.6, 1.5, V.shade);
      return s;
    },
    ink: (p) => {
      const a = anchors(p);
      if (p.back) return '';
      return `<rect x="${p2(a.bodyX - 2)}" y="${p2(a.hipY - 7.4)}" width="4" height="4.4" rx="1" fill="#C9A24A"/>`;
    },
  },
  {
    id: 'scarf',
    label: 'Neck scarf',
    draw: (p) => {
      const a = anchors(p);
      let s = ell(a.headX, a.shoulderY - 1.4, a.chestHalf * 0.86, 2.4, V.base);
      const dx = -p.hairLag * 0.8;
      s += path(
        `M${p2(a.headX - 2 + dx * 0.3)} ${p2(a.shoulderY)} L${p2(a.headX + 2 + dx * 0.3)} ${p2(a.shoulderY)} L${p2(a.headX + 3 + dx)} ${p2(a.shoulderY + 11)} L${p2(a.headX - 1 + dx)} ${p2(a.shoulderY + 11)} Z`,
        V.mid,
      );
      return s;
    },
  },
  {
    id: 'circlet',
    label: 'Circlet',
    draw: () => '',
    ink: (p) => {
      const a = anchors(p);
      const hx = a.headX + (p.side ? 1.1 : 0);
      return `<path d="M${p2(hx - a.headR * 0.95)} ${p2(a.headY - a.headR * 0.5)} Q${p2(hx)} ${p2(a.headY - a.headR * 0.22)} ${p2(hx + a.headR * 0.95)} ${p2(a.headY - a.headR * 0.5)}" stroke="#C9A24A" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
    },
  },
];

export const SLOT_OPTIONS = {
  top: TOPS,
  bottom: BOTTOMS,
  shoes: SHOES,
  cloak: CLOAKS,
  accessory: ACCESSORIES,
} as const;

/**
 * Hair, split into two layers per style:
 *   hair_back_<id>   drawn BEHIND the body — the mass that falls behind the shoulders and down the
 *                    back, and the whole back of the skull when facing away
 *   hair_front_<id>  drawn OVER the head — skull cap, fringe and the strands framing the face
 *
 * Hair is built from overlapping tapered strand clumps with 3 tones plus highlight streaks, never a
 * single smooth blob. The back layer carries secondary motion: `pose.hairLag` shifts and rotates it
 * against the direction of travel, so it trails the body on walk and run and breathes on idle.
 */
import { anchors, V } from './parts.js';
import type { Pose } from './rig.js';

export interface HairStyle {
  id: string;
  label: string;
  /** how far below the shoulders the mass falls, 0 = none */
  backLen: number;
  backWidth: number;
  tail: 'none' | 'tail' | 'braid' | 'bun';
  fringe: 'straight' | 'side' | 'short' | 'none';
  /** cap puffiness multiplier */
  volume: number;
  /** wavy outline rather than straight */
  wavy: boolean;
}

export const HAIR_STYLES: HairStyle[] = [
  { id: 'short', label: 'Short', backLen: 3, backWidth: 0.95, tail: 'none', fringe: 'side', volume: 1.0, wavy: false },
  { id: 'buzz', label: 'Buzz', backLen: 0, backWidth: 0.9, tail: 'none', fringe: 'short', volume: 0.72, wavy: false },
  { id: 'bun', label: 'Bun', backLen: 2, backWidth: 0.92, tail: 'bun', fringe: 'side', volume: 0.95, wavy: false },
  { id: 'ponytail', label: 'Ponytail', backLen: 20, backWidth: 0.55, tail: 'tail', fringe: 'side', volume: 0.95, wavy: false },
  { id: 'braid', label: 'Warrior braid', backLen: 26, backWidth: 0.5, tail: 'braid', fringe: 'straight', volume: 0.9, wavy: false },
  { id: 'long', label: 'Long straight', backLen: 26, backWidth: 1.22, tail: 'none', fringe: 'straight', volume: 1.05, wavy: false },
  { id: 'wavy', label: 'Long wavy', backLen: 24, backWidth: 1.3, tail: 'none', fringe: 'side', volume: 1.12, wavy: true },
  { id: 'bob', label: 'Shoulder bob', backLen: 11, backWidth: 1.15, tail: 'none', fringe: 'straight', volume: 1.05, wavy: false },
];

const p2 = (n: number) => n.toFixed(1);

/** A tapered strand clump from (x0,y0) to (x1,y1), bowing by `bow`. */
function strand(x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, bow: number): string {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l;
  const ny = dx / l;
  const mx = (x0 + x1) / 2 + nx * bow;
  const my = (y0 + y1) / 2 + ny * bow;
  return (
    `M${p2(x0 + nx * w0)} ${p2(y0 + ny * w0)} ` +
    `Q${p2(mx + nx * ((w0 + w1) * 0.6))} ${p2(my + ny * ((w0 + w1) * 0.6))} ${p2(x1 + nx * w1)} ${p2(y1 + ny * w1)} ` +
    `L${p2(x1 - nx * w1)} ${p2(y1 - ny * w1)} ` +
    `Q${p2(mx - nx * ((w0 + w1) * 0.35))} ${p2(my - ny * ((w0 + w1) * 0.35))} ${p2(x0 - nx * w0)} ${p2(y0 - ny * w0)} Z`
  );
}

/** Lengths along the mass vary so the hem never reads as a straight cut. */
function hemJitter(i: number, n: number, wavy: boolean): number {
  const t = i / Math.max(1, n - 1);
  return (wavy ? Math.sin(t * 7.1) * 2.6 : Math.sin(t * 4.3) * 1.3) + Math.sin(t * 11.7) * 0.8;
}

/**
 * Outline of the hanging hair mass. One continuous silhouette with a wavy hem — strand detail goes
 * INSIDE it. Building the silhouette out of strands (as the first version did) gave the mass square
 * ends and made it read as planks bolted to the head.
 */
function massPath(hx: number, topY: number, halfW: number, len: number, wavy: boolean, flare: number): string {
  const steps = 12;
  const widthAt = (t: number) => {
    const swell = 0.82 + 0.26 * Math.sin(Math.PI * Math.min(1, t * 1.25)) + flare * t;
    return halfW * (swell + (wavy ? Math.sin(t * 6.4) * 0.11 : 0));
  };
  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = topY + len * t;
    const w = widthAt(t);
    left.push([hx - w, y]);
    right.push([hx + w, y]);
  }
  // wavy hem across the bottom
  const hem: Array<[number, number]> = [];
  const hsteps = 7;
  for (let i = 0; i <= hsteps; i++) {
    const t = i / hsteps;
    const w = widthAt(1);
    hem.push([hx + w - 2 * w * t, topY + len + Math.sin(t * Math.PI * 2.4) * (wavy ? 2.6 : 1.4) + Math.sin(t * 7.3) * 0.7]);
  }
  const curve = (pts: Array<[number, number]>) =>
    pts
      .map((pt, i) => (i === 0 ? `${p2(pt[0])} ${p2(pt[1])}` : `${p2(pt[0])} ${p2(pt[1])}`))
      .join(' L');
  return `M${curve(right.slice().reverse())} L${curve(hem)} L${curve(left.reverse())} Z`;
}

export function drawHairBack(p: Pose, st: HairStyle): string {
  const a = anchors(p);
  const hx = a.headX + (p.side ? 1.1 : 0);
  const R = a.headR;
  const lag = p.hairLag;
  let s = '';

  // Back of the skull. Visible from behind, and it fills the gap behind the ears from any angle.
  const capW = R * 1.06 * st.volume;
  const capH = R * 1.14 * st.volume;
  s += `<ellipse cx="${p2(hx)}" cy="${p2(a.headY - R * 0.14)}" rx="${p2(capW)}" ry="${p2(capH)}" fill="${V.mid}"/>`;

  if (st.backLen > 0) {
    // side view: the mass sits behind the head rather than fanning to both sides
    const centre = p.side ? hx - R * 0.5 : hx;
    const halfW = R * st.backWidth * (p.side ? 0.6 : 1);
    const topY = a.headY - R * 0.55;
    const len = st.backLen + R * 0.9;
    const d = massPath(centre, topY, halfW, len, st.wavy, st.wavy ? 0.2 : 0.08);
    s += `<path d="${d}" fill="${V.mid}"/>`;

    // strand detail inside the silhouette: alternating light and dark tapers
    const n = st.wavy ? 6 : 5;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = centre - halfW * 0.78 + t * halfW * 1.56;
      const tone = i % 2 === 0 ? V.base : V.shade;
      const bow = st.wavy ? Math.sin(t * 6.2 + 1) * 3.4 : (t - 0.5) * 2.2;
      s += `<path d="${strand(x, topY + R * 0.5, x + (t - 0.5) * halfW * 0.5, topY + len - 1 + hemJitter(i, n, st.wavy), halfW * 0.3, halfW * 0.2, bow)}" fill="${tone}" opacity="0.85"/>`;
    }
    // a deep parting or two for separation
    s += `<path d="${strand(centre - halfW * 0.3, topY + R * 0.4, centre - halfW * 0.42, topY + len * 0.82, 1.1, 0.6, 1.2)}" fill="${V.deep}" opacity="0.5"/>`;
    s += `<path d="${strand(centre + halfW * 0.34, topY + R * 0.4, centre + halfW * 0.46, topY + len * 0.78, 1.0, 0.5, -1.2)}" fill="${V.deep}" opacity="0.45"/>`;
  }

  if (st.tail === 'tail' || st.tail === 'braid') {
    const baseX = p.side ? hx - R * 0.72 : hx;
    const baseY = a.headY - R * 0.35;
    const tipX = baseX - lag * 1.5 + (p.side ? -R * 0.55 : 0);
    const tipY = baseY + st.backLen + 5;
    if (st.tail === 'tail') {
      s += `<path d="${strand(baseX, baseY, tipX, tipY, 4.0, 1.8, lag * 1.1 - 1)}" fill="${V.mid}"/>`;
      s += `<path d="${strand(baseX, baseY, tipX - 1, tipY - 2.5, 2.2, 1.0, lag * 1.1 - 1)}" fill="${V.base}"/>`;
      s += `<ellipse cx="${p2(baseX)}" cy="${p2(baseY)}" rx="3.2" ry="2.2" fill="${V.shade}"/>`;
    } else {
      const segs = 6;
      for (let i = 0; i < segs; i++) {
        const t = i / (segs - 1);
        const cx = baseX + (tipX - baseX) * t;
        const cy = baseY + (tipY - baseY) * t;
        const w = 4.0 - t * 2.0;
        s += `<ellipse cx="${p2(cx)}" cy="${p2(cy)}" rx="${p2(w)}" ry="${p2(w * 0.8)}" fill="${i % 2 ? V.mid : V.base}" transform="rotate(${p2((i % 2 ? 24 : -24) + lag * 3)} ${p2(cx)} ${p2(cy)})"/>`;
      }
      s += `<ellipse cx="${p2(tipX)}" cy="${p2(tipY + 1.5)}" rx="1.6" ry="2.2" fill="${V.deep}"/>`;
    }
  }
  if (st.tail === 'bun') {
    const bx = hx + (p.side ? -R * 0.8 : 0);
    const by = a.headY - R * (p.side ? 0.9 : 1.2);
    s += `<circle cx="${p2(bx)}" cy="${p2(by)}" r="${p2(R * 0.5)}" fill="${V.mid}"/>`;
    s += `<circle cx="${p2(bx - R * 0.14)}" cy="${p2(by - R * 0.16)}" r="${p2(R * 0.28)}" fill="${V.base}"/>`;
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + 0.5;
      s += `<path d="${strand(bx, by, bx + Math.cos(ang) * R * 0.48, by + Math.sin(ang) * R * 0.48, 1.5, 0.7, 1.1)}" fill="${V.shade}" opacity="0.75"/>`;
    }
  }

  return `<g transform="translate(${p2(-lag * 0.5)} 0) rotate(${p2(lag * 0.8)} ${p2(hx)} ${p2(a.headY - R)})">${s}</g>`;
}

export function drawHairFront(p: Pose, st: HairStyle): string {
  const a = anchors(p);
  const hx = a.headX + (p.side ? 1.1 : 0);
  const R = a.headR;
  const vol = st.volume;
  let s = '';

  // Skull cap: one soft dome, with clump bumps only along the top silhouette so it never reads as a
  // smooth plastic shell, and never as a stack of separate blobs either.
  const capTop = a.headY - R * 1.2 * vol;
  s += `<path d="M${p2(hx - R * 1.02)} ${p2(a.headY + R * 0.12)} Q${p2(hx - R * 1.08)} ${p2(capTop)} ${p2(hx)} ${p2(capTop)} Q${p2(hx + R * 1.08)} ${p2(capTop)} ${p2(hx + R * 1.02)} ${p2(a.headY + R * 0.12)} Q${p2(hx)} ${p2(a.headY - R * 0.3)} ${p2(hx - R * 1.02)} ${p2(a.headY + R * 0.12)} Z" fill="${V.base}"/>`;
  const bumps = 5;
  for (let i = 0; i < bumps; i++) {
    const t = i / (bumps - 1);
    const ang = Math.PI * (1.12 + t * 0.76);
    const cx = hx + Math.cos(ang) * R * 0.86;
    const cy = a.headY + Math.sin(ang) * R * 1.0 * vol;
    s += `<ellipse cx="${p2(cx)}" cy="${p2(cy + 0.8)}" rx="${p2(R * 0.36)}" ry="${p2(R * 0.3 * vol)}" fill="${i % 2 ? V.mid : V.base}"/>`;
  }

  if (p.back) {
    // Seen from behind there is no face: the whole skull is hair. The back layer's cap sits behind
    // the body, so without this the head would show as bare skin with strands striped over it.
    s += `<ellipse cx="${p2(hx)}" cy="${p2(a.headY - R * 0.08)}" rx="${p2(R * 1.04)}" ry="${p2(R * 1.16)}" fill="${V.base}"/>`;
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const x = hx - R * 0.66 + t * R * 1.32;
      s += `<path d="${strand(x, capTop + R * 0.35, x + (t - 0.5) * 3.2, a.headY + R * 0.75, 2.2, 1.2, (t - 0.5) * 2.2)}" fill="${i % 2 ? V.mid : V.shade}" opacity="0.6"/>`;
    }
    s += `<path d="${strand(hx - R * 0.5, a.headY - R * 0.9, hx + R * 0.2, a.headY - R * 1.0, 1.4, 0.8, -1.4)}" fill="${V.hi}" opacity="0.4"/>`;
    return s;
  }

  // Fringe: a scalloped edge hanging from the hairline, leaving some forehead visible.
  const browY = a.headY - R * 0.62;
  const scallop = (x0: number, x1: number, dip: number, lobes: number, fill: string, op = 1) => {
    let d = `M${p2(x0)} ${p2(browY - R * 0.55)}`;
    d += ` L${p2(x1)} ${p2(browY - R * 0.55)}`;
    for (let i = lobes; i >= 1; i--) {
      const t1 = i / lobes;
      const t0 = (i - 1) / lobes;
      const xa = x0 + (x1 - x0) * t1;
      const xb = x0 + (x1 - x0) * t0;
      const yd = browY + dip * (0.72 + 0.28 * Math.sin(t1 * 5.1));
      d += ` Q${p2((xa + xb) / 2)} ${p2(yd)} ${p2(xb)} ${p2(browY - dip * 0.18)}`;
    }
    return `<path d="${d} Z" fill="${fill}"${op < 1 ? ` opacity="${op}"` : ''}/>`;
  };
  if (st.fringe === 'straight') {
    s += scallop(hx - R * 1.0, hx + R * 1.0, R * 0.44, 4, V.base);
    s += scallop(hx - R * 0.95, hx + R * 0.2, R * 0.34, 3, V.mid, 0.8);
  } else if (st.fringe === 'side') {
    // swept across the brow: deeper on one side, rising to the other
    let d = `M${p2(hx - R * 1.02)} ${p2(browY - R * 0.5)} L${p2(hx + R * 1.02)} ${p2(browY - R * 0.5)}`;
    d += ` L${p2(hx + R * 0.98)} ${p2(browY - R * 0.1)}`;
    d += ` Q${p2(hx + R * 0.2)} ${p2(browY + R * 0.34)} ${p2(hx - R * 0.5)} ${p2(browY + R * 0.46)}`;
    d += ` Q${p2(hx - R * 0.9)} ${p2(browY + R * 0.36)} ${p2(hx - R * 1.02)} ${p2(browY - R * 0.5)} Z`;
    s += `<path d="${d}" fill="${V.base}"/>`;
    s += `<path d="${strand(hx + R * 0.7, browY - R * 0.3, hx - R * 0.55, browY + R * 0.36, 2.0, 1.0, 2.0)}" fill="${V.mid}" opacity="0.85"/>`;
  } else if (st.fringe === 'short') {
    s += scallop(hx - R * 0.98, hx + R * 0.98, R * 0.2, 5, V.mid);
  }

  // strands framing the face, for anything past chin length
  if (st.backLen > 6) {
    for (const sgn of p.side ? [-1] : [-1, 1]) {
      const x = hx + sgn * R * 0.95;
      const len = Math.min(15, st.backLen * 0.65);
      s += `<path d="${strand(x, a.headY - R * 0.4, x + sgn * 2.0, a.headY + R * 0.35 + len, 2.6, 1.2, sgn * 1.6)}" fill="${V.mid}"/>`;
      s += `<path d="${strand(x + sgn * 0.6, a.headY - R * 0.3, x + sgn * 2.4, a.headY + R * 0.2 + len * 0.7, 1.2, 0.6, sgn * 1.2)}" fill="${V.base}" opacity="0.8"/>`;
    }
  }

  // highlight band catching the light up-left
  s += `<path d="${strand(hx - R * 0.68, a.headY - R * 0.88, hx + R * 0.3, a.headY - R * 0.98, 1.4, 0.8, -1.5)}" fill="${V.hi}" opacity="0.5"/>`;
  return s;
}

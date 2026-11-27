/**
 * The character rig: one place that decides where every body part sits for a given direction and
 * animation frame. Body, hair and every clothing layer read the same pose, so they can never drift
 * apart — which is what made the previous build's hair look stuck on.
 *
 * Canvas is 56 x 76 logical px with the feet on y = 70. Rendered at 2x => 112 x 152 per frame.
 */
export const CW = 56;
export const CH = 76;
export const FEET = 70;

export const DIRS = ['down', 'left', 'right', 'up'] as const;
export type Dir = (typeof DIRS)[number];

export const IDLE_FRAMES = 4;
export const WALK_FRAMES = 8;
export const RUN_FRAMES = 8;
export const COLS = IDLE_FRAMES + WALK_FRAMES + RUN_FRAMES;
export type Anim = 'idle' | 'walk' | 'run';

export interface Pose {
  dir: Dir;
  anim: Anim;
  frame: number;
  /** side view faces +x; the left-facing sheet is this mirrored */
  side: boolean;
  back: boolean;
  /** vertical body bob, + is down */
  bob: number;
  /** forward lean, px */
  lean: number;
  /** -1..1 limb swing; + swings the right limb forward */
  swing: number;
  /** 0..1 how far the body has twisted/stretched (run is more extreme) */
  effort: number;
  blink: boolean;
  /** hair trails the body: px of lag, opposite the direction of travel */
  hairLag: number;
  /** breathing offset for idle */
  breathe: number;
}

export function makePose(dir: Dir, anim: Anim, frame: number): Pose {
  const side = dir === 'left' || dir === 'right';
  const back = dir === 'up';
  if (anim === 'idle') {
    const p = (frame / IDLE_FRAMES) * Math.PI * 2;
    const breathe = Math.sin(p) * 0.8;
    return {
      dir, anim, frame, side, back,
      bob: breathe * 0.5,
      lean: 0,
      swing: 0,
      effort: 0,
      blink: frame === 3,
      hairLag: Math.sin(p - 0.9) * 0.7,
      breathe,
    };
  }
  const n = anim === 'walk' ? WALK_FRAMES : RUN_FRAMES;
  const p = (frame / n) * Math.PI * 2;
  const s = Math.sin(p);
  const effort = anim === 'run' ? 1 : 0.45;
  // two bobs per stride: the body rises as each leg passes under it
  const bob = -(1 - Math.abs(s)) * (anim === 'run' ? 2.6 : 1.7);
  return {
    dir, anim, frame, side, back,
    bob,
    lean: anim === 'run' ? 2.4 : 0.7,
    swing: s,
    effort,
    blink: false,
    // hair lags the body by about a quarter cycle and swings against the travel direction
    hairLag: -Math.sin(p - Math.PI * 0.45) * (anim === 'run' ? 2.4 : 1.4),
    breathe: 0,
  };
}

/** Key points of the rig, in canvas coordinates, for the given pose. */
export interface Anchors {
  headX: number;
  headY: number;
  headR: number;
  neckY: number;
  shoulderY: number;
  hipY: number;
  bodyX: number;
  /** left/right shoulder x (screen space) */
  shoulderL: number;
  shoulderR: number;
  /** foot positions */
  footL: [number, number];
  footR: [number, number];
  /** hand positions */
  handL: [number, number];
  handR: [number, number];
  /** torso half width at shoulder and hip */
  chestHalf: number;
  hipHalf: number;
}

export function anchors(p: Pose): Anchors {
  const cx = CW / 2 + p.lean * (p.side ? 1 : 0);
  const by = p.bob;
  const headR = 9.2;
  const headY = 19 + by - p.lean * 0.5;
  const chestHalf = p.side ? 6.2 : 8.4;
  const hipHalf = p.side ? 5.6 : 7.2;
  const shoulderY = 31 + by;
  const hipY = 46 + by * 0.6;

  // legs
  const legSpread = p.side ? 0 : 3.6;
  const stride = p.anim === 'run' ? 7.4 : p.anim === 'walk' ? 5.2 : 0;
  const lift = p.anim === 'run' ? 3.4 : 2.0;
  const legPhase = p.swing;
  const foot = (sgn: 1 | -1): [number, number] => {
    const ph = legPhase * sgn;
    if (p.side) {
      // forward/back along x, with a lift when the leg swings through
      const rise = Math.max(0, -ph) * lift;
      return [cx + ph * stride, FEET - rise];
    }
    const rise = Math.max(0, -ph) * lift * 0.6;
    return [cx + sgn * legSpread + ph * stride * 0.35, FEET - rise + ph * 1.4];
  };

  // arms swing opposite their leg
  const armSwing = p.anim === 'run' ? 8.2 : p.anim === 'walk' ? 5.4 : 0;
  const hand = (sgn: 1 | -1): [number, number] => {
    const ph = -legPhase * sgn;
    const armY = shoulderY + 14 - Math.abs(ph) * 1.6 * p.effort;
    if (p.side) return [cx + ph * armSwing, armY];
    return [cx + sgn * (chestHalf + 2.4) + ph * armSwing * 0.3, armY + ph * 1.6];
  };

  return {
    headX: cx,
    headY,
    headR,
    neckY: 27 + by,
    shoulderY,
    hipY,
    bodyX: cx,
    shoulderL: cx - chestHalf,
    shoulderR: cx + chestHalf,
    footL: foot(-1),
    footR: foot(1),
    handL: hand(-1),
    handR: hand(1),
    chestHalf,
    hipHalf,
  };
}

/** Torso outline shared by the body and every clothing layer, so garments always fit. */
export function torsoPath(a: Anchors, grow = 0, lengthen = 0): string {
  const sl = a.shoulderL - grow;
  const sr = a.shoulderR + grow;
  const hl = a.bodyX - a.hipHalf - grow * 0.8;
  const hr = a.bodyX + a.hipHalf + grow * 0.8;
  const top = a.shoulderY - grow * 0.6;
  const bot = a.hipY + lengthen;
  return (
    `M${sl.toFixed(1)} ${(top + 2).toFixed(1)} Q${sl.toFixed(1)} ${top.toFixed(1)} ${(sl + 2.4).toFixed(1)} ${(top - 0.6).toFixed(1)} ` +
    `L${(sr - 2.4).toFixed(1)} ${(top - 0.6).toFixed(1)} Q${sr.toFixed(1)} ${top.toFixed(1)} ${sr.toFixed(1)} ${(top + 2).toFixed(1)} ` +
    `L${hr.toFixed(1)} ${(bot - 2).toFixed(1)} Q${hr.toFixed(1)} ${bot.toFixed(1)} ${(hr - 2).toFixed(1)} ${bot.toFixed(1)} ` +
    `L${(hl + 2).toFixed(1)} ${bot.toFixed(1)} Q${hl.toFixed(1)} ${bot.toFixed(1)} ${hl.toFixed(1)} ${(bot - 2).toFixed(1)} Z`
  );
}

/** Limb as a tapered capsule from a to b. */
export function limbPath(ax: number, ay: number, bx: number, by: number, w0: number, w1: number): string {
  const dx = bx - ax;
  const dy = by - ay;
  const l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l;
  const ny = dx / l;
  const mx = (ax + bx) / 2 + nx * 0.6;
  const my = (ay + by) / 2 + ny * 0.6;
  return (
    `M${(ax + nx * w0).toFixed(1)} ${(ay + ny * w0).toFixed(1)} ` +
    `Q${(mx + nx * ((w0 + w1) / 2)).toFixed(1)} ${(my + ny * ((w0 + w1) / 2)).toFixed(1)} ${(bx + nx * w1).toFixed(1)} ${(by + ny * w1).toFixed(1)} ` +
    `Q${(bx + ny * w1 * 0.4).toFixed(1)} ${(by - nx * w1 * 0.4).toFixed(1)} ${(bx - nx * w1).toFixed(1)} ${(by - ny * w1).toFixed(1)} ` +
    `Q${(mx - nx * ((w0 + w1) / 2)).toFixed(1)} ${(my - ny * ((w0 + w1) / 2)).toFixed(1)} ${(ax - nx * w0).toFixed(1)} ${(ay - ny * w0).toFixed(1)} Z`
  );
}

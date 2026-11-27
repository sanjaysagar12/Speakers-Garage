/**
 * Assembles every character layer into one spritesheet per layer:
 * 20 columns (idle 4, walk 8, run 8) x 4 rows (down, left, right, up), 56 x 76 logical per frame.
 *
 * The left-facing row is the right-facing row mirrored, so the side art is authored once.
 * Each sheet is a single SVG so it costs one rasterise, not one per frame.
 */
import { Art } from '../wc.js';
import { COLS, DIRS, IDLE_FRAMES, WALK_FRAMES, RUN_FRAMES, CW, CH, makePose } from './rig.js';
import type { Anim, Dir, Pose } from './rig.js';
import { drawArms, drawBody, drawFace } from './parts.js';
import { HAIR_STYLES, drawHairBack, drawHairFront } from './hair.js';
import { TOPS, BOTTOMS, SHOES, CLOAKS, ACCESSORIES } from './clothing.js';
import type { Option } from './clothing.js';

export type TintKey = 'skin' | 'hair' | 'top' | 'bottom' | 'shoes' | 'cloak' | 'accessory' | null;

export interface LayerDef {
  /** file name under assets/avatar/ */
  name: string;
  /** which config colour multiplies it (null = drawn as-is) */
  tint: TintKey;
  /** draw order, low to high */
  order: number;
  /** slot + option this layer belongs to, for the customizer */
  slot?: string;
  option?: string;
  draw: (p: Pose) => string;
}

export function frameIndex(anim: Anim, i: number): number {
  return anim === 'idle' ? i : anim === 'walk' ? IDLE_FRAMES + i : IDLE_FRAMES + WALK_FRAMES + i;
}
export function animOfColumn(col: number): { anim: Anim; frame: number } {
  if (col < IDLE_FRAMES) return { anim: 'idle', frame: col };
  if (col < IDLE_FRAMES + WALK_FRAMES) return { anim: 'walk', frame: col - IDLE_FRAMES };
  return { anim: 'run', frame: col - IDLE_FRAMES - WALK_FRAMES };
}

/** Build the full 20x4 sheet for one layer. */
export function layerSheetSvg(layer: LayerDef): string {
  const art = new Art();
  // one light wash over the whole sheet: enough to take the hard vector edge off without costing a
  // filter per frame (frames have margin, so the small displacement never crosses a frame boundary)
  const f = art.washFilter({ wobble: 0.9, freq: 0.09, octaves: 2, seed: 7, edge: 0 });
  let body = '';
  DIRS.forEach((dir, row) => {
    for (let col = 0; col < COLS; col++) {
      const { anim, frame } = animOfColumn(col);
      const pose = makePose(dir === 'left' ? 'right' : dir, anim, frame);
      const inner = layer.draw(pose);
      if (!inner) continue;
      const flip = dir === 'left' ? `translate(${CW} 0) scale(-1 1)` : '';
      body += `<g transform="translate(${col * CW} ${row * CH})${flip ? ' ' + flip : ''}">${inner}</g>`;
    }
  });
  art.add(`<g filter="url(#${f})">${body}</g>`);
  return art.svg(COLS * CW, DIRS.length * CH);
}

/** A single idle-down frame, used for customizer thumbnails. */
export function layerThumbSvg(layer: LayerDef, dir: Dir = 'down'): string {
  const art = new Art();
  const pose = makePose(dir, 'idle', 0);
  art.add(layer.draw(pose));
  return art.svg(CW, CH);
}

function optionLayers(slot: string, options: readonly Option[], tint: TintKey, order: number, inkOrder: number): LayerDef[] {
  const out: LayerDef[] = [];
  for (const o of options) {
    out.push({ name: `${slot}_${o.id}`, tint, order, slot, option: o.id, draw: o.draw });
    if (o.ink) out.push({ name: `${slot}_${o.id}__ink`, tint: null, order: inkOrder, slot, option: o.id, draw: o.ink });
  }
  return out;
}

/**
 * Draw order, back to front. Numbers leave gaps so new layers can slot in.
 *  10 cloak back | 20 hair back | 30 body | 40 bottom | 50 shoes | 60 arms | 70 top | 75 top ink
 *  80 accessory | 85 accessory ink | 90 face | 100 hair front | 110 cloak front
 */
export function allLayers(): LayerDef[] {
  const out: LayerDef[] = [];
  for (const c of CLOAKS) {
    if (c.id === 'none') continue;
    out.push({ name: `cloakback_${c.id}`, tint: 'cloak', order: 10, slot: 'cloak', option: c.id, draw: c.back });
  }
  for (const st of HAIR_STYLES) {
    out.push({ name: `hairback_${st.id}`, tint: 'hair', order: 20, slot: 'hair', option: st.id, draw: (p) => drawHairBack(p, st) });
  }
  out.push({ name: 'body', tint: 'skin', order: 30, draw: drawBody });
  out.push(...optionLayers('bottom', BOTTOMS, 'bottom', 40, 45));
  out.push(...optionLayers('shoes', SHOES, 'shoes', 50, 55));
  out.push({ name: 'arms', tint: 'skin', order: 60, draw: drawArms });
  out.push(...optionLayers('top', TOPS, 'top', 70, 75));
  out.push(...optionLayers('accessory', ACCESSORIES, 'accessory', 80, 85));
  out.push({ name: 'face', tint: null, order: 90, draw: drawFace });
  for (const st of HAIR_STYLES) {
    out.push({ name: `hairfront_${st.id}`, tint: 'hair', order: 100, slot: 'hair', option: st.id, draw: (p) => drawHairFront(p, st) });
  }
  for (const c of CLOAKS) {
    if (c.id === 'none') continue;
    out.push({ name: `cloak_${c.id}`, tint: 'cloak', order: 110, slot: 'cloak', option: c.id, draw: c.draw });
    if (c.ink) out.push({ name: `cloak_${c.id}__ink`, tint: null, order: 115, slot: 'cloak', option: c.id, draw: c.ink });
  }
  return out;
}

/** The catalogue the UI and the runtime compositor need. */
export function avatarCatalog() {
  return {
    frameW: CW,
    frameH: CH,
    cols: COLS,
    rows: DIRS.length,
    dirs: DIRS,
    idleFrames: IDLE_FRAMES,
    walkFrames: WALK_FRAMES,
    runFrames: RUN_FRAMES,
    slots: {
      hair: HAIR_STYLES.map((s) => ({ id: s.id, label: s.label })),
      top: TOPS.map((o) => ({ id: o.id, label: o.label, ink: !!o.ink })),
      bottom: BOTTOMS.map((o) => ({ id: o.id, label: o.label, ink: !!o.ink })),
      shoes: SHOES.map((o) => ({ id: o.id, label: o.label, ink: !!o.ink })),
      cloak: CLOAKS.map((o) => ({ id: o.id, label: o.label, ink: !!o.ink })),
      accessory: ACCESSORIES.map((o) => ({ id: o.id, label: o.label, ink: !!o.ink })),
    },
    layers: allLayers().map((l) => ({ name: l.name, tint: l.tint, order: l.order, slot: l.slot ?? null, option: l.option ?? null })),
  };
}

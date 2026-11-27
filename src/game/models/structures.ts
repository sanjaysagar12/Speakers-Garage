import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { ModelBuilder } from './util/builder';
import { lathe, rng, range, rockGeo, sweep } from './util/geo';
import { toon } from '../materials/toon';
import { PAL } from './palette';
import { G } from '../materials/globals';

/* ------------------------------------------------------------------ thatch ---------------------------- */

/** Hipped thatch roof: stacked frusta whose lower edge is jagged like bundled straw. */
function thatchRoof(b: ModelBuilder, w: number, d: number, h: number, y0: number, seed: number): void {
  const r = rng(seed);
  const layers = 3;
  for (let l = 0; l < layers; l++) {
    const t0 = l / layers;
    const t1 = (l + 1.25) / layers;
    const sx0 = (w / 2) * (1 - t0 * 0.92) + 0.25;
    const sz0 = (d / 2) * (1 - t0 * 0.92) + 0.25;
    const sx1 = (w / 2) * Math.max(0.04, 1 - t1 * 0.92);
    const sz1 = (d / 2) * Math.max(0.04, 1 - t1 * 0.92);
    const ya = y0 + t0 * h - 0.12;
    const yb = y0 + Math.min(1, t1) * h;
    const n = 48;
    const pos: number[] = [];
    const idx: number[] = [];
    // corners sit at u = 0, .25, .5, .75 on every layer so top and bottom rings line up
    const rectPt = (u: number, sx: number, sz: number): [number, number] => {
      const side = Math.floor(u * 4) % 4;
      const f = u * 4 - Math.floor(u * 4);
      if (side === 0) return [-sx + 2 * sx * f, -sz];
      if (side === 1) return [sx, -sz + 2 * sz * f];
      if (side === 2) return [sx - 2 * sx * f, sz];
      return [-sx, sz - 2 * sz * f];
    };
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const [x0, z0] = rectPt(u, sx0, sz0);
      const jag = (i % 2 ? 0.06 : -0.02) + range(r, -0.02, 0.02);
      pos.push(x0, ya - jag, z0);
      const [x1, z1] = rectPt(u, sx1, sz1);
      pos.push(x1, yb, z1);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      const bb = ((i + 1) % n) * 2;
      idx.push(a, bb, a + 1, bb, bb + 1, a + 1);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    b.add(g, { color: l % 2 ? PAL.thatchDark : PAL.thatch, mat: toon({ double: true }) });
  }
  b.add(new ConeGeometry(0.18, 0.4, 6), { color: PAL.thatchDark, pos: [0, y0 + h + 0.12, 0] });
}

/* ------------------------------------------------------------------ beach bar ------------------------- */

export function buildBeachBar(p: { w?: number; d?: number } = {}, seed = 3): Group {
  const W = p.w ?? 7;
  const D = p.d ?? 5;
  const deckY = 0.35;
  const b = new ModelBuilder();
  // deck on short stilts
  for (let i = 0; i < Math.round(D / 0.3); i++) {
    b.add(new BoxGeometry(W, 0.07, 0.27), { color: i % 3 ? PAL.wood : PAL.woodLight, pos: [0, deckY, -D / 2 + 0.15 + i * 0.3] });
  }
  for (const x of [-W / 2 + 0.2, 0, W / 2 - 0.2]) for (const z of [-D / 2 + 0.2, D / 2 - 0.2]) b.add(new BoxGeometry(0.14, deckY + 0.3, 0.14), { color: PAL.woodDark, pos: [x, (deckY - 0.3) / 2, z] });
  // posts
  const postH = 2.6;
  for (const x of [-W / 2 + 0.3, W / 2 - 0.3]) for (const z of [-D / 2 + 0.3, D / 2 - 0.3]) b.add(new CylinderGeometry(0.09, 0.11, postH, 7), { color: PAL.woodDark, pos: [x, deckY + postH / 2, z] });
  // L-shaped counter facing +z (the beach side) and +x
  const ch = 1.1;
  b.add(new BoxGeometry(W * 0.62, ch, 0.5), { color: PAL.offWhite, pos: [-W * 0.12, deckY + ch / 2, D / 2 - 1.1] });
  b.add(new BoxGeometry(W * 0.66, 0.08, 0.7), { color: PAL.woodLight, pos: [-W * 0.12, deckY + ch + 0.04, D / 2 - 1.1] });
  b.add(new BoxGeometry(0.5, ch, 1.8), { color: PAL.offWhite, pos: [W * 0.19 + 0.25, deckY + ch / 2, D / 2 - 1.95] });
  b.add(new BoxGeometry(0.7, 0.08, 1.9), { color: PAL.woodLight, pos: [W * 0.19 + 0.25, deckY + ch + 0.04, D / 2 - 1.95] });
  // coral stripe panels on the counter front
  for (let i = 0; i < 6; i++) b.add(new BoxGeometry(0.22, ch * 0.8, 0.02), { color: PAL.coral, pos: [-W * 0.12 - W * 0.27 + i * W * 0.11, deckY + ch / 2, D / 2 - 0.84] });
  // back shelf with bottles
  b.add(new BoxGeometry(W * 0.7, 1.4, 0.35), { color: PAL.woodDark, pos: [-W * 0.08, deckY + 0.7, -D / 2 + 0.45] });
  const bottleCols = [PAL.teal, PAL.coral, PAL.yellow, '#7FC8A9', PAL.offWhite, '#5D8AA8'];
  for (let i = 0; i < 12; i++) {
    b.add(new CylinderGeometry(0.045, 0.05, 0.26, 6), { color: bottleCols[i % bottleCols.length], pos: [-W * 0.4 + i * W * 0.055, deckY + 1.53, -D / 2 + 0.45] });
  }
  // stools along the counter
  for (let i = 0; i < 4; i++) {
    const x = -W * 0.36 + i * W * 0.16;
    b.add(new CylinderGeometry(0.04, 0.05, 0.72, 6), { color: PAL.woodDark, pos: [x, deckY + 0.36, D / 2 - 0.45] });
    b.add(new CylinderGeometry(0.2, 0.18, 0.07, 12), { color: i % 2 ? PAL.coral : PAL.teal, pos: [x, deckY + 0.75, D / 2 - 0.45] });
  }
  // roof beams + thatch
  b.add(new BoxGeometry(W - 0.4, 0.14, 0.14), { color: PAL.woodDark, pos: [0, deckY + postH, D / 2 - 0.3] });
  b.add(new BoxGeometry(W - 0.4, 0.14, 0.14), { color: PAL.woodDark, pos: [0, deckY + postH, -D / 2 + 0.3] });
  thatchRoof(b, W, D, 1.9, deckY + postH + 0.05, seed);
  // string of lights: a sagging cable along the front eave with bulbs
  const cable: Vector3[] = [];
  const bulbs: Vector3[] = [];
  const spans = 3;
  for (let s = 0; s < spans; s++) {
    const x0 = -W / 2 - 0.1 + (s * (W + 0.2)) / spans;
    const x1 = -W / 2 - 0.1 + ((s + 1) * (W + 0.2)) / spans;
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const v = new Vector3(x0 + (x1 - x0) * t, deckY + postH - 0.2 - 0.32 * Math.sin(Math.PI * t), D / 2 + 0.28);
      if (!(s > 0 && i === 0)) cable.push(v);
      if (i % 2 === 1) bulbs.push(v.clone().add(new Vector3(0, -0.08, 0)));
    }
  }
  b.add(sweep(cable, 0.012, 4, cable.length * 3), { color: PAL.black });
  const bulbMat = toon({ unlit: true, emissive: 1.6 });
  for (const [i, v] of bulbs.entries()) {
    b.add(new SphereGeometry(0.055, 8, 6), { mat: bulbMat, color: i % 3 === 0 ? '#FFD27A' : i % 3 === 1 ? '#FFB38A' : '#FFF0B0', pos: [v.x, v.y, v.z] });
  }
  // a short boardwalk ramp down to the sand in front (beach side)
  for (let i = 0; i < 6; i++) b.add(new BoxGeometry(1.4, 0.06, 0.27), { color: i % 2 ? PAL.wood : PAL.woodLight, pos: [W * 0.32, deckY - 0.05 - i * 0.05, D / 2 + 0.2 + i * 0.3] });
  return b.build('beachbar');
}

/* ------------------------------------------------------------------ lifeguard tower ------------------- */

export function buildLifeguardTower(): Group {
  const b = new ModelBuilder();
  const top = 2.1;
  for (const x of [-0.75, 0.75]) for (const z of [-0.75, 0.75]) {
    b.add(new BoxGeometry(0.12, top + 0.4, 0.12), { color: PAL.woodDark, pos: [x * 1.1, (top - 0.4) / 2, z * 1.1], rot: [z * -0.06, 0, x * 0.06] });
  }
  // cross bracing
  for (const z of [-0.8, 0.8]) b.add(new BoxGeometry(1.9, 0.07, 0.06), { color: PAL.wood, pos: [0, top * 0.45, z], rot: [0, 0, 0.75] });
  for (const x of [-0.8, 0.8]) b.add(new BoxGeometry(0.06, 0.07, 1.9), { color: PAL.wood, pos: [x, top * 0.45, 0], rot: [0.75, 0, 0] });
  // platform
  b.add(new BoxGeometry(2.4, 0.1, 2.4), { color: PAL.woodLight, pos: [0, top, 0] });
  // cabin
  b.add(new BoxGeometry(1.7, 1.3, 1.5), { color: PAL.offWhite, pos: [0, top + 0.7, -0.25] });
  b.add(new BoxGeometry(1.72, 0.22, 1.52), { color: PAL.coral, pos: [0, top + 0.55, -0.25] });
  b.add(new BoxGeometry(1.2, 0.55, 0.04), { color: PAL.glass, pos: [0, top + 1.0, 0.51] });
  // hipped roof
  b.add(new ConeGeometry(1.45, 0.75, 4), { color: PAL.coral, pos: [0, top + 1.72, -0.25], rot: [0, Math.PI / 4, 0], scale: [1.05, 1, 0.95] });
  // railings at the front
  for (const x of [-1.15, 1.15]) b.add(new BoxGeometry(0.06, 0.6, 0.06), { color: PAL.offWhite, pos: [x, top + 0.3, 1.15] });
  b.add(new BoxGeometry(2.36, 0.06, 0.06), { color: PAL.offWhite, pos: [0, top + 0.6, 1.15] });
  // ramp / ladder down to the sand (+z)
  const steps = 8;
  for (let i = 0; i < steps; i++) b.add(new BoxGeometry(0.7, 0.05, 0.22), { color: PAL.wood, pos: [0.5, top - (i + 1) * (top / steps), 1.25 + i * 0.28] });
  b.add(new BoxGeometry(0.06, 0.06, 2.6), { color: PAL.woodDark, pos: [0.15, top / 2, 2.2], rot: [0.75, 0, 0] });
  b.add(new BoxGeometry(0.06, 0.06, 2.6), { color: PAL.woodDark, pos: [0.85, top / 2, 2.2], rot: [0.75, 0, 0] });
  // flag pole + flag (sways)
  b.add(new CylinderGeometry(0.03, 0.03, 2.0, 5), { color: PAL.offWhite, pos: [-1.1, top + 1.0, 0.9] });
  const flag = new BoxGeometry(0.75, 0.45, 0.01, 8, 2, 1);
  b.add(flag, { mat: toon({ color: PAL.red, double: true, sway: 0.4 }), pos: [-0.72, top + 1.75, 0.9], sway: (v) => Math.max(0, v.x + 1.1) / 0.75 });
  // rescue tube hanging on the rail
  b.add(new BoxGeometry(0.75, 0.16, 0.08), { color: PAL.red, pos: [-0.45, top + 0.42, 1.2] });
  return b.build('lifeguard');
}

/* ------------------------------------------------------------------ pier ------------------------------ */

export interface PierParams {
  length?: number;
  width?: number;
  deckY?: number;
  head?: boolean;
  rail?: boolean;
  posts?: number;
  /** deck height at the shore end (the ground there), relative to the pier base */
  rampFrom?: number;
  rampLen?: number;
}

/** One walkable rectangle of a pier in its local frame (u across, v along from the shore end). */
export interface PierDeckRect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  /** deck height at v0 and v1 (a ramp when they differ) */
  y0: number;
  y1: number;
  /** v range over which y0 -> y1 interpolates (the rest is flat at y1) */
  rampLen: number;
  /** the v0 edge is an open entrance (not guarded) */
  openStart: boolean;
}

/**
 * Single source of truth for pier dimensions: the plank geometry (buildPier) and the walkable deck
 * (map decks + collision) are both generated from this, so they can never disagree.
 */
export function pierLayout(p: PierParams = {}) {
  const L = p.length ?? 22;
  const W = p.width ?? 2.4;
  const Y = p.deckY ?? 0.75;
  const from = Math.min(Y, p.rampFrom ?? 0.08);
  const rampLen = p.rampLen ?? (Y - from > 0.3 ? Math.max(2.4, (Y - from) / 0.28) : 0);
  const head = p.head !== false && p.rail !== false ? { w: W * 2.2, d: 2.2, v: L + 1.0 } : null;
  const rects: PierDeckRect[] = [{ u0: -W / 2, u1: W / 2, v0: 0, v1: L, y0: rampLen > 0 ? from : Y, y1: Y, rampLen, openStart: true }];
  if (head) rects.push({ u0: -head.w / 2, u1: head.w / 2, v0: head.v - head.d / 2, v1: head.v + head.d / 2, y0: Y, y1: Y, rampLen: 0, openStart: false });
  /** deck height at distance v from the shore end (main span) */
  const heightAt = (v: number) => (rampLen > 0 && v < rampLen ? from + ((Y - from) * Math.max(0, v)) / rampLen : Y);
  return { L, W, Y, from, rampLen, head, rects, heightAt };
}

/** Pier along local +z, starting at the shore (z = 0) and ending at z = length. Layout from pierLayout(). */
export function buildPier(p: PierParams = {}, seed = 5): Group {
  const r = rng(seed);
  const lay = pierLayout(p);
  const L = lay.L;
  const W = lay.W;
  const Y = lay.Y;
  const b = new ModelBuilder();
  const n = Math.round(L / 0.3);
  const slope = lay.rampLen > 0 ? Math.atan2(Y - lay.from, lay.rampLen) : 0;
  for (let i = 0; i < n; i++) {
    const c = r() > 0.7 ? PAL.woodLight : r() > 0.35 ? PAL.wood : '#B97C42';
    const v = 0.15 + i * 0.3;
    const onRamp = v < lay.rampLen;
    // plank tops sit exactly on the walkable height (box centre 0.035 below the top)
    b.add(new BoxGeometry(W + range(r, -0.05, 0.05), 0.07, onRamp ? 0.29 : 0.27), {
      color: c,
      pos: [range(r, -0.02, 0.02), lay.heightAt(v) - 0.035, v],
      rot: [onRamp ? -slope : 0, 0, 0],
    });
  }
  // stringers: sloped under the ramp, flat after it
  for (const x of [-W / 2 + 0.12, W / 2 - 0.12]) {
    if (lay.rampLen > 0) {
      const len = Math.hypot(lay.rampLen, Y - lay.from);
      b.add(new BoxGeometry(0.12, 0.16, len), { color: PAL.woodDark, pos: [x, (lay.from + Y) / 2 - 0.15, lay.rampLen / 2], rot: [-slope, 0, 0] });
    }
    b.add(new BoxGeometry(0.12, 0.16, L - lay.rampLen), { color: PAL.woodDark, pos: [x, Y - 0.15, (L + lay.rampLen) / 2] });
  }
  const postDepth = p.posts ?? 2.2;
  for (let z = Math.max(1.5, lay.rampLen + 0.5); z < L; z += 3) {
    for (const x of [-W / 2 - 0.02, W / 2 + 0.02]) {
      b.add(new CylinderGeometry(0.11, 0.12, Y + postDepth, 7), { color: PAL.woodDark, pos: [x, Y - postDepth / 2 + 0.25, z] });
    }
  }
  if (p.rail === false && p.head === false) return b.build('boardwalk');
  // railing on the far half
  for (let z = L * 0.4; z <= L; z += 1.5) for (const x of [-W / 2 + 0.05, W / 2 - 0.05]) b.add(new BoxGeometry(0.08, 0.85, 0.08), { color: PAL.offWhite, pos: [x, Y + 0.45, z] });
  for (const x of [-W / 2 + 0.05, W / 2 - 0.05]) b.add(new BoxGeometry(0.07, 0.07, L * 0.6), { color: PAL.offWhite, pos: [x, Y + 0.86, L * 0.7] });
  // T-head at the end with a bench and a lamp
  const hd = lay.head!;
  b.add(new BoxGeometry(hd.w, 0.07, hd.d), { color: PAL.wood, pos: [0, Y - 0.035, hd.v] });
  for (const x of [-W * 1.05, W * 1.05]) b.add(new CylinderGeometry(0.11, 0.12, Y + 2.2, 7), { color: PAL.woodDark, pos: [x, Y - 0.85, L + 1.8] });
  b.add(new BoxGeometry(1.6, 0.08, 0.45), { color: PAL.woodLight, pos: [W * 0.6, Y + 0.45, L + 1.7] });
  b.add(new BoxGeometry(0.1, 0.4, 0.4), { color: PAL.woodDark, pos: [W * 0.6 - 0.7, Y + 0.22, L + 1.7] });
  b.add(new BoxGeometry(0.1, 0.4, 0.4), { color: PAL.woodDark, pos: [W * 0.6 + 0.7, Y + 0.22, L + 1.7] });
  b.add(new CylinderGeometry(0.05, 0.06, 2.4, 6), { color: PAL.navyDark, pos: [-W * 0.9, Y + 1.2, L + 1.8] });
  b.add(new SphereGeometry(0.16, 10, 8), { mat: toon({ unlit: true, emissive: 1.3 }), color: '#FFF1C9', pos: [-W * 0.9, Y + 2.5, L + 1.8] });
  // mooring bollards and a coiled rope
  b.add(new CylinderGeometry(0.1, 0.12, 0.3, 8), { color: PAL.black, pos: [W / 2 - 0.25, Y + 0.15, L * 0.55] });
  b.add(lathe([[0.18, 0], [0.22, 0.03], [0.18, 0.06], [0.1, 0.06], [0.06, 0.03], [0.1, 0]], 14), { color: '#E9D9B5', pos: [-W / 2 + 0.4, Y + 0.04, L * 0.8] });
  return b.build('pier');
}

/* ------------------------------------------------------------------ lighthouse ------------------------ */

export function buildLighthouse(): Group {
  const b = new ModelBuilder();
  const H = 9;
  b.add(lathe([[2.2, -0.4], [2.1, 0.0], [2.0, 0.5], [1.9, 0.55], [0.001, 0.56]], 16), { color: '#CBBBA6' });
  const tower = lathe([[1.35, 0], [1.25, H * 0.5], [0.95, H]], 18);
  b.add(tower, { mat: toon({ pattern: 'bands', color: PAL.offWhite, colorB: PAL.red, freq: 0.5, duty: 0.5, offset: 0.25 }), pos: [0, 0.5, 0] });
  // door and two small windows on the south side
  b.add(new BoxGeometry(0.6, 1.1, 0.12), { color: PAL.navyDark, pos: [0, 1.05, 1.3] });
  b.add(new BoxGeometry(0.3, 0.42, 0.1), { color: PAL.navyDark, pos: [0, 4.2, 1.17] });
  b.add(new BoxGeometry(0.3, 0.42, 0.1), { color: PAL.navyDark, pos: [0, 6.8, 1.05] });
  // gallery
  b.add(new CylinderGeometry(1.35, 1.25, 0.18, 18), { color: PAL.navyDark, pos: [0, H + 0.55, 0] });
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    b.add(new BoxGeometry(0.05, 0.55, 0.05), { color: PAL.offWhite, pos: [Math.cos(a) * 1.25, H + 0.9, Math.sin(a) * 1.25] });
  }
  b.add(lathe([[1.27, 0], [1.29, 0.03], [1.27, 0.06], [1.22, 0.03]], 24), { color: PAL.offWhite, pos: [0, H + 1.16, 0] });
  // lantern room
  b.add(new CylinderGeometry(0.75, 0.75, 1.15, 10), { mat: toon({ unlit: true, emissive: 1.25 }), color: '#FFE6A3', pos: [0, H + 1.3, 0] });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    b.add(new BoxGeometry(0.06, 1.15, 0.06), { color: PAL.navyDark, pos: [Math.cos(a) * 0.76, H + 1.3, Math.sin(a) * 0.76] });
  }
  b.add(new ConeGeometry(0.98, 0.85, 12), { color: PAL.red, pos: [0, H + 2.3, 0] });
  b.add(new SphereGeometry(0.14, 8, 6), { color: PAL.navyDark, pos: [0, H + 2.8, 0] });
  // keeper's cottage
  b.add(new BoxGeometry(2.4, 1.6, 2.0), { color: PAL.offWhite, pos: [-2.6, 0.8, 0.6] });
  b.add(new ConeGeometry(1.9, 1.0, 4), { color: PAL.red, pos: [-2.6, 2.1, 0.6], rot: [0, Math.PI / 4, 0], scale: [1.0, 1, 0.85] });
  return b.build('lighthouse');
}

/* ------------------------------------------------------------------ campfire -------------------------- */

const glowMat = new ShaderMaterial({
  uniforms: { uTime: G.uTime },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `uniform float uTime; varying vec2 vUv;
    void main(){ float d = length(vUv - 0.5) * 2.0; float f = 0.85 + 0.15 * sin(uTime * 9.0) * sin(uTime * 5.3);
      float a = pow(smoothstep(1.0, 0.0, d), 2.0); gl_FragColor = vec4(vec3(1.0, 0.5, 0.18) * a * 0.22 * f, 1.0); }`,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
});

/**
 * Stone ring + logs. The returned group contains a child named "flame" (three nested unlit cones) and
 * a ground "glow" disc; the world animates both.
 */
export function buildCampfire(seed = 9): Group {
  const r = rng(seed);
  const b = new ModelBuilder();
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    b.add(rockGeo(seed + k, 0.17, 0.12, 0.15, 0), { color: k % 2 ? PAL.rock : PAL.rockDark, mat: toon({ flat: true }), pos: [Math.cos(a) * 0.62, 0.07, Math.sin(a) * 0.62], rot: [0, r() * 6, 0] });
  }
  b.add(new CylinderGeometry(0.5, 0.55, 0.04, 14), { color: '#4A3A30', pos: [0, 0.01, 0] });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.3;
    b.add(new CylinderGeometry(0.07, 0.08, 0.85, 6), { color: k % 2 ? PAL.woodDark : '#6B4528', pos: [Math.cos(a) * 0.12, 0.2, Math.sin(a) * 0.12], rot: [Math.sin(a) * 1.0, 0, -Math.cos(a) * 1.0] });
  }
  const g = b.build('campfire');
  const flame = new Group();
  flame.name = 'flame';
  const layers: Array<[number, number, string, number]> = [
    [0.32, 0.95, PAL.orange, 1.6],
    [0.22, 0.75, PAL.flame, 1.9],
    [0.12, 0.5, PAL.flameCore, 2.4],
  ];
  for (const [rad, h, c, e] of layers) {
    const fb = new ModelBuilder();
    const cone = new ConeGeometry(rad, h, 7, 3);
    fb.add(cone, { mat: toon({ unlit: true, emissive: e }), color: c, pos: [0, h / 2 + 0.12, 0] });
    const m = fb.build('flame-layer', false);
    flame.add(m);
  }
  g.add(flame);
  const glow = new Mesh(new CircleGeometry(1.6, 24), glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.03;
  glow.name = 'glow';
  glow.renderOrder = 2;
  g.add(glow);
  return g;
}

/* ------------------------------------------------------------------ simple buildings (Vinland) -------- */

export function buildHut(p: { w?: number; d?: number; h?: number; wall?: string; roof?: string } = {}): Group {
  const W = p.w ?? 6;
  const D = p.d ?? 4;
  const H = p.h ?? 2.2;
  const b = new ModelBuilder();
  b.add(new BoxGeometry(W, H, D), { color: p.wall ?? '#8A6440', pos: [0, H / 2, 0] });
  b.add(new BoxGeometry(0.8, 1.5, 0.08), { color: '#4A3A2C', pos: [0, 0.75, D / 2 + 0.03] });
  // gable roof from two slabs
  const slope = 0.62;
  const half = D / 2 / Math.cos(slope) + 0.35;
  for (const s of [-1, 1]) {
    b.add(new BoxGeometry(W + 0.5, 0.18, half), {
      color: p.roof ?? '#6E8C4A',
      pos: [0, H + Math.sin(slope) * half * 0.5, s * Math.cos(slope) * half * 0.5],
      rot: [s * slope, 0, 0],
    });
  }
  return b.build('hut');
}

/** For cleanup paths that build glow meshes outside the builder. */
export const disposeSharedStructureMaterials = () => glowMat.dispose();

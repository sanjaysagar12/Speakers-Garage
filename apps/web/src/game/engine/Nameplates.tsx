import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, InstancedBufferAttribute, InstancedMesh, LinearFilter, Matrix4, PlaneGeometry, Quaternion, ShaderMaterial, SRGBColorSpace, Vector3 } from 'three';
import { useWorld } from './runtime';
import { QUALITY } from '../config';
import { useGameStore } from '../../store/useGameStore';
import { remotes } from '../net/entities';
import { gameStore } from '../../store/gameStore';

/**
 * Name tags and chat bubbles over players. Each is ONE instanced mesh of camera-facing quads that reads its
 * text from a shared canvas atlas (one draw call for all name tags, one for all bubbles). A slot is drawn
 * into the atlas only when its text changes. Speaking players' tags turn green (in the shader).
 */

const VERT = /* glsl */ `
  attribute vec4 aRect;
  attribute float aState;
  varying vec2 vUv;
  varying float vState;
  void main() {
    // billboard: instance position in view space, then offset by the quad corner (scaled)
    vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float s = length(instanceMatrix[0].xyz);
    c.xy += position.xy * s;
    gl_Position = projectionMatrix * c;
    vUv = mix(aRect.xy, aRect.zw, uv);
    vState = aState;
  }
`;
const FRAG = /* glsl */ `
  uniform sampler2D uAtlas;
  varying vec2 vUv;
  varying float vState;
  void main() {
    vec4 t = texture2D(uAtlas, vUv);
    if (t.a < 0.02) discard;
    // the pill background is pure white in the atlas: tint it green while the player speaks
    float bg = step(0.93, min(t.r, t.b));
    vec3 col = mix(t.rgb, vec3(0.42, 0.88, 0.55), bg * step(0.5, vState));
    gl_FragColor = vec4(col, t.a * (vState > 1.5 ? vState - 1.0 : 1.0));
    #include <colorspace_fragment>
  }
`;

interface Atlas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: CanvasTexture;
  cols: number;
  rows: number;
  slotW: number;
  slotH: number;
  /** key -> slot, slot -> text */
  byKey: Map<number, number>;
  text: string[];
  stamp: number[];
}

function makeAtlas(size: number, slotW: number, slotH: number): Atlas {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  const cols = Math.floor(size / slotW);
  const rows = Math.floor(size / slotH);
  return { canvas, ctx, tex, cols, rows, slotW, slotH, byKey: new Map(), text: Array(cols * rows).fill(''), stamp: Array(cols * rows).fill(0) };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Returns the slot for `key` with `text` drawn in it (LRU when full). */
function slotFor(a: Atlas, key: number, text: string, frame: number, draw: (a: Atlas, x: number, y: number, text: string) => void): number {
  let i = a.byKey.get(key);
  if (i === undefined) {
    // free or least recently used slot
    let best = 0;
    for (let k = 1; k < a.stamp.length; k++) if (a.stamp[k] < a.stamp[best]) best = k;
    for (const [kk, v] of a.byKey) if (v === best) a.byKey.delete(kk);
    i = best;
    a.byKey.set(key, i);
    a.text[i] = '\u0000';
  }
  a.stamp[i] = frame;
  if (a.text[i] !== text) {
    a.text[i] = text;
    const x = (i % a.cols) * a.slotW;
    const y = Math.floor(i / a.cols) * a.slotH;
    a.ctx.clearRect(x, y, a.slotW, a.slotH);
    draw(a, x, y, text);
    a.tex.needsUpdate = true;
  }
  return i;
}

const drawName = (a: Atlas, x: number, y: number, text: string) => {
  const c = a.ctx;
  c.font = 'bold 26px system-ui, sans-serif';
  const w = Math.min(a.slotW - 8, c.measureText(text).width + 28);
  const left = x + (a.slotW - w) / 2;
  c.fillStyle = 'rgba(255,255,255,1)';
  roundRect(c, left, y + 6, w, a.slotH - 12, (a.slotH - 12) / 2);
  c.fill();
  c.fillStyle = '#1F3B2C';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, x + a.slotW / 2, y + a.slotH / 2 + 1, a.slotW - 30);
};

const drawBubble = (a: Atlas, x: number, y: number, text: string) => {
  const c = a.ctx;
  c.font = '24px system-ui, sans-serif';
  // wrap into at most 3 lines
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (c.measureText(t).width > a.slotW - 40 && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  if (lines.length > 3) {
    lines.length = 3;
    lines[2] = `${lines[2].slice(0, -1)}…`;
  }
  const h = 18 + lines.length * 30;
  const w = Math.min(a.slotW - 8, Math.max(...lines.map((l) => c.measureText(l).width)) + 32);
  const left = x + (a.slotW - w) / 2;
  const top = y + a.slotH - h - 14;
  c.fillStyle = 'rgba(255,255,255,0.97)';
  roundRect(c, left, top, w, h, 16);
  c.fill();
  // tail
  c.beginPath();
  c.moveTo(x + a.slotW / 2 - 10, top + h - 1);
  c.lineTo(x + a.slotW / 2 + 10, top + h - 1);
  c.lineTo(x + a.slotW / 2, top + h + 12);
  c.closePath();
  c.fill();
  c.fillStyle = '#3A2E22';
  c.textAlign = 'center';
  c.textBaseline = 'top';
  lines.forEach((l, k) => c.fillText(l, x + a.slotW / 2, top + 10 + k * 30));
};

function makeLayer(maxCount: number, atlas: Atlas, w: number, h: number, order: number) {
  const geo = new PlaneGeometry(w, h);
  const rect = new InstancedBufferAttribute(new Float32Array(maxCount * 4), 4);
  const state = new InstancedBufferAttribute(new Float32Array(maxCount), 1);
  geo.setAttribute('aRect', rect);
  geo.setAttribute('aState', state);
  const mat = new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uAtlas: { value: atlas.tex } }, transparent: true, depthWrite: false });
  const mesh = new InstancedMesh(geo, mat, maxCount);
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  mesh.count = 0;
  return { mesh, rect, state, atlas };
}

const m4 = new Matrix4();
const pos = new Vector3();
const SCALE = new Vector3();
const NO_ROT = new Quaternion();

type Layer = ReturnType<typeof makeLayer>;
/** write instance i of a layer: atlas slot, position, scale, state */
function put(L: Layer, i: number, slot: number, x: number, y: number, z: number, s: number, st: number): void {
  const a = L.atlas;
  const u0 = (slot % a.cols) / a.cols;
  const v1 = 1 - Math.floor(slot / a.cols) / a.rows;
  L.rect.setXYZW(i, u0, v1 - 1 / a.rows, u0 + 1 / a.cols, v1);
  L.state.setX(i, st);
  L.mesh.setMatrixAt(i, m4.compose(pos.set(x, y, z), NO_ROT, SCALE.set(s, s, s)));
}

export function Nameplates() {
  const world = useWorld();
  const quality = useGameStore((s) => s.ui.quality);
  const q = QUALITY[quality];
  const layers = useMemo(() => {
    const names = makeLayer(64, makeAtlas(1024, 256, 48), 3.2, 0.6, 20);
    const bubbles = makeLayer(16, makeAtlas(1024, 512, 128), 4.8, 1.2, 21);
    return { names, bubbles, frame: 0 };
  }, []);
  useEffect(
    () => () => {
      for (const l of [layers.names, layers.bubbles]) {
        l.mesh.geometry.dispose();
        (l.mesh.material as ShaderMaterial).dispose();
        l.atlas.tex.dispose();
        l.mesh.dispose();
      }
    },
    [layers],
  );

  useFrame(({ camera }) => {
    const frame = ++layers.frame;
    const now = performance.now();
    const { names, bubbles } = layers;
    const maxD2 = q.nameTagDistance ** 2;
    const blocked = gameStore.getState().voice.blocked;
    let n = 0;
    let b = 0;
    for (const e of remotes.entities.values()) {
      const r = e.render;
      if (!r.ready) continue;
      const info = remotes.roster.get(e.id);
      if (!info) continue;
      const d2 = (r.x - camera.position.x) ** 2 + (r.z - camera.position.z) ** 2;
      const dp2 = (r.x - world.player.pos.x) ** 2 + (r.z - world.player.pos.z) ** 2;
      if (dp2 > maxD2) continue;
      const s = Math.min(1.5, Math.max(0.8, Math.sqrt(d2) / 22));
      if (n < names.mesh.instanceMatrix.count) {
        const slot = slotFor(names.atlas, e.id, info.name, frame, drawName);
        put(names, n++, slot, r.x, r.y + 2.15, r.z, s, info.voice.speaking ? 1 : 0);
      }
      if (e.chat && e.chat.until > now && b < bubbles.mesh.instanceMatrix.count && !blocked.includes(e.id)) {
        const slot = slotFor(bubbles.atlas, e.id, e.chat.text, frame, drawBubble);
        const fade = Math.min(1, (e.chat.until - now) / 600);
        put(bubbles, b++, slot, r.x, r.y + 3.1, r.z, s, fade < 1 ? 1 + fade : 0);
      }
    }
    // our own bubble
    const own = world.selfChat;
    if (own && own.until > now && b < bubbles.mesh.instanceMatrix.count) {
      const P = world.player.pos;
      const slot = slotFor(bubbles.atlas, -1, own.text, frame, drawBubble);
      const fade = Math.min(1, (own.until - now) / 600);
      put(bubbles, b++, slot, P.x, P.y + 2.9, P.z, 1, fade < 1 ? 1 + fade : 0);
    }
    names.mesh.count = n;
    bubbles.mesh.count = b;
    for (const L of [names, bubbles]) {
      if (!L.mesh.count) continue;
      L.mesh.instanceMatrix.needsUpdate = true;
      L.rect.needsUpdate = true;
      L.state.needsUpdate = true;
    }
  });

  return (
    <>
      <primitive object={layers.names.mesh} dispose={null} />
      <primitive object={layers.bubbles.mesh} dispose={null} />
    </>
  );
}

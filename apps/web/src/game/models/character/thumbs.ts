import { Color, PerspectiveCamera, Scene, Vector3, WebGLRenderer, NoToneMapping, SRGBColorSpace } from 'three';
import { Character } from './Character';
import { SLOT_FIELDS } from './catalog';
import type { AvatarConfig, Slot } from '../../../types';

/**
 * Option thumbnails for the customizer, drawn with the real 3D character by ONE shared offscreen renderer
 * (a WebGL context per thumbnail would hit browser limits). Results are cached data URLs.
 */
const W = 124;
const H = 152;
let renderer: WebGLRenderer | null = null;
let character: Character | null = null;
const scene = new Scene();
const camera = new PerspectiveCamera(30, W / H, 0.05, 20);
const cache = new Map<string, string>();
let queue: Promise<unknown> = Promise.resolve();

const VIEWS: Record<Slot, { target: [number, number, number]; dist: number; yaw: number; pitch: number }> = {
  hair: { target: [0, 1.58, 0], dist: 0.9, yaw: 200, pitch: 28 },
  hat: { target: [0, 1.6, 0], dist: 1.0, yaw: 30, pitch: 24 },
  top: { target: [0, 1.2, 0], dist: 1.45, yaw: 25, pitch: 14 },
  bottom: { target: [0, 0.72, 0], dist: 1.5, yaw: 25, pitch: 12 },
  shoes: { target: [0, 0.12, 0.04], dist: 0.85, yaw: 30, pitch: 26 },
  accessory: { target: [0, 1.32, 0], dist: 1.4, yaw: 150, pitch: 18 },
};

function ensure(cfg: AvatarConfig): { r: WebGLRenderer; c: Character } {
  if (!renderer) {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(W, H, false);
    renderer.toneMapping = NoToneMapping;
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setClearColor(new Color(0, 0, 0), 0);
  }
  if (!character) {
    character = new Character(cfg);
    scene.add(character.root);
  }
  return { r: renderer, c: character };
}

/** Render `slot = optionId` on top of `cfg`. Serialised so the shared character is never raced. */
export function renderThumb(cfg: AvatarConfig, slot: Slot, optionId: string): Promise<string> {
  const f = SLOT_FIELDS[slot];
  const look: AvatarConfig = { ...cfg, [f.id]: optionId };
  // hide clutter that covers the slot being shown
  if (slot === 'hair') look.hatId = 'none';
  if (slot === 'top' && look.accessoryId === 'backpack') look.accessoryId = 'none';
  const key = JSON.stringify([slot, look]);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const job = queue.then(
    () =>
      new Promise<string>((resolve) => {
        requestAnimationFrame(() => {
          const { r, c } = ensure(look);
          c.setConfig(look);
          c.update(0, { speed: 0, running: false, wade: 0, turnRate: 0, localVel: new Vector3() });
          const v = VIEWS[slot];
          const yaw = (v.yaw * Math.PI) / 180;
          const pitch = (v.pitch * Math.PI) / 180;
          camera.position.set(
            v.target[0] + Math.sin(yaw) * Math.cos(pitch) * v.dist,
            v.target[1] + Math.sin(pitch) * v.dist,
            v.target[2] + Math.cos(yaw) * Math.cos(pitch) * v.dist,
          );
          camera.lookAt(...v.target);
          r.render(scene, camera);
          const url = r.domElement.toDataURL('image/png');
          if (cache.size > 300) cache.clear();
          cache.set(key, url);
          resolve(url);
        });
      }),
  );
  queue = job.catch(() => undefined);
  return job;
}

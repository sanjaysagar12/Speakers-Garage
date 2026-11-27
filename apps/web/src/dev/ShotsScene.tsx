import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Box3, Group, Mesh, PCFShadowMap, PerspectiveCamera, PlaneGeometry, Sphere, Vector3 } from 'three';
import { PROPS } from '../game/models/catalog';
import { Character } from '../game/models/character/Character';
import { DEFAULT_AVATAR } from '@shoreline/shared';
import { disposeObject } from '../game/models/util/builder';
import { toon } from '../game/materials/toon';
import { G } from '../game/materials/globals';
import { PAL } from '../game/models/palette';
import { Sun } from '../game/engine/Sun';
import { GAME_CONFIG, DEG } from '../game/config';
import type { AvatarConfig } from '../types';
import { InstancedMesh, Matrix4 } from 'three';

/**
 * View-angle test scene (open the app with ?shots). Shows one model at a time from the real game camera
 * (same pitch and FOV) at any yaw. Driven by scripts/shots.mjs through window.__shots.
 */

const CHARACTERS: Record<string, Partial<AvatarConfig>> = {
  default: {},
  long_hoodie: { hairStyle: 'long', hairColor: '#1E1A1F', topId: 'hoodie', topColor: '#74DCD4', bottomId: 'trousers', bottomColor: '#3A3F4A', shoesId: 'sneakers', shoesColor: '#FBF6EE' },
  ponytail_skirt_hat: { hairStyle: 'ponytail', hairColor: '#C08A4A', topId: 'tank', topColor: '#EC847C', bottomId: 'skirt', bottomColor: '#FBF6EE', hatId: 'sun_hat', hatColor: '#F4E3C9', shoesId: 'sandals' },
  bun_backpack: { hairStyle: 'bun', hairColor: '#5A3A22', topId: 'tee', topColor: '#F6C945', bottomId: 'shorts', bottomColor: '#144454', accessoryId: 'backpack', accessoryColor: '#04A4B4' },
  braid_scarf: { hairStyle: 'braid', hairColor: '#C9622F', topId: 'swim_shirt', topColor: '#11738A', bottomId: 'trunks', bottomColor: '#EC847C', accessoryId: 'scarf', accessoryColor: '#F49AB0', shoesId: 'barefoot' },
  wavy_glasses: { hairStyle: 'wavy', hairColor: '#E8C878', topId: 'tank', topColor: '#FBF6EE', bottomId: 'shorts', bottomColor: '#04A4B4', accessoryId: 'sunglasses', accessoryColor: '#22252B' },
  bob_cap: { hairStyle: 'bob', hairColor: '#3B2A24', topId: 'tee', topColor: '#A79BE0', bottomId: 'skirt', bottomColor: '#11738A', hatId: 'cap', hatColor: '#EC847C', shoesId: 'sneakers', shoesColor: '#EC847C' },
  buzz_trunks: { hairStyle: 'buzz', hairColor: '#1E1A1F', skin: '#9C6440', topId: 'tank', topColor: '#5CA464', bottomId: 'trunks', bottomColor: '#F08A3C', shoesId: 'barefoot' },
  short_walk: { hairStyle: 'short' },
  long_run: { hairStyle: 'long', hairColor: '#1E1A1F', topId: 'tee', topColor: '#EC847C' },
};

/**
 * Fit sheets (npm run shots -- fit: / head:): close views from the front, side, back and a 3/4 view at
 * the game camera's pitch, to check sleeves, shoulders, brims and hair against the body.
 */
export const FIT_OUTFITS: Record<string, Partial<AvatarConfig>> = {
  tee_shorts: { topId: 'tee', topColor: '#A79BE0', bottomId: 'shorts', bottomColor: '#11738A', shoesId: 'sneakers', shoesColor: '#EC847C', hairStyle: 'short' },
  tank_trunks: { topId: 'tank', topColor: '#5CA464', bottomId: 'trunks', bottomColor: '#F08A3C', shoesId: 'sandals', hairStyle: 'buzz', skin: '#9C6440' },
  hoodie_trousers: { topId: 'hoodie', topColor: '#74DCD4', bottomId: 'trousers', bottomColor: '#3A3F4A', shoesId: 'sneakers', shoesColor: '#FBF6EE', hairStyle: 'long', hairColor: '#1E1A1F' },
  swim_skirt: { topId: 'swim_shirt', topColor: '#11738A', bottomId: 'skirt', bottomColor: '#F49AB0', shoesId: 'barefoot', hairStyle: 'ponytail', hairColor: '#C08A4A' },
  tee_skirt_cap: { topId: 'tee', topColor: '#FBF6EE', bottomId: 'skirt', bottomColor: '#11738A', hatId: 'cap', hatColor: '#EC847C', hairStyle: 'bob', shoesId: 'sandals' },
  hoodie_backpack_scarf: { topId: 'hoodie', topColor: '#F6C945', bottomId: 'shorts', bottomColor: '#144454', accessoryId: 'backpack', accessoryColor: '#04A4B4', hairStyle: 'wavy', hairColor: '#E8C878', hatId: 'sun_hat' },
  tee_scarf_glasses: { topId: 'tee', topColor: '#EC847C', bottomId: 'trousers', bottomColor: '#C98A4B', accessoryId: 'scarf', accessoryColor: '#F49AB0', hatId: 'cap', hairStyle: 'ponytail', shoesId: 'sneakers' },
  glasses_sunhat: { topId: 'swim_shirt', topColor: '#FBF6EE', bottomId: 'shorts', accessoryId: 'sunglasses', hatId: 'sun_hat', hairStyle: 'bun', hairColor: '#5A3A22' },
};
const FIT_HAIRS = ['short', 'buzz', 'bob', 'long', 'wavy', 'ponytail', 'bun', 'braid'];
const FIT_HATS = ['none', 'cap', 'sun_hat'];

export const SHOT_KEYS = [
  ...Object.keys(FIT_OUTFITS).map((k) => `fit:${k}`),
  ...Object.keys(FIT_OUTFITS).map((k) => `fit:${k}:walk`),
  ...FIT_HAIRS.flatMap((h) => FIT_HATS.map((t) => `head:${h}:${t}`)),
  ...Object.keys(PROPS).map((k) => `prop:${k}`),
  'prop:palm#0',
  'prop:palm#1',
  'prop:palm#2',
  'prop:umbrella#rings',
  'prop:umbrella#mixed',
  ...Object.keys(CHARACTERS).map((k) => `char:${k}`),
  'char:default_front',
  'char:long_hoodie_front',
];

interface Built {
  obj: Group;
  character: Character | null;
  water: boolean;
  motion: 'idle' | 'walk' | 'run';
  /** close-up framing: target height and distance */
  close?: { y: number; dist: number };
}

function buildEntry(key: string): Built {
  const [kind, rest] = key.split(':');
  if (kind === 'fit' || kind === 'head') {
    const parts = key.split(':');
    const cfg: AvatarConfig =
      kind === 'fit'
        ? { ...DEFAULT_AVATAR, ...FIT_OUTFITS[parts[1]] }
        : { ...DEFAULT_AVATAR, hairStyle: parts[1], hatId: parts[2], hairColor: '#5A3A22', hatColor: '#EC847C', topId: 'tee', topColor: '#FBF6EE' };
    const c = new Character(cfg);
    const g = new Group();
    g.add(c.root);
    return { obj: g, character: c, water: false, motion: parts[2] === 'walk' ? 'walk' : 'idle', close: kind === 'head' ? { y: 1.6, dist: 0.85 } : { y: 0.92, dist: 2.6 } };
  }
  if (kind === 'char') {
    const front = rest.endsWith('_front');
    const c = new Character({ ...DEFAULT_AVATAR, ...(CHARACTERS[rest.replace('_front', '')] ?? {}) });
    // the chase camera sits behind the player, so the default test view is the character's back
    c.root.rotation.y = front ? 0 : Math.PI;
    const g = new Group();
    g.add(c.root);
    return { obj: g, character: c, water: false, motion: rest.endsWith('walk') ? 'walk' : rest.endsWith('run') ? 'run' : 'idle' };
  }
  const [type, variant] = rest.split('#');
  const def = PROPS[type];
  const g = new Group();
  if (def.build) {
    const params: Record<string, unknown> = {};
    if (type === 'palm' && variant !== undefined) params.variant = Number(variant);
    if (type === 'umbrella') params.style = variant ?? 'radial';
    g.add(def.build(params, 7));
  } else if (def.instanced) {
    const m = new Matrix4();
    for (let v = 0; v < def.instanced.variants; v++) {
      const { geometry, material } = def.instanced.build(v, {}).buildGeometry();
      const inst = new InstancedMesh(geometry, material, 3);
      for (let i = 0; i < 3; i++) {
        m.makeRotationY(i * 1.7 + v);
        m.setPosition((v - (def.instanced.variants - 1) / 2) * 0.55, 0, (i - 1) * 0.45);
        inst.setMatrixAt(i, m);
      }
      inst.castShadow = def.instanced.castShadow ?? false;
      inst.receiveShadow = true;
      g.add(inst);
    }
  }
  return { obj: g, character: null, water: !!def.floats, motion: 'idle' };
}

function Rig({ entry, yaw, onReady }: { entry: Built; yaw: number; onReady: () => void }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const target = useRef(new Vector3());
  const frames = useRef(0);
  useEffect(() => {
    const box = new Box3().setFromObject(entry.obj);
    const sphere = box.getBoundingSphere(new Sphere());
    target.current.copy(sphere.center);
    const isChar = !!entry.character;
    let dist = isChar ? 3.3 : Math.min(34, Math.max(3.2, sphere.radius * 3.4));
    if (isChar) target.current.set(0, 1.05, 0);
    let pitch = GAME_CONFIG.camera.pitchDeg * DEG;
    if (entry.close) {
      // front/side/back views are level; the 3/4 view (yaw 135) uses the game camera's pitch
      target.current.set(0, entry.close.y, 0);
      dist = entry.close.dist;
      if (yaw !== 135) pitch = 8 * DEG;
    }
    camera.fov = GAME_CONFIG.camera.fov;
    camera.position.set(
      target.current.x + Math.sin(yaw * DEG) * Math.cos(pitch) * dist,
      target.current.y + Math.sin(pitch) * dist,
      target.current.z + Math.cos(yaw * DEG) * Math.cos(pitch) * dist,
    );
    camera.lookAt(target.current);
    camera.near = 0.1;
    camera.far = 400;
    camera.updateProjectionMatrix();
    frames.current = 0;
  }, [entry, yaw, camera]);

  useFrame((_, dt) => {
    G.uTime.value += dt;
    const c = entry.character;
    if (c) {
      const speed = entry.motion === 'walk' ? GAME_CONFIG.player.walkSpeed : entry.motion === 'run' ? GAME_CONFIG.player.runSpeed : 0;
      // deterministic pose: fixed time step
      c.update(1 / 60, { speed, running: entry.motion === 'run', wade: 0, turnRate: 0, localVel: new Vector3(0, 0, speed) });
      c.root.rotation.z = 0;
    }
    frames.current++;
    if (frames.current === 24) onReady();
  });
  return <Sun target={target} extent={Math.max(8, 14)} mapSize={2048} />;
}

const groundGeo = new PlaneGeometry(200, 200).rotateX(-Math.PI / 2);

function Ground({ water }: { water: boolean }) {
  const mesh = useMemo(() => {
    const m = new Mesh(groundGeo, toon({ color: water ? PAL.teal : PAL.sand, grain: 1 }));
    m.receiveShadow = true;
    return m;
  }, [water]);
  return <primitive object={mesh} dispose={null} />;
}

export default function ShotsScene() {
  const [state, setState] = useState<{ key: string; yaw: number }>({ key: SHOT_KEYS[0], yaw: -1 });
  const resolver = useRef<(() => void) | null>(null);
  const entry = useMemo(() => buildEntry(state.key), [state.key]);
  useEffect(
    () => () => {
      entry.character?.dispose();
      disposeObject(entry.obj);
    },
    [entry],
  );
  useEffect(() => {
    (window as unknown as { __shots: unknown }).__shots = {
      keys: SHOT_KEYS,
      show: (key: string, yaw: number) =>
        new Promise<void>((resolve) => {
          resolver.current = resolve;
          setState({ key, yaw });
        }),
    };
  }, []);
  return (
    <div style={{ position: 'fixed', inset: 0, background: PAL.sand }}>
      <Canvas flat shadows={{ type: PCFShadowMap }} dpr={1} camera={{ fov: 38, position: [0, 10, 10] }} gl={{ preserveDrawingBuffer: true, antialias: true }}>
        <color attach="background" args={[PAL.sand]} />
        <Ground water={entry.water} />
        <primitive object={entry.obj} dispose={null} />
        <Rig
          entry={entry}
          yaw={state.yaw}
          onReady={() => {
            resolver.current?.();
            resolver.current = null;
          }}
        />
      </Canvas>
      <div style={{ position: 'absolute', left: 8, top: 6, font: '600 14px system-ui', color: '#5a4320' }} data-testid="label">
        {state.key} · yaw {state.yaw}°
      </div>
    </div>
  );
}

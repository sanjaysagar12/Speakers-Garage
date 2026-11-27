import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, Raycaster, Vector2, Vector3, type PerspectiveCamera } from 'three';
import { ANIM, sanitizeAvatar, type AvatarConfig } from '@speakersgarage/shared';
import { Character, type CharacterMotion } from '../models/character/Character';
import { useWorld } from './runtime';
import { QUALITY } from '../config';
import { useGameStore } from '../../store/useGameStore';
import { remotes, type RemoteEntity } from '../net/entities';
import { gameStore } from '../../store/gameStore';

interface Slot {
  character: Character;
  entityId: number;
  avatarKey: string;
  /** time accumulated for reduced-rate animation of far players */
  acc: number;
  motion: CharacterMotion;
}

const avatarKey = (a: AvatarConfig) => Object.values(a).join('|');
const ray = new Raycaster();
const ndc = new Vector2();
const body = new Vector3();
const toBody = new Vector3();
const UP = new Vector3(0, 1, 0);

/**
 * Remote players. Positions come from the interpolated entity store (net/entities.ts), never from React
 * state. A pool of Character instances (as many as the quality tier allows) is assigned to the nearest
 * players a few times per second; a slot is re-dressed (setConfig) only when its player changes, so the
 * per-avatar mesh composition is cached per slot and memory is bounded by the tier.
 * The gait is driven by the interpolated velocity and distance travelled, like the local player, so remote
 * feet don't skate; the animation byte carries running / wading / emotes. Far players animate at ~15 Hz.
 */
export function RemotePlayers() {
  const world = useWorld();
  const quality = useGameStore((s) => s.ui.quality);
  const q = QUALITY[quality];
  const group = useMemo(() => {
    const g = new Group();
    g.name = 'remotes';
    return g;
  }, []);
  const pool = useMemo(() => ({ slots: [] as Slot[], frame: 0, near: [] as RemoteEntity[] }), []);

  useEffect(
    () => () => {
      for (const s of pool.slots) s.character.dispose();
      pool.slots.length = 0;
      group.clear();
    },
    [pool, group],
  );

  const assign = () => {
    const P = world.player.pos;
    const near = pool.near;
    near.length = 0;
    for (const e of remotes.entities.values()) if (e.render.ready && remotes.roster.has(e.id)) near.push(e);
    const d2 = (e: RemoteEntity) => (e.render.x - P.x) ** 2 + (e.render.z - P.z) ** 2;
    near.sort((a, b) => d2(a) - d2(b));
    const cap = q.remotePlayers;
    if (near.length > cap) near.length = cap;
    // shrink the pool when the tier dropped
    while (pool.slots.length > cap) {
      const s = pool.slots.pop()!;
      group.remove(s.character.root);
      s.character.dispose();
    }
    const wanted = new Set(near.map((e) => e.id));
    const free: Slot[] = [];
    for (const s of pool.slots) if (!wanted.has(s.entityId)) free.push(s);
    const have = new Set(pool.slots.map((s) => s.entityId));
    for (const e of near) {
      if (have.has(e.id)) continue;
      const info = remotes.roster.get(e.id)!;
      let s = free.pop();
      if (!s) {
        s = {
          character: new Character(sanitizeAvatar(info.avatar)),
          entityId: e.id,
          avatarKey: '',
          acc: 0,
          motion: { speed: 0, running: false, wade: 0, turnRate: 0, localVel: new Vector3(), emote: 0 },
        };
        pool.slots.push(s);
        group.add(s.character.root);
      }
      s.entityId = e.id;
      s.character.root.visible = true;
    }
    for (const s of free) if (!wanted.has(s.entityId)) s.character.root.visible = false;
    // re-dress slots whose player changed clothes (or that got a new player)
    for (const s of pool.slots) {
      const info = remotes.roster.get(s.entityId);
      if (!info) continue;
      const key = avatarKey(info.avatar);
      if (key !== s.avatarKey) {
        s.character.setConfig(sanitizeAvatar(info.avatar));
        s.avatarKey = key;
      }
    }
  };

  useFrame(({ camera, gl }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    remotes.sampleAll(performance.now());
    // right-click on a player -> player menu (ray vs. a 0.45 m body radius around chest height)
    const rc = world.input?.rightClick;
    if (rc && world.input) {
      world.input.rightClick = null;
      const rect = gl.domElement.getBoundingClientRect();
      ndc.set(((rc.x - rect.left) / rect.width) * 2 - 1, -((rc.y - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera as PerspectiveCamera);
      let best = -1;
      let bestT = Infinity;
      for (const s of pool.slots) {
        if (!s.character.root.visible) continue;
        body.copy(s.character.root.position).setY(s.character.root.position.y + 0.95);
        const t = toBody.copy(body).sub(ray.ray.origin).dot(ray.ray.direction);
        if (t <= 0 || t >= bestT) continue;
        if (ray.ray.distanceSqToPoint(body) < 0.45 * 0.45 * 2.2) {
          best = s.entityId;
          bestT = t;
        }
      }
      if (best >= 0) gameStore.getState().setVoice({ menu: { id: best, x: rc.x, y: rc.y } });
    }
    if (pool.frame++ % 15 === 0 || remotes.version !== (pool as { v?: number }).v) {
      (pool as { v?: number }).v = remotes.version;
      assign();
    }
    const P = world.player.pos;
    const farD2 = q.remoteAnimDistance ** 2;
    for (const s of pool.slots) {
      if (!s.character.root.visible) continue;
      const e = remotes.entities.get(s.entityId);
      if (!e || !e.render.ready) {
        s.character.root.visible = false;
        continue;
      }
      const r = e.render;
      const c = s.character;
      c.root.position.set(r.x, r.y, r.z);
      c.root.rotation.y = r.heading;
      // far players animate at ~15 Hz
      s.acc += dt;
      const far = (r.x - P.x) ** 2 + (r.z - P.z) ** 2 > farD2;
      if (far && s.acc < 0.066) continue;
      const step = s.acc;
      s.acc = 0;
      const m = s.motion;
      const sp = Math.hypot(r.vx, r.vz);
      m.speed = sp;
      m.running = (r.anim & ANIM.running) !== 0;
      m.wade = (r.anim & ANIM.wading) !== 0 ? 0.5 : 0;
      m.turnRate = 0;
      m.localVel.set(r.vx, 0, r.vz).applyAxisAngle(UP, -r.heading);
      m.emote = r.anim >> 4;
      c.update(step, m);
    }
  });

  return <primitive object={group} dispose={null} />;
}

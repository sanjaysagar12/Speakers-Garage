import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector2, Vector3, Raycaster, type PerspectiveCamera } from 'three';
import { Character } from '../models/character/Character';
import { GAME_CONFIG } from '../config';
import { deckAt, standHeight } from '../maps/deck';
import { debugStats, useWorld } from './runtime';
import { stepMovement } from './controller';
import { gameBridge } from '../../store/bridge';
import { gameStore } from '../../store/gameStore';
import type { Vec2 } from '../../types';

const tmp = new Vector3();
const UP = new Vector3(0, 1, 0);
/** reused every frame (no per-frame allocation) */
const motion = { speed: 0, running: false, wade: 0, turnRate: 0, localVel: new Vector3() };
const ray = new Raycaster();
const ndc = new Vector2();

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** The local player: character model + controller. */
export function Player() {
  const world = useWorld();
  const { camera, gl } = useThree();
  const character = useMemo(() => new Character(gameStore.getState().avatar), []);
  const path = useRef<Vec2[] | null>(null);
  const pendingSpot = useRef<string | null>(null);
  const lastPublish = useRef(0);
  const stepToggle = useRef(0);

  useEffect(() => {
    const off = gameBridge.onAvatarChange((a) => character.setConfig(a));
    return () => {
      off();
      character.dispose();
    };
  }, [character]);

  // footsteps -> prints, ripples, puffs
  useEffect(() => {
    const map = world.map;
    character.onStep = (foot) => {
      const fx = world.fx;
      if (!fx) return;
      const p = character.footWorld(foot, tmp);
      const terrain = map.terrainAt(p.x, p.z);
      const y = standHeight(map, p.x, p.z);
      const wade = map.wadeDepth(p.x, p.z);
      if (wade > 0.04) {
        fx.ripple(p.x, y + wade, p.z, 0.6 + wade);
        if (world.player.running || Math.random() < 0.5) fx.burst(p.x, y + wade, p.z, 'splash', world.player.running ? 7 : 3);
      } else if (terrain !== 'deck' && terrain !== 'rock') {
        fx.footprint(p.x, y, p.z, world.player.facing, terrain === 'wet' || terrain === 'shallow');
        if (world.player.running && terrain !== 'grass') fx.burst(p.x, y, p.z, 'sand', 4);
      }
      stepToggle.current ^= 1;
    };
    return () => {
      character.onStep = null;
    };
  }, [character, world]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const map = world.map;
    const P = world.player;
    const input = world.input;
    world.path.update();
    if (!input) return;

    // click / tap -> path (and pending interaction when the click lands on a spot)
    if (input.click) {
      const rect = gl.domElement.getBoundingClientRect();
      ndc.set(((input.click.x - rect.left) / rect.width) * 2 - 1, -((input.click.y - rect.top) / rect.height) * 2 + 1);
      input.click = null;
      ray.setFromCamera(ndc, camera as PerspectiveCamera);
      // intersect the height field: plane, then refine with the local height a few times
      let h = P.pos.y;
      const hit = new Vector3();
      for (let i = 0; i < 4; i++) {
        const t = (h - ray.ray.origin.y) / ray.ray.direction.y;
        if (!(t > 0)) break;
        hit.copy(ray.ray.origin).addScaledVector(ray.ray.direction, t);
        h = standHeight(map, hit.x, hit.z);
      }
      const spot = map.interactions.find((s) => Math.hypot(s.x - hit.x, s.y - hit.z) < Math.max(1.2, s.radius * 0.6));
      pendingSpot.current = spot?.id ?? null;
      const target = spot ? { x: spot.x, y: spot.y } : { x: hit.x, y: hit.z };
      void world.path.findPath({ x: P.pos.x, y: P.pos.z }, target).then((pts) => {
        path.current = pts;
      });
    }

    // desired direction: keys/joystick are camera-relative, otherwise follow the path
    const mv = input.move();
    const yaw = world.camera.yaw;
    let dx = 0;
    let dz = 0;
    let run = mv.run;
    if (mv.x !== 0 || mv.y !== 0) {
      path.current = null;
      pendingSpot.current = null;
      // camera forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw)
      dx = Math.cos(yaw) * mv.x - Math.sin(yaw) * mv.y;
      dz = -Math.sin(yaw) * mv.x - Math.cos(yaw) * mv.y;
    } else if (path.current && path.current.length) {
      const wp = path.current[0];
      const ex = wp.x - P.pos.x;
      const ez = wp.y - P.pos.z;
      const d = Math.hypot(ex, ez);
      if (d < 0.25) {
        path.current.shift();
        if (!path.current.length) path.current = null;
      } else {
        dx = ex / d;
        dz = ez / d;
        run = run || path.current.length > 2 || d > 12;
        // ease in on the last waypoint
        if (path.current.length === 1 && d < 1.2) {
          dx *= Math.max(0.35, d / 1.2);
          dz *= Math.max(0.35, d / 1.2);
        }
      }
    }
    if (pendingSpot.current) {
      const s = map.interactions.find((i) => i.id === pendingSpot.current);
      if (s && Math.hypot(s.x - P.pos.x, s.y - P.pos.z) < s.radius) {
        world.triggerInteraction?.(s.id);
        pendingSpot.current = null;
        path.current = null;
      }
    }

    const wade = map.wadeDepth(P.pos.x, P.pos.z);
    const slow = wade > 0.02 ? GAME_CONFIG.player.shallowMultiplier : 1;
    // shared, tested movement step (collision + sliding + sub-steps + height rule): src/game/engine/controller.ts
    const next = stepMovement({ x: P.pos.x, z: P.pos.z, y: P.pos.y, vx: P.vel.x, vz: P.vel.z }, { x: 0, y: 0, run, yaw }, dt, { map, grid: world.grid }, { dx, dz });
    P.pos.set(next.x, next.y, next.z);
    P.vel.set(next.vx, 0, next.vz);
    world.debugMove.set(dx, 0, dz);
    Object.assign(debugStats, {
      x: P.pos.x,
      z: P.pos.z,
      y: P.pos.y,
      ground: standHeight(map, P.pos.x, P.pos.z),
      deck: !!deckAt(map, P.pos.x, P.pos.z),
      terrain: map.terrainAt(P.pos.x, P.pos.z),
      yawDeg: (yaw * 180) / Math.PI,
      speed: Math.hypot(P.vel.x, P.vel.z),
      moveX: dx,
      moveZ: dz,
      blocked: (dx !== 0 || dz !== 0) && Math.hypot(P.vel.x, P.vel.z) < 0.05,
    });

    const hs = Math.hypot(P.vel.x, P.vel.z);
    P.moving = hs > 0.2;
    P.running = run && hs > GAME_CONFIG.player.walkSpeed * slow * 1.05;
    P.wade = wade;

    // smooth turn toward the movement direction (no snapping)
    let turnRate = 0;
    if (hs > 0.15) {
      const target = Math.atan2(P.vel.x, P.vel.z);
      const diff = wrapAngle(target - P.facing);
      const step = Math.sign(diff) * Math.min(Math.abs(diff), GAME_CONFIG.player.turnSpeed * dt * (0.5 + Math.min(1, Math.abs(diff))));
      P.facing = wrapAngle(P.facing + step);
      turnRate = step / Math.max(dt, 1e-4);
    }


    character.root.position.copy(P.pos);
    character.root.rotation.y = P.facing;
    motion.localVel.set(P.vel.x, 0, P.vel.z).applyAxisAngle(UP, -P.facing);
    motion.speed = hs;
    motion.running = P.running;
    motion.wade = Math.min(1, wade / 0.45);
    motion.turnRate = turnRate;
    character.update(dt, motion);

    // wading leaves a slow trail of ripples even between steps
    if (wade > 0.08 && P.moving && Math.random() < dt * 5) world.fx?.ripple(P.pos.x, P.pos.y + wade, P.pos.z, 0.9);

    const now = performance.now();
    if (now - lastPublish.current > GAME_CONFIG.ui.positionPublishMs) {
      lastPublish.current = now;
      gameBridge.publishPosition(P.pos.x, P.pos.z, P.facing, world.camera.yaw);
    }
  });

  return <primitive object={character.root} dispose={null} />;
}

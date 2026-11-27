import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector2, Vector3, Raycaster, type PerspectiveCamera } from 'three';
import { Character } from '../models/character/Character';
import { GAME_CONFIG } from '../config';
import { deckAt, standHeight } from '@shoreline/shared';
import { debugStats, useWorld } from './runtime';
import { NET, Predictor, STEP_DT, newPlayerSim, wrapAngle, type InputCommand } from '@shoreline/shared';
import { session } from '../net/session';
import { remotes } from '../net/entities';
import { localEmote, setLocalEmote } from '../net/emotes';
import { listenerPose } from '../../voice/voice';
import { gameBridge } from '../../store/bridge';
import { gameStore } from '../../store/gameStore';
import type { Vec2 } from '../../types';

const tmp = new Vector3();
const UP = new Vector3(0, 1, 0);
/** reused every frame (no per-frame allocation) */
const motion = { speed: 0, running: false, wade: 0, turnRate: 0, localVel: new Vector3(), emote: 0 };
const ray = new Raycaster();
const ndc = new Vector2();

/** The local player: character model + controller. */
export function Player() {
  const world = useWorld();
  const { camera, gl } = useThree();
  const character = useMemo(() => new Character(gameStore.getState().avatar), []);
  const path = useRef<Vec2[] | null>(null);
  const pendingSpot = useRef<string | null>(null);
  const lastPublish = useRef(0);
  const stepToggle = useRef(0);
  const env = useMemo(() => ({ map: world.map, grid: world.grid }), [world]);
  /** prediction state: the authoritative-compatible simulation + render interpolation and corrections */
  const sim = useMemo(() => {
    const P = world.player;
    const s0 = newPlayerSim(P.pos.x, P.pos.z, P.pos.y, P.facing);
    return { pred: new Predictor(s0), prev: { ...s0 }, acc: 0, sendAcc: 0, corr: new Vector3(), out: [] as InputCommand[] };
  }, [world]);

  // server: spawn point (welcome), reconciliation (every snapshot), our own chat bubble
  useEffect(() => {
    const net = session.adapter;
    const spawnAt = (sp: { x: number; z: number; y: number; facing: number }) => {
      const s = newPlayerSim(sp.x, sp.z, sp.y, sp.facing);
      sim.pred.reset(s);
      Object.assign(sim.prev, s);
      sim.corr.set(0, 0, 0);
      path.current = null;
      world.player.pos.set(sp.x, sp.y, sp.z);
      world.player.facing = sp.facing;
      world.camera.focus.copy(world.player.pos);
    };
    world.teleport = (x, z, facing) => spawnAt({ x, z, y: standHeight(world.map, x, z), facing });
    const welcome = session.ws?.welcome;
    if (welcome) spawnAt(welcome.spawn);
    const offs = [
      net.onEvent?.((m) => {
        if (m.t === 'welcome') spawnAt(m.spawn);
        if (m.t === 'chat' && m.id === remotes.selfId) world.selfChat = { text: m.text, until: performance.now() + 6000 };
      }),
      net.onSelfSnapshot?.((snap) => {
        const S = sim.pred.state;
        const bx = S.x;
        const by = S.y;
        const bz = S.z;
        const err = sim.pred.reconcile(snap.self, snap.ackSeq, true, env);
        const ddx = S.x - bx;
        const ddy = S.y - by;
        const ddz = S.z - bz;
        sim.prev.x += ddx;
        sim.prev.y += ddy;
        sim.prev.z += ddz;
        // small errors blend away over ~100 ms; large ones (teleport, long stall) snap
        if (err > 1.5) sim.corr.set(0, 0, 0);
        else if (err > 0) sim.corr.set(sim.corr.x - ddx, sim.corr.y - ddy, sim.corr.z - ddz);
        world.netError = err;
      }),
    ];
    return () => {
      offs.forEach((o) => o?.());
      world.teleport = null;
    };
  }, [sim, env, world]);

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

    // fixed 60 Hz steps through the shared command layer (the server runs the same steps); rendering
    // interpolates between the last two steps, plus a short-lived correction offset after reconciliation
    const S = sim.pred.state;
    const Q = sim.prev;
    sim.acc = Math.min(sim.acc + rawDt, 0.25);
    let n = 0;
    while (sim.acc >= STEP_DT && n < 8) {
      Object.assign(Q, S);
      sim.pred.step(dx, dz, run, yaw, env);
      sim.acc -= STEP_DT;
      n++;
    }
    if (n === 8) sim.acc = 0;
    const net = session.adapter;
    if (net.authoritative && net.sendCommands) {
      sim.sendAcc += rawDt;
      if (sim.sendAcc >= 1 / NET.sendHz) {
        sim.sendAcc %= 1 / NET.sendHz;
        net.sendCommands(sim.out, sim.pred.takeUnsent(sim.out));
      }
    } else sim.pred.acknowledgeAll();
    const a = sim.acc / STEP_DT;
    sim.corr.multiplyScalar(Math.exp(-rawDt / 0.1));
    if (sim.corr.lengthSq() < 1e-8) sim.corr.set(0, 0, 0);
    P.pos.set(Q.x + (S.x - Q.x) * a + sim.corr.x, Q.y + (S.y - Q.y) * a + sim.corr.y, Q.z + (S.z - Q.z) * a + sim.corr.z);
    P.vel.set(S.vx, 0, S.vz);
    P.facing = wrapAngle(Q.facing + wrapAngle(S.facing - Q.facing) * a);
    const turnRate = sim.pred.lastTurnRate;
    const wade = map.wadeDepth(P.pos.x, P.pos.z);
    const slow = wade > 0.02 ? GAME_CONFIG.player.shallowMultiplier : 1;

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
    // moving ends sitting / dancing; a wave plays once
    const em = localEmote;
    if (em.id && (performance.now() > em.until || (hs > 0.5 && em.id !== 1))) setLocalEmote(null);

    character.root.position.copy(P.pos);
    character.root.rotation.y = P.facing;
    motion.localVel.set(P.vel.x, 0, P.vel.z).applyAxisAngle(UP, -P.facing);
    motion.speed = hs;
    motion.running = P.running;
    motion.wade = Math.min(1, wade / 0.45);
    motion.turnRate = turnRate;
    motion.emote = localEmote.id;
    character.update(dt, motion);

    // wading leaves a slow trail of ripples even between steps
    if (wade > 0.08 && P.moving && Math.random() < dt * 5) world.fx?.ripple(P.pos.x, P.pos.y + wade, P.pos.z, 0.9);

    listenerPose.x = P.pos.x;
    listenerPose.z = P.pos.z;
    listenerPose.yaw = world.camera.yaw;

    const now = performance.now();
    if (now - lastPublish.current > GAME_CONFIG.ui.positionPublishMs) {
      lastPublish.current = now;
      gameBridge.publishPosition(P.pos.x, P.pos.z, P.facing, world.camera.yaw);
    }
  });

  return <primitive object={character.root} dispose={null} />;
}

import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  Color,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  MathUtils,
  Object3D,
  PlaneGeometry,
  Vector3,
} from 'three';
import { buildCrab, buildGull } from '../models/creatures';
import { disposeObject } from '../models/util/builder';
import { toon } from '../materials/toon';
import { G } from '../materials/globals';
import { GAME_CONFIG } from '../config';
import { PAL } from '../models/palette';
import { useWorld } from './runtime';
import { gameBridge } from '../../store/bridge';
import { useGameStore } from '../../store/useGameStore';

const dummy = new Object3D();
const MIDDAY_SUN = new Vector3(-0.5, 1.0, -0.28).normalize();
const white = new Color(1, 1, 1);
const golden = new Color(1.08, 0.9, 0.7);
const sunset = new Color(1.12, 0.72, 0.55);

/** Global time, wind gusts, drifting cloud shadows and the optional golden-hour -> sunset cycle. */
export function WorldClock() {
  const cycle = useGameStore((s) => s.ui.dayNight);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const t = (G.uTime.value += dt);
    const w = GAME_CONFIG.wind;
    const gust = Math.max(0, Math.sin(t * 0.21) * Math.sin(t * 0.13 + 1.3));
    G.uWind.value.y = w.base + w.gust * gust;
    // clouds drift with the wind
    G.uCloud.value.x -= Math.cos(w.angle) * dt * 2.2;
    G.uCloud.value.y -= Math.sin(w.angle) * dt * 2.2;

    // sun: midday by default; when the cycle is on, midday -> golden hour -> sunset -> back
    const phase = cycle ? (t / GAME_CONFIG.dayCycle.cycleSeconds) % 1 : 0;
    const k = cycle ? 0.5 - 0.5 * Math.cos(phase * Math.PI * 2) : 0; // 0 midday .. 1 sunset
    const el = MathUtils.lerp(1.0, 0.36, k);
    const target = new Vector3(MIDDAY_SUN.x * (1 + k * 0.9), el, MIDDAY_SUN.z * (1 - k * 0.5)).normalize();
    G.uSunDir.value.lerp(target, 1 - Math.exp(-3 * dt)).normalize();
    const col = k < 0.5 ? white.clone().lerp(golden, k * 2) : golden.clone().lerp(sunset, (k - 0.5) * 2);
    G.uSunColor.value.lerp(col, 1 - Math.exp(-3 * dt));
    G.uWarm.value = MathUtils.damp(G.uWarm.value, k, 3, dt);
    if (cycle) gameBridge.publishTimeOfDay(phase);
  });
  useEffect(
    () => () => {
      G.uSunDir.value.copy(MIDDAY_SUN);
      G.uSunColor.value.set(1, 1, 1);
      G.uWarm.value = 0;
    },
    [],
  );
  return null;
}

interface Gull {
  obj: Group;
  wl: Object3D;
  wr: Object3D;
  cx: number;
  cz: number;
  r: number;
  h: number;
  w: number;
  a: number;
  flap: number;
}

/** Seagulls circling high over the player's surroundings; their real shadows sweep across the sand. */
export function Gulls({ count }: { count: number }) {
  const world = useWorld();
  const gulls = useMemo<Gull[]>(() => {
    return Array.from({ length: count }, (_, i) => {
      const obj = buildGull();
      obj.scale.setScalar(1.25);
      return {
        obj,
        wl: obj.getObjectByName('wingL')!,
        wr: obj.getObjectByName('wingR')!,
        cx: world.player.pos.x + (Math.random() - 0.5) * 30,
        cz: world.player.pos.z + (Math.random() - 0.5) * 30,
        r: 6 + Math.random() * 12,
        h: 6.5 + Math.random() * 6,
        w: (0.18 + Math.random() * 0.2) * (i % 2 ? 1 : -1),
        a: Math.random() * Math.PI * 2,
        flap: Math.random() * 10,
      };
    });
  }, [count, world]);
  const root = useMemo(() => {
    const g = new Group();
    gulls.forEach((x) => g.add(x.obj));
    return g;
  }, [gulls]);
  useEffect(() => () => gulls.forEach((g) => disposeObject(g.obj)), [gulls]);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const t = G.uTime.value;
    const P = world.player.pos;
    for (const g of gulls) {
      // circle centres wander toward the player so shadows keep crossing the visible sand
      g.cx += (P.x + Math.sin(g.flap) * 10 - g.cx) * dt * 0.05;
      g.cz += (P.z + Math.cos(g.flap) * 10 - g.cz) * dt * 0.05;
      g.a += g.w * dt;
      const x = g.cx + Math.cos(g.a) * g.r;
      const z = g.cz + Math.sin(g.a) * g.r;
      g.obj.position.set(x, g.h + Math.sin(t * 0.7 + g.flap) * 0.4, z);
      g.obj.rotation.y = Math.atan2(-Math.sin(g.a) * Math.sign(g.w), Math.cos(g.a) * Math.sign(g.w));
      g.obj.rotation.z = -Math.sign(g.w) * 0.25;
      // flap in bursts, glide in between
      const gliding = Math.sin(t * 0.4 + g.flap) > 0.2;
      const f = gliding ? 0.12 + Math.sin(t * 2 + g.flap) * 0.05 : Math.sin(t * 9 + g.flap) * 0.65;
      g.wl.rotation.z = f;
      g.wr.rotation.z = -f;
    }
  });
  return <primitive object={root} dispose={null} />;
}

interface Crab {
  obj: Group;
  legs: Object3D | null;
  x: number;
  z: number;
  dir: number;
  pause: number;
  speed: number;
}

/** Crabs scuttling sideways along the wet sand, pausing now and then. Uses the shore distance field. */
export function Crabs({ count, animDistance = 1e9 }: { count: number; animDistance?: number }) {
  const world = useWorld();
  const map = world.map;
  const crabs = useMemo<Crab[]>(() => {
    const sd = map.shoreDistance;
    if (!sd || count === 0) return [];
    const out: Crab[] = [];
    let tries = 0;
    while (out.length < count && tries++ < 4000) {
      const x = 2 + Math.random() * (map.width - 4);
      const z = 2 + Math.random() * (map.height - 4);
      const d = sd(x, z);
      if (d < 0.8 || d > 4 || world.grid.blockedCircle(x, z, 0.3)) continue;
      const obj = buildCrab(out.length % 3 ? '#E0563F' : '#F08A3C');
      obj.scale.setScalar(1.3);
      out.push({ obj, legs: obj.getObjectByName('legs') ?? null, x, z, dir: Math.random() > 0.5 ? 1 : -1, pause: Math.random() * 3, speed: 0.5 + Math.random() * 0.5 });
    }
    return out;
  }, [count, map, world]);
  const root = useMemo(() => {
    const g = new Group();
    crabs.forEach((c) => g.add(c.obj));
    return g;
  }, [crabs]);
  useEffect(() => () => crabs.forEach((c) => disposeObject(c.obj)), [crabs]);
  useFrame((_, rawDt) => {
    const sd = map.shoreDistance;
    if (!sd) return;
    const dt = Math.min(rawDt, 0.05);
    const t = G.uTime.value;
    const P = world.player.pos;
    for (const c of crabs) {
      // far crabs are out of view: skip their simulation
      if (Math.abs(P.x - c.x) + Math.abs(P.z - c.z) > animDistance) continue;
      const e = 0.4;
      const gx = (sd(c.x + e, c.z) - sd(c.x - e, c.z)) / (2 * e);
      const gz = (sd(c.x, c.z + e) - sd(c.x, c.z - e)) / (2 * e);
      const gl = Math.hypot(gx, gz) || 1;
      const nx = gx / gl;
      const nz = gz / gl;
      // scurry away from the player
      const near = Math.hypot(P.x - c.x, P.z - c.z) < 2.5;
      let moving = false;
      if (near) c.pause = 0;
      if (c.pause > 0) c.pause -= dt;
      else {
        moving = true;
        const sp = c.speed * (near ? 2.5 : 1);
        const d = sd(c.x, c.z);
        const keep = (2.2 - d) * 0.4; // stay on the wet band
        const nxp = c.x + (-nz * c.dir * sp + nx * keep) * dt;
        const nzp = c.z + (nx * c.dir * sp + nz * keep) * dt;
        if (!world.grid.blockedCircle(nxp, nzp, 0.15) && nxp > 1 && nzp > 1 && nxp < map.width - 1 && nzp < map.height - 1) {
          c.x = nxp;
          c.z = nzp;
        } else c.dir *= -1;
        if (Math.random() < dt * 0.25) {
          c.pause = 1 + Math.random() * 3;
          if (Math.random() < 0.4) c.dir *= -1;
        }
      }
      c.obj.position.set(c.x, map.groundHeight(c.x, c.z), c.z);
      // the body faces the sea and walks sideways
      c.obj.rotation.y = Math.atan2(-nx, -nz);
      if (c.legs) c.legs.rotation.x = moving ? Math.sin(t * 22 + c.x) * 0.25 : 0;
      c.obj.position.y += moving ? Math.abs(Math.sin(t * 22 + c.z)) * 0.015 : 0;
    }
  });
  return <primitive object={root} dispose={null} />;
}

/** Sand grains / petals / leaves drifting in the wind around the camera focus. */
export function Drift({ kind, count }: { kind: 'sand' | 'petals' | 'leaves'; count: number }) {
  const world = useWorld();
  const mesh = useMemo(() => {
    const size = kind === 'sand' ? 0.025 : 0.07;
    const geo = new PlaneGeometry(size, size * (kind === 'sand' ? 1 : 0.6));
    const colors = kind === 'sand' ? [PAL.offWhite, PAL.sandBand] : kind === 'petals' ? [PAL.pink, PAL.offWhite] : ['#7BA253', '#C8B45E'];
    const m = new InstancedMesh(geo, toon({ unlit: true, double: true, emissive: 1.0 }), count);
    const c = new Color();
    for (let i = 0; i < count; i++) m.setColorAt(i, c.set(colors[i % 2]));
    m.frustumCulled = false;
    return m;
  }, [kind, count]);
  const parts = useMemo(() => Array.from({ length: count }, () => ({ p: new Vector3((Math.random() - 0.5) * 30, Math.random() * 2.5, (Math.random() - 0.5) * 30), s: Math.random() * 10 })), [count]);
  useEffect(() => () => mesh.geometry.dispose(), [mesh]);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const t = G.uTime.value;
    const f = world.camera.focus;
    const wind = G.uWind.value;
    for (let i = 0; i < parts.length; i++) {
      const q = parts[i];
      q.p.x += wind.x * wind.y * dt * 4 + Math.sin(t + q.s) * dt * 0.3;
      q.p.z += wind.z * wind.y * dt * 4 + Math.cos(t * 0.8 + q.s) * dt * 0.3;
      q.p.y += Math.sin(t * 1.3 + q.s) * dt * 0.25 - dt * 0.05;
      if (q.p.y < 0.05) q.p.y = 2.5;
      // wrap inside a box around the focus
      if (q.p.x > 15) q.p.x -= 30;
      if (q.p.x < -15) q.p.x += 30;
      if (q.p.z > 15) q.p.z -= 30;
      if (q.p.z < -15) q.p.z += 30;
      dummy.position.set(f.x + q.p.x, f.y + q.p.y, f.z + q.p.z);
      dummy.rotation.set(t * 2 + q.s, t * 1.4 + q.s, q.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
  return <primitive object={mesh} dispose={null} />;
}

/** Soft smoke puffs from the campfire, carried by the wind. */
export function Smoke({ at }: { at: { x: number; z: number } }) {
  const world = useWorld();
  const n = 14;
  const mesh = useMemo(() => {
    const m = new InstancedMesh(new IcosahedronGeometry(1, 1), toon({ color: '#EDE7DF', transparent: true, opacity: 0.55, grain: 0 }), n);
    m.castShadow = false;
    m.frustumCulled = false;
    return m;
  }, []);
  const puffs = useMemo(() => Array.from({ length: n }, (_, i) => ({ age: (i / n) * 4, life: 4 })), []);
  useEffect(() => () => mesh.geometry.dispose(), [mesh]);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const y0 = world.map.groundHeight(at.x, at.z);
    const w = G.uWind.value;
    puffs.forEach((p, i) => {
      p.age += dt;
      if (p.age > p.life) p.age -= p.life;
      const k = p.age / p.life;
      dummy.position.set(at.x + w.x * w.y * k * 3 + Math.sin(k * 6 + i) * 0.1, y0 + 0.8 + k * 3.2, at.z + w.z * w.y * k * 3);
      const s = 0.12 + k * 0.45;
      dummy.scale.set(s, s * 0.85, s);
      dummy.rotation.set(0, i, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, k > 0.92 ? new Object3D().matrix.makeScale(0, 0, 0) : dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return <primitive object={mesh} dispose={null} />;
}

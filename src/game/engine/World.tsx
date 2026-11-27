import { Suspense, lazy, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { WorldContext, WorldRuntime, useWorld } from './runtime';
import { InputController } from './input';
import { FxEmitter } from './fx';
import { Player } from './Player';
import { CameraRig } from './CameraRig';
import { Props } from './Props';
import { Sun } from './Sun';
import { WorldClock, Gulls, Crabs, Drift, Smoke } from './Ambient';
import { Hotspots } from './Hotspots';
import { PostFX } from './PostFX';
import { deckAt, standHeight } from '../maps/deck';
import { useGameStore } from '../../store/useGameStore';
import { RemotePlayers } from './Remote';
import { AmbientAudio } from '../systems/AmbientAudio';
import { G } from '../materials/globals';
import { QUALITY, type Quality } from '../config';
import { gameBridge } from '../../store/bridge';
import type { GameMap } from '../maps/types';

function Fx() {
  const world = useWorld();
  useFrame((_, dt) => world.fx?.update(Math.min(dt, 0.05)));
  return world.fx ? <primitive object={world.fx.root} dispose={null} /> : null;
}

/** Synthesised ambience driven by where the player is: surf near the shore, crackle near the fire. */
function Audio() {
  const world = useWorld();
  const audio = useMemo(() => new AmbientAudio(gameBridge.isMuted()), []);
  useEffect(() => {
    audio.start();
    const off = gameBridge.onMuteChange((m) => audio.setMuted(m));
    return () => {
      off();
      audio.destroy();
    };
  }, [audio]);
  useFrame(() => {
    const P = world.player.pos;
    const d = world.map.shoreDistance?.(P.x, P.z);
    audio.setWater(d === undefined ? 0.15 : Math.max(0.05, 1 - Math.abs(d) / 30));
    audio.setWind(G.uWind.value.y);
    const f = world.map.ambient.fire;
    audio.setFire(f ? Math.max(0, 1 - Math.hypot(f.x - P.x, f.z - P.z) / 14) : 0);
    audio.update(performance.now());
  });
  return null;
}

const frameTotals = { calls: 0, triangles: 0 };
// F3 overlay: dev builds only, loaded on demand
const DebugOverlay = import.meta.env.DEV ? lazy(() => import('./DebugOverlay').then((m) => ({ default: m.DebugOverlay }))) : null;

/** The whole 3D world for one map. Everything below shares one WorldRuntime through context. */
export function World({ map, quality }: { map: GameMap; quality: Quality }) {
  const gl = useThree((s) => s.gl);
  const q = QUALITY[quality];
  const debug = useGameStore((s) => s.ui.debug);
  const runtime = useMemo(() => {
    const r = new WorldRuntime(map);
    r.fx = new FxEmitter();
    return r;
  }, [map]);
  const sunTarget = useMemo(() => ({ current: runtime.camera.focus }), [runtime]);

  useEffect(() => {
    const input = new InputController(gl.domElement);
    runtime.input = input;
    return () => {
      input.dispose();
      runtime.input = null;
    };
  }, [gl, runtime]);
  // GPU resources of the pools are freed on unmount; the objects stay valid (StrictMode remounts re-upload)
  useEffect(() => () => runtime.fx?.dispose(), [runtime]);

  useEffect(() => {
    G.uGrain.value = q.grain;
    G.uSparkle.value = q.sparkles;
  }, [q]);

  // per-frame totals across every pass (scene, shadow map, post), for the perf hook
  useEffect(() => {
    if (!(import.meta.env.DEV || import.meta.env.VITE_PERF_HOOKS)) return;
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);
  useFrame(() => {
    if (!(import.meta.env.DEV || import.meta.env.VITE_PERF_HOOKS) || gl.info.autoReset) return;
    frameTotals.calls = gl.info.render.calls;
    frameTotals.triangles = gl.info.render.triangles;
    gl.info.reset();
  }, -1);

  // test hook for scripts/pier-check.mjs and scripts/perf.mjs: dev builds, or a VITE_PERF_HOOKS=1 build only
  useEffect(() => {
    if (!(import.meta.env.DEV || import.meta.env.VITE_PERF_HOOKS)) return;
    const api = {
      renderInfo: () => ({ ...frameTotals, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, programs: gl.info.programs?.length ?? 0 }),
      teleport: (x: number, z: number, facing: number) => {
        runtime.player.pos.set(x, standHeight(runtime.map, x, z), z);
        runtime.player.vel.set(0, 0, 0);
        runtime.player.facing = facing;
        runtime.camera.focus.copy(runtime.player.pos);
      },
      setYaw: (deg: number) => {
        runtime.camera.yawTarget = (deg * Math.PI) / 180;
        runtime.camera.yaw = runtime.camera.yawTarget;
      },
      pier: () => runtime.map.props.filter((p) => p.type === 'pier').map((p) => ({ x: p.x, z: p.z, rot: p.rot })),
      state: () => ({ x: runtime.player.pos.x, z: runtime.player.pos.z, y: runtime.player.pos.y, onDeck: !!deckAt(runtime.map, runtime.player.pos.x, runtime.player.pos.z) }),
    };
    (window as unknown as { __game?: typeof api }).__game = api;
    return () => {
      delete (window as unknown as { __game?: typeof api }).__game;
    };
  }, [runtime, gl]);

  return (
    <WorldContext.Provider value={runtime}>
      <color attach="background" args={[map.background]} />
      <WorldClock />
      <map.Ground />
      <Props map={map} density={q.propDensity} />
      <Player />
      <CameraRig />
      <Sun target={sunTarget} extent={q.shadowExtent} mapSize={q.shadowMapSize} />
      <Fx />
      <Hotspots />
      <Gulls count={Math.round(map.ambient.gulls * (quality === 'low' ? 0.5 : 1))} />
      <Crabs count={map.ambient.crabs} />
      <Drift kind={map.ambient.drift} count={quality === 'low' ? 30 : 90} />
      {map.ambient.fire && <Smoke at={map.ambient.fire} />}
      <RemotePlayers />
      <Audio />
      {DebugOverlay && debug && (
        <Suspense fallback={null}>
          <DebugOverlay />
        </Suspense>
      )}
      <PostFX q={q} />
    </WorldContext.Provider>
  );
}

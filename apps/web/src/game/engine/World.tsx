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
import { Governor } from '../perf/Governor';
import { frameStats } from '../perf/stats';
import { FrameDriver } from '../perf/FrameDriver';
import { gameStore } from '../../store/gameStore';
import { deckAt } from '@shoreline/shared';
import { useGameStore } from '../../store/useGameStore';
import { RemotePlayers } from './Remote';
import { Nameplates } from './Nameplates';
import { remotes } from '../net/entities';
import { session } from '../net/session';
import { AmbientAudio } from '../systems/AmbientAudio';
import { useReleaseGpuOnUnmount } from '../util/releaseGpu';
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

// F3 overlay: dev builds only, loaded on demand
const DebugOverlay = import.meta.env.DEV ? lazy(() => import('./DebugOverlay').then((m) => ({ default: m.DebugOverlay }))) : null;

/** The whole 3D world for one map. Everything below shares one WorldRuntime through context. */
export function World({ map, quality }: { map: GameMap; quality: Quality }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  // World is the Canvas's only child: frees GPU objects of cached materials/textures when leaving (leak fix)
  useReleaseGpuOnUnmount();
  const q = QUALITY[quality];
  const debug = useGameStore((s) => s.ui.debug);
  const runtime = useMemo(() => {
    const r = new WorldRuntime(map);
    r.fx = new FxEmitter(QUALITY[gameStore.getState().ui.quality].particles);
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
    G.uGradeBaked.value = q.gradeInShader ? 1 : 0;
    G.uCloud.value.z = q.cloudShadows ? 0.32 : 0;
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
    frameStats.calls = gl.info.render.calls;
    frameStats.triangles = gl.info.render.triangles;
    frameStats.geometries = gl.info.memory.geometries;
    frameStats.textures = gl.info.memory.textures;
    frameStats.programs = gl.info.programs?.length ?? 0;
    // renderer.render() calls since the last frame (scene + shadow + post passes count separately)
    frameStats.renders = gl.info.render.frame - frameStats.lastFrame;
    frameStats.lastFrame = gl.info.render.frame;
    gl.info.reset();
  }, -1);

  // test hook for scripts/pier-check.mjs and scripts/perf.mjs: dev builds, or a VITE_PERF_HOOKS=1 build only
  useEffect(() => {
    if (!(import.meta.env.DEV || import.meta.env.VITE_PERF_HOOKS)) return;
    const api = {
      renderInfo: () => ({ ...frameStats }),
      /** visible meshes per top-level scene child (tests) */
      census: () => {
        const out: Record<string, number> = { shadowCasters: 0 };
        for (const c of scene.children) {
          let n = 0;
          c.traverseVisible((o) => {
            if ((o as { isMesh?: boolean }).isMesh) {
              n++;
              if (o.castShadow) out.shadowCasters++;
            }
          });
          const k = `${c.type}:${c.name || '-'}`;
          out[k] = (out[k] ?? 0) + n;
        }
        out.shadowMapEnabled = gl.shadowMap.enabled ? 1 : 0;
        return out;
      },
      teleport: (x: number, z: number, facing: number) => runtime.teleport?.(x, z, facing),
      /** remote players as this client renders them (interpolated) */
      remotes: () => [...remotes.entities.values()].map((e) => ({ id: e.id, ready: e.render.ready, x: e.render.x, z: e.render.z, y: e.render.y, speed: Math.hypot(e.render.vx, e.render.vz), anim: e.render.anim })),
      net: () => ({ authoritative: !!session.adapter.authoritative, status: session.ws?.status ?? 'offline', selfId: remotes.selfId, rtt: session.ws?.rtt ?? 0, delay: remotes.delay, jitter: remotes.jitter, netError: runtime.netError, bytesIn: session.ws?.bytesIn ?? 0, bytesOut: session.ws?.bytesOut ?? 0 }),
      self: () => ({ x: runtime.player.pos.x, z: runtime.player.pos.z, y: runtime.player.pos.y, facing: runtime.player.facing }),
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
  }, [runtime, gl, scene]);

  return (
    <WorldContext.Provider value={runtime}>
      <color attach="background" args={[map.background]} />
      <WorldClock />
      <map.Ground />
      <Props map={map} q={q} />
      <Player />
      <CameraRig />
      <Governor />
      <FrameDriver />
      <Sun target={sunTarget} extent={q.shadowExtent} mapSize={q.shadowMapSize} />
      <Fx />
      <Hotspots />
      {q.gulls > 0 && <Gulls count={Math.min(map.ambient.gulls, q.gulls)} />}
      {q.crabs > 0 && <Crabs count={Math.min(map.ambient.crabs, q.crabs)} animDistance={q.animDistance} />}
      {q.drift > 0 && <Drift kind={map.ambient.drift} count={q.drift} />}
      {map.ambient.fire && q.smoke && <Smoke at={map.ambient.fire} />}
      <RemotePlayers />
      <Nameplates />
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

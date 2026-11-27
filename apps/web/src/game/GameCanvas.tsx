import { useEffect, useState } from 'react';
import { Brand } from '../ui/Brand';
import { Canvas } from '@react-three/fiber';
import { PCFShadowMap } from 'three';
import { World } from './engine/World';
import { loadMap } from './maps/registry';
import { QUALITY } from './config';
import { detectTier } from './perf/detect';
import { gameStore } from '../store/gameStore';
import { useGameStore } from '../store/useGameStore';
import { LoadingScreen } from '../ui/LoadingScreen';
import type { GameMap } from './maps/types';
import { devLog } from '../util/devlog';
import { session } from './net/session';
import { voice } from '../voice/voice';

/**
 * Hosts the R3F canvas. On entry: picks the starting tier in 'auto' mode (hardware hints + a ~1 s benchmark,
 * cached per device), joins the room when playing online (falls back to offline if the server is
 * unreachable), then builds the map, all behind the loading screen. Remounts the world when the map changes;
 * R3F disposes the renderer on unmount and every world component frees its own GPU resources.
 * DPR is owned by the governor (it starts at the tier maximum); antialiasing comes from the post pass,
 * so the default framebuffer is created without MSAA.
 */
export function GameCanvas() {
  const quality = useGameStore((s) => s.ui.quality);
  const mode = useGameStore((s) => s.ui.qualityMode);
  const [stage, setStage] = useState<{ label: string; progress: number; map: GameMap | null; error?: string }>({ label: 'Checking your device…', progress: 0.25, map: null });
  const [attempt, setAttempt] = useState(0);

  // once per world entry (and per retry): tier -> connect -> map. Leaving the world closes the session.
  useEffect(() => {
    let alive = true;
    const run = async () => {
      // one task later: React StrictMode's synchronous mount -> cleanup -> mount must start ONE session
      await new Promise((res) => setTimeout(res, 0));
      if (!alive) return;
      const st = gameStore.getState();
      if (st.ui.qualityMode === 'auto') {
        const r = await detectTier();
        if (!alive) return;
        devLog(`[quality] auto -> ${r.tier} (${r.reason}; gpu "${r.gpu}")`);
        gameStore.getState().setUi({ quality: r.tier });
      } else gameStore.getState().setUi({ quality: st.ui.qualityMode });
      let mapId = st.mapId;
      if (st.online) {
        setStage((s) => ({ ...s, label: `Joining room "${st.roomId}"…`, progress: 0.45 }));
        try {
          const r = await session.start({ online: true, room: st.roomId, map: st.mapId });
          if (!alive) return;
          // a room keeps the map it was created with
          if (r.map !== mapId) {
            mapId = r.map;
            gameStore.getState().setMap(r.map);
          }
        } catch (e) {
          if (alive) setStage((s) => ({ ...s, error: (e as Error).message }));
          return;
        }
      } else await session.start({ online: false, room: st.roomId, map: st.mapId });
      if (!alive) return;
      setStage((s) => ({ ...s, label: 'Building the world…', progress: 0.7 }));
      // let the progress bar paint before the (synchronous) map build
      await new Promise((res) => setTimeout(res, 30));
      const map = await loadMap(mapId);
      if (alive) setStage({ label: 'Almost there…', progress: 0.9, map });
    };
    void run();
    return () => {
      alive = false;
      voice.leave();
      session.stop();
    };
  }, [attempt]);

  // switching back to 'auto' in the settings re-detects (cached) the tier
  useEffect(() => {
    if (mode !== 'auto' || !stage.map) return;
    void detectTier().then((r) => gameStore.getState().setUi({ quality: r.tier }));
  }, [mode, stage.map]);

  if (stage.error)
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[#2E4A35] p-4 text-white">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center" role="alert">
          <Brand size={36} tone="light" />
          <div className="text-lg font-bold">Could not join</div>
          <p className="text-white/85">{stage.error}</p>
          <div className="flex gap-2">
            <button className="rounded-xl bg-white/90 px-4 py-2 font-bold text-pine" onClick={() => gameStore.getState().leaveWorld()}>
              Back
            </button>
            <button
              className="rounded-xl bg-white/20 px-4 py-2 font-bold"
              onClick={() => {
                gameStore.getState().setOnline(false);
                setStage({ label: 'Loading…', progress: 0.3, map: null });
                setAttempt((n) => n + 1);
              }}
            >
              Play offline
            </button>
          </div>
        </div>
      </div>
    );
  if (!stage.map) return <LoadingScreen stage={stage.label} progress={stage.progress} />;
  return (
    <div className="absolute inset-0 touch-none select-none">
      <Canvas
        key={stage.map.id}
        flat
        shadows={{ type: PCFShadowMap }}
        dpr={Math.min(QUALITY[quality].dpr[1], window.devicePixelRatio || 1)}
        gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
        camera={{ fov: 38, near: 0.5, far: 500, position: [0, 20, 20] }}
      >
        <World map={stage.map} quality={quality} />
      </Canvas>
    </div>
  );
}

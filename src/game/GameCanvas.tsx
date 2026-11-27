import { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { PCFShadowMap } from 'three';
import { World } from './engine/World';
import { getMap } from './maps/registry';
import { QUALITY } from './config';
import { detectTier } from './perf/detect';
import { gameStore } from '../store/gameStore';
import { useGameStore } from '../store/useGameStore';
import { devLog } from '../util/devlog';

/**
 * Hosts the R3F canvas. On first entry in 'auto' mode, picks the starting tier (hardware hints + a ~1 s
 * benchmark, cached per device) while the loading screen shows. Remounts the world when the map changes;
 * R3F disposes the renderer on unmount and every world component frees its own GPU resources.
 * DPR is owned by the governor (it starts at the tier maximum); antialiasing comes from the post pass,
 * so the default framebuffer is created without MSAA.
 */
export function GameCanvas() {
  const mapId = useGameStore((s) => s.mapId);
  const quality = useGameStore((s) => s.ui.quality);
  const mode = useGameStore((s) => s.ui.qualityMode);
  const [ready, setReady] = useState(mode !== 'auto');
  const map = useMemo(() => getMap(mapId), [mapId]);

  useEffect(() => {
    if (mode !== 'auto') {
      gameStore.getState().setUi({ quality: mode });
      setReady(true);
      return;
    }
    let alive = true;
    void detectTier().then((r) => {
      if (!alive) return;
      devLog(`[quality] auto -> ${r.tier} (${r.reason}; gpu "${r.gpu}")`);
      gameStore.getState().setUi({ quality: r.tier });
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [mode]);

  if (!ready)
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[#2E4A35] text-lg font-bold text-white">
        <div className="flex flex-col items-center gap-3">
          <div>Getting the beach ready…</div>
          <div className="h-1.5 w-48 overflow-hidden rounded-full bg-white/20">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-white/80" />
          </div>
        </div>
      </div>
    );
  return (
    <div className="absolute inset-0 touch-none select-none">
      <Canvas
        key={mapId}
        flat
        shadows={{ type: PCFShadowMap }}
        dpr={Math.min(QUALITY[quality].dpr[1], window.devicePixelRatio || 1)}
        gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
        camera={{ fov: 38, near: 0.5, far: 500, position: [0, 20, 20] }}
      >
        <World map={map} quality={quality} />
      </Canvas>
    </div>
  );
}

import { useEffect, useState } from 'react';
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
  const [stage, setStage] = useState<{ label: string; progress: number; map: GameMap | null }>({ label: 'Checking your device…', progress: 0.35, map: null });

  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (mode === 'auto') {
        const r = await detectTier();
        if (!alive) return;
        devLog(`[quality] auto -> ${r.tier} (${r.reason}; gpu "${r.gpu}")`);
        gameStore.getState().setUi({ quality: r.tier });
      } else gameStore.getState().setUi({ quality: mode });
      setStage((s) => ({ ...s, label: 'Building the beach…', progress: 0.65 }));
      // let the progress bar paint before the (synchronous) map build
      await new Promise((res) => setTimeout(res, 30));
      const map = await loadMap(mapId);
      if (alive) setStage({ label: 'Almost there…', progress: 0.9, map });
    };
    void run();
    return () => {
      alive = false;
    };
  }, [mode, mapId]);

  if (!stage.map) return <LoadingScreen stage={stage.label} progress={stage.progress} />;
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
        <World map={stage.map} quality={quality} />
      </Canvas>
    </div>
  );
}

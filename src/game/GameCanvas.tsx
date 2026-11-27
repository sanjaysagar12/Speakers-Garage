import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { PCFShadowMap } from 'three';
import { World } from './engine/World';
import { getMap } from './maps/registry';
import { QUALITY } from './config';
import { useGameStore } from '../store/useGameStore';

/**
 * Hosts the R3F canvas. Remounts the world when the map changes; R3F disposes the renderer on unmount and
 * every world component frees its own GPU resources (shared toon materials are a small bounded cache).
 */
export function GameCanvas() {
  const mapId = useGameStore((s) => s.mapId);
  const quality = useGameStore((s) => s.ui.quality);
  const map = useMemo(() => getMap(mapId), [mapId]);
  const q = QUALITY[quality];
  return (
    <div className="absolute inset-0 touch-none select-none">
      <Canvas
        key={mapId}
        flat
        shadows={{ type: PCFShadowMap }}
        dpr={q.dpr}
        gl={{ antialias: !q.post, powerPreference: 'high-performance', stencil: false }}
        camera={{ fov: 38, near: 0.5, far: 500, position: [0, 20, 20] }}
      >
        <World map={map} quality={quality} />
      </Canvas>
    </div>
  );
}

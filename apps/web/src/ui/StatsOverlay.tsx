import { useEffect, useState } from 'react';
import { frameStats } from '../game/perf/stats';
import { governorStats } from '../game/perf/Governor';

/** F2 (dev builds only): FPS, DPR, tier, draw calls, triangles, GPU memory objects, JS heap. */
export function StatsOverlay() {
  const [on, setOn] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        setOn((v) => !v);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(t);
  }, [on]);
  if (!on) return null;
  const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-30 rounded-lg bg-black/75 px-3 py-2 font-mono text-[11px] leading-4 text-[#9ff0a8]">
      <div>
        {governorStats.fps} fps · dpr {governorStats.dpr} · {governorStats.tier}
      </div>
      <div>
        {frameStats.calls} calls · {(frameStats.triangles / 1000).toFixed(0)}k tris
      </div>
      <div>
        {frameStats.geometries} geo · {frameStats.textures} tex · {frameStats.programs} prog
      </div>
      {heap !== undefined && <div>heap {(heap / 1048576).toFixed(0)} MB</div>}
    </div>
  );
}

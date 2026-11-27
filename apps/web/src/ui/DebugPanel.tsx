import { useEffect, useState } from 'react';
import { debugStats } from '../game/engine/runtime';

/** F3 text panel: position, ground height, deck/terrain, camera yaw, movement vector. */
export function DebugPanel() {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 200);
    return () => window.clearInterval(t);
  }, []);
  const s = debugStats;
  return (
    <div className="pointer-events-none absolute left-3 top-20 z-20 w-60 rounded-xl bg-black/70 p-3 font-mono text-[11px] leading-5 text-white shadow-xl">
      <div className="mb-1 font-bold text-[#ffd60a]">DEBUG (F3)</div>
      <div>pos {s.x.toFixed(2)}, {s.z.toFixed(2)}</div>
      <div>feet y {s.y.toFixed(2)} · ground {s.ground.toFixed(2)}</div>
      <div>surface {s.deck ? 'DECK' : s.terrain}</div>
      <div>camera yaw {s.yawDeg.toFixed(0)}°</div>
      <div>move ({s.moveX.toFixed(2)}, {s.moveZ.toFixed(2)}) · {s.speed.toFixed(2)} m/s {s.blocked ? '· BLOCKED' : ''}</div>
      <div className="mt-1 opacity-75">red blocked · orange deck guard band · green deck · blue ground · yellow collider + move</div>
    </div>
  );
}

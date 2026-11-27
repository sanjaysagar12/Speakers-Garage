import { memo, useEffect, useRef } from 'react';
import { gameStore } from '../store/gameStore';
import { useGameStore } from '../store/useGameStore';
import { getMap } from '../game/maps/registry';
import type { GameMap } from '../game/maps/types';

const SIZE = 180;
/** metres shown across the minimap */
const SPAN = 70;
const PPM = 2;

const rasters = new Map<string, HTMLCanvasElement>();

/** Pre-render a whole map once at 2 px/m from the map's own data (terrain + prop dots). */
function raster(map: GameMap): HTMLCanvasElement {
  const hit = rasters.get(map.id);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = Math.ceil(map.width * PPM);
  c.height = Math.ceil(map.height * PPM);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(c.width, c.height);
  for (let j = 0; j < c.height; j++) {
    for (let i = 0; i < c.width; i++) {
      const [r, g, b] = map.minimapColor((i + 0.5) / PPM, (j + 0.5) / PPM);
      const k = (j * c.width + i) * 4;
      img.data[k] = r;
      img.data[k + 1] = g;
      img.data[k + 2] = b;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const dot: Record<string, [string, number]> = {
    palm: ['#3C8444', 2.4],
    conifer: ['#2E4A35', 2.2],
    broadleaf: ['#4F7A42', 2.4],
    bush: ['#4E9F5A', 1.4],
    umbrella: ['#EC847C', 2.2],
    beachbar: ['#B98A3E', 7],
    lifeguard: ['#EC847C', 2.5],
    lighthouse: ['#E2574C', 3.5],
    hut: ['#8A6440', 6],
    cliff: ['#8E8072', 5],
  };
  for (const p of map.props) {
    const d = dot[p.type];
    if (!d) continue;
    ctx.fillStyle = d[0];
    ctx.beginPath();
    ctx.arc(p.x * PPM, p.z * PPM, d[1], 0, Math.PI * 2);
    ctx.fill();
  }
  rasters.set(map.id, c);
  return c;
}

/** Circular, player-centred minimap that rotates with the camera so "up" is always where the camera looks. */
export const Minimap = memo(function Minimap() {
  const ref = useRef<HTMLCanvasElement>(null);
  const mapId = useGameStore((s) => s.mapId);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const map = getMap(mapId);
    const base = raster(map);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    const draw = () => {
      raf = 0;
      const { x, y, yaw, facing } = gameStore.getState().position;
      const W = canvas.width;
      const s = W / SPAN; // canvas px per metre
      ctx.save();
      ctx.clearRect(0, 0, W, W);
      ctx.beginPath();
      ctx.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = map.background;
      ctx.fillRect(0, 0, W, W);
      ctx.translate(W / 2, W / 2);
      // camera yaw 0 looks north (-z = up); rotating the world by +yaw keeps the view direction up
      ctx.rotate(yaw);
      ctx.scale(s, s);
      ctx.translate(-x, -y);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(base, 0, 0, base.width / PPM, base.height / PPM);
      for (const poi of map.interactions) {
        ctx.beginPath();
        ctx.arc(poi.x, poi.y, 1.4, 0, Math.PI * 2);
        ctx.fillStyle = '#FFD66B';
        ctx.fill();
        ctx.lineWidth = 0.5;
        ctx.strokeStyle = '#4A3A2C';
        ctx.stroke();
      }
      ctx.restore();
      // player arrow at the centre, pointing where the body faces relative to the camera
      ctx.save();
      ctx.translate(W / 2, W / 2);
      ctx.rotate(Math.PI - facing + yaw);
      ctx.beginPath();
      ctx.moveTo(0, -7 * dpr);
      ctx.lineTo(5 * dpr, 6 * dpr);
      ctx.lineTo(0, 3 * dpr);
      ctx.lineTo(-5 * dpr, 6 * dpr);
      ctx.closePath();
      ctx.fillStyle = '#E2574C';
      ctx.fill();
      ctx.lineWidth = 1.6 * dpr;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.restore();
      // north marker on the rim
      ctx.save();
      ctx.translate(W / 2, W / 2);
      ctx.rotate(yaw);
      ctx.fillStyle = '#144454';
      ctx.font = `bold ${11 * dpr}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText('N', 0, -W / 2 + 13 * dpr);
      ctx.restore();
    };
    draw();
    // redraw only when the position/yaw actually changed (not on every store update)
    const unsub = gameStore.subscribe((s, prev) => {
      if (s.position !== prev.position && !raf) raf = requestAnimationFrame(draw);
    });
    return () => {
      unsub();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [mapId]);
  return <canvas ref={ref} aria-label="Minimap" className="block rounded-full" style={{ width: SIZE, height: SIZE }} />;
});

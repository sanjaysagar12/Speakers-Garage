import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { Group, Mesh, Shape, ExtrudeGeometry } from 'three';
import { toon } from '../materials/toon';
import { G } from '../materials/globals';
import { useWorld } from './runtime';
import { gameBridge } from '../../store/bridge';
import type { InteractionDef } from '../../types';

/** A chunky 4-point star (the ✦ the HUD talks about), extruded so it reads in 3D from every yaw. */
function starGeometry(): ExtrudeGeometry {
  const s = new Shape();
  const pts = 8;
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? 0.3 : 0.08;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  const g = new ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 });
  g.translate(0, 0, -0.025);
  return g;
}

export function Hotspots() {
  const world = useWorld();
  const map = world.map;
  const [bubble, setBubble] = useState<{ def: InteractionDef; until: number } | null>(null);
  const nearest = useRef<InteractionDef | null>(null);
  const markers = useMemo(() => {
    const geo = starGeometry();
    const mat = toon({ unlit: true, emissive: 1.5, color: '#FFD66B' });
    const root = new Group();
    const items = map.interactions.map((def) => {
      const m = new Mesh(geo, mat);
      m.position.set(def.x, map.groundHeight(def.x, def.y) + 2.4, def.y);
      root.add(m);
      return { def, m };
    });
    return { root, items, geo };
  }, [map]);
  useEffect(() => () => markers.geo.dispose(), [markers]);

  useEffect(() => {
    const trigger = (id: string | null) => {
      const def = id ? map.interactions.find((i) => i.id === id) : nearest.current;
      if (!def) return;
      const a = def.action;
      if (a.type === 'link') gameBridge.openDialog({ title: def.title, text: def.text, icon: def.icon, link: a.url });
      else if (a.type === 'call') gameBridge.openDialog({ title: def.title, text: `${def.text}\n\n(Voice rooms arrive with multiplayer: room "${a.room}".)`, icon: def.icon });
      else if (def.kind === 'modal' || a.type === 'modal') gameBridge.openDialog({ title: def.title, text: def.text, icon: def.icon });
      else setBubble({ def, until: performance.now() + 7000 });
    };
    world.triggerInteraction = trigger;
    const off = gameBridge.onInteract(() => trigger(null));
    return () => {
      off();
      world.triggerInteraction = null;
      gameBridge.setNearby(null);
    };
  }, [map, world]);

  useFrame(() => {
    const t = G.uTime.value;
    const P = world.player.pos;
    let best: InteractionDef | null = null;
    let bd = Infinity;
    for (const { def, m } of markers.items) {
      const d = Math.hypot(def.x - P.x, def.y - P.z);
      if (d < def.radius && d < bd) {
        bd = d;
        best = def;
      }
      const near = d < def.radius;
      m.rotation.y = t * (near ? 2.2 : 0.8);
      m.position.y = map.groundHeight(def.x, def.y) + 2.4 + Math.sin(t * 2 + def.x) * 0.12;
      m.scale.setScalar(near ? 1.3 : 1);
    }
    if (best !== nearest.current) {
      nearest.current = best;
      gameBridge.setNearby(best ? { id: best.id, title: best.title } : null);
    }
    if (bubble && (performance.now() > bubble.until || Math.hypot(bubble.def.x - P.x, bubble.def.y - P.z) > bubble.def.radius + 4)) setBubble(null);
  });

  return (
    <>
      <primitive object={markers.root} dispose={null} />
      {bubble && (
        <Html position={[bubble.def.x, map.groundHeight(bubble.def.x, bubble.def.y) + 3.1, bubble.def.y]} center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
          <div className="speech-bubble">
            <div className="font-extrabold text-[#11738A]">{bubble.def.title}</div>
            <div>{bubble.def.text}</div>
          </div>
        </Html>
      )}
    </>
  );
}

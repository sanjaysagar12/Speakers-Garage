import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { ArrowHelper, BoxGeometry, BufferGeometry, Color, Float32BufferAttribute, InstancedMesh, LineBasicMaterial, LineLoop, MeshBasicMaterial, Object3D, Vector3 } from 'three';
import { GAME_CONFIG } from '../config';
import { deckAt, standHeight } from '@speakersgarage/shared';
import { useWorld } from './runtime';

const R = 7;
const dummy = new Object3D();
const RED = new Color('#ff3b30');
const GREEN = new Color('#30d158');
const BLUE = new Color('#0a84ff');
const ORANGE = new Color('#ff9f0a');

/**
 * F3 overlay in the world: collision cells around the player (red = blocked, green = walkable deck,
 * blue = other walkable ground), the player's circle collider at its feet, and the movement vector.
 */
export function DebugOverlay() {
  const world = useWorld();
  const built = useMemo(() => {
    const cell = world.grid.cell;
    const n = Math.ceil((2 * R) / cell) ** 2;
    const cells = new InstancedMesh(new BoxGeometry(cell * 0.86, 0.02, cell * 0.86), new MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false, depthTest: false, toneMapped: false }), n);
    cells.frustumCulled = false;
    cells.renderOrder = 10;
    for (let i = 0; i < n; i++) cells.setColorAt(i, RED);
    const pts: number[] = [];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      pts.push(Math.cos(a) * GAME_CONFIG.player.radius, 0, Math.sin(a) * GAME_CONFIG.player.radius);
    }
    const ringGeo = new BufferGeometry();
    ringGeo.setAttribute('position', new Float32BufferAttribute(pts, 3));
    const ring = new LineLoop(ringGeo, new LineBasicMaterial({ color: '#ffd60a', depthTest: false, toneMapped: false }));
    ring.renderOrder = 11;
    const arrow = new ArrowHelper(new Vector3(1, 0, 0), new Vector3(), 1.5, 0xffd60a, 0.35, 0.2);
    arrow.renderOrder = 11;
    (arrow.line.material as LineBasicMaterial).depthTest = false;
    (arrow.cone.material as MeshBasicMaterial).depthTest = false;
    return { cells, ring, ringGeo, arrow };
  }, [world]);
  useEffect(
    () => () => {
      built.cells.geometry.dispose();
      (built.cells.material as MeshBasicMaterial).dispose();
      built.cells.dispose();
      built.ringGeo.dispose();
      (built.ring.material as LineBasicMaterial).dispose();
      built.arrow.dispose();
    },
    [built],
  );
  let tick = 0;
  useFrame(() => {
    const P = world.player.pos;
    built.ring.position.set(P.x, P.y + 0.04, P.z);
    const m = world.debugMove;
    if (m.lengthSq() > 1e-4) {
      built.arrow.visible = true;
      built.arrow.position.set(P.x, P.y + 0.08, P.z);
      built.arrow.setDirection(m.clone().normalize());
    } else built.arrow.visible = false;
    if (tick++ % 5) return;
    const g = world.grid;
    const cell = g.cell;
    const c0 = Math.floor((P.x - R) / cell);
    const r0 = Math.floor((P.z - R) / cell);
    const span = Math.ceil((2 * R) / cell);
    let i = 0;
    for (let r = r0; r < r0 + span; r++) {
      for (let c = c0; c < c0 + span; c++) {
        const x = (c + 0.5) * cell;
        const z = (r + 0.5) * cell;
        const guard = g.cellGuard(c, r);
        const solid = g.cellSolid(c, r) || guard;
        const deck = !solid && !!deckAt(world.map, x, z);
        // only draw what matters: blocked cells everywhere, walkable cells on decks and in a small disc
        if (!solid && !deck && Math.hypot(x - P.x, z - P.z) > 2.2) continue;
        // at least the water surface, so blocked cells over water are not hidden under it
        dummy.position.set(x, Math.max(0, standHeight(world.map, x, z)) + 0.03, z);
        dummy.updateMatrix();
        built.cells.setMatrixAt(i, dummy.matrix);
        built.cells.setColorAt(i, guard ? ORANGE : solid ? RED : deck ? GREEN : BLUE);
        i++;
      }
    }
    built.cells.count = i;
    built.cells.instanceMatrix.needsUpdate = true;
    if (built.cells.instanceColor) built.cells.instanceColor.needsUpdate = true;
  });
  return (
    <>
      <primitive object={built.cells} dispose={null} />
      <primitive object={built.ring} dispose={null} />
      <primitive object={built.arrow} dispose={null} />
    </>
  );
}

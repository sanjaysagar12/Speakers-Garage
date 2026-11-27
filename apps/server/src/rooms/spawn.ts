import { SIM, standHeight, type CollisionGrid, type MapData } from '@speakersgarage/shared';

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * A free spawn point near the map's spawn: candidates spiral outward (golden angle) so arrivals spread
 * instead of stacking; each must be walkable and at least `gap` m from every other player. If none is
 * found, the nearest free collision cell to the spawn is used.
 */
export function findSpawn(map: MapData, grid: CollisionGrid, others: Iterable<{ x: number; z: number }>, gap = 1.2): { x: number; z: number; y: number } {
  const list = [...others];
  const r = SIM.player.radius + 0.05;
  const ok = (x: number, z: number) =>
    x > 1 && z > 1 && x < map.width - 1 && z < map.height - 1 && !grid.blockedCircle(x, z, r) && !map.blockedAt(x, z) && list.every((o) => (o.x - x) ** 2 + (o.z - z) ** 2 >= gap * gap);
  for (let i = 0; i < 400; i++) {
    const a = i * GOLDEN;
    const d = i === 0 ? 0 : 1.2 + 0.75 * Math.sqrt(i);
    const x = map.spawn.x + Math.cos(a) * d;
    const z = map.spawn.z + Math.sin(a) * d;
    if (ok(x, z)) return { x, z, y: standHeight(map, x, z) };
  }
  // fallback: nearest free cell, ignoring other players
  const free = (x: number, z: number) => !grid.blockedCircle(x, z, r) && !map.blockedAt(x, z);
  for (let ring = 0; ring < 200; ring++) {
    for (let k = 0; k < Math.max(1, ring * 8); k++) {
      const a = (k / Math.max(1, ring * 8)) * Math.PI * 2;
      const x = map.spawn.x + Math.cos(a) * ring * grid.cell;
      const z = map.spawn.z + Math.sin(a) * ring * grid.cell;
      if (free(x, z)) return { x, z, y: standHeight(map, x, z) };
    }
  }
  return { x: map.spawn.x, z: map.spawn.z, y: standHeight(map, map.spawn.x, map.spawn.z) };
}

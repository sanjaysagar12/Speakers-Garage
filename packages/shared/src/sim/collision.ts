import { SIM } from '../config';
import { PROP_META, type Footprint } from '../map/props';
import type { Deck, MapData } from '../map/types';
import { deckLocal, pointInDeck } from '../map/deck';

/**
 * Static world collision in metres: map terrain rules (deep water, cliffs, map bounds) plus every prop's
 * footprint, rasterised once into a fine grid. Lookups allocate nothing so they can run every frame.
 */
export class CollisionGrid {
  readonly cell = SIM.collision.cell;
  readonly cols: number;
  readonly rows: number;
  readonly width: number;
  readonly height: number;
  private readonly blocked: Uint8Array;

  constructor(map: MapData) {
    this.width = map.width;
    this.height = map.height;
    this.cols = Math.ceil(map.width / this.cell);
    this.rows = Math.ceil(map.height / this.cell);
    this.blocked = new Uint8Array(this.cols * this.rows);
    const guarded = map.decks.filter((dk) => dk.guard);
    this.guarded = guarded;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = (c + 0.5) * this.cell;
        const z = (r + 0.5) * this.cell;
        if (!map.blockedAt(x, z)) continue;
        // terrain blocking right beside a guarded deck goes on the guard layer: the deck's own walls are
        // exact there, and a staircase of solid cells would snag a body sliding along the edge
        this.blocked[r * this.cols + c] = guarded.some((dk) => pointInDeck(dk, x, z, 1.0)) ? 2 : 1;
      }
    }
    for (const p of map.props) {
      const fp = p.footprint ?? PROP_META[p.type]?.footprint;
      if (fp) this.stamp(fp, p.x, p.z, p.rot, p.scale);
    }
    this.guardDecks(map);
  }

  /**
   * Elevated decks (the pier) get a blocked band just outside their edges, so a body of the player's radius
   * stays on the planks and slides along the edge. The open start edge (the shore entrance) stays walkable.
   */
  private guardDecks(map: MapData, margin = 0.3): void {
    const decks = map.decks;
    this.fillValue = 2;
    for (const dk of decks) {
      if (!dk.guard) continue;
      const ext = Math.hypot(dk.w, dk.d) / 2 + margin;
      this.fill(dk.x - ext, dk.z - ext, dk.x + ext, dk.z + ext, (x, z) => {
        if (this.blocked[Math.floor(z / this.cell) * this.cols + Math.floor(x / this.cell)] === 1) return false;
        if (decks.some((o) => pointInDeck(o, x, z))) return false;
        const { u, v } = deckLocal(dk, x, z);
        if (dk.openStart && v < -dk.d / 2 + 0.05) return false;
        return Math.abs(u) <= dk.w / 2 + margin && v >= -dk.d / 2 - margin && v <= dk.d / 2 + margin;
      });
    }
    this.fillValue = 1;
  }

  /** debug: is the cell a deck guard-band cell */
  cellGuard(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows && this.blocked[r * this.cols + c] === 2;
  }

  /** debug: is the cell at (col,row) solid */
  cellSolid(c: number, r: number): boolean {
    return c < 0 || r < 0 || c >= this.cols || r >= this.rows || this.blocked[r * this.cols + c] === 1;
  }

  /** Rasterise a footprint placed at (x,z) with yaw rot (three's rotation.y convention). */
  stamp(fp: Footprint, x: number, z: number, rot: number, scale = 1): void {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const toWorld = (lx: number, lz: number): [number, number] => [x + (lx * c + lz * s) * scale, z + (-lx * s + lz * c) * scale];
    if (fp.kind === 'multi') {
      fp.parts.forEach((part) => this.stamp(part, x, z, rot, scale));
      return;
    }
    if (fp.kind === 'circle') {
      const [cx, cz] = toWorld(fp.x ?? 0, fp.z ?? 0);
      this.fill(cx - fp.r * scale, cz - fp.r * scale, cx + fp.r * scale, cz + fp.r * scale, (px, pz) => (px - cx) ** 2 + (pz - cz) ** 2 <= (fp.r * scale) ** 2);
      return;
    }
    if (fp.kind === 'box') {
      const [cx, cz] = toWorld(fp.x ?? 0, fp.z ?? 0);
      const hw = (fp.w / 2) * scale;
      const hd = (fp.d / 2) * scale;
      const ext = Math.hypot(hw, hd);
      this.fill(cx - ext, cz - ext, cx + ext, cz + ext, (px, pz) => {
        const dx = px - cx;
        const dz = pz - cz;
        return Math.abs(dx * c - dz * s) <= hw && Math.abs(dx * s + dz * c) <= hd;
      });
    }
  }

  private fill(x0: number, z0: number, x1: number, z1: number, inside: (x: number, z: number) => boolean): void {
    const c0 = Math.max(0, Math.floor(x0 / this.cell));
    const c1 = Math.min(this.cols - 1, Math.floor(x1 / this.cell));
    const r0 = Math.max(0, Math.floor(z0 / this.cell));
    const r1 = Math.min(this.rows - 1, Math.floor(z1 / this.cell));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const x = (c + 0.5) * this.cell;
        const z = (r + 0.5) * this.cell;
        if (!inside(x, z)) continue;
        const i = r * this.cols + c;
        if (this.blocked[i] === 1) continue;
        // a prop footprint just outside a guarded deck (a boat moored beside the pier) joins the guard layer;
        // props standing ON the deck stay solid
        const nearGuard = this.fillValue === 1 && this.guarded.some((dk) => !pointInDeck(dk, x, z) && pointInDeck(dk, x, z, 1.0));
        this.blocked[i] = nearGuard ? 2 : this.fillValue;
      }
    }
  }
  private guarded: Deck[] = [];
  /** 1 = solid, 2 = guard band (deck edges; blocks pathfinding, the controller uses exact deck heights) */
  private fillValue = 1;

  /**
   * true if a circle of radius r at (x,z) overlaps a blocked cell (exact circle-vs-square test) or leaves
   * the map. `guard` includes the deck guard band (pathfinding); the controller passes false and enforces
   * deck edges exactly through heights instead.
   */
  blockedCircle(x: number, z: number, r: number, guard = true): boolean {
    if (x - r < 0 || z - r < 0 || x + r >= this.width || z + r >= this.height) return true;
    const cs = this.cell;
    const c0 = Math.floor((x - r) / cs);
    const c1 = Math.floor((x + r) / cs);
    const r0 = Math.floor((z - r) / cs);
    const r1 = Math.floor((z + r) / cs);
    const rr = r * r;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const v = this.blocked[row * this.cols + col];
        if (!v || (v === 2 && !guard)) continue;
        const nx = Math.max(col * cs, Math.min(x, (col + 1) * cs));
        const nz = Math.max(row * cs, Math.min(z, (row + 1) * cs));
        if ((nx - x) ** 2 + (nz - z) ** 2 < rr) return true;
      }
    }
    return false;
  }

  /** straight-line clearance, sampled every 0.2 m */
  segmentClear(x0: number, z0: number, x1: number, z1: number, r: number): boolean {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.2));
    for (let i = 0; i <= n; i++) if (this.blockedCircle(x0 + (dx * i) / n, z0 + (dz * i) / n, r)) return false;
    return true;
  }

  /** debug/minimap: is the cell at (x,z) solid */
  solidAt(x: number, z: number): boolean {
    const c = Math.floor(x / this.cell);
    const r = Math.floor(z / this.cell);
    return c < 0 || r < 0 || c >= this.cols || r >= this.rows || this.blocked[r * this.cols + c] === 1;
  }
}

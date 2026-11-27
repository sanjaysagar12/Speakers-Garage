import { js as EasyStarJS } from 'easystarjs';
import { GAME_CONFIG } from '../config';
import type { CollisionGrid } from '@speakersgarage/shared';
import type { Vec2 } from '../../types';

/** Click/tap-to-move: EasyStar over a coarse grid derived from the player-sized collision test. Vec2.y = world z. */
export class Pathfinding {
  private readonly es = new EasyStarJS();
  private readonly cell = GAME_CONFIG.collision.pathCell;
  private readonly cols: number;
  private readonly rows: number;
  private readonly walk: Uint8Array;
  private pending = 0;
  private readonly r = GAME_CONFIG.player.radius;

  constructor(readonly grid: CollisionGrid) {
    this.cols = Math.floor(grid.width / this.cell);
    this.rows = Math.floor(grid.height / this.cell);
    this.walk = new Uint8Array(this.cols * this.rows);
    const g: number[][] = [];
    for (let r = 0; r < this.rows; r++) {
      const row: number[] = [];
      for (let c = 0; c < this.cols; c++) {
        const ok = !grid.blockedCircle((c + 0.5) * this.cell, (r + 0.5) * this.cell, this.r);
        this.walk[r * this.cols + c] = ok ? 1 : 0;
        row.push(ok ? 0 : 1);
      }
      g.push(row);
    }
    this.es.setGrid(g);
    this.es.setAcceptableTiles([0]);
    this.es.enableDiagonals();
    this.es.disableCornerCutting();
    this.es.setIterationsPerCalculation(3000);
  }

  /** call once per frame */
  update(): void {
    if (this.pending > 0) this.es.calculate();
  }

  private isWalk(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows && this.walk[r * this.cols + c] === 1;
  }

  private nearestWalkable(cx: number, cy: number): [number, number] | null {
    if (this.isWalk(cx, cy)) return [cx, cy];
    for (let r = 1; r <= 10; r++) {
      let best: [number, number] | null = null;
      let bd = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !this.isWalk(cx + dx, cy + dy)) continue;
          const d = dx * dx + dy * dy;
          if (d < bd) {
            bd = d;
            best = [cx + dx, cy + dy];
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** Resolves with smoothed world-space waypoints, or null if unreachable. */
  findPath(from: Vec2, to: Vec2): Promise<Vec2[] | null> {
    const s = this.nearestWalkable(Math.floor(from.x / this.cell), Math.floor(from.y / this.cell));
    const e = this.nearestWalkable(Math.floor(to.x / this.cell), Math.floor(to.y / this.cell));
    if (!s || !e) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.pending++;
      this.es.findPath(s[0], s[1], e[0], e[1], (path) => {
        this.pending--;
        if (!path || path.length === 0) return resolve(null);
        const pts: Vec2[] = path.map((p) => ({ x: (p.x + 0.5) * this.cell, y: (p.y + 0.5) * this.cell }));
        pts[0] = { x: from.x, y: from.y };
        if (e[0] === Math.floor(to.x / this.cell) && e[1] === Math.floor(to.y / this.cell) && !this.grid.blockedCircle(to.x, to.y, this.r)) pts[pts.length - 1] = { x: to.x, y: to.y };
        resolve(this.smooth(pts));
      });
    });
  }

  /** greedy line-of-sight string pulling */
  private smooth(pts: Vec2[]): Vec2[] {
    if (pts.length <= 2) return pts.slice(1);
    const out: Vec2[] = [];
    let anchor = 0;
    while (anchor < pts.length - 1) {
      let far = anchor + 1;
      for (let i = pts.length - 1; i > anchor + 1; i--) {
        if (this.grid.segmentClear(pts[anchor].x, pts[anchor].y, pts[i].x, pts[i].y, this.r)) {
          far = i;
          break;
        }
      }
      out.push(pts[far]);
      anchor = far;
    }
    return out;
  }
}

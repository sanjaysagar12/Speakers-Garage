/**
 * Signed-distance shoreline field. Built once from beach.json (deterministic, ~30-60 ms):
 *  d     signed distance to the curved shoreline in metres (positive = land)
 *  s     shore-frame coordinate of the nearest shoreline point (drives wave phase along the shore)
 *  grass / rock   soft zone masks 0..1
 * The same arrays feed the ground shader (as a half-float texture), collision, wading, crabs and the minimap.
 */

export interface ShoreDef {
  origin: [number, number];
  angleDeg: number;
  offsets: Array<[number, number]>;
}

export interface Field {
  x0: number;
  z0: number;
  w: number;
  h: number;
  res: number;
  nx: number;
  nz: number;
  d: Float32Array;
  s: Float32Array;
  grass: Float32Array;
  rock: Float32Array;
}

export interface ShoreFrame {
  /** unit vector along the shore */
  D: [number, number];
  /** unit vector toward the sea */
  N: [number, number];
  offset(s: number): number;
  /** world position of shore-frame (s, d) where d is metres inland from the curved shoreline */
  point(s: number, d: number): [number, number];
}

/** Monotone-ish smooth interpolation of the offset table (Catmull-Rom on uniform-ish knots). */
export function shoreFrame(def: ShoreDef): ShoreFrame {
  const a = (def.angleDeg * Math.PI) / 180;
  const D: [number, number] = [Math.cos(a), Math.sin(a)];
  // the sea is to the right of the travel direction in x/z (z points south)
  const N: [number, number] = [-D[1], D[0]];
  const o = def.offsets;
  const offset = (s: number): number => {
    if (s <= o[0][0]) return o[0][1];
    if (s >= o[o.length - 1][0]) return o[o.length - 1][1];
    let i = 0;
    while (i < o.length - 2 && o[i + 1][0] < s) i++;
    const p0 = o[Math.max(0, i - 1)];
    const p1 = o[i];
    const p2 = o[i + 1];
    const p3 = o[Math.min(o.length - 1, i + 2)];
    const t = (s - p1[0]) / (p2[0] - p1[0]);
    const m1 = ((p2[1] - p0[1]) / Math.max(1e-6, p2[0] - p0[0])) * (p2[0] - p1[0]);
    const m2 = ((p3[1] - p1[1]) / Math.max(1e-6, p3[0] - p1[0])) * (p2[0] - p1[0]);
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
  };
  const point = (s: number, d: number): [number, number] => {
    const k = offset(s) - d;
    return [def.origin[0] + D[0] * s + N[0] * k, def.origin[1] + D[1] * s + N[1] * k];
  };
  return { D, N, offset, point };
}

export interface ZoneCircle {
  x: number;
  z: number;
  r: number;
}

export function buildField(
  frame: ShoreFrame,
  domain: [number, number, number, number],
  res: number,
  zones: { grass: ZoneCircle[]; rock: ZoneCircle[] },
): Field {
  const [x0, z0, w, h] = domain;
  const nx = Math.round(w / res) + 1;
  const nz = Math.round(h / res) + 1;

  // 1. shoreline polyline far beyond the domain on both ends
  const pts: Array<[number, number, number]> = [];
  const span = Math.hypot(w, h) * 1.5;
  for (let s = -span; s <= span * 1.6; s += 0.5) {
    const [x, z] = frame.point(s, 0);
    pts.push([x, z, s]);
  }
  // keep the part that matters (inside domain + margin) for the distance search
  const m = 60;
  const segs: Array<[number, number, number, number, number, number]> = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az, as] = pts[i];
    const [bx, bz, bs] = pts[i + 1];
    if (Math.max(ax, bx) < x0 - m || Math.min(ax, bx) > x0 + w + m || Math.max(az, bz) < z0 - m || Math.min(az, bz) > z0 + h + m) continue;
    segs.push([ax, az, bx, bz, as, bs]);
  }

  // 2. bucket segments
  const B = 4;
  const bx0 = x0 - m;
  const bz0 = z0 - m;
  const bnx = Math.ceil((w + 2 * m) / B);
  const bnz = Math.ceil((h + 2 * m) / B);
  const buckets: number[][] = Array.from({ length: bnx * bnz }, () => []);
  segs.forEach(([ax, az, bx, bz], i) => {
    const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - bx0) / B));
    const c1 = Math.min(bnx - 1, Math.floor((Math.max(ax, bx) - bx0) / B));
    const r0 = Math.max(0, Math.floor((Math.min(az, bz) - bz0) / B));
    const r1 = Math.min(bnz - 1, Math.floor((Math.max(az, bz) - bz0) / B));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) buckets[r * bnx + c].push(i);
  });

  // coarse unsigned distance (2 m grid, brute force over a decimated polyline) for texels far from shore
  const CR = 2;
  const cnx = Math.ceil(w / CR) + 2;
  const cnz = Math.ceil(h / CR) + 2;
  const coarseD = new Float32Array(cnx * cnz);
  const coarseS = new Float32Array(cnx * cnz);
  const dec = segs.filter((_, i) => i % 4 === 0);
  for (let j = 0; j < cnz; j++) {
    for (let i = 0; i < cnx; i++) {
      const x = x0 + i * CR;
      const z = z0 + j * CR;
      let best = Infinity;
      let bs = 0;
      for (const [ax, az, , , as] of dec) {
        const dd = (ax - x) * (ax - x) + (az - z) * (az - z);
        if (dd < best) {
          best = dd;
          bs = as;
        }
      }
      coarseD[j * cnx + i] = Math.sqrt(best);
      coarseS[j * cnx + i] = bs;
    }
  }
  const coarse = (arr: Float32Array, x: number, z: number) => {
    const fx = (x - x0) / CR;
    const fz = (z - z0) / CR;
    const i = Math.min(cnx - 2, Math.max(0, Math.floor(fx)));
    const j = Math.min(cnz - 2, Math.max(0, Math.floor(fz)));
    const tx = fx - i;
    const tz = fz - j;
    const k = j * cnx + i;
    const a = arr[k] + (arr[k + 1] - arr[k]) * tx;
    const b = arr[k + cnx] + (arr[k + cnx + 1] - arr[k + cnx]) * tx;
    return a + (b - a) * tz;
  };

  const d = new Float32Array(nx * nz);
  const sArr = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const z = z0 + j * res;
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * res;
      const cd = coarse(coarseD, x, z);
      if (cd > 14) {
        d[j * nx + i] = cd;
        sArr[j * nx + i] = coarse(coarseS, x, z);
        continue;
      }
      const bc = Math.floor((x - bx0) / B);
      const br = Math.floor((z - bz0) / B);
      let best = Infinity;
      let bestS = 0;
      for (let ring = 0; ring < 8; ring++) {
        if (best < (ring - 1) * B) break;
        for (let dr = -ring; dr <= ring; dr++) {
          for (let dc = -ring; dc <= ring; dc++) {
            if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
            const c = bc + dc;
            const r = br + dr;
            if (c < 0 || r < 0 || c >= bnx || r >= bnz) continue;
            for (const si of buckets[r * bnx + c]) {
              const [ax, az, ex, ez, as, es] = segs[si];
              const vx = ex - ax;
              const vz = ez - az;
              const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
              const px = ax + vx * t - x;
              const pz = az + vz * t - z;
              const dd = px * px + pz * pz;
              if (dd < best * best) {
                best = Math.sqrt(dd);
                bestS = as + (es - as) * t;
              }
            }
          }
        }
      }
      d[j * nx + i] = Number.isFinite(best) ? best : cd;
      sArr[j * nx + i] = Number.isFinite(best) ? bestS : coarse(coarseS, x, z);
    }
  }

  // 3. sign by scanline crossings of the land polygon (shoreline + a far loop around the land side)
  const poly: Array<[number, number]> = pts.map(([x, z]) => [x, z]);
  const last = pts[pts.length - 1];
  const first = pts[0];
  const far = span * 3;
  poly.push([last[0] - frame.N[0] * far, last[1] - frame.N[1] * far]);
  poly.push([first[0] - frame.N[0] * far, first[1] - frame.N[1] * far]);
  for (let j = 0; j < nz; j++) {
    const z = z0 + j * res;
    const xs: number[] = [];
    for (let k = 0; k < poly.length; k++) {
      const [ax, az] = poly[k];
      const [bx, bz] = poly[(k + 1) % poly.length];
      if ((az <= z && bz > z) || (bz <= z && az > z)) xs.push(ax + ((z - az) / (bz - az)) * (bx - ax));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * res;
      let inside = false;
      for (const cx of xs) if (cx < x) inside = !inside;
      if (!inside) d[j * nx + i] = -d[j * nx + i];
    }
  }

  // 4. zone masks (soft circles, 1.5 m falloff)
  const grass = new Float32Array(nx * nz);
  const rock = new Float32Array(nx * nz);
  const paint = (arr: Float32Array, cs: ZoneCircle[]) => {
    for (const c of cs) {
      const i0 = Math.max(0, Math.floor((c.x - c.r - 2 - x0) / res));
      const i1 = Math.min(nx - 1, Math.ceil((c.x + c.r + 2 - x0) / res));
      const j0 = Math.max(0, Math.floor((c.z - c.r - 2 - z0) / res));
      const j1 = Math.min(nz - 1, Math.ceil((c.z + c.r + 2 - z0) / res));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const dist = Math.hypot(x0 + i * res - c.x, z0 + j * res - c.z);
          const v = Math.min(1, Math.max(0, (c.r - dist) / 1.5 + 0.5));
          const k = j * nx + i;
          arr[k] = Math.max(arr[k], v);
        }
      }
    }
  };
  paint(grass, zones.grass);
  paint(rock, zones.rock);
  // grass never grows below the dry line
  for (let k = 0; k < grass.length; k++) grass[k] *= Math.min(1, Math.max(0, (d[k] - 5) / 4));

  return { x0, z0, w, h, res, nx, nz, d, s: sArr, grass, rock };
}

/** Bilinear sample of a field channel. */
export function sampleField(f: Field, arr: Float32Array, x: number, z: number): number {
  const fx = Math.min(f.nx - 1.001, Math.max(0, (x - f.x0) / f.res));
  const fz = Math.min(f.nz - 1.001, Math.max(0, (z - f.z0) / f.res));
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - j;
  const k = j * f.nx + i;
  const a = arr[k] + (arr[k + 1] - arr[k]) * tx;
  const b = arr[k + f.nx] + (arr[k + f.nx + 1] - arr[k + f.nx]) * tx;
  return a + (b - a) * tz;
}

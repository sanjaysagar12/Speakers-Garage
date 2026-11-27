/**
 * Pier geometry in numbers. Single source of truth: the client's plank geometry (buildPier) and the
 * walkable decks + collision (map builders, shared with the server) are generated from this.
 */
export interface PierParams {
  length?: number;
  width?: number;
  deckY?: number;
  head?: boolean;
  rail?: boolean;
  posts?: number;
  /** deck height at the shore end (the ground there), relative to the pier base */
  rampFrom?: number;
  rampLen?: number;
}

/** One walkable rectangle of a pier in its local frame (u across, v along from the shore end). */
export interface PierDeckRect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  /** deck height at v0 and v1 (a ramp when they differ) */
  y0: number;
  y1: number;
  /** v range over which y0 -> y1 interpolates (the rest is flat at y1) */
  rampLen: number;
  /** the v0 edge is an open entrance (not guarded) */
  openStart: boolean;
}

/**
 * Single source of truth for pier dimensions: the plank geometry (buildPier) and the walkable deck
 * (map decks + collision) are both generated from this, so they can never disagree.
 */
export function pierLayout(p: PierParams = {}) {
  const L = p.length ?? 22;
  const W = p.width ?? 2.4;
  const Y = p.deckY ?? 0.75;
  const from = Math.min(Y, p.rampFrom ?? 0.08);
  const rampLen = p.rampLen ?? (Y - from > 0.3 ? Math.max(2.4, (Y - from) / 0.28) : 0);
  const head = p.head !== false && p.rail !== false ? { w: W * 2.2, d: 2.2, v: L + 1.0 } : null;
  const rects: PierDeckRect[] = [{ u0: -W / 2, u1: W / 2, v0: 0, v1: L, y0: rampLen > 0 ? from : Y, y1: Y, rampLen, openStart: true }];
  if (head) rects.push({ u0: -head.w / 2, u1: head.w / 2, v0: head.v - head.d / 2, v1: head.v + head.d / 2, y0: Y, y1: Y, rampLen: 0, openStart: false });
  /** deck height at distance v from the shore end (main span) */
  const heightAt = (v: number) => (rampLen > 0 && v < rampLen ? from + ((Y - from) * Math.max(0, v)) / rampLen : Y);
  return { L, W, Y, from, rampLen, head, rects, heightAt };
}


/** Boardwalks are low piers without rails or a T-head. */
export const boardwalkParams = (p: Record<string, unknown>): PierParams => ({ length: 8, width: 1.8, deckY: 0.12, ...(p as PierParams), head: false, rail: false, posts: 0.3 });

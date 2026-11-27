/** Tiny SVG helper DSL. All art is authored in LOGICAL px (64px tiles) and rasterized at SCALE x. */
export const SCALE = 2;

export const PAL = {
  sand: '#F2DDA4',
  sandDark: '#E3C98A',
  sandLight: '#F8E9BD',
  wetSand: '#D9BF86',
  turquoise: '#3CC8D6',
  turquoiseLight: '#7CE3E8',
  deep: '#1C7FA8',
  deeper: '#14628A',
  palm: '#3FA672',
  palmDark: '#2C7F55',
  palmLight: '#63C98F',
  wood: '#A9713F',
  woodDark: '#7C4F28',
  woodLight: '#C8905A',
  rock: '#8E8A93',
  rockDark: '#625E69',
  rockLight: '#B5B1BA',
  foam: '#FFFFFF',
  red: '#E8574A',
  blue: '#3E8EDB',
  yellow: '#F5C242',
  white: '#FFFDF7',
  ink: '#3A2E2A',
};

export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export function rgbToHex(r: number, g: number, b: number): string {
  const f = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`;
}
/** amt in -1..1: negative darkens, positive lightens. */
export function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  if (amt >= 0) return rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
  return rgbToHex(r * (1 + amt), g * (1 + amt), b * (1 + amt));
}
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}
/** Outline color: a darker, slightly warmer shade of the fill. */
export function ol(hex: string): string {
  return shade(mix(hex, '#3a2a30', 0.18), -0.28);
}

export function svgDoc(w: number, h: number, body: string, defs = ''): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${
    defs ? `<defs>${defs}</defs>` : ''
  }${body}</svg>`;
}

let gid = 0;
export function uid(prefix = 'g'): string {
  gid += 1;
  return `${prefix}${gid}`;
}

export function lgrad(id: string, stops: Array<[number, string, number?]>, x1 = 0, y1 = 0, x2 = 0, y2 = 1): string {
  return `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops
    .map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a !== undefined ? ` stop-opacity="${a}"` : ''}/>`)
    .join('')}</linearGradient>`;
}
export function rgrad(id: string, stops: Array<[number, string, number?]>, cx = 0.5, cy = 0.5, r = 0.5): string {
  return `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops
    .map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a !== undefined ? ` stop-opacity="${a}"` : ''}/>`)
    .join('')}</radialGradient>`;
}
export function blur(id: string, sd: number): string {
  return `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;
}

type Attrs = Record<string, string | number | undefined>;
function attrs(a: Attrs): string {
  const m = new Map<string, string | number>();
  for (const [k, v] of Object.entries(a)) if (v !== undefined) m.set(k.replace(/_/g, '-'), v);
  return [...m].map(([k, v]) => `${k}="${v}"`).join(' ');
}
export const el = (tag: string, a: Attrs, inner = ''): string =>
  inner ? `<${tag} ${attrs(a)}>${inner}</${tag}>` : `<${tag} ${attrs(a)}/>`;

/** filled shape with a soft outline */
export function shape(tag: string, a: Attrs, fill: string, outline: string | null = ol(fill), sw = 1.3): string {
  return el(tag, {
    fill,
    stroke: outline ?? undefined,
    stroke_width: outline ? sw : undefined,
    stroke_linejoin: 'round',
    stroke_linecap: 'round',
    ...a,
  });
}
export const rect = (x: number, y: number, w: number, h: number, fill: string, rx = 0, o: string | null = ol(fill), sw = 1.3) =>
  shape('rect', { x, y, width: w, height: h, rx }, fill, o, sw);
export const ellipse = (cx: number, cy: number, rx: number, ry: number, fill: string, o: string | null = ol(fill), sw = 1.3) =>
  shape('ellipse', { cx, cy, rx, ry }, fill, o, sw);
export const circle = (cx: number, cy: number, r: number, fill: string, o: string | null = ol(fill), sw = 1.3) =>
  shape('circle', { cx, cy, r }, fill, o, sw);
export const path = (d: string, fill: string, o: string | null = ol(fill), sw = 1.3, extra: Attrs = {}) =>
  shape('path', { d, ...extra }, fill, o, sw);
export const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, sw = 1.5, extra: Attrs = {}) =>
  el('line', { x1, y1, x2, y2, stroke, stroke_width: sw, stroke_linecap: 'round', ...extra });
export const g = (inner: string, a: Attrs = {}) => el('g', a, inner);

/** Soft ground shadow ellipse (blurred). */
export function softShadow(cx: number, cy: number, rx: number, ry: number, opacity = 0.28): { defs: string; body: string } {
  const id = uid('sh');
  return {
    defs: blur(id, Math.max(1.5, Math.min(rx, ry) * 0.25)),
    body: el('ellipse', { cx, cy, rx, ry, fill: '#3a2a20', opacity, filter: `url(#${id})` }),
  };
}

/** deterministic rng */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

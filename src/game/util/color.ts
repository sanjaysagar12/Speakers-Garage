/** '#RRGGBB' -> [r, g, b] in 0..255 (minimap rasters). */
export const hexToRgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

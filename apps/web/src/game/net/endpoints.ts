/** Game server addresses (tiny module: the landing page needs these without the network code). */

/** VITE_WS_URL: only when the site is hosted apart from the game server (VITE_SERVER_URL: older name). */
const override = (): string | undefined => (import.meta.env.VITE_WS_URL as string | undefined) || (import.meta.env.VITE_SERVER_URL as string | undefined) || undefined;

/**
 * The game WebSocket. Normally the page's own origin (the server serves the site; in development Vite
 * proxies /ws), as wss:// when the page is HTTPS and ws:// otherwise.
 */
export function serverUrl(): string {
  return override() ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

/** HTTP base of the game server (for /rooms, /health): the override's host, else the page's own origin. */
export function serverHttp(): string {
  const o = override();
  if (o) return o.replace(/^ws/, 'http').replace(/\/ws$/, '');
  return location.origin;
}

/** A deep link like /room/abc picks that room on the landing page. */
export function roomFromPath(path = location.pathname): string | null {
  const m = /^\/room\/([a-z0-9-]{1,24})\/?$/i.exec(path);
  return m ? m[1].toLowerCase() : null;
}

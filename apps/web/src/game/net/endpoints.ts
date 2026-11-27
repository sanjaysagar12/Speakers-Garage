/** Game server addresses (tiny module: the landing page needs these without the network code). */

/** Where the game server is: VITE_SERVER_URL, else the dev/preview proxy on the page's own origin (/ws). */
export function serverUrl(): string {
  const env = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (env) return env;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

/** HTTP base of the game server (for /rooms, /health): VITE_SERVER_URL's host, else the proxy at /api. */
export function serverHttp(): string {
  const env = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (env) return env.replace(/^ws/, 'http').replace(/\/ws$/, '');
  return `${location.origin}/api`;
}

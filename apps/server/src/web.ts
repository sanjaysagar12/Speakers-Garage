import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { Env } from './env';

/**
 * The built web app (apps/web/dist) served by the game server: one process, one port for the website,
 * the HTTP API and the WebSocket.
 *  - hashed files under /assets/ are cached forever (immutable); index.html and the manifest never
 *  - precompressed .br/.gz files from the build are served when the browser accepts them
 *  - any other GET that wants HTML gets index.html (client-side routes, deep links); unknown API and
 *    asset paths get a real 404
 */

/** Paths owned by the server itself, never answered with the app's HTML. */
const API = /^\/(ws|health|rooms|api)(\/|$|\?)/;

/** Default: apps/web/dist next to this package (works from src/ with tsx and from dist/ after the build). */
export function defaultWebDist(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../web/dist');
}

export function resolveWebDist(env: Env): string | null {
  if (env.SERVE_WEB === 'off') return null;
  // on Vercel the site is its own service (vercel.json): this one serves only the API and the socket
  if (env.SERVE_WEB === 'auto' && process.env.VERCEL) return null;
  const dir = env.WEB_DIST_PATH ? path.resolve(env.WEB_DIST_PATH) : defaultWebDist();
  const ok = existsSync(path.join(dir, 'index.html')) && statSync(dir).isDirectory();
  if (ok) return dir;
  // production must serve the site: fail loudly at startup instead of 404ing every page
  if (env.SERVE_WEB === 'on' || env.NODE_ENV === 'production') {
    throw new Error(
      `Web app not found: ${path.join(dir, 'index.html')} does not exist.\n` +
        `  Build it first (pnpm build), or set WEB_DIST_PATH to the folder that holds index.html, or SERVE_WEB=off to run the API only.`,
    );
  }
  return null;
}

const NO_CACHE = 'no-cache';
const IMMUTABLE = 'public, max-age=31536000, immutable';

export function cacheControlFor(file: string): string {
  const name = path.basename(file).replace(/\.(br|gz)$/, '');
  if (name === 'index.html' || name.endsWith('.webmanifest') || name === 'manifest.json') return NO_CACHE;
  if (/[\\/]assets[\\/]/.test(file)) return IMMUTABLE;
  // icons, og image: short cache, they keep their names across releases
  return 'public, max-age=3600';
}

const wantsHtml = (req: FastifyRequest) => (req.method === 'GET' || req.method === 'HEAD') && /text\/html/.test(req.headers.accept ?? '');

export async function registerWeb(app: FastifyInstance, dir: string): Promise<void> {
  await app.register(fastifyStatic, {
    root: dir,
    prefix: '/',
    preCompressed: true,
    // the SPA fallback below decides what an unknown path is; static must not 404 first with its own handler
    wildcard: true,
    index: ['index.html'],
    cacheControl: false,
    etag: true,
    lastModified: true,
    setHeaders: (reply, file) => {
      reply.header('cache-control', cacheControlFor(file));
    },
    allowedPath: (pathName) => !API.test(pathName),
  });

  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url.split('?')[0];
    // client-side route or deep link: the app's HTML. Files with an extension and server paths: 404.
    if (wantsHtml(req) && !API.test(url) && !/\.[a-z0-9]{1,8}$/i.test(url)) {
      return reply.header('cache-control', NO_CACHE).type('text/html; charset=utf-8').sendFile('index.html');
    }
    return reply.code(404).type('application/json').send({ error: 'not found', path: url });
  });
}

/**
 * Content Security Policy for the app: only its own scripts, styles, images, media and the game socket.
 * The app uses no inline scripts, no eval and no third-party origins.
 */
export const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  // React/R3F set element styles through the DOM API (not affected by CSP); the build emits one CSS file
  styleSrc: ["'self'"],
  imgSrc: ["'self'", 'data:', 'blob:'],
  fontSrc: ["'self'", 'data:'],
  connectSrc: ["'self'", 'ws:', 'wss:'],
  mediaSrc: ["'self'", 'blob:'],
  workerSrc: ["'self'", 'blob:'],
  manifestSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  upgradeInsecureRequests: null,
};

/** Browser features the page may use: the microphone (voice) on its own origin, nothing else. */
export const PERMISSIONS_POLICY = 'microphone=(self), camera=(), geolocation=(), payment=(), usb=()';

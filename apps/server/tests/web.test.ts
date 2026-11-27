import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, joinMsg, startServer } from './helpers';
import { loadEnv } from '../src/env';
import { resolveWebDist } from '../src/web';

// A built-app fixture: what `vite build` emits (index.html, hashed assets with .br/.gz, an icon).
const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-dist-'));
const INDEX = '<!doctype html><html><head><title>Speaker\'s Garage</title><script type="module" src="/assets/index-abc123.js"></script></head><body><div id="root"></div></body></html>';
const JS = `console.log(${JSON.stringify('x'.repeat(4000))});`;
fs.mkdirSync(path.join(dist, 'assets'));
fs.writeFileSync(path.join(dist, 'index.html'), INDEX);
fs.writeFileSync(path.join(dist, 'assets/index-abc123.js'), JS);
fs.writeFileSync(path.join(dist, 'assets/index-abc123.js.br'), zlib.brotliCompressSync(JS));
fs.writeFileSync(path.join(dist, 'assets/index-abc123.js.gz'), zlib.gzipSync(JS));
fs.writeFileSync(path.join(dist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');

let srv: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => {
  srv = await startServer({ SERVE_WEB: 'on', WEB_DIST_PATH: dist });
});
afterAll(async () => {
  await srv.app.close();
  fs.rmSync(dist, { recursive: true, force: true });
});

const html = { accept: 'text/html,application/xhtml+xml' };

describe('serving the web app (single port)', () => {
  it('GET / returns the app, never cached', async () => {
    const r = await fetch(`${srv.http}/`, { headers: html });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/text\/html/);
    expect(r.headers.get('cache-control')).toBe('no-cache');
    expect(await r.text()).toContain('<div id="root">');
  });

  it('deep links return the app HTML (client-side routes)', async () => {
    const r = await fetch(`${srv.http}/room/abc`, { headers: html });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('<div id="root">');
  });

  it('hashed assets are immutable and served precompressed', async () => {
    const r = await fetch(`${srv.http}/assets/index-abc123.js`, { headers: { 'accept-encoding': 'br, gzip' } });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(r.headers.get('content-encoding')).toBe('br');
    expect(await r.text()).toBe(JS); // fetch decodes
  });

  it('unknown files and API paths are real 404s, not the HTML page', async () => {
    for (const p of ['/nonexistent.js', '/assets/missing-123.css', '/api/nothing', '/rooms/x']) {
      const r = await fetch(`${srv.http}${p}`, { headers: html });
      expect(r.status, p).toBe(404);
      expect(r.headers.get('content-type'), p).toMatch(/json/);
    }
  });

  it('/health and /rooms still answer JSON', async () => {
    const h = await fetch(`${srv.http}/health`, { headers: html });
    expect(h.status).toBe(200);
    expect(((await h.json()) as { ok: boolean }).ok).toBe(true);
    expect(((await (await fetch(`${srv.http}/rooms`)).json()) as { rooms: unknown[] }).rooms).toEqual([]);
  });

  it('sends the security headers: CSP (self + ws), microphone allowed for self only', async () => {
    const r = await fetch(`${srv.http}/`, { headers: html });
    const csp = r.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self' ws: wss:");
    expect(csp).toContain("media-src 'self' blob:");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).not.toContain('unsafe-eval');
    expect(r.headers.get('permissions-policy')).toContain('microphone=(self)');
  });

  it('the WebSocket upgrade still works on the same port, from the same origin', async () => {
    const c = await connect(srv.url, srv.http);
    c.send(joinMsg('Ana', 'web-test'));
    const w = await c.waitFor('welcome');
    expect(w.room).toBe('web-test');
    c.close();
  });
});

describe('startup', () => {
  it('fails clearly in production when the web build is missing', () => {
    const env = loadEnv({ NODE_ENV: 'production', WEB_DIST_PATH: path.join(dist, 'nope') });
    expect(() => resolveWebDist(env)).toThrow(/Web app not found/);
    expect(resolveWebDist(loadEnv({ NODE_ENV: 'production', SERVE_WEB: 'off' }))).toBeNull();
  });
});

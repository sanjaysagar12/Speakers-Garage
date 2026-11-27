// Release check: the production build on ONE port (pnpm build && pnpm start), driven like a user.
//
//   pnpm build && node apps/web/scripts/release-check.mjs [--port 8790] [--out release-check]
//
// Starts the compiled server (NODE_ENV=production: it serves apps/web/dist), then with headless Chromium
// (fake microphone, auto-accepted prompt) and one browser that denies the microphone:
//   1. brand: <title>, heading, favicon, manifest; caching and security headers; no CSP violations
//   2. A and B enter the same room: voice connects by itself, the indicator is "Mic live", M mutes
//   3. C (microphone denied) enters anyway: listen-only indicator + "Retry microphone" banner
//   4. deep link /room/<id> opens the app with that room chosen; a refresh in the world works
// Only the DOM is used (production builds have no test hooks). Screenshots and result.json in --out.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i < 0 ? d : process.argv[i + 1];
};
const port = Number(arg('port', '8790'));
const out = path.resolve(arg('out', 'release-check'));
fs.mkdirSync(out, { recursive: true });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const base = `http://127.0.0.1:${port}`;
const result = { checks: {} };
const ok = (name, pass, detail) => {
  result.checks[name] = { pass: !!pass, detail };
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
};

// a fake microphone: tone bursts
const wav = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'release-')), 'tone.wav');
{
  const fr = 48000;
  const n = fr * 20;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(fr, 24);
  buf.writeUInt32LE(fr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round((i / fr) % 2 < 1.4 ? 0.35 * 32767 * Math.sin((2 * Math.PI * 220 * i) / fr) : 0), 44 + i * 2);
  fs.writeFileSync(wav, buf);
}

// ---- the server, exactly as `pnpm start` runs it
const srv = spawn(process.execPath, ['dist/index.js'], {
  cwd: path.join(root, 'apps/server'),
  env: { ...process.env, NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1', LOG_LEVEL: 'warn' },
  stdio: ['ignore', 'inherit', 'inherit'],
});
const stop = () => srv.exitCode === null && srv.kill('SIGTERM');
process.on('exit', stop);
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(`${base}/health`)).ok) break;
  } catch {
    /* starting */
  }
  await new Promise((r) => setTimeout(r, 100));
}

// ---- 1. HTTP: headers, caching, 404s
{
  const r = await fetch(`${base}/`, { headers: { accept: 'text/html' } });
  const html = await r.text();
  ok('GET / serves the app', r.status === 200 && html.includes('<div id="root">'));
  ok('index.html not cached', r.headers.get('cache-control') === 'no-cache', r.headers.get('cache-control'));
  const csp = r.headers.get('content-security-policy') ?? '';
  ok('CSP: own scripts, ws connect, blob media, no eval', csp.includes("script-src 'self'") && csp.includes("connect-src 'self' ws: wss:") && csp.includes("media-src 'self' blob:") && !csp.includes('unsafe-eval'), csp);
  ok('Permissions-Policy allows the microphone for self', (r.headers.get('permissions-policy') ?? '').includes('microphone=(self)'), r.headers.get('permissions-policy'));
  const asset = /\/assets\/[^"']+\.js/.exec(html)?.[0];
  const a = await fetch(`${base}${asset}`, { headers: { 'accept-encoding': 'br, gzip' } });
  ok('hashed asset: immutable, precompressed', a.status === 200 && a.headers.get('cache-control') === 'public, max-age=31536000, immutable' && a.headers.get('content-encoding') === 'br', {
    asset,
    cache: a.headers.get('cache-control'),
    encoding: a.headers.get('content-encoding'),
  });
  const deep = await fetch(`${base}/room/release-test`, { headers: { accept: 'text/html' } });
  ok('deep link returns the app', deep.status === 200 && (await deep.text()).includes('<div id="root">'));
  const miss = await fetch(`${base}/nonexistent.js`, { headers: { accept: 'text/html' } });
  ok('unknown file is a 404', miss.status === 404, miss.status);
  const health = await fetch(`${base}/health`);
  ok('/health JSON', health.ok && (await health.json()).ok === true);
  const manifest = await fetch(`${base}/manifest.webmanifest`);
  ok('manifest named Speaker\'s Garage', manifest.ok && (await manifest.json()).name === "Speaker's Garage");
}

// ---- browsers
const gl = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ args: [...gl, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`] });
const denyBrowser = await chromium.launch({ args: [...gl, '--use-fake-device-for-media-stream', '--deny-permission-prompts'] });
const pageErrors = [];
const cspViolations = [];
async function open(b, name, url = base, grantMic = b === browser) {
  const ctx = await b.newContext({ viewport: { width: 900, height: 560 }, permissions: grantMic ? ['microphone'] : [] });
  const page = await ctx.newPage();
  page.setDefaultTimeout(240000);
  page.on('pageerror', (e) => pageErrors.push(`${name}: ${e.message}\n${(e.stack ?? '').split('\n').slice(0, 8).join('\n')}`));
  page.on('console', (m) => /Content Security Policy|Refused to/i.test(m.text()) && cspViolations.push(`${name}: ${m.text()}`));
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error(`Refused to load (CSP) ${e.violatedDirective} ${e.blockedURI}`)));
  await page.goto(url);
  return page;
}
async function enter(page, name, room) {
  await page.fill('input[placeholder="Your name"]', name);
  if (room) await page.fill('input[aria-label="Room name"]', room);
  await page.click('form button[type=submit]');
  await page.waitForSelector('[data-mic]', { timeout: 240000 });
}
const mic = (page) => page.locator('[data-mic]').getAttribute('data-mic');

const A = await open(browser, 'A');
ok('page title', (await A.title()) === "Speaker's Garage", await A.title());
const h1 = (await A.locator('h1').innerText()).replace(/\s+/g, ' ').trim();
ok('landing heading', h1 === "Speaker's Garage", h1);
ok('Enter button', (await A.locator('form button[type=submit]').innerText()).trim() === 'Enter the garage');
ok('mic checkbox on by default', await A.getByLabel(/Join with microphone on/).isChecked());
{
  // the hint shows when the browser will ask (permission not granted yet); A's context pre-grants it
  // a plain browser (no fake-UI flag, which reports the permission as already granted)
  const plain = await chromium.launch({ args: gl });
  const fresh = await open(plain, 'hint', base, false);
  await fresh.waitForTimeout(500);
  const state = await fresh.evaluate(async () => (await navigator.permissions.query({ name: 'microphone' })).state);
  const hint = await fresh.getByText(/Your browser will ask to use your microphone/).isVisible();
  const blocked = await fresh.getByText(/microphone is blocked for this site/).isVisible();
  // headless Chromium without prompts may report 'denied': then the "blocked, you will listen" note shows
  ok('pre-prompt hint matches the permission state', state === 'prompt' ? hint && !blocked : state === 'denied' ? blocked && !hint : !hint, { state, hint, blocked });
  ok('no hint once the microphone is allowed', !(await A.getByText(/Your browser will ask to use your microphone/).isVisible()));
  await plain.close();
}
ok('favicon', (await A.locator('link[rel=icon][type="image/svg+xml"]').getAttribute('href')) === '/favicon.svg');
await A.screenshot({ path: `${out}/1-landing.png` });

await enter(A, 'Ana', 'release');
const B = await open(browser, 'B');
await enter(B, 'Ben', 'release');
// voice: connected by itself (the HUD counts voice peers), mic live
await A.waitForFunction(() => /1 nearby/.test(document.body.innerText), null, { timeout: 120000 }).catch(() => undefined);
const nearbyA = (await A.locator('text=/\\d+ nearby/').first().innerText().catch(() => '')).trim();
ok('voice connected automatically (A has B as a voice peer)', nearbyA.startsWith('1 nearby'), nearbyA);
ok('A mic indicator live', (await mic(A)) === 'live', await mic(A));
ok('B mic indicator live', (await mic(B)) === 'live', await mic(B));
await A.screenshot({ path: `${out}/2-a-in-world-voice.png` });
await B.keyboard.press('m');
await B.waitForFunction(() => document.querySelector('[data-mic]')?.getAttribute('data-mic') === 'muted', null, { timeout: 10000 }).catch(() => undefined);
ok('M mutes (B indicator muted)', (await mic(B)) === 'muted', await mic(B));
await B.screenshot({ path: `${out}/3-b-muted.png` });
await B.keyboard.press('m');

// denied microphone: still enters, listen-only
const C = await open(denyBrowser, 'C');
await enter(C, 'Cid', 'release');
await C.waitForFunction(() => document.querySelector('[data-mic]')?.getAttribute('data-mic') === 'unavailable', null, { timeout: 60000 }).catch(() => undefined);
ok('denied: listen-only indicator', (await mic(C)) === 'unavailable', await mic(C));
const banner = (await C.getByTestId('mic-banner').innerText().catch(() => '')).replace(/\n/g, ' ');
ok('denied: banner with Retry microphone', /Retry microphone/.test(banner), banner);
await C.screenshot({ path: `${out}/4-c-denied.png` });

// deep link + refresh
const D = await open(browser, 'D', `${base}/room/deep-link`);
ok('deep link chooses the room', (await D.inputValue('input[aria-label="Room name"]')) === 'deep-link', await D.inputValue('input[aria-label="Room name"]'));
await D.reload();
ok('refresh on a deep link serves the app', (await D.title()) === "Speaker's Garage");
await enter(D, 'Dee');
await D.reload();
await D.waitForSelector('form button[type=submit]');
await enter(D, 'Dee');
ok('refresh in the world, enter again: back in the room', (await mic(D)) !== null);
await D.screenshot({ path: `${out}/5-d-after-refresh.png` });

ok('no CSP violations', cspViolations.length === 0, cspViolations.slice(0, 5));
ok('no page errors', pageErrors.length === 0, pageErrors.slice(0, 5));
if (pageErrors.length) console.log(pageErrors.join('\n---\n'));
fs.writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2));
const failed = Object.entries(result.checks).filter(([, c]) => !c.pass);
console.log(failed.length ? `\n${failed.length} check(s) failed` : '\nall checks passed');
await browser.close();
await denyBrowser.close();
stop();
process.exit(failed.length ? 1 : 0);

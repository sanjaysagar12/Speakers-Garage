// Performance measurement on a production build (with test hooks compiled in via VITE_PERF_HOOKS=1).
//
//   node scripts/perf.mjs --label baseline --quality med [--throttle 4] [--mobile] [--leak] [--no-build]
//
// Records: bytes transferred (landing / world), time to interactive, time to first world frame,
// FPS (avg, 1% low) and frame time over 30 s of walking, renderer.info (draw calls, triangles, geometries,
// textures), JS heap after 2 minutes, and optionally a 5x leave/enter leak check.
// Results: perf-results/<label>.json. NOTE: headless Chromium renders with SwiftShader (software GL), so FPS
// is far below real hardware; use it for before/after comparison, not as an absolute device number.
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import fs from 'node:fs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i < 0 ? d : process.argv[i + 1];
};
const flag = (k) => process.argv.includes(`--${k}`);
const label = arg('label', 'run');
const quality = arg('quality', 'med');
const throttle = Number(arg('throttle', '4'));
const mobile = flag('mobile');
const leak = flag('leak');
const walkSeconds = Number(arg('walk', '30'));
const heapAt = Number(arg('heapAt', '120'));
const outDir = '.perf-dist';

if (!flag('no-build')) {
  process.env.VITE_PERF_HOOKS = '1';
  await build({ logLevel: 'error', build: { outDir, emptyOutDir: true } });
}
const server = await preview({ logLevel: 'error', build: { outDir }, preview: { port: 4179, host: '127.0.0.1', strictPort: false } });
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'],
});
const ctx = await browser.newContext(
  mobile
    ? { viewport: { width: 412, height: 860 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 12; Pixel 4a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36' }
    : { viewport: { width: 1280, height: 720 } },
);
const page = await ctx.newPage();
page.setDefaultTimeout(600000);
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
let bytes = 0;
cdp.on('Network.loadingFinished', (e) => (bytes += e.encodedDataLength));
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const now = () => Date.now();
const t0 = now();
await page.goto(url);
await page.waitForFunction(() => window.__store, null, { timeout: 600000 });
await page.waitForSelector('form button[type=submit]', { state: 'visible' });
const tti = now() - t0;
await page.waitForTimeout(3000);
const landingBytes = bytes;
await page.evaluate((q) => window.__store.getState().setUi({ quality: q, hintOpen: false }), quality);

const t1 = now();
await page.click('form button[type=submit]');
await page.waitForFunction(() => window.__game, null, { timeout: 600000 });
// first rendered world frame
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const worldReady = now() - t1;
await page.waitForTimeout(3000);
const worldBytes = bytes - landingBytes;

/** frame deltas for `ms` milliseconds */
const sampleFrames = (ms) =>
  page.evaluate(
    (dur) =>
      new Promise((resolve) => {
        const d = [];
        let last = performance.now();
        const start = last;
        const f = (t) => {
          d.push(t - last);
          last = t;
          if (t - start < dur) requestAnimationFrame(f);
          else resolve(d);
        };
        requestAnimationFrame(f);
      }),
    ms,
  );
const stats = (d) => {
  const s = [...d].sort((a, b) => a - b);
  const avg = s.reduce((a, b) => a + b, 0) / s.length;
  const p99 = s[Math.min(s.length - 1, Math.floor(s.length * 0.99))];
  return { frames: s.length, avgFps: +(1000 / avg).toFixed(1), low1Fps: +(1000 / p99).toFixed(1), avgFrameMs: +avg.toFixed(1), p99FrameMs: +p99.toFixed(1) };
};

// walk: forward then back, with a camera sweep, for walkSeconds
const half = (walkSeconds * 1000) / 2;
await page.keyboard.down('w');
const framesA = sampleFrames(half);
const infoMid = await page.evaluate(() => window.__game.renderInfo());
const fa = await framesA;
await page.keyboard.up('w');
await page.keyboard.down('s');
const fb = await sampleFrames(half);
await page.keyboard.up('s');
const walk = stats([...fa, ...fb]);
const info = await page.evaluate(() => window.__game.renderInfo());

// heap after `heapAt` seconds in the world
const inWorld = now() - t1;
if (heapAt * 1000 > inWorld) await page.waitForTimeout(heapAt * 1000 - inWorld);
await cdp.send('HeapProfiler.collectGarbage');
const heapMB = await page.evaluate(() => +(performance.memory.usedJSHeapSize / 1048576).toFixed(1));

let leakRuns = null;
if (leak) {
  leakRuns = [];
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.__store.getState().leaveWorld());
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.__store.getState().enterWorld());
    await page.waitForFunction(() => window.__game, null, { timeout: 600000 });
    await page.waitForTimeout(5000);
    await cdp.send('HeapProfiler.collectGarbage');
    const h = await page.evaluate(() => +(performance.memory.usedJSHeapSize / 1048576).toFixed(1));
    const ri = await page.evaluate(() => window.__game.renderInfo());
    leakRuns.push({ heapMB: h, geometries: ri.geometries, textures: ri.textures, programs: ri.programs });
  }
}

const result = {
  label,
  quality,
  throttle,
  viewport: mobile ? 'mobile 412x860 @2.6' : 'desktop 1280x720',
  renderer: 'SwiftShader (software GL, headless)',
  timeToInteractiveMs: tti,
  worldReadyMs: worldReady,
  transferKB: { landing: Math.round(landingBytes / 1024), world: Math.round(worldBytes / 1024) },
  walk,
  render: { ...info, callsMidWalk: infoMid.calls },
  heapAfterMB: heapMB,
  heapAtSeconds: heapAt,
  leak: leakRuns,
  errors: [...new Set(errors)],
};
fs.mkdirSync('perf-results', { recursive: true });
fs.writeFileSync(`perf-results/${label}.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
await new Promise((r) => server.httpServer.close(r));

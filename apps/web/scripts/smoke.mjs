// Smoke test: load -> enter world -> walk onto the pier -> open the wardrobe -> cycle quality tiers -> leave.
//   node scripts/smoke.mjs              dev server
//   node scripts/smoke.mjs --preview    production build (with test hooks) served by vite preview
// Prints each step, the auto-detected tier and any page errors; exits 1 on errors.
import { build, createServer, preview } from 'vite';
import { chromium } from 'playwright';

const prod = process.argv.includes('--preview');
let server;
if (prod) {
  process.env.VITE_PERF_HOOKS = '1';
  await build({ logLevel: 'error', build: { outDir: '.perf-dist', emptyOutDir: true } });
  server = await preview({ logLevel: 'error', build: { outDir: '.perf-dist' }, preview: { port: 5195, host: '127.0.0.1' } });
} else {
  server = await createServer({ server: { port: 5194, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
}
console.log(prod ? 'production build (vite preview)' : 'dev server');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.setDefaultTimeout(300000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const step = (s) => console.log(`- ${s}`);
await page.goto(server.resolvedUrls.local[0]);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__store);
step('landing loaded');
await page.click('form button[type=submit]');
await page.waitForFunction(() => window.__game);
const tier = await page.evaluate(() => window.__store.getState().ui.quality);
step(`entered world, auto tier = ${tier}`);
const pier = (await page.evaluate(() => window.__game.pier()))[0];
await page.evaluate(([x, z, r]) => window.__game.teleport(x + Math.sin(r) * 6, z + Math.cos(r) * 6, r), [pier.x, pier.z, pier.rot]);
// the camera yaw is limited to ±60°, so it can't face out along this pier: with yaw 0, S walks south, i.e.
// outward along the pier (sliding along its rails). Movement runs in real time at any frame rate.
await page.evaluate(() => window.__game.setYaw(0));
await page.keyboard.down('s');
await page.waitForTimeout(3000);
await page.keyboard.up('s');
const s = await page.evaluate(() => window.__game.state());
step(`on the pier: onDeck=${s.onDeck} y=${s.y.toFixed(2)}`);
await page.click('button[aria-label="Wardrobe"]');
await page.waitForSelector('[aria-label="Wardrobe"][role="dialog"]');
step('wardrobe opened');
await page.keyboard.press('Escape');
for (const q of ['ultralow', 'low', 'med', 'high']) {
  await page.evaluate((m) => window.__store.getState().setUi({ qualityMode: m, quality: m }), q);
  // a tier switch rebuilds props and recompiles shaders: wait until the renderer is back to one render per frame
  await page.waitForTimeout(8000);
  const info = await page.evaluate(() => window.__game.renderInfo());
  step(`tier ${q}: ${info.calls} calls, ${info.triangles} tris`);
}
await page.evaluate(() => window.__store.getState().leaveWorld());
await page.waitForTimeout(2000);
step('left the world');
// without a game server running, the online attempt fails once and the game falls back to offline
const real = [...new Set(errors)].filter((e) => !/toArray/.test(e) && !/WebSocket connection to .*\/ws' failed/.test(e));
console.log(real.length ? `ERRORS:\n${real.join('\n')}` : 'no errors (ignoring the known startup toArray warning)');
await browser.close();
await (prod ? new Promise((r) => server.httpServer.close(r)) : server.close());
process.exit(real.length ? 1 : 0);

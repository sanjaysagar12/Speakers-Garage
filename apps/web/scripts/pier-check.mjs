// In-game pier check: walks the real game on the pier with the F3 overlay on and saves screenshots.
//   node scripts/pier-check.mjs  ->  pier-check/*.png (+ positions printed)
import { createServer } from 'vite';
import { chromium } from 'playwright';
import fs from 'node:fs';

const out = 'pier-check';
fs.mkdirSync(out, { recursive: true });
const server = await createServer({ server: { port: 5197, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.setDefaultTimeout(240000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(server.resolvedUrls.local[0]);
await page.waitForFunction(() => window.__store, null, { timeout: 120000 });
await page.evaluate(() => window.__store.getState().setUi({ quality: 'low' }));
await page.click('text=Enter the valley');
await page.waitForFunction(() => window.__game, null, { timeout: 240000 });
await page.evaluate(() => window.__store.getState().setUi({ hintOpen: false, debug: true }));
const pier = (await page.evaluate(() => window.__game.pier()))[0];
const at = (u, v) => ({ x: pier.x + u * Math.cos(pier.rot) + v * Math.sin(pier.rot), z: pier.z - u * Math.sin(pier.rot) + v * Math.cos(pier.rot) });
const cases = [
  ['entrance_W_yaw0', 1.2, 0, ['w']],
  ['middle_W_yaw60', 12, 60, ['w']],
  ['middle_S_yaw-60_run', 12, -60, ['Shift', 's']],
  ['middle_D_yaw0_run', 12, 0, ['Shift', 'd']],
];
for (const [name, v, yaw, keys] of cases) {
  const p = at(0, v);
  await page.evaluate(([x, z, f, y]) => { window.__game.teleport(x, z, f); window.__game.setYaw(y); }, [p.x, p.z, pier.rot, yaw]);
  await page.waitForTimeout(1500);
  const track = [];
  for (const k of keys) await page.keyboard.down(k);
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(700);
    track.push(await page.evaluate(() => window.__game.state()));
  }
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 240000 });
  for (const k of keys) await page.keyboard.up(k);
  const off = track.filter((s) => !s.onDeck);
  console.log(name, off.length ? `LEFT THE DECK at ${off.map((s) => `(${s.x.toFixed(1)},${s.z.toFixed(1)})`).join(' ')}` : 'stayed on deck', track.map((s) => `(${s.x.toFixed(1)},${s.z.toFixed(1)} y${s.y.toFixed(2)})`).join(' '));
}
if (errors.length) console.log('page errors:', errors.slice(0, 5));
await browser.close();
await server.close();

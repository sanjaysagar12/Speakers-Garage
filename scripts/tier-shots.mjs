// Same-spot screenshots per quality tier for visual comparison.
//   node scripts/tier-shots.mjs <outDir> high,med,low,ultralow
import { createServer } from 'vite';
import { chromium } from 'playwright';
import fs from 'node:fs';

const out = process.argv[2] ?? 'tier-shots';
const tiers = (process.argv[3] ?? 'high').split(',');
fs.mkdirSync(out, { recursive: true });
const server = await createServer({ root: process.cwd(), server: { port: 5193, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(600000);
await page.goto(server.resolvedUrls.local[0]);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__store);
const first = tiers[0];
await page.evaluate((q) => window.__store.getState().setUi({ quality: q, qualityMode: q, hintOpen: false }), first);
await page.click('form button[type=submit]');
await page.waitForFunction(() => window.__game);
const pier = (await page.evaluate(() => window.__game.pier()))[0];
const spots = [
  { name: 'umbrellas', x: 55.1, z: 55.6, yaw: 0 },
  { name: 'pier', x: pier.x - Math.sin(pier.rot) * 3, z: pier.z - Math.cos(pier.rot) * 3, yaw: -40 },
  { name: 'grove', x: 30, z: 28, yaw: 30 },
];
for (const t of tiers) {
  await page.evaluate((q) => window.__store.getState().setUi({ quality: q, qualityMode: q }), t);
  for (const s of spots) {
    await page.evaluate(([x, z, y]) => {
      window.__game.teleport(x, z, Math.PI);
      window.__game.setYaw(y);
    }, [s.x, s.z, s.yaw]);
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `${out}/${t}-${s.name}.png`, timeout: 600000 });
    console.log('shot', t, s.name);
  }
}
await browser.close();
await server.close();

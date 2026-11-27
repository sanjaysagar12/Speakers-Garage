// View-angle contact sheets: every prop and character from the game camera at yaw -60/0/+60.
//   npm run shots                  -> all entries, writes shots/sheet-NN.png
//   npm run shots -- char:         -> only entries whose key contains "char:"
// Starts its own Vite dev server, drives /?shots with Playwright (software GL), composes sheets with sharp.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const filter = process.argv[2] ?? '';
const outDir = path.resolve('shots');
fs.mkdirSync(outDir, { recursive: true });
const YAWS = [-60, 0, 60];
const TW = 420;
const TH = 315;
const ROWS_PER_SHEET = 6;

const server = await createServer({ server: { port: 5199, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: TW * 2, height: TH * 2 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`${url}?shots`);
await page.waitForFunction(() => window.__shots, null, { timeout: 60000 });
const filters = filter.split(',');
const keys = (await page.evaluate(() => window.__shots.keys)).filter((k) => filters.some((f) => k.includes(f)));
console.log(`${keys.length} entries x ${YAWS.length} yaws`);

const rows = [];
for (const key of keys) {
  const tiles = [];
  for (const yaw of YAWS) {
    await page.evaluate(([k, y]) => window.__shots.show(k, y), [key, yaw]);
    const buf = await page.locator('canvas').screenshot();
    if (process.env.SHOTS_RAW) fs.writeFileSync(path.join(outDir, `raw-${key.replace(/[^a-z0-9_#-]/gi, '_')}-${yaw}.png`), buf);
    tiles.push(await sharp(buf).resize(TW, TH).png().toBuffer());
  }
  rows.push({ key, tiles });
  process.stdout.write('.');
}
console.log();

const label = (text) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${TW}" height="26"><rect width="100%" height="100%" fill="rgba(0,0,0,0.55)"/><text x="8" y="18" font-family="sans-serif" font-size="15" fill="#fff">${text}</text></svg>`);
for (let s = 0; s * ROWS_PER_SHEET < rows.length; s++) {
  const chunk = rows.slice(s * ROWS_PER_SHEET, (s + 1) * ROWS_PER_SHEET);
  const comps = [];
  chunk.forEach((row, ri) => {
    row.tiles.forEach((t, ci) => {
      comps.push({ input: t, left: ci * TW, top: ri * TH });
      comps.push({ input: label(`${row.key}  yaw ${YAWS[ci]}°`), left: ci * TW, top: ri * TH });
    });
  });
  const file = path.join(outDir, `sheet-${String(s + 1).padStart(2, '0')}.png`);
  await sharp({ create: { width: TW * YAWS.length, height: TH * chunk.length, channels: 3, background: '#333' } })
    .composite(comps)
    .png()
    .toFile(file);
  console.log('wrote', file);
}
if (errors.length) console.log('page errors:\n' + errors.slice(0, 10).join('\n'));
await browser.close();
await server.close();

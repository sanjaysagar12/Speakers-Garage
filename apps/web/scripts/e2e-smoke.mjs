// Dev smoke test: node scripts/e2e-smoke.mjs <outDir> [port]
import { chromium } from 'playwright';

const out = process.argv[2] ?? '.';
const port = process.argv[3] ?? '5173';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 820 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|WebGL/i.test(m.text()))) {
    errors.push(`${m.type()}: ${m.text()}`);
  }
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const pos = () =>
  page.evaluate(() => {
    const s = window.__store.getState();
    return { x: Math.round(s.position.x), y: Math.round(s.position.y), near: s.nearby?.id ?? null, dialog: s.dialog?.title ?? null };
  });
const hold = async (k, ms) => {
  await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  await page.keyboard.up(k);
};

await page.goto(`http://localhost:${port}/`);
await page.waitForTimeout(2600);
await page.screenshot({ path: `${out}/01_landing.png` });

// exercise the customizer: switch slot, pick an option
await page.click('button[title="Cloak"]');
await page.waitForTimeout(500);
const thumbs = await page.$$('button[aria-pressed]');
if (thumbs[2]) await thumbs[2].click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/02_customizer.png` });

await page.fill('input[maxlength="18"]', 'Thorfinn');
await page.click('text=Enter the garage');
await page.waitForTimeout(7000);
console.log('spawn', await pos());
await page.screenshot({ path: `${out}/03_world.png` });

const fps = await page.evaluate(
  () =>
    new Promise((r) => {
      let n = 0;
      const t0 = performance.now();
      const f = () => {
        n++;
        performance.now() - t0 < 2000 ? requestAnimationFrame(f) : r(Math.round(n / 2));
      };
      f();
    }),
);
console.log('fps (software GL)', fps);

await hold('d', 1800);
await hold('s', 1200);
console.log('after move', await pos());
await page.screenshot({ path: `${out}/04_moved.png` });

await page.keyboard.down('Shift');
await hold('a', 6500);
await page.keyboard.up('Shift');
console.log('after run west', await pos());
await page.screenshot({ path: `${out}/05_run.png` });

console.log(errors.slice(0, 12).join('\n') || 'no console errors');
await browser.close();

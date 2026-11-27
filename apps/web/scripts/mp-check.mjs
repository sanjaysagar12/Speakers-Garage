// Two real browsers in one room against the real game server.
//
//   node scripts/mp-check.mjs [--out mp-check] [--latency 0] [--jitter 0] [--loss 0] [--seconds 6]
//
// Starts apps/server (tsx, port 8787) and the Vite dev server (which proxies /ws), opens browsers A and B,
// both join room "mp-check". B walks a scripted route; A records, every frame, where it renders B. Reports:
//   - smoothness of B as seen by A: per-frame step sizes, jerk (frame-to-frame change of velocity), hitches
//   - how far A's view of B lags B's own position (render delay)
//   - B's prediction error (reconciliation corrections) and the server-side truth
// Optional network simulation for both players: a TCP proxy between the dev server and the game server
// adds latency (added round trip, split over both directions), jitter (random extra one-way delay) and
// loss. DevTools throttling does not apply to WebSocket frames, hence the proxy. WebSockets run over TCP,
// so a lost segment is retransmitted: modelled as a ~200 ms+ stall of that direction (head-of-line
// blocking), which is what players on a lossy network actually experience.
import { spawn } from 'node:child_process';
import { createServer as createTcpServer, connect as tcpConnect } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i < 0 ? d : process.argv[i + 1];
};
const out = arg('out', 'mp-check');
const latency = Number(arg('latency', '0'));
const jitter = Number(arg('jitter', '0'));
const loss = Number(arg('loss', '0'));
const seconds = Number(arg('seconds', '6'));
fs.mkdirSync(out, { recursive: true });

const serverDir = path.resolve('../server');
const srv = spawn(path.join(serverDir, 'node_modules/.bin/tsx'), ['--conditions=source', 'src/index.ts'], {
  cwd: serverDir,
  env: { ...process.env, PORT: '8787', HOST: '127.0.0.1', NODE_ENV: 'development', LOG_LEVEL: process.env.MP_LOG ?? 'warn' },
  stdio: ['ignore', 'inherit', 'inherit'],
  detached: true, // own process group: tsx starts a child node process; kill the whole group
});
const killServer = () => {
  try {
    process.kill(-srv.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
};
process.on('exit', killServer);
process.on('uncaughtException', (e) => {
  console.error(e);
  killServer();
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  console.error(e);
  killServer();
  process.exit(1);
});
const waitHealth = async () => {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch('http://127.0.0.1:8787/health')).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
};
await waitHealth();
// TCP proxy with latency / jitter / loss (order-preserving per direction)
let proxyStats = { chunks: 0, stalls: 0 };
if (latency || jitter || loss) {
  const delayFor = () => latency / 2 + Math.random() * jitter;
  const pipe = (from, to) => {
    let lastAt = 0;
    from.on('data', (chunk) => {
      proxyStats.chunks++;
      let at = Date.now() + delayFor();
      if (loss && Math.random() < loss / 100) {
        at += Math.max(200, latency * 1.5); // retransmission timeout
        proxyStats.stalls++;
      }
      at = Math.max(at, lastAt); // TCP delivers in order
      lastAt = at;
      setTimeout(() => !to.destroyed && to.write(chunk), at - Date.now());
    });
    from.on('close', () => setTimeout(() => to.destroy(), Math.max(0, lastAt - Date.now()) + 5));
    from.on('error', () => to.destroy());
  };
  await new Promise((res) =>
    createTcpServer((client) => {
        client.setNoDelay(true);
        const up = tcpConnect(8787, '127.0.0.1');
        up.setNoDelay(true);
        pipe(client, up);
        pipe(up, client);
    }).listen(8788, '127.0.0.1', res),
  );
  process.env.GAME_SERVER = 'http://127.0.0.1:8788';
  console.log(`network: +${latency} ms RTT, up to +${jitter} ms jitter per direction, ${loss}% loss`);
}
const vite = await createServer({ server: { port: 5196, host: '127.0.0.1', strictPort: true }, logLevel: 'error' });
await vite.listen();
const url = vite.resolvedUrls.local[0];

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 400 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(300000);
  if (process.env.MP_TRACE_CLOSE)
    await page.addInitScript(() => {
      const orig = WebSocket.prototype.close;
      WebSocket.prototype.close = function (code, reason) {
        const log = JSON.parse(sessionStorage.getItem('closelog') ?? '[]');
        log.push({ at: Date.now(), code, reason, stack: new Error().stack.split('\n').slice(1, 10).map((l) => l.trim().replace(/\?v=\w+/, '').replace(/http:\/\/127.0.0.1:5196/, '')).join(' | ') });
        sessionStorage.setItem('closelog', JSON.stringify(log));
        return orig.call(this, code, reason);
      };
    });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/toArray/.test(m.text()) && errors.push(`${name} console: ${m.text()}`));
  await page.goto(url);
  await page.waitForFunction(() => window.__store);
  await page.evaluate((n) => {
    const s = window.__store.getState();
    s.setName(n);
    s.setOnline(true);
    s.setRoom('mp-check');
    s.setUi({ hintOpen: false, qualityMode: 'ultralow', quality: 'ultralow' });
  }, name);
  await page.click('form button[type=submit]');
  (await page.waitForFunction(() => window.__game && window.__game.net().status === 'online', null, { timeout: 300000 })).dispose();
  return page;
}

const A = await player('Ana');
const B = await player('Ben');
const bId = await B.evaluate(() => window.__game.net().selfId);
console.log(`A and B online in room mp-check; B is entity ${bId}`);
// wait until A has B interpolating
await A.waitForFunction((id) => window.__game.remotes().some((r) => r.id === id && r.ready), bId, { timeout: 60000 });
await A.screenshot({ path: `${out}/a-sees-b-idle.png` });

// social: B says hello and waves; A should get the chat line and see the bubble + wave
await B.keyboard.press('t');
await B.keyboard.type('hello from Ben <b>!</b>');
await B.keyboard.press('Enter');
await B.keyboard.press('1');
await A.waitForFunction(() => window.__store.getState().chat.some((l) => l.name === 'Ben'), null, { timeout: 10000 });
const chatLine = await A.evaluate(() => window.__store.getState().chat.find((l) => l.name === 'Ben').text);
await A.waitForTimeout(1200);
const bAnim = await A.evaluate((id) => window.__game.remotes().find((r) => r.id === id)?.anim ?? -1, bId);
await A.screenshot({ path: `${out}/a-sees-b-chat-wave.png` });
console.log(`A got chat "${chatLine}", B's animation byte as seen by A: ${bAnim} (emote ${bAnim >> 4})`);

// A records B every animation frame while B walks: forward, turn, run
const rec = A.evaluate(
  ([id, ms]) =>
    new Promise((resolve) => {
      const samples = [];
      const t0 = performance.now();
      const f = () => {
        const r = window.__game.remotes().find((e) => e.id === id);
        if (r) samples.push({ t: performance.now() - t0, x: r.x, z: r.z, speed: r.speed });
        if (performance.now() - t0 < ms) requestAnimationFrame(f);
        else resolve(samples);
      };
      requestAnimationFrame(f);
    }),
  [bId, seconds * 1000],
);
const bTrack = [];
const bStart = Date.now();
const route = [
  ['w', 1500],
  ['d', 800],
  ['w', 1200],
  ['Shift+w', 1500],
];
const bPoll = setInterval(async () => {
  try {
    const s = await B.evaluate(() => ({ ...window.__game.self(), err: window.__game.net().netError }));
    bTrack.push({ t: Date.now() - bStart, ...s });
  } catch {
    /* page busy */
  }
}, 100);
for (const [key, ms] of route) {
  const keys = key.split('+');
  for (const k of keys) await B.keyboard.down(k === 'Shift' ? 'Shift' : k);
  await B.waitForTimeout(ms);
  for (const k of keys.reverse()) await B.keyboard.up(k === 'Shift' ? 'Shift' : k);
}
const samples = await rec;
clearInterval(bPoll);
await A.screenshot({ path: `${out}/a-sees-b-after-walk.png` });
await B.screenshot({ path: `${out}/b-view.png` });

// reconnect: B reloads the page and must come back as the same player
const roster = await A.evaluate(() => window.__store.getState().net.players.map((p) => p.name).sort().join(','));
const tokenBefore = await B.evaluate(() => sessionStorage.getItem('shoreline.resume.v1'));
await B.reload();
const tokenAfterReload = await B.evaluate(() => sessionStorage.getItem('shoreline.resume.v1'));
console.log(`B token before reload ${tokenBefore}\nB token after reload  ${tokenAfterReload}`);
if (process.env.MP_TRACE_CLOSE) console.log('B close calls:', await B.evaluate(() => sessionStorage.getItem('closelog')));
await B.waitForFunction(() => window.__store);
await B.evaluate(() => window.__store.getState().setUi({ hintOpen: false, qualityMode: 'ultralow', quality: 'ultralow' }));
await B.click('form button[type=submit]');
(await B.waitForFunction(() => window.__game && window.__game.net().status === 'online', null, { timeout: 300000 })).dispose();
const bIdAfter = await B.evaluate(() => window.__game.net().selfId);
console.log(`B reloaded: id ${bId} -> ${bIdAfter} (${bId === bIdAfter ? 'resumed' : 'NEW PLAYER'}); A's roster before: ${roster}`);

// smoothness: per-frame displacement and jerk of B as A renders it
const steps = [];
for (let i = 1; i < samples.length; i++) {
  const dt = (samples[i].t - samples[i - 1].t) / 1000;
  if (dt <= 0) continue;
  steps.push({ dt, v: Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z) / dt });
}
const moving = steps.filter((s) => s.v > 0.3);
const maxRendered = Math.max(0, ...steps.map((s) => s.v));
const vs = moving.map((s) => s.v).sort((a, b) => a - b);
const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);
// a "hitch": the rendered speed jumps above 2x run speed or drops to ~0 while moving between moving frames
let hitches = 0;
for (let i = 1; i < steps.length - 1; i++) if (steps[i - 1].v > 1 && steps[i + 1].v > 1 && (steps[i].v < 0.2 || steps[i].v > 13)) hitches++;
const net = { A: await A.evaluate(() => window.__game.net()), B: await B.evaluate(() => window.__game.net()) };
const bDist = bTrack.length > 1 ? Math.hypot(bTrack.at(-1).x - bTrack[0].x, bTrack.at(-1).z - bTrack[0].z) : 0;
const maxErr = Math.max(0, ...bTrack.map((s) => s.err));
const landing = await browser.newPage({ viewport: { width: 900, height: 1100 } });
await landing.goto(url);
await landing.waitForTimeout(2500);
await landing.screenshot({ path: `${out}/landing-rooms.png` });
const result = {
  proxy: proxyStats,
  chat: chatLine,
  bEmoteSeenByA: bAnim >> 4,
  resumedSameId: bId === bIdAfter,
  network: { latencyMs: latency, jitterMs: jitter, lossPct: loss },
  frames: samples.length,
  avgFrameMs: +(samples.at(-1).t / samples.length).toFixed(1),
  bWalkedMeters: +bDist.toFixed(2),
  remoteSpeedAsSeenByA: { median: +pct(vs, 0.5).toFixed(2), p05: +pct(vs, 0.05).toFixed(2), p95: +pct(vs, 0.95).toFixed(2) },
  hitches,
  maxRenderedSpeed: +maxRendered.toFixed(2),
  interpolationDelayMs: Math.round(net.A.delay),
  jitterMs: +net.A.jitter.toFixed(1),
  rttMs: { A: Math.round(net.A.rtt), B: Math.round(net.B.rtt) },
  bMaxCorrectionM: +maxErr.toFixed(4),
  bytes: { A: { in: net.A.bytesIn, out: net.A.bytesOut }, B: { in: net.B.bytesIn, out: net.B.bytesOut } },
  errors: [...new Set(errors)],
};
fs.writeFileSync(`${out}/result.json`, JSON.stringify({ ...result, samples }, null, 1));
console.log(JSON.stringify(result, null, 2));
await browser.close();
await vite.close();
killServer();
process.exit(errors.length ? 1 : 0);

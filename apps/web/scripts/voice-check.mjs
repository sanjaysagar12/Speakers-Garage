// Proximity voice between two real browsers (Chromium with a fake microphone) and the real server.
//
//   node scripts/voice-check.mjs [--out voice-check]
//
// A and B enter one room next to each other; voice joins by itself on "Enter" (no autoplay override:
// the Enter click must unlock audio). Checks:
//   0. both are in voice with the microphone live, audio running, without clicking anything else
//   1. a peer connection comes up (A has B as a voice peer, state connected)
//   2. speaking: B's fake mic plays tone bursts; A's analysis of B's stream marks B as speaking
//   3. mute: B presses M; B's mic is not live and A stops seeing B speak
//   4. distance: B runs away; beyond the disconnect radius (15 m) the peer is closed on both sides
//   5. denied: C's browser refuses the microphone; C still enters, joins listen-only, sees the banner
// Screenshots are saved at each step. The fake mic is a generated WAV (tone bursts), so "speech" is
// deterministic.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i < 0 ? d : process.argv[i + 1];
};
const out = arg('out', 'voice-check');
fs.mkdirSync(out, { recursive: true });

// 30 s of 220 Hz tone, 1.4 s on / 0.6 s off, 16-bit mono 48 kHz
const wav = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'voice-')), 'tone.wav');
{
  const fr = 48000;
  const n = fr * 30;
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
  for (let i = 0; i < n; i++) {
    const t = i / fr;
    const a = t % 2 < 1.4 ? 0.35 : 0;
    buf.writeInt16LE(Math.round(a * 32767 * Math.sin(2 * Math.PI * 220 * t)), 44 + i * 2);
  }
  fs.writeFileSync(wav, buf);
}

const serverDir = path.resolve('../server');
const srv = spawn(path.join(serverDir, 'node_modules/.bin/tsx'), ['--conditions=source', 'src/index.ts'], {
  cwd: serverDir,
  env: { ...process.env, PORT: '8787', HOST: '127.0.0.1', NODE_ENV: 'development', LOG_LEVEL: 'warn' },
  stdio: ['ignore', 'inherit', 'inherit'],
  detached: true,
});
const killServer = () => {
  try {
    process.kill(-srv.pid, 'SIGTERM');
  } catch {
    /* gone */
  }
};
process.on('exit', killServer);
for (const ev of ['uncaughtException', 'unhandledRejection'])
  process.on(ev, (e) => {
    console.error(e);
    killServer();
    process.exit(1);
  });
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch('http://127.0.0.1:8787/health')).ok) break;
  } catch {
    /* starting */
  }
  await new Promise((r) => setTimeout(r, 100));
}
const vite = await createServer({ server: { port: 5197, host: '127.0.0.1', strictPort: true }, logLevel: 'error' });
await vite.listen();
const url = vite.resolvedUrls.local[0];

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${wav}`,
  ],
});
// a browser that refuses the microphone prompt
const denyBrowser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', '--deny-permission-prompts'] });
const errors = [];
async function player(name, b = browser) {
  const ctx = await b.newContext({ viewport: { width: 760, height: 460 }, permissions: b === browser ? ['microphone'] : [] });
  const page = await ctx.newPage();
  page.setDefaultTimeout(300000);
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(url);
  await page.waitForFunction(() => window.__store);
  await page.evaluate((n) => {
    const s = window.__store.getState();
    s.setName(n);
    s.setOnline(true);
    s.setRoom('voice-check');
    s.setUi({ hintOpen: false, qualityMode: 'med', quality: 'med' });
  }, name);
  await page.click('form button[type=submit]');
  (await page.waitForFunction(() => window.__game && window.__game.net().status === 'online', null, { timeout: 300000 })).dispose();
  return page;
}
const A = await player('Ana');
const B = await player('Ben');
const bId = await B.evaluate(() => window.__game.net().selfId);
const dist = async () => {
  const a = await A.evaluate(() => window.__game.self());
  const b = await B.evaluate(() => window.__game.self());
  return +Math.hypot(a.x - b.x, a.z - b.z).toFixed(2);
};
console.log(`A and B online, ${await dist()} m apart`);
const step = (s) => console.log(`- ${s}`);
const result = {};

for (const P of [A, B]) await P.waitForFunction(() => window.__store.getState().voice.joined && window.__store.getState().voice.mic === 'live', null, { timeout: 60000 });
result.autoJoined = true;
result.soundBlocked = await A.evaluate(() => window.__store.getState().voice.soundBlocked);
result.indicatorA = await A.locator('[data-mic]').getAttribute('data-mic');
step(`both joined voice on Enter with the mic live (indicator "${result.indicatorA}", sound blocked: ${result.soundBlocked})`);

// 1. connection
if (process.env.VOICE_DEBUG) {
  await A.waitForTimeout(8000);
  for (const [n, P] of [['A', A], ['B', B]])
    console.log(
      n,
      await P.evaluate(() => {
        const v = window.__voice;
        return JSON.stringify({ peers: [...v.peers.keys()], retry: [...v.retryAfter], selfId: v.opts.selfId(), me: v.opts.selfPos(), maxPeers: v.opts.maxPeers, timers: v.timers.length, remotes: window.__game.remotes?.() });
      }),
    );
}
const t0 = Date.now();
await A.waitForFunction((id) => window.__store.getState().voice.peers.some((p) => p.id === id && p.quality !== 'connecting'), bId, { timeout: 60000 });
result.connectMs = Date.now() - t0;
result.peersA = await A.evaluate(() => window.__store.getState().voice.peers);
step(`peer connected in ${result.connectMs} ms: ${JSON.stringify(result.peersA)}`);

// 2. speaking: A sees B speaking (from A's analysis of B's audio)
await A.waitForFunction((id) => window.__store.getState().net.players.some((p) => p.id === id && p.speaking), bId, { timeout: 30000 });
result.aSeesBSpeaking = true;
result.bMicLive = await B.evaluate(() => window.__store.getState().voice.micLive);
await A.screenshot({ path: `${out}/1-a-sees-b-speaking.png` });
step(`A sees B speaking; B mic live: ${result.bMicLive}`);

// 3. mute
await B.keyboard.press('m');
await B.waitForFunction(() => !window.__store.getState().voice.micLive, null, { timeout: 10000 });
await A.waitForTimeout(2500);
let speakingAfterMute = 0;
for (let i = 0; i < 10; i++) {
  speakingAfterMute += await A.evaluate((id) => (window.__store.getState().net.players.find((p) => p.id === id)?.speaking ? 1 : 0), bId);
  await A.waitForTimeout(200);
}
result.speakingSamplesAfterMute = speakingAfterMute;
result.serverSaysBMuted = await A.evaluate((id) => window.__store.getState().net.players.find((p) => p.id === id)?.muted, bId);
await B.screenshot({ path: `${out}/2-b-muted.png` });
step(`B muted: A saw B speaking in ${speakingAfterMute}/10 samples afterwards; server says muted: ${result.serverSaysBMuted}`);
await B.keyboard.press('m');

// 4. distance: B runs away until the peer drops
let dropped = false;
// walk away by clicking far points on screen (the click-to-walk path goes around palms and umbrellas)
const targets = [[300, 120], [80, 250], [520, 380], [300, 120], [700, 300], [80, 250]];
for (let i = 0; i < 72 && !dropped; i++) {
  if (i % 12 === 0) await B.mouse.click(...targets[(i / 12) % targets.length]);
  await B.waitForTimeout(500);
  dropped = await A.evaluate((id) => !window.__store.getState().voice.peers.some((p) => p.id === id), bId);
  if (dropped) result.dropDistance = await dist();
}
result.droppedWhenFar = dropped;
result.distanceAfterRun = await dist();
result.bPeersAfter = await B.evaluate(() => window.__store.getState().voice.peers.length);
await A.screenshot({ path: `${out}/3-a-after-b-left.png` });
step(`after running away: dropped=${dropped} at ${result.dropDistance} m (B has ${result.bPeersAfter} peers)`);
// 5. denied microphone: listen-only, banner, still in the world and in voice
const C = await player('Cid', denyBrowser);
await C.waitForFunction(() => window.__store.getState().voice.joined && window.__store.getState().voice.mic === 'unavailable', null, { timeout: 60000 });
result.deniedIndicator = await C.locator('[data-mic]').getAttribute('data-mic');
result.deniedBanner = await C.getByTestId('mic-banner').innerText();
result.deniedInWorld = await C.evaluate(() => window.__store.getState().phase === 'playing' && window.__game.net().status === 'online');
await C.screenshot({ path: `${out}/4-c-denied-listen-only.png` });
step(`denied: indicator "${result.deniedIndicator}", in world ${result.deniedInWorld}, banner "${result.deniedBanner.replace(/\n/g, ' ')}"`);
result.errors = [...new Set(errors)];
fs.writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
await denyBrowser.close();
await vite.close();
killServer();
process.exit(errors.length ? 1 : 0);

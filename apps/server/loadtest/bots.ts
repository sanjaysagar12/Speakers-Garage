/**
 * Load test: N bots random-walking in one room against a real server process.
 *
 *   pnpm --filter @shoreline/server loadtest [--bots 100] [--seconds 60] [--aoi 40] [--spread 0]
 *
 * The server runs as a child process (production mode) so its CPU and memory are measured on their own.
 * Bots send input exactly like the web client (3 commands per 50 ms packet) and decode every snapshot.
 * Reported: server CPU per tick, tick time avg/p95 (measured inside the tick), RSS/heap, per-client
 * download (KB/s) and how many other players each bot had in view (area of interest).
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { BIN, NET, PROTOCOL_VERSION, Reader, Writer, decodeSnapshot, encodeInput, newSnapshot, quantizeAxis, sanitizeAvatar, type InputCommand } from '@shoreline/shared';

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i < 0 ? d : process.argv[i + 1];
};
const BOTS = Number(arg('bots', '100'));
const SECONDS = Number(arg('seconds', '60'));
const AOI = arg('aoi', String(NET.aoiRadius));
const PORT = 8790;
const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '..');

const server = spawn(path.join(serverDir, 'node_modules/.bin/tsx'), ['--conditions=source', 'src/index.ts'], {
  cwd: serverDir,
  env: { ...process.env, ...(process.env.LOADTEST_PROFILE ? { NODE_OPTIONS: `--cpu-prof --cpu-prof-dir=${process.env.LOADTEST_PROFILE}` } : {}), PORT: String(PORT), HOST: '127.0.0.1', NODE_ENV: 'production', LOG_LEVEL: 'warn', MAX_PLAYERS_PER_ROOM: String(BOTS + 5), AOI_RADIUS: AOI, WS_CONNECTS_PER_MINUTE: '100000' },
  stdio: ['ignore', 'inherit', 'inherit'],
  detached: true,
});
const stop = () => {
  try {
    process.kill(-server.pid!, 'SIGTERM');
  } catch {
    /* gone */
  }
};
process.on('exit', stop);
process.on('SIGINT', () => process.exit(1));

const http = `http://127.0.0.1:${PORT}`;
const get = async <T>(p: string): Promise<T> => (await fetch(http + p)).json() as Promise<T>;
for (let i = 0; i < 200; i++) {
  try {
    if ((await fetch(`${http}/health`)).ok) break;
  } catch {
    /* starting */
  }
  await new Promise((r) => setTimeout(r, 100));
}

interface Bot {
  ws: WebSocket;
  seq: number;
  angle: number;
  run: boolean;
  bytesIn: number;
  snaps: number;
  inViewSum: number;
  ready: boolean;
}
const bots: Bot[] = [];
const writer = new Writer(256);
const cmds: InputCommand[] = Array.from({ length: 3 }, () => ({ seq: 0, dx: 0, dz: 0, run: false, yaw: 0 }));
const snap = newSnapshot();

function addBot(i: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const b: Bot = { ws, seq: 0, angle: Math.random() * Math.PI * 2, run: false, bytesIn: 0, snaps: 0, inViewSum: 0, ready: false };
    const inView = new Set<number>();
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', v: PROTOCOL_VERSION, name: `Bot ${i}`, avatar: sanitizeAvatar({}), room: 'load' })));
    ws.on('message', (data: Buffer, isBinary: boolean) => {
      b.bytesIn += data.byteLength;
      if (!isBinary) {
        const m = JSON.parse(data.toString()) as { t: string; id?: number };
        if (m.t === 'welcome') {
          b.ready = true;
          resolve();
        } else if (m.t === 'spawn') inView.add(m.id!);
        else if (m.t === 'despawn' || m.t === 'left') inView.delete(m.id!);
        else if (m.t === 'error') reject(new Error(JSON.stringify(m)));
        return;
      }
      const r = new Reader(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      if (r.u8() !== BIN.snapshot) return;
      decodeSnapshot(r, snap);
      b.snaps++;
      b.inViewSum += inView.size;
    });
    ws.on('error', reject);
    bots.push(b);
  });
}

console.log(`connecting ${BOTS} bots…`);
for (let i = 0; i < BOTS; i++) {
  await addBot(i);
  if (i % 10 === 9) await new Promise((r) => setTimeout(r, 50));
}
console.log(`all ${BOTS} joined; walking for ${SECONDS} s`);

// input: every 50 ms, 3 commands per bot (a random walk: turn every ~2 s, run 30% of the time)
let tickN = 0;
const inputTimer = setInterval(() => {
  tickN++;
  for (const b of bots) {
    if (b.ws.readyState !== WebSocket.OPEN) continue;
    if (tickN % 40 === 0 || Math.random() < 0.02) {
      b.angle += (Math.random() - 0.5) * 2.5;
      b.run = Math.random() < 0.3;
    }
    for (let k = 0; k < 3; k++) {
      const c = cmds[k];
      c.seq = (b.seq + k) % 65536;
      c.dx = quantizeAxis(Math.sin(b.angle));
      c.dz = quantizeAxis(Math.cos(b.angle));
      c.run = b.run;
    }
    b.seq = (b.seq + 3) % 65536;
    b.ws.send(encodeInput(writer, cmds));
  }
}, 1000 / NET.sendHz);

interface Health {
  rssMB: number;
  heapMB: number;
  cpuMs: number;
}
interface Rooms {
  rooms: Array<{ id: string; players: number; tick: number; tickMsAvg: number; tickMsP95: number }>;
}
const samples: Array<{ t: number; cpuMsPerTick: number; tickAvg: number; tickP95: number; rssMB: number; heapMB: number; kbps: number; inView: number }> = [];
let prev = { h: await get<Health>('/health'), r: (await get<Rooms>('/rooms')).rooms.find((r) => r.id === 'load')!, bytes: 0, at: Date.now() };
for (const b of bots) {
  b.bytesIn = 0;
  b.snaps = 0;
  b.inViewSum = 0;
}
const started = Date.now();
while (Date.now() - started < SECONDS * 1000) {
  await new Promise((r) => setTimeout(r, 5000));
  const h = await get<Health>('/health');
  const room = (await get<Rooms>('/rooms')).rooms.find((r) => r.id === 'load')!;
  const bytes = bots.reduce((a, b) => a + b.bytesIn, 0);
  const now = Date.now();
  const dt = (now - prev.at) / 1000;
  const snapsTotal = bots.reduce((a, b) => a + b.snaps, 0);
  const s = {
    t: Math.round((now - started) / 1000),
    cpuMsPerTick: +((h.cpuMs - prev.h.cpuMs) / Math.max(1, room.tick - prev.r.tick)).toFixed(3),
    tickAvg: room.tickMsAvg,
    tickP95: room.tickMsP95,
    rssMB: h.rssMB,
    heapMB: h.heapMB,
    kbps: +((bytes - prev.bytes) / dt / BOTS / 1024).toFixed(2),
    inView: +(bots.reduce((a, b) => a + b.inViewSum, 0) / Math.max(1, snapsTotal)).toFixed(1),
  };
  for (const b of bots) {
    b.inViewSum = 0;
    b.snaps = 0;
  }
  samples.push(s);
  console.log(
    `t=${String(s.t).padStart(3)}s  cpu/tick ${s.cpuMsPerTick.toFixed(2)} ms  tick avg ${s.tickAvg.toFixed(2)} p95 ${s.tickP95.toFixed(2)} ms  rss ${s.rssMB} MB  heap ${s.heapMB} MB  down ${s.kbps} KB/s per client  in view ${s.inView}`,
  );
  prev = { h, r: room, bytes, at: now };
}
clearInterval(inputTimer);
const last = samples.slice(1); // skip warm-up
const avg = (f: (s: (typeof samples)[number]) => number) => +(last.reduce((a, s) => a + f(s), 0) / Math.max(1, last.length)).toFixed(2);
const summary = {
  bots: BOTS,
  seconds: SECONDS,
  aoiRadius: Number(AOI),
  tickRate: NET.tickRate,
  serverCpuMsPerTick: avg((s) => s.cpuMsPerTick),
  serverCpuPctOfOneCore: +((avg((s) => s.cpuMsPerTick) * NET.tickRate) / 10).toFixed(1),
  tickMsAvg: avg((s) => s.tickAvg),
  tickMsP95: Math.max(...last.map((s) => s.tickP95)),
  rssMB: Math.max(...samples.map((s) => s.rssMB)),
  heapMB: Math.max(...samples.map((s) => s.heapMB)),
  downKBpsPerClient: avg((s) => s.kbps),
  avgPlayersInView: avg((s) => s.inView),
  disconnected: bots.filter((b) => b.ws.readyState !== WebSocket.OPEN).length,
};
console.log(JSON.stringify(summary, null, 2));
for (const b of bots) b.ws.close();
stop();
process.exit(0);

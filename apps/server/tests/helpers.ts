import WebSocket from 'ws';
import {
  BIN,
  NET,
  PROTOCOL_VERSION,
  Reader,
  Writer,
  decodeSnapshot,
  encodeInput,
  newSnapshot,
  sanitizeAvatar,
  type InputCommand,
  type ServerMessage,
  type Snapshot,
} from '@shoreline/shared';
import { buildApp } from '../src/app';
import { loadEnv } from '../src/env';
import type { Transport } from '../src/rooms/ServerPlayer';

export async function startServer(extra: Record<string, string> = {}) {
  const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent', PORT: '0', HOST: '127.0.0.1', ...extra });
  const { app, rooms } = await buildApp({ env });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { app, rooms, url: `ws://127.0.0.1:${port}/ws`, http: `http://127.0.0.1:${port}` };
}

export interface TestClient {
  ws: WebSocket;
  json: ServerMessage[];
  snaps: Snapshot[];
  closed: { code: number; reason: string } | null;
  send(msg: object): void;
  input(cmds: InputCommand[]): void;
  waitFor<T extends ServerMessage['t']>(t: T, pred?: (m: Extract<ServerMessage, { t: T }>) => boolean, ms?: number): Promise<Extract<ServerMessage, { t: T }>>;
  waitSnap(pred: (s: Snapshot) => boolean, ms?: number): Promise<Snapshot>;
  close(): void;
}

export function connect(url: string, origin?: string): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, origin ? { origin } : {});
    const c: TestClient = {
      ws,
      json: [],
      snaps: [],
      closed: null,
      send: (m) => ws.send(JSON.stringify(m)),
      input: (cmds) => ws.send(encodeInput(new Writer(), cmds).slice()),
      waitFor: (t, pred, ms = 5000) =>
        new Promise((res, rej) => {
          const started = Date.now();
          const poll = () => {
            const hit = c.json.find((m) => m.t === t && (!pred || pred(m as never)));
            if (hit) return res(hit as never);
            if (Date.now() - started > ms) return rej(new Error(`timeout waiting for '${t}' (got ${c.json.map((m) => m.t).join(',')})`));
            setTimeout(poll, 10);
          };
          poll();
        }),
      waitSnap: (pred, ms = 5000) =>
        new Promise((res, rej) => {
          const started = Date.now();
          const poll = () => {
            const hit = [...c.snaps].reverse().find(pred);
            if (hit) return res(hit);
            if (Date.now() - started > ms) return rej(new Error('timeout waiting for snapshot'));
            setTimeout(poll, 10);
          };
          poll();
        }),
      close: () => ws.close(),
    };
    ws.on('message', (data, isBinary) => {
      const buf = data as Buffer;
      if (isBinary) {
        const r = new Reader(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
        if (r.u8() === BIN.snapshot) {
          const s = decodeSnapshot(r, newSnapshot());
          s.entities = s.entities.slice(0, s.count).map((e) => ({ ...e }));
          c.snaps.push(s);
        }
      } else c.json.push(JSON.parse(buf.toString()));
    });
    ws.on('close', (code, reason) => (c.closed = { code, reason: reason.toString() }));
    ws.on('open', () => resolve(c));
    ws.on('error', reject);
  });
}

export const joinMsg = (name: string, room = 'test', extra: object = {}) => ({ t: 'join', v: PROTOCOL_VERSION, name, avatar: sanitizeAvatar({}), room, ...extra });

export const cmds = (from: number, n: number, dx: number, dz: number, run = false): InputCommand[] =>
  Array.from({ length: n }, (_, i) => ({ seq: (from + i) % 65536, dx, dz, run, yaw: 0 }));

/** Send n commands paced like a real client: 3 commands (one 50 ms packet) at a time. */
export async function sendCommands(c: TestClient, from: number, n: number, dx: number, dz: number, run = false): Promise<void> {
  const per = NET.stepHz / NET.sendHz;
  for (let i = 0; i < n; i += per) {
    c.input(cmds(from + i, Math.min(per, n - i), dx, dz, run));
    await new Promise((r) => setTimeout(r, 1000 / NET.sendHz));
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** In-memory transport for Room-level tests. */
export class FakeTransport implements Transport {
  text: ServerMessage[] = [];
  binary: Uint8Array[] = [];
  closed: { code: number; reason: string } | null = null;
  bufferedAmount = 0;
  sendText(t: string): void {
    this.text.push(JSON.parse(t));
  }
  sendBinary(b: Uint8Array): void {
    this.binary.push(b.slice());
  }
  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }
  lastSnapshot(): Snapshot | null {
    const b = this.binary[this.binary.length - 1];
    if (!b) return null;
    const r = new Reader(b);
    r.u8();
    const s = decodeSnapshot(r, newSnapshot());
    s.entities = s.entities.slice(0, s.count).map((e) => ({ ...e }));
    return s;
  }
}

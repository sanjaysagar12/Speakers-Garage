import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { NET, PROTOCOL_VERSION, parseClientMessage, sanitizeName, sanitizeRoomId, type ServerMessage } from '@shoreline/shared';
import type { Env } from './env';
import { RoomManager } from './rooms/RoomManager';
import { JoinError, Room } from './rooms/Room';
import type { ServerPlayer, Transport } from './rooms/ServerPlayer';
import { MemoryPlayerStore, type PlayerStore } from './store/PlayerStore';
import { iceServersFor } from './voice/turn';

export interface AppDeps {
  env: Env;
  store?: PlayerStore;
}

const send = (ws: WebSocket, msg: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));

/** Builds the Fastify app (HTTP + WebSocket). `listen()` is up to the caller (index.ts, tests). */
export async function buildApp({ env, store = new MemoryPlayerStore() }: AppDeps): Promise<{ app: FastifyInstance; rooms: RoomManager }> {
  const app = Fastify({
    logger:
      env.NODE_ENV === 'development' && env.LOG_LEVEL !== 'silent'
        ? { level: env.LOG_LEVEL, transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
        : { level: env.LOG_LEVEL },
    bodyLimit: 16 * 1024,
    trustProxy: true,
  });

  const rooms = new RoomManager(
    {
      capacity: env.MAX_PLAYERS_PER_ROOM,
      tickRate: env.TICK_RATE,
      aoiRadius: env.AOI_RADIUS,
      iceFor: (id) => iceServersFor(env, `p${id}`),
      store,
      log: app.log,
    },
    env.MAX_ROOMS,
    env.DEFAULT_MAP,
  );
  app.addHook('onClose', async () => rooms.stopAll());

  // development: also accept this machine and private-network origins (phones on the same Wi-Fi)
  const PRIVATE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;
  const originAllowed = (origin: string | undefined) =>
    !origin || env.ALLOWED_ORIGINS.includes(origin) || env.ALLOWED_ORIGINS.includes('*') || (env.NODE_ENV === 'development' && PRIVATE.test(origin));

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: (origin, cb) => cb(null, originAllowed(origin)) });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  await app.register(websocket, { options: { maxPayload: NET.maxMessageBytes, perMessageDeflate: false } });

  app.get('/health', { config: { rateLimit: false } }, async () => ({ ok: true, protocol: PROTOCOL_VERSION, uptime: Math.round(process.uptime()) }));
  app.get('/rooms', async () => ({ rooms: rooms.list(), capacity: env.MAX_PLAYERS_PER_ROOM }));

  app.get(
    '/ws',
    {
      websocket: true,
      // limit connection attempts per IP; browsers must come from an allowed origin
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      preValidation: async (req, reply) => {
        if (!originAllowed(req.headers.origin)) return reply.code(403).send({ error: 'origin not allowed' });
      },
    },
    (ws, req) => {
      const query = req.query as Record<string, string | undefined>;
      let player: ServerPlayer | null = null;
      let room: Room | null = null;
      let joining = false;
      const transport: Transport = {
        sendText: (t) => ws.readyState === ws.OPEN && ws.send(t),
        sendBinary: (b) => ws.readyState === ws.OPEN && ws.send(b, { binary: true }),
        close: (code, reason) => ws.close(code, reason),
        get bufferedAmount() {
          return ws.bufferedAmount;
        },
      };
      // the first message must be a join within 10 s
      const joinTimer = setTimeout(() => !player && ws.close(4000, 'join timeout'), 10_000);
      // heartbeat: ping every 5 s, terminate after 15 s of silence
      let lastSeen = Date.now();
      const beat = setInterval(() => {
        if (Date.now() - lastSeen > NET.timeoutMs) {
          ws.terminate();
          return;
        }
        if (ws.readyState === ws.OPEN) ws.ping();
      }, NET.heartbeatMs);
      ws.on('pong', () => (lastSeen = Date.now()));

      let strikes = 0;
      const strike = () => {
        if (player && room) {
          if (player.violation(Date.now())) room.kick(player, 'bad', 'Too many invalid messages.');
        } else if (++strikes > 5) ws.close(4002, 'bad');
      };

      ws.on('message', async (data, isBinary) => {
        lastSeen = Date.now();
        const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        if (player && room && !player.buckets.messages.take(performance.now())) {
          if (player.violation(Date.now())) room.kick(player, 'rate', 'Too many messages.');
          return;
        }
        if (isBinary) {
          if (!player || !room) return strike();
          if (!room.handleBinary(player, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))) strike();
          return;
        }
        const msg = parseClientMessage(buf.toString('utf8'));
        if (!msg) return strike();
        if (msg.t !== 'join') {
          if (!player || !room) return strike();
          room.handleJson(player, msg);
          return;
        }
        if (player || joining) return;
        joining = true;
        if (Room.incompatible(msg.v)) {
          send(ws, { t: 'error', code: 'version', message: `Protocol mismatch: server ${PROTOCOL_VERSION}, client ${msg.v}. Reload the page.` });
          ws.close(4003, 'version');
          return;
        }
        const name = sanitizeName(msg.name);
        if (!name) {
          send(ws, { t: 'error', code: 'name', message: 'Please choose a name (letters and numbers).' });
          ws.close(4004, 'name');
          return;
        }
        const roomId = sanitizeRoomId(msg.room ?? query.room) ?? 'lobby';
        try {
          room = rooms.getOrCreate(roomId, msg.map);
          player = await room.join(transport, name, msg.avatar, msg.resume);
          clearTimeout(joinTimer);
        } catch (e) {
          const err = e instanceof JoinError ? e : new JoinError('server', 'Could not join.');
          if (!(e instanceof JoinError)) app.log.error(e);
          send(ws, { t: 'error', code: err.code, message: err.message });
          ws.close(4005, err.code);
          room = null;
        } finally {
          joining = false;
        }
      });

      ws.on('close', () => {
        clearTimeout(joinTimer);
        clearInterval(beat);
        if (player && room) room.disconnect(player, transport);
      });
      ws.on('error', (e) => app.log.warn({ err: e.message }, 'socket error'));
    },
  );

  return { app, rooms };
}

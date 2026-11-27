import { randomBytes } from 'node:crypto';
import {
  BIN,
  CollisionGrid,
  EMOTES,
  NET,
  PROTOCOL_VERSION,
  Reader,
  VOICE,
  Writer,
  animByte,
  applyCommand,
  beginSnapshot,
  createMapData,
  decodeInput,
  encodePong,
  endSnapshot,
  newPlayerSim,
  quantizeEntity,
  sameEntity,
  sanitizeAvatar,
  sanitizeChat,
  seqNewer,
  writeEntity,
  type ClientMessage,
  type EntityState,
  type ErrorCode,
  type IceServerInfo,
  type InputCommand,
  type MapData,
  type ServerMessage,
} from '@shoreline/shared';
import { ServerPlayer, type Transport } from './ServerPlayer';
import { findSpawn } from './spawn';
import type { PlayerStore } from '../store/PlayerStore';

export interface RoomOptions {
  id: string;
  mapId: string;
  capacity: number;
  tickRate: number;
  aoiRadius: number;
  iceFor: (playerId: number) => IceServerInfo[];
  store: PlayerStore;
  log: { info: (o: object, m?: string) => void; warn: (o: object, m?: string) => void };
  /** called when the last player is gone (connected or resumable) */
  onEmpty: (room: Room) => void;
  /** clock (ms), injectable for tests */
  now?: () => number;
}

export interface RoomStats {
  id: string;
  map: string;
  players: number;
  connected: number;
  tick: number;
  tickMsAvg: number;
  tickMsP95: number;
  /** average outbound bytes/s per connected player over the last few seconds */
  outKBpsPerPlayer: number;
}

/** Thrown to the connection layer when a join can't be accepted. */
export class JoinError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const BACKPRESSURE_SKIP = 256 * 1024;
const BACKPRESSURE_CLOSE = 2 * 1024 * 1024;
const WAVE_MS = 2500;

/**
 * One map instance. Owns the players, the fixed-rate simulation, interest management and the voice
 * signaling relay. Positions are only ever produced here, from queued input commands run through the
 * shared applyCommand; nothing a client sends about its own position is ever read.
 */
export class Room {
  readonly id: string;
  readonly mapId: string;
  readonly map: MapData;
  private readonly env: { map: MapData; grid: CollisionGrid };
  readonly players = new Map<number, ServerPlayer>();
  private readonly byToken = new Map<string, ServerPlayer>();
  private nextId = 1;
  tick = 0;
  private timer: NodeJS.Timeout | null = null;
  private nextAt = 0;
  private readonly tickMs = new Float64Array(200);
  private tickCount = 0;
  private readonly now: () => number;
  private readonly cmdScratch: InputCommand[] = [];
  private readonly pong = new Writer(16);
  private bytesWindow = { at: 0, bytes: 0, rate: 0 };
  private readonly aoiIn2: number;
  private readonly aoiOut2: number;

  constructor(private readonly opts: RoomOptions) {
    this.id = opts.id;
    this.mapId = opts.mapId;
    this.map = createMapData(opts.mapId);
    this.env = { map: this.map, grid: new CollisionGrid(this.map) };
    this.now = opts.now ?? (() => performance.now());
    this.aoiIn2 = opts.aoiRadius ** 2;
    this.aoiOut2 = (opts.aoiRadius + NET.aoiHysteresis) ** 2;
  }

  get size(): number {
    return this.players.size;
  }

  // ------------------------------------------------------------------ lifecycle

  /** Fixed-rate loop on a drift-corrected timer: ticks are scheduled against an absolute clock. */
  start(): void {
    if (this.timer) return;
    const period = 1000 / this.opts.tickRate;
    this.nextAt = this.now() + period;
    const loop = () => {
      const now = this.now();
      let ran = 0;
      while (now >= this.nextAt && ran < 4) {
        this.step();
        this.nextAt += period;
        ran++;
      }
      // fell far behind (process paused): resync instead of bursting
      if (now - this.nextAt > period * 4) this.nextAt = now + period;
      this.timer = setTimeout(loop, Math.max(0, this.nextAt - this.now()));
    };
    this.timer = setTimeout(loop, period);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // ------------------------------------------------------------------ joining and leaving

  /** Join or resume. Returns the player; throws JoinError when the room is full or the token is unusable. */
  async join(transport: Transport, name: string, avatarRaw: unknown, resume?: string): Promise<ServerPlayer> {
    const now = this.now();
    // resume: same token in this room within the window -> same id and position
    if (resume) {
      const p = this.byToken.get(resume);
      if (p) {
        if (p.transport && p.transport !== transport) {
          // duplicate tab / stale socket: the newest connection wins
          p.send(JSON.stringify({ t: 'error', code: 'replaced', message: 'This player was opened in another tab.' } satisfies ServerMessage));
          p.transport.close(4001, 'replaced');
        }
        p.transport = transport;
        p.disconnectedAt = 0;
        p.name = name;
        p.avatar = sanitizeAvatar(avatarRaw as Record<string, unknown>);
        p.resetSession(now);
        this.sendWelcome(p);
        this.broadcast({ t: 'avatar', id: p.id, avatar: p.avatar }, p.id);
        this.opts.log.info({ room: this.id, id: p.id }, 'player resumed');
        return p;
      }
      // not in memory (e.g. the room was recreated): the store may still know the last position
      const rec = await this.opts.store.get(resume);
      if (rec && rec.roomId === this.id) return this.add(transport, name, avatarRaw, now, rec);
    }
    if (this.players.size >= this.opts.capacity) throw new JoinError('full', 'This room is full.');
    return this.add(transport, name, avatarRaw, now);
  }

  private add(transport: Transport, name: string, avatarRaw: unknown, now: number, rec?: { x: number; z: number; facing: number }): ServerPlayer {
    if (this.players.size >= this.opts.capacity) throw new JoinError('full', 'This room is full.');
    const id = this.allocId();
    const others = [...this.players.values()].map((p) => p.sim);
    const spot = rec && !this.env.grid.blockedCircle(rec.x, rec.z, 0.3) ? { x: rec.x, z: rec.z, y: this.map.groundHeight(rec.x, rec.z) } : findSpawn(this.map, this.env.grid, others);
    const sim = newPlayerSim(spot.x, spot.z, spot.y, rec?.facing ?? this.map.spawn.facing);
    const token = randomBytes(16).toString('hex');
    const p = new ServerPlayer(id, name, sanitizeAvatar(avatarRaw as Record<string, unknown>), sim, token, transport, now);
    p.resetSession(now);
    this.players.set(id, p);
    this.byToken.set(token, p);
    this.sendWelcome(p);
    this.broadcast({ t: 'joined', player: p.info() }, id);
    this.opts.log.info({ room: this.id, id, players: this.players.size }, 'player joined');
    return p;
  }

  private allocId(): number {
    for (let i = 0; i < 65535; i++) {
      const id = this.nextId;
      this.nextId = (this.nextId % 65535) + 1;
      if (!this.players.has(id)) return id;
    }
    throw new JoinError('full', 'No free player ids.');
  }

  private sendWelcome(p: ServerPlayer): void {
    const msg: ServerMessage = {
      t: 'welcome',
      selfId: p.id,
      resume: p.resumeToken,
      tickRate: this.opts.tickRate,
      stepHz: NET.stepHz,
      room: this.id,
      map: this.mapId,
      players: [...this.players.values()].map((o) => o.info()),
      ice: this.opts.iceFor(p.id),
      aoiRadius: this.opts.aoiRadius,
      spawn: { x: p.sim.x, z: p.sim.z, y: p.sim.y, facing: p.sim.facing },
    };
    p.send(JSON.stringify(msg));
  }

  /** The socket closed: keep the player (frozen) for the reconnect window. */
  disconnect(p: ServerPlayer, transport: Transport): void {
    if (p.transport !== transport) return; // already replaced by a newer connection
    p.transport = null;
    p.disconnectedAt = this.now();
    if (p.voice.joined) {
      p.voice.joined = false;
      p.voice.speaking = false;
      this.broadcast({ t: 'voiceState', id: p.id, ...p.voice }, p.id);
    }
    void this.opts.store.put({
      resumeToken: p.resumeToken,
      roomId: this.id,
      playerId: p.id,
      name: p.name,
      avatar: p.avatar,
      x: p.sim.x,
      z: p.sim.z,
      facing: p.sim.facing,
      updatedAt: Date.now(),
    });
  }

  private remove(p: ServerPlayer): void {
    this.players.delete(p.id);
    this.byToken.delete(p.resumeToken);
    for (const o of this.players.values()) o.inView.delete(p.id);
    this.broadcast({ t: 'left', id: p.id });
    this.opts.log.info({ room: this.id, id: p.id, players: this.players.size }, 'player left');
    if (this.players.size === 0) this.opts.onEmpty(this);
  }

  /** Remove immediately (explicit leave, or kicked). */
  kick(p: ServerPlayer, code: ErrorCode, message: string): void {
    p.send(JSON.stringify({ t: 'error', code, message } satisfies ServerMessage));
    p.transport?.close(4002, code);
    p.transport = null;
    void this.opts.store.delete(p.resumeToken);
    this.remove(p);
  }

  // ------------------------------------------------------------------ messages

  /** Binary frame from a client. Returns false if the message was malformed (counted as a violation). */
  handleBinary(p: ServerPlayer, data: Uint8Array): boolean {
    const now = this.now();
    if (data.byteLength > NET.maxBinaryBytes) return false;
    p.bytesIn += data.byteLength;
    try {
      const r = new Reader(data);
      const type = r.u8();
      if (type === BIN.input) {
        const n = decodeInput(r, this.cmdScratch);
        let dropped = 0;
        for (let i = 0; i < n; i++) {
          const c = this.cmdScratch[i];
          if (!seqNewer(c.seq, p.lastQueuedSeq)) continue; // duplicate or old (resend)
          if (p.queue.length >= NET.maxQueuedCommands) {
            dropped++;
            continue;
          }
          p.queue.push({ seq: c.seq, dx: c.dx, dz: c.dz, run: c.run, yaw: c.yaw });
          p.lastQueuedSeq = c.seq;
        }
        // flooding (more input than real time allows) is dropped and counted
        if (dropped > 0) return !p.violation(now);
        return true;
      }
      if (type === BIN.ping) {
        const t = r.u32();
        p.sendBinary(encodePong(this.pong, t, this.tick));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  handleJson(p: ServerPlayer, m: ClientMessage): void {
    const now = this.now();
    switch (m.t) {
      case 'chat': {
        if (!p.buckets.chat.take(now)) return void this.rateLimited(p, now);
        const text = sanitizeChat(m.text);
        if (text) this.broadcast({ t: 'chat', id: p.id, name: p.name, text });
        return;
      }
      case 'emote': {
        if (!p.buckets.emote.take(now)) return void this.rateLimited(p, now);
        p.emote = m.emote ? EMOTES.indexOf(m.emote) + 1 : 0;
        p.emoteUntil = m.emote === 'wave' ? now + WAVE_MS : Infinity;
        this.broadcast({ t: 'emote', id: p.id, emote: m.emote }, p.id);
        return;
      }
      case 'avatar': {
        if (!p.buckets.avatar.take(now)) return void this.rateLimited(p, now);
        p.avatar = sanitizeAvatar(m.avatar);
        this.broadcast({ t: 'avatar', id: p.id, avatar: p.avatar }, p.id);
        return;
      }
      case 'voiceState': {
        if (!p.buckets.voice.take(now)) return void this.rateLimited(p, now);
        const changed = p.voice.joined !== m.joined || p.voice.muted !== m.muted || p.voice.speaking !== m.speaking;
        p.voice.joined = m.joined;
        p.voice.muted = m.muted;
        p.voice.speaking = m.joined && !m.muted && m.speaking;
        if (changed) this.broadcast({ t: 'voiceState', id: p.id, ...p.voice }, p.id);
        return;
      }
      case 'voice': {
        if (!p.buckets.voice.take(now)) return void this.rateLimited(p, now);
        this.relayVoice(p, m);
        return;
      }
      case 'join':
        return; // already joined: ignore
    }
  }

  /**
   * Signaling relay: only between two connected players of this room who both joined voice and are close
   * enough (checked here, not trusted from the client). The server never sees audio, only SDP and ICE.
   */
  private relayVoice(from: ServerPlayer, m: Extract<ClientMessage, { t: 'voice' }>): void {
    const to = this.players.get(m.to);
    if (!to || to === from || !to.connected) return;
    if (m.kind !== 'bye') {
      if (!from.voice.joined || !to.voice.joined) return;
      const d2 = (to.sim.x - from.sim.x) ** 2 + (to.sim.z - from.sim.z) ** 2;
      if (d2 > VOICE.relayRadius ** 2) return;
    }
    to.send(JSON.stringify({ t: 'voice', from: from.id, kind: m.kind, sdp: m.sdp, ice: m.ice } satisfies ServerMessage));
  }

  private rateLimited(p: ServerPlayer, now: number): void {
    if (p.violation(now)) this.kick(p, 'rate', 'Too many messages.');
  }

  broadcast(msg: ServerMessage, except?: number): void {
    const text = JSON.stringify(msg);
    for (const p of this.players.values()) if (p.id !== except) p.send(text);
  }

  // ------------------------------------------------------------------ simulation tick

  step(): void {
    const t0 = performance.now();
    const now = this.now();
    this.tick++;

    // 1) apply queued input within each player's budget (anti speed hack: at most real time + burst)
    for (const p of this.players.values()) {
      if (!p.connected) {
        if (now - p.disconnectedAt > NET.reconnectWindowMs) this.remove(p);
        continue;
      }
      let budget = p.commands.available(now);
      while (budget > 0 && p.queue.length) {
        const c = p.queue.shift()!;
        p.commands.take(now);
        budget--;
        applyCommand(p.sim, c, this.env);
        p.run = c.run;
        p.lastAppliedSeq = c.seq;
        p.lastCommandAt = now;
      }
    }

    // 2) quantize everyone once
    for (const p of this.players.values()) {
      const moving = Math.hypot(p.sim.vx, p.sim.vz) > 0.5;
      if (p.emote && (now > p.emoteUntil || (moving && p.emote !== EMOTES.indexOf('wave') + 1))) {
        p.emote = 0;
        this.broadcast({ t: 'emote', id: p.id, emote: null }, p.id);
      }
      p.wade = this.map.wadeDepth(p.sim.x, p.sim.z);
      // a stalled client (hidden tab, lag) stands still for everyone else instead of moonwalking
      const stalled = !p.connected || now - p.lastCommandAt > 500;
      quantizeEntity(p.id, p.sim, animByte(p.sim, p.run, p.wade, p.emote) & (stalled ? 0xf4 : 0xff), p.entity);
      if (stalled) p.entity.speed = 0;
    }

    // 3) per viewer: area of interest + delta compression -> one binary snapshot
    let sent = 0;
    for (const viewer of this.players.values()) {
      const tr = viewer.transport;
      if (!tr) continue;
      if (tr.bufferedAmount > BACKPRESSURE_CLOSE) {
        this.kick(viewer, 'server', 'Connection too slow.');
        continue;
      }
      if (tr.bufferedAmount > BACKPRESSURE_SKIP) continue; // slow client: skip this snapshot
      const w = viewer.writer;
      const countAt = beginSnapshot(w, this.tick, viewer.lastAppliedSeq, viewer.sim);
      let n = 0;
      for (const other of this.players.values()) {
        if (other === viewer) continue;
        const d2 = (other.sim.x - viewer.sim.x) ** 2 + (other.sim.z - viewer.sim.z) ** 2;
        const last = viewer.inView.get(other.id);
        const inside = last ? d2 <= this.aoiOut2 : d2 <= this.aoiIn2;
        if (!inside) {
          if (last) {
            viewer.inView.delete(other.id);
            viewer.send(JSON.stringify({ t: 'despawn', id: other.id } satisfies ServerMessage));
          }
          continue;
        }
        if (!last) {
          viewer.send(JSON.stringify({ t: 'spawn', id: other.id } satisfies ServerMessage));
          const fresh: EntityState = { ...other.entity };
          viewer.inView.set(other.id, fresh);
        } else if (sameEntity(last, other.entity)) continue;
        else Object.assign(last, other.entity);
        if (n === 255) continue;
        writeEntity(w, other.entity);
        n++;
      }
      viewer.sendBinary(endSnapshot(w, countAt, n));
      sent++;
    }

    const dt = performance.now() - t0;
    this.tickMs[this.tickCount++ % this.tickMs.length] = dt;
    if (dt > 1000 / this.opts.tickRate / 2) this.opts.log.warn({ room: this.id, ms: +dt.toFixed(2), players: this.players.size, sent }, 'slow tick');
  }

  // ------------------------------------------------------------------ stats

  stats(): RoomStats {
    const n = Math.min(this.tickCount, this.tickMs.length);
    const arr = Array.from(this.tickMs.subarray(0, n)).sort((a, b) => a - b);
    const avg = n ? arr.reduce((a, b) => a + b, 0) / n : 0;
    const p95 = n ? arr[Math.min(n - 1, Math.floor(n * 0.95))] : 0;
    // outbound rate per connected player
    const now = this.now();
    let bytes = 0;
    let connected = 0;
    for (const p of this.players.values()) {
      bytes += p.bytesOut;
      if (p.connected) connected++;
    }
    const w = this.bytesWindow;
    if (now - w.at > 2000) {
      w.rate = w.at ? (bytes - w.bytes) / ((now - w.at) / 1000) : 0;
      w.at = now;
      w.bytes = bytes;
    }
    return {
      id: this.id,
      map: this.mapId,
      players: this.players.size,
      connected,
      tick: this.tick,
      tickMsAvg: +avg.toFixed(3),
      tickMsP95: +p95.toFixed(3),
      outKBpsPerPlayer: connected ? +(w.rate / connected / 1024).toFixed(2) : 0,
    };
  }

  /** True when the client speaks a different protocol version. */
  static incompatible(v: number): boolean {
    return v !== PROTOCOL_VERSION;
  }
}

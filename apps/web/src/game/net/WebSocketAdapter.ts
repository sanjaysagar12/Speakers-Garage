import {
  BIN,
  PROTOCOL_VERSION,
  Reader,
  Writer,
  decodeSnapshot,
  encodeInput,
  encodePing,
  fromFixed,
  fromHeading,
  newSnapshot,
  parseServerMessage,
  ANIM,
  type AvatarConfig,
  type ClientMessage,
  type Emote,
  type InputCommand,
  type ServerMessage,
  type Snapshot,
} from '@shoreline/shared';
import type { NetStatus, NetworkAdapter, Unsubscribe } from './NetworkAdapter';
import { remotes } from './entities';
export { serverHttp, serverUrl } from './endpoints';
import type { PlayerProfile, PlayerState } from '../../types';

type Listener<T> = (v: T) => void;
function emitter<T>() {
  const ls = new Set<Listener<T>>();
  return {
    emit: (v: T) => ls.forEach((cb) => cb(v)),
    on: (cb: Listener<T>): Unsubscribe => {
      ls.add(cb);
      return () => ls.delete(cb);
    },
  };
}

export interface JoinOptions {
  room: string;
  map: string;
  /** resume token from an earlier session in this tab (the session layer stores it) */
  resume?: string;
}

/**
 * WebSocket implementation of NetworkAdapter (authoritative server).
 *  - join(): connect, send `join`, resolve on `welcome` (reject on full / version / bad name / timeout)
 *  - inputs and snapshots are binary; everything else is JSON
 *  - lost connection: reconnect with exponential backoff + jitter, resuming the same player (the session
 *    layer keeps the token per tab, so a page refresh resumes too, and a second tab is a second player)
 *  - status changes are reported through `onStatus` for the UI
 */
export class WebSocketAdapter implements NetworkAdapter {
  readonly authoritative = true;
  private ws: WebSocket | null = null;
  private profile: PlayerProfile | null = null;
  private closedByUs = false;
  private attempt = 0;
  private retryTimer = 0;
  private pingTimer = 0;
  private readonly writer = new Writer(256);
  private readonly pingWriter = new Writer(8);
  private readonly snap: Snapshot = newSnapshot();
  private readonly joinedE = emitter<{ profile: PlayerProfile; state: PlayerState }>();
  private readonly leftE = emitter<string>();
  private readonly movedE = emitter<{ id: string; state: PlayerState }>();
  private readonly selfE = emitter<Readonly<Snapshot>>();
  private readonly eventE = emitter<ServerMessage>();
  private readonly statusE = emitter<{ status: NetStatus; message?: string }>();
  status: NetStatus = 'offline';
  welcome: Extract<ServerMessage, { t: 'welcome' }> | null = null;
  /** current resume token (from the latest welcome) */
  resume: string | undefined;
  /** round-trip time (ms), smoothed */
  rtt = 0;
  bytesIn = 0;
  bytesOut = 0;

  constructor(
    private readonly url: string,
    private readonly opts: JoinOptions,
  ) {
    this.resume = opts.resume;
  }

  onStatus(cb: Listener<{ status: NetStatus; message?: string }>): Unsubscribe {
    return this.statusE.on(cb);
  }

  private setStatus(status: NetStatus, message?: string): void {
    this.status = status;
    this.statusE.emit({ status, message });
  }

  /** Connect and join. Resolves on the welcome (also after a reconnect: see onEvent 'welcome'). */
  join(profile: PlayerProfile): Promise<void> {
    this.profile = profile;
    this.closedByUs = false;
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => fail('error', 'The server did not answer.'), 8000);
      const offEvt = this.eventE.on((m) => {
        if (m.t === 'welcome' && !settled) {
          settled = true;
          window.clearTimeout(timeout);
          offEvt();
          resolve();
        }
      });
      const offStatus = this.statusE.on(({ status, message }) => {
        if (status === 'full' || status === 'version' || status === 'error') fail(status, message);
      });
      const fail = (status: NetStatus, message?: string) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        offEvt();
        offStatus();
        this.closedByUs = true;
        this.ws?.close();
        reject(Object.assign(new Error(message ?? status), { status }));
      };
      // the join promise only cares about the first outcome
      void Promise.resolve().then(() => this.open());
      void offStatus;
    });
  }

  private open(): void {
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      const p = this.profile!;
      const msg: ClientMessage = { t: 'join', v: PROTOCOL_VERSION, name: p.name, avatar: p.avatar, room: this.opts.room, map: this.opts.map, resume: this.resume };
      ws.send(JSON.stringify(msg));
    };
    ws.onmessage = (e) => this.onMessage(e.data as ArrayBuffer | string);
    ws.onclose = (e) => {
      window.clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closedByUs) return this.setStatus('offline');
      // fatal: don't retry
      if (e.code === 4001) return this.setStatus('error', 'You opened this world in another tab.');
      if (this.status === 'full' || this.status === 'version') return;
      // never got in: the server is unreachable (fail fast; the session falls back to offline)
      if (!this.welcome) return this.setStatus('error', 'The server is unreachable.');
      this.scheduleReconnect();
    };
    ws.onerror = () => undefined; // onclose follows
  }

  private scheduleReconnect(): void {
    this.attempt++;
    const base = Math.min(10_000, 500 * 2 ** Math.min(this.attempt - 1, 5));
    const delay = base * (0.5 + Math.random() * 0.5);
    this.setStatus('reconnecting', `Reconnecting in ${Math.ceil(delay / 1000)} s…`);
    this.retryTimer = window.setTimeout(() => this.open(), delay);
  }

  private onMessage(data: ArrayBuffer | string): void {
    if (typeof data !== 'string') {
      this.bytesIn += data.byteLength;
      const r = new Reader(data);
      const type = r.u8();
      if (type === BIN.snapshot) {
        decodeSnapshot(r, this.snap);
        remotes.applySnapshot(this.snap, performance.now());
        this.selfE.emit(this.snap);
        // original seam: report remote movement (cheap; nothing heavy should subscribe)
        for (let i = 0; i < this.snap.count; i++) {
          const e = this.snap.entities[i];
          this.movedE.emit({
            id: String(e.id),
            state: { x: fromFixed(e.x), y: fromFixed(e.z), facing: fromHeading(e.heading), moving: (e.anim & ANIM.moving) !== 0, running: (e.anim & ANIM.running) !== 0, inWater: (e.anim & ANIM.wading) !== 0 },
          });
        }
      } else if (type === BIN.pong) {
        const sent = r.u32();
        const rtt = ((performance.now() >>> 0) - sent) >>> 0;
        this.rtt = this.rtt ? this.rtt + (rtt - this.rtt) * 0.2 : rtt;
      }
      return;
    }
    this.bytesIn += data.length;
    const m = parseServerMessage(data);
    if (!m) return;
    switch (m.t) {
      case 'welcome':
        this.welcome = m;
        this.attempt = 0;
        this.resume = m.resume;
        remotes.reset(m.selfId, m.tickRate);
        for (const p of m.players) if (p.id !== m.selfId) remotes.roster.set(p.id, p);
        this.setStatus('online');
        window.clearInterval(this.pingTimer);
        this.pingTimer = window.setInterval(() => this.sendBinary(encodePing(this.pingWriter, performance.now() >>> 0)), 2000);
        for (const p of m.players) if (p.id !== m.selfId) this.joinedE.emit({ profile: { id: String(p.id), name: p.name, avatar: p.avatar }, state: blankState() });
        break;
      case 'joined':
        remotes.roster.set(m.player.id, m.player);
        remotes.version++;
        this.joinedE.emit({ profile: { id: String(m.player.id), name: m.player.name, avatar: m.player.avatar }, state: blankState() });
        break;
      case 'left':
        remotes.roster.delete(m.id);
        remotes.despawn(m.id);
        this.leftE.emit(String(m.id));
        break;
      case 'spawn':
        remotes.spawn(m.id);
        break;
      case 'despawn':
        remotes.despawn(m.id);
        break;
      case 'avatar': {
        const p = remotes.roster.get(m.id);
        if (p) {
          p.avatar = m.avatar;
          remotes.version++;
        }
        break;
      }
      case 'voiceState': {
        const p = remotes.roster.get(m.id);
        if (p) p.voice = { joined: m.joined, muted: m.muted, speaking: m.speaking };
        break;
      }
      case 'chat': {
        const e = remotes.entities.get(m.id);
        if (e) e.chat = { text: m.text, until: performance.now() + 6000 };
        break;
      }
      case 'error':
        if (m.code === 'full') this.setStatus('full', m.message);
        else if (m.code === 'version') this.setStatus('version', m.message);
        else if (m.code === 'replaced') this.setStatus('error', m.message);
        else if (m.code === 'name' || m.code === 'room' || m.code === 'server') this.setStatus('error', m.message);
        break;
    }
    this.eventE.emit(m);
  }

  private sendBinary(b: Uint8Array<ArrayBuffer>): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.bytesOut += b.byteLength;
    this.ws.send(b);
  }

  private sendJson(m: ClientMessage): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const s = JSON.stringify(m);
    this.bytesOut += s.length;
    this.ws.send(s);
  }

  get online(): boolean {
    return this.status === 'online';
  }

  /** A join that was superseded (world left while joining): leave on the server, touch no shared state. */
  abort(): void {
    this.closedByUs = true;
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.pingTimer);
    this.ws?.close(1000, 'leave');
    this.ws = null;
  }

  // ---- NetworkAdapter (original seam)
  /** Leave for good: the server removes the player at once (close reason 'leave'); the token is forgotten. */
  leave(): void {
    this.closedByUs = true;
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.pingTimer);
    this.ws?.close(1000, 'leave');
    this.ws = null;
    this.resume = undefined;
    remotes.clear();
    this.setStatus('offline');
  }
  sendMove(): void {
    /* authoritative: positions are never sent; see sendCommands */
  }
  onPlayerJoined(cb: (profile: PlayerProfile, state: PlayerState) => void): Unsubscribe {
    return this.joinedE.on(({ profile, state }) => cb(profile, state));
  }
  onPlayerLeft(cb: (id: string) => void): Unsubscribe {
    return this.leftE.on(cb);
  }
  onPlayerMoved(cb: (id: string, state: PlayerState) => void): Unsubscribe {
    return this.movedE.on(({ id, state }) => cb(id, state));
  }

  // ---- extensions
  sendCommands(cmds: readonly InputCommand[], n: number): void {
    if (n <= 0 || !this.online) return;
    for (let i = 0; i < n; i += 16) this.sendBinary(encodeInput(this.writer, cmds, i, Math.min(n, i + 16)));
  }
  onSelfSnapshot(cb: (s: Readonly<Snapshot>) => void): Unsubscribe {
    return this.selfE.on(cb);
  }
  onEvent(cb: (m: ServerMessage) => void): Unsubscribe {
    return this.eventE.on(cb);
  }
  sendChat(text: string): void {
    this.sendJson({ t: 'chat', text });
  }
  sendEmote(emote: Emote | null): void {
    this.sendJson({ t: 'emote', emote });
  }
  sendAvatar(avatar: AvatarConfig): void {
    this.sendJson({ t: 'avatar', avatar });
  }
  sendVoice(msg: Extract<ClientMessage, { t: 'voice' | 'voiceState' }>): void {
    this.sendJson(msg);
  }
}

const blankState = (): PlayerState => ({ x: 0, y: 0, facing: 0, moving: false, running: false, inWater: false });

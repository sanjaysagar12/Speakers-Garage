import { VOICE, type IceServerInfo, type ServerMessage } from '@shoreline/shared';
import type { NetworkAdapter } from '../game/net/NetworkAdapter';
import { remotes } from '../game/net/entities';
import { SpatialVoice, Vad } from './spatial';
import { VoiceError, type VoiceAdapter } from './VoiceAdapter';

export interface MeshOptions {
  /** simultaneous peers (nearest first): 6 on Medium/High, 3-4 on Low/Ultra-Low */
  maxPeers: number;
  /** Opus bitrate cap (bps) */
  bitrate: number;
  /** stereo panning (off on low tiers: plain gain) */
  spatial: boolean;
  selfId: () => number;
  ice: () => IceServerInfo[];
  /** where we are (for proximity) */
  selfPos: () => { x: number; z: number };
  /** listener orientation for panning */
  listener: () => { x: number; z: number; yaw: number };
  isBlocked: (id: number) => boolean;
}

export interface PeerStatus {
  id: number;
  state: RTCPeerConnectionState;
  quality: 'good' | 'poor' | 'connecting';
  rttMs: number;
  lossPct: number;
}

interface Peer {
  id: number;
  pc: RTCPeerConnection;
  offerer: boolean;
  pendingIce: RTCIceCandidateInit[];
  restarted: boolean;
  failedAt: number;
  vad: Vad;
  status: PeerStatus;
  lastLost: number;
  lastRecv: number;
}

const FALLBACK_STUN: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/** Opus: mono, DTX on (no packets in silence), bitrate cap. */
export function mungeOpus(sdp: string, bitrate: number): string {
  const m = /a=rtpmap:(\d+) opus\/48000/i.exec(sdp);
  if (!m) return sdp;
  const pt = m[1];
  const fmtp = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
  const extra = `usedtx=1;stereo=0;sprop-stereo=0;maxaveragebitrate=${bitrate}`;
  if (fmtp.test(sdp)) {
    return sdp.replace(fmtp, (_l, params: string) => {
      const kept = params
        .split(';')
        .filter((p) => !/^(usedtx|stereo|sprop-stereo|maxaveragebitrate)=/.test(p.trim()))
        .join(';');
      return `a=fmtp:${pt} ${kept ? `${kept};` : ''}${extra}`;
    });
  }
  return sdp.replace(m[0], `${m[0]}\r\na=fmtp:${pt} ${extra}`);
}

/**
 * Proximity voice over a WebRTC mesh. Signaling (offer/answer/ICE/bye) goes through the game socket; the
 * server relays it only between nearby players. The lower player id always makes the offer, so two
 * players never offer at the same time.
 *
 * Loops: proximity 4 Hz (connect within 12 m, drop beyond 15 m, nearest `maxPeers`), audio 20 Hz
 * (gain + panning), speaking 10 Hz, connection quality every 2 s. No allocations in the 20 Hz loop.
 */
export class MeshVoiceAdapter implements VoiceAdapter {
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private spatial: SpatialVoice | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private localSrc: MediaStreamAudioSourceNode | null = null;
  private readonly localBuf = new Float32Array(512);
  private readonly localVad = new Vad(0.015, 0.009, 400);
  private readonly peers = new Map<number, Peer>();
  private readonly retryAfter = new Map<number, number>();
  private readonly streamCbs = new Set<(id: number, s: MediaStream) => void>();
  private readonly timers: number[] = [];
  private offEvent: (() => void) | null = null;
  private muted = false;
  private deafened = false;
  private ptt = false;
  private pttHeld = false;
  private speakingSent = false;
  private lastStateSent = 0;
  private inputId: string | undefined;
  /** called when anything the HUD shows changed */
  onChange: (() => void) | null = null;

  constructor(
    private readonly net: NetworkAdapter,
    private readonly opts: MeshOptions,
  ) {}

  // ------------------------------------------------------------------ VoiceAdapter

  async connect(): Promise<void> {
    if (!window.isSecureContext) throw new VoiceError('insecure', 'Voice needs HTTPS (or localhost) for microphone access.');
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw new VoiceError('unsupported', 'This browser does not support voice chat.');
    await this.openMic(this.inputId);
    this.spatial = new SpatialVoice();
    await this.spatial.resume();
    this.attachLocalAnalyser();
    this.offEvent = this.net.onEvent?.((m) => this.onServer(m)) ?? null;
    this.sendState(true);
    this.timers.push(window.setInterval(() => this.proximity(), 250));
    this.timers.push(window.setInterval(() => this.audio(), 1000 / VOICE.updateHz));
    this.timers.push(window.setInterval(() => this.speaking(), 100));
    this.timers.push(window.setInterval(() => void this.stats(), 2000));
  }

  setLocalMute(muted: boolean): void {
    this.muted = muted;
    this.applyTrackEnabled();
    this.sendState(true);
  }

  onRemoteStream(cb: (playerId: number, stream: MediaStream) => void): () => void {
    this.streamCbs.add(cb);
    return () => this.streamCbs.delete(cb);
  }

  dispose(): void {
    this.timers.splice(0).forEach((t) => window.clearInterval(t));
    this.offEvent?.();
    for (const id of [...this.peers.keys()]) this.closePeer(id, true);
    this.net.sendVoice?.({ t: 'voiceState', joined: false, muted: false, speaking: false });
    this.stream?.getTracks().forEach((t) => t.stop());
    this.localSrc?.disconnect();
    this.spatial?.close();
    this.stream = null;
    this.track = null;
    this.spatial = null;
    for (const p of remotes.roster.values()) p.voice.speaking = false;
  }

  // ------------------------------------------------------------------ controls

  get isMuted(): boolean {
    return this.muted;
  }
  get isDeafened(): boolean {
    return this.deafened;
  }
  get isPtt(): boolean {
    return this.ptt;
  }
  /** the microphone is actually sending */
  get micLive(): boolean {
    return !!this.track?.enabled;
  }
  get speakingNow(): boolean {
    return this.localVad.speaking && this.micLive;
  }

  setDeafened(on: boolean): void {
    this.deafened = on;
    this.spatial?.setDeafened(on);
    this.applyTrackEnabled(); // deafen also mutes the mic (like most voice apps)
    this.sendState(true);
  }

  setPushToTalk(on: boolean): void {
    this.ptt = on;
    this.pttHeld = false;
    this.applyTrackEnabled();
    this.sendState(true);
  }

  setPttHeld(held: boolean): void {
    if (!this.ptt || held === this.pttHeld) return;
    this.pttHeld = held;
    this.applyTrackEnabled();
    this.sendState(true);
  }

  setPeerVolume(id: number, volume: number, muted: boolean): void {
    this.spatial?.setPeerVolume(id, volume, muted);
  }

  /** block: drop the connection now and never accept one (for this session) */
  block(id: number): void {
    this.closePeer(id, true);
  }

  async setInputDevice(deviceId: string): Promise<void> {
    this.inputId = deviceId || undefined;
    if (!this.stream) return;
    const old = this.stream;
    await this.openMic(this.inputId);
    for (const p of this.peers.values()) for (const s of p.pc.getSenders()) if (s.track?.kind === 'audio' || !s.track) await s.replaceTrack(this.track);
    old.getTracks().forEach((t) => t.stop());
    this.attachLocalAnalyser();
  }

  setOutputDevice(deviceId: string): Promise<boolean> {
    return this.spatial?.setOutputDevice(deviceId) ?? Promise.resolve(false);
  }

  peerStatus(): PeerStatus[] {
    return [...this.peers.values()].map((p) => p.status);
  }

  // ------------------------------------------------------------------ microphone

  private async openMic(deviceId?: string): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
        video: false,
      });
    } catch (e) {
      const name = (e as DOMException).name;
      if (name === 'NotAllowedError' || name === 'SecurityError') throw new VoiceError('denied', 'Microphone access was denied. Allow it in the browser to use voice.');
      if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError') throw new VoiceError('no-device', 'No usable microphone was found.');
      throw new VoiceError('failed', `Could not open the microphone (${name}).`);
    }
    this.track = this.stream.getAudioTracks()[0] ?? null;
    if (!this.track) throw new VoiceError('no-device', 'No usable microphone was found.');
    this.applyTrackEnabled();
  }

  private attachLocalAnalyser(): void {
    if (!this.spatial || !this.stream) return;
    this.localSrc?.disconnect();
    this.localSrc = this.spatial.ctx.createMediaStreamSource(this.stream);
    this.localAnalyser = this.spatial.ctx.createAnalyser();
    this.localAnalyser.fftSize = 512;
    this.localSrc.connect(this.localAnalyser); // analysis only: never routed to the speakers
  }

  private applyTrackEnabled(): void {
    if (this.track) this.track.enabled = !this.muted && !this.deafened && (!this.ptt || this.pttHeld);
    this.onChange?.();
  }

  private sendState(force = false): void {
    const now = performance.now();
    const speaking = this.speakingNow;
    if (!force && speaking === this.speakingSent) return;
    if (!force && now - this.lastStateSent < 200) return;
    this.speakingSent = speaking;
    this.lastStateSent = now;
    this.net.sendVoice?.({ t: 'voiceState', joined: true, muted: !this.micLive, speaking });
  }

  // ------------------------------------------------------------------ proximity

  private proximity(): void {
    const self = this.opts.selfId();
    if (self < 0) return;
    const me = this.opts.selfPos();
    const now = performance.now();
    // candidates: players who joined voice, in view, not blocked, nearest first
    const cands: Array<{ id: number; d: number }> = [];
    for (const info of remotes.roster.values()) {
      if (!info.voice.joined || this.opts.isBlocked(info.id)) continue;
      const e = remotes.entities.get(info.id);
      if (!e?.render.ready) continue;
      cands.push({ id: info.id, d: Math.hypot(e.render.x - me.x, e.render.z - me.z) });
    }
    cands.sort((a, b) => a.d - b.d);
    const keep = new Set<number>();
    for (const c of cands) {
      if (keep.size >= this.opts.maxPeers) break;
      const connected = this.peers.has(c.id);
      if (c.d <= VOICE.connectRadius || (connected && c.d <= VOICE.disconnectRadius)) keep.add(c.id);
    }
    for (const id of [...this.peers.keys()]) if (!keep.has(id)) this.closePeer(id, true);
    for (const id of keep) {
      if (this.peers.has(id)) continue;
      if ((this.retryAfter.get(id) ?? 0) > now) continue;
      if (self < id) this.createPeer(id, true); // the lower id offers
    }
  }

  // ------------------------------------------------------------------ peers

  private createPeer(id: number, offerer: boolean): Peer {
    const ice = this.opts.ice();
    const pc = new RTCPeerConnection({ iceServers: ice.length ? (ice as RTCIceServer[]) : FALLBACK_STUN });
    const p: Peer = {
      id,
      pc,
      offerer,
      pendingIce: [],
      restarted: false,
      failedAt: 0,
      vad: new Vad(),
      status: { id, state: 'new', quality: 'connecting', rttMs: 0, lossPct: 0 },
      lastLost: 0,
      lastRecv: 0,
    };
    this.peers.set(id, p);
    if (this.track && this.stream) pc.addTrack(this.track, this.stream);
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.onicecandidate = (e) => {
      if (e.candidate) this.net.sendVoice?.({ t: 'voice', to: id, kind: 'ice', ice: e.candidate.toJSON() as never });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      this.spatial?.add(id, stream, this.opts.spatial);
      this.streamCbs.forEach((cb) => cb(id, stream));
      this.onChange?.();
    };
    pc.onconnectionstatechange = () => {
      p.status.state = pc.connectionState;
      if (pc.connectionState === 'connected') {
        p.failedAt = 0;
        void this.capBitrate(pc);
      }
      if (pc.connectionState === 'failed') this.onFailed(p);
      this.onChange?.();
    };
    if (offerer) pc.onnegotiationneeded = () => void this.offer(p);
    return p;
  }

  private async offer(p: Peer, iceRestart = false): Promise<void> {
    try {
      const o = await p.pc.createOffer({ iceRestart });
      await p.pc.setLocalDescription({ type: 'offer', sdp: mungeOpus(o.sdp ?? '', this.opts.bitrate) });
      this.net.sendVoice?.({ t: 'voice', to: p.id, kind: 'offer', sdp: p.pc.localDescription?.sdp });
    } catch {
      this.closePeer(p.id, true);
    }
  }

  /** ICE failure: one ICE restart (offerer), then give up for a while and let proximity retry. */
  private onFailed(p: Peer): void {
    if (p.offerer && !p.restarted) {
      p.restarted = true;
      void this.offer(p, true);
      return;
    }
    this.closePeer(p.id, true);
    this.retryAfter.set(p.id, performance.now() + 8000);
  }

  private async capBitrate(pc: RTCPeerConnection): Promise<void> {
    for (const s of pc.getSenders()) {
      if (s.track?.kind !== 'audio') continue;
      const params = s.getParameters();
      params.encodings = params.encodings?.length ? params.encodings : [{}];
      params.encodings[0].maxBitrate = this.opts.bitrate;
      try {
        await s.setParameters(params);
      } catch {
        /* some browsers refuse; the SDP cap still applies */
      }
    }
  }

  private closePeer(id: number, sendBye: boolean): void {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    p.pc.onicecandidate = null;
    p.pc.ontrack = null;
    p.pc.onconnectionstatechange = null;
    p.pc.onnegotiationneeded = null;
    p.pc.close();
    this.spatial?.remove(id);
    const info = remotes.roster.get(id);
    if (info) info.voice.speaking = false;
    if (sendBye) this.net.sendVoice?.({ t: 'voice', to: id, kind: 'bye' });
    this.onChange?.();
  }

  // ------------------------------------------------------------------ signaling in

  private onServer(m: ServerMessage): void {
    if (m.t === 'left' || m.t === 'despawn') {
      this.closePeer(m.id, false);
      return;
    }
    if (m.t === 'voiceState' && !m.joined) {
      this.closePeer(m.id, false);
      return;
    }
    if (m.t !== 'voice') return;
    const from = m.from;
    if (m.kind === 'bye') {
      // the other side declined or dropped us: don't offer again right away (avoids offer/bye loops when
      // our tiers allow a different number of peers)
      this.closePeer(from, false);
      this.retryAfter.set(from, performance.now() + 10_000);
      return;
    }
    if (this.opts.isBlocked(from)) {
      if (m.kind === 'offer') this.net.sendVoice?.({ t: 'voice', to: from, kind: 'bye' });
      return;
    }
    void this.handleSignal(from, m);
  }

  private async handleSignal(from: number, m: Extract<ServerMessage, { t: 'voice' }>): Promise<void> {
    try {
      if (m.kind === 'offer' && m.sdp) {
        let p = this.peers.get(from);
        if (!p) {
          // accept if there is room (one over the cap: the other side chose us as one of its nearest)
          if (this.peers.size > this.opts.maxPeers) {
            this.net.sendVoice?.({ t: 'voice', to: from, kind: 'bye' });
            return;
          }
          p = this.createPeer(from, false);
        }
        await p.pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
        await this.flushIce(p);
        const a = await p.pc.createAnswer();
        await p.pc.setLocalDescription({ type: 'answer', sdp: mungeOpus(a.sdp ?? '', this.opts.bitrate) });
        this.net.sendVoice?.({ t: 'voice', to: from, kind: 'answer', sdp: p.pc.localDescription?.sdp });
      } else if (m.kind === 'answer' && m.sdp) {
        const p = this.peers.get(from);
        if (!p || p.pc.signalingState !== 'have-local-offer') return;
        await p.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
        await this.flushIce(p);
      } else if (m.kind === 'ice' && m.ice) {
        const p = this.peers.get(from);
        if (!p) return;
        if (!p.pc.remoteDescription) p.pendingIce.push(m.ice as RTCIceCandidateInit);
        else await p.pc.addIceCandidate(m.ice as RTCIceCandidateInit);
      }
    } catch {
      this.closePeer(from, true);
      this.retryAfter.set(from, performance.now() + 5000);
    }
  }

  private async flushIce(p: Peer): Promise<void> {
    for (const c of p.pendingIce.splice(0)) await p.pc.addIceCandidate(c).catch(() => undefined);
  }

  // ------------------------------------------------------------------ loops

  private audio(): void {
    const s = this.spatial;
    if (!s) return;
    const L = this.opts.listener();
    s.setListener(L.x, L.z, L.yaw);
    for (const id of this.peers.keys()) {
      const e = remotes.entities.get(id);
      if (e) s.setPeerPosition(id, e.render.x, e.render.z);
    }
    s.update();
  }

  private speaking(): void {
    const now = performance.now();
    if (this.localAnalyser && this.micLive) {
      this.localAnalyser.getFloatTimeDomainData(this.localBuf);
      let sum = 0;
      for (let i = 0; i < this.localBuf.length; i++) sum += this.localBuf[i] * this.localBuf[i];
      this.localVad.update(Math.sqrt(sum / this.localBuf.length), now);
    } else this.localVad.update(0, now + 10_000);
    this.sendState();
    // remote speaking from our own analysis of their stream (more responsive than the server flag)
    for (const p of this.peers.values()) {
      const info = remotes.roster.get(p.id);
      if (!info || !this.spatial) continue;
      info.voice.speaking = p.vad.update(this.spatial.level(p.id), now);
    }
  }

  private async stats(): Promise<void> {
    let changed = false;
    for (const p of this.peers.values()) {
      if (p.pc.connectionState !== 'connected') continue;
      try {
        const report = await p.pc.getStats();
        let rtt = 0;
        let lost = 0;
        let recv = 0;
        report.forEach((r: Record<string, unknown>) => {
          if (r.type === 'candidate-pair' && r.nominated && typeof r.currentRoundTripTime === 'number') rtt = r.currentRoundTripTime * 1000;
          if (r.type === 'inbound-rtp' && r.kind === 'audio') {
            lost = Number(r.packetsLost ?? 0);
            recv = Number(r.packetsReceived ?? 0);
          }
        });
        const dl = Math.max(0, lost - p.lastLost);
        const dr = Math.max(0, recv - p.lastRecv);
        p.lastLost = lost;
        p.lastRecv = recv;
        const loss = dl + dr > 0 ? (dl / (dl + dr)) * 100 : 0;
        const q: PeerStatus['quality'] = rtt > 400 || loss > 5 ? 'poor' : 'good';
        if (q !== p.status.quality) changed = true;
        p.status.quality = q;
        p.status.rttMs = Math.round(rtt);
        p.status.lossPct = +loss.toFixed(1);
      } catch {
        /* peer closing */
      }
    }
    if (changed) this.onChange?.();
  }
}

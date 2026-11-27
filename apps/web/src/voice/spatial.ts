import { VOICE } from '@speakersgarage/shared';

/**
 * Per-remote audio routing:  MediaStreamSource -> GainNode -> [StereoPannerNode] -> master -> speakers.
 *  - volume falls off linearly from VOICE.fullVolumeRadius to the connect radius (silent beyond it)
 *  - left/right panning relative to the camera (the listener faces where the camera looks); on Low and
 *    Ultra-Low tiers the panner is skipped (plain gain, less CPU)
 *  - an AnalyserNode on each stream drives the speaking indicator
 *
 * Chrome quirk: a remote WebRTC stream only produces audio in Web Audio if the same stream is also attached
 * to a (muted) <audio> element. Without it, MediaStreamSource outputs silence.
 */
export class SpatialVoice {
  readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly peers = new Map<number, Peer>();
  private listener = { x: 0, z: 0, yaw: 0 };
  deafened = false;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
  }

  resume(): Promise<void> {
    return this.ctx.state === 'suspended' ? this.ctx.resume() : Promise.resolve();
  }

  /** route a remote stream; replaces an earlier one for the same player */
  add(id: number, stream: MediaStream, spatial: boolean): void {
    this.remove(id);
    const audio = new Audio();
    audio.muted = true; // Chrome quirk (see above); the audible path is Web Audio
    audio.srcObject = stream;
    void audio.play().catch(() => undefined);
    const src = this.ctx.createMediaStreamSource(stream);
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    src.connect(gain);
    let pan: StereoPannerNode | null = null;
    if (spatial) {
      pan = this.ctx.createStereoPanner();
      gain.connect(pan);
      pan.connect(this.master);
    } else gain.connect(this.master);
    this.peers.set(id, { audio, src, gain, pan, analyser, buf: new Float32Array(analyser.fftSize), x: 0, z: 0, volume: 1, muted: false, level: 0 });
  }

  remove(id: number): void {
    const p = this.peers.get(id);
    if (!p) return;
    p.src.disconnect();
    p.gain.disconnect();
    p.pan?.disconnect();
    p.audio.srcObject = null;
    this.peers.delete(id);
  }

  has(id: number): boolean {
    return this.peers.has(id);
  }

  setPeerPosition(id: number, x: number, z: number): void {
    const p = this.peers.get(id);
    if (p) {
      p.x = x;
      p.z = z;
    }
  }

  /** per-player volume (0..2) and mute, set from the player menu */
  setPeerVolume(id: number, volume: number, muted: boolean): void {
    const p = this.peers.get(id);
    if (p) {
      p.volume = volume;
      p.muted = muted;
    }
  }

  setListener(x: number, z: number, yaw: number): void {
    this.listener.x = x;
    this.listener.z = z;
    this.listener.yaw = yaw;
  }

  setDeafened(on: boolean): void {
    this.deafened = on;
    this.master.gain.setTargetAtTime(on ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  /** ~20 Hz: distance gain and panning from the listener (camera) orientation. No allocations. */
  update(): void {
    const L = this.listener;
    // camera yaw 0 looks north (-z); its right vector is (cos yaw, -sin yaw)
    const rx = Math.cos(L.yaw);
    const rz = -Math.sin(L.yaw);
    const t = this.ctx.currentTime;
    for (const p of this.peers.values()) {
      const dx = p.x - L.x;
      const dz = p.z - L.z;
      const d = Math.hypot(dx, dz);
      const k = 1 - Math.min(1, Math.max(0, (d - VOICE.fullVolumeRadius) / (VOICE.connectRadius - VOICE.fullVolumeRadius)));
      const target = p.muted ? 0 : k * p.volume;
      p.gain.gain.setTargetAtTime(target, t, 0.08);
      if (p.pan) {
        const side = d > 0.01 ? (dx * rx + dz * rz) / d : 0;
        p.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, side * 0.85)), t, 0.08);
      }
    }
  }

  /** RMS level (0..1) of a remote stream, before volume/distance (for the speaking indicator). */
  level(id: number): number {
    const p = this.peers.get(id);
    if (!p) return 0;
    p.analyser.getFloatTimeDomainData(p.buf as Float32Array<ArrayBuffer>);
    let s = 0;
    for (let i = 0; i < p.buf.length; i++) s += p.buf[i] * p.buf[i];
    return Math.sqrt(s / p.buf.length);
  }

  /** output device where supported (Chrome 110+: AudioContext.setSinkId) */
  async setOutputDevice(deviceId: string): Promise<boolean> {
    const c = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (!c.setSinkId) return false;
    await c.setSinkId(deviceId);
    return true;
  }

  close(): void {
    for (const id of [...this.peers.keys()]) this.remove(id);
    void this.ctx.close().catch(() => undefined);
  }
}

interface Peer {
  audio: HTMLAudioElement;
  src: MediaStreamAudioSourceNode;
  gain: GainNode;
  pan: StereoPannerNode | null;
  analyser: AnalyserNode;
  buf: Float32Array;
  x: number;
  z: number;
  volume: number;
  muted: boolean;
  level: number;
}

/**
 * Speaking detector over an RMS level: on above `on`, off after `hangMs` below `off` (hysteresis), so the
 * indicator doesn't flicker between words.
 */
export class Vad {
  speaking = false;
  private quietSince = 0;
  constructor(
    private readonly on = 0.02,
    private readonly off = 0.012,
    private readonly hangMs = 350,
  ) {}
  update(level: number, now: number): boolean {
    if (level > this.on) {
      this.speaking = true;
      this.quietSince = 0;
    } else if (level < this.off && this.speaking) {
      if (!this.quietSince) this.quietSince = now;
      else if (now - this.quietSince > this.hangMs) this.speaking = false;
    }
    return this.speaking;
  }
}

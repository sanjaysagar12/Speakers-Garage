/**
 * Fully synthesised ambience — no audio files. Three beds (wind through grass, lake water, campfire
 * crackle) whose levels the scene drives from what is actually around the player, plus occasional
 * birdsong. Plain Web Audio; nothing here touches Phaser.
 */
export class AmbientAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private waterGain: GainNode | null = null;
  private fireGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private muted: boolean;
  private nextCrackle = 0;
  private nextBird = 4000;
  private started = false;
  private wind = 0.3;
  private water = 0;
  private fire = 0;
  private readonly unlock = () => this.resume();

  constructor(muted: boolean) {
    this.muted = muted;
  }

  start(): void {
    if (this.started) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.started = true;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.75;
    this.master.connect(ctx.destination);

    // 6 seconds of pink-ish noise, looped, shared by every bed
    const len = ctx.sampleRate * 6;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    this.noiseBuf = buf;

    // --- wind: band-passed noise, centre frequency rising with strength
    {
      const src = this.loop(ctx, buf);
      src.playbackRate.value = 0.75;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 520;
      bp.Q.value = 0.7;
      this.windFilter = bp;
      const g = ctx.createGain();
      g.gain.value = 0.1;
      this.windGain = g;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.08;
      const lg = ctx.createGain();
      lg.gain.value = 240;
      lfo.connect(lg).connect(bp.frequency);
      src.connect(bp).connect(g).connect(this.master);
      lfo.start();
    }
    // --- water: low-passed noise with a slow swell
    {
      const src = this.loop(ctx, buf);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.value = 0;
      this.waterGain = g;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 1 / 7.5;
      const lg = ctx.createGain();
      lg.gain.value = 320;
      lfo.connect(lg).connect(lp.frequency);
      src.connect(lp).connect(g).connect(this.master);
      lfo.start();
    }
    // --- fire bus, fed by one-shot crackles
    this.fireGain = ctx.createGain();
    this.fireGain.gain.value = 0;
    this.fireGain.connect(this.master);

    window.addEventListener('pointerdown', this.unlock);
    window.addEventListener('keydown', this.unlock);
    this.resume();
  }

  private loop(ctx: AudioContext, buf: AudioBuffer): AudioBufferSourceNode {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start(0, Math.random() * 5);
    return s;
  }

  setWind(v: number): void {
    this.wind = v;
  }
  setWater(v: number): void {
    this.water = v;
  }
  setFire(v: number): void {
    this.fire = v;
  }

  resume(): void {
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }
  suspend(): void {
    if (this.ctx?.state === 'running') void this.ctx.suspend();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.75, this.ctx.currentTime, 0.08);
  }

  /** a short synthesised bird call */
  private birdCall(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const t = ctx.currentTime;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const g = ctx.createGain();
      const st = t + i * (0.1 + Math.random() * 0.1);
      const f0 = 1900 + Math.random() * 1300;
      o.frequency.setValueAtTime(f0, st);
      o.frequency.exponentialRampToValueAtTime(f0 * (1.2 + Math.random() * 0.5), st + 0.05);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.85, st + 0.12);
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.03, st + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.14);
      o.connect(g).connect(this.master);
      o.start(st);
      o.stop(st + 0.16);
    }
  }

  update(timeMs: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.noiseBuf) return;
    const now = ctx.currentTime;
    this.windGain?.gain.setTargetAtTime(0.03 + this.wind * 0.1, now, 0.4);
    if (this.windFilter) this.windFilter.frequency.setTargetAtTime(420 + this.wind * 700, now, 0.5);
    this.waterGain?.gain.setTargetAtTime(this.water * 0.13, now, 0.5);
    this.fireGain?.gain.setTargetAtTime(this.fire * 0.9, now, 0.2);

    if (this.fire > 0.02 && timeMs >= this.nextCrackle) {
      this.nextCrackle = timeMs + 60 + Math.random() * 220;
      const s = ctx.createBufferSource();
      s.buffer = this.noiseBuf;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1800 + Math.random() * 2500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.16 * Math.random() + 0.03, now + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.03 + Math.random() * 0.04);
      s.connect(hp).connect(g).connect(this.fireGain!);
      s.start(now, Math.random() * 5, 0.1);
    }
    if (timeMs >= this.nextBird) {
      this.nextBird = timeMs + 5000 + Math.random() * 16000;
      this.birdCall();
    }
  }

  destroy(): void {
    window.removeEventListener('pointerdown', this.unlock);
    window.removeEventListener('keydown', this.unlock);
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.master = null;
    this.started = false;
  }
}

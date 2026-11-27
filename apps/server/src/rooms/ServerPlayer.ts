import { NET, RATE, Writer, type AvatarConfig, type EntityState, type InputCommand, type PlayerInfo, type PlayerSim } from '@shoreline/shared';
import { TokenBucket } from '../net/ratelimit';

/** The server side of one connection. Anything that can carry text and binary frames (ws, tests, bots). */
export interface Transport {
  sendText(text: string): void;
  sendBinary(bytes: Uint8Array): void;
  close(code: number, reason: string): void;
  /** bytes queued but not yet sent (backpressure) */
  readonly bufferedAmount: number;
}

/** One player in a room. Owns its authoritative state, its input queue and what it has been sent. */
export class ServerPlayer {
  transport: Transport | null;
  disconnectedAt = 0;
  /** commands received but not applied yet */
  readonly queue: InputCommand[] = [];
  /** newest sequence number queued / applied (65535 = "before 0") */
  lastQueuedSeq = 65535;
  lastAppliedSeq = 65535;
  /** last time a command was applied (ms) */
  lastCommandAt = 0;
  run = false;
  wade = 0;
  /** 0 = none, 1 + EMOTES index */
  emote = 0;
  emoteUntil = 0;
  readonly voice = { joined: false, muted: false, speaking: false };
  /** this tick's quantized state, as others see it */
  readonly entity: EntityState;
  /** entities in this player's area of interest -> what was last sent to it */
  readonly inView = new Map<number, EntityState>();
  /** per-connection snapshot buffer (reused every tick) */
  readonly writer = new Writer(1024);
  readonly commands: TokenBucket;
  readonly buckets: Record<'messages' | 'chat' | 'emote' | 'avatar' | 'voice', TokenBucket>;
  private violationTimes: number[] = [];
  bytesOut = 0;
  bytesIn = 0;

  constructor(
    readonly id: number,
    public name: string,
    public avatar: AvatarConfig,
    readonly sim: PlayerSim,
    readonly resumeToken: string,
    transport: Transport,
    now: number,
  ) {
    this.transport = transport;
    this.entity = { id, x: 0, z: 0, y: 0, heading: 0, anim: 0, speed: 0 };
    this.commands = new TokenBucket(NET.commandRate, NET.commandBurst, now);
    this.buckets = {
      messages: new TokenBucket(RATE.messages.rate, RATE.messages.burst, now),
      chat: new TokenBucket(RATE.chat.rate, RATE.chat.burst, now),
      emote: new TokenBucket(RATE.emote.rate, RATE.emote.burst, now),
      avatar: new TokenBucket(RATE.avatar.rate, RATE.avatar.burst, now),
      voice: new TokenBucket(RATE.voice.rate, RATE.voice.burst, now),
    };
  }

  get connected(): boolean {
    return this.transport !== null;
  }

  info(): PlayerInfo {
    return { id: this.id, name: this.name, avatar: this.avatar, voice: { ...this.voice } };
  }

  /** Record a rule violation; returns true when the connection should be closed. */
  violation(now: number): boolean {
    this.violationTimes.push(now);
    while (this.violationTimes.length && now - this.violationTimes[0] > 60_000) this.violationTimes.shift();
    return this.violationTimes.length > RATE.maxViolationsPerMinute;
  }

  send(text: string): void {
    if (!this.transport) return;
    this.bytesOut += text.length;
    this.transport.sendText(text);
  }

  sendBinary(bytes: Uint8Array): void {
    if (!this.transport) return;
    this.bytesOut += bytes.byteLength;
    this.transport.sendBinary(bytes);
  }

  /** New session (join or resume): sequence numbering restarts, queued input and view state are dropped. */
  resetSession(now: number): void {
    this.queue.length = 0;
    this.lastQueuedSeq = 65535;
    this.lastAppliedSeq = 65535;
    this.lastCommandAt = now;
    this.inView.clear();
  }
}

/**
 * Network and multiplayer limits shared by the client and the server. The server may override the
 * deployment-specific ones (tick rate, room size, radii) from its environment; the rest are protocol.
 */
export const PROTOCOL_VERSION = 1;

export const NET = {
  /** movement simulation rate on both sides (one input command per step) */
  stepHz: 60,
  /** default server tick: commands are applied and snapshots sent at this rate */
  tickRate: 20,
  /** client input packets per second (commands are batched) */
  sendHz: 20,
  /** commands accepted per packet; a client that stalled sends its backlog in a few packets */
  maxCommandsPerPacket: 16,
  /** anti speed-hack: commands per second a player may spend (token bucket), plus burst */
  commandRate: 60,
  commandBurst: 20,
  /** commands queued on the server per player before new ones are dropped */
  maxQueuedCommands: 30,
  /** area of interest: entities within this radius (m) are sent; leaving needs radius + hysteresis */
  aoiRadius: 40,
  aoiHysteresis: 4,
  maxPlayersPerRoom: 50,
  /** largest accepted WebSocket message (bytes): a WebRTC audio SDP is ~1.5-4 KB */
  maxMessageBytes: 16_384,
  /** largest binary (hot path) message: 4 + 5 x 16 commands */
  maxBinaryBytes: 256,
  /** a dropped player can resume the same id and position within this window */
  reconnectWindowMs: 10_000,
  heartbeatMs: 5_000,
  timeoutMs: 15_000,
  /** fixed-point scale for positions in snapshots: 1/100 m (int16 covers ±327 m) */
  posScale: 100,
  /** speed byte: 0.05 m/s per unit (0..12.75 m/s) */
  speedScale: 20,
  chatMaxLength: 140,
  nameMaxLength: 18,
  roomIdMaxLength: 24,
} as const;

/** Proximity voice. Distances in metres. */
export const VOICE = {
  connectRadius: 12,
  disconnectRadius: 15,
  /** the server relays signaling only between players this close (slack for movement during setup) */
  relayRadius: 18,
  maxPeers: 6,
  maxPeersLow: 3,
  bitrate: 32_000,
  bitrateLow: 20_000,
  /** volume is full inside this distance and falls to zero at connectRadius */
  fullVolumeRadius: 2,
  /** listener/panner update rate (Hz) */
  updateHz: 20,
} as const;

/** Rate limits per connection (token buckets: per second, burst). */
export const RATE = {
  messages: { rate: 60, burst: 120 },
  chat: { rate: 1, burst: 4 },
  emote: { rate: 1, burst: 3 },
  avatar: { rate: 0.5, burst: 2 },
  voice: { rate: 30, burst: 60 },
  /** violations (dropped messages) tolerated per minute before the connection is closed */
  maxViolationsPerMinute: 40,
} as const;

export const EMOTES = ['wave', 'dance', 'sit'] as const;
export type Emote = (typeof EMOTES)[number];

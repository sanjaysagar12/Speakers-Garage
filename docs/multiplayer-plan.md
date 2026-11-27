# Multiplayer technical plan (iteration 7)

Branch `feat/multiplayer`, created from `optimize/low-end` after iteration 6 is committed.

## Before starting: differences between the spec and the code

- **"gait/IK animation"**: there is no IK yet. The character has a procedural, speed-driven gait in
  `models/character/Character.ts` (the "make walking realistic" bug 2 was never received). That gait is
  what remote players will use. It is driven by the distance travelled, so feet don't skate.
- **Docker is not installed here.** I will write the coturn compose file, `turnserver.conf` and the
  server Dockerfile, but I can't run them on this machine. Voice between two headless browsers on the
  same host works over host ICE candidates without TURN. Voice across separate networks needs coturn and
  stays unverified until it is run on a machine with Docker.
- **pnpm** is not installed globally. Corepack is, so `packageManager` in `package.json` pins pnpm and
  `corepack enable` provides it.
- **Vinland** is still kept, so it moves to `packages/shared` together with the beach.

## Package split

`packages/shared` must be pure TypeScript (no DOM, no three.js), but movement currently depends on
modules that also build three.js meshes. The split:

| Moves to `shared` (pure) | Stays in `apps/web` (render) |
|---|---|
| `config` sim constants (speeds, radius, step height, tick, limits) | camera, effects, quality tiers, governor |
| `maps/types` → `MapData` (bounds, spawn, props, decks, interactions, height/terrain/wade/blocked queries) | `GameMap = MapData & { Ground, background, minimapColor, ambient }` |
| `beach/field.ts`, the beach and Vinland data builders, `beach.json`, `vinland.json` | `BeachGround`, `VinlandGround`, ground materials |
| prop **footprints** and metadata (from `catalog.ts`), `pierLayout` math | prop **builders** (three.js geometry) |
| `deck.ts`, `CollisionGrid`, `controller.ts` (`stepMovement`), noise/rng/smoothstep | `Player.tsx` (reads input, calls the shared step) |
| protocol: binary codecs, zod schemas, avatar whitelist, name rules | |

The web build keeps lazy map chunks: `loadMap()` imports the shared map data and the render module together.

## Simulation and prediction

- **Fixed step 1/60 s** on the client: an accumulator turns frame time into 60 Hz steps. Each step
  produces an input command `{seq, dx, dz, run, yaw}` (dt is implied: 1/60, sent as a byte for validation)
  and runs `stepMovement` immediately (prediction). The render position is interpolated between the last two
  steps, so the 60 Hz step looks smooth at any frame rate.
- Commands are batched and sent every 50 ms (3 per packet; up to 8 after a stall).
- **Server tick 20 Hz** (`TICK_RATE`), on a drift-corrected `setTimeout` with `performance.now()`. Per
  tick, for each player: apply the queued commands through the same `stepMovement` with the same
  collision grid, up to a budget (a token bucket of about 60 commands/s plus a small burst). Excess
  commands are dropped, which defeats speed hacks. The server never reads a position from the client.
- **Reconciliation**: each snapshot carries `lastProcessedSeq` and the authoritative state for self. The
  client rewinds to it, replays the unacknowledged commands, and compares with what it predicted. An error
  under 1.5 m is blended away over about 100 ms; a larger one snaps.
- **Determinism test**: one recorded input sequence runs through the client path (accumulator + batching +
  reconciliation) and through the server `Room`, and the final positions must be bit-equal.

## Remote players

- **Snapshot interpolation** with a render delay of 2 ticks + jitter (100 to 150 ms, adapted from the
  measured inter-arrival variance). A ring buffer of 8 snapshots per entity, no allocations per snapshot.
- When a snapshot is late: extrapolate along the last velocity for up to 200 ms, then hold.
- Velocity from the interpolated motion drives the gait. The animation byte carries emote and sit state.
- Per-tier cap on rendered remotes, nearest first (Ultra-Low 8, Low 15, Medium 30, High 60). Distant ones
  animate at a lower rate (as today). Character meshes are cached per avatar config with an LRU limit per
  tier.

## Protocol

Every binary message starts with a `u8` message type. Positions are int16 fixed point at 1/100 m
(±327 m, enough for both maps, quantization error ≤ 5 mm). Heading is `u16` (2π/65536).

| Dir | Message | Encoding | Content |
|---|---|---|---|
| C→S | `join` | JSON | `{protocolVersion, name, avatar, room, resumeToken?}` |
| C→S | `input` | binary | `u16 firstSeq, u8 n, n × {i8 dx, i8 dz, u8 flags(run), u16 yaw, u8 dtMs}` |
| C→S | `chat` / `emote` / `avatarUpdate` | JSON | text ≤ 140 chars / emote id / avatar config |
| C→S | `voice` | JSON | `{to, kind: offer, answer, ice or state, payload}` |
| C→S | `ping` | binary | `u32 clientTime` (the RTT appears in the HUD) |
| S→C | `welcome` | JSON | `{selfId, resumeToken, tickRate, room, players[], ice: {urls, username, credential}}` |
| S→C | `snapshot` | binary | `u32 tick, u16 lastSeq, self {x,z,y,vx,vz}` as floats (exact, needed for reconciliation), `u8 n`, `n × {u16 id, i16 x, i16 z, i16 y, u16 heading, u8 anim, u8 speed}` |
| S→C | `spawn` / `despawn` | JSON | entity enters or leaves the area of interest (profile + state) |
| S→C | `playerJoined` / `playerLeft` / `avatarChanged` / `chat` / `emote` / `voice` / `error` | JSON | |
| S→C | `pong` | binary | echoes `clientTime` |

**Delta compression**: an entity whose quantized state did not change since the last snapshot sent to that
client is omitted. An idle crowd costs about 12 bytes per snapshot.

**Area of interest**: each client gets only the entities within 40 m (`AOI_RADIUS`), with hysteresis at
44 m. Entering or leaving the area sends a spawn or despawn.

## Server

Fastify 5 with `@fastify/websocket`, `cors`, `helmet` and `rate-limit`, pino logging, and the env config
validated with zod.

- `GET /health`, `GET /rooms`, and `WS /ws?room=`.
- `RoomManager` creates rooms lazily (capacity 50) and destroys them when empty. A `Room` owns the players,
  the tick and the voice relay. `PlayerStore` is an interface with an in-memory implementation. Room state
  sits behind `RoomBus` (local now; Redis later, documented only).
- **Validation**: zod schemas for JSON messages, a 4 KB message size cap, and a per-connection token
  bucket per message class. The connection is closed after repeated violations. Names are 1 to 18
  letters, digits, space and `-_.'`, trimmed, with no HTML and a small profanity mask. The avatar
  whitelist is built from the customizer catalog.
- **Lifecycle**: ping every 5 s and drop after 15 s without traffic. On disconnect, the player stays
  resumable for 10 s via `resumeToken`, which restores the id and position. A second tab with the same
  token takes over and closes the old socket.
- **Spawn**: points on a ring around the map spawn, skipping occupied spots, and pushed to the nearest
  free cell of the collision grid.
- **Voice relay**: forwarded only between two players of the same room within 15 m (checked on the
  server), and rate-limited.
- **TURN**: `TURN_URLS` + `TURN_SECRET`. Credentials use the coturn REST scheme: username `expiry:id`,
  password `base64(HMAC-SHA1(secret, username))`, with a 1 h lifetime. STUN fallback is
  `stun:stun.l.google.com:19302`.

## Voice

```
A (client)                         server                          B (client)
  | voice-state{joined}  ───────────▶ relay to peers in range ───────▶ |
  | proximity: B within 12 m, and A.id < B.id, so A makes the offer      |
  | offer  ──────────────▶ checks room + distance ≤ 15 m ────────────▶ |
  | ◀───────────────────── answer ◀───────────────────────────────────  |
  | ◀──────────────────── ice ⇄ ice (trickle) ────────────────────────▶ |
  | ═════════════ P2P Opus audio (DTLS-SRTP), never via the server ════ |
  | beyond 15 m: close the PeerConnection (12/15 hysteresis), cap N nearest |
```

- `VoiceAdapter` interface; `MeshVoiceAdapter` implemented; `LiveKitVoiceAdapter` is a documented stub.
- Microphone only after "Join voice". Constraints: echo cancellation, noise suppression, auto gain,
  mono. Opus is capped with `RTCRtpSender.setParameters` maxBitrate (32 kbps, or 20 kbps on Low and
  Ultra-Low), and the SDP munges `usedtx=1`.
- Per remote: `MediaStreamSource → Gain → (StereoPanner on Medium/High) → destination`, plus a muted
  `<audio>` element (Chrome quirk). Gain falls off linearly from 2 m to 12 m. Pan uses the camera's
  right vector. Updated at 20 Hz.
- Speaking: an `AnalyserNode` RMS with hysteresis, checked every 100 ms. The local speaking flag goes to
  the server as `voice-state`; remote rings use the local analysis.
- Controls: M mute, hold V push-to-talk (setting), deafen, device pickers (`setSinkId` where supported),
  per-player volume, mute and block (right-click; kept for the session), a live-mic indicator. Peer
  caps: 6 (Medium and High) or 3 (Low and Ultra-Low). On ICE failure: `restartIce()` once, then close
  and retry after a backoff.

## File list (new)

```
package.json, pnpm-workspace.yaml, turbo.json, .env.example, .prettierrc
packages/config/       tsconfig.base.json, eslint.config.js, prettier
packages/shared/src/   config.ts, map/{types,deck,field,beach,vinland,props,pier,collision}.ts, sim/{step,commands}.ts,
                       protocol/{codec,messages,schemas,avatar,names}.ts, util/{noise,rng}.ts; tests/*.test.ts
apps/server/src/       index.ts, env.ts, app.ts, rooms/{RoomManager,Room,Player,aoi,spawn}.ts, store/PlayerStore.ts,
                       net/{connection,ratelimit}.ts, voice/{relay,turn}.ts; tests/*.test.ts; loadtest/bots.ts; Dockerfile
apps/web/src/net/      WebSocketAdapter.ts, prediction.ts, interpolation.ts, entities.ts (mutable store)
apps/web/src/voice/    VoiceAdapter.ts, MeshVoiceAdapter.ts, LiveKitVoiceAdapter.ts, spatial.ts, vad.ts
apps/web/src/ui/       ConnectionStatus, ChatPanel, VoicePanel, PlayerMenu, Nameplates (in engine/), RoomPicker
infra/                 docker-compose.yml (coturn, server profile, redis commented), coturn/turnserver.conf
```

`NetworkAdapter` is extended, not broken: the existing methods stay, and optional `chat`, `emote`,
`avatar`, `voice` and `status` hooks are added. `LocalAdapter` still satisfies the interface.

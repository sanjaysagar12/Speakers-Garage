# Multiplayer: measured results and known limitations (iteration 7)

All numbers below were measured on this development machine (16 cores, WSL2). The browser tests use
headless Chromium with **software rendering (SwiftShader)**: each browser runs at 2 to 10 FPS and sends
its input in bursts, which is far worse than a real device. That makes them a stress test for smoothing,
not a picture of normal play.

## Server (load test: `pnpm --filter @speakersgarage/server loadtest`)

Bots random-walk in one room, send input exactly like the client (3 commands per 50 ms) and decode every
snapshot. The server is a separate process (production mode), 20 Hz tick, 40 m area of interest.

| | 50 bots | 100 bots |
|---|---|---|
| Server CPU per tick | 4.2 ms (8% of one core) | 8.5 ms (17% of one core) |
| Tick time avg / p95 (inside the tick) | 3.1 / 4.4 ms | 7.1 / 8.9 ms |
| Memory (RSS / JS heap) | 147 / 46 MB | 159 / 48 MB |
| Download per client, everyone in view | **12.2 KB/s** (49 in view) | 24 KB/s (99 in view) |
| Download per client, averaged over the run | 7.9 KB/s (28 in view) | 13.2 KB/s (52 in view) |
| Disconnects | 0 | 0 |

Target "< 15 KB/s per client at 50 players in view": met (12.2 KB/s). The per-entity cost is 12 bytes
per changed entity per snapshot; idle players cost nothing (delta compression).

**CPU profile (100 bots):** 83% idle. The largest single cost is the kernel `writev` of one snapshot per
client per tick (3.4%), then the tick loop (1.8%) and the collision probes of the movement step. No
hotspot justified changing behaviour.

## Two real browsers (`apps/web/scripts/mp-check.mjs`)

B walks a scripted route (walk, turn, run); A records where it renders B on every frame. The network
column is a TCP proxy between the clients and the server (latency split over both directions, jitter
added per direction, loss as a retransmission stall, order preserved like TCP).

| Network | B walked | A renders B: median / p95 speed | max | hitches | interp. delay | B's largest correction | refresh resumes |
|---|---|---|---|---|---|---|---|
| local | 15.0 m | 3.29 / 6.90 m/s | 7.2 m/s | 0 | 104 ms | **0 m** | yes |
| +100 ms RTT | 10.1 m | 3.23 / 5.85 m/s | 6.8 m/s | 0 | 102 ms | **0 m** | yes |
| +200 ms RTT, +40 ms jitter | 13.1 m | 3.01 / 9.03 m/s | 12.0 m/s | 1 | 300 ms | **0 m** | yes |
| +60 ms RTT, 5% loss | 10.1 m | 3.35 / 9.28 m/s | 10.3 m/s | 3 | 253 ms | **0 m** | yes |

(Walk speed is 3.4 m/s, run 6.4 m/s. A "hitch" is a frame where B's rendered speed drops to ~0 between
two moving frames.)

- **Prediction hides the latency completely.** B's own movement never needed a correction, at any
  latency: the client and the server run the same step on the same quantized commands. (The first
  200 ms run showed a 0.79 m correction: the server's per-player input queue was 30 commands, and a
  software-rendered client sends bursts of up to ~36. The queue is now 60 commands; speed is still
  capped by the real-time command budget, not by the queue.)
- **Remote players stay smooth.** The interpolation delay adapts from 100 ms to 300 ms with the measured
  jitter. Late data is extrapolated briefly, and any remaining correction is shown as a catch-up capped
  at 10 m/s instead of a jump (before this cap, single frames showed jumps over 100 m/s).
- **Loss.** Over TCP a lost segment stalls the stream (head-of-line blocking), so 5% loss looks like
  bursts of 200+ ms jitter. The delay grows to ~250 ms and a few frames hold B still for a moment (3
  hitches in 6 s). This is the inherent cost of WebSockets; a WebRTC data channel (unordered,
  unreliable) for snapshots would remove it.
- Chat, emotes (A sees B's wave) and refresh (same player id, same position) work in every scenario.

## Voice (`apps/web/scripts/voice-check.mjs`, fake microphone)

| Check | Result |
|---|---|
| Two players 2 m apart join voice | peer connected in **506 ms**, quality "good" |
| B speaks (tone bursts) | A detects B speaking from B's audio stream |
| B mutes (M) | 0 of 10 speaking samples afterwards; the server reports B muted |
| B runs away | peer closed on both sides at **15.18 m** (disconnect radius 15 m) |

## Single-player and performance (no regression)

- With no server, or **Offline** chosen, the game runs as before (smoke test: landing, world, pier,
  wardrobe, all tiers, leave). The first online attempt fails fast and falls back to offline.
- Movement now runs on a fixed 60 Hz step, so it moves in real time at any frame rate. The old
  per-frame 0.05 s clamp made the player slower below 20 FPS. At 20 FPS and above, movement is
  unchanged.
- Against the optimization pass (`scripts/perf.mjs`, same machine, SwiftShader, offline fallback):

  | | Ultra-Low before → now | Low before → now |
  |---|---|---|
  | FPS avg / 1% low | 7.7 / 2.4 → 7.3 / 2.2 | 2.5 / 0.5 → 3.4 / 1.2 |
  | Draw calls / triangles | 75 / 139k → 68 / 136k | 147 / 297k → 142 / 297k |
  | JS heap after 2 min | 70.8 → 70.0 MB | 72.9 → 73.3 MB |
  | Download: landing / entering the world | 289 / 66 → 291 / 84 KB | same |

  Differences are within run-to-run noise. The landing chunk is 7.8 KB gzip (5.6 before; the room
  picker). The world chunk grew by ~12 KB gzip (networking, voice, social UI) and is still loaded only
  on entry. zod is not in the web bundle (the server-only schemas live in `@speakersgarage/shared/schemas`).
- A fresh clone passes `pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm lint && pnpm test`.

## Known limitations

- **Mesh voice** sends your audio once per peer: fine for ~6 people within earshot (the default cap), a
  bandwidth problem beyond. The documented path is an SFU (`LiveKitVoiceAdapter`).
- **Voice across networks is not verified here.** There is no Docker on this machine, so coturn and the
  server image were written but never run. Voice between the two test browsers works over host ICE
  candidates (same machine). Players behind symmetric NATs need the TURN server.
- **TCP head-of-line blocking** (above). A WebRTC data channel for snapshots is the fix if lossy mobile
  networks matter.
- **One process.** Rooms can't move between processes yet (see README, scaling).
- **The avatar whitelist** checks item ids strictly; colours only need to be valid `#RRGGBB`, because the
  customizer has a free colour picker.
- **Gait/IK:** remote players use the existing distance-driven procedural gait (no IK exists in the
  project; the "make walking realistic" request was never received).
- **Proximity uses the client's view** of positions (interpolated, ~100 ms old). The server re-checks
  distance before relaying signaling, with 3 m of slack.
- Speaking state for players you have no voice connection with comes from their own client (trusted for
  the indicator only).

# Shoreline

A stylized 3D beach world in the browser (frontend only). One playable character, a beach map and a second
map (Vinland). Everything you see (terrain, water, props, characters) is built procedurally in code; nothing
is downloaded besides the JavaScript.

Vite + React 18 + TypeScript, three.js via React Three Fiber / drei / postprocessing, Zustand for shared
state, Tailwind for the UI overlays, EasyStar for click-to-walk pathfinding.

## Run

```bash
npm ci
npm run dev            # Vite dev server on http://localhost:5173
npm run build          # typecheck + production bundle in dist/ (with .gz/.br next to each file)
npm run preview        # serve dist/
npm run lint           # ESLint, zero warnings allowed
npm run typecheck
npm run test:movement  # headless pier/collision movement tests (Vitest)
```

Controls: WASD / arrows move (relative to the camera), Shift runs, click/tap to walk there, right-drag or
Q/E rotates the camera, R resets it, wheel/pinch zooms, F / Space / Enter interacts. Touch devices get an
on-screen joystick.

## Layout

```
src/App.tsx, src/ui/        React UI: landing, loading screen, HUD, minimap, dialogs, customizer, settings
src/WorldScreen.tsx         the in-world screen (lazy loaded: the landing page does not download three.js)
src/game/GameCanvas.tsx     staged loader: detect quality tier -> load map -> mount the canvas
src/game/engine/            the scene: World, Player, camera, props, sun, ambient life, post-processing, controller
src/game/maps/              map registry (each map is its own lazily loaded chunk), beach/, vinland/, decks
src/game/models/            procedural models (nature, structures, character) and the prop catalog
src/game/materials/         toon shader material, shared uniforms, GLSL helpers
src/game/systems/           collision grid, pathfinding, ambient audio
src/game/perf/              quality-tier detection, adaptive governor, frame driver, frame stats
src/game/net/               NetworkAdapter (multiplayer seam; only a local adapter exists)
src/store/                  zustand store (profile, UI state, persisted settings), hot input state
src/game/config.ts          every tunable constant, including the quality tier table
scripts/                    measurement, smoke and screenshot scripts (see below)
docs/                       look bible, perf report, cleanup report
```

## Quality tiers

The game has four quality tiers. The full settings table is in `src/game/config.ts` (`QUALITY`) and in
`docs/perf-report.md`.

| Tier      | Resolution (DPR) | Shadows             | Water / ground                  | Post-processing          | Ambient life                 |
|-----------|------------------|---------------------|---------------------------------|--------------------------|------------------------------|
| Ultra-Low | 0.6 to 1         | off                 | simplest water, half-res ground | off, colour grade baked  | no gulls, crabs, smoke       |
| Low       | 0.75 to 1        | 512 px, near only   | single foam line, no lace       | FXAA, colour grade baked | few gulls and crabs          |
| Medium    | 1 to 1.5         | 1024 px             | full                            | full (bloom at half res) | full                         |
| High      | 1 to 2           | 2048 px             | full                            | full                     | full, longest view distance  |

All tiers keep the same world, collisions, controls and gameplay. Lower tiers draw less far, thin out
small decoration, use a cheaper palm model at a distance and run fewer particles.

**How the tier is chosen**

1. **Auto (default).** On first entry the game checks the device (CPU cores, memory, GPU name, mobile or
   not) and runs a short GPU benchmark (about a second, behind the loading screen). The result is cached,
   so later visits skip the benchmark. Software renderers (for example SwiftShader) always get Ultra-Low.
2. **Governor (Auto only).** While playing, if the frame rate stays under 45 FPS for 3 seconds the game
   first lowers the resolution, then drops one tier. If it stays above 58 FPS for 10 seconds it goes up
   one tier. A cooldown and a limit on flips stop it from oscillating.
3. **Manual override.** The gear button in the HUD opens the settings: Auto or a fixed tier, an FPS cap
   (60 or 30, which saves battery) and "re-test this device". The choice is saved in the browser.

Rendering also pauses while the tab is hidden.

## Profiling

Dev-only tools (compiled out of production builds):

- **F2**: stats overlay (FPS, frame time, draw calls, triangles, geometries, textures, programs, JS heap,
  current tier and DPR, governor state).
- **F3**: debug overlay (collision grid, guard cells, decks, player collider) and debug panel.
- `?shots` in the URL: a fixed screenshot scene used by `npm run shots`.

Scripts:

```bash
npm run size                       # build output sizes (raw / gzip / brotli per chunk) + project counts
npm run analyze                    # bundle treemap at dist/stats.html
npm run perf -- --label x --quality low [--throttle 4] [--mobile] [--leak] [--walk 30] [--heapAt 120]
                                   # production build with test hooks; FPS, 1% low, draw calls,
                                   # triangles, heap, time to interactive, optional 5x re-entry leak check
                                   # -> perf-results/<label>.json
npm run smoke                      # load, enter world, walk to the pier, open the customizer, cycle tiers
npm run smoke -- --preview         # the same against the production build (run this after build-config changes)
node scripts/tier-shots.mjs out high,med,low,ultralow   # same-spot screenshots per tier
npm run pier-check                 # walks the pier with the F3 overlay on, saves screenshots
npm run shots                      # contact sheets of the models
```

The perf and smoke scripts use headless Chromium, which renders with SwiftShader (software GL). Its FPS
numbers are far below real hardware and only useful for before/after comparisons; draw calls, triangles,
heap and bundle sizes are exact. Playwright needs its browser installed (`npx playwright install chromium`).

## Adding a map

1. Create `src/game/maps/<id>/index.ts` that exports a `GameMap` (see `src/game/maps/types.ts`).
2. Add the id and name to `src/game/maps/ids.ts` and a loader line to `LOADERS` in
   `src/game/maps/registry.ts`. Each map becomes its own chunk, loaded when the player enters it.

Props are placed by type from the catalog in `src/game/models/catalog.ts`. Interactive spots are the map's
`interactions` (kind `bubble` or `modal`, title, text, radius, optional action).

## Notes

- Multiplayer seam: `src/game/net/NetworkAdapter.ts` (`join / sendMove / onPlayerJoined / Left / Moved`).
  Only a local adapter exists.
- Ambient audio is synthesised with Web Audio (waves, wind, gulls, campfire). It starts after "Enter
  world" and is suspended while muted.
- `npm run assets` still rebuilds the old 2D sprite atlases from `scripts/art/`. The 3D game does not
  use them; see `docs/cleanup-report.md`.

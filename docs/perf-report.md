# Performance report (branch `optimize/low-end`)

## How these numbers were measured

- `npm run perf` (`scripts/perf.mjs`): a production build with test hooks, served by `vite preview`, driven
  by headless Chromium. It loads the landing page, enters the world, walks 30 s (15 s forward, 15 s back),
  reads `renderer.info` and measures the JS heap after a forced GC at 120 s in the world (300 s for the
  leak run).
- **The renderer is SwiftShader (software GL on the CPU).** Its FPS is 20 to 100 times below a real GPU,
  so treat the FPS columns only as relative (before vs after, tier vs tier). Draw calls, triangles,
  geometries, textures, programs, heap, bytes and load times do not depend on the GPU and are exact.
- "Before" is commit `a340399` (baseline). Its tiers were `low` / `med` / `high`. Ultra-Low did not exist,
  and the old Low was closer to the new Medium in content.
- Desktop is 1280×720 with 1× CPU. Mobile is 412×860 at DPR 2.6 with a 4× CPU slowdown (Pixel-4a-class
  emulation).

## Before / after

| Run | Draw calls | Triangles | Geometries | Textures | Programs | FPS avg / 1% low (SwiftShader) | Frame ms | Heap after 2 min | Time to interactive | Enter → first world frame |
|---|---|---|---|---|---|---|---|---|---|---|
| Before, desktop Low | 216 | 441,204 | 154 | 2 | 27 | 1.0 / 0.4 | 977 | 66.2 MB | 360 ms | 8.8 s |
| Before, desktop Medium | 254 | 544,139 | 172 | 19 | 32 | 0.6 / 0.3 | 1,639 | 66.8 MB | 649 ms | 11.5 s |
| Before, mobile Low (4× CPU) | 197 | 415,278 | 156 | 2 | 25 | 1.9 / 0.8 | 535 | 66.2 MB | 2,007 ms | 26.3 s |
| **After, desktop Ultra-Low** | **75** | **138,960** | 83 | 2 | 19 | **7.7 / 2.4** | **130** | 70.8 MB | 272 ms | 5.3 s |
| **After, desktop Low** | **147** | **297,051** | 109 | 4 | 26 | **2.5** / 0.5 | **405** | 72.9 MB | 280 ms | 5.9 s |
| **After, desktop Medium** | **217** | **362,245** | 134 | 20 | 34 | 1.0 / 0.3 | 984 | 72.9 MB | 276 ms | 5.9 s |
| **After, desktop High** | 252 | 383,973 | 149 | 20 | 33 | 1.1 / 0.5 | 899 | 72.8 MB | 275 ms | 5.4 s |
| **After, mobile Low (4× CPU)** | **130** | **267,057** | 114 | 4 | 24 | **4.7** / 1.0 | **213** | 72.9 MB | **906 ms** | **16.3 s** |

Like for like:
- **Medium:** −15 % draw calls, −33 % triangles, frame time −40 %.
- **Low:** −32 % draw calls, −33 % triangles, frame time −59 % (2.5× the FPS).
- **Mobile Low:** −34 % draw calls, −36 % triangles, 2.5× the FPS, time to interactive −55 %, world ready −38 %.
- **High** now draws more than old Medium did on screen (longest view distance, full density), with 29 %
  fewer triangles than old Medium.

**Heap went up, not down: about +6 MB (66 → 73 MB).** The cause is the chunked static-prop merging: each
merged chunk keeps its CPU-side vertex arrays (plus the per-vertex `aOrigin` attribute), and palms keep a
second, far LOD. That is the price of the ~40 % fewer draw calls. It is still far below the 300 MB target.
Freeing the CPU copies after upload (`onUploadCallback`) is the next step if heap matters on 2 GB phones.

### Bundle and loading

| | Before | After |
|---|---|---|
| JS total (gzip) | 388.5 KB in 3 chunks, all loaded upfront | 394 KB in 14 chunks, loaded on demand |
| Landing page, initial code (gzip) | 399 KB transferred (everything) | ≈ 57 KB (index 5.6 + vendor-react 46 + CSS 4.7) |
| Landing page after 3 s (measured transfer) | 399 KB | 289 KB (see the note below) |
| Entering the world (measured transfer) | 0 KB (already loaded) | 66 KB (world 54 + beach 10) |
| Vinland map | in the main bundle | own chunk, 53 KB gzip, only when entered |
| Static assets in `dist/` | 10.6 MB of unused 2D sprites | 0 |
| Precompressed `.gz` / `.br` | no | yes |
| Source maps in production | no | no |

**Note on the landing target (< 200 KB gzip):** the landing page's initial code is about 57 KB. The avatar
customizer on the landing page then lazy-loads three.js (167 KB gzip) for its live 3D preview and the
outfit thumbnails, so the measured transfer after 3 s is 289 KB. The page is usable before that (the
preview shows a placeholder until it arrives). Meeting the target strictly would mean not loading the 3D
preview until the player interacts with the customizer. That is a feature change, so it is listed under
"needs my decision" below.

### Memory over time (leak check)

Low tier, desktop. The heap is measured after a forced GC.

| | Heap |
|---|---|
| After 2 min of walking | 72.9 MB |
| After 5 min of walking | 73.1 MB (**flat**) |
| After re-entries 1 to 5 (leave the world, enter again) | 73.5 → 74.0 → 74.4 → 74.8 → 74.9 MB |
| GPU objects after each re-entry | geometries 97 to 103, textures 4, programs 25 (**flat**) |
| Baseline, re-entries 1 to 5 (Medium) | 67.9 → 68.9 → 69.9 → 70.8 → 71.5 MB |

**Over a 5-minute walk the heap does not grow.** Across re-entries it still grows a little at first, then
levels off. A 10-re-entry trend run shows the difference between before and after the fix:

| Re-entry | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Without `releaseGpu` (MB) | 69.3 | 70.3 | 71.0 | 71.5 | 72.1 | 72.5 | 72.8 | 73.1 | 73.6 | 73.9 | 74.2 |
| With `releaseGpu` (MB) | 69.5 | 70.3 | 70.7 | 71.1 | 71.3 | 71.5 | 71.6 | 71.6 | 71.8 | 71.8 | 71.9 |

The cause was module-level cached materials and textures: three.js attaches a `dispose` listener from each
renderer to everything it uploads, so every old renderer stayed reachable through the caches. Now, when a
Canvas unmounts, `src/game/util/releaseGpu.ts` disposes everything the scene used. The remaining early
growth is JIT-compiled code and one-time caches warming up (the per-re-entry step falls to about 0.05 MB),
so it is **not strictly zero over the first 5 re-entries**.

Two caveats about the measurement itself:
- The baseline number above is inflated. My first perf script kept a Playwright handle to each world's test
  hook, which pinned every old world in memory. The script now disposes those handles; the "without" row
  of the trend table is the true baseline behaviour (≈ +0.35 MB per re-entry, linear).
- The leak run uses Low and the baseline run used Medium, so the absolute heap levels differ.

## Targets

| Target | Result |
|---|---|
| Landing < 200 KB gzip | **Partly.** Initial code 57 KB; 289 KB including the auto-loaded 3D avatar preview (see above). |
| Total assets < 5 MB | **Met.** 0 MB of assets; 394 KB gzip of JS in total. |
| Low: ≥ 30 FPS | **Not verifiable here** (no real GPU; SwiftShader). Low is 2.5× faster than before in the same conditions. |
| Low: < 150 draw calls | **Met, narrowly:** 147 desktop, 130 mobile. |
| Low: < 300 MB heap after 5 min | **Met:** see the leak check (≈ 73 MB). |
| High: 60 FPS, no visual loss | **No visual loss:** same-spot screenshots match (see below). 60 FPS not verifiable here. |
| Zero memory growth (5-min walk, 5 re-entries) | **Walk: met** (72.9 → 73.1 MB). **Re-entries: mostly.** GPU objects are flat; the heap grows +1.4 MB over 5 re-entries and then levels off (≈ +0.05 MB per re-entry by the 10th). |

## Settings per tier

| | Ultra-Low | Low | Medium | High |
|---|---|---|---|---|
| DPR range | 0.6 – 1 | 0.75 – 1 | 1 – 1.5 | 1 – 2 |
| Shadow map | off | 512 px, 14 m | 1024 px, 19 m | 2048 px, 22 m |
| Small props cast shadows | no | no | yes | yes |
| Decoration density | 30 % | 50 % | 80 % | 100 % |
| View distance / palm LOD distance | 45 / 18 m | 60 / 28 m | 95 / 45 m | 220 / 70 m |
| Ground mesh resolution | half | full | full | full |
| Post-processing | none | FXAA | MSAA ×4, bloom at half res, grade, grain, vignette | same as Medium |
| Colour grade | baked into materials | baked | post effect | post effect |
| Water detail | 0 (bands + one foam line) | 1 (+ 2nd foam line, fragments, sparkles) | 2 (+ lace foam, ripple lines) | 2 |
| Cloud shadows | off | off | on | on |
| Particles / drifting petals | 40 / 0 | 80 / 20 | 160 / 60 | 160 / 90 |
| Gulls / crabs / campfire smoke | 0 / 0 / off | 3 / 4 / on | 5 / 9 / on | 7 / 9 / on |
| Full-rate animation distance | 20 m | 30 m | 45 m | 70 m |

Tier selection: auto-detection (device hints + about 1 s GPU benchmark, cached), a runtime governor (< 45 FPS
for 3 s: lower DPR, then the tier; > 58 FPS for 10 s: one tier up; cooldown 8 s, at most 4 flips), and a
manual override in the HUD settings with an optional 30 FPS cap. Rendering stops while the tab is hidden.

## What changed (by commit)

| Commit | Change | Measured effect |
|---|---|---|
| `78b7347` | Measurement tooling: size report, bundle treemap, `perf.mjs`, F2 stats overlay | — |
| `2188f3c` | Cleanup (see `cleanup-report.md`) | dist assets 10.6 MB → 0 |
| `5255e38` | Quality tiers, detection, governor, settings, frame cap | Ultra-Low tier: 75 calls, 139k triangles |
| `866e929` | Chunked static-prop merging, palm LOD, distance culling, instanced decoration, noise texture instead of procedural noise, water detail levels, baked grade, cheaper geometry (flowers, starfish, bevels) | Medium −15 % calls, −33 % triangles |
| `67aefa2` | No per-frame allocations (player, remotes, ambient, FX), shallow HUD selectors, memoized minimap and joystick, audio suspended when muted, a crash in the post-processing cleanup on leaving the world fixed | — |
| (step 5) | `releaseGpu`: frees the GPU side of cached materials, textures and geometries when a Canvas unmounts | re-entry heap growth levels off (see the leak check) |
| `36c730e`, `ad88348` | Code-split landing / world / each map, vendor chunks (react, three), gzip + brotli, `es2020`, no source maps | landing code 399 → 57 KB gzip; world ready −33 % to −49 % (desktop), −38 % (mobile) |

## Screenshots

Same camera, same spot, per tier (`node scripts/tier-shots.mjs`):

- `docs/perf/compare-med-*.jpg`: Medium before (left) vs after (right). Equivalent. The sand and grass
  blob placement is slightly different, because the random lattice behind the noise changed from a hash
  function to a texture; the look and density are the same.
- `docs/perf/tiers-pier.jpg`, `docs/perf/tiers-umbrellas.jpg`: 2×2 grid, High top-left, Medium top-right,
  Low bottom-left, Ultra-Low bottom-right. The solid black shadows (and black specks in the foam) in the top
  row are the SwiftShader + post-processing artifact described under known issues; on a GPU they are ochre,
  as on Low.
- `docs/perf/shots-before/`, `docs/perf/shots-after/`: the individual frames.

What the lower tiers honestly lose:
- **Low:** no lace foam and no ripple lines on the water (a single wave edge and foam line instead), fewer
  sparkles, no cloud shadows, no bloom or vignette (FXAA only), shorter shadow range, thinner decoration,
  far palms with simpler fronds.
- **Ultra-Low:** additionally **no shadows at all**, which makes the scene look noticeably flatter,
  the simplest water (colour bands and one foam line), half the ground resolution (softer shoreline edge),
  30 % decoration, no gulls, crabs, smoke or drifting petals, and a 45 m view distance (the far end of the
  beach is empty). It is clearly the "make it run" tier.

## Known issues (not caused by this work)

- On the first frame a three.js warning (`Cannot read properties of undefined (reading 'toArray')` in
  the shadow matrix upload) sometimes appears once. It was there at baseline, and it no longer appears in
  any final run.
- Under SwiftShader, shadows render black when the post-processing composer is active (Medium and High).
  Real GPUs are fine. This is a SwiftShader issue, seen before and after.

## Remaining bottlenecks

1. **Palms.** Even with LOD, palms are the largest share of the triangles on High and Medium (the near
   LOD has about 6k triangles each). A card-based far LOD (2 crossed quads) would cut another ~100k
   triangles on High.
2. **The shadow pass.** It draws the merged chunks again. Separate, simplified shadow-caster meshes (no
   fronds' fine detail) would help Medium and High.
3. **The heap cost of merging** (+6 MB): free CPU-side arrays after upload.
4. **Post-processing on Medium and High:** the full pipeline with MSAA is the most expensive fixed cost on
   weak GPUs; the governor drops to Low quickly in that case.
5. **Three.js on the landing page** (customizer preview), see above.

## Needs my decision

- Load the landing page's 3D avatar preview only on first interaction (meets < 200 KB on landing, but
  the preview appears a moment later). Today it loads automatically.
- The cleanup items in `docs/cleanup-report.md`.

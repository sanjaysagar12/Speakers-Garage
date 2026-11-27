# Cleanup report (branch `optimize/low-end`)

Tools used: `knip` (unused files, exports, dependencies), `tsc --noEmit`, ESLint (`--max-warnings 0`), and a
manual check of every candidate with `grep` across `src/`, `scripts/`, `tests/`, config files and npm scripts.
Nothing was deleted unless it was provably unused. Gameplay, controls, the NetworkAdapter interface and the
map / interaction data formats are unchanged.

## Removed

| Item | Why it is safe | Gain |
|------|----------------|------|
| `phaser` dependency | Not imported anywhere since the 3D rewrite (`grep -r phaser src scripts` → nothing). | ~148 MB less `node_modules`, faster `npm ci` |
| Generated `public/assets/*` (2D tileset, atlases, avatar sheets, `catalog.json`; 76 files) | Gitignored build outputs, never requested at runtime (the perf run saw 0 asset requests). Still regenerable with `npm run assets`. `dev`/`build` no longer run the asset generator. | Build output 10.6 MB → 0 MB of assets; faster `dev`/`build` start |
| Joystick PNG references | The two PNGs no longer existed (broken images on touch devices); the joystick is now drawn with CSS. | Fixes a broken UI on touch |
| Dead exports: `disposeToonCache`, `disposeSharedStructureMaterials`, `hashString`, `hairSwayWeight` / `HEAD_R` / `DEFAULT_AVATAR` re-exports | No references (knip + grep). | less code |
| Module-internal helpers no longer exported (`inputDirection`, `swayDepth`, …) | Only used in their own file. | clearer API |

## Merged duplicates

- Deck lookup: one `deckAtIn(decks)` in `src/game/maps/deck.ts` instead of a copy per map.
- Hex colour parsing: one `hexToRgb` in `src/game/util/color.ts` (beach and Vinland had their own).
- `smoothstep` in `hair.ts` now uses the shared helper.
- Map ids and names: `src/game/maps/ids.ts` (used by the store and the registry).

## Dev code moved out of production

- `?shots` screenshot scene, F2 stats overlay, F3 debug overlay/panel, `window.__game` / `window.__store`
  test hooks and debug logging (`devLog`) are compiled out of production builds (`import.meta.env.DEV`;
  perf builds opt back in with `VITE_PERF_HOOKS=1`).

## Project hygiene

- `.editorconfig` added; `.gitignore` covers `dist`, `.perf-dist`, `public/assets`, `.generated`, `shots`,
  `pier-check`, `perf-results`, logs, coverage, `.vite`.
- ESLint ignores generated folders; the few lint errors in `scripts/` were fixed. Lint now passes with zero warnings.
- README rewritten (it still described the Phaser 2D version).

## Counts (tracked files)

| | Before (`a340399`) | After (`HEAD`) |
|---|---|---|
| Tracked files | 108 | 150 |
| Folders | 23 | 28 |
| `src/` files | 66 | 77 |
| `src/` lines (ts/tsx) | 8,194 | 9,049 |
| Dependencies / devDependencies | 11 / 20 | 10 / 21 |
| `node_modules` | includes phaser | phaser removed (~148 MB) |

The file and line counts went **up**, not down. The source had very little dead code (the big waste was
the unused 2D asset pipeline output, which was never tracked). The additions are the optimization work
itself: quality tiers, detection, governor, frame driver, stats overlay, settings UI, loading screen, LOD
and chunk merging (≈ +850 lines in `src/`), the measurement scripts, and screenshots/size reports under
`docs/perf/`. The one new devDependency is `rollup-plugin-visualizer` (bundle treemap).

## Needs my decision (not deleted)

These look unused by the running game but are tools or content you might still want. Nothing here was touched.

| Item | Size | What it is | Notes |
|------|------|------------|-------|
| `scripts/art/**` + `scripts/build-assets.ts` + `npm run assets` + `sharp` devDependency | 4,590 lines | The 2D SVG art and the rasterizer that produced the old Phaser sprites | The 3D game uses none of it. Removing it would also allow dropping `sharp` (still used by `shots`, `contact`, `map-preview`). |
| `npm run map` → `scripts/gen-map.ts` | — | Script entry points at a file that does not exist (already broken at baseline) | Either delete the entry or point it at `scripts/gen-vinland.ts`. |
| `scripts/gen-vinland.ts` | 660 lines | Generator for the Vinland map data | Needed if Vinland's data is ever regenerated. |
| Vinland map (`src/game/maps/vinland/`) | lazy chunk, 57 KB gzip | Second map | Kept per your rule; it now loads only when entered, so it costs the landing page nothing. |
| `scripts/_char.ts`, `scripts/_trees.ts`, `scripts/contact.ts`, `scripts/map-preview.ts` | 414 lines | Ad-hoc preview/contact-sheet helpers from earlier iterations | Not referenced by npm scripts. |
| `scripts/e2e-smoke.mjs`, `scripts/e2e-interact.mjs` | 95 lines | Old Playwright checks | Superseded by `npm run smoke`, but you may use them. |
| `src/dev/ShotsScene.tsx` + `scripts/shots.mjs` (`npm run shots`) | 249 lines | Model contact sheets | Dev-only now; costs nothing in production. |
| `stepMovementLegacy` in `src/game/engine/controller.ts` | small | The old movement step, kept for the pier-bug diagnosis test | Used only by `tests/movement.test.ts` (comparison). |
| `docs/vinland-art-bible.md` | 102 lines | Art notes for Vinland | Goes with the Vinland decision. |
| `.generated/` (untracked) | — | Output folder of earlier generator runs | Gitignored. |
| `docs/perf/` screenshots | see repo | Before/after evidence for the perf report | Could be moved out of the repo once reviewed. |

# Iteration 8: clothing and cap fit, the Speaker's Garage rebrand, automatic voice, one-port server

All numbers were measured on the development machine (16 cores, WSL2). Browser checks use headless
Chromium with software rendering (SwiftShader).

## 1. Clothing and cap fit

**The cause.** Every garment was a hand-placed primitive on a limb pivot. The tee's shoulder was a 7 cm
sphere wider than its sleeve tube: that was the puffed block. The cap was a lathe that took no account of
the hair, and the hair was built the same way with or without a hat, so it bulged through.

**What replaced it** (all in `apps/web/src/game/models/character/`):

| File | What it holds |
|---|---|
| `rig.ts` | The body as named segments: the torso, neck, pelvis, both limbs (rings with elliptical cross-sections and ball joints) and ellipsoids for the head, jaw and feet. Also bones and anchors (forehead line, ears, nose bridge, temple line). Nothing else hard-codes a body dimension. |
| `shell.ts` | One generator for the body and every garment. A garment is the body's own rings pushed out by an offset, with the same radial columns, so a cloth polygon can never cut through the body polygon under it. Hems turn inward, bands follow sloping surfaces, patches conform to the surface (pockets, panels, the hood, stripes). |
| `garments.ts` | Tops, bottoms and shoes as data plus shells. Each garment records `covers` (the body is not drawn there), an envelope (an outer layer always clears the one beneath it, for example a tee hem over a waistband) and a back depth (long hair hangs over hoods and backpacks). |
| `hats.ts` | Hats are fitted to the head. The dome is the head ellipsoid plus a margin, cut by a band plane that runs from the forehead line to above the nape and stays above the ears. The brim starts on the band and curves down; the cap has a back opening with an adjuster. The same fit defines the hair mask. |
| `hair.ts` | `hatMode` per style: a tie goes through the cap opening, or drops under a hat without one. The hat mask hides hair under the hat and tucks hair below the band towards the scalp; wide brims flatten the hair under them. Hair keeps clear of the skin and ears, and lies over glasses temples. |
| `fitRules.ts` | Layer and conflict rules as data. A hat tucks the crown, a sun hat flattens the hair, a backpack flattens the hood, a scarf covers the drawstrings and collar, and sunglasses work under every hat. The customizer shows the rules that apply ("The hood is flattened by the backpack"). The conflict mechanism is in place but its list is empty: every current combination can be fitted. |

**The character is now one skinned mesh per material** on the old pivots, which are now bones, so the
animation code is unchanged. The waist bends smoothly between spine and hips, and the skirt follows the
thighs. Hair and hats stay plain meshes on the head bone, so the densest geometry has no skinning cost.

| Per character (same 38 outfits) | Before | After |
|---|---|---|
| Draw calls (meshes) | 27.1 | 9.2 |
| Triangles | 37.5 k | 36.0 k |
| Full build | 251 ms | 219 ms |
| Customizer change | 213 ms | 211 ms |

**Poke-through test.** `pnpm test:fit` runs on 600 combinations. The full product is 4,608 (8 hairs × 3
hats × 4 tops × 4 bottoms × 3 shoes × 4 accessories, one body shape). The 600 start with a greedy set that
covers every option pair: hair × hat, top × bottom, top × accessory, hat × accessory, bottom × shoes,
hair × top and hair × accessory. The rest is a seeded random sample. The checks:

- **inside-body:** no garment vertex inside the segment it was built on. The check uses radial distance
  from the segment axis, as the spec defines it.
- **posed-inside:** in walk, run, sit, wave and dance poses, the legs never come through the skirt.
- **hair-in-hat, glasses-in-hat:** no hair or glasses vertex inside the hat's dome, rim, brim or strap.
- **joint-gap:** cloth on the shoulder, elbow, hip, knee and ankle balls stays within 20 mm of the body.
- **z-fight:** no coplanar overlapping triangles between different parts, in the idle pose. This runs on
  the pair-covering combinations plus every 5th of the rest (150 of the 600), because z-fighting happens
  between items that touch.

Result: **PASS** on all 600, in 121 s. `pnpm test` also runs the pair-covering set without the z-fight pass.

The first runs found real problems, all fixed in the data or the builders:

- collar and cuff bands dug up to 12 mm into sloping surfaces;
- hoodie drawstrings hung inside the chest;
- the sandal sole lay exactly on the foot, so they z-fought;
- the thigh balls crossed the pelvis shell at a shallow angle;
- in the sit pose the skirt front sank into the thighs;
- tucking pulled a few hair vertices into the cap brim's tips;
- glasses temples ran inside the skull.

The last case of hair tangent to the top of an ear is handled by a small depth bias per material layer
(hair over skin, accessories over hair). The test treats pairs on different layers as resolved. Skin on
skin (two body parts with the same material and colour) is skipped, because it cannot flicker.

**Contact sheets** (`npm run shots -- fit:` and `-- head:`): front, side, back and a 3/4 view from the game
camera's pitch, for 8 outfits, 8 mid-walk poses, and all 24 hair × hat pairs. I reviewed them twice. The
first review led to:

- under a cap, only the skull layer and the tie show through the opening (crown clumps had stretched into a
  block);
- a bun now sits outside the opening instead of being cut flat;
- cords are double-sided (they rendered black).

The second review confirmed the fixes. Mid-walk, the shells follow the limbs with no tearing at the elbow,
knee or hip; the ball joints mean nothing opens up at any angle.

**The customizer preview** is the same `Character`, so it uses the same pipeline, including `hatMode`.
A style change rebuilds only the parts that depend on it.

**Still not ideal (no test failure, but worth a look):**

- Long wavy hair over a backpack drapes far out behind, and looks bulky from the side.
- Wavy hair under a cap is ragged at the sides. That style's clumps were already coarse before this
  iteration.
- The cap's back opening shows as a small dark notch when there is no tie.
- There is only one body shape. The rig takes all its proportions from one file, so body shapes can be
  added there, and the fit test would cover them automatically.

## 2. Speaker's Garage

- Packages renamed to `@speakersgarage/{web,server,shared,config}`; the workspace, turbo, lockfile,
  Dockerfile and scripts updated.
- New brand surfaces:
  - landing title and tagline: "Hang out in a shared world and talk to whoever is nearby.";
  - the **Enter the garage** button, and room chips that show the map name;
  - the HTML title, description, theme colour, favicon (SVG plus 32, 180, 192 and 512 px PNGs),
    Open Graph and Twitter tags, and a web manifest;
  - the loading screen, the join error screen and the HUD name badge.
- New mark (`public/favicon.svg`, a garage roofline over a sound wave) and wordmark (`public/logo.svg`).
  `scripts/build-icons.mjs` renders the PNGs and the Open Graph image.
- **Saved data survives the rename.** `src/storage.ts` moves `shoreline.*` and `vinland.profile.v1` to
  the new keys once. The move never overwrites newer data, and it is unit-tested.
- **Leftover old names:** "Beach" and "Vinland" remain, but only as map names. A search of the repo and of
  `dist` finds only the migration's old key names, the word "shoreline" as terrain vocabulary (the
  distance field to the shore), and the Vinland map's own description in its map data, which is not
  shown in the UI.

## 3. Voice joins on Enter

- The Enter click creates and resumes the AudioContext and starts the microphone request in the same
  handler (`voice/prime.ts`). Nothing is requested on page load or on the landing page. The track stays
  disabled until the voice connection is up, and is released if the game ends up offline.
- Voice joins when the room welcomes the player, with the microphone live.
- **Join with microphone on** (remembered): when unticked, the player joins muted and the microphone
  only opens on their first unmute.
- Denied, no device, or no HTTPS: the player joins listen-only and sees a banner with
  **Retry microphone**. Entering the world is never blocked.
- The HUD always shows the microphone state (**Mic live**, **Muted**, or **No mic · listening**). M toggles
  mute. **Click to enable sound** appears if the browser still blocks audio.
- The microphone is released on leaving the world and on `pagehide`.
- Everything that already worked is untouched: proximity radii, spatial audio, speaking indicators,
  push-to-talk, deafen, per-player mute and block, tier limits, TURN credentials.

## 4. One port

- Fastify serves `apps/web/dist` with `@fastify/static`:
  - hashed `/assets` are immutable for a year; `index.html` and the manifest are `no-cache`;
  - precompressed `.br`/`.gz` files are served when the browser accepts them;
  - any HTML GET outside the server's paths gets the app (client-side routes, deep links); unknown files
    and `/ws`, `/health`, `/rooms` and `/api/*` paths get a real 404.
- `@fastify/compress` handles everything else.
- Helmet CSP: `default-src 'self'`, `script-src 'self'`, `style-src 'self'`,
  `connect-src 'self' ws: wss:`, `media-src 'self' blob:`, `img-src 'self' data: blob:`; no inline
  scripts, no eval. `Permissions-Policy: microphone=(self)`. A browser run with a violation listener saw
  no CSP violations.
- Environment: `WEB_DIST_PATH`, and `SERVE_WEB=auto|on|off`. In production the server refuses to start
  without the build.
- The client takes its socket and `/rooms` from `location`, with a `VITE_WS_URL` override. The Vite
  proxy forwards `/ws`, `/rooms` and `/health`. A `/room/<id>` link picks that room.
- `pnpm build` builds shared, then web, then the server. `pnpm start` runs the result.
- The Docker image holds the server and the site, runs as non-root on one port, and has a healthcheck;
  compose has the app and coturn.

## 5. Verification

| Check | Result |
|---|---|
| `pnpm test:fit` (600 combinations) | PASS, 121 s |
| `pnpm test` | 18 shared + 30 server (incl. 8 static-serving tests on a dist fixture) + 6 web: all pass |
| `release-check.mjs` on `pnpm build && pnpm start` (one port, 3 Chromium instances) | 28/28 |
| Clean clone: `pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm lint && pnpm test` | all pass |
| `voice-check.mjs` (dev, store hooks) | voice joins on Enter with the mic live and audio running (no autoplay override); peer in 1.1 to 2 s; A hears B; mute gives 0/10 speaking samples; the denied browser goes listen-only |

What the release check covers:

- the brand: title, heading, favicon and manifest;
- both players joined voice by themselves, with the indicator red and live, and **M** sets it to muted;
- the browser that denies the microphone enters, shows "No mic · listening" and the Retry banner;
- the microphone hint matches the browser's permission state;
- the deep link `/room/deep-link` fills in that room;
- refreshing on the deep link, and refreshing in the world then entering again, both work;
- caching, compression, CSP, Permissions-Policy and 404s;
- no page errors.

It also found one real bug, now fixed. Cached materials shared by the world, the avatar preview and the
thumbnail renderer carried the wrong renderer's light uniforms, and after re-entering the world WebGL
failed with "reading 'shadowIntensity'". Each character now owns its detail materials.

The hint state was checked only as `denied`: headless Chromium reports the microphone as `denied` when no
prompt can be shown, so the run saw the "blocked, you will listen" note rather than the "your browser will
ask" text.

The voice-check step "B walks away until the voice peer drops at 15 m" could not get B 15 m clear in this
run: B got stuck among palms and umbrellas at 4 to 14 m. The proximity code did not change in this
iteration; it measured a drop at 15.18 m in iteration 7.

**Performance against iteration 7:**

| Bundle, gzip | Iteration 7 | Now |
|---|---|---|
| Landing chunk | 7.8 KB | 9.5 KB |
| World chunk (still lazy) | 71.7 KB | 72.5 KB |
| Character chunk (lazy) | 13.5 KB | 21.9 KB |
| All JS | 413 KB | 424 KB |

The landing chunk grew by the microphone priming, the storage migration and the brand component. The
world chunk is still loaded only on entry.

Frame rate and memory (`scripts/perf.mjs`, offline single player, 2-minute walk). The two builds ran back to
back on the same machine: iteration 7 is commit `6d34b37`.

| | Ultra-Low, it. 7 → now | Low, it. 7 → now |
|---|---|---|
| FPS average / 1% low | 6.9 / 1.8 → 7.0 / 2.3 | 2.4 / 0.8 → 2.4 / 0.5 |
| Draw calls | 75 → 58 | 145 → 117 |
| Triangles | 139 k → 142 k | 298 k → 306 k |
| JS heap after 2 min | 71.1 → 72.6 MB | 73.2 → 74.4 MB |

Average FPS is unchanged. The 1% lows went up at Ultra-Low and down at Low: at 2 to 7 FPS under software
rendering they come from a handful of frames, so neither change is meaningful. Draw calls dropped by
17-28 because each character is now about 9 meshes instead of 27. The scene has 2-3% more triangles and
the JS heap is about 1.4 MB larger.

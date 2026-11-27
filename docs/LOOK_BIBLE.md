# Speaker's Garage — Look Bible & Technical Plan (iteration 4: the beach, in 3D)

The reference images are a **style** reference only. Nothing is traced, no composition is copied, and no
watermark or signature is reproduced. The primary reference is the flat graphic top-down beach poster;
the painted ones only inform how foam and figures read from very high up.

## Palette (sampled from the reference, then rounded)

| Role | Hex | Notes |
|---|---|---|
| Dry sand | `#FCD484` | the dominant plane, warm and saturated |
| Sand variation / dune band | `#FCC46C` `#FCCC7C` | large soft bands, never noisy |
| Damp sand | `#E9B565` | follows the wave line, darker the closer to water |
| **Offset shadow on sand** | `#DC9C34` → `#D49434` | ochre, hard edged, never grey |
| Foam | `#FCFCFC` `#F4FCFC` | pure flat white, slightly >1.0 in HDR so bloom touches it |
| Shallows | `#74DCD4` | light turquoise |
| Mid teal | `#04A4B4` `#049CAC` | |
| Deep teal | `#047484` `#046C84` | |
| Deepest / shadow on water | `#144454` `#144C5C` | also the darkest palm tone |
| Coral (umbrellas, towels, rings) | `#EC847C` | with off-white `#FBF6EE` |
| Navy-teal stripes | `#11738A` `#1F5F73` | umbrellas, loungers |
| Palm greens | `#5CA464` light, `#3C8444` mid, `#144454` dark underside | two-tone fronds |
| Wood | `#C98A4B` `#9A6233` | pier, bar, lifeguard tower |

## Shape language
- Big clean flat colour planes, **no outlines**, crisp edges. Rounded-but-simple silhouettes (umbrellas are
  scalloped octagons, palms are radiating serrated fronds, waves are soft wavy bands).
- Low-poly but not faceted, except rocks, which are deliberately faceted.
- Detail density is low on the sand and higher at the waterline (foam lace, shells, starfish).

## Shadows
- One warm sun from the upper-left. Every object casts a **hard-edged offset shadow** to the lower-right.
- Shadows are a **darker, more saturated tone of the receiving surface**: ochre on sand, deep teal on water,
  light grey-teal on white. Never multiplied grey or black.
- Toon bands on objects: lit, mid (faces turned from the sun), shade (cast shadow or facing away).

## Grain
- Stippled grain only where tone changes: inside shadow/mid bands and across water depth gradients
  (dithered band transitions), plus a very light film grain over everything.
- Small 4-point sparkles twinkle on the water; foam is lacy at the shallow edge.

## Technical plan
- React + Zustand stay. The Phaser world is replaced with **Three.js via @react-three/fiber** (R3F 8 / drei 9 /
  @react-three/postprocessing 2, because the app is on React 18).
- **Materials** (`src/game/materials`): one toon `ShaderMaterial` family that reads the real shadow map via
  three's shadow chunks and outputs a surface-tinted shade; vertex colours for parts, procedural stripes
  (radial, rings, mixed, stripes, bands) for umbrellas/towels/lighthouse; shared wind sway in the vertex
  shader with a matching depth material so swaying shadows move too.
- **Terrain** (`maps/beach`): a signed-distance shoreline field built from `beach.json` drives one ground
  shader that paints sand → damp sand → foam → shallows → teal → deep, with animated waves, lace foam,
  sparkles and ripple lines. The same field drives collision, wading depth, crabs and the minimap.
- **Models** (`src/game/models`): every prop and the character are procedural meshes built by parametric
  functions (colour/size/seed). Parts are merged per material, small repeated objects are instanced.
- **Camera**: perspective chase camera, pitch 55° (45–65), FOV 38°, distance ~16, yaw ±60° with smoothing.
- **Verification**: `npm run shots` renders every model alone from the game camera at yaw −60/0/+60 into
  contact sheets, then in-game screenshots are compared with the reference.

# Vinland — Art Bible & Plan (iteration 2)

Target look: **hand-painted anime background art, watercolour + gouache**, in the spirit of Vinland Saga
landscape shots. Oblique top-down (ground seen from high above, objects at ~3/4 so you see a little of their
front). Never flat vector, never pixel art.

## Palette

| Role | Hex | Notes |
|---|---|---|
| Grass base / mid / deep | `#7FA85C` `#5E8C47` `#426B36` | three-tone meadow wash |
| Grass highlight (sunlit) | `#9CC06E` | gusts reveal this |
| Tall grass / wheat | `#C8B45E` `#E0CE80` | fields, sways hardest |
| Farm soil / dirt / mud | `#6B4F38` `#8A6A4A` `#4E3A2A` | furrows read as diagonal strokes |
| Rock / cliff / shadow | `#7C7A82` `#5A5862` `#3E3C46` | cool grey-violet |
| Snow cap / snow shade | `#F2F4F6` `#C9D6E0` | north ridges only |
| Pine deep / mid / light | `#2E4A35` `#3C6042` `#547A4E` | spruce + pine |
| Birch foliage | `#79A356` `#95BC6A` | lighter, airier |
| Oak foliage | `#5F8740` `#7BA253` | broad, round clusters |
| Bark dark / mid / birch | `#4A3A2C` `#6B543E` `#E3DED2` | birch gets dark marks |
| Water deep / mid / shallow | `#2C5A74` `#3E7E96` `#6FB3BE` | lake gradient |
| Water foam / speckle | `#EAF4F5` `#FFFFFF` | broken speckled foam |
| Wood (timber) / thatch / turf | `#8A6440` `#C0A057` `#6E8C4A` | longhouse |
| Sky tint (day) | `#FFE9C4` warm | daylight overlay |
| Shadow tint | `#2A4A5E` @ 22% | **all** shadows, cool blue-teal |

**Shadow law:** every object casts one soft shadow in the **same direction, down-right**
(offset ≈ +0.38·h on x, +0.17·h on y), blurred, cool blue-teal, never black.

## Watercolour pipeline (`scripts/art/wc.ts`)

1. `feTurbulence` (fractalNoise) + `feDisplacementMap` → organic, wobbly edges instead of geometric ones.
2. Base wash, then 2–4 translucent darker/lighter washes at different displacement seeds → pigment variation.
3. **Edge darkening**: the shape re-stroked inside itself, blurred — the pigment ring watercolour leaves.
4. **Pigment bleed**: a blurred, displaced copy under the shape at low alpha.
5. **Paper grain**: a high-frequency turbulence overlay, multiplied, over the whole texture.
6. **Speckle**: thresholded turbulence → white flecks (water, foam, flower fields).

Everything renders at 2× (`SCALE=2`) and is downsampled by the engine, so edges stay crisp.

## Map sketch — 120 × 90 tiles (15360 × 11520 px)

```
   0        20        40        60        80       100     119
 0 ████████████████████████████████████▓▓GAP▓▓███████████  snow ridge (N)
   ███▲▲▲███ waterfall ████████████████████████████████
10 ██  pine slope                                      ██
   ██      ~~~~~~~~~~                    ♣♣♣♣♣♣♣       ██
20 ██    ~~~~~~~~~~~~~~~~                ♣♣ PINE ♣♣     ██
   ██   ~~~~~  LAKE  ~~~~~~             ♣♣ FOREST ♣♣    ██
30 ██    ~~~~~~~~~~~~~~  jetty           ♣♣♣♣♣♣♣♣      ██
   ██      ~~~~~~~~~  dock   ▒▒▒▒▒▒▒▒▒                 ██
40 ██        ~~~~~       ▒▒ FARMSTEAD ▒▒▒  ▒ fields ▒   ██
   ██          ~~\    ▒▒ longhouse ▒▒▒▒▒  ▒▒▒▒▒▒▒▒▒    ▓G
50 ██   meadow    ~~\  ▒ barn  well cart ▒  ▒▒▒▒▒▒▒     ▓A
   ██   flowers     ~~\                     ░░░░░      ▓P
60 ██                  ~~\ river SE         ░ vine ░    ██
   ██                     ~~\               ░ yard ░   ██
70 ██  ♣♣♣ south forest      ~~\                       ██
   ██ ♣♣♣♣♣♣♣♣♣ glade+stone    ~~\                     ██
80 ██ ♣♣♣♣♣♣♣♣♣♣♣♣♣♣♣♣♣♣♣♣♣♣♣♣♣♣ ~~\                   ██
   ████████████████████▓▓GAP▓▓███████████████████████████  ridge (S)
```

Lake, river, roads and field furrows all run at **20–35°**, never axis-aligned — the diagonal
composition from the reference. Mountain ring is impassable except three trail gaps (N, E, S).

## Asset list

**Terrain (24 tiles + 47-piece shore autotile)** — grass ×4, tall grass, flower grass, dirt, mud, farm soil
(ploughed, diagonal furrows), crop wheat, crop barley, rocky ground, gravel, snow, snow-rock, stone path,
dirt road, water ×8 depth steps, lake shore blob set.

**Trees (layered: trunk+base static, canopy animated & above player)** — pine, spruce, birch ×2, oak ×2,
dead/fallen log, stump. Canopy = 8–15 overlapping clusters, 3-tone, irregular leaf edge, highlight flecks.

**Flora** — bush ×3, fern ×2, grapevine trellis, reeds, lily pads, mushrooms ×2, wildflowers ×3, haystack, wheat sheaf.

**Structures** — longhouse (turf roof + smoke), barn, storehouse, smokehouse, well, cart, barrels, drying
rack, chopping block, fences (3 pieces + gate), jetty, rowboat, standing stone, notice post, campfire.

**Mountains** — ridge sprites ×4 (snow / pine / rock / tall), scree, boulders.

**Animals (4-dir, 4-frame walk)** — cow, sheep, chicken, dog.

**Character** — body, 8 hair styles (back + front layers each), tops ×6, bottoms ×5, footwear ×4,
cloaks ×5, accessories ×4. 4 directions × (idle 4, walk 8, run 8).

**Ambient/FX** — clouds ×3, cloud shadow, birds, leaves, pollen, mist bands, waterfall mist, fireflies,
splash, ripple, footprint (dry + wet), dust puff, smoke puff, foam strips.

## Build order

1. `wc.ts` watercolour primitives + palette → smoke-test render.
2. Terrain → contact sheet → fix → repeat.
3. Trees + flora → contact sheet → fix → repeat.
4. Character (body/hair/clothing) → contact sheets (styles × directions × frames) → fix → repeat.
5. Structures, mountains, animals → contact sheet.
6. `build-assets.ts` rewrite (atlases, avatar layer sheets, thumbnails).
7. `gen-vinland.ts` → map preview PNG → fix layout.
8. Engine: oblique camera + look-ahead, wind system, atmosphere, day/night, animal AI, runtime customizer.
9. Playwright verification, README.

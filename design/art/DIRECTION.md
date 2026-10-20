# Paperwork: art direction — "Survey"

*A3, 2026-10-20. Status: recommended direction, with a working prototype pipeline in `design/art/proto/`.
Mocks: `design/art/mocks/survey-final-1x.png` (default zoom), `-0.3x.png`, `-night.png`, `-eras.png`, and
`contact-survey-final.png`. The two directions not chosen and the first survey iteration sit beside them
(`kodachrome-*`, `model-*`, `survey-1x/0.3x`; side by side in `compare-directions.png`). Why this direction and
not the others: `pm/reports/A3.md`.*

## 1. The direction in one page

**The world is drawn as the survey the charter attaches.** Charter §1 reads "A research Site is established on
the land shown in the attached survey." *Survey* renders that land as a mid-century survey plate:

- 3D models rendered headlessly in Blender, then washed in three flat tones, inked and hatched in numpy;
- buff survey paper with topographic conventions on the ground: woodland tint, water-lining, urban pink, stipple;
- the interface as the paperwork of a 1945 federal research site: manila folders and index cards, printed labels
  and typed values.

Seven rules carry the look:

1. **Ink defines form; washes carry identity.** Every object has an ink silhouette. Its fill is a flat
   watercolour wash in three tone bands. No gradients, no specular highlights, no texture photographs.
2. **Shadow is hatching, not darkness.** Cast shadows and faces turned away from the light are hatched. The ground
   stays paper-light, so the factory always reads against it (machines are 25–60 % darker than the paper).
3. **Information is paper; matter is pigment.** Information items are the lightest objects in the world
   (L\* 84–98, paper whites, card cream, manila), with ink marks: typed lines, punched holes, string. Matter items
   are mid-to-dark pigments (L\* 31–74). A belt shows what it carries by lightness before any icon can be read,
   and lightness survives colour-vision deficiency (§3.2).
4. **Light is a warm stain.** A working fire or lamp leaves a watercolour stain of its own colour on the paper
   around it. At night the plate becomes a cyanotype and the lights reveal the day colours where they fall (§4.4).
5. **Ink weight is importance.** Machines and buildings get full ink, resource tiles 70–75 %, decoratives 45 %,
   terrain conventions lighter still.
6. **Every era is drawn with the same pen.** Machines change with their tier (plugboard, stored program,
   transistor rack, accelerator hall). Towns change with the Field. The plate does not change. §10 has the one
   proposed exception.
7. **Factorio's readability is the floor.** Belt direction, inserter state, machine state and item identity must
   read at 1×, and the scene must read at 0.3×. Every rule above was checked on the mocks (§13).

## 2. Camera, projection, scale

Measured on this host (`proto/lib/rig.py`; a unit cube renders 64 px wide with a 64 px top face and a 64 px
south face).

- **Camera.** Orthographic, pitched 45°, viewed from the south, `pixel_aspect_x = √2` (10 §9.1).
  Ground metres map to sprite pixels as `col = ax + 64·x`, `row = ay − 64·(y + z)`. Here x is east, y north and z
  up, and the anchor (ax, ay) is the footprint centre on the ground. Ground tiles are square and heights read 1:1.
- **What the camera sees.** Top faces and south faces. East and west faces are edge-on, and north faces are
  hidden. Put detail on the top and the south face; design silhouettes as the outline of top plus front.
- **Pixels per tile.**

  | Zoom | px per tile on screen | Sprite source |
  |---|---|---|
  | 3× (closest) | 96 | High (64), magnified 1.5× |
  | 1× (default) | 32 | High, mip 1 |
  | 0.5× | 16 | Normal (32), mip 1 |
  | 0.3× (furthest world zoom) | 9.6 | Normal, about mip 1.7 |

- **Resolutions.** High is 64 px per tile (rendered); Normal is 32 px per tile (box-downscaled at build).
  All line widths below are given at High.
- **Scale.** 1 tile = 1 m. Character 1.75 m (56 px at 1×). Two-by-two burners 1.5–1.7 m, 3×3 machines
  1.8–2.2 m, small pole 3 m, trees 4–4.6 m, town buildings 3–6.5 m.
- **Shadow reach.** A cast shadow falls 1.43 × height east and 0.39 × height south, so tall sprites cost canvas.
- **Belts.** Rails 0.22 m and deck 0.15 m high. Items on a belt are drawn at 0.5 tile (32 px High, 16 px at 1×),
  ±0.23 tile off the centreline, 4 per lane per tile.
- **Inserters.** Base 0.62 m square, shoulder 0.47 m, reach 0.92 (long-handed 1.92), hand 0.30 m.

## 3. Palette

All colours are sRGB hex; L\* is CIELAB lightness. The material table is `proto/lib/style.py`
(`SURVEY_MATS`). Entity scripts name semantic keys such as `steel_paint` or `paper_manila`, never colours.

### 3.1 Ground and ink

| Role | Hex | L\* | Notes |
|---|---|---|---|
| Survey paper (ground) | `#ece3cb` | 90 | buff, never pure white; carries a ±5 % paper grain |
| Ink | `#2b2723` | 16 | brown-black; never `#000` |
| Grass wash | `#e2e6c6` | 90 | 60–100 % over paper, sparse grass ticks `#7d8a62` at 32 % |
| Woodland tint | `#c9dca8` | — | 30 % wash under tree clusters (topographic convention) |
| Dirt / soil | wash `#e9dcc0`, stipple `#8a7458` | — | stippled, never a flat brown |
| Sand | wash `#efe2bf`, stipple `#a08b62` | — | finer, denser stipple |
| Water / deep water | `#c4dbe2` / `#aecbd8` | — | with water-lining in `#56809a` and a shoreline in `#3f5f74` |
| Town block | `#ecd2c8` | — | the topographic map's pink urban tint, kerbs inked `#3b332b` |

### 3.2 Information and matter (07 §23 rule 1, made measurable)

| Information (paper) | Hex | L\* | | Matter (pigment) | Hex | L\* |
|---|---|---|---|---|---|---|
| Sheet (Memo, Report pages) | `#fcfaf3` | 98 | | Iron ore | `#8496a8` | 61 |
| Card stock (Token) | `#f2e2bb` | 90 | | Copper ore | `#d58c62` | 65 |
| Manila (Records) | `#e8cf98` | 84 | | Coal | `#4a4a4c` | 32 |
| Memo header band | `#c9432f` | 48 | | Iron plate | `#9fb0c0` | 71 |
| Report cover | `#5b9161` | 55 | | Copper plate | `#c47a4b` | 58 |
| Typed lines, holes | ink | 16 | | Gear, bare steel | `#b0b8bd` | 74 |
| | | | | Quartz (exception) | `#f6e9ea` | 93 |

Rules:

- An information item's paper body is at least L\* 84. A matter item's body is at most L\* 74, except quartz
  (07 §23 rule 5: "the brightest raw item"). Quartz is told apart by its faceted crystal silhouette and pink cast;
  it never carries ink marks.
- Two items that share belts and are close in hue must differ by at least 20 L\*. The measured worst case under
  red-green colour-vision deficiency was manila Records against Copper plate: 26 L\* apart after this rule.
- Every information item carries ink marks (lines, holes, string, a number). No matter item does.
- Papers keep Factorio's science colours as one detail on the sheet: Memo red band, Report green cover, and so on
  up the ladder (07 §23 rule 2).
- The belt deck is `#6e6a64` (L\* 45). Coal (32) and ore (61) separate from it, and paper (84+) stands 40 above it.
- Belts and inserter arms keep Factorio's tier colours: yellow `#e8b748`, red `#cf5640`, blue `#5a8ac0`.

### 3.3 Machines, buildings, nature

| Key | Hex | Use |
|---|---|---|
| `steel_paint` / `_alt` | `#9fb2b3` / `#7f9598` | 1940s machine-tool paint, Payne's-grey wash |
| `cast_iron` / `steel_dark` | `#5d6166` / `#727a80` | frames, plinths, stoves |
| `enamel_cream` / `enamel_blue` / `enamel_red` | `#f3ead2` / `#7d9fc0` / `#c9533d` | office machines (Keypunch cream and steel blue) |
| `brass` / `copper` | `#d6ad55` / `#c27648` | fittings, governors, dome ribs; cables |
| `quartz_stone` | `#f6f1e7` | the stone furnace's quartz blocks |
| `brick`, `slate`, `trim_white` | `#c97557`, `#7d8790`, `#f8f4ea` | 1940s college town |
| `wood`, `wood_pole` | `#c49563`, `#9b7b5a` | File drawers, poles, tables |
| `leaf`, `leaf_dark`, `conifer`, `bark` | `#9cb878`, `#86a668`, `#6f9670`, `#8a7158` | organic: no inner lines (§5) |
| `fire`, `fire_dim`, `lamp`, `lamp_green` | `#f6a24a`, `#d9603a`, `#f6d58e`, `#a8e08a` | emitters: flat, unbanded, feed the light pass |

### 3.4 Status and overlay colours (unchanged from the spec)

- Status lights: green, yellow and red as 07 §16.2. Warning icons: Factorio's.
- Heat overlay: 07 §3.2's scale.
- Staffing hues: 07 §3.3's eight parchment-to-amber hues. They already belong to this palette.

## 4. Light and shadow

### 4.1 Shading: three bands

There are no rendered lights in the colour pass. Each material is an emission wash multiplied by a tone band from
N·L against the key direction (−0.62, −0.30, 0.73), normalised: west-south-west, about 47° up, so the south
faces we look at are lit.

| N·L | Band | Multiplier | Treatment |
|---|---|---|---|
| ≥ 0.60 | light | 1.00 | tops, west slopes |
| 0.16–0.60 | mid | 0.86 | south faces |
| < 0.16 | dark | 0.70 | hatched at 45°: period 6.5 px, line 1.8 px, 55 % ink |

Emitters (fire, lamps, ink) are flat and unbanded.

### 4.2 Cast shadows

- Shadow direction (−0.80, 0.22, 0.56): from west-north-west, so shadows fall east-south-east, as in Factorio
  (10 §6.7). The shading key and the shadow light differ on purpose, a common sprite-game practice: fronts stay
  lit, and at 45° pitch the mismatch is invisible.
- The mask comes from a shadow-catcher ground with a 1° sun and no sky term (crisp).
- Shadows are MAX-blended into one layer and drawn as hatching at −45° (period 7 px, line 1.7 px, 55 % ink),
  plus a 6 % darkening. They fall on the ground, belts and items, never on buildings (10 §6.2 step 3).
- Clip mask values below 0.03 and store shadow masks at Normal resolution: they are low-frequency.

### 4.3 The light layer by day

- Every emitter is also rendered into a `light` pass (emitters in colour, everything else opaque black).
- At build time it becomes a glow sprite: dilate 0.12 tile, blur 0.22 tile, × 1.8, clip.
- By day the engine applies it as a warm stain on paper: `colour *= 1 − 0.6 · a · (1 − hue)`, where a is the
  glow's strength and hue its normalised colour.
- This is what makes a working furnace mouth or a lit Seminar globe readable in a still.

### 4.4 Night: the cyanotype

- At night the plate turns into a cyanotype (Herschel, 1842: the blueprint process). Paper goes to Prussian blue
  `#13304f`, ink to pale `#d6e4ec`, and 18 % of the day colour stays so belts and machines keep a trace of their
  coding.
- The light layer is applied at full strength and reveals the day colours within its falloff. Lamps (a slice
  entity) therefore light colour back into the drawing, which gives them their Factorio job of visibility at
  night.
- Engine: the day table drives a blend between the identity LUT and the cyanotype LUT, followed by the additive
  light pass (10 §6.2 steps 7 and 9). Mock: `mocks/survey-final-night.png`.

## 5. Line work (the ink pass, `proto/post.py: survey_ink`)

Lines are derived from 2× auxiliary passes (world normal, and material id with object id), so they follow geometry
exactly and never need hand inking.

| Line | Where | Width at High (on screen at 1×) |
|---|---|---|
| Silhouette | alpha boundary | 3.0 px (1.5 px) |
| Inner | material change, object change, or crease above 32° | 1.6 px (0.8 px) |
| Pen pressure | slow noise along the drawing | × 0.75–1.20 |

Rules:

- **Organic materials** (foliage, lawn) take a silhouette line only, never inner lines between blobs. Otherwise
  trees read as rocks.
- **Watercolour.** Edge darkening 10 % within about 1.75 px of each line, a pigment mottle of ±3.5 %, and paper
  grain on everything.
- **Ink weight.** Machines and buildings 100 %, archive tiles 75 %, ore tiles 70 %, decoratives 45 %. Terrain marks
  are lighter again (grass ticks 32 %).
- **Seeds.** The pen-pressure noise is seeded per entity, direction and variant with `crc32`, never per frame:
  lines must not shimmer in animation, and Python's `hash()` is randomised per process.
- **Glass** is a 22 % wash you see through, and invisible to the line passes, so the interior is inked (the
  Seminar's table and chairs read through the dome).

## 6. Materials and modelling rules

- **Model from the data's `sprite` line and the entity's description** (items.yaml, entities.yaml). Examples:
  - the Keypunch is a cream and steel-blue desk machine with a card hopper; because it "Burns fuel.", a small
    stove-engine at its back drives it by belt and smokes while it works;
  - Assembling machine 1 is "Set by plugboard.": patch cords on its front;
  - the File drawer is an oak two-drawer cabinet with brass label holders.
- **Detail lives on the top and the south face** (§2). The smallest feature that reads at 1× is about 0.1 m
  (3 px), so model only what clears that.
- **Silhouettes come first.** Each family needs one silhouette that survives 0.3× (9.6 px per tile): the
  Seminar's dome, the furnace's chimney and mouth, the drill's ring gear, the steam engine's flywheel.
- **Era truth** (spec 07 §23): relays and tubes in the Memo tier, stored-program cabinets and tape in the Report
  tier, transistor racks in the Article tier, accelerator halls at takeoff. No anachronism inside a tier.
- **Bevels** at the style's width × 0.6 (crisp). Ink makes edges read, not highlights.
- **Image-model room.** Every material has an optional image slot (`materials.set_texture(key, path)`,
  box-projected). Every terrain tile type reads a 512² seamless texture from `design/art/textures/<style>/<tile>.png`
  when one exists (`terrain.materials`). Image-model output must be a *wash*: flat, low contrast, no lighting baked
  in, because the bands, hatching and ink are added afterwards.

## 7. Icons

- **Same projection, same pen.** Icons are the item's 3D model, rendered in the world's camera, auto-framed and
  passed through the ink pass (`proto/render_icons.py`). An item on a belt is the same object as in the world.
- **Sizes.** Rendered at 128 px; shipped at 64, 32 and 16. Icon lines are thinner than sprite lines (silhouette
  5.0, inner 2.2 at 2×) and *sel-out*: the outline is tinted toward the darkened local fill, so hue survives at
  16 px.
- **Families** keep 07 §23:
  - papers are one sheet silhouette, the science colour being one detail (band, cover);
  - reels and drives, modules, chips per the table there;
  - a hexagon means weights, nowhere else.
- **The silhouette test** (07 §23 rule 6, automated in `proto/metrics.py`):
  - every item at 16 and 32 px on a belt line-up;
  - 8×8 Lab thumbnails compared pairwise, under normal vision, deuteranopia and protanopia;
  - flag any pair closer than 7 (mean ΔE over the 64 cells) for review.
  - Measured on the final set: closest pair coal–wood 7.7; closest information–matter pair 8.7 (6.7 under
    protanopia); information group L\* 45 against matter 35.
- **Building icons** are the entity model in its default state, framed the same way.
- **Technology icons** (256 px) follow the same pipeline. A technology without a single object uses its key item
  or a scene composed of items.

## 8. Status

| State | What the sprite shows |
|---|---|
| Working | the animation runs; emitters are lit (fire mouth, globe pendant, pilot lamp) and leave their warm stain; burners smoke (3 inked cloud puffs per chimney, drifting east) |
| Idle, no input, output full | animation frozen on frame 0; the `idle` variant (mouth dark, globe unlit, no stain, no smoke); status lights per 07 §16.2 |
| No power or no fuel | the `idle` variant plus Factorio's flashing warning icon (unchanged) |
| Our statuses (no staff, understaffed, throttled by heat, compromised) | the icons and lights of 07 §3.3 and 08 §8.2; the sprite shows working or idle according to whether it crafts |

The mock shows three working furnaces beside an idle one (`mocks/survey-final-1x.png`).

## 9. Animation

| Kind | Frames | Rule |
|---|---|---|
| Machines, furnaces, Keypunch | 16, seamless | animated parts on their own layer over a static base (10 §9.1: the base has the animated parts hidden; each layer frame is the inked frame cropped to its animation rectangle) |
| Drills | 16 × 4 directions | the turret's ring gear turns |
| Belts | 16 per piece | chevron ridges advance 1/16 of their 0.25-tile pitch per frame |
| Inserters | parts | base, arm and hand rotated in 2D (10 §6.8); arms in the high layer |
| Steam engine | 16 | flywheel, crank and governor, speed from output |
| Smoke, steam | particles | render-time only, never simulated |

Rules:

- Belt chevron ridges are a deliberate readability addition: direction reads in a still and at 0.5×.
- **Readability rule:** the animated layer of a working machine must change at least 3 % of the sprite's pixels per
  loop, with at least one moving part 0.3 tile or larger.
- The prototype Keypunch moves 0.5 %; its card bed and flywheel are too small and must be enlarged before
  production.
- **Registration:** static pixels must be identical across frames (`extras.py anim` checks it).

## 10. Eras

- **Machines** change by tier (§6). `mocks/survey-final-eras.png` shows Assembling machine 1 (Memo, plugboard),
  Assembling machine 2 (Report, stored program with tape) and the Research hall (System card, accelerator hall
  with roof fans), all with one pen.
- **Towns** follow the Field, with five skins at W < 15, 15–35, 35–55, 55–75 and ≥ 75 (01 §5.3).
  - Skin 1 is in the mocks: brick college halls with white trim and slate roofs, a classical library, clapboard
    houses, shops with awnings.
  - Later skins keep the plate and change the buildings: postwar modern, 1970s concrete, glass, data halls.
- **The plate.** Proposed, not mocked: the paper and the UI's printing follow the Field in three steps, a global
  LUT and CSS change:
  - buff paper and typewriter (Field before 1965);
  - white paper and IBM-style line printing (1965–1995);
  - near-white with a clean grotesque (after 1995).
  - The ink, the bands and the sprites never change. That is the one exception to rule 6, and it is optional.
- **Heat.** As computing scales, the heat overlay's contextual tint (07 §3.2) reads naturally on a survey plate,
  as an isotherm wash. Trees losing leaves to heat (01 §2.2) are drawn as bare inked branches: leaf stages 4 → 1.

## 11. Terrain and decoratives

- **Materials.** Each tile type is a seamless 512² texture covering 8×8 tiles at High (`proto/terrain.py`),
  sampled in world space.
- **Boundaries.** Each soft tile type's mask is blurred at 0.55 tile, upsampled, offset by world-anchored noise,
  and each pixel takes the strongest type. That gives organic shores with no tile staircase. Crisp types (town
  tiles, concrete) keep exact edges and inked kerbs. This is the shader's noise mask of 10 §6.5.
- **Water** gets water-lining: lines parallel to the shore at 0.12, 0.30, 0.52, 0.80, 1.15, 1.60, 2.2 and 3.0
  tiles, fading with distance, plus an inked shoreline.
- **Biomes** (01 §2), proposed and not yet in the prototype's survey materials:
  - tundra: snow wash `#eef1f2` with ice blue `#d8e6ec`;
  - steppe: dry-dirt stipple;
  - desert: dense sand stipple.
- **Resources** are sprites per tile at 70 % ink (iron, copper, coal and quartz rubble; the archive's paper
  bundles), 6 variants each, with depletion stages removing pieces (8 in the engine).
- **Decoratives** are grass tufts, pebbles, bushes and weeds at 45 % ink. Their density is capped per chunk and
  culled below 0.5× (10 §6.12).
- **Woodland tint** under tree clusters at 30 %.

## 12. The UI skin (layout unchanged; skin only)

Factorio's layout, sizes and behaviour stay exactly as I §4 and 07 §2. Only the materials change:

- **Frames are manila folders** (`#cdb27a`, edges `#e6d3a2` / `#6f5a36`) with a faint paper fibre. **Content panels
  are cream index cards** (`#f4ecd8`) ruled in pale blue `#a9bfd0`, the library catalogue card. **Slots** are small
  cards with a red top rule (40 px, icon 32 px), corner radius 1 px.
- **Printed text is Libre Franklin**, an open revival of Franklin Gothic, the workhorse face of American official
  printing: window titles in ExtraBold capitals 14.5 px, tracked +1.2; labels and descriptions 13.5 px.
  **Typed values are Courier Prime**, 14 px: counts, numbers, the Field year, percentages. The HUD reads as a
  filled-in form. Courier itself dates from 1955; here it stands in for a 1940s pica typewriter face, and a
  period pica revival can replace it without other changes.
- **Accents.** Red `#b5352a` (selection, destructive), green `#4f7a3c` (confirm, progress, Working).
- **Progress bars** are hatched green.
- **The minimap** is a survey sheet: paper, woodland, water blue, urban pink, ink features.
- **Glyphs** are drawn, never typed: `⇒` is missing from many faces, so the yields arrow is a path.
- **Fonts** (all OFL) are fetched by `proto/fetch_fonts.sh` into `design/art/out/fonts`. Ship them as WOFF2.
  Titillium Web stays the world-label font of 10 §6.11 for train stops and map tags, or move those labels to
  Libre Franklin too (proposed).
- All strings come from the text canon (08 and `text.yaml`); the mock's docked tooltip uses the Keypunch's data
  description verbatim.

## 13. Pipeline (what exists, what works on this host, what the asset WP must build)

### 13.1 Layout

```
design/art/proto/
  lib/style.py        styles: palettes, light vectors, bands, ink parameters (no bpy)
  lib/materials.py    Blender materials from the style tables: flat (survey) and PBR (kept for reference)
  lib/parts.py        bmesh primitives: box, taper_box, cyl, cone, sphere, torus, tube, gear, prism, hip_roof,
                      wedge, rock, blob, lattice, point_light, join, rotate_all
  lib/rig.py          camera, canvas, split light rig, passes (colour, shadow, normal, aux, light)
  entities/<id>.py    one model per entity: META (size, height, directions, frames, variants) and build()
  items/models.py     item models for icons
  render.py           Blender entrypoint: sprites    render_icons.py  Blender entrypoint: icons
  post.py             trim, downscale, the ink pass, glow, sprite loading
  terrain.py          tile materials and the tile-map renderer
  scene.py, layouts.py, mock.py   the engine emulation (layer order of 10 §6.2) and the mock scene
  ui.py               the HUD skin as SVG, rasterised by resvg
  contact.py, metrics.py, budget.py, extras.py   contact sheets, legibility metrics, budgets, night/eras/animation
  render_all.sh       every sprite and icon the mocks need, for one style
```

### 13.2 Commands

```
design/art/proto/fetch_fonts.sh
design/art/proto/render_all.sh survey 16             # about 14 min for 120 sprites and 25 icons
gamedev-python design/art/proto/mock.py survey --tag final
gamedev-python design/art/proto/extras.py night survey      # also: eras survey; anim survey keypunch
gamedev-python design/art/proto/contact.py survey
gamedev-python design/art/proto/metrics.py survey
gamedev-python design/art/proto/budget.py survey
```

Single entity:

```
taskset -c 8-15,24-31 blender -b --factory-startup -noaudio --python design/art/proto/render.py -- \
    --style survey --entities keypunch --frames 0-15 [--directions N,E,S,W] [--state idle]
```

### 13.3 Settings known to work (Blender 5.2.2, Cycles CPU)

- Survey colour pass: 16 samples, no denoiser.
- Normal and aux passes: 1 sample, 2× resolution, filter width 0.01, dither 0, 8-bit PNG (8-bit-safe id
  encoding).
- Light pass: 4 samples. Shadow pass: 64 samples.
- View transform *Standard*, film transparent, `threads_mode='FIXED'`, 16 threads.
- OIDN works on this AVX-only CPU (PBR styles).
- Measured cost: 6.8 s per sprite on average, including scene build (a 3×3 machine 12 s for five passes, a tree
  25 s, a 6×6 town block 53 s), plus about 1 s per sprite for the ink pass in numpy.

### 13.4 Naming

- Sprites: `out/sprites/<style>/<entity>/<entity>[-<variant>]-<dir>-f<frame>[-<state>].<pass>.png`, with
  `manifest.json` per entity (canvas, anchor in High px).
- Icons: `out/sprites/<style>/icons/<id>.<pass>.png`.

### 13.5 What the asset-pipeline WP (10 §9) must build from this

1. **Port the passes and the ink pass into the build.** `post.survey_ink` and the glow step run in
   `scripts/build-assets.ts` through Python, before trimming and packing (10 §9.2 step 1).
2. **Render each model once per direction, then only its animated layer per frame.** The prototype rebuilds the
   scene per frame, which makes a full 6,000-frame set take about 11 hours on 16 threads. Building once and
   rendering animated layers only (10 §9.1 #4) brings it near the spec's 2 hours.
3. **Shadow masks** at Normal resolution with values below 0.03 clipped, and the glow sprite (RGB) as its own atlas
   (10 §6.4's lights array).
4. **Icons through `render_icons.py`, not hand-authored SVG** (§7). SVG stays for UI glyphs and 9-slices (10 §9.3).
5. **The checks:** footprint and anchor, shadow direction, the legibility metrics of §7, and frame registration of
   §9.
6. **Cache** by content hash of the entity script, `lib/` and the style table (10 §9.1).

### 13.6 Budget (measured on the 120 prototype sprites; `out/budget/*.json`)

- **Per frame.** Mean trimmed colour area 28k px at High. Flat colour compresses 10–16 % better than the PBR
  styles: lossy WebP q90, 3.1 kB per sprite against 3.4–3.7 kB.
- **Full game, if every animation frame were a full sprite:** 51 colour pages at High, about 1.1 GB with mips,
  over 10 §6.13's 768 MB.
- **With animated-layer frames** (about 25 % of the sprite area): about 17 pages, about 380 MB.
- **Slice:** about 13 pages full-frame (about 285 MB, just over the 256 MB slice budget); about 4–5 with layers
  (about 100 MB).
- **Download:** colour about 18 MB for the full game, well under 200 MB.
- **Planned M3 KTX2 compression** (10 §6.13) gives a further 4× when needed.
- *Update (WP B2, 2026-10-20):* superseded by spec 10 §9.2 and §9.6. Atlases ship as KTX2 XUBC7 transcoded to BC7 from M0, a format chosen by measurement on pages from this pipeline. An itemised model of every sprite set (10 §9.6) gives the slice 8 pages and 43 MB of GPU memory at High, and the full game 33 pages and 183 MB.

## 14. Do and don't

**Do**
- Draw every object with an ink silhouette and three flat bands. Hatch what faces away. Keep the ground light.
- Make information paper: lightest items, ink marks, the science colour as one detail.
- Show work: lit emitters, a warm stain, smoke, a moving part of at least 0.3 tile.
- Put detail on top faces and south faces. Test every sprite at 1× and 0.3×, and every icon at 16 px on a belt.
- Name materials by role (`steel_paint`, `paper_manila`); let the style table choose the colour.
- Keep era truth by tier, and town skins by the Field.

**Don't**
- Don't use gradients, glossy highlights, bloom, lens effects, depth of field, vignettes or film grain on the
  world.
- Don't use pure black or pure white: ink is `#2b2723`; the brightest paper is `#fcfaf3`.
- Don't give matter items ink marks or paper colours. Don't give information items dark bodies.
- Don't ink foliage blob against blob, and don't let decoratives or resources out-ink machines.
- Don't hand-paint over renders, or the pipeline can no longer reproduce the asset.
- Don't use text in the world except as the spec allows (10 §6.11). No invented strings on signs or labels;
  labels are blank brass plates.
- Don't recolour Factorio's tier colours, status colours or science colours.

## 15. Spec text this direction changes (proposed; the manager owns the edits)

| Where | Now | Proposed |
|---|---|---|
| 07 §23, "Projection and light" | "desaturated colour with a warm key light and grime" | "the Survey plate (`design/art/DIRECTION.md`): ink silhouettes, three-band washes, hatched shadows, paper ground" |
| 07 §23 rule 1 | palettes by hue | add: information items L\* ≥ 84 with ink marks; matter ≤ 74 (quartz excepted); 20 L\* between same-hue pairs |
| 10 §9.1, `materials.py` | "The look is Factorio-like: desaturated, a warm key light, grime" | "flat emission washes in three N·L bands; an ink pass in the build adds lines, hatching and glows" |
| 10 §9.1, passes | colour, shadow, light, animated | add normal and aux (2×, 1 spp) for the ink pass |
| 10 §9.3 | icons hand-authored SVG | icons rendered from item models through the ink pass; SVG for UI glyphs and 9-slices |
| 10 §6.2 step 9 | LUT for colour-blind modes | also the day–night cyanotype LUT |
| 10 §7.4 | "dark grey frames … orange highlight" | the manila-and-index-card skin of §12 (layout untouched) |

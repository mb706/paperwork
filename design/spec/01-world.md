# 01 — The world: map generation and world rules

*Round 4 revision (R4-world) of R2-W's chapter. Canon: `DECISIONS.md` (binding, §1–§38 with the accuracy refinements), B-ontology L1–L16, F-pressure Variant A, C-spacetime §5, G-endgame, H-tone-bible, D's data ids. Round 4 adds the tile and world-object prototypes (§2.1–§2.2), the hour-one compactness guarantee (§9), the staffing retune and the Terminal (§8, §8.9), the W bookkeeping (§12.1) and the save state (§13.1). Round 5 (R5-apply, DECISIONS §40): town names are unique within 8 cells (§5.3; R5-gate D1). Tags: **ISO** keeps Factorio's mechanic, **BEND** is a small deliberate deviation, **BREAK** a large one. Ids in `code` are spec-data ids. Heat is specified in 03-pressure; the endgame in 04-endgame. Sims: `design/round4/world-sim/`.*

## 0. Conventions

| Term | Meaning |
|---|---|
| Tile | 1 m, as in Factorio. A **chunk** is 32 × 32 tiles |
| Axes | x grows east, y grows **south** (Factorio's convention). North is −y |
| Spawn | Tile (0, 0). *d* is the Euclidean distance from spawn, in tiles |
| Time | 60 ticks per second. Game hours are play time at 1× speed |
| W | The world level in **field-years** since 1945 (§12). "Field: 1983" means ⌊W⌋ = 38 |
| Seeded RNG | Every random choice below uses a deterministic hash of (map seed, feature stream, cell or chunk coordinates). The same seed always produces the same world |
| Competent pace | Balance's reference player (R3-balance §2): a Factorio veteran whose factory supports a linearly rising research rate, calibrated so that Factorio 2.0's red-to-yellow tree takes 8 h. Hour figures below use it unless they say otherwise |

## 1. The plane

The world obeys B's laws L1–L3 and L15. In one paragraph:

- One endless physical continent. Everything on it is **matter, energy or a place**. Information has no position: it exists on carriers (§10), as ideas (the tech tree), or as the world's text, summarized by the global numbers W, j and σ (§12).
- **People are places.** Towns are static terrain (§5). Their writing reaches you as data (archives, exchanges) and their work as staff (§8). People are never items, fluids, fuel or entities.
- **No calendar.** The charter's 1945 is the only date in the world. Eras are states of technology: yours, or the world's (W). Historical years appear only as citations and in the Field and Literature readouts.

## 2. Terrain and biomes (ISO, plus the climate compass)

The terrain is Nauvis-like (ISO): tiles, water, forests, cliffs, rocks and resource patches that get richer with distance. One BEND: **biomes follow the ambient temperature θ** (§3), so the map reads as a compass.

| Biome | θ (°C) | Ground tiles | Trees (× Factorio's forest density) | κ of the ground (s⁻¹, 03 §1.2) |
|---|---|---|---|---|
| Tundra | θ < −5 | snow and ice (70%), rock (30%) | 0.2×, conifers | 0.0075 / 0.004 |
| Boreal | −5 ≤ θ < 5 | dirt, grass; snow patches where θ < 0 | 1.2× conifers where moisture > 0.5, else 0.6× | 0.005 |
| Temperate | 5 ≤ θ < 22 | grass, dirt (ISO Nauvis) | 1.0× (ISO) | 0.005 |
| Steppe | 22 ≤ θ < 28 | dry dirt, red desert | 0.3×, savanna trees | 0.003 |
| Desert | θ ≥ 28 | sand | 0.05× | 0.003 |

- **Moisture** is Factorio's second terrain noise (0–1). It sets forest density within a biome and the frequency of lakes: lake noise threshold × (0.5 + moisture). Deserts have few lakes; boreal land has many.
- **Boundaries** blend over ±2 K of θ with tile-level noise, so there are no straight biome lines.
- **Water, deep water, cliffs:** ISO noise and sizes. **Rocks** (§2.2) yield Quartz, and the huge ones Coal, in place of Factorio's stone and coal.
- The ground's cooling coefficient κ feeds the heat field (03 §1.2). Every tile's κ is in §2.1.

### 2.1 Tiles (R3-impl B3; data: `tiles.yaml`)

Every map tile is one of these prototypes. A chunk's κ is the mean over its 1,024 tiles, plus its trees (03 §1.2).

| Tile (data id) | κ (s⁻¹) | Buildable | Walking speed (ISO) | Placed by | Mined back | Where |
|---|---|---|---|---|---|---|
| grass, dirt | 0.005 | yes | 1.0 | — | no | temperate, boreal |
| dry-dirt, red-desert | 0.003 | yes | 1.0 | — | no | steppe |
| sand | 0.003 | yes | 1.0 | — | no | desert |
| snow, ice | 0.0075 | yes | 1.0 | — | no | tundra; boreal patches |
| rock-ground ("Rock") | 0.004 | yes | 1.0 | — | no | tundra |
| water, deep-water | 0.020 | no (offshore pumps and Water exchangers stand on the shore) | — | — | no | lakes, everywhere |
| landfill | 0.0015 | yes | 1.0 | `landfill`, on water only | no | — |
| concrete, hazard-concrete | 0.0015 | yes | 1.4 | `concrete`, `hazard-concrete` | yes | — |
| refined-concrete, refined-hazard-concrete | 0.0015 | yes | 1.5 | `refined-concrete`, `refined-hazard-concrete` | yes | — |
| town-street ("Street") | 0.0015 | no | 1.0; cars drive it | — | no | town footprints (§5.3) |
| town-block ("Town") | 0.0015 | no | blocks the player and vehicles, as rocks do | — | no | town footprints |
| out-of-map | — | no | — | — | no | beyond a bounded map's edge (10 §5.18) |

- "Buildable" means entities, ghosts, rails and placed tiles may go there. Resources do not change buildability.
- Map colours and sprites are in the data.

### 2.2 World objects (R3-impl J9; data: `world.yaml`, `meta.start.salvage`)

Worldgen places these. The player may mine or click them and never builds them.

| Object (data id) | Size | Mining | Yields | Notes |
|---|---|---|---|---|
| Tree (`tree`) | 1 × 1 | 0.5 s | 4 `wood` | ISO forest noise × the biome factor (§2). No regrowth (ISO). 4 leaf stages, lost to heat (03 §1.2) |
| Big rock (`big-rock`) | 2 × 2 | 1.5 s | 20 `quartz` | ISO rock noise; Factorio's stone becomes quartz |
| Huge rock (`huge-rock`) | 3 × 3 | 2 s | 24–50 `quartz` and 24–50 `coal` | as above |
| Big sand rock (`big-sand-rock`) | 2 × 2 | 1 s | 19–25 `quartz` | deserts and steppe |
| University (`campus`) | 8 × 8 | — | — | One per university, part of a town footprint (§5.4). Selectable; opens the University window (§8.7) |
| Exchange (`exchange-office`) | 4 × 4 | — | — | Cosmetic, inside the footprint edge nearest its taps (§5.4) |
| Mine entrance (`mine-entrance`) | 4 × 4 | — | — | Cosmetic, beside a records store (§6.2) |
| Laboratory salvage | six wreck pieces and one crate | 1 s each | §9 | Defined once, in `meta.start.salvage` (DECISIONS §33) |

## 3. The climate compass (BEND, B L2)

Ambient temperature falls toward the north; sunlight rises toward the south. Siting compute in the cold and solar in the sun is the 2026 datacenter game, played with a map.

**Ambient temperature** (per chunk, evaluated at the chunk centre, static for the whole game):

> θ(x, y) = clamp( 14 + y / 80 + n(x, y), −15, 35 ) °C

- *n* is simplex noise, one octave, wavelength 512 tiles, amplitude ±3 K, seed stream `ambient`: valleys and uplands.
- Gradient: 12.5 K per 1,000 tiles. θ reaches −5 °C (F's "cold" calibration case) near y = −1,520 and 28 °C (F's "hot") near y = +1,120. It is clamped at −15 °C beyond y ≈ −2,300 and at 35 °C beyond y ≈ +1,700.
- Spawn therefore sits at 11–17 °C.
- θ has no day–night or seasonal cycle. Factorio's pollution has none either, and a fixed siting map is the point.

**Sunlight** scales solar output:

> s(y) = clamp( 1 + y / 5,700, 0.6, 1.3 ) at the chunk centre,   solar panel output = 60 kW × s × daylight(t)

- daylight(t) is Factorio's day–night curve (ISO): 25,200 ticks (7 minutes) per day, Factorio 2.0's Nauvis (1.1 had 25,000); the numbers are `meta.heat.daylight`; full light from dawn (0.75 of the day) to dusk (0.25), none from evening (0.45) to morning (0.55), linear between.
- s = 0.73 at y = −1,520 (−5 °C), 1.2 at y = +1,120 (28 °C).

**Readouts.**
- The **Heat overlay** (03 §1.7) shows absolute temperature, so every charted chunk shows θ before anything is built. The compass is readable in remote view from minute one.
- Hovering any tile or entity shows "Ambient 14 °C · Sunlight 100%".

**Settings.**
- *Climate compass: off* sets θ = 14 °C and s = 1.0 everywhere. Biomes then follow moisture only (ISO Nauvis).
- *Heat: off* (03 §1.9) keeps θ for biomes and s for solar, but simulates no heat field.

## 4. Resource patches (ISO numbers, D's resources)

D's `resources.yaml` says "ISO". A parametric model that approximates Factorio 2.0's defaults is given here, so worldgen can be implemented directly. Tune by eye against Factorio's map preview at equal sliders.

**Starting patches.** Exactly one patch of each, placed inside the starting college's coverage square by §9's rule (DECISIONS §32), never under a town footprint or the starting archive:

| Resource | Amount (±20%) | Per tile (a₀) | Tiles (blob radius √(tiles/π), ±30% edge noise) |
|---|---|---|---|
| Iron ore `iron-ore-patch` | 600,000 | 1,000 | ≈ 600 |
| Copper ore `copper-ore-patch` | 500,000 | 1,000 | ≈ 500 |
| Coal `coal-patch` | 400,000 | 800 | ≈ 500 |
| Quartz `quartz-patch` | 300,000 | 600 | ≈ 500 |

**Regular patches.**
- Each resource has a jittered grid of cells of size *c*. Each cell holds a patch with probability *p*, centred uniformly in the cell's middle 60%.
- Patch radius: r(d) = r₀ × √(1 + d / 1,500). The blob has ±30% edge noise.
- Amount per tile: a(d) = a₀ × (1 + d / 800).

| Resource | id | yields | c (tiles) | p | r₀ | a₀ (per tile) | Not within |
|---|---|---|---|---|---|---|---|
| Iron ore | `iron-ore-patch` | `iron-ore` | 224 | 0.90 | 14 | 1,000 | — |
| Copper ore | `copper-ore-patch` | `copper-ore` | 240 | 0.85 | 13 | 1,000 | — |
| Coal | `coal-patch` | `coal` | 256 | 0.80 | 12 | 800 | — |
| Quartz | `quartz-patch` | `quartz` | 288 | 0.70 | 10 | 600 | — |
| Uranium ore | `uranium-ore-patch` | `uranium-ore` (+1 `sulfuric-acid` per ore) | 640 | 0.35 | 8 | 400 | d < 512 (ISO: never in the starting area) |

- **Quartz bias (D):** a cell whose centre is within 64 tiles of water, or on sand, has p × 1.5 (capped at 0.95). Quartz favours coasts and dry riverbeds.
- **Scale.** An iron patch holds about 0.6 M at spawn, 2.3 M at d = 1,000 and 9 M at d = 3,000. That is Factorio's "richer outward" curve.
- **Water** (`water`, offshore): ISO lakes. **Trees** (`trees`): ISO forest noise × the biome factor (§2).
- **Patches avoid towns.** A patch tile never lies under a town footprint. Town placement (§5.1) rejects sites that would cover more than 5% of a patch.
- **Hand mining (ISO).** The player may hand-mine any solid resource, including uranium ore, which needs sulfuric acid only in a drill.
- **Map-generation sliders (ISO):** frequency scales p and shrinks c by √f; size scales r₀; richness scales a₀. Each ranges from 1/6× to 6×.
- Towns' own resources (archives, exchanges) are placed with their towns (§5–§7). Records stores have a separate grid (§6.2).

## 5. Towns (BEND, B L3)

### 5.1 Placement

- **Town grid.** Cells of 256 × 256 tiles (8 × 8 chunks), aligned so that spawn is the centre of cell (0, 0).
- **Each cell other than (0, 0)** holds a town with probability *P*, chosen by the distance *d* from spawn to the cell centre:

| d (cell centre) | P(town) |
|---|---|
| ≤ 768 | 0.30 |
| 769–2,048 | 0.45 |
| > 2,048 | 0.55 |

- **Site.** The town centre is uniform within the cell's central 160 × 160 square.
  - The footprint must be at least 85% land, contain no cliff and overlap no resource patch by more than 5%.
  - It must keep 64 tiles from every other footprint, and lie wholly inside a bounded map.
  - Up to 8 candidate centres are tried, then the cell stays empty.
- **Cell (0, 0)** holds only the starting college town (§9).
- **Expected counts.** Within 768 tiles of spawn there are about 8 towns plus the starting college, about 4 of them with a university. Within 2,048 tiles there are about 85.
- **Sliders:** *Town frequency* (scales P, 1/3× to 3×) and *Town size* (shifts the class table below one row down or up at ½× and 2×).
- Towns come from a pure function of the seed and the cell, so a town, its university and its supply exist whether or not its chunks have been generated (staffing counts them, §8.2).

### 5.2 Size classes and institutions

A town has a class, a footprint and up to three institutions, at most one of each kind. Probabilities by distance band are given as ≤ 768 / 769–2,048 / > 2,048.

| Class (data enum) | Footprint | P by band | University (T₀, §8.1) | Library archive (records) | Exchange taps | Writing floor *f* | Closed to crawlers at σ ≥ |
|---|---|---|---|---|---|---|---|
| Village (`village`) | 16 × 16 | 40 / 25 / 15% | — | 30%: 20–40 k | 50%: 1 | 10% | 0.80 |
| College town (`college-town`) | 24 × 24 | 35 / 25 / 15% | College, T₀ = 8 | 70%: 40–80 k | 60%: 1–2 | 15% | 0.70 |
| Town (`town`) | 32 × 32 | 25 / 35 / 35% | 50%: University, T₀ = 12 | 85%: 80–160 k | 2–3 | 20% | 0.60 |
| City (`city`) | 48 × 48 | 0 / 15 / 25% | University, T₀ = 24 | 200–400 k | 3–4 | 30% | 0.45 |
| Metropolis (`metropolis`) | 64 × 64 | 0 / 0 / 10% | University, T₀ = 48 | 0.5–1 M | 4 | 40% | 0.30 |

The starting college (`starting-college`, §9) is a college town with T₀ = 12.

- **Scaling with distance.** Archive totals and initial exchange yields are multiplied by (1 + d / 2,000). Larger and richer with distance, as ore is (B L3).
- **Initial exchange yield** (the backlog) per tap, before that multiplier:

| Class | Village | College town | Town | City | Metropolis |
|---|---|---|---|---|---|
| Initial yield | 100–200% | 150–300% | 300–600% | 600–1,200% | 1,200–2,500% |

- The **writing floor** *f* and the **closure threshold** are used in §7. The university's T₀ is used in §8.

### 5.3 Footprint and status

- **Footprint.** A rectangle of town tiles (§2.1): `town-street` tiles and `town-block` tiles. Every tile inside the footprint becomes a town tile, so water inside it becomes land.
  - **Layout** (cosmetic, but fixed for determinism): measured from the footprint's north-west corner, a tile is street where (x − x_f) mod 8 < 2 or (y − y_f) mod 8 < 2, otherwise block. The campus (§5.4) and the exchange office take their cells over. Block tiles carry building sprites of the town's era.
  - The player walks the streets, and cars drive them.
  - Nothing can be built on a town tile: no entities, no ghosts, no rails, no landfill, no concrete. Underground belts, pipes-to-ground and underground data lines may pass beneath a town, because only their two ends occupy tiles (ISO tunnel rule). Electric and circuit wires may span a town.
  - Town tiles have κ = 0.0015, as paving does. A town is a small heat island; it emits nothing itself.
- **Status.** Towns are indestructible and inert.
  - They never act on your structures. Runaways never target them (L13), and Wild nests never form on or within 32 tiles of them (03 §3.6). Heat never damages them.
- **Era skin.** A town's look follows the world's era, W, not yours (B L3). There are five skins, at W < 15, 15–35, 35–55, 55–75 and ≥ 75, switched globally at the thresholds (no per-town hysteresis).
  - Exchanges likewise move from **telegraph office** (W < 20) to **telephone exchange** (20 ≤ W < 45) to **internet exchange** (W ≥ 45, field year 1990).
  - The resource keeps one name, **Exchange**, which is true in 1945 and now (H P12).
- **Names.** Towns get procedural place names from 08-text §10.4's generator.
  - **Unique within 8 cells** (2,048 tiles; R5-gate D1), not per map: the map is endless, and each climate band's pool holds about 200 names. A town draws a name; a name already held by a higher-priority town within 8 cells is rejected and redrawn, up to 8 times; then " II" is appended (" III" if that is held too). Priority is the cell hash that settles the 64-tile footprint rule (10 §5.18), so a name, like a footprint, never depends on generation order. The numbers are `text.yaml`'s `town_names.uniqueness`.
  - College towns' universities, the starting college's included, are "<Town> College". Towns', cities' and metropolises' are "<Town> University".
- **Tooltip** (hover, map or world; layout and wording 07 §7.1):
  > Ashford. Town. University: staff 24.0. Library: 112,400 records. Exchange: 3 taps; closes to crawlers at synthetic share 60%.

### 5.4 Where the institutions sit (each is exposed at the town's edge, B L3)

| Institution | World object | Placement | Exposed as |
|---|---|---|---|
| University | `campus`: an 8 × 8 block of the footprint, on its 8-tile grid; inert, with a GUI (§8.7) | On the footprint edge whose coverage strip has the most buildable land: for each edge, count the buildable tiles of its R = 48 strip outside the footprint, take the maximum, ties N, E, S, W. Along that edge it takes the grid cell nearest the middle (ties: the lower index). The starting college is the exception (§9) | A staffing source (§8) |
| Library | `archive` resource tiles | Adjacent to the footprint, outside it, on the side opposite the campus where possible. n = clamp(round(total / 1,500), 16, 400) tiles: the n tiles nearest a seed point beside the footprint, excluding water, cliffs, town tiles and other resources (ties in row-major order). Each tile holds ⌊total / n⌋ records, and the first (total mod n) tiles in row-major order hold one more, so the total is exact | An ore patch (§6) |
| Exchange | `exchange` resource points (taps), plus the cosmetic `exchange-office` inside the footprint edge nearest them | Taps are clustered 6–16 tiles outside the footprint, at least 4 tiles apart (room for 3 × 3 buildings) | A crude-oil-like field (§7) |

## 6. Archives (BEND, D2; B L3, L8)

### 6.1 Library archives

Library archives are finite stocks of undigitized pages at towns.
- **Totals** by class are in §5.2. The **starting college archive** holds exactly 80,000 records in 53 tiles (§9).
- **Mining (ISO).** An archive is a solid resource: `archive` yields `records`, mining time 1.
  - Burner and electric drills mine it, and the player can hand-mine it ("hand-digitizing", B L14).
  - Records become Tokens in the Keypunch (burner) or the Tokenizer (electric), 3.2 s per token (D).
- **Mining productivity** research applies, as it does to all drills.

### 6.2 Records stores in old mines

Records stores are archives away from towns (B: Iron Mountain has stored records in an iron mine since 1951).
- **Grid** of 512 × 512 cells. A cell holds a store with probability 0.25, only if d > 512, the store is at least 128 tiles from any town footprint, and every tile of its blob lies inside the map.
- **Size:** 150–300 k records × (1 + d / 2,000), on a single compact blob (§5.4's tile rule), with a `mine-entrance`.
- **Role.** These are the big remote archives. A rail line to one is the mid-game's "go further out for the past".

### 6.3 Low-background data

- Every archive has σ = 0 forever (B L8, DECISIONS §5). Archives were written before any text was generated.
- **What that does mechanically.**
  - Archive records feed Tokens, and Tokens feed the Synthetic data recipe (D's liquefaction analog), Datasets and Memos.
  - Training on archive-fed Synthetic data carries no model collapse: only the crawl share of the Site's text is penalised (03 §2.2).
  - Once exchanges start closing (§7.5), archives plus Synthetic data become the data supply that no σ can close.
  - Archives stay precious for the whole game.
- **Tooltip line** (H §5, B §5; R3-accuracy §2.4), shown once σ > 0: *"Written before any text was generated."*

### 6.4 Budget (for balance; R3-balance m2, `balance-data/records.py`)

Preprints and Model cards cost 3.33 records each (Datasets in the Tokenizer and the Checkpoint), and a System card 5.75 through its frontier run:

| Records use, main tree to closure | Records |
|---|---|
| Memos (1 record each) | ≈ 50 k |
| Datasets in Preprints and Model cards (3.33 per pack) | ≈ 177 k |
| Frontier runs (8,000 System cards at 5.75) | ≈ 46 k |
| **Total** | **≈ 273 k** (the path alone 124 k; with Branch M 485 k) |

- Cumulative use: 14 k at the end of Article, 67 k at the end of Preprint, 166 k at the end of Model card.
- The starting archive (80 k) runs out early in the Model card tier. That is the *Data wall* achievement as a mid-game event, not a late one.
- By closure the player has mined 3–4 further archives.

### 6.5 Optional: sealed stores (A §1.3, "rediscovered results"; deferred)

- **Hook only.** One records store in eight could be *sealed*. Hand-mining its entrance yields one **Find**. Scanned in a Seminar, a Find offers one of two alternate recipes, with one reroll, seeded.
- This rewards exploring beyond ore without a market.
- It needs a list of alternate recipes, so it is **not in v1**. Worldgen reserves the flag (`sealed: true`) so that adding it later does not change maps.

## 7. Exchanges: crawl wells (BEND, D3; B L3, L8)

### 7.1 Taps

Each tap (`exchange`, a fluid resource point; D: mirrors crude oil) holds:

| State | Meaning |
|---|---|
| A | The **backlog**: remaining amount of the town's accumulated writing, in Factorio units (300,000 = 100% yield) |
| f | The town class's **writing floor** (§5.2) |
| σ_c | The closure threshold (§5.2) |
| closed | Whether the tap is closed to crawlers (§7.5) |

- Initial A₀ = initial yield × 300,000. For example, a 450% tap starts with A₀ = 1,350,000.
- A tap holds one building: a **Crawler** (reads the town's text) or an **Endpoint** (serves your model to the town, 03 §2.4). That makes each tap a choice between data in and deployment out.
- Taps exist from 1945, as telegraph offices. A tap can be built on once *Crawling* unlocks the Crawler (it requires *Packet switching*) or *Deep learning* unlocks the Endpoint. No separate "tapping" effect exists (R3-impl J22).

### 7.2 Yield: the backlog first, then the floor (ISO constants, BEND floor)

> y = max( A / 300,000 ,  F(W) ),   F(W) = f × max(1, 2^((W − 40) / 20))
>
> Crawler output = 10 units/s × y × crafting speed × (1 + productivity) × D_syn

- **D_syn** = 1 before *Synthetic detection*. After it, D_syn = (1 − σ): detected synthetic text is not fetched (§7.4).
- **Depletion (ISO).** Each mining cycle removes 10 from A while A / 300,000 > F(W). Cycles per second = y × speed.
  - Productivity output does not deplete (ISO).
  - Without productivity, a single crawler's backlog decays with a time constant of 30,000 s (8.3 h) at speed 1, as Factorio's oil does.
- The floor replaces Factorio's minimum yield; the exchange has no other minimum.
- **The floor is the town's rate of new writing** (B L8). It rises with W, doubling every 20 field-years after the field passes 1985:

| Writing floor F(W) | W ≤ 40 (to 1985) | W = 50 | W = 60 | W = 62 (typical closure) | W = 80 |
|---|---|---|---|---|---|
| Village | 10% | 14% | 20% | 21% | 40% |
| College town (and the starting college) | 15% | 21% | 30% | 32% | 60% |
| Town | 20% | 28% | 40% | 43% | 80% |
| City | 30% | 42% | 60% | 64% | 120% |
| Metropolis | 40% | 57% | 80% | 86% | 160% |

- **Ratios a veteran knows (D):** one crawler at 100% feeds half a data refinery on Deduplication; at a 20% floor, a tenth.
- **Example.** A town tap at 450% with one crawler reaches a 43% floor after 30,000 × ln(450 / 43) ≈ 70,000 s, about 19.6 h of pumping. With crawler productivity it lasts longer, and the floor keeps rising behind it.

### 7.3 The mix at the tap

New text from a tap is curated : junk : synthetic in the proportions (1 − σ)(1 − j) : (1 − σ)·j : σ (B L8).

- **j** (the junk share) acts in the refinery, as a drift in its product mix (03 §2.1).
- **σ** acts at the tap and on training (§7.4, 03 §2.2).

### 7.4 Synthetic text: before and after detection

- **Before *Synthetic detection*.** The synthetic share cannot be told apart from human text. Crawl volume is unchanged.
  - The recipes that train on text (Checkpoint, Post-training payload) run at **speed × (1 − σ·c)**, where c is the share of the Site's recent text and prose that came from crawling rather than from archive-fed Synthetic data (03 §2.2 has the exact rule). This is model collapse as the Trainer feels it: training on what the world now writes takes more compute.
  - The Trainer shows it as an effect row, "Synthetic share 31% × crawl share 58%: speed −18%" (wording 07/08).
- **After *Synthetic detection*.** Crawlers discard what they detect. Output is **× (1 − σ)**, and the Trainer penalty is gone.
- **The trade.** Detection trades crawl volume for training speed, and the readouts show both numbers. Archives are the third answer (§6.3). In the base game, recall is 1 and there are no false positives. C's false-positive rate and *Detector calibration* belong to the Stacks (06-expansion).

### 7.5 Walled gardens (BEND, F §1.2)

- A tap **closes to crawlers for good** when σ reaches its town's threshold: 0.30 for metropolises, 0.45 cities, 0.60 towns, 0.70 college towns, 0.80 villages.
- The tooltip shows the threshold from the start: "Closes to crawlers at synthetic share 45%". The status reads "Closed to crawlers".
- **Endpoints on a closed tap keep working.** A closed platform still welcomes deployments. So σ keeps rising after the gardens close, and nothing in the UI says so.
- **Typical schedule** (03 §2.3; σ ≈ 0.43 at the first run and 0.55 at closure for a player who researches the whole yellow tier): metropolis exchanges close during the Model card tier, city exchanges between the first frontier run and closure, and towns' only under heavy deployment.

### 7.6 Data lines (D, BEND)

- Crawl leaves a crawler through a data line, never a pipe (D §4.4).
- A data-line network is also a **link** for runaways (03 §3.3). A crawler network that reaches deep into the base is a risk only if it also reaches compute.
- From the Report tier, data lines also carry staff: **Terminals** on one data-line network join their universities' staffing networks (§8.9).

## 8. Universities and staffing (BEND, B L9; DECISIONS §7, §23)

**Only Seminars need staff.** Every other machine is automation (ISO). Staff are a coverage field, shared like electric power, with no upkeep and no consumption. Understaffing slows research and nothing else, so it cannot spiral (A §7 D3).

### 8.1 Supply: T(W)

> T = T₀ × min(2, 1 + 0.08 · W)   staff-equivalents per university (`meta.staffing.supply`: `per_field_year` 0.08, `max_multiplier` 2)

T₀ by class: starting college 12, other colleges 8, towns 12 (half of towns have a university), cities 24, metropolises 48 (DECISIONS §23b; R3-fun FUN-02).

- The world trains researchers as the field grows: +8% of T₀ per field-year, so supply doubles by W = 12.5 (Field 1957, about 1.5 h at the competent pace) and then holds. Round 5 doubled round 4's slope (+4%, doubling at W = 25; R5-play #1): the fast (6-h) player now reads 92% at hour one instead of 75%, the competent player's short bind before *Citation index* (92%) is gone, and the ceiling, and so every number from about 2.7 h on, is unchanged (`staffing_r4.out`). The doubling comes early, while the player's research block is small; the ceiling makes universities, not the calendar, the late game's lever.
- Tuned with balance's model (`round4/world-sim/staffing_r4.py`, §8.8): the cap is legible from the first Seminar, binds briefly in early Article for a competent player with no claim, and binds again before closure, so that Researchers decide the takeoff's speed (04 §2.4).

| W (Field) | ×min(2, 1 + 0.08·W) | Starting college | College | Town | City | Metropolis |
|---|---|---|---|---|---|---|
| 0 (1945) | 1.00 | 12.0 | 8.0 | 12.0 | 24.0 | 48.0 |
| 7 (1952; 1 h at the competent pace) | 1.56 | 18.7 | 12.5 | 18.7 | 37.4 | 74.9 |
| 9 (1954) | 1.72 | 20.6 | 13.8 | 20.6 | 41.3 | 82.6 |
| ≥ 12.5 (1957 on; from about 1.5 h) | 2.00 | 24.0 | 16.0 | 24.0 | 48.0 | 96.0 |

### 8.2 Coverage: commuting range R

- A university's coverage is its campus rectangle (8 × 8) expanded by **R** tiles on every side, measured as Factorio measures supply areas (Chebyshev).
- **Exact test** (R3-impl U3): with the campus occupying tiles [x₀, x₀ + 8) × [y₀, y₀ + 8), an entity centred at (cₓ, c_y) is covered iff x₀ − R ≤ cₓ < x₀ + 8 + R and y₀ − R ≤ c_y < y₀ + 8 + R. Seminar centres are half-integers, so a Seminar is never exactly on an edge; the half-open interval settles the Terminal's integer centres.
- The square is like a power pole's supply area, only larger.

| R | Value | Area |
|---|---|---|
| Base | 48 tiles | a 104 × 104 square |
| After *Packet switching* (green) | 72 | 152 × 152 |
| After *Web search* (blue) | 108 | 224 × 224 |

- Each upgrade is ×1.5, multiplicative, from the technologies' `staffing-radius` effects (the table is derived from them).
- At R = 108, a campus placed between two towns about 220 tiles apart draws on both. Siting for overlap is a staffing puzzle of the midgame; the Terminal (§8.9) is the other.

### 8.3 Demand (DECISIONS §23a)

> demand_i = w_i × max(0.2, 1 + Σ speed effects of the Seminar's own modules + Σ speed effects it receives from Switches)

- **Staff follow speed.** A Seminar boosted by Coprocessors and Switches needs staff in proportion. Otherwise Switches dissolve the cap at Preprint (one Seminar did the work of 18–22) and the Researcher does nothing measurable (R3-balance M1).
- **What is free.** Laboratory-speed research raises every Seminar's speed without raising demand: better methods make the same people faster. Productivity effects (Learned controllers in Seminars, *Research productivity*) raise output without demand. Under the cap, these are the levers, with more universities and, at the end, Researchers.
- **w_i** (R3-impl U1) is the share of the last 60 ticks in which the Seminar was *working*: it had a research job, the papers for the current unit (or a unit in progress), electric satisfaction > 0, and it was not compromised. The engine counts working ticks since the last recompute.
- A Seminar with a Researcher in its staff slot demands nothing from towns (§8.6).
- The Seminar GUI shows the number once modules or Switches act: "Staff demand 2.4".

### 8.4 Staffing networks and satisfaction

- A **staffing network** is a connected component of the graph whose nodes are universities, Seminars and Terminals (§8.9), with edges:
  - university–Seminar, when the Seminar's centre is covered (§8.2);
  - university–Terminal, when the Terminal's centre is covered;
  - Terminal–Terminal, when both are on one data-line network and both are powered.
- Every covered Seminar is a node, whatever its state (idle, unpowered or holding a Researcher), so topology changes only with buildings, R and Terminal links (R3-impl U2).
- Networks merge when coverage overlaps a common Seminar, or a Terminal pair joins them, as power networks merge when a pole bridges them.
- **Satisfaction** per network:

> s = min( 1, Σ T over its universities / Σ demand over its Seminars )
>
> Seminar research speed = (base speed incl. bonuses) × s

- The graph is rebuilt and s recomputed every 60 ticks.
- This is ISO with Factorio's power satisfaction: every consumer in a network gets the same fraction.
- **Colour** (R3-impl J24): a network's hue is index (the lowest university id in the network, the town cell key of 10 §5.10) mod 8 in a fixed 8-hue palette, so hues do not flicker when networks merge or split.
- Displayed percentages round half up; the simulation keeps the exact value.

### 8.5 Seminar states

| State | Condition | Speed factor | Entity status (icon and text) |
|---|---|---|---|
| Staffed | covered, s = 1 | 1 | "Working" |
| Understaffed | covered, s < 1 | s | "Understaffed: 74%" (like "Low power") |
| No staff | outside all coverage, no Researcher | 0 | "No staff" (like "No power") |
| Researcher | Researcher in the staff slot | min(normal satisfaction, u_p) × throttle m_h (03 §1.3) | "Working (Researcher)"; "Low power" with the line "Compute is supplied last." when u_p < 1 |

### 8.6 The staff slot and the Researcher (DECISIONS §7)

- **The staff slot.** Every Seminar has one, a new slot type drawn next to its two module slots. It accepts only a `researcher`, by hand or by construction-agent item request; inserters never insert into it.
- **The Researcher.** Recipe: 4 `accelerator` + 1 `frontier-checkpoint` (returned), 30 s in the Trainer. Unlocked by *Automated research*; it needs the frontier checkpoint that frontier runs return (04 §2.2). A Seminar with a Researcher:
  - counts as **fully staffed** whatever the university supply (staff 1, demand 0), and so may take every module and Switch the player gives it;
  - draws **+500 kW** in the interruptible compute class (04 §3.3), only while the Seminar is working, and emits that power as heat in its chunk (03 §1.1). The 500 kW is scaled by neither the Seminar's modules nor *Dennard scaling* (accelerators come after it); *Energy per operation* scales it (04 §10);
  - runs at min(normal satisfaction, u_p) × m_h, where u_p is the compute satisfaction and m_h its throttle: it throttles as an Accelerator-class machine (T* = 25 °C, 03 §1.3);
  - is a **deploying building** for the leak, at tier 4, with the Researcher's quality (03 §3.2); for the runaway rules it is *powered* while min(normal satisfaction, u_p) > 0 (03 §3.3);
  - needs coolant only while it is installed: every Seminar has its coolant box from *Liquid cooling*, and the box needs flow only while a Researcher is in the slot (03 §1.4; R5-gate D12g);
  - may do **hollow work**, shown as its yield, depending on the verification count and the Researcher's quality (03 §4).
- **What the Researcher does not do.** It does not raise research per paper. It staffs, and staffing lets the Seminar take boosts (G §2.4).
- **Staffing off** (Advanced setting): every Seminar has staff 1; the slot stays, and a Researcher works as usual (500 kW, leak, hollow work).
- Lifting the town cap restores factory-bound research. The regime change comes from *Model generation* (04).

### 8.7 Legibility from hour one (A §7 D3)

A capped input is resented when discovered late and loved when legible early. So the cap is shown from the first Seminar.

- **Staffing overlay** (map-overlay registry, I BEND-6). Coverage squares are drawn like power-pole supply areas, in the network's hue. Terminal links are drawn as lines in the same hue.
  - Seminars show a small staff icon.
  - Uncovered Seminars show the "No staff" icon, exactly as unpowered machines show "No power".
  - The overlay switches on automatically while a Seminar or Terminal is in the cursor, as the supply area does for poles.
- **Seminar GUI.** A staffing bar under the power bar: "Staff 100% · Ashford College: 18.7 supply, 10 demand".
- **University window** (click the campus): supply T and its two factors ("T₀ 12 × 1.56 (Field 1952)"), demand, satisfaction, the Seminars and Terminals in the network, the universities linked by Terminal, and the nearest other university with its distance and direction (R3-fun FUN-02 C). This is the electric-network info panel's twin.
- **Research widget.** When research speed is limited by staff, the progress bar's tooltip says "Staff-limited (74%)": the lowest satisfaction among the Seminars working on the current research.
- No alert. Understaffing is a steady state, and a repeating alert would be noise.
- **Hour one.** The starting college supplies 18.7 staff at the competent pace's hour one (W ≈ 7). A ten-Seminar red block runs at 100%. The number, its source and the ways to raise it are visible before the first green paper.

### 8.8 Calibration against the competent pace (R3-balance M1 and §2; `round4/world-sim/staffing_r4.py`)

The model is balance's: a competent factory whose research rate rises linearly (Factorio 2.0's red-to-yellow tree in 8 h; 6-h and 12-h variants), our tree, the demand rule of §8.3 (so the research cap is staff × laboratory speed) and the supply law of §8.1. "Claim" means one more university joined to the network; the cheapest is a college linked by Terminal (§8.9) once *Time-sharing* is researched, which now requires *Packet switching* (about 2.5 h at the competent pace).

| Competent pace (8 h) | No claim | One college linked by Terminal |
|---|---|---|
| Hour one | 100% (18.7 supply, about 12 Seminars' work) | 100% |
| Late Report (≈ 2 h, before *Citation index*) | 100% (round 4's slope: 92%) | 100% |
| Early Article (≈ 3.5 h) | **90%** | 100% |
| Preprint and Model card (4–8 h) | 100%, then 92% at 8 h | 100% |
| White phase (9–11 h) | 81% → 72% | 100% |
| Tier ends, later than with no cap | Report +0.00 h, Article +0.05, Model card +0.15, white +0.46 | 0 |
| Staff at closure | 24 | 40 |
| Takeoff with / without Researchers (04 §2.4) | 50 / 126 min | **50 / 78 min** |

- **The fast player** (6-h pace) reads 92% at hour one and 79–92% until a Terminal exists (about 1.9 h; round 4's slope gave 68–78%), and without a claim 44–88% for the rest of the game (Report +0.16 h … white +2.0 h). A Terminal-linked college restores 100% from about 2 h to the white phase (94%) and cuts every delay to ≤ 0.06 h. For this player, claims are the intended game.
- **The relaxed player** (12-h pace) is never bound before the white phase.
- **Universities and Researchers are substitutes at the takeoff.** Each further college linked adds about 0.9 System cards per second of human Seminar capacity: a second college makes the takeoff without Researchers 60 min, a college and a town 56 min, against 50 with Researchers (04 §2.4).
- **G's plateau** is the stretch before closure. The white technologies (480,000 lab-seconds; 780,000 with *Formal verification*) are researched by staffed Seminars only; Researchers need *Automated research*, the last of them. The six frontier runs that pay their System cards (1.5–3.7 h, 04 §1) are the longer pole, so the plateau is run-bound for a player with a claim and staff-bound only for one without.
- While the player waits, building compute costs nothing: the overhang (G §2.5).

### 8.9 The Terminal (DECISIONS §23d)

*Time-sharing*'s terminals let a researcher use the machine from another building, and then from another city. Here a pair of them joins a far university to the Site's Seminars over a data line.

| Property | Value |
|---|---|
| Entity | `terminal` ("Terminal"), 2 × 2, 30 kW electric, one data-line connection |
| Recipe | 5 `logic-board` + 5 `copper-cable` + 1 `data-line`, 2 s |
| Unlock | *Time-sharing* (Report), which requires *Packet switching* for the data line |
| At a university | when its centre is covered by that university (§8.2, at the current R) |
| Linked | two Terminals on one data-line network, both powered (electric satisfaction > 0) when the graph is rebuilt |

- **Rule.** A Terminal is a node of the staffing graph (§8.4): it joins every university that covers it, and a linked pair joins their two networks. So one Terminal in a far campus's coverage, one in the home college's coverage and a data line between them make one network, whose supply is shared by every Seminar in it. A Terminal adds no staff and demands none.
- **Statuses.** "Working" (linked to a Terminal at another university); "Not linked" (yellow: no linked Terminal at a different university); "No university in range" (red); "No power" (ISO).
- **Cost.** A data line and power at both ends, instead of a research outpost supplied with every paper by train. Research outposts at far towns still work.
- **Containment.** A Terminal is not susceptible and creates no runaway link of its own. Its data-line network is a link for any susceptible machine on it (03 §3.3), so a staff line that also carries crawl is a path between whatever the crawl network touches.
- The tooltip is the data's (08).

## 9. The starting area (guarantees; DECISIONS §32, §33)

The opening fits in about 150 tiles, as Factorio's does: the ores, the first archive and the first Seminars all sit inside the starting college's coverage square.

| Guarantee | Rule |
|---|---|
| **The starting college town** | Footprint 24 × 24, class `starting-college`. Its campus (8 × 8) is the middle cell of the footprint edge facing spawn, in a seeded cardinal direction (the first of the four, in seeded order, whose layout passes every rule below). Spawn lies 16–32 tiles from the campus edge, with a lateral offset of at most 16 tiles, so spawn and the whole footprint lie inside the coverage square at R = 48 (104 × 104) |
| — its university | College, T₀ = 12 (§8.1). The legible cap from minute one |
| Ores | One patch each of iron, copper, coal and quartz (§4), each whole blob inside the coverage square, at least 2 tiles from the footprint, at least 6 tiles from any other starting patch and at least 3 tiles from spawn |
| — its library | Archive of exactly 80,000 records (53 tiles), adjacent to the footprint and wholly inside the coverage square |
| Room to build | The coverage square holds at least 7,500 buildable tiles (of 10,816) and an axis-aligned 40 × 40 square of buildable tiles (resources allowed; water, cliffs and town tiles not) |
| Water | A lake of at least 400 tiles within 128 tiles of spawn. Spawn lies inside the coverage square, so the lake is always within 128 tiles of the square (round 3's softer target, 160 tiles on 95% of seeds, is met on every seed) |
| — its exchange | One tap: initial yield 200%, floor f = 15%, closes to crawlers at σ = 0.70. Tappable after *Crawling* |
| Trees | A forest of at least 200 trees within 64 tiles |
| Climate | θ at spawn within 11–17 °C (§3) |
| Clear ground | No cliffs within 32 tiles. No uranium within 512 tiles |
| **The salvage** (B §4.1; Factorio's crash site) | **Laboratory salvage** within 16 tiles of spawn: six wreck pieces (mining one, 1 s, yields 5 `iron-plate`) and one crate (1 s) holding 1 `radar`, 10 `logic-board` and 20 `copper-cable`. Defined once, in `meta.start.salvage` (DECISIONS §33) |
| Inventory | D's `meta.start`: 1 burner mining drill, 1 stone furnace, 8 iron plates. **No weapon** (DECISIONS §3) |

- Worldgen places the college first, then the patches and the archive by rejection sampling, and retries the whole layout (up to 8 times) before moving to the next direction. In 5,000 simulated layouts none failed; spawn is a median 36 tiles from the iron patch's centre (90th percentile 64) and 68 tiles from the farthest starting patch (`round4/world-sim/startarea.py`). Round 2's rule left no starting patch inside the coverage on 41% of seeds (R3-fun FUN-05).
- U54 asked for a 60 × 60 buildable square inside the coverage. That cannot fit: the footprint lies inside the 104-tile square and leaves at most 48 tiles on any side. The 40 × 40 square plus the count is the guarantee.
- The radar is the one assembled machine in the salvage, the Rad Lab's. The line *"Surplus from a wartime laboratory."* belongs to the salvage's Handbook entry, where it is true, not to the radar item, which the player later crafts new (DECISIONS §33).
- A's *Salvage the wreck* trigger technology is optional. E's tree starts with *Prior art*.

## 10. Carriers and copying (B L6; D §1)

| Rule | Mechanic | Examples (D's ids) |
|---|---|---|
| Information exists only on a carrier | Every informational item is a medium with content | `token` (punched cards), `drive`, `dataset`, `checkpoint`, `frontier-checkpoint`, papers, `ratings` |
| Carriers are rival and conserved | Normal items: stack, belt, chest | — |
| Copying takes a blank carrier and returns the original | Catalyst recipes in Kovarex's shape; the original is shown as "(returned)" | *Copy weights*: 1 `frontier-checkpoint` + 1 `drive` → 2. Learned and Distilled controller 1, Logistic agent, Synthetic data, Researcher and the Endpoint all take a checkpoint and return it |
| Consuming means incorporating | Data goes into weights (its novelty is spent); a paper goes into an idea; weights go into a controller. The medium is recycled off-screen | Seminars consume papers; Trainers consume Datasets |
| A stream is content in transit | Data lines behave as pipes; a drive filled from a stream is a barrel; a wagon of drives is a fluid wagon | `crawl`, `junk`, `text`, `prose` in data lines; `crawl-drive` …; `data-wagon` |
| Nothing else duplicates | No recipe creates information from nothing, except the Research hall, whose System cards are research done by the loaded weights (04 §2.3) | — |

## 11. Data by era (B L10)

| Era (tier) | Source | Carrier | Factorio shape | In the base data |
|---|---|---|---|---|
| Relays, tubes (Memo) | Archives: the past, keypunched by hand or by machine | Punched cards (`token`) | Ore | `archive` → `records` → `token` (Keypunch) |
| Transistors (Report) | Bigger archives farther out; records stores | Tape, drives | Ore, richer outward | §6.2; `drive`, data lines |
| Networks (late Report, Article) | Exchanges: the present (backlog first, then the floor) | Streams in data lines | Oil | `exchange` → `crawl` → refinery (§7) |
| Learning (Preprint) | Images and video (gated, like uranium); labels from deployment | Drives | Gated ore | **Not in v1.** D's optional media archive. Labels arrive as `ratings` from Endpoints (03 §2.4) |
| Agents (Model card) | Your own models: synthetic data | Streams, drives | Liquefaction, cracking | *Synthetic data* (checkpoint returned) |
| Takeoff and beyond (System card) | The world itself: automated experiments | Drives | Asteroids (Space Age) | Research hall runs (04); the Stacks and sensors in the expansion (06) |

## 12. The world's text: W, j, σ (B L8, F §1.2, C §5, G §5.5)

Three global numbers sit in the evolution factor's slot. They have no position, so they add no layout puzzle. Their effects are in 03 §2. The leak counter L (03 §3.2) is shown beside them. Their parameters are data (`meta.world`).

### 12.1 W, the world level (field-years since 1945; C's F)

W has two stored parts, **W = W_own + W_pub**, updated every 60 ticks:

> W_own ← W_own + (v₀ / 3,600) · γ(W)        W_pub ← W_pub + (publication released this second)

| Symbol | Meaning | Default |
|---|---|---|
| v₀ | The field's own pace, in field-years per hour | 2.0. Race 2.9, Race (hard) 3.4 |
| γ(W) | The field's own takeoff (G §5.5): 1 for W < 80; (m/g)^((W − 80)/0.5) for 80 ≤ W < 90; 1 again from W = 90, the field's capstone, 2035. m and g are the "Returns to research" setting's (04 §4). It scales only W_own | — |
| Y_pub | The latest citation year among researched technologies with `regime: cited` whose cost includes a paper other than System cards (trigger technologies have no cost and are excluded). It starts at **1945** | 1945 |
| Publication | When Y_pub rises by ΔY = max(0, year − Y_pub), W_pub gains β·ΔY field-years, released evenly over the next 600 s (B: "ideas leak … after a lag"). Technologies paid only in System cards never leak, because frontier work is internal (G) | β = 0.5 |
| W₀ | — | 0 at the start (1945) |

**Race mode** adds 0.002 to W_own for every Significant result that spoils (Scooped, 03 §5): what you sat on, they published.

**Typical values** (the competent pace at v₀ = 2.0; `round4/world-sim/arc_r4.py`; the publication term saturates at +39.5 once Literature reaches 2024):

| Moment | 1 h | Report end | Article end | Preprint end | Model card end | First run | Closure | Capstone |
|---|---|---|---|---|---|---|---|---|
| Game time | 1.0 h | 3.1 h | 4.5 h | 6.1 h | 8.5 h | 9.0 h | ≈ 11.5 h | ≈ 12.3 h |
| W | 7.0 | 31.3 | 42.0 | 48.5 | 55.6 | 57.0 | 62.1 | 63.8 |
| Field | 1952 | 1976 | 1987 | 1993 | 2000 | 2002 | 2007 | 2008 |
| Literature | 1955 | 1995 | 2011 | 2018 | 2023 | 2023 | 2024 | 2024 |

- Six frontier runs, about 15–37 min each depending on the run material built, make the white phase 1.5–3.7 h (04 §1; the arc model takes 25 min, 2.5 h), so closure falls at about 11–13 h. A fast (6-h) player closes at about 9.4 h; a relaxed (12-h) one at about 15.7 h.
- **Race** (03 §6). With the publication term saturated, W reaches 90 at about 42.2 / v₀ hours: 21.1 h at 2.0, 14.6 h at 2.9 and 12.4 h at 3.4. Race is a comfortable win for a competent player; *Race, hard* is a coin toss for one.

**Readouts** (DECISIONS §13; R4-ui places them):
- **Field: 1945 + ⌊W⌋.** The tooltip shows the two parts, W_own and W_pub, in 08 §4.7's words: "The field's own work: … The Site's papers: …".
- **Literature: YYYY:** the latest citation year among researched technologies with `regime: cited`, trigger technologies included (H, DECISIONS §35). "—" before any. It stops at 2024.
- **Years ahead** = Your year − Field year, where **Your year** = ⌊max(Literature, the `field_year` of researched technologies with `regime: beyond`)⌋, floored like Field so that the gap is a whole number. "—" while Literature is "—".
  - *Model generation L* carries the field-year 2025 + 0.5 × (L − 5), so level 25 reads 2035 (G). The Fifth Generation project is a Handbook note, not a citation (DECISIONS §35).
  - Other `beyond` technologies read 2025.
  - A negative value reads "N years behind".

**Considered and not adopted: a discount on technologies the field already knows** (adopt list item 5, A §1.3). Rivals already matter without entities, through four things: the years-ahead readout, the σ world term, Race mode and Scooped. A discount would add three problems:
- C §5's objection holds: a technology that gets cheaper if you wait is one you wait for.
- Citations are the *earliest* source (H P3), so a citation-year test would discount techs arbitrarily, for example SGD at 1951.
- In Race mode it would rubber-band.

### 12.2 j, the junk share of new human text

j follows W's era and is never zero (B: sensational journalism was junk before any model existed).

> j(W) = 0.30 for W ≤ 49; linear to 0.45 at W = 59 (networks carry spam); linear to 0.55 at W = 67 (content farms); 0.55 after.

At the competent pace: 0.30 through Preprint, 0.40 at the end of Model card, 0.49 at closure. Display: "Junk share 41%".

### 12.3 σ, the synthetic share of new text

> σ = 0.9 · Σ / (1 + Σ)   (the evolution factor's squash; σ < 0.9 always)

Σ starts at 0 and only grows:

| Source | Increment to Σ |
|---|---|
| Your deployments: each `ratings` produced by an Endpoint (03 §2.4) | a = 2 × 10⁻⁴ (DECISIONS §29). Halved after *Watermarking*: generated text carries a signature that exchanges can filter, so much of the marked text never counts as new writing |
| The world's own models, once W ≥ 70 (field year 2015; the world then has generative models, partly yours, leaked) | 0.05 per field-year of W gained |

- **Calibration** (R3-balance M8). Ratings are forced: 1 per craft of 3 Model cards and 100 per frontier-run payload. So σ follows how much of the yellow tier the player researches: 0.08–0.62 at the first run, 0.38–0.67 at closure; typically 0.43 and 0.55 (03 §2.3 has the table). With *Watermarking* from early Model card, typically 0.29 and 0.40.
- At v₀ = 2.0, W reaches 70 only after a typical victory, so the world's own term is mostly a Race-mode and post-victory force.
- **Display:** "Synthetic share 31%". The word "slop" never appears, and neither does the symbol (H, DECISIONS §34).

### 12.4 Display group

| Readout | Value shown | Appears |
|---|---|---|
| Field | 1945 + ⌊W⌋, with its two parts in the tooltip | Always |
| Junk share | j, in % | Once exchanges can be tapped |
| Synthetic share | σ, in % | Once σ > 0 |
| Leak (Contained, Wild) | L, two decimals, with the building that holds the largest share (its position, tier and quality), the rate, the number of deployments and the verification count (03 §3.2) | Once a deploying building exists |

All four sit in the evolution factor's slot: the World strip, the World window and `/world` (07 §4). Their tooltip text is 08 §4.7's.

## 13. Hooks for the data (R4-data)

| What | Where it lives | Notes |
|---|---|---|
| Tiles | `tiles.yaml` (§2.1) | κ, buildability, walking speed, placed-by item, mined back |
| World objects | `world.yaml` (§2.2); salvage in `meta.start.salvage` | Trees, rocks, campus, exchange office, mine entrance |
| Starting area | `meta.start.guarantees` | §9 |
| `archive` autoplace | towns (§5.2), records stores (§6.2), starting college (§9) | Exact totals by §5.4's tile rule (`meta.world.archives`) |
| `exchange` | taps (§7.1), per-town f and σ_c (`meta.world.exchange`) | Fluid resource, infinite; the floor F(W) replaces any minimum yield |
| Ore patches | §4 parameters | Uranium: none within 512 tiles |
| Universities | `campus` objects; T₀ by town class (`meta.staffing.t0`) | Town-class enum: `starting-college`, `college-town`, `village`, `town`, `city`, `metropolis` |
| `meta.staffing` | supply {per_field_year 0.08, max_multiplier 2.0}, T₀, demand rule, radius 48 (upgrades from the `staffing-radius` effects), network and Terminal rules | §8 |
| `terminal` | entity, item, recipe; unlocked by *Time-sharing* | §8.9 |
| `meta.world` | v₀ 2.0 / 2.9 / 3.4, β 0.5, publication lag 600 s, Y_pub start 1945, j breakpoints, σ squash and a, Watermarking ×0.5, the world term (0.05 per field-year from W = 70), model collapse (03 §2.2), exchange and archive numbers | Settings in 00 §6 |
| `meta.heat.ambient`, `meta.heat.sunlight` | §3's constants | Evaluated at chunk centres |

### 13.1 World and pressure state that a save must hold (R3-impl J2; with R4-arch, 10 §8)

Everything my chapters define that is not derived each tick:

| State | Chapter |
|---|---|
| W_own, W_pub, Y_pub, and the queue of pending publication releases (start tick, amount) | §12.1 |
| Σ (σ and j are derived from Σ and W) | §12.2–§12.3 |
| The model-collapse production counters (text and prose made by crawl recipes and by Synthetic data over the last 36,000 ticks) and the crawl share c held from the last world-text pass | 03 §2.2 |
| Per tap: backlog A, closed flag | §7 |
| Per Seminar: working ticks since the last staffing recompute (for w_i), and the staff factor s applied since that recompute | §8.3–§8.4 |
| Per chunk: H, the emission and incoming-diffusion heat gathered since its last update, the tree leaf timer, each tree's leaf stage, the pristine flag | 03 §1.2 |
| Per computing machine: the throttle m held from its chunk's last 64-tick update | 03 §1.3 |
| L; ℓᵢ per deploying building; infections (id, tier, member serials, next firing tick); per machine its compromised flag and infection id, its consecutive zero-power tick count, its Wild escape due tick | 03 §3 |
| Wild: nests, their stocks, the evolution total T and its three terms | 03 §3.6 |
| Race state (setting, whether and when the field reached W = 90) | 03 §6 |
| Closure tick and the overhang snapshot; run-report accumulators; doubling-time samples (R̄ and its running maximum R̂) and the history string | 04 §8–§9 |
| Research queue entries with their bylines | 04 §5.1 |

Derived, never saved: the staffing graph, Terminal links, compute satisfaction u_p (recomputed every tick), σ, j and every exchange's floor F(W). A value computed at a cadence point and then held (s, m, c) is saved, so that a save taken between two cadence points continues bit-identically (10 §8.1).

## 14. Objections

1. **"Total speed" in DECISIONS §23a is read as module and Switch speed, with laboratory-speed research free.** Counting research bonuses as demand would make every lab-speed technology dead under the cap, and balance's model, from which the targets come, treats them as free. If Claude meant otherwise, change §8.3's formula; the targets of §8.8 would then need T₀ about 3.5× higher at closure.
2. **Universities can substitute for Researchers.** A player who links several colleges by Terminal before closure has enough human staff that Researchers save only a few minutes (§8.8: 56 → 50 min with a college and a town). I accept it: claims cost data lines, power and a containment path, the Researcher costs accelerators and a tier-4 leak, and the trade is visible. A hard cap on Terminal links would be bookkeeping without a fiction.
3. **σ's second target (≈ 0.6 at the end of takeoff, F) is not separately tunable.** One parameter, a, sets the deployment term; the takeoff raises σ only if the player keeps Endpoints running, because Research halls are internal deployments and write nothing to the world. σ ≈ 0.55 at closure is close enough. I did not add a second source.
4. **R3-impl U54 is infeasible as written** (§9): a 60 × 60 buildable square cannot fit in the coverage square around a 24 × 24 footprint. Replaced by a count and a 40 × 40 square.

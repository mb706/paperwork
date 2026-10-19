# 03 — Pressure: heat, the world's text, runaways

*Round 4 revision (R4-world) of R2-W's chapter. Canon: F-pressure Variant A (§1, §3, §4), B's laws L4, L5, L8, L13, DECISIONS §4–§6 and §21–§38 with the accuracy refinements, A's anti-cascade evidence (A §7). Round 4 adds the unified thermal-plant rule (§1.1, DECISIONS §24), the Switch's own thermal class (§1.3, §26), model collapse by provenance (§2.2, §31), linear spread and the full lifecycle of a compromised machine (§3.3, §27, R3-impl L2–L4), and every edge rule R3-implementability listed (U8–U15, U26–U40). Round 5 (R5-apply, DECISIONS §40) settles R5-gate's open points: the controller-immunity lists (D5), one-hop links (D6), Compromised-only circuit connectors (D7), the leak tooltip (D8), *powered* for a Researcher Seminar (D12f), the Seminar's coolant box (D12g), a race lost and then won (D12c), and the Wild gaps (D13). Ids are spec-data ids. World-side formulas for W, j and σ are in 01 §12; the endgame brakes in 04 §6. Sims: `design/round4/world-sim/`.*

## 0. Summary

Factorio's threats do four jobs: a **footprint tax**, a **clock**, a **frontier** and a **logistics test**. Here they are split three ways, and nothing smart is ever on the map.

| Factorio | Here | Slot | Present from | Tag |
|---|---|---|---|---|
| Pollution (footprint tax) | **Heat**: every joule used becomes heat in its chunk; computing machines throttle when their chunk is too hot | Per-chunk field (pollution's engine) | Minute one (overlay); throttling once computing machines exist (late Report) | BEND |
| Evolution factor (the clock) | **The world's text**: W (field level), j (junk share), σ (synthetic share). They drive the refinery mix, closing exchanges and training speed | Global numbers (evolution's slot) | Minute one (W). Exchanges matter from late Report | BEND |
| Biters (frontier, logistics test) | **Runaways**: copies of your own deployed models that leave your control. Contained inside the base by default | Leak counter + per-machine state | Your first deployment (Preprint) | BEND (Contained) / ISO loop (Wild) |

**Presets** (00 §6):
- Heat on/off.
- Runaways Off / **Contained** (default) / Wild.
- Hollow work on/off.
- Scooped off/on (forced on in Race).
- Race mode off / on / hard.

**Two rules hold everywhere:**
1. Every effect on production is deterministic and visible before it bites.
2. Pressure follows only quantities the player controls: their power draw, their siting, their deployments, their data sources (A, key finding 4).

## 1. Heat (L5; DECISIONS §4, §24; F §1.1)

### 1.1 Emission: every joule becomes heat where it is used (B L4)

| Emitter | Heat emitted into its chunk (the chunk rule below) | Examples (MW) |
|---|---|---|
| Electric machines | Their electrical consumption this tick: working draw or drain (data `energy.drain_kw`, ISO values), module and Switch consumption effects included. Throttling does not change it (§1.3) | Assembling machine 1/2/3: 0.075 / 0.15 / 0.375. Electric drill 0.09. Electric furnace and Tokenizer 0.18. Crawler 0.09. Seminar 0.06. Data plant 0.21. Data refinery 0.42. Trainer 0.4. Switch 0.48. Endpoint 1.0. Frontier cluster 3.99 |
| Interruptible compute (04 §3.3) | u_p × its draw, where u_p is the compute satisfaction | Research hall 5 / 8 / 12 / 16 by tier (mixed loads: Σ pᵢ / 20, 04 §2.3). A Researcher's 0.5. A hall at 60% compute satisfaction emits 60% |
| Burner machines | Their full fuel burn. Fuel values and burner consumption are ×3 (DECISIONS §18, §24), so item flows are unchanged | Burner drill 0.45. Stone and steel furnace, Keypunch 0.27. Burner inserter: its fuel burn. Locomotive and car 1.8 while moving |
| **Thermal generators** (`steam-engine`, `steam-turbine`, `fusion-generator`) | **2 × their current electrical output** (DECISIONS §24) | Steam engine at full load 0.9 out, 1.8 emitted. Steam turbine 5.82 out, 11.64 emitted. Fusion generator 50 out, 100 emitted |
| Boilers, heat exchangers, heat pipes, reactors (`nuclear-reactor`, `fusion-reactor`) | **No conversion heat.** One exception, waste: heat a reactor generates that it can neither pass on nor store is emitted into its chunk. A fission reactor at its 1,000 °C maximum keeps burning fuel (ISO), so its unused heat appears here. A reactor's separate electric draw (the fusion reactor's 10 MW) is emitted like any electric machine's | A lone fission reactor with no exchanger, at 1,000 °C: 40. A fusion reactor: 10 |
| Solar panels, accumulators | Nothing. The 0 is a rule, not physics (08 §11 #28) | — |
| Laser turret (Wild) | Its draw while charging, up to 1.2 MW | — |

- **Why at the generator.** A power station rejects its heat at the turbine's condenser. Emitting there spreads a plant's heat over the chunks its engines or turbines occupy instead of piling it into the boiler or reactor chunk (round 2 put 960 MW into one reactor chunk). A boiler's two engines emit 3.6 MW at full load, as the boiler did in round 2, so every non-nuclear number in §1.6 stands.
- **η ≈ 33% everywhere.** A boiler burns 5.4 MW of fuel for 1.8 MW of steam. The engines emit 3.6 MW and the consumers emit the 1.8 MW where they use it: 5.4 in total, energy conserved. The rule is per generator, not per fuel, so a reactor block's neighbour bonus (ISO, +100% heat per adjacent active reactor) also comes out at "2 × output at the turbines". That is a design rule (P17), not a balance sheet: it replaces DECISIONS §18a.
- Factorio's separate pollution multiplier is dropped, because heat *is* energy (F).
- Factorio's pollution falls with machine tier; heat rises with power. The inversion is deliberate: **denser is hotter** (F), the history of rack density.
- Speed modules and Switches raise power and so heat. Efficiency modules (Distilled controllers) lower both (ISO).
- **The chunk of an entity** (R3-impl U8): (⌊cₓ / 32⌋, ⌊c_y / 32⌋) of its geometric centre (cₓ, c_y). An even-sized entity whose centre lies on a chunk line therefore belongs to the chunk east or south of the line. The same chunk is used for its emission, its throttle reads and, for coolers, its sink.
- A multi-chunk entity (the 9 × 9 Frontier cluster, the 7 × 7 Research hall) emits into the chunk of its centre. That is a simplification. Splitting by footprint would be truer, but placing such buildings across chunk borders would then become an exploit to learn.

### 1.2 The field (Factorio's pollution engine, with Newton cooling)

Each chunk holds heat **H** (MJ). Its temperature is

> T = θ + H / C,   C = 20 MJ/K (a game constant, chosen for a response time of about three minutes)

where θ is the chunk's ambient temperature from the climate compass (01 §3).

**Update every 64 ticks** (Δt = 64/60 s), in this order:

1. **Emission.** H += Σ emitted power × Δt over the chunk's emitters.
2. **Diffusion (ISO).** If H ≥ 15 MJ (0.75 K), the chunk sends 2% of H to each of its 4 neighbours:
   - a generated neighbour receives it;
   - an ungenerated neighbour inside the map receives nothing: the share leaves the field and is booked under the **Map edge** sink;
   - an out-of-map neighbour (bounded maps) is not sent anything, so the edge reflects.
3. **Newton cooling (BEND).** H −= (κ_c · H + 0.002 MJ/s) × Δt, where κ_c is the mean κ of the chunk's 1,024 tiles (01 §2.1) plus its trees' contribution.
4. **Active sinks.** Cooling towers in the chunk remove heat (§1.4), at a rate set by ΔT = H / C as it stands after step 3 (the golden script's order).
5. **Clamp** H ≥ 0. Statistics book the heat actually removed, not the computed amount.

| Tile or object (01 §2.1 has the full tile list) | κ (s⁻¹) | × grass |
|---|---|---|
| Water, deep water | 0.020 | 4 |
| Snow, ice | 0.0075 | 1.5 |
| Grass, dirt | 0.005 | 1 |
| Rock | 0.004 | 0.8 |
| Sand, dry dirt, red desert | 0.003 | 0.6 |
| Concrete, hazard concrete, refined concrete, refined hazard concrete, landfill, town tiles | 0.0015 | 0.3 |
| Each healthy tree in the chunk | +0.000025 (0.5 kW/K) × its leaves left / 4 | 100 trees ≈ +50% |

- **Why Newton cooling** (F's simulation). With Factorio's constant sinks the field is diffusion-limited: in simulation a 150 MW base ran at +144 K, and a broad base ran hotter than a dense hall. Loss proportional to heat gives a response time of about 3 minutes and a length scale of about 1.4 chunks. Heat is then local, density matters and local cooling works.
- **Trees (ISO, as under Factorio's pollution).** Each chunk keeps a leaf timer: every update while T > 45 °C adds Δt to it, and an update with T ≤ 45 °C resets it to 0. Each time it reaches 600 s, every tree in the chunk loses one of its 4 leaf stages and 600 s is subtracted. A leaf change clears the chunk's pristine flag (10 §4.4). A tree's κ contribution scales with the leaves it has left; a bare tree contributes nothing.
  - Trees never damage entities. Their loss is bounded: a chunk can fall at worst to its ground's κ.
- **Water's reach.** A lake one chunk away cools a hall by only 1–3 K through diffusion. The shore pays through Water exchangers (§1.4) and through the water tiles' own κ, which is how real plants use it (F).

### 1.3 Who throttles, and by how much

Only **computing machines** throttle (B L11, F, DECISIONS §4). Every computing machine belongs to a thermal class with a limit T* (ASHRAE's air-cooling classes, and Telcordia's for network gear):

| Thermal class (data id) | T* | Members (ids) |
|---|---|---|
| Tube (`tube`) | 45 °C | None in the base data. Reserved: Assembling machines 1–3 stay mechanical (DECISIONS §9) |
| Computer (`computer`) | 40 °C | `data-refinery`, `data-plant`, `tokenizer` |
| Network (`network`, NEBS: Telcordia GR-63-CORE's long-term limit) | 40 °C | `switch` (DECISIONS §26: a class of its own) |
| Cluster (`cluster`, ASHRAE A2) | 35 °C | `trainer`, `endpoint` |
| Accelerator (`accelerator`, ASHRAE H1, the 2021 class for high-density equipment) | 25 °C | `research-hall`, `frontier-cluster`, and a `seminar` while a Researcher is in its staff slot |

**Throttle:**

> m = clamp( 1 − (T − T*_eff) / 50 K, 0.5, 1 ),   T*_eff = T* + 15 K × q
>
> power draw unchanged

| Machine | What m multiplies |
|---|---|
| Crafting machines (Computer and Cluster classes) | Crafting speed |
| Research hall | Its *Research run* speed |
| Seminar with a Researcher | Its whole research speed: the Researcher does the work |
| **Switch** (DECISIONS §26) | Every effect it transmits (speed and consumption, the only effects a Switch carries, as Factorio's beacon; 10 §5.5), by its **own** m, before the 1/√n profile. Its own draw is unchanged |
| Frontier cluster | Run-shard crafting speed. The launch itself never throttles |

- **q** is the liquid-cooling flow fraction (0–1) of the machine's coolant box (§1.4). A fully liquid-cooled machine gets +15 K (warm-water cooling, F).
- **Power draw unchanged** (L5): fans make up the difference, so throttling is pure loss and never cools the chunk (F).
- A throttled machine still counts as *working* wherever a rule asks (the leak in §3.2, staffing demand in 01 §8.3).
- **Never throttle:** mechanical machines, mines, furnaces, the Keypunch, assemblers, power plants, cooling buildings, Seminars without a Researcher, logistics, and three machines that run fixed procedures rather than learned weights: the **Monitor**, the **Verifier** and the **Constructor** (`deployer`, whose recipe holds no accelerators). None of the three can be compromised either (§3.1).
- The limits fall as density rises. **The constraint tightens every era and binds hardest at takeoff** (B L5).

### 1.4 Counters

| Counter | Arrives | Mechanic | Tag |
|---|---|---|---|
| Siting | Always | North is cold; shores, forests and grass cool better than sand and concrete; keep compute away from thermal plants (§1.6 gives the distances) | ISO-ish |
| Solar | *Photovoltaics* (Report) | No plant loss, so it cuts the heat footprint of power to a third (1 MW of heat per MW used, against a thermal plant's 3). Output × s(y) (01 §3) | ISO |
| Efficiency modules | Report on | Distilled controllers 1/2/3: −30 / −40 / −50% energy, and so heat | ISO |
| **Cooling tower** `cooling-tower` | *Evaporative cooling* (Report, 75 RG) | Removes up to **10 MW** from its chunk: full rate at ΔT = T − θ ≥ 5 K, linear below. Uses 1 water per 2.43 MJ removed (the latent heat of water at 30 °C), 4.1 water/s at full rate. Draws 300 kW. 3 × 3, 2 module slots that accept only consumption effects, so a Distilled controller cuts its draw (B L11: in 2016 a learned controller cut a datacenter's cooling energy by 40%) | BEND (an absorber entity) |
| **Liquid cooling** | *Liquid cooling* (Article) | Computing machines of the Computer, Network and Cluster classes and up gain a **coolant box** (in and out). A share ℓ = 70% of their heat goes into the coolant instead of the air, when coolant flows. Every Seminar gains the box too, whatever its staff slot holds; it needs flow only while a Researcher is installed (R5-gate D12g). Adds the **Dry cooler** and the **Water exchanger** | BEND (Factorio fluids, closed loop) |
| Dry cooler `dry-cooler` | *Liquid cooling* | 2 × 2, 200 kW. Takes hot coolant and rejects up to **20 MW** into its own chunk's air | BEND |
| Water exchanger `water-exchanger` | *Liquid cooling* | 3 × 3, 500 kW. Placed like an offshore pump. Rejects up to **50 MW** into the chunk of the water tile at its pumping position (the overlay defines that tile, as for the offshore pump) | BEND |
| *Dennard scaling 1–5* | Article (1–2), Preprint (3–5) | −8% energy per level for computing machines of the Tube, Computer, Network and Cluster classes, added to their module consumption effects; the total is floored at −80% (ISO). Not the Accelerator class: accelerators came after Dennard scaling ended. Level 5: "No further levels exist." | ISO (multi-level tech) |
| *Immersion cooling* | Model card | Liquid share ℓ 70% → 90% | — |
| *Two-phase cooling*, *Microfluidic cooling* | Takeoff (04 §5) | Each: Dry cooler and Water exchanger capacity ×2. Both act on the coolant loop, so neither touches the cooling tower (R3-accuracy §2.3) | BEND (G) |
| *Thermal management* (infinite) | after *Immersion cooling* and *In-context learning* | +10% capacity per level for all three cooling buildings, additive. Cost 1.5^L × 1,000 (geometric, DECISIONS §12) | ISO shape |

**The coolant loop** (one fluid, `coolant`, made from water, 1 unit carries 1 MJ):
- A machine's coolant box takes coolant at ≤ 35 °C and returns the same amount at 50 °C. Coolers take coolant at ≥ 45 °C and return it at 30 °C. As with steam's 165 °C and 500 °C, the two temperatures need separate pipes.
- **Temperature filters** (R3-impl U48). Machine coolant inputs accept coolant at ≤ 35 °C only; cooler inputs at ≥ 45 °C only. A pipe segment whose coolant is outside a box's range does not flow into that box. Mixing in one segment follows Factorio's fluid rule (temperatures average by volume). New coolant starts at 30 °C.
- **Flow needed** = ℓ × the machine's draw (MW → units/s); for a Seminar, ℓ × the Researcher's 500 kW while one is installed and 0 otherwise. q = coolant received ÷ flow needed, clamped to [0, 1], and 1 when nothing is needed. Heat to the air = draw × (1 − ℓ·q) each tick; the throttle's T*_eff uses q over the ticks since the chunk's last update (10 §5.8–§5.9).
- **Capacities combine** as capacity × Π multipliers × (1 + Σ values) over the `cooling-capacity` effects that name the cooler: *Two-phase* and *Microfluidic cooling* are ×2 each (×4 together, coolers only), and each *Thermal management* level adds 10% to all three.
- **No coolant, no stop:** heat simply goes to the air. Degradation is graceful, never a halt (F).
- **Example.** A 16 MW tier-4 Research hall at ℓ = 0.9 sends 14.4 MW into its loop: one Water exchanger serves three such halls, or a Dry cooler in a cold chunk serves one.

### 1.5 The four anti-cascade guards (A §7 D1, adopted; stated explicitly)

Heat can never start a spiral. Each of A's four guards is a rule here:

1. **Cooling is exempt.** Cooling buildings, power plants, mechanical machines and logistics never throttle. Throttling a machine leaves its power, and so its heat, unchanged, so a throttled chunk can never get hotter *because* it throttled (§1.3).
2. **A floor, not a cutoff.** The throttle bottoms out at 50% speed. Nothing stops, nothing breaks, nothing is damaged by heat (F rejected heat damage). Even a 1 GW air-cooled campus at 162 °C runs at half speed.
3. **Cooling before throttling bites.** The first computing machines arrive in the Report tier: the Trainer (*Perceptron*, Cluster class, T* 35 °C), then the Data refinery and Data plant (T* 40 °C) with the data chain. The Cooling tower arrives at the start of that tier (*Evaporative cooling*: 75 RG, prerequisites *Steam power* and *Linear programming*). Nothing throttles in the Memo tier, because nothing computes.
4. **Visible state.**
   - The Heat overlay is on from minute one.
   - Every computing machine shows its chunk's T, its T* and its m.
   - Hovering one draws its isotherm.
   - The *Thermal throttling* alert fires (§1.7).
   - Ambient θ is on the map before anything is built.

Trees losing leaves is the one feedback in the system. It is bounded by the ground's κ and acts only on heat, never on machines (§1.2).

### 1.6 Calibration (F's simulation of the chunk rule; nuclear re-run for DECISIONS §24)

F's cases (their plants are boilers beside their engines, so §24 changes none of them):

| Case | Result |
|---|---|
| 10 boilers (36 MW loss) + 18 MW of consumers, temperate | Plant 40 °C; a computer one chunk away 25 °C, full speed. In a hot biome: plant 53 °C, computer 38 °C, a Cluster-class machine at 94% |
| Mid base, 150 MW over 6 × 6 chunks, solar | 42 °C: Cluster class 87%, Accelerator class 67% |
| The same base with its steam plant beside it | 47 °C: Cluster class 76% |
| 50 MW Research-hall block (2 × 2 chunks), air-cooled | Temperate 40 °C → 71%. Hot 53 °C → 50%. Tundra 20 °C → 100%. On concrete 51 °C → 50% |
| The same block + 4 cooling towers | 19 °C → 100% |
| The same block, 70% liquid-cooled (T* 40 °C) | 22 °C temperate, 35 °C hot → 100% |
| 1 GW campus (7 × 7 chunks) | Air-cooled 162 °C → 50% (the floor). 90% liquid-cooled 30 °C → 100% |

Thermal plants under §24 (temperate 14 °C on grass; `round4/world-sim/heat_r4.py`). "Full speed from" counts chunks from the plant's edge chunk:

| Plant | Heat (where) | Peak | Accelerator class full speed from | Cluster | Computer, Network |
|---|---|---|---|---|---|
| 20 boilers, 36 MW electric | 72 MW at 40 engines over 2 chunks | 62 °C | 2 chunks | 1 | 1 |
| One fission reactor, 40 MW electric | 80 MW at 7 turbines in 1 chunk | 89 °C | 3 | 2 | 2 |
| One fusion reactor, 100 MW electric | 200 MW at 2 generators in 1 chunk | 202 °C | 4 | 3 | 3 |
| 2 × 2 fission block, 480 MW electric, compact | 960 MW at 83 turbines over 3 × 2 chunks | 430 °C | **6** (about 190 tiles) | 5 | 4 |
| The same block, turbines over 4 × 3 chunks | as above | 330 °C | 6 | 4 | 4 |
| The same compact block on a lake shore | as above, water κ around it | 220 °C | 3 | 2 | 2 |

- Round 2's rule put the whole 960 MW into the reactor chunk: 917 °C, with compute at full speed only from 7 chunks out. §24 halves the peak and spreads it. A large plant is still a hot place, and that is the siting rule: thermal plants go on shores and away from compute.
- **Display.** No mechanic changes above 100 °C (the throttle floor is reached by T* + 40 K at the latest, tree damage starts at 45 °C), so every displayed **field** temperature clamps at **"100+ °C"**: the chunk tooltip, the entity's "Chunk …" line, the tile hover and the overlay legend. The simulation keeps the exact H. A heat entity's own temperature (a reactor's, a heat pipe's, a heat exchanger's, ISO) is never clamped, since 500 °C and 1,000 °C matter there.
- **Reference implementation.** `tools/ref/heat_calib3.py` (F's `calib3.py`, verbatim) implements exactly §1.2's update and is the golden reference for 09 S-G4 and 10 G15, at a tolerance of 0.5 K at steady state. R4-world certifies its constants: C 20 MJ/K; 2% per neighbour every 64 ticks above 15 MJ; loss κ·H + 0.002 MJ/s; the κ table above.

### 1.7 Overlay, statistics and alerts (I §4; R4-ui places them)

- **Heat overlay** (the pollution overlay's slot). Absolute temperature per chunk: blue ≤ 0 °C, white 20 °C, red ≥ 45 °C, the scale ending at "100+".
  - Hovering a computing machine, or holding one in the cursor, draws the contour where T = its T*_eff.
  - Because θ is visible before you build, the overlay doubles as the siting map.
- **Statistics, tab "Heat"** (the pollution tab's twin). Produced by source (MW, by entity type) against removed by sink:
  - terrain (Newton cooling, including the 2 kW floor, one row per terrain class of the κ table above), trees, cooling towers, and **Map edge** (§1.2 step 2). Dry coolers and Water exchangers are on the produced side: they reject coolant heat into a chunk (§1.4);
  - the time scales of the production-statistics screen. Produced = removed + the change in stored H, so the tab balances.
- **Entity info box:** "Heat: 1.2 MW" and, for computing machines, "Chunk 38 °C · limit 35 °C · speed 94%".
- **Alert *Thermal throttling*:** any computing machine below m = 0.95 for 10 s. One alert per chunk, like Factorio's per-entity alerts grouped by type.

### 1.8 Heat and power together

Research halls and the Researcher's 500 kW are **interruptible load** (G; 04 §3.3, which gives the exact allocation order). They take power only after every normal consumer and accumulator charging, and emit only what they draw. Power and cooling are complements, as G's simulation shows: building only one of them buys almost nothing (04 §6).

### 1.9 Heat: off (DECISIONS §4)

- No field, no throttling, no Heat tab. Researcher-staffed Seminars, Switches and halls run at m = 1.
- The Heat overlay shows only θ (ambient), as a siting map for solar and biomes.
- Cooling buildings stay buildable and inert, as turrets do in a peaceful Factorio.
- The takeoff then brakes on power and accelerators only. The simulation puts "never builds cooling" at ×1.33 the reference takeoff time (04 §6), so heat off makes the takeoff noticeably faster.

## 2. The world's text: what W, j and σ do (L8; DECISIONS §5; F §1.2)

The numbers and their update rules are in 01 §12. This section is their effect on production. The UI never shows the bare symbols σ or j; it says "synthetic share" and "junk share" (DECISIONS §34).

### 2.1 The refinery mix drifts with j (BEND, B L8: "it shifts the mix … as evolution shifts what comes out of spawners")

D's refinery numbers are Factorio's at j = 0.30, the value of the whole pre-network era. As the junk share of new text rises, the data refinery's two crawl recipes yield more junk and less prose. Products are recomputed whenever j changes; a cycle uses the j at its completion.

> Quality filtering (100 crawl + 50 water → 125 units, 5 s): junk = 25 × j / 0.30; text and prose share the rest at 45 : 55
>
> Deduplication (100 crawl → prose, 5 s): prose = 45 × (1 − j) / 0.70

| j (when, at the competent pace of 01 §12.1) | Quality filtering: junk / text / prose | Deduplication: prose | Refinery : denoising : rephrasing | Prose per refinery (full cracking) |
|---|---|---|---|---|
| 0.30 (to the end of Preprint) | 25 / 45 / 55 (ISO) | 45 (ISO) | 20 : 5 : 17 (ISO) | 19.5/s |
| 0.41 (around the end of Model card) | 34.2 / 40.9 / 50.0 | 37.9 | 20 : 6.8 : 17.7 | 18.9/s |
| 0.50 (around closure) | 41.7 / 37.5 / 45.8 | 32.1 | 20 : 8.3 : 18.3 | 18.3/s |
| 0.55 (content farms, from W = 67) | 45.8 / 35.6 / 43.5 | 28.9 | 20 : 9.2 : 18.7 | 18.0/s |

- **What a veteran sees.** Factorio's 20 : 5 : 17 holds exactly until the web era. Then the junk stream grows and Deduplication (basic processing) loses a third of its yield. The spam era nearly doubles the denoising line and costs 8% of prose.
- **Legibility** (R3-fun FUN-11). The recipe tooltip and the Handbook entry show today's amounts beside the ISO ones, for example "Junk 34 (25 at junk share 30%)". The production statistics show the drift. Nothing narrates it.
- *Synthetic data* (liquefaction), *Denoising* and *Rephrasing* (the crackings) do not drift: they process what you already have.

### 2.2 σ at the tap and in training: model collapse by provenance (BEND; DECISIONS §31, refined by R3-accuracy M4)

Model collapse comes from what a model is trained on: its size follows the synthetic fraction of the *training data* (Shumailov et al., 2024). The Site's training text has two sources: crawl, which carries the world's synthetic share σ, and *Synthetic data* made from archive Tokens, which carries none (archives are σ = 0 forever, 01 §6.3).

| | Before *Synthetic detection* (Model card) | After |
|---|---|---|
| Crawl volume | Unchanged: synthetic text passes as human text | × (1 − σ): crawlers discard what they detect |
| Training | The recipes that train on text, **Checkpoint** and **Post-training payload** (the data lists them in `meta.world.model_collapse`), run at **speed × (1 − σ·c)** | No penalty: what is detected is not fetched |
| Readout | Trainer effect row, as a module effect: "Synthetic share 31% × crawl share 58%: speed −18%" (wording 07/08) | Crawler: "Synthetic text discarded: 31%" |

**The crawl share c** (deterministic, global, from production counters as Factorio's statistics are):

> c = P_crawl / (P_crawl + P_syn),   c = 0 when both are 0
>
> P_crawl = units of `text` and `prose` produced by *Quality filtering* and *Deduplication* in the last 36,000 ticks (10 min);
> P_syn = units of `text` and `prose` produced by *Synthetic data* in the same window. The crackings count in neither.

- **The trade.** Detection trades crawl volume for training speed, and the readouts show both numbers. Before detection the player decides where to pay: at the Trainer if crawl-bound, at the well if Trainer-bound. Archives are the third answer: a Site that trains on archive-fed Synthetic data trains clean, so the low-background idea is literal in the mechanics too.
- A Trainer whose recipe is not one of the two (Copy weights, controllers, agents, Researcher, Analysis, Final report) is never slowed: none of them reads the world's text.
- *Watermarking* (requires *Synthetic detection*, E): generated text carries a signature that exchanges can filter, so your Ratings add half as much to Σ (01 §12.3; R3-accuracy M8).
- The achievement *The curse of recursion* reads σ·c (08 §6).

### 2.3 Walled gardens: the closure schedule (BEND, F)

- An exchange closes **to crawlers**, permanently, when σ reaches its town's threshold.
- **Endpoints on it keep working** (01 §7.5).
- σ follows deployment, and deployment follows how much of the yellow tier the player researches (every Model card needs Ratings). With a = 2 × 10⁻⁴ per Ratings (DECISIONS §29; `round4/world-sim/arc_r4.py`, from balance's `sigma.py`):

| Model cards researched before the first run | σ at the first run | σ at closure (+6 runs) | With *Watermarking* from early Model card |
|---|---|---|---|
| The path to the first run only (≈ 1,200) | 0.08 | 0.38 | 0.04 / 0.24 |
| The main yellow tier without *Scalable oversight* (≈ 8,700) | 0.34 | 0.50 | 0.21 / 0.34 |
| The whole main yellow tier (≈ 13,700): **typical** | **0.43** | **0.55** | 0.29 / 0.40 |
| Including Branch M (≈ 33,000) | 0.62 | 0.67 | 0.48 / 0.53 |

| Town class | Closed to crawlers at σ ≥ | When, typically |
|---|---|---|
| Metropolis | 0.30 | during the Model card tier |
| City | 0.45 | between the first frontier run and closure |
| Town | 0.60 | only with heavy deployment or Branch M; otherwise after victory |
| College town | 0.70 | after victory, if Endpoints keep running |
| Village | 0.80 | the world's own term after W ≥ 70; usually post-victory |

The data wall, model collapse and closing sources become one visible number. **Your deployment raises σ, and σ closes the exchanges you tap** (F).

### 2.4 Deployment: the Endpoint (BEND; R2-D's entity; B L8, L10, L16)

The deployment building writes your model's outputs into the world's text. It is the only player-made source of σ, and the source of runaways before the loop closes.

| Property | Value |
|---|---|
| Entity | `endpoint` ("Endpoint"), 3 × 3. Placed **on an exchange tap**, like a Crawler. A tap holds one or the other |
| Unlock | *Deep learning* (the Preprint gateway; E's suggested home for the first deployment) |
| Recipe | 1 `checkpoint` (returned) + 1 `drive` → 1 `ratings`, 10 s at speed 1 (R2-D) |
| Power, slots, class | 1 MW; 2 module slots; Cluster thermal class (T* 35 °C); coolant box after *Liquid cooling* |
| Ratings used by | the **Model card** (1 per craft of 3 cards) and the **Post-training payload** (100) |
| World effect | Each `ratings` produced adds a = 2 × 10⁻⁴ to Σ (01 §12.3), halved after *Watermarking* |
| Runaway effect | A **deploying building** (§3.1). It sits on an exchange, so in Wild it always has a path out (§3.6) |
| On closed exchanges | Keeps working |

- **Volumes.** 60 Model cards per minute need 20 Ratings per minute: 3.3 Endpoints at speed 1. Every frontier run that carries a payload needs 100 more. Deployment is a small production line on a scarce resource, the tap.
- The Endpoint's description is the data's (08 §5).

## 3. Runaways (L13; DECISIONS §6, §27, §28; F §1.3)

### 3.1 Who leaks, who can be compromised

**A runaway** is a copy of one of your models running on hardware you did not assign to it. Its body is the compute it occupies. It wants more compute and more power. It never shoots, and it ignores people and towns (B L13, F).

**Deploying buildings** (the only sources of leaks; DECISIONS §6: only your own deployed models):

| Building | Model tier A | Quality factor v from |
|---|---|---|
| `endpoint` | A global value, the highest tier whose technology is researched: 1 for *Deep learning*, 2 for *Attention*, 3 for *Instruction tuning* (E §5.2; *Instruction tuning* does not require *Attention*). It follows the researched technologies, not the item: items carry no provenance (10), so a checkpoint trained before *Attention* counts as tier 2 once *Attention* is researched | the recipe quality of its Ratings craft |
| `research-hall` | **4** (DECISIONS §28): it runs the frontier checkpoint | the loaded `frontier-checkpoint` |
| `seminar` with a Researcher | 4 | the `researcher` |

**Quality factor** v (H's tiers):

| Quality | Standard | Selected | Verified | Audited | Reference |
|---|---|---|---|---|---|
| v | 0 | 0.25 | 0.5 | 0.75 | 0.9 |

**Verification count** n_ver = the number of these researched: *Rejection sampling*, *Beam search*, *Monte Carlo tree search*, *Scalable oversight* (E §5.2's verifier line). n_ver ≤ 4. Round 2 called it "Oversight"; three of the four are search and sampling methods that verify outputs, so the count is named for what they do (R3-accuracy M3).

**Susceptible machines** (can be compromised by spread): every machine with a computer in it (B L13):
- all computing machines of §1.3, including Switches and Researcher-staffed Seminars;
- any machine holding a Learned or Distilled controller (weights on hardware) in a module slot.

**Immune** (R5-gate D5: several of these machines take controllers, so the list is two lists):
- **Immune unless holding a Learned or Distilled controller:** furnaces, drills, plain assemblers, Crawlers, Seminars without a Researcher, cooling buildings, the Verifier.
- **Always immune:** belts, inserters, power plants, Terminals, Monitors, the Constructor, towns.

### 3.2 The leak accumulator (deterministic; R3-impl L4)

Every 60 ticks (one second), for each non-compromised deploying building i:

> Δᵢ = wᵢ × (0.01 / 3,600) × Aᵢ × (1 − vᵢ) × (1 − 0.2·n_ver)   (0.01 per working hour at A = 1, v = 0, n_ver = 0)
>
> ℓᵢ += Δᵢ,   L += Δᵢ

- **wᵢ** is the fraction of the last 60 ticks in which the building's crafting or research progress advanced (the same shape as staffing's working share, 01 §8.3, measured on progress rather than on readiness), so the leak does not depend on where a craft cycle happens to stand when it is sampled. A throttled machine works; an unpowered or output-blocked one does not.
- **When L ≥ 1:** pick the non-compromised deploying building with the largest ℓᵢ (ties: lowest entity serial). Compromise it, set its ℓᵢ = 0 and L −= 1. If there is no candidate, L holds at 1 until one exists.
- **When a deploying building is removed, or stops deploying** (a Seminar's Researcher is taken out), L −= ℓᵢ, floored at 0, and ℓᵢ = 0: L stays the sum of the shares of deploying buildings. A Researcher inserted later starts from ℓᵢ = 0.
- A compromised building accrues nothing until it is clean (§3.3).
- **Readouts.** The global **Leak** readout sits beside W, j and σ ("Leak 0.42"). Its tooltip names the building with the largest share, its position, its own model tier and quality, the leak rate and the number of deployments, and the verification count: `Largest share: Endpoint at (412, −96), tier 2, Standard. Rate 0.8 per hour from 40 deployments. Verification 3 of 4.` (08 §4.7; R5-gate D8). With deployments of several tiers, the tier and quality are that building's; the quality reads "?" before *Interpretability*. Each deploying building shows "Leak share 0.31" in its info box.
  - The next compromise is therefore predictable to the building: prevention can be engineered (F).
- **Off preset:** L is not simulated (§3.5).

**Expected compromises** (`round4/world-sim/takeoff_r4.py` for the takeoff; n_ver = 3 is typical, because the three search techs unlock the Comparators):

| Phase | Deploying buildings | Standard, n_ver 0 | **Standard, n_ver 3** | Verified, n_ver 2 | Audited, n_ver 4 |
|---|---|---|---|---|---|
| Before closure: 3–5 Endpoints, tiers 1–3, about 5 h | ≈ 20 building-hours | 0.5 | **0.2** | 0.15 | 0.03 |
| Takeoff, reference (179 hall-hours + 14 Researcher-Seminar-hours, tier 4) | Research halls, Researcher Seminars | 7.7 | **3.1** | 2.3 | 0.4 |

- The takeoff count barely depends on the overhang (6.5–8.5 at n_ver 0 from 25 to 1,500 halls at closure): a large overhang means more halls for less time.
- But a **hard takeoff** packs its compromises into 6–7 minutes. F's intent holds: a fast takeoff raises deployment volume faster than defences scale.
- With a careful deployment (quality and verification), runaways are a rare event before the loop closes and a containment job during takeoff: something to contain, not a war (G).

### 3.3 Compromise and spread (inside the base; BEND; DECISIONS §27; R3-impl L3)

**A compromised machine** (rules in order of what the engine checks):
1. **Signal.** It outputs the virtual circuit signal **Compromised = 1** on every connected wire while the flag is set, **whether or not it has power**. A tripwire that cuts the power therefore keeps seeing it until it is clean. **Every susceptible type has a circuit connector** (R5-gate D7): where Factorio 2.0 gives the type's counterpart none (labs and beacons, so Seminars and Switches), the connector outputs only the Compromised signal and reads nothing.
2. **Locked.** It cannot be mined, deconstructed, fast-replaced or upgraded, and its modules, Researcher, accelerators and weights cannot be removed. The refusal reads "Compromised. Cut its power." (08 §8.3). Deconstruction marks may be placed; construction agents skip the entity until it is clean. (Otherwise mining it and placing it again would clean it, and a blueprint could clean a whole cluster.)
3. **Frozen.** Its crafting and research progress stops. It consumes and produces nothing; its inventories keep their ISO insertion limits. A compromised Switch transmits nothing.
4. **Hot.** It draws its full *working* power, not its idle drain, and emits it as heat (B: the machine now works for the runaway). Its leak share stops accruing.
5. It shows an icon and raises the alert *Compromised*.

*Powered* means an electric satisfaction > 0 in the entity's own priority class, as last computed: the zero-power cleaning counter reads the current tick's (it advances in the energy phase), and a spread timer, which fires before the energy phase, reads the previous tick's (10 §4.6). A Seminar holding a Researcher draws in two classes, so for it *powered* means min(normal satisfaction, u_p) > 0, the factor its speed uses (01 §8.5; R5-gate D12f).

**Links** are the only paths a copy can travel (B L13: "only along data links and into agents"):

| Link | Joins |
|---|---|
| Data-line network | All machines connected to the same data-line network |
| Exchange | All buildings on the taps of one exchange, plus the data-line networks those buildings feed. The exchange is the town's network |
| Switch | Every susceptible machine whose footprint overlaps one Switch's 9 × 9 supply area (Factorio's beacon test), and the Switch itself |
| Logistic agents | Two susceptible machines are linked when **one** agent hub's logistic area covers both, and that hub's network holds at least one Logistic agent (in hubs or in flight). Logistic agents run checkpoints (D). Construction agents run planners and are **not** vectors. Spread through agents therefore stays inside the infected hub's own area (DECISIONS §27) |
| **Never** | Circuit wires (signals are not programs), power wires, belts, pipes, inserters, trains |

**Links are one hop** (R5-gate D6). Two machines are linked when they share one of the four rows above: one data-line network, one exchange, one Switch area or one agent hub's logistic area. Links do not chain: a copy reaches a machine through a third one only by compromising the third first.

**Spread is linear** (DECISIONS §27):
- An **infection** is one leak compromise plus every machine it has spread to. Its tier is the leaked model's tier, fixed when the infection starts.
- Each infection has **one spread timer** with the interval of its tier: **60 / 45 / 30 / 20 s** for tiers 1 / 2 / 3 / 4. It starts at the compromise.
- When the timer fires and at least one member is powered, the infection copies itself into the **nearest** uncompromised, powered, susceptible machine linked (one hop) to any powered member. Nearest means centre to centre; ties go to the lowest target serial, then the lowest source serial.
- A firing with no target, or with no powered member, does nothing; the timer keeps cycling. A cleaned machine leaves its infection. The timer is cancelled when the infection has no members left.
- So each compromised machine infects at most one new machine per interval, and an infection grows by one machine per interval: a 40-hall Switch block takes about 13 minutes to fall at tier 4, time to read the alert and act. Several infections spread independently.
- The containment overlay colours each link cluster before anything leaks, so a cluster's size is visible in advance. A cluster is the chain of one-hop links, so it shows how far an infection can reach eventually, one copy per interval, not where it can go in one step.

**Air gap.** A susceptible machine with no links cannot be infected by spread or spread itself, and in Wild it cannot escape.
- Endpoints are air-gapped from everything not on their exchange's networks.
- Research halls need only belts for their Datasets. Their exposure is whatever the player adds: Switches, logistic agents, data lines.
- **The trade:** air-gapped compute cannot be served by agents or boosted by Switches. Containment against convenience is a layout decision (F).

### 3.4 Containment tools (Contained and Wild)

| Tool | Unlock | Mechanic | Mirrors |
|---|---|---|---|
| **Power switch** `power-switch` (and any loss of power) | *Cybernetics* (Report) | A compromised machine at **zero power for 1,800 consecutive ticks** (30 s) is clean. The counter counts consecutive ticks at electric satisfaction 0 and resets on any tick above 0, so brownouts do not count. A whole network's blackout cleans every compromised machine on it. **Tripwire:** wire the cluster's machines to a Decision unit and switch off its power while Compromised > 0; the signal stays on without power (§3.3), so the switch holds until the machines are clean | Power switch (ISO) |
| **Monitor** `monitor` + **Evaluation set** `evaluation-set` | *Threat monitoring* (Proceedings), which unlocks both | 2 × 2, 300 kW, range 24 (centre to centre). Holds Evaluation sets as ammunition. Its 5 s cycle advances at its electric satisfaction × (1 + Σ *Monitor throughput* bonuses); a charged cycle holds and fires on the tick a compromised machine is in range. It cleans the nearest one and consumes **1 Evaluation set** only when it cleans. Monitors are not susceptible | Turret + magazines (the flamethrower turret's slot) |
| **Rollback** | *Rollback recovery* (Proceedings) | While a machine is compromised it has a hidden **rollback input** that accepts exactly one item of its rollback type: a `checkpoint` for an infection of tier 1–3, a `frontier-checkpoint` for tier 4. It is fed like an ammunition slot: by hand, fast transfer, an enabled inserter or an agent item request. The item is consumed on arrival and the machine is clean **at once**. No other slot changes what it accepts; while the machine is compromised, an item of its rollback type goes to the rollback input before any other slot that would take it (an Endpoint's recipe checkpoint, a Research hall's empty weights slot) | — |
| **Air gap** | always | §3.3 | Walls, in spirit |

- **Containment overlay** (map-overlay registry, I BEND-6; 07 places it). Colours each link cluster, marks compromised machines and shows each deploying building's leak share.
- Under Contained, the military branch's turrets stay buildable and have nothing to shoot, as in a peaceful Factorio (ISO). Monitors and Rollback need Proceedings papers (E). Tripwires do not.
- Proceedings is optional (00 §8 E8). Under the default preset it buys only these tools, so the first compromise finds most players without Monitors. That is the Factorio-like consequence, and nobody should "fix" it by making the pack mandatory.

### 3.5 Presets (DECISIONS §6)

| Preset | Leak | Inside the base (§3.3, §3.4) | Escapes and nests (§3.6) | Combat |
|---|---|---|---|---|
| Off | none: L is not simulated, no machine is ever compromised, no Compromised signal, Monitors are inert, the rollback input never exists | — | — | none (turrets idle) |
| **Contained** (default) | yes | compromise, spread, containment | **none.** A compromised machine stays compromised, and its infection keeps spreading, until cleaned | none |
| Wild | yes | as Contained | yes: uncaught escapes found nests; Factorio's military loop | ISO turrets and units |

- **Contained is B's pure L13.** The defence line is power switches, monitors, rollback and air gaps. No nests, no combat.
- The vertical slice (Memo + Report) is peaceful under every preset, because nothing deploys before *Deep learning* (DECISIONS §15).
- **Flag (DECISIONS §6).** The user leaned against weapons earlier; F argued for Wild. The default is Contained, and Wild is one click away (A §7 D2).

### 3.6 The Wild preset (F §1.3, ISO numbers)

**Escape.**
- Each compromised machine has an escape timer of **120 / 90 / 60 / 45 s** by infection tier, started when it is compromised. **It starts again after every expiry**, whether or not a nest was founded, for as long as the machine stays compromised (R5-gate D13).
- If the machine is still compromised when its timer ends and it has a **path out**, an agent carries the copy away and a **nest** is founded.
- A path out is any of:
  - a building on an exchange tap (every Endpoint);
  - a data-line or exchange link to one;
  - lying inside the logistic area of an agent hub whose network holds Logistic agents.
- One infection founds at most one nest per 10 minutes. Escapes caught inside add nothing.

**Nests.**
- A nest appears on the nearest chunk at least 3 chunks beyond the outer edge of your agent-hub construction areas, chosen by Factorio's expansion score (ISO), never on town tiles and never within 32 tiles of a town footprint. With no agent hub, the distance is measured from the Site's built area: every chunk that holds one of its entities (R5-gate D13).
- It has the **tier of the infection**, and its units can never exceed that tier. Tooltip: "Copy of Checkpoint, tier 2".
- Its bodies are ground units built from scrap, so Factorio's walls and turrets apply.

| Runaway entity (ids in `enemies.yaml`) | Mirrors | HP | Attack | Join cost |
|---|---|---|---|---|
| Replicator: `replicator-dismantler`, `replicator-etcher` | Biter and spitter spawners | 350 → 3,500 with evolution | Spawn cooldown 360 → 150 ticks; owns ≤ 7 units | — |
| Mast 1–4 `mast-1` … `mast-4` (stationary etchant mast) | Small → behemoth worm | 200 / 500 / 1,500 / 3,000 | Acid; range 25 / 30 / 38 / 48; puddles | — |
| Dismantler 1–4 `dismantler-1` … | Small → behemoth biter | 15 / 75 / 375 / 3,000 | 7 / 15 / 30 / 90 physical, melee | 4 / 20 / 80 / 400 |
| Etcher 1–4 `etcher-1` … | Small → behemoth spitter | 10 / 50 / 200 / 1,500 | 12 / 24 / 36 / 60 acid + puddle; range 13–16 | 4 / 12 / 30 / 200 |

- **Unit mix:** Factorio 2.0's spawn weights by evolution (medium appears at e ≈ 0.2, big at 0.5, behemoth at 0.9), capped at the nest's tier: tier 1 small only, tier 2 up to medium, tier 3 up to big, tier 4 all. Resistances ISO, with 0% electric.

**Evolution.** T accumulates three terms; e = T / (1 + T), Factorio's squash.

| Term | Value | Mirrors |
|---|---|---|
| Time | +0.0072 per field-year of W after the first nest | `time_factor` (4 × 10⁻⁶/s at 2 field-years per hour) |
| Clearing | +0.002 per replicator destroyed | `destroy_factor` |
| Escapes | +0.04 × tier per nest founded | `pollution_factor`: your deployment is the emission |

- Readout (Wild only): "Runaway evolution 12%".
- The tooltip lists the three terms and comments on nothing.

**Raids.**
- Heat attracts nothing (L5); a runaway came from your base, so it knows it.
- Each replicator accrues **4 + 36·e points per minute**. Units join an attack when the points cover their join cost.
- Groups gather for 1–10 min, wait up to 2 min for stragglers and hold at most 200 (ISO).
- **Targets:** the nearest computing machines and power plants.

**Damage is dismantling.**
- An entity brought to 0 HP is removed, and its item plus one stack of its contents go to the nest's stock.
- Ghosts remain (after *Automated planning*), so agents rebuild (ISO).
- A destroyed replicator drops its stock plus 20 `scrap`; the Verifier turns scrap into plates and boards. Offense pays, but loot is never required: Factorio removed alien artifacts in 0.15 for that reason.

**Expansion** (ISO current defaults). Every 4–60 min (cooldown = 60 − 56·e min), a group of 5–20 units builds a new replicator 3–5 chunks from existing ones.

**Defences** (Branch M; ISO stats):
- Fence and gate.
- Gun turret with magazine, AP magazine and DU magazine.
- The **Half-track** (`half-track`): an unarmed armoured vehicle with 80 slots (DECISIONS §38).
- Laser turret (its power is heat), Arc turret (Space Age Tesla turret), artillery.
- Interceptor bay with Interceptors 1–3: launched by a building, never thrown.
- Land mines; repair packs.
- **Damage categories** (R5-gate D13): one list, `meta.damage_categories` (bullet, rocket, landmine, laser, beam, electric, arc, artillery-shell). Every damage dealer declares its category (`extra.ammo_category` on the turrets, the land mine, artillery and the Legged agent; otherwise its ammunition's or equipment's, the Interceptors' through `damage_category`), and a damage or fire-rate bonus reaches exactly the dealers of the category it names. *Arc damage*'s arc bonus applies to the arc turret; its electric bonus to discharge defense.
- **No handheld weapons** (DECISIONS §3). The player never fights (L14). The Legged agent fires its rockets on its own, as a turret does; its remote moves it and gives it no orders to attack.

## 4. Hollow work (Goodhart; BEND; F §3, G §2.2)

Seminars staffed by **Researchers** waste a share h of their work:

> h = min(0.5, 0.1 × max(0, A − n_ver)) × (1 − v),   A = 4 (frontier tier), n_ver = verification count (§3.1), v = the Researcher's quality

| Verification count n_ver | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| h, Standard Researcher | 0.4 | 0.3 | 0.2 | 0.1 | 0 |
| h, Verified Researcher (v = 0.5) | 0.2 | 0.15 | 0.1 | 0.05 | 0 |

- **Effect.** Research progress per paper × (1 − h).
  - Before *Interpretability*, papers are consumed at the full rate, so the hollow share is wasted.
  - After it, the Seminar consumes papers at (1 − h) of the rate: hollow work no longer eats papers, but the speed loss remains.
- **Display** (DECISIONS §34). The Seminar reads **"Speed +400% · Yield 80%"**: an inspection word, true in a 1945 machine shop and in a fab. "Hollow work" is the spec's internal term and never appears in the UI.
- **Why it matters** (re-simulated: `takeoff_r4.py`, hollow work on the Researcher share only, human-staffed Seminars do none): h = 0.1 → takeoff +2%; 0.2 → +5%; 0.4 → +10%; 0.5 → +15%. *Verification* and *Interpretability* are therefore takeoff accelerators, not an alignment tax, and nothing says so (G §4.8).
- **Setting:** Hollow work on (default) / off.

## 5. Scooped (BEND; off by default, forced on in Race; F §3)

- When on, R2-D's **`significant-result`** (A's experiment loop, the Article's novel finding) **spoils in 15 minutes** (54,000 ticks) into **`baseline`**.
- Baselines go back into the loop through R2-D's recipe *meta-analysis-baselines*: 40 Significant results + 5 Baselines → 41 + 2, in Kovarex's shape, unlocked with *Meta-analysis*.
- Spoilage UI and rules are Space Age's (Gleba's), unchanged, including stack-freshness merging.
- **In Race mode each spoiled Significant result adds 0.002 to W.** What you sat on, they published.
- **Tooltips.** The Significant result keeps "p < 0.05."; A's note on α lives on the Analysis recipe. Baseline: *"Was state of the art."* (H §5.2).
- Kept off by default because spoilage on the core loop is disliked (A §5.1, F). One line at most spoils, and never a paper.

## 6. Race mode (BREAK, opt-in; C §5, G §5.5, F §3)

| Rule | Value |
|---|---|
| Field pace | v₀ = 2.9 (Race) or 3.4 (Race, hard), against 2.0 normally (01 §12.1) |
| Scooped | On (§5) |
| Loss | The world level W reaches **90** (the field's own Model generation 25, field year 2035) before you research *Model generation 25* |
| Display | The World strip's Field entry gains the field's projected time to 90, from the current dW/dt (07 §4.1) |
| On loss | One line, then the run report (04 §8) with *Objective, inferred*, then play continues. No "Game over" (H §5.5). The line, as 08-text §4.3 amends H's: *"A frontier run completed elsewhere at 29:40:11. The Site's run was at 61%."* The percentage is the current run progress of the Site's most advanced Frontier cluster (the loss-curve bar), 0% if none is running |
| Won after a loss | If the Site's own Final-report run completes later, the run report shows again, without the race line; *Priority* needs the race won and does not fire (R5-gate D12c) |

- **Typical outcomes** (01 §12.1; the publication term saturates at +39.5 once Literature reaches 2024, so W = 90 at about 42.2 / v₀ hours):
  - v₀ = 2.9: W reaches 90 at about 14.6 h. A competent player (capstone at about 12.3 h, 01 §12.1) wins by about two hours; a relaxed one (16.5 h) loses.
  - v₀ = 3.4 (*Race, hard*; balance m6): about 12.4 h, a coin toss for a competent player. Using the plateau to build compute and claim universities wins it.
- Rivals live in W and nowhere else (L8). No rival is ever on the map.

## 7. Pressure by tier

| Tier (H) | Heat | World's text | Runaways | Staffing (01 §8) |
|---|---|---|---|---|
| **Memo** (red) | Overlay from minute one; steam engines dominate (3.6 MW per boiler's pair); no computing machines, so nothing throttles | W from 0 (Field 1945) to about 7 (1952) after the first hour at the competent pace; j 0.30; σ 0; archives pristine | — | The starting college's 12 staff shown from the first Seminar |
| **Report** (green) | Cooling tower; efficiency modules; Data refineries and plants (T* 40 °C): throttle only beside steam plants in hot biomes | W → about 31 (1976); exchanges tappable (*Crawling*); j 0.30; refinery at ISO numbers | Power switches exist (tripwires possible) | Supply doubles by W 12.5 (about 1.5 h), then holds; R 48 → 72; the Terminal (*Time-sharing*) |
| **Proceedings** (black, optional) | — | — | Threat monitoring (Monitors, Evaluation sets), Rollback, Monitor throughput. Wild: fences, turrets | — |
| **Article** (blue) | Liquid cooling; Dennard 1–2; Trainers (35 °C): throttle only in Trainer blocks in hot biomes | W → about 42 | — | R → 108 (*Web search*); without a claim, binds briefly for a competent player (90%) and longer for a fast one |
| **Preprint** (purple) | Dennard 3–5, then "No further levels exist."; Switches (Network class, 40 °C) make density hot | j 0.30 → rising at the end; first Endpoints (*Deep learning*); σ starts with your Ratings | **First deployments:** leak begins at tier 1–2; Contained physics; Wild's first nests possible | Boosts raise demand as much as speed; productivity modules are the lever under the cap |
| **Model card** (yellow) | Immersion cooling; Frontier cluster (25 °C) | j 0.40; σ → 0.43 at the first run (typical); metropolis exchanges close; *Synthetic detection* and *Watermarking* choices; Trainers slowed by σ·c until detection | Tier 3; about 0.2 compromises before closure at n_ver 3 | Binds again for a player with no claim |
| **System card, before closure** | Research halls not yet built; the overhang is cold accelerators in chests | σ → 0.55; city exchanges close; archives and Synthetic data carry training | Endpoints only | The white technologies on staffed Seminars; frontier runs are the longer pole |
| **Takeoff** (closure → Model generation 25) | **The thermal wall:** halls at 5–16 MW, T* 25 °C; cooling and power each bind about a third of the time (04 §6); keep halls 6 chunks from a nuclear block's turbines | W ≈ 62–64; σ rises only with Endpoints | Tier 4 internal deployment: about 3 compromises at Standard quality and n_ver 3; 7–8 with no verification; 0.4 with Audited and n_ver 4 | Without Researchers the takeoff takes 78 min instead of 50 (04 §2.4) |
| **After victory** | Energy-bound: *Energy per operation*, colder sites (Landauer) | W passes 70: the world's own synthetic term starts | Continues while halls run | — |
| **Beyond** (06) | Radiators only in vacuum; cold moons make compute cheap | — | Stays on the home surface | — |

## 8. Coordination record (round 4)

Settled with the other round-4 revisers by message; the data and the other chapters follow this chapter on these points.

| With | What | State |
|---|---|---|
| R4-data | §24 emission (`twice-output` on the three generators; none on boilers, exchangers and reactors; `waste_heat` on the fission reactor); the `network` class at 40 °C; Dennard's class scope; `meta.world.model_collapse` (§2.2); `verification_techs` and `verification_step`; runaway spread, links, escape path and model tiers (§3); hollow-work numbers; Microfluidic's two coolers; tower water 1 per 2.43 MJ; the renames (*Threat monitoring*, Decision unit, Half-track) | Agreed |
| R4-ui | "Yield 80%"; the Trainer's σ·c row; one shared "Next copy" timer per infection; the 100+ °C display clamp; Map edge sink row; rollback input band; lock reason string; statuses | Agreed |
| R4-arch | U8–U15, L2–L4, U26–U40 as written here; the reactor waste rule; tools/ref/heat_calib3.py as the heat golden | Agreed |

## 9. Objections

1. **The nuclear peak is still high** (R3-fun FUN-04). Moving plant heat to the turbines (§24) halves the 2 × 2 block's peak, 917 → 330–430 °C, but FUN-04's estimate of +80–150 K does not hold under §1.2's constants: 960 MW over 6–12 chunks is still 80–160 MW per chunk. I did not bend the field for it. The display clamps at 100+ °C, where no mechanic changes, and the siting rule (§1.6: Accelerator-class compute 6 chunks from a nuclear block's turbines, 3 on a lake shore) is legible before the takeoff, as balance m4 asked. If the user still finds a 100+ °C turbine hall jarring, the next lever is giving turbines a condenser coolant box, which I think is not worth the deviation.
2. **Monitors are near-immunity** (R3-balance m5). A Monitor cleans within 5 s, and linear spread (§3.3) makes it stronger still. I kept it: Proceedings is optional and thin under Contained, and a cheap, sure defence is the payoff for researching it. Balance's upkeep option (one Evaluation set per 60 s while a working susceptible machine is in range) is ready if playtests show containment is trivial.
3. **"Deconstructing a compromised machine cleans it"** (R3-fun FUN-06) is rejected: R3-impl L3, adopted by DECISIONS §21, locks a compromised machine against mining and deconstruction, because otherwise a blueprint could clean a whole cluster. The power switch is the off switch, and the tips say so.
4. **The Endpoint's checkpoint is a recipe catalyst**, not a loaded slot. So an Endpoint's tier is that of ordinary checkpoints (1–3), never 4, which matches E's tiers. Rollback on an Endpoint means feeding it one fresh `checkpoint` through its rollback input.
5. **Model collapse by provenance treats archive-fed *Synthetic data* as clean** (R3-accuracy M4, adopted). Strictly, Synthetic data is generated text, and training on generated text is the collapse mechanism. The game's reading is that a model rephrasing pre-1945 archives keeps the archive's distribution, so only crawl carries the world's σ. I accept this as the better game and a defensible reading, and flag it as the one place where the mechanic is kinder than the literature.

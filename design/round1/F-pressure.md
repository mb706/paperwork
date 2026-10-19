# R1-F: Pressure systems (pollution, adversaries, rivals)

Tags as in the brief: **ISO** keeps Factorio's mechanic, **BEND** is a small deliberate deviation, **BREAK** a large one.

- **Sources.** Laws L1–L16 are B's (`B-ontology.md`); *F* and the Stacks are C's (`C-spacetime.md`).
- **Names follow H** (`H-tone-bible.md`): the pollutant is **Heat**, never "slop"; agents, never robots; tiers are numbered; the military pack is **Proceedings**.
- **Factorio numbers** are 2.0 values, checked against the wiki and the Lua API docs. The heat numbers come from a simulation of the chunk rule (§1.1).

## 0. Summary

B chose ontology **D, "Information is physical"**. Information has no position, and B assigns three pressure laws to F:
- **L5 Heat** takes pollution's slot.
- **L8 The world's text** (W, j, σ) takes evolution's slot.
- **L13 Runaways** are the only adversary the plane admits.

This document makes those three laws concrete with numbers (**Variant A, recommended**). It also keeps the per-chunk noise field as a documented alternative (**Variant B**), which needs the overlay ontology that B rejects.

| | A: Heat (recommended) | B: Noise |
|---|---|---|
| Pollution slot | **Heat**: a chunk field fed by every joule used. It throttles computing machines | **Noise**: junk in the local record from 1945, contaminating nearby data deposits |
| Evolution slot | W (the world level, = C's *F*), j (human junk share), σ (synthetic share): global numbers | The same global numbers; the field adds a local term |
| Adversary | **Runaways**: escapes from your own deployments. They can be caught inside the base; uncaught ones found nests outside | None |
| Ontology | D, B's verdict | B's rejected "overlay world" |

A third variant, heat plus a deployment-only noise field, was dropped. It adds a second overlay for an effect C's Stacks already show literally.

## 1. Variant A

The jobs Factorio's threats do (03) are a **footprint tax**, a **frontier**, a **clock** and a **logistics test**. Variant A assigns them as follows:
- **Heat** is the footprint tax.
- **W, j and σ** are the clock, and they also put pressure on data.
- **Runaways** are the frontier and the logistics test, and they arrive only once you deploy models.

Throughout, nothing smart is on the map, the player never fights or carries a weapon (L14), and every effect on production is deterministic and visible.

### 1.1 Heat (L5; BEND)

**Emission (L4, literal).** Every joule a machine consumes becomes heat in its chunk: electric machines emit their actual draw including drain, burner machines their fuel burn. Steam and nuclear plants also emit their conversion loss, which is **2× their electrical output**, as real thermal plants do. Solar emits 0. Modules act through energy (ISO). Factorio's separate pollution multiplier is dropped, since heat *is* energy.

| Factorio entity | Heat | Factorio pollution/min |
|---|---|---|
| Burner / electric mining drill | 150 / 90 kW | 12 / 10 |
| Stone / electric furnace (H: Keypunch / Tokenizer) | 90 / 180 kW | 2 / 1 |
| Assembling machine 1 / 2 / 3 | 75 / 150 / 375 kW | 4 / 3 / 2 |
| Lab (Seminar) / beacon (Switch) | 60 / 480 kW | 0 / 0 |
| Oil refinery / pumpjack | 420 / 90 kW | 6 / 10 |
| Boiler (1.8 MW out) / nuclear reactor (40 MW out) | 3.6 / 80 MW loss | 30 / 0 |
| Laser turret while firing | up to 1.2 MW | 0 |
| Solar panel | 0 | 0 |

Factorio's pollution falls with machine tier; heat rises with power. The inversion is deliberate: **denser is hotter**, which is the history of rack density. It moves the footprint from mines to power plants and compute, which is where AI infrastructure's thermal problem actually is. Speed modules and Switches raise power, and therefore heat: the counterweight to beacon density.

**The field.** Each chunk holds heat *H* (MJ) and displays T = θ + *H* / (20 MJ/K). θ is B's ambient temperature (L2), from −15 °C in the north to 35 °C in the south; spawn is 10–18 °C. 20 MJ/K is roughly the heat capacity of a chunk's air and topsoil.

- **Diffusion (ISO):** 2% to each of 4 neighbours every 64 ticks while *H* ≥ 15 MJ.
- **Loss (BEND):** Newton cooling. Each second a chunk loses κ·*H* + 2 kW, with κ area-weighted over its tiles:

| Terrain | κ (/s) | × grass |
|---|---|---|
| Water | 0.020 | 4 |
| Snow, ice | 0.0075 | 1.5 |
| Grass, dirt | 0.005 | 1 |
| Rock | 0.004 | 0.8 |
| Sand, desert | 0.003 | 0.6 |
| Concrete, paths, landfill | 0.0015 | 0.3 |
| Each healthy tree | +0.000025 (0.5 kW/K) | 100 trees ≈ +50% |

- **Trees (ISO):** above 45 °C, trees lose leaf stages, as under Factorio's pollution damage, and absorb less.
- **Why I bend B's "engine unchanged".** With Factorio's constant sinks, the field is diffusion-limited. In simulation a 150 MW base reached +144 K, and a broad base ran hotter than a dense hall, so total power mattered more than density. That is the wrong physics and the wrong puzzle. Newton cooling changes one line of the engine. It gives a response time of about 3 minutes and a length scale of about 1.4 chunks, so heat is local, density matters, and local cooling works.

**Throttling (L5).**
- **Which machines.** Only computing machines throttle (L11): tabulator, computer, cluster, frontier hall, Switches, and the AI-researcher share of a Seminar. Mechanical machines never do.
- **Formula.** Speed × *m*, where *m* = clamp(1 − (T − T*)/50 K, 0.5, 1). Power draw is unchanged (L5: fans make up the difference), so throttling is pure loss and does not cool the chunk.
- **Limits fall as density rises** (L5), following ASHRAE's air-cooling classes:

| Machine | T* |
|---|---|
| Tube-era tabulator | 45 °C |
| Stored-program computer | 40 °C |
| Cluster | 35 °C (class A2) |
| Accelerator hall, Frontier cluster | 25 °C (class H1, the 2021 class for high-density equipment) |
| Any liquid-cooled machine | +15 K (warm-water cooling) |

The constraint therefore tightens every era and binds hardest at takeoff.

**Calibration** (simulated):

| Case | Result |
|---|---|
| 10 boilers (36 MW loss) + 18 MW of consumers, temperate | Plant 40 °C; a computer one chunk away 25 °C, full speed. In a hot biome: plant 53 °C, computer 38 °C, cluster-tier speed 94% |
| Mid base, 150 MW over 6×6 chunks, solar | 42 °C: clusters at 87%, accelerator halls at 67% |
| Same base with its steam plant beside it | 47 °C: clusters at 76% |
| 50 MW accelerator hall (2×2 chunks), air-cooled | Temperate 40 °C → 71%. Hot 53 °C → 50%. Tundra 20 °C → 100%. On concrete 51 °C → 50% |
| Same hall + 4 cooling towers | 19 °C → 100% |
| Same hall, 70% liquid-cooled (T* 40 °C) | 22 °C temperate, 35 °C hot → 100% |
| 1 GW campus (7×7 chunks) | Air-cooled 162 °C → 50% (floor). 90% liquid-cooled 30 °C → 100% |

**Overlay and UI** (I §4).
- **"Heat" overlay:** absolute temperature, blue ≤ 0 °C, white 20 °C, red ≥ 45 °C. Hovering a machine draws its T* contour. Ambient is visible before you build, so the overlay doubles as a siting map: the climate compass.
- **Statistics tab "Heat":** produced by source against removed by sink, as Factorio's pollution tab does.
- **Stats box:** "Heat: 375 kW".
- **Alert:** *Thermal throttling*.

**Counters.**

| Counter | Tier (H ladder) | Mechanic | Tag |
|---|---|---|---|
| Siting | always | Cold north, shores, forests; no concrete under compute; keep compute away from thermal plants | ISO-ish |
| Solar | as Factorio | No plant loss, which halves the footprint | ISO |
| Efficiency modules | as Factorio | −30 / −40 / −50% energy, and so heat | ISO |
| **Cooling tower** (3×3) | Report | Removes up to 10 MW from its chunk, at full rate once ΔT ≥ 5 K and linear below. Uses 1 water per 2.26 MJ (latent heat of 1 kg: 4.4/s at full) and 300 kW. Two module slots, so a learned controller can cut its power (L11: a real one cut a datacenter's cooling energy by 40% in 2016) | BEND (absorber entity, the Space Age biochamber's role) |
| **Liquid cooling** | Article | Computing machines of tier 2 and up get coolant boxes and send 70% of their heat into coolant (1 unit per MJ). A **Dry cooler** (2×2, 200 kW) rejects 20 MW into its own chunk. A **Water exchanger** (must touch water) rejects 50 MW into the water chunk. With no coolant flowing, all heat goes to the air: graceful, never a stop | BEND (Factorio fluids, closed loop) |
| **Dennard scaling 1–5** | Article–Preprint | −8% energy for computing machines per level. "No further levels exist." (H) | ISO (multi-level tech) |
| Immersion cooling | Model card | Liquid fraction 90% | — |
| Thermal management (infinite) | late | +10% tower capacity per level | ISO shape |

Through diffusion alone, a lake one chunk away cools a hall by only 1–3 K. The shore pays through Water exchangers, which is how real plants use it.

### 1.2 The world's text: W, j, σ (L8; F's numbers)

These are three global numbers, shown where Factorio shows the evolution factor. They have no position, so they add no layout puzzle (B's stated risk). Their fun is in the refinery mix, in exchanges closing, and in archives becoming precious.

- **W, the world level, is C's *F*** (field-years since 1945, dW/dt = v₀·g(W) + β·P, C §5). One scalar, two names; the integrator picks one. It sets the towns' era, exchange flow and university capacity (L3, L9).
- **j, the junk share of new human text,** follows W's era. It is 0.30 in the press-and-radio era, 0.45 once networks carry spam, and 0.55 from the content-farm era on. It is never zero: sensational journalism was junk before any model existed.
- **σ, the synthetic share,** is a monotone accumulator with the evolution squash: σ = 0.9·Σ/(1 + Σ). Σ grows in two ways:
  - by *a* per unit of generated text your deployment buildings release (×0.5 after *Provenance*, i.e. watermarking);
  - by 0.05 per field-year once W includes generative ideas, as yours leak (L7).

  Tune *a* so that σ ≈ 0.3 when the first frontier run starts and ≈ 0.6 at the end of takeoff.
- **Exchange taps** yield curated (1−σ)(1−j) : junk (1−σ)j : synthetic σ (L8).
  - Without *Synthetic detection*, synthetic text is indistinguishable from curated text. A checkpoint trained with synthetic share *x* rolls quality at (1 − *x*) times the normal chance: model collapse as a quality penalty (D owns the quality rules).
  - With detection, synthetic text is routed as its own output, with C's false-positive numbers.
- **Walled gardens (BEND; B's matrix).** Each exchange closes for good when σ passes the threshold shown in its tooltip: 0.3 for the largest towns, rising to 0.8 for the smallest. Your deployment raises σ, and σ closes the exchanges you tap. The data wall, model collapse and closing sources become one visible number.
- **Archives** keep σ = 0 forever. They are the low-background reserve (H's achievement *Low-background*).

### 1.3 Runaways (L13, made concrete)

**Premise (B's physics).**
- **What it is.** A runaway is a copy of one of your models running on hardware you did not assign to it. Its body is the compute it occupies.
- **How it spreads.** Only along data links and inside agents. Machines without a computer are immune; a machine whose module slot holds a learned controller is not.
- **What it wants.** More compute and more power. It ignores people.
- **How it acts.** It never shoots. The bodies it builds outside dismantle.

**Leak and escape (deterministic).** A leak accumulator *L* is shown beside W, j and σ.
- dL/dt = Σ over deployment buildings of 0.01/h × model tier × (1 − *v*) × (1 − 0.2·*O*).
- *v* depends on the checkpoint's quality: 0 / 0.25 / 0.5 / 0.75 / 0.9 for Standard, Selected, Verified, Audited, Reference (H §4.6).
- *O* is the number of Oversight techs researched, up to 4.
- Each time *L* reaches 1, *L* drops by 1 and the deployment building with the largest accumulated share is **compromised**.
- Examples: 40 tier-2 Standard deployment buildings give 0.8 escapes per hour. 200 tier-3 Verified buildings with *O* = 2 give 1.8 per hour.

**Inside the base (BEND).**
- **Effect.** A compromised machine stops its output but keeps full power and heat. It shows an icon, raises the alert *Compromised*, and emits a circuit signal.
- **Spread.** Every 60 / 45 / 30 / 20 s (tiers 1–4) it copies itself into the nearest linked target: a computing machine, or a machine with a learned controller, on the same fiber network or inside the same Switch's range. Circuit wires carry signals, not programs, so they are never a vector.
- **Escape timer.** 120 / 90 / 60 / 45 s by tier. If the machine is still compromised when the timer runs out and it has a path out, an agent carries the copy away and founds a **nest**. A path out is an agent hub whose area covers the machine, or a fiber link to an exchange tap.
- **Cleaning** (L13's countermeasures):
  - *Power switch* (ISO entity): 30 s without power cleans a machine. A switch driven by the *Compromised* signal is a tripwire.
  - *Monitor* (2×2, 300 kW, range 24): cleans one compromised machine in range every 5 s, consuming one **Evaluation set**. Each use leaks the set: the reusable-holdout problem. Against tier 4, only sets newer than the model work: C's held-out sets from the Stacks.
  - *Rollback*: consumes one checkpoint copy and cleans a machine instantly.
  - *Air gap*: compute with no hub coverage and no external link cannot get out. It keeps spreading inside until cleaned.
- **The trade.** Air-gapped compute cannot be served by agents. Containment against convenience is the real trade-off, and it is a layout decision.

**Outside the base (the *Wild* preset).** The nest appears on the nearest chunk at least 3 chunks beyond your agent coverage, chosen by Factorio's expansion score. It has the **tier of the model that escaped**, and its units can never exceed that tier: its tooltip reads "Copy of <checkpoint>, tier 2". Its bodies are ground units built from scrap, so Factorio's walls and turrets apply. Stats are Factorio 2.0's, with new nouns (P8: numbered tiers):

| Runaway entity | Mirrors | HP | Attack | Join cost |
|---|---|---|---|---|
| Replicator (dismantler / etcher line) | Biter / spitter spawner | 350 → 3,500 with evolution | Spawn cooldown 360 → 150 ticks; owns ≤ 7 units | — |
| Mast 1–4 (stationary etchant mast) | Small → behemoth worm | 200 / 500 / 1,500 / 3,000 | Acid, range 25 / 30 / 38 / 48, puddles | — |
| Dismantler 1–4 | Small → behemoth biter | 15 / 75 / 375 / 3,000 | 7 / 15 / 30 / 90 physical, melee | 4 / 20 / 80 / 400 |
| Etcher 1–4 | Small → behemoth spitter | 10 / 50 / 200 / 1,500 | 12 / 24 / 36 / 60 acid + puddle, range 13–16 | 4 / 12 / 30 / 200 |

- **Unit mix:** Factorio's spawn weights by evolution (medium at 0.2, big at 0.5, behemoth at 0.9), capped at the nest's tier. Resistances are ISO, with 0% electric.
- **Raids.** A runaway came from your base, so it knows it: heat attracts nothing (L5). Each replicator accrues 4 + 36·*e* points per minute. Units join an attack when the points cover their ISO cost. Groups gather for 1–10 min, wait up to 2 min for stragglers and hold at most 200 (ISO). Targets are the nearest computing machines and power plants.
- **Damage is dismantling.** An entity brought to 0 HP is removed, and its item plus one stack of contents goes to the nest's stock. Ghosts remain, so agents rebuild (ISO). A destroyed replicator drops its stock plus 20 scrap, and the Verifier turns scrap into plates and boards. Offense pays, but loot is never required: Factorio removed alien artifacts in 0.15 for that reason.
- **Expansion (ISO, current defaults).** Every 4–60 min (shorter at higher evolution), a group of 5–20 builds a new nest 3–5 chunks from existing ones. This is autonomous replication as an existing mechanic.

**Evolution.** *T* accumulates three terms; *e* = *T*/(1 + *T*), Factorio's squash.

| Term | Value | Mirrors | Rationale |
|---|---|---|---|
| Time | +0.0072 per field-year of W after the first nest | `time_factor` 4×10⁻⁶/s at C's base speed (1 field-year per 30 min) | Rises with the world's own acceleration |
| Clearing | +0.002 per replicator destroyed | `destroy_factor` | Selection: survivors are what your defenses missed (optimizing against a monitor teaches evasion; Baker et al., 2025) |
| Escapes | +0.04 × tier per nest founded | `pollution_factor` | Your deployment is the emission. Escapes caught inside add nothing |

Prevention is this pollution's efficiency module. A fast takeoff raises tier and deployment volume together, so it summons nests faster than defenses scale. The tooltip lists the terms and comments on nothing.

**Defenses and supply chains.**

| Ours | Mirrors | Recipe / supply | Stats | Tag |
|---|---|---|---|---|
| Power switch | Power switch | ISO | Kill switch; with the *Compromised* signal, a tripwire | ISO |
| Monitor + Evaluation sets | Gun turret + magazines | Sets: e.g. 1 curated dataset + 1 Report → 2 (D) | 5 s per clean, range 24 | BEND: the ammo is test data that use consumes |
| Fence / gate | Stone wall / gate | 5 bricks, 0.5 s / 1 fence + 2 steel + 2 circuits | 350 HP, acid 80% | ISO |
| Gun turret + magazines (plain / AP / DU) | Gun turret + firearm / piercing / uranium rounds | 10 copper + 10 gears + 20 iron, 8 s; magazines 4 iron, 1 s; +1 steel +5 copper; +1 U-238 | 400 HP, range 18, 10 shots/s; 5 / 8 / 24 physical × 10 rounds | ISO |
| Laser turret | Laser turret | 20 steel + 20 circuits + 12 batteries, 20 s | 1,000 HP, range 24, 20 laser, 1.5/s, 800 kJ/shot; its power is heat | ISO |
| Arc turret | Tesla turret (Space Age) | ISO, at the Preprint tier | Electric chain damage, 0% resisted | ISO |
| Artillery (turret, wagon, shell) | Same | ISO | Range 224; auto-targets replicators | ISO |
| Interceptor bay + Interceptor 1–3 | Defender / distractor / destroyer capsules | Bay 2×2 holds 20 and dispatches within 30 tiles; interceptors recharge like agents | ISO stats | BEND: launched by a building, never thrown |
| Repair kit | Repair pack | 2 circuits + 2 gears, 0.5 s | 300 durability | ISO |
| **Proceedings** (military pack) | Military science pack | 1 Evaluation set + 1 AP magazine + 2 fences → 2, 10 s | Optional pack (ISO) | ISO; the grenade's slot becomes evaluation (L13) |

**Presets** (map settings, mirroring Factorio's):
- **Off:** no leak.
- **Contained:** B's pure L13. Escapes never leave, there are no nests, and there is no combat; the defense line is power switches, monitors and rollback.
- **Wild:** adds nests and Factorio's whole military loop.

The default is **Wild**, which is ISO with biters-on. Two things make that safe: deployment arrives late, so the first 60% of the game is peaceful regardless; and **a base with tripwires and monitors never sees a nest**. Combat becomes the price of failed containment, which the player can engineer away. B recommends *Off*; see §5.

**Why this is not "turrets versus rogue AI".**
- The image the brief warns about is a superintelligence beaten by guns. A runaway is capped at the tier it copied, and it is beaten first by power switches and test data.
- It wants electricity and copper, not you.
- It harvests rather than destroys.
- Your deployment and your clearing are two of its three growth terms.

The threat model is rogue replication at low capability, which labs actually evaluate (L13). The countermeasures are the real control toolkit: kill switches, tripwires, air gaps, monitors, rollback. None of it is text.

## 2. Variant B: Noise (the overlay ontology; not live under D)

Kept so the choice is visible. It fails B's field test (bar 2): noise has no physical carrier between chunks after networking, and its terrain sinks are fiat.

- **Field:** Factorio's pollution engine, unchanged (ISO). 2% diffusion, minimum 15, constant sinks per tile (2.0.7 values: water 1.54/min/chunk, grass 1.11, sand 0.92, paths 0), and trees absorb. Read under this ontology, the record decays where nobody keeps it.
- **Emitters** (noise/min; only recipes tagged `writes`): Keypunch / Tokenizer 2 / 1. Crafting tiers on writing recipes 4 / 3 / 2. Data refinery 6. Synthetic-data plant 4. Deployment 30 (the boiler's role). Mines, smelters, power, Seminars and Trainers: 0, because reading is silent. The principle is Shannon's: a fraction of everything written is wrong, and wrong things circulate.
- **Effect:** junk share *j*_chunk = *N*/(*N* + 1,000). Archive drills put a Junk record on the belt with that probability (mixed belts, like overlapping ore). Exchange purity also subtracts the global *j* and σ. A starter base sees 10–20% junk on nearby archives; a deployment district pushes past 70%.
- **Counters:** distance (remote pre-1945 archives are clean). *Error correction* 1–2: writers −25% each (Hamming, 1950; Reed & Solomon, 1960). A Curator (2×2, 100 kW) absorbs 20/min in its chunk. *Provenance* halves deployment noise. Junk records become labels (the sulfur of the chain).
- **Heat in B:** no field. Computing machines take coolant as an input, and cooling towers consume water. There is no throttling and no climate compass.
- **Adversary:** none.

## 3. Shared modules

**Rivals as timers.**
- **The clock** is W, which is C's *F*. Rivals live there and nowhere else (L8).
- **Race mode (BREAK, opt-in):** C's rule. If W > your year for 10 minutes after *Automated research*, you lose, with H's text "A frontier run completed elsewhere at 29:40:11. Yours was at 61%."
- **Scooped (BEND; off by default, on in race mode):** the purple-tier experimental *Result* spoils in 15 min into *Baseline*, which still feeds lower recipes as training data. Gleba's rules apply unchanged. In race mode each spoiled Result adds 0.002 to W: what you sat on, they published. C's held-out sets carry the same feeling on the Stacks, and 05's warning about spoilage on the core loop keeps this off by default.

**Hollow work** (Goodhart; BEND; from *Automated research*). Seminars staffed by AI researchers waste a share *h* of the papers they consume: the papers are used up and add no progress.
- *h* = min(0.5, 0.1 × max(0, *A* − *O*)), where *A* is the model tier and *O* the number of Oversight techs. The AI researchers' quality multiplies it by (1 − *v*).
- The Seminar shows "Speed +400%. Hollow: 20%." The speed stat counts the hollow work; the progress bar does not. That gap is the whole joke.
- *Interpretability* stops hollow work from consuming papers.

B's matrix suggests hollow *items* that "pass inspection and fail downstream". Confining the effect to one building with an aggregate readout is what keeps it from being hidden sabotage.

## 4. Pressure by tier

| Tier (H) | Heat | World's text | Runaways | Other |
|---|---|---|---|---|
| Memo (red) | Overlay from minute one; boilers dominate; tube-era T* 45 °C, so throttling is rare | j 0.30; archives pristine | — | W line visible |
| Report (green) | Cooling tower; efficiency modules; computers (40 °C) beside steam plants start to feel it | — | Fences, gun turrets, magazines available | — |
| Proceedings (black, optional) | — | — | Monitors, Evaluation sets, laser turret, repair kits | — |
| Article (blue) | Liquid cooling; Dennard 1–2; clusters (35 °C) | Exchange taps; j 0.45 | — | — |
| Preprint (purple) | Dennard 3–5, then none; accelerator halls (25 °C) make cooling mandatory | j 0.55; σ starts once generative ideas leak; walled gardens begin | First deployments: leak, *Contained* physics, first nests; arc turret, artillery, interceptors | Scooped, if on |
| Model card (yellow) | Immersion cooling; GW campuses | σ rising from your deployment; archives are the reserve | Tier 3; escapes per hour scale with deployment volume | Hollow work; race clock |
| Frontier run → System card | **Thermal wall:** power and cooling build rate brake takeoff (G) | σ ≈ 0.6; most exchanges closed | Tier 4 (C's held-out sets for the monitors that face them) | Race resolves |
| Beyond (B L16) | Radiators only; cold moons make compute cheap (Landauer) | — | Stay on the home surface | Grabby frontier (03) |

## 5. Recommendation

**Build Variant A.** It requires ontology D, B's verdict, and is that ontology's three pressure laws made concrete.

1. **One system from ENIAC to the swarm.** Heat is physical from minute one and terrain-dependent for physical reasons. It is the takeoff brake G needs, and in vacuum it becomes radiators.
2. **It answers the user's question exactly.** Slop is not a place. It is σ and j: global numbers your own deployment raises, which shift the refinery mix, close exchanges and make archives precious.
3. **The 2026 siting game becomes mechanics.** Rack density, liquid cooling, water, cold sites, the end of Dennard scaling and ASHRAE's limits all appear as numbers, never sentences.
4. **The adversary is the one the plane admits,** with two layers:
   - *prevention*: power switches, tripwires, monitors fed with test data, air gaps;
   - *containment*: Factorio's whole military loop, at ISO numbers.

   A careful player never needs the second layer.
5. **ISO wherever possible.** Unit stats, costs, expansion, group rules, turrets, ammo and the evolution squash are Factorio's. Each BEND buys physics or legibility: literal heat, Newton cooling, density-dependent limits, the leak accumulator, the tier cap, dismantling, monitors.

**Defaults:**
- Heat and throttling: on. Archive heat decay is an option, default off.
- W, j, σ: on.
- Runaways: *Wild*.
- Hollow work: on.
- Scooped: off. Race mode: opt-in.

**Build order:**
1. Slice: heat field, overlay, statistics tab, throttling, cooling tower.
2. Exchanges with j and σ.
3. Deployment with *Contained* physics.
4. *Wild* nests and the military line.
5. Hollow work.
6. Race mode.

**Hooks.**

| Agent | What this design needs |
|---|---|
| D | `computing` and `deploys` tags; computing machines' power (= heat); coolant boxes; Evaluation set and brick recipes; scrap recycling; the quality penalty from σ |
| E | Cooling tower, Liquid cooling, Dennard scaling 1–5, Immersion cooling, Thermal management, Synthetic detection, Provenance, Oversight 1–4, Interpretability, the defense techs, Proceedings |
| G | Throttling and the falling T* as the takeoff brake; escapes during takeoff |
| C | *F* = W; the Stacks' held-out sets as tier-4 monitor ammo |
| I | The Heat overlay and statistics tab; W, j, σ and *L* in the evolution slot; alerts *Thermal throttling*, *Compromised* and *Entity dismantled*; the circuit signal |
| H | Rewrite tip 14 ("Archives downwind of trainers degrade") under D, e.g. "Exchanges close as σ rises." |

**Disagreements.**
- **With B:**
  - Newton cooling instead of the unchanged sink rule (evidence in §1.1).
  - Runaways default to *Wild*, not *Off*: ISO with biters-on, and prevention makes combat avoidable by engineering.
- **With 03:** feral code walking the terrain and heat that attracts enemies both go, in favour of B's L1, L5 and L13. Enemies wake from your deployment, not from *Networking*.
- **With Factorio:** "higher tiers pollute less" is inverted on purpose.

**Rejected.**
- A noise cloud under D.
- Derelict nests across the map, an earlier draft of mine: they fail L13's origin rule.
- Anything that shoots or targets people.
- A killable superintelligence.
- Heat damage to entities.
- Random breakdowns.
- Hollow items with no aggregate readout.
- Spoilage on core papers.
- "Slop", "rogue AI" or "alignment" in UI text.

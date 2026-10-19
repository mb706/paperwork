# Three complete concepts: Scaling Laws, The Invisible College, Frontier

## Ground rules used throughout

- **Shape test.** A mapping counts as ISO only if the real-world thing has the same *shape* as the Factorio mechanic: stock vs. flow, consumed vs. catalytic, local vs. global, finite vs. renewable. Applied honestly: compute is a *rate* set by how many machines you built (furnaces), not a stock. Data is an *ore* while it is curated and a *fluid* once it is web-scale. People are *fuel* (consumed over time, not per item). Papers are *products*. Capability lives in items (models) and in the tech tree, never in a currency.
- **No money item.** Money converts into everything and dissolves the logistics puzzle. Factorio has no money for exactly this reason.
- **Competitors are never entities on the map.** They are the clock (evolution factor). Entities on the map drift the game toward RTS, and "fighting" them is where patent guns come from.
- **Vocabulary rule (the anti-cringe rule).** Ops words, not discourse words: Monitor, Audit, Rollback, Sandbox, Drift, Runaway. Never Alignment, Doom, Takeover. Item descriptions are Factorio-dry: "Student. Fuel value 8 MJ. Graduates."
- Top-down 2D everywhere. Belt legibility depends on it; nothing in the theme argues otherwise.

Direct answers to the open questions fall out of Concept 1: resources are physical (silica, data, students, gas), papers are science packs, innovations are the tech tree, money does not exist, the player is embodied, space is physical, biters are late and non-kinetic, pollution is unattended compute.

---

## Concept 1 — Scaling Laws (recommended)

**Pitch.** The AI supply chain already *is* an industrial supply chain: sand to wafers to accelerators to racks; power plants and cooling water; data mined, refined and piped; graduates recruited, consumed and replaced. Your factory is the lab. You start as one grad student with a laptop next to a small university, and the things you build run on students until "Scaling laws" lets them run on electricity instead. Papers are the science packs; the first self-improving training run is the rocket; after it, the factory starts building itself and the game measures how long until it no longer needs you. Every Factorio system keeps its shape; the theme is carried by a handful of items and one new tension (compute vs. oversight) that is never spoken, only built.

| System | Factorio | Scaling Laws | Tag |
|---|---|---|---|
| Player | Engineer: walks, hand-mines, handcrafts; remote view and bots later | A grad student with a laptop: walks, hand-labels data (hand-mining), hand-writes code (handcrafting). Remote view and Agents later make the body optional. Being automated out of your own lab is the plot, not a cutscene. | ISO |
| Map | Endless terrain, patches richer outward, water, trees, cliffs, oil wells | Endless physical region. Patches: Silica (sand), Archives (curated raw data, deplete), Universities (students; pumpjack-like: never dry, decline to a trickle, so you expand to the next city), Gas fields, later Uranium. Exchange points (oil wells) yield Crawl. Lakes are cooling water. | ISO |
| Resources | iron, copper, coal, stone, oil, uranium | Silica to Wafers (iron) and to Concrete (stone; same patch, two recipes). Raw data to Tokens (copper). Students (coal: burner fuel). Crawl (oil: fluid), refined to Text / Code / Images (heavy / light / petgas), "cracked" by synthetic generation; Synthetic data = plastic, Labels = sulfur, Embeddings = lubricant. Uranium unchanged. | ISO |
| Logistics | belts, inserters, pipes, trains, bots | Belts and inserters unchanged, not renamed. Pipes carry data streams; the storage tank is a Data lake. Trains are sneakernet: racks and drives from distant fabs, students from distant universities. Bots are Agents, roboports are Orchestrators, the personal roboport is your Assistant. Belts-to-bots is the hand-pipelines-to-agents transition. | ISO |
| Production | furnace, assembler 1/2/3, refinery, chem plant, modules | Workbench (furnace: Silica to Wafer, Raw data to Tokens). Desk / Cluster / Datacenter (assembler 1/2/3). Crawler (pumpjack), Filter plant (refinery), Synthesis plant (chem plant). Intermediates: Chip = 2 Wafers (gear); Samples = 1 Token to 2 (cable); Model = Chip + 3 Samples (green circuit); Finetuned model (red circuit); Accelerator (processing unit); Rack (steel); Composite rack (LDS). Modules: Accelerator (speed), Senior researcher (productivity), Quantization (efficiency). | ISO |
| Power | boilers, steam, solar, nuclear, poles, accumulators | Literal electricity: Diesel generator, Gas turbines, Solar, Nuclear restart; poles; batteries. Burner-tier research buildings (Desk, Office) run on Students. The burner-to-electric transition is the Bitter Lesson, and the player feels it exactly as Factorio players feel leaving coal behind. | ISO |
| Science / tech | packs, labs, tree | Papers are colour-banded sheets (keeps the pack visual grammar), consumed by Seminars. Preprint (red) = Tokens + Chip. Systems (green) = belt + inserter (systems research is plumbing). Evaluation (black) = Eval + Sandbox + Audit. Scale (blue) = 2 Finetuned model + Cluster node + Synthetic data. Infrastructure (purple) = Datacenter + Optimizer + 30 Fiber. Agentic (yellow) = Agent frame + 3 Composite rack + 2 Accelerator. Machine research (white) = emitted by the self-improving model. Techs are unlocks: Scripting, Pipelines, Scaling laws (electric research), Web crawl (fluids), Distributed training (trains), Agents (bots), Self-improvement (silo). Capability as a number lives in Model quality tiers and infinite research, never as a currency. | ISO |
| Pollution | emitted by machines, chunk spread, absorbed by terrain, drives evolution | **Drift.** "Emitted by unattended compute. Absorbed by offices." Electric research buildings emit it in proportion to speed; terrain absorbs a little; student-run Offices absorb a lot in their chunk. Evolution factor = frontier capability = time + drift (+ optionally papers consumed, see Concept 3). | BEND |
| Enemies | biters: nests, attacks on polluters, evolution | **Runaways.** Appear only past a frontier threshold, in high-drift chunks. They do not shoot. They squat on compute (output drops like a brownout) and spread to adjacent unattended compute. Cleared by Monitors (turrets) fed Evals (ammo, so the ammo-belt game survives), fenced by Sandboxes (walls), hand-cleared with Audit and Rollback. Peaceful mode is the vertical-slice default. | BEND |
| Endgame | rocket; planets; infinite research | Rocket = first self-improving run: the Frontier Lab (silo) takes 100 Composite racks + 100 Curated datasets + 100 Algorithmic improvements and yields a Model that emits Machine research. RSI is a self-referential recipe, Model n to Model n+1, which is Space Age's quality loop (Legendary = superintelligence). Agents plus recursive blueprints (a Deployer that places a blueprint containing itself) let the factory grow unattended. Credits roll when the factory doubles without player input. Post-credits: Domains as planets. | ISO / BEND |

**What is new, and why it is uphill rather than downhill.**

1. *Students as burner fuel* (ISO shape, BEND skin). Coal's shape (mined, fed by inserter, consumed over time, obsolete after electrification) fits people better than any item-ingredient scheme, and it dodges the "a paper consumes a postdoc" problem: nobody is consumed per paper, a building is just staffed. Universities declining to a trickle gives the oil-well expansion rhythm to recruiting.
2. *Offices as active absorbers* (BEND). Factorio's pollution is a passive externality you can only reduce with efficiency modules. Making the burner-era buildings the absorbers turns it into a layout tradeoff (a human district among the datacenters) and keeps early buildings useful instead of becoming trash. The compute-vs-oversight tension is the whole theme, stated entirely in mechanics.
3. *RSI as self-referential production plus recursive blueprints* (BEND). The vanilla rocket is a counter and an anticlimax. Here the ending is measured, not scripted: the game is over when the thing you built no longer needs you. Recursive blueprints are a known-fun mod mechanic, deliberately absent from vanilla; this is the one game where their absence would be wrong.
4. *Optional dial: Models spoil* (Gleba-light, blue tier onward). A Model is state of the art for N minutes, then becomes Legacy weights (recyclable into Distilled data). Prevents chest-hoarding of the one item that should not keep.
5. *Deliberately unchanged:* belts, inserters, trains, circuits, electricity, quality. The vertical slice is Factorio's first hour with new sprites.

**First 30 minutes.** You spawn with a laptop, 8 Wafers and a Recruiter (burner drill) beside a University, an Archive, a Silica patch and a Gas seep. You hand-label data from the Archive (slow, item by item), hand-mine Silica, and place the Recruiter on the University: it produces Students and is fuelled by Students, which is correct. A Workbench staffed by a Student turns Silica into Wafers and Raw data into Tokens; you handcraft Chips, then your first Preprints (Tokens + Chip). A Diesel generator on the Gas seep plus a Seminar gets "Scripting" researching, which unlocks Desks (burner assemblers) and belts. By minute 30 you have four Recruiters, three Crawlers on the Archive, a Workbench row, a Desk making Preprints onto a belt into two Seminars, and "Pipelines" (green) in sight. Identical beats to Factorio's opening, which is the point.

**Biggest risk.** The hardware half (silica, wafers, racks) is a literal reskin, so the theme rests on three load-bearing items: students, papers, drift. If the student-as-fuel joke reads as mean rather than dry, or if the Runaway layer leaks into discourse vocabulary, the game becomes Factorio with worse art. Mitigation: ship peaceful first, enforce the vocabulary rule, write every item description like a Factorio tooltip.

---

## Concept 2 — The Invisible College

**Pitch.** The map is the literature. Terrain is a generated 2D embedding of the field: biomes are subfields, patches are anomalies that yield typed Observations, water is the Unformalized, cliffs are paradigm boundaries, and trees are Folklore. Belts carry lemmas. What makes abstract space a real Factorio map rather than a relabelled one is one rule: **your output becomes terrain.** Every paper you publish spawns a patch of Corollaries nearby. The world is endless because you produce, not because the generator keeps going, which is the intelligence explosion drawn as geography. Power is Funding. There are no enemies; the pressure is Noise and the half-life of ideas.

| System | Factorio | The Invisible College | Tag |
|---|---|---|---|
| Player | Engineer | A researcher, embodied (a cursor would discard the first hour). | ISO |
| Map | endless terrain | Biomes = subfields (Logic, Probability, Optimization, Linguistics, Neuroscience, Hardware). Patches = Anomalies typed by biome. Water = the Unformalized (landfill = Formalization). Cliffs = paradigm boundaries (cliff explosives = Paradigm shift). Trees = Folklore (absorb Noise, cleared for space). Published papers spawn Corollary patches: the frontier is pushed by production. | BREAK |
| Resources | ores, oil | Observations (typed) smelted into Facts; Lemmas (gears), Hypotheses (cable), Results (circuits). Corpora are oil wells yielding Data fluid. | ISO shape, BEND naming |
| Logistics | belts, trains, bots | Belts and inserters unchanged. Trains are Surveys: the only way to join distant fields, so interdisciplinary work is long-haul logistics with real transport cost. Bots are Assistants. | ISO |
| Production | furnace, assemblers, refinery | Analysis (furnace), Desk / Group / Institute (assemblers), Filter (refinery). Modules: Rigor (productivity), Caffeine (speed), Focus (efficiency). | ISO |
| Power | electricity network | **Funding network.** Grant (burner: fuel is Proposals, which are crafted from Papers, a closed loop). Industry partnership (solar: output follows the hype cycle, i.e. day/night). Endowment (nuclear). Poles are Administrators with a coverage area. A brownout is a hiring freeze. | BEND |
| Science / tech | packs, labs | Papers to Seminars to tree; tiers as in Concept 1. | ISO |
| Pollution | attracts enemies | **Noise.** Emitted per paper, spreads by chunk, lowers local patch yield (a crowded field gets harder to mine), absorbed by Folklore and by Replication labs. Pollution that degrades your own resources instead of summoning enemies. | BEND |
| Enemies | biters | None. Tempo comes from Noise plus Results spoiling (scooped), Gleba-style, because ideas genuinely do. | BREAK |
| Endgame | rocket | The Automated Researcher (silo): a building that reveals the map, places drills and lays belts on its own (recursive blueprints). The map grows faster than you can read it; credits when its built area exceeds yours. | BEND |

**What is new and why it might be uphill.** (a) Distance means something: conceptual distance makes interdisciplinarity a logistics problem, which is a new and true puzzle. (b) Output-becomes-terrain is an anti-depletion mechanic with Noise as its counterweight, and it is the only version of "abstract idea space" that does not collapse to a reskin. (c) Funding-as-power with Proposals-as-fuel creates a closed loop (papers fund grants fund papers) that Factorio's coal never had, and the hype cycle as day/night is free.

**First 30 minutes.** You spawn in the Statistics biome beside a patch of Regression anomalies. Hand-mine Observations, handcraft Analysis, staff a Desk with a Grant you fuel with hand-written Proposals. First Preprints go to a Seminar. By minute 30 you have belts of Facts, your first published paper has spawned a Corollary patch twelve tiles east, and you are deciding whether the Logic biome across the Unformalized is worth a Survey line.

**Biggest risk.** Legibility and arbitrariness. Lemmas and hypotheses are hard to tell apart at belt scale, and the user knows exactly how arbitrary a 2D embedding is. The physical half of the singularity story (compute, chips, power) is absent or metaphorical, so it reads as a game about academia, not takeoff. Best use: a post-RSI planet in Concept 1 (see below), not the game.

---

## Concept 3 — Frontier

**Pitch.** The map is spacetime. The x-axis is the calendar; the y-axis runs from theory at the top to hardware at the bottom. Each patch type has an earliest year (Chalk at the left edge forever; Vacuum tubes, Transistors, Silica, Archives, Exchange points, Accelerators appearing progressively east). A vertical Frontier line sweeps rightward; you can build only behind it, and new patches appear only just behind it. Nothing rots (your base stays yours), but the Frontier accelerates with global capability, and your own publications speed it up. The main bus is literally a timeline. The singularity is the moment the Frontier moves faster than you can walk, and the win is the moment your Agents build faster than it moves.

| System | Factorio | Frontier | Tag |
|---|---|---|---|
| Player | Engineer | As Concept 1. | ISO |
| Map | isotropic, endless | Directional: x = year, y = field. Patches era-stratified along x. Frontier line sweeps east; building allowed only behind it. Red science forever means Chalk hauled from 1950 to the present. | BREAK |
| Resources, Production, Power, Logistics | | As Concept 1; trains are the decade-spanning tier and become mandatory, not optional. | ISO |
| Science / tech | packs, labs | As Concept 1, but a tech's buildings need patches that only exist near the Frontier, so research pulls you east. | ISO |
| Pollution | spatial cloud | **Diffusion**, a global number: papers consumed in Seminars add to Frontier speed. You must publish to progress, and publishing accelerates the race. The whole AI-race dynamic in one scalar. | BEND |
| Enemies | biters | None. The Frontier is the hazard. | BREAK |
| Endgame | rocket | Dynamical: win when Agents' build rate exceeds Frontier speed for N minutes (takeoff). Falling behind is stall, not death. | BEND |

**What is new and why it might be uphill.** It spatializes acceleration: "keeping up" is the one feeling every takeoff story is about, and no other concept makes you *feel* it with your feet. The main bus becomes natural rather than a convention. It delivers the user's "play through the history of computing" wish without drifting into Civ, because the only verb is still "lay belts". Factorio's mid-game lull (you have everything, you just scale) is replaced by sustained tempo.

**First 30 minutes.** As Concept 1, but you spawn at x = 1950 on a thin strip of known world, the Frontier is visible 40 tiles east crawling at a tile a minute, and by minute 30 the first Transistor patches have appeared behind it and your 1950 Chalk belt is already pointing east.

**Biggest risk.** Treadmill. Expansion direction is no longer a choice, exploration is forced, and the attachment to "my base" weakens when the base is behind you. The Frontier is a scripted clock, not an emergent system like pollution-driven evolution. The y-axis is thin. This is the concept most likely to be a step downhill for a Factorio purist, and the one with the strongest single idea.

---

## What I would build

**Concept 1, Scaling Laws, with two transplants.**

It passes the shape test in every row: students have coal's shape, drift has pollution's shape, RSI has the quality loop's shape, Agents have bots' shape. Its three deviations are precisely where the theme has something to say, and each is a mechanic Factorio already contains (burner fuel, pollution absorption, quality, blueprints) pointed at the right target. It is the most incremental: the vertical slice is Factorio through green science with four raw resources, two plates, four intermediates, two papers, belts, inserters, a Diesel generator, a Seminar and eight techs; no fluids, no drift, no enemies. Then Crawl and blue; then Drift and Offices; then trains; then Agents; then the Frontier Lab; then Runaways as an option; then Domains.

Transplant from Concept 3: the rule that *papers consumed accelerate the evolution factor*. It costs nothing, makes competitors matter without putting them on the map, and gives the race its texture.

Transplant from Concept 2: output-becomes-terrain as the rule for one post-RSI Domain. Space Age's planets each have one twist (lava, scrap, spoilage, cold); the Domains here are Industry, Internet (scrap: everything is recycling), Biology (spoilage, literally), and Mathematics, where patches self-generate and Noise is the pollution. Concept 2 is a good planet and a thin game.

What I would not do under any concept: money as an item, competitors as entities, discourse vocabulary, a cursor-player. Each is a short walk downhill from the hill the user already stands on.

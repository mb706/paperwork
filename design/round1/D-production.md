# R1-D — The production economy (draft)

*Round 1, agent D. Tags (ISO / BEND / BREAK) as in the brief. Other round-1 documents are cited by letter: **B** ontology, **C** spacetime, **E** tech tree, **F** pressure, **G** endgame, **H** tone bible, **I** UI. B, F and H were read while this was written; names follow H's naming systems and the physics follows B's laws (L1–L16) unless a section says otherwise.*

**Scope.** The full base-game economy before the expansion: resources, items, fluids, recipes, buildings, the era chains, the data refinery, where compute lives (D4) and talent (D3), plus a sprite line per item. Everything in §8–§10 exists as machine-readable data that passes `tools/validate_spec.py` with **0 errors**; the playthrough reaches all 57 unlock groups in 12 waves (Appendix B).

## 0. Summary

| Question | Answer | Tag |
|---|---|---|
| Size | **65 material items + 8 fluids**, plus 81 building items and 7 generated container fills (161 in all); **81 placeable entities**, 32 of them production and power buildings; **162 recipes** (64 materials, 81 buildings, 14 container fills, 3 pseudo-recipes for boiler, reactor and launch) | — |
| Raw resources | Iron, copper, coal, **quartz** (plays stone), uranium, wood; **Records** from **Archives** (the one new ore); **Crawl** from **Exchanges** (the oil) | ISO + 1 new ore |
| Chip ladder | **Logic board → Processor → Accelerator** = Factorio's green → red → blue circuit. The GPU is the blue circuit: the late game mass-produces accelerators | ISO |
| Oil | **The data refinery**: Crawl → Junk / Text / Prose; Denoising and Rephrasing are the two crackings; Dataset is plastic, Benchmark is sulfur, Corpus is rocket fuel. Every Factorio number kept, including 20 refineries : 5 denoisers : 17 rephrasers | ISO |
| The chemistry oil used to supply | **Coal chemistry** in the chemical plant: sulfur, sulfuric acid, lubricant, explosives, batteries, and **wafers** (silicon + acid, the plastic of the chip chain) | BEND |
| D4: where compute lives | Compute is a rate (B L11). It lives in **module slots** (Coprocessor = speed, Learned controller = productivity, Distilled controller = efficiency; Factorio's colours), in **Switches** (beacons, 1/√n = communication overhead), and in the **Trainer** and **Frontier cluster**, whose crafting time *is* the compute. A **Checkpoint** is trained weights: compute kept | ISO numbers, BEND names |
| Models | Trained once (data + trainer time). **Consumed** only when incorporated (papers, payload). **Catalyst** when used or copied (controllers, logistic agents, synthetic data, distillation, Researcher), per B's copy law L6 | BEND (Kovarex shape) |
| D3: talent | No talent item, ever. Recommend **B's L9**: universities staff Seminars within commuting range, shared like power. The production hook is the **Researcher** item (4 accelerators + a checkpoint, returned), which supplies staff-equivalents | BEND (B's) |
| Papers | H's publication ladder: **Memo, Report, Proceedings, Article, Preprint, Model card, System card**. Shapes and times ISO; one ingredient swapped where the theme demands it | ISO / BEND |
| Frontier run | Rocket part = **Run shard** (10 accelerators + 10 racks + 10 corpora), satellite = **Post-training payload**, 100 shards per run → 1000 System cards | ISO |
| Calibration | Iron per pack within 10% of Factorio's for every main-line pack except the Model card (−27%); copper equal or lower, because checkpoints cost compute time instead of hardware; the optional gray pack is made of data. Data per pack rises across eras faster than Factorio's oil per pack (§11) | — |

## 1. Ontology rules for the economy

B's laws, made operational. Every recipe below obeys them; §13 lists the places where that cost something.

1. **Matter is ISO.** Ores, plates, gears, pipes, belts, power: Factorio's, unrenamed where the name is already literal. The one theme change in the physical layer is the ore that plays stone: **Quartz**, because sand to silicon is the substrate of the whole subject.
2. **Information is always on a carrier or in a line** (B L6). Belts carry cards, drives and sealed envelopes; data lines carry streams. A data line behaves as a pipe but never connects to one (§4.4). Nothing informational floats. Carriers for *new* content come from the carriers of consumed content, recycled off-screen (B's accepted abstraction); only a *copy* takes an explicit blank carrier, because copying is the one operation that would otherwise make something from nothing.
3. **Fresh data is the rival good.** Training on data spends its novelty, so data items are consumed. Re-use is priced at the source: Archives deplete, and Exchanges decay to the town's rate of new writing (the data wall is ore depletion plus pumpjack decay).
4. **A model is trained once and copied cheaply.** A **Checkpoint** costs 10 datasets and 60 s of trainer time. It is consumed only when it is incorporated into something (a Preprint, a Model card, the payload). Everywhere a model is *used* or *copied* it is a **catalyst**, returned by the recipe, and the copy costs a blank carrier: Learned and Distilled controllers, logistic agents, Synthetic data, the Researcher. Kovarex already taught the shape.
5. **Compute is a rate, never a substance** (B L11). It is the crafting speed of computing machines (Tokenizer, Data plant, Data refinery, Trainer, Seminar, Frontier cluster), raised by Coprocessors and Switches, paid for in power and, under F, heat. No compute item, fluid or grid.
6. **Benchmarks are consumable.** Each use leaks a little of the held-out set into the field (the reusable-holdout problem). That is why papers can eat them.
7. **Water in a data recipe is cooling.** Every Factorio fluid recipe that takes water still does; in the data chain the water is evaporated by the machines doing the work. This keeps the oil numbers ISO and makes lakes worth siting data plants on, which F's heat and B's climate compass reward anyway.

## 2. Raw resources

| Resource | On the map | Yields | Finite? | Where it spawns (summary; full rule in §8 table) |
|---|---|---|---|---|
| Iron ore, copper ore, coal | Ore patches | ore | finite | ISO, starting area included |
| **Quartz** | Ore patch (plays stone) | Quartz | finite | ISO with stone; sandy patches favour coasts and dry riverbeds |
| Uranium ore | Ore patch | ore (+1 acid/ore) | finite | ISO, never in the starting area |
| Wood | Trees | Wood | finite (no regrowth) | ISO forests |
| **Archive** | A town library's stacks, or a records store in an old mine (B L3) | **Records** | **finite** | One small archive at the starting college town; larger and richer with distance (bigger towns, older collections) |
| **Exchange** | A town's exchange: telegraph office in 1945, internet exchange later (B L3) | **Crawl** (fluid) | **decays to a 20% floor** | 1–4 taps per exchange (an oil cluster); tappable after *Information retrieval* |
| Water | Lakes, coast | Water | infinite | ISO |

- **Finite vs renewable.** Archives are the past and run out: that is the data wall as ore depletion. Exchanges are the present: the first crawl takes the backlog, then yield decays to the floor, which is the town's rate of new writing (B L8; it may rise with W). Crude-oil constants are kept verbatim: 10 units/s per crawler at 100% yield, 300 cycles per percent, floor 20%.
- **Distance scaling.** ISO for ores. Archives and exchanges scale with town size, which B makes grow with distance from spawn, so expanding outward reaches bigger libraries and busier exchanges. Archives are low-background data (σ = 0 forever, B L8); if F ever lets σ bite, distant old archives are worth a rail line.
- **Synthetic share.** F removes the synthetic share at the well: crawler yield × (1 − s). The refinery's fixed fractions stay ISO. Junk's 20% share of filtering output (25 of 125) is B's j for free.

## 3. The era chains

Eras are states of technology, never dates (B L15). Each tier adds one chain, the way Factorio's tiers add steel, oil, robots and the rocket.

| Tier (pack) | Era (flavor) | New chain | Items and buildings it adds |
|---|---|---|---|
| Red (**Memo**) | Relays, tubes, cards | **Transcription**: records → tokens by burner keypunch; logic boards; steam power | Records, Token, Logic board, Keypunch, Seminar, Memo |
| Green (**Report**) | Transistors, magnetic storage | **Semiconductors and storage**: quartz → silicon (first use: the 1954 silicon solar cell), steel, engines, drives and data lines (the carrier and the line the next tier needs), trains, threshold logic | Silicon, Steel, Engine unit, Drive, Data line, Data lake, Solar panel, combinators |
| Blue (**Article**) | Integrated circuits, lithography, networks | **Fab**: coal chemistry → acid → wafers → processors → accelerators. **Data**: exchanges → crawler → data refinery → data plant → datasets and benchmarks. **Learning**: trainer → checkpoints → first controllers. **Planning agents** | Sulfur, Sulfuric acid, Lubricant, Wafer, Processor, Accelerator, Crawl, Prose, Dataset, Benchmark, Checkpoint, Coprocessor 1, Learned/Distilled controller 1, Drone frame, Construction agent, Battery |
| Gray (**Proceedings**, optional) | Evaluation | **Robustness**: junk → adversarial sets | Adversarial set, Proceedings |
| Purple (**Preprint**) | Microprocessors and the web | **The web at scale**: quality filtering's three fractions and two crackings (researched with blue packs, needed in bulk from here) feed **Tokenizers** and checkpoints; Switches; modules 2 | Junk, Text, Tokenizer, Switch, modules 2, Assembling machine 3 |
| Yellow (**Model card**) | Accelerators and deep learning | **Training at scale**: checkpoints by the hundred, racks, learned agents, synthetic data, modules 3 | Rack, Logistic agent, Synthetic data, modules 3 |
| White (**System card**) | The frontier | **The run**: corpora + accelerators + racks → run shards → Frontier cluster; post-training payload; Researcher | Corpus, Run shard, Post-training payload, Researcher, Frontier cluster |

Two era items are deliberately *not* separate items: the **vacuum tube** and the **relay** are what the Logic board looks like (its sprite carries a tube), and the **punched card** is what a Token looks like. Factorio's red tier has three intermediates; a fourth would cost a belt lane and buy nothing. H's tooltips can keep the lineage.

**Data demand rises by era, more steeply than Factorio's oil.** An Article needs 17 crawl, a Preprint or Model card 148, a System card 286 (§11). This is the real history (data was not the binding input until the 2000s) and it gives the data refinery a small debut and a large old age. The blue tier's big new fluid build is the coal-and-acid fab instead.

## 4. The data refinery: data is the oil, literally

### 4.1 The isomorphism (ISO, every number kept)

| Factorio | Here | Numbers |
|---|---|---|
| Crude oil field | **Exchange** at a town | 10/s per pump at 100%; floor 20% |
| Pumpjack (3×3, 90 kW, 2 slots) | **Crawler** | ISO |
| Oil refinery (5×5, 420 kW, speed 1, 3 slots) | **Data refinery** | ISO |
| Basic oil processing | **Deduplication**: 100 crawl → 45 prose (5 s) | ISO |
| Advanced oil processing | **Quality filtering**: 100 crawl + 50 water → 25 junk + 45 text + 55 prose (5 s) | ISO |
| Coal liquefaction | **Synthetic data**: 1 checkpoint (returned) + 10 tokens + 25 junk + 50 water → 90 junk + 20 text + 10 prose (5 s) | ISO + catalyst |
| Heavy oil cracking | **Denoising**: 40 junk + 30 water → 30 text (2 s) | ISO |
| Light oil cracking | **Rephrasing**: 30 text + 30 water → 20 prose (2 s) | ISO |
| Chemical plant (3×3, 210 kW, 3 slots) | **Data plant** | ISO |
| Plastic bar: 20 gas + 1 coal → 2 | **Dataset**: 20 prose + 1 token → 2 (1 s) | ISO |
| Sulfur: 30 gas + 30 water → 2 | **Benchmark**: 30 prose + 30 water → 2 (1 s) | ISO |
| Lubricant (heavy oil's direct use) | **Adversarial set**: 10 junk → 1 (junk's direct use) | BEND: a solid |
| Solid fuel → rocket fuel | **Corpus**: 10 datasets + 10 text → 1 (15 s) | ISO shape |
| Barrel, fluid wagon | **Drive**, **Data wagon** | ISO |
| Pipe, pipe to ground, pump, storage tank | **Data line, underground line, repeater, Data lake** | ISO |

**Why the fractions are quality grades.** Cracking must turn the least useful fraction into the most demanded one. In a crawl, that is literally what modern pipelines do: low-quality text is denoised into usable text, and usable text is rephrased into clean prose (rephrasing the web). The most-demanded fraction is the one that feeds datasets and benchmarks, so basic processing, like Factorio's, keeps only Prose and throws the rest away.

**What the numbers say without a word of text.** Synthetic data takes 25 junk and returns 90: generated data is mostly junk, and making it needs junk to start with. The player discovers model collapse in the production statistics.

### 4.2 Ratios a veteran already knows

- **20 data refineries : 5 denoisers : 17 rephrasers** turns everything into Prose, exactly as 20 : 5 : 17 does in Factorio. 1 refinery on quality filtering + full cracking yields 19.5 prose/s from 20 crawl/s.
- 1 crawler at 100% feeds half a refinery; at the 20% floor, a tenth.
- 1 data plant on datasets makes 2/s from 20 prose/s, like a plastic plant.

### 4.3 Worked examples

- **60 Articles/min** need 0.5 benchmark/s → 7.5 prose/s: one refinery on Deduplication (9 prose/s, fed by 2 crawlers at full yield) and a quarter of a data plant. The heavy part is the fab: 1.5 processors/s need 3 wafers/s, 30 acid/s, 3 sulfur/s and 3 coal/s, about four chemical plants. (Factorio: about four refineries and two chemical plants for the same rate.)
- **60 Model cards/min** need 2/3 checkpoint/s. At 60 s per checkpoint that is 40 trainers at speed 1, drawing 16 MW, plus 67 prose/s (≈ 68 crawl/s, seven crawlers at full yield). With four Coprocessor 3 each, 13 trainers do it at ≈ 20 MW. The yellow tier is where the factory becomes power-bound, which is the point.

### 4.4 Data lines are not pipes (BEND)

Data lines (copper first, glass later; one entity) carry Crawl, Junk, Text and Prose. Pipes carry water, steam, acid and lubricant. They use the same fluid engine, throughput, underground spans and pumps, but **a data line never connects to a pipe**, and machines show typed ports. This costs four entities (line, underground line, repeater, Data lake) and buys coherence (crawl does not flow through a water main) and legibility (you can see which network is which). The cheaper alternative, one "conduit" entity whose sprite follows its content, is available if integration wants the entity count back.

## 5. The chemistry oil used to supply: coal (BEND)

With oil's slot taken by data, Factorio's physical chemicals need a physical source. In 1945 that source was coal: coal-tar chemistry, synthetic fuels and lubricants, sulfur recovered from coal gas. So the **chemical plant (ISO)** runs a small coal chemistry:

| Factorio product | Here | Recipe |
|---|---|---|
| Sulfur (from petroleum gas) | Sulfur | 2 coal + 30 water → 2 sulfur (1 s) |
| Sulfuric acid | Sulfuric acid | ISO: 5 sulfur + 1 iron + 100 water → 50 |
| Lubricant (from heavy oil) | Lubricant | 1 coal + 10 water → 10 (1 s) |
| Plastic (in advanced circuits) | **Wafer** (recipe name: *Photolithography*) | 1 silicon + 20 acid → 2 wafers (1 s) |
| Battery, explosives | ISO | ISO |
| Plastic (in low density structure) | **Battery** in the Rack | 2 steel + 20 copper + 5 battery → 1 rack |

- **Why it is fun-neutral or better.** Coal stays important after electrification, as it does in Factorio (where it feeds plastic). The blue tier still introduces a fluid-and-solid chemistry build of the same size as Factorio's plastic-and-sulfur build. The multi-fraction balancing puzzle lives where the theme wants it: in data.
- **What is lost.** Solid fuel, rocket fuel and nuclear fuel as vehicle fuels (they were oil products). Trains and cars burn coal or wood; the frontier run has no fuel. A coal-derived solid fuel can return later if vehicle acceleration bonuses are missed.
- **Plastic is gone.** Its two jobs are taken by things the theme cares about: wafers in the chip chain and battery backup in the rack.

## 6. D4 — where compute lives

**Answer:** in module slots, in Switches and in the crafting time of the Trainer and the Frontier cluster. Never on a belt, in a pipe or on a second grid (B L11; design-space D4 options 1 and 2 combined).

| Factorio | Here | Literal meaning (B L11: modules are a machine's control electronics) |
|---|---|---|
| Speed module 1/2/3 (blue) | **Coprocessor 1/2/3** | More arithmetic for the machine: a faster control loop in a press, more FLOP/s in a trainer. Tier 3 is a tensor accelerator card |
| Productivity module 1/2/3 (orange) | **Learned controller 1/2/3** | Weights copied from a checkpoint run the machine. The trade-off is a bigger model's: more yield, slower, hungrier, hotter |
| Efficiency module 1/2/3 (green) | **Distilled controller 1/2/3** | A smaller model distilled from a teacher does the same job on less power |
| Beacon (1.5 efficiency, 1/√n, 9×9) | **Switch** | Lends its modules over an interconnect; the 1/√n falloff is communication overhead |
| Rocket silo crafting time | **Frontier cluster** crafting time | The run's compute: 4 slots plus surrounding switches |
| — | **Trainer** (new, 3×3, 400 kW, 4 slots) | Where checkpoints, controllers and logistic agents are made. Its 60 s checkpoint is "compute kept" |
| Processing unit | **Accelerator** | The chip. Mass-produced late, consumed by run shards, coprocessors 2–3, the payload and the Researcher |

- **Recipes are ISO** (5 + 5 at tier 1, 4 lower + 5 + 5 at tiers 2–3, 15/30/60 s), except that tier-1 learned and distilled controllers are made in the Trainer with a checkpoint as catalyst. So productivity and efficiency modules need the data chain (via one checkpoint) and the first trained model, but do not drain it.
- **Why not "accelerator cards as speed modules in any machine"?** B's test is right that a GPU does not speed up a gear press. A coprocessor attached to a machine's control computer is literal in both kinds of machine, and the GPU remains visible where it belongs: as the late-game bulk item, in coprocessor recipes, in every run shard and in every Researcher.
- **Alternative (B's strict split), not recommended.** Accelerators as speed modules only in computing machines (Factorio 2.0's `allowed_module_categories` supports it), controllers elsewhere. It costs three more module items and a second beacon type, and adds nothing a player would feel.
- **The RSI hook.** Learned controllers in Seminars are research productivity, exactly as productivity modules in labs are in Factorio. G can attach infinite "model scale" techs to the learned-controller effect, the way mining productivity scales drills.

## 7. D3 — talent

**People are never items, fluids, fuel or entities.** Coffee, students-as-fuel and talent pipelines all fail that test (and the first two fail the tone test).

**Recommended: B's L9 catchment.** A university staffs Seminars within commuting range, shared the way consumers share a power network (speed × min(1, supply ÷ demand)), with an overlay like power coverage. Every other machine is automation, as in Factorio. It is the cleanest version of "universities as fixed-yield wells" because the scarce thing is a coverage field, not a substance, and it gives G the non-scalable input an explosion needs.

**What production supplies for it:**
- **Seminar** demand: 1 staff-equivalent per Seminar at speed 1 (a proposal; G and B tune it).
- **Researcher** (H's name): 4 accelerators + 1 checkpoint (returned), 30 s in the Trainer. Installed in a Seminar, it supplies staff-equivalents, draws power and emits heat. The checkpoint is a catalyst, so once one good model exists the binding input is accelerators, which is true.

**Fallback if integration rejects L9:** talent stays implicit (ISO); the only scarce researcher is the player, whose hands, then blueprints, then agents are the arc.

## 8. Items and fluids

Columns: stack size; tier = the first pack tier in which the item matters; the Factorio counterpart (`mirrors`, as in SCHEMA.md); one sprite line for 32 px; a tooltip proposal in H's voice where the item is new. Building items are in §10. Seven container fills (Water / Sulfuric acid / Lubricant **barrel**; Crawl / Junk / Text / Prose **drive**) are generated by rule and not listed.

### 8.1 Resources: full spawn rules

| Resource (map) | Kind | Yields | Mining time | Finite? | Spawn rule | Mirrors |
|---|---|---|---|---|---|---|
| Iron ore | solid | Iron ore | 1 | finite | ISO: starting area yes; Factorio frequency, size and richness; richer with distance | iron-ore |
| Copper ore | solid | Copper ore | 1 | finite | ISO | copper-ore |
| Coal | solid | Coal | 1 | finite | ISO | coal |
| Quartz | solid | Quartz | 1 | finite | ISO with stone; sand-coloured patches favour coasts and dry riverbeds | stone |
| Archive | solid | Records | 1 | finite | at towns (B L3): library stacks on the town edge, 0-1 per town; plus records stores in old mines away from towns. The starting college town has one small archive. Size and richness grow with distance (bigger towns, older collections); finite | ore patch (B L3: a town library, or a records store in an old mine) |
| Uranium ore | solid | Uranium ore | 2 + 1 acid/ore | finite | ISO: never in the starting area; 1 sulfuric acid per ore | uranium-ore |
| Exchange | fluid | Crawl | – | decays to 20% floor | at towns (B L3): a telegraph office in 1945, an internet exchange later; 1-4 taps per exchange, like an oil cluster. Tappable after Information retrieval. ISO yield constants: 10/s per crawler at 100%, 300 cycles per 1% of yield, floor 20%. The floor is the town's rate of new writing and may rise with W (B L8); F's (1 - s) multiplier removes the synthetic share at the well | crude-oil |
| Water | offshore | Water | – | infinite | ISO lakes and coast | water |
| Trees | solid | Wood | 0.5 | finite | ISO forests; hand-mined; no regrowth | tree |

### 8.2 Items

#### Raw resources (7)

| Item | Stack | Tier | Mirrors | Sprite (32 px) | Tooltip (proposal) |
|---|---|---|---|---|---|
| **Wood** `wood` | 100 | red | wood | ISO: two crossed brown logs |  |
| **Coal** `coal` | 50 | red | coal | ISO: black lumps |  |
| **Iron ore** `iron-ore` | 50 | red | iron-ore | ISO: blue-grey rock chunks |  |
| **Copper ore** `copper-ore` | 50 | red | copper-ore | ISO: orange rocks with green flecks |  |
| **Quartz** `quartz` | 50 | red | stone | heap of milky-white faceted crystals, faint pink cast; the brightest raw item | Silicon dioxide. About 60% of the continental crust, by weight. |
| **Uranium ore** `uranium-ore` | 50 | blue | uranium-ore | ISO: dark rock with glowing green specks |  |
| **Records** `records` | 50 | red | iron-ore (role: a basic ore) | bundle of yellowed papers tied with a string cross; manila, soft edges | Boxes of records. Finite. |

#### Fluids (8)

| Item | Stack | Tier | Mirrors | Sprite (32 px) | Tooltip (proposal) |
|---|---|---|---|---|---|
| **Water** `water` | fluid | red | water | ISO blue |  |
| **Steam** `steam` | fluid | red | steam | ISO white |  |
| **Sulfuric acid** `sulfuric-acid` | fluid | blue | sulfuric-acid | ISO yellow-green |  |
| **Lubricant** `lubricant` | fluid | blue | lubricant | ISO green |  |
| **Crawl** `crawl` | fluid | blue | crude-oil | near-black with white static speckle | Raw. Mostly copies. |
| **Junk** `junk` | fluid | blue | heavy-oil | muddy brown-grey | Not nothing. Can be rephrased. |
| **Text** `text` | fluid | blue | light-oil | warm amber |  |
| **Prose** `prose` | fluid | blue | petroleum-gas | pale ice-cyan | Deduplicated, filtered, readable. |

#### Plates (5)

| Item | Stack | Tier | Mirrors | Sprite (32 px) | Tooltip (proposal) |
|---|---|---|---|---|---|
| **Iron plate** `iron-plate` | 100 | red | iron-plate | ISO |  |
| **Copper plate** `copper-plate` | 100 | red | copper-plate | ISO |  |
| **Steel plate** `steel-plate` | 100 | green | steel-plate | ISO |  |
| **Silicon** `silicon` | 100 | green | stone-brick (furnace slot) / plastic-bar (bulk role) | dark metallic lump with a blue-violet sheen and sharp facets | Quartz with the oxygen removed. |
| **Token** `token` | 100 | red | copper-plate (role) | short stack of cream punched cards, top-left corner cut, two rows of holes | One instance of one type. |

#### Components (14)

| Item | Stack | Tier | Mirrors | Sprite (32 px) | Tooltip (proposal) |
|---|---|---|---|---|---|
| **Iron gear wheel** `iron-gear-wheel` | 100 | red | iron-gear-wheel | ISO |  |
| **Iron stick** `iron-stick` | 100 | red | iron-stick | ISO |  |
| **Copper cable** `copper-cable` | 200 | red | copper-cable | ISO |  |
| **Logic board** `logic-board` | 200 | red | electronic-circuit | small olive-green board carrying one glass vacuum tube (orange filament glow) and three copper traces | Gates on a board. Relays, then tubes, then transistors. |
| **Wafer** `wafer` | 100 | blue | plastic-bar | iridescent silver disc etched with a fine grid, flat notch at the bottom | Silicon, polished flat to a few atoms. |
| **Processor** `processor` | 200 | blue | advanced-circuit | black chip with two rows of silver legs on a small red board | Executes stored programs. Binned by clock speed. |
| **Accelerator** `accelerator` | 100 | blue | processing-unit | square package with a gold lid, ringed by four small dark memory stacks, blue rim | Multiplies matrices. |
| **Sulfur** `sulfur` | 50 | blue | sulfur | ISO |  |
| **Battery** `battery` | 200 | blue | battery | ISO |  |
| **Explosives** `explosives` | 50 | blue | explosives | ISO |  |
| **Engine unit** `engine-unit` | 50 | green | engine-unit | ISO |  |
| **Electric engine unit** `electric-engine-unit` | 50 | blue | electric-engine-unit | ISO |  |
| **Drone frame** `drone-frame` | 50 | blue | flying-robot-frame | X-shaped quadcopter frame, four grey rotor rings, no lights | A body. Loaded with a planner or with weights. |
| **Rack** `rack` | 50 | yellow | low-density-structure | tall black cabinet, front of thin horizontal slats, one copper busbar stripe | 19 inches wide, 42 U high. Battery backup. |

#### Data products (5)

| Item | Stack | Tier | Mirrors | Sprite (32 px) | Tooltip (proposal) |
|---|---|---|---|---|---|
| **Dataset** `dataset` | 100 | blue | plastic-bar | sealed grey drive with an ice-cyan label band | Deduplicated. Smaller than what went in. |
| **Benchmark** `benchmark` | 50 | blue | sulfur | sealed manila envelope printed with a green grid of check boxes | Each use leaks a little. |
| **Adversarial set** `adversarial-set` | 50 | gray | lubricant (direct use of the heavy fraction) | manila envelope crossed by a black-and-red hazard stripe | Inputs chosen to be answered wrong. |
| **Corpus** `corpus` | 20 | white | rocket-fuel | three wide tape reels stacked, amber banding | Ten datasets, mixed. |
| **Checkpoint** `checkpoint` | 50 | blue | new (catalyst; consumed where Factorio consumes a productivity module) | grey drive with an orange hexagon label | Weights on a drive. Copying recipes return it. |

#### Modules: where compute lives (9)

| Item | Stack | Tier | Mirrors | Sprite (32 px) | Tooltip (proposal) |
|---|---|---|---|---|---|
| **Coprocessor 1** `coprocessor` | 50 | blue | speed-module | blue module card, one chevron | More arithmetic for the machine's control loop. |
| **Coprocessor 2** `coprocessor-2` | 50 | purple | speed-module-2 | blue card with heat-sink fins, two chevrons |  |
| **Coprocessor 3** `coprocessor-3` | 50 | yellow | speed-module-3 | long blue card with a fan shroud, three chevrons |  |
| **Learned controller 1** `learned-controller` | 50 | blue | productivity-module | orange module card, one chevron, small glowing hexagon | Weights copied from a checkpoint. More yield, slower, hungrier. |
| **Learned controller 2** `learned-controller-2` | 50 | purple | productivity-module-2 | orange card, two chevrons |  |
| **Learned controller 3** `learned-controller-3` | 50 | yellow | productivity-module-3 | orange card, three chevrons, hexagon with a halo |  |
| **Distilled controller 1** `distilled-controller` | 50 | blue | efficiency-module | green module card, one chevron, small hexagon | Most of the teacher at a fraction of the watts. |
| **Distilled controller 2** `distilled-controller-2` | 50 | purple | efficiency-module-2 | green card, two chevrons |  |
| **Distilled controller 3** `distilled-controller-3` | 50 | yellow | efficiency-module-3 | green card, three chevrons |  |

#### Frontier run (3)

| Item | Stack | Tier | Mirrors | Sprite (32 px) | Tooltip (proposal) |
|---|---|---|---|---|---|
| **Run shard** `run-shard` | 5 | white | rocket-part | flat translucent slab with a lattice of dots | One training step of a hundred. |
| **Post-training payload** `post-training-payload` | 1 | white | satellite | small glass cube holding an orange hexagon, gold base | Preference data and a reward model. Without it a run returns a base model and no system card. |
| **Researcher** `researcher` | 10 | white | new (hook for G and B's L9) | slim black box with a single orange hexagon and a green status lamp | Staffs a seminar. Four accelerators and a checkpoint; the checkpoint is returned. |

#### Papers (science packs) (7)

| Item | Stack | Tier | Mirrors | Sprite (32 px) | Tooltip (proposal) |
|---|---|---|---|---|---|
| **Memo** `memo` | 200 | red | automation-science-pack | typed sheet with a red header band and a carbon-copy edge | Typed, carbon-copied, filed. |
| **Report** `report` | 200 | green | logistic-science-pack | stapled report, green cover, number in the corner | Numbered, bound, mailed on request. |
| **Article** `article` | 200 | blue | chemical-science-pack | two-column page, blue header bar | Refereed. |
| **Proceedings** `proceedings` | 200 | gray | military-science-pack | grey bound volume with a red stripe | Presented once, then printed. |
| **Preprint** `preprint` | 200 | purple | production-science-pack | loose sheets with a purple vertical stamp in the left margin | Posted. Not reviewed. Cited. |
| **Model card** `model-card` | 200 | yellow | utility-science-pack | yellow card printed with a small table | States what the model was tested on. |
| **System card** `system-card` | 2000 | white | space-science-pack | white card with a grey table and no author line | Returned by a frontier run. Not written by anyone. |

#### Agents (2)

| Item | Stack | Tier | Mirrors | Sprite (32 px) | Tooltip (proposal) |
|---|---|---|---|---|---|
| **Construction agent** `construction-agent` | 50 | blue | construction-robot | drone with orange accents | Builds ghosts within range of a hub. |
| **Logistic agent** `logistic-agent` | 50 | blue | logistic-robot | drone with yellow-and-blue accents | Moves items between hub chests. |

#### Nuclear (ISO) (4)

| Item | Stack | Tier | Mirrors | Sprite (32 px) | Tooltip (proposal) |
|---|---|---|---|---|---|
| **Uranium-235** `uranium-235` | 100 | blue | uranium-235 | ISO |  |
| **Uranium-238** `uranium-238` | 100 | blue | uranium-238 | ISO |  |
| **Uranium fuel cell** `uranium-fuel-cell` | 50 | blue | uranium-fuel-cell | ISO |  |
| **Depleted uranium fuel cell** `depleted-uranium-fuel-cell` | 50 | blue | depleted-uranium-fuel-cell | ISO |  |

#### Terrain (ISO) (6)

| Item | Stack | Tier | Mirrors | Sprite (32 px) | Tooltip (proposal) |
|---|---|---|---|---|---|
| **Concrete** `concrete` | 100 | green | concrete | ISO |  |
| **Hazard concrete** `hazard-concrete` | 100 | green | hazard-concrete | ISO |  |
| **Refined concrete** `refined-concrete` | 100 | blue | refined-concrete | ISO |  |
| **Refined hazard concrete** `refined-hazard-concrete` | 100 | blue | refined-hazard-concrete | ISO |  |
| **Landfill** `landfill` | 100 | green | landfill | ISO (pale sand fill) |  |
| **Cliff explosives** `cliff-explosives` | 20 | blue | cliff-explosives | ISO |  |

#### Containers (2)

| Item | Stack | Tier | Mirrors | Sprite (32 px) | Tooltip (proposal) |
|---|---|---|---|---|---|
| **Barrel** `barrel` | 10 | green | barrel | ISO: empty steel barrel |  |
| **Drive** `drive` | 10 | green | barrel (data side) | flat grey cartridge with two visible reels, blank label | Random access. |

#### Other (1)

| Item | Stack | Tier | Mirrors | Sprite (32 px) | Tooltip (proposal) |
|---|---|---|---|---|---|
| **Repair pack** `repair-pack` | 100 | red | repair-pack | ISO |  |

## 9. Recipes

Grouped by crafting category, with the buildings that can craft it. Building recipes are in §10. Not listed: the 14 fill and empty recipes (50 units ↔ 1 barrel or drive, 0.2 s, assembler 2–3, ISO) and three **pseudo-recipes** that make Factorio's non-recipe mechanics checkable by the validator: boiler and heat exchanger (60 water → 60 steam per second), reactor (1 fuel cell → 1 depleted cell per 200 s), and the launch (100 run shards + 1 payload → 1000 System cards).

#### Smelting (furnaces) — Stone furnace, Steel furnace, Electric furnace

| Recipe | Ingredients | Products | Time (s) | Mirrors | Unlock group |
|---|---|---|---|---|---|
| Iron plate | 1 Iron ore | 1 Iron plate | 3.2 | iron-plate | start |
| Copper plate | 1 Copper ore | 1 Copper plate | 3.2 | copper-plate | start |
| Steel plate | 5 Iron plate | 1 Steel plate | 16 | steel-plate | steel-processing |
| Silicon | 1 Quartz | 1 Silicon | 3.2 | stone-brick (the 4th ore's furnace slot; 1:1 like a plate) | semiconductors |

#### Transcription (data smelters) — Keypunch, Tokenizer

| Recipe | Ingredients | Products | Time (s) | Mirrors | Unlock group |
|---|---|---|---|---|---|
| Token | 1 Records | 1 Token | 3.2 | copper-plate | start |

#### Crafting (hand, assemblers) — hand, Assembling machine 1–3

| Recipe | Ingredients | Products | Time (s) | Mirrors | Unlock group |
|---|---|---|---|---|---|
| Iron gear wheel | 2 Iron plate | 1 Iron gear wheel | 0.5 | iron-gear-wheel | start |
| Iron stick | 1 Iron plate | 2 Iron stick | 0.5 | iron-stick | start |
| Copper cable | 1 Copper plate | 2 Copper cable | 0.5 | copper-cable | start |
| Logic board | 1 Iron plate + 3 Copper cable | 1 Logic board | 0.5 | electronic-circuit | start |
| Processor | 2 Wafer + 4 Copper cable + 2 Logic board | 1 Processor | 6 | advanced-circuit | integrated-circuits |
| Engine unit | 1 Steel plate + 1 Iron gear wheel + 2 Pipe | 1 Engine unit | 10 | engine-unit | engine |
| Drone frame | 1 Electric engine unit + 2 Battery + 1 Steel plate + 3 Logic board | 1 Drone frame | 20 | flying-robot-frame | planning-agents |
| Rack | 2 Steel plate + 20 Copper plate + 5 Battery | 1 Rack | 15 | low-density-structure (5 plastic -> 5 battery) | racks |
| Construction agent | 1 Drone frame + 2 Logic board | 1 Construction agent | 0.5 | construction-robot | planning-agents |
| Repair pack | 2 Logic board + 2 Iron gear wheel | 1 Repair pack | 0.5 | repair-pack | start |
| Coprocessor 1 | 5 Processor + 5 Logic board | 1 Coprocessor 1 | 15 | speed-module | machine-learning |
| Coprocessor 2 | 4 Coprocessor 1 + 5 Processor + 5 Accelerator | 1 Coprocessor 2 | 30 | speed-module-2 | modules-2 |
| Coprocessor 3 | 4 Coprocessor 2 + 5 Processor + 5 Accelerator | 1 Coprocessor 3 | 60 | speed-module-3 | modules-3 |
| Learned controller 2 | 4 Learned controller 1 + 5 Processor + 5 Accelerator | 1 Learned controller 2 | 30 | productivity-module-2 | modules-2 |
| Learned controller 3 | 4 Learned controller 2 + 5 Processor + 5 Accelerator | 1 Learned controller 3 | 60 | productivity-module-3 | modules-3 |
| Distilled controller 2 | 4 Distilled controller 1 + 5 Processor + 5 Accelerator | 1 Distilled controller 2 | 30 | efficiency-module-2 | modules-2 |
| Distilled controller 3 | 4 Distilled controller 2 + 5 Processor + 5 Accelerator | 1 Distilled controller 3 | 60 | efficiency-module-3 | modules-3 |
| Memo | 1 Token + 1 Iron gear wheel | 1 Memo | 5 | automation-science-pack (copper plate -> token) | start |
| Report | 1 Inserter + 1 Transport belt | 1 Report | 6 | logistic-science-pack | report |
| Article | 2 Engine unit + 3 Processor + 1 Benchmark | 2 Article | 24 | chemical-science-pack (sulfur -> benchmark) | article |
| Proceedings | 1 Adversarial set + 1 Benchmark + 2 Logic board | 2 Proceedings | 10 | military-science-pack (ingredients replaced) | adversarial-examples |
| Preprint | 1 Tokenizer + 1 Checkpoint + 30 Rail | 3 Preprint | 21 | production-science-pack (productivity module -> checkpoint) | preprint |
| Model card | 2 Checkpoint + 1 Drone frame + 3 Rack | 3 Model card | 21 | utility-science-pack (2 processing unit -> 2 checkpoint) | model-card |
| Uranium fuel cell | 10 Iron plate + 1 Uranium-235 + 19 Uranium-238 | 10 Uranium fuel cell | 10 | uranium-fuel-cell | nuclear-power |
| Hazard concrete | 10 Concrete | 10 Hazard concrete | 0.25 | hazard-concrete | concrete |
| Refined hazard concrete | 10 Refined concrete | 10 Refined hazard concrete | 0.25 | refined-hazard-concrete | refined-concrete |
| Landfill | 50 Quartz | 1 Landfill | 0.5 | landfill | landfill |
| Cliff explosives | 10 Explosives + 1 Barrel + 1 Logic board | 1 Cliff explosives | 8 | cliff-explosives (grenade -> logic board) | cliff-explosives |
| Barrel | 1 Steel plate | 1 Barrel | 1 | barrel | fluid-handling |
| Drive | 1 Steel plate | 1 Drive | 1 | barrel | telecommunication |

#### Crafting with fluid (assembler 2–3) — Assembling machine 2–3

| Recipe | Ingredients | Products | Time (s) | Mirrors | Unlock group |
|---|---|---|---|---|---|
| Accelerator | 20 Logic board + 2 Processor + 5 Sulfuric acid | 1 Accelerator | 10 | processing-unit | accelerators |
| Electric engine unit | 1 Engine unit + 2 Logic board + 15 Lubricant | 1 Electric engine unit | 10 | electric-engine-unit | electric-engine |
| Concrete | 10 Quartz + 1 Iron ore + 100 Water | 10 Concrete | 10 | concrete (5 stone brick -> 10 quartz) | concrete |
| Refined concrete | 20 Concrete + 8 Iron stick + 1 Steel plate + 100 Water | 10 Refined concrete | 15 | refined-concrete | refined-concrete |

#### Chemistry (chemical plant) — Chemical plant

| Recipe | Ingredients | Products | Time (s) | Mirrors | Unlock group |
|---|---|---|---|---|---|
| Sulfur | 2 Coal + 30 Water | 2 Sulfur | 1 | sulfur (2 coal replace 30 petroleum gas) | coal-chemistry |
| Sulfuric acid | 5 Sulfur + 1 Iron plate + 100 Water | 50 Sulfuric acid | 1 | sulfuric-acid | coal-chemistry |
| Lubricant | 1 Coal + 10 Water | 10 Lubricant | 1 | lubricant (coal replaces heavy oil) | lubricant |
| Photolithography | 1 Silicon + 20 Sulfuric acid | 2 Wafer | 1 | plastic-bar (silicon + acid replace coal + gas) | integrated-circuits |
| Battery | 1 Iron plate + 1 Copper plate + 20 Sulfuric acid | 1 Battery | 4 | battery | battery |
| Explosives | 1 Sulfur + 1 Coal + 10 Water | 2 Explosives | 4 | explosives | explosives |

#### Data refining (data refinery) — Data refinery

| Recipe | Ingredients | Products | Time (s) | Mirrors | Unlock group |
|---|---|---|---|---|---|
| Deduplication | 100 Crawl | 45 Prose | 5 | basic-oil-processing | information-retrieval |
| Quality filtering | 100 Crawl + 50 Water | 25 Junk + 45 Text + 55 Prose | 5 | advanced-oil-processing | quality-filtering |
| Synthetic data | 1 Checkpoint + 10 Token + 25 Junk + 50 Water | 90 Junk + 20 Text + 10 Prose + 1 Checkpoint (returned) | 5 | coal-liquefaction (+ generator as catalyst) | synthetic-data |

#### Data processing (data plant) — Data plant

| Recipe | Ingredients | Products | Time (s) | Mirrors | Unlock group |
|---|---|---|---|---|---|
| Denoising | 40 Junk + 30 Water | 30 Text | 2 | heavy-oil-cracking | quality-filtering |
| Rephrasing | 30 Text + 30 Water | 20 Prose | 2 | light-oil-cracking | quality-filtering |
| Dataset | 20 Prose + 1 Token | 2 Dataset | 1 | plastic-bar | datasets |
| Benchmark | 30 Prose + 30 Water | 2 Benchmark | 1 | sulfur | datasets |
| Adversarial set | 10 Junk | 1 Adversarial set | 1 | lubricant (heavy fraction's direct use) | adversarial-examples |
| Corpus | 10 Dataset + 10 Text | 1 Corpus | 15 | rocket-fuel (dataset plays solid fuel) | corpora |

#### Training (trainer) — Trainer

| Recipe | Ingredients | Products | Time (s) | Mirrors | Unlock group |
|---|---|---|---|---|---|
| Checkpoint | 10 Dataset | 1 Checkpoint | 60 | new (cost is compute time and data, not material) | machine-learning |
| Post-training payload | 100 Checkpoint + 100 Benchmark + 100 Adversarial set + 100 Accelerator + 50 Corpus | 1 Post-training payload | 5 | satellite | frontier-run |
| Learned controller 1 | 1 Checkpoint + 5 Processor + 5 Logic board | 1 Learned controller 1 + 1 Checkpoint (returned) | 15 | productivity-module (+ checkpoint as catalyst) | machine-learning |
| Distilled controller 1 | 1 Checkpoint + 5 Processor + 5 Logic board | 1 Distilled controller 1 + 1 Checkpoint (returned) | 15 | efficiency-module (+ teacher as catalyst) | distillation |
| Logistic agent | 1 Checkpoint + 1 Drone frame + 2 Processor | 1 Logistic agent + 1 Checkpoint (returned) | 0.5 | logistic-robot (+ checkpoint as catalyst) | learned-agents |
| Researcher | 1 Checkpoint + 4 Accelerator | 1 Researcher + 1 Checkpoint (returned) | 30 | new (G's AI researcher) | frontier-run |

#### Centrifuging (centrifuge) — Centrifuge

| Recipe | Ingredients | Products | Time (s) | Mirrors | Unlock group |
|---|---|---|---|---|---|
| Uranium processing | 10 Uranium ore | 0.7% → 1 Uranium-235 + 99.3% → 1 Uranium-238 | 12 | uranium-processing | uranium-processing |
| Nuclear fuel reprocessing | 5 Depleted uranium fuel cell | 3 Uranium-238 | 60 | nuclear-fuel-reprocessing | kovarex |
| Kovarex enrichment process | 40 Uranium-235 + 5 Uranium-238 | 41 Uranium-235 (40 returned) + 2 Uranium-238 (returned) | 60 | kovarex-enrichment-process | kovarex |

#### Frontier run (frontier cluster) — Frontier cluster

| Recipe | Ingredients | Products | Time (s) | Mirrors | Unlock group |
|---|---|---|---|---|---|
| Run shard | 10 Accelerator + 10 Rack + 10 Corpus | 1 Run shard | 3 | rocket-part | frontier-run |

## 10. Buildings and other placeables

Speed is crafting speed (machines), mining speed (drills) or research speed (Seminar). Power is the active draw. *Emis./min* is Factorio's pollution value, kept only as a reference: under F and B (L4, L5) heat equals energy used. Every number marked with a Factorio counterpart is that entity's 2.0 value.

| Building | Type | Size | Speed | Power | Slots | Emis./min | Notes | Recipe (time) | Mirrors | Unlock |
|---|---|---|---|---|---|---|---|---|---|---|
| **Burner mining drill** | mining-drill | 2×2 | 0.25 | 150 kW burner | 0 | 12 |  | 3 Iron gear wheel + 1 Stone furnace + 3 Iron plate (2) | burner-mining-drill | start |
| **Electric mining drill** | mining-drill | 3×3 | 0.5 | 90 kW | 3 | 10 |  | 3 Logic board + 5 Iron gear wheel + 10 Iron plate (2) | electric-mining-drill | start |
| **Offshore pump** | offshore-pump | 1×2 |  | – |  |  | pumping_per_s=1200 | 3 Pipe + 2 Iron gear wheel (0.5) | offshore-pump | start |
| **Crawler** | pumpjack | 3×3 | 1 | 90 kW | 2 | 10 |  | 5 Steel plate + 10 Iron gear wheel + 5 Logic board + 10 Data line (5) | pumpjack | information-retrieval |
| **Stone furnace** | furnace | 2×2 | 1 | 90 kW burner | 0 | 2 | crafts: smelting | 5 Quartz (0.5) | stone-furnace | start |
| **Steel furnace** | furnace | 2×2 | 2 | 90 kW burner | 0 | 4 | crafts: smelting | 6 Steel plate + 10 Quartz (3) | steel-furnace | advanced-material-processing |
| **Electric furnace** | furnace | 3×3 | 2 | 180 kW | 2 | 1 | crafts: smelting | 10 Steel plate + 5 Processor + 10 Quartz (5) | electric-furnace | advanced-material-processing-2 |
| **Keypunch** | furnace | 2×2 | 1 | 90 kW burner | 0 | 2 | crafts: transcription | 2 Iron gear wheel + 3 Iron plate (0.5) | stone-furnace (data smelter) | start |
| **Tokenizer** | furnace | 3×3 | 2 | 180 kW | 2 | 1 | crafts: transcription | 10 Steel plate + 5 Processor + 10 Dataset (5) | electric-furnace (data smelter) | tokenization |
| **Assembling machine 1** | assembler | 3×3 | 0.5 | 75 kW | 0 | 4 | crafts: crafting | 3 Logic board + 5 Iron gear wheel + 9 Iron plate (0.5) | assembling-machine-1 | automation |
| **Assembling machine 2** | assembler | 3×3 | 0.75 | 150 kW | 2 | 3 | crafts: crafting/crafting-with-fluid | 2 Steel plate + 3 Logic board + 5 Iron gear wheel + 1 Assembling machine 1 (0.5) | assembling-machine-2 | automation-2 |
| **Assembling machine 3** | assembler | 3×3 | 1.25 | 375 kW | 4 | 2 | crafts: crafting/crafting-with-fluid | 4 Coprocessor 1 + 2 Assembling machine 2 (0.5) | assembling-machine-3 | automation-3 |
| **Chemical plant** | assembler | 3×3 | 1 | 210 kW | 3 | 4 | crafts: chemistry | 5 Steel plate + 5 Iron gear wheel + 5 Logic board + 5 Pipe (5) | chemical-plant | coal-chemistry |
| **Data refinery** | assembler | 5×5 | 1 | 420 kW | 3 | 6 | crafts: data-refining | 15 Steel plate + 10 Iron gear wheel + 10 Concrete + 10 Logic board + 10 Data line (8) | oil-refinery | information-retrieval |
| **Data plant** | assembler | 3×3 | 1 | 210 kW | 3 | 4 | crafts: data-processing | 5 Steel plate + 5 Iron gear wheel + 5 Logic board + 5 Data line (5) | chemical-plant (data side) | datasets |
| **Trainer** | assembler | 3×3 | 1 | 400 kW | 4 | 4 | crafts: training | 10 Steel plate + 10 Iron gear wheel + 10 Processor + 10 Copper cable (5) | centrifuge (special 3x3 maker); recipes mirror modules | machine-learning |
| **Centrifuge** | assembler | 3×3 | 1 | 350 kW | 2 | 4 | crafts: centrifuging | 100 Concrete + 50 Steel plate + 100 Processor + 100 Iron gear wheel (4) | centrifuge | uranium-processing |
| **Seminar** | lab | 3×3 | 1 | 60 kW | 2 | 0 |  | 10 Logic board + 10 Iron gear wheel + 4 Transport belt (2) | lab | start |
| **Switch** | beacon | 3×3 |  | 480 kW | 2 |  | distribution_efficiency=1.5, supply_area=9x9, profile=1/sqrt(n) | 20 Processor + 20 Logic board + 10 Steel plate + 10 Copper cable (15) | beacon | interconnect |
| **Frontier cluster** | rocket-silo | 9×9 | 1 | 3.99 MW | 4 | 0 | crafts: frontier-run/launch; parts_required=100, idle_kw=250, payload=post-training-payload, returns=1000 system-card | 1000 Steel plate + 1000 Concrete + 100 Pipe + 200 Accelerator + 200 Electric engine unit (30) | rocket-silo | frontier-run |
| **Boiler** | boiler | 3×2 |  | 1.8 MW burner |  | 30 | steam_per_s=60, temp_c=165 | 1 Stone furnace + 4 Pipe (0.5) | boiler | start |
| **Steam engine** | generator | 3×5 |  | – |  |  | max_kw=900 | 8 Iron gear wheel + 5 Pipe + 10 Iron plate (0.5) | steam-engine | start |
| **Solar panel** | solar-panel | 3×3 |  | – |  |  | peak_kw=60 | 5 Steel plate + 15 Logic board + 5 Silicon (10) | solar-panel | semiconductors |
| **Accumulator** | accumulator | 2×2 |  | – |  |  | capacity_mj=5, flow_kw=300 | 2 Iron plate + 5 Battery (10) | accumulator | battery |
| **Nuclear reactor** | reactor | 5×5 |  | 40 MW burner |  |  | heat_mw=40, neighbour_bonus=+100% per adjacent active reactor | 500 Concrete + 500 Steel plate + 500 Processor + 500 Copper plate (8) | nuclear-reactor | nuclear-power |
| **Heat pipe** | heat-pipe | 1×1 |  | – |  |  |  | 10 Steel plate + 20 Copper plate (1) | heat-pipe | nuclear-power |
| **Heat exchanger** | heat-exchanger | 3×2 |  | 10 MW |  |  | steam_per_s=103.09, temp_c=500 | 10 Steel plate + 100 Copper plate + 10 Pipe (3) | heat-exchanger | nuclear-power |
| **Steam turbine** | generator | 3×5 |  | – |  |  | max_kw=5820 | 50 Iron gear wheel + 50 Copper plate + 20 Pipe (3) | steam-turbine | nuclear-power |
| **Small electric pole** | electric-pole | 1×1 |  | – |  |  | wire_reach=7.5, supply=5x5 | 1 Wood + 2 Copper cable (0.5) → 2 | small-electric-pole | start |
| **Medium electric pole** | electric-pole | 1×1 |  | – |  |  | wire_reach=9, supply=7x7 | 4 Iron stick + 2 Steel plate + 2 Copper cable (0.5) | medium-electric-pole | electric-energy-distribution-1 |
| **Big electric pole** | electric-pole | 2×2 |  | – |  |  | wire_reach=32, supply=4x4 | 8 Iron stick + 5 Steel plate + 4 Copper cable (0.5) | big-electric-pole | electric-energy-distribution-1 |
| **Substation** | electric-pole | 2×2 |  | – |  |  | wire_reach=18, supply=18x18 | 10 Steel plate + 5 Processor + 6 Copper cable (0.5) | substation | electric-energy-distribution-2 |
| **Transport belt** | belt | 1×1 |  | – |  |  | items_per_s=15 | 1 Iron plate + 1 Iron gear wheel (0.5) → 2 | transport-belt | start |
| **Fast transport belt** | belt | 1×1 |  | – |  |  | items_per_s=30 | 5 Iron gear wheel + 1 Transport belt (0.5) | fast-transport-belt | logistics-2 |
| **Express transport belt** | belt | 1×1 |  | – |  |  | items_per_s=45 | 10 Iron gear wheel + 1 Fast transport belt + 20 Lubricant (0.5) | express-transport-belt | logistics-3 |
| **Underground belt** | underground-belt | 1×1 |  | – |  |  | max_gap=4 | 10 Iron plate + 5 Transport belt (1) → 2 | underground-belt | logistics |
| **Fast underground belt** | underground-belt | 1×1 |  | – |  |  | max_gap=6 | 40 Iron gear wheel + 2 Underground belt (2) → 2 | fast-underground-belt | logistics-2 |
| **Express underground belt** | underground-belt | 1×1 |  | – |  |  | max_gap=8 | 80 Iron gear wheel + 2 Fast underground belt + 40 Lubricant (2) → 2 | express-underground-belt | logistics-3 |
| **Splitter** | splitter | 2×1 |  | – |  |  |  | 5 Logic board + 5 Iron plate + 4 Transport belt (1) | splitter | logistics |
| **Fast splitter** | splitter | 2×1 |  | – |  |  |  | 1 Splitter + 10 Iron gear wheel + 10 Logic board (2) | fast-splitter | logistics-2 |
| **Express splitter** | splitter | 2×1 |  | – |  |  |  | 1 Fast splitter + 10 Iron gear wheel + 10 Processor + 80 Lubricant (2) | express-splitter | logistics-3 |
| **Burner inserter** | inserter | 1×1 |  | 105 kW burner |  |  |  | 1 Iron plate + 1 Iron gear wheel (0.5) | burner-inserter | start |
| **Inserter** | inserter | 1×1 |  | 13.2 kW |  |  |  | 1 Logic board + 1 Iron gear wheel + 1 Iron plate (0.5) | inserter | start |
| **Long-handed inserter** | inserter | 1×1 |  | 20 kW |  |  |  | 1 Iron gear wheel + 1 Iron plate + 1 Inserter (0.5) | long-handed-inserter | automation |
| **Fast inserter** | inserter | 1×1 |  | 46 kW |  |  |  | 2 Logic board + 2 Iron plate + 1 Inserter (0.5) | fast-inserter | fast-inserter |
| **Bulk inserter** | inserter | 1×1 |  | 132 kW |  |  |  | 15 Iron gear wheel + 15 Logic board + 1 Processor + 1 Fast inserter (0.5) | bulk-inserter | bulk-inserter |
| **Wooden chest** | chest | 1×1 |  | – |  |  | slots=16 | 2 Wood (0.5) | wooden-chest | start |
| **Iron chest** | chest | 1×1 |  | – |  |  | slots=32 | 8 Iron plate (0.5) | iron-chest | start |
| **Steel chest** | chest | 1×1 |  | – |  |  | slots=48 | 8 Steel plate (0.5) | steel-chest | steel-processing |
| **Active provider chest** | logistic-chest | 1×1 |  | – |  |  |  | 1 Steel chest + 3 Logic board + 1 Processor (0.5) | active-provider-chest | learned-agents |
| **Passive provider chest** | logistic-chest | 1×1 |  | – |  |  |  | 1 Steel chest + 3 Logic board + 1 Processor (0.5) | passive-provider-chest | planning-agents |
| **Storage chest** | logistic-chest | 1×1 |  | – |  |  |  | 1 Steel chest + 3 Logic board + 1 Processor (0.5) | storage-chest | planning-agents |
| **Buffer chest** | logistic-chest | 1×1 |  | – |  |  |  | 1 Steel chest + 3 Logic board + 1 Processor (0.5) | buffer-chest | learned-agents |
| **Requester chest** | logistic-chest | 1×1 |  | – |  |  |  | 1 Steel chest + 3 Logic board + 1 Processor (0.5) | requester-chest | learned-agents |
| **Pipe** | pipe | 1×1 |  | – |  |  |  | 1 Iron plate (0.5) | pipe | start |
| **Pipe to ground** | pipe-to-ground | 1×1 |  | – |  |  | max_gap=9 | 10 Pipe + 5 Iron plate (0.5) → 2 | pipe-to-ground | start |
| **Pump** | pump | 1×2 |  | 29 kW |  |  |  | 1 Engine unit + 1 Steel plate + 1 Pipe (2) | pump | fluid-handling |
| **Storage tank** | storage-tank | 3×3 |  | – |  |  | capacity=25000 | 20 Iron plate + 5 Steel plate (3) | storage-tank | fluid-handling |
| **Data line** | pipe | 1×1 |  | – |  |  |  | 1 Copper plate (0.5) | pipe (data network) | telecommunication |
| **Underground line** | pipe-to-ground | 1×1 |  | – |  |  | max_gap=9 | 10 Data line + 5 Iron plate (0.5) → 2 | pipe-to-ground (data) | telecommunication |
| **Repeater** | pump | 1×2 |  | 29 kW |  |  |  | 1 Steel plate + 2 Logic board + 1 Data line (2) | pump (data) | telecommunication |
| **Data lake** | storage-tank | 3×3 |  | – |  |  | capacity=25000 | 20 Iron plate + 5 Steel plate (3) | storage-tank (data) | telecommunication |
| **Rail** | rail | 2×2 |  | – |  |  |  | 1 Quartz + 1 Iron stick + 1 Steel plate (0.5) → 2 | rail | railway |
| **Train stop** | train-stop | 2×2 |  | – |  |  |  | 5 Logic board + 6 Iron plate + 6 Iron stick + 3 Steel plate (0.5) | train-stop | railway |
| **Rail signal** | rail-signal | 1×1 |  | – |  |  |  | 1 Logic board + 5 Iron plate (0.5) | rail-signal | railway |
| **Rail chain signal** | rail-signal | 1×1 |  | – |  |  |  | 1 Logic board + 5 Iron plate (0.5) | rail-chain-signal | railway |
| **Locomotive** | locomotive | 2×6 |  | 600 kW burner |  |  |  | 20 Engine unit + 10 Logic board + 30 Steel plate (4) | locomotive | railway |
| **Cargo wagon** | cargo-wagon | 2×6 |  | – |  |  | slots=40 | 10 Iron gear wheel + 20 Iron plate + 20 Steel plate (1) | cargo-wagon | railway |
| **Fluid wagon** | fluid-wagon | 2×6 |  | – |  |  | capacity=50000 | 10 Iron gear wheel + 16 Steel plate + 8 Pipe + 1 Storage tank (1.5) | fluid-wagon | fluid-wagon |
| **Data wagon** | fluid-wagon | 2×6 |  | – |  |  | capacity=50000 | 10 Iron gear wheel + 16 Steel plate + 8 Data line + 1 Data lake (1.5) | fluid-wagon (data) | fluid-wagon |
| **Agent hub** | roboport | 4×4 |  | 50 kW |  |  |  | 45 Steel plate + 45 Iron gear wheel + 45 Processor (5) | roboport | planning-agents |
| **Radar** | radar | 3×3 |  | 300 kW |  |  |  | 5 Logic board + 5 Iron gear wheel + 10 Iron plate (0.5) | radar | start |
| **Car** | other | 2×3 |  | 600 kW burner |  |  |  | 8 Engine unit + 20 Iron plate + 5 Steel plate (2) | car | automobilism |
| **Lamp** | lamp | 1×1 |  | 5 kW |  |  |  | 1 Logic board + 3 Copper cable + 1 Iron plate (0.5) | small-lamp | optics |
| **Threshold unit** | combinator | 1×2 |  | 1 kW |  |  |  | 5 Copper cable + 5 Logic board (0.5) | decider-combinator | circuit-network |
| **Arithmetic unit** | combinator | 1×2 |  | 1 kW |  |  |  | 5 Copper cable + 5 Logic board (0.5) | arithmetic-combinator | circuit-network |
| **Bias unit** | combinator | 1×1 |  | – |  |  |  | 5 Copper cable + 2 Logic board (0.5) | constant-combinator | circuit-network |
| **Selector unit** | combinator | 1×2 |  | 1 kW |  |  |  | 2 Processor + 5 Threshold unit (0.5) | selector-combinator | advanced-combinators |
| **Power switch** | other | 2×2 |  | – |  |  |  | 5 Iron plate + 5 Copper cable + 2 Logic board (2) | power-switch | circuit-network |
| **Programmable speaker** | other | 1×1 |  | 2 kW |  |  |  | 3 Iron plate + 4 Iron stick + 5 Copper cable + 4 Logic board (2) | programmable-speaker | circuit-network |
| **Display panel** | other | 1×1 |  | – |  |  |  | 1 Iron plate + 1 Logic board (0.5) | display-panel | circuit-network |

| New or renamed building | Sprite (icon and entity) | Tooltip (proposal) |
|---|---|---|
| **Crawler** | lattice mast over a manhole, cable bundle dropping into it | Placed on an exchange. Pulls whatever passes through. |
| **Keypunch** | desk-sized keypunch, card hopper on top, cream and steel-blue | Transcribes records into tokens, one card at a time. Burns fuel. |
| **Tokenizer** | low grey cabinet with a page-feed slot and a glowing ribbon of glyphs |  |
| **Data refinery** | squat 5x5 hall with three stacked tape towers and cooling vents; three cable outlets |  |
| **Data plant** | 3x3 cabinet block with blinking front panels and two cable ports |  |
| **Trainer** | 3x3 black cabinet with a loss-curve display that falls while working |  |
| **Seminar** | ISO | Consumes papers. Needs staff. |
| **Switch** | 3x3 switch cabinet with fan-out cables on all four sides | Lends its modules to every machine in range. Each additional switch counts for less. |
| **Frontier cluster** | 9x9 hall of racks around a central gantry; progress bar is a falling loss curve |  |
| **Data line** | flat black cable in a grey tray; a coloured stripe shows the stream |  |
| **Underground line** | cable tray dipping into a small concrete duct |  |
| **Repeater** | small grey box straddling a cable, green arrow lamp |  |
| **Data lake** | 3x3 vault of tape racks with a fill gauge |  |
| **Data wagon** | boxcar lined with drive racks |  |
| **Radar** | ISO | Surplus from a wartime laboratory. |
| **Threshold unit** | ISO | Fires when its weighted inputs cross a threshold. |
| **Bias unit** | ISO | A constant input. |

## 11. Calibration against Factorio 2.0

Raw cost per pack, computed the same way for both games (first recipe that makes each item; crude and crawl through *basic* processing, so divide both by ≈ 2.2 for full cracking). Factorio's column is computed from the 2.0 base prototypes.

| Pack | Factorio 2.0 | Here | Reading |
|---|---|---|---|
| Red | 2 iron, 1 copper | 2 iron, 1 records | Copper's red-science job goes to the archive |
| Green | 5.5 iron, 1.5 copper | identical | ISO |
| Blue | 12.0 iron, 7.5 copper, 1.5 coal, 83 crude | 12.6 iron, 7.5 copper, 3.0 coal, 1.5 quartz, **17 crawl** | The fab's acid replaces plastic; data is light in this era |
| Gray | 5.8 iron, 0.5 copper, 5 coal, 10 stone | 1.0 iron, 1.5 copper, **37 crawl** | No weapons: an evaluation pack is made of data |
| Purple | 52.5 iron, 19.2 copper, 11.7 stone, 3.3 coal, 148 crude | 48.2 iron, 8.3 copper, 6.7 quartz, 3.3 coal, 3.3 records, **148 crawl**, + 20 trainer-seconds | Crawl matches crude exactly |
| Yellow | 33.3 iron, 49.8 copper, 3.8 coal, 246 crude | 24.3 iron, 28.2 copper, 11.8 coal, 3.3 records, **148 crawl**, + 40 trainer-seconds | Checkpoints cost compute time, not processors. If round 3 wants the metal back, give the Trainer's checkpoint recipe 2 processors |
| White (per pack; a run returns 1000) | 42.5 iron, 69.3 copper, 5.0 coal, 528 crude | 44.4 iron, 69.0 copper, 14.9 coal, 5.8 records, 2.2 quartz, **286 crawl** | Metals match to 5% |

**Ratio cheat sheet (all transfer):** 3 cable : 2 logic-board assemblers. One wafer plant feeds one processor per second (as one plastic plant feeds one red circuit). Accelerator = blue circuit (10 s, 20 + 2 + 5 acid). 20 : 5 : 17 refinery : denoise : rephrase. Smelting 3.2 s, steel 16 s. Packs 5 / 6 / 24 (→2) / 10 (→2) / 21 (→3) / 21 (→3) s. Module crafts 15 / 30 / 60 s. Belts 15 / 30 / 45, inserters, poles, power: ISO. The one new rhythm is the checkpoint: **60 s in a Trainer**.

**Tuning knobs for round 3:** checkpoint time (compute share of yellow), datasets per checkpoint (data share), Benchmark yield (blue-tier data load), sulfur's coal cost (coal share), Trainer power.

## 12. Legibility rules (32 px on a belt)

1. **Two palettes.** Matter keeps Factorio's metals and board colours. Information is paper and drives: cream, manila, white sheets; grey drives with one coloured label. A belt's colour says whether it carries matter or information before you can read any icon.
2. **Families share one silhouette; type is colour, tier is one detail** (05's rule, Factorio's practice):
   - Papers: one sheet silhouette, Factorio's seven colours.
   - Modules: Factorio's card and colours (blue speed, orange productivity, green efficiency); chevrons for tier.
   - Envelopes: Benchmark (green check grid) and Adversarial set (hazard stripe).
   - Drives: blank Drive, Dataset (cyan label), Checkpoint (orange hexagon), filled drives (a band in the fluid's colour).
   - Chips: green board with a tube → black DIP chip on red board → gold-lid package ringed by memory stacks.
3. **A hexagon means weights.** It appears on the Checkpoint, both controller families, the Researcher and the payload, and nowhere else; coprocessors (hardware only) have none.
4. **Fluids.** Data runs in flat black cables with a content stripe, physical fluids in grey pipes. Data fluids copy oil's brightness order so "heavier is darker" transfers: Crawl near-black with static, Junk muddy brown, Text amber, Prose pale ice-cyan.
5. **Ore extremes.** Quartz is the brightest raw item, Silicon the darkest plate (violet sheen). Records are the only soft-edged raw item.
6. Every sprite is checked at 32 px against its belt neighbours before it is accepted.

## 13. Deviation register

| # | Change | Tag | What it buys |
|---|---|---|---|
| 1 | Quartz plays stone; silicon is its furnace product; no stone brick (recipes use quartz or concrete) | BEND | Sand → silicon → chips is the subject; quartz replaces stone instead of joining it |
| 2 | Archives (records) as a fifth basic ore, at towns | BEND | The data wall is literal depletion, and towns become destinations (B L3) |
| 3 | Exchanges at towns, decaying to the rate of new writing | BEND (placement) | Oil's decay curve with a true reading (B L8) |
| 4 | Data lines never connect to pipes | BEND | Coherence and legibility; costs four entities |
| 5 | Coal chemistry supplies sulfur, acid and lubricant | BEND | Keeps Factorio's physical chemistry without a second oil chain |
| 6 | Wafer replaces plastic in the red circuit; batteries replace plastic in the rack | BEND | The fab and the rack in the late game; plastic had no theme |
| 7 | Data smelters (Keypunch, Tokenizer): a second furnace family, two tiers | BEND | Transcription is the 1945 job and tokenization the 2015 one |
| 8 | Checkpoint item; models as catalysts (Kovarex shape) | BEND | Non-rival weights without breaking conservation (B L6); one good model makes accelerators the binding input |
| 9 | Trainer (new building) | BEND | Training is the subject's central act and deserves a building and a power bill |
| 10 | Modules named as control electronics | BEND (names only) | Literal in every machine (B L11); numbers ISO |
| 11 | Proceedings made of benchmarks and adversarial sets, so it follows blue | BEND | The military pack becomes evaluation (B, F, H) |
| 12 | Preprint and Model card consume checkpoints | BEND | Papers report trained models; data demand scales with the era |
| 13 | No weapons, ammunition, turrets or armour | BREAK (F's and B's) | No natives on this plane |
| 14 | No solid, rocket or nuclear fuel | BEND | Oil products; trains burn coal, which in 1945 they did |
| 15 | Construction agents run planners (no checkpoint); logistic agents need one | BEND | The 1970s planning robots and the 2010s learned agents both happen |

Everything else is ISO: belts, inserters, splitters, undergrounds, chests, poles, steam, solar, accumulators, nuclear, trains, signals, landfill, concrete, cliffs, repair packs, circuit network (renamed units), module and beacon numbers, the silo's 100 parts and 1000-pack return.

## 14. Hooks and open questions for other agents

- **B.** Adopted: towns host archives and exchanges; information only on carriers; copying = catalyst + blank carrier; compute is a rate; modules are control electronics; L9 staffing. Proposed numbers: 0–1 archive per town, 1–4 exchange taps.
- **E.** Appendix A is a gating skeleton, not a tree. Hard requirements: tokens and the keypunch at start; silicon and solar at green; coal chemistry, data lines and the data refinery by late green (where oil processing sits); the Trainer at blue; quality filtering at blue; Switches and Assembling machine 3 at purple; racks before yellow; the frontier run needs all five main packs.
- **F.** Heat is power (B L4/L5), so the emissions column is only Factorio's reference. Computing machines that throttle: Tokenizer, Data plant, Data refinery, Trainer, Seminar, Frontier cluster. The Keypunch is mechanical. F's (1 − s) multiplier applies to crawler output. The cooling tower is F's building.
- **G.** The Researcher recipe and its staff-equivalents. Frontier-cluster power: keep Factorio's 4 MW, or raise it (suggested 40 MW active) so the run is visibly power-bound. Infinite techs that scale learned-controller productivity are the RSI lever (§6).
- **H.** Adopted H's ladder and names. Differences, for H to rule on:
  - Assembling machine 1/2/3 kept. A Tabulator, Computer or Cluster cannot press a gear (B's bar). If an era name is wanted: Machine shop → Transfer machine → Robot cell.
  - Fractions Junk / Text / Prose, not prose / code / junk. Code has no crackable role; it can return as a second well type later.
  - Benchmark, not Label, in the sulfur slot. The held-out set is what is used up; labels are inside it.
  - Data line, not Fiber: copper first, glass later.
  - The Trainer is not the chemical-plant analog; the Data plant is.
- **I.** Typed fluid ports (pipe vs line) in entity GUIs, and "(returned)" on catalyst ingredients in recipe tooltips, as Factorio shows Kovarex.
- **Later, optional.** Quality as best-of-N with a verifier (H's tiers Standard / Selected / Verified / Audited / Reference; recycler = Verifier). A gated media archive (images and video, B L10) as a uranium-like ore in the yellow tier. Code as a second well type.

## Appendix A. Unlock-group skeleton (for E)

Only a gating skeleton that lets the validator prove every pack and recipe is reachable in order. Costs and names are placeholders; E owns the tree.

| Unlock group | Packs | Prerequisites | Unlocks |
|---|---|---|---|
| Automation `automation` | red | – | Assembling machine 1, Long-handed inserter |
| Logistics `logistics` | red | – | Underground belt, Splitter |
| Optics `optics` | red | – | Lamp |
| Fast inserter `fast-inserter` | red | automation | Fast inserter |
| Steel processing `steel-processing` | red | – | Steel plate, Steel chest |
| Report `report` | red | automation | Report |
| Transistor `semiconductors` | red, green | report, steel-processing | Silicon, Solar panel |
| Automation 2 `automation-2` | red, green | report, steel-processing | Assembling machine 2 |
| Fluid handling `fluid-handling` | red, green | report | Barrel, Pump, Storage tank |
| Engine `engine` | red, green | report, steel-processing | Engine unit |
| Logistics 2 `logistics-2` | red, green | logistics, report | Fast transport belt, Fast underground belt, Fast splitter |
| Railway `railway` | red, green | engine, logistics-2 | Rail, Train stop, Rail signal, Rail chain signal, Locomotive, Cargo wagon |
| Automobilism `automobilism` | red, green | engine | Car |
| Electric energy distribution 1 `electric-energy-distribution-1` | red, green | report, steel-processing | Medium electric pole, Big electric pole |
| Concrete `concrete` | red, green | report | Concrete, Hazard concrete |
| Landfill `landfill` | red, green | report | Landfill |
| Threshold logic `circuit-network` | red, green | report | Threshold unit, Arithmetic unit, Bias unit, Power switch, Programmable speaker, Display panel |
| Telecommunication `telecommunication` | red, green | report | Drive, Data line, Underground line, Repeater, Data lake |
| Advanced material processing `advanced-material-processing` | red, green | steel-processing, report | Steel furnace |
| Fluid wagon `fluid-wagon` | red, green | railway, fluid-handling, telecommunication | Fluid wagon, Data wagon |
| Coal chemistry `coal-chemistry` | red, green | fluid-handling | Sulfur, Sulfuric acid, Chemical plant |
| Information retrieval `information-retrieval` | red, green | telecommunication, fluid-handling, concrete | Deduplication, Crawler, Data refinery |
| Datasets `datasets` | red, green | information-retrieval | Dataset, Benchmark, Data plant |
| Integrated circuit `integrated-circuits` | red, green | semiconductors, coal-chemistry | Processor, Photolithography |
| Article `article` | red, green | integrated-circuits, datasets, engine | Article |
| Lubricant `lubricant` | red, green, blue | coal-chemistry, article | Lubricant |
| Battery `battery` | red, green, blue | coal-chemistry, article | Battery, Accumulator |
| Explosives `explosives` | red, green, blue | coal-chemistry, article | Explosives |
| Cliff explosives `cliff-explosives` | red, green, blue | explosives | Cliff explosives |
| Accelerator `accelerators` | red, green, blue | article | Accelerator |
| Machine learning `machine-learning` | red, green, blue | article | Checkpoint, Coprocessor 1, Learned controller 1, Trainer |
| Distillation `distillation` | red, green, blue | machine-learning | Distilled controller 1 |
| Electric engine `electric-engine` | red, green, blue | lubricant | Electric engine unit |
| Planning `planning-agents` | red, green, blue | electric-engine, battery, machine-learning | Drone frame, Construction agent, Passive provider chest, Storage chest, Agent hub |
| Advanced material processing 2 `advanced-material-processing-2` | red, green, blue | article, advanced-material-processing | Electric furnace |
| Electric energy distribution 2 `electric-energy-distribution-2` | red, green, blue | article, electric-energy-distribution-1 | Substation |
| Adversarial examples `adversarial-examples` | red, green, blue | article | Adversarial set, Proceedings |
| Quality filtering `quality-filtering` | red, green, blue | article, information-retrieval | Quality filtering, Denoising, Rephrasing |
| Tokenization `tokenization` | red, green, blue | article, datasets | Tokenizer |
| Preprint `preprint` | red, green, blue | tokenization, machine-learning, railway | Preprint |
| Uranium processing `uranium-processing` | red, green, blue | article, concrete | Uranium processing, Centrifuge |
| Nuclear power `nuclear-power` | red, green, blue | uranium-processing | Uranium fuel cell, Fission (reactor), Nuclear reactor, Heat pipe, Heat exchanger, Steam turbine |
| Refined concrete `refined-concrete` | red, green, blue | concrete, article | Refined concrete, Refined hazard concrete |
| Advanced combinators `advanced-combinators` | red, green, blue | circuit-network, article | Selector unit |
| Bulk inserter `bulk-inserter` | red, green, blue | fast-inserter, article | Bulk inserter |
| Learned agents `learned-agents` | red, green, blue | planning-agents, machine-learning | Logistic agent, Active provider chest, Buffer chest, Requester chest |
| Kovarex enrichment process `kovarex` | red, green, blue, purple | nuclear-power, preprint | Nuclear fuel reprocessing, Kovarex enrichment process |
| Automation 3 `automation-3` | red, green, blue, purple | preprint, machine-learning | Assembling machine 3 |
| Interconnect `interconnect` | red, green, blue, purple | preprint, accelerators | Switch |
| Modules 2 `modules-2` | red, green, blue, purple | preprint, accelerators, distillation | Coprocessor 2, Learned controller 2, Distilled controller 2 |
| Logistics 3 `logistics-3` | red, green, blue, purple | preprint, lubricant, logistics-2 | Express transport belt, Express underground belt, Express splitter |
| Racks `racks` | red, green, blue, purple | preprint, battery | Rack |
| Synthetic data `synthetic-data` | red, green, blue, purple | quality-filtering, machine-learning, preprint | Synthetic data |
| Model card `model-card` | red, green, blue, purple | racks, planning-agents, machine-learning | Model card |
| Modules 3 `modules-3` | red, green, blue, purple, yellow | modules-2, model-card | Coprocessor 3, Learned controller 3, Distilled controller 3 |
| Corpora `corpora` | red, green, blue, purple, yellow | model-card, quality-filtering | Corpus |
| Frontier run `frontier-run` | red, green, blue, purple, yellow | corpora, racks, modules-3, interconnect | Post-training payload, Run shard, Launch the run, Researcher, Frontier cluster |

## Appendix B. Validation and data

The tables in §8–§10 and Appendix A are generated from one data set in the `design/spec/data` schema. `tools/validate_spec.py` on it reports:

```
== spec: out/data
items 153, fluids 8, resources 9, recipes 162, entities 81, technologies 57
research playthrough: 57 techs reachable in 12 waves
items per tier: memo=41, report=45, article=53, proceedings=2, preprint=9, model-card=6, system-card=5
raw cost of 1 memo: iron-ore 2.0, records 1.0
raw cost of 1 report: iron-ore 5.5, copper-ore 1.5
raw cost of 1 article: water 112.5, crawl 16.7, iron-ore 12.6, copper-ore 7.5, coal 3.0, quartz 1.5
raw cost of 1 proceedings (~): crawl 36.7, water 17.5, copper-ore 1.5, iron-ore 1.0
raw cost of 1 preprint: crawl 148.1, water 116.7, iron-ore 48.2, copper-ore 8.3, quartz 6.7, coal 3.3, records 3.3
raw cost of 1 model-card: water 401.7, crawl 148.1, copper-ore 28.2, iron-ore 24.3, coal 11.8, records 3.3
raw cost of 1 system-card (~): water 538.4, crawl 286.2, copper-ore 69.0, iron-ore 44.4, coal 14.9, records 5.8, quartz 2.2
== 0 errors, 1 warnings
```

The one warning is a schema limitation (steam is consumed by engines and turbines, not by recipes). Data, generator and Factorio 2.0 reference scripts: `/tmp/claude-1002/R1-D/` (`scripts/d_items.py`, `d_recipes.py`, `d_entities.py`, `d_techs.py`, `gen.py`; YAML in `out/data/`). Factorio reference numbers were read from the 2.0 base prototypes (wube/factorio-data) and the wiki.

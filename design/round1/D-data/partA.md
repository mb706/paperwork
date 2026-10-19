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

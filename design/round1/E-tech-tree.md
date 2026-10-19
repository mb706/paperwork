# R1-E — Research system and technology tree (draft)

*Round 1, agent E. Factorio reference: 2.0.77 base (196 technologies) plus the quality mod (6), so 202 in all, extracted from `wube/factorio-data`. Space Age (SA) figures are used where marked. Round-1 inputs: C (years, field line), H (names, voice, packs), F (heat and runaways; the 17:00 revision), B (ontology), I (technology screen), and G's figures (G-endgame.md was not yet written). D (production) had not appeared, so item names here are provisional; they are listed in Appendix A, where integration can rename them mechanically.*

## 0. Summary

- **240 technologies**: 7 triggers, 1 start node, 216 finite and 16 infinite. Of these:
  - All 202 Factorio technologies are mirrored one to one, with cost, prerequisites and unlock slots copied from 2.0's data.
  - 38 are new (BEND).
  - A few mirrored ones in Branch M change content, also tagged BEND: the flamethrower's slot holds the *Reference monitor*, because with the crawl as text no fluid burns.
  - *Model generation 1–20* counts as one technology with 20 levels.
- **Pacing.**
  - The path to the first frontier run (Factorio: the first rocket launch) is 48 technologies and 235,525 lab-seconds; Factorio's is 44 and 224,425 (+4.9%).
  - The main tiers run +5% to +16% above Factorio in lab time, from F's heat technologies and the AI-specific additions; the largest is *Interpretability* in yellow.
  - Branch M (the military analog) costs 9% more, all of it from F's Arc turret line.
  - New content comes after the first run, where Factorio has only infinite research.
- **Papers** use H's publication ladder: Memo, Report, Proceedings, Article, Preprint, Model card, System card. Recipes keep Factorio's shapes. Each pack's gateway technology names the idea that opens its era: *Basic research*, *Linear programming*, *Game theory*, *Statistical learning*, *Deep learning*, *Expected utility*, and *In-context learning*.
- **Names** are concepts with citations (H §4.4), chosen so that the effect is what the term really does:
  - *Semaphores* unlock rail signals, the railway device Dijkstra named his lock after.
  - The steel axe is *Learning curve*: Wright's law is learning by doing.
  - The inserter capacity bonuses are *Batch size 1–7*.
  - The toolbelt is *Memex*.
  - Every citation is dated no later than its tier's era. So H's Literature counter, which is also C's "your year", moves with the tiers: 1955, 1998, 2011, 2018, 2023, then 2024. After that the tree is beyond the literature.
- **The RSI endgame** follows G's figures:
  - Three insights (*Chain of thought*, *Self-play*, *Test-time compute*) lead to *Automated research*. It closes the loop by unlocking Researchers and the Research halls they work in, which write System cards.
  - *Model generation 1–20* costs System cards only. Each level multiplies Researcher output by m while its cost grows by g. The defaults are m = 2.0 and g = 1.5, so the returns r = ln m / ln g = 1.71. Level 20 ends the run.
  - Conventional infinite technologies keep Factorio's r of about 0.1. Returns cross 1 when the loop closes.
  - The brakes are power, F's heat, accelerators and labs.
- **Disagreements and open calls** are in §7.

## 1. Conventions

| Item | Meaning |
|---|---|
| Pack letters | **R** Memo (red), **G** Report (green), **M** Proceedings (black), **B** Article (blue), **P** Preprint (purple), **Y** Model card (yellow), **W** System card (white). Letters follow Factorio's lab slot order |
| Cost | `count × packs · time per unit`, as Factorio shows it. Research time = count × time ÷ total lab speed |
| ★ | `essential = true`, as Factorio flags its pack technologies and the silo. I's "Show only essential" filter uses it |
| Tag | ISO: Factorio's technology, kept. BEND: changed or new. Every BEND has a note or a row in §7 |
| Mirrors | The Factorio 2.0 technology this one replaces. "—" means new |
| Definition | H's tooltip form: one clause of at most 10 words. Effects are in the Unlocks column, and the citation is printed on its own line in gray |
| Citation regime | *Cited* (historical; the year feeds the Literature counter); *—* (literal infrastructure such as Steel processing or Railway; excluded from the counter and from H's "No related work" achievement); *beyond the literature* (uncited by design; fires "No related work") |
| Codes | T (triggers), R/G/B/P/Y/W (main tree by tier), I (infinite), S (multi-level series), M· (Branch M). Integration can cite these |

Tiers are the packs a technology costs. A pack's gateway technology is researched in the previous tier, as in Factorio: *Statistical learning* costs Reports and opens Articles.

## 2. The research system

### 2.1 What research is, on one plane

| Layer | Here | Rival? | Factorio |
|---|---|---|---|
| Paper | A printed record of an experiment (B, L7): a physical document with a coloured band | Rival, consumed | Science pack |
| Seminar | A lab where papers are read and incorporated into an idea | — | Lab |
| Technology | The idea itself: researched once, applied everywhere, and retroactive | Non-rival | Technology |
| Trigger technology | An idea found by doing the work. This is Arrow's *learning by doing* (1962), which Factorio 2.0 implements as research triggers | Non-rival | Research trigger |

Consuming a paper means its content has gone into an idea (B, L6). Nobody burns it. Paper counts rise steeply because infinite technologies cost 2^L; this is the cost curve of Bloom et al. (2020), and *Research productivity* cites it.

### 2.2 Papers (science packs)

| Colour | Paper (H) | Factorio | Recipe (Factorio's shape) | Opened by | Tier, thematically | Tier, mechanically (Factorio's job) |
|---|---|---|---|---|---|---|
| Red | **Memo** | Automation | 1 Copper plate + 1 Iron gear wheel → 1, 5 s | *Basic research* (trigger: craft a Seminar) | Automatic computation, 1945–55: relay and tube machines; the internal memorandum | The bootstrap pack, hand-craftable from two plates |
| Green | **Report** | Logistic | 1 Inserter + 1 Transport belt → 1, 6 s | *Linear programming* (75 R) | Programming, 1955–98: stored programs, symbolic AI, networks; the crawl arrives at the end | Forces you to automate logistics items; 1:1 with red |
| Black | **Proceedings** | Military | 1 Evaluation set + 1 AP magazine + 2 Fences → 2, 10 s (F) | *Game theory* (30 RG) | Adversarial research: containment, red-teaming and evaluation, historically military-funded and published as proceedings | The optional defence chain. Not needed for the run (ISO) |
| Blue | **Article** | Chemical | 2 Engine units + 3 Processors + 1 Label → 2, 24 s | *Statistical learning* (75 RG) | Statistical learning, 1995–2011 | The first pack that needs the crawl, through labels and processors: the big jump in chain depth |
| Purple | **Preprint** | Production | 1 Electric furnace + 1 Productivity module 1 + 30 Rails → 3, 21 s | *Deep learning* (100 RGB) | Deep learning at scale, 2006–18 | The bulk-throughput pack: steel and rail |
| Yellow | **Model card** | Utility | 3 Memory stacks + 2 Accelerators + 1 Drone frame → 3, 21 s | *Expected utility* (100 RGB) | Agents and post-training, 2018–24 | Tests the high-tech chains: accelerators, memory and frames |
| White | **System card** | Space | 1,000 per completed frontier run carrying a payload (1,500 after *Chain of thought*). After the loop closes, Research halls write them too | *In-context learning* (trigger: complete a run) | Research done by the model | First a test of the whole factory, then the substrate of the RSI loop |

**Why these recipes fit.** These are design notes; the rhymes stay out of the UI (H, P2).
- **Memo:** copper and a gear is electromechanical calculation, the Harvard Mark I and the differential analyzer.
- **Report:** a belt and an inserter are a tape and a head.
- **Linear programming:** it was invented to plan Air Force logistics, and "programming" then meant scheduling. Factorio's pack it replaces is *Logistic*.
- **Article:** processors plus labels is supervised learning.
- **Preprint:** thirty rails per three papers. Scale is mostly infrastructure.
- **Model card:** a body, compute and memory.
- **Expected utility** opens the tier Factorio calls *Utility*. **Game theory** opens *Military*.

None of this is in the UI; the expert finds it and it holds.

**Item tooltips are H's:**
- Memo: "Typed, carbon-copied, filed."
- Report: "Numbered, bound, mailed on request."
- Proceedings: "Presented once, then printed."
- Article: "Refereed."
- Preprint: "Posted. Not reviewed. Cited."
- Model card: "States what the model was tested on."
- System card: "Returned by a frontier run. Not written by anyone." This stays true after the loop closes, when the halls write them.

**The military analog, Proceedings, follows F's revised Variant A** (B's L13).
- **The adversary is a runaway**: a copy of one of your models that escapes a deployment building. Inside the base it compromises machines, and power switches, Monitors fed with Evaluation sets, rollback and air gaps clean it. Under the *Wild* preset, uncaught escapes found nests outside, and Factorio's whole military loop applies with literal names.
- **The pack** puts the grenade's slot to evaluation: 1 Evaluation set + 1 AP magazine + 2 Fences.
- **Optional, as in Factorio.** No technology on the path to the run needs Proceedings.
- **What still needs it.** Legged agents (the spidertron), the portable reactor, Powered suit 2 and the energy shields, exactly as in Factorio. Monitors (*Reference monitor*) and rollback (*Rollback recovery*) need it too: a player who deploys models will want Proceedings even under F's *Contained* preset, where there is no combat. That is the one place the pack becomes practically necessary, and it arrives with deployment (purple), not before.
- **The gateway** is *Game theory*. It reads correctly as containment, as red-teaming and as defence: all three are research against an opponent.
- **Peaceful mode** (*Off*) keeps the branch researchable but idle, as Factorio's does.

**The white analog, System card,** has two sources:
1. **Frontier runs (ISO).** The silo is the Frontier cluster; its 100 Run shards are training steps; the payload is post-training. Each completed run returns 1,000 System cards, as a satellite returns 1,000 space science packs.
2. **Research halls (BEND), from *Automated research* on.** They need no material inputs: compute is a rate (B, L11). This is the loop.

Conventional infinite technologies cost every pack, white included, as Factorio's do. The RSI line costs System cards only, so after closure it no longer depends on the material factory, apart from power, accelerators and cooling. G's whole-game figure shows exactly this: material papers drop off the critical path.

### 2.3 Labs and research buildings

| Building | Mirrors | Size | Research speed | Power | Slots | Inputs | Unlocked by | Tag |
|---|---|---|---|---|---|---|---|---|
| **Seminar** | Lab | 3×3 | 1 | 60 kW | 2 module | 7 paper slots | *Switching circuits* (trigger) | ISO. Recipe: 10 Logic boards + 10 Iron gear wheels + 4 Transport belts, 2 s |
| **Research hall** | — (G's "hall") | 7×7 (proposed) | Writes System cards. Output = Σ Researcher speed × m^gen | 5 / 8 / 12 / 16 MW by accelerator tier (G) | 4 Researcher slots | None | *Automated research* | BEND |
| Institute (optional) | Biolab (SA) | 5×5 | 2, paper drain −50% | 300 kW | 4 module | 7 paper slots | Open (not placed in this tree) | BEND, optional |

**Researcher** (item, H): 4 Accelerators + 1 Checkpoint → 1 Researcher + 1 Checkpoint, in 30 s. The checkpoint is a catalyst, in Kovarex's shape (B: "copying takes a blank carrier and returns the original"). Its speed depends on its accelerators' tier, and *Weight transplant* moves it to newer ones.

H and F place Researchers in Seminars as staff; G's figures model compute halls. The two are compatible:
- A Researcher can be both: a staff unit if B's staffing is adopted, and the worker of a Research hall.
- I put the RSI loop in halls because only there does it close through compute and power alone (§5).
- F's hollow work applies to hall output: a share *h* of the System cards they write is hollow, as long as *Interpretability* is unresearched.

### 2.4 Trigger technologies (discovery by doing)

| Code | Technology | Mirrors | Trigger | Why by doing |
|---|---|---|---|---|
| T01 | Steam power | Steam power | Craft 50 Iron plates | The grid comes before every computer |
| T02 | Switching circuits | Electronics | Craft 10 Copper plates | Copper becomes wire, and wire becomes logic |
| T03 | Basic research ★ | Automation science pack | Craft 1 Seminar | A room for reading; the first memo follows |
| T04 | Learning curve | Steel axe | Craft 50 Steel plates | Wright's law *is* learning by doing: labour per unit falls with cumulative output |
| T05 | Text categorization | Oil processing | Mine Crawl | You learn to sort the crawl only once you have some |
| T06 | Isotope separation | Uranium processing | Mine uranium ore | ISO |
| T07 | In-context learning ★ | Space science pack | Complete a frontier run carrying a Post-training payload | In-context learning was found by using a trained model, not by training it (Brown et al., 2020) |

**Rules (ISO, as I specifies):**
- "Craft" triggers count production by any producer of the force. Plates come from furnaces.
- Trigger technologies cannot be queued for lab research. Each completes when its trigger fires while it is available.

**Rejected as triggers.**
- *Scaling laws*: Kaplan et al. found them by training many models, but the silo technology is Factorio's largest single pack sink before the launch, and turning it into a trigger would gut the pacing.
- *Expert systems* as a trigger on hand-crafted items: it needs a hand-craft-only trigger type, and the joke works without it.

## 3. Eras

Eras are flavour on tiers. There is no calendar (B, L15). Years appear only as citations, plus the two counters below, which C and H defined.

| Era | Tier | Paper | Literature at tier end | Estimated hours (G's pacing) | What the era holds |
|---|---|---|---|---|---|
| Prior art | start | — | before 1945 | 0 | Boole to Shannon; the Rad Lab salvage |
| Automatic computation | Red | Memo | 1955 | 0.3 | Tabulators, relays, tubes, radar, servomechanisms |
| Programming | Green | Report | 1998 | 6.1 | Stored programs, transistors, ICs, cybernetics, symbolic AI, packet networks; the crawl at the end |
| Statistical learning | Blue | Article | 2011 | 8.3 | Statistical learning, GPUs, agents (in the 1990s sense: planning, multi-agent systems), nuclear power |
| Deep learning | Purple | Preprint | 2018 | 10.0 | Scale, attention, quantization, data parallelism |
| Agents | Yellow | Model card | 2023 | 12.0 | Instruction tuning, preference tuning, scaling laws, interpretability |
| Takeoff | White | System card | 2024, then beyond the literature | 12–14 | The loop closes |
| (Branch M) | parallel | Proceedings | — | — | Adversarial research |

**The counters.**
- **H's *Literature: YYYY*** is the latest year cited by a researched technology. It is the same scalar as **C's "your year" Y**.
- **Rule enforced by the generator:** no cited year exceeds its tier's era end, and no citation is younger than two years (H, P3). The counter therefore advances with the tiers and stops at 2024, while the tree goes on.
- **How the hours were estimated.** I used G's assumption of an exponential research rate with a 2-hour doubling, reaching the white tier at 12 hours, and placed the main tree's cumulative lab-seconds on that curve.
- **For C and G:** this curve is concave, while G's figure G8 assumes your year rises linearly from 1945 to 2023. At 6 hours this tree reads 1998 where G reads about 1984. Green covers 1955–98 because the crawl, which plays oil, comes at its end, and that discontinuity is the web arriving. If the field line should track the player, give it per-tier speeds from this table.

## 4. The technology tree

The tables below are generated from one data file. A validator checks that:
- every prerequisite exists, and there are no cycles;
- every pack a technology costs has its gateway in the prerequisite closure, Factorio's own rule;
- citation years stay within their tiers;
- all 202 Factorio technologies are covered.

Within each tier, rows are grouped by topic (science, production, logistics, data, power, heat, research, compute, quality, agents, circuits, equipment, endgame).

### 4.1 Start and triggers

| Code | Technology | Mirrors | Tag | Prerequisites | Cost | Unlocks / effect | Definition | Citation |
|---|---|---|---|---|---|---|---|---|
| T00 | **Prior art** | — | BEND | — | Researched at start | Stone furnace; Burner mining drill; Iron gear wheel; Transport belt; Burner inserter; Wooden chest; Iron chest; Smelting (iron, copper, stone brick); Archive processing (per D) | Known before the game begins. | — |
| T01 | **Steam power** | Steam power | ISO | — | Trigger: Craft 50 Iron plate | Pipe; Pipe to ground; Offshore pump; Boiler; Steam engine | Boiling water drives the generator. | — |
| T02 | **Switching circuits** | Electronics | ISO | — | Trigger: Craft 10 Copper plate | Copper cable; Logic board; Seminar; Inserter; Small electric pole | Relays and tubes compute Boolean logic. | Shannon, 1938 |
| T03 | **Basic research ★** | Automation science pack | ISO | Steam power, Switching circuits | Trigger: Craft 1 Seminar | Memo | Research performed without thought of practical ends. | Bush, 1945 |
| T04 | **Learning curve** | Steel axe | ISO | Steel processing | Trigger: Craft 50 Steel plate | Manual mining speed +100% | Unit cost falls with each doubling of output. | Wright, 1936 |
| T05 | **Text categorization** | Oil processing | ISO | Crawling | Trigger: Mine Crawl | Data refinery; Trainer; Basic refining; Solid fuel (from junk) | Documents are sorted by their statistics. | Cavnar & Trenkle, 1994 |
| T06 | **Isotope separation** | Uranium processing | ISO | In-situ leaching | Trigger: Mine uranium ore | Centrifuge; Uranium processing | Spin out the lighter isotope. | — |
| T07 | **In-context learning ★** | Space science pack | ISO | Scaling laws, Preference tuning | Trigger: Complete a frontier run carrying a Post-training payload | System card (each completed frontier run with a payload returns 1,000) | A trained model learns a task from its prompt. | Brown et al., 2020 |

### 4.2 Red: Memo (automatic computation)

| Code | Technology | Mirrors | Tag | Prerequisites | Cost | Unlocks / effect | Definition | Citation |
|---|---|---|---|---|---|---|---|---|
| R01 | **Linear programming ★** | Logistic science pack | ISO | Basic research | 75 × R · 5 s | Report | Optimize a linear objective under linear constraints. | Kantorovich, 1939; Dantzig, 1947 |
| R02 | **Artificial intelligence** | — | BEND | Basic research | 10 × R · 60 s | No effect; required by Perceptron, Expert systems, Statistical learning | Proposed as a two-month, ten-man study. | McCarthy, Minsky, Rochester & Shannon, 1955 |
| R03 | **Electric mining drill** | Electric mining drill | ISO | Basic research | 25 × R · 10 s | Electric mining drill | Drills powered from the grid. | — |
| R04 | **Maintenance** | Repair pack | ISO | Basic research | 25 × R · 10 s | Repair kit | Replace the failing part before the machine stops. | — |
| R05 | **Tabulation** | Automation | ISO | Basic research | 10 × R · 10 s | Tabulator; Long-handed inserter | Machines count and sort punched cards. | Hollerith, 1890 |
| R06 | **Steel processing** | Steel processing | ISO | Basic research | 50 × R · 5 s | Steel plate; Memory bank | Iron, refined again in the furnace. | — |
| R07 | **Radar** | Radar | ISO | Basic research | 20 × R · 10 s | Radar | Pulsed microwaves locate distant objects. | — |
| R08 | **Servomechanisms** | Fast inserter | ISO | Basic research | 30 × R · 15 s | Fast inserter | Feedback control of position and speed. | Hazen, 1934 |
| R09 | **Logistics** | Logistics | ISO | Basic research | 20 × R · 15 s | Underground belt; Splitter | Belts that cross under and divide. | — |
| R10 | **Lamp** | Lamp | ISO | Basic research | 10 × R · 15 s | Lamp | Electric light. | — |

### 4.3 Green: Report (programming)

| Code | Technology | Mirrors | Tag | Prerequisites | Cost | Unlocks / effect | Definition | Citation |
|---|---|---|---|---|---|---|---|---|
| G01 | **Statistical learning ★** | Chemical science pack | ISO | Integrated circuit, Spam filtering, Artificial intelligence | 75 × RG · 10 s | Article | Learning as estimation, with bounds on the error. | Vapnik & Chervonenkis, 1971; Vapnik, 1995 |
| G02 | **Stored program** | Automation 2 | ISO | Tabulation, Steel processing, Linear programming | 40 × RG · 15 s | Computer | Instructions are kept in memory alongside data. | von Neumann, 1945 |
| G03 | **Zone refining** | Advanced material processing | ISO | Steel processing, Linear programming | 75 × RG · 30 s | Steel furnace | A molten zone sweeps impurities to one end. | Pfann, 1952 |
| G04 | **Concrete** | Concrete | ISO | Zone refining, Stored program | 250 × RG · 30 s | Concrete; Hazard concrete; Refined concrete; Refined hazard concrete; Iron stick | Floors for heavy machines. | — |
| G05 | **Engine** | Engine | ISO | Steel processing, Linear programming | 100 × RG · 15 s | Engine unit | Pistons turn a shaft. | — |
| G06 | **Landfill** | Landfill | ISO | Linear programming | 50 × RG · 30 s | Landfill | Stone fills water. | — |
| G07 | **Explosives** | Explosives | ISO | Spam filtering | 100 × RG · 15 s | Explosives | Stored energy, released at once. | — |
| G08 | **Cliff explosives** | Cliff explosives | ISO | Explosives, Penetration testing | 200 × RG · 15 s | Cliff explosives; Cliff removal | Removes cliffs. | — |
| G09 | **Synthetics** | Plastics | ISO | Text categorization | 200 × RG · 30 s | Plastic | Made, not mined. | Rubin, 1993 |
| G10 | **Integrated circuit** | Advanced circuit | ISO | Synthetics | 200 × RG · 15 s | Processor | Many transistors on one die. | Kilby, 1958; Noyce, 1959 |
| G11 | **Logistics 2** | Logistics 2 | ISO | Logistics, Linear programming | 200 × RG · 30 s | Fast belt; Fast underground belt; Fast splitter | Belts at 30 items per second. | — |
| G12 | **Railway** | Railway | ISO | Logistics 2, Engine | 75 × RG · 30 s | Rail; Locomotive; Cargo wagon; Iron stick | Steel wheels on steel rails. | — |
| G13 | **Semaphores** | Automated rail transportation | ISO | Railway | 200 × RG · 30 s | Train stop; Rail signal; Chain signal | A signal admits one occupant at a time. | Dijkstra, 1965 |
| G14 | **Automobile** | Automobilism | ISO | Logistics 2, Engine | 100 × RG · 30 s | Car | Personal transport between outposts. | — |
| G15 | **Disk storage** | Fluid handling | ISO | Stored program, Engine | 50 × RG · 15 s | Data lake; Pump; Drive | Random-access storage on spinning platters. | Noyes & Dickinson, 1956 |
| G16 | **Fluid wagon** | Fluid wagon | ISO | Railway, Disk storage | 200 × RG · 30 s | Fluid wagon | A tank on rails. | — |
| G17 | **Batch processing** | Bulk inserter | ISO | Servomechanisms, Logistics 2, Integrated circuit | 150 × RG · 30 s | Bulk inserter; Bulk inserter capacity +1 | Collect a full load, then move it at once. | — |
| G18 | **Information theory** | Flammables | ISO | Text categorization | 50 × RG · 30 s | — | A message is a number of bits. | Shannon, 1948 |
| G19 | **Spam filtering** | Sulfur processing | ISO | Text categorization | 150 × RG · 30 s | Sulfuric acid; Label | Unwanted messages are flagged by probability. | Sahami et al., 1998 |
| G20 | **Crawling** | Oil gathering | ISO | Disk storage, Packet switching | 100 × RG · 30 s | Crawler | A program follows links and copies what it finds. | Koster, 1994 |
| G21 | **Photovoltaics** | Solar energy | ISO | Steel processing, Linear programming | 250 × RG · 30 s | Solar panel | Silicon junctions turn light into current. | Chapin, Fuller & Pearson, 1954 |
| G22 | **Rural electrification** | Electric energy distribution 1 | ISO | Steel processing, Linear programming | 120 × RG · 30 s | Medium electric pole; Big electric pole; Iron stick | The grid reaches every outpost. | — |
| G23 | **Batteries** | Battery | ISO | Spam filtering | 150 × RG · 30 s | Battery | Charge stored chemically. | — |
| G24 | **Accumulators** | Electric energy accumulators | ISO | Rural electrification, Batteries | 150 × RG · 30 s | Accumulator | Store current for the night. | — |
| G25 | **Evaporative cooling** | — | BEND | Steam power, Linear programming | 75 × RG · 30 s | Cooling tower (F: removes up to 10 MW from its chunk) | Evaporating water carries heat away. | — |
| G26 | **Citation index** | Research speed 1 | ISO | Stored program | 100 × RG · 30 s | Lab speed +20% | Papers indexed by the papers that cite them. | Garfield, 1955 |
| G27 | **Time-sharing** | Research speed 2 | ISO | Citation index | 200 × RG · 30 s | Lab speed +30% | One machine, many users at once. | Corbató, Merwin-Daggett & Daley, 1962 |
| G28 | **Expert systems** | — | BEND | Artificial intelligence, Linear programming | 100 × RG · 30 s | Hand-crafting speed +100%. Does not apply to machines. | Rules written by hand, consulted by machine. | Feigenbaum, 1977 |
| G29 | **Perceptron** | Modules | ISO | Integrated circuit, Artificial intelligence | 100 × RG · 30 s | Module slots (gateway; Weights if D defines it) | Threshold units whose weights are set by example. | Rosenblatt, 1958 |
| G30 | **Pipelining** | Speed module | ISO | Perceptron | 50 × RG · 30 s | Speed module 1 | Overlap the stages of successive instructions. | Buchholz, 1962 |
| G31 | **Backpropagation** | Productivity module | ISO | Perceptron | 50 × RG · 30 s | Productivity module 1 | Errors pass backward to set every weight. | Linnainmaa, 1970; Werbos, 1974; Rumelhart, Hinton & Williams, 1986 |
| G32 | **CMOS** | Efficiency module | ISO | Perceptron | 50 × RG · 30 s | Efficiency module 1 | Logic that draws power only when it switches. | Wanlass & Sah, 1963 |
| G33 | **Rejection sampling** | Quality module | ISO | Perceptron | 500 × RG · 30 s | Quality module 1; Quality tier Selected; Quality tier Verified | Sample, test, keep what passes. | von Neumann, 1951 |
| G34 | **Cybernetics** | Circuit network | ISO | Linear programming | 100 × RG · 15 s | Circuit wires; Arithmetic combinator; Decider combinator; Constant combinator; Power switch; Programmable speaker; Display panel; Iron stick | Control by feedback; a decider is a threshold unit. | McCulloch & Pitts, 1943; Wiener, 1948 |
| G35 | **Packet switching** | — | BEND | Cybernetics, Radar | 100 × RG · 30 s | Exchanges can be tapped (B, L3); Radars relay circuit signals to one another; Staffing radius +50% (if B's staffing is adopted) | Messages cut into packets, each routed independently. | Baran, 1964; Davies, 1966 |
| G36 | **Wearable computing** | Modular armor | ISO | Protective clothing, Integrated circuit | 100 × RG · 30 s | Modular suit | A computer worn on the body. | Thorp, 1998 |
| G37 | **Portable solar** | Solar panel equipment | ISO | Wearable computing, Photovoltaics | 100 × RG · 15 s | Portable solar panel | A solar cell for the suit. | — |
| G38 | **Night vision** | Night vision equipment | ISO | Portable solar | 50 × RG · 15 s | Night vision | Amplified starlight. | — |
| G39 | **Belt immunity** | Belt immunity equipment | ISO | Portable solar | 50 × RG · 15 s | Belt immunity equipment | Belts no longer carry you. | — |
| G40 | **Personal battery** | Battery equipment | ISO | Batteries, Portable solar | 50 × RG · 15 s | Personal battery | Stored charge for the suit. | — |
| G41 | **Memex** | Toolbelt | ISO | Linear programming | 100 × RG · 30 s | Inventory +10 slots | A desk that stores a person's records. | Bush, 1945 |

### 4.4 Blue: Article (statistical learning)

| Code | Technology | Mirrors | Tag | Prerequisites | Cost | Unlocks / effect | Definition | Citation |
|---|---|---|---|---|---|---|---|---|
| B01 | **Deep learning ★** | Production science pack | ISO | Backpropagation, Electric furnace, Railway | 100 × RGB · 30 s | Preprint | Many layers, trained end to end. | Hinton, Osindero & Teh, 2006 |
| B02 | **Expected utility ★** | Utility science pack | ISO | Mobile robotics, Accelerators, Memory wall | 100 × RGB · 30 s | Model card | Rank outcomes by probability-weighted utility. | Bernoulli, 1738; von Neumann & Morgenstern, 1944 |
| B03 | **Accelerators** | Processing unit | ISO | Statistical learning | 300 × RGB · 30 s | Accelerator | Matrix arithmetic on hardware built for graphics. | Raina, Madhavan & Ng, 2009 |
| B04 | **Memory wall** | Low density structure | ISO | Zone refining, Statistical learning | 300 × RGB · 45 s | Memory stack | Processors outpace memory; bandwidth becomes the limit. | Wulf & McKee, 1995 |
| B05 | **Electric furnace** | Advanced material processing 2 | ISO | Zone refining, Statistical learning | 250 × RGB · 30 s | Electric furnace | Smelting by electricity. | — |
| B06 | **Lubricant** | Lubricant | ISO | Paraphrase generation | 50 × RGB · 30 s | Lubricant | Less friction, less wear. | — |
| B07 | **Brushless motors** | Electric engine | ISO | Lubricant | 50 × RGB · 30 s | Electric engine unit | Commutation by electronics instead of brushes. | Wilson & Trickey, 1962 |
| B08 | **Mobile robotics** | Robotics | ISO | Brushless motors, Batteries | 75 × RGB · 30 s | Drone frame | A robot that plans its own movements. | Nilsson, 1969 |
| B09 | **Paraphrase generation** | Advanced oil processing | ISO | Statistical learning | 75 × RGB · 30 s | Advanced refining; Heavy-fraction cracking; Light-fraction cracking; Solid fuel (from code); Solid fuel (from prose) | A model rewrites text in other words. | Quirk, Brockett & Dolan, 2004 |
| B10 | **Curated corpora** | Rocket fuel | ISO | Information theory, Paraphrase generation | 300 × RGB · 45 s | Curated corpus | Data selected, cleaned and labelled for training. | Deng et al., 2009 |
| B11 | **Substations** | Electric energy distribution 2 | ISO | Rural electrification, Statistical learning | 100 × RGB · 45 s | Substation | Power for a whole block. | — |
| B12 | **In-situ leaching** | Uranium mining | ISO | Statistical learning, Concrete | 100 × RGB · 30 s | Mining with fluid | Acid pumped through the ore body dissolves the metal. | — |
| B13 | **Nuclear power** | Nuclear power | ISO | Isotope separation | 800 × RGB · 30 s | Nuclear reactor; Heat exchanger; Heat pipe; Steam turbine; Uranium fuel cell | Fission heat raises steam. | — |
| B14 | **Liquid cooling** | — | BEND | Evaporative cooling, Disk storage, Statistical learning | 150 × RGB · 30 s | Coolant fluid boxes on compute entities (tier 2+); Dry cooler; Water exchanger | Coolant carries heat from the chip to the outside. | — |
| B15 | **Web search** | Research speed 3 | ISO | Time-sharing, Statistical learning | 250 × RGB · 30 s | Lab speed +40% | Pages ranked by the links that point to them. | Brin & Page, 1998 |
| B16 | **Open-source libraries** | Research speed 4 | ISO | Web search | 500 × RGB · 30 s | Lab speed +50% | Shared, reviewed implementations of standard methods. | Pedregosa et al., 2011 |
| B17 | **Vector processing** | Speed module 2 | ISO | Pipelining, Accelerators | 75 × RGB · 30 s | Speed module 2 | One instruction applied to many operands. | Flynn, 1966 |
| B18 | **Convolution** | Productivity module 2 | ISO | Backpropagation, Accelerators | 75 × RGB · 30 s | Productivity module 2 | The same weights at every position. | Fukushima, 1980; LeCun et al., 1989 |
| B19 | **Model compression** | Efficiency module 2 | ISO | CMOS, Accelerators | 75 × RGB · 30 s | Efficiency module 2 | A small model trained on a large model's outputs. | Buciluǎ, Caruana & Niculescu-Mizil, 2006 |
| B20 | **Beam search** | Quality module 2 | ISO | Rejection sampling, Accelerators | 75 × RGB · 30 s | Quality module 2 | Keep the best few partial answers at each step. | Lowerre, 1976 |
| B21 | **Automated planning** | Construction robotics | ISO | Mobile robotics | 100 × RGB · 30 s | Agent hub; Passive provider chest; Storage chest; Construction agent; Ghosts of destroyed entities | Search for a sequence of actions that reaches a goal. | Fikes & Nilsson, 1971 |
| B22 | **Multi-agent systems** | Logistic robotics | ISO | Mobile robotics | 250 × RGB · 30 s | Agent hub; Passive provider chest; Storage chest; Logistic agent; Personal logistic requests; 30 trash slots | Agents bid for tasks and coordinate deliveries. | Smith, 1980 |
| B23 | **Personal assistant** | Personal roboport equipment | ISO | Automated planning, Portable solar | 50 × RGB · 30 s | Personal assistant | Agents that follow you and build what you mark. | Myers et al., 2007 |
| B24 | **Lateral inhibition** | Advanced combinators | ISO | Cybernetics, Statistical learning | 50 × RGB · 30 s | Selector combinator | The strongest signals suppress their neighbours. | Hartline, 1949 |
| B25 | **Powered suit** | Power armor | ISO | Wearable computing, Brushless motors, Accelerators | 200 × RGB · 30 s | Powered suit | A suit with its own motors. | — |
| B26 | **Personal battery 2** | Battery MK2 equipment | ISO | Personal battery, Memory wall, Powered suit | 100 × RGB · 30 s | Personal battery 2 | More stored charge. | — |
| B27 | **Exoskeleton** | Exoskeleton equipment | ISO | Accelerators, Brushless motors, Portable solar | 50 × RGB · 30 s | Exoskeleton | Motors that move your legs. | — |

### 4.5 Purple: Preprint (deep learning)

| Code | Technology | Mirrors | Tag | Prerequisites | Cost | Unlocks / effect | Definition | Citation |
|---|---|---|---|---|---|---|---|---|
| P01 | **Cluster computing** | Automation 3 | ISO | Pipelining, Deep learning, Brushless motors | 150 × RGBP · 60 s | Cluster | Commodity machines joined into one computer. | Sterling et al., 1995 |
| P02 | **Enrichment cascade** | Kovarex enrichment process | ISO | Deep learning, Isotope separation, Curated corpora | 1,500 × RGBP · 30 s | Enrichment cascade; Nuclear fuel | Recirculate the enriched stream. | — |
| P03 | **Fuel reprocessing** | Nuclear fuel reprocessing | ISO | Nuclear power, Deep learning | 50 × RGBP · 30 s | Fuel reprocessing | Recover uranium from spent cells. | — |
| P04 | **Logistics 3** | Logistics 3 | ISO | Deep learning, Lubricant | 300 × RGBP · 15 s | Express belt; Express underground belt; Express splitter | Belts at 45 items per second. | — |
| P05 | **Mass digitization** | Coal liquefaction | ISO | Paraphrase generation, Deep learning | 200 × RGBP · 30 s | Liquefaction | Whole libraries scanned and converted to text. | Michel et al., 2011 |
| P06 | **Automatic differentiation** | Research speed 5 | ISO | Open-source libraries, Deep learning | 500 × RGBP · 30 s | Lab speed +50% | Exact derivatives of any program, computed mechanically. | Wengert, 1964 |
| P07 | **Data parallelism** | Effect transmission | ISO | Accelerators, Deep learning | 75 × RGBP · 30 s | Switch | Many accelerators share one job; each adds less. | Dean et al., 2012 |
| P08 | **Systolic arrays** | Speed module 3 | ISO | Vector processing, Deep learning | 300 × RGBP · 60 s | Speed module 3 | Operands pulse through a grid of multiply-add cells. | Kung & Leiserson, 1978 |
| P09 | **Attention** | Productivity module 3 | ISO | Convolution, Deep learning | 300 × RGBP · 60 s | Productivity module 3 | Every token weighs every other token. | Bahdanau, Cho & Bengio, 2015; Vaswani et al., 2017 |
| P10 | **Quantization** | Efficiency module 3 | ISO | Model compression, Deep learning | 300 × RGBP · 60 s | Efficiency module 3 | Fewer bits per weight. | Jacob et al., 2018 |
| P11 | **Monte Carlo tree search** | Quality module 3 | ISO | Beam search, Deep learning | 300 × RGBP · 60 s | Quality module 3 | Simulate many continuations; expand the most promising. | Coulom, 2006; Kocsis & Szepesvári, 2006 |
| P12 | **Expert iteration** | Recycling | ISO | Deep learning, Accelerators, Concrete | 5,000 × RGBP · 15 s | Verifier | Generate, keep the best, train on it, repeat. | Anthony, Tian & Barber, 2017 |

### 4.6 Yellow: Model card (agents)

| Code | Technology | Mirrors | Tag | Prerequisites | Cost | Unlocks / effect | Definition | Citation |
|---|---|---|---|---|---|---|---|---|
| Y01 | **Synthetic detection** | — | BEND | Expected utility, Spam filtering | 300 × RGBY · 30 s | Crawlers route synthetic text as its own output (C's false-positive rate); without this it passes as curated text and lowers checkpoint quality (F) | Classifiers that flag machine-written text. | Solaiman et al., 2019 |
| Y02 | **Watermarking** | — | BEND | Synthetic detection, Instruction tuning | 300 × RGBY · 30 s | Your deployments add half as much to σ (F's Provenance) | Generated text carries a statistical signature. | Kirchenbauer et al., 2023 |
| Y03 | **Immersion cooling** | — | BEND | Liquid cooling, Expected utility, Deep learning | 500 × RGBPY · 30 s | Liquid-cooled share of compute heat 70% → 90% | The whole board sits in coolant. | — |
| Y04 | **Code generation** | Research speed 6 | ISO | Automatic differentiation, Expected utility | 500 × RGBPY · 30 s | Lab speed +60% | Models write the experiment code. | Chen et al., 2021 |
| Y05 | **Interpretability** | — | BEND | Expected utility, Attention | 1,000 × RGBPY · 60 s | Quality of model items is shown (checkpoint-type modules, Researchers, payloads, agents); before this it reads '?' and filters cannot sort by it; Hollow work no longer consumes papers (F) | Read what a trained network computes. | Olah et al., 2018 |
| Y06 | **Scalable oversight** | Epic quality | ISO | Rejection sampling, Expected utility, Deep learning, Interpretability | 5,000 × RGBPY · 60 s | Quality tier Audited | Supervise work that people cannot check directly. | Amodei et al., 2016; Irving, Christiano & Amodei, 2018 |
| Y07 | **Instruction tuning** | Logistic system | ISO | Expected utility, Multi-agent systems | 500 × RGBY · 30 s | Active provider chest; Requester chest; Buffer chest; Vehicle logistics | Models trained to follow written requests. | Wei et al., 2022 |
| Y08 | **Personal assistant 2** | Personal roboport MK2 equipment | ISO | Personal assistant, Expected utility | 250 × RGBY · 30 s | Personal assistant 2 | More agents, more range. | — |
| Y09 | **Scaling laws ★** | Rocket silo | ISO | Concrete, Curated corpora, Accumulators, Photovoltaics, Expected utility, Systolic arrays, Attention, Radar | 1,000 × RGBPY · 60 s | Frontier cluster; Run shard (dropped: cargo landing pad) | Loss falls as a power law in scale. | Kaplan et al., 2020; Hoffmann et al., 2022 |
| Y10 | **Preference tuning** | — | BEND | Scaling laws | 200 × RGBPY · 30 s | Post-training payload | Tune against a reward fitted to human comparisons. | Christiano et al., 2017; Ouyang et al., 2022 |

### 4.7 White: System card (takeoff)

**Before the loop closes.** Paid in System cards from frontier runs, plus every other pack. In G's model these are staff-bound.

| Code | Technology | Mirrors | Tag | Prerequisites | Cost | Unlocks / effect | Definition | Citation |
|---|---|---|---|---|---|---|---|---|
| W01 | **Formal verification** | Legendary quality | ISO | In-context learning, Scalable oversight | 5,000 × RGBPYW · 60 s | Quality tier Reference | A machine-checked proof that the program is correct. | Floyd, 1967; Hoare, 1969 |
| W02 | **Chain of thought** | — | BEND | In-context learning | 2,000 × RGBPYW · 60 s | System cards per frontier run +50% (1,000 → 1,500) | Intermediate steps written out before the answer. | Wei et al., 2022 |
| W03 | **Self-play** | — | BEND | In-context learning | 2,000 × RGBPYW · 60 s | Run shard productivity +20% | The model generates its own training opponents. | Samuel, 1959; Silver et al., 2017 |
| W04 | **Test-time compute** | — | BEND | Chain of thought | 3,000 × RGBPYW · 60 s | Research halls: a mode for +50% output at +100% energy | Spend compute per answer instead of per model. | Snell et al., 2024 |
| W05 | **Automated research ★** | — | BEND | Test-time compute, Self-play | 1,000 × RGBPYW · 60 s | Researcher (4 Accelerators + 1 Checkpoint → 1 Researcher + 1 Checkpoint returned); Research hall (writes System cards); Model generation | Machines do the research that improves the machines. | Good, 1965 |

**After the loop closes.** Paid in System cards only, which Research halls write. These are G's takeoff technologies.

| Code | Technology | Mirrors | Tag | Prerequisites | Cost | Unlocks / effect | Definition | Citation |
|---|---|---|---|---|---|---|---|---|
| W06 | **Fusion power** | — | BEND | Automated research, Nuclear power | 4,000 × W · 30 s | Fusion reactor; Fusion generator; Fusion power cell (Space Age numbers) | Light nuclei fused for net electric power. | beyond the literature |
| W07 | **Model generation 1–20** | — | BEND | Automated research | 1.5^(L−1)×1000 × W · 30 s (L = 1–20) | Researcher output ×m per level (m = 2.0, r = 1.71 at G's g = 1.5); Level 20 ends the run (capstone; H's run report) | The previous generation trained this one. | beyond the literature |
| W08 | **Wafer-scale integration** | — | BEND | Automated research | 2,000 × W · 30 s | Accelerator 2 (Researcher speed 3 at 8 MW per hall; G) | One chip the size of the wafer. | beyond the literature |
| W09 | **Photonic interconnect** | — | BEND | Wafer-scale integration | 8,000 × W · 30 s | Accelerator 3 (speed 8 at 12 MW per hall; G) | Light carries data between chips. | beyond the literature |
| W10 | **Reversible logic** | — | BEND | Photonic interconnect | 32,000 × W · 30 s | Accelerator 4 (speed 20 at 16 MW per hall; G) | Computation that erases nothing, so dissipates less. | beyond the literature |
| W11 | **Research scheduling** | — | BEND | Automated research | 5,000 × W · 30 s | Researchers fill the research queue ('Queued by: Researcher') | Researchers choose the next technology. | beyond the literature |
| W12 | **Weight transplant** | — | BEND | Wafer-scale integration | 5,000 × W · 30 s | Recipe: a Researcher moves to newer Accelerators; the old ones are returned | Weights move to new hardware without retraining. | beyond the literature |

**Infinite.** Model generation 21+ is the RSI line after the capstone. The rest are conventional, cost every pack, and keep r ≪ 1, as Factorio's infinite technologies do.

| Code | Technology | Mirrors | Tag | Prerequisites | Cost | Unlocks / effect | Definition | Citation |
|---|---|---|---|---|---|---|---|---|
| I01 | **Model generation 21+** | — | BEND | Model generation 1–20 | 2^(L−20)×2.2M × W · 30 s, infinite | Researcher output ×1.1 per level (r ≈ 0.14; G) | Diminishing returns again. | beyond the literature |
| I02 | **Research productivity** | — | BEND | In-context learning | 2^(L−1)×1000 × RGBPYW · 60 s, infinite | Research productivity +10% | Each idea costs more research than the last. | Bloom, Jones, Van Reenen & Webb, 2020 |
| I03 | **Self-driving labs** | — | BEND | In-context learning, Code generation | 2^(L−1)×1000 × RGBPYW · 60 s, infinite | Lab speed +20% | Experiments chosen, run and read by machine. | King et al., 2009 |
| I04 | **Process node** | — | BEND | In-context learning | 2^(L−1)×1000 × RGBPYW · 60 s, infinite | Accelerator productivity +10% | Transistors per die double; so does the fab's cost. | Moore, 1965 |
| I05 | **Algorithmic progress** | — | BEND | In-context learning | 1.5^L×2000 × RGBPYW · 60 s, infinite | Run shard productivity +10% | The same loss for less compute. | Ho et al., 2024 |
| I06 | **Thermal management** | — | BEND | Immersion cooling, In-context learning | 1.5^L×1000 × RGBPYW · 60 s, infinite | Cooling tower capacity +10% | More heat moved per tower. | — |

### 4.8 Multi-level series (main tree)

Each row is one technology. A "+" suffix marks an infinite level. Costs and effects are Factorio's, except for Dennard scaling (F, H).

| Code | Level | Mirrors | Prerequisites | Cost | Effect |
|---|---|---|---|---|---|
| S01 | **Batch size 1** | Inserter capacity bonus 1 | Batch processing | 200 × RG · 30 s | Bulk inserter capacity +1 |
| S02 | **Batch size 2** | Inserter capacity bonus 2 | Batch size 1 | 250 × RG · 30 s | Inserter capacity +1; Bulk inserter capacity +1 |
| S03 | **Batch size 3** | Inserter capacity bonus 3 | Batch size 2, Statistical learning | 250 × RGB · 30 s | Bulk inserter capacity +1 |
| S04 | **Batch size 4** | Inserter capacity bonus 4 | Batch size 3, Deep learning | 250 × RGBP · 30 s | Bulk inserter capacity +1 |
| S05 | **Batch size 5** | Inserter capacity bonus 5 | Batch size 4 | 300 × RGBP · 30 s | Bulk inserter capacity +2 |
| S06 | **Batch size 6** | Inserter capacity bonus 6 | Batch size 5 | 400 × RGBP · 30 s | Bulk inserter capacity +2 |
| S07 | **Batch size 7** | Inserter capacity bonus 7 | Batch size 6, Expected utility | 600 × RGBPY · 30 s | Inserter capacity +1; Bulk inserter capacity +2 |
| S08 | **Inference speed 1** | Worker robots speed 1 | Mobile robotics | 50 × RGB · 30 s | Agent speed +35% |
| S09 | **Inference speed 2** | Worker robots speed 2 | Inference speed 1 | 100 × RGB · 30 s | Agent speed +40% |
| S10 | **Inference speed 3** | Worker robots speed 3 | Inference speed 2, Expected utility | 150 × RGBY · 60 s | Agent speed +45% |
| S11 | **Inference speed 4** | Worker robots speed 4 | Inference speed 3 | 250 × RGBY · 60 s | Agent speed +55% |
| S12 | **Inference speed 5** | Worker robots speed 5 | Inference speed 4, Deep learning | 500 × RGBPY · 60 s | Agent speed +65% |
| S13 | **Inference speed 6+** | Worker robots speed 6 | Inference speed 5, In-context learning | 2^(L−6)×1000 × RGBPYW · 60 s, infinite | Agent speed +65% |
| S14 | **Context length 1** | Worker robots storage 1 | Mobile robotics | 200 × RGB · 30 s | Agent cargo +1 |
| S15 | **Context length 2** | Worker robots storage 2 | Context length 1, Deep learning | 300 × RGBP · 60 s | Agent cargo +1 |
| S16 | **Context length 3** | Worker robots storage 3 | Context length 2, Expected utility | 450 × RGBPY · 60 s | Agent cargo +1 |
| S17 | **Braking force 1** | Braking force 1 | Railway, Statistical learning | 100 × RGB · 30 s | Braking force +10% |
| S18 | **Braking force 2** | Braking force 2 | Braking force 1 | 200 × RGB · 30 s | Braking force +15% |
| S19 | **Braking force 3** | Braking force 3 | Braking force 2, Deep learning | 250 × RGBP · 30 s | Braking force +15% |
| S20 | **Braking force 4** | Braking force 4 | Braking force 3 | 350 × RGBP · 30 s | Braking force +15% |
| S21 | **Braking force 5** | Braking force 5 | Braking force 4 | 450 × RGBP · 35 s | Braking force +15% |
| S22 | **Braking force 6** | Braking force 6 | Braking force 5, Expected utility | 550 × RGBPY · 45 s | Braking force +15% |
| S23 | **Braking force 7** | Braking force 7 | Braking force 6 | 650 × RGBPY · 60 s | Braking force +15% |
| S24 | **Mining productivity 1** | Mining productivity 1 | Integrated circuit | 250 × RG · 60 s | Mining productivity +10% |
| S25 | **Mining productivity 2** | Mining productivity 2 | Mining productivity 1, Statistical learning | 500 × RGB · 60 s | Mining productivity +10% |
| S26 | **Mining productivity 3** | Mining productivity 3 | Mining productivity 2, Deep learning, Expected utility | 1,000 × RGBPY · 60 s | Mining productivity +10% |
| S27 | **Mining productivity 4+** | Mining productivity 4 | Mining productivity 3, In-context learning | 2500×(L − 3) × RGBPYW · 60 s, infinite | Mining productivity +10% |
| S28 | **Dennard scaling 1** | — | CMOS, Statistical learning | 100 × RGB · 30 s | Compute entities −8% energy |
| S29 | **Dennard scaling 2** | — | Dennard scaling 1 | 200 × RGB · 30 s | Compute entities −8% energy |
| S30 | **Dennard scaling 3** | — | Dennard scaling 2, Deep learning | 250 × RGBP · 30 s | Compute entities −8% energy |
| S31 | **Dennard scaling 4** | — | Dennard scaling 3 | 300 × RGBP · 30 s | Compute entities −8% energy |
| S32 | **Dennard scaling 5** | — | Dennard scaling 4 | 400 × RGBP · 30 s | Compute entities −8% energy. No further levels exist. |

### 4.9 Branch M: Proceedings (the military analog)

These follow F's revised Variant A. Runaways escape from deployment buildings, which begin at purple. Inside the base they are cleaned by power switches (*Cybernetics*), Monitors (*Reference monitor*), rollback (*Rollback recovery*) and air gaps. Under *Wild*, nests outside bring Factorio's military loop. The player carries no weapon.

**Changes against Factorio:**
- Handheld weapons and thrown capsules are dropped: pistol, SMG, shotguns, rocket launcher, handheld flamethrower, grenades and the poison and slowdown capsules.
- Rockets serve Legged agents.
- The flamethrower's slot holds the Monitor, and its damage series becomes *Monitor throughput*.
- *Military 2* becomes *Penetration testing*: AP magazines plus F's Evaluation sets, which take the grenade's slot.
- *Military 3* becomes *Rollback recovery*.
- *Military 4* becomes the gateway *Defense in depth*.
- F's Arc turret and Arc damage are added at the Preprint tier.

**Peaceful mode** (*Off*) keeps everything researchable (ISO). Equipment, Legged agents and Interceptors still work, because Interceptors are drones.

**Red**

| Code | Technology | Mirrors | Tag | Prerequisites | Cost | Unlocks / effect | Definition | Citation |
|---|---|---|---|---|---|---|---|---|
| MR01 | **Ballistics** | Military | BEND | Basic research | 10 × R · 15 s | Magazine (dropped: submachine gun, shotgun, shotgun shell) | Projectiles, aimed and fed by machine. | — |
| MR02 | **Protective clothing** | Heavy armor | ISO | Ballistics, Steel processing | 30 × R · 30 s | Heavy armor | Layers that absorb damage. | — |
| MR03 | **Fire control** | Gun turret | ISO | Basic research | 10 × R · 10 s | Gun turret | Predict where the target will be; aim there. | Wiener, 1949 |
| MR04 | **Fences** | Stone wall | ISO | Basic research | 10 × R · 10 s | Fence | A barrier around the site. | — |

**Green**

| Code | Technology | Mirrors | Tag | Prerequisites | Cost | Unlocks / effect | Definition | Citation |
|---|---|---|---|---|---|---|---|---|
| MG01 | **Game theory ★** | Military science pack | ISO | Penetration testing, Fences | 30 × RG · 15 s | Proceedings | Strategy against an opponent who strategizes back. | von Neumann, 1928 |
| MG02 | **Penetration testing** | Military 2 | BEND | Ballistics, Steel processing, Linear programming | 20 × RG · 15 s | AP magazine; Evaluation set (F: takes the grenade's slot) | Attack your own system to find what fails. | Linde, 1975 |
| MG03 | **Gates** | Gate | ISO | Fences, Penetration testing | 100 × RG · 30 s | Gate | A fence that opens. | — |
| MG04 | **Land mines** | Land mine | ISO | Explosives, Game theory | 100 × RGM · 30 s | Land mine | Charges that wait. | — |
| MG05 | **Reference monitor** | Flamethrower | BEND | Information theory, Game theory | 50 × RGM · 30 s | Monitor (dropped: flamethrower, flamethrower ammo) | A mechanism that checks every access. | Anderson, 1972 |
| MG06 | **Rocketry** | Rocketry | ISO | Explosives, Information theory, Game theory | 120 × RGM · 15 s | Rocket (dropped: rocket launcher) | Self-propelled projectiles. | — |
| MG07 | **Energy shield** | Energy shield equipment | ISO | Portable solar, Game theory | 150 × RGM · 15 s | Energy shield | A field that absorbs damage. | — |
| MG08 | **Interceptors** | Defender | BEND | Game theory | 100 × RGM · 30 s | Interceptor bay; Interceptor 1; Interceptor count +4 | Drones launched from a bay at intruders. | — |

**Blue**

| Code | Technology | Mirrors | Tag | Prerequisites | Cost | Unlocks / effect | Definition | Citation |
|---|---|---|---|---|---|---|---|---|
| MB01 | **Rollback recovery** | Military 3 | BEND | Statistical learning, Game theory | 100 × RGMB · 30 s | Rollback: consume one Checkpoint copy to clean a compromised machine at once (F) (dropped: poison capsule, slowdown capsule, combat shotgun) | Restore a saved state after a fault. | Randell, 1975 |
| MB02 | **Tank** | Tank | ISO | Automobile, Rollback recovery, Explosives | 250 × RGMB · 30 s | Tank; Cannon shell; Explosive cannon shell | An armored tracked vehicle. | — |
| MB03 | **Laser** | Laser | ISO | Batteries, Statistical learning | 100 × RGB · 30 s | — | Coherent light from stimulated emission. | Maiman, 1960 |
| MB04 | **Explosive rocketry** | Explosive rocketry | ISO | Rocketry, Rollback recovery | 100 × RGMB · 30 s | Explosive rocket | Rockets with an explosive payload. | — |
| MB05 | **Laser turret** | Laser turret | ISO | Laser, Game theory | 150 × RGMB · 30 s | Laser turret | A turret that fires on electricity. | — |
| MB06 | **Energy shield 2** | Energy shield MK2 equipment | ISO | Energy shield, Rollback recovery, Memory wall, Powered suit | 200 × RGMB · 30 s | Energy shield 2 | A stronger field. | — |
| MB07 | **Personal laser defense** | Personal laser defense equipment | ISO | Laser turret, Rollback recovery, Memory wall, Powered suit, Portable solar | 100 × RGMB · 30 s | Personal laser defense | A laser turret worn on the suit. | — |
| MB08 | **Discharge defense** | Discharge defense equipment | ISO | Laser turret, Rollback recovery, Powered suit, Portable solar | 100 × RGMB · 30 s | Discharge defense | A discharge that throws back everything nearby. | — |
| MB09 | **Interceptors 2** | Distractor | BEND | Interceptors, Rollback recovery, Laser | 200 × RGMB · 30 s | Interceptor 2 | Decoy interceptors that draw attacks. | — |

**Purple**

| Code | Technology | Mirrors | Tag | Prerequisites | Cost | Unlocks / effect | Definition | Citation |
|---|---|---|---|---|---|---|---|---|
| MP01 | **Arc turret** | — | BEND | Laser turret, Deep learning | 300 × RGMBP · 30 s | Arc turret (Space Age Tesla turret stats) | Chain lightning between targets. | — |

**Yellow**

| Code | Technology | Mirrors | Tag | Prerequisites | Cost | Unlocks / effect | Definition | Citation |
|---|---|---|---|---|---|---|---|---|
| MY01 | **Defense in depth** | Military 4 | BEND | Rollback recovery, Expected utility, Explosives | 150 × RGMBY · 45 s | — (gateway) (dropped: piercing shotgun shell, cluster grenade) | Layers, so that one failure is not the last. | — |
| MY02 | **Depleted uranium** | Uranium ammo | ISO | Isotope separation, Defense in depth, Tank | 1,000 × RGMBY · 45 s | DU magazine; DU cannon shell; Explosive DU cannon shell | Dense metal left over from enrichment. | — |
| MY03 | **Electromagnetic pulse** | Atomic bomb | BEND | Defense in depth, Enrichment cascade, Rocketry | 5,000 × RGMBPY · 45 s | EMP warhead | A burst that destroys unshielded electronics. | — |
| MY04 | **Powered suit 2** | Power armor MK2 | ISO | Powered suit, Defense in depth, Vector processing, Model compression | 400 × RGMBY · 30 s | Powered suit 2 | The largest equipment grid. | — |
| MY05 | **Portable reactor** | Fission reactor equipment | ISO | Expected utility, Powered suit, Game theory, Nuclear power | 200 × RGMBY · 30 s | Portable reactor | A fission reactor for the suit. | — |
| MY06 | **Interceptors 3** | Destroyer | BEND | Defense in depth, Interceptors 2, Pipelining | 300 × RGMBY · 30 s | Interceptor 3 | Interceptors that seek intruders out. | — |
| MY07 | **Artillery** | Artillery | ISO | Defense in depth, Tank, Concrete, Radar | 2,000 × RGMBY · 30 s | Artillery wagon; Artillery turret; Artillery shell | Guns that outrange anything that walks. | — |
| MY08 | **Embodied agents** | Spidertron | ISO | Defense in depth, Exoskeleton, Portable reactor, Rocketry, Quantization, Radar | 2,500 × RGMBPY · 30 s | Legged agent | An agent with legs, remotely directed. | Brooks, 1991 |

**Branch M series**

| Code | Level | Mirrors | Prerequisites | Cost | Effect |
|---|---|---|---|---|---|
| MS01 | **Projectile damage 1** | Physical projectile damage 1 | Ballistics | 100 × R · 30 s | Damage: magazine +10%, gun turret +10% |
| MS02 | **Projectile damage 2** | Physical projectile damage 2 | Projectile damage 1, Linear programming | 200 × RG · 30 s | Damage: magazine +10%, gun turret +10% |
| MS03 | **Projectile damage 3** | Physical projectile damage 3 | Projectile damage 2, Game theory | 300 × RGM · 60 s | Damage: magazine +20%, gun turret +20% |
| MS04 | **Projectile damage 4** | Physical projectile damage 4 | Projectile damage 3 | 400 × RGM · 60 s | Damage: magazine +20%, gun turret +20% |
| MS05 | **Projectile damage 5** | Physical projectile damage 5 | Projectile damage 4, Statistical learning | 500 × RGMB · 60 s | Damage: magazine +20%, gun turret +20%, cannon shell +90% |
| MS06 | **Projectile damage 6** | Physical projectile damage 6 | Projectile damage 5, Expected utility | 600 × RGMBY · 60 s | Damage: magazine +40%, gun turret +40%, cannon shell +130% |
| MS07 | **Projectile damage 7+** | Physical projectile damage 7 | Projectile damage 6, In-context learning | 2^(L−7)×1000 × RGMBYW · 60 s, infinite | Damage: magazine +40%, gun turret +70%, cannon shell +100% |
| MS08 | **Rate of fire 1** | Weapon shooting speed 1 | Ballistics | 100 × R · 30 s | Fire rate: magazine +10% |
| MS09 | **Rate of fire 2** | Weapon shooting speed 2 | Rate of fire 1, Linear programming | 200 × RG · 30 s | Fire rate: magazine +20% |
| MS10 | **Rate of fire 3** | Weapon shooting speed 3 | Rate of fire 2, Game theory | 300 × RGM · 60 s | Fire rate: magazine +20%, rocket +50% |
| MS11 | **Rate of fire 4** | Weapon shooting speed 4 | Rate of fire 3 | 400 × RGM · 60 s | Fire rate: magazine +30%, rocket +70% |
| MS12 | **Rate of fire 5** | Weapon shooting speed 5 | Rate of fire 4, Statistical learning | 500 × RGMB · 60 s | Fire rate: magazine +30%, cannon shell +80%, rocket +90% |
| MS13 | **Rate of fire 6** | Weapon shooting speed 6 | Rate of fire 5, Expected utility | 600 × RGMBY · 60 s | Fire rate: magazine +40%, cannon shell +150%, rocket +130% |
| MS14 | **Explosive yield 1** | Stronger explosives 1 | Penetration testing | 100 × RG · 30 s | — |
| MS15 | **Explosive yield 2** | Stronger explosives 2 | Explosive yield 1, Game theory | 200 × RGM · 30 s | Damage: land mine +20% |
| MS16 | **Explosive yield 3** | Stronger explosives 3 | Explosive yield 2, Statistical learning | 300 × RGMB · 60 s | Damage: rocket +30%, land mine +20% |
| MS17 | **Explosive yield 4** | Stronger explosives 4 | Explosive yield 3, Expected utility | 400 × RGMBY · 60 s | Damage: rocket +40%, land mine +20% |
| MS18 | **Explosive yield 5** | Stronger explosives 5 | Explosive yield 4 | 500 × RGMBY · 60 s | Damage: rocket +50%, land mine +20% |
| MS19 | **Explosive yield 6** | Stronger explosives 6 | Explosive yield 5 | 600 × RGMBY · 60 s | Damage: rocket +60%, land mine +20% |
| MS20 | **Explosive yield 7+** | Stronger explosives 7 | Explosive yield 6, In-context learning | 2^(L−7)×1000 × RGMBYW · 60 s, infinite | Damage: rocket +50%, land mine +20% |
| MS21 | **Monitor throughput 1** | Refined flammables 1 | Reference monitor | 100 × RGM · 30 s | Monitor cleaning rate +20% |
| MS22 | **Monitor throughput 2** | Refined flammables 2 | Monitor throughput 1 | 200 × RGM · 30 s | Monitor cleaning rate +20% |
| MS23 | **Monitor throughput 3** | Refined flammables 3 | Monitor throughput 2, Statistical learning | 300 × RGMB · 60 s | Monitor cleaning rate +20% |
| MS24 | **Monitor throughput 4** | Refined flammables 4 | Monitor throughput 3, Expected utility | 400 × RGMBY · 60 s | Monitor cleaning rate +30% |
| MS25 | **Monitor throughput 5** | Refined flammables 5 | Monitor throughput 4 | 500 × RGMBY · 60 s | Monitor cleaning rate +30% |
| MS26 | **Monitor throughput 6** | Refined flammables 6 | Monitor throughput 5 | 600 × RGMBY · 60 s | Monitor cleaning rate +40% |
| MS27 | **Monitor throughput 7+** | Refined flammables 7 | Monitor throughput 6, In-context learning | 2^(L−7)×1000 × RGMBYW · 60 s, infinite | Monitor cleaning rate +20% |
| MS28 | **Laser damage 1** | Laser weapons damage 1 | Laser, Game theory | 100 × RGMB · 30 s | Damage: laser +20% |
| MS29 | **Laser damage 2** | Laser weapons damage 2 | Laser damage 1 | 200 × RGMB · 30 s | Damage: laser +20% |
| MS30 | **Laser damage 3** | Laser weapons damage 3 | Laser damage 2 | 300 × RGMB · 60 s | Damage: laser +30% |
| MS31 | **Laser damage 4** | Laser weapons damage 4 | Laser damage 3 | 400 × RGMB · 60 s | Damage: laser +40% |
| MS32 | **Laser damage 5** | Laser weapons damage 5 | Laser damage 4, Expected utility | 500 × RGMBY · 60 s | Damage: laser +50%, laser beam +40% |
| MS33 | **Laser damage 6** | Laser weapons damage 6 | Laser damage 5 | 600 × RGMBY · 60 s | Damage: laser +70%, discharge +70%, laser beam +60% |
| MS34 | **Laser damage 7+** | Laser weapons damage 7 | Laser damage 6, In-context learning | 2^(L−7)×1000 × RGMBYW · 60 s, infinite | Damage: laser +70%, discharge +70%, laser beam +30% |
| MS35 | **Laser rate of fire 1** | Laser shooting speed 1 | Laser, Game theory | 50 × RGMB · 30 s | Fire rate: laser +10% |
| MS36 | **Laser rate of fire 2** | Laser shooting speed 2 | Laser rate of fire 1 | 100 × RGMB · 30 s | Fire rate: laser +20% |
| MS37 | **Laser rate of fire 3** | Laser shooting speed 3 | Laser rate of fire 2 | 200 × RGMB · 60 s | Fire rate: laser +30% |
| MS38 | **Laser rate of fire 4** | Laser shooting speed 4 | Laser rate of fire 3 | 200 × RGMB · 60 s | Fire rate: laser +30% |
| MS39 | **Laser rate of fire 5** | Laser shooting speed 5 | Laser rate of fire 4, Expected utility | 200 × RGMBY · 60 s | Fire rate: laser +40% |
| MS40 | **Laser rate of fire 6** | Laser shooting speed 6 | Laser rate of fire 5 | 350 × RGMBY · 60 s | Fire rate: laser +40% |
| MS41 | **Laser rate of fire 7** | Laser shooting speed 7 | Laser rate of fire 6 | 450 × RGMBY · 60 s | Fire rate: laser +50% |
| MS42 | **Arc damage 1** | — | Arc turret | 250 × RGMBP · 30 s | Damage: arc +30%, discharge +30% |
| MS43 | **Arc damage 2** | — | Arc damage 1, Expected utility | 500 × RGMBPY · 60 s | Damage: arc +40%, discharge +40% |
| MS44 | **Arc damage 3** | — | Arc damage 2, In-context learning | 1,000 × RGMBPYW · 60 s | Damage: arc +70%, discharge +70% |
| MS45 | **Arc damage 4+** | — | Arc damage 3 | 2^(L−3)×1000 × RGMBPYW · 60 s, infinite | Damage: arc +70%, discharge +70% |
| MS46 | **Interceptor count 1** | Follower robot count 1 | Interceptors | 100 × RGM · 30 s | Escort cap +5 |
| MS47 | **Interceptor count 2** | Follower robot count 2 | Interceptor count 1 | 200 × RGM · 30 s | Escort cap +10 |
| MS48 | **Interceptor count 3** | Follower robot count 3 | Interceptor count 2, Statistical learning | 300 × RGMB · 30 s | Escort cap +10 |
| MS49 | **Interceptor count 4** | Follower robot count 4 | Interceptor count 3, Interceptors 3 | 400 × RGMBY · 30 s | Escort cap +20 |
| MS50 | **Interceptor count 5+** | Follower robot count 5 | Interceptor count 4, In-context learning | 1000×(L−4) × RGMBPYW · 30 s, infinite | Escort cap +25 |
| MS51 | **Artillery range** | Artillery shell range 1 | Artillery, In-context learning | 2^L×1000 × RGMBYW · 60 s, infinite | Artillery range +30% |
| MS52 | **Artillery reload** | Artillery shell speed 1 | Artillery, In-context learning | 1000+3^(L−1)×1000 × RGMBYW · 60 s, infinite | Fire rate: artillery shell +100% |

## 5. Infinite technologies and the RSI endgame

### 5.1 Two kinds of infinite research

| Kind | Technologies | Cost per level | Effect per level | Returns r = ln(gain) / ln(cost growth) |
|---|---|---|---|---|
| Conventional (ISO shape) | Mining productivity 4+, Inference speed 6+, Research productivity, Self-driving labs, Process node, Algorithmic progress, Thermal management, Branch M infinites | ×2 per level. Algorithmic progress and Thermal management: ×1.5. Mining productivity: linear, as in Factorio | Additive: +10%, +20% or +65% of base | About 0.14 or less, falling with level: "ideas are getting harder to find" (Bloom et al., 2020) |
| The loop (BEND) | Model generation 1–20 | ×g = 1.5 | ×m = 2.0 on every Researcher, retroactive (copying weights is free) | 1.71 (G's default) |
| After the capstone | Model generation 21+ | ×2 | ×1.1 | about 0.14 (G) |

The regime change is the loop closing, a step the player takes, with *Automated research*:
- Before it, research is bounded by the material factory and by staff, and every infinite technology has r ≪ 1.
- After it, the halls' output compounds.
- With g/m = 0.75, each generation takes 75% of the time of the previous one, so the rest of the series totals four times the current level's time. That finite sum is the explosion.

The technology screen needs no new UI for this (H, P5). The doubling-time readout and the queue do the talking.

Time per Model generation level relative to the previous one is g / m = g^(1 − r):

| r | g / m (g = 1.5) | What it feels like |
|---|---|---|
| 0.8 | 1.08 | Each level slower: Factorio |
| 1.0 | 1.00 | Constant time per level: steady exponential growth |
| 1.71 (default) | 0.75 | Each level 25% faster; finite-time blow-up, braked only physically |
| 2.5 | 0.54 | Takeoff in minutes (G: FOOM territory) |

### 5.2 Levers this tree assumes (for G)

| Lever | Symbol | Where in the tree | Default here | Precedent | Owner |
|---|---|---|---|---|---|
| Lab speed | — | The six research-speed technologies, *Citation index* to *Code generation* (+20/30/40/50/50/60%), then *Self-driving labs* (+20% per level) | ISO 1–6 | research-speed 1–6 | ISO |
| Research productivity | — | *Research productivity* | +10% per level, cost ×2 | SA: ×1.2 per level, 120 s | G |
| Loop closure | — | *Automated research*, after *Chain of thought*, *Self-play* and *Test-time compute* | 4 white technologies before closure (G1) | — | G |
| Gain per generation | m | *Model generation 1–20* | 2.0 | — | G |
| Cost growth per generation | g | same | 1.5; base 1,000 System cards at 30 s | Factorio infinites ×2 | G |
| Overhang | N | Accelerators available for Researchers when the loop closes | the player's | — | player |
| Hardware tiers | — | *Wafer-scale integration*, *Photonic interconnect*, *Reversible logic* | Researcher speed 3 / 8 / 20 at 8 / 12 / 16 MW per hall (G) | — | G |
| Power | P | *Nuclear power*, *Photovoltaics*, *Fusion power* | Fusion at SA numbers | ISO | D, G |
| Heat | — | *Evaporative cooling*, *Liquid cooling* (+15 K on T*), *Dennard scaling 1–5*, *Immersion cooling*, *Thermal management* | F's numbers; T* falls by machine class, with accelerator halls at 25 °C | Pollution | F |
| Run output | — | *Chain of thought* (+50% System cards per run), *Self-play* (+20% run shard productivity), *Algorithmic progress* (+10% per level) | as listed | SA rocket-part productivity | G |
| Accelerator supply | — | *Process node* | +10% accelerator productivity, cost ×2 | SA processing-unit productivity | G |
| Hall mode | — | *Test-time compute* | +50% output at +100% energy | — | G |
| Hollow work, leak | h, L | F: model tier A against Oversight count O; *Interpretability* stops hollow papers being consumed; Oversight cuts the leak by 0.2 × O | F's formulas | — | F |
| Capstone | — | *Model generation* level 20 ends the run | H's run report | Rocket launch = victory | G, H |

**Model tiers and oversight, the hooks F asked for.** F's leak and hollow work use a model tier, and F's tier table has deployment begin at purple:
- **Tier 1:** *Deep learning*. Suggested home for D's first deployment building.
- **Tier 2:** *Attention*.
- **Tier 3:** *Instruction tuning*.
- **Tier 4:** *In-context learning*, the first completed run. F asks for C's held-out sets here.
- **Researchers** (*Automated research*) are tier 4 and up.
- **Oversight 1–4** are the verifier line: *Rejection sampling*, *Beam search*, *Monte Carlo tree search* and *Scalable oversight*, which are quality-module 1–3 and epic quality.
  - Verification research therefore cuts F's leak (×(1 − 0.2·O)) and hollow work.
  - Alignment stays what H wants it to be: a quality tier and a verifier, not a meter.

### 5.3 Brakes and the takeoff clock

- **Clock.** The takeoff clock starts when the first Research hall is powered, which is when the loop closes. It stops at *Model generation 20*. H's run report shows "Loop closed", "Takeoff", "Overhang at closure" and "Most-produced item".
- **The binding constraint shifts** among compute, power, cooling and labs (G2):
  - Halls draw 5–16 MW each. Every joule becomes heat in its chunk (F), and accelerator halls throttle above 25 °C (40 °C liquid-cooled).
  - Building power and cooling during takeoff is the player's job. Construction agents and blueprints make it fast.
- **Overhang.** Accelerators stockpiled before closure become Researchers at once (4 per Researcher).
- **After the capstone** returns fall back to r ≈ 0.14, and growth is power- and matter-bound (G7).
- **What the tree does not do.** It never decides whether the loop *should* be closed. There is no tax, no warning and no meter. Hollow work and F's leak term are the only costs of skipping oversight, and both are numbers on tooltips.

## 6. Pacing against Factorio

| Measure | Factorio 2.0 base + quality | Here | Difference |
|---|---|---|---|
| Technologies | 202 | 240 | +38 (all new; none dropped) |
| Trigger technologies | 7 | 7 (+1 start node) | — |
| Infinite technologies | 9 | 16 | +7 (SA levers, the RSI line, F's cooling, Arc damage) |
| Path to first launch or run: technologies | 44 | 48 | +4: *Artificial intelligence*, *Cybernetics*, *Packet switching*, *Preference tuning* |
| Path to first launch or run: lab-seconds | 224,425 | 235,525 | +4.9% |
| Path packs R / G / B / P / Y | 5,960 / 5,785 / 3,350 / 1,600 / 1,000 | 6,370 / 6,185 / 3,550 / 1,800 / 1,200 | — |
| Red (no military pack): technologies, lab-seconds | 15, 9,575 | 16, 10,175 | +6% (*Artificial intelligence*) |
| Green | 47, 175,200 | 50, 183,450 | +5% (*Expert systems*, *Packet switching*, *Evaporative cooling*) |
| Blue | 34, 204,000 | 37, 217,500 | +7% (*Liquid cooling*, *Dennard 1–2*) |
| Purple | 19, 310,500 | 22, 339,000 | +9% (*Dennard 3–5*) |
| Yellow | 13, 620,250 | 18, 719,250 | +16% (*Preference tuning*, *Interpretability*, *Immersion cooling*, the commons) |
| Military-pack technologies | 57, 1,168,800 | 61, 1,275,300 | +9% (Arc line) |
| White finite | 1 (legendary quality, 300,000) | 11 (2,460,000), plus *Model generation 1–20* | New: the takeoff. About 70% of the fixed-cost part is paid in System cards that halls write after closure |

Rows partition technologies as Factorio does: a technology belongs to the military row if it costs Proceedings, otherwise to its highest pack.

## 7. Integration notes

### 7.1 Decisions where I deviate or choose between proposals

| Topic | Decision | Why |
|---|---|---|
| Pack names | H's publication ladder; gateway technologies carry the content names | Physical nouns on belts (H, P1) and the System card punchline. The content (computation, programming, learning, scale, agents) sits in the gateways, where it is read once |
| White source | Frontier runs (ISO) plus Research halls after closure | Keeps Factorio's launch economy, and closes the loop through compute and power only (B: compute is a rate) |
| RSI structure | G's: insights before closure, then *Model generation 1–20* with a capstone, then 21+ | Matches G's simulation. My first draft raised m with post-closure insights, which made the crossing of 1 a matter of research order, not of the loop |
| Capstone name | None: it is *Model generation 20* ("Level 20 ends the run") | G calls it Superintelligence. H bans discourse words (P11, P13), and big event, small text (P5) suits a bare level number |
| Bots | Arrive at blue as in Factorio, named for the 1990s agent paradigm (*Mobile robotics*, *Automated planning*, *Multi-agent systems*); *Instruction tuning* is the logistic system | H's *Tool use* (2023) at blue would push the Literature counter to 2023 in the 2000s tier. Shakey (*Mobile robotics*) and STRIPS (*Automated planning*) are the same project, and the construction agents execute plans |
| Modules | Speed: *Pipelining*, *Vector processing*, *Systolic arrays*. Productivity: *Backpropagation*, *Convolution*, *Attention*. Efficiency: *CMOS*, *Model compression*, *Quantization*. Quality: *Rejection sampling*, *Beam search*, *Monte Carlo tree search*. Gateway: *Perceptron* | If D adopts B's "modules are controllers" (L11), the item names change and the technologies stand: tier 2–3 modules carry learned weights in both readings. *Attention* is a prerequisite of the frontier run, and *Systolic arrays* is the TPU's architecture |
| Satellite | Moved from the silo technology to *Preference tuning* (200 RGBPY, cheap) | Post-training is a separate idea from scaling. Kept cheap: +2.7% to the path |
| Networking | *Packet switching* (H) is a prerequisite of *Crawling* | B: exchanges can be tapped once networking is researched. It also gates 2.0's radar circuit relay (H) and, if B's staffing is adopted, extends the staffing radius |
| Flamethrower | Its slot holds the *Reference monitor*, and its 7 damage levels become *Monitor throughput* | Its fuel would be crawl fractions, which are text. The Monitor is F's turret-shaped prevention entity, and its ammunition is Evaluation sets. Arc turret and Arc damage are added at purple (F) |
| Branch M | Rebuilt on F's revised runaways (B, L13): *Penetration testing* (AP magazine + Evaluation set), *Rollback recovery*, *Defense in depth*, Interceptors 1–3 from a bay | Keeps Factorio's military tree shape and costs while nothing is thrown or handheld, and the prevention toolkit (switches, monitors, rollback) sits where Factorio's first defences sit |
| Dennard scaling | F's version: −8% compute energy per level, levels 1–2 blue and 3–5 purple, "No further levels exist." | F owns heat. It also lands where the history does: Dennard scaling ended as deep learning began |
| *Deduplication* | Not used in the base tree | C (Stacks) and H (a productivity technology) both want the name; the crawl's trigger is *Text categorization* |

### 7.2 Hooks and requests by agent

- **D (production).**
  - Every unlock here names a Factorio recipe slot; rename through Appendix A.
  - New items this tree assumes: Researcher (H's recipe), Research hall, Checkpoint (catalyst), Accelerator 2/3/4 (G), Post-training payload, Monitor and Evaluation set (F), Interceptor bay and Interceptors (F), the cooling buildings (F), and the Fusion reactor and generator (SA).
  - Grenades are gone, so cliff explosives need a new recipe (Factorio: 10 explosives + 1 grenade + 1 barrel).
  - The oil chain's names (*Text categorization*, *Spam filtering* → Label, *Synthetics* → Plastic, *Paraphrase generation* → cracking, *Curated corpora* → rocket fuel, *Mass digitization* → liquefaction) assume H's fractions (prose, code, junk). If D's chain differs, the technologies keep their slots.
  - The 2.0 cargo landing pad is omitted: base has no platforms.
- **F (pressure).**
  - Placed: *Evaporative cooling* (green), *Liquid cooling* (blue), *Dennard scaling 1–5* (blue/purple), *Immersion cooling* and *Thermal management* (infinite), *Synthetic detection* (routes synthetic text), *Watermarking* (F's *Provenance*), Oversight 1–4 (§5.2), *Interpretability*, *Reference monitor*, *Rollback recovery*, *Penetration testing* (Evaluation sets), *Arc turret* and *Arc damage 1–4+*.
  - *Hardware class A3/A4* and the *Off-switch* from F's first draft are gone, since F moved T* onto machine classes and dropped the override transmitter.
  - Questions for F:
    - the tank's cannon against "carries no weapon";
    - land mines;
    - the EMP warhead in the atomic bomb's slot;
    - which technology unlocks D's deployment building (suggested: *Deep learning*).
- **G (endgame).** §5.2 is the lever list.
  - Differences from G's figures:
    - *Liquid cooling* sits at blue (F), where G2 places it after Generation 1.
    - Pre-closure white papers come from frontier runs; G1 labels them "universities only". These are compatible if staffing (B) is what bounds those technologies.
    - G8's linear "your year" against this tree's concave one (§3).
  - G owns m, g, the hall numbers, the generation count and the capstone rule.
- **C (spacetime).** Years follow C's hook: each technology's citation year is its tooltip year, and beyond-the-literature technologies carry none. G gives Generations 0.5 years each for the field line; that is a display rule, not a citation. The Stacks technologies (*Error correction*, *Synthetic detection*, *Temporal split*, *Detector calibration*) belong to the expansion. *Synthetic detection* is also used in the base game here (F's commons), so C's version can be its upgrade.
- **H (tone).**
  - Adopted: Researcher, Seminar, Switch, Verifier, Data lake, the pack ladder, the quality tiers (Selected/Verified/Audited/Reference), *Artificial intelligence* (10 memos at 60 s), *Expert systems*, *Dennard scaling*, *Process node*, *Research productivity*, *Interpretability*, *Preference tuning*, *Automated research*, *Research scheduling*, *Weight transplant*, *Tabulation*, *Stored program*, *Crawling*, *Accelerators*, *Integrated circuit*, *Perceptron*, *Backpropagation* (three citations), *Convolution*, *Attention*, *Quantization*.
  - Changed, for the Literature counter:
    - *Distillation* (2015) → *Model compression* (Buciluǎ et al., 2006) at blue;
    - *Verifiers* (2021) → *Expert iteration* (2017) for the recycler, which H calls the Verifier;
    - *Tool use* → *Automated planning*;
    - *Frontier training* → *Scaling laws* for the silo;
    - *Synthetic rephrasing* (2024) → *Paraphrase generation* (2004) for cracking.
  - Not used: *Compiler* (+25% hand-crafting duplicates *Expert systems*), *Transistor*, *Core memory*, *Fiber optics*, *Time-sharing* as a queue gate (it is research speed 2 here), *Synthetic curriculum*, *Mixed precision*, *Repeated epochs* (D could reuse it as a crawler-decay technology).
  - Achievements that cite technologies here: *Stigler's law* (*Backpropagation*), *The last invention* (*Automated research*), *Hard takeoff* and *Slow takeoff* (timed from *Automated research*), *No related work* (the first beyond-the-literature technology: *Model generation*, *Wafer-scale integration*, *Fusion power* and the rest of §4.7).
- **B (ontology).** Towns, exchanges and libraries need no technologies beyond *Packet switching*. If staffing is adopted, *Packet switching* extends the radius; a later remote-collaboration step can ride on *Web search*. Research halls make Researchers machines (L9), and Model generation multiplies them all at once, the duplicator. B's L13 is honoured twice: the pack's grenade slot is an Evaluation set (F), and the prevention toolkit (switches, monitors, rollback, air gaps) is the first half of Branch M.
- **I (UI).** Use the trigger progress readout ("23 / 50"), the ★ essential flags, and the codes for search. *Research scheduling* adds the "Queued by: Researcher" byline (H).

### 7.3 Cuttable without structural damage

These total about 10 technologies:
- *Prior art*: cosmetic.
- *Packet switching*'s radar relay: it keeps its exchange gate.
- *Weight transplant* and *Research scheduling*.
- *Synthetic detection* and *Watermarking*, merged.
- *Thermal management*.
- The Arc line, 5 technologies, if F drops it.
- *Expert systems*: it is the one joke technology. +100% hand-crafting that "does not apply to machines" is the Bitter Lesson stated as a scope note, and the expert-systems boom and bust happens to the player.

## Appendix A. Item and building names assumed

Only renamed items are listed. "Src" is the proposer: H (tone bible), F (pressure), or E (provisional, this document). D's names win at integration.

| Factorio | Name here | Src | Factorio | Name here | Src |
|---|---|---|---|---|---|
| piercing-rounds-magazine | AP magazine | F | coal-liquefaction | Liquefaction | E |
| processing-unit | Accelerator | H | electronic-circuit | Logic board | H |
| advanced-oil-processing | Advanced refining | E | logistic-robot | Logistic agent | H |
| roboport | Agent hub | H | firearm-magazine | Magazine | F |
| chemical-science-pack | Article | H | automation-science-pack | Memo | H |
| basic-oil-processing | Basic refining | E | steel-chest | Memory bank | H |
| rail-chain-signal | Chain signal | E | low-density-structure | Memory stack | E |
| assembling-machine-3 | Cluster | H | utility-science-pack | Model card | H |
| assembling-machine-2 | Computer | H | modular-armor | Modular suit | E |
| construction-robot | Construction agent | H | flamethrower-turret | Monitor | F |
| pumpjack | Crawler | H | night-vision-equipment | Night vision | E |
| rocket-fuel | Curated corpus | E | personal-roboport-equipment | Personal assistant | E |
| uranium-cannon-shell | DU cannon shell | E | personal-roboport-mk2-equipment | Personal assistant 2 | E |
| uranium-rounds-magazine | DU magazine | F | battery-equipment | Personal battery | E |
| storage-tank | Data lake | H | battery-mk2-equipment | Personal battery 2 | E |
| oil-refinery | Data refinery | H | personal-laser-defense-equipment | Personal laser defense | E |
| discharge-defense-equipment | Discharge defense | E | plastic-bar | Plastic | E |
| barrel | Drive | H | fission-reactor-equipment | Portable reactor | E |
| flying-robot-frame | Drone frame | E | solar-panel-equipment | Portable solar panel | E |
| atomic-bomb | EMP warhead | E | satellite | Post-training payload | H |
| efficiency-module | Efficiency module 1 | E | power-armor | Powered suit | E |
| energy-shield-equipment | Energy shield | E | power-armor-mk2 | Powered suit 2 | E |
| energy-shield-mk2-equipment | Energy shield 2 | E | production-science-pack | Preprint | H |
| kovarex-enrichment-process | Enrichment cascade | E | military-science-pack | Proceedings | H |
| grenade | Evaluation set | F | advanced-circuit | Processor | H |
| exoskeleton-equipment | Exoskeleton | E | productivity-module | Productivity module 1 | E |
| explosive-uranium-cannon-shell | Explosive DU cannon shell | E | quality-module | Quality module 1 | E |
| express-transport-belt | Express belt | E | repair-pack | Repair kit | F |
| fast-transport-belt | Fast belt | E | logistic-science-pack | Report | H |
| stone-wall | Fence | F | rocket-part | Run shard | H |
| rocket-silo | Frontier cluster | H | lab | Seminar | H |
| nuclear-fuel-reprocessing | Fuel reprocessing | E | solid-fuel-from-heavy-oil | Solid fuel (from code) | E |
| heavy-oil-cracking | Heavy-fraction cracking | E | solid-fuel-from-petroleum-gas | Solid fuel (from junk) | E |
| defender-capsule | Interceptor 1 | F | solid-fuel-from-light-oil | Solid fuel (from prose) | E |
| distractor-capsule | Interceptor 2 | F | speed-module | Speed module 1 | E |
| destroyer-capsule | Interceptor 3 | F | beacon | Switch | H |
| sulfur | Label | H | assembling-machine-1 | Tabulator | H |
| small-lamp | Lamp | E | chemical-plant | Trainer | H |
| spidertron | Legged agent | E | recycler | Verifier | H |
| light-oil-cracking | Light-fraction cracking | E |  |  |  |

## Appendix B. Factorio coverage

Every Factorio 2.0 base and quality technology, with its code here.

| Factorio | Here | Factorio | Here |
|---|---|---|---|
| Advanced circuit | G10 Integrated circuit | Logistics 3 | P04 Logistics 3 |
| Advanced combinators | B24 Lateral inhibition | Low density structure | B04 Memory wall |
| Advanced material processing | G03 Zone refining | Lubricant | B06 Lubricant |
| Advanced material processing 2 | B05 Electric furnace | Military | MR01 Ballistics |
| Advanced oil processing | B09 Paraphrase generation | Military 2 | MG02 Penetration testing |
| Artillery | MY07 Artillery | Military 3 | MB01 Rollback recovery |
| Artillery shell range 1 | MS51 Artillery range | Military 4 | MY01 Defense in depth |
| Artillery shell speed 1 | MS52 Artillery reload | Military science pack | MG01 Game theory |
| Atomic bomb | MY03 Electromagnetic pulse | Mining productivity 1 | S24 Mining productivity 1 |
| Automated rail transportation | G13 Semaphores | Mining productivity 2 | S25 Mining productivity 2 |
| Automation | R05 Tabulation | Mining productivity 3 | S26 Mining productivity 3 |
| Automation 2 | G02 Stored program | Mining productivity 4 | S27 Mining productivity 4+ |
| Automation 3 | P01 Cluster computing | Modular armor | G36 Wearable computing |
| Automation science pack | T03 Basic research | Modules | G29 Perceptron |
| Automobilism | G14 Automobile | Night vision equipment | G38 Night vision |
| Battery | G23 Batteries | Nuclear fuel reprocessing | P03 Fuel reprocessing |
| Battery MK2 equipment | B26 Personal battery 2 | Nuclear power | B13 Nuclear power |
| Battery equipment | G40 Personal battery | Oil gathering | G20 Crawling |
| Belt immunity equipment | G39 Belt immunity | Oil processing | T05 Text categorization |
| Braking force 1 | S17 Braking force 1 | Personal laser defense equipment | MB07 Personal laser defense |
| Braking force 2 | S18 Braking force 2 | Personal roboport MK2 equipment | Y08 Personal assistant 2 |
| Braking force 3 | S19 Braking force 3 | Personal roboport equipment | B23 Personal assistant |
| Braking force 4 | S20 Braking force 4 | Physical projectile damage 1 | MS01 Projectile damage 1 |
| Braking force 5 | S21 Braking force 5 | Physical projectile damage 2 | MS02 Projectile damage 2 |
| Braking force 6 | S22 Braking force 6 | Physical projectile damage 3 | MS03 Projectile damage 3 |
| Braking force 7 | S23 Braking force 7 | Physical projectile damage 4 | MS04 Projectile damage 4 |
| Bulk inserter | G17 Batch processing | Physical projectile damage 5 | MS05 Projectile damage 5 |
| Chemical science pack | G01 Statistical learning | Physical projectile damage 6 | MS06 Projectile damage 6 |
| Circuit network | G34 Cybernetics | Physical projectile damage 7 | MS07 Projectile damage 7+ |
| Cliff explosives | G08 Cliff explosives | Plastics | G09 Synthetics |
| Coal liquefaction | P05 Mass digitization | Power armor | B25 Powered suit |
| Concrete | G04 Concrete | Power armor MK2 | MY04 Powered suit 2 |
| Construction robotics | B21 Automated planning | Processing unit | B03 Accelerators |
| Defender | MG08 Interceptors | Production science pack | B01 Deep learning |
| Destroyer | MY06 Interceptors 3 | Productivity module | G31 Backpropagation |
| Discharge defense equipment | MB08 Discharge defense | Productivity module 2 | B18 Convolution |
| Distractor | MB09 Interceptors 2 | Productivity module 3 | P09 Attention |
| Effect transmission | P07 Data parallelism | Quality module | G33 Rejection sampling |
| Efficiency module | G32 CMOS | Quality module 2 | B20 Beam search |
| Efficiency module 2 | B19 Model compression | Quality module 3 | P11 Monte Carlo tree search |
| Efficiency module 3 | P10 Quantization | Radar | R07 Radar |
| Electric energy accumulators | G24 Accumulators | Railway | G12 Railway |
| Electric energy distribution 1 | G22 Rural electrification | Recycling | P12 Expert iteration |
| Electric energy distribution 2 | B11 Substations | Refined flammables 1 | MS21 Monitor throughput 1 |
| Electric engine | B07 Brushless motors | Refined flammables 2 | MS22 Monitor throughput 2 |
| Electric mining drill | R03 Electric mining drill | Refined flammables 3 | MS23 Monitor throughput 3 |
| Electronics | T02 Switching circuits | Refined flammables 4 | MS24 Monitor throughput 4 |
| Energy shield MK2 equipment | MB06 Energy shield 2 | Refined flammables 5 | MS25 Monitor throughput 5 |
| Energy shield equipment | MG07 Energy shield | Refined flammables 6 | MS26 Monitor throughput 6 |
| Engine | G05 Engine | Refined flammables 7 | MS27 Monitor throughput 7+ |
| Epic quality | Y06 Scalable oversight | Repair pack | R04 Maintenance |
| Exoskeleton equipment | B27 Exoskeleton | Research speed 1 | G26 Citation index |
| Explosive rocketry | MB04 Explosive rocketry | Research speed 2 | G27 Time-sharing |
| Explosives | G07 Explosives | Research speed 3 | B15 Web search |
| Fast inserter | R08 Servomechanisms | Research speed 4 | B16 Open-source libraries |
| Fission reactor equipment | MY05 Portable reactor | Research speed 5 | P06 Automatic differentiation |
| Flamethrower | MG05 Reference monitor | Research speed 6 | Y04 Code generation |
| Flammables | G18 Information theory | Robotics | B08 Mobile robotics |
| Fluid handling | G15 Disk storage | Rocket fuel | B10 Curated corpora |
| Fluid wagon | G16 Fluid wagon | Rocket silo | Y09 Scaling laws |
| Follower robot count 1 | MS46 Interceptor count 1 | Rocketry | MG06 Rocketry |
| Follower robot count 2 | MS47 Interceptor count 2 | Solar energy | G21 Photovoltaics |
| Follower robot count 3 | MS48 Interceptor count 3 | Solar panel equipment | G37 Portable solar |
| Follower robot count 4 | MS49 Interceptor count 4 | Space science pack | T07 In-context learning |
| Follower robot count 5 | MS50 Interceptor count 5+ | Speed module | G30 Pipelining |
| Gate | MG03 Gates | Speed module 2 | B17 Vector processing |
| Gun turret | MR03 Fire control | Speed module 3 | P08 Systolic arrays |
| Heavy armor | MR02 Protective clothing | Spidertron | MY08 Embodied agents |
| Inserter capacity bonus 1 | S01 Batch size 1 | Steam power | T01 Steam power |
| Inserter capacity bonus 2 | S02 Batch size 2 | Steel axe | T04 Learning curve |
| Inserter capacity bonus 3 | S03 Batch size 3 | Steel processing | R06 Steel processing |
| Inserter capacity bonus 4 | S04 Batch size 4 | Stone wall | MR04 Fences |
| Inserter capacity bonus 5 | S05 Batch size 5 | Stronger explosives 1 | MS14 Explosive yield 1 |
| Inserter capacity bonus 6 | S06 Batch size 6 | Stronger explosives 2 | MS15 Explosive yield 2 |
| Inserter capacity bonus 7 | S07 Batch size 7 | Stronger explosives 3 | MS16 Explosive yield 3 |
| Kovarex enrichment process | P02 Enrichment cascade | Stronger explosives 4 | MS17 Explosive yield 4 |
| Lamp | R10 Lamp | Stronger explosives 5 | MS18 Explosive yield 5 |
| Land mine | MG04 Land mines | Stronger explosives 6 | MS19 Explosive yield 6 |
| Landfill | G06 Landfill | Stronger explosives 7 | MS20 Explosive yield 7+ |
| Laser | MB03 Laser | Sulfur processing | G19 Spam filtering |
| Laser shooting speed 1 | MS35 Laser rate of fire 1 | Tank | MB02 Tank |
| Laser shooting speed 2 | MS36 Laser rate of fire 2 | Toolbelt | G41 Memex |
| Laser shooting speed 3 | MS37 Laser rate of fire 3 | Uranium ammo | MY02 Depleted uranium |
| Laser shooting speed 4 | MS38 Laser rate of fire 4 | Uranium mining | B12 In-situ leaching |
| Laser shooting speed 5 | MS39 Laser rate of fire 5 | Uranium processing | T06 Isotope separation |
| Laser shooting speed 6 | MS40 Laser rate of fire 6 | Utility science pack | B02 Expected utility |
| Laser shooting speed 7 | MS41 Laser rate of fire 7 | Weapon shooting speed 1 | MS08 Rate of fire 1 |
| Laser turret | MB05 Laser turret | Weapon shooting speed 2 | MS09 Rate of fire 2 |
| Laser weapons damage 1 | MS28 Laser damage 1 | Weapon shooting speed 3 | MS10 Rate of fire 3 |
| Laser weapons damage 2 | MS29 Laser damage 2 | Weapon shooting speed 4 | MS11 Rate of fire 4 |
| Laser weapons damage 3 | MS30 Laser damage 3 | Weapon shooting speed 5 | MS12 Rate of fire 5 |
| Laser weapons damage 4 | MS31 Laser damage 4 | Weapon shooting speed 6 | MS13 Rate of fire 6 |
| Laser weapons damage 5 | MS32 Laser damage 5 | Worker robots speed 1 | S08 Inference speed 1 |
| Laser weapons damage 6 | MS33 Laser damage 6 | Worker robots speed 2 | S09 Inference speed 2 |
| Laser weapons damage 7 | MS34 Laser damage 7+ | Worker robots speed 3 | S10 Inference speed 3 |
| Legendary quality | W01 Formal verification | Worker robots speed 4 | S11 Inference speed 4 |
| Logistic robotics | B22 Multi-agent systems | Worker robots speed 5 | S12 Inference speed 5 |
| Logistic science pack | R01 Linear programming | Worker robots speed 6 | S13 Inference speed 6+ |
| Logistic system | Y07 Instruction tuning | Worker robots storage 1 | S14 Context length 1 |
| Logistics | R09 Logistics | Worker robots storage 2 | S15 Context length 2 |
| Logistics 2 | G11 Logistics 2 | Worker robots storage 3 | S16 Context length 3 |

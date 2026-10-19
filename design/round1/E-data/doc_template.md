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

{{triggers}}

### 4.2 Red: Memo (automatic computation)

{{R}}

### 4.3 Green: Report (programming)

{{G}}

### 4.4 Blue: Article (statistical learning)

{{B}}

### 4.5 Purple: Preprint (deep learning)

{{P}}

### 4.6 Yellow: Model card (agents)

{{Y}}

### 4.7 White: System card (takeoff)

**Before the loop closes.** Paid in System cards from frontier runs, plus every other pack. In G's model these are staff-bound.

{{W}}

**After the loop closes.** Paid in System cards only, which Research halls write. These are G's takeoff technologies.

{{W2}}

**Infinite.** Model generation 21+ is the RSI line after the capstone. The rest are conventional, cost every pack, and keep r ≪ 1, as Factorio's infinite technologies do.

{{W_inf}}

### 4.8 Multi-level series (main tree)

Each row is one technology. A "+" suffix marks an infinite level. Costs and effects are Factorio's, except for Dennard scaling (F, H).

{{series}}

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

{{MR}}

**Green**

{{MG}}

**Blue**

{{MB}}

**Purple**

{{MP}}

**Yellow**

{{MY}}

**Branch M series**

{{Mseries}}

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

{{glossary}}

## Appendix B. Factorio coverage

Every Factorio 2.0 base and quality technology, with its code here.

{{coverage}}

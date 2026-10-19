# 05 — Fun-preservation audit (Fable)

Method: decompose Factorio's fun into atoms, check each proposed mapping against every atom, and only then design. Tags: **ISO** = Factorio's mechanic unchanged under a new name; **BEND** = small deliberate deviation; **BREAK** = large deviation. Every BEND/BREAK carries the fun it buys. Where I disagree with `00-claude-notes.md` I say so.

## 1. Why Factorio is fun — the atoms

| # | Atom | What it concretely is |
|---|---|---|
| F1 | Grid-geometry puzzle | Belt lanes, inserter reach 1 (long-handed 2), underground spans, footprints from 1x1 to 9x9, pipe adjacency, pole reach. Every build is a packing problem. |
| F2 | Visible flow | The economy is *motion*. A backed-up belt is a diagnosis; a sparse belt is a different one. Mouseover gives exact numbers. |
| F3 | Ratio math | Craft times, speeds and belt capacities (15/30/45/s) produce integer ratios that are first derived, then recognized (3 gear assemblers : 2 ...). |
| F4 | Bottleneck hunting | Always exactly one limiting factor; fixing it moves it somewhere visible. |
| F5 | Refactoring under growth | Spaghetti → bus → city blocks; tearing down is part of it; blueprints and deconstruction planners make it bearable. |
| F6 | Intrinsic growth goal | "The factory must grow": research always wants more, stats screens prove it. No fail state, no timer. |
| F7 | Tier-gated complexity | Each pack adds inputs; nothing appears before you can use it. Recipes deepen (green circuit 3+1 → blue circuit 20+2+5). |
| F8 | Research as sink *and* meta-loop | Packs are consumed; labs are the ultimate sink; techs unlock recipes that feed the next packs. |
| F9 | Automation of automation | Hand → assembler → bots → blueprints. The player's role shrinks to map view. |
| F10 | Distinct logistics modes | Belts (local), trains (signals, scheduling), bots (lazy), fluids (adjacency, no mixing), later platforms. Each a different puzzle. |
| F11 | Cross-cutting networks | One power network whose shortfall scales everything; an optional circuit network (programming inside the game). |
| F12 | Exploration and depletion | Infinite procedural map; richer further out; patches run out; water, cliffs and trees shape builds. |
| F13 | Conservation and determinism | Items never duplicate or vanish; no RNG in the core loop. This is what makes F3/F4 meaningful. |
| F14 | Embodiment and scale | An avatar with reach and inventory, hand-feeding furnaces early, dwarfed by the base later. |
| F15 | Pressure (optional) | Pollution → biters → a defense production chain. Growth has a cost; peaceful mode exists and is popular. |
| F16 | Legibility and deadpan tone | Iron gear, copper cable: readable at 32 px. Near-zero narrative; absurdity played straight (hand-crafting a locomotive). |
| F17 | Mastery ceiling | Perfect ratios, direct insertion, UPS, megabases, quality grinding. |

## 2. Traps specific to an AI-research theme

| Trap | Kills | Avoidance |
|---|---|---|
| **Abstract items.** "Insight", "idea", "paper A/B" are indistinguishable blobs on a belt. | F2, F16 | Belt items are physical media and hardware: punch-card decks, tape reels, drive cartridges, chips, accelerator cards, racks. Research artifacts share one silhouette per family with color variants, exactly as flasks do. Cap the slice at ~11 silhouettes and test every sprite at 32 px before accepting it. |
| **Non-rival knowledge vs. conservation.** If items are facts, why make 1000? Why can't I copy? | F3, F8, F13 | Belt items are rival things only. A paper pack is a *unit of research effort*, which is what a science flask already is (nobody asks why labs eat flasks). Non-rival know-how lives where Factorio already puts it: the tech tree. The single bridge: a trained model is a **tech** that unlocks a cheap **recipe** for "checkpoint" modules (training is research; copying is free; hosting costs hardware). 00's catalyst-recipe idea is a good complement for *fine-tune* recipes (weights in, weights out). |
| **Money as currency.** "Earn, then buy GPUs" collapses chains into a scalar; routing and ratios vanish. | F1–F4 | Don't model money at all. Factorio doesn't; every cost is a production problem. "Funding" is the same unmodeled abstraction as Factorio's missing economy. If a revenue number ever exists, it is a stats-screen score, never spendable. |
| **People as items.** Hiring as mining, talent on belts or as a fluid. | F13, F16 | People are implicit in buildings (assemblers have no workers either). Talent is not a resource. If flavor wants it, it's a label on the building tooltip. I would not do 00's "talent springs": it adds a network without a new puzzle and reads grim. |
| **The network abstraction.** "Data moves instantly over the net" deletes belts. | F1, F2, F10 | Bandwidth is physical. Bulk data is media on conveyors; the crawl stream is a fluid in pipes with pipe throughput; long haul is rail (a tank wagon of data is the station-wagon-full-of-tapes joke, which is real, so not cringe). Nothing wireless before agents (bots). |
| **Idea-space map, or a bounded campus you pay to extend.** | F1, F10, F12, F16 | What is a pipe between topology and ML? What is water? Both rejected: physical, infinite, procedural map (a fictional continent, not Earth). Idea-space survives at most as biome *naming*. |
| **Smart adversaries / corporate weapons.** Rival labs, patent guns, PR wars. | F15 → cringe; F6 | Peaceful by default. Give pollution teeth without enemies (below). A non-human late adversary is the only option that stays dry; defer it. |
| **Pollution without consequence.** Without biters, Factorio's pollution is cosmetic. | F15 | Bind contamination to resource degradation (model collapse). Counters must exist: aligned checkpoints (efficiency modules), provenance filtering (tech), expansion outward. |
| **Fluid-ifying the core.** "Compute" or "data" as a piped fluid, or a second grid. | F1, F2 | Compute is the crafting speed of research buildings plus accelerator cards consumed as ingredients. Data is solid cartridges. Fluids only for water/steam and the crawl stream (the oil analog). I disagree with 00's "compute as a second network" for the base game: Factorio deliberately has *one* grid; a second one duplicates F11 without a new puzzle. Revisit as a planet-style expansion. |
| **Front-loading modern AI, or history as script.** GPUs at minute 5; dated milestones, real paper titles, real companies. | F6, F7, tone | Start in the relay/punch-card era as the burner phase; accelerators are the blue tier. Tech names are concepts ("attention", "preference tuning"), no dates, companies or people. The tree motivates because the player already knows what "scaling laws" buys. |
| **Preachiness.** Alignment as morality play. | F16 | Alignment is efficiency modules and an evaluation branch: numbers, not morals. No dialogue, no cutscenes. Flavor only in tooltips, Factorio-dry. |
| **Runaway RSI.** The loop trivializes the midgame. | F6, F17 | Module slots and diminishing stacking as in Factorio; infinite techs cost geometrically; the compounding phase is gated behind the frontier run (rocket). |
| **One building does research.** | F1, F5 | Keep Factorio's building variety and footprints (2x2 parser, 3x3 workstation, 5x5 filter pipeline, 3x3 institute, 9x9 frontier cluster). Footprint variety is an unnoticed source of F1. |
| **Busman's holiday.** Simulating the player's own job. | F16 | Deadpan absurdity (coal-fired tabulators) keeps it a game, not a sim. Play it straight. |

## 3. The minimal-deviation concept

**Frame.** A fictional, infinite, procedural continent (ISO). The avatar is *the researcher*: inventory, reach, hand-crafting = doing it by hand; by the agent tier you are the invisible hand in map view, which is exactly Factorio's arc (ISO). Top-down 2D stays: belt and inserter geometry needs the grid and the theme offers no reason for a side view. Time span: relay era → singularity, as flavor on the tiers, never as a clock.

**Rule for every number:** copy Factorio's numerical skeleton (craft times, speeds, stack sizes, belt tiers, module stacking) under new names. The user's ratio knowledge transfers unchanged and the game still feels new, because the *names* carry the identity. This is the cheapest "familiar but fresh" lever there is.

### Mapping

| Factorio | Here | Tag | Note |
|---|---|---|---|
| Map, water, cliffs, trees | Same | ISO | Datacenters want flat land and water; geography still matters. |
| Iron, copper, coal, stone | Iron, copper, coal, **silica** | ISO | Hardware is physical. Silica takes stone's roles (bricks, concrete) and later feeds wafers. |
| — | **Archive** deposit → raw records | BEND | The one new ore. Finite, richness-scaled, depletes: the data wall as ore depletion. Sprite: a cluster of filing stacks / tape vaults shrinking as mined. |
| Crude oil → refinery → three fractions, cracking | **Web uplink** → **filter pipeline** → high-quality text / media / junk; "synthetic rewriting" cracks junk into text | ISO | The same multi-output balancing puzzle. Barrels = drives, so fluids and belts interchange as in Factorio. |
| Stone/steel furnace | **Smelter** (ores) and **parser** (records → dataset cartridge) | ISO | 2x2, burner then electric. |
| Assembler 1/2/3 | **Workbench / workstation / cluster** | ISO | 0/2/4 module slots; crafts hardware, cartridges and papers alike. |
| Chemical plant | **Trainer** | ISO | Solid+fluid recipes: cartridges + stream (+ accelerators) → checkpoints and experiment results. |
| Lab | **Institute** | ISO | Eats papers. |
| Science packs | **Papers**, one silhouette, Factorio's seven colors | ISO | Ladder below. |
| Speed / productivity / efficiency modules | **Checkpoints**: fast / productive / aligned | BEND | Recipes unlocked by "train ..." techs, produced by trainers, distributed as items. Research speed becomes a logistics problem on belts instead of a global number. See §4. |
| Electricity | Electricity | ISO | The real constraint: coal → solar → nuclear → fusion. Keep it literal. |
| Belts, inserters, rail | Conveyors, arms, rail | ISO | |
| Bots, roboports | **Agents, agent hubs** | ISO | Unlocked by agent techs; the model starts building the lab. Same recipe shape as the flying robot frame. |
| Pollution → biters | **Contamination** → archive degradation | BEND | No enemies by default. See below. |
| Military pack + weapons branch | **Evaluation paper** + robustness/alignment branch | BEND | The branch gates higher-tier checkpoints and the contamination counters. |
| Rocket silo, rocket parts, satellite | **Frontier cluster, run shards, benchmark suite** | ISO | 9x9, 100 shards, each = accelerator pack + curated corpus + scaling recipe. |
| Launch → space science | **Frontier run → frontier evaluations** (white) | ISO | Win screen on first return, continue after. |
| Infinite research | **Automated research** (RSI) | BEND | Compounding, see §4. |
| Quality, planets, platforms | Training variance, post-AGI domains, orbital compute | ISO, deferred | Space Age-sized expansions. |
| Burner phase fuel | Coal | ISO | Coal-fired card tabulators are exactly as absurd as hand-crafting a locomotive; play it straight. 00's coffee works as one easter-egg fuel item, not as the bootstrap resource: the bootstrap puzzle needs a fuel you mine. |

### The paper ladder (each pack consumes its tier's signature products, as Factorio's do)

| Color | Pack | Ingredients (shape mirrors Factorio) | Representative unlocks |
|---|---|---|---|
| Red | Theory paper | 1 punch-card deck (paper ← wood) + 1 computation (tabulator) | relays, stored program, conveyors, arms |
| Green | Systems paper | 1 conveyor + 1 arm | transistors, magnetic tape, compilers, perceptron |
| Gray | Evaluation paper | 1 benchmark cartridge + 1 test harness + 1 logic board | eval suites, robustness, later preference tuning, interpretability |
| Blue | Learning paper | 1 processor + 1 media cartridge + 1 small checkpoint | backprop, convolutions, accelerators, web uplink |
| Purple | Scaling paper | 1 rack + 1 productive checkpoint + 1 rail | scaling laws, attention, mixture of experts, interconnect |
| Yellow | Agent paper | 1 agent runtime + 1 accelerator board + 1 curated corpus | tool use, autonomy, agents (bots), remote operation |
| White | Frontier evaluation | Returned by the frontier run | automated research (RSI), post-AGI domains |

Factorio's military branch is optional; I would put evaluation lightly on the main path (trainer tier 2 and aligned checkpoints need it). Not as a message: it's simply the only sensible gate for the module that lowers contamination.

### Contamination (pollution) — BEND

Trainers, institutes and deployed checkpoints emit contamination (synthetic output leaking into the data commons). It diffuses per chunk and is absorbed by terrain, exactly like pollution, with the same overlay. Consequence: archives in contaminated chunks yield a growing fraction of *contaminated records*, which parse into junk (model collapse), so growth degrades your own inputs. Counters: aligned checkpoints (efficiency modules: lower emission), provenance filtering (a tech that lets parsers reject junk at a throughput cost), expansion to clean archives further out. Fun bought: the growth-has-a-cost loop, the efficiency-module axis and the expand-outward motive of F15 without an enemy AI and without cringe. Fun lost: attack events and the defense chain. Factorio's peaceful mode loses the same and remains the version many veterans play.

### Endgame — ISO then BEND

Build the frontier cluster, feed 100 run shards, load a benchmark suite, run. First return = win screen (ISO). Then "automated research" is an infinite tech whose cost rises geometrically but whose effect *compounds* research speed (BEND): the queue visibly accelerates, techs start completing in seconds, the UI itself becomes the spectacle. The singularity is the tree finishing itself. The factory continues as sandbox with post-AGI content.

### Legibility sheet for the slice (11 silhouettes)

Plate, cable coil, gear, logic board, punch-card deck (stack with holes), tape reel, dataset cartridge (rounded rectangle, label color = data type), paper (bound sheet with colored band: the flask of this game), checkpoint (glowing hexagonal chip), accelerator card (slab with fan), rack (tall dark slab). Families reuse a silhouette and vary hue; tiers vary one detail, belt-style.

## 4. Deviations worth making (the theme makes the game *better*)

1. **Checkpoints as manufactured research speed (BEND).** In Factorio, lab speed is a global multiplier you never see. Here, every point of research speed is an item you train, route and insert into every institute and trainer, including the ones that make checkpoints. The RSI loop is laid out on belts, bottleneck-hunted and refactored like any other chain, and bots-as-agents are the moment the loop closes itself. This is the one place the theme turns Factorio's abstract number into Factorio's best mechanic.
2. **Compounding RSI finale (BEND).** The rocket is a moment; the tree finishing itself is a crescendo built from existing UI. Cheap to build, unique to this theme.
3. **Contamination as pollution (BEND).** Gives pollution teeth without an enemy; the alignment tax becomes an honest efficiency-vs-speed module choice, which is already how Factorio's modules work.
4. **Data refining as oil (ISO, but a rhyme).** The multi-fraction balancing puzzle is Factorio's best midgame system and maps one-to-one onto filtering a crawl. The data wall maps onto patch depletion. Both are expert-recognized without being jokes.
5. **Agents as bots (ISO, better fiction).** The flying-robot-frame recipe becomes "agent runtime" = inference hardware + checkpoint; the construction-bot milestone reads as the first time the model builds the lab. Nothing changes mechanically; the fiction is finally earned.
6. **Deferred, Space Age-style:** quality as training variance (seed lottery; recycler = distillation), spoilage as benchmark staleness on *one* post-AGI domain, orbital compute as platforms, 00's cyberspace frame as a planet. Each is ISO with Space Age and belongs after the slice.

## 5. Tempting but downhill

- **Money, markets, funding rounds, VC.** Fungibility deletes F1–F4. Also a second grid (funding or compute) on top of electricity: more bookkeeping, no new puzzle.
- **People as items, hiring as mining, talent fluids, grad-student modules.** Conservation nonsense plus cringe.
- **Rival labs, race timers, leaderboards.** Smart adversaries make the sandbox adversarial; timers kill F6's no-fail pacing. Every corporate "weapon" (patents, PR, poaching) is a patent gun.
- **Idea-space terrain, bounded campus.** Both forfeit F1/F12 for a metaphor.
- **Compute as a piped fluid or wireless data.** Moves the core loop off belts (F1, F2).
- **Spoilage on the core loop.** Gleba's mechanic is Factorio's most divisive; fine on one optional domain, poison on papers.
- **Feral-agent biters in the base game.** 00 likes them; I'd defer. The mechanics are sound (emission → spawn → defense chain), but "shoot rogue AIs with turrets" is the most on-the-nose image possible for this audience, and making it dry is tone work that shouldn't gate the slice. If added later: emerge only post-agents, from your own deployments, named flatly (containment walls, kill switches), peaceful toggle.
- **Narrative, dialogue, satire of real labs or people, academic-politics systems (reviewers, h-index).** Factorio's silence is a feature. A "papers per minute" production graph is the entire permitted joke.
- **Playing all of intellectual history.** Breadth instead of chain depth; no seven-tier ladder with a known destination.
- **Rewind/scrubbing the simulation (00).** Orthogonal to this audit and it weakens F4: diagnosing a jam from the flow is the fun.

## 6. Vertical slice

Red and green tiers only: iron, copper, coal, silica, archive, wood, water. Smelter, parser, workbench, tabulator, burner and electric drills, offshore pump, boiler, steam engine, conveyors, arms, institute, ~15 techs ending in "transistors". No fluids beyond water/steam, no contamination yet (add the overlay with blue), no checkpoints yet (first "train small model" tech lands with blue). Copy Factorio's numbers verbatim. If the first forty minutes feel like Factorio with the identity reading on every belt, the rest is expansion along the mapping table above.

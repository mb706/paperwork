# Design space: a Factorio-like game about AI research

This combines my own notes (`00-claude-notes.md`) with the five subagent reports in `brainstorm/`:

| Report | Model | Lens |
|---|---|---|
| 01 | Opus | Mapping table |
| 02 | Opus | World and player |
| 03 | Opus | Pressure and arc |
| 04 | Fable | Complete concepts |
| 05 | Fable | Fun audit |

The guiding principle, from you: *near the top of a hill most paths lead downhill*. So keep Factorio's mechanics, and even its numbers. Concentrate the theme in **rhymes**: places where the real history and economics of AI already have Factorio's structure.

## 1. Your questions, as the reports answer them

**What are the resources?** Physical matter (iron, copper, coal, silica) plus **archives**, which are solid data deposits. Archives are finite, so the "data wall" is ore depletion. Mid-game, the **web crawl** arrives as Factorio's oil.

**Is money a resource?** No. Anything you can buy, you needn't build, and that dissolves the logistics puzzle. This is also why Factorio has no market. All the reports agree.

**Is "technology" a resource?** It splits into three layers, and Factorio already makes the same split:

| Layer | In this game | Rival? | Factorio equivalent |
|---|---|---|---|
| The idea | A tech node | Non-rival: researched once, used everywhere | The tech tree |
| The paper | A science pack: the rival *cost* of the idea | Rival | Science packs |
| The engineered thing | An item made with the unlocked recipe | Rival | Items |

So "theory → application paper → engineered technology" spans all three layers rather than one belt. This is Romer's split between rival and non-rival goods.

**Knowledge is free to copy. Does that break conservation of materials?** Not if the layers stay strict. Items are *embodiments*: tokens on disks, weights on accelerators, papers standing for person-months. Where copying should feel cheap, use Kovarex-style catalyst recipes. Example: *instantiate agent: 1 checkpoint (returned) + 1 accelerator → 1 AI researcher*. Then once one good model exists, accelerators are the binding constraint, which is the real one.

**Who is the player?** An embodied researcher.
- Factorio's own arc already *is* the human → AI story: hand-crafting → assemblers → bots → remote view. You become the invisible hand anyway.
- "Factorio already enacts the Bitter Lesson": hand-crafting is GOFAI, and the first assembler is a tabulator replacing human computers.
- Optional: a cosmetic "line of successors" avatar whose sprite changes per era, ending as an agent chassis.

**What is the map?** An endless, procedurally generated physical world on a fictional continent.
- Datacenters care about water, cold and sun, so geography matters as it really does.
- Idea space, a campus and cyberspace were all rejected as the *main* map: belts, poles and distance stop meaning anything.
- The space of ideas instead lives on the research screen and in Space Age-style expansion planets.

**When does it start?** Around 1945. Eras flavor the tiers; there is no clock.
- Example opening: the decommissioned MIT Radiation Lab (closed in 1945), with magnetrons and vacuum tubes to salvage.
- Bush's *Science, the Endless Frontier* is from the same year.
- Report 04 alternatively starts the player as a modern grad student.

**What are the biters?** Rival labs, countries and regulators never appear as entities on the map; at most they are timers. This rules out patent guns. Beyond that, biters are the hardest open problem (see D2).

**What is pollution?** Contested (see D1).

## 2. Consensus mapping

| Factorio | Mapping | Rhyme |
|---|---|---|
| Iron/copper → plates → green/red/blue circuits | Logic board → CPU → accelerator | Factorio's circuit chain already *is* the chip ladder |
| Stone furnace | Smelter. A tokenizer "smelts" archive ore into token ingots (*Aa*, *{ }*, *▦*) | |
| Oil → refinery → cracking | Crawl wells → data refinery (dedup, filter) → prose / code / junk. Cracking is synthetic rephrasing | "Data is the new oil." Pumpjack decay = repeated epochs |
| Power: steam → solar → nuclear | Literal electricity | Frontier AI is power-bound (reactor restarts) |
| Science packs, labs | Papers in Factorio's colors, digested by institutes | Infinite research's rising cost = "ideas are getting harder to find" |
| Bots | **AI agents.** Construction bots are coding agents building your blueprints | Your product starts doing your job |
| Circuit network | Decider combinator = McCulloch–Pitts neuron (1943). "Cybernetics" (1948) unlocks wires | You can build a perceptron |
| Blueprints | Open source | The second non-rival layer |
| Trains | Freight, plus wagons of drives for bulk data | "Never underestimate the bandwidth of a station wagon full of tapes" |
| Quality + recycler | Best-of-N with a verifier (rejection sampling) | Space Age's loop, unchanged |
| Rocket | Frontier training run. The silo is the cluster, parts are training steps, the progress bar is a falling loss curve. The satellite is the post-training payload | |
| Endgame | **Recursive self-improvement as a regime change** (detail below) | Takeoff-speed models, as a mechanic |
| Tone | Factorio-dry: operations vocabulary (Monitor, Audit, Sandbox), jokes only in tooltips | Never lectures, meters or morality choices |

**How the endgame works:**
- Returns to research cross 1, so the last techs fall in minutes, braked by power and heat.
- How much compute you built before the loop closes (the "overhang") sets the takeoff speed.
- The victory screen reports the takeoff duration.

## 3. Open decisions

### D1 — What plays pollution?

| Option | For | Against | From |
|---|---|---|---|
| **Slop**: synthetic content spreads like pollution and lowers the purity of the data deposits it covers (model collapse). Pre-1945 archives are "low-background data" | Pressure without enemies; rewards siting; true and witty | Only bites from the web era on | 01, 05 |
| **Heat**: emitted in proportion to power draw, absorbed by water and cold, throttles hot chunks, attracts enemies | Physical from minute one. Survives into space (radiators, Landauer limit). Siting matters | Throttling is a deviation (Factorio pollution never hurts you directly) | 03, 02 |
| **Drift**: emitted by compute nobody is supervising, absorbed by human-staffed offices | A layout trade-off | Needs people on the map | 04 |
| Misalignment as an ambient gas | — | Misalignment is a property of models, not a gas, and treating capability as dirt is a stance | 00; rejected by 01 and 05 |

### D2 — What plays the biters? (the hardest problem)

| Option | For | Against | From |
|---|---|---|---|
| **Peaceful by default**; pollution has teeth instead | Safest; many veterans play peaceful | Loses the defense production chain | 05 (and everyone's vertical slice) |
| **Feral code**, escalating bug → worm → botnet → rogue agent. Nests are orphaned e-waste and wake when you research *Networking*. Defenses are firewalls (walls), watchdogs fed signature cartridges (turrets) and "Reaper" counter-worm artillery. No handheld weapons | Keeps the military logistics game; the puns land (Factorio has worms; the 1947 moth) | "Turrets vs rogue AI" is the most on-the-nose image available, and swarms misstate the real threat model | 03; 04's "Runaways" variant |
| **Split the job**: slop for footprint pressure; walled gardens that you clear by delivering licensing deals; late Goodhart pressure from "hollow" items that pass inserters but fail downstream | Novel, free of cringe | Untested; less visceral | 01 |
| Rivals as timers: results that spoil into "scooped"; an opt-in Race mode where a rival curve can take off first | Race dynamics without entities | Spoilage is divisive | 03, 01 |

### D3 — Talent and people

| Option | From |
|---|---|
| Implicit in buildings (assemblers have no workers either) | 05 |
| Burner-era entities run on human staff and burn **coffee** ("a mathematician is a device for turning coffee into theorems"); electric ones are machines | 01, 00 |
| **Students as burner fuel** ("Student. Fuel value 8 MJ. Graduates."). Report 05 finds this grim | 04 |
| **Universities as fixed-yield wells**: the one input you can't scale, until AI researchers remove the bottleneck. *Strongest mechanical argument: an explosion needs a bottleneck to remove* | 03, 01 |

### D4 — Where compute lives

| Option | From |
|---|---|
| **Modules and beacons**. Accelerator cards are speed modules (PCIe slots = module slots). Cluster racks are beacons. Factorio 2.0's 1/√n beacon falloff = communication overhead. Needs no new system | 01 |
| **Trained checkpoints as modules** (fast / productive / aligned), so research speed is manufactured and routed on belts | 05 |
| A second, compute-specific power grid | 00; rejected by 01 and 05 |

The first two can coexist: hardware cards and trained checkpoints as two module families.

### D5 — Which safety ideas become mechanics (never lectures)

- **Alignment tax** as a module trade-off. Report 01 cautions that this casts safety as pure overhead, which RLHF's history contradicts.
- **Interpretability:** model quality shows as "?" until researched.
- **Scalable oversight** gates the quality tiers.
- **Post-training** is the rocket's satellite.
- **Win text** for an unaligned launch: *"Objective: maximize Iron gear wheel. ETA: heat death."* — naming the player's actual most-produced item. The Factorio player was always the paperclip maximizer.

### D6 — Naming realism

| Option | From |
|---|---|
| Real paper titles and names on techs (*Attention Is All You Need*, McCulloch–Pitts) | 02, 01 |
| Concept names only: no dates, companies or people | 05 |

A middle ground: concept names on techs, citations in tooltips.

## 4. Wildcards (strong single ideas, higher risk)

- **Spacetime map** (04): the x-axis is the calendar and a frontier line sweeps east. You feel acceleration with your feet. Risk: a treadmill.
- **Output becomes terrain** (04): each paper spawns patches of corollaries. Suits one "Mathematics" planet.
- **Climate compass** (02): the cold north is cheap to cool, the sunny south suits solar, coasts land cables. Siting becomes a game, as it is in 2026.
- **Interstellar finale** (03): light-lag rules out remote view. You send seeds (a blueprint book plus a kit) against an advancing grabby-alien frontier. Their first build is a main bus.

## 5. Expansion layer (Space Age analogs, after the base game)

| Proposal | Planets | From |
|---|---|---|
| AI for science | Biology (spoilage is just biology), materials and fabs (foundry), the archive and chip design (scrap recycling), cryogenic physics | 01 |
| Abstract surfaces | The Web (islands of signal in spam); Latent Space (the residual stream as a pre-built main bus, sparse autoencoders as the recycler) | 02 |
| *Eternity in six hours* | Mercury disassembled into a Dyson swarm; the Belt; an outer moon where cold makes compute cheap | 03 |

## 6. Rejected (broad consensus)

- **Economy and people:** money and markets; people as belt items.
- **Opponents:** rival labs, countries, regulators or protesters as map entities; patent guns and handheld weapons.
- **Moralizing:** morality meters, misalignment game-overs and hidden-sabotage mechanics; satire of real labs or people; literal paperclips (use the player's own most-produced item instead).
- **Scope and structure:**
  - Idea space or a campus as the main map.
  - Playing through all of intellectual history.
  - A second power grid in the base game.
  - Random breakdowns.

## 7. Suggested next step

Build a vertical slice: **Factorio's first hour, reskinned.**
- Start in 1945, with iron, copper, coal, silica and archives.
- Burner → electric, belts and inserters, steam power.
- Red and green papers, about 15 techs, peaceful.
- Copy Factorio's numbers verbatim.

D1–D4 can wait until the blue tier. If those forty minutes feel like Factorio, with the identity readable on every belt, everything else is expansion along these tables.

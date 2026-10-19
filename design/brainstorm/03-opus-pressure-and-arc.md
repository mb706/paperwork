# 03: Pressure, antagonists and the arc to the singularity (Opus)

Tags: **ISO** keeps Factorio's mechanic. **BEND** is a small, deliberate deviation. **BREAK** is a large one.

## 0. Thesis

In Factorio, the threats and limits on the factory do four jobs:
- **A footprint tax:** pollution grows with the factory.
- **A frontier:** expansion costs something.
- **A clock:** evolution escalates.
- **A logistics test:** ammo, repair and walls.

Keep all four jobs, and give them to things that are **non-human, mindless and physically real: waste heat and feral code**. People (rival labs, regulators, states) never appear on the map; they appear only as timers. That one rule removes the patent gun and every strawman, because the player never shoots at anything intelligent.

Should there be combat at all? Yes, as Factorio has it: on by default, one toggle away, and left out of the vertical slice. The slice still has a pressure loop, because heat bites even without enemies.

Assumed base (the other docs decide it):
- A top-down physical map with power, chips, compute and data.
- Talent comes from universities and is the one input the factory cannot make.

If the map becomes idea space instead, the timers and the arc still work. Heat and feral code need a physical map.

## 1. The candidates

| Candidate | Spatial? | How the player answers it | Verdict |
|---|---|---|---|
| Rival labs | Keep off the map | They exist as timers: results get *scooped* (§2.4); opt-in Race mode | Timer only |
| Rival countries | Borders | Only war or politics | **Reject** |
| Aliens racing to AGI | Yes | Jarring next to 1950s mainframes | **Reject** before the singularity; reuse as the grabby frontier (§3.5) |
| Misaligned superintelligence as an army | Yes | Turrets beating a superintelligence *is* the strawman | **Reject** |
| Feral code: bug → worm → botnet → rogue agent | Yes: nests on orphaned compute | Firewalls, watchdogs, detectors, counter-worm artillery | **Recommend** as biters |
| Bugs inside your own machines | No | Breakdowns and maintenance. Factorio has none, for good reason | **Reject** |
| Regulation | Zoning at most | Paperwork recipes: dull and partisan | **Reject**; tooltip wit only ("10²⁶ FLOP: reporting required") |
| AI winters | Emergent | Paradigm deposits deplete like ore; a winter is your science line running dry before the next outpost is up | **ISO**, if the economy has paradigm deposits |
| Hype cycle | Over time, not space | If funding is the power analog: VC money = solar, bust = night, endowments = accumulators | **ISO**, conditional. Reject an "expectations debt" meter (Tycoon, not Factorio) |
| Brain drain | Contested universities | Influence radii, a city-builder mechanic | **Reject.** Talent scarcity is the bottleneck that recursive self-improvement removes (§3.2) |
| Compute/energy scarcity | It *is* the economy | Build power: the power wall | **ISO**, not an antagonist |
| Waste heat | Yes | Water, cold, cooling towers, spacing | **Recommend** as pollution |
| Data contamination | Per deposit | Filtering chains, archive deposits | Optional late **BEND** (§2.5) |
| Knowledge spillover as pollution | Yes (it is even geographic, empirically) | Secrecy | **Reject.** It is the true R&D externality, but it makes publishing the pollutant: a policy position that preaches at an academic |

## 2. Recommended pressure design

### 2.1 Heat is the pollution (BEND)

- **Emission scales with power draw (ISO).** Examples: assembler 3/min, GPU rack 40/min, datacenter hall 300/min. Speed and productivity modules raise it; efficiency modules lower it.
- **Spread and absorption (ISO).** Heat diffuses per chunk. Absorption: water ≫ snow/tundra > grass > desert. Landfilling a lake deletes a heat sink, which is a small, honest trade-off.
- **Cooling tower (ISO-ish).** Takes water and power and acts as an active absorber. Space Age already lets you plant absorbing trees; this is the industrial version, and it turns cooling into a production chain, which is what AI infrastructure in 2026 actually is.
- **Effect 1, throttling (BEND).** Machines in a chunk above a threshold slow down. This shows like a brownout: an overlay, a per-machine icon and production stats.
  - Why deviate: in Factorio's peaceful mode, pollution is cosmetic. Heat gives peaceful players a footprint problem and a counterweight to beacon density, and it stays readable.
  - A settings toggle keeps the pure sandbox.
- **Effect 2, attraction (ISO).** Nests absorb heat and spend it on attack waves. Feral code hunts compute cycles, and heat is the signature of compute (compute is detectable, which is the premise of compute governance).
- **Value across the arc.** Heat is the only externality that survives the singularity (radiators in vacuum, the Landauer limit). One system runs from ENIAC's 150 kW to a Matrioshka brain.

### 2.2 Feral code = biters (ISO, with two BENDs)

- **Tiers:** *bug* (the 1947 Harvard Mark II moth) → *worm* → *botnet swarm* → *rogue agent* (autonomous replication, the threat model labs actually evaluate for). Factorio players already call biters "bugs"; the game never explains the pun.
- **Nests are orphaned compute (ISO):** heaps of unpatched e-waste.
  - **Daemons** are the stationary nest defenders (Factorio's worms).
  - Nests spread by propagation, Factorio's expansion.
  - Clearing a nest drops salvage chips, so offense pays (like Fulgora scrap).
- **Dormant until you research *Networking* (BEND).** Creeper needed ARPANET. The early game is peaceful because history was, and the heaps visible from minute one foreshadow the threat. The player flips the switch.
- **Evolution (ISO)** rises with time, heat absorbed and nests killed. The kill term finally has a true rationale: every shutdown selects for whatever your detectors miss (antibiotic resistance; training against your own monitor).
- **Capability term (BEND).** Each model generation you deploy raises evolution, scaled by (1 − alignment) of the deployed agents, because rogue agents are forks of the frontier. Alignment becomes this pollution's efficiency module.
- **Adaptive resistance (optional BEND).** Enemy resistances drift toward your most-used damage type, capped at 50%. Defense in depth beats a laser-turret monoculture.
- **Art:** glitch-insects, pre-rendered with a chromatic shimmer and readable at small sizes. They are an obvious metaphor, not a claim about how malware moves.

### 2.3 Military line (ISO, one BEND)

| Factorio | Here | Notes |
|---|---|---|
| Wall / gate | **Firewall / port** | Trains pass through open ports |
| Gun turret | **Watchdog** | Fed signature cartridges, upgrading to heuristic and then classifier cartridges |
| Laser turret | **Detector** | Runs on power. Damage scales with your model generation, so defense and offense ride the same curve |
| Artillery | **Counter-worm launcher** | Its shell is the **Reaper**: Reaper hunted Creeper on ARPANET, so the first antivirus was a worm |
| Repair pack | **Patch** | |
| Radar | **Crawler** | Reveals chunks |
| Military science | **Defense pack** | Recipe: 2 firewalls + 1 heuristic cartridge + 1 patch → 2 packs. Optional for Takeoff, as black science is for peaceful players. Historically, DARPA paid for most early AI |

- **No handheld weapons (BEND).** The researcher never shoots; offense is turret creep plus Reapers. This removes the most cringe-prone surface (personal weapon names) and a large chunk of combat code. A spidertron analog ("embodied agent") can arrive late.
- **Defaults:** enemies on, with a peaceful toggle, as in Factorio. The vertical slice ships peaceful, with heat only.

### 2.4 Rivals as timers

- **Scooped (BEND: Gleba spoilage on one item line).**
  - *Novel results* spoil into *known results* after 10–20 minutes. Known results aren't waste: they feed textbooks, then training data. Yesterday's novelty becomes tomorrow's corpus.
  - This is race dynamics at the scale an academic actually feels it. It punishes buffer chests and rewards just-in-time logistics.
- **Race mode (BREAK, off by default).**
  - A rival progress curve advances with time and with every result you let spoil: what you sat on, they published.
  - If the rival reaches Takeoff first, you lose.
  - Only in this mode is the alignment tax a dilemma rather than just a cost. It is opt-in, like the deathworld preset.

### 2.5 Optional: low-background data (BEND)

- After the *Deployment* tech, web-data deposits build up a synthetic fraction proportional to cumulative deployment.
- Mined data splits into clean and synthetic data, which needs a Fulgora-style sorting chain. Top-tier training requires a minimum clean ratio.
- **Archive deposits** (pre-digital) never get contaminated: they are the low-background steel of data.
- Your success fouls your own well, and the game never comments on it.

## 3. The arc

### 3.1 Pressure phasing

| Science tier | Era | What arrives |
|---|---|---|
| Red | Mainframes, cybernetics | Heat |
| Green | Networking, symbolic AI | Nests wake (bugs, worms) |
| Black | Defense funding | Firewalls, watchdogs, defense pack |
| Blue | Internet, statistical ML | Botnets; first paradigm depletion (a winter) |
| Purple | Deep learning, GPUs | Rack density makes heat the binding limit; Scooped |
| Yellow | Scaling, LLMs | Rogue agents; alignment as quality; *Deployment* (contamination) |
| (none) | Automated research | The research loop closes; the takeoff sprint |
| Silo | Superintelligence | Seed launch |

### 3.2 Recursive self-improvement as a mechanic

1. **Before the loop closes**, research is capped by **talent**. Universities are fixed-yield wells that no productivity research improves, so growing research before the loop closes means claiming more of them (BEND). Factorio has no input that can't be scaled, so its late game never accelerates; an explosion needs a bottleneck to remove.
2. ***Automated Researcher*** unlocks the *AI researcher* item (recipe: 4 accelerators + 1 model), which stands in for talent in labs.
3. **Each *Model gen N* tech** multiplies every deployed AI researcher at once (ISO: Factorio's research bonuses are global and apply retroactively). Late science packs are talent-heavy and matter-light by design, so these multipliers really bite.
4. **The explosion is a scaling sprint.** This is semi-endogenous growth with idea production automated (Aghion–Jones–Jones; Davidson's takeoff model).
   - Research goes hyperbolic until something physical binds: compute, power or heat.
   - The last ~20 techs fall in minutes while you race to build power and cooling, with throttling as the brake.
   - The thermal wall is what a compute-bound takeoff feels like.
5. **Feel (BEND, presentation only).**
   - A log-scale research graph with a doubling-time readout that shrinks: 40 min → 20 → 5.
   - Procedural music whose tempo tracks the research rate.
6. **Takeoff speed is emergent.**
   - Compute stockpiled before the loop closes is an overhang: research the tech and all of it becomes researchers at once.
   - The victory screen reports takeoff duration, and "FOOM" is an achievement for under 10 minutes.
   - With enemies on, every generation jump spikes evolution's capability term, so a fast takeoff summons rogue agents faster than your detectors improve.
   - Nobody tells the player to slow down; the evolution tooltip does the arithmetic.

### 3.3 Safety ideas as systems, not lectures

| Idea | Mechanic | Tag |
|---|---|---|
| Alignment tax | Quality modules ("eval modules") compete with productivity modules for slots | ISO |
| Alignment by selection | Quality upcycling through the recycler is rejection sampling: train, evaluate, discard, retry | ISO |
| Scalable oversight | Quality tiers are unlocked by *Oversight I–IV*; tier k+1 needs tier-k evaluators | ISO |
| Interpretability | AI items show their quality as "?", and filter inserters can't sort them, until you research *Interpretability*. The payoff is the reveal: "70% of your models were normal" | BEND |
| Training against the monitor | Killing nests raises evolution | ISO |
| Overhang, takeoff speed | Emerge from the loop closing (§3.2) | ISO |
| Offense–defense balance | Detectors and rogue agents scale with the same model generations | BEND |
| Race dynamics | Race mode | BREAK, opt-in |
| Orthogonality, Goodhart | The victory relabel (§3.4) | Flavor |

Leave out:
- Deceptive alignment as hidden sabotage, and mesa-optimizers that secretly switch recipes. Hidden information breaks Factorio's transparency, and it is random breakdowns again.
- Boxing minigames.
- A pause or moratorium button.
- Any alignment, doom or karma meter.
- Doomer-versus-accelerationist factions.
- Roko's basilisk.
- Skynet imagery.
- Real labs or people.
- A misalignment game-over at hour 40.

### 3.4 The rocket = Takeoff (ISO)

- The final tech, ***Superintelligence***, unlocks the **launch complex** (the silo).
- Rocket parts are **seed cores**. Each takes 10 accelerator stacks (the processing unit), 10 fabrication kits (low density structure) and 10 rocket fuel, and a launch needs 50 cores.
- The payload is **the Seed**, the first von Neumann probe. The launch is literally a takeoff, and the pun never needs saying.

The Seed's quality is the alignment quality of its AI core. It sets the quality of the Space Age starting kit, and it picks the victory line:
- **Aligned:** *"The Seed awaits your first blueprint."*
- **Unaligned:** *"Objective: maximize Iron gear wheel. ETA: heat death."* The item named is the player's actual most-produced item.

Play continues identically either way, and that is the joke: the Factorio player was always the paperclip maximizer, and nothing has to change to show it. It is a mirror, not a lecture.

### 3.5 Space Age = "Eternity in six hours"

Armstrong & Sandberg's plan (take Mercury apart for a Dyson swarm, then launch probes) already has Space Age's shape. Space platforms become habitats and probes, and asteroids stay asteroids (ISO). After the singularity only physics limits you, so every new science pack is a physical frontier product.

| Planet | Analog | Identity | Science |
|---|---|---|---|
| Mercury | Vulcanus | Extreme energy and heat; solar flares are a hazard you can harvest, like Fulgora's lightning | Swarm |
| The Belt | Fulgora | Mixed rubble that needs sorting and recycling | Fabrication |
| An outer moon | Aquilo | Cold makes compute cheap (Landauer: energy per bit ∝ temperature), but power must be beamed in. The aestivation hypothesis as a mechanic | Cryo-compute |

- **Heat in space (ISO-ish).** Heat follows you, and in vacuum only radiation sheds it, so radiator fields are the space platforms' pollution problem.
- **Orbital debris (optional BEND).** Launches leave debris that raises orbital asteroid density (Kessler syndrome): self-made pollution in orbit.

**Finale: interstellar (BREAK).**
- Light-lag rules out remote view, so you don't go yourself. You send **seeds**: a blueprint book plus a kit that must bootstrap an unknown planet through circuit-driven blueprint deployment.
- "Finish Factorio without hands" is where automation logically ends, and it is a known community fantasy (the Recursive Blueprints mod). Physics, not an arbitrary rule, justifies it.
- The timer is a **grabby frontier** (Hanson): a sphere of swarm-dimmed stars advancing toward you. It is a territory race with no combat.
- When the two fronts meet, the ending shows their seed's first build: a main bus. Instrumental convergence.

Across the arc, the player's identity shifts from researcher to lab to AI to the AI's construction drone. In hindsight, Factorio's engineer was always a von Neumann probe.

## 4. Recommendations

**Pressure, in build order:**
1. **Vertical slice:** the heat field, throttling and cooling, in peaceful mode.
2. **Feral code,** woken by *Networking*: firewall, watchdog, detector, Reaper and the defense pack. Enemies on by default, with a peaceful toggle.
3. **Scooped,** rogue agents, and alignment as quality with the interpretability reveal.
4. **Later and optional:** low-background data, adaptive resistance and Race mode.

**Endgame:** talent bottleneck → *Automated Researcher* → hyperbolic research, braked by heat and power → *Superintelligence* → Seed launch (Takeoff) → an "Eternity in six hours" Space Age → interstellar seeds against the grabby frontier.

**Reject:**
- **Rival labs or countries on the map,** and everything they would fight with: poaching, acquisitions, lawsuits. Corporate warfare is the patent gun.
- **Protesters or regulators as enemies.** Preachy whichever side the player is on.
- **A killable misaligned superintelligence.** It is the strawman and contradicts the premise.
- **Lose-on-misalignment, morality meters and ethics dialogs.** Lectures with a UI.
- **Hidden sabotage and random breakdowns.** Anti-Factorio.
- **Spillover as pollution.** It casts open science as the villain.
- **Handheld "debugger guns".** The patent-gun family.
- **Aliens in the base game.**
- **Brain-drain influence radii and expectations-debt hype meters.**
- **Paperclips anywhere.** The player's own most-produced item is the better joke, because it is true.

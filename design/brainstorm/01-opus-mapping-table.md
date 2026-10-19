# Factorio → AI research: the systematic mapping table

Legend: **Iso** = isomorphism to Factorio's mechanic, **Res** = thematic resonance (both 1–5); **Cr** = cringe risk (L/M/H). **ISO** keeps the mechanic, **BEND** = small deliberate deviation, **BREAK** = large one. **Bold** = my pick. *Rhyme* = the real history or economics of AI already has the Factorio structure.

## 0. What the table converges on

Factorio needs little bending, because its growth model already is the one the takeoff debate argues about: rival inputs (items) produce non-rival ideas (techs), research raises the productivity of production *and of research*, and the factory builds its own builders. Its arc (hand-craft, automate, then automate the automating) is the Bitter Lesson followed by RSI. The physical stack can stay literal, since frontier AI is a physical industry (chips, power, cooling); that keeps top-down 2D and the endless map honest. The theme concentrates where it rhymes: data, science, modules, bots, quality, the rocket. Three layers, kept strictly apart:

- **Matter** (rival, on belts): ores, chips, tokens, checkpoints on hardware.
- **Effort** (rival, consumed): science packs = papers.
- **Knowledge** (non-rival): the tech tree and the blueprint library.

Opening: 1945, with pre-war ideas (Boole, Gödel, Turing) pre-researched. The crash site is a decommissioned wartime radar lab (MIT's Rad Lab closed that year: salvage magnetrons and vacuum tubes); the map is Bush's *Science, the Endless Frontier* (also 1945); "frontier lab" is already the industry's word for the destination. Vertical slice: the Nauvis equivalent up to blue science (ores and archives, tokenizer, belts, desks, crawl refinery, steam, three pack types, labs), no enemies, slop pollution added second.

## 1. Player and world

| System | Candidate | Iso | Res | Cr | Mark |
|---|---|---|---|---|---|
| Player & hand-crafting | **Researcher avatar: walks, mines by hand, hand-crafts (derives, codes, labels). *Rhyme:* the Bitter Lesson. Hand-crafting is what scaled automation beats; an early tech "Expert Systems" that buffs hand-crafting speed tells the joke once.** | 5 | 5 | L | ISO |
| | Invisible director moving researchers as units/items | 2 | 3 | M | BREAK: loses reach, walking, hand-feeding |
| | You are the seed AI in a robot body | 5 | 4 | M | ISO, but *Universal Paperclips* did it, and it contradicts a 1945 start |
| Map, terrain, fog | **Endless physical world (a fictional continent); water cools datacenters; cliffs, trees, radar as-is.** | 5 | 4 | L | ISO |
| | Idea space (regions = fields, fog = unknown unknowns): as the main map / as one expansion planet ("Latent": SAE probes mine features) | 2 / 4 | 5 | L | BREAK (belts and poles mean nothing there) / BEND (a fresh terrain logic, confined to one planet) |
| | Cyberspace grid (belts = buses) | 4 | 3 | M | BEND: Tron, and 1945 has no cyberspace |
| | One building, extended by purchase | 2 | 3 | L | BREAK: kills exploration |
| Resources & depletion | **Physical ores (iron, copper, silica sand, coal) plus solid data deposits: archives of text, later code and images. *Rhyme:* the data wall (Villalobos et al.: public text used up ~2026–32) is literal depletion; rarer deposits lie farther out.** | 5 | 5 | L | ISO |
| | Open problems as ore: low-hanging fruit near spawn gets picked clean (needs the idea-space map) | 4 | 4 | L | ISO |
| | Funding pools as ore | 4 | 2 | M | ISO |
| | Talent as ore | 4 | 3 | H | ISO |
| Mining | **Scrapers and OCR rigs on deposits; the burner drill is a Mechanical Turk. *Rhyme:* von Kempelen's 1770 automaton had a human inside; its namesake platform labelled ImageNet. Gated patches as with uranium: video needs speech-to-text.** | 5 | 5 | L | ISO |
| | Annotators placed on patches | 4 | 3 | M | ISO |

## 2. Production

| System | Candidate | Iso | Res | Cr | Mark |
|---|---|---|---|---|---|
| Smelting & intermediates | **Two chains. Physical: plates → logic board → CPU → accelerator (Factorio's green/red/blue circuits already are the chip ladder). Data: a tokenizer "smelts" archive ore into token ingots stamped *Aa*, *{ }*, *▦*, legible at belt scale.** | 5 | 4 | L | ISO |
| | Knowledge on belts: observation → finding → theory → method | 4 | 4 | M | ISO; illegible, buzzword soup |
| Belts, undergrounds, splitters | **Literal belts, tier skins by era; undergrounds as PCB vias; filter splitter = classifier. *Rhyme:* players already call their spine a "main bus".** | 5 | 2 | L | ISO |
| | Pneumatic tubes (1950s offices) | 4 | 3 | L | ISO; hides the items |
| Inserters | **Robot arms as-is; filter inserter = classifier.** | 5 | 2 | L | ISO |
| | Interns ("graduate student descent") | 5 | 3 | M | ISO |
| Assemblers & recipes | **Fabricators (literal) plus research desks whose tiers are the RSI story: grad-student desk → research group → lab team → AI researcher, the last built from accelerators and your own trained model. *Rhyme:* Chinchilla as a recipe ratio, "pretrain: 1 HBM stack + 20 token crates".** | 5 | 5 | L | ISO (crafting categories, like SA's foundry) |
| | Institutes as buildings | 4 | 3 | L | ISO; scale mismatch, and needs money |
| Fluids & oil | **"Data is the new oil", literally. The web crawl arrives mid-game, as oil does and as the web did before deep learning. Crawl wells → refinery (dedup, filter) → clean prose / code / noisy text; cracking = model rephrasing (WRAP); coal liquefaction = synthetic data; sulfur = the toxic fraction you need anyway (classifiers, red-team sets); no mixing = no contamination. *Rhymes:* data engineering already speaks fluid (pipelines, lakes, streams); pumpjack decay = repeated epochs (≈ fresh up to ~4, Muennighoff et al. 2023).** | 5 | 5 | L | ISO |
| | Talent as a second fluid: university springs, pipelines, brain drain; advanced processing needs raters as advanced oil processing needs water | 4 | 4 | L–M | ISO |

## 3. Power, science, compute

| System | Candidate | Iso | Res | Cr | Mark |
|---|---|---|---|---|---|
| Power & poles | **Literal electricity: steam → solar + batteries → nuclear (→ fusion). *Rhyme:* frontier AI is power-bound (reactor restarts, on-site gas turbines); "GPU-poor" is a brownout.** | 5 | 5 | L | ISO |
| | Funding as power: grants (boilers burn proposals) → VC (solar; night = AI winter; accumulators = runway) → revenue (nuclear) | 3 | 4 | M | BEND: poles lose meaning |
| | Compute as a second grid fed by datacenters | 3 | 5 | L | BEND: doubles a non-spatial puzzle (see modules) |
| Burner vs electric | **Burner entities are human-staffed and burn coffee ("a mathematician is a device for turning coffee into theorems", Rényi); electric ones are machines. The fuel type tells the labor-substitution story.** | 5 | 5 | L–M | ISO |
| | Vacuum-tube machines that burn tubes as fuel (ENIAC's failed often) | 5 | 3 | L | ISO |
| Science packs, labs, tech | **Packs are papers, told apart by colour and cover glyph (as Factorio's flasks differ in colour and shape): Proof (red: paper + coffee), Benchmark (green), Red-team report (military; red-teaming is military vocabulary), Scaling law (blue; cover: a straight line on log-log axes), Deployment report (purple), Agent eval (yellow), Discovery (white, written by your models). Labs are labs. 2.0's trigger techs = discovery by doing. *Rhyme:* infinite research's rising cost = "ideas are getting harder to find" (Bloom et al. 2020).** | 5 | 5 | L | ISO |
| | Labs as venues (reading group → conference → journal) | 5 | 4 | L–M | ISO, but frontier labs stopped publishing, so the late game has no venues |
| | Packs are experiments, labs are clusters running them | 5 | 4 | L | ISO |
| Modules & beacons | **This is where compute lives. Speed module = accelerator card (PCIe slots are module slots); productivity = algorithmic efficiency; efficiency = quantization; quality = verifiers. Beacon = cluster rack lending its cards to neighbouring desks. *Rhyme:* 2.0's 1/√n beacon profile is communication overhead (Amdahl).** | 5 | 5 | L | ISO |
| | Beacon = spillover hub (the Bell Labs/PARC effect) | 5 | 4 | L | ISO |
| | Alignment tax: speed = capability (more pollution), efficiency = safety | 5 | 4 | M | ISO; casts safety as pure overhead, which RLHF's history contradicts |
| | Senior staff as modules, managers as efficiency modules | 5 | 3 | H | ISO |

## 4. Pressure

| System | Candidate | Iso | Res | Cr | Mark |
|---|---|---|---|---|---|
| Pollution | **Slop: compute emits synthetic content that spreads like pollution and lowers the purity of data deposits it covers. *Rhymes:* model collapse (Shumailov et al. 2024); "low-background" pre-2022 data, named after pre-1945 steel (the start year).** | 4 | 5 | L–M | BEND: pollution works without biters; layout and timing matter |
| | Unaligned optimization pressure, absorbed by oversight, spawning feral agents | 5 | 4 | M–H | ISO; misalignment is a property of models, not an ambient gas, and capabilities-as-dirt is a stance |
| | Literal emissions for literal fauna | 5 | 2 | L | ISO |
| | Hype that attracts journalists and regulators | 4 | 3 | H | ISO |
| Biters, evolution, expansion | Alien fauna as-is (wink: the 1947 Mark II moth; or Hanson's grabby aliens as a distant clock) | 5 | 2 | L | ISO; fauna on an Earth-like 1945 map |
| | Rival labs or countries as nests (poaching raids, expansion = new offices); regulators as creeping no-build zones | 3 | 4 | H | ISO; patent guns |
| | Feral optimizers and worms (Factorio has worms; Morris 1988, Morris II 2024); turrets = monitors; SA's captive spawner = a boxed model organism | 5 | 4 | M–H | ISO; evil-robot trope |
| | **Split the job, no combat: slop for footprint pressure; walled gardens that grow around deposits your crawlers touch (Consent in Crisis, 2024), cleared by delivering licensing deals; evolution = the web's synthetic fraction.** | 3 | 4 | L | BREAK: pressure you route around instead of shoot, territory you negotiate for |
| | Goodhart pressure: capable agents emit *hollow* items that pass inserters but fail downstream; verifiers are your turrets; evolution = capability outrunning oversight | 2 | 5 | L–M | BREAK: late game only; Fulgora-style sorting plus an oversight arms race |
| Military & defense | **Drop for the slice; the military pack survives as the Red-team report (robustness research, no guns).** | 1 | 4 | L | BREAK: the slice stays pure logistics; the tier survives as research |
| | Walls and turrets literal, if fauna stays | 5 | 1 | L | ISO |

## 5. Logistics and automation

| System | Candidate | Iso | Res | Cr | Mark |
|---|---|---|---|---|---|
| Trains | **Literal freight plus drive wagons for bulk data. *Rhyme:* Tanenbaum's "station wagon full of tapes"; AWS Snowmobile.** | 5 | 3 | L | ISO |
| | Fiber backbone; trains = packets, signals = congestion control | 4 | 3 | L | ISO |
| Logistic & construction bots | **AI agents: construction bots are coding agents building blueprints, logistic bots run errands, worker-robot-speed research is agent capability, the personal roboport is your copilot. Their arrival is the AI arriving: your product starts doing your job.** | 5 | 5 | L | ISO |
| | Drones | 5 | 2 | L | ISO |
| Circuit network | **Threshold logic: decider combinator = McCulloch–Pitts neuron (1943), arithmetic combinator = weighted sum; "Cybernetics" (Wiener, 1948) unlocks wires; a perceptron is buildable.** | 5 | 5 | L | ISO |
| | Scripting terminal instead of combinators | 2 | 3 | L | BREAK |
| Blueprints | **Open source: the blueprint library is Factorio's other non-rival layer; construction agents implement repos.** | 5 | 4 | L | ISO |
| | Lab protocols / methods sections | 5 | 3 | L | ISO |

## 6. Endgame and expansion

| System | Candidate | Iso | Res | Cr | Mark |
|---|---|---|---|---|---|
| Rocket / win | **Silo = training cluster; rocket parts = training steps (compute × curated data × insight); the progress bar is a falling loss curve; launch = a frontier model, and the first one is the base-game win. The satellite is the post-training payload: a base model without it yields no science.** | 5 | 5 | L | ISO |
| | Singularity as a regime: win when research's returns outrun its rising cost (r > 1) | 3 | 5 | L | BEND: the explosion is felt, not a cutscene |
| | Payload = alignment spec; launching without one ends badly | 5 | 4 | H | ISO; a choice with a correct answer is a sermon |
| | Dyson swarm / uploads | 4 | 3 | M–H | ISO |
| SA planets | **AI-for-science domains, close to 1:1 with DeepMind's portfolio: Gleba = biology (AlphaFold; spoilage is just biology), Vulcanus = materials and fabs (GNoME; foundry = fab), Fulgora = the archive and chip design (scrap = old literature recycled into "rediscovered" parts, resist naming whose; EM plant = AlphaChip), Aquilo = cryogenic physics (tokamak control, dilution fridges), shattered planet = Vinge's horizon. Promethium already says Prometheus.** | 5 | 5 | L | ISO |
| | Eras as planets (academia → industry → cyberspace → orbit) | 4 | 4 | L | BEND: scope risk |
| Quality | **Best-of-N with a verifier: quality modules + recycler = rejection sampling / expert iteration (STaR); legendary = SOTA.** | 5 | 5 | L | ISO |
| | Distillation, or review grades (workshop → oral) | 3 | 3 | M | ISO |
| Spoilage | **Benchmarks spoil (contamination, saturation); "SOTA result" spoils into "Baseline", still usable.** | 5 | 5 | L | ISO |
| | Results go stale or get scooped | 5 | 4 | L–M | ISO |
| | Hardware depreciation | 5 | 3 | L | ISO |
| Space platforms | **Orbital datacenters, now a real proposal (Google's Suncatcher): sun without night, asteroid-fed, debris defense.** | 5 | 4 | L | ISO |
| | Self-play arenas: asteroids = self-generated data | 4 | 4 | L | ISO |

## 7. No good mapping

| System | Handling |
|---|---|
| Personal weapons, tank, artillery | Drop. |
| Armor and equipment grid | As-is, as personal kit; the personal roboport is the copilot. |
| Car, spidertron | Keep; spidertron as a teleoperated robot. |
| Fish | Drop. |
| Wood, rocks, bricks, concrete, landfill, cliff explosives, day/night | As-is: the physical layer needs no theme. |
| Uranium and Kovarex | Literal; reuse Kovarex's catalytic shape for copying models (§8). |
| Repair packs | As-is; optional BEND that gives bots and repair packs a job without biters: big clusters fail in proportion to size (Llama 3 logged 419 unexpected interruptions in 54 days). |
| Walls, turrets | Only with fauna. |

## 8. "Technology": item or node? And non-rivalry

Both, never the same thing; Factorio already splits them. The **idea** is a tech node: non-rival, researched once, used by every machine forever. The **paper** is a science pack: the rival cost of the idea, consumed the way researcher-time is. The **engineered technology** is an item made with the unlocked recipe. So "theory → application paper → engineered technology" spans three layers, not one belt. (Putting Bush's linear model on belts, by letting higher packs consume lower ones, is a BEND that inflates red-pack demand for little fun.) Money doesn't fit as a resource: anything you can buy you needn't build, which dissolves the logistics puzzle, one reason Factorio has no market.

Non-rivalry doesn't clash with conservation if the layers stay disciplined. Factorio has two non-rival layers (techs, blueprints) and one rival layer; Romer (1990) makes the same split. Items are *embodiments*: tokens on disks, weights loaded onto accelerators, papers as person-months. Where copying should feel cheap, use catalysis as Kovarex does: "instantiate agent: 1 checkpoint (returned) + 1 accelerator → 1 AI researcher". That makes Karnofsky's "duplicator" a logistics fact: once one good model exists, the binding constraint is accelerators, which is the real one. Kovarex even needs a 40-unit seed before it multiplies: seed AI.

## 9. The five most elegant mappings

1. **Tech tree = Romer, infinite research = Jones, singularity = r > 1.** Factorio is already a semi-endogenous growth model whose researchers (labs) are built from output, and it already ships an RSI loop (lab speed; SA's research productivity) with returns kept below 1. AI-researcher tiers that push returns per level past cost growth put the game into the explosive regime of software-intelligence-explosion models. Parameters, not new mechanics.
2. **Data is the new oil.** The whole oil chain transfers; depletion is the data wall; pumpjack decay is repeated epochs; the arc human data → web → synthetic → self-play is ore → oil → liquefaction → space.
3. **Compute lives in modules and beacons.** Accelerator cards in slots, cluster racks lending them to neighbours, 1/√n as communication overhead. It answers "should compute be a second grid?" with no new system.
4. **Quality = best-of-N with a verifier.** SA's upcycling loop is rejection sampling, unchanged.
5. **Slop pollution.** The one BEND that pays for itself: pollution matters without biters, rewards keeping compute away from archives, makes low-background deposits worth racing for, and closes on the 1945 rhyme.

Runners-up: the Bitter Lesson arc (hand-crafting → coffee-burning humans → machines → AI desks); the silo's loss-curve progress bar with post-training as the satellite; McCulloch–Pitts combinators; SA planets as AI-for-science; spoilage as benchmark contamination.

## 10. The three hardest unsolved problems

1. **Biters.** Nothing is isomorphic, resonant and cringe-free at once. Fauna don't belong on an Earth-like 1945 map; rivals, regulators and protesters are smart humans who become strawmen once you shoot them; feral AIs drift into the evil-robot trope and misstate the threat model LessWrong actually argues about (competent deception, not swarms). Best lead: split the job (slop for footprint pressure, walled gardens for territory, Goodhart pressure as the late-game threat that scales with your own capability). Whether that beats defending a perimeter is unknown; prototype peaceful first and keep the pressure systems modular.
2. **Making the singularity feel different from ordinary growth, and ending it without a sermon.** Factorio is already exponential and bottlenecked on the player; a real explosion removes the player, and watching isn't playing. Leads: a late tech that lets the factory place its own blueprints; a win defined by crossing r > 1; end text as dry as Factorio's. Alignment should enter only as mechanics (post-training payload, verifiers versus hollow items), never as a choice with a correct answer.
3. **Academia → big labs without money or people.** The arc is about funding and talent, which Factorio deliberately lacks: money on belts dissolves logistics, money as power costs the literal-power rhyme, people as items reads grim. Scale and building skins carry the arc (hand-crafting → burner → electric → AI) but not its texture: grant cycles, hype, poaching, being scooped. The cheapest lead is the field as a background timeline that discounts techs it has already found (diffusion) and can scoop your priority (Merton), with no combat and no currency.

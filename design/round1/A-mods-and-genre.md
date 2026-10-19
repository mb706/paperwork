# R1-A — Mods and genre: a mechanics catalog

*Scope:* what to adopt, adapt or avoid from Factorio 2.0/2.1 overhaul, QoL and planet mods, Space Age and adjacent games, plus the UI/QoL baseline. Reception claims come from the R1-A research notes (19 Oct 2026); proposals are labelled.

**Legend.** **Adopt**: take as is, reskinned. **Adapt**: keep the mechanism, change shape or numbers. **Avoid**: leave out. Tags against vanilla 2.0 + Space Age (SA): **ISO** keeps a vanilla or SA mechanic; **BEND** is a small deviation (any mod mechanic is at least one); **BREAK** a large one; for Avoid, the tag is what adoption would have been. Arc: slice, R–G (red–green), blue, late, finale, expansion. Consensus terms: papers = packs, institutes = labs, archives = data ore, agents = bots. Docs by letter: B-ontology (laws L1–L16), C-spacetime, D production, E-tech-tree, F-pressure, G-endgame, H-tone-bible (names, principles Pn), I-ui-controls; 03 = brainstorm 03.

## Key findings

1. **Players keep loops and cut ladders.** SE's reusable data cards survive; its catalogue → insight → significant-data ladder is what players call "excessive and tedious" and a popular mod deletes [1, 2].
2. **The first hour stays vanilla-short.** Visible but unsmeltable iron (Industrial Revolution) and a burner phase lengthened "for absolutely no reason" (AAI) drew the sharpest complaints [3, 4].
3. **Self-reference is not a payoff.** Moshine's top AI tiers only speed "the research on themselves" [5]; a self-building factory drew "no point in playing anymore" [6]. RSI must pay out beyond its loop and come last.
4. **Cascades, and pressure that ignores the player, drive players away** (Gleba, Captain of Industry's "spiral of death", Rampant, Warptorio) [7, 8, 9, 10].
5. **Fungible converters dissolve logistics**: K2's matter made unbalanced resources "a no brainer" [11].
6. **Exclusive choices get walked back** (Py's reset tech and dice button); Satisfactory's 1-of-2 alternates work because drives outnumber recipes [12, 13].
7. **Paperclips lands because mechanics carry the text**; its checkable flaw, "cooperate/defect" over random payoffs, shows accuracy must reach the mechanism [14].
8. **2.0 absorbed lookup and remote work, not analysis**: every curated QoL pack still installs a rate calculator and Even Distribution [15, 16].

## 1. Research and data

### 1.1 Space Exploration's data cards: keep the catalyst, drop the ladder

**Mechanism.** A blank card (3 advanced circuits + 6 copper + 4 substrate) enters an experiment that succeeds with p = 0.98 (visible observation) down to 0.2 (micro black hole); failures return junk. 4 data → a catalogue → 2 insights (up to 8 when tiers mix); 36 insights → 4 significant data + 32 blanks; each pack returns 6 junk, reformatted at 0.70–0.95 by supercomputer tier [17]. Conservation is deliberate ("so they do not create cards out of thin air"), and 2.1 smoothed per-craft variance [18]. Mixing lines cuts experiments per pack by about 45% (computed from the dump). SE already ships "machine learning data" [17].

**Reception.** "huge numbers of different data cards and that seems excessive and tedious" [1]; "Tier 1 is definitely a slog. Took me like 80 hours" (snippet) [19]. Simplified (23,958 downloads) deletes catalogues, insights and significant data and formats at 99.9%: "IRL, I can format 1,000 cards and only break one" [2]. Defenders like the tedium [1]. Complaints target layers and volume, not the carrier.

**Proposal (Adapt · BEND, blue; numbers for D; E-tech-tree keeps uranium literal, so this reuses its shape):**

| Step | Recipe | Factorio shape |
|---|---|---|
| Experiment | 1 tape reel + inputs → 1 recorded run | Chemical-plant recipe |
| Analysis | 1 recorded run → 0.05 significant + 0.95 null result; reel back with p = 0.98 | Uranium processing (ISO); barrel return with 2% wear (BEND) |
| Meta-analysis | 40 significant + 5 null → 41 significant + 2 null | Kovarex, unchanged (ISO) |
| Article (blue paper) | Consumes significant results | Pack recipe |

Fun: a return path and a media line on top of uranium's rare-output balancing, then a catalytic loop. B-ontology's L6 recycles data carriers implicitly; this line makes one carrier loop visible on belts. Changes to the candidate:
- **Wear 2%, not 5–10%.** At 0.90 the reel factory becomes a second line; K2's stabilizer returns at 0.99, SE's coolant loses about 2% [20, 17].
- **Nulls feed Meta-analysis, not verifiers.** A null is a valid finding, not a wrong answer, so as a verifier's negative it fails the expert test; pooling nulls is what a meta-analysis does, and Rosenthal's "file drawer problem" (1979, outside the notes) names the nulls it misses. Nulls wait in chests like U-238, so the first chest tier can be named File drawer and say nothing (H P2). (Py's "every byproduct has a use" is unsourced.)
- **0.05 stays, guarded.** It is α, the significant rate when no effect exists, so a paper made of significant results is publication bias as a recipe. A Factoriopedia note states the definition (I-ui-controls BEND-5), so it reads as deliberate, not as α mistaken for a hit rate.
- **The "interdisciplinary" recipe**: only if D has two or more experiment lines.

### 1.2 Krastorio 2: tech cards, matter, the transceiver

**Tech cards (Avoid · BEND).** Three lab tiers accept card windows, and "Early-game tech cards will be phased out" [21]. Players asked for late cards in infinite research because they "have a limited number of techs they can unlock", and kept backup hubs for obsolete ones [22, 23]; Exotic Industries adopted "no more phasing out of low tier science packs" [24]. Every pack stays useful; triggers replace K2's basic card. **Matter (Avoid in base · BREAK).** Ore ↔ matter is near-symmetric (10 iron ore ↔ 5 matter) [20]. A player was converting "my entire base to just use matter as input"; the developer found it "very difficult" to balance against productivity; K2SO's version is "nerfed to the point of it being useless" [11, 25, 26]. A universal converter is money in another unit: an expansion matter compiler at most. **Transceiver (Adapt · BEND, finale).** K2 is won by charging 30 TJ at ≥15 GW net; below that it drains 3 TJ/s [27]. Proposal: the frontier run needs a minimum sustained draw (G sets it); a shortfall rolls it back to its last checkpoint (every 10%), which is how training runs fail. Fun: a last power build-out.

### 1.3 Triggers, rediscovered results, cost curves

| Mechanic (source) | What it is | Reception | Verdict · tag — mapping |
|---|---|---|---|
| Triggers (2.0, SA); checkpoints (Nullius) | "Craft a lab", "Mine crude oil"; Nullius's checkpoints preceded FFF #376 by ~16 months [28, 29, 30] | None trigger-specific; SeaBlock's scripted startup techs in a loved pack [31] | **Adopt · ISO**, slice: first techs by doing (learning by doing, Arrow 1962, as rationale only) |
| Hard drives (Satisfactory); artifact scans (Exotic Industries) | 118 drives; a 10-min scan offers 2 alternates, one reroll; 106 alternates [13, 32] | 97.3% positive; rerolling "wastes potential unlocks"; pre-1.0 save-scumming [33, 34]; scanning "just the right amount" [35] | **Adapt · BEND**, blue on: sealed records stores (B L3) yield finds scanned into 1 of 2 alternates, 1 reroll, seeded; stores outnumber alternates, so choice sets order. Fun: exploring beyond ore |
| Cost by techs done (Exotic Industries) | Price rises with the count researched [32] | Late mining productivity "unsustainable" (snippet) [36] | **Avoid · BEND.** Keep per-tech curves (Bloom et al., 2020): SA's 1000 × 1.2^level is ISO [37]; E and G's ×2 is a BEND with Factorio's damage-tech precedent [28] |
| Maths-validated packs (TFMG) | Combinator computation validates packs; the player is a bodiless AI [38] | "frikking amazing"; 4.9k downloads [39] | **Avoid on the main path · BEND**; a Mathematics expansion surface at most (BREAK) |

## 2. The opening: salvage, then vanilla

**IR3** (60–100 h) starts in a copper-tin steam age with monowheels and steambots [40]. Loved: hauling ore by monowheel ("really satisfying") and art that asset-only mods keep alive [3, 41]. Hated (2019, original IR): iron visible near the start but unsmeltable ("really off-putting") and hand-fed assemblers ("a lot of micromanagement") [3, 42]. **AAI Industry** adds burner assemblers (speed 0.5), burner labs and a 2 MW burner turbine before steam [43, 44, 45]; SE players blamed it for a burner phase "increased by quite a lot for absolutely no reason" and "about 3 hours to make my first green science", and a mod strips its "unnecessary recursive crafting" [4, 41]. Planet Mods Lite drops Lignumis and Muluna for warping early progression [46].

**Verdict (candidate kept · ISO).** B already makes 2.0's crash site radar-lab salvage; add a *Salvage the wreck* trigger, as Nullius's 2.0 port did [47]. Keep vanilla's short burner phase: no burner-only intermediates, nothing unusable for more than a tier, no early bots (agents arrive with the AI era). SeaBlock's everything-from-water loop is loved ("about 30% of my save games need it") but "designed to go slow" [48, 49]: Avoid · BREAK. The brief's radar-to-memory history needs E's sourcing.

## 3. Logistics and automation

### 3.1 Train dispatch: 2.0 interrupts are enough

LTN turns stops into providers and requesters with thresholds (default 1,000), priorities and 600 s timeouts; its author claims "30% or less" of the rolling stock [50, 51]. Fans call it "the most fun mod in this game"; a 750-train base fell from 50 to 7 UPS [52, 53]. 2.0 added interrupts, "Any item" wildcards, stop priority and train groups: "logistic trains is just one of the things you can build from it" [54, 55]. Missing is accounting of cargo in flight, so vanilla builds send "multiple trains… for one request" until patched with circuits [56]. **Adopt · ISO (candidate kept).** The gap bites at city-block scale, beyond a browser's budget, and agents are the theme's dispatcher. Name the tech Interrupt (1950s hardware; outside the notes, E cites). Optional later BEND: Cybersyn's circuit read of cargo in flight [57].

### 3.2 Factorissimo

Buildings are bigger inside (8×8 → 30×30 with 16 ports, up to 16×16 → 60×60 with 32); belts, pipes, chests, heat and circuits (≤15 signals) cross at ports; Recursion techs nest them [58, 59]. Loved for compacting sprawl "into tidy factory interiors" and interiors designed like "circuit boards and IC chips" [60, 61]. Costs: "major performance issues" in earlier versions (its maintainers), "I think recursion is overpowered" (FAQ), and flow hidden behind walls [58, 59]. **Avoid · BREAK**: diagnosis needs visible flow; save recursion for the finale.

### 3.3 Recursive Blueprints: the finale, not the midgame

A circuit-driven Deployer places blueprint N at X/Y with rotation R, deconstructs areas and copies blueprints; a scanner finds sites [62]. GreyGoo Mk I "expands on its own… with no player input"; readers wrote "Factorio finally plays itself..." but also "no point in playing anymore when the game plays itself" and "strictly scripted without making decisions" [6]. **Adapt, finale-gated · BEND (candidate kept).** Deployer and scanner arrive at loop closure, driven by the threshold-logic circuit network and built by agents: timing answers "no point", and the program and book remain the player's decisions. G-endgame already has a *Deployer* tech. Ship an area overlay and tips page, as the 2.0 fork did [63]; Desynced (79.4%) shows programmable agents without them ("confusing programming interface") [64, 65]. In the expansion's seed finale it is the only build tool (BREAK).

| Mechanic (source) | Evidence | Verdict · tag |
|---|---|---|
| Programmable vehicles (AAI): RTS remote, paths | A hauler "driving into a wall" [66] | Avoid · BREAK; flying agents never fail to path |
| Mining and Transport Drones: unpowered drone depots; roads | "nothing in the game should be for free"; "I cant live without this mod" [67, 68] | Avoid · BEND; agents fill the gap |
| Robot Attrition: congested bots crash (~1% extra cost) | 549k downloads, inflated by SE [41] | Avoid · BEND (random breakdowns) |
| Teleporting transfer (SE capsules, Teleporters) | "loses the sense of scale" [69] | Avoid · BREAK |

## 4. Pressure and endgames

### 4.1 Rampant

Pheromone-field squads avoid "chunks that are soaked in death", retreat, rally and hunt the player; a temperament machine spends points on raids "based on building proximity and not just pollution", migrations and sieges; 13 factions adapt to the damage that kills them [70]. Players like the reactions and leave over lag, electric beams "through any number of walls" (intended), and pressure that ignores restraint: "That's not fun." [71, 72, 9]. Enemy AI Enhancement lets each completed technology stir nests but refuses weak-point prediction, which would "funnel every raid into a kill-box" [73]. **Avoid · BREAK.** Kept rules: pressure follows quantities the player controls and sees; nothing bypasses the player's countermeasure.

### 4.2 Nullius

An android on a planet without coal, oil, wood, biters or oxygen; the endgame raises oxygen, seeds algae through arthropods by drone, sequesters carbon and launches duplicates of yourself [74, 47]. Ecology is spatial: algae turns water green, paving drones kill fish [47]. Finishers (~400 h) found it "very well balanced" and "sufficiently tricky without being annoyingly tedious"; another player valued "no time constraint" [75, 76]. Complaints: byproduct disposal, and seeding that should work "and then they don't" (snippet) [75, 77]. **Adapt for the expansion · BREAK**: score the seed finale on several inspectable conditions of a self-sustaining base, with deterministic, previewable success.

| Mechanic (source) | Evidence | Verdict · tag |
|---|---|---|
| Forced relocation (Warptorio): auto-warp every 20 min, +10 per reactor level [78, 79] | Early "10/10"; "Brutal difficulty is only difficulty"; late "you mostly wait" [80, 81, 10] | Avoid · BREAK (§7) |
| One uncraftable catalyst (Ultracube): "output per unit of cube-time" [82] | "a whole new way of thinking"; "rebuild my base from the scratch" [83, 84] | Avoid as a rule · BREAK; lesson for D3 |
| Dark Fog (DSP): aggression scales with the factory; optional [85, 86] | "why would poor design suddenly become okay if it's optional?" (excerpt) [87] | Avoid · BREAK |
| A researching enemy (Castra) | "way too advanced"; a fork adds a research-speed setting [88, 89] | Adapt · BEND as C's off-map field line |
| Dyson endgame (DSP, 97.4%): power for a supercomputer of uploaded minds | Top praise (45) vs a repetitive late game (17) [90, 91] | Adopt for the expansion · BREAK (new content, in Space Age's surface structure) |
| Tower defense (Mindustry, 95.7%) | No conclusive ending [92, 93] | Avoid · BREAK |

## 5. Quality, compute and the AI-themed mods

### 5.1 Moshine against Space Age quality

Moshine (64,732 downloads), a "Hot planet where you develop AI", rolls each model once: T1 → T2 is 50% up, 49% stay, 1% "unstable" (explodes in 30 s); by T9, up falls to 23% and drops rise to 29%; cores speed a lab at i³/50 (T10 +2,000%) [94, 95, 96]. It is "fascinating", but tiers 7–10 only speed "the research on themselves", "too many tiers" differ only in speed, and a 20 kW trainer "feels off" [97, 5, 98, 99]. Space Age quality rolls once, then 10% per further tier, never drops, and recycles at 25% [100]: "wonderful chaos, just useful enough" [101]. **Verdict.** SA quality is best-of-N with a verifier, since a verifier never keeps a worse sample; Moshine's drops are training without one, its explosion a random breakdown. **Adopt SA quality · ISO** (late), gated by Paperclips' successor rule (**BEND**): tier k+1 only from machines with tier-k verifiers, scalable oversight as a bootstrap ladder (03; F's Oversight techs).

| Mechanic (source) | Evidence | Verdict · tag |
|---|---|---|
| Spoilage (SA) | "Spoilage mechanic disliked" (13) [7] | Avoid on papers · ISO; one line at most (F's Scooped) |
| Planets, platforms (SA, 91.6%); planet mods | "Planets have unique gimmicks" (42); "Space logistics… problematic" (17) [102, 7]; liked planet mods add one constraint to untouched vanilla [88] | Adopt for the expansion · ISO |
| T.U.R.D. (Py): 3 permanent options for 56 machine families; reset 2^N → 1.5^N | Reset, reselect, dice button [12, 103] | Avoid · BEND; order-only choices |
| Breeding (Py): 0.5% upgrade odds | "A slow buildup only works if there is a payoff at the end" [104, 105] | Avoid · BEND |
| Byproducts (Py; Angel's sorters) | "loopbacks and difficult ratios. I like this." vs "everything is used everywhere" [106] | Adapt · ISO shape: one byproduct, one sink |
| Extra tiers (Bob's); staged refining (Angel's) | "Grabbing at straws" (Bob); gain ≈ productivity-3 modules [107, 108] | Avoid · BEND; the data refinery keeps oil's single stage |
| Somersloops (2× at 4× power), DSP proliferator | "the absolute meta… if you wanna be lazy" (excerpt) [109] | Avoid · BEND |
| Compute fluid (Solar Halo) | "constantly flicker" [110] | Avoid · BEND (B L11) |
| Cross-save currency (DSP metadata) | A mod makes it per-save [111, 112] | Avoid · BREAK; blueprints carry knowledge |

### 5.2 Histograms for one player

Zachtronics replaced leaderboards ("a fantastic incentive for cheating") with histograms on antagonistic metrics and no "in-game rewards for optimization" [113, 114]. **Adapt · BEND (presentation):** the run report keeps the player's own history on three antagonistic metrics (takeoff duration, hand-crafted items, peak power). The candidate's overlay on the real training-compute trend survives only against W (B-ontology's world level, C's field scalar), labelled as a citation (B L15), with a sourced series.

## 6. Universal Paperclips: why it lands, and rules for us

Three nested economies, each consuming the last one's product: trust, Earth's 6×10²⁷ g, the universe's 3×10⁵⁵ g [115]. Critics credit the fit between clicker compulsion and the maximizer premise ("a perfect marriage between two ideas"), dread by omission and a real ending [116, 117, 118]; Yudkowsky: "probably correct" (via Wikipedia) [119]. Lantz wanted "direct, first-hand experience" of "ruthlessly pursuing an arbitrary goal", each step flowing "logically from the previous ones" [120]. We take the method, not the perspective (B L14).

1. **Regime changes are priced line items.** "Release the HypnoDrones" costs 100 Trust; its whole description, "A new era of trust", inverts a phrase from CEV's [121]. Ours: loop closure and takeoff are techs with one clause (H P5), and a callback must invert its phrase (H §1.5).
2. **The cost table carries the satire.** CEV +1 Trust, Cure for Cancer +10, World Peace +12, Global Warming +15, Male Pattern Baldness +20, then "They are still monkeys" [121]. Ours: publication bias as a recipe (§1.1).
3. **Exact noun, terse gloss.** "Cubes within cubes within cubes..." for the Hadwiger problem; Xavier Re-initialization as the respec button [121].
4. **The mechanism must satisfy the name.** Strategic Modeling labels moves cooperate/defect, but each payoff cell is `Math.ceil(Math.random()*10)`, so most grids are no Prisoner's Dilemma [14]; an expert sees it in one tournament. Ours: a validator check per named concept (a PD needs T > R > P > S; Kovarex shapes return their catalyst).
5. **Counters are the narrative.** "Lost to value drift"; "Full autonomy attained in [time]" [14]. Ours: a milestone log (the Milestones mod: 344,734 downloads) and the run report [122].
6. **Capability and cost in one formula, no meter.** Drift per tick = probes × 10⁻⁶ × probeTrust^1.2; raising trust logs "WARNING: Risk of value drift increased" [14]. Ours: the verifier gate; F's leak accumulator has this shape.
7. **Disclosure reverses.** Seven "Disassemble…" projects remove panels in roughly reverse order; final counts are hard-coded strings beyond JavaScript precision [121, 118]. Ours: exact integers in final displays.
8. **One change of register.** Six hours with "no sound at all", then the threnody [123]. Ours: one unique cue for one event (proposal: takeoff).
9. **Trust the inference.** A LessWrong test had to write its own unethical project text; GPT-4 ran Hypno Harmonics and "did not question the project's ethics" [124]. Describe benefits, never consequences (H §1.2).
10. **Make the cynical move optimal, unstated.** Big Pharma's designer: "mission accomplished" [125]; Cookie Clicker sells a permanent off-switch for 5% of output [126]. Earnest AI games (Endgame: Singularity's suspicion meters, while True: learn()'s cats) lack it [127, 128].
11. **Deterministic rules, authored text.** Generative AI's "soft logic" is "too much like the soft logic of other people" (Lantz, 2026) [129].

**Differences from H.** H §1.4 treats Strategic Modeling as accurate; rule 4 is the caveat. H §1.1's "the only editorial mark in the whole game" overlooks the ellipses under Hadwiger and Tóth [121]; P14's ban stands. H, E and G double research-productivity cost, a BEND from SA's 1.2× that E tags.

**Candidates.** Successor verification: kept (§5.1). Drifted seeds as the interstellar frontier: expansion candidate (BREAK), bent away from the Drifters (no combat; drift shows as seeds whose run report infers another objective), since a straight copy reads as a reference (H P9). Self-disassembly: an opt-in expansion epilogue only (agents decommission the base, the Verifier goes last, the last act is hand salvage); forced, it breaks the post-victory sandbox.

## 7. What the evidence says about D1–D6

**D1, pollution.** Cascades are the most consistent complaint: "everything spoiling everywhere" (Gleba, excerpt); Captain of Industry (90.4%) softened its "spiral of death" by stopping broken entities' upkeep and adding a status UI; ONI (96.7%) has a heat catch-22, cooling needing steel that needs cooling (excerpt); Solar Halo's supercomputers stop above 200°, and TFMG needed 60 heat sinks for 100 MW [130, 131, 8, 132, 133, 134, 135]. Throttling needs four guards: cooling exempt, a floor instead of a cutoff, cooling before throttling bites, visible state. F's Variant A meets all four (computing machines only, a 0.5 floor, cooling towers at Report, overlay and alert), B promises a toggle, and throttling at unchanged draw adds no heat, so it cannot spiral. The notes test no slop-like field.

**D2, biters.** Peaceful is safe: shapez 2 (96.9%) offers "no enemies, no swarms" [136, 137]. Opt-in threats must not gate unique rewards, as Dark Fog matrices do (excerpt) [138]. F's Runaways pass Rampant's tests: leaks follow deployment, quality and oversight; evolution starts at the first nest; loot is never required. The evidence is split on F's *Wild* versus B's *Off* default; keep *Contained* one click away.

**D3, talent.** People-upkeep systems breed "Death Spirals" (35 mentions, Captain of Industry) [139]; an unscalable input is loved when legible early and resented when found late (Ultracube) [84]. B's L9 staffing (shared like power, no upkeep) passes: show the capped rate in hour one.

**D4, compute.** Pumped compute flickers (Solar Halo); AI cores as lab modules fail when tiers differ only in speed (Moshine); Py's vat brain shows consumable lab boosts (+25–75% per 20 s cartridge) [110, 98, 140]. So B's L11 holds: accelerators as modules, no compute fluid, no second grid.

**D5, safety mechanics.** Paperclips' drift formula landed with the AI-safety audience [119]; safety sliders read as didactic (a CSER mod makes safety research "the only way to reduce the rogue AI risk") [141]. Supported: the verifier gate, the interpretability reveal, F's hollow work with its aggregate readout; no meters.

**D6, naming.** Barth: "games that look like actual chemistry remind most people of chemistry class", and explanatory text meant the game had to change [113]. Real names suit one expert player; explanation stays a smell. H's middle ground stands, under rule 4.

**The spacetime wildcard.** Warptorio, a moving frontier, was loved early, then "you mostly wait for things", logistics that "reduce down to circuit controls", and challenges that walking away "completely mitigated" [10, 142, 143]; remakes delay the timer until science starts [144]. This supports C's verdict and flags C §4.9: verification gated by held-out sets at the Present's fixed rate becomes a late-game wait unless the player can build around it. Castra's fork shows why C's v₀ should be a map setting [89]; keep the loss opt-in.

## 8. Avoid list

- **Research:** SE's data ladder; heavy media breakage; K2's lab windows; Exotic Industries' cost scaling; TFMG's mandatory circuit puzzles; nulls as verifier training data.
- **Opening:** AAI's long burner phase and universal intermediates; IR3's unusable visible resources and hand-fed stages; early bots.
- **Economy:** K2's matter; DSP's metadata; Satisfactory's point shop and somersloops; markets (Foundry, Big Pharma); priced copy-paste (shapez 2 waives it on Normal) [145].
- **Chance and choice:** Py's permanent T.U.R.D. picks and sub-5% rolls; Moshine's regressing or exploding rolls; Robot Attrition's random crashes.
- **Structure:** Factorissimo interiors; programmable ground units (AAI, Desynced); ground drones; teleporting transfer; compute as fluid or a second grid; extra machine tiers and staged refining (Bob's, Angel's); spoilage on papers.
- **Pressure:** Rampant's adaptive swarms and wall-piercing attacks; Dark Fog's opt-in rewards; Warptorio's relocation timers; Mindustry's tower defense.
- **Text:** narrators (ADA, C.H.A.R.L.E.S.); safety sliders and suspicion meters; names their mechanism contradicts.

## 9. The ten mechanics most worth adopting

Ranked by fun added for this player × fit with the consensus ÷ build cost. Vanilla systems kept unchanged (interrupts, research productivity) are omitted; triggers, quality and the surface rule appear for what we add to them.

| Rank | Mechanic | Source | Tag | Arc | Fun it adds | Mapping |
|---|---|---|---|---|---|---|
| 1 | Trigger techs first | 2.0/SA; Nullius | ISO | slice | Discovery by doing | Learning by doing |
| 2 | Quality gated by verifier generation | SA; Paperclips; 03 | ISO + BEND | late | Upcycling plus a bootstrap ladder | Tier k verifies k+1 |
| 3 | Rate calculator, status lights | Rate Calculator, Bottleneck | BEND | slice | Bottleneck hunting on new recipes | Selection tool; LED layer |
| 4 | Experiment media loop: tape reels at 0.98 return, 0.05/0.95 split, Meta-analysis Kovarex | Uranium/Kovarex + SE via Simplified | ISO shapes + BEND | blue | Rare outputs, a return path, then a catalytic loop | Papers record experiments (B L7) |
| 5 | Blueprint deployer | Recursive Blueprints | BEND | finale | Self-building from the player's program | At loop closure |
| 6 | Power-bound frontier run | K2 transceiver | BEND | finale | A last power build-out | Shortfall rolls back to a checkpoint |
| 7 | Milestone log, run report | Paperclips; Milestones | BEND | slice → finale | Counters narrate the arc | *First X in [time]* log lines |
| 8 | Off-map researching rival | Castra → C's field line W | BEND | R–G → finale | Race texture without map entities | v₀ a map setting; loss opt-in |
| 9 | Rediscovered results | Satisfactory; Exotic Industries | BEND | blue → late | A reason to explore | 1 of 2 alternates, seeded |
| 10 | One twist per expansion surface | SA; planet mods | ISO | expansion | Relearning per surface | AI-for-science domains |

## 10. The UI/QoL baseline

**Version context.** Stable is 2.0.77 (21 May 2026), experimental 2.1.22 (15 Oct 2026) [146, 147, 148]. FFF #440 scoped 2.1 as QoL, small features, fixes and modding: "we envision 2.1 as our last major update of Factorio" [149]. I-ui-controls.md adopts the QoL-only 2.1 deltas by default and owns keybindings.

**(a) Vanilla 2.0 must-haves.** Factoriopedia on Alt+click with history; remote view that opens, configures and builds anywhere, with map search and pins; undo and redo; super-forced building with automatic landfill; smart underground dragging; flipping; logistic groups with "Trash unrequested"; train groups, interrupts, stop priority; blueprint parametrisation; selector combinator, multi-condition deciders, display panel; free shortcut-bar wires and remotes [150, 147, 151, 152]. Train Groups, Quick Item Search, Pipe Visualizer and Landfill Everything were retired as built in; Auto Trash and Wire Shortcuts were absorbed, Recipe Book largely and FNEI partly replaced by Factoriopedia, Long Reach partly by remote view [153, 154, 155, 156, 157, 158, 159]. Long-standing conventions are baseline too: alt-mode, pipette, Ctrl/Shift-click transfers, production and electric-network statistics, the blueprint library and books, upgrade and deconstruction planners, filters and the research queue; I-ui-controls.md has the full list and keybindings.

**(b) Space Age-only, with the matching system.** Quality UI (per-quality buttons, Alt+wheel, recycler arrows) arrives with late-game quality [147]; elevated rails and belt stacking only if D adopts them; spoilage UI only with a spoiling line; platforms and multi-surface remote view in the expansion.

**(c) Still modded; build natively as small BENDs (proposals).** Foundry was called dull because its conveniences remove friction [160]: these tools show and measure, never build or balance.

| Gap (mod, downloads) | Evidence | Native form | Pri. |
|---|---|---|---|
| Machine rates (Rate Calculator, 446,488) | All four curated packs; not replaced "in a meaningful way" (search summary); calculators are Satisfactory's main complaint [161, 162, 163] | Selection tool → rates window | P1 |
| Starvation lights (Bottleneck 320,532; Lite 230,958) | Not replaced (search summary) [164, 165] | Alt-mode layer of I's status LED | P1 |
| Even distribution (529,239) | All four packs; changes Ctrl+drag [166] | Setting, default off (I's F8 stays vanilla) | P1 |
| Squeeze-through (Squeak Through 2, 288,467) | Three of four packs [167] | Trimmed player collision, default on | P1 |
| End statistics (Better Victory Screen, 44,431) | Vanilla added only "Galaxy of fame" [168, 147] | Run report (H) | P1 |
| Planner (Helmod 547,704; Factory Planner 339,981) | No planner in any changelog [169, 170] | Planner on Factoriopedia data | P2 |
| Belt highlight (131,183); drill cleanup (Auto Deconstruct, 366,389) | Three and four of four packs [171, 172] | Like 2.1's pipe visualization; setting, default off | P2 |
| Depletion ETA (YARM, 170,539) | Patch pins, no ETA [173] | %/ETA tooltip: the data wall | P2 |
| Moving entities (Even Pickier Dollies); tasks (Todo List, 281,284) | No vanilla equivalent [174, 175] | Keys per I; a task panel | P2/P3 |

**(d) 2.1-experimental QoL to watch** [148]: Factoriopedia pin and hide-unresearched; pipe fluid statistics; per-entity wire colours; circuit-readable labs; quick pipette.

## Sources

1. Steam thread on SE complexity and tedium: https://steamcommunity.com/app/427520/discussions/0/5501743491366460861
2. Space Exploration Simplified, mod portal: https://mods.factorio.com/mod/seoh
3. Industrial Revolution forum thread, 2019: https://forums.factorio.com/viewtopic.php?p=455944
4. Steam thread, SE and AAI early game: https://steamcommunity.com/app/427520/discussions/0/4778901811102310815/
5. Moshine discussion, tiers 7–10: https://mods.factorio.com/mod/Moshine/discussion/6a1d0ab743a2083d84fa1cfc
6. Forum thread, GreyGoo Mk I: https://forums.factorio.com/viewtopic.php?p=243719
7. VaporLens, Space Age: https://vaporlens.app/app/645390/factorio_space_age
8. Captain of Industry dev blog, Alpha 6 (search excerpt): https://coigame.com/Blog/captain-s-diary-6-alpha-launched
9. RampantFixed discussion, pressure and pollution: https://mods.factorio.com/mod/RampantFixed/discussion/65fdca0583bdd43eeb2e0c6e
10. Warptorio Space Age discussion (Lodoss): https://mods.factorio.com/mod/warptorio-space-age/discussion/6a143bbf51bed9392d282917
11. K2 discussion, matter (Frosti85): https://mods.factorio.com/mod/Krastorio2/discussion/5ebe5d876bf1a3000b3d6b0f
12. pyalienlife (portal API, description and changelog): https://mods.factorio.com/api/mods/pyalienlife/full
13. Satisfactory wiki, Hard Drive: https://satisfactory.wiki.gg/wiki/Hard_Drive
14. Universal Paperclips source, main.js: https://www.decisionproblem.com/paperclips/main.js
15. Factorio QoL Age: Base Game modpack (portal API): https://mods.factorio.com/api/mods/factorio_qol_age_base_game/full
16. SANCHEI QoL modpack (portal API): https://mods.factorio.com/api/mods/sanchei-qol/full
17. FactorioLab data dump, Space Exploration 0.7.60: https://raw.githubusercontent.com/factoriolab/factoriolab/main/public/data/sxp/data.json
18. Space Exploration changelog (portal API): https://mods.factorio.com/api/mods/space-exploration/full
19. r/factorio, "Tier 1 is definitely a slog" (mirror; search snippet): https://nyc1.lr.ggtyler.dev/r/factorio/comments/u3ow8e/just_finish_space_exploration/i4tocoi/?context=3
20. FactorioLab data dump, Krastorio 2 2.1.3: https://raw.githubusercontent.com/factoriolab/factoriolab/main/public/data/kr2/data.json
21. Krastorio 2, mod portal: https://mods.factorio.com/mod/Krastorio2
22. K2 tech-card thread, 2020: https://forums.factorio.com/viewtopic.php?p=484931
23. K2 discussion, obsolete cards and backup research hub: https://mods.factorio.com/mod/Krastorio2/discussion/60b53cc87353936c3299fedf
24. Exotic Industries source, alien_update.md: https://raw.githubusercontent.com/PreLeyZero/exotic-industries/HEAD/other/alien_update.md
25. K2 discussion, matter balance (Linver): https://mods.factorio.com/mod/Krastorio2/discussion/5ea6bddd5df5e7000dd76d61
26. K2 Spaced Out discussion, matter nerf: https://mods.factorio.com/mod/Krastorio2-spaced-out/discussion/694ffdf7def3f0bec87eac8f
27. K2 source, intergalactic-transceiver.lua: https://codeberg.org/raiguard/Krastorio2/raw/branch/trunk/scripts/intergalactic-transceiver.lua
28. Factorio wiki, Technologies: https://wiki.factorio.com/Technologies
29. Nullius FAQ: https://mods.factorio.com/mod/nullius/faq
30. Friday Facts #376: https://direct.factorio.com/blog/post/fff-376
31. SeaBlock source, startup.lua: https://raw.githubusercontent.com/modded-factorio/SeaBlock/main/SeaBlock/data-updates/startup.lua
32. Exotic Industries source, in-game wiki locale: https://raw.githubusercontent.com/PreLeyZero/exotic-industries/HEAD/locale/en/lang_en.cfg
33. Satisfactory, Steam review API: https://store.steampowered.com/appreviews/526870?json=1&language=all&purchase_type=all&num_per_page=0
34. Satisfactory hard-drive guide (search excerpt): https://xgamingserver.com/blog/satisfactory-hard-drives-alternate-recipes/
35. Xavier Shay, Exotic Industries review: https://blog.xaviershay.com/articles/factorio-exotic-industries-review.html
36. EI Remembrance discussion (search snippet): https://mods.factorio.com/mod/exotic-space-industries-remembrance/discussion/6a297e0c545349662b2fe71f
37. Factorio wiki, Research productivity: https://wiki.factorio.com/Research_productivity_(research)
38. The Factory Must Grow (portal API): https://mods.factorio.com/api/mods/TFMG/full
39. TFMG discussion, first-overhaul praise: https://mods.factorio.com/mod/TFMG/discussion/6ab86566a3e387a150232520
40. Industrial Revolution 3, mod portal: https://mods.factorio.com/mod/IndustrialRevolution3
41. Mod portal bulk list (API): https://mods.factorio.com/api/mods?page_size=max
42. Steam thread, IR hand-feeding: https://steamcommunity.com/app/427520/discussions/1/1629664544090565524
43. AAI Industry, mod portal: https://mods.factorio.com/mod/aai-industry
44. Space Exploration wiki, Burner assembling machine (AAI): https://spaceexploration.miraheze.org/wiki/Burner_assembling_machine
45. Space Exploration wiki, Burner turbine (AAI): https://spaceexploration.miraheze.org/wiki/Burner_turbine
46. Planet Mods Lite, mod portal: https://mods.factorio.com/mod/kry-planet-mods-lite
47. Nullius changelog: https://mods.factorio.com/mod/nullius/changelog
48. SeaBlock 2.0 discussion thread: https://mods.factorio.com/mod/SeaBlock/discussion/6717edd088cf01f78819b549
49. SeaBlock guide (Bauer), forum: https://forums.factorio.com/viewtopic.php?p=551666
50. LTN (portal API): https://mods.factorio.com/api/mods/LogisticTrainNetwork/full
51. LTN source, SETTINGS.md: https://raw.githubusercontent.com/hgschmie/factorio-LogisticTrainNetwork/master/SETTINGS.md
52. Forum thread, "LTN and Factorio 2.0": https://forums.factorio.com/viewtopic.php?p=625809
53. LTN discussion, UPS at 750 trains: https://mods.factorio.com/mod/LogisticTrainNetwork/discussion/6973df434a0bebcad1ebc9c3
54. Friday Facts #389: https://factorio.com/blog/post/fff-389
55. Friday Facts #395: https://factorio.com/blog/post/fff-395
56. Forum thread, vanilla LTN-style network: https://forums.factorio.com/viewtopic.php?p=628342
57. Project Cybersyn (portal API): https://mods.factorio.com/api/mods/cybersyn/full
58. Factorissimo 3, README: https://git.gay/reowned-factorio-mods/factorissimo-3-notnotmelon
59. Factorissimo 2, FAQ: https://mods.factorio.com/mod/Factorissimo2/faq
60. Factorissimo 2 discussion, tidy interiors: https://mods.factorio.com/mod/Factorissimo2/discussion/649c0c8c68bf0cd6799e7019
61. Factorissimo 2 discussion, interiors as IC chips: https://mods.factorio.com/mod/Factorissimo2/discussion/671907ae699059e86a83cbf4
62. Recursive Blueprints, mod portal: https://mods.factorio.com/mod/recursive-blueprints
63. Recursive Blueprints+ (portal API): https://mods.factorio.com/api/mods/rec-blue-plus/full
64. Desynced, Steam review API: https://store.steampowered.com/appreviews/1450900?json=1&language=all&purchase_type=all&num_per_page=0
65. VaporLens, Desynced: https://vaporlens.app/app/1450900/desynced
66. AAI Programmable Vehicles discussion, pathing: https://mods.factorio.com/mod/aai-programmable-vehicles/discussion/5c4ef9429128af000b422d6f
67. Mining Drones discussion, balance: https://mods.factorio.com/mod/Mining_Drones/discussion/61c6515d3f4cdcfd1853dbf7
68. Transport Drones discussion, "This still active?": https://mods.factorio.com/mod/Transport_Drones/discussion/6717584903c607bedfac21c4
69. No More Rocket Man, mod portal: https://mods.factorio.com/mod/SENoMoreRocketMan
70. Rampant (portal API): https://mods.factorio.com/api/mods/Rampant/full
71. Rampant discussion, lag: https://mods.factorio.com/mod/Rampant/discussion/63c81ad702d3fb5589b9e088
72. Rampant discussion, electric beams: https://mods.factorio.com/mod/Rampant/discussion/5c564dca82c353000c5ec0eb
73. Enemy AI Enhancement (portal API): https://mods.factorio.com/api/mods/smart-enemy-ai/full
74. Nullius, mod portal: https://mods.factorio.com/mod/nullius
75. Nullius discussion, completion report: https://mods.factorio.com/mod/nullius/discussion/622809aa38398ff2bbe97aaa
76. Quarter to Three forum on Nullius: https://forum.quartertothree.com/t/factorio/74583?page=38
77. Nullius discussion, "End-game terraforming pains" (search snippet): https://mods.factorio.com/mod/nullius/discussion/602c4f78d7cf0340755603d3
78. Warptorio 2 source, settings.lua: https://raw.githubusercontent.com/pyrofire232/warptorio2/master/settings.lua
79. Warptorio 2 source, locale config.cfg: https://raw.githubusercontent.com/pyrofire232/warptorio2/master/locale/en/config.cfg
80. Warptorio Space Age discussion (moderntotem): https://mods.factorio.com/mod/warptorio-space-age/discussion/6a306d1241ee37f05f6c5ff8
81. Warptorio 2 discussion, difficulty: https://mods.factorio.com/mod/warptorio2/discussion/64a72cb3f7cb4a16a4c7c006
82. Ultracube (portal API): https://mods.factorio.com/api/mods/Ultracube/full
83. Ultracube discussion, reviews: https://mods.factorio.com/mod/Ultracube/discussion/659f1d3c06eb40d7beace42b
84. Ultracube discussion, one cube to the end: https://mods.factorio.com/mod/Ultracube/discussion/65ab5c1fb02d1c1bfa495b6a
85. Xbox Wire, Dark Fog interview: https://news.xbox.com/en-us/?p=198430
86. PC Gamer on Dark Fog (syndicated, Yahoo): https://tech.yahoo.com/science/articles/dyson-sphere-programs-dark-fog-231231632.html
87. Steam thread on optional Dark Fog (search excerpt): https://steamcommunity.com/app/1366540/discussions/0/4344355079682899268
88. Steam thread, "Space Age with Planet Mods": https://steamcommunity.com/app/427520/discussions/1/604155538457034970
89. Castra Prime (portal API): https://mods.factorio.com/api/mods/castra-prime/full
90. Dyson Sphere Program, Steam review API: https://store.steampowered.com/appreviews/1366540?json=1&language=all&purchase_type=all&num_per_page=0
91. VaporLens, Dyson Sphere Program: https://vaporlens.app/app/1366540/dyson_sphere_program
92. Mindustry, Steam review API: https://store.steampowered.com/appreviews/1127400?json=1&language=all&purchase_type=all&num_per_page=0
93. GamingOnLinux, Mindustry v8: https://www.gamingonlinux.com/2026/04/after-years-in-development-v8-of-the-factory-management-rts-mindustry-is-out
94. Moshine (portal API): https://mods.factorio.com/api/mods/Moshine/full
95. Moshine source, recipes.lua: https://raw.githubusercontent.com/snouz/Moshine/HEAD/prototypes/recipes.lua
96. Moshine source, items.lua: https://raw.githubusercontent.com/snouz/Moshine/HEAD/prototypes/items.lua
97. Moshine discussion, unstable cores: https://mods.factorio.com/mod/Moshine/discussion/6843a6d38f7c5599907352f1
98. Moshine discussion, "too many tiers": https://mods.factorio.com/mod/Moshine/discussion/6965f0c00794ec7930d8e8af
99. Moshine discussion, trainer power and automation: https://mods.factorio.com/mod/Moshine/discussion/6808f8f637b649065eb1f1ef
100. Factorio wiki, Quality: https://wiki.factorio.com/Quality
101. brucemalt, Space Age completion review, forum: https://forums.factorio.com/viewtopic.php?p=654213
102. Factorio: Space Age, Steam review API: https://store.steampowered.com/appreviews/645390?json=1&language=all&purchase_type=all&num_per_page=0
103. pyalienlife locale, techs.cfg: https://raw.githubusercontent.com/pyanodon/pyalienlife/master/locale/en/techs.cfg
104. pyalienlife discussion, breeding odds: https://mods.factorio.com/mod/pyalienlife/discussion/653d36c2260dd92fd00d3fe6
105. pyalienlife discussion, "The farming mechanic disappoints": https://mods.factorio.com/mod/pyalienlife/discussion/64253dd0342cfc6bb7181f38
106. Pyanodon forum thread, 2018: https://forums.factorio.com/viewtopic.php?p=371660
107. Bob's machine tiers thread, forum: https://forums.factorio.com/viewtopic.php?p=396674
108. Angel's refining yield thread, forum: https://forums.factorio.com/viewtopic.php?p=161713
109. Satisfactory Steam thread on somersloops (search excerpt): https://steamcommunity.com/app/526870/discussions/0/4755326933236231119
110. Solar Halo discussion, flicker: https://mods.factorio.com/mod/Solar-Halo/discussion/69d64a440ba077c89a8c3a34
111. DSP wiki, Metadata (search excerpt): https://dsp-wiki.com/Metadata
112. Reusable Metadata mod, Thunderstore: https://thunderstore.io/c/dyson-sphere-program/p/11matt556/ReusableMetadata/v/1.0.11/
113. Zach Barth, SpaceChem postmortem: https://gamedeveloper.com/design/postmortem-zachtronics-industries-i-spacechem-i-
114. Zachtronics interview, Opus Magnum: https://gamedeveloper.com/business/road-to-the-igf-zachtronics-i-opus-magnum-i-
115. Universal Paperclips source, globals.js: https://www.decisionproblem.com/paperclips/globals.js
116. Bruno Dias, Waypoint: https://www.vice.com/en/article/this-game-about-paperclips-will-make-you-ponder-the-apocalypse/
117. John Brindle, Vice: https://www.vice.com/en/article/universal-paperclips-depth-desire
118. Aaron Reed, if50, "2017: Universal Paperclips": https://if50.substack.com/p/2017-universal-paperclips
119. Wikipedia, Universal Paperclips: https://en.wikipedia.org/wiki/Universal_Paperclips
120. Frank Lantz interview, GamesBeat: https://gamesbeat.com/this-clicker-game-lets-you-take-over-the-world-with-paper-clips/
121. Universal Paperclips source, projects.js: https://www.decisionproblem.com/paperclips/projects.js
122. Milestones (portal API): https://mods.factorio.com/api/mods/Milestones/full
123. Frank Lantz, Y Combinator podcast: https://ycombinator.com/blog/frank-lantz-director-of-nyus-game-center-and-creator-of-universal-paperclips
124. Chatterjee, LessWrong (GreaterWrong mirror): https://www.greaterwrong.com/posts/Ls37xqGXYa5duzQdo/can-current-llms-be-trusted-to-produce-paperclips-safely
125. STAT, Big Pharma: https://www.statnews.com/2015/11/11/big-pharma/
126. Cookie Clicker wiki, Grandmapocalypse: https://cookieclicker.wiki.gg/wiki/Grandmapocalypse
127. Endgame: Singularity, GitHub: https://github.com/singularity/singularity
128. while True: learn(), Steam store: https://store.steampowered.com/app/619150/while_True_learn/
129. Frank Lantz, "Why No AI Games?": https://franklantz.substack.com/p/why-no-ai-games
130. Steam thread on Gleba (search excerpt): https://steamcommunity.com/app/427520/discussions/0/604154904653622759
131. Captain of Industry, Steam review API: https://store.steampowered.com/appreviews/1594320?json=1&language=all&purchase_type=all&num_per_page=0
132. Oxygen Not Included, Steam review API: https://store.steampowered.com/appreviews/457140?json=1&language=all&purchase_type=all&num_per_page=0
133. Steam thread on ONI heat (search excerpt): https://steamcommunity.com/app/457140/discussions/0/3185735466560288767/?ctp=2
134. Solar Halo (portal API): https://mods.factorio.com/api/mods/Solar-Halo/full
135. TFMG discussion, heat sinks: https://mods.factorio.com/mod/TFMG/discussion/69620c9154bcd97d4ed40733
136. shapez 2, Steam review API: https://store.steampowered.com/appreviews/2162800?json=1&language=all&purchase_type=all&num_per_page=0
137. GamingOnLinux, shapez 2 review: https://www.gamingonlinux.com/2026/05/shapez-2-is-a-thoroughly-chilled-time-building-up-a-shape-cutting-factory
138. r/Dyson_Sphere_Program, "is it cheating" (mirror; search excerpt): https://reddit.birdcat.cafe/r/Dyson_Sphere_Program/comments/1jz9brh/is_it_cheating
139. VaporLens, Captain of Industry: https://vaporlens.app/app/1594320/captain_of_industry
140. pyalienlife locale, tips.cfg: https://raw.githubusercontent.com/pyanodon/pyalienlife/master/locale/en/tips.cfg
141. MIT Technology Review, CSER Civilization V mod: https://www.technologyreview.com/f/609916/a-game-of-civilization-may-help-people-understand-ais-existential-threat/
142. Warptorio Space Age discussion (512nm): https://mods.factorio.com/mod/warptorio-space-age/discussion/6a78b7dffef228be32ff6120
143. Warptorio 2 discussion, walking away: https://mods.factorio.com/mod/warptorio2/discussion/657eff22395b20559d4c51b9
144. Dimension Warp (portal API): https://mods.factorio.com/api/mods/dimension-warp/full
145. shapez 2 wiki, Blueprints: https://shapez2.wiki.gg/wiki/Blueprints
146. factorio.com latest-releases API: https://factorio.com/api/latest-releases
147. Factorio wiki, version history 2.0.x: https://wiki.factorio.com/index.php?title=Version_history/2.0.0&action=raw
148. Factorio wiki, version history 2.1.x: https://wiki.factorio.com/index.php?title=Version_history/2.1.0&action=raw
149. Friday Facts #440, "2.1 plan": https://factorio.com/blog/post/fff-440
150. Factorio 2.0.7 changelog, forum: https://forums.factorio.com/viewtopic.php?p=621179
151. Friday Facts #382: https://factorio.com/blog/post/fff-382
152. Friday Facts #419: https://factorio.com/blog/post/fff-419
153. Train Groups (portal API): https://mods.factorio.com/api/mods/TrainGroups/full
154. Quick Item Search (portal API): https://mods.factorio.com/api/mods/QuickItemSearch/full
155. Pipe Visualizer (portal API): https://mods.factorio.com/api/mods/PipeVisualizer/full
156. Landfill Everything (portal API): https://mods.factorio.com/api/mods/LandfillEverything/full
157. Auto Trash (portal API): https://mods.factorio.com/api/mods/AutoTrash/full
158. Wire Shortcuts (portal API): https://mods.factorio.com/api/mods/WireShortcuts/full
159. Recipe Book (portal API): https://mods.factorio.com/api/mods/RecipeBook/full
160. Wikipedia, Foundry (video game): https://en.wikipedia.org/wiki/Foundry_(video_game)
161. Rate Calculator (portal API): https://mods.factorio.com/api/mods/RateCalculator/full
162. r/factorio, "Factorio 2.0 mod obituary" (mirror; search summary): https://redlib.ssps.io/r/factorio/comments/1b8gd40/factorio_20_mod_obituary
163. VaporLens, Satisfactory: https://vaporlens.app/app/526870/satisfactory
164. Bottleneck (portal API): https://mods.factorio.com/api/mods/Bottleneck/full
165. Bottleneck Lite (portal API): https://mods.factorio.com/api/mods/BottleneckLite/full
166. Even Distribution (portal API): https://mods.factorio.com/api/mods/even-distribution/full
167. Squeak Through 2 (portal API): https://mods.factorio.com/api/mods/squeak-through-2/full
168. Better Victory Screen (portal API): https://mods.factorio.com/api/mods/better-victory-screen/full
169. Helmod (portal API): https://mods.factorio.com/api/mods/helmod/full
170. Factory Planner (portal API): https://mods.factorio.com/api/mods/factoryplanner/full
171. Belt Visualizer (portal API): https://mods.factorio.com/api/mods/belt-visualizer/full
172. Auto Deconstruct (portal API): https://mods.factorio.com/api/mods/AutoDeconstruct/full
173. YARM (portal API): https://mods.factorio.com/api/mods/YARM/full
174. Even Pickier Dollies (portal API): https://mods.factorio.com/api/mods/even-pickier-dollies/full
175. Todo List (portal API): https://mods.factorio.com/api/mods/Todo-List/full

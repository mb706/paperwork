# R3-fun — Does the spec deliver Factorio's fun?

*Round 3 critic, fun lens. Read: BRIEF, spec 00–09 (02/05 generated), `data/*.yaml`, DECISIONS, brainstorm 05 (fun atoms F1–F17), A §2/§7, G §4, F's `calib3.py`. Validator: `0 errors, 0 warnings; 250 techs reachable in 26 waves`. Evidence script: `design/round3/fun-data/checks.py`, output in `checks-output.txt` beside it (re-runs F's chunk rule for power plants, sizes the experiment loop, Monte-Carlos the hour-one geometry, tables staffing against a veteran's lab count; run with `gamedev-python -I design/round3/fun-data/checks.py` from `/home/mewse/browsergame`). Numbers quoted below come from that script unless a spec section is cited.*

**Verdict in six lines.** The spec is Factorio with the identity reading on every belt, and the three new systems (heat, staffing, the world's text) are built the way the fun audit asked: on Factorio's own idioms (pollution engine, power coverage, evolution slot), legible before they bite, never a spiral. The endgame is the best thing in the document: the takeoff is a stopwatch the player sets by choosing when to close the loop, and the brakes are things you build. Two sets of *numbers* would, as written, turn the midgame into homework: the experiment loop's craft times make blue science a 30–120-Trainer build, and staffing supply is tuned to E's slow pacing, so the target player (a veteran who over-builds labs) is "Understaffed" from hour two and is told, in effect, that building more labs is wrong for the next ten hours. Both are data edits. Below them: one headline pressure (model collapse) that does nothing for a player who ignores quality, a nuclear plant that reads +900 K on the overlay, and an hour-one geometry that is not guaranteed to be compact.

---

## 1. Ranked issues

### Blockers (data changes; fix before coding)

#### FUN-01 · The experiment loop's craft times make blue science a Kovarex-scale build
- **Location.** `recipes.yaml` `analysis` (12 s), `meta-analysis` / `meta-analysis-baselines` (60 s), `experiment` (5 s); 02 §7; 05 §7 Objection 1 (R2-D already flags it).
- **Evidence.** Factorio's blue pack spends one chemical plant on sulfur. Here the sulfur slot is a 5%-yield recipe plus a Kovarex loop, on the main path:

| Article rate | State | Trainers on Analysis | Trainers on Meta-analysis | Data plants (Experiment) | Prose/s | Crawl per Article |
|---|---|---|---|---|---|---|
| 15/min | before Meta-analysis | 30 | — | 12.5 | 37.5 | 333 (4.0× Factorio's crude) |
| 60/min | with Meta-analysis | 16.4 | 30 | 6.8 | 20.5 | 45 (0.55×) |
| 60/min | before Meta-analysis | 120 | — | 50 | 150 | 333 |

  Bootstrap to the first blue technology (*Accelerators*, 300 Articles) plus the 40-result seed for Meta-analysis: 3,800 Analysis runs = **12.7 Trainer-hours** (95 min on 8 Trainers), and *Meta-analysis* itself costs 200 Articles researched the expensive way. Thirty Trainers at the start of blue is 300 Processors and 300 steel, which is the whole early-blue chip budget. The joke (α = 0.05, the File drawer, "p < 0.05.") is excellent and must stay; the *times* are uranium's, and uranium feeds a trickle while this feeds the midgame's main pack. A veteran judges a mod at blue (F3, F4, F7), and this is where the game would read "a reskin with extra homework".
- **Fix (data only; keep α, the Kovarex shape, the items and the tooltips).**
  - `analysis`: time 12 → **1.2 s** (R2-D's own knob: uranium's time per ore, not per ten).
  - `meta-analysis` and `meta-analysis-baselines`: time 60 → **10 s**.
  - `experiment`: time 5 → **2 s**.
  - Resulting build at 60 Articles/min with Meta-analysis: 1.6 + 5 Trainers, 2.7 Data plants (Factorio: 1 chemical plant plus the oil it implies). Before Meta-analysis at 15/min: 3 Trainers, 5 Data plants, 37 prose/s. The bootstrap becomes 76 Trainer-minutes (10 min on 8 Trainers) and about 127,000 crawl: the grind moves from Trainers to the crawl well, which is what Factorio's blue is bound by, and gives the player a reason to tap a second exchange in blue.
  - Optional second lever, if 4× crude per pre-meta Article is still too much: `experiment` → **2 Recorded runs** per craft (two seeds on one benchmark). Pre-meta crawl per Article 167 (2×), steady state 23 (0.27×); Data plants halve. I would take the time fix first and let the balance agent decide this one; R2-D's pacing table (05 §7, "Blue, Meta-analysis running: 45.5 crawl") stays valid under the time fix alone.
  - At 1.2 s the 5% roll's Poisson noise averages out within a minute, so F13 ("no RNG in the core loop") is bent, not broken; the filter-inserter sort of Significant/Null results is uranium's puzzle in a place where it has a point.

#### FUN-02 · Staffing binds at hour two for the target player and punishes "build more labs" for ten hours
- **Location.** `meta.yaml` `staffing.t0`, `staffing.supply`; 01 §8.1, §8.8 (calibration), §14 #1; 09 §5.
- **Evidence.** 01 §8.8 calibrates supply so that the starting college "sits at the cap from Article on" *at E's pacing* (7–15 Seminars), and says "any player whose factory outruns that pace is staff-bound". The user is that player. Against a veteran's ordinary lab count:

| Game time | Seminars a veteran builds | Supply (T₀ = 8) | Satisfaction |
|---|---|---|---|
| 1 h | 10 | 9.4 | 94% |
| 2 h | 14 | 10.4 | 74% |
| 3 h | 20 | 11.4 | 57% |
| 6 h | 30 | 14.0 | 47% |
| 8 h | 40 | 15.6 | 39% |

  Total throughput is min(N, T) × speed bonuses, so from hour two every Seminar the player adds does nothing, and the yellow icon says so. The three answers 01 §8.8 offers are: two green lab-speed technologies (+50% in total), "wait for W", or claim another university, which means a research outpost 250–700 tiles away (01 §5.1, 09 §5) fed with every pack tier by train, for +6 or +10 staff. In hours 2–5 the player has no trains and no bots, so the only real answer is the two technologies. This damages F6 ("the factory must grow: research always wants more") and F8 for the whole factory-bound phase, which is most of the game, and it buys little: 01 §8.8 itself says the frontier runs, not staff, "are usually the longer pole" of G's plateau, and G §4.7 says Researchers "staff, they do not multiply", so loosening the cap changes neither the overhang logic nor the takeoff. A §7 D3's rule is "show the capped rate in hour one"; showing is enough, binding is not required.
- **Fix A (numbers; must do).** `t0`: starting-college 8 → **12**, college-town 6 → **8**, town 10 → **12**, city 20 → **24**, metropolis 40 → **48**. Supply: **T = T₀ × (1 + W/25) for W ≤ 40, then T₀ × (2.6 + (W − 40)/50)**. Starting college: 16.3 at 1 h, 22 at 3 h, 30 at 6 h, 33 at 8.3 h, 37 at closure. The veteran's 10/20/30/40 Seminars run at 100/100/100/83%. Hour one reads `Staff 100% · Ashford College: 16.3 supply, 10 demand`, which is the legibility A asked for without the punishment. The white technologies then take about 24 min of Seminar time at closure (327 Seminar-equivalents with lab speed ×3.5 and boost ×2.5), so the plateau is run-bound, as 01 §8.8 already expects. Keep demand = 1 per Seminar; do **not** adopt 01 §14 #1's harder variant (demand 1 + speed bonus), which would make modules on Seminars pointless.
- **Fix B (structure; recommended).** Give "claiming a university" a pole-run cost instead of a six-pack-train cost, and give the data-line network a job before Preprint (see FUN-07): the **Terminal** (`terminal`, 2×2, 30 kW; 5 Logic board + 5 Copper cable + 1 Data line), unlocked by *Time-sharing* (G27; add *Packet switching* to its prerequisites so data lines exist). Rule: *a Terminal placed inside a university's coverage joins that university to every staffing network that contains another Terminal on the same data-line network.* Tooltip: "Joins a university to a Seminar network over a data line." Coherent on the plane (L9: people reach you as staff within commuting range; Time-sharing's 1962 terminals extended that range by wire, which is the actual history), ISO in feel (an outpost that is a wire, like a big-pole run to a far patch), and it couples with containment: a data line from a campus into a Researcher-staffed Seminar block is a link (03 §3.3), so the convenience has the same price Switches and agents have. Research outposts by train remain possible for players who want them; *Town and gown* and *The endless frontier* still work.
- **Fix C (UI).** The University window (07 §7.2) lists the three levers as data, not advice: `Supply ×1.36 (field 1954)` · `Lab speed +0% (Citation index, Time-sharing)` · `Nearest other university: Mill Creek, 410 tiles N`.

### Major (fix in this design phase)

#### FUN-03 · Model collapse (P7) is inert for any player who does not use Comparators
- **Location.** 01 §7.4, 03 §2.2, 00 §8 P7, `meta.yaml` `world_text.exchange.synthetic`.
- **Evidence.** Before *Synthetic detection*, σ multiplies the training recipes' *quality chance*. 02 §6: "Without Comparators there is no roll." A player who ignores quality (most Factorio players, and quality is optional here too) never feels σ at all until an exchange closes; after detection the only effect is crawl × (1 − σ). So the "trade" in P7 ("quantity against quality, shown as two numbers") has one empty side, and the rational play is to never research *Synthetic detection* except as a prerequisite of *Watermarking*. The headline pressure "your deployment degrades what you train on" never reaches the player it is written for, and the Trainer's tooltip line reads as a warning about nothing.
- **Fix.** Before detection, every recipe in the training category runs at **speed × (1 − σ)** (the Trainer reads `Speed −31% (synthetic share)`, the same idiom as the heat throttle); keep the quality-chance penalty as a second effect for quality players. After detection: crawl × (1 − σ), no speed penalty. Both sides are now throughput, and the decision is *where* to pay: at the well if you are Trainer-bound, at the Trainer if you are crawl-bound. Achievement 12 (*The curse of recursion*) is unchanged. One line in 01 §7.4, 03 §2.2 and `meta.yaml`.

#### FUN-04 · A nuclear plant puts +900 K in its chunk; the plane breaks on the first reactor
- **Location.** 03 §1.1 (reactor emits 2× passed on, into the chunk of its centre), DECISIONS §18a; 07 §3.2 (scale tops at 70 °C).
- **Evidence.** F's update rule (03 §1.2, run with F's own `calib3.py` loop): a 2×2 reactor block (480 MW out, 960 MW emitted) settles at **+903 K** in its chunk (+375/+170/+84 K at 1/2/3 chunks); an Accelerator-class machine runs at 100% only from chunk 7 (224 tiles); even a lone reactor is +75 K; on a lake chunk still +593 K. The overlay shows "Chunk 917 °C" beside a rule that says nothing is ever damaged by heat and towns are untouched. This user applies H P3's expert test on the first tooltip, and *Heat island* (+30 K) fires on the first boiler row. The siting rule itself ("keep compute away from thermal plants") is good and should stay.
- **Fix.** Emit the conversion loss **at the generator that converts the steam or plasma**, pro rata to its output: a steam engine emits 2 × 0.9 MW, a turbine 2 × 5.82 MW, a fusion generator 2 × 50 MW; boilers, reactors, heat pipes and exchangers emit nothing (their heat is in the steam). Totals are identical to today's (a boiler's two engines emit 3.6 MW; a 2×2 block's turbines emit 960 MW), §18a's reactor special case disappears, and the 83 turbines of a 480 MW block spread the loss over the 6–12 chunks they occupy (+80–150 K peak instead of +900), on the shore where κ is 4×. It is also literally true: the condenser side is where a power station rejects its heat. Turbine tooltip: "5.8 MW from 500 °C steam. Rejects 11.6 MW."

#### FUN-05 · Hour one is two sites, and nothing guarantees the ores sit near the college
- **Location.** 01 §4 (starting patches 30–140 tiles from spawn, any direction), §9 (college edge 40–80 tiles, coverage square ≥ 60×60 buildable); 09 §4, §7.1.
- **Evidence.** Seminars must sit inside the college's 104×104 coverage square; Memos need gears from the iron patch. Monte Carlo of §4 + §9 as written: in **41% of seeds no starting patch lies inside coverage**; the iron patch is a median **46 tiles** from the coverage edge (90th percentile 114). Factorio's first labs sit beside the smelters; here the opening is ore site → belt or walk → research site, plus the lake. A §2 makes "the first hour stays vanilla-short" the rule and 09 §7.1 makes a first-hour failure a release blocker; the fix is one worldgen guarantee, cheaper than a failed playtest.
- **Fix.** Add to 01 §9: *the iron and copper starting patches lie inside the starting college's R = 48 coverage square, or within 32 tiles of its edge; the campus is placed on the footprint edge facing spawn when that edge has buildable land.* Keep the lake rule. The whole opening then fits in about 150 tiles, which is Factorio's.

#### FUN-06 · Exponential spread through a bot network turns one compromise into a base-wide stop in about four minutes, under the default preset
- **Location.** 03 §3.3 (every compromised machine copies itself each interval; the logistic-agent link covers "every susceptible machine inside the logistic area"), §9 #2.
- **Evidence.** In a late base every machine holding a Learned or Distilled controller is susceptible, and one agent-hub network with Logistic agents covers the base, so one tier-4 compromise reaches 1,024 machines in 200 s. The cure the spec offers at that point is a base-wide 30 s blackout. A §7 D1 says cascades are the most consistent complaint in the genre; this one is bounded (30 s) and self-inflicted (the player built the links), but the Leak bar warns of the *compromise*, not of the cluster's size, and the first time it happens it is a surprise that stops everything.
- **Fix.** Adopt R2-W's alternative as the rule: **each infection, not each machine, copies once per interval** (linear spread). A 40-hall block then takes 13 min to fall at tier 4, which is time to read the alert and act. Keep the containment overlay's cluster colouring so the cluster size is visible before anything leaks. Add two sentences to 03 §3.4 and a Tips entry: deconstructing a compromised machine cleans it (it is a power cycle), and a power switch on the main line is the off switch (*The off-switch game* already rewards it). Exponential spread can remain a Wild-only rule if F's drama is wanted there.

### Minor

#### FUN-07 · The second pipe network is bookkeeping until Preprint
- **Location.** 00 §8 E1; 02 §4 (Data line, Underground line, Repeater, Data lake, Data wagon, four filled drives); 10 §5.8.
- **Evidence.** Factorio 2.0 already refuses to mix fluids, so "a data line never connects to a pipe" removes a mistake class and adds no puzzle. The network's one real payoff, being a runaway link, arrives at Preprint; before that it is pipes with a cable-tray sprite and a parallel ladder of five entities and five items to learn. The refinery puzzle itself (2 in, 3 out, cracking, the j drift) is ISO and good.
- **Fix.** Keep it (coherence is cheap here), but let it earn its place early: the Terminal of FUN-02 B. Add no further data-side duplicates.

#### FUN-08 · Closure is a decision the player can make by accident, and the plateau is the preparation window nobody mentions
- **Location.** 04 §1 (step 5), §7; 07 §6.5, §15; 08 §5.3.
- **Evidence.** The takeoff clock starts on the first Research-hall card. The player who builds one hall to test it closes the loop with a 20-accelerator overhang; harmless (a slow takeoff is still a takeoff) but it is the pause debate's one decision, and the only sign is a log line afterwards. "The overhang" exists only in the run report.
- **Fix.** Handbook and tooltip line on the Research hall: "The first System card written here closes the loop." A Tips entry (08 §5.3's idiom) for *Automated research*: "Accelerators that exist when the loop closes are the overhang." No narration beyond that.

#### FUN-09 · Belt legibility collisions
- **Location.** `items.yaml` sprites: `dataset` ("sealed grey drive with an ice-cyan label band") vs `prose-drive` ("drive with an ice-cyan band"); `significant-result` (sheet, one cell boxed green) vs `null-result` (sheet, no box, grey edge); nine items share the grey-drive silhouette.
- **Fix.** Dataset = one labelled tape reel (cyan), Corpus already is three reels; Checkpoint and Frontier checkpoint = a bare hexagon chip (orange / gold), not a drive; Significant result = sheet with a bright green band, Null result = plain sheet, Baseline = the green band greyed. Enforce the fun audit's "11 silhouettes per tier, tested at 32 px" rule in `checks`.

#### FUN-10 · The throttle is undefined for the Switch
- **Location.** 03 §1.3 lists `switch` in the Cluster class; the throttle multiplies "crafting or research speed", which a beacon has none of.
- **Fix.** "Switch: distribution efficiency × m." Beacon-dense blocks are exactly where density bites, so the rule matters.

#### FUN-11 · The j drift reads as the game changing the rules
- **Location.** 03 §2.1; 07 §9.2.
- **Evidence.** A veteran's 20 : 5 : 17 backs up on junk over two hours with no visible cause unless they hover the recipe. It is Factorio's best diagnosis moment (F4) only if the cause is findable.
- **Fix.** The refinery's recipe tooltip and Handbook entry show both numbers: `Junk 34 (25 at junk share 30%)`; the Heat/Production statistics already show the drift.

#### FUN-12 · Proceedings under Contained is two technologies and seven levels
- **Location.** 05 §4.7; E8.
- **Evidence.** Under the default preset the black pack buys *Rollback recovery*, *Reference monitor* and *Monitor throughput 1–7*; the rest is Wild. Peaceful Factorio players skip military science and are happy, so this is ISO-acceptable; it just means the first compromise finds most players without Monitors, which is the Factorio-like consequence. No change requested; note it in 00 §8 so nobody "fixes" it by making black mandatory.

#### FUN-13 · The salvage disagrees with itself, and the radar is the fun half
- **Location.** 01 §9 (six wreck pieces, crate: 1 Radar, 10 Logic board, 20 Copper cable) vs `meta.yaml` `start.salvage` (20 iron, 10 gears, 20 cable, 8 boards, no radar).
- **Fix.** Take 01's: the radar reveals the town and the lake in minute one and carries the one tooltip joke of the opening.

#### FUN-14 · Filler lines (noted, no change)
*Dennard scaling 1–5* (−8% each, "No further levels exist." at 5), *Monitor throughput 1–7*, *Batch size 1–7*, *Braking force 1–7* are ISO-shaped filler and fine; *Artificial intelligence* (10 × 60 s, no effect) is a joke worth its 600 lab-seconds. *Expert iteration* at 5,000 × RGBP · 15 s (75,000 lab-s to unlock the Verifier) looks like a transcription of Space Age's quality gate; the balance agent should check it against the 2.0 dump rather than this lens.

---

## 2. Playing it through, phase by phase

| Phase | What the player does | What is fun | What is lost or confusing vs Factorio | Tedium risk | Pacing |
|---|---|---|---|---|---|
| **Minutes 0–10** | Charter sheet; hand-mine the wreck (30 plates) and the four ores; burner drill, quartz furnace; triggers at 50 iron / 10 copper; Keypunch on the archive at the town; first Seminar from 10 boards + 4 belts | It is Factorio's opening with one new ore and one new furnace; the coal-fired Keypunch is deadpan; the town is visible as a place; the overlay shows ambient before anything is built | The archive and Seminars live at the town, the ores elsewhere (FUN-05); "Staff" is a new word on the first Seminar | Walking between two sites | 09 §7.1's targets are vanilla's; FUN-05 is the one threat |
| **Hour 1** | Automate Memos (Keypunch line like stone furnaces; gear + Memo assemblers), ten Seminars, steam at the lake, poles to the campus; *Linear programming* → Report (inserter + belt) | ISO; the staffing line reads 94% and the overlay already shows the boilers' warm spot | Nothing of substance | — | ISO (+6% red lab-s) |
| **Hours 2–5: Report → Article** | Steel, engines, rail, solar, Cybernetics; *Packet switching* → data lines and the tap; Crawler on the college exchange; refinery (Deduplication); Datasets, Benchmarks; coal chemistry → acid → wafers → Processors; Trainer and Checkpoint at green; Hypothesis testing → Experiment/Analysis; Article | The oil moment with a true reading (yield, floor, "closes at 70%"); the chip chain is the subject; the Trainer's falling loss curve; the first "Throttled by heat 94%" on a refinery next to the boilers, a low-stakes lesson | Chips need coal chemistry, not the refinery, so the refinery's first big consumer is the experiment loop (FUN-01); staffing yellow from hour 2 (FUN-02) | FUN-01's 30 Trainers; FUN-02's "more labs does nothing" | Lab-s +7–10% (fine); FUN-01 makes blue 3× the machine count |
| **Hours 5–15 (E's clock; 2× that for a real first run): Preprint, Model card** | Deep learning → Preprint (Tokenizer + Checkpoint + rails) and the Endpoint; Switches and modules 2–3; Synthetic data; Logistics 3; Model card (checkpoints + drone frame + racks + Ratings); trains to records stores and other towns' exchanges; agents; liquid cooling and Dennard; the starting archive runs out | Taps as a data-in / deployment-out choice; σ as a slow visible fuse ("Leak 0.37"); the data wall as literal depletion; agents as the model building the lab; the refinery mix drifting under you | Yellow needs the purple gateway (fine); P7 does nothing without Comparators (FUN-03); the drift is silent (FUN-11); the second network is pipes with another sprite (FUN-07) | The 3-hour Leak fuse with ≈0.4 expected events: the pressure is a readout until takeoff, which is acceptable because the readout names the next victim | Purple +9%, yellow +16% lab-s; crawl per Preprint 1.0× crude |
| **The first frontier run** | Frontier cluster (ISO silo), 100 run shards, payload needs 100 Ratings; the loss curve; *In-context learning*; six runs for the white technologies; stockpile accelerators | The rocket moment, kept; "Run complete. Loss 3.41 → 1.92." | The plateau is Factorio's post-rocket phase, bounded to 4 techs + 6 runs; nobody says it is the time to build the overhang (FUN-08) | A 1–2 h "launch more rockets" stretch | +7% lab-s to the first run; run-bound |
| **Closure and takeoff** | Halls (20 accelerators + a copied frontier checkpoint + Datasets), Researchers into staff slots, the first hall card; then 49 min of power, cooling, accelerator lines, Seminar capacity, containment, with Research scheduling filling the queue | The doubling-time string; brakes that are buildings; the overhang curve as the fast/slow debate; "Speed +400%. Hollow: 20%."; the cascade's last minute as spectacle; "No action required" | None, provided the player prepared blueprints and a stock during the plateau; G's builder model (a 2×2 nuclear block in 8 min, +400 MW of cooling in 5 min) is a prepared veteran with bots, and a half-speed builder still takes off in 60 min | 7–8 compromises in a bot-linked base (FUN-06); nuclear at +900 K forcing compute 7 chunks away (FUN-04) | 49 min reference; the hour before the cascade is play |
| **After victory** | Final report run; the run report; *Energy per operation* against the site's temperature; infinite technologies at geometric cost; the expansion outline | "Objective, inferred: maximize Copper cable"; Landauer as a reason to go north and then off-world | ISO Factorio's post-rocket sandbox | — | Energy-bound, doubling times climb back |

**The Seminar staff slot.** Legible: the dimmed Researcher silhouette with its tooltip from minute one is a thirteen-hour promise, and the GUI line, the overlay and the University window all show the same number. Fun: the payoff (an AI researcher as a recipe, the cap vanishing the moment the first one is installed, the University window reading "0 working Seminars") is one of the best beats in the game. The cap itself is fun only if it binds late and rarely (FUN-02).

**Heat throttling.** All four guards of A §7 D1 are present and correctly stated in 03 §1.5. The layout consequences are good ones: compute away from plants, north or on shores, cooling towers per chunk with their own water logistics, coolant loops in steam's idiom, Switches making density hot. Mid-game it is a 10–15% tax with cheap answers; at takeoff it is a wall that power and cooling must both answer (Leontief). The only break is FUN-04.

**The takeoff: played or watched.** Played, for a player who used the plateau; the sim's task sizes are human with blueprints and agents, and the *decision* (when to close, how big an overhang, hardware technologies or Generations first, which r) is the player's. The last six minutes are spectacle by design, and *Research scheduling* at minute 19 removes the clicking. The risk is only that nothing tells the player the plateau is for building (FUN-08).

---

## 3. Fun atoms F1–F17

| Atom | Verdict | Note |
|---|---|---|
| F1 Grid puzzle | kept, extended | New footprints: 2×2 Keypunch, 5×5 refinery, 2×4 Verifier, 1×2 Repeater, 7×7 hall, 9×9 cluster; coolant ports; coverage squares |
| F2 Visible flow | kept | Drive-family and sheet collisions (FUN-09) |
| F3 Ratio math | kept | Factorio's numbers under new names; the j drift bends ratios on purpose (FUN-11); the experiment loop is probabilistic (acceptable at 1.2 s) |
| F4 Bottleneck hunting | kept, one new kind | Heat is a spatial bottleneck (good); staffing is a non-buildable one (FUN-02) |
| F5 Refactoring | kept, extended | Compute relocation for heat; air gaps as a layout dimension |
| F6 Growth goal | **damaged** for ~10 h | FUN-02; restored at closure |
| F7 Tier gating | kept | Black after blue, yellow after the purple gateway: cosmetic |
| F8 Research as sink and meta-loop | kept, made literal | The loop closes on screen |
| F9 Automation of automation | kept, the best version | Agents, Researchers, Research scheduling, Constructor at closure, "No action required" |
| F10 Logistics modes | kept | Data lines duplicate pipes (FUN-07); coolant loops add a steam-like one |
| F11 Cross-cutting networks | kept, extended | Staffing shares like power; heat field; Compute satisfaction bar |
| F12 Exploration and depletion | kept, enriched | Towns, archives, records stores, exchanges, the compass |
| F13 Conservation and determinism | kept | Catalysts "(returned)"; one RNG recipe on the main line (FUN-01) |
| F14 Embodiment | kept | Hand-digitizing; equipment ladder; never fights |
| F15 Pressure | kept, bounded | Heat from minute one, runaways from Preprint, σ; P7 inert (FUN-03); spread (FUN-06) |
| F16 Legibility and deadpan | kept, excellent | Tooltips are the right register throughout; +900 K (FUN-04) and sprites (FUN-09) are the exceptions |
| F17 Mastery ceiling | kept, raised | Quality ladder, overhang strategy, r setting, Hard takeoff, Eternity in six hours |

---

## 4. The deviation register, judged

"Pays" = buys fun for its cost; "pays with fix" = see the issue; "bookkeeping" = coherence only, cheap.

| Entry | Verdict |
|---|---|
| W1 Towns · W4 Archives · W5 Exchanges | Pay: destinations that are not ore, the data wall as depletion, oil with a true reading |
| W2 Climate compass | Pays modestly, mostly late; cheap; the overlay as siting map is the win |
| W3 Quartz · E3 Wafers, racks · E4 Data smelters · E7 names · E10 no solid fuel | Renames; pay in identity, cost nothing |
| W6 Never fights · P10 Contained · P11 Wild | Pay: the one adversary the plane admits; Contained is ISO peaceful with a readout; spread rule FUN-06 |
| W7/P1 Fuel ×3, η 33% | Pays (the Handbook adds up); no fun cost |
| P2 Newton cooling · P3 Throttle · P4 Coolers | Pay: locality, a brake with a floor, pollution control with a supply chain (Factorio has none). Generator emission FUN-04 |
| P5 W, j, σ, L · P6 drift · P8 walled gardens · P9 Endpoints | Pay: a clock made of your own publishing; the tap as a choice. Drift legibility FUN-11 |
| P7 Model collapse | **Pays only with FUN-03** |
| P12 Hollow work | Pays: a readout joke that is also a takeoff accelerator, nothing preachy |
| P13 Scooped · P14 Race | Opt-in; fine |
| E1 Data lines | Bookkeeping until Preprint (FUN-07); the Terminal would make it pay |
| E2 Coal chemistry | Pays: no second oil |
| E5 Checkpoint catalysts · E6 Trainer · E9 packs eat checkpoints · E11 agents | Pay: non-rival weights without breaking conservation; "(returned)" is legible |
| E8 Proceedings as evaluation | Pays thinly under Contained (FUN-12); acceptable |
| E12 Experiment loop | **Pays only with FUN-01** |
| R1 Staffing | **Pays only with FUN-02** |
| R2 Researcher in the staff slot | Pays, strongly |
| R3 AI / Expert systems | Pay: two jokes made of a cost and a scope note |
| R4 Packet switching gates · R6 halls write cards · R7 interruptible · R8 hardware techs · R9 Constructor at closure · R10 geometric infinites · R11 r as setting · R12 scheduling | Pay; R7 and R12 are what keep the takeoff from being a punishment or a clicking contest |
| R5 Model generation 6–25 | Pays: the regime change |
| U1–U5 | Pay; the run report and "No action required" are the game's voice |

---

## 5. What is good and must not be lost

1. **The charter and its callback.** Four lines at the start; one word at the end. The only callback in the game, and it is earned by the mechanics.
2. **"Objective, inferred: maximize Copper cable", unconditional.** The entire moral content, as a statistics row. Do not let anyone condition it.
3. **The Researcher as a recipe** (4 accelerators + a frontier checkpoint, returned) in a staff slot that has been visible and dimmed since minute one. The cap vanishing on installation is the regime change felt through a GUI line.
4. **Closure as the player's decision, the overhang as a number, r as a world setting.** The pause debate as a stopwatch; no speech.
5. **The brakes are buildings** (power, cooling, accelerators, Seminars) and the two anti-spiral rules: interruptible compute and the 0.5 floor with unchanged draw. Keep all four guards of 03 §1.5 verbatim.
6. **The doubling-time history string, the log-scale graph, "Queued by: Researcher", "No action required".** The takeoff narrated by readouts only.
7. **Catalyst recipes marked "(returned)"**: copying takes a blank and returns the original. Conservation kept and the fiction right.
8. **The tap as a choice** (Crawler or Endpoint), the writing floor rising with W, "Closes to crawlers at synthetic share 70%" shown from the start, Endpoints keeping a closed exchange. Your deployment closes the sources you tap, and nothing says so.
9. **Archives as low-background data** ("Written before anyone could fake it."), the data wall as a mid-game patch depletion, records stores as the rail-outpost motive.
10. **The experiment loop's joke**: α on the Analysis recipe, the File drawer that cites nothing, "p < 0.05.", "Was state of the art." Keep the items and the shape; only the times change (FUN-01).
11. **The heat overlay as the siting map from minute one**, the T\* contour when holding a machine, "Chunk 38 °C · limit 35 °C · speed 94%". Pollution finally with a number a player can act on.
12. **The Leak bar naming its next victim**, the Compromised circuit signal, the power switch as tripwire, Rollback by feeding a checkpoint. Containment in Factorio's circuit idiom, deterministic, predictable to the building.
13. **"Speed +400%. Hollow: 20%."** The gap between the speed stat and the progress bar is the whole joke; nothing explains it.
14. **The tooltips' register**: "Not written by anyone.", "Surplus from a wartime laboratory.", "Proposed as a two-month, ten-man study.", "Multiplies matrices.", "It was always there." Clever where the fact is the joke, silent elsewhere; "slop" absent.
15. **The frontier cluster's progress bar as a falling loss curve**, and the first-run panel's two lines.
16. **Factorio's numbers everywhere else.** Belts, inserters, assemblers, the silo's 100 parts and 1,000-pack return, module and beacon figures, the research mechanics, the keybindings. The validator's pacing tables (+6% to +16% lab-seconds per tier, +7% to the first run) are the proof that the skeleton is intact; keep them as a round-3 regression check.

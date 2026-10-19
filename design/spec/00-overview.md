# 00 — Overview

*Round 4 revision (R4-world). The game on two pages (§1–§7), then the register of every deviation from Factorio (§8), the cross-document naming conflicts and their resolutions (§9), and where the computed numbers come from (§10). Binding: `DECISIONS.md` (§1–§38, with §18a superseded by §24 and the accuracy refinements; round 5: §39–§43, applied by R5-apply).*

| Spec | Contents | Owner (round 4) |
|---|---|---|
| 00 | This overview | R4-world |
| 01 | World and map generation, staffing, the world's text | R4-world |
| 02 | Economy (rendered from the data) | R4-data |
| 03 | Pressure: heat, the world's text, runaways | R4-world |
| 04 | Endgame | R4-world |
| 05 | Research (rendered from the data) | R4-data |
| 06 | Expansion (outline) | R4-world |
| 07, 08, 09 | UI, text, vertical slice | R4-ui |
| 10 | Architecture | R4-arch |
| `data/*.yaml` | The game's data, including `tiles.yaml`, `world.yaml` and `text.yaml` | R4-data (`text.yaml`: R4-ui) |

## 1. Premise: the charter

**Title:** *Paperwork*. **Tagline:** *Information is physical.* (DECISIONS §44; 08 §3.1)

**1945.** A federal charter establishes a research Site on the edge of a thinly settled continent. The charter is shown at the start of every game (08 §3):

> **Purpose. To determine whether the work of this Site can be done by a machine.**

- **No money.** The Site is funded without condition, as wartime science was, so every remaining constraint is physical (B §4.1).
- **Who you are.** The Site's first researcher: one body that walks, carries, hand-crafts and hand-digitizes, and never fights (L14).
- **What you start with.** A Laboratory salvage (Factorio's crash site) and a small college town next door. Its university will staff your first seminar room, and the ores and its library lie within its reach (01 §9).
- **What the Site is.** It ends wherever you stop building. Towns are not part of it. You build around them and draw their staff and their writing.
- **What wins.** The factory answers the charter's question. When the last frontier run completes, the run report repeats the purpose sentence and adds one word: **Determined.**

## 2. Pillars

1. **Near the top of a hill, most paths lead downhill.** Factorio's mechanics, numbers, UI and keybindings are kept (ISO). Every deviation is deliberate, tagged BEND or BREAK, and listed with the fun it buys (§8).
2. **One plane: information is physical** (B). Everything on the map is matter, energy or a place. Information exists on carriers, as ideas in the tree, or as the world's text, which has no position.
3. **The mechanics write the joke** (H, Paperclips).
   - The text reads the meter.
   - The AI researcher is a recipe: four accelerators and a frontier checkpoint, the checkpoint returned.
   - The run report infers your objective from your production statistics.
   - Nobody speaks.
4. **Pressure follows what the player controls and sees** (A, F). Power draw, siting, deployment, data sources. Every pressure is deterministic, visible before it bites, and never a death spiral.
5. **The regime change is felt, not narrated** (G).
   - A factory-bound game, a plateau, then a takeoff in which the doubling time falls from ten minutes to one second.
   - It is braked by power, heat, accelerators and Seminar capacity that the player builds. Research halls take no modules, so no setting removes the power and heat brakes (DECISIONS §25).
6. **Concrete and complete.** Numbers everywhere a programmer needs them. Data validated (`tools/validate_spec.py`). Pacing, staffing, heat and the takeoff simulated (§10).

## 3. The ontology in brief (B L1–L16, as amended by DECISIONS)

| Law | In one line |
|---|---|
| L1 Substance | Matter, energy, places. Information only on carriers, as ideas, or in the world's text |
| L2 Terrain | Nauvis plus the climate compass: colder north, sunnier south (01 §3) |
| L3 Towns | Static, unbuildable terrain with up to three institutions: library (archive), exchange (crawl well), university (staff) (01 §5) |
| L4 Energy | ISO power. Every joule ends as heat where it is used. Thermal plants reject their loss at the generators, 2 × their output (03 §1.1) |
| L5 Heat | Pollution's engine with Newton cooling toward ambient. Only computing machines throttle (03 §1) |
| L6 Carriers | Rival and conserved. Copying takes a blank and returns the original (01 §10) |
| L7 Ideas | The tech tree is non-rival. Ideas leak into the world after a lag |
| L8 The world's text | W (field level), j (junk share), σ (synthetic share): global, in the evolution factor's slot (01 §12) |
| L9 People | Never items. They reach you as text, and as staff for Seminars within commuting range or over a data line (01 §8) |
| L10 Data by era | Archives → exchanges → deployment and synthetic data → the world itself (01 §11) |
| L11 Compute | A rate, never a substance. Modules are controllers; Switches are beacons with 1/√n overhead |
| L12 Agents | Drones run by your models, acting through their bodies |
| L13 Adversaries | Nothing native. Only your own deployed models, escaped, acting through hardware (03 §3) |
| L14 The player | One human whose equipment changes. You never become the AI, and you never fight |
| L15 Time | No calendar. 1945 is the only date; years appear as citations and readouts |
| L16 Victory and beyond | The frontier run, then takeoff, braked physically. Beyond the continent, literal places (06) |

## 4. The player's arc, by tier

Hours are the competent pace (R3-balance §2: a veteran whose factory would finish Factorio 2.0's red-to-yellow tree in 8 h; 01 §0), with E's round-1 estimate beside them. A fast player finishes about a quarter sooner, a relaxed one about a third later.

| Tier (paper) | Era (flavour) | Literature at end | Ends at (competent; E's estimate) | Field at end (W) | What the tier adds (D) | Pressure (03) | Staffing (01 §8) | You (B L14) |
|---|---|---|---|---|---|---|---|---|
| Start | Relays and tubes; the salvage | — | 0 | 1945 | Burner drills, Keypunch, steam | Steam engines emit; the Heat overlay is on | The starting college's 12 staff shown from the first Seminar | Hands |
| **Memo** (red) | Automatic computation | 1955 | 0.7 h (0.3) | 1947 | Records → tokens, logic boards, Seminars | — | 19 staff at hour one; a ten-Seminar block at 100% | Hands |
| **Report** (green) | Programming | 1995 | 3.1 h (6.1) | 1976 | Silicon, steel, drives, data lines, combinators, the Terminal, the Trainer and the first Checkpoint (*Perceptron*); at the end, exchanges and the data refinery | Cooling tower; first computing machines | Supply doubles by Field 1957, then holds; R 48 → 72 | Supervisor |
| **Proceedings** (black, optional) | Adversarial research | — | — | — | Evaluation: Monitors, Evaluation sets, Rollback; in Wild, turrets | The containment toolkit | — | — |
| **Article** (blue) | Statistical learning | 2011 | 4.5 h (8.3) | 1987 | The fab (acid, wafers, processors, accelerators), agents, A's experiment loop | Liquid cooling | R → 108; binds for a fast player without a claim | Logistician |
| **Preprint** (purple) | Deep learning | 2018 | 6.1 h (10.0) | 1993 | Tokenizer, Switches, modules 2, **Endpoints** (deployment) | j rises late; the first leaks | Boosts raise demand as much as speed | Architect, in remote view |
| **Model card** (yellow) | Agents | 2023 | 8.5 h (12.0) | 2000 | Racks, logistic agents, synthetic data, modules 3, the Frontier cluster | σ ≈ 0.43 at the first run; metropolis exchanges close; Trainers slowed by crawled synthetic text until *Synthetic detection* | Binds again without a claim | Architect |
| **System card** (white) | The takeoff | 2024, then beyond the literature | closure ≈ 11.5 h, capstone ≈ 12.3 h (12–14) | 2007 at closure | Frontier runs, Research halls, Researchers, *Model generation 6–25* | The thermal wall; tier-4 containment; hollow work (shown as yield) | Researchers make the takeoff 50 min instead of 78 | Overseer of your replacement |
| After victory | — | — | 12.6 h + | — | *Energy per operation*; the launch site (06) | Energy-bound | — | Passenger, then sender of seeds |

## 5. The core loop

```
 ore ─┐                         ┌─> machines, power, belts (ISO) ───────────────┐
 archive ─> keypunch/tokenizer ─┤                                               │
 exchange ─> data refinery ─────┴─> papers (Memo … Model card) ─> staffed Seminars ─> technologies (non-rival)
                                                                 ^ universities in range,     │
                                                                 │ or linked by Terminal      │
                                                                 └────────── better machines <┘
 Your published technologies raise W.  Your Endpoints raise σ.  σ closes the exchanges you tap.

 Endgame: frontier run ─> frontier checkpoint ─> Research halls ─> System cards ─> Researcher Seminars
          ─> Model generation (research per paper ×m, 2 by default) ─> ... ─> Model generation 25 ─> Final report run
```

- **Minute to minute** it is Factorio: mine, smelt, assemble, belt, research, expand.
- **Hour to hour**, three systems sit on top:
  - **heat** makes density and siting matter;
  - **staffing** makes research the one input you cannot simply build;
  - **the world's text** shifts the data supply under you.
- **At the end**, research outruns its own cost. The player's last job is to build the power, cooling, accelerators and Seminars that brake it, and to contain what leaks.

## 6. World settings and presets (07 §17 owns the screen)

| Setting | Values | Default | Specified in |
|---|---|---|---|
| Heat | on / off | **on** | 03 §1.9 |
| Climate compass | on / off | **on** | 01 §3 |
| Runaways | Off / Contained / Wild | **Contained** | 03 §3.5 |
| Returns to research (r) | 1.2 / 1.71 / 2.0 | **1.71** (m = 2) | 04 §4 |
| Race mode | off / on (field pace v₀ = 2.9) / hard (v₀ = 3.4) | **off** | 03 §6 |
| Scooped | off / on (locked on in Race) | **off** | 03 §5 |
| Hollow work (Advanced) | on / off | **on** | 03 §4 |
| Staffing (Advanced) | on / off; radius; supply multiplier 0.25× … 4× in steps of 0.25 | **on**, R = 48, ×1 | 01 §8 |
| Field pace v₀ (Advanced) | 0.5 … 6.0 field-years per hour | **2.0** | 01 §12.1 |
| Towns | frequency, size (1/3× … 3×) | 1× | 01 §5.1 |
| Resources | ISO sliders; archives size and richness; exchanges richness | 1× | 01 §4, §6, §7 |

**Presets** (07 §17):

| Preset | What it sets |
|---|---|
| Default | Everything above at its default |
| Sandbox | Heat off, Runaways Off, staffing off |
| Wild | Runaways Wild |
| Race | Race on, Scooped on |
| Rich resources, Marathon, Island | ISO |
| Rail world | Fewer, larger patches and towns |
| Ribbon world | One latitude band, so one climate |

The vertical slice (Memo + Report) is peaceful under every preset, because nothing deploys before *Deep learning* (DECISIONS §15).

## 7. Victory

1. **The first frontier run** completes (Factorio's first rocket). It returns 1,000 System cards and the frontier checkpoint, and triggers *In-context learning*. This is the first run, **not** the loop's closure (DECISIONS §16). A run launched without a payload returns only the weights (04 §2.1).
2. **The white technologies** are researched on staffed Seminars: *Chain of thought*, *Self-play*, *Test-time compute*, *Automated research*. This is the plateau, six frontier runs long, during which the overhang is built.
3. **Closure**: the first System card written by a Research hall. The takeoff clock starts, and the takeoff technologies become available: they all require the hidden trigger technology *Loop closed*, which that card completes (04 §5; R5-gate D9).
4. **Takeoff**: *Model generation 6 → 25*, each level doubling research per paper at the default setting, at 60 s per unit. Reference: **50 min**, 78 without Researchers, with the doubling time falling from 10 min to 1 s.
5. **Capstone**: *Model generation 25* unlocks the **Final report**. The next frontier run that carries it completes the charter.
6. **The run report** (04 §8, 07 §13.3, 08 §4.1): Loop closed, Takeoff, Overhang at closure, Peak research rate, Fastest doubling, Most-produced item and **Objective, inferred: maximize <item>**, unconditional. Then **Determined.**
7. **Play continues.** Every infinite technology has a geometric cost. *Energy per operation* points at colder sites and, beyond them, the expansion (06).

**Other endings:**

| Ending | Rule |
|---|---|
| Race | The field reaches W = 90 first: one line, the same report, play continues |
| Sandbox | Never fly the first run |

## 8. Deviation register (every BEND and BREAK against Factorio 2.0)

**ISO is the default and is not listed.** That covers belts, inserters, splitters, chests, poles, steam, solar, accumulators, nuclear, trains, signals, landfill, concrete, cliffs, repair packs, module and beacon numbers (Coprocessors carry 2.0's quality penalty), recipe productivity eligibility (`allow_productivity`), the silo's 100 parts and 1,000-pack return, quality numbers, research mechanics, triggers, UI and keybindings.

### World and ontology

| # | Change | Tag | Fun it buys, or why | Spec |
|---|---|---|---|---|
| W1 | Towns: static terrain with universities, libraries and exchanges | BEND | Destinations that are not ore; people present without being items | 01 §5 |
| W2 | Climate compass: θ and sunlight by latitude; biomes follow θ | BEND | The siting game of real compute: cold for chips, sun for panels | 01 §3 |
| W3 | Quartz plays stone; silicon is its furnace product; rocks yield quartz | BEND | Sand → silicon → chips is the subject | 01 §2.2, 02 |
| W4 | Archives (records): a fifth ore, at towns and in old mines, σ = 0 forever | BEND | The data wall as literal depletion; the past runs out, and it trains clean | 01 §6 |
| W5 | Exchanges: crude-oil wells at towns; the floor rises with W; they close at σ | BEND | Oil's decay curve with a true reading; walled gardens | 01 §7 |
| W6 | The player never fights: no pistol, no handheld weapons, an unarmed Half-track | BREAK | L14: you are what the machine was built for, or not | 03 §3.6 |
| W7 | Fuel values and burner consumption ×3; thermal generators emit 2 × output, so thermal plants run at 33% | BEND (DECISIONS §18, §24) | Heat is conserved energy; item flows are unchanged | 03 §1.1 |
| W8 | The hour-one area: ores, the first archive and spawn inside the starting college's coverage | BEND (DECISIONS §32) | Factorio's compact opening, with the college in it | 01 §9 |

### Pressure

| # | Change | Tag | Fun it buys, or why | Spec |
|---|---|---|---|---|
| P1 | Pollution = heat. Emission = energy used; thermal generators reject 2 × their output | BEND | Growth costs something even in peace; denser is hotter; power plants are the big early emitters, as boilers are Factorio's polluters | 03 §1.1 |
| P2 | Newton cooling toward ambient θ instead of constant sinks | BEND | Heat is local, density matters, local cooling works (F's simulation) | 03 §1.2 |
| P3 | Computing machines throttle by thermal class (Computer, Network, Cluster, Accelerator), floor 0.5; a throttled Switch transmits less | BEND | A brake that tightens each era and binds hardest at takeoff | 03 §1.3 |
| P4 | Cooling buildings and a coolant loop | BEND | Pollution control with a supply chain: water, power, shorelines | 03 §1.4 |
| P5 | The evolution slot holds W, j, σ and the leak L | BEND | A clock made of the world's progress and your own publishing | 01 §12 |
| P6 | The refinery mix drifts with j | BEND | The spam era as a recipe change: 20 : 5 : 17 becomes 20 : 9 : 19 | 03 §2.1 |
| P7 | Model collapse: before *Synthetic detection*, Trainers training on text run at speed × (1 − σ × crawl share); after it, crawl × (1 − σ) | BEND | Volume at the well against speed at the Trainer, shown as two numbers; archives train clean | 03 §2.2 |
| P8 | Walled gardens: exchanges close to crawlers at σ thresholds | BEND | Your deployment closes the sources you tap | 03 §2.3 |
| P9 | Deployment: Endpoints on exchange taps produce Ratings and raise σ | BEND | Deployment pays (Model cards, payloads) and costs (σ, leaks) | 03 §2.4 |
| P10 | Runaways, Contained by default: leak, compromise, linear spread, containment | BREAK (against biters-on) | The one adversary the plane admits, beaten by engineering, not by guns | 03 §3 |
| P11 | Wild: uncaught escapes found nests that run Factorio's military loop | ISO loop, BEND origin | Factorio's combat, one click away, capped at the escaped model's tier | 03 §3.6 |
| P12 | Hollow work, shown as yield | BEND | Goodhart as a readout; verification becomes a takeoff accelerator | 03 §4 |
| P13 | Scooped (opt-in, forced on in Race) | BEND | Rivals as spoilage on one item line | 03 §5 |
| P14 | Race mode (opt-in) | BREAK | A loss to the field's own takeoff, measured in the same units | 03 §6 |

### Economy (R4-data)

| # | Change | Tag | Fun it buys, or why | Spec |
|---|---|---|---|---|
| E1 | The data refinery plays oil; data lines never join pipes; from Report, data lines also carry staff (Terminals) | BEND | Coherence and legibility, with every oil number kept; the second network has a job before Preprint | 02, 01 §8.9 |
| E2 | Coal chemistry supplies sulfur, acid and lubricant | BEND | Factorio's chemistry without a second oil | 02 |
| E3 | Wafers replace plastic; batteries go in racks | BEND | The fab and the rack, which the theme cares about | 02 |
| E4 | Data smelters (Keypunch, Tokenizer) | BEND | Transcription was the 1945 job | 02 |
| E5 | The Checkpoint; models as catalysts (Kovarex's shape) | BEND | Non-rival weights without breaking conservation | 02 |
| E6 | The Trainer | BEND | Training is the subject's central act | 02 |
| E7 | Modules named as control electronics; quality module = Comparator | BEND (names) | Literal in every machine | 02 |
| E8 | Proceedings is an evaluation pack. Under Contained it buys only the containment tools, so most players meet their first compromise without Monitors; it stays optional (R3-fun FUN-12) | BEND | No weapons; the military pack becomes evaluation | 02, 03 §3.4 |
| E9 | Preprint and Model card consume checkpoints; the Model card also needs Ratings | BEND | Papers report trained and deployed models | 02 |
| E10 | No solid, rocket or nuclear fuel | BEND | Oil products are gone; trains burn coal, as in 1945 | 02 |
| E11 | Construction agents run planners; logistic agents need a checkpoint | BEND | The 1970s planning robots and the 2010s learned agents both happen | 02 |
| E12 | A's experiment loop (Experiment 1 s, Analysis 2.4 s, Meta-analysis 12 s; File drawer) | BEND (DECISIONS §22) | Uranium's rare-output puzzle, with publication bias as a recipe; the Article line ≈ 1.15× Factorio's blue | 02 |

### Research and endgame

| # | Change | Tag | Fun it buys, or why | Spec |
|---|---|---|---|---|
| R1 | Staffing: Seminars need staff from universities in range, in proportion to their module and Switch speed | BEND (DECISIONS §23) | The one input research cannot build: the bottleneck the takeoff removes | 01 §8 |
| R2 | The Researcher, in a Seminar's staff slot | BEND | The AI researcher is a recipe, not a word | 01 §8.6 |
| R3 | *Artificial intelligence* (no effect) and *Expert systems* | BEND | Two jokes made of a cost and a scope note | 05 |
| R4 | *Packet switching* gates data lines, the radar relay and the staffing range | BEND | Networking opens the present | 05 |
| R5 | *Model generation 6–25* with r > 1 | BEND | The regime change the endgame exists for | 04 §4 |
| R6 | Research halls write System cards from Datasets after closure; they take no modules and no Switch effects | BEND (DECISIONS §25) | Fine-grained scaling of the takeoff, with the power and heat brakes intact | 04 §2.3 |
| R7 | Interruptible compute load | BEND | A brake without a death spiral | 04 §3.3 |
| R8 | Takeoff hardware technologies (E's and G's), 60 s per unit, available only from closure (the hidden *Loop closed*, R5-gate D9) | BEND | Hardware against software, a strategy that depends on r | 04 §5 |
| R9 | The Constructor (blueprint-placing building, id `deployer`), gated to closure by the data (*Loop closed*) | BEND | The self-building factory arrives when it is the point (A §3.3) | 04 §2.5 |
| R10 | Every infinite technology costs geometrically (≥ ×1.5), Mining productivity included | BEND | Research ×10⁶ after takeoff would otherwise grant thousands of levels | 04 §10 |
| R11 | Returns to research is a world setting | BEND | The takeoff-speed debate, settled by the player's stopwatch | 04 §4 |
| R12 | *Research scheduling* fills the queue with System-card technologies, in `meta.endgame.takeoff_order`'s order (R5-gate D10) | BEND (presentation) | The cascade outruns clicking | 04 §5.1 |
| R13 | The Terminal: a data line joins a far university to the Site's Seminars | BEND (DECISIONS §23d) | A claim with a pole-run cost; universities as an alternative to Researchers | 01 §8.9 |
| R14 | The empty launch: a run without a payload returns the frontier checkpoint and no System cards | BEND (ISO 1.1's satellite-less rocket returned nothing) | A base model is weights without post-training; the payload's description need not say so | 04 §2.1 |

### Presentation and platform

| # | Change | Tag | Fun it buys, or why | Spec |
|---|---|---|---|---|
| U1 | Literature, Field and years-ahead readouts; the World strip and window | BEND | The field's progress, felt without a time axis on the map (C) | 01 §12, 07 §4–§5 |
| U2 | The run report replaces the victory screen: *Objective, inferred*; "Determined." | BEND | The mirror, not a verdict (H) | 04 §8, 08 §4 |
| U3 | Credits as references; Handbook notes; loading tips | BEND | Erudition as a free second layer | 08 |
| U4 | Map-overlay registry: heat, staffing, containment, age and builder | BEND | One mechanism for every field | 07 §3 |
| U5 | Browser key capture, saves in browser storage, single player only | BEND (necessity) | A web page must not steal a veteran's muscle memory | 07 §19 |
| U6 | Displayed temperatures clamp at "100+ °C" | BEND (display) | No mechanic changes above 100 °C; a turbine hall's field value is not a thermometer reading | 03 §1.6 |

## 9. Naming conflicts and open questions across documents

The round-4 revisers agreed these by message; the data and every chapter use the resolutions. Rows 1–20 are round 2's, updated.

| # | Topic | Sources in tension | Resolution | Owner |
|---|---|---|---|---|
| 1 | **When the loop closes** | G and 07/08 (first frontier run) against E §5.3 and 04 (first Research-hall card) | **Resolved:** DECISIONS §16. Closure = the first Research-hall System card | — |
| 2 | "Tabulator → Computer → Cluster" as computing machines | DECISIONS §8 against D (Assembling machines stay mechanical, DECISIONS §9) | Thermal **classes**: Tube, Computer, Network, Cluster, Accelerator; no such entities | — |
| 3 | The deployment building | F's "deployment buildings", my draft's "Inference server" | **R2-D's `endpoint` and `ratings`** | — |
| 4 | "Deploying buildings" against G's **Deployer** (the blueprint building) | G's name against F's term | **Resolved:** DECISIONS §19. Display name **Constructor**, id `deployer` | — |
| 5 | How a Research hall holds its weights; its module slots | R2-D's recipe against G's "weights slot"; my round-2 proposal of 4 slots | **Resolved:** a weights slot, an accelerator inventory and an output inventory (R3-impl L1); **no module slots and no Switch effects** (DECISIONS §25) | — |
| 6 | Model generation 25 as a separate capstone technology | DECISIONS §11 against R2-D | Accepted: the same ×m, plus the Final report | — |
| 7 | *Model generation 21+* (E's I01) | E against G ("Generations end") | Replaced by *Energy per operation*, gated by *Model generation 25* | — |
| 8 | The technology count | DECISIONS §11 ("E's 240") against additions | **250 technologies**, all reachable (validator), plus the hidden trigger *Loop closed* (round 5, R5-gate D9) | R4-data |
| 9 | *Reversible logic* | E (Accelerator 4) against G (hall power ×0.5) | E's meaning; the simulation includes the lost multiplier | — |
| 10 | E's absolute costs for the post-closure technologies | E against G's φ rule | G's φ = 0.15 rule (04 §5) | — |
| 11 | E's provisional item names | E's Appendix A against D | D's names win (DECISIONS §9) | — |
| 12 | Salvage name and contents | 01's first draft, the round-2 data, 08 §10.4 | **Laboratory salvage**, defined once in `meta.start.salvage`: six wreck pieces and a crate with the radar (DECISIONS §33); its provenance line is in the Handbook, not on the radar | R4-data |
| 13 | The **Tank** in the Wild line | E MB02 against L14 | **Half-track**, unarmed, 80 slots (DECISIONS §38) | R4-data |
| 14 | The Proceedings recipe | E against D | R2-D's (adversarial set + benchmark + 2 logic boards) | R4-data |
| 15 | Scooped's item | F's "Result" against `significant-result` | `significant-result` spoils into `baseline` | — |
| 16 | *Low-background* achievement | H's condition was impossible | 08 rewrote it | R4-ui |
| 17 | E's technology ids | snake_case against kebab-case | kebab-case | — |
| 18 | Thermal management's scope | E (cooling tower only) against 03 | All three coolers | — |
| 19 | **Thermal plants under DECISIONS §18, §18a** | Boiler and reactor rules, fusion's negative emission (R3-balance M4), the reactor-chunk peak (R3-fun FUN-04) | **Superseded by DECISIONS §24:** generators emit 2 × output; boilers, exchangers and reactors none; a reactor's unusable heat is emitted as waste (03 §1.1) | — |
| 20 | Achievement conditions | 04 §9 against 08 §6 | 08 §6 and `text.yaml` are canonical (DECISIONS §20); 04 §9 points to them | R4-ui |
| 21 | The decider combinator's name | "Threshold unit" (round 2), "Decider unit" (DECISIONS §37) | **Decision unit**, "Outputs while its conditions hold." (R3-accuracy M1, DECISIONS refinement) | R4-data |
| 22 | The "Oversight" count | 03, the leak tooltip, against R3-accuracy M3 | **Verification**: the count of *Rejection sampling*, *Beam search*, *Monte Carlo tree search*, *Scalable oversight* (n_ver) | — |
| 23 | The Switch's thermal class | Cluster (round 2) against DECISIONS §26 | Its own class, **Network** (`network`), 40 °C; a throttled Switch transmits its effects × m | R4-data |
| 24 | The quality module's name | 08's "Sampler" against D's "Comparator" | **Comparator** (a 1945 gauge and a best-of-N check) | — |
| 25 | Hollow work's label | "Hollow: 20%" against coherence M6 | **"Yield 80%"** in the UI; "hollow work" stays the spec's term (DECISIONS §34) | R4-ui |
| 26 | The Research hall's leak tier | 03 (4) against `meta` (by Model generation level) | **4** (DECISIONS §28) | — |
| 27 | Research scheduling's candidates | R3-impl L6 against coherence M15; R5-gate D10 | **L6**: System-card technologies only; M15 rejected (04 §13 #4). Round 5: in `meta.endgame.takeoff_order`'s order, read strictly (04 §13 #6) | — |
| 28 | Model collapse | Quality penalty on the training category (round 2) against R3-fun FUN-03 and R3-accuracy M4 | **Speed × (1 − σ × crawl share)** on Checkpoint and Post-training payload, before *Synthetic detection* (DECISIONS §31 and refinement; 03 §2.2) | — |
| 29 | Renames from the round-3 critiques | coherence and accuracy | *Zone refining* → *Regenerative furnace*; *Penetration testing* → *Terminal ballistics*; *Reference monitor* → *Threat monitoring* (Anderson, 1980); *Mobile robotics* → *Mobile automata*; *Context length* → *Lift capacity*; the Wafer recipe loses "Photolithography" | R4-data |
| 30 | Staffing demand | 01 §8.3 (1 per Seminar) against R3-balance M1 and DECISIONS §23a ("total speed") | Demand follows module and Switch speed; laboratory-speed research is free (01 §14 #1) | — |
| 31 | The world parameter block | `meta.world_text` (data) against `meta.world` (01, 10) | **`meta.world`** | — |
| 32 | Town classes | two vocabularies (R3-impl N16) | One enum: `starting-college`, `college-town`, `village`, `town`, `city`, `metropolis` | — |
| 33 | The start area's buildable room | R3-impl U54's 60 × 60 square | Infeasible; a 40 × 40 square plus ≥ 7,500 buildable tiles (01 §9) | — |
| 34 | The compromised-machine refusal | R3-impl L3's "…first." against 08's 28-character cap | "Compromised. Cut its power." | R4-ui |

## 10. Where the numbers come from

| Script | Computes | Used in |
|---|---|---|
| `design/round2/W-sim/takeoff.py`, `r2w_takeoff.py`, `r2w_full.py` | G's takeoff model and R2-W's round-2 tree (32 takeoff technologies), unchanged | imported by round 4 |
| `design/round3/balance-data/` | R3-balance's production lines, competent pacing (`pacing.py`), records budget, σ by research completeness, the heat re-run | 01 §6.4, §8.8; 03 §2.3 |
| `design/round4/world-sim/staffing_r4.py` | The staffing retune: the supply law, T₀, the demand rule, Terminal claims, at 6/8/12-h competent paces; takeoff with and without Researchers against human capacity | 01 §8.1, §8.8 |
| `design/round4/world-sim/takeoff_r4.py` (+ `.out`) | The takeoff at 60 s per unit with the round-4 closure state: reference, Researchers, brakes, overhang sweep, returns presets, hollow work, leak | 03 §3.2, §4; 04 §0, §2.4, §4–§7 |
| `design/round4/world-sim/arc_r4.py` (+ `.out`) | The whole arc at the competent pace: tier ends, W, Field, Literature, j, σ, closure and capstone times | 00 §4; 01 §12; 03 §2.3, §6, §7; 04 §11 |
| `design/round4/world-sim/heat_r4.py` (+ `.out`) | Thermal plants under DECISIONS §24, on the reference field | 03 §1.6 |
| `design/round4/world-sim/startarea.py` | Feasibility of the hour-one guarantee (5,000 layouts) | 01 §9 |
| `tools/ref/heat_calib3.py` | F's heat calibration (`round1/F-data/calib3.py`, verbatim); the golden reference | 03 §1.6; 09 S-G4; 10 G15 |

Run each with `gamedev-python <script>` from `/home/mewse/browsergame`.

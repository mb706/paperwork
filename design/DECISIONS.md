# Decision record — binding for round 2 (2026-10-19)

Written by Claude after reading the round-1 outputs in `design/round1/`. Integration agents must follow it. If a decision looks wrong, implement it anyway and raise the objection in your document's "Objections" section; don't silently deviate.

## Canonical sources (in priority order where they overlap)

| Area | Canon | Notes |
|---|---|---|
| Ontology and world laws | `B-ontology.md` §4 (laws L1–L16) | The one plane: **"Information is physical"** |
| Pressure | `F-pressure.md` Variant A (§1, §3, §4) | Heat, the world's text (W, j, σ), runaways |
| Endgame math | `G-endgame.md` §2–§6, code in `round1/G-data/` | Takeoff model and numbers |
| Production economy and item/building names | `D-production.md` + `round1/D-data/out/data/*.yaml` | Base data, already valid against the schema |
| Tech tree | `E-tech-tree.md` + `round1/E-data/` | Structure and costs; unlock targets renamed to D's ids via E's Appendix A |
| Tone and naming | `H-tone-bible.md` | Principles P1–P15, naming systems §4, word lists, checklist |
| UI and controls | `I-ui-controls.md` | Factorio 2.0 baseline plus the 2.1 tweaks |
| Spacetime | `C-spacetime.md` | Not a map. Kept: W readout, the Stacks (expansion), the interstellar finale |
| Mods and genre | `A-mods-and-genre.md` (arriving later) | Claude will send the adopt list |
| Factorio reference numbers | `round1/E-data/` and `round1/D-data/` | 2.0 data dumps |

## Decisions

### World

1. **Ontology D, laws L1–L16 as written**, with the amendments below.
   - Premise: a 1945 federal charter for a research Site.
   - The charter's operative sentence: *"To determine whether the work of this Site can be done by a machine."* (H may polish it.)
   - Victory stamp: *"Determined."*
2. **The player never becomes the AI** (L14). There is no line of successors and no avatar change. Equipment changes by era.
3. **Prohibitions:**
   - no money, no people as items/fluids/fuel;
   - no handheld weapons;
   - no smart human adversaries on the map;
   - no abstract planets;
   - no calendar time axis on the map.

### Pressure

4. **Pollution = Heat.**
   - Per-chunk field on Factorio's pollution engine. Sinks use **F's Newton cooling toward ambient θ** (F wins over B on this point: simulation evidence).
   - Only computing machines throttle, with F's thresholds by machine class.
   - Climate compass on (L2).
   - Map setting "Heat: on/off".
5. **The world's text = W, j, σ:** global numbers in the evolution factor's slot (L8, F §1.2).
   - UI text never says "slop" (H).
   - Archives are low-background data (σ = 0 forever).
6. **Adversary = runaways** (F §1.3), with presets **Off / Contained / Wild**.
   - **Spec default: Contained.** That means containment only: power switches as kill switches, circuit tripwires, monitors fed with Evaluation sets, rollback, air gaps. No nests, no combat.
   - Wild (Factorio's full military loop) stays a preset.
   - *Flagged for the user*: they leaned against weapons earlier, and F argued for Wild.
   - Hollow work (F §3) is adopted.
   - Scooped is off by default and on in Race mode.
   - Race mode is opt-in (C, F and G numbers).

### Research and the economy

7. **Staffing (talent) = L9.**
   - Each town's university supplies T(W) staff-equivalents to Seminars within commuting radius R = 48 tiles.
   - Supply is shared like a power network: research speed × min(1, supply ÷ demand).
   - The staffing overlay works like power coverage.
   - Only Seminars need staff.
   - **AI researchers:** the item **Researcher** (4 accelerators + a checkpoint, the checkpoint returned, as D and G specify). It goes into a Seminar's single **staff slot**, a new slot type next to the module slots.
     - A Seminar with a Researcher counts as fully staffed whatever the university supply.
     - It draws +0.5 MW and emits that power as heat (G).
   - The world/systems agent fixes the exact numbers (T(W), R upgrades via *Packet switching*/*Web search*) consistently with G's plateau.
8. **Compute** (D4) follows D and L11.
   - Compute is a rate: the crafting speed of computing machines (Tabulator → Computer → Cluster → Trainer/Research hall/Frontier cluster).
   - Modules are controllers: Coprocessor (speed), Learned controller (productivity), Distilled controller (efficiency), plus a quality module named by D and H.
   - Switches are beacons, with the 1/√n falloff.
   - Accelerators sit in computing machines.
   - Quality is in the base game, with H's tiers: Standard, Selected, Verified, Audited, Reference.
9. **Names:** D's data ids and names are canonical.
   - Keep "Assembling machine 1/2/3" (literal, ISO; D wins over H's objection).
   - Keep D's data-fraction ladder (Junk → Text → Prose, cracked by Denoising and Rephrasing). The structure is binding; the data agent may rename for clarity within H's rules.
   - Elsewhere, D's mechanical mapping wins and H's naming rules (§4, word lists) apply to the names. Combinator names (Threshold unit, Bias unit, …) stay.
10. **Science packs:**

| Color | Pack | Notes |
|---|---|---|
| Red | Memo | |
| Green | Report | |
| Black | Proceedings | Optional; the military pack becomes evaluation and robustness |
| Blue | Article | |
| Purple | Preprint | |
| Yellow | Model card | |
| White | System card | From frontier runs before the loop closes; from Research halls after |

11. **Tech tree:** E's 240 technologies.
    - Rename unlock targets to D's ids and add whatever new entities need (cooling, Monitor, Evaluation set, Research hall, fusion, …). E already placed most.
    - **Model generation** levels start at **6** (the first after the Fifth Generation project, 1982; the tooltip cites it, nothing else explains it) and run through 25. Level 25 is the capstone that ends the run (G's 20 levels).
    - The validator's research playthrough must pass.

### Endgame and presentation

12. **Endgame:** G's model and numbers.
    - "Returns to research" r is a world setting: presets 1.2 / 1.71 (default) / 2.0.
    - Victory: completing the capstone frontier run, then H's run report, which includes the unconditional *"Objective, inferred: maximize <most-produced item>"*.
    - Play continues after victory. Infinite techs have geometric costs. *Energy per operation* (Landauer) points to the expansion.
13. **Research-screen readouts:**
    - **Literature: YYYY**: the latest citation among your researched techs (H).
    - **Field: YYYY**: the world level W in field-years (C, G).
    - The gap between them, as "years ahead".
    - After closure, a doubling-time readout and the history string (G, I).
    - No timeline widget (I).
14. **Expansion:** an outline only in round 2.
    - Launch site → orbit/platforms (radiators) → the Stacks (C, Fulgora's slot) → Mercury swarm (Vulcanus's slot) → cold outer moon (Aquilo's slot) → interstellar seeds against a grabby frontier.
    - AI-for-science content goes where its subject actually is (B L16).
15. **Vertical slice:** Memo + Report tiers.
    - Peaceful by construction: runaways need deployments, which come at Preprint.
    - Heat overlay on from minute one; the player spawns next to a small college town, so staffing applies.
    - The UI subset follows I's milestone 1, plus Factoriopedia and production statistics.

## Round 2 assignments

| Agent | Writes | From |
|---|---|---|
| R2-W world and systems (Opus) | `spec/00-overview.md`, `01-world.md`, `03-pressure.md`, `04-endgame.md`, `06-expansion.md` | B, C, F, G, H |
| R2-D data (Opus) | `spec/data/*.yaml` (full game data, validator passing), `spec/02-economy.md`, `spec/05-research.md` (tables generated from the YAML) | D, E, F, G, H |
| R2-U UI, text and slice (Opus) | `spec/07-ui.md`, `08-text.md`, `09-vertical-slice.md` | I, H, all |
| R2-A architecture (Opus) | `spec/10-architecture.md` (engine and implementation plan) | All |

## Amendments during round 2

16. **When the loop closes** (raised by R2-W, endorsed by Claude):
    - **Closure** = the first System card written by a **Research hall** (E §5.3). It is *not* the first frontier run: that run only triggers *In-context learning*, and Chain of thought, Self-play, Test-time compute and Automated research still follow.
    - **Takeoff** = closure → *Model generation 25*.
    - **Overhang** = accelerators existing at closure.
    - The first-run panel stays, labeled as the first run. All "after closure" presentation hangs on the Research-hall card: log-scale graph, doubling-time line, history string, Fastest doubling, the "Loop closed" milestone.

17. **Slice UI scope** (R2-U and R2-A both recommend; accepted): the vertical slice includes smart belt dragging, fast-replace, copy/paste of entity settings, and undo/redo. This amends §15. The slice also ships, from the mods survey: the rate calculator (Alt+X), status lights, walking between buildings, and the milestone log.
18. **Energy conservation for thermal plants** (R2-U and R2-W flagged it; accepted): **multiply every fuel value and every burner/boiler consumption by 3**.
    - Item flows are unchanged, and thermal plants become η ≈ 33%: a boiler burns 5.4 MW of fuel for 1.8 MW of steam, and 3.6 MW is emitted as heat.
    - This replaces F's non-conserving "2× output" rule. Burner machines emit their full consumption as heat.
19. **Blueprint-placing building** display name: **Constructor** (avoids a collision with "deployment"). Finale-gated, as before.
20. **Achievement conditions:** 08-text is canonical. 04-endgame §9 must match it.
18a. **Nuclear-reactor exception to §18** (raised by R2-W, accepted): Factorio's neighbour bonus (+100% heat per adjacent reactor) adds heat without fuel. Under "emit fuel burned − energy passed on", a 2×2 block would emit nothing and a reactor with three neighbours a negative amount.
    - For the nuclear reactor only: **heat emitted = 2 × heat passed on**. Every nuclear plant then stays at η ≈ 33% of its real output, and the neighbour bonus stays ISO.
    - Boilers and the fusion reactor keep §18's conversion rule.
    - Listed as 00-overview §9 #19.

## Round 4 decisions (2026-10-19, after the round-3 critiques)

The worklist is the five critiques in `design/round3/`: `R3-fun.md`, `R3-coherence-tone.md`, `R3-accuracy.md`, `R3-balance.md` and `R3-implementability.md`.
- Every **blocker** and **major** must be resolved: either fixed, or rejected with reasons in the owning file's Objections section.
- Minors are at the reviser's discretion; prefer fixing.
- Where critics conflict, the decisions below settle it.

21. **Implementability rules adopted as written.**
    - Applies to R3-implementability's exact rules for B1–B4 and L1–L6, and to its proposed resolutions for majors, undefined behaviour and missing parameters, unless contradicted below.
    - Exit criteria: `round3/impl-data/r3_checks.py` and `r3_xref.py` pass, and `tools/validate_spec.py` reports 0 errors.
22. **Experiment loop timings** (balance M3 over fun FUN-01): Experiment 1 s, Analysis 2.4 s, Meta-analysis 12 s. The Article line ends up ≈1.15× Factorio's blue in machines. α = 0.05, the Kovarex shape and the File drawer stay.
23. **Staffing** (fun FUN-02 + balance M1 combined):
    - (a) A Seminar's staff demand scales with its total speed, including modules and Switch effects.
    - (b) The starting college supplies 12, up from 8. Town supplies T₀ follow fun's proposal (12/8/12/24/48, faster early growth); the world reviser tunes it with balance's model so the cap is legible from the first Seminar, binds noticeably late in Report or in Article for a competent player without crushing, and binds again before closure so Researchers matter.
    - (c) Takeoff technologies cost 60 s per unit instead of 30. Target: about 49 min with Researchers, 75–90 min without.
    - (d) New: the **Terminal**, from the *Time-sharing* tech at the Report tier. Connected by data line, it claims a university's staff beyond commuting range, which gives data lines a purpose before Preprint. The world and data revisers set the numbers.
24. **Thermal-plant heat, unified.** This replaces §18's at-the-boiler rule and §18a, and resolves balance M4 and fun's reactor-chunk finding.
    - Fuel values and burner/boiler consumption stay ×3 (η ≈ 33%).
    - Boilers and reactors (fission and fusion) emit no conversion heat.
    - **Every thermal generator** (steam engine, steam turbine, fusion generator) **emits 2 × its current electrical output** as heat in its own chunk.
    - Burner machines emit their full fuel consumption. Electric machines emit their full electrical consumption. Solar emits 0.
25. **Research halls take no modules and no Switch effects** (balance M2), so power and heat brake the takeoff.
26. **Switches are computing machines** with their own thermal class. When throttled, their transmitted effects scale by the throttle factor (balance M5).
27. **Runaway spread is linear, not exponential** (balance M6, fun):
    - Each compromised machine infects at most one new target per spread interval.
    - Spread through agents stays within the infected hub's own area.
    - The world reviser specifies the rest.
28. **The Research hall's leak tier is 4** (balance M7, impl L4).
29. **σ per Ratings:** 3·10⁻⁴ → 2·10⁻⁴ (balance M8).
30. **Productivity eligibility is explicit:**
    - Each recipe gets an `allow_productivity` flag, mirroring Factorio's eligible list (intermediates).
    - *Nanofabrication* applies only to the base accelerator (balance B1).
31. **Model collapse bites before quality exists** (fun major): before *Synthetic detection*, σ visibly reduces Trainer output (rate or checkpoint yield). The world and data revisers choose the simplest effect consistent with 03 §2.2.
32. **Hour-one compactness:** map generation guarantees iron, copper, coal, quartz and an archive within the starting college's staffing radius (fun major).
33. **Starting salvage:**
    - One canonical definition, in `meta.yaml`. Display name **Laboratory salvage**.
    - It contains one radar (the Rad Lab nod).
    - No item description may claim that crafted items are surplus.
34. **Text budget.** 08's budget is canonical:
    - Descriptions appear only where they add something, about one in five items and entities.
    - A tech's text is its definition clause plus the citation, never a restatement of unlocks or effects.
    - Remove the validator's mandatory-description rule.
    - Keep the coherence critic's 34-line keep-list. Apply its replacements, including "Hollow: 20%" → "**Yield 80%**".
    - The UI never shows the bare symbol σ; it uses words.
35. **Citation data:**
    - `technologies.yaml` gains `regime: cited | infrastructure | beyond` and a structured `citation: {authors, year, title, venue?, url?}`.
    - The Literature counter uses `cited` techs only.
    - The *Model generation* levels are `beyond`. The Fifth Generation reference lives in a Handbook note, not in a citation.
36. **Accuracy:** every error in R3-accuracy.md is fixed as it proposes. If a reviser finds a proposal itself wrong, they flag it.
37. **Combinator names:**
    - The decider combinator is renamed **Decider unit**: 2.0's multi-condition deciders are not threshold units.
    - Bias unit, Arithmetic unit and Selector unit stay.
    - R3-accuracy may refine this; if it proposes a better accurate name, take it.
38. **The unarmed armoured vehicle** keeps its armour, with no cannon. It is renamed per the coherence critic: anything but "Tank".

## Round 4 file ownership (one owner per file; message others for changes outside your files)
| Owner | Files |
|---|---|
| R4-data | `spec/data/*.yaml`, `SCHEMA.md`, `tools/validate_spec.py`, `tools/render_spec.py`, `spec/02-economy.md`, `spec/05-research.md` |
| R4-world | `spec/00-overview.md`, `01-world.md`, `03-pressure.md`, `04-endgame.md`, `06-expansion.md` (sims under `design/round2/W-sim`, `design/round3/balance-data`) |
| R4-ui | `spec/07-ui.md`, `08-text.md`, `09-vertical-slice.md` |
| R4-arch | `spec/10-architecture.md` |

Ownership additions during round 4:
- **R4-ui** also owns `tools/render_slice.py`, `spec/data/text.yaml` (engine-readable text: tips, milestones, town names, achievements with machine-readable conditions) and `tools/ref/heat_calib3.py`. The heat constants are certified by R4-world.
- **R4-data** adds the `text.yaml` section to SCHEMA.md.
- Check-script patches by Claude (originals kept as `*.orig`):
  - `r3_xref.py`'s boil-steam check is now conditional on 09 still naming it;
  - `r3_checks.py` C07 now accepts §35's structured `citation`.

Accuracy refinements (after R3-accuracy.md landed, ~19:40):
- **§37 refined:** the decider combinator is named **Decision unit**, with the description "Outputs while its conditions hold." (R3-accuracy M1). This overrides "Decider unit".
- **"Oversight 1–4" → "Verification 1–4"** (R3-accuracy M3). The O term in the leak and hollow-work formulas now counts *Verification* techs. Balance is unchanged.
- **Model collapse scales by provenance** (R3-accuracy M4, refining §31): the penalty applies to the share of the Site's training text that came from crawling (exchanges), never to archive-only training.
- Side effect reverted: a helper agent of R3-accuracy had run `pip install --user pypdf`. Claude uninstalled pypdf and typing-extensions and removed `~/.local/lib/python3.8`.

## Round 5 decisions (2026-10-19, after R5-gate and R5-play)

39. **R5-play's accepted improvements are applied by R5-gate:**
    - staffing `per_field_year` 0.04 → 0.08;
    - a loss-curve bar on Trainer weight recipes;
    - "working Seminars" counts town-staffed Seminars only;
    - a pre-registered playtest trigger for the plateau knob;
    - three nits.
    Deferred: R5-play #5 (real citations for takeoff hardware), now R5-gate D14.
40. **R5-gate §4 D1–D13 are accepted with the recommendations exactly as written there:**
    - town-name uniqueness within 8 cells;
    - one precision table;
    - tips kept;
    - the browser store renamed **Run history**;
    - the controller-immunity list;
    - one-hop links;
    - Compromised-only circuit connectors;
    - the leak tooltip;
    - **takeoff technologies gated behind a hidden *Loop closed* trigger tech (D9)**;
    - the scheduler follows `meta.endgame.takeoff_order`;
    - the doubling time is measured from running maxima;
    - D12 (a)–(i);
    - the Wild-only gaps.
41. **D15 taste calls:**
    - keep *Interpretability*'s note "It was always there.";
    - allow `asserts` on achievements (an achievement's own condition is exempt from P17);
    - **keep the leak bar**: it is a mechanical counter in the evolution factor's slot, not a morality meter.
42. **D14 is deferred** to a later content pass (verify sources first; it is mechanically inert).
43. **Open for the user** (not blocking):
    - the runaway preset default (Contained, versus Factorio-like Wild);
    - whether linking many universities by Terminal should be allowed to substitute for Researchers (currently allowed: 01 Objection 2);
    - the r default of 1.71, versus the literature median of 1.2 (both are presets).
40a. **D10 reading** (R5-apply, accepted): the scheduler follows `meta.endgame.takeoff_order` strictly, in list order; it does not search the list. An entry waiting on a technology that Researchers cannot queue is skipped.
    - Reference takeoff: 50.0 min. The search reading gave 56.1 min, outside G17's 5%.
    - Reproduced by `design/round5/R5-apply-d10.py`. Objection recorded in 04 §13 #6.

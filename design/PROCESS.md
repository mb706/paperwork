# Design process log

Goal: one complete, coherent game spec (possibly with one alternative option) that coding can start from right away. It covers ontology, resources, items, recipes, buildings, logistics, power, research and the full tech tree, pressure systems, the endgame, UI/controls, tone and text, expansions, and the vertical slice. The core lists should also exist as machine-readable data, with a validator.

Agent budget: mostly Opus; about 10 Fable runs in total for this phase.

## Rounds

| Round | Purpose | Agents | Status |
|---|---|---|---|
| 0 | First brainstorm → `design-space.md` | 3 Opus + 2 Fable | done 2026-10-19 |
| 1 | Grow the seeds (`round1/`) | A mods & genre (Opus, web) · B ontology / one plane (Opus) · C spacetime map (Fable) · D production economy (Opus) · E research & tech tree (Opus) · F pressure systems (Opus) · G endgame & RSI math with simulation (Opus) · H tone & wit bible (Fable) · I UI & controls reference (Opus, web) | running |
| 2 | Integrate → `spec/` v1, plus an alternative if warranted | Opus integrator, maybe one Fable/Opus alternative | planned |
| 3 | Critique | fun & Factorio fidelity (Fable) · coherence & cleverness (Fable) · balance & numbers with a calculator (Opus) · implementability & performance (Opus) | planned |
| 4 | Revise → spec v2 + `spec/data/*.yaml` + validator | Opus | planned |
| 5 | Final consistency pass and summary for the user | Claude | planned |

Fable runs used in this phase: 2 (round 1: C, H).

## The user's feedback driving round 1 (2026-10-19)

- Wants a complete, concrete mapping (tech tree, resources, items …), possibly in several options, and a look at well-received Factorio mods worth borrowing from.
- **Clever, not silly.** "Burns coffee to get ideas" is overdone and cringe. Aim for things someone finds clever in non-obvious ways. Universal Paperclips is the reference.
- **Coherence on one plane.** If pollution is slop, are we in cyberspace or memetic space? Slop predates AI, e.g. sensationalist journalism. Ideas that don't fit the chosen plane must adapt or go.
- The time-axis map is intriguing but suspect ("do we time-travel?"). It might work if done cleverly.
- This is a major part of development: think ahead, spend the time, and produce specs we can code from.

## Agent IDs (for SendMessage follow-ups)
Round 1 (launched 2026-10-19 ~16:05):
- R1-A mods & genre (Opus): a4002ff4efa9e1d9e
- R1-B ontology (Opus): a0c7c0002b7e428e9
- R1-C spacetime (Fable): aef6b58d41996c4a0
- R1-D production (Opus): a02001665498ce0ef
- R1-E tech tree (Opus): a0fe6fee7575812d6
- R1-F pressure (Opus): aacaeabdee85337be
- R1-G endgame math (Opus): a93d3affcde3e3be6
- R1-H tone bible (Fable): a31438caca947dfa3
- R1-I UI & controls (Opus): a0faa66beb3e3e9f3

## Tooling (ready for rounds 2–4)
- `design/spec/data/SCHEMA.md`: YAML prototype schema (items, resources, recipes, entities, technologies, meta). Ids are unique per kind; cross-kind sharing is idiomatic.
- `tools/validate_spec.py`: schema, references, tech DAG, unlock coverage, producibility, a research playthrough (every tech reachable with what its prerequisites unlock), and pacing statistics (packs per tier, raw cost per pack). Tested on `tools/testdata/spec-mini`: it detects deadlocks and reproduces Factorio's red/green raw costs.

## Round 1: results so far (as they arrive)
- **C (spacetime):** dropped as the main map or a mode, since a physical time axis means time travel on every return belt. Kept three parts: the field's dated frontier as a "years ahead" readout on the research screen (scalar F, also the evolution factor's time term; race mode opt-in); an expansion surface "the Stacks" (an accession-ordered repository with a moving Present); and the sweeping-frontier win condition, moved to the interstellar finale.
- **H (tone):** science packs as a publication ladder (Memo → Report → Proceedings → Article → Preprint → Model card → System card, the last "not written by anyone"); techs named after concepts, with a gray citation line; "Noise" rather than "slop"; a Literature counter; 15 principles and 5 tests; about 140 examples and 15 anti-examples.
- **I (UI):** a full Factorio 2.0 controls/GUI reference (plus the 2.1 tweaks) with a context resolver, a browser key-capture layer, milestones and 28 acceptance tests. Factoriopedia and production stats are in the vertical slice.
- **B (ontology):** **"Information is physical."**
  - One physical continent. Information exists only on carriers, as ideas (the tech tree), or as the world's text, which is summarized by global scalars: W (world tech level), j (human junk share), σ (synthetic share). So slop sits in the evolution-factor slot, not the pollution slot.
  - Pollution is heat.
  - Towns are static terrain: libraries are finite archives; exchanges are crawl wells (backlog first, then the town's rate of new writing).
  - Universities staff labs within commuting range.
  - Compute is a rate and can't be stored; a checkpoint is training compute, kept.
  - Enemies can only be built things that escaped.
  - Dropped: wilderness archives, accelerator cards in any machine, bodiless feral code, abstract planets, the successor-line avatar.
- **F (pressure):** **variant A.**
  - Heat: every joule becomes heat in its chunk; cooling is proportional to heat (a BEND from Factorio's fixed absorption, motivated by simulation); only compute throttles, with ASHRAE-class tolerances.
  - Slop as global scalars.
  - Runaways: escaped copies of your own deployed models, driven by a visible leak counter. They are contained in-base (kill switches, circuit tripwires, monitors fed with eval sets, rollback, air gaps); an escape not caught founds a nest, which runs the full biter loop. "A careful player never sees a nest."
  - Runaways default to on. Scooped results and race mode are opt-in, using C's field clock.
- **E (tech tree):**
  - 240 techs. All 202 Factorio 2.0 techs (base + quality, from Factorio's own data files) are mirrored one to one, plus 38 new.
  - The paper ladder follows H.
  - Concept names with citations, e.g. Semaphores = rail signals, Memex = toolbelt.
  - Endgame: Model generation 1–20 (×2.0 output, ×1.5 cost, so r ≈ 1.71).
  - Data, validator and renderer: `round1/E-data/` (includes Factorio's tech/recipe JSON).
- **G (endgame):** research = W·2^G, r ≈ 1.71 (generation ×2 output, ×1.5 cost) → finite-time singularity; regimes: factory-bound (2 h doubling), talent-bound (10 h), takeoff (10 min → 1 s, braked by power/heat/accelerators), post-victory (~1 h); typical takeoff 48 min, last 20 techs in 4.4 min; overhang 25 halls → 65 min, 1500 halls → 6 min; r as a world setting; capstone after Gen 20 → final frontier run → run report; field line v0 = 2.9 field-years/h. Code: `round1/G-data/figs.py`.
- Scratch preserved: `round1/E-data/`, `round1/F-data/` (heat sims), `round1/G-data/` (takeoff sim), `round1/I-data/` (wiki/FFF dumps).
- **D (production):**
  - 153 items + 8 fluids, 162 recipes, 81 entities; validator 0 errors; all 57 unlock groups reachable.
  - Factorio 2.0 numbers, from game data.
  - Materials and chips: Quartz → silicon; Logic board → Processor → Accelerator.
  - Data refinery: Junk → Text → Prose, cracked by Denoising and Rephrasing.
  - Separate data-line network (fiber).
  - Modules: Coprocessor, Learned controller, Distilled controller.
  - Combinators: Threshold unit, Bias unit, …
  - Data: `round1/D-data/out/data/`.

## Round 2 (launched 2026-10-19 ~17:35): integration, per DECISIONS.md
- R2-W world & systems (Opus): aa1caee375e856eac → spec/00, 01, 03, 04, 06
- R2-D data (Opus): a78740d697aaa8737 → spec/data/*.yaml, 02, 05, tools/render_spec.py
- R2-U UI, text & slice (Opus): a45445e3e39dbc1f1 → spec/07, 08, 09
- R2-A architecture (Opus): ad5f219fd38908e0d → spec/10
- Round 1 R1-A (mods) still running; its adopt list goes to the R2 agents via SendMessage.
- **A (mods & genre, done ~17:45):**
  - Players keep loops and cut ladders. Proposed experiment media loop: Analysis 0.05 significant / 0.95 null (α); Meta-analysis in Kovarex's shape; "File drawer" chest tier.
  - Keep the first hour as short as vanilla's.
  - Blueprint deployer only in the finale.
  - Heat needs four anti-cascade guards (F already meets them).
  - Make staffing legible in hour one.
  - QoL baseline: rate calculator, status lights, even distribution, Squeak Through, milestone log.
  - Corrects H's claim that Paperclips' game theory is accurate (its labels sit over random payoffs).
  - Three historical claims need sourcing.
  - Adopt items sent to all four R2 agents via SendMessage.

## Round 2 results
- **R2-W (done ~18:30):**
  - Wrote spec/00, 01, 03, 04, 06.
  - Re-simulated the takeoff on the real tree: reference 49.0 min; r presets give 70 / 49 / 42 min.
  - Raised the closure definition (now DECISIONS §16).
  - Objections: tank cannon vs L14; a soft staffing cap; F's non-conserving heat (fixed by §18); fast runaway spread.
  - Sims: `round2/W-sim/`.
- **R2-U (done ~18:35):**
  - Wrote spec/07, 08, 09.
  - Slice: 54 items, 47 recipes, 32 entities, 24 techs; validator passes on slice data.
  - The UI encyclopedia is named "Handbook"; 30 achievements; 19 tips.
  - Fixes: Stigler's law moved to *Stored program*; "Threshold unit" may be inaccurate for 2.0's multi-condition decider (for the round 3 accuracy critic); 04 §9 achievements to sync with 08 (§20).
- **R2-A (done ~18:40):**
  - Wrote spec/10.
  - Stack tested on this host: TypeScript 7.0.2, Vite 8.3.2, Vitest 5.0.3, Biome 2.5.15, SolidJS 1.9.15, Playwright 1.64.1. Pinned package.json + lockfile in `round2/A-stack-test/`.
  - Custom WebGL2 renderer; deterministic math (Math.sin differs between browsers); OPFS/IndexedDB saves; 20 golden tests.
  - Estimate: ~122k LOC + 58k tests, 108–139 agent-days for M0–M4.
  - Flags: boiler water:steam is 1:1 (Factorio 1.1) but should be 1:10 (2.0); battery vs compute priority; achievement 12 provenance; optional import of the user's Factorio blueprints.
- **R2-D:** still running (data YAML, 02/05).
- **R2-D (done ~18:55):**
  - spec/data: 219 items, 10 fluids, 9 resources, 230 recipes, 103 entities, 250 techs, 15 enemies; validator 0 errors / 0 warnings; playthrough reaches all 250 techs in 26 waves.
  - Rendered 02/05 with tools/render_spec.py (pacing vs Factorio 2.0.77).
  - Validator gained a check that each tech's unlocks are satisfiable by its prerequisites.
  - Decisions to review: unarmed Tank; Proceedings after blue; experiment loop is heavy (42 Trainers / 60 Articles/min); quality module named "Comparator" (08 says "Sampler"); some estimated numbers.
  - Build scripts: `round2/D-build/`.

## Round 3 (launched ~19:00): critique, outputs in design/round3/
- R3 fun & fidelity (Fable): a26d8ea97b0b797d8 → R3-fun.md
- R3 coherence & tone (Fable): aa649ea5991c548d4 → R3-coherence-tone.md
- R3 accuracy audit (Opus, web): a7694468a78890335 → R3-accuracy.md
- R3 balance & numbers (Opus): a219fc59e23526a00 → R3-balance.md
- R3 implementability (Opus): a3a2a4c935d82a86d → R3-implementability.md

Fable runs used this phase: 4 (R1-C, R1-H, R3 fun, R3 coherence).

## Round 3 results (critiques in design/round3/)
- **Fun (Fable):**
  - Blockers: experiment loop too slow; staffing too tight.
  - Majors: model collapse is inert; reactor chunk heat; hour-one compactness; exponential spread.
  - Evidence: `fun-data/`.
- **Coherence & tone (Fable):**
  - The plane holds.
  - Blockers: salvage defined three ways; no regime/citation fields.
  - 15 majors, including: description budget exceeded (all ~480 entries have one); "Thorp, 1998" jumps Literature in green; "Hollow: 20%" → "Yield 80%"; Decider ≠ threshold unit.
  - Keep-list of 34 lines.
- **Implementability (Opus):**
  - 4 M1 blockers, 6 later blockers (with exact rules), 24 majors, 30 minors, 64 invent-a-rule spots, 31 missing parameters.
  - Executable checks: `impl-data/r3_checks.py` (30), `r3_xref.py`.
- **Balance (Opus):**
  - Blocker: productivity eligibility (16× accelerators).
  - Majors: staffing binds at 0.8 h and Researchers don't matter; halls with modules remove the brakes; Article 3.1×; fusion heat; Switch throttle; agent spread; hall tier; σ variance.
  - Takeoff 49.0 min confirmed. Scripts: `balance-data/`.
- **Accuracy (Opus, web):** still running at round-4 launch.

## Round 4 (launched ~19:15): revision, per DECISIONS §21–§38
- R4-data (Opus): a6c2f4d2d023c090c → spec/data, SCHEMA, validator, render, 02, 05
- R4-world (Opus): a6f8b2677600151c4 → spec/00, 01, 03, 04, 06
- R4-ui (Opus): afb930b7ff88a7987 → spec/07, 08, 09
- R4-arch (Opus): a8cd312a281b57f45 → spec/10
- Exit criteria: validator 0 errors; r3_checks.py and r3_xref.py pass.
- **Accuracy (Opus, web; done ~19:40):**
  - 0 blockers, 9 majors, ~40 minors, each with a source and a replacement.
  - Decision unit; Deep learning definition (Hinton 2006 is layer-wise); Rock's law, not Moore; Formal verification + King 1969; Crawling → Eichmann/McBryan 1994; Watermarking; Brooks.
  - Oversight → Verification; model collapse by provenance.
  - Confirms α = 0.05 / 5% significant matches Rosenthal's extreme case; r = 1.2 is Davidson & Houlden's median; ASHRAE limits correct.
  - Routed to all four R4 revisers. Its helper's `pip install --user pypdf` was reverted by Claude.

## Round 4 results (all done by ~20:10)
- **R4-arch:** spec/10 revised:
  - data contract (tiles/world/text, one expression compiler);
  - runaway lifecycle, Research halls, heat, staffing and power order;
  - a save format with globals, timers and RNG;
  - rule scenarios R1–R17;
  - milestone manifests in `round4/arch-data/`.
- **R4-ui:**
  - 07, 08 and 09 revised; 09 §2 generated by `tools/render_slice.py`.
  - Slice: 23 techs, 1,535 Memos and 1,285 Reports, Literature 1969.
  - New `spec/data/text.yaml` (tips, milestones, town names, 30 achievements with machine-readable conditions); `tools/ref/heat_calib3.py`.
- **R4-world:**
  - 00, 01, 03, 04 and 06 revised. Staffing T₀ × min(2, 1 + W/25); the Terminal.
  - Takeoff 50.0 min with Researchers, 78 without.
  - Fission block peaks at 330–430 °C (compute about 6 chunks away).
  - The hour-one start area held in all 5,000 layouts.
  - Model collapse scales by σ × crawl share.
  - Sims in `round4/world-sim/`.
  - Rejected: the post-victory queue protection; the 60×60 start square (uses 40×40 + 7,500 tiles instead).
- **R4-data:**
  - Data revised: tiles.yaml and world.yaml added; 47 productivity flags; regimes (90 cited / 149 infrastructure / 11 beyond); 118 citations verified against Crossref/DOI/arXiv; descriptions trimmed (39 items, 23 buildings, 82 techs); meta formulas turned into numbers; validator extended.
  - Migration script: `round4/data-migration/`.
- **Claude's independent check (~20:15):** validator 0/0 (220 items, 232 recipes, 104 entities, 250 techs, 18 tiles); spec-mini OK; r3_checks 30/30; r3_xref clean (654 refs, 0 dangling); render_slice OK (one expected warning).

## Round 5 (launched ~20:15): final gate
- R5-gate (Opus, may edit all files): a468efeb2858569c1 → round5/R5-gate.md + spec/README.md
- R5-play (Fable, read-only): a6a19fe97c2af87d2 → round5/R5-play.md

Fable runs used this phase: 5.

## Round 5 results
- **R5-play (Fable, read-only, ~20:35):**
  - No must-fix items: "ship to coding".
  - All 34 keep-list lines survived; no cringe found; the plane holds.
  - Five worth-doing items: #1–#4 and #6 accepted and applied by R5-gate; #5 deferred.
- **R5-gate (Opus, ~21:10):** verdict **ready to start coding**.
  - Fixed 8 implementer-facing bugs (Seminar speed composition, saved state, heat-test chunk, Frontier cluster rules, M2 trigger dead-end, peak power, end-state count, final-run checkpoint) plus about 100 smaller ones.
  - Added checks: `render_spec --check`, a stale check in `render_slice --check`, stray-null warnings, and a duplicate-value agreement check.
  - Wrote spec/README.md.
  - Listed 15 decisions (D1–D15): D1–D13 and D15 accepted (DECISIONS §40–§41); D14 deferred.
- **R5-apply (Opus):** applying DECISIONS §40–§41; running at the time of writing.
- Claude's wrap-up: CLAUDE.md now has a "game design" section; memory updated (project status, design principles, humor, subagent usage).

Fable runs used this phase: 5 (of a budget of about 10).
- **R5-apply (Opus, done):** applied D1–D13 and D15 to the owning files; added the hidden *Loop closed* tech (251 techs). D10 is read strictly (DECISIONS §40a).
- **Final state (Claude's last run):**
  - validator 0/0; spec-mini OK; render_spec and render_slice --check OK; r3_checks 30/30; r3_xref 749 refs, 0 dangling; milestone manifests close; takeoff_r4 reproduces byte for byte.
  - Size: ~147k words across 12 chapters + README; 376 KB of YAML data.
- **Phase totals:** 25 agents (20 Opus, 5 Fable) over 5 rounds, ~16:05–21:40, plus helper agents some of them spawned.

**PHASE COMPLETE: spec ready for M0/M1.**

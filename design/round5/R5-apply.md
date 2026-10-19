# R5-apply: R5-gate's decisions applied

*Round 5, final editor (Opus), 2026-10-19. Inputs: `DECISIONS.md` §39–§43, `round5/R5-gate.md` §4 (D1–D15), `spec/README.md`. Mandate: apply DECISIONS §40 (D1–D13 as R5-gate §4 recommends them) and §41 (D15) to the owning files, keep every check green, leave D14 deferred.*

## Result

Every decision of §40 and §41 is in the owning files; R5-gate §4 has a new column naming them per row. D14 stays deferred, with a note wherever the takeoff hardware is listed (04 §5, 05 §6, a comment in `technologies.yaml`). `spec/README.md`'s readiness section now lists no open decision for M1 or M2–M5, only the three items DECISIONS §43 leaves to the user.

| Check (from `/home/mewse/browsergame`) | Result |
|---|---|
| `validate_spec.py design/spec/data` | 0 errors, 0 warnings; 251 technologies (250 plus the hidden *Loop closed*), all reachable in 27 waves (26 before: the gate adds one wave) |
| `validate_spec.py tools/testdata/spec-mini` | 0 errors, 0 warnings |
| `render_spec.py`, then `--check` | 02 and 05 regenerated; match the data |
| `render_slice.py`, then `--check` | 0 errors, the expected uranium-ore warning; 09 unchanged by the generator |
| `r3_checks.py` / `r3_xref.py` | 30 of 30 / clean (749 section references, 0 dangling) |
| `manifests.py` | M1–M5 close; M4 has 185 technologies (184 + *Loop closed*), M5 all |
| Round-4 sims (`takeoff_r4`, `staffing_r4`, `arc_r4`, `heat_r4`, `startarea`) | Re-run after the data changes: all five reproduce their saved `.out` byte for byte. Takeoff reference **49.99 min**, unchanged |

**Why D9 moves no simulated number.** No sim ever researched a technology paid in System cards alone before closure: `pacing.py` keeps only the four white pre-closure technologies, and `takeoff_r4.py` starts at closure with the whole takeoff unresearched. The gate makes the game match the sims' assumption. It changes only the validator's playthrough (one more wave) and the M4 count.

## Decisions that needed a reading or a completion

Each is recorded in the owning file, and an objection is raised where the text as written would not do what its own rationale says.

1. **D10, the scheduler's sentence, read strictly** (04 §5.1, §13 #6). Read as a search over the whole order, "the first technology … that is neither researched nor queued and whose prerequisites are all researched" queues every available hardware technology behind level k while k + 1 waits, which is the round-4 fault D10 names. `R5-apply-d10.py` (output in `R5-apply-d10.out`) runs the takeoff model under each reading: strict 49.99 min (the reference order exactly); as a search 56.06 min, outside G17's 5%. The strict reading is applied: walk the order; the first entry neither researched nor queued is appended once its prerequisites are researched, and nothing is appended while it waits. **Completion:** an entry whose prerequisite closure holds an unresearched technology outside the order (*Fusion power* without *Nuclear power*, *Two-phase* and *Microfluidic cooling* without *Liquid cooling*) is passed over, so that R13's "the queue never stalls" still holds. `takeoff_order` became a data list (ids and `{id: level}`), extended with levels 16–25 and *Energy per operation* as D10 says; the validator checks that it holds every System-card-only level once, in prerequisite order.
2. **D9's hidden technology.** `loop-closed`, code T08, regime `infrastructure`, trigger `craft-recipe` on `research-run`, count 1, prerequisite *Automated research*, no unlocks. It replaces *Automated research* as the prerequisite of *Model generation*, *Wafer-scale integration*, *Fusion power*, *Research scheduling*, *Two-phase cooling*, *Fleet scheduling* and *Sparse inference*; the rest follow through their lines, the Constructor included. A hidden technology has no card, queue entry, toast or research log line and counts in no readout. The cards that require it show `Available once the loop closes: the first System card written by a Research hall.` (08 §4.6), and *Start research* refuses them before closure.
3. **D11's empty case.** Until the rate has doubled since closure no s ≥ closure qualifies, so the readout shows "—", as it already did at zero rate (04 §9).
4. **D1's suffix.** " II", then " III" and so on if a suffixed name is held too; otherwise uniqueness is not guaranteed. The numbers live in `text.yaml`'s `town_names.uniqueness`.
5. **D12b's exactness.** The data stores the default r as the double nearest ln 2 / ln 1.5 (1.7095112913514547), with `labels` for display, so 1.5^r = 2.0 exactly in the tools. The engine sets m = 2 for that preset rather than trusting `detmath.pow` (10 §5.12). 05's System-card totals moved slightly (9,564 → 9,570 cards for the generations).
6. **D13's "every damage dealer".** Besides the entities' `extra.ammo_category` (turrets, artillery, land mine, Legged agent), the Interceptors carry `ammo.damage_category` (their slot category stays `interceptor`), and the two defense equipments `equipment.ammo_category`, so every category in `meta.damage_categories` has a dealer; the validator checks both directions.
7. **D7's wording.** The rule is stated as "where Factorio 2.0 gives the counterpart no connector (labs and beacons, so Seminars and Switches)". R5-gate also named furnaces and silos, which I could not confirm against 2.0 here, so they are not asserted.
8. **D2 on the console.** `/world` prints the shares as percentages by the same table, because 07 §0 (impl U7) requires one rounded number per quantity on every surface.
9. **D4 in the engine.** The IndexedDB store is renamed `runHistory` as well as the UI label.
10. **D12i's placement.** The achievements window is 07 §13.7: the Esc menu and a new main-menu row, from M4.
11. **D15.** P17's one exemption is written into 08 §1.2 and §6, and the validator now checks that every digit in an achievement's text is one of its own condition's values (as is, as a percent, or a duration in minutes or hours). `asserts` on achievements were already evaluated; SCHEMA now documents them.

## Tool support added

- `tools/validate_spec.py`: the `craft-recipe` trigger (schema, references, playthrough, closure check), `hidden` technologies (a trigger, no unlocks), `check_takeoff_order`, `check_damage`, the plasma's energy per unit (fusion reactor against generator), the achievement-digit check, and `run_checks()` so that `render_spec.py` counts with exactly the same checks. Each new check was negative-tested on a scratch copy of the data (a level out of range, an order that breaks a prerequisite, a missing entry, an unknown category, a plasma mismatch, a wrong achievement number, an unknown or unreachable trigger recipe, a hidden technology that unlocks, a non-boolean `hidden`, a trigger outside the prerequisite closure).
- `tools/render_spec.py`: reads the takeoff order and the r presets from the data (no hardcoded order), shows the hidden technology in 05 §3, counts 250 visible technologies and the hidden one apart, and adds 05 §8.3 for round 5 and the D14 note in §6.

## Files changed

- Data: `spec/data/technologies.yaml`, `meta.yaml`, `entities.yaml`, `items.yaml`, `enemies.yaml`, `text.yaml`, `SCHEMA.md`.
- Tools: `tools/validate_spec.py`, `tools/render_spec.py`.
- Chapters: `spec/00-overview.md`, `01-world.md`, `03-pressure.md`, `04-endgame.md`, `07-ui.md`, `08-text.md`, `09-vertical-slice.md` (§6, §10 only), `10-architecture.md`, `README.md`; `02-economy.md` and `05-research.md` regenerated.
- Round 5: `R5-gate.md` (§4's Applied column, two status lines), this log, `R5-apply-d10.py` and `R5-apply-d10.out`.

# Spec: start here

*Round 5 (R5-gate, then R5-apply), 2026-10-19. The entry point to the design spec. Binding decisions: `../DECISIONS.md`. History: `../PROCESS.md`. The gate's findings and its decisions, each marked with the files that apply it: `../round5/R5-gate.md` §4; how they were applied: `../round5/R5-apply.md`.*

## What the game is

**Paperwork** — *Information is physical.* (title and tagline: DECISIONS §44, 08 §3.1; repository `github.com/mb706/paperwork`)

1. A single-player 2D browser game that plays like Factorio 2.0 (the same belts, inserters, machines, numbers and keybindings), themed on AI research: in 1945 a federal charter founds a research Site "to determine whether the work of this Site can be done by a machine."
2. Everything obeys one law, *information is physical*: ore, archives of records and town exchanges feed the papers (Memo, Report, Proceedings, Article, Preprint, Model card, System card) that Seminars consume to research 250 technologies, and information exists only on carriers, as ideas in the tree, or as three global numbers (W, j, σ) in the evolution factor's slot.
3. From minute one, three systems sit on top of Factorio: a per-chunk heat field on pollution's engine (only computing machines throttle), staffing (Seminars need staff from universities within commuting range), and the world's text (the field's progress, the junk share and the synthetic share of new writing).
4. The only adversaries are the player's own deployed models: in the default *Contained* preset a leak counter compromises machines that the player contains with power switches, monitors, rollback and air gaps, and Factorio's biter loop exists only in the optional *Wild* preset; the player never fights.
5. The game ends in a takeoff: when a Research hall writes its first System card the loop closes, *Model generation* 6 → 25 doubles research per paper at every level, power, heat, accelerators and Seminar capacity brake it (about 50 minutes at the reference), and a final frontier run stamps the charter "Determined." while the run report infers the player's objective from their production statistics.

## File map

| File | What it is | Authority for | Change it by |
|---|---|---|---|
| `../DECISIONS.md` | The binding decisions of rounds 2, 4 and 5 | Whatever it decides. §24 supersedes §18 and §18a; the accuracy refinements override §37 and "Oversight"; §40–§42 adopt R5-gate §4's D1–D15 | Claude only. A chapter that disagrees says so in its Objections section |
| `00-overview.md` | The game on two pages; every BEND and BREAK against Factorio (§8); cross-document naming resolutions (§9); where the numbers come from (§10) | The deviation register and the naming resolutions | Prose |
| `01-world.md` | Map generation, tiles, world objects, the climate compass, patches, towns, archives, exchanges, staffing, the starting area, W, j and σ | World rules and staffing | Prose; the numbers live in `data/meta.yaml` |
| `02-economy.md` | Items, recipes and buildings by tier; heat, quality and the experiment loop in summary | Nothing: **generated** | `tools/render_spec.py` (its hand-written sections are text blocks inside that script) |
| `03-pressure.md` | Heat, the effects of the world's text, runaways, hollow work, Scooped, Race | Pressure rules | Prose |
| `04-endgame.md` | Frontier cluster, Research halls, the Researcher, the production function, the takeoff tree, brakes, overhang, victory and the run report's measurements, after victory | Endgame rules and the run-report measurements | Prose |
| `05-research.md` | Papers, the tree by tier, infinite technologies, takeoff tables, pacing against Factorio 2.0, references | Nothing: **generated** | `tools/render_spec.py` |
| `06-expansion.md` | An outline of the expansion surfaces (milestone M7) | The outline only | Prose |
| `07-ui.md` | UI and controls as deltas on `../round1/I-ui-controls.md`, which stays normative; **[S]** marks slice scope; tests UI-G1–UI-G26 | What the UI shows and how it is operated | Prose |
| `08-text.md` | The voice, text budgets, every UI string (readouts, statuses, alerts, log lines, the charter, the run report), naming and citation formats | UI strings and text rules | Prose; data-borne strings live in the YAML |
| `09-vertical-slice.md` | Milestone M1: definition, reading list (§0.1), content (§1–§2, **generated**), acceptance tests S-G1–S-G19, build order | M1's scope and acceptance | Prose; §1–§2 by `tools/render_slice.py` from §2.7's source keys |
| `10-architecture.md` | The engine, version 2: the simulation in Rust compiled to WebAssembly; stack, data stage, threads and the language boundary, determinism rules D1–D23, systems, rendering, UI layer, saves and checkpoints, assets, tests (goldens G1–G20, rule scenarios R1–R29), performance (§11 is the single source), milestones M0–M7 and MP, and **the M0 contracts (§15)**. Its "Changes in v2" table lists every decision that changed, with its source | How it is built, every engine edge rule the design left open, and the formats the M0 work packages build against | Prose; the owning chapter carries the same sentence |
| `11-multiplayer.md` | Multiplayer: deterministic lockstep sequenced by a relay over WebSocket on 443; transport and the no-P2P verdict, the tick protocol, latency hiding, joins, desyncs and repair, the relay server, the engine seams (an index into 10), the multiplayer UI, the test plan, open questions and the proof of concept | The network protocol, the relay and the multiplayer UI; the engine seams themselves are 10's | Prose |
| `data/*.yaml` | Items, recipes, entities, technologies, resources, enemies, tiles, world objects, `meta`, `text` | Every number, id, display name and data-borne string | Edit, then run the checks below |
| `data/SCHEMA.md` | The data contract and the validator's check list | What each field means | Prose, kept in step with `tools/validate_spec.py` |
| `../round1/I-ui-controls.md` | Factorio 2.0's controls and GUIs, feel tests F1–F28, the `InputAction` list | Normative for M1 wherever 07 does not amend it | Frozen |
| `../../tools/ref/heat_calib3.py` | The heat field's golden reference (F's `calib3.py`, verbatim) | 09 S-G4, 10 G15 (0.5 K) | Frozen |

**Precedence.** DECISIONS first, with `pm/DECISIONS-IMPL.md` for implementation-time engineering decisions. Then the data for numbers, ids and names; 01, 03 and 04 for world, pressure and endgame rules; 10 for engine edge rules and the M0 contracts; 11 for the multiplayer protocol; 07 for what the UI shows; 08 for strings. Generated text is never an authority: if it is wrong, the data or the generator is.

**Milestone names.** 10 §12's M0–M7, with MP (multiplayer, chapter 11) after M4, are the project's milestones. `I-ui-controls.md` numbers its own UI build steps M0–M4; 09 §6 maps them onto the project's.

## Reading order for M0

M0 builds the foundations (10 §12): the scaffold, the schema and data stage, the Rust simulation core, the worker shell, renderer, UI and input, asset pipeline and audio engine v0, each against the contracts of 10 §15.

1. This file, `../../CLAUDE.md`, `../../pm/README.md` and `../../pm/DECISIONS-IMPL.md`.
2. 10's "Changes in v2", then §0–§4 (decisions, constraints, stack and data stage, runtime and the language boundary, the simulation core with D1–D23 and the digests), §8 (persistence), §10 (testing), §12's M0, and **§15, the M0 contracts**, in full.
3. 11 §0, §1.4, §3.1–§3.3 and §7: the multiplayer seams M0 builds, and why.
4. Then, per work package (10 §15.11):
   - schema: 10 §2.4, §15.1–§15.3, `data/SCHEMA.md`;
   - sim: 10 §4, §5.1, §5.18, §15.3–§15.9, and `../engine-study/` (the Rust kernel, `clippy.toml`, the build script);
   - shell: 10 §3, §8, §15.4–§15.8, and the engine study's worker harness;
   - renderer: 10 §6, §15.4 and §15.7, and `../art/DIRECTION.md`;
   - UI and input: 10 §7 and §15.5, `../round1/I-ui-controls.md` §1, and 07;
   - assets and audio: 10 §9 (WP B2), §15.6–§15.7, `../art/DIRECTION.md` and `../audio/DIRECTION.md`.

## Reading order for M1

09 §0.1 is the authoritative list; this is the order to read it in.

1. This file, then `../DECISIONS.md` (skim; it is binding).
2. 00 §1–§7: the game in twenty minutes.
3. 09 in full: scope, content, tests and build order S0–S10.
4. 10 §0–§4 (decisions, constraints, stack and data stage, runtime, simulation core), §5.1–§5.12 and §5.18–§5.20 (systems), §6–§11, §12's M0 and M1, and §15 (the contracts).
5. `data/SCHEMA.md`, then the YAML through 09 §2.7's slice manifest.
6. `../round1/I-ui-controls.md` §1–§6 and §8.2 (input, controls, interaction semantics, screens, the feel tests, `InputAction`).
7. 07: every [S] row, the untagged sections 09 §0.1 lists, and §23 (icons and sprites).
8. 08 §0–§1, §4.6–§4.7, §5, §8–§10, and `data/text.yaml`.
9. 01 §2–§9 and §12.1; 03 §1.1–§1.7 and §1.9.

## Checks and generators

Run from `/home/mewse/browsergame`. All must stay green; the slice check's one warning (uranium ore is a dead end in the slice) is expected.

| Command | Checks or does | Run it |
|---|---|---|
| `gamedev-python tools/validate_spec.py design/spec/data` | Schema, references, the technology DAG, the research playthrough, closures, citations, text rules, expressions, stray nulls, and round 5's takeoff order, damage categories, hidden trigger technologies and achievement numbers. Must print 0 errors, 0 warnings | After every data edit |
| `gamedev-python tools/validate_spec.py tools/testdata/spec-mini` | The validator's own regression case (v0 data) | After editing the validator |
| `gamedev-python tools/render_spec.py` | Rewrites 02 and 05 from the data. `--check` writes nothing and exits 1 if either is stale | After every data edit or renderer edit |
| `gamedev-python tools/render_slice.py` | Derives the slice from 09 §2.7, runs the validator's checks on it, rewrites 09 §1–§2. `--check` exits 1 on an error or a stale 09 | After data edits, or edits to 09 §2.7's source keys |
| `gamedev-python design/round3/impl-data/r3_checks.py` | 30 cross-document consistency checks (round 3's blockers) | After editing chapters or data |
| `gamedev-python design/round3/impl-data/r3_xref.py` | Ids in prose exist, kebab tokens in YAML values, the 09 manifest against the data, 08's placeholders, and that every "NN §x.y" reference resolves | After editing chapters |
| `gamedev-python design/round4/arch-data/manifests.py` | The milestone build filters M1–M5 close over the data (10 §12) | After changing technology tiers or prerequisites |
| `gamedev-python design/round3/accuracy-data/yearcheck.py`, `textrules.py` | Independent cross-checks of citations and UI text rules | Optional |

Once code exists, `npm run check` runs the validator and both `--check` modes with the data stage (10 §2.3).

## The data-pipeline rule

- The YAML in `data/` is the single source of truth for every number, id, display name and data-borne string. Prose that repeats a number binds to the data (08 P17), and the engine reads the data through its data stage (10 §2.4), never prose.
- **02-economy.md, 05-research.md and 09 §1–§2 (between the `render_slice` markers) are generated.** Never edit them by hand. Change the YAML; for 02's and 05's hand-written sections change the text blocks in `tools/render_spec.py`, and for 09 §2.6's reasons `OUT_REASONS` in `tools/render_slice.py`; then re-run both generators.
- After any data edit: validate, `render_spec.py`, `render_slice.py`, `r3_checks.py`, `r3_xref.py`. A failing run blocks the milestone.

## Simulations: where they live and what they certify

All run with `gamedev-python <script>` from `/home/mewse/browsergame`; each round-4 script's output is saved beside it as `.out` and reproduces exactly.

| Script | Certifies | Feeds |
|---|---|---|
| `design/round4/world-sim/takeoff_r4.py` | The takeoff at 60 s per unit from the reference closure state: 50.0 min (78 without Researchers), the cascade, what binds, the overhang sweep, the returns presets, hollow work, expected compromises | 03 §3.2, §4; 04 §0, §2.4, §4–§7; 10 G17 (within 5%) |
| `design/round4/world-sim/staffing_r4.py` | The supply law (read from `meta.staffing.supply`) at 6-, 8- and 12-h competent paces, with and without claims; takeoff against human Seminar capacity | 01 §8.1, §8.8 |
| `design/round4/world-sim/arc_r4.py` | The whole arc: tier ends, W, Field, Literature, j, closure and capstone times, Race timings, σ by research completeness | 00 §4; 01 §12; 03 §2.3, §6, §7; 04 §11 |
| `design/round4/world-sim/heat_r4.py` | Thermal plants under DECISIONS §24 on the reference field | 03 §1.6 |
| `design/round4/world-sim/startarea.py` | The hour-one guarantees hold in 5,000 random layouts | 01 §9 |
| `tools/ref/heat_calib3.py` | The heat field's update rule and its steady states | 03 §1.6; 09 S-G4; 10 G15 |
| `design/round2/W-sim/` | G's takeoff model and round 2's tree, imported unchanged by `takeoff_r4.py` | — |
| `design/round3/balance-data/` | R3-balance's evidence, historical: its staffing model predates DECISIONS §23. `pacing.py` supplies the research lists and order that the round-4 sims import | R3-balance.md |

What they certify is the aggregate design: pacing, staffing, the takeoff's length and brakes, thermal-plant siting. They are not the engine. The engine must reproduce the takeoff reference within 5% (G17) and the heat golden within 0.5 K (S-G4, G15); everything else is checked by the tests of 09 and 10.

Round 5 doubled the staffing supply slope (`per_field_year` 0.04 → 0.08, R5-play): `staffing_r4.py` and `arc_r4.py` now read the law from the data, and their round-4 outputs are kept as `.out.orig`. After R5-apply's data changes all five round-4 sims still reproduce their saved `.out` byte for byte (takeoff 50.0 min): no sim ever researched a takeoff technology before closure, so gating them behind *Loop closed* changes none of their assumptions. `../round5/R5-apply-d10.py` compares the two readings of the scheduler decision in the takeoff model (04 §13 #6).

## Start-coding readiness

**Ready.** M0 and M1 can start now: every check is green, and the slice's content, screens, tests and build order are complete.

- **No open M1 decisions.** R5-gate's four M1 points are settled in the owning files (DECISIONS §40): town names are unique within 8 cells (01 §5.3, 08 §10.4, 10 §5.18; build step S1); one precision table governs the UI's numbers (07 §0; S4, S6); loading tips may name content a build lacks (08 §7; S9); the per-browser store is the **Run history** (07 §19.2; S9).
- **No open design decisions for M2–M5.** D5–D13 and D15 are applied too: the controller-immunity lists, one-hop links, Compromised-only connectors and the leak tooltip (03 §3, M3); the takeoff gated behind the hidden *Loop closed*, the scheduler's order, the doubling time from running maxima and D12's endgame points (04, M4); the Wild gaps (03 §3.6, M5); and the three taste calls (08). Each row of R5-gate §4 names the files that carry it. The one deferral is D14, citations for three takeoff hardware technologies, mechanically inert (DECISIONS §42; noted in 04 §5).
- **Left to the user** (DECISIONS §43; none blocks a milestone):
  1. the runaway preset default: *Contained*, as specified, or the Factorio-like *Wild* (03 §3.5);
  2. whether linking many universities by Terminal may substitute for Researchers, as it currently may (01 §14 #2, 04 §2.4);
  3. the default returns to research: r = 1.71, as specified, or the published median 1.2 (both are presets; 04 §4).

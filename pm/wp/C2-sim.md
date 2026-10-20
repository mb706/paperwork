# C2: The simulation crates (M0 Sim package), in three phases

**Owner:** one Opus agent, kept across all three phases. The manager resumes you with codex review findings between phases.
- **Where:** the main tree, branch `dev`. Commit at milestones, staging only your own paths; never `git add -A`; never push or rewrite history. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Writes to:**
  - `game/crates/{det,worldgen,sim,simabi,genabi,simtool}/**`;
  - Rust-side tests and scenarios under `game/test/` (layouts, scenarios, saves, logs);
  - the bench scenarios in `game/bench/`;
  - `CLAUDE.md` (a short sim section);
  - `pm/reports/C2.md` (one section per phase).
- **Schema changes** only through the schema: edit `game/schema/`, run `npm run gen`, add the `compat.yaml` ledger entry and bump the version, update the README, and list the change prominently in your report. Parallel agents build against the schema.
- **Must not touch:** `game/src/**` (TypeScript layers owned by others), `design/**`, the golden set (C1c owns it; if you believe a golden value is wrong, report it with the spec citation and do not edit it).

## Context

The M0 contract gate has passed: see `pm/reports/C1a.md`, `pm/reports/C1b.md` and `pm/reports/C1c.md`, and the codex reviews in `pm/reviews/`. The schema, the generated code, the codec fixtures, the fake sim, the reference model and the **frozen M0 golden integration set** exist.

Other agents now build the worker shell (C3), the renderer (C4) and later the UI (C5) **in parallel against the same contract**. Your sim must meet that contract exactly; the golden set is the referee.

Binding decisions: `pm/DECISIONS-IMPL.md`, especially:
- 1: the Rust/WASM clean split and the five boundary rules;
- 2: bitset active sets and the wake rules;
- 7–12: worldgen in Rust, the expression bytecode, ordering, a fresh worker per world, the contracts, the v2 changes table.

## Read

- `CLAUDE.md`, `pm/README.md`, `pm/DECISIONS-IMPL.md`.
- `game/schema/README.md`; the golden set's README; `pm/reports/C1c.md` ("How each package consumes the golden set").
- `design/spec/10-architecture.md`:
  - "Changes in v2";
  - §2.5 (code rules);
  - §3.6 (the language boundary);
  - **§4 in full**: determinism D1–D23, units, ids and RNG, world, chunks, storage, scheduling, the cost model, digests;
  - §5.1–§5.2 at M0's scope;
  - §5.18 (worldgen v0);
  - **§8** (the save container, versioning, replays, checkpoints);
  - §10 (testing, D18's suites, the benchmarks);
  - **§15** (the contracts you implement: closures §15.3, packet §15.4, projections §15.5, events §15.6, ABI §15.8, worldgen §15.9);
  - §12 (M0 scope and exit).
- `design/spec/11-multiplayer.md` §7 (the seams the sim owns).
- `design/engine-study/rust/`: A1's proven kernel, the clippy bans and the build. Reuse its patterns.

## Phase C2a: the core

- `det`: libm re-exports, `powi`, piecewise tables; the only crate that uses libm.
- The `sim` World:
  - `players[]`, surfaces, chunks, spatial queries;
  - the entity table and the generated pools;
  - the scheduler: bitset active sets in pool order, wake sequence numbers, the timer wheel, bounded registrations (B1-r1 17);
  - RNG with the pinned algorithm and its golden vectors;
  - digests and the state hash (§4.8) with full coverage;
  - the save container v2 and checkpoints, with digest lineage.
- `simtool`: `hash` and `trace`.

**Exit:** save, load and hash round-trip natively; the NO_SLEEP harness exists; clippy and `cargo test` are clean; any golden-set parts that need no systems pass. **Stop, append your phase report, and reply.**

## Phase C2b: the rules

- **The action pipeline:** preflight and field validation (refusals as events, never a stopped tick), references, input fencing, the creation ring, system actions; and the `TestSequencer`.
- **The M0 systems:** character movement and collision; chests and inventories; hand mining and hand crafting.
- **Worldgen v0** and inline chunk commits, with `genabi`.

**Exit:**
- **The golden set's states and per-tick digests pass, natively and in WebAssembly** (through `simabi`).
- D18 (a), (b), (c) and (e) pass on every M0 scenario: join equivalence, NO_SLEEP, heavy mode, replay.
- R23–R29's M0 cases pass.

**Stop, report, reply.**

## Phase C2c: the boundary

- **Extraction** with `PresentationState` (§15.4): the render packet, events, and `AUDIO_WORKING`.
- **The M0 projections** (`HUD`, `CHARACTER`, `INVENTORY`, `ENTITY_PANEL`, `HOVER`, `STATS`, `DEBUG`) and M0's queries, within the §15.5 limits.
- `simabi` and `genabi`, completed through the generated export macros, with `schema::ABI_VERSION` 1.
- The panic hook.
- `simtool replay` and `simtool bench`.

**Exit:**
- The golden packets and projections pass.
- The M0 benchmarks meet their thresholds (§10.6).
- `npm run ci` is green.

**Stop, report, reply.**

## Quality bar (all phases)

- **Correct first, fast second.** Keep A1's measured patterns: allocation-free ticks, plain SoA loops.
- **Determinism rules are law:** no `HashMap` iteration, no NaN in state, `libm` only, `wrapping_*`, comparisons instead of `min`/`max`. Clippy enforces most of these, and review enforces the rest.
- **Test-first** wherever the spec gives a rule. Cite spec sections in comments, as `// §5.1`.
- Keep the crate graph and `#![forbid(unsafe_code)]` as §2.2 says.
- Pin CPU-heavy jobs (cargo builds, benches) with `taskset -c 0-15`, and report build times.

## Notes added by the manager after the gate
- **The golden set** is at version 5. Its README lists 44+ decided rules; Factorio 2.0.77's behaviour was verified in-game for the M0 rules.
- **Query cost model:** open. The golden traces pin `sim_query_step` at both 0 units and all units (rule 44), so cost queries however you like between those (C1c open issue 7).
- **Spilling cancelled-craft refunds** onto the ground is M1, not M0 (C1c open issue 5).
- **Golden-set changes** follow `pm/DECISIONS-IMPL.md` decision 14. Never edit golden values yourself; propose them in your report.

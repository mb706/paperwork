# B1: Architecture v2 (fold A1 and A2 into the engine spec, and fix the M0 contracts)

**Owner:** one Opus agent.
- **Writes to:** `design/spec/10-architecture.md`; a new `design/spec/11-multiplayer.md`; `design/spec/README.md` (the file map and reading order only); the "Engine plan" lines of `CLAUDE.md`; `pm/reports/B1.md`.
- **Must not touch:** `design/spec/data/**`, the other chapters, or §9 of 10 (assets and audio, which WP B2 owns). You may add a stub heading for B2's new loading and streaming section.

## Why

M0 coding starts from this document, so it must be correct, consistent and concrete. Two studies changed the engine plan:
- **A1** (`pm/reports/A1.md`, with codex's second opinion `pm/reviews/A1-r1.md`): **the simulation moves to Rust→WASM as a clean split**. This is binding: see `pm/DECISIONS-IMPL.md` 1–3, including the five boundary rules.
- **A2** (`design/multiplayer/DESIGN.md`, its codex review `pm/reviews/A2-r1.md` and the agent's review response in `pm/reports/A2.md`): **relay-sequenced deterministic lockstep**. Its engine seams S1–S14 and determinism rules D1–D20 are binding for M0 (`pm/DECISIONS-IMPL.md` 4).

## Read

- `CLAUDE.md`, `pm/README.md`, `pm/DECISIONS-IMPL.md`, `pm/reports/A1.md`, `pm/reviews/A1-r1.md`, `pm/reports/A2.md`.
- `design/multiplayer/DESIGN.md`: all of it.
- `design/spec/10-architecture.md`: all of it, in parts.
- `design/spec/README.md`.
- Skim `design/engine-study/` (the Rust kernel, the clippy bans, the build script, the worker harness), so the revised spec reuses what has already been proven to work on this host.

## Do

1. **Revise `10-architecture.md` for Rust/WASM throughout.**
   - §0 decision table; §1; §2 (versions and pins, including `rust-toolchain.toml` and binaryen; the repository layout with the crate or crates; commands; the Vite and cargo integration; CI); §2.5 code rules for both languages.
   - §3: threads, the protocol, pacing, the view model.
   - §4 and §4.5–§4.7: storage generated from one schema, bitset active sets and the A1 wake rules, the measured cost model.
   - §5: language-specific notes only. Add the belt findings: downstream-first line order, and mixed dead-end lanes jam.
   - §8: a save container generated from the schema, the closure log as the replay format, checkpoints that carry digest lineage.
   - §10: native goldens, browser and cross-engine hash checks (Chrome and Firefox are both available here), NO_SLEEP equivalence, the replay and join equivalence tests from DESIGN.
   - §11: the host factor, the benchmark method.
   - §12: M0 revised for Rust, with a realistic size, and a new **MP milestone** for multiplayer, scheduled near the end per the user (after M4, before M6 polish).
   - §13 risks; Appendix A, with the A1 measurements.

   Keep everything that is language-neutral. Do not rewrite for its own sake: it was carefully designed.
2. **Move the multiplayer design into the spec** as `11-multiplayer.md`. Edit DESIGN.md into chapter form, keeping its substance, measurements and sources, and cut the PoC narrative to what a reader of the spec needs.
   - Fold S1–S14 and D1–D20 into 10 where they belong: §3, §4.1, §4.3, §5.1, §8 and §10.
   - 11 keeps the network protocol, the relay, join, desync repair and the UI flows.
   - Mark clearly which parts are M0-mandatory.
3. **Specify the M0 contracts concretely**, in 10 or in an appendix of it. M0's parallel work packages (the sim crate, renderer, UI, asset pipeline) will be built against these without talking to each other:
   - **The schema and codegen.** The descriptor format and what it generates: Rust SoA pools, TypeScript read-only views, save sections, action codecs, projection records. Say where generated files live and how drift is caught.
   - **The prototype data path.** Data stage (TypeScript or Python) → the format Rust loads. Decide the expression strategy: compile `count_formula` and the other formulas to Rust code at build time, or to a small bytecode Rust interprets, and give the reason. Also prototype ids and the `prototypes.hash` handshake.
   - **The action and closure binary formats**, with A2-r1's fixes: nondecreasing ticks per player, action ids, length limits.
   - **The render packet format**: sprites, belt items (consider A1's per-line gap arrays expanded on the main thread), overlays, lights. Pooling and transfer.
   - **The projection and subscription protocol** for UI screens: an entity panel, inventories, the crafting queue, research, statistics. Include the state generation and invalidation rules from A2-r1 finding 13.
   - **Sim → audio and feedback events**: positional machine sounds, one-shot events, suppression during catch-up and replay.
   - **The world-to-screen projection and the sprite manifest's shape**, as far as the renderer needs them. The art direction (WP A3, in progress) fills in style, not format; leave its parameters as named constants.
4. **Update `design/spec/README.md`** (the file map, the M0 reading order) and the "Engine plan" bullets in `CLAUDE.md`.
5. **Record every change of decision** in a "Changes in v2" list at the top of 10, each with its reason and source: A1, A2, A2-r1 or A1-r1.

## Quality bar

- Implementable without guessing. Every format has field widths and endianness, and every rule has an owner and a test.
- Consistent: no section may still assume TypeScript for the sim.
- Codex will review this next, adversarially, for gaps and contradictions.

Run the spec checks listed in `CLAUDE.md` if your edits touch anything they read; they read the data, so normally they do not.

## Report

`pm/reports/B1.md`. The final message is at most 200 words.

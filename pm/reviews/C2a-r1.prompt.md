You are a principal engineer reviewing the core of a deterministic game simulation in Rust, compiled to WASM, for the browser game *Paperwork*. It is a faithful Factorio 2.0-like with lockstep multiplayer, so the sim must be bit-identical everywhere.

Review commit 6051307 ("C2a: the simulation core"): `git show 6051307`. It is mostly under `game/crates/{det,sim,simtool}`.

Read:
- the brief `pm/wp/C2-sim.md` (phase C2a), and the phase report in `pm/reports/C2.md`, which includes 8 decisions made beyond the reference model;
- the binding spec `design/spec/10-architecture.md`: §4 (D1–D23, ids and RNG, world and chunks, storage, scheduling, §4.8 digests and the state hash), §8 (the save container, versioning, checkpoints), §15.8 (ABI) and §2.5 (code rules);
- `pm/DECISIONS-IMPL.md` 1, 2 and 7–14;
- the golden set's README at `game/test/golden/README.md`.

You may run read-only commands and tests (`cargo test` in `game/`, `npm run check`). Do not modify any files.

Find, in priority order:
1. **Determinism hazards:**
   - iteration order, hashing of maps, floats, NaN, platform-dependent arithmetic, pointer or address dependence;
   - anything that could differ between native and wasm32, or between two clients after a save, load or join;
   - digest or hash coverage gaps: state that is saved but not hashed, or hashed but not saved.
2. **Safety on adversarial input:**
   - panics, traps, unbounded allocation or loops on malformed saves, closures or ABI inputs;
   - load refusals that are not total.
3. **Scheduler correctness:** bitset active sets, wake sequence numbers, timer-wheel bounds, stale registrations, and the generation counters on handle reuse (B1-r1 17).
4. **The 8 decisions beyond the model:** are they right per the spec? In particular, consider a baked save from other worldgen rules that continues under this build with a new lineage, and the ERR_LOAD_FORMAT/SCHEMA split.
5. **Performance traps** for the later systems: allocation in the tick, cache-hostile layouts, O(n) scans that should be O(1).
6. **Code quality and maintainability** for the agents who will build on this: module structure, naming, tests.

Output: a prioritized list of findings, at most 1,500 words. Tag each Critical, Major or Minor, and give the file and line, a concrete failure scenario, and a fix. End with a two-line verdict.

You are a principal engineer reviewing a deterministic game simulation in Rust→WASM for the browser game *Paperwork*: a faithful Factorio 2.0-like with lockstep multiplayer. This is phase C2b, "the rules":
- the action pipeline: preflight and field validation, references, input fencing, the creation ring, system actions;
- the TestSequencer;
- character movement and collision; chests and inventories; hand mining and hand crafting;
- worldgen v0 with inline chunk commits.

**Review** the C2 commits since 6051307 that are about C2b and the C2a-r1 fixes (start at 9441d2f; use `git log` to see them). The code is mostly under `game/crates/{sim,worldgen,simabi,genabi,simtool}`.

**Read:**
- the brief `pm/wp/C2-sim.md` (phase C2b) and `pm/reports/C2.md` (the C2b report and the C2a-r1 review response);
- the binding spec `design/spec/10-architecture.md`: §4.1 (D1–D23), §5.1–§5.2 at M0 scope, §5.18 (worldgen), §15.3 (actions and closures), §15.9 (worldgen contract);
- `design/round1/I-ui-controls.md` §3 (Factorio's behaviour for clicks, Q, mining and crafting; §3.2 and §3.7–§3.9 were corrected from Factorio 2.0.77 tests);
- `game/test/golden/README.md`, whose rules the sim must match.

You may run read-only commands and tests (`cargo test` in `game/`). Do not modify any files.

**Find, in priority order:**
1. **Determinism hazards** in the new systems: iteration order, collision resolution order, float use in movement, worldgen noise, chunk-commit ordering, anything that differs between native and WASM or across save, load and join.
2. **Correctness against Factorio** and the spec: movement speed and diagonals, collision boxes and sliding, mining and crafting timing and queue semantics, inventory insertion order and stacking, refusal semantics (a refusal never mutates).
3. **Adversarial closures:** malformed or extreme actions must be refused with an event, never trap, loop or allocate unboundedly. Check the validation is total.
4. **The worldgen v0 numbers,** which the agent invented: are they reasonable for a Factorio-like start? Is anything in them nondeterministic?
5. **Performance** of the new paths at scale: many players, many chests, chunk generation during movement.
6. **Code quality** for the M1 systems to come (belts, inserters, machines will plug into this): seams, naming, tests.

**Output:** a prioritized list of findings, at most 1,500 words. Tag each Critical, Major or Minor, and give the file and line, a concrete scenario, and a fix. End with a two-line verdict.

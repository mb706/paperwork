You are the independent gatekeeper for the M0 "contract gate" of the browser game *Paperwork*, a faithful Factorio-like. Its simulation is in Rust→WASM; its UI, renderer, audio and worker shell are in TypeScript.

After this gate, four agents build in parallel, without talking to each other:
- the Rust sim (C2);
- the TypeScript worker shell (C3);
- the WebGL renderer (C4);
- the SolidJS UI (C5).

Each uses only the schema, the generated code, the fake sim and the **frozen M0 golden integration set**. The golden set is their referee.

The gate's six items (10 §12, "The contract gate") were delivered by C1a (`pm/reports/C1a.md`), C1b (`pm/reports/C1b.md`) and C1c (`pm/reports/C1c.md`), with earlier codex reviews in `pm/reviews/C1a-r1.md` and `C1b-r1.md` and their responses in the reports.

Review C1c's work (commits d4bd2b0..cbfb0d6), and the gate as a whole:
- `game/src/simworker/fake/`, the reference model, and `game/test/golden/` with its README, which lists 36 rules it decided where the spec was silent;
- against `design/spec/10-architecture.md` §15 (contracts), §15.10 (fixtures, fake, golden set), §4 (rules, digests), §5.1–§5.2 (M0's systems) and §12 (M0 scope, the gate, exit);
- `game/data/engine/capabilities.yaml`.

You may run read-only commands and tests (`npm run ci` in `game/`). Do not modify any files.

Find, in priority order:
1. **Golden values that are wrong against the spec:** the reference model's rules, digests, refusals, input fencing, mining and crafting timing, inventory behaviour. A wrong golden value will force a correct sim to be wrong.
2. **The 36 decided rules:** any that contradict the spec, Factorio's behaviour (the spec is Factorio-faithful), or each other.
3. **Coverage gaps:** M0 actions, refusals, projections, packet sections or ABI paths that no golden case exercises; and negative cases that are missing.
4. **The fake sim:** does it exercise everything the renderer, UI and audio need in M0, with realistic values and rates? Where could a package built against it break on the real sim?
5. **The freeze mechanism and the bump workflow:** can goldens drift silently, or can they be bumped carelessly?
6. **Remaining gate blockers from the earlier items 1–3,** if any are still open.

Output: a prioritized list of findings, at most 1,500 words. Tag each Critical, Major or Minor, and give the file and line, the problem, and a fix. End with a verdict line: "GATE: PASS", "GATE: PASS WITH FIXES (list)" or "GATE: FAIL".

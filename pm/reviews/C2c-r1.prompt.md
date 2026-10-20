You are a principal engineer reviewing the boundary layer of a deterministic Rust→WASM game simulation for the browser game *Paperwork*, a faithful Factorio 2.0-like with lockstep multiplayer. Phase C2c covers:
- extraction with `PresentationState` (the render packet, events, `AUDIO_WORKING`);
- the M0 projections (HUD, CHARACTER, INVENTORY, ENTITY_PANEL, HOVER, STATS, DEBUG) and queries;
- `simabi` and `genabi` completed through the generated export macros;
- the panic hook;
- `simtool replay` and `bench`.

Review the C2c commits on `dev` (11b99ec to a6bbd2b, plus the C2b-r1 fixes just before them; see `git log`). The code is mostly under `game/crates/{sim,simabi,genabi,simtool}`.

Read:
- the brief `pm/wp/C2-sim.md` (phase C2c) and `pm/reports/C2.md` (the C2c report and the C2b-r1 review response);
- the binding spec `design/spec/10-architecture.md`: §3.6 (the language boundary), §4.8, §15.4 (render packet), §15.5 (projections, subscriptions, queries: limits, generations, invalidation), §15.6 (events and audio, the historical flag) and §15.8 (ABI);
- `pm/DECISIONS-IMPL.md` 1 (the five boundary rules);
- `game/test/golden/README.md`.

You may run read-only commands and tests (`cargo test`, `npm run check`). Do not modify any files.

Find, in priority order:
1. **Boundary-rule violations:** extraction or queries that mutate authoritative state or influence future ticks; anything that makes the digest depend on what was viewed or subscribed (D9); `PresentationState` leaking into saves or hashes.
2. **ABI safety:** pointer and length handling, memory growth invalidating views, re-entrancy, the panic hook and trap behaviour, and bounded outputs on adversarial requests (subscription floods, huge queries).
3. **Packet and projection correctness:** delta versus snapshot sections, retirement of geometry, stale generations, and the §15.5 limits enforced.
4. **Performance:** extraction cost at the M0 benchmark scale and its scaling to M1's numbers, plus per-packet allocations.
5. **The benchmarks:** do they measure what §10.6 says, and are the thresholds the right ones?
6. **Code quality** for M1, where many systems will add packet sections and projections.

Output: a prioritized list of findings, at most 1,500 words. Tag each Critical, Major or Minor, and give the file and line, a concrete scenario, and a fix. End with a two-line verdict.

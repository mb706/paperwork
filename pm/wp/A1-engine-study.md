# A1: Engine study (simulation language, runtime boundary, scale)

**Owner:** one Opus agent. **Writes only to:** `design/engine-study/**`, `pm/reports/A1.md`, plus toolchain installs and their notes in `CLAUDE.md` and `tools/check-toolchain.sh`.

## Why

Spec 10 §0 decision 1 picked TypeScript for the simulation and left a Rust/WASM port open "if benchmarks ever demand it". Before any code is written, the user explicitly wants us to consider and benchmark alternatives such as Rust compiled to WASM:
- The game must keep a high tick rate in a late-game factory with many entities, in a browser.
- The game will get **lockstep multiplayer** (WP A2 is designing it in parallel). That requires bit-identical simulation across browsers and machines, so ask how each option guarantees determinism and how hard it is to keep it.

The answer decides the architecture of everything that follows. Measure, do not guess.

## Read

- `CLAUDE.md` and `pm/README.md`.
- `design/spec/10-architecture.md`:
  - §0–§1, §3 (threads, protocol, view model) and §4 (the sim core: determinism contract, units, storage, scheduling, cost model);
  - §5.3 belts, §5.4 inserters, §5.5 crafting, §5.7 energy;
  - §6.2–§6.6 (frame structure and batcher, for the render boundary), §11 (performance targets: Mid, Late and Megabase scales), and Appendix A (measurements on this host).
- Skim `design/round2/A-stack-test/` (the earlier stack test).

## Questions to answer with measurements on this host

1. **Hot-loop cost.** Implement the same algorithms in:
   - (a) **TypeScript**: struct-of-arrays typed arrays, allocation-free ticks, monomorphic code, written the way §2.5 and §4 prescribe;
   - (b) **Rust → wasm32-unknown-unknown**: release, LTO, opt-level 3, run through wasm-opt, measured both with and without `simd128`.

   Give both the same optimization effort; the comparison must be fair. The systems, faithful enough to be representative:
   - transport lines per §5.3: gap-encoded lanes, handoff to the next line, compression, an item-count mix;
   - inserters per §5.4: a state machine with swing timing, taking from belts and chests and dropping into machines, with sleep/wake;
   - crafting machines per §5.5: progress under energy satisfaction, ingredient and output checks, sleep/wake;
   - electric-network satisfaction per §5.7;
   - the active lists and timer wheel of §4.6.

   Build a seeded synthetic factory generator: repeated production cells (drills → belts → furnaces → inserters → assemblers → belts → labs) that can be scaled to §11's **Mid** (≈40k entities) and **Late** (≈150k entities, 60k belt tiles, 250k belt items, 25k inserters, 6k machines) rows. Give it a realistic share of sleeping, output-blocked and input-starved entities, and sweep that share.
2. **Where to measure.**
   - Chrome for Testing 156, **inside a dedicated Worker** as the game will run, driven by Playwright. Report ms/tick mean and p99 over at least 3,000 ticks after warm-up.
   - Node 24 for reference.
   - **Firefox if at all feasible.** Playwright's Firefox may need a newer glibc; try it under `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE`, then in a rootless podman `ubuntu:24.04` container. Players will mix browsers, so cross-engine numbers and determinism matter.
3. **The boundary.**
   - **(i) Render extraction:** build the visible-sprite buffer for a 1920×1080 viewport at zoom 1× and 0.3× (thousands to tens of thousands of sprites) in the worker and transfer it to the main thread as a transferable ArrayBuffer. Do this in both designs; with WASM, extraction reads linear memory. Give per-frame costs.
   - **(ii) UI queries** (one entity's inventory, the tech state): describe the mechanism and its cost.
   - **(iii) Input actions in:** tick-stamped, serialized. Describe a sound format.
4. **Determinism.**
   - Show the same state hash after N ticks across Node, Chrome and Firefox (if available), for both implementations.
   - List what each language must do to guarantee it:
     - JS: banned `Math.*` transcendentals; integer arithmetic; iteration order; any engine differences you know of.
     - Rust/WASM: in-module libm; NaN canonicalisation; no `HashMap` with random state; and so on.
   - Judge which option makes multiplayer desyncs *structurally* less likely, not just which one can be made deterministic with discipline.
5. **Practicalities.**
   - WASM size after wasm-opt, gzip and brotli, versus the comparable JS bundle; instantiate and startup time.
   - Rust build times on this old host: clean and incremental, at a realistic 30–60k-line crate size (estimate).
   - The test and debug story: `cargo test` natively, the WASM side, source maps, panics.
   - Vite integration.
   - How a two-language project affects agent productivity and code review.
   - GC pauses and JIT deoptimizations in the TS build (p99 and worst tick).
6. **Threads.** Is a parallel simulation worth planning for? Consider wasm threads plus `SharedArrayBuffer`, which needs COOP/COEP headers and therefore constrains hosting, and the determinism constraints that come with it. Back the conclusion with numbers. The default expectation is one sim thread with good algorithms; tell us if that is wrong.
7. **Hybrids.** Consider designs where all sim state lives in WASM linear memory, with hot systems in Rust and cold logic in TS reading the same memory. Also consider TS first with a later per-system port, which is what the spec assumes. Say whether any hybrid is better than a clean split, where the sim is entirely in Rust and TS handles the UI, renderer and network across a narrow API.

## Deliverables

- `design/engine-study/`: both implementations, the generator, the harness, and a README explaining how to rerun everything with one command per platform.
- `design/engine-study/REPORT.md`, containing:
  - the results tables (ms/tick per system and per scale, mean and p99; render extraction; sizes; build times);
  - a **recommendation** (TS, Rust/WASM, or a hybrid) and its main reasons, plus the risks of the recommendation;
  - the concrete list of changes to `design/spec/10-architecture.md` that follow. Do not edit the spec yourself; the manager will commission that.
- **Translate the measurements into player-facing terms:** for example, "Late scale costs X ms/tick on this host, which is about Y on the §11 reference machine and Z on the target machine". This host runs at about 0.55× the reference machine's single-thread speed (§11).

## Toolchain

Install Rust in user space:
- `rustup` with the minimal profile and the `wasm32-unknown-unknown` target;
- for example `RUSTUP_HOME=~/.local/opt/rustup` and `CARGO_HOME=~/.local/opt/cargo`, with the variables set where non-interactive shells see them (check how zsh is initialised here, e.g. `~/.zshenv`), and the binaries on `PATH`;
- `wasm-bindgen-cli`, if you use bindgen, pinned to the crate version;
- `wasm-opt` from binaryen (the npm `binaryen` package or conda-forge).

Then add a Rust section to `CLAUDE.md`'s toolchain list and checks to `tools/check-toolchain.sh`.

The pinned npm stack is in `design/round2/A-stack-test/package.json` and its lockfile; reuse it for the TS side.

## Budget

This is a substantial study: several hours of careful work is expected and fine. Fairness and correctness of the comparison matter more than breadth. If something is infeasible on this host, such as Firefox, say so and say what it means. Do not silently drop it.

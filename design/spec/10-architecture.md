# 10 — Engine architecture and implementation plan

*Round 2, agent R2-A; revised in round 4 by R4-arch; **version 2** by WP B1 (2026-10-20). Version 2 folds in WP A1 (the engine study: the simulation moves to Rust compiled to WebAssembly) and WP A2 (multiplayer, now chapter 11), and fixes the M0 contracts (§15). Binding inputs: `design/DECISIONS.md` (round 4: §21–§38), `pm/DECISIONS-IMPL.md` 1–6, round-1 docs B (laws), D (economy), E (tech tree), F (pressure, Variant A), G (endgame), I (UI and controls), plus A (mods), C (spacetime) and H (tone) where they touch the engine. Companion specs: 00–09, 11 and `spec/data/*.yaml`. The round-4 worklist was `design/round3/R3-implementability.md` (B1–B4, L1–L6, J1–J24, U1–U64, P1–P31 and its §9 architecture gaps), `R3-balance.md`, `R3-fun.md`, `R3-coherence-tone.md` and `R3-accuracy.md`. Version 2's inputs: `pm/reports/A1.md` with codex's review `pm/reviews/A1-r1.md`, and `design/multiplayer/DESIGN.md` with codex's review `pm/reviews/A2-r1.md` and the response in `pm/reports/A2.md`.*

**Scope.** This document decides **how** the game is built. The other specs decide **what** it contains. Where a number belongs to the design (a recipe, a T\*, the formula for T(W)), this document names the engine module that consumes it and leaves the value to the spec that owns it (Appendix B). Chapter 11 owns the multiplayer protocol, the relay and the multiplayer UI; the engine seams that multiplayer needs are specified here, because M0 builds them.

**Engine rules.** Where the design leaves an engine-relevant case open (an edge, a tie, an order, a state), this document states the exact rule, and the owning chapter is asked to carry the same sentence. The rules added in round 4 are tagged with the critique's number (e.g. *L3*, *U16*) so that they can be traced; most have a rule scenario in §10.8, and the rest are covered by the tests of the module that implements them (the doubling-time readout U24 by UI-G8, the run report's measurements by its golden accumulators, M4). Round 5's (R5-apply, DECISIONS §40) are tagged with R5-gate's decision number (*D9*, *D12f*), with scenarios R18–R20. Version 2's determinism rules keep chapter 11's numbers **D1–D23** (§4.1) and its engine seams **S1–S15** (11 §7); in §4.1 and §10, "D9" means determinism rule 9, and R5-gate's decisions are always written "R5-gate D9".

**Evidence.** Measured on this host on 2026-10-19 and 2026-10-20:
- The toolchain in §2.1 installs and runs here (glibc 2.31, no AVX2).
- WebGL2 benchmarks in headless Chrome 156 on SwiftShader.
- Simulation-loop microbenchmarks in Node 24 (round 4).
- WP A1's engine study: equivalent TypeScript and Rust kernels with bit-identical state hashes, timed in Node 24, Chrome 156, Firefox 157 and natively, with render extraction, UI queries, threads, start-up, sizes and build times (`design/engine-study/`).
- WP A2's multiplayer proof of concept: relay, lockstep clients, an impairment proxy and 12 scenarios (`design/multiplayer/poc/`, 11 §12).
- B1's probe of the `libm` crate: ten transcendental functions at 10⁶ arguments each give bit-identical results natively and in WebAssembly under Node, Chrome 156 and Firefox 157, before and after binaryen's optimiser.

The numbers are in Appendix A. They drive the language decision (§0 #1), expanded-quad sprite batching (§6.3), on-demand rendering in tests (§10.5) and the host-to-laptop calibration factor (§11).

## Changes in v2

Every change of decision against version 1 (round 5), with its reason and source. Sources: **A1** (`pm/reports/A1.md`), **A1-r1** (`pm/reviews/A1-r1.md`), **A2** (`design/multiplayer/DESIGN.md`, now chapter 11), **A2-r1** (`pm/reviews/A2-r1.md`, numbered findings), **IMPL-n** (`pm/DECISIONS-IMPL.md` item n), **B1-r1** (`pm/reviews/B1-r1.md`, codex's review of this revision, numbered findings), **B2** (`pm/reports/B2.md`: §9 and §15.7, assets, audio, loading and streaming), and **B1** for calls made in this revision, each with its reason. Rows 28–48 answer B1-r1; rows 49–54 record B2's decisions.

| # | Where | Change | Reason | Source |
|---|---|---|---|---|
| 1 | §0 #1, §1, §2, §3.1, §4.5 | The simulation is **Rust 1.99.1 compiled to wasm32-unknown-unknown** (was TypeScript), as a clean split: one Cargo workspace owns all authoritative state and rules and runs in the sim worker on one thread. TypeScript keeps the worker shell, the data stage, UI, renderer, audio, network and tools | 1.35–1.75× faster per tick in Chrome, Firefox and Node; 2–4× faster first ticks after a load; no JIT stalls (TypeScript showed an 18–22 ms Firefox stall and a V8 deoptimisation storm); the same binary on every peer; typed handles, exhaustive enums and checked indexing. The coupled hot core (86% of the tick) cannot be ported one system at a time, so "TypeScript now, WebAssembly later" would be a rewrite | A1, A1-r1, IMPL-1 |
| 2 | §3.6, §15.8 | **The five boundary rules** are engine law: Rust owns state and rules; one schema generates every contract; data leaves in bulk projections, never per-entity calls; view lifetimes are explicit; the boundary is testable from M0, trap recovery included | A clean split is only as safe as its boundary | IMPL-1 (A1-r1) |
| 3 | §3.1, §5.18 | **Worldgen moves to Rust too**, as the crate `worldgen`: linked into the sim (the town layer and inline chunk commits) and built as `gen.wasm` for the worldgen pool | Worldgen's output becomes world state, and the sim queries the town layer synchronously; one language and one rule set for everything that decides state | B1, from IMPL-1 ("all authoritative state and rules") |
| 4 | §4.1 | The determinism contract is restated per language. Rust's rule set (D19) replaces the TypeScript bans for the sim, and **D1–D23** join it as a table with owners and tests | A1 §5's Rust rules; A2's checklist, made binding for M0 | A1, A2, A2-r1, IMPL-1, IMPL-4 |
| 5 | §4.1, §5.6, §5.11, §5.12 | `detmath.ts` becomes the crate **`det`**: the `libm` crate 0.2.16 for transcendentals plus a fixed-order integer power | `libm` is compiled into the module, so every engine runs the same instructions; B1 measured it bit-identical in native code, Node, Chrome and Firefox (Appendix A). `std`'s `f64::sin` calls the platform's libm natively, so native tests would disagree with the game | A1, B1 |
| 6 | §4.6 | **Active sets are bitsets** iterated in pool order, not swap-remove lists. A1's wake rules are adopted. Derived pools (lines, segments, networks) are ordered by canonical keys, never by pool index | Swap-remove lists broke the spec's own NO_SLEEP equivalence within 200 ticks once inserters compete. Derived pools are rebuilt on load with different indices, so an order by index would break join equivalence | A1 findings 1–2, IMPL-2; B1 (derived pools) |
| 7 | §5.3 | **Transport lines update downstream first**, by a canonical rank that survives load; a dead-end lane carrying two item types jams (ISO) | Otherwise compressed flow opens gaps at line boundaries. A1's kernel got the order from its generator's indexing; a game built in any order needs an explicit rule | A1 findings 3–4, IMPL-2; B1 (the rank) |
| 8 | §2.4, §4.5, §15.1 | **One schema generates the contracts**: Rust SoA pools, TypeScript read views, save sections, action codecs, events, projection records, packet records and prototype tables. Every field declares saved or derived, order and canonical order | Two languages must never drift; the line that adds state is the cheapest place to prevent D3 and D8 bugs | A1 change 7, IMPL-1 rule 2, A2 D20 |
| 9 | §2.4, §15.2 | The data stage (TypeScript, unchanged) emits **`prototypes.bin`** for the sim and `prototypes.json` for UI and renderer. **Expressions compile to bytecode** that the sim interprets | Data edits must not need a Rust rebuild (the release build takes about 67 s), the binary file is self-contained and covered by `prototypes.hash`, and the expressions run a few times per minute, so interpretation costs nothing | B1 |
| 10 | §4.4, §4.5, §5.1 | `World.player` becomes **`World.players[]`**, with input generations, creation rings and `lastSeq`; `builtBy` gains player indices; offline characters get rules | Every action carries its player; multiplayer must not need a retrofit | A2 S1, A2-r1 3 and 12 |
| 11 | §3.2, §3.3, §15.3 | **Closures are the only input.** Actions go to a sequencer (a `LocalSequencer` in single player). Actions have identity `(player, seq)`, per-player nondecreasing ticks, input fencing for held inputs, and targets by serial or creation id, never by position | Single player is multiplayer with a local transport, so the path is exercised by every test | A2 S2, S3, S5, D21–D23; A2-r1 2, 3 and 12 |
| 12 | §3.3 | **Pacing by the closure horizon** with clock generations; pause and speed are sequencer state, never world state; in multiplayer a hidden tab never pauses | The World must not know about time outside ticks | A2 S3, S14; A2-r1 7 |
| 13 | §3.4, §15.5 | **The world-replacement protocol**: a state generation on every packet, response and event; full invalidation and re-subscription on a new generation; every world replacement uses a fresh worker | Loads, joins and re-sync swaps must not mix two worlds' data; a fresh WebAssembly instance also returns the old world's memory, which linear memory cannot | A2 S11, S15; A2-r1 13; B1 (fresh worker) |
| 14 | §3.2, §6.8, §15.4 | **The render packet** is one binary buffer per frame with a section table. Belt items travel as per-line gap arrays, expanded on the main thread. Positions are fixed point | A1 measured 85k sprites at about 0.75 ms of worker time on the reference machine against a 1.0 ms budget; gap arrays are 4 bytes per item against 16, and almost free to extract | A1 §4 and change 11; B1 (format) |
| 15 | §3.2, §7.3, §15.5 | **UI data comes from projections** computed in Rust and decoded by generated TypeScript, through subscriptions; this replaces structured-clone `ui` deltas | No gameplay arithmetic may be duplicated in TypeScript | IMPL-1 rule 3, A1-r1; B1 (format) |
| 16 | §3.2, §15.6 | **Events** carry `(player, seq)` and a historical flag; sounds, flying text and toasts are suppressed for historical events. Positional working sounds come as per-type aggregates | Catch-up, replays and joins must not replay hours of sound; a latency state must know which prediction failed | A2 S10, D15; A2-r1 13; A4 (audio feed) |
| 17 | §4.8 (new) | **Digests**: a per-tick digest, a key-chosen slice hash and a rolling digest; checkpoints carry the digest lineage. The full state hash becomes XXH64 over canonical section bytes (was xxHash32 over pools and JSON) | Desync detection within a second for most divergence and within a minute for any; 64 bits because full-state equality is now compared at scale | A2 S7, A2-r1 5; B1 (hash width) |
| 18 | §8.1 | **The save container is generated from the schema.** Cold data and globals become binary records (were canonical JSON). New sections: `PLAYERS` (was `PLAYER`), `WORLDGEN_PENDING`, and the roster and digest lineage in the header, outside the hash | Rust writes sections without a JSON library; a checkpoint must be complete (D8) | A1 change 7, A2 S9, A2-r1 11; B1 (binary records) |
| 19 | §8.5 | **The input log becomes the closure log**, with its blobs and an optional digest ring | Replays, bug bundles and multiplayer share one format | A2 S8 |
| 20 | §10 | **Tests**: scenario and golden tests are native Rust (`cargo test`); cross-engine digest traces compare native, Node, Chrome and Firefox; D18 (a)–(g) with full canonical state, not only digests | Native equals the browser bit for bit, so native tests are the fast loop; sampled digests cannot catch every transient divergence | A1, A2 D18, A2-r1 5 and 15 |
| 21 | §10.6, §11 | The host runs at about **0.42× the reference** at its base clock (was 0.55×). A/B comparisons run interleaved in one session with the clock logged; the 10% gate against history is dropped | Turbo windows make single runs differ by about 25% | A1, A1-r1, IMPL-3 |
| 22 | §4.7 | The per-tick cost model uses A1's **measured** per-entity costs | Measured beats projected | A1 §2 |
| 23 | §11 | Budgets gain a **catch-up** row and the host factor 2.4; the audio-thread budget is left to §9.4 (WP B2) | Joins and re-syncs need catch-up headroom (11 §4.4) | A2 §4.4, A1, IMPL-6 |
| 24 | §12 | **M0 is resized** for Rust, the schema and the multiplayer seams; M1–M4 gain 10% for the boundary; a new **MP milestone** comes after M4; M1c's music is the generative engine's two rule sets instead of 2–3 tracks | M0 v1 was about a third of its real size; Rust code is about 1.2× the TypeScript lines and features cross the boundary; multiplayer comes late, but its seams come first | A1 (M0 +20–30%), A1-r1, A2 §7; the user (multiplayer late); A4, IMPL-6 (music) |
| 25 | §13 | Risks: "JS performance" goes; the boundary, WebAssembly debugging and traps, two toolchains and release build time come in | The risk moved | A1, A1-r1 |
| 26 | §6.2, §6.7, §7.4, §15.7 | Style parameters (shadow and light composites, the night grade, the UI palette) become **named constants**, with A3's *Survey* values as their first setting | The art direction fills in style, not format | A3, IMPL-5 |
| 27 | §15 (new) | **The M0 contracts**: schema and codegen, the prototype data path, action and closure formats, the render packet, projections and subscriptions, events and audio, projection and the sprite manifest, the WebAssembly ABI, the worldgen contract, fixtures, ownership and tests (the worker messages are §3.2) | M0's work packages build against them in parallel without talking to each other | The brief of WP B1 |
| 28 | §12, §15.11 | **The schema work package is the executable contract.** Its acceptance gate: complete machine-readable layouts for every M0 record, generated code in both languages, reviewed codec fixtures, the fake sim (with `STATS`), and a frozen **M0 golden integration set** (prototypes, a start save, a closure log, expected states and digests, every M0 projection, a tiny atlas, negative cases), whose expected results come from a small TypeScript reference model of M0's rules; hand-written codec fixtures catch mistakes both generated sides share, and `prototypes.json` gets a schema. Parallel M0 packages start only after it passes | Prose cannot be byte-complete for everything; an executable contract can, and every package then tests against the same fixtures | B1-r1 1, 21; the coordinator |
| 29 | §2.4, §12 | **An M0 capability manifest** says what M0 supports; anything else fails with an explicit `unsupported` error, and later milestones' formulas, effects, scenarios and benchmarks are outside M0's checks | "CI green" must have a definite meaning in M0 | B1-r1 19 |
| 30 | §2.5, §12 | **M0 is trimmed** to closures, chests, projections, deterministic saves and worker replacement: no general migration framework, M0-sized registries and codecs, `simtool` limited to replay, hash, trace and bench (diff and bisect come in M1), allocation gates only on measured steady-state paths | A short serial critical path; every binding seam stays (IMPL-4, 11 §7) | B1-r1 22 |
| 31 | §3.6, §15.8 | **`SimContext { world, pres }`**: extraction, subscriptions, the event queue, the held set and what has been sent live in a `PresentationState` that the module owns; extraction borrows the World immutably and the presentation state mutably | One owner per mutable field; the shell keeps no competing state | B1-r1 4 |
| 32 | §15.8, §15.9 | **One normative ABI table**, generated from `schema/abi.yaml`: every pointer-returning export returns a `{u32 len, bytes}` envelope, or 0 on failure with the error from `sim_last_error`; the exceptions are declared; the exported memory is `memory`; lifetimes are stated; `sim_extract` returns the complete packet; queries are stepped and cancellable; `sim_save` can bake | The old text mixed raw pointers and envelopes | B1-r1 5 |
| 33 | §8.5 | **Closure logs are counted and length-delimited**: a fixed header holds the record, digest and blob counts and byte lengths; trailing or missing bytes are errors | The old format could not be parsed unambiguously | B1-r1 2 |
| 34 | §15.1 | **The schema hash covers resolved layouts**, and ordered fields are YAML lists | Reordering fields changed bytes without changing a key-sorted hash | B1-r1 3 |
| 35 | §4.5, §8.1, §15.1 | **Saves store serials, not handles** (two-pass loading); unordered saved collections serialize sorted (`order: set`); padding is measured from the file start | Canonical bytes must have one interpretation | B1-r1 6 |
| 36 | §4.4, §8.3 | **Worldgen is versioned in saves**: a save made under other generation rules is refused with an explicit error (`ERR_WORLDGEN`) unless its own build baked its pristine chunks first; a load that remaps or migrates, and a baked save, start a new digest lineage | Lazy regeneration must regenerate the same land | B1-r1 7 |
| 37 | §4.8 | **Digest coverage is exhaustive and exact**: a generated map spreads every saved section over the 3,600 slices, and the per-tick record, the closure checksum and r₀ are pinned | No section may escape the slices, and none may cost a big scan once a minute | B1-r1 8 |
| 38 | §15.3 | **Closure validation is a preflight**: every structural check, with temporary watermarks and checked arithmetic, and blob availability run before any watermark or state changes | A malformed later batch must not consume seqs | B1-r1 9 |
| 39 | §15.3; 11 §3.2, §3.4 | **One admission function**, shared by the `LocalSequencer`, the relay and the native `TestSequencer`, bounds each tick's simulation closure and its wire form to 1 MiB, reserves 4 KiB for system actions, and spills deterministically: the first action that does not fit closes the tick to player actions | Limits must survive the conversion between the two formats, and one tick must fit one `TICKS` message | B1-r1 10 |
| 40 | §3.2, §15.3 | **One seq-allocation and input-generation rule**: the main thread allocates seqs from the loaded, accepted and pending watermarks; only `release_inputs` and `player_left` change input generations | Single player and multiplayer resumed differently | B1-r1 11 |
| 41 | §3.3, §3.4, §15.4 | After `bound` the worker sends an unsolicited `FULL` packet, and while no tick runs it extracts on demand after view and subscription changes | A replacement or a paused load could wait forever for its first packet | B1-r1 12 |
| 42 | §15.4, §10.4 | **Every packet section is declared snapshot, event or delta**, with retirement rules (`BELT_RETIRE`, overlay and chart resets); what was sent advances only when a packet is, so skipped extractions lose nothing; a mirror-equivalence test checks it | Caches must not keep obsolete data while the camera stands still | B1-r1 13 |
| 43 | §15.5 | **Budgets for subscriptions and queries**: concurrency and byte limits, identical projections shared, source revisions instead of rebuilding, cooperative queries with cancellation, `STATS` series appended rather than resent | Projections and queries must not starve ticks | B1-r1 15 |
| 44 | §4.4, §5.18, §5.19 | **Worldgen commits are bounded and deduplicated**: at most 8 per tick in a canonical order, later requests get later commit ticks; every generated chunk keeps its κ, θ and sunlight; regeneration is bounded too (8 chunks per tick or per packet), and pristine chunks' chart images come from the worldgen pool (`gen_chart`) | Inline generation and lazy regeneration must not stall catch-up or the first map view after a load | B1-r1 16 |
| 45 | §4.6 | **Wake registrations are bounded and reclaimed; timers name entities by serial**; a timer is due no earlier than the next tick | Handle generations wrap, and stale nodes must not accumulate | B1-r1 17 |
| 46 | §4.3, §15.2 | **RNG algorithms, salts and stream ids are pinned** with golden vectors; formula results have declared ranges with deterministic clamping at the limits, and infinite technologies a data-stage level cap | "Finite at every reachable level" could not be checked | B1-r1 18 |
| 47 | §10 | **Short runs compare canonical state bytes every tick**; a native `TestSequencer` drives scenarios; test commands name the `simcheck` feature; M0's scenarios and benchmarks are listed with thresholds | The verification claims must match the tests | B1-r1 20, 19 |
| 48 | §15.3; 11 §3.3 | **A malformed action is refused, not fatal**: field-level validation (type, length, enums, tags, reserved bytes, UTF-8) runs as the action applies and refuses it with the developer reason `malformed`; only structural errors stop a tick | A buggy or hostile client must not stop a room, and the relay stays game-agnostic | B1-r1 9 |
| 49 | §9.1, §9.5 | **Render only what moves**: each sprite set renders frame 0 in full, one shadow at Normal resolution, and animated layers re-rendered inside their rectangle R. A working set is drawn as frame 0's pieces outside R plus the layer frame, every pixel once. The ink runs on R (and on frame 0's trimmed box) with its fields in canvas coordinates. Every model follows one entity contract (`META`, `build`, `pose`) | 7–13× faster than A3's per-frame rebuild; the pieces reproduce the full frame exactly, where v1's patch-over-base doubled translucent pixels (B2-r1 2) | B2 (A3 §9 reconciled) |
| 50 | §6.4, §6.13, §9.2, §9.5 | **Atlases are KTX2 from M0**: XUBC7 transcoded to BC7 (then ASTC 4×4, BC3, ETC2 RGBA, or uncompressed RGBA8) for colour, light and icons, and ETC1S to BC4 (then EAC R11, or R8) for shadows. Each format is probed with a real upload. Frames sit in 32-px cells with 8-px gutters, so no compression block of any level mixes two cells. A page's Normal level is its level 1, and level 0 (High) streams on demand. WebP only for DOM images. This replaces v1's WebP transport and its KTX2 plan for M3 | Measured on real pages: WebP's chroma subsampling greys small colours and halos small icons; BC7 needs a quarter of RGBA8's GPU memory and bandwidth and transcodes in about WebP's decode time; the fallbacks' quality is measured (B2-r1 5, 10) | B2 |
| 51 | §9.4, §11 | **Audio runs on AudioWorklets** (a voice bank with Int16 samples, an FDN reverb) at 32 kHz, pending the user's A/B. The budget is ≤ 8% of a reference core on average and ≤ 15% in any second, with decoded samples ≤ 96 MB. Era II and the takeoff do not meet it yet, so the synthesised voices and the tape echo move into the bank. A failed worklet or autoplay falls back to reduced audio | A4's native-node engine measured 41–68% of a host core, the shipping graph 13.8–22.4% over whole pieces with SFX (B2-r1 4, 8) | B2 (against A4 §6.2), IMPL-6 |
| 52 | §0 #5, §2.3, §3.1, §3.2, §8.2, §9.7 | **Loading and streaming**: stage budgets on a reference connection, code split per screen, atlas groups by unlocking technology (≤ 3 MB each, a build gate on the byte inventory), priorities, retries and placeholders instead of waits, a new **asset worker** (fetch, transcode, audio decode), content-addressed files, precompressed brotli and gzip, and an **optional** service worker. The main thread compiles each WebAssembly module once per page and posts it to every fresh worker, with an `arrayBuffer` fallback for hosts with the wrong MIME type. Served over HTTPS or localhost | The first frame of a new game in ≤ 5 MB; nothing waits for an asset; the game works on any static host (B2-r1 7, 12) | B2 |
| 53 | §15.7 | **Sprite manifest version 2**; one placement formula in device pixels (dpr included) with fixtures at dpr 1 and 2; an explicit index table for every part of every set over a closed axis vocabulary, drawing programs per kind (inserters with pivots, the character's clips, animated shadows), fixtures and version checks; lookup contracts for every namespace; one position hash for shapes the packet does not carry | Direction values, dpr and namespaces disagreed between the renderer and the assets, and the flattening of axes was left to each package (B1-r1 14; B2-r1 1) | B1-r1 14; B2 |
| 54 | §0 #13, §2.1, §7.4, §9.3 | **The GUI's fonts follow *Survey***: Libre Franklin for printed text and Courier Prime for typed values; Titillium Web only for world labels. All are WOFF2 subsets made by the asset build, so no npm font package | A3 §12's type; seven faces measure 149 kB | A3, B2 |

---

## 0. Decisions at a glance

| # | Area | Decision | Main reason | Rejected |
|---|---|---|---|---|
| 1 | Language | **Rust 1.99.1 → wasm32-unknown-unknown** for the simulation and worldgen: one Cargo workspace, a clean split (§3.6). **TypeScript 7** for the worker shell, the data stage, UI, renderer, audio, network and tools. **Python** only for asset pipelines and the design validator | Measured (A1): 1.35–1.75× faster per tick in every engine, 2–4× faster first ticks after a load, no JIT stalls; one binary on every peer, so determinism holds by construction for the float class; guardrails for agent-written code | A TypeScript simulation (viable, but slower and with JIT tails, A1); a per-system hybrid with two writers to one state; wasm-bindgen (a raw C ABI is enough, A1) |
| 2 | Build | **Vite 8.3.2** (Rolldown) for bundling and the dev server, with a cargo plugin (§2.3). **TypeScript 7.0.2** (native `tsc`) for type-checking only. **cargo** with `rust-toolchain.toml`; **binaryen 133** `wasm-opt -O3` for release WebAssembly | Verified here (A1); incremental Rust builds take 1–3 s | webpack; esbuild alone; wasm-pack |
| 3 | Tests | **`cargo test`** natively for the simulation (unit, scenario, golden and property tests, the last with **proptest 1.11.0**). **Vitest 5.0.3** (with **fast-check 4.10.2**) for TypeScript. **@playwright/test 1.64.1** with Chrome for Testing 156 and Firefox 157 (E2E, screenshots, cross-engine digest traces). A custom benchmark runner | Native code equals WebAssembly in every engine bit for bit (A1; Appendix A), so the fast loop is native and the browsers confirm it | Jest; Cypress; testing only through the browser |
| 4 | Lint and format | **Biome 2.5.15** plus `check-arch` (**oxc-parser 0.153.0**) for TypeScript; **rustfmt** and **clippy** with the determinism bans of `clippy.toml` at `-D warnings` for Rust; a WebAssembly feature gate on the release binary (§2.3) | Each ban verified to fire (A1, B1) | ESLint + Prettier |
| 5 | Threads | The **sim worker** runs a TypeScript shell around one WebAssembly instance at a fixed 60 UPS, driven by closures. The **main thread** handles input, the DOM UI, WebGL2 and audio. A **worldgen pool** (running `gen.wasm`), an **IO worker** (compression, hashing, storage) and an **asset worker** (fetching, texture transcoding, audio decoding; §9.7) complete the set; a **second sim worker** takes every world replacement (§3.1). Multiplayer adds a **net worker** (11 §2.4) | The UI and renderer cannot steal sim time, and vice versa | Sim on the main thread (kept only as a debug mode); WebAssembly threads (A1 §8: one sim thread is right) |
| 6 | Shared memory | **No SharedArrayBuffer and no WebAssembly threads.** Transferable `ArrayBuffer`s between threads; only the sim worker's shell reads linear memory | Works on any static host (dev server, Artifact) without COOP/COEP headers | SAB snapshots |
| 7 | Sim state | **Per-system struct-of-arrays pools** (Rust `Vec` columns generated from the schema), a thin entity table, cold records keyed by serial; derived structures rebuilt in canonical order | Cache-friendly, no per-entity heap objects, saved and hashed as column bytes | A generic ECS library; one heap object per entity |
| 8 | Scheduling | **Factorio-style sleep and wake** with **bitset active sets iterated in pool order** (canonical rank for derived pools), wake sources with sequence numbers, a timer wheel and chunk buckets (heat 1/64, agents 1/20) | An idle factory costs about 0; NO_SLEEP equivalence holds (A1) | Updating everything every tick; swap-remove active lists |
| 9 | Determinism | **Fixed point** where Factorio uses it (belts in 1/256 tile), IEEE doubles elsewhere, transcendentals only through the `libm` crate, counter-based RNG, and rules **D1–D23** with their tests (§4.1) | Saves, replays and multiplayer bit-identical across engines; tests reproducible | Floats with platform `sin`; stateful global RNG |
| 10 | Belts | **Factorio transport lines**: gap-encoded, O(1) per moving line per tick, with the wiki's geometry numbers, updated downstream first | ISO throughput and compression | Per-item movement |
| 11 | Fluids | **Factorio 2.0 fluid segments** (FFF-416, FFF-430). **Connection categories** keep data lines separate from pipes | ISO; pipes cost nothing per tick | 1.1 per-pipe flow |
| 12 | Rendering | **Custom WebGL2 immediate-mode sprite renderer**: expanded quads with a static index buffer and texture-array atlases, fed by binary packets (§15.4). **No PixiJS** | Measured 5–30× faster than instancing on SwiftShader (Claude's verification renderer) and equal on real GPUs. No scene graph duplicating sim state | PixiJS 8.22; WebGPU |
| 13 | UI | **DOM + SolidJS 1.9.15** (fine-grained signals), CSS 9-slice frames and *Survey*'s faces, **Libre Franklin** and **Courier Prime** (OFL, self-hosted WOFF2 subsets, §9.3), fed by projections the sim computes (§15.5). WebGL draws world-anchored icons; the minimap and GUI previews show through DOM "holes" | Text, IME, scrolling and search for free; 60 Hz updates without a virtual DOM | A canvas-drawn GUI; React |
| 14 | Saves | **Binary sectioned container generated from the schema**, deflate via **fflate 0.8.3** in the IO worker. Save blobs in **OPFS** where available, with **IndexedDB** (via **idb 8.0.3**) for metadata and as the fallback (07-ui §19.2). Pools load by field name. Everything not declared derived is saved (§8.1). **Closure logs** give replays; checkpoints carry their digest lineage | Fast, versionable, debuggable; one format for saves, joins and bug bundles | JSON saves; localStorage |
| 15 | Assets | **Blender 5.2 Cycles** renders from Python model scripts in the *Survey* style (IMPL-5): ink, washes and hatching in the build; frame 0 in full plus animated layers in their rectangles (§9.1). Atlases are KTX2 (XUBC7 → BC7; shadows ETC1S → BC4; probed fallbacks) in texture-array pages streamed by technology group (§9.2, §9.7). Icons are rendered from item models (§9.3). **Audio** is the generative engine of IMPL-6 on AudioWorklets (§9.4) | Fully scriptable, so Claude can author and verify it headlessly | Hand-drawn pixel art; runtime 3D; WebP atlases; FluidSynth tracks |
| 16 | Verification | Native scenario goldens. **NO_SLEEP equivalence**, save/load, join and replay equivalence on full state. Cross-engine digest traces (native, Node, Chrome, Firefox). Playwright feel tests with deterministic `__game.step(n)`. Screenshot review by Claude. On the dev server, **user-side benchmark and bug-report endpoints** | The user's real GPU closes the loop the host cannot | Manual testing only |
| 17 | Data contract | The engine reads **numbers, ids, enums and expressions** from `spec/data`, never English. One **expression compiler** serves every formula field (`count_formula`, `amounts_by_j`, `field_year`), emitting bytecode the sim interprets (§15.2). Formulas that are not expressions live in code, named by the owning chapter's section. **Milestone builds are rule-based filters** over the full data, checked for closure (§2.4, §12) | Design and code cannot drift apart silently | Prose formulas read by hand; per-milestone data sets |
| 18 | Contracts | **One schema** (`game/schema/`) generates every cross-language contract: pools, views, save sections, action codecs, events, projections, packet records and prototype tables (§15.1) | Drift between Rust and TypeScript becomes a build error | Hand-maintained mirrors; JSON over the boundary |
| 19 | Multiplayer | **Deterministic lockstep sequenced by a relay** over WebSocket on TLS 443 (chapter 11). **Single player is multiplayer with a `LocalSequencer`**; the seams S1–S15 and rules D1–D23 exist from M0 | Bandwidth independent of factory size; the multiplayer path is exercised by every test from day one | Server simulation; P2P UDP; adding players later |

---

## 1. Constraints that shape the engine

**The player.**
- One user, playing in a desktop browser on a mid-range laptop (the reference machine, §11), and later a group of two to eight friends and colleagues in multiplayer (chapter 11).
- They reach the game through an SSH tunnel to the dev server, or through a published build.
- **Browsers:** Chromium is primary (it has Keyboard Lock); Firefox is supported; Safari is best effort.
- **WebGL2 is required.** There is no WebGL1 fallback. **WebAssembly** with its 2023 baseline features (bulk memory, sign extension, non-trapping float-to-int, multi-value, reference types) is required; SIMD and threads are not used.

**The builder: Claude, on cpuserver10.**
- **No GPU.** On SwiftShader, about 5k sprites take 30 ms per frame and 20k take 70 ms (with expanded quads).
- **CPU:** a Xeon E5-2650 v2 at its 2.6 GHz base clock runs at about **0.42×** the reference machine's single-thread speed (A1: reference ≈ host ÷ 2.4; turbo windows at about 3.3 GHz make single runs differ by about 25%, so comparisons are interleaved, §10.6). 32 threads, 62 GB RAM.
- **Rust 1.99.1** with the wasm32-unknown-unknown target and binaryen 133 install user-mode here (CLAUDE.md).
- **Consequences:**
  - everything must be verifiable headlessly;
  - simulation tests never render, and run natively first;
  - performance is measured natively, in Node and in headless Chrome and Firefox, and calibrated against the user's machine (§10.6).

**Fidelity.**
- Factorio 2.0 mechanics and numbers (ISO).
- The engine must reproduce the timing-sensitive behaviours to within a few percent of the wiki: belt compression, inserter cycles, insertion limits, fluid sharing and brownouts. Golden tests check this (§10.3).

**Data-driven.** The design YAML is the source of truth. There is no per-item code; per-entity behaviour comes from a small set of entity *types*.

**Scale.** A late game of about 150k entities at 60 UPS on the reference laptop (§11).

**Determinism.** One closure stream must produce bit-identical worlds natively and in every supported browser, because replays, bug bundles, joins and multiplayer all rest on it (§4.1).

**Churn.** Rounds 3–5 will rename and rebalance. The engine absorbs that as data, so tests assert ratios and rules, not names, and a data edit never needs a Rust rebuild (§15.2).

---

## 2. Stack, layout and data pipeline

### 2.1 Versions (pinned; installed and run on this host, 2026-10-19 and 2026-10-20)

The rule: each npm or crate pin is the newest release at least 14 days old (cutoff 2026-10-05 for the round-4 set, 2026-10-06 for version 2's additions). The exceptions: Playwright, which matches the host's global 1.64.1, and the Rust toolchain, which takes the newest stable minor release at least 14 days old (1.99.0, 2026-10-01) at its newest patch (1.99.1), because patch releases only fix regressions. The npm pins were installed together and smoke-tested here in round 4 (`design/round2/A-stack-test/`): native binaries run on glibc 2.31 without AVX2; `tsc`, `vite build`, Vitest, Biome and `check-arch` all ran; Solid compiled; zod, fflate, fake-indexeddb and maxrects-packer loaded. The Rust pins were tested in A1's engine study (`design/engine-study/`) and B1's probes: cargo built natively and for wasm32, clippy ran with the bans, binaryen optimised, and the modules ran in Node, Chrome and Firefox.

| Package | Pin | Role | Notes |
|---|---|---|---|
| Node | 24.22.0 (`~/.local/bin/node`) | Build, tests, benchmarks, data stage, schema generator | Never `/usr/bin/node` (v10) |
| Rust | 1.99.1 (`rust-toolchain.toml`) | The simulation and worldgen crates; native tests and tools | rustup and cargo home in `~/.local/opt/` (CLAUDE.md). `rust-toolchain.toml`: channel 1.99.1, target wasm32-unknown-unknown, components clippy and rustfmt, profile minimal |
| binaryen | 133 (wasm-opt) | `-O3` on the release WebAssembly; the feature gate (`--print-features`) | Static build in `~/.local/opt/binaryen-133` |
| libm (crate) | 0.2.16 | The simulation's only runtime dependency: transcendental functions behind the crate `det` (§4.1) | MIT. Default features: its `arch` feature only substitutes exactly rounded instructions (sqrt, floor, ceil, trunc, rint, fma), so results do not change. Bit-identical natively and in every engine (Appendix A) |
| proptest (crate, dev only) | 1.11.0 | Property tests in Rust | 1.12.0 is 10 days old |
| ws | 8.22.0 | The multiplayer relay (MP milestone; 11 §6.1) and its Node tests | Pinned by A2's proof of concept |
| typescript | 7.0.2 | `tsc -b --noEmit` type-check only | Native Go binary (`@typescript/typescript-linux-x64`). Fallback 6.0.3 if a TS 7 checker bug blocks |
| vite | 8.3.2 | Dev server, production bundle, module workers | Rolldown inside. `?url` imports with `WebAssembly.compileStreaming` in a module worker verified (A1) |
| vitest | 5.0.3 | TypeScript unit, codec, shell and property tests; `bench` mode | Runs from its own `vitest.config.ts` with `environment: 'node'` and **without** vite-plugin-solid. Verified: the Solid plugin silently switches Vitest to jsdom, which we neither need nor install, since UI is tested in real browsers |
| @playwright/test | 1.64.1 | E2E, screenshots, cross-engine traces | Matches the global install (exception to the 14-day rule). Chrome via `launchOptions.executablePath: ~/.local/opt/chrome-current/chrome`; Firefox 157 from Playwright's own cache (§10.5) |
| @biomejs/biome | 2.5.15 | Lint and format (TypeScript) | |
| oxc-parser | 0.153.0 | AST for `scripts/check-arch.ts` | Verified: flags `Math.random`, `Math.sin`, `Date.now` |
| fast-check | 4.10.2 | Property tests (TypeScript) | |
| solid-js / vite-plugin-solid | 1.9.15 / 2.11.14 | DOM UI | A 10-slot test app is 4.4 kB gzipped |
| yaml | 2.9.1 | Data stage and schema generator | |
| zod | 4.6.5 | The data stage's prototype schema; the schema generator's own descriptor validation | |
| fflate | 0.8.3 | Save compression (deflate), sync in Node and async in the IO worker | |
| idb / fake-indexeddb | 8.0.3 / 6.2.5 | IndexedDB in the browser and in Node tests | |
| pixelmatch / pngjs | 7.2.0 / 7.0.0 | Screenshot diffs | pixelmatch 8 is younger than 14 days |
| simplex-noise | 4.0.3 | **No longer in the game** (worldgen moved to Rust, §5.18). Kept as a dev dependency only to produce golden values for the Rust noise port | Uses only `+ − × floor` |
| maxrects-packer | 2.7.4 | Atlas packing in the Node asset build | Import `maxrects-packer/dist/maxrects-packer.mjs` directly. 2.7.4 declares `"type": "module"` but its `main` is a UMD file, so the bare import yields no exports (verified). 3.0.0 is four days old |
| Python (`gamedev-python` 3.12) | numpy, pillow, pyyaml, pedalboard, fonttools | Asset post-processing (§9.2), font subsets (§9.3), SFX synthesis (A4's `sfx.py`, §9.4), `tools/validate_spec.py` | music21 and pretty_midi are no longer needed (§9.4) |
| Blender, resvg, magick, oxipng, cwebp, ffmpeg, gifski | As in `CLAUDE.md` | Asset pipeline | `fluidsynth` is no longer used (§9.4) |
| basisu (Basis Universal) | 2.50 (`~/.local/opt/basisu-2.50`) | KTX2 encoding in the asset build (XUBC7, ETC1S); the same build's `basis_transcoder.wasm` runs in the asset worker (§9.2, §9.7) | Apache-2.0. Built here from source with the system gcc and `cmake` from `~/.local/opt/buildtools-venv` (`CLAUDE.md`). Encoder and transcoder are pinned together |

**Policy.**
- Pin exact versions: `npm ci` from `package-lock.json`, and `Cargo.lock` committed with `=` requirements for every crate (`libm = "=0.2.16"`), so `cargo build --locked` never resolves anew.
- Upgrade only at milestone boundaries, and only to releases at least 14 days old. A toolchain upgrade reruns the cross-engine traces (§10.4) before it lands, because it changes the binary.
- There are no runtime network calls: fonts, data, assets and the WebAssembly modules are all self-hosted.
- **New crates need a reason.** The simulation crates depend on `libm` only; anything else (a hash map, a serializer, a random-number crate) is written in-crate or argued in a report, because every dependency is code that must be deterministic on every target.

### 2.2 Repository layout

The repository root stays `/home/mewse/browsergame`. The code lives in `game/`: one npm package and one Cargo workspace side by side. Each TypeScript layer has its own tsconfig, and the import boundaries are enforced by `check-arch`; each Rust crate has one job, and the crate graph enforces the rest.

```
browsergame/
  CLAUDE.md  design/  tools/validate_spec.py  tools/render_spec.py  tools/check-toolchain.sh
  tools/ref/heat_calib3.py   # verbatim copy of round1/F-data/calib3.py: the heat field's golden reference (G15)
  game/
    package.json  package-lock.json  biome.json  vite.config.ts  vitest.config.ts  playwright.config.ts
    tsconfig.{shared,simworker,genworker,ioworker,assetworker,app,ui,render,audio,assets,scripts}.json   # per-layer libs
    Cargo.toml  Cargo.lock  rust-toolchain.toml  clippy.toml  rustfmt.toml           # the workspace
    schema/        # THE schema (§15.1): types, state, sections, actions, events, projections, packet, protos, registries
    crates/
      schema/      # GENERATED from schema/ (committed; never edited by hand): ids, enums, shared records (ChunkData),
                   #   codecs, packet, event and projection writers, the Protos loader; used by every crate below
      det/         # deterministic maths: libm re-exports, powi, piecewise tables (§4.1); the only crate using libm
      worldgen/    # pure chunk generation, noise, climate, towns (§5.18); no World access, no I/O
      sim/         # the World and every system (§4–§5), saves, digests, extraction, projections, queries
        src/gen/   # GENERATED from schema/: the SoA pools and save sections, which only the sim uses
      simabi/      # cdylib → sim.wasm: the C ABI of §15.8 over `sim`, the panic hook; the only `unsafe` code
      genabi/      # cdylib → gen.wasm: the worldgen workers' ABI over `worldgen`
      simtool/     # native binary: replay, state diff, digest bisect, benchmarks, golden runner (§10)
    src/
      shared/      # TypeScript types used across threads: ids, protocol, packet layout (no DOM, no linear memory)
        gen/       # GENERATED from schema/: codecs, decoders, record types, layout constants, proto ids
      simworker/   # the sim worker's shell: module loader, LocalSequencer, pacing, packets, subscriptions, checkpoints
      genworker/   # the worldgen worker: loads gen.wasm, answers chunk requests
      ioworker/    # compression, SHA-256, OPFS and IndexedDB
      assets/      # the main thread's asset loader (format probe, residency, priorities, uploads) and, in worker.ts
                   #   and worker/, the asset worker (fetch, KTX2 transcoding, audio decoding; §9.7)
      render/      # WebGL2 renderer (main thread)
      ui/          # SolidJS GUI, HUD, windows, input system
      audio/       # Web Audio runtime
      app/         # entry points (main.ts and the worker entries); wiring between threads
      dev/         # __game hooks, debug overlays, dev-server middleware (/__bench, /__report, /__shot)
      net/  relay/ # multiplayer (MP milestone; chapter 11): the net worker, the relay's RoomCore and Node adapter
    data/engine/   # engine overlay YAML (§2.4), including manifests.yaml (the milestone filters of §12)
    locale/en.yaml # UI strings (names come from the data)
    assets/        # sources: blender/ (lib/, entities/, world/, items/; §9.1), svg/, textures/, audio/
    public/        # build outputs served: data/prototypes.{bin,json}, data/build-manifest.json, atlases/, sheets/, audio/,
                   #   fonts/, sw.js (§9.7)
    .cache/assets/ # the asset build's cache by content hash (gitignored; §9.1)
    test/          # layouts (*.txt), goldens/, saves/, logs/ (closure logs), fixtures/ (codec and packet fixtures)
    e2e/           # Playwright specs and screenshot goldens
    bench/         # benchmark scenarios, runner, history.jsonl, user-results/
    scripts/       # data-stage.ts, schema-gen.ts, check-arch.ts, cargo-plugin.ts, wasm-release.sh, build-assets.ts,
                   #   assets/*.py (the asset build's Python steps, §9.2) …
```

**Boundary rules** (checked by `check-arch` for TypeScript and by the crate graph for Rust):
- `crates/schema` depends on nothing. `crates/det` depends on `libm` only. `crates/worldgen` depends on `det` and `schema`. `crates/sim` depends on `det`, `worldgen` and `schema`. The two ABI crates depend on what they wrap. `simtool` depends on `sim`. Nothing in `crates/` does I/O except `simtool`.
- `#![forbid(unsafe_code)]` in `schema`, `det`, `worldgen` and `sim`; `unsafe` exists only in `simabi` and `genabi`, where raw pointers cross the ABI.
- Only `src/simworker/` touches the sim module's linear memory (IMPL-1 rule 4). `render/`, `ui/` and `audio/` see the sim only through `shared/` types and decoded packets.
- `render/`, `ui/`, `audio/` and `assets/` import only themselves and `shared/`. Only `app/` wires threads and layers together (for example, it hands the asset loader's textures to the renderer and its samples to audio).
- `src/shared/gen/`, `crates/schema/` and `crates/sim/src/gen/` are written only by `scripts/schema-gen.ts`; `check-arch` refuses hand edits (a header hash per file).
- `tsconfig.shared.json` and the worker configs have `"lib": ["es2024", "webworker"]` as needed and no DOM; the main-thread configs have DOM. (A trial of the combined dom and webworker libs showed they clash in TS 7.) `src/assets/` holds both sides: `tsconfig.assetworker.json` covers `worker.ts` and `worker/`, and `tsconfig.assets.json` the rest.

### 2.3 Commands

| Command | Does |
|---|---|
| `npm run dev` | Data stage and schema generator in watch mode, the cargo plugin, then the Vite dev server on `127.0.0.1:5173`. The user tunnels in (`CLAUDE.md`). The dev middleware serves `/__bench`, `/__report` and `/__shot` (§3.5) |
| `npm run build` / `npm run preview` | Release WebAssembly (`scripts/wasm-release.sh`), the production bundle in `dist/` with brotli and gzip siblings of every text-like file, `build-manifest.json` / serve it on the same port, the siblings by `Accept-Encoding` (§9.7) |
| `npm run data` | Data stage (§2.4) |
| `npm run gen` | Schema generator (§15.1): writes `crates/schema/`, `crates/sim/src/gen/` and `src/shared/gen/` |
| `npm run check` | `biome check`, `tsc -b`, `check-arch`, `schema-gen --check`, `cargo fmt --check`, `cargo clippy --workspace --all-targets --locked -- -D warnings`, the data stage in strict mode (run twice; the outputs must be byte-identical, D14), `gamedev-python ../tools/validate_spec.py ../design/spec/data`, and the generated-spec freshness checks `gamedev-python ../tools/render_spec.py --check` (02, 05) and `gamedev-python ../tools/render_slice.py --check` (09 §1–§2) |
| `npm test` | `cargo test --workspace --locked --features simcheck` (native units, `dev` profile), `cargo test --workspace --locked --profile ntest --features simcheck` (scenario, golden, property and determinism suites, the golden integration set of §15.10), and Vitest (codecs, the shell against a `wasmdev` build of `sim.wasm` with `simcheck`, decoders, UI logic) |
| `npm run test:slow` | Native long runs (heavy mode, NO_SLEEP and join equivalence at Mid and Late scale, D18 fuzzing), worldgen seed sweeps (09 S-G1), cross-engine traces on every recorded log in Node, Chrome and Firefox, the scripted opening's full replay. Nightly and at milestone exits |
| `npm run e2e` | Playwright: feel tests, window screenshots, smoke. `--project firefox` runs the Firefox 157 suite with `?render=none` (§10.5) |
| `npm run bench [-- --scenario X]` / `npm run bench:ab -- --base <rev>` | Benchmark runner (native, Node and browsers; §10.6) / a paired A/B of two builds in one session |
| `npm run assets [-- --only id]` | The asset build (§9): Blender renders, ink, packing, KTX2 encoding with `basisu`, icons, the UI skin, font subsets and the audio packs, then `sprites.json` and the checks of §9.5. Incremental by content hash, cached in `.cache/assets/` |
| `npm run ci` | `check`, `test`, `e2e --grep @smoke`, the cross-engine smoke trace (§10.4), the release WebAssembly build with its feature gate (skipped when nothing under `crates/` or `schema/` changed since the last green run, because it takes about a minute), and `bench --quick` against the §11 budgets (a budget gate, not a regression gate; §10.6). It runs only what the current milestone's **capability manifest** enables (§2.4): in M0, "green" means M0's checks, tests and benchmarks. Installed as a git pre-commit hook once the repository is initialised |

**Cargo profiles** (`game/Cargo.toml`):

| Profile | Settings | Used for |
|---|---|---|
| `release` | opt-level 3, `lto = "fat"`, `codegen-units = 1`, `panic = "abort"`, `debug = false`, overflow checks off | `sim.wasm` and `gen.wasm` in production, then `wasm-opt -O3`. About 38 s plus 28.5 s for wasm-opt on a 50k-line crate (A1); never incremental |
| `wasmdev` | inherits `release`; `lto = false`, `codegen-units = 16`, `incremental = true`, opt-level 2 | The dev server's modules, about 3 s incremental (A1). Same semantics as `release`: optimisation never changes results (§4.1) |
| `dev` / `test` | opt-level 1, debug assertions and overflow checks on; dependencies at opt-level 3 | `cargo test`: fast to build, slow-ish to run |
| `ntest` | inherits `release`; `debug-assertions = true`, `overflow-checks = true`; tests unwind (cargo ignores `panic = "abort"` for test targets) | Scenario, golden and determinism suites (`cargo test --profile ntest`): release speed with every assertion |

**The `simcheck` cargo feature** turns on the checks that cost time: the NaN scans of D6, per-phase digests (§4.8), the counting allocator (§2.5) and the profiling scopes. It never changes results. Native tests always build with it, and so does the dev server's `wasmdev` module (the cargo plugin passes `--features simcheck`); release modules never do. "Dev builds" in this document means builds with `simcheck`.

**Vite and cargo.**
- **Dev.** `scripts/cargo-plugin.ts`, registered in `vite.config.ts`, builds both cdylibs with `cargo build --profile wasmdev --features simcheck --target wasm32-unknown-unknown -p simabi -p genabi` at server start and on every change under `crates/`, `schema/` or `Cargo.toml` (debounced 200 ms, one build at a time). It serves the results as virtual modules `virtual:sim-wasm` and `virtual:gen-wasm`, which export the module URL, and sends a full page reload after each build: there is no hot reload for the simulation (A1). A failed build shows Vite's error overlay with cargo's message.
- **Build.** `scripts/wasm-release.sh` runs `cargo build --release --locked --target wasm32-unknown-unknown -p simabi -p genabi`, then `wasm-opt -O3`, then **the feature gate**: `wasm-opt <module> --print-features` must print exactly the allowed set (mutable globals, non-trapping float-to-int, bulk memory and its `-opt` variant, sign extension, reference types, multi-value, overlong call-indirect: the defaults of Rust 1.99's wasm32 target, measured). Anything else, SIMD, relaxed SIMD, threads or atomics above all, fails the build (D19). The plugin then emits the modules as content-hashed assets.
- **Loading.** The main thread compiles each module once per page with `WebAssembly.compileStreaming(fetch(url))` (4.7 ms in Chrome, 8.9 ms in Firefox for A1's 70 kB module) and sends the `WebAssembly.Module` to every fresh sim and worldgen worker, which instantiates it once per world (§3.1, §9.7). Modules are structured-cloneable, so a fresh worker never recompiles.
- **`build-manifest.json`** (written by the build): `buildHash`, `protocolVersion`, `schemaHash`, `prototypesHash`, the SHA-256 of each WebAssembly module, and the asset list (every served file with its SHA-256; the content-addressed names, §9.7). `buildHash` is the SHA-256 of the sorted listing of `(path, SHA-256)` for every file in `dist/` except the manifest itself, so any change to code, data or modules changes it (D14). Dev builds hash the two modules, `prototypes.bin` and the schema instead, and set `dev: true` in the manifest; the hash is 32 bytes either way.

### 2.4 The data pipeline ("data stage")

Factorio builds its prototypes in a data stage (`data.lua` → `data-updates` → `data-final-fixes`). Ours does the same at build time, in TypeScript (`scripts/data-stage.ts`), and its output is the only way prototype data reaches the simulation.

1. **Design data.** Source: every `design/spec/data/*.yaml`, in the schema of `SCHEMA.md`. R4-data owns all of them except `text.yaml`, which R4-ui owns.
   - **Kinds:** items, recipes, entities, technologies, resources, enemies, **tiles** (κ, buildability, walking speed, map colour, placing item; town streets and building blocks are tiles too; B3), **world** objects (trees, rocks, the campus, landmarks; J9), **text** (loading tips, tips and tricks, milestones, achievements with machine-readable conditions, town-name lists and the world objects' `world_text`), and `meta`, a mapping of global blocks (`tiers` and categories, start and salvage, `quality`, `heat`, `staffing`, `runaways`, `hollow_work`, `world`, `world_settings`, `endgame`, `effects`, `checks`, `citation_rules`). The UI's own strings (statuses, alerts, flying text, log lines, readouts) are 08's and live in `game/locale/en.yaml`, not in the data.
   - **Validation:** `tools/validate_spec.py` checks the schema, references, the technology DAG, producibility, the research playthrough and the expression grammar.
   - The engine never edits these files.
2. **Engine overlay.** Source: `game/data/engine/*.yaml`, keyed by id. It holds only fields the design schema does not carry:
   - collision, selection and player-collision boxes, and selection priority;
   - fluid-box positions, directions, flow types and **connection categories**, `default` or `data` (U50). Example: the data refinery's crawl and stream boxes are `data`, its water box `default`;
   - inserter pickup and drop vectors and rotation and extension speeds. Their energy per movement and per rotation is design data (`energy.per_movement_kj`, `per_rotation_kj`; §5.4);
   - a drill's mining area and output vector, and the **pumping position** of offshore pumps and Water exchangers (U9);
   - belt lane geometry;
   - sprite-set names where they differ from the default `<namespace>/<name>`, and the tables that name the sets of tree species, decoratives, cliffs and town buildings (§15.7's lookup contracts); animation speeds; working sounds. Frame counts come from the asset build (§9.1);
   - the **event-to-sound map** (§15.6): which sound each sim event plays, by entity type or material;
   - entity map colours (tile colours are design data) and circuit-connector positions;
   - `fast_replaceable_group`, `next_upgrade`, rotatable and flippable flags;
   - item group, subgroup and order (they drive the crafting grid, I §7.2);
   - the **quality stat table** (L5, §5.16): which stats of each entity type scale with quality (ISO 2.0). The slope is the design's `meta.quality.stat_bonus_per_level`;
   - terrain materials per tile id (§6.5);
   - `manifests.yaml`, the milestone build filters (§12), and `capabilities.yaml`, the capability manifests (below).

   **Defaults** come in two layers: per entity `type`, and per `mirrors` id. The `mirrors` defaults are a hand-typed table of Factorio 2.0 numbers from the wiki and the published prototype values (`round1/I-data/data/*.lua`): numbers only, never copied files.
   - **Parse rule** (J23): the defaults id is the leading `[a-z0-9-]+` token of `mirrors`.
   - The token `new` means no `mirrors` defaults. The data stage then requires a full overlay entry for that entity.
   - Most entities need no per-entity overlay.
3. **Compile** (`scripts/data-stage.ts`). It runs in `npm run data` and as a Vite plugin with file watching.
   1. **Load and merge.** The overlay may add engine fields. It may not override a design number: that is an error, and the fix belongs in the design YAML.
   2. **Compile expressions** (J18) to **bytecode** (§15.2). One grammar serves every formula field: `count_formula` and `field_year` (variable L), `amounts_by_j` (variable j) and the model-collapse `speed_factor` (variables sigma and c; `meta.world.model_collapse`).
      - It allows numbers, `+ − * /`, `^`, parentheses and the field's variables, and nothing else.
      - `^` needs an integer right operand after substitution and evaluates by repeated multiplication in a fixed order, so the result is exact in every engine (§4.1).
      - Each expression compiles once to a postfix program in `prototypes.bin`. The data stage evaluates the same bytecode with its own reference interpreter to validate it; costs are cached per level and product tables per value of j at runtime (§5.5).
      - An unknown variable or a non-integer exponent is a data-stage error.
      - **Ranges and level caps** (B1-r1 18). Every formula field declares a result range in `schema/protos.yaml` (costs ≥ 1 unit; amounts ≥ 0; the collapse factor in [0, 1]), and the interpreter clamps results to it (§15.2). The stage checks each expression at every level up to the field's **level cap**: a finite technology's `max_level`, and for an infinite technology the last level whose cost is finite, at most 2⁵³ units, and whose exponents stay within ±1,024. The cap is stored in `prototypes.bin`; the technology cannot be researched beyond it, identically everywhere. Fields over bounded variables (j, σ, c ∈ [0, 1]) are checked at 1,001 evenly spaced points per variable, endpoints included.
   3. **Derive.**
      - Belt speed in positions per tick from `items_per_s` (15 → 8).
      - Nothing for containers: every fill and empty recipe is explicit in the data (`container: fill | empty`; barrels for water, sulfuric acid, lubricant and coolant, drives for the four data fluids; none for steam or plasma, ISO).
      - Recycling recipes for the Verifier: 25% of ingredients, the quality rule.
      - Recipes with `pseudo: true` (the frontier-run launches) become validator-only: hidden from crafting, with their mechanics native to the engine.
      - The `computing` flag and the T\* class from `heat.class` (consumed by §5.9).
      - Placement predicates from the entity's `placement` block: `must_be_on: exchange` and `must_touch: [water, deep-water]` (§5.2).
      - Tile tables from `tiles.yaml`: κ, buildability, walkability and speed, map colour, and the item → tile map from items' `places_tile` (§4.4).
      - **Build filters** (§12; J17). A milestone manifest is a rule: the technologies of the listed tiers, minus exclusion roots and everything that depends on them. M1 is 09 §2.7's explicit list.
        - Everything else is derived. The recipes are exactly the non-pseudo recipes unlocked by an included technology or by `prior-art`; they are never listed by hand. Items and entities follow from the recipes. A manifest's `start_recipes` must equal `prior-art`'s unlocks.
        - **Closure check:** every prerequisite is inside the filter. Every ingredient, pack and trigger target is obtainable inside it: from resources, the start inventory and salvage, entity outputs and included recipes. Every recipe category has an included machine or is hand-craftable. When a manifest lists `tiles`, every item's `places_tile` and every tile worldgen places is in the list.
        - `scenery` resources (09's exchange in the slice) are generated but exempt from closure, and nothing in that build can extract them.
        - Spoil results (Scooped) and Wild loot are conditional. A recipe that needs only them is reported as inert, not as an error.
        - M1's list is generated from the data by `tools/render_slice.py` (09 §1, §2.7). Its derived keys (start recipes, items, entities, tiles, world objects, resources, scenery) are checked against the same rules.
        - The reference implementation of these rules, run against the current data, is `design/round4/arch-data/manifests.py`.
   4. **Validate** with zod schemas. Every entity has boxes and sprite references. Fluid boxes match recipe fluids. Every recipe category has a machine. Every item has an icon or a placeholder. **Every technology effect type, trigger type, achievement condition (`text.yaml`) and `formula_ref` named in the data exists in the engine's registries.** The registries are part of the schema (`schema/registries.yaml`, §15.1), which also generates a Rust enum per registry with an exhaustive `match`, so a registry entry without an implementation does not compile. This last check is what keeps design and code in sync. It runs over the prototypes that the milestone's capability manifest includes (below): in M0 only their entries need implementations, and the rest of the data is checked by `tools/validate_spec.py` and the schema, not against engine code that does not exist yet. Also:
      - a research-per-paper effect carries `multiplier_from: returns_to_research`. A literal multiplier there is an error (J14);
      - a catalyst product carries `affected_by_quality: false` (L5);
      - productivity applies only to recipes with `allow_productivity: true` (DECISIONS §30). The stage lists, per machine, the recipes a productivity module would block;
      - **no prose where the engine reads** (J1). The engine's zod schema names every field it consumes, typed as a number, an id, an enum or an expression, and a prose string in such a field is an error. Fields it does not consume (`rule`, `formula`, `note`, `line`, `desc`) are documentation for people.
      - **font coverage** (§9.3): once the asset build has made the WOFF2 subsets, every character of the text canon and of `locale/en.yaml` must be in them;
      - **Formulas that are not expressions** (T(W)'s clamp, j(W)'s breakpoints, the leak's selection rule) live in Rust code, parameterised by the block's numbers. The block's `formula_ref` cites the chapter section that states the rule (e.g. "01 §8.1"). The code that implements it carries the same citation as a `// @formula 01 §8.1` comment, and the stage fails when a `formula_ref`'s leading "NN §X.Y" has no tagged implementation under `crates/`.
   5. **Assign dense numeric ids** per kind, sorted by group, subgroup, order, then id.
   6. **Emit** (§15.2 has the formats):
      - `public/data/prototypes.bin`: every number, id, enum and expression the simulation reads, in the tables of `schema/protos.yaml`, with each kind's name table;
      - `public/data/prototypes.json`: what the UI and the renderer read (names, groups, icons, sprite set names, boxes, display data, and the namespace tables of §15.7's lookup contracts);
      - `src/shared/gen/proto-ids.ts`: string-literal unions, so tests and code that name `'memo'` are checked at compile time;
      - `prototypes.hash`, the SHA-256 of `prototypes.bin`, into `build-manifest.json`. Saves, checkpoints and multiplayer handshakes carry it (§15.2).
4. **At runtime**, the sim loads `prototypes.bin` into its `Protos` tables (Rust `Vec` columns indexed by dense id, e.g. `protos.entity.crafting_speed: Vec<f64>`), and the UI and renderer build their own lookup tables from `prototypes.json`. Rust never hard-codes a prototype id: names the engine must know (`frontier-checkpoint`, the `research-run` recipe, the rollback types) are listed in `schema/registries.yaml` under `well_known`, resolved by name at load, and checked to exist by the data stage (those the milestone's capability manifest includes).

**Capability manifests** (`game/data/engine/capabilities.yaml`; B1-r1 19). Each milestone's manifest states what the engine supports at that milestone, so that "green" has a definite meaning and nothing is half-supported:
- **prototypes** the build includes (M0: one chest, the character, worldgen v0's tiles and one resource, the items they need and one hand-craftable recipe); the data stage filters `prototypes.bin` and `prototypes.json` to them, as a build filter does (§12);
- **actions** the sim implements (M0: walking, mining by hand, building and mining the chest, the inventory transfers of I §8.2, hand crafting, the settings actions and every system action); any other action type decodes, but is refused at application with `action_failed` and the reason `unsupported`, a developer reason without player-facing text (§15.3);
- **registry entries** that must be implemented (effects, triggers, achievement conditions, formula references; M0: those its prototypes use, which may be none);
- **projections, queries and packet sections** the module produces (M0: §15.5's marked kinds and §15.4's sections for chunks, `DYN`, `MOVERS`, `EVENTS`, `UI` and `AUDIO_WORKING`, which stays empty while nothing in M0 works); a subscription or query outside it gets status 2 (invalid) with the reason `unsupported`;
- **scenarios, rule scenarios and benchmarks** that `npm test`, `test:slow` and `ci` run (§10.8's rows marked M0; §10.6's M0 benchmarks).

Each manifest extends the previous one, and the data stage checks that the build's prototypes close over it. Asking the engine for anything outside the manifest fails with an explicit error, never silently.

### 2.5 Code rules

**Both languages.**
- **Comments** state invariants and cite their source, e.g. `// FFF-430: 100 units per flow op, scaled by fullness`.
- Generated code is never edited; change the schema (§15.1).
- No player-facing string is ever written in code: strings come from `locale/en.yaml` (08) or the data (`pm/README.md`).

**Rust** (`crates/`):
- Edition 2024; rustfmt; clippy at `-D warnings` with the determinism bans of `clippy.toml` (§4.1) and `clippy::wildcard_enum_match_arm` denied in `sim`, so a new enum variant is handled everywhere.
- **Typed handles.** Every id is a generated newtype (`Serial(u32)`, `EntityHandle(u32)`, `ItemKey(u16)`, `RecipeId(u16)`, `PlayerIndex(u16)` …); integers never stand in for each other. A giant `World` indexed by interchangeable integers would forfeit Rust's guardrails (A1-r1).
- **No `unsafe`** outside `simabi` and `genabi`. Indexing stays checked in release builds: an out-of-range index panics (a trap, §3.6) instead of corrupting state silently.
- **The steady-state tick allocates nothing**: no heap allocation in per-tick paths. Growth is allowed only where it is explicit and amortised: pools, arenas and the slot heap on build, the event queue up to its cap (§15.6), the serial index, and the first regeneration of a pristine chunk (§4.4). A counting global allocator (feature `simcheck`) backs `__game.allocs()` and a test that runs 6,000 steady-state ticks of each benchmark save of the milestone (§10.6) and asserts zero allocations; the growth paths are measured, not banned (B1-r1 22).
- **Integer discipline** (D7): counters that can pass their range use `wrapping_*` or `checked_*` explicitly, and say which; `as` casts from floats saturate (Rust semantics, identical in every target).
- **No recursion** deeper than a constant bound (stack sizes differ between native and WebAssembly; D19): graph walks use explicit stacks.
- **No I/O, no threads, no clock** in `det`, `worldgen` and `sim` (D13, D19). Logging goes through a `log!` macro to the host import (§15.8); `println!` does nothing in WebAssembly and is banned.
- **Mutation only in the tick** (D1): `World` is mutated only by `World::tick(&mut self, closure)` and by loading; extraction, projections, queries and saving take `&World`. The borrow checker enforces D1 and D9 structurally.

**TypeScript** (`src/`, `scripts/`):
- `strict`, `noUncheckedIndexedAccess` outside hot loops, and `exactOptionalPropertyTypes`. No `any` in `shared/` and `simworker/`.
- **The sim worker's per-tick path allocates nothing** (A1 open issue 7): buffers, views and message objects are pooled, so a GC pause never lands in a tick. The main thread's frame loop follows the same rule (§11's GC budget).
- **TypeScript never computes world state.** It may compute *which actions to send* (drag-building, smart belts, the resolver) on the main thread, from the view model; those are quantised to integers before encoding (§15.3), so client arithmetic never enters the World.
- **Determinism bans where TypeScript produces bytes that must be identical** (D14): the data stage and the schema generator must give byte-identical output for identical input, so `check-arch` bans `Math.random`, `Date`, `performance`, `Intl`, `localeCompare`, `toLocaleString`, unordered object-key iteration in emitters, and `**`/`Math.pow` in `scripts/data-stage*.ts`, `scripts/schema-gen.ts` and `src/shared/gen/`.

---

## 3. Runtime architecture

### 3.1 Threads

```
 main thread                                     sim worker (one per world)                    worldgen pool (2–4)
 ──────────────────────────────────────          ─────────────────────────────────────────     ──────────────────────
 input capture → action map → resolver           TS shell                                      gen.wasm:
   → action encoder ───────────────── act ─────→   LocalSequencer (single player) ─┐          generateChunk(seed,
 SolidJS UI (stores fed by decoded records)        closure k ──────────────────────┤ ─req──→   settings, surface,
 WebGL2 renderer (mirror + per-frame data) ←pkt─   sim.wasm: World::tick(closure)  ▼ ←chunk─   cx, cy) (pure)
 Web Audio (events, working sounds, music)          extract · project · query (&World)
                       ── view / sub / query ──→   checkpoint copy (&World) ──────────────→  IO worker: deflate,
                                                                                                SHA-256, OPFS / IndexedDB
 multiplayer: net worker (sockets, RelaySequencer) ── closures over a MessagePort ──→ sim worker   (11 §2.4)
 swaps: a second sim worker loads the next world (new game, load, trap recovery, re-sync) and replaces the first (§3.4)
 assets: asset worker (fetch by priority, KTX2 → GPU format, Opus → Int16) ──→ main thread uploads textures, feeds audio (§9.7)
```

- **One simulation thread.** All game state lives in the sim worker's WebAssembly instance. Determinism is easy to guarantee because nothing else writes it (D1).
- **The sim worker** is a TypeScript shell (`src/simworker/`) around one instance of `sim.wasm`. The shell owns the closure intake, the `LocalSequencer` in single player, pacing, the packet pool, subscriptions, queries, checkpoint copies and trap handling. Everything that decides state happens inside the module.
- **One world per worker** (S11). A new game, a load, a trap recovery and a multiplayer re-sync each start a **fresh** sim worker, initialise it, and swap it in through the world-replacement protocol (§3.4). A fresh instance is the only way to give back linear memory, which never shrinks: a late game leaves about 1 GB allocated. In single player the old worker is terminated **before** the new one loads (the loading screen covers the gap), so two late worlds never share the tab's memory budget; only multiplayer's background re-sync runs two worlds at once, and 11 §5.2 checks memory before it does. The swap is exercised by every load, so the shadow re-sync reuses a tested path.
- **Worldgen workers** run `gen.wasm`, the `worldgen` crate's pure functions. They never touch the World (§5.18). Each pool belongs to one sim worker: the main thread creates the workers with it, passes their ports in `boot`, and terminates them with it, and every answer carries the world's hash (§15.9). The sim links the same crate and generates a chunk itself when a worker is late or absent (catch-up, replays, native tests), so the pool only saves time.
- **The IO worker** compresses (fflate), hashes (WebCrypto SHA-256) and stores saves. The sim worker only copies the sections out of linear memory, which takes about 50 ms for a late game (§8.4).
- **The asset worker** (one per page, independent of worlds; §9.7) fetches atlas pages, sheets and sample packs by priority, transcodes KTX2 to the GPU format the main thread chose, decodes audio to Int16 for the voice bank, and keeps a 64-MB cache of compressed pages. Uploads stay on the main thread. It never touches the simulation, so nothing that decides state waits for an asset.
- **Compiling the modules.** The main thread compiles `sim.wasm` and `gen.wasm` once per page and sends the compiled modules to every fresh sim and worldgen worker (§2.3), so a world replacement never recompiles.
- **The net worker** (multiplayer, 11 §2.4) owns the sockets and the `RelaySequencer`, and feeds closures to the sim worker over a `MessagePort`: the same port and codec that the `LocalSequencer` uses in-process.
- **Debug and test mode:** `?sim=inline` runs the same shell and module on the main thread through an in-process transport. Native tests use the `sim` crate directly, without a shell.

### 3.2 Protocol (`src/shared/protocol.ts`)

Messages between threads are structured-clone objects whose bulk content is transferable `ArrayBuffer`s in the binary formats of §15. Every message that refers to a world carries the **state generation** it belongs to (§3.4); a receiver drops messages from any other generation.

```ts
type StateGen = number;                                   // u32, allocated only by the main thread (§3.4)

type MainToSim =
  | { t: 'boot'; build: BuildManifest; module: WebAssembly.Module;   // sim.wasm, compiled once per page (§3.1)
      ioPort: MessagePort; genPorts: MessagePort[];
      closurePort?: MessagePort }                         // once per worker; closurePort only in multiplayer (S11)
  | { t: 'world'; gen: StateGen; op: 'new'; settings: NewWorldSettings }
  | { t: 'world'; gen: StateGen; op: 'load'; sections: ArrayBuffer; meta: SaveMeta }     // raw sections from the IO worker
  | { t: 'act'; gen: StateGen; firstSeq: number; actions: ArrayBuffer; blobs?: ArrayBuffer[] }
                                                          // encoded actions (§15.3) with the seq of the first, and any
                                                          // blobs they name (32-byte SHA-256, then the bytes)
  | { t: 'seq'; op: 'pause' | 'resume' | { speed: number } | { step: number } }          // sequencer control (S14)
  | { t: 'view'; gen: StateGen; v: ViewRequest }          // the camera and overlays (§15.4)
  | { t: 'sub'; gen: StateGen; subs: SubRequest[] }       // add or replace subscriptions (§15.5)
  | { t: 'unsub'; gen: StateGen; ids: number[] }
  | { t: 'query'; gen: StateGen; id: number; q: ArrayBuffer }   // one-off, read-only (§15.5)
  | { t: 'cancel'; gen: StateGen; id: number }            // drop a running or waiting query (§15.5)
  | { t: 'ack'; buf: ArrayBuffer }                        // a packet buffer returned for reuse
  | { t: 'save'; id: number; reason: 'manual' | 'auto' | 'exit' | 'checkpoint' }
  | { t: 'dev'; id: number; op: DevOp };                  // hash, digest, flags, bundle … (§3.5)

type SimToMain =
  | { t: 'ready'; abi: number; schemaHash: string; buildHash: string }
  | { t: 'bound'; gen: StateGen; tick: number; players: { index: number; lastSeq: number; inputGen: number }[] }
                                                          // a world is loaded and running (from sim_meta, §15.8)
  | { t: 'loadReport'; gen: StateGen; report: ArrayBuffer }                             // §8.3
  | { t: 'chart'; gen: StateGen; records: ArrayBuffer }  // pristine chunks' chart images from the worldgen pool,
                                                          // in CHART's record format (§5.19)
  | { t: 'pkt'; buf: ArrayBuffer }                        // one render-and-UI packet (§15.4), transferred
  | { t: 'res'; gen: StateGen; id: number; ok: boolean; value: ArrayBuffer }
  | { t: 'clock'; gen: StateGen; clockGen: number; tick: number; speed: number; paused: boolean }   // §3.3
  | { t: 'saved'; id: number; bytes: number; ms: number; sha256: string }
  | { t: 'trap'; gen: StateGen; tick: number; message: string }                         // §3.6
  | { t: 'log'; level: 'info' | 'warn' | 'error'; msg: string; data?: unknown };
```

- **`InputAction`** mirrors Factorio's `defines.input_action`, as I §8.2 lists it, with stable numbers of our own (§15.3). Our additions are in Appendix B. The main thread encodes each action with the generated encoder and sends it to the **sequencer port**: the sim worker's `LocalSequencer` in single player, the net worker in multiplayer. Actions never reach the World except as part of a closure (D2).
- **Seqs are the main thread's** (B1-r1 11). It is the only allocator of its player's seqs, so it knows the seq of every action it sends and can name the entities an unconfirmed build creates by creation id (§15.3). One rule sets its counter:
  - when a world is bound, `nextSeq = max(loaded, accepted, pending) + 1`, where *loaded* is its player's `lastSeq` in `bound`, *accepted* the relay's `acceptedThrough` (multiplayer; 0 in single player) and *pending* the highest seq it has sent but not yet seen applied;
  - a single-player replacement discards pending actions, which were addressed to the old world; in multiplayer they stay addressed to the room, and the net worker re-sends those above `acceptedThrough` (11 §3.3);
  - the counter never moves backwards within a world or a room session.

  The sequencer refuses seqs that do not rise, stamps ticks and writes input generations (§15.3).
- **Closures from the network** arrive on the `closurePort` as `{ t: 'closures'; first: number; closures: ArrayBuffer[]; blobs: ArrayBuffer[] }` (11 §2.4): closure k is `closures[k − first]`, in the format of §15.3, and every blob they name comes with them.
- **Validation.** Each action is validated in the sim against reach, items, collisions and permissions. Failures come back as events: flying text with a reason, an error sound (§15.6). The sim never calls UI code.
- **Queries** are read-only and are not logged. Examples: the rate calculator, map search, "where is X made", "total raw", Handbook live counts. They run between ticks against `&World` (D9).
- **Packets.** One transferable buffer per extracted frame holds every section the main thread needs: chunk view deltas, dynamic sprites, belt items as gap arrays, inserter hands, overlays, events, subscription records and working-sound aggregates (§15.4). The main thread transfers each buffer back with `ack`, so a pool of three buffers ping-pongs.
- **Backpressure.** When no buffer is free, the shell skips extraction for that tick. Events and subscription changes accumulate in the module (bounded, §15.6) and go out with the next packet; chunk deltas are computed against what the main thread already holds, so nothing is lost.
- **Logging.** The module's `log!` lines, the panic hook's message and every uncaught error in the shell are forwarded as `log` messages, so the page console (and therefore Playwright) sees everything.

### 3.3 The tick loop and pacing

- **Closures drive the loop** (D2, S3). The sim worker runs tick k only when it holds the closure of tick k, applies it with `sim_tick`, and never invents a tick. The *horizon* is the highest tick whose closure it holds.
- **The `Sequencer` interface** (S3) is implemented twice:

  ```ts
  interface Sequencer {
    submit(firstSeq: number, actions: ArrayBuffer, blobs?: ArrayBuffer[]): void;   // from the input layer
    onClosures(cb: (first: number, closures: ArrayBuffer[], blobs: ArrayBuffer[]) => void): void;
    clock(): { gen: number; tick: number; speed: number; paused: boolean };
    control(op: 'pause' | 'resume' | { speed: number } | { step: number }): void;
  }
  ```

  - **`LocalSequencer`** (single player, tests, replays; in the sim worker). It stamps each action for the next tick (margin 0) and closes ticks from its own clock, or on `step(n)` in test mode. It refuses seqs that do not rise, and it writes the player's current input generation into each held-input action as it stamps it (§15.3). In replay mode it feeds recorded closures (§8.5).
  - **`RelaySequencer`** (multiplayer, in the net worker; 11 §3) closes nothing itself: the relay does, and the net worker forwards closed ticks through its playout buffer.
- **The single-player clock** (the `LocalSequencer`, within one clock generation):
  - ticks due = `floor((now − t₀) × speed ÷ 16.667 ms)`; each wake runs at most 3 of the outstanding ticks;
  - if the backlog exceeds 6 ticks, `t₀` is rebased and the backlog dropped. Game time then slows, as in Factorio when UPS drops below 60, and there is no spiral of death;
  - waiting: `setTimeout(nextTickTime − now − 2 ms)` when the next tick is more than 4 ms away, otherwise a `MessageChannel` self-post, which avoids the 4 ms timer clamp. Accuracy is about 1 ms, without busy-spinning;
  - the debug overlay (F5) shows UPS and FPS.
- **Clock generations** (S3). Pause, resume, a speed change and a rebase each start a new clock generation `{gen, fromTick, speed, paused}`. Old timing samples and deadlines are void in the new generation. The shell reports the clock to the main thread (`clock`), which shows pause and speed. **Pause and speed never reach the World** (S14): they are sequencer state, and a paused game simply receives no closures.
- **Catch-up** (multiplayer joins and re-syncs, replay fast-forward). The shell runs ticks in slices of at most 12 ms with extraction off, yields between slices so messages keep flowing, and sets the module's **historical** flag, so events from those ticks are marked and suppressed (§15.6, D15). It leaves catch-up when the backlog is small again (11 §3.6).
- **Rendering is decoupled.**
  - The main thread renders the latest packet on `requestAnimationFrame`. Camera pans and zooms animate at the display rate.
  - World content updates at 60 Hz, as in Factorio, which renders at its update rate.
  - At most one extraction per wake: after a wake that ran several ticks, the shell extracts once, after the last.
  - **Extraction without ticks** (B1-r1 12). While no tick runs (paused, a step-mode test, a stalled sequencer), the shell still extracts once within 16 ms after any `view`, `sub` or `unsub` message, so a paused game answers camera moves and newly opened windows.
- **Hidden page** (07-ui §19.3).
  - **Single player:** the `LocalSequencer` pauses when the page is hidden (a new clock generation), and the game autosaves if the last save is older than a minute. The Interface setting *Keep running in background tab* (default off) keeps it closing ticks at whatever rate the browser allows, with extraction skipped.
  - **Multiplayer never pauses on a hidden tab** (11 §3.6): the worker is driven by arriving ticks, extraction stops while hidden, and on return the client catches up or re-syncs.
- **Pauses.** The technology screen and the game menu send `seq pause` in single player (I §4.0). In multiplayer they do not pause (11 §3.6).
- **Test mode** (`?test=1`). The clock stops. `__game.step(n)` closes n ticks, runs them synchronously and then emits one packet, so E2E tests are deterministic whatever the frame rate.

### 3.4 The view model (the main thread's mirror of what is on screen)

The main thread keeps a per-chunk mirror of the chunks in the view rectangle plus a one-chunk margin, built from packets (§15.4).

- **Tiles:** one `u8` tile id per tile (the dense ids of `tiles.yaml`), for terrain textures, buildability and walking speed.
- **World objects, ground items, decoratives and resource tiles** (§15.4's `CHUNK_OBJECTS` and `CHUNK_RESOURCES`), for drawing, hover and mining previews.
- **Entity records** (§15.4's chunk records):
  - serial, prototype, position, direction, flip and quality;
  - selection and collision boxes (from `prototypes.json`);
  - sprite variant (pipe and belt connection masks), recipe or alt-mode icon, status code, and the ghost, deconstruction, upgrade and compromised flags.
- **Versioning.** Each chunk carries view versions (§15.4). The worker resends a chunk's records only when a version changed (built, removed, rotated, recipe changed, status changed) or when the chunk enters the held set. **The held set** is the chunks that overlap the visible rectangle expanded by one chunk, computed by one generated function from the view request; the worker applies it when it extracts the packet answering a request, the main thread when it receives that packet, so both sides always agree on what the mirror holds.
- **Belt line geometry** is cached per line and geometry generation, and dropped with the last held chunk the line touches (§15.4).

**What the mirror buys** is instant feedback without a round trip:
- **Hover selection,** by selection boxes and priority (I §3.1).
- **Build previews:**
  - green, yellow or red tints (I §3.3);
  - drag-building lines, smart belts and underground pairing previews (I §3.4–3.5);
  - pole links and coverage.

The sim re-validates every action authoritatively. Live values (a tooltip's resources remaining, an entity's contents) come from subscriptions (§15.5).

**The world-replacement protocol** (S15; A2-r1 13). The main thread holds a **current state generation** (`u32`) and is the only thread that allocates one. A new generation starts whenever the world it shows is replaced: a new game, a load, a join, a re-sync swap, a rewind, a trap recovery. Each replacement goes through a fresh sim worker (§3.1):
1. The main thread allocates the next generation g and sends the new worker its world (`world {gen: g, …}`). The current generation stays g − 1 meanwhile: in multiplayer's background re-sync the old world keeps playing and its packets keep being drawn; in single player the old worker is already gone and the loading screen shows.
2. Every packet, response, event and trap carries the generation it came from, and the main thread **accepts only the current generation**, plus g's `ready`, `bound` and first packet. The new worker sends that first packet **unsolicited**, right after `bound`, even when the world is paused: a `FULL` packet with only the sections that need no view (the `UI` section is empty, since the new worker has no subscriptions yet). So the switch never waits for a view request (B1-r1 12).
3. When g's first packet arrives, the generation switches to g, and the main thread:
   1. drops the whole view model, so chunk versions are never compared across generations, even when the counters coincide;
   2. re-sends its view request and every subscription; open entity windows rebind by serial and close if the entity is gone (§15.5);
   3. rejects pending query responses from older generations;
   4. discards the latency state (multiplayer, 11 §3.5) and rebuilds it from the new world plus the actions still pending;
   5. resets audio state: working sounds stop, and the next packet's aggregates start them again (§15.6).
4. The old worker is terminated.

Sounds, flying text and toasts are never played for historical events (§15.6), so the fast-forward after a load or a join is silent.

### 3.5 Dev hooks and dev-server endpoints

**`window.__game`** exists in dev builds, and in production builds behind `?dev=1`. It exposes:
- `step(n)`, `dispatch(action)` (encoded and submitted to the sequencer, so it runs in the next tick), `query(q)`, `hash()` (the full state hash, §4.8), `digest()` (this tick's digest and rolling digest), `allocs()` (the counting allocator, §2.5) and `memory()` (linear memory size and pool capacities);
- `loadScenario(name | json)`, `save()` and `load(buf)`;
- `inspect(serial)`: every saved field of one entity, decoded by the generated views (§15.1);
- `ui.open(name)` and `ui.close()`;
- `render.mode('on-demand' | 'continuous')`, `render.frame()` and `camera(x, y, zoom)`;
- `speed(x)`, `replay(log)` and `exportBugBundle()`;
- `flags({noSleep})`, for tests only (NO_SLEEP, §4.6).

**The Vite dev server's middleware** writes into the project, so Claude can read it directly:
- `POST /__bench`: results of the in-game benchmark page `bench.html`, run by the user on their laptop, go to `bench/user-results/<date>.json`.
- `POST /__report`: from the console command `/report`, or Ctrl+Alt+F12. A bug bundle is saved to `bench/reports/<ts>/`: the last autosave, the closure log since it with its blobs and digest ring (§8.5), the console log, a screenshot from the user's real GPU, the build hash and the browser string. `simtool replay` reproduces it natively.
- `POST /__shot`: screenshots on demand from the user's session.

### 3.6 The language boundary

The split between Rust and TypeScript follows IMPL-1's five rules. Each has an owner and a test.

| # | Rule | How | Test |
|---|---|---|---|
| 1 | **Rust owns the authoritative state and the rules.** Closures enter through one validated API (`sim_tick`). Queries, extraction and TypeScript views never mutate state or influence future results | `World` is mutated only by `World::tick` and loading; extract, project, query and save take `&World`, plus the part of `PresentationState` they own (below; §2.5) | D18 (a)–(e); the D9 continuation test (§10.4 #13): different read schedules give identical digests and state |
| 2 | **One schema generates the contracts** with fixed widths, units, ids, ordering and versions, never Rust's incidental layout | `schema/` and `scripts/schema-gen.ts` (§15.1) | `schema-gen --check` in `npm run check`; the schema-hash handshake at start-up; cross-language codec fixtures |
| 3 | **Data leaves the sim in bulk**: render packets, projections and query results, through reusable writers. No per-entity calls across the boundary and no gameplay arithmetic in TypeScript | §15.4–§15.6 | A Vitest audit: the shell calls at most a fixed number of exports per tick; review |
| 4 | **View lifetimes are explicit.** Only the sim worker's shell touches linear memory, and it reacquires every view after memory growth or pool reallocation. No pointer survives an invalidating call | The `MemoryLease` below | A Vitest test that grows memory mid-session and checks that stale views throw in dev builds |
| 5 | **The boundary is reviewable and testable from M0**: real inventory and statistics projections, save and load, structured errors, trap recovery, native goldens and browser traces | M0 exit criteria (§12) | §10.4, §10.5 |

**Who owns what inside the module** (B1-r1 4). The module's state is one `SimContext { world: World, pres: PresentationState }`. `World` is the authoritative state: saved, hashed, and changed only by `World::tick` (or replaced by a load). `PresentationState` is everything the outputs must remember; the module owns it, and no rule ever reads it. Each of its fields has one writer:

| Field | Written by | Read by |
|---|---|---|
| The event queue (§15.6) | the tick, through an `EventSink` borrowed from `pres` | extraction, which drains it |
| The subscription table, each subscription's cadence, last record hash, last source revisions and sent series points (§15.5) | `sim_subscribe` and `sim_unsubscribe`; extraction updates the rest | extraction |
| The held set, each held chunk's sent versions, the sent belt geometry, the overlay and chart state (§15.4) | extraction | extraction |
| The view's cache of regenerated pristine chunks (§4.4) | extraction | extraction |
| The packet arena and output envelopes (§15.8) | extraction and queries | the shell, which copies them |
| Query continuations (§15.5) | `sim_query`, `sim_query_step` and `sim_query_cancel` | `sim_query_step` |
| The historical, `NO_SLEEP` and profiling flags | `sim_set_flags` | the tick (event marking), extraction |
| Which chunk requests the shell has been given (§15.9) | `sim_pending_chunks` | `sim_pending_chunks` |

- The tick is `World::tick(&mut world, closure, &mut EventSink)`; extraction is `extract(&world, &mut pres, &ViewRequest)`; projections and queries take `&World` and their own part of `pres`. The borrow checker keeps every read path from changing the World (D1, D9).
- Presentation fields inside pools (§4.5, such as `anim`) are part of the World's memory but are written only by the tick, read only by extraction, and never saved or hashed.
- The shell keeps no copy of any of this: it forwards requests and copies outputs. Only the main thread remembers its own subscriptions, to re-send them after a replacement.
- **Continuation equivalence** (D9): runs that differ only in their read schedule (extraction every tick, never or at random; subscriptions and queries added and dropped at random) give identical per-tick digests and full states (§10.4 #13).

**View lifetimes.** WebAssembly memory growth detaches the old `ArrayBuffer`, and a pool that reallocates moves its columns. So:
- every view the shell holds (generated pool views, the output arena, the input buffer) is obtained through a `MemoryLease` that records `memory.buffer` and `sim_memory_epoch()` (§15.8), which the module increments whenever any exported column or buffer moves;
- after **every** call into the module, the shell compares both and reacquires its views if either changed. The check is two comparisons;
- in dev builds a stale view throws on access;
- packets and responses leave the worker as copies (one `memcpy` into a pooled buffer, 1.7 ns per sprite record, A1), so no other thread ever sees linear memory.

**Structured errors.** Every export that can fail returns a status code; `sim_last_error()` returns `{code, message}` (§15.8). Examples: a save from a newer format or another worldgen version, a closure that fails the preflight (§15.3), prototypes that do not match the save and cannot be remapped. The shell turns them into `log` messages and the main thread into user-facing notices whose strings come from 08.

**Traps.** Release builds use `panic = "abort"`: a Rust panic (an index out of range, a failed assertion in a check that stays on) ends in a WebAssembly `unreachable` trap, and the instance is unusable afterwards (A1: its panic state stays set).
1. `sim_init` installs a **panic hook** that passes the message, file and line to the host import `host_panic` before the abort (A1 demonstrated it: "index out of bounds: the len is 3 but the index is 7", with file and line).
2. The shell catches the `RuntimeError`, stops its loop, never calls the instance again, and posts `trap {gen, tick, message}`.
3. **Single player:** the main thread shows the trap notice with *Send report*, and loads the last autosave into a fresh worker (§3.4). The bug bundle holds that autosave and the closure log up to the trapping tick, which reproduces the trap natively (`simtool replay`). Progress since the autosave is lost; that is the price of a bug, and the bundle is how it gets fixed.
4. **Multiplayer:** a trap is a desync on oneself (11 §5.2).
5. **Native tests** unwind and report the panic normally (`ntest`, §2.3).

### 3.7 Generations: a glossary

Several counters are called "generations". They are different things.

| Name | Width | Owner | Raised when | Where |
|---|---|---|---|---|
| Handle generation | 10 bits of an entity handle | the sim | a pool slot is reused | §4.3 |
| State generation | `u32` | the main thread | the world it shows is replaced | §3.4, §15.5 |
| Clock generation | `u16` | the sequencer (`LocalSequencer` or the relay) | pause, resume, speed change, rebase, relay restart | §3.3, 11 §3.1 |
| Input generation | `u16` per player | the sim (world state) | `release_inputs(p)` | §4.4, §15.3, D22 |
| Geometry generation | `u32` per transport line | the sim (derived) | a line's shape changes | §15.4 |
| Digest epoch | `u16` per player | the relay | a join snapshot or re-sync is ordered for that player | §4.8, 11 §5.1 |
| Room generation | `u32` per room | the relay | every relay start | 11 §6.9 |

---

## 4. Simulation core

### 4.1 The determinism contract

**The contract.** From the same start state and the same closures, the World evolves **bit-identically** natively (x86-64, where tests run) and in WebAssembly under V8 (Chrome, Node), SpiderMonkey (Firefox) and JavaScriptCore (Safari, best effort and untested on this host). Replays, bug bundles, save/load, joins and multiplayer all rest on this, and the tests of D18 check it on every scenario.

**Why Rust and WebAssembly make the arithmetic part easy.** One `sim.wasm` runs on every peer, and WebAssembly fixes IEEE 754 semantics for every instruction the module may use (the feature gate of §2.3 refuses SIMD, relaxed SIMD and threads). The remaining sources of difference are NaN payloads (we keep NaN out of state), transcendental functions (we compile them into the module from the `libm` crate) and native tests (which must use the same code paths). The class that dominates in practice, ordering, unsaved state and impure caches, does not depend on the language (A1, A2 §1.4), which is what D1–D23 are for.

**Arithmetic rules** (the crates `det`, `worldgen` and `sim`; D19 in full):
1. **Allowed:** `+ − × ÷` on integers (with D7) and floats; `sqrt`, `floor`, `ceil`, `round`, `trunc`, `abs` and `copysign` (exact under IEEE 754); comparisons; `as` conversions (float to integer saturates and maps NaN to 0, identically on every target). Rust never contracts `a * b + c` into a fused multiply-add, and optimisation levels never change results.
2. **Transcendentals only through `det`**, which wraps the `libm` crate (0.2.16): `det::exp2`, `log2`, `pow`, `sin`, `cos` and `atan2`, plus `det::powi(x, n)`, which multiplies left to right `|n|` times and takes the reciprocal for negative n (|n| ≤ 1024), and `det::fmax`/`fmin`, defined as comparisons (`if a > b { a } else { b }`). `libm` is plain Rust compiled into the module, so every engine runs the same instructions; B1 measured ten functions over 10⁶ arguments each bit-identical natively, in Node, Chrome 156 and Firefox 157, before and after `wasm-opt -O3` (Appendix A). `det` serves the exchange floor `2^((W−40)/20)`, the field's γ(W), m = g^r, and orientation maths for trains and agents. Unit tests pin its outputs against golden values.
3. **Banned** (`clippy.toml`, each verified to fire): on `f64` and `f32`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `exp`, `exp2`, `exp_m1`, `ln`, `ln_1p`, `log`, `log2`, `log10`, `powf`, `powi`, `cbrt`, `hypot`, `sinh`, `cosh`, `tanh` and their inverses (`std` calls the platform's libm natively but musl's code in WebAssembly; LLVM's `powi` has unspecified rounding), `mul_add`, `max`, `min` and `clamp` (native and WebAssembly differ on −0 and NaN); `libm::fma`; `std::collections::HashMap` and `HashSet` (randomly seeded per process); `std::time::Instant::now` and `SystemTime::now`; `std::thread::spawn`.
4. **Integers where Factorio uses them:**
   - belt positions in 1/256 tile;
   - item counts as `i32`;
   - circuit signals as `i32` with explicit `wrapping_*` arithmetic;
   - tile coordinates as `i32`.
5. **Doubles elsewhere:**
   - energy in joules;
   - fluid amounts in units;
   - heat in MJ;
   - research progress in units;
   - continuous positions (character, agents, trains, units) in tiles.
6. **RNG** (§4.3) is either stream-based, with each stream seeded from the world seed and a stream id, or counter-based for per-event draws. No draw ever depends on update order.
7. **The state hash and the digests** are defined in §4.8. They cover saved state only (§8.1): optimisation state (active bits, wake registrations) and derived caches (`speed_eff`, network topology) are excluded, while the contents of lines, segments and networks are saved state and hashed. That is what lets a NO_SLEEP run, a sleeping run and a run continued from a save be compared bit for bit.

**TypeScript** never computes world state (§2.5). Where TypeScript must produce identical bytes on every machine (the data stage, the schema generator and generated code, D14), `check-arch` keeps the bans of §2.5.

**The rules D1–D23** (chapter 11's numbering; A2 §5.4, revised after A2-r1). They make desyncs structurally rare and keep single-player replays exact. **All are M0-mandatory.** The owners are the work packages of §15.11: *schema* (the schema and generator), *sim* (the Rust crates), *shell* (the sim worker), *relay* (the MP milestone).

| # | Rule | Why | Enforced by | Owner |
|---|---|---|---|---|
| D1 | **One writer.** Only `World::tick(closure)` mutates world state (plus `sim_load` and `sim_new_world`, which replace it), only in the sim worker. Extraction, projections, queries and saving take `&World`; TypeScript reads generated views and never writes | Anything else is an input the other clients never see | The borrow checker (§2.5); `forbid(unsafe_code)` in `sim`; the ABI has no other mutating export (§15.8) | sim |
| D2 | **Closures are the only input.** A tick's result depends only on the previous state and that tick's closure. Main-thread messages other than closures (`view`, `sub`, `query`, `seq`) never change world state. Sim-affecting settings are world state, changed by actions (D11). Pause, speed and clock generations never reach the World (S14) | Replays, joins and other clients see only the closure stream | `MainToSim` has no mutating variant besides `act`, which goes to the sequencer; replay test D18(e) | sim, shell |
| D3 | **Canonical iteration order** wherever order can matter: ascending pool index (for saved pools), ascending serial, or a saved order. (a) Entity active sets are bitsets iterated in pool order (A1 finding 1: the swap-remove list broke NO_SLEEP equivalence within 200 ticks when inserters compete). (b) Wake-ups only mark entities active and never do work; watch-list nodes carry the entity's wake sequence number, and stale nodes are dropped (A1's wake rules, §4.6). (c) Timers that do work fire in `(dueTick, serial, eventCode)` order, not insertion order. (d) No iteration over hash tables; where iteration is needed, ordered maps or sorted vectors. (e) Network member lists used in reductions are in ascending serial. (f) **Derived pools** (transport lines, fluid segments, networks, rail blocks) are processed in an order defined by canonical keys of saved state, never by their pool index, which differs after a load (§4.6; B1) | A world loaded from a checkpoint must behave exactly like the world that produced it; with two inserters competing for one item, order decides the winner | Join and NO_SLEEP equivalence D18(a, b); clippy's map bans; the review checklist | sim |
| D4 | **Float reductions in canonical order.** Every float sum or product over a set (network demand and satisfaction, heat, statistics) accumulates in D3's order, or uses integers or fixed point | IEEE addition is not associative: the same members in a different order give different last bits, then different satisfaction, then a desync | D18(a); the "incremental equals rebuilt" property test (§10.4 #10) compares the floats a network computes, not only its membership | sim |
| D5 | *Retired with the TypeScript simulation.* Its bans (`**`, `Math.pow`, `Math.hypot`, `Intl`, `localeCompare` …) now apply only where TypeScript must produce identical bytes (§2.5) | — | `check-arch` | schema |
| D6 | **No NaN in saved state.** WebAssembly NaN payloads are nondeterministic, and NaN breaks comparisons | Raw-byte hashing and saving would differ between engines | Builds with `simcheck` (§2.3) scan the float columns of active pools after each phase (generated per pool); the hash maps every NaN to one bit pattern, so a NaN fails the scan in tests rather than desyncing | sim |
| D7 | **Integer discipline.** Explicit `wrapping_*` or `checked_*` arithmetic where a value can leave its range: release builds wrap silently, debug builds panic. Counters that can pass 2³¹ say how they wrap | "It wrapped" against "it didn't" is a classic divergence, and here also debug against release | Review; property tests at the boundaries; overflow checks in `dev`, `test` and `ntest` builds | sim |
| D8 | **Checkpoints are complete,** including everything that orders future work: pool high-water marks and handle generations (§4.5; allocation is canonical lowest-free-slot, so no free list needs saving), the serial counter, RNG stream states, timers with their owners, the order of every order-relevant list, per-player state (input generations, creation rings, `lastSeq`, inventory versions, crafting queues, undo stacks), the blueprint store, **the set of generated chunks** and the chunks' rule versions (§4.4), each electric network's **satisfaction from the last tick** (phase 2 reads it before phase 4 recomputes it), and **pending worldgen requests** with their commit ticks. Derived state is rebuilt on load *in canonical order*. The digest lineage (r) is saved beside the state but not hashed (§4.8) | A joiner, a re-synced client and a resumed room must continue bit-identically. OpenTTD's first-listed desync cause is an incomplete savegame | D18(a); heavy mode D18(c); the save/load test compares full state for 10,000 ticks after load | sim |
| D9 | **Caches are pure.** A cache gives identical values whenever it is (re)computed, and is never filled as a side effect of a query or of extraction in a way that changes later results | Clients extract different views and run different queries | `&World` for every read path, with bookkeeping in `PresentationState` (§3.6); the continuation test: runs with different read schedules give identical per-tick digests and states (§10.4 #13) | sim |
| D10 | **No local player in the simulation.** The sim never branches on which player is "us"; events carry player indices and the client filters them | Each client has a different local player | Structural: the ABI has no such input (§15.8); the multi-client harness gives each world a different viewer (D18 f) | sim |
| D11 | **Rule-affecting personal settings are world state** (per player, set by actions): auto-sort inventory and "Pick ghost item if no items are available"; game settings such as trimmed collision are world state too. The smart-belt flag travels in the build action. The audit table is §7.6. Client-only settings may change *which actions are sent*, never how they execute | Otherwise one setting yields two results | The audit table (§7.6); R29 | sim, UI |
| D12 | **Worldgen stays pure and is committed at sim-determined ticks** (§5.18: commit at t + 30; a late chunk is generated inline). The worker-pool size never influences results | Clients have different core counts | Test: no pool, 1 worker and 4 workers give the same chunk hashes and the same world hash | sim |
| D13 | **Game time is ticks.** No wall clock in world state; play time and save timestamps go to save metadata outside the hash | Clients' clocks differ | clippy bans (`Instant::now`, `SystemTime::now`); the host import `host_now` is visible only to the profiling module, whose output never reaches state | sim |
| D14 | **One build per room.** Every client in a room runs the same build hash, which covers both WebAssembly modules, the protocol version, `prototypes.hash` and the schema hash (§2.3). The data stage's and the schema generator's outputs are byte-identical for identical inputs | Data or code differences are desyncs by definition | The relay compares them in `HELLO` (11 §3.2); `npm run check` runs the data stage twice and compares the bytes | schema, relay |
| D15 | **Outputs are outputs.** Events, packets and projections never feed back into the simulation. Events produced while catching up or replaying are marked historical and suppressed at the boundary (S15) | The UI differs per client | Of the module's imports only `host_now` returns a value, and only the profiling module sees it (§15.8, D13); the D9 test | sim, shell |
| D16 | **No ordering by identity.** Nothing is ordered by a pointer, an address, or the insertion order of objects whose history is not saved | Allocation history differs after load and between native and WebAssembly | D18(a) and (d): native and WebAssembly allocate at different addresses, so any address-dependent order shows up as a cross-engine mismatch | sim |
| D17 | **Strings never decide rules**, except as equality on data ids. Sorting, if ever needed, is by bytes, never by locale | Locales differ between players | Rust's `str` ordering is bytewise and `std` has no locale collation; a unit test pins the order of non-ASCII names | sim |
| D18 | **The tests that enforce the rest**, from M0, on every scenario and on fuzzed action sequences, comparing **full canonical state**, not only digests, and in short runs comparing the canonical state bytes after **every** tick (§10.4): (a) join equivalence; (b) NO_SLEEP equivalence; (c) heavy mode; (d) cross-engine traces, native against Node, Chrome and Firefox; (e) replay of every recorded session; (f) the multi-client harness; (g) wire and codec probes. §10.4 defines each | Rules without tests rot; sampled digests cannot catch every transient divergence | `cargo test` and `npm test` (a, b, e, f, g); `npm run test:slow` (c, d); `npm run ci` (a smoke of d) | sim, shell |
| D19 | **The Rust and WebAssembly rule set:** the arithmetic rules above; no random-state maps; no NaN in state (D6); never SIMD or relaxed SIMD; explicit wrapping (D7); no pointer-dependent logic (D16); no recursion beyond a constant bound (stack limits differ between native and WebAssembly); one thread; no `std::time` (D13). A panic aborts the module (§3.6) | WebAssembly is deterministic except where it explicitly is not, and native tests are only worth something if native and WebAssembly agree | `clippy.toml` (verified); the feature gate (§2.3); D18(d) | sim, schema |
| D20 | **Every new piece of state declares** whether it is saved or derived (and how it is rebuilt), whether its order matters, and its canonical order | The cheapest place to prevent D3 and D8 bugs is the line that adds the state | The schema requires the attributes, and the generator refuses a field without them (§15.1) | schema |
| D21 | **Per-player action order.** The sequencer assigns each player's actions nondecreasing ticks and keeps their send order within a tick (11 §3.4). The sim checks in every build that each batch's first seq is above the player's saved `last_seq` (a preflight rule, §15.3), so each player's `(tick, seq)` rises strictly | Otherwise a stop can run before the start it answers (A2-r1 2) | Relay unit tests (11 §9); the preflight; R27 | sim, relay |
| D22 | **Held inputs are fenced** by a per-player input generation: `release_inputs` raises it, and a held-input action carrying another generation is a no-op with an event (§15.3) | An action stamped before a release but scheduled after it must not undo the release (A2-r1 3) | R23 | sim |
| D23 | **Targets by identity.** Actions name existing entities by serial and just-predicted ones by creation id; the sim never falls back to "whatever stands there". Positions only for actions defined on positions (§15.3) | A position fallback acts on another player's replacement entity (A2-r1 12) | R24, R25 | sim |

### 4.2 Units and numeric types

| Quantity | Unit | Storage |
|---|---|---|
| Time | tick (1/60 s) | `u32` world tick (overflows after 828 days of play); `f64` where needed |
| Position (buildings) | tile; centres stored ×2 so odd and even footprints are integers | `i32` |
| Position (moving things) | tile | `f64` in the World; `i32` in 1/256 tile in actions and packets (§15.3, §15.4) |
| Belt item position and gaps | 1/256 tile ("positions") | `i16` slack per gap (negative while squeezed; a 32-tile line is 8,192 positions), `i32` totals |
| Direction | 16 directions (Factorio 2.0 `defines.direction`); most entities use 0/4/8/12 | `u8` |
| Orientation (rolling stock, agents) | turns | `f64` |
| Item count | items | `i32` |
| Fluid amount | units | `f64` |
| Energy | J | `f64` |
| Power | W, as J per tick × 60 | `f64` |
| Temperature (heat-pipe network; thermal field) | °C | `f64` |
| Research progress | units | `f64` (takeoff reaches ~10⁷ units/s: fine) |

### 4.3 Identifiers and RNG

**Prototype ids** are dense per kind, assigned by the data stage: `u16` for items, fluids, recipes, entities, technologies and virtual signals, `u8` for tiles (at most 255 tile types). Saves store name tables and remap on load (§8.3).

**Surface index:** fewer than 256 surfaces; `u8` in the entity table and event headers, `u16` in packet and request records.

**Item key** (`u16`) = `(itemIndex << 3) | quality`, where quality is the tier *index* 0–4 (H's tiers, Standard to Reference). The tier's *level* (0, 1, 2, 3, 5; ISO legendary = 5) is a separate lookup that scales stats (§5.16); "one tier higher" always means index + 1 (L5). That allows 8,192 items. Belts, slots, hands and filters all store item keys. Items of different quality never stack (ISO).

**Entity handle** (`u32`) = `(generation << 22) | slot`: 4M slots, with 1,024 generations to catch stale references. Handles never leave the module: packets, projections, actions and saves use serials.

**Entity serial** (`u32`): a never-reused creation counter, saved. It is used for RNG keys, undo records, stable references in saves, **and for every reference across the boundary**: actions (S5), events, projections and packets. A derived lookup table maps serial to handle: open addressing with a fixed hash and no iteration API, rebuilt on load (D3 d). One action's creations take consecutive serials (the counter advances only in creation order), which the creation ring relies on.

**Player index** (`u16`): 0 to 31 for players (a room holds at most 32, 11 §6.5); `0xFFFF` for system actions injected by the sequencer.

**Action id** = `(player, seq)`: `seq` is a `u32` that rises by one per action over a player's stay in a world, across reconnects and reloads (11 §3.3). The World keeps each player's `lastSeq`.

**Creation id** = `(seq, index)`: "the index-th entity created by this player's action seq". Each player's **creation ring** holds the last 256 actions that created entities, as `(seq u32, firstSerial u32, count u16)`; it is saved (D8). A creation id resolves to `firstSerial + index` when the entry exists and `index < count`, and fails otherwise (D23).

**RNG:**
- **The world seed** is a `u32` (07 §17's seed field).
- **The primitives** (B1-r1 18; all arithmetic on `u32`, wrapping; `rotl` is a left rotation):
  - `fmix32(h)`, Murmur3's finalizer: `h ^= h >> 16; h *= 0x85EBCA6B; h ^= h >> 13; h *= 0xC2B2AE35; h ^= h >> 16`.
  - `rand(a, b, c, d)`: `h = fmix32(seed ^ 0x2545F491); h = fmix32(h ^ a); h = fmix32((h + 0x9E3779B9) ^ b); h = fmix32((h + 0x7F4A7C15) ^ c); h = fmix32((h + 0x94D049BB) ^ d)`, returning h. The salts differ per position, so permuted keys give different draws. A draw becomes a probability as `h as f64 × 2⁻³²`.
  - `splitmix32(s)`: `s += 0x9E3779B9; z = s; z = (z ^ (z >> 16)) * 0x85EBCA6B; z = (z ^ (z >> 13)) * 0xC2B2AE35; return z ^ (z >> 16)`.
  - `xoshiro128**` as published by Blackman and Vigna: `result = rotl(s1 * 5, 7) * 9; t = s1 << 9; s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t; s3 = rotl(s3, 11)`.
  - Stream ids are the schema enum `RngStream` (worldgen regions, ambient noise, town names, decoratives, then the Wild purposes), and the fourth key of a per-event draw is the schema enum `RngPurpose`. The schema package's fixtures hold golden vectors for each primitive and the first 16 outputs of two streams for seeds 0, 1 and `0xDEADBEEF` (§15.10).
- **Streams:** `xoshiro128**`, whose four state words are four successive outputs of `splitmix32`, started from `rand(streamId, 0, 0, 0xFFFFFFFF)` (the purpose `0xFFFFFFFF` is reserved for seeding). Used where a sequence is natural: enemy AI (Wild), worldgen regions.
- **Counter-based:** `rand(a, b, c, d)`. Used for every per-event draw, so the result is independent of update order and of sleeping:
  - probabilistic recipe products (D's uranium 0.7%; A's experiment-media loop at 0.05/0.95 with catalyst returns): `rand(serial, craftCount, productIndex, 0) / 2³² < p`;
  - quality rolls: `rand(serial, craftCount, productIndex, 1)`;
  - the selector combinator's random mode: `rand(serial, tick, 0, 2)`;
  - Wild unit and expansion choices that Factorio randomises: `rand(nestSerial, tick, purpose, 3)`.

  Tree leaf loss from heat needs no randomness: a per-chunk accumulator drops one stage per tree per 600 s spent above 45 °C (§5.9, U11).

**Catalysts.** Products with a `catalyst` amount are excluded from productivity bonuses, as in Factorio 2.0 (`ignored_by_productivity`). They also carry `affected_by_quality: false` (Factorio's per-product flag, 2.1.7; L5): the catalyst returns at its ingredient's quality, and only the non-catalyst remainder rolls (§5.16). Kovarex-shaped recipes (checkpoint copies, controllers, Researchers, Ratings, Meta-analysis) therefore behave correctly under modules: copying returns the original unchanged (B L6).

### 4.4 World, surfaces, chunks and spatial queries

```
World { tick, seed, mapSettings, gameSettings, surfaces[], force (single), research, bonuses, globals (below),
        stats, players[] (PlayerState, by player index), timers, rng, serialCounter, worldgenPending, systems… }
Surface { id, chunks (ordered by chunk key), thermal params (ambient model, vacuum?), electric/fluid/rail graphs… }
Chunk  { cx, cy, tiles: [u8; 1024], resources: sparse (tile → proto, amount u32), trees: sparse list
         (tree → species, leaf stage 0–4), world objects: sparse list (rocks, campus, landmarks, salvage pieces),
         decor seed, ambientTheta, sunlight, kappa, H (heat MJ), leafTimer (s above 45 °C), charted/visible
         counters, entity list (growable, ascending slot), occupancy: [u32; 1024] or none (entity slot per tile,
         object layer), rule version (saved), view versions (derived, §15.4), pristine flag }
```

**Players** (S1). `World.players` replaces round 5's single `player`, indexed by the `u16` player index; every action carries its acting player (§15.3). Single player is player 0. A `PlayerState` holds (A2 §3.7):

| Per player, in the World (saved, hashed) | Per force, in the World (one force) | Per client, never in the World |
|---|---|---|
| Player index and online flag; the character's serial (0 = none) | Research queue, progress, levels, the scheduling toggle | Camera, zoom, map view, alt-mode, overlays |
| Main inventory, hand (cursor stack), origin-slot marker, trash (later) | Bonuses (reach, mining, crafting speed, …) | Open windows, hovered and selected entity |
| Quickbar pages | Production, electric and pollution statistics (shared, 07 §11) | Keybindings, Interface, Graphics and Sound settings |
| Crafting queue with reservations (I §3.9) | Charted chunks, map tags (ISO: tags per force) | The latency state (11 §3.5) |
| Mining, walking and picking state; drag-build state (`drag_id`) | Alerts' sources (each client filters and displays them) | Chat history; other players' cursors and selections |
| Undo and redo stacks (§5.2: sim-side, per player) | World text, heat, the leak, runaways: global as before | Run history and achievement records (07 §19.2: per browser) |
| **Input generation** (`u16`, D22), **`lastSeq`** (`u32`), and the **creation ring** (§4.3) | | |
| Entity-settings clipboard (the source's serial; Factorio pastes from the source entity, which must still exist) | | |
| Blueprint and planner records in the hand; pins (I §4.11: per player, saved) | | |
| Rule-affecting personal settings (D11, §7.6): auto-sort inventory, "Pick ghost item if no items are available" | | |
| Per-player accumulators: hand-crafted count, last-action tick (08 §8.5 "Last action by you"), achievement progress for per-player conditions (§5.20) | | |

- **Names and colours** are not world state. They live in the room roster at the relay and in the save header, outside the hash, so that re-hosting a save restores them.
- **Selection** is client UI state; other players' selections travel as presence (11 §8.3).
- **Permissions are trusted**: every player may do everything in the world, and nothing is checked per player in the simulation. Admin operations (kick, pause, room settings) belong to the relay.

**Global simulation state** (`World.globals`; saved whole in the `GLOBALS` section, §8.1):
- the world's text: W split into W_own and W_pub, Y_pub, the queue of pending publication releases, Σ, σ, j, the race state (§5.11);
- the leak L and every deploying building's share ℓᵢ, plus the infections and their timers' owners (§5.17);
- research: queue, per-technology progress and levels, the scheduling toggle, Literature and Your-year inputs (§5.12);
- the closure tick and the overhang snapshot, milestone times, achievement progress, the doubling-time ring (R̄ and its running maximum R̂) and history string, the run-report accumulators (§5.20).

**Surfaces from day one.** The base game uses one surface. The expansion (spec/06: orbit, the Stacks, Mercury, an outer moon) adds more without engine surgery. Every position carries a surface index.

**Chunks** are 32×32 tiles. The key is `(cx + 2¹⁵) × 2¹⁶ + (cy + 2¹⁵)`, which covers ±1,048,576 tiles, Factorio's map size. Chunks are kept in an ordered map by key, so every walk over chunks is canonical (D3 d).

**Tiles** (B3; 01 §2.1) are design data: `tiles.yaml` gives each tile id its κ, `buildable`, `walking_speed` (null: not walkable), `map_color`, `placed_by`, `minable_back` and biome.
- The data stage assigns dense `u8` ids. A chunk's κ is the mean of its 1,024 tiles' κ plus its trees' contribution (§5.9); it is recomputed when a tile or a tree changes.
- **Placed tiles** (concrete, refined and hazard concrete, landfill) come from items with `places_tile`. A tile with `placed_on` (landfill: water and deep water) may be placed only there (ISO). Picking up a placed tile restores the tile underneath, which the chunk keeps in a sparse "hidden tile" map (ISO).
- **Town tiles** (a street tile and a building-block tile, flagged `town`) are never buildable. Streets are walkable and drivable; building blocks block the player and vehicles (01 §5.3).
- **The out-of-map tile** fills chunks outside the map bounds (§5.18). Nothing may be built, walked or driven there.

**World objects** (J9; 01 §2.2) are design data in `world.yaml`: trees, rocks, the campus and landmarks (the exchange office, the mine entrance), each with its kind, size, mining time, yields and flags (`cosmetic`, `collides`, `selectable`). They are not entities: they have no pool and no update, sit in the chunk's sparse lists, and are found by the spatial queries below.
- Hand-mining a tree or rock yields its `yields`. Ranges are drawn with counter RNG keyed by the object's position (§4.3).
- The campus and landmarks are not minable. The campus opens the University window.
- Town buildings are not objects: they are building-block tiles (above), drawn as era-skinned buildings (§6.5). The **salvage** is not in `world.yaml`: its single definition is `meta.start.salvage` (DECISIONS §33; §5.18).

**Pristine chunks** (generated and never modified: no build, no mining, no tile change, no tree removed or stripped of a leaf stage, no ground item) are not saved. **Which chunks exist is saved**: the hashed `GENERATED` section lists every generated chunk key per surface (§8.1), because heat flows into generated chunks and to the Map edge past ungenerated ones, and agents skip ungenerated chunks (D8). A pristine chunk's content (tiles, resources, trees, objects) is a pure function of the seed, so the sim regenerates it **lazily**, inline, the first time a rule or an extraction needs it. Regeneration is a pure cache (D9) and never changes state; a load therefore costs nothing per pristine chunk, and only the chunks a rule touches, the characters' surroundings first, are rebuilt (§11). Their charted bits and nonzero heat are saved separately (§8.1). This keeps an "endless" map affordable in both memory and saves.
- **Cheap metadata stays** (B1-r1 16). Each `GENERATED` entry keeps the chunk's κ, θ and sunlight (three `f64`), so the thermal field, solar output and the climate never force a regeneration; only rules that need tiles, resources or objects do (placement, collision, mining, drills, the view).
- **Regeneration is bounded** (B1-r1 16). A rule that needs a pristine chunk regenerates it on the spot (a build, a mining action). Otherwise the tick keeps each character's surroundings regenerated, nearest first and at most 8 chunks per tick, so after a load the held set around a character is back within a few ticks. Extraction cannot write the World: a pristine chunk that the view needs and the tick has not regenerated (the map view, a remote camera) is generated into a bounded cache in `PresentationState`, at most 8 chunks per packet, nearest the view's centre first; the rest follow in later packets. Chart images of pristine chunks never pass through the sim (§5.19).
- **The rules that generated it are pinned** (B1-r1 7). `GLOBALS` records the **worldgen version** (`u32`, raised by hand whenever any chunk's output could change) and the hash of the worldgen-relevant tables of `prototypes.bin` (tiles, resources, autoplace, world objects). A build whose pair differs cannot regenerate the save's pristine chunks faithfully, so it refuses the save with an explicit error naming both, unless the save was first **baked** by a build with the save's own pair: baking (a save option, and the first step of a sealed upgrade, 11 §6.3) writes every pristine chunk into the save's `CHUNKS` as if modified, without changing the running world, and the baked save starts a new digest lineage (§4.8). CI pins golden chunk hashes per worldgen version, so a change to generation without a version bump fails the build.

**Versions.** Each chunk keeps a saved **rule version** (`u32`), raised whenever its entities, ghosts, tiles or resources change; the only rule that reads it is the Area scanner's (§5.2). The view versions of §15.4 are derived presentation counters and never read by a rule.

**Spatial queries** (`entities_in_area`, `entity_at`, collision tests):
- per-chunk entity lists;
- a per-tile occupancy grid for object-layer buildings (O(1) for hover and placement);
- sparse lists for trees, rocks and other world objects, cliffs, rails (which overlap at crossings) and ground items.

**Collision layers** (Factorio-style masks): object, water, resource, rail, player, train, item. Each prototype gets a mask from the data stage; each tile gets one from `buildable` and `walking_speed`.

**The player-collision box** is separate. It holds the ISO collision box by default and never affects building.

**Trimmed collision** (A §10, 07-ui §16; a game setting stored in the save, default on, changed by an action, D11). 07-ui assigns the per-type trims to this document:
- The rule: the character's box is the ISO collision box intersected with the footprint **inset by 0.25 tiles on every side**.
- The character is Factorio's 0.4 tiles wide (±0.2). Two buildings placed edge to edge then leave at least 0.5 tiles, so it fits: solar fields, furnace and assembler rows, boiler and steam-engine banks, pipe runs.
- **Exempt** (they keep their ISO boxes): chests, walls and gates, rocks, trees and cliffs. Belts never block the character anyway.
- The data stage derives the trimmed boxes, so no per-entity table is needed.

### 4.5 Entity storage

All of it is generated from `schema/state.yaml` (§15.1): the Rust structs and their allocation, saving, loading and hashing, the TypeScript read views, and the save sections. Hand-written code implements behaviour and the rebuild functions of derived fields.

**Entity table:** struct-of-arrays, one row per entity, about 40 bytes.

```
proto: EntityProto(u16)  kind: u8  surface: u8  dir: Direction(u8)  flip: u8
x2: i32   y2: i32   chunk: u32   pool_slot: u32
flags: EntityFlags(u32)  // ghost, deconstruct, upgrade, compromised (locks the entity, §5.17), indestructible …
serial: Serial(u32)      gen: u16      quality: u8
built_tick: Tick(u32)    built_by: u8  // 0 unknown, 1 agent, 2 Constructor, 16 + i = player i (S1); for the
                                       // age/builder overlay (07-ui §3.1), achievements 16–17 and 08-text §6, §8.5
```

**System pools:** one per entity *type* family, holding only that system's hot fields as columns (`Vec<T>` per field), grown by capacity doubling. Slots are allocated **lowest free slot first** (a free-slot bitset derived from the live slots), so allocation is canonical and needs no saved free list (D8). Each pool's **high-water mark** (the number of slots ever used) is saved, and saving writes exactly that many rows. A freed slot's columns are reset to their defaults, except the entity table's handle generation, which survives so that stale handles stay detectable; so pool bytes are canonical too. Examples (schema notation: `field: type`, with *derived* fields marked):

```
CraftingPool { entity: EntityHandle, recipe: RecipeId, progress: f64, prod_bar: f64,
               speed_eff: f32 (derived: product of all multipliers but electric satisfaction, §5.5),
               energy_buf: f64, inv: u32 (slot-heap block: size class << 24 | block index), status: Status(u8), crafts: u32 (wrapping),
               anim: f32 (presentation: animation phase for extraction; derived, unsaved, unhashed) }
InserterPool { entity: EntityHandle, state: u8, theta: f64, ext: f64, held: ItemKey, held_n: u8,
               src: u32, dst: u32, src_pos: i32, dst_pos: i32 (derived: the resolved pickup and drop targets,
               which may name a transport line, §5.4), energy_buf: f64, stack_cap: u8 }
TransportLinePool (§5.3), ElectricNet arrays (§5.7), FluidSegment arrays (§5.8), AgentPool (§5.14) …
```

Each pool also carries derived scheduling columns: the `active` bitset and a `wake_seq: u32` per slot (§4.6).

**Saves hold serials, never handles** (B1-r1 6). A saved field of type `EntityHandle` is written as the referenced entity's serial (`u32`, 0 = none), and loading runs in two passes: the entity table first, which rebuilds the serial index and each slot's handle generation, then every other section, translating serials back into handles. Handles are runtime-only, as §4.3 says, and a save's bytes do not depend on which slots were reused how often.

- **Inventories** live in a **slot heap** (`Slot = {key: ItemKey, count: i32}`) made of one arena per size class (powers of two up to 128 slots, then multiples of 64). An inventory owns one block of its class, named by `(class, block index)`; allocation takes the **lowest free block** of the class, and a block is free exactly when no live inventory owns it, so the free state is a function of the live inventories and each arena's saved high-water mark. Freed blocks are zeroed. Filters, the limit bar and the hand-marker slot are parallel sparse arrays.
  - Inventories are typed, and each type has its own acceptance rule: input, output, fuel, modules (ISO), **staff** (a Seminar's single slot: a Researcher only, never filled by inserters; 07 §6.2), **accelerators** (a Research hall's 20 single-item slots), **weights** (its single frontier-checkpoint slot), and the hidden **rollback input** (one slot that exists only while the entity is compromised; §5.17).
  - The rules live in one table, `acceptance(inventoryType, entity, itemKey, actor)`, shared by hand transfer, fast transfer, inserters and agent item requests. A refusal returns the reason code the UI shows (§15.6).
- **Cold data** goes in ordered maps keyed by serial (`BTreeMap<Serial, Record>`), one per record type in the schema, saved as binary records in ascending serial: labels, circuit conditions, combinator settings, train schedules and interrupts, display-panel messages, logistic request sections, blueprint records.
- **Low-count, graph-shaped state is ordinary Rust structs**: networks (electric, fluid segment, circuit, logistic, rail blocks), trains, research, the players, the world-text scalars. Their topology is derived and rebuilt in canonical order (§8.1).

**Why this shape.**
- Hot loops read contiguous columns.
- There is no per-entity heap object and no garbage.
- Saving is a column copy, and the hash runs over the same bytes.
- The TypeScript views read the same columns, in the sim worker only (§3.6), for debugging and `__game.inspect`.

### 4.6 Update scheduling

**Phase order per tick** (fixed; part of the determinism contract):

| # | Phase | Contents |
|---|---|---|
| 1 | Input | Apply the tick's closure (D2): its batches in closure order, each batch's actions in seq order (§15.3). Validate each action and emit feedback events tagged `(player, seq)` (S10) |
| 2 | Timers | Pop the timer-wheel bucket: wake-ups, scheduled events (ghost expiry, chain-signal re-checks, agent arrivals, runaway spread per infection and escape per machine, §5.17; these read the previous tick's electric satisfaction, since phase 4 has not run yet) |
| 3 | Chunk commits | Worldgen results whose commit tick is now; a chunk whose data has not arrived is generated inline (§5.18) |
| 4 | Energy distribution | Electric networks fill consumer buffers by class: normal, accumulator charging, interruptible (§5.7). Energy drawn, and twice each generator's electrical output, go into chunk emission accumulators (§5.9). Zero-power counters of compromised machines advance. Heat-pipe networks conduct |
| 5 | Fluids | Boundary flows between fluid boxes and segments; pumps (§5.8) |
| 6 | Burners and converters | Fuel → energy buffers; boilers and heat exchangers → steam; reactors → heat |
| 7 | Crafting machines, furnaces, labs, drills | Progress, consumption, production (several crafts per tick allowed, FFF-402); research progress |
| 8 | Transport lines | Movement, line-to-line transfers, splitters, side-loading, in downstream-first rank (§5.3) |
| 9 | Inserters | Pickup and drop state machines |
| 10 | Agents | Agents in this tick's bucket; roboports; logistic and construction dispatch within budget |
| 11 | Trains | Movement, signals, reservations, schedules and interrupts |
| 12 | Circuit networks | Combinators read the previous tick's signals (1-tick latency, ISO); networks swap |
| 13 | Slow fields | In this order: the thermal bucket (`tick & 63`); on `tick % 60 == 0` staffing (§5.10), then world text (§5.11), then the leak with any compromise it causes (§5.17); every tick, the Monitors' clean cycles (§5.17, 03 §3.4); radar sectors |
| 14 | Units | Wild preset only |
| 15 | Statistics and achievements | Flush per-tick counters; condition checks every 60 ticks |
| 16 | Digest | The per-tick digest, this tick's slice hash and the rolling digest (§4.8) |

**Extraction is not a phase.** After the tick, the shell may call `sim_extract` (packets, events, subscriptions; §15.4–§15.6), which reads `&World` and never changes it (D1, D9). It is skipped while the page is hidden, during catch-up and when no packet buffer is free.

**Active sets** (A1 finding 1; IMPL-2).
- **Entity pools:** each system keeps an `active` bitset over its pool slots (one bit per slot in `u32` words) and iterates it in ascending slot order: take the lowest set bit of a word, update that entity, then re-read the word masked above that bit. An entity woken during its own phase therefore runs in this tick if its slot is higher than the cursor, and in the next tick otherwise. This is the loop A1 measured; it is O(active + words) per tick.
- **Swap-remove active lists are banned.** They reorder entities by the history of sleeps and wakes, which differs between a sleeping run and a NO_SLEEP run, and between a world and its reload. A1 measured divergence by tick 200 in three of four regimes, with different research totals at the end.
- **Derived pools** (transport lines, fluid segments, electric, circuit and logistic networks, rail blocks) are rebuilt on load, so their pool indices are not stable (D3 f). Wherever their processing order can change a result, they are processed in a **rank** derived from saved state, and their active bitset is indexed by rank. Transport lines: the downstream-first rank of §5.3. Networks: ascending lowest member serial.

**Sleep.**
- A system puts an entity to sleep only when a whole update would provably change nothing.
- The entity records a sleep reason and registers with the wake sources of that reason, **at most four** (B1-r1 17): for example an inserter waiting on a belt holds its source line's arrival timer, the target's *space* list and its network's power-restored list. All of them carry the entity's current wake sequence number, so the first to fire wakes it and makes the others stale:

| Sleeper | Sleeps when | Woken by |
|---|---|---|
| Inserter | The source has nothing it may take, or the target will not accept its hand | The source inventory's *added* watch list; the target's *space or need* watch list; the source line's arrival estimate (timer) or restart; power restored |
| Crafting machine, furnace | Missing ingredients; output full; no recipe; no power | Input insert; output removal; recipe set; network satisfaction > 0 |
| Lab (Seminar) | No research; missing packs; no staff and no Researcher | Research change; pack insert; staffing recompute giving staff > 0; Researcher insert |
| Research hall | Fewer than 20 accelerators; no weights; no Dataset; output full | Accelerator or weights insert; input insert; output removal |
| Compromised machine | Always: progress is frozen (§5.17) | Cleaning |
| Drill | Output blocked; area depleted | Target space; resource change |
| Transport line | Front blocked and fully compressed | The downstream line frees space at its entry; an item is inserted into or removed from the line |
| Burner, boiler | No fuel; output full | Fuel insert; output space |
| Roboport | No agent charging or queued (FFF-421: 1 ms → 0.025 ms) | An agent requests charging or stationing |
| Combinator | Input networks unchanged since the last evaluation | Network dirty flag |
| Fluid boundary | Segment and box both empty, or both full, with the machine idle | Segment level crossing a threshold; machine state change |
| Train | Waiting at a stop or signal | Wait-condition timer; signal or block state change |

**Wake rules** (A1 finding 2; NO_SLEEP equivalence held only with all of them):
1. **Waking only marks.** A wake-up sets the entity's active bit and does no work; the entity's own phase does the work (D3 b).
2. **Wake sequence numbers.** Each entity has a `wake_seq` (`u32`, wrapping) that increments every time it wakes. A watch-list or timer node records the sequence at registration; when the list fires, a node whose sequence differs from the entity's current one is stale and dropped.
   - **Reclamation** (B1-r1 17). Nodes live in one pool with a free list. A list that has not fired is compacted whenever its stale nodes outnumber its live ones, and a full sweep runs whenever the pool holds more than twice the live registrations, so retained nodes stay within twice the live ones. Destroying an entity drops its registrations in the same tick.
3. **Arrival timers are lower bounds.** An inserter sleeping for a belt item schedules a timer at the earliest tick the item can arrive (`distance ÷ speed`); on waking it re-checks and re-arms if the item is not there.
4. **Insertion into a line.** Inserting mid-line wakes the line's timer-holding waiters (their estimates may now be early). Inserting at the back wakes only waiters that have no item upstream of their pickup point.
5. **Dropping onto a belt.** An inserter dropping onto a moving belt polls each tick; dropping onto a stalled belt, it waits for the line to restart.
6. **A partially filled hand keeps polling.** An inserter gathering a stack from a belt does not sleep between items.

**The invariant is NO_SLEEP equivalence.** A test flag updates every entity every tick and bypasses all wake logic. Every scenario test must produce bit-identical per-tick digests and full states with and without it (D18 b). So sleeping is a pure optimization, never a rule. Update *cadences* that are rules stay the same in both modes: agents every 20 ticks, the thermal field every 64. Active bits and wake registrations are derived and unsaved: after a load every entity starts awake and goes back to sleep within a tick, which NO_SLEEP equivalence makes harmless.

**Timers.**
- A 4,096-bucket timer wheel (one bucket per tick, modulo 4,096).
- A binary heap for longer delays: ghost expiry after one week is 36,288,000 ticks.
- Entries are `(dueTick, serial, eventCode, owner, wakeSeq)` at runtime. Timers name entities by **serial**, which is never reused, and resolve it through the serial index when they fire; a timer whose entity is gone is dropped. Handles are not used, because a 10-bit handle generation repeats after 1,024 reuses of a slot while a long timer may survive (B1-r1 17). `owner` (`u32`) is 0 for entity timers; timers owned by no entity use serial 0 and name their owner there (an infection's id, which is its first member's serial; a publication release's index). Stale wake timers are dropped on sequence mismatch.
- **Same-tick rules.** A timer is due no earlier than the next tick: a delay of 0 means 1. A wake-up during a tick marks the entity active; whether it runs in this tick or the next follows the bitset rule above (D3 b).
- **Fire order** (D3 c): timers that only wake entities fire in any order, because waking only sets bits; timers that do work (ghost expiry, spread, escape, agent arrival, releases) fire in `(dueTick, serial, eventCode, owner)` order, which is total, sorted within the bucket.
- Saves store `(dueTick, entitySerial, eventCode, owner)` for timers that do work, in that order (§8.1). Wake timers are derived and not saved.

**Bucketed systems:**
- the thermal field: 1/64 of chunks per tick, Factorio's pollution cadence;
- moving agents every 20 ticks, stationary every 60 (FFF-421), spread by `serial % 20`;
- radar sector scans;
- staffing and world scalars every 60 ticks.

### 4.7 Per-tick cost model (reference machine; §11 defines it)

**Measured** by A1 in WebAssembly, Chrome 156, on this host at its base clock, at Late scale in the "busy" regime, per active entity per tick: transport lines 28 ns, inserters 72 ns, crafting machines 22 ns, electric consumers 8.5 ns per consumer (two passes, all consumers). Firefox is 11–19% slower, Node equal, native 1.15–1.34× faster.

**Projected cost on the reference machine** = host ÷ 2.4 (§11). On the 2022 target machine, divide by about 1.4 more. Rows marked *est.* are not measured yet and keep round 4's TypeScript-era estimates unchanged: A1-r1 warns that the kernel's speed-up need not carry over to other systems, so the table does not assume it.

| System (late-game base, §11) | Count | Updated per tick | Cost each (reference) | ms/tick |
|---|---|---|---|---|
| Transport lines (60k belt tiles → ~8k lines, 32-tile cap) | 8k | 25–46% moving (A1 typical–busy) | 12 ns, transfers included (measured) | 0.04 |
| Inserters | 25k | 20–39% active | 30 ns, pickups and drops included (measured) | 0.3 |
| Crafting machines, furnaces, labs, drills | 13k | 65–99% | 9 ns, completions included (measured) | 0.12 |
| Electric consumers (2 passes) | 50k | all | 3.5 ns (measured) | 0.18 |
| Fluid boundaries | 4k | ~70% | 30 ns (est.) | 0.1 |
| Heat-pipe network | 500 | all | 30 ns (est.) | 0.02 |
| Thermal field | 64 chunks per tick | — | 100 ns (est.) | <0.01 |
| Staffing, world text, leak | every 60 ticks | — | O(Seminars + universities + Terminals) | <0.01 |
| Runaways (*Contained*) | per infection timer | a few nearest-machine queries per second | O(cluster) | <0.05 |
| Agents | 5k | 1/20 moving, 1/60 idle | 1 µs per update (est.) | 0.3 |
| Logistic and construction dispatch | ~100 tasks per tick | — | 2 µs (est.) | 0.2 |
| Trains | 100 | ~60 moving | 2 µs; pathfinding amortised 0.1 ms (est.) | 0.2 |
| Circuit network | 2k combinators | ~30% dirty | 300 ns (est.) | 0.2 |
| Statistics, achievements, digest | — | — | — | 0.05 |
| Extraction (outside the tick) | 25k visible sprites + 60k belt items at 0.3× | per frame | 8 ns per sprite (19 ns on the host, A1); belt items as gap arrays cost a copy (§15.4) | 0.25 |
| **Total** | | | | **≈ 2.0 ms** of a 12 ms budget (≈ 1.8 ms without extraction); Firefox about 15% more |

A1's own projection for the full simulation at Late on the reference machine is 1.4 ms (its four measured systems at 37% of the total); this table is more conservative. The 12 ms budget therefore leaves room for real code being slower than a study kernel, for catch-up (11 §4.4 needs a joiner to run at several times game speed) and for Firefox. The slice costs about 0.1–0.3 ms per tick and is effectively free.

**Spikes.** Four events are bursty rather than steady, and each has a budget of its own:
- **Effect bursts** (balance m10). After the capstone, Π ≈ 10⁶, and an infinite technology can complete 13–20 levels within seconds. Research effects are therefore coalesced per tick and per effect type (§5.12), so 6,000 affected machines cost one `speed_eff` recompute each: ≤ 2 ms in the worst tick.
- **Autosave**: the section copy, ≤ 100 ms (§8.4, §11).
- **The first ticks after a load**: 3–6 ms for the first tick and about 2.4 ms on average for ticks 2–10 at Late on the host, settling within about 100 ticks (A1; TypeScript took 11–13 ms).
- **First use of a code path.** WebAssembly is still compiled in tiers (V8 compiles a baseline first and optimises hot functions later), so a path first taken hours into a game can run slower once; what WebAssembly removes is speculative deoptimisation, not compilation (A1-r1). `compileStreaming` at load and the benchmark saves' warm-up keep this out of the steady state.

Host-only effects are not budgeted: on this two-socket server, NUMA page migration causes rare worst ticks of 4–6 ms at Late and 17–21 ms at the 400k stretch in every language (A1 §3).

### 4.8 The state hash and digests

**The full state hash** is XXH64 (seed 0) over the canonical bytes of every hashed section of a save (§8.1), in ascending section id, each prefixed by its id and raw length (`u32` each). It covers exactly the saved state: not the header, the thumbnail, the closure log or the digest lineage. XXH64 is implemented in `sim` (about 100 lines, checked against the reference test vectors), so native and WebAssembly agree. `__game.hash()` and `simtool hash` print it in hexadecimal. Tests compare it (§10.4); two worlds with equal hashes are equal for every purpose of this document, and the D18 tests also compare the sections byte for byte when a hash differs, to name the first differing field.

**Digests** (S7; A2 §5.1; A2-r1 5) are computed by the sim in phase 16 of every tick, in single player too, where replays and bug bundles use them:
1. **Per-tick digest** `d_t` (`u64`): XXH64 (seed 0) of the schema record `tick_digest`, packed little-endian in this order (B1-r1 8): `u32 tick`; `u64 closure_hash`, the XXH64 of the closure's bytes as applied (an empty closure hashes zero bytes); every RNG stream's four state words, in `RngStream` order; `u32 entity_count`; this tick's nonzero production and consumption counters as `(u32 key, f64 value)` pairs in ascending key, preceded by their `u32` count; for each online player in index order, `u16 index`, the character's position as two `f64`, and the player's saved **inventory version** (a `u32` in `PLAYERS`, raised on every change to the main inventory or the hand); the current research's `u16` technology and `f64` progress; and the `GLOBALS` fields that the schema marks `digest: tick` (the global scalars of §5.11, L, and the tick at which the loop closed). Cost: about a microsecond.
2. **Slice hash, chosen by key.** Every tick also hashes about 1/3,600 of the state. A generated **shard map** assigns every byte of every saved section to exactly one of 3,600 shards, and slice t is the XXH64 of shard `t mod 3,600`'s members, in (section id, key) order and canonical bytes, with NaN mapped to one bit pattern (D6):
   - per entity (its entity-table row, its pool rows, its slot-heap blocks, its cold records, its work timers): shard = serial mod 3,600, from a derived index of 3,600 buckets kept in ascending serial;
   - per chunk (`CHUNKS`, `CHARTED`, `THERMAL`, `GENERATED`, `WORLDGEN_PENDING` entries): shard = chunk key mod 3,600;
   - per network (`NETWORKS` contents): shard = the network's key, its lowest member serial, mod 3,600;
   - per player (`PLAYERS`, `UNDO`): shard = (1,800 + 97 × index) mod 3,600;
   - keyed global records (`STATS` by item key, `RESEARCH` by technology, `BLUEPRINTS` by record id): shard = key mod 3,600;
   - the remaining global records (`GLOBALS`, `RNG`, the pools' high-water marks): each in 4-KiB pieces, each piece at its own residue fixed in `sections.yaml`, so no tick hashes more than a few kilobytes of globals.

   The generator refuses a saved section without a shard rule, and a test checks that the 3,600 shards together are exactly the canonical state. The schedule is a pure function of the tick and the current state, so there is no cursor to save, and everything that exists for a whole cycle is checked once a minute. For 100 MB of state that is about 28 kB per tick, a few microseconds in WebAssembly. Sampling cannot catch every *transient* divergence (an entity that diverges and is destroyed before its slice comes round), which is why D18's tests compare full state.
3. **Rolling digest** `r_t = XXH64(r_{t−1} ‖ d_t ‖ slice_t)` over the three values as little-endian `u64` (24 bytes, seed 0). A divergence anywhere stays visible in every later r. A new world starts from `r_0 = XXH64(u32 worldSeed ‖ u32 0)`.
4. **Lineage.** Because r depends on history, a world loaded from identical state cannot reconstruct it. Every save and checkpoint therefore carries its **digest lineage**, r at its tick, in the header beside the state but outside the hash (§8.1), and `sim_load` takes it back, so a joiner's or a re-synced client's digests continue the room's sequence (S7, S9). A load that remaps prototypes or migrates (§8.3) and a baked save (§4.4) start a new lineage, `r = XXH64(u64 stateHash ‖ u32 tick)` over the resulting state, because the old r describes another state (B1-r1 7). Digest *epochs* are not world state: the relay assigns them and the net worker attaches them to its reports (11 §5.1).
5. **Per-phase digests** in builds with `simcheck` (§2.3): a digest after each of the 16 phases, to name the system in which two runs first differ (`simtool bisect`, 11 §5.3).
6. **The digest ring**: the last 36,000 per-tick digests (288 kB), kept by the shell for bug bundles (§8.5) and desync reports (11 §5.3).

Multiplayer reports r every 30 ticks and votes on it (11 §5.1).

---

## 5. Systems

Each subsection gives the data structures, the algorithm, the update cadence and the per-tick cost. Numbers marked ISO are Factorio 2.0 values. Where the design owns the number, the subsection names the spec that does.

### 5.1 The character, inventories, the hand and the crafting queue

**Players and characters** (S1). Each player in `World.players` (§4.4) has one character, created by the system action `player_joined` (§15.3). Everything in this section applies per player, and the simulation never singles out a local player (D10).

**Movement.**
- The character has a position (`f64` tiles) and walks in 8 directions at 0.15 tiles per tick × bonuses (ISO, I §2.1).
- Collision uses the player-collision boxes (§4.4). Belts carry the character (ISO).

**State.**
- **Inventories:** the main inventory (80 slots plus bonus rows, auto-sorted by group, subgroup and order while the player's auto-sort setting is on, D11), the cursor stack ("hand"), and the origin-slot marker.
- **Quickbar:** 10 pages × 10 links, saved in the game.
- **Reach constants** (I §3.1): reach 10, build 10, resource 2.7, pickup 1.

**Hand crafting** is sim-side and exactly as I §3.9 specifies:
- chain crafting, depth-first;
- reservation at enqueue time;
- surplus shared within one request;
- merged queue entries and cascade refunds;
- a pause when the product does not fit.

**Mining by hand.** Progress = 0.5 × (1 + bonuses) ÷ `mining_time`. Mining is refused when the inventory is full (2.0.67: nothing drops).
- Targets: resource tiles, world objects (trees, rocks; `world.yaml`, §4.4), the salvage's wreck pieces and crate (`meta.start.salvage`: each piece yields `per_piece`, the crate yields `crate`, at the salvage's `mining_time`), and the player's own entities.
- **Archive keypunching by hand** (B L14, "hand-digitize") is ordinary resource mining of an Archive tile.
- **Fluid-requiring resources** (uranium ore) can be mined by hand without the fluid (ISO; U56). Drills need the fluid (§5.6).
- The campus, landmarks and town tiles are not minable; neither is a compromised entity (§5.17).

**Targets by identity** (S5, D23). Every action that names an entity (mine, rotate, open, transfer, paste settings) names it by serial or by creation id and resolves it that way (§15.3), never by position; a missing target fails the action with "target gone".

**Offline characters** (A2 §3.7; this section states the rule). When a player leaves (`player_left`), the character stays in the world with its inventories:
- it neither walks, mines nor crafts: its held inputs are released (D22), and its crafting queue pauses, keeping its reservations, until the player returns;
- its hand returns to the main inventory if it fits, and otherwise stays in the hand;
- a returning player gets the same character back (11 §4.5). R26 tests this.

**Scratch functions** (S10). Movement, collision and placement checks are pure functions over `&World` and a scratch character, so multiplayer's latency state (11 §3.5) can run them without touching the World.

**Cost:** one character per player, O(1) per tick.

### 5.2 Construction: building, mining, ghosts, fast-replace, undo, blueprints and the Constructor

**`build`.** Placement rules are data-driven:
- collision masks (§4.4), including the tile's `buildable` flag: water, town tiles and out-of-map tiles refuse ordinary buildings;
- the entity's `placement` block (R3-implementability §9, gap 5): `must_be_on: exchange` (Crawler, Endpoint: the footprint's centre tile holds an exchange tap, and the tap holds no other building), `must_touch: [water, deep-water]` (offshore pump, Water exchanger: auto-oriented so that the overlay's pumping position lies on a water or deep-water tile, U9); drills need a resource under their mining area (ISO);
- the town footprint: unbuildable and indestructible (B L3). **Under towns** (U52): underground belts, pipes-to-ground and underground data lines may tunnel under town tiles, because only their two ends occupy tiles (ISO tunnel rule); power and circuit wires may span a town;
- rails and cliffs.

Failure returns a reason string from I §3.3, or the design's own (`text.yaml`).

**Fast-replace** works by `fast_replaceable_group` (I §3.3). It keeps contents, settings and wires, changes direction if the held direction differs, and returns the old item.

**Compromised entities are locked** (L3; §5.17). Mining, deconstruction, fast-replace, upgrade, and removing modules, a Researcher, accelerators or weights are all refused with the flying text "Compromised. Cut its power." (08-text §8.3). Deconstruction and upgrade marks may still be placed: agents skip the entity until it is clean, then carry out the order.

**Ghosts** are entities with `flags.ghost`, an inner prototype and a settings blob.
- Tile ghosts are separate.
- Placing the real item onto a ghost builds it with the ghost's settings.
- Ghosts of destroyed entities expire after a week (timer heap).

**Deconstruction and upgrade marks** are entity flags plus an order record.

**Undo/redo** is sim-side, per player, as I §3.11 describes:
- One undo record per action, or per drag (`drag_id`).
- Records hold inverse operations. Undone removals become ghosts (ISO).
- Rotation spam is merged per entity per 2 s.

**Blueprints.**
- A **blueprint record** is canonical data: entities with relative positions, direction, quality and settings, plus tiles, wires and parameters (2.0 parametrisation, later).
- Records live in a sim-side store, so blueprint *items* can sit in chests (the Constructor needs this).
- The library ("My blueprints", shared across saves) lives in IndexedDB outside the sim. Placing a library blueprint sends its record inside the `place_blueprint` action: inline up to 65,531 bytes, as a blob above that (§15.3).
- `place_blueprint(record, pos, dir, flip, mode)` is the one code path for the player, the paste tool and the Constructor.

**The Constructor** (`deployer`; DECISIONS §19: the name for 04 §2.5's blueprint-placing building, finale-gated; A §3.3; unlocked after closure by *Self-reproducing automata*). An entity holding a blueprint or blueprint book and driven by circuit signals. Its commands (the data's `extra.circuit`):
- place blueprint N at offset (X, Y) with rotation R, as ghosts for construction agents (the `place_blueprint` path);
- deconstruct or upgrade an area (deconstruction and upgrade orders);
- copy a blueprint.

**The Area scanner** (`area-scanner`, a separate combinator-type entity unlocked by the same technology; N18) reports the resources, entities and ghosts in a rectangle set by signals, as signals: a read-only spatial query, evaluated when its input signals change and when the rule version of any chunk in its rectangle changes (a saved counter, §4.4; R5-gate D12e).

**Signal tables** (R5-gate D12e). The Constructor's commands and the Area scanner's inputs and outputs follow the Recursive Blueprints mod's tables (its deployer chest and its scanner), with Factorio's item and virtual signals mapped to ours through `mirrors` (the data's `extra.signals`). A veteran's circuit programs for the mod therefore carry over.

The Constructor is not a computing machine (its recipe holds no accelerator), so it neither throttles nor can be compromised (coherence M8, settled in the data). Nothing in the blueprint system special-cases the player, so the pair costs about 500 lines when it arrives (M4).

**Optional: Factorio blueprint import.** The 2.0 string format is version byte `0` + base64(zlib(JSON)). Every entity and recipe has a `mirrors` id, so a veteran's own Factorio 2.0 blueprints can be imported by translating names through `mirrors`. Cost is about 1 agent-day. Flagged in §14.

**Cost:** event-driven, with no per-tick cost except ghost bookkeeping on timers.

### 5.3 Belts: transport lines (FFF-176, wiki *Transport belts/Physics*)

**Geometry (ISO).**
- Positions are 1/256 tile.
- **Speed:** 8 / 16 / 24 positions per tick for yellow, fast and express (15, 30 and 45 items/s; 7.5, 15 and 22.5 per lane).
- **Saturated spacing:** 64 positions, i.e. 4 items per lane per straight tile.
- **Lane lengths:**
  - straight: 256;
  - curve inner: 106;
  - curve outer: 295;
  - underground entity: 256;
  - splitter input: 128 + 51 internal buffer;
  - splitter output: 128;
  - side-load points: 68 (late) and 188 (early) positions.
- **Calibration targets** (wiki): an underground pair across a gap of 4 holds 44 items; an express pair at maximum gap holds 72.

**Transport lines.**
- A line is a maximal chain of lane segments of the same speed with no splitter in between, **capped at 32 tiles** (configurable). The cap splits a chain canonically, counting from its downstream end, so incremental and rebuilt lines agree (§10.4 #10). A closed loop of belts has no downstream end: its chain starts at the loop's belt with the lowest serial, whose lane ends there, and the split counts from that point.
  - FFF-176 (0.16) planned lines of about 9 tiles near inserters and side-loads, and up to about 100 tiles elsewhere, with dynamic merging and splitting.
  - Our single cap keeps the worst-case position scan per pickup at 128 items (~0.3 µs) without any dynamic re-splitting.
- Each lane of a belt is in a different line. Curves therefore need no special case.
- An underground pair is one line running entrance, tunnel, exit.
- Side-loading never splits the target line. The source line's `next` points at `(targetLine, offset, lane)`.

**Data per line:**

```
// items are a ring buffer, front (downstream) → back; the whole line record is derived except its contents
key: ring of ItemKey   gap: ring of i16   // gap[0] = front slack to the line end; gap[i] = slack between item i−1 and i
len: i32 (positions)   back_slack: i32   count: i32   head: u32   active_gap: i32 (cached first gap > 0 from front)
speed: u8   next: line + next_offset: i32 + next_lane: u8   prevs: small list   segs: belt tiles covered (for rendering)
identity: (entity serial, belt index, lane)   rank: u32 (downstream-first, below)   geom_gen: u32 (§15.4)
watchers (inserters registered for arrival estimates)
```

**Per tick** (O(1) for a moving line; FFF-176):
1. **Front free** (`gap[0] ≥ speed`): `gap[0] −= speed` and `backSlack += speed`. Every item moves, and no item is touched.
2. **Front reaching the end:** try to hand the front item to `next`. End-to-end, the target needs `backSlack ≥ 64` at its entry. Side-loading needs a free gap at `nextOffset` (the wiki rule: enlarge a small gap until it is exactly big enough). On success, pop the ring head (O(1)) and append or insert downstream.
3. **Blocked:** set `gap[0] = 0` and decrement the first positive inter-item gap from the front (cached in `activeGap`, which only moves backward while compressing, FFF-176). Items in front of that gap stand still; items behind it move.
4. **Squeezed gaps:**
   - An insertion into a gap smaller than 64 makes that slack negative, as the wiki describes for drills, inserters and side-loading.
   - When the front moves again, the first negative slack grows back toward 0 before the items behind it move.
   - That is one more cached index; the update stays O(1).
5. **Sleep:** if nothing moved and the front is blocked, sleep. The downstream line wakes its `prevs` when it frees entry space.

**Update order: downstream first** (A1 finding 3; IMPL-2). A line that hands items to another (end to end, by side-loading, or through a splitter) must update **after** the line it feeds. Otherwise the receiving line has not moved yet when the feeder offers its front item, and compressed flow opens a one-tick gap at every line boundary. A1's kernel got this order from its generator's numbering; the engine states it:
- **Identity.** A line is identified by `(entity serial, belt index, lane)` of its front (most downstream) belt piece: the belt index is 0, or 0 and 1 for the two sides of a splitter, whose input halves end two lines each. Identities are built from saved state, so a loaded world rebuilds the same ones (D3 f).
- **Rank.** The lines and their feed edges (line → the line it feeds) form a directed graph. Ranks come from Kahn's algorithm run from the sinks, on the reversed graph, with a min-heap of ready lines keyed by identity: take the lowest ready line, give it the next rank, and make ready every line whose fed lines all have ranks. When no line is ready but some are unranked (cycles: belt loops, or splitter and side-load circuits with several in-edges), take the unranked line with the lowest identity, rank it, ignore its remaining unranked in-edges, and continue. Each such cut is the one place in a cycle where compressed flow can open a one-tick gap (§14 #16).
- Ranks are recomputed at the start of phase 8 whenever the topology changed since the last computation, and on load. The line pool's active bitset is indexed by rank (§4.6), so phase 8 runs downstream first at bitset speed.
- R21 checks compression across boundaries for every build order.

**Mixed lanes** (A1 finding 4; ISO). A dead-end lane that carries two item types jams once items that no inserter takes reach its front and fill the pickup window, exactly as in Factorio. Nothing in the engine sorts or skips items on a lane. R22 pins it.

**Splitters.**
- Four input lanes (2 belts × 2 lanes) and four output lanes; lanes are preserved (ISO).
- Per tick, each input lane offers its front item. The splitter alternates outputs per lane (a round-robin bit), honouring input and output priority and the filter.
- The internal buffers are the wiki's 128 + 51 positions.

**Inserter interaction.**
- **Pickup** asks the line for items within a position window on the preferred lane: the near lane on perpendicular belts, otherwise the left lane, per the wiki.
- An item's absolute position is a prefix sum from the front. It is computed lazily once per tick per line and only when queried (a per-line `posCacheTick`).
- **Drop** inserts on the far lane at the drop point if there is room (squeezing allowed).
- **Arrival estimates for sleeping inserters:** with the line moving, `ticks = distance ÷ speed`, scheduled on the timer wheel. The line re-arms its watchers when it stalls or restarts.

**Readers.** The circuit belt reader, including 2.0's whole-line reader, reads a cached `counts[]` per line, maintained incrementally on insert and remove. Cost: free per tick.

**Rendering extraction.** Per visible line, the ring's keys and gaps go into the packet as they are, with the line's geometry whenever it changes (§15.4); the main thread expands them along the segments (§6.8). The sim emits no per-item positions.

**Cost.** About 10 ns per moving line per tick. Sleeping lines cost nothing. A transfer is about 50 ns.

### 5.4 Inserters

**Prototype numbers** (ISO; motion from the engine overlay by `mirrors`, energy from the design data):

| | Burner | Inserter | Long-handed | Fast | Bulk |
|---|---|---|---|---|---|
| Rotation (turns per tick) | 0.013 | 0.014 | 0.02 | 0.04 | 0.04 |
| Extension (tiles per tick) | 0.035 | 0.035 | 0.05 | 0.1 | 0.1 |
| Pickup → drop vector | {0, −1} → {0, 1.2} | same | {0, −2} → {0, 2.2} | {0, −1} → {0, 1.2} | same |
| Energy per movement and per rotation (`energy.per_movement_kj`, `per_rotation_kj`) | **150 kJ** (ISO 50 kJ × 3, DECISIONS §18; J4) | 5 kJ | 5 kJ | 7 kJ | 20 kJ |

Every burner energy number is ×3 like the fuel values, so the burner inserter burns ISO coal per swing. Electric inserters keep their ISO numbers, plus their drain (`energy.drain_kw`).

**State machine.** `WAIT_SOURCE → TO_PICKUP → PICKING (belt) → TO_DROP → WAIT_TARGET → DROPPING → TO_PICKUP`.
- The hand is polar: angle θ (turns) and extension *r* (tiles).
- Each tick θ moves toward its target by the rotation speed and *r* by the extension speed, both scaled by electric satisfaction. A brownout slows inserters (ISO).
- The hand arrives when both match.

**Sources and targets.**
- Resolved when the inserter is built or rotated, or when a neighbouring tile changes (a chunk-local notification). Cached as `(entity | line + position)`.
- Chest-to-chest moves the whole hand in one tick (ISO).
- An inserter takes only what the target can accept (the acceptance table, §4.5): recipe ingredients below the **insertion limit**, fuel up to 5, packs for the current research.
  - It never inserts into a staff slot (07 §6.2) and never removes from the accelerator, weights or staff slots.
  - Into a Research hall it inserts accelerators of any tier into an empty accelerator slot (or, with *Weight transplant*, a higher tier into a full hall, §5.5) and one `frontier-checkpoint` into an empty weights slot.
  - A compromised machine's rollback input accepts one item of its rollback type from an inserter whose enable condition holds (an inserter without a condition inserts too; §5.17). While a machine is compromised, an item of its rollback type goes to the rollback input before any other slot that would accept it (an Endpoint's recipe checkpoint, a Research hall's empty weights slot).

**Insertion limit** (ISO): ingredients for one craft plus the crafts completable in 1.166 s, at least 2 crafts and at most 100. Labs follow the same rule per research unit.

**Belt pickup.** The hand waits at the pickup point and grabs the first acceptable item inside the window. 2.0's "chasing" is modelled as a speed-dependent window ahead of the pickup point. Its width is calibrated so the belt-to-chest table matches the wiki to ±3% (§10.3).

**Stack bonuses** come from research (E's *Batch size 1–7*). Inserters gather successive items from a belt up to their hand capacity, as in Factorio. The exact waiting behaviour of bulk inserters is calibrated against the wiki's bulk rows in G6 rather than assumed.

**Later (P2):** 5 filter slots, whitelist or blacklist, the stack-size override and circuit conditions.

**Throughput goldens** (wiki, 2.0.26, stack 1, chest to chest): burner 0.79, inserter 0.86, long-handed 1.25, fast 2.5, bulk 2.5 items/s. Belt to chest is in §10.3.

**Cost.** About 25 ns per active inserter per tick, plus about 300 ns per pickup or drop.

### 5.5 Crafting machines, furnaces and labs

**Per-tick progress.** For a crafting machine:

```
progress += baseSpeed × qualityMult × max(0.2, 1 + Σ own-module speed + S_speed) × energySat × m × collapse
            ÷ (recipeTime × 60)
S_e      = (1/√n) × Σ_s  eff_s × m_s × E_s(e)      // Switch contribution to effect e: speed or consumption
                                                    // n = Switches reaching this machine; eff_s = 1.5 + 0.2 × quality level (§5.16);
                                                    // m_s = that Switch's own throttle (§5.9); E_s = its modules' effect e
```

- **energySat** is buffer ÷ need, from §5.7 (fuel for burner machines).
- **qualityMult** is the entity's quality crafting-speed factor (§5.16).
- **max(0.2, …)**: the total speed bonus is floored at −80% (ISO 2.0).
- **m** is the thermal throttle. It applies only to `computing` machines (§5.9); elsewhere m = 1.
- **collapse** is model collapse (DECISIONS §31, with its accuracy refinement): 1 − σ·c before *Synthetic detection* for the recipes listed in `meta.world.model_collapse.applies_to` (Checkpoint and Post-training payload; 03 §2.2), where c is the Site's crawl share (§5.11). It is 1 after *Synthetic detection* and for every other recipe.
- The product of every multiplier except the electric satisfaction is cached in `speedEff`. It is recomputed on events: a module change, a Switch built or removed or changing modules, a Switch's throttle changing (§5.9), a bonus, a thermal update of its own chunk, a staffing update, a change of σ or of the crawl share c for machines running a text-trained recipe.
- **Several crafts per tick** are allowed while ingredients and output space last (FFF-402).
- **Productivity** (DECISIONS §30). Only recipes with `allow_productivity: true` take productivity: from modules, from research (`recipe-productivity` names its recipes) and from the entity's base bonus.
  - `prodBar += productivity` per craft, and an extra craft's products appear at ≥ 1 (deterministic, ISO). Catalyst amounts are excluded. Total productivity is capped at +300% (ISO 2.0).
  - ISO 2.0 refusals: a module with a productivity effect cannot be inserted into a machine whose recipe disallows productivity, and such a recipe cannot be set while one is installed.
  - *Nanofabrication* names only the base accelerator recipe (DECISIONS §30, balance B1).
- **Energy draw** = base draw × max(0.2, 1 + Σ consumption effects of own modules + S_consumption + the `computing-energy` bonus where §5.7 applies it) + drain.

**Switches (beacons).**
- Transmission 1.5 (scaled by the Switch's quality, §5.16), with the 2.0 *profile*: the effect of *n* Switches is scaled by 1/√n (FFF-409; D's Switch). Only speed and consumption effects travel: quality and productivity modules never go into a Switch (ISO).
- Supply area 9×9. A machine is reached when its footprint overlaps the supply area (ISO beacon test; U36).
- **Receivers.** An entity takes Switch effects only if its `effect_receiver.uses_beacon_effects` is true, and only the effects in its `allowed_effects`. Research halls take none (DECISIONS §25); the cooling tower takes consumption only (J20).
- **Thermal** (DECISIONS §26). A Switch is a computing machine with a thermal class of its own (03 §1.3; `meta.heat.classes`). Its transmitted effects are multiplied by its throttle m_s; its draw is unchanged.
- **Compromised** (§5.17). A compromised Switch transmits nothing, but it still draws full power.
- A Switch registers with the machines it covers. Their `speedEff` is invalidated when the Switch is built, removed, changes modules, changes m_s, or is compromised or cleaned.

**Recipes and output.**
- **Probabilistic products** use counter RNG (§4.3).
- **Products that depend on the world** (03 §2.1: the refinery's Deduplication and Quality filtering yield more junk as j rises).
  - Their amounts are the recipe's `amounts_by_j` expressions, compiled by the data stage (§2.4).
  - The amounts are recomputed into a cached table whenever j changes (every 60 ticks). A cycle uses the table at its completion (03 §2.1). Stream amounts may be fractional, because fluids are `float64` (§4.2).
- **Output full:** a craft does not start when its products would not fit in the result slots, one stack per product (ISO; the golden tests confirm the edge cases against Factorio, including results larger than a stack).
- **Furnaces** choose their recipe from the input item (ISO).
- **Fluid ingredients and results** go through the machine's fluid boxes (§5.8).
- **Recipe quality** (L5). A machine crafts its recipe at a selected quality, as in 2.0. Every ingredient, a catalyst included, must have that quality (§5.16).

**Labs (Seminars).** Per tick:

```
units = labSpeed × qualityMult × (1 + labBonus) × max(0.2, 1 + Σ own-module speed + S_speed) × staff × e × m_h
        ÷ (unitTime × 60)                          // lab-speed research multiplies, as in Factorio (04 §3.2)
research progress = units × Π × (1 − h)
papers consumed   = units            before Interpretability
                  = units × (1 − h)  after Interpretability (03 §4)
```

- Packs drain per unit consumed (ISO durability).
- **staff** is the network satisfaction s from §5.10, or 1 with a Researcher.
- **e** is the electric satisfaction. Without a Researcher it is the normal-class satisfaction. With one it is min(sat_normal, u_p), where u_p is the network's compute satisfaction (§5.7; U5).
- **m_h** is 1 without a Researcher. With one, the whole Seminar throttles as an Accelerator-class machine (T\* 25 °C; 03 §1.3), because the Researcher does the work.
- **Π** is research per paper (04 §0): `m^k × (1 + 0.1·L_rp) × (1 + Seminar productivity)`. Here k is the number of *Model generation* levels researched and m = 1.5^r comes from the world setting *Returns to research* (J14). The product is cached per level (§5.12).
- **h** is the hollow-work share (03 §4). It applies only when a Researcher staffs the Seminar.
- **Staff demand** (DECISIONS §23a) is the Seminar's working fraction × its speed factor (§5.10). A Researcher sets it to 0.
- **The staff slot** (DECISIONS §7, 01 §8.6) is a slot type beside the module slots. It accepts only the Researcher, by hand, fast transfer or an agent's item request; inserters never fill it (07 §6.2). With a Researcher in the slot:
  - the Seminar counts as fully staffed (`staff = 1`) and demands nothing (§5.10);
  - it is an Accelerator-class computing machine (m_h), a tier-4 deploying building (§5.17), and it may do hollow work;
  - the Researcher's **500 kW** is interruptible load (§5.7), demanded only while the Seminar is working (U5). Only `compute-energy-floor` (*Energy per operation*) scales it: neither the Seminar's modules nor *Dennard scaling* do (balance m9; 03 §1.4). The Seminar's base 60 kW stays normal load, scaled by its modules and Switches as ISO;
  - the entity holds two energy sub-buffers. A shortfall of compute power slows only Researcher-staffed Seminars. Its status reads **Low power** with the tooltip line "Compute is supplied last." while u_p < 1, and **No power** at u_p = 0 (J19).
- **Lab-to-lab pack passing** by inserters is ISO.

**Research halls** (04 §2.3; L1; DECISIONS §25). A 7×7 crafting machine:
- `computing` (Accelerator class), with `energy.priority: interruptible` (§5.7). **No module slots, and no Switch effects** (`effect_receiver` uses neither): its speed is its accelerators' tier, so power and heat brake the takeoff.
- **Inventories:**
  - 20 single-item **accelerator slots** (`extra.accelerator_slots`);
  - 1 **weights slot** for a `frontier-checkpoint` (`extra.weights_slots`), loaded and never consumed;
  - the recipe's input (Datasets);
  - an **output inventory**. It holds the System cards, and also the accelerators that *Weight transplant* swaps out (`extra.output_returns_accelerators`).
- **Loading.** Inserters insert accelerators of any tier into empty accelerator slots, and one frontier checkpoint into an empty weights slot. They never remove either. Construction agents deliver both as item requests (the module-request path). Hand transfer works both ways, except while the hall is locked (below) or compromised (§5.17).
- **Runs only fully loaded:** 20 accelerators and a weights item. Otherwise it stays idle on its drain, with the status **Missing accelerators** (tooltip line "Loaded: n / 20") or **No weights** (both red; 08-text §8.2).
  - **Drain** (R5-gate engine rule): Σ over the loaded slots of `extra.tiers[i].drain_kw` ÷ 20, an empty slot counting 0, so an empty hall draws nothing. Like every drain it is normal load (§5.7), drawn whenever the hall is not running; a running hall's draw already includes it.
  - **Interruptible demand** is counted only for a hall that is running (it has a Dataset, room for its card and power), as for the Researcher's 500 kW (04 §3.1).
  - **Output inventory:** five slots, one for System cards and one per accelerator tier (the swapped-out accelerators of *Weight transplant*); a full slot blocks the hall (output full, ISO) or refuses the swap.
  - **Input inventory:** the recipe's Datasets, with Factorio's insertion limit (§5.4).
- **Mixed tiers** (L1): speed = Σᵢ s(tierᵢ) ÷ 20 and power = Σᵢ p(tierᵢ) ÷ 20, with s and p from `extra.tiers` (1/3/8/20 at 5/8/12/16 MW). The GUI's "Tier" shows the lowest loaded tier.
- **Without *Weight transplant*:** a full accelerator inventory is locked, with no insertion and no hand removal; an insertion is refused with "Needs Weight transplant" (08-text §8.3). Mining the hall returns everything (04 §2.3).
- **With *Weight transplant*:** an accelerator of a higher tier than the lowest loaded one, inserted into a full hall, replaces that lowest one (ties: the lowest slot index) with the flying text "Swapped". The replaced accelerator goes to the output inventory, where inserters can take it.
  - An accelerator of the lowest loaded tier or below is refused.
  - So is any swap while the output inventory has no room for the old accelerator.
- **Quality** (L1). The quality of loaded accelerators is ignored, and the hall entity's own quality applies as for any crafting machine (§5.16). The weights item's quality sets v for the leak (03 §3.1).
- **Recipe:** *Research run*, 1 Dataset → 1 System card, 60 s at speed 1.
- **Power** = (Σᵢ p(tierᵢ) ÷ 20) × the `hall-energy` multipliers (*Sparse inference* ×0.75, halls only; U17) × the `compute-energy-floor` factor (*Energy per operation*) × 2 in test-time mode. *Dennard scaling* does not apply: accelerators are post-Dennard (03 §1.4). The hall takes u_p of it (§5.7), and it draws full power while throttled.
- **Test-time compute mode.** A per-entity flag, set in the GUI or by a circuit condition, that exists once the `hall-mode` effect is researched (*Test-time compute*). It multiplies speed by (1 + `output`) and power by (1 + `energy`): ×1.5 and ×2 with the data's 0.5 and 1.0. It folds into `speedEff` and the energy demand.
- **The closure event** (DECISIONS amendment 16). The first System card written by any Research hall fires `loopClosed` once. It is the hook for the "Loop closed" log line, the log-scale graphs, the doubling-time readout, the overhang snapshot (§5.20) and the achievements timed from closure. The same craft completes the hidden trigger technology *Loop closed* (its craft-recipe trigger on `research-run`, §5.12), which makes *Model generation* and the takeoff hardware available (R5-gate D9).

**The Frontier cluster** (04 §2.1, 07 §13.1; ISO with the rocket silo; R5-gate engine rules). A 9×9 crafting machine of the Accelerator class (T\* 25 °C) with 4 module slots, drawing `energy.kw` (3,990 kW) while it crafts and `extra.idle_kw` (250 kW) otherwise.
- **Shards.** Its only craftable recipe is *Run shard* (category `frontier-run`). A completed shard never leaves the cluster (ISO: rocket parts): it adds 1 to the cluster's shard counter, and its productivity bar (*Self-play*, *Algorithmic progress*, modules) adds more. Heat throttles shard crafting with m; the launch never throttles (U14).
- **Payload slot.** One slot that accepts a `post-training-payload` or a `final-report`, from the hand, fast transfer, inserters or agents.
- **Launch.** When the counter reaches `extra.parts_required` (100): with a payload in the slot the launch starts by itself; with an empty slot it starts only from the GUI's button (`launch_empty`, Appendix B). A launch takes the pseudo-recipe's time (1 s), consumes the 100 shards and the payload, and cannot be cancelled.
- **Completion** writes the products of the matching pseudo-recipe into the cluster's output inventory: `launch` (a Post-training payload) → its System cards × (1 + Σ `system-cards-per-run`) (1,000, or 1,500 after *Chain of thought*; not productivity) and 1 frontier checkpoint; `launch-empty` → 1 frontier checkpoint; `launch-final` → the same as `launch`, then victory (`victory: true`) and the run report (§5.20). A full output inventory holds the next launch (ISO).
- **Events.** A completed `launch` fires the `launch` trigger (*In-context learning*) and the first-run panel (07 §13.2); the empty launch triggers nothing; each completion writes 08 §8.4's log lines.
- **Compromise** (§5.17). Like any compromised machine it freezes: no shard crafting and no launch until it is clean.

**Status.** Every entity exposes a `status` code (`uint8`) from Factorio's `entity_status` vocabulary (I §3.12) plus ours:

| Status | LED |
|---|---|
| working, normal, **working (Researcher)**, **working (linked)** (Terminal), **watching** and **cleaning** (Monitor) | green |
| low power (for interruptible load, with the tooltip line "Compute is supplied last."), low input fluid (a cooling tower without water included), charging, **understaffed**, **throttled by heat**, **no hot coolant** (dry cooler, water exchanger), **not linked** (Terminal) | yellow |
| no power, no fuel, not plugged in, no recipe, item or fluid ingredient shortage, output full, waiting for source items, waiting for space in destination, no minable resources, missing science packs, no research in progress, marked for deconstruction, disabled by control behaviour, pipeline overextended, **no staff**, **closed to crawlers**, **compromised**, **missing accelerators**, **no weights**, **no evaluation sets** (Monitor), **no university in range** (Terminal) | red |

- Display strings are 08-text §8.2's, held in `game/locale/en.yaml` (§2.2); the internal codes above are not display text (the Terminal's *working (linked)* displays "Working"). The status rides in the chunk view (§3.4).
- It feeds the GUI LED, world warning icons, and the **status-light layer** (07-ui §16.2). That layer is an 8 px dot per machine in alt-mode, with its own colour mapping: output full is yellow there, and statuses that already have a warning icon get no dot.

**Cost.** About 20 ns per active machine per tick, plus about 0.5 µs per completed craft.

### 5.6 Mining and resources (ores, archives, exchanges)

**Resource tiles** are stored per chunk as a sparse map: tile → (resource prototype, amount `u32`).

**Mining drills.**
- The mining area, `resource_searching_radius` and output vector come from the overlay (ISO: electric 5×5, burner 2×2).
- `progress += miningSpeed × qualityMult × max(0.2, 1 + Σ own-module speed + S_speed) × energySat ÷ (miningTime × 60)`. Each completion depletes one unit and outputs one item; productivity (mining-productivity research, modules) fills a separate deterministic bar, and each full bar outputs one more item without depleting the patch (ISO; 01 §7.2).
- Each completion takes one unit from the area's tiles, round-robin in row-major order, skipping empty tiles. One item goes to the drop target: a belt lane at the drop point, an entity's inventory, or the ground.
- **Uranium-type resources** need fluid (`requires_fluid`) from the drill's fluid box. Hand-mining needs none (§5.1).

**Archives** (Records; B L3). An ordinary finite ore, generated at a town's library or as a records store (§5.18). Its σ = 0 forever is a rule about the world's text, not item state: records and the tokens made from them carry no provenance (§14 #7).

**Exchanges** (the Crawl; D §4, 01 §7).
- **The tap's state** is a resource point holding the backlog A (300,000 = 100%), the town's writing floor *f*, the closure threshold σ_c, and the flag `closed`.
- **Yield:** `y = max(A ÷ 300,000, F(W))` with `F(W) = f × max(1, 2^((W − 40)/20))`.
  - `2^x` comes from `det::exp2` (the `libm` crate, §4.1), never from `std`'s float methods.
  - Output = 10 units/s × y × speed × (1 + productivity) × D_syn, where D_syn = 1 − σ after *Synthetic detection* and 1 before (03 §2.2).
  - Each cycle removes 10 from A while A ÷ 300,000 is above F(W) (ISO depletion; productivity output does not deplete).
  - The floor F(W) replaces Factorio's minimum yield: the engine never reads a `min_yield` on the exchange (01 §13).
- **One building per tap:** a **Crawler** (a pumpjack-type extractor) or an **Endpoint** (a crafting machine with `placement: {must_be_on: exchange}`, 03 §2.4). Crawl leaves through a data-line box (§5.8).
- **Closing.** When σ ≥ σ_c, the tap flags `closed` for good, and its Crawler shows *closed to crawlers*. Endpoints keep working.

**Cost:** about 20 ns per active drill.

### 5.7 Energy: burners, electric networks, generators, the day cycle and nuclear heat

**Burner energy sources.**
- A fuel inventory with fuel categories, a burning item, and an energy buffer.
- Every fuel value and every burner consumption is 3× Factorio's (DECISIONS §18, kept by §24), so item flows stay ISO and thermal plants run at η ≈ 33%.
- A burner machine emits the fuel it burns as heat into its chunk (B L4; §5.9). A boiler emits nothing: under DECISIONS §24 its loss is emitted where the steam becomes electricity.
- Burner inserters refuel themselves from fuel they handle (ISO).

**Electric networks.**
- **Topology.** Poles connect by copper wires: the auto-connect rule (I §3.4, "no common neighbour") or manual wiring. A network is a connected component of poles, rebuilt in the affected component on removal and union-merged on addition.
- **Attachment.** An entity attaches to every network whose supply area covers any of its tiles. Usually that is one, but more are supported (FFF-421). The buffer is shared, and networks fill it in network order.
- **Power switches** join or split networks; the networks are rebuilt.
- **Drains** are design data (`energy.drain_kw`, ISO values; N30). They are normal load and are emitted as heat like any draw.
- **Per-tick algorithm** (memory-bound by nature, FFF-421):
  - **Grouping.** Consumers are grouped by prototype inside each network (FFF-209), so flow limits are read once per group.
  - **Demand classes:**
    1. **normal** (Factorio's secondary input, drains included);
    2. **accumulator charging** (Factorio's tertiary input);
    3. **interruptible** (G's BEND, G §2.6; 04 §3.3): Research halls and the Researcher's 500 kW. Data: `energy.priority: interruptible`.
  - **Generation:**
    1. solar (primary): 60 kW × daylight(t) × s, with s the sunlight of the panel's chunk (01 §3);
    2. steam engines, steam turbines and fusion generators (secondary): shared in proportion, each limited by the steam or plasma in its fluid box;
    3. accumulator discharge (tertiary).
  - **Allocation** (U16; 04 §3.1). Let G be the primary and secondary generation available this tick, D_n the normal demand, D_c the accumulators' charge room (capped by their flow rate), D_i the interruptible demand and A the accumulators' discharge capacity this tick.
    - **If G ≥ D_n:** normal is served in full. Accumulators charge with c = min(G − D_n, D_c). Interruptible load gets min(D_i, G − D_n − c). No accumulator discharges this tick.
    - **If G < D_n:** accumulators discharge d = min(A, D_n − G + D_i), serving normal first and interruptible second. No accumulator charges this tick.
    - So accumulators never charge and discharge in one tick. The normal satisfaction is min(1, (G + d) ÷ D_n). The **compute satisfaction** is u_p = (interruptible energy served) ÷ D_i, which is 04 §3.1's formula with P_available = G + d.
    - A shortfall slows compute before it slows the factory, and a solar base that runs Research halls still charges its accumulators by day.
  - **Fill.** Each consumer's buffer gains `deficit × satisfaction(class)`. Generators consume steam or plasma in proportion to the energy they deliver. Steam's energy per unit is (T − 15 °C) × `heat_capacity_kj_per_k` (0.2 kJ/K for water and steam; J3). 30 steam/s at 165 °C therefore give 900 kW, and 60/s at 500 °C give 5,820 kW.
  - **Emission.** Every consumer's drawn energy, and **twice every generator's delivered electrical energy**, go into the chunk emission accumulators (§5.9; DECISIONS §24).
  - **Statistics** per network and per entity prototype feed the electric network GUI (I §4.16). The compute satisfaction u_p goes on the power tooltip (G).
- **Energy effects on computing machines** (U17, U18; 03 §1.4, 04 §5, §10):
  - `computing-energy` (*Dennard scaling*, −8% per level) is added to the consumption effects of modules and Switches on every computing machine of the tube, computer, network (the Switch's) and cluster classes. The total consumption bonus is floored at −80% (ISO). It does not apply to the Accelerator class (Research halls, the Frontier cluster, the Researcher's 500 kW): accelerators are post-Dennard (03 §1.4). Nor does it apply to a Seminar's base 60 kW.
  - `hall-energy` (*Sparse inference*, ×0.75) multiplies the draw of Research halls only.
  - `compute-energy-floor` (*Energy per operation*) multiplies the draw of Research halls and Researchers by f + (1 − f) × 0.9^L, with f = θ_K ÷ `floor_temperature_k` (4,800 K) at the entity's own chunk (04 §10). 0.9^L is repeated multiplication (§4.1). It is the only effect on the Researcher's 500 kW.
- **The day cycle** (ISO; P7).
  - 25,000 ticks per day. Daylight is piecewise linear in the day fraction t, where t = 0 is noon: 1 until dusk (0.25), falling to 0 at evening (0.45), 0 until morning (0.55), rising to 1 at dawn (0.75). That gives the 70% solar average.
  - The renderer's ambient light reads the same table with a floor of 0.15 (Factorio's minimum brightness).
  - Sunlight s(y) is evaluated at the chunk centre, like θ (P8).
- **Nuclear (heat-pipe networks).**
  - Reactors (the neighbour bonus, ISO), heat pipes and heat exchangers each hold a temperature (500–1,000 °C, ISO).
  - Conduction per tick between neighbours is proportional to the temperature difference, up to the prototype's maximum transfer.
  - A heat exchanger turns `extra.water_per_s` (10.309/s) of water into ten times as much 500 °C steam (103.09/s; J3).
  - **Emission** (DECISIONS §24). Reactors, heat pipes and heat exchangers emit no conversion heat. The plant's loss appears at its turbines, twice their output (§5.9).
  - **Waste heat** (03 §1.1). A fission reactor at its 1,000 °C maximum keeps burning fuel (ISO). The heat it generates but can neither pass on nor store is emitted into its own chunk.
  - In code this is `heatNet`, kept apart from the thermal field (§5.9) to avoid the name clash.
- **Fusion.** The fusion reactor burns fusion power cells (fuel ×3, §24) into plasma. It emits no conversion heat; its own electric draw (`extra.electric_kw`) is emitted like any draw. Fusion generators turn plasma into electricity and emit twice their output.
  - **Plasma** (R5-gate D12d) carries `plasma_mw` ÷ `plasma_per_s` = 25 MJ per unit, the energy the generators draw from it (the validator checks the generator's `max_kw` and `plasma_per_s` against it).
  - **Neighbour bonus**, as in Space Age: each adjacent active reactor multiplies a reactor's plasma output by (1 + `neighbor_bonus`) without burning more fuel. The extra energy appears as heat only where every plant's loss does, at the generators (2 × their output).

**Cost:** about 12 ns per consumer per tick over two passes; generators and accumulators similar.

### 5.8 Fluids (Factorio 2.0 segments) and the data-fluid network

**Fluid boxes.** Every fluid-capable entity has fluid boxes, each with:
- a capacity (pipe 100; storage tank and Data lake 25,000);
- connections: position, direction, flow type (input, output, input-output) and **connection category**;
- one fluid filter or fluid, and a temperature.

**Segments** (FFF-416).
- A segment is a connected component of pipes, pipes-to-ground and tanks of one category and one fluid.
- Its capacity is the sum of its boxes, and it holds one amount and one temperature (weighted on mixing).
- Pipes cost nothing per tick.
- A build or removal re-segments the affected component, by BFS bounded to that component.
- Building that would connect two different fluids is refused with "Would mix fluids" (ISO).

**Per-tick boundary flows** (FFF-430). For each machine box ↔ segment connection, pump and offshore pump:

```
flow = min(available, room, 100 × fill(source) × (1 − fill(sink)))      // 100 units per operation = 6,000/s cap
```

This is our reading of FFF-430: the input rate is proportional to the source's fullness, the output rate falls as the sink fills, and both scale the 100-unit cap. G13 calibrates it against 2.0's observable behaviour: even sharing and the equilibrium fill level.

- **Pumps** move up to 1,200 units/s (20 per tick) between two segments, also scaled by fullness.
- **Fluid wagons** are exempt from the ratio (ISO).
- Machines update in pool order. The first-updated machine gets a slightly larger share, as in 2.0.

**Rules (ISO).**
- **Pipeline extents.** A segment whose bounding box exceeds 250×250 tiles carries no flow and raises the alert *pipeline overextended*.
- **Steam** (J3). A boiler turns its `extra.water_per_s` (6/s) of water into ten times as much steam at 165 °C (60/s; 2.0's 1 : 10). A heat exchanger turns 10.309/s into 103.09/s at 500 °C. Steam's energy per unit comes from the fluids' `heat_capacity_kj_per_k` (§5.7).
- **Offshore pump:** 1,200/s.
- **Underground pipe:** maximum gap 9.

**Data lines** (D §4.4) are the same engine with `category: data`.
- Data line, underground line, Repeater (pump) and Data lake (tank) carry Crawl, Junk, Text and Prose.
- Pipes have `category: default`. A data line never connects to a pipe because categories never intersect. Factorio 2.0 itself has `connection_category`, so this needs no new mechanism.
- **Data networks** (for runaway links, §5.17, and for Terminals, §5.10) are the components formed by data segments joined through Repeaters, plus every machine with a box on them. A machine with several data boxes joins their networks.

**Coolant** (03 §1.4) is an ordinary fluid in pipes (category `default`) with temperatures.
- **Temperature filters** (J20; U48). A machine's coolant input accepts coolant at or below `meta.heat.coolant.machine_takes_at_or_below_c` (35 °C) and returns it at `machine_returns_c` (50 °C). A cooler's input accepts coolant at or above its `heat.coolant_in_min_c` (45 °C) and returns it at its `heat.coolant_out_c` (30 °C).
- A segment whose temperature lies outside a box's range does not flow into that box. The machine's q then falls and its heat goes to the air (§5.9). A cooler shows **No hot coolant**.
- **Mixing.** A segment holds one temperature, the weighted mean on mixing (ISO), so a loop that mixes hot and cold coolant can fall outside both ranges. Hot and cold loops therefore need separate pipes, as steam at 165 °C and at 500 °C does in Factorio.
- New coolant starts at 30 °C (`default_temperature`; P28).
- The three port glyphs of 07-ui §8.3 (pipe, data line, coolant) come from each box's category and fluid filter. Wrong connections are refused by the ordinary mixing rule.

**Barrels and drives** use generated fill and empty recipes (§2.4).

**Cost:** about 30 ns per active boundary connection per tick. Pipes are free.

### 5.9 The thermal field ("Heat"; 03 §1, from F §1.1)

**Data per chunk:**
- `H` (MJ);
- an emission accumulator (J this window);
- an incoming-diffusion accumulator;
- `κ` (s⁻¹): the mean `kappa_per_s` of the chunk's 1,024 tiles (`tiles.yaml`), plus `meta.heat.loss.per_tree_per_s` × (leaf stages left ÷ 4) for each tree. It is recomputed when a tile or a tree changes;
- `θ`, the static ambient temperature from worldgen (01 §3: `clamp(14 + y/80 + n(x, y), −15, 35)` °C at the chunk centre; the noise is P9's, §5.18);
- `leafTimer`, seconds spent above the tree-damage temperature (U11);
- the cached temperature `T = θ + H ÷ C`, with C = `meta.heat.chunk_heat_capacity_mj_per_k` (20 MJ/K).

All numbers are 03 §1's and the data's. The golden reference is `tools/ref/heat_calib3.py`, a verbatim copy of F's `calib3.py`, which implements 03 §1.2's update exactly (G15).

**The chunk of an entity** (U8) is the chunk that holds its geometric centre: (⌊x2 ÷ 64⌋, ⌊y2 ÷ 64⌋) in the doubled coordinates of §4.2. An even-sized entity centred exactly on a chunk line therefore belongs to the east or south chunk. The same chunk is used for emission, for the throttle and for a cooler's sink. A 9×9 or 7×7 building emits into one chunk; 03 §1.1 accepts the simplification so that chunk borders give no exploit.

**Emission** (B L4; 03 §1.1; DECISIONS §24). The entity's `heat.emission` decides, with the default following its energy source:

| Emitter | Heat into its chunk | Booked in |
|---|---|---|
| Electric consumers (default) | Their *drawn* energy, drains included. Interruptible load therefore emits u_p × its draw, automatically | Phase 4 |
| Burner machines (default): furnaces, burner drills and inserters, Keypunches, vehicles | Their whole fuel burn | Phase 6 |
| `emission: twice-output`: steam engines, steam turbines, fusion generators | 2 × the electrical energy they deliver | Phase 4 |
| `emission: none`: boilers, heat exchangers, fission and fusion reactors, heat pipes | Nothing. The plant's loss is emitted at its generators. A fusion reactor's own electric draw is still emitted, like any draw | — |
| A fission reactor at its 1,000 °C maximum (`waste_heat: true`) | The heat it generates but can neither pass on nor store (waste heat, 03 §1.1) | Phase 6 |
| Solar panels, accumulators | Nothing | — |

- Item flows stay ISO: fuel items per minute are unchanged, because fuel values and burner consumption are both ×3 (DECISIONS §18, §24). A boiler at full load burns 5.4 MW for 1.8 MW of steam, and its two steam engines emit 2 × 0.9 MW: the plant emits F's 3.6 MW per boiler, at the engines.
- **Liquid-cooled machines** (03 §1.4). A share ℓ of the draw (0.7, or 0.9 after *Immersion cooling*) goes into the coolant box as heated coolant, 1 unit per MJ, in proportion to the coolant actually received.
  - **Seminars** (R5-gate D12g) have the box from *Liquid cooling* whatever the staff slot holds, because a fluid box belongs to the prototype; it needs ℓ × the Researcher's 500 kW while a Researcher is installed, and nothing otherwise (q = 1).
  - With q = received ÷ needed (needed = ℓ × the draw, at 1 coolant unit per MJ), the air gets `draw × (1 − ℓ·q)` each tick. The throttle's T\*_eff (step 6) uses q over the ticks since the chunk's last update (Σ received ÷ Σ needed). q is clamped to [0, 1], and q = 1 when nothing was needed.
  - Dry coolers take hot coolant and emit its heat into their own chunk's air. Water exchangers emit it into the chunk of the water tile at their pumping position (U9). Both work up to their capacity × Π `multiplier` × (1 + Σ `value`) over the `cooling-capacity` effects whose `entities` list them (×2 each from *Two-phase* and *Microfluidic cooling*, +10% per *Thermal management* level).

**Update** (Factorio's cadence: each chunk once every 64 ticks, in bucket `(cx + 8·cy) mod 64` with a non-negative modulo, a function of the chunk's coordinates, so generating new chunks never moves an old one to another bucket; Δt = 64/60 s). The order is 03 §1.2's:
1. **Emission.** `H += emissions + incoming`. Clear both accumulators.
2. **Diffusion.** If `H ≥ 15 MJ`, move 2% of H to each of the 4 neighbours' incoming accumulators (U10):
   - to an **ungenerated** neighbour, the share leaves the field and is booked under the **Map edge** sink;
   - to a neighbour **outside the map bounds** (§5.18), the share is not sent: the edge reflects.
3. **Newton cooling.** `H −= (κ·H + 0.002 MJ/s) × Δt` (F's κ·H + 2 kW).
4. **Active sinks.** Each cooling tower in the chunk removes up to its capacity × Π `multiplier` × (1 + Σ `value`) of the `cooling-capacity` effects that list it, × Δt: the full rate at ΔT ≥ 5 K, linear below it, where ΔT = H ÷ C as it stands after step 3 (the golden script's order). It consumes `water_per_mj` of water per MJ removed. A tower without water removes nothing and reads *Low input fluid*.
5. **Clamp.** H never falls below 0. Removals are applied in order (Newton, then each tower in pool order), and each is limited to the H that remains, so the statistics book the actual removal, not the computed one (U12).
6. **Effects.** Recompute `T`. Notify the chunk's **computing** machines, which recompute `m = clamp(1 − (T − T*_eff) ÷ 50 K, 0.5, 1)` and their `speedEff`.
   - `T*_eff = T* + 15 K × q`, with T\* by thermal class from `meta.heat.classes` (03 §1.3).
   - **Switches** (DECISIONS §26) are computing machines of their own class. A new m_s rescales their transmitted effects and invalidates their receivers' `speedEff` (§5.5).
   - **The Frontier cluster** throttles its run-shard crafting; the launch itself never throttles (U14).
   - A throttled machine is still *working*, for the leak and for staffing (U15).
   - Throttling never changes the power draw.
7. **Trees** (U11). While T > `meta.heat.tree_damage_c` (45 °C), `leafTimer += Δt`. Each time it reaches `meta.heat.loss.leaf_stage_s` (600 s), every tree in the chunk loses one of its 4 leaf stages and the timer drops by 600 s. When T ≤ 45 °C the timer resets to 0. A leaf change recomputes κ and clears the chunk's pristine flag. No RNG is involved.

**Overlay and statistics.**
- The packet carries `T` for visible chunks while the overlay is on: the map view and the minimap in alt-mode (I §3.14, §4.11).
- **The statistics tab *Heat*** books every emission by source category. Coolers' emissions get rows of their own. Every removal is booked by sink: terrain (Newton, the 2 kW floor included, split among the terrain classes, which are the rows of 03 §1.2's κ table, and trees, in proportion to each one's share of the chunk's κ), cooling towers, and the Map edge. Dry coolers and Water exchangers are sources, not sinks: the coolant heat they reject enters the field.
- Production minus removal equals the change in stored H, which is what UI-G9 checks.

**Map setting** "Heat: off" (03 §1.9) disables the field and all throttling. θ is still computed for biomes, solar and the overlay's ambient-only view. Cooling buildings stay buildable and inert.

**The four anti-cascade guards** (03 §1.5) are engine invariants with tests:
- throttling never changes power draw;
- the throttle floor is 0.5;
- nothing is damaged by heat;
- cooling buildings, power plants, mechanical machines and logistics never throttle.

**Cost:** under 0.01 ms per tick for 4,096 chunks.

### 5.10 The staffing network (B L9, DECISIONS §7, §23)

The rules are 01 §8's; the numbers are `meta.staffing`'s.

**Sources.** Each university (a town's 8×8 campus: a world object, not a built entity) supplies T(W) staff-equivalents (01 §8.1), with T₀ by town class.
- **Where the universities are** (U4). Campus positions come from the pure town function (§5.18), so a campus counts whether or not its chunk has been generated.
- **Identity.** A university's id is its town cell key (§5.18), encoded like a chunk key: (rx + 2¹⁵) × 2¹⁶ + (ry + 2¹⁵) for town cell (rx, ry). It is stable across saves, orders ties and picks the network hue (lowest id).

**Coverage** (U3). Let the campus occupy tiles [x₀, x₀ + 8) × [y₀, y₀ + 8), and let R be the commuting radius (48 tiles, ×1.5 per `staffing-radius` effect: 72, then 108).
- A Seminar with centre (cₓ, c_y) is covered iff x₀ − R ≤ cₓ < x₀ + 8 + R and y₀ − R ≤ c_y < y₀ + 8 + R.
- A Seminar is 3×3, so its centre is a half-integer and never lies on an edge.
- The overlay draws exactly this predicate (07-ui UI-G5).

**Demand** (DECISIONS §23a; U1):

```
demand_i = w_i × max(0.2, 1 + Σ own-module speed + S_speed)        // S_speed: §5.5, Switch throttles included
```

- **w_i** is the fraction of the last 60 ticks in which Seminar i had a research job, the papers for its current unit (or a unit in progress), electric satisfaction > 0, and was not compromised. A per-Seminar tick counter holds it, and it is saved.
- Lab-speed research bonuses are free: they raise output without raising demand.
- A Seminar with a Researcher demands 0 and has staff = 1.
- The Seminar GUI shows the value ("Staff demand 2.4", 07-ui §6.1).

**Staffing networks** (U2; DECISIONS §23d and 01 §8.9: the Terminal). The graph's nodes are universities, covered Seminars (in any state: idle, unpowered or holding a Researcher) and Terminals. Its edges:
- **university–Seminar**, when the university covers the Seminar;
- **university–Terminal**, when the Terminal's centre lies in that university's coverage (same predicate);
- **Terminal–Terminal**, when both sit on the same data-line network (§5.8) and both have electric satisfaction > 0 at the recompute tick.

A staffing network is a connected component that contains at least one Seminar. A pair of Terminals on one data line therefore joins a distant university to the home network, the way a long wire joins two power networks. Terminals are not susceptible and are not a runaway link of their own: the data-line network they sit on links whatever susceptible machines are on it (03 §3.3).

**Satisfaction.** For each network, `s = min(1, ΣT ÷ Σdemand)`, and s = 1 when the demand is 0. Each member Seminar gets `staff = s`. An uncovered Seminar without a Researcher gets 0 and the status *No staff*.

**Terminal statuses** come from the last recompute: *Working (linked)*, *Not linked*, *No university in range* or *No power* (the data's `terminal.extra.statuses`).

**Recompute** every 60 ticks, in phase 13 (§4.6). Both the graph (union-find over universities, covered Seminars and Terminals) and the sums are rebuilt then. Terminal power flips, data-line edits, new Seminars and R upgrades therefore need no events: they all take effect at the next recompute.

**The Researcher** (U5) staffs its Seminar whatever the network supplies, in every state. Its power and throttle rules are in §5.5.

**Setting:** staffing off (07-ui §17, *Sandbox*; U6) sets `staff = 1` everywhere. The staff slot stays, and a Researcher behaves as usual (500 kW, leak, hollow work); only its staffing effect is moot.

**Display** (U7; P19).
- Percentages round half up to an integer, while the simulation keeps the exact value. So 0.787 reads "79%".
- The research widget's "Staff-limited (n%)" is the minimum staff over the Seminars working on the current research.

**Overlay** (J24). Coverage squares are drawn like power coverage (§6.9, 07-ui §3.3), one hue per network from a fixed 8-hue palette.
- The hue index is (the lowest university id in the network) mod 8. A network keeps its colour when an unrelated network merges or splits.
- The statuses *Understaffed* (yellow) and *No staff* (red) come with Factorio-style warning icons.

**Cost:** O(Seminars + universities + Terminals) per recompute, i.e. microseconds.

### 5.11 World text and the leak (W, j, σ, L; 01 §12, 03 §2–§3)

**Global scalars,** integrated every 60 ticks (phase 13) with the equations of 01 §12 and the numbers of `meta.world`:
- **W = W_own + W_pub** (J6). The two terms are kept apart for the Field tooltip, and γ(W) scales only the field's own pace.
  - Each second, W_own += (v₀ ÷ 3,600) × γ(W). v₀ comes from the world setting (normal, Race or Race hard).
  - γ(W) = 1 for W < 80, (m/g)^((W − 80)/0.5) for 80 ≤ W < 90, and 1 again from W = 90 (01 §12.1). A non-integer power, it uses `det::pow` (§4.1).
  - Race mode adds `race_spoil_w` (0.002) to W_own for each Significant result that spoils (03 §5).
- **Publication** (J6). Y_pub starts at `meta.world.y_pub_start` (1945). A technology's *year* is the latest `year` in its structured `citation` list (DECISIONS §35).
  - When a technology completes that is `regime: cited` and whose cost includes at least one paper other than System cards, ΔY = max(0, year − Y_pub) and Y_pub rises to that year. Trigger technologies have no cost and never publish.
  - Each positive ΔY queues a release of β·ΔY field-years, paid into W_pub evenly over the next `publication_lag_s` (600 s).
  - The pending releases are a saved list of (start tick, amount).
- **j(W)** is piecewise-linear between `meta.world`'s breakpoints (01 §12.2).
- **σ = 0.9·Σ ÷ (1 + Σ)** (01 §12.3). Σ only grows, from two sources:
  - an **event hook** on production: each `ratings` crafted by an Endpoint adds the per-Ratings increment a, times the `deployment-sigma` factor after *Watermarking*;
  - the world's own term: `world_sigma_per_field_year` per field-year that W gains above `world_sigma_from_w` (70).
- **Model collapse** (DECISIONS §31, with its accuracy refinement; 03 §2.2).
  - Two production windows cover the last `window_ticks` (36,000 ticks, 10 minutes), each a saved ring of 600 one-second sums:
    - P_crawl: the text and prose produced by the `crawl_recipes` (Quality filtering, Deduplication);
    - P_syn: the text and prose produced by the `synthetic_recipes` (Synthetic data).
  - The crawl share is c = P_crawl ÷ (P_crawl + P_syn), and c = 0 when both are 0.
  - Before *Synthetic detection*, the recipes in `applies_to` (Checkpoint, Post-training payload) run at speed × (1 − σ·c), the compiled `speed_factor`: this is §5.5's collapse factor, and archive-only training pays nothing. After it, crawler output is × (1 − σ) (§5.6), and training pays nothing.
  - Items carry no provenance (§14 #7), so c is the Site-wide crawl share of new text, the global form 03 §2.2 specifies.
- **The race clock** (03 §6). W reaching 90 before *Model generation 25* completes is the Race loss.

**The leak** L and the shares ℓᵢ are integrated in the same pass, right after the world text. Their rules are in §5.17.

**Effects.**
- Town era skins for rendering: five, by W (01 §5.3). They are global and switch at the thresholds, with no per-town hysteresis (U57).
- Exchange floors F(W) and closing (§5.6).
- University T(W) (§5.10).
- The refinery product tables (§5.5).
- The collapse factor (§5.5).

**Readouts** (J6; DECISIONS §13, §35).
- **Literature: YYYY** is the maximum year over researched `regime: cited` technologies, trigger technologies included, and "—" before any. Technologies of the `infrastructure` and `beyond` regimes never count, whatever citation they display (DECISIONS §35).
- **Field: YYYY** = 1945 + ⌊W⌋. Its tooltip shows W_own and W_pub.
- **Your year** = ⌊max(Literature, the `field_year` of every researched `beyond` technology)⌋, floored like Field so that the gap is a whole number. *Model generation L* gives 2025 + 0.5 × (L − 5), an expression in L (§2.4). **Years ahead** = Your year − Field year.
- **The doubling-time readout** (04 §9; U24), computed sim-side after closure and saved:
  - R̄, research units per second over the last w seconds, is sampled every 6 ticks into a ring covering the last 2 h. A second ring keeps 60-tick samples over the last 24 h.
  - w = clamp(DT ÷ 4, 5 s, 120 s), using the previous evaluation's DT; the first evaluation after closure uses w = 120 s.
  - **R̂**, the running maximum of R̄ since closure, is kept beside R̄ in both rings (R5-gate D11). It never falls, so the search is a binary search.
  - DT(t) = t − max{s ≥ closure : R̂(s) ≤ R̄(t) ÷ 2}. A dip (an empty queue, a blackout) therefore reads as a long doubling time, never as the seconds since the dip.
  - *Fastest doubling* and the history string take a DT only on a sample that sets a new running maximum. The history appends DT whenever DT ≤ half of the last appended entry; the first such DT after closure is its first entry.
  - While R̄(t) = 0, or while no s qualifies (the rate has not doubled since closure), the readout shows "—", and nothing is recorded for *Fastest doubling* or the history.

**Cost:** negligible.

### 5.12 Research

- **The queue** holds up to 7 entries (ISO). Progress is kept per technology and never lost.
- **Start research** queues missing prerequisites first, in dependency order (I §4.9).
- **Multi-level prerequisites** (U19). A prerequisite on a finite multi-level technology is met at its `max_level`; on an infinite one, at its first level.
- **Costs:** unit counts, or a `count_formula` compiled by the data stage (§2.4). Geometric costs are computed exactly (repeated multiplication), rounded half up to whole units at each level (the rule the data's literal counts follow: *Model generation 25*'s 5,320,411 is 2,400 × 1.5¹⁹ = 5,320,410.8), and cached per level.
- **Trigger technologies** (E §2.4): craft-item (counting any producer of the force), craft-recipe (completed crafts of the named recipe by any machine of the force; round 5), mine-entity (the first unit extracted by the character, a drill or a Crawler, as Factorio 2.0's *Oil processing* fires on crude oil), build-entity, research, and launch: a frontier run that completes carrying the named payload. The empty launch (04 §2.1) triggers nothing. Triggers are evaluated from production events, not by polling.
- **Hidden technologies** (`hidden: true`, Factorio's flag; R5-gate D9). The one in the data is *Loop closed* (`loop-closed`): craft-recipe of `research-run`, count 1, so it completes with the closure event (§5.5). *Model generation* and the takeoff hardware require it, so nothing paid in System cards alone is available before closure. A hidden technology is never sent to the technology screen, the queue or the search; it raises no toast and no research log line, publishes nothing (it has no cost) and is excluded from Literature, Your year, the end state's counts and the run report's Peak research rate. Its dependents' cards carry 08 §4.6's closure line, and *Start research* refuses them before closure.
- **Effects** come from the effect registry, which the data stage checks.
  - Examples, by data type: `laboratory-speed`, `research-productivity`, `research-per-paper`, `mining-productivity`, `inserter-stack-size-bonus`, `worker-robot-speed`, `staffing-radius`, `computing-energy` (*Dennard scaling*: an energy cut, §5.7), `hall-energy`, `cooling-capacity`, `recipe-productivity`, `weight-transplant`, `research-queue-auto`.
  - All effects are retroactive (ISO) and invalidate the cached `speedEff`s they touch.
  - **Coalesced per tick** (balance m10). When several levels or technologies complete in one tick, their effects are summed per effect type first, and each affected entity's `speedEff` is recomputed once.
- **Multiple completions per tick** with carry-over (G Appendix A; 04 §3.2). During takeoff the last ten technologies fall in under a minute.
- **Research per paper** (04 §0): `Π = m^k × (1 + 0.1·L_rp) × (1 + Seminar productivity)`. It applies to every paper in every Seminar.
  - m = g^r, with g = `meta.world_settings.returns_to_research.g` (1.5), computed once with `det::pow` (§4.1), where r comes from the world setting *Returns to research*. The data's `research-per-paper` effects say `multiplier_from: returns_to_research`, never a literal (J14).
  - The default r is ln 2 / ln g, shown as 1.71 (R5-gate D12b), so its m is exactly 2: the engine sets m = 2 for that preset instead of computing the power, so that m^k is an exact power of two on every browser.
  - Powers come from per-level cached products (§4.1).
- ***Research scheduling*** (L6; 04 §5.1; R5-gate D10). It runs in phase 7 after research progress: right after a research completes, and otherwise every 60 ticks, while the queue holds fewer than 7 entries and at least one Researcher is installed.
  - **The order** is `meta.endgame.takeoff_order`: technology ids and `{id: level}` entries, every System-card-only technology level once, in prerequisite order (the validator checks it).
  - **Each check appends at most one entry:** walk the order, skipping entries that are researched or queued and entries passed over (below); the first remaining entry is appended if its prerequisites are all researched, and otherwise nothing is appended this check. Research therefore follows the order exactly, as the reference takeoff does (G17).
  - **Passed over:** an entry whose prerequisite closure holds an unresearched technology outside the order (*Fusion power* without *Nuclear power*, *Two-phase* and *Microfluidic cooling* without *Liquid cooling*). It is reconsidered at every check, so researching the missing technology brings it back.
  - **Infinite:** *Energy per operation*'s entry is its next level that is neither researched nor queued; it never runs out, so after *Model generation 25* the queue converges on it (04 §5.1).
  - Entries carry the byline "Queued by: Researcher". The player's entries are kept, and a toggle in the research screen disables the rule.
- **Readouts** (Literature, Field, Your year, doubling time) are computed in §5.11.

**Cost:** O(labs) inside the crafting phase, plus event handlers.

### 5.13 Trains (M2)

**Rails** use Factorio 2.0 geometry: straight, diagonal, half-diagonal, curved-a and curved-b in 16 directions, from FFF-377. Elevated rails are Space Age and are not adopted.
- The rail planner (I §2.3) builds ghost paths with A\* over rail pieces.

**The rail graph.**
- Nodes are rail ends; edges are rail pieces with lengths.
- **Signals** (regular and chain) split the graph into **blocks**: union-find over the pieces between signals, crossings included.
- A block is rebuilt only in the affected region when a rail or signal is built or removed.

**Trains.**
- A train is rolling stock ordered along a path.
- **State:** speed, front position (edge, offset), path and reserved blocks.
- **Physics** (ISO data): locomotive power 600 kW of traction (D: burner; its `energy.kw` of 1,800 is the fuel burn, ×3 by DECISIONS §18, as for the car and the Half-track), maximum speed 1.2 tiles per tick, weight, braking force, friction and air resistance.

**Signalling.**
- A train reserves blocks ahead out to its braking distance.
- A **regular signal** is green when the block beyond it is free and unreserved.
- A **chain signal** looks ahead to the next regular signal along the train's path and is green only if every block up to there can be reserved.

**Pathfinding** is A\* over the rail graph. Costs are the edge lengths plus the wiki's penalties:

| Situation on the path | Penalty |
|---|---|
| Occupied block | 2 × block length ÷ blocks from start |
| Circuit-closed signal | 1,000 |
| Train stop on the path | 2,000 |
| Stop with a stopped train | 500 |
| Train waiting at a signal | 100 + 0.1 per tick waited |

The repath triggers follow the wiki, e.g. a chain-signal wait of 5 or 30 s. Pathfinding runs on events, not per tick.

**Schedules (2.0, ISO):**
- stations, wait conditions, **interrupts** (A §3.1: enough, with no LTN-style dispatcher), train groups, stop priority and train limits;
- inserters loading wagons;
- fluid and data wagons, with pumps.

**Cost:** about 2 µs per moving train per tick; waiting trains sleep on timers or signal events.

### 5.14 Agents (bots: logistic and construction)

**Agent hubs** (roboports) have ISO areas: logistics 50×50, construction 110×110, 4 charging slots, and radar coverage of 2 chunks (2.0).

**Logistic networks** are unions of overlapping logistic areas. Each network's chests are indexed by item: provider, storage, requester, buffer and active provider.

**Agents (pool):**
- position, velocity, energy, held item stack, and a task queue (FFF-374: robots can queue several tasks);
- `lastUpdateTick`, `nextUpdateTick` and a move intention (target and speed), from which arrival times and rendered positions are derived (FFF-421).

**Movement.**
- Agents fly in straight lines (ISO; no pathfinding).
- A moving agent is updated every 20 ticks and a stationary one every 60 (FFF-421).
- The renderer extrapolates positions from `(pos, vel, lastUpdateTick)`. The snapshot exports these, so agents glide smoothly.

**Dispatch (FFF-374).**
- A task goes to the agent with the earliest **arrival time**, idle or busy.
- Busy agents are registered in the chunk where their queue is estimated to finish. The search spirals outward from the task's chunk.
- Budgets per tick: logistic requests (round-robin over requesters), construction orders (ghosts, deconstruction, upgrades, repairs), and tile ghosts scheduled separately so floors never starve buildings (ISO).
- **Item requests** (the module-request path, ISO) also deliver a Research hall's accelerators and weights (§5.5), a Seminar's Researcher, and the item a compromised machine's rollback input accepts (§5.17). Construction agents skip a compromised entity's deconstruction and upgrade orders until it is clean.

**Charging (FFF-374).** Hub choice weighs:
- distance;
- the charging queue;
- agents already en route;
- free charging slots;
- when low on energy, a preference for hubs closer to the destination (this fixes the classic lake loop).

**Personal roboport.** Equipment grid, with construction agents flying from the character (era equipment, B L14). Arrives in M3.

**Two agent kinds** (D): construction agents run planners and need no checkpoint; logistic agents are learned. Logistic agents therefore make a runaway link, but only inside one hub's logistic area (§5.17).

**Cost:** about 1 µs per agent update, so 5,000 agents cost about 0.3 ms per tick, plus dispatch about 0.2 ms.

### 5.15 The circuit network (M2 basic, M3 full)

**Wires.** Red and green wires connect circuit connectors. Networks are connected components per colour, maintained by union-find; a removal rebuilds the component.

**Signals.** A signal frame is a sparse sorted array of `(signalKey: u32, value: i32)` pairs. The key packs signal type (item, fluid, virtual, recipe, entity), prototype index and quality. Arithmetic wraps at 32 bits (ISO).

**Per tick.**
- Each network's frame for tick *t* is the sum of its members' outputs written at *t*−1. Every combinator therefore adds one tick of latency (ISO).
- A network is **dirty** only if a member's output changed. Combinators whose input networks are clean skip evaluation, because they are pure functions. The exception is the selector combinator's random and count modes, which are keyed by tick.

**Combinators** (D's names, Factorio 2.0 semantics, FFF-384):

| Ours | Factorio | Notes |
|---|---|---|
| Decision unit | Decider | Multiple conditions and multiple outputs, per-wire input selection (R3-accuracy M1: not a threshold unit) |
| Arithmetic unit | Arithmetic | |
| Bias unit | Constant | Sections |
| Selector unit | Selector | All modes; random via counter RNG |

Also the display panel, programmable speaker and power switch.

**The Compromised signal** (L3). A compromised machine outputs the virtual signal Compromised = 1 on every connected wire while it is compromised, whether or not it has power (§5.17). A tripwire that cuts the cluster's power therefore keeps seeing the signal until the machines are clean.

**Compromised-only connectors** (R5-gate D7). Every susceptible entity type has a circuit connector. A type whose Factorio 2.0 counterpart has none (labs and beacons, so Seminars and Switches) gets one that outputs only the Compromised signal, reads nothing and has no control behaviour; its position comes from the sprite manifest like every connector's (§2.4).

**Control behaviours** (enable or disable conditions, and read or set) on:
- inserters, belts (the whole-line reader), assemblers (read contents, **set recipe**), chests, drills;
- pumps, tanks, train stops, rail signals, hubs, accumulators, lamps (colour);
- radar transmission: one channel per surface and colour (FFF-402).

**Cost:** about 300 ns per evaluated combinator. The dirty-skip makes static logic free.

### 5.16 Quality (M3)

- **Five tiers** (H): Standard, Selected, Verified, Audited, Reference. The item key carries the tier *index* 0–4; the tier's *level* (0, 1, 2, 3, 5) scales stats (§4.3). A tier is reachable once its `unlocked_by` technology is researched (`meta.quality.tiers`).
- **Rolls** (Space Age, ISO). The machine's Comparators (quality modules) give a quality chance *q*; Switches never carry quality. On each craft, each non-catalyst product upgrades one tier with probability *q*, then by a further tier with `next_tier_chance` (10%) each, up to the cap below. Both rolls use counter RNG (§4.3). Quality never drops.
- **The verifier ladder** (A §5.1's BEND; L5).
  - Max output tier index = 1 + the **lowest** tier index among the machine's Comparators, capped by the highest unlocked tier.
  - "Tier" here is the Comparator item's quality, not its module number (Comparator 1–3).
  - A machine without Comparators does not roll.
  - `maxOutputQuality` is derived when modules change, and cached with `speedEff`.
- **Catalysts** (L5). Catalyst products carry `affected_by_quality: false`: they return at the recipe's quality, and only the non-catalyst remainder rolls (§4.3). Serving or copying a checkpoint therefore never upgrades it for free (B L6).
- **Recipe quality** (L5; ISO 2.0). A machine crafts its recipe at a selected quality, and every ingredient, the catalyst included, must have that quality. An Endpoint's v for the leak is its recipe quality (03 §3.1).
- **Entities placed from quality items** scale the stats that the overlay's quality table lists for their type (ISO 2.0: crafting speed, module effects, and so on) by 1 + `stat_bonus_per_level` × level (L5). The exception is the Switch's transmission, which adds 0.2 per level (1.5 → 2.5 at Reference), as Factorio 2.0's beacon does.
- **The Verifier** (recycler) runs generated 25% recipes (§2.4) and keeps quality (ISO).
- **Model quality is hidden** until *Interpretability* (`show-model-quality`). Before it, the UI shows no quality on checkpoints, controllers, Researchers, payloads or agents; the simulation tracks it all along.
- **Model collapse does not touch quality.** It is a speed factor on the text-trained recipes (§5.5, §5.11; 03 §2.2).
- **UI:** quality pips on slots; Alt+Wheel (I §2.3).

### 5.17 Runaways: *Contained* (M3) and *Wild* (M5)

The rules are 03 §3's; the numbers are `meta.runaways`'s. Under the *Off* preset none of this exists: there is no leak and no Compromised signal, Monitors are inert, and the rollback input never appears (U39).

**Deploying buildings and their model tier A** (03 §3.1):
- **Endpoints:** a global value, the highest of 1, 2 and 3 whose technology is researched: *Deep learning*, *Attention*, *Instruction tuning* (`meta.runaways.model_tier.endpoint`; *Instruction tuning* does not require *Attention*, so the highest counts, not the latest; U37; never 4). v is the Endpoint's recipe quality.
- **Research halls:** 4 (DECISIONS §28). v comes from the weights item.
- **Researcher-staffed Seminars:** 4. v comes from the Researcher.
- **The Verification count** O is the number of `verification_techs` researched (R3-accuracy M3; formerly "Oversight").

**The leak** (L4). Every 60 ticks, in phase 13 right after the world text (§4.6):
- **Accrual.** For every non-compromised deploying building i: Δᵢ = (`leak per_hour` ÷ 3,600 s) × 1 s × Aᵢ × (1 − vᵢ) × (1 − `verification_step` × O) × wᵢ. Here wᵢ is the fraction of the last 60 ticks in which its crafting or research progress advanced (U27); a throttled machine still advances (U15). Then ℓᵢ += Δᵢ and L += Δᵢ.
- **Removal.** When a deploying building is removed, or stops deploying (a Seminar's Researcher is taken out), L −= ℓᵢ, floored at 0, and ℓᵢ = 0, so that L stays the sum of the shares of deploying buildings; a Researcher inserted later starts from ℓᵢ = 0.
- **Compromise.** When L ≥ 1, the engine picks the non-compromised deploying building with the largest ℓᵢ (ties: the lowest serial).
  - If there is none, L is held at 1.
  - Otherwise that building is compromised as the first member of a new infection of tier Aᵢ, ℓᵢ = 0, and L −= 1.
- **Readouts:** L with two decimals, and the building that holds the largest share with its own position, tier and quality ("?" before *Interpretability*), the rate and the deployment count, and the verification count (03 §3.2; R5-gate D8).

**Susceptible machines** (03 §3.1):
- every computing machine (a `heat.class`: Switches and Researcher-staffed Seminars included);
- any machine holding a Learned or Distilled controller in a module slot.

Immune (R5-gate D5; `meta.runaways.susceptible`): furnaces, drills, plain assemblers, Crawlers, Seminars without a Researcher, cooling buildings and the Verifier, **unless they hold a Learned or Distilled controller**; and always belts, inserters, power plants, Terminals, Monitors, the Constructor (not a computing machine) and towns.

**A compromised machine** (L3; `flags.compromised` plus its infection id):
1. **Signal.** It outputs Compromised = 1 on every connected wire while compromised, whether or not it has power (§5.15).
2. **Locked.** It cannot be mined, deconstructed, fast-replaced or upgraded, or emptied of modules, a Researcher, accelerators or weights. The refusal is the flying text "Compromised. Cut its power." (08-text §8.3). Deconstruction and upgrade marks may be placed, and agents skip it until it is clean (§5.2, §5.14).
3. **Frozen.**
   - Its crafting or research progress stops: nothing is consumed or produced. Inventories keep their ISO insertion limits.
   - It draws its full *working* power, not its idle drain, and emits it as heat.
   - Its leak share stops accruing.
   - A compromised Switch transmits nothing (§5.5).
4. **Powered** (U29) means electric satisfaction > 0 in the entity's own class (interruptible for halls), as last computed: the zero-power counter advances in phase 4 on the current tick's value, and a spread timer, which fires in phase 2, reads the previous tick's (§4.6). A Seminar holding a Researcher draws in both classes, so for it the value is min(normal satisfaction, u_p) (R5-gate D12f).
5. **The zero-power counter** (U31) counts consecutive ticks at satisfaction 0 and resets on any tick above 0. At 1,800 ticks (`power_off_s` = 30 s) the machine is clean.
   - A brownout therefore never cleans anything.
   - A 30-second blackout of a whole network cleans every compromised machine on it.
6. It shows an icon, raises the *Compromised* alert, and carries 08's tooltip.

**The rollback input** (L2). It exists only while the machine is compromised, and only after *Rollback recovery* (the `rollback` effect).
- It has one slot, which accepts exactly one item of the machine's **rollback type**: `checkpoint` when the infection's tier is 1–3, `frontier-checkpoint` when it is 4.
- It is fed like an ammo slot: by hand, fast transfer, an enabled inserter, or an agent's item request.
- The item is consumed on arrival, and the machine is clean at once.
- No other slot changes its acceptance rules. While the machine is compromised, an item of its rollback type goes to the rollback input before any other slot that would accept it (an Endpoint's recipe checkpoint, a Research hall's empty weights slot).
- 07 §10.4 shows the input, outlined in the compromised band.

**Links** (03 §3.3; U36). Spread travels only along these, **one hop at a time** (R5-gate D6): two machines are linked when they share one data-line network, one exchange, one Switch area or one hub area, and a link never chains through a third machine:
- the same **data-line network** (§5.8);
- the same **exchange**: every building on its taps, plus the data networks they feed;
- the same **Switch area**: the Switch itself, and every machine whose footprint overlaps its 9×9 supply area;
- **Logistic agents** (DECISIONS §27): source and target must both lie inside the logistic area of *one* agent hub whose network holds at least one Logistic agent, counted in hubs and in flight.
- **Never:** circuit and power wires, belts, pipes, inserters, trains.

The engine keeps, per susceptible machine, its **link memberships**: its data-line network, its exchange (a tap building, or a machine on a data-line network such a building feeds) and the Switch areas it overlaps, rebuilt on the relevant builds; that is cheap and rare. A spread target must share one membership with a powered member. The agent link is a spatial query over hub areas, made when the spread timer fires. **Link clusters** (union-find over the same memberships) are kept for the containment overlay only: they show where an infection can reach eventually, one hop per interval (03 §3.3).

**Spread** (DECISIONS §27: linear; 03 §3.3).
- **Infections.** An infection is one leak compromise plus every machine it spreads to. Its id is the serial of its first member, and its tier is fixed when it is created.
- **One timer per infection**, with its tier's interval from `meta.runaways.spread.interval_s` (60, 45, 30 and 20 s), started at the compromise.
- **On firing**, the engine searches from the infection's **powered** members for the nearest uncompromised, powered, susceptible machine linked to one of them (centre to centre; ties: the lowest target serial, then the lowest source serial). That machine is compromised and joins the infection.
- **Effects.** An infection gains at most one machine per interval. A firing with no target does nothing, and the timer keeps cycling.
- **Leaving.** A cleaned machine leaves its infection. When an infection has no members, it ends and its timer is cancelled.

**Cleaning.**
- **Zero power for 30 consecutive seconds** (above).
- **Monitors** (U35):
  - Range is a centre-to-centre distance ≤ `range` (24).
  - Each Monitor's cycle advances at its satisfaction × (1 + Σ `monitor-rate`). A charged Monitor waits, then fires on the tick a target appears.
  - On firing, it cleans the nearest compromised machine in range (ties: the lowest serial) and consumes 1 Evaluation set only when it cleans. Without a set, it does nothing.
  - The target search is a spatial query over the short compromised list. Monitors are not susceptible.
- **Rollback** (above).

**Escape** exists only under *Wild* (03 §3.6).
- Each compromised machine has its own escape timer: 120, 90, 60 or 45 s by infection tier. It restarts after every expiry, a nest founded or not, while the machine stays compromised (R5-gate D13).
- When it runs out and the machine is still compromised and has a path out, a nest is founded. Each infection founds at most one nest per 10 minutes.
- Nests are never placed on town tiles, nor within 32 tiles of a town footprint (U40). The 3-chunk distance is measured from the agent hubs' construction areas or, with no hub, from the Site's built area: every chunk that holds one of its entities (R5-gate D13).
- Under *Contained* a compromised machine stays compromised, and its infection keeps spreading, until it is cleaned.

**Cost:** all event- and timer-driven, and zero when nothing is compromised.

***Wild*** is Factorio's military loop, with F's numbers and spec/03's text:
- units and spawners;
- **pathfinding** as in FFF-317:
  - each chunk is reduced to abstract nodes, one per connected land region, ignoring entities, so buildings never invalidate the graph;
  - an abstract search runs backward from the goal and supplies the heuristic for tile-level A\*; it is cached and resumed across queries;
  - the tile search may deviate around entities;
  - budget: about 1,000 node expansions per tick;
- unit groups and attack waves;
- expansion;
- health, damage and resistances; **damage categories** (R5-gate D13): `meta.damage_categories` is the registry, every damage dealer declares one (`extra.ammo_category`, an ammo item's category or `damage_category`, an equipment's `ammo_category`), and `ammo-damage` and `gun-speed` bonuses apply by category (*Arc damage*'s arc bonus to the arc turret);
- turrets (gun, laser and arc), projectiles and acid puddles;
- walls and gates, repair packs, artillery and interceptors.

Target: 1,000 active units in ≤ 2 ms per tick. **Deferred to M5** (§14).

### 5.18 Map generation

**A pure function** `generate_chunk(seed, settings, surface, cx, cy) → ChunkData`, in the Rust crate `worldgen` (§2.2). It runs in the worldgen workers as `gen.wasm`, inside the sim for inline commits (below), and natively in tests, and its output never depends on generation order or on where it ran (D12).

- **Region-based features** (towns, resource spots, records stores) come from coarse cells, e.g. 8×8 chunks for towns. Each cell is seeded by `hash(seed, layer, rx, ry)`. A chunk queries the cells overlapping it.
- **Overlaps** resolve by a fixed priority. They never depend on which chunk was generated first.
- **The town layer is queryable without generating chunks.** The sim asks it for campus positions (staffing, §5.10, U4) and footprints. A town's cell key is its stable id.

**Stages per chunk** (2D simplex noise ported to Rust with `+ − × floor` only and pinned by golden values from simplex-noise 4.0.3; fractal sums; FFF-390's ideas, written as Rust functions rather than a string DSL):
1. **Climate** (01 §3), evaluated at the chunk centre.
   - `θ = clamp(14 + y/80 + n, −15, 35)` °C. The noise n is one octave of simplex noise at a 512-tile wavelength and ±3 K amplitude, on its own seed stream `ambient` (P9). The numbers come from `meta.heat.ambient`.
   - Sunlight `s = clamp(1 + y/5,700, 0.6, 1.3)`, also per chunk centre (P8).
   - Moisture.
   - *Climate compass: off* sets θ = 14 °C and s = 1.
2. **Elevation**, from continent, island and coastline octaves. Water is below 0. Lake density scales with moisture (01 §2). The starting area is guaranteed land.
3. **Tiles.** Biomes by θ (tundra, boreal, temperate, steppe, desert; 01 §2), blended over ±2 K with tile noise. Each biome draws from the `tiles.yaml` tiles that name it, and each tile id carries its κ (§4.4, §5.9).
4. **Cliffs** are marching squares on elevation contours at fixed intervals. Elevation is a pure function, so sampling the chunk border makes cliffs continuous across chunks.
5. **Resources.**
   - Spot noise per resource: cell-jittered spots whose radius scales with the *size* setting and whose probability scales with *frequency*.
   - Amount per tile = richness × falloff × (1 + noise). Richness grows with distance from spawn (ISO).
   - No uranium within 512 tiles of spawn. The starting patches are placed by stage 10.
6. **Trees** by forest noise × moisture × θ. None in deserts or on snow. Each tree is a `world.yaml` tree with 4 leaf stages (§5.9).
7. **Rocks** are `world.yaml` rocks: Factorio 2.0's sizes, yielding quartz (D: quartz plays stone) and coal.
8. **Decoratives** are seeded per chunk; only the seed is stored.
9. **Towns** (01 §5).
   - **Grid:** 256×256-tile cells, with spawn at the centre of cell (0, 0). Each other cell holds a town with probability P(d), and the class table gives footprint and institutions by distance band.
   - **Site:** up to 8 seeded candidates in the cell's central 160×160 square. A candidate must be ≥ 85% land, contain no cliff, overlap resource patches by ≤ 5%, and keep 64 tiles from every other footprint.
   - **Order independence.** The 64-tile rule couples neighbouring cells. It is resolved by a fixed priority, the cell hash: a candidate is tested only against higher-priority neighbours' accepted footprints, which are computed through those neighbours with an explicit work stack (no native recursion, D19) and memoised per worker. The land, cliff and resource tests sample the same pure functions. The result never depends on which chunk generates first.
   - **Footprint** (U51). Every footprint tile becomes a town tile, water included.
   - **Layout** (P10). Streets 2 tiles wide every 8 tiles, both ways. The blocks between them are building-block tiles; a generator seeded per cell picks each block's building sprite. Streets are walkable and drivable; building blocks block the player and vehicles like rocks. Nothing is buildable on either (§4.4).
   - **Institutions at the edge** (01 §5.4):
     - the **university**, an 8×8 campus world object. It sits on the footprint edge whose R = 48 coverage strip outside the footprint holds the most buildable tiles (ties: N, E, S, W; U53). The starting college's campus faces spawn instead (stage 10);
     - the **library**, an archive blob outside the footprint. It has n = clamp(round(total ÷ 1,500), 16, 400) tiles; each holds ⌊total ÷ n⌋ records, and the first (total mod n) tiles in row-major order hold one more, so totals are exact (U55);
     - the **exchange**: taps clustered 6–16 tiles outside, ≥ 4 tiles apart, and the cosmetic exchange office inside the footprint edge.
   - **Records stores** in old mines (01 §6.2) appear away from towns, by spot noise, each with a cosmetic mine entrance. A store with any blob tile out of the map is rejected (U58).
   - Campuses, exchange offices and mine entrances are world objects, and town buildings are tiles (§4.4). None of them is an entity.
   - **Era skins** are global, switched by W at 01 §5.3's thresholds (U57).
   - **Names** (R5-gate D1; 01 §5.3, 08 §10.4). Drawn from `text.yaml`'s pools on the cell's own name stream. A name held by a higher-priority town within `town_names.uniqueness.within_cells` (8) cells is rejected and redrawn, up to `redraws` (8) times; then `suffix` (" II", then " III" …) is appended. Priority is the cell hash of the footprint rule above, and a town's name depends only on higher-priority towns within 8 cells whose possible draws contain it, so it is computed the same way (an explicit stack, memoised) and never depends on generation order. Unique within 8 cells (2,048 tiles), not per map.
10. **The starting area** (01 §9; DECISIONS §32). Every guarantee is constructive: the stage places the feature and then checks it, and S-G1 sweeps 1,000 seeds (§10.4). `sim_new_world` generates every chunk within the pre-generation radius of spawn inline, before tick 1, so the character never stands on ungenerated ground.
    - **The starting college town.** Its campus is on the footprint edge that faces spawn, with spawn 16–32 tiles from the campus edge (at most 16 tiles to the side), so that spawn and the footprint lie in the coverage square.
    - The **four starting patches** (iron, copper, coal, quartz; whole blobs) and the **80,000-record archive** also lie inside that coverage square.
    - The coverage holds the buildable land 01 §9 requires (≥ 7,500 buildable tiles and a 40 × 40 buildable square; U54 as amended).
    - The lake, forest, climate and clear-ground guarantees are 01 §9's.
    - **The starting exchange tap** (01 §9): one tap at the college, initial yield 200% (`meta.world.exchange.starting_tap_initial_yield`), floor f = 15%, closing at σ = 0.70; scenery until *Crawling*.
    - **The Laboratory salvage** (DECISIONS §33; `meta.start.salvage`, its single definition):
      - `wreck_pieces` (6) wreck pieces and one crate, within `within_tiles` (16) of spawn;
      - each piece yields `per_piece` (5 iron plates), and the crate yields `crate` (1 radar, 10 logic boards, 20 copper cable);
      - each is mined by hand in `mining_time`.

**Map size.** Factorio's width and height settings bound the map, e.g. *Ribbon world*'s 128-tile height (07-ui §17). Chunks outside the bounds are filled with the out-of-map tile. The sim refuses building, walking and driving there, and heat is not diffused into them: the edge reflects (§5.9, U10).

**The commit protocol** keeps determinism with asynchronous workers.
- The sim asks for a chunk at tick *t*: on charting, on a radar scan, or when the chunk enters a character's pre-generation radius. Agents and heat diffusion never trigger generation. Agents skip ungenerated chunks, and heat sent toward them is lost to the Map edge sink (§5.9).
- The request `(surface, cx, cy, commit tick)` is world state: it is saved in `WORLDGEN_PENDING` and survives a load (D8). The shell sends it to the worldgen pool (§15.9).
- **Deduplicated, bounded and ordered** (B1-r1 16). A chunk that is already generated or already pending is not requested again. A tick commits at most **8** chunks: a new request takes the first tick from t + 30 on that has fewer than 8 commits scheduled, so a burst (a character running into new land, a radar sweep, eight players exploring) spreads over ticks instead of stalling one. Requests made in one tick are scheduled in ascending (surface, cy, cx), and a tick's commits run in that order too. At 1–2 ms per inline chunk, the bound keeps a tick's worst inline cost near one catch-up slice (12 ms, §3.3).
- At the commit tick (phase 3), the sim commits the worker's result. **If the result has not arrived, the sim generates the chunk itself** with the same crate, and the late answer is ignored. That is a stall of about 1–2 ms per chunk, reported in F5. It replaces round 5's "the sim waits for the worker", which would need a blocking wait across threads.
- Generation is pure and the commit tick depends only on sim state, so replays, joins and native tests are identical with or without a pool (D12, R28). Catch-up, replays and native tests generate inline throughout.
- Pre-generation keeps a radius of 7 chunks around each character and radar targets 2 chunks ahead.

**Map preview** (I §4.20) samples the same functions at 1 sample per 8 tiles over 1,024×1,024 tiles in a worldgen worker (`gen_preview`, §15.9), in about 0.3 s.

**Cost:** about 1–2 ms per chunk per worker. The initial area of about 15×15 chunks takes under 1 s with 4 workers.

### 5.19 Charting, radar and fog

- **Charting:**
  - each chunk has a *charted* bit and *keep-revealed* counters (FFF-421). Characters, radars and hubs register areas, and overlaps cost nothing;
  - radars also sweep distant sectors on their own cadence.
- **The chart image** is 32×32 RGBA per chunk: tile map colours plus entity map colours. Extraction generates it when a chunk is charted or changes while the map view or minimap watches it, and sends it in the packet's `CHART` section (§15.4). A pristine chunk has no entities, so its image is a pure function of the seed: the shell asks the worldgen pool for it (`gen_chart`, §15.9) and forwards it to the main thread, and the sim sends `CHART` records only for modified chunks. Opening the map over a late game's 30,000 charted chunks therefore costs the sim nothing (B1-r1 16).
- **Fog (ISO, I §3.15).** A charted chunk that is not watched shows its **last snapshot**. The worker freezes the chunk's view data (§3.4) when the chunk stops being watched and serves that copy until it is watched again.
  - In the peaceful slice nothing can change unseen in a way that matters, so the slice renders the live state under a fog tint. The frozen snapshots arrive in M2 (§14); radar itself is in the slice.

### 5.20 Statistics, achievements, the run report and the rate calculator

**Production statistics** (I §4.12).
- Per-tick counters, produced and consumed, per item, fluid, building, heat source and sink (the Map edge included, §5.9), and the **Papers** pseudo-item: research progress actually produced, counted in papers with productivity included (FFF-408's "science" item; 07-ui §11).
- Flushed every 60 ticks into ring buffers at 9 precisions (5 s to 1000 h, and All) of 300 points each, by hierarchical downsampling. They are `f32` and saved. They are display data: beside them the sim keeps exact all-time totals per item, for production and for hand-crafting (float64, integer-valued, saved in `STATS`), and the run report reads only those (Float32 is exact only to 2²⁴, and 07 §13.3 prints exact integers).
- Electric statistics per network likewise.
- The two model-collapse windows (P_crawl, P_syn; §5.11) are separate, exact 10-minute rings, because the statistics rings are display data.
- **Cost:** a few µs per tick.

**Achievements** (08-text §6, canonical per DECISIONS §20).
- Their conditions are machine-readable data in `text.yaml` (R4-ui): `condition: {type, …}` with ids and thresholds. The condition types form an engine registry, listed in 08-text §6's table (craft-while, power-rise-after-install, install-before-compromise, takeoff-time and the rest). The data stage checks that every type exists (§2.4).
- They are evaluated on events and every 60 ticks, and persisted per save (`GLOBALS`) and globally (IndexedDB `runHistory`, the *Run history* of 07-ui §19.2). Per-player conditions (hand-crafting) read the per-player accumulators of §4.4; in multiplayer each client records its own player's achievements (11 §8.3).
- `win`'s `race_won` (R5-gate D12c) holds when a race mode is on and the field had not reached W = 90 when the Final-report run completed. A victory after a race loss shows the run report again without the race line.
- The **achievements window** (07-ui §13.7, M4; R5-gate D12i) reads the same records.
- Example: *Jevons paradox* (U63) compares the mean electricity consumption over the 60 min after the 100th Distilled controller is installed with the mean over the 60 min before. It needs an event hook plus a statistics query.

**Milestones** (07-ui §15). The list is `text.yaml` data. Each first-time event is logged with its game time and saved.

**The run report** (04 §8; P20–P23, U64). Its fields are read at the moment of victory from saved accumulators:
- **Loop closed** and **Takeoff**: the closure tick, and the time from closure to the completion of *Model generation 25*.
- **Overhang at closure**: accelerators by 04 §7's definition, i.e. loaded in halls, inside Researchers, and in any inventory, belt, hand, vehicle, agent or machine buffer. The snapshot is taken in the tick the closure event fires, at the event itself (phase 7), before that tick's inserter phase (P23).
- **Peak research rate**: the largest number of technology completions in any 600-s window sliding per tick, × 6 per hour (P22). Every level of a finite technology counts; infinite technologies and the hidden *Loop closed* do not (R5-gate D12a). A ring of recent completion ticks and the best count so far are saved.
- **Fastest doubling**: the minimum of the doubling-time readout (§5.11), taken only at new maxima of R̄ (R5-gate D11).
- **Peak power**: the highest 60-s sliding mean of the surface's total electric production, from per-tick totals (P21).
- **Hand-crafted items**: every item the characters crafted, intermediates included: the sum of the per-player accumulators (§4.4), which multiplayer also shows per player (11 §8.3).
- **Most-produced item**: the real item (not a fluid, not the Papers pseudo-item) with the highest exact all-time production total. Ties (equal totals) go to the item that comes first in data order (U64). This gives *Objective, inferred*.

**The rate calculator** (07-ui §16.1; Alt+X).
- The selection tool sends a read-only `query(rates, entities)`, not an `InputAction`.
- The sim answers it between ticks (§15.5), computing each selected machine's current and full-speed rates with the **same** `effective_rate(entity)` functions it uses for production. That covers modules, Switches (with their throttle), quality, bonuses and productivity, plus the current-mode multipliers for energy, thermal throttling, staffing and model collapse.
- Machines covered: crafting machines, furnaces, Keypunches, drills, Crawlers, offshore pumps, boilers, generators, solar panels and Seminars.
- It also returns power, heat and staff demand.
- The window shows net rates per item and the balancing machine counts. Tooltips and the rate calculator can never disagree with the simulation.

**Even distribution** (07-ui §16, a setting, default off). Ctrl-drag spreads the hand evenly across the entities swept, as one `distribute(entities[], itemKey, count)` action with a deterministic split. I's F8 test keeps vanilla behaviour.

---

## 6. Rendering

### 6.1 Decision: a custom WebGL2 renderer, without PixiJS

**Why custom.**
- **Immediate mode matches the data flow.** Every frame the renderer turns the view model plus the packet's dynamic sections (§15.4) into draw lists. A retained scene graph (PixiJS's `Sprite` objects) would duplicate 10⁵ objects of simulation state and churn them.
- **Measured on this host** (Appendix A): instanced quads in Chrome 156 on SwiftShader are 5–30× slower than expanded indexed quads. For example, 20k sprites of 32 px take 382 ms against 73 ms, and 150k sprites of 8 px take 3.1 s against 0.10 s.
  - Claude verifies visuals on this exact stack, so the batcher uses **expanded quads**.
  - On real GPUs the two paths cost the same for sprites.
- **What we need is simple in raw WebGL2:** texture arrays, a terrain shader, shadow and light render targets, a ghost shader, overlay and chart shaders, a LUT post-process and multiple viewports.
- Rejected: **PixiJS 8.22** (scene-graph overhead and GC at our sprite counts); **WebGPU** (the brief says WebGL2, which already meets every need; the renderer's thin GL layer can be ported later).

**Size:** about 8–10k lines of TypeScript, with no runtime dependencies.

### 6.2 Frame structure

Each frame, for each viewport (the world, the minimap, GUI previews, pin cameras):

1. **Terrain:** one quad per visible chunk through the terrain shader (§6.5), with the water-lining and woodland tint of §9.9.
2. **Ground layers:** decals and decoratives, resource sprites, floor entities (belts, rail beds, pipe covers), ground items, then **belt items**, expanded from the packet's gap arrays (§15.4).
3. **Shadow pass** into a half-resolution R8 render target with `MAX` blending, so overlapping shadows never double-darken (§9.8). Composited over the ground layers before objects are drawn, with the style's `SHADOW_COMPOSITE` (§15.7; *Survey* hatches shadows), so shadows fall on the ground, belts and items but not on other buildings, as in Factorio.
4. **Objects,** y-sorted: buildings, trees, poles, chests, inserter bases.
5. **Higher objects:** inserter arms and held items, pole wires (catenary strips), signals.
6. **Air objects:** agents and their shadows.
7. **Lights and the night grade:** a light render target at half resolution (lamps, machine light sprites; RGBA16F where `EXT_color_buffer_half_float` exists, otherwise RGBA8, §9.8), then **one** full-screen pass that applies the style's day and night rules (`LIGHT_COMPOSITE_DAY`, `NIGHT_GRADE`, §15.7) from the packet's daylight. In *Survey* that pass applies the warm stain by day and the cyanotype with the lights' reveal at night (§9.8). It is the only place the night grade is applied (codex B2-r1 finding 11). Round 5's composite, `colour × (ambient(dayTable) + light)`, is the plain style's.
8. **World overlays,** drawn after the grade and therefore never night-graded, so they read the same by day and by night (as in Factorio): ghosts (hologram shader), build previews (I's tints), selection brackets, coverage (power, staffing), thermal overlay, alt-mode icons and arrows, the status-light layer, warning icons, edge arrows.
9. **Post:** the colour-blind LUT when enabled (a 3D texture), over everything including the overlays. There is no second night grade here.

Flying text and labels near the cursor are DOM (I §8.1).

### 6.3 The sprite batcher

- **Expanded quads** go into one growable `ArrayBuffer`, viewed as `Float32Array` and `Uint32Array`.
- **The vertex format** is 20 bytes:
  - `pos: 2 × f32`, camera-relative (subtracted from the camera in `f64` from the packet's integer positions, §15.7);
  - `uv: 2 × u16` normalized;
  - `layer: u16` (the texture-array page) plus `flags: u16` (shader variant bits);
  - `tint: RGBA8`.
- **One static `Uint32` index buffer** (0, 1, 2, 2, 1, 3, …) serves 2¹⁶ quads per draw.
- **Draw calls:** one per layer and texture array. The colour, shadow, light, icon and chart arrays each bind once.
- **Uploads:** `bufferSubData` of the used range, in two orphaned buffers that alternate.
- **CPU cost:** filling 100k sprites is about 2 ms on the laptop (Appendix A extrapolation).

**v1 rebuilds all visible geometry every frame.** That is simple and makes tints, animation and status free. Static per-chunk vertex buffers for terrain decor and building bases are an optimisation, kept for when profiling asks for it (M6).

### 6.4 Atlases and the sprite manifest

- **Pages:** layers of one `TEXTURE_2D_ARRAY` per kind, with immutable storage. WebGL2 guarantees 2048² textures and ≥ 256 layers, so this works on every target. The levels come with the page, and a page's level 1 is its Normal resolution (§9.2).
- **Separate arrays** (formats and page sizes: §9.2, §9.7):
  - colour (premultiplied; 2048² pages);
  - shadow masks (one channel);
  - lights;
  - icons (also exported as WebP sheets for CSS, I §8.1; §9.3).
- **The manifest** `public/atlases/sprites.json` maps each sprite set's parts to frames (array, page, rectangle and anchor) through explicit index tables over named axes; its shape is §15.7's (version 2). Animation layers are packed as units.
- **Loading by group** (§9.7): atlas groups (`core`, one per unlocking technology or a few merged, town skins, biomes) stream by priority; a set whose page is not resident draws its greybox, and a page without its High level draws its Normal levels.
- **Transport and decoding** (§9.2, §9.7): KTX2 files, transcoded in the asset worker to the first GPU format that passed its probe, then uploaded on the main thread with `compressedTexSubImage3D` (`texSubImage3D` for the uncompressed fallback), at most 2 ms per frame.
- **Allocation and context loss** (§6.13): every array is allocated once at load for the resolution mode; after a lost context the renderer re-allocates and the asset worker re-uploads from its cache of compressed pages.

### 6.5 Terrain, water and decoratives

- **Terrain** is one quad per chunk. The fragment shader reads:
  - the chunk's tile ids (the dense ids of `tiles.yaml`, §4.4) from a 34×34 R8 data texture (one-tile border), held in a texture array with one layer per resident chunk;
  - per-tile-type **material textures** (the engine overlay maps tile ids to materials): seamless 512² textures covering 8×8 tiles each, with variants (§9.9);
  - a per-chunk RG8 texture at 4 texels per tile with a 3-tile border, which the main thread computes when the chunk enters the held set: the shore distance for the water-lining (red) and the woodland tint (green) (§9.9).
- **Map colours** of tiles are design data (`map_color`); the chart (§5.19) and the minimap use them.
- **Edges** between tile types blend through a noise mask in the shader. That yields organic boundaries without Factorio's hand-drawn transition sprites (a presentation choice).
- **Concrete, town streets and town blocks** are tile types with crisp edges (a flag skips the noise blend). Building blocks get a building sprite per block, chosen by the town generator and skinned by era. The campus and landmarks are world-object sprites (§4.4).
- **Water** is a tile type in the style's water tones, with water-lining and an inked shoreline (§9.9).
- **Decoratives and trees** are sprites:
  - trees: 10 species × 4 variants × leaf stages, plus shadows;
  - decorative density is capped per chunk.

### 6.6 Layers, sorting and culling

**Sorting.**
- Object sprites sort by `(bottomY, x, serial)` within each draw layer. Chunks are visited in row order, so tall sprites that cross a chunk border still overlap correctly.
- A per-frame counting sort by tile row keeps sorting O(n).

**Culling.**
- At chunk level: the view rectangle plus a 6-tile margin, the 2.0 value chosen because agents move only every 20 ticks.
- Then per sprite by bounding box.

### 6.7 Shadows and lights

- **Shadows** are pre-rendered alpha masks from Blender's shadow-catcher pass (§9.1), cast to the east, as in Factorio, from a key light in the north-west, and drawn with the style's shadow composite (§15.7).
- **Air objects** cast offset shadows.
- **Lights:** lamps and machine light sprites (from Blender's emission pass), applied by the style's light composite (§15.7). Their intensity follows the packet's daylight and each entity's `light` value in `DYN` (§15.4).

### 6.8 Animation and dynamic objects

- **Machine animations** advance only while working, by `speed_eff`: a presentation field per entity (§4.5), exported as the phase in `DYN` (§15.4).
- **Belts:** `frame = (tick × speed × framesPerTile ÷ 256) mod frames`.
- **Belt items** are expanded on the main thread from per-line gap arrays and the line's cached geometry (§15.4), inside the batcher's fill loop.
- **Inserter arms** are drawn from (θ, *r*) as rotated part sprites (base, arm, hand open or closed), with oblique compensation.
- **Agents** and **trains** are extrapolated from `MOVERS` records (§15.4):
  - rolling stock uses 64 pre-rendered orientations;
  - agents 16.
- Smoke and particles are render-only, spawned from `DYN` state and events with a seeded counter (§9.8), never simulated.

### 6.9 Alt-mode, previews, selection and overlays

- **Alt-mode** (I §3.14): recipe and product icons on a dark backdrop; arrows for drills, inserters and fluid connections; module icons; and the status-light layer (A §10). All are drawn from the icon array.
- **Build previews** use I's tints and context previews: pole supply areas, drill areas, inserter pickup and drop markers, underground pairing lines (green at maximum range), and the offshore pump facing water.
- **The coverage overlays** (power, staffing and agent areas) draw the union of rectangles into a coverage target, then tint it. Staffing coverage squares get one hue per network: palette index (lowest university id in the network) mod 8, computed sim-side and sent as `OVERLAY_STAFFING` (§5.10, §15.4, J24; 07-ui §3.3).
- **The thermal overlay** (07-ui §3.2):
  - It uploads visible chunks' `T` (the packet's `OVERLAY_CHUNK`, §15.4) into a small texture each time the sim publishes the field (every 64 ticks), and draws it **bilinearly interpolated between chunk centres**.
  - The colour scale, its alpha rule and its contour lines are 07-ui §3.2's, uploaded as a 1D lookup texture so that 07 can change them without shader edits.
  - In the game view, a contextual tint (alpha ≤ 0.25) appears while a computing or cooling building is held or hovered. That building's T\*_eff isotherm is drawn as a contour, and a cooling building's chunk is outlined.
- **The registry** (I BEND-6, 07-ui §3.1): each overlay has up to four renderers (map, minimap in alt-mode, world contextual, world alt-mode), so the age/builder, paths-out, monitor-range and exchange overlays plug in.

### 6.10 Zoom, map view, minimap and viewports

- **Zoom** (I §3.15): 32 px per tile at 1×; closest 3×.
  - The game view zooms out to about 200 tiles across (≈ 0.3), then **seamlessly switches to chart rendering**, which continues to 1/64.
  - Steps are about ×1.1 per notch in the world and ×1.25 on the map.
- **Chart view:**
  - each chunk is a 32×32 chart image in a chart texture array (2048² layers hold 4,096 chunks each), a bounded cache of the visible chunks filled from a CPU-side store (§6.13);
  - overlays (power network, thermal, staffing, resources, tags, trains, agents, pipelines) draw on top;
  - uncharted chunks are black; unwatched ones are dimmed.
- **The minimap** uses the same chart renderer in a scissored viewport.
- **Viewports.** DOM elements (the minimap, the entity-window preview, pin and alert cameras) register *holes*: their rectangles, re-measured on layout change and never inside the frame loop.
  - The canvas sits under the DOM, and the renderer draws those viewports into the holes.
  - Overlapping windows occlude them naturally.
- **HiDPI:** the canvas backing store is at `devicePixelRatio` capped at 2, with a *render resolution scale* setting. UI scale is independent of world zoom.

### 6.11 Text in the world

- **Flying text** (I §3.12, ≤ about 20 at once) and tooltips are DOM.
- **World labels** (train stop names, display panels, map tags) use a glyph atlas rendered at startup from Titillium Web with Canvas2D `fillText` at two sizes. No build tooling is needed.

### 6.12 Render budgets (the reference machine of §11, 1920×1080)

| Scene | Visible sprites | Main-thread CPU | GPU | Requirement (§11) |
|---|---|---|---|---|
| Default zoom (1×), slice base | ~2k sprites + 2k belt items | ≤ 4 ms | ≤ 6 ms | 60 FPS |
| Default zoom (1×), mid base | ~8k sprites + 10k belt items | ≤ 6 ms | ≤ 10 ms | 60 FPS |
| Furthest world zoom (≈ 0.3×), late base | ~25k sprites + 60k belt items | ≤ 12 ms | ≤ 25 ms | ≥ 30 FPS |
| Chart view | ≤ 4k chunk quads + overlays | ≤ 2 ms | ≤ 3 ms | 60 FPS |

- The main-thread total includes packet decode and belt-item expansion (≤ 0.5 ms, more at 0.3× with 60k items) and the UI (≤ 2 ms).
- On the target machine everything should hold 60 FPS.
- Fill rate is the risk on the weak iGPU. Mitigations: half-resolution light and shadow targets, mip-selected Normal sprites when zoomed out, and decorative culling below 0.5×.
- **These are budgets, not measurements** (codex B2-r1 finding 13). This host renders on SwiftShader, so it cannot measure GPU time. The rows are checked on a UHD 620-class machine with the gallery and benchmark scenes of `bench.html` (§10.6): the slice rows before M1 exits, the mid and late rows when M2 and M4 have such bases. Until then, the late-base row is an estimate.

### 6.13 Sprite resolution, GPU memory and compression

- **Sprite resolution modes,** as in Factorio's graphics setting. Each mode allocates only its own levels:
  - **High:** colour from level 0 (64 px per tile); shadows at 32 px per tile. Level 0 streams only where it is drawn (§9.7), but its storage is committed.
  - **Normal:** colour from level 1 (32 px per tile; §9.2); shadows at 16 px per tile, which the half-resolution shadow target (§6.2) cannot tell apart.
  - **Low:** colour from level 2 (16 px per tile); shadows as Normal. It exists for the uncompressed RGBA8 fallback and for very small GPUs.
- **What is allocated** (codex B2-r1 finding 3; §9.6's model, `budget_model.py`, counts every allocation, not content).
  - Each sprite array is allocated **once, at load**, with immutable storage: as many layers as the manifest has pages for it, and every level of the mode. So nothing grows or copies, and the peak is the steady state. Pages not yet downloaded still occupy their layers, and the budget counts them.
  - Frames name a page; the renderer maps page → layer through a small table. It is the identity unless memory runs out (below).
  - The other allocations: terrain materials, the light and shadow targets (§6.2), the quad and index buffers (§6.3), LUTs, the glyph atlas, chunk textures, and the chart's cache.
  - **The chart** (§6.10) keeps its chunk images on the CPU as palette indices (1 kB per chunk) and uploads only what the view shows into a fixed GPU cache: 2 RGBA8 layers of 2048², 8,192 chunk slots, 43 MB with levels, filled least-recently-used. A view that shows more than 4,096 chunks (below zoom ≈ 1/45 at 1920×1080) draws 2×2-chunk tiles at half resolution instead, one slot each, which keeps §6.12's 4k quads and covers a 4K window at zoom 1/64. Uncapped, at 4 kB per charted chunk, it would reach 128 MB at 30,000 chunks.

| Allocated, MB (window 1920×1080 CSS px, dpr 1 / dpr 2) | Slice | Full game | Budget |
|---|---|---|---|
| High, BC7 (or ASTC, BC3, ETC2: all 1 byte per px) | 150 / 164 | 358 / 372 | slice ≤ 256, full ≤ 768 |
| Normal, BC7 | 91 / 105 | 144 / 158 | ≤ 192 |
| Normal, RGBA8 fallback | 152 / 166 | 356 / 370 | ≤ 192 |
| Low, RGBA8 fallback | 100 / 114 | 168 / 182 | ≤ 192 |
| of which atlases and terrain at High, BC7 | 81 | 289 | |
| of which the chart cache, targets, buffers, LUTs and glyphs | 69 / 83 | 69 / 83 | |
| The browser's own framebuffers (not ours, listed for scale) | 24 / 95 | 24 / 95 | |

- **Choosing the mode.** At load the renderer computes each mode's allocation from the manifest's page counts and the GPU format the asset worker found (§9.2). It picks the highest mode that fits its budget and whose arrays allocate without `OUT_OF_MEMORY`; the player can choose a lower one.
  - So BC7-class GPUs get High.
  - The RGBA8 fallback gets Normal in the slice and Low in the full game.
- **Eviction, the safety net.** If an allocation still fails at Low, the arrays are allocated with fewer layers than pages, and pages share layers least-recently-drawn. A set whose page is not resident draws its greybox until the page is uploaded again (§9.7).
- **Context loss.** On `webglcontextlost` the renderer prevents the default and waits for `webglcontextrestored`.
  - It then re-allocates everything, and the asset worker re-uploads from its cache of KTX2 files (or the HTTP cache): Normal levels of the drawn groups first.
  - If no restore arrives within 5 s, it creates a new canvas and context once. If that fails too, it shows an error with a reload button. The simulation and its autosave live in the worker and are unaffected.
- **Transport and compression** (§9.2): KTX2 from M0. Colour, light and icons are XUBC7, transcoded to BC7, then ASTC 4×4, BC3, ETC2 RGBA, or uncompressed RGBA8; shadows are ETC1S, transcoded to BC4, then EAC R11, or uncompressed R8. A compressed format needs a quarter of RGBA8's memory and bandwidth. WebP is used only for DOM images. The encoder `basisu` 2.50 is installed on this host (§2.1).

---

## 7. The UI layer

### 7.1 Decision: DOM with SolidJS

**Why DOM** (I §8.1 recommends it): text, scrolling, IME, text fields, search, number fields with math, accessibility and CSS grid for 10-wide slot grids. The number of visible slots stays at most a few hundred.

**Why Solid 1.9.15:**
- fine-grained signals update exactly the changed text or attribute at 60 Hz, with no virtual-DOM diff;
- a small runtime;
- JSX with TypeScript;
- verified with Vite 8 and TS 7 here.

**Rejected:** a canvas-drawn GUI (we would rebuild text, scrolling and inputs); React (virtual-DOM cost at 60 Hz, size). Fallback: Preact 10.29.8 with `@preact/signals`.

### 7.2 Structure (`src/ui/`)

- `core/`: Window (title bar, drag handle, frame buttons, browse history), Slot, SlotGrid, ProgressBar, FluidGauge, Tabs, Button variants, ListBox, Tooltip, Choosers (recipe, item, signal), NumberField (math expressions), SearchField, Checkbox and switch, Graph (Canvas2D).
- `hud/`: research widget, side buttons, minimap hole, pins, docked entity info, quickbar, shortcut bar, crafting queue, alerts, toasts, mining bar, edge arrows.
- `windows/`:
  - the character screen (flat and tabbed);
  - entity GUIs by *kind*, generated from the entity panel's role list (I §8.3);
  - technology, production statistics, Factoriopedia (displayed as **Handbook**, 07-ui §0);
  - the World window and strip, the University window, the charter screen, the run report (07-ui §4, §7, §13, §14);
  - map (remote view chrome), electric network, settings, controls, saves;
  - later: blueprint library, logistics, trains, alerts, bonuses. (The rate calculator's window ships in M1, 07 §16.1.)
- `store/`: Solid stores fed by decoded projection records (§15.5), keyed by subscription.
- `input/`: §7.5.
- `i18n/`: `locale/en.yaml` for UI strings. Display names come from the data.

### 7.3 Data flow

1. A window that opens subscribes to the projections it shows (§15.5); closing it unsubscribes.
2. A packet arrives, and its `UI` records, decoded by the generated decoders, update the stores. Records from another state generation are dropped (§3.4).
3. Signals propagate only to mounted components.
4. Windows mount on open and unmount on close; an entity window whose target is gone closes.
5. **No layout reads in the frame loop.** Viewport holes are measured with a `ResizeObserver`.
6. **UI budget:** ≤ 2 ms per frame with the character screen and one entity window open. A window opens in ≤ 100 ms and a Handbook search keystroke takes ≤ 50 ms (§11). Search indexes are built once from prototype data at startup.

### 7.4 Styling

- **CSS variables** hold the skin's palette. The layout and metrics stay Factorio's; the skin is IMPL-5's *Survey* (1945 federal paperwork: manila folders, index cards, printed labels; `design/art/DIRECTION.md` §12), in place of round 5's dark grey frames.
- **Frames** use CSS `border-image` 9-slices drawn by us in SVG. No Factorio art is reused.
- **Metrics** follow I §4.0 exactly: 40 px slots with 32 px icons, 4 px grid, 8 px padding, fonts at 12/14/15/18 px, tooltips at 88% opacity with background blur and a maximum width of 356 px.
- **Fonts** (§9.3; A3 §12): Libre Franklin for printed text (labels, descriptions, window titles) and Courier Prime for typed values (counts, years, percentages), both OFL and self-hosted as WOFF2 subsets made by the asset build.
- **Icons** are CSS sprites from the icon atlas sheets, with a 2× sheet for HiDPI.
- **UI scale:** automatic by window height (100% at 1080p), and Ctrl+Numpad± in 25% steps (I).
- **Hygiene** (I §1.5): `user-select: none` except in text fields, `dragstart` prevented on icons, `touch-action: none` on the canvas.

### 7.5 Input

Implemented exactly as I §1 specifies:

- **The action map** has Factorio's control ids, two binding columns, exact modifier matching for *press* controls and free modifiers for *hold* controls.
- **Bindings** store `KeyboardEvent.code`. Labels come from `navigator.keyboard.getLayoutMap()`, with a fallback table.
- **The wheel** is normalised into notches of about 100 px.
- **Event semantics:** auto-repeat ignored; held controls released on `blur` and `visibilitychange`; game controls suspended while a text field has focus, with I's exceptions.
- **The context resolver** (I §1.4) runs on the main thread against the view model and UI state, in I's precedence order: text, GUI, modal, tool, placeable, usable, other item, empty. It produces exactly one **UI command** or **sim `InputAction`**; an action is encoded with the generated encoder and sent to the sequencer port (§3.2, §15.3).
- **The capture layer** (I §1.5) applies `preventDefault` to Tab, Space, Alt (keydown and keyup), Alt+letters, Alt+arrows, Mouse4/5 (`mouseup` and `auxclick`), RMB (`contextmenu`), MMB, Ctrl+Wheel (`passive: false`), Ctrl+Z/Y/C/X/V/F and F1–F10.
  - In fullscreen on Chromium, it calls `navigator.keyboard.lock()`.
  - At startup it runs a self-test of the capture, and the Controls screen lists keys reserved by the browser.
- **Drag-building** is computed on the main thread from the view model: axis lock, adjacent stepping, smart belts with R-bending and auto-undergrounds, poles at maximum reach with early placement for coverage (I §3.4). The result goes out as `build` actions sharing a `drag_id`, which makes one undo action.
- **Hotkey hints** in tooltips render from the live binding table (I §1.6).

### 7.6 Rules

- **Pure UI state never enters the sim** (S4): windows, hover, selection, camera, alt-mode, overlays, scroll, search, chat and interface settings.
- **The sim never calls the UI.** All UI behaviour comes from prototype data and entity kinds; there is no per-item UI code.
- **The settings audit** (D11, S4; M0). Every setting of I §4.20 and 07 §20 is either world state, changed by an action, or client-only, which may change which actions are sent but never how they execute:

| Setting (source) | Class | How it reaches the World |
|---|---|---|
| Auto-sort main inventory (I §4.20, Interaction) | World state, per player | `set_player_setting` (Appendix B) |
| Pick ghost item if no items are available (I §4.20) | World state, per player | `set_player_setting` |
| Trimmed collision (07 §20, per save) | World state, global | `set_game_setting` |
| Map settings and presets: Heat, runaways, r, staffing off, the generator's sliders (07 §17) | World state, global, fixed at creation | the new-world record (§15.8) |
| Smart belt building; lock belt building to line (I §4.20) | Client-only | the drag computation chooses the `build` actions; the smart-belt flag travels in them |
| Even distribution (07 §20) | Client-only | chooses whether one `distribute` action is sent (§5.20) |
| Change quickbar slot by clicking with a different item (I §4.20) | Client-only | chooses which quickbar action is sent |
| Vehicle driving mode, heading or steering (I §4.20, Controls) | Client-only | chooses which riding actions the keys send |
| Keep running in background tab (07 §20); technology-gui-pauses-game and the other pause behaviours (I §4.20, Other) | Client-only | sequencer behaviour, single player only (§3.3, S14) |
| Autosave interval and slots (I §4.20, Other) | Client-only | the shell |
| Every other Interface, Graphics, Sound and Controls option (I §4.20, 07 §20) | Client-only | never sent |

---

## 8. Persistence

### 8.1 The save container

The container is binary: header, then sections, PNG-style. Its sections and their layouts are generated from `schema/sections.yaml` and `schema/state.yaml` (§15.1). The sim writes and reads raw section bytes; the IO worker adds the header, compresses and stores.

```
magic "SITESAV\0" (8) | u32 formatVersion (2) | u32 headerLength | header (UTF-8 JSON, keys sorted)
sections, repeated: u32 id | u16 version | u8 codec (0 raw, 1 deflate: fflate level 6) | u8 flags (bit 0 HASHED)
                    | u32 rawLength | u32 storedLength | bytes[storedLength] | zero padding to a multiple of 8
```

A section's `version` is the schema version (§15.1) at which its layout last changed; the loader reads older versions through `since` defaults and migrations (§8.3).

**Alignment** (B1-r1 6) is measured from the start of the file. The header is padded with spaces so that `headerLength`, which includes the padding, is a multiple of 8; the first section header therefore starts at a multiple of 8. A section header is 16 bytes, so its data starts at a multiple of 8 too, and the zero padding after each section's stored bytes restores that for the next. Offsets inside a section count from the start of its data and refer to the raw (uncompressed) bytes.

**The header** holds metadata, outside the state hash: format version, game version, `buildHash`, `protocolVersion`, `schemaHash`, `prototypesHash`, tick, seed, map settings and presets (copies, for the load screen; the originals are in `GLOBALS`), play time, the wall-clock save time, the thumbnail section's id, the **name tables** per prototype kind (§8.3), the **roster** (each player's index, name and colour; names are not world state, §4.4), and the **digest lineage** (`r` at the save's tick, as 16 hexadecimal digits; §4.8). Rust never reads the header: the shell strips it and passes the sections (§15.8).

**Sections** (ids are stable and listed in `schema/sections.yaml`; all are hashed except the last two):

```
ENTITY_TABLE   POOL_* (one per pool)   SLOT_HEAP   COLD (binary records, by record type then serial)
CHUNKS (modified chunks: tiles, hidden tiles, resources, trees with leaf stages, world objects, leafTimer;
        occupancy rebuilt on load)   CHARTED (bitsets)
THERMAL (sparse H, the emission and incoming accumulators, and leafTimer for pristine chunks, wherever nonzero)
NETWORKS (what topology cannot rebuild: wires, switch states, belt contents, fluid-segment contents, circuit frames, train state)
GLOBALS (one record; below)   TIMERS   RNG   PLAYERS (one record per player; was PLAYER)   RESEARCH
STATS (ring buffers and exact totals)   BLUEPRINTS (records in this save)   UNDO (per player)
WORLDGEN_PENDING (requested chunks and their commit ticks)   GENERATED (every generated chunk key, per surface)
unhashed: CLOSURE_LOG (optional; §8.5, with its blobs inside)   THUMBNAIL (WebP from the renderer)
```

**Two encodings**, both canonical (equal state gives equal bytes):
- **Column tables** for the entity table and every pool: `u32 rows, u16 fields, u16 reserved`, then per field `u8 nameLength, name, u8 type, u8 reserved, u32 offset, u32 length`, then the columns, each starting at a multiple of 8. The directory lists the fields in the schema's declaration order; a loader matches them by name. `rows` is the pool's saved high-water mark; free slots hold their default values, except handle generations (§4.5). Fields of type `EntityHandle` are written as serials (§4.5). Type codes: 1 `u8`, 2 `u16`, 3 `u32`, 4 `u64`, 5 `i8`, 6 `i16`, 7 `i32`, 8 `i64`, 9 `f32`, 10 `f64`, 11 `bool` (one byte); id, enum and flag types are stored as their base type.
- **Records** for everything else: a section holds `u32 count`, then per record `u32 length` (the bytes that follow for this record) and its fields as `(u16 fieldId, u32 length, value)` triples in ascending field id, every field present. In `COLD`, each record is `u16 recordType, u32 serial, u32 length`, then its triples, sorted by `(recordType, serial)`. Field ids are declared in the schema and never reused (§8.3). A list value is a `u32` count followed by its items in the field's declared order (D3, D20): by serial, by key, by slot, or as saved; an unordered collection (`order: set`) is written sorted by the items' encoded bytes, and `order: none` is allowed only on fields that are not saved. An item that is itself a record is encoded as a record (`u32 length`, then triples), so lists nest.

Floats are stored as their IEEE bits (there is no NaN in state, D6); strings as a `u16` length and UTF-8; padding bytes are zero.

**The rule** (J2): everything not declared derived is saved. The schema enforces it, because a field without `saved` does not generate (D20); the save/load test (§10.4) catches what slips through. Section by section:
- **`GLOBALS`**, the global simulation state of §4.4, defined by 01 §13.1 and 03:
  - the world's text: W_own, W_pub, Y_pub, the pending publication releases [(start tick, amount)], Σ, the two model-collapse windows (P_crawl and P_syn rings) and the crawl share c held from the last world-text pass (c is global, 03 §2.2);
  - the race state: v₀ preset, and the tick the race was finished or lost;
  - the leak L. The infections: {id, tier, member serials, next firing tick; Wild only, the tick of its last nest, for the 10-minute cap}. Wild only: nests, evolution T and its three terms;
  - the closure tick and the overhang snapshot, milestone times, achievement progress;
  - the run-report accumulators: the 60-s power ring, recent research completion ticks with the best 600-s count, the doubling-time rings and history string;
  - the research scheduling toggle and the queue bylines (the queue itself is in `RESEARCH`);
  - the world's identity and settings: the tick, the seed, the map settings and presets, the game settings (trimmed collision, D11), the surfaces with their parameters, and the **worldgen version** with the hash of the worldgen-relevant data (§4.4);
  - the serial counter, `last_system_seq` (§15.3) and the map tags (per force).
- **Entity state** in the pools and the slot heap includes:
  - each deploying building's share ℓᵢ;
  - each machine's compromised flag and infection id, its consecutive zero-power tick count and (Wild) its escape due tick;
  - each Seminar's working-tick counter for wᵢ, and each deploying building's for the leak, both counted since the last 60-tick recompute;
  - the values cached at a cadence point and used until the next one: each Seminar's applied staff, each computing machine's throttle m (its chunk's last thermal update);
  - the Frontier cluster's run progress;
  - hall inventories: accelerators, weights and output.
- **`PLAYERS`**: every `PlayerState` of §4.4, including the input generation, `last_seq`, the inventory version (§4.8), the creation ring, the crafting queue, the clipboard, pins, the rule-affecting settings and the per-player accumulators. The hand-crafted count of the run report is the sum over players (§5.20).
- **`NETWORKS`** also holds each electric network's satisfaction per class from the last tick, keyed by the network's lowest member serial (phase 2's timers read it before phase 4 recomputes it, §4.6), and the per-network electric statistics under the same key. Round-robin cursors and task queues (logistics, M3) are saved fields of their owners.
- **`CHUNKS`** holds each modified chunk's ground items and rule version (§4.4) with its tiles and objects.
- **`GENERATED`**: every generated chunk per surface, sorted by key, with its κ, θ and sunlight; chunks in it but not in `CHUNKS` are pristine and regenerate lazily (§4.4).
- **`TIMERS`**: every timer that does work as `(dueTick, entitySerial, eventCode, owner)`, sorted in that order (D3 c); timers name entities by serial at runtime too (§4.6). Wake timers are derived.
- **`RNG`**: the states of every xoshiro stream (§4.3). Counter-based draws need no state.
- **`WORLDGEN_PENDING`**: every requested chunk as `(surface, cx, cy, commitTick)`, sorted by commit tick, then surface, cy, cx, which is the order §5.18 commits a tick's chunks in, so the saved order is the execution order (D8, §5.18; C1b decision 6). The data in flight is not saved: a loaded world regenerates it.

**Derived, rebuilt on load and never saved:**
- the topology of transport lines, fluid segments, data networks, electric, circuit and logistic networks and rail blocks, with their canonical ranks (§4.6); link clusters. What they hold is saved (in `NETWORKS`): belt items and gaps per lane in canonical order from each line's front, keyed by the line's identity `(entity serial, belt index, lane)` (§5.3); each fluid segment's amount and temperature keyed by its lowest member serial; each circuit network's output frame of the last tick; each train's motion, path, reservations and schedule position. A load rebuilds the topology and then refills it;
- active bits, wake sequence numbers and wake timers (§4.6); the serial index (§4.3); the slice-hash buckets (§4.8);
- the staffing graph and the Terminal links (rebuilt at the next recompute; the applied staff values are saved);
- `speed_eff` (from saved inputs); u_p and the satisfactions are recomputed every tick in phase 4, but the last tick's values are saved (above);
- the view versions of §15.4 and the content of pristine chunks (§4.4);
- σ (from Σ), j and every F(W) floor (from W);
- κ (from tiles and trees), T (from H);
- presentation fields (§4.5), which restart at their defaults.

Saves stay small, and "incremental equals rebuilt" is tested (§10.4).

**The state hash** (§4.8) is computed over the raw bytes of the hashed sections, so it is a property of the save, not of the machine that wrote it.

**Size:** about 10–25 MB compressed for a late game, from 50–100 MB raw. At the slice's end it is ≤ 5 MB (§11).

### 8.2 Storage

Storage follows 07-ui §19.2. Everything runs in the IO worker.

- **Save blobs** go in the **Origin Private File System** (OPFS) where available, written with a sync access handle in the worker. Otherwise they go in IndexedDB.
- **IndexedDB** via `idb` 8.0.3 holds database `game`, version 1, with stores:
  - `saves` (name → metadata, plus the blob when OPFS is missing);
  - `settings` (Interface, Graphics, Sound, Controls);
  - `blueprints` (the library; records store prototype **names**, remapped to ids when placed, so a data edit never breaks a stored blueprint);
  - `runHistory` (the *Run history* of 07-ui §19.2: completed runs and achievements, exportable with the saves; R5-gate D4 renamed it, since a records store is an in-world archive);
  - `bench`;
  - `rooms` (multiplayer: player tokens per room, recent games; 11 §6.3).
- **Persistence and quota.**
  - `navigator.storage.persist()` is requested at the first save.
  - `navigator.storage.estimate()` feeds the main menu's "storage 41 MB of 2 GB" line.
  - A save that would exceed the quota is refused, with export or deletion offered.
- **One tab at a time.** A `BroadcastChannel` lock: a second tab offers *Take over*, and the first saves and drops to a read-only notice.
- **Offline.** A service worker, where the host allows one, caches the build (§9.7), so a loaded game keeps working offline; the game works fully without it. Its cache counts against the same origin quota as the saves. Single-player saves never leave the machine; multiplayer checkpoints go to the relay (11 §4).
- **Integrity.** The IO worker computes the SHA-256 of every container it writes (WebCrypto) and keeps it with the metadata; a checkpoint's manifest carries it (§8.6).

**Export and import:**
- the File System Access API where available (Chromium);
- otherwise a download link and a file input.

The file is the container itself, named `<name>.save`. Import refuses a newer format with a message, and older formats migrate forward (§8.3).

**Settings that affect the simulation** (map settings, the presets for Heat, runaways and r, trimmed collision, the rule-affecting personal settings) live in the save as world state (D11). Interface settings live in IndexedDB.

### 8.3 Versioning

- **Pools load by field name** using each column table's directory. Added fields take their schema defaults and removed fields are dropped, like protobuf.
- **Records load by field id.** Unknown ids are skipped (their lengths are known), and missing ones take their defaults (`since`, §15.1).
- **Semantic changes** run migration functions in `sim::migrate`, registered by format version, in sequence. M0 has one format and builds no migration machinery; the first format change after M0 adds it, with its first migration (B1-r1 22).
- **Worldgen changes** are not migrations: a save made under another worldgen version or worldgen data is refused with an explicit error unless it was baked first (§4.4).
- **A load that remaps prototypes or migrates** starts a new digest lineage (§4.8), and its load report says so.
- **Prototypes are remapped by name.** When a save's `prototypesHash` differs from the build's, the shell builds remap tables (old id → new id, or "removed") from the save's name tables and passes them to `sim_load` (§15.8), one per kind of the `ProtoKind` enum (item, fluid, recipe, entity, technology, resource, tile, world object, signal). The generated loader remaps every field whose type is a prototype id or an item key. An entity whose prototype disappeared is removed, and an item disappears from inventories; the sim lists both in a **load report** (`sim_load_report`, §15.8), which the shell forwards to the main thread (`loadReport`, §3.2) for 08's notice (Factorio's mod-removal behaviour).
- **Golden saves** from each milestone are kept in `test/saves/` and must load in every later build (§10.4).

### 8.4 Autosave

- Every 5 minutes, into 3 rotating slots (I §4.20; both settable).
- **Non-blocking:** at a tick boundary the shell calls `sim_save`, copies the sections out of linear memory into transferable buffers (about 50 ms for a late game; the stall target is in §11), and transfers them to the IO worker, which compresses, hashes and writes while the game keeps running.
- A toast reports the save. Saving on exit is attempted on `pagehide`.
- In multiplayer, client autosaves stay on, and the stall is invisible: the client falls a few ticks behind and catches up (11 §4.6).

### 8.5 Replays and bug bundles

**The closure log** (S8) replaces round 5's input log: it stores closures verbatim, with every blob they name, so single-player replays and bug bundles share one self-contained format, and the relay's room log (11 §6.4), which stores closed ticks in the wire format, converts to it entry by entry. A closure log replays only under the build and `prototypesHash` it names.

```
CLOSURE_LOG (a save section, or a file *.pwlog with the same bytes; packed, little-endian)
  header (116 bytes):
     0 u32 magic "PWCL"             4 u16 formatVersion (2)   6 u8 actionSchemaVersion   7 u8 flags (bit 0 HAS_DIGESTS)
     8 u32 startTick (the start checkpoint's tick)           12 u32 endTick (≥ startTick)
    16 u8 buildHash[32]            48 u8 prototypesHash[32]
    80 u32 startStateHash.lo      84 u32 startStateHash.hi
    88 u32 recordCount            92 u32 recordBytes
    96 u32 digestFirstTick       100 u32 digestCount        (0 unless HAS_DIGESTS)
   104 u32 blobCount             108 u32 blobBytes         112 u32 reserved (0)
  records, exactly recordBytes bytes: recordCount × (u32 tick | u32 length (≥ 1) | closure bytes, §15.3),
           ticks strictly ascending within (startTick, endTick]; ticks without actions are not recorded
  digests, exactly 8 × digestCount bytes: d_t for digestFirstTick … digestFirstTick + digestCount − 1, as (u32 lo, u32 hi)
  blobs, exactly blobBytes bytes: blobCount × (u8 sha256[32] | u32 length | bytes), ascending by hash, each blob once
  nothing follows
```

**Parsing is unambiguous** (B1-r1 2): the header gives every region's count and length, an empty log is the header with every count 0, and a reader rejects a log whose regions do not consume exactly its bytes (truncated or trailing data), a record outside the tick range or out of order, an empty record, a digest range outside the tick range, unsorted or duplicate blobs, and a blob that a record names but the log lacks. The golden set (§15.10) holds logs with and without digests and blobs, the empty log, and truncated and trailing negative cases.

- **Replay.** `__game.replay(log)` and `simtool replay save log` load the start checkpoint, then run every tick from `startTick + 1` to `endTick` through a `LocalSequencer` in replay mode (natively, its Rust twin, the `TestSequencer` of §10.2), with the recorded closure or an empty one, supplying blobs as their ticks come. With `HAS_DIGESTS`, each tick's digest is compared and the first mismatch reported. The result is bit-identical in every engine (§4.1).
- **Recording.** In single player the shell records the closure log since the last autosave whenever the dev setting is on or a bug bundle may be needed (always in dev builds); its cost is the closures themselves, a few kilobytes per minute of play. Autosaves may embed it as the `CLOSURE_LOG` section.
- **Bug bundles** (`/report` or Ctrl+Alt+F12) contain:
  - the last autosave plus the closure log since it, with digests;
  - the shell's digest ring (§4.8);
  - the console log;
  - a screenshot and the build hash.

  They are POSTed to the dev server (§3.5), where Claude replays them natively (`simtool replay`) to the reported tick and inspects state; `simtool bisect` finds the first tick where a replay's digests leave the recorded ones, and per-phase digests name the system. This is the main debugging channel for anything the user sees.

### 8.6 Checkpoints

A **checkpoint** (S9) is a complete save written at a tick boundary: "write a checkpoint after tick T" copies the state exactly as the next tick would see it. It is the ordinary container of §8.1 with every section (cold data, timers, RNG, the blueprint store, per-player state and pending worldgen requests included; D8) and the digest lineage in its header. Serialization is canonical and section-wise; no page layout for delta transfer is committed (11 §5.2).

**The manifest** travels with a checkpoint whenever it leaves the machine (joins, re-syncs, server saves; 11 §4.3), and is kept beside the container (in the save's metadata), never inside it, since it holds the container's own SHA-256: checkpoint id, tick, build hash, protocol version, schema hash, `prototypesHash`, rolling digest at the tick, the full state hash (§4.8), total bytes, chunk size, chunk count and the SHA-256 of the compressed container. In multiplayer it also names the room and the room generation.

**Fast-forward.** "Load and run ticks up to H as fast as possible": load into a fresh worker, then run the buffered closures with extraction off and events historical, in time slices of at most 12 ms that yield to messages (§3.3). Joins, re-syncs, resumed rooms and replays all use it.

---

## 9. Assets, audio, loading and streaming

**Version 2** (WP B2). The art direction *Survey* (IMPL-5; `design/art/DIRECTION.md`, cited as A3 §n) and the generative audio engine (IMPL-6; `design/audio/DIRECTION.md`, cited as A4 §n) replace round 5's plan of Factorio-like grime and music21/FluidSynth tracks. The two DIRECTION documents own the look and the sound; this section owns how both are built, shipped, loaded and run. The measurements were made on this host on 2026-10-20 with the scripts in `design/asset-study/` (texture formats, the layered render, the budget model, the audio CPU study), and their outputs are in the gitignored `design/art/out/` and `design/audio/out/`. §6.4 and §6.13 summarise the renderer's side and defer to §9.2 and §9.7 for formats, transport and loading.

### 9.1 Sprites: the Survey render pipeline (Blender 5.2.2 LTS, Cycles CPU)

**Sources.** They are ported from A3's prototype (`design/art/proto/`), which already runs on this host:

```
game/assets/blender/
  lib/style.py        style tables, no bpy: palettes, KEY_DIR, SHADOW_DIR, tone bands, ink and hatch parameters.
                      Survey ships; A3's realism variant stays a one-table switch (IMPL-5)
  lib/materials.py    flat emission washes in three N·L bands (A3 §4.1); output modes beauty, light, normal, aux
  lib/parts.py        bmesh primitives: box, taper_box, cyl, cone, sphere, torus, tube, gear, prism, hip_roof,
                      wedge, rock, blob, lattice, point_light
  lib/rig.py          camera, canvas, the split light rig, the passes
  entities/<id>.py    one per entity prototype: META, build(), pose()
  world/<id>.py       trees, rocks, resources, decoratives, cliffs, town buildings, the campus (same contract)
  items/<id>.py       item models, for icons
  render.py, render_icons.py         the Blender entry points: one sprite set per process
game/scripts/assets/  post.py (ink, glow, downscale), pack.py, encode.py, contact.py, metrics.py, checks.py
game/scripts/build-assets.ts         the driver: content hashes, the job queue, the manifest (npm run assets)
```

**The entity contract.** An entity script exports three things:
- **`META`:**
  - `size` (w, h in tiles) and `height` (m);
  - `dirs`: the `Direction` values that get art (§4.2), e.g. `[8]` for a symmetric machine drawn from the south, `[0, 4, 8, 12]` for a drill;
  - `variants` (connection masks or shapes) and `states` (`working`, plus `idle` where the emitters go dark, A3 §8);
  - `layers`: the animated layers, each a list of part names and a frame count;
  - `light` (emitters present), `smoke` (chimney points for the render-time smoke of §9.8), `margin`, and `ink`, the weight class (machine 1.0, archive 0.75, ore 0.70, decorative 0.45; A3 §5).
- **`build(P, dir, variant, state)`:** the model at rest, with every animated part named.
- **`pose(parts, layer, frame)`:** moves one layer's named parts to frame f by transform alone (rotation, translation, visibility). No geometry is rebuilt per frame.

Each model follows the data's `sprite` line, the entity's description and 07 §23's legibility rules, under A3 §6's modelling rules.

**Camera and projection** are unchanged; A3 §2 measured them. The camera is orthographic, pitched 45° from the south, with `pixel_aspect_x = √2` and 64 px per tile at High. The calibration test `test/assets/projection.py` renders a unit cube: its top face must be 64×64 px and its south face 64 px tall, within ±1 px.

**Light.** The colour pass renders no lights. Each material is an emission wash multiplied by a tone band from N·L against the shading key (−0.62, −0.30, 0.73), with A3 §4.1's bands, and the dark band is hatched by the ink pass. Cast shadows come from a second sun at (−0.80, 0.22, 0.56). They therefore fall east-south-east as in Factorio, while the south faces the camera sees stay lit (A3, decision 2). Emitters are flat and unbanded.

**Passes** (A3 §13.3's settings: the *Standard* view transform, a transparent film, 16 fixed threads, seed 7, adaptive threshold 0.02, no denoiser):

| Pass | Content | Samples | Resolution | Used for |
|---|---|---|---|---|
| colour | the washes | 16 | High | the sprite, before ink |
| normal | world normal as (n + 1)/2, 8-bit | 1, filter 0.01 | 2× High | crease lines over 32° and the dark band's hatching |
| aux | material id, object id, organic flag | 1, filter 0.01 | 2× High | material and object boundary lines |
| light | emitters only; everything else black | 4 | High | the glow (the light array) |
| shadow | a shadow catcher; the object is invisible to the camera; a 1° sun and no sky | 64 | **Normal** | the shadow mask |

The shadow pass renders at Normal resolution, because masks are stored there anyway (A3 §4.2) and it is the costliest pass: 46–56 µs per canvas pixel at High.

**Render only what moves (binding, IMPL-5).** A sprite set is one static base per direction, variant and state, plus animated layers per frame. A3's prototype rebuilt and rendered the whole scene for every frame, which would take about 11 hours for the full set. The algorithm:
1. **Build** the model once per (direction, variant, state).
2. **Frame 0 in full:** render colour, normal, aux and light with every part at its frame-0 pose, and ink it (§9.2). This is F₀.
3. **The shadow:** render it once, at Normal resolution, with the animated parts at their frame-0 pose. A moving part's shadow is low-frequency hatching. A set declares `animShadow` where it matters: the radar dish, and every full-frame animation (the character, agents), whose shadows are rendered per frame.
4. **The animation rectangle R of each layer:** the union over all frames of the projected bounds of the layer's parts, plus 8 px at High (the silhouette line and the ink filters' reach), rounded out to multiples of 8 px. Layers of one set whose rectangles intersect are merged into one layer (their frame counts must then agree), so a set's layers are disjoint.
5. **Each frame:** `pose()` the layer, then render colour, normal and aux inside R only (a Cycles border render, cropped). Every static part stays in the scene, so occlusion is right in both directions.
6. **Ink per frame:** paste R's passes into F₀'s full-size passes and ink R plus a margin ρ = 16 px; the layer's frame is the result cropped to R. Lines between a moving part and a static one are object-boundary lines, and only the composite knows where they are.
   - The ink's position-dependent fields (pen pressure, mottle, paper grain, hatching) are computed once per set over the whole canvas, in the canvas's coordinates, and cropped. Its filters reach less than ρ.
   - So the frame inside R equals inking the whole frame, and F₀ outside R is untouched: lines, halos and grain continue across R's edge. F₀ itself is inked the same way, on the passes' bounding box plus ρ.
   - Verified bit-exact (`render/ink_locality_check.py`) on six sets, four frames each. With A3's fields generated per call instead, the crop would differ by up to 142 of 255 levels.
7. **Light per frame** only where an emitter moves. Flicker is a shader effect driven by `DYN.light` (§15.4).

**Composition: pieces, every pixel drawn once** (codex B2-r1 finding 2).
- A working set is drawn as its **base pieces** plus each layer's frame. The base pieces are F₀ minus every layer's R, cut into at most four rectangles per R. The idle state draws its own complete image.
- F₀ is packed once, as one cell, and its pieces are sub-rectangles of that cell, so they cost no atlas space and the texels across a cut are F₀'s own. Each layer frame is a cell of R plus an 8-px gutter of frame k's own pixels (§9.2). Frame k and F₀ agree in R's outer band (its margin), so filtering across a cut reads the right pixels. Only at level 3, where one texel is 8 px of High, can a texel straddle the band: a one-texel error at a zoom where a tile is at most 8 device pixels wide.
- A screen pixel belongs to exactly one quad: pixel centres in half-open rectangles. So translucent washes, glass and anti-aliased edges are never drawn twice.
- Version 1 drew the layer frame source-over a complete base. That doubled every static pixel inside R that was not opaque: glass at 22% became 39%.

**Verified** (`design/asset-study/render/pieces_check.py`):
- The check composites the pieces as the renderer will: premultiplied, bilinear, the level chosen by scale. It ran at scales 0.3, 0.5, 0.73, 1, 1.37 and 2.3, with sub-pixel offsets, against drawing the full frame as one sprite.
- On the keypunch, assembling machine 1, the electric drill, the steam engine (13 moving parts) and the research hall (96), every pixel matched: maximum ΔE 0.00 at every scale and level. With a 22%-opaque band crossing R's edge (the glass case) it is still 0.00.
- Version 1's scheme deviated by more than ΔE 1 on 0.6–3.6% of the pixels, by up to ΔE 19.
- The layered frames also match A3's full per-frame renders within ΔE 1 on at least 99.97% of pixels (the drill: all). The rest are a few isolated pixels, which §9.5's ΔE ≤ 3 on 99.9% allows.

**Measured** (`design/asset-study/render/render_layers.py`, on A3's own entity scripts and rig, 16 threads on socket 1). The shadow column was rendered at High here, so the Normal-resolution shadow saves about a further 4× on it.

| Entity, frames | Canvas (px) | R ÷ canvas | Moving parts | Base passes | Shadow | Per animated frame | All frames, layered | A3's per-frame rebuild |
|---|---|---|---|---|---|---|---|---|
| Keypunch, 16 | 352×384 | 2.5% | 2 | 0.63 s | 6.4 s | 0.11 s | 9.9 s | 117 s |
| Assembling machine 1, 16 | 448×448 | 3.6% | 3 | 0.83 s | 10.1 s | 0.16 s | 17.5 s | 181 s |
| Electric mining drill (south), 16 | 512×480 | 7.0% | 1 | 0.78 s | 12.0 s | 0.23 s | 17.6 s | 217 s |
| Steam engine, 16 | 672×544 | 15.1% | 13 | 1.15 s | 18.8 s | 0.25 s | 25.5 s | 330 s |
| Research hall, 8 | 864×864 | 13.4% | 96 | 2.04 s | 41.6 s | 0.51 s | 49.6 s | 357 s |
| Transport belt, one piece, 16 | 160×160 | 17.9% | 6 | 0.17 s | 1.2 s | 0.06 s | 2.6 s | — |

- Layered sets render 7–13× faster, and most of what remains is the single shadow. The last column is 16 (8 for the hall) × A3's measured time per frame.
- The prototype found the moving parts by comparing frames. Production scripts name them.
- **A complete build** of A3's prototype set (codex B2-r1 finding 13): 29 entities, 105 direction × variant combinations, 9 of them animated, with F₀ in full and shadows at Normal. It rendered in 5.3 minutes of wall time, of which the shadows were 66%.
  - §9.6's unit costs predict 321 s of rendering against 303 s measured (×0.94).
  - Its canvas formula (the rig's: footprint, margin and the shadow's reach) matches all 105 canvases exactly.
  - Inking only the passes' bounding box plus 16 px (8-px aligned) covers 27% of the canvas. With the ink's fields in canvas coordinates it gives the same pixels as inking the whole canvas, on every entity of the build, and nothing is drawn outside it (`render/ink_locality_check.py --bbox`). The ink is therefore run on that box (step 6's rule for R, applied to F₀).

**Frames and the layer split per entity class.** These are the defaults; an entity overrides them in `META`.

| Class | Directions | Variants | Base images | Animated layers | Shadow | Light |
|---|---|---|---|---|---|---|
| Crafting machines, Seminar, Switch | 1; 4 for the asymmetric fluid machines (chemical plant, data refinery) | 1 | working, idle | 1–2 layers, 16 frames, seamless; R about 25% of the sprite (A3 §9's 3% rule is the floor) | 1 per direction | 1 per state |
| Furnaces, Keypunch, boiler | 1; boiler 4 | 1 | working, idle | fire and mechanism, 16 frames | 1 | working only |
| Drills | 4 | 1 | 1 | the turret, 16 frames | 4 | burner drill only |
| Steam engine, turbines, generators | 2 (north–south and east–west, as Factorio) | 1 | 1 | flywheel and crank, 16 frames | 2 | — |
| Radar | 1 | 1 | 1 | the dish, 64 frames | the dish, 64 (`animShadow`) | — |
| Belts, per tier | — | 20 pieces: 4 straight, 8 curves, 8 caps | — | full frame, 16 frames (the whole deck moves) | 1 per piece | — |
| Splitters | 4 | 1 | 1 | the belts under it, 16 frames | 4 | — |
| Underground belts, pipes, pipe-to-ground, poles, chests, walls | 4 or 1 | connection masks (pipes 16) | 1 each | — | 1 each | — |
| Inserters, per type | 4 platform directions | parts: platform, arm, hand open, hand closed, with their pivots (§15.7) | 1 each | none: the arm and hand are rotated in 2D (§6.8, §15.7) | 1 per part | — |
| Lamps, signals, train stops | 1, 4 or 16 | — | 1 per light state | — | 1 | 1 per state |
| Rolling stock, cars, turrets, agents | 64 orientations (agents 16) | — | 1 per orientation | none; a turret's head is a second set | 1 per orientation | — |
| Trees | — | 10 species × 4 shapes | × 5 leaf states: 4 stages left down to bare | — | 1 per shape | — |
| Resources, rocks, decoratives | — | resources 6 shapes × 8 depletion bands; rocks 4; decoratives 4 | 1 each | — | 1 each | — |
| Town buildings, the campus | — | 8 per town class and skin | 1 each | — | 1 each | lit windows at night |
| The character | 8 | — | — | full frame: run 16, mine 16, idle 4 per direction | 1 per frame | — |

**Throughput and caching.**
- One Blender process renders one sprite set, pinned to socket 1 with 16 threads. Only one heavy job runs at a time, because the host is shared (`CLAUDE.md`). The numpy steps (ink, packing, encoding) run in parallel on socket 0.
- Builds are incremental. A set's cache key is the SHA-256 of its entity script, `lib/`, the style table, the pipeline version and Blender's version string. Outputs live in `game/.cache/assets/<key>/` (gitignored), and only sources are committed (§9.6).

### 9.2 Post-processing, atlases and the texture format

**Steps** (`scripts/assets/*.py` under `gamedev-python`, driven by `build-assets.ts`):
1. **Ink** every base and every layer frame with A3's `survey_ink`: lines from the 2× passes, hatching on the dark band, watercolour edge darkening, mottle and paper grain. The pen-pressure seed is the `crc32` of entity, direction and variant, never of the frame, so lines do not shimmer (A3 §5). The ink runs on F₀'s trimmed box and on each R, plus 16 px, with its fields in canvas coordinates (§9.1).
2. **Glow:** the light pass is dilated 0.12 tile, blurred 0.22 tile, multiplied by 1.8 and clipped (A3 §4.3). It is stored at quarter resolution, 16 px per tile, because it is that soft.
3. **Trim** on alpha with a 1 px border, rounded out to multiples of 8 px of the canvas, record the anchor, and **premultiply** alpha. Record each animated set's base pieces as sub-rectangles of F₀ (§9.1). With R also on 8 px, F₀, its pieces and every layer frame share one texel grid at every level down to level 3, which is the setup §9.1 verified.
4. **Shadows:** clip values below 0.03, keep them at Normal resolution, trim.
5. **Pack** each atlas group (§9.7) separately with `maxrects-packer` 2.7.4 into 2048² pages at High, every frame in its own **cell** (codex B2-r1 finding 10).
   - A cell is the frame plus an 8-px gutter on every side, filled with the frame's source's real neighbouring pixels: transparent around a trimmed sprite, frame k's own pixels around a layer frame.
   - Its position and size are rounded up to multiples of 32 px. So every 4×4 compression block, down to level 3 (where 32 px is one block), belongs to one cell. Filtering at level 3 still has one texel of real gutter.
   - Measured on A3's 120 sprites (`texfmt/pack_alignment.py`), the cells add 31% to the sprite area: 19% with 8-px cells, 2% with v1's 2-px gutter. With MaxRects' fill of 0.874, a page holds 0.67 px of sprite per px.
   - **Verified** on a worst-case page (`texfmt/cell_isolation_check.py`): cells of solid, strongly different colours, levels 0–3, each level transcoded to BC7, ASTC 4×4, BC3, ETC2 RGBA, BC4 and EAC R11. No texel of any level in any format came out nearer another cell's colour; the worst error was quantisation, 0.016.
   - With version 1's packing (8 px, 2-px gutters), levels 2 and 3 failed in every format: up to 7% of texels (ETC2, level 3) took a neighbour's colour.
6. **Levels:** level 0 is the High page, and levels 1–3 are box-filtered halvings of the premultiplied page. Level 1 is the Normal page. Because cells sit on 32 px, every level's box filter and blocks line up with the cells.
7. **Encode** each page into two files: level 0, and levels 1–3 (§9.7 streams them separately). File names carry the content hash, for example `atlases/colour-core-0.3f2a9c1e.h.ktx2` and `atlases/colour-core-0.9be04d17.n.ktx2`.
8. **Emit** `public/atlases/sprites.json` (§15.7) and run the checks of §9.5.

**The texture format, decided by measurement** (`design/asset-study/texfmt/`).
- The test pages are real ones made with A3's pipeline: a 2048² High colour page of 120 inked *Survey* sprites (86% occupancy), the same sprites as a 1024² Normal page, a 512² icon page, a Normal shadow page and three 512² terrain textures.
- Quality is measured on the decoded result as the GPU sees it (Basis files transcoded to BC7), composited on the paper.
- Timings are the median of 5 in headless Chrome 156 and Firefox 157 on this host, one thread.

| Format (GPU format) | High page | Normal page | PSNR, High / Normal (dB) | ΔE mean / p99, High | Detail kept | High page decode or transcode, Chrome / Firefox | GPU bytes per pixel |
|---|---|---|---|---|---|---|---|
| PNG, oxipng (RGBA8) | 2,900 kB | 931 kB | lossless | 0 | 1.000 | 88 / 83 ms | 4 |
| WebP lossless (RGBA8) | 2,038 kB | 600 kB | lossless | 0 | 1.000 | 123 / 117 ms | 4 |
| WebP q90, lossless alpha (RGBA8; A3's budget setting) | 525 kB | 209 kB | 38.6 / 36.8 | 1.71 / 11.6 | 1.000 | 150 / 138 ms | 4 |
| WebP q80 (RGBA8) | 365 kB | 160 kB | 36.4 / 34.9 | 2.17 / 13.0 | 1.001 | 136 / 125 ms | 4 |
| KTX2 ETC1S, q 255 (BC7) | 443 kB | 166 kB | 31.7 / 30.4 | 3.29 / 18.9 | 0.982 | 135 / 142 ms | 1 |
| KTX2 UASTC 4×4, Zstandard (BC7) | 2,026 kB | 568 kB | 43.6 / 39.6 | 0.77 / 3.8 | 0.997 | 154 / 155 ms | 1 |
| KTX2 UASTC, RDO λ = 1 (BC7) | 1,433 kB | 439 kB | 40.9 / 38.2 | 0.94 / 4.6 | 0.997 | 154 / 157 ms | 1 |
| KTX2 XUASTC 4×4, quality 90 (BC7) | 1,461 kB | 456 kB | 41.7 / 37.8 | 0.88 / 4.7 | 1.000 | 295 / 304 ms | 1 |
| **KTX2 XUBC7, quality 90 (BC7)** | **1,021 kB** | **345 kB** | **43.6 / 39.9** | **0.72 / 3.7** | **1.001** | **219 / 230 ms** | **1** |
| KTX2 XUBC7, lossless (BC7) | 1,379 kB | 424 kB | 44.4 / 40.2 | 0.65 / 3.6 | 1.001 | 149 / 157 ms | 1 |

- "Detail kept" is the band-pass (0.7–2 px) energy of the decoded page inside the original's top 20% detail pixels, relative to the original. Below 1 means mushed lines and hatching; above 1 means added noise.
- Uploading one 2048² layer on SwiftShader takes 22–24 ms as RGBA8 and about 1 ms as BC7. Brotli and gzip gain at most 1% on any of these files.

What the numbers and the magnified crops (`design/art/out/texfmt/crops/`) show:
- **ETC1S mushes the plate:** blocks in the paper, smeared hatching, shifted small colours (ΔE p99 19). It is rejected for colour.
- **WebP's chroma subsampling eats small colour details.** The ink lines and the hatching survive (detail 1.000), but a character's hand turns grey, a 2 px science-colour band on a 16 px icon or a status lamp smears, and 16 px copper icons get a faint orange halo on the paper: ΔE p99 is 11–13, against 3.7–6 for BC7. WebP is the smallest download, but it decodes to RGBA8, four bytes per pixel on the GPU.
- **XUBC7 at quality 90** (Basis Universal 2.50) cannot be told from the original at 7× magnification and keeps the colours. Its download is twice WebP q90's, its GPU memory and texture bandwidth are a quarter, and it transcodes in about the time WebP takes to decode.

**The decision:**

| Array | Codec (KTX2) | GPU format, in order of preference | Why |
|---|---|---|---|
| colour, light, icon | XUBC7, quality 90 | BC7 (`EXT_texture_compression_bptc`), ASTC 4×4 (`WEBGL_compressed_texture_astc`), BC3 (`WEBGL_compressed_texture_s3tc`), ETC2 RGBA (`WEBGL_compressed_texture_etc`), RGBA8 | the measurement above. A quarter of RGBA8's memory and texture bandwidth, which matters most for the weak iGPU's fill rate (§6.12) |
| shadow | ETC1S, `-q 255`, one channel | BC4 (`EXT_texture_compression_rgtc`), EAC R11 (`WEBGL_compressed_texture_etc`), R8 | a soft mask that the shader hatches: 35.6 dB is ±1% of ink. 79 kB per Normal page, against 313 kB as PNG, and 0.5 B/px |
| terrain materials (§9.9) | XUBC7, quality 90 | as colour | 78–92 kB per 512² texture, against 8–32 kB as WebP q90. But terrain is sampled for every pixel of every frame, so its bandwidth matters most |
| DOM images: the UI skin, CSS icon sheets, technology icons, the menu background | WebP: lossless for the skin and the icon sheets, q90 for technology icons and the background | decoded by the browser | the DOM cannot use GPU formats |

- **The fallback order** (codex B2-r1 finding 5). At start-up the renderer probes each format on its own: the extension must exist, and uploading one block into a small texture array with `compressedTexSubImage3D` must leave `getError()` at 0. The asset worker then transcodes to the first format that passed.
  - RGBA8 and R8 are uploaded uncompressed with `texSubImage3D` into `RGBA8` and `R8` storage; their page layout is the same.
  - Measured from the shipped XUBC7 and ETC1S files (`texfmt/fallback_quality.py`, ΔE mean / 99th percentile on the paper):

    | Format | High colour | Normal colour | Icons | Transcode, High / Normal page (ms, Chrome, here) |
    |---|---|---|---|---|
    | BC7 (and RGBA8, the same decoded blocks) | 0.72 / 3.7 | 1.01 / 6.2 | 1.29 / 8.8 | 171 / 44 (RGBA8: 242 / 61) |
    | ASTC 4×4 | 0.82 / 5.4 | 1.23 / 9.4 | 1.75 / 13.3 | 299 / 84 |
    | BC3 | 1.90 / 9.4 | 2.37 / 14.9 | 2.67 / 15.2 | 372 / 95 |
    | ETC2 RGBA | 2.83 / 14.7 | 3.24 / 17.7 | 3.40 / 19.5 | 370 / 102 |

    Shadows: BC4 36.0 dB, EAC R11 36.3 dB, R8 as BC4. BC3 and ETC2 are visibly coarser on ink lines (a 99th percentile of 9–20 ΔE), so they are fallbacks for the rare GPU without BC7 and ASTC, not choices.
  - **Coverage is expected, not established.** BC7 is the expected desktop path: Direct3D 11 hardware has it, Mesa's Intel drivers expose it, and ANGLE's Metal backend maps it. But `EXT_texture_compression_bptc` remains optional for a browser, and Firefox on macOS is unmeasured.
  - SwiftShader here passes all six probes; headless Firefox here has no WebGL2. Neither says anything about hardware coverage.
  - `bench.html` records the probe results and timings on the user's machines (§10.6). A run on macOS with Firefox is an open follow-up; until it exists, that platform is assumed to get ASTC (Apple silicon) or BC3.
- **The transcoder** is Basis Universal 2.50's `basis_transcoder.wasm` (Apache-2.0), pinned together with its encoder `basisu` 2.50. The encoder is built here from source into `~/.local/opt/basisu-2.50` (`CLAUDE.md`).
  - The stock build is 1,061 kB (361 kB brotli), because it carries every codec. A build with only XUBC7 and ETC1S and the six target formats is a follow-up for the asset work package; Emscripten runs in the podman fallback.
  - It initialises in 184 ms in Chrome and 208 ms in Firefox here, inside the asset worker and in parallel with other loading.
- **Encoding** costs about 3 s per 2048² page for XUBC7 and 0.6 s per shadow page.

**Placeholders.** From M0, every entity has an automatic greybox set: its footprint as a bevelled box in its family's colour, rendered by this pipeline. There is no text in the world: dev builds print the prototype's name in the debug overlay instead. A set whose page is not resident yet draws its greybox (§9.7).

### 9.3 Icons, the UI skin and fonts

**Icons** are the item's 3D model, rendered in the world's camera, auto-framed and passed through the ink pass with sel-out outlines (A3 §7 and decision 3; they replace round 5's hand-drawn SVG). `render_icons.py` renders at 128 px, and post-processing derives 64, 32 and 16 px (box filter) with A3 §7's icon line widths. The families keep 07 §23's rules: one silhouette per family, type by colour, tier by one detail, and the hexagon meaning weights. The data has 230 items and 251 technologies.
- **The GPU icon array** (XUBC7): one 64 px frame per icon, with 32 and 16 px as its levels 1 and 2. It serves belt items (32 px at High), ground and held items, alt-mode and world-anchored icons.
- **CSS sheets for the DOM:** 32 and 64 px, for device pixel ratios 1 and 2, as WebP lossless. There is one sheet per atlas group, so the sheets stream with the groups (§9.7).
- **Technology icons** (256 and 128 px) appear only in the DOM, on the technology screen and in tooltips: WebP q90 sheets per tier, loaded when the technology screen first opens.
- **Checks** (07 §23, A3 §7), on every build: the belt line-up at 16 and 32 px; the 8×8 Lab confusability report under normal vision, deuteranopia and protanopia, flagging pairs closer than 7; the information/matter lightness rule (§9.5).

**The UI skin** (A3 §12). Only the skin changes; the layout is Factorio's (§7.4).
- **Sources** are SVG in `assets/svg/ui/`: manila folder frames, index cards ruled in pale blue, slot cards with a red top rule, buttons and tabs, the hatched green progress bar, scrollbars, checkboxes and the minimap frame. `resvg` renders them at 1× and 2× into one UI sheet (WebP lossless), which CSS uses as `border-image` 9-slices. The colours are CSS variables (§7.4).
- **The paper fibre** is one 256² tileable texture (WebP q85).
- **Glyphs** (arrows, ⇒, warning and status icons) are SVG paths in an inline sprite, never font glyphs (A3 §12).

**Fonts.** All are under the SIL Open Font License 1.1; the licence files ship in `public/fonts/`, and the credits list the fonts.

| Face | Weights | Use | Source | WOFF2 subset |
|---|---|---|---|---|
| Libre Franklin | 400, 600, 800 | printed text: labels and descriptions; window titles in ExtraBold capitals | Impallari Type (github.com/impallari/Libre-Franklin) | 22.8, 23.0, 23.4 kB |
| Courier Prime | 400, 700 | typed values: counts, years, percentages | Quote-Unquote Apps, via Google Fonts | 22.8, 23.4 kB |
| Titillium Web | 400, 600 | world labels in the glyph atlas (§6.11), unless they move to Libre Franklin (A3's proposal) | Accademia di Belle Arti di Urbino, via Google Fonts | 16.9, 16.9 kB |

- **Subsets** are made with `fontTools` (now in the `gamedev-python` venv). They keep Basic Latin, Latin-1, Latin Extended-A (Ł, ă and ő occur in citations), Greek (σ, Σ, κ), general punctuation, super- and subscripts, ℓ, arrows and the few mathematical signs the text canon uses (− ≤ ≥ ≈ √ ∞ ⌊ ⌋), and the features `kern`, `liga`, `lnum`, `tnum` and `case`. All seven faces measure 149 kB together.
- **Coverage is checked.** The data stage compares the text canon and the locale file with each subset's coverage and fails on a gap, so no player-facing string falls back to a system font.
- **Loading:** the three faces of the main menu are preloaded with `font-display: block`; the rest use `swap`.

### 9.4 Audio (v2)

The engine is A4's generative-first hybrid (IMPL-6): `src/audio/` plays the rule sets live, and the same code renders offline through `OfflineAudioContext` for the menu loop, recorded fallbacks and trailers (A4 §6.1). A4 §2–§8 own the music, the SFX palette and the mix. This section owns the runtime: its architecture, the CPU and memory budgets and how they are met, the sample packs, the SFX system, Safari and licences. The SFX themselves are synthesised in Python by A4's `sfx.py` (numpy and pedalboard), for the whole list of A4 §7.4.

**Architecture.**

```
main thread (src/audio/)                                 audio rendering thread
 Conductor ─► Piece (rules) ─► Scheduler                 voice bank (AudioWorklet): every sampler voice, music and SFX;
   (100 ms tick, 0.8 s lookahead) ── note batches ──────►  Int16 samples at 32 kHz; 48 music + 24 SFX voices;
 SFX dispatcher (EVENTS, AUDIO_WORKING; §15.6) ─ batches ►  one stereo output per mixer channel
 asset worker (§9.7) ── Int16 samples, MessagePort ─────►        │
 synth notes (organ, sine, FM): in the bank (M1 plan) ──►        ▼
                                                         channel: trim, EQ, tape and tremolo (in the bank), pan
                                                           ├─ dry ─────────────────────────────────► era bus
                                                           └─ send ─► FDN reverb (AudioWorklet) ───► era bus
                                                         era buses (≤ 2, crossfading) ─► music bus ─► HP 30 Hz ─► air ─► glue ─► Music
                                                         SFX category buses: GUI, game effects, alerts, walking, environment ─► faders
                                                         Master fader ─► limiter at −1 dBTP ─► destination
```

- **An AudioWorklet is needed**, for three things, all measured below:
  1. **The voice bank.** A single AudioWorklet node mixes every sampler voice. A native voice (`AudioBufferSourceNode` plus `GainNode`) costs 0.53% of a host core and a worklet voice 0.14%. The bank also halves sample memory (Int16 instead of the `AudioBuffer`'s Float32) and creates no audio nodes and no garbage per note on the main thread.
  2. **The FDN reverb** (A4 §6.5 #1): 8 delay lines, a Hadamard matrix and damping per line, one node per era bus. It replaces every `ConvolverNode`.
  3. **The tape and tremolo inserts**, as per-channel processing inside the bank instead of node chains of delays, oscillators, a 2×-oversampled shaper and filters. The bank also plays the synthesised notes (below).
- Native nodes remain for channel trims and EQ, the buses, the glue compressor and the limiter.
- **The synthesised notes move into the bank** (changed after codex B2-r1 finding 4). Era II's drawbar organ and sine drones, and later Era III's two-operator FM, become wavetable and FM voices in the bank. The organ's time-lag tape echo and the tape hiss become bank inserts.
  - In A4's prototype they are native oscillator and delay graphs, and they cost Era II about 7 points of a host core (measured below).
  - Voices with many partials, such as Risset's bell (22 nodes a note), are pre-rendered into the sample pack at build time.
- **The engine runs at 32 kHz** (`new AudioContext({ sampleRate: 32000, latencyHint: 'balanced' })`). The music's spectrum is dark by design (A4 §8), and nothing above 7 kHz matters in the SFX (A4 §7.1). The browser resamples to the device. The offline renderer keeps 48 kHz for masters. The audio work package A/B-checks a 32 kHz render against A4's demos (the spectrum above 12 kHz, loudness); if the user hears a difference, the engine rate becomes 48 kHz and the voice caps shrink to stay in budget.
- **Scheduling** is A4 §6.3's: a 100 ms tick, 0.8 s lookahead, notes posted to the bank in one pooled message per tick, sample-accurate start times, and notes more than 50 ms late dropped and counted. A hidden page with *Keep running in background tab* ticks from a Worker timer.

**Measured** (`design/asset-study/audiocpu/`: A4's engine and rule sets, played live in headless Chrome on this host with each change applied in turn; the audio threads' CPU from `/proc`, means of A/B-interleaved runs). First, **20-s excerpts**, which attribute the savings but establish neither a piece's average nor its worst second:

| Configuration (cumulative), 20-s excerpts | Era I | Era II | Takeoff |
|---|---|---|---|
| A4 as built: full sample pack, convolution reverbs, native voices, 48 kHz | 41.0% | 51.4% | 67.8% |
| the shipping pack, one velocity layer for short and percussive notes, a 48-voice cap | — | 43.4% | — |
| + the FDN worklet instead of convolution | — | 33.9% | — |
| + the engine at 32 kHz | 16.5% | 25.8% | 25.5% |
| + every sampler voice in the worklet bank | 12.9% | 25.0% | 21.1% |
| + Era II's tape and tremolo inserts out of the node graph | — | 16.9% | — |

**Whole pieces** (codex B2-r1 finding 4). Each piece was played from its start for 140 s with the shipping graph: the shipping pack, the FDN, 32 kHz, every sampler voice and Era II's inserts in the bank, the synthesised notes still native. An SFX load ran in the bank alongside: 8 working loops and 6 one-shots a second. The audio threads' CPU was read every second, over two interleaved rounds (Era II: four).

| Shipping graph with SFX | Era I | Era II | Takeoff |
|---|---|---|---|
| Host: mean over the piece / worst second | 13.8% / 18.7% | 22.4% / 32.5% | 19.8% / 25.6% |
| **Reference (÷ 2.4): mean / worst second** | **5.7% / 7.8%** | **9.3% / 13.5%** | **8.2% / 10.7%** |
| Offline render load on the host (below) | 7.1% | 10.8% | 10.0% |
| Main thread: mean / longest tick, host | 0.12% / 1.8 ms | 0.17% / 2.9 ms | 0.20% / 2.9 ms |

- **Era II's parts,** whole piece with SFX, host, measured as pairs within one session of two rounds:
  - everything 22.2%;
  - without the in-bank inserts, 18.2%;
  - without the native synth path (organ and drone notes, the tape echo, the hiss), 14.9%;
  - without both, 12.2%.
  - So the inserts cost about 4 points inside the bank (3.5–4.4 by round), and the native synth path about 7 (6.5–8.1). The takeoff's synth path is within the noise: 20.7% without it, against 19.8% with it, in separate sessions.
- **Voices.** A microbenchmark of 16, 48 and 96 concurrent sample voices costs 10.1%, 27.2% and 36% of a host core as native nodes (33.7% at 48 with a panner per voice), against 5.5%, 9.6% and 14.9% in the worklet bank. In the engine, the bank saves 3.6 points in Era I and 4.4 in the takeoff, where voices are many and long, and 0.8 in Era II, whose 25 voices are short marimba notes.
- **Single parts,** on Era II at 48 kHz: convolution costs 10 points (the FDN 2.6), the inserts 6 to 8, and the shaper's oversampling under 1. An idle context costs 1.6%.
- **The main thread.** The scheduler costs 0.12–0.20% of a core over whole pieces, against 0.15–0.6% with native voices. Its longest tick is 1.8–2.9 ms on the host, 0.8–1.2 ms on the reference.
  - The 23–34 ms ticks that version 1 reported for the takeoff came from starting it 100 s in, which generated the backlog in one tick. The conductor always starts a piece at its beginning.
  - A mid-piece start (tests only) spreads its backlog over the lookahead.
- **Memory.** The bank stores Int16 samples, half of an `AudioBuffer`'s Float32, and 32 kHz takes another third off.

**The budget** (on the reference machine; host values × 2.4):

| Measure | Budget |
|---|---|
| Audio-thread CPU, music and SFX together, averaged over a piece | ≤ 8% of one core (host ≤ 19%) |
| The same, in any 1 s window | ≤ 15% (host ≤ 36%) |
| Main-thread audio work (conductor, scheduler, SFX dispatch) | ≤ 0.5% of a core on average; every tick ≤ 2 ms |
| Decoded samples resident | ≤ 96 MB |

**Status, not claimed** (codex B2-r1 finding 4):
- **Era I meets the budget:** 5.7% on average, 7.8% in its worst second.
- **Era II does not:** 9.3% on average against 8%, though its worst second (13.5%) is within 15%. So the plan changes:
  1. **M1:** the synthesised notes and the tape echo and hiss move into the bank (above). As native nodes they cost about 7 host points, and the bank plays a sample voice at a quarter of a native voice's cost.
  2. If Era II still averages over 8%, one tape insert per era bus replaces the per-channel ones (about 4 points now), then a 32-voice cap, then marimba loops pre-rendered with their tape colour.
  - Without the synth path and the inserts, Era II measures 5.1% on the reference, so the budget is reachable. But the result of step 1 is not measured yet, and **M1's exit gate** is the measurement on the user's laptop (below).
- **The takeoff does not:** 8.2%. Its cost is its many long voices, so M4 caps its streams at 32 voices and pre-renders the shimmer layers, and M4's exit measures it.
- **The SFX** add about 1 point on the host (Era II with and without them).
- **The ÷ 2.4 is A1's factor,** measured on the simulation's code (§11). For audio it is an extrapolation, so it decides nothing alone.
  - **The method on the user's machine:** a page cannot read `/proc`, and Chrome 156 has no `AudioContext.renderCapacity`. So `bench.html`'s audio page (§10.6) renders each piece with its SFX load in an `OfflineAudioContext` at 32 kHz, calling `suspend()` every second. It reports the render time as a share of the audio's duration, on average and in the worst second.
  - On this host the realtime cost is 1.9–2.1 times the offline load, on all three pieces: realtime adds a wake-up per render quantum, the browser's resampling to the device, and its IPC.
  - So **the gate**, on the user's laptop: offline load ≤ 3.5% on average and ≤ 6.5% in the worst second of each piece, which is ≤ 7.4% and ≤ 13.7% realtime at the 2.1 ratio, with margin under 8% and 15%.
  - A machine that fails it gets reduced audio (below): recorded music and live SFX.

**Sample packs and loading.** The game ships only A4's *ship* profile (A4 §6.4); the 47 MB full pack is for offline renders. Files are Ogg Opus, content-hashed, with `loopStart`/`loopEnd` in the manifest (never file boundaries).

| Pack | Contents | Download | Decoded (Int16 at 32 kHz) | Loaded |
|---|---|---|---|---|
| SFX, slice set | about 90 files: UI, build, mine, footsteps, alerts, working loops of the slice's entities | about 0.6 MB | about 6 MB | with the first frame of a game |
| Era I | piano (shared by later eras), violin, viola and cello sections, contrabass, clarinet, harp, glockenspiel | 6.3 MB | 79 MB, of which the piano 55 MB | during the first piece (below) |
| Era II | marimba, vibraphone; the piano | +1.0 MB | +10 MB | in idle time after Era I |
| Era III (M2), IV and IV′ (M3), the takeoff (M4) | FM piano; glass; grains of the earlier packs | +0.2–0.4 MB each | +2–4 MB each | when the Literature year comes within about 5 years of the era (A4 §6.4) |
| The menu loop | the charter piece, rendered offline | 1.8 MB (Opus 96 kbps, 150 s) | none: a media element streams it | on the main menu |

- **The first piece of a game is the charter piece** (A4 §5.1 rule 1), the same in every game. It plays from the menu loop's recording, which the HTTP cache already holds, while the Era I pack (6.3 MB) downloads behind it. Generative pieces begin with the second piece.
- **Decoding** (codex B2-r1 finding 9), one path everywhere:
  - `decodeAudioData` on an `OfflineAudioContext` created at 32 kHz, which resamples to 32 kHz itself. The browser decodes off the main thread.
  - The main thread converts the resulting Float32 channels to Int16 in slices of at most 1 ms per frame, and transfers them to the voice bank over a `MessagePort`.
  - At most two files decode at once, so the temporary Float32 buffers stay under 8 MB.
  - WebCodecs `AudioDecoder` is not used: it takes encoded packets, so it would need an Ogg demuxer, the Opus header as its description, and a resampler. The audio work package may add that later behind the same interface, if decoding ever shows up in a profile.
- **Samples are stored at 32 kHz whatever the context's rate.** If the engine ever runs at 48 kHz, the bank resamples at playback (it already plays every note at a rate ratio), so residency does not grow with the engine rate.
- **Decode failures.** A file that fails to decode is retried once, then fetched from the AAC pack. If two files fail, the whole pack switches to AAC. A sample that never decodes is silent and logged.
- **Residency, measured** on the shipping pack at Int16 and 32 kHz:
  - all 12 instruments take 94.6 MB, of which the piano 54.6 MB;
  - Era I's instruments 79 MB, Era II's 65 MB, the takeoff's 84 MB, Eras I and II together 89 MB;
  - the SFX demo set 1.6 MB, about 6 MB for the slice set.
  - The current era's and the next era's instruments stay decoded; older eras' instruments are freed unless a resident era shares them (the piano).
  - The build computes every adjacent pair's residency and fails above 90 MB, which leaves 6 MB for SFX within §9.6's 96 MB. If a later era breaks it, the lever is the piano: mono below C3, or tails shortened from 7 s to 4 s.

**The SFX system** (consuming §15.6; rules after A4 §7.3):
- **Sounds are data.** `game/data/engine/sounds.yaml` maps an event type plus an entity type or material to a sound id. Each sound id has its variant files, category bus, gain, pitch and gain jitter, rate limit, voice cap, priority and whether it is positional. The audio module has no per-event code.
- **Variation:** every repeating sound has 3–4 variants, chosen at random but never the same twice in a row, with jitter of ±3% pitch (UI ±1.5%) and ±1.5 dB gain.
- **Rate limits** per sound type and 100 ms window: error 1 (I §3.12), build 3, mine 2, UI click 1 per 30 ms. Footsteps follow the walk cycle. Over the limit a sound is dropped, never queued.
- **Voices:** 24 SFX voices in the bank and at most 4 per type; steal the quietest, then the oldest.
- **Positional attenuation and mixing, as in Factorio.** World sounds are heard around the camera, which is the listener, and fall off with distance; UI sounds are not positional.
  - Gain: 1 ÷ (1 + (d ÷ R)²) for distance d from the view centre, with R = `audio_half_range` (§15.4), half the view width in tiles, so a sound half a screen away plays at −6 dB.
  - Pan: the screen x, mapped to ±0.7 at the edges.
  - Zoom: entity sounds lose 9 dB × clamp(log₂(1 ÷ zoom) ÷ 2, 0, 1), so −9 dB at 0.25×. Map view mutes world sounds and keeps UI sounds and alerts.
  - Multiplayer: other players' world events sound like one's own, by position. UI sounds play only for one's own events (the event's `player`).
- **Working sounds by proximity and count** (`AUDIO_WORKING`, §15.6): one looping voice per sound id.
  - Gain: min(1, 0.5 · log₂(1 + n)) × (wsum ÷ n) × the zoom factor, where n is the count of working entities and wsum their distance weights.
  - Pan: by the centroid. A loop starts at a random offset and fades in and out over 0.3 s.
  - At most 12 loops sound at once, the loudest.
- **Silence during catch-up and replay.** Historical events, and events more than 30 ticks old, never sound (§15.6). Extraction is off during catch-up and fast-forward, so no `AUDIO_WORKING` arrives. When no packet has arrived for 0.5 s, working loops fade out. A new state generation resets all audio state (§3.4).
- **Pause and focus.** A paused single-player game fades world sounds and working loops out over 0.3 s; UI sounds and music go on. A hidden page fades the music over 1 s and suspends the context (A4 §5.4).

**Starting, and what happens when it fails** (codex B2-r1 finding 8). Creating a context does not guarantee sound, so every step has a fallback:
- **User activation.** The first click or key on the main menu (07 §18) creates the `AudioContext` and calls `resume()`, and starts the menu loop's media element with `play()`, all inside that event handler.
  - If `play()` rejects or the context stays `suspended`, the menu shows a small muted-speaker button, and the next click or key retries both. Nothing else waits for audio.
- **Returning to the page.** On `visibilitychange` to visible, and on `focus`, the module calls `resume()` when the context is `suspended` or `interrupted` (Safari), unless the player muted it. A rejection waits for the next gesture, as above.
- **The worklets.** `audioWorklet` exists only in a secure context (§9.7's hosting). The module loads the bank and FDN processors with `addModule()` and listens for `processorerror` on their nodes. If `audioWorklet` is missing, `addModule()` rejects, or a processor errors, the engine switches to **reduced audio**:
  - music from recordings, A4 §6.1's *Music: recorded* setting: each era's pieces rendered offline at build time and streamed by a media element, about 3 MB per piece, fetched only in this mode;
  - SFX on native `AudioBufferSourceNode`s with at most 8 voices, no working loops beyond the 4 loudest, and no inserts;
  - a line in the settings' audio page saying so.
- **The processors** never allocate in `process()`. Notes arrive at most 10 times a second in one pooled message and are copied into a preallocated table of 2,048 notes; buffers and inserts are set up from messages, outside `process()`. Their work per render quantum is bounded by the voice caps (48 music, 24 SFX) and the 12 loops. The B2 prototypes (`audiocpu/bank-worklet.js`, `fdn-worklet.js`) follow this.

**Mixing targets** are A4 §8's:
- Music: each era bus is calibrated to −18 LUFS integrated at 100% (takeoff −16). The default music volume is 70% on a squared slider (−6 dB).
- SFX play at their authored levels (UI click −36 LUFS-M; builds −22 to −26; a working loop −28 for one entity, up to −22 aggregated).
- Alerts sit 8–10 LU above the music bed. There is no ducking, except the fade before the closure cue.
- The master is limited at −1 dBTP.
- The sliders are I §4.20's categories: Master, Music, Game effects (the effects, walking and environment buses), GUI and Alerts.

**Safari and the AAC fallback.**
- At start-up the engine decodes a 0.1 s Ogg Opus probe with `decodeAudioData`, and checks `canPlayType('audio/ogg; codecs=opus')` for the menu loop. Ogg Opus support in Safari depends on its version and the OS's, so only the probe decides. If either fails, the engine loads the AAC pack: `.m4a` at the same bitrates, made by the asset build with ffmpeg's AAC encoder.
- **One canonical timeline for loops** (codex B2-r1 finding 9). Loop points are in samples at 32 kHz of the *decoded* signal, counted from its first sample after the codec's priming is removed. The asset build computes them on the source WAV.
  - For each encoded file the manifest also records the canonical length in samples and a 64-sample fingerprint of its start.
  - After decoding, the audio module compares the decoded length and start with them. If the decoder left priming in (AAC's 1,024 or 2,112 samples, which browsers trim differently), it finds the offset by matching the fingerprint, trims it, and logs the browser once.
  - So AAC's priming cannot shift a loop or click.
- **Tests:** a Playwright test decodes every loop of both packs in Chrome and Firefox here, and in WebKit where it runs (the CI container). It checks each seam: the sample step across `loopEnd` → `loopStart` against the signal's own steps, and the spectral flux over the join.
- The AAC pack is about 25% larger; only browsers that fail the probe download it.

**Licences.** The sources are in A4's `LICENSES.md`, which moves to `game/assets/audio/LICENSES.md`: VCSL and VSCO 2 Community Edition, both CC0 at pinned commits, plus our own synthesis code and renders. GeneralUser GS is excluded. The sample fetch pins the commits and checks each file's SHA-256, and the credits carry A4's recommended credit line.

### 9.5 Quality control (headless; what Claude does on this machine)

1. **Contact sheets** per set: the base, the idle variant, the animated layer as a strip, the shadow and the glow, side by side at 1× and ½×, on the paper and on the cyanotype (`magick montage`). Claude reads the PNG.
2. **Animation:**
   - GIFs via `gifski`, for review;
   - **registration:** static pixels outside R are identical across frames by construction, and are checked anyway;
   - **the composite check** (codex B2-r1 finding 2), at the set's own boundaries:
     - the pieces plus layer k, drawn as the renderer draws them (premultiplied, bilinear, at levels 0–2 and three sub-pixel offsets), must equal frame k drawn whole: ΔE76 ≤ 0.5 on every pixel. §9.1 measured 0.00.
     - Each layer's frame k must equal the whole frame inked at once inside R, within one 8-bit step.
     - For frames 0 and count ÷ 2, frame k must agree with a full per-frame render within ΔE76 ≤ 3 on 99.9% of pixels.
     - The build fails if two layers' rectangles intersect after merging;
   - **the 3% rule** (A3 §9): a working machine's layer changes at least 3% of the sprite's pixels per loop, with one moving part of at least 0.3 tile.
3. **Geometry:** footprint and overhang per size class; the anchor on the footprint centre; the projection calibration (§9.1); the shadow direction (the mask's centroid lies east-south-east of the anchor).
4. **Legibility** (`metrics.py`, A3 §7):
   - the belt line-up at 16 and 32 px;
   - pairwise 8×8 Lab thumbnails under normal vision, deuteranopia and protanopia (Machado 2009), flagging pairs closer than 7; this automates 07 §23's rule;
   - information items at L\* ≥ 84 with ink marks, matter at ≤ 74 except quartz, and 20 L\* between same-hue pairs (A3 §3.2);
   - machines 25–60% darker than the paper.
5. **Compression:**
   - Every encoded page is transcoded back to BC7 and compared with its source. It must reach PSNR ≥ 40 dB at High and ≥ 37 dB at Normal, ΔE p99 ≤ 6 and detail kept ≥ 0.98 (§9.2's measures). A failure names the page and its worst sprite.
   - **Cells** (codex B2-r1 finding 10): the build asserts from the manifest that every cell sits on 32 px and that no two cells, gutters included, overlap.
   - It then transcodes each page to every format of §9.2's chains (BC7, ASTC 4×4, BC3, ETC2, BC4, EAC R11), decodes levels 0–3, and samples every frame's edge texels with the renderer's filter at each level. A texel that reads another cell's pixels fails the build.
   - The fallback formats are held to §9.2's measured quality, ±10%.
6. **In-game galleries.** `?scenario=gallery` places every set in a grid with alt-mode off and on, by day and at night, at zooms 0.5, 1 and 2, at device pixel ratios 1 and 2. Playwright screenshots it on SwiftShader with BC7 textures (seconds per frame: fine for stills). Claude reviews it, and `pixelmatch` goldens guard regressions (threshold 0.1, at most 0.2% of pixels).
7. **Audio:** EBU R128 loudness and true peak of the offline renders, spectrograms (`ffmpeg showspectrumpic`), loop seams after decoding, A4 §4.2's dissonance check on the note logs, and the CPU benchmark of §9.4.

### 9.6 Budgets

**The model.** `design/asset-study/render/budget_model.py` itemises every sprite set of the slice and of the full game: the data's 104 entities by class (§9.1's table), trees, rocks, resources, decoratives, cliffs, town buildings, the campus, the character and agents. It applies the per-unit costs measured on this host and the formats measured in §9.2. Version 2 (codex B2-r1 findings 3, 7 and 13) counts what is built and allocated, not only content:
- **Content:** a trimmed colour area of 0.75 (w + 0.2)(h + height + 0.2) × 64² px at High, calibrated on A3's 120 sprites.
- **Render canvas:** the rig's own, footprint plus margin plus the shadow's reach. It matches the complete prototype build exactly (§9.1).
- **Packing:** 32-px cells with 8-px gutters, +31% for whole sprites and +42% for layer frames, whose rectangles are small; MaxRects fill 0.874; pages rounded up per group.
- **Allocations:** every mode's immutable storage, plus every other GPU allocation (§6.13).
- **Render time:** per-frame shadows for `animShadow` sets and full-frame animations, the ink on the trimmed box, packing and encoding.
- **Validation:** its unit costs predict the complete prototype build within 6% (§9.1).

The content estimate stays ±30% until the art exists; the asset work package re-runs the model on the real sets at each milestone, and the byte inventory (§9.7) is the gate.

| | M1 slice | Full game |
|---|---|---|
| Sprite sets (direction × variant × state) / animated-layer frames / shadows | 752 / 1,504 / 920 | 2,260 / 2,955 / 2,360 |
| Colour at High, Mpx / the same with full-frame animation instead of layers | 27 / 35 | 116 / 170 |
| Pages: colour (2048²) / shadow (1024²) / light (512²) / icon (1024²) | 13 / 10 / 3 / 1 | 47 / 41 / 8 / 2 |
| Render time on this host, 16 threads on socket 1 (base, shadow, layers, ink, icons, packing and encoding) | 0.77 h (0.13, 0.40, 0.08, 0.12, 0.02, 0.03) | 2.61 h (0.40, 1.51, 0.14, 0.34, 0.12, 0.09) |
| GPU, everything allocated (§6.13): High BC7 / Normal BC7 / Low RGBA8, at dpr 1 | 150 / 91 / 100 MB | 358 / 144 / 168 MB |
| Art download in the chosen formats (XUBC7, ETC1S): Normal levels / plus every High level 0 | 4.8 / 12.7 MB | 18.2 / 52.0 MB |

- The largest items are trees (40 shapes × 5 leaf states), town buildings, rails, the 64-orientation rolling stock and the Frontier cluster.
- **Render time.** Version 1's 2-hour target is not met: the full game models at 2.6 h. The target becomes **≤ 3 h for a full rebuild** on socket 1, and ≤ 1 h for the slice. Builds are incremental: a set re-renders only when the hash of its script, the style or the rig changes.
  - The shadow pass is 58% of the time. If the real sets grow past the target, the asset work package's levers are, in order: shadows at 32 samples with a denoiser, border renders of the base passes on the geometry's projected box, and both sockets when no measurement is running.
  - A3's per-frame rebuild would take about 11 hours.
- **GPU:** §6.13's budgets hold in every mode it chooses: High where a 1-byte-per-pixel format exists, and Low for the full game's RGBA8 fallback. The browser's own framebuffers (24 MB at dpr 1, 95 MB at dpr 2) come on top and are not ours to budget.

**Downloads, everything** (sizes on the wire; code is estimated from A1's sizes per line, the rest is measured or modelled):

| | M1 slice | Full game |
|---|---|---|
| Code and data: JavaScript, `sim.wasm`, `gen.wasm`, prototypes, locale (brotli) | about 0.7 MB | about 1.4 MB |
| Fonts (7 WOFF2 subsets), the UI skin, the menu background | 0.5 MB | 0.5 MB |
| The Basis transcoder (stock build; brotli) | 0.4 MB | 0.4 MB |
| Art: atlases, shadows, icons, sheets, terrain (Normal levels) | 4.8 MB | 18 MB |
| Audio: SFX, the era packs, the menu loop | 9.7 MB | about 15 MB |
| **Total** | **about 16 MB** | **about 36 MB** |
| High level 0 of every page, fetched only where needed (§9.7) | +7.9 MB | +34 MB |

Both stay within §11's limits, 30 MB for the slice and 200 MB for the full game, even with every High page. Asset builds are reproducible from the scripts; outputs are cached outside git by content hash, and only sources are committed. §9.7 gives the budget per loading stage.

**Audio** (§9.4): ≤ 8% of a reference core on average and ≤ 15% in any second; decoded samples ≤ 96 MB. Era I meets it; Era II (9.3%) and the takeoff (8.2%) do not yet, and §9.4 gives the plan and the gate. Residency measures 79–89 MB per era pair.

### 9.7 Loading and streaming

**Principles.**
- A player downloads what the next screen needs, and the rest streams behind it in priority order.
- Nothing the simulation needs ever waits for an asset, and nothing the player sees waits for an asset it does not show: missing art draws a placeholder.
- Every file except `index.html`, `build-manifest.json` and `sw.js` is content-addressed and cached forever.
- The game works fully on a plain static host: a service worker is optional.
- All of it is measured against a **reference connection** of 25 Mbit/s (about 3 MB/s) with a 50 ms round trip. A Playwright test throttles the network to it and checks the stage budgets below.

**Budgets per stage** (cold cache; sizes on the wire after brotli; the Download column is the requirement, §11):

| Stage | What it needs | Download | Time on the reference connection |
|---|---|---|---|
| **First paint** | `index.html` with inline critical CSS, the paper background and the wordmark as inline SVG, and a progress line | ≤ 30 kB | 1 round trip plus 10 ms |
| **The main menu, interactive** | boot script; the menu chunk (Solid and the menu, new-game, load and settings screens); `build-manifest.json`; 3 font faces; the UI sheet; the menu background (07 §18: a static image first, 1280 px WebP, 161 kB) | ≤ 0.5 MB | ≤ 0.5 s |
| **Music on the main menu** | the menu loop, streamed by a media element from the first gesture (07 §18): 1.8 MB, of which 64 kB before the first note | 64 kB to start | ≤ 0.3 s after the first click |
| **The first frame of a new game** | the game chunk (renderer, HUD, input, decoders, audio engine) and the worker chunks; `sim.wasm` and `gen.wasm`; prototypes and locale; 4 more font faces; the transcoder; the **core** atlas group's Normal levels, shadows and icons; the start's terrain textures (9); the slice SFX | ≤ 5 MB (estimate 4.3 MB: code and data 0.6, fonts 0.1, transcoder 0.4, art 2.6, SFX 0.6) | transfer about 1.4 s, overlapped with worldgen and compilation; the 8 s cold budget of §11 holds at 10 Mbit/s |
| **The first frame of a loaded save** | as above, plus every group the save shows on screen | ≤ 5 MB plus about 0.4 MB per extra group | as above |
| **Each later technology group or era** | the group's Normal levels and DOM sheets; its era's sample pack; its town skin when W crosses a threshold (01 §5.3) | ≤ 3 MB per group, a build gate (below); prefetched before it is needed when the connection allows | in the background |
| **High level 0** | per page, when zoom × device pixel ratio first exceeds 1 on a page in view | about 1 MB per page | in the background; Normal is drawn meanwhile |

- The main menu prefetches the first frame's set while the player reads it: at low priority, after the menu is idle, and not when `navigator.connection.saveData` is set. A player who spends 5 s on the menu finds New game nearly instant.
- A warm start, with everything cached, revalidates `build-manifest.json` only; compiled WebAssembly also comes from the browser's code cache.
- The game's first piece of music is the charter piece played from the cached menu recording, so Era I's 6.3 MB pack is not in the first frame (§9.4).

**Code splitting** (Vite 8 with Rolldown; module workers):
- **Entry:** `index.html` loads `boot.ts` (about 8 kB). It reads `build-manifest.json`, starts the menu chunk, and registers the optional service worker.
- **Per screen:** every UI screen is a lazy Solid component behind a dynamic `import()`, in its own chunk. The screens are the main menu and its subscreens, the charter, the technology screen, the Handbook, statistics, the map view, settings and controls, the run report, and the entity windows grouped by kind. A screen's chunk is prefetched when its key or button is hovered, and in idle time once the HUD runs; the first open of a screen costs at most one round trip.
- **The game chunk** (renderer, HUD, input, decoders, the audio engine) loads on New game, Continue or Load game, and is prefetched in idle time on the main menu.
- **Workers** are module workers with their own chunks: the sim worker's shell, the worldgen worker, the IO worker and the asset worker (below).
- **WebAssembly:** `sim.wasm` and `gen.wasm` are imported as `?url` assets and compiled with `WebAssembly.compileStreaming(fetch(url))` (§2.3), which compiles while the bytes arrive.
  - `compileStreaming` rejects a response whose type is not `application/wasm`. On that `TypeError` the loader falls back to `WebAssembly.compile(await response.arrayBuffer())` and logs the misconfigured host once (codex B2-r1 finding 12).
  - The main thread compiles each module once per page and posts the `WebAssembly.Module` to every fresh sim and worldgen worker as a message value, never in a transfer list (modules are structured-cloneable, not transferable).
  - Browsers share the compiled code with the worker, so the fresh worker per world of §3.1 does not usually recompile. This is not guaranteed by the standard, and §11's start-up budget assumes nothing from it.
- **Data is not split by milestone or era.** All of `spec/data` measures 327 kB as JSON and 54 kB with brotli, and the locale adds about 25 kB. Splitting would save about 50 kB and add a failure mode.
- **Dev code** (`__game`, the debug overlays, `bench.html`) lives in chunks loaded only by dev builds or `?dev=1`.

**Assets on demand.**
- **Atlas groups.** The asset build packs each group into its own pages (§9.2), and every set, page, DOM sheet and sound names its group:
  - `core`: everything the first minutes of any game can show. That is the start's world (terrain textures of the start biome, its trees, rocks, decoratives and resources), the character, town skin 1 with its campus and landmarks, the Laboratory salvage, the Prior art entities, the smoke puffs, and a greybox set for every entity in the data. About 5 pages (§9.6's model: 2.6 MB).
  - **groups by unlocking technology** (codex B2-r1 finding 7), named `<tier>/<n>`: a technology's entities go into the group of the technology that unlocks the recipe placing them. Within a tier, consecutive technologies are merged up to 3 MB.
    - Groups per whole tier would not fit: the full game's Report tier models at 5.7 MB (rails, wagons, the crawler, the data refinery, the car), Model card at 2.5 MB.
    - The model gives 13 groups for the full game, the largest 2.2 MB, and 5 for the slice (`budget_model.py`).
  - one per town skin after the first, one per biome's trees and decoratives, and `wild` (M5).
- **The byte inventory** (`public/atlases/inventory.json`, a build gate): after packing and encoding, the asset build lists each group's pages, sheets, sounds and exact bytes on the wire.
  - The build fails if `core` with the first frame's other files exceeds 5 MB, or any other group 3 MB. It then names the group's largest sets, and the art work package splits the group or trims the sets.
  - The model is the forecast; the inventory is the check.
- **What loads when:**
  1. **New game:** `core` blocks the first frame; the groups of the technologies available to research follow at once in the background.
  2. **Before a technology is reached:** its group is prefetched at low priority when the technology becomes available to research. Nothing of it can be built before the technology finishes and its item is crafted, which leaves minutes to spare on the reference connection. On a slow connection or a join, there may be no lead time; then rule 4 and the placeholders carry it.
  3. **On load or join:** the groups of every technology the save has researched (from the `RESEARCH` projection, §15.5) load at normal priority, after the groups of what is on screen.
  4. **By visibility, always:** the renderer reports every set it drew without a resident page, and the asset worker fetches that page at high priority.
  5. **High level 0:** requested at high priority for pages drawn with more than one source pixel per device pixel (§15.7), and at low priority in idle time for all resident pages on screens with a device pixel ratio of 2.
- **Priorities** (the asset worker's queue, re-ordered every frame):
  1. Normal levels of pages that the renderer drew as greyboxes this second;
  2. sounds that an `EVENTS` or `AUDIO_WORKING` record asked for and did not find;
  3. `core`, then the groups of the save's researched technologies (rule 3);
  4. High level 0 of drawn pages (rule 5);
  5. prefetches (rule 2), then idle prefetches.
  - A request of a lower class never starts while one of class 1 waits. High level 0 takes at most 2 of the 6 connections while any Normal page is missing.
- **Retries and readiness.**
  - A failed or truncated fetch, or a file whose hash does not match, is retried after 1, 2, 4 and 8 s, then every 30 s, keeping its priority. Meanwhile its placeholder stays. After the fourth failure the HUD shows a quiet notice ("Some art could not be loaded; retrying").
  - A page is ready when all the levels of its mode except High's level 0 are uploaded, and a group when all its pages are.
  - Only the first frame waits, for `core`. If `core` fails four times, the loading screen shows the error with a Retry button and never enters the game with a missing core.
- **Placeholders, never waits:**
  - a set whose page is not resident draws its greybox from `core`;
  - a page without its High level draws its Normal levels (soft, but the right drawing);
  - a missing sound is silent;
  - a missing technology icon shows its tier's blank sheet.
  - **Late art keeps the current pose:** when the page arrives, the set is drawn at the frame, variant, shape and stage that the current packet selects (§15.7), so nothing restarts or jumps.
- **Audio by era** (§9.4): SFX with the first frame; Era I during the charter piece; each later era's pack as the Literature year approaches it. Working loops of later entities ship with their technology's group.
- **Late audio** (codex B2-r1 finding 7).
  - The conductor starts a piece only when its instruments are decoded. Until then the current piece goes on, or the silence after it is extended; pieces alternate with silences anyway (A4 §5.1 rule 2).
  - A one-shot whose sample is missing is dropped, never queued and never played late.
  - A working loop whose sample arrives late starts then, at a random offset, from the current `AUDIO_WORKING` snapshot (§15.6).

**The asset worker** (`src/assets/worker.ts`, a module worker; a new thread beside those of §3.1):
- **Fetches** with priorities (`fetch(url, { priority })`, at most 6 requests in flight) from a queue that the main thread re-orders every frame by its residency misses.
- **Transcodes** with the Basis transcoder (§9.2): it parses KTX2, transcodes each level to the GPU format chosen at start-up (the main thread probes the WebGL extensions once and tells the worker), and transfers the result to the main thread.
- **Decodes audio:** Opus to Int16 at 32 kHz, sent straight to the voice bank (§9.4).
- **Keeps a cache** of the compressed KTX2 bytes of resident pages, at most 64 MB, so that a lost WebGL context re-transcodes without refetching (§6.13). Beyond that, the HTTP cache serves.
- **Uploads stay on the main thread.** `compressedTexSubImage3D` of one level of one layer takes about 1 ms for BC7 (1.3 ms for a High page here), and uploads are limited to 2 ms per frame, at most one layer level per frame while the frame budget is tight. RGBA8 and R8 use `texSubImage3D`.
- **Cost** per page: 171 ms of worker time to transcode a High page to BC7 on this host and 44 ms for a Normal page; ASTC, BC3 and ETC2 take about twice that (§9.2). A newer laptop core is faster. None of it is on the main thread.

**Caching.**
- **Content-addressed names** for every file except `index.html`, `build-manifest.json` and `sw.js`. Vite hashes the JavaScript, CSS and WebAssembly chunks; the asset build hashes atlases, sheets, fonts and audio (`name.<hash8>.ext`), and `sprites.json` and the audio manifest name the hashed files. `build-manifest.json`'s asset list carries every file's SHA-256 (§2.3).
- **Old builds stay loadable** from the build archive of 11 §6.3. Because asset names are content hashes, all builds share one asset directory: an archived build costs its `index.html`, its manifests and the files it does not share.
- **HTTP headers:**
  - `Cache-Control: public, max-age=31536000, immutable` for hashed files;
  - `Cache-Control: no-cache` with an ETag for `index.html`, `build-manifest.json` and `sw.js`;
  - `Content-Type: application/wasm` for WebAssembly, which `compileStreaming` requires (the loader falls back without it), and `image/ktx2` for KTX2.
- **Hosting requirements.** The game is served over HTTPS, or from `localhost` / `127.0.0.1` in development: module workers, the AudioWorklet and the service worker need a secure context, and `file://` fails the module fetches. A plain static host with correct MIME types is enough.
- **The service worker is optional.** `sw.js` is registered only on a secure context where `navigator.serviceWorker` exists, and a failed registration is silent.
  - It precaches the menu set; after the first game, also `core`, the SFX and Era I. Hashed URLs are served cache-first, and `index.html` and `build-manifest.json` network-first. That gives offline play once a game has been loaded (07 §19.2), but only with what is cached: groups and music packs never fetched draw placeholders and stay silent offline.
  - **Updates:** when `build-manifest.json` carries a new `buildHash`, the worker caches the new build in the background, and the main menu shows that a new version is ready. It never switches builds during a game.
  - Its Cache Storage counts against the origin's quota with the saves (§8.2). It is capped at 150 MB and drops old builds first.
  - **Without it** (Claude's Artifact pages, a browser that refuses it) the game works fully online and the HTTP cache does the same job. A Playwright test runs with service workers blocked.

**Compression.**
- The build writes brotli (quality 11) and gzip (level 9) siblings, `.br` and `.gz`, for every text-like file: JavaScript, CSS, HTML, JSON, WebAssembly, SVG, `prototypes.bin` and the locale. Measured ratios: WebAssembly 0.31 (A1), the data's JSON 0.17.
- It writes none for files that are compressed already: KTX2 (Zstandard inside), WebP, PNG, Opus, M4A and WOFF2. Brotli gains at most 1% on them (measured, §9.2).
- `npm run preview` and the dev server serve the siblings by `Accept-Encoding`, as nginx's `brotli_static` or Cloudflare would. A host without precompression serves the plain files: correct, about 1 MB more for the first frame.

**Memory.**
- **GPU** (§6.13 owns the allocation rules and budgets):
  - Each kind of atlas is one `TEXTURE_2D_ARRAY` with immutable storage (`texStorage3D`), allocated once at load with the manifest's page count and the levels of the resolution mode; it never grows.
  - Per layer in BC7: colour (2048², 4 levels) 5.6 MB, icons (1024², 3 levels) 1.4 MB, light (512², 2 levels) 0.33 MB; shadow (1024², 3 levels) in BC4 0.7 MB.
  - **The resolution setting** is Factorio's *Sprite resolution*, with High, Normal and Low (§6.13). Normal and Low allocate arrays without the higher levels and never download them.
  - **A page without its High level** is sampled from level 1 up. The fragment shader clamps the level of detail per layer from a uniform array (`uMinLod`, one value per layer), and sets it to 0 when level 0 arrives.
  - **Eviction only as a safety net.** Every unlocked group stays resident, as all sprites do in Factorio, and the modes' budgets hold (§6.13). Only when even Low fails to allocate do pages share layers (§6.13).
- **Audio:** decoded samples ≤ 96 MB, as Int16 in the voice bank (§9.4).
- **JavaScript heap:** the KTX2 cache lives in the asset worker (≤ 64 MB). The main thread holds the manifests and lookup tables only, a few MB.

**Multiplayer** (chapter 11).
- **The same build.** `HELLO` carries the build hash, and the relay refuses a different one (11 §3.2, §6.3; D14). A refused client loads the room's build: it fetches that build's `build-manifest.json` past every cache, the service worker's included, from the build archive when the room runs an older build, and reloads.
- **Assets never block the lockstep.** The simulation never waits for an asset; art and sound are presentation only. A joining client downloads the checkpoint at high priority and assets at low priority in parallel. Catch-up runs with extraction off (§3.3), and meanwhile the asset worker fetches the groups of the room's research state. If play starts before a page arrives, placeholders draw.
- **Every peer draws the same picture.** Variant choices that the packet does not carry (tree shapes, resource shapes, decoratives) use the position hash of §15.7, so screenshots and bug reports agree across peers.
- **A join is silent until it is live.** Historical events never sound (§15.6).

### 9.8 The *Survey* look in the renderer

The look is a few shader stages over the frame structure of §6.2, parameterised by the style constants of §15.7, so another style is a new constant table and not new code (IMPL-5). The numbers are A3's and were checked on its mocks; `design/art/proto/scene.py` and `extras.py` are the reference implementations, and a screenshot test compares the engine with them on the gallery (§9.5).

**Shadows: hatching, not darkness** (§6.2 step 3; A3 §4.2). The shadow pass MAX-blends every visible shadow mask into an R8 target at half resolution. The composite draws world-anchored hatching through it, so the lines never swim when the camera pans:

```glsl
// uPeriod = 7/64 tile, uWidth = 1.7/64 tile, uInk = 0.55, uDarken = 0.06, uInkColour = #2b2723,
// uPxPerTile = PX_PER_TILE · zoom · dpr (§15.7)
float hatch(vec2 tiles) {                                   // ground position in tiles
  float u = dot(tiles, vec2(0.70710678, -0.70710678));     // across the −45° lines
  float dist = (0.5 - abs(fract(u / uPeriod) - 0.5)) * uPeriod;   // to the nearest line, tiles
  float aa = 0.75 / uPxPerTile;                             // a 1.5-device-pixel edge
  float line = 1.0 - smoothstep(0.5 * uWidth - aa, 0.5 * uWidth + aa, dist);
  // band limit: below 3 device px per period the lines would alias, so fade to their mean coverage
  return mix(uWidth / uPeriod, line, smoothstep(2.0, 3.0, uPeriod * uPxPerTile));
}
float m = clamp(texture(uShadowTarget, vScreenUv).r * 1.4, 0.0, 1.0);
float h = hatch(vGroundTiles) * m;
colour = mix(colour, uInkColour, uInk * h) * (1.0 - uDarken * m);
```

At zoom 1 and dpr 1 the period is 3.5 device pixels. Between 0.86× and 0.57× the lines fade into a flat 13% ink tone, which is what the eye averages the hatching to anyway.

**Lights.** The light pass (§6.2 step 7) adds every lit emitter's glow sprite (the light array), scaled by `DYN.light`, into the half-resolution light target (RGBA16F where `EXT_color_buffer_half_float` exists, otherwise RGBA8, which clips the sum at 1). Then one full-screen pass composites day and night:

```glsl
// L = the light target; n = night strength = clamp((1 − daylight) ÷ (1 − AMBIENT_FLOOR), 0, 1)
vec3  L    = texture(uLightTarget, vScreenUv).rgb;
float a    = clamp(max(L.r, max(L.g, L.b)), 0.0, 1.0);
vec3  hue  = L / max(a, 1e-4);
// by day: a warm watercolour stain on the paper (A3 §4.3)
vec3  day  = colour * (1.0 - 0.6 * a * (1.0 - hue));
// at night: the cyanotype (A3 §4.4), with the day colours revealed where the light falls
vec3  cyan   = texture(uCyanotypeLut, colour).rgb;          // 32³ LUT of the formula below
float reveal = clamp(a * 1.6 * 1.4, 0.0, 1.0);              // the half-resolution target is soft already
vec3  night  = mix(cyan, colour, reveal);
night = 1.0 - (1.0 - night) * (1.0 - clamp(L * 0.9, 0.0, 1.0));
colour = mix(day, night, n);
```

**The cyanotype LUT** is computed at start-up into a 32³ RGBA8 3D texture (128 kB), from A3's formula: lum = Rec. 709 luminance of the day colour; cyan = pale `#d6e4ec` + (deep `#13304f` − pale) × clamp((lum − 0.12) ÷ 0.80, 0, 1); then cyan × 0.82 + day × (0.45, 0.55, 0.85) × 0.18, so that belts and machines keep a trace of their coding.

**Post** (§6.2 step 9): the colour-blind LUT, when enabled, comes last, after the night grade. The world overlays (§6.2 step 8) are drawn between the two, so the night grade never touches them and the colour-blind LUT always does (codex B2-r1 finding 11).

**Smoke** (A3 §8): three inked cloud puffs per chimney of a working burner, drifting east and fading over 2 s. The puffs are sprites in the core group; the renderer spawns them from `DYN` state with a seeded counter. They are never simulated (§6.8).

**Paper grain** lives in the terrain textures and the sprites. There is no screen-space grain, vignette, bloom or depth of field (A3 §14).

### 9.9 Terrain, water and decoratives (assets)

**Material textures** (A3 §11). Each tile type has a seamless 512² texture that covers 8×8 tiles at High and is sampled in world space (§6.5). There is one per tile type of `tiles.yaml` (18 in the slice), plus a dry and a cold wash of grass for biomes, about 22 in all. They are made procedurally by A3's `terrain.py` (paper grain, grass ticks, stipple) or from an image model's flat, unlit wash written to `assets/textures/survey/<tile>.png` (A3 §6). They are encoded as XUBC7 at quality 90 with three levels: 1 B/px on the GPU, about 7 MB for all of them.

**Edges** (A3 §11; §6.5's noise mask). The terrain shader reads the chunk's tile ids (§6.5) and, for each pixel, looks the tile id up at a position warped by world-anchored noise (0.32 tile amplitude, 1.6-tile cells, from the position hash of §15.7) and blended over 0.55 tile. Every pixel takes the strongest type. Crisp types (town streets, town blocks, the concretes) skip the warp and get an inked kerb line, `#3b332b`, at their edges.

**Water-lining.** Lines parallel to the shore at 0.12, 0.30, 0.52, 0.80, 1.15, 1.60, 2.2 and 3.0 tiles, fading with distance, plus an inked shoreline (A3 §11).
- They need the distance to the shore. When a chunk enters the held set (§3.4), the main thread computes a per-chunk RG8 texture at 4 texels per tile, with a 3-tile border taken from neighbouring held chunks. Its red channel is the shore distance, by a two-pass chamfer transform (about 0.2 ms per chunk). Chunks with neither water nor trees skip it.
- The terrain shader draws each line where the distance crosses its value, at a width of one device pixel, so the lining stays crisp at every zoom and fades below 0.5×.

**The woodland tint** (A3 §3.1): a 30% wash of `#c9dca8` under tree clusters. The main thread rasterises the held chunks' trees (`CHUNK_OBJECTS`) into the same texture's green channel (radius 1.6 tiles, blurred 0.6 tile), and the terrain shader applies it.

**Resources** are sprites per tile at 70% ink (the archive's bundles at 75%): 6 shapes × 8 depletion bands, chosen by `CHUNK_RESOURCES.band` and the position hash. **Decoratives** are sprites at 45% ink, 4 variants each, with their density capped per chunk by worldgen and culled below 0.5× (§6.12). **Trees** are 10 species × 4 shapes × 5 leaf states (4 stages left down to bare); the species comes from the biome (an engine overlay table), the shape from the position hash, and the leaf state from `ObjectView.variant` (heat strips leaves, 01 §2.2; §15.7's `stage` axis). **Cliffs** (M2) are inked escarpments in 8 orientations, with straight, corner and end pieces.

---

## 10. Testing and verification

### 10.1 The pyramid

| Level | Tool | Runs | Share |
|---|---|---|---|
| Unit (Rust) | `cargo test` (native) | Gap encoding, segment merging, satisfaction, RNG, `det`, the save codec, the expression interpreter, codecs | many, milliseconds each |
| Unit (TypeScript) | Vitest (Node) | Codecs and decoders, the shell against a dev build of `sim.wasm`, the sequencer, subscriptions and generations, the data stage, UI logic | many, milliseconds each |
| Scenario | `cargo test --profile ntest` with the scenario DSL | Golden ratios, rule behaviour, determinism (each scenario also runs under NO_SLEEP and through a mid-run save and load) | hundreds, ≤ 1 s each |
| Property | proptest (Rust), fast-check (TypeScript) | Random build, rotate and remove sequences against invariants; fuzzed closures; codec limits | dozens |
| Cross-engine | `simtool` and Playwright | The same closure logs natively, in Node, Chrome and Firefox: per-tick digest traces and full state hashes | nightly; one smoke trace in `ci` |
| E2E | Playwright 1.64.1 + Chrome 156 (SwiftShader), Firefox 157 (`?render=none`) | I's feel tests F1–F28, window screenshots, smoke, loading and streaming (§10.5) | dozens, seconds each |
| Visual | Playwright + pixelmatch + Claude review | Galleries, windows, overlays; the asset build's checks (§9.5) | per change |
| Benchmark | `simtool bench` (native), the Node and browser runners, `bench.html` on the user's laptop | ms per tick, memory, frame time, audio CPU | per milestone and on hot-path changes |

### 10.2 The scenario DSL

Scenarios are Rust tests against the `sim` crate. They drive the World **through closures**: every helper that changes the world encodes an action with the generated codec and runs it through the **`TestSequencer`**, so every scenario exercises the action pipeline (S2). The `TestSequencer` (in `sim::testkit`) is the native twin of the TypeScript `LocalSequencer` (§3.3): it allocates seqs, writes input generations, applies the shared admission rule (§15.3) and closes ticks on demand. A fixture pins the pair: the same action script produces byte-identical closures in both (B1-r1 20).

```rust
#[test]
fn memo_block_makes_60_per_min() {
    let mut w = Scenario::from_layout("test/layouts/memo-60.txt", Opts { power: Power::Infinite, seed: 1 });
    w.run(minutes(2));                                        // warm-up
    let n0 = w.stats().produced("memo");
    w.run(minutes(10));
    assert!((w.stats().produced("memo") - n0 - 600).abs() <= 1);
}
```

**Layouts are ASCII grids** (`test/layouts/*.txt`, shared with the TypeScript tools). A legend header maps characters to `entity[:dir][:recipe]`, and multi-tile entities are anchored at their top-left character:

```
# legend: C=iron-chest  i=inserter:E  A=assembler-1:recipe=iron-gear-wheel  >=transport-belt:E  E=electric-interface
C i A . . i C
. . . . . . .
. . . . . . .
```

**Helpers:**
- `place(id, pos, opts)`, `insert(entity, items)`, `run(ticks)`, `stats()`, `entity_at(pos)`, `act(action)`;
- `infinite power` and `infinite source/sink` test entities;
- `hash()`, `digest()`, `save()` and `load()`.

**Every scenario runs three ways** by default (`Scenario::check_equivalence`, on in `ntest`): as written; under NO_SLEEP; and saved and loaded into a fresh World at a seeded random tick. The three must agree on every per-tick digest and on the full state at the end (D18 a, b); for the first 2,000 ticks they must agree on the **full canonical state bytes after every tick** (B1-r1 20). Each scenario also records its closure log in `test/logs/`, which the cross-engine runs replay (§10.4).

### 10.3 Golden ratio tests (expected values from Factorio and the wiki, frozen after the first pass)

| # | Scenario | Expected |
|---|---|---|
| G1 | Saturated belts, 10 min | 15 / 30 / 45 items/s; lanes half each |
| G2 | Underground pair capacity | 44 items (yellow, gap 4); 72 (express, maximum gap) |
| G3 | Splitter 1 → 2 | Exact alternation per lane; lanes preserved |
| G4 | Side-load compression | Full compression on the target lane (wiki behaviour) |
| G5 | Inserter chest → chest, stack 1 | 0.79 / 0.86 / 1.25 / 2.5 / 2.5 items/s (burner, inserter, long-handed, fast, bulk) ±1% |
| G6 | Inserter belt → chest (wiki 2.0.26 table) | Inserter 0.94; fast 2.31–2.50; long-handed 1.18–1.25 ±3% |
| G7 | Insertion limit | Inserters stop at ingredients for clamp(1 + crafts completable in 1.166 s, 2, 100) crafts (wiki); fuel at 5 |
| G8 | Stone furnace | 1 plate per 3.2 s (18.75 per minute); coal items per plate as Factorio's (ISO flow). Burner power and fuel values are ×3 (DECISIONS §18), so the furnace emits 270 kW |
| G9 | Electric mining drill | 0.5 ore/s at mining time 1 |
| G10 | Memo block (layout file) | 60 ± 1 per minute; Report block 60 ± 1 per minute |
| G11 | Steam | 1 boiler outputs 1.8 MW = 60 steam/s from 6 water/s (`extra.water_per_s`, 2.0's 1 : 10), burning 5.4 MW of fuel (DECISIONS §18) with coal items per minute as Factorio's. The boiler emits nothing; its 2 steam engines at 900 kW each emit 2 × 0.9 MW (DECISIONS §24), so the plant still emits 3.6 MW per boiler. One offshore pump (1,200/s) feeds 200 boilers |
| G12 | Brownout | At 80% supply, an assembler runs at 80% ± 1% averaged |
| G13 | Fluids | 10 chemical plants on one segment get equal shares ±10%; a pump moves exactly 1,200/s; a 251-tile pipeline carries no flow |
| G14 | Labs | Research rate = Σ speed ÷ unit time; packs drain per unit |
| G15 | Thermal field (F's calibration) | The engine and `tools/ref/heat_calib3.py` (F's `calib3.py`, verbatim) agree within **0.5 K at steady state**, the one tolerance shared with 09 S-G4. Cases: 09 S-G4's (grass, ambient 15 °C, 2 chunks × 18 MW + 3 × 3 chunks × 2 MW: plant chunks (28, 32) +24.7 K and (29, 32) +25.4 K, the empty chunk (30, 32) +13.0 K, the consumer block's corner nearest the plant (31, 32) +10.1 K, the block's centre (32, 31) +9.0 K, steady within 30 game-minutes) and 03 §1.6's table |
| G16 | Staffing | Supply 2, four working speed-1 Seminars → each at 0.5 speed. With +40% speed from modules in each, demand is 4 × 1.4 = 5.6 → 0.357. A Researcher in the slot → 1.0 and demand 0 (§5.10) |
| G17 | Takeoff (M4) | A scripted takeoff from the reference closure state reproduces 04 §0's reference within 5%: the takeoff time and the time of the last 10 technologies, whose current values 04 §0 owns. The reference is `design/round4/world-sim/takeoff_r4.py` (00 §10), which imports round 2's `r2w_full.py` and G's `takeoff.py` and runs them at 60 s per unit with the round-4 closure state |
| G18 | Quality | A 10⁶-craft run matches the analytic tier distribution within 3σ, with the verifier cap (§5.16) and catalysts returned at their own quality |
| G19 | Trains | Braking distance and travel time on a straight track match the analytic physics ±1 tick |
| G20 | Agents | Delivery of 500 items between two chests: completion time ±5% of the FFF-374 arrival-time model |

**Workflow.**
1. When a golden is first written, the expected value comes from the wiki or Factorio data. The test asserts within the tolerance.
2. Once the test passes, the exact count is **frozen** as a regression golden (`test/goldens/*.json`).
3. Any change to a frozen value needs an explicit `--update-goldens` and a note in the commit message.

### 10.4 Determinism and structural invariants

The D18 suites (§4.1) compare **full canonical state**, not only digests: a full-state mismatch also reports the first differing section and field, decoded by the generated readers.

| # | Test | What | Where |
|---|---|---|---|
| 1 | Repeatability | The same scenario run twice gives the same per-tick digests and hash | every scenario (`cargo test`) |
| 2 | Save/load | Run to tick t, save, load into a fresh World, continue to T: equal to an uninterrupted run; also 10,000 ticks after load on the benchmark saves (D8) | every scenario; `test:slow` |
| 3 | **Join equivalence** D18(a) | Save at seeded random ticks, load, and compare against the uninterrupted run: the full canonical state bytes after **every** tick for the first 2,000 ticks after the load, then per-tick digests and the full state every 600 ticks and at the end (B1-r1 20) | every scenario and fuzz case |
| 4 | **NO_SLEEP equivalence** D18(b) | Per-tick digests and full state equal with and without sleeping (§4.6) | every scenario; Mid and Late saves in `test:slow` |
| 5 | **Heavy mode** D18(c) | Every k ticks, serialize, load into a second World, step both and compare full state; finds unsaved state and order-dependent rebuilds (after Factorio's heavy mode) | `test:slow` on long runs; `?heavy=1` in the browser |
| 6 | **Cross-engine** D18(d) | The same closure logs natively (`simtool replay --trace`), in Node, Chrome and Firefox (the trace page, §10.5): identical per-tick digest traces and final hashes, and for short adversarial logs (≤ 2,000 ticks: the golden set, fuzz cases) the **full state hash after every tick** (B1-r1 20) | `ci`: one 10,000-tick log and the golden set; `test:slow`: every log in `test/logs/`, on the release build too |
| 7 | **Replay** D18(e) | Every recorded session (E2E closure logs, bug bundles, the scripted opening) replays to its recorded digests and hash | `npm test`, `test:slow` |
| 8 | **Multi-client harness** D18(f) | N Worlds in one process fed one closure stream through a simulated sequencer; joins by checkpoint mid-run; full-state agreement after every injected fault. M0 builds it natively in Rust; the MP milestone adds the relay's `RoomCore` and a simulated network (11 §9) | `cargo test`; MP |
| 9 | **Codec and wire probes** D18(g) | Every action, event, projection and packet record at its field limits; refusal of over-long payloads, truncated batches, unknown types and versions; fuzzed closures never trap. The MP milestone adds the relay's wire probes (11 §9) | `cargo test`, Vitest |
| 10 | Incremental equals rebuilt | After random edit sequences, transport lines (with their ranks), fluid segments, electric, circuit, logistic and data networks and rail blocks equal a from-scratch rebuild in canonical form, **including the floats each network computes** (D4) | property tests |
| 11 | Conservation | Total items across inventories, belts, hands, the ground, agents and machine slots (staff, accelerator, weights and rollback inputs included) change only through recorded production, consumption, mining, crafting, rollback and destruction. Fluids likewise | property tests |
| 12 | Old saves | Every golden save from earlier milestones loads and runs 1,000 ticks without error (§8.3) | `npm test` |
| 13 | **Continuation equivalence** (D9) | Runs that differ only in their read schedule (extraction every tick, never, or at random over random views; subscriptions and queries of every kind added and dropped at random) give identical per-tick digests and full states, and the full state hash is unchanged by any burst of reads (§3.6; B1-r1 4) | `cargo test` |
| 14 | Worldgen | Sweeps (09 S-G1): every guarantee of 01 §9 over 1,000 seeds, including DECISIONS §32's compactness and the lake rule; the same seed gives identical chunk hashes twice; no pool, 1 worker and 4 workers give identical chunks and world hash (D12) | `test:slow` (about a minute on this host's 32 threads) |
| 15 | Allocation | Zero heap allocations in 6,000 steady-state ticks of each of the milestone's benchmark saves (§10.6), with the growth paths of §2.5 measured rather than banned | `test:slow` |
| 16 | **Mirror equivalence** (§15.4) | After random world edits (belt lines deleted, split and merged under a camera that never moves), view moves, overlay and chart toggles, subscription changes and skipped extractions, the state the main thread decodes from the packet stream equals what one `FULL` extraction of the same world gives; a paused load and a replacement each receive their first packet (B1-r1 12, 13) | Vitest against `wasmdev` |

### 10.5 E2E and screenshots

- **Playwright config:** `executablePath: ~/.local/opt/chrome-current/chrome`, viewport 1280×720, `?test=1&render=on-demand`.
  - The renderer draws only when asked, so rendering never slows `step(n)`.
  - Measured: 20k sprites per frame take about 70 ms on SwiftShader with expanded quads.
- **Feel tests:** I §6's F1–F28 drive the **real input layer** (keyboard and mouse events), step the sim with `__game.step(n)`, and assert with `__game.query`.
- **Window screenshots:** `__game.ui.open(name)` for every window and state, with golden diffs (pixelmatch, threshold 0.1, ≤ 0.1% pixels).
- **Every E2E test fails on any console error or warning** from the page or the workers (forwarded, §3.2).
- **Smoke** (`@smoke`): new game, walk, mine, craft, place, save, reload, hash. It runs in `npm run ci`.
- **Firefox.** 09's S-G13 needs Firefox determinism hashes and S-G14 needs a Firefox capture self-test.
  - Playwright 1.64's Firefox 157 build lives in Playwright's own cache and **launches on this host** with Workers and WebAssembly, but has **no WebGL2** in headless mode, even with `webgl.force-enabled`.
  - Firefox runs therefore use `?render=none`, a renderer stub that keeps the canvas and DOM but draws nothing. The sim, input and UI paths are fully exercised.
  - Firefox *rendering* is checked on the user's machine (§10.7).
- **The trace page** (`test/trace.html`): loads a closure log and its start save in the real sim worker, replays it with extraction off, and posts the per-tick digest trace and final hash. Playwright runs it in Chrome and Firefox; `simtool replay --trace` produces the native trace and Node runs the same worker code in-process. All four must be identical (D18 d).
- **The scripted opening** (09 §7.1) is a recorded **input script** (keyboard and mouse events by game tick) on a fixed seed, replayed through the real input layer on every build. The closure log it produces, its milestone times and its state hashes are regression goldens; a data edit that renumbers prototypes changes the closure log, never the script.
- **Trap recovery** (§3.6): a dev-only action that panics the module must show the trap notice, reload the last autosave in a fresh worker and leave a bug bundle that reproduces the panic natively.
- **Loading and streaming** (§9.7): one test throttles the network to the reference connection (25 Mbit/s, 50 ms round trip) and checks every stage budget from a cold cache; another runs a new game and a load with service workers blocked; a third checks that a set whose page is withheld draws its greybox and never stalls the simulation.

### 10.6 Benchmarks and calibration

**Scenarios** are generated by `bench/factories/*` (A1's seeded generator, `design/engine-study/gen/`, is the starting point) and stored as saves. Each belongs to the milestone that implements its systems, and the capability manifest enables it (§2.4; B1-r1 19). Thresholds are for the reference machine; `ci`'s budget gate multiplies them by the host factor 2.4 (§11).

| Scenario | Content | From | Threshold |
|---|---|---|---|
| `m0-walk` | One character walking for 10 minutes in a straight line through new land, with no worldgen workers (inline commits only) | M0 | mean ≤ 0.2 ms per tick, p99 ≤ 2 ms |
| `m0-chests-10k` | 10,000 chests with filled inventories and a character, with 32 chest windows open | M0 | tick mean ≤ 0.1 ms; extraction with the 32 subscriptions ≤ 0.3 ms; save ≤ 50 ms; load ≤ 300 ms; full state hash ≤ 20 ms |
| `m0-codec` | Encode, frame-check and apply 100,000 actions | M0 | ≥ 10⁶ actions per second natively |
| `m0-load-30k` | A save with 30,000 generated, mostly pristine chunks | M0 | load ≤ 1 s; no tick in the next 600 regenerates more than 8 chunks |
| `slice-3h` | A typical slice factory | M1 | §11's slice row |
| `worldgen-frontier` | Eight characters exploring in different directions, radar bursts, and a heat front reaching pristine chunks right after a load, with no worldgen workers (B1-r1 16) | M1 | p99 ≤ 4 ms per tick |
| `mid-article` | Mid-game base, §11 | M2 | §11's Mid row |
| `belts-300k`, `inserters-50k` | Belt items; inserters | M2 | §4.7's per-entity costs × 1.5 |
| `trains-100`, `circuits-2k` | Trains; combinators | M2 | §4.7's rows × 1.5 |
| `late-modelcard`, `agents-5k` | Late-game base, §11; agents | M3 | §11's Late row; §4.7's agent row × 1.5 |
| `takeoff-500` | 500 compute halls | M4 | §11's Takeoff row |

**Runners.** `simtool bench --scenario X` (native), the Node runner (WebAssembly in a worker thread) and the browser runner (WebAssembly in a module worker in Chrome and Firefox, driven by Playwright; A1's `harness/bench-core.ts` is the starting point) report the mean, p50, p90, p99 and maximum ms per tick, per-phase µs, linear-memory bytes and allocations. Results append to `bench/history.jsonl` with the git hash, the host's clock log and the load during the run.

**Method** (A1; IMPL-3).
- Pin to socket 0 (`taskset -c 0-7`); other agents use socket 1. Check the load first.
- Warm up 6,000 ticks (the regimes are steady by then), time 3,600 ticks one by one, then 600 with per-phase timers; repeat at least 3 times.
- The host runs at its 2.6 GHz base clock with turbo windows of minutes, so single runs differ by up to about 25%. **Comparisons are paired within one session**: the variants alternate within each repetition, in alternating order, with the clock logged (`freqlog.sh`) during every timed window; runs with turbo in their window are flagged and kept out of absolute numbers.
- **No gate against history.** `history.jsonl` is a log, not a baseline. `npm run ci` runs `bench --quick` only as a **budget gate**: a scenario fails when its p99 exceeds its §11 budget times the host factor (2.4). A hot-path change must come with a paired A/B (`npm run bench:ab -- --base <rev>`: both builds, interleaved, reporting the paired ratio and its spread) in its report.

**Calibration with the user's laptop.**
- The user opens `http://127.0.0.1:5173/bench.html` through the tunnel once per milestone.
- The page runs the same scenarios in a worker (WebAssembly, as in the game), a render benchmark (synthetic scenes at the §6.12 sizes, frame times by `performance.now` around `gl.finish` sampling), the audio page (each piece with its SFX load rendered offline; the render speed estimates the engine's realtime CPU share against §9.4's budget, which M1's exit requires; §9.4 gives the method), a log of the WebGL extensions and of the per-format probe of §9.2 and, from the MP milestone, the hidden-tab check (11 §9).
- It POSTs to `/__bench`.
- The measured host/laptop ratio (estimated at 2.4 for §11's reference machine at the host's base clock) turns host numbers into laptop predictions. The render numbers are the only GPU truth available.

### 10.7 The verification loops

**Claude's loop, per feature:**
1. Write or extend scenario tests from the spec (red).
2. Implement until they pass (green), natively: `cargo test` builds incrementally in 1–3 s (A1).
3. Run `npm test`. Run `npm run e2e -- --grep <area>` when input or UI changed.
4. Take screenshots of the affected scenes and windows with Playwright or MCP. **Read the PNGs.** Check the console.
5. Run `npm run bench:ab` if a hot path changed.
6. Run `npm run ci` before committing.

Software rendering here is visually faithful but slow, so Claude judges frames, never frame rates.

**The user's loop, per milestone or on request:**
1. Play through the tunnel on a real GPU.
2. Use `/report` for anything wrong. Claude replays it natively.
3. Run `bench.html` for performance truth.
4. Use `/shot` for visual issues seen only on real hardware.

Playtest checkpoints are part of each milestone's exit criteria (§12).

### 10.8 Rule scenarios (one per engine rule that the design left open until round 4)

Each is a scenario test (§10.2) in `crates/sim/tests/rules/`, named by the critique's tag, and each also runs under NO_SLEEP and through a save/load in the middle (§10.2). A scenario runs from the milestone that implements its systems, as the capability manifest lists (§2.4): **M0 runs R23–R29**, except R28's heat case (M1) and agent case (M3) and R29's smart-belt case (M1); R21–R22 run from M1a; the rest as §12 says (B1-r1 19).

| # | Rule | Scenario and pass condition |
|---|---|---|
| R1 | Thermal plants (DECISIONS §24; §5.9) | Boiler + 2 engines at full load: boiler 0, each engine 1.8 MW. A loaded 2×2 fission block: reactors 0, turbines 2 × their output. The same block unloaded at 1,000 °C: its waste heat at the reactors. A fusion reactor emits only its electric draw, and its generators 2 × their output |
| R2 | Power order (U16; §5.7) | Solar + accumulators + 2 Research halls. By day the accumulators charge before the halls get power. At night discharge serves the normal load first, then the halls. In no tick does an accumulator both charge and discharge |
| R3 | Switch throttle (DECISIONS §26) | A Switch at m = 0.8 lends 0.8 of its effect; its draw is unchanged. A compromised Switch lends nothing |
| R4 | Research hall (L1, DECISIONS §25) | 19 accelerators → "Missing accelerators" with "Loaded: 19 / 20". Mixed tiers give the mean speed and power. Without *Weight transplant* an insertion into a full hall is refused; with it the lowest tier goes to the output. Modules and Switch effects never apply |
| R5 | Staffing (U1–U4, DECISIONS §23) | Demand follows module speed; an idle Seminar's demand falls to 0 within 60 ticks. A Terminal pair joins two universities' networks, and they split at the next recompute after one Terminal loses power. The coverage edge behaves as UI-G4/G5 |
| R6 | Leak (L4) | The largest share is compromised (ties: lowest serial). Removing a building subtracts its share. With no candidate, L holds at 1 |
| R7 | Compromised lifecycle (L3) | Compromised = 1 on the wire while unpowered. Mining is refused with the reason string. Progress is frozen while full power is drawn. 1,799 zero-power ticks and 1 powered tick do not clean; 1,800 consecutive ticks do; a brownout never does |
| R8 | Linear spread (DECISIONS §27) | One infection in a 40-machine Switch block gains exactly one machine per interval. An infection with no powered member gains none. Cleaned members leave. Through agents, the target must be in the source's hub area. One hop (R5-gate D6): with A compromised, A and B in one Switch area and B and C on one data line, C is never the target while B is clean |
| R9 | Rollback (L2) | The input exists only while compromised and after *Rollback recovery*. It accepts a checkpoint at tiers 1–3 and a frontier checkpoint at tier 4, from an enabled inserter. The item is consumed and the machine is clean in the same tick. An Endpoint's recipe checkpoint goes to the rollback input first |
| R10 | Quality (L5) | The output cap follows the lowest Comparator. Catalysts return at their own quality. A recipe at Verified quality refuses Standard ingredients |
| R11 | World text (J6) | *Tabulation* (Hollerith, 1889) adds nothing to W. Literature counts trigger technologies and Y_pub does not. γ scales W_own only |
| R12 | Model collapse (DECISIONS §31) | Archive-only training (c = 0) runs at full speed. Crawl-only (c = 1) runs at × (1 − σ) before *Synthetic detection* and at full speed after |
| R13 | Research scheduling (L6; R5-gate D10) | With *Research productivity* available, the Researchers queue only System-card technologies, in `meta.endgame.takeoff_order`'s order: from closure the completions run MG6, Research scheduling, Two-phase cooling, MG7, Wafer-scale integration … exactly. With *Nuclear power* unresearched, *Fusion power* is passed over and the queue never stalls |
| R14 | Prerequisites (U19) | *Model generation 25* becomes available only after *Model generation* reaches its `max_level` |
| R15 | Heat edges (U10–U12) | Heat sent toward an ungenerated chunk is booked under Map edge, and the out-of-map edge reflects. The Heat tab balances to ΔH. Leaves fall at 600 s accumulated above 45 °C |
| R16 | Productivity (DECISIONS §30) | A Learned controller is refused in a machine whose recipe disallows productivity. *Nanofabrication* applies to the base accelerator only |
| R17 | Manifests (J17) | Every milestone filter passes the closure check against the data (§2.4). Runs in `npm run check` |
| R18 | Closure gate (R5-gate D9) | With *Automated research* researched and 20,000 System cards in Seminars but no hall card, no System-card-only technology is available and none can be queued. The first *Research run* completes the hidden *Loop closed* in the same tick as `loopClosed`; *Model generation 6* and the gated hardware become available; no toast, no research log line, no Peak-research-rate count |
| R19 | Doubling readout (R5-gate D11) | A scripted rate R̄ that doubles every 60 s, dips to 10% for 30 s, then recovers: DT never reads less than the true doubling time during or after the dip, and *Fastest doubling* and the history change only at new maxima of R̄ |
| R20 | *Wild* gaps (R5-gate D13; M5) | A compromised machine with no path out keeps re-arming its escape timer and founds a nest within one interval of gaining a path out. With no agent hub, a nest lands 3 chunks beyond the built area. A laser-damage bonus changes the laser turret's damage and not the arc turret's |
| R21 | Line order (A1 finding 3; §5.3) | A compressed belt of 8 lines built upstream-first, downstream-first and in random order carries the same items per minute with no gap at any line boundary; a belt loop opens at most its one documented gap; results are identical after a save and load |
| R22 | Mixed dead-end lane (A1 finding 4) | A dead-end lane carrying two item types, with an inserter that takes one of them, jams once unwanted items fill the pickup window, as in Factorio |
| R23 | Input fencing (D22) | A player walking with a start-walking action stamped for tick 1,010 in flight is released at tick 1,003: the character stops at 1,003 and the later start is fenced (no movement, an `input_fenced` event) |
| R24 | Targets by identity (D23) | Player A mines an entity and player B builds the same prototype in its place in the same tick; A's queued rotate naming the old serial fails with "target gone" and never rotates B's entity |
| R25 | Creation ids (S5) | Rotate an entity by creation id before its build is confirmed: it rotates the right one; if the build failed, the rotate fails cleanly |
| R26 | Offline characters (§5.1) | A player leaves while walking, mining and hand-crafting: the character stays, stops and keeps its inventory; the hand returns to the inventory if it fits; the queue resumes on return |
| R27 | Per-player order (D21) | A batch whose first seq is not above the player's saved `last_seq` is refused with `ERR_FRAMING` in every build, also right after a save and load (a negative test); the same actions in order apply in send order |
| R28 | Inline commits and pristine chunks (§4.4, §5.18, D12) | A chunk whose worker answer is withheld is generated inline at its commit tick with the same chunk hash; a late answer, or one carrying another world's hash, is ignored; with no pool at all the world hash is unchanged; a burst of requests commits at most 8 chunks per tick, in canonical order. A save and load with pristine chunks around a walking character continues bit-identically (M0), as do pristine chunks next to a heat source (M1) and under an agent's path (M3); loading a save with 30,000 generated chunks regenerates none of them until a rule or the view touches them. A save made under another worldgen version is refused unless baked |
| R29 | Per-player settings (D11) | Two players with different auto-sort settings: each inventory sorts by its owner's setting. A client-only setting (smart belts, even distribution) changes which actions are sent, never how an action executes |

---

## 11. Performance targets

This section is the **single source** of the game's performance targets (J7). 09 §8 points here, and the slice row is M1's acceptance criterion (§12).

**Machines.**
- **Reference** (every budget below unless stated): a 2019–2020 mid-range laptop with 4 cores, an integrated GPU of the Intel UHD 620 class, 8 GB RAM, current Chrome or Firefox, and a 1920×1080 window.
- **Target:** a 2022 or newer machine, for example a laptop with an i5-1240P, Iris Xe graphics and 16 GB. Everything should hold 60 FPS there, and the megabase stretch is measured there.
- **This host** runs at about **0.42×** the reference's single-thread speed at its 2.6 GHz base clock, so host budgets are reference budgets × **2.4** (A1; round 5 assumed 0.55× and × 1.8, which holds only in turbo windows). This is an estimate from A1's measurements and published single-thread scores until `bench.html` confirms it on the user's machine (§10.6). The target machine is about 1.4× the reference.

**Budgets by scale** (reference machine):

| Scale | Typical counts | Sim (ms/tick) | Frame | Sim worker memory | UPS |
|---|---|---|---|---|---|
| **Slice** (M1: the end of 09's tree) | About 3k entities: 2k belt tiles, 4k belt items, 400 inserters, 100 machines, 60 drills, about 24 Seminars; ≤ 2k charted chunks and about 60 generated towns. A stress save at 5k entities must still hold 60 UPS | mean ≤ 1, p99 ≤ 2 | 60 FPS at 1× | ≤ 150 MB | 60 |
| **Mid** (end of Article) | 40k entities, 20k belt tiles, 60k items, 6k inserters, 1.5k machines, 30 trains, 300 combinators | ≤ 5 | 60 FPS at 1×; ≥ 30 at 0.3× | ≤ 400 MB | 60 |
| **Late** (Model card) | 150k entities, 60k belt tiles, 250k belt items, 25k inserters, 6k machines, 5k agents, 100 trains, 2k combinators, 30k explored chunks. A 1–1.5 SPS closure base is 60–90k entities (R3-balance §7), so this leaves room for a 3–5 SPS player | ≤ 12 | 60 FPS at 1×; ≥ 30 at 0.3× | ≤ 1 GB | 60 |
| **Takeoff** | Late + 250–500 Research halls + 2 GW. 04's reference grows from 100 to 245 halls | ≤ 14 | as Late | ≤ 1 GB | 60 |
| **Megabase stretch** (target machine) | 400k entities. A *Hard takeoff* megaproject (1,000+ halls, 5 GW, about 12k more entities; 04 §7) fits here, not in the Takeoff row | ≤ 25 | — | ≤ 2 GB | ≥ 40 |

"Sim worker memory" is the WebAssembly linear memory plus the shell's buffers. Linear memory never shrinks, which is one reason every world gets a fresh worker (§3.1).

**Slice acceptance** (M1's exit; reference machine, the typical slice-end base above):

| Measure | Target |
|---|---|
| Simulation rate | 60 UPS sustained, the 5,000-entity stress save included |
| Simulation time per tick | mean ≤ 1 ms, p99 ≤ 2 ms |
| Frame at zoom 1× | 60 FPS: main thread ≤ 4 ms, GPU ≤ 6 ms (§6.12) |
| UI time per frame, character screen and one entity window open | ≤ 2 ms (§7.3) |
| Chart pan and zoom; the minimap with an overlay | 60 FPS |
| Sim worker memory | ≤ 150 MB |
| GPU memory, everything the game allocates | ≤ 256 MB at High (§6.13); modelled 150 MB at dpr 1 and 164 MB at dpr 2 in BC7 (§9.6) |
| Heat field | < 0.01 ms per tick for 4,096 chunks (§5.9) |
| Staffing recompute (every 60 ticks) | ≤ 50 µs (§5.10) |
| Input to visible response | ≤ 2 frames (I §1.3) |
| First frame of a new slice game | ≤ 8 s cold, ≤ 3 s warm |
| Autosave stall | ≤ 100 ms (the section copy only) |
| A window opens; a Handbook search keystroke | ≤ 100 ms; ≤ 50 ms |
| Save size at the slice's end | ≤ 5 MB |
| Download | ≤ 30 MB in all (expected about 16 MB, 24 MB with every High page; §9.6). By stage (§9.7): first paint ≤ 30 kB; the main menu ≤ 0.5 MB; the first frame of a new game ≤ 5 MB; each later technology group or era ≤ 3 MB, a build gate on the byte inventory |
| Audio | audio thread ≤ 8% of one core averaged over a piece and ≤ 15% in any second, music and SFX together; main-thread audio ≤ 0.5%; decoded samples ≤ 96 MB (§9.4) |

**Every scale:**
- **Loading** a late save ≤ 3 s; `WebAssembly.compileStreaming` of `sim.wasm` ≤ 50 ms (A1: 4.7 ms in Chrome, 8.9 ms in Firefox for a 70 kB study module). Pristine chunks are not regenerated at load (§4.4): at 1–2 ms per chunk, regenerating a late game's 30k explored chunks would take far longer than the budget, so they come back lazily, the characters' surroundings first and at most 8 per tick, and the heat model never needs them (B1-r1 16). The map's images of pristine chunks come from the worldgen pool (§5.19).
- **Autosave stall** ≤ 100 ms (the section copy only).
- **Garbage collection:** the sim tick allocates nothing (§2.5), and neither does the shell's per-tick path; main-thread GC pauses ≤ 2 ms.
- **Input latency** ≤ 2 frames from key to rendered effect in single player (multiplayer: 11 §3.4).
- **Memory:** the whole tab ≤ 1.5 GB in a late game, plus GPU textures (§6.13).
- **Spikes:** a research effect burst costs ≤ 2 ms in its worst tick (§4.7).
- **Audio** (IMPL-6; §9.4): the audio thread ≤ 8% of one core averaged over a piece and ≤ 15% in any second, in every era, music and SFX together; main-thread audio ≤ 0.5% with every scheduler tick ≤ 2 ms; decoded samples ≤ 96 MB. A4's engine measured 41–68% of a host core. With the shipping pack, the FDN reverb, the AudioWorklet voice bank and a 32 kHz engine, whole pieces with SFX measure 13.8–22.4% (5.7–9.3% on the reference): Era I meets the budget, Era II and the takeoff do not yet. §9.4 moves the synthesised voices into the bank, and `bench.html`'s offline-render gate on the user's machine decides M1's exit (Eras I and II) and M4's (the takeoff).
- **Streaming** (§9.7): nothing waits for an asset it does not show, the simulation never waits for one, and each later technology group or era downloads at most 3 MB (checked on the build's byte inventory), prefetched when the connection allows.
- **Asset build** (§9.6): a full rebuild of the art ≤ 3 h on socket 1 of this host (modelled 2.6 h), the slice's ≤ 1 h (modelled 0.8 h); rebuilds are incremental.
- **Catch-up** (multiplayer joins and re-syncs; 11 §4.4): the sim must run at **≥ 3× game speed** with extraction off (≤ 5.5 ms per tick) at Late scale on the reference machine, so that the backlog of a 20-s download and load (1,200 ticks) clears in about 10 s. §4.7's model predicts about 1.8 ms per tick without extraction, i.e. about 9×.

---

## 12. Milestones

**Sizes:**
- Production and test lines (Rust and TypeScript together, generated code excluded) are estimates.
- **One agent-day** is one long Claude Code session producing about 1.5–2.5k lines of reviewed, tested code, or the equivalent asset work.
- The uncertainty is ±50%. Asset work (Blender, SVG, audio) is included and runs at about 20% of each milestone.
- **Version 2 resized the plan** (Changes in v2, row 24). M0 is itemised below and is about three times round 5's estimate: round 5 counted neither the schema and generator, the boundary, the worker shell, nor the multiplayer seams and D18's tests, and A1 already expected Rust to add 20–30%. M1–M4 gain 10%: Rust takes about 1.2× the TypeScript lines for the same logic (A1's two kernels), and features cross the boundary as projections and schema entries (A1-r1).

**Parallel streams.** M0 starts with the *schema* work package alone (§15.11): the scaffold, the schema and generator, the data stage, CI, the fake sim and the golden integration set. Only when its **contract gate** passes (M0 below) do the sim, the shell, the renderer, the UI, the asset pipeline and audio run as parallel agents against the contracts of §15, each first passing the golden set from its side, with the fake sim (§15.10) standing in for the real one until integration. After M0, four streams continue:
1. the sim (Rust);
2. the renderer and assets;
3. the UI and input;
4. worldgen and tooling.

The critical path is sim → UI integration, through projections. With three agents, calendar time is about 45–55% of the agent-days.

| Milestone | Theme | Production / test LOC | Agent-days |
|---|---|---|---|
| **M0** | Foundations (itemised below) | 31k / 12k | 27–36 |
| **M1** | Vertical slice: Memo + Report, peaceful (DECISIONS §15 and §17, 09) | 45k / 22k | 42–53 |
| **M1.5** | Veteran pass (the rest of I's M2) | 4k / 2k | 3–4 |
| **M2** | Article tier: fluids, data, rails, logic | 35k / 17k | 31–40 |
| **M3** | Preprint and Model card: agents, quality, nuclear, containment | 30k / 13k | 25–32 |
| **M4** | System card: takeoff and victory | 13k / 7k | 13–18 |
| **MP** | Multiplayer (chapter 11) | 12k / 8k | 14–18 |
| **M5** | *Wild* preset (military loop) | 20k / 7k | 18–24 |
| **M6** | Scale and polish | 8k / 3k | 8–12 |
| **M7** | Expansion (spec/06) | not estimated | — |

**Order.** M0 → M1 → M1.5 → M2 → M3 → M4 → **MP** → M6, with M5 optional between them and M7 last. Multiplayer comes late, as the user asked, but its seams exist from M0 (11 §7), so MP adds the network, the relay and the multiplayer UI without touching the simulation's structure.

**Totals:**
- The complete base game with *Contained* (M0–M4) is about 158k + 73k lines and **141–183 agent-days**.
- With multiplayer it is about 170k + 81k lines and **155–201 agent-days**.
- With *Wild* and polish as well, about 198k + 91k lines and **181–237 agent-days**.
- Round 4 added about 2 agent-days: the data contract (expression compiler, manifests, tiles, world objects, text data; M0) and the containment rules (rollback input, locks, linear spread; M3).

**Milestone builds are filters** (J17). Each milestone ships the full data filtered by a manifest, checked for closure by the data stage (§2.4); `design/round4/arch-data/manifests.py` runs the same check on the current data. M1's manifest is 09 §2.7's explicit list. The later ones are rules, kept in `game/data/engine/manifests.yaml`:

```yaml
wild_roots: [fire-control, projectile-damage-1, rate-of-fire-1, explosive-yield-1, laser, land-mines,
             rocketry, interceptors, energy-shield, defense-in-depth]   # combat-only roots: M5
manifests:
  m1: {from: "09 §2.7"}                        # explicit slice list; start_recipes == prior-art's unlocks; scenery: [exchange]
  m2:                                          # Article tier: fluids, data, rails, logic
    tiers: [memo, report, article]             # technologies whose packs all lie in these tiers; triggers follow their prerequisites
    exclude_branch: [M]                        # Proceedings and defence
    exclude_with_dependents:                   # systems that belong to M3
      - rejection-sampling                     # quality
      - mobile-automata                        # agents (round 2's mobile-robotics)
      - in-situ-leaching                       # nuclear
      - deep-learning                          # deployment: Endpoint, Ratings, Preprint
      - liquid-cooling                         # coolant loops
  m3:                                          # Preprint and Model card: agents, quality, nuclear, containment
    tiers: [memo, report, article, proceedings, preprint, model-card]
    exclude_with_dependents: [scaling-laws]    # the frontier run belongs to M4
    exclude_wild: true                         # wild_roots and their dependents
  m4: {tiers: all, exclude_wild: true}         # System card: takeoff and victory
  m5: {tiers: all}                             # everything, Wild included
```

- Everything else is derived: recipes, items, entities, and which resources can be extracted. A recipe that needs only a spoil result (Scooped, M4) or Wild loot (M5) is inert until then, not an error.
- On today's data, M2 has about 75 technologies, M3 about 153, M4 about 185 (with the hidden *Loop closed*) and M5 all of them, each closing cleanly. `manifests.py` prints the current counts.
- A technology that changes tier in the data moves milestone with it. That is the point of writing the filters as rules.

### M0 — Foundations (no gameplay)

**Scope** (B1-r1 22). M0 is closures, chests, projections, deterministic saves and worker replacement, with every binding seam: S1–S10, S12, S14 and S15, S11's port and swap, and D1–D23 (IMPL-4, 11 §7). What it supports is exactly its **capability manifest** (§2.4): the character, one chest, worldgen v0's tiles and one resource, one hand-craftable recipe, the actions and projections those need, and M0's scenarios and benchmarks; anything else fails explicitly. It builds M0-sized codecs, registries and adapters first, no migration framework (§8.3), and only the tools M0 uses (`simtool` replay, hash, trace and bench; diff and bisect come in M1).

**Contents**, by work package (§15.11 names the owners; the manager assigns ids):

| Work package | Contents | Production / test LOC | Agent-days |
|---|---|---|---|
| **Schema** (first, alone; the executable contract) | The repository and pinned toolchains (npm and the Cargo workspace), Vite with the cargo plugin, `check-arch`, `clippy.toml`, the WebAssembly feature gate, the `npm run` scripts and the pre-commit `ci`; **the schema** with complete layouts for every M0 record, and **the generator** with readers and writers in both languages (§15.1); **the data stage** on `spec/data`: every kind (tiles, world objects and text included) parsed and validated against its schema, M0's prototypes compiled, the expression compiler with its bytecode and reference interpreter, the closure check for every milestone's manifest, the M0 capability manifest, `prototypes.bin`, `prototypes.json` and `build-manifest.json` (§2.4, §15.2); reviewed codec fixtures; **the fake sim**, `STATS` included; **the M0 golden integration set** with the reference model that produces it (§15.10) | 8k / 3k | 7–9 |
| **Sim** | The crates `det`, `worldgen` v0 (terrain, water, ore spots; no towns) and `sim`: World with `players[]`, surfaces, chunks, the entity table and pools, the scheduler (bitsets, wake sequence numbers, the timer wheel), RNG, digests and the state hash (§4.8), the save container v2 and checkpoints, the action pipeline (preflight and field validation, references, input fencing, the creation ring, system actions), character movement and collision, chests and inventories, hand mining and crafting, inline chunk commits, extraction with its `PresentationState`, the M0 projections (`HUD`, `CHARACTER`, `INVENTORY`, `ENTITY_PANEL`, `HOVER`, `STATS`, `DEBUG`), M0's queries; `simabi`, `genabi` and `simtool` (replay, hash, trace, bench); the `TestSequencer` | 8k / 4k | 6–8 |
| **Shell** | The sim worker: module instantiation (the main thread compiles each module once per page, §3.1) and the schema handshake, `MemoryLease`, the `LocalSequencer` with pacing and clock generations, packets and pooling, subscriptions, the world-replacement protocol (S15) and the worker swap (S11), checkpoint copies, closure logs and replay, trap recovery (§3.6); the worldgen and IO workers; `__game` | 3.5k / 1.5k | 3–4 |
| **Renderer v0** | The batcher, atlases from the manifest (§15.7), the terrain shader, camera and zoom, layers, belt-item expansion from gap arrays, F4/F5 debug overlays; built against the fake sim | 2.5k / 0.5k | 2–3 |
| **UI and input v0** | The Solid shell, Window and Slot, the character screen's skeleton on real projections, the input core (action map, capture layer, resolver skeleton, action encoder); built against the fake sim | 2k / 0.5k | 2 |
| **Asset pipeline v0** | Per §9 (WP B2). **Build:** A3's rig, materials and parts ported to `assets/blender/` with the entity contract (`META`, `build`, `pose`); the layered render (F₀ in full, Normal-resolution shadow, animated layers in R, base pieces); ink on the trimmed box and on R with canvas-coordinate fields, glow, trim; packing per group into 32-px cells with 8-px gutters and levels; XUBC7 and ETC1S encoding with `basisu` 2.50; `sprites.json` version 2 with explicit index tables, and its fixtures (§15.7); the byte inventory gate (§9.7); greybox sets for every entity; the projection calibration test; contact sheets, the composite, cell and compression checks (§9.5); `npm run assets`, incremental by content hash. **Run time** (`src/assets/`): the asset worker with the Basis transcoder, the per-format probe and fallback chains, the resolution modes and their allocation, groups, priorities and retries, residency and the level-0 clamp, context-loss recovery (§6.13, §9.7); the build's `.br`/`.gz` siblings. Exit: the keypunch, a belt and an inserter rendered through the whole chain and drawn by the renderer at dpr 1 and 2, passing the manifest fixtures | 2.5k / 0.6k | 2–3 |
| **Audio v0** | Per A4 and §9.4 (WP B2): the engine ported to TypeScript at 32 kHz; the voice-bank and FDN AudioWorklets; the mixer and I §4.20's buses; the conductor with the Era I rule set; the SFX system (the event-to-sound map with generated sound ids, variants, rate and voice limits, attenuation, working sounds from `AUDIO_WORKING`, historical silence); start-up under user activation, resume on return, and reduced audio when a worklet fails; one decode path with the canonical loop timeline, the Opus probe and AAC fallback; the CPU benchmark page with the offline-render method. Exit: Era I and the prototype SFX inside §9.4's budget on this host (host ≤ 19%), and the failure paths tested with the worklet blocked and autoplay refused | 2.8k / 0.7k | 3–4 |
| **Integration and QA** | The test harness (the scenario DSL, the rule-scenario folder (§10.8), D18's suites, the trace page, the Playwright config, golden helpers), the benchmark runners and `bench.html`, the dev-server endpoints, the exit review | 1.5k / 1k | 2–3 |
| **Total** | | **31k / 12k** | **27–36** (about 16–20 calendar days: the schema package alone, then the others in parallel, then integration) |

**The contract gate** (B1-r1 1, 21; the coordinator). The schema package is the executable contract, and **no other M0 package starts before its acceptance gate passes**. The gate (§15.11 lists its parts) is:
1. **The machine-readable schema**, with complete layouts for every M0 record: every M0 action and system action, event, projection kind and query kind, the packet header and every M0 section, the save sections of M0's state, `new_world`, `sim_meta`, load reports, every export of `abi.yaml` with its input and output records (§15.8), `ChunkData`, the `prototypes.bin` tables of M0's kinds and the schema of `prototypes.json`, with every numeric registry (enum values, section ids, kinds) and namespace table (prototype names, the icon table, the locale keys of `FailReason` and `FlyingText`).
2. **Generated code in both languages**, compiling, with readers and writers for every record.
3. **Codec fixtures** in both directions, generated and hand-written (§15.1), reviewed independently (a second agent or codex) before the gate closes.
4. **The fake sim**, `STATS` included (§15.10).
5. **The M0 capability manifest** (§2.4), with the explicit errors for everything outside it.
6. **The frozen M0 golden integration set** (§15.10): the M0 prototype set, a start save, a closure log, the expected states and per-tick digests, the expected record of every M0 projection, a tiny compatible atlas with the sprite-manifest fixtures and cases of §15.7, and negative cases.

Once the gate passes, each parallel package's first deliverable is to pass the golden set from its side: the sim reproduces its states and digests natively and in WebAssembly, the shell replays its log, the renderer draws its packets with its atlas, and the UI shows its projections. A change to the gated contract reopens the gate for the packages it touches.

**Mandatory multiplayer seams in M0** (11 §7): S1–S10, S12, S14 and S15, S11's port and swap, D1–D23 with D18's tests (a)–(e), (f) natively and (g) for the codecs, and rule scenarios R23–R29.

**Exit:**
- A placeholder character walks on generated terrain at 60 UPS, driven by closures from the `LocalSequencer`, in Chrome, and in Firefox with `?render=none`.
- Chests can be placed, filled and mined through actions in native scenario tests, in Node through the shell, and through the real input layer in Playwright.
- The chest's `INVENTORY` and the character's `STATS` (hand-mined and crafted items) come from real projections (IMPL-1 rule 5).
- The golden integration set passes in every package (the contract gate above).
- Save, load and the state hash match natively and in the browser. Join equivalence, NO_SLEEP equivalence, heavy mode and replay (D18 a, b, c, e) pass on every M0 scenario, with per-tick canonical comparison in short runs; the cross-engine trace (D18 d) is identical natively, in Node, Chrome and Firefox on a 10,000-tick log and the golden set; R23–R29's M0 cases pass (§10.8); the M0 benchmarks meet their thresholds (§10.6).
- Every action, projection and query outside the capability manifest fails with its explicit error.
- World replacement works through a fresh worker for a new game, a load and trap recovery: a dev-only panic shows the trap notice, reloads the last autosave and leaves a bundle that reproduces the panic natively.
- The schema handshake refuses a stale module; `schema-gen --check` is clean; the release modules pass the feature gate.
- Every manifest passes the closure check (R17).
- The asset pipeline and audio packages meet the exits in their rows: the keypunch, a belt and an inserter through the whole asset chain, drawn at dpr 1 and 2, with the manifest fixtures passing; Era I and the prototype SFX within §9.4's budget, and the audio failure paths tested.
- The smoke screenshot has been reviewed.
- `npm run ci` is green under M0's capability manifest (§2.4).

**Risks:**
- The boundary's first version: the schema's shape will move while the first systems arrive. Mitigation: the schema package lands first and alone, its gate freezes M0's contract with executable fixtures, and the generator's `--check` makes every later change explicit.
- The gate serialises the start of M0. Mitigation: the schema package stays M0-sized (no full-game registries, no migrations, B1-r1 22), and the fake sim and golden set let every other package start at full speed once it passes.
- TS 7 checker gaps (fallback 6.0.3).
- The SwiftShader speed (measured, mitigated by on-demand rendering).
- Release builds of about a minute: `ci` uses them only for the feature gate; the loop uses `wasmdev` (§2.3).

### M1 — Vertical slice: Memo + Report, peaceful

**The scope is 09's:**
- the technologies, items and buildings of 09 §2.7's `slice` manifest, built as a *filter* over the full data (§2.4); the counts are 09's;
- systems as in 09 §3; UI as in 09 §6 (I's M0 and M1, the veteran tools of DECISIONS §17, statistics, the Handbook and the read-only chart);
- build order S0–S10 (09 §10).

The three phases below group those steps for sizing: M1a ≈ S0 and S2's hand, M1b ≈ S1 to S9, M1c ≈ S10 plus art.

**M1a — Logistics core:**
- the character, collision, reach;
- inventory, hand, quickbar, crafting queue with chain crafting;
- build, mine, rotate; pipette;
- **the veteran tools of DECISIONS §17:** smart belt dragging (R-bend, auto-undergrounds, "Too far to connect"), fast-replace for all groups, copy and paste of entity settings with sweep, undo/redo (I §3.4, §3.10, §3.11). The sim-side undo stack and ghosts-as-undo come with them; I's F1–F3, F7, F13, F16, F17 and F24 are slice tests (09 §7.2);
- belts in the slice's tiers, undergrounds, splitters, side-loading;
- inserters (burner, basic, long-handed, fast);
- burner and electric drills, stone furnace, Keypunch, chests, burner energy, ground items;
- rendering of belts, items, inserter arms and machine animations;
- the character screen and transfers (I M1.1–1.3).

**M1b — Power, machines, research, world:**
- electric networks and poles, with the demand classes of §5.7;
- the offshore pump, boiler, steam engine, pipes and pipe-to-ground (fluid segments, water and steam from the data's ratios), with DECISIONS §24's emission at the engines;
- solar panels with 01 §3's sunlight factor, the day cycle, lamps and radar (09 §3);
- assemblers 1–2;
- Seminars, research, triggers, the technology screen, multi-level prerequisites;
- **tiles and world objects** from the data; **towns** (the college town, university, archive, streets and buildings), the **Laboratory salvage**, the starting-area guarantees of 01 §9 and DECISIONS §32; **staffing** (§5.10) and its overlay;
- the **thermal field** (§5.9: Map edge, reflection, leaf timers), its overlay and the *Heat* statistics tab;
- the world text's slice part: W (W_own, W_pub, Y_pub), Literature from `regime: cited` technologies, Field and years ahead (§5.11);
- entity GUIs, tooltips, alt-mode, status LEDs and warning icons, the **status-light layer**;
- the read-only map view with the slice's overlays: electric network, heat, staffing, resources (I §4.11 P0, 07-ui §3);
- the World strip and window, the charter screen, milestone log lines (07-ui §4, §14, §15);
- toasts, the Handbook (Factoriopedia), production statistics with the Papers item and the Heat tab;
- the **rate calculator** (Alt+X) and **trimmed collision** (DECISIONS §17, 07-ui §16);
- saves, autosave, the main menu, settings and the Controls screen;
- `simtool diff` and `bisect`, and the migration framework with the first format change that needs it (§8.3, B1-r1 22).

**M1c — Slice content, art and audio:**
- the slice's art through the layered pipeline (§9.1): the 32 entities and their greyboxes, the town and salvage world objects, town skins 1 and 2, trees, rocks, resources and the character. That is about 750 sprite sets and 1,500 animated-layer frames, about 0.8 h of rendering on this host (target ≤ 1 h) and 13 colour pages (§9.6);
- the icons of the slice's 57 items, in the GPU array and as DOM sheets, and its 23 technology icons (§9.3);
- about 30 SFX in about 90 files, and the music engine's Era I and Era II rule sets on the voice bank (with the synthesised voices, the tape echo and the hiss moved into it) and the FDN reverb, the offline-rendered menu loop, the recorded pieces for reduced audio, and the AAC pack (A4, IMPL-6; §9.4). The audio page of `bench.html` must pass §9.4's offline-render gate on the user's laptop for Eras I and II before M1 exits;
- streaming: `core` and the slice's technology groups within the byte-inventory gate, the stage budgets of §9.7 checked under network throttling, a join and a load with no prefetch lead time, and play without a service worker;
- night lighting: the cyanotype and the light pass (§9.8);
- golden tuning;
- **playtests with the user** through the tunnel, and `bench.html` on their laptop.

**Exit** (09 §0, §7; §11):
- Every technology of the slice manifest is researchable, ending in the end-state line.
- The scripted opening meets 09 §7.1's milestone times.
- The F-tests of 09 §7.2 pass, and S-G1–S-G19 pass. That includes Firefox hashes and capture via `?render=none`, and the throttle path on the dev entity.
- §11's slice acceptance table holds on the reference machine.
- G1–G12 and G14–G16 pass (G13 needs M2's full fluids; G16's module case waits for M2's modules), and so do the rule scenarios of §10.8 that the slice can run: R1's boiler case, R5 without Terminals or modules, R11, R14 (on a test prototype: no slice technology is multi-level), R15, R17, R21, R22, R28's heat case and R29's smart-belt case.
- The M1 capability manifest is green, and the M1 benchmarks (`slice-3h`, `worldgen-frontier`) meet their thresholds (§10.6).
- The user's Factorio-comparison playtest is within 09's 10% / 15%.

**Risks:**
- Belt and inserter timing fidelity (G5–G6 golden calibration).
- UI breadth.
- Art throughput and consistency (contact-sheet reviews, the user's taste).
- Smart-belt edge cases (F1–F3 are the guard), now inside the slice.

### M1.5 — Veteran pass (the rest of I's M2)

DECISIONS §17 moved smart belts, fast-replace, copy/paste of settings and undo into M1. What remains:

**Contents:**
- ghost building filled by hand (Shift+LMB), beyond the ghosts that undo creates;
- full remote view (remote GUIs, ghost cursor, mine = deconstruction mark), pins, tags, map search;
- quickbar pages, the copper-wire tool, browse history, number fields with math;
- the chest limit bar, the splitter GUI, electric network graphs;
- *Even distribution* (setting; 07-ui puts it after the slice).

**Exit:** I's F1–F28 all pass.

**Risk:** remote-view breadth (F25, F26).

### M2 — Article tier: fluids, data, rails, logic

**Contents** (the `m2` manifest):
- Full fluids 2.0: pumps, tanks, extents, temperatures.
- **Data lines** (category `data`), barrels and drives, data networks.
- Coal chemistry (the chemical plant), batteries, explosives.
- **Exchanges and crawlers** (an infinite resource with decay), the data refinery and data plant (with `amounts_by_j`), the electric furnace and Tokenizer, W, j and σ readouts.
- The Trainer, checkpoints and catalyst recipes; the experiment loop (Experiment, Analysis, Meta-analysis).
- Modules of levels 1–2, with `allow_productivity`; cooling towers; accumulators and the full allocation of §5.7; *Dennard scaling* 1–2.
- **Terminals** (*Time-sharing*) and *Web search*'s commuting radius (§5.10).
- Bulk inserters and the batch-size research.
- Cliff explosives are not here: they need *Terminal ballistics* (Branch M), so they arrive with M3. Concrete, landfill and cliffs are already in the slice.
- Fog snapshots (radar itself is in the slice).
- **Trains:** 2.0 rail geometry, the rail planner, signals, chain signals, stops, schedules, **interrupts**, train limits, fluid and data wagons, the train GUI.
- The car.
- **The circuit network** (wires, the four units, display panel, speaker, power switch, core control behaviours).
- **Blueprints**, books, the library, deconstruction and upgrade planners, copy/cut/paste (I's M3 list).
- Alerts, inventory filters, the bonuses GUI.
- Optional: Factorio blueprint import.

**Exit:**
- An Article-tier base runs at 60 UPS at the Mid scale.
- G13 and G19 pass, and so do R2 (on a dev entity of the interruptible class, as S-G10 tests the throttle), R5 (with Terminals and modules) and R16's controller case (its *Nanofabrication* case runs in M4).
- A user playtest.

**Risks:**
- The 2.0 rail geometry and rail planner (the largest single piece).
- Fluid sharing feel.
- The breadth of circuit control behaviours.

### M3 — Preprint and Model card: agents, quality, nuclear, containment

**Contents** (the `m3` manifest):
- **Agents:** hubs, construction and logistic agents, logistic chests, dispatch, charging, item requests, the personal roboport and equipment grid, the logistics panel and groups.
- **Quality** (§5.16) and the Verifier.
- Nuclear: reactors (waste heat included), heat pipes, exchangers, turbines, the centrifuge, Kovarex.
- Liquid cooling (coolant with its temperature filters, dry cooler, water exchanger), *Dennard scaling* 3–5 and immersion cooling.
- **Switches** (1/√n, their own thermal class and throttle; DECISIONS §26) and modules of level 3.
- **Deployment and *Contained* runaways:** Endpoints and Ratings, σ and model collapse, the leak L, compromise and its locks, linear spread, Monitors and Evaluation sets, the rollback input, the Proceedings branch's containment technologies.
- Express belts, assembler 3, the half-track.
- The full circuit coverage.
- Texture compression (KTX2).

**Exit:**
- The Late scale runs at 60 UPS on the laptop.
- G18 and G20 pass, and so do R1's nuclear cases, R3, R6–R8, R9 at tiers 1–3, R10 and R12.
- Containment scenarios are deterministic.
- A user playtest.

**Risks:**
- Agent performance at 5k+.
- Quality combinatorics in the UI.
- Coolant and thermal interplay tuning.

### M4 — System card: takeoff and victory

**Contents** (the `m4` manifest):
- The **frontier cluster**, run shards, the payload and the empty launch.
- **Researchers** in staff slots; Research halls with their inventories and loading rules (§5.5); the **interruptible load** class in use.
- **Generations** with retroactive Π and multiple completions per tick; ***Research scheduling*** in `meta.endgame.takeoff_order`'s order (R5-gate D10); the hidden *Loop closed* and its craft-recipe trigger, which gate the takeoff behind closure (D9); *Weight transplant*.
- **Hollow work** (03 §4): only Researcher-staffed Seminars do it, and Researchers arrive here.
- Fusion, *Sparse inference*, *Reversible logic*, *Energy per operation*.
- The Constructor and the Area scanner (§5.2).
- **The run report**, the achievements (08-text §6, held in `text.yaml`; those reachable earlier ship with their milestones) and their window (07-ui §13.7; R5-gate D12i), the doubling-time readout with its running maximum (D11).
- **Race mode** and *Scooped* (§14).
- Infinite technologies, with effects coalesced per tick.
- A balance pass against G's targets.

**Exit:**
- G17 passes, and so do R1's fusion case, R4, R9's tier-4 case, R13, R16's *Nanofabrication* case, R18 and R19.
- A scripted full takeoff from a closure save reaches the capstone within 5% of 04 §0's 50.0-min reference (G17).
- The user plays a takeoff; that playtest records the time from the first frontier run to closure, which decides the plateau knob by 04 §1's pre-registered trigger (more than 2 h: four runs).

**Risks:**
- Balance of the spatial thermal field against G's aggregate model (G §4.8).
- The spectacle rendering of the final 40 s.

### MP — Multiplayer

After M4 and before M6's polish (the user's wish: multiplayer comes late). Chapter 11 is the design; the seams it needs are already in the engine from M0, so this milestone adds the network, the relay and the multiplayer UI.

**Contents:**
- **The relay** (11 §6): `RoomCore` (pure TypeScript: the clock and its generations, acceptance with per-player order, deduplication and watermarks, system actions and grace timers, digest votes with epochs, snapshot coordination and transactions, held-input release), the Node adapter with `ws` 8.22.0, write-before-broadcast persistence with room generations, rooms, invites and tokens, limits, metrics and admin endpoints; deployment behind Caddy on a small VPS (11 §6.7).
- **The client** (11 §2–§5): the net worker with both sockets, reconnects and resume, the `RelaySequencer` with client stamping, margin and playout controllers; joins (donor checkpoints with manifests, paced uploads with a tuned LEDBAT, catch-up); desync detection, votes and the background re-sync through a shadow worker with its convergence check and foreground fallback; desync bundles and `simtool bisect` on them.
- **The latency state** (11 §3.5), in the sim crate: the predicted character, placements and hand, rebuilt each confirmed tick from the confirmed world and pending actions, reconciled through `(player, seq)`.
- **The UI** (11 §8): the Multiplayer menu, hosting and joining, the Players window, chat and console commands, pings, other players' characters and selections, connection indicators, per-player text; the strings come from 08 once 11 §8.4's proposals are adopted.
- **Tests** (11 §9): the in-process multi-client harness with a deterministic simulated network, the relay's unit tests and wire probes, real-browser sessions through an impairment proxy, the real-engine resource tests on 2-, 4- and 8-core machines, fuzzing, a soak and a load test.

**Exit:** 11 §9's "Green before multiplayer ships" list, in full, and a user playtest with colleagues.

**Risks:** 11 §10, chiefly repairs that do not converge on machines with few cores, slow donor uplinks, and background-tab suspension in browsers we cannot test here.

### M5 — *Wild* preset (optional)

**Contents:** the `wild_roots` technologies and everything that depends on them (the manifest's rule): units, spawners, hierarchical pathfinding, groups and expansion, damage and resistances, turrets, artillery, interceptors, unit art. Fences, gates and the containment side of Branch M ship in M3, and repair packs (*Maintenance*) in M2.

**Exit:** Factorio-like attack and expansion behaviour; 1,000 units in ≤ 2 ms per tick; R20.

**Risks:** pathfinding cost, and the art volume.

### M6 — Scale and polish

**Contents:**
- megabase profiling (static chunk vertex buffers; hot systems profiled natively and in the browsers);
- save size;
- a main-menu background simulation;
- tips and tricks with simulations;
- colour-blind LUTs;
- complete settings;
- a Firefox/Safari pass.

### M7 — Expansion

Per 06:
- surfaces (already in the core);
- the launch site and Space Age-style platforms;
- the Stacks via a shaft lift (inter-surface cargo);
- the Biology line on the continent (06 §1 #3);
- Mercury, the cold moon, and interstellar seeds that build only through the Constructor, with no remote view.

**The thermal model becomes per surface,** behind one interface:
- the continent and the Stacks keep the chunk field (§5.9);
- a platform has one heat pool with radiators, `P = ε·σ·A·(T⁴ − T_bg⁴)`, which is polynomial, so no transcendental functions are needed (§4.1);
- the cold moon uses heat as an input: an Aquilo-style freezing rule driven by the heat-pipe network.

Not estimated until 06 goes beyond an outline.

---

## 13. Risks (cross-cutting)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Scope: about 198k lines of Rust and TypeScript plus assets | High | High | Data-driven systems, milestone exits, parallel agents on fixed contracts (§15) behind M0's contract gate (§12), ruthless deferral (*Wild*, expansion) |
| **The two-language boundary**: generated layouts, features that cross both languages, the schema's shape moving while systems arrive (A1-r1) | High | Medium | One schema for every contract (§15.1) with `--check`, a runtime hash handshake and cross-language fixtures; bulk projections instead of per-entity calls; the schema package lands first; the fake sim lets UI and renderer start early |
| Feel fidelity (belts, inserters, drag-building) | Medium | High | Wiki goldens G1–G7, R21–R22, I's F-tests, early user playtests in M1 |
| UI breadth (about 25 screens) | High | Medium | Generic kinds, data-generated grids and tooltips, generated projection decoders, screenshot goldens |
| Art quality and consistency from procedural Blender scripts | Medium | High | Parts library, style checks, contact sheets, greybox-first, user review per batch (A3's *Survey* rules) |
| **Young formats and audio over budget** (B2): XUBC7 is two months old, and BC7 coverage outside desktop Chrome and Firefox is expected, not measured. Era II (9.3% of a reference core) and the takeoff (8.2%) exceed the audio budget, whose reference factor is extrapolated from this host. The 32 kHz engine awaits the user's A/B | Medium | Medium | Encoder and transcoder pinned together; per-format probes with measured ASTC, BC3, ETC2 and RGBA8 fallbacks (§9.2); UASTC with RDO, measured there, as plan B (B2); `bench.html` logs the probes and measures audio by offline render speed on the user's machine (§10.6). Synth voices and the tape echo move into the bank, then voice caps and pre-rendered layers; machines that still fail get reduced audio with recorded music (§9.4) |
| **Logic-level desyncs and replay breaks**: order, unsaved state, impure caches, in any language (A2's dominant class) | High during development | High | D1–D23 from M0; join, NO_SLEEP and replay equivalence and heavy mode on full state; cross-engine traces; digests and bug bundles turn the rest into reproducible reports |
| **WebAssembly debugging and traps**: weak in-browser source debugging; a panic poisons the instance (A1) | Medium | Medium | Develop and test natively; the panic hook forwards message, file and line; trap recovery from the autosave with a bundle that reproduces natively (§3.6); checked indexing kept in release |
| **Two toolchains and build time**: cargo and npm, about 67 s per release WebAssembly build | Medium | Low | `wasmdev` builds of about 3 s for the loop; native tests first; release builds only in `ci` and nightly; pinned toolchains (§2.1) |
| Determinism in browsers this host cannot test (Safari's JavaScriptCore) | Low | Medium | WebAssembly's semantics leave no float freedom once NaN, SIMD and transcendentals are excluded; the user's `bench.html` runs a trace check on their browsers |
| Late-game performance | Low | High | Measured headroom (§4.7: about 2 ms of 12 at Late), sleeping, cadences, budget gates in `ci` and paired A/B benchmarks |
| Multiplayer-specific risks (non-converging repairs, slow uplinks, background throttling) | Medium | Medium | Chapter 11 §10 |
| SwiftShader slowness limits visual testing | Certain | Low | Expanded quads, on-demand rendering, small viewports, the user's `/shot` |
| Hosting a build as a claude.ai Artifact needs a content security policy that allows WebAssembly compilation (wasm-unsafe-eval); unverified | Medium | Low | The dev server through the tunnel and ordinary static hosting are unaffected; check the Artifact's policy before relying on it (§1) |
| Browser constraints (key capture, storage eviction, memory that never shrinks) | Medium | Medium | Capture self-test, `storage.persist()`, export, a memory budget, a fresh worker per world |
| Design churn from rounds 3–5 | High | Medium | YAML-first, generated ids, bytecode expressions without Rust rebuilds, rule-based tests rather than name-based ones |
| Parallel agents colliding | Medium | Medium | Layer boundaries enforced by `check-arch` and the crate graph; generated code owned by the generator; one owner per directory per milestone |
| Rules invented at implementation time | Medium | High | Every open case the design left is stated here with a rule scenario (§10.8); the data stage refuses prose where the engine reads (§2.4); the owning chapters carry the same sentences |

---

## 14. Objections and flags (per the DECISIONS rule: implement as decided, object here)

1. **Resolved: the veteran tools are in the slice** (DECISIONS §17). Smart belt dragging, fast-replace, copy/paste of entity settings and undo/redo are in M1, together with the rate calculator, status lights, trimmed collision and the milestone log; 09 §6 and §7.2 now agree. M1.5 keeps ghosts, remote view and the smaller I M2 items (§12).
2. **Resolved: boiler data** (J3). The data carries 2.0's water per steam (`extra.water_per_s`: 6 for the boiler, 10.309 for the heat exchanger) and the fluids' heat capacity, and the round-1 boiling pseudo-recipe is gone. The engine reads the ratio from the data (§5.8).
3. **Resolved: interruptible compute and accumulator charging** (U16). The order is normal → accumulator charging → interruptible, with discharge serving normal first and then interruptible, and never charge and discharge in one tick (§5.7). 04 §3.1 states the same rule. A Researcher-staffed Seminar uses min(sat_normal, u_p) (§5.5).
4. **Spoilage for *Scooped* (cost note, 03 §5).** 03 adopts Space Age spoilage for exactly one item (`significant-result` → `baseline` after 54,000 ticks).
   - The engine stores spoil ticks only for spoilable item types: a side table keyed by inventory slot, and a parallel `u32` spoil-tick array allocated only for transport lines that have carried a spoilable item.
   - About 2–3k lines in M4, with zero cost when *Scooped* is off.
   - No objection beyond the cost.
5. ***Wild* preset.** About 18k lines plus unit art and pathfinding. The plan ships version 1.0 with *Off* and *Contained* (DECISIONS' default) and *Wild* as M5. The user should know the price before choosing.
6. **Fog in the slice.** The slice renders live state under a fog tint. ISO frozen snapshots arrive in M2 (radar itself ships in the slice). Nothing hides in a peaceful slice, so this is invisible.
7. **Items carry no provenance** (resolves the round-2 flag on *The curse of recursion*).
   - The coordinator's note on DECISIONS §31's accuracy refinement suggests tracking the provenance of training text per Trainer input or per carrier. The engine does not: that would put metadata on every data item, belt slot and fluid box, break stacking, and cost memory on every belt.
   - Instead, 03 §2.2's rule is global and exact for what it measures. The crawl share c comes from the Site's own production windows (§5.11): an archive-only Site has c = 0 and pays nothing, and a crawl-only Site has c = 1.
   - 08 §6 #12 reads the same quantity (the Trainer slowdown σ·c), as a machine-readable condition in `text.yaml`.
   - A Site that mixes both sources pays the Site-wide average on every text-trained recipe. That is the documented approximation, and a legible one.
8. **Pseudo-recipes.** The engine relies on `pseudo: true` to keep the frontier-run launches (the empty launch included) out of crafting. The data should keep the flag on every pseudo-recipe.
9. **Proposal: Factorio blueprint import** (M2, about 1 agent-day). Possible because every entity and recipe has `mirrors`. It brings a veteran's own designs into the game, using user data only and no Factorio assets. For the user to accept or drop.
10. **Town era skins (cost note, 01 §5.3).** 01 sets five skins by W, across five town classes plus the exchange building's three looks. That is the largest art set of the base game after the machines.
    - Plan: a parts kit of roofs, façades, signage and antennas per era, assembled procedurally per building in Blender.
    - 09 ships the slice with the first two skins (09 §9); the rest come with the later milestones' art.
11. **Resolved: closure and Research halls.** DECISIONS amendment 16 fixes closure as the first System card written by a Research hall, and 04 keeps both shapes: Research halls write cards, and Researchers staff Seminars. The engine has both (§5.5), with closure as a one-shot sim event.
12. **Naming in code.** The pollution analogue is `thermal` and nuclear heat is `heatNet`, so the code never confuses them. The UI's words are 07 and 08's.
13. **Linear spread needs a per-infection timer** (DECISIONS §27). "Each compromised machine infects at most one new target per spread interval" is linear only if the timer belongs to the infection: with one timer per machine, a dense cluster still doubles every interval. §5.17 therefore keeps one timer per infection, as 03 §3.3 now states. Each machine still infects at most one target per interval.
14. **Resolved: the leak's "working" is a fraction** (L4, U27). L4 accrued every 60 ticks for buildings whose progress "advanced this tick". Sampling one tick in sixty would make the leak depend on where a craft cycle happens to stand. §5.17 uses wᵢ, the fraction of the last 60 ticks with progress: the same shape as staffing's working share (U1), which is measured on readiness (job, papers, power) rather than on progress, so the two differ, for instance for a Researcher Seminar at u_p = 0; equally deterministic, with the same mean. 03 §3.2 now states it.
15. **Round-1 document I remains normative for M1** (J8). Controls, GUIs, the feel tests and the `InputAction` list are I §1–§8's, and this document implements them by reference (§3.2, §5.1–§5.2, §7.5). 09's M1 reading list makes the cited sections normative. Any later change to I needs a spec round, like a change to the data. D §12's legibility rules now live in 07-ui §23, and F's heat script in `tools/ref/`.
16. **Belt loops** (B1; §5.3). Downstream-first update order is undefined on a cycle. The engine breaks each cycle at its lowest-identity unranked line, so compressed flow may open a one-tick gap at that one boundary per cycle. Factorio's behaviour in this corner is not documented; R21 pins ours, and a playtest that notices a difference reopens it.
17. **Offline characters' crafting queues** (B1; §5.1). A2 says only that offline characters neither walk, mine nor craft. The engine pauses the queue with its reservations and resumes it on return, rather than cancelling it with refunds; Factorio, whose characters persist on a server, gives no direct precedent. 11 §11 lists the related open question of new players' starting items.

---

## 15. The M0 contracts

M0's work packages (§15.11) build against these interfaces in parallel, without talking to each other. They are binding. A change goes through the schema (§15.1) and a note in the changing work package's report; a change that breaks another package's build needs the manager. All binary formats are **little-endian**. "Packed" means no padding unless a field is written out. Widths are in bytes unless stated.

### 15.1 The schema and its generator

**One schema** in `game/schema/` describes every value that crosses the boundary between Rust and TypeScript, every saved field and every wire record (IMPL-1 rule 2). `scripts/schema-gen.ts` (Node) reads it, validates it with zod, and writes Rust into the crate `crates/schema/` (everything more than one crate uses: ids, enums, shared records such as `ChunkData`, codecs, record writers and the `Protos` loader) and into `crates/sim/src/gen/` (the pools and save sections, which only the sim uses, so that the sim can implement behaviour on them), and TypeScript into `src/shared/gen/`. In both languages it generates readers **and** writers for every record, so tests and the fake sim (§15.10) can produce what the other side consumes.

| File | Declares | Generates |
|---|---|---|
| `types.yaml` | Scalars, id newtypes (`Serial: u32`, `ItemKey: u16`, `RecipeId: u16` …), enums with explicit values (`Direction`, `Status`, `InventoryType` …), flag sets with explicit bits, small fixed records (`EntityRef`, `TilePos2`, `FinePos`) | Rust newtypes and `#[repr(u8/u16)]` enums with checked conversions; TypeScript `const` objects, numeric types and reader and writer functions |
| `state.yaml` | The entity table, every pool, the singleton records (`globals`, `player`, …), cold record types, chunk records | Rust SoA structs with lowest-free-slot allocation, defaults, save, load and hash per section, the per-entity slice hash (§4.8) and the NaN scans (D6); TypeScript read-only views for the sim worker (§3.6) |
| `sections.yaml` | Save sections: id, name, version, codec, hashed or not, content, and the digest shard rule (§4.8) | Rust section writers and readers and the shard map; TypeScript section ids, names and writers for the IO worker, tools and the golden set |
| `actions.yaml` | Action types: stable id, name, fields, flags (`held`, `system`, `blob`) | The Rust decoder (a typed enum, preflight and field validation, §15.3) and encoder (tests); the TypeScript encoder and the same validation |
| `events.yaml` | Event types and payloads (§15.6) | Rust writers; TypeScript decoders and writers |
| `projections.yaml` | Subscription kinds, their parameters, record layouts and cadence; query kinds and results (§15.5) | Rust record writers; TypeScript decoders, writers and parameter encoders |
| `packet.yaml` | The packet header, section types and record layouts (§15.4) | Rust writers; TypeScript decoders, writers and layout constants |
| `protos.yaml` | The prototype tables the sim reads, per kind, with the data-stage source path of each field and each formula's result range; the layout of `prototypes.json` (§15.2) | The TypeScript writers the data stage uses; the Rust loader (`Protos`); the `prototypes.json` types and validator |
| `abi.yaml` | Every module export: signature, input record, result envelope, errors (§15.8) | Rust export signatures; the shell's typed wrappers |
| `registries.yaml` | Effect types, trigger types, achievement condition types, formula references, well-known names | Rust enums matched exhaustively; TypeScript lists for the data stage's checks (§2.4) |

**Field attributes.** Every field in `state.yaml` must state:
- `type` (required): a scalar (`u8 u16 u32 u64 i8 i16 i32 i64 f32 f64 bool`), a declared type, a fixed array `[T; N]`, or, in records only, `list<T>` (a `u32` count, then the items), `str` (a `u16` length, then UTF-8) or `bytes` (a `u32` length, then bytes). Every `list`, `str` and `bytes` declares `max`.
- `saved` (required, D20): `true`; or `false` together with either `derived: <rebuild function>`, which names the hand-written Rust function that rebuilds it on load, or `presentation: true`, for values that systems write and only extraction reads (never saved, hashed or read by a rule).
- `order` (required for every list-valued or keyed field, D3, D20): the canonical key (`serial`, `key`, `slot`, or `saved`, meaning that the stored order is itself state); `set` for an unordered saved collection, which is written sorted by its items' encoded bytes; or `none`, allowed only on fields that are not saved (§8.1).
- `id` for every field of a record (not a pool column): a `u16`, stable and never reused, because saves store records by field id (§8.1, §8.3).
- `default` (when not zero), `unit` (documentation and debug formatting: `J`, `tick`, `pos256` …), `wraps: true` for counters that wrap (D7), `since: <schema version>` for fields added after the first save format (the loader fills the default, §8.3), `view: true` to export it to the TypeScript views, and `digest: tick` for the global fields that enter the per-tick digest (§4.8).

**Versions.** `schema/types.yaml` carries `schema_version` (`u16`), which the author raises with every change that alters a save section's layout; `since` refers to it, and every save records it per section (§8.1). `ACTION_SCHEMA_VERSION` (`u8`, `actions.yaml`) and `PACKET_VERSION` (`u16`, `packet.yaml`) version the wire formats separately. The schema hash (below) identifies the whole schema.

The generator refuses a field without the required attributes, a duplicate or reused id, and a change to an existing id's layout without a version bump.

**Fields are ordered lists** (B1-r1 3). Every `fields:` is a YAML sequence of single-key mappings, so declaration order is explicit and survives any YAML tool; the generator refuses a mapping where order matters.

**Example** (excerpts; the real files grow with every system):

```yaml
# schema/state.yaml
pools:
  crafting:
    doc: "Crafting machines, furnaces, labs and drills (§5.5)"
    fields:
      - entity:     { type: EntityHandle, saved: true }
      - recipe:     { type: RecipeId, saved: true, default: 0xFFFF }
      - progress:   { type: f64, saved: true, unit: craft }
      - prod_bar:   { type: f64, saved: true }
      - speed_eff:  { type: f32, saved: false, derived: crafting::recompute_speed_eff }
      - energy_buf: { type: f64, saved: true, unit: J }
      - status:     { type: Status, saved: true, view: true }
      - crafts:     { type: u32, saved: true, wraps: true }
      - anim:       { type: f32, saved: false, presentation: true }
records:
  player:
    fields:
      - online:        { id: 1, type: bool, saved: true }
      - character:     { id: 2, type: Serial, saved: true }
      - input_gen:     { id: 3, type: u16, saved: true, wraps: true }
      - last_seq:      { id: 4, type: u32, saved: true }
      - creation_ring: { id: 5, type: "list<CreationEntry>", max: 256, saved: true, order: saved }
cold:
  label: { key: Serial, fields: [ { text: { id: 1, type: str, max: 200, saved: true } } ] }

# schema/actions.yaml
version: 1                       # ACTION_SCHEMA_VERSION: bump on any layout change (u8 in the batch header)
actions:
  - { id: 1,  name: start_walking, held: true, fields: [ { dir: Direction } ] }
  - { id: 2,  name: stop_walking,  held: true }
  - { id: 20, name: build, fields: [ { item: ItemKey }, { pos: TilePos2 }, { dir: Direction }, { flip: u8 }, { mode: BuildMode }, { drag_id: u32 } ] }
  - { id: 21, name: rotate_entity, fields: [ { target: EntityRef }, { reverse: bool } ] }
  - { id: 0xFF01, name: player_joined, system: true, fields: [ { player: PlayerIndex }, { flags: u8 }, { reserved: u8 } ] }
```

**Layout rules.**
- Action and event payloads are packed in declaration order.
- Records in packets, saves and projections are packed too, but the generator inserts explicit padding so that every record's size is a multiple of 4 and every array meant for a typed-array view starts at a multiple of its element size; sections start at multiples of 8. It prints the padding it inserted, so authors can reorder fields instead.
- Readers never assume alignment (Rust `from_le_bytes`, TypeScript `DataView`), except for the arrays the layout declares aligned.

**Drift is caught four ways.**
1. **Freshness:** `npm run check` runs `schema-gen --check`, which regenerates in memory and fails on any difference with the committed files.
2. **Hand edits:** every generated file starts with `@generated by scripts/schema-gen.ts from schema/<file>`, the schema hash and the file's own content hash; `check-arch` and a cargo test fail on a mismatch.
3. **Runtime handshake:** the generator writes `SCHEMA_HASH` into both outputs: the SHA-256 of the **resolved layouts** (B1-r1 3), a canonical listing of every type, record, action, event, projection, query, packet section, save section and enum with its fields in order, their offsets, widths and padding, enum values, ids and versions. Reordering fields, changing a width or renumbering an enum therefore changes the hash, and a generator test mutates each such property and checks that it does. The shell compares `sim_schema_hash()` with its own at start-up and refuses to run a module from another schema, naming both hashes. `build-manifest.json` and every save header carry it.
4. **Cross-language fixtures:** a Vitest test encodes every action type at its field limits into `test/fixtures/codec/actions.bin`; `cargo test` decodes and re-encodes it byte for byte. In the other direction, `cargo test` writes every event, projection and packet record type into `test/fixtures/codec/records.bin`, and Vitest decodes it and compares field by field. Both sides also decode a **hand-written** fixture per record kind (`test/fixtures/codec/spec/*.hex`: annotated bytes written from the layout listing, not by the generator), so a mistake that the two generated sides share cannot pass (B1-r1 21). `npm run gen` regenerates the generated fixtures; the hand-written ones and the golden set (§15.10) change only with a version bump and a review.

Generated files are committed, so cargo builds without Node and every change is reviewable.

### 15.2 The prototype data path

```
design/spec/data/*.yaml + game/data/engine/*.yaml
        │  scripts/data-stage.ts (TypeScript; §2.4: merge, compile, derive, validate, ids)
        ├──→ public/data/prototypes.bin    the sim's tables (schema/protos.yaml)          → Rust Protos::load
        ├──→ public/data/prototypes.json   names, groups, icons, sprite sets, boxes, display → UI and renderer
        ├──→ src/shared/gen/proto-ids.ts   string-literal unions                           → TypeScript code and tests
        └──→ prototypesHash = SHA-256(prototypes.bin)                                       → build-manifest.json
```

**`prototypes.bin`** has a binary header, so that Rust needs no JSON: `magic "PWPROTO\0"` (8), `u32 formatVersion`, `u8 schemaHash[32]`, `u32 dataVersion`, `u32 sectionCount`, then its sections in the save container's section framing (§8.1) with codec 0 (raw). The sections:
- one per kind (`PROTO_ITEM`, `PROTO_FLUID`, `PROTO_RECIPE`, `PROTO_ENTITY`, `PROTO_TECH`, `PROTO_RESOURCE`, `PROTO_TILE`, `PROTO_WORLD`, `PROTO_SIGNAL`), each a column table like a pool section, indexed by dense id;
- `LISTS`: the variable-length parts (ingredients and products as `(key, amount)` pairs, technology prerequisites, effects, fluid boxes), addressed from the columns by `(offset u32, count u16)`;
- `META`: one record per `meta` block the engine reads (`heat`, `staffing`, `world`, `runaways`, `quality`, …), each a schema record;
- `EXPR`: the expression bytecode pool;
- `NAMES`: each kind's name table in id order (`u16` count, then `u16` length and UTF-8 per name), for saves (§8.3), well-known names (§2.4) and debugging.

Only fields listed in `schema/protos.yaml` go in, and that file names each one's source in the YAML, so the data stage's writer and Rust's loader come from one description. `Protos::load` checks the header's `schemaHash` against the module's and fails with `ERR_PROTOS` otherwise.

**`prototypes.json` has a schema too** (B1-r1 1). `schema/protos.yaml` also declares its layout: a header (`formatVersion`, `schemaHash`, `prototypesHash`), then per kind an array in id order of the fields the UI and renderer read (name, group and order, icon index, locale keys, sprite-set and collision-box references, display values), and the namespace tables that ids resolve through: the icon table (`EntityView.alt_icon`), the locale-key table, and the set-name tables of §15.7's lookup contracts (tree species, decoratives, cliffs, town buildings). The generator emits its TypeScript types, a validator the loader runs, and the data stage's writer; the golden set (§15.10) holds the M0 file.

**Expressions compile to bytecode** (B1's call). The alternative was to compile each expression to Rust code at build time. Bytecode wins because:
- a data edit must not need a Rust rebuild (balance churn, §1; a release build takes about 67 s, A1);
- `prototypes.bin` stays self-contained, so `prototypes.hash` covers the formulas;
- expressions are evaluated rarely (costs once per level, product tables when j changes, the collapse factor every 60 ticks), so interpretation costs nothing measurable;
- one bytecode, one semantics: the data stage validates with a reference interpreter of the same bytecode, and a cross-language test compares both on every expression at every reachable value.

**The bytecode.** An expression is an `ExprRef` (`u32` offset into `EXPR`; `0xFFFFFFFF` = none). At that offset: `u16 byteCount` (the length of the op stream that follows), `u8 varCount, u8 maxStack`, then the ops, each a one-byte opcode followed by its operands:

| Opcode | Operands | Effect (stack of `f64`) |
|---|---|---|
| `0x01 CONST` | `f64` (8 bytes, IEEE bits) | push the constant |
| `0x02 VAR` | `u8` index | push variable k of the field: `count_formula` and `field_year` [L]; `amounts_by_j` [j]; `speed_factor` [sigma, c] |
| `0x10 ADD`, `0x11 SUB`, `0x12 MUL`, `0x13 DIV` | — | pop b, pop a, push a ∘ b |
| `0x14 NEG` | — | negate the top |
| `0x20 POWI` | — | pop e, pop b; e must be an integer in [−1024, 1024]; push `det::powi(b, e)` (§4.1) |
| `0xFF END` | — | the result is the single value left |

The data stage guarantees `maxStack` ≤ 16 and integer exponents within ±1,024, and checks for finite results at every level up to the level cap and at the sample points of bounded variables (§2.4; B1-r1 18). It does not promise more than it can check, so the runtime behaviour at the limits is defined instead: the interpreter clamps every result to its field's declared range (an infinity becomes the bound), maps NaN to the range's lower bound and logs a warning, and treats an exponent outside ±1,024 as the nearest limit. All of this is deterministic everywhere, and the data stage's checks make each case a data bug to fix. Rounding rules stay with the consumer (costs round half up to whole units, §5.12).

**Ids.** Dense `u16` per kind, assigned by the data stage (§2.4 step 5). The same ids appear in `prototypes.bin`, `prototypes.json`, `proto-ids.ts`, packets, projections, actions and saves. Rust never hard-codes one (§2.4 step 4).

**The `prototypes.hash` handshake.**
1. The build writes `prototypesHash` into `build-manifest.json`.
2. The sim worker fetches `prototypes.bin`, computes its SHA-256 with WebCrypto, and refuses a mismatch (a stale cache) with a reload.
3. Every save and checkpoint header carries the hash (§8.1). Loading a save with the same hash loads directly; with another, the shell builds remap tables from the save's name tables (§8.3) and the load reports what was removed.
4. Multiplayer's `HELLO` carries it; the relay refuses a different one (11 §3.2, D14).

### 15.3 Actions and closures

**Shared field types** (`types.yaml`):

| Type | Width | Layout |
|---|---|---|
| `EntityRef` | 8 | `u32 a`, `u16 b`, `u8 tag`, `u8 reserved` (0). Tag 0: none. Tag 1: an existing entity, `a` = serial. Tag 2: a creation id, `a` = the seq of an earlier action **by the same player**, `b` = the index among the entities that action created (§4.3) |
| `TilePos2` | 8 | `i32 x2`, `i32 y2`: a building centre in doubled tile units (§4.2) |
| `FinePos` | 8 | `i32 x`, `i32 y` in 1/256 tile |
| `ItemKey`, prototype ids | 2 | dense ids (§4.3) |
| `Direction` | 1 | 0–15 (§4.2) |
| `blob` | 32 | the SHA-256 of a content-addressed blob (below) |
| `str` | 2 + n | `u16` length, UTF-8; at most the field's `max` |
| `bytes` | 2 + n | `u16` length, bytes; at most `max` |
| `list<T>` | 2 + n·size(T) | `u16` count, then fixed-size items; at most `max` items |
| `blob_or_bytes` | 1 + … | `u8` tag: 0, then `u16` length and the bytes inline; 1, then a 32-byte SHA-256 naming a blob |

An action has at most one variable-length field (`str`, `bytes`, `list<T>` or `blob_or_bytes`), and it is the last one: `distribute` carries its entities as a `list<EntityRef>`, and `place_blueprint` its record as `blob_or_bytes`.

No action carries a float: the client quantises positions to `TilePos2` or `FinePos` before encoding, so no number the client computed reaches the World unrounded (11 §3.3).

**An action** is `u16 type, u16 len`, then `len` bytes of payload. Type ids are explicit in `actions.yaml`, append-only and never reused; names mirror Factorio's `defines.input_action` (I §8.2) plus Appendix B's additions. Factorio's own numeric values are not used, because they are not a stable published contract. A **held-input action** (`held: true`: start and stop walking, begin and stop mining, picking state; shooting and driving later) starts its payload with `u16 input_gen` (D22).

**A batch** is one player's consecutive actions within one tick:

| Offset | Field | Meaning |
|---|---|---|
| 0 | `u8 version` | `ACTION_SCHEMA_VERSION`; any other value fails the preflight |
| 1 | `u8 flags` | bit 0 `SYSTEM` (player must be `0xFFFF`); other bits 0 |
| 2 | `u16 player` | 0–31, or `0xFFFF` for system actions |
| 4 | `u32 tick` | the tick this closure belongs to |
| 8 | `u32 first_seq` | the seq of the first action; the i-th action has `first_seq + i` |
| 12 | `u16 count` | 1–65,535 |
| 14 | `u16 reserved` | 0 |
| 16 | actions | `count` × (`u16 type, u16 len, payload`) |

**A closure** is the batches of one tick, back to back, in execution order; an empty closure is zero bytes. Execution order is the sequencer's: within a tick, the relay's queueing order (11 §3.4) and, in single player, submission order. A player's actions may form several batches in one tick when other players' actions interleave.

**Limits.** A payload is at most 65,531 bytes, so that an encoded action (its 4-byte header plus the payload) fits every `u16` length field, including the wire's (11 §3.2); larger payloads are blobs. A closure is at most `CLOSURE_MAX` = 1 MiB (1,048,576 bytes). Strings respect their schema `max`.

**Admission** (B1-r1 10). One function decides which tick an action joins, and every sequencer uses it: the `LocalSequencer` and the relay's `RoomCore` import it from `src/shared/admission.ts`, and the native `TestSequencer` (§10.2) mirrors it, pinned by a shared fixture. It reads only each action's player, type id, length and blob count, so the relay still never parses payloads. Each tick keeps two running sizes:
- its **closure size**: 16 bytes per batch plus 4 + payload bytes per action, where a new batch starts whenever the acting player changes (the system "player" included);
- its **wire size**: the bytes of its `TICKS` entries (11 §3.2), 17 + 32 × blobCount + payload bytes per action.

A player's action fits a tick if both sizes stay within `CLOSURE_MAX − 4,096`; a system action fits if both stay within `CLOSURE_MAX`, so 4 KiB of every tick is reserved for system actions. An action that does not fit goes to the first later tick where it does, and the tick it did not fit is then **closed** to player actions, so every later action goes later too and each player's order is kept. The relay records the action's tick in `lastAssigned` before it acknowledges it (11 §3.4). A player's action with a type id from `0xFF00` never enters a tick: the `LocalSequencer` drops it with an error in the log, and the relay treats it as a protocol error (11 §3.2). Since every action costs at least 17 wire bytes, a tick holds at most 61,680 actions, so a batch's `u16` count and a `TICKS` message's entry count always suffice, and one tick always fits one `TICKS` message.

**Preflight validation** (`sim_tick`, before any state changes; B1-r1 9). The module first walks the whole closure with **temporary** watermarks, copied from each player's `last_seq` and from `last_system_seq`, and writes nothing to the World until every check has passed. A failure returns `ERR_FRAMING` (or `ERR_BLOB_MISSING`), and the tick does not run:
1. the closure is at most `CLOSURE_MAX` bytes, and its batches consume exactly its bytes;
2. every batch: `version`, `flags`, `reserved` and `tick == world.tick + 1` as above; `count ≥ 1`; `player ≤ 31` unless `SYSTEM`;
3. every action's 4-byte header and its `len` bytes lie inside its batch, and its type id is from `0xFF00` exactly when the batch is a system batch;
4. **seqs rise** (D21): each batch's `first_seq` is above the temporary watermark of its player, `first_seq + count − 1` is computed with checked arithmetic and must not pass `u32::MAX`, and the watermark moves to it. A player's seqs therefore rise strictly across the tick's batches and across ticks, in every build, because `last_seq` is saved state;
5. every blob named by an action that decodes has been supplied (`sim_blob_put`); otherwise the result is `ERR_BLOB_MISSING`.

A preflight failure means a bug in a sequencer, a codec or the shell, because the sequencers build exactly these structures. Every client decodes the same bytes, so every client fails identically; the shell treats it like a trap (§3.6). The codec tests (D18 g) and fuzzing exist to keep it impossible.

**Malformed actions are refused, not fatal** (B1-r1 9). Phase 1 decodes each action with the generated decoder, which checks everything the schema declares: a known type; `len` equal to the type's fixed size or consistent with its variable tail; every enum value and `EntityRef` tag in range; `bool` 0 or 1; reserved fields zero; list counts and string lengths within `max`; strings valid UTF-8. A failure refuses that action with `action_failed` and the reason `malformed`, consumes its seq and changes nothing else, identically on every client. A buggy or hostile client therefore cannot stop a room, and the relay stays game-agnostic. `malformed` and `unsupported` (§2.4) are developer reasons: they have no player-facing text, and the shell logs them.

**Semantic validation** happens in phase 1 as each action applies (§4.6): the player must exist and be online; reach, items, collisions and acceptance rules hold; references resolve. A refusal changes nothing and emits `action_failed` with a reason (§15.6), identically everywhere.

**References** (S5, D23). An `EntityRef` with tag 1 resolves through the serial index; a missing serial fails the action with the reason "target gone", even if another entity of the same prototype now stands there. Tag 2 resolves through the acting player's creation ring (§4.3) and fails cleanly if the creating action failed or left the ring. There is **no position fallback**: positions appear only in actions defined on positions (build, mine a tile or resource, drop an item, place a blueprint, place a ping or tag).

**Input fencing** (D22). A held-input action whose `input_gen` differs from `players[p].input_gen` is a no-op with an `input_fenced` event. Exactly two actions change the generation (B1-r1 11): `release_inputs(p)` and `player_left(p)` each stop p's walking, mining and picking and increment it (wrapping; only equality is compared); `player_joined` does not change it. **The sequencer writes `input_gen`** into each held-input action when it stamps it, from the generation it tracks: the world's value at load (`bound`, §3.2) plus one for every `release_inputs(p)` and `player_left(p)` it has seen since in the closure stream. An action stamped before the release arrived therefore carries the old generation and is fenced; the client re-sends any input still held (11 §2.6). The main thread never needs to know generations.

**Blobs.** A payload larger than 65,531 bytes (a large blueprint record) travels as a blob: the action carries the blob's SHA-256. The shell supplies the blob with `sim_blob_put` before the tick that uses it, after verifying the hash; the module keeps supplied blobs only until that tick ends. Retention for replays and resumes is the shell's and the relay's job (§8.5, 11 §6.5). A missing blob is `ERR_BLOB_MISSING`, a shell bug.

**Identity and seq** (11 §3.3). An action is `(player, seq)`. The World keeps each player's `last_seq` and a `last_system_seq`, set by phase 1 to the seq of every action it applies, refused or not; after a load the main thread continues from them by §3.2's rule, so seqs never repeat within a world. System actions take their seqs from the sequencer's own counter, which continues from `last_system_seq` (the relay seeds it the same way, 11 §6.3).

**System actions** (player `0xFFFF`; ids from `0xFF00`):

| Id | Name | Payload | Effect |
|---|---|---|---|
| `0xFF01` | `player_joined` | `u16 player, u8 flags` (bit 0: returning), `u8 reserved` | Creates or re-activates the player's state and character. Single player's `LocalSequencer` issues `player_joined(0)` in a new world's first tick |
| `0xFF02` | `player_left` | `u16 player` | Marks the player offline and releases held inputs, incrementing the input generation as `release_inputs` does; the hand returns to the inventory if it fits (§5.1) |
| `0xFF03` | `release_inputs` | `u16 player` | Stops walking, mining and picking; increments the input generation |
| `0xFF04` | `snapshot_marker` | `u32 snapshot_id, u16 donor` | Nothing in the World; the donor's shell writes a checkpoint after this tick (11 §4.1) |
| `0xFF05` | `debug_dump` | `u32 dump_id` | Nothing in the World; clients write desync bundles after this tick (11 §5.3) |

**The `act` message** (main thread → sequencer, §3.2) carries `firstSeq` and actions without ticks: `u16 type, u16 len, payload`, back to back, the i-th with seq `firstSeq + i`. The main thread numbers its player's actions itself, by §3.2's rule (`nextSeq = max(loaded, accepted, pending) + 1`), so it can name its own unconfirmed creations by creation id; the sequencer refuses seqs that do not rise, admits each action to a tick (above), fills input generations and builds batches. Blobs named by `blob_or_bytes` fields travel beside the actions in `act.blobs`.

### 15.4 The render packet

One packet per extraction: a transferable `ArrayBuffer` with a header, a section directory and sections. `sim_extract` writes the whole packet into the module's output arena, header included, leaving `state_gen` and `view_seq` zero; the shell copies it into a pooled buffer and fills those two fields (§3.2). Offsets in the directory count from the start of the packet.

**Header** (32 bytes):

| Offset | Field | Meaning |
|---|---|---|
| 0 | `u32 magic` | `0x4B505750` ("PWPK") |
| 4 | `u16 version` | `PACKET_VERSION` from the schema |
| 6 | `u16 flags` | bit 0 `FULL`: drop everything held for this world before applying (the mirror, belt geometry, overlay and chart data, subscription records). Set on exactly one packet, a generation's first, which the worker sends unsolicited after `bound` (§3.4); its sent-state is empty then, so the packet that answers the generation's first view request sends every held chunk afresh (B1-r1 12). Bit 1 `EVENTS_DROPPED`, bit 2 `COALESCED` (ticks passed without extraction) |
| 8 | `u32 state_gen` | §3.4 |
| 12 | `u32 tick` | the tick after which this was extracted |
| 16 | `u32 view_seq` | the view request this packet answers |
| 20 | `u16 daylight` | the sim's daylight factor (§5.7) × 65,535, so the renderer never recomputes the day table |
| 22 | `u16 section_count` | |
| 24 | `u32 byte_length` | the whole packet |
| 28 | `u32 reserved` | 0 |

**Section directory**: `section_count` × 16 bytes: `u16 type, u16 record_version, u32 offset, u32 byte_length, u32 count`. Sections start at multiples of 8.

**Sections** (type ids are append-only; records in bytes):

| Type | Section | Record | Sent |
|---|---|---|---|
| 1 | `CHUNK_TILES` | `u32 chunk_key, u16 surface, u16 flags, u32 version`, then `u8 tiles[1024]` (1,036) | when a chunk enters the held set or its tiles change |
| 2 | `CHUNK_ENTITIES` | per chunk: `u32 chunk_key, u16 surface, u16 count, u32 version, u32 reserved`, then `count` × EntityView (24) | when a chunk enters the held set or its version changes; replaces the chunk's records |
| 3 | `DYN` | `i32 x2, i32 y2, u32 serial, u16 proto, u16 phase, u8 dir, u8 state, u8 light, u8 quality` (20) | every packet, for visible entities that are animated, lit or working |
| 4 | `HANDS` | `i32 x2, i32 y2, u32 serial, u16 proto, u16 held` (`ItemKey`, `0xFFFF` none), `u16 theta` (turns × 65,536, from north, clockwise, as Factorio's orientation; §15.7 draws it), `u16 ext` (tiles × 4,096), `u8 dir, u8 held_count, u16 reserved` (24) | every packet, for visible inserters that are not at rest |
| 5 | `BELT_GEOM` | per line: `u32 line_id, u32 geom_gen, u16 seg_count, u8 lane, u8 speed, u32 length` (positions), then `seg_count` × (`i32 x, i32 y` (1/256 tile), `i32 len` (positions), `u8 dir, i8 turn, u16 reserved, i32 radius` (1/256 tile; arcs only)) (20 each) | when a line touching a held chunk is new to the main thread or its `geom_gen` changed |
| 6 | `BELT_ITEMS` | per line: `u32 line_id, u32 geom_gen, i32 front_gap, u16 count, u16 reserved`, then `count` × `u16 key`, then `count − 1` × `i16 gap`, padded to 4 | every packet, for visible lines that hold items |
| 7 | `MOVERS` | `u32 serial, u16 proto, u8 kind` (0 character, 1 agent, 2 rolling stock, 3 unit, 4 projectile), `u8 flags` (bit 0 mining, for characters; §15.7's clip), `i32 x, i32 y` (1/256 tile), `i16 vx, i16 vy` (1/256 tile per tick), `u32 base_tick, u16 orientation` (turns × 65,536, from north, clockwise), `u16 aux` (player index for characters, held item for agents), `u32 reserved` (32) | every packet; the renderer extrapolates from `base_tick` (§6.8) |
| 8 | `OVERLAY_CHUNK` | `u32 chunk_key, u16 surface, u16 flags, f32 temperature` (12) | while the thermal overlay or the heat tint (07 §3.2) is on, after each chunk's 64-tick update |
| 9 | `OVERLAY_STAFFING` | `i32 x0, i32 y0` (campus corner), `u16 radius, u8 hue, u8 flags` (12) | while the staffing overlay is on, on change |
| 10 | `CHART` | `u32 chunk_key, u16 surface, u16 reserved, u32 version`, then 32 × 32 RGBA8 (4,108) | while the view request asks for chart data: when a charted modified chunk enters the chart rectangle or changes |
| 11 | `EVENTS` | §15.6 | every packet with events |
| 12 | `UI` | §15.5 | every packet with subscription records |
| 13 | `AUDIO_WORKING` | §15.6 (16) | every packet while audio is on |
| 14 | `CHUNK_OBJECTS` | per chunk: `u32 chunk_key, u16 surface, u16 count, u32 version, u32 reserved`, then `count` × ObjectView (16) | when a chunk enters the held set or its objects change; replaces the chunk's objects |
| 15 | `CHUNK_RESOURCES` | per chunk: `u32 chunk_key, u16 surface, u16 count, u32 version, u32 reserved`, then `count` × (`u16 tile` (index in the chunk), `u16 resource, u8 band` (the richness band that picks the sprite, 0–7), `u8 reserved, u16 reserved`) (8) | when a chunk enters the held set, or a tile changes band or is depleted; exact amounts come from `HOVER` and queries |
| 16 | `BELT_RETIRE` | `u32 line_id, u32 geom_gen` (8) | when geometry the main thread holds stops existing: the line was deleted, rebuilt, split, merged or reshaped (B1-r1 13) |
| 17 | `CHART_PRISTINE` | `u32 chunk_key, u16 surface, u16 reserved` (8) | while the view request asks for chart data: when a charted pristine chunk enters the chart rectangle. The shell gets its image from the worldgen pool and posts it in a `chart` message (§3.2, §5.19); the main thread ignores an image whose chunk has left the rectangle |

**Three kinds of section** (B1-r1 13):
- **Snapshots** describe the present completely, and the main thread replaces its copy with each packet's: `DYN`, `HANDS`, `BELT_ITEMS`, `MOVERS` and `AUDIO_WORKING`. An absent snapshot section means "none".
- **Events** report what happened since the previous packet: `EVENTS`. The module keeps them until a packet carries them (bounded; `EVENTS_DROPPED`, §15.6).
- **Deltas** change the main thread's retained state, and stay until replaced or retired (`BELT_RETIRE` only retires); the retirement rules are what keep that state bounded under a camera that never moves:

| Delta section | A record replaces | Retired when |
|---|---|---|
| `CHUNK_TILES`, `CHUNK_ENTITIES`, `CHUNK_OBJECTS`, `CHUNK_RESOURCES` | that chunk's tiles, entities, objects or resources | the chunk leaves the held set |
| `BELT_GEOM` | nothing: each `(line_id, geom_gen)` is new | `BELT_RETIRE` names it, or the last held chunk the line touches leaves the held set |
| `OVERLAY_CHUNK` | that chunk's overlay value | the chunk leaves the held set, or a view request turns both the thermal overlay and the heat tint off |
| `OVERLAY_STAFFING` | the whole set, whenever the section is present | a view request turns the staffing overlay off |
| `CHART`, `CHART_PRISTINE` | that chunk's chart image (for a pristine chunk, from the `chart` message) | the chunk leaves the chart rectangle, or a view request turns chart data off |
| `UI` | that subscription's record (§15.5) | the subscription ends |

A retirement caused by a view request takes effect with the packet that answers it, on both sides, like the held set. Turning an overlay or the chart back on therefore starts from nothing: that packet sends every held chunk's current value, without waiting for the next 64-tick update.

**What the worker remembers** of the main thread's state (the held set, each held chunk's sent versions, the sent geometry pairs, the overlay and chart state, the subscription hashes) lives in `PresentationState` (§3.6) and advances only when a packet is actually extracted and sent. A skipped extraction (no free buffer, a hidden tab) therefore loses nothing: the next packet's deltas are computed against what was really sent, and its snapshots and events cover the gap. The main thread applies every packet of the current generation in order; it may skip drawing one, never applying one. The test is **mirror equivalence** (§10.4 #16): after any mix of world edits, view moves, overlay toggles and skipped extractions, the state the main thread holds equals what a single `FULL` extraction of the same world would give.

**Per-chunk versions.** Each per-chunk section (`CHUNK_TILES`, `CHUNK_ENTITIES`, `CHUNK_OBJECTS`, `CHUNK_RESOURCES`) has its own version counter in the chunk, so a status change resends the chunk's entities and nothing else. Resource amounts change with every mining operation, so the view carries only each tile's richness band.

**ObjectView** (16 bytes): `u16 id` (a world-object, tree-species, decorative or item key), `u8 kind` (0 tree, 1 rock or other world object, 2 cliff, 3 ground item, 4 decorative), `u8 variant` (a tree's leaf stage, a variant index), `i32 x, i32 y` (1/256 tile), `u16 count` (ground items), `u16 reserved`. Decoratives are generated by the `worldgen` crate from the chunk's decorative seed during extraction, so their rule exists once.

**EntityView** (24 bytes): `u32 serial, i32 x2, i32 y2, u16 proto, u16 alt_icon` (alt-mode's recipe or product, as an index into `prototypes.json`'s icon table, `0xFFFF` none), `u8 dir, u8 flip, u8 quality, u8 variant` (the connection mask of belts and pipes), `u8 status` (§5.5's code), `u8 flags` (bit 0 ghost, 1 marked for deconstruction, 2 marked for upgrade, 3 compromised), `u16 reserved`. For a ghost, `proto` is the prototype it will build.

**`DYN`.** `phase` is the animation phase of the entity's loop × 65,536 (from the presentation field `anim`, which advances with `speed_eff` while working and freezes otherwise); `state` is 0 idle, 1 working, 2 no power or fuel; `light` is the emitter strength 0–255. The renderer draws the static base from the mirror and the animated layer and light from `DYN`, sorting both within the object layer by `(bottom y, x, serial, part)`, the base before its animated part (§6.6), so it needs no lookup.

**Belt items as gap arrays** (A1 change 11). A line's items are sent as the line holds them: `front_gap` is gap[0], the distance in positions from the line's downstream end to its first item, and `gap[i]` for i ≥ 1 is the slack beyond the 64-position saturated spacing (§5.3). Item i lies at distance dᵢ from the end, with d₀ = `front_gap` and dᵢ = dᵢ₋₁ + 64 + gap[i]. Segments are listed from the line's downstream end; each gives its own downstream end point `(x, y)` on the lane's centreline, its length in positions, its direction of travel at that end (`dir`), and, for an arc (`turn` = −1 left, +1 right), its radius. The main thread walks the segments from the front, maps each distance to a point on the centreline (straight runs linearly, arcs by angle about the centre that `dir`, `turn` and `radius` fix), culls points outside the view and writes quads in the same loop (§6.8). The sim supplies every length and shape, so the renderer does no gameplay arithmetic. Per item this sends 4 bytes and costs the worker a copy, against 16 bytes and about 8 ns per sprite on the reference machine for expanded records; at §6.12's 60k visible belt items that saves about 0.5 ms of worker time per frame.

**Line identity.** `line_id` is the line's pool index; `geom_gen` is taken from a **global** counter each time a line is built, rebuilt, split, merged or reshaped, so `(line_id, geom_gen)` never repeats even when a pool slot is reused (§3.7). The main thread caches geometry by that pair and drops a line's entry when the last held chunk the line touches leaves the held set, or when `BELT_RETIRE` names it; the worker applies the same rules, so it knows which geometry the main thread holds. At each extraction the worker compares its sent pairs with the live lines and retires every pair whose line is gone or now carries another `geom_gen` (a scan over the lines that touch held chunks, a few thousand at most). All entries go on a new state generation.

**The view request** (main → shell → `sim_extract`), 52 bytes: `u32 view_seq, u16 surface, u16 flags` (bit 0 thermal overlay, 1 staffing overlay, 2 chart, 3 audio, 4 alt-mode), `i32 x0, i32 y0, i32 x1, i32 y1` (tiles: the **visible** rectangle, no margin, the upper bounds exclusive), `f32 zoom, u32 hovered_serial` (0 none), `f32 audio_half_range` (tiles), `i32 chart_x0, i32 chart_y0, i32 chart_x1, i32 chart_y1` (chunks, when bit 2 is set). **The held set** is the chunks overlapping the visible rectangle expanded by one chunk on every side, computed by one generated function in both languages; the worker applies a request when it extracts the packet that answers it, the main thread when that packet arrives, and both evict the chunks that leave the set (§3.4).

**Pooling and transfer.** The shell keeps three packet buffers, starting at 256 KiB and doubling on demand. It copies the arena into a free buffer (`Uint8Array.set`, one `memcpy`), fills the header and posts it with the buffer in the transfer list. The main thread decodes, copies what it keeps into its mirror and per-frame arrays, and transfers the buffer back with `ack`; it never holds a view into a packet after `ack`. With no free buffer, extraction is skipped (§3.2).

### 15.5 Projections, subscriptions and queries

The UI never reads simulation state directly. Open windows **subscribe** to projections, and the sim answers in the packet's `UI` section (IMPL-1 rule 3).

**A subscription request** (main → shell → `sim_subscribe`): `u32 sub_id, u16 kind, u16 flags` (bit 0: a tail follows), `u32 target` (an entity serial, a player index or 0), `u32 p0, u32 p1, u32 p2, u32 p3`, then, when flagged, a tail (`u16 len`, bytes) for list parameters. The main thread allocates `sub_id`s from 1 and never reuses one within a state generation; `sub_id` 0 is the hover projection that the view request's `hovered_serial` drives. Sending an existing `sub_id` replaces that subscription.

**A `UI` record** (in the packet): `u32 sub_id, u16 kind, u16 status` (0 ok, 1 gone, 2 invalid), `u32 version, u32 len`, then the kind's record (`len` bytes, padded to 4). `version` counts the records sent for that subscription. A status-2 record's body is a `u16` reason: 1 unsupported (outside the capability manifest, §2.4), 2 bad parameters, 3 over a limit (below). These are developer reasons without player-facing text; the shell logs them.

**Rules** (A2-r1 13).
- **Evaluation.** Each subscription is evaluated during extraction, in `sub_id` order, at its kind's cadence: every packet (`HOVER`, `ENTITY_PANEL`, `CHARACTER`, `INVENTORY`), or on subscribing and then at the first extraction at least 60 ticks after its last evaluation (`HUD`, `RESEARCH`, `STATS`, `ELECTRIC`, `WORLD`), so a skipped extraction delays a slow projection but never loses it.
- **Change detection.** The module hashes each record it writes (XXH64) and sends it only when the hash differs from the last one sent for that `sub_id`.
- **Source revisions** (B1-r1 15). A kind may declare in `projections.yaml` the revision counters its record depends on: an inventory's version (raised by every insertion, removal, filter or limit change), a player's inventory and crafting-queue versions, an entity's status. These are presentation fields (§4.5), raised by the tick and never saved or hashed. When none of them has changed since the subscription's last evaluation, the module skips building and hashing its record, so an open chest window costs nothing while the chest is untouched. A kind without declared sources (a working machine's panel, whose progress moves every tick) is rebuilt at its cadence; one entity's record is small.
- **Shared evaluation.** Subscriptions with the same kind, target, parameters and tail are evaluated once per extraction; each still gets its own record, version and hash.
- **Limits** (B1-r1 15). At most 32 subscriptions besides `sub_id` 0, of which at most 4 are `STATS`. A record is at most 64 KiB, which the generator checks from each kind's field maxima, and the `UI` section at most 256 KiB per packet: subscriptions due beyond that wait for the next extraction, starting after the last one written, and lose nothing, because what was sent advances only when a packet is (§15.4). A request beyond a limit is answered with status 2, reason 3. With these limits, evaluating every subscription costs at most about 0.3 ms per extraction on the reference machine (§10.6, `m0-chests-10k`).
- **Targets that disappear.** If a subscription's target no longer exists, the module sends one record with status 1 (gone) and drops the subscription; the window closes. Entity windows bind by serial, never by handle or position.
- **State generations.** Every `sub`, `unsub` and `query` carries the state generation (§3.2); the shell drops those from another generation. A fresh worker starts with no subscriptions, so after a new generation the main thread re-sends all of its subscriptions and its view request (§3.4). Records and responses from an old generation are rejected by the main thread.
- **Content.** Records contain no handles or pointers: entities by serial, items by `ItemKey`, strings as locale ids (08) or, for player text such as labels, UTF-8.

**Kinds** (ids append-only; M0 builds the ones marked):

| Id | Kind | Target and parameters | Record (summary; layouts in `projections.yaml`) | M0 |
|---|---|---|---|---|
| 1 | `HUD` | — | tick; research in progress (tech, level, progress); world strip values (Field, Literature, Your year, years ahead); alert counts by type; the music feed (Literature year, activity = mean electric consumption over 60 s in W, which the audio module normalises (§15.6), doubling time in s or 0, takeoff level, closed and victory flags) | yes (tick only) |
| 2 | `CHARACTER` | player index | character serial, main inventory slots, hand (key, count, origin slot), quickbar, crafting queue (recipe, count, progress), mining progress, input generation | yes |
| 3 | `INVENTORY` | entity serial; `p0` = inventory type | slots (`ItemKey`, `i32` count, filter), limit bar | yes |
| 4 | `ENTITY_PANEL` | entity serial | prototype, status, recipe, progress, crafts per second now, energy satisfaction, buffer and draw, productivity bar, modules, every inventory's slots inline, fluid boxes, and a kind-specific tail (staff, throttle, resources remaining …) | yes (chests) |
| 5 | `HOVER` | entity serial (the view request's `hovered_serial` uses `sub_id` 0) | the tooltip's live values for the entity's kind | yes |
| 6 | `RESEARCH` | — | queue (tech, level, progress, byline), and a state table for the technology screen (tech, state, level, progress) | |
| 7 | `STATS` | `p0` precision (0–8: the nine ranges), `p1` tab; tail: up to 256 keys | per key: produced and consumed totals over the precision's window and, when `p2` bit 0 is set (for at most 24 keys, so that the series fit the 64 KiB record cap; C1b decisions 3–4), the 300-point series of each: whole in the first record after subscribing or after a parameter change, then only the points appended since the previous record (`u16 from, u16 count`; B1-r1 15) | yes (hand-mined and hand-crafted items) |
| 8 | `ELECTRIC` | a pole's serial | satisfaction by class, production and consumption by prototype, accumulator charge, series | |
| 9 | `WORLD` | — | the World window's values (W_own, W_pub, Y_pub, j, σ, Field, Literature …) | |
| 10 | `DEBUG` | — | per-system active counts, pool sizes, linear-memory bytes, per-phase µs (dev builds), this tick's digests | yes |

M0 must ship real `INVENTORY` and `STATS` projections (IMPL-1 rule 5), not fixtures.

**Queries** (one-off, read-only, not logged): `query {gen, id, q}` with `q` = `u16 kind, u16 flags`, then the kind's parameters; the result is `res {gen, id, ok, value}` with the kind's record, both laid out in `projections.yaml`. **Queries never delay a tick** (B1-r1 15):
- The module runs them cooperatively, as continuations in `PresentationState`: `sim_query` starts one, and `sim_query_step(units)` advances the running ones in arrival order by at most `units` of work (an entity, chunk or record visited each) and returns those that finished (§15.8). The shell steps them only in the time a wake has left after its due ticks, at most 2 ms per wake, converting milliseconds to units from its own measurements; while no tick runs it steps them on a timer.
- At most 4 queries run at once; the shell holds later ones in arrival order. `cancel {gen, id}` drops a query, and a new state generation drops them all.
- A result is at most 1 MiB; a kind that can produce more (search, inspect) states its order and sets the result's `TRUNCATED` flag. A query that spans ticks reads the world as each slice finds it, and its result names its first and last tick.

Kinds (ids append-only): 1 `rates` (entities or an area; §5.20's rate calculator), 2 `map_search` (text), 3 `total_raw` (recipe, count), 4 `where_made` (item), 5 `patch_info` (a resource tile), and, in dev builds, 6 `inspect` (every saved field of one entity), 7 `hash`, 8 `digest`. A1 measured query latency at p50 0.45–0.73 ms and p99 about one tick plus a message hop against a worker paced at 60 UPS, which is why open windows subscribe instead of polling.

### 15.6 Events, feedback and audio

**Event records** (the packet's `EVENTS` section): a 16-byte header, `u16 type, u16 len, u32 tick, u32 seq` (the action answered, 0 if none), `u16 player` (`0xFFFF` none), `u8 flags` (bit 0 `HISTORICAL`), `u8 surface`, then `len` bytes of payload, padded to 4. Positions in payloads are `FinePos` or `TilePos2`.

**Types** (ids append-only; the slice's set, more per milestone):

| Id | Type | Payload | Typical use |
|---|---|---|---|
| 1 | `action_failed` | `u16 reason` (`FailReason`, a schema enum whose values map to 08's strings in `locale/en.yaml`, except the developer reasons `malformed` (§15.3) and `unsupported` (§2.4), which have no string), `u16 reserved, FinePos pos, u32 serial` | flying text and the error sound; tells the latency state which prediction failed (11 §3.5). A developer reason shows nothing and plays nothing; the shell logs it |
| 2 | `flying_text` | `u16 text` (`FlyingText`, likewise mapped to 08), `u16 item, i32 count, i32 total, FinePos pos` (`total` is the new inventory count, −1 for none; C1b decision 2) | "+3 Iron plate (57)", "Swapped" |
| 3 | `entity_built` | `u32 serial, u16 proto, u8 dir, u8 flags` (bit 0 ghost), `TilePos2 pos` | build sound by size; prediction reconciliation |
| 4 | `entity_mined` | `u32 serial, u16 proto, u16 reserved, TilePos2 pos` | mine sound by material |
| 5 | `entity_rotated` | `u32 serial, u8 dir, u8 reserved, u16 reserved, TilePos2 pos` | rotate sound |
| 6 | `item_crafted` | `u16 recipe, u16 count` | craft-finished sound (the player's own) |
| 7 | `research_completed` | `u16 tech, u16 level` | sound and toast |
| 8 | `milestone` | `u16 milestone` (a dense id of `text.yaml`'s milestones, assigned by the data stage) | log line toast (07 §15) |
| 9 | `alert_raised` | `u16 alert` (`AlertType`, a schema enum), `u16 reserved, u32 serial, TilePos2 pos` | alert sound (the alert list itself is in `HUD`) |
| 10 | `player_joined`, 11 `player_left` | — (the player is in the header) | system lines (11 §8.3) |
| 12 | `input_fenced` | — | debug log (D22) |
| 13 | `loop_closed`, 14 `victory` | — | the closure cue and the end (A4; M4) |

**Delivery.** Events accumulate in the module from the tick that produced them until the next extraction drains them. The queue is part of `PresentationState`: the tick writes it through an `EventSink`, and extraction drains it (§3.6). `EVENTS` is an event section (§15.4), so a skipped extraction loses nothing. The queue holds at most 8,192 events or 512 KiB; on overflow the oldest are dropped and the packet carries `EVENTS_DROPPED`.

**Suppression** (D15, S15). The shell sets the module's `HISTORICAL` flag (§15.8) while it runs catch-up, replay or the fast-forward after a load or a join; events from those ticks carry the flag. The main thread never plays a sound, shows flying text or raises a toast for a historical event, nor for any event more than 30 ticks older than the packet that carries it (a hidden page that kept running). Log-type events are appended to their logs silently. After a new state generation, audio state is reset (§3.4).

**Sounds are data.** The event-to-sound map (an event type plus an entity type or material → a sound id) is engine overlay data, `game/data/engine/sounds.yaml` (§2.4), so the audio module needs no per-event code (A4 §10). Each sound id also carries its variant files, category bus, gain, jitter, rate limit, voice cap and whether it is positional. The SFX rules (variation, rate and voice limits, attenuation, mixing) are §9.4's.
- **Sound ids are generated** (codex B2-r1 finding 6). The data stage gives every sound in `sounds.yaml` a dense `u16` id, sorted by name. It writes the entity → working-sound table into `prototypes.bin` for extraction, and the id → name table into `prototypes.json`.
- **The asset build writes the audio manifest** (`public/audio/sounds.json`: name → files, loop points, levels) from the same file, with the `prototypesHash` it was built against. The audio module joins the two tables by name at load and refuses a manifest built for other prototypes (dev builds: an error; production builds pair them, §2.3). A sound id without files is silent and logged once.

**Working sounds** (`AUDIO_WORKING`, 16 bytes per sound): `u16 sound, u16 n, f32 cx, f32 cy, f32 wsum`, one record per working-sound id with n > 0 among the working entities within the view rectangle grown by R ÷ 2 on every side (and inside the held set). (cx, cy) is their centroid relative to the view centre in tiles, and wsum = Σ 1 ÷ (1 + (d ÷ R)²) over them, with d each one's distance from the view centre and R the view request's `audio_half_range`, so that one entity at R counts half (−6 dB). The main thread sets `audio_half_range` to half the view's width in tiles, at most 64. Extraction only aggregates; the audio module turns n, wsum and the centroid into a loop's gain and pan (§9.4).
- **The section is a snapshot** (§15.4): a packet lists every working sound that should play, and an absent section means none. A loop whose id a packet does not list fades out over 0.3 s, and so do all loops when the view request turns audio off.
- **Staleness.** Packets that do not arrive change nothing, but when none has arrived for 0.5 s (catch-up, fast-forward, a hidden page), the audio module fades every loop out. A new state generation resets all audio state (§3.4).
- **A loop whose sample is not loaded yet** starts at a random offset when it arrives, from the then-current snapshot; it never plays the past.

**The music feed** is part of `HUD` (§15.5): the Literature year picks the era, activity gates layers, the doubling time drives the takeoff's tempo, and `loop_closed` and `victory` are events (A4 §5). The conductor reads it once a second.
- **Activity is normalised by the audio module** (codex B2-r1 finding 6). `HUD` carries the electric consumption P (W, the mean over 60 s); the conductor uses a = clamp(0.5 + 0.25 · log₁₀(P ÷ P_era), 0, 1), smoothed by an exponential average with a 120-s time constant.
  - P_era is the era's typical consumption, a table in `sounds.yaml` (data, so it can be tuned): Era I 1 MW, Era II 10 MW, Era III 100 MW, Era IV 1 GW, takeoff 3 GW.
  - So a factory at its era's typical draw sits at 0.5, at a hundredth of it at 0, and at a hundred times it at 1.
  - This implements A4 §5.1 rule 5 (consumption log-scaled against the era's typical value, smoothed over minutes) on the main thread rather than in the simulation: it is presentation only and never feeds back. Playtests tune the table.

### 15.7 World-to-screen projection and the sprite manifest

*Revised by WP B2: one placement formula in device pixels, an explicit index table for every part of every set, the lookup contracts of every namespace, and manifest version 2 for the streamed, block-compressed atlases of §9.2 and §9.7 (codex B1-r1 finding 14; B2-r1 findings 1 and 10).*

**Projection, in device pixels.** World x points east and y south, in tiles (1 tile = 1 m, A3). Let the camera be at (cx, cy) in tiles with zoom z, and let dpr be the canvas's device pixel ratio (§6.10: `devicePixelRatio` capped at 2, times the render-resolution setting). Then:

```
S        = PX_PER_TILE · z · dpr                 device pixels per tile
screen_x = (x − cx) · S                          device pixels right of the canvas centre
screen_y = (y − cy) · S − HEIGHT_SCALE · h · S   device pixels below it; h = height above the ground in tiles
```

**Placing a sprite frame.** Sprites are pre-rendered in this projection (§9.1's camera), so the renderer only places them. A frame is `[array, layer, x, y, w, h, ax, ay]` in its array's level-0 pixels, and the array has P = `pxPerTile` (the manifest, below). For an entity whose ground anchor (its footprint centre, from `x2, y2`) is at (ex, ey):

```
k      = S ÷ P                                   device pixels per source pixel, whatever level is sampled
left   = (ex − cx) · S − ax · k                   the quad's top-left corner, device pixels from the canvas centre
top    = (ey − cy) · S − ay · k
size   = (w · k, h · k)
uv     = (x, y, w, h) ÷ the array's page size at level 0
```

- Every quantity is in device pixels, so the formula is the same at dpr 1 and 2. The camera, not each sprite, is rounded to whole device pixels, so a still scene does not shimmer.
- Positions are subtracted from the camera in `f64` and stored in vertices as `f32` (§6.3), so precision does not depend on the distance from the origin.
- **Icons** are drawn centred at a size given in tiles (`BELT_ITEM_SIZE` on belts), so for the icon array P is the icon's level-0 size, 64 px, per icon rather than per tile.
- **Levels.** A colour page's level 0 is needed when k > 0.5 (more than one source pixel per device pixel at High: zoom × dpr > 1); otherwise level 1, the Normal page, is enough (§9.7). The renderer requests level 0 for the pages it draws with k > 0.5.
- **Fixtures:** `test/fixtures/projection/*.json` hold the expected quads of a calibration sprite (the unit cube of §9.1) at (z, dpr) = (1, 1), (1, 2), (0.5, 1), (3, 1) and (2, 2), at positions with negative and large coordinates. A Vitest test checks `projection.ts` against them, and the gallery screenshots (§9.5) check the result at dpr 1 and 2.

**Sets, parts and axes** (codex B2-r1 finding 1). The manifest gives every set an explicit index table, so no package computes a frame id by a convention of its own.
- A set has a `kind`, which names its drawing program (below), and named **parts**. A part has:
  - `axes`, an ordered list of axis names from the vocabulary below, and `shape`, the size of each axis;
  - `map`, for each axis whose packet value is not already an index, the table from value to index;
  - `table`, one entry per combination of axis indices, flattened row-major over `axes` (the last axis varies fastest). An entry is the list of frame ids drawn together, in order: usually one frame, several for a base cut into pieces (§9.1). An impossible combination holds an empty list; the renderer then draws the greybox and logs once.
- **One generated function** flattens the indices, in TypeScript for the renderer and in Python for the asset build's contact sheets and checks; nothing else does. The table is complete, so a set may share frames between combinations (all 16 directions of a symmetric machine name the same frame) with no rule on the renderer's side.
- **The axis vocabulary** is closed: a generated enum, versioned by `axesVersion`, shared by the asset build and the renderer.

| Axis | Value from the packet | Index |
|---|---|---|
| `dir` | `EntityView.dir`, `DYN.dir`, `HANDS.dir`: `Direction` 0–15, as Factorio 2.0's (north 0, east 4, south 8, west 12; §4.2) | `map.dir[value]`, 16 entries. A symmetric machine maps all 16 to 0; the steam engine maps 0 and 8 to 0 and 4 and 12 to 1; a four-way set maps 0, 4, 8 and 12 and holds empty entries elsewhere; rails and signals use all 16 |
| `mask` | `EntityView.variant`: the connection mask of belts, pipes, walls and heat pipes, 0–255 | `map.mask[value]`, 256 entries |
| `shape` | the position hash (below) | `posHash(x, y) mod shape` |
| `stage` | `ObjectView.variant` of a tree: the leaf stages it has left, 4 (full) to 0 (bare) (§4.4, §5.9) | `map.stage[value]`, 5 entries |
| `band` | `CHUNK_RESOURCES.band`, 0–7 | the value |
| `light` | lamps: `DYN.light` > 0; signals and train stops: `EntityView.status`, whose codes for them arrive with M2 (§5.13) | `map.light[value]` |
| `orientation` | `MOVERS.orientation`, in turns from north, clockwise | round(orientation × shape ÷ 65,536) mod shape |
| `frame` | entities: `DYN.phase`; movers: the clip's clock (below) | floor(phase × shape ÷ 65,536), or the clip's rule |

- **Drawing programs** (a set's `kind`):
  - **`entity`.** While `DYN.state` is 1 (working), draw the part `base` and then every part in `layers` at its frame. Otherwise draw `idle` if the set has one, else the same as working, at the frame of the frozen `phase` (as in Factorio, a stopped machine freezes mid-motion). An entity without a `DYN` record draws `base` and each layer at frame 0. Then draw the part `light` into the light pass, scaled by `DYN.light`. The part `shadow` goes to the shadow pass; a set with an animated shadow (`animShadow`, §9.1) gives `shadow` a `frame` axis that follows the same phase.
  - **`inserter`.** The parts are `platform` [dir], `arm`, `hand_open` and `hand_closed`, each with its shadow.
    - Each of the last three carries `pivot`, in level-0 px of its frame; `arm` also carries `length`, the px between its pivot and its tip. The set carries `shoulder`, the shoulder's offset from the anchor in level-0 px.
    - With θ = `HANDS.theta` (turns from north, clockwise, as Factorio's orientation) and r = `HANDS.ext` in tiles: the shoulder point is Q = the anchor + `shoulder` · k, and the hand point is Hp = Q + r · S · (sin 2πθ, −cos 2πθ), with S the device pixels per tile above.
    - Ground positions map to the screen 1:1 in this projection, so the arm is drawn rotated by θ about its pivot placed at Q and stretched along its length to |Hp − Q|. The hand (`hand_closed` while `HANDS.held` is not `0xFFFF`, else `hand_open`) is drawn rotated by θ about its pivot placed at Hp, and the held item's icon at Hp.
  - **`object`:** trees [shape, stage] with shadows [shape]; rocks and other world objects [shape]. Decoratives, cliffs and town buildings are `object` sets too (their `shape` from the position hash, or 1 where the packet names the exact picture); greyboxes are `entity` sets.
  - **`resource`:** [shape, band].
  - **`mover`:** rolling stock, vehicles and turret heads [orientation: 64]; agents [orientation: 16, frame: 2]. The character has three parts, `idle` [orientation: 8, frame: 4], `run` [orientation: 8, frame: 16] and `mine` [orientation: 8, frame: 16], with shadows alike.
    - The clip is `mine` while `MOVERS.flags` bit 0 (mining) is set, `run` while the velocity is not zero, and otherwise `idle`.
    - `run` advances with distance: frame = floor(d ÷ `cycleTiles` × 16) mod 16, where d is the distance the renderer has integrated along the extrapolated path. `idle` and `mine`, and the agents' frames, advance with time at the part's `fps`, from the mover's `base_tick`.
  - **`icon`:** one frame; 32 and 16 px are its levels 1 and 2.
  - Terrain (§9.9) and smoke and particles (`fx/`) are the renderer's own.
- **Fixtures and versions.**
  - `test/fixtures/sprites/manifest.json` holds one set of every kind: the stone furnace with an idle image and a layer, a belt with masks, an inserter with pivots, the character with its three clips, a rail signal with lights, a tree with shape × stage, a resource with shape × band, a locomotive with 64 orientations, and the radar with an animated shadow. `cases.json` beside it lists packet-shaped inputs with the expected draws (part, frame ids, quads).
  - The renderer's Vitest suite and the asset build's Python checks both run the cases.
  - `sprites.json` carries `version` (2), `axesVersion` and the `prototypesHash` it was built against. The renderer refuses an unknown version or axis vocabulary; a different `prototypesHash` is an error in dev builds, and production builds pair the two by construction (§2.3).

**Lookup contracts.** Set names are `<namespace>/<name>`. The renderer builds dense `Int32Array` tables from `prototypes.json` (§15.2) and `sprites.json` at load, so drawing never looks up a string:

| Namespace | Drawn for | Key in the packet | Where the name comes from |
|---|---|---|---|
| `entity/` | entities, ghosts, inserter parts (`CHUNK_ENTITIES`, `DYN`, `HANDS`) | `proto` | the entity record's `sprite` in `prototypes.json` (engine overlay; default `entity/<name>`) |
| `greybox/` | an entity whose set is missing or not resident | `proto` | `greybox/<name>`, generated for every entity (§9.2) |
| `item/`, `fluid/` | icons: belt items, held items, ground items, alt-mode | `ItemKey` (`BELT_ITEMS`, `HANDS.held`, `ObjectView` kind 3), `EntityView.alt_icon` | the item or fluid record's `icon`; `alt_icon` indexes `prototypes.json`'s icon table |
| `object/` | trees (`ObjectView` kind 0), rocks and other world objects (kind 1) | kind 0: the tree species; kind 1: the world object id (`world.yaml`) | trees: the species table (engine overlay) in `prototypes.json`; others: the world object's `sprite` |
| `decor/` | decoratives (kind 4) | the decorative id | the decoratives table (engine overlay) in `prototypes.json` |
| `cliff/` | cliffs (kind 2; M2) | the cliff shape id | the cliff table (engine overlay) |
| `resource/` | resource tiles (`CHUNK_RESOURCES`) | `resource`; `band` picks the depletion stage | the resource record's `sprite` |
| `town/` | town buildings on town-block tiles | the building id and skin from the chunk's town features (§15.9) | the town tables (engine overlay) |
| `mover/` | characters, agents, rolling stock, vehicles (`MOVERS`) | `proto` and `kind` | the prototype record's `sprite` |
| `fx/` | smoke puffs and particles | fixed names | `src/render/style.ts` |

- A name without a set draws the entity's greybox, or the `fx/missing` icon for icons. The asset build fails if any data prototype lacks both a set and a greybox.
- **Shapes the packet does not carry** (a tree's, a rock's, a resource tile's, a decorative's) come from one position hash, so every peer draws the same picture:

  ```ts
  // x, y: the object's position in 1/256 tile (ObjectView) or its tile coordinates (resources), as i32
  function posHash(x: number, y: number): number {
    let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
    h ^= h >>> 15; h = Math.imul(h, 0x85ebca77); h ^= h >>> 13;
    return h >>> 0;                                   // shape index = posHash(x, y) % shape
  }
  ```

- **Late art keeps the current pose.** A page that arrives late (§9.7) is drawn at the frame, shape and stage the current packet selects, so nothing restarts or jumps.

**Named constants.** Format constants live in `src/render/projection.ts`, style constants in `src/render/style.ts`. The art direction sets the style constants (IMPL-5) without changing any format; §9.8 is the code that uses them.

| Constant | Value | Kind | Source |
|---|---|---|---|
| `PX_PER_TILE` | 32 (CSS px at zoom 1) | format | I §3.15 |
| `ZOOM_MAX`, `ZOOM_MIN_WORLD`, `ZOOM_MIN_CHART` | 3, ≈ 0.3, 1/64 | format | §6.10 |
| `SOURCE_PX_PER_TILE` | colour 64 at level 0 (High), 32 at level 1 (Normal); shadows 32; lights 16 | format | §9.2 |
| `HEIGHT_SCALE` | 1 (heights render 1:1) | format | §9.1 calibration |
| `CULL_MARGIN_TILES` | 6 | format | §6.6 |
| `SHADOW_REACH` | 1.43 × height east, 0.39 × height south | style (culling) | A3 §2 |
| `AMBIENT_FLOOR` | 0.15 | style | §5.7 |
| `SHADOW_COMPOSITE` | *Survey*: hatching at −45°, period 7/64 tile, line 1.7/64 tile, 55% ink, plus 6% darkening; band-limited below 3 device px per period | style | A3 §4.2, §9.8 |
| `LIGHT_COMPOSITE_DAY` | *Survey*: a warm stain, `colour × (1 − 0.6 · a · (1 − hue))` | style | A3 §4.3, §9.8 |
| `NIGHT_GRADE` | *Survey*: the cyanotype LUT and the light's reveal, blended by n = (1 − daylight) ÷ (1 − `AMBIENT_FLOOR`) | style | A3 §4.4, §9.8 |
| `INK_COLOUR`, `CYANOTYPE_DEEP`, `CYANOTYPE_PALE` | `#2b2723`, `#13304f`, `#d6e4ec` | style | A3 §3.1, §4.4 |
| `BELT_ITEM_SIZE` | 0.5 tile | style | A3 §2 |
| `CLEAR_COLOUR`, `PAPER_TONE` | the paper colour, `#ece3cb` | style | A3 §3.1 |

**The sprite manifest** (`public/atlases/sprites.json`), written by the asset build (§9.2) and checked against a JSON schema in that build:

```jsonc
{
  "version": 2,
  "style": "survey-1",                                         // informational
  "arrays": [                                                  // a frame's first field indexes this list
    { "kind": "colour", "pxPerTile": 64, "pageSize": 2048, "levels": 4, "codec": "xubc7" },
    { "kind": "shadow", "pxPerTile": 32, "pageSize": 1024, "levels": 3, "codec": "etc1s" },
    { "kind": "light",  "pxPerTile": 16, "pageSize": 512,  "levels": 2, "codec": "xubc7" },
    { "kind": "icon",   "pxPerTile": 64, "pageSize": 1024, "levels": 3, "codec": "xubc7" }   // 64 px per icon at level 0
  ],
  "pages": [                                                   // per array, in layer order
    [ { "group": "core",                                       // §9.7's atlas groups
        "files": ["atlases/colour-core-0.3f2a9c1e.h.ktx2",    // level 0
                  "atlases/colour-core-0.9be04d17.n.ktx2"],   // levels 1 to levels − 1
        "bytes": [1021000, 451000] } ],
    [], [], []                                                 // shadow, light, icon pages: one file each
  ],
  "frames": [                                                  // [array, layer, x, y, w, h, ax, ay], level-0 px
    [0, 0, 40, 40, 160, 96, 80, 136], [0, 0, 40, 176, 160, 40, 80, 0],     // the furnace's F₀ pieces above and below R,
    [0, 0, 40, 136, 40, 40, 80, 40], [0, 0, 160, 136, 40, 40, -40, 40]     // left and right of it: all in F₀'s one cell
    /* … 48 frames in all */ ],
  "sets": {
    "entity/stone-furnace": {
      "kind": "entity", "group": "core", "size": [2, 2],
      "parts": {
        "base":   { "axes": ["dir"], "shape": [1], "map": { "dir": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
                    "table": [[0, 1, 2, 3]] },                   // frame 0 minus the layer's rectangle: four pieces (§9.1)
        "layers": [ { "axes": ["dir", "frame"], "shape": [1, 16], "map": { "dir": "same as base" },
                      "table": [[4], [5], [6], [7], [8], [9], [10], [11], [12], [13], [14], [15], [16], [17], [18], [19]] } ],
        "idle":   { "axes": ["dir"], "shape": [1], "map": { "dir": "same as base" }, "table": [[20]] },   // optional (A3 §8)
        "shadow": { "axes": ["dir"], "shape": [1], "map": { "dir": "same as base" }, "table": [[21]] },
        "light":  { "axes": ["dir"], "shape": [1], "map": { "dir": "same as base" }, "table": [[22]] }
      }
    },
    "object/tree-oak": {
      "kind": "object", "group": "core",
      "parts": { "base":   { "axes": ["shape", "stage"], "shape": [4, 5], "map": { "stage": [0, 1, 2, 3, 4] }, "table": [[23], "… 20 entries"] },
                 "shadow": { "axes": ["shape"], "shape": [4], "table": [[43], [44], [45], [46]] } }
    },
    "item/iron-plate": { "kind": "icon", "group": "core", "parts": { "icon": { "axes": [], "shape": [], "table": [[47]] } } }
  },
  "dom": { "icons": { "core": ["sheets/icons-core-32.1a2b3c4d.webp", "sheets/icons-core-64.5e6f7a8b.webp"] },
           "tech":  { "memo": "sheets/tech-memo.0c1d2e3f.webp" } }
}
```

(In the file, `"same as base"` is the written-out table, and the elided frames and table entries are all present: the manifest has no references or elisions.)

- **Cells** (§9.2): every frame lies in its own cell of the atlas page, at a position and a size that are multiples of 32 px at level 0, with an 8-px gutter filled with the source's real neighbouring pixels (transparent around a trimmed sprite). So each 4×4 compression block, down to level 3, belongs to one cell, and filtering across the cuts between a base's pieces and a layer reads real pixels (codex B2-r1 finding 10).
- `files` and `bytes` let the asset worker fetch and prioritise by group and level (§9.7). Only colour pages split level 0 into its own file; the other arrays have one file per page. The GPU format is not in the manifest: the asset worker chooses it at run time from `codec` and the WebGL extensions (§9.2).
- `codec` is `xubc7`, `etc1s` or `rgba8`. The last is an uncompressed KTX2 that needs no transcoder; the golden set's tiny atlas (§15.10) uses it, so the renderer can be built before the asset pipeline exists.
- Version 1's `resolutions` (separate High and Normal page lists and frame tables) is gone, because Normal is level 1 of the same page. Version 1's `first`/`count` parts and their index formula are gone: every part has its explicit `table`.

### 15.8 The WebAssembly ABI

`sim.wasm` exports plain C-ABI functions (no wasm-bindgen; A1 showed it is enough) and one linear memory, named **`memory`**; the shell uses nothing else the module exports. Pointers and lengths are `u32` (read with `>>> 0` in JavaScript); no export takes or returns `i64`, so no BigInt crosses the boundary. Calls are never re-entrant.

**One calling convention** (B1-r1 5). This table is normative; the generator emits the Rust signatures and the shell's typed wrappers from `schema/abi.yaml`, which holds it.
- **Inputs.** The shell gets the input buffer from `sim_input(len)`, writes the request there and passes its length to the export that reads it. The buffer stays valid until the next call into the module.
- **Status exports** return a `u32` status (below): 0 OK, otherwise an error whose code and message `sim_last_error` gives.
- **Envelope exports** return 0 on failure, again with the error from `sim_last_error`, or an 8-byte-aligned pointer to an **envelope** `{u32 len, bytes[len]}` in the output arena. The envelope stays valid until the next call into the module other than `sim_memory_epoch` and `sim_last_error`.
- **Declared exceptions:** `sim_abi_version` and `sim_memory_epoch` return plain values; `sim_input` returns a bare pointer to the input buffer (0 if memory cannot grow); `sim_last_error` returns an envelope in its own small buffer (`u32 code`, then a UTF-8 message), valid until the next failing call.
- **Memory.** `sim_memory_epoch` and `sim_last_error` never move memory. Any other call may grow it, so the shell compares the epoch after each call and reacquires its views (§3.6).

| Export | Input buffer | Result |
|---|---|---|
| `sim_abi_version() -> u32` | — | the ABI version, bumped on any change to this table |
| `sim_schema_hash() -> ptr` | — | envelope: the 32-byte schema hash (§15.1) |
| `sim_input(len) -> ptr` | — | the input buffer, at least `len` bytes (a declared exception) |
| `sim_init(len) -> status` | `init`: `u32 protos_len`, `prototypes.bin`, `u32 flags` (as `sim_set_flags`), `u32 reserved` | loads `Protos` and installs the panic hook |
| `sim_new_world(len) -> status` | one `new_world` record | creates the world at tick 0 with lineage r₀ (§4.8) |
| `sim_load(len) -> status` | `load`: sections, remap tables and lineage (below) | loads a save or checkpoint (§8.1, §8.3) |
| `sim_tick(len) -> status` | the closure of tick `world.tick + 1` (§15.3) | runs exactly one tick |
| `sim_set_flags(flags: u32) -> status` | — | bit 0 `NO_SLEEP` (tests), bit 1 `HISTORICAL` (event marking), bit 2 `PROFILE` (dev builds); other bits `ERR_INPUT` |
| `sim_blob_put(len) -> status` | `u8 sha256[32]`, then the blob's bytes | holds the blob for the next tick only (§15.3) |
| `sim_supply_chunk(len) -> status` | one `ChunkData` record (§15.9) | ignored unless it answers a pending request |
| `sim_pending_chunks() -> ptr` | — | envelope: `u32 count`, then the `ChunkRequest` records issued since the last call; after `sim_load`, every pending request of the save (§5.18) |
| `sim_extract(len) -> ptr` | a view request (§15.4) | envelope: one **complete packet**, header included (§15.4) |
| `sim_subscribe(len) -> status` | `u16 count`, then subscription requests (§15.5) | adds or replaces them |
| `sim_unsubscribe(len) -> status` | `u16 count`, then `u32` ids | drops them; unknown ids are ignored |
| `sim_query(len) -> status` | `u32 id`, then a query (§15.5) | starts it; `ERR_LIMIT` with 4 running |
| `sim_query_step(units: u32) -> ptr` | — | envelope: `u32 count`, then per finished query `u32 id, u8 ok, u8 flags` (bit 0 `TRUNCATED`), `u16 reserved, u32 first_tick, u32 last_tick, u32 len`, then its result record padded to 4 |
| `sim_query_cancel(id: u32) -> status` | — | drops the query; an unknown id is ignored |
| `sim_digest() -> ptr` | — | envelope: `u32 tick`, then `d` and `r` as two `u32` pairs (low word first) |
| `sim_state_hash() -> ptr` | — | envelope: the full state hash and each section's (below) |
| `sim_save(len) -> ptr` | `u32 flags`: bit 0 `BAKE` (write every pristine chunk as modified, §4.4) | envelope: the sections at the current tick boundary and the lineage the save carries (below) |
| `sim_meta() -> ptr` | — | envelope: one `sim_meta` record (below) |
| `sim_load_report() -> ptr` | — | envelope: one `load_report` record (below); `ERR_ORDER` unless the last world call was `sim_load` |
| `sim_last_error() -> ptr` | — | the error envelope (a declared exception) |
| `sim_memory_epoch() -> u32` | — | increments whenever an exported column, the arena or the input buffer moves (§3.6) |
| `sim_pool_dir() -> ptr` | — | envelope: the generated pool directory for the read views, `(u32 column, u32 ptr, u32 len)` triples |
| `sim_allocs() -> ptr` | — | envelope: the counting allocator's totals (§2.5); `ERR_ORDER` without `simcheck` |

**Records crossing the ABI** (all little-endian; "record encoding" is §8.1's field-id encoding, generated from the schema):
- **`sim_init` input:** `u32 protos_len`, the bytes of `prototypes.bin`, then `u32 flags` (as `sim_set_flags`) and `u32 reserved`.
- **`sim_new_world` input:** one `new_world` record (record encoding): seed, map settings, game settings and presets, as the New game screen (07 §17) sets them.
- **`sim_load` input:** `u32 section_count`, then each section in the container's framing (§8.1) with codec 0 and `storedLength = rawLength`; then the remap tables, `u16 kind_count` and per kind `u16 kind, u32 count`, `count` × `u16 new_id` (`0xFFFF` = removed), or `kind_count = 0` when the prototypes hash matches; then the lineage, `u32 r_lo, u32 r_hi`.
- **`sim_save` output:** `u32 section_count`, then each section in the container's framing with codec 0; then `u32 r_lo, u32 r_hi`, the lineage the save carries (r at the tick, or a baked save's new lineage). The IO worker compresses each section and rewrites its codec and stored length.
- **`sim_meta` output:** one `sim_meta` record (record encoding): tick, seed, `last_system_seq`, the worldgen version, the digest lineage r, and per player its index, online flag, `last_seq` and input generation.
- **`sim_load_report` output:** one `load_report` record (record encoding): whether the load started a new digest lineage and, if so, the new r (§4.8, §8.3); then the removed prototypes (the "removed" entries of the remap tables that the save used) as a list of `(u16 kind, str name, u32 count)`, ascending by kind and name.
- **`sim_state_hash` output:** `u32 hash_lo, u32 hash_hi, u32 count`, then `count` × (`u32 section_id, u32 hash_lo, u32 hash_hi`).

**Status codes:** 0 OK; 1 `ERR_FRAMING`; 2 `ERR_BLOB_MISSING`; 3 `ERR_LOAD_FORMAT` (corrupt, or a newer format); 4 `ERR_LOAD_SCHEMA` (a section the schema cannot read); 5 `ERR_PROTOS`; 6 `ERR_ORDER` (a call out of order, e.g. `sim_tick` before a world exists); 7 `ERR_INPUT` (a malformed request record); 8 `ERR_LIMIT` (a limit of §15.5); 9 `ERR_WORLDGEN` (a save from another worldgen version that was not baked, §8.3). A trap is not a status: it ends the instance (§3.6).

**Imports** (module `env`): `host_log(level, ptr, len)`; `host_panic(ptr, len)`, called by the panic hook before the abort; `host_now() -> f64`, milliseconds, visible only to the profiling module (D13). Only `host_now` returns a value, and nothing that state depends on can see it (D15).

**Call order:** `sim_init`, then `sim_new_world` or `sim_load` (and after a load, `sim_load_report`), then per tick: any `sim_blob_put` and `sim_supply_chunk`, `sim_tick`, `sim_pending_chunks`, and optionally `sim_extract`. Subscriptions, query calls, `sim_save`, `sim_digest` and `sim_state_hash` are allowed between ticks; `sim_extract` and the query calls also while no tick runs (§3.3). A call out of this order fails with `ERR_ORDER`.

### 15.9 The worldgen contract

`gen.wasm` exports `memory`, `gen_abi_version`, `gen_schema_hash`, `gen_input`, `gen_last_error`, `gen_init(len) -> ptr`, `gen_chunk(surface, cx, cy) -> ptr`, `gen_chart(surface, cx, cy) -> ptr` (a pristine chunk's 32 × 32 chart image in `CHART`'s record format, §5.19) and `gen_preview(len) -> ptr` (the map preview's colours, §5.18), with §15.8's calling convention, and `schema/abi.yaml` lists them too. It imports `host_log` and `host_panic`. Its generated types come from the `schema` crate, as the sim's do.

- **`gen_init` input:** `u32 protos_len`, the bytes of `prototypes.bin`, then one `new_world` record (the same as `sim_new_world`'s). Output: `u32 world_hash_lo, u32 world_hash_hi`, the XXH64 of the seed, the map settings and `prototypes.bin`; the sim computes the same value at `sim_new_world` and `sim_load`.
- **`ChunkRequest`** (16 bytes): `u16 surface, u16 reserved, i32 cx, i32 cy, u32 commit_tick`.
- **`ChunkData`** is a schema record (the `schema` crate's `chunk_data`): the world hash, the chunk key and surface, `u8 tiles[1024]`, the climate values (θ, sunlight), and lists of resources (tile index, resource, amount), trees (position, species, leaf stage, variant), world objects, cliffs and town features, plus the decorative seed. The sim's own inline generation produces the same record, so `sim_supply_chunk` and inline commits share one path.
- The pool belongs to one sim worker (§3.1). The shell sends each request to a worker (round-robin), passes the answer to `sim_supply_chunk`, and forgets requests whose commit tick has passed. `sim_supply_chunk` ignores an answer whose world hash is not its own, and a late answer: the sim has already generated the chunk inline at its commit tick (§5.18, D12).

### 15.10 Fixtures, the fake sim and the golden integration set

So that the renderer, UI, audio and shell can be built before the sim, and the sim against known answers:
- **The fake sim worker** (`src/simworker/fake.ts`, delivered with the schema) speaks the protocol of §3.2 and writes packets with the generated encoders: generated terrain, a grid of chests and machines with animated `DYN` records, belts with moving items as gap arrays, inserter hands, a walking character driven by `act` messages, events, `AUDIO_WORKING` aggregates, and the `CHARACTER`, `INVENTORY`, `HUD` (with the music feed), `STATS` and `DEBUG` projections (B1-r1 21), so the renderer, the UI and audio can all be built against it. It follows the replacement protocol (an unsolicited `FULL` packet after `bound`, state generations; §3.4) and gives the explicit errors of the capability manifest (§2.4). `?sim=fake` keeps it available after integration.
- **Codec fixtures** (§15.1), generated and hand-written, pin both languages' codecs, including the `new_world`, `sim_meta`, `load_report`, `ChunkData` and view-request records and every ABI envelope (§15.8).
- **The M0 golden integration set** (`test/golden/m0/`; B1-r1 1, 21) is frozen by the contract gate before any parallel package starts (§12):
  - the M0 prototype set: its `prototypes.bin` and `prototypes.json`;
  - a **start save** written with the generated TypeScript section writers: a bounded map of 3 × 3 chunks around the origin (map size, 07 §17), so it has negative chunk coordinates, with its tiles, a pond and a resource patch stored as modified chunks, a chest and one player, so no worldgen runs;
  - a **closure log** of 600 ticks (§8.5) with every M0 action, a refusal of each M0 reason, a malformed and an `unsupported` action, a fenced held input, a `player_left` and a return, and a blob;
  - the **expected per-tick digests**, and the expected canonical state at ticks 1, 2, 300 and 600;
  - the **expected packets** for a fixed view request at ticks 0, 1 and 600, with every M0 section, and the expected record of every M0 projection and query;
  - a **tiny atlas** of placeholder images: a version-2 sprite manifest with `codec: rgba8` pages (uncompressed KTX2, §15.7), so the renderer draws the expected packets before any art, transcoder or asset pipeline exists. It is §15.7's fixture manifest, one set of every kind with explicit index tables, and its `cases.json`;
  - **negative cases**: truncated and trailing closure logs and saves, a closure that fails each preflight check, a malformed record for every ABI input, a save from another worldgen version, a module with a stale schema hash.

  The expected states, digests, packets and records come from a small **TypeScript reference model** of M0's rules (walking and collision, the chest, hand mining, the inventory transfers, hand crafting, the system actions, the canonical allocator) written from the spec and run on the generated writers and XXH64. The model exists only for this; its outputs are reviewed with the fixtures. The real sim must reproduce them bit for bit, natively and in WebAssembly. A disagreement is settled by the spec, and a change to the frozen set reopens the gate for the packages it touches.
- **Packet fixtures** (`test/fixtures/packets/*.bin`), recorded from the real sim for later milestones' sections, pin the decoders beyond the golden set.

### 15.11 Ownership and tests

Owners are M0's work packages, named by role (the manager assigns ids). *Schema* is the scaffold, schema, generator, data stage, fake sim and golden set package that comes first; the others start once its **contract gate** has passed (§12; B1-r1 1). The gate's parts are the schema's complete M0 layouts (§15.1, including `abi.yaml` and the `prototypes.json` layout), the generated code in both languages, the reviewed codec fixtures, the fake sim with `STATS`, the M0 capability manifest (§2.4) and the frozen golden integration set (§15.10). Each other package's first deliverable is to pass the golden set from its side.

| Contract | Owner | Consumers | Pinned by |
|---|---|---|---|
| The contract gate and the golden integration set (§12, §15.10) | schema | every M0 package | an independent review before the gate closes; each package's golden run in `ci` |
| §2.4 capability manifest | schema (format, M0 entries) | every package | the data stage's closure check; Vitest and cargo tests that every excluded action, projection and query fails explicitly |
| §15.1 schema and generator | schema | everyone | `schema-gen --check`; the hash handshake; the hash-mutation test; generated and hand-written codec fixtures |
| §15.2 prototype data path | schema | sim, UI, renderer | the data stage's double run (D14); the expression cross-check; `Protos::load` on the committed data |
| §15.3 actions and closures | schema (formats, the admission function), sim (preflight and field validation, references, fencing; the `TestSequencer`), shell (sequencer) | UI (encoder), net (MP) | D18(g) codec probes at every limit; R23–R27; fuzzed closures that must never trap; the admission fixture shared by every sequencer |
| §15.4 render packet | sim (writers), renderer (decoder) | renderer, audio | the golden set's packets; mirror equivalence (§10.4 #16); a Vitest round trip; the renderer's gallery screenshots |
| §15.5 projections and subscriptions | sim (writers, limits, query steps), shell (generations, query scheduling), UI (decoders) | UI | Vitest: subscription, replacement, gone, stale generation, limits, cancellation; continuation equivalence (§10.4 #13) |
| §15.6 events and audio | sim (writers, the `EventSink`), shell (historical flag), audio (consumer) | UI, audio | a scenario that asserts events for build, mine, craft and failure; a catch-up test that asserts no sound is scheduled; the audio page's budget (§9.4) |
| §15.7 projection and manifest | renderer (projection, lookup tables), assets (manifest version 2, `dirIndex`) | renderer | the projection fixtures at dpr 1 and 2 (§15.7); the calibration render (§9.1); the manifest's JSON schema in the asset build; the golden set's `rgba8` atlas (§15.10) |
| §15.8 ABI | schema (`abi.yaml`), sim (`simabi`), shell | shell | generated signatures and wrappers; Vitest against a dev build; trap and memory-growth tests (§3.6); the golden set's negative inputs |
| §15.9 worldgen | sim (`worldgen`, `genabi`), shell | sim | D12 (no pool, 1 and 4 workers: same hashes) |
| §3.2 worker messages | shell | UI, renderer, audio, IO | Vitest with the fake and the real worker |

---

## Appendix A — Measurements on this host (2026-10-19 and 2026-10-20)

The scripts are kept in the repository (N11):
- `design/round4/arch-data/bench/glbench/bench.mjs`, `bench2.mjs` and `bench3.mjs` (WebGL2);
- `design/round4/arch-data/bench/simbench/bench.mjs` (sim loops);
- `design/round4/arch-data/bench/pwff/ff.mjs` and `ff2.mjs` (Firefox against Chrome);
- `design/round2/A-stack-test/` (the toolchain smoke project).

M0 moves the benchmarks into `game/bench/`.

**WebGL2 in headless Chrome 156** (ANGLE / Vulkan / SwiftShader), 1280×720, one texture array, alpha blending, 5 frames averaged with `readPixels` sync:

| Sprites × on-screen size | Instanced (vertex divisor) | Expanded quads + index buffer |
|---|---|---|
| 5,000 × 32 px | 116–130 ms | 28–30 ms |
| 20,000 × 32 px | 378–382 ms | 69–79 ms |
| 20,000 × 8 px | — | 15 ms |
| 60,000 × 16 px | 1,145 ms | — |
| 150,000 × 8 px | 2,932–3,101 ms | 102–105 ms |

- The ANGLE flags `--use-angle=swiftshader` and `swiftshader-webgl` made no difference.
- CPU fill of 100k sprites × 8 floats: 1.2 ms.

**Simulation loops in Node 24** (round 4, TypeScript; simplified, SoA typed arrays; per entity per tick):

| Loop | Cost |
|---|---|
| Transport lines (40k lines, gap-encoded) | 6.6 ns |
| Inserters (15k active of 30k) | 14.6 ns |
| Crafting machines (10k) | 11.6 ns |
| Electric consumers (60k, 2 passes, 2 classes) | 8.1 ns |
| Thermal field chunk update | 43 ns |

**Cross-engine floating point** (Firefox 157 and Chrome 156, headless on this host, 16,000 samples of `sin`, `cos`, `exp`, `log`, `pow`, `atan2`, `tanh` and `cbrt` over 2,000 arguments): 492 results differ. By function: `exp` 179, `cbrt` 157, `sin` 61, `cos` 53, `log` 35, `atan2` 7. This is the evidence behind §4.1's ban. Firefox 157 launches here but reports no WebGL2 in headless mode.

**Toolchain smoke test.**
- It was run first with the latest releases, then again with the exact pins of §2.1.
- TS 7.0.2 checks a four-way split config (sim, worker, app, ui).
- Vite 8.3.2 builds a module worker and a Solid page.
- Vitest 5.0.3 runs tests in a `node`-environment config. Under the Solid plugin it switches to jsdom and fails without jsdom installed, which confirms the separate config.
- Biome 2.5.15 lints.
- Solid 1.9.15 with vite-plugin-solid 2.11.14 builds and type-checks.
- oxc-parser 0.153.0 detects banned APIs.
- fast-check 4.10.2, zod 4.6.5, fflate 0.8.3, fake-indexeddb 6.2.5 and simplex-noise 4.0.3 run.
- maxrects-packer 2.7.4 runs through its `.mjs` path only.

Combining `dom` and `webworker` libs in one tsconfig fails, which confirms the per-layer configs.

**The engine study (WP A1, 2026-10-20).** `design/engine-study/`; the full tables are in `pm/reports/A1.md`. Equivalent TypeScript and Rust kernels (transport lines, inserters, crafting machines, labs and drills, electric networks, bitset active sets, watch lists, the timer wheel, the state hash, render extraction) produce bit-identical state hashes. All runs pinned to socket 0 at the 2.6 GHz base clock (turbo runs excluded from absolute numbers); 6,000 warm-up ticks, 3,600 timed ticks, 3 repetitions, implementations interleaved.

| Scale / regime (ms per tick) | Chrome TS | Chrome WASM | Firefox TS | Firefox WASM | Node TS | Node WASM | Native |
|---|---|---|---|---|---|---|---|
| Mid, busy | 0.580 | 0.356 | 0.664 | 0.416 | 0.617 | 0.354 | 0.288 |
| Mid, typical | 0.433 | 0.277 | 0.485 | 0.323 | 0.451 | 0.273 | 0.220 |
| Late, busy | 2.097 | 1.263 | 2.340 | 1.460 | 2.144 | 1.256 | 1.024 |
| Late, typical | 1.506 | 0.960 | 1.705 | 1.125 | 1.620 | 0.958 | 0.780 |
| Mega (400k), busy | | | | | 5.95 | 3.46 | 3.00 |

- TypeScript ÷ WebAssembly, paired: Chrome 1.37–1.66, Firefox 1.35–1.60, Node 1.40–1.74. WebAssembly ÷ native: 1.15–1.34. `simd128`: within ±1% (not used).
- Per active entity, Chrome, Late busy, WebAssembly: transport lines 28 ns, inserters 72 ns, crafting machines 22 ns, electric consumers 8.5 ns (two passes). Active shares, typical regime: lines 25%, inserters 20%, machines 65%.
- p99 about 1.1–1.2× the mean in every engine; zero GC events in the tick. TypeScript only: a V8 deoptimisation storm (3,351 deopts in 3,600 ticks until fixed) and an 18–22 ms Firefox stall; first tick after loading a Late save 11–13 ms in TypeScript against 3–6 ms in WebAssembly.
- Extraction at 1920×1080: about 19 ns per sprite in WebAssembly (40 ns in TypeScript) plus 1.7 ns to copy out of linear memory; a worker → main → worker round trip with a transferable buffer costs 0.20–0.27 ms at any size up to 260 kB. UI queries against a worker paced at 60 UPS: p50 0.45–0.73 ms, p99 2.7–3.4 ms (Chrome, Late).
- Determinism: one state hash per case across 27 runs (Node, Chrome, Firefox × TS, WASM, WASM-SIMD) and native; NO_SLEEP equivalence at Mid for 12,000 ticks and at Late. Swap-remove active lists diverged by tick 200 in three of four regimes.
- Start-up: `compileStreaming` 4.7 ms (Chrome) and 8.9 ms (Firefox) for a 70.7 kB module (21.8 kB brotli). Build times for a 49.8k-line crate: `cargo check` 1.0 s incremental; native test build 1.2 s; `wasmdev` 2.9 s; release 38 s plus 28.5 s for wasm-opt.
- Threads: a blocking barrier round costs 85–125 µs; the parallelisable phases are 25–35% of the tick. Verdict: one sim thread.
- Host factor: reference ≈ host ÷ 2.4 at the base clock.

**The `libm` probe (WP B1, 2026-10-20).** A crate depending only on `libm` 0.2.16 hashes the bit patterns of `sin`, `cos`, `exp`, `log`, `pow`, `atan2`, `exp2`, `log2`, `cbrt` and `tanh` over 10⁶ xorshift arguments each (ranges up to ±700 for `exp`, 10⁻⁶–10⁶ for the logarithms). Built with the release profile, the ten hashes are identical natively (x86-64), in Node 24, Chrome 156 and Firefox 157, both from cargo's raw output and after `wasm-opt -O3`. The module's features, by `wasm-opt --print-features`: mutable globals, non-trapping float-to-int, bulk memory (and its `-opt` variant), sign extension, reference types, multi-value and overlong call-indirect, with no SIMD or threads. The clippy bans of §4.1 were checked to fire on a test crate.

## Appendix B — Interfaces with other specs (who supplies what)

| Engine module | Consumes | Owner and section |
|---|---|---|
| Data stage, every system | Items, recipes, entities, technologies, resources, enemies, tiles, world objects; `meta` (tiers, categories, start inventory and salvage, `meta.quality`, `meta.heat`, `meta.staffing`, `meta.world`, `meta.runaways`, settings, effects); the expression grammar | R4-data (`spec/data`, `SCHEMA.md`, 02, 05); the meta blocks' rules in 01 §13 and 03 |
| Data stage: text | Loading tips, tips and tricks, milestones, town-name lists, achievements with machine-readable conditions, `world_text` (`text.yaml`); the UI's status, alert and log strings come from 08 into `game/locale/en.yaml` | R4-ui (07, 08, `text.yaml`) |
| §2.4, §12 build filters | The slice manifest | R4-ui (09 §2.7); the later filters are this document's (§12) |
| §4.4 trimmed collision | The rule | this document (assigned by 07-ui §16) |
| §4.4, §5.18 tiles and world objects | Tile κ, buildability, walking speed, map colours; trees, rocks, town buildings, campus, landmarks; the salvage | R4-data (`tiles.yaml`, `world.yaml`, `meta.start.salvage`); rules in 01 §2, §5, §9 (R4-world) |
| §5.5 machines, halls, staff slot, product rules | Productivity eligibility; hall tiers, slots and recipe; the Researcher (01 §8.6); `amounts_by_j` (03 §2.1); model collapse (03 §2.2) | R4-data (02), R4-world (01, 03, 04) |
| §5.6 archives, exchanges, Endpoint | Taps, yield, floor and closing (01 §7); the Endpoint (03 §2.4) | R4-world (01, 03), R4-data (resources, entities) |
| §5.7 energy | Fuel and burner ×3, generator emission, waste heat, the allocation order, the compute energy effects | R4-world (03 §1.1, §1.4; 04 §3), R4-data (entities, effects) |
| §5.9 thermal | Emission, field, classes, coolant, guards, *Heat: off*, edges (03 §1); the golden script `tools/ref/heat_calib3.py` | R4-world (03) |
| §5.10 staffing | T(W), coverage, demand, networks, the Terminal, states (01 §8) | R4-world (01), R4-data (`terminal`) |
| §5.11 world text | W, Y_pub, j and σ, model collapse (01 §12, 03 §2.2); the doubling-time readout (04 §9) | R4-world (01, 03, 04) |
| §5.12 research, M4 | Generation costs, Π, r presets, the scheduling rule and `meta.endgame.takeoff_order`, the hidden *Loop closed*, multi-level prerequisites, citation regimes | R4-world (04), R4-data (05, technologies) |
| §5.16 quality | Tiers and unlocks, the verifier ladder, catalyst flags, the stat slope | R4-data (02, `meta.quality`); the per-type stat table is this document's overlay |
| §5.17 runaways | Deploying buildings, the leak, links, linear spread, the locks, the rollback input, cleaning, *Wild* (03 §3); hollow work (03 §4); *Scooped* (03 §5); race (03 §6) | R4-world (03) |
| §5.18 worldgen | Biomes and climate (01 §2–§3), patches (01 §4), towns (01 §5), archives (01 §6), starting area (01 §9) | R4-world (01), R4-data (resources, tiles, world) |
| §5.20 statistics, achievements, run report | Achievement conditions (08-text §6, `text.yaml`), milestone log lines (08-text §8.4), console (08-text §8.6), run report (04 §8, 07-ui §13.3, 08-text §4.1) | R4-ui (07, 08), R4-world (04) |
| §6.9 overlays | Registry and scales (07-ui §3) | R4-ui (07) |
| §7 UI, §8 storage | Screens, strings, slice UI scope, browser layers (07-ui §19) | R4-ui (07, 08, 09) |
| §9 assets | Sprite lines (data), icon and sprite legibility rules (07-ui §23) | R4-data, R4-ui |
| §11 performance | — | this document; 09 §8 points here |
| §3, §4.1, §4.4, §15 multiplayer seams | The protocol, the relay, joins, desync repair and the multiplayer UI that use them | chapter 11 |
| M7 | Surfaces and their twists | R4-world (06) |

**`InputAction` additions to I §8.2** (each with a stable id in `schema/actions.yaml`, §15.3):
- `set_staff_slot` (also covered by ordinary transfers);
- `distribute(entities, itemKey, count)`;
- `place_blueprint(record, pos, dir, flip, mode)`;
- `rename(entity, text)`;
- `set_hall_mode(entity, testTimeCompute)` (M4; also settable by circuit);
- `train_schedule_edit(…)` and `interrupt_edit(…)` (M2);
- `logistic_request_edit(…)` (M3);
- `launch_empty(entity)` (M4: the Frontier cluster's empty-launch button, 04 §2.1);
- `set_research_scheduling(enabled)` (M4: the "Researchers fill the queue" checkbox, 07 §5.3; saved state, so replays need it as an action);
- `constructor_settings(…)` (M4);
- `set_player_setting(setting, value)` and `set_game_setting(setting, value)` (M0: the rule-affecting settings of §7.6's audit, D11);
- `console_command(text)`: console commands that change the world (cheats, dev `/c`); chat is out of band and never an action (11 §3.3).

**System actions** (§15.3; injected by the sequencer as player `0xFFFF`): `player_joined`, `player_left`, `release_inputs`, `snapshot_marker`, `debug_dump`.

**The action format** (§15.3): `u16 type, u16 len`, payload (at most 65,531 bytes; blobs above), in per-player batches with a 16-byte header; held-input actions carry the input generation; entities by serial or creation id.

**Queries** (§15.5): `rates(area)`, `map_search(text)`, `total_raw(recipe)`, `where_made(item)`, `patch_info(resource)`; dev only: `inspect(serial)`, `hash`, `digest`.

## Appendix C — Sources

**Friday Facts** (local dumps in `round1/I-data/fff/` and fetched):
- 176 (belt transport lines: gap encoding, line merging, about 9-tile lines under inserters);
- 209 (electric network grouped by prototype);
- 317 (enemy pathfinding: abstract per-chunk region nodes as the A\* heuristic, cached and resumed);
- 366 (test practice: GUI tests through real input, test dependencies);
- 374 (agent task queues, arrival-time dispatch, chunk spiral search, charging heuristics);
- 377 and 389 (2.0 rails, train control);
- 384 (combinators 2.0);
- 390 (noise expressions);
- 402 (radar circuit channel, several crafts per tick);
- 409 (beacon 1/√n profile, transmission 1.5);
- 416 and 430 (fluid segments, 100 units per operation × fullness, 250×250 extents, pumps 1,200/s, 1:10 steam);
- 419 (inserter pickup snapping);
- 421 (sleeping roboports, keep-revealed counters, agents every 20/60 ticks, memory-bound electric update).

**Factorio wiki:** *Transport belts/Physics* (positions, curves, splitters, side-load points); *Inserters* (speeds, throughput tables from 2.0.26, insertion limits, lane preference); *Railway/Train path finding* (penalties, repath triggers); *Pollution* (64-tick chunk cadence, 2% diffusion, minimum 15); *Electric system* (priorities).

**Factorio changelog:** `round1/I-data/changelog.txt` (2.0.7: 1 water → 10 steam in boilers and heat exchangers; 2.1.7: the per-product `affected_by_quality` flag).

**Prototype values:** `round1/I-data/data/entities.lua`, `transport-belts.lua`, `mining-drill.lua` and `utility-constants.lua` (rotation and extension speeds, belt speeds, insertion-limit constants, the burner inserter's 50 kJ per movement). Numbers only.

**Round-1 specs:** B §4 (L1–L16), D §1–§14 and its data, E §2, F §1 and `calib3.py` (now `tools/ref/heat_calib3.py`), G §2–§6 and Appendix A, I §1–§8, A §9–§10, H §3–§5, C §5.

**Round-3 critiques** (the round-4 worklist): `design/round3/R3-implementability.md` (with `impl-data/r3_checks.py` and `r3_xref.py`), `R3-balance.md`, `R3-fun.md`, `R3-coherence-tone.md`, `R3-accuracy.md`.

**Round-4 scripts:** `design/round4/arch-data/manifests.py` (the milestone filters' closure check, §12) and `design/round4/arch-data/bench/` (Appendix A).

**Version 2:**
- `pm/reports/A1.md` and `design/engine-study/` (the engine study); `pm/reviews/A1-r1.md` (codex's second opinion);
- chapter 11 and `design/multiplayer/DESIGN.md` with its proof of concept; `pm/reviews/A2-r1.md` and the review response in `pm/reports/A2.md`;
- `pm/DECISIONS-IMPL.md` 1–6; A3's `design/art/DIRECTION.md` and A4's `design/audio/DIRECTION.md` for the style constants and the audio feed;
- the `libm` crate 0.2.16 (https://crates.io/crates/libm; source in rust-lang/compiler-builtins);
- W3C, *WebAssembly JavaScript Interface*, memory growth detaching the old `ArrayBuffer` (https://www.w3.org/TR/wasm-js-api-2/#memories);
- V8, *WebAssembly compilation pipeline* (https://v8.dev/docs/wasm-compilation-pipeline): WebAssembly is still compiled and tiered, so "no JIT stalls" means no speculative deoptimisation, not no compilation (A1-r1);
- Yann Collet, *xxHash* specification and test vectors (XXH64; https://github.com/Cyan4973/xxHash/blob/dev/doc/xxhash_spec.md).

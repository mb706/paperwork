# A1: Engine study (simulation language, runtime boundary, scale)

Status: done (report delivered in this message; the harness refused to let this agent write report files)

## Summary

`design/engine-study/` contains:
- **`ts/kernel.ts`**: a TypeScript simulation kernel written as §2.5/§4 prescribe. It covers transport lines (§5.3), inserters (§5.4), crafting machines, furnaces, labs and drills (§5.5), electric networks (§5.7), active sets, watch lists and the timer wheel (§4.6), the state hash and render extraction.
- **`rust/src/lib.rs`**: a line-by-line Rust port (raw C ABI, no wasm-bindgen).
- **`gen/generate.ts`**: a seeded factory generator. Scales: Mid, Late, and the 400k megabase. Regimes: busy, typical, backed, starved (the sweep of the sleeping share).
- **`harness/`**: Node, Chrome and Firefox runners, with the sim in a dedicated module Worker driven by Playwright; plus the threads, hybrid, build-time and size experiments.
- **`results/`**: raw data (JSON lines, about 1 MB).
- **`README.md`**: one command per platform to rerun everything; `node harness/tables.ts` regenerates every table below.

**Fairness.** Both kernels produce bit-identical state hashes after any number of ticks, so they demonstrably do the same work. Both are written in the same plain style with bounds-checked arrays and no hand-tuning. The one performance fix (a V8 deoptimisation storm, see Tails) was applied to TypeScript and given the same structure in Rust.

## Results

**Method.**
- All runs are pinned to socket 0's cores.
- Each run warms up 6,000 ticks (the regimes are steady by then), times 3,600 ticks individually, and is repeated 3 times.
- The host runs at its 2.6 GHz base clock and gets turbo (~3.3 GHz) only in windows of minutes.
  - A clock log (`results/freq.log`) and per-run load records flagged 18 turbo runs (8 Node, 10 Chrome). They are excluded from absolute numbers.
  - Implementations are interleaved within each repetition, so the ratios are paired and cancel the drift.
- Run-to-run spread at base clock is about 1–2%.

### 1. Hot-loop cost

Mean ms per tick (p99 for "busy" in brackets):

| Scale / regime | Chrome TS | Chrome WASM | Firefox TS | Firefox WASM | Node TS | Node WASM | Native |
|---|---|---|---|---|---|---|---|
| Mid, busy | 0.580 (0.77) | 0.356 (0.40) | 0.664 (0.72) | 0.416 (0.53) | 0.617 (0.83) | 0.354 (0.39) | 0.288 |
| Mid, typical | 0.433 | 0.277 | 0.485 | 0.323 | 0.451 | 0.273 | 0.220 |
| Mid, backed | 0.322 | 0.212 | 0.339 | 0.251 | 0.351 | 0.210 | 0.167 |
| Mid, starved | 0.366 | 0.249 | 0.432 | 0.277 | 0.377 | 0.246 | 0.186 |
| Late, busy | 2.097 (2.36) | 1.263 (1.42) | 2.340 (2.73) | 1.460 (1.60) | 2.144 (2.43) | 1.256 (1.38) | 1.024 |
| Late, typical | 1.506 | 0.960 | 1.705 | 1.125 | 1.620 | 0.958 | 0.780 |
| Late, backed | 1.140 | 0.743 | 1.278 | 0.886 | 1.222 | 0.729 | 0.599 |
| Late, starved | 1.294 | 0.884 | 1.552 | 0.986 | 1.306 | 0.872 | 0.669 |
| Mega (400k), busy | | | | | 5.95 | 3.46 | 3.00 |

- **TS ÷ WASM, paired:** Chrome 1.37–1.66, Firefox 1.35–1.60, Node 1.40–1.74.
- **WASM ÷ native:** 1.23–1.34 (Chrome); 1.15 at Mega.
- **Firefox ÷ Chrome:** 1.05–1.20 for TS, 1.11–1.19 for WASM.
- **`simd128`:** within ±1% of plain WASM everywhere; LLVM's auto-vectorised loops aren't the hot ones.
- **Scaling** from Late to Mega is linear.

### 2. Per system and per entity

Chrome, Late "busy"; ms per tick, then cost per active entity:

| System | TS | WASM | TS ns/entity | WASM ns/entity |
|---|---|---|---|---|
| Electric (2 passes) | 0.303 | 0.286 | 9.0 per consumer | 8.5 per consumer |
| Machines | 0.429 | 0.207 | 45 per active machine | 22 per active machine |
| Belts | 0.206 | 0.103 | 56 per active line | 28 per active line |
| Inserters | 1.181 | 0.679 | 126 per active inserter | 72 per active inserter |

- Branchy entity code costs ~1.8–2.0× more in TS; the memory-bound electric pass costs the same in both.
- Scaled to §11's Late counts and §4.7's activity assumptions, these four systems cost about 1.3 ms in TS on the reference machine, against §4.7's estimate of 1.5 ms. So the §4.7 model holds overall; inserters are dearer and electric cheaper than it assumed.

Active shares at the end of each window (identical on every engine):

| Regime | Lines active | Inserters active (swinging) | Machines active |
|---|---|---|---|
| Busy | 46% | 39% (13%) | 99% |
| Typical | 25% | 20% (6%) | 65% |
| Backed | 11% | 8% (2%) | 41% |
| Starved | 41% | 26% (4%) | 56% |

Turning sleep off (NO_SLEEP) costs 1.6–2.9× more and gives identical hashes, also at Late.

### 3. Tails, GC and JIT

- **p99** is about 1.1–1.2× the mean for both builds at Late in all engines.
- **GC:** there are zero GC events in the tick window; the tick allocates nothing.
- **JIT, TypeScript only:**
  - **V8 OSR storm:** `electric` deoptimised 3,351 times in 3,600 ticks after a day-cycle branch first ran at tick 6,250. Splitting the per-network loops into a small function fixed it; only `--trace-deopt` revealed it.
  - **Firefox stalls:** the TS build took one 18–22 ms tick per run at Mid ("busy" and "typical"), at a fixed tick per regime. Firefox's WASM worst tick there is 0.94 ms.
  - **First tick after loading a Late save:** 11–13 ms in TS vs 3–6 ms in WASM; ticks 2–10 average about 5 ms vs about 2.4 ms. Both settle within ~100 ticks.
- **Host effects, all builds:**
  - Worst ticks of 4–6 ms at Late and 17–21 ms at Mega come from this 2-socket server. Node 0 is full of page cache, so pages spill to node 1 and NUMA balancing migrates them; one Mega run migrated 180,506 pages. They are not caused by either kernel.
  - Deterministic simulation bursts cost about 2× a normal tick, at the same tick index in every build.

### 4. The boundary

**(i) Render extraction**, 1920×1080, Late "busy", Chrome, per frame:

| View | Sprites | TS (ms) | WASM (ms) | Copy out of WASM (ms) |
|---|---|---|---|---|
| Zoom 1×, dynamic only / full | 1,152 / 1,489 | 0.08 / 0.10 | 0.04 / 0.05 | 0.006 |
| Zoom 0.3×, dynamic only / full | 12,399 / 16,341 | 0.42 / 0.66 | 0.22 / 0.32 | 0.023 / 0.028 |

- Per sprite that is about 40 ns in TS and 19 ns in WASM, plus 1.7 ns to copy out of WASM memory.
- The worker → main → worker round trip with a transferable buffer is 0.20–0.27 ms regardless of size (18–260 kB).
- §6.12's 0.3× late scene (about 85k sprites including belt items) would cost roughly 1.4 ms in TS and 0.75 ms in WASM on the reference machine, against §4.7's 1.0 ms budget.

**(ii) UI queries.** `ctl: query` messages are answered between ticks.
- Against a worker paced at 60 UPS, latency is p50 0.45–0.73 ms. p99 is roughly one tick plus the message hop: 2.7–3.4 ms in Chrome at Late; in Firefox 5.6 ms (TS) and 3.0 ms (WASM).
- Open GUIs should use per-tick subscriptions in the packet instead.
- With WASM, TypeScript reads Rust-owned pools through generated typed-array views (no penalty, see Hybrids), and cold data through Rust functions that return compact records.

**(iii) Input actions.** Proposed format, one batch per player per tick:
- Header: `u8 version, u8 flags, u16 player, u32 tick, u32 seq, u16 count, u16 reserved`.
- Each action: `u16 type` (Factorio's `input_action` numbering), `u16 len`, then a fixed little-endian payload.
- Field types: entity references as `u32` serials; positions as `i32` x2/y2; prototype ids as `u16`, with the session carrying `prototypes.hash`; strings as `u16` length + UTF-8.
- The same bytes serve the local loopback, the network, replays and validation in the sim.
- With WASM, JS copies each tick's batches into a ring buffer in linear memory and calls `apply_actions(ptr, len)`; the cost is negligible.

### 5. Determinism

- Every (scale, regime) case gives exactly **one** state hash and one hash per sprite buffer across all 27 runs (Node, Chrome and Firefox × TS, WASM and WASM-SIMD), and native Rust gives the same hash too.
- `cargo test` checks native Rust against TS golden hashes, with and without sleep.
- NO_SLEEP equivalence holds at Mid for 12,000 ticks and at Late.

**Rules each language needs** (beyond §4.1):
- **TS:** ban `**`/`Math.pow` even with integer exponents (implementation-approximated); ban `Intl`, `localeCompare` and `toLocaleString`; keep NaN out of state (its bit pattern varies by engine); add debug assertions on pool bounds (out-of-range reads silently return `undefined`); iterate active sets in pool order.
- **Rust:** transcendentals only through the `libm` crate (std's `f64::sin` calls glibc natively but musl code in WASM); no `mul_add`; no `HashMap`/`HashSet` with random state; no NaN in state; never `relaxed-simd`; write `min`/`max` as comparisons (native and WASM differ on −0 and NaN); explicit `wrapping_*` arithmetic; no pointer-dependent logic; no deep recursion. Clippy enforces the bans (`rust/clippy.toml`, verified to fire).

**Judgement:** WASM is structurally somewhat safer: the same binary runs on every peer, the types are explicit, and errors panic loudly. TypeScript reached bit-identical results across engines with lint-level discipline. The dominant desync risks (cached or unsaved state, save/load asymmetry, ordering) don't depend on the language. The study found one in the spec itself (finding 1 in the next section).

### 6. Spec findings

1. **Active lists vs NO_SLEEP equivalence.** §4.6's swap-remove active list breaks the spec's own NO_SLEEP equivalence: competing inserters (for example at a shared station chest) run in a different order. It diverged by tick 200 in typical, backed and starved, and by tick 6,200 in busy; starved even ended with different research totals (4,070 vs 4,043). Bitsets iterated in pool order keep equivalence.
2. **Wake rules that keep equivalence.** NO_SLEEP equivalence held only with these rules:
   - Watch-list nodes carry the entity's sleep sequence number; stale nodes are dropped when their list fires.
   - A belt arrival timer must be a lower bound.
   - Inserting mid-line wakes timer-holding waiters; inserting at the back wakes only waiters that have no item upstream.
   - Dropping onto a moving belt polls each tick; dropping onto a stalled belt waits for the line to restart.
   - A partially filled hand keeps polling.
3. **Line order.** Lines must update downstream first, or compressed flow opens gaps at line boundaries.
4. **Mixed lanes.** A dead-end lane carrying two item types jams, as in Factorio.

### 7. Practicalities

**Sizes.**
- Kernel: TS 34.7 kB minified (9.5 kB gzip, 8.4 kB brotli) vs WASM 70.7 kB (27.1 kB gzip, 21.8 kB brotli; 88 kB before `wasm-opt`).
- At about 50k lines: TS 0.92 MB vs WASM 1.39 MB.

**Start-up.**
- WASM `compileStreaming`: 4.7 ms in Chrome, 8.9 ms in Firefox; instantiation about 0.2 ms.
- Worker bundle: 9 ms in Chrome, 64 ms in Firefox.
- Loading the 16 MB Late world: 54 ms (TS) vs 75 ms (WASM).

**Build times** on this host, synthetic crate of 49.8k lines (Rust) and 44.6k lines (TS):

| Step | Clean (s) | Incremental (s) |
|---|---|---|
| `cargo check` | 5.3 | 1.0 |
| Native `cargo test` build | 6.4 | 1.2 |
| WASM, dev profile (O2) | 12.9 | 2.9 |
| WASM, release (fat LTO) | 38 + 28.5 for `wasm-opt` | 38 + 28.5 (never incremental) |
| TS `tsc` | 0.6 | 0.5 |
| TS `vite build` | 0.8 | 0.8 |

Real code with generics and serde will compile slower than these copies.

**Testing and debugging.**
- Develop and test natively with `cargo test`. The golden test proves native = WASM = TS.
- With `panic = "abort"`, a panic reaches JS only as `RuntimeError: unreachable`. A panic hook forwards the message (demonstrated: "index out of bounds: the len is 3 but the index is 7", with file and line).
- After a trap the instance is poisoned (std's panic state stays set), so the game must re-instantiate the sim from the last autosave.
- Browser source-level debugging of Rust needs DWARF and Chrome's extension (not tested here).

**Vite.** `?url` plus `compileStreaming` in a module Worker works with Vite 8.3.2. The dev server needs `server.fs.allow`; there is no hot reload for the sim; a small plugin can run cargo on change.

**Agent productivity.** The 1,850-line Rust port compiled on its first build (one warning) and matched the TS hashes on its first run. The ongoing costs are the boundary layer, two linters and test runners, and features that cross both languages. TypeScript, by contrast, needed tracing-level JIT work that Rust does not.

### 8. Threads

- **Barrier cost:** with blocking `Atomics.wait`/`notify`, a round costs 85–95 µs in Chrome and 100–125 µs in Firefox at 2–8 threads. Spinning costs 2–5 µs but keeps every core busy.
- **Parallel gain:** an electric-style pass over 50k elements takes 126 µs on one thread; 8 blocking threads reach 82 µs (1.5×) in Chrome and 1.9× in Firefox.
- **What could be parallelised:** inserters (about 54% of the WASM tick) share targets and can't be split without a redesign. The parallelisable phases are about 25–35% of the tick.
- **Verdict:** one sim thread is right. Parallelism would also need COOP/COEP headers and fixed-block partitioning for determinism (the harness shows how).

### 9. Hybrids

- **Memory sharing is free:** the TS kernel runs equally fast on its own arrays, on one shared `ArrayBuffer`, or on a `WebAssembly.Memory` (2.13 / 2.15 / 2.13 ms).
- **A per-system port is impractical:** belts, inserters, machines, inventories and watch lists call each other and make up 86% of the TS tick. The decoupled system (electric) is memory-bound and gains about 6%. So "TypeScript now, port per system later" really means rewriting the core later.
- **Two writers are worse than one:** a hybrid in which both languages write the same memory doubles the rules and the determinism surface.
- **Best variant:** the clean split, with TypeScript reading Rust-owned memory (never writing it) for queries, packets, saves and debug tools.

### 10. Player-facing terms

At the base clock, reference ≈ host ÷ 2.4 (§11's ÷1.8 assumes turbo), and target ≈ reference ÷ 1.4.

| Case | Host (ms per tick) | Reference machine | 2022 target machine |
|---|---|---|---|
| Late, four core systems, TS | 2.10 | 0.87 | 0.62 |
| Late, four core systems, WASM | 1.26 | 0.53 | 0.38 |
| Mega, four core systems, TS | 5.95 | 2.5 | 1.8 |
| Mega, four core systems, WASM | 3.46 | 1.4 | 1.0 |

Projected full simulation (§4.7 puts these four systems at about 37% of the total):
- Late on the reference machine: about 2.4 ms in TS and 1.4 ms in WASM, against a 12 ms budget.
- Megabase on the target machine: about 4.8 ms in TS and 2.8 ms in WASM, against 25 ms.
- Firefox adds about 15%.

## Recommendation, reasons, risks

**Recommendation:** Rust → WASM for the simulation as a clean split. One crate holds the World, all systems, saves and the hash, running in the sim Worker. TypeScript keeps the data stage, UI, renderer, audio, network and tools, plus a read-only, schema-generated view layer. One thread; no SIMD; no SharedArrayBuffer.

**Reasons:**
1. A later port of the hot core is a rewrite (Hybrids).
2. 1.35–1.75× faster in every engine, 2–4× faster first ticks after a load, and no JIT stalls. That matters for megabases, Firefox, slow laptops, lockstep multiplayer (where the slowest peer sets the pace) and catching up after joining a game.
3. Determinism by construction, with native tests that equal the browser.
4. The practical costs measured small: 1–3 s incremental loops, no-cost TypeScript views.

**Risks:**
- The two-language boundary: generated layouts, and features that cross both languages.
- Weaker in-browser debugging; traps require a reload from autosave.
- Release builds of about 67 s.
- M0 grows by an estimated 20–30%.

**When TypeScript is the better choice:** if one-language velocity matters more than the headroom. It meets every §11 budget with 3–5× margin and was deterministic across V8 and SpiderMonkey in this study.

## Changes to `10-architecture.md` (for the revision WP)

1. **§0 #1:** Rust 1.99.x → `wasm32-unknown-unknown` for the sim, TypeScript for the rest. Replace "WASM escape hatch" with the measured reasons above.
2. **§0 #3–4:** `cargo test` (native goldens) plus Vitest; clippy with determinism bans plus `check-arch`.
3. **§2.1:** pins for `rust-toolchain.toml` and binaryen 133. Profiles: release (fat LTO, O3, cgu = 1, `panic = abort`, `wasm-opt -O3`) and wasmdev (O2, no LTO). No wasm-bindgen.
4. **§2.2–2.3:** a `game/sim/` crate (or a few crates); a TypeScript sim-worker shell; a Vite plugin running cargo; commands updated.
5. **§2.5:** Rust code rules from the Determinism section; a panic hook; reload from autosave after a trap.
6. **§3.2:** actions enter through a linear-memory ring (the format above). Extraction writes into linear memory and is copied into pooled transferables (1.7 ns per sprite).
7. **§4.5 / §8.1:** one descriptor table generates the Rust SoA pools, the TypeScript read-only views and the save sections.
8. **§4.6:** active sets are bitsets iterated in pool order; adopt the wake rules from Spec findings, item 2.
9. **§4.7:** replace the per-entity costs with the measured ones.
10. **§5.3:** lines update downstream first; mixed dead-end lanes jam (as in Factorio).
11. **§6 / §4.7:** the extraction budget is tight for 85k sprites. Consider sending per-line gap arrays and expanding them on the main thread.
12. **§10.6:** run A/B comparisons within one session and log the clock; drop the 10% gate against history. Reuse this study's worker harness.
13. **§11:** the host factor is about 0.42× at base clock; confirm it with `bench.html`.
14. **§13 risks:** remove "JS performance"; add "boundary" and "WASM debugging".
15. **Appendix A:** add these measurements.

## Decisions and deviations

- **Report files:** the harness refused `REPORT.md` and `pm/reports/A1.md`; this message carries the report, and the README points to `pm/reports/A1.md`.
- **Bitsets instead of §4.6's lists:** done because the spec contradicts itself; measured above.
- **Kernel scope:** no side-loading, splitters, curves or squeezed gaps. They don't change the cost classes being compared.
- **Belt lines are 16 tiles** in the generator (§5.3 caps them at 32).
- **The `electric` split** (the JIT fix) is mirrored in Rust.
- **Rust 1.99.1** is 7 days old: a patch release on 1.99.0 (19 days); the 14-day rule covers npm pins.
- **Firefox** lives in Playwright's default cache (`~/.cache/ms-playwright`), next to its Chromium.
- **Turbo runs:** flagged runs are excluded from absolute numbers. The Node campaign's flags are inferred from paired speed, because the clock log started with Chrome.

## Verification

All of these passed:
- `harness/check-ts.ts`, `rust/tests/golden.rs`, `xcheck-native.ts`, `swaplist.ts`.
- 216 browser and Node runs plus 24 native runs, with identical hashes per case.
- `tsc` (sim layer with lib `es2024` only, and the worker layer).
- `cargo clippy -D warnings`, and a demonstration that the bans fire.
- `tools/check-toolchain.sh`: all checks pass, including the new ones.
- Zero console errors in all browser runs.

## Open issues and follow-ups

1. The manager needs to save this report.
2. The user decides TypeScript vs Rust.
3. If Rust: in M0, design the codegen schema, panic hook, Vite plugin and CI (native goldens plus browser hash checks).
4. Calibrate the host-to-reference factor with `bench.html`.
5. Replace §10.6's regression gate.
6. The cause of Firefox's TypeScript stalls is a hypothesis: a SpiderMonkey recompile the first time a code path runs.
7. The JavaScript in the worker must stay allocation-free, or GC pauses reach the tick under either language.
8. Build-time numbers come from 28 identical kernel copies; real code will compile slower.

## Files

**Created:** `design/engine-study/**`, 60 files:
- `README.md`, `package.json` and `package-lock.json`, `tsconfig.json` and `tsconfig.web.json`
- `ts/`: `kernel.ts`, `format.ts`, `sim-like.ts`, `wasm-world.ts`
- `gen/generate.ts`
- `rust/`: `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, `clippy.toml`, `build-wasm.sh`, `src/lib.rs`, `src/bin/bench.rs`, `tests/golden.rs`
- `harness/`: 23 scripts, plus `web/` (pages and workers)
- `results/`: 11 data files

**Changed:**
- `CLAUDE.md`: Rust/WASM, Firefox, `numactl` and host benchmarking notes.
- `tools/check-toolchain.sh`: rustc, cargo, wasm32 target, `wasm-opt`, `numactl`, a Rust→WASM end-to-end build, and Firefox.

**Installed** (user space):
- rustup and Rust 1.99.1 in `~/.local/opt/{rustup,cargo}`, with wrappers in `~/.local/bin`; `~/.zshenv` exports the two Rust variables.
- binaryen 133 (`~/.local/opt/binaryen-133`).
- Playwright Firefox 157.
- numactl 2.0.18.

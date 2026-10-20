# Engine study (WP A1): TypeScript vs Rust/WASM for the simulation

The findings, tables and recommendation are in the A1 report (`pm/reports/A1.md`). This file says what is here
and how to rerun every measurement. `node harness/tables.ts` regenerates the report's tables from `results/`.

## What is here

| Path | What |
|---|---|
| `ts/kernel.ts` | The TypeScript simulation kernel: transport lines (§5.3), inserters (§5.4), crafting machines, furnaces, labs and drills (§5.5), electric networks (§5.7), bitset active sets, watch lists and the timer wheel (§4.6), the state hash, render extraction |
| `rust/src/lib.rs` | The same kernel in Rust, a line-by-line port. Both produce **bit-identical state hashes**; that is the fairness check (the same work is done) and the cross-engine determinism test |
| `ts/format.ts` | The binary world format both kernels load |
| `ts/wasm-world.ts` | The Rust kernel compiled to wasm32 behind the TS kernel's interface (raw C ABI, no wasm-bindgen) |
| `gen/generate.ts` | The seeded synthetic factory generator: production cells, scales `tiny`, `mid` (§11 Mid), `late` (§11 Late), `mega` (the 400k stretch), and the regimes `busy`, `typical`, `backed`, `starved` (the sleeping-share sweep) |
| `harness/bench-core.ts` | The benchmark procedure, shared by Node and the browser Worker |
| `harness/bench-node.ts`, `harness/bench-browser.ts` | Runners for Node 24 and for Chrome / Firefox (Playwright; the sim runs in a dedicated module Worker) |
| `harness/web/` | The Vite page and Worker for the browser runs; `threads.html` is the SharedArrayBuffer experiment |
| `harness/campaign.sh` | One command per platform: the whole benchmark matrix |
| `harness/check-ts.ts`, `harness/xcheck-native.ts` | NO_SLEEP equivalence (TS) and TS ↔ native Rust hash cross-check |
| `harness/sizes.ts`, `harness/buildtime.py`, `harness/threads-browser.ts` | Bundle sizes and start-up; build times at 40k lines; the threads experiment |
| `harness/tables.ts`, `harness/summarize.ts`, `harness/summarize-threads.ts` | The report's tables from `results/` (paired TS ÷ WASM ratios, tails, phases, shares, extraction, queries, start-up, hashes, clock) |
| `harness/swaplist.ts` | Shows that spec §4.6's swap-remove active lists break NO_SLEEP equivalence (bitsets do not) |
| `harness/arena.ts`, `harness/arena-node.ts` | Hybrid check: the TS kernel with all its arrays moved into one `ArrayBuffer` or `WebAssembly.Memory` |
| `harness/golden.ts`, `rust/tests/golden.rs` | TS golden hashes and the `cargo test` that checks the Rust kernel against them |
| `harness/extras.sh` | NO_SLEEP at Late, the 400k megabase stretch, the arena experiment |
| `harness/cpuload.sh`, `harness/cpu.ts`, `harness/freqlog.sh` | Per-socket CPU load (`mpstat` is not installed), NUMA and huge-page placement, and a clock log: every result line records the load during its run, and `freqlog.sh` (run it on socket 1) logs the clock every 2 s to `results/freq.log` |
| `results/` | Raw results (JSON lines), committed |
| `target/` | Build outputs, generated worlds, scratch (gitignored) |

## Prerequisites (all user-mode, see `CLAUDE.md`)

Node 24, Rust 1.99.1 with `wasm32-unknown-unknown` (rustup), `wasm-opt` (binaryen 133), Chrome for Testing 156,
Playwright 1.64 with its Firefox 157 build (`PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu22.04-x64 playwright install firefox`), `jq`.

```sh
cd design/engine-study
npm ci                                   # the pinned stack of design/round2/A-stack-test
rust/build-wasm.sh                       # target/wasm/{sim,sim-simd}.wasm (release, fat LTO, wasm-opt -O3)
(cd rust && cargo build --release)       # native reference benchmark (target/release/bench)
(cd harness/web && ../../node_modules/.bin/vite build)   # target/web: bench page, worker, wasm assets
```

## Correctness checks (run these first)

```sh
node_modules/.bin/tsc -p tsconfig.json                    # the sim layer type-checks with lib es2024 only (as spec 10 §2.2)
node_modules/.bin/tsc -p tsconfig.web.json                # the worker layer
(cd rust && cargo clippy --release -- -D warnings)        # includes the determinism bans of rust/clippy.toml
node harness/check-ts.ts tiny 3000                        # sleep vs NO_SLEEP: equal hashes in all four regimes
node harness/golden.ts                                    # tiny worlds + TS golden hashes (target/golden.txt)
(cd rust && cargo test --release)                         # the Rust kernel reproduces them, sleeping and not
node harness/xcheck-native.ts 1000 2000 target/worlds/tiny-*.bin   # TS (Node) vs native Rust: MATCH
node harness/swaplist.ts mid 12000                        # bitsets keep NO_SLEEP equivalence; swap-remove lists break it
```

The browser runs re-check the same hashes in Chrome and Firefox for TS, WASM and WASM-SIMD (the `hash` field of
every result line, and `outHash`, the hash of each extracted sprite buffer).

## The measurements (one command per platform)

Pin everything to socket 0 (`CPUS=0-7`, the default); other agents use socket 1. Check the load first with
`harness/cpuload.sh`, and start the clock log on socket 1: `taskset -c 31 harness/freqlog.sh &`. The host runs at
its 2.6 GHz base clock with intermittent turbo windows, so compare implementations within a repetition (the
campaign interleaves them) and let `tables.ts` exclude turbo runs from absolute numbers.

```sh
harness/campaign.sh node    3 mid,late busy,typical,backed,starved ts,wasm,wasm-simd   # ≈ 25 min
harness/campaign.sh chrome  3 mid,late busy,typical,backed,starved ts,wasm,wasm-simd   # ≈ 50 min
harness/campaign.sh firefox 3 mid,late busy,typical,backed,starved ts,wasm,wasm-simd   # ≈ 50 min
harness/campaign.sh native  3 mid,late busy,typical,backed,starved                     # ≈ 3 min
node harness/tables.ts                                    # the report's tables (or: node harness/summarize.ts results --md)
```

Each run: generate the world, load it, warm up 6,000 ticks (the regimes reach their steady state), time 3,600
ticks one by one (mean, p50, p90, p99, p99.9, max), then 600 ticks with per-phase timers, then render extraction
(1920×1080 at zoom 1 and 0.3, dynamic-only and full sprite lists; 20 warm-up and 120 timed frames each, with the
buffer transferred to the main thread and back in the browser). Browser runs also measure UI-query latency
against a Worker paced at 60 UPS.

Other experiments:

```sh
node harness/threads-browser.ts chrome results/threads.jsonl    # SAB + Atomics barriers, parallel phases
node harness/threads-browser.ts firefox results/threads.jsonl
node harness/sizes.ts                                           # results/sizes.json
python3 harness/buildtime.py 28                                 # results/buildtime-28.json (≈ 40k lines each)
harness/extras.sh                                               # NO_SLEEP at Late, the 400k stretch, the arena
```

The browser page can also be opened by hand: `node harness/serve.ts target/web 5199`, then
`http://127.0.0.1:5199/?impl=wasm&scale=late&regime=busy` (through the SSH tunnel).

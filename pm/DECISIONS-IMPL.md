# Implementation-time engineering decisions (manager-owned)

Numbered like DECISIONS.md. Each entry gives the decision, the reason and the source WP or review.

1. **The simulation is written in Rust and compiled to WASM, as a clean split** (A1; codex second opinion A1-r1 agrees, with moderate confidence).
   - **Split:**
     - All authoritative sim state and rules live in one Rust crate (or a small workspace) that runs in the sim Worker on one thread. No SIMD, no SharedArrayBuffer.
     - TypeScript does the data stage, the worker shell, networking, the renderer, the UI, audio and tools.
   - **Why:**
     - **Speed:** 1.35–1.75× faster per tick in Chrome, Firefox and Node, and 2–4× faster first ticks after a load. That gives catch-up headroom for joins and re-syncs.
     - **No JIT stalls:** TypeScript showed an 18–22 ms stall in Firefox and a V8 deoptimisation storm.
     - **Determinism by construction:** the same binary runs on every peer, with in-module libm.
     - **Guardrails:** typed handles, exhaustive enums and checked indexing catch agent mistakes.
     - **No later port:** the coupled hot core (86% of the tick) cannot be ported one system at a time, so "TypeScript now, WASM later" would mean a rewrite.
   - **Boundary rules (binding):**
     1. Rust owns the authoritative state and the rules. Tick closures enter through one validated API. Queries, extraction and TypeScript views never mutate sim state or influence future results.
     2. One schema generates the contracts: action codecs, prototype records, read views, saved and derived annotations. It fixes widths, units, ids, ordering and versions, and never exposes Rust's incidental layout.
     3. Data leaves the sim as bulk projections and subscriptions, through reusable adapters: inventory panels, statistics, render packets. No per-entity FFI calls, and no gameplay arithmetic duplicated in TypeScript. The main-thread mirror and pooled transferables (10 §3.4) stay.
     4. View lifetimes are explicit. Only worker-side adapters touch linear memory, and views are reacquired after memory growth. No pointer survives an invalidating call.
     5. The boundary is reviewable and testable from M0: real inventory and statistics projections, save/load, structured errors, trap recovery (re-instantiate from the last autosave or snapshot), native `cargo test` goldens, and browser replay hashes.
   - **Rust determinism rules** (A1 §5):
     - Transcendentals only through the `libm` crate. No `mul_add`, and never relaxed-simd.
     - No randomly seeded `HashMap`/`HashSet`.
     - No NaN in state. Write `min`/`max` as comparisons.
     - Explicit `wrapping_*` arithmetic.
     - No logic that depends on pointer values.
     - Clippy enforces these bans.
2. **Active sets are bitsets iterated in pool order, not swap-remove lists** (A1, spec finding 1). Swap-remove lists break 10 §4.6's own NO_SLEEP equivalence. Adopt the wake rules in A1, spec finding 2. Belt lines update downstream first.
3. **Benchmarks.**
   - Measure host-to-reference speed as about 0.42× at the base clock (10 §11 assumed 0.55× with turbo).
   - Run A/B comparisons in one session, alternating their order and logging the clock frequency.
   - Drop the 10% gate against historical results (A1; codex A1-r1).
4. **Multiplayer: deterministic lockstep, sequenced by a relay, over WebSocket on TLS port 443** (A2; codex A2-r1).
   - No P2P and no NAT hole punching: browser P2P needs UDP, which the user's network penalises.
   - Single player runs through the same closure pipeline, with a local sequencer.
   - The engine seams S1–S14 and determinism rules D1–D20 in `design/multiplayer/DESIGN.md` §7 are binding for M0, once the A2-r1 fixes are in.

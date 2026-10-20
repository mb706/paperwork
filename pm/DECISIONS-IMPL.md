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
   - The engine seams S1–S15 and the determinism rules D1–D23 are binding for M0. They now live in 10 §3–§4 (D1–D23 in §4.1) and 11 §7; `design/multiplayer/DESIGN.md` became chapter 11.
5. **Art direction: "Survey"** (A3; `design/art/DIRECTION.md`).
   - The world is the survey plate attached to the 1945 charter: rendered models washed in three flat tones, then inked and hatched on buff paper.
   - The HUD keeps Factorio's layout, skinned as 1945 federal paperwork.
   - Information items are light and matter items dark (lightness split).
   - Emitters stain the paper warm, and the night is a cyanotype that lamps colour back in.
   - **The user approved Survey on 2026-10-20** ("let's go ahead with the 'Survey' look!"). The realism variant stays a one-table switch.
   - **Binding production constraint:** render only the moving parts per animation frame. Rebuilding every model per frame would take about 11 h for the full game. Atlases must use animated layers and compression to fit the GPU budget.
6. **Audio direction: process music played by the history of machine music** (A4; `design/audio/DIRECTION.md`). **The user approved it on 2026-10-20**, except that "the organs in the 1962 sound somewhat dissonant". A4 is fixing Era II's organ in the engine rules: no unresolved sustained dissonance in organ and pad voices.
   - A generative-first hybrid: WebAudio plays the rules live from about 7.5 MB of public-domain samples, and the same code renders offline tracks and fallbacks.
   - **Binding constraints:**
     - The audio CPU must come down to a budget the engine work package sets. It is 36–76% of a core here today; use lighter reverbs or pre-rendered stems.
     - Safari needs an Opus decode probe and an AAC fallback.
7. **Worldgen is Rust too** (B1): the `worldgen` crate, used in the sim and as `gen.wasm` for the worldgen pool.
   - A late chunk is generated inline.
   - Pristine chunks regenerate lazily from a saved `GENERATED` set.
8. **Formulas are bytecode interpreted in Rust** (B1). The data stage emits `prototypes.bin` and `prototypes.json`, so data edits need no Rust rebuild.
9. **Ordering** (B1):
   - Derived pools are ordered by canonical keys.
   - Belt lines update in the downstream-first rank of 10 §5.3.
10. **One fresh sim worker per world** (B1).
11. **The M0 contracts in 10 §15 are binding for Phase C** (B1). Any change goes through the schema plus a note in the report of the WP that makes it.

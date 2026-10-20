# C3: The sim worker shell, worldgen and IO workers (M0 Shell package)

**Owner:** one Opus agent, in its own git worktree (the manager sets it up). Commit to your worktree branch at milestones, with messages ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The manager merges.
- **Writes to:**
  - `game/src/simworker/**`, except the fake sim (C1c owns `fake*`; you may wire it in);
  - `game/src/genworker/**` and `game/src/ioworker/**`;
  - the worker entry points in `game/src/app/workers/` and `game/src/dev/` (the `__game` hooks);
  - TypeScript tests;
  - `CLAUDE.md` (a short shell section);
  - `pm/reports/C3.md`.
- **Must not touch:** the crates (C2 owns them), the schema and generated code (go through the manager), the renderer or UI layers, `design/**`, the golden set.

## Context

The M0 contract gate has passed: C1a, C1b and C1c are in `pm/reports/`, and the frozen golden set is in `game/test/golden/` (or wherever C1c's report says).
- **C2** builds the Rust sim in the main tree at the same time. Its `simabi` module (the real `sim.wasm`) arrives at the end of C2's phase C2b and C2c.
- **Until then, build against the ABI contract** (10 §15.8, `game/schema/abi.yaml`, and the generated `schema::abi` traits and export macros), using a **stub module**: a tiny Rust crate in your worktree that implements `SimAbi` trivially, recording closures and returning canned packets. Keep it as a test fixture.
- When C2's real module lands on `dev`, the manager will ask you to merge `dev` into your branch and switch your integration tests to it.

## Read

- `CLAUDE.md`, `pm/README.md`, `pm/DECISIONS-IMPL.md`.
- `game/schema/README.md`; the golden set's README; `pm/reports/C1c.md` ("How each package consumes the golden set").
- `design/spec/10-architecture.md`:
  - "Changes in v2";
  - **§3 in full**: threads, the worker protocol, the tick loop and pacing, the view model's contract, dev hooks, the language boundary, generations;
  - **§15.8** (ABI) and §15.3–§15.5 (closures, packets, projections and subscriptions, from the shell's side);
  - §15.9 (worldgen);
  - §8 (saves, autosave, closure logs, replays, checkpoints) and §8.2 (storage: OPFS and IndexedDB, in the IO worker);
  - §9.7 (loading: the main thread compiles the modules and posts them);
  - §12 (M0 scope and exit).
- `design/spec/11-multiplayer.md` §7: S9–S15 are yours, notably the `LocalSequencer`, clock generations, the world-replacement protocol S15 and the worker swap S11.

## Deliver

1. **The sim worker:**
   - module instantiation from the posted `WebAssembly.Module`, and the schema-hash handshake, which refuses a stale module;
   - `MemoryLease` and view lifetimes (boundary rule 4);
   - the `LocalSequencer` with pacing and clock generations;
   - closure framing into the module;
   - packets and pooling with transferables;
   - subscriptions with the generation and invalidation rules;
   - the world-replacement protocol (S15) through a fresh worker per world (decision 10) and the worker swap (S11);
   - checkpoint copies, closure logs and replay;
   - **trap recovery** (§3.6): the trap notice, reloading the last autosave, and leaving a reproduction bundle.
2. **The worldgen worker** (pool of `gen.wasm`) and the **IO worker** (compression, SHA-256, OPFS with an IndexedDB fallback).
3. **`__game` hooks** (§3.5) for deterministic tests: `step(n)`, state hash, and so on.
4. **Tests:**
   - Vitest with the fake sim, the stub module and the real module;
   - the golden closure log replayed through the shell. With the stub, verify sequencing and framing; with the real module, the golden digests;
   - replacement, gone and stale-generation cases;
   - trap and memory-growth tests.

## Quality bar

- **No allocation in the steady-state tick path** of the worker JavaScript (A1 open issue 7).
- **Every protocol message is versioned and generation-tagged,** as the spec says.
- `npm run ci` is green in your worktree.
- Pin heavy jobs with `taskset -c 0-15`.

## Report

`pm/reports/C3.md`. Your final message is at most 200 words, and includes your worktree path and branch.

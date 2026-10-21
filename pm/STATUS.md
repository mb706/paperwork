# Project status (maintained by the manager)

## Phase A: pre-implementation studies (started 2026-10-20)
| WP | Topic | Agent | Status |
|---|---|---|---|
| A1 | Engine study: TS vs Rust/WASM, render boundary, scale | Opus | done. Rust→WASM adopted (IMPL-1); codex's second opinion agrees |
| A2 | Multiplayer architecture (lockstep, relay, no P2P UDP) | Opus | done. Codex r1's 17 findings are fixed; seams S1–S15 and rules D1–D23 |
| A3 | Art direction (3 directions → 1, style guide) | Opus | done. "Survey", approved by the user |
| A4 | Audio direction (music + SFX, engine choice, demos) | Opus | done. Era-evolving process music; generative-first hybrid engine. Demos are on the studio page https://claude.ai/artifact/GCpPisM2mG1CMi5zdWJ2HQ. Open: audio CPU is 36–76% of a core here and must come down |

Phase B:
- B1 is done: 10 v2 for Rust, chapter 11, the M0 contracts in 10 §15. Codex r1's 22 findings are fixed (decision 12).
- B2 is done: §9 assets and audio, loading and streaming, §15.6–§15.7. Codex r1's 13 findings are fixed. Not met and stated: Era II audio at 9.3% of a core against 8%; the render target is now ≤ 3 h.

Next: codex reviews of A1/A2, then Phase B (an architecture revision that folds A1–A4 into the spec), then M0.

## Conventions
- **At most 2 Claude subagents run in parallel** (the user's instruction, 2026-10-20, because of the 5-hour usage limits). That includes resumed agents. Codex runs are unlimited, so use them freely for reviews and QA.
- Branch `dev`, with local checkpoint commits by the manager. Nothing is pushed unless the user asks.
- Briefs: `pm/wp/`. Reports: `pm/reports/`. Codex reviews: `pm/reviews/` (via `tools/codex-run.sh` or `codex exec review`).
- Session-local agent ids for follow-ups: `.scratch/agents.md` (gitignored).

## Roadmap (manager's plan; revised as results come in)
1. **Phase A: studies** (parallel, independent domains). A1 engine, A2 multiplayer, A3 art, A4 audio. Codex reviews A1 and A2. The user gets the art mocks and audio demos to look at and listen to (non-blocking).
2. **Phase B: architecture consolidation** (one agent, then a codex review). Fold A1–A4 into `design/spec/10-architecture.md`, plus a new multiplayer chapter, the streaming and download plan (code splitting, lazy atlases and audio, a service-worker cache), and the M0 contracts (shared types, protocol, data JSON, sprite manifest, action format).
3. **Phase C: M0 foundations.**
   - C1: scaffold, data stage and CI first, sequentially.
   - Then, in parallel against the C1 contracts: the sim core; renderer v0; the UI shell and input core; the asset pipeline v0; the audio engine v0.
   - Then integration, the M0 exit QA, and a codex review.
4. **Phase D: M1 vertical slice** (09; 10 §12 M1). Work packages by system, with UI and art per system. QA rounds with playtests, screenshots and codex reviews.
5. **Phase E: M1.5, M2, M3, M4** (the full base game with *Contained*).
6. **Phase F: multiplayer.** The relay and sequencer, join and catch-up, desync recovery, and the UI.
7. **Phase G: M6 scale and polish.** Final QA passes. M5 (*Wild*) and M7 (the expansion) only if time and the user want them.

## Questions for the user (collect; ask at a natural checkpoint)
- Multiplayer (A2 DESIGN §11): where to host the relay (VPS or Cloudflare); whether to store games on the server; the policy for a machine too slow for 60 UPS (drop it, or slow everyone down); remote cursors (a deviation from Factorio, off by default); starting items for new players; the player cap.
- Older ones (DECISIONS §43): the runaway preset default (Contained or Wild); whether Terminal-linked universities may substitute for Researchers; the default r (1.71 or 1.2).

## Follow-ups (not yet assigned)
- 08 text: a player-facing message for refusing a save made with a different worldgen version (B1-r1).
- Design data hygiene (C1a J1): prose values the engine will read must become typed fields: pole `supply` 5x5, beacon `supply_area` and `profile`, silo `payload` and `returns`, combinator fields, `fluid_box` and `circuit`, turret fields. Do it before the M1 systems need them (poles are M1). It touches design/spec/data, its SCHEMA and the validator, and the data-stage schemas in game/.
- Engine overlay content for later milestones (C1a item 5): nine mirrored entities, inserter vectors, drill areas, belt lane geometry, map colours, the event-to-sound map, and so on.
- Expressions: Python's `pow` and `det::powi` differ by 1–2 at unreachable infinite-tech levels (≥ 66). If exact agreement is wanted, switch the validator to repeated multiplication.

## Phase C: M0 (started 2026-10-20)
The Schema package is split into sequential parts: C1a (scaffold, CI, data stage), then C1b (schema, generator, codec fixtures), then C1c (fake sim, reference model, golden set). After that, the contract gate: a codex review. Then the parallel packages start.
| WP | Topic | Status |
|---|---|---|
| C1a | Scaffold, toolchains, CI, check-arch, data stage, capability manifest | done (3ebd435..53e1d61); `npm run ci` takes about 33 s. Codex r1's 15 findings are fixed |
| C1b | Schema, generator, codec fixtures (gate items 1–3) | done (e9f0850..529182a). Codex r1's 10 findings are fixed, with shared fixtures; `npm run ci` takes 35 s |
| C1c | Fake sim, reference model, frozen M0 golden set (gate items 4 and 6) | done (d4bd2b0..cbfb0d6). Golden set v5. GATE-r1 failed (1 critical, 13 major), and all of it is fixed. GATE-r2 failed on 3 major and 3 minor findings: C2 and C3 are cleared, C1c fixed #1 and #3–#5 (golden v6). #2 is merged (1e86703; golden v7). GATE-r3's last two findings are fixed (99949b5, 8f31a32). **The contract gate passed on 2026-10-20** (manager's call after r3). C1c stays as the golden-set owner for future bumps |
| C2 | Rust sim (det, worldgen, sim, simabi, genabi, simtool), phases C2a, C2b, C2c | C2a done (6051307) and its r1 fixes (9441d2f). C2b done, with its r1 fixes (e0810f4). C3 merged into dev (4c9321b). **C2c done** (11b99ec..a6bbd2b): every golden packet, projection, query and ABI trace passes natively and in WASM; the M0 benchmarks meet the reference thresholds; `npm run ci` takes 79.5 s. Codex C2c-r1's 11 findings fixed (40614b5..7e3d417); ci is green in 86 s with the benchmark gate. **The Sim package is done for M0** |
| C8 | M0 integration, test harness, benchmarks, dev endpoints, exit QA | running (main tree); it merges C5 |
| D1 | M1 data readiness: typed design data, the M1 engine overlay, the M1 capability manifest | running (worktree) |
| plan | M1 work-package plan, drafted by codex (`pm/plans/M1-plan-codex.md`) | running (codex) |
| C3 | Sim worker shell, worldgen and IO workers | done, on a branch (8 commits). The golden 3,600-tick log replays with every digest equal (via the reference model); the tick path allocates 0 bytes. All 16 r1 findings fixed (26 regression tests). `full-abi` is the default; main.ts is a composition root through app.ts. **C2 merges it into dev** once its own tree is clean (they overlap in simabi and genabi). It edited shared `src/app/main.ts` and `src/shared/protocol.ts`, so expect merge conflicts with C4 and C5 |
| C5 | UI and input v0 (Factorio UI and keybindings, Survey skin) | done, on a branch (4 commits; 62 Vitest and 13 Playwright tests). Codex r1: 19 of 20 fixed (#9 chained craft counts deferred to M1). The full flow works on the real sim, and the hash after load matches. **C8 merges it into dev.** 22 proposed strings await the text owner. Earlier open items: Load cannot load a fake save; the e2e port 5191 collides between worktrees |
| C4 | Renderer v0 and asset loader (Survey shaders, KTX2) | done, on a branch (7 commits, 02f302b): Survey day and cyanotype night verified. Codex r1's 12 findings fixed. **Merged into dev (e65bacf)**; dev CI green in 79 s. The world-view API for the UI is `src/shared/world-view.ts` |
| C6 | Asset pipeline v0 (Survey): rig, passes, layered renders, KTX2 atlases, manifest, greyboxes, M0 art | done and merged (b2bec76, then the r1 fixes in 78b9e87). The C6-r1 agent is fixing GATE-r2 #2 |
| C7 | Audio v0: worklet engine port, mixer, SFX, working sounds | done and merged (257f698). Codex r1's 15 findings are fixed; CPU is 6.4% (Era I) and 7.6% (Era II) of a reference core. The user is asked about 32 kHz via https://claude.ai/artifact/XDaRFjpsqnZEpFk7qveyeT |
- Spec §9.5 #5: restate the texture PSNR targets to match the floors measured on real pages (decision 13).
- M1 download budget: greyboxes add 0.83 MB, which B2's model left out, so the M1 first frame projects to about 5.6 MB against the 5 MB gate. Do not load greyboxes of entities not yet unlocked; stream them lazily.
- Belts (M1): C6 proposed a bit assignment for the belt mask (pm/reports/C6.md). The sim package must agree to it before belts are built.
- Asset cache: new worktrees should copy `game/.cache/assets` from the main tree, because a cold `npm run assets` takes 12 min.
- The CHARACTER projection's change sources are incomplete in the schema (mining and crafting progress, `input_gen`, flags). From C1c; fix it in the gate fixes or in C2c.
- The fake sim uses the M1 prototype build while the art and audio use M0. The renderer and audio need a fake-mode exception that matches by name (C1c issue 4).
- The data stage does not read `sounds.yaml` yet, and the tree-species table is empty (C1c and C7).
- §15.10: "3×3 chunks" should read 96×96 tiles (C1c issue 6).
- Playwright ports collide across worktrees (5191 by default). Run with `PW_PORT` and `PW_RELEASE_PORT` set per worktree; consider auto-picking a free port in the Playwright config.
- C3 proposal: `debug_dump(0xFFFFFFFF)` should panic in dev builds so the real-module panic test runs (for C2c).
- Not done: the one-tab lock (needs a C5 dialog) and `POST /__report` (QA tooling).
- CI flakiness: C1a's data-stage test has a 10 s setup timeout that fails while cargo compiles under load. Raise the timeout and build the test binaries first. Add `simtool bench --quick` to ci as the budget gate (`scripts/ci.ts`).
- C3's `real.test.ts` can stop skipping C2c's exports.
- The tick does not pre-regenerate around characters (extraction fills 8 chunks per packet); revisit for M1 movement speed.

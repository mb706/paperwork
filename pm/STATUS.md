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
| C1c | Fake sim, reference model, frozen M0 golden set (gate items 4 and 6) | running (commits to `dev`) |
| C6 | Asset pipeline v0 (Survey): rig, passes, layered renders, KTX2 atlases, manifest, greyboxes, M0 art | done and merged (b2bec76). Cold build 12 min, warm 30 s; the cache is in the main tree's `game/.cache/assets`. Codex r1: 1 critical, 8 major. A fresh agent (C6-r1) is fixing them in a worktree |
| C7 | Audio v0: worklet engine port, mixer, SFX, working sounds | done, on a branch. Codex r1: 12 major; the agent is fixing them. The user is asked about 32 kHz via its A/B page https://claude.ai/artifact/XDaRFjpsqnZEpFk7qveyeT |
- Spec §9.5 #5: restate the texture PSNR targets to match the floors measured on real pages (decision 13).
- M1 download budget: greyboxes add 0.83 MB, which B2's model left out, so the M1 first frame projects to about 5.6 MB against the 5 MB gate. Do not load greyboxes of entities not yet unlocked; stream them lazily.
- Belts (M1): C6 proposed a bit assignment for the belt mask (pm/reports/C6.md). The sim package must agree to it before belts are built.
- Asset cache: new worktrees should copy `game/.cache/assets` from the main tree, because a cold `npm run assets` takes 12 min.

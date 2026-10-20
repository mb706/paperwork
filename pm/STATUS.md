# Project status (maintained by the manager)

## Phase A: pre-implementation studies (started 2026-10-20)
| WP | Topic | Agent | Status |
|---|---|---|---|
| A1 | Engine study: TS vs Rust/WASM, render boundary, scale | Opus | done: recommends Rust→WASM as a clean split (1.35–1.75× faster, no JIT stalls). Codex second opinion r1 running |
| A2 | Multiplayer architecture (lockstep, relay, no P2P UDP) | Opus | done. `design/multiplayer/DESIGN.md`. Codex r1 found 1 critical and 14 major issues; the agent is fixing them |
| A3 | Art direction (3 directions → 1, style guide) | Opus | running |
| A4 | Audio direction (music + SFX, engine choice, demos) | Opus | running |

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

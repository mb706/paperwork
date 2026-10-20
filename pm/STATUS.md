# Project status (maintained by the manager)

## Phase A: pre-implementation studies (started 2026-10-20)
| WP | Topic | Agent | Status |
|---|---|---|---|
| A1 | Engine study: TS vs Rust/WASM, render boundary, scale | Opus | running |
| A2 | Multiplayer architecture (lockstep, relay, no P2P UDP) | Opus | running |
| A3 | Art direction (3 directions → 1, style guide) | Opus | running |
| A4 | Audio direction (music + SFX, engine choice, demos) | Opus | running |

Next: codex reviews of A1/A2, then Phase B (an architecture revision that folds A1–A4 into the spec), then M0.

## Conventions
- Branch `dev`, with local checkpoint commits by the manager. Nothing is pushed unless the user asks.
- Briefs: `pm/wp/`. Reports: `pm/reports/`. Codex reviews: `pm/reviews/` (via `tools/codex-run.sh` or `codex exec review`).

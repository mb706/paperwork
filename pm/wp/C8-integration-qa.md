# C8: M0 integration, test harness and exit QA

**Owner:** one Opus agent, working in the main tree on branch `dev`.
- **Commits:** commit at milestones with `git commit -m "..." -- <paths>`, never a plain `git commit` after `git add`. Messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push or rewrite history.
- **Writes to:** the test harness and benchmark runners (`game/test/**` other than the golden set, `game/bench/**`, `game/e2e/**`), the dev endpoints in `game/src/dev/**`, `game/playwright.config.ts`, `game/scripts/ci.ts` where the harness needs it, `CLAUDE.md` (testing and QA sections), and `pm/reports/C8.md`.
- **Fixing other packages' code:** allowed only for integration defects, kept small and each listed in your report. Larger defects are reported, not fixed.
- **Parallel agent:** the UI package (C5) is finishing its review fixes in its worktree and will merge into `dev` while you work. Do not edit `game/src/ui/**` until it has merged; afterwards, only integration fixes.

## Context

M0 (10 §12) is nearly done:
- **On `dev`:** the contract (C1a–C1c, the golden set v7), the Rust sim (C2), the worker shell (C3), the renderer (C4), assets (C6) and audio (C7), all reviewed by codex and with their fixes merged.
- **Still coming:** the UI (C5).

Your job is to finish M0's **integration and QA** package and drive M0 to its exit.

## Read

- `CLAUDE.md`, `pm/README.md`, `pm/DECISIONS-IMPL.md`, `pm/STATUS.md`.
- `design/spec/10-architecture.md`:
  - §10 (testing and verification: the pyramid, the scenario DSL, goldens, D18's suites, E2E and screenshots, benchmarks, verification loops, rule scenarios);
  - §3.5 (dev hooks and endpoints);
  - §11 (performance targets);
  - **§12, M0's exit criteria and the Integration row**.
- `design/spec/11-multiplayer.md` §7 (D18's cross-engine trace).
- The reports `pm/reports/C2.md`, `C3.md`, `C4.md` and `C5.md` (once merged), for what exists and what is open.

## Deliver

1. **The test harness** per §10, reusing what exists rather than duplicating it:
   - the scenario DSL (§10.2) and the rule-scenario folder (§10.8);
   - D18's suites, including **(d), the cross-engine trace**: identical natively, in Node, Chrome and Firefox on a 10,000-tick log and on the golden set;
   - the trace page;
   - golden helpers;
   - Playwright config that **auto-selects free ports**, so parallel worktrees stop colliding.
2. **Benchmarks:** the browser benchmark runner and `bench.html` (§10.6), which runs on the user's machine, plus the host-factor calibration and A/B in one session (decision 3).
3. **The dev-server endpoints** (§3.5): `/__bench`, `/__report` (bug reports with a bundle) and `/__shot`.
4. **M0 exit:** verify every exit criterion in §12 one by one and record the evidence in your report, as a table: criterion, how verified, result. In particular:
   - the placeholder character walks on generated terrain at 60 UPS through the `LocalSequencer`, in Chrome, and in Firefox with `?render=none`;
   - chests are placed, filled and mined through actions natively, in Node through the shell, and **through the real input layer in Playwright** (after C5 merges);
   - INVENTORY and STATS come from real projections;
   - save, load and hash match natively and in the browser;
   - world replacement and trap recovery work end to end;
   - every manifest closes;
   - `npm run ci` is green under M0's capability manifest.

   Fix small integration defects; report larger ones.
5. **The smoke screenshot set:** menu, new game, walking, the character screen, a placed and opened chest, and the night. Take them in Chrome at 1920×1080, view each one, and judge it critically against `design/art/DIRECTION.md` and the approved mocks. Save them under `pm/reports/C8/`.
6. **A short "how to play the M0 build" note** for the user in `pm/reports/C8.md`: the dev-server command, the URL for the SSH tunnel (CLAUDE.md, "Showing the game"), and the controls.

## Quality bar

- Evidence over claims: every exit criterion has a command or test and its output.
- **No flaky tests.** Run CI three times in a row and report all three times.
- Pin heavy jobs with `taskset -c 0-15`.

## Report

`pm/reports/C8.md`. Your final message is at most 200 words: the M0 exit status per criterion (pass or fail) and the top open issues.

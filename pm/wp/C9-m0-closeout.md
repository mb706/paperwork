# C9: M0 closeout (audio on the game page, CI speed, ore-patch polish, the exit audit's fixes, a playable preview)

**Owner:** one Opus agent, working in the main tree on branch `dev`.
- **Commits:** commit with `git commit -m "..." -- <paths>`, never a plain `git commit` after `git add`. Messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push or rewrite history.
- **Other agents:** the golden-set owner may commit a bump to `game/test/golden/` at any time. Do not touch that directory.
- **Writes to:** whatever the items below need, kept minimal, plus `CLAUDE.md` and `pm/reports/C9.md`.

## Context

M0 has passed its exit criteria (`pm/reports/C8.md`). Codex is independently auditing that exit (`pm/reviews/M0-exit.md`, still being written). The manager will send its findings to you as an extra item. Close M0 cleanly so M1 starts from a good baseline.

## Read

- `CLAUDE.md`, `pm/README.md`, `pm/DECISIONS-IMPL.md`, `pm/STATUS.md`.
- `pm/reports/C8.md`, especially its open issues, and `pm/reports/C7.md` (the audio runtime and its API).
- `design/spec/10-architecture.md` §9.4 (audio), §15.6 (events and audio), §10 (testing) and §3.1 (threads).

## Do

1. **Sound in the game.** Attach C7's audio runtime to the game page through the composition root (`src/app/`), using the same one-line extension pattern as the renderer and the UI.
   - Feed it the packet events, `AUDIO_WORKING` and the music feed, with the historical flag honoured: no sound during catch-up or replay.
   - Connect the UI's volume settings.
   - Resume the AudioContext on the first user gesture.
   - Verify it in Chrome: the music starts on the menu, and building, mining, crafting and UI clicks make their sounds. An offline-render test of a short scripted session, with loudness and no clipping, would be ideal.
2. **CI speed.** `npm run ci` now takes about 3 minutes. Add `npm run ci:fast` for the inner loop: lint, typecheck, unit tests and native cargo tests, without e2e, release or benches. Target ≤ 60 s warm. Keep the full `ci` as the merge gate and make it faster where possible without losing coverage: run independent lanes in parallel, and skip unchanged lanes safely. Document both in `CLAUDE.md`, and tell agents to run the full gate before reporting done.
3. **The ore patch renders as a visible grid** (C8 open issue 4). Find whether it is the art (C6's depletion-band sprites) or the renderer (C4's resource placement), and fix it so a patch reads as one natural deposit, like the approved mocks in `design/art/mocks/`. View before and after screenshots.
4. **The exit audit's findings,** when the manager sends them.
5. **A stable preview for the user:**
   - when 1–4 are done and the full `ci` is green, create a local annotated tag `m0` on `dev` (no push);
   - create a separate worktree at `m0` (`git worktree add /home/mewse/browsergame/.claude/worktrees/play-m0 m0`), build it (`npm ci && npm run assets && npm run build`), and serve it with `npm run preview` on **127.0.0.1:4173**, in the background (`nohup`, with a log file), so it stays up;
   - check that it loads in Chrome, and take a screenshot.

   Write the exact commands for the user into your report: the SSH tunnel `ssh -L 4173:127.0.0.1:4173 cpuserver10`, the URL and the controls.

Your final message is at most 150 words, and confirms the preview URL works.

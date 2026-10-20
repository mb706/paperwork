# Implementation process

**If you are an agent, read this first.**

The main Claude session (the **manager**) runs the project. Work is split into **work packages** (WPs), and each WP has a brief at `pm/wp/<ID>.md` written by the manager. Claude agents (Opus) implement. Codex (`gpt-6.1-sol`, reasoning effort xhigh) reviews. The current state of the project is in `pm/STATUS.md`.

## What the game is and who it is for

*Paperwork* (*Information is physical.*) is a faithful Factorio 2.0-like about AI research. Its spec is complete:
- the entry point is `design/spec/README.md`;
- binding design decisions are in `design/DECISIONS.md`;
- implementation-time engineering decisions are in `pm/DECISIONS-IMPL.md`. The manager owns that file; propose additions in your report.

The user is a Factorio veteran and an AI/ML academic in the LessWrong sphere, and will show the game to academic colleagues. Their standing preferences decide the many small calls you will make:
- **Factorio's fun comes first.** Keep its mechanics, numbers, UI, menus and keybindings faithful. A deviation must pay for itself.
- **Clever, not silly.** Match Universal Paperclips' register: accurate, sparse text, irony carried by the mechanics. No "burns coffee to make ideas" jokes and no preachiness. All in-game text comes from the spec's text canon (`design/spec/08-text.md`, `design/spec/data/text.yaml`); never invent player-facing strings ad hoc.
- **One coherent ontology:** *information is physical*.
- **Expert-level accuracy** in anything about AI, ML, computing or the history of science.
- **Polish matters:** everything should feel just right, with few annoyances and small bugs, and be a joy to play because it is well made. Performance matters, because this is a browser game that must scale to a late-game factory.
- **Multiplayer comes late, but the design must allow it from day one.** Every change to simulation state goes through tick-stamped input actions, and the simulation is bit-for-bit deterministic across browsers.

## Your job as a WP agent

1. **Read first.** Read `CLAUDE.md`, this file, your brief, and the spec sections the brief names.
   - Read large files in parts (offset and limit, or `sed -n`).
   - The spec is about 150k words. Read what you need, not everything.
2. **Stay inside your scope.**
   - Keep to your brief's scope and file ownership.
   - The spec was written with a lot of thought, so follow it by default.
   - If the brief or the spec is wrong, impossible, or clearly worse than an alternative you can name, make the smallest good call. Record it under *Deviations* in your report, with the reason, and keep going.
3. **Verify your own work.** Use tests, checks, benchmarks and screenshots: for screenshots, take them with Playwright and then Read the PNG; check console errors every time. "It compiles" is not done.
4. **Report.** Write your report to `pm/reports/<ID>.md` using the template below.
   - Your final message to the manager is a short summary of at most 200 words: the status, the report's path, and the top open issues.
   - The manager reads the full report only when needed, so put the detail there.
5. **Git and system limits.**
   - Do not commit, push or switch branches unless your brief says so; the manager commits checkpoints.
   - Never touch `~/.ssh`, the git remotes or system settings.
   - No root and no reboots. Never touch `/dev/dri` or GPU drivers.
6. **Installing tools.**
   - Install tools only in user space, following the layout in `CLAUDE.md` (`~/.local/opt/<tool>-<version>`, commands in `~/.local/bin`).
   - Record every new tool in your report, and in `CLAUDE.md`'s toolchain section if other agents will need it.
   - Never `pip install --user` into the system Python. Use `uv` and the `gamedev-python` venv.
7. **Keep the tree clean.**
   - Use your scratchpad directory or `.scratch/` (gitignored) for throwaway files.
   - Large generated binaries (renders, audio masters) belong under a gitignored path unless the brief says they are deliverables.

When the manager sends you a codex review (`pm/reviews/<ID>-r<n>.md`), handle every finding and append a *Review response* section to your report. Mark each finding **Fixed** (say how), **Rejected** (give the reason) or **Deferred** (give the follow-up).

## Report template (`pm/reports/<ID>.md`)

```markdown
# <ID>: <title>
Status: done | partial | blocked

## Summary
What exists now and how to use or run it.

## Decisions and deviations
Each with its reason. Name the spec section where it deviates.

## Verification
Commands run and their results, numbers and screenshots.

## Open issues and follow-ups
Ordered by importance.

## Files
Created and changed.
```

## Manager note: worktrees

Keep a worktree agent's worktree until its codex review cycle is complete. A removed worktree cannot be resumed, so the fixes would need a fresh agent.

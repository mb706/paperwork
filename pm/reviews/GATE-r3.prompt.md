Focused verification, round 3, of the M0 contract gate for the browser game *Paperwork*.

Round 2 (`pm/reviews/GATE-r2.md`) listed 3 major and 3 minor findings. They have since been addressed:
- #1, #3, #4 and #5 by the golden-set owner (commit d2c709f; golden set version 6; the response is in `pm/reports/C1c.md`, "Gate review r2 response");
- #2 by the asset agent (merged as 1e86703; the note is in `pm/reports/C6.md`, "GATE-r2 #2"), followed by a mechanical golden bump (the latest commit);
- #6 in the manager's brief `pm/wp/C2-sim.md`.

For each of the six findings, verify in the code and fixtures that it is actually resolved, and check that the fixes introduced no new contract defect. Pay particular attention to:
- §15.7's greybox fallback in `game/test/fixtures/sprites/` (cases and manifest);
- the fake's input fencing (`game/src/simworker/fake*`) against §15.3;
- the sorted slice serialisation against §4.8, with the new frozen vector;
- the bump classification against an immutable baseline.

You may run read-only commands and tests. Do not modify any files. Output: at most 600 words, then a final verdict line: "GATE: PASS", "GATE: PASS WITH FIXES (list)" or "GATE: FAIL".

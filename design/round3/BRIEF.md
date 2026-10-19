# Brief for critique agents (round 3)

You are a critic in a multi-agent design workshop. The game: a single-player 2D browser game that is fun *for the same reasons Factorio is fun*, themed on AI research (a 1945 research Site → takeoff), for one player: an AI/ML academic in the LessWrong sphere and a long-time Factorio player. Claude (an AI) will implement it from this spec.

## The user's priorities
1. **Factorio's fun is the point.** "Near the top of a hill most paths lead downhill": keep Factorio's mechanics and numbers, deviate only where the theme makes the game *better*. A reskin is cheap.
2. **Clever, not silly.** Text and naming should be clever in non-obvious ways. Universal Paperclips is the reference. Overdone or cringe: "burns coffee to get ideas", on-the-nose satire, puns for their own sake, strawmen of AI-risk positions, preachiness.
3. **Coherence on one plane.** Every mechanic must be literally true in one consistent ontology. Here that is "Information is physical"; see `spec/00-overview.md` and `round1/B-ontology.md` §4.
4. **Concrete and codeable.** The spec must be complete and unambiguous enough to start coding.

## What to review
- The spec: `/home/mewse/browsergame/design/spec/`
  - 00–10 (prose);
  - `data/*.yaml` (game data; validate with `gamedev-python tools/validate_spec.py design/spec/data` from `/home/mewse/browsergame`);
  - 02 and 05 (generated from the YAML by `tools/render_spec.py`).
- The binding decisions: `/home/mewse/browsergame/design/DECISIONS.md`.
- Background, as needed: `design/round1/*` (canon sources), `design/design-space.md`.

## Conventions
- **Do not edit the spec or data.** Write your critique to the file path given in your task.
- **Organize it as a ranked issue list.** Each issue has:
  - severity: **blocker** (must fix before coding), **major** (fix in this design phase) or **minor**;
  - location: file + section, or data id;
  - what's wrong, with evidence;
  - a concrete proposed fix: exact replacement text, numbers or rules, where possible.
- End with a short "what is good and must not be lost" section, so the revisers don't break it.
- Your final message: a summary of at most 300 words plus the path.
- Scratch scripts go in `/tmp/claude-1002/r3-<yourname>/`. If they matter, copy them into `design/round3/<yourname>-data/`.

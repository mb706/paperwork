# C1c: The fake sim, the reference model and the M0 golden integration set (contract gate, part 3)

**Owner:** one Opus agent, working in the main tree on branch `dev`.
- **You may commit** to `dev` at milestones. Stage only your own paths; never `git add -A`; never push or rewrite history. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Writes to:** `game/src/simworker/fake*` (and the small wiring §15.10 implies), `game/test/golden/**` (or wherever §15.10 puts the golden set), the reference model's location, `game/test/fixtures/packets/**`, `CLAUDE.md` (the code section), and `pm/reports/C1c.md`.
- **Must not touch:** `design/**` or the schema, unless a gate defect forces it. In that case make the smallest schema change, run `npm run gen`, and list it prominently in your report.
- **Parallel agents:** two agents work in their own worktrees on assets (C6) and audio (C7). They do not touch your files.

## Context

M0's contract gate (10 §12) has six items:
- **Items 1–3 are done** (C1b: the schema, the generator, the codec fixtures; `pm/reports/C1b.md`). Item 5 is done too (C1a: the capability manifest).
- **This package delivers item 4, the fake sim (`STATS` included), and item 6, the frozen M0 golden integration set with the reference model that produces it.**

When the gate closes, the parallel packages start. Their first deliverable is to pass the golden set from their side:
- the sim reproduces the golden states and digests, natively and in WebAssembly;
- the shell replays the golden closure log;
- the renderer draws the golden packets with the tiny atlas;
- the UI shows the golden projections.

So the golden set is the **referee** between agents who never talk. Its expected values must be right by construction, which is why they come from a reference model and not from any of the implementations.

## Read

- `CLAUDE.md` (its "The code" section), `pm/README.md`, `pm/DECISIONS-IMPL.md`.
- `pm/reports/C1a.md`, `pm/reports/C1b.md`, `game/schema/README.md`.
- `design/spec/10-architecture.md`:
  - **§15.10** (fixtures, the fake sim, the golden set);
  - §15.3–§15.7 (closures, the packet, projections, events and audio, the sprite manifest with its explicit index tables and their fixtures, which B2 put into the golden set);
  - §3.2–§3.4 (worker messages, the tick loop, the view model);
  - §4 (the sim core: its rules and digests, §4.8);
  - §5.1–§5.2 (the character, inventories, hand mining and crafting, construction at M0's scope);
  - §8 (saves, closure logs);
  - §12 (the contract gate, M0's capability manifest).
- `game/data/engine/capabilities.yaml`: what M0 supports.

## Deliver

1. **The fake sim worker** (§15.10). It speaks §3.2's protocol and writes packets with the **generated** encoders. It produces:
   - generated terrain, and a grid of chests and machines with animated `DYN` records;
   - belts with moving items as gap arrays, and inserter hands;
   - a walking character driven by `act` messages;
   - events, with working sounds and the music feed for audio (B1 round 3);
   - the `CHARACTER`, `INVENTORY`, `HUD`, `DEBUG` and **`STATS`** projections.

   It must exercise every packet section and projection a renderer, UI or audio package will consume in M0, with realistic values and at realistic rates. `?sim=fake` selects it. Make it deterministic: seeded, and the same packets for the same inputs.
2. **The reference model** of M0's rules: a small, readable TypeScript model, per §12, of exactly what M0's capability manifest covers:
   - character movement and collision;
   - placing, filling and mining a chest;
   - hand mining of the M0 resource and hand crafting of the M0 recipe;
   - inventories;
   - the closure pipeline's validation, refusals and input fencing at M0's scope;
   - the digests (§4.8) and the state hash.

   It is a specification you can execute, not an engine. Optimise for obvious correctness: straight-line code, comments citing spec sections.
3. **The frozen M0 golden integration set** (§15.10 lists its parts):
   - the M0 prototype set (the data stage's M0 build, frozen);
   - a start save;
   - a closure log that exercises every M0 action, including refusals and the negative cases;
   - the expected states and **per-tick digests**;
   - the expected record of **every M0 projection** at chosen ticks;
   - expected packets;
   - the sprite index fixtures from §15.7;
   - **a tiny compatible atlas** in the real manifest format.

   On the atlas: the asset pipeline (C6) is being built in a worktree right now. Make the tiny atlas with the minimal tooling needed, in exactly the §15.7 manifest format, so the renderer can test against it. C6 will later produce the real one in the same format.
4. **Freezing.** The golden set is versioned and checksummed. A test fails if any golden file changes without a version bump. The README in the golden directory says how each package consumes it.
5. **Tests in `npm run ci`:**
   - the reference model reproduces the golden set;
   - the fake sim's packets decode with the generated decoders;
   - the golden packets and projections round-trip through the decoders.

## Quality bar

- The golden set is the referee. **Every expected value must be justified by the spec**: cite the section in the model's comments.
- Where the spec is ambiguous, decide in the model, list the decision in the report, and make it a fixture, so all parallel packages inherit one answer.
- Keep it M0-sized. No systems beyond the capability manifest.
- `npm run ci` is green. Report its time.

## Report

`pm/reports/C1c.md`, using the template, with a section "How each package consumes the golden set". Your final message is at most 200 words.

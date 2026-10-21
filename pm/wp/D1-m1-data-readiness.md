# D1: M1 data readiness (typed design data and the engine overlay for the slice)

**Owner:** one Opus agent, in its own git worktree (the manager sets it up).
- **Commits:** commit on your branch, with messages ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Writes to:**
  - `design/spec/data/*.yaml` and `design/spec/data/SCHEMA.md`;
  - `tools/validate_spec.py`, and the check scripts in `design/round3/impl-data/` where they read the changed fields;
  - the generated chapters, but only by running `tools/render_spec.py` and `tools/render_slice.py`, never by hand;
  - the data stage's schemas and overlay in `game/scripts/data-stage/**` and `game/data/engine/**`;
  - `pm/reports/D1.md`.
- **Must not touch:** the crates, `game/src/**`, the schema (`game/schema/`) unless a typed field must reach the engine (then the schema process: `npm run gen`, the compat ledger, the golden owner's bump), or the other spec chapters beyond factual consistency.

## Why

M1 (the vertical slice, `design/spec/09-vertical-slice.md` and 10 §12 M1) builds belts, inserters, crafting machines, furnaces, labs, mining drills, electric poles, power, the Memo and Report research tiers, towns, staffing and more. Their systems read numbers from the data. The data stage (C1a) found that several values the engine needs are still **prose**, typed only as `doc`, and that the engine overlay lacks M1's geometry and tables. The M1 system packages must not invent numbers, so the data has to be complete and typed before they start.

## Read

- `CLAUDE.md`, `pm/README.md`, `pm/DECISIONS-IMPL.md`.
- `pm/reports/C1a.md`: its "Design data, J1" and "Engine overlay content" items are your starting list. Also `pm/reports/C1b.md` (the 50 omitted parts, and which are M1's).
- `design/spec/09-vertical-slice.md`: all of it, the slice's contents and its manifest §2.7.
- `design/spec/10-architecture.md` §2.4 (the data stage, the overlay), §5.3–§5.7 (belts, inserters, crafting, mining, energy: the numbers they read), §5.9–§5.12 (heat, staffing, world text, research) and §12 M1.
- `design/spec/data/SCHEMA.md`, and the YAML.
- Factorio 2.0's real numbers, where the spec says "Factorio's": the scraped wiki and prototype data in `design/round1/E-data/` and `design/round1/I-data/`. You may use WebSearch and WebFetch (load them through ToolSearch) to confirm. Cite the source for each number.

## Do

1. **Type every prose value an M1 system reads.** Pole supply and wire reach, beacon fields if the slice has beacons, underground belt and splitter throughput, and so on. For later-milestone prose (silo, combinators, turrets, fluid boxes), type it if it is cheap; otherwise list it as deferred, by milestone.
2. **Complete the engine overlay for M1** (§2.4):
   - inserter pickup and drop vectors, and the swing timing;
   - mining-drill areas and output positions;
   - belt lane geometry;
   - map colours;
   - terrain materials as worldgen v1 needs them;
   - Factorio's numbers for every slice entity (C1a: "beyond the three chests");
   - subgroup refinements;
   - the event-to-sound map entries for the slice's machines, with the audio package's `sounds.yaml` as the format.

   Each number cites Factorio or the spec.
3. **The M1 capability manifest:** extend `capabilities.yaml` with an `m1` entry naming the actions, projections, queries, packet sections and systems M1 implements. The M1 packages will build against it.
4. **Keep every check green:**
   - the validator: 0 errors, 0 warnings;
   - `render_spec.py --check` and `render_slice.py --check`;
   - `r3_checks.py` and `r3_xref.py`;
   - `manifests.py`;
   - the data stage, and `npm run ci`.

   If the prototype output changes, coordinate the golden set as a mechanical bump: tell the manager in your report. The golden owner runs it at merge.
5. **The report** lists every value added or changed, with its source, and the deferred list by milestone.

## Quality bar

Numbers are right, sourced, and typed. No silent invention. Where Factorio has no equivalent (this game's own mechanics), use the spec's value and cite the section; if the spec has none either, say so and propose one, marked as a proposal.

Your final message is at most 200 words, and includes your worktree path and branch.

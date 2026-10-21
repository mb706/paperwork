# M1-01: The M1 contracts and fixtures

**Plan:** `pm/plans/M1-plan.md`, package 01. This is the first M1 package, and it gates the rest.

**Owner:** one Opus agent, working in its own git worktree branched from `dev` (`git -C /home/mewse/browsergame worktree add /home/mewse/browsergame/.claude/worktrees/m1-01 -b m1-01 dev`). Copy the asset cache from the main tree. Commit on branch `m1-01`; the manager merges.
- **Writes to:** `game/schema/**` and the generated code (via `npm run gen` and the compat ledger), the data stage (`game/scripts/data-stage/**`, `game/data/engine/**`), fixtures under `game/test/fixtures/**`, the fake sim (`game/src/simworker/fake*`) for the new sections, the reference-model extensions for M1 reference cases (in coordination with the golden-set rules, `pm/DECISIONS-IMPL.md` 14), `CLAUDE.md`, and `pm/reports/M1-01.md`.
- **Must not touch:** the sim systems in `game/crates/sim/src/rules/**` (M1 system packages own them), or the renderer, UI and audio, beyond regenerated code compiling.

## Why

M1's system packages (02 onwards) will each build one game system end to end: sim, packet, renderer, UI, art, sound. They need the **contracts first**:
- the prototype fields M1 reads, typed in `prototypes.bin` and `prototypes.json`;
- the packet sections, projections, events and actions M1 adds;
- the saved, derived and presentation classification of M1 state;
- the fixtures that pin them.

M0 showed that a precise, executable contract lets agents work independently. Repeat that for M1.

## Read

- `CLAUDE.md`, `pm/README.md`, `pm/DECISIONS-IMPL.md`, `pm/plans/M1-plan.md` (especially package 01 and the "Foundations and working rules").
- `game/schema/README.md` and the golden set's README.
- `pm/reports/D1.md`: the M1 manifest's `reads` and `data` that must be wired through the schema, and the deferred list.
- `pm/reports/C1a.md` and `pm/reports/C1b.md`: the 50 omitted parts.
- `design/spec/09-vertical-slice.md`, and `design/spec/10-architecture.md` §5 (M1's systems: what each reads and writes), §8.3 (versioning and migration), §15 (the contracts) and §12 M1.
- `pm/reports/C6.md` (the belt-mask bit proposal) and `pm/reports/C4.md` (the inserter rest pose, `MOVERS.base_tick` for idle clips).

## Do

1. **Prototype fields.** Move every M1-consumed field from the data stage's `omitted` list into typed binary and JSON output: geometry, fluid boxes, staffing, heat, world settings, effects, citations, and whatever D1's M1 manifest names. The loaders refuse a build that lacks a block the manifest's `data` names.
2. **Schema for M1.** Add the M1 packet sections, projections (the entity GUIs for each M1 kind, research, statistics, chart and minimap feeds…), events, actions and queries.
   - Classify the new state as saved, derived or presentation.
   - Fix canonical ordering, units, masks and projection revisions.
   - Supply migration defaults (§8.3) so an M0 save loads into an M1 build.
   - **Settle** the belt mask bits (C6's proposal) and the inserter rest-pose and idle-clip semantics (C4's questions). Record both as decisions in your report.
   - Use the compat ledger with version bumps.
3. **Capability subsets.** Establish tested *development* capability subsets, so packages can enable their own systems while the full M1 manifest is incomplete. `--allow-incomplete` is for development only, and release builds refuse it.
4. **Fixtures.**
   - Codec fixtures for every new record, in both languages.
   - Fake-sim examples for every new section and projection, so the UI and renderer can build against them.
   - The first M1 reference cases for the golden set, small and focused. Each new frozen expectation follows decision 14, so list them for the manager's approval in your report.
5. **The rulings codex flagged.** Record an acceptance ruling for 09's "no heat UI" against 07's ambient-only map when Heat is off. Propose it in your report, with a citation to both texts; the manager decides.
6. **Regressions.** M0 still passes: the golden set (mechanical bumps only, where layouts move), every cross-language codec, and `npm run ci`.

## Quality bar

As C1b: two independent consumers must agree byte for byte by reading only the schema and generated code. Codex will review this package as a gate before the system packages start.

Report in `pm/reports/M1-01.md`. Your final message is at most 200 words.

# C1b: The schema, the generator and the codec fixtures (M0 contract gate, part 2)

**Owner:** one Opus agent, working in the main tree on branch `dev`.
- **You may commit** to `dev` at milestones (stage only your own paths; never `git add -A`; never push or rewrite history). End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Writes to:** `game/**`, `CLAUDE.md` (the code section only) and `pm/reports/C1b.md`.
- **Must not touch:** `design/**`. Report spec problems; the manager routes them.

## Context

M0's Schema package is the **executable contract** of the engine (10 §12, "The contract gate"; `pm/DECISIONS-IMPL.md` 1 and 12). It is split into three parts:
- **C1a (done, `pm/reports/C1a.md`):** the repository, toolchains, CI, `check-arch`, the data stage, the capability manifest, and a stub `scripts/schema-gen.ts`.
- **C1b (this one):** gate items 1–3. They are the machine-readable schema with complete layouts for every M0 record, the generated code in both languages with readers and writers for every record, and the codec fixtures.
- **C1c (next):** the fake sim (gate item 4) and the frozen M0 golden integration set with its reference model (gate item 6).

After C1c, codex reviews the gate. Then four to six agents build the sim crate, the worker shell, the renderer, the UI, assets and audio **in parallel against what you generate, without talking to each other.** Every ambiguity you leave becomes an incompatibility later. Completeness and precision matter more than anything else here.

## Read

- `CLAUDE.md` (its new "The code" section), `pm/README.md`, `pm/DECISIONS-IMPL.md`.
- `pm/reports/C1a.md`, especially its open issues 1–3, which are now yours, and `game/schema/README.md`.
- `design/spec/10-architecture.md`:
  - "Changes in v2";
  - **§15 in full**: the schema and generator, the prototype data path, actions and closures, the render packet, projections and subscriptions, events and audio, the sprite manifest's lookup contracts, the ABI, worldgen, fixtures, ownership;
  - §3.2 (worker messages);
  - §4.3–§4.5, §4.8 and §8.1 (ids, handles and serials, pools, digests, the save container and sections);
  - §12 (M0 scope, the capability manifest, the contract gate).
- `design/spec/11-multiplayer.md` §7 (the seams, D-rules) as it bears on the formats.

Another agent (B2) is just finishing codex fixes to 10 §15.6–§15.7 and §9. Check `git log` for "B2" commits before you encode those sections, and re-read them if they changed.

## Deliver

1. **The machine-readable schema** in `game/schema/`. It covers every record listed in gate item 1:
   - every M0 action and system action, event, projection kind and query kind;
   - the packet header and every M0 section;
   - the save sections of M0's state;
   - `new_world`, `sim_meta` and load reports;
   - every ABI export with its input and output records (`abi.yaml`);
   - `ChunkData`;
   - the `prototypes.bin` tables, moved from C1a's `emit/tables.ts`, and the `prototypes.json` schema;
   - every numeric registry and namespace table, including `registries.yaml` from C1a's open issue 2.

   Layouts give exact widths, endianness, alignment, ordering and versioning, as §15.1 requires. `SCHEMA_HASH` hashes the **resolved layouts**: offsets, padding, widths, enum values (B1-r1 finding 3). Add a test that every wire-layout change changes the hash.
2. **The generator** (`scripts/schema-gen.ts`) and its outputs, as §2.2 and §15.1 list them:
   - Rust in `crates/schema` and `crates/sim/src/gen`;
   - TypeScript in `src/shared/gen`.

   That means:
   - the types, enums and registries;
   - codecs in both directions where each side needs them;
   - the Rust writers and TypeScript decoders for packets, events and projections;
   - the TypeScript action encoders and the Rust decoders with preflight validation;
   - the save-section structures;
   - the generated `Protos::load`, which refuses malformed bytecode programs;
   - the handshake constants (`SCHEMA_HASH`, `PROTOCOL_VERSION`).

   Generated code compiles and is lint-clean. `schema-gen --check` catches any drift, and `check-arch` refuses hand edits.
3. **Codec fixtures** (§15.1, D18(g)), in both directions and both languages:
   - generated round trips;
   - hand-written byte-exact fixtures for the important records;
   - probes at every limit: maximum lengths, counts and enum values, and an overflow just past each. Malformed input must be refused, never trap and never misread.

   Fixtures live in `game/test/fixtures/codec/` and run in `npm run ci`.
4. **C1a's leftovers.**
   - The character's prototype numbers get a proper home, the engine overlay or wherever §15.2 fits best, and so does the record that `MOVERS`' `proto` names (C1a open issue 3).
   - The data-stage checks against the registries; the capability manifest's names checked against the schema; `prototypes.json`'s `localeKeys` filled in (open issue 2).
5. **Docs.** Expand `game/schema/README.md` into the guide for every later agent: how to add a record, field, action, projection or section; how generation, versioning and the hash work; how fixtures are added; what `--check` enforces. Keep it concise and example-led.

## Quality bar

- **Two independent consumers must agree byte for byte on every M0 record** by reading only the schema and the generated code.
- Keep the generated code readable: it will be debugged.
- Generation must be deterministic: run it twice and get byte-identical output.
- `npm run ci` is green. Report the CI time and the generator's run time.
- If the spec is ambiguous, decide, write the decision into the schema with a comment naming the spec section, and list it in the report under *Decisions*.

## Report

`pm/reports/C1b.md`, using the template. Your final message is at most 200 words.

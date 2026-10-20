# C1b: The schema, the generator and the codec fixtures
Status: done

## Summary

M0's contract gate items 1–3 exist and run in `npm run ci`.

**The schema** (`game/schema/*.yaml`, 2.8k lines; `game/schema/README.md` is the guide) declares 309 types: 26 ids,
57 enums, 25 flag sets, 64 structs, 111 messages, 24 field-id records and 2 column tables. They cover:
- 56 actions, 5 of them system actions, with the batch and action headers;
- 14 events, 17 packet sections, 10 projection kinds and 8 queries;
- 13 save sections (7 more ids reserved), the save container and the closure log;
- the 34 Wasm exports (26 sim, 8 worldgen) with their records, including `new_world`, `sim_meta`, `load_report`
  and `chunk_data`;
- `prototypes.bin` (header, 9 kind tables, META, EXPR, NAMES) and the `prototypes.json` schema;
- the registries (`registries.yaml`): effects, triggers, achievement conditions, formula references and the
  well-known names.

Layouts are exact: little-endian, packed, no implicit alignment. `SCHEMA_HASH` is the SHA-256 of the
resolved-layout listing (`src/shared/gen/layout.txt`), which carries offsets, widths, field ids, enum values,
limits, defaults and versions, and no docs.

**The generator** (`npm run gen`, `scripts/schema-gen.ts` + `scripts/schema-gen/`, ≈4 s, of which rustfmt is about
3 s) writes:
- Rust: `crates/schema/src/` (12 files, 24.6k lines) and `crates/sim/src/gen/` (3.7k lines: state records, SoA
  pools with their column tables, save-section codecs, the digest shard map);
- TypeScript: `src/shared/gen/` (16 modules, 21k lines);
- the codec fixtures in `test/fixtures/codec/`.

Generated code includes:
- codecs in both directions for every type, with `dump` text;
- the action decoder, encoder and closure preflight (§15.3, all five rules, both languages);
- the packet writer (Rust `PacketBuilder`, TS `PacketWriter`) and reader (`decodePacket`), the held set;
- event and UI-record writers and readers;
- the save container, closure logs and section codecs;
- `Protos::load`, which refuses malformed files and bytecode (and a TS `readPrototypesBin` that refuses the same);
- the ABI traits, `export_sim_abi!`/`export_gen_abi!`, and the TS module wrappers;
- capability tables (`action_supported` …), registries, locale-key tables;
- the handshake constants `SCHEMA_HASH`, `PROTOCOL_VERSION` and the format versions.

`--check` catches drift (outputs and fixtures, stale files); check-arch refuses hand edits (header + content
hash), now also for the one generated file outside the generated directories.

**The fixtures** (`test/fixtures/codec/`), checked by `cargo test -p sim --test codec_fixtures`,
`cargo test -p schema` and `npx vitest run test/codec scripts/schema-gen`:
- `actions.bin` / `records.bin`: 454 samples (zero, mixed, max) of every action, struct, message and record, encoded
  by an independent reference codec (`scripts/schema-gen/refcodec.ts`, a layout interpreter). TypeScript encodes its
  literals to exactly these bytes and decodes them back. Both languages decode every entry, re-encode it to the same
  bytes and dump it to the reference dump (compared by FNV-1a hash).
- `probes.txt`: 1,737 limit probes: every maximum, count, enum value and flag, and a refusal just past each
  (overflow, bad enum/flag/bool/ref/UTF-8, NaN, truncation, trailing byte, field order, unknown and missing record
  fields, unsorted keys). Both languages must give each probe's verdict exactly: error kind, field and byte offset.
- `spec/*.hex`: 192 hand-written cases. 186 were written by an independent agent from the README, the YAML and
  §15 alone, without the generated code or the generator: actions, 28 closures through the preflight (every rule),
  events, packet, projections, ABI records, save records, protos and 72 refusals across every error kind. Its two
  disputes were real documentation gaps and are fixed (README: a record triple too short is `truncated`, too long
  `bad_length`; events: the event readers, not `EventRecord`, check `len`, now as `bad_length`). Its list of
  places where the README was silent became the README's "Details every consumer must match".
- `golden/`: a closure, a five-section packet and a closure log written by TypeScript. Rust preflights and decodes
  the closure, writes the packet byte for byte with its own builder, and parses the log.
- `../protos/m0.bin`: the M0 `prototypes.bin`, which `Protos::load` loads and is shown to refuse when corrupted.

**C1a's leftovers.**
- The data stage writes `prototypes.bin` with the generated writer (`emit/tables.ts` is gone; `emit/rows.ts` maps the
  model to rows). Names map to the schema's enums and flags, so a category, tier, type, tag or biome the schema
  lacks is an error at its YAML field.
- The engine's character: its numbers live in `game/data/engine/prototypes.yaml` (`character`). It is the last row
  of `PROTO_ENTITY` (type `character`), which `MOVERS.proto` names, and the last `entity` of `prototypes.json`
  (sprite `mover/character`). `Protos.well_known.character` is an `Option<EntityId>`.
- The whole design data is checked against the registries; the capability manifest's names are checked against
  the schema at generation.
- `prototypes.json` has `localeKeys` (FailReason, FlyingText, AlertType, Status; developer reasons have none),
  `milestones` and `sounds`, and is validated against the schema on every build.
- Tiles' `biome` and `placed_on` are now emitted (worldgen v0). Both loaders refuse a contents record that lacks a
  block the engine reads (`REQUIRED_DATA`).

## Decisions and deviations

Decisions 1–13 and 16 are also comments in the schema next to what they decide; 14 and 15 are comments in the
data stage.

1. **Packet section order** (§15.4 is silent): sections ascend by type, each at most once; the directory's `count`
   is the record count (chunk records for per-chunk sections). Decoders refuse anything else.
2. **`flying_text` carries `total: i32`** (deviation from §15.6): I §3.7–§3.8 show "+3 Iron plate (57)"; −1 = none.
3. **STATS series: at most 24 keys** (deviation from §15.5's 32): 32 series of 300 f32 pairs exceed §15.5's own
   64 KiB record cap.
4. **`StatPrecision` is 0–8**: §15.5 says "0–9", but there are nine ranges.
5. **The character is not an entity-table row** (§4.4/§5.1 leave it open): it is a mover with a serial; its state
   lives in the player record. Its prototype is the last `PROTO_ENTITY` row; its numbers are in the engine overlay
   (I §2.1, §3.1; 10 §5.1, §4.4: 0.15 tiles/tick, reach 10, build 10, resource 2.7, pickup 1, 80 slots, mining 0.5,
   crafting 1, ±0.2 collision). Size 0×0 (not a grid entity), selection priority 50.
6. **`WORLDGEN_PENDING` key: (commit_tick, surface, cy, cx)**. This deviates from §8.1's "commit tick, surface,
   cx, cy" to match §5.18, which commits a tick's chunks in ascending (surface, cy, cx); the saved order is then
   the execution order. **Please route:** one of the two sections should change.
7. **SectionFrame padding** is measured from the frame's start. In the container this equals §8.1's "from the file
   start", since frames start 8-aligned; it keeps one framing for `sim_save`/`sim_load` buffers, which start at 4.
8. **ABI standalone records** (`new_world` …) must fill their input exactly and are read strictly (unknown field
   ids refused): shell and module are one build. Saves are read leniently (§8.3).
9. **`TickDigest`**: the two counter lists carry u32 counts (§4.8 states a count only for the counters), so the
   record decodes unambiguously; the RNG words are every stream's in `RngStream` order.
10. **`begin_mining_terrain`** names its target by kind and position (`MiningTarget`): objects and ground items by
    their exact packet position, tiles by any position inside.
11. **Inventory actions name the inventory** (`InvSlot`: owner `EntityRef`, `InventoryType`, slot), since the sim
    has no notion of an open window (I §8.2's transfers).
12. **Registries list the full vocabulary**, with append-only ids; the capability manifest says which entries a
    milestone implements (M0: none).
13. **Locale keys** are `<prefix>.<value name, dashed>` (`fail-reason.out-of-reach`), from a new enum attribute
    `locale`; FailReason's developer reasons (`malformed` … `invalid_index`) have no key and no sound. Both the
    prefixes and the developer set are in the hash. The English strings belong to the UI's locale files.
14. **Sounds are deferred to the audio package**: `working_sound` is none and `prototypes.json.sounds` empty until
    `game/data/engine/sounds.yaml` exists (§15.6 gives the data stage that job; the file's format is audio's). M0's
    manifest keeps AUDIO_WORKING empty, so nothing waits on it.
15. **Milestone ids** (`MilestoneId`) index text.yaml's milestone ids sorted by code unit; the contents record lists
    `text.milestones.kind` and `.target` as omitted (the engine detects no milestones in M0).
16. **EXPR constants must be finite**: `Protos::load` and `readPrototypesBin` refuse a NaN or infinite `CONST`
    (D6), besides the stack, opcode, operand and END checks.
17. **Fixture mechanics**: Rust round trips are data-driven (decode, re-encode, dump hash) and live in an
    integration test, so the libraries carry no test code (the first version embedded 18k lines of sample literals,
    which cost about 7 s of `ntest` and 5 s of release compile). Probes larger than 8 KiB are left out (the 64 KiB
    payloads are probed at their limits by count-only encodings).

## Verification

- `taskset -c 0-15 npm run ci`: green in **28.4 s** wall warm (C1a's baseline: 28.0 s). After a schema change
  about 70 s, because cargo rebuilds the schema crate in four profiles (`cargo test --profile ntest` ≈ 34 s).
- `npm run gen`: about 4 s (load 0.3 s, Rust and TS emission 0.2 s, fixtures 0.4 s, rustfmt about 3 s).
  `--check` the same.
- Codec fixtures: 454 samples × 2 languages round-trip with the reference dump; 1,737 probes agree in both
  languages; the 192 hand-written cases pass in both (`hand_written_fixtures_decode_to_their_dumps`, Vitest's
  `hand-written fixtures`); 3 golden composites agree.
- `scripts/schema-gen/hash.test.ts`: 40 layout edits (an id's width or none value, enum values, a flag bit, a
  struct check, field width and order, action and event ids, held, allowed values, padding, counted arrays, section
  ids and kinds, magics, ranges, list maxima and item types, length widths, `when`, record ids and defaults, save
  keys and shards and hashing, kept and saved columns, proto columns, registry ids, every version) each change
  `SCHEMA_HASH` and are pairwise distinct; doc, comment and YAML-style edits do not.
- `scripts/schema-gen/generate.test.ts`: two generations from separately loaded schemas are byte-identical;
  `schema-gen --check` against the committed outputs in CI covers across processes.
- `crates/schema/tests/protos_load.rs`: the data stage's M0 build loads (character row, numbers, well-known id,
  start inventory); a wrong magic, schema hash, truncation, trailing byte, missing contents block and seven kinds
  of malformed program are refused. `data-stage.test.ts` checks the TS reader the same way.
- `crates/schema/tests/abi_macros.rs`: both export macros expand over stubs and dispatch.
- Data stage: C1a's review regression tests still pass (diagnostics at the YAML field for Infinity and u32
  overflow); registry refusals tested for effects, formula references and achievement conditions.

## Open issues and follow-ups

1. **Route decision 6** (`WORLDGEN_PENDING` order, §8.1 vs §5.18) and deviations 2–4 (§15.5, §15.6) into the spec.
2. **ABI crates are not wired yet**: `simabi`/`genabi` still export only `*_abi_version` (ABI 0). The Sim and
   Worldgen packages implement `schema::abi::SimAbi`/`GenAbi` and invoke `export_sim_abi!`/`export_gen_abi!`; then
   `schema::ABI_VERSION` (1) replaces the scaffold's 0.
3. **sounds.yaml** (decision 14): the audio package defines its format; the data stage then assigns sound ids
   sorted by name, fills `working_sound` and `prototypes.json.sounds`.
4. **Locale strings**: the UI package owns `game/locale/en.*` with the keys of `prototypes.json.localeKeys`.
5. **The 50 omitted parts**: M0's engine reads none of them; each later milestone moves what it reads from
   `omitted` to a schema column or META block (`emit/contents.ts` lists them; the loaders refuse a build that
   lacks a block the manifest's `data` names).
6. **Error precedence is pinned only where tested**: decoders report the first failure in wire order (README);
   inputs with several faults at once are not systematically probed.
7. `ntest` still inherits release's fat LTO (C1a open issue 9); the schema crate takes about 10 s to compile in
   release, of 28k generated Rust lines.

## Files

**Created:**
- `game/schema/{types,actions,events,packet,projections,abi,protos,registries,state,sections}.yaml`
- `game/scripts/schema-gen/` (yaml, model, load, listing, error-kinds, rust, rust-modules, rust-extras,
  rust-protos, rust-sections, ts, ts-modules, ts-extras, ts-protos, ts-state, capabilities, samples, samples-ts,
  fixtures-rust, refcodec, fixtures; templates/codec.{rs,ts}.txt; hash.test.ts, generate.test.ts)
- generated: `game/crates/schema/src/*.rs`, `game/crates/sim/src/gen/{state,pools,sections}.rs`,
  `game/crates/sim/tests/codec_fixtures/generated.rs`, `game/src/shared/gen/*.ts` and `layout.txt`
- tests: `game/crates/sim/tests/codec_fixtures/main.rs`, `game/crates/schema/tests/{protos_load,golden,abi_macros}.rs`,
  `game/test/codec/{fixtures,golden}.test.ts`, `game/test/helpers/codec.ts`,
  `game/scripts/data-stage/registries.test.ts`
- fixtures: `game/test/fixtures/codec/{actions.bin,records.bin,probes.txt}`, `spec/*.hex`, `golden/*.bin`,
  `game/test/fixtures/protos/m0.bin`
- data stage: `game/scripts/data-stage/emit/rows.ts`, `game/scripts/data-stage/registries.ts`

**Changed:**
- `game/scripts/schema-gen.ts` (the stub replaced), `game/schema/README.md` (the guide)
- data stage: `emit/protos-bin.ts` (generated writer), `emit/protos-json.ts`, `emit/contents.ts`, `model.ts`,
  `overlay.ts`, `index.ts`, `outputs.ts`, `scripts/data-stage.ts`, their tests; `emit/tables.ts` deleted
- `game/data/engine/prototypes.yaml` (the character)
- `game/scripts/check-arch/generated.ts` (+ test), `game/scripts/data-stage-plugin.ts` (watch list),
  `game/biome.json` (generated TS excluded from formatting and assists)
- `game/src/app/main.ts` (counts pluralized) and `game/e2e/smoke.spec.ts` (the character is the second entity)
- `CLAUDE.md` (the code section)

Commits on `dev`: e9f0850, 315983c, 60d5015, 0083c92, cf11a7b and the one that adds this report.

## Review response (codex C1b-r1)

All ten findings are fixed in dd26ca9. Each cross-language fix has a shared fixture that the old code fails in
at least one language; "old TS" results below were reproduced by running the pre-review generated
TypeScript (90df0c6) on the fixture's bytes. Fixtures are in `test/fixtures/codec/spec/review-r1.hex` (17
cases, run by both `cargo test -p sim --test codec_fixtures` and `test/codec/fixtures.test.ts`) unless named
otherwise. Three new directives serve them: `@table <name>`, `@closure_log` and `@lenient <record>`
(README, "Fixtures").

1. **UTF-8 strings decode differently — Fixed.** The TS decoder keeps a leading U+FEFF
   (`ignoreBOM: true`), as Rust's `str::from_utf8` does; the reference codec too. Other decoders were audited:
   magics and column names now compare bytes, pool-directory names and the save header use the strict decoder.
   Fixtures: console_command with `"﻿x"` and with a BOM-only text, a `removed_proto` record and an
   `InspectField` message with BOM-prefixed names, and a BOM-named signal in `golden/protos-signal.bin` (the
   NAMES path). Old TS decoded `"x"`.
2. **TS accepts noncanonical free pool rows — Fixed.** Both languages refuse a free row whose saved column is
   off its default (`keep` columns aside) when reading and writing, at the first such value in row order
   (`not_canonical container.inv @52`). The Rust reader now reports absolute offsets inside columns, and both
   check the whole directory before reading a column, so error precedence matches. Fixtures: container
   (canonical, and inv 0 in a free row), entity_table (a free row keeping `gen` 5: accepted; a free row with
   proto 3: refused). Old TS accepted the free row with inv 0.
3. **Closure-log readers disagree about missing blobs — Fixed.** Blob references are intrinsic to both
   readers; the TS callback is gone. A missing blob is `bad_ref ClosureLog.blobs` at the naming action.
   Fixtures: a log with a place_blueprint naming an absent blob, and the same log with the blob. Old TS
   accepted the first.
4. **Tiny inputs trigger enormous allocations — Fixed.**
   - Closure logs: capacities are bounded by the bytes present (one record per 9 bytes, one blob per 36).
   - Tables: they declare `max_rows` (4,194,304, an EntityHandle's slot bits; in the hash). A table with rows
     must carry its live column (`missing_field`), so rows are bounded by the bytes, and sizes use
     `checked_mul`. `alloc` returns None when a table is full.
   - Fixtures: logs claiming 2^32 − 1 records or blobs in no bytes, a table header claiming 2^32 − 1 rows
     (`too_long`), and 16 rows without columns (`missing_field`). Old TS accepted the 16-row table and died
     of heap exhaustion on the 2^32 − 1-row one.
5. **Closure-log parsing walks closures without their precondition — Fixed.** Both readers check each
   record's closure with `check_framing` (the preflight's rules 1–3 for the record's tick, shared with the
   preflight through one `walk`) before iterating it. A failure is the new error kind
   `bad_framing ClosureRecord.closure` at the failing batch or action. `ClosureIter` and `closureActions` stop
   on an empty batch or a short payload instead of panicking. Fixtures: the review's 20-byte closure
   (`@124`) and a payload past the end (`@140`); `crates/schema/tests/golden.rs` also tests the iterator
   directly.
6. **The save header's nested formats are unspecified — Fixed.** `sections.yaml` `save_header` is now a
   complete JSON schema, generated into `SaveHeader`/`validateSaveHeader` and listed in `SCHEMA_HASH`.
   - The type syntax gains integer and string ranges, `color` (#rrggbb), `isotime` (UTC), `hex16`, array
     maxima with `unique` or `ascending <field>`, and `record:<name>`, a record's JSON form. The settings
     copies are `record:map_settings` and `record:world_settings`, so they follow their records.
   - The roster holds at most 32 entries, ascending by index, each `{index 0–31, name of 1–64 bytes,
     color}`. `NameTables` must name exactly ProtoKind's kinds.
   - Keys are camelCase, as the spec's `buildHash`/`schemaHash` and prototypes.json have them.
   - `test/codec/save-header.test.ts` refuses 16 malformed headers, the review's `{item: 42}` and `[null]`
     among them, and round-trips the container. Old TS accepted those two. TypeScript only: Rust never reads
     the header.
7. **Distinct float defaults share a hash — Fixed.** The listing writes float defaults as IEEE bits. TS
   defaults keep −0 and round f32 defaults to f32, as Rust's `from_bits` does. `hash.test.ts` shows 0 and −0
   hash differently and that the TS default is `-0`; the old listing hashed them alike. A `@lenient
   map_settings` fixture with no fields checks every default bit for bit in both languages.
8. **Version bumps and id reuse are not enforced — Fixed.** `game/schema/compat.yaml` is a compatibility
   ledger (README, "Versions and the hash"; `scripts/schema-gen/compat.ts`). For each version domain it
   records each version's layout fingerprint: action, packet (with events and UI records), abi, gen_abi,
   protocol, protos, protos_json, container, closure_log, and schema (every save section). It also records
   every save section's fingerprint per version and every id ever assigned: actions, events, packet
   sections, projection kinds, queries, save and proto sections, META records, record field ids, enum values,
   flag bits and registry ids.
   - `npm run gen` refuses: a layout change without its version raised; a version going down; a changed save
     section whose version is not the new schema_version, or a section version above it; an id reused for
     another name.
   - It appends what is new, and `--check` requires the ledger to be committed.
   - `compat.test.ts` covers the review's case (`reverse` from bool to u16 at version 1 is refused; accepted
     at 2, after which going back to 1 is refused), renames and removed-id reuse (actions, enum values,
     record field ids) and the save-section rules. Old code accepted all of these.
9. **Column-less proto tables lose their row count — Fixed.** Every generated table keeps an explicit
   `row_count`. Fixture: `golden/protos-signal.bin`, written by the TS writer with one signal row. Rust loads
   it after putting its own SCHEMA_HASH in; the old `len()` returned 0.
10. **The README advertises a missing struct API — Fixed.** Struct codecs gain `encode`/`decode` (exact
    buffer, as messages and records). The README's TypeScript examples are concrete now.
    `test/codec/readme.test.ts` runs them and checks that they are the README's text.

Also:
- The schema's comments now cite the spec for decisions 2, 3, 4 and 6, which the manager routed.
- `npm run ci`: green in 35.0 s wall after the change. The release wasm rebuilt because the schema hash
  moved; warm it stays near 28 s.

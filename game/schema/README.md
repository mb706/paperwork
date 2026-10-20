# game/schema/: the schema (10 §15.1)

Every value that crosses the Rust/TypeScript boundary, every saved field and every wire record is declared
here, once. `scripts/schema-gen.ts` turns the YAML into code for both languages, plus test fixtures that
hold the two to the same bytes. Never edit generated code: change the YAML and run `npm run gen`.

| File | Declares | Rust | TypeScript |
|---|---|---|---|
| `types.yaml` | ids, shared enums and flags, small structs (`EntityRef`, `FinePos` …), `schema_version` | `schema::types` | `types.ts` |
| `actions.yaml` | batch and action headers, every action's payload | `schema::actions` | `actions.ts` |
| `events.yaml` | the EVENTS section record and every event payload | `schema::events` | `events.ts` |
| `packet.yaml` | the render packet: header, directory, section records | `schema::packet` | `packet.ts` |
| `projections.yaml` | projection kinds, subscriptions, queries, their records | `schema::projections` | `projections.ts` |
| `abi.yaml` | Wasm exports and imports, their input/output records, `new_world`, `sim_meta`, `chunk_data` … | `schema::abi` | `abi.ts` |
| `protos.yaml` | `prototypes.bin`: header, kind tables, META records, expression ops; `prototypes.json`'s types | `schema::protos` | `protos.ts` |
| `registries.yaml` | numeric registries (effects, triggers, achievement conditions, formula refs), well-known names | `schema::registries` | `registries.ts` |
| `state.yaml` | the saved state: entity table, pools, the records the save sections hold | `sim::gen::{state,pools}` | `state.ts`, `pools.ts` |
| `sections.yaml` | the save container, its sections and shards, closure logs | `schema::container`, `sim::gen::sections` | `container.ts`, `sections.ts` |

Also generated: `schema::capabilities` / `capabilities.ts` (game/data/engine/capabilities.yaml as code),
the codec runtimes (`schema::codec`, `codec.ts`), `src/shared/gen/layout.txt` (the listing the hash
covers), and the fixtures in `test/fixtures/codec/`.

## Workflow

```sh
npm run gen                         # regenerate everything (≈4 s; the dev server does it on save)
npm run data                        # then the data stage: prototypes.bin carries SCHEMA_HASH
node scripts/schema-gen.ts --check  # what CI runs: every output fresh, nothing stale
cargo test -p sim --test codec_fixtures   # Rust against the fixtures
npx vitest run test/codec scripts/schema-gen   # TypeScript against the fixtures; the hash tests
```

A schema error names the file, line and path: `schema/packet.yaml:223: ChunkEntities.fields[5]: counted
array entities names count2, which is not an earlier field`.

## The declaration language

Each file holds lists of single-key mappings, `- Name: {…}`. List order is wire order. Names: types
`PascalCase`, records and tables `snake_case`, fields `snake_case`. YAML 1.2 (so `on`, `y`, `no` are
strings). `doc:` is free text; comments and docs never change the hash.

```yaml
ids:                                   # a newtype over an integer
  - ItemKey: {base: u16, none: 0xFFFF, doc: "(item id << 3) | quality"}
enums:                                 # values explicit, append-only, never reused
  - Direction: {base: u8, values: [{north: 0}, {east: 4}, {south: 8}, {west: 12}]}
flags:                                 # bits explicit; undeclared bits are refused
  - BuildFlags: {base: u8, bits: [{smart_belt: 0}]}
structs:                               # fixed size: scalars, ids, enums, flags, structs, [T; N]
  - TilePos2: {fields: [{x2: i32}, {y2: i32}]}
messages:                              # packed, with variable-length fields
  - BeltItems:
      pad_to: 4                        # zero padding after the message to a multiple of 4
      fields:
        - line_id: u32
        - count: u16                   # hidden: the arrays below carry it
        - reserved: u16                # `reserved…` fields are always zero
        - keys: "ItemKey[count]"
        - gaps: "i16[count-1]"         # count − 1 items (none when count is 0)
records:                               # field-id encoded, for saves and the ABI (§8.1)
  - map_settings:
      fields:
        - width: {id: 1, type: u32}
        - starting_area: {id: 3, type: f64, default: 1}
        - resources: {id: 4, type: "list<resource_settings>", max: 256, order: key}
```

Field types: the scalars `u8 u16 u32 u64 i8 i16 i32 i64 f32 f64 bool`; any declared name; `[T; N]`;
and outside structs `str` (`max` UTF-8 bytes), `bytes` (`max`), `list<T>` (`max`; `list<str>` also
`item_max`), `T[field]`, `T[field-1]`, `T[..]` (the rest of the message), `blob` (a `Hash256`) and, in
actions, `blob_or_bytes` (`max`).

Field attributes (all optional): `doc`; `max`; `range: [lo, hi]` and `allowed: [...]` (integers);
`when: flags_field.bit` (present only with that bit set); `len: u32` / `count: u32` (wider length or count
prefix in messages); `id` (records: u16, stable, never reused); `default` (records: the value when
absent); `since` (the `schema_version` that added it). State only (`state.yaml`, §15.1 D20): `saved: true`,
or `saved: false` with `derived: <rust fn>` or `presentation: true`; `order: key|saved|set|none` for lists
(D3); `wraps` (counters that wrap, D7); `view` (exported to the TS pool views); `keep` (a table column
that survives freeing its row); `digest: tick` (in the per-tick digest). Protos only: `ref_kind`,
`formula`, `optional`, `from`, `path`.

## Encoding

All integers and floats little-endian. No implicit alignment or padding anywhere: fields follow each other
byte for byte, and only `pad_to` and `reserved…` fields add zeros.

| Type | Bytes | Refused when |
|---|---|---|
| integer, id | its width | outside `range` / `allowed` → `range` |
| `bool` | u8 0 or 1 | anything else → `bad_bool` |
| `f32`, `f64` | IEEE 754 | NaN → `not_a_number` (D6) |
| enum | its base | an undeclared value → `bad_enum` |
| flags | its base | an undeclared bit → `bad_flags` |
| `reserved…`, `pad_to` padding | zeros | not zero → `reserved` |
| struct, `[T; N]` | the fields in order | `check: entity_ref`: tag/fields mismatch → `bad_ref` |
| `str` | u16 length, UTF-8 | over `max` → `too_long`; invalid → `bad_utf8` |
| `bytes` | u16 length (records: u32), bytes | over `max` → `too_long` |
| `list<T>` | u16 count (records: u32), items | over `max` → `too_long`; `order: key` not strictly ascending → `unsorted` |
| `T[f]`, `T[f-1]` | the items only; the count is field `f` | |
| `T[..]` | items to the end | a partial item → `bad_length` |
| `when:` field | present iff the bit is set | |
| `blob_or_bytes` | u8 tag: 0 → u16 length + bytes; 1 → 32-byte SHA-256 | other tags → `bad_enum` |
| record | u32 length L, then L bytes of `(u16 id, u32 len, value)` triples, ids ascending | see below |

A record's value bytes for a nested record are that record's whole encoding (its own u32 length and
triples). Writers always write every field. A strict read (`decode(r, true)`: input from the same build,
such as the ABI's, and the fixtures) refuses an unknown id (`unknown_field`), a missing one
(`missing_field`), ids out of order or twice (`field_order`), and a triple whose value does not fill its `len`
exactly (`truncated` when the value needs more bytes, `bad_length` when bytes are left over). A lenient read
(saves, §8.3) skips unknown ids and gives missing fields their `default`.

Every decoder also refuses running out of bytes (`truncated`) and bytes left over (`trailing`). An error
carries its kind, a field path and a byte offset; the kinds are in `scripts/schema-gen/error-kinds.ts`.

Details every consumer must match:
- **Checks run in wire order**; the first failure is the error. A field is read, then its enum, flag, bool,
  NaN and reference checks, then `range`/`allowed`; a list's `order: key` is checked after the whole list.
- **Error paths** are `<declaration>.<field>` of the declaration being read: a nested struct names its own
  fields (`EntityRef` …), a record its own (`map_settings.width`). **Offsets** count from the start of the
  value decoded (a whole message, record or struct; an action's payload, not its frame). A field error points
  at the field's first byte, `truncated` at the value that ran out, `trailing` at the first byte left over.
- **`order: key`** compares whole items, field by field in order; strings by their UTF-8 bytes; items must
  strictly ascend (a duplicate is `unsorted`).
- **`pad_to`** counts from the message's own start.
- **An action's `len`** frames its payload: a payload shorter than its fields is `truncated`, a longer one
  `trailing`. The event readers check `len` against the type first (`bad_length`).
- **Lists with ids generate enums**: `actions:` → `ActionType` (u16), `events:` → `EventType` (u16), the
  packet's `sections:` → `PacketSection` (u16), `kinds:` → `ProjectionKind` (u16), `queries:` → `QueryKind`
  (u16), the save's `sections:` → `SaveSection` (u32), `protos.yaml`'s `sections:` → `ProtoSection` (u32) and
  `meta:` → `MetaRecord` (u16); registries with values generate theirs (`Effect` …).

Column tables (`tables:` in `state.yaml`, §8.1) are saved column by column: u32 rows, u16 column count,
u16 zero; per saved column u8 name length, name, u8 type code (`TypeCode`), u8 zero, u32 offset, u32 byte
length; then each column's rows at its offset, 8-aligned from the table's start. An entity handle is
saved as its entity's serial; a free row holds the defaults, except `keep` columns.

## Recipes

**Add a field to an action, event, packet or projection record.** Append it (or use a `reserved` slot of
the same width), run `npm run gen`, raise the file's `version` (`ACTION_SCHEMA_VERSION`,
`PACKET_VERSION`) if a built client could meet the new layout, and fill the field in the Rust writer or
the TS encoder. The hash changes by itself.

**Add a field to a saved record.** Give it the next unused `id`, `since: <schema_version>` and, when not
zero, a `default`; raise `schema_version` in `types.yaml`. Old saves load with the default (lenient read).
Never reuse or renumber an id.

**Add an action.** Pick the next id in its area (see the comment in `actions.yaml`):
```yaml
  - set_filter: {id: 66, fields: [{slot: InvSlot}, {item: ItemKey}]}
```
Then add its name to the manifest in `game/data/engine/capabilities.yaml` when the sim implements it;
until then it decodes and is refused at application with `unsupported`. Held inputs say `held: true`
(the generator prepends `u16 input_gen`).

**Add an event, projection kind, query or packet section.** Append it with the next id (`events:`,
`kinds:`, `queries:`, `sections:`), declare its record, and list projections, queries and sections in the
capability manifest. The generator checks every projection record's maximum size against `record_max`.

**Add a save section.** Declare its record or table (`state.yaml`), then a line in `sections.yaml`:
```yaml
  - TIMERS: {id: 9, version: 1, encoding: records, record: timer, key: [due, serial, event, owner], hashed: true, shard: timer}
```
`key` is the canonical order, which readers enforce; `shard` is its digest shard rule (§4.8).

**Add an enum value or flag.** Append it with a new number; never renumber. Decoders built before refuse
it, so treat it as a layout change.

## Versions and the hash

`SCHEMA_HASH` is the SHA-256 of `src/shared/gen/layout.txt`, the canonical listing of the resolved
layouts: every declaration, field order, offset, width, field id, enum value, limit, default, attribute,
id table and version (docs and comments excluded). It is a Rust and TS constant, the `prototypes.bin`
header carries it, and the shell compares it at the handshake (`sim_schema_hash`). Any layout change
changes it (`scripts/schema-gen/hash.test.ts` checks one edit of every kind); a doc change does not.

The versions are for compatibility across builds, which the hash cannot express: `schema_version` (saves;
`since` refers to it), `ACTION_SCHEMA_VERSION` (`actions.yaml`, every batch header), `PACKET_VERSION`
(`packet.yaml`), `ABI_VERSION` / `GEN_ABI_VERSION` / `PROTOCOL_VERSION` (`abi.yaml`) and the
`prototypes.bin` format (`protos.yaml`). Raise the one whose layout you change.

## Using the generated code

TypeScript: every struct, message and record has a `<Name>Codec` (`read`/`write`, `encode`/`decode`,
`dump`, `defaults`; structs also `SIZE`, `OFFSET` and unchecked `get` accessors); enums and flags are
`const` objects (`Direction.east`); `u64` is a `bigint`.
```ts
const bytes = actionBytes({ type: 'build', item, pos: { x2: 4, y2: 6 }, dir: Direction.east, ... });
const packet = decodePacket(buffer);               // header, directory and section views, all checked
const v = EntityViewCodec.decode(slice);           // throws DecodeError(kind, field, at)
```
Rust: `Fixed` (`SIZE`, `read`, `write`) for structs, `Packed<'a>` for messages (borrowing, zero-copy
`List`/`MsgList` views), owned types for records (`decode(r, strict)`, `encode`).
```rust
preflight(closure, tick, &last_seq, last_system_seq, &|h| blobs.contains(h))?;   // §15.3
for a in ClosureIter::new(closure) { let action = Action::decode(a.ty, a.payload); /* … */ }
let mut p = PacketBuilder::begin(&mut w, sections, tick, flags, daylight);
```

## Fixtures (test/fixtures/codec/)

Generated by `npm run gen` with the reference codec (`scripts/schema-gen/refcodec.ts`, a layout
interpreter independent of the emitted code); a new type is covered without further work.

- `actions.bin`, `records.bin`: three samples (zero, mixed, max) of every action, struct, message and
  record. Entry: u16 name length, name, u8 variant, u32 FNV-1a of the reference dump, u32 length, bytes.
  TypeScript encodes its literal (`src/shared/gen/samples.ts`) to these bytes and decodes them back; both
  languages decode, re-encode to the same bytes, and dump the reference dump.
- `probes.txt`: every limit, and a refusal just past it: `<kind>:<type> <name> <verdict> <hex>`, where the
  verdict is `ok` or `<error kind> <field> @<offset>`. Both languages must give each verdict exactly.
- `spec/*.hex`: hand-written cases, derived from this README and the YAML alone.
- `golden/`: whole messages the TypeScript side writes (a closure, a five-section packet, a closure log),
  which Rust must preflight and decode, write byte for byte (the packet) and parse
  (`crates/schema/tests/golden.rs`). After a deliberate format change:
  `UPDATE_GOLDEN=1 npx vitest run test/codec/golden.test.ts`.
- `../protos/m0.bin`: the M0 build's `prototypes.bin` (`npm run data` writes it), which
  `crates/schema/tests/protos_load.rs` loads with `Protos::load` and corrupts in every refused way.

The dump (`Dump` in both runtimes): one `path=value` line per leaf in field order; nested values as
`outer.inner`, list and array items as `path[i]` after a `path.len=N` line (fixed arrays have no `.len`);
integers, ids, enums and flags as decimal numbers; `bool` as `true`/`false`; floats as
`f32:<8 hex digits>` / `f64:<16 hex digits>` of their IEEE bits; strings in double quotes, escaped as
JavaScript's `JSON.stringify` escapes them (`"`, `\`, and control characters; everything else literal);
`bytes`, `[u8; N]`, `u8[f]` and `u8[..]` as `hex:<lowercase digits>` with no `.len` line (arrays of any other
type, `[TileId; N]` included, print one line per item); `blob_or_bytes` as `path.bytes=hex:…` or
`path.blob=hex:…`. Reserved fields, hidden counts (the `count` of `T[count]`) and absent `when` fields are
left out; records dump every field. An action's dump starts with `type=<action name>`.

A `spec/*.hex` file holds cases; `#` starts a comment line, `//` a comment after hex digits:
```
@type EntityRef                 # a struct, message or record (records strictly)
39 30 00 00  00 00  01  00      // a = 12345, b = 0, tag 1 (entity), reserved
@dump
a=12345
b=0
tag=1

@action                         # u16 type, u16 len, payload: rotate_entity
15 00 09 00  39300000 0000 01 00  02
@error bad_bool                 # a kind alone, or the full verdict: bad_bool RotateEntityAction.reverse @8

@closure tick=7 last_seq=0:4 system_seq=0 blobs=
01 00 0000 07000000 05000000 0100 0000  0200 0200 0000
@ok batches=1 actions=1         # or: @error framing @<offset> / @error blob_missing @<offset>
```
`@event` decodes one EVENTS record with the event readers (`read_event`, `readEvent`), which check `len`
against the type; its dump is the header's fields under `header.`, then the payload's (`type=<name>` first).
In `@closure`, several `last_seq` pairs are separated by commas, and a case may have no hex (the empty
closure).
A directive line may end in a ` # comment`. An action's error offsets count from its payload. `@closure`
runs the preflight (§15.3) on the bytes: `last_seq` lists `player:seq` pairs (others 0), `system_seq` is
the system watermark, `blobs` the SHA-256s supplied (comma-separated hex). Both
`cargo test -p sim --test codec_fixtures` and `test/codec/fixtures.test.ts` run every case.

## What the checks enforce

- `schema-gen --check` (in `npm run check`): every output and fixture is byte-identical to a fresh
  generation, and no file in a generated directory names schema-gen without being generated. Generation is
  deterministic (no clocks, no unordered iteration; check-arch bans them in the generator).
- `check-arch`: the generated directories (`src/shared/gen/`, `crates/schema/src/`, `crates/sim/src/gen/`)
  hold only the generators' outputs, each with a header naming its generator, the current `SCHEMA_HASH`
  and its own content hash, so a hand edit fails.
- The generator itself refuses: unknown types, duplicate names, ids or field ids, count fields that are not
  earlier integers, `when` bits that do not exist, projection records over `record_max`, capability
  manifest names the schema does not declare, and declarations whose generated names collide.

# The M0 golden integration set (10 §15.10)

The referee between M0's packages, frozen by the contract gate (10 §12). Its expected values come from a small
TypeScript **reference model** of M0's rules (`model/`), run on the generated writers and XXH64; no
implementation produced them. A disagreement is settled by the spec; where the spec was silent, the model
decided, and the decision is listed below, so every package inherits one answer. A change to `m0/` reopens the
gate for the packages it touches.

```sh
node test/golden/build/main.ts                         # check: the model reproduces m0/ byte for byte
node test/golden/build/main.ts --write                 # regenerate m0/ (then review the diff)
node test/golden/build/main.ts --write --bump "why"    # record the reviewed change as a new version
npx vitest run test/golden                             # what `npm run ci` runs (≈ 6 s)
```

## What is in `m0/`

| Path | What |
|---|---|
| `protos/prototypes.{bin,json}` | the data stage's M0 build, frozen (`prototypesHash` = SHA-256 of the `.bin`) |
| `start.save` | the start save (§8.1 container, header validated by `validateSaveHeader`): tick 0, seed 1945, a 96 × 96 map stored as 16 modified chunks, two chests, player 0 |
| `closure-log.pwlog` | 600 ticks (§8.5): `HAS_DIGESTS` with every d_t, one blob, build hash all zero (a fixture belongs to no build) |
| `closure-log.txt`, `scenario.txt` | every action of the log, what it tests, and what the model did with it |
| `digests.txt` | d_t for ticks 1–600 (§4.8), hex |
| `states/tick-NNNN.sections` | the canonical state after ticks 0, 1, 2, 300, 600: `u32 count`, then every hashed section in the container's framing, codec raw (`sim_save`'s output without its trailing lineage) |
| `states/tick-NNNN.txt`, `states/hashes.txt` | readable dumps; the full state hash and each section's hash at each of those ticks |
| `view.bin`, `subs.bin` | the fixed view request (`ViewRequest`) and the subscriptions (`SubscribeInput`) of the golden packets |
| `packets/*.bin` (+ `.txt`) | the packets `sim_extract` writes: `tick-0000-full` (the unsolicited FULL packet after loading), `tick-0000` (answering the view, paused), `tick-0001`, `tick-0600` (COALESCED: ticks 2–600 ran without extraction) |
| `projections/tick-NNNN/*.bin` (+ `.txt`) | every M0 projection's record at ticks 0, 1, 2, 300, 600, each evaluated as a fresh subscription |
| `queries/tick-NNNN/*.bin` (+ `.txt`) | `inspect` (each chest, and serial 1, which is a character and no entity), `hash`, `digest` |
| `logs/` | valid closure logs a reader must accept: the empty log, the golden log without digests |
| `negative/` | `index.json` lists each case, the call it is for and the expected status or reader error |
| `sprites/` | the tiny atlas: `atlases/sprites.json` (§15.7's fixture manifest), its `rgba8` KTX2 pages, `cases.json` |
| `MANIFEST.json`, `VERSIONS.txt` | every file's SHA-256, and the version ledger (below) |

The `.txt` files are dumps in the codec fixtures' `path=value` format (`schema/README.md`), compacted: chunk tiles
are drawn as 32 rows of 32 tile ids in base 36, and statistics points that are zero are left out.

### The scenario

Player 0 starts at (38.5, −0.5) near chest A (serial 2, tile (36, −3)), an iron-ore patch with a two-ore tile, a
pond and the east map edge at x = 48; chest B (serial 3) stands by the spawn point. In 600 ticks player 0 mines the
two-ore tile dry, crafts, builds chest C and fills it by creation id, exercises every transfer, limits chest A with
the bar, provokes every building refusal, walks into the map edge and slides along it, is released and fenced,
walks into chest A, mines chest C with its contents, and crafts all it can. Player 1 joins at tick 5, takes chest
B's plates, crafts, mines, holds a stack, leaves at tick 30 while walking, mining and crafting (R26), returns at
tick 40 (a stale start is fenced, R23), builds chest D, mines it back by creation id, rebuilds on the same tile,
and player 0's transfer naming the old serial fails (R24). `scenario.txt` lists all 97 steps.

The log holds every M0 action and system action, and a refusal of every M0 reason M0's content can reach:
`malformed`, `unsupported`, `player_not_present`, `invalid_setting`, `invalid_index`, `target_gone`,
`out_of_reach`, `inventory_full`, `not_enough_ingredients`, `entity_in_the_way`, `cannot_build_on_tile`,
`out_of_map`, `no_item_in_hand`, `not_minable`, `nothing_to_mine`, `cannot_insert`, `nothing_to_transfer`.
`recipe_locked` and `cannot_handcraft` cannot happen with M0's one recipe; `compromised` and
`needs_weight_transplant` belong to M3 and M4.

## How each package consumes it

**Sim (C2).** Load `protos/prototypes.bin` (`sim_init`), then `start.save`'s sections (`sim_load` with the header's
lineage). Run ticks 1–600 with the log's closures (an empty closure for a tick without a record), supplying the
log's blob before tick 55. Pass when, natively and in WebAssembly:
- every d_t equals `digests.txt` (and the log's digest region);
- `sim_save` after ticks 1, 2, 300 and 600 equals `states/tick-NNNN.sections` byte for byte (its trailing r is the
  sim's), and `sim_state_hash` equals `states/hashes.txt`;
- extracting as the golden flow does (below) gives `packets/*.bin` byte for byte, and each projection and query
  gives the record in `projections/` and `queries/`, except the masked fields;
- every case of `negative/index.json` returns its status, and a refused closure changes nothing.

The golden flow: load; extract (no view: the FULL packet); `sim_subscribe(subs.bin)`; extract with `view.bin`
(tick 0, no tick run); tick 1; extract with `view.bin`; ticks 2–600 with no extraction; extract with `view.bin`.

**Shell (C3).** Replay `closure-log.pwlog` from `start.save` through the `LocalSequencer` in replay mode and compare
the digests (with the real module: equal; with a stub: framing and order only). Parse `logs/*` and refuse every
`negative/logs/*` with the reader's error. Refuse `negative/module/stale-schema.wasm` at the handshake (its schema
hash is SCHEMA_HASH with every byte inverted) and `negative/saves/*` as indexed. Fill `state_gen` and `view_seq`
into the golden packets (the module leaves them 0).

**Renderer (C4).** Decode `packets/*` (the generated `decodePacket` and record codecs), apply them in order to the
mirror, and draw them with `sprites/atlases/sprites.json` and `prototypes.json` (sprite names) at 1× and 0.3×.
Run `sprites/cases.json`: each case is a packet-shaped input, a camera and the draws §15.7's programs produce
(pass, part, frame ids, quad corners in device pixels from the canvas centre, uv); compare with a tolerance of
0.001.

**UI (C5).** Decode `projections/tick-NNNN/*.bin` with the generated codecs into UI state, and the UI records inside
the packets (statuses ok, gone and invalid, versions, the STATS series whole and then incremental). Item names,
icons and locale keys come from `protos/prototypes.json`.

**Assets (C6).** `sprites/atlases/sprites.json` is §15.7's fixture manifest (`test/fixtures/sprites/manifest.json` in
§15.7's words): one set of every kind with explicit index tables, in exactly the build's format. The real
manifest replaces it in the same format; the asset build's checks can run `cases.json`.

**Audio (C7).** `packets/tick-0600.bin` holds 70 events of every M0 kind with their players and seqs;
`AUDIO_WORKING` is absent because nothing works in M0 (use the fake sim, `?sim=fake`, for working sounds and the
music feed).

## Masked fields

Implementation-defined values the golden set does not pin; the model writes 0 there:
- the rolling digest r (`DEBUG.r`, the `digest` query's r, `sim_digest`'s r, `sim_save`'s trailing lineage): §4.8
  leaves the slice hash's byte composition to the sim, and only the sim computes it. r₀ = XXH64(u32 seed ‖ u32 0)
  is pinned (`start.save`'s header `lineage`);
- `DEBUG.memory_bytes`, `DEBUG.pools[].capacity` (the model writes the row count) and `DEBUG.phase_us` (empty).

## Rules the golden set fixes

The model's source says "Model decision" at each. The real sim must follow them; a package that disagrees
reports it (with the spec citation) instead of editing the set.

**Map and world**
1. A map of width W covers x in [−⌊W/2⌋, W − ⌊W/2⌋) (Factorio's centred map); the golden map is 96 × 96, chunks
   −2 … 1, and the stored chunks' tiles outside it are the out-of-map tile. "3 × 3 chunks around the origin"
   (§15.10) cannot be a centred map; 96 × 96 is its size.
2. Every chunk of the map is stored as modified, so nothing is pristine and nothing is requested: pre-generation
   requests no chunk outside the map, and `WORLDGEN_PENDING` stays empty.
3. Walking and building treat a tile outside the map or in no generated chunk as unwalkable and unbuildable.
4. `worldgen_version` is 1; `worldgen_data_hash` is the SHA-256 of `prototypes.bin`'s PROTO_RESOURCE, PROTO_TILE
   and PROTO_WORLD frames (ids 6–8, consecutive), header to padding. A save with another pair is refused
   (`ERR_WORLDGEN`) only when one of its generated chunks is pristine; a baked save (all stored) loads.
5. The climate compass is off in the golden world (θ = 14 °C, sunlight 1); κ is the mean of the 1,024 tiles'
   `kappa_per_s` (0 for a tile without one), summed in tile order.
6. Chunk view versions (§15.4) start at 1 when a world is loaded and rise by one per change of their part; the
   rule version rises with every change of a chunk's entities or resources (each mined ore).
7. M0 has no day cycle: `daylight` is 65,535 in every packet.

**Players and characters**
8. A new player (`player_joined`) gets a character with the next serial at (0, 0), facing south (8), the start
   inventory (`meta.start.inventory`), auto-sort on; the spawn point is not searched for a free position in M0.
   Joining while online changes nothing; existence decides, not the `returning` flag.
9. `player_left` and `release_inputs` stop walking, mining and picking and raise the input generation, for any
   player with state, online or not; for a player without state they do nothing. The hand returns to the main
   inventory only if all of it fits (origin slot first).
10. Phase 1 applies the closure, then advances every online character in ascending player index: walking, then
    mining, then crafting. An action applied in tick t takes effect in tick t.
11. Walking: speed = `running_speed` × the walking speed of the tile under the character; diagonals move
    speed × √½ (`Math.SQRT1_2`) per axis. A step that collides is retried as its x part, then its y part (diagonals
    only), else the character stays; no movement up to contact. Collision is strict overlap of the character's box
    (±0.2) with unwalkable tiles and buildings' collision boxes (chests keep theirs under trimmed collision);
    characters do not block each other.
12. An action's seq is consumed first (refused or not); a player without state keeps no `last_seq`. The checks then
    run: decode (`malformed`), capability manifest (`unsupported`), presence (`player_not_present`), fencing
    (`input_fenced`, no `action_failed`), the action's own rules.
13. `last_action_tick` is set by every action that is not refused, fenced, malformed or unsupported.
14. `inventory_version` rises by one for each action and each mining or crafting step after which the main
    inventory's slots or the hand differ.

**Inventories and transfers**
15. Slot-heap class ids are the indexes of the size sequence 1, 2, 4 … 128, 192, 256 …; an inventory owns a block of
    the smallest class that holds it (the character's 80 slots: class 7, 128 slots). An empty slot is
    `{none, 0}` in live and freed blocks alike; the save lists arenas with blocks, ascending by class.
16. A limit bar exists only below the inventory's size; nothing is inserted at or past it by any means.
17. Insertion fills partial stacks of the key first, then empty slots, ascending, below the bar, never the hand's
    origin slot; removal takes from the highest slot down. With auto-sort on, the main inventory is sorted at every
    step boundary: every slot but the origin slot becomes the item totals in ascending item key, full stacks first.
18. Characters are not entities: an `EntityRef` naming a character's serial is `target_gone`. `InvSlot` owner tag 0
    is the main inventory and needs `inv = main`; an entity inventory needs reach (10) and its own type. Checks:
    target, reach, inventory type, slot.
19. LMB/RMB on a slot follow I §3.8's table; picking up from an empty slot, RMB onto another item and LMB onto a full
    stack of the same item do nothing, without an event. Shift and Ctrl transfers move to the other inventory
    (refused with `invalid_index` when it is the same one), `nothing_to_transfer` when the source is empty,
    `inventory_full` when nothing moved. Halves round up. Q returns the stack to its origin slot first and keeps
    what does not fit (`inventory_full`). Flying text: fast transfers (at the entity) and mining and crafting results
    (at the character), one per item key, `total` = the main inventory's count.

**Building, mining, crafting**
20. `build` checks: mode (`unsupported` beyond normal), the hand holds a real stack of exactly `item` that places an
    entity (`no_item_in_hand`), the centre's parity fits the footprint (`malformed`), reach to the collision box,
    the map, the tiles, buildings in the way (the lowest serial), characters in the way (the lowest serial). A
    non-rotatable entity faces north. Every creating action is a creation-ring entry. An emptied hand refills from
    the lowest main slot holding the item, else becomes a ghost cursor (setting on) or empty.
21. Reach is measured from the character to the target's collision box (a resource tile's square); compared as
    squared distances, d² ≤ reach².
22. A unit of hand mining or crafting completes in the tick its progress reaches 1 − 10⁻⁹; progress then keeps
    what passed 1 (never below 0). Rates are bit-exact: mining `mining_speed / (mining_time * 60)`, crafting
    `crafting_speed / (energy_required * 60)`. So a 0.5-s craft takes 30 ticks, ore 120 and a chest 24.
23. Beginning to mine the target already being mined keeps its progress. Mining stops silently when its target is
    gone or out of reach; a result that does not fit is refused (`inventory_full`, seq 0) and stops mining. A
    depleted tile stops mining.
24. Resource bands are Factorio's ore stage counts {15000, 9500, 5500, 2900, 1300, 400, 150}: band 0 (richest) to 7.
25. Crafting reads the main inventory only, not the hand; a count above what can be crafted queues what can, none is
    `not_enough_ingredients`; the same recipe merges into the last entry. Cancelling refunds or is refused
    (`inventory_full`). A craft whose product does not fit pauses silently. One `item_crafted` (count 1) per craft.
26. Statistics (M0: items): mined ore and crafted products are produced, ingredients consumed at completion. Rings:
    ticks per point 1, 12, 120, 720, 7,200, 36,000, 180,000, 720,000 (precisions 0–7), aligned to tick 0 for every
    key; `all` starts at 60 ticks and doubles each time 300 points fill (pairs merged as f32 sums). STATS entries
    are the window's 300 points plus the open accumulator (`all`: the exact totals); series for the first 24 keys;
    an empty tail means every key of the tab.

**Digests, saves, ABI**
27. The per-tick digest is abi.yaml's `TickDigest` as C1b defined it; `entity_count` counts entity-table rows (not
    characters). A section's own hash in `sim_state_hash` is XXH64 of its bytes.
28. Handle generations: a row's `gen` rises when the row is handed out, cycling 1 … 1,023.
29. A save holds every hashed section, empty ones included. A section version above the build's is
    `ERR_LOAD_FORMAT`; a column of another type `ERR_LOAD_SCHEMA`.
30. `sim_subscribe` with sub_id 0 is `ERR_INPUT` (it belongs to the hover projection).

**Extraction, projections, queries**
31. The FULL packet after a load has no view and no subscriptions: header only. A held chunk that exists gets all four
    per-chunk records when it enters the held set, empty lists included; one that does not exist gets none.
    Per-chunk records ascend by chunk key, entities by serial, resources by tile.
32. MOVERS lists every character (online or not) whose position lies in a held chunk, ascending serial;
    `x, y` = floor(v × 256 + 0.5); velocity = the last tick's actual displacement; orientation = walking direction
    × 4,096; `base_tick` = the packet's tick.
33. Sections with no records are omitted; COALESCED is set when more than one tick ran since the last extraction.
34. Subscriptions are evaluated in sub_id order (hover first); a record is sent when its body's XXH64 differs from
    the last sent; `version` counts the records sent per sub_id, across replacements. Unsupported kinds and requests
    over a limit send one status-2 record and are dropped; a target that does not exist sends one `gone` record.
35. HUD is the tick only; CHARACTER's quickbar is empty (M0 keeps none); chest panels and hovers carry no status.
    Note for the sim: projections.yaml's CHARACTER sources (inventory version, crafting queue) do not cover
    `mining_progress`, crafting progress, `input_gen` or the flags, which change without them; skipping a rebuild on
    those sources alone would miss records the golden packets hold.
36. `inspect` lists the entity-table row's saved columns, then the pool row's, each with its type code and
    little-endian value (a handle as the serial).

**The tiny atlas** (`sprites/`). Its arrays are small (colour 16 px per tile, 512-px pages, 3 layers, 2 levels; shadow
8 px; light 8 px; icons 16 px), in 32-px cells with 8-px gutters. File paths are relative to the manifest's parent
directory, as in the build (`atlases/…`). `cases.json` fixes these readings of §15.7: an entity without DYN draws
base and layers at frame 0 and no light; a part's `frame` axis (layers, animated shadows) takes
floor(phase × frames ÷ 65,536); a light part with a `light` axis takes its value from `EntityView.status` and is
drawn at full strength (signal codes until M2: 0 red, 1 yellow, 2 green), other light parts only with DYN, at
`light ÷ 255`; inserter parts carry `pivot` (and `length` for the arm), the set a `shoulder`, and shadows are parts
named `<part>_shadow`, drawn with the same transform; orientation indexes round half up; `idle` and `mine` frames
are floor(ticks since `base_tick` ÷ 60 × fps); movers are extrapolated by their velocity; an empty table entry draws
the greybox. Belt masks in the fixture: 1 and 2 are the two curves, every other value straight.

## Freezing

`MANIFEST.json` lists every file's SHA-256; `VERSIONS.txt` records, per version, the SHA-256 of that list and why it
changed. The tests fail when a file differs from the manifest, when the manifest's list is not the latest version's,
when the schema hash is not the one the set was built against, or when the model no longer reproduces the set. So a
schema change, a data change that alters the M0 build, or a model change regenerates the set (`--write`), and the
reviewed diff is recorded with `--bump`; every package that consumes the changed files reruns its golden test.

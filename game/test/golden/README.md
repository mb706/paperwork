# The M0 golden integration set (10 §15.10)

The referee between M0's packages, frozen by the contract gate (10 §12). Its expected values come from a small
TypeScript **reference model** of M0's rules (`model/`), run on the generated writers and XXH64; no
implementation produced them. A disagreement is settled by the spec; where the spec was silent, the model
decided, and the decision is listed below, so every package inherits one answer. A change to `m0/` reopens the
gate for the packages it touches.

```sh
node test/golden/build/main.ts                         # check: the model reproduces m0/ byte for byte
node test/golden/build/main.ts --write                 # regenerate m0/ (then review the diff)
node test/golden/build/main.ts --write --bump mechanical "why"                     # see "Freezing"
node test/golden/build/main.ts --write --bump value --approval <review> "why"
npx vitest run test/golden                             # what `npm run ci` runs
```

## What is in `m0/`

| Path | What |
|---|---|
| `protos/prototypes.{bin,json}` | the data stage's M0 build, frozen (`prototypesHash` = SHA-256 of the `.bin`) |
| `start.save` | the start save (§8.1 container, header validated by `validateSaveHeader`): tick 0, seed 1945, a 96 × 96 map stored as 16 modified chunks, two chests, player 0; its lineage is r₀ |
| `closure-log.pwlog` | 3,600 ticks (§8.5): the scenario's steps in ticks 1–595, then idle ticks, so the rolling digest covers a whole cycle of the 3,600 slice shards; `HAS_DIGESTS` with every d_t, one blob, build hash all zero (a fixture belongs to no build) |
| `closure-log.txt`, `scenario.txt` | every action of the log, what it tests, and what the model did with it |
| `digests.txt` | per tick 1–3,600: d_t, slice_t and r_t (§4.8), hex |
| `digest-preimages.txt` | the exact bytes d_t hashes (§4.8's sequence; abi.yaml `TickDigestHead` … `TickDigestTail`) at the state ticks and wherever the preimage's lists change length |
| `slices/tick-0600.txt`, `slices/tick-0600-members.txt` | all 3,600 shard hashes of the state after tick 600, and every member behind them (section, key, shard, length, XXH64), rules 37–41 |
| `slices/collisions.{sections,txt}`, `slices/collisions-members.txt` | a state whose rows were reused out of serial order (row 0 holds serial 3,603, row 1 serial 3, row 3 is free: all shard 3), as `sim_save` returns it, with all 3,600 shard hashes and its members (rule 41) |
| `states/tick-NNNN.sections` | the canonical state after ticks 0, 1, 2, 300, 600 and 3,600 exactly as `sim_save` returns it (abi.yaml `SaveOutput`: the sections in the container's framing, codec raw, then the lineage r) |
| `states/tick-NNNN.txt`, `states/hashes.txt` | readable dumps; the full state hash, r and each section's hash at each of those ticks |
| `view.bin`, `subs.bin` | the fixed view request (`ViewRequest`) and the subscriptions (`SubscribeInput`) of the golden packets |
| `packets/*.bin` (+ `.txt`) | the packets `sim_extract` writes: `tick-0000-full` (the unsolicited FULL packet after loading), `tick-0000` (answering the view, paused), `tick-0001`, `tick-0600` (COALESCED: ticks 2–600 ran without extraction) |
| `projections/tick-NNNN/*.bin` (+ `.txt`) | every M0 projection's record at the state ticks, each evaluated as a fresh subscription |
| `queries/tick-NNNN/*.bin` (+ `.txt`) | `inspect` (each chest, and serial 1, which is a character and no entity), `hash`, `digest` |
| `abi/traces.json`, `abi/traces/`, `abi/inputs/` | the ABI traces (below): call sequences with their inputs, statuses, envelopes and state assertions |
| `logs/` | valid closure logs a reader must accept: the empty log, the golden log without digests |
| `negative/` | `index.json` lists each case, the call it is for and the expected status or reader error; every case is executed by the model when the set is built |
| `../../fixtures/sprites/` | the tiny atlas, kept where the asset pipeline (C6) generates it: `manifest.json` (§15.7's fixture manifest, built for these prototypes), its `rgba8` KTX2 pages, `cases.json`; frozen with the set (`MANIFEST.json`'s `external`) |
| `MANIFEST.json`, `VERSIONS.txt` | every file's SHA-256 and the contract inputs', and the version ledger (below) |

The `.txt` files are dumps in the codec fixtures' `path=value` format (`schema/README.md`), compacted: chunk tiles
are drawn as 32 rows of 32 tile ids in base 36, statistics points that are zero are left out, and a dump stops after
4,000 lines (the `.bin` beside it is complete).

### The scenario

Player 0 starts at (38.5, −0.5) near chest A (serial 2, tile (36, −3)), an iron-ore patch with a two-ore tile, a
pond and the east map edge at x = 48; chest B (serial 3) stands by the spawn point. In 600 ticks player 0 mines the
two-ore tile dry, crafts, builds chest C and fills it by creation id, exercises every transfer, limits chest A with
the bar, provokes every building refusal, walks into the map edge and slides along it, is released and fenced,
walks into chest A, mines chest C with its contents, and crafts all it can. Player 1 joins at tick 5, takes chest
B's plates, crafts, mines, holds a stack, leaves at tick 30 while walking, mining and crafting (R26), returns at
tick 40 (a stale start is fenced, R23), builds chest D, mines it back by creation id, rebuilds on the same tile,
and player 0's transfer naming the old serial fails (R24). Player 5, who never joins, sends an action at tick 2:
it is refused and its seq is kept (rule 12). `scenario.txt` lists all 97 steps.

The log holds every M0 action and system action, and a refusal of every M0 reason M0's content can reach:
`malformed`, `unsupported`, `player_not_present`, `invalid_setting`, `invalid_index`, `target_gone`,
`out_of_reach`, `not_enough_ingredients`, `entity_in_the_way`, `cannot_build_on_tile`, `out_of_map`,
`no_item_in_hand`, `not_minable`, `nothing_to_mine`, `nothing_to_transfer`; `inventory_full` (a cancel whose
refund does not fit) is in the `capacity` trace with the other full-inventory branches. `cannot_insert` has no M0
cause any more (a click ignores the bar, rule 16; slots that reject items arrive with M1's machines);
`recipe_locked` and `cannot_handcraft` cannot happen with M0's one recipe; `compromised` and
`needs_weight_transplant` belong to M3 and M4.

### ABI traces

`abi/traces.json` lists traces; each is a sequence of export calls against **one fresh module** (§15.8), in order.
A call names its export, its input (a file under `m0/`, or null for none) or its parameters (`sim_set_flags`,
`sim_query_step`, `sim_query_cancel`), and what to expect:
- `status`: the `SimStatus` name;
- `out`: the envelope's **payload**, exactly (a file): the bytes that follow §15.8's `u32 len` prefix at the
  pointer the export returns, without that prefix. Null when the export returns no envelope or failed. The wrapper
  itself (the pointer, the length prefix, `sim_last_error`'s envelope) is §15.8's calling convention, which the
  shell checks; the traces pin only what it wraps (GATE-r2 finding 5);
- `state`: `unchanged` or `changed`: whether the full state hash (§4.8) after the call equals the one before it;
  absent when no world existed before or after. Every refusal is `unchanged`.

The traces:
- `boot-and-order`: `ERR_ORDER` before a world (`sim_load_report`, `sim_tick`), `SimFlags` bit 3, a plain load
  with its report, `sim_meta`, `sim_digest`, `sim_state_hash`, `sim_pending_chunks`, an unrequested chunk
  (ignored), `sim_save`, a tick, and `sim_load_report` until the next world call;
- `queries`: four running, a fifth `ERR_LIMIT`, a step of 0 units, cancels (one unknown), results that span a tick;
- `subscriptions`: unsubscribe, replacement, both limits, a replacement over the STATS limit, `sub_id` 0;
- `packet-transitions`: retained state across packets: a chest appears and is removed, subscriptions to it go
  `gone`, a replacement, the hover, held-set eviction and re-entry with MOVERS populated then absent, historical
  events and an event overflow (`EVENTS_DROPPED`);
- `watermarks`: a never-joined player's seqs, across a save and a load and its join (rule 12);
- `capacity`: a full inventory: mining refused without depletion, crafting paused and resumed, partial transfers,
  Q, the bar, a craft request over what is affordable, a cancel whose refund does not fit, a stale stop and begin
  after a release, and leaving with a hand that does not fit;
- `remap-load`: a save from another prototype set: ids remapped, an item removed, a new lineage.

`build/traces.ts` `invoke` is the dispatcher every consumer reimplements over its own module; `replay` is what the
golden test runs against the reference model.

## How each package consumes it

**Sim (C2).** Load `protos/prototypes.bin` (`sim_init`), then `start.save`'s sections (`sim_load` with the header's
lineage). Run ticks 1–3,600 with the log's closures (an empty closure for a tick without a record), supplying the
log's blob before tick 55. Pass when, natively and in WebAssembly:
- every d_t, slice_t and r_t equals `digests.txt` (d_t also the log's digest region), and the preimage of d_t at the
  ticks of `digest-preimages.txt` is those bytes;
- after tick 600, the slice hash of every shard equals `slices/tick-0600.txt` (debug with the members file);
- `sim_save` after ticks 0, 1, 2, 300, 600 and 3,600 equals `states/tick-NNNN.sections` byte for byte, lineage
  included, and `sim_state_hash` equals `states/hashes.txt`;
- loading `states/tick-0300.sections` (its sections and r) and running ticks 301–3,600 gives the same d_t and r_t;
- extracting as the golden flow does (below) gives `packets/*.bin` byte for byte, and each projection and query
  gives the record in `projections/` and `queries/`, except the masked fields;
- every trace of `abi/traces.json` replays with the same statuses, envelopes and state assertions;
- every case of `negative/index.json` returns its status, and a refused call changes nothing.

The golden flow: load; extract (no view: the FULL packet); `sim_subscribe(subs.bin)`; extract with `view.bin`
(tick 0, no tick run); tick 1; extract with `view.bin`; ticks 2–600 with no extraction; extract with `view.bin`.

**Shell (C3).** Replay `closure-log.pwlog` from `start.save` through the `LocalSequencer` in replay mode and compare
the digests (with the real module: equal; with a stub: framing and order only). Drive the ABI traces through the
shell's module wrapper (statuses, envelopes; `sim_last_error` on failures). Parse `logs/*` and refuse every
`negative/logs/*` with the reader's error. Refuse `negative/module/stale-schema.wasm` at the handshake (its schema
hash is SCHEMA_HASH with every byte inverted; its ABI version is this one) and `negative/saves/*` as indexed. Build
remap tables as the `remap-load` trace's input shows (the removed ids' names travel in them). Fill `state_gen` and
`view_seq` into the golden packets (the module leaves them 0).

**Renderer (C4).** Decode `packets/*` and the `packet-transitions` trace's packets (the generated `decodePacket` and
record codecs), apply them in order to the mirror, and draw them with `test/fixtures/sprites/manifest.json` and
`protos/prototypes.json` (sprite names) at 1× and 0.3×: an entity that leaves a re-sent chunk's list is gone, a
chunk that leaves the held set is dropped, an absent snapshot section (MOVERS) means none. Run
`test/fixtures/sprites/cases.json`: each case is a packet-shaped input, a camera and the draws §15.7's programs
produce. The atlas has a set for every sprite the golden packets draw (the chest, its greybox, the character, the
ore, the three item icons, the tree species of `treeSpecies`; a test checks it), and it was built for these
prototypes: its `prototypesHash` is theirs, so §15.7's check passes as written.

**UI (C5).** Decode `projections/tick-NNNN/*.bin` with the generated codecs into UI state, and the UI records inside
the packets and traces (statuses ok, gone and invalid with their reasons, versions across replacements, the STATS
series whole and then incremental). Item names, icons and locale keys come from `protos/prototypes.json`.

**Assets (C6).** The tiny atlas is C6's own fixture (`scripts/assets/fixture.py` → `test/fixtures/sprites/`): one
set of every kind with explicit index tables, in exactly the build's format, with `cases.json` and its notes, which
fix §15.7's readings. Regenerate it after `npm run data`, so it names these prototypes; that changes the golden set:
`node test/golden/build/main.ts --write --bump mechanical "why"` records the new hashes, and the renderer reruns its
golden test.

**Audio (C7).** `packets/tick-0600.bin` holds 70 events of every M0 kind with their players and seqs; the
`packet-transitions` trace adds historical events and an overflow. `AUDIO_WORKING` is absent because nothing works
in M0 (use the fake sim, `?sim=fake`, for working sounds and the music feed). The fake takes its sound ids from the
build's working-sound table (prototypes.bin's `working_sound`, which the data stage fills from
`game/data/engine/sounds.yaml`), so its `AUDIO_WORKING` carries the audio package's own sound ids.

## Masked fields

Implementation-defined values the golden set does not pin; the model writes 0 there: `DEBUG.memory_bytes`,
`DEBUG.pools[].capacity` (the model writes the row count) and `DEBUG.phase_us` (empty). The digests d and r are
pinned everywhere (`DEBUG`, the `digest` query, `sim_digest`, `sim_save`'s lineage).

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
8. A new character (`player_joined` for an index without one) gets the next serial at (0, 0), facing south (8), the
   start inventory (`meta.start.inventory`), auto-sort on; the spawn point is not searched for a free position in
   M0. A watermark record (rule 12) keeps its `last_seq` and input generation. Joining while online changes
   nothing; whether the character exists decides, not the `returning` flag.
9. `player_left` and `release_inputs` stop walking, mining and picking and raise the input generation, for any
   player with a record, online or not; for an index without one they do nothing. The hand returns to the main
   inventory only if all of it fits (origin slot first); otherwise it stays in the hand (§5.1).
10. Phase 1 applies the closure, then advances every online character in ascending player index: walking, then
    mining, then crafting. An action applied in tick t takes effect in tick t.
11. Walking: speed = `running_speed` × the walking speed of the tile under the character; diagonals move
    speed × √½ (`Math.SQRT1_2`) per axis. A step that collides is retried as its x part, then its y part (diagonals
    only), else the character stays; no movement up to contact. Collision is strict overlap of the character's box
    (±0.2) with unwalkable tiles and buildings' collision boxes (chests keep theirs under trimmed collision);
    characters do not block each other.
12. An action's seq is consumed first (refused or not, §15.3 "Identity and seq"). A player index without a
    record gets one when its first action arrives: a **watermark record** (PLAYERS `character` 0, offline, every
    other field at its default), so its seqs stay consumed across ticks, saves and its later join (GATE-r1
    finding 3). The checks then run: decode (`malformed`), capability manifest (`unsupported`), presence
    (`player_not_present`: no record, offline, or no character), fencing (`input_fenced`, no `action_failed`),
    the action's own rules.
13. `last_action_tick` is set by every action that is not refused, fenced, malformed or unsupported.
14. `inventory_version` rises by one for each action and each mining or crafting step after which the main
    inventory's slots or the hand differ.

**Inventories and transfers**
15. Slot-heap class ids are the indexes of the size sequence 1, 2, 4 … 128, 192, 256 …; an inventory owns a block of
    the smallest class that holds it (the character's 80 slots: class 7, 128 slots). An empty slot is
    `{none, 0}` in live and freed blocks alike; the save lists arenas with blocks, ascending by class.
16. A limit bar exists only below the inventory's size and limits what machines and bulk transfers put in: Shift
    and Ctrl transfers and fast entity transfers fill only the slots below it (and never top up a stack past it),
    as inserters and robots will. A click with the hand (LMB, RMB) puts items into any slot, past the bar too.
    Taking items out is never limited. (Factorio 2.0.77, tested; wiki "Stack": "the player is still free to
    manually place items in the unused (red) slots"; Lua API `LuaInventory`: the bar "limits the portion of the
    inventory that may be manipulated by machines"; GATE-r1 finding 1.)
17. Insertion fills partial stacks of the key first, then empty slots, ascending, below the bar, never the hand's
    origin slot; removal takes from the highest slot down. With auto-sort on, the main inventory is sorted at every
    step boundary: every slot but the origin slot becomes the item totals in ascending item key, full stacks first.
18. Characters are not entities: an `EntityRef` naming a character's serial is `target_gone`. `InvSlot` owner tag 0
    is the main inventory and needs `inv = main`; an entity inventory needs reach (10) and its own type. Checks:
    target, reach, inventory type, slot.
19. LMB/RMB on a slot follow I §3.8's table; picking up from an empty slot, RMB onto another item and LMB onto a full
    stack of the same item do nothing, without an event. Shift and Ctrl transfers move to the other inventory
    (refused with `invalid_index` when it is the same one, `nothing_to_transfer` when the source is empty) **what
    fits**: into a chest silently, also when nothing fits; into the player's inventory with the flying text
    `inventory_full` ("Cannot insert Iron plate. Inventory is full.") for the first item that did not all fit. A
    fast entity transfer of the hand into a chest that has no room does nothing, without a text. Halves round up. Q
    returns the stack to its origin slot first (the reserved slot, rule 17, always takes it), puts what fits into
    the main inventory and keeps the rest in the hand, with `cannot_put_away` ("Cannot put away the Iron plate.
    Player inventory is full."). None of these is a refusal: each does what it can, and a refusal changes nothing
    (§15.3; GATE-r1 finding 4). Flying text `item_delta`: fast transfers (at the entity) and mining and crafting
    results (at the character), one per item key, `total` = the main inventory's count. A message carries the seq of
    the action that caused it, or 0 when a tick's step did (mining, crafting); `inventory_full` and
    `cannot_put_away` name the item, with `count` = how many did not fit and `total` = −1. (Factorio 2.0.77,
    tested; changelog 0.17.2; locale `cant-clear-cursor`.)

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
    gone or out of reach. A unit whose result does not fit removes nothing and drops nothing, says
    `inventory_full`, and restarts: mining goes on while the input is held. Mining an entity moves its contents
    first, its first slots first, as far as they fit; the entity goes, with its own item, only when all of it fits.
    A depleted tile stops mining. (§5.1, I §3.7; changelog 2.0.67: "Changed manual mining when the inventory is
    full to not drop the mined result on the ground"; 0.10.9; Factorio 2.0.77, tested.)
24. Resource bands are Factorio's ore stage counts {15000, 9500, 5500, 2900, 1300, 400, 150}: band 0 (richest) to 7.
25. Crafting reads the main inventory only, not the hand; a request above what can be crafted queues what can,
    without a message, and none at all is `not_enough_ingredients` (Factorio 2.0.77, tested; Lua API
    `begin_crafting`: "The count that was actually started crafting"; I §3.9's "refuse the whole click" is wrong
    and should be corrected). The same recipe merges into the last entry. A craft whose product does not fit
    pauses and says `inventory_full` once, in the tick its unit completes (changelog 0.15.0). One `item_crafted`
    (count 1) per craft. **Cancelling** refunds the ingredients; when they do not fit, M0 refuses the cancel
    (`inventory_full`, nothing changes). Factorio never refuses: it drops what does not fit on the ground around
    the character (2.0.77, tested; Rseding91, forums t=93124), but ground items arrive in M1 (10 §12), so the spill
    is M1's rule and its golden set's.
26. Statistics (M0: items): mined ore and crafted products are produced, ingredients consumed at completion. Rings:
    ticks per point 1, 12, 120, 720, 7,200, 36,000, 180,000, 720,000 (precisions 0–7), aligned to tick 0 for every
    key; `all` starts at 60 ticks and doubles each time 300 points fill (pairs merged as f32 sums). STATS entries
    are the window's 300 points plus the open accumulator (`all`: the exact totals); the tail's keys (zeros for a
    key without a record), or every key of the tab for an empty tail; series for the first 24 keys. A series is sent
    whole after subscribing, after a parameter change, and after its ring's span changed (the `all` ring's
    doubling): a whole series starts at the ring's oldest point, so `from` tells the UI to replace what it holds.

**Digests, saves, ABI**
27. The per-tick digest hashes exactly §4.8's byte sequence (abi.yaml `TickDigestHead`, `RngWords` per stream,
    `TickDigestBody`, `PlayerDigest` per online player, `TickDigestTail`): the stream and player lists carry no
    count, the two counter lists do (GATE-r1 finding 2). `entity_count` counts entity-table rows (not characters).
    A section's own hash in `sim_state_hash` is XXH64 of its bytes.
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
    the last sent; `version` counts the records sent per sub_id, across replacements. The limits (32 besides the
    hover, 4 STATS) hold for the set a request leaves: a replacement is checked as if the subscription it
    replaces were gone, and a refused replacement ends that subscription too (GATE-r1 finding 8). Unsupported
    kinds and requests over a limit send one status-2 record (reason 1 or 3) and are dropped; a target that does not
    exist sends one `gone` record.
35. HUD is the tick only; CHARACTER's quickbar is empty (M0 keeps none); chest panels and hovers carry no status.
    CHARACTER declares no source revisions (projections.yaml, GATE-r1 finding 7): it is rebuilt at every extraction.
36. `inspect` lists the entity-table row's saved columns, then the pool row's, each with its type code and
    little-endian value (a handle as the serial).

**Slices and lineage** (§4.8 items 2–4; GATE-r1 finding 6)
37. A table section (ENTITY_TABLE, POOL_CONTAINER) has a header member, `u32` row count, at its `header_shard`
    (key 0), and one member per row: `u32` row index, then the row's columns in directory order at their widths. A
    live row's key and shard are its entity's serial (mod 3,600); a free row's key is 2³² + its index, its shard its
    index mod 3,600.
38. A `records` section has a count member, `u32` count, at shard (3,000 + section id) (key 0), and one member per
    record: its stored bytes (`u32` length, then the triples), key = its position + 1, sharded by the section's rule
    (chunk key, (1,800 + 97 × index) for players, the stat key, the timer's serial or owner).
39. The slot heap: per arena, ascending class, a header member (`u8` class, `u16` block slots, `u32` blocks) at
    shard (3,100 + class), key class × 2³²; then one member per block, key class × 2³² + 1 + block: its slots, then
    `u32` count and its limit-bar entries, then `u32` count and its filters (ascending slot). A block's shard is its
    owner's: a container's entity serial, a player's (its main inventory), or for a free block its InvRef mod 3,600.
40. GLOBALS (base 0) and RNG (base 1,801) are their raw bytes in 4-KiB pieces, key = the piece index.
41. Slice t hashes shard t mod 3,600's members **sorted by (section id, key)**, each framed as `u32` section id,
    `u64` key, `u32` length, bytes; an empty shard hashes zero bytes. The order is the key's, not the storage
    order: a reused row can hold a higher serial than a later row (`slices/collisions.*` pins such a state, with
    a free row in the same shard; GATE-r2 finding 1). It is computed in phase 16, after the tick's changes. r_t =
    XXH64(r_{t−1} ‖ d_t ‖ slice_t), and `sim_load` continues from the r it is given.
42. A load with remap tables (`kind_count` > 0) starts a new lineage, r = XXH64(u64 stateHash ‖ u32 tick), over the
    remapped state. Its load report lists the removed prototypes the state used (count > 0), named by the remap
    tables' `removed` names (abi.yaml `RemovedName`: only the shell has the save's name tables), ascending by kind
    and name; the count is the items lost, the entities removed or the crafts dropped. A plain load's report has
    `new_lineage` false, the save's r and nothing removed. `sim_save` with BAKE returns the same new lineage over
    the saved state (the running world keeps its r).

**The ABI** (§15.8; GATE-r1 finding 11)
43. `sim_load_report` answers after a `sim_load` until the next world call (`sim_new_world`, `sim_load`), ticks
    included; before, `ERR_ORDER`. Every export that needs a world returns `ERR_ORDER` without one.
44. `sim_query_step(units)`: the running queries finish in arrival order; the traces pin 0 units (none finishes) and
    0xFFFFFFFF (all finish), which every cost model agrees on. A result's first tick is the tick it started in,
    its last the tick it finished in; an unsupported kind finishes with ok 0 and reason 1.
45. `sim_supply_chunk` of a chunk no request asked for is ignored (status ok, state unchanged); a fully stored map
    has no pending requests.
46. The model does not generate worlds: `sim_new_world` and `gen_*` appear in the traces only for their call order
    and their input checks.

**The tiny atlas** is C6's fixture (`test/fixtures/sprites/`); the readings of §15.7 it fixes are the `notes` of its
`cases.json` and `pm/reports/C6.md`, not this file's.

## Freezing

`MANIFEST.json` lists every file's SHA-256; in `external` the tiny atlas's files (by path from `game/`); and in
`contract` this README and the reference model's sources, the contract's inputs (GATE-r1 finding 15). The tests
fail when a file, an external file or a contract input differs from the manifest, when the manifest is not the
latest version's, when the schema hash is not the one the set was built against, or when the model no longer
reproduces the set.

`VERSIONS.txt` is append-only and hash-chained: each line after version 2 holds the version, the SHA-256 of the
manifest's tables, `kind=`, `approval=`, `prev=` (the first 16 hex digits of the previous line's SHA-256) and the
reason. A test checks the chain and that the ledger at the reviewed base (`dev`, or the last commit when on `dev`)
is a prefix of this one. `MANIFEST.json` is written only by a bump, and a bump is classified against it after
checking that its tables still hash to the latest ledger line, so a regeneration (`--write`) cannot move the
baseline (GATE-r2 finding 4). The two kinds follow pm/DECISIONS-IMPL.md decision 14:
- `--bump mechanical "why"`: no expected value changed: against the baseline, only the tiny atlas changed, a schema
  layout change moved the schema hash, or only the frozen prototype files under `protos/` changed. The contract
  inputs never change in a mechanical bump. The package that causes it may record it in its own commit; the tool
  refuses a mechanical bump of anything else.
- `--bump value --approval <reference> "why"`: expected states, digests, records, packets, refusals or rules
  changed. It needs the manager's approval first (the reference names the review or decision); codex reviews the
  diff; a sim package never "fixes" a golden value to match itself.

A reason has at least 20 characters. Every package that consumes the changed files reruns its golden test.

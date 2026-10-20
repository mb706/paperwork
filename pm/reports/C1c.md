# C1c: The fake sim, the reference model and the M0 golden integration set
Status: done

Contract gate items 4 and 6 (10 §12). Commits on `dev`: d4bd2b0 (model and golden set v1), 5584174 (the golden
set uses C6's fixture atlas, v2), acdd497 (the fake sim), and the final commit with this report.

## Summary

**The reference model** (`game/test/golden/model/`, about 2,800 lines of TypeScript). It is an executable
specification of exactly M0's capability manifest. It is straight-line code with a spec citation at each rule,
and every place where the spec was silent says "Model decision". It covers:
- the closure pipeline: preflight, decoding, `malformed` and `unsupported`, presence, input fencing, refusals and
  creation ids (§15.3);
- walking and collision, hand mining, hand crafting, the chest (build, fill, limit bar, mine) and every inventory
  transfer (§5.1–§5.2, I §3.8);
- the system actions; statistics rings; the canonical allocator and slot heap; saves (§8);
- the per-tick digest d_t and the state hash, on its own XXH64 (§4.8);
- extraction and the M0 projections and queries (§15.4–§15.5).

It runs on the generated writers, so every byte it emits goes through the same codecs that the implementations use.

**The frozen M0 golden set** (`game/test/golden/m0/`, version 2, 210 files, 3.1 MB). It has every part §15.10
lists:
- the M0 prototype build;
- `start.save`;
- a 600-tick closure log with 97 scripted steps for two players;
- d_t for every tick;
- canonical states and hashes at ticks 0, 1, 2, 300 and 600;
- the packets of the golden flow at ticks 0, 1 and 600;
- every M0 projection and query at five ticks;
- valid logs, and 58 negative cases.

The tiny atlas is C6's fixture (`game/test/fixtures/sprites/`), frozen in the manifest's `external` table. The
supporting pieces:
- `game/test/golden/build/` generates the set;
- `game/test/golden/README.md` documents it: the files, the scenario, how each package consumes it, the masked
  fields, the 36 rules it fixes, and freezing;
- `MANIFEST.json` and the append-only `VERSIONS.txt` freeze it.

```sh
cd game
node test/golden/build/main.ts                          # check: the model reproduces m0/ (≈ 3 s)
node test/golden/build/main.ts --write --bump "why"     # regenerate, review the diff, record a version
npx vitest run test/golden                              # what CI runs
```

**The fake sim** (`game/src/simworker/fake.ts` and `fake/`, about 2,150 lines). It speaks §3.2's protocol
(`game/src/shared/protocol.ts`) and writes every packet with the generated encoders.
- **World:** seeded terrain (value noise on integer hashes) with water, sand, dirt and grass, ore patches with
  richness bands, trees and rocks. Two players: player 0 is driven by `act`; player 1 is scripted and builds and
  mines a chest every 10 s.
- **The factory** uses the build's own recipes, crafting speeds and Factorio's belt speeds:
  - drills, a cornered yellow belt, inserters of four kinds, furnaces and a red belt;
  - assemblers: one working, one without power, one idle; a keypunch, a seminar, a radar;
  - lamps, poles, solar, a steam power plant, chests;
  - a ghost, a building marked for deconstruction, undergrounds and a splitter.
- **Sections:** it sends all 13 sections a renderer, UI or audio package reads in M0 and M1: `CHUNK_TILES`,
  `CHUNK_ENTITIES`, `CHUNK_OBJECTS`, `CHUNK_RESOURCES`, `DYN`, `HANDS`, `BELT_GEOM`, `BELT_ITEMS`,
  `BELT_RETIRE` (the corner belt is "rebuilt" every 30 s), `MOVERS`, `EVENTS`, `UI` and `AUDIO_WORKING`.
- **Projections and queries:** all seven M0 projections (`CHARACTER`, `INVENTORY`, `ENTITY_PANEL`, `HOVER`, `HUD`
  with the music feed, `STATS` with series, `DEBUG`) and the three M0 queries.
- **Protocol behaviour:** it follows the replacement protocol (`bound`, then an unsolicited `FULL` packet; state
  generations on every message; messages of another generation dropped).
- **Pacing and buffers:** it paces exactly as §3.3's LocalSequencer does (due ticks, at most 3 per wake, a rebase
  over 6 behind, clock generations, `MessageChannel` short waits). It steps synchronously in test mode, extracts
  without ticks after `view`, `sub` and `unsub`, and pools three 256 KiB buffers with `ack` (backpressure skips
  extraction).
- **Explicit errors:** it refuses non-rising seqs, actions outside the manifest (`action_failed` reason 2),
  malformed actions (reason 1), projections outside the manifest (status 2) and queries outside it (`res` not ok,
  reason 1).

Running it:
- `npm run dev`, then `http://127.0.0.1:5173/?sim=fake` (dev builds only). WASD walks; `?fakeDay=N` shortens the
  day; `?test=1` pauses it.
- `window.__fake.step(n)`, `.act(action)` and `.status()` drive it.
- `node test/fake/snapshot.ts out.png [ticks]` draws its packet stream into a picture.

**Tests in `npm run ci`.** Vitest runs `test/golden/` (33 tests) and `test/fake/` (8 tests); the `@smoke` e2e runs
`e2e/fake.spec.ts` in Chrome and Firefox.
- `test/golden/`: the model reproduces every golden file byte for byte; the freeze ledger; the round trips; the
  negative cases; the atlas coverage.
- `test/fake/`: every fake packet decodes and round-trips; every projection; queries; dev hooks; pacing;
  determinism.

## How each package consumes the golden set

The README has the full text; this is the contract in brief.

**The golden flow** (one sequence every package reproduces):
1. load `protos/prototypes.bin`, then `start.save`;
2. extract with no view (the FULL packet, header only);
3. `sim_subscribe(subs.bin)`;
4. extract with `view.bin` at tick 0, no tick run;
5. run tick 1, then extract;
6. run ticks 2–600 without extraction, then extract (`COALESCED`).

The closure log names one blob, needed before tick 55.

- **Sim (C2).** Natively and in WebAssembly:
  - every d_t equals `digests.txt`;
  - `sim_save` after ticks 1, 2, 300 and 600 equals `states/tick-NNNN.sections` byte for byte, and
    `sim_state_hash` equals `states/hashes.txt`;
  - the golden flow's packets equal `packets/*.bin`, and the projection and query records equal `projections/` and
    `queries/`, except the masked fields;
  - every case in `negative/index.json` returns its listed status, and a refused closure changes nothing.
- **Shell (C3):**
  - replay `closure-log.pwlog` through the LocalSequencer in replay mode (with the real module, the digests match;
    with a stub, framing and order only);
  - parse `logs/*` and refuse `negative/logs/*` with the reader errors listed;
  - refuse `negative/module/stale-schema.wasm` at the handshake, and refuse `negative/saves/*` as indexed;
  - fill `state_gen` and `view_seq` into packets (the module leaves them 0).
- **Renderer (C4):**
  - decode `packets/*` in order into the mirror;
  - draw them with `test/fixtures/sprites/manifest.json` and `protos/prototypes.json` at 1× and 0.3×;
  - run `test/fixtures/sprites/cases.json`.

  The atlas covers every sprite the golden packets draw, and a test checks this. Its `prototypesHash` names C6's
  build, not the golden one, so the renderer joins sets by name for the fixture. For the fake scene, see open
  issue 5.
- **UI (C5):**
  - decode `projections/tick-NNNN/*.bin` into UI state;
  - decode the UI records inside the packets: statuses ok, gone and invalid; versions; STATS series, whole and then
    incremental.

  Names, icons and locale keys come from `protos/prototypes.json`. For live data, use `?sim=fake`.
- **Assets (C6).** The tiny atlas is C6's own fixture. Regenerating it (`scripts/assets/fixture.py`) changes the
  golden set, so it must be recorded with `--write --bump`.
- **Audio (C7):**
  - `packets/tick-0600.bin` holds 70 events of every M0 kind, with players and seqs;
  - `AUDIO_WORKING` is absent, because nothing works in M0;
  - for working sounds and the HUD music feed, use `?sim=fake`.

**Masked fields** (the model writes 0 and the tests ignore them):
- the rolling digest r (`DEBUG.r`, the digest query's r, `sim_digest`'s r, `sim_save`'s trailing lineage);
- `DEBUG.memory_bytes`, `DEBUG.pools[].capacity` and `DEBUG.phase_us`.

r₀ (`start.save`'s lineage) is pinned.

**When the set changes:**
1. run `--write`;
2. review the diff;
3. run `--bump "why"`;
4. every package that consumes the changed files reruns its golden test.

A frozen-file change without a bump fails `golden.test.ts`.

## Decisions and deviations

### Deviations
1. **Map size (§15.10).** §15.10 asks for "a bounded map of 3 × 3 chunks around the origin", but a centred map
   cannot be 3 × 3 chunks. The golden map is 96 × 96: it covers x in [−48, 48) and chunks −2…1, with 16 chunks
   stored as modified (rule 1). It still has negative chunk coordinates, a pond, a resource patch, chests and a
   player, and it needs no worldgen. **§15.10's wording should be updated.**
2. **The tiny atlas is C6's fixture (manager's instruction).** I dropped my own atlas. The golden set freezes C6's
   files by hash (`MANIFEST.json` `external`), and golden version 2 records this. C6's fixture covers every sprite
   the golden packets draw (the chest, its greybox, the character, the ore, the three icons), so I did not need to
   extend `fixture.py`.
3. **`src/shared/protocol.ts` exists now.** §3.2 names the file, and the fake needs it. It is §3.2's types, except
   that `boot.module` and `ioPort` may be null, because the fake has neither. C3 owns its evolution (C3's brief also
   wants versioned messages).
4. **`?sim=fake` is dev-only**, through a dynamic import behind `import.meta.env.DEV`. Only the dev server serves
   its data, and the release bundle stays free of it: I checked that `dist/` has no fake code. §15.10's "keeps it
   available after integration" holds in dev builds.
5. **The fake runs on the M1 prototype build** (`--manifest m1 --allow-incomplete`), because M0's build has no
   belts, inserters or machines. `scripts/fake-data-plugin.ts` builds it in watch mode into `.cache/data/m1/` and
   serves it at `/data/fake/`.
6. **`game/biome.json`** excludes `test/golden/m0`, because Biome had reformatted the frozen JSON. This is one line.
7. **No `test/fixtures/packets/`.** §15.10 says these are recorded from the real sim for later milestones. Until
   then, `test/fake/` pins the M1 sections' decoders on fake packets.
8. **The fake's sound ids are stand-ins** while the build has no working-sound table: the data stage does not read
   `sounds.yaml` yet (C1b decision 14). It reads prototypes.bin's `working_sound` column and uses it automatically
   once it is filled. Until then, its machines, radars and belts send their prototype ids, and a log line says so at
   boot.

### Rules the golden set fixes (spec ambiguities decided in the model)
The README numbers them; the real sim must follow them, and a package that disagrees reports it with a citation.

**Map and world:**
1. A centred map (x in [−⌊W/2⌋, W−⌊W/2⌋)) is 96 × 96, and its stored chunks have out-of-map tiles beyond it.
2. Nothing is pristine, so no chunk outside the map is requested.
3. Out-of-map and ungenerated tiles are unwalkable and unbuildable.
4. The worldgen pair is version 1 plus the SHA-256 of `prototypes.bin` frames 6–8. A save with another pair is
   refused only if it has a pristine chunk.
5. The climate compass is off, and κ is the mean of the tiles' `kappa_per_s`.
6. Chunk view versions start at 1, and every entity or resource change bumps them.
7. Daylight is 65,535 in M0.

**Players:**
8. `player_joined` spawns at (0, 0) facing south, with the start inventory and auto-sort on.
9. `player_left` and `release_inputs` stop walking, mining and picking and raise `input_gen`. The hand returns to
   the inventory only if all of it fits.
10. Phase 1 applies the closure first. Then each online character walks, mines and crafts, in player order.
11. Walking speed is `running_speed` times the tile's walking speed, and diagonals multiply it by √½. A blocked
    step slides on x, then on y. The character's box is ±0.2, overlap is strict, and characters do not block each
    other.
12. Checks run in this order: seq consumed, decode, manifest, presence, fencing (an `input_fenced` event, no
    failure), then the action's rules.
13. `last_action_tick` is set by every applied action.
14. `inventory_version` bumps once per changing step.

**Inventories:**
15. Slot-heap classes are 1, 2, 4…128, 192, 256…, and an empty slot is `{none, 0}`.
16. A limit bar exists only below the inventory's size.
17. Insertion fills partial stacks first, then empty slots, and never the origin slot. Removal goes from the top
    down. Auto-sort runs at every step boundary.
18. Characters are not entities, so naming one is `target_gone`. InvSlot checks run in order: target, reach,
    inventory type, slot.
19. Clicks follow I §3.8's table, and halves round up. Q returns the stack to its origin first. Fast transfers have
    their own refusals. Flying text is one per item key, with the main inventory's total.

**Building, mining, crafting:**
20. `build` checks run in order: mode, hand, parity, reach, map, tiles, buildings, characters. An emptied hand
    refills from the lowest slot holding the item, or becomes a ghost cursor.
21. Reach is measured to the collision box, as d² ≤ reach².
22. A unit completes at progress 1 − 10⁻⁹ and carries the excess. A 0.5-s craft takes 30 ticks, ore 120 ticks and a
    chest 24 ticks.
23. Re-mining the same target keeps its progress. Mining stops silently when the target is gone or out of reach, and
    a full inventory refuses with seq 0.
24. Resource bands use Factorio's stage counts {15000, 9500, 5500, 2900, 1300, 400, 150}.
25. Crafting reads only the main inventory. The queue merges a repeated recipe, and a craft whose product does not
    fit pauses.
26. The statistics rings have 1, 12, 120, 720, 7,200, 36,000, 180,000 and 720,000 ticks per point. `all` starts at
    60 ticks and doubles. STATS sends 300 points plus the open accumulator, with series for the first 24 keys.

**Digests and ABI:**
27. `TickDigest` follows C1b, and `entity_count` excludes characters.
28. Handle generations cycle from 1 to 1,023.
29. A save holds every hashed section. A section version that is too new is `ERR_LOAD_FORMAT`; a column of another
    type is `ERR_LOAD_SCHEMA`.
30. Subscribing sub_id 0 is `ERR_INPUT`, because sub_id 0 belongs to the hover.

**Extraction:**
31. The FULL packet after a load is header-only. A chunk entering the held set gets all four records.
32. MOVERS: x, y = floor(v × 256 + 0.5); velocity is the real displacement; orientation is dir × 4,096.
33. Empty sections are omitted, and `COALESCED` marks more than one tick since the last extraction.
34. Subscriptions are served in sub_id order, and a record is sent when its XXH64 changes. A refused subscription
    gets status 2 and is dropped; a missing target gets one `gone`.
35. HUD is the tick only, and CHARACTER's quickbar is empty.
36. `inspect` lists the saved columns with type codes.

### Fake sim decisions
- **Modelled actions:** `act` drives walking, mining resource tiles, hand crafting and cancelling, cursor clicks and
  splits on the main inventory, `clear_cursor` and the auto-sort setting. Other M0 actions are accepted, change
  nothing and are logged at info. Its rules are simplified: walking checks tiles only, and crafting has no
  intermediates. The reference model, not the fake, is the rule authority.
- **What the fake does not do:** `save` logs a warning and no `saved` follows; `world load` starts a new world with a
  warning. The dev hooks (§3.5) answer with `res`, but their hash and digest are made up.
- **Input generations** stay 0. Nothing in single player raises them without `release_inputs`, which the fake does
  not receive.

## Verification

- **`taskset -c 0-15 npm run ci`: green in 31.6 s wall** (64.9 s of steps). It took 28.0 s before C1c. Vitest is
  13.1 s of that, and the e2e smoke in Chrome and Firefox is 15.5 s.
- **Golden set:**
  - `node test/golden/build/main.ts` reproduces all 210 files in 2.8 s.
  - The model's unit tests pass: a 30-tick craft, 120-tick ore, a 24-tick chest, bands, walking at 0.15 and
    diagonally, sliding on the map edge, the `all` ring's span and extraction deltas. XXH64 matches python-xxhash
    vectors.
  - All 58 negative cases are checked with the generated decoders and readers.
  - Every golden packet, projection and query round-trips byte for byte.
- **Fake sim, Vitest (8 tests):**
  - over 2,000 ticks, every packet decodes and re-encodes to the same bytes, and all 13 sections appear;
  - every M0 projection decodes and round-trips: an assembler panel at 1 craft/s, an inventory, a hover, STATS
    entries and DEBUG;
  - `inspect` works, `rates` is refused as unsupported, and the dev digest hook answers;
  - walking at 0.15 tiles a tick, and an unsupported action refused with reason 2 and its seq;
  - the HUD's Literature is 1,946 after 3,600 ticks, and `activity_w` exceeds 100 kW;
  - pacing on a manual clock: 60 ticks in 1,001 ms with one packet each; a 70-ms late wake runs 3; a 500-ms stall
    rebases with a new clock generation; speed 2 doubles; paused, a view is still answered;
  - the same inputs give byte-identical packets.

  This testing found and fixed one real bug: `inspect` wrote 4 bytes into a 2-byte buffer.
- **Fake sim in a real worker:**
  - The @smoke e2e is green in Chrome and Firefox, and stable over `--repeat-each 4`.
  - A real-time run in Chrome: **60.1 UPS** over 5 s, one packet per tick, about 3.5 KB per packet, no console
    errors.
  - Holding D walks the character.
- **Seeing it:** I read the picture from `node test/fake/snapshot.ts` at tick 1,200 (scratchpad, not committed).
  Terrain, ore patches with bands, tree clusters, a pond and the factory are coherent. Belt items follow the
  straight segments and the corner arc, the hands sit at their pivots, and the ghost and the marked chest are
  distinct.

## Open issues and follow-ups

1. **C6-r1 will change the frozen atlas.** Review findings 1 and 3 regenerate `test/fixtures/sprites/`. After that
   merge, `golden.test.ts` fails with "external file changed" until someone runs
   `node test/golden/build/main.ts --write --bump "C6-r1 fixture"`. Only `MANIFEST.json` and `VERSIONS.txt`
   change, and the renderer reruns its golden test. Whoever merges C6-r1 should do it.
2. **A schema change forces a regenerated golden set.** Any schema change that alters golden bytes needs
   `--write --bump`, but C2's brief forbids touching the golden set. I suggest this process: the manager, or the
   agent making the change with the manager's approval, runs `--write`; the reviewer checks the diff; the bump
   names the change. If the semantics change, the model changes too.
3. **CHARACTER's `sources` gap (schema).** `projections.yaml`'s CHARACTER sources omit `mining_progress`, crafting
   progress, `input_gen` and the flags. A sim that rebuilds only on those sources would miss records that the golden
   packets hold. Either add those sources or rebuild CHARACTER every tick (rule 35).
4. **r is unpinned.** §4.8 leaves the byte composition of the slice hash to the sim, so the golden set cannot check
   r across implementations. Pinning it means adding that composition to §4.8 and the model.
5. **Hash pairing for `?sim=fake`.** §15.7 makes a `sprites.json` built for another `prototypesHash` an error in dev
   builds, and §15.6 does the same for `sounds.json`. The real atlas and audio manifest are built against the M0
   build, while the fake runs on M1, so C4 and C7 need a fake-mode exception: join by name and warn. C6's
   greyboxes cover every spec entity, so the fake's scene can be drawn.
6. **Working-sound ids.** The data stage should read C7's `sounds.yaml` and fill `working_sound` and
   `prototypes.json.sounds` (C1b decision 14). Then the fake's `AUDIO_WORKING` carries real ids automatically.
7. **`prototypes.json.treeSpecies` is empty** in the M0 and M1 builds. The fake's trees use species 0–3 as stand-ins,
   and the renderer needs the table to pick tree sprites.
8. **The golden set is about 3 MB in git.** Every regeneration adds a delta, which stays modest because most files
   are small.

## Files

**Created:**
- the reference model: `game/test/golden/model/`: `xxh64.ts`, `protos.ts`, `world.ts`, `presentation.ts`,
  `inventory.ts`, `rules.ts`, `stats.ts`, `sim.ts`, `projections.ts`, `extract.ts`, and the tests `model.test.ts`
  and `xxh64.test.ts`;
- the golden set's build: `game/test/golden/build/`: `protos.ts`, `start.ts`, `stamp.ts`, `scenario.ts`, `run.ts`,
  `negatives.ts`, `files.ts`, `main.ts`;
- the frozen set: `game/test/golden/m0/**` (210 files, with `MANIFEST.json` and `VERSIONS.txt`);
- the golden tests and docs: `game/test/golden/golden.test.ts`, `game/test/golden/README.md`;
- test helpers: `game/test/helpers/packets.ts` (decode, encode and dump for every section and projection);
- the fake sim: `game/src/simworker/fake.ts`, `game/src/simworker/fake/{noise,protos,world,extract}.ts`;
- its wiring: `game/src/shared/protocol.ts`, `game/src/app/fake-mode.ts`, `game/src/app/workers/fake-sim.ts`,
  `game/scripts/fake-data-plugin.ts`;
- its tests: `game/test/fake/{harness,fake.test,snapshot}.ts`, `game/test/fake/pngjs.d.ts`,
  `game/e2e/fake.spec.ts`;
- this report.

**Changed:**
- `game/src/app/main.ts` (the `?sim=fake` switch);
- `game/vite.config.ts` (the fake data plugin);
- `game/tsconfig.simworker.json` (the fake worker entry);
- `game/biome.json` (excludes `test/golden/m0`);
- `CLAUDE.md` ("The code": the golden set and the fake sim).

**Removed** (in 5584174): my own tiny atlas (`test/golden/build/atlas.ts`, `ktx2.ts`, `m0/sprites/`), in favour of
C6's fixture.

## Gate review response (GATE-r1)

Codex's gate review (`pm/reviews/GATE-r1.md`) found 1 critical, 13 major and 1 minor issue. The coordinator gave
me the gate, including the schema changes the fixes need. Golden version 3 records the result as a **value bump**
approved by the review (`approval=pm/reviews/GATE-r1.md`). Rule numbers below are the golden README's.

The rule findings (1, 4, 5) were checked against Factorio's actual behaviour, not only the spec. A research agent
(working for me) read the wiki, the forums, the Lua API docs and the changelogs, and it **tested** each case in
Factorio 2.0.77 (the current stable release): scripted tests in the official headless server, and click-level
tests in the demo client. I cite those tests, with a primary source where one exists.

**1. Critical: a wrong chest-bar refusal was frozen. Fixed** (rule 16).
- What the bar limits in Factorio 2.0.77 (tested):
  - Inserters, robots, Shift/Ctrl transfers, Ctrl+click on the entity, Z and `LuaInventory.insert` fill only the
    slots below the bar, and they never top up a stack past it.
  - LMB and RMB with a stack in the hand put items into a red slot.
  - Taking items out is never limited.
- Sources:
  - wiki "Stack": "the player is still free to manually place items in the unused (red) slots";
  - Lua API `LuaInventory`: the bar "limits the portion of the inventory that may be manipulated by machines";
  - `LuaControl.insert` "works the same way as inserters or shift-clicking";
  - kovarex, forums t=21002: "The restriction is restriction of input, not of output".
- The model's slot clicks now ignore the bar. Bulk and fast transfers keep it. Changes to the golden set:
  - main scenario tick 17 is now an RMB past the bar that places one plate (it was a `cannot_insert` refusal);
  - tick 15 (the hand into chest A, which has no room) does nothing and shows no text, as in Factorio;
  - the `capacity` trace places a whole stack past the bar with LMB.
- `cannot_insert` now has no M0 cause.

**2. Major: the digest schema disagreed with §4.8's byte sequence. Fixed.**
- `abi.yaml` now spells §4.8's sequence exactly: `TickDigestHead` (tick, closure hash), then `RngWords` per stream,
  `TickDigestBody` (the entity count and the two counter lists with their counts), `PlayerDigest` per online player,
  and `TickDigestTail`. The stream and player lists carry no count. `abi_version` is 2, with its `compat.yaml` entry,
  and the hand-written spec fixtures cover the new records (`test/fixtures/codec/spec/abi.hex`).
- `digest-preimages.txt` pins the exact bytes at the state ticks and wherever the lists change length. A test
  checks them against §4.8's layout assembled by hand from the saved state, without the generated codecs.

**3. Major: refused actions lost their seq watermark for absent players. Fixed.** Source: §15.3 "Identity and seq"
(seqs are consumed refused or not) and the preflight's watermarks.
- An index without a record gets a *watermark record* when its first action arrives (PLAYERS `character` 0,
  offline), so its seqs stay consumed across ticks, saves and loads. `player_joined` turns it into a player with a
  character and keeps its `last_seq` and input generation (rules 8, 12).
- The `watermarks` trace checks this: the same seq gets `ERR_FRAMING` in the next tick and again after a save and
  load, and after the join the seq is still consumed. No schema change was needed: the record already allows
  `character` 0.

**4. Major: a refusal could mutate the inventory. Fixed** (rules 19 and 23).
- The model now enforces "a refusal changes nothing" (§15.3):
  - every refused action compares the saved state before and after, and throws on any difference;
  - the trace recorder requires the full state hash to be unchanged after every non-ok call.
- The guard found the reviewer's case, and checking the related cases found more. In Factorio none of these is a
  refusal: each does what it can and says what did not fit.
  - **Q** puts what fits into the inventory and keeps the rest in the hand, with "Cannot put away the Iron plate.
    Player inventory is full." Source: tested; changelog 0.17.2; locale `cant-clear-cursor`.
  - **Transfers into the player's inventory** (Shift/Ctrl from a chest, Ctrl+click on a chest) move what fits,
    with "Cannot insert Iron plate. Inventory is full." Transfers **into a chest** are silent, even when nothing
    fits. Source: tested.
  - **Mining** whose result does not fit removes and drops nothing, says "Cannot insert …", and the cycle repeats.
    Mining a chest moves the contents that fit, and the chest stays. Source: tested; changelog 2.0.67 ("Changed
    manual mining when the inventory is full to not drop the mined result on the ground") and 0.10.9.
  - **Crafting** whose product does not fit pauses and says so once (changelog 0.15.0).
- These messages are not refusals, so they are flying texts, never `action_failed`. That needed the FlyingText
  values `inventory_full` and `cannot_put_away`, and with them `PACKET_VERSION` 2 and their `compat.yaml` entries.
  **C5's locale needs the two strings**: they are Factorio's own, quoted above.

**5. Major: two crafting decisions. Partly rejected, partly deferred** (rule 25).
- **A request above what is affordable: Rejected; the model's rule stays.**
  - Factorio clamps the request to what is affordable, with no message. Tested: RMB (craft 5) with plates for 3
    gears queued 3, and a chain case queued 2 inserters with their intermediates. `begin_crafting{count=5}`
    returned 3; the Lua API says it returns "The count that was actually started crafting".
  - Only zero affordable gives "Not enough ingredients." and queues nothing.
  - I §3.9's "refuse the whole click" is wrong; see open issue 4. The `capacity` trace pins it: 30 requested, 25
    queued.
- **Cancelling when the refund does not fit: Deferred to M1.**
  - Factorio never refuses the cancel. What fits goes into the inventory, and the rest is dropped on the ground.
    Sources: tested; Rseding91, forums t=93124; t=131258.
  - Ground items are M1 content (10 §12), and M0 has no pickup, so a spill would add a system beyond M0's
    capability manifest. M0 keeps an all-or-nothing refusal (`inventory_full`, nothing changes), pinned in the
    `capacity` trace. M1's golden set pins the spill.

**6. Major: rolling digests and lineage were effectively untested. Fixed.**
- The slice serialization is defined (rules 37–41) and implemented in `model/slices.ts`:
  - members of tables (row index plus columns, header pieces);
  - records sections (a count member, then the stored records);
  - the slot heap (arena headers; blocks with their bars and filters, sharded by owner, free blocks by InvRef);
  - pieces;
  - the framing: `u32` section, `u64` key, `u32` length, bytes.
- A model test rebuilds every section from its members alone, byte for byte, and shows that changing one byte
  changes exactly one shard.
- r is no longer masked anywhere. `digests.txt` pins d_t, slice_t and r_t for 3,600 ticks (a whole shard cycle).
  `slices/tick-0600.txt` pins all 3,600 shard hashes of one state, and the members file shows what is behind each.
- `states/*.sections` are now exactly `sim_save`'s output, lineage included. A test loads tick 300 and checks that
  ticks 301–3,600 reproduce every d_t and r_t.
- The remap load pins the new lineage, XXH64(stateHash ‖ tick).

**7. Major: CHARACTER's declared sources missed golden changes. Fixed.** `projections.yaml` declares no sources for
CHARACTER, so it is rebuilt at every extraction (rule 35). The declaration is not in the layout listing, so the
schema hash does not change.

**8. Major: subscription replacement bypassed the STATS limit. Fixed** in the model and the fake. The limits apply
to the set a request leaves. A replacement over a limit is refused with status 2, reason 3, and ends the
subscription it replaced (rule 34). The `subscriptions` trace pins both limits, including a replacement over the
STATS limit.

**9. Major: the capacity and fencing branches lacked golden cases. Fixed.**
- The `capacity` trace starts from a variant of the start state: player 0's inventory is full, with no partial
  ore stack, and chest A is limited to 4 slots. In order, it pins:
  - a resource mining unit refused at completion without depletion (tick 120), with mining continuing;
  - a craft that pauses with its message (tick 31) and resumes when a slot frees (tick 47);
  - partial transfers in both directions, with a message only into the player's inventory;
  - a transfer into a full chest: nothing happens, silently;
  - Q with room for 20 of 50;
  - LMB past the bar;
  - a cancel whose refund does not fit (refused, nothing changes);
  - a request for 30 crafts with plates for 25 (25 queued);
  - after a release, a fresh start that walks, then a stale stop and a stale begin, both fenced, then a fresh stop;
  - leaving with a hand that does not fit, and returning with it;
  - mining a chest whose plates fit and whose ore does not: the plates move and the chest stays.
- Each step's CHARACTER and INVENTORY records and its events are in the trace's packets. `sim_meta` and the final
  save pin the seqs, versions and state.
- The `watermarks` trace (finding 3) covers seq consumption across a save, a load and a join.
- Not changed: the hand on `player_left`. §5.1 explicitly says it "returns to the main inventory if it fits, and
  otherwise stays in the hand". The researcher found no source for Factorio's behaviour; its single-player stand-in
  test suggests the stack simply stays in the hand. I kept the spec's rule.


**10. Major: the packet flow missed retained-state transitions. Fixed.** The `packet-transitions` trace extracts
after every interesting tick and covers:
- a chest the renderer sees appear and then sees removed from its re-sent chunk;
- INVENTORY, ENTITY_PANEL and the hover going `gone`;
- a replacement that changes a subscription's kind while its version keeps counting;
- an unsubscribe;
- held-set eviction and re-entry, with every per-chunk record afresh and MOVERS populated, then absent, then back;
- historical events;
- an overflow of 9,000 events (`EVENTS_DROPPED`, the newest 8,192 kept).

**11. Major: ABI coverage stopped short of invocation contracts. Fixed.**
- `model/module.ts` is the reference model behind every export. `abi/traces.json` holds 7 traces with their input
  files, expected statuses, envelopes, and `unchanged`/`changed` state assertions; README "ABI traces" gives the
  format. The traces cover a successful `sim_meta`, a plain and a remapping load report, query step and cancel
  (and `ERR_LIMIT`), unsubscribe, `sim_pending_chunks` and an ignored `sim_supply_chunk`, `sim_save`, and the call
  order.
- The four prose-only negative cases are now calls in traces. Malformed `gen_init` (3) and `gen_preview` (4)
  inputs are added.
- Every ABI negative case is now executed on a booted Module, with the state checked unchanged. Before, they were
  only decoded.
- Schema fix found while doing this: the load report must name what a remap removed, and only the shell has the
  save's name tables. So `RemapTable` now carries a `RemovedName` per removed id, as part of the `abi_version` 2
  change.

**12. Major: fixture data had unresolved or incompatible references. Fixed.**
- C6's tiny atlas is regenerated by its own generator (`fixture.py`) after `npm run data`, so its `prototypesHash`
  is the golden build's. A test pins this, and another checks that every `treeSpecies` entry has its set.
- `data/engine/sets.yaml` now lists `tree-oak`, the species C6's fixture draws.
- The data stage reads `sounds.yaml` (C1b decision 14): dense ids sorted by name, each entity's `working_sound`,
  and `prototypes.json.sounds`. It is tested, including a refusal of an undeclared sound.
- The fake's build gets the audio package's sound names from `test/fixtures/fake/sounds.yaml`, which applies only
  until `data/engine/sounds.yaml` exists.
- The fake emits no stand-ins any more. A test plays 2,400 ticks and resolves every reference the fake sends
  against its build.

**13. Major: the fake left essential M0 interactions inert. Fixed** (by a fork of mine, in the fake only).
- Build, mining entities with their contents, every chest transfer, the bar, crafting, cancelling and the hand are
  live. They follow the model's checks, reasons, events and flying texts, and every refusal is tested to change
  nothing.
- `save` answers `saved` (size and SHA-256), and loading those bytes restores the world exactly. Any other load
  gets an explicit `trap`.
- The rules settled under findings 1, 4 and 5 are the fake's `POLICY` (`src/simworker/fake/rules.ts`), set to the
  model's.

**14. Major: the fake's STATS taught different semantics. Fixed.**
- The fake honours tail keys, keeps exact totals, and doubles the `all` ring as rule 26 says. It is tested past
  300 points and past a doubling.
- This found a model bug: after the first doubling the model never sent new `all` series points. Now a series is
  resent whole whenever its ring's span changes (rule 26), with a model test past tick 18,000.

**15. Minor: freeze protection did not establish an append-only, reviewable history. Fixed.**
- `VERSIONS.txt` lines after version 2 carry `kind=mechanical|value`, `approval=` and `prev=` (a hash chain).
  `--bump` refuses an unknown kind, a value bump without an approval, a reason under 20 characters, and a
  mechanical bump of anything but the atlas or a schema-hash move (decision 14).
- `MANIFEST.json` freezes the contract inputs: the README rules and the model sources.
- A test checks that the ledger at the reviewed base (`dev`, or the last commit on `dev`) is a prefix of the
  current one.

### Verification after GATE-r1

- **`taskset -c 0-15 npm run ci`: green in 38.9 s warm** (72.8 s of steps). The first run after the generated
  Rust changed took 82.1 s, cold. The 38.9 s is up from 31.6 s: Vitest is 20.7 s, up from 13.1 s, because of the
  golden tests' replays.
- **The golden set:** version 3, 465 files, 6.1 MB.
  - It is reproduced byte for byte by `node test/golden/build/main.ts`.
  - The ledger is hash-chained: the version 3 line is `kind=value approval=pm/reviews/GATE-r1.md prev=74f1…`.
- **The golden tests (25):**
  - freezing: files, external atlas, contract inputs, ledger rules, reviewed-base prefix, schema hash;
  - byte-for-byte reproduction;
  - the closure log over 3,600 ticks;
  - r rolled independently from d_t and slice_t at every tick;
  - d_t's preimage parsed by hand against the saved state at five ticks;
  - shard 600 cross-checked between the slice and digest files;
  - lineage continuation from tick 300 to 3,600;
  - every packet, projection and query round-trip;
  - the negative index;
  - the stale module;
  - all 7 traces (350 calls) replayed with statuses, envelopes and state assertions;
  - the remap load equal to the start state;
  - every envelope decoding;
  - the atlas: coverage, tree species, `prototypesHash` equal to the golden build's.
- **The model's tests (12):**
  - the slice partition: every section rebuilt from its members, and one changed byte changes one shard;
  - the `all` series across a doubling, with exact totals;
  - the earlier rule tests.
- **The model guards itself:**
  - every refused action is checked to leave the saved state unchanged;
  - every refused trace call is checked to leave the state hash unchanged;
  - the negative cases are executed when the set is built: closures, logs and saves by the model; ABI inputs,
    including `init-stale-protos`, by a booted Module; `gen_*` by input checks. The stale module is instantiated by
    a test. That covers all 61 indexed cases.
- **Codec and generator:**
  - TS and Rust codec fixtures pass, including the new spec fixtures (`TickDigestHead`, `Body`, `Tail`,
    `RngWords`, `PlayerDigest`, `RemovedName`);
  - the composite `packet.bin` was rewritten for `PACKET_VERSION` 2;
  - the hash test was updated for it.
- **The data stage:** 2 new tests (the sound tables; an undeclared working sound refused).
- **The fake:** 22 tests (rules, protocol, references, earlier ones), and the @smoke e2e in Chrome and Firefox.
- **Factorio's behaviour:** tested by the research agent in Factorio 2.0.77, headless server and demo client.
  The probe mods and screenshots are in my scratchpad, uncommitted.

### Open issues after GATE-r1

1. **C6-r1 will regenerate the fixture atlas.** Whoever merges it must run `npm run data`, then
   `gamedev-python scripts/assets/fixture.py`, so the atlas names the golden prototypes (a test pins this). Then
   record `node test/golden/build/main.ts --write --bump mechanical "C6-r1 fixture atlas"`. Only the atlas hashes
   in `MANIFEST.json` change.
2. **Design text that Factorio contradicts** (design/round1/I-ui-controls.md, not mine to edit; from the 2.0.77
   tests):
   - §3.2: Q with a stack from a chest puts away what fits and says "Cannot put away …";
   - §3.7: mining is not refused up front; nothing is removed at completion and the cycle repeats; chest mining
     is partial;
   - §3.8: the limit bar stops bulk and fast transfers but not clicks, and player-to-chest transfers are silent;
   - §3.9: a craft request is clamped to what is affordable, not refused.
   The model follows Factorio in each case (rules 16, 19, 23, 25).
3. **§15.8's `sim_load` text should say that the remap tables carry the removed ids' names**
   (`RemapTable.removed`, abi_version 2). Without them the sim cannot name what the load report lists. §15.10's
   "3 × 3 chunks" should read 96 × 96 (rule 1).
4. **The UI's locale needs two vanilla strings** for the new flying texts: `flying-text.inventory-full` ("Cannot
   insert __1__. Inventory is full.") and `flying-text.cannot-put-away` ("Cannot put away the __1__. Player
   inventory is full.").
5. **M1: the spill.** Factorio drops what a cancelled craft's refund cannot fit on the ground. M0 refuses instead
   (rule 25). M1's golden set should pin the spill, with ground items.
6. **The audio package's `sounds.yaml`.** The data stage now reads it, so when it lands on `dev` the fake uses its
   ids and `test/fixtures/fake/sounds.yaml` can go.
7. **The query cost model is open.** The traces pin `sim_query_step` with 0 units and with all units (rule 44),
   so C2 may cost queries as it likes between those.

### Files changed for GATE-r1

- **Schema:**
  - `game/schema/abi.yaml`: `TickDigestHead`, `Body`, `Tail`; `RemovedName`; `abi_version` 2;
  - `game/schema/packet.yaml`: version 2;
  - `game/schema/types.yaml`: FlyingText 4–5;
  - `game/schema/projections.yaml`: CHARACTER has no sources;
  - `game/schema/compat.yaml`;
  - everything `npm run gen` regenerates (`src/shared/gen/`, `crates/schema/src/`, `crates/sim/src/gen/`, the
    codec fixtures);
  - `test/fixtures/codec/spec/abi.hex`, `test/fixtures/codec/golden/packet.bin`;
  - `scripts/schema-gen/hash.test.ts`.
- **Data stage:**
  - `scripts/data-stage/{index,overlay}.ts`, `scripts/data-stage/emit/{rows,protos-json}.ts` and
    `scripts/data-stage.ts` (`--engine-file`): the sound tables;
  - `scripts/data-stage/data-stage.test.ts`;
  - `data/engine/sets.yaml` (`tree-oak`);
  - `test/fixtures/fake/sounds.yaml` (new);
  - `test/fixtures/protos/m0.bin`.
- **Atlas:** `test/fixtures/sprites/manifest.json`, regenerated by C6's `fixture.py`. Only its `prototypesHash`
  changed.
- **Reference model:**
  - new: `model/{slices,module,remap}.ts`;
  - changed: `model/{rules,sim,projections,extract,protos}.ts` and `model/model.test.ts`.
- **Golden build:**
  - new: `build/{traces,trace-defs}.ts`;
  - changed: `build/{main,files,run,scenario,negatives,protos}.ts`, `golden.test.ts` and `README.md`;
  - `m0/**`, version 3.
- **The fake** (by my fork):
  - new: `src/simworker/fake/{inventory,rules,stats}.ts`, `test/fake/{rules,protocol,references}.test.ts`,
    `test/fake/references.ts`;
  - changed: `src/simworker/fake.ts`, `src/simworker/fake/{world,extract,protos}.ts`, `src/app/fake-mode.ts`,
    `scripts/fake-data-plugin.ts`, `test/fake/{harness,fake.test}.ts`, `e2e/fake.spec.ts`.
- **CLAUDE.md:** the golden workflow, the fake and the sound tables.

## Integration: sounds.yaml

C7 (audio v0, merge 257f698) added `game/data/engine/sounds.yaml`, which the data stage reads.
- **Data-stage tests** now expect the real table: `prototypes.json.sounds` equals the file's 15 names, sorted. The
  negative test writes a `sounds.yaml` whose working sound is undeclared into a scratch repository, and expects
  the diagnostic with its file and line. A new test shows that `--engine-file` is read only when
  `game/data/engine` lacks the file.
- **The golden set, version 4: a mechanical bump** (decision 14).
  - Only `protos/prototypes.json` changed: its `sounds` list.
  - `prototypes.bin` is byte-identical, because M0's entities (the chest and the character) have no working
    sound. So no state, digest, projection, query, packet or trace changed, and the atlas's `prototypesHash`
    still matches.
  - `main.ts` now allows a mechanical bump when only `protos/` changed.
  - The README's Freezing section (a contract input) still lists only the atlas and the schema hash as mechanical,
    and its audio paragraph still names the deleted fixture. Both edits wait for the next value bump.
- **The fake** builds with the real table. `test/fixtures/fake/sounds.yaml` and the `--engine-file` argument are
  gone. The ids are unchanged (belt-loop 1, keypunch-loop 10), because the fixture held the same names.
- `npm run ci`: green in 40.4 s.

## Design corrections (authorised by the coordinator)

This closes open issues 2 and 3 above.
- **design/round1/I-ui-controls.md** now follows Factorio 2.0.77, with the exact message texts and each change
  marked "(corrected 2026-10-20 from Factorio 2.0.77 tests, C1c)":
  - §3.2: Q when the stack does not fit, by where it came from, with "Cannot put away the Iron plate. Player
    inventory is full.";
  - §3.7: mining is not refused up front; at completion nothing is removed, the message is "Cannot insert Iron
    ore. Inventory is full.", and the cycle repeats; partial chest mining;
  - §3.8: partial transfers and their messages; what the limit bar stops and what bypasses it; partial fast
    transfers. One case is marked as inferred: the message when a Ctrl+click takes from a chest into a full
    inventory;
  - §3.9: a request is clamped to what is affordable, and only zero gives "Not enough ingredients."; a cancel is
    never refused and spills the rest; a paused craft shows its message.
- **design/spec/10-architecture.md §15.8:** the `sim_load` input now includes the removed ids' names
  (`RemapTable.removed`, abi_version 2), and the text says why.
- Checks: `r3_checks.py` 30 passed, 0 failed; `r3_xref.py` all placeholders resolve, 942 section references, 0
  dangling. `npm run ci` is green in 38.0 s.

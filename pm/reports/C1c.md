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

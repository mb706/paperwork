# C1a: M0 scaffold, toolchains, CI and the data stage
Status: done

## Summary

`game/` now holds the npm package and the Cargo workspace of 10 §2.2. From a clean clone, `npm ci` and `npm run ci` are green (33.3 s wall, after the review r1 fixes).

**Layout and toolchains**
- **npm package:** exact pins from §2.1, installed with `npm ci` from the committed lockfile. Apart from the deviations below, every package resolves to the same version as in `design/round2/A-stack-test/`'s lockfile.
- **Cargo workspace:** pinned to Rust 1.99.1 by `rust-toolchain.toml`, with `Cargo.lock` committed and `libm = "=0.2.16"`. It has one skeleton per crate (`schema`, `det`, `worldgen`, `sim`, `simabi`, `genabi`, `simtool`) and the four profiles of §2.3 (`release`, `wasmdev`, `dev`, `ntest`). The `simcheck` feature exists in every crate.
- **TypeScript configs:** one per layer (`shared`, `simworker`, `genworker`, `ioworker`, `assetworker`, `render`, `ui`, `audio`, `assets`, `app`, `scripts`), plus `test`. `tsc -b` checks them all.
- **Tooling:** Biome, Vitest (Node, without the Solid plugin) and Playwright (Chrome for Testing and Firefox 157, each project with its own dev server on port 5191).

**Build**
- **Dev:** `vite.config.ts` registers four plugins:
  - the schema generator in watch mode;
  - the data stage in watch mode; requests under `/data/` wait for it, failures show the error overlay, and success reloads the page;
  - the cargo plugin: `wasmdev` builds with `--features simcheck` at start and on changes, debounced and one at a time. It serves `/__wasm/{sim,gen}.wasm` behind `virtual:sim-wasm` and `virtual:gen-wasm`, reloads the page after each build, shows cargo's errors in the overlay, and completes `/data/build-manifest.json` with the modules' hashes;
  - the release plugin.
- **Release:** `npm run build` runs `scripts/wasm-release.sh` (cargo release, `wasm-opt -O3`, then the WebAssembly feature gate) and `vite build`. It writes `dist/data/build-manifest.json`, listing every served file with its SHA-256, and brotli (quality 11) and gzip (level 9) siblings of every text-like file. `npm run preview` serves the siblings by `Accept-Encoding` with §9.7's cache policy.
- **Placeholder page:** `index.html` has the title "Paperwork" and the tagline. `src/app/main.ts` compiles `sim.wasm` once on the main thread with `compileStreaming` and hands the `WebAssembly.Module` to a sim worker. The worker instantiates it (`src/simworker/scaffold.ts`) and reports the ABI version (B1 round 3, change 5).

**Checks**
- **`scripts/check-arch.ts`** (oxc-parser) enforces:
  - the layer import boundaries, including `src/assets/`, and the packages each layer may import;
  - the thread and memory rules: only `app/` creates workers, the main thread only compiles WebAssembly, and there is no SharedArrayBuffer or Atomics;
  - the determinism bans of §2.5 and §4.1;
  - the emitter-order rule;
  - the generated-file header hashes;
  - the crate graph (via `cargo metadata`) and `forbid(unsafe_code)`;
  - no I/O in `det`, `worldgen` or `sim`.
- **`clippy.toml`:** every ban of 10 §4.1 for both `f64` and `f32`, plus `libm::fma`/`fmaf`, HashMap and HashSet, the clock, `thread::spawn` and the print macros. Since review r1 it also bans the standard library's I/O, environment and process APIs on resolved paths. `scripts/check-clippy-bans.ts` runs clippy on a fixture crate (`test/clippy-bans/`, with grouped and renamed imports) and requires all 112 bans to fire.
- **`rustfmt.toml`.**

**Commands** (`package.json`): `dev`, `build`, `preview`, `data`, `gen`, `check`, `test`, `e2e`, `ci`, `check-arch` and `format`. `check`, `test` and `ci` run `scripts/ci.ts`, which runs the steps in parallel lanes and prints per-step timings:
- `ci` runs check and test, then the data stage, then two lanes in parallel: the e2e smoke in Chrome and Firefox; and the release path (the release WebAssembly with its gate, `vite build`, `scripts/check-release.ts`, and a smoke of the bundle served by `vite preview`).
- The release build is skipped when nothing it depends on changed since the last green run.
- No git hook is installed.

**The data stage** (`scripts/data-stage.ts`, `scripts/data-stage/`) is a pure function of its input files:
1. It parses every design kind with the YAML 1.1 schema, as PyYAML does, and validates each against strict zod schemas. Errors carry `file:line:col` and the data path.
2. It runs the engine-relevant reference checks of `validate_spec.py`, ported rule for rule.
3. It compiles every formula to §15.2's bytecode and checks it with the reference interpreter. Counts are checked up to the level caps; j, σ and c over 1,001-point grids.
4. It loads the engine overlay (`game/data/engine/`): `groups`, `defaults`, `mirrors`, `prototypes`, `sets`, `manifests` and `capabilities`.
5. It checks every milestone filter's closure (R17). The counts equal `manifests.py`'s, line for line. M1 is read from 09 §2.7, and its derived keys are checked.
6. It builds the M0 capability manifest's prototypes and checks that they close.
7. It assigns dense ids and emits `public/data/prototypes.bin`, `prototypes.json` and `build-manifest.json`, the committed `src/shared/gen/proto-ids.ts`, and the expression cross-check fixture `test/fixtures/expr/cases.txt`.

Options:
- `--check` writes nothing. It requires a second run, in another process under a Turkish locale and a +14:00 time zone, to give the same bytes (D14). It requires the committed outputs to be fresh, and emits m1–m5 in memory.
- `--manifest m1…m5 [--allow-incomplete]` builds a milestone filter into `.cache/data/<m>/`.

**Rust side.** The `det` crate has `powi`, `fmax`/`fmin`, the libm wrappers and `det::expr`, the bytecode interpreter. `crates/det/tests/expr_cross.rs` reproduces the TypeScript interpreter bit for bit on every data formula: 33 cases over 1,006,852 points, hashed with FNV-1a, flags included. It also reproduces the 20 hand-written edge cases. `Protos::load` is left to C1b, because §15.1 generates it.

## Decisions and deviations

### Pins and layout
1. **`@types/node` 24.19.1 added** (it is not in §2.1's table). The Node-side scripts and tests need it to type-check. It is the newest 24.x at least 14 days old (24.19.2 is 11 days old).
   - Transitive packages new to this set were resolved with `npm install --before=2026-10-06`.
   - `@playwright/test` 1.64.1 is §2.1's own exception to the 14-day rule.
2. **`@fontsource/titillium-web` removed** (B1 round 3, row 54).
3. **`tsc -b` uses `composite` + `emitDeclarationOnly` into `.cache/tsc/`, not `--noEmit`** (§2.3 says `tsc -b --noEmit`). Project references need the declaration outputs. A no-op run takes 0.2 s.
4. **`tsconfig.test.json` is an extra config** for `*.test.ts`, `test/`, `e2e/` and `bench/`, with Node types. The layer configs exclude test files.
5. **Worker entry points live in `src/app/workers/`**, so `check-arch` treats them as `app/`. They are type-checked by their worker's config (webworker lib); for example, `tsconfig.simworker.json` includes `src/app/workers/sim.ts`, so the DOM and webworker libs never mix (§2.2).
6. **`crates/schema/Cargo.toml` is hand-written.** The generated-only roots are `crates/schema/src/`, `crates/sim/src/gen/` and `src/shared/gen/`. The header contract is in `scripts/lib/generated.ts`:
   - line 1: `@generated by <script> from <source>. Do not edit: …`;
   - line 2: `[schema-hash: <hex>] content-hash: <sha256 of the rest>`;
   - TOML files use `#` instead of `//`.
7. **`scripts/schema-gen.ts` is a stub.** It writes the empty schema's outputs (`SCHEMA_HASH` all zeros, `PROTOCOL_VERSION` 0), keeps them fresh with `--check`, and fails if `schema/` holds YAML. `game/schema/README.md` marks the place for C1b.

### Checks
8. **Determinism bans: where they apply** (the brief said "shared and worker code"; §2.5 names the data stage, the schema generator and `src/shared/gen/`):
   - the full §2.5 list applies to `scripts/data-stage*`, `scripts/schema-gen*`, `scripts/lib/` and all of `src/shared/`;
   - the same list without the clock applies to the three worker shells, because pacing needs `performance.now()` (§3.3);
   - in emitters (`scripts/data-stage/emit/`, schema-gen), `Object.keys`/`values`/`entries`, `for…in` and `JSON.stringify` are banned; emitters use `sortedEntries` and `canonicalJson`;
   - one line may opt out with `// check-arch-ignore <rule>: <reason>` on the line before. It is used twice, for log timings.
9. **The WebAssembly rule** (from B1 round 3):
   - `app/` and `dev/` may compile (`compileStreaming`, `Module`) but not instantiate;
   - instantiating and memory access are allowed only in `simworker/`, `genworker/` and the asset worker (`src/assets/worker*`, for the KTX2 transcoder).
10. **Additions beyond §2.2's text:**
    - the crate-graph allow-list: simabi → sim, schema, det; genabi → worldgen, schema, det; simtool → sim, schema, det, worldgen; `proptest` as a dev-dependency;
    - a text scan for `std::fs`, `std::net`, `std::env`, `std::process` and the standard streams in the `src/` of `det`, `worldgen` and `sim` (10 §2.5: "no I/O").
11. **Clippy:**
    - runs twice, without features (as §2.3 says) and with `simcheck`, so code behind either cfg is linted;
    - `simtool` allows the banned macros and methods at its crate root, because it is the host;
    - `std::thread::spawn` and the print macros are banned too (D19, §2.5).

### Data stage
12. **YAML 1.1** (the `yaml` package's `yaml-1.1` schema), so values match PyYAML's: all ten files parse to identical values (tested). Duplicate keys are errors, where PyYAML silently keeps the last.
13. **Strict schemas at every level.** The documentation keys `rule`, `formula`, `formula_ref`, `note` and `notes` are accepted in any block. An unknown field is an error with its file and line. Fields that are prose today but that the engine will read are typed `doc` for now (open issue 4).
14. **The design schema covers all of the data; the engine checks cover the build.** The engine-specific checks (overlay completeness, closure, registries) run on the capability build. A `new`-mirroring entity without an overlay entry is an error in the M0 build, and a warning with `--allow-incomplete`.
15. **`manifests.yaml` must equal the YAML block in 10 §12.** `manifests.py` reads that block, so a difference is an error. M1 is read from 09 §2.7's block, as `manifests.py` and `render_slice.py` read it.
16. **Pseudo recipes** are left out of the build's tables (§2.4 "validator-only"), but the filter counts include them, because `manifests.py` counts them.
17. **The M0 capability manifest** (`game/data/engine/capabilities.yaml`):
    - **prototypes:** chest and recipe `iron-chest` (8 iron plates make 1 chest; the plates come from `meta.start.inventory`, filtered to the build's items); resource `iron-ore-patch`; tiles `grass`, `dirt`, `sand`, `water`, `deep-water` and `out-of-map`. Items are derived: iron-chest, iron-ore, iron-plate. `character: true` stands for the engine's character, which has no data prototype;
    - **actions:** I §8.2's names for walking, hand mining, building, the transfers and hand crafting, plus `set_player_setting` and `set_game_setting` (Appendix B), and the five system actions;
    - **projections:** §15.5's M0 kinds;
    - **queries:** `inspect`, `hash`, `digest`;
    - **packet sections:** the chunk sections, `DYN`, `MOVERS`, `EVENTS`, `UI` and `AUDIO_WORKING` (B1 round 3, change 10);
    - **rule scenarios:** R23–R29;
    - **benchmarks:** the four M0 benchmarks;
    - **registries:** none, since M0's prototypes use none.

    The names stay provisional until C1b's schema defines them. Once it exists, the data stage can check them.
18. **The engine overlay:**
    - `groups.yaml`: Factorio 2.0's base groups and subgroups, hand-typed;
    - `defaults.yaml`:
      - per entity type, boxes from the footprint (selection = footprint; collision = footprint minus a per-type inset: 0.15 chests, 0.1 belts, 0.35 inserters and small poles, 0.3 otherwise), mining time and flags;
      - the default item subgroup: by placed entity type, then tile, then tag, then `intermediate-product`;
      - the default item order: the item's position in `items.yaml`;
    - `mirrors.yaml`: Factorio numbers for the three chests;
    - `prototypes.yaml`: per-id entries, empty for now;
    - `sets.yaml`: §15.7's set-name tables, empty for now.
19. **Dense ids** (§2.4 step 5):
    - items and fluids sort by (group order, subgroup order, item order, id);
    - recipes take their main product's ordering, which the overlay may override;
    - entities take their item's ordering;
    - the other kinds sort by id.

    The M1 build's crafting grid comes out like Factorio's: storage, belts, inserters, poles and pipes, terrain, energy, extraction, smelting, production, raw, intermediates, science packs, defence.
20. **Units.** Values are converted to the engine's units in the tables (10 §4.2): kW → W, MJ → J, kJ/K → J/K.
    - Fluids without a temperature default to 15 °C (Factorio's default).
    - Fluids without a heat capacity default to 1 kJ/K (an assumption).
21. **Derived columns** (§2.4 step 3):
    - belt speed in positions per tick = `items_per_s × 8 / 15` (15 → 8, 30 → 16, 45 → 24), refused if not a whole number;
    - `computing` and T\* from `heat.class`;
    - placement: `must_be_on` resource, `must_touch` tile list.

    Underground belts and splitters carry no throughput in the data (open issue 4). Recycling recipes (M3) are not derived yet.

### Binary and JSON layouts §15.2 leaves open (for C1b to move into `schema/protos.yaml`)
22. **The `prototypes.bin` header** is 56 bytes:
    - after `sectionCount` comes a `u32 reserved` = 0, so the first section starts on a multiple of 8 (§8.1's alignment rule);
    - `formatVersion` 1;
    - `dataVersion` 2 (SCHEMA.md "v2");
    - `schemaHash` all zeros until C1b;
    - every section has version 1 and flags 0 (not `HASHED`).
23. **Section ids:** `PROTO_ITEM` 1, `PROTO_FLUID` 2, `PROTO_RECIPE` 3, `PROTO_ENTITY` 4, `PROTO_TECH` 5, `PROTO_RESOURCE` 6, `PROTO_TILE` 7, `PROTO_WORLD` 8, `PROTO_SIGNAL` 9, `LISTS` 16, `META` 17, `EXPR` 18, `NAMES` 19, in ascending order. All nine kind sections are always present, with zero rows when the build has none of that kind.
24. **The columns per kind**, each with its source, are in `scripts/data-stage/emit/tables.ts`. Enums are written as indexes into the data's lists (`meta.tiers`, `meta.fuel_categories`, `meta.crafting_categories`, `ENTITY_TYPES`, `TRIGGER_TYPES`, `REGIMES`, `RESOURCE_KINDS`, `WORLD_KINDS`, `ENERGY_SOURCES`). C1b should give each an explicit-valued enum in `types.yaml`. "None" is `0xFFFF` in u16 id columns and `0xFF` in u8 ones. Item tags are a u16 bitset.
25. **`LISTS`:** every list starts on a multiple of 8, and an empty list is (0, 0). Entry layouts:
    - IngredientEntry, 16 bytes: `u8 kind (0 item, 1 fluid), u8 0, u16 id, u32 0, f64 amount`;
    - ProductEntry, 32 bytes: `u8 kind, u8 flags (bit 0: affected_by_quality false), u16 id, u32 amount_expr (ExprRef), f64 amount, f64 probability, f64 catalyst`;
    - PackEntry, 16 bytes: `u16 item, u16 0, u32 0, f64 per unit`, in tier order;
    - YieldEntry, 12 bytes: `u16 item, u16 0, u32 min, u32 max`, by item id;
    - prerequisite and unlock lists: one `u16` id each; placement tiles: one `u8` each.
26. **`META`:** `u32 count`, then per record `u16 recordType, u32 length` and its field triples (COLD's framing without the serial), sorted by type. Record type 1, `start`, has field 1, the start inventory: a list of records {1: u16 item, 2: u32 count}, by item id. Record type 2, `contents` (review r1, finding 5), has field 1, the META blocks the file carries, and field 2, the design data it omits; both are lists of strings (`u32` count, then `u16` length and UTF-8 each).
27. **`EXPR`:** expressions are packed with no padding, and `byteCount` includes END. Identical programs are stored once and share one `ExprRef`.
28. **`NAMES`:** nine tables in ProtoKind order (item, fluid, recipe, entity, technology, resource, tile, world, signal), with no leading count.
29. **The expression's runtime rules where §15.2 is silent:**
    - a non-integer exponent is truncated toward zero (NaN → 0) before the ±1,024 clamp;
    - the interpreter returns flags (nan, clamped, exponent) so the caller can log its warning;
    - malformed bytecode is an error. `Protos::load` should refuse such a file with `ERR_PROTOS`.
30. **Formula ranges** (`FIELDS` in `expr.ts`, to move to `protos.yaml`): `count_formula` [1, 2^53], `field_year` [0, 9999], `amounts_by_j` [0, 65535] (a u16 product amount), `speed_factor` [0, 1].
31. **Level caps.**
    - The search for an infinite technology's cap stops at level 65,535; `max_level` is stored as u32.
    - On today's data the caps are 28–78. For example, Artillery reload (a 3^L cost) stops at 28, mining productivity at 75, Algorithmic progress at 71 and Thermal management at 73.
    - A cost below 1, or a non-integer exponent at any level, is an error.
32. **`prototypes.json`:**
    - the header;
    - per-kind arrays carrying `icon` or `sprite` set names (defaults `item/`, `fluid/`, `entity/`, `resource/`, `object/`, with overlay overrides);
    - `groups` and `subgroups`;
    - the namespace tables of §15.7 (B1 round 3, changes 9 and 11):
      - `icons`: every item's icon, then every fluid's, then any recipe icon not already listed; `EntityView.alt_icon` indexes it;
      - `localeKeys`: empty until C1b's registries define FailReason and FlyingText;
      - `treeSpecies`, `decoratives`, `cliffs`, `townBuildings`, from `sets.yaml`;
    - `strings`: the data's English names and descriptions, under Factorio-style keys such as `item-name.iron-plate`.

    The file is canonical JSON: keys sorted, indented.
33. **`build-manifest.json`:**
    - **Dev:** the data stage writes it with `modules: {}`, so its output depends only on data. The dev server adds the module hashes when it serves the file. The dev `buildHash` is the SHA-256 of the raw hashes of sim.wasm, gen.wasm, `prototypes.bin` and the schema, concatenated, with zeros for a module not yet built.
    - **Release:** `assets` is a list of `{path, sha256}`. The `.br` and `.gz` siblings are left out of the list and of `buildHash`, because they are encodings of the same files and depend on the compressor's version.
34. **The WebAssembly feature gate** makes two checks:
    - `--print-features` must equal the allowed set;
    - the module must validate with only the allowed features enabled.

    A SIMD build fails either way (tested).

## Verification

**Clean clone** (`git clone`, `npm ci`, `npm run ci`, `taskset -c 0-15`):
- at ab86234: `npm ci` took 3.8 s. `npm run ci` was green in 30.5 s wall, with 64 s of step time.
- at 49d10cb (review r1 fixes, release path added): `npm ci` 3.8 s; `npm run ci` green in 33.3 s wall, 78 s of step time.
- The slowest steps: `cargo test (ntest)` 12.3 s (a first build with release LTO), Vitest 10.4 s, e2e 9.8 s, render_spec 7.9 s.
- A warm `npm run ci` in the main tree takes 23–25 s at ab86234 and 27.6 s at 49d10cb; `npm run check` alone takes 12 s.

**Incremental times** (the skeletons are tiny, so these are floors; A1 measured about 3 s for a 50k-line crate):

| Step | Time |
|---|---|
| wasmdev rebuild after touching `sim` or `det` | 0.23 s |
| `cargo test` incremental | 0.5 s |
| `tsc -b` after an edit / no-op | 0.4 s / 0.2 s |
| data stage | 2.2–2.7 s (about 0.7 s of it is YAML parsing) |
| data stage `--check` | 2.7 s |
| check-arch | 0.5 s |
| Vitest | 10 s |
| `npm run build` | 4.6 s |
| e2e smoke, including the dev server's start, data stage and wasm build | 4 s (Chrome) |

**Tests:** 96 Vitest tests and 8 cargo tests. The cargo cross-check covers 1.0M points.
- **Agreement with the Python tools:**
  - YAML: all ten files parse identically to PyYAML.
  - Expressions:
    - bit-identical with `validate_spec.eval_expr` where no power has a fractional base, and within 1e-12 elsewhere;
    - unit counts identical wherever the Python tools compute them: every level of a finite technology, the first 21 of an infinite one;
    - finding: above that, at L ≥ 66 (costs ≥ 7×10¹⁴ units), `det::powi` and Python's libm `pow` differ by one ULP and the count by 1–2 units (open issue 6).
  - `manifests.py`'s output equals ours line for line for m1–m5. The m1 build matches 09: 55 items, 2 fluids, 48 recipes, 32 entities, 23 technologies plus prior-art, 7 resources, 18 tiles.
- **Error cases** (each points at the file, line and data path): a wrongly typed field, a misspelt field, an unknown reference, a bad expression, an overlay that sets a design field, a capability manifest that does not close, `manifests.yaml` drifting from 10 §12, and 09's derived keys disagreeing with the data.
- **The checks themselves:**
  - check-arch: 15 rule tests;
  - the clippy bans: 70 of 70 fire (112 of 112 since review r1), and a misspelt ban is caught;
  - the feature gate: a SIMD module fails, whether its target-features section declares SIMD or not;
  - the release manifest and the compressed siblings decompress correctly.
- **Release build in the browser:** the build loaded in Chrome from `npm run preview` with every resource served brotli-compressed and no console messages.
- **Screenshot:** the placeholder page was reviewed (Chrome, 1280×720): `/tmp/claude-1002/-home-mewse-browsergame/4a895603-76fb-4a4e-acd7-0c868dedb7d0/scratchpad/c1a/smoke-chrome.png`. It shows buff paper, ink, the title, the tagline, and the status lines for sim.wasm (ABI 0, instantiated in the sim worker), the prototypes and the dev build hash.
- **`tools/check-toolchain.sh`:** all checks pass in 18 s, including the new ones (wasm-as, clippy, rustfmt, pyyaml).

## Open issues and follow-ups

1. **For C1b, the schema:**
   - move `emit/tables.ts` (columns, entry layouts, section ids, META record types), the enums of decision 24 and `FIELDS`' ranges into `schema/protos.yaml`;
   - generate the writer and `Protos::load`, which must refuse malformed `EXPR` programs;
   - set the real `SCHEMA_HASH` and `PROTOCOL_VERSION`;
   - keep the header format of `scripts/lib/generated.ts`, which check-arch reads;
   - replace the body of `generate()` in `scripts/schema-gen.ts`.
2. **For C1b, the registries:** `schema/registries.yaml` (effects, triggers, achievement conditions, formula references, `well_known`) and the data-stage checks against it. Today the capability manifest's own `registries` lists serve; the `formula_ref` tag check (`// @formula NN §X.Y` under `crates/`) already runs. Also:
   - check the capability manifest's action, projection, query and section names against the schema;
   - fill `prototypes.json`'s `localeKeys`.
3. **For C1b or the Sim package, the character:** it has no data prototype. Its numbers need a home (0.15 tiles per tick, reach 10, build 10, resource reach 2.7, an 80-slot inventory), and so does the record that `MOVERS`' `proto` names for it.
4. **Design data, J1** (for the manager to route). Several values the engine will read are prose today; the strict schema types them as `doc` for now:
   - `electric-pole.extra.supply` ("5x5"), `beacon.extra.supply_area` ("9x9") and `beacon.extra.profile` ("1/sqrt(n)");
   - `rocket-silo.extra.payload` and `returns`;
   - `combinator.extra.reads`, `signals` and `rescan`;
   - `other.extra.fluid_box` and `circuit`;
   - `turret.extra.auto_targets` and `heat.into`.

   Underground belts and splitters carry no throughput. Each should become a number or an id before the system that reads it (poles are M1).
5. **Engine overlay content for later milestones:**
   - nine entities mirror `new` and need entries in `prototypes.yaml`: terminal, endpoint, interceptor-bay, cooling-tower, dry-cooler, water-exchanger, research-hall, deployer, area-scanner;
   - fluid boxes do not exist yet, so "fluid boxes match recipe fluids" cannot run;
   - still to supply: inserter vectors, drill areas, belt lane geometry, map colours, the quality stat table, terrain materials, the event-to-sound map, Factorio numbers beyond the three chests, and subgroup refinements (Factorio puts plates in `raw-material`).
6. **The expression finding** (decision 31; Verification). For four infinite technologies at L ≥ 66, `det::powi` and Python's `pow` give unit counts that differ by 1–2. Those levels are unreachable, and the engine's numbers are deterministic everywhere. If the design team wants exact agreement at every level, `tools/validate_spec.py` could adopt repeated multiplication.
7. **Not in `ci` yet**, because each needs code that does not exist: the cross-engine smoke trace, `bench --quick`, `test:slow`, `bench`, `assets`, the font-coverage check (needs the asset build's subsets) and the recycling-recipe derivation (M3).
8. **Content-addressed data files** (§9.7). Release builds copy `public/data/` under fixed names. Hashing those names, and `sw.js`, belong to the loading and shell packages.
9. **The `ntest` profile inherits release's fat LTO.** Its build will grow with the sim (A1: about 38 s for a release build). If that slows the loop, consider thin LTO for `ntest`; that is a spec decision.
10. **`prototypes.json` is indented,** which keeps diffs readable (M5: 484 kB raw). Brotli removes most of the difference. Make it compact if that ever matters.

## Files

**Commits on `dev`:** 3ebd435 (scaffold, CI, checks, data stage), 19bd7ab (schema-gen watch mode), ab86234 (D14 across processes, the Rust I/O rule, docs), and the commit that adds this report.

**Created:** `game/` (about 9.9k lines without the lockfiles and generated files):

| Area | Files |
|---|---|
| Package and workspace | `package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, `clippy.toml`, `rustfmt.toml`, `.gitignore` |
| Configs | `biome.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `tsconfig.json` and 13 `tsconfig.*.json`, `index.html` |
| Crates | `crates/{schema,det,worldgen,sim,simabi,genabi,simtool}/`; `det/src/expr.rs`, `det/tests/expr_cross.rs` |
| TypeScript | `src/app/{main.ts, virtual-wasm.d.ts, workers/sim.ts}`, `src/simworker/scaffold.ts`, `src/shared/gen/{schema.ts, proto-ids.ts}` (generated) |
| Scripts | `scripts/data-stage.ts` and `scripts/data-stage/` (schema/, emit/, expr, formulas, refs, overlay, manifests, capabilities, model, formula-refs, sources, diagnostics), `scripts/{check-arch, check-clippy-bans, ci, schema-gen, cargo-plugin, data-stage-plugin, watch-run-plugin, release-plugin, build-manifest, wasm-feature-gate}.ts`, `scripts/wasm-release.sh`, `scripts/lib/{bytes,canonical,generated,hash}.ts`, with their `*.test.ts` |
| Engine overlay | `data/engine/{manifests,capabilities,groups,defaults,mirrors,prototypes,sets}.yaml` |
| Tests and fixtures | `schema/README.md`; `test/clippy-bans/`; `test/fixtures/expr/{edge-cases.yaml, cases.txt}`; `test/helpers/`; `e2e/{smoke.spec.ts, console.ts}` |

**Changed:**
- `CLAUDE.md`: a new "The code" section, and the pinned-set line now points at `game/package-lock.json`. B2's uncommitted toolchain lines are left unstaged and untouched.
- `tools/check-toolchain.sh`: four new checks.

## Review response (codex C1a-r1)

Fixes are in commit 49d10cb. Each finding has a regression test that fails on the code before the fix. The data-stage tests use a scratch copy of the data, so the real files are never edited.

**1. Unit conversion can emit infinity — Fixed.**
- `writePrototypesBin` checks every value against its column type at the writer: floats must be finite (NaN and infinities are refused), and integers must fit their width.
- Every column names the YAML field it comes from, so a bad value becomes a diagnostic at `file:line:col` and that field.
- An emitter's exception becomes a diagnostic for its prototype, and `prototypes.json` failures become diagnostics too.
- Tests (`data-stage-review.test.ts`): `heat_capacity_kj_per_k: 1.0e+308` on water reports "Infinity is not a finite number", and `stack: 5000000000` reports "does not fit a u32".

**2. A missing research count becomes zero-cost research — Fixed.**
- A paid technology needs exactly one of `cost.count` and `count_formula`; a `count_formula` without a cost is refused too (`refs.ts`).
- Test: removing `cost.count` from *Electric mining drill* is an error at its `cost`.

**3. The capability closure overstates what is obtainable — Fixed.**
- `playthrough.ts` ports `validate_spec.py`'s `producible`, `recipe_craftable`, `trigger_ok` and `playthrough`, rule for rule, restricted to the build's prototypes:
  - a resource yields only if it is solid (mined by hand) or an included, placeable extractor can take it, with its required fluid;
  - a recipe counts only once it is enabled: a start recipe, or unlocked by a technology the build researches;
  - a technology must be researchable inside the build, and its trigger target must be in the build.
- Tests: adding `water` without an offshore pump fails ("cannot be extracted", "not obtainable"); adding the `pipe` recipe and entity fails ("never enabled"); adding *Steam power* without its unlocks fails, and so does a trigger target outside the build.

**4. Entity triggers can resolve to item ids — Fixed.**
- `triggers.ts` resolves a target in the namespace its type names:
  - `craft-item` and `launch`: `item`;
  - `craft-recipe`: `recipe`;
  - `build-entity`: `entity`;
  - `mine-entity`: a resource or an entity; a name that is both is ambiguous.
- A missing, misplaced, outside or ambiguous target is an error. The check runs early, over the whole data, in `refs.ts`; at the writer, an unresolved target is a diagnostic, never "none".
- Tests:
  - a `build-entity iron-chest` trigger emits target kind entity (3) and the entity's id;
  - `{type: build-entity, item: iron-chest}` is an error at `trigger`;
  - unit tests cover every case in `triggers.test.ts`.

**5. Milestone binaries silently discard gameplay data — Deferred to C1b (gate item 1). The outputs now say exactly what they carry and omit.**

What changed now:
- `emit/contents.ts` classifies every field of every design kind as one of: binary, JSON, both, documentation, partial (with the omitted subfields listed) or omitted. `contents.test.ts` fails if any schema field is unclassified, so the list cannot go stale.
- Every output declares its contents:
  - `prototypes.bin`: META record 2, `contents`, holds field 1, the META blocks the file carries (`start.inventory`), and field 2, the omitted parts;
  - `prototypes.json` and `build-manifest.json`: `contents: {meta, omitted}`.
- `capabilities.yaml` gains `data`: the META blocks a milestone's engine reads (M0: `start.inventory`). The data stage refuses a manifest that reads a block the binary does not carry.
- `--manifest` builds print how many parts their binary omits.
- The M0 build carries everything M0 reads.

Deferred to C1b: emit the omitted parts, and make the consumers refuse what is absent. `Protos::load` and the shell must check the contents record against the milestone's `data` and fail with `ERR_PROTOS`. The omitted parts are exactly these 50:
- `enemies`, `text` (whole files);
- entities:
  - `allowed_effects`, `categories`, `consumes`, `produces`, `deploys`, `effect_receiver`, `staff_slots`, `staff_demand`;
  - `energy.fuel_categories`, `energy.per_movement_kj`, `energy.per_rotation_kj`, `energy.priority`;
  - `extra`: every type-specific field except chests' and wagons' slots and belts' `items_per_s`;
  - `heat`: `coolant_in_min_c`, `coolant_out_c`, `emission`, `full_rate_dt_k`, `liquid_cooling`, `removes_kw`, `waste_heat`, `water_per_mj`, `while`;
- items: `ammo`, `armor`, `equipment`, `module`, `spoil`, `staff`;
- meta: `damage_categories`, `effects`, `endgame`, `heat` (every block except `classes`, which is carried as each entity's `t_star`), `hollow_work`, `quality`, `runaways`, `staffing`, `start.guarantees`, `start.salvage`, `town_classes`, `world` (including `model_collapse.speed_factor`, which is compiled and checked but not emitted), `world_settings`;
- recipes: `victory`;
- technologies: `branch`, `citation`, `unlocks.effects` (needs the registries);
- tiles: `biome`, `placed_on`;
- world objects: `gui`.

Tests:
- the binary's contents record decodes to `start.inventory` and to an omitted list containing `meta.world`, `technologies.unlocks.effects` and `enemies`, identical in the JSON and the manifest;
- `data: [start.inventory, world]` is refused;
- the classification is checked complete.

**6. An empty level range bypasses validation and the cross-check — Fixed.**
- `first_level` and `max_level` above 65,535 are errors, and an empty checked range is an internal error.
- The fixture writer refuses a case with no points, and the Rust cross-check asserts that every case has points.
- Test: `first_level: 65536` with `1/(L-65536)` is an error at `first_level`.

**7. Half-up rounding changes integral costs — Fixed.**
- `unitCount` rounds from the fractional part (`v - floor(v)` is exact for every finite double); `det::unit_count` is its Rust twin.
- Both are pinned by hand-written goldens in `test/fixtures/expr/unit-counts.txt`: 0.49999999999999994, 2^52 − 0.5, 2^52, 2^52 + 1, 2^52 + 3, 2^53 − 1, 2^53 and 2^53 + 2, among others (`expr.test.ts`; `crates/det/tests/unit_counts.rs`).
- The cross-check fixture now carries a hash of every count formula's unit counts, which the Rust test reproduces.
- The Python tools still use `floor(v + 0.5)`. That differs only at 2^52 and above, beyond the levels they evaluate. The agreement test is unchanged and passes.

**8. The determinism bans have syntax bypasses — Fixed.** `check-arch/ts-rules.ts`, in the deterministic modules:
- **Aliases and keys:**
  - globals resolve through `globalThis`, `self`, `window` and `global`, with static keys (string literals and constant templates);
  - Math may be used only as `Math.<allowed function>`; a computed key, destructuring, aliasing or passing Math as a value is refused;
  - a value use of the global object is refused, and so is a computed key on it;
  - `crypto` randomness is refused in every form; `crypto.subtle` stays allowed.
- **Imports:**
  - a computed key on an imported namespace is refused;
  - `import()`, `require`, `createRequire`, `eval` and `Function` are refused;
  - a randomness name imported or re-exported (even renamed) is refused, and so is `export *` of a package;
  - a deterministic module may import only deterministic modules (type-only imports excepted) and the reviewed packages `yaml` and `zod`. `scripts/build-manifest.ts` joined the deterministic set for that reason.

Tests: 27 negative fixtures, one per form the review named plus their siblings, and positive fixtures for what the code really uses. Splitting check-arch into `scripts/check-arch/{ts-rules,rust-rules,generated,crates}.ts` kept each part small.

**9. Dynamic imports bypass layer boundaries — Fixed.**
- Constant template literals count as static specifiers.
- Computed specifiers in `import()`, `require()`, `import.meta.glob` and `new Worker(...)` are refused (rule `dynamic-import`). An exception needs a justified `check-arch-ignore`.
- Tests: ``import(`../render/a.ts`)`` from `ui/` is a layer violation; `import(p)`, an interpolated template, `require(p)`, `new Worker(url)` and a glob across layers are refused.

**10. The Rust I/O guard misses grouped imports — Fixed, in two layers.**
- **Clippy:** `clippy.toml` bans the resolved APIs, so every import spelling fires:
  - methods: `std::fs` (18), `std::env` (12), `std::process` `exit`/`abort`/`id`, and the standard streams;
  - types: `File`, `OpenOptions`, `TcpStream`, `TcpListener`, `UdpSocket`, `Command`.

  The fixture crate exercises them through grouped, nested and renamed imports, and all 112 bans fire. `simtool` and fixture-reading test files allow them.
- **check-arch:**
  - `rust-rules.ts` strips comments and strings, then parses `use` trees (groups, nesting, renames, globs);
  - it flags `std::fs`, `std::net`, `std::env`, `std::process` and the standard streams, globs and aliases of `std`, `extern crate std as …`, absolute paths, and `io::stderr()` after `use std::io`.
- Tests: ten negative cases and one with comments, strings and harmless paths.

**11. Generated-file hashes do not establish ownership — Fixed.**
- `check-arch/generated.ts` checks the generated directories against the generators' inventory: `schema-gen`'s outputs (now importable) and the data stage's `proto-ids.ts`.
- Every file there must be in the inventory, and its header must name the expected generator and source. A schema-gen file must also carry the current schema hash, and its content hash must match.
- Extra files and missing outputs are errors.
- Tests: an extra file with a valid data-stage header and hash; the wrong generator; a stale schema hash; a missing output.

**12. Release builds omit `gen.wasm` — Fixed.**
- The cargo plugin emits both release modules at `buildStart`, whether or not code imports them. The release plugin fails a build whose manifest lacks either.
- CI now builds the bundle and runs `scripts/check-release.ts` on it. The checker requires:
  - both modules and the contents;
  - every served file listed with its SHA-256;
  - a build hash that recomputes;
  - `.br` and `.gz` siblings for every text-like file and for no other, each decompressing to the original.
- CI then runs `e2e/release.spec.ts` against `vite preview` (Chrome): both modules are in the manifest, the page and the data come brotli-encoded, and there are no console messages.
- Tests: `release.test.ts` (a bundle without `gen.wasm`, a tampered file, a missing sibling) and the release smoke.

**13. The release cache can skip an invalid artifact set — Fixed.**
- The key (`scripts/ci-release-cache.ts`) covers:
  - crates, schema, the Cargo files, the toolchain pin, and the release and gate scripts;
  - `.cargo/config.toml` and `$CARGO_HOME/config.toml`;
  - the cargo and rustc environment variables (`RUSTFLAGS`, `CARGO_ENCODED_RUSTFLAGS`, `CARGO_BUILD_*`, `CARGO_PROFILE_*`, `CARGO_TARGET_*`, `RUSTC*`, `RUSTUP_TOOLCHAIN`);
  - `rustc -vV` and `wasm-opt --version`.
- A skip needs both outputs present, with the hashes the last green run recorded. The feature gate runs on every invocation.
- Tests (`ci-release-cache.test.ts`): a missing or changed output forces a rebuild, and the key changes with `RUSTFLAGS`, a profile variable, the optimizer version, `.cargo/config.toml` and a source edit.

**14. Watch inputs exclude compiler and schema dependencies — Fixed.**
- The data stage watches its own code: `scripts/data-stage*`, `scripts/lib`, `scripts/build-manifest.ts`, and the schema identity `src/shared/gen/schema.ts`.
- It re-runs after `schema-gen` succeeds.
- All generators share a registry (`scripts/dev-generators.ts`). Scheduled and running builds count as busy, and held requests (`/data/`, `/__wasm/`, the dev manifest) wait until none is left.
- Tests (`dev-generators.test.ts`): a follower runs after its leader and requests wait for it; the watched list includes the implementation.

**15. Failed rebuilds keep serving earlier results — Fixed.**
- A failed run's error persists until a run succeeds. Meanwhile:
  - held requests get a 503 with the error: `/data/*` while `schema-gen` or the data stage has failed; `/__wasm/*` and the dev manifest while any generator has;
  - every new WebSocket connection gets the error overlay.
- The cargo plugin's build command is injectable, for tests.
- Test: a failing generator makes `/data/…` answer 503 with its message and sends a new connection the overlay; after a successful run, requests pass and connections get nothing.

**New in this round:**
- **Files:** `scripts/data-stage/{playthrough,triggers,outputs,emit/contents}.ts`; `scripts/check-arch/{common,ts-rules,rust-rules,generated,crates}.ts`; `scripts/{dev-generators,ci-release-cache,check-release}.ts`; `playwright.release.config.ts`; `e2e/release.spec.ts`; `test/fixtures/expr/unit-counts.txt`; `crates/det/tests/unit_counts.rs`; `test/helpers/data-stage.ts`; the tests above.
- **Behaviour:** the dev smoke now waits for the first builds (about 4 s instead of 1 s).
- **Size:** Vitest now has 12 files and 186 tests (it had 7 and 96).
- **Time:** CI is about 5 s longer, for the release path.

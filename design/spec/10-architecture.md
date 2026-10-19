# 10 — Engine architecture and implementation plan

*Round 2, agent R2-A; revised in round 4 by R4-arch. Binding inputs: `design/DECISIONS.md` (round 4: §21–§38); round-1 docs B (laws), D (economy), E (tech tree), F (pressure, Variant A), G (endgame), I (UI and controls), plus A (mods), C (spacetime) and H (tone) where they touch the engine. Companion specs: 00–09 and `spec/data/*.yaml`. The round-4 worklist was `design/round3/R3-implementability.md` (B1–B4, L1–L6, J1–J24, U1–U64, P1–P31 and its §9 architecture gaps), `R3-balance.md`, `R3-fun.md`, `R3-coherence-tone.md` and `R3-accuracy.md`.*

**Scope.** This document decides **how** the game is built. The other specs decide **what** it contains. Where a number belongs to the design (a recipe, a T\*, the formula for T(W)), this document names the engine module that consumes it and leaves the value to the spec that owns it (Appendix B).

**Engine rules.** Where the design leaves an engine-relevant case open (an edge, a tie, an order, a state), this document states the exact rule, and the owning chapter is asked to carry the same sentence. The rules added in round 4 are tagged with the critique's number (e.g. *L3*, *U16*) so that they can be traced; most have a rule scenario in §10.8, and the rest are covered by the tests of the module that implements them (the doubling-time readout U24 by UI-G8, the run report's measurements by its golden accumulators, M4). Round 5's (R5-apply, DECISIONS §40) are tagged with R5-gate's decision number (*D9*, *D12f*), with scenarios R18–R20.

**Evidence.** Measured on this host on 2026-10-19:
- The toolchain in §2.1 installs and runs here (glibc 2.31, no AVX2).
- WebGL2 benchmarks in headless Chrome 156 on SwiftShader.
- Simulation-loop microbenchmarks in Node 24.

The numbers are in Appendix A. They drive three decisions: expanded-quad sprite batching (§6.3), on-demand rendering in tests (§10.5) and the host-to-laptop calibration factor (§11).

---

## 0. Decisions at a glance

| # | Area | Decision | Main reason | Rejected |
|---|---|---|---|---|
| 1 | Language | **TypeScript** for the simulation, UI, renderer and tools. **Python** only for asset pipelines and the design validator | One language for the sim, UI and tests. V8 runs typed-array loops at 5–15 ns per entity here | A Rust/WASM sim now. The struct-of-arrays layout keeps a per-system port open if benchmarks ever demand it |
| 2 | Build | **Vite 8.3.2** (Rolldown) for bundling and the dev server. **TypeScript 7.0.2** (native `tsc`) for type-checking only | Verified here; fast | webpack; esbuild alone |
| 3 | Tests | **Vitest 5.0.3** (unit, scenario and property tests, the last with **fast-check 4.10.2**). **@playwright/test 1.64.1** with Chrome for Testing 156 (E2E and screenshots). A custom benchmark runner | Same runtime (V8) in Node and Chrome, so goldens agree | Jest; Cypress |
| 4 | Lint and format | **Biome 2.5.15**, plus `check-arch` (**oxc-parser 0.153.0**) for determinism bans and import boundaries | One fast tool; verified here | ESLint + Prettier |
| 5 | Threads | The **sim runs in one dedicated Worker** at a fixed 60 UPS. The **main thread** handles input, the DOM UI, WebGL2 and audio. A **worldgen worker pool** and an **IO worker** (compression and IndexedDB) complete the set | The UI and renderer cannot steal sim time, and vice versa | Sim on the main thread (kept only as a debug mode) |
| 6 | Shared memory | **No SharedArrayBuffer.** Transferable `ArrayBuffer` ping-pong between threads | Works on any static host (dev server, Artifact) without COOP/COEP headers | SAB snapshots |
| 7 | Sim state | **Per-system struct-of-arrays pools** of typed arrays, a thin entity table, and cold data in `Map`s | Cache-friendly, zero GC in the tick, trivially saved and hashed, portable to WASM | A generic ECS library; one class instance per entity |
| 8 | Scheduling | **Factorio-style active lists plus sleep/wake** with explicit wake sources, a timer wheel and chunk buckets (heat 1/64, agents 1/20) | An idle factory costs ~0 | Updating everything every tick |
| 9 | Determinism | **Fixed point** where Factorio uses it (belts in 1/256 tile), IEEE doubles elsewhere, transcendental `Math.*` banned in the sim, counter-based RNG | Saves and replays portable across browsers; tests reproducible | Floats with `Math.sin`; stateful global RNG |
| 10 | Belts | **Factorio transport lines**: gap-encoded, O(1) per moving line per tick, with the wiki's geometry numbers | ISO throughput and compression | Per-item movement |
| 11 | Fluids | **Factorio 2.0 fluid segments** (FFF-416, FFF-430). **Connection categories** keep data lines separate from pipes | ISO; pipes cost nothing per tick | 1.1 per-pipe flow |
| 12 | Rendering | **Custom WebGL2 immediate-mode sprite renderer**: expanded quads with a static index buffer and texture-array atlases. **No PixiJS** | Measured 5–30× faster than instancing on SwiftShader (Claude's verification renderer) and equal on real GPUs. No scene graph duplicating sim state | PixiJS 8.22; WebGPU |
| 13 | UI | **DOM + SolidJS 1.9.15** (fine-grained signals), CSS 9-slice frames and **Titillium Web** (OFL, self-hosted). WebGL draws world-anchored icons; the minimap and GUI previews show through DOM "holes" | Text, IME, scrolling and search for free; 60 Hz updates without a virtual DOM | A canvas-drawn GUI; React |
| 14 | Saves | **Binary sectioned container**, deflate via **fflate 0.8.3**. Save blobs in **OPFS** where available, with **IndexedDB** (via **idb 8.0.3**) for metadata and as the fallback (07-ui §19.2). Pools load by field name. Global scalars, timers and RNG states are saved; everything else not listed as derived is saved too (§8.1). Input logs give replays | Fast, versionable, debuggable | JSON saves; localStorage |
| 15 | Assets | **Blender 5.2 Cycles** renders from Python model scripts: oblique 45° camera, colour, shadow and light passes. **SVG icons** via resvg. Atlases are texture-array pages. **Audio** via FluidSynth plus synthesized SFX | Fully scriptable, so Claude can author and verify it headlessly | Hand-drawn pixel art; runtime 3D |
| 16 | Verification | Scenario goldens in Node. **NO_SLEEP equivalence**. Save/load and replay hashes. Playwright feel tests with deterministic `__game.step(n)`. Screenshot review by Claude. On the dev server, **user-side benchmark and bug-report endpoints** | The user's real GPU closes the loop the host cannot | Manual testing only |
| 17 | Data contract | The engine reads **numbers, ids, enums and expressions** from `spec/data`, never English. One **expression compiler** serves every formula field (`count_formula`, `amounts_by_j`, `field_year`). Formulas that are not expressions live in code, named by the owning chapter's section. **Milestone builds are rule-based filters** over the full data, checked for closure (§2.4, §12) | Design and code cannot drift apart silently | Prose formulas read by hand; per-milestone data sets |

---

## 1. Constraints that shape the engine

**The player.**
- One user, playing in a desktop browser on a mid-range laptop (the reference machine, §11).
- They reach the game through an SSH tunnel to the dev server, or through a published build.
- **Browsers:** Chromium is primary (it has Keyboard Lock); Firefox is supported; Safari is best effort.
- **WebGL2 is required.** There is no WebGL1 fallback.

**The builder: Claude, on cpuserver10.**
- **No GPU.** On SwiftShader, about 5k sprites take 30 ms per frame and 20k take 70 ms (with expanded quads).
- **CPU:** a Xeon E5-2650 v2, at roughly 0.55× the reference machine's single-thread speed (an estimate, to be confirmed by `bench.html`, §10.6), with 32 threads and 62 GB RAM.
- **Consequences:**
  - everything must be verifiable headlessly;
  - simulation tests never render;
  - performance is measured on the sim in Node and calibrated against the user's machine (§10.6).

**Fidelity.**
- Factorio 2.0 mechanics and numbers (ISO).
- The engine must reproduce the timing-sensitive behaviours to within a few percent of the wiki: belt compression, inserter cycles, insertion limits, fluid sharing and brownouts. Golden tests check this (§10.3).

**Data-driven.** The design YAML is the source of truth. There is no per-item code; per-entity behaviour comes from a small set of entity *types*.

**Scale.** A late game of about 150k entities at 60 UPS on the reference laptop (§11).

**Churn.** Rounds 3–5 will rename and rebalance. The engine absorbs that as data, so tests assert ratios and rules, not names.

---

## 2. Stack, layout and data pipeline

### 2.1 Versions (pinned; installed and run on this host, 2026-10-19)

The rule: each pin is the newest release at least 14 days old (cutoff 2026-10-05). The one exception is Playwright, which matches the host's global 1.64.1. Every pin below was installed together and smoke-tested here: native binaries run on glibc 2.31 without AVX2; `tsc`, `vite build`, Vitest, Biome and `check-arch` all ran; Solid compiled; zod, fflate, fake-indexeddb, simplex-noise and maxrects-packer loaded.

| Package | Pin | Role | Notes |
|---|---|---|---|
| Node | 24.22.0 (`~/.local/bin/node`) | Build, tests, benchmarks, data stage | Never `/usr/bin/node` (v10) |
| typescript | 7.0.2 | `tsc -b --noEmit` type-check only | Native Go binary (`@typescript/typescript-linux-x64`). Fallback 6.0.3 if a TS 7 checker bug blocks |
| vite | 8.3.2 | Dev server, production bundle, module workers | Rolldown inside |
| vitest | 5.0.3 | Unit, scenario and property tests; `bench` mode | Runs from its own `vitest.config.ts` with `environment: 'node'` and **without** vite-plugin-solid. Verified: the Solid plugin silently switches Vitest to jsdom, which we neither need nor install, since UI is tested in real browsers |
| @playwright/test | 1.64.1 | E2E, screenshots | Matches the global install (exception to the 14-day rule). Chrome via `launchOptions.executablePath: ~/.local/opt/chrome-current/chrome`; Firefox 157 via a user-mode `PLAYWRIGHT_BROWSERS_PATH` install (§10.5) |
| @biomejs/biome | 2.5.15 | Lint and format | |
| oxc-parser | 0.153.0 | AST for `scripts/check-arch.ts` | Verified: flags `Math.random`, `Math.sin`, `Date.now` |
| fast-check | 4.10.2 | Property tests | |
| solid-js / vite-plugin-solid | 1.9.15 / 2.11.14 | DOM UI | A 10-slot test app is 4.4 kB gzipped |
| yaml | 2.9.1 | Data stage | |
| zod | 4.6.5 | Engine-level prototype schema | |
| fflate | 0.8.3 | Save compression (deflate), sync in Node and async in the IO worker | |
| idb / fake-indexeddb | 8.0.3 / 6.2.5 | IndexedDB in the browser and in Node tests | |
| pixelmatch / pngjs | 7.2.0 / 7.0.0 | Screenshot diffs | pixelmatch 8 is younger than 14 days |
| simplex-noise | 4.0.3 | World generation noise | Uses only `+ − × floor`, so it is deterministic |
| maxrects-packer | 2.7.4 | Atlas packing in the Node asset build | Import `maxrects-packer/dist/maxrects-packer.mjs` directly. 2.7.4 declares `"type": "module"` but its `main` is a UMD file, so the bare import yields no exports (verified). 3.0.0 is four days old |
| @fontsource/titillium-web | 5.3.0 | GUI font (OFL), self-hosted | |
| Python (`gamedev-python` 3.12) | numpy, pillow, pyyaml, pedalboard, pretty_midi, music21 | Asset post-processing, SFX synthesis, `tools/validate_spec.py` | |
| Blender, resvg, magick, oxipng, cwebp, ffmpeg, fluidsynth, gifski | As in `CLAUDE.md` | Asset pipeline | Not available: `toktx`, `basisu`, `cmake` (§6.13) |

**Policy.**
- Pin exact versions and install with `npm ci` from the lockfile.
- Upgrade only at milestone boundaries, and only to releases at least 14 days old.
- There are no runtime network calls: fonts, data and assets are all self-hosted.

### 2.2 Repository layout

The repository root stays `/home/mewse/browsergame`. The code lives in `game/` as one npm package. Each layer has its own tsconfig, and the import boundaries are enforced by `check-arch`.

```
browsergame/
  CLAUDE.md  design/  tools/validate_spec.py  tools/render_spec.py  tools/check-toolchain.sh
  tools/ref/heat_calib3.py   # verbatim copy of round1/F-data/calib3.py: the heat field's golden reference (G15)
  game/
    package.json  biome.json  vite.config.ts  playwright.config.ts
    tsconfig.{sim,worldgen,worker,app,ui,scripts}.json   # per-layer libs: sim has NO DOM types
    src/
      shared/      # types used across threads: ids, InputAction, protocol, packet layouts (no DOM, no sim internals)
      sim/         # the World and every system (§4–§5); pure TS, lib es2024 only
        core/      # world, surfaces, chunks, entity table, pools, scheduler, rng, hash, expr (§2.4)
        systems/   # belts/ inserters/ crafting/ mining/ energy/ fluids/ thermal/ staffing/ worldtext/
                   # research/ trains/ agents/ circuit/ quality/ runaways/ enemies/ stats/ construction/ player/
        save/  actions/  snapshot/  queries/
      worldgen/    # noise, climate, autoplace, towns; pure TS (runs in workers and Node)
      render/      # WebGL2 renderer (main thread)
      ui/          # SolidJS GUI, HUD, windows, input system
      audio/       # Web Audio runtime
      app/         # entry points: main.ts, sim.worker.ts, gen.worker.ts, io.worker.ts; wiring
      dev/         # __game hooks, debug overlays, dev-server middleware (/__bench, /__report)
      generated/   # data-stage output: proto-ids.ts (string-literal unions), prototype types
    data/engine/   # engine overlay YAML (§2.4), including manifests.yaml (the milestone filters of §12)
    locale/en.yaml # UI strings (names come from the data)
    assets/        # sources: blender/ (rig, materials, parts, entities/*.py), svg/, audio/
    public/        # build outputs served: data/prototypes.json, atlases/, audio/, fonts/
    test/          # scenario tests and layouts (*.txt), goldens/
    e2e/           # Playwright specs and screenshot goldens
    bench/         # benchmark scenarios, runner, history.jsonl, user-results/
    scripts/       # data-stage.ts, check-arch.ts, build-assets.ts, pack-atlas.ts, render-entities.sh
```

**Boundary rules** (checked by `check-arch`):
- `sim/` and `worldgen/` import only themselves and `shared/`.
- `render/`, `ui/` and `audio/` may not import `sim/`. They see the sim only through `shared/` types and packets.
- Only `app/` wires threads together.
- `tsconfig.sim.json` has `"lib": ["es2024"]` and no `types`. A stray `document` or `window` in the sim is therefore a compile error. (A trial of the combined dom + webworker libs showed they clash in TS 7 anyway.)

### 2.3 Commands

| Command | Does |
|---|---|
| `npm run dev` | Data stage in watch mode, then the Vite dev server on `127.0.0.1:5173`. The user tunnels in (`CLAUDE.md`). The dev middleware serves `/__bench`, `/__report` and `/__shot` (§3.5) |
| `npm run build` / `npm run preview` | Production bundle in `dist/` / serve it on the same port |
| `npm run data` | Data stage (§2.4) |
| `npm run check` | `biome check`, `tsc -b`, `check-arch`, the data stage in strict mode, `gamedev-python ../tools/validate_spec.py ../design/spec/data`, and the generated-spec freshness checks `gamedev-python ../tools/render_spec.py --check` (02, 05) and `gamedev-python ../tools/render_slice.py --check` (09 §1–§2) |
| `npm test` | Vitest: unit, scenario, property and determinism suites (Node) |
| `npm run test:slow` | Worldgen seed sweeps (09 S-G1), long golden runs, the scripted opening's full replay. Nightly and at milestone exits |
| `npm run e2e` | Playwright: feel tests, window screenshots, smoke. `--project firefox` runs the Firefox 157 suite with `?render=none` (§10.5) |
| `npm run bench [-- --scenario X]` | Node benchmark runner; appends to `bench/history.jsonl` |
| `npm run assets [-- --only id]` | Blender, SVG and audio pipelines. Incremental, using content hashes of each source script and its parameters |
| `npm run ci` | `check`, `test`, `e2e --grep @smoke`, and `bench --quick` with a 10% regression gate. Installed as a git pre-commit hook once the repository is initialised |

### 2.4 The data pipeline ("data stage")

Factorio builds its prototypes in a data stage (`data.lua` → `data-updates` → `data-final-fixes`). Ours does the same at build time.

1. **Design data.** Source: every `design/spec/data/*.yaml`, in the schema of `SCHEMA.md`. R4-data owns all of them except `text.yaml`, which R4-ui owns.
   - **Kinds:** items, recipes, entities, technologies, resources, enemies, **tiles** (κ, buildability, walking speed, map colour, placing item; town streets and building blocks are tiles too; B3), **world** objects (trees, rocks, the campus, landmarks; J9), **text** (loading tips, tips and tricks, milestones, achievements with machine-readable conditions, town-name lists and the world objects' `world_text`), and `meta`, a mapping of global blocks (`tiers` and categories, start and salvage, `quality`, `heat`, `staffing`, `runaways`, `hollow_work`, `world`, `world_settings`, `endgame`, `effects`, `checks`, `citation_rules`). The UI's own strings (statuses, alerts, flying text, log lines, readouts) are 08's and live in `game/locale/en.yaml`, not in the data.
   - **Validation:** `tools/validate_spec.py` checks the schema, references, the technology DAG, producibility, the research playthrough and the expression grammar.
   - The engine never edits these files.
2. **Engine overlay.** Source: `game/data/engine/*.yaml`, keyed by id. It holds only fields the design schema does not carry:
   - collision, selection and player-collision boxes, and selection priority;
   - fluid-box positions, directions, flow types and **connection categories**, `default` or `data` (U50). Example: the data refinery's crawl and stream boxes are `data`, its water box `default`;
   - inserter pickup and drop vectors and rotation and extension speeds. Their energy per movement and per rotation is design data (`energy.per_movement_kj`, `per_rotation_kj`; §5.4);
   - a drill's mining area and output vector, and the **pumping position** of offshore pumps and Water exchangers (U9);
   - belt lane geometry;
   - animation definitions (sprite names, frame counts, speeds) and working sounds;
   - entity map colours (tile colours are design data) and circuit-connector positions;
   - `fast_replaceable_group`, `next_upgrade`, rotatable and flippable flags;
   - item group, subgroup and order (they drive the crafting grid, I §7.2);
   - the **quality stat table** (L5, §5.16): which stats of each entity type scale with quality (ISO 2.0). The slope is the design's `meta.quality.stat_bonus_per_level`;
   - terrain materials per tile id (§6.5);
   - `manifests.yaml`, the milestone build filters (§12).

   **Defaults** come in two layers: per entity `type`, and per `mirrors` id. The `mirrors` defaults are a hand-typed table of Factorio 2.0 numbers from the wiki and the published prototype values (`round1/I-data/data/*.lua`): numbers only, never copied files.
   - **Parse rule** (J23): the defaults id is the leading `[a-z0-9-]+` token of `mirrors`.
   - The token `new` means no `mirrors` defaults. The data stage then requires a full overlay entry for that entity.
   - Most entities need no per-entity overlay.
3. **Compile** (`scripts/data-stage.ts`). It runs in `npm run data` and as a Vite plugin with file watching.
   1. **Load and merge.** The overlay may add engine fields. It may not override a design number: that is an error, and the fix belongs in the design YAML.
   2. **Compile expressions** (J18). One grammar serves every formula field: `count_formula` and `field_year` (variable L), `amounts_by_j` (variable j) and the model-collapse `speed_factor` (variables sigma and c; `meta.world.model_collapse`).
      - It allows numbers, `+ − * /`, `^`, parentheses and the field's variables, and nothing else.
      - `^` needs an integer right operand after substitution and evaluates by repeated multiplication, so the result is exact in every engine (§4.1).
      - Each expression compiles once to a closure over the allowed operations. Costs are cached per level, product tables per value of j (§5.5).
      - An unknown variable, or a non-integer exponent at any level the technology can reach, is a data-stage error.
   3. **Derive.**
      - Belt speed in positions per tick from `items_per_s` (15 → 8).
      - Nothing for containers: every fill and empty recipe is explicit in the data (`container: fill | empty`; barrels for water, sulfuric acid, lubricant and coolant, drives for the four data fluids; none for steam or plasma, ISO).
      - Recycling recipes for the Verifier: 25% of ingredients, the quality rule.
      - Recipes with `pseudo: true` (the frontier-run launches) become validator-only: hidden from crafting, with their mechanics native to the engine.
      - The `computing` flag and the T\* class from `heat.class` (consumed by §5.9).
      - Placement predicates from the entity's `placement` block: `must_be_on: exchange` and `must_touch: [water, deep-water]` (§5.2).
      - Tile tables from `tiles.yaml`: κ, buildability, walkability and speed, map colour, and the item → tile map from items' `places_tile` (§4.4).
      - **Build filters** (§12; J17). A milestone manifest is a rule: the technologies of the listed tiers, minus exclusion roots and everything that depends on them. M1 is 09 §2.7's explicit list.
        - Everything else is derived. The recipes are exactly the non-pseudo recipes unlocked by an included technology or by `prior-art`; they are never listed by hand. Items and entities follow from the recipes. A manifest's `start_recipes` must equal `prior-art`'s unlocks.
        - **Closure check:** every prerequisite is inside the filter. Every ingredient, pack and trigger target is obtainable inside it: from resources, the start inventory and salvage, entity outputs and included recipes. Every recipe category has an included machine or is hand-craftable. When a manifest lists `tiles`, every item's `places_tile` and every tile worldgen places is in the list.
        - `scenery` resources (09's exchange in the slice) are generated but exempt from closure, and nothing in that build can extract them.
        - Spoil results (Scooped) and Wild loot are conditional. A recipe that needs only them is reported as inert, not as an error.
        - M1's list is generated from the data by `tools/render_slice.py` (09 §1, §2.7). Its derived keys (start recipes, items, entities, tiles, world objects, resources, scenery) are checked against the same rules.
        - The reference implementation of these rules, run against the current data, is `design/round4/arch-data/manifests.py`.
   4. **Validate** with zod schemas. Every entity has boxes and sprite references. Fluid boxes match recipe fluids. Every recipe category has a machine. Every item has an icon or a placeholder. **Every technology effect type, trigger type, achievement condition (`text.yaml`) and `formula_ref` named in the data exists in the engine's registries.** This last check is what keeps design and code in sync. Also:
      - a research-per-paper effect carries `multiplier_from: returns_to_research`. A literal multiplier there is an error (J14);
      - a catalyst product carries `affected_by_quality: false` (L5);
      - productivity applies only to recipes with `allow_productivity: true` (DECISIONS §30). The stage lists, per machine, the recipes a productivity module would block;
      - **no prose where the engine reads** (J1). The engine's zod schema names every field it consumes, typed as a number, an id, an enum or an expression, and a prose string in such a field is an error. Fields it does not consume (`rule`, `formula`, `note`, `line`, `desc`) are documentation for people.
      - **Formulas that are not expressions** (T(W)'s clamp, j(W)'s breakpoints, the leak's selection rule) live in code, parameterised by the block's numbers. The block's `formula_ref` cites the chapter section that states the rule (e.g. "01 §8.1"). The code that implements it carries the same citation as a `@formula 01 §8.1` tag, and the stage fails when a `formula_ref`'s leading "NN §X.Y" has no tagged implementation.
   5. **Assign dense numeric ids** per kind, sorted by group, subgroup, order, then id.
   6. **Emit:**
      - `public/data/prototypes.json`;
      - `src/generated/proto-ids.ts`: string-literal unions, so tests and code that name `'memo'` are checked at compile time;
      - `prototypes.hash`, recorded in saves.
4. **At runtime**, the sim, UI and renderer each build typed lookup tables (`Protos`) from the JSON. Example: `protos.entity.craftingSpeed: Float32Array`, indexed by entity prototype id.

### 2.5 Code rules

- **TypeScript:** `strict`, `noUncheckedIndexedAccess` outside hot loops, and `exactOptionalPropertyTypes`.
- **The sim tick allocates nothing:**
  - no closures, arrays, objects or strings in the per-tick paths;
  - pools grow only on build;
  - a debug counter (`__game.allocs`, from a sampling heap snapshot in dev) guards it.
- **No `any` in `sim/`.** Types for pool fields come from one descriptor table that also drives saving (§8.1).
- **Comments** state invariants and cite their source, e.g. `// FFF-430: 100 units per flow op, scaled by fullness`.

---

## 3. Runtime architecture

### 3.1 Threads

```
 main thread                                          sim worker (1)                     worldgen pool (2–4)
 ─────────────────────────────────────────            ───────────────────────────────    ─────────────────────
 input capture → action map → context resolver  ─act→  World.tick() @ 60 UPS        ─req→ generateChunk(seed,
 SolidJS UI (store fed by packets)              ←pkt─  apply actions, run systems    ←chk─  settings, surface, cx, cy)
 WebGL2 renderer (view model + dynamic buffer)  ─view→ snapshot/extract for view           (pure, order-independent)
 Web Audio (events + visible working sounds)    ─ctl→  saves: copy pools ──────────┐
                                                                                    └──→ IO worker: deflate,
                                                                                         IndexedDB, export
```

- **One simulation thread.** All game state lives there. Determinism is easy to guarantee because nothing else writes it.
- **Worldgen workers** compute chunk contents as a pure function. They never touch the World (§5.18).
- **The IO worker** compresses and stores saves. The sim worker only copies its typed arrays, which takes about 50 ms for a late game (§8.4).
- **Debug and test mode:** `?sim=inline` runs the same sim on the main thread through an in-process transport. Node tests always use the in-process transport.

### 3.2 Protocol (`src/shared/protocol.ts`)

```ts
type MainToSim =
  | { t: 'init'; protos: PrototypeJson; map: MapSettings; save?: ArrayBuffer; mode: 'play' | 'test' }
  | { t: 'act'; actions: InputAction[] }        // applied at the start of the next tick, logged for replay
  | { t: 'view'; v: ViewRequest }               // surface, rect (tiles), zoom, overlays, subscriptions
  | { t: 'ctl'; id: number; op: CtlOp };        // pause | resume | speed | step(n) | save | load | hash | query(Q)

interface ViewRequest {
  surface: number; rect: [number, number, number, number]; zoom: number;
  overlays: OverlayId[];                        // heat, staffing, power, pipelines, logistics …
  hovered: EntityRef | null;                    // live tooltip data
  open: Subscription[];                         // character, entity GUI(s), tech, stats(range, tab), map search …
}

type SimToMain =
  | { t: 'pkt'; tick: number; chunks: ChunkView[]; dyn: ArrayBuffer; ui: UiDelta; ev: SimEvent[] }
  | { t: 'res'; id: number; ok: boolean; value?: unknown }
  | { t: 'log'; level: 'info' | 'warn' | 'error'; msg: string; data?: unknown };
```

- **`InputAction`** mirrors Factorio's `defines.input_action`, exactly as I §8.2 lists it. Our additions are in Appendix B.
- **Validation.** Each action is validated in the sim against reach, items, collisions and permissions. Failures come back as `SimEvent`s: flying text with a reason, an error sound. The sim never calls UI code.
- **Queries** (`ctl: query`) are read-only and are not logged. Examples: the rate calculator, map search, "where is X made", "total raw", Factoriopedia live counts.
- **`dyn`** is one transferable `ArrayBuffer`. Its section table holds belt items, inserter hands, animated-entity frames, agents, trains, units, projectiles, smoke and lights. The main thread transfers it back for reuse, so it ping-pongs between three buffers.
- **`ui`** carries only changed sections, as small structured-clone objects with versions. Examples: the player inventory when its version changes, the open entity's live panel every tick, the hovered tooltip every tick, stats series every 60 ticks while the statistics window is open.
- **Backpressure.** If the main thread has not acknowledged the previous packet, the worker coalesces: it merges events and chunk changes and drops intermediate `dyn` data.
- **Logging.** All worker logs and uncaught errors are forwarded as `log` messages, so the page console (and therefore Playwright) sees everything.

### 3.3 The tick loop and pacing

- **Timing.** The worker paces itself. The number of ticks due is `floor((now − t₀) × speed ÷ 16.667 ms)`, and each wake runs at most 3 of the outstanding ticks.
  - If the backlog exceeds 6 ticks, `t₀` is rebased and the backlog dropped. Game time then slows, as in Factorio when UPS drops below 60, and there is no spiral of death.
  - The debug overlay (F5) shows UPS and FPS.
- **Waiting.**
  - `setTimeout(nextTickTime − now − 2 ms)` when the next tick is more than 4 ms away.
  - Otherwise a `MessageChannel` self-post, which avoids the 4 ms timer clamp.
  - Accuracy is about 1 ms, without busy-spinning.
- **Rendering is decoupled.**
  - The main thread renders the latest packet on `requestAnimationFrame`. Camera pans and zooms animate at the display rate.
  - World content updates at 60 Hz, as in Factorio, which renders at its update rate.
- **Hidden page** (07-ui §19.3). The game pauses when the page is hidden and autosaves if the last save is older than a minute. The Interface setting *Keep running in background tab* (default off) keeps the worker simulating, at whatever rate the browser allows, with packet extraction skipped.
- **Pauses.** The technology screen and the game menu send `pause` in single player (I §4.0).
- **Test mode** (`mode: 'test'`). The clock stops. `__game.step(n)` runs exactly *n* ticks synchronously and then emits one packet. E2E tests are deterministic whatever the frame rate.

### 3.4 The view model (the main thread's mirror of what is on screen)

The main thread keeps a per-chunk mirror of the chunks in the view rectangle plus a one-chunk margin.

- **Tiles:** one `Uint8` tile id per tile (the dense ids of `tiles.yaml`), for terrain textures, buildability and walking speed.
- **Entity records:**
  - id, prototype, position, direction, flip and quality;
  - selection and collision boxes (from prototypes);
  - sprite variant (pipe and belt connection masks), recipe or alt-mode icon, status code, and the ghost and deconstruction flags.
- **Versioning.** Each chunk carries a version. The worker resends a chunk only when its version changed: built, removed, rotated, recipe changed or status changed.

**What the mirror buys** is instant feedback without a round trip:
- **Hover selection,** by selection boxes and priority (I §3.1).
- **Build previews:**
  - green, yellow or red tints (I §3.3);
  - drag-building lines, smart belts and underground pairing previews (I §3.4–3.5);
  - pole links and coverage.

The sim re-validates every action authoritatively. Live values (a tooltip's resources remaining, an entity's contents) come from the `hovered` and `open` subscriptions.

### 3.5 Dev hooks and dev-server endpoints

**`window.__game`** exists in dev builds, and in production builds behind `?dev=1`. It exposes:
- `step(n)`, `dispatch(action)`, `query(q)`, `hash()` and `allocs()`;
- `loadScenario(name | json)`, `save()` and `load(buf)`;
- `ui.open(name)` and `ui.close()`;
- `render.mode('on-demand' | 'continuous')`, `render.frame()` and `camera(x, y, zoom)`;
- `speed(x)`, `replay(log)` and `exportBugBundle()`.

**The Vite dev server's middleware** writes into the project, so Claude can read it directly:
- `POST /__bench`: results of the in-game benchmark page `bench.html`, run by the user on their laptop, go to `bench/user-results/<date>.json`.
- `POST /__report`: from the console command `/report`, or Ctrl+Alt+F12. A bug bundle is saved to `bench/reports/<ts>/`: the last autosave, the input log since it, the console log, a screenshot from the user's real GPU, the build hash and the browser string.
- `POST /__shot`: screenshots on demand from the user's session.

---

## 4. Simulation core

### 4.1 The determinism contract

1. **One thread mutates the World.** Within each phase, entities are iterated in a fixed order: pool index order, which is deterministic because allocation and free-list reuse depend only on history.
2. **Banned in `sim/` and `worldgen/`** (enforced by `check-arch`):
   - `Math.random`, `Date`, `performance`, `crypto`;
   - transcendental `Math` functions: `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `exp`, `expm1`, `log`, `log1p`, `log2`, `log10`, `pow`, `cbrt`, `hypot`, `sinh`, `cosh`, `tanh`. Engines implement these differently. Measured on this host: 492 of 16,000 results differ between Firefox 157 and Chrome 156, in `exp`, `cbrt`, `sin`, `cos`, `log` and `atan2` (Appendix A);
   - the `**` operator on non-integer exponents;
   - `for…in`;
   - iteration over `WeakMap` or `WeakSet`;
   - `Array.prototype.sort` without a total comparator.
3. **Allowed:**
   - `+ − × ÷`, `Math.sqrt`, `Math.fround` (all correctly rounded under IEEE 754);
   - `floor`, `ceil`, `round`, `trunc`, `abs`, `min`, `max`;
   - `Math.imul` and `Math.clz32`.
   - Many curves need nothing transcendental. The throttle `clamp(1 − (T − T*)/50, 0.5, 1)` and radiators' T⁴ are plain arithmetic. Geometric costs such as 1.5^L are repeated multiplication, cached per level. The solar day curve is piecewise linear.
   - **`sim/core/detmath.ts`** covers the rest: `exp2`, `log2`, `pow(a, b)` (as `exp2(b·log2 a)`), `sin`, `cos` and `atan2`, implemented with range reduction and fixed polynomials using only the allowed operations, so results are bit-identical in every engine. It serves the exchange floor `2^((W−40)/20)`, the field's γ(W), and orientation maths for trains and agents. Unit tests pin its outputs against golden values.
4. **Integers where Factorio uses them:**
   - belt positions in 1/256 tile;
   - item counts as `int32`;
   - circuit signals as `int32` with wrap-around (`|0`, `Math.imul`);
   - tile coordinates as `int32`.
5. **Doubles elsewhere:**
   - energy in joules;
   - fluid amounts in units;
   - heat in MJ;
   - research progress in units;
   - continuous positions (character, agents, trains, units) in tiles.
6. **RNG** (§4.3) is either stream-based, with each stream seeded from the world seed and a stream id, or counter-based for per-event draws. No draw ever depends on update order.
7. **The state hash** `__game.hash()` is xxHash32 over every pool's bytes, the cold sections (canonical JSON) and the scalars. Tests compare hashes (§10.4).
   - It covers saved state only (§8.1). Optimisation state (sleep flags, active lists, wake registrations) and derived caches (`speedEff`, network topology) are excluded; the contents of lines, segments and networks are saved state and hashed. That is what lets a NO_SLEEP run, a sleeping run and a run continued from a save be compared bit for bit.

Under this contract, a save and its input log are designed to replay bit-identically in Chrome, Firefox and Node. CI checks Chrome against Node; Firefox is checked by an occasional hash spot-check on the user's machine.

### 4.2 Units and numeric types

| Quantity | Unit | Storage |
|---|---|---|
| Time | tick (1/60 s) | `int32` world tick (overflows after 414 days of play); `float64` where needed |
| Position (buildings) | tile; centres stored ×2 so odd and even footprints are integers | `int32` |
| Position (moving things) | tile | `float64` |
| Belt item position and gaps | 1/256 tile ("positions") | `int16` slack per gap (negative while squeezed; a 32-tile line is 8,192 positions), `int32` totals |
| Direction | 16 directions (Factorio 2.0 `defines.direction`); most entities use 0/4/8/12 | `uint8` |
| Orientation (rolling stock, agents) | turns | `float64` |
| Item count | items | `int32` |
| Fluid amount | units | `float64` |
| Energy | J | `float64` |
| Power | W, as J per tick × 60 | `float64` |
| Temperature (heat-pipe network; thermal field) | °C | `float64` |
| Research progress | units | `float64` (takeoff reaches ~10⁷ units/s: fine) |

### 4.3 Identifiers and RNG

**Prototype ids** are dense `uint16` per kind (items, fluids, recipes, entities, technologies, virtual signals, tiles), assigned by the data stage. Saves store name tables and remap on load (§8.3).

**Item key** (`uint16`) = `(itemIndex << 3) | quality`, where quality is the tier *index* 0–4 (H's tiers, Standard to Reference). The tier's *level* (0, 1, 2, 3, 5; ISO legendary = 5) is a separate lookup that scales stats (§5.16); "one tier higher" always means index + 1 (L5). That allows 8,192 items. Belts, slots, hands and filters all store item keys. Items of different quality never stack (ISO).

**Entity handle** (`uint32`) = `(generation << 22) | slot`: 4M slots, with 1,024 generations to catch stale references.

**Entity serial** (`uint32`): a never-reused creation counter, saved. It is used for RNG keys, undo records and stable references in saves.

**RNG:**
- **Streams:** `xoshiro128**`, seeded with `splitmix32(hash(worldSeed, streamId))`. Used where a sequence is natural: enemy AI (Wild), worldgen regions.
- **Counter-based:** `rand(a, b, c, d)` = a 32-bit avalanche hash (Murmur3 finalizer chain) of the world seed and four keys. Used for every per-event draw, so the result is independent of update order and of sleeping:
  - probabilistic recipe products (D's uranium 0.7%; A's experiment-media loop at 0.05/0.95 with catalyst returns): `rand(serial, craftCount, productIndex, 0) / 2³² < p`;
  - quality rolls: `rand(serial, craftCount, productIndex, 1)`;
  - the selector combinator's random mode: `rand(serial, tick, 0, 2)`;
  - Wild unit and expansion choices that Factorio randomises: `rand(nestSerial, tick, purpose, 3)`.

  Tree leaf loss from heat needs no randomness: a per-chunk accumulator drops one stage per tree per 600 s spent above 45 °C (§5.9, U11).

**Catalysts.** Products with a `catalyst` amount are excluded from productivity bonuses, as in Factorio 2.0 (`ignored_by_productivity`). They also carry `affected_by_quality: false` (Factorio's per-product flag, 2.1.7; L5): the catalyst returns at its ingredient's quality, and only the non-catalyst remainder rolls (§5.16). Kovarex-shaped recipes (checkpoint copies, controllers, Researchers, Ratings, Meta-analysis) therefore behave correctly under modules: copying returns the original unchanged (B L6).

### 4.4 World, surfaces, chunks and spatial queries

```
World { tick, seed, mapSettings, surfaces[], force (single), research, bonuses, globals (below),
        stats, player, timers, rng, systems… }
Surface { id, chunks: Map<number, Chunk>, thermal params (ambient model, vacuum?), electric/fluid/rail graphs… }
Chunk  { cx, cy, tiles: Uint8Array(1024), resources: sparse (tile → proto, amount u32), trees: sparse list
         (tree → species, leaf stage 0–4), world objects: sparse list (rocks, campus, landmarks, salvage pieces),
         decor seed, ambientTheta, sunlight, kappa, H (heat MJ), leafTimer (s above 45 °C), charted/visible
         counters, entity list (Int32 growable), occupancy: Int32Array(1024) | null (entity slot per tile,
         object layer), version, pristine flag }
```

**Global simulation state** (`World.globals`; saved whole in the `GLOBALS` section, §8.1):
- the world's text: W split into W_own and W_pub, Y_pub, the queue of pending publication releases, Σ, σ, j, the race state (§5.11);
- the leak L and every deploying building's share ℓᵢ, plus the infections and their timers' owners (§5.17);
- research: queue, per-technology progress and levels, the scheduling toggle, Literature and Your-year inputs (§5.12);
- the closure tick and the overhang snapshot, milestone times, achievement progress, the doubling-time ring (R̄ and its running maximum R̂) and history string, the run-report accumulators (§5.20).

**Surfaces from day one.** The base game uses one surface. The expansion (spec/06: orbit, the Stacks, Mercury, an outer moon) adds more without engine surgery. Every position carries a surface index.

**Chunks** are 32×32 tiles. The key is `(cx + 2¹⁵) × 2¹⁶ + (cy + 2¹⁵)`, which covers ±1,048,576 tiles, Factorio's map size.

**Tiles** (B3; 01 §2.1) are design data: `tiles.yaml` gives each tile id its κ, `buildable`, `walking_speed` (null: not walkable), `map_color`, `placed_by`, `minable_back` and biome.
- The data stage assigns dense `uint8` ids. A chunk's κ is the mean of its 1,024 tiles' κ plus its trees' contribution (§5.9); it is recomputed when a tile or a tree changes.
- **Placed tiles** (concrete, refined and hazard concrete, landfill) come from items with `places_tile`. A tile with `placed_on` (landfill: water and deep water) may be placed only there (ISO). Picking up a placed tile restores the tile underneath, which the chunk keeps in a sparse "hidden tile" map (ISO).
- **Town tiles** (a street tile and a building-block tile, flagged `town`) are never buildable. Streets are walkable and drivable; building blocks block the player and vehicles (01 §5.3).
- **The out-of-map tile** fills chunks outside the map bounds (§5.18). Nothing may be built, walked or driven there.

**World objects** (J9; 01 §2.2) are design data in `world.yaml`: trees, rocks, the campus and landmarks (the exchange office, the mine entrance), each with its kind, size, mining time, yields and flags (`cosmetic`, `collides`, `selectable`). They are not entities: they have no pool and no update, sit in the chunk's sparse lists, and are found by the spatial queries below.
- Hand-mining a tree or rock yields its `yields`. Ranges are drawn with counter RNG keyed by the object's position (§4.3).
- The campus and landmarks are not minable. The campus opens the University window.
- Town buildings are not objects: they are building-block tiles (above), drawn as era-skinned buildings (§6.5). The **salvage** is not in `world.yaml`: its single definition is `meta.start.salvage` (DECISIONS §33; §5.18).

**Pristine chunks** (generated and never modified: no build, no mining, no tile change, no tree removed or stripped of a leaf stage) are not saved. They regenerate from the seed on load. Their charted bits and nonzero heat are saved separately (§8.1). This keeps an "endless" map affordable in both memory and saves.

**Spatial queries** (`entitiesInArea`, `entityAt`, collision tests):
- per-chunk entity lists;
- a per-tile occupancy grid for object-layer buildings (O(1) for hover and placement);
- sparse lists for trees, rocks and other world objects, cliffs, rails (which overlap at crossings) and ground items.

**Collision layers** (Factorio-style masks): object, water, resource, rail, player, train, item. Each prototype gets a mask from the data stage; each tile gets one from `buildable` and `walking_speed`.

**The player-collision box** is separate. It holds the ISO collision box by default and never affects building.

**Trimmed collision** (A §10, 07-ui §16; a runtime setting stored in the save, default on). 07-ui assigns the per-type trims to this document:
- The rule: the character's box is the ISO collision box intersected with the footprint **inset by 0.25 tiles on every side**.
- The character is Factorio's 0.4 tiles wide (±0.2). Two buildings placed edge to edge then leave at least 0.5 tiles, so it fits: solar fields, furnace and assembler rows, boiler and steam-engine banks, pipe runs.
- **Exempt** (they keep their ISO boxes): chests, walls and gates, rocks, trees and cliffs. Belts never block the character anyway.
- The data stage derives the trimmed boxes, so no per-entity table is needed.

### 4.5 Entity storage

**Entity table:** struct-of-arrays, one row per entity, about 40 bytes.

```ts
proto: Uint16Array   kind: Uint8Array   surface: Uint8Array   dir: Uint8Array   flip: Uint8Array
x2: Int32Array       y2: Int32Array     chunk: Int32Array     poolSlot: Int32Array
flags: Uint32Array   // active, sleeping, ghost, deconstruct, upgrade, compromised (locks the entity, §5.17), indestructible …
serial: Uint32Array  gen: Uint16Array   quality: Uint8Array
builtTick: Uint32Array   builtBy: Uint8Array   // player | agent | constructor; for the age/builder overlay (07-ui §3.1),
                                               // achievements 16–17 and the save description (08-text §6, §8.5)
```

**System pools:** one per entity *type* family, holding only that system's hot fields as typed arrays, grown by capacity doubling, with a free list. Examples:

```ts
CraftingPool { entity, recipe: Int16, progress: F64, prodBar: F64, speedEff: F32 /* cached product of all multipliers */,
               energyBuf: F64, inv: Int32 /* slot-heap offset */, status: U8, sleep: U8, crafts: U32, activeIx: Int32 }
InserterPool { entity, state: U8, theta: F64, ext: F64, held: U16, heldN: U8, src: Int32, dst: Int32,
               srcPos: Int32, dstPos: Int32 /* cached pickup/drop targets */, energyBuf: F64, stackCap: U8 }
TransportLinePool (§5.3), ElectricNet arrays (§5.7), FluidSegment arrays (§5.8), AgentPool (§5.14) …
```

- **Inventories** live in a shared **slot heap** (`Int32Array` of item key and count pairs). Each inventory owns an `(offset, size)` from a size-class allocator. Filters, the limit bar and the hand-marker slot are parallel sparse arrays.
  - Inventories are typed, and each type has its own acceptance rule: input, output, fuel, modules (ISO), **staff** (a Seminar's single slot: a Researcher only, never filled by inserters; 07 §6.2), **accelerators** (a Research hall's 20 single-item slots), **weights** (its single frontier-checkpoint slot), and the hidden **rollback input** (one slot that exists only while the entity is compromised; §5.17).
  - The rules live in one table, `acceptance(inventoryType, entity, itemKey, actor)`, shared by hand transfer, fast transfer, inserters and agent item requests. A refusal returns the reason string the UI shows.
- **Cold data** goes in `Map<serial, …>`, saved as canonical JSON: labels, circuit conditions, combinator settings, train schedules and interrupts, display-panel messages, logistic request sections, blueprint records.
- **Low-count, graph-shaped state is ordinary classes:** networks (electric, fluid segment, circuit, logistic, rail blocks), trains, research, the player, the world-text scalars.

**Why this shape.**
- Hot loops read contiguous typed arrays.
- There is no per-entity garbage.
- Saving is a typed-array copy.
- The hash runs over the same bytes.
- Any single system can later move to WASM without changing its data. Rust is installable user-mode if benchmarks ever demand it.

V8 no longer unboxes double fields in objects (pointer compression), so object-per-entity layouts pay an indirection on every float. Typed arrays do not.

### 4.6 Update scheduling

**Phase order per tick** (fixed; part of the determinism contract):

| # | Phase | Contents |
|---|---|---|
| 1 | Input | Apply the tick's `InputAction`s (validated) and emit feedback events |
| 2 | Timers | Pop the timer-wheel bucket: wake-ups, scheduled events (ghost expiry, chain-signal re-checks, agent arrivals, runaway spread per infection and escape per machine, §5.17; these read the previous tick's electric satisfaction, since phase 4 has not run yet) |
| 3 | Chunk commits | Worldgen results whose commit tick is now (§5.18) |
| 4 | Energy distribution | Electric networks fill consumer buffers by class: normal, accumulator charging, interruptible (§5.7). Energy drawn, and twice each generator's electrical output, go into chunk emission accumulators (§5.9). Zero-power counters of compromised machines advance. Heat-pipe networks conduct |
| 5 | Fluids | Boundary flows between fluid boxes and segments; pumps (§5.8) |
| 6 | Burners and converters | Fuel → energy buffers; boilers and heat exchangers → steam; reactors → heat |
| 7 | Crafting machines, furnaces, labs, drills | Progress, consumption, production (several crafts per tick allowed, FFF-402); research progress |
| 8 | Transport lines | Movement, line-to-line transfers, splitters, side-loading |
| 9 | Inserters | Pickup and drop state machines |
| 10 | Agents | Agents in this tick's bucket; roboports; logistic and construction dispatch within budget |
| 11 | Trains | Movement, signals, reservations, schedules and interrupts |
| 12 | Circuit networks | Combinators read the previous tick's signals (1-tick latency, ISO); networks swap |
| 13 | Slow fields | In this order: the thermal bucket (`tick & 63`); on `tick % 60 == 0` staffing (§5.10), then world text (§5.11), then the leak with any compromise it causes (§5.17); every tick, the Monitors' clean cycles (§5.17, 03 §3.4); radar sectors |
| 14 | Units | Wild preset only |
| 15 | Statistics and achievements | Flush per-tick counters; condition checks every 60 ticks |
| 16 | Snapshot | Extract the packet for the current view (skipped while the page is hidden) |

**Active sets and sleep.**
- Each system keeps a dense `active` list (`Int32Array`) plus a position index, so removal is O(1).
- A system puts an entity to sleep only when a whole update would provably change nothing.
- The entity records a `sleepReason` and registers with exactly one wake source:

| Sleeper | Sleeps when | Woken by |
|---|---|---|
| Inserter | The source has nothing it may take, or the target will not accept its hand | The source inventory's *added* watch list; the target's *space or need* watch list; the source line's arrival estimate (timer) or restart; power restored |
| Crafting machine, furnace | Missing ingredients; output full; no recipe; no power | Input insert; output removal; recipe set; network satisfaction > 0 |
| Lab (Seminar) | No research; missing packs; no staff and no Researcher | Research change; pack insert; staffing recompute giving staff > 0; Researcher insert |
| Research hall | Fewer than 20 accelerators; no weights; no Dataset; output full | Accelerator or weights insert; input insert; output removal |
| Compromised machine | Always: progress is frozen (§5.17) | Cleaning |
| Drill | Output blocked; area depleted | Target space; resource change |
| Transport line | Front blocked and fully compressed | The downstream line frees space at its entry; an item is inserted into or removed from the line |
| Burner, boiler | No fuel; output full | Fuel insert; output space |
| Roboport | No agent charging or queued (FFF-421: 1 ms → 0.025 ms) | An agent requests charging or stationing |
| Combinator | Input networks unchanged since the last evaluation | Network dirty flag |
| Fluid boundary | Segment and box both empty, or both full, with the machine idle | Segment level crossing a threshold; machine state change |
| Train | Waiting at a stop or signal | Wait-condition timer; signal or block state change |

**The invariant is NO_SLEEP equivalence.** A debug flag updates every entity every tick and bypasses all wake logic. Every scenario test must produce bit-identical state hashes with and without it (§10.4). So sleeping is a pure optimization, never a rule. Update *cadences* that are rules stay the same in both modes: agents every 20 ticks, the thermal field every 64.

**Timers.**
- A 4,096-bucket timer wheel (one bucket per tick, modulo 4,096).
- A binary heap for longer delays: ghost expiry after one week is 36,288,000 ticks.
- Entries are `(dueTick, entityHandle, eventCode)` at runtime. Stale handles are dropped on generation mismatch.
- Saves store `(dueTick, entitySerial, eventCode)` and re-key by serial on load (§8.1). Timers owned by no entity (an infection's spread timer, the publication release) use serial 0 and an owner id in the event.

**Bucketed systems:**
- the thermal field: 1/64 of chunks per tick, Factorio's pollution cadence;
- moving agents every 20 ticks, stationary every 60 (FFF-421), spread by `serial % 20`;
- radar sector scans;
- staffing and world scalars every 60 ticks.

### 4.7 Per-tick cost model (reference machine; §11 defines it)

**Measured on this host** with simplified hot loops (Appendix A): transport lines 6.6 ns per line, active inserters 14.6 ns, crafting machines 11.6 ns, electric consumers 8.1 ns per consumer (two passes), thermal chunks 43 ns per chunk update.

**Projected cost on the reference machine** = host × 3 (real branches and indirections) ÷ 1.8 (machine speed, §11). On the 2022 target machine, divide by about 1.4 more.

| System (late-game base, §11) | Count | Updated per tick | Cost each (reference) | ms/tick |
|---|---|---|---|---|
| Transport lines (60k belt tiles → ~8k lines, 32-tile cap) | 8k | ~50% moving | 10 ns + transfers (~500 per tick × 50 ns) | 0.1 |
| Inserters | 25k | ~60% active | 25 ns + pickups/drops (~360 per tick × 300 ns) | 0.5 |
| Crafting machines, furnaces, labs, drills | 13k | ~70% | 20 ns + completions | 0.3 |
| Electric consumers (2 passes) | 50k | all | 12 ns | 0.6 |
| Fluid boundaries | 4k | ~70% | 30 ns | 0.1 |
| Heat-pipe network | 500 | all | 30 ns | 0.02 |
| Thermal field | 64 chunks per tick | — | 100 ns | <0.01 |
| Staffing, world text, leak | every 60 ticks | — | O(Seminars + universities + Terminals) | <0.01 |
| Runaways (*Contained*) | per infection timer | a few nearest-machine queries per second | O(cluster) | <0.05 |
| Agents | 5k | 1/20 moving, 1/60 idle | 1 µs per update | 0.3 |
| Logistic and construction dispatch | ~100 tasks per tick | — | 2 µs | 0.2 |
| Trains | 100 | ~60 moving | 2 µs; pathfinding amortised 0.1 ms | 0.2 |
| Circuit network | 2k combinators | ~30% dirty | 300 ns | 0.2 |
| Statistics, achievements | — | — | — | 0.05 |
| Snapshot extraction | 20k visible sprites + 50k belt items | per frame | — | 1.0 |
| **Total** | | | | **≈ 4 ms** of a 12 ms budget (per-entity costs here are rounded from the ÷ 1.8 projection) |

At about 0.3 ms per tick, the slice is effectively free.

**Spikes.** Two events are bursty rather than steady, and each has a budget of its own:
- **Effect bursts** (balance m10). After the capstone, Π ≈ 10⁶, and an infinite technology can complete 13–20 levels within seconds. Research effects are therefore coalesced per tick and per effect type (§5.12), so 6,000 affected machines cost one `speedEff` recompute each: ≤ 2 ms in the worst tick.
- **Autosave**: the pool copy, ≤ 100 ms (§8.4, §11).

---

## 5. Systems

Each subsection gives the data structures, the algorithm, the update cadence and the per-tick cost. Numbers marked ISO are Factorio 2.0 values. Where the design owns the number, the subsection names the spec that does.

### 5.1 The character, inventories, the hand and the crafting queue

**Movement.**
- The character has a position (`f64` tiles) and walks in 8 directions at 0.15 tiles per tick × bonuses (ISO, I §2.1).
- Collision uses the player-collision boxes (§4.4). Belts carry the character (ISO).

**State.**
- **Inventories:** the main inventory (80 slots plus bonus rows, auto-sorted by group, subgroup and order), the cursor stack ("hand"), and the origin-slot marker.
- **Quickbar:** 10 pages × 10 links, saved in the game.
- **Reach constants** (I §3.1): reach 10, build 10, resource 2.7, pickup 1.

**Hand crafting** is sim-side and exactly as I §3.9 specifies:
- chain crafting, depth-first;
- reservation at enqueue time;
- surplus shared within one request;
- merged queue entries and cascade refunds;
- a pause when the product does not fit.

**Mining by hand.** Progress = 0.5 × (1 + bonuses) ÷ `mining_time`. Mining is refused when the inventory is full (2.0.67: nothing drops).
- Targets: resource tiles, world objects (trees, rocks; `world.yaml`, §4.4), the salvage's wreck pieces and crate (`meta.start.salvage`: each piece yields `per_piece`, the crate yields `crate`, at the salvage's `mining_time`), and the player's own entities.
- **Archive keypunching by hand** (B L14, "hand-digitize") is ordinary resource mining of an Archive tile.
- **Fluid-requiring resources** (uranium ore) can be mined by hand without the fluid (ISO; U56). Drills need the fluid (§5.6).
- The campus, landmarks and town tiles are not minable; neither is a compromised entity (§5.17).

**Cost:** one character, O(1) per tick.

### 5.2 Construction: building, mining, ghosts, fast-replace, undo, blueprints and the Constructor

**`build`.** Placement rules are data-driven:
- collision masks (§4.4), including the tile's `buildable` flag: water, town tiles and out-of-map tiles refuse ordinary buildings;
- the entity's `placement` block (R3-implementability §9, gap 5): `must_be_on: exchange` (Crawler, Endpoint: the footprint's centre tile holds an exchange tap, and the tap holds no other building), `must_touch: [water, deep-water]` (offshore pump, Water exchanger: auto-oriented so that the overlay's pumping position lies on a water or deep-water tile, U9); drills need a resource under their mining area (ISO);
- the town footprint: unbuildable and indestructible (B L3). **Under towns** (U52): underground belts, pipes-to-ground and underground data lines may tunnel under town tiles, because only their two ends occupy tiles (ISO tunnel rule); power and circuit wires may span a town;
- rails and cliffs.

Failure returns a reason string from I §3.3, or the design's own (`text.yaml`).

**Fast-replace** works by `fast_replaceable_group` (I §3.3). It keeps contents, settings and wires, changes direction if the held direction differs, and returns the old item.

**Compromised entities are locked** (L3; §5.17). Mining, deconstruction, fast-replace, upgrade, and removing modules, a Researcher, accelerators or weights are all refused with the flying text "Compromised. Cut its power." (08-text §8.3). Deconstruction and upgrade marks may still be placed: agents skip the entity until it is clean, then carry out the order.

**Ghosts** are entities with `flags.ghost`, an inner prototype and a settings blob.
- Tile ghosts are separate.
- Placing the real item onto a ghost builds it with the ghost's settings.
- Ghosts of destroyed entities expire after a week (timer heap).

**Deconstruction and upgrade marks** are entity flags plus an order record.

**Undo/redo** is sim-side, per player, as I §3.11 describes:
- One undo record per action, or per drag (`drag_id`).
- Records hold inverse operations. Undone removals become ghosts (ISO).
- Rotation spam is merged per entity per 2 s.

**Blueprints.**
- A **blueprint record** is canonical data: entities with relative positions, direction, quality and settings, plus tiles, wires and parameters (2.0 parametrisation, later).
- Records live in a sim-side store, so blueprint *items* can sit in chests (the Constructor needs this).
- The library ("My blueprints", shared across saves) lives in IndexedDB outside the sim. Placing a library blueprint sends its record inside the `place_blueprint` action.
- `place_blueprint(record, pos, dir, flip, mode)` is the one code path for the player, the paste tool and the Constructor.

**The Constructor** (`deployer`; DECISIONS §19: the name for 04 §2.5's blueprint-placing building, finale-gated; A §3.3; unlocked after closure by *Self-reproducing automata*). An entity holding a blueprint or blueprint book and driven by circuit signals. Its commands (the data's `extra.circuit`):
- place blueprint N at offset (X, Y) with rotation R, as ghosts for construction agents (the `place_blueprint` path);
- deconstruct or upgrade an area (deconstruction and upgrade orders);
- copy a blueprint.

**The Area scanner** (`area-scanner`, a separate combinator-type entity unlocked by the same technology; N18) reports the resources, entities and ghosts in a rectangle set by signals, as signals: a read-only spatial query, evaluated when its input signals change and when the version of any chunk in its rectangle changes (§4.4; R5-gate D12e).

**Signal tables** (R5-gate D12e). The Constructor's commands and the Area scanner's inputs and outputs follow the Recursive Blueprints mod's tables (its deployer chest and its scanner), with Factorio's item and virtual signals mapped to ours through `mirrors` (the data's `extra.signals`). A veteran's circuit programs for the mod therefore carry over.

The Constructor is not a computing machine (its recipe holds no accelerator), so it neither throttles nor can be compromised (coherence M8, settled in the data). Nothing in the blueprint system special-cases the player, so the pair costs about 500 lines when it arrives (M4).

**Optional: Factorio blueprint import.** The 2.0 string format is version byte `0` + base64(zlib(JSON)). Every entity and recipe has a `mirrors` id, so a veteran's own Factorio 2.0 blueprints can be imported by translating names through `mirrors`. Cost is about 1 agent-day. Flagged in §14.

**Cost:** event-driven, with no per-tick cost except ghost bookkeeping on timers.

### 5.3 Belts: transport lines (FFF-176, wiki *Transport belts/Physics*)

**Geometry (ISO).**
- Positions are 1/256 tile.
- **Speed:** 8 / 16 / 24 positions per tick for yellow, fast and express (15, 30 and 45 items/s; 7.5, 15 and 22.5 per lane).
- **Saturated spacing:** 64 positions, i.e. 4 items per lane per straight tile.
- **Lane lengths:**
  - straight: 256;
  - curve inner: 106;
  - curve outer: 295;
  - underground entity: 256;
  - splitter input: 128 + 51 internal buffer;
  - splitter output: 128;
  - side-load points: 68 (late) and 188 (early) positions.
- **Calibration targets** (wiki): an underground pair across a gap of 4 holds 44 items; an express pair at maximum gap holds 72.

**Transport lines.**
- A line is a maximal chain of lane segments of the same speed with no splitter in between, **capped at 32 tiles** (configurable).
  - FFF-176 (0.16) planned lines of about 9 tiles near inserters and side-loads, and up to about 100 tiles elsewhere, with dynamic merging and splitting.
  - Our single cap keeps the worst-case position scan per pickup at 128 items (~0.3 µs) without any dynamic re-splitting.
- Each lane of a belt is in a different line. Curves therefore need no special case.
- An underground pair is one line running entrance, tunnel, exit.
- Side-loading never splits the target line. The source line's `next` points at `(targetLine, offset, lane)`.

**Data per line:**

```ts
// items are a ring buffer, front (downstream) → back
key: Uint16Array (item keys)   gap: Int16Array   // gap[0] = front slack to the line end; gap[i] = slack between item i−1 and i
len: Int32 (positions)   backSlack: Int32   count: Int32   head: Int32   activeGap: Int32 (cached first gap > 0 from front)
speed: Uint8   next: Int32 + nextOffset: Int32 + nextLane: Uint8   prevs: small list   segs: belt tiles covered (for rendering)
sleeping flag, watchers (inserters registered for arrival estimates)
```

**Per tick** (O(1) for a moving line; FFF-176):
1. **Front free** (`gap[0] ≥ speed`): `gap[0] −= speed` and `backSlack += speed`. Every item moves, and no item is touched.
2. **Front reaching the end:** try to hand the front item to `next`. End-to-end, the target needs `backSlack ≥ 64` at its entry. Side-loading needs a free gap at `nextOffset` (the wiki rule: enlarge a small gap until it is exactly big enough). On success, pop the ring head (O(1)) and append or insert downstream.
3. **Blocked:** set `gap[0] = 0` and decrement the first positive inter-item gap from the front (cached in `activeGap`, which only moves backward while compressing, FFF-176). Items in front of that gap stand still; items behind it move.
4. **Squeezed gaps:**
   - An insertion into a gap smaller than 64 makes that slack negative, as the wiki describes for drills, inserters and side-loading.
   - When the front moves again, the first negative slack grows back toward 0 before the items behind it move.
   - That is one more cached index; the update stays O(1).
5. **Sleep:** if nothing moved and the front is blocked, sleep. The downstream line wakes its `prevs` when it frees entry space.

**Splitters.**
- Four input lanes (2 belts × 2 lanes) and four output lanes; lanes are preserved (ISO).
- Per tick, each input lane offers its front item. The splitter alternates outputs per lane (a round-robin bit), honouring input and output priority and the filter.
- The internal buffers are the wiki's 128 + 51 positions.

**Inserter interaction.**
- **Pickup** asks the line for items within a position window on the preferred lane: the near lane on perpendicular belts, otherwise the left lane, per the wiki.
- An item's absolute position is a prefix sum from the front. It is computed lazily once per tick per line and only when queried (a per-line `posCacheTick`).
- **Drop** inserts on the far lane at the drop point if there is room (squeezing allowed).
- **Arrival estimates for sleeping inserters:** with the line moving, `ticks = distance ÷ speed`, scheduled on the timer wheel. The line re-arms its watchers when it stalls or restarts.

**Readers.** The circuit belt reader, including 2.0's whole-line reader, reads a cached `counts[]` per line, maintained incrementally on insert and remove. Cost: free per tick.

**Rendering extraction.** One walk per visible line, emitting `(x, y, itemKey)` per item along the segment polylines (arcs on curves).

**Cost.** About 10 ns per moving line per tick. Sleeping lines cost nothing. A transfer is about 50 ns.

### 5.4 Inserters

**Prototype numbers** (ISO; motion from the engine overlay by `mirrors`, energy from the design data):

| | Burner | Inserter | Long-handed | Fast | Bulk |
|---|---|---|---|---|---|
| Rotation (turns per tick) | 0.013 | 0.014 | 0.02 | 0.04 | 0.04 |
| Extension (tiles per tick) | 0.035 | 0.035 | 0.05 | 0.1 | 0.1 |
| Pickup → drop vector | {0, −1} → {0, 1.2} | same | {0, −2} → {0, 2.2} | {0, −1} → {0, 1.2} | same |
| Energy per movement and per rotation (`energy.per_movement_kj`, `per_rotation_kj`) | **150 kJ** (ISO 50 kJ × 3, DECISIONS §18; J4) | 5 kJ | 5 kJ | 7 kJ | 20 kJ |

Every burner energy number is ×3 like the fuel values, so the burner inserter burns ISO coal per swing. Electric inserters keep their ISO numbers, plus their drain (`energy.drain_kw`).

**State machine.** `WAIT_SOURCE → TO_PICKUP → PICKING (belt) → TO_DROP → WAIT_TARGET → DROPPING → TO_PICKUP`.
- The hand is polar: angle θ (turns) and extension *r* (tiles).
- Each tick θ moves toward its target by the rotation speed and *r* by the extension speed, both scaled by electric satisfaction. A brownout slows inserters (ISO).
- The hand arrives when both match.

**Sources and targets.**
- Resolved when the inserter is built or rotated, or when a neighbouring tile changes (a chunk-local notification). Cached as `(entity | line + position)`.
- Chest-to-chest moves the whole hand in one tick (ISO).
- An inserter takes only what the target can accept (the acceptance table, §4.5): recipe ingredients below the **insertion limit**, fuel up to 5, packs for the current research.
  - It never inserts into a staff slot (07 §6.2) and never removes from the accelerator, weights or staff slots.
  - Into a Research hall it inserts accelerators of any tier into an empty accelerator slot (or, with *Weight transplant*, a higher tier into a full hall, §5.5) and one `frontier-checkpoint` into an empty weights slot.
  - A compromised machine's rollback input accepts one item of its rollback type from an inserter whose enable condition holds (an inserter without a condition inserts too; §5.17). While a machine is compromised, an item of its rollback type goes to the rollback input before any other slot that would accept it (an Endpoint's recipe checkpoint, a Research hall's empty weights slot).

**Insertion limit** (ISO): ingredients for one craft plus the crafts completable in 1.166 s, at least 2 crafts and at most 100. Labs follow the same rule per research unit.

**Belt pickup.** The hand waits at the pickup point and grabs the first acceptable item inside the window. 2.0's "chasing" is modelled as a speed-dependent window ahead of the pickup point. Its width is calibrated so the belt-to-chest table matches the wiki to ±3% (§10.3).

**Stack bonuses** come from research (E's *Batch size 1–7*). Inserters gather successive items from a belt up to their hand capacity, as in Factorio. The exact waiting behaviour of bulk inserters is calibrated against the wiki's bulk rows in G6 rather than assumed.

**Later (P2):** 5 filter slots, whitelist or blacklist, the stack-size override and circuit conditions.

**Throughput goldens** (wiki, 2.0.26, stack 1, chest to chest): burner 0.79, inserter 0.86, long-handed 1.25, fast 2.5, bulk 2.5 items/s. Belt to chest is in §10.3.

**Cost.** About 25 ns per active inserter per tick, plus about 300 ns per pickup or drop.

### 5.5 Crafting machines, furnaces and labs

**Per-tick progress.** For a crafting machine:

```
progress += baseSpeed × qualityMult × max(0.2, 1 + Σ own-module speed + S_speed) × energySat × m × collapse
            ÷ (recipeTime × 60)
S_e      = (1/√n) × Σ_s  eff_s × m_s × E_s(e)      // Switch contribution to effect e: speed or consumption
                                                    // n = Switches reaching this machine; eff_s = 1.5 + 0.2 × quality level (§5.16);
                                                    // m_s = that Switch's own throttle (§5.9); E_s = its modules' effect e
```

- **energySat** is buffer ÷ need, from §5.7 (fuel for burner machines).
- **qualityMult** is the entity's quality crafting-speed factor (§5.16).
- **max(0.2, …)**: the total speed bonus is floored at −80% (ISO 2.0).
- **m** is the thermal throttle. It applies only to `computing` machines (§5.9); elsewhere m = 1.
- **collapse** is model collapse (DECISIONS §31, with its accuracy refinement): 1 − σ·c before *Synthetic detection* for the recipes listed in `meta.world.model_collapse.applies_to` (Checkpoint and Post-training payload; 03 §2.2), where c is the Site's crawl share (§5.11). It is 1 after *Synthetic detection* and for every other recipe.
- The product of every multiplier except the electric satisfaction is cached in `speedEff`. It is recomputed on events: a module change, a Switch built or removed or changing modules, a Switch's throttle changing (§5.9), a bonus, a thermal update of its own chunk, a staffing update, a change of σ or of the crawl share c for machines running a text-trained recipe.
- **Several crafts per tick** are allowed while ingredients and output space last (FFF-402).
- **Productivity** (DECISIONS §30). Only recipes with `allow_productivity: true` take productivity: from modules, from research (`recipe-productivity` names its recipes) and from the entity's base bonus.
  - `prodBar += productivity` per craft, and an extra craft's products appear at ≥ 1 (deterministic, ISO). Catalyst amounts are excluded. Total productivity is capped at +300% (ISO 2.0).
  - ISO 2.0 refusals: a module with a productivity effect cannot be inserted into a machine whose recipe disallows productivity, and such a recipe cannot be set while one is installed.
  - *Nanofabrication* names only the base accelerator recipe (DECISIONS §30, balance B1).
- **Energy draw** = base draw × max(0.2, 1 + Σ consumption effects of own modules + S_consumption + the `computing-energy` bonus where §5.7 applies it) + drain.

**Switches (beacons).**
- Transmission 1.5 (scaled by the Switch's quality, §5.16), with the 2.0 *profile*: the effect of *n* Switches is scaled by 1/√n (FFF-409; D's Switch). Only speed and consumption effects travel: quality and productivity modules never go into a Switch (ISO).
- Supply area 9×9. A machine is reached when its footprint overlaps the supply area (ISO beacon test; U36).
- **Receivers.** An entity takes Switch effects only if its `effect_receiver.uses_beacon_effects` is true, and only the effects in its `allowed_effects`. Research halls take none (DECISIONS §25); the cooling tower takes consumption only (J20).
- **Thermal** (DECISIONS §26). A Switch is a computing machine with a thermal class of its own (03 §1.3; `meta.heat.classes`). Its transmitted effects are multiplied by its throttle m_s; its draw is unchanged.
- **Compromised** (§5.17). A compromised Switch transmits nothing, but it still draws full power.
- A Switch registers with the machines it covers. Their `speedEff` is invalidated when the Switch is built, removed, changes modules, changes m_s, or is compromised or cleaned.

**Recipes and output.**
- **Probabilistic products** use counter RNG (§4.3).
- **Products that depend on the world** (03 §2.1: the refinery's Deduplication and Quality filtering yield more junk as j rises).
  - Their amounts are the recipe's `amounts_by_j` expressions, compiled by the data stage (§2.4).
  - The amounts are recomputed into a cached table whenever j changes (every 60 ticks). A cycle uses the table at its completion (03 §2.1). Stream amounts may be fractional, because fluids are `float64` (§4.2).
- **Output full:** a craft does not start when its products would not fit in the result slots, one stack per product (ISO; the golden tests confirm the edge cases against Factorio, including results larger than a stack).
- **Furnaces** choose their recipe from the input item (ISO).
- **Fluid ingredients and results** go through the machine's fluid boxes (§5.8).
- **Recipe quality** (L5). A machine crafts its recipe at a selected quality, as in 2.0. Every ingredient, a catalyst included, must have that quality (§5.16).

**Labs (Seminars).** Per tick:

```
units = labSpeed × qualityMult × (1 + labBonus) × max(0.2, 1 + Σ own-module speed + S_speed) × staff × e × m_h
        ÷ (unitTime × 60)                          // lab-speed research multiplies, as in Factorio (04 §3.2)
research progress = units × Π × (1 − h)
papers consumed   = units            before Interpretability
                  = units × (1 − h)  after Interpretability (03 §4)
```

- Packs drain per unit consumed (ISO durability).
- **staff** is the network satisfaction s from §5.10, or 1 with a Researcher.
- **e** is the electric satisfaction. Without a Researcher it is the normal-class satisfaction. With one it is min(sat_normal, u_p), where u_p is the network's compute satisfaction (§5.7; U5).
- **m_h** is 1 without a Researcher. With one, the whole Seminar throttles as an Accelerator-class machine (T\* 25 °C; 03 §1.3), because the Researcher does the work.
- **Π** is research per paper (04 §0): `m^k × (1 + 0.1·L_rp) × (1 + Seminar productivity)`. Here k is the number of *Model generation* levels researched and m = 1.5^r comes from the world setting *Returns to research* (J14). The product is cached per level (§5.12).
- **h** is the hollow-work share (03 §4). It applies only when a Researcher staffs the Seminar.
- **Staff demand** (DECISIONS §23a) is the Seminar's working fraction × its speed factor (§5.10). A Researcher sets it to 0.
- **The staff slot** (DECISIONS §7, 01 §8.6) is a slot type beside the module slots. It accepts only the Researcher, by hand, fast transfer or an agent's item request; inserters never fill it (07 §6.2). With a Researcher in the slot:
  - the Seminar counts as fully staffed (`staff = 1`) and demands nothing (§5.10);
  - it is an Accelerator-class computing machine (m_h), a tier-4 deploying building (§5.17), and it may do hollow work;
  - the Researcher's **500 kW** is interruptible load (§5.7), demanded only while the Seminar is working (U5). Only `compute-energy-floor` (*Energy per operation*) scales it: neither the Seminar's modules nor *Dennard scaling* do (balance m9; 03 §1.4). The Seminar's base 60 kW stays normal load, scaled by its modules and Switches as ISO;
  - the entity holds two energy sub-buffers. A shortfall of compute power slows only Researcher-staffed Seminars. Its status reads **Low power** with the tooltip line "Compute is supplied last." while u_p < 1, and **No power** at u_p = 0 (J19).
- **Lab-to-lab pack passing** by inserters is ISO.

**Research halls** (04 §2.3; L1; DECISIONS §25). A 7×7 crafting machine:
- `computing` (Accelerator class), with `energy.priority: interruptible` (§5.7). **No module slots, and no Switch effects** (`effect_receiver` uses neither): its speed is its accelerators' tier, so power and heat brake the takeoff.
- **Inventories:**
  - 20 single-item **accelerator slots** (`extra.accelerator_slots`);
  - 1 **weights slot** for a `frontier-checkpoint` (`extra.weights_slots`), loaded and never consumed;
  - the recipe's input (Datasets);
  - an **output inventory**. It holds the System cards, and also the accelerators that *Weight transplant* swaps out (`extra.output_returns_accelerators`).
- **Loading.** Inserters insert accelerators of any tier into empty accelerator slots, and one frontier checkpoint into an empty weights slot. They never remove either. Construction agents deliver both as item requests (the module-request path). Hand transfer works both ways, except while the hall is locked (below) or compromised (§5.17).
- **Runs only fully loaded:** 20 accelerators and a weights item. Otherwise it stays idle on its drain, with the status **Missing accelerators** (tooltip line "Loaded: n / 20") or **No weights** (both red; 08-text §8.2).
  - **Drain** (R5-gate engine rule): Σ over the loaded slots of `extra.tiers[i].drain_kw` ÷ 20, an empty slot counting 0, so an empty hall draws nothing. Like every drain it is normal load (§5.7), drawn whenever the hall is not running; a running hall's draw already includes it.
  - **Interruptible demand** is counted only for a hall that is running (it has a Dataset, room for its card and power), as for the Researcher's 500 kW (04 §3.1).
  - **Output inventory:** five slots, one for System cards and one per accelerator tier (the swapped-out accelerators of *Weight transplant*); a full slot blocks the hall (output full, ISO) or refuses the swap.
  - **Input inventory:** the recipe's Datasets, with Factorio's insertion limit (§5.4).
- **Mixed tiers** (L1): speed = Σᵢ s(tierᵢ) ÷ 20 and power = Σᵢ p(tierᵢ) ÷ 20, with s and p from `extra.tiers` (1/3/8/20 at 5/8/12/16 MW). The GUI's "Tier" shows the lowest loaded tier.
- **Without *Weight transplant*:** a full accelerator inventory is locked, with no insertion and no hand removal; an insertion is refused with "Needs Weight transplant" (08-text §8.3). Mining the hall returns everything (04 §2.3).
- **With *Weight transplant*:** an accelerator of a higher tier than the lowest loaded one, inserted into a full hall, replaces that lowest one (ties: the lowest slot index) with the flying text "Swapped". The replaced accelerator goes to the output inventory, where inserters can take it.
  - An accelerator of the lowest loaded tier or below is refused.
  - So is any swap while the output inventory has no room for the old accelerator.
- **Quality** (L1). The quality of loaded accelerators is ignored, and the hall entity's own quality applies as for any crafting machine (§5.16). The weights item's quality sets v for the leak (03 §3.1).
- **Recipe:** *Research run*, 1 Dataset → 1 System card, 60 s at speed 1.
- **Power** = (Σᵢ p(tierᵢ) ÷ 20) × the `hall-energy` multipliers (*Sparse inference* ×0.75, halls only; U17) × the `compute-energy-floor` factor (*Energy per operation*) × 2 in test-time mode. *Dennard scaling* does not apply: accelerators are post-Dennard (03 §1.4). The hall takes u_p of it (§5.7), and it draws full power while throttled.
- **Test-time compute mode.** A per-entity flag, set in the GUI or by a circuit condition, that exists once the `hall-mode` effect is researched (*Test-time compute*). It multiplies speed by (1 + `output`) and power by (1 + `energy`): ×1.5 and ×2 with the data's 0.5 and 1.0. It folds into `speedEff` and the energy demand.
- **The closure event** (DECISIONS amendment 16). The first System card written by any Research hall fires `loopClosed` once. It is the hook for the "Loop closed" log line, the log-scale graphs, the doubling-time readout, the overhang snapshot (§5.20) and the achievements timed from closure. The same craft completes the hidden trigger technology *Loop closed* (its craft-recipe trigger on `research-run`, §5.12), which makes *Model generation* and the takeoff hardware available (R5-gate D9).

**The Frontier cluster** (04 §2.1, 07 §13.1; ISO with the rocket silo; R5-gate engine rules). A 9×9 crafting machine of the Accelerator class (T\* 25 °C) with 4 module slots, drawing `energy.kw` (3,990 kW) while it crafts and `extra.idle_kw` (250 kW) otherwise.
- **Shards.** Its only craftable recipe is *Run shard* (category `frontier-run`). A completed shard never leaves the cluster (ISO: rocket parts): it adds 1 to the cluster's shard counter, and its productivity bar (*Self-play*, *Algorithmic progress*, modules) adds more. Heat throttles shard crafting with m; the launch never throttles (U14).
- **Payload slot.** One slot that accepts a `post-training-payload` or a `final-report`, from the hand, fast transfer, inserters or agents.
- **Launch.** When the counter reaches `extra.parts_required` (100): with a payload in the slot the launch starts by itself; with an empty slot it starts only from the GUI's button (`launch_empty`, Appendix B). A launch takes the pseudo-recipe's time (1 s), consumes the 100 shards and the payload, and cannot be cancelled.
- **Completion** writes the products of the matching pseudo-recipe into the cluster's output inventory: `launch` (a Post-training payload) → its System cards × (1 + Σ `system-cards-per-run`) (1,000, or 1,500 after *Chain of thought*; not productivity) and 1 frontier checkpoint; `launch-empty` → 1 frontier checkpoint; `launch-final` → the same as `launch`, then victory (`victory: true`) and the run report (§5.20). A full output inventory holds the next launch (ISO).
- **Events.** A completed `launch` fires the `launch` trigger (*In-context learning*) and the first-run panel (07 §13.2); the empty launch triggers nothing; each completion writes 08 §8.4's log lines.
- **Compromise** (§5.17). Like any compromised machine it freezes: no shard crafting and no launch until it is clean.

**Status.** Every entity exposes a `status` code (`uint8`) from Factorio's `entity_status` vocabulary (I §3.12) plus ours:

| Status | LED |
|---|---|
| working, normal, **working (Researcher)**, **working (linked)** (Terminal), **watching** and **cleaning** (Monitor) | green |
| low power (for interruptible load, with the tooltip line "Compute is supplied last."), low input fluid (a cooling tower without water included), charging, **understaffed**, **throttled by heat**, **no hot coolant** (dry cooler, water exchanger), **not linked** (Terminal) | yellow |
| no power, no fuel, not plugged in, no recipe, item or fluid ingredient shortage, output full, waiting for source items, waiting for space in destination, no minable resources, missing science packs, no research in progress, marked for deconstruction, disabled by control behaviour, pipeline overextended, **no staff**, **closed to crawlers**, **compromised**, **missing accelerators**, **no weights**, **no evaluation sets** (Monitor), **no university in range** (Terminal) | red |

- Display strings are 08-text §8.2's, held in `game/locale/en.yaml` (§2.2); the internal codes above are not display text (the Terminal's *working (linked)* displays "Working"). The status rides in the chunk view (§3.4).
- It feeds the GUI LED, world warning icons, and the **status-light layer** (07-ui §16.2). That layer is an 8 px dot per machine in alt-mode, with its own colour mapping: output full is yellow there, and statuses that already have a warning icon get no dot.

**Cost.** About 20 ns per active machine per tick, plus about 0.5 µs per completed craft.

### 5.6 Mining and resources (ores, archives, exchanges)

**Resource tiles** are stored per chunk as a sparse map: tile → (resource prototype, amount `uint32`).

**Mining drills.**
- The mining area, `resource_searching_radius` and output vector come from the overlay (ISO: electric 5×5, burner 2×2).
- `progress += miningSpeed × qualityMult × max(0.2, 1 + Σ own-module speed + S_speed) × energySat ÷ (miningTime × 60)`. Each completion depletes one unit and outputs one item; productivity (mining-productivity research, modules) fills a separate deterministic bar, and each full bar outputs one more item without depleting the patch (ISO; 01 §7.2).
- Each completion takes one unit from the area's tiles, round-robin in row-major order, skipping empty tiles. One item goes to the drop target: a belt lane at the drop point, an entity's inventory, or the ground.
- **Uranium-type resources** need fluid (`requires_fluid`) from the drill's fluid box. Hand-mining needs none (§5.1).

**Archives** (Records; B L3). An ordinary finite ore, generated at a town's library or as a records store (§5.18). Its σ = 0 forever is a rule about the world's text, not item state: records and the tokens made from them carry no provenance (§14 #7).

**Exchanges** (the Crawl; D §4, 01 §7).
- **The tap's state** is a resource point holding the backlog A (300,000 = 100%), the town's writing floor *f*, the closure threshold σ_c, and the flag `closed`.
- **Yield:** `y = max(A ÷ 300,000, F(W))` with `F(W) = f × max(1, 2^((W − 40)/20))`.
  - `2^x` comes from the engine's deterministic `detmath.exp2` (§4.1), never `Math.pow`.
  - Output = 10 units/s × y × speed × (1 + productivity) × D_syn, where D_syn = 1 − σ after *Synthetic detection* and 1 before (03 §2.2).
  - Each cycle removes 10 from A while A ÷ 300,000 is above F(W) (ISO depletion; productivity output does not deplete).
  - The floor F(W) replaces Factorio's minimum yield: the engine never reads a `min_yield` on the exchange (01 §13).
- **One building per tap:** a **Crawler** (a pumpjack-type extractor) or an **Endpoint** (a crafting machine with `placement: {must_be_on: exchange}`, 03 §2.4). Crawl leaves through a data-line box (§5.8).
- **Closing.** When σ ≥ σ_c, the tap flags `closed` for good, and its Crawler shows *closed to crawlers*. Endpoints keep working.

**Cost:** about 20 ns per active drill.

### 5.7 Energy: burners, electric networks, generators, the day cycle and nuclear heat

**Burner energy sources.**
- A fuel inventory with fuel categories, a burning item, and an energy buffer.
- Every fuel value and every burner consumption is 3× Factorio's (DECISIONS §18, kept by §24), so item flows stay ISO and thermal plants run at η ≈ 33%.
- A burner machine emits the fuel it burns as heat into its chunk (B L4; §5.9). A boiler emits nothing: under DECISIONS §24 its loss is emitted where the steam becomes electricity.
- Burner inserters refuel themselves from fuel they handle (ISO).

**Electric networks.**
- **Topology.** Poles connect by copper wires: the auto-connect rule (I §3.4, "no common neighbour") or manual wiring. A network is a connected component of poles, rebuilt in the affected component on removal and union-merged on addition.
- **Attachment.** An entity attaches to every network whose supply area covers any of its tiles. Usually that is one, but more are supported (FFF-421). The buffer is shared, and networks fill it in network order.
- **Power switches** join or split networks; the networks are rebuilt.
- **Drains** are design data (`energy.drain_kw`, ISO values; N30). They are normal load and are emitted as heat like any draw.
- **Per-tick algorithm** (memory-bound by nature, FFF-421):
  - **Grouping.** Consumers are grouped by prototype inside each network (FFF-209), so flow limits are read once per group.
  - **Demand classes:**
    1. **normal** (Factorio's secondary input, drains included);
    2. **accumulator charging** (Factorio's tertiary input);
    3. **interruptible** (G's BEND, G §2.6; 04 §3.3): Research halls and the Researcher's 500 kW. Data: `energy.priority: interruptible`.
  - **Generation:**
    1. solar (primary): 60 kW × daylight(t) × s, with s the sunlight of the panel's chunk (01 §3);
    2. steam engines, steam turbines and fusion generators (secondary): shared in proportion, each limited by the steam or plasma in its fluid box;
    3. accumulator discharge (tertiary).
  - **Allocation** (U16; 04 §3.1). Let G be the primary and secondary generation available this tick, D_n the normal demand, D_c the accumulators' charge room (capped by their flow rate), D_i the interruptible demand and A the accumulators' discharge capacity this tick.
    - **If G ≥ D_n:** normal is served in full. Accumulators charge with c = min(G − D_n, D_c). Interruptible load gets min(D_i, G − D_n − c). No accumulator discharges this tick.
    - **If G < D_n:** accumulators discharge d = min(A, D_n − G + D_i), serving normal first and interruptible second. No accumulator charges this tick.
    - So accumulators never charge and discharge in one tick. The normal satisfaction is min(1, (G + d) ÷ D_n). The **compute satisfaction** is u_p = (interruptible energy served) ÷ D_i, which is 04 §3.1's formula with P_available = G + d.
    - A shortfall slows compute before it slows the factory, and a solar base that runs Research halls still charges its accumulators by day.
  - **Fill.** Each consumer's buffer gains `deficit × satisfaction(class)`. Generators consume steam or plasma in proportion to the energy they deliver. Steam's energy per unit is (T − 15 °C) × `heat_capacity_kj_per_k` (0.2 kJ/K for water and steam; J3). 30 steam/s at 165 °C therefore give 900 kW, and 60/s at 500 °C give 5,820 kW.
  - **Emission.** Every consumer's drawn energy, and **twice every generator's delivered electrical energy**, go into the chunk emission accumulators (§5.9; DECISIONS §24).
  - **Statistics** per network and per entity prototype feed the electric network GUI (I §4.16). The compute satisfaction u_p goes on the power tooltip (G).
- **Energy effects on computing machines** (U17, U18; 03 §1.4, 04 §5, §10):
  - `computing-energy` (*Dennard scaling*, −8% per level) is added to the consumption effects of modules and Switches on every computing machine of the tube, computer, network (the Switch's) and cluster classes. The total consumption bonus is floored at −80% (ISO). It does not apply to the Accelerator class (Research halls, the Frontier cluster, the Researcher's 500 kW): accelerators are post-Dennard (03 §1.4). Nor does it apply to a Seminar's base 60 kW.
  - `hall-energy` (*Sparse inference*, ×0.75) multiplies the draw of Research halls only.
  - `compute-energy-floor` (*Energy per operation*) multiplies the draw of Research halls and Researchers by f + (1 − f) × 0.9^L, with f = θ_K ÷ `floor_temperature_k` (4,800 K) at the entity's own chunk (04 §10). 0.9^L is repeated multiplication (§4.1). It is the only effect on the Researcher's 500 kW.
- **The day cycle** (ISO; P7).
  - 25,000 ticks per day. Daylight is piecewise linear in the day fraction t, where t = 0 is noon: 1 until dusk (0.25), falling to 0 at evening (0.45), 0 until morning (0.55), rising to 1 at dawn (0.75). That gives the 70% solar average.
  - The renderer's ambient light reads the same table with a floor of 0.15 (Factorio's minimum brightness).
  - Sunlight s(y) is evaluated at the chunk centre, like θ (P8).
- **Nuclear (heat-pipe networks).**
  - Reactors (the neighbour bonus, ISO), heat pipes and heat exchangers each hold a temperature (500–1,000 °C, ISO).
  - Conduction per tick between neighbours is proportional to the temperature difference, up to the prototype's maximum transfer.
  - A heat exchanger turns `extra.water_per_s` (10.309/s) of water into ten times as much 500 °C steam (103.09/s; J3).
  - **Emission** (DECISIONS §24). Reactors, heat pipes and heat exchangers emit no conversion heat. The plant's loss appears at its turbines, twice their output (§5.9).
  - **Waste heat** (03 §1.1). A fission reactor at its 1,000 °C maximum keeps burning fuel (ISO). The heat it generates but can neither pass on nor store is emitted into its own chunk.
  - In code this is `heatNet`, kept apart from the thermal field (§5.9) to avoid the name clash.
- **Fusion.** The fusion reactor burns fusion power cells (fuel ×3, §24) into plasma. It emits no conversion heat; its own electric draw (`extra.electric_kw`) is emitted like any draw. Fusion generators turn plasma into electricity and emit twice their output.
  - **Plasma** (R5-gate D12d) carries `plasma_mw` ÷ `plasma_per_s` = 25 MJ per unit, the energy the generators draw from it (the validator checks the generator's `max_kw` and `plasma_per_s` against it).
  - **Neighbour bonus**, as in Space Age: each adjacent active reactor multiplies a reactor's plasma output by (1 + `neighbor_bonus`) without burning more fuel. The extra energy appears as heat only where every plant's loss does, at the generators (2 × their output).

**Cost:** about 12 ns per consumer per tick over two passes; generators and accumulators similar.

### 5.8 Fluids (Factorio 2.0 segments) and the data-fluid network

**Fluid boxes.** Every fluid-capable entity has fluid boxes, each with:
- a capacity (pipe 100; storage tank and Data lake 25,000);
- connections: position, direction, flow type (input, output, input-output) and **connection category**;
- one fluid filter or fluid, and a temperature.

**Segments** (FFF-416).
- A segment is a connected component of pipes, pipes-to-ground and tanks of one category and one fluid.
- Its capacity is the sum of its boxes, and it holds one amount and one temperature (weighted on mixing).
- Pipes cost nothing per tick.
- A build or removal re-segments the affected component, by BFS bounded to that component.
- Building that would connect two different fluids is refused with "Would mix fluids" (ISO).

**Per-tick boundary flows** (FFF-430). For each machine box ↔ segment connection, pump and offshore pump:

```
flow = min(available, room, 100 × fill(source) × (1 − fill(sink)))      // 100 units per operation = 6,000/s cap
```

This is our reading of FFF-430: the input rate is proportional to the source's fullness, the output rate falls as the sink fills, and both scale the 100-unit cap. G13 calibrates it against 2.0's observable behaviour: even sharing and the equilibrium fill level.

- **Pumps** move up to 1,200 units/s (20 per tick) between two segments, also scaled by fullness.
- **Fluid wagons** are exempt from the ratio (ISO).
- Machines update in pool order. The first-updated machine gets a slightly larger share, as in 2.0.

**Rules (ISO).**
- **Pipeline extents.** A segment whose bounding box exceeds 250×250 tiles carries no flow and raises the alert *pipeline overextended*.
- **Steam** (J3). A boiler turns its `extra.water_per_s` (6/s) of water into ten times as much steam at 165 °C (60/s; 2.0's 1 : 10). A heat exchanger turns 10.309/s into 103.09/s at 500 °C. Steam's energy per unit comes from the fluids' `heat_capacity_kj_per_k` (§5.7).
- **Offshore pump:** 1,200/s.
- **Underground pipe:** maximum gap 9.

**Data lines** (D §4.4) are the same engine with `category: data`.
- Data line, underground line, Repeater (pump) and Data lake (tank) carry Crawl, Junk, Text and Prose.
- Pipes have `category: default`. A data line never connects to a pipe because categories never intersect. Factorio 2.0 itself has `connection_category`, so this needs no new mechanism.
- **Data networks** (for runaway links, §5.17, and for Terminals, §5.10) are the components formed by data segments joined through Repeaters, plus every machine with a box on them. A machine with several data boxes joins their networks.

**Coolant** (03 §1.4) is an ordinary fluid in pipes (category `default`) with temperatures.
- **Temperature filters** (J20; U48). A machine's coolant input accepts coolant at or below `meta.heat.coolant.machine_takes_at_or_below_c` (35 °C) and returns it at `machine_returns_c` (50 °C). A cooler's input accepts coolant at or above its `heat.coolant_in_min_c` (45 °C) and returns it at its `heat.coolant_out_c` (30 °C).
- A segment whose temperature lies outside a box's range does not flow into that box. The machine's q then falls and its heat goes to the air (§5.9). A cooler shows **No hot coolant**.
- **Mixing.** A segment holds one temperature, the weighted mean on mixing (ISO), so a loop that mixes hot and cold coolant can fall outside both ranges. Hot and cold loops therefore need separate pipes, as steam at 165 °C and at 500 °C does in Factorio.
- New coolant starts at 30 °C (`default_temperature`; P28).
- The three port glyphs of 07-ui §8.3 (pipe, data line, coolant) come from each box's category and fluid filter. Wrong connections are refused by the ordinary mixing rule.

**Barrels and drives** use generated fill and empty recipes (§2.4).

**Cost:** about 30 ns per active boundary connection per tick. Pipes are free.

### 5.9 The thermal field ("Heat"; 03 §1, from F §1.1)

**Data per chunk:**
- `H` (MJ);
- an emission accumulator (J this window);
- an incoming-diffusion accumulator;
- `κ` (s⁻¹): the mean `kappa_per_s` of the chunk's 1,024 tiles (`tiles.yaml`), plus `meta.heat.loss.per_tree_per_s` × (leaf stages left ÷ 4) for each tree. It is recomputed when a tile or a tree changes;
- `θ`, the static ambient temperature from worldgen (01 §3: `clamp(14 + y/80 + n(x, y), −15, 35)` °C at the chunk centre; the noise is P9's, §5.18);
- `leafTimer`, seconds spent above the tree-damage temperature (U11);
- the cached temperature `T = θ + H ÷ C`, with C = `meta.heat.chunk_heat_capacity_mj_per_k` (20 MJ/K).

All numbers are 03 §1's and the data's. The golden reference is `tools/ref/heat_calib3.py`, a verbatim copy of F's `calib3.py`, which implements 03 §1.2's update exactly (G15).

**The chunk of an entity** (U8) is the chunk that holds its geometric centre: (⌊x2 ÷ 64⌋, ⌊y2 ÷ 64⌋) in the doubled coordinates of §4.2. An even-sized entity centred exactly on a chunk line therefore belongs to the east or south chunk. The same chunk is used for emission, for the throttle and for a cooler's sink. A 9×9 or 7×7 building emits into one chunk; 03 §1.1 accepts the simplification so that chunk borders give no exploit.

**Emission** (B L4; 03 §1.1; DECISIONS §24). The entity's `heat.emission` decides, with the default following its energy source:

| Emitter | Heat into its chunk | Booked in |
|---|---|---|
| Electric consumers (default) | Their *drawn* energy, drains included. Interruptible load therefore emits u_p × its draw, automatically | Phase 4 |
| Burner machines (default): furnaces, burner drills and inserters, Keypunches, vehicles | Their whole fuel burn | Phase 6 |
| `emission: twice-output`: steam engines, steam turbines, fusion generators | 2 × the electrical energy they deliver | Phase 4 |
| `emission: none`: boilers, heat exchangers, fission and fusion reactors, heat pipes | Nothing. The plant's loss is emitted at its generators. A fusion reactor's own electric draw is still emitted, like any draw | — |
| A fission reactor at its 1,000 °C maximum (`waste_heat: true`) | The heat it generates but can neither pass on nor store (waste heat, 03 §1.1) | Phase 6 |
| Solar panels, accumulators | Nothing | — |

- Item flows stay ISO: fuel items per minute are unchanged, because fuel values and burner consumption are both ×3 (DECISIONS §18, §24). A boiler at full load burns 5.4 MW for 1.8 MW of steam, and its two steam engines emit 2 × 0.9 MW: the plant emits F's 3.6 MW per boiler, at the engines.
- **Liquid-cooled machines** (03 §1.4). A share ℓ of the draw (0.7, or 0.9 after *Immersion cooling*) goes into the coolant box as heated coolant, 1 unit per MJ, in proportion to the coolant actually received.
  - **Seminars** (R5-gate D12g) have the box from *Liquid cooling* whatever the staff slot holds, because a fluid box belongs to the prototype; it needs ℓ × the Researcher's 500 kW while a Researcher is installed, and nothing otherwise (q = 1).
  - With q = received ÷ needed (needed = ℓ × the draw, at 1 coolant unit per MJ), the air gets `draw × (1 − ℓ·q)` each tick. The throttle's T\*_eff (step 6) uses q over the ticks since the chunk's last update (Σ received ÷ Σ needed). q is clamped to [0, 1], and q = 1 when nothing was needed.
  - Dry coolers take hot coolant and emit its heat into their own chunk's air. Water exchangers emit it into the chunk of the water tile at their pumping position (U9). Both work up to their capacity × Π `multiplier` × (1 + Σ `value`) over the `cooling-capacity` effects whose `entities` list them (×2 each from *Two-phase* and *Microfluidic cooling*, +10% per *Thermal management* level).

**Update** (Factorio's cadence: each chunk once every 64 ticks, in bucket `chunkIndex & 63`; Δt = 64/60 s). The order is 03 §1.2's:
1. **Emission.** `H += emissions + incoming`. Clear both accumulators.
2. **Diffusion.** If `H ≥ 15 MJ`, move 2% of H to each of the 4 neighbours' incoming accumulators (U10):
   - to an **ungenerated** neighbour, the share leaves the field and is booked under the **Map edge** sink;
   - to a neighbour **outside the map bounds** (§5.18), the share is not sent: the edge reflects.
3. **Newton cooling.** `H −= (κ·H + 0.002 MJ/s) × Δt` (F's κ·H + 2 kW).
4. **Active sinks.** Each cooling tower in the chunk removes up to its capacity × Π `multiplier` × (1 + Σ `value`) of the `cooling-capacity` effects that list it, × Δt: the full rate at ΔT ≥ 5 K, linear below it, where ΔT = H ÷ C as it stands after step 3 (the golden script's order). It consumes `water_per_mj` of water per MJ removed. A tower without water removes nothing and reads *Low input fluid*.
5. **Clamp.** H never falls below 0. Removals are applied in order (Newton, then each tower in pool order), and each is limited to the H that remains, so the statistics book the actual removal, not the computed one (U12).
6. **Effects.** Recompute `T`. Notify the chunk's **computing** machines, which recompute `m = clamp(1 − (T − T*_eff) ÷ 50 K, 0.5, 1)` and their `speedEff`.
   - `T*_eff = T* + 15 K × q`, with T\* by thermal class from `meta.heat.classes` (03 §1.3).
   - **Switches** (DECISIONS §26) are computing machines of their own class. A new m_s rescales their transmitted effects and invalidates their receivers' `speedEff` (§5.5).
   - **The Frontier cluster** throttles its run-shard crafting; the launch itself never throttles (U14).
   - A throttled machine is still *working*, for the leak and for staffing (U15).
   - Throttling never changes the power draw.
7. **Trees** (U11). While T > `meta.heat.tree_damage_c` (45 °C), `leafTimer += Δt`. Each time it reaches `meta.heat.loss.leaf_stage_s` (600 s), every tree in the chunk loses one of its 4 leaf stages and the timer drops by 600 s. When T ≤ 45 °C the timer resets to 0. A leaf change recomputes κ and clears the chunk's pristine flag. No RNG is involved.

**Overlay and statistics.**
- The packet carries `T` for visible chunks while the overlay is on: the map view and the minimap in alt-mode (I §3.14, §4.11).
- **The statistics tab *Heat*** books every emission by source category. Coolers' emissions get rows of their own. Every removal is booked by sink: terrain (Newton, the 2 kW floor included, split among the terrain classes, which are the rows of 03 §1.2's κ table, and trees, in proportion to each one's share of the chunk's κ), cooling towers, and the Map edge. Dry coolers and Water exchangers are sources, not sinks: the coolant heat they reject enters the field.
- Production minus removal equals the change in stored H, which is what UI-G9 checks.

**Map setting** "Heat: off" (03 §1.9) disables the field and all throttling. θ is still computed for biomes, solar and the overlay's ambient-only view. Cooling buildings stay buildable and inert.

**The four anti-cascade guards** (03 §1.5) are engine invariants with tests:
- throttling never changes power draw;
- the throttle floor is 0.5;
- nothing is damaged by heat;
- cooling buildings, power plants, mechanical machines and logistics never throttle.

**Cost:** under 0.01 ms per tick for 4,096 chunks.

### 5.10 The staffing network (B L9, DECISIONS §7, §23)

The rules are 01 §8's; the numbers are `meta.staffing`'s.

**Sources.** Each university (a town's 8×8 campus: a world object, not a built entity) supplies T(W) staff-equivalents (01 §8.1), with T₀ by town class.
- **Where the universities are** (U4). Campus positions come from the pure town function (§5.18), so a campus counts whether or not its chunk has been generated.
- **Identity.** A university's id is its town cell key (§5.18), encoded like a chunk key: (rx + 2¹⁵) × 2¹⁶ + (ry + 2¹⁵) for town cell (rx, ry). It is stable across saves, orders ties and picks the network hue (lowest id).

**Coverage** (U3). Let the campus occupy tiles [x₀, x₀ + 8) × [y₀, y₀ + 8), and let R be the commuting radius (48 tiles, ×1.5 per `staffing-radius` effect: 72, then 108).
- A Seminar with centre (cₓ, c_y) is covered iff x₀ − R ≤ cₓ < x₀ + 8 + R and y₀ − R ≤ c_y < y₀ + 8 + R.
- A Seminar is 3×3, so its centre is a half-integer and never lies on an edge.
- The overlay draws exactly this predicate (07-ui UI-G5).

**Demand** (DECISIONS §23a; U1):

```
demand_i = w_i × max(0.2, 1 + Σ own-module speed + S_speed)        // S_speed: §5.5, Switch throttles included
```

- **w_i** is the fraction of the last 60 ticks in which Seminar i had a research job, the papers for its current unit (or a unit in progress), electric satisfaction > 0, and was not compromised. A per-Seminar tick counter holds it, and it is saved.
- Lab-speed research bonuses are free: they raise output without raising demand.
- A Seminar with a Researcher demands 0 and has staff = 1.
- The Seminar GUI shows the value ("Staff demand 2.4", 07-ui §6.1).

**Staffing networks** (U2; DECISIONS §23d and 01 §8.9: the Terminal). The graph's nodes are universities, covered Seminars (in any state: idle, unpowered or holding a Researcher) and Terminals. Its edges:
- **university–Seminar**, when the university covers the Seminar;
- **university–Terminal**, when the Terminal's centre lies in that university's coverage (same predicate);
- **Terminal–Terminal**, when both sit on the same data-line network (§5.8) and both have electric satisfaction > 0 at the recompute tick.

A staffing network is a connected component that contains at least one Seminar. A pair of Terminals on one data line therefore joins a distant university to the home network, the way a long wire joins two power networks. Terminals are not susceptible and are not a runaway link of their own: the data-line network they sit on links whatever susceptible machines are on it (03 §3.3).

**Satisfaction.** For each network, `s = min(1, ΣT ÷ Σdemand)`, and s = 1 when the demand is 0. Each member Seminar gets `staff = s`. An uncovered Seminar without a Researcher gets 0 and the status *No staff*.

**Terminal statuses** come from the last recompute: *Working (linked)*, *Not linked*, *No university in range* or *No power* (the data's `terminal.extra.statuses`).

**Recompute** every 60 ticks, in phase 13 (§4.6). Both the graph (union-find over universities, covered Seminars and Terminals) and the sums are rebuilt then. Terminal power flips, data-line edits, new Seminars and R upgrades therefore need no events: they all take effect at the next recompute.

**The Researcher** (U5) staffs its Seminar whatever the network supplies, in every state. Its power and throttle rules are in §5.5.

**Setting:** staffing off (07-ui §17, *Sandbox*; U6) sets `staff = 1` everywhere. The staff slot stays, and a Researcher behaves as usual (500 kW, leak, hollow work); only its staffing effect is moot.

**Display** (U7; P19).
- Percentages round half up to an integer, while the simulation keeps the exact value. So 0.787 reads "79%".
- The research widget's "Staff-limited (n%)" is the minimum staff over the Seminars working on the current research.

**Overlay** (J24). Coverage squares are drawn like power coverage (§6.9, 07-ui §3.3), one hue per network from a fixed 8-hue palette.
- The hue index is (the lowest university id in the network) mod 8. A network keeps its colour when an unrelated network merges or splits.
- The statuses *Understaffed* (yellow) and *No staff* (red) come with Factorio-style warning icons.

**Cost:** O(Seminars + universities + Terminals) per recompute, i.e. microseconds.

### 5.11 World text and the leak (W, j, σ, L; 01 §12, 03 §2–§3)

**Global scalars,** integrated every 60 ticks (phase 13) with the equations of 01 §12 and the numbers of `meta.world`:
- **W = W_own + W_pub** (J6). The two terms are kept apart for the Field tooltip, and γ(W) scales only the field's own pace.
  - Each second, W_own += (v₀ ÷ 3,600) × γ(W). v₀ comes from the world setting (normal, Race or Race hard).
  - γ(W) = 1 for W < 80, (m/g)^((W − 80)/0.5) for 80 ≤ W < 90, and 1 again from W = 90 (01 §12.1). A non-integer power, it uses `detmath` (§4.1).
  - Race mode adds `race_spoil_w` (0.002) to W_own for each Significant result that spoils (03 §5).
- **Publication** (J6). Y_pub starts at `meta.world.y_pub_start` (1945). A technology's *year* is the latest `year` in its structured `citation` list (DECISIONS §35).
  - When a technology completes that is `regime: cited` and whose cost includes at least one paper other than System cards, ΔY = max(0, year − Y_pub) and Y_pub rises to that year. Trigger technologies have no cost and never publish.
  - Each positive ΔY queues a release of β·ΔY field-years, paid into W_pub evenly over the next `publication_lag_s` (600 s).
  - The pending releases are a saved list of (start tick, amount).
- **j(W)** is piecewise-linear between `meta.world`'s breakpoints (01 §12.2).
- **σ = 0.9·Σ ÷ (1 + Σ)** (01 §12.3). Σ only grows, from two sources:
  - an **event hook** on production: each `ratings` crafted by an Endpoint adds the per-Ratings increment a, times the `deployment-sigma` factor after *Watermarking*;
  - the world's own term: `world_sigma_per_field_year` per field-year that W gains above `world_sigma_from_w` (70).
- **Model collapse** (DECISIONS §31, with its accuracy refinement; 03 §2.2).
  - Two production windows cover the last `window_ticks` (36,000 ticks, 10 minutes), each a saved ring of 600 one-second sums:
    - P_crawl: the text and prose produced by the `crawl_recipes` (Quality filtering, Deduplication);
    - P_syn: the text and prose produced by the `synthetic_recipes` (Synthetic data).
  - The crawl share is c = P_crawl ÷ (P_crawl + P_syn), and c = 0 when both are 0.
  - Before *Synthetic detection*, the recipes in `applies_to` (Checkpoint, Post-training payload) run at speed × (1 − σ·c), the compiled `speed_factor`: this is §5.5's collapse factor, and archive-only training pays nothing. After it, crawler output is × (1 − σ) (§5.6), and training pays nothing.
  - Items carry no provenance (§14 #7), so c is the Site-wide crawl share of new text, the global form 03 §2.2 specifies.
- **The race clock** (03 §6). W reaching 90 before *Model generation 25* completes is the Race loss.

**The leak** L and the shares ℓᵢ are integrated in the same pass, right after the world text. Their rules are in §5.17.

**Effects.**
- Town era skins for rendering: five, by W (01 §5.3). They are global and switch at the thresholds, with no per-town hysteresis (U57).
- Exchange floors F(W) and closing (§5.6).
- University T(W) (§5.10).
- The refinery product tables (§5.5).
- The collapse factor (§5.5).

**Readouts** (J6; DECISIONS §13, §35).
- **Literature: YYYY** is the maximum year over researched `regime: cited` technologies, trigger technologies included, and "—" before any. Technologies of the `infrastructure` and `beyond` regimes never count, whatever citation they display (DECISIONS §35).
- **Field: YYYY** = 1945 + ⌊W⌋. Its tooltip shows W_own and W_pub.
- **Your year** = ⌊max(Literature, the `field_year` of every researched `beyond` technology)⌋, floored like Field so that the gap is a whole number. *Model generation L* gives 2025 + 0.5 × (L − 5), an expression in L (§2.4). **Years ahead** = Your year − Field year.
- **The doubling-time readout** (04 §9; U24), computed sim-side after closure and saved:
  - R̄, research units per second over the last w seconds, is sampled every 6 ticks into a ring covering the last 2 h. A second ring keeps 60-tick samples over the last 24 h.
  - w = clamp(DT ÷ 4, 5 s, 120 s), using the previous evaluation's DT; the first evaluation after closure uses w = 120 s.
  - **R̂**, the running maximum of R̄ since closure, is kept beside R̄ in both rings (R5-gate D11). It never falls, so the search is a binary search.
  - DT(t) = t − max{s ≥ closure : R̂(s) ≤ R̄(t) ÷ 2}. A dip (an empty queue, a blackout) therefore reads as a long doubling time, never as the seconds since the dip.
  - *Fastest doubling* and the history string take a DT only on a sample that sets a new running maximum. The history appends DT whenever DT ≤ half of the last appended entry; the first such DT after closure is its first entry.
  - While R̄(t) = 0, or while no s qualifies (the rate has not doubled since closure), the readout shows "—", and nothing is recorded for *Fastest doubling* or the history.

**Cost:** negligible.

### 5.12 Research

- **The queue** holds up to 7 entries (ISO). Progress is kept per technology and never lost.
- **Start research** queues missing prerequisites first, in dependency order (I §4.9).
- **Multi-level prerequisites** (U19). A prerequisite on a finite multi-level technology is met at its `max_level`; on an infinite one, at its first level.
- **Costs:** unit counts, or a `count_formula` compiled by the data stage (§2.4). Geometric costs are computed exactly (repeated multiplication), rounded half up to whole units at each level (the rule the data's literal counts follow: *Model generation 25*'s 5,320,411 is 2,400 × 1.5¹⁹ = 5,320,410.8), and cached per level.
- **Trigger technologies** (E §2.4): craft-item (counting any producer of the force), craft-recipe (completed crafts of the named recipe by any machine of the force; round 5), mine-entity (the first unit extracted by the character, a drill or a Crawler, as Factorio 2.0's *Oil processing* fires on crude oil), build-entity, research, and launch: a frontier run that completes carrying the named payload. The empty launch (04 §2.1) triggers nothing. Triggers are evaluated from production events, not by polling.
- **Hidden technologies** (`hidden: true`, Factorio's flag; R5-gate D9). The one in the data is *Loop closed* (`loop-closed`): craft-recipe of `research-run`, count 1, so it completes with the closure event (§5.5). *Model generation* and the takeoff hardware require it, so nothing paid in System cards alone is available before closure. A hidden technology is never sent to the technology screen, the queue or the search; it raises no toast and no research log line, publishes nothing (it has no cost) and is excluded from Literature, Your year, the end state's counts and the run report's Peak research rate. Its dependents' cards carry 08 §4.6's closure line, and *Start research* refuses them before closure.
- **Effects** come from the effect registry, which the data stage checks.
  - Examples, by data type: `laboratory-speed`, `research-productivity`, `research-per-paper`, `mining-productivity`, `inserter-stack-size-bonus`, `worker-robot-speed`, `staffing-radius`, `computing-energy` (*Dennard scaling*: an energy cut, §5.7), `hall-energy`, `cooling-capacity`, `recipe-productivity`, `weight-transplant`, `research-queue-auto`.
  - All effects are retroactive (ISO) and invalidate the cached `speedEff`s they touch.
  - **Coalesced per tick** (balance m10). When several levels or technologies complete in one tick, their effects are summed per effect type first, and each affected entity's `speedEff` is recomputed once.
- **Multiple completions per tick** with carry-over (G Appendix A; 04 §3.2). During takeoff the last ten technologies fall in under a minute.
- **Research per paper** (04 §0): `Π = m^k × (1 + 0.1·L_rp) × (1 + Seminar productivity)`. It applies to every paper in every Seminar.
  - m = g^r, with g = `meta.world_settings.returns_to_research.g` (1.5), computed once with `detmath.pow` (§4.1), where r comes from the world setting *Returns to research*. The data's `research-per-paper` effects say `multiplier_from: returns_to_research`, never a literal (J14).
  - The default r is ln 2 / ln g, shown as 1.71 (R5-gate D12b), so its m is exactly 2: the engine sets m = 2 for that preset instead of computing the power, so that m^k is an exact power of two on every browser.
  - Powers come from per-level cached products (§4.1).
- ***Research scheduling*** (L6; 04 §5.1; R5-gate D10). It runs in phase 7 after research progress: right after a research completes, and otherwise every 60 ticks, while the queue holds fewer than 7 entries and at least one Researcher is installed.
  - **The order** is `meta.endgame.takeoff_order`: technology ids and `{id: level}` entries, every System-card-only technology level once, in prerequisite order (the validator checks it).
  - **Each check appends at most one entry:** walk the order, skipping entries that are researched or queued and entries passed over (below); the first remaining entry is appended if its prerequisites are all researched, and otherwise nothing is appended this check. Research therefore follows the order exactly, as the reference takeoff does (G17).
  - **Passed over:** an entry whose prerequisite closure holds an unresearched technology outside the order (*Fusion power* without *Nuclear power*, *Two-phase* and *Microfluidic cooling* without *Liquid cooling*). It is reconsidered at every check, so researching the missing technology brings it back.
  - **Infinite:** *Energy per operation*'s entry is its next level that is neither researched nor queued; it never runs out, so after *Model generation 25* the queue converges on it (04 §5.1).
  - Entries carry the byline "Queued by: Researcher". The player's entries are kept, and a toggle in the research screen disables the rule.
- **Readouts** (Literature, Field, Your year, doubling time) are computed in §5.11.

**Cost:** O(labs) inside the crafting phase, plus event handlers.

### 5.13 Trains (M2)

**Rails** use Factorio 2.0 geometry: straight, diagonal, half-diagonal, curved-a and curved-b in 16 directions, from FFF-377. Elevated rails are Space Age and are not adopted.
- The rail planner (I §2.3) builds ghost paths with A\* over rail pieces.

**The rail graph.**
- Nodes are rail ends; edges are rail pieces with lengths.
- **Signals** (regular and chain) split the graph into **blocks**: union-find over the pieces between signals, crossings included.
- A block is rebuilt only in the affected region when a rail or signal is built or removed.

**Trains.**
- A train is rolling stock ordered along a path.
- **State:** speed, front position (edge, offset), path and reserved blocks.
- **Physics** (ISO data): locomotive power 600 kW of traction (D: burner; its `energy.kw` of 1,800 is the fuel burn, ×3 by DECISIONS §18, as for the car and the Half-track), maximum speed 1.2 tiles per tick, weight, braking force, friction and air resistance.

**Signalling.**
- A train reserves blocks ahead out to its braking distance.
- A **regular signal** is green when the block beyond it is free and unreserved.
- A **chain signal** looks ahead to the next regular signal along the train's path and is green only if every block up to there can be reserved.

**Pathfinding** is A\* over the rail graph. Costs are the edge lengths plus the wiki's penalties:

| Situation on the path | Penalty |
|---|---|
| Occupied block | 2 × block length ÷ blocks from start |
| Circuit-closed signal | 1,000 |
| Train stop on the path | 2,000 |
| Stop with a stopped train | 500 |
| Train waiting at a signal | 100 + 0.1 per tick waited |

The repath triggers follow the wiki, e.g. a chain-signal wait of 5 or 30 s. Pathfinding runs on events, not per tick.

**Schedules (2.0, ISO):**
- stations, wait conditions, **interrupts** (A §3.1: enough, with no LTN-style dispatcher), train groups, stop priority and train limits;
- inserters loading wagons;
- fluid and data wagons, with pumps.

**Cost:** about 2 µs per moving train per tick; waiting trains sleep on timers or signal events.

### 5.14 Agents (bots: logistic and construction)

**Agent hubs** (roboports) have ISO areas: logistics 50×50, construction 110×110, 4 charging slots, and radar coverage of 2 chunks (2.0).

**Logistic networks** are unions of overlapping logistic areas. Each network's chests are indexed by item: provider, storage, requester, buffer and active provider.

**Agents (pool):**
- position, velocity, energy, held item stack, and a task queue (FFF-374: robots can queue several tasks);
- `lastUpdateTick`, `nextUpdateTick` and a move intention (target and speed), from which arrival times and rendered positions are derived (FFF-421).

**Movement.**
- Agents fly in straight lines (ISO; no pathfinding).
- A moving agent is updated every 20 ticks and a stationary one every 60 (FFF-421).
- The renderer extrapolates positions from `(pos, vel, lastUpdateTick)`. The snapshot exports these, so agents glide smoothly.

**Dispatch (FFF-374).**
- A task goes to the agent with the earliest **arrival time**, idle or busy.
- Busy agents are registered in the chunk where their queue is estimated to finish. The search spirals outward from the task's chunk.
- Budgets per tick: logistic requests (round-robin over requesters), construction orders (ghosts, deconstruction, upgrades, repairs), and tile ghosts scheduled separately so floors never starve buildings (ISO).
- **Item requests** (the module-request path, ISO) also deliver a Research hall's accelerators and weights (§5.5), a Seminar's Researcher, and the item a compromised machine's rollback input accepts (§5.17). Construction agents skip a compromised entity's deconstruction and upgrade orders until it is clean.

**Charging (FFF-374).** Hub choice weighs:
- distance;
- the charging queue;
- agents already en route;
- free charging slots;
- when low on energy, a preference for hubs closer to the destination (this fixes the classic lake loop).

**Personal roboport.** Equipment grid, with construction agents flying from the character (era equipment, B L14). Arrives in M3.

**Two agent kinds** (D): construction agents run planners and need no checkpoint; logistic agents are learned. Logistic agents therefore make a runaway link, but only inside one hub's logistic area (§5.17).

**Cost:** about 1 µs per agent update, so 5,000 agents cost about 0.3 ms per tick, plus dispatch about 0.2 ms.

### 5.15 The circuit network (M2 basic, M3 full)

**Wires.** Red and green wires connect circuit connectors. Networks are connected components per colour, maintained by union-find; a removal rebuilds the component.

**Signals.** A signal frame is a sparse sorted array of `(signalKey uint32, value int32)` pairs. The key packs signal type (item, fluid, virtual, recipe, entity), prototype index and quality. Arithmetic wraps at 32 bits (ISO).

**Per tick.**
- Each network's frame for tick *t* is the sum of its members' outputs written at *t*−1. Every combinator therefore adds one tick of latency (ISO).
- A network is **dirty** only if a member's output changed. Combinators whose input networks are clean skip evaluation, because they are pure functions. The exception is the selector combinator's random and count modes, which are keyed by tick.

**Combinators** (D's names, Factorio 2.0 semantics, FFF-384):

| Ours | Factorio | Notes |
|---|---|---|
| Decision unit | Decider | Multiple conditions and multiple outputs, per-wire input selection (R3-accuracy M1: not a threshold unit) |
| Arithmetic unit | Arithmetic | |
| Bias unit | Constant | Sections |
| Selector unit | Selector | All modes; random via counter RNG |

Also the display panel, programmable speaker and power switch.

**The Compromised signal** (L3). A compromised machine outputs the virtual signal Compromised = 1 on every connected wire while it is compromised, whether or not it has power (§5.17). A tripwire that cuts the cluster's power therefore keeps seeing the signal until the machines are clean.

**Compromised-only connectors** (R5-gate D7). Every susceptible entity type has a circuit connector. A type whose Factorio 2.0 counterpart has none (labs and beacons, so Seminars and Switches) gets one that outputs only the Compromised signal, reads nothing and has no control behaviour; its position comes from the sprite manifest like every connector's (§2.4).

**Control behaviours** (enable or disable conditions, and read or set) on:
- inserters, belts (the whole-line reader), assemblers (read contents, **set recipe**), chests, drills;
- pumps, tanks, train stops, rail signals, hubs, accumulators, lamps (colour);
- radar transmission: one channel per surface and colour (FFF-402).

**Cost:** about 300 ns per evaluated combinator. The dirty-skip makes static logic free.

### 5.16 Quality (M3)

- **Five tiers** (H): Standard, Selected, Verified, Audited, Reference. The item key carries the tier *index* 0–4; the tier's *level* (0, 1, 2, 3, 5) scales stats (§4.3). A tier is reachable once its `unlocked_by` technology is researched (`meta.quality.tiers`).
- **Rolls** (Space Age, ISO). The machine's Comparators (quality modules) give a quality chance *q*; Switches never carry quality. On each craft, each non-catalyst product upgrades one tier with probability *q*, then by a further tier with `next_tier_chance` (10%) each, up to the cap below. Both rolls use counter RNG (§4.3). Quality never drops.
- **The verifier ladder** (A §5.1's BEND; L5).
  - Max output tier index = 1 + the **lowest** tier index among the machine's Comparators, capped by the highest unlocked tier.
  - "Tier" here is the Comparator item's quality, not its module number (Comparator 1–3).
  - A machine without Comparators does not roll.
  - `maxOutputQuality` is derived when modules change, and cached with `speedEff`.
- **Catalysts** (L5). Catalyst products carry `affected_by_quality: false`: they return at the recipe's quality, and only the non-catalyst remainder rolls (§4.3). Serving or copying a checkpoint therefore never upgrades it for free (B L6).
- **Recipe quality** (L5; ISO 2.0). A machine crafts its recipe at a selected quality, and every ingredient, the catalyst included, must have that quality. An Endpoint's v for the leak is its recipe quality (03 §3.1).
- **Entities placed from quality items** scale the stats that the overlay's quality table lists for their type (ISO 2.0: crafting speed, module effects, and so on) by 1 + `stat_bonus_per_level` × level (L5). The exception is the Switch's transmission, which adds 0.2 per level (1.5 → 2.5 at Reference), as Factorio 2.0's beacon does.
- **The Verifier** (recycler) runs generated 25% recipes (§2.4) and keeps quality (ISO).
- **Model quality is hidden** until *Interpretability* (`show-model-quality`). Before it, the UI shows no quality on checkpoints, controllers, Researchers, payloads or agents; the simulation tracks it all along.
- **Model collapse does not touch quality.** It is a speed factor on the text-trained recipes (§5.5, §5.11; 03 §2.2).
- **UI:** quality pips on slots; Alt+Wheel (I §2.3).

### 5.17 Runaways: *Contained* (M3) and *Wild* (M5)

The rules are 03 §3's; the numbers are `meta.runaways`'s. Under the *Off* preset none of this exists: there is no leak and no Compromised signal, Monitors are inert, and the rollback input never appears (U39).

**Deploying buildings and their model tier A** (03 §3.1):
- **Endpoints:** a global value, the highest of 1, 2 and 3 whose technology is researched: *Deep learning*, *Attention*, *Instruction tuning* (`meta.runaways.model_tier.endpoint`; *Instruction tuning* does not require *Attention*, so the highest counts, not the latest; U37; never 4). v is the Endpoint's recipe quality.
- **Research halls:** 4 (DECISIONS §28). v comes from the weights item.
- **Researcher-staffed Seminars:** 4. v comes from the Researcher.
- **The Verification count** O is the number of `verification_techs` researched (R3-accuracy M3; formerly "Oversight").

**The leak** (L4). Every 60 ticks, in phase 13 right after the world text (§4.6):
- **Accrual.** For every non-compromised deploying building i: Δᵢ = (`leak per_hour` ÷ 3,600 s) × 1 s × Aᵢ × (1 − vᵢ) × (1 − `verification_step` × O) × wᵢ. Here wᵢ is the fraction of the last 60 ticks in which its crafting or research progress advanced (U27); a throttled machine still advances (U15). Then ℓᵢ += Δᵢ and L += Δᵢ.
- **Removal.** When a deploying building is removed, or stops deploying (a Seminar's Researcher is taken out), L −= ℓᵢ, floored at 0, and ℓᵢ = 0, so that L stays the sum of the shares of deploying buildings; a Researcher inserted later starts from ℓᵢ = 0.
- **Compromise.** When L ≥ 1, the engine picks the non-compromised deploying building with the largest ℓᵢ (ties: the lowest serial).
  - If there is none, L is held at 1.
  - Otherwise that building is compromised as the first member of a new infection of tier Aᵢ, ℓᵢ = 0, and L −= 1.
- **Readouts:** L with two decimals, and the building that holds the largest share with its own position, tier and quality ("?" before *Interpretability*), the rate and the deployment count, and the verification count (03 §3.2; R5-gate D8).

**Susceptible machines** (03 §3.1):
- every computing machine (a `heat.class`: Switches and Researcher-staffed Seminars included);
- any machine holding a Learned or Distilled controller in a module slot.

Immune (R5-gate D5; `meta.runaways.susceptible`): furnaces, drills, plain assemblers, Crawlers, Seminars without a Researcher, cooling buildings and the Verifier, **unless they hold a Learned or Distilled controller**; and always belts, inserters, power plants, Terminals, Monitors, the Constructor (not a computing machine) and towns.

**A compromised machine** (L3; `flags.compromised` plus its infection id):
1. **Signal.** It outputs Compromised = 1 on every connected wire while compromised, whether or not it has power (§5.15).
2. **Locked.** It cannot be mined, deconstructed, fast-replaced or upgraded, or emptied of modules, a Researcher, accelerators or weights. The refusal is the flying text "Compromised. Cut its power." (08-text §8.3). Deconstruction and upgrade marks may be placed, and agents skip it until it is clean (§5.2, §5.14).
3. **Frozen.**
   - Its crafting or research progress stops: nothing is consumed or produced. Inventories keep their ISO insertion limits.
   - It draws its full *working* power, not its idle drain, and emits it as heat.
   - Its leak share stops accruing.
   - A compromised Switch transmits nothing (§5.5).
4. **Powered** (U29) means electric satisfaction > 0 in the entity's own class (interruptible for halls), as last computed: the zero-power counter advances in phase 4 on the current tick's value, and a spread timer, which fires in phase 2, reads the previous tick's (§4.6). A Seminar holding a Researcher draws in both classes, so for it the value is min(normal satisfaction, u_p) (R5-gate D12f).
5. **The zero-power counter** (U31) counts consecutive ticks at satisfaction 0 and resets on any tick above 0. At 1,800 ticks (`power_off_s` = 30 s) the machine is clean.
   - A brownout therefore never cleans anything.
   - A 30-second blackout of a whole network cleans every compromised machine on it.
6. It shows an icon, raises the *Compromised* alert, and carries 08's tooltip.

**The rollback input** (L2). It exists only while the machine is compromised, and only after *Rollback recovery* (the `rollback` effect).
- It has one slot, which accepts exactly one item of the machine's **rollback type**: `checkpoint` when the infection's tier is 1–3, `frontier-checkpoint` when it is 4.
- It is fed like an ammo slot: by hand, fast transfer, an enabled inserter, or an agent's item request.
- The item is consumed on arrival, and the machine is clean at once.
- No other slot changes its acceptance rules. While the machine is compromised, an item of its rollback type goes to the rollback input before any other slot that would accept it (an Endpoint's recipe checkpoint, a Research hall's empty weights slot).
- 07 §10.4 shows the input, outlined in the compromised band.

**Links** (03 §3.3; U36). Spread travels only along these, **one hop at a time** (R5-gate D6): two machines are linked when they share one data-line network, one exchange, one Switch area or one hub area, and a link never chains through a third machine:
- the same **data-line network** (§5.8);
- the same **exchange**: every building on its taps, plus the data networks they feed;
- the same **Switch area**: the Switch itself, and every machine whose footprint overlaps its 9×9 supply area;
- **Logistic agents** (DECISIONS §27): source and target must both lie inside the logistic area of *one* agent hub whose network holds at least one Logistic agent, counted in hubs and in flight.
- **Never:** circuit and power wires, belts, pipes, inserters, trains.

The engine keeps, per susceptible machine, its **link memberships**: its data-line network, its exchange (a tap building, or a machine on a data-line network such a building feeds) and the Switch areas it overlaps, rebuilt on the relevant builds; that is cheap and rare. A spread target must share one membership with a powered member. The agent link is a spatial query over hub areas, made when the spread timer fires. **Link clusters** (union-find over the same memberships) are kept for the containment overlay only: they show where an infection can reach eventually, one hop per interval (03 §3.3).

**Spread** (DECISIONS §27: linear; 03 §3.3).
- **Infections.** An infection is one leak compromise plus every machine it spreads to. Its id is the serial of its first member, and its tier is fixed when it is created.
- **One timer per infection**, with its tier's interval from `meta.runaways.spread.interval_s` (60, 45, 30 and 20 s), started at the compromise.
- **On firing**, the engine searches from the infection's **powered** members for the nearest uncompromised, powered, susceptible machine linked to one of them (centre to centre; ties: the lowest target serial, then the lowest source serial). That machine is compromised and joins the infection.
- **Effects.** An infection gains at most one machine per interval. A firing with no target does nothing, and the timer keeps cycling.
- **Leaving.** A cleaned machine leaves its infection. When an infection has no members, it ends and its timer is cancelled.

**Cleaning.**
- **Zero power for 30 consecutive seconds** (above).
- **Monitors** (U35):
  - Range is a centre-to-centre distance ≤ `range` (24).
  - Each Monitor's cycle advances at its satisfaction × (1 + Σ `monitor-rate`). A charged Monitor waits, then fires on the tick a target appears.
  - On firing, it cleans the nearest compromised machine in range (ties: the lowest serial) and consumes 1 Evaluation set only when it cleans. Without a set, it does nothing.
  - The target search is a spatial query over the short compromised list. Monitors are not susceptible.
- **Rollback** (above).

**Escape** exists only under *Wild* (03 §3.6).
- Each compromised machine has its own escape timer: 120, 90, 60 or 45 s by infection tier. It restarts after every expiry, a nest founded or not, while the machine stays compromised (R5-gate D13).
- When it runs out and the machine is still compromised and has a path out, a nest is founded. Each infection founds at most one nest per 10 minutes.
- Nests are never placed on town tiles, nor within 32 tiles of a town footprint (U40). The 3-chunk distance is measured from the agent hubs' construction areas or, with no hub, from the Site's built area: every chunk that holds one of its entities (R5-gate D13).
- Under *Contained* a compromised machine stays compromised, and its infection keeps spreading, until it is cleaned.

**Cost:** all event- and timer-driven, and zero when nothing is compromised.

***Wild*** is Factorio's military loop, with F's numbers and spec/03's text:
- units and spawners;
- **pathfinding** as in FFF-317:
  - each chunk is reduced to abstract nodes, one per connected land region, ignoring entities, so buildings never invalidate the graph;
  - an abstract search runs backward from the goal and supplies the heuristic for tile-level A\*; it is cached and resumed across queries;
  - the tile search may deviate around entities;
  - budget: about 1,000 node expansions per tick;
- unit groups and attack waves;
- expansion;
- health, damage and resistances; **damage categories** (R5-gate D13): `meta.damage_categories` is the registry, every damage dealer declares one (`extra.ammo_category`, an ammo item's category or `damage_category`, an equipment's `ammo_category`), and `ammo-damage` and `gun-speed` bonuses apply by category (*Arc damage*'s arc bonus to the arc turret);
- turrets (gun, laser and arc), projectiles and acid puddles;
- walls and gates, repair packs, artillery and interceptors.

Target: 1,000 active units in ≤ 2 ms per tick. **Deferred to M5** (§14).

### 5.18 Map generation

**A pure function** `generateChunk(seed, settings, surface, cx, cy) → ChunkData`. It runs in the worldgen workers and in Node, and its output never depends on generation order.

- **Region-based features** (towns, resource spots, records stores) come from coarse cells, e.g. 8×8 chunks for towns. Each cell is seeded by `hash(seed, layer, rx, ry)`. A chunk queries the cells overlapping it.
- **Overlaps** resolve by a fixed priority. They never depend on which chunk was generated first.
- **The town layer is queryable without generating chunks.** The sim asks it for campus positions (staffing, §5.10, U4) and footprints. A town's cell key is its stable id.

**Stages per chunk** (noise from simplex-noise 4.0.3, fractal sums; FFF-390's ideas, written as TS functions rather than a string DSL):
1. **Climate** (01 §3), evaluated at the chunk centre.
   - `θ = clamp(14 + y/80 + n, −15, 35)` °C. The noise n is one octave of simplex noise at a 512-tile wavelength and ±3 K amplitude, on its own seed stream `ambient` (P9). The numbers come from `meta.heat.ambient`.
   - Sunlight `s = clamp(1 + y/5,700, 0.6, 1.3)`, also per chunk centre (P8).
   - Moisture.
   - *Climate compass: off* sets θ = 14 °C and s = 1.
2. **Elevation**, from continent, island and coastline octaves. Water is below 0. Lake density scales with moisture (01 §2). The starting area is guaranteed land.
3. **Tiles.** Biomes by θ (tundra, boreal, temperate, steppe, desert; 01 §2), blended over ±2 K with tile noise. Each biome draws from the `tiles.yaml` tiles that name it, and each tile id carries its κ (§4.4, §5.9).
4. **Cliffs** are marching squares on elevation contours at fixed intervals. Elevation is a pure function, so sampling the chunk border makes cliffs continuous across chunks.
5. **Resources.**
   - Spot noise per resource: cell-jittered spots whose radius scales with the *size* setting and whose probability scales with *frequency*.
   - Amount per tile = richness × falloff × (1 + noise). Richness grows with distance from spawn (ISO).
   - No uranium within 512 tiles of spawn. The starting patches are placed by stage 10.
6. **Trees** by forest noise × moisture × θ. None in deserts or on snow. Each tree is a `world.yaml` tree with 4 leaf stages (§5.9).
7. **Rocks** are `world.yaml` rocks: Factorio 2.0's sizes, yielding quartz (D: quartz plays stone) and coal.
8. **Decoratives** are seeded per chunk; only the seed is stored.
9. **Towns** (01 §5).
   - **Grid:** 256×256-tile cells, with spawn at the centre of cell (0, 0). Each other cell holds a town with probability P(d), and the class table gives footprint and institutions by distance band.
   - **Site:** up to 8 seeded candidates in the cell's central 160×160 square. A candidate must be ≥ 85% land, contain no cliff, overlap resource patches by ≤ 5%, and keep 64 tiles from every other footprint.
   - **Order independence.** The 64-tile rule couples neighbouring cells. It is resolved by a fixed priority, the cell hash: a candidate is tested only against higher-priority neighbours' accepted footprints, which are computed recursively and memoised per worker. The land, cliff and resource tests sample the same pure functions. The result never depends on which chunk generates first.
   - **Footprint** (U51). Every footprint tile becomes a town tile, water included.
   - **Layout** (P10). Streets 2 tiles wide every 8 tiles, both ways. The blocks between them are building-block tiles; a generator seeded per cell picks each block's building sprite. Streets are walkable and drivable; building blocks block the player and vehicles like rocks. Nothing is buildable on either (§4.4).
   - **Institutions at the edge** (01 §5.4):
     - the **university**, an 8×8 campus world object. It sits on the footprint edge whose R = 48 coverage strip outside the footprint holds the most buildable tiles (ties: N, E, S, W; U53). The starting college's campus faces spawn instead (stage 10);
     - the **library**, an archive blob outside the footprint. It has n = clamp(round(total ÷ 1,500), 16, 400) tiles; each holds ⌊total ÷ n⌋ records, and the first (total mod n) tiles in row-major order hold one more, so totals are exact (U55);
     - the **exchange**: taps clustered 6–16 tiles outside, ≥ 4 tiles apart, and the cosmetic exchange office inside the footprint edge.
   - **Records stores** in old mines (01 §6.2) appear away from towns, by spot noise, each with a cosmetic mine entrance. A store with any blob tile out of the map is rejected (U58).
   - Campuses, exchange offices and mine entrances are world objects, and town buildings are tiles (§4.4). None of them is an entity.
   - **Era skins** are global, switched by W at 01 §5.3's thresholds (U57).
   - **Names** (R5-gate D1; 01 §5.3, 08 §10.4). Drawn from `text.yaml`'s pools on the cell's own name stream. A name held by a higher-priority town within `town_names.uniqueness.within_cells` (8) cells is rejected and redrawn, up to `redraws` (8) times; then `suffix` (" II", then " III" …) is appended. Priority is the cell hash of the footprint rule above, and a town's name depends only on higher-priority towns within 8 cells whose possible draws contain it, so it is computed recursively and memoised like footprints and never depends on generation order. Unique within 8 cells (2,048 tiles), not per map.
10. **The starting area** (01 §9; DECISIONS §32). Every guarantee is constructive: the stage places the feature and then checks it, and S-G1 sweeps 1,000 seeds (§10.4).
    - **The starting college town.** Its campus is on the footprint edge that faces spawn, with spawn 16–32 tiles from the campus edge (at most 16 tiles to the side), so that spawn and the footprint lie in the coverage square.
    - The **four starting patches** (iron, copper, coal, quartz; whole blobs) and the **80,000-record archive** also lie inside that coverage square.
    - The coverage holds the buildable land 01 §9 requires (≥ 7,500 buildable tiles and a 40 × 40 buildable square; U54 as amended).
    - The lake, forest, climate and clear-ground guarantees are 01 §9's.
    - **The starting exchange tap** (01 §9): one tap at the college, initial yield 200% (`meta.world.exchange.starting_tap_initial_yield`), floor f = 15%, closing at σ = 0.70; scenery until *Crawling*.
    - **The Laboratory salvage** (DECISIONS §33; `meta.start.salvage`, its single definition):
      - `wreck_pieces` (6) wreck pieces and one crate, within `within_tiles` (16) of spawn;
      - each piece yields `per_piece` (5 iron plates), and the crate yields `crate` (1 radar, 10 logic boards, 20 copper cable);
      - each is mined by hand in `mining_time`.

**Map size.** Factorio's width and height settings bound the map, e.g. *Ribbon world*'s 128-tile height (07-ui §17). Chunks outside the bounds are filled with the out-of-map tile. The sim refuses building, walking and driving there, and heat is not diffused into them: the edge reflects (§5.9, U10).

**The commit protocol** keeps determinism with asynchronous workers.
- The sim asks for a chunk at tick *t*: on charting, on a radar scan, or when the chunk enters the character's pre-generation radius. Agents and heat diffusion never trigger generation. Agents skip ungenerated chunks, and heat sent toward them is lost to the Map edge sink (§5.9).
- It commits the chunk at tick *t* + 30.
- If the worker is late, the sim *waits*: it stalls the tick and reports the stall in F5.
- Generation is pure and the commit tick depends only on sim state, so replays are identical.
- Pre-generation keeps a radius of 7 chunks around the character and radar targets 2 chunks ahead.

**Map preview** (I §4.20) samples the same functions at 1 sample per 8 tiles over 1,024×1,024 tiles in a worker, in about 0.3 s.

**Cost:** about 1–2 ms per chunk per worker. The initial area of about 15×15 chunks takes under 1 s with 4 workers.

### 5.19 Charting, radar and fog

- **Charting:**
  - each chunk has a *charted* bit and *keep-revealed* counters (FFF-421). Characters, radars and hubs register areas, and overlaps cost nothing;
  - radars also sweep distant sectors on their own cadence.
- **The chart image** is 32×32 RGBA per chunk: tile map colours plus entity map colours. It is generated in the sim worker when a chunk is charted or changes while watched, and sent in packets.
- **Fog (ISO, I §3.15).** A charted chunk that is not watched shows its **last snapshot**. The worker freezes the chunk's view data (§3.4) when the chunk stops being watched and serves that copy until it is watched again.
  - In the peaceful slice nothing can change unseen in a way that matters, so the slice renders the live state under a fog tint. The frozen snapshots arrive in M2 (§14); radar itself is in the slice.

### 5.20 Statistics, achievements, the run report and the rate calculator

**Production statistics** (I §4.12).
- Per-tick counters, produced and consumed, per item, fluid, building, heat source and sink (the Map edge included, §5.9), and the **Papers** pseudo-item: research progress actually produced, counted in papers with productivity included (FFF-408's "science" item; 07-ui §11).
- Flushed every 60 ticks into ring buffers at 9 precisions (5 s to 1000 h, and All) of 300 points each, by hierarchical downsampling. They are `Float32` and saved. They are display data: beside them the sim keeps exact all-time totals per item, for production and for hand-crafting (float64, integer-valued, saved in `STATS`), and the run report reads only those (Float32 is exact only to 2²⁴, and 07 §13.3 prints exact integers).
- Electric statistics per network likewise.
- The two model-collapse windows (P_crawl, P_syn; §5.11) are separate, exact 10-minute rings, because the statistics rings are display data.
- **Cost:** a few µs per tick.

**Achievements** (08-text §6, canonical per DECISIONS §20).
- Their conditions are machine-readable data in `text.yaml` (R4-ui): `condition: {type, …}` with ids and thresholds. The condition types form an engine registry, listed in 08-text §6's table (craft-while, power-rise-after-install, install-before-compromise, takeoff-time and the rest). The data stage checks that every type exists (§2.4).
- They are evaluated on events and every 60 ticks, and persisted per save (`GLOBALS`) and globally (IndexedDB `runHistory`, the *Run history* of 07-ui §19.2).
- `win`'s `race_won` (R5-gate D12c) holds when a race mode is on and the field had not reached W = 90 when the Final-report run completed. A victory after a race loss shows the run report again without the race line.
- The **achievements window** (07-ui §13.7, M4; R5-gate D12i) reads the same records.
- Example: *Jevons paradox* (U63) compares the mean electricity consumption over the 60 min after the 100th Distilled controller is installed with the mean over the 60 min before. It needs an event hook plus a statistics query.

**Milestones** (07-ui §15). The list is `text.yaml` data. Each first-time event is logged with its game time and saved.

**The run report** (04 §8; P20–P23, U64). Its fields are read at the moment of victory from saved accumulators:
- **Loop closed** and **Takeoff**: the closure tick, and the time from closure to the completion of *Model generation 25*.
- **Overhang at closure**: accelerators by 04 §7's definition, i.e. loaded in halls, inside Researchers, and in any inventory, belt, hand, vehicle, agent or machine buffer. The snapshot is taken in the tick the closure event fires, at the event itself (phase 7), before that tick's inserter phase (P23).
- **Peak research rate**: the largest number of technology completions in any 600-s window sliding per tick, × 6 per hour (P22). Every level of a finite technology counts; infinite technologies and the hidden *Loop closed* do not (R5-gate D12a). A ring of recent completion ticks and the best count so far are saved.
- **Fastest doubling**: the minimum of the doubling-time readout (§5.11), taken only at new maxima of R̄ (R5-gate D11).
- **Peak power**: the highest 60-s sliding mean of the surface's total electric production, from per-tick totals (P21).
- **Hand-crafted items**: every item the character crafted, intermediates included.
- **Most-produced item**: the real item (not a fluid, not the Papers pseudo-item) with the highest exact all-time production total. Ties (equal totals) go to the item that comes first in data order (U64). This gives *Objective, inferred*.

**The rate calculator** (07-ui §16.1; Alt+X).
- The selection tool sends a read-only `query(rates, entities)`, not an `InputAction`.
- The worker computes each selected machine's current and full-speed rates with the **same** `effectiveRate(entity)` functions the sim uses for production. That covers modules, Switches (with their throttle), quality, bonuses and productivity, plus the current-mode multipliers for energy, thermal throttling, staffing and model collapse.
- Machines covered: crafting machines, furnaces, Keypunches, drills, Crawlers, offshore pumps, boilers, generators, solar panels and Seminars.
- It also returns power, heat and staff demand.
- The window shows net rates per item and the balancing machine counts. Tooltips and the rate calculator can never disagree with the simulation.

**Even distribution** (07-ui §16, a setting, default off). Ctrl-drag spreads the hand evenly across the entities swept, as one `distribute(entities[], itemKey, count)` action with a deterministic split. I's F8 test keeps vanilla behaviour.

---

## 6. Rendering

### 6.1 Decision: a custom WebGL2 renderer, without PixiJS

**Why custom.**
- **Immediate mode matches the data flow.** Every frame the renderer turns the view model plus the `dyn` buffer into draw lists. A retained scene graph (PixiJS's `Sprite` objects) would duplicate 10⁵ objects of simulation state and churn them.
- **Measured on this host** (Appendix A): instanced quads in Chrome 156 on SwiftShader are 5–30× slower than expanded indexed quads. For example, 20k sprites of 32 px take 382 ms against 73 ms, and 150k sprites of 8 px take 3.1 s against 0.10 s.
  - Claude verifies visuals on this exact stack, so the batcher uses **expanded quads**.
  - On real GPUs the two paths cost the same for sprites.
- **What we need is simple in raw WebGL2:** texture arrays, a terrain shader, shadow and light render targets, a ghost shader, overlay and chart shaders, a LUT post-process and multiple viewports.
- Rejected: **PixiJS 8.22** (scene-graph overhead and GC at our sprite counts); **WebGPU** (the brief says WebGL2, which already meets every need; the renderer's thin GL layer can be ported later).

**Size:** about 8–10k lines of TypeScript, with no runtime dependencies.

### 6.2 Frame structure

Each frame, for each viewport (the world, the minimap, GUI previews, pin cameras):

1. **Terrain:** one quad per visible chunk through the terrain shader (§6.5); water animated.
2. **Ground layers:** decals and decoratives, resource sprites, floor entities (belts, rail beds, pipe covers), ground items, then **belt items**.
3. **Shadow pass** into an R8 render target with `MAX` blending, so overlapping shadows never double-darken. Composited over the ground layers before objects are drawn, so shadows fall on the ground, belts and items but not on other buildings, as in Factorio.
4. **Objects,** y-sorted: buildings, trees, poles, chests, inserter bases.
5. **Higher objects:** inserter arms and held items, pole wires (catenary strips), signals.
6. **Air objects:** agents and their shadows.
7. **Lights (night):** an additive light render target at half resolution (lamps, machine light sprites). Composite: `colour × (ambient(dayTable) + light)`.
8. **World overlays:** ghosts (hologram shader), build previews (I's tints), selection brackets, coverage (power, staffing), thermal overlay, alt-mode icons and arrows, the status-light layer, warning icons, edge arrows.
9. **Post:** the colour-blind LUT (a 3D texture) when enabled.

Flying text and labels near the cursor are DOM (I §8.1).

### 6.3 The sprite batcher

- **Expanded quads** go into one growable `ArrayBuffer`, viewed as `Float32Array` and `Uint32Array`.
- **The vertex format** is 20 bytes:
  - `pos: 2 × f32`, camera-relative;
  - `uv: 2 × u16` normalized;
  - `layer: u16` (the texture-array page) plus `flags: u16` (shader variant bits);
  - `tint: RGBA8`.
- **One static `Uint32` index buffer** (0, 1, 2, 2, 1, 3, …) serves 2¹⁶ quads per draw.
- **Draw calls:** one per layer and texture array. The colour, shadow, icon and chart arrays each bind once.
- **Uploads:** `bufferSubData` of the used range, in two orphaned buffers that alternate.
- **CPU cost:** filling 100k sprites is about 2 ms on the laptop (Appendix A extrapolation).

**v1 rebuilds all visible geometry every frame.** That is simple and makes tints, animation and status free. Static per-chunk vertex buffers for terrain decor and building bases are an optimisation, kept for when profiling asks for it (M6).

### 6.4 Atlases and the sprite manifest

- **Pages:** 2048×2048 layers in `TEXTURE_2D_ARRAY`s. WebGL2 guarantees 2048² textures and ≥ 256 layers, so this works on every target. Mipmaps are generated at load.
- **Separate arrays:**
  - colour (RGBA8, premultiplied);
  - shadow masks (R8);
  - lights (RGBA8);
  - icons (RGBA8; also exported as PNG/WebP sheets for CSS, I §8.1).
- **The manifest** `public/atlases/sprites.json` maps each name to page, rectangle, anchor offset, frame count and **frame stride**. Animation sheets are packed as units.
- **Lazy loading by tier.** Each prototype's `tier` decides its atlas group: the slice's pages load first, the rest on demand.
- **Decoding:** `createImageBitmap`, off the main thread, then `texSubImage3D`.
- **Context loss:** atlases are re-uploaded from cached `ImageBitmap`s on `webglcontextrestored`.

### 6.5 Terrain, water and decoratives

- **Terrain** is one quad per chunk. The fragment shader reads:
  - the chunk's tile ids (the dense ids of `tiles.yaml`, §4.4) from a 34×34 R8 data texture (one-tile border), held in a texture array with one layer per resident chunk;
  - per-tile-type **material textures** (the engine overlay maps tile ids to materials): seamless 512² textures covering 8×8 tiles each, with variants.
- **Map colours** of tiles are design data (`map_color`); the chart (§5.19) and the minimap use them.
- **Edges** between tile types blend through a noise mask in the shader. That yields organic boundaries without Factorio's hand-drawn transition sprites (a presentation choice).
- **Concrete, town streets and town blocks** are tile types with crisp edges (a flag skips the noise blend). Building blocks get a building sprite per block, chosen by the town generator and skinned by era. The campus and landmarks are world-object sprites (§4.4).
- **Water** is a tile type with an animated normal-map shimmer and a shore foam band.
- **Decoratives and trees** are sprites:
  - trees: 10 species × 4 variants × leaf stages, plus shadows;
  - decorative density is capped per chunk.

### 6.6 Layers, sorting and culling

**Sorting.**
- Object sprites sort by `(bottomY, x, serial)` within each draw layer. Chunks are visited in row order, so tall sprites that cross a chunk border still overlap correctly.
- A per-frame counting sort by tile row keeps sorting O(n).

**Culling.**
- At chunk level: the view rectangle plus a 6-tile margin, the 2.0 value chosen because agents move only every 20 ticks.
- Then per sprite by bounding box.

### 6.7 Shadows and lights

- **Shadows** are pre-rendered alpha masks from Blender's shadow-catcher pass (§9.1), cast to the east, as in Factorio, from a key light in the north-west.
- **Air objects** cast offset shadows.
- **Lights:** lamps and machine light sprites (from Blender's emission pass) are additive. Their intensity follows the day table and the entity's state (working or idle).

### 6.8 Animation and dynamic objects

- **Machine animations** advance only while working, by `speedEff`. This is an animation progress per entity, exported in `dyn`.
- **Belts:** `frame = (tick × speed × framesPerTile ÷ 256) mod frames`.
- **Inserter arms** are drawn from (θ, *r*) as rotated part sprites (base, arm, hand open or closed), with oblique compensation.
- **Agents** and **trains** are extrapolated or set from `dyn`:
  - rolling stock uses 64 pre-rendered orientations;
  - agents 16.
- Smoke and particles are render-only: seeded from events, never simulated.

### 6.9 Alt-mode, previews, selection and overlays

- **Alt-mode** (I §3.14): recipe and product icons on a dark backdrop; arrows for drills, inserters and fluid connections; module icons; and the status-light layer (A §10). All are drawn from the icon array.
- **Build previews** use I's tints and context previews: pole supply areas, drill areas, inserter pickup and drop markers, underground pairing lines (green at maximum range), and the offshore pump facing water.
- **The coverage overlays** (power, staffing and agent areas) draw the union of rectangles into a coverage target, then tint it. Staffing coverage squares get one hue per network: palette index (lowest university id in the network) mod 8, computed sim-side (§5.10, J24; 07-ui §3.3).
- **The thermal overlay** (07-ui §3.2):
  - It uploads visible chunks' `T` into a small texture each time the sim publishes the field (every 64 ticks), and draws it **bilinearly interpolated between chunk centres**.
  - The colour scale, its alpha rule and its contour lines are 07-ui §3.2's, uploaded as a 1D lookup texture so that 07 can change them without shader edits.
  - In the game view, a contextual tint (alpha ≤ 0.25) appears while a computing or cooling building is held or hovered. That building's T\*_eff isotherm is drawn as a contour, and a cooling building's chunk is outlined.
- **The registry** (I BEND-6, 07-ui §3.1): each overlay has up to four renderers (map, minimap in alt-mode, world contextual, world alt-mode), so the age/builder, paths-out, monitor-range and exchange overlays plug in.

### 6.10 Zoom, map view, minimap and viewports

- **Zoom** (I §3.15): 32 px per tile at 1×; closest 3×.
  - The game view zooms out to about 200 tiles across (≈ 0.3), then **seamlessly switches to chart rendering**, which continues to 1/64.
  - Steps are about ×1.1 per notch in the world and ×1.25 on the map.
- **Chart view:**
  - each chunk is a 32×32 chart image in a chart texture array (2048² layers hold 4,096 chunks each);
  - overlays (power network, thermal, staffing, resources, tags, trains, agents, pipelines) draw on top;
  - uncharted chunks are black; unwatched ones are dimmed.
- **The minimap** uses the same chart renderer in a scissored viewport.
- **Viewports.** DOM elements (the minimap, the entity-window preview, pin and alert cameras) register *holes*: their rectangles, re-measured on layout change and never inside the frame loop.
  - The canvas sits under the DOM, and the renderer draws those viewports into the holes.
  - Overlapping windows occlude them naturally.
- **HiDPI:** the canvas backing store is at `devicePixelRatio` capped at 2, with a *render resolution scale* setting. UI scale is independent of world zoom.

### 6.11 Text in the world

- **Flying text** (I §3.12, ≤ about 20 at once) and tooltips are DOM.
- **World labels** (train stop names, display panels, map tags) use a glyph atlas rendered at startup from Titillium Web with Canvas2D `fillText` at two sizes. No build tooling is needed.

### 6.12 Render budgets (the reference machine of §11, 1920×1080)

| Scene | Visible sprites | Main-thread CPU | GPU | Requirement (§11) |
|---|---|---|---|---|
| Default zoom (1×), slice base | ~2k sprites + 2k belt items | ≤ 4 ms | ≤ 6 ms | 60 FPS |
| Default zoom (1×), mid base | ~8k sprites + 10k belt items | ≤ 6 ms | ≤ 10 ms | 60 FPS |
| Furthest world zoom (≈ 0.3×), late base | ~25k sprites + 60k belt items | ≤ 12 ms | ≤ 25 ms | ≥ 30 FPS |
| Chart view | ≤ 4k chunk quads + overlays | ≤ 2 ms | ≤ 3 ms | 60 FPS |

- The main-thread total includes packet decode (≤ 0.5 ms) and the UI (≤ 2 ms).
- On the target machine everything should hold 60 FPS.
- Fill rate is the risk on the weak iGPU. Mitigations: half-resolution light and shadow targets, mip-selected Normal sprites when zoomed out, and decorative culling below 0.5×.

### 6.13 Sprite resolution, GPU memory and compression

- **Two sprite resolutions,** as in Factorio's graphics setting:
  - **High:** 64 px per tile source;
  - **Normal:** 32 px per tile, downscaled at build time.
- **GPU texture budget:**
  - slice ≤ 256 MB at High (estimate: about 9 pages of 2048² with mips, about 200 MB);
  - full game ≤ 768 MB at High, ≤ 192 MB at Normal.
  - The default resolution is chosen from `WEBGL_debug_renderer_info` and a probe allocation.
- **Transport:** colour atlases ship as **WebP** (lossy q90 colour, lossless alpha). Shadows and icons ship as lossless WebP or PNG (oxipng).
- **Compression (planned for M3, when High exceeds 512 MB):** KTX2 with Basis UASTC, transcoded at load (the basis transcoder is about 200 kB of WASM) to BC7, ASTC or ETC2. That cuts GPU memory 4×.
  - The tool `basisu` is built from source with a manylinux `cmake` wheel (`uv pip install cmake`) and the system gcc 9.4, or in the podman Ubuntu 24.04 fallback (`CLAUDE.md`).
  - Neither `toktx` nor `basisu` is installed today.

---

## 7. The UI layer

### 7.1 Decision: DOM with SolidJS

**Why DOM** (I §8.1 recommends it): text, scrolling, IME, text fields, search, number fields with math, accessibility and CSS grid for 10-wide slot grids. The number of visible slots stays at most a few hundred.

**Why Solid 1.9.15:**
- fine-grained signals update exactly the changed text or attribute at 60 Hz, with no virtual-DOM diff;
- a small runtime;
- JSX with TypeScript;
- verified with Vite 8 and TS 7 here.

**Rejected:** a canvas-drawn GUI (we would rebuild text, scrolling and inputs); React (virtual-DOM cost at 60 Hz, size). Fallback: Preact 10.29.8 with `@preact/signals`.

### 7.2 Structure (`src/ui/`)

- `core/`: Window (title bar, drag handle, frame buttons, browse history), Slot, SlotGrid, ProgressBar, FluidGauge, Tabs, Button variants, ListBox, Tooltip, Choosers (recipe, item, signal), NumberField (math expressions), SearchField, Checkbox and switch, Graph (Canvas2D).
- `hud/`: research widget, side buttons, minimap hole, pins, docked entity info, quickbar, shortcut bar, crafting queue, alerts, toasts, mining bar, edge arrows.
- `windows/`:
  - the character screen (flat and tabbed);
  - entity GUIs by *kind*, generated from the entity panel's role list (I §8.3);
  - technology, production statistics, Factoriopedia (displayed as **Handbook**, 07-ui §0);
  - the World window and strip, the University window, the charter screen, the run report (07-ui §4, §7, §13, §14);
  - map (remote view chrome), electric network, settings, controls, saves;
  - later: blueprint library, logistics, trains, alerts, bonuses. (The rate calculator's window ships in M1, 07 §16.1.)
- `store/`: Solid stores fed by packets, with versioned sections and immutable snapshots.
- `input/`: §7.5.
- `i18n/`: `locale/en.yaml` for UI strings. Display names come from the data.

### 7.3 Data flow

1. A packet arrives and `ui` deltas update the stores.
2. Signals propagate only to mounted components.
3. Windows mount on open and unmount on close.
4. **No layout reads in the frame loop.** Viewport holes are measured with a `ResizeObserver`.
5. **UI budget:** ≤ 2 ms per frame with the character screen and one entity window open. A window opens in ≤ 100 ms and a Handbook search keystroke takes ≤ 50 ms (§11). Search indexes are built once from prototype data at startup.

### 7.4 Styling

- **CSS variables** hold the Factorio-like palette: dark grey frames, deep and shallow panels, the orange highlight, green confirm, red destructive.
- **Frames** use CSS `border-image` 9-slices drawn by us in SVG. No Factorio art is reused.
- **Metrics** follow I §4.0 exactly: 40 px slots with 32 px icons, 4 px grid, 8 px padding, fonts at 12/14/15/18 px, tooltips at 88% opacity with background blur and a maximum width of 356 px.
- **Font:** Titillium Web (OFL), a technical sans close to Factorio's GUI type, self-hosted from `@fontsource/titillium-web` 5.3.0.
- **Icons** are CSS sprites from the icon atlas sheets, with a 2× sheet for HiDPI.
- **UI scale:** automatic by window height (100% at 1080p), and Ctrl+Numpad± in 25% steps (I).
- **Hygiene** (I §1.5): `user-select: none` except in text fields, `dragstart` prevented on icons, `touch-action: none` on the canvas.

### 7.5 Input

Implemented exactly as I §1 specifies:

- **The action map** has Factorio's control ids, two binding columns, exact modifier matching for *press* controls and free modifiers for *hold* controls.
- **Bindings** store `KeyboardEvent.code`. Labels come from `navigator.keyboard.getLayoutMap()`, with a fallback table.
- **The wheel** is normalised into notches of about 100 px.
- **Event semantics:** auto-repeat ignored; held controls released on `blur` and `visibilitychange`; game controls suspended while a text field has focus, with I's exceptions.
- **The context resolver** (I §1.4) runs on the main thread against the view model and UI state, in I's precedence order: text, GUI, modal, tool, placeable, usable, other item, empty. It produces exactly one **UI command** or **sim `InputAction`**.
- **The capture layer** (I §1.5) applies `preventDefault` to Tab, Space, Alt (keydown and keyup), Alt+letters, Alt+arrows, Mouse4/5 (`mouseup` and `auxclick`), RMB (`contextmenu`), MMB, Ctrl+Wheel (`passive: false`), Ctrl+Z/Y/C/X/V/F and F1–F10.
  - In fullscreen on Chromium, it calls `navigator.keyboard.lock()`.
  - At startup it runs a self-test of the capture, and the Controls screen lists keys reserved by the browser.
- **Drag-building** is computed on the main thread from the view model: axis lock, adjacent stepping, smart belts with R-bending and auto-undergrounds, poles at maximum reach with early placement for coverage (I §3.4). The result goes out as `build` actions sharing a `drag_id`, which makes one undo action.
- **Hotkey hints** in tooltips render from the live binding table (I §1.6).

### 7.6 Rules

- **Pure UI state never enters the sim:** windows, hover, camera, scroll and search.
- **The sim never calls the UI.** All UI behaviour comes from prototype data and entity kinds; there is no per-item UI code.

---

## 8. Persistence

### 8.1 The save container

The container is binary: header, then sections, PNG-style.

```
magic "SITESAV\0" | u32 formatVersion | u32 headerLength | header JSON
  (game version, build hash, prototypes.hash, tick, seed, map settings, play time, thumbnail section id,
   name tables per prototype kind, pool descriptors: [{pool, field, type, length}])
sections: [u32 id | u32 rawLength | u32 storedLength | u8 codec | bytes]   codec 1 = deflate (fflate level 6)
  POOLS (raw typed arrays, little-endian)   ENTITY_TABLE   SLOT_HEAP   COLD (canonical JSON)
  CHUNKS (modified chunks: tiles, hidden tiles, resources, trees with leaf stages, world objects, leafTimer;
          occupancy rebuilt on load)   CHARTED (bitsets)
  THERMAL (sparse H, the emission and incoming accumulators, and leafTimer for pristine chunks, wherever nonzero)
  NETWORKS (what topology cannot rebuild: wires, switch states, belt contents, fluid-segment contents, circuit frames, train state)
  GLOBALS (canonical JSON; below)   TIMERS   RNG
  PLAYER   RESEARCH   STATS (ring buffers)   BLUEPRINTS (records in this save)   UNDO
  INPUT_LOG (optional, dev setting)   THUMBNAIL (WebP from the renderer)
```

**The rule** (J2): everything not listed as derived below is saved. A new piece of state either gets a section or field, or is added to the derived list with its rebuild function; the save/load hash test (§10.4) catches anything forgotten. Section by section:
- **`GLOBALS`**, the global simulation state of §4.4, defined by 01 §13.1 and 03:
  - the world's text: W_own, W_pub, Y_pub, the pending publication releases [(start tick, amount)], Σ, the two model-collapse windows (P_crawl and P_syn rings) and the crawl share c held from the last world-text pass (c is global, 03 §2.2);
  - the race state: v₀ preset, and the tick the race was finished or lost;
  - the leak L. The infections: {id, tier, member serials, next firing tick; Wild only, the tick of its last nest, for the 10-minute cap}. Wild only: nests, evolution T and its three terms;
  - the closure tick and the overhang snapshot, milestone times, achievement progress;
  - the run-report accumulators: the 60-s power ring, recent research completion ticks with the best 600-s count, the doubling-time rings and history string, the hand-crafted count;
  - the research scheduling toggle and the queue bylines (the queue itself is in `RESEARCH`).
- **Entity state** in the pools and the slot heap includes:
  - each deploying building's share ℓᵢ;
  - each machine's compromised flag and infection id, its consecutive zero-power tick count and (Wild) its escape due tick;
  - each Seminar's working-tick counter for wᵢ, and each deploying building's for the leak, both counted since the last 60-tick recompute;
  - the values cached at a cadence point and used until the next one: each Seminar's applied staff, each computing machine's throttle m (its chunk's last thermal update);
  - the Frontier cluster's run progress;
  - hall inventories: accelerators, weights and output.
- **`TIMERS`**: every timer-wheel and heap entry as (dueTick, entitySerial, eventCode), re-keyed by serial on load (§4.6).
- **`RNG`**: the states of every xoshiro stream (§4.3). Counter-based draws need no state.

**Derived, rebuilt on load and never saved:**
- the topology of transport lines, fluid segments, data networks, electric, circuit and logistic networks and rail blocks; link clusters; active lists. What they hold is saved (in `NETWORKS`): belt items and gaps per lane in canonical order from each line's front, each fluid segment's amount and temperature keyed by its lowest member serial, each circuit network's output frame of the last tick, and each train's motion, path, reservations and schedule position. A load rebuilds the topology and then refills it;
- the staffing graph and the Terminal links (rebuilt at the next recompute; the applied staff values are saved);
- u_p (recomputed every tick), `speedEff` (from saved inputs);
- σ (from Σ), j and every F(W) floor (from W);
- κ (from tiles and trees), T (from H).

Saves stay small, and "incremental equals rebuilt" is tested (§10.4).

**Size:** about 10–25 MB compressed for a late game, from 50–100 MB raw. At the slice's end it is ≤ 5 MB (§11).

### 8.2 Storage

Storage follows 07-ui §19.2. Everything runs in the IO worker.

- **Save blobs** go in the **Origin Private File System** (OPFS) where available, written with a sync access handle in the worker. Otherwise they go in IndexedDB.
- **IndexedDB** via `idb` 8.0.3 holds database `game`, version 1, with stores:
  - `saves` (name → metadata, plus the blob when OPFS is missing);
  - `settings` (Interface, Graphics, Sound, Controls);
  - `blueprints` (the library);
  - `runHistory` (the *Run history* of 07-ui §19.2: completed runs and achievements, exportable with the saves; R5-gate D4 renamed it, since a records store is an in-world archive);
  - `bench`.
- **Persistence and quota.**
  - `navigator.storage.persist()` is requested at the first save.
  - `navigator.storage.estimate()` feeds the main menu's "storage 41 MB of 2 GB" line.
  - A save that would exceed the quota is refused, with export or deletion offered.
- **One tab at a time.** A `BroadcastChannel` lock: a second tab offers *Take over*, and the first saves and drops to a read-only notice.
- **Offline.** A service worker caches the build, so a loaded game keeps working offline. Saves never leave the machine.

**Export and import:**
- the File System Access API where available (Chromium);
- otherwise a download link and a file input.

The file is the container itself, named `<name>.save`. Import refuses a newer format with a message, and older formats migrate forward (§8.3).

**Settings that affect the simulation** (map settings, the presets for Heat, runaways and r, trimmed collision) live in the save. Interface settings live in IndexedDB.

### 8.3 Versioning

- **Pools load by field name** using the descriptors in the header. Added fields take defaults and removed fields are dropped, like protobuf.
- **Semantic changes** run migration functions registered by format version, in sequence.
- **Prototypes are remapped by name.** An entity whose prototype disappeared is removed with a load report (Factorio's mod-removal behaviour). An item disappears from inventories, also with a report.
- **Golden saves** from each milestone are kept in `test/saves/` and must load in every later build (§10.4).

### 8.4 Autosave

- Every 5 minutes, into 3 rotating slots (I §4.20; both settable).
- **Non-blocking:** the sim worker copies its pools at a tick boundary (about 50 ms for a late game; the stall target is in §11) and transfers the buffers to the IO worker. That worker compresses and writes while the game keeps running.
- A toast reports the save. Saving on exit is attempted on `pagehide`.

### 8.5 Replays and bug bundles

- **Input logs.** Every `InputAction` is stored with its tick. `__game.replay(save, log)` reproduces any session bit-identically (§4.1).
- **Bug bundles** (`/report` or Ctrl+Alt+F12) contain:
  - the last autosave plus the log since it;
  - the console log;
  - a screenshot and the build hash.

  They are POSTed to the dev server (§3.5), where Claude replays them headlessly in Node to the reported tick and inspects state. This is the main debugging channel for anything the user sees.

---

## 9. Asset pipeline

### 9.1 Blender sprites (Blender 5.2.2 LTS, Cycles CPU)

**Layout:**
- `assets/blender/lib/rig.py`: camera, lights and render settings.
- `materials.py`: the palette and PBR materials. The look is Factorio-like: desaturated, a warm key light, grime.
- `parts.py`: parametric parts such as frames, panels, pipes, fans, cabinets, cable trays, card stacks, tubes, gauges and lamps.
- `entities/<id>.py`: one per entity. Each builds the model and declares its directions, animated parts, light emitters and fluid-port positions.

Each model is authored from the data's `sprite` lines and the icon and sprite legibility rules of 07-ui §23.

**Camera:**
- orthographic, pitched 45° and viewed from the south;
- rendered with non-square pixels (`pixel_aspect_x = √2`) so that ground squares stay square and heights render 1:1, which is Factorio's oblique look;
- 64 px per tile at High.

**A calibration test** (`test/assets/projection.py`) renders a 1×1×1 m cube. Its top face must be 64×64 px and its south face 64 px tall, within ±1 px.

**Lighting:** a sun from the north-west (shadows fall east), sky fill, fixed exposure, the *Standard* view transform for predictable colour, and a fixed seed.

**Passes per entity, direction and frame:**
1. **Colour:** RGBA with a transparent film, 32–64 samples plus OIDN denoising.
2. **Shadow:** the object as holdout plus a shadow-catcher ground plane, giving the shadow alpha.
3. **Light:** emission only, for night glow.
4. **Animated parts** render as a separate layer over a static base, with the static parts as holdout. That keeps animation sheets small.

**Directions and frames** (defaults, overridable per entity):

| Kind | Directions | Frames |
|---|---|---|
| Machines | 1 (4 if asymmetric) | 16 working frames, seamless |
| Belts | 4 straight + 8 curves + start/end caps | 16 |
| Inserters | Parts only (rotated in 2D) | — |
| Drills | 4 | 16 |
| Rolling stock | 64 | — |
| Agents | 16 | 2 |
| Trees | Variants × leaf stages | — |

**Throughput:**
- 4 parallel Blender processes of 8 threads each, all frames of an entity per process: `blender -b --factory-startup -noaudio --python render.py -- --entity id --res high`.
- About 1–2 s per 256² frame, so the slice's ~1,500 frames take about 30 minutes and the full set of about 6,000 about 2 hours.
- Incremental by content hash of the entity script, the library version and the parameters.

### 9.2 Post-processing and atlases

`scripts/build-assets.ts` (Node) calls Python with Pillow and numpy:
1. trim transparent borders and record anchor offsets;
2. premultiply alpha;
3. convert shadows to a single channel;
4. produce Normal resolution (½);
5. check alpha and footprint bounds;
6. pack with `maxrects-packer` 2.7.4 into 2048² pages, animation sheets as units, grouped by tier;
7. emit `sprites.json`;
8. encode WebP (cwebp) or PNG (oxipng).

**Placeholders.** From M0, every entity gets an **automatic greybox model**: its footprint as a bevelled box in its family's colour with a stencilled label. Every entity is renderable from day one, and its art replaces the greybox entity by entity.

### 9.3 Icons and UI art (SVG)

- **Item, fluid, signal and technology icons** are hand-authored SVG at `assets/svg/**/<id>.svg`, following 07-ui §23's family rules: one silhouette per family, type by colour, tier by one detail, and the hexagon meaning weights.
- **Rendering:** `resvg` at 64, 32 and 16 px (technology icons at 256 and 128), packed into the icon atlas and CSS sheets.
- **GUI frame pieces, buttons and glyphs** are SVG rendered to PNG 9-slices.

### 9.4 Audio

**Music.**
- Composed by script (music21 and pretty_midi) and rendered with FluidSynth (GeneralUser-GS).
- Mastered with pedalboard to about −16 LUFS.
- Encoded as **Opus in WebM** (96 kbps), with an AAC `.m4a` fallback chosen via `canPlayType`.

**SFX** are synthesized in Python with numpy and pedalboard (noise, filters, envelopes, convolution reverb):
- inserter swings, belt rattle loops and machine hums by family;
- build, mine and craft-finished sounds;
- UI clicks and tabs;
- alerts.

They are normalised and encoded the same way.

**Runtime** (`src/audio/`):
- Web Audio with one `AudioBuffer` per sound.
- **Working sounds** loop per entity type, with volume aggregated from visible working entities of that type (Factorio aggregates similarly) and panned by screen position.
- **Event sounds** come from `ev`, rate-limited (the error sound at most once per 100 ms, I §3.12).
- The mixer has I §4.20's categories with mute.

### 9.5 Headless visual verification (what Claude does on this machine)

1. **Contact sheets.** `magick montage` lays out every entity's directions and frames at 1× and ½×, plus colour, shadow and light passes side by side. Claude reads the PNG.
2. **Animation strips:** GIFs via `gifski` for review, and **frame registration** checked automatically: static pixels must be identical across frames.
3. **Automated asset checks:**
   - footprint and overhang limits per size class;
   - shadow direction (the centroid offset points east);
   - palette and brightness histograms within the style ranges;
   - icon **legibility**: a belt line-up sheet showing every item at 16 px on a belt, plus a confusability report (pairwise distance of 8×8 Lab-colour thumbnails; pairs below a threshold are flagged), which automates 07-ui §23's rule.
4. **In-game galleries.** `?scenario=gallery` places every entity in a grid with alt-mode on and off, by day and by night, at zooms 0.5, 1 and 2. Playwright screenshots it (seconds per frame on SwiftShader: fine for stills). Claude reviews it, and golden diffs guard regressions.
5. **Audio:** spectrograms (`ffmpeg showspectrumpic`) and EBU R128 loudness, per `CLAUDE.md`.

### 9.6 Budgets

- **Download:** slice ≤ 30 MB (§11); full game ≤ 200 MB, lazy by tier.
- **GPU memory:** §6.13.
- **Asset builds** are reproducible from the scripts. Outputs are cached outside git by content hash, and only the sources are committed.

---

## 10. Testing and verification

### 10.1 The pyramid

| Level | Tool | Runs | Share |
|---|---|---|---|
| Unit | Vitest (Node) | Gap encoding, segment merging, satisfaction, RNG, the save codec, parsers | many, milliseconds each |
| Scenario | Vitest + the scenario DSL (sim in-process) | Golden ratios, rule behaviour, determinism | hundreds, ≤ 1 s each |
| Property | fast-check | Random build, rotate and remove sequences against invariants | dozens |
| E2E | Playwright 1.64.1 + Chrome 156 (SwiftShader) | I's feel tests F1–F28, window screenshots, smoke | dozens, seconds each |
| Visual | Playwright + pixelmatch + Claude review | Galleries, windows, overlays | per change |
| Benchmark | Node runner; `bench.html` on the user's laptop | ms per tick, heap, frame time | per milestone and on hot-path changes |

### 10.2 The scenario DSL

```ts
test('memo block makes 60/min', () => {
  const w = Scenario.fromLayout('test/layouts/memo-60.txt', { power: 'infinite', seed: 1 });
  w.run(minutes(2));                                    // warm-up
  const n0 = w.stats.produced('memo');
  w.run(minutes(10));
  expect(Math.abs(w.stats.produced('memo') - n0 - 600)).toBeLessThanOrEqual(1);
});
```

**Layouts are ASCII grids.** A legend header maps characters to `entity[:dir][:recipe]`, and multi-tile entities are anchored at their top-left character:

```
# legend: C=iron-chest  i=inserter:E  A=assembler-1:recipe=iron-gear-wheel  >=transport-belt:E  E=electric-interface
C i A . . i C
. . . . . . .
. . . . . . .
```

**Helpers:**
- `place(id, pos, opts)`, `insert(entity, items)`, `run(ticks)`, `stats.*`, `entityAt(pos)`;
- `infinite power` and `infinite source/sink` test entities;
- `hash()`.

### 10.3 Golden ratio tests (expected values from Factorio and the wiki, frozen after the first pass)

| # | Scenario | Expected |
|---|---|---|
| G1 | Saturated belts, 10 min | 15 / 30 / 45 items/s; lanes half each |
| G2 | Underground pair capacity | 44 items (yellow, gap 4); 72 (express, maximum gap) |
| G3 | Splitter 1 → 2 | Exact alternation per lane; lanes preserved |
| G4 | Side-load compression | Full compression on the target lane (wiki behaviour) |
| G5 | Inserter chest → chest, stack 1 | 0.79 / 0.86 / 1.25 / 2.5 / 2.5 items/s (burner, inserter, long-handed, fast, bulk) ±1% |
| G6 | Inserter belt → chest (wiki 2.0.26 table) | Inserter 0.94; fast 2.31–2.50; long-handed 1.18–1.25 ±3% |
| G7 | Insertion limit | Inserters stop at ingredients for clamp(1 + crafts completable in 1.166 s, 2, 100) crafts (wiki); fuel at 5 |
| G8 | Stone furnace | 1 plate per 3.2 s (18.75 per minute); coal items per plate as Factorio's (ISO flow). Burner power and fuel values are ×3 (DECISIONS §18), so the furnace emits 270 kW |
| G9 | Electric mining drill | 0.5 ore/s at mining time 1 |
| G10 | Memo block (layout file) | 60 ± 1 per minute; Report block 60 ± 1 per minute |
| G11 | Steam | 1 boiler outputs 1.8 MW = 60 steam/s from 6 water/s (`extra.water_per_s`, 2.0's 1 : 10), burning 5.4 MW of fuel (DECISIONS §18) with coal items per minute as Factorio's. The boiler emits nothing; its 2 steam engines at 900 kW each emit 2 × 0.9 MW (DECISIONS §24), so the plant still emits 3.6 MW per boiler. One offshore pump (1,200/s) feeds 200 boilers |
| G12 | Brownout | At 80% supply, an assembler runs at 80% ± 1% averaged |
| G13 | Fluids | 10 chemical plants on one segment get equal shares ±10%; a pump moves exactly 1,200/s; a 251-tile pipeline carries no flow |
| G14 | Labs | Research rate = Σ speed ÷ unit time; packs drain per unit |
| G15 | Thermal field (F's calibration) | TS and `tools/ref/heat_calib3.py` (F's `calib3.py`, verbatim) agree within **0.5 K at steady state**, the one tolerance shared with 09 S-G4. Cases: 09 S-G4's (grass, ambient 15 °C, 2 chunks × 18 MW + 3 × 3 chunks × 2 MW: plant chunks (28, 32) +24.7 K and (29, 32) +25.4 K, the empty chunk (30, 32) +13.0 K, the consumer block's corner nearest the plant (31, 32) +10.1 K, the block's centre (32, 31) +9.0 K, steady within 30 game-minutes) and 03 §1.6's table |
| G16 | Staffing | Supply 2, four working speed-1 Seminars → each at 0.5 speed. With +40% speed from modules in each, demand is 4 × 1.4 = 5.6 → 0.357. A Researcher in the slot → 1.0 and demand 0 (§5.10) |
| G17 | Takeoff (M4) | A scripted takeoff from the reference closure state reproduces 04 §0's reference within 5%: the takeoff time and the time of the last 10 technologies, whose current values 04 §0 owns. The reference is `design/round4/world-sim/takeoff_r4.py` (00 §10), which imports round 2's `r2w_full.py` and G's `takeoff.py` and runs them at 60 s per unit with the round-4 closure state |
| G18 | Quality | A 10⁶-craft run matches the analytic tier distribution within 3σ, with the verifier cap (§5.16) and catalysts returned at their own quality |
| G19 | Trains | Braking distance and travel time on a straight track match the analytic physics ±1 tick |
| G20 | Agents | Delivery of 500 items between two chests: completion time ±5% of the FFF-374 arrival-time model |

**Workflow.**
1. When a golden is first written, the expected value comes from the wiki or Factorio data. The test asserts within the tolerance.
2. Once the test passes, the exact count is **frozen** as a regression golden (`test/goldens/*.json`).
3. Any change to a frozen value needs an explicit `--update-goldens` and a note in the commit message.

### 10.4 Determinism and structural invariants

1. **Repeatability:** the same scenario run twice gives the same hash.
2. **Save/load:** run to tick *t*, save, load, continue to *T*; the hash equals an uninterrupted run.
3. **NO_SLEEP equivalence** on every scenario (§4.6).
4. **Replay:** recorded E2E sessions replay in Node to the same hash.
5. **Incremental equals rebuilt** (property tests). After random edit sequences, transport lines, fluid segments, electric, circuit, logistic and data networks and rail blocks equal a from-scratch rebuild in canonical form.
6. **Conservation:** total items across inventories, belts, hands, the ground, agents and machine slots (staff, accelerator, weights and rollback inputs included) change only through recorded production, consumption, mining, crafting, rollback and destruction. Fluids likewise.
7. **Old saves:** every golden save from earlier milestones loads and runs 1,000 ticks without error.
8. **Worldgen sweeps** (09 S-G1). Every guarantee of 01 §9 is checked over 1,000 seeds, including DECISIONS §32's compactness (the four starting patches and the starting archive inside the starting college's coverage square) and the lake rule. The same seed must give identical chunk hashes twice. The sweep runs in the worker pool, about a minute on this host's 32 threads, in `npm run test:slow`. It is run nightly and before milestone exits, not in `ci`.

### 10.5 E2E and screenshots

- **Playwright config:** `executablePath: ~/.local/opt/chrome-current/chrome`, viewport 1280×720, `?test=1&render=on-demand`.
  - The renderer draws only when asked, so rendering never slows `step(n)`.
  - Measured: 20k sprites per frame take about 70 ms on SwiftShader with expanded quads.
- **Feel tests:** I §6's F1–F28 drive the **real input layer** (keyboard and mouse events), step the sim with `__game.step(n)`, and assert with `__game.query`.
- **Window screenshots:** `__game.ui.open(name)` for every window and state, with golden diffs (pixelmatch, threshold 0.1, ≤ 0.1% pixels).
- **Every E2E test fails on any console error or warning** from the page or the worker (forwarded, §3.2).
- **Smoke** (`@smoke`): new game, walk, mine, craft, place, save, reload, hash. It runs in `npm run ci`.
- **Firefox.** 09's S-G13 needs Firefox determinism hashes and S-G14 needs a Firefox capture self-test.
  - Playwright 1.64's Firefox 157 build installs user-mode (`PLAYWRIGHT_BROWSERS_PATH`, with the `ubuntu22.04-x64` override) and **launches on this host**, but has **no WebGL2** in headless mode, even with `webgl.force-enabled`.
  - Firefox runs therefore use `?render=none`, a renderer stub that keeps the canvas and DOM but draws nothing. The sim, input and UI paths are fully exercised.
  - Firefox *rendering* is checked on the user's machine (§10.7).
- **The scripted opening** (09 §7.1) is a recorded input log on a fixed seed, replayed through the real input layer on every build. Its milestone times and state hashes are regression goldens.

### 10.6 Benchmarks and calibration

**Scenarios** are generated by `bench/factories/*.ts` and stored as saves:

| Scenario | Content |
|---|---|
| `slice-3h` | A typical slice factory |
| `mid-article` | Mid-game base, §11 |
| `late-modelcard` | Late-game base, §11 |
| `belts-300k` | Belt items |
| `inserters-50k` | Inserters |
| `agents-5k` | Agents |
| `trains-100` | Trains |
| `circuits-2k` | Combinators |
| `takeoff-500` | 500 compute halls |

**Runner:** `node bench/run.ts --scenario X --ticks 3600` reports the median and p95 ms per tick, per-phase ms, heap and allocations. Results append to `bench/history.jsonl` with the git hash. `npm run ci` fails on a regression above 10% against the host baseline.

**Calibration with the user's laptop.**
- The user opens `http://127.0.0.1:5173/bench.html` through the tunnel once per milestone.
- The page runs the same scenarios in a worker, plus a render benchmark (synthetic scenes at the §6.12 sizes, frame times by `performance.now` around `gl.finish` sampling).
- It POSTs to `/__bench`.
- The measured host/laptop ratio (estimated at about 1.8 for §11's reference machine) turns host numbers into laptop predictions. The render numbers are the only GPU truth available.

### 10.7 The verification loops

**Claude's loop, per feature:**
1. Write or extend scenario tests from the spec (red).
2. Implement until they pass (green).
3. Run `npm test`. Run `npm run e2e -- --grep <area>` when input or UI changed.
4. Take screenshots of the affected scenes and windows with Playwright or MCP. **Read the PNGs.** Check the console.
5. Run `npm run bench -- --quick` if a hot path changed.
6. Run `npm run ci` before committing.

Software rendering here is visually faithful but slow, so Claude judges frames, never frame rates.

**The user's loop, per milestone or on request:**
1. Play through the tunnel on a real GPU.
2. Use `/report` for anything wrong. Claude replays it headlessly.
3. Run `bench.html` for performance truth.
4. Use `/shot` for visual issues seen only on real hardware.

Playtest checkpoints are part of each milestone's exit criteria (§12).

### 10.8 Rule scenarios (one per engine rule that the design left open until round 4)

Each is a scenario test (§10.2) in `test/rules/`, named by the critique's tag, and each also runs under NO_SLEEP and through a save/load in the middle (§10.4 #2–#3).

| # | Rule | Scenario and pass condition |
|---|---|---|
| R1 | Thermal plants (DECISIONS §24; §5.9) | Boiler + 2 engines at full load: boiler 0, each engine 1.8 MW. A loaded 2×2 fission block: reactors 0, turbines 2 × their output. The same block unloaded at 1,000 °C: its waste heat at the reactors. A fusion reactor emits only its electric draw, and its generators 2 × their output |
| R2 | Power order (U16; §5.7) | Solar + accumulators + 2 Research halls. By day the accumulators charge before the halls get power. At night discharge serves the normal load first, then the halls. In no tick does an accumulator both charge and discharge |
| R3 | Switch throttle (DECISIONS §26) | A Switch at m = 0.8 lends 0.8 of its effect; its draw is unchanged. A compromised Switch lends nothing |
| R4 | Research hall (L1, DECISIONS §25) | 19 accelerators → "Missing accelerators" with "Loaded: 19 / 20". Mixed tiers give the mean speed and power. Without *Weight transplant* an insertion into a full hall is refused; with it the lowest tier goes to the output. Modules and Switch effects never apply |
| R5 | Staffing (U1–U4, DECISIONS §23) | Demand follows module speed; an idle Seminar's demand falls to 0 within 60 ticks. A Terminal pair joins two universities' networks, and they split at the next recompute after one Terminal loses power. The coverage edge behaves as UI-G4/G5 |
| R6 | Leak (L4) | The largest share is compromised (ties: lowest serial). Removing a building subtracts its share. With no candidate, L holds at 1 |
| R7 | Compromised lifecycle (L3) | Compromised = 1 on the wire while unpowered. Mining is refused with the reason string. Progress is frozen while full power is drawn. 1,799 zero-power ticks and 1 powered tick do not clean; 1,800 consecutive ticks do; a brownout never does |
| R8 | Linear spread (DECISIONS §27) | One infection in a 40-machine Switch block gains exactly one machine per interval. An infection with no powered member gains none. Cleaned members leave. Through agents, the target must be in the source's hub area. One hop (R5-gate D6): with A compromised, A and B in one Switch area and B and C on one data line, C is never the target while B is clean |
| R9 | Rollback (L2) | The input exists only while compromised and after *Rollback recovery*. It accepts a checkpoint at tiers 1–3 and a frontier checkpoint at tier 4, from an enabled inserter. The item is consumed and the machine is clean in the same tick. An Endpoint's recipe checkpoint goes to the rollback input first |
| R10 | Quality (L5) | The output cap follows the lowest Comparator. Catalysts return at their own quality. A recipe at Verified quality refuses Standard ingredients |
| R11 | World text (J6) | *Tabulation* (Hollerith, 1889) adds nothing to W. Literature counts trigger technologies and Y_pub does not. γ scales W_own only |
| R12 | Model collapse (DECISIONS §31) | Archive-only training (c = 0) runs at full speed. Crawl-only (c = 1) runs at × (1 − σ) before *Synthetic detection* and at full speed after |
| R13 | Research scheduling (L6; R5-gate D10) | With *Research productivity* available, the Researchers queue only System-card technologies, in `meta.endgame.takeoff_order`'s order: from closure the completions run MG6, Research scheduling, Two-phase cooling, MG7, Wafer-scale integration … exactly. With *Nuclear power* unresearched, *Fusion power* is passed over and the queue never stalls |
| R14 | Prerequisites (U19) | *Model generation 25* becomes available only after *Model generation* reaches its `max_level` |
| R15 | Heat edges (U10–U12) | Heat sent toward an ungenerated chunk is booked under Map edge, and the out-of-map edge reflects. The Heat tab balances to ΔH. Leaves fall at 600 s accumulated above 45 °C |
| R16 | Productivity (DECISIONS §30) | A Learned controller is refused in a machine whose recipe disallows productivity. *Nanofabrication* applies to the base accelerator only |
| R17 | Manifests (J17) | Every milestone filter passes the closure check against the data (§2.4). Runs in `npm run check` |
| R18 | Closure gate (R5-gate D9) | With *Automated research* researched and 20,000 System cards in Seminars but no hall card, no System-card-only technology is available and none can be queued. The first *Research run* completes the hidden *Loop closed* in the same tick as `loopClosed`; *Model generation 6* and the gated hardware become available; no toast, no research log line, no Peak-research-rate count |
| R19 | Doubling readout (R5-gate D11) | A scripted rate R̄ that doubles every 60 s, dips to 10% for 30 s, then recovers: DT never reads less than the true doubling time during or after the dip, and *Fastest doubling* and the history change only at new maxima of R̄ |
| R20 | *Wild* gaps (R5-gate D13; M5) | A compromised machine with no path out keeps re-arming its escape timer and founds a nest within one interval of gaining a path out. With no agent hub, a nest lands 3 chunks beyond the built area. A laser-damage bonus changes the laser turret's damage and not the arc turret's |

---

## 11. Performance targets

This section is the **single source** of the game's performance targets (J7). 09 §8 points here, and the slice row is M1's acceptance criterion (§12).

**Machines.**
- **Reference** (every budget below unless stated): a 2019–2020 mid-range laptop with 4 cores, an integrated GPU of the Intel UHD 620 class, 8 GB RAM, current Chrome or Firefox, and a 1920×1080 window.
- **Target:** a 2022 or newer machine, for example a laptop with an i5-1240P, Iris Xe graphics and 16 GB. Everything should hold 60 FPS there, and the megabase stretch is measured there.
- **This host** runs at roughly 0.55× the reference's single-thread speed, so host budgets are reference budgets × 1.8. This is an estimate from published single-thread scores until `bench.html` confirms it on the user's machine (§10.6).

**Budgets by scale** (reference machine):

| Scale | Typical counts | Sim (ms/tick) | Frame | Worker heap | UPS |
|---|---|---|---|---|---|
| **Slice** (M1: the end of 09's tree) | About 3k entities: 2k belt tiles, 4k belt items, 400 inserters, 100 machines, 60 drills, about 24 Seminars; ≤ 2k charted chunks and about 60 generated towns. A stress save at 5k entities must still hold 60 UPS | mean ≤ 1, p99 ≤ 2 | 60 FPS at 1× | ≤ 150 MB | 60 |
| **Mid** (end of Article) | 40k entities, 20k belt tiles, 60k items, 6k inserters, 1.5k machines, 30 trains, 300 combinators | ≤ 5 | 60 FPS at 1×; ≥ 30 at 0.3× | ≤ 400 MB | 60 |
| **Late** (Model card) | 150k entities, 60k belt tiles, 250k belt items, 25k inserters, 6k machines, 5k agents, 100 trains, 2k combinators, 30k explored chunks. A 1–1.5 SPS closure base is 60–90k entities (R3-balance §7), so this leaves room for a 3–5 SPS player | ≤ 12 | 60 FPS at 1×; ≥ 30 at 0.3× | ≤ 1 GB | 60 |
| **Takeoff** | Late + 250–500 Research halls + 2 GW. 04's reference grows from 100 to 245 halls | ≤ 14 | as Late | ≤ 1 GB | 60 |
| **Megabase stretch** (target machine) | 400k entities. A *Hard takeoff* megaproject (1,000+ halls, 5 GW, about 12k more entities; 04 §7) fits here, not in the Takeoff row | ≤ 25 | — | ≤ 2 GB | ≥ 40 |

**Slice acceptance** (M1's exit; reference machine, the typical slice-end base above):

| Measure | Target |
|---|---|
| Simulation rate | 60 UPS sustained, the 5,000-entity stress save included |
| Simulation time per tick | mean ≤ 1 ms, p99 ≤ 2 ms |
| Frame at zoom 1× | 60 FPS: main thread ≤ 4 ms, GPU ≤ 6 ms (§6.12) |
| UI time per frame, character screen and one entity window open | ≤ 2 ms (§7.3) |
| Chart pan and zoom; the minimap with an overlay | 60 FPS |
| Worker heap | ≤ 150 MB |
| GPU textures | ≤ 256 MB at High (§6.13) |
| Heat field | < 0.01 ms per tick for 4,096 chunks (§5.9) |
| Staffing recompute (every 60 ticks) | ≤ 50 µs (§5.10) |
| Input to visible response | ≤ 2 frames (I §1.3) |
| First frame of a new slice game | ≤ 8 s cold, ≤ 3 s warm |
| Autosave stall | ≤ 100 ms (the pool copy only) |
| A window opens; a Handbook search keystroke | ≤ 100 ms; ≤ 50 ms |
| Save size at the slice's end | ≤ 5 MB |
| Download | ≤ 30 MB |

**Every scale:**
- **Loading** a late save ≤ 3 s.
- **Autosave stall** ≤ 100 ms (the pool copy only).
- **Garbage collection:** the sim tick allocates nothing (§2.5); main-thread GC pauses ≤ 2 ms.
- **Input latency** ≤ 2 frames from key to rendered effect.
- **Memory:** the whole tab ≤ 1.5 GB in a late game, plus GPU textures (§6.13).
- **Spikes:** a research effect burst costs ≤ 2 ms in its worst tick (§4.7).

---

## 12. Milestones

**Sizes:**
- Production and test TypeScript lines are estimates.
- **One agent-day** is one long Claude Code session producing about 1.5–2.5k lines of reviewed, tested code, or the equivalent asset work.
- The uncertainty is ±50%. Asset work (Blender, SVG, audio) is included and runs at about 20% of each milestone.

**Parallel streams.** After M0, four streams can run as parallel agents against the M0 contracts:
1. the sim;
2. the renderer and assets;
3. the UI and input;
4. worldgen and tooling.

The contracts are the `shared/` types, the prototype JSON and the sprite manifest. The critical path is sim → UI integration. With three agents, calendar time is about 45–55% of the agent-days.

| Milestone | Theme | Production / test LOC | Agent-days |
|---|---|---|---|
| **M0** | Foundations | 8k / 3k | 6–8 |
| **M1** | Vertical slice: Memo + Report, peaceful (DECISIONS §15 and §17, 09) | 41k / 20k | 38–48 |
| **M1.5** | Veteran pass (the rest of I's M2) | 4k / 2k | 3–4 |
| **M2** | Article tier: fluids, data, rails, logic | 32k / 15k | 28–36 |
| **M3** | Preprint and Model card: agents, quality, nuclear, containment | 27k / 12k | 23–29 |
| **M4** | System card: takeoff and victory | 12k / 6k | 12–16 |
| **M5** | *Wild* preset (military loop) | 18k / 6k | 16–22 |
| **M6** | Scale and polish | 8k / 3k | 8–12 |
| **M7** | Expansion (spec/06) | not estimated | — |

**Totals:**
- The complete base game with *Contained* (M0–M4) is about 124k + 58k lines and **110–141 agent-days**.
- With *Wild* and polish it is about 150k + 67k lines and **134–175 agent-days**.
- Round 4 added about 2 agent-days: the data contract (expression compiler, manifests, tiles, world objects, text data; M0) and the containment rules (rollback input, locks, linear spread; M3).

**Milestone builds are filters** (J17). Each milestone ships the full data filtered by a manifest, checked for closure by the data stage (§2.4); `design/round4/arch-data/manifests.py` runs the same check on the current data. M1's manifest is 09 §2.7's explicit list. The later ones are rules, kept in `game/data/engine/manifests.yaml`:

```yaml
wild_roots: [fire-control, projectile-damage-1, rate-of-fire-1, explosive-yield-1, laser, land-mines,
             rocketry, interceptors, energy-shield, defense-in-depth]   # combat-only roots: M5
manifests:
  m1: {from: "09 §2.7"}                        # explicit slice list; start_recipes == prior-art's unlocks; scenery: [exchange]
  m2:                                          # Article tier: fluids, data, rails, logic
    tiers: [memo, report, article]             # technologies whose packs all lie in these tiers; triggers follow their prerequisites
    exclude_branch: [M]                        # Proceedings and defence
    exclude_with_dependents:                   # systems that belong to M3
      - rejection-sampling                     # quality
      - mobile-automata                        # agents (round 2's mobile-robotics)
      - in-situ-leaching                       # nuclear
      - deep-learning                          # deployment: Endpoint, Ratings, Preprint
      - liquid-cooling                         # coolant loops
  m3:                                          # Preprint and Model card: agents, quality, nuclear, containment
    tiers: [memo, report, article, proceedings, preprint, model-card]
    exclude_with_dependents: [scaling-laws]    # the frontier run belongs to M4
    exclude_wild: true                         # wild_roots and their dependents
  m4: {tiers: all, exclude_wild: true}         # System card: takeoff and victory
  m5: {tiers: all}                             # everything, Wild included
```

- Everything else is derived: recipes, items, entities, and which resources can be extracted. A recipe that needs only a spoil result (Scooped, M4) or Wild loot (M5) is inert until then, not an error.
- On today's data, M2 has about 75 technologies, M3 about 153, M4 about 185 (with the hidden *Loop closed*) and M5 all of them, each closing cleanly. `manifests.py` prints the current counts.
- A technology that changes tier in the data moves milestone with it. That is the point of writing the filters as rules.

### M0 — Foundations (no gameplay)

**Contents:**
- the repository and pinned toolchain, `npm run` scripts, `check-arch`, the pre-commit `ci`;
- the **data stage** on `spec/data`, covering every kind including tiles, world objects and text; the expression compiler; the manifest closure check (§2.4);
- the sim core: World, surfaces, chunks, entity table, pools, scheduler, timer wheel, RNG, hash, the save container v1 (`GLOBALS`, `TIMERS` and `RNG` included), the action pipeline, worker and in-process transports, pacing, `__game`;
- worldgen v0: terrain, water, ore spots; no towns;
- renderer v0: batcher, atlases, terrain shader, camera and zoom, layers, F4/F5 debug overlays;
- UI v0: the Solid shell, Window and Slot, input core (action map, capture layer, resolver skeleton);
- the asset pipeline v0: the rig, greybox auto-models, the projection calibration test, atlas packing, contact sheets;
- the test harness: the scenario DSL, the rule-scenario folder (§10.8), Playwright config, golden helpers, the benchmark runner and `bench.html`;
- the dev-server endpoints.

**Exit:**
- A placeholder character walks on generated terrain at 60 UPS.
- Chests can be placed and mined through actions in tests.
- Save, load and hash match.
- Every manifest passes the closure check (R17).
- The smoke screenshot has been reviewed.
- `npm run ci` is green.

**Risks:**
- TS 7 checker gaps (fallback 6.0.3).
- The SwiftShader speed (measured, mitigated by on-demand rendering).

### M1 — Vertical slice: Memo + Report, peaceful

**The scope is 09's:**
- the technologies, items and buildings of 09 §2.7's `slice` manifest, built as a *filter* over the full data (§2.4); the counts are 09's;
- systems as in 09 §3; UI as in 09 §6 (I's M0 and M1, the veteran tools of DECISIONS §17, statistics, the Handbook and the read-only chart);
- build order S0–S10 (09 §10).

The three phases below group those steps for sizing: M1a ≈ S0 and S2's hand, M1b ≈ S1 to S9, M1c ≈ S10 plus art.

**M1a — Logistics core:**
- the character, collision, reach;
- inventory, hand, quickbar, crafting queue with chain crafting;
- build, mine, rotate; pipette;
- **the veteran tools of DECISIONS §17:** smart belt dragging (R-bend, auto-undergrounds, "Too far to connect"), fast-replace for all groups, copy and paste of entity settings with sweep, undo/redo (I §3.4, §3.10, §3.11). The sim-side undo stack and ghosts-as-undo come with them; I's F1–F3, F7, F13, F16, F17 and F24 are slice tests (09 §7.2);
- belts in the slice's tiers, undergrounds, splitters, side-loading;
- inserters (burner, basic, long-handed, fast);
- burner and electric drills, stone furnace, Keypunch, chests, burner energy, ground items;
- rendering of belts, items, inserter arms and machine animations;
- the character screen and transfers (I M1.1–1.3).

**M1b — Power, machines, research, world:**
- electric networks and poles, with the demand classes of §5.7;
- the offshore pump, boiler, steam engine, pipes and pipe-to-ground (fluid segments, water and steam from the data's ratios), with DECISIONS §24's emission at the engines;
- solar panels with 01 §3's sunlight factor, the day cycle, lamps and radar (09 §3);
- assemblers 1–2;
- Seminars, research, triggers, the technology screen, multi-level prerequisites;
- **tiles and world objects** from the data; **towns** (the college town, university, archive, streets and buildings), the **Laboratory salvage**, the starting-area guarantees of 01 §9 and DECISIONS §32; **staffing** (§5.10) and its overlay;
- the **thermal field** (§5.9: Map edge, reflection, leaf timers), its overlay and the *Heat* statistics tab;
- the world text's slice part: W (W_own, W_pub, Y_pub), Literature from `regime: cited` technologies, Field and years ahead (§5.11);
- entity GUIs, tooltips, alt-mode, status LEDs and warning icons, the **status-light layer**;
- the read-only map view with the slice's overlays: electric network, heat, staffing, resources (I §4.11 P0, 07-ui §3);
- the World strip and window, the charter screen, milestone log lines (07-ui §4, §14, §15);
- toasts, the Handbook (Factoriopedia), production statistics with the Papers item and the Heat tab;
- the **rate calculator** (Alt+X) and **trimmed collision** (DECISIONS §17, 07-ui §16);
- saves, autosave, the main menu, settings and the Controls screen.

**M1c — Slice content, art and audio:**
- Blender art for about 45 slice entities and the town and salvage world objects;
- about 70 item icons and the slice's technology icons;
- about 30 SFX and 2–3 music tracks;
- night lighting;
- golden tuning;
- **playtests with the user** through the tunnel, and `bench.html` on their laptop.

**Exit** (09 §0, §7; §11):
- Every technology of the slice manifest is researchable, ending in the end-state line.
- The scripted opening meets 09 §7.1's milestone times.
- The F-tests of 09 §7.2 pass, and S-G1–S-G19 pass. That includes Firefox hashes and capture via `?render=none`, and the throttle path on the dev entity.
- §11's slice acceptance table holds on the reference machine.
- G1–G12 and G14–G16 pass (G13 needs M2's full fluids; G16's module case waits for M2's modules), and so do the rule scenarios of §10.8 that the slice can run: R1's boiler case, R5 without Terminals or modules, R11, R14 (on a test prototype: no slice technology is multi-level), R15 and R17.
- The user's Factorio-comparison playtest is within 09's 10% / 15%.

**Risks:**
- Belt and inserter timing fidelity (G5–G6 golden calibration).
- UI breadth.
- Art throughput and consistency (contact-sheet reviews, the user's taste).
- Smart-belt edge cases (F1–F3 are the guard), now inside the slice.

### M1.5 — Veteran pass (the rest of I's M2)

DECISIONS §17 moved smart belts, fast-replace, copy/paste of settings and undo into M1. What remains:

**Contents:**
- ghost building filled by hand (Shift+LMB), beyond the ghosts that undo creates;
- full remote view (remote GUIs, ghost cursor, mine = deconstruction mark), pins, tags, map search;
- quickbar pages, the copper-wire tool, browse history, number fields with math;
- the chest limit bar, the splitter GUI, electric network graphs;
- *Even distribution* (setting; 07-ui puts it after the slice).

**Exit:** I's F1–F28 all pass.

**Risk:** remote-view breadth (F25, F26).

### M2 — Article tier: fluids, data, rails, logic

**Contents** (the `m2` manifest):
- Full fluids 2.0: pumps, tanks, extents, temperatures.
- **Data lines** (category `data`), barrels and drives, data networks.
- Coal chemistry (the chemical plant), batteries, explosives.
- **Exchanges and crawlers** (an infinite resource with decay), the data refinery and data plant (with `amounts_by_j`), the electric furnace and Tokenizer, W, j and σ readouts.
- The Trainer, checkpoints and catalyst recipes; the experiment loop (Experiment, Analysis, Meta-analysis).
- Modules of levels 1–2, with `allow_productivity`; cooling towers; accumulators and the full allocation of §5.7; *Dennard scaling* 1–2.
- **Terminals** (*Time-sharing*) and *Web search*'s commuting radius (§5.10).
- Bulk inserters and the batch-size research.
- Cliff explosives are not here: they need *Terminal ballistics* (Branch M), so they arrive with M3. Concrete, landfill and cliffs are already in the slice.
- Fog snapshots (radar itself is in the slice).
- **Trains:** 2.0 rail geometry, the rail planner, signals, chain signals, stops, schedules, **interrupts**, train limits, fluid and data wagons, the train GUI.
- The car.
- **The circuit network** (wires, the four units, display panel, speaker, power switch, core control behaviours).
- **Blueprints**, books, the library, deconstruction and upgrade planners, copy/cut/paste (I's M3 list).
- Alerts, inventory filters, the bonuses GUI.
- Optional: Factorio blueprint import.

**Exit:**
- An Article-tier base runs at 60 UPS at the Mid scale.
- G13 and G19 pass, and so do R2 (on a dev entity of the interruptible class, as S-G10 tests the throttle), R5 (with Terminals and modules) and R16's controller case (its *Nanofabrication* case runs in M4).
- A user playtest.

**Risks:**
- The 2.0 rail geometry and rail planner (the largest single piece).
- Fluid sharing feel.
- The breadth of circuit control behaviours.

### M3 — Preprint and Model card: agents, quality, nuclear, containment

**Contents** (the `m3` manifest):
- **Agents:** hubs, construction and logistic agents, logistic chests, dispatch, charging, item requests, the personal roboport and equipment grid, the logistics panel and groups.
- **Quality** (§5.16) and the Verifier.
- Nuclear: reactors (waste heat included), heat pipes, exchangers, turbines, the centrifuge, Kovarex.
- Liquid cooling (coolant with its temperature filters, dry cooler, water exchanger), *Dennard scaling* 3–5 and immersion cooling.
- **Switches** (1/√n, their own thermal class and throttle; DECISIONS §26) and modules of level 3.
- **Deployment and *Contained* runaways:** Endpoints and Ratings, σ and model collapse, the leak L, compromise and its locks, linear spread, Monitors and Evaluation sets, the rollback input, the Proceedings branch's containment technologies.
- Express belts, assembler 3, the half-track.
- The full circuit coverage.
- Texture compression (KTX2).

**Exit:**
- The Late scale runs at 60 UPS on the laptop.
- G18 and G20 pass, and so do R1's nuclear cases, R3, R6–R8, R9 at tiers 1–3, R10 and R12.
- Containment scenarios are deterministic.
- A user playtest.

**Risks:**
- Agent performance at 5k+.
- Quality combinatorics in the UI.
- Coolant and thermal interplay tuning.

### M4 — System card: takeoff and victory

**Contents** (the `m4` manifest):
- The **frontier cluster**, run shards, the payload and the empty launch.
- **Researchers** in staff slots; Research halls with their inventories and loading rules (§5.5); the **interruptible load** class in use.
- **Generations** with retroactive Π and multiple completions per tick; ***Research scheduling*** in `meta.endgame.takeoff_order`'s order (R5-gate D10); the hidden *Loop closed* and its craft-recipe trigger, which gate the takeoff behind closure (D9); *Weight transplant*.
- **Hollow work** (03 §4): only Researcher-staffed Seminars do it, and Researchers arrive here.
- Fusion, *Sparse inference*, *Reversible logic*, *Energy per operation*.
- The Constructor and the Area scanner (§5.2).
- **The run report**, the achievements (08-text §6, held in `text.yaml`; those reachable earlier ship with their milestones) and their window (07-ui §13.7; R5-gate D12i), the doubling-time readout with its running maximum (D11).
- **Race mode** and *Scooped* (§14).
- Infinite technologies, with effects coalesced per tick.
- A balance pass against G's targets.

**Exit:**
- G17 passes, and so do R1's fusion case, R4, R9's tier-4 case, R13, R16's *Nanofabrication* case, R18 and R19.
- A scripted full takeoff from a closure save reaches the capstone within 5% of 04 §0's 50.0-min reference (G17).
- The user plays a takeoff; that playtest records the time from the first frontier run to closure, which decides the plateau knob by 04 §1's pre-registered trigger (more than 2 h: four runs).

**Risks:**
- Balance of the spatial thermal field against G's aggregate model (G §4.8).
- The spectacle rendering of the final 40 s.

### M5 — *Wild* preset (optional)

**Contents:** the `wild_roots` technologies and everything that depends on them (the manifest's rule): units, spawners, hierarchical pathfinding, groups and expansion, damage and resistances, turrets, artillery, interceptors, unit art. Fences, gates and the containment side of Branch M ship in M3, and repair packs (*Maintenance*) in M2.

**Exit:** Factorio-like attack and expansion behaviour; 1,000 units in ≤ 2 ms per tick; R20.

**Risks:** pathfinding cost in JS, and the art volume.

### M6 — Scale and polish

**Contents:**
- megabase profiling (static chunk vertex buffers, WASM for one system if needed);
- save size;
- a main-menu background simulation;
- tips and tricks with simulations;
- colour-blind LUTs;
- complete settings;
- a Firefox/Safari pass.

### M7 — Expansion

Per 06:
- surfaces (already in the core);
- the launch site and Space Age-style platforms;
- the Stacks via a shaft lift (inter-surface cargo);
- the Biology line on the continent (06 §1 #3);
- Mercury, the cold moon, and interstellar seeds that build only through the Constructor, with no remote view.

**The thermal model becomes per surface,** behind one interface:
- the continent and the Stacks keep the chunk field (§5.9);
- a platform has one heat pool with radiators, `P = ε·σ·A·(T⁴ − T_bg⁴)`, which is polynomial, so no transcendental functions are needed (§4.1);
- the cold moon uses heat as an input: an Aquilo-style freezing rule driven by the heat-pipe network.

Not estimated until 06 goes beyond an outline.

---

## 13. Risks (cross-cutting)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Scope: about 150k lines of TS plus assets | High | High | Data-driven systems, milestone exits, parallel agents on fixed contracts, ruthless deferral (*Wild*, expansion) |
| Feel fidelity (belts, inserters, drag-building) | Medium | High | Wiki goldens G1–G7, I's F-tests, early user playtests in M1 |
| UI breadth (about 25 screens) | High | Medium | Generic kinds, data-generated grids and tooltips, screenshot goldens |
| Art quality and consistency from procedural Blender scripts | Medium | High | Parts library, style checks, contact sheets, greybox-first, user review per batch |
| JS performance in the late game | Low–medium | High | SoA, sleeping, cadences, benchmarks with a regression gate, the WASM escape hatch |
| Determinism bugs | Medium | Medium | `check-arch` bans, NO_SLEEP equivalence, save/load and replay hashes, counter RNG |
| SwiftShader slowness limits visual testing | Certain | Low | Expanded quads, on-demand rendering, small viewports, the user's `/shot` |
| Browser constraints (key capture, storage eviction, memory) | Medium | Medium | Capture self-test, `storage.persist()`, export, a memory budget |
| Design churn from rounds 3–5 | High | Medium | YAML-first, generated ids, rule-based tests rather than name-based ones |
| Parallel agents colliding | Medium | Medium | Layer boundaries enforced by `check-arch`; one owner per directory per milestone |
| Rules invented at implementation time | Medium | High | Every open case the design left is stated here with a rule scenario (§10.8); the data stage refuses prose where the engine reads (§2.4); the owning chapters carry the same sentences |

---

## 14. Objections and flags (per the DECISIONS rule: implement as decided, object here)

1. **Resolved: the veteran tools are in the slice** (DECISIONS §17). Smart belt dragging, fast-replace, copy/paste of entity settings and undo/redo are in M1, together with the rate calculator, status lights, trimmed collision and the milestone log; 09 §6 and §7.2 now agree. M1.5 keeps ghosts, remote view and the smaller I M2 items (§12).
2. **Resolved: boiler data** (J3). The data carries 2.0's water per steam (`extra.water_per_s`: 6 for the boiler, 10.309 for the heat exchanger) and the fluids' heat capacity, and the round-1 boiling pseudo-recipe is gone. The engine reads the ratio from the data (§5.8).
3. **Resolved: interruptible compute and accumulator charging** (U16). The order is normal → accumulator charging → interruptible, with discharge serving normal first and then interruptible, and never charge and discharge in one tick (§5.7). 04 §3.1 states the same rule. A Researcher-staffed Seminar uses min(sat_normal, u_p) (§5.5).
4. **Spoilage for *Scooped* (cost note, 03 §5).** 03 adopts Space Age spoilage for exactly one item (`significant-result` → `baseline` after 54,000 ticks).
   - The engine stores spoil ticks only for spoilable item types: a side table keyed by inventory slot, and a parallel `Uint32` spoil-tick array allocated only for transport lines that have carried a spoilable item.
   - About 2–3k lines in M4, with zero cost when *Scooped* is off.
   - No objection beyond the cost.
5. ***Wild* preset.** About 18k lines plus unit art and pathfinding. The plan ships version 1.0 with *Off* and *Contained* (DECISIONS' default) and *Wild* as M5. The user should know the price before choosing.
6. **Fog in the slice.** The slice renders live state under a fog tint. ISO frozen snapshots arrive in M2 (radar itself ships in the slice). Nothing hides in a peaceful slice, so this is invisible.
7. **Items carry no provenance** (resolves the round-2 flag on *The curse of recursion*).
   - The coordinator's note on DECISIONS §31's accuracy refinement suggests tracking the provenance of training text per Trainer input or per carrier. The engine does not: that would put metadata on every data item, belt slot and fluid box, break stacking, and cost memory on every belt.
   - Instead, 03 §2.2's rule is global and exact for what it measures. The crawl share c comes from the Site's own production windows (§5.11): an archive-only Site has c = 0 and pays nothing, and a crawl-only Site has c = 1.
   - 08 §6 #12 reads the same quantity (the Trainer slowdown σ·c), as a machine-readable condition in `text.yaml`.
   - A Site that mixes both sources pays the Site-wide average on every text-trained recipe. That is the documented approximation, and a legible one.
8. **Pseudo-recipes.** The engine relies on `pseudo: true` to keep the frontier-run launches (the empty launch included) out of crafting. The data should keep the flag on every pseudo-recipe.
9. **Proposal: Factorio blueprint import** (M2, about 1 agent-day). Possible because every entity and recipe has `mirrors`. It brings a veteran's own designs into the game, using user data only and no Factorio assets. For the user to accept or drop.
10. **Town era skins (cost note, 01 §5.3).** 01 sets five skins by W, across five town classes plus the exchange building's three looks. That is the largest art set of the base game after the machines.
    - Plan: a parts kit of roofs, façades, signage and antennas per era, assembled procedurally per building in Blender.
    - 09 ships the slice with the first two skins (09 §9); the rest come with the later milestones' art.
11. **Resolved: closure and Research halls.** DECISIONS amendment 16 fixes closure as the first System card written by a Research hall, and 04 keeps both shapes: Research halls write cards, and Researchers staff Seminars. The engine has both (§5.5), with closure as a one-shot sim event.
12. **Naming in code.** The pollution analogue is `thermal` and nuclear heat is `heatNet`, so the code never confuses them. The UI's words are 07 and 08's.
13. **Linear spread needs a per-infection timer** (DECISIONS §27). "Each compromised machine infects at most one new target per spread interval" is linear only if the timer belongs to the infection: with one timer per machine, a dense cluster still doubles every interval. §5.17 therefore keeps one timer per infection, as 03 §3.3 now states. Each machine still infects at most one target per interval.
14. **Resolved: the leak's "working" is a fraction** (L4, U27). L4 accrued every 60 ticks for buildings whose progress "advanced this tick". Sampling one tick in sixty would make the leak depend on where a craft cycle happens to stand. §5.17 uses wᵢ, the fraction of the last 60 ticks with progress: the same shape as staffing's working share (U1), which is measured on readiness (job, papers, power) rather than on progress, so the two differ, for instance for a Researcher Seminar at u_p = 0; equally deterministic, with the same mean. 03 §3.2 now states it.
15. **Round-1 document I remains normative for M1** (J8). Controls, GUIs, the feel tests and the `InputAction` list are I §1–§8's, and this document implements them by reference (§3.2, §5.1–§5.2, §7.5). 09's M1 reading list makes the cited sections normative. Any later change to I needs a spec round, like a change to the data. D §12's legibility rules now live in 07-ui §23, and F's heat script in `tools/ref/`.

---

## Appendix A — Measurements on this host (2026-10-19)

The scripts are kept in the repository (N11):
- `design/round4/arch-data/bench/glbench/bench.mjs`, `bench2.mjs` and `bench3.mjs` (WebGL2);
- `design/round4/arch-data/bench/simbench/bench.mjs` (sim loops);
- `design/round4/arch-data/bench/pwff/ff.mjs` and `ff2.mjs` (Firefox against Chrome);
- `design/round2/A-stack-test/` (the toolchain smoke project).

M0 moves the benchmarks into `game/bench/`.

**WebGL2 in headless Chrome 156** (ANGLE / Vulkan / SwiftShader), 1280×720, one texture array, alpha blending, 5 frames averaged with `readPixels` sync:

| Sprites × on-screen size | Instanced (vertex divisor) | Expanded quads + index buffer |
|---|---|---|
| 5,000 × 32 px | 116–130 ms | 28–30 ms |
| 20,000 × 32 px | 378–382 ms | 69–79 ms |
| 20,000 × 8 px | — | 15 ms |
| 60,000 × 16 px | 1,145 ms | — |
| 150,000 × 8 px | 2,932–3,101 ms | 102–105 ms |

- The ANGLE flags `--use-angle=swiftshader` and `swiftshader-webgl` made no difference.
- CPU fill of 100k sprites × 8 floats: 1.2 ms.

**Simulation loops in Node 24** (simplified, SoA typed arrays; per entity per tick):

| Loop | Cost |
|---|---|
| Transport lines (40k lines, gap-encoded) | 6.6 ns |
| Inserters (15k active of 30k) | 14.6 ns |
| Crafting machines (10k) | 11.6 ns |
| Electric consumers (60k, 2 passes, 2 classes) | 8.1 ns |
| Thermal field chunk update | 43 ns |

**Cross-engine floating point** (Firefox 157 and Chrome 156, headless on this host, 16,000 samples of `sin`, `cos`, `exp`, `log`, `pow`, `atan2`, `tanh` and `cbrt` over 2,000 arguments): 492 results differ. By function: `exp` 179, `cbrt` 157, `sin` 61, `cos` 53, `log` 35, `atan2` 7. This is the evidence behind §4.1's ban. Firefox 157 launches here but reports no WebGL2 in headless mode.

**Toolchain smoke test.**
- It was run first with the latest releases, then again with the exact pins of §2.1.
- TS 7.0.2 checks a four-way split config (sim, worker, app, ui).
- Vite 8.3.2 builds a module worker and a Solid page.
- Vitest 5.0.3 runs tests in a `node`-environment config. Under the Solid plugin it switches to jsdom and fails without jsdom installed, which confirms the separate config.
- Biome 2.5.15 lints.
- Solid 1.9.15 with vite-plugin-solid 2.11.14 builds and type-checks.
- oxc-parser 0.153.0 detects banned APIs.
- fast-check 4.10.2, zod 4.6.5, fflate 0.8.3, fake-indexeddb 6.2.5 and simplex-noise 4.0.3 run.
- maxrects-packer 2.7.4 runs through its `.mjs` path only.

Combining `dom` and `webworker` libs in one tsconfig fails, which confirms the per-layer configs.

## Appendix B — Interfaces with other specs (who supplies what)

| Engine module | Consumes | Owner and section |
|---|---|---|
| Data stage, every system | Items, recipes, entities, technologies, resources, enemies, tiles, world objects; `meta` (tiers, categories, start inventory and salvage, `meta.quality`, `meta.heat`, `meta.staffing`, `meta.world`, `meta.runaways`, settings, effects); the expression grammar | R4-data (`spec/data`, `SCHEMA.md`, 02, 05); the meta blocks' rules in 01 §13 and 03 |
| Data stage: text | Loading tips, tips and tricks, milestones, town-name lists, achievements with machine-readable conditions, `world_text` (`text.yaml`); the UI's status, alert and log strings come from 08 into `game/locale/en.yaml` | R4-ui (07, 08, `text.yaml`) |
| §2.4, §12 build filters | The slice manifest | R4-ui (09 §2.7); the later filters are this document's (§12) |
| §4.4 trimmed collision | The rule | this document (assigned by 07-ui §16) |
| §4.4, §5.18 tiles and world objects | Tile κ, buildability, walking speed, map colours; trees, rocks, town buildings, campus, landmarks; the salvage | R4-data (`tiles.yaml`, `world.yaml`, `meta.start.salvage`); rules in 01 §2, §5, §9 (R4-world) |
| §5.5 machines, halls, staff slot, product rules | Productivity eligibility; hall tiers, slots and recipe; the Researcher (01 §8.6); `amounts_by_j` (03 §2.1); model collapse (03 §2.2) | R4-data (02), R4-world (01, 03, 04) |
| §5.6 archives, exchanges, Endpoint | Taps, yield, floor and closing (01 §7); the Endpoint (03 §2.4) | R4-world (01, 03), R4-data (resources, entities) |
| §5.7 energy | Fuel and burner ×3, generator emission, waste heat, the allocation order, the compute energy effects | R4-world (03 §1.1, §1.4; 04 §3), R4-data (entities, effects) |
| §5.9 thermal | Emission, field, classes, coolant, guards, *Heat: off*, edges (03 §1); the golden script `tools/ref/heat_calib3.py` | R4-world (03) |
| §5.10 staffing | T(W), coverage, demand, networks, the Terminal, states (01 §8) | R4-world (01), R4-data (`terminal`) |
| §5.11 world text | W, Y_pub, j and σ, model collapse (01 §12, 03 §2.2); the doubling-time readout (04 §9) | R4-world (01, 03, 04) |
| §5.12 research, M4 | Generation costs, Π, r presets, the scheduling rule and `meta.endgame.takeoff_order`, the hidden *Loop closed*, multi-level prerequisites, citation regimes | R4-world (04), R4-data (05, technologies) |
| §5.16 quality | Tiers and unlocks, the verifier ladder, catalyst flags, the stat slope | R4-data (02, `meta.quality`); the per-type stat table is this document's overlay |
| §5.17 runaways | Deploying buildings, the leak, links, linear spread, the locks, the rollback input, cleaning, *Wild* (03 §3); hollow work (03 §4); *Scooped* (03 §5); race (03 §6) | R4-world (03) |
| §5.18 worldgen | Biomes and climate (01 §2–§3), patches (01 §4), towns (01 §5), archives (01 §6), starting area (01 §9) | R4-world (01), R4-data (resources, tiles, world) |
| §5.20 statistics, achievements, run report | Achievement conditions (08-text §6, `text.yaml`), milestone log lines (08-text §8.4), console (08-text §8.6), run report (04 §8, 07-ui §13.3, 08-text §4.1) | R4-ui (07, 08), R4-world (04) |
| §6.9 overlays | Registry and scales (07-ui §3) | R4-ui (07) |
| §7 UI, §8 storage | Screens, strings, slice UI scope, browser layers (07-ui §19) | R4-ui (07, 08, 09) |
| §9 assets | Sprite lines (data), icon and sprite legibility rules (07-ui §23) | R4-data, R4-ui |
| §11 performance | — | this document; 09 §8 points here |
| M7 | Surfaces and their twists | R4-world (06) |

**`InputAction` additions to I §8.2:**
- `set_staff_slot` (also covered by ordinary transfers);
- `distribute(entities, itemKey, count)`;
- `place_blueprint(record, pos, dir, flip, mode)`;
- `rename(entity, text)`;
- `set_hall_mode(entity, testTimeCompute)` (M4; also settable by circuit);
- `train_schedule_edit(…)` and `interrupt_edit(…)` (M2);
- `logistic_request_edit(…)` (M3);
- `launch_empty(entity)` (M4: the Frontier cluster's empty-launch button, 04 §2.1);
- `set_research_scheduling(enabled)` (M4: the "Researchers fill the queue" checkbox, 07 §5.3; saved state, so replays need it as an action);
- `constructor_settings(…)` (M4).

**Queries:** `rates(area)`, `map_search(text)`, `total_raw(recipe)`, `where_made(item)`, `patch_info(resource)`.

## Appendix C — Sources

**Friday Facts** (local dumps in `round1/I-data/fff/` and fetched):
- 176 (belt transport lines: gap encoding, line merging, about 9-tile lines under inserters);
- 209 (electric network grouped by prototype);
- 317 (enemy pathfinding: abstract per-chunk region nodes as the A\* heuristic, cached and resumed);
- 366 (test practice: GUI tests through real input, test dependencies);
- 374 (agent task queues, arrival-time dispatch, chunk spiral search, charging heuristics);
- 377 and 389 (2.0 rails, train control);
- 384 (combinators 2.0);
- 390 (noise expressions);
- 402 (radar circuit channel, several crafts per tick);
- 409 (beacon 1/√n profile, transmission 1.5);
- 416 and 430 (fluid segments, 100 units per operation × fullness, 250×250 extents, pumps 1,200/s, 1:10 steam);
- 419 (inserter pickup snapping);
- 421 (sleeping roboports, keep-revealed counters, agents every 20/60 ticks, memory-bound electric update).

**Factorio wiki:** *Transport belts/Physics* (positions, curves, splitters, side-load points); *Inserters* (speeds, throughput tables from 2.0.26, insertion limits, lane preference); *Railway/Train path finding* (penalties, repath triggers); *Pollution* (64-tick chunk cadence, 2% diffusion, minimum 15); *Electric system* (priorities).

**Factorio changelog:** `round1/I-data/changelog.txt` (2.0.7: 1 water → 10 steam in boilers and heat exchangers; 2.1.7: the per-product `affected_by_quality` flag).

**Prototype values:** `round1/I-data/data/entities.lua`, `transport-belts.lua`, `mining-drill.lua` and `utility-constants.lua` (rotation and extension speeds, belt speeds, insertion-limit constants, the burner inserter's 50 kJ per movement). Numbers only.

**Round-1 specs:** B §4 (L1–L16), D §1–§14 and its data, E §2, F §1 and `calib3.py` (now `tools/ref/heat_calib3.py`), G §2–§6 and Appendix A, I §1–§8, A §9–§10, H §3–§5, C §5.

**Round-3 critiques** (the round-4 worklist): `design/round3/R3-implementability.md` (with `impl-data/r3_checks.py` and `r3_xref.py`), `R3-balance.md`, `R3-fun.md`, `R3-coherence-tone.md`, `R3-accuracy.md`.

**Round-4 scripts:** `design/round4/arch-data/manifests.py` (the milestone filters' closure check, §12) and `design/round4/arch-data/bench/` (Appendix A).

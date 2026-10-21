# Browser game project

## Host constraints (cpuserver10)
- Ubuntu 20.04, kernel 5.4, **glibc 2.31**, 2× Xeon E5-2650 v2 (32 threads, AVX but **no AVX2** → x86-64-v2), 62 GB RAM, no usable GPU.
- Runs 24/7 and **must not be rebooted**; work entirely as user `mewse` — no root, no system packages.
- Prebuilt binaries that need glibc > 2.31 or AVX2 fail here (e.g. resvg's GitHub release). Fallbacks, in order:
  conda-forge via `micromamba`, npm/PyPI packages, then a rootless `podman` container
  (Podman 5.8.4 works; its cgroup-v1 caveats are documented in `~/qwenxcl/CONTAINERS.md`).
- Layout: tools in `~/.local/opt/<tool>-<version>` with `<tool>-current` symlinks, commands in `~/.local/bin`.
- **Benchmarking here:** socket 0 = CPUs 0–7 (+ HT 16–23), socket 1 = 8–15 (+ 24–31); pin benchmarks with
  `taskset -c 0-7` and heavy jobs to socket 1. The clock is not stable: under load the CPUs mostly run at the
  2.6 GHz base clock and get turbo (≈3.3 GHz) only in windows of minutes, so single runs can differ by ~25%.
  Interleave the variants you compare, repeat, and log the clock (`design/engine-study/harness/freqlog.sh`).
  Node 0 is usually short of free memory (page cache), so big allocations spill to node 1 and automatic NUMA
  balancing then migrates them under the running job (rare 10–20 ms stalls in any language);
  `numactl --membind` fails here (EINVAL).
- Verify everything with `tools/check-toolchain.sh` (~45 s; Blender EEVEE and the browser launches dominate).

## Toolchain
- **Node 24 LTS** + npm (global prefix `~/.local`). `/usr/bin/node` is v10 — never use it.
- **Python**: `uv` (Pythons 3.12/3.13). `gamedev-python` = 3.12 venv `~/.local/opt/gamedev-py` with numpy, scipy,
  soundfile, pedalboard, mido, pretty_midi, music21, librosa, matplotlib, pillow, opensimplex, fonttools, brotli,
  jsonschema.
  Add packages: `uv pip install --python ~/.local/opt/gamedev-py/bin/python <pkg>`. System `python3` is 3.8.
- **Browser**: Playwright 1.64 (global) + Chrome for Testing 156 at `~/.local/opt/chrome-current/chrome`
  (`chrome-headless-shell-current` too). WebGL2 and WebGPU run on SwiftShader (software): simple scenes hit 60 fps,
  heavy scenes will be slower here than on the player's GPU. `playwright install` needs
  `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu22.04-x64` (set in `~/.zshrc`).
- **Playwright MCP** (`.mcp.json`): browser_navigate / take_screenshot / evaluate / press_key …
  It blocks `file://` — serve over `http://127.0.0.1:<port>`.
- **3D**: `blender` = wrapper for Blender 5.2.2 LTS. Script it headless:
  `blender -b --factory-startup -noaudio --python gen.py -- <args>`; export with `bpy.ops.export_scene.gltf`
  (omits cameras/lights unless `export_cameras=True` / `export_lights=True`; glTF is Y-up, Blender Z-up).
  Cycles (CPU, ~4 s for 640×360 @ 64 spp) works anywhere; EEVEE needs the wrapper, which adds conda Mesa 26
  llvmpipe + Xvfb (the host's Mesa 21 renders EEVEE blank).
- **glTF**: `gltf-transform` (optimize, meshopt/draco, texture resize), `gltfpack`.
- **2D**: `resvg` / `rsvg-convert` (SVG → PNG), ImageMagick 7 `magick`, `oxipng`, `pngquant`, `cwebp`, `gifski`.
- **GPU textures**: `basisu` 2.50 (Basis Universal, built from source with the system gcc into `~/.local/opt/basisu-2.50`;
  its WASM transcoder is in `webgl/transcoder/` there) makes the KTX2 atlases: XUBC7 for colour, ETC1S for shadows
  (spec 10 §9.2). `cmake` for such builds: `~/.local/opt/buildtools-venv/bin/cmake`.
- **Audio**: `fluidsynth` with SoundFonts in `~/.local/share/soundfonts` (GeneralUser-GS.sf2 — free for any use;
  FluidR3_GM.sf2 — MIT), `sox`, static `ffmpeg` 9 (opus, vorbis, mp3, aac), pedalboard (effects/mastering), `lame`, `opusenc`.
- **Misc**: `jq`, `fd`, `rg`, `gh`, `zstd`, `micromamba` (root `~/.local/share/mamba`; env `media` = conda CLI tools,
  env `mesa` = GL stack for Blender), `numactl`/`numastat` (conda-forge, `~/.local/opt/numactl-2.0.18`).
- **Rust / WebAssembly** (WP A1): rustup 1.29 with Rust **1.99.1** (default toolchain; targets x86_64 and
  `wasm32-unknown-unknown`; clippy, rustfmt). `RUSTUP_HOME=~/.local/opt/rustup`, `CARGO_HOME=~/.local/opt/cargo`,
  exported in `~/.zshenv` (non-interactive shells too); `cargo`, `rustc`, `rustup`, `rustfmt`, `cargo-clippy` in
  `~/.local/bin` are wrappers that also set them. Crates pin the toolchain in `rust-toolchain.toml`.
  `wasm-opt` / `wasm-dis` / `wasm2js`: binaryen **133** (static build, `~/.local/opt/binaryen-133`).
  Build: `cargo build --release --target wasm32-unknown-unknown`, then `wasm-opt -O3`. Example and timings:
  `design/engine-study/` (`rust/build-wasm.sh`).
- **Firefox 157** for Playwright: `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu22.04-x64 playwright install firefox`
  (in `~/.cache/ms-playwright`). It launches headless here with Workers, WebAssembly and SIMD, but without WebGL2.

## Recipes
- MIDI → audio: `fluidsynth -ni -q -g 0.7 -r 44100 -F out.wav ~/.local/share/soundfonts/GeneralUser-GS.sf2 song.mid`
  (SDL/PulseAudio warnings are harmless: there is no sound device).
- Judge audio without ears: spectrogram `ffmpeg -i x.wav -lavfi showspectrumpic=s=800x300:legend=1 spec.png`, then
  view the PNG; loudness `ffmpeg -i x.wav -af ebur128=framelog=quiet -f null -` (aim ≈ -16 LUFS for music).
- Web audio formats: Opus/Ogg is smallest; also ship MP3 or AAC if Safari support matters.
- See the game: Playwright script or MCP screenshot → Read the PNG. Check `console` errors every time.
- Software rendering is visually faithful but slow: a heavy three.js scene (316k tris, soft shadows, MSAA, 720p)
  runs ~5 fps here (lavapipe is no faster). So keep the simulation fixed-timestep and expose a test hook
  (e.g. `window.__game.step(n)`) so automated playtests are deterministic regardless of frame rate.
- Anything with heavy or new-glibc deps: `podman run --rm -v "$PWD:$PWD" -w "$PWD" docker.io/library/ubuntu:24.04 …`.

## The code (`game/`; M0 scaffold by C1a)
- **Install:** `cd game && npm ci` (exact pins from `package-lock.json`; Cargo pins in `Cargo.lock`, toolchain in
  `rust-toolchain.toml`). Needs Node 24, Rust 1.99.1 + wasm32, binaryen (`wasm-opt`, `wasm-as`), `gamedev-python`
  (pyyaml) and the Playwright browsers above. All commands run in `game/`.
- **Run:** `npm run dev`: Vite on `127.0.0.1:5173` (`PAPERWORK_PORT` overrides) with the schema generator and the data
  stage in watch mode and the cargo plugin (`wasmdev` modules, full reload after each build). `npm run build` /
  `npm run preview`: release WebAssembly + feature gate, `dist/` with brotli/gzip siblings and `build-manifest.json`.
- **Check and test:** `npm run ci:fast` is the inner loop (~35 s warm: Biome, `tsc -b`, check-arch, schema-gen
  --check, cargo fmt and clippy, `cargo test --profile ntest`, Vitest; no e2e, release or benchmarks). `npm run check`
  (Biome, `tsc -b`, check-arch, schema-gen --check, rustfmt, clippy -D warnings with the determinism bans, the bans'
  own fixture, the data stage --check, the Python spec checks, `npm run assets -- --check`), `npm test` (cargo test,
  dev and ntest profiles; Vitest), `npm run e2e` (Playwright, Chrome + Firefox, 4 workers fully parallel, own server
  on a free port; `PW_WORKERS` overrides). **`npm run ci` is the merge gate** (~2.6 min): check and test (the cargo
  lane also prebuilds simtool, the simcheck simtool and the dev server's modules), the data stage, then the e2e
  `@smoke` and `@audio` suites beside the release path (release wasm + feature gate, `vite build`,
  `scripts/check-release.ts`, a preview smoke), then a quiet stage alone on the host: the `@timing` tests (60 UPS
  over a whole walk) and the benchmark budget gate. A green run records its inputs' key (`.cache/ci/green.json`;
  `scripts/ci-inputs.ts`: game/, design/spec/, tools/, the tools' versions, the art's and audio's provenance): an
  unchanged tree skips every lane in a second, and `npm run ci -- --force` runs them anyway. **Run the full `npm run
  ci` (green) before reporting a work package done**; `ci:fast` is for iterating. On a busy host: `taskset -c 0-15 npm
  run ci`. `npm run format` applies Biome's fixes. The testing and QA section below has the harness, the slow suite,
  the benchmarks and the dev endpoints.
- **Schema (C1b):** `schema/*.yaml` declares every record that crosses the Rust/TypeScript boundary, every saved field
  and every wire record; `schema/README.md` is the guide (declaration language, byte encoding, recipes, versions and
  `SCHEMA_HASH`, fixtures). `npm run gen` (≈4 s) regenerates `crates/schema/src/`, `crates/sim/src/gen/`,
  `src/shared/gen/`, `crates/sim/tests/codec_fixtures/generated.rs` and `test/fixtures/codec/`; after a schema edit
  run `npm run gen`, then `npm run data`, and commit the outputs. Codec fixtures: `cargo test -p sim --test
  codec_fixtures` and `npx vitest run test/codec`.
- **Data stage:** `npm run data` turns `design/spec/data` + `game/data/engine/*.yaml` (`sounds.yaml` optional: the sound ids,
  dense and sorted by name, and each entity's working sound; `--engine-file <name>=<path>` supplies a missing one for
  fixture builds) into `public/data/` (gitignored)
  and refreshes the committed `src/shared/gen/proto-ids.ts`, `test/fixtures/expr/cases.txt` and
  `test/fixtures/protos/m0.bin`: run it after any data or schema edit and commit them. Errors name the file, line and
  path. `--manifest m1…m5 [--allow-incomplete]` builds a milestone filter into `.cache/data/`.
  `data/engine/manifests.yaml` must equal 10 §12's block. The engine's character is `data/engine/prototypes.yaml`'s
  `character` (the last entity id).
- **Where things live** (10 §2.2): `crates/` (schema, det, worldgen, sim, simabi, genabi, simtool), `src/<layer>/`
  (layer boundaries enforced by `scripts/check-arch.ts`), `scripts/` (data stage, schema-gen, check-arch, plugins,
  `ci.ts`), `schema/`, `test/`, `e2e/`. Files in `src/shared/gen/`, `crates/schema/src/` and `crates/sim/src/gen/`
  (and `crates/sim/tests/codec_fixtures/generated.rs`) are generated: their header hash refuses hand edits. A
  justified exception to a check-arch rule is a comment on the line before: `// check-arch-ignore <rule>: <reason>`.
- **Golden set (C1c, 10 §15.10):** `test/golden/m0/` is the frozen M0 referee (prototype set, start save, a 3,600-tick
  closure log with d_t, slice_t and r_t per tick, states with their lineage, packets, projections, queries, negative
  cases, and the ABI traces `abi/traces.json`); its README says how each package consumes it and lists the rules it
  fixes. The expected values come from the reference model in `test/golden/model/` (readable TypeScript, spec-cited;
  `module.ts` is the ABI facade the traces run on). `node test/golden/build/main.ts` checks that the model reproduces
  the set; `--write` rewrites it; then `--write --bump mechanical "why"` (only the tiny atlas or a schema layout
  changed) or `--write --bump value --approval <review or decision> "why"` (expected values changed: needs the
  manager's approval, pm/DECISIONS-IMPL.md decision 14) records a version in the hash-chained `VERSIONS.txt`. A changed
  golden file, README rule or model source fails `test/golden/golden.test.ts` until it is bumped, and reopens the gate
  for the packages it touches. The tiny atlas is C6's fixture `test/fixtures/sprites/` (frozen in `MANIFEST.json`'s
  `external`; its `prototypesHash` must be the golden build's): after `npm run data`, regenerate it with
  `gamedev-python scripts/assets/fixture.py`, then bump.
- **Fake sim (C1c, 10 §15.10):** `npm run dev`, then `/?sim=fake` (dev builds only) runs `src/simworker/fake.ts` in a
  worker on the M1 prototype build, which the dev server builds into `.cache/data/m1/` and serves at `/data/fake/`
  (its `AUDIO_WORKING` uses the build's sound ids, from `data/engine/sounds.yaml`). Its M0 interactions follow the
  reference model's rules (`src/simworker/fake/rules.ts`), and `save` answers `saved`.
  It speaks `src/shared/protocol.ts` (§3.2) and sends every section and M0 projection. WASD walks; `?fakeDay=N`
  shortens the day; `?test=1` pauses it, and `window.__fake.step(n)`, `.act(action)` and `.status()` drive it. Tests
  run it in-process (`test/fake/harness.ts`); `node test/fake/snapshot.ts out.png [ticks]` draws its packet stream.

## The simulation (`game/crates/`; C2)
- **Crates:** `det` (libm wrappers, `powi`, `fmax`/`fmin`, piecewise tables, the expression interpreter, XXH64),
  `worldgen` (v0: simplex noise ported bit for bit from simplex-noise 4.0.3, terrain, water, ore spots, starting
  patches), `sim` (the World, saves, digests, the scheduler, the rules in `rules/`, statistics, pristine chunks and
  inline commits in `regen.rs`, the boundary in `extract.rs` (packets), `project.rs` (the M0 projections) and
  `query.rs`, the D18 harness, the scenario DSL and the §10.6 bench scenarios in `testkit/`), `simabi`/`genabi`
  (sim.wasm, gen.wasm), `simtool` (the native host). `sim::SimContext` is the module behind the ABI; outputs are
  the envelopes' payloads. Dev builds (`simcheck`): `debug_dump(0xFFFFFFFF)` panics (the shell's dev panic), and
  `PROFILE` times the 16 phases through the host clock (`DEBUG.phase_us`).
- **Rules follow the golden model** (`test/golden/model/rules.ts` and its README's numbered rules): when changing a
  rule, port it from there and cite "rule n"; a refusal changes nothing (`SimContext::set_check_refusals` verifies).
- **ABI feature:** `simabi`/`genabi` export the full §15.8/§15.9 tables with the cargo feature `full-abi`, on by
  default since the Shell's loaders landed (C3-r1); `--no-default-features` builds the M0 scaffold (ABI 0).
- **Tests:** `cargo test -p sim --features simcheck` (`tests/core/`: the golden set — every digest, state, event,
  packet, projection and query, every ABI trace; churn, the harness, the scheduler, the §2.5 allocation gates on
  the bench scenarios; `tests/rules/`: R23–R29 and the M0 scenarios, each with D18 a–c and a recorded session in
  `test/logs/` that `replay` replays; `UPDATE_SCENARIO_LOGS=1` rewrites them after review). `npx vitest run
  test/sim-wasm test/worldgen` runs the same golden set, sessions and worldgen chunks in WebAssembly (and the
  module's zero-allocation steady state), and pins the simplex port to the npm package. Scenario DSL:
  `sim::testkit::{Scenario, TestSequencer}` (`act`, `act_at`, `system`, `run`, `events`, `check_equivalence`).
- **simtool** (`cargo build --release -p simtool`, run from `game/`): `hash <save|sections>`; `replay <save> <log>`
  or `replay <bug bundle dir>` (the IO worker's `reports/<time>/`: inflates its deflated save, checks the start
  hash and every recorded digest, names a trap's tick; `--to`, `--trace`, `--state-out`); `trace` (`tick d slice
  r` like the golden `digests.txt`); `bench [--quick] [--scenario m0-walk|m0-chests-10k|m0-codec|m0-load-30k]`
  (§10.6's method; full runs check §10.6's thresholds, `--quick` the tails (each tick p99 against §11's 2 ms);
  × 2.4 on this host; per-window clocks with turbo flagged; appends `bench/history.jsonl`; `--json`;
  `--write-scenarios DIR` exports them for `node bench/node-runner.ts`, the same scenarios through sim.wasm in
  a worker). Paired A/B of a hot-path change: `taskset -c 0-15 node bench/ab.ts --base <rev>`. `npm run ci`
  ends with both budget gates. `--protos` defaults to `public/data/prototypes.bin`.
- **Build times** (pinned `taskset -c 0-15`): a sim edit rebuilds the `ntest` tests in ≈ 1–6 s (incremental, no
  LTO) and runs them in ≈ 7 s; the `wasmdev` modules in ≈ 3.5 s; clippy in ≈ 2 s; release simtool (fat LTO) ≈ 25 s.

## The worker shell (`game/src/{simworker,genworker,ioworker}`, `src/app/`; C3, 10 §3, §8, §15.8–§15.9)
- **Sim worker:** `simworker/shell.ts` around sim.wasm: the handshake (`module.ts`: ABI, `sim_schema_hash`, the
  build manifest, prototypes.bin's SHA-256; the M0 scaffold, ABI 0, is refused), the `MemoryLease` (`lease.ts`),
  the `LocalSequencer` (`sequencer.ts`, with `src/shared/admission.ts` and its fixture
  `test/fixtures/admission/cases.txt`; blobs verified synchronously at intake, `src/shared/sha256.ts`), clock
  generations, pooled packets, queries, the closure log (based on the last autosave, an exact pinned version) and
  digest ring, replay, the closure port (multiplayer, with a handover tick for background swaps), saves through
  the IO worker, trap bundles. Its steady-state tick path allocates nothing (`test/shell/steady.test.ts`). A
  module without extraction (C2b's: ERR_ORDER) runs without packets; a world's first is header-only.
  Protocol additions are marked (C3) in `src/shared/protocol.ts`; the IO and worldgen protocols are
  `src/shared/{io,gen}-protocol.ts`.
- **Saves (IO worker):** every save is a new version, written and checked, then published in one IndexedDB
  transaction (`storage.ts`); writes need the saves' ownership (`ownership.ts`: Web Locks, an owner epoch checked
  at every commit, *Take over* over a BroadcastChannel; §8.2 "One tab at a time"). Bug bundles are assembled there.
- **Main thread:** `src/app/main.ts` is the composition root: `createApp` (`app.ts`) builds the one `SimHost`
  (`sim-host.ts`), the IO worker and the page's lifecycle; the renderer, UI and audio attach to the App there,
  one line each (`app.host.on('packet' | 'generation' | 'storage' …)`), never a second host. SimHost allocates
  state generations and runs the world-replacement protocol (a fresh worker per world, the swap, re-sent view and
  subscriptions; every failed phase rejects), seqs, saves and autosave, pause reasons (`user`, `hidden`, `menu`,
  `storage`), `step(n)` (answered by `stepped`), and trap recovery from the last autosave. `src/app/inline.ts`
  runs workers in-process (`?sim=inline`, the Node tests). `window.__game` (`src/dev/game-hooks.ts`) drives it in
  dev builds or with `?dev=1`.
- **Tests:** `npx vitest run test/shell` runs the shell on the stub modules (`test/stubs/`, a Rust workspace built
  on demand into `target/stubs/`, with the M0 scaffold as a stale cache serves it; `debug_dump` ids from
  0xFFFF0000 are its test commands), on the golden reference model behind the ABI (`test/helpers/model-module.ts`),
  and on the real sim.wasm and gen.wasm (`real.test.ts`); `review-r1.test.ts` holds one test per codex C3-r1
  finding. The browser bench is `/src/dev/shell.html` (`e2e/shell.spec.ts`, @smoke). Playwright's servers take free
  ports by themselves (`scripts/free-port.ts`); `PW_PORT` / `PW_RELEASE_PORT` still pin them.

## Assets (`npm run assets`; C6, 10 §9, the *Survey* look of `design/art/DIRECTION.md`)
- **Sources** (committed): `game/assets/blender/` (`lib/` style, materials, parts, rig, contract; `entities/`,
  `world/`, `movers/`, `items/` model scripts; `greybox.py` + `greybox_table.py`; the Blender entry points
  `render.py`, `render_icons.py`), `game/assets/svg/{ui,glyphs}/`, `game/assets/fonts/` (OFL, with licences),
  `game/assets/textures/survey/<tile>.png` (optional image-model washes). The model contract (META, `build`, `pose`,
  kinds entity, inserter, resource, object, mover, icon) is the docstring of `lib/contract.py`; models import their
  helpers with plain import statements (the planner hashes them; the renderer fails a job that loads an undeclared
  model file), never import bpy at module level and never use `hash()` (randomised per process): seeds are fixed
  numbers or crc32. `test/assets/examples/` holds the authoring example of the `object` kind and an animated entity.
- **Build:** `cd game && npm run assets [-- --only id,… | --force | --no-render | --no-qc | --check]`: plan →
  Blender (batches of sets, `taskset -c 8-15,24-31`, 16 threads, `--python-exit-code 1`, every job's outputs
  verified; `PAPERWORK_ASSET_CPUS`, `_THREADS`, `_WORKERS`, `PAPERWORK_BLENDER` override) → post (ink with
  canvas-coordinate fields, glow, trim on 8 px, base pieces, shadows) → pack (`maxrects-packer`, 32-px cells) →
  assemble (our own box-filtered levels as a mipmapped DDS → `basisu` XUBC7 q90 / ETC1S, `scripts/assets/encode.py`)
  → terrain, fonts, UI skin → the manifest and `inventory.json` staged in `.cache/assets/stage/` → gates (inventory,
  `checks.py`, `metrics.py --gate`; with QC the calibration, `test/assets/examples.py`, the UI screenshots) →
  **publish** `public/atlases/{inventory,sprites}.json` by rename, then remove files no manifest names from
  `public/{atlases,sheets,fonts}` → QC review material in `.cache/assets/qc/` (contact sheets, GIFs, the preview
  scene, budget). Until the publish every step only adds content-named files, so a failed build leaves the last
  published generation intact. `--only` re-renders just those sets (with `--force`, even when cached) and still
  publishes the whole manifest, so every other set must be cached; `--no-render` never starts Blender. Cold: about
  12 min (the character's 288 frames take 6.5 of them); warm: about 30 s plus QC. Outputs are gitignored; caches
  live in `.cache/assets/{render,post,ktx2}/<sha256>` (keyed by the scripts and their transitive imports, `lib/`,
  the entry points, Blender, the encoder binary and code, the Python toolchain), and a successful full build drops
  stale entries. A forced rebuild reproduces every file byte for byte (the rig strips Blender's PNG metadata), except
  a rare single pixel on an exact edge of a 1-sample normal pass (Embree's multithreaded BVH; pm/reports/C6.md).
- **Checks** (`checks.py`, 10 §9.5): every check gates. Schema, coverage, cells (and a solid-colour probe of each page
  through every fallback format), every KTX2's header and DFD against the upload contract (`ktx2.py`), the composite
  drawn from the atlas pages (`composite.py`), registration and the 3 % rule in every direction, shadow direction,
  §6.13's GPU allocation, compression. Only 10 §9.5 #5's compression numbers warn (decision 13): edge-dense pages
  (the character, ore, icons) cannot reach them in BC7 at any setting, so the gates are floors measured on the M0
  pages (`GATE`; fallbacks: `FALLBACK_GATE`, the measured ratio to BC7 + 10 %). Shadows are judged as the hatched
  paper the player sees. Legibility (`metrics.py`): the lightness and figure-ground rules gate; 8×8 confusability is
  flagged for review.
- **Look at a change:** `npm run assets -- --only <id>` then `gamedev-python scripts/assets/contact.py --sets
  entity/<id>` and Read `.cache/assets/qc/contact/entity-<id>.png`; `scripts/assets/preview.py --zoom 2` draws the
  M0 scene from the encoded atlases as the renderer will (`emulate.py`); `scripts/assets/ui_demo.py` and
  `node scripts/assets/shoot.mjs qc-ui.html out.png --dpr 2` show the UI skin in Chrome.
- **Fixtures:** `gamedev-python scripts/assets/fixture.py` regenerates `test/fixtures/sprites/` (the tiny `rgba8`
  atlas and `cases.json` of 10 §15.7/§15.10, in the build's exact composition).
- **Acceptance (C9):** the build writes `public/atlases/provenance.json` at publish (every file's SHA-256, the gates
  passed, the prototypes, each set's cache key); `npm run assets -- --check` (7 s, no Blender; in `npm run check` and
  `ci`) runs the fixture checks, then fails unless the published atlas is that build's files, for the current
  prototypes, from the current sources (an edited model script is stale), and re-validates its manifest. `npm run
  assets` ends with the audio build (`--no-audio` skips it), so one command makes a playable build.
- **Resources (C9):** `CHUNK_RESOURCES.band` runs in Factorio's stage order (band 0 the richest, the golden model's
  rule 24): a resource model's `pieces(band, n)` keeps the full pile at band 0. The renderer draws the deposit's ground
  (`TERRAIN.depositTile`, dirt) under resource tiles from the tile-id texture's high bit, blended like a soft tile
  edge, as A3's mocks put ore on dirt. `gamedev-python test/assets/projection.py` is the projection calibration (renders
  with Blender).
- **Pages hold premultiplied, display-encoded values,** and every KTX2 says so in its DFD (transfer
  `KHR_DF_TRANSFER_LINEAR`, `KHR_DF_FLAG_ALPHA_PREMULTIPLIED` except shadow masks): upload BC7 as
  `COMPRESSED_RGBA_BPTC_UNORM_EXT` (never the sRGB variant) and blend premultiplied, as 10 §9.1's verified
  composite does.

## Audio (`game/src/audio/`; M0 by C7)
- **Assets:** `gamedev-python -I scripts/assets/audio/build.py` (fetch → prep → sfx → encode; minutes cold, seconds
  warm) fills `public/audio/` (gitignored): content-hashed Opus `.ogg` + AAC `.m4a`, `music.json`, `sounds.json` and
  `inventory.json` with the size gates. Sources are pinned in `assets/audio/samples.lock.json`; every published file
  has a licence record in `assets/audio/licences.json` (prose: `LICENSES.md`). Sound definitions (bus, variation, rate
  limit, events, working sounds, era bus gains): `data/engine/sounds.yaml`.
- **Dev page:** `/src/dev/audio.html` on the dev server: start, the music program and keys, the sliders, every sound,
  a factory's SFX load, and the offline CPU load (10 §9.4's gate for the user's laptop). Tools drive it through
  `window.__audioDev` (offline renders, live play, decode/loop checks; `render({ script })` plays a recorded session's
  sounds over a piece).
- **In the game (C9):** `src/app/attach-audio.ts` attaches the runtime in `main.ts` (between the renderer and the UI):
  packets (EVENTS, AUDIO_WORKING; historical and stale events silent), the HUD's records (the music feed), the camera,
  the host's pause, footsteps on the character's run cycle and a hammer strike per mining swing, unlock on the first
  gesture. The UI drives it through `UiAudio` (src/ui/host.ts): GUI clicks (every button), Settings → Sound (I §4.20's
  eight volumes, a label click mutes), and the scene (the menu's charter recording, a game's program). Dev builds:
  `__game.audio.status()`, `.played()` (sound names), `.record()`/`.stop()` (a session for an offline render).
  Tests: `test/audio/golden.test.ts` (the golden packets through the SFX system), `e2e/game-audio.spec.ts`.
- **Renders:** `node scripts/assets/audio/render.ts <cfgs.json> [--out dir] [--checks]` renders through the real engine
  in headless Chrome (OfflineAudioContext, WAVs in `.cache/assets/audio/renders/`); `scripts/assets/audio/analyze.py`
  compares loudness, spectra and stems with A4's demos; `master.py` makes a recording (−18 LUFS, −1 dBTP).
- **CPU:** `taskset -c 0-7 node scripts/assets/audio/bench.ts <cfgs.json> [seconds] [rounds]` plays live and reads the
  audio threads from `/proc`, rounds interleaved (reference ≈ host ÷ 2.4; budget 10 §9.4: host ≤ 19 % mean, ≤ 36 %
  worst second). The governor runs light audio threads at 1.3–1.5 GHz, not 2.6 GHz, and Chrome suspends a silent
  output, so compare only within one interleaved session; rows also give the share scaled to 2.6 GHz.
- **Tests:** `npx vitest run src/audio` (the rule sets note for note against A4's prototype, the bank's DSP, the FDN
  against A4's IRs, the conductor); `npx playwright test e2e/audio.spec.ts` (@audio).
- **Rules:** the worklet's `process()` never allocates. Keep native nodes few: beside an AudioWorklet each one renders
  on its thread (≈ 0.1 % of a host core per GainNode), so rooms, reverbs and bus faders live in the bank.

## Renderer (`game/src/render/`, `game/src/assets/`; M0 by C4, 10 §6, §9.7–§9.8)
- **See it:** `npm run dev`, then `/` (the App: `main.ts` attaches the renderer, `attach-renderer.ts`), or `/?sim=fake`
  (the fake sim's factory, following player 0). `?test=1` renders on demand, `?render=none` draws nothing (the view
  model, camera and picking still work), `?deny=bc7,astc` forces the format fallbacks. The gallery
  `/src/dev/gallery.html?scene=golden|golden-real|transitions|survey|single|bench[&night=1&zoom=…&x=…&y=…&clean=1]`
  draws the golden packets with the tiny atlas, C6's preview scene (`survey`: the M0 art, a lit keypunch for the
  light pass) and §6.12's frame-cost scenes. Real atlases need `npm run assets` (`public/atlases/`, gitignored;
  without them the world is not drawn, quietly). Stand-in input until the UI owns it: wheel zoom (×1.1 per notch,
  0.3–3×), F9 / Shift+F9 1× / 2×, F4 the debug overlays, F5 the timings HUD (it turns the frame timings on).
- **The UI's boundary (C4-r1 12):** `src/shared/world-view.ts` is the contract: `WorldViewApi` with `camera` (the
  camera the last frame was drawn with, CSS px of the canvas: `toWorld`, `toScreen`, `visible`), `pickAt(px, py)`
  (entity by selection box and priority, else resource, else tile; null outside the held chunks), `model` (the
  read-only view model: chunks by `chunkId`, DYN/HANDS/MOVERS records in their wire layouts), `zoomBy`, `setZoom`,
  `follow`, `setHovered` (→ the view request's hovered_serial), `onFrame`, `ready()` (core art uploaded) and
  `devInput.detach()`. `attachRenderer(app, { devInput, onCoreError, onArtNotice })` (src/app/attach-renderer.ts)
  returns it: C3's App owns lifecycle and worlds (the world view follows `app.host`'s packets and generations and
  sends view requests through `app.host.setView`); the UI owns input and calls the API; it never imports render/.
- **Structure:** `manifest.ts` compiles sprites.json v2 into typed tables; `programs.ts` holds §15.7's drawing programs
  (the TypeScript twin of `scripts/assets/manifest.py`); `mirror.ts` is the view model (packets in, held-set eviction,
  snapshots, an epoch per world); `bounds.ts` the sets' conservative bounds (culling); `scene.ts` builds a frame (the
  ground sublayers in order, the counting sort, belt items expanded and culled in one pass, smoke, ghosts, debug)
  into streams; `renderer.ts` runs the passes (terrain → ground → shadows hatched → objects → high → lights → the one
  grade pass with the cyanotype LUT → overlays) and accounts for every GPU byte; `pick.ts` picks; `gl/` is the thin
  GL layer (batcher, textures with the page → layer table and per-layer LOD texture, terrain caches that grow and
  evict, shaders); `style.ts` holds Survey's constants. `app/world-view.ts` wires renderer, asset worker and loader
  (and `window.__render`: `frame`, `camera`, `ready`, `settled`, `stats`, `world`, `loseContext`).
- **Assets at run time:** `src/assets/worker.ts` (fetch by priority, SHA-256, Basis transcoding, a 64 MB cache) with
  the vendored stock Basis Universal 2.50 transcoder (`worker/basis/`, Apache-2.0); `loader.ts` turns the manifest
  into requests and hands levels to the renderer (≤ 2 ms of uploads per frame). Every allocation of the arrays is an
  upload epoch: a restored context or a lower mode (`stepDown`, over budget) renegotiates formats and levels, and
  older replies are dropped. Readiness is core's only; four failures of a core file raise the error with Retry. The
  stock transcoder cannot make EAC R11 from ETC1S, so shadows fall back BC4 → R8.
- **Tests:** `npx vitest run test/render` (the 65 sprite cases, golden packets into draw lists, mirror equivalence
  against the fake, belts, projection fixtures `test/fixtures/projection/` made by its `make.py`, terrain data, memory,
  the asset queue and transcoding; `review-r1.test.ts` holds one test per codex C4-r1 finding, the GL side on a
  recording WebGL2 stub, `gl-stub.ts`); `npx playwright test e2e/render.spec.ts --project chrome` (@smoke: golden
  packets at 1×/0.3×, dpr 1/2, pixel-exact placement at even and odd sizes, the Survey smoke screenshots; @render:
  night, fallbacks, context loss, the fake factory, F4/F5, odd heights, picking, readiness);
  `taskset -c 0-7 npx playwright test e2e/render-bench.spec.ts --project chrome` (@bench: main-thread ms per frame
  plus a tick's packet against §6.12 × 2.4, and bytes allocated per frame). Screenshots land in
  `test-results/dev/`: Read them.
- **Rules:** the frame path allocates nothing in steady state. Beyond the obvious (no closures, arrays, iterators or
  strings per frame), V8 boxes every non-integer double passed to a call it does not inline, every number outside
  ±2³⁰ returned or used as a Map key, and every double object field passed on: so doubles travel in typed blocks (the
  SpriteSink's `args`, the programs' `AT`, the batcher's `QUAD`), the mirror keys chunks by `chunkId` (a small integer,
  not the wire's chunk_key), hashes are written into arrays (`posHashInto`), and constant uniforms are set once per
  program. Measure with the bench (V8's sampling heap profiler, collected objects included); a heap that does not
  grow proves nothing. The frame reads no clock unless `renderer.timing` is on. No string lookups per frame; sprite
  placement only through `projection.ts`/the programs; every sprite and chunk is chosen by its conservative bounds,
  never its anchor; pages are premultiplied UNORM (never sRGB formats); half-resolution targets use the sprite
  shader's one transform (`uFullH`), so odd sizes stay aligned; in headless Chrome `gl.finish()` does not wait, so
  benchmarks drain the GPU with a 1×1 `readPixels`; any WebGL canvas here logs four "GPU stall due to ReadPixels"
  compositor warnings, which `e2e/console.ts` ignores.

## UI and input (`game/src/ui/`; M0 by C5; 10 §7, I §1–§4, 07)
- **Run:** `npm run dev`, open `/`: the main menu (07 §18) → New game → the game on the real sim (the App's SimHost,
  C4's renderer). E character screen, P production statistics, Esc game menu (Save game, Load game, Settings), LMB on a
  chest opens it; WASD, RMB mining, LMB building with drag lines, Q, number keys, Alt alt-mode; Settings → Controls
  rebinds (two columns, conflicts listed). Saves go through the IO worker (OPFS or IndexedDB) and load back.
- **Wiring:** `src/app/attach-ui.ts` (`mountUi(app, world)`, one line in `main.ts`) mounts it on the App's host and
  C4's world view; `src/ui/host.ts` holds the structural types the UI uses of both (ui/ imports only shared/). The
  session (`src/ui/session.ts`) starts, loads, saves and leaves worlds through the host; a new state generation empties
  everything derived from the old world. The world is the world view's: camera, `pickAt`, the view model
  (`world/select.ts` reads it), `setHovered`; the UI draws only the selection brackets and the build preview
  (`world/overlay.ts`, a Canvas2D layer under the DOM).
- **Where:** `input/` (the action map with Factorio's defaults `controls.ts`, the live table and settings shape
  `bindings.ts`, the event core and capture layer `core.ts`, the context resolver `resolver.ts`, the action encoder
  `encoder.ts`, slot descriptors and keyboard grid navigation `slots.ts`), `store/` (projection records → Solid stores,
  subscriptions by sub_id, UI state with E/Esc layers), `core/` (Window, Slot, Tooltip, Icon in the Survey skin),
  `hud/`, `windows/`, `menu/`, `world/`, `mount.tsx` (wiring).
- **Strings:** only from `game/locale/en.yaml` (UI) and prototypes.json `strings` (data names). Every locale key has
  its source in `game/locale/en.sources.yaml` (08, text.yaml, 07, I, the schema's comments, Factorio's own labels for
  08 §5.1's Factorio surfaces, or `proposal`: wording awaiting the text owner); `test/ui/locale.test.ts` checks each
  cited string against its source, and fails on a key without one, on "!", ellipses or "you".
- **Rules:** slot clicks never act in their own handlers: a slot registers what it is (`input/slots.ts`) and the input
  core resolves the binding (also for keys), so every control stays rebindable. Windows that E and Esc act on register a
  layer (`store/ui.ts`); green buttons register into their layer. No layout reads in the frame loop or on content
  updates (tooltips are sized by a ResizeObserver). Pure UI state never enters the sim.
- **Test hooks** (dev builds): `window.__game.ui.state()`, `.sent()` (the encoded actions with seqs), `.toScreen(x, y)`,
  `.entities()`, `.resources()`, `.character()`, `.perf()`; `window.__game.step(n)` (resolves after the tick's
  packet); in test mode the world renders on demand, so e2e helpers draw a frame after each step
  (`__game.render.frame()`) for the camera to follow. Client settings live in localStorage (`paperwork.settings`).
- **Tests:** `npx vitest run src/ui test/ui` (bindings, resolution through the real core, the session and generations
  on a fake host (`test/ui/rig.ts`), golden projections and traces, the locale and its sources;
  `test/ui/review-r1.test.ts` holds one test per codex C5-r1 finding); Vitest resolves `solid-js` to its browser
  build, so stores and memos react as in the page. `npx playwright test e2e/ui.spec.ts e2e/game.spec.ts
  e2e/review-r1.spec.ts` (the input layer, the M0 flow with save and load on the real sim, the browser-level review
  findings; both browsers, Firefox with `?render=none`); `npx playwright test e2e/perf.spec.ts --project=chrome` (UI ms
  per frame, window opening, input latency).

## Testing and QA (`game/test/`, `game/e2e/`, `game/bench/`, `game/src/dev/`; C8, 10 §10, §3.5)
- **The scenario DSL** (10 §10.2, `sim::testkit`): `Scenario::new_world`, `from_state` and `from_layout` (an ASCII
  layout, `test/layouts/*.txt`: `# legend: C=iron-chest:items=iron-plate*800` lines, cells separated by one space,
  `@` the spawn tile (0, 0); `layout.rs`, twin `test/helpers/layout.ts`), then `act`, `act_at`, `system`, `run`,
  `events`, `place` and `insert` (through player actions), `entity_at`, `stats().produced(name)`, `hash`,
  `digest`, `reload`; `finish(&s)` in `crates/sim/tests/rules/` runs D18 a–c and records the session in
  `test/logs/`. Rule scenarios live in `crates/sim/tests/rules/` (R23–R29 for M0, then by milestone, 10 §10.8).
- **Frozen goldens** (10 §10.3): `Goldens::open("file").check(name, value, factorio, tolerance)` (Rust,
  `crates/sim/tests/rules/goldens.rs`) and `new Goldens(file)` (Vitest, `test/helpers/goldens.ts`) compare with
  Factorio's value, then with `test/goldens/<file>.json`; `UPDATE_GOLDENS=1` rewrites them (say why in the commit).
  M0's golden ratios GM1–GM5 (hand crafting, hand mining, running, mining a chest, a chest's capacity):
  `golden_ratios.rs`.
- **D18:** (a–c, e) every scenario through `finish`; (d) the cross-engine trace, `e2e/trace.spec.ts` (@smoke: the
  golden log and the 10,000-tick session `m0-cross-engine-10k`, natively by `simtool replay --trace --full`, in Node
  and in Chrome and Firefox through `/test/trace.html`, the same code: `src/dev/trace/core.ts`; `TRACE_SET=all`,
  `TRACE_MODULE=release`); (f) the multi-client harness `sim::testkit::multi::Room` (joins by checkpoint, crashes
  with catch-up, re-syncs, NO_SLEEP, read schedules; `d18f_multi_client.rs`); (g) `test/harness/closure-fuzz.test.ts`
  (fast-check mutations of real closures: never a trap, a refusal changes nothing).
- **`npm run test:slow`:** the ignored native probes, then the trace on every session in `test/logs/`, dev and
  release modules. A new session in `test/logs/` joins it, and the native and WebAssembly replays, by itself.
- **M0's exit e2e** (`e2e/m0-exit.spec.ts`, @smoke): 60 UPS on the worker's clock; a chest crafted, placed,
  filled and mined through the real input layer with INVENTORY and STATS read from the UI; a browser save and closure
  log hashed and replayed by simtool; the dev panic's recovery and its `/__report` bundle reproduced natively.
  `e2e/screenshots.spec.ts` (@shots, Chrome, 1920 × 1080) writes the smoke screenshot set to `pm/reports/C8/`.
- **Benchmarks** (10 §10.6): `simtool bench` (native), `node bench/node-runner.ts` and the browser runner
  `BENCH=1 taskset -c 0-7 npx playwright test e2e/bench.spec.ts` (bench.html's simulation and determinism sections in
  Chrome and Firefox; `BENCH_QUICK=1`, `BENCH_SECTIONS=…`, `BENCH_NO_HISTORY=1`) all share the scenario core
  `src/dev/bench/sim-core.ts` and append to `bench/history.jsonl`. A/B in one session: `npm run bench:ab -- --base
  <rev> [--runner chrome|firefox]`. The user's page: `http://127.0.0.1:5173/bench.html` through the tunnel
  (simulation, determinism, render on C4's §6.12 scenes, audio's offline gate, the GPU's formats; served
  cross-origin isolated for fine timers) POSTs to `bench/user-results/`; `node bench/calibrate.ts [--write]`
  turns the newest one into the measured host factor (§11's 2.4 until then).
- **Dev endpoints** (`scripts/dev-endpoints-plugin.ts`, dev server only; writes only from the server's own pages: a
  loopback Host and same-origin Origin, bodies streamed within per-file, per-report and total limits, C9): `POST
  /__bench`, `POST /__report/<id>/<file>`
  (Ctrl+Alt+F12 or `__game.report(note)` sends the bundle: the base save, the closure log with its digests, the
  console, a screenshot, client.json; after a trap, the trap's own bundle) into `bench/reports/<id>/` for
  `simtool replay bench/reports/<id>` (a trap needs a simcheck simtool: `cargo build -p simtool --features simcheck`,
  `target/debug/simtool`); `POST /__shot` (`__game.shot(name)`) into `bench/shots/`. Reports and shots are
  gitignored.
- **Playwright** claims free ports (`scripts/free-port.ts`: 21000–29999, below the ephemeral range, with a lock file per
  port in ~/.cache/paperwork/ports), so worktrees never collide; tests run fully parallel in 4 workers, except
  `@timing` ones (CI runs them alone); e2e helpers for the UI are in
  `e2e/ui-helpers.ts`, for simtool in `e2e/simtool.ts`. Every spec fails on a console error or warning.

## Showing the game to the user
- Dev server on `127.0.0.1:<high port>`; the user tunnels in: `ssh -L 5173:127.0.0.1:5173 cpuserver10`.
- The playable build: `cd game && npm run assets` (once), then `npm run dev` (port 5173) and
  `http://127.0.0.1:5173/` through the tunnel; `/bench.html` is the benchmark page (its audio section needs the
  audio build, which `npm run assets` runs), Ctrl+Alt+F12 sends
  a bug report (pm/reports/C8.md has the M0 notes).
- Builds can also be published as a private claude.ai Artifact (≤ 16 MB per file).

## The game design (read before coding)
- **Spec entry point:** `design/spec/README.md`: what the game is, the file map, the M1 reading order, checks and generators. Binding decisions: `design/DECISIONS.md`. Design history: `design/PROCESS.md`.
- **Title:** *Paperwork*, tagline *Information is physical.* (DECISIONS §44). Repo: `github.com/mb706/paperwork` (deploy key `~/.ssh/browsergame_deploy_ed25519`, bound through the repo-local `core.sshCommand`).
- **Concept:** a faithful Factorio 2.0-like (mechanics, numbers, UI and keybindings kept) about AI research. A 1945 charter founds a research Site "to determine whether the work of this Site can be done by a machine"; the game ends in a takeoff. Ontology: *information is physical*.
- **Data is the source of truth:** `design/spec/data/*.yaml`.
  - 02, 05 and 09 §1–§2 are generated; never hand-edit them.
  - After any data edit, run `gamedev-python tools/validate_spec.py design/spec/data` (must be 0 errors, 0 warnings), then `tools/render_spec.py` and `tools/render_slice.py`, then `design/round3/impl-data/r3_checks.py` and `r3_xref.py`.
- **Engine plan:** `design/spec/10-architecture.md` (version 2); multiplayer in `design/spec/11-multiplayer.md`.
  - The simulation is **Rust 1.99.1 compiled to WebAssembly** (a Cargo workspace in `game/crates/`): one thread in a sim Worker, a deterministic 60 UPS, closures as its only input. TypeScript 7 does the worker shell, the data stage, the UI (SolidJS, DOM), the custom WebGL2 renderer, audio and tools. Vite 8, Vitest, Biome; `cargo test` natively; clippy with determinism bans.
  - One schema (`game/schema/`) generates every Rust/TypeScript contract; the M0 contracts are 10 §15. No transcendental from `std` in sim code: use the `det` crate (the `libm` crate inside). Determinism rules D1–D23: 10 §4.1.
  - The pinned npm set is `game/package-lock.json` (tested first in `design/round2/A-stack-test/`); proven Rust/WebAssembly settings, kernels and harnesses are in `design/engine-study/`.
- **Milestones:** M0 (foundations) → M1 (the vertical slice: Memo + Report tiers, peaceful) → … → M7. See 10 §12 and 09.

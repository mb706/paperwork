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
  soundfile, pedalboard, mido, pretty_midi, music21, librosa, matplotlib, pillow, opensimplex, fonttools, brotli.
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
- **Check and test:** `npm run check` (Biome, `tsc -b`, check-arch, schema-gen --check, rustfmt, clippy -D warnings
  with the determinism bans, the bans' own fixture, the data stage --check, the Python spec checks; ~12 s warm),
  `npm test` (cargo test, dev and ntest profiles; Vitest), `npm run e2e` (Playwright, Chrome + Firefox, own server
  on port 5191), `npm run ci` (all of it, then the e2e smoke and the release path: release wasm + feature gate,
  `vite build`, `scripts/check-release.ts`, a preview smoke on port 5193; ~30 s warm, ~35 s from a clean clone).
  On a busy host: `taskset -c 0-15 npm run ci`. `npm run format` applies Biome's fixes.
- **Data stage:** `npm run data` turns `design/spec/data` + `game/data/engine/*.yaml` into `public/data/` (gitignored)
  and refreshes the committed `src/shared/gen/proto-ids.ts` and `test/fixtures/expr/cases.txt`: run it after any data
  edit and commit those two. Errors name the file, line and path. `--manifest m1…m5 [--allow-incomplete]` builds a
  milestone filter into `.cache/data/`. `data/engine/manifests.yaml` must equal 10 §12's block.
- **Where things live** (10 §2.2): `crates/` (schema, det, worldgen, sim, simabi, genabi, simtool), `src/<layer>/`
  (layer boundaries enforced by `scripts/check-arch.ts`), `scripts/` (data stage, schema-gen, check-arch, plugins,
  `ci.ts`), `schema/` (C1b), `test/`, `e2e/`. Files in `src/shared/gen/`, `crates/schema/src/` and
  `crates/sim/src/gen/` are generated: their header hash refuses hand edits. A justified exception to a check-arch
  rule is a comment on the line before: `// check-arch-ignore <rule>: <reason>`.

## Audio (`game/src/audio/`; M0 by C7)
- **Assets:** `gamedev-python -I scripts/assets/audio/build.py` (fetch → prep → sfx → encode; minutes cold, seconds
  warm) fills `public/audio/` (gitignored): content-hashed Opus `.ogg` + AAC `.m4a`, `music.json`, `sounds.json` and
  `inventory.json` with the size gates. Sources are pinned in `assets/audio/samples.lock.json`; every published file
  has a licence record in `assets/audio/licences.json` (prose: `LICENSES.md`). Sound definitions (bus, variation, rate
  limit, events, working sounds, era bus gains): `data/engine/sounds.yaml`.
- **Dev page:** `/src/dev/audio.html` on the dev server: start, the music program and keys, the sliders, every sound,
  a factory's SFX load. Tools drive it through `window.__audioDev` (offline renders, live play, decode/loop checks).
- **Renders:** `node scripts/assets/audio/render.ts <cfgs.json> [--out dir] [--checks]` renders through the real engine
  in headless Chrome (OfflineAudioContext, WAVs in `.cache/assets/audio/renders/`); `scripts/assets/audio/analyze.py`
  compares loudness, spectra and stems with A4's demos; `master.py` makes a recording (−18 LUFS, −1 dBTP).
- **CPU:** `taskset -c 0-7 node scripts/assets/audio/bench.ts <cfgs.json> [seconds] [rounds]` plays live and reads the
  audio threads from `/proc`, rounds interleaved (reference ≈ host ÷ 2.4; budget 10 §9.4: host ≤ 19 % mean, ≤ 36 %
  worst second). The CPU clock drifts with load, so compare only within one interleaved session.
- **Tests:** `npx vitest run src/audio` (the rule sets note for note against A4's prototype, the bank's DSP, the FDN
  against A4's IRs, the conductor); `npx playwright test e2e/audio.spec.ts` (@audio).
- **Rules:** the worklet's `process()` never allocates. Keep native nodes few: beside an AudioWorklet each one renders
  on its thread (≈ 0.1 % of a host core per GainNode), so rooms, reverbs and bus faders live in the bank.

## Showing the game to the user
- Dev server on `127.0.0.1:<high port>`; the user tunnels in: `ssh -L 5173:127.0.0.1:5173 cpuserver10`.
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

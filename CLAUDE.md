# Browser game project

## Host constraints (cpuserver10)
- Ubuntu 20.04, kernel 5.4, **glibc 2.31**, 2× Xeon E5-2650 v2 (32 threads, AVX but **no AVX2** → x86-64-v2), 62 GB RAM, no usable GPU.
- Runs 24/7 and **must not be rebooted**; work entirely as user `mewse` — no root, no system packages.
- Prebuilt binaries that need glibc > 2.31 or AVX2 fail here (e.g. resvg's GitHub release). Fallbacks, in order:
  conda-forge via `micromamba`, npm/PyPI packages, then a rootless `podman` container
  (Podman 5.8.4 works; its cgroup-v1 caveats are documented in `~/qwenxcl/CONTAINERS.md`).
- Layout: tools in `~/.local/opt/<tool>-<version>` with `<tool>-current` symlinks, commands in `~/.local/bin`.
- Verify everything with `tools/check-toolchain.sh` (~20 s).

## Toolchain
- **Node 24 LTS** + npm (global prefix `~/.local`). `/usr/bin/node` is v10 — never use it.
- **Python**: `uv` (Pythons 3.12/3.13). `gamedev-python` = 3.12 venv `~/.local/opt/gamedev-py` with numpy, scipy,
  soundfile, pedalboard, mido, pretty_midi, music21, librosa, matplotlib, pillow, opensimplex.
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
- **Audio**: `fluidsynth` with SoundFonts in `~/.local/share/soundfonts` (GeneralUser-GS.sf2 — free for any use;
  FluidR3_GM.sf2 — MIT), `sox`, static `ffmpeg` 9 (opus, vorbis, mp3, aac), pedalboard (effects/mastering), `lame`, `opusenc`.
- **Misc**: `jq`, `fd`, `rg`, `gh`, `zstd`, `micromamba` (root `~/.local/share/mamba`; env `media` = conda CLI tools,
  env `mesa` = GL stack for Blender).

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
- **Engine plan:** `design/spec/10-architecture.md`.
  - TypeScript 7, Vite 8, Vitest, Biome, SolidJS (DOM UI), a custom WebGL2 renderer, and a deterministic 60 UPS simulation in a Worker. No `Math.sin`/`exp` in sim code; use the deterministic math module.
  - The pinned, tested package set is in `design/round2/A-stack-test/` (with its lockfile).
- **Milestones:** M0 (foundations) → M1 (the vertical slice: Memo + Report tiers, peaceful) → … → M7. See 10 §12 and 09.

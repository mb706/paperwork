# B2: Assets, audio, loading and streaming (architecture v2, part 2)

**Owner:** one Opus agent. **Starts after B1 is finished.**
- **Writes to:**
  - `design/spec/10-architecture.md`: §9 (asset pipeline and audio), a new section on loading and streaming (B1 may have left a stub), and the asset and audio lines of §11 budgets and §12 milestones;
  - `design/art/DIRECTION.md` and `design/audio/DIRECTION.md`, only to reconcile them with the spec where they conflict;
  - `pm/reports/B2.md`.
- **Must not touch:** the other sections of 10 (B1 owns them; if something there blocks you, note it in your report) or `design/spec/data/**`.

## Why

The art direction (A3, *Survey*) and the audio direction (A4, era-evolving process music on a generative-first hybrid engine) have been chosen (`pm/DECISIONS-IMPL.md` 5–6). The spec's §9 still describes the old plan (Factorio-like grime; music21 → FluidSynth tracks).

The user also asked explicitly:
- **performance matters** in a browser;
- the game should **stream things on demand**, "so one does not need to download megabytes of code and assets at the start of the game";
- the majority of computation must not run on the server.

## Read

- `CLAUDE.md`, `pm/README.md`, `pm/DECISIONS-IMPL.md`.
- `pm/reports/A3.md` and `design/art/DIRECTION.md`. Read the prototype pipeline in `design/art/proto/` enough to know what already works on this host.
- `pm/reports/A4.md` and `design/audio/DIRECTION.md`, plus the engine prototype in `design/audio/proto/`.
- `pm/reports/B1.md` and the revised `design/spec/10-architecture.md`:
  - especially B1's contracts: the render packet, the sprite manifest shape, and the sim → audio and feedback events;
  - §6, rendering; §6.13, GPU memory; §9; §11; §12.
- `design/spec/09-vertical-slice.md` §2.7, what M1 must draw and sound.

## Do

1. **§9 asset pipeline v2 for *Survey*.** Make it implementable by the asset WP in M0 and M1 without A3 present:
   - **Structure:** the rig and the model-script layout; the render passes (wash tones, ink, hatching, light and emission) and compositing.
   - **Render only what moves (binding).** Static base plus animated layers per entity. Give the frame counts and the layer split per entity class.
   - **Pipeline steps:** atlas packing into texture-array pages, the sprite manifest (concrete, consistent with B1's contract), and icons, from their source to their output.
   - **The world and the UI:** terrain and decoratives, and the UI skin (9-slice parts, fonts with OFL licences recorded).
   - **The look as shaders:** the day/night cyanotype LUT and the warm-stain light pass, written as renderer shaders with their parameters.
   - **Quality control:** contact sheets, visual-regression checks, legibility metrics (A3's `metrics.py`).
   - **Budgets:** render time on this host for the M1 set and the full game, atlas MB on disk, and GPU MB. A3 found that full-frame atlases blow the GPU budget, so fix that here.
2. **The texture format, decided by measurement.**
   - Take two or three real atlas pages made with A3's prototype pipeline and compare PNG, WebP (lossless and lossy) and KTX2/Basis (UASTC and ETC1S, with the transcoder's size and speed).
   - Measure download size, decode or transcode time in Chrome and Firefox here, GPU memory, and visual quality on ink lines: hatching must not mush.
   - Pin taskset to CPUs 0–7.
3. **§9.4 audio v2.**
   - The engine architecture: the WebAudio graph, scheduling, and whether an AudioWorklet is needed.
   - **A CPU budget**, for example ≤ 8% of one reference-machine core on average and ≤ 15% at peak, and how to meet it. A4 measured 36–76% of a core here. Options: lighter reverb, pre-rendered tails or stems, fewer voices. Measure an improved prototype if you can.
   - Era sample sets: their sizes and loading.
   - The SFX system, consuming B1's event contract:
     - variation and rate limiting;
     - positional attenuation and mixing, as in Factorio;
     - machine working loops by proximity and count;
     - silence during catch-up and replay.
   - Mixing targets.
   - The Safari and AAC fallback.
   - Licences: everything already documented in `design/audio/LICENSES.md`.
4. **A new section on loading and streaming.**
   - **A download budget per stage, with real numbers:**
     - first paint;
     - the main menu, which has music;
     - the first frame of a new game, whose budget is 10 §11;
     - each later era as it unlocks.
   - **Code splitting:**
     - Vite dynamic imports per UI screen;
     - the WASM sim with `compileStreaming`;
     - prototype and text data split by milestone or era if that is worth it.
   - **Assets on demand:**
     - low-resolution atlas pages for everything early, or the minimum pages;
     - high-resolution pages streamed by visibility and unlock, with placeholder drawing until they arrive;
     - audio by era.
   - **Caching:**
     - content-hashed immutable filenames and HTTP caching;
     - an optional service worker for offline play and updates. It must be optional, because some hosts, including Claude's Artifact pages, do not allow service workers; the game must work fully without it.
   - **Compression:** brotli and gzip.
   - **Memory:** eviction and the GPU memory policy.
   - **Multiplayer:** joining players need the same build, and assets must not block the lockstep.
5. **Milestones.** Update §11's asset and audio budgets and §12's asset and audio contents for M0 (pipeline v0, audio engine v0) and M1.

## Quality bar

- Concrete and measured where it can be.
- Consistent with B1's contracts.
- Implementable by agents who were not here.

Codex will review B1 and B2 together next.

Report in `pm/reports/B2.md`. Your final message is at most 200 words.

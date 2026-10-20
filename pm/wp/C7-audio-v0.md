# C7: Audio v0 (the engine port, mixer, SFX, working sounds)

**Owner:** one Opus agent, working in its own git worktree (the manager sets this up).
- **Commits:** commit to the worktree's branch at milestones, with messages ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push. The manager merges.
- **Writes to:**
  - `game/src/audio/**`;
  - `game/assets/audio/**`;
  - the audio parts of the asset build (`game/scripts/assets/audio*`; keep apart from C6's Blender pipeline);
  - a dev test page under `game/src/dev/` (`audio.html` or similar);
  - `CLAUDE.md` (an audio subsection);
  - `pm/reports/C7.md`.
- **Must not touch:** `design/**`, `game/schema/`, the generated code, the crates, or other layers.

## Why

The audio direction was approved by the user ("the rest is good") after one fix: no unresolved sustained dissonance in organ and pad voices; see `design/audio/DIRECTION.md` §4.2 and `pm/reports/A4.md`'s "User feedback round 1". M0 builds the audio runtime against the event contract (10 §15.6) in parallel with the engine. M1 then adds the slice's sounds and eras.

## Read

- `CLAUDE.md`, `pm/README.md`, `pm/DECISIONS-IMPL.md` (decision 6).
- `design/audio/DIRECTION.md` and `pm/reports/A4.md`. The engine prototype in `design/audio/proto/` is your starting point.
- `pm/reports/B2.md`, with its review response (the worklet, autoplay, codecs, the CPU budget).
- `design/spec/10-architecture.md`:
  - **§9.4** (audio v2: the AudioWorklet voice bank and reverb at 32 kHz, the CPU budget ≤ 8% of a reference core, era sample sets, the SFX system, mixing targets, the Safari/AAC fallback);
  - **§15.6** (events, feedback and audio: `AUDIO_WORKING`, the music feed, the historical flag);
  - §3.1 (threads);
  - §2.2 (the layer rules: `audio/` imports only itself and `shared/`);
  - §11 (budgets);
  - §12 (M0's audio row).
- `design/spec/07-ui.md` §20 (sound settings).

## Deliver (M0 scope, built to last)

1. **The runtime engine** in `game/src/audio/`, ported from the prototype to TypeScript under the code rules (§2.5):
   - the AudioWorklet voice bank and reverb, with no allocation in `process()`;
   - the conductor and the **Era I and Era II rule sets**, Era II with the consonance fix;
   - the scheduler;
   - sample loading and streaming by era.
2. **The mixer and buses:** master, music, effects and UI, with the volume settings hooks from 07 §20. AudioContext creation and resume follow the autoplay rules, and the worklet fails over to a degraded path as §9.4 specifies.
3. **The SFX system:**
   - variation;
   - rate limiting for repeated sounds;
   - Factorio-like positional attenuation and mixing;
   - **working sounds** for machines, from the `AUDIO_WORKING` section by proximity and count;
   - the **event-to-sound map** consuming §15.6 events;
   - **silence** for events marked historical (catch-up and replay).
4. **Decoding:** the codec probe and the fallback (Opus, then AAC) per §9.4.
5. **The decoder dependency.** The generated packet and event decoders come from the schema package, C1b, which is running now.
   - Write the audio layer against a small adapter interface.
   - If `game/src/shared/gen/` already has the decoders when you reach that point, use them. Otherwise build against a local stand-in, mark the seam clearly, and report it; the manager wires it at merge time.
6. **The assets:**
   - the SFX from `design/audio/demos/sfx/` (A4's prototypes) and the Era I–II sample sets, built into `public/audio/` by the asset build;
   - a licence record per file (`design/audio/LICENSES.md` is the source).
7. **Measurement.**
   - **CPU budget in Chrome here**, for Era I, Era II, and SFX under load (100 working machines nearby plus bursts), converted to the reference machine as §11 describes. If the budget cannot be met, say so and say what you would cut.
   - **Offline renders** through OfflineAudioContext in headless Chrome, checked for loudness, no clipping and no denormals. Inspect the spectrograms, and keep the seams clean.

## Quality bar

- The music must sound like the approved demos. Compare the offline engine renders with them: spectrum, loudness, structure.
- **No clicks, pops or glitches:** verify that the start and end of voices are click-free.
- **Tests:** Vitest for the scheduling and mixing logic, with deterministic seeds.
- **Pinning:** heavy jobs use `taskset -c 8-15,24-31`.

## Report

`pm/reports/C7.md`, using the template. Your final message is at most 200 words.

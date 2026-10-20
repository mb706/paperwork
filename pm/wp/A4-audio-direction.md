# A4: Audio direction (music and SFX)

**Owner:** one Opus agent. **Writes only to:** `design/audio/**`, `pm/reports/A4.md`, and user-space installs, which must be documented. Large intermediates go in `design/audio/out/`, which is gitignored; add that rule to `.gitignore`. Final demo files (Opus/Ogg) are deliverables.

## Why

The game needs a soundtrack and sound effects made procedurally, without generative-audio models for now. The user may later try Suno, but wants to see how far we get without it.

The user's words:
- "It should actually be good; Factorio's music is also really good."
- "This does not mean 'make it look and sound like Factorio'. Find an appropriate style."
- Consider what the appropriate **atmosphere** is.

## Read

- `CLAUDE.md`, which covers the audio toolchain and how to judge audio without ears, and `pm/README.md`.
- `design/spec/00-overview.md` §1–§7: premise, ontology, the arc by tier from a 1945 research site to the takeoff, and the tone.
- `design/spec/08-text.md` §0–§1, for the register: clever, not silly, accurate, sparse.
- `design/spec/10-architecture.md` §9.4 (the current audio plan: music21 and pretty_midi, FluidSynth with GeneralUser-GS). Treat it as one option, not as given.
- `design/spec/07-ui.md`, for the sound settings.
- `design/spec/09-vertical-slice.md`, for what the slice needs: about 30 SFX and 2–3 tracks.

## Think first

A seed to test, not a mandate: this is a game about automating a process, about the work being "done by a machine", spanning 1945 to a takeoff. One candidate lineage is **process or systems music**, such as:
- Reich's phasing and *Music for 18 Musicians*, Glass's additive arpeggios, Riley's *In C*;
- Eno's generative *Music for Airports* (tape loops of different lengths), the BBC Radiophonic Workshop and Delia Derbyshire.

There the music is literally made by rules, and its instrumentation could **evolve with the eras**, mirroring computing history:
- 1945: piano, strings, celesta, tape;
- 1960s: early electronic oscillators;
- 1980s: FM;
- later: digital, granular, dense.

The takeoff could accelerate and thicken the music. Evaluate this seed against at least one or two real alternatives and pick the strongest. Factorio's own soundtrack is calm, contemplative, melancholic and expansive, and supports hours of focused play without fatigue. Whatever we pick must do the same.

## Decide the engine

Compare three ways to produce the music:
- **(a) Offline-rendered tracks**, streamed as Opus;
- **(b) A runtime generative engine** in WebAudio: sampled instruments, scheduling, and a convolution reverb from a generated impulse response, perhaps in an AudioWorklet. Precedent: generative.fm-style browser music;
- **(c) A hybrid.**

Weigh them on these criteria:
- quality;
- variety over many hours;
- adaptivity to game state (era, factory activity, takeoff);
- download size and streaming: samples or tracks loaded on demand, small at startup;
- CPU cost on the main thread: the sim has its own Worker, but the renderer and UI share the main thread;
- implementation effort.

Recommend one approach.

## Sound sources

Find the best quality we can legally use:
- **Free instrument samples with clean licences:**
  - CC0 preferred, e.g. the VSCO 2 Community Edition or Versilian VCSL;
  - CC-BY with credit is acceptable, e.g. the Salamander Grand Piano.
- **The SoundFonts on this host.**
- **Synthesis**:
  - Python DSP;
  - Csound or SuperCollider from conda-forge, if they help;
  - Surge XT through pedalboard's VST3 hosting, if it runs on glibc 2.31.

Record every source and licence in `design/audio/LICENSES.md`. Nothing with unclear licensing goes in.

## Demos

Produce **2–3 demo pieces of 90–150 s each**, in your top candidate directions or eras.
- Where it applies, include at least one piece in the 1945 opening era and one in a later era.
- If you recommend a runtime generative engine, the demos should be *renders of that engine's rules*, an offline Python or Node equivalent that is fine for now, so they represent what the game will sound like.
- Master to about −16 LUFS integrated with true peak ≤ −1 dBTP, and export Opus/Ogg plus a WAV under `out/`.

Also produce **8–10 SFX prototypes** that establish the sound palette:
- a UI click and hover;
- building placement and mining or deconstruction;
- an inserter swing;
- a working loop for one 1945-era machine, such as a tabulator or teleprinter;
- a belt loop;
- research completed;
- an alert;
- the footstep set.

Era-appropriate mechanical character is good. Keep it fatigue-free; SFX in Factorio-like games repeat thousands of times.

## Judging without ears

Nobody on this machine can listen, so be rigorous:
- **Composition:**
  - the harmony and voice leading must be sound, with a clear form, dynamic shape and space;
  - balance the registers and keep the low-mid range from getting muddy;
  - avoid harsh 2–5 kHz build-ups;
  - repetition must be purposeful, not accidental.
- **Analysis:** spectrograms (view the PNGs), loudness (ebur128), crest factor, and onset density over time.
- **For loops:** check that the seams are seamless.

The manager will publish the demos so the user can listen and comment. Make them worth listening to.

## Deliverables

- `design/audio/DIRECTION.md`, covering:
  - the chosen style and the atmosphere rationale;
  - the per-era plan, with an instrumentation and harmony vocabulary;
  - adaptivity rules;
  - the engine architecture recommendation, with the WebAudio graph sketch, scheduling, and streaming and loading plan;
  - the SFX palette and design rules, including variation and rate limiting for repeated sounds;
  - the mixing targets, licences, and what the audio WP must build;
  - a "do / don't" list.
- `design/audio/demos/` (Opus files) and `design/audio/proto/` (the generator code, reusable).
- `design/audio/LICENSES.md`
- `pm/reports/A4.md`

## Budget

Take hours if needed. Aim for music the user would actually leave on.

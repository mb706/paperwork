# Paperwork: audio direction

*A4, 2026-10-20. Music, SFX and the audio engine. The demos are renders of the engine described here. The prototype code is in `proto/` and the licences are in `LICENSES.md`.*

## 0. In one page

**The style: process music played by the history of machine music.**
- The soundtrack is calm, warm and slightly melancholic minimalism. It is built from rules rather than scored: Eno's loops of unequal lengths, Reich's phasing, Riley's modules, Glass's additive processes, Pärt's tintinnabuli and Nancarrow's tempo canons.
- Its instruments follow the Literature year: in 1945 a piano, strings, clarinet and harp; from 1957 tape, sine tones and an electric organ; from 1983 FM synthesis; from 2000 samples and grains.
- At the takeoff the piano plays at superhuman speed, in an accelerando without end that doubles its tempo whenever research doubles.
- Across the game the music's performer is automated, as the Site's work is. Nobody comments.

**The engine: (c), a generative-first hybrid.**
- A WebAudio engine plays rule sets live, from about 7 MB of CC0 samples, with generated reverbs and synthesized voices. The same code renders offline, through `OfflineAudioContext`, the fallback tracks, the menu loop and these demos.
- It costs under 1% of the main thread (measured).
- The audio thread is the real budget: 36% of a core for Era I, 53% for Era II and 76% for the takeoff on this host. That is roughly 20–40% on the reference laptop. §6.5 lists the cuts that bring it under 15–25%.
- *Update (WP B2, 2026-10-20):* the runtime is now specified in spec 10 §9.4. Its budget is ≤ 8% of a reference core on average and ≤ 15% in any second. With the shipping pack, an FDN reverb worklet, every sampler voice in one AudioWorklet and a 32 kHz engine, the measured cost is 5.4% (Era I), 7.0% (Era II without its inserts) and 8.8% (takeoff) on the reference machine.

**The demos** (`demos/`; Opus 128 kbps; −16 LUFS, true peak ≤ −1 dBTP):

| File | Era | What to listen for |
|---|---|---|
| `paperwork-era1-1945.opus` (2:25) | I, the charter piece | The motif stated once on the piano. Five piano loops of unequal length take it apart. Strings voice-lead under a pentatonic field. A tintinnabuli clarinet melody with harp follows, then a climax in the violins and a quiet coda |
| `paperwork-era2-1962.opus` (2:25) | II | A marimba tape loop built up note by note. A second copy runs 0.4% fast and drifts out of phase (and 7 cents sharp, as tape does). Organ modules, built only from each drone's consonant tones, accumulate on a tape echo that is erased at every chord change. They sound over a just-intonation sine drone (A, F, G, A). Two Risset bells. The 1945 motif returns on tape at half speed. Revised after user feedback round 1 (§4.2) |
| `paperwork-takeoff.opus` (2:27) | V | The loop closes: the 1945 motif in five voices, one per era, at tempo ratios 1 : 4/3 : 2 : 3 : 4. All five land on one D, the canon's convergence point. Then the takeoff: an endless accelerando on the piano tuned to the harmonic series of D. The cut, and one low D |

The SFX prototypes are 15 sounds in 38 files in `demos/sfx/`; §7 describes them.

---

## 1. Atmosphere

What the player hears for twelve hours should feel like the Site:
- a research institution at night, patient and diligent;
- paper, machines and the hum of rooms;
- the sense that something large is being assembled, one memo at a time.

Three qualities matter more than any style:
1. **Fatigue-free over hours.** Factorio's soundtrack (Daniel James Taylor) is calm, contemplative, melancholic and expansive. Ours must keep those qualities, without its sound. That means:
   - soft attacks and no driving percussion;
   - wide spacing in the low register;
   - a dark, warm spectrum (§8);
   - repetition that changes slowly;
   - long silences between pieces (§5).
2. **The ontology, heard.** *Information is physical.* The music's own information is visibly physical:
   - tape loops of different lengths;
   - a tape copy running fast;
   - a motif passed from piano to tape to FM chip to grains;
   - at the end, the harmonic series: physics itself.
3. **The register: clever, not silly** (08-text §0–§1).
   - The music never narrates, never reacts to individual events and never dramatizes danger. There is no combat or alarm music.
   - It changes register once, for one event, the loop closing (08 §2 rule 8).
   - Its jokes are structural and true, for the expert who notices. The performer is automated across the game. The takeoff doubles in tempo exactly when research doubles. The piano abandons equal temperament for the overtone series once the work is beyond the literature.

## 2. Style: candidates and the choice

The candidates, judged on fatigue over hours, fit with the theme, distinctiveness from Factorio, how well they can be produced from scripts on this host, and adaptivity:

| Candidate | Lineage | For | Against |
|---|---|---|---|
| **A. Process music in the instruments of machine music** (chosen) | Satie's furniture music (1917); Nancarrow (from c. 1948); Riley, *In C* (1964); Reich (1965–76); Glass (1969–76); Eno, *Music for Airports* (1978); Pärt, tintinnabuli (1976) | Made for long attention: ambient and minimalism are designed to be left on. The music is literally made by rules, the charter's question in music's own domain. Era evolution gives a reward over twelve hours and an expert's second layer. Piano, mallets and simple tones are the instruments that sample and synthesize most convincingly | Risks coldness or monotony; warmth must come from harmony, melody and human timing (§3) |
| B. Cinematic ambient-orchestral | Factorio (Taylor), Frostpunk, Anno | Proven for the genre; expansive | Sounds like Factorio, which the user ruled out. Exposed legato strings and brass need commercial libraries; free ones fall short. Algorithmic composition in this idiom tends to wander |
| C. Library and radiophonic hauntology | BBC Radiophonic Workshop (1958), Raymond Scott (1960s), Ghost Box | Evokes a mid-century research institute; tape is physical information | One era's palette for a 1945-to-takeoff arc. Detuned-tape irony tires and drifts toward kitsch, against the register |
| D. Diegetic soundscape only | Paperclips' silence; musique concrète | Purest "nobody speaks" | The user wants music as good as Factorio's. Hours of machine noise tire in their own way, and there is no emotional arc |
| E. Neoclassical post-minimalism | Pärt, Max Richter, Jóhann Jóhannsson (*IBM 1401, A User's Manual*, 2006) | Warm, elegiac, acoustic; Jóhannsson's album is about exactly this subject | One palette, static across the arc |

**A, with E's warmth.** The rules come from process music. The emotional surface comes from post-minimalism: a felt-soft pedalled piano, string pads, a clarinet melody and modal melancholy. The instruments follow the history of machine music.

## 3. Through-lines (what makes it one soundtrack)

1. **One motif.**
   - **The motif:** A4 D5 C5 A4 G4 (degrees 5 1 ♭7 5 4 of D minor pentatonic), rhythm 1.5 0.5 1 1 2.5 beats. A question; it ends on the fourth.
   - **Where it appears:**
     - stated once at the start of the charter piece;
     - taken apart by the Era I loops;
     - on half-speed tape in Era II;
     - played by the FM chip in Era III and turned into grains in Era IV;
     - the subject of the convergence canon at closure;
     - the after-victory callback.
   - **In the SFX:** the research-complete chime is its first interval (A→D); the alert inverts it (D→A).
2. **The performer is automated.**
   - 1945: human rubato (onsets ±12 ms, velocity ±0.035, phrase arches).
   - 1960s: tape, with exact repetition and wow.
   - 1980s: MIDI quantization.
   - 2000s: grains.
   - The takeoff: a player piano at superhuman speed (Nancarrow).
   - After victory: the charter piece once more, its timing quantized and its touch even. The same notes, played by the machine. This is the game's one musical callback, and it comes only after the mechanics have inverted its meaning (08 P6).
3. **The piano is the protagonist.** It plays from 1945 to the last note: the same Steinway B, close-miked, sustain pedal down.
4. **The harmony brightens across the arc:**
   - D minor pentatonic (1945);
   - modal drones (1960s);
   - major sevenths and Lydian colour (1980s);
   - spectral clusters (2000s);
   - at the takeoff, the harmonic series of D in just intonation, which is D major. The minor of 1945 turns into physics.
5. **Rooms change with the era:**
   - a hall (Era I);
   - an EMT 140-style plate (1957; Era II);
   - a digital hall (Lexicon-style; Era III);
   - long generated tails (Eras IV–V).

## 4. Per-era plan

The era is chosen by the Literature year when a piece starts (`engine/conductor.js`, `ERAS`). Instruments enter the soundtrack in the year they entered music. The years are approximate and the boundaries are tunable data.

| Era | Literature | Tiers (competent pace) | Instruments | Rules (processes) | Harmony | Room |
|---|---|---|---|---|---|---|
| **I Relays and tubes** (implemented, `pieces/era1.js`) | to 1956 | Start, Memo; ~0:00–0:50 | Steinway B (soft layers); violin, viola and cello sections; contrabass; clarinet; harp; glockenspiel | Piano loops of 19.7, 23.3, 29.9, 34.1 and 41.3 s, each a fragment of the motif. The loops mutate by one field step every few cycles. Strings voice-led under a top line (§4.1). A tintinnabuli melody, M-voice on clarinet, T-voice on harp, in additive phrases. An activity layer: a harp arpeggio | A pentatonic field (F G A C D) over a moving bass. The bass alone gives Dm7, B♭maj9(13), F6/9, C6/9sus, G9sus. Cycles i–VI–III–VII and i–VII–VI–VII; the approach iv–VI–VII–i. Under the melody, plain Dm and B♭ triads below E4 | Hall, T60 2.7 s mid |
| **II Tape and oscillators** (implemented, `pieces/era2.js`) | 1957–1982 | Report; ~0:50–2:00 | Marimba tape loops; vibraphone with motor; drawbar organ; sine drones; Risset bell; piano on tape; tape hiss | Additive entry (Glass); tape phasing at +0.4% (Reich), on percussive voices only; organ modules (Riley) from the drone's consonant set, one or more per drone section, into a time-lag accumulator. The accumulator has a 4-beat delay, feedback 0.36, a 2.4 kHz loop lowpass and 0.3 ms wow, and is harmonically gated: the tape is erased at every chord change. Subtractive exit; machine-exact repetition | An A minor pentatonic field. The drone (root, just fifth, octaves) moves I–♭VI–♭VII–I. The organ's sets: A C E over A, A C over F (F would sit a semitone above the loop's E), G D over G. The vibraphone plays the same set under the organ, and sus and seventh voicings elsewhere. A last Am9 keeps the B for the end | EMT 140-style plate, T60 2.6 s; tape echo |
| **III FM and MIDI** (to build) | 1983–1999 | Report (late), Article; ~2:00–3:40 | The VCSL TX81Z FM piano (CC0); runtime two-operator FM bells and mallets; marimba; the Steinway; digital delay | Chord-cycle pulses swelling over a breath's length (after *Music for 18 Musicians*, 1974–76), MIDI-exact; sequenced 16th arpeggios phase-shifted by whole steps; dotted digital delays | Major sevenths and ninths, Lydian; a cycle of 8–11 chords; FM bell melodies | Digital hall, T60 4.4 s |
| **IV Samples and grains** (to build) | 2000–2016 | Article, Preprint; ~3:40–6:00 | Granular clouds made from the Era I–III sample packs; sub-bass sines; glass; bowed vibraphone | Granulation (Xenakis 1959; Roads 1975; Truax 1986); time-stretched motifs; slowly evolving spectra | Extended chords and soft clusters; spectral pads | Long tail (FDN) |
| **IV′ The corpus** (to build) | 2017 to closure | Preprint, Model card, the System card plateau; ~6:00–11:30 | Era IV's engine, fed with the soundtrack's own earlier pieces (rendered offline as the corpus) | The earlier eras' motifs and chords return as grains and recombinations. Optionally, as the synthetic share σ rises, a larger part of the corpus is the music's own recent output, and its variety narrows a little (model collapse, inaudible unless known) | The earlier eras', blurred | Long tail |
| **V Takeoff** (implemented, `pieces/takeoff.js`) | Closure to victory | System card; ~11:30–12:20 | All: the piano at player-piano speed; strings; wine glasses; a glockenspiel shimmer | At closure, the convergence canon (§5.3). Then a Risset eternal accelerando: piano streams an octave of tempo apart that fade in at the bottom and out at the top. One tempo doubling per research doubling; stream register rising through the harmonic series; a crescendo; the cut; one low D | The overtone series of D in 5-limit just intonation (partials 2–30, without 7, 11 and 13): D major. The bed climbs from partials 2–10 to 8–24 | Hall + long tail |

**Why the late eras get the most rules.** At the competent pace the corpus era covers about 5½ hours: more than all the other eras together (`render/session.mjs`). That rule set needs the widest variation: forms, densities, and which earlier eras feed it.

### 4.1 Composition rules shared by every era (`engine/theory.js`)

- **Fields and bass.** Sustained material uses a pentatonic field: five pitch classes with no semitone and no tritone, so any subset is consonant. The bass alone moves the harmony. A field change moves each loop note to the nearest new field note (`remap`).
- **Voicing** (`voiceChord`):
  - exhaustive search over the voices' ranges;
  - smallest total motion, with the top voice weighted most;
  - the lowest upper voice is the root, third or fifth;
  - a frozen upper structure over a moving bass is penalized;
  - no parallel fifths or octaves against the bass;
  - no unisons;
  - adjacent upper voices within an octave.
- **Low-interval limits.** Nothing within a fifth of a bass below C3; nothing within an octave of a bass below E2; no third or smaller below E3. These rules keep the low mids clean (measured: §13).
- **Never a minor second or ninth against the melody.** Chord voicings treat this as a hard constraint against every melody note sounding with the chord. Passing tones outside the field last one beat.
- **Sustained voices over a drone use its consonant set** (`consonantSet`). Organs, pads, glass and bowed sounds may hold only pitch classes that form no second, seventh or tritone with the drone's root and fifth, with each other, or (no semitone or tritone) with any persistent layer such as a loop. An echo or a held pad stacks every note it has played into one chord, so a melodic second becomes a sustained cluster.
- **Echoes and held tails are harmonically gated.** A tape echo's feedback is erased from 0.5 s before each chord change until one delay after it, and no new notes enter it in the last beat before a change. No tail carries one chord into the next.
- **Only percussive voices drift.** Tape wow and phasing detune; on struck sounds that is character, on held sounds it is a sour chorus against their own copies. Echoes of sustained voices get at most 0.3 ms of wow.
- **A composed top line** (`topLine`). The string top line follows a dynamic contour to the climax, preferring steps to leaps and moving rather than repeating. Re-entries after a rest are free.
- **The melody's range is kept.** Additive phrases grow 2-3-4-5; after that, 4 (rising to the centre) and 5 (falling to it) alternate, so the tune stays above the accompaniment.
- **Form.** Intro (≤14 s), A, B (as long as its melody), A2, coda (≤16 s). Longer pieces repeat cycles, with variant second passes, rather than stretch chords.
- **Human timing only where a human plays.** Era I is humanized; the eras after it progressively are not.
- **Velocity layers are normalized in prep, then given a small designed step** (+4 dB for two layers, +3/+6 for three). Libraries record their layers at natural levels: VSCO 2's soft and loud viola layers differ by 29 dB. Left so, the sampler's crossfade is dominated by the loud layer even at pp, and a soft pad sounds like forte strings played quietly. This was found and fixed during A4; all demos use normalized layers.

### 4.2 User feedback round 1: Era II's organ

The user: "the organs in the 1962 sound somewhat dissonant; the rest is good."
- **Cause.** The organ modules contained melodic major seconds (E–D, C–D). The time-lag accumulator, at feedback 0.52, stacked each module into sustained clusters, and its 1.2 ms wow detuned the repeats against each other.
- **Two hypotheses tested and rejected:**
  - *Equal temperament against the just-intonation drone.* The drone is pure sines on root and fifth, which are 2 cents off equal temperament, and the drawbar organ has no 5th harmonic. In this timbre a just major third is no smoother than an equal-tempered one (roughness 0.0018 vs 0.0016).
  - *Tape drift on the organ.* Drift applied only to the marimba copy.
- **Fix.** The rules in §4.1: consonant sets, the harmonic gate on the echo, and drift on percussive voices only.
- **Results:**

| Measure | Before | After |
|---|---|---|
| Organ-involved pairs that are seconds, sevenths or tritones, echo modelled | 26.0% | 2.5% |
| Dissonance index | 1.01 | 0.25 |
| Same, counting the marimba loops | 27.5%, 4.0 | 16.1%, 2.16 (the rest is the loop's passing notes) |
| Organ-only roughness (Sethares) | mean 0.0047, 90th percentile 0.0075 | 0.0016 / 0.0040 |

For scale in this timbre: fifth 0.0003, minor triad 0.0033, major second 0.0078. Picture: `out/analysis/era2-organ-before-after.png`.

## 5. Adaptivity rules (`engine/conductor.js`; tested by `render/session.mjs`)

### 5.1 Pieces and silences

1. **The charter piece first.** The first piece of every game is Era I with seed 1945, in the home key, about 150 s long: the same each game, a title theme.
2. **Pieces alternate with silences.** Pieces last 3–6 min; silences 1.5–3.5 min, scaled by (1.2 − 0.4 × activity). Music sounds about 67% of the time (measured over a simulated 12.6 h game).
3. **The era is chosen only when a piece starts**, from the Literature year. A piece never changes era midway. When an era changes, its sample pack has been preloaded (§6.4).
4. **Every piece is different.** Each gets a new seed, a key one step around the circle of fifths (transposition −5…+6), a tempo within ±5% and a form variant. The dry run over 12.6 h repeats nothing except the deliberate callback (rule 7).
5. **Activity** is factory busyness, 0..1: power consumption over 60 s, log-scaled against the era's typical value and smoothed over minutes. The sim supplies it. It gates layers within a piece:
   - Era I: harp arpeggios, and the number of loops;
   - Era II: whether the phasing copy runs;
   - later eras: density.
   Activity never changes tempo or key, and never reacts to single events.
6. **The music never reacts** to alerts, damage, heat throttling, compromised machines or runaways. Those have SFX; the music keeps its register (08 §0).
7. **After victory:** silence for 60 s, then the charter piece played by the machine (quantized, even velocity). Then the normal rotation resumes, with eras by Literature year.

### 5.2 The takeoff

- **The doubling period follows the game.** It is the doubling-time readout (07 §5.1; 04 §5), clamped to 3–90 s:
  - slower than 90 s, the drift would be inaudible anyway;
  - faster than 3 s, the ear stops following the layers. The music caps there and the texture becomes a dense, shimmering cloud.
- **One tempo doubling of the music for each research doubling** (Model generation 6→25: 20 doublings).
- **The crescendo and the thickening** follow takeoff progress (generation 6→25). The base stream rate rises 1.5×, and the glockenspiel doubles the fastest streams in the last 40%.
- **The end gesture.** At the capstone the cloud stops; after the reverb, one low D. Silence follows until the run report.

### 5.3 The loop closes (the one unique cue)

The event is closure: the first System card written by a Research hall.
1. Whatever plays fades over 6 s.
2. The convergence canon plays: the motif in five voices, one per era (piano 1945, vibraphone 1960s, FM 1987, sine tones, glockenspiel), at tempo ratios 1 : 4/3 : 2 : 3 : 4. The entries are computed so that every voice reaches the final D at the same instant.
3. That instant is the only tutti in the whole soundtrack: every era sounding together, strings crescendoing into it.
4. About 6 s of reverb, then the takeoff.

The cue is 15 s long. A cue on this scale does not break the register; it has no fanfare.

### 5.4 Elsewhere

- **The main menu** plays the charter piece on a loop, rendered offline into one Opus file of about 2 MB (96 kbps, §6.4), so the menu does not need the engine. The first piece of every game plays from the same cached recording while the Era I pack loads (spec 10 §9.4).
- **Audio context.** The first click or key on the main menu starts the AudioContext (07 §18).
- **A hidden tab** pauses the game (07 §19.3). The music fades over 1 s and the context suspends; it resumes on return. With *Keep running in background tab*, a Worker-driven clock keeps scheduling.
- **Map view and zoom** do not change the music; they change SFX (§7.3).

## 6. Engine: evaluation and recommendation

### 6.1 The three options, measured where possible

| Criterion | (a) Offline-rendered tracks, streamed | (b) Runtime generative engine | (c) Hybrid, generative first (**recommended**) |
|---|---|---|---|
| Quality | Highest ceiling: any processing, long reverbs, per-track mastering | The same instruments and rules; limited by the realtime budget (reverb length, voices) and by bus-level mastering | (b) for play; (a)-quality offline renders where the budget or the browser demands |
| Variety over 12 h | Factorio ships ~30 tracks (~2.5 h). For 12 h without fatigue, ~3 h of tracks | Unlimited: 0 repeats in the 12.6 h dry run, from one rule set per era | As (b) |
| Adaptivity | Crossfades between tracks only. Cannot follow the doubling time continuously, or place a cue at an exact moment, without many variants | Continuous: tempo, density, instruments, the convergence cue at the exact moment, activity gates | As (b) |
| Download | Slice: 2–3 tracks × 4 min × 96 kbps ≈ 6–9 MB for 10 min of music. Full game ~130 MB for 3 h | Slice ≈ 7.5 MB (shipping profile: Era I 6.3 MB, Era II +1 MB, SFX 0.3 MB). Full game ~15–20 MB. Packs lazy per era | As (b), plus a 3 MB menu loop and optional fallbacks |
| Main-thread CPU | ~0 (a media element) | Scheduler 0.09–0.6% of a core; worst tick 1.7–14 ms (measured, §6.5) | As (b) |
| Audio-thread CPU | ~2% | Measured 36% (Era I), 53% (Era II), 76% (takeoff) of a core on this host, about 20–42% on the reference laptop. Optimized target ≤15% / ≤25% (§6.5); spec 10 §9.4 now sets ≤ 8% on average and measures 5.4–8.8% | As (b), with a fallback to (a) on weak machines |
| Effort | Low: 2–3 agent-days | High: the engine port, rule sets and tests, ~7–9 agent-days for M1 | (b) + ~1 day (offline-render tooling exists: `render/render.mjs`) |

**Recommendation: (c).**
- A runtime generative engine is the primary path. It is the only option that delivers variety over twelve hours and the adaptivity the design asks for (H #7: "the procedural music's tempo follows [the doubling time]"; 08 §2 rule 8: one cue for one event).
- It downloads less per hour of music than tracks.
- Because the engine runs in `OfflineAudioContext` unchanged, (a) comes for free where it is better:
  - the main-menu loop;
  - a low-power or "simple audio" fallback that streams pre-rendered pieces per era (setting: *Music: generative / recorded*);
  - Safari, if decoding or timing proves unreliable;
  - trailers.

### 6.2 Architecture (the prototype: `proto/engine/`)

*The game's runtime differs from this prototype graph; spec 10 §9.4 (WP B2) is binding for it. Every sampler voice is mixed in one AudioWorklet (Int16 samples), an FDN worklet replaces the convolvers, the tape and tremolo inserts move into the worklet, and the engine runs at 32 kHz. The offline renderer may keep this graph.*

```
 game state (sim → main thread, per second): literatureYear, activity, closure, doublingTime, victory, paused
        │
 Conductor (conductor.js) ── chooses piece + params ──► Piece (pieces/era*.js): rules → note events
                                                              │  schedule(t0, t1) every ~100 ms, lookahead 0.8 s
                                                              ▼
 MusicEngine.play(event) ─► Sampler / Synth voice (BufferSource or Oscillators → Gain envelope; self-disconnecting)
        │
        ▼
 channel: trim ─► EQ ─► inserts (tape wow/flutter, tremolo) ─► pan ─┬─► dry ──────────────────► era bus ─┐
                                                                    └─► send ─► reverb (Convolver,       │
                                                                                generated IR) ─► era bus ┤
 era buses (at most two alive; crossfade at an era change) ─► music bus ─► HP 30 Hz ─► air shelf ─► glue ─► music fader ─┐
 SFX: event voices ─► category buses (GUI, effects, alerts, walking, environment, ambient) ─► faders ──────────────────┤
 working loops: one voice per entity type, gain from the count of visible working entities ─► environment ────────────┤
                                                                                       master fader ─► limiter ─► out
```

- **Sampler** (`instruments.js`):
  - nearest-root zone, preferring to shift a sample down;
  - equal-power crossfade between two velocity layers;
  - `rate` for tape transposition;
  - sustained instruments re-bowed: overlapping segments with 1.6 s crossfades, starting past the attack. No loop points are needed, so codec padding cannot click.
- **Synth voices:** sine; drawbar organ (PeriodicWave); Risset's 1969 additive bell (beating partial pairs); two-operator FM with a decaying index (Chowning 1973).
- **Generated impulse responses** (`makeIR`, no download): stereo, decorrelated noise in three bands, each with its own T60, plus a diffuse build-up, early reflections and pre-delay. Presets: `hall`, `plate`, `digital`, `vast`.
- **Inserts:**
  - **tape:** a delay modulated by 0.55 Hz wow and 7.3 Hz flutter, tanh saturation and the bandwidth of a 1960s ¼-inch machine;
  - **tremolo** (a vibraphone motor);
  - **tape echo / time-lag accumulator:** a long delay whose feedback loop runs through a lowpass, highpass, saturation and wow;
  - **noise bed** (tape hiss).
- **Notes in the past** (a main-thread stall, or joining a piece midway) play at once if up to 50 ms late, and are otherwise dropped and counted. A note is never scheduled in the past.

### 6.3 Scheduling

- **Lookahead.** A main-thread timer ticks every 100 ms. Each tick asks the current piece for the notes that start in [cursor, now + 0.8 s) and schedules them sample-accurately (`clock.js`).
- **Measured:**
  - **Never create a piece's nodes up front.** Chrome processes every connected node each render quantum. 1,450 notes created at once rendered at 0.67× real time; with lookahead the same load ran at 3.2×.
  - **The scheduler costs** 0.09% (Era I), 0.3% (Era II) and 0.6% (takeoff) of the main thread. The largest steady tick was 14 ms, a burst of note creation.
- **Offline rendering** suspends the OfflineAudioContext every 0.25 s and calls the same `tick`. The demos are therefore the runtime code path. An exception in a tick is recorded and rendering continues; the context is never left suspended.
- **Realtime robustness.** Use `latencyHint: 'playback'` and 0.8 s of lookahead. Ticks come from a Worker timer when the tab is hidden and set to keep running. Long pauses (worldgen, saves) only drop notes; they never stall.

### 6.4 Loading, formats and streaming

- **Packs** are per instrument, built by `samples/prep_samples.py`:
  - **full** (`out/samples/prep`, 47 MB): demos and the offline renders;
  - **ship** (`out/samples/ship`, 7.8 MB for 12 instruments).

  The ship pack reuses the full pack's per-file gains, so the engine's trims are valid for both. Two corrections a script cannot compute in advance, and how the pack handles them:
  - **Power-preserving mono downmix and one layer.** A spaced pair's (L+R)/2 loses up to 6 dB, and one layer cannot reproduce a crossfade. The downmix is power-matched, and the single layer is level-matched at velocity 0.4.
  - **Empirical matching.** `analysis/packmatch.py` renders the same piece from both packs and folds each instrument's remaining difference into the ship manifest's `makeup_db`. Measured on Era I: every instrument within 0.1 dB of the full pack, the mix within 0.1 LU, the spectral tilt within 0.2 dB/octave.
  - **Below full scale.** A pack whose files would exceed 0.95 is attenuated as a whole, and `makeup_db` restores the level in the sampler.

  The ship profile:
  - the piano is stereo, two layers, 7 s, 64 kbps;
  - bowed and blown instruments are mono, one (soft) layer, 6 s, 40 kbps;
  - mallets are mono at 40–48 kbps;
  - only the ranges the rules use are kept.
- **Per era:** Era I 6.3 MB (the piano 3.8 MB); Era II +1.0 MB (marimba, vibraphone; the piano is shared); SFX 0.3 MB.
- **Load order** (spec 10 §9.4, §9.7):
  - SFX with the first frame of a game;
  - Era I during the first piece, which plays from the menu loop's cached recording;
  - Era II in idle time;
  - each later era when the Literature year comes within ~5 years of its boundary.
- **Size reductions, if more are needed:**
  - sample the piano every major third (32 zones instead of 64): −1.9 MB;
  - give it one layer, with a velocity lowpass: −1.9 MB.
- **Format.**
  - Ogg/Opus decodes sample-exact in Chrome: the decoded length equals the source and the lag is 0, so encoder pre-skip is handled (`render/looptest.mjs`). WebM/Opus also decodes.
  - Samples and SFX ship as Ogg Opus, with an AAC `.m4a` fallback chosen by probing `decodeAudioData` at startup (spec 10 §9.4). Safari is the reason.
  - Loops never rely on the file boundary. The manifest carries `loopStart` and `loopEnd`, so an AAC fallback's priming samples cannot click.
- **Music tracks** (the menu loop, fallbacks): Opus at 96–128 kbps, streamed through a media element, not decoded into memory.

### 6.5 CPU budget (measured with `render/bench.mjs`: live AudioContext, per-thread CPU from /proc)

| Piece | Audio thread (this host) | Without convolution reverb | Notes per second |
|---|---|---|---|
| Era I | 36% of a core | n/a | ~1.5 |
| Era II | 51–53% | 35% | ~6 |
| Takeoff (late, doubling time 4 s) | 76% | 40% | ~10–20 |

- This host runs single-threaded at about 0.55× the reference laptop, so these figures are roughly 20/29/42% there.
- Compressors and limiters cost nothing measurable.
- *Update (WP B2):* spec 10 §9.4 now sets the budget at ≤ 8% of a reference core on average and ≤ 15% in any second, and measures the cuts below plus an AudioWorklet voice bank and a 32 kHz engine: 5.4% (Era I), 7.0% (Era II without its inserts) and 8.8% (takeoff). The FDN replaces every convolver at run time, not only the long tails, and the fallback to recorded pieces starts above 15% on the user's machine.
- **The cost is reverb (about one third) and voices.** The audio WP must reach ≤15% (Eras I–II) and ≤25% (takeoff) on the reference laptop, by:
  1. **One convolver per era bus, IR ≤ 4 s.** Longer tails (Eras IV–V; the takeoff's 12 s `vast`) come from a feedback-delay-network reverb in an AudioWorklet: 8 lines, about 1–2% of a core.
  2. **No velocity-layer crossfade** for notes shorter than 0.5 s or faster than 6 per second: one voice per note.
  3. **A voice cap:** 48 music voices, 24 SFX voices. Steal the quietest, then the oldest.
  4. **Inserts per channel, never per voice.** WaveShaper oversampling only where saturation is audible (tape echo: none).
  5. **Measure on the user's machine:** `bench.html` (10 §10.6) gets an audio page (this benchmark ported). If the audio thread exceeds 40% there, the engine falls back to recorded pieces (§6.1).

### 6.6 Determinism and tests

- **Determinism.** Pieces are seeded (`rng.js`), so a piece reproduces from its seed and the game-state history. Audio is presentation and need not be bit-identical across browsers; the simulation's determinism rules do not apply.
- **Fast tests in Node, without audio** (`render/dryrun.mjs`), all suitable for Vitest:
  - every rule set runs over a simulated piece in milliseconds;
  - every event is valid (finite pitch, time ≥ 0, velocity 0–1.2, duration > 0);
  - clash and crowding checks run on the note list;
  - `render/session.mjs` checks the conductor over a simulated 12.6 h game.

## 7. SFX

### 7.1 Palette

*Information is physical*: the Site's sounds are the sounds of handling information.
- Slice era: card stock, keys and relays; motors and belts; wood and steel set down.
- Later eras' entities bring their own: disk drives, fans, transformers, server rooms.

The rules:
- **Soft attacks:** at least a 0.5 ms ramp, and no hard digital clicks.
- **Energy centred at 300 Hz–2 kHz.** Little above 7 kHz in anything that repeats.
- **The two chimes speak the music's language.** Research complete is A→D on vibraphone with a glockenspiel D above, the motif's first interval. The alert is D→A, the same interval falling.
- **A refusal sounds mechanical:** a dull relay thunk with a short 110 Hz buzz, never a shrill beep.

### 7.2 The prototypes (`proto/sfx/sfx.py`; files in `demos/sfx/*.ogg`, Opus 64 kbps mono)

| Sound | Variants | Design | Level as authored |
|---|---|---|---|
| `ui_click` | 3 | A CC0 woodblock (pp), lowered 1–2 semitones and darkened; a faint high tick; a small body. Centroid 0.6–0.9 kHz | −14 dBFS peak |
| `ui_hover` | 2 | A dry brush of paper: 30 ms of band-passed noise and a 1.45 kHz mode | −28 dBFS peak |
| `build_small` / `_medium` / `_large` | 3/3/2 | A pitch-dropping thump (300→190, 240→140, 190→105 Hz) under a contact (claves, or brake-drum hammer, lowered); granular settling; a ratchet latch (medium, large); a small room | −10/−8/−7 dBFS |
| `deconstruct` | 3 | A ratchet turned back (unbolting), a lift swoosh, a pick-up click | −10 dBFS |
| `mine_ore` | 4 | A stony knock (four inharmonic modes around 560–760 Hz), crumble grains, a low thud | −9 dBFS |
| `inserter_swing` | 4 | A servo whir: a band-limited saw following the swing's speed profile, gear grain, a soft grab at the end | −18 dBFS |
| `keypunch_loop` | loop, 4.0 s | An IBM 026-style cycle: card feed, two bursts of punches at 13 per second, eject, 60 Hz motor and whir. Built circularly, so it is seamless | −28 LUFS |
| `belt_loop` | loop, 2.4 s | Rumble 55–260 Hz; 15 uneven roller ticks per second. Circular | −32 LUFS |
| `research_complete` | 1 | A4→D5 vibraphone, glockenspiel D6, a small room | −8 dBFS |
| `alert` | 1 | D5→A4 vibraphone with a slightly harder strike | −8 dBFS |
| `error` | 2 | A relay thunk plus a short muted 110 Hz buzz, low-passed at 2.5 kHz | −12 dBFS |
| `footstep_grass` / `_concrete` | 4/4 | Heel thump and toe; grass crunch grains at 0.9–3.4 kHz, or a concrete click and scuff with a little room | −20 dBFS |

Measured (`proto/sfx/sheet.py`, `out/analysis/sfx-sheet.png`):
- **Centroids, K-weighted:**
  - UI click 0.74–1.05 kHz;
  - inserter 0.54 kHz; keypunch 0.44; mine 0.71–0.80; deconstruct 1.1–1.2; chimes about 1.0;
  - builds 0.16–0.35 kHz, the low-mid clunk;
  - error 0.14 kHz, a low thunk by design;
  - belt rumble 0.26 kHz;
  - footsteps 1.9–2.3 kHz, at −40 LUFS-M.
- The 2–5 kHz share is ≤ 5% for everything except footsteps (≤ 41%) and hover (≤ 17%, at −51 LUFS-M).
- The loop wrap steps are below the loops' median sample step, so both loops are seamless, also after Opus decoding in Chrome (zero lag, exact length).

### 7.3 Rules for the runtime (the audio WP)

1. **Variants.** Every sound that repeats has 3–4 variants. Choose at random but never the same one twice in a row. Add per-play jitter: pitch ±3% (UI ±1.5%) and gain ±1.5 dB.
2. **Rate limits per sound type**, within 100 ms:
   - error: 1 (I §3.12);
   - build: 3;
   - mine: 2;
   - UI click: 1 per 30 ms;
   - footsteps: tied to the walk cycle (about 3.7 per second at running speed).

   Over the limit, drop the sound; never queue it.
3. **Voice limits:** 24 SFX voices; 4 per type. Steal the quietest, then the oldest.
4. **Working sounds** (10 §9.4): one looping voice per entity type.
   - Gain = min(1, 0.5·log₂(1 + n)) × distance weighting, where n is the number of working, visible entities of that type.
   - Pan to their weighted screen centroid.
   - The loop fades over 0.3 s when the type's last working entity stops.
   - A type's loop restarts at a random offset, so many entities never phase-lock audibly.
5. **Space.**
   - **Pan** by screen x: ±0.7 at the screen edges.
   - **Distance:** attenuate by distance from the view centre, −6 dB at half a screen.
   - **Zoom:** zooming out lowers entity SFX, −9 dB at 0.25× zoom. Map view mutes world SFX but keeps UI and alerts.
6. **Loops** come from the manifest's `loopStart`/`loopEnd` (never file boundaries). They are built circularly and verified by `render/looptest.mjs`.
7. **Spectral limits** for anything heard more than ~100 times an hour:
   - K-weighted centroid 150 Hz–1.5 kHz, at least 500 Hz for UI;
   - 2–5 kHz share ≤ 25% for sounds louder than −35 LUFS-M;
   - nothing above 7 kHz that matters;
   - no exact repetition (rule 1).

### 7.4 What the slice needs

The minimum set is I §3.12's list, plus the working sounds of the slice's entities.
- **UI:** click; tab; open and close per entity type; inventory move per material (metal, wood, paper, stone, card); pipette; rotate.
- **Build and mine:** build (small, medium, large); mine per material (ore, stone, wood, entity); craft finished.
- **Results and warnings:** research finished; confirm; alert; error.
- **Footsteps:** grass, dirt, sand, concrete.
- **Working sounds:**
  - burner and electric drills;
  - keypunch;
  - stone and steel furnaces;
  - assemblers 1 and 2;
  - Seminar: a soft room murmur of papers and chalk, never voices (L9: nobody speaks);
  - boiler;
  - steam engine;
  - inserters by family;
  - belts by tier;
  - radar;
  - offshore pump.

That is about 30 sounds and 90 files (10 §12 M1c). The prototypes in §7.2 set the method for all of them.

## 8. Mix and loudness targets

| Item | Target |
|---|---|
| Demo masters | −16 LUFS integrated, true peak ≤ −1 dBTP after Opus encoding (`analysis/master.py`). Achieved: −16.1, −16.0 and −16.0 LUFS; −1.2, −1.3 and −1.0 dBTP. The limiter reduces gain by more than 1 dB on 0.39% of samples (Era I, max 3.2 dB) and on none in the other two |
| In-game music, 100% music volume | Each era bus is calibrated so a piece measures −18 LUFS integrated (takeoff −16, peaking −13 short-term). Bus gains from the measured engine outputs (−32.1, −27.4, −23.3 LUFS): Era I +13.9 dB, Era II +9.4 dB, takeoff +7.3 dB |
| Default music volume | 70% on a squared-gain slider (−6 dB): ambient pieces at about −24 LUFS, under the SFX |
| SFX as authored | At 100%: UI click −36 LUFS-M; build −22…−26; research −16; alert −15; error −28; footsteps −40; a working loop −28 for one entity and up to −22 aggregated |
| Master | Limiter at −1 dBTP; no bus compression on SFX; gentle glue on music only (ratio 1.8) |
| Spectral balance (music) | Tilt above 500 Hz of −6.5 to −9 dB/octave (measured: Era I −7.5, Era II −8.9, takeoff −6.7). The piano carries a −3 dB dip at 2.8 kHz; air shelf above 7 kHz. Dark is deliberate (hours of listening). Era II's marimba and soft vibraphone are the darkest; `air()` and the mallet velocities are the knobs if the user wants more brightness |
| Low end | Highpass at 30 Hz on the music bus; the sub band (<60 Hz) only from Era II's drone and the contrabass |
| Ducking | None, except the 6 s fade before the closure cue. Alerts sit 8–10 LU above the music bed instead |

## 9. Licences

All instrument samples are CC0 (VCSL; VSCO 2 Community Edition); everything else is our own code. The details, the pinned commits and the credit line are in `LICENSES.md`. The host's GeneralUser GS is *not* used: its provenance statement is uncertain.

## 10. What the audio WP must build

**M1 (the slice: Literature up to 1969, so Eras I and II):**
1. **`src/audio/`, ported from `proto/engine/` to TypeScript:**
   - Clock, Mixer (buses per I §4.20 category: Master, music, game effects, GUI, alerts, environment, walking, ambient; mute per category);
   - Sampler, Synth, IR generator, inserts; at run time the sampler voices, the inserts and the reverb are the AudioWorklets of spec 10 §9.4 (the voice bank and the FDN);
   - MusicEngine, Conductor;
   - the Era I and Era II rule sets.
2. **The state feed from the sim** (10 §3.2 packets): Literature year, activity (power over 60 s), pause. Closure, doubling time and victory come at M4.
3. **AudioContext lifecycle** (07 §18 first gesture, §19.3 hidden tab); music keys `play-next-track`, `play-previous-track` and `pause-resume-music` (I §2): next and previous step through the conductor's program.
4. **The SFX system:**
   - an event map from `ev` (sounds named in data, one place);
   - variants, jitter, rate and voice limits;
   - working-sound aggregation and spatialization (§7.3).
5. **The asset pipeline** (`npm run assets`), cached by content hash (10 §9.6):
   - `fetch_samples.py`;
   - `prep_samples.py --profile ship`;
   - `sfx.py` for the full slice list;
   - the offline-rendered menu loop.
6. **Tests:**
   - in Vitest: the rule-set dry runs (no exceptions; no m2/m9 clashes in sustained voices; density ranges per section) and the conductor's session properties;
   - in Playwright: an offline render smoke test (loudness within ±1.5 LU of calibration) and the loop-seam test;
   - the audio CPU benchmark in `bench.html`.

**M2–M4:**
- Era III (M2) and Era IV/IV′ (M3), each a rule set plus a pack;
- the takeoff with the closure cue and the doubling-time feed (M4);
- the FDN reverb worklet (built in M0, spec 10 §9.4) tuned for the long tails before the takeoff ships;
- the after-victory callback.

**Effort.** About 7–9 agent-days for M1 audio: the engine port 3, the SFX system and set 2–3, tests and calibration 2. About 2–3 per later era.

## 11. Do and don't

**Do**
- Compose with rules that would survive being written down: fields, voice leading, canons, phasing.
- Keep one motif and one piano across the game.
- Measure every change:
  - stems' loudness, so balance is a number;
  - the long-term spectrum and its tilt;
  - the clash and crowding checks;
  - the realtime CPU on the reference machine.
- Leave silence: about a third of the time, no music.
- Let the instruments arrive with the Literature year, and let the performer be automated by degrees.
- Keep SFX quiet, soft-edged and varied; play loops from manifest loop points; check seams.

**Don't**
- No music that reacts to danger, alerts or individual events (the one exception is closure). No combat or alarm music.
- No quoting of real pieces. Process techniques are not copyrightable; patterns, melodies and *Daisy Bell* stay out (P9: famous references are bent or dropped).
- No exact repetition of a sample many times a second, and no hard digital clicks.
- No hiss, saturation or detuning used as irony ("retro"). Tape is an era's instrument, not a joke.
- Never create a piece's nodes ahead of the lookahead window. Never schedule in the past.
- No 2–5 kHz build-ups, no thirds below E3, no minor ninths against a melody.
- No unresolved sustained dissonance in organ and pad voices. Seconds, sevenths and tritones held longer than a beat (echo tails included) are allowed only as passing tones that resolve. Measure it with `analysis/dissonance.py`: organ-involved pairs below 5% seconds, sevenths and tritones; the organ-only roughness no higher than a minor triad in the same timbre (0.0033).
- No samples with unclear provenance (GeneralUser GS). No AI-generated audio (for now; the user may try Suno later, and the direction would then be its brief).

## 12. Pipeline (all tools on this host; heavy jobs pinned to socket 1)

```sh
# 1. samples (once): CC0 libraries at pinned commits -> design/audio/out/samples/raw (gitignored, ~1 GB)
gamedev-python -I design/audio/proto/samples/fetch_samples.py
# 2. packs: full (demos) and ship (what the game downloads)
gamedev-python -I design/audio/proto/samples/prep_samples.py --profile full
gamedev-python -I design/audio/proto/samples/prep_samples.py --profile ship
# 3. rules without audio (milliseconds): valid events, note counts, density
node design/audio/proto/render/dryrun.mjs design/audio/proto/render/configs/era1.json [--dump]
node design/audio/proto/render/session.mjs [seed]          # the conductor over a 12.6 h game
# 4. render in headless Chrome (the real WebAudio); "stems": n adds per-channel loudness
taskset -c 8-15,24-31 node design/audio/proto/render/render.mjs design/audio/proto/render/configs/demos.json
# 5. judge: picture + numbers; spectrum tilt; dissonance (intervals with echo tails modelled; roughness)
gamedev-python -I design/audio/proto/analysis/dissonance.py notes design/audio/out/renders/final-era2.notes.json --echo 2.892,0.36 --from 42 --to 97
gamedev-python -I design/audio/proto/analysis/dissonance.py rough <before.wav> <after.wav> --from 40 --to 100 --png <out.png>
gamedev-python -I design/audio/proto/analysis/dissonance.py ref   # the roughness scale in the organ's timbre
gamedev-python -I design/audio/proto/analysis/analyze.py design/audio/out/renders/final-era1.wav
gamedev-python -I design/audio/proto/analysis/ltas.py design/audio/out/renders/final-era1.wav --win 20
#    balance: per-channel loudness from a "stems" render -> rewrite the piece's TRIMS (repeat 2-3 times)
gamedev-python -I design/audio/proto/analysis/calibrate.py design/audio/out/renders/final-era1.notes.json design/audio/proto/engine/pieces/era1.js --apply
#    the shipping pack against the full pack: same piece from both, fold differences into makeup_db
gamedev-python -I design/audio/proto/analysis/packmatch.py <full>.notes.json <ship>.notes.json design/audio/out/samples/ship/instruments.json
# 6. master: -16 LUFS, <= -1 dBTP, Opus -> design/audio/demos/, WAV -> out/masters/
gamedev-python -I design/audio/proto/analysis/master.py design/audio/out/renders/final-era1.wav paperwork-era1-1945
# 7. SFX: generate, contact sheet, loop seams in Chrome
gamedev-python -I design/audio/proto/sfx/sfx.py && gamedev-python -I design/audio/proto/sfx/sheet.py
node design/audio/proto/render/looptest.mjs
# 8. realtime CPU per piece (live AudioContext; per-thread CPU from /proc)
taskset -c 8-15,24-31 node design/audio/proto/render/bench.mjs design/audio/proto/render/configs/bench.json 30
```

## 13. Judging without ears (what was checked, and how)

- **Harmony and voice leading:**
  - the rendered note log is printed as chord names over time and read as a score;
  - an automated check finds every sustained minor second or ninth below C5 (0 in all three demos and in two 5–6 min game-length pieces);
  - crowding: at most 4 sustained notes at MIDI 45–59, never 4 for more than 1% of the time; no intervals of a third or less below E3.
- **Form and dynamics:** short-term loudness and onset density over time (`analyze.py` pictures, `out/analysis/final-*.png`). LRA: Era I 7.7, Era II 9.7, takeoff 11.4 LU. Each piece has an audible arc (intro, build, climax or plateau, release).
- **Balance:** stem loudness is measured in the page (BS.1770, gated) for every channel. `analysis/calibrate.py` moves each piece's `TRIMS` toward its targets, converging in two or three rounds; every final channel is within 0.6 LU of target. Era I: piano −6.8 LU against the mix, clarinet melody −8.3, violins −13.3, violas −14.2, celli −15.3, bass −17.2, harp −12.3, glockenspiel −19.3, reverb return −11.1.
- **Spectrum:** 1/3-octave long-term spectra against a fitted tilt (`ltas.py`).
  - The close-miked piano's 1.2–4 kHz shelf got a −3 dB dip at 2.8 kHz.
  - Footsteps were rebuilt after a 2–5 kHz share of 70–77%.
  - The build sounds were rebuilt after thump-dominated centroids of 48–86 Hz.
- **Loudness:** ffmpeg ebur128 for the masters; the decoded Opus re-measured.
- **Loops:** seams checked as raw arrays and after Opus decoding and looping in Chrome.
- **Repetition:**
  - The conductor's 12.6 h dry run repeats no piece except the deliberate callback.
  - The Era I loops never realign: periods 19.7, 23.3, 29.9, 34.1 and 41.3 s, pairwise coprime in tenths of a second, so their common period is 1.93 × 10¹¹ s (about 6,100 years).
  - Mutation changes them anyway every few cycles.

## 14. Open questions

1. **Taste is unverified.** No one here can listen. The user should judge the demos.
   - Era II's warmth: a tilt of −8 dB/octave, marimba-dark. If it feels muffled, raise `air()`.
   - The takeoff's just-intonation piano and its accelerando: risky by design.
2. **The audio-thread budget on the user's laptop** is extrapolated from this host (§6.5). `bench.html` must measure it before M1 exits.
3. **Safari.** Ogg/WebM Opus decoding in `decodeAudioData` must be probed; an AAC pack is the fallback (§6.4).
4. **Eras III, IV and IV′ are designed but not implemented.** The corpus era carries about 5½ hours of play and needs the most variety.
5. **The "corpus narrows with σ" idea** (§4, IV′) is optional and must stay inaudible to anyone who does not know it. Decide at M3.
6. **The activity signal** (power over 60 s, log-scaled) needs calibration against real factories at M1.

# Audio sources and licences (the game)

Every file the audio build publishes into `public/audio/` has a record in [`licences.json`](licences.json): its licence and the raw files it derives from, each with its library, the pinned commit and its SHA-256. `scripts/assets/audio/build.py` writes the record with every build, and it is committed, so a change of sources shows in review.

The rule comes from A4 (`design/audio/LICENSES.md`, which also lists the sources evaluated and rejected): nothing with unclear licensing goes in. The game uses a subset of A4's sources, the same pinned commits.

## Sources

### VCSL: Versilian Community Sample Library

- **Licence: CC0 1.0.** `github.com/sgossner/VCSL` at commit `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e`.
- **Music** (A4's shipping profile):
  - the Grand Piano, Steinway B, sustain pedal down, close pair, velocity layers 2 and 3 (Era I and Era II);
  - the Glockenspiel, soft and medium (Era I);
  - the Vibraphone, soft mallets, and the Marimba, soft and medium (Era II).
- **SFX raw material:** the Woodblock, Claves, Brake Drums and Ratchet, the Vibraphone's soft A4 and the Glockenspiel's soft C6. `licences.json` names the files each SFX variant uses.

### VSCO 2 Community Edition

- **Licence: CC0 1.0.** `github.com/sgossner/VSCO-2-CE` at commit `440300901dfe9275fd84e0b7763af1f8443ae62e`.
- **Music** (Era I): the Violin, Viola and Cello Sections (sustain, vibrato), the Solo Contrabass (sustain, no vibrato), the Clarinet (long sustains) and the Harp.
- The Readme asks, without requiring it, that the samples are not sold on their own and that Versilian Studios and Ivy Audio are credited. A game that plays them is not a sale of the samples, and the credits name them (below).

### Our own work

- **The SFX** are synthesised by `scripts/assets/audio/sfx.py` (A4's designs: damped modes, shaped noise, thumps, motor hum), partly from the CC0 percussion above. Variants without a source in `licences.json` are pure synthesis.
- **The recordings** (the charter piece: the menu loop, the first piece of a game, reduced audio's music) are offline renders of the game's own rule sets with the instrument files above (`render.ts`, `master.py`).
- **The runtime's synthesis** (the sine, drawbar organ and Risset bell voices, the FDN reverb, the tape and echo models) is code in `src/audio/`.
- **The probe** (`probe.ogg`, `probe.m4a`) is a synthesised 440 Hz tone.

## Credit line (recommended, not required)

For the credits screen (08-text §4.4):

> Instrument samples: Versilian Community Sample Library and VSCO 2 Community Edition (Versilian Studios, Sam Gossner; Ivy Audio, Simon Dalzell), CC0.

## Pinning and reproducibility

- `samples.lock.json` lists every raw file the build uses, with its size, git blob and SHA-256. A fetch verifies them and fails on a mismatch.
- `gamedev-python -I scripts/assets/audio/build.py` rebuilds everything: the fetch, the packs (A4's ship profile), the SFX and the encodes. Neither the raw files nor `public/audio/` are committed.
- Published file names carry a hash of the master's samples, so an unchanged sound keeps its name and its cache entry.

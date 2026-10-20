# Audio sources and licences

Every sound in `design/audio/` comes from one of the sources below. Anything not listed here is not used. The rule (A4 brief): nothing with unclear licensing goes in.

## Used

### VCSL: Versilian Community Sample Library

- **Licence: CC0 1.0** (public domain dedication). Repository `github.com/sgossner/VCSL`, pinned at commit `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e`. The `LICENSE` file is fetched with the samples into `out/samples/raw/VCSL/`.
- The README says: "you can do whatever you want with these sounds (even make commercial software), no royalties, no credit, no special terms."
- **Used for music:**
  - Grand Piano, Steinway B, sustain pedal down, close pair: velocity layers 2 and 3, C2 to G♯7;
  - Vibraphone, soft mallets;
  - Glockenspiel, soft and medium;
  - Marimba, soft and medium;
  - Wine Glasses, slow;
  - Yamaha TX81Z "FM Piano" (a 1987 FM synthesizer).
- **Used for SFX** (raw material for foley):
  - Woodblock (`wood_click_pp_rr1-3`, `wood_click_mp`);
  - Claves (`Claves1_Hit_v1`, `Claves2_Hit_v1`);
  - Brake Drum (`BrakeDrum1_Hammer_v1`, `BrakeDrum2_Hammer1_v1`);
  - Ratchet (`Ratchet1_Crank_rr1`, `Ratchet1_Slow_rr1`);
  - Vibraphone soft A4 and Glockenspiel soft C6 (the research and alert chimes).
- **Fetched but not yet used:** Hand Chimes, Bowed Vibraphone, Bowed Psaltery, Slapstick, Anvil, Shaker, Cabasa. They are candidates for later eras and SFX.

### VSCO 2 Community Edition (Versilian Studios Chamber Orchestra 2)

- **Licence: CC0 1.0.** Repository `github.com/sgossner/VSCO-2-CE`, pinned at commit `440300901dfe9275fd84e0b7763af1f8443ae62e`. The `LICENSE` and `Readme.txt` files are fetched with the samples.
- The Readme asks (it does not require) two things:
  - that the samples themselves are not sold;
  - credit to "Versilian Studios / Sam Gossner, and/or Ivy Audio / Simon Dalzell where applicable".

  Shipping them inside the game is neither selling the samples nor a licence condition. We credit them anyway (below).
- **Used:**
  - string sections: Violin Section (sustain, vibrato), Viola Section (sustain, vibrato), Cello Section (sustain, vibrato), Solo Contrabass (sustain, no vibrato);
  - Clarinet (long sustains);
  - Harp.
- **Fetched but not yet used:** F Horn (sustains) and Flute (sustains, no vibrato).

### Our own work

- **Synthesis and processing code** in `design/audio/proto/`. The project owns it.
  - This includes the generated impulse responses (`engine/mixer.js`, `makeIR`) and the synthesized voices: sine and drawbar-organ oscillators, Risset's additive bell after his 1969 catalogue, and two-operator FM.
  - It also includes every synthesized SFX layer: damped modes, shaped noise, granular crunch, thumps, motor hum.
- **The demo renders and SFX files** in `demos/` and `out/`. They are derived from the CC0 samples above and our code, so the project owns them outright.

## Credit line (recommended, not required)

For the credits screen, which lists references (08-text §4.4):

> Instrument samples: Versilian Community Sample Library and VSCO 2 Community Edition (Versilian Studios, Sam Gossner; Ivy Audio, Simon Dalzell), CC0.

## Evaluated and not used

| Source | Licence | Why not |
|---|---|---|
| GeneralUser GS 2.0.3 (on this host) | Free for any use, but its author writes that he "cannot be 100% sure where all of the samples originated" | That is unclear provenance, which the brief rules out. A CC0 library replaces it |
| FluidR3_GM (on this host) | MIT | Clean, but its General MIDI instruments are well below VCSL and VSCO quality for exposed piano and strings |
| Salamander Grand Piano V3 | CC-BY 3.0 | Good, but the CC0 Steinway B in VCSL measured cleaner here (tail floor −86 dB, exact tuning) and needs no attribution |
| VCSL Kawai grand, Knight and Yamaha uprights, VSCO 2 Ivy upright | CC0 | Compared on C4/C♯4: the Kawai's soft layer is noisy (tail floor −38 dB below its peak); the uprights decay in about 3.5 s; the Yamaha upright is sampled only on C and G |
| University of Iowa Musical Instrument Samples | "Freely available … without restrictions": a statement, not a licence | Not needed; CC0 alternatives exist |
| Freesound, Sonniss GDC bundles | Per-file CC licences; a custom royalty-free licence | Not needed. Mixed or custom terms would need per-file tracking |

## Pinning and reproducibility

- `proto/samples/fetch_samples.py` downloads exactly the files listed in its `SELECTION`, from the commits above, and verifies each file's size against the pinned tree.
- `proto/samples/prep_samples.py` turns them into the packs the engine loads (`out/samples/prep`, full quality; `out/samples/ship`, the shipping profile).
- None of the raw or prepared samples are committed (`design/audio/out/` is gitignored). They rebuild from these two scripts.

// The audio manifests the asset build writes into public/audio/ (10 §9.4, §15.6; scripts/assets/audio/).
// Every file exists as Ogg Opus (.ogg) and AAC (.m4a); paths here have no extension. Lengths and loop
// points are on the canonical timeline: samples at `rate` (32 kHz) of the decoded signal, counted from its
// first sample after the codec's priming (10 §9.4, "One canonical timeline for loops").

/** 64 samples of the canonical signal from index `at`, as round(x · 32768): finds priming a decoder left in. */
export interface Fingerprint {
  at: number;
  data: number[];
}

export interface AudioFile {
  /** Path under the audio base URL, without the codec's extension (content-hashed). */
  file: string;
  /** Canonical length in samples. */
  len: number;
  channels: 1 | 2;
  fp: Fingerprint;
  /** Download sizes per codec. */
  bytes: { ogg: number; m4a: number };
}

export interface ZoneEntry extends AudioFile {
  /** Measured pitch, fractional MIDI. */
  root: number;
  layer: number;
  /** The source recording (licence record). */
  src: string;
}

export interface PackEntry {
  kind: 'oneshot' | 'sustain';
  layers: number;
  /** The pack's attenuation below full scale, restored by the sampler (A4 §6.4). */
  makeupDb: number;
  zones: ZoneEntry[];
  /** Licence of the source recordings, e.g. "CC0-1.0 (VCSL)". */
  licence: string;
}

export interface RecordingEntry {
  file: string;
  seconds: number;
  /** Integrated loudness of the master (LUFS). */
  lufs: number;
  bytes: { ogg: number; m4a: number };
}

export interface MusicManifest {
  version: 1;
  rate: number;
  packs: Record<string, PackEntry>;
  /** The packs each era's rule set needs. */
  eras: Record<string, string[]>;
  /** Offline renders: the charter piece (the menu loop and every game's first piece), recorded fallbacks. */
  recordings: Record<string, RecordingEntry>;
}

export interface SoundFile extends AudioFile {
  loopStart?: number;
  loopEnd?: number;
}

export interface SoundEntry {
  bus: 'gui' | 'effects' | 'alerts' | 'environment' | 'walking' | 'ambient';
  gainDb: number;
  /** ± fraction of the playback rate per play (A4 §7.3: 3 %, UI 1.5 %). */
  pitchJitter: number;
  /** ± dB per play (1.5). */
  gainJitterDb: number;
  /** At most `count` plays per `windowMs` (10 §9.4); null for none. */
  rate: { count: number; windowMs: number } | null;
  /** The per-sound voice cap (4). */
  voices: number;
  /** Stealing order: lower goes first. */
  priority: number;
  /** World sounds are attenuated by distance and panned; UI sounds are not. */
  positional: boolean;
  loop: boolean;
  files: SoundFile[];
  /** Licence and sources of the files (the per-file licence record). */
  licence: string;
}

/** How an event picks its sound: one name, or by entity size, or by what was mined. */
export type EventRule =
  | string
  /** By the larger side of the footprint: ≤ smallMax tiles small, ≤ mediumMax medium, else large. */
  | { bySize: { small: string; medium: string; large: string }; smallMax: number; mediumMax: number }
  | { byKind: { resource: string; entity: string } };

export interface SoundsManifest {
  version: 1;
  rate: number;
  /** The prototypes the sound ids were built against (10 §15.6); null in a stand-alone audio build. */
  prototypesHash: string | null;
  sounds: Record<string, SoundEntry>;
  /** Event type name (10 §15.6) → rule. */
  events: Record<string, EventRule>;
  /** Entity name → its working sound (the data stage writes it into prototypes.bin for extraction). */
  working: Record<string, string>;
  /** The music feed's tables (10 §15.6): eras by Literature year and their typical consumption. */
  music: {
    eras: { from: number | null; piece: string; name: string; typicalWatts: number; busDb: number }[];
  };
}

// Level and pitch conversions shared by the music, the SFX and the mixer.

export const dbToGain = (db: number): number => 10 ** (db / 20);
export const gainToDb = (g: number): number => 20 * Math.log10(Math.max(g, 1e-12));
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const clamp01 = (x: number): number => clamp(x, 0, 1);

/** Velocity (0..1) to gain: a 28 dB range, so pp sits about 20 dB under ff (A4 `instruments.js`). */
export const velGain = (v: number): number => dbToGain(-28 * (1 - Math.max(0, Math.min(1, v))));

export const midiToHz = (m: number): number => 440 * 2 ** ((m - 69) / 12);
export const hzToMidi = (f: number): number => 69 + 12 * Math.log2(f / 440);

/**
 * A squared-gain volume slider (A4 §8, 10 §9.4): position 0..1 to linear gain. The default music
 * volume, 70 %, is 0.49 (−6.2 dB).
 */
export const sliderGain = (v: number): number => {
  const x = clamp01(v);
  return x * x;
};

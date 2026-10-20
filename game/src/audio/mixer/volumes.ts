// The sound settings (I §4.20, "Sound": Master, music, game effects, GUI, alerts, environment, walking,
// ambient, each with a mute toggle, as Factorio 2.0.36; 07 §20 adds none). The UI's settings window owns
// the controls and their persistence (the run history, 07 §19.2); these are the hooks it calls.
import { sliderGain } from '../core/units.ts';
import type { SfxBus } from '../worklet/protocol.ts';

export const CATEGORIES = [
  'master',
  'music',
  'effects',
  'gui',
  'alerts',
  'environment',
  'walking',
  'ambient',
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Each SFX bus is one category (10 §9.4's buses; I §4.20's names). */
export const BUS_CATEGORY: Readonly<Record<SfxBus, Category>> = {
  gui: 'gui',
  effects: 'effects',
  alerts: 'alerts',
  environment: 'environment',
  walking: 'walking',
  ambient: 'ambient',
};

/** World sounds: muted in map view, faded while a single-player game is paused (10 §9.4). */
export const WORLD_BUSES: readonly SfxBus[] = ['effects', 'environment', 'walking', 'ambient'];

export interface AudioSettings {
  /** Slider positions 0..1 (squared-gain sliders, A4 §8). */
  volume: Record<Category, number>;
  muted: Record<Category, boolean>;
}

/** Defaults: everything at 100 % except music at 70 % (−6 dB, A4 §8: ambient pieces sit under the SFX). */
export function defaultSettings(): AudioSettings {
  const volume = Object.fromEntries(CATEGORIES.map((c) => [c, c === 'music' ? 0.7 : 1])) as Record<
    Category,
    number
  >;
  const muted = Object.fromEntries(CATEGORIES.map((c) => [c, false])) as Record<Category, boolean>;
  return { volume, muted };
}

/** The linear gain of a category's fader. */
export function categoryGain(s: AudioSettings, c: Category): number {
  return s.muted[c] ? 0 : sliderGain(s.volume[c]);
}

/** Accepts a partial or untrusted settings object (from storage), keeping defaults for anything invalid. */
export function sanitizeSettings(x: unknown): AudioSettings {
  const out = defaultSettings();
  if (!x || typeof x !== 'object') return out;
  const o = x as { volume?: Record<string, unknown>; muted?: Record<string, unknown> };
  for (const c of CATEGORIES) {
    const v = o.volume?.[c];
    if (typeof v === 'number' && Number.isFinite(v)) out.volume[c] = Math.min(1, Math.max(0, v));
    const m = o.muted?.[c];
    if (typeof m === 'boolean') out.muted[c] = m;
  }
  return out;
}

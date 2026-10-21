// Client-only settings (10 §7.6: never sent to the sim): the keybindings (bindings.ts's shape), the Interface
// options the UI owns, and the Sound tab's volumes (I §4.20; C9), kept per browser. M1 moves them into the Run
// history store (07 §19.2) with export.
import { SOUND_CATEGORIES, type SoundSettings } from './host.ts';
import { defaultKeybindings, type KeybindingSettings, sanitizeKeybindings } from './input/bindings.ts';

export interface ClientSettings {
  version: 1;
  keybindings: KeybindingSettings;
  interface: {
    /** UI scale in percent, or 0 for automatic (I §4.0). */
    uiScale: number;
  };
  sound: SoundSettings;
}

const KEY = 'paperwork.settings';

/** Every category at 100 %, music at 70 % (A4 §8, 10 §9.4), nothing muted. */
export const defaultSound = (): SoundSettings => ({
  volume: Object.fromEntries(
    SOUND_CATEGORIES.map((c) => [c, c === 'music' ? 0.7 : 1]),
  ) as SoundSettings['volume'],
  muted: Object.fromEntries(SOUND_CATEGORIES.map((c) => [c, false])) as SoundSettings['muted'],
});

/** Stored sound settings, every value checked; anything missing or out of range takes its default. */
export function sanitizeSound(raw: unknown): SoundSettings {
  const out = defaultSound();
  const r = (raw ?? {}) as { volume?: Record<string, unknown>; muted?: Record<string, unknown> };
  for (const c of SOUND_CATEGORIES) {
    const v = Number(r.volume?.[c]);
    if (Number.isFinite(v) && v >= 0 && v <= 1) out.volume[c] = v;
    if (typeof r.muted?.[c] === 'boolean') out.muted[c] = r.muted[c] as boolean;
  }
  return out;
}

export const defaultSettings = (): ClientSettings => ({
  version: 1,
  keybindings: defaultKeybindings(),
  interface: { uiScale: 0 },
  sound: defaultSound(),
});

export function loadSettings(): ClientSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ClientSettings> | null;
    if (raw?.version !== 1) return defaultSettings();
    const scale = Number(raw.interface?.uiScale ?? 0);
    return {
      version: 1,
      keybindings: sanitizeKeybindings(raw.keybindings),
      interface: { uiScale: Number.isFinite(scale) && scale >= 0 && scale <= 300 ? scale : 0 },
      sound: sanitizeSound(raw.sound),
    };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: ClientSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage refused (private mode): the settings last for the session
  }
}

/** Factorio's automatic UI scale by window height (I §4.0): 100% to 1080p, 125% at 1440p, 150% at 4K. */
export function autoScale(height: number): number {
  if (height >= 2000) return 1.5;
  if (height >= 1400) return 1.25;
  return 1;
}

// Client-only settings (10 §7.6: never sent to the sim): the keybindings (bindings.ts's shape) and the Interface
// options the UI owns, kept per browser. M1 moves them into the Run history store (07 §19.2) with export.
import { defaultKeybindings, type KeybindingSettings, sanitizeKeybindings } from './input/bindings.ts';

export interface ClientSettings {
  version: 1;
  keybindings: KeybindingSettings;
  interface: {
    /** UI scale in percent, or 0 for automatic (I §4.0). */
    uiScale: number;
  };
}

const KEY = 'paperwork.settings';

export const defaultSettings = (): ClientSettings => ({
  version: 1,
  keybindings: defaultKeybindings(),
  interface: { uiScale: 0 },
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

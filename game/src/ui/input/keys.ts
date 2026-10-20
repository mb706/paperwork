// Key labels (I §1.2, §1.6): bindings are physical keys (`KeyboardEvent.code`), so AZERTY works; their
// labels come from `navigator.keyboard.getLayoutMap()` where the browser has it (Chromium), else from the
// locale's table keyed by code. Every hotkey hint renders from the live binding table, so a rebind updates them.
import { t } from '../i18n/locale.ts';
import { ALT, type Binding, CTRL, SHIFT } from './controls.ts';

let layout: ReadonlyMap<string, string> | null = null;
let mac = false;

/** Reads the keyboard layout map once (Chromium only; elsewhere the locale's table stands). */
export async function loadKeyboardLayout(): Promise<void> {
  const kb = (navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } })
    .keyboard;
  try {
    if (kb?.getLayoutMap) layout = await kb.getLayoutMap();
  } catch {
    layout = null;
  }
}

/** macOS: Ctrl in a binding is Cmd (I §1.1). */
export function setMac(v: boolean): void {
  mac = v;
}
export const isMac = (): boolean => mac;

/** One input's label: a key, a mouse button or a wheel direction. */
export function inputLabel(code: string): string {
  if (code === 'Ctrl') return t(mac ? 'keys.cmd' : 'keys.ctrl');
  if (code === 'Shift' || code === 'Alt') return t(`keys.${code.toLowerCase()}`);
  if (/^Mouse[0-4]$/.test(code)) return t(`keys.mouse-${code.slice(5)}`);
  if (code === 'WheelUp') return t('keys.wheel-up');
  if (code === 'WheelDown') return t('keys.wheel-down');
  const fromLayout = layout?.get(code);
  if (fromLayout && fromLayout.length === 1 && fromLayout !== ' ') return fromLayout.toUpperCase();
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F[0-9]{1,2}$/.test(code)) return code;
  const k = `keys.${code}`;
  const v = t(k);
  return v === k ? code : v;
}

/** A binding's label as hints show it: "Ctrl + Shift + F4", "Alt + T", "Left mouse button" (I §1.6). */
export function bindingLabel(b: Binding | null): string {
  if (!b) return '';
  const parts: string[] = [];
  if (b.mods & CTRL) parts.push(inputLabel('Ctrl'));
  if (b.mods & SHIFT) parts.push(inputLabel('Shift'));
  if (b.mods & ALT) parts.push(inputLabel('Alt'));
  parts.push(inputLabel(b.code));
  return parts.join(' + ');
}

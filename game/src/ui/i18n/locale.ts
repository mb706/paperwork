// The UI's strings (10 §7.2; 08 §5.1): `locale/en.yaml` for everything the UI itself says, and the data's
// display names (prototypes.json `strings`, keyed by the prototypes' locale keys) for items, recipes and
// entities. Placeholders are Factorio's positional `__1__`, `__2__` …; a missing key renders as the key itself
// (the locale tests keep every key the code and the data name present).
// check-arch-ignore layer-import: the locale file lives in game/locale/ (10 §7.2), bundled as text
import EN_TEXT from '../../../locale/en.yaml?raw';
import { flattenLocale, parseLocaleYaml } from './yaml.ts';

export const EN: ReadonlyMap<string, string> = flattenLocale(parseLocaleYaml(EN_TEXT));

let data: Readonly<Record<string, string>> = {};

/** Installs the data's display names (prototypes.json `strings`) for the current build. */
export function setDataStrings(strings: Readonly<Record<string, string>>): void {
  data = strings;
}

/** A UI string, with `__n__` replaced by the n-th argument. */
export function t(key: string, ...args: (string | number)[]): string {
  const s = EN.get(key);
  if (s === undefined) return key;
  return args.length === 0 ? s : fill(s, args);
}

/** Whether the UI locale has a key. */
export const hasKey = (key: string): boolean => EN.has(key);

export function fill(s: string, args: readonly (string | number)[]): string {
  return s.replace(/__(\d+)__/g, (m, n: string) => {
    const v = args[Number(n) - 1];
    return v === undefined ? m : String(v);
  });
}

/** A display name from the data (`item-name.iron-plate`), falling back to the UI locale, then the key. */
export function dataString(key: string | null | undefined, fallback = ''): string {
  if (!key) return fallback;
  return data[key] ?? EN.get(key) ?? fallback;
}

/**
 * Factorio's smart number formatting for counts (slots, badges): 999, 1.2k, 12k, 120k, 1.2M. Below 10k one
 * decimal is kept unless it is 0.
 */
export function formatCount(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a < 1000) return `${n}`;
  const unit = a < 1e6 ? 'k' : a < 1e9 ? 'M' : 'G';
  const v = a / (unit === 'k' ? 1e3 : unit === 'M' ? 1e6 : 1e9);
  if (v < 10) {
    const r = Math.floor(v * 10) / 10;
    return `${sign}${r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)}${unit}`;
  }
  return `${sign}${Math.floor(v)}${unit}`;
}

/** Durations by 07 §0: `H:MM:SS` from one hour, `M:SS` from one second, `0.99 s` below one second. */
export function formatDuration(seconds: number): string {
  if (seconds < 1) return `${(Math.floor(seconds * 100) / 100).toFixed(2)} s`;
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** A rate per minute as the statistics show it: "5.9k/m" (I §4.12). */
export function formatRate(perMinute: number): string {
  const a = Math.abs(perMinute);
  if (a === 0) return '0';
  if (a < 10) return perMinute.toFixed(1).replace(/\.0$/, '');
  return formatCount(Math.round(perMinute));
}

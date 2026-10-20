// Canonical ordering and serialisation for emitters (D14: identical input gives identical bytes on every
// machine). Strings compare by UTF-16 code units, never by locale (D17); object keys are emitted sorted.

/** Compares strings by UTF-16 code units: the order of JavaScript's `<` and of Array#sort's default. */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Compares tuples element by element (strings by code units, numbers numerically). */
export function compareTuples(a: readonly (string | number)[], b: readonly (string | number)[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] as string | number;
    const y = b[i] as string | number;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1;
    return compareCodeUnits(String(x), String(y));
  }
  return a.length - b.length;
}

/** The keys of a plain object, sorted by code units. */
export function sortedKeys(obj: object): string[] {
  return Object.keys(obj).sort(compareCodeUnits);
}

/** The entries of a plain object, sorted by key. */
export function sortedEntries<T>(obj: Readonly<Record<string, T>>): [string, T][] {
  return sortedKeys(obj).map((k) => [k, obj[k] as T]);
}

/**
 * JSON with object keys sorted by code units at every level, `indent` spaces per level (0 = compact) and
 * a final newline when indented. Numbers use JavaScript's shortest round-trip form; NaN, infinities,
 * functions and symbols are refused rather than silently changed.
 */
export function canonicalJson(value: unknown, indent = 2): string {
  const pad = (level: number): string => (indent > 0 ? `\n${' '.repeat(indent * level)}` : '');
  const sep = indent > 0 ? ': ' : ':';
  const out = (v: unknown, level: number, path: string): string => {
    if (v === null) return 'null';
    switch (typeof v) {
      case 'boolean':
        return v ? 'true' : 'false';
      case 'number':
        if (!Number.isFinite(v)) throw new Error(`canonicalJson: non-finite number at ${path}`);
        return JSON.stringify(v);
      case 'string':
        return JSON.stringify(v);
      case 'object': {
        if (Array.isArray(v)) {
          if (v.length === 0) return '[]';
          const items = v.map((x, i) => pad(level + 1) + out(x, level + 1, `${path}[${i}]`));
          return `[${items.join(',')}${pad(level)}]`;
        }
        const keys = sortedKeys(v as object).filter((k) => (v as Record<string, unknown>)[k] !== undefined);
        if (keys.length === 0) return '{}';
        const items = keys.map(
          (k) =>
            `${pad(level + 1)}${JSON.stringify(k)}${sep}${out((v as Record<string, unknown>)[k], level + 1, `${path}.${k}`)}`,
        );
        return `{${items.join(',')}${pad(level)}}`;
      }
      default:
        throw new Error(`canonicalJson: cannot serialise ${typeof v} at ${path}`);
    }
  };
  const text = out(value, 0, '$');
  return indent > 0 ? `${text}\n` : text;
}

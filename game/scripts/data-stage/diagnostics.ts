// Diagnostics of the data stage. Every message points at the YAML file and the path inside it, with
// the line and column when the path resolves: `design/spec/data/entities.yaml:461:3: entities[12]
// (iron-chest).extra.slots: expected an integer`.

export type Severity = 'error' | 'warning';
export type DataPath = readonly (string | number)[];

export interface Diagnostic {
  severity: Severity;
  /** The file, relative to the repository root (e.g. `design/spec/data/items.yaml`). */
  file?: string;
  /** The path inside the file's YAML value. */
  path?: DataPath;
  line?: number;
  col?: number;
  /** The id of the list item the path enters, for readability. */
  id?: string;
  message: string;
}

/** `kind[3] (iron-chest).extra.slots` from a path whose first element is a top-level key or index. */
export function formatPath(path: DataPath | undefined, id?: string, root?: string): string {
  if (!path || path.length === 0) return root ?? '';
  let s = root ?? '';
  path.forEach((p, i) => {
    if (typeof p === 'number') {
      s += `[${p}]`;
      if (i === 0 && id) s += ` (${id})`;
    } else s += s === '' ? p : `.${p}`;
  });
  return s;
}

export function formatDiagnostic(d: Diagnostic): string {
  const where = d.file ? `${d.file}${d.line !== undefined ? `:${d.line}:${d.col ?? 1}` : ''}: ` : '';
  const root = d.file ? (/([a-z_]+)\.yaml$/.exec(d.file)?.[1] ?? '') : '';
  const p = formatPath(d.path, d.id, d.path && typeof d.path[0] === 'number' ? root : undefined);
  const sev = d.severity === 'warning' ? 'warning: ' : '';
  return `${where}${sev}${p ? `${p}: ` : ''}${d.message}`;
}

export class Diagnostics {
  readonly list: Diagnostic[] = [];

  add(d: Diagnostic): void {
    this.list.push(d);
  }

  error(message: string, at: Omit<Diagnostic, 'severity' | 'message'> = {}): void {
    this.list.push({ ...at, severity: 'error', message });
  }

  warn(message: string, at: Omit<Diagnostic, 'severity' | 'message'> = {}): void {
    this.list.push({ ...at, severity: 'warning', message });
  }

  get errors(): Diagnostic[] {
    return this.list.filter((d) => d.severity === 'error');
  }

  get warnings(): Diagnostic[] {
    return this.list.filter((d) => d.severity === 'warning');
  }

  merge(other: Diagnostics): void {
    this.list.push(...other.list);
  }
}

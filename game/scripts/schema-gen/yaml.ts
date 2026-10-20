// Loading the schema's YAML with source positions (10 §15.1). The schema files are ours, so they are read
// as YAML 1.2 (core schema): in YAML 1.1, keys such as `y`, `n`, `on` and `off` would turn into booleans.
// Duplicate keys are errors. Every problem becomes a SchemaError naming the file, line and path.
import { readFileSync } from 'node:fs';
import { type Document, LineCounter, parseDocument } from 'yaml';

export type Path = readonly (string | number)[];

export class SchemaError extends Error {
  readonly file: string;
  readonly path: Path;
  readonly line: number | null;
  constructor(file: string, path: Path, line: number | null, message: string) {
    const where = `${file}${line !== null ? `:${line}` : ''}`;
    const p =
      path.length > 0 ? `${path.map((x) => (typeof x === 'number' ? `[${x}]` : `.${x}`)).join('')}: ` : '';
    super(`${where}: ${p.replace(/^\./, '')}${message}`);
    this.file = file;
    this.path = path;
    this.line = line;
  }
}

export interface Source {
  /** Path relative to game/, e.g. `schema/types.yaml`. */
  file: string;
  text: string;
  doc: Document;
  lines: LineCounter;
  value: unknown;
}

export function parseSource(file: string, text: string): Source {
  const lines = new LineCounter();
  const doc = parseDocument(text, { version: '1.2', schema: 'core', lineCounter: lines, uniqueKeys: true });
  const first = doc.errors[0];
  if (first) {
    const pos = first.linePos?.[0];
    throw new SchemaError(file, [], pos?.line ?? null, first.message.split('\n')[0] ?? first.message);
  }
  return { file, text, doc, lines, value: doc.toJS({ maxAliasCount: 0 }) };
}

export function loadSource(absPath: string, file: string): Source {
  return parseSource(file, readFileSync(absPath, 'utf8'));
}

interface Ranged {
  range?: [number, number, number] | null;
}

/** The line of the deepest node on `path` that exists. */
export function lineOf(src: Source, path: Path): number | null {
  for (let n = path.length; n >= 0; n--) {
    const node = n === 0 ? src.doc.contents : (src.doc.getIn(path.slice(0, n), true) as Ranged | undefined);
    const r = (node as Ranged | null | undefined)?.range;
    if (r) return src.lines.linePos(r[0]).line;
  }
  return null;
}

export function fail(src: Source, path: Path, message: string): never {
  throw new SchemaError(src.file, path, lineOf(src, path), message);
}

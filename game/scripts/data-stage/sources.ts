// Loading YAML with source positions, so every diagnostic can name a line and column.
//
// The design data is validated by tools/validate_spec.py with PyYAML, which implements YAML 1.1. The
// data stage parses with the `yaml` package's YAML 1.1 schema so that both read the same values (`on`
// and `off` are booleans in 1.1, `1e3` is a string; YAML 1.2 differs). Duplicate keys are an error here.
import { readFileSync } from 'node:fs';
import { type Document, LineCounter, parseDocument } from 'yaml';
import type { DataPath, Diagnostic, Diagnostics } from './diagnostics.ts';

export interface SourceFile {
  /** Path relative to the repository root, for messages. */
  file: string;
  text: string;
  doc: Document;
  lines: LineCounter;
  value: unknown;
}

export function parseYaml(file: string, text: string, diags: Diagnostics): SourceFile | null {
  const lines = new LineCounter();
  const doc = parseDocument(text, {
    version: '1.1',
    schema: 'yaml-1.1',
    lineCounter: lines,
    uniqueKeys: true,
  });
  let ok = true;
  for (const e of doc.errors) {
    const pos = e.linePos?.[0];
    diags.error(e.message.split('\n')[0] ?? e.message, {
      file,
      ...(pos ? { line: pos.line, col: pos.col } : {}),
    });
    ok = false;
  }
  for (const w of doc.warnings) {
    const pos = w.linePos?.[0];
    diags.warn(w.message.split('\n')[0] ?? w.message, {
      file,
      ...(pos ? { line: pos.line, col: pos.col } : {}),
    });
  }
  if (!ok) return null;
  return { file, text, doc, lines, value: doc.toJS({ maxAliasCount: 1000 }) };
}

export function loadYaml(absPath: string, file: string, diags: Diagnostics): SourceFile | null {
  let text: string;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch (e) {
    diags.error(`cannot read: ${(e as Error).message}`, { file });
    return null;
  }
  return parseYaml(file, text, diags);
}

interface Ranged {
  range?: [number, number, number] | null;
}

/** The line and column of the deepest node on `path` that exists (the key's position for a missing key). */
export function locate(src: SourceFile, path: DataPath): { line: number; col: number } | null {
  for (let n = path.length; n >= 0; n--) {
    const node = n === 0 ? src.doc.contents : (src.doc.getIn(path.slice(0, n), true) as Ranged | undefined);
    const r = (node as Ranged | null | undefined)?.range;
    if (r) {
      const p = src.lines.linePos(r[0]);
      return { line: p.line, col: p.col };
    }
  }
  return null;
}

/** A diagnostic located at `path` in `src`, with the id of the list item the path enters. */
export function at(src: SourceFile, path: DataPath): Omit<Diagnostic, 'severity' | 'message'> {
  const pos = locate(src, path);
  const first = path[0];
  let id: string | undefined;
  if (typeof first === 'number' && Array.isArray(src.value)) {
    const item = (src.value as unknown[])[first] as { id?: unknown } | undefined;
    if (item && typeof item.id === 'string') id = item.id;
  }
  return { file: src.file, path, ...(pos ? pos : {}), ...(id ? { id } : {}) };
}

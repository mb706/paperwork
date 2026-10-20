// No I/O in det, worldgen or sim (10 §2.5, D13, D19; C1a-r1 finding 10). clippy.toml bans the resolved
// APIs (std::fs, std::net, std::env, std::process, the standard streams), whatever the import's spelling;
// this scan is the second line: it parses `use` trees (grouped, nested, renamed, glob) and qualified paths
// in the pure crates' sources, with comments and string literals removed first.
import type { Violation } from './common.ts';
import { lineCol } from './common.ts';

const BANNED_MODULES = new Set(['fs', 'net', 'env', 'process']);
const BANNED_STREAMS = new Set(['stdin', 'stdout', 'stderr']);

/** Blanks comments (nested block comments too) and string and char literals, keeping offsets. */
export function stripRust(src: string): string {
  const out = src.split('');
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? src.length : end;
      blank(i, stop);
      i = stop;
    } else if (c === '/' && d === '*') {
      let depth = 1;
      let k = i + 2;
      while (k < src.length && depth > 0) {
        if (src[k] === '/' && src[k + 1] === '*') {
          depth++;
          k += 2;
        } else if (src[k] === '*' && src[k + 1] === '/') {
          depth--;
          k += 2;
        } else k++;
      }
      blank(i, k);
      i = k;
    } else if (
      c === '"' ||
      (c === 'r' && (d === '"' || d === '#') && !/[A-Za-z0-9_]/.test(src[i - 1] ?? ''))
    ) {
      // A string, or a raw string r"…" / r#"…"#.
      let k = i;
      let hashes = 0;
      if (c === 'r') {
        k++;
        while (src[k] === '#') {
          hashes++;
          k++;
        }
      }
      if (src[k] !== '"') {
        i++;
        continue;
      }
      k++;
      const close = `"${'#'.repeat(hashes)}`;
      if (c === 'r') {
        const end = src.indexOf(close, k);
        k = end < 0 ? src.length : end + close.length;
      } else {
        while (k < src.length && src[k] !== '"') k += src[k] === '\\' ? 2 : 1;
        k++;
      }
      blank(i, k);
      i = k;
    } else if (c === "'" && src[i + 2] === "'") {
      blank(i, i + 3);
      i += 3;
    } else if (c === "'" && d === '\\') {
      const end = src.indexOf("'", i + 2);
      const stop = end < 0 ? i + 1 : end + 1;
      blank(i, stop);
      i = stop;
    } else i++;
  }
  return out.join('');
}

interface UsePath {
  segments: string[];
  alias: string | null;
  glob: boolean;
}

/** Expands a `use` tree (`std::{fs, io::{self, stdin as s}, env as e}`) into its paths. */
export function expandUseTree(tree: string): UsePath[] {
  const toks = tree.match(/::|\{|\}|,|\*|[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  let i = 0;
  const parse = (prefix: string[]): UsePath[] => {
    const segs = [...prefix];
    const out: UsePath[] = [];
    for (;;) {
      const t = toks[i];
      if (t === undefined) return out.concat({ segments: segs, alias: null, glob: false });
      if (t === '{') {
        i++;
        while (toks[i] !== '}' && i < toks.length) {
          out.push(...parse(segs));
          if (toks[i] === ',') i++;
        }
        i++;
        return out;
      }
      if (t === '*') {
        i++;
        return out.concat({ segments: segs, alias: null, glob: true });
      }
      if (t === '::') {
        i++;
        continue;
      }
      if (t === ',' || t === '}') return out.concat({ segments: segs, alias: null, glob: false });
      i++;
      if (t === 'as') {
        const alias = toks[i++] ?? '_';
        return out.concat({ segments: segs, alias, glob: false });
      }
      if (t === 'self') continue;
      segs.push(t);
    }
  };
  return parse([]);
}

function bannedPath(p: UsePath): string | null {
  const s =
    p.segments[0] === 'crate' || p.segments[0] === 'self' || p.segments[0] === 'super' ? [] : p.segments;
  if (s[0] !== 'std' && s[0] !== 'core') return null;
  if (s.length === 1 && (p.alias !== null || p.glob))
    return `${p.glob ? 'a glob import of' : 'an alias of'} std hides what it brings in`;
  const m = s[1];
  if (m !== undefined && BANNED_MODULES.has(m)) return `std::${m}`;
  if (m === 'io' && s.length === 2 && p.glob) return 'std::io::* brings in the standard streams';
  const stream = s[2];
  if (m === 'io' && stream !== undefined && BANNED_STREAMS.has(stream)) return `std::io::${stream}`;
  return null;
}

/** Scans one pure-crate source file. Exported for tests. */
export function checkRustSource(file: string, src: string): Violation[] {
  const out: Violation[] = [];
  const code = stripRust(src);
  const add = (offset: number, what: string) => {
    const { line, col } = lineCol(code, offset);
    out.push({
      file,
      line,
      col,
      rule: 'rust-io',
      message: `${what}: no I/O in det, worldgen or sim (10 §2.5); the host does it`,
    });
  };
  for (const m of code.matchAll(/\buse\s+([^;]+);/g)) {
    for (const p of expandUseTree(m[1] as string)) {
      const bad = bannedPath(p);
      if (bad) add(m.index ?? 0, bad);
    }
  }
  for (const m of code.matchAll(/\bextern\s+crate\s+std\s+as\s+\w+/g))
    add(m.index ?? 0, 'an alias of std hides what it brings in');
  for (const m of code.matchAll(/(?<![\w])(?:::)?std\s*::\s*(fs|net|env|process)\b/g))
    add(m.index ?? 0, `std::${m[1]}`);
  for (const m of code.matchAll(/(?<![\w])(?:std\s*::\s*)?io\s*::\s*(stdin|stdout|stderr)\b/g))
    add(m.index ?? 0, `std::io::${m[1]}`);
  // One finding per line and rule is enough.
  const seen = new Set<string>();
  return out.filter((v) => {
    const k = `${v.line}:${v.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

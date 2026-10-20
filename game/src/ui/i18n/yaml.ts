// A strict parser for the subset of YAML the locale files use (10 §7.2: locale/en.yaml): nested maps of
// strings, indented by spaces; plain, single- and double-quoted scalars; comments and blank lines. Anything
// else (lists, anchors, flow collections, block scalars, tabs) is refused with its line number, so a file that
// parses here parses identically with a full YAML parser (the asset build's font coverage check reads it with
// PyYAML). The UI layer may import no YAML package (check-arch), and a whole parser for flat strings would cost
// more bytes than the strings.

export type LocaleTree = { [key: string]: string | LocaleTree };

export class LocaleSyntaxError extends Error {
  readonly line: number;
  constructor(line: number, message: string) {
    super(`line ${line}: ${message}`);
    this.line = line;
  }
}

const KEY = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*:(?:\s+|$)/;

/** A double-quoted scalar's content (JSON-compatible escapes). */
function doubleQuoted(s: string, line: number): { value: string; rest: string } {
  let out = '';
  for (let i = 1; i < s.length; i++) {
    const c = s[i] as string;
    if (c === '"') return { value: out, rest: s.slice(i + 1) };
    if (c !== '\\') {
      out += c;
      continue;
    }
    const e = s[++i];
    if (e === 'n') out += '\n';
    else if (e === 't') out += '\t';
    else if (e === '"' || e === '\\' || e === '/') out += e;
    else if (e === 'u') {
      const hex = s.slice(i + 1, i + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new LocaleSyntaxError(line, 'bad \\u escape');
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += 4;
    } else throw new LocaleSyntaxError(line, `unsupported escape \\${e ?? ''}`);
  }
  throw new LocaleSyntaxError(line, 'unterminated string');
}

function singleQuoted(s: string, line: number): { value: string; rest: string } {
  let out = '';
  for (let i = 1; i < s.length; i++) {
    const c = s[i] as string;
    if (c === "'") {
      if (s[i + 1] === "'") {
        out += "'";
        i++;
        continue;
      }
      return { value: out, rest: s.slice(i + 1) };
    }
    out += c;
  }
  throw new LocaleSyntaxError(line, 'unterminated string');
}

/** A scalar after `key: `, with any trailing comment removed. */
function scalar(raw: string, line: number): string {
  const s = raw.trim();
  if (s.startsWith('"') || s.startsWith("'")) {
    const { value, rest } = s.startsWith('"') ? doubleQuoted(s, line) : singleQuoted(s, line);
    const tail = rest.trim();
    if (tail !== '' && !tail.startsWith('#')) throw new LocaleSyntaxError(line, 'text after a quoted string');
    return value;
  }
  // A plain scalar ends at " #" (a comment). Characters YAML gives meaning to at the start are refused, as are
  // ": " and a trailing ":" inside it (a nested mapping), so plain text never changes meaning under PyYAML.
  const hash = s.search(/\s#/);
  const v = (hash >= 0 ? s.slice(0, hash) : s).trim();
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(v)) throw new LocaleSyntaxError(line, `quote this value: ${v}`);
  if (/:\s|:$/.test(v)) throw new LocaleSyntaxError(line, `quote this value (it holds ": "): ${v}`);
  if (/^(true|false|yes|no|on|off|null|~|[-+]?[0-9][0-9_.:eE+-]*)$/i.test(v))
    throw new LocaleSyntaxError(line, `quote this value (YAML reads it as a non-string): ${v}`);
  return v;
}

export function parseLocaleYaml(text: string): LocaleTree {
  const root: LocaleTree = {};
  const stack: { indent: number; node: LocaleTree }[] = [{ indent: -1, node: root }];
  let expectChildOf: LocaleTree | null = null;
  const lines = text.split('\n');
  for (let n = 0; n < lines.length; n++) {
    const line = n + 1;
    const raw = (lines[n] as string).replace(/\r$/, '');
    if (raw.includes('\t')) throw new LocaleSyntaxError(line, 'tab character');
    const body = raw.trimStart();
    if (body === '' || body.startsWith('#')) continue;
    const indent = raw.length - body.length;
    while (stack.length > 1 && indent <= (stack[stack.length - 1] as { indent: number }).indent) stack.pop();
    const top = stack[stack.length - 1] as { indent: number; node: LocaleTree };
    if (expectChildOf !== null && top.node !== expectChildOf)
      throw new LocaleSyntaxError(line, 'an empty mapping (expected an indented child)');
    expectChildOf = null;
    const m = KEY.exec(body);
    if (!m) throw new LocaleSyntaxError(line, `expected "key: value": ${body}`);
    const key = m[1] as string;
    if (Object.hasOwn(top.node, key)) throw new LocaleSyntaxError(line, `duplicate key ${key}`);
    const rest = body.slice(m[0].length);
    if (rest.trim() === '' || rest.trim().startsWith('#')) {
      const child: LocaleTree = {};
      top.node[key] = child;
      stack.push({ indent, node: child });
      expectChildOf = child;
    } else top.node[key] = scalar(rest, line);
  }
  if (expectChildOf !== null) throw new LocaleSyntaxError(lines.length, 'an empty mapping at the end');
  return root;
}

/** The tree's strings by dotted path: `{a: {b: 'x'}}` → `a.b` = 'x'. */
export function flattenLocale(
  tree: LocaleTree,
  prefix = '',
  out = new Map<string, string>(),
): Map<string, string> {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix === '' ? k : `${prefix}.${k}`;
    if (typeof v === 'string') out.set(key, v);
    else flattenLocale(v, key, out);
  }
  return out;
}

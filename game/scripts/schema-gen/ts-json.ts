// JSON schemas in TypeScript (protos.yaml `json`, sections.yaml `save_header`): the type of each named type
// and of the root, and a validator that refuses anything the schema does not allow: a missing or unknown
// key at any level, a wrong type, a value out of range, a string of the wrong length, an undeclared enum
// value or flag bit, a duplicate in a `unique` array, and an `ascending` array out of order. model.ts
// JsonType gives the syntax.
import type { JsonType } from './model.ts';
import { tsStr } from './ts.ts';

/** The TypeScript type of a JSON type; named types are `${prefix}${name}`. */
export function jsonTs(t: JsonType, prefix: string): string {
  switch (t.k) {
    case 'string':
    case 'hex16':
    case 'hex32':
    case 'color':
    case 'isotime':
      return 'string';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'named':
      return `${prefix}${t.name}`;
    case 'array':
      return `${jsonTs(t.of as JsonType, prefix)}[]`;
    case 'nullable':
      return `${jsonTs(t.of as JsonType, prefix)} | null`;
    case 'map':
      return `Record<string, ${jsonTs(t.of as JsonType, prefix)}>`;
    case 'object':
      return `{ ${(t.fields ?? []).map(([k, v]) => `${k}: ${jsonTs(v, prefix)}`).join('; ')} }`;
  }
}

const PATTERN: Partial<Record<JsonType['k'], [string, string]>> = {
  hex16: ['/^[0-9a-f]{16}$/', '16 lowercase hex digits'],
  hex32: ['/^[0-9a-f]{64}$/', '64 lowercase hex digits'],
  color: ['/^#[0-9a-f]{6}$/', 'a colour #rrggbb'],
  isotime: ['/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?Z$/', 'a UTC time YYYY-MM-DDTHH:MM:SSZ'],
};

/** The names a validator's statements call: its refusal function and its check-function prefix. */
interface Names {
  bad: string;
  check: string;
}

/** Statements that check value `v` at JSON path `path` against `t`, one per line, indented by `ind`. */
function check(t: JsonType, v: string, path: string, n: Names, ind: string, depth: number): string {
  const deeper = `${ind}  `;
  const x = `x${depth}`;
  const i = `i${depth}`;
  const bad = (what: string, p = path) => `${n.bad}(${p}, ${tsStr(what)})`;
  switch (t.k) {
    case 'string': {
      if (t.min === undefined && t.max === undefined)
        return `if (typeof ${v} !== 'string') ${bad('a string')};`;
      const lo = t.min ?? 0;
      const hi = t.max ?? Number.MAX_SAFE_INTEGER;
      return `if (typeof ${v} !== 'string' || !utf8Length(${v}, ${lo}, ${hi})) ${bad(`a string of ${lo} to ${hi} UTF-8 bytes`)};`;
    }
    case 'hex16':
    case 'hex32':
    case 'color':
    case 'isotime': {
      const [re, what] = PATTERN[t.k] as [string, string];
      return `if (typeof ${v} !== 'string' || !${re}.test(${v})) ${bad(what)};`;
    }
    case 'number':
      return `if (typeof ${v} !== 'number' || !Number.isFinite(${v})) ${bad('a number')};`;
    case 'integer': {
      const conds = [`!Number.isSafeInteger(${v})`];
      const what = ['an integer'];
      if (t.min !== undefined) conds.push(`(${v} as number) < ${t.min}`);
      if (t.max !== undefined) conds.push(`(${v} as number) > ${t.max}`);
      if (t.min !== undefined || t.max !== undefined) what.push(`${t.min ?? '−∞'} to ${t.max ?? '∞'}`);
      if (t.oneOf) {
        conds.push(`![${t.oneOf.join(', ')}].includes(${v} as number)`);
        what.push(`one of ${t.oneOf.join(', ')}`);
      }
      if (t.mask !== undefined) {
        conds.push(`(${v} as number) > 0xffffffff || ((${v} as number) & ~${t.mask}) >>> 0 !== 0`);
        what.push(`within the bits ${t.mask}`);
      }
      return `if (${conds.join(' || ')}) ${bad(what.join(', '))};`;
    }
    case 'boolean':
      return `if (typeof ${v} !== 'boolean') ${bad('a boolean')};`;
    case 'named':
      return `${n.check}${t.name}(${v}, ${path});`;
    case 'array': {
      const lines = [`if (!Array.isArray(${v})) ${bad('an array')};`, 'else {'];
      if (t.min !== undefined && t.min === t.max)
        lines.push(`  if (${v}.length !== ${t.min}) ${bad(`exactly ${t.min} items`)};`);
      else {
        if (t.min !== undefined)
          lines.push(`  if (${v}.length < ${t.min}) ${bad(`at least ${t.min} items`)};`);
        if (t.max !== undefined)
          lines.push(`  if (${v}.length > ${t.max}) ${bad(`at most ${t.max} items`)};`);
      }
      lines.push(
        `  (${v} as unknown[]).forEach((${x}, ${i}) => {`,
        `    ${check(t.of as JsonType, x, `\`\${${path}}[\${${i}}]\``, n, `${ind}    `, depth + 1)}`,
        '  });',
      );
      if (t.unique)
        lines.push(`  if (new Set(${v} as unknown[]).size !== ${v}.length) ${bad('without duplicates')};`);
      if (t.ascending)
        lines.push(
          `  if (!jsonAscending(${v} as Record<string, number | string>[], ${tsStr(t.ascending)})) ${bad(`strictly ascending by ${t.ascending}`)};`,
        );
      lines.push('}');
      return lines.join(`\n${ind}`);
    }
    case 'nullable':
      return `if (${v} !== null) {\n${deeper}${check(t.of as JsonType, v, path, n, deeper, depth)}\n${ind}}`;
    case 'map':
      return `if (typeof ${v} !== 'object' || ${v} === null || Array.isArray(${v})) ${bad('a mapping')};\n${ind}else\n${deeper}for (const [k${depth}, ${x}] of Object.entries(${v} as object)) {\n${deeper}  ${check(t.of as JsonType, x, `\`\${${path}}.\${k${depth}}\``, n, `${deeper}  `, depth + 1)}\n${deeper}}`;
    case 'object': {
      const o = `o${depth}`;
      const fields = (t.fields ?? []).map(
        ([k, f]) =>
          `${deeper}${check(f, /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? `${o}.${k}` : `${o}[${tsStr(k)}]`, `\`\${${path}}.${k}\``, n, deeper, depth + 1)}`,
      );
      return `checkJsonObject(${v}, ${path}, [${(t.fields ?? []).map(([k]) => tsStr(k)).join(', ')}], ${n.bad});\n${ind}{\n${deeper}const ${o} = ${v} as Record<string, unknown>;\n${fields.join('\n')}\n${ind}}`;
    }
  }
}

/**
 * The types (`${prefix}${name}`, the root as `rootName`) and the validator `validator(x)`, which throws
 * `Error('${label}: <path> is not <what>')` for anything the schema refuses. `jsonHelpers()` must be in the
 * same module, once.
 */
export function jsonValidator(
  types: readonly [string, JsonType][],
  root: JsonType,
  o: { prefix: string; rootName: string; rootDoc: string; validator: string; label: string },
): string {
  const n: Names = { bad: `${o.validator}Refuse`, check: `${o.validator}Check` };
  return `${types.map(([k, t]) => `export type ${o.prefix}${k} = ${jsonTs(t, o.prefix)};`).join('\n')}

/** ${o.rootDoc} */
export type ${o.rootName} = ${jsonTs(root, o.prefix)};

const ${n.bad} = (path: string, what: string): never => {
  throw new Error(\`${o.label}: \${path} is not \${what}\`);
};
${types
  .map(
    ([k, t]) =>
      `function ${n.check}${k}(v: unknown, path: string): void {\n  ${check(t, 'v', 'path', n, '  ', 0)}\n}`,
  )
  .join('\n')}

/** Checks a parsed ${o.label} against its schema (every key present, no unknown key, every type and limit). */
export function ${o.validator}(x: unknown): ${o.rootName} {
  ${check(root, 'x', "'$'", n, '  ', 0)}
  return x as ${o.rootName};
}
`;
}

/** The helpers that the validator code \`body\` calls (once per module). */
export function jsonHelpers(body: string): string {
  const out: string[] = [];
  if (body.includes('checkJsonObject('))
    out.push(`/** Refuses anything but an object with exactly \`keys\`. */
const checkJsonObject = (v: unknown, path: string, keys: readonly string[], refuse: (p: string, what: string) => never): void => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) refuse(path, 'an object');
  const have = Object.keys(v as object);
  for (const k of have) if (!keys.includes(k)) refuse(\`\${path}.\${k}\`, 'a known key');
  for (const k of keys) if (!have.includes(k)) refuse(\`\${path}.\${k}\`, 'present');
};`);
  if (body.includes('utf8Length('))
    out.push(`const utf8Length = (s: string, lo: number, hi: number): boolean => {
  const n = new TextEncoder().encode(s).length;
  return n >= lo && n <= hi;
};`);
  if (body.includes('jsonAscending('))
    out.push(`const jsonAscending = (xs: readonly Record<string, number | string>[], k: string): boolean =>
  xs.every((x, i) => i === 0 || ((xs[i - 1] as Record<string, number | string>)[k] as number | string) < (x[k] as number | string));`);
  return out.join('\n');
}

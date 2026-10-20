// The TypeScript side of the codec fixtures (src/shared/gen/samples.ts, tests only): every sample value as
// a literal, and encode, decode and dump by type name, for the round-trip fixtures and the limit probes.
import { type Decl, isFloat, isWide, type Schema, scalarOf, type Ty, valueFields } from './model.ts';
import { samples, type Value } from './samples.ts';
import { type TsOut, tsKey, tsStr } from './ts.ts';

function isU8(t: Ty): boolean {
  return t.k === 'scalar' && t.s === 'u8';
}

function bytesLit(b: Uint8Array): string {
  if (b.length > 1 && b.every((x) => x === b[0])) return `new Uint8Array(${b.length}).fill(${b[0]})`;
  return `new Uint8Array([${[...b].join(', ')}])`;
}

function numLit(v: number): string {
  if (Object.is(v, -0)) return '-0';
  return String(v);
}

function lit(t: Ty, v: Value): string {
  switch (t.k) {
    case 'scalar':
      if (t.s === 'bool') return String(v);
      if (isFloat(t.s)) return numLit(v as number);
      return isWide(t.s) ? `${v}n` : numLit(v as number);
    case 'id':
    case 'enum':
    case 'flags':
      return isWide(t.d.base) ? `${v}n` : String(v);
    case 'struct':
    case 'message':
    case 'record': {
      const o = v as { [k: string]: Value };
      const fields = t.d.kind === 'record' ? t.d.fields : valueFields(t.d.fields);
      return `{ ${fields
        .filter((f) => o[f.name] !== undefined)
        .map((f) => `${tsKey(f.name)}: ${lit(f.ty, o[f.name])}`)
        .join(', ')} }`;
    }
    case 'array':
      if (isU8(t.of)) return bytesLit(v as Uint8Array);
      return `[${(v as Value[]).map((x) => lit(t.of, x)).join(', ')}]`;
    case 'str':
      return tsStr(v as string);
    case 'bytes':
      return bytesLit(v as Uint8Array);
    case 'list': {
      const xs = v as Value[];
      if (xs.length > 8 && xs.every((x) => x === xs[0]) && typeof xs[0] !== 'object')
        return `Array.from({ length: ${xs.length} }, () => ${lit(t.of, xs[0])})`;
      if (xs.length > 8 && t.of.k === 'struct')
        return `Array.from({ length: ${xs.length} }, () => (${lit(t.of, xs[0])}))`;
      return `[${xs.map((x) => lit(t.of, x)).join(', ')}]`;
    }
    case 'blob_or_bytes': {
      const x = v as { bytes?: Uint8Array; blob?: Uint8Array };
      return x.blob ? `{ blob: ${bytesLit(x.blob)} }` : `{ bytes: ${bytesLit(x.bytes as Uint8Array)} }`;
    }
    case 'counted':
    case 'rest':
      if (isU8(t.of)) return bytesLit(v as Uint8Array);
      return `[${(v as Value[]).map((x) => lit(t.of, x)).join(', ')}]`;
  }
}

export function tsSamples(s: Schema, o: TsOut): void {
  o.rt('Reader', 'Writer', 'Dump');
  const all = samples(s);
  const cases = all.map((smp) => {
    const d = smp.decl;
    const action = s.actions.find((a) => a.msg === d);
    const kind = action ? 'action' : d.kind;
    const value = lit({ k: d.kind, d } as Ty, smp.value);
    return `  { name: ${tsStr(d.name)}, variant: ${tsStr(smp.variant)}, kind: ${tsStr(kind)}, value: ${action ? `{ type: ${tsStr(action.name)}, ...${value} }` : value} },`;
  });
  const codecs: string[] = [];
  for (const name of s.names) {
    const d = s.decls.get(name) as Decl;
    const n = tsStr(d.name);
    if (d.kind === 'struct')
      codecs.push(
        `  ${tsKey(d.name)}: { encode: (v) => { const w = new Writer(); ${o.c(d)}.write(w, v as never); return w.finish(); }, decode: (b) => { const r = new Reader(b); const v = ${o.c(d)}.read(r); r.finish(${n}); return v; }, dump: (d, v) => ${o.c(d)}.dump(d, v as never, '') },`,
      );
    else if (d.kind === 'message')
      codecs.push(
        `  ${tsKey(d.name)}: { encode: (v) => ${o.c(d)}.encode(v as never), decode: (b) => ${o.c(d)}.decode(b), dump: (d, v) => ${o.c(d)}.dump(d, v as never, '') },`,
      );
    else if (d.kind === 'record')
      codecs.push(
        `  ${tsKey(d.name)}: { encode: (v) => ${o.c(d)}.encode(v as never), decode: (b) => ${o.c(d)}.decode(b, true), dump: (d, v) => ${o.c(d)}.dump(d, v as never, '') },`,
      );
  }
  void scalarOf;
  o.push(`/** One sample: its type, its variant, whether it is an action payload, and its value. */
export interface SampleCase {
  name: string;
  variant: string;
  kind: 'struct' | 'message' | 'record' | 'action';
  value: unknown;
}

/** Every sample, in the order of the fixture files (by type name, then variant). */
export const SAMPLES: readonly SampleCase[] = [
${cases.join('\n')}
];

/** Encode, decode (whole values; records strictly) and dump by type name. */
export const CODECS: Readonly<Record<string, { encode(v: unknown): Uint8Array; decode(b: Uint8Array): unknown; dump(d: Dump, v: unknown): void }>> = {
${codecs.join('\n')}
};
`);
}

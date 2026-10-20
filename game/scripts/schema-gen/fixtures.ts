// The generated codec fixtures (10 §15.1, D18 g), written by `npm run gen` and checked by `--check`:
//   test/fixtures/codec/actions.bin   every action sample (zero, mixed and at its field limits), framed
//   test/fixtures/codec/records.bin   every other struct, message and record sample
//   test/fixtures/codec/probes.txt    limit probes: valid values at every maximum, and an overflow, a bad
//                                     enum, flag, bool, reference, UTF-8 or NaN, a truncation and a
//                                     trailing byte just past each, with the verdict every decoder must give
// The bytes and the dumps come from the reference codec (refcodec.ts). Vitest checks that the generated
// TypeScript encodes each sample's literal to the same bytes, decodes them back to it, and dumps it to the
// reference dump; `cargo test` (crates/sim/tests/codec_fixtures/main.rs) that the generated Rust decodes the bytes,
// re-encodes them unchanged and dumps the same text. The dumps are compared by hash.
//
// actions.bin and records.bin hold entries: u16 name length, the type's name, u8 variant (0 zero, 1 mixed,
// 2 max), u32 FNV-1a hash of the reference dump (refDump; an action's starts with its `type=` line),
// u32 length, the bytes. All integers little-endian.
import {
  type Field,
  fixedSize,
  intRange,
  isFloat,
  isWide,
  type MessageDecl,
  pow2,
  type RecordDecl,
  type Scalar,
  type Schema,
  type StructDecl,
  scalarOf,
  type Ty,
  valueFields,
} from './model.ts';
import {
  actionVerdict,
  encodeDecl,
  encodeRecord,
  fnv1a32,
  frameAction,
  RefWriter,
  refDump,
  refDumpAction,
  verdict,
} from './refcodec.ts';
import { maxString, type Sample, samples, type Value } from './samples.ts';

const VARIANT = { zero: 0, mixed: 1, max: 2 } as const;
const PROBE_MAX_BYTES = 8192;

function entry(w: RefWriter, name: string, variant: number, dump: string, bytes: Uint8Array): void {
  const n = new TextEncoder().encode(name);
  w.int('u16', n.length);
  w.bytes(n);
  w.int('u8', variant);
  w.int('u32', fnv1a32(dump));
  w.int('u32', bytes.length);
  w.bytes(bytes);
}

export interface CodecFixtures {
  actions: Uint8Array;
  records: Uint8Array;
  probes: string;
}

function sampleBytes(s: Schema, smp: Sample): Uint8Array {
  const action = s.actions.find((a) => a.msg === smp.decl);
  const payload = encodeDecl(smp.decl, smp.value);
  return action ? frameAction(action.id, payload) : payload;
}

export function codecFixtures(s: Schema): CodecFixtures {
  const all = samples(s);
  const aw = new RefWriter();
  const rw = new RefWriter();
  for (const smp of all) {
    const bytes = sampleBytes(s, smp);
    const action = s.actions.find((a) => a.msg === smp.decl);
    const v = action ? actionVerdict(s, bytes) : verdict(smp.decl, bytes);
    if (v !== 'ok') throw new Error(`sample ${smp.decl.name} (${smp.variant}) does not decode: ${v}`);
    const dump = action
      ? refDumpAction(action.name, smp.decl as MessageDecl, smp.value)
      : refDump(smp.decl, smp.value);
    entry(action ? aw : rw, smp.decl.name, VARIANT[smp.variant], dump, bytes);
  }
  return { actions: aw.finish(), records: rw.finish(), probes: probesText(s, all) };
}

// ------------------------------------------------------------------------------------------- probes

interface Probe {
  target: string;
  name: string;
  bytes: Uint8Array;
}

function hex(b: Uint8Array): string {
  let x = '';
  for (const v of b) x += v.toString(16).padStart(2, '0');
  return x;
}

/** An integer of scalar `s` that `values` does not hold, or null. */
function outside(s: Scalar, values: readonly number[]): number | null {
  const [, hi] = intRange(s as never);
  const max = Math.max(...values);
  if (BigInt(max) < hi) return max + 1;
  for (let v = 0; v < 256; v++) if (!values.includes(v)) return v;
  return null;
}

/** Mutations of one field's value that a decoder must refuse (or accept, at a limit). */
function fieldMutations(f: Field, v: Value): { name: string; value?: Value; reserved?: number }[] {
  const out: { name: string; value?: Value; reserved?: number }[] = [];
  const t = f.ty;
  if (f.reserved) {
    out.push({ name: `${f.name}=1`, reserved: 1 });
    return out;
  }
  const s = scalarOf(t);
  if (t.k === 'enum') {
    const x = outside(
      t.d.base,
      t.d.values.map((e) => e.value),
    );
    if (x !== null) out.push({ name: `${f.name}=${x}`, value: isWide(t.d.base) ? BigInt(x) : x });
    const maxV = Math.max(...t.d.values.map((e) => e.value));
    out.push({ name: `${f.name}=max`, value: maxV });
  } else if (t.k === 'flags') {
    const used = t.d.bits.map((b) => b.bit);
    const free = Array.from({ length: s ? 8 * (fixedSize(t) ?? 1) : 8 }, (_, i) => i).find(
      (i) => !used.includes(i),
    );
    if (free !== undefined) out.push({ name: `${f.name}=bit${free}`, value: pow2(free) });
    out.push({ name: `${f.name}=all`, value: t.d.bits.reduce((a, b) => a + pow2(b.bit), 0) });
  } else if (t.k === 'scalar' && t.s === 'bool') out.push({ name: `${f.name}=2`, value: 2 });
  else if (s && isFloat(s)) out.push({ name: `${f.name}=NaN`, value: Number.NaN });
  if (f.range && s) {
    const [lo, hi] = intRange(s as never);
    out.push({ name: `${f.name}=${f.range[1]}`, value: f.range[1] });
    out.push({ name: `${f.name}=${f.range[0]}`, value: f.range[0] });
    if (BigInt(f.range[1]) < hi) out.push({ name: `${f.name}=${f.range[1] + 1}`, value: f.range[1] + 1 });
    if (BigInt(f.range[0]) > lo) out.push({ name: `${f.name}=${f.range[0] - 1}`, value: f.range[0] - 1 });
  }
  if (f.allowed && s) {
    const x = outside(s, f.allowed);
    if (x !== null) out.push({ name: `${f.name}=${x}`, value: x });
  }
  if (t.k === 'str') {
    out.push({ name: `${f.name}=max`, value: maxString(t.max) });
    if (t.max < 0xffff)
      out.push({ name: `${f.name}=max+1`, value: { __count: t.max + 1 } as unknown as Value });
    out.push({ name: `${f.name}=bad-utf8`, value: Uint8Array.of(0xff) });
  }
  if (t.k === 'bytes') {
    out.push({ name: `${f.name}=max`, value: new Uint8Array(t.max) });
    if (t.max < (t.lenWidth === 2 ? 0xffff : 0xffffffff))
      out.push({ name: `${f.name}=max+1`, value: { __count: t.max + 1 } as unknown as Value });
  }
  if (t.k === 'list') {
    const item = (v as Value[])[0];
    if (item !== undefined && t.of.k !== 'str') {
      const sorted = f.order === 'key';
      if (!sorted) {
        if (t.max <= 4096)
          out.push({ name: `${f.name}=max`, value: Array.from({ length: t.max }, () => item) });
        out.push({ name: `${f.name}=max+1`, value: { __count: t.max + 1 } as unknown as Value });
      } else out.push({ name: `${f.name}=unsorted`, value: [item, item] });
    }
  }
  if (t.k === 'blob_or_bytes') {
    out.push({ name: `${f.name}=tag2`, value: { tag: 2 } as unknown as Value });
    out.push({ name: `${f.name}=max`, value: { bytes: new Uint8Array(t.max) } as unknown as Value });
    out.push({ name: `${f.name}=max+1`, value: { bytes: { __count: t.max + 1 } } as unknown as Value });
  }
  if (t.k === 'struct' && t.d.check === 'entity_ref') {
    out.push({ name: `${f.name}=serial-0`, value: { a: 0, b: 0, tag: 1 } });
    out.push({ name: `${f.name}=none-a`, value: { a: 5, b: 0, tag: 0 } });
    out.push({ name: `${f.name}=tag3`, value: { a: 1, b: 0, tag: 3 } });
  }
  return out;
}

function probesFor(s: Schema, smp: Sample): Probe[] {
  const d = smp.decl;
  const action = s.actions.find((a) => a.msg === d);
  const target = action ? `action:${action.name}` : `${d.kind}:${d.name}`;
  const enc = (v: { [k: string]: Value }): Uint8Array => {
    const p = encodeDecl(d, v);
    return action ? frameAction(action.id, p) : p;
  };
  const out: Probe[] = [];
  const base = enc(smp.value);
  out.push({ target, name: `${smp.variant}`, bytes: base });
  if (smp.variant === 'zero') return out;
  if (base.length > (action ? 4 : 0))
    out.push({ target, name: `${smp.variant}/truncated`, bytes: base.subarray(0, base.length - 1) });
  const trailing = new Uint8Array(base.length + 1);
  trailing.set(base);
  out.push({ target, name: `${smp.variant}/trailing`, bytes: trailing });
  const fields = d.kind === 'record' ? d.fields : d.fields.filter((f) => !f.hidden);
  for (const f of fields) {
    for (const m of fieldMutations(f, smp.value[f.name])) {
      const v: { [k: string]: Value } & { __reserved?: Record<string, number> } = { ...smp.value };
      if (m.reserved !== undefined) v.__reserved = { [f.name]: m.reserved };
      else v[f.name] = m.value;
      if (f.when && m.value !== undefined) {
        // keep the presence flag set
      }
      let bytes: Uint8Array;
      try {
        bytes = enc(v);
      } catch {
        continue;
      }
      if (bytes.length > PROBE_MAX_BYTES) continue;
      out.push({ target, name: `${smp.variant}/${m.name}`, bytes });
    }
  }
  for (const f of d.fields.filter((x) => x.hidden)) {
    const v: { [k: string]: Value } = { ...smp.value, [f.name]: 0xffff };
    out.push({ target, name: `${smp.variant}/${f.name}=big`, bytes: enc(v) });
  }
  if (d.kind === 'record' && d.fields.length >= 2) {
    const rec = d as RecordDecl;
    const mut = (name: string, edit: (t: [number, Uint8Array][]) => [number, Uint8Array][]) => {
      const w = new RefWriter();
      encodeRecord(w, rec, smp.value, { edit });
      out.push({ target, name: `${smp.variant}/${name}`, bytes: w.finish() });
    };
    mut('swapped', (t) => [t[1] as [number, Uint8Array], t[0] as [number, Uint8Array], ...t.slice(2)]);
    mut('duplicate', (t) => [t[0] as [number, Uint8Array], ...t]);
    mut('unknown', (t) => [...t, [65000, Uint8Array.of(1)]]);
    mut('missing', (t) => t.slice(0, -1));
    mut('long-value', (t) => {
      const [id, b] = t[0] as [number, Uint8Array];
      const longer = new Uint8Array(b.length + 1);
      longer.set(b);
      return [[id, longer], ...t.slice(1)];
    });
  }
  if (d.kind === 'message' && d.padTo) {
    const w = new RefWriter();
    // The fields without their padding, then nonzero padding where the record has some.
    const unpadded = encodeDecl({ ...d, padTo: undefined } as unknown as MessageDecl, smp.value);
    const k = (d.padTo - (unpadded.length % d.padTo)) % d.padTo;
    if (k > 0) {
      w.bytes(unpadded);
      w.int('u8', 1);
      for (let i = 1; i < k; i++) w.int('u8', 0);
      out.push({ target, name: `${smp.variant}/padding=1`, bytes: w.finish() });
    }
  }
  return out;
}

function probesText(s: Schema, all: Sample[]): string {
  const lines: string[] = [
    '# Limit probes (10 §15.1, D18 g): <target> <name> <verdict> <hex>. Generated by scripts/schema-gen.ts from',
    '# schema/ with the reference codec; every decoder (Rust and TypeScript) must give each verdict exactly:',
    '# "ok", or "<error kind> <field> @<byte offset>". Targets: struct:X, message:X, record:x (strict),',
    '# action:x (a framed action decoded with Action::decode).',
  ];
  for (const smp of all) {
    if (smp.variant === 'max' && !s.actions.some((a) => a.msg === smp.decl)) continue;
    for (const p of probesFor(s, smp)) {
      if (p.bytes.length > PROBE_MAX_BYTES) continue;
      const action = p.target.startsWith('action:');
      const v = action
        ? actionVerdict(s, p.bytes)
        : verdict(smp.decl as StructDecl | MessageDecl | RecordDecl, p.bytes);
      lines.push(`${p.target} ${p.name} ${v} ${hex(p.bytes)}`);
    }
  }
  void valueFields;
  void (null as unknown as Ty);
  return `${lines.join('\n')}\n`;
}

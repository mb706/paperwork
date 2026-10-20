// The resolved-layout listing and SCHEMA_HASH (10 §15.1 "Drift is caught four ways", 3; B1-r1 3).
//
// The listing names every declaration, action, event, packet section, projection, query, save section,
// export, prototype table, registry and version, with its fields in order, their offsets, widths, field
// ids, enum values, limits and padding. Documentation is left out, so editing a comment never changes the
// hash; everything that changes bytes does. SCHEMA_HASH is the SHA-256 of the listing's UTF-8 bytes. The
// listing is also written as src/shared/gen/layout.txt, for review.
import { canonicalJson, sortedEntries } from '../lib/canonical.ts';
import { sha256Hex } from '../lib/hash.ts';
import {
  type Decl,
  type Field,
  fixedSize,
  type JsonType,
  type MessageDecl,
  maxSize,
  type Schema,
  scalarOf,
  type Ty,
} from './model.ts';

export function tyText(t: Ty): string {
  switch (t.k) {
    case 'scalar':
      return t.s;
    case 'id':
      return `${t.d.name}(${t.d.base})`;
    case 'enum':
      return `${t.d.name}(${t.d.base} enum)`;
    case 'flags':
      return `${t.d.name}(${t.d.base} flags)`;
    case 'struct':
      return `${t.d.name}(struct ${t.d.size})`;
    case 'array':
      return `[${tyText(t.of)}; ${t.n}]`;
    case 'message':
      return `${t.d.name}(message)`;
    case 'record':
      return `${t.d.name}(record)`;
    case 'str':
      return `str(u16 len, max ${t.max})`;
    case 'bytes':
      return `bytes(u${t.lenWidth * 8} len, max ${t.max})`;
    case 'list':
      return `list<${tyText(t.of)}>(u${t.countWidth * 8} count, max ${t.max})`;
    case 'blob_or_bytes':
      return `blob_or_bytes(u8 tag, max ${t.max})`;
    case 'counted':
      return `${tyText(t.of)}[${t.count}${t.minus ? `-${t.minus}` : ''}]`;
    case 'rest':
      return `${tyText(t.of)}[..]`;
  }
}

function fieldLine(f: Field): string {
  const parts = [`  ${f.name}`];
  if (f.id !== undefined) parts.push(`#${f.id}`);
  if (f.offset !== undefined) parts.push(`@${f.offset}`);
  const n = fixedSize(f.ty);
  parts.push(tyText(f.ty));
  if (n !== null) parts.push(`w${n}`);
  if (f.reserved) parts.push('reserved');
  if (f.hidden) parts.push('count');
  if (f.range) parts.push(`range=${f.range[0]}..${f.range[1]}`);
  if (f.allowed) parts.push(`allowed=${f.allowed.join(',')}`);
  if (f.when) parts.push(`when=${f.when.field}.${f.when.bit}`);
  if (f.saved !== undefined) parts.push(f.saved ? 'saved' : 'unsaved');
  if (f.derived) parts.push(`derived=${f.derived}`);
  if (f.presentation) parts.push('presentation');
  if (f.order) parts.push(`order=${f.order}`);
  if (f.default !== undefined) parts.push(`default=${f.default}`);
  if (f.wraps) parts.push('wraps');
  if (f.since !== undefined) parts.push(`since=${f.since}`);
  if (f.view) parts.push('view');
  if (f.digest) parts.push(`digest=${f.digest}`);
  if (f.keep) parts.push('keep');
  if (f.refKind) parts.push(`ref_kind=${f.refKind}`);
  if (f.formula) parts.push(`formula=${f.formula}`);
  return parts.join(' ');
}

function messageLine(d: MessageDecl): string {
  return `fixed=${d.fixed ?? '-'} prefix=${d.prefix} min=${d.minSize} max=${d.maxSize ?? '-'}${d.padTo ? ` pad_to=${d.padTo}` : ''}`;
}

function declLines(d: Decl): string[] {
  switch (d.kind) {
    case 'id':
      return [`id ${d.name} ${d.base}${d.none !== undefined ? ` none=${d.none}` : ''}`];
    case 'enum':
      return [
        `enum ${d.name} ${d.base}${d.synthetic ? ' synthetic' : ''}`,
        ...d.values.map((v) => `  ${v.name}=${v.value}`),
      ];
    case 'flags':
      return [`flags ${d.name} ${d.base}`, ...d.bits.map((b) => `  ${b.name}=bit${b.bit}`)];
    case 'struct':
      return [
        `struct ${d.name} size=${d.size}${d.check ? ` check=${d.check}` : ''}`,
        ...d.fields.map(fieldLine),
      ];
    case 'message':
      return [`message ${d.name} ${messageLine(d)}`, ...d.fields.map(fieldLine)];
    case 'record':
      return [`record ${d.name}`, ...d.fields.map(fieldLine)];
    case 'table':
      return [`table ${d.name} section=${d.section} live=${d.live}`, ...d.fields.map(fieldLine)];
  }
}

function jsonText(t: JsonType): string {
  switch (t.k) {
    case 'named':
      return t.name as string;
    case 'array':
      return `${jsonText(t.of as JsonType)}[]`;
    case 'nullable':
      return `${jsonText(t.of as JsonType)}?`;
    case 'map':
      return `{${jsonText(t.of as JsonType)}}`;
    case 'object':
      return `{${(t.fields ?? []).map(([k, v]) => `${k}:${jsonText(v)}`).join(',')}}`;
    default:
      return t.k;
  }
}

/** The canonical listing of the resolved layouts. */
export function listing(s: Schema): string {
  const out: string[] = [];
  const v = s.versions;
  out.push('# Paperwork schema: resolved layouts (10 §15.1). SCHEMA_HASH = SHA-256 of this text.');
  out.push(
    `versions schema=${v.schema} action=${v.action} packet=${v.packet} abi=${v.abi} gen_abi=${v.genAbi} protocol=${v.protocol}`,
  );
  out.push('');
  for (const name of s.names) out.push(...declLines(s.decls.get(name) as Decl));
  out.push('');
  out.push(
    `action_limits ${sortedEntries(s.actionLimits)
      .map(([k, x]) => `${k}=${x}`)
      .join(' ')}`,
  );
  for (const a of s.actions)
    out.push(
      `action ${a.name} id=${a.id}${a.held ? ' held' : ''}${a.system ? ' system' : ''} payload=${a.msg.name} ${messageLine(a.msg)}`,
    );
  out.push(
    `event_limits ${sortedEntries(s.eventLimits)
      .map(([k, x]) => `${k}=${x}`)
      .join(' ')}`,
  );
  for (const e of s.events) out.push(`event ${e.name} id=${e.id} payload=${e.msg.name} size=${e.msg.fixed}`);
  out.push(
    `packet magic=${s.packet.magic} ${sortedEntries(s.packet.limits)
      .map(([k, x]) => `${k}=${x}`)
      .join(' ')}`,
  );
  for (const p of s.packet.sections)
    out.push(
      `packet_section ${p.name} id=${p.id} ${p.kind} record=${p.record} record_version=${p.recordVersion}`,
    );
  out.push(
    `projection_limits ${sortedEntries(s.projections.limits)
      .map(([k, x]) => `${k}=${x}`)
      .join(' ')}`,
  );
  for (const k of s.projections.kinds)
    out.push(
      `projection ${k.name} id=${k.id} ${k.cadence} target=${k.target} record=${k.record?.name ?? '-'}${
        k.params
          ? ` params=${sortedEntries(k.params)
              .map(([a, b]) => `${a}:${b}`)
              .join(',')}`
          : ''
      }`,
    );
  for (const q of s.projections.queries)
    out.push(
      `query ${q.name} id=${q.id}${q.dev ? ' dev' : ''} params=${q.params?.name ?? '-'} result=${q.result?.name ?? '-'}`,
    );
  const sv = s.save;
  out.push(
    `save magic=${canonicalJson(sv.magic, 0)} format=${sv.formatVersion} header_align=${sv.headerAlign} shards=${sv.shards}`,
  );
  for (const x of sv.sections) {
    const shard = x.shard
      ? x.shard.k === 'pieces'
        ? `pieces(${x.shard.base},${x.shard.step})`
        : x.shard.k
      : '-';
    out.push(
      `save_section ${x.name} id=${x.id} version=${x.version} ${x.encoding} ${x.table?.name ?? x.record?.name ?? x.format ?? '-'}${x.key ? ` key=${x.key.join(',')}` : ''}${x.hashed ? ' hashed' : ''} shard=${shard}${x.headerShard !== undefined ? ` header_shard=${x.headerShard}` : ''}`,
    );
  }
  for (const r of sv.reserved) out.push(`save_section_reserved ${r.name} id=${r.id}`);
  out.push(`closure_log magic=${sv.closureLog.magic} format=${sv.closureLog.formatVersion}`);
  out.push(`save_header ${sv.header.map(([k, x]) => `${k}:${x.json}`).join(' ')}`);
  for (const e of s.abi.exports)
    out.push(
      `export ${e.module} ${e.name} ${e.kind}(${e.params.map((p) => `${p.name}:${tyText(p.ty)}`).join(',')})${e.returns ? `->${e.returns}` : ''} in=${e.input ?? '-'} out=${e.output ?? '-'}`,
    );
  for (const i of s.abi.imports)
    out.push(
      `import ${i.name}(${i.params.map((p) => `${p.name}:${tyText(p.ty)}`).join(',')})${i.returns ? `->${i.returns}` : ''}`,
    );
  const p = s.protos;
  out.push(
    `protos magic=${canonicalJson(p.magic, 0)} format=${p.formatVersion} data=${p.dataVersion} section_version=${p.sectionVersion}`,
  );
  for (const x of p.sections)
    out.push(`protos_section ${x.name} id=${x.id}${x.kind ? ` kind=${x.kind}` : ''}`);
  for (const t of p.tables) {
    out.push(`protos_table ${t.name} section=${t.section}`);
    for (const c of t.columns) {
      const sc = scalarOf(c.ty);
      out.push(
        `  ${c.name} ${tyText(c.ty)}${sc ? ` w${fixedSize(c.ty)}` : ` entry=${maxSize(c.ty.k === 'list' ? c.ty.of : c.ty)}`}${c.optional ? ' optional' : ''}${c.refKind ? ` ref_kind=${c.refKind}` : ''}${c.formula ? ` formula=${c.formula}` : ''}`,
      );
    }
  }
  for (const m of p.meta) out.push(`protos_meta ${m.name} type=${m.type} record=${m.record.name}`);
  out.push(
    `protos_expr max_stack=${p.expr.maxStack} powi_limit=${p.expr.powiLimit} ${p.expr.ops.map((o) => `${o.name}=${o.code}${o.operand ? `:${o.operand}` : ''}`).join(' ')}`,
  );
  for (const f of p.formulas)
    out.push(`formula ${f.name} vars=${f.vars.join(',')} range=${f.range[0]}..${f.range[1]}`);
  out.push(`protos_json format=${p.json.formatVersion} root=${jsonText(p.json.root)}`);
  for (const [k, t] of p.json.types) out.push(`protos_json_type ${k}=${jsonText(t)}`);
  for (const r of s.registries)
    out.push(
      `registry ${r.name} ${r.enumDecl ? `enum=${r.enumDecl.name}` : `strings=${(r.strings ?? []).join('|')}`}`,
    );
  for (const w of s.wellKnown) out.push(`well_known ${w.name} kind=${w.kind}`);
  return `${out.join('\n')}\n`;
}

export function schemaHash(s: Schema): string {
  return sha256Hex(listing(s));
}

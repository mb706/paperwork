// The compatibility ledger (10 §15.1 "Versions"; C1b-r1 finding 8): game/schema/compat.yaml records, for
// every version domain, the layout fingerprint of each version it has had, and every id ever assigned in
// every id space. `npm run gen` refuses:
//   - a layout change without a version bump (the domain's fingerprint differs from the one recorded for
//     its current version), and a version that goes down;
//   - a save section whose layout changed without its version becoming the new schema_version, or a section
//     version above schema_version;
//   - an id reused for another name, even one removed long ago (ids are never reused).
// It then appends the new versions and ids to the ledger, which `--check` requires to be committed. A
// fingerprint is the SHA-256 (first 16 hex digits) of the domain's part of the resolved-layout listing: its
// declarations, transitively, and its own lines (listing.ts), so docs and comments never matter.
import { parseDocument } from 'yaml';
import { canonicalJson, compareCodeUnits, sortedEntries, sortedKeys } from '../lib/canonical.ts';
import { sha256Hex } from '../lib/hash.ts';
import { declLines, listing } from './listing.ts';
import { type Decl, refs, type Schema } from './model.ts';

export const COMPAT_PATH = 'schema/compat.yaml';

/** version domain → version → fingerprint; save section → version → fingerprint; id space → id → name. */
export interface Ledger {
  versions: Record<string, Record<string, string>>;
  sections: Record<string, Record<string, string>>;
  ids: Record<string, Record<string, string>>;
}

export const EMPTY_LEDGER: Ledger = { versions: {}, sections: {}, ids: {} };

/** The declarations a set of declarations reaches through their fields, themselves included. */
function closure(s: Schema, names: Iterable<string>): string[] {
  const out = new Set<string>();
  const visit = (n: string) => {
    if (out.has(n)) return;
    const d = s.decls.get(n);
    if (!d) return;
    out.add(n);
    if (d.kind === 'struct' || d.kind === 'message' || d.kind === 'record' || d.kind === 'table')
      for (const f of d.fields) for (const r of refs(f.ty)) visit(r);
  };
  for (const n of names) visit(n);
  return [...out].sort(compareCodeUnits);
}

function fingerprint(s: Schema, decls: Iterable<string>, lines: readonly string[]): string {
  const text = [...closure(s, decls).flatMap((n) => declLines(s.decls.get(n) as Decl)), '--', ...lines].join(
    '\n',
  );
  return sha256Hex(text).slice(0, 16);
}

interface Domain {
  name: string;
  /** Where its version is declared, for messages. */
  where: string;
  version: number;
  /** null: the version is only checked to rise (no layout of its own in the schema). */
  fingerprint: string | null;
}

const declsOfFiles = (s: Schema, files: readonly string[]) =>
  [...s.decls.values()].filter((d) => files.includes(d.file)).map((d) => d.name);

/** Every version domain with its current version and fingerprint. */
export function domains(s: Schema): Domain[] {
  const all = listing(s).split('\n');
  const lines = (...prefixes: string[]) => all.filter((l) => prefixes.some((p) => l.startsWith(p)));
  const exportDecls = (module: 'sim' | 'gen') => {
    const out: string[] = [];
    for (const e of s.abi.exports.filter((x) => x.module === module)) {
      for (const n of [e.input, e.output]) if (n && s.decls.has(n)) out.push(n);
      for (const p of e.params) for (const r of refs(p.ty)) out.push(r);
    }
    if (module === 'sim')
      for (const i of s.abi.imports) for (const p of i.params) for (const r of refs(p.ty)) out.push(r);
    return out;
  };
  const v = s.versions;
  return [
    {
      name: 'action',
      where: 'actions.yaml version (ACTION_SCHEMA_VERSION)',
      version: v.action,
      fingerprint: fingerprint(
        s,
        ['BatchHeader', 'ActionHeader', ...s.actions.map((a) => a.msg.name)],
        lines('action ', 'action_limits'),
      ),
    },
    {
      name: 'packet',
      where: 'packet.yaml version (PACKET_VERSION; packets, events and UI records)',
      version: v.packet,
      fingerprint: fingerprint(
        s,
        declsOfFiles(s, ['schema/packet.yaml', 'schema/events.yaml', 'schema/projections.yaml']),
        lines(
          'packet ',
          'packet_section ',
          'event ',
          'event_limits',
          'projection ',
          'projection_limits',
          'query ',
        ),
      ),
    },
    {
      name: 'abi',
      where: 'abi.yaml abi_version',
      version: v.abi,
      fingerprint: fingerprint(s, exportDecls('sim'), lines('export sim ', 'import ')),
    },
    {
      name: 'gen_abi',
      where: 'abi.yaml gen_abi_version',
      version: v.genAbi,
      fingerprint: fingerprint(s, exportDecls('gen'), lines('export gen ')),
    },
    { name: 'protocol', where: 'abi.yaml protocol_version', version: v.protocol, fingerprint: null },
    {
      name: 'protos',
      where: 'protos.yaml format_version',
      version: s.protos.formatVersion,
      fingerprint: fingerprint(
        s,
        [
          ...declsOfFiles(s, ['schema/protos.yaml']),
          ...s.protos.tables.flatMap((t) => t.columns.flatMap((c) => [...refs(c.ty)])),
        ],
        lines('protos ', 'protos_section', 'protos_table', 'protos_meta', 'protos_expr', 'formula '),
      ),
    },
    {
      name: 'protos_json',
      where: 'protos.yaml json.format_version',
      version: s.protos.json.formatVersion,
      fingerprint: fingerprint(s, [], lines('protos_json')),
    },
    {
      name: 'container',
      where: 'sections.yaml container.format_version',
      version: s.save.formatVersion,
      fingerprint: fingerprint(s, ['SectionFrame'], lines('save ', 'save_header')),
    },
    {
      name: 'closure_log',
      where: 'sections.yaml closure_log.format_version',
      version: s.save.closureLog.formatVersion,
      fingerprint: fingerprint(s, ['ClosureLogHeader', 'ClosureRecord', 'LogBlob'], lines('closure_log')),
    },
    {
      name: 'schema',
      where: 'types.yaml schema_version (every save section)',
      version: v.schema,
      fingerprint: fingerprint(
        s,
        s.save.sections.flatMap((x) => [x.table?.name, x.record?.name].filter((n): n is string => !!n)),
        lines('save_section'),
      ),
    },
  ];
}

/** Each save section's version and fingerprint (its record or table, transitively, and its line). */
export function sectionPrints(s: Schema): { name: string; version: number; fingerprint: string }[] {
  const all = listing(s).split('\n');
  return s.save.sections.map((x) => ({
    name: x.name,
    version: x.version,
    fingerprint: fingerprint(
      s,
      [x.table?.name, x.record?.name].filter((n): n is string => !!n),
      all.filter((l) => l.startsWith(`save_section ${x.name} `)),
    ),
  }));
}

/** Every id space: id → name, as the schema assigns them now. */
export function idSpaces(s: Schema): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  const put = (space: string, id: number, name: string) => {
    const t = out[space] ?? {};
    t[String(id)] = name;
    out[space] = t;
  };
  for (const a of s.actions) put('action', a.id, a.name);
  for (const e of s.events) put('event', e.id, e.name);
  for (const p of s.packet.sections) put('packet_section', p.id, p.name);
  for (const k of s.projections.kinds) put('projection', k.id, k.name);
  for (const q of s.projections.queries) put('query', q.id, q.name);
  for (const x of s.save.sections) put('save_section', x.id, x.name);
  for (const x of s.save.reserved) put('save_section', x.id, x.name);
  for (const x of s.protos.sections) put('proto_section', x.id, x.name);
  for (const m of s.protos.meta) put('meta_record', m.type, m.name);
  for (const d of s.decls.values()) {
    if (d.kind === 'enum' && !d.synthetic) for (const x of d.values) put(`enum:${d.name}`, x.value, x.name);
    if (d.kind === 'flags') for (const b of d.bits) put(`flags:${d.name}`, b.bit, b.name);
    if (d.kind === 'record') for (const f of d.fields) put(`fields:${d.name}`, f.id as number, f.name);
  }
  for (const r of s.registries)
    for (const x of r.enumDecl?.values ?? []) put(`registry:${r.name}`, x.value, x.name);
  return out;
}

/** Checks the schema against the ledger; returns the problems and the ledger with this schema recorded. */
export function checkCompat(s: Schema, ledger: Ledger): { problems: string[]; next: Ledger } {
  const problems: string[] = [];
  const next: Ledger = {
    versions: Object.fromEntries(sortedEntries(ledger.versions).map(([k, v]) => [k, { ...v }])),
    sections: Object.fromEntries(sortedEntries(ledger.sections).map(([k, v]) => [k, { ...v }])),
    ids: Object.fromEntries(sortedEntries(ledger.ids).map(([k, v]) => [k, { ...v }])),
  };
  for (const d of domains(s)) {
    const seen = next.versions[d.name] ?? {};
    const max = Math.max(0, ...sortedKeys(seen).map(Number));
    if (d.version < max) problems.push(`${d.where} is ${d.version}, below ${max}: versions never go down`);
    const was = seen[String(d.version)];
    const fp = d.fingerprint ?? '-';
    if (was !== undefined && was !== fp)
      problems.push(`the ${d.name} layout changed, but ${d.where} is still ${d.version}: raise it`);
    if (was === undefined) seen[String(d.version)] = fp;
    next.versions[d.name] = seen;
  }
  const bootstrap = sortedKeys(ledger.sections).length === 0;
  for (const x of sectionPrints(s)) {
    const seen = next.sections[x.name] ?? {};
    const was = seen[String(x.version)];
    if (x.version > s.versions.schema)
      problems.push(
        `save section ${x.name} has version ${x.version}, above schema_version ${s.versions.schema}`,
      );
    if (was !== undefined && was !== x.fingerprint)
      problems.push(
        `save section ${x.name} changed, but its version is still ${x.version}: set it to the new schema_version (raise types.yaml schema_version)`,
      );
    if (was === undefined && !bootstrap && x.version !== s.versions.schema)
      problems.push(
        `save section ${x.name}'s version ${x.version} must be the schema_version at which its layout changed (${s.versions.schema})`,
      );
    if (was === undefined) seen[String(x.version)] = x.fingerprint;
    next.sections[x.name] = seen;
  }
  for (const [space, ids] of sortedEntries(idSpaces(s))) {
    const seen = next.ids[space] ?? {};
    for (const [id, name] of sortedEntries(ids)) {
      const was = seen[id];
      if (was !== undefined && was !== name)
        problems.push(
          `${space}: id ${id} was ${was}, now ${name}: ids are never reused (a deliberate rename is recorded by renaming it in ${COMPAT_PATH})`,
        );
      else seen[id] = name;
    }
    next.ids[space] = seen;
  }
  return { problems, next };
}

/** Reads the ledger (the empty ledger when the file does not exist yet). */
export function parseLedger(text: string | null): Ledger {
  if (text === null) return EMPTY_LEDGER;
  const doc = parseDocument(text, { version: '1.2', schema: 'core', uniqueKeys: true });
  if (doc.errors[0]) throw new Error(`${COMPAT_PATH}: ${doc.errors[0].message}`);
  const v = (doc.toJS() ?? {}) as Partial<Ledger>;
  const table = (o: unknown) =>
    Object.fromEntries(
      sortedEntries((o ?? {}) as Record<string, Record<string, unknown>>).map(([k, x]) => [
        k,
        Object.fromEntries(sortedEntries(x ?? {}).map(([i, n]) => [String(i), String(n)])),
      ]),
    );
  return { versions: table(v.versions), sections: table(v.sections), ids: table(v.ids) };
}

const byNumber = (a: string, b: string) => Number(a) - Number(b) || compareCodeUnits(a, b);

/** The ledger's text: sorted, one entry per line, deterministic. */
export function ledgerText(l: Ledger): string {
  const block = (title: string, t: Record<string, Record<string, string>>) => {
    const out = [`${title}:`];
    for (const [k, x] of sortedEntries(t)) {
      out.push(`  ${canonicalJson(k, 0)}:`);
      for (const i of sortedKeys(x).sort(byNumber))
        out.push(`    ${canonicalJson(i, 0)}: ${canonicalJson(x[i], 0)}`);
    }
    return out.join('\n');
  };
  return `${[
    '# The schema compatibility ledger (game/schema/README.md, "Versions and the hash"; C1b-r1 finding 8).',
    '# Written by `npm run gen`, which refuses a layout change without a version bump, a version that goes',
    '# down and a reused id. Append-only: never delete an entry. The one hand edit allowed is a deliberate',
    '# rename: change the name recorded under its id.',
    block('versions', l.versions),
    block('sections', l.sections),
    block('ids', l.ids),
  ].join('\n')}\n`;
}

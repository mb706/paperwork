// Assembles the TypeScript modules of src/shared/gen/: every declaration in its home module, each
// module's extras, the samples, and the import lines each module needs.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Capabilities } from './capabilities.ts';
import { ERROR_KINDS } from './error-kinds.ts';
import type { Decl, Schema } from './model.ts';
import { typeName } from './model.ts';
import { homeMod } from './rust.ts';
import { tsSamples } from './samples-ts.ts';
import { emitDecl, type TsMod, TsOut } from './ts.ts';
import { tsExtras } from './ts-extras.ts';

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), 'templates');

export const TS_MODS: readonly TsMod[] = [
  'types',
  'actions',
  'events',
  'packet',
  'projections',
  'container',
  'abi',
  'protos',
  'registries',
  'capabilities',
  'state',
  'pools',
  'sections',
  'samples',
];

const MOD_DOC: Record<string, string> = {
  types:
    'Shared scalars, ids, enums, flag sets and small records (schema/types.yaml; §15.1, §15.3, §4.2–§4.3).',
  actions:
    'Actions, batches and closures (schema/actions.yaml; §15.3): the encoder, the decoder, the preflight.',
  events: 'Events (schema/events.yaml; §15.6): payloads and the EVENTS section records.',
  packet: 'The render packet (schema/packet.yaml; §15.4): header, directory, section records, the held set.',
  projections: 'Projections, subscriptions and queries (schema/projections.yaml; §15.5).',
  container: 'The save container and closure logs (schema/sections.yaml; §8.1, §8.5).',
  abi: 'The WebAssembly ABI (schema/abi.yaml; §15.8, §15.9): records, status codes and the typed wrappers.',
  protos:
    'prototypes.bin and prototypes.json (schema/protos.yaml; §15.2): the writer, the reader, the JSON schema.',
  registries: 'Engine registries (schema/registries.yaml; §2.4): the lists the data stage checks against.',
  capabilities: 'The current capability manifest (game/data/engine/capabilities.yaml; §2.4), as code.',
  state: 'The saved state records (schema/state.yaml; §4.4–§4.5, §8.1).',
  pools: 'The entity table and the pools (schema/state.yaml; §4.5): rows, column tables and read views.',
  sections: 'The save sections (schema/sections.yaml; §8.1, §4.8): section codecs and the digest shard map.',
  samples: 'Sample values of every record, for the codec fixtures (test/fixtures/codec; §15.1). Tests only.',
};

export interface TsFile {
  path: string;
  text: string;
}

function imports(o: TsOut): string {
  const byMod = new Map<string, { values: Set<string>; types: Set<string> }>();
  const add = (mod: string, name: string, kind: 'values' | 'types') => {
    const e = byMod.get(mod) ?? { values: new Set(), types: new Set() };
    e[kind].add(name);
    byMod.set(mod, e);
  };
  for (const key of o.values) {
    const [name, what] = key.split('#') as [string, string];
    const d = o.s.decls.get(name) as Decl;
    const m = homeMod(d);
    if (m === o.mod) continue;
    add(m, what === 'codec' ? `${typeName(d)}Codec` : typeName(d), 'values');
  }
  for (const name of o.types) {
    const d = o.s.decls.get(name) as Decl;
    const m = homeMod(d);
    if (m === o.mod) continue;
    add(m, typeName(d), 'types');
  }
  const lines: string[] = [];
  // A runtime name is a value import when the body constructs, calls or tests it, else a type import.
  const body = o.parts.join('\n');
  const used = (n: string) => new RegExp(`\\b${n}\\b`).test(body);
  const valueUse = (n: string) =>
    new RegExp(`(new ${n}\\(|\\b${n}\\(|instanceof ${n}\\b|\\b${n}\\.)`).test(body);
  const rt = [...new Set([...o.runtime, ...o.runtimeTypes])].filter(used).sort();
  if (rt.length)
    lines.push(`import { ${rt.map((n) => (valueUse(n) ? n : `type ${n}`)).join(', ')} } from './codec.ts';`);
  for (const [m, e] of [...byMod.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const names = [
      ...[...e.values].sort(),
      ...[...e.types]
        .filter((t) => !e.values.has(t))
        .sort()
        .map((t) => `type ${t}`),
    ];
    lines.push(`import { ${names.join(', ')} } from './${m}.ts';`);
  }
  return lines.join('\n');
}

export function tsRuntime(): string {
  return readFileSync(join(TEMPLATES, 'codec.ts.txt'), 'utf8').replace(
    '@@ERROR_KIND_CONSTS@@',
    ERROR_KINDS.map(([n, doc]) => `  /** ${doc} */\n  ${n}: '${n}',`).join('\n'),
  );
}

export function emitTsFiles(s: Schema, caps: Capabilities, hashHex: string, listingText: string): TsFile[] {
  const outs = new Map<TsMod, TsOut>();
  for (const m of TS_MODS) outs.set(m, new TsOut(s, m));
  for (const name of s.names) {
    const d = s.decls.get(name) as Decl;
    emitDecl(outs.get(homeMod(d)) as TsOut, d);
  }
  tsExtras(s, caps, outs);
  tsSamples(s, outs.get('samples') as TsOut);
  const v = s.versions;
  const files: TsFile[] = [
    {
      path: 'src/shared/gen/schema.ts',
      text: `// The schema's identity (10 §15.1): its hash and versions. Generated from game/schema/.

/** SHA-256 of the schema's resolved layouts, as hex (src/shared/gen/layout.txt; B1-r1 3). */
export const SCHEMA_HASH = '${hashHex}';
/** Raised with every change to a save section's layout (schema/types.yaml). */
export const SCHEMA_VERSION = ${v.schema};
/** Every batch header carries it (schema/actions.yaml). */
export const ACTION_SCHEMA_VERSION = ${v.action};
/** Every packet header carries it (schema/packet.yaml). */
export const PACKET_VERSION = ${v.packet};
/** sim_abi_version() and gen_abi_version() (schema/abi.yaml). */
export const ABI_VERSION = ${v.abi};
export const GEN_ABI_VERSION = ${v.genAbi};
/** PROTOCOL_VERSION of the worker and wire protocols (schema/abi.yaml; §3.2, 11 §3.2). */
export const PROTOCOL_VERSION = ${v.protocol};
`,
    },
    { path: 'src/shared/gen/codec.ts', text: tsRuntime() },
    { path: 'src/shared/gen/layout.txt', text: listingText },
  ];
  for (const m of TS_MODS) {
    const o = outs.get(m) as TsOut;
    files.push({
      path: `src/shared/gen/${m}.ts`,
      text: `// ${MOD_DOC[m]}\n${imports(o)}\n\n${o.parts.join('\n')}`,
    });
  }
  return files;
}

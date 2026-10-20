// The current capability manifest (game/data/engine/capabilities.yaml; 10 §2.4, B1-r1 19), read by the
// generator so that (a) every name it lists is checked against the schema (C1a open issue 2) and (b) the
// sets it implements become code in both languages: an action, projection, query or packet section outside
// them fails explicitly (`unsupported`), and the META blocks it reads (`data`) must be in prototypes.bin.
import { readFileSync } from 'node:fs';
import { parseDocument } from 'yaml';
import type { Schema } from './model.ts';

export interface Capabilities {
  name: string;
  actions: string[];
  systemActions: string[];
  projections: string[];
  queries: string[];
  packetSections: string[];
  data: string[];
  registries: {
    effects: string[];
    triggers: string[];
    achievement_conditions: string[];
    formula_refs: string[];
  };
}

interface RawManifest {
  extends?: string;
  data?: string[];
  actions?: string[];
  system_actions?: string[];
  projections?: string[];
  queries?: string[];
  packet_sections?: string[];
  registries?: Partial<Capabilities['registries']>;
}

const union = (a: readonly string[] = [], b: readonly string[] = []): string[] => [...new Set([...a, ...b])];

export function loadCapabilities(path: string, file = 'data/engine/capabilities.yaml'): Capabilities {
  const doc = parseDocument(readFileSync(path, 'utf8'), { version: '1.2', uniqueKeys: true });
  if (doc.errors[0]) throw new Error(`${file}: ${doc.errors[0].message}`);
  const v = doc.toJS() as { current: string; manifests: Record<string, RawManifest> };
  const resolve = (n: string, seen: string[]): Capabilities => {
    const m = v.manifests[n];
    if (!m) throw new Error(`${file}: no capability manifest ${n}`);
    if (seen.includes(n))
      throw new Error(`${file}: manifests extend each other in a cycle: ${[...seen, n].join(' -> ')}`);
    const base: Capabilities = m.extends
      ? resolve(m.extends, [...seen, n])
      : {
          name: n,
          actions: [],
          systemActions: [],
          projections: [],
          queries: [],
          packetSections: [],
          data: [],
          registries: { effects: [], triggers: [], achievement_conditions: [], formula_refs: [] },
        };
    const r = m.registries ?? {};
    return {
      name: n,
      actions: union(base.actions, m.actions),
      systemActions: union(base.systemActions, m.system_actions),
      projections: union(base.projections, m.projections),
      queries: union(base.queries, m.queries),
      packetSections: union(base.packetSections, m.packet_sections),
      data: union(base.data, m.data),
      registries: {
        effects: union(base.registries.effects, r.effects),
        triggers: union(base.registries.triggers, r.triggers),
        achievement_conditions: union(base.registries.achievement_conditions, r.achievement_conditions),
        formula_refs: union(base.registries.formula_refs, r.formula_refs),
      },
    };
  };
  return resolve(v.current, []);
}

/** Every name the manifest lists must exist in the schema (C1a open issue 2). Returns the problems. */
export function checkCapabilities(c: Capabilities, s: Schema): string[] {
  const out: string[] = [];
  const has = (kind: string, names: readonly string[], known: readonly string[]) => {
    for (const n of names)
      if (!known.includes(n)) out.push(`${kind} ${n} is not in the schema (known: ${known.join(', ')})`);
  };
  has(
    'action',
    c.actions,
    s.actions.filter((a) => !a.system).map((a) => a.name),
  );
  has(
    'system action',
    c.systemActions,
    s.actions.filter((a) => a.system).map((a) => a.name),
  );
  const missingSystem = s.actions
    .filter((a) => a.system && !c.systemActions.includes(a.name))
    .map((a) => a.name);
  if (missingSystem.length > 0)
    out.push(`every system action is M0-mandatory (§15.3); the manifest lacks ${missingSystem.join(', ')}`);
  has(
    'projection',
    c.projections,
    s.projections.kinds.map((k) => k.name),
  );
  has(
    'query',
    c.queries,
    s.projections.queries.map((q) => q.name),
  );
  has(
    'packet section',
    c.packetSections,
    s.packet.sections.map((p) => p.name),
  );
  for (const k of c.projections) {
    const def = s.projections.kinds.find((x) => x.name === k);
    if (def && !def.record)
      out.push(`projection ${k} is in the manifest but projections.yaml gives it no record`);
  }
  for (const q of c.queries) {
    const def = s.projections.queries.find((x) => x.name === q);
    if (def && !def.result) out.push(`query ${q} is in the manifest but projections.yaml gives it no result`);
  }
  const blocks = s.protos.meta.map((m) => m.block).filter((b): b is string => b !== undefined);
  has('data block', c.data, blocks);
  const reg = (name: string) => s.registries.find((r) => r.name === name);
  const values = (name: string) => {
    const r = reg(name);
    return r?.enumDecl ? r.enumDecl.values.map((x) => x.name) : (r?.strings ?? []);
  };
  has('effect', c.registries.effects, values('effects'));
  has(
    'trigger',
    c.registries.triggers,
    values('triggers').map((x) => x.replace(/_/g, '-')),
  );
  has('achievement condition', c.registries.achievement_conditions, values('achievement_conditions'));
  has('formula reference', c.registries.formula_refs, values('formula_refs'));
  return out;
}

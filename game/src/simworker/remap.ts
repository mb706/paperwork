// Prototypes are remapped by name (10 §8.3, §15.8 `sim_load`): when a save's `prototypesHash` is not the build's,
// the shell builds one remap table per prototype kind from the save's name tables (old id → new id, 0xFFFF for
// removed), carrying the save's name of every removed id in ascending old id (abi.yaml `RemapTable.removed`:
// only the shell has the save's name tables, and the load report names what went). A kind whose names map to
// themselves needs no table; when the hashes match there are none (`kind_count` 0). This is how the golden
// `remap-load` trace's input was built.
import type { RemapTable } from '../shared/gen/abi.ts';
import type { SaveHeaderNameTables } from '../shared/gen/container.ts';
import { ProtoKind } from '../shared/gen/types.ts';

/** The build's names per kind, in id order (prototypes.bin's NAMES, `readPrototypesBin().names`). */
export type NameTables = Readonly<Record<keyof SaveHeaderNameTables, readonly string[]>>;

/** The kinds in ProtoKind order, with their name-table keys. */
export const KINDS: readonly { kind: number; key: keyof SaveHeaderNameTables }[] = [
  { kind: ProtoKind.item, key: 'item' },
  { kind: ProtoKind.fluid, key: 'fluid' },
  { kind: ProtoKind.recipe, key: 'recipe' },
  { kind: ProtoKind.entity, key: 'entity' },
  { kind: ProtoKind.technology, key: 'technology' },
  { kind: ProtoKind.resource, key: 'resource' },
  { kind: ProtoKind.tile, key: 'tile' },
  { kind: ProtoKind.world_object, key: 'world_object' },
  { kind: ProtoKind.signal, key: 'signal' },
];

export const REMOVED = 0xffff;

/** The remap tables from a save's names to the build's (§8.3); none when they agree. */
export function remapTables(save: NameTables, build: NameTables): RemapTable[] {
  const enc = new TextEncoder();
  const out: RemapTable[] = [];
  for (const { kind, key } of KINDS) {
    const old = save[key];
    const ids = new Map(build[key].map((n, i) => [n, i] as const));
    const table = old.map((n) => ids.get(n) ?? REMOVED);
    if (table.every((v, i) => v === i)) continue;
    const removed = old.filter((_, i) => table[i] === REMOVED).map((n) => ({ name: enc.encode(n) }));
    out.push({ kind, ids: table, removed });
  }
  return out;
}

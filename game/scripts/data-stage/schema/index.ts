// Validates every design-data file against its schema (10 §2.4 step 4; SCHEMA.md) and returns the
// typed data. Messages point at the file, the path and the line.
import type { z } from 'zod';
import type { DataPath, Diagnostics } from '../diagnostics.ts';
import { at, type SourceFile } from '../sources.ts';
import { type Entity, EXTRA, entity } from './entities.ts';
import { type Item, item } from './items.ts';
import { type Meta, meta } from './meta.ts';
import { type Recipe, recipe } from './recipes.ts';
import { type Technology, technology } from './technologies.ts';
import { type Text, text } from './text.ts';
import {
  type Enemy,
  enemy,
  type Resource,
  resource,
  type Tile,
  tile,
  type WorldObject,
  worldObject,
} from './world.ts';

/** The list kinds, in the order the files are read. `world` is world.yaml's world objects. */
export const LIST_KINDS = [
  'items',
  'recipes',
  'entities',
  'technologies',
  'resources',
  'tiles',
  'world',
  'enemies',
] as const;
export type ListKind = (typeof LIST_KINDS)[number];
export type FileKind = ListKind | 'meta' | 'text';
export const FILE_KINDS: readonly FileKind[] = [...LIST_KINDS, 'meta', 'text'];

const SCHEMAS: Record<FileKind, z.ZodType> = {
  items: item,
  recipes: recipe,
  entities: entity,
  technologies: technology,
  resources: resource,
  tiles: tile,
  world: worldObject,
  enemies: enemy,
  meta,
  text,
};

export interface DesignData {
  items: Item[];
  recipes: Recipe[];
  entities: Entity[];
  technologies: Technology[];
  resources: Resource[];
  tiles: Tile[];
  world: WorldObject[];
  enemies: Enemy[];
  meta: Meta;
  text: Text;
  sources: Record<FileKind, SourceFile>;
}

function report(
  diags: Diagnostics,
  src: SourceFile,
  base: DataPath,
  issues: readonly z.core.$ZodIssue[],
): void {
  for (const issue of issues) {
    const path = [...base, ...issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p))] as DataPath;
    diags.error(issue.message, at(src, path));
  }
}

/** Validates the parsed files. Returns the typed data when there are no errors. */
export function validateDesign(sources: Record<FileKind, SourceFile>, diags: Diagnostics): DesignData | null {
  const before = diags.errors.length;
  const out: Partial<Record<FileKind, unknown>> = {};
  for (const kind of FILE_KINDS) {
    const src = sources[kind];
    const isList = (LIST_KINDS as readonly string[]).includes(kind);
    const value = src.value ?? (isList ? [] : {});
    if (isList) {
      if (!Array.isArray(value)) {
        diags.error('the top level must be a list', { file: src.file });
        continue;
      }
      const items: unknown[] = [];
      value.forEach((v, i) => {
        const r = SCHEMAS[kind].safeParse(v);
        if (r.success) items.push(r.data);
        else report(diags, src, [i], r.error.issues);
      });
      out[kind] = items;
    } else {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        diags.error('the top level must be a mapping', { file: src.file });
        continue;
      }
      const r = SCHEMAS[kind].safeParse(value);
      if (r.success) out[kind] = r.data;
      else report(diags, src, [], r.error.issues);
    }
  }
  // Type-specific entity fields.
  const entSrc = sources.entities;
  (Array.isArray(entSrc.value) ? entSrc.value : []).forEach((raw: unknown, i: number) => {
    const e = raw as { type?: string; extra?: unknown };
    if (e.extra === undefined || typeof e.type !== 'string') return;
    const schema = EXTRA[e.type as Entity['type']];
    if (!schema) {
      diags.error(`entities of type ${e.type} take no extra fields`, at(entSrc, [i, 'extra']));
      return;
    }
    const r = schema.safeParse(e.extra);
    if (!r.success) report(diags, entSrc, [i, 'extra'], r.error.issues);
  });
  // Ids are unique within each kind.
  for (const kind of LIST_KINDS) {
    const seen = new Map<string, number>();
    const list = (out[kind] as { id: string }[] | undefined) ?? [];
    const raw = Array.isArray(sources[kind].value) ? (sources[kind].value as { id?: unknown }[]) : [];
    raw.forEach((o, i) => {
      if (typeof o?.id !== 'string') return;
      const prev = seen.get(o.id);
      if (prev !== undefined)
        diags.error(`duplicate id ${o.id} (first at [${prev}])`, at(sources[kind], [i, 'id']));
      else seen.set(o.id, i);
    });
    void list;
  }
  if (diags.errors.length > before) return null;
  return { ...(out as Omit<DesignData, 'sources'>), sources };
}

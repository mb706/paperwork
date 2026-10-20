// src/shared/gen/proto-ids.ts (10 §2.4 step 6): string-literal unions of every prototype name in the
// design data, so tests and code that name 'memo' are checked at compile time. Names only: numeric ids
// depend on the build and are resolved at runtime (Rust never hard-codes one either).
import { compareCodeUnits } from '../../lib/canonical.ts';
import { withHeader } from '../../lib/generated.ts';
import type { DesignData } from '../schema/index.ts';

const KINDS = [
  ['Item', 'ITEM', (d: DesignData) => d.items.filter((i) => i.type === 'item').map((i) => i.id)],
  ['Fluid', 'FLUID', (d: DesignData) => d.items.filter((i) => i.type === 'fluid').map((i) => i.id)],
  ['Recipe', 'RECIPE', (d: DesignData) => d.recipes.map((r) => r.id)],
  ['Entity', 'ENTITY', (d: DesignData) => d.entities.map((e) => e.id)],
  ['Technology', 'TECHNOLOGY', (d: DesignData) => d.technologies.map((t) => t.id)],
  ['Resource', 'RESOURCE', (d: DesignData) => d.resources.map((r) => r.id)],
  ['Tile', 'TILE', (d: DesignData) => d.tiles.map((t) => t.id)],
  ['WorldObject', 'WORLD_OBJECT', (d: DesignData) => d.world.map((w) => w.id)],
] as const;

export function protoIdsTs(d: DesignData): string {
  let body =
    '// Prototype names of the design data (10 §2.4). Numeric ids are per build: resolve them at runtime.\n';
  for (const [type, constName, get] of KINDS) {
    const names = [...get(d)].sort(compareCodeUnits);
    body += `\nexport const ${constName}_NAMES = [\n${names.map((n) => `  '${n}',`).join('\n')}\n] as const;\n`;
    body += `export type ${type}Name = (typeof ${constName}_NAMES)[number];\n`;
  }
  return withHeader(
    { generator: 'scripts/data-stage.ts', source: 'design/spec/data', command: 'npm run data' },
    body,
  );
}

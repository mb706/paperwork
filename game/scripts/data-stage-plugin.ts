// Vite plugins for the generators (10 §2.3, §2.4 step 3: "as a Vite plugin with file watching").
//   The data stage: runs at server start and after every change to the design data, the engine overlay,
//   09 §2.7's slice or 10 §12's manifests; requests under /data/ wait for it; `vite build` runs it first.
//   The schema generator: runs after every change under schema/ (its outputs under crates/ then trigger
//   the cargo plugin). Builds use the committed generated code, which `npm run check` keeps fresh.
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { watchRunPlugin } from './watch-run-plugin.ts';

export function dataStagePlugin({ root }: { root: string }): Plugin {
  const repo = join(root, '..');
  return watchRunPlugin({
    name: 'data-stage',
    root,
    script: 'scripts/data-stage.ts',
    args: ['--quiet'],
    watched: [
      join(repo, 'design', 'spec', 'data'),
      join(repo, 'design', 'spec', '09-vertical-slice.md'),
      join(repo, 'design', 'spec', '10-architecture.md'),
      join(root, 'data', 'engine'),
      join(root, 'test', 'fixtures', 'expr', 'edge-cases.yaml'),
    ],
    holdPrefix: '/data/',
    beforeBuild: true,
  });
}

export function schemaGenPlugin({ root }: { root: string }): Plugin {
  return watchRunPlugin({
    name: 'schema-gen',
    root,
    script: 'scripts/schema-gen.ts',
    watched: [join(root, 'schema')],
  });
}

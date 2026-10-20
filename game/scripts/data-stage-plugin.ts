// Vite plugins for the generators (10 §2.3, §2.4 step 3: "as a Vite plugin with file watching").
//   The schema generator runs after every change under schema/ or to the generator itself; its outputs
//   under crates/ then trigger the cargo plugin.
//   The data stage runs at server start, after every change to its inputs (the design data, the engine
//   overlay, 09 §2.7, 10 §12, the expression edge cases) or to its own implementation (C1a-r1 finding 14),
//   and after the schema generator succeeds (prototypes.bin carries the schema's hash). Requests under
//   /data/ wait for every generator and fail while the schema generator or the data stage has failed.
//   `vite build` runs the data stage first; builds use the committed generated code, which `npm run check`
//   keeps fresh.
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { watchRunPlugin } from './watch-run-plugin.ts';

/** What the data stage reads: its inputs and its own code. */
export function dataStageWatched(root: string): string[] {
  const repo = join(root, '..');
  return [
    join(repo, 'design', 'spec', 'data'),
    join(repo, 'design', 'spec', '09-vertical-slice.md'),
    join(repo, 'design', 'spec', '10-architecture.md'),
    join(root, 'data', 'engine'),
    join(root, 'test', 'fixtures', 'expr', 'edge-cases.yaml'),
    join(root, 'scripts', 'data-stage.ts'),
    join(root, 'scripts', 'data-stage'),
    join(root, 'scripts', 'lib'),
    join(root, 'scripts', 'build-manifest.ts'),
    join(root, 'src', 'shared', 'gen', 'schema.ts'),
  ];
}

export function dataStagePlugin({ root }: { root: string }): Plugin {
  return watchRunPlugin({
    name: 'data-stage',
    root,
    script: 'scripts/data-stage.ts',
    args: ['--quiet'],
    watched: dataStageWatched(root),
    holdPrefixes: ['/data/'],
    dependsOn: ['schema-gen', 'data-stage'],
    follows: ['schema-gen'],
    beforeBuild: true,
  });
}

export function schemaGenPlugin({ root }: { root: string }): Plugin {
  return watchRunPlugin({
    name: 'schema-gen',
    root,
    script: 'scripts/schema-gen.ts',
    watched: [
      join(root, 'schema'),
      join(root, 'scripts', 'schema-gen.ts'),
      join(root, 'scripts', 'schema-gen'),
      join(root, 'scripts', 'lib'),
      join(root, 'data', 'engine', 'capabilities.yaml'),
    ],
  });
}

// The fake sim's prototype build in the dev server (10 §15.10, `?sim=fake`): the data stage's M1 filter
// (belts, inserters, furnaces, assemblers, the keypunch: what the fake sim's factory needs) with a complete sound
// table, built in watch mode into .cache/data/m1/ and served under /data/fake/. Requests there wait for it and fail while it has failed,
// as /data/ does for the M0 build.
import { createReadStream, existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import type { Plugin } from 'vite';
import { dataStageWatched } from './data-stage-plugin.ts';
import { watchRunPlugin } from './watch-run-plugin.ts';

const TYPES: Record<string, string> = { '.json': 'application/json', '.bin': 'application/octet-stream' };

export function fakeDataPlugin({ root }: { root: string }): Plugin[] {
  const dir = join(root, '.cache', 'data', 'm1');
  return [
    watchRunPlugin({
      name: 'fake-data',
      root,
      script: 'scripts/data-stage.ts',
      // The fake's build carries a complete sound table (10 §15.6): the audio package's sounds.yaml when it
      // exists, else the fixture with the same names (test/fixtures/fake/sounds.yaml).
      args: [
        '--manifest',
        'm1',
        '--allow-incomplete',
        '--quiet',
        '--engine-file',
        'sounds.yaml=test/fixtures/fake/sounds.yaml',
      ],
      watched: [...dataStageWatched(root), join(root, 'test', 'fixtures', 'fake', 'sounds.yaml')],
      holdPrefixes: ['/data/fake/'],
      dependsOn: ['schema-gen', 'fake-data'],
      follows: ['schema-gen'],
    }),
    {
      name: 'paperwork:fake-data-serve',
      configureServer(server) {
        server.middlewares.use('/data/fake/', (req, res, next) => {
          const name = normalize((req.url ?? '/').split('?')[0] as string).replace(/^\/+/, '');
          const file = join(dir, name);
          if (!name || name.includes('..') || !existsSync(file)) return next();
          const ext = name.slice(name.lastIndexOf('.'));
          res.setHeader('Content-Type', TYPES[ext] ?? 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-store');
          createReadStream(file).pipe(res);
        });
      },
    },
  ];
}

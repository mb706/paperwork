// Vite (10 §2.3): the dev server on 127.0.0.1:5173 with the schema generator and the data stage in watch
// mode and the cargo plugin; the production bundle in dist/ with the release WebAssembly (run
// scripts/wasm-release.sh first; `npm run build` does), compressed siblings and build-manifest.json.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { cargoPlugin } from './scripts/cargo-plugin.ts';
import { dataStagePlugin, schemaGenPlugin } from './scripts/data-stage-plugin.ts';
import { fakeDataPlugin } from './scripts/fake-data-plugin.ts';
import { releasePlugin } from './scripts/release-plugin.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PAPERWORK_PORT ?? 5173);

export default defineConfig({
  root,
  plugins: [
    schemaGenPlugin({ root }),
    dataStagePlugin({ root }),
    ...fakeDataPlugin({ root }),
    cargoPlugin({ root }),
    solid(),
    releasePlugin({ root }),
  ],
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
    watch: {
      ignored: [
        '**/target/**',
        '**/.cache/**',
        '**/public/data/**',
        '**/test-results/**',
        '**/playwright-report/**',
      ],
    },
  },
  preview: { host: '127.0.0.1', port, strictPort: true },
  build: {
    target: 'es2024',
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    sourcemap: true,
    reportCompressedSize: false,
  },
  worker: { format: 'es' },
  // The UI's dependencies are pre-bundled when the server starts, so the first page load never triggers a
  // re-optimisation and a full reload (C5: a cold e2e server reloaded mid-load in Firefox).
  optimizeDeps: { include: ['solid-js', 'solid-js/web', 'solid-js/store'] },
});

// Vite (10 §2.3): the dev server on 127.0.0.1:5173 with the data stage and the cargo plugin, and the
// production bundle in dist/ with the release WebAssembly (run scripts/wasm-release.sh first; `npm run
// build` does), compressed siblings and build-manifest.json.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { cargoPlugin } from './scripts/cargo-plugin.ts';
import { dataStagePlugin } from './scripts/data-stage-plugin.ts';
import { releasePlugin } from './scripts/release-plugin.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PAPERWORK_PORT ?? 5173);

export default defineConfig({
  root,
  plugins: [dataStagePlugin({ root }), cargoPlugin({ root }), solid(), releasePlugin({ root, build: 'm0' })],
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
});

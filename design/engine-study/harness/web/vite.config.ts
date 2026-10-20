import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The bench page and its module worker; the wasm builds come from ../../target/wasm (built by rust/build-wasm.sh).
export default defineConfig({
  root: resolve(import.meta.dirname),
  base: './',
  build: {
    outDir: resolve(import.meta.dirname, '../../target/web'),
    emptyOutDir: true,
    target: 'es2024',
    assetsInlineLimit: 0,
    rollupOptions: { input: { index: resolve(import.meta.dirname, 'index.html'), threads: resolve(import.meta.dirname, 'threads.html') } },
  },
  worker: { format: 'es' },
  server: { fs: { allow: [resolve(import.meta.dirname, '../..')] } },
});

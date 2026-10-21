// Vitest runs in Node without vite-plugin-solid: the Solid plugin silently switches Vitest to jsdom,
// which we neither need nor install; UI is tested in real browsers (10 §2.1). Solid's reactive core resolves to its
// browser build here (Node's export condition picks the server build, whose signals do not track), so the UI's
// stores, memos and effects run in Vitest as they do in the page; nothing of solid-js/web is imported in tests.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      { find: /^solid-js$/, replacement: 'solid-js/dist/solid.js' },
      { find: /^solid-js\/store$/, replacement: 'solid-js/store/dist/store.js' },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'test/**/*.test.ts'],
    pool: 'threads',
    globalSetup: ['test/helpers/global-setup.ts'],
    testTimeout: 60_000,
    reporters: ['default'],
  },
});

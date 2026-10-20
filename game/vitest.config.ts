// Vitest runs in Node without vite-plugin-solid: the Solid plugin silently switches Vitest to jsdom,
// which we neither need nor install; UI is tested in real browsers (10 §2.1).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'test/**/*.test.ts'],
    pool: 'threads',
    globalSetup: ['test/helpers/global-setup.ts'],
    testTimeout: 60_000,
    reporters: ['default'],
  },
});

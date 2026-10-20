// Playwright (10 §10.5): Chrome for Testing 156 from the host install (SwiftShader WebGL2), Firefox 157 from
// Playwright's own cache with `?render=none` (no WebGL2 in headless Firefox here). The suite starts its own
// dev server on a test port, so it never collides with a server the user tunnels into on 5173.
import { homedir } from 'node:os';
import { defineConfig } from '@playwright/test';

const port = Number(process.env.PW_PORT ?? 5191);

export default defineConfig({
  testDir: 'e2e',
  // The release smoke has its own config (playwright.release.config.ts) and server.
  testIgnore: ['release.spec.ts'],
  outputDir: 'test-results/dev',
  timeout: 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: 'chrome',
      use: {
        browserName: 'chromium',
        launchOptions: { executablePath: `${homedir()}/.local/opt/chrome-current/chrome` },
      },
    },
    { name: 'firefox', use: { browserName: 'firefox' } },
  ],
  webServer: {
    command: `node node_modules/vite/bin/vite.js --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/`,
    env: { PAPERWORK_PORT: String(port) },
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});

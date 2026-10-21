// The release smoke (C1a-r1 finding 12): the production bundle in dist/ (npm run build), served by
// `vite preview` with its compressed siblings, in Chrome for Testing. Run: playwright test -c this file. The server
// takes PW_RELEASE_PORT, or a free port (scripts/free-port.ts, C8).
import { homedir } from 'node:os';
import { defineConfig } from '@playwright/test';
import { portFromEnv } from './scripts/free-port.ts';

const port = portFromEnv('PW_RELEASE_PORT');

export default defineConfig({
  testDir: 'e2e',
  testMatch: ['release.spec.ts'],
  outputDir: 'test-results/release',
  timeout: 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1280, height: 720 } },
  projects: [
    {
      name: 'chrome',
      use: {
        browserName: 'chromium',
        launchOptions: { executablePath: `${homedir()}/.local/opt/chrome-current/chrome` },
      },
    },
  ],
  webServer: {
    command: `node node_modules/vite/bin/vite.js preview --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/`,
    env: { PAPERWORK_PORT: String(port) },
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});

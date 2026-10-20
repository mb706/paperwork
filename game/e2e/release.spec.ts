// @release: the production bundle loads in the browser with both modules listed, the data stage's outputs
// and the compressed siblings served by Accept-Encoding (C1a-r1 finding 12).
import { expect, test } from '@playwright/test';
import { watchConsole } from './console.ts';
import { SIM_STATUS } from './status.ts';

test('the release bundle loads, compressed, without errors @release', async ({ page }) => {
  const problems = watchConsole(page);
  const encodings = new Map<string, string>();
  page.on('response', (r) =>
    encodings.set(new URL(r.url()).pathname, r.headers()['content-encoding'] ?? 'identity'),
  );
  await page.goto('/');
  await expect(page).toHaveTitle('Paperwork');
  await expect(page.getByTestId('sim-status')).toHaveText(SIM_STATUS);
  await expect(page.getByTestId('build-status')).toHaveText(/^m0 · [0-9a-f]{12}$/);
  const manifest = await (await page.request.get('/data/build-manifest.json')).json();
  expect(manifest.dev).toBe(false);
  expect(Object.keys(manifest.modules).sort()).toEqual(['gen', 'sim']);
  for (const path of ['/', '/data/prototypes.json', '/data/build-manifest.json'])
    expect(encodings.get(path), path).toBe('br');
  // sim.wasm and gen.wasm, each compiled once by the page (§9.7).
  expect([...encodings].filter(([p]) => p.endsWith('.wasm')).map(([, e]) => e)).toEqual(['br', 'br']);
  expect(problems).toEqual([]);
});

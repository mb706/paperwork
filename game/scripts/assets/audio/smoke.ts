// A scripted pass over the audio dev page in headless Chrome (10 §9.4): start under a user gesture, the
// game's music program, every sound, a factory's load, the music keys, map view; prints the runtime's
// status and every console problem. Run from game/: node scripts/assets/audio/smoke.ts [--reduced]
import { devServer, openPage } from './render.ts';

const reduced = process.argv.includes('--reduced');
const { server, url } = await devServer();
const { page, close, errors } = await openPage(`${url}${reduced ? '?reduced' : ''}`, []);
const status = () =>
  page.evaluate(() =>
    (
      globalThis as unknown as { __audioDev: { audio: { status(): Promise<unknown> } } }
    ).__audioDev.audio.status(),
  );
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
try {
  await page.getByTestId('unlock').click();
  await wait(1500);
  console.log('after unlock', JSON.stringify(await status()));
  await page.click('#game');
  await wait(8000);
  console.log('in game', JSON.stringify(await status()));
  for (const b of await page.locator('#sounds button').all()) {
    await b.click();
    await wait(120);
  }
  await page.click('#load');
  await wait(6000);
  console.log('under load', JSON.stringify(await status()));
  await page.click('#map');
  await wait(500);
  await page.click('#map');
  await page.click('#next');
  await wait(4000);
  console.log('after next', JSON.stringify(await status()));
  await page.click('#load');
  await page.click('#end');
  await wait(2500);
  console.log('after end', JSON.stringify(await status()));
} finally {
  console.log(errors.length ? `console problems:\n  ${errors.join('\n  ')}` : 'console: clean');
  await close();
  await server.close();
}

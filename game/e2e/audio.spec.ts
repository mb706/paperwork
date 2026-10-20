// @audio (C7; 10 §9.4): the audio runtime in Chrome and Firefox on its dev page (src/dev/audio.html).
// Needs the audio asset build (scripts/assets/audio/build.py); without public/audio the tests skip.
//   npx playwright test e2e/audio.spec.ts [--project chrome]
import { expect, type Page, test } from '@playwright/test';
import { watchConsole } from './console.ts';

interface Dev {
  audio: {
    state: string;
    mode: string;
    status(): Promise<{
      state: string;
      mode: string;
      sampleRate: number;
      codec: string | null;
      piece: string | null;
      dropped: number;
      sfx: { played: number; loops: number };
      bank: { activeSfx: number } | null;
      errors: string[];
    }>;
    unlock(): void;
  };
  render(cfg: unknown): Promise<{
    lufs: number;
    peak: number;
    denormals: number;
    nonFinite: number;
    dropped: number;
    errors: string[];
  }>;
  decodeCheck(
    codec: string,
  ): Promise<{ file: string; len: number; decoded: number; offset: number; ok: boolean }[]>;
  loopTest(codec: string): Promise<{ name: string; ok: boolean; seams: number[]; p99: number }[]>;
}
async function open(page: Page, query = ''): Promise<void> {
  const r = await page.request.get('/audio/music.json');
  test.skip(!r.ok(), 'public/audio is missing: run the audio asset build (scripts/assets/audio/build.py)');
  // the dev server's cargo plugin reloads every page when a build finishes: wait for sim.wasm first
  await page.goto('/?test=1&render=none');
  await expect(page.getByTestId('sim-status')).toHaveText(/^sim\.wasm ABI/, { timeout: 180_000 });
  await page.goto(`/src/dev/audio.html${query}`);
  await page.waitForFunction(
    () => typeof (globalThis as unknown as { __audioDev?: unknown }).__audioDev === 'object',
  );
}

/** Headless Firefox here has no audio device: a realtime context never leaves 'suspended' (measured). */
const REALTIME = 'headless Firefox has no audio device on this host, so a realtime context never runs';

const status = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __audioDev: Dev }).__audioDev.audio.status());

test.describe('@audio', () => {
  test('starts under a gesture at 32 kHz, plays the program and the sounds, with a clean console', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName === 'firefox', REALTIME);
    const problems = watchConsole(page);
    await open(page);
    await page.getByTestId('unlock').click();
    await expect(page.getByTestId('audio-state')).toHaveText('running', { timeout: 20_000 });
    await page.click('#game');
    await expect.poll(async () => (await status(page)).piece, { timeout: 30_000 }).toBe('era1');
    for (const b of await page.locator('#sounds button').all()) await b.click();
    await page.click('#load');
    await expect.poll(async () => (await status(page)).sfx.loops, { timeout: 10_000 }).toBe(2);
    await page.click('#load');
    const s = await status(page);
    expect(s).toMatchObject({ state: 'running', mode: 'full', sampleRate: 32000, codec: 'ogg', dropped: 0 });
    expect(s.sfx.played).toBeGreaterThan(5);
    expect(s.errors).toEqual([]);
    await page.click('#end');
    expect(problems).toEqual([]);
  });

  test('a blocked AudioWorklet switches to reduced audio: native SFX, recorded music', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName === 'firefox', REALTIME);
    const problems = watchConsole(page);
    await page.addInitScript(() => {
      AudioWorklet.prototype.addModule = () => Promise.reject(new Error('AudioWorklet blocked by the test'));
    });
    await open(page);
    await page.getByTestId('unlock').click();
    await expect(page.getByTestId('audio-state')).toHaveText('running (reduced)', { timeout: 20_000 });
    await page.click('#game');
    await page.locator('#sounds button').first().click();
    await expect.poll(async () => (await status(page)).sfx.played, { timeout: 10_000 }).toBeGreaterThan(0);
    const s = await status(page);
    expect(s.mode).toBe('reduced');
    expect(problems.filter((p) => !p.includes('reduced audio: AudioWorklet blocked by the test'))).toEqual(
      [],
    );
  });

  test('an autoplay refusal leaves it blocked until the next gesture', async ({ page, browserName }) => {
    test.skip(browserName === 'firefox', REALTIME);
    const problems = watchConsole(page);
    // Chrome for Testing runs Web Audio without a user activation here, even headed (measured), so the
    // policy is simulated as browsers document it: before a trusted gesture a context stays suspended and
    // resume() does not take effect; a media element's play() rejects with NotAllowedError.
    await page.addInitScript(() => {
      let activated = false;
      const mark = (e: Event) => {
        if (e.isTrusted) activated = true;
      };
      addEventListener('pointerdown', mark, true);
      addEventListener('keydown', mark, true);
      const Orig = AudioContext;
      const resume = Orig.prototype.resume;
      class Gated extends Orig {
        constructor(o?: AudioContextOptions) {
          super(o);
          if (!activated) void Orig.prototype.suspend.call(this);
        }
        override resume(): Promise<void> {
          return activated ? resume.call(this) : new Promise<void>(() => {});
        }
      }
      (globalThis as unknown as { AudioContext: typeof AudioContext }).AudioContext = Gated;
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        return activated
          ? play.call(this)
          : Promise.reject(new DOMException('no activation', 'NotAllowedError'));
      };
      // a page script starts audio from a timer, outside any gesture
      setTimeout(() => (globalThis as unknown as { __audioDev?: Dev }).__audioDev?.audio.unlock(), 1500);
    });
    await open(page);
    await expect(page.getByTestId('audio-state')).toHaveText('blocked', { timeout: 10_000 });
    // the next gesture retries, and audio starts
    await page.getByTestId('unlock').click();
    await expect(page.getByTestId('audio-state')).toHaveText('running', { timeout: 20_000 });
    expect(problems).toEqual([]);
  });

  test('an offline render of the charter piece measures −18 LUFS ± 1.5 at 100 % music, without clipping or denormals', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await open(page);
    const r = await page.evaluate(() =>
      (globalThis as unknown as { __audioDev: Dev }).__audioDev.render({
        piece: 'era1',
        duration: 150,
        params: { seed: 1945, transpose: 0 },
        activity: 0.5,
        sampleRate: 48000,
      }),
    );
    expect(Math.abs(r.lufs + 18)).toBeLessThan(1.5);
    expect(r.peak).toBeLessThan(1);
    expect(r.denormals).toBe(0);
    expect(r.nonFinite).toBe(0);
    expect(r.dropped).toBe(0);
    expect(r.errors).toEqual([]);
  });

  test('every file decodes onto the canonical timeline, and every loop is seamless', async ({
    page,
    browserName,
  }) => {
    test.setTimeout(240_000);
    await open(page);
    // Firefox here has no AAC decoder (no system codec in its Playwright build); Ogg Opus everywhere
    for (const codec of browserName === 'chromium' ? ['ogg', 'm4a'] : ['ogg']) {
      const rows = await page.evaluate(
        (c) => (globalThis as unknown as { __audioDev: Dev }).__audioDev.decodeCheck(c),
        codec,
      );
      expect(rows.length).toBeGreaterThan(200);
      expect(rows.filter((r) => !r.ok)).toEqual([]);
      const loops = await page.evaluate(
        (c) => (globalThis as unknown as { __audioDev: Dev }).__audioDev.loopTest(c),
        codec,
      );
      expect(loops.length).toBe(2);
      for (const l of loops) expect(l.ok, `${codec} ${l.name}: seams ${l.seams} p99 ${l.p99}`).toBe(true);
    }
  });
});

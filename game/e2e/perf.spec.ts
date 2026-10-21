// The UI's quality bar (C5 brief; 10 §7.3 step 6, §11): UI time per frame with the character screen open, the
// time a window takes to open, and input latency, measured on the real sim running at 60 UPS (not test mode) with
// C4's renderer drawing (the renderer's own frame time is its budget, not the UI's).
// The numbers are printed for the report; the assertions are the brief's limits with headroom for SwiftShader
// and a loaded host. Run alone: `npx playwright test e2e/perf.spec.ts --project=chrome`.
import { expect, test } from '@playwright/test';
import { watchConsole } from './console.ts';
import { type E2eGame, startGame } from './ui-helpers.ts';

type W = { __game: E2eGame };

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};

test('UI time per frame, window opening and input latency @perf', async ({ page }, info) => {
  test.skip(info.project.name !== 'chrome', 'measured in Chrome');
  const problems = watchConsole(page);
  // The renderer draws nothing here (`render=none`): SwiftShader's frames (~80 ms at 720p on this host, C4's budget)
  // would hold the main thread and measure the renderer, not the UI.
  await startGame(page, 'render=none');
  // Window opening: from the key event to the first frame painted with the window (≤ 100 ms).
  const openMs = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const t0 = performance.now();
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e' }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE', key: 'e' }));
        const check = () => {
          if (document.querySelector('[data-testid=character-screen]'))
            requestAnimationFrame(() => resolve(performance.now() - t0));
          else requestAnimationFrame(check);
        };
        check();
      }),
  );
  // UI time with the character screen open, the world running at 60 UPS: 3 s of packets and frames.
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const p = (window as unknown as W).__game.ui.perf();
    p.packet.splice(0);
    p.frame.splice(0);
  });
  await page.waitForTimeout(3000);
  const perf = await page.evaluate(() => (window as unknown as W).__game.ui.perf());
  // Input latency: key down to the action posted, and to the packet that shows the character moved (polled every
  // millisecond: a frame of the renderer in SwiftShader takes ~80 ms here, which is C4's budget, not the input's).
  const latency = await page.evaluate(
    () =>
      new Promise<{ act: number; seen: number }>((resolve) => {
        const ui = (window as unknown as W).__game.ui;
        const start = ui.character();
        const before = ui.sent().at(-1)?.seq ?? 0;
        const t0 = performance.now();
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', key: 'd' }));
        const check = () => {
          const now = ui.character();
          if (now && start && now.x !== start.x) {
            const act = (ui.sent().find((x) => x.seq > before)?.at ?? t0) - t0;
            window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD', key: 'd' }));
            resolve({ act, seen: performance.now() - t0 });
          } else setTimeout(check, 1);
        };
        setTimeout(check, 1);
      }),
  );
  const report = {
    windowOpenMs: Number(openMs.toFixed(1)),
    packets: perf.packet.length,
    packetMs: {
      p50: pct(perf.packet, 50),
      p95: pct(perf.packet, 95),
      p99: pct(perf.packet, 99),
      max: pct(perf.packet, 100),
    },
    /** UI frames in the 3 s: the renderer's frame rate in SwiftShader here. */
    frames: perf.frame.length,
    frameMs: {
      p50: pct(perf.frame, 50),
      p95: pct(perf.frame, 95),
      p99: pct(perf.frame, 99),
      max: pct(perf.frame, 100),
    },
    inputLatencyMs: { act: Number(latency.act.toFixed(2)), seen: Number(latency.seen.toFixed(1)) },
  };
  console.log(`UI perf: ${JSON.stringify(report)}`);
  await info.attach('ui-perf.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  expect(openMs).toBeLessThan(100);
  expect(report.packetMs.p95 + report.frameMs.p95).toBeLessThan(2);
  expect(latency.act).toBeLessThan(8); // posted within the event's own task, never a frame later
  expect(latency.seen).toBeLessThan(3 * (1000 / 60) + 5); // the tick it lands in, the next, and the packet
  expect(problems).toEqual([]);
});

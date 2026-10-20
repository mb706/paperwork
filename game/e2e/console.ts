// Every E2E test fails on any console error or warning from the page or its workers (10 §10.5).
import type { Page } from '@playwright/test';

/**
 * Not the page's: headless Chrome here composites a WebGL canvas by reading its drawing buffer back from
 * SwiftShader, and ANGLE reports that readback as a performance warning (four times, then "will no longer repeat").
 * A trivial page that only clears a WebGL2 canvas gets the same four (C4, pm/reports/C4.md).
 */
const ENVIRONMENT = /GL Driver Message \(OpenGL, Performance, [A-Z_]+, High\): GPU stall due to ReadPixels/;

export function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !ENVIRONMENT.test(m.text()))
      problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('worker', (w) => {
    w.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') problems.push(`worker ${m.type()}: ${m.text()}`);
    });
  });
  return problems;
}

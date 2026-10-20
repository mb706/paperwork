// Every E2E test fails on any console error or warning from the page or its workers (10 §10.5).
import type { Page } from '@playwright/test';

export function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('worker', (w) => {
    w.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') problems.push(`worker ${m.type()}: ${m.text()}`);
    });
  });
  return problems;
}

// The bug report client (src/dev/report.ts; C8), and the M0 exit audit's #7 (C9): a trap's kept bundle counts as sent
// only once every file is acknowledged, and a retry sends it again whole under the same report id.
import { describe, expect, it } from 'vitest';
import type { BugBundle } from '../app/sim-host.ts';
import type { BuildManifest } from '../shared/protocol.ts';
import { type ReportDeps, sendReport } from './report.ts';

const bundle = { save: new Uint8Array([1]), log: new Uint8Array([2]), digests: new Uint8Array([3]) };

function host(lastReport: string | null) {
  let exports = 0;
  return {
    lastReport,
    lastTick: 53,
    exportBugBundle: async (): Promise<BugBundle> => {
      exports++;
      return { ...bundle, build: {} as BuildManifest, trap: null, saveName: 'auto-1', console: ['w'] };
    },
    get exports() {
      return exports;
    },
  };
}

function deps(failAt: number | null): ReportDeps & { urls: string[]; failAt: number | null } {
  const d = {
    urls: [] as string[],
    failAt,
    stored: async (name: string) =>
      name === 'trap-53'
        ? [
            { name: 'save.save', bytes: new Uint8Array([9]) },
            { name: 'closures.pwlog', bytes: new Uint8Array([8]) },
          ]
        : null,
    post: async (url: string) => {
      if (d.failAt !== null && d.urls.length === d.failAt) {
        d.failAt = null;
        throw new Error('network down');
      }
      d.urls.push(url);
      return { ok: true };
    },
    screenshot: async () => null,
  };
  return d;
}

describe('bug reports', () => {
  it("sends a trap's kept bundle again, whole and under the same id, after a failed upload", async () => {
    const h = host('trap-53');
    const d = deps(1);
    await expect(sendReport(h, 'first', d)).rejects.toThrow('network down');
    const sent = d.urls.length;
    expect(sent).toBe(1);
    const id = /^\/__report\/([^/]+)\//.exec(d.urls[0] as string)?.[1];
    // the retry: the trap's files again, the same id, still a trap report
    const r = await sendReport(h, 'retry', d);
    expect(r.trap).toBe(true);
    expect(r.id).toBe(id);
    expect(r.files).toEqual(['save.save', 'closures.pwlog', 'console.txt', 'client.json']);
    expect(d.urls.slice(sent).every((u) => u.startsWith(`/__report/${id}/`))).toBe(true);
    expect(h.exports).toBe(0);
    // once acknowledged, the next report is the session's own, under a new id
    const next = await sendReport(h, 'later', d);
    expect(next.trap).toBe(false);
    expect(next.id).not.toBe(id);
    expect(h.exports).toBe(1);
    expect(next.files).toEqual([
      'save.save',
      'closures.pwlog',
      'digests.bin',
      'report.json',
      'console.txt',
      'client.json',
    ]);
  });

  it('exports the session when no trap is kept', async () => {
    const h = host(null);
    const r = await sendReport(h, '', deps(null));
    expect(r.trap).toBe(false);
    expect(h.exports).toBe(1);
  });
});

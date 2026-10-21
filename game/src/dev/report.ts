// Bug reports and screenshots from the user's session (10 §3.5, §10.7 "The user's loop"; C8): the client side of the
// dev server's `POST /__report` and `POST /__shot` (scripts/dev-endpoints-plugin.ts). Installed with `__game`
// (dev builds and `?dev=1`):
//   Ctrl+Alt+F12 or `__game.report(note?)`  sends a bug bundle to bench/reports/<id>/: the last autosave (or the
//                                           world's start) as save.save, the closure log since it with its blobs
//                                           and digests (closures.pwlog), the digest ring (digests.bin), the
//                                           console (console.txt: the page's lines and the workers'), a screenshot
//                                           of the world from the user's GPU (screenshot.png), and client.json
//                                           (build hash, browser, GPU, screen, tick, the note). After a trap, the
//                                           trap's own bundle (kept in OPFS under reports/<name>/, §3.6) goes
//                                           instead of a new one. `simtool replay bench/reports/<id>` replays it.
//   `__game.shot(name?)`                    sends a screenshot of the world to bench/shots/.
// The in-game console's `/report` and `/shot` commands call the same functions once the console exists (I §4.19).
import type { SimHost } from '../app/sim-host.ts';

/** The page's console lines kept for a report. */
const CONSOLE_LINES = 500;
const lines: string[] = [];
let installed = false;

function keep(level: string, args: unknown[]): void {
  const text = args
    .map((a) => (typeof a === 'string' ? a : a instanceof Error ? (a.stack ?? a.message) : safeJson(a)))
    .join(' ');
  lines.push(`${new Date().toISOString()} ${level} ${text}`);
  if (lines.length > CONSOLE_LINES) lines.splice(0, lines.length - CONSOLE_LINES);
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/** Keeps the page's console (log, info, warn, error, uncaught errors) for reports; idempotent. */
export function captureConsole(): void {
  if (installed) return;
  installed = true;
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      keep(level, args);
      orig(...args);
    };
  }
  addEventListener('error', (e) => keep('uncaught', [e.message]));
  addEventListener('unhandledrejection', (e) => keep('unhandled', [String(e.reason)]));
}

/** The page's kept console lines (for tests). */
export function consoleLines(): readonly string[] {
  return lines;
}

interface RenderHooks {
  renderer: { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext | null } | null;
  frame(): void;
}

/** A PNG of the world canvas as the user's GPU draws it: a frame drawn now, read before it is presented. */
export async function worldScreenshot(): Promise<Uint8Array | null> {
  const r = (window as unknown as { __render?: RenderHooks }).__render;
  const canvas = r?.renderer?.canvas ?? document.querySelector('canvas');
  if (!canvas) return null;
  if (r?.renderer?.gl) r.frame();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** The GPU the world is drawn with (the renderer's own context; none with `?render=none`, so no probe warns). */
function gpu(): { vendor: string; renderer: string } | null {
  try {
    const gl = (window as unknown as { __render?: RenderHooks }).__render?.renderer?.gl;
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext
      ? {
          vendor: String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)),
          renderer: String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)),
        }
      : { vendor: String(gl.getParameter(gl.VENDOR)), renderer: String(gl.getParameter(gl.RENDERER)) };
  } catch {
    return null;
  }
}

/** A report id: the local time, then a random suffix (two reports in one second stay apart). */
function reportId(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const rand = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}-${rand}`;
}

async function post(
  url: string,
  body: Uint8Array | string,
): Promise<{ ok: boolean; file?: string; error?: string }> {
  const r = await fetch(url, { method: 'POST', body: typeof body === 'string' ? body : body.slice() });
  const j = (await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }))) as {
    ok: boolean;
    file?: string;
    error?: string;
  };
  if (!r.ok || !j.ok) throw new Error(`${url}: ${j.error ?? `HTTP ${r.status}`}`);
  return j;
}

/** A trap's bundle as the IO worker kept it in OPFS (`reports/<name>/`), or null. */
async function storedReport(name: string): Promise<{ name: string; bytes: Uint8Array }[] | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const reports = await root.getDirectoryHandle('reports');
    const dir = await reports.getDirectoryHandle(name);
    const out: { name: string; bytes: Uint8Array }[] = [];
    for await (const [file, h] of dir.entries() as AsyncIterable<[string, FileSystemHandle]>) {
      if (h.kind !== 'file') continue;
      const f = await (h as FileSystemFileHandle).getFile();
      out.push({ name: file, bytes: new Uint8Array(await f.arrayBuffer()) });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

export interface ReportResult {
  id: string;
  dir: string;
  files: string[];
  trap: boolean;
}

const sentTrapReports = new Set<string>();

/** Sends a bug report (see the header) and returns where it went. */
export async function sendReport(host: SimHost, note = ''): Promise<ReportResult> {
  const id = reportId();
  const files: { name: string; bytes: Uint8Array | string }[] = [];
  let trap = false;
  const stored =
    host.lastReport && !sentTrapReports.has(host.lastReport) ? await storedReport(host.lastReport) : null;
  let workerConsole: string[] = [];
  if (stored && host.lastReport) {
    sentTrapReports.add(host.lastReport);
    trap = true;
    for (const f of stored) files.push(f);
  } else {
    const b = await host.exportBugBundle();
    if (b.save) files.push({ name: 'save.save', bytes: b.save });
    files.push({ name: 'closures.pwlog', bytes: b.log }, { name: 'digests.bin', bytes: b.digests });
    files.push({
      name: 'report.json',
      bytes: `${JSON.stringify({ build: b.build, trap: b.trap, saveName: b.saveName, console: b.console }, null, 1)}\n`,
    });
    workerConsole = b.console;
  }
  const shot = await worldScreenshot().catch(() => null);
  if (shot) files.push({ name: 'screenshot.png', bytes: shot });
  files.push({
    name: 'console.txt',
    bytes: `${[...lines, ...workerConsole.map((l) => `worker ${l}`)].join('\n')}\n`,
  });
  const client = {
    id,
    note,
    time: new Date().toISOString(),
    url: location.href,
    userAgent: navigator.userAgent,
    gpu: gpu(),
    screen: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    tick: host.lastTick,
    trapReport: trap ? host.lastReport : null,
    files: files.map((f) => f.name),
  };
  files.push({ name: 'client.json', bytes: `${JSON.stringify(client, null, 1)}\n` });
  for (const f of files) await post(`/__report/${id}/${f.name}`, f.bytes);
  const result = { id, dir: `bench/reports/${id}`, files: files.map((f) => f.name), trap };
  console.info(`report ${id}: ${files.length} files sent to ${result.dir} (simtool replay ${result.dir})`);
  return result;
}

/** Sends a screenshot of the world to bench/shots/; returns its path. */
export async function sendShot(name = ''): Promise<string> {
  const png = await worldScreenshot();
  if (!png) throw new Error('no world canvas to capture');
  const r = await post(`/__shot${name ? `?name=${encodeURIComponent(name)}` : ''}`, png);
  console.info(`shot sent to ${r.file}`);
  return r.file as string;
}

/** Ctrl+Alt+F12 sends a report (10 §3.5); the key never reaches the game. */
export function installReportKey(host: SimHost): void {
  addEventListener(
    'keydown',
    (e) => {
      if (e.code !== 'F12' || !e.ctrlKey || !e.altKey || e.repeat) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      sendReport(host, 'Ctrl+Alt+F12').catch((err: unknown) =>
        console.error(`the report was not sent: ${err instanceof Error ? err.message : String(err)}`),
      );
    },
    { capture: true },
  );
}

// Static server for target/web with COOP/COEP (cross-origin isolation: 5 µs timers in Chrome, and
// SharedArrayBuffer for the threads experiment). The game itself does not need these headers (spec 10 §0 #6).
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
};

export function serve(root: string, port = 0, isolate = true): Promise<{ server: Server; port: number }> {
  const base = resolve(root);
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    let p = normalize(join(base, decodeURIComponent(url.pathname)));
    if (!p.startsWith(base)) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
    if (!existsSync(p)) {
      res.writeHead(404).end();
      return;
    }
    const h: Record<string, string> = { 'Content-Type': TYPES[extname(p)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' };
    if (isolate) {
      h['Cross-Origin-Opener-Policy'] = 'same-origin';
      h['Cross-Origin-Embedder-Policy'] = 'require-corp';
    }
    res.writeHead(200, h);
    createReadStream(p).pipe(res);
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok({ server, port: (server.address() as { port: number }).port })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { port } = await serve(process.argv[2] ?? 'target/web', Number(process.argv[3] ?? 5199));
  console.log(`serving on http://127.0.0.1:${port}/`);
}

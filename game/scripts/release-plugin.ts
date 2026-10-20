// Vite plugin: the release build's last steps and the preview server (10 §2.3, §9.7).
// Build: after every file is written, writes dist/data/build-manifest.json (buildHash over every served
// file, each file's SHA-256, the modules' hashes), then brotli (quality 11) and gzip (level 9) siblings
// of every text-like file. The siblings are encodings of the same resources, so the manifest and the
// build hash leave them out.
// Preview: serves a sibling by Accept-Encoding (as nginx's brotli_static would), with the cache policy of
// §9.7: hashed files immutable, index.html, build-manifest.json and sw.js `no-cache`.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, sep } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import type { Plugin } from 'vite';
import { PROTOCOL_VERSION, SCHEMA_HASH } from '../src/shared/gen/schema.ts';
import { MANIFEST_PATH, releaseManifest, writeManifest } from './build-manifest.ts';

/** Text-like files get compressed siblings (10 §9.7); KTX2, WebP, PNG, Opus, M4A and WOFF2 do not. */
export const TEXT_LIKE = new Set([
  '.js',
  '.mjs',
  '.css',
  '.html',
  '.json',
  '.wasm',
  '.svg',
  '.bin',
  '.map',
  '.txt',
  '.yaml',
]);
export const SIBLINGS = ['.br', '.gz'] as const;

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.bin': 'application/octet-stream',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** Writes `.br` and `.gz` siblings of every text-like file under `dir`; returns how many files. */
export function compressSiblings(dir: string): number {
  let n = 0;
  for (const p of walk(dir)) {
    if (!TEXT_LIKE.has(extname(p))) continue;
    const data = readFileSync(p);
    writeFileSync(
      `${p}.br`,
      brotliCompressSync(data, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length },
      }),
    );
    writeFileSync(`${p}.gz`, gzipSync(data, { level: 9 }));
    n++;
  }
  return n;
}

/** Hashed (content-addressed) names cache forever; the entry points revalidate (10 §9.7). */
export function cacheControl(path: string): string {
  if (
    path === '/' ||
    path.endsWith('/index.html') ||
    path.endsWith(`/${MANIFEST_PATH}`) ||
    path.endsWith('/sw.js')
  )
    return 'no-cache';
  if (/[.-][0-9a-zA-Z_-]{8,}\.[a-z0-9]+$/.test(path) && path.startsWith('/assets/'))
    return 'public, max-age=31536000, immutable';
  return 'no-cache';
}

export interface ReleasePluginOptions {
  root: string;
  /** The build's capability manifest (`m0`, …), recorded in the manifest. */
  build: string;
}

export function releasePlugin({ root, build }: ReleasePluginOptions): Plugin {
  let command: 'serve' | 'build' = 'serve';
  return {
    name: 'paperwork:release',
    configResolved(config) {
      command = config.command;
    },
    closeBundle: {
      order: 'post',
      handler() {
        if (command !== 'build') return;
        const dist = join(root, 'dist');
        const m = releaseManifest(dist, {
          schemaHash: SCHEMA_HASH,
          protocolVersion: PROTOCOL_VERSION,
          build,
        });
        writeManifest(join(dist, MANIFEST_PATH), m);
        const n = compressSiblings(dist);
        this.info?.(
          `build-manifest.json: ${m.assets.length} files, buildHash ${m.buildHash.slice(0, 16)}…; brotli and gzip siblings for ${n} files`,
        );
      },
    },
    configurePreviewServer(server) {
      const dist = join(root, 'dist');
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '/').split('?')[0] as string);
        res.setHeader('Cache-Control', cacheControl(url));
        const rel = url === '/' ? 'index.html' : url.slice(1);
        const file = join(dist, rel);
        if (!file.startsWith(dist + sep) || !existsSync(file) || !statSync(file).isFile()) return next();
        const accept = String(req.headers['accept-encoding'] ?? '');
        for (const [enc, ext] of [
          ['br', '.br'],
          ['gzip', '.gz'],
        ] as const) {
          if (!new RegExp(`\\b${enc}\\b`).test(accept) || !existsSync(file + ext)) continue;
          res.setHeader('Content-Encoding', enc);
          res.setHeader('Vary', 'Accept-Encoding');
          res.setHeader('Content-Type', CONTENT_TYPES[extname(file)] ?? 'application/octet-stream');
          res.end(readFileSync(file + ext));
          return;
        }
        next();
      });
    },
  };
}

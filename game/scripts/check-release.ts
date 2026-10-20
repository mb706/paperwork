// Checks a finished release bundle (10 §2.3, §9.7; C1a-r1 finding 12): build-manifest.json names both
// WebAssembly modules and the data stage's contents; every listed file exists with its SHA-256; the build
// hash recomputes; every text-like file has brotli and gzip siblings that decompress to it, and nothing
// else has any.
//
// Usage: node scripts/check-release.ts [dist]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { type BuildManifest, MANIFEST_PATH } from './build-manifest.ts';
import { compareCodeUnits } from './lib/canonical.ts';
import { sha256Hex } from './lib/hash.ts';
import { TEXT_LIKE } from './release-plugin.ts';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

export function checkRelease(dist: string): string[] {
  const problems: string[] = [];
  const mpath = join(dist, MANIFEST_PATH);
  if (!existsSync(mpath)) return [`${MANIFEST_PATH} is missing`];
  const m = JSON.parse(readFileSync(mpath, 'utf8')) as BuildManifest;
  if (m.dev) problems.push('the manifest says dev: true');
  for (const k of ['sim', 'gen']) if (!m.modules[k]) problems.push(`the manifest names no ${k}.wasm`);
  if (!m.contents || m.contents.meta.length === 0)
    problems.push('the manifest does not say what prototypes.bin carries');
  const files = walk(dist)
    .map((p) => relative(dist, p).split(sep).join('/'))
    .filter((p) => p !== MANIFEST_PATH && !p.endsWith('.br') && !p.endsWith('.gz'))
    .sort(compareCodeUnits);
  const listed = new Map(m.assets.map((a) => [a.path, a.sha256]));
  for (const f of files) {
    const want = listed.get(f);
    const have = sha256Hex(readFileSync(join(dist, f)));
    if (want === undefined) problems.push(`${f} is served but not listed`);
    else if (want !== have)
      problems.push(`${f}: SHA-256 ${have.slice(0, 12)}… differs from the manifest's ${want.slice(0, 12)}…`);
  }
  for (const a of m.assets) if (!files.includes(a.path)) problems.push(`${a.path} is listed but missing`);
  const listing = m.assets.map((a) => `${a.sha256}  ${a.path}\n`).join('');
  if (sha256Hex(listing) !== m.buildHash) problems.push('buildHash does not match the listing');
  for (const [k, h] of Object.entries(m.modules)) {
    const f = files.find((p) => new RegExp(`^assets/${k}-[^/]*\\.wasm$`).test(p));
    if (!f || listed.get(f) !== h) problems.push(`${k}.wasm's hash does not match a served module`);
  }
  for (const f of [...files, MANIFEST_PATH]) {
    const raw = readFileSync(join(dist, f));
    const text = TEXT_LIKE.has(extname(f));
    for (const [ext, decode] of [
      ['.br', brotliDecompressSync],
      ['.gz', gunzipSync],
    ] as const) {
      const sib = join(dist, f + ext);
      if (!text) {
        if (existsSync(sib)) problems.push(`${f}${ext}: ${extname(f)} files are compressed already`);
        continue;
      }
      if (!existsSync(sib)) problems.push(`${f}${ext} is missing`);
      else if (!decode(readFileSync(sib)).equals(raw))
        problems.push(`${f}${ext} does not decompress to ${f}`);
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = process.argv[2] ?? join(fileURLToPath(new URL('..', import.meta.url)), 'dist');
  const problems = checkRelease(dist);
  for (const p of problems) console.error(`check-release: ${p}`);
  console.log(`check-release: ${problems.length === 0 ? 'ok' : `${problems.length} problem(s)`}`);
  process.exitCode = problems.length === 0 ? 0 : 1;
}

// build-manifest.json (10 §2.3, §15.2): what a build is made of, so that saves, checkpoints and
// multiplayer handshakes can refuse a mismatch (D14).
//   buildHash: release builds, the SHA-256 of the sorted listing "<sha256>  <path>\n" of every served file
//              in dist/ except the manifest (compressed .br and .gz siblings are encodings of those files,
//              not files of their own); dev builds, the SHA-256 of the raw 32-byte hashes of sim.wasm,
//              gen.wasm, prototypes.bin and the schema, concatenated in that order (zeros for a module
//              not built yet), with `dev: true`.
//   assets: every served file with its SHA-256 (10 §2.3, §9.7), sorted by path.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { canonicalJson, compareCodeUnits } from './lib/canonical.ts';
import { fromHex, sha256Hex, ZERO_HASH_HEX } from './lib/hash.ts';

export interface BuildManifest {
  buildHash: string;
  dev: boolean;
  protocolVersion: number;
  schemaHash: string;
  prototypesHash: string;
  /** The build's capability manifest or build filter (`m0`, …). */
  build: string;
  /** SHA-256 of each WebAssembly module, by name (`sim`, `gen`). */
  modules: Record<string, string>;
  /** Release builds: every served file in dist/ (the manifest excluded) with its SHA-256, by path. */
  assets: { path: string; sha256: string }[];
  /**
   * What prototypes.bin carries and omits (scripts/data-stage/emit/contents.ts): a consumer refuses a build
   * that lacks what it needs.
   */
  contents: { meta: string[]; omitted: string[] };
}

export const MANIFEST_PATH = 'data/build-manifest.json';

export function devBuildHash(
  modules: Record<string, string>,
  prototypesHash: string,
  schemaHash: string,
): string {
  const parts = [modules.sim ?? ZERO_HASH_HEX, modules.gen ?? ZERO_HASH_HEX, prototypesHash, schemaHash];
  const bytes = new Uint8Array(32 * parts.length);
  parts.forEach((h, i) => {
    bytes.set(fromHex(h), 32 * i);
  });
  return sha256Hex(bytes);
}

export function devManifest(input: {
  modules: Record<string, string>;
  prototypesHash: string;
  schemaHash: string;
  protocolVersion: number;
  build: string;
  contents: BuildManifest['contents'];
}): BuildManifest {
  return {
    buildHash: devBuildHash(input.modules, input.prototypesHash, input.schemaHash),
    dev: true,
    protocolVersion: input.protocolVersion,
    schemaHash: input.schemaHash,
    prototypesHash: input.prototypesHash,
    build: input.build,
    modules: input.modules,
    assets: [],
    contents: input.contents,
  };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (statSync(p).isFile()) out.push(p);
  }
  return out;
}

/** The release manifest of a finished dist/ directory. */
export function releaseManifest(
  distDir: string,
  input: { schemaHash: string; protocolVersion: number; build: string; contents: BuildManifest['contents'] },
): BuildManifest {
  const files = walk(distDir)
    .map((p) => relative(distDir, p).split(sep).join('/'))
    .filter((p) => p !== MANIFEST_PATH && !p.endsWith('.br') && !p.endsWith('.gz'))
    .sort(compareCodeUnits);
  const hashes = new Map(files.map((f) => [f, sha256Hex(readFileSync(join(distDir, f)))]));
  const listing = files.map((f) => `${hashes.get(f)}  ${f}\n`).join('');
  const modules: Record<string, string> = {};
  for (const f of files) {
    const m = /^assets\/(sim|gen)-[^/]*\.wasm$/.exec(f);
    if (m) modules[m[1] as string] = hashes.get(f) as string;
  }
  const protos = 'data/prototypes.bin';
  return {
    buildHash: sha256Hex(listing),
    dev: false,
    protocolVersion: input.protocolVersion,
    schemaHash: input.schemaHash,
    prototypesHash: hashes.get(protos) ?? ZERO_HASH_HEX,
    build: input.build,
    modules,
    assets: files.map((path) => ({ path, sha256: hashes.get(path) as string })),
    contents: input.contents,
  };
}

export function manifestText(m: BuildManifest): string {
  return canonicalJson(m);
}

export function writeManifest(path: string, m: BuildManifest): void {
  writeFileSync(path, manifestText(m));
}

/** The dev modules' hashes, where they have been built (target/wasm32-unknown-unknown/wasmdev). */
export function devModuleHashes(gameDir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, crate] of [
    ['sim', 'simabi'],
    ['gen', 'genabi'],
  ] as const) {
    const p = join(gameDir, 'target', 'wasm32-unknown-unknown', 'wasmdev', `${crate}.wasm`);
    if (existsSync(p)) out[name] = sha256Hex(readFileSync(p));
  }
  return out;
}

// check-arch (10 §2.2, §2.5, §4.1): the architecture rules that TypeScript and cargo cannot enforce alone.
//
//  1. Import boundaries between the TypeScript layers of src/ (10 §2.2), and the packages each may use.
//  2. Threads and memory: only src/app/ (and src/dev/) creates workers; only the worker shells touch
//     WebAssembly; no SharedArrayBuffer or Atomics anywhere (10 §0 #6).
//  3. Determinism bans (D14, 10 §2.5): where TypeScript must produce identical bytes on every machine
//     (the data stage, the schema generator, their libraries, src/shared/) no Math.random, transcendental
//     Math functions, Math.pow or **, Date, performance, Intl or locale-dependent string functions, and
//     in emitters no unordered object-key iteration or JSON.stringify. The worker shells get the same
//     bans except the clock, which pacing needs (10 §3.3).
//  4. Generated files: every file in src/shared/gen/, crates/schema/src/ and crates/sim/src/gen/ carries
//     a valid `@generated` header whose content hash matches, so hand edits fail (10 §15.1).
//  5. The crate graph (10 §2.2): each crate depends only on the crates its job allows, the four pure
//     crates forbid unsafe code, and det, worldgen and sim do no I/O (10 §2.5; clippy.toml bans their
//     clock and threads).
//
// A line may opt out of one rule with a comment on the line before: `// check-arch-ignore <rule>: <reason>`.
//
// Usage: node scripts/check-arch.ts [--no-cargo]
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync } from 'oxc-parser';
import { GENERATED_DIRS, headerProblem } from './lib/generated.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const LAYERS = [
  'shared',
  'simworker',
  'genworker',
  'ioworker',
  'assets',
  'render',
  'ui',
  'audio',
  'app',
  'dev',
  'net',
  'relay',
] as const;
type Layer = (typeof LAYERS)[number];

/** Which layers each layer may import (10 §2.2). */
const LAYER_IMPORTS: Record<Layer, readonly Layer[]> = {
  shared: ['shared'],
  simworker: ['simworker', 'shared'],
  genworker: ['genworker', 'shared'],
  ioworker: ['ioworker', 'shared'],
  assets: ['assets', 'shared'],
  render: ['render', 'shared'],
  ui: ['ui', 'shared'],
  audio: ['audio', 'shared'],
  net: ['net', 'shared'],
  relay: ['relay', 'shared'],
  // app wires threads and layers together: the main thread's entry and the worker entries (src/app/workers/);
  // it hands the asset loader's textures to the renderer and its samples to audio (10 §2.2).
  app: [
    'app',
    'shared',
    'simworker',
    'genworker',
    'ioworker',
    'assets',
    'render',
    'ui',
    'audio',
    'net',
    'dev',
  ],
  dev: [
    'dev',
    'app',
    'shared',
    'simworker',
    'genworker',
    'ioworker',
    'assets',
    'render',
    'ui',
    'audio',
    'net',
  ],
};

/** Packages each layer may import; '*' allows any. Node built-ins only where code runs in Node. */
const LAYER_PACKAGES: Record<Layer, readonly string[] | '*'> = {
  shared: [],
  simworker: ['virtual:sim-wasm', 'virtual:gen-wasm'],
  genworker: ['virtual:gen-wasm'],
  ioworker: ['fflate', 'idb'],
  assets: [],
  render: [],
  ui: ['solid-js', 'solid-js/web', 'solid-js/store'],
  audio: [],
  net: [],
  relay: ['ws', 'node:*'],
  app: ['solid-js', 'solid-js/web', 'virtual:sim-wasm', 'virtual:gen-wasm'],
  dev: '*',
};
const TEST_PACKAGES = ['vitest', 'fast-check', 'fake-indexeddb', 'fake-indexeddb/auto', 'node:*'];

/** Where TypeScript must produce identical bytes (D14, 10 §2.5). */
const BYTES_PATHS = [
  'scripts/data-stage.ts',
  'scripts/data-stage/',
  'scripts/schema-gen.ts',
  'scripts/schema-gen/',
  'scripts/lib/',
  'src/shared/',
];
/** Emitters: no unordered object-key iteration, no JSON.stringify (use scripts/lib/canonical.ts). */
const EMITTER_PATHS = ['scripts/data-stage/emit/', 'scripts/schema-gen.ts', 'scripts/schema-gen/'];
/** The worker shells: the same bans, but the clock is allowed (pacing, 10 §3.3). */
const WORKER_PATHS = ['src/simworker/', 'src/genworker/', 'src/ioworker/'];

const MATH_BANNED = new Set([
  'random',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sinh',
  'cosh',
  'tanh',
  'asinh',
  'acosh',
  'atanh',
  'exp',
  'expm1',
  'log',
  'log1p',
  'log2',
  'log10',
  'cbrt',
  'hypot',
  'pow',
]);
const LOCALE_METHODS = new Set([
  'localeCompare',
  'toLocaleString',
  'toLocaleDateString',
  'toLocaleTimeString',
  'toLocaleUpperCase',
  'toLocaleLowerCase',
]);
const RANDOM_METHODS = new Set([
  'getRandomValues',
  'randomUUID',
  'randomBytes',
  'randomInt',
  'randomFill',
  'randomFillSync',
]);
const CLOCK_GLOBALS = new Set(['Date', 'performance']);
/** WebAssembly members that only compile (the main thread compiles each module once per page, 10 §2.3). */
const WASM_COMPILE = new Set(['compile', 'compileStreaming', 'validate', 'Module']);

/**
 * Where WebAssembly may be used: `instance` (instantiate and touch memory: the sim and worldgen worker
 * shells, and the asset worker for the KTX2 transcoder), `compile` (compile only: app/ and dev/), or none.
 */
function wasmScope(file: string): 'instance' | 'compile' | null {
  if (file.startsWith('src/simworker/') || file.startsWith('src/genworker/')) return 'instance';
  if (file === 'src/assets/worker.ts' || file.startsWith('src/assets/worker/')) return 'instance';
  if (file.startsWith('src/app/') || file.startsWith('src/dev/')) return 'compile';
  return null;
}

export interface Violation {
  file: string;
  line: number;
  col: number;
  rule: string;
  message: string;
}

const under = (file: string, prefixes: readonly string[]) =>
  prefixes.some((p) => (p.endsWith('/') ? file.startsWith(p) : file === p));
const isTest = (file: string) =>
  /\.test\.tsx?$/.test(file) ||
  file.startsWith('test/') ||
  file.startsWith('e2e/') ||
  file.startsWith('bench/');

function layerOf(file: string): Layer | null {
  const m = /^src\/([a-z]+)\//.exec(file);
  return m && (LAYERS as readonly string[]).includes(m[1] as string) ? (m[1] as Layer) : null;
}

function packageAllowed(spec: string, allowed: readonly string[] | '*'): boolean {
  if (allowed === '*') return true;
  return allowed.some((a) =>
    a.endsWith(':*') ? spec.startsWith(a.slice(0, -1)) : spec === a || spec.startsWith(`${a}/`),
  );
}

function lineCol(src: string, offset: number): { line: number; col: number } {
  let line = 1;
  let last = -1;
  for (let i = 0; i < offset; i++) {
    if (src.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  }
  return { line, col: offset - last };
}

interface AstNode {
  type: string;
  start: number;
  end: number;
  [k: string]: unknown;
}

/** TypeScript-only subtrees hold no runtime code, so the bans skip them. */
const TYPE_ONLY =
  /^TS(?!AsExpression|SatisfiesExpression|NonNullExpression|InstantiationExpression|TypeAssertion|EnumDeclaration|ParameterProperty|ExportAssignment)/;

function walk(
  node: unknown,
  visit: (n: AstNode, parent: AstNode | null, key: string) => void,
  parent: AstNode | null = null,
  key = '',
): void {
  if (Array.isArray(node)) {
    for (const x of node) walk(x, visit, parent, key);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const n = node as AstNode;
  if (typeof n.type !== 'string') return;
  if (TYPE_ONLY.test(n.type)) return;
  visit(n, parent, key);
  for (const k of Object.keys(n)) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'range' || k === 'loc') continue;
    const v = n[k];
    if (v && typeof v === 'object') walk(v, visit, n, k);
  }
}

/** Checks one TypeScript file's source. Exported for tests. */
export function checkSource(file: string, src: string): Violation[] {
  const out: Violation[] = [];
  const lines = src.split('\n');
  const report = (offset: number, rule: string, message: string): void => {
    const { line, col } = lineCol(src, offset);
    const prev = lines[line - 2] ?? '';
    if (new RegExp(`check-arch-ignore ${rule}\\b`).test(prev)) return;
    out.push({ file, line, col, rule, message });
  };
  const parsed = parseSync(file, src, { sourceType: 'module' });
  for (const e of parsed.errors) out.push({ file, line: 1, col: 1, rule: 'parse', message: e.message });
  const layer = layerOf(file);
  const test = isTest(file);
  const bytes = !test && under(file, BYTES_PATHS);
  const emitter = !test && under(file, EMITTER_PATHS);
  const worker = !test && under(file, WORKER_PATHS);

  const dependency = (spec: string, offset: number): void => {
    const bare = spec.split('?')[0] as string;
    if (bare.startsWith('.') || bare.startsWith('/')) {
      const target = relative(ROOT, resolve(ROOT, dirname(file), bare))
        .split(sep)
        .join('/');
      if (!layer) return;
      if (!target.startsWith('src/')) {
        if (!(test && (target.startsWith('test/') || target.startsWith('scripts/'))))
          report(offset, 'layer-import', `src/${layer}/ may not import ${target}: outside src/`);
        return;
      }
      const to = layerOf(target);
      if (to && !LAYER_IMPORTS[layer].includes(to))
        report(offset, 'layer-import', `src/${layer}/ may not import src/${to}/ (10 §2.2)`);
      return;
    }
    if (!layer) return;
    const allowed = LAYER_PACKAGES[layer];
    if (packageAllowed(bare, allowed) || (test && packageAllowed(bare, TEST_PACKAGES))) return;
    report(offset, 'package-import', `src/${layer}/ may not import ${bare}`);
  };

  walk(parsed.program, (n, parent, key) => {
    switch (n.type) {
      case 'ImportDeclaration':
      case 'ExportAllDeclaration':
      case 'ExportNamedDeclaration': {
        const s = n.source as AstNode & { value?: string };
        if (s && typeof s.value === 'string') dependency(s.value, s.start);
        if (bytes && n.type === 'ImportDeclaration') {
          for (const sp of (n.specifiers as AstNode[]) ?? []) {
            const imported = (sp.imported as { name?: string } | undefined)?.name;
            if (imported && RANDOM_METHODS.has(imported))
              report(
                sp.start,
                'determinism',
                `${imported}: no randomness where output bytes must be identical (D14)`,
              );
          }
        }
        break;
      }
      case 'ImportExpression': {
        const s = n.source as AstNode & { value?: string };
        if (s?.type === 'Literal' && typeof s.value === 'string') dependency(s.value, s.start);
        break;
      }
      case 'NewExpression': {
        const callee = n.callee as AstNode & { name?: string };
        if (callee.type === 'Identifier' && (callee.name === 'Worker' || callee.name === 'SharedWorker')) {
          if (layer && layer !== 'app' && layer !== 'dev')
            report(
              n.start,
              'threads',
              `only src/app/ creates workers (10 §2.2); found new ${callee.name} in src/${layer}/`,
            );
        }
        if (callee.type === 'Identifier' && callee.name === 'URL') {
          const [a0, a1] = (n.arguments as AstNode[]) ?? [];
          const lit = a0 as (AstNode & { value?: unknown }) | undefined;
          const meta = a1 as (AstNode & { object?: AstNode & { meta?: { name?: string } } }) | undefined;
          if (lit?.type === 'Literal' && typeof lit.value === 'string' && meta?.type === 'MemberExpression')
            dependency(lit.value, lit.start);
        }
        break;
      }
      case 'Identifier': {
        const name = n.name as string;
        const isProperty =
          parent?.type === 'MemberExpression' && key === 'property' && !(parent.computed as boolean);
        const isKey =
          (parent?.type === 'Property' ||
            parent?.type === 'PropertyDefinition' ||
            parent?.type === 'MethodDefinition') &&
          key === 'key';
        if (isProperty || isKey) break;
        if (layer && (name === 'SharedArrayBuffer' || name === 'Atomics'))
          report(n.start, 'shared-memory', `${name}: no shared memory between threads (10 §0 #6)`);
        const asObject = parent?.type === 'MemberExpression' && key === 'object';
        if (layer && name === 'WebAssembly' && !asObject && !test && wasmScope(file) !== 'instance')
          report(
            n.start,
            'linear-memory',
            `only the worker shells instantiate WebAssembly and touch its memory (IMPL-1 rule 4); found in src/${layer}/`,
          );
        if ((bytes || worker) && name === 'Intl')
          report(n.start, 'determinism', 'Intl is locale-dependent (D14, D17)');
        if (bytes && CLOCK_GLOBALS.has(name))
          report(n.start, 'determinism', `${name}: no clock where output bytes must be identical (D14)`);
        break;
      }
      case 'MemberExpression': {
        const obj = n.object as AstNode & { name?: string };
        const prop = n.property as AstNode & { name?: string };
        if (n.computed) break;
        if (layer && !test && obj.type === 'Identifier' && obj.name === 'WebAssembly') {
          const scope = wasmScope(file);
          if (scope === null || (scope === 'compile' && !WASM_COMPILE.has(prop.name ?? '')))
            report(
              n.start,
              'linear-memory',
              `WebAssembly.${prop.name}: only the sim, worldgen and asset workers instantiate modules and touch their memory; the main thread only compiles (IMPL-1 rule 4, 10 §2.3)`,
            );
        }
        if (!(bytes || worker)) break;
        if (obj.type === 'Identifier' && obj.name === 'Math' && prop.name && MATH_BANNED.has(prop.name))
          report(
            n.start,
            'determinism',
            `Math.${prop.name} is not bit-identical across engines (or not deterministic): use explicit arithmetic (D14)`,
          );
        if (prop.name && LOCALE_METHODS.has(prop.name))
          report(prop.start, 'determinism', `${prop.name} depends on the locale (D17): compare code units`);
        if (prop.name && RANDOM_METHODS.has(prop.name))
          report(prop.start, 'determinism', `${prop.name}: no randomness here (D14)`);
        if (
          emitter &&
          obj.type === 'Identifier' &&
          obj.name === 'Object' &&
          prop.name &&
          ['keys', 'values', 'entries'].includes(prop.name)
        )
          report(
            n.start,
            'emitter-order',
            `Object.${prop.name} in an emitter: iterate sortedKeys/sortedEntries (scripts/lib/canonical.ts)`,
          );
        if (emitter && obj.type === 'Identifier' && obj.name === 'JSON' && prop.name === 'stringify')
          report(
            n.start,
            'emitter-order',
            'JSON.stringify in an emitter: use canonicalJson (scripts/lib/canonical.ts)',
          );
        break;
      }
      case 'BinaryExpression':
        if ((bytes || worker) && n.operator === '**')
          report(n.start, 'determinism', '** is Math.pow: use repeated multiplication (D14)');
        break;
      case 'AssignmentExpression':
        if ((bytes || worker) && n.operator === '**=')
          report(n.start, 'determinism', '**= is Math.pow: use repeated multiplication (D14)');
        break;
      case 'ForInStatement':
        if (emitter)
          report(
            n.start,
            'emitter-order',
            'for…in in an emitter: iterate sortedKeys (scripts/lib/canonical.ts)',
          );
        break;
    }
  });
  return out;
}

function files(dir: string, exts: RegExp): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'target' || e.name === 'dist' || e.name.startsWith('.'))
      continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p, exts));
    else if (exts.test(e.name)) out.push(p);
  }
  return out;
}

/** Allowed dependencies per crate (10 §2.2). New crates need a reason in a report (10 §2.1). */
const CRATE_DEPS: Record<string, readonly string[]> = {
  schema: [],
  det: ['libm'],
  worldgen: ['det', 'schema'],
  sim: ['det', 'schema', 'worldgen'],
  simabi: ['sim', 'schema', 'det'],
  genabi: ['worldgen', 'schema', 'det'],
  simtool: ['sim', 'schema', 'det', 'worldgen'],
};
const DEV_DEPS = ['proptest'];
const PURE_CRATES = ['schema', 'det', 'worldgen', 'sim'];

function checkCrates(): Violation[] {
  const out: Violation[] = [];
  const v = (file: string, message: string, rule = 'crate-graph') =>
    out.push({ file, line: 1, col: 1, rule, message });
  let meta: {
    packages: {
      name: string;
      manifest_path: string;
      dependencies: { name: string; kind: string | null }[];
    }[];
  };
  try {
    meta = JSON.parse(
      execFileSync('cargo', ['metadata', '--format-version', '1', '--no-deps', '--offline', '--locked'], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  } catch (e) {
    v('Cargo.toml', `cargo metadata failed: ${(e as Error).message.split('\n')[0]}`);
    return out;
  }
  for (const p of meta.packages) {
    const file = relative(ROOT, p.manifest_path).split(sep).join('/');
    const allowed = CRATE_DEPS[p.name];
    if (!allowed) {
      v(
        file,
        `crate ${p.name} is not in check-arch's crate graph (10 §2.2): add it with its allowed dependencies`,
      );
      continue;
    }
    for (const d of p.dependencies) {
      const ok =
        d.kind === 'dev'
          ? allowed.includes(d.name) || DEV_DEPS.includes(d.name) || d.name in CRATE_DEPS
          : allowed.includes(d.name);
      if (!ok)
        v(
          file,
          `${p.name} may not depend on ${d.name} (10 §2.2: ${p.name} → ${allowed.join(', ') || 'nothing'})`,
        );
    }
  }
  for (const c of PURE_CRATES) {
    const lib = join(ROOT, 'crates', c, 'src', 'lib.rs');
    if (!existsSync(lib) || !readFileSync(lib, 'utf8').includes('#![forbid(unsafe_code)]'))
      v(`crates/${c}/src/lib.rs`, `${c} must declare #![forbid(unsafe_code)] (10 §2.2)`, 'unsafe');
  }
  return out;
}

/** I/O, environment and process access, which det, worldgen and sim never use (10 §2.5, D13, D19). */
const RUST_IO = /\bstd::(fs|net|env|process|io::(stdin|stdout|stderr))\b/g;

/** Scans the pure crates' sources (not their tests) for I/O. Exported for tests. */
export function checkRustSource(file: string, src: string): Violation[] {
  const out: Violation[] = [];
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    for (const m of code.matchAll(RUST_IO))
      out.push({
        file,
        line: i + 1,
        col: (m.index ?? 0) + 1,
        rule: 'rust-io',
        message: `${m[0]}: no I/O in det, worldgen or sim (10 §2.5); the host does it`,
      });
  });
  return out;
}

function checkRustIo(): Violation[] {
  const out: Violation[] = [];
  for (const c of ['det', 'worldgen', 'sim']) {
    for (const abs of files(join(ROOT, 'crates', c, 'src'), /\.rs$/)) {
      const file = relative(ROOT, abs).split(sep).join('/');
      out.push(...checkRustSource(file, readFileSync(abs, 'utf8')));
    }
  }
  return out;
}

function checkGenerated(): Violation[] {
  const out: Violation[] = [];
  for (const dir of GENERATED_DIRS) {
    for (const abs of files(join(ROOT, dir), /.*/)) {
      const file = relative(ROOT, abs).split(sep).join('/');
      const problem = headerProblem(readFileSync(abs, 'utf8'));
      if (problem)
        out.push({
          file,
          line: 1,
          col: 1,
          rule: 'generated',
          message: `${problem} (written only by scripts/schema-gen.ts or scripts/data-stage.ts)`,
        });
    }
  }
  return out;
}

function main(): number {
  const started = performance.now();
  const ts = [
    ...['src', 'scripts', 'test', 'e2e', 'bench'].flatMap((d) => files(join(ROOT, d), /\.tsx?$/)),
    ...readdirSync(ROOT)
      .filter((f) => /\.config\.ts$/.test(f) && statSync(join(ROOT, f)).isFile())
      .map((f) => join(ROOT, f)),
  ];
  const violations: Violation[] = [];
  for (const abs of ts) {
    const file = relative(ROOT, abs).split(sep).join('/');
    violations.push(...checkSource(file, readFileSync(abs, 'utf8')));
  }
  violations.push(...checkGenerated());
  violations.push(...checkRustIo());
  if (!process.argv.includes('--no-cargo')) violations.push(...checkCrates());
  for (const x of violations) console.error(`${x.file}:${x.line}:${x.col}: [${x.rule}] ${x.message}`);
  const ms = Math.round(performance.now() - started);
  console.log(`check-arch: ${ts.length} TypeScript files, ${violations.length} violation(s) in ${ms} ms`);
  return violations.length === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();

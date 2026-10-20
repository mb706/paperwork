// The TypeScript rules of check-arch (10 §2.2, §2.5, §4.1).
//
// Layers: the import boundaries of 10 §2.2 and the packages each layer may use. Every import's target is
// static: a dynamic import(), require() or worker URL with a computed specifier is refused, and constant
// template literals count as static (C1a-r1 finding 9).
//
// Determinism (D14; C1a-r1 finding 8). In deterministic modules (the data stage, the schema generator,
// their libraries, src/shared/; the worker shells without the clock bans) the bans see through aliases:
//   - a global is resolved whether named directly or through globalThis, self, window or global, with a
//     static key (`Math.random`, `Math['random']`, `globalThis.Math.random`);
//   - Math may only be used as `Math.<allowed>`: a dynamic key, destructuring or passing Math around is
//     refused, as are dynamic keys on the global object and value uses of it;
//   - Date and performance (not in the worker shells), Intl and crypto randomness are refused in any form;
//   - no dynamic import(), require(), eval or Function; no randomness imported or re-exported by name, no
//     whole built-in module re-exported, no dynamic key on an imported namespace;
//   - a deterministic module imports only deterministic modules and allow-listed packages, so the bans
//     hold for everything it runs.
// Emitters additionally may not iterate object keys or use JSON.stringify (canonical order, D14).
import { dirname, relative, resolve, sep } from 'node:path';
import { parseSync } from 'oxc-parser';
import { lineCol, ROOT, type Violation } from './common.ts';

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
export const BYTES_PATHS = [
  'scripts/data-stage.ts',
  'scripts/data-stage/',
  'scripts/schema-gen.ts',
  'scripts/schema-gen/',
  'scripts/build-manifest.ts',
  'scripts/lib/',
  'src/shared/',
];
/** Emitters: no unordered object-key iteration, no JSON.stringify (use scripts/lib/canonical.ts). */
const EMITTER_PATHS = ['scripts/data-stage/emit/', 'scripts/schema-gen.ts', 'scripts/schema-gen/'];
/** The worker shells: the same bans, but the clock is allowed (pacing, 10 §3.3). */
const WORKER_PATHS = ['src/simworker/', 'src/genworker/', 'src/ioworker/'];
/** Packages a deterministic module may import besides Node's built-ins (reviewed: pure, no randomness). */
const DETERMINISTIC_PACKAGES = ['yaml', 'zod'];

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
/** The objects through which every global is reachable. */
const GLOBAL_OBJECTS = new Set(['globalThis', 'self', 'window', 'global']);
/** The globals the rules care about. */
const KNOWN_GLOBALS = new Set([
  'Math',
  'Date',
  'performance',
  'Intl',
  'crypto',
  'WebAssembly',
  'SharedArrayBuffer',
  'Atomics',
  ...GLOBAL_OBJECTS,
]);
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

interface AstNode {
  type: string;
  start: number;
  end: number;
  [k: string]: unknown;
}

/** TypeScript-only subtrees hold no runtime code, so the rules skip them. */
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

/** A string a node denotes statically: a string literal, or a template literal without expressions. */
function staticString(n: AstNode | null | undefined): string | null {
  if (!n) return null;
  if (n.type === 'Literal' && typeof n.value === 'string') return n.value;
  if (n.type === 'TemplateLiteral' && (n.expressions as unknown[]).length === 0) {
    const q = (n.quasis as { value: { cooked: string | null } }[])[0];
    return q?.value.cooked ?? null;
  }
  return null;
}

/** A member expression's key when static (`a.b`, `a['b']`, a[`b`], `a[0]`), else null. */
function staticKey(m: AstNode): string | null {
  const p = m.property as AstNode;
  if (!m.computed) return (p.name as string | undefined) ?? null;
  if (p.type === 'Literal' && (typeof p.value === 'string' || typeof p.value === 'number'))
    return String(p.value);
  return staticString(p);
}

/** The global a node denotes: `Math`, or `globalThis.Math` / `self['Math']`, or null. */
function resolveGlobal(n: AstNode): string | null {
  if (n.type === 'Identifier') return KNOWN_GLOBALS.has(n.name as string) ? (n.name as string) : null;
  if (n.type === 'MemberExpression') {
    const obj = resolveGlobal(n.object as AstNode);
    if (obj === null || !GLOBAL_OBJECTS.has(obj)) return null;
    const k = staticKey(n);
    return k !== null && KNOWN_GLOBALS.has(k) ? k : null;
  }
  return null;
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
  const deterministic = bytes || worker;
  /** Names bound by `import * as x` or `import x from` (dynamic keys on them are refused). */
  const namespaces = new Set<string>();

  /** Checks one import target; `typeOnly` imports are erased, so only the layer rules apply to them. */
  const dependency = (spec: string, offset: number, typeOnly = false): void => {
    const bare = spec.split('?')[0] as string;
    if (bare.startsWith('.') || bare.startsWith('/')) {
      const target = relative(ROOT, resolve(ROOT, dirname(file), bare))
        .split(sep)
        .join('/');
      if (
        deterministic &&
        !typeOnly &&
        !under(target, bytes ? BYTES_PATHS : [...WORKER_PATHS, ...BYTES_PATHS])
      )
        report(
          offset,
          'determinism',
          `a deterministic module imports ${target}, which the determinism bans do not cover`,
        );
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
    if (
      deterministic &&
      !typeOnly &&
      !layer &&
      !bare.startsWith('node:') &&
      !packageAllowed(bare, DETERMINISTIC_PACKAGES)
    )
      report(
        offset,
        'determinism',
        `a deterministic module imports ${bare}: add it to DETERMINISTIC_PACKAGES once reviewed`,
      );
    if (!layer) return;
    const allowed = LAYER_PACKAGES[layer];
    if (packageAllowed(bare, allowed) || (test && packageAllowed(bare, TEST_PACKAGES))) return;
    report(offset, 'package-import', `src/${layer}/ may not import ${bare}`);
  };

  /** An import whose specifier is computed: a boundary nobody can check. */
  const dynamicSpecifier = (offset: number, what: string): void => {
    if (layer || deterministic)
      report(offset, 'dynamic-import', `${what} with a computed specifier: its target cannot be checked`);
  };

  const globalUse = (n: AstNode, g: string, parent: AstNode | null, key: string): void => {
    const asObject = parent?.type === 'MemberExpression' && key === 'object';
    const k = asObject && parent ? staticKey(parent) : null;
    const at = asObject && parent ? parent.start : n.start;
    if (layer && (g === 'SharedArrayBuffer' || g === 'Atomics'))
      report(at, 'shared-memory', `${g}: no shared memory between threads (10 §0 #6)`);
    if (layer && !test && g === 'WebAssembly') {
      const scope = wasmScope(file);
      const ok = scope === 'instance' || (scope === 'compile' && asObject && WASM_COMPILE.has(k ?? ''));
      if (!ok)
        report(
          at,
          'linear-memory',
          `WebAssembly${asObject ? `.${k ?? '[…]'}` : ''}: only the sim, worldgen and asset workers instantiate modules and touch their memory; the main thread only compiles (IMPL-1 rule 4, 10 §2.3)`,
        );
    }
    if (!deterministic) return;
    if (g === 'Math') {
      if (!asObject)
        report(
          at,
          'determinism',
          'Math used as a value (destructured, aliased or passed): only Math.<allowed function> is checkable (D14)',
        );
      else if (k === null)
        report(
          at,
          'determinism',
          'Math with a computed key: only Math.<allowed function> is checkable (D14)',
        );
      else if (MATH_BANNED.has(k))
        report(
          at,
          'determinism',
          `Math.${k} is not bit-identical across engines (or not deterministic): use explicit arithmetic (D14)`,
        );
    } else if (g === 'Intl') report(at, 'determinism', 'Intl is locale-dependent (D14, D17)');
    else if (bytes && (g === 'Date' || g === 'performance'))
      report(at, 'determinism', `${g}: no clock where output bytes must be identical (D14)`);
    else if (g === 'crypto' && (!asObject || k === null || RANDOM_METHODS.has(k)))
      report(
        at,
        'determinism',
        'crypto randomness, or crypto used in a form that hides which function is called (D14)',
      );
    else if (GLOBAL_OBJECTS.has(g)) {
      if (!asObject)
        report(
          at,
          'determinism',
          `${g} used as a value: only static members of the global object are checkable (D14)`,
        );
      else if (k === null)
        report(
          at,
          'determinism',
          `${g} with a computed key: only static members of the global object are checkable (D14)`,
        );
    }
  };

  // Names bound by namespace and default imports, collected first.
  for (const st of parsed.program.body as unknown as AstNode[]) {
    if (st.type !== 'ImportDeclaration') continue;
    for (const sp of (st.specifiers as AstNode[]) ?? [])
      if (sp.type === 'ImportNamespaceSpecifier' || sp.type === 'ImportDefaultSpecifier')
        namespaces.add((sp.local as AstNode).name as string);
  }

  walk(parsed.program, (n, parent, key) => {
    switch (n.type) {
      case 'ImportDeclaration':
      case 'ExportAllDeclaration':
      case 'ExportNamedDeclaration': {
        const s = n.source as AstNode | null;
        const spec = staticString(s);
        const typeOnly = n.importKind === 'type' || n.exportKind === 'type';
        if (spec !== null) dependency(spec, (s as AstNode).start, typeOnly);
        if (!deterministic) break;
        for (const sp of (n.specifiers as AstNode[]) ?? []) {
          const name = ((n.type === 'ImportDeclaration' ? sp.imported : sp.local) as AstNode | undefined)
            ?.name as string | undefined;
          if (name && RANDOM_METHODS.has(name))
            report(
              sp.start,
              'determinism',
              `${name}: no randomness where output bytes must be identical (D14)`,
            );
          if (name === 'createRequire')
            report(sp.start, 'determinism', 'createRequire: no require() in a deterministic module');
        }
        if (n.type === 'ExportAllDeclaration' && spec !== null && !spec.startsWith('.'))
          report(
            n.start,
            'determinism',
            `export * from ${spec}: re-export by name, so the bans can see what passes through`,
          );
        break;
      }
      case 'ImportExpression': {
        const spec = staticString(n.source as AstNode);
        if (spec !== null) dependency(spec, (n.source as AstNode).start);
        else dynamicSpecifier(n.start, 'import()');
        if (deterministic)
          report(n.start, 'determinism', 'import() in a deterministic module: import statically, by name');
        break;
      }
      case 'CallExpression': {
        const callee = n.callee as AstNode;
        const args = (n.arguments as AstNode[]) ?? [];
        if (callee.type === 'Identifier' && callee.name === 'require') {
          const spec = staticString(args[0]);
          if (spec !== null) dependency(spec, (args[0] as AstNode).start);
          else dynamicSpecifier(n.start, 'require()');
          if (deterministic)
            report(n.start, 'determinism', 'require() in a deterministic module: import statically, by name');
        }
        if (
          callee.type === 'MemberExpression' &&
          (callee.object as AstNode).type === 'MetaProperty' &&
          staticKey(callee) === 'glob'
        ) {
          const pats =
            args[0]?.type === 'ArrayExpression'
              ? ((args[0].elements as AstNode[]) ?? [])
              : [args[0] as AstNode];
          for (const p of pats) {
            const spec = staticString(p);
            if (spec !== null) dependency(spec.replace(/^!/, ''), p.start);
            else dynamicSpecifier(n.start, 'import.meta.glob()');
          }
        }
        if (
          deterministic &&
          callee.type === 'Identifier' &&
          (callee.name === 'eval' || callee.name === 'Function')
        )
          report(
            n.start,
            'determinism',
            `${callee.name}: no code built from strings in a deterministic module`,
          );
        break;
      }
      case 'NewExpression': {
        const callee = n.callee as AstNode;
        const args = (n.arguments as AstNode[]) ?? [];
        if (callee.type === 'Identifier' && (callee.name === 'Worker' || callee.name === 'SharedWorker')) {
          if (layer && layer !== 'app' && layer !== 'dev')
            report(
              n.start,
              'threads',
              `only src/app/ creates workers (10 §2.2); found new ${callee.name} in src/${layer}/`,
            );
          const a0 = args[0];
          const viaUrl =
            a0?.type === 'NewExpression' &&
            (a0.callee as AstNode).name === 'URL' &&
            staticString((a0.arguments as AstNode[])[0]) !== null;
          if (layer && !viaUrl && staticString(a0) === null)
            dynamicSpecifier(n.start, `new ${callee.name}()`);
        }
        if (callee.type === 'Identifier' && callee.name === 'URL') {
          const [a0, a1] = args;
          const spec = staticString(a0);
          const meta = a1?.type === 'MemberExpression' && (a1.object as AstNode).type === 'MetaProperty';
          if (spec !== null && meta) dependency(spec, (a0 as AstNode).start);
        }
        if (deterministic && callee.type === 'Identifier' && callee.name === 'Function')
          report(n.start, 'determinism', 'Function: no code built from strings in a deterministic module');
        break;
      }
      case 'Identifier':
      case 'MemberExpression': {
        if (n.type === 'Identifier') {
          const isProperty =
            parent?.type === 'MemberExpression' && key === 'property' && !(parent.computed as boolean);
          const isKey =
            (parent?.type === 'Property' ||
              parent?.type === 'PropertyDefinition' ||
              parent?.type === 'MethodDefinition') &&
            key === 'key' &&
            !(parent.computed as boolean);
          const isImport = parent?.type?.startsWith('Import') || parent?.type?.startsWith('Export');
          if (isProperty || isKey || isImport) break;
        }
        const g = resolveGlobal(n);
        if (g !== null) globalUse(n, g, parent, key);
        if (n.type !== 'MemberExpression') break;
        const obj = n.object as AstNode;
        const k = staticKey(n);
        if (deterministic && obj.type === 'Identifier' && namespaces.has(obj.name as string) && k === null)
          report(
            n.start,
            'determinism',
            `${obj.name as string} with a computed key: only static members of an imported module are checkable (D14)`,
          );
        if (!deterministic || k === null) break;
        if (LOCALE_METHODS.has(k))
          report(n.start, 'determinism', `${k} depends on the locale (D17): compare code units`);
        if (RANDOM_METHODS.has(k) && resolveGlobal(obj) !== 'crypto')
          report(n.start, 'determinism', `${k}: no randomness here (D14)`);
        if (
          emitter &&
          obj.type === 'Identifier' &&
          obj.name === 'Object' &&
          ['keys', 'values', 'entries'].includes(k)
        )
          report(
            n.start,
            'emitter-order',
            `Object.${k} in an emitter: iterate sortedKeys/sortedEntries (scripts/lib/canonical.ts)`,
          );
        if (emitter && obj.type === 'Identifier' && obj.name === 'JSON' && k === 'stringify')
          report(
            n.start,
            'emitter-order',
            'JSON.stringify in an emitter: use canonicalJson (scripts/lib/canonical.ts)',
          );
        break;
      }
      case 'BinaryExpression':
        if (deterministic && n.operator === '**')
          report(n.start, 'determinism', '** is Math.pow: use repeated multiplication (D14)');
        break;
      case 'AssignmentExpression':
        if (deterministic && n.operator === '**=')
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

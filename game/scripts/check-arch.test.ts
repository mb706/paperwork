// check-arch's rules fire on the code they target and stay quiet elsewhere (10 §2.2, §2.5, D14).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scratchDir } from '../test/helpers/paths.ts';
import { checkGeneratedFiles, type Expected } from './check-arch/generated.ts';
import { checkRustSource, checkSource } from './check-arch.ts';
import { withHeader } from './lib/generated.ts';

const rules = (file: string, src: string) => checkSource(file, src).map((v) => v.rule);

describe('import boundaries (10 §2.2)', () => {
  it('lets a layer import itself and shared/', () => {
    expect(
      rules('src/render/a.ts', "import { x } from './b.ts';\nimport { y } from '../shared/gen/schema.ts';"),
    ).toEqual([]);
  });
  it('refuses render/, ui/, audio/ and assets/ importing each other', () => {
    expect(rules('src/render/a.ts', "import { x } from '../ui/b.ts';")).toEqual(['layer-import']);
    expect(rules('src/ui/a.ts', "import { x } from '../simworker/b.ts';")).toEqual(['layer-import']);
    expect(rules('src/assets/a.ts', "export * from '../render/b.ts';")).toEqual(['layer-import']);
    expect(rules('src/shared/a.ts', "import type { T } from '../app/b.ts';")).toEqual(['layer-import']);
  });
  it('lets app/ wire the layers together', () => {
    expect(
      rules(
        'src/app/main.ts',
        "import '../render/a.ts';\nimport '../assets/b.ts';\nimport '../simworker/c.ts';",
      ),
    ).toEqual([]);
  });
  it('refuses packages a layer may not use, and anything outside src/', () => {
    expect(rules('src/render/a.ts', "import { x } from 'solid-js';")).toEqual(['package-import']);
    expect(rules('src/shared/a.ts', "import { readFileSync } from 'node:fs';")).toEqual(['package-import']);
    expect(rules('src/ui/a.ts', "import { createSignal } from 'solid-js';")).toEqual([]);
    expect(rules('src/ui/a.ts', "import x from '../../scripts/lib/hash.ts';")).toEqual(['layer-import']);
    expect(
      rules('src/ui/a.test.ts', "import { it } from 'vitest';\nimport { readFileSync } from 'node:fs';"),
    ).toEqual([]);
  });
  it('follows dynamic imports and worker URLs', () => {
    expect(rules('src/ui/a.ts', "const m = await import('../render/b.ts');")).toEqual(['layer-import']);
    expect(rules('src/ui/a.ts', "new URL('../simworker/b.ts', import.meta.url);")).toEqual(['layer-import']);
  });
});

describe('threads and memory', () => {
  it('lets only app/ create workers', () => {
    expect(
      rules(
        'src/app/main.ts',
        "new Worker(new URL('./workers/sim.ts', import.meta.url), { type: 'module' });",
      ),
    ).toEqual([]);
    expect(rules('src/ui/a.ts', 'new Worker("x.js");')).toEqual(['threads']);
  });
  it('lets the main thread compile but not instantiate WebAssembly (10 §2.3)', () => {
    expect(rules('src/app/main.ts', 'await WebAssembly.compileStreaming(fetch(u));')).toEqual([]);
    expect(rules('src/app/main.ts', 'await WebAssembly.instantiate(m);')).toEqual(['linear-memory']);
    expect(rules('src/simworker/a.ts', 'await WebAssembly.instantiate(m, {});')).toEqual([]);
    expect(rules('src/assets/worker/t.ts', 'await WebAssembly.instantiate(m, {});')).toEqual([]);
    expect(rules('src/assets/loader.ts', 'await WebAssembly.instantiate(m, {});')).toEqual(['linear-memory']);
    expect(rules('src/render/a.ts', 'const w = WebAssembly;')).toEqual(['linear-memory']);
  });
  it('refuses shared memory everywhere in src/', () => {
    expect(rules('src/simworker/a.ts', 'const b = new SharedArrayBuffer(8);')).toEqual(['shared-memory']);
    expect(rules('src/app/a.ts', 'Atomics.wait(a, 0, 0);')).toEqual(['shared-memory']);
  });
});

describe('determinism bans (D14)', () => {
  it('bans randomness, clocks, locales and pow where output bytes must be identical', () => {
    const src = [
      'const a = Math.random();',
      'const b = Math.sin(1);',
      'const c = 2 ** 3;',
      'const d = Date.now();',
      'const e = performance.now();',
      "const f = 'a'.localeCompare('b');",
      'const g = new Intl.Collator();',
      'const h = crypto.randomUUID();',
      'let i = 2; i **= 2;',
      'const j = Math.pow(2, 3);',
    ].join('\n');
    expect(rules('scripts/data-stage/x.ts', src)).toEqual(Array(10).fill('determinism'));
    expect(rules('src/shared/x.ts', src)).toHaveLength(10);
  });
  it('allows the clock but nothing else in the worker shells', () => {
    expect(rules('src/simworker/pacing.ts', 'const t = performance.now(); const d = Date.now();')).toEqual(
      [],
    );
    expect(rules('src/simworker/x.ts', 'const r = Math.random(); const p = 2 ** 3;')).toEqual([
      'determinism',
      'determinism',
    ]);
  });
  it('allows Math.floor, sqrt, abs, trunc, min and max', () => {
    expect(
      rules(
        'src/shared/x.ts',
        'Math.floor(1.5) + Math.sqrt(2) + Math.abs(-1) + Math.trunc(1.2) + Math.min(1, 2) + Math.max(1, 2);',
      ),
    ).toEqual([]);
  });
  it('ignores type positions, property names and other layers', () => {
    expect(
      rules(
        'src/shared/x.ts',
        'type T = Date; interface I { performance: number }\nconst o = { Date: 1 }; o.Date = 2;',
      ),
    ).toEqual([]);
    expect(rules('src/render/x.ts', 'const r = Math.random(); const t = Date.now();')).toEqual([]);
  });
  it('bans unordered object iteration and JSON.stringify in emitters only', () => {
    const src = 'for (const k in o) {}\nObject.keys(o); Object.entries(o); JSON.stringify(o);';
    expect(rules('scripts/data-stage/emit/x.ts', src)).toEqual(Array(4).fill('emitter-order'));
    expect(rules('scripts/data-stage/refs.ts', src)).toEqual([]);
  });
  it('honours a justified opt-out on the line before', () => {
    expect(
      rules(
        'scripts/data-stage.ts',
        '// check-arch-ignore determinism: log timing only\nconst t = performance.now();',
      ),
    ).toEqual([]);
    expect(
      rules(
        'scripts/data-stage.ts',
        '// check-arch-ignore threads: wrong rule\nconst t = performance.now();',
      ),
    ).toEqual(['determinism']);
  });
});

describe('the pure crates do no I/O (10 §2.5)', () => {
  it('flags std::fs, std::net, std::env, std::process and the standard streams, not comments', () => {
    const src =
      'use std::fs;\nlet x = std::env::var("A");\n// std::fs in a comment\nlet n = std::net::TcpStream::connect(a);\nstd::io::stdout();\nuse std::io::Write;';
    expect(checkRustSource('crates/sim/src/a.rs', src).map((v) => `${v.line}:${v.rule}`)).toEqual([
      '1:rust-io',
      '2:rust-io',
      '4:rust-io',
      '5:rust-io',
    ]);
  });
});

// C1a-r1 finding 8: the determinism bans see through aliases, computed keys, destructuring, dynamic
// imports and re-exports.
describe('determinism bans cannot be bypassed (C1a-r1 finding 8)', () => {
  const det = (src: string) => rules('scripts/data-stage/x.ts', src);
  it.each([
    ['globalThis.Math.random()', 'globalThis.Math.random();'],
    ['self.Math.sin(1)', 'self.Math.sin(1);'],
    ['Math["random"]()', 'Math["random"]();'],
    ['Math[`random`]()', 'Math[`random`]();'],
    ['Math[k]()', 'const k = "ran" + "dom"; Math[k]();'],
    ['destructured Math', 'const { random: rng } = Math; rng();'],
    ['aliased Math', 'const M = Math; M.random();'],
    ['Math passed as a value', 'Reflect.get(Math, "random")();'],
    ['globalThis destructured', 'const { Math: M } = globalThis; M.random();'],
    ['globalThis with a computed key', 'globalThis["Ma" + "th"].random();'],
    ['globalThis.Date', 'const t = globalThis.Date.now();'],
    ['self.performance', 'const t = self.performance.now();'],
    ['crypto.getRandomValues', 'crypto.getRandomValues(new Uint8Array(4));'],
    ['destructured crypto', 'const { randomUUID } = crypto; randomUUID();'],
    ['namespace import, static key', 'import * as c from "node:crypto"; c.randomBytes(4);'],
    ['namespace import, computed key', 'import * as c from "node:crypto"; c["random" + "Bytes"](4);'],
    ['renamed named import', 'import { randomBytes as rb } from "node:crypto"; rb(4);'],
    ['destructured dynamic import', 'const { randomBytes } = await import("node:crypto"); randomBytes(4);'],
    ['named re-export', 'export { randomUUID as id } from "node:crypto";'],
    ['whole-module re-export', 'export * from "node:crypto";'],
    ['require', 'const c = require("node:crypto");'],
    ['createRequire', 'import { createRequire } from "node:module";'],
    ['eval', 'eval("Math.random()");'],
    ['new Function', 'new Function("return Math.random()")();'],
    ['locale method by computed key', '"a"["localeCompare"]("b");'],
    ['an import the bans do not cover', 'import { x } from "../ci.ts";'],
    ['an unreviewed package', 'import { x } from "left-pad";'],
  ])('refuses %s', (_name, src) => {
    expect(det(src)).toContain('determinism');
  });
  it('accepts what deterministic code really uses', () => {
    expect(
      det(
        'import { createHash } from "node:crypto";\nimport { readFileSync } from "node:fs";\nimport { z } from "zod";\nimport { x } from "../lib/hash.ts";\nMath.floor(1.5) + Math.max(1, 2) + Math["abs"](-1);\nconst h = createHash("sha256");',
      ),
    ).toEqual([]);
    expect(
      rules(
        'src/simworker/x.ts',
        'self.postMessage(1); self.addEventListener("message", () => {}); const t = performance.now();',
      ),
    ).toEqual([]);
    expect(rules('src/simworker/x.ts', 'const h = await crypto.subtle.digest("SHA-256", b);')).toEqual([]);
  });
});

// C1a-r1 finding 9: dynamic imports cannot hide a layer crossing.
describe('import targets must be static (C1a-r1 finding 9)', () => {
  it('checks constant template literals like strings', () => {
    expect(rules('src/ui/a.ts', 'const m = await import(`../render/a.ts`);')).toEqual(['layer-import']);
    expect(rules('src/ui/a.ts', 'const m = await import(`./b.ts`);')).toEqual([]);
  });
  it('refuses computed import specifiers, require and worker URLs', () => {
    expect(rules('src/ui/a.ts', 'const p = "../render/a.ts"; const m = await import(p);')).toEqual([
      'dynamic-import',
    ]);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is source text holding a template literal
    expect(rules('src/ui/a.ts', 'const m = await import(`../${dir}/a.ts`);')).toEqual(['dynamic-import']);
    expect(rules('src/ui/a.ts', 'const m = require(p);')).toEqual(['dynamic-import']);
    expect(rules('src/app/a.ts', 'new Worker(url, { type: "module" });')).toEqual(['dynamic-import']);
    expect(rules('src/ui/a.ts', 'const m = import.meta.glob("../render/*.ts");')).toEqual(['layer-import']);
  });
  it('honours an explicit, justified exception', () => {
    expect(
      rules(
        'src/ui/a.ts',
        '// check-arch-ignore dynamic-import: plugin registry, checked by its loader\nconst m = await import(p);',
      ),
    ).toEqual([]);
  });
});

// C1a-r1 finding 10: grouped, nested, renamed and glob imports of I/O are caught too.
describe('the pure crates do no I/O, however it is imported (C1a-r1 finding 10)', () => {
  const io = (src: string) =>
    checkRustSource('crates/sim/src/a.rs', src).map((v) => v.message.replace(/: no I\/O.*$/, ''));
  it.each([
    ['grouped', 'use std::{fs, env, net};\nfn f() { fs::read("x"); }', ['std::fs', 'std::env', 'std::net']],
    ['renamed', 'use std::fs as files;\nfn f() { files::read("x"); }', ['std::fs']],
    ['nested', 'use std::{io::{self, stdout as so}, process::{exit}};', ['std::io::stdout', 'std::process']],
    ['multi-line', 'use std::{\n    collections::BTreeMap,\n    env::var as get,\n};', ['std::env']],
    ['glob of std', 'use std::*;', ['a glob import of std hides what it brings in']],
    ['glob of io', 'use std::io::*;', ['std::io::* brings in the standard streams']],
    [
      'alias of std',
      'use std as s;\nfn f() { s::fs::read("x"); }',
      ['an alias of std hides what it brings in'],
    ],
    ['extern crate alias', 'extern crate std as s;', ['an alias of std hides what it brings in']],
    ['absolute path', 'fn f() { ::std::env::var("A"); }', ['std::env']],
    ['stream through io', 'use std::io;\nfn f() { io::stderr(); }', ['std::io::stderr']],
  ])('%s', (_name, src, want) => {
    expect(io(src as string)).toEqual(want);
  });
  it('ignores comments, strings and harmless std paths', () => {
    expect(
      io(
        '// use std::fs;\n/* std::env */ fn f() -> &str { "std::fs::read" }\nuse std::io::{Read, Write};\nuse std::collections::BTreeMap;',
      ),
    ).toEqual([]);
  });
});

// C1a-r1 finding 11: generated directories hold only the generators' outputs.
describe('generated-file ownership (C1a-r1 finding 11)', () => {
  const setup = () => {
    const root = scratchDir('generated');
    mkdirSync(join(root, 'src/shared/gen'), { recursive: true });
    const inventory: Expected[] = [
      {
        path: 'src/shared/gen/proto-ids.ts',
        generator: 'scripts/data-stage.ts',
        source: 'design/spec/data',
        schemaHash: null,
      },
    ];
    const header = (
      gen: 'scripts/data-stage.ts' | 'scripts/schema-gen.ts',
      source: string,
      body: string,
      schemaHash?: string,
    ) => withHeader({ generator: gen, source, command: 'x', ...(schemaHash ? { schemaHash } : {}) }, body);
    return { root, inventory, header };
  };
  it('accepts the inventory as generated', () => {
    const { root, inventory, header } = setup();
    writeFileSync(
      join(root, 'src/shared/gen/proto-ids.ts'),
      header('scripts/data-stage.ts', 'design/spec/data', 'export const A = 1;\n'),
    );
    expect(checkGeneratedFiles(root, inventory)).toEqual([]);
  });
  it('refuses an extra file even with a valid header and hash', () => {
    const { root, inventory, header } = setup();
    writeFileSync(
      join(root, 'src/shared/gen/proto-ids.ts'),
      header('scripts/data-stage.ts', 'design/spec/data', 'export const A = 1;\n'),
    );
    writeFileSync(
      join(root, 'src/shared/gen/extra.ts'),
      header('scripts/data-stage.ts', 'design/spec/data', 'export const B = 2;\n'),
    );
    expect(checkGeneratedFiles(root, inventory).map((v) => `${v.file}: ${v.message}`)).toEqual([
      'src/shared/gen/extra.ts: no generator writes this file: generated directories hold only the generators’ outputs',
    ]);
  });
  it('refuses the wrong generator, a stale schema hash and a missing output', () => {
    const { root, header } = setup();
    const inv: Expected[] = [
      {
        path: 'src/shared/gen/proto-ids.ts',
        generator: 'scripts/data-stage.ts',
        source: 'design/spec/data',
        schemaHash: null,
      },
      {
        path: 'src/shared/gen/schema.ts',
        generator: 'scripts/schema-gen.ts',
        source: 'schema/',
        schemaHash: 'a'.repeat(64),
      },
      {
        path: 'src/shared/gen/codecs.ts',
        generator: 'scripts/schema-gen.ts',
        source: 'schema/',
        schemaHash: 'a'.repeat(64),
      },
    ];
    writeFileSync(
      join(root, 'src/shared/gen/proto-ids.ts'),
      header('scripts/schema-gen.ts', 'schema/', 'export const A = 1;\n', 'a'.repeat(64)),
    );
    writeFileSync(
      join(root, 'src/shared/gen/schema.ts'),
      header('scripts/schema-gen.ts', 'schema/', 'export const S = 1;\n', 'b'.repeat(64)),
    );
    const msgs = checkGeneratedFiles(root, inv).map((v) => v.message);
    expect(msgs).toHaveLength(3);
    expect(msgs[0]).toMatch(
      'names scripts/schema-gen.ts from schema/, but scripts/data-stage.ts writes this file',
    );
    expect(msgs[1]).toMatch('generated from schema bbbbbbbbbbbb…, but the schema is aaaaaaaaaaaa…');
    expect(msgs[2]).toMatch('missing');
  });
});

// check-arch's rules fire on the code they target and stay quiet elsewhere (10 §2.2, §2.5, D14).
import { describe, expect, it } from 'vitest';
import { checkSource } from './check-arch.ts';

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

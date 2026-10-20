#!/usr/bin/env python3
"""Build-time estimate at a realistic 30-60k-line scale (WP A1, question 5).

Synthesises a Rust crate and a TypeScript tree from N copies of the kernel (rust/src/lib.rs, ts/kernel.ts),
every copy reachable from one entry point so nothing is dead code, then times clean and incremental builds.
Usage: python3 harness/buildtime.py [copies=28]   (run under taskset -c 0-7; writes results/buildtime.json)
"""
import json, os, re, shutil, subprocess, sys, time

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)
N = int(sys.argv[1]) if len(sys.argv) > 1 else 28
work = os.path.join(root, 'target', 'buildtime')
shutil.rmtree(work, ignore_errors=True)
os.makedirs(os.path.join(work, 'rs', 'src'))
os.makedirs(os.path.join(work, 'ts', 'src'))

# ---- Rust: N modules, each a copy of the kernel without the wasm API
src = open(os.path.join(root, 'rust', 'src', 'lib.rs')).read()
body = src[:src.index('#[cfg(target_arch = "wasm32")]\nmod wasm_api')]
body = body.replace('#![allow(clippy::too_many_arguments, clippy::needless_range_loop)]', '')
for k in range(N):
    with open(os.path.join(work, 'rs', 'src', f'k{k}.rs'), 'w') as f:
        f.write('#![allow(dead_code, clippy::all)]\n' + body)
lib = ['#![allow(clippy::all)]'] + [f'pub mod k{k};' for k in range(N)]
lib.append('#[unsafe(no_mangle)]\npub extern "C" fn run_all(p: *const u8, len: usize, n: u32) -> u32 {')
lib.append('    let b = unsafe { core::slice::from_raw_parts(p, len) };\n    let mut h = 0u32;')
for k in range(N):
    lib.append(f'    {{ let mut w = k{k}::World::new(b); w.run(n); h ^= w.hash(); }}')
lib.append('    h\n}')
open(os.path.join(work, 'rs', 'src', 'lib.rs'), 'w').write('\n'.join(lib) + '\n')
cargo = open(os.path.join(root, 'rust', 'Cargo.toml')).read().replace('name = "paperwork-sim-study"', 'name = "buildtime-synth"')
open(os.path.join(work, 'rs', 'Cargo.toml'), 'w').write(cargo)
shutil.copy(os.path.join(root, 'rust', 'rust-toolchain.toml'), os.path.join(work, 'rs'))

# ---- TS: N copies of the kernel, one entry importing them all
ts = open(os.path.join(root, 'ts', 'kernel.ts')).read()
shutil.copy(os.path.join(root, 'ts', 'format.ts'), os.path.join(work, 'ts', 'src', 'format.ts'))
shutil.copy(os.path.join(root, 'ts', 'sim-like.ts'), os.path.join(work, 'ts', 'src', 'sim-like.ts'))
for k in range(N):
    open(os.path.join(work, 'ts', 'src', f'k{k}.ts'), 'w').write(ts)
entry = [f"import {{ World as W{k} }} from './k{k}.ts';" for k in range(N)]
entry.append('export function runAll(b: ArrayBuffer, n: number): number {\n  let h = 0;')
for k in range(N):
    entry.append(f'  {{ const w = new W{k}(b); w.run(n); h ^= w.hash(); }}')
entry.append('  return h;\n}')
open(os.path.join(work, 'ts', 'src', 'main.ts'), 'w').write('\n'.join(entry) + '\n')
open(os.path.join(work, 'ts', 'tsconfig.json'), 'w').write(json.dumps({'compilerOptions': {
    'target': 'es2024', 'module': 'esnext', 'moduleResolution': 'bundler', 'strict': True, 'noEmit': True,
    'lib': ['es2024'], 'types': [], 'allowImportingTsExtensions': True, 'skipLibCheck': True}, 'include': ['src']}))
open(os.path.join(work, 'ts', 'vite.config.ts'), 'w').write(
    "import { defineConfig } from 'vite';\nexport default defineConfig({ build: { lib: { entry: 'src/main.ts', formats: ['es'], fileName: 'main' }, outDir: 'dist', emptyOutDir: true, target: 'es2024' } });\n")

def lines(path, ext):
    total = 0
    for d, _, fs in os.walk(path):
        for f in fs:
            if f.endswith(ext):
                total += sum(1 for l in open(os.path.join(d, f)) if l.strip())
    return total

def timed(cmd, cwd):
    t = time.time()
    r = subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True)
    dt = time.time() - t
    if r.returncode != 0:
        print(r.stdout[-2000:], r.stderr[-3000:])
        raise SystemExit(f'failed: {cmd}')
    return round(dt, 2)

def touch_rs():
    p = os.path.join(work, 'rs', 'src', f'k{N // 2}.rs')
    s = open(p).read()
    s = re.sub(r'pub const WIN: i32 = (\d+);', lambda m: f'pub const WIN: i32 = {int(m.group(1)) + 1};', s, count=1)
    open(p, 'w').write(s)

def touch_ts():
    p = os.path.join(work, 'ts', 'src', f'k{N // 2}.ts')
    s = open(p).read()
    s = re.sub(r'export const WIN = (\d+);', lambda m: f'export const WIN = {int(m.group(1)) + 1};', s, count=1)
    open(p, 'w').write(s)

rs = os.path.join(work, 'rs')
res = {'copies': N, 'rustLines': lines(os.path.join(rs, 'src'), '.rs'), 'tsLines': lines(os.path.join(work, 'ts', 'src'), '.ts')}
print('lines', res)
W = '--target wasm32-unknown-unknown --lib'
steps = [
    ('cargo check (clean)', f'cargo check {W}', None),
    ('cargo check (incremental, one module edited)', f'cargo check {W}', touch_rs),
    ('cargo build wasm release, fat LTO (clean)', f'cargo build --release {W}', None),
    ('cargo build wasm release, fat LTO (incremental)', f'cargo build --release {W}', touch_rs),
    ('cargo build wasm wasmdev: O2, no LTO, 16 CGUs (clean)', f'cargo build --profile wasmdev {W}', None),
    ('cargo build wasm wasmdev (incremental)', f'cargo build --profile wasmdev {W}', touch_rs),
    ('cargo test --no-run, native debug (clean)', 'cargo test --no-run --lib', None),
    ('cargo test --no-run, native debug (incremental)', 'cargo test --no-run --lib', touch_rs),
]
res['rust'] = []
for name, cmd, pre in steps:
    if pre:
        pre()
    dt = timed(cmd, rs)
    print(f'{dt:8.2f} s  {name}')
    res['rust'].append({'step': name, 'seconds': dt})
wasm = os.path.join(rs, 'target', 'wasm32-unknown-unknown', 'release', 'sim.wasm')
res['rustWasmBytes'] = os.path.getsize(wasm)
t0 = time.time()
subprocess.run(f'wasm-opt -O3 {wasm} -o {wasm}.opt', shell=True, check=True)
res['wasmOptSeconds'] = round(time.time() - t0, 2)
res['rustWasmOptBytes'] = os.path.getsize(wasm + '.opt')

tsd = os.path.join(work, 'ts')
nm = os.path.join(root, 'node_modules')
os.symlink(nm, os.path.join(tsd, 'node_modules'))
res['ts'] = []
for name, cmd, pre in [
    ('tsc --noEmit (TS 7, clean)', f'{nm}/.bin/tsc -p tsconfig.json', None),
    ('tsc --noEmit (one file edited)', f'{nm}/.bin/tsc -p tsconfig.json', touch_ts),
    ('vite build (bundle + minify)', f'{nm}/.bin/vite build', None),
    ('vite build (one file edited)', f'{nm}/.bin/vite build', touch_ts),
]:
    if pre:
        pre()
    dt = timed(cmd, tsd)
    print(f'{dt:8.2f} s  {name}')
    res['ts'].append({'step': name, 'seconds': dt})
res['tsBundleBytes'] = os.path.getsize(os.path.join(tsd, 'dist', 'main.js'))
os.makedirs(os.path.join(root, 'results'), exist_ok=True)
json.dump(res, open(os.path.join(root, 'results', f'buildtime-{N}.json'), 'w'), indent=1)
print(json.dumps(res, indent=1))

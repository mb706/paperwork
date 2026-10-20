#!/bin/sh
# Release WebAssembly (10 §2.3): cargo release build (fat LTO, opt-level 3, panic = abort), wasm-opt -O3,
# then the feature gate. Output: target/wasm-release/{sim,gen}.wasm, which `vite build` emits as
# content-hashed assets (scripts/cargo-plugin.ts).
set -eu
cd "$(dirname "$0")/.."
cargo build --release --locked --target wasm32-unknown-unknown -p simabi -p genabi
mkdir -p target/wasm-release
for pair in sim:simabi gen:genabi; do
  name=${pair%%:*}
  crate=${pair#*:}
  wasm-opt -O3 "target/wasm32-unknown-unknown/release/$crate.wasm" -o "target/wasm-release/$name.wasm"
done
node scripts/wasm-feature-gate.ts target/wasm-release/sim.wasm target/wasm-release/gen.wasm

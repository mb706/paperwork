#!/bin/bash
# Build the Rust kernel for wasm32-unknown-unknown (release: fat LTO, opt-level 3, panic=abort),
# without and with simd128, then run wasm-opt -O3. Output: ../target/wasm/{sim,sim-simd}.wasm (+ .raw.wasm).
set -euo pipefail
cd "$(dirname "$0")"
out=../target/wasm
mkdir -p "$out"
cargo build --release --target wasm32-unknown-unknown --lib
cp target/wasm32-unknown-unknown/release/sim.wasm "$out/sim.raw.wasm"
RUSTFLAGS="-C target-feature=+simd128" cargo build --release --target wasm32-unknown-unknown --lib --target-dir target/simd
cp target/simd/wasm32-unknown-unknown/release/sim.wasm "$out/sim-simd.raw.wasm"
wasm-opt -O3 "$out/sim.raw.wasm" -o "$out/sim.wasm"
wasm-opt -O3 --enable-simd "$out/sim-simd.raw.wasm" -o "$out/sim-simd.wasm"
ls -l "$out"

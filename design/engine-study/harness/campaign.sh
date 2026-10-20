#!/bin/bash
# Run the benchmark matrix on one platform; appends JSON lines to results/<platform>.jsonl.
#   harness/campaign.sh node|chrome|firefox|native [reps=3] [scales=mid,late] [regimes=busy,typical,backed,starved] [impls=ts,wasm,wasm-simd]
# Environment: CPUS (taskset list, default 0-7 = socket 0's physical cores), WARMUP, TICKS, PHASE, FRAMES.
# Prerequisites: npm ci; rust/build-wasm.sh; cargo build --release (native); (cd harness/web && vite build).
set -euo pipefail
cd "$(dirname "$0")/.."
platform=$1
reps=${2:-3}
scales=${3:-mid,late}
regimes=${4:-busy,typical,backed,starved}
impls=${5:-ts,wasm,wasm-simd}
W=${WARMUP:-6000}; T=${TICKS:-3600}; P=${PHASE:-600}; F=${FRAMES:-120}
CPUS=${CPUS:-0-7}
mkdir -p results
out=results/$platform.jsonl
echo "== $platform reps=$reps scales=$scales regimes=$regimes impls=$impls warmup=$W ticks=$T cpus=$CPUS"
harness/cpuload.sh 2
case $platform in
  node)
    for rep in $(seq 1 "$reps"); do for s in ${scales//,/ }; do for r in ${regimes//,/ }; do for i in ${impls//,/ }; do
      taskset -c "$CPUS" node harness/bench-node.ts "$i" "$s" "$r" 1 "$W" "$T" "$P" "$F" | jq -c --argjson rep "$rep" '. + {rep: $rep}' >> "$out"
      tail -1 "$out" | jq -r '"node \(.cfg.impl) \(.cfg.scale)/\(.cfg.regime) rep\(.rep): mean \(.tick.mean*1000|round/1000) p99 \(.tick.p99*1000|round/1000) max \(.tick.max*1000|round/1000) hash \(.hash) load s0=\(.load.s0)% s1=\(.load.s1)%"'
    done; done; done; done ;;
  native)
    for s in ${scales//,/ }; do for r in ${regimes//,/ }; do
      [ -f "target/worlds/$s-$r-s1.bin" ] || node harness/make-world.ts "$s" "$r" 1 >/dev/null
    done; done
    for rep in $(seq 1 "$reps"); do for s in ${scales//,/ }; do for r in ${regimes//,/ }; do
      t0=$(date +%s%3N)
      line=$(taskset -c "$CPUS" rust/target/release/bench "target/worlds/$s-$r-s1.bin" "$W" "$T")
      t1=$(date +%s%3N)
      echo "$line" | jq -c --arg s "$s" --arg r "$r" --argjson rep "$rep" --argjson t0 "$t0" --argjson t1 "$t1" '. + {platform: "native", scale: $s, regime: $r, rep: $rep, startedAt: $t0, endedAt: $t1}' >> "$out"
      tail -1 "$out" | jq -r '"native \(.scale)/\(.regime) rep\(.rep): mean \(.mean*1000|round/1000) p99 \(.p99*1000|round/1000) max \(.max*1000|round/1000) hash \(.hash)"'
    done; done; done ;;
  chrome|firefox)
    taskset -c "$CPUS" node harness/bench-browser.ts "$platform" "$out" "$impls" "$scales" "$regimes" "$reps" "warmup=$W&ticks=$T&phaseTicks=$P&frames=$F&queries=1" ;;
  *) echo "unknown platform $platform"; exit 2 ;;
esac
harness/cpuload.sh 2

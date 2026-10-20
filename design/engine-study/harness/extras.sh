#!/bin/bash
# The smaller Node-side experiments (after the main campaigns), appending to results/*.jsonl:
#   NO_SLEEP at Late (equivalence at scale + what sleeping saves), the 400k megabase stretch,
#   the hybrid arena experiment, the warm-up curve.
set -euo pipefail
cd "$(dirname "$0")/.."
CPUS=${CPUS:-0-7}
harness/cpuload.sh 2
# 1. NO_SLEEP at Late: the hash must equal the sleeping run's (results/node.jsonl) and the cost shows what sleep buys
for r in busy typical; do for i in ts wasm; do
  taskset -c "$CPUS" node harness/bench-node.ts "$i" late "$r" 1 6000 3600 600 20 nosleep | jq -c '. + {rep: 1}' >> results/nosleep.jsonl
  tail -1 results/nosleep.jsonl | jq -r '"nosleep \(.cfg.impl) late/\(.cfg.regime): mean \(.tick.mean*1000|round/1000) hash \(.hash) s0=\(.load.s0)%"'
done; done
# 2. megabase stretch (400k entities), busy
for rep in 1 2 3; do for i in ts wasm; do
  taskset -c "$CPUS" node harness/bench-node.ts "$i" mega busy 1 6000 3600 600 60 | jq -c --argjson rep "$rep" '. + {rep: $rep}' >> results/mega.jsonl
  tail -1 results/mega.jsonl | jq -r '"mega \(.cfg.impl) busy rep\(.rep): mean \(.tick.mean*1000|round/1000) p99 \(.tick.p99*1000|round/1000) hash \(.hash) s0=\(.load.s0)%"'
done; done
[ -f target/worlds/mega-busy-s1.bin ] || node harness/make-world.ts mega busy 1 >/dev/null
for rep in 1 2 3; do
  taskset -c "$CPUS" rust/target/release/bench target/worlds/mega-busy-s1.bin 6000 3600 | jq -c --argjson rep "$rep" '. + {platform: "native", scale: "mega", regime: "busy", rep: $rep}' >> results/mega.jsonl
  tail -1 results/mega.jsonl | jq -r '"mega native busy: mean \(.mean*1000|round/1000) p99 \(.p99*1000|round/1000) hash \(.hash)"'
done
# 3. hybrid: the TS kernel on its own arrays vs on one ArrayBuffer vs on a WebAssembly.Memory
for rep in 1 2 3; do for m in own buffer wasm-memory; do
  taskset -c "$CPUS" node harness/arena-node.ts "$m" late busy 6000 3600 | jq -c --argjson rep "$rep" '. + {rep: $rep}' >> results/arena.jsonl
  tail -1 results/arena.jsonl | jq -r '"arena \(.mode): mean \(.mean*1000|round/1000) p99 \(.p99*1000|round/1000) hash \(.hash)"'
done; done
harness/cpuload.sh 2

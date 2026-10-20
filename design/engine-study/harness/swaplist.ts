// Spec 10 §4.6 says each system keeps "a dense active list (Int32Array) plus a position index, so removal is
// O(1)" (swap-remove), and also requires NO_SLEEP equivalence. This experiment shows the two conflict: with a
// swap-remove list, the inserters' update order drifts from pool order as they sleep and wake, so when two
// inserters compete for one chest's space or items the outcome differs from the NO_SLEEP run, which updates
// every inserter in pool order. The kernel's bitsets (iterated in index order) keep both properties.
//   node harness/swaplist.ts [scale] [ticks]
import { generate, params } from '../gen/generate.ts';
import { World } from '../ts/kernel.ts';

const bit = (a: Int32Array, i: number) => (a[i >>> 5] & (1 << (i & 31))) !== 0;

class SwapListWorld extends World {
  list: Int32Array;
  pos: Int32Array;
  count = 0;
  constructor(blob: ArrayBuffer) {
    super(blob);
    this.list = new Int32Array(this.nIns);
    this.pos = new Int32Array(this.nIns).fill(-1);
    for (let i = 0; i < this.nIns; i++) this.add(i);
  }
  add(i: number): void {
    this.pos[i] = this.count;
    this.list[this.count++] = i;
  }
  remove(i: number): void {
    const k = this.pos[i];
    const last = this.list[--this.count];
    this.list[k] = last;
    this.pos[last] = k;
    this.pos[i] = -1;
  }
  override wakeIns(i: number): void {
    const was = bit(this.insAct, i);
    super.wakeIns(i);
    if (!was) this.add(i);
  }
  override insWaitSource(i: number, mask: number): void {
    super.insWaitSource(i, mask);
    if (!bit(this.insAct, i) && this.pos[i] >= 0) this.remove(i);
  }
  override insWaitTarget(i: number): void {
    super.insWaitTarget(i);
    if (!bit(this.insAct, i) && this.pos[i] >= 0) this.remove(i);
  }
  override inserters(): void {
    for (let k = 0; k < this.count; k++) {
      const i = this.list[k];
      this.tickIns(i);
      if (k < this.count && this.list[k] !== i) k--; // i slept: the former last entry now sits at k
    }
  }
}

const scale = process.argv[2] ?? 'mid';
const ticks = Number(process.argv[3] ?? 12000);
for (const regime of ['busy', 'typical', 'backed', 'starved']) {
  const blob = generate(params(scale, regime, 1));
  const bitset = new World(blob);
  const nosleep = new World(blob);
  nosleep.setNoSleep(true);
  const swap = new SwapListWorld(blob);
  let firstDiv = -1;
  let bitsetOk = true;
  for (let t = 1; t <= ticks; t++) {
    bitset.step();
    nosleep.step();
    swap.step();
    if (t % 200 === 0) {
      const hn = nosleep.hash();
      if (bitset.hash() !== hn) bitsetOk = false;
      if (firstDiv < 0 && swap.hash() !== hn) firstDiv = t;
    }
  }
  console.log(`${scale}/${regime}: bitset == NO_SLEEP for ${ticks} ticks: ${bitsetOk}; swap-remove list diverges from NO_SLEEP ${firstDiv < 0 ? 'never' : `by tick ${firstDiv}`}; research ${bitset.research} / ${nosleep.research} / ${swap.research}`);
}

// The background re-sync's shadow simulation in its own thread (DESIGN.md §5.2): it loads the donor's snapshot,
// steps through the closures the main thread forwards as fast as it can, and hands its state over at a tick
// the main thread names. In the browser this is a second simulation worker that simply becomes the live one.
import { parentPort } from 'node:worker_threads';
import { Sim } from './sim.mjs';

const sab = new Int32Array(new SharedArrayBuffer(4));
const EMPTY = [];
let sim = null;
const closures = new Map();
let handoverAt = -1;
let horizon = 0;
let lastProgress = 0;
let idle = true;

function handOver() {
  const bytes = sim.serialize();
  parentPort.postMessage({ t: 'state', tick: sim.tick, bytes }, [bytes.buffer]);
  sim = null;
}

function run() {
  idle = false;
  if (!sim) return;
  if (handoverAt > 0 && sim.tick >= handoverAt) return handOver(); // already past it: hand over at once
  const t0 = performance.now();
  while (sim.tick < horizon && performance.now() - t0 < 50) {
    const t = sim.tick + 1;
    sim.step(closures.get(t) ?? EMPTY);
    closures.delete(t);
    if (t === handoverAt) return handOver();
  }
  if (performance.now() - lastProgress > 100) {
    parentPort.postMessage({ t: 'progress', tick: sim.tick });
    lastProgress = performance.now();
  }
  if (sim.tick < horizon) setImmediate(run);
  else {
    idle = true; // caught up with what has arrived: report it and wait for more closures
    parentPort.postMessage({ t: 'progress', tick: sim.tick });
  }
}

parentPort.on('message', (m) => {
  if (m.t === 'load') {
    sim = Sim.deserialize(new Uint8Array(m.bytes));
    sim.costMs = m.costMs;
    sim.padBytes = m.padBytes;
    sim.sleep = (ms) => Atomics.wait(sab, 0, 0, ms);
    run();
  } else if (m.t === 'closures') {
    for (const [tick, entries] of m.list) closures.set(tick, entries);
    horizon = Math.max(horizon, m.horizon);
    if (idle) run();
  } else if (m.t === 'handover') {
    handoverAt = m.tick;
    if (sim && sim.tick >= handoverAt) handOver(); // the live simulation is behind the shadow: it waits for it
    else if (idle) run();
  }
});

// The fake sim worker's entry (10 §15.10, `?sim=fake`): the protocol handler of src/simworker/fake.ts with the
// worker's clock, timers and the dev server's fake prototype build.
import { FAKE_DATA, FakeSim } from '../../simworker/fake.ts';

// Short waits use a MessageChannel self-post, which avoids the 4 ms timer clamp (§3.3).
const channel = new MessageChannel();
const soon: (() => void)[] = [];
channel.port1.onmessage = () => soon.shift()?.();

const sim = new FakeSim({
  post: (msg, transfer) => postMessage(msg, { transfer: transfer ?? [] }),
  now: () => performance.now(),
  wake: (ms, f) => {
    if (ms > 4) return setTimeout(f, ms);
    soon.push(f);
    channel.port2.postMessage(0);
    return null;
  },
  cancel: (h) => {
    if (h !== null) clearTimeout(h as ReturnType<typeof setTimeout>);
  },
  protos: async () => {
    const r = await fetch(`${FAKE_DATA}prototypes.json`);
    if (!r.ok) throw new Error(`${FAKE_DATA}prototypes.json: HTTP ${r.status}`);
    return r.json();
  },
  protosBin: async () => {
    const r = await fetch(`${FAKE_DATA}prototypes.bin`);
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  },
});

self.addEventListener('message', (e: MessageEvent) => {
  sim.handle(e.data).catch((err: unknown) => {
    postMessage({
      t: 'log',
      level: 'error',
      msg: `fake sim: ${err instanceof Error ? err.message : String(err)}`,
    });
  });
});

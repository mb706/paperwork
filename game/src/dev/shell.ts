// The worker shell's dev page (`/src/dev/shell.html`; C3): SimHost with real workers (the sim worker, a worldgen
// pool and the IO worker, OPFS where the browser has it) and whatever modules a test passes, so Playwright checks
// the shell in Chrome and Firefox before and beside the real modules (e2e/shell.spec.ts passes the stub modules of
// test/stubs). Worker logs go to `__shellDev.logs`, not the console: traps are expected here.
import { IoClient } from '../app/io-client.ts';
import { SimHost } from '../app/sim-host.ts';
import { NewWorldCodec } from '../shared/gen/abi.ts';
import { decodePacket } from '../shared/gen/packet.ts';
import type { BuildManifest } from '../shared/protocol.ts';
import { installGameHooks } from './game-hooks.ts';

interface ShellDev {
  start(sim: string, gen: string): Promise<{ gen: number; tick: number; store: string }>;
  host: SimHost | null;
  logs: string[];
  packets: { gen: number; tick: number; flags: number; sections: string[] }[];
  generations: number[];
  traps: { gen: number; tick: number; message: string; report: string | null }[];
  owner: boolean | null;
}

declare global {
  interface Window {
    __shellDev?: ShellDev;
  }
}

const unb64 = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const status = (text: string) => {
  const el = document.querySelector<HTMLElement>('[data-testid="shell-status"]');
  if (el) el.textContent = text;
};

const dev: ShellDev = {
  host: null,
  logs: [],
  packets: [],
  generations: [],
  traps: [],
  owner: null,
  async start(simB64, genB64) {
    const r = await fetch('/data/build-manifest.json');
    const build = (await r.json()) as BuildManifest;
    const [sim, gen] = await Promise.all([
      WebAssembly.compile(unb64(simB64)),
      WebAssembly.compile(unb64(genB64)),
    ]);
    const io = new IoClient(
      new Worker(new URL('../app/workers/io.ts', import.meta.url), { type: 'module', name: 'io' }),
    );
    io.onLog = (level, msg) => dev.logs.push(`${level}: ${msg}`);
    const host = new SimHost({
      build,
      sim,
      gen,
      createSim: () =>
        new Worker(new URL('../app/workers/sim.ts', import.meta.url), { type: 'module', name: 'sim' }),
      createGen: () =>
        new Worker(new URL('../app/workers/gen.ts', import.meta.url), { type: 'module', name: 'gen' }),
      genWorkers: 2,
      io,
      test: true,
      events: {
        log: (level, msg) => dev.logs.push(`${level}: ${msg}`),
        packet: (bytes, g) => {
          const p = decodePacket(bytes);
          dev.packets.push({
            gen: g,
            tick: p.header.tick,
            flags: p.header.flags,
            sections: p.sections.map((s) => s.name),
          });
        },
        generation: (g) => dev.generations.push(g),
        trap: (t) => {
          dev.traps.push(t);
          status(`trapped at tick ${t.tick}; recovering`);
        },
        storage: (s) => {
          dev.owner = s.owner;
        },
      },
    });
    dev.host = host;
    installGameHooks(host);
    // A clean slate: earlier runs' saves go.
    const list = await io.request({ t: 'list' });
    if (list.t === 'list') for (const s of list.saves) await io.request({ t: 'delete', name: s.name });
    const b = await host.newGame({ ...NewWorldCodec.defaults(), seed: 1945 });
    const store = await io.store;
    status(`generation ${b.gen}, tick ${b.tick}, saves in ${store}`);
    return { gen: b.gen, tick: b.tick, store };
  },
};

window.__shellDev = dev;

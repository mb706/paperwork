// The M0 placeholder page: it proves the build end to end. The data stage's outputs load; the main thread compiles
// sim.wasm and gen.wasm once (10 §2.3, §9.7) and SimHost boots a fresh sim worker with a worldgen pool and the IO
// worker (§3.1): the handshake refuses a stale module (§15.1), and a module that passes it gets a new world. The
// UI package replaces this page with the menu. `?sim=inline` runs the shell on this thread (§3.1); dev builds and
// `?dev=1` install `window.__game` (§3.5); `?test=1` starts the world paused.
import genWasmUrl from 'virtual:gen-wasm';
import simWasmUrl from 'virtual:sim-wasm';
import { ABI_VERSION, NewWorldCodec } from '../shared/gen/abi.ts';
import type { BuildManifest } from '../shared/protocol.ts';
import { inlineSim } from './inline.ts';
import { IoClient } from './io-client.ts';
import { RefusedError, SimHost } from './sim-host.ts';
import { compileModule } from './wasm.ts';

function show(id: string, text: string): void {
  const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (el) el.textContent = text;
}

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

interface Prototypes {
  build: string;
  item: unknown[];
  fluid: unknown[];
  recipe: unknown[];
  entity: unknown[];
  resource: unknown[];
  tile: unknown[];
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const [manifest, protos] = await Promise.all([
    json<BuildManifest>('/data/build-manifest.json'),
    json<Prototypes>('/data/prototypes.json'),
  ]);
  show(
    'build-status',
    `${manifest.build}${manifest.dev ? ' (dev)' : ''} · ${manifest.buildHash.slice(0, 12)}`,
  );
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  show(
    'data-status',
    `${protos.build}: ${count(protos.item.length + protos.fluid.length, 'item', 'items')}, ` +
      `${count(protos.recipe.length, 'recipe', 'recipes')}, ${count(protos.entity.length, 'entity', 'entities')}, ` +
      `${count(protos.resource.length, 'resource', 'resources')}, ${count(protos.tile.length, 'tile', 'tiles')}`,
  );
  const [sim, gen] = await Promise.all([compileModule(simWasmUrl), compileModule(genWasmUrl)]);
  const io = new IoClient(
    new Worker(new URL('./workers/io.ts', import.meta.url), { type: 'module', name: 'io' }),
  );
  const log = (level: 'info' | 'warn' | 'error', msg: string) =>
    (level === 'error' ? console.error : level === 'warn' ? console.warn : console.info)(msg);
  io.onLog = log;
  const inline = params.get('sim') === 'inline';
  const host = new SimHost({
    build: manifest,
    sim,
    gen,
    createSim: inline
      ? () =>
          inlineSim({
            protos: async () => new Uint8Array(await (await fetch('/data/prototypes.bin')).arrayBuffer()),
          })
      : () => new Worker(new URL('./workers/sim.ts', import.meta.url), { type: 'module', name: 'sim' }),
    createGen: () =>
      new Worker(new URL('./workers/gen.ts', import.meta.url), { type: 'module', name: 'gen' }),
    genWorkers: 2,
    io,
    test: params.get('test') === '1',
    events: {
      log,
      // §3.6's trap notice, until the UI package shows its own: SimHost reloads the last save meanwhile.
      trap: (t) =>
        show('sim-status', `sim.wasm trapped at tick ${t.tick}: ${t.message}; reloading the last save`),
      generation: (g) => {
        if (g > 1) show('sim-status', `sim.wasm ABI ${ABI_VERSION}, world bound (generation ${g})`);
      },
    },
  });
  // §9.7: dev code (`__game`) lives in a chunk loaded only by dev builds or `?dev=1`.
  if (import.meta.env.DEV || params.get('dev') === '1')
    await import('../dev/game-hooks.ts').then((m) => m.installGameHooks(host));
  try {
    const b = await host.newGame({ ...NewWorldCodec.defaults(), seed: 1945 });
    show('sim-status', `sim.wasm ABI ${ABI_VERSION}, world bound at tick ${b.tick}`);
    // §8.4: autosave every 5 minutes into 3 rotating slots, and a save attempted on exit; 07 §19.3: a hidden
    // page pauses single player (and autosaves if the last save is older than a minute).
    if (params.get('test') !== '1') host.startAutosave();
    document.addEventListener('visibilitychange', () => host.setHidden(document.hidden));
    addEventListener('pagehide', () => {
      void host.save('exit');
    });
  } catch (e) {
    // The M0 scaffold module (ABI 0) is refused by the handshake until the sim package's module lands.
    if (e instanceof RefusedError) show('sim-status', `sim.wasm ABI ${e.abi}, refused: ${e.message}`);
    else throw e;
  }
}

// `?sim=fake` (10 §15.10) runs the fake sim instead; dev builds only, since the dev server serves its data.
const fake = import.meta.env.DEV && new URLSearchParams(location.search).get('sim') === 'fake';
const start = fake ? () => import('./fake-mode.ts').then((m) => m.runFake(show)) : main;
start().catch((e: unknown) => {
  show('sim-status', `failed: ${e instanceof Error ? e.message : String(e)}`);
  console.error(e);
});

// The M0 scaffold's placeholder page: it proves the build end to end. The data stage's outputs load,
// the main thread compiles sim.wasm once (10 §2.3) and hands the compiled module to a fresh sim worker,
// which instantiates it and reports its ABI version. The UI package replaces this page with the menu.
import simWasmUrl from 'virtual:sim-wasm';

function show(id: string, text: string): void {
  const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (el) el.textContent = text;
}

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

interface Manifest {
  build: string;
  buildHash: string;
  dev: boolean;
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
  const [manifest, protos] = await Promise.all([
    json<Manifest>('/data/build-manifest.json'),
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
  const module = await WebAssembly.compileStreaming(fetch(simWasmUrl));
  const worker = new Worker(new URL('./workers/sim.ts', import.meta.url), { type: 'module', name: 'sim' });
  const abi = await new Promise<number>((resolve, reject) => {
    worker.addEventListener('message', (e: MessageEvent<{ t: string; abi?: number; message?: string }>) => {
      if (e.data.t === 'ready' && typeof e.data.abi === 'number') resolve(e.data.abi);
      else reject(new Error(e.data.message ?? 'the sim worker failed'));
    });
    worker.addEventListener('error', (e) => reject(new Error(e.message)));
    worker.postMessage({ t: 'boot', module });
  });
  show('sim-status', `sim.wasm ABI ${abi}, instantiated in the sim worker`);
}

main().catch((e: unknown) => {
  show('sim-status', `failed: ${e instanceof Error ? e.message : String(e)}`);
  console.error(e);
});

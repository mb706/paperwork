// The page's entry (10 §3.1, §7; UI wiring by C5): loads the build manifest and the sprite manifest's DOM part
// (the Survey skin, fonts and icon sheets, 10 §9.3), mounts the UI over the world canvas, and runs worlds through
// the session (session.ts). The main thread compiles sim.wasm once (§2.3) and proves it instantiates in a worker
// (the scaffold's probe, kept until the shell runs worlds); dev builds play on the fake sim (`?sim=fake`, the
// default until then; `?sim=real` selects the shell).
//
// Query parameters: `?test=1` stops the clock (`window.__game.step(n)` runs ticks, 10 §3.3); `?render=none`
// leaves the world canvas blank (no stand-in plate). `window.__ui` exposes the UI's test hooks in dev builds.
import simWasmUrl from 'virtual:sim-wasm';
import '../ui/styles/ui.css';
import { type DomManifest, mountUi, type UiHandle } from '../ui/index.ts';
import { type Backend, Session } from './session.ts';

interface Manifest {
  build: string;
  buildHash: string;
  dev: boolean;
  [key: string]: unknown;
}

declare global {
  interface Window {
    __ui?: UiHandle['test'] & { session: Session };
    __game?: { step(n: number): void; tick(): number; packets(): number };
  }
}

function show(id: string, text: string): void {
  const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (el) el.textContent = text;
}

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

/** The sprite manifest's DOM part, and the skin's stylesheet linked into the page (10 §9.3). */
async function loadSkin(): Promise<DomManifest | null> {
  try {
    const m = await json<{ dom?: DomManifest }>('/atlases/sprites.json');
    const dom = m.dom ?? null;
    if (dom?.ui.css) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `/${dom.ui.css}`;
      const loaded = new Promise<void>((resolve) => {
        link.onload = () => resolve();
        link.onerror = () => resolve();
      });
      document.head.appendChild(link);
      await loaded;
      await document.fonts.ready;
    }
    return dom;
  } catch {
    return null; // no asset build: the UI draws with fallback colours and stand-in icons
  }
}

let compiled: Promise<WebAssembly.Module> | null = null;
const compileSim = () => {
  compiled ??= WebAssembly.compileStreaming(fetch(simWasmUrl));
  return compiled;
};

/** The scaffold's probe: the module compiles here and instantiates in a fresh sim worker (§2.3, §3.1). */
async function probe(): Promise<void> {
  const module = await compileSim();
  const worker = new Worker(new URL('./workers/sim.ts', import.meta.url), { type: 'module', name: 'sim' });
  const abi = await new Promise<number>((resolve, reject) => {
    worker.addEventListener('message', (e: MessageEvent<{ t: string; abi?: number; message?: string }>) => {
      if (e.data.t === 'ready' && typeof e.data.abi === 'number') resolve(e.data.abi);
      else reject(new Error(e.data.message ?? 'the sim worker failed'));
    });
    worker.addEventListener('error', (e) => reject(new Error(e.message)));
    worker.postMessage({ t: 'boot', module });
  });
  worker.terminate();
  show('sim-status', `sim.wasm ABI ${abi}, instantiated in the sim worker`);
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const [manifest, protos, dom] = await Promise.all([
    json<Manifest>('/data/build-manifest.json'),
    json<{
      build: string;
      item: unknown[];
      recipe: unknown[];
      entity: unknown[];
      resource: unknown[];
      tile: unknown[];
    }>('/data/prototypes.json'),
    loadSkin(),
  ]);
  show(
    'data-status',
    `${protos.build}: ${protos.item.length} items, ${protos.recipe.length} recipes, ${protos.entity.length} entities, ${protos.resource.length} resources, ${protos.tile.length} tiles`,
  );
  const sim = params.get('sim');
  const backend: Backend = sim === 'real' ? 'real' : sim === 'fake' || import.meta.env.DEV ? 'fake' : 'real';
  const session = new Session({
    backend,
    test: params.get('test') === '1',
    build: manifest,
    module: () => compileSim().catch(() => null),
  });
  const root = document.getElementById('ui') as HTMLElement;
  const canvas = document.getElementById('world') as HTMLCanvasElement;
  const ui = mountUi({
    root,
    canvas,
    build: { build: manifest.build, buildHash: manifest.buildHash, dev: manifest.dev },
    session,
    dom,
    plate: params.get('render') !== 'none',
    control: (op) => session.control(op),
  });
  session.attach(ui);
  if (import.meta.env.DEV || params.get('dev') === '1') {
    window.__ui = Object.assign(ui.test, { session });
    window.__game = {
      step: (n) => session.step(n),
      tick: () => session.tick,
      packets: () => session.packets,
    };
  }
  show(
    'build-status-probe',
    `${manifest.build}${manifest.dev ? ' (dev)' : ''} · ${manifest.buildHash.slice(0, 12)}`,
  );
  await probe();
}

main().catch((e: unknown) => {
  show('sim-status', `failed: ${e instanceof Error ? e.message : String(e)}`);
  console.error(e);
});

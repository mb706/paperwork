// The application's bootstrap (10 §3.1, §8.2, §8.4, §9.7; C3-r1 16): what the page needs to run worlds, built
// once, and handed to the packages that attach to it (main.ts composes them). `createApp`:
// - fetches the build manifest and compiles sim.wasm and gen.wasm once (§9.7: posted to every fresh worker);
// - starts the page's IO worker (saves, and the saves' ownership between tabs, §8.2);
// - creates the one SimHost: worlds, actions, the view request, subscriptions, saves, pausing, trap recovery;
// - wires the page's lifecycle: autosave (§8.4), the exit save on `pagehide`, the hidden page (07 §19.3);
// - installs `window.__game` in dev builds and with `?dev=1` (§3.5), from a chunk only those load.
// It starts no world: the UI's menu does (`app.host.newGame`, `app.host.loadSave`); until the UI package lands,
// `placeholder(app)` shows the M0 page and starts one.
//
// Query parameters: `?test=1` (worlds start paused; `__game.step(n)` runs ticks, §3.3), `?sim=inline` (the
// shell on this thread, §3.1), `?dev=1` (`__game` in a production build).
import genWasmUrl from 'virtual:gen-wasm';
import simWasmUrl from 'virtual:sim-wasm';
import type { GameHooks } from '../dev/game-hooks.ts';
import { ABI_VERSION, NewWorldCodec } from '../shared/gen/abi.ts';
import type { BuildManifest } from '../shared/protocol.ts';
import { inlineSim } from './inline.ts';
import { IoClient } from './io-client.ts';
import { RefusedError, SimHost } from './sim-host.ts';
import { compileModule } from './wasm.ts';

/** What every package gets: attach to `host` (its `on` events), never create another one. */
export interface App {
  readonly build: BuildManifest;
  readonly params: URLSearchParams;
  /** Worlds and everything about them (§3; src/app/sim-host.ts): `host.on('packet' | 'generation' | …)`. */
  readonly host: SimHost;
  readonly io: IoClient;
  /** `?test=1`: worlds start paused and `__game.step(n)` drives them. */
  readonly test: boolean;
  /** `window.__game` (dev builds, `?dev=1`): packages add their hooks with `hooks.register({...})`. */
  readonly hooks: GameHooks | null;
}

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

const consoleLog = (level: 'info' | 'warn' | 'error', msg: string) =>
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.info)(msg);

export async function createApp(params: URLSearchParams): Promise<App> {
  const build = await json<BuildManifest>('/data/build-manifest.json');
  const [sim, gen] = await Promise.all([compileModule(simWasmUrl), compileModule(genWasmUrl)]);
  const io = new IoClient(
    new Worker(new URL('./workers/io.ts', import.meta.url), { type: 'module', name: 'io' }),
  );
  io.onLog = consoleLog;
  const test = params.get('test') === '1';
  const inline = params.get('sim') === 'inline';
  const host = new SimHost({
    build,
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
    test,
  });
  host.on('log', consoleLog);
  // §8.4: autosave every 5 minutes into 3 rotating slots, and a save attempted on exit; 07 §19.3: a hidden
  // page pauses single player (and autosaves if the last save is older than a minute).
  if (!test) host.startAutosave();
  document.addEventListener('visibilitychange', () => host.setHidden(document.hidden));
  addEventListener('pagehide', () => {
    host.save('exit').catch(() => {});
  });
  // §9.7: dev code (`__game`) lives in a chunk loaded only by dev builds or `?dev=1`.
  const hooks =
    import.meta.env.DEV || params.get('dev') === '1'
      ? (await import('../dev/game-hooks.ts')).installGameHooks(host)
      : null;
  return { build, params, host, io, test, hooks };
}

/** Writes one of the placeholder page's status lines. */
export function show(id: string, text: string): void {
  const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (el) el.textContent = text;
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

/**
 * The M0 placeholder page (until the UI package's menu replaces it): the build and data lines, the saves'
 * owner, a new world, and its status (refused while sim.wasm is the scaffold; the trap notice).
 */
export async function placeholder(app: App): Promise<void> {
  const { build, host } = app;
  show('build-status', `${build.build}${build.dev ? ' (dev)' : ''} · ${build.buildHash.slice(0, 12)}`);
  const protos = await json<Prototypes>('/data/prototypes.json');
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  show(
    'data-status',
    `${protos.build}: ${count(protos.item.length + protos.fluid.length, 'item', 'items')}, ` +
      `${count(protos.recipe.length, 'recipe', 'recipes')}, ${count(protos.entity.length, 'entity', 'entities')}, ` +
      `${count(protos.resource.length, 'resource', 'resources')}, ${count(protos.tile.length, 'tile', 'tiles')}`,
  );
  // §3.6's trap notice and §8.2's read-only notice, until the UI shows its own.
  host.on('trap', (t) =>
    show('sim-status', `sim.wasm trapped at tick ${t.tick}: ${t.message}; reloading the last autosave`),
  );
  host.on('generation', (g) => {
    if (g > 1) show('sim-status', `sim.wasm ABI ${ABI_VERSION}, world bound (generation ${g})`);
  });
  const owner = (o: boolean, reason?: string) =>
    show('storage-status', o ? 'saves: this tab' : `saves: read-only (${reason ?? 'another tab owns them'})`);
  if (host.owner !== null) owner(host.owner);
  host.on('storage', (s) => owner(s.owner, s.reason));
  try {
    const b = await host.newGame({ ...NewWorldCodec.defaults(), seed: 1945 });
    show('sim-status', `sim.wasm ABI ${ABI_VERSION}, world bound at tick ${b.tick}`);
  } catch (e) {
    // A stale or scaffold module is refused by the handshake (§15.1).
    if (e instanceof RefusedError) show('sim-status', `sim.wasm ABI ${e.abi}, refused: ${e.message}`);
    else throw e;
  }
}

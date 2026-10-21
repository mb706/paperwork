// The UI on the App (10 §7; C3's composition root, main.ts: `await mountUi(app, world, audio)`). It loads what the UI
// draws with (the prototypes the page's build serves, the sprite manifest's DOM part and the Survey skin), takes the
// input over from the world view's stand-ins (`devInput.detach()`, C4-r1 12), and mounts the UI over the world
// canvas on the App's host and world view: the menu starts worlds through `app.host` (new game, load, exit, saves),
// pauses under the game menu, and offers *Take over* (07 §19.2). `window.__game.ui` holds its test hooks in dev
// builds. The page's hidden diagnostics (the smoke tests read them) follow the build, the data and the world.
import '../ui/styles/ui.css';
import { ABI_VERSION } from '../shared/gen/abi.ts';
import type { PrototypesJson } from '../shared/gen/protos.ts';
import {
  characterFacts,
  type DomManifest,
  mountUi as mount,
  type UiAudio,
  type UiHandle,
} from '../ui/index.ts';
import { type App, show } from './app.ts';
import type { WorldView } from './world-view.ts';

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

async function bytes(url: string): Promise<Uint8Array | null> {
  const r = await fetch(url).catch(() => null);
  return r?.ok ? new Uint8Array(await r.arrayBuffer()) : null;
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

/** F4 (I §4.21, dev builds): the world view's debug overlays, cycled as its stand-in did. */
function debugKeys(world: WorldView) {
  const cycle = ['none', 'tiles', 'boxes', 'all'] as const;
  let at = 0;
  return (control: 'debug-toggle-debug-settings' | 'debug-toggle-basic'): boolean => {
    const r = world.renderer;
    if (!r || control !== 'debug-toggle-debug-settings') return false;
    at = (at + 1) % cycle.length;
    const m = cycle[at];
    r.debug = {
      tileGrid: m === 'tiles' || m === 'all',
      chunkGrid: m !== 'none',
      collision: m === 'boxes' || m === 'all',
      selection: m === 'all',
      positions: m === 'boxes' || m === 'all',
    };
    return true;
  };
}

/** The diagnostics line's counts (developer text, not the canon's). */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export async function mountUi(app: App, world: WorldView, audio?: UiAudio): Promise<UiHandle> {
  const { build, host } = app;
  show('build-status', `${build.build}${build.dev ? ' (dev)' : ''} · ${build.buildHash.slice(0, 12)}`);
  const [protos, bin, dom] = await Promise.all([
    json<PrototypesJson>('/data/prototypes.json'),
    bytes('/data/prototypes.bin'),
    loadSkin(),
  ]);
  show(
    'data-status',
    `${protos.build}: ${count(protos.item.length + protos.fluid.length, 'item', 'items')}, ` +
      `${count(protos.recipe.length, 'recipe', 'recipes')}, ${count(protos.entity.length, 'entity', 'entities')}, ` +
      `${count(protos.resource.length, 'resource', 'resources')}, ${count(protos.tile.length, 'tile', 'tiles')}`,
  );
  show('sim-status', `sim.wasm ABI ${ABI_VERSION}, compiled`);
  host.on('bound', (b) => show('sim-status', `sim.wasm ABI ${ABI_VERSION}, world bound at tick ${b.tick}`));
  host.on('trap', (t) => show('sim-status', `sim.wasm trapped at tick ${t.tick}: ${t.message}`));
  const owner = (o: boolean | null, reason?: string) =>
    show(
      'storage-status',
      o === null
        ? 'saves: unknown'
        : o
          ? 'saves: this tab'
          : `saves: read-only (${reason ?? 'another tab owns them'})`,
    );
  owner(host.owner);
  host.on('storage', (s) => owner(s.owner, s.reason));
  // The UI owns input from here (the world view's wheel, F4, F5 and F9 stand-ins go).
  world.devInput.detach();
  const ui = mount({
    root: document.getElementById('ui') as HTMLElement,
    host,
    world,
    build: { build: build.build, buildHash: build.buildHash, dev: build.dev },
    protos,
    character: characterFacts(protos, bin),
    dom,
    debugKey: debugKeys(world),
    ...(audio ? { audio } : {}),
  });
  app.hooks?.register({ ui: ui.test });
  return ui;
}

// The page's composition root (10 §3.1, §9.7; C3-r1 16). `createApp` (app.ts) builds what runs worlds: the
// compiled modules, the IO worker, the one SimHost with the page's lifecycle, and `window.__game`. The other
// packages attach to that App here, one line each, and never create a second host:
//   - the renderer (C4): `attachRenderer(app)`: `app.host.on('packet' | 'generation')`, `app.host.setView(…)`;
//   - the UI (C5): `mountUi(app)`: the menu starts worlds (`app.host.newGame`, `loadSave`, `exit`), pauses under
//     menus (`app.host.setMenuPause`), offers *Take over* (`app.host.takeOver`, `on('storage')`), and replaces
//     `placeholder(app)`;
//   - audio (C7): `attachAudio(app)`: `app.host.on('packet' | 'generation')`.
// Packets go to every `packet` listener in turn, and back to the worker once all have returned (§15.4).
// `?sim=fake` (dev builds) runs the fake sim's page instead (10 §15.10).
import { createApp, placeholder, show } from './app.ts';

async function main(): Promise<void> {
  const app = await createApp(new URLSearchParams(location.search));
  // ── Extension points: attach here, in this order ────────────────────────────────────────────────────────
  // attachRenderer(app); // C4
  // attachAudio(app);    // C7
  // mountUi(app);        // C5 (replaces the placeholder below)
  await placeholder(app);
}

const fake = import.meta.env.DEV && new URLSearchParams(location.search).get('sim') === 'fake';
const start = fake ? () => import('./fake-mode.ts').then((m) => m.runFake(show)) : main;
start().catch((e: unknown) => {
  show('sim-status', `failed: ${e instanceof Error ? e.message : String(e)}`);
  console.error(e);
});

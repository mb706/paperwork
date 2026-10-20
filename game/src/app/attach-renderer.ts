// The renderer on the App (10 §3.1, §6; C3's composition root, main.ts; C4-r1 12): one world view per page, fed by the
// host's packets and generations, sending its view requests through the host. It returns the WorldViewApi
// (src/shared/world-view.ts) that the UI (C5) attaches to: the camera the frames are drawn with, picking, the view
// model, zoom and follow, the hovered entity, frame callbacks, readiness. The UI mounts after it and owns input:
// `world.devInput.detach()` removes the stand-in wheel, F4, F5 and F9 (or `attachRenderer(app, { devInput: false })`).
//
// `?render=` chooses how frames are drawn: 'continuous' (requestAnimationFrame; the default), 'on-demand' (frames
// from `__render.frame()`, the default with `?test=1`), or 'none' (no WebGL: the view model, camera and picking still
// work). Without atlases (`npm run assets` not run) the world is not drawn, quietly.

import { PacketFlags, PacketHeaderCodec, type ViewRequest, ViewRequestCodec } from '../shared/gen/packet.ts';
import type { PrototypesJson } from '../shared/gen/protos.ts';
import type { App } from './app.ts';
import { createWorldView, type WorldView, type WorldViewOptions } from './world-view.ts';

export interface AttachOptions {
  /** The stand-in input (wheel, F4, F5, F9): on until the UI's input layer replaces it. */
  devInput?: boolean;
  /** Where the canvas goes (default: the page's body), full size under the DOM UI. */
  container?: HTMLElement;
  /** The core art failed four times (§9.7): the UI's loading screen shows it; default, an alert with Retry. */
  onCoreError?: WorldViewOptions['onCoreError'];
  /** Some art failed four times and retries (§9.7's quiet notice): the UI's HUD shows it; default, a corner line. */
  onArtNotice?: WorldViewOptions['onArtNotice'];
}

/** How many view requests to remember (packets answer a recent one). */
const VIEWS_KEPT = 64;

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

export async function attachRenderer(app: App, opts: AttachOptions = {}): Promise<WorldView> {
  const param = app.params.get('render');
  const render =
    param === 'none' || param === 'on-demand' || param === 'continuous'
      ? param
      : app.test
        ? 'on-demand'
        : 'continuous';
  const protos = await fetchJson<PrototypesJson>('/data/prototypes.json');
  const protosBin = await fetch('/data/prototypes.bin')
    .then((r) => (r.ok ? r.arrayBuffer().then((b) => new Uint8Array(b)) : null))
    .catch(() => null);
  // The view requests by view_seq: a packet's held set is the one of the request it answers (§3.4, §15.4). The host
  // numbers them, and renumbers its last one when it sends it again to a new world (sim-host.ts, switchTo): a
  // sequence number past the last one known is that request again.
  const views = new Map<number, ViewRequest>();
  let last: ViewRequest | null = null;
  const world = await createWorldView({
    container: opts.container ?? document.body,
    manifestUrl: '/atlases/sprites.json',
    base: '/',
    protos,
    protosBin,
    render,
    devInput: opts.devInput ?? true,
    ...(opts.onCoreError ? { onCoreError: opts.onCoreError } : {}),
    ...(opts.onArtNotice ? { onArtNotice: opts.onArtNotice } : {}),
    onView: (w) => {
      const v: Omit<ViewRequest, 'view_seq'> = {
        ...ViewRequestCodec.defaults(),
        x0: w.x0,
        y0: w.y0,
        x1: w.x1,
        y1: w.y1,
        zoom: w.zoom,
        hovered_serial: w.hovered,
        // §15.6: audio hears half the view's width, at most 64 tiles
        audio_half_range: Math.min(64, Math.max(1, Math.ceil((w.x1 - w.x0) / 2))),
      };
      const seq = app.host.setView(v);
      last = { ...v, view_seq: seq };
      views.set(seq, last);
      views.delete(seq - VIEWS_KEPT);
    },
  });
  app.host.on('generation', () => world.reset());
  app.host.on('packet', (bytes) => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const full = (dv.getUint16(PacketHeaderCodec.OFFSET.flags, true) & PacketFlags.full) !== 0;
    const seq = dv.getUint32(PacketHeaderCodec.OFFSET.view_seq, true);
    const known = views.get(seq);
    const view = full
      ? null
      : (known ?? (last !== null && seq > last.view_seq ? { ...last, view_seq: seq } : undefined));
    world.applyPacket(bytes, view);
  });
  // `__game.render` (dev builds, `?dev=1`): the same hooks as `window.__render`
  if (app.hooks && window.__render) app.hooks.register({ render: window.__render });
  return world;
}

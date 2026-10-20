// The renderer's gallery (src/dev/gallery.html; C4): scenes drawn on demand for Playwright's screenshots and the
// frame-cost runs. `?scene=`
//   golden       the golden set's packets (test/golden/m0/packets, the golden flow) with the tiny atlas (10 §15.10)
//   golden-real  the same packets with the real Survey atlas (public/atlases, `npm run assets`)
//   transitions  the golden set's packet-transitions trace, packet by packet (`&step=N`, default all)
//   survey       C6's preview scene on the real atlas (scenes.ts), `&night=1` for the cyanotype
//   bench        a dense factory (`&entities=N&items=M&w=W&h=H`) for §6.12's main-thread frame cost
// `&zoom=`, `&x=`, `&y=` set the camera; `&clean=1` hides the status line. `window.__gallery` reports readiness.

import { createWorldView } from '../app/world-view.ts';
import { type ViewRequest, ViewRequestCodec } from '../shared/gen/packet.ts';
import type { PrototypesJson } from '../shared/gen/protos.ts';
import { benchScene, surveyScene } from './scenes.ts';

declare global {
  interface Window {
    __gallery?: { ready: Promise<void>; scene: string; packets: number; error?: string };
  }
}

const params = new URLSearchParams(location.search);
const scene = params.get('scene') ?? 'golden';
const status = document.getElementById('status') as HTMLElement;
if (params.get('clean') === '1') document.body.classList.add('clean');

async function bytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
async function json<T>(url: string): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await bytes(url))) as T;
}

const GOLDEN = '/test/golden/m0/';

interface Trace {
  traces: { name: string; calls: { call: string; in: string | null; out: string | null; note?: string }[] }[];
}

async function run(): Promise<number> {
  const fixture = scene === 'golden' || scene === 'transitions';
  const goldenData = scene.startsWith('golden') || scene === 'transitions';
  const protos = await json<PrototypesJson>(
    goldenData ? `${GOLDEN}protos/prototypes.json` : '/data/fake/prototypes.json',
  );
  const protosBin = goldenData ? null : await bytes('/data/fake/prototypes.bin').catch(() => null);
  const world = await createWorldView({
    container: document.body,
    manifestUrl: fixture ? '/test/fixtures/sprites/manifest.json' : '/atlases/sprites.json',
    base: fixture ? '/test/fixtures/sprites/' : '/',
    protos,
    protosBin,
    fake: !goldenData,
    render: 'on-demand',
  });
  const r = world.renderer;
  if (!r) throw new Error('no WebGL2');
  r.follow = -1;
  let packets = 0;
  let centre: [number, number] = [0, 0];
  if (scene === 'golden' || scene === 'golden-real') {
    const view = ViewRequestCodec.decode(await bytes(`${GOLDEN}view.bin`));
    // the golden flow (test/golden/README.md): the FULL packet, tick 0 answering the view, tick 1, tick 600
    const names = ['tick-0000-full', 'tick-0000', 'tick-0001', 'tick-0600'];
    for (const n of names) {
      world.applyPacket(await bytes(`${GOLDEN}packets/${n}.bin`), n.endsWith('full') ? null : view);
      packets++;
    }
    centre = [(view.x0 + view.x1) / 2, (view.y0 + view.y1) / 2];
  } else if (scene === 'transitions') {
    const trace = (await json<Trace>(`${GOLDEN}abi/traces.json`)).traces.find(
      (t) => t.name === 'packet-transitions',
    );
    if (!trace) throw new Error('no packet-transitions trace');
    const upto = Number(params.get('step') ?? Number.POSITIVE_INFINITY);
    let view: ViewRequest | null = null;
    for (const c of trace.calls) {
      if (c.call !== 'sim_extract' || !c.out || packets >= upto) continue;
      if (c.in) view = ViewRequestCodec.decode(await bytes(`${GOLDEN}${c.in}`));
      const pkt = await bytes(`${GOLDEN}${c.out}`);
      world.applyPacket(pkt, packets === 0 ? null : view);
      packets++;
      if (view) centre = [(view.x0 + view.x1) / 2, (view.y0 + view.y1) / 2];
    }
  } else if (scene === 'survey') {
    const s = surveyScene(protos, params.get('night') === '1');
    world.applyPacket(s.packet, s.view);
    packets = 1;
    centre = s.centre;
  } else if (scene === 'bench') {
    const w = Number(params.get('w') ?? 60);
    const h = Number(params.get('h') ?? 34);
    const s = benchScene(
      protos,
      Number(params.get('entities') ?? 2000),
      Number(params.get('items') ?? 2000),
      w,
      h,
    );
    world.applyPacket(s.packet, s.view);
    packets = 1;
  } else throw new Error(`unknown scene ${scene}`);
  r.camera.cx = Number(params.get('x') ?? centre[0]);
  r.camera.cy = Number(params.get('y') ?? centre[1]);
  r.camera.zoom = Number(params.get('zoom') ?? 1);
  await world.ready();
  r.frame();
  status.textContent = `${scene} · ${packets} packet(s) · zoom ${r.camera.zoom}`;
  return packets;
}

const ready = run().then(
  (n) => {
    if (window.__gallery) window.__gallery.packets = n;
  },
  (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    status.textContent = `failed: ${msg}`;
    if (window.__gallery) window.__gallery.error = msg;
    console.error(e);
  },
);
window.__gallery = { ready, scene, packets: 0 };

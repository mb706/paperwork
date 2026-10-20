// The world view: the renderer, the asset worker and its loader, wired together on the main thread (10 §6, §9.7).
// It loads sprites.json, checks it against the prototypes (a different prototypesHash is an error in dev builds,
// except in `?sim=fake`, whose M1 prototypes join the M0 atlas by name, C1c open issue 4), creates the canvas under
// the DOM UI, probes the GPU formats, starts the asset worker on them and feeds transcoded pages to the renderer.
// The app hands it every render packet with the view request the packet answers, and asks it for view requests
// when the visible tiles change. Input here is a stand-in until the UI package's input layer owns it: the wheel
// zooms (×1.1 per notch, I §3.15), F9 / Shift+F9 reset the zoom to 1× / 2×, F4 cycles the debug overlays, F5 the
// timings HUD (I §4.21). `window.__render` drives it in tests (on-demand frames, the camera, stats, context loss).

import { AssetLoader, type LoadedFile, type LoaderManifest } from '../assets/loader.ts';
import type { TargetFormat } from '../assets/worker/protocol.ts';
import { debugHud } from '../render/debug.ts';
import { deriveBeltMasks } from '../render/fake-belts.ts';
import { Atlas, type SpriteManifest } from '../render/manifest.ts';
import { Renderer } from '../render/renderer.ts';
import type { NO_DEBUG } from '../render/scene.ts';
import type { ViewRequest } from '../shared/gen/packet.ts';
import type { PrototypesJson } from '../shared/gen/protos.ts';
import { readPrototypesBin } from '../shared/gen/protos.ts';

export interface WorldViewOptions {
  /** Where the canvas goes: full size, under the DOM UI. */
  container: HTMLElement;
  /** sprites.json's URL; file paths in it are relative to `base`. */
  manifestUrl: string;
  base: string;
  protos: PrototypesJson;
  /** prototypes.bin, for the belts' speeds (absent: belts do not animate). */
  protosBin?: Uint8Array | null;
  /** `?sim=fake`: join by name, and derive belt connection masks the fake does not send. */
  fake?: boolean;
  /** `?render=`: 'continuous' (requestAnimationFrame), 'on-demand' (frames from __render.frame()), 'none'. */
  render?: 'continuous' | 'on-demand' | 'none';
  /** The visible tiles changed: the app sends a view request for them (10 §15.4). */
  onView?: (rect: { x0: number; y0: number; x1: number; y1: number; zoom: number }) => void;
}

export interface WorldView {
  renderer: Renderer | null;
  loader: AssetLoader | null;
  /** Applies a packet with the view request it answers (null: none yet; undefined: unchanged). */
  applyPacket(bytes: Uint8Array, view?: ViewRequest | null): void;
  /** Resolves when the core group is resident (the game's first frame waits for it, §9.7). */
  ready(): Promise<void>;
  dispose(): void;
}

interface RenderHooks {
  renderer: Renderer;
  frame(): void;
  camera(x: number, y: number, zoom?: number): void;
  follow(player: number): void;
  ready(): Promise<void>;
  stats(): unknown;
  debug(flags: Partial<typeof NO_DEBUG>): void;
  loseContext(ms?: number): Promise<void>;
}

declare global {
  interface Window {
    __render?: RenderHooks;
  }
}

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

export async function createWorldView(o: WorldViewOptions): Promise<WorldView> {
  const none: WorldView = {
    renderer: null,
    loader: null,
    applyPacket: () => {},
    ready: () => Promise.resolve(),
    dispose: () => {},
  };
  if (o.render === 'none') return none;
  const manifest = await json<SpriteManifest>(o.manifestUrl);
  const atlas = new Atlas(manifest);
  if (manifest.prototypesHash !== o.protos.prototypesHash) {
    const msg = `sprites.json was built for prototypes ${manifest.prototypesHash.slice(0, 12)}, the data is ${o.protos.prototypesHash.slice(0, 12)}`;
    if (!o.fake && import.meta.env.DEV)
      throw new Error(`${msg} (10 §15.7: an error in dev builds; run npm run assets)`);
    console.info(`${msg}: joined by name (fake mode)`);
  }
  let beltSpeed: number[] | undefined;
  if (o.protosBin)
    try {
      beltSpeed = readPrototypesBin(o.protosBin, undefined, []).entity.map((e) => e.belt_speed);
    } catch (e) {
      console.info(
        `prototypes.bin unreadable for belt speeds: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  const canvas = document.createElement('canvas');
  canvas.setAttribute('data-testid', 'world');
  canvas.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;display:block;z-index:0;touch-action:none';
  o.container.prepend(canvas);
  let loader: AssetLoader | null = null;
  const renderer = Renderer.create({
    canvas,
    atlas,
    protos: o.protos,
    ...(beltSpeed ? { beltSpeed } : {}),
    onFatal: (message) => fatal(o.container, message),
    onRestored: () => loader?.replay(),
    onCanvas: (c) => attachInput(c),
  });
  if (renderer === null) {
    canvas.remove();
    console.info('WebGL2 is not available: the world is not drawn (render=none)');
    return none;
  }
  renderer.mode = o.render === 'on-demand' ? 'on-demand' : 'continuous';
  const textures = renderer.textures;
  const worker = new Worker(new URL('../assets/worker.ts', import.meta.url), {
    type: 'module',
    name: 'assets',
  });
  loader = new AssetLoader({
    worker,
    manifest: manifest as unknown as LoaderManifest,
    base: new URL(o.base, location.href).href,
    colour: renderer.probe.colour as TargetFormat,
    shadow: renderer.probe.shadow as TargetFormat,
    levelOffset: textures ? textures.arrays.map((a) => a.offset) : [],
    terrainOffset: textures?.terrain?.offset ?? 0,
    terrainTiles: Object.keys(manifest.terrain?.tiles ?? {}).sort(),
    onFile: (f: LoadedFile) => renderer.enqueuePage(f),
    onRetry: (url, attempt, error) =>
      console.info(`asset ${url}: attempt ${attempt} failed (${error}); retrying`),
  });
  loader.start();
  const colourArray = atlas.arrayOfKind[0] as number;

  // the HUD (F5) and the visible-tiles watch
  const hud = document.createElement('pre');
  hud.style.cssText =
    'position:fixed;left:8px;bottom:8px;margin:0;padding:6px 8px;background:#f4ecd8e8;color:#2b2723;font:12px/1.35 "Courier Prime",monospace;z-index:5;display:none;pointer-events:none';
  o.container.append(hud);
  let showHud = false;
  let lastRect = '';
  const reportView = () => {
    if (!o.onView) return;
    const r = renderer.visibleTiles();
    const key = `${r.x0},${r.y0},${r.x1},${r.y1},${renderer.camera.zoom}`;
    if (key === lastRect) return;
    lastRect = key;
    o.onView({ ...r, zoom: renderer.camera.zoom });
  };
  let frames = 0;
  const missedKeys: number[] = [];
  const level0Keys: number[] = [];
  const afterFrame = () => {
    frames++;
    if (frames % 10 === 0 && loader) {
      missedKeys.length = 0;
      level0Keys.length = 0;
      const missed = renderer.scene.missed;
      for (let i = 0; i < missed.length; i++)
        if (missed[i] === 1) for (const k of atlas.sets[i]?.pageKeys ?? []) missedKeys.push(k);
      for (const l of renderer.pagesWantingLevel0()) level0Keys.push((colourArray << 16) | l);
      if (missedKeys.length > 0 || level0Keys.length > 0) loader.update(missedKeys, level0Keys);
    }
    if (showHud && frames % 10 === 0) hud.textContent = debugHud(renderer, loader);
    reportView();
  };
  let raf = 0;
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    if (renderer.mode !== 'continuous') return;
    if (renderer.frame(now)) afterFrame();
  };
  raf = requestAnimationFrame(loop);

  // input: a stand-in until the UI package's input layer owns these controls
  let wheelAcc = 0;
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 600 : e.deltaY;
    wheelAcc += px;
    while (Math.abs(wheelAcc) >= 100) {
      const step = wheelAcc > 0 ? -1 : 1;
      renderer.zoomBy(step);
      wheelAcc += step * 100;
    }
  };
  const debugCycle = ['none', 'tiles', 'boxes', 'all'] as const;
  let debugIndex = 0;
  const onKey = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.code === 'F9') {
      renderer.camera.zoom = e.shiftKey ? 2 : 1;
      e.preventDefault();
    } else if (e.code === 'F5') {
      showHud = !showHud;
      hud.style.display = showHud ? 'block' : 'none';
      if (showHud) hud.textContent = debugHud(renderer, loader);
      e.preventDefault();
    } else if (e.code === 'F4') {
      debugIndex = (debugIndex + 1) % debugCycle.length;
      const m = debugCycle[debugIndex];
      renderer.debug = {
        tileGrid: m === 'tiles' || m === 'all',
        chunkGrid: m !== 'none',
        collision: m === 'boxes' || m === 'all',
        selection: m === 'all',
        positions: m === 'boxes' || m === 'all',
      };
      e.preventDefault();
    }
  };
  function attachInput(c: HTMLCanvasElement) {
    c.addEventListener('wheel', onWheel, { passive: false });
  }
  attachInput(canvas);
  addEventListener('keydown', onKey);

  const ready = async () => {
    await loader?.ready('core');
    // delivered; now wait until the renderer has uploaded them
    for (;;) {
      if ((renderer.textures?.pending ?? 0) === 0) return;
      if (renderer.mode === 'on-demand') renderer.frame();
      await new Promise((r) => setTimeout(r, 16));
    }
  };
  if (import.meta.env.DEV || new URLSearchParams(location.search).get('dev') === '1')
    window.__render = {
      renderer,
      frame: () => {
        if (renderer.frame()) afterFrame();
      },
      camera: (x, y, zoom) => {
        renderer.follow = -1;
        renderer.camera.cx = x;
        renderer.camera.cy = y;
        if (zoom !== undefined) renderer.camera.zoom = zoom;
        reportView();
      },
      follow: (player) => {
        renderer.follow = player;
      },
      ready,
      stats: () => ({
        frame: { ...renderer.stats },
        memory: renderer.memory(),
        probe: renderer.probe,
        loader: loader ? { ...loader.stats } : null,
        mirror: {
          chunks: renderer.mirror.chunks.size,
          lines: renderer.mirror.lines.size,
          tick: renderer.mirror.tick,
        },
      }),
      debug: (flags) => {
        renderer.debug = { ...renderer.debug, ...flags };
      },
      loseContext: async (ms = 100) => {
        const ext = renderer.gl?.getExtension('WEBGL_lose_context');
        if (!ext) throw new Error('WEBGL_lose_context is not available');
        ext.loseContext();
        await new Promise((r) => setTimeout(r, ms));
        ext.restoreContext();
      },
    };
  return {
    renderer,
    loader,
    applyPacket: (bytes, view) => {
      renderer.applyPacket(bytes, view);
      if (o.fake) deriveBeltMasks(renderer.mirror, renderer.look);
    },
    ready,
    dispose: () => {
      cancelAnimationFrame(raf);
      removeEventListener('keydown', onKey);
      loader?.dispose();
      worker.terminate();
      renderer.dispose();
      canvas.remove();
      hud.remove();
    },
  };
}

/** A lost context that could not be recovered (10 §6.13): an error with a reload button. */
function fatal(container: HTMLElement, message: string): void {
  const box = document.createElement('div');
  box.setAttribute('role', 'alert');
  box.style.cssText =
    'position:fixed;inset:auto 0 40% 0;margin:auto;width:fit-content;padding:16px 20px;background:#f4ecd8;color:#2b2723;border:2px solid #6f5a36;z-index:10;font:14px "Libre Franklin",sans-serif';
  box.textContent = message;
  const b = document.createElement('button');
  b.textContent = 'Reload';
  b.style.marginLeft = '12px';
  b.addEventListener('click', () => location.reload());
  box.append(b);
  container.append(box);
}

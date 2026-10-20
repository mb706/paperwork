// The world view: the renderer, the asset worker and its loader, wired together on the main thread (10 §6, §9.7), as
// the UI and the other packages use it (src/shared/world-view.ts's WorldViewApi; src/app/attach-renderer.ts hands it
// out). It loads sprites.json, checks it against the prototypes (a different prototypesHash is an error in dev builds,
// except in `?sim=fake`, whose M1 prototypes join the M0 atlas by name, C1c open issue 4), creates the canvas under
// the DOM UI, probes the GPU formats, starts the asset worker on them and feeds transcoded pages to the renderer.
// Without WebGL2 (headless Firefox here), without atlases, or with `?render=none`, it still keeps the view model, the
// camera and picking; it only draws nothing.
//
// Readiness (C4-r1 4): `ready()` is gameplay's, the core art uploaded; the fourth failure of a core file rejects it
// and shows the error with Retry (placeholder English until the text canon has it); `settled()` (tests, screenshots)
// waits until every requested file has arrived or failed once and nothing is left to upload. A reallocation of the
// arrays (a restored context, a lower mode for the memory budget) renegotiates the loader's formats and levels under
// a new upload epoch (C4-r1 6). Input here is a stand-in until the UI package's input layer owns it (C4-r1 12): the
// wheel zooms (×1.1 per notch, I §3.15), F9 / Shift+F9 reset the zoom to 1× / 2×, F4 cycles the debug overlays, F5 the
// timings HUD (I §4.21); `devInput.detach()` removes it. `window.__render` drives it in tests.

import { AssetLoader, type LoadedFile, type LoaderManifest } from '../assets/loader.ts';
import type { FromWorker, TargetFormat } from '../assets/worker/protocol.ts';
import { debugHud } from '../render/debug.ts';
import { deriveBeltMasks } from '../render/fake-belts.ts';
import type { GpuFormat } from '../render/gl/formats.ts';
import { Atlas, type SpriteManifest } from '../render/manifest.ts';
import { Mirror, MO } from '../render/mirror.ts';
import { pick, type SelectionTable, selectionTable } from '../render/pick.ts';
import { PX_PER_TILE, ZOOM_MAX, ZOOM_MIN_WORLD } from '../render/projection.ts';
import { CONTEXT_ATTRS, Renderer } from '../render/renderer.ts';
import type { NO_DEBUG } from '../render/scene.ts';
import type { ViewRequest } from '../shared/gen/packet.ts';
import type { PrototypesJson } from '../shared/gen/protos.ts';
import { readPrototypesBin } from '../shared/gen/protos.ts';
import type { ViewModel, WorldCamera, WorldPick, WorldViewApi } from '../shared/world-view.ts';

/** The view request the world view wants (the app numbers it and sends it, 10 §15.4). */
export interface ViewWant {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  zoom: number;
  hovered: number;
}

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
  /** The view request changed (the visible tiles, the zoom, the hovered entity): the app sends it (10 §15.4). */
  onView?: (v: ViewWant) => void;
  /** Install the stand-in input (wheel, F4, F5, F9) at once (default true; the UI's input layer replaces it). */
  devInput?: boolean;
  /** A core file failed four times (§9.7); default: an alert with Retry. */
  onCoreError?: (message: string, retry: () => void) => void;
  /** Some file failed four times and still retries (§9.7's quiet notice); default: a line in the corner. */
  onArtNotice?: (on: boolean) => void;
}

/** The world view: the UI's WorldViewApi, and what the app drives. */
export interface WorldView extends WorldViewApi {
  readonly renderer: Renderer | null;
  readonly loader: AssetLoader | null;
  /** Applies a packet with the view request it answers (null: none yet; undefined: unchanged). */
  applyPacket(bytes: Uint8Array, view?: ViewRequest | null): void;
  /** Another world (a new state generation): the view model and every cache keyed by chunk or serial empty. */
  reset(): void;
  /**
   * Everything requested has arrived or failed once (it retries behind its placeholder), and nothing is left to
   * upload or build: what a test waits for before a screenshot (gameplay waits for `ready` only).
   */
  settled(): Promise<void>;
  dispose(): void;
}

interface RenderHooks {
  renderer: Renderer | null;
  world: WorldView;
  frame(): void;
  camera(x: number, y: number, zoom?: number): void;
  follow(player: number): void;
  ready(): Promise<void>;
  settled(): Promise<void>;
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

const tick16 = () => new Promise((r) => setTimeout(r, 16));

export async function createWorldView(o: WorldViewOptions): Promise<WorldView> {
  const sel = selectionTable(o.protos);
  if (o.render === 'none') return new LiveWorldView(o, sel, null);
  let manifest: SpriteManifest;
  try {
    manifest = await json<SpriteManifest>(o.manifestUrl);
  } catch (e) {
    console.info(
      `no atlases (${e instanceof Error ? e.message : String(e)}): run npm run assets; the world is not drawn`,
    );
    return new LiveWorldView(o, sel, null);
  }
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
  // WebGL2 first (headless Firefox here has none: then nothing else starts); the same attributes as the renderer's
  if (canvas.getContext('webgl2', CONTEXT_ATTRS) === null) {
    canvas.remove();
    console.info('WebGL2 is not available: the world is not drawn (render=none)');
    return new LiveWorldView(o, sel, null);
  }
  // the asset worker loads the transcoder at once and says what it can make; the renderer then allocates its
  // arrays in formats both the GPU and the transcoder support (10 §9.2)
  const worker = new Worker(new URL('../assets/worker.ts', import.meta.url), {
    type: 'module',
    name: 'assets',
  });
  const hello = await new Promise<Extract<FromWorker, { t: 'ready' }>>((resolve) => {
    const on = (e: MessageEvent<FromWorker>) => {
      if (e.data.t !== 'ready') return;
      worker.removeEventListener('message', on);
      resolve(e.data);
    };
    worker.addEventListener('message', on);
  });
  let view: LiveWorldView | null = null;
  const renderer = Renderer.create({
    canvas,
    atlas,
    protos: o.protos,
    ...(beltSpeed ? { beltSpeed } : {}),
    transcodable: hello.supports,
    // `?deny=bc7,astc` makes the format probe refuse formats, so tests reach the fallbacks (10 §9.2)
    denyFormats: (new URLSearchParams(location.search).get('deny') ?? '')
      .split(',')
      .filter(Boolean) as GpuFormat[],
    onFatal: (message) => fatal(o.container, message),
    onRestored: () => view?.renegotiate(),
    onEvict: (array, page) => view?.loader?.evicted(array, page),
    onCanvas: (c) => view?.moveCanvas(c),
  });
  if (renderer === null) {
    worker.terminate();
    canvas.remove();
    return new LiveWorldView(o, sel, null);
  }
  renderer.mode = o.render === 'on-demand' ? 'on-demand' : 'continuous';
  view = new LiveWorldView(o, sel, { renderer, worker, canvas, atlas, manifest });
  return view;
}

interface Drawing {
  renderer: Renderer;
  worker: Worker;
  canvas: HTMLCanvasElement;
  atlas: Atlas;
  manifest: SpriteManifest;
}

/** The camera as drawn (the renderer's last frame), in the canvas's CSS px; the view's own without a renderer. */
class DrawnCamera implements WorldCamera {
  private readonly v: LiveWorldView;
  constructor(v: LiveWorldView) {
    this.v = v;
  }
  private get d() {
    return this.v.renderer?.drawn ?? null;
  }
  get cx(): number {
    return this.d?.cx ?? this.v.free.cx;
  }
  get cy(): number {
    return this.d?.cy ?? this.v.free.cy;
  }
  get zoom(): number {
    return this.d?.zoom ?? this.v.free.zoom;
  }
  get width(): number {
    return this.v.canvasEl?.clientWidth || globalThis.innerWidth || 1;
  }
  get height(): number {
    return this.v.canvasEl?.clientHeight || globalThis.innerHeight || 1;
  }
  get scale(): number {
    return PX_PER_TILE * this.zoom;
  }
  /** Device px per CSS px, and the canvas centre in device px (the projection's origin). */
  private frame(): { dpr: number; ox: number; oy: number } {
    const d = this.d;
    if (d) return { dpr: d.dpr, ox: d.ox, oy: d.oy };
    return { dpr: 1, ox: Math.floor(this.width / 2), oy: Math.floor(this.height / 2) };
  }
  toWorld(px: number, py: number): { x: number; y: number } {
    const f = this.frame();
    const S = PX_PER_TILE * this.zoom * f.dpr;
    return { x: this.cx + (px * f.dpr - f.ox) / S, y: this.cy + (py * f.dpr - f.oy) / S };
  }
  toScreen(wx: number, wy: number): { x: number; y: number } {
    const f = this.frame();
    const S = PX_PER_TILE * this.zoom * f.dpr;
    return { x: ((wx - this.cx) * S + f.ox) / f.dpr, y: ((wy - this.cy) * S + f.oy) / f.dpr };
  }
  visible(): { x0: number; y0: number; x1: number; y1: number } {
    const a = this.toWorld(0, 0);
    const b = this.toWorld(this.width, this.height);
    return { x0: Math.floor(a.x), y0: Math.floor(a.y), x1: Math.ceil(b.x), y1: Math.ceil(b.y) };
  }
}

class LiveWorldView implements WorldView {
  readonly renderer: Renderer | null;
  loader: AssetLoader | null = null;
  readonly model: ViewModel;
  readonly camera: WorldCamera;
  /** Without a renderer: the camera the app steers (no frames, no snapping). */
  readonly free = { cx: 0, cy: 0, zoom: 1, follow: 0 as number | null };
  canvasEl: HTMLCanvasElement | null;
  readonly devInput: { attach(): void; detach(): void };
  private readonly o: WorldViewOptions;
  private readonly sel: SelectionTable;
  private readonly mirror: Mirror;
  private readonly draw: Drawing | null;
  private readonly frameListeners = new Set<(now: number) => void>();
  private shown = false;
  private hovered = 0;
  private raf = 0;
  private frames = 0;
  private showHud = false;
  private hud: HTMLPreElement | null = null;
  private notice: HTMLDivElement | null = null;
  private coreBox: HTMLDivElement | null = null;
  private inputOn = false;
  private wheelAcc = 0;
  private debugIndex = 0;
  // the per-frame bookkeeping allocates nothing unless something changed (10 §6: no per-frame allocation)
  private readonly tiles = new Int32Array(4);
  private readonly lastView = new Float64Array([
    Number.NaN,
    Number.NaN,
    Number.NaN,
    Number.NaN,
    Number.NaN,
    -1,
  ]);
  private readonly missedKeys: number[] = [];
  private readonly level0Keys: number[] = [];
  private readonly colourArray: number;

  constructor(o: WorldViewOptions, sel: SelectionTable, draw: Drawing | null) {
    this.o = o;
    this.sel = sel;
    this.draw = draw;
    this.renderer = draw?.renderer ?? null;
    this.mirror = this.renderer?.mirror ?? new Mirror();
    this.model = this.mirror;
    this.canvasEl = draw?.canvas ?? null;
    this.camera = new DrawnCamera(this);
    this.colourArray = draw ? (draw.atlas.arrayOfKind[0] as number) : 0;
    this.devInput = { attach: () => this.setInput(true), detach: () => this.setInput(false) };
    if (draw) this.startDrawing(draw);
    if (o.devInput !== false) this.setInput(true);
    if (import.meta.env.DEV || new URLSearchParams(location.search).get('dev') === '1') this.installHooks();
  }

  private startDrawing(d: Drawing): void {
    const r = d.renderer;
    const t = r.uploadConfig();
    this.loader = new AssetLoader({
      worker: d.worker,
      manifest: d.manifest as unknown as LoaderManifest,
      base: new URL(this.o.base, location.href).href,
      colour: t.colour as TargetFormat,
      shadow: t.shadow as TargetFormat,
      levelOffset: t.levelOffset,
      terrainOffset: t.terrainOffset,
      terrainTiles: Object.keys(d.manifest.terrain?.tiles ?? {}).sort(),
      onFile: (f: LoadedFile) => r.enqueuePage(f),
      onRetry: (url, attempt, error) =>
        console.info(`asset ${url}: attempt ${attempt} failed (${error}); retrying`),
      onCoreError: (m) => (this.o.onCoreError ?? this.showCoreError)(m, () => this.retryArt()),
      onNotice: (on) => (this.o.onArtNotice ?? this.showNotice)(on),
    });
    this.loader.start();
    this.schedulePrefetch();
    this.hud = document.createElement('pre');
    this.hud.style.cssText =
      'position:fixed;left:8px;bottom:8px;margin:0;padding:6px 8px;background:#f4ecd8e8;color:#2b2723;font:12px/1.35 "Courier Prime",monospace;z-index:5;display:none;pointer-events:none';
    this.o.container.append(this.hud);
    this.raf = requestAnimationFrame(this.loop);
  }

  /** On a device pixel ratio of 2, every page's High level 0 in idle time once core is in (10 §9.7 rule 5). */
  private schedulePrefetch(): void {
    const r = this.renderer;
    const l = this.loader;
    if (!r || !l || r.dpr() < 2) return;
    l.ready('core').then(
      () => setTimeout(() => l.prefetchLevel0(), 2000),
      () => {},
    );
  }

  /** The arrays were allocated again (a restored context, a lower mode): a new upload epoch (C4-r1 6). */
  renegotiate(): void {
    const r = this.renderer;
    const l = this.loader;
    if (!r || !l) return;
    const t = r.uploadConfig();
    l.reconfigure({
      colour: t.colour as TargetFormat,
      shadow: t.shadow as TargetFormat,
      levelOffset: t.levelOffset,
      terrainOffset: t.terrainOffset,
    });
    this.schedulePrefetch();
  }

  private readonly loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    const r = this.renderer;
    if (r?.mode !== 'continuous') return;
    if (r.frame(now)) this.afterFrame(now);
  };

  /** One frame on demand (tests, `?render=on-demand`). */
  frameNow(): void {
    const r = this.renderer;
    if (r?.frame()) this.afterFrame(performance.now());
  }

  /**
   * What the renderer drew without its art (or wants at High) goes to the loader: every 10th frame when running,
   * every frame on demand (tests wait for the result); then the HUD, the view request and the frame listeners.
   */
  private afterFrame(now: number): void {
    const r = this.renderer as Renderer;
    const loader = this.loader;
    this.frames++;
    if ((r.mode === 'on-demand' || this.frames % 10 === 0) && loader && this.draw) {
      let nm = 0;
      let nl = 0;
      const missed = r.scene.missed;
      for (let i = 0; i < missed.length; i++) {
        if (missed[i] !== 1) continue;
        const keys = this.draw.atlas.sets[i]?.pageKeys;
        if (keys) for (let j = 0; j < keys.length; j++) this.missedKeys[nm++] = keys[j] as number;
      }
      const want = r.scene.wantLevel0;
      for (let l = 0; l < want.length; l++)
        if (want[l] === 1) this.level0Keys[nl++] = (this.colourArray << 16) | l;
      if (nm > 0 || nl > 0) loader.update(this.missedKeys, this.level0Keys, nm, nl);
    }
    if (this.showHud && this.hud && this.frames % 10 === 0) this.hud.textContent = debugHud(r, loader);
    this.reportView();
    for (const f of this.frameListeners) f(now);
  }

  private reportView(force = false): void {
    if (!this.o.onView) return;
    const t = this.tiles;
    const r = this.renderer;
    let zoom: number;
    if (r) {
      r.visibleTilesInto(t);
      zoom = r.camera.zoom;
    } else {
      const v = this.camera.visible();
      t[0] = v.x0;
      t[1] = v.y0;
      t[2] = v.x1;
      t[3] = v.y1;
      zoom = this.free.zoom;
    }
    const lv = this.lastView;
    if (
      !force &&
      t[0] === lv[0] &&
      t[1] === lv[1] &&
      t[2] === lv[2] &&
      t[3] === lv[3] &&
      zoom === lv[4] &&
      this.hovered === lv[5]
    )
      return;
    lv[0] = t[0] as number;
    lv[1] = t[1] as number;
    lv[2] = t[2] as number;
    lv[3] = t[3] as number;
    lv[4] = zoom;
    lv[5] = this.hovered;
    this.o.onView({
      x0: t[0] as number,
      y0: t[1] as number,
      x1: t[2] as number,
      y1: t[3] as number,
      zoom,
      hovered: this.hovered,
    });
  }

  // ---------------------------------------------------------------------------------------------- the API

  active(): boolean {
    return this.shown;
  }

  pickAt(px: number, py: number): WorldPick | null {
    if (!this.shown) return null;
    const w = this.camera.toWorld(px, py);
    return pick(this.mirror, this.sel, w.x, w.y);
  }

  character(): { x: number; y: number } | null {
    const player = this.renderer ? this.renderer.follow : (this.free.follow ?? -1);
    const mv = this.mirror.movers;
    for (let i = 0; i < mv.count; i++) {
      const o = i * 32;
      if (mv.view.getUint8(o + MO.kind) !== 0) continue;
      if (player >= 0 && mv.view.getUint16(o + MO.aux, true) !== player) continue;
      return { x: mv.view.getInt32(o + MO.x, true) / 256, y: mv.view.getInt32(o + MO.y, true) / 256 };
    }
    return null;
  }

  zoomBy(notches: number): void {
    if (this.renderer) this.renderer.zoomBy(notches);
    else this.setZoom(this.free.zoom * 1.1 ** notches);
    this.reportView();
  }

  setZoom(z: number): void {
    const c = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN_WORLD, z));
    if (this.renderer) this.renderer.camera.zoom = c;
    else this.free.zoom = c;
    this.reportView();
  }

  follow(player: number | null, x?: number, y?: number): void {
    const r = this.renderer;
    if (r) {
      r.follow = player ?? -1;
      if (x !== undefined) r.camera.cx = x;
      if (y !== undefined) r.camera.cy = y;
    } else {
      this.free.follow = player;
      if (x !== undefined) this.free.cx = x;
      if (y !== undefined) this.free.cy = y;
    }
    this.reportView();
  }

  setHovered(serial: number): void {
    if (serial === this.hovered) return;
    this.hovered = serial;
    this.reportView(true);
  }

  onFrame(f: (now: number) => void): () => void {
    this.frameListeners.add(f);
    return () => this.frameListeners.delete(f);
  }

  /** Gameplay readiness (§9.7): core delivered and uploaded; rejects on the core error. */
  async ready(): Promise<void> {
    const r = this.renderer;
    if (!r || !this.loader) return;
    await this.loader.ready('core');
    while (!r.coreResident()) {
      if (r.mode === 'on-demand') this.frameNow();
      await tick16();
    }
  }

  async settled(): Promise<void> {
    await this.ready();
    const r = this.renderer;
    const l = this.loader;
    if (!r || !l) return;
    for (let quiet = 0; quiet < 2; ) {
      if (r.mode === 'on-demand') this.frameNow();
      quiet = r.pending() > 0 || !l.settled() ? 0 : quiet + 1;
      if (quiet < 2) await tick16();
    }
  }

  retryArt(): void {
    this.coreBox?.remove();
    this.coreBox = null;
    this.loader?.retry();
  }

  applyPacket(bytes: Uint8Array, view?: ViewRequest | null): void {
    if (this.renderer) this.renderer.applyPacket(bytes, view);
    else {
      this.mirror.apply(bytes, view);
      // no frames: the free camera follows its character here
      const c = this.free.follow !== null ? this.character() : null;
      if (c) {
        this.free.cx = c.x;
        this.free.cy = c.y;
      }
    }
    this.shown = true;
    if (this.o.fake && this.renderer) deriveBeltMasks(this.mirror, this.renderer.look);
  }

  reset(): void {
    this.mirror.reset();
    this.shown = false;
  }

  // ---------------------------------------------------------------------------------------------- the stand-ins

  private readonly showCoreError = (message: string, retry: () => void): void => {
    this.coreBox?.remove();
    const box = document.createElement('div');
    box.setAttribute('role', 'alert');
    box.setAttribute('data-testid', 'art-error');
    box.style.cssText =
      'position:fixed;inset:auto 0 40% 0;margin:auto;width:fit-content;padding:16px 20px;background:#f4ecd8;color:#2b2723;border:2px solid #6f5a36;z-index:10;font:14px "Libre Franklin",sans-serif';
    box.textContent = `The game's art could not be loaded (${message}).`;
    const b = document.createElement('button');
    b.textContent = 'Retry';
    b.style.marginLeft = '12px';
    b.addEventListener('click', retry);
    box.append(b);
    this.o.container.append(box);
    this.coreBox = box;
  };

  private readonly showNotice = (on: boolean): void => {
    if (!on) {
      this.notice?.remove();
      this.notice = null;
      return;
    }
    if (this.notice) return;
    const n = document.createElement('div');
    n.setAttribute('data-testid', 'art-notice');
    n.style.cssText =
      'position:fixed;right:8px;bottom:8px;padding:4px 8px;background:#f4ecd8d8;color:#2b2723;font:12px "Libre Franklin",sans-serif;z-index:5;pointer-events:none';
    n.textContent = 'Some art could not be loaded; retrying';
    this.o.container.append(n);
    this.notice = n;
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 600 : e.deltaY;
    this.wheelAcc += px;
    while (Math.abs(this.wheelAcc) >= 100) {
      const step = this.wheelAcc > 0 ? -1 : 1;
      this.zoomBy(step);
      this.wheelAcc += step * 100;
    }
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    const r = this.renderer;
    if (e.code === 'F9') {
      this.setZoom(e.shiftKey ? 2 : 1);
      e.preventDefault();
    } else if (e.code === 'F5' && r && this.hud) {
      this.showHud = !this.showHud;
      // the timings read the clock only while someone looks at them (C4-r1 10)
      r.timing = this.showHud;
      this.hud.style.display = this.showHud ? 'block' : 'none';
      if (this.showHud) this.hud.textContent = debugHud(r, this.loader);
      e.preventDefault();
    } else if (e.code === 'F4' && r) {
      const cycle = ['none', 'tiles', 'boxes', 'all'] as const;
      this.debugIndex = (this.debugIndex + 1) % cycle.length;
      const m = cycle[this.debugIndex];
      r.debug = {
        tileGrid: m === 'tiles' || m === 'all',
        chunkGrid: m !== 'none',
        collision: m === 'boxes' || m === 'all',
        selection: m === 'all',
        positions: m === 'boxes' || m === 'all',
      };
      e.preventDefault();
    }
  };

  private setInput(on: boolean): void {
    if (on === this.inputOn) return;
    this.inputOn = on;
    const c = this.canvasEl;
    if (on) {
      c?.addEventListener('wheel', this.onWheel, { passive: false });
      addEventListener('keydown', this.onKey);
    } else {
      c?.removeEventListener('wheel', this.onWheel);
      removeEventListener('keydown', this.onKey);
    }
  }

  /** The renderer replaced its canvas (a context that never came back): the input moves with it. */
  moveCanvas(c: HTMLCanvasElement): void {
    const on = this.inputOn;
    this.setInput(false);
    this.canvasEl = c;
    if (on) this.setInput(true);
  }

  private installHooks(): void {
    const r = this.renderer;
    window.__render = {
      renderer: r,
      world: this,
      frame: () => this.frameNow(),
      camera: (x, y, zoom) => {
        this.follow(null, x, y);
        if (zoom !== undefined) this.setZoom(zoom);
      },
      follow: (player) => this.follow(player),
      ready: () => this.ready(),
      settled: () => this.settled(),
      stats: () => ({
        frame: r ? { ...r.stats } : null,
        memory: r?.memory() ?? null,
        probe: r?.probe ?? null,
        loader: this.loader
          ? { ...this.loader.stats, epoch: this.loader.epoch, notice: this.loader.notice }
          : null,
        mirror: { chunks: this.mirror.chunks.size, lines: this.mirror.lines.size, tick: this.mirror.tick },
      }),
      debug: (flags) => {
        if (r) r.debug = { ...r.debug, ...flags };
      },
      loseContext: async (ms = 100) => {
        const ext = r?.gl?.getExtension('WEBGL_lose_context');
        if (!ext) throw new Error('WEBGL_lose_context is not available');
        ext.loseContext();
        await new Promise((res) => setTimeout(res, ms));
        ext.restoreContext();
      },
    };
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.setInput(false);
    this.frameListeners.clear();
    this.loader?.dispose();
    this.draw?.worker.terminate();
    this.renderer?.dispose();
    this.canvasEl?.remove();
    this.hud?.remove();
    this.notice?.remove();
    this.coreBox?.remove();
    if (window.__render?.world === this) delete window.__render;
  }
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

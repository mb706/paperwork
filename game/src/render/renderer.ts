// Renderer v0 (10 §6): a custom WebGL2 renderer over the view model. Each frame, for the world viewport:
//   1. terrain, one quad per visible chunk (§6.5);
//   2. ground layers: resources, floor entities, decoratives, then ground and belt items (icons);
//   3. shadows MAX-blended into a half-resolution R8 target, composited as Survey's hatching (§9.8);
//   4. objects, y-sorted; 5. higher objects: inserter arms and hands, held items, smoke;
//   7. lights additively into a half-resolution target, then ONE full-screen pass that applies the day stain and
//      the night's cyanotype (the only place the night grade happens);
//   8. world overlays after the grade (ghosts, the deconstruction mark, F4's debug overlays).
// The world (1–5) renders into an RGBA8 scene target that the grade reads. Context loss is handled: the renderer
// waits for a restore, re-creates every GL resource and asks for the pages again; with no restore within 5 s it
// tries a new canvas once, then reports a fatal error (§6.13).

import type { PrototypesJson } from '../shared/gen/protos.ts';
import { GlBatcher, type Stream } from './gl/batcher.ts';
import { type FormatProbe, type GpuFormat, probeFormats } from './gl/formats.ts';
import { createProgram, type Program } from './gl/program.ts';
import {
  FULLSCREEN_VS,
  GRADE_FS,
  HATCH_FS,
  LIGHT_FS,
  LOD_UNIT,
  SHADOW_FS,
  SOLID_FS,
  SPRITE_FS,
  SPRITE_VS,
} from './gl/shaders.ts';
import { TerrainPass } from './gl/terrain.ts';
import { AllocationError, AtlasTextures, type PageUpload } from './gl/textures.ts';
import { Lookups } from './lookups.ts';
import { cyanotypeLut } from './lut.ts';
import type { Atlas } from './manifest.ts';
import {
  type Allocation,
  allocationOf,
  chooseMode,
  MB,
  MODE_BUDGET_MB,
  MODES,
  otherAllocations,
  type ResolutionMode,
  targetBytes,
} from './memory.ts';
import { Mirror, MO } from './mirror.ts';
import { STREAM } from './programs.ts';
import { type Camera, PX_PER_TILE, scaleOf, snapCamera, ZOOM_MAX, ZOOM_MIN_WORLD } from './projection.ts';
import { type DebugFlags, NO_DEBUG, OVERLAY, Scene, STREAM_KIND } from './scene.ts';
import {
  AMBIENT_FLOOR,
  CLEAR_COLOUR,
  CYANOTYPE_LUT_SIZE,
  INK_COLOUR,
  LIGHT_DAY_STAIN,
  NIGHT,
  SHADOW,
} from './style.ts';

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  atlas: Atlas;
  protos: PrototypesJson;
  /** prototypes.bin's belt_speed per entity (positions per tick), for the belt animation. */
  beltSpeed?: ArrayLike<number>;
  /** The lowest resolution mode to try first ('high' picks the best that fits, 10 §6.13). */
  mode?: ResolutionMode;
  /** Formats the probe must refuse (tests force the fallbacks). */
  denyFormats?: GpuFormat[];
  /** What the asset worker's transcoder can make (its 'ready' message); absent: assume everything. */
  transcodable?: { xubc7: string[]; etc1s: string[] };
  /** Terrain material names in their array's layer order (the manifest's `terrain.tiles`, sorted). */
  terrainTiles?: string[];
  /** A lost context could not be recovered. */
  onFatal?: (message: string) => void;
  /**
   * The atlases were allocated again (a restored context, or a lower mode for the memory budget): the formats or
   * the levels may differ, so the loader asks for every page again under a new upload epoch (`uploadConfig()`).
   */
  onRestored?: () => void;
  /** A page gave its layer to another under the eviction safety net (10 §6.13); the loader asks for it again. */
  onEvict?: (array: number, page: number) => void;
  /** A replacement canvas was created (the app moves its listeners). */
  onCanvas?: (canvas: HTMLCanvasElement) => void;
}

/** CPU milliseconds of the last frame's steps (the F5 HUD; main thread only, 10 §6.12). */
export interface FrameStats {
  frame: number;
  total: number;
  pump: number;
  build: number;
  upload: number;
  submit: number;
  sprites: number;
  draws: number;
  uploadedKb: number;
  chunks: number;
  terrainChunks: number;
  shoresBuilt: number;
  beltItems: number;
  entities: number;
  greyboxed: number;
  fps: number;
}

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

interface GlState {
  gl: WebGL2RenderingContext;
  sprite: Program;
  shadow: Program;
  light: Program;
  solid: Program;
  hatch: Program;
  grade: Program;
  batcher: GlBatcher;
  textures: AtlasTextures;
  terrain: TerrainPass;
  lut: WebGLTexture;
  emptyVao: WebGLVertexArrayObject;
  halfFloat: boolean;
  scene: Target | null;
  shadowT: Target | null;
  lightT: Target | null;
}

/**
 * The hatch and grade passes' uniforms that never change, set once per program (uniform values live in the program
 * object, and a restored context links new programs). Per frame they would cost GL calls and boxed doubles.
 */
function setStaticUniforms(
  gl: WebGL2RenderingContext,
  hatch: Program,
  grade: Program,
  sprites: readonly Program[],
): void {
  for (const p of sprites) {
    gl.useProgram(p.program);
    if (p.u.uTex) gl.uniform1i(p.u.uTex, 0);
    if (p.u.uLod) gl.uniform1i(p.u.uLod, LOD_UNIT);
  }
  gl.useProgram(hatch.program);
  const h = hatch.u;
  if (h.uShadow) gl.uniform1i(h.uShadow, 0);
  if (h.uPeriod) gl.uniform1f(h.uPeriod, SHADOW.periodTiles);
  if (h.uWidth) gl.uniform1f(h.uWidth, SHADOW.widthTiles);
  if (h.uInk) gl.uniform1f(h.uInk, SHADOW.ink);
  if (h.uDarken) gl.uniform1f(h.uDarken, SHADOW.darken);
  if (h.uGain) gl.uniform1f(h.uGain, SHADOW.maskGain);
  if (h.uInkColour) gl.uniform3fv(h.uInkColour, INK_COLOUR);
  gl.useProgram(grade.program);
  const r = grade.u;
  if (r.uScene) gl.uniform1i(r.uScene, 0);
  if (r.uLight) gl.uniform1i(r.uLight, 1);
  if (r.uLut) gl.uniform1i(r.uLut, 2);
  if (r.uStain) gl.uniform1f(r.uStain, LIGHT_DAY_STAIN);
  if (r.uReveal) gl.uniform1f(r.uReveal, NIGHT.reveal);
  if (r.uLightAdd) gl.uniform1f(r.uLightAdd, NIGHT.lightAdd);
  if (r.uLutSize) gl.uniform1f(r.uLutSize, CYANOTYPE_LUT_SIZE);
  gl.useProgram(null);
}

/** The frame's clock (one function, not a closure per frame). */
const clock = (): number => performance.now();

/** The context's attributes (the app's WebGL2 check creates the context with the same ones). */
export const CONTEXT_ATTRS: WebGLContextAttributes = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: 'high-performance',
};

export class Renderer {
  canvas: HTMLCanvasElement;
  readonly atlas: Atlas;
  readonly protos: PrototypesJson;
  readonly look: Lookups;
  readonly mirror = new Mirror();
  readonly scene: Scene;
  probe: FormatProbe;
  allocation: Allocation;
  /** The camera the app steers; the frame draws it snapped to whole device pixels. */
  readonly camera: Camera = { cx: 0, cy: 0, zoom: 1, dpr: 1 };
  /** Follow this player's character (MOVERS.aux), −1 for a free camera. */
  follow = 0;
  /** 'continuous': frames from requestAnimationFrame; 'on-demand': frames only from `frame()` (tests, §3.5). */
  mode: 'continuous' | 'on-demand' = 'continuous';
  debug: DebugFlags = { ...NO_DEBUG };
  /** The render-resolution setting (10 §6.10): the backing store is dpr (≤ 2) × this. */
  renderScale = 1;
  /** Measure the frame's steps (the F5 HUD, the bench): off, a frame reads no clock (C4-r1 10). */
  timing = false;
  /** Frames drawn (the LRU clock of the eviction safety net). */
  private frameNo = 0;
  /**
   * The camera the last frame was drawn with: snapped to whole device px, the canvas centre (ox, oy) and the
   * backing size in device px, and the dpr. Picking and labels use it (src/shared/world-view.ts's WorldCamera).
   */
  readonly drawn = { cx: 0, cy: 0, zoom: 1, dpr: 1, ox: 0, oy: 0, w: 1, h: 1 };
  readonly stats: FrameStats = {
    frame: 0,
    total: 0,
    pump: 0,
    build: 0,
    upload: 0,
    submit: 0,
    sprites: 0,
    draws: 0,
    uploadedKb: 0,
    chunks: 0,
    terrainChunks: 0,
    shoresBuilt: 0,
    beltItems: 0,
    entities: 0,
    greyboxed: 0,
    fps: 0,
  };
  lost = false;
  private g: GlState | null = null;
  private readonly opts: RendererOptions;
  private readonly snapped: Camera = { cx: 0, cy: 0, zoom: 1, dpr: 1 };
  private readonly rect = new Float64Array(4);
  private packetTime = 0;
  private lastFrame = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private restoreTimer: ReturnType<typeof setTimeout> | null = null;
  private retriedCanvas = false;
  private readonly lutData = cyanotypeLut();
  private readonly terrainTiles: string[];

  /** A renderer on `canvas`, or null where WebGL2 is unavailable (headless Firefox here; `?render=none`). */
  static create(opts: RendererOptions): Renderer | null {
    const gl = opts.canvas.getContext('webgl2', CONTEXT_ATTRS);
    if (gl === null) return null;
    return new Renderer(opts, gl);
  }

  private constructor(opts: RendererOptions, gl: WebGL2RenderingContext) {
    this.opts = opts;
    this.canvas = opts.canvas;
    this.atlas = opts.atlas;
    this.protos = opts.protos;
    this.look = new Lookups(opts.atlas, opts.protos, opts.beltSpeed);
    this.scene = new Scene(opts.atlas, this.look);
    this.terrainTiles = opts.terrainTiles ?? Object.keys(opts.atlas.json.terrain?.tiles ?? {}).sort();
    this.probe = probeFormats(gl, opts.denyFormats ?? [], opts.transcodable);
    this.allocation = this.choose(gl);
    this.g = this.initGl(gl);
    this.listen(this.canvas);
  }

  private halfFloat(gl: WebGL2RenderingContext): boolean {
    return (
      gl.getExtension('EXT_color_buffer_float') !== null ||
      gl.getExtension('EXT_color_buffer_half_float') !== null
    );
  }

  /** §6.13's estimate of everything besides the atlases at the current backing size (the mode choice). */
  private others(gl: WebGL2RenderingContext) {
    this.measure();
    return otherAllocations(this.bw, this.bh, this.halfFloat(gl), 192, 96);
  }

  private choose(gl: WebGL2RenderingContext): Allocation {
    return chooseMode(
      this.atlas.json,
      this.probe.colour,
      this.probe.shadow,
      this.others(gl),
      this.opts.mode ?? 'high',
    );
  }

  /**
   * The atlases in `first` or the next mode down that allocates (10 §6.13 "Choosing the mode"); failing that, at
   * Low with fewer layers than pages, as many as allocate (the eviction safety net). Every failed attempt has deleted
   * what it created (C4-r1 5).
   */
  private allocateTextures(gl: WebGL2RenderingContext, first: ResolutionMode): AtlasTextures {
    const failures: string[] = [];
    const attempt = (mode: ResolutionMode, cap?: number): AtlasTextures | null => {
      try {
        return new AtlasTextures(
          gl,
          this.atlas,
          mode,
          this.probe.colour,
          this.probe.shadow,
          this.terrainTiles,
          cap,
        );
      } catch (e) {
        if (!(e instanceof AllocationError)) throw e;
        failures.push(`${mode}${cap !== undefined ? ` (${cap} layers)` : ''}: ${e.message}`);
        return null;
      }
    };
    for (let i = MODES.indexOf(first); i < MODES.length; i++) {
      const t = attempt(MODES[i] as ResolutionMode);
      if (t !== null) return t;
    }
    // the safety net: the most layers per array that allocate at Low (a binary search; fewer layers always fit
    // when more do)
    const most = Math.max(1, ...this.atlas.json.pages.map((p) => p.length));
    let best: AtlasTextures | null = null;
    let lo = 1;
    let hi = most - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = attempt('low', mid);
      if (t !== null) {
        best?.dispose();
        best = t;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (best !== null) {
      console.warn(
        `GPU memory: the atlases share ${best.arrays.map((a) => `${a.layers}/${a.pages}`).join(', ')} layers (10 §6.13 eviction)`,
      );
      return best;
    }
    throw new Error(`the atlases do not fit the GPU in any resolution mode: ${failures.join('; ')}`);
  }

  private initGl(gl: WebGL2RenderingContext): GlState {
    const halfFloat = this.halfFloat(gl);
    const textures = this.allocateTextures(gl, this.allocation.mode);
    this.useTextures(gl, textures);
    const materialLayers = new Map<string, number>(this.terrainTiles.map((t, i) => [t, i]));
    const batcher = new GlBatcher(gl, OVERLAY.solid + 1);
    const trees = Uint8Array.from(this.look.treeSet, (t) => (t >= 0 ? 1 : 0));
    const terrain = new TerrainPass(gl, this.protos.tile, materialLayers, trees);
    terrain.useIndex(batcher.index);
    const lut = gl.createTexture();
    const emptyVao = gl.createVertexArray();
    if (lut === null || emptyVao === null) throw new Error('GL allocation failed');
    const n = CYANOTYPE_LUT_SIZE;
    gl.bindTexture(gl.TEXTURE_3D, lut);
    gl.texStorage3D(gl.TEXTURE_3D, 1, gl.RGBA8, n, n, n);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, n, n, n, gl.RGBA, gl.UNSIGNED_BYTE, this.lutData);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R])
      gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_3D, null);
    const hatch = createProgram(gl, FULLSCREEN_VS, HATCH_FS, 'hatch');
    const grade = createProgram(gl, FULLSCREEN_VS, GRADE_FS, 'grade');
    const sprite = createProgram(gl, SPRITE_VS, SPRITE_FS, 'sprite');
    const shadow = createProgram(gl, SPRITE_VS, SHADOW_FS, 'shadow');
    const light = createProgram(gl, SPRITE_VS, LIGHT_FS, 'light');
    const solid = createProgram(gl, SPRITE_VS, SOLID_FS, 'solid');
    setStaticUniforms(gl, hatch, grade, [sprite, shadow, light, solid]);
    return {
      gl,
      sprite,
      shadow,
      light,
      solid,
      hatch,
      grade,
      batcher,
      textures,
      terrain,
      lut,
      emptyVao,
      halfFloat,
      scene: null,
      shadowT: null,
      lightT: null,
    };
  }

  /** Puts `textures` to use: the allocation report, the scene's page tables, eviction notices. */
  private useTextures(gl: WebGL2RenderingContext, textures: AtlasTextures): void {
    this.measure();
    this.allocation = allocationOf(
      this.atlas.json,
      this.probe.colour,
      this.probe.shadow,
      textures.mode,
      otherAllocations(this.bw, this.bh, this.halfFloat(gl), 192, 96),
    );
    this.scene.usePages(textures.arrays.map((a) => ({ pageLayer: a.pageLayer, used: a.used })));
    textures.onEvict = (array, page) => this.opts.onEvict?.(array, page);
  }

  /** What the asset loader must request for the current allocation: formats and levels (an upload epoch). */
  uploadConfig(): { colour: GpuFormat; shadow: GpuFormat; levelOffset: number[]; terrainOffset: number } {
    const t = this.g?.textures;
    return {
      colour: this.probe.colour,
      shadow: this.probe.shadow,
      levelOffset: t ? t.arrays.map((a) => a.offset) : [],
      terrainOffset: t?.terrain?.offset ?? 0,
    };
  }

  /**
   * Over the mode's budget (a resize, grown vertex buffers): the atlases again in the next lower mode, and every
   * page asked for again (10 §6.13; C4-r1 8). False at Low.
   */
  private stepDown(g: GlState): boolean {
    const i = MODES.indexOf(g.textures.mode);
    if (i >= MODES.length - 1) return false;
    const gl = g.gl;
    g.textures.dispose();
    g.textures = this.allocateTextures(gl, MODES[i + 1] as ResolutionMode);
    this.useTextures(gl, g.textures);
    console.info(`GPU memory: over the ${MODES[i]} budget; now ${g.textures.mode} (10 §6.13)`);
    this.opts.onRestored?.();
    return true;
  }

  /** The GL context (null while lost). */
  get gl(): WebGL2RenderingContext | null {
    return this.g?.gl ?? null;
  }

  get textures(): AtlasTextures | null {
    return this.g?.textures ?? null;
  }

  /** Whether every page and terrain material of group `core` is resident (gameplay readiness, 10 §9.7). */
  coreResident(): boolean {
    const t = this.g?.textures;
    if (!t) return false;
    const m = this.atlas.json;
    for (let a = 0; a < m.pages.length; a++) {
      const pages = m.pages[a] ?? [];
      for (let p = 0; p < pages.length; p++)
        if (pages[p]?.group === 'core' && !t.resident(a, p) && !t.evicting) return false;
    }
    const tiles = m.terrain?.tiles ?? {};
    for (let i = 0; i < this.terrainTiles.length; i++)
      if (tiles[this.terrainTiles[i] as string]?.group === 'core' && !t.terrainResident(i)) return false;
    return true;
  }

  /** Work the renderer still has to do before a frame is final: page uploads and shore textures (tests wait). */
  pending(): number {
    const g = this.g;
    if (!g) return 0;
    return g.textures.pending + g.terrain.pending;
  }

  // -------------------------------------------------------------------------------------------- inputs

  /** Applies a packet to the view model (10 §15.4); `view` is the request it answers (undefined: unchanged). */
  applyPacket(bytes: Uint8Array, view?: Parameters<Mirror['apply']>[1], now = performance.now()): void {
    this.mirror.apply(bytes, view);
    this.packetTime = now;
  }

  /** Queues a transcoded page (or terrain material) for upload within the frame budget. */
  enqueuePage(up: PageUpload): void {
    this.g?.textures.enqueue(up);
  }

  /** The device pixel ratio of the backing store: devicePixelRatio capped at 2, times the render scale. */
  dpr(): number {
    return Math.min(2, globalThis.devicePixelRatio || 1) * this.renderScale;
  }

  /** The backing store's size in device px: the canvas's CSS size × dpr (into bw, bh; no allocation). */
  /** Computed uniforms of the hatch and grade passes, passed as typed arrays (no boxed doubles). */
  private readonly uni = new Float32Array(16);
  /** The full-resolution target's height this frame (the sprite shader's uFullH, C4-r1 11). */
  private fullH = 1;
  private bw = 1;
  private bh = 1;
  private measure(): void {
    const dpr = this.dpr();
    this.bw = Math.max(1, Math.round((this.canvas.clientWidth || this.canvas.width) * dpr));
    this.bh = Math.max(1, Math.round((this.canvas.clientHeight || this.canvas.height) * dpr));
  }

  /** Zooms by wheel notches (×1.1 each, I §3.15), clamped to the world's range; positive zooms in. */
  zoomBy(notches: number): void {
    const z = this.camera.zoom * 1.1 ** notches;
    this.camera.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN_WORLD, z));
  }

  /** The visible tile rectangle (x0, y0 inclusive; x1, y1 exclusive), for the view request (§15.4). */
  visibleTiles(): { x0: number; y0: number; x1: number; y1: number } {
    const t = new Int32Array(4);
    this.visibleTilesInto(t);
    return { x0: t[0] as number, y0: t[1] as number, x1: t[2] as number, y1: t[3] as number };
  }

  /** visibleTiles() as [x0, y0, x1, y1] into `out` (the app asks every frame: no allocation). */
  visibleTilesInto(out: Int32Array): void {
    this.measure();
    const w = this.bw;
    const h = this.bh;
    const cam = this.camera;
    const S = PX_PER_TILE * cam.zoom * this.dpr();
    out[0] = Math.floor(cam.cx - w / 2 / S);
    out[1] = Math.floor(cam.cy - h / 2 / S);
    out[2] = Math.ceil(cam.cx + w / 2 / S);
    out[3] = Math.ceil(cam.cy + h / 2 / S);
  }

  /** Moves the camera onto the followed character, extrapolated like its sprite; false when it is not in view. */
  private followCamera(renderTick: number): boolean {
    const mv = this.mirror.movers;
    for (let i = 0; i < mv.count; i++) {
      const o = i * 32;
      if (mv.view.getUint8(o + MO.kind) !== 0 || mv.view.getUint16(o + MO.aux, true) !== this.follow)
        continue;
      const dt = this.mode === 'continuous' ? renderTick - mv.view.getUint32(o + MO.base_tick, true) : 0;
      this.camera.cx = (mv.view.getInt32(o + MO.x, true) + mv.view.getInt16(o + MO.vx, true) * dt) / 256;
      this.camera.cy = (mv.view.getInt32(o + MO.y, true) + mv.view.getInt16(o + MO.vy, true) * dt) / 256;
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------------------------- the frame

  /** Draws one frame. `now` is performance.now(). Returns false when nothing could be drawn (context lost). */
  frame(now = performance.now()): boolean {
    const g = this.g;
    if (g === null || this.lost) return false;
    const gl = g.gl;
    // the timings read the clock only when someone looks at them (the F5 HUD, the bench)
    const timed = this.timing;
    const t0 = timed ? performance.now() : 0;
    const st = this.stats;
    if (this.lastFrame > 0) {
      this.fpsAcc += now - this.lastFrame;
      this.fpsFrames++;
      if (this.fpsAcc >= 500) {
        st.fps = (this.fpsFrames * 1000) / this.fpsAcc;
        this.fpsAcc = 0;
        this.fpsFrames = 0;
      }
    }
    this.lastFrame = now;
    // the backing store follows the canvas's CSS size and dpr
    this.measure();
    const w = this.bw;
    const h = this.bh;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    // the budget before a resize allocates (C4-r1 8): bigger targets may need a lower mode first
    if (g.scene === null || g.scene.w !== w || g.scene.h !== h)
      while (this.overBudget(g, targetBytes(w, h, g.halfFloat)) && this.stepDown(g));
    this.ensureTargets(g, w, h);
    // the tick to draw: the packet's, plus the time since it arrived (at most two ticks) when continuous
    const ahead =
      this.mode === 'continuous' ? Math.min(2, Math.max(0, ((now - this.packetTime) * 60) / 1000)) : 0;
    const renderTick = this.mirror.tick + ahead;
    if (this.follow >= 0) this.followCamera(renderTick);
    this.camera.dpr = this.dpr();
    const cam = snapCamera(this.camera, this.snapped);
    const S = scaleOf(cam);
    const d = this.drawn;
    d.cx = cam.cx;
    d.cy = cam.cy;
    d.zoom = cam.zoom;
    d.dpr = cam.dpr;
    d.ox = Math.floor(w / 2);
    d.oy = Math.floor(h / 2);
    d.w = w;
    d.h = h;
    // uploads within 2 ms (10 §9.7), then the scene
    this.frameNo++;
    g.textures.frame = this.frameNo;
    this.scene.frameNo = this.frameNo;
    const tp = timed ? performance.now() : 0;
    g.textures.pump(2, clock);
    const tb = timed ? performance.now() : 0;
    this.scene.resident = g.textures.setResident;
    this.scene.extrapolate = this.mode === 'continuous';
    this.scene.build(this.mirror, cam, w, h, renderTick, this.debug);
    const tu = timed ? performance.now() : 0;
    const streams = this.scene.streams;
    g.batcher.beginFrame();
    for (let s = 0; s < streams.length; s++) g.batcher.upload(s, streams[s] as Stream);
    const ts = timed ? performance.now() : 0;
    // origin: the canvas centre in whole device px
    const ox = Math.floor(w / 2);
    const oy = Math.floor(h / 2);
    this.rect[0] = cam.cx - ox / S;
    this.rect[1] = cam.cy - oy / S;
    this.rect[2] = cam.cx + (w - ox) / S;
    this.rect[3] = cam.cy + (h - oy) / S;
    const scene = g.scene as Target;
    const sh = g.shadowT as Target;
    const li = g.lightT as Target;
    // 1–2: terrain and the ground layers into the scene target
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.clearColor(CLEAR_COLOUR[0], CLEAR_COLOUR[1], CLEAR_COLOUR[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    g.terrain.draw(this.mirror, cam, this.rect, ox, oy, w, h, g.textures.terrain?.tex ?? null, 3, clock);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.fullH = h;
    this.drawStream(g, STREAM.ground, ox, oy, w, h, 1, g.sprite);
    this.drawStream(g, STREAM.groundIcon, ox, oy, w, h, 1, g.sprite);
    // 3: shadows into the half-resolution mask (MAX), then hatched over the ground
    gl.bindFramebuffer(gl.FRAMEBUFFER, sh.fbo);
    gl.viewport(0, 0, sh.w, sh.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.blendEquation(gl.MAX);
    this.drawStream(g, STREAM.shadow, ox, oy, sh.w, sh.h, 0.5, g.shadow);
    gl.blendEquation(gl.FUNC_ADD);
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
    gl.viewport(0, 0, w, h);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    this.hatch(g, sh, ox, oy, w, h, cam);
    // 4–5: objects, then arms, hands, smoke and held items
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.drawStream(g, STREAM.object, ox, oy, w, h, 1, g.sprite);
    this.drawStream(g, STREAM.high, ox, oy, w, h, 1, g.sprite);
    this.drawStream(g, STREAM.highIcon, ox, oy, w, h, 1, g.sprite);
    // 7: lights into the half-resolution light target, then the one grade pass into the canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, li.fbo);
    gl.viewport(0, 0, li.w, li.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.drawStream(g, STREAM.light, ox, oy, li.w, li.h, 0.5, g.light);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    this.grade(g, scene, li);
    // 8: world overlays, never graded
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.drawStream(g, OVERLAY.ghost, ox, oy, w, h, 1, g.sprite);
    this.drawStream(g, OVERLAY.solid, ox, oy, w, h, 1, g.solid);
    gl.disable(gl.BLEND);
    st.frame++;
    if (timed) {
      const te = performance.now();
      st.pump = tb - tp;
      st.build = tu - tb;
      st.upload = ts - tu;
      st.submit = te - ts;
      st.total = te - t0;
    }
    // grown vertex buffers count against the budget too (they take effect from the next frame)
    if (this.overBudget(g, 0)) this.stepDown(g);
    let sprites = 0;
    for (let i = 0; i < streams.length; i++) sprites += (streams[i] as Stream).quads;
    st.sprites = sprites;
    st.draws = g.batcher.draws + (g.terrain.drawn > 0 ? 1 : 0) + 2;
    st.uploadedKb = g.batcher.uploaded / 1024;
    st.chunks = this.scene.stats.chunks;
    st.terrainChunks = g.terrain.drawn;
    st.shoresBuilt = g.terrain.shoresBuilt;
    st.beltItems = this.scene.stats.beltItems;
    st.entities = this.scene.stats.entities;
    st.greyboxed = this.scene.stats.greyboxed;
    return true;
  }

  private drawStream(
    g: GlState,
    s: number,
    ox: number,
    oy: number,
    tw: number,
    th: number,
    scale: number,
    p: Program,
  ): void {
    const st = this.scene.streams[s] as Stream;
    if (st.quads === 0) return;
    const gl = g.gl;
    gl.useProgram(p.program);
    gl.uniform2f(p.u.uOrigin as WebGLUniformLocation, ox, oy);
    gl.uniform2f(p.u.uTarget as WebGLUniformLocation, tw, th);
    gl.uniform1f(p.u.uTargetScale as WebGLUniformLocation, scale);
    gl.uniform1f(p.u.uFullH as WebGLUniformLocation, this.fullH);
    const kind = STREAM_KIND[s] as number;
    // the LOD unit always holds an R8UI texture (the colour array's for solid quads): the integer sampler needs one
    const a = this.atlas.arrayOfKind[kind >= 0 ? kind : 0] as number;
    const t = g.textures.arrays[a];
    if (!t) return;
    gl.activeTexture(gl.TEXTURE0 + LOD_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, t.lodTex);
    gl.activeTexture(gl.TEXTURE0);
    if (kind >= 0) {
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, t.tex);
      gl.uniform1f(p.u.uPageSize as WebGLUniformLocation, this.atlas.pageSize[a] as number);
      gl.uniform1f(p.u.uLevelOffset as WebGLUniformLocation, t.offset);
    }
    g.batcher.draw(s, st);
  }

  private hatch(g: GlState, sh: Target, ox: number, oy: number, w: number, h: number, cam: Camera): void {
    if ((this.scene.streams[STREAM.shadow] as Stream).quads === 0) return;
    const gl = g.gl;
    const p = g.hatch;
    gl.useProgram(p.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sh.tex);
    // computed values go through a typed array: a double passed to a WebGL call is boxed
    const u = this.uni;
    u[0] = 0.5 / sh.w;
    u[1] = 0.5 / sh.h;
    u[2] = w;
    u[3] = h;
    u[4] = ox;
    u[5] = oy;
    u[6] = scaleOf(cam);
    // the hatching's phase at the camera, in f64: lines anchored to the world, precise at any distance
    const ph = ((cam.cx - cam.cy) * Math.SQRT1_2) / SHADOW.periodTiles;
    u[7] = ph - Math.floor(ph);
    gl.uniform2fv(p.u.uHalfScale as WebGLUniformLocation, u, 0, 2);
    gl.uniform2fv(p.u.uSize as WebGLUniformLocation, u, 2, 2);
    gl.uniform2fv(p.u.uOrigin as WebGLUniformLocation, u, 4, 2);
    gl.uniform1fv(p.u.uS as WebGLUniformLocation, u, 6, 1);
    gl.uniform1fv(p.u.uPhase as WebGLUniformLocation, u, 7, 1);
    gl.bindVertexArray(g.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /** The night strength n (10 §9.8): (1 − daylight) ÷ (1 − AMBIENT_FLOOR), clamped. */
  night(): number {
    return Math.min(1, Math.max(0, (1 - this.mirror.daylight) / (1 - AMBIENT_FLOOR)));
  }

  private grade(g: GlState, scene: Target, li: Target): void {
    const gl = g.gl;
    const p = g.grade;
    gl.useProgram(p.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, li.tex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_3D, g.lut);
    const u = this.uni;
    u[8] = 0.5 / li.w;
    u[9] = 0.5 / li.h;
    u[10] = Math.min(1, Math.max(0, (1 - this.mirror.daylight) / (1 - AMBIENT_FLOOR)));
    gl.uniform2fv(p.u.uHalfScale as WebGLUniformLocation, u, 8, 2);
    gl.uniform1fv(p.u.uNight as WebGLUniformLocation, u, 10, 1);
    gl.bindVertexArray(g.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  private ensureTargets(g: GlState, w: number, h: number): void {
    if (g.scene && g.scene.w === w && g.scene.h === h) return;
    const gl = g.gl;
    for (const t of [g.scene, g.shadowT, g.lightT])
      if (t) {
        gl.deleteFramebuffer(t.fbo);
        gl.deleteTexture(t.tex);
      }
    const hw = Math.ceil(w / 2);
    const hh = Math.ceil(h / 2);
    g.scene = this.target(gl, w, h, gl.RGBA8, false);
    g.shadowT = this.target(gl, hw, hh, gl.R8, true);
    let light: Target | null = null;
    if (g.halfFloat) {
      light = this.target(gl, hw, hh, gl.RGBA16F, true);
      gl.bindFramebuffer(gl.FRAMEBUFFER, light.fbo);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        gl.deleteFramebuffer(light.fbo);
        gl.deleteTexture(light.tex);
        light = null;
        g.halfFloat = false;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    g.lightT = light ?? this.target(gl, hw, hh, gl.RGBA8, true);
  }

  private target(gl: WebGL2RenderingContext, w: number, h: number, format: number, linear: boolean): Target {
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (tex === null || fbo === null) throw new Error('render target allocation failed');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h);
    const f = linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { tex, fbo, w, h };
  }

  // -------------------------------------------------------------------------------------------- context loss

  private listen(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('webglcontextlost', this.onLost, false);
    canvas.addEventListener('webglcontextrestored', this.onRestored, false);
  }

  private readonly onLost = (e: Event): void => {
    e.preventDefault();
    this.lost = true;
    this.g = null;
    if (this.restoreTimer !== null) clearTimeout(this.restoreTimer);
    this.restoreTimer = setTimeout(this.replaceCanvas, 5000);
  };

  private readonly onRestored = (): void => {
    const gl = this.canvas.getContext('webgl2', CONTEXT_ATTRS);
    if (gl === null) return;
    this.recover(gl);
  };

  private recover(gl: WebGL2RenderingContext): void {
    if (this.restoreTimer !== null) clearTimeout(this.restoreTimer);
    this.restoreTimer = null;
    this.probe = probeFormats(gl, this.opts.denyFormats ?? [], this.opts.transcodable);
    this.allocation = this.choose(gl);
    this.g = this.initGl(gl);
    this.lost = false;
    this.opts.onRestored?.();
  }

  /** No restore within 5 s: one new canvas and context; if that fails too, a fatal error (10 §6.13). */
  private readonly replaceCanvas = (): void => {
    this.restoreTimer = null;
    if (!this.lost) return;
    if (this.retriedCanvas) {
      this.opts.onFatal?.('The graphics context was lost and could not be restored.');
      return;
    }
    this.retriedCanvas = true;
    const old = this.canvas;
    const next = old.cloneNode(false) as HTMLCanvasElement;
    old.removeEventListener('webglcontextlost', this.onLost, false);
    old.removeEventListener('webglcontextrestored', this.onRestored, false);
    old.replaceWith(next);
    this.canvas = next;
    this.listen(next);
    this.opts.onCanvas?.(next);
    const gl = next.getContext('webgl2', CONTEXT_ATTRS);
    if (gl === null || gl.isContextLost()) {
      this.opts.onFatal?.('The graphics context was lost and could not be restored.');
      return;
    }
    this.recover(gl);
  };

  /** Whether the live allocations plus `extra` bytes exceed the mode's budget (10 §6.13). */
  private overBudget(g: GlState, extra: number): boolean {
    return this.liveBytes(g) + extra > (MODE_BUDGET_MB[g.textures.mode] as number) * MB;
  }

  /** Every live GPU allocation, bytes (C4-r1 8): atlases, terrain caches, targets, buffers, the LUT. */
  private liveBytes(g: GlState): number {
    const t = g.scene;
    const targets = t === null ? 0 : targetBytes(t.w, t.h, g.halfFloat);
    const n = CYANOTYPE_LUT_SIZE;
    return g.textures.bytes() + g.terrain.bytes() + targets + g.batcher.bytes() + n * n * n * 4;
  }

  /** GPU memory as allocated now (10 §6.13), MB, with the mode, the formats and the budget. */
  memory(): {
    mode: ResolutionMode;
    colour: GpuFormat;
    shadow: GpuFormat;
    atlasMb: number;
    terrainMb: number;
    targetsMb: number;
    buffersMb: number;
    otherMb: number;
    totalMb: number;
    budgetMb: number;
    /** Layers per array, and the pages they hold (fewer layers: the eviction safety net). */
    layers: string;
  } {
    const g = this.g;
    const mode = g?.textures.mode ?? this.allocation.mode;
    const budgetMb = MODE_BUDGET_MB[mode] as number;
    if (g === null)
      return {
        mode,
        colour: this.probe.colour,
        shadow: this.probe.shadow,
        atlasMb: 0,
        terrainMb: 0,
        targetsMb: 0,
        buffersMb: 0,
        otherMb: 0,
        totalMb: 0,
        budgetMb,
        layers: '',
      };
    const t = g.scene;
    const atlas = g.textures.bytes();
    const terrain = g.terrain.bytes();
    const targets = t === null ? 0 : targetBytes(t.w, t.h, g.halfFloat);
    const buffers = g.batcher.bytes();
    const total = this.liveBytes(g);
    return {
      mode,
      colour: this.probe.colour,
      shadow: this.probe.shadow,
      atlasMb: atlas / MB,
      terrainMb: terrain / MB,
      targetsMb: targets / MB,
      buffersMb: buffers / MB,
      otherMb: (total - atlas - terrain - targets - buffers) / MB,
      totalMb: total / MB,
      budgetMb,
      layers: g.textures.arrays
        .map((a) => (a.layers < a.pages ? `${a.layers}/${a.pages}` : `${a.layers}`))
        .join(' '),
    };
  }

  /** Every page of the colour array drawn with k > 0.5 last frame (they want High level 0, 10 §9.7). */
  pagesWantingLevel0(): number[] {
    const out: number[] = [];
    const w = this.scene.wantLevel0;
    for (let i = 0; i < w.length; i++) if (w[i] === 1) out.push(i);
    return out;
  }

  dispose(): void {
    const g = this.g;
    if (!g) return;
    const gl = g.gl;
    g.textures.dispose();
    g.terrain.dispose();
    g.batcher.dispose();
    for (const p of [g.sprite, g.shadow, g.light, g.solid, g.hatch, g.grade]) gl.deleteProgram(p.program);
    gl.deleteTexture(g.lut);
    gl.deleteVertexArray(g.emptyVao);
    for (const t of [g.scene, g.shadowT, g.lightT])
      if (t) {
        gl.deleteFramebuffer(t.fbo);
        gl.deleteTexture(t.tex);
      }
    this.g = null;
    if (this.restoreTimer !== null) clearTimeout(this.restoreTimer);
  }
}

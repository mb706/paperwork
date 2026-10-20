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
  MAX_LAYERS,
  SHADOW_FS,
  SOLID_FS,
  SPRITE_FS,
  SPRITE_VS,
} from './gl/shaders.ts';
import { TerrainPass } from './gl/terrain.ts';
import { AtlasTextures, type PageUpload } from './gl/textures.ts';
import { Lookups } from './lookups.ts';
import { cyanotypeLut } from './lut.ts';
import type { Atlas } from './manifest.ts';
import { type Allocation, chooseMode, otherAllocations, type ResolutionMode } from './memory.ts';
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
  /** Terrain material names in their array's layer order (the manifest's `terrain.tiles`, sorted). */
  terrainTiles?: string[];
  /** A lost context could not be recovered. */
  onFatal?: (message: string) => void;
  /** The context was restored and every page must be uploaded again. */
  onRestored?: () => void;
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

const CONTEXT_ATTRS: WebGLContextAttributes = {
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
    this.probe = probeFormats(gl, opts.denyFormats ?? []);
    this.allocation = this.choose(gl);
    this.g = this.initGl(gl);
    this.listen(this.canvas);
  }

  private choose(gl: WebGL2RenderingContext): Allocation {
    const half =
      gl.getExtension('EXT_color_buffer_float') !== null ||
      gl.getExtension('EXT_color_buffer_half_float') !== null;
    const [w, h] = this.backingSize();
    const other = otherAllocations(w, h, half, 192, 96);
    return chooseMode(this.atlas.json, this.probe.colour, this.probe.shadow, other, this.opts.mode ?? 'high');
  }

  private initGl(gl: WebGL2RenderingContext): GlState {
    const halfFloat =
      gl.getExtension('EXT_color_buffer_float') !== null ||
      gl.getExtension('EXT_color_buffer_half_float') !== null;
    // allocate the atlases in the chosen mode; on OUT_OF_MEMORY step down (10 §6.13)
    let textures: AtlasTextures | null = null;
    for (const mode of ['high', 'normal', 'low'] as ResolutionMode[]) {
      if (['high', 'normal', 'low'].indexOf(mode) < ['high', 'normal', 'low'].indexOf(this.allocation.mode))
        continue;
      try {
        const [w, h] = this.backingSize();
        const alloc = chooseMode(
          this.atlas.json,
          this.probe.colour,
          this.probe.shadow,
          otherAllocations(w, h, halfFloat, 192, 96),
          mode,
        );
        textures = new AtlasTextures(
          gl,
          this.atlas,
          alloc,
          this.probe.colour,
          this.probe.shadow,
          this.terrainTiles,
        );
        this.allocation = alloc;
        break;
      } catch (e) {
        if (!(e instanceof RangeError)) throw e;
      }
    }
    if (textures === null) throw new Error('the atlases do not fit the GPU in any resolution mode');
    const materialLayers = new Map<string, number>(this.terrainTiles.map((t, i) => [t, i]));
    const batcher = new GlBatcher(gl, OVERLAY.solid + 1);
    const terrain = new TerrainPass(gl, this.protos.tile, materialLayers);
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
    return {
      gl,
      sprite: createProgram(gl, SPRITE_VS, SPRITE_FS, 'sprite'),
      shadow: createProgram(gl, SPRITE_VS, SHADOW_FS, 'shadow'),
      light: createProgram(gl, SPRITE_VS, LIGHT_FS, 'light'),
      solid: createProgram(gl, SPRITE_VS, SOLID_FS, 'solid'),
      hatch: createProgram(gl, FULLSCREEN_VS, HATCH_FS, 'hatch'),
      grade: createProgram(gl, FULLSCREEN_VS, GRADE_FS, 'grade'),
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

  /** The GL context (null while lost). */
  get gl(): WebGL2RenderingContext | null {
    return this.g?.gl ?? null;
  }

  get textures(): AtlasTextures | null {
    return this.g?.textures ?? null;
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

  private backingSize(): [number, number] {
    const dpr = this.dpr();
    const w = Math.max(1, Math.round((this.canvas.clientWidth || this.canvas.width) * dpr));
    const h = Math.max(1, Math.round((this.canvas.clientHeight || this.canvas.height) * dpr));
    return [w, h];
  }

  /** Zooms by wheel notches (×1.1 each, I §3.15), clamped to the world's range; positive zooms in. */
  zoomBy(notches: number): void {
    const z = this.camera.zoom * 1.1 ** notches;
    this.camera.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN_WORLD, z));
  }

  /** The visible tile rectangle (x0, y0 inclusive; x1, y1 exclusive), for the view request (§15.4). */
  visibleTiles(): { x0: number; y0: number; x1: number; y1: number } {
    const [w, h] = this.backingSize();
    const cam = this.camera;
    const S = PX_PER_TILE * cam.zoom * this.dpr();
    return {
      x0: Math.floor(cam.cx - w / 2 / S),
      y0: Math.floor(cam.cy - h / 2 / S),
      x1: Math.ceil(cam.cx + w / 2 / S),
      y1: Math.ceil(cam.cy + h / 2 / S),
    };
  }

  /** The followed character's position (tiles), extrapolated like its sprite, or null. */
  private followed(renderTick: number): [number, number] | null {
    const mv = this.mirror.movers;
    for (let i = 0; i < mv.count; i++) {
      const o = i * 32;
      if (mv.view.getUint8(o + MO.kind) !== 0 || mv.view.getUint16(o + MO.aux, true) !== this.follow)
        continue;
      const dt = this.mode === 'continuous' ? renderTick - mv.view.getUint32(o + MO.base_tick, true) : 0;
      return [
        (mv.view.getInt32(o + MO.x, true) + mv.view.getInt16(o + MO.vx, true) * dt) / 256,
        (mv.view.getInt32(o + MO.y, true) + mv.view.getInt16(o + MO.vy, true) * dt) / 256,
      ];
    }
    return null;
  }

  // -------------------------------------------------------------------------------------------- the frame

  /** Draws one frame. `now` is performance.now(). Returns false when nothing could be drawn (context lost). */
  frame(now = performance.now()): boolean {
    const g = this.g;
    if (g === null || this.lost) return false;
    const gl = g.gl;
    const t0 = performance.now();
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
    const [w, h] = this.backingSize();
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ensureTargets(g, w, h);
    // the tick to draw: the packet's, plus the time since it arrived (at most two ticks) when continuous
    const ahead =
      this.mode === 'continuous' ? Math.min(2, Math.max(0, ((now - this.packetTime) * 60) / 1000)) : 0;
    const renderTick = this.mirror.tick + ahead;
    if (this.follow >= 0) {
      const p = this.followed(renderTick);
      if (p) {
        this.camera.cx = p[0];
        this.camera.cy = p[1];
      }
    }
    this.camera.dpr = this.dpr();
    const cam = snapCamera(this.camera, this.snapped);
    const S = scaleOf(cam);
    // uploads within 2 ms (10 §9.7), then the scene
    const tp = performance.now();
    g.textures.pump(2, () => performance.now());
    const tb = performance.now();
    this.scene.resident = g.textures.setResident;
    this.scene.extrapolate = this.mode === 'continuous';
    this.scene.build(this.mirror, cam, w, h, renderTick, this.debug);
    const tu = performance.now();
    const streams = this.scene.streams;
    g.batcher.beginFrame();
    for (let s = 0; s < streams.length; s++) g.batcher.upload(s, streams[s] as Stream);
    const ts = performance.now();
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
    g.terrain.draw(this.mirror, cam, this.rect, [ox, oy], [w, h], g.textures.terrain?.tex ?? null, 3, () =>
      performance.now(),
    );
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
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
    this.hatch(g, sh, ox, oy, w, h, S, cam);
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
    const te = performance.now();
    st.frame++;
    st.pump = tb - tp;
    st.build = tu - tb;
    st.upload = ts - tu;
    st.submit = te - ts;
    st.total = te - t0;
    let sprites = 0;
    for (const s of streams) sprites += s.quads;
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
    const kind = STREAM_KIND[s] as number;
    if (kind >= 0) {
      const a = this.atlas.arrayOfKind[kind] as number;
      const t = g.textures.arrays[a];
      if (!t) return;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, t.tex);
      gl.uniform1i(p.u.uTex as WebGLUniformLocation, 0);
      gl.uniform1fv(p.u.uMinLod as WebGLUniformLocation, t.minLod, 0, MAX_LAYERS);
      gl.uniform1f(p.u.uPageSize as WebGLUniformLocation, this.atlas.pageSize[a] as number);
      gl.uniform1f(p.u.uLevelOffset as WebGLUniformLocation, t.offset);
    }
    g.batcher.draw(s, st);
  }

  private hatch(
    g: GlState,
    sh: Target,
    ox: number,
    oy: number,
    w: number,
    h: number,
    S: number,
    cam: Camera,
  ): void {
    if ((this.scene.streams[STREAM.shadow] as Stream).quads === 0) return;
    const gl = g.gl;
    const p = g.hatch;
    gl.useProgram(p.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sh.tex);
    gl.uniform1i(p.u.uShadow as WebGLUniformLocation, 0);
    gl.uniform2f(p.u.uHalfScale as WebGLUniformLocation, 0.5 / sh.w, 0.5 / sh.h);
    gl.uniform2f(p.u.uSize as WebGLUniformLocation, w, h);
    gl.uniform2f(p.u.uOrigin as WebGLUniformLocation, ox, oy);
    gl.uniform1f(p.u.uS as WebGLUniformLocation, S);
    // the hatching's phase at the camera, in f64: lines anchored to the world, precise at any distance
    const u = ((cam.cx - cam.cy) * Math.SQRT1_2) / SHADOW.periodTiles;
    gl.uniform1f(p.u.uPhase as WebGLUniformLocation, u - Math.floor(u));
    gl.uniform1f(p.u.uPeriod as WebGLUniformLocation, SHADOW.periodTiles);
    gl.uniform1f(p.u.uWidth as WebGLUniformLocation, SHADOW.widthTiles);
    gl.uniform1f(p.u.uInk as WebGLUniformLocation, SHADOW.ink);
    gl.uniform1f(p.u.uDarken as WebGLUniformLocation, SHADOW.darken);
    gl.uniform1f(p.u.uGain as WebGLUniformLocation, SHADOW.maskGain);
    gl.uniform3fv(p.u.uInkColour as WebGLUniformLocation, INK_COLOUR);
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
    gl.uniform1i(p.u.uScene as WebGLUniformLocation, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, li.tex);
    gl.uniform1i(p.u.uLight as WebGLUniformLocation, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_3D, g.lut);
    if (p.u.uLut) gl.uniform1i(p.u.uLut, 2);
    gl.uniform2f(p.u.uHalfScale as WebGLUniformLocation, 0.5 / li.w, 0.5 / li.h);
    gl.uniform1f(p.u.uNight as WebGLUniformLocation, this.night());
    gl.uniform1f(p.u.uStain as WebGLUniformLocation, LIGHT_DAY_STAIN);
    if (p.u.uReveal) gl.uniform1f(p.u.uReveal, NIGHT.reveal);
    if (p.u.uLightAdd) gl.uniform1f(p.u.uLightAdd, NIGHT.lightAdd);
    if (p.u.uLutSize) gl.uniform1f(p.u.uLutSize, CYANOTYPE_LUT_SIZE);
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
    this.probe = probeFormats(gl, this.opts.denyFormats ?? []);
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

  /** GPU memory as allocated (10 §6.13), MB, with the mode and formats. */
  memory(): {
    mode: ResolutionMode;
    colour: GpuFormat;
    shadow: GpuFormat;
    atlasMb: number;
    otherMb: number;
    totalMb: number;
  } {
    const a = this.allocation;
    return {
      mode: a.mode,
      colour: this.probe.colour,
      shadow: this.probe.shadow,
      atlasMb: a.atlasBytes / 1048576,
      otherMb: a.otherBytes / 1048576,
      totalMb: a.total / 1048576,
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

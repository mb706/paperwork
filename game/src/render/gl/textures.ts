// The atlas texture arrays (10 §6.4, §6.13, §9.7): one immutable TEXTURE_2D_ARRAY per kind, allocated once at load
// with the manifest's page count and the levels of the resolution mode, never grown. Pages arrive as transcoded
// levels from the asset worker and are uploaded within a per-frame budget; a page is resident when every level of
// its mode except High's level 0 is in, and until level 0 arrives the shader clamps that layer's LOD.
//
// C4-r1 5 and 9: allocation is transactional (any GL error fails the attempt, which deletes everything it created),
// checked against the GPU's limits first; frames name a page, and a page → layer table maps it to a layer: the
// identity, unless the arrays had to be allocated with fewer layers than pages (§6.13 "Eviction, the safety net"),
// when pages share layers least-recently-drawn and an evicted page's sets draw greyboxes until it is uploaded again.
// The LOD clamp of every layer lives in a small R8UI texture per array (one texel per layer), so any layer count works.

import type { ArrayKind, Atlas } from '../manifest.ts';
import { levelOffset, type ResolutionMode } from '../memory.ts';
import { FORMATS, type GpuFormat, glFormat, levelBytes } from './formats.ts';

/** One transcoded KTX2 file's levels, ready to upload. */
export interface PageUpload {
  /** The manifest's array index, or −1 for a terrain material. */
  array: number;
  /** The page (array page index, or the material's layer). */
  layer: number;
  format: GpuFormat;
  /** The page level of the file's first level (a colour page's .n file starts at level 1). */
  firstLevel: number;
  levels: { width: number; height: number; data: Uint8Array }[];
}

export interface ArrayTex {
  kind: ArrayKind | 'terrain';
  tex: WebGLTexture;
  format: GpuFormat;
  glFormat: number;
  size: number;
  levels: number;
  /** Page levels this mode drops from the top. */
  offset: number;
  /** The manifest's pages, and the layers allocated for them (fewer only under the eviction safety net). */
  pages: number;
  layers: number;
  /** page → layer, −1 when the page is not resident; null: the identity (every page has its layer). */
  pageLayer: Int32Array | null;
  /** layer → page, −1 when free (eviction only). */
  layerPage: Int32Array | null;
  /** Per layer: the frame its page was last drawn or uploaded (eviction only: least recently used goes first). */
  used: Float64Array | null;
  /** Per layer: a bit per uploaded page level. */
  have: Int32Array;
  /** Per layer: the bits that make it resident (every level of the mode but level 0). */
  need: number;
  /** Per layer: the lowest level the shader may sample (1 until a High colour page's level 0 arrives). */
  minLod: Uint8Array;
  /** The same, one R8UI texel per layer, for the sprite shader (texelFetch by layer; C4-r1 9). */
  lodTex: WebGLTexture | null;
  /** Bytes of storage (every level, every layer). */
  bytes: number;
}

/** Why an allocation failed (the renderer tries the next mode, then the safety net). */
export class AllocationError extends Error {}

/** Clears stale errors (another call's), so the next getError() is the allocation's own. */
function drainErrors(gl: WebGL2RenderingContext): void {
  for (let i = 0; i < 16 && gl.getError() !== gl.NO_ERROR; i++);
}

export class AtlasTextures {
  readonly gl: WebGL2RenderingContext;
  readonly mode: ResolutionMode;
  readonly arrays: ArrayTex[] = [];
  terrain: ArrayTex | null = null;
  /** Per set: 1 when every page it draws from is resident. */
  readonly setResident: Uint8Array;
  /** Whether some array shares layers between pages (the safety net). */
  readonly evicting: boolean;
  private readonly atlas: Atlas;
  private readonly queue: { up: PageUpload; next: number }[] = [];
  private readonly one = new Uint8Array(1);
  /** The frame counter of the LRU clock (the renderer advances it). */
  frame = 0;
  /** Bumped whenever residency changes (the scene's caches compare it). */
  rev = 0;
  /** Bytes uploaded since the last `takeStats`. */
  uploadedBytes = 0;
  uploadMs = 0;
  /** Pages evicted for another (array << 16 | page): the loader asks for them again when they are drawn. */
  onEvict: ((array: number, page: number) => void) | null = null;
  /** Uploads dropped because their format is not the array's (a file of an older upload epoch). */
  dropped = 0;

  /**
   * Allocates every array of `mode` (at most `layerCap` layers per array), or throws AllocationError having
   * deleted everything it created. Any GL error fails it, not only OUT_OF_MEMORY (C4-r1 5).
   */
  constructor(
    gl: WebGL2RenderingContext,
    atlas: Atlas,
    mode: ResolutionMode,
    colour: GpuFormat,
    shadow: GpuFormat,
    terrainNames: string[],
    layerCap = Number.POSITIVE_INFINITY,
  ) {
    this.gl = gl;
    this.atlas = atlas;
    this.mode = mode;
    const m = atlas.json;
    const maxLayers = (gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number) || 256;
    const maxSize = (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) || 4096;
    drainErrors(gl);
    try {
      m.arrays.forEach((a, i) => {
        const f: GpuFormat =
          a.codec === 'rgba8'
            ? a.kind === 'shadow'
              ? 'r8'
              : 'rgba8'
            : a.kind === 'shadow'
              ? shadow
              : colour;
        const off = levelOffset(a.kind, mode, a.levels);
        const pages = Math.max(1, m.pages[i]?.length ?? 0);
        const layers = Math.min(pages, maxLayers, Math.max(1, layerCap));
        const size = a.pageSize >> off;
        if (size > maxSize)
          throw new AllocationError(`${a.kind}: ${size}² exceeds MAX_TEXTURE_SIZE ${maxSize}`);
        this.arrays.push(this.allocate(a.kind, f, size, a.levels - off, off, pages, layers, false));
      });
      if (m.terrain && terrainNames.length > 0) {
        const t = m.terrain;
        const f: GpuFormat = t.codec === 'rgba8' ? 'rgba8' : colour;
        const off = levelOffset('terrain', mode, t.levels);
        const n = terrainNames.length;
        if (n > maxLayers) throw new AllocationError(`terrain: ${n} materials exceed ${maxLayers} layers`);
        this.terrain = this.allocate('terrain', f, t.size >> off, t.levels - off, off, n, n, true);
      }
    } catch (e) {
      this.dispose();
      throw e instanceof AllocationError
        ? e
        : new AllocationError(e instanceof Error ? e.message : String(e));
    }
    this.evicting = this.arrays.some((a) => a.layers < a.pages);
    this.totalBytes = this.arrays.reduce((b, a) => b + a.bytes, this.terrain?.bytes ?? 0);
    this.setResident = new Uint8Array(atlas.sets.length);
  }

  private allocate(
    kind: ArrayKind | 'terrain',
    format: GpuFormat,
    size: number,
    levels: number,
    offset: number,
    pages: number,
    layers: number,
    repeat: boolean,
  ): ArrayTex {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (tex === null) throw new AllocationError(`${kind}: createTexture failed`);
    const internal = glFormat(gl, format);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, internal, size, size, layers);
    const err = gl.getError();
    if (err !== gl.NO_ERROR) {
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
      gl.deleteTexture(tex);
      throw new AllocationError(`${kind}: GL error 0x${err.toString(16)} allocating ${layers} × ${size}²`);
    }
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, wrap);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    // every level of the mode except the page's level 0 (High only) makes a layer resident
    const high = kind === 'colour' && offset === 0 && levels > 1;
    let need = 0;
    for (let l = Math.max(offset, high ? 1 : 0); l < offset + levels; l++) need |= 1 << l;
    let bytes = 0;
    for (let l = 0; l < levels; l++) bytes += levelBytes(format, Math.max(1, size >> l)) * layers;
    const minLod = new Uint8Array(layers).fill(high ? 1 : 0);
    const a: ArrayTex = {
      kind,
      tex,
      format,
      glFormat: internal,
      size,
      levels,
      offset,
      pages,
      layers,
      pageLayer: null,
      layerPage: null,
      used: null,
      have: new Int32Array(layers),
      need,
      minLod,
      lodTex: null,
      bytes,
    };
    if (layers < pages) {
      a.pageLayer = new Int32Array(pages).fill(-1);
      a.layerPage = new Int32Array(layers).fill(-1);
      a.used = new Float64Array(layers).fill(-1);
    }
    if (kind !== 'terrain') {
      const lod = gl.createTexture();
      if (lod === null) {
        gl.deleteTexture(tex);
        throw new AllocationError(`${kind}: createTexture failed (LOD)`);
      }
      gl.bindTexture(gl.TEXTURE_2D, lod);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8UI, layers, 1);
      const e2 = gl.getError();
      if (e2 !== gl.NO_ERROR) {
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.deleteTexture(lod);
        gl.deleteTexture(tex);
        throw new AllocationError(`${kind}: GL error 0x${e2.toString(16)} allocating the LOD texture`);
      }
      a.lodTex = lod;
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, layers, 1, gl.RED_INTEGER, gl.UNSIGNED_BYTE, minLod);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER])
        gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
      gl.bindTexture(gl.TEXTURE_2D, null);
      a.bytes += layers;
    }
    return a;
  }

  /** Bytes of every array (atlases and terrain materials), as allocated (fixed for the allocation's life). */
  bytes(): number {
    return this.totalBytes;
  }
  private totalBytes = 0;

  /** Queues a transcoded file for upload. */
  enqueue(up: PageUpload): void {
    this.queue.push({ up, next: 0 });
  }

  get pending(): number {
    return this.queue.length;
  }

  /**
   * Uploads queued levels for up to `budgetMs` (10 §9.7: 2 ms per frame), at least one level so a slow frame still
   * makes progress. Returns the levels uploaded. With nothing queued it reads no clock.
   */
  pump(budgetMs: number, now: () => number): number {
    if (this.queue.length === 0) return 0;
    const gl = this.gl;
    const t0 = now();
    let n = 0;
    while (this.queue.length > 0) {
      const job = this.queue[0] as { up: PageUpload; next: number };
      const up = job.up;
      const a = up.array < 0 ? this.terrain : this.arrays[up.array];
      if (!a || up.layer < 0 || up.layer >= a.pages || up.format !== a.format) {
        // a file for another allocation (an older upload epoch's format, a page past the array): not ours
        if (a && up.format !== a.format) this.dropped++;
        this.queue.shift();
        continue;
      }
      const lv = up.levels[job.next] as { width: number; height: number; data: Uint8Array };
      const pageLevel = up.firstLevel + job.next;
      const texLevel = pageLevel - a.offset;
      job.next++;
      if (job.next >= up.levels.length) this.queue.shift();
      if (texLevel < 0 || texLevel >= a.levels) continue;
      const layer = this.layerFor(a, up.array, up.layer);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, a.tex);
      if (FORMATS[a.format].compressed)
        gl.compressedTexSubImage3D(
          gl.TEXTURE_2D_ARRAY,
          texLevel,
          0,
          0,
          layer,
          lv.width,
          lv.height,
          1,
          a.glFormat,
          lv.data,
        );
      else {
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texSubImage3D(
          gl.TEXTURE_2D_ARRAY,
          texLevel,
          0,
          0,
          layer,
          lv.width,
          lv.height,
          1,
          a.format === 'r8' ? gl.RED : gl.RGBA,
          gl.UNSIGNED_BYTE,
          lv.data,
        );
      }
      this.uploadedBytes += lv.data.byteLength;
      const before = (a.have[layer] as number) & a.need;
      a.have[layer] = (a.have[layer] as number) | (1 << pageLevel);
      if (pageLevel === 0 && a.kind === 'colour') this.setMinLod(a, layer, 0);
      if (((a.have[layer] as number) & a.need) !== before) this.residencyChanged();
      n++;
      if (now() - t0 >= budgetMs) break;
    }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    this.uploadMs += now() - t0;
    return n;
  }

  /** The layer of page `page`, giving it one (a free layer, or the least recently used page's) if it has none. */
  private layerFor(a: ArrayTex, array: number, page: number): number {
    const pl = a.pageLayer;
    if (pl === null) return page;
    const used = a.used as Float64Array;
    let layer = pl[page] as number;
    if (layer < 0) {
      const lp = a.layerPage as Int32Array;
      let best = -1;
      for (let l = 0; l < a.layers; l++) {
        if ((lp[l] as number) < 0) {
          best = l;
          break;
        }
        if (best < 0 || (used[l] as number) < (used[best] as number)) best = l;
      }
      layer = best;
      const old = lp[layer] as number;
      if (old >= 0) {
        pl[old] = -1;
        this.onEvict?.(array, old);
      }
      lp[layer] = page;
      pl[page] = layer;
      a.have[layer] = 0;
      if (a.kind === 'colour' && a.offset === 0 && a.levels > 1) this.setMinLod(a, layer, 1);
      this.residencyChanged();
    }
    used[layer] = this.frame;
    return layer;
  }

  private setMinLod(a: ArrayTex, layer: number, v: number): void {
    if (a.minLod[layer] === v) return;
    a.minLod[layer] = v;
    if (a.lodTex === null) return;
    const gl = this.gl;
    this.one[0] = v;
    gl.bindTexture(gl.TEXTURE_2D, a.lodTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, layer, 0, 1, 1, gl.RED_INTEGER, gl.UNSIGNED_BYTE, this.one);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /** The lowest level layer `layer` of array `array` may sample (tests, the HUD). */
  minLodOf(array: number, layer: number): number {
    return this.arrays[array]?.minLod[layer] ?? 0;
  }

  /** Whether page `page` of array `array` is resident (every level of the mode but level 0). */
  resident(array: number, page: number): boolean {
    const a = this.arrays[array];
    if (!a) return false;
    const layer = a.pageLayer === null ? page : (a.pageLayer[page] as number);
    if (layer < 0 || layer >= a.layers) return false;
    return ((a.have[layer] as number) & a.need) === a.need;
  }

  /** Whether level 0 of a colour page is in. */
  hasLevel0(array: number, page: number): boolean {
    const a = this.arrays[array];
    if (!a) return false;
    const layer = a.pageLayer === null ? page : (a.pageLayer[page] as number);
    return layer >= 0 && ((a.have[layer] as number) & 1) !== 0;
  }

  terrainResident(layer: number): boolean {
    const t = this.terrain;
    return t !== null && ((t.have[layer] as number) & t.need) === t.need;
  }

  private residencyChanged(): void {
    this.rev++;
    for (const s of this.atlas.sets) {
      let ok = 1;
      for (let i = 0; i < s.pageKeys.length; i++) {
        const k = s.pageKeys[i] as number;
        if (!this.resident(k >>> 16, k & 0xffff)) {
          ok = 0;
          break;
        }
      }
      this.setResident[s.index] = ok;
    }
  }

  /** Deletes every texture (a failed allocation, a lost context, a mode change). */
  dispose(): void {
    const gl = this.gl;
    for (const a of this.arrays) {
      gl.deleteTexture(a.tex);
      if (a.lodTex) gl.deleteTexture(a.lodTex);
    }
    if (this.terrain) gl.deleteTexture(this.terrain.tex);
    this.arrays.length = 0;
    this.terrain = null;
    this.queue.length = 0;
  }

  takeStats(): { bytes: number; ms: number } {
    const r = { bytes: this.uploadedBytes, ms: this.uploadMs };
    this.uploadedBytes = 0;
    this.uploadMs = 0;
    return r;
  }
}

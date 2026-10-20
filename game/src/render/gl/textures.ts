// The atlas texture arrays (10 §6.4, §6.13, §9.7): one immutable TEXTURE_2D_ARRAY per kind, allocated once at load
// with the manifest's page count and the levels of the resolution mode, never grown. Pages arrive as transcoded
// levels from the asset worker and are uploaded within a per-frame budget; a page is resident when every level of
// its mode except High's level 0 is in, and until level 0 arrives the shader clamps that layer's LOD (uMinLod).

import type { ArrayKind, Atlas } from '../manifest.ts';
import type { Allocation, ResolutionMode } from '../memory.ts';
import { levelOffset } from '../memory.ts';
import { FORMATS, type GpuFormat, glFormat } from './formats.ts';
import { MAX_LAYERS } from './shaders.ts';

/** One transcoded KTX2 file's levels, ready to upload. */
export interface PageUpload {
  /** The manifest's array index, or −1 for a terrain material. */
  array: number;
  /** The page's layer (array page index, or the material's layer). */
  layer: number;
  format: GpuFormat;
  /** The page level of the file's first level (a colour page's .n file starts at level 1). */
  firstLevel: number;
  levels: { width: number; height: number; data: Uint8Array }[];
}

interface ArrayTex {
  kind: ArrayKind | 'terrain';
  tex: WebGLTexture;
  format: GpuFormat;
  glFormat: number;
  size: number;
  levels: number;
  /** Page levels this mode drops from the top. */
  offset: number;
  layers: number;
  /** Per layer: a bit per uploaded page level. */
  have: Int32Array;
  /** Per layer: the bits that make it resident (every level of the mode but level 0). */
  need: number;
  minLod: Float32Array;
}

export class AtlasTextures {
  readonly gl: WebGL2RenderingContext;
  readonly mode: ResolutionMode;
  readonly arrays: ArrayTex[] = [];
  terrain: ArrayTex | null = null;
  /** Per set: 1 when every page it draws from is resident. */
  readonly setResident: Uint8Array;
  private readonly atlas: Atlas;
  private readonly queue: { up: PageUpload; next: number }[] = [];
  /** Bumped whenever residency changes (the scene's caches compare it). */
  rev = 0;
  /** Bytes uploaded since the last `takeStats`. */
  uploadedBytes = 0;
  uploadMs = 0;

  constructor(
    gl: WebGL2RenderingContext,
    atlas: Atlas,
    alloc: Allocation,
    colour: GpuFormat,
    shadow: GpuFormat,
    terrainNames: string[],
  ) {
    this.gl = gl;
    this.atlas = atlas;
    this.mode = alloc.mode;
    const m = atlas.json;
    m.arrays.forEach((a, i) => {
      const f: GpuFormat =
        a.codec === 'rgba8' ? (a.kind === 'shadow' ? 'r8' : 'rgba8') : a.kind === 'shadow' ? shadow : colour;
      const off = levelOffset(a.kind, this.mode, a.levels);
      const layers = Math.max(1, m.pages[i]?.length ?? 0);
      this.arrays.push(this.allocate(a.kind, f, a.pageSize >> off, a.levels - off, off, layers, false));
    });
    if (m.terrain && terrainNames.length > 0) {
      const t = m.terrain;
      const f: GpuFormat = t.codec === 'rgba8' ? 'rgba8' : colour;
      const off = levelOffset('terrain', this.mode, t.levels);
      this.terrain = this.allocate(
        'terrain',
        f,
        t.size >> off,
        t.levels - off,
        off,
        terrainNames.length,
        true,
      );
    }
    this.setResident = new Uint8Array(atlas.sets.length);
  }

  private allocate(
    kind: ArrayKind | 'terrain',
    format: GpuFormat,
    size: number,
    levels: number,
    offset: number,
    layers: number,
    repeat: boolean,
  ): ArrayTex {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (tex === null) throw new Error('texture allocation failed');
    const internal = glFormat(gl, format);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, internal, size, size, layers);
    const err = gl.getError();
    if (err === gl.OUT_OF_MEMORY)
      throw new RangeError(`${kind}: OUT_OF_MEMORY allocating ${layers} × ${size}²`);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, wrap);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    // every level of the mode except the page's level 0 (High only) makes a layer resident
    let need = 0;
    for (
      let l = Math.max(offset, kind === 'colour' && offset === 0 && levels > 1 ? 1 : 0);
      l < offset + levels;
      l++
    )
      need |= 1 << l;
    const minLod = new Float32Array(MAX_LAYERS);
    // until level 0 arrives a High colour page samples from level 1
    if (kind === 'colour' && offset === 0 && levels > 1) minLod.fill(1);
    return {
      kind,
      tex,
      format,
      glFormat: internal,
      size,
      levels,
      offset,
      layers,
      have: new Int32Array(layers),
      need,
      minLod,
    };
  }

  /** Queues a transcoded file for upload. */
  enqueue(up: PageUpload): void {
    this.queue.push({ up, next: 0 });
  }

  get pending(): number {
    return this.queue.length;
  }

  /**
   * Uploads queued levels for up to `budgetMs` (10 §9.7: 2 ms per frame), at least one level so a slow frame still
   * makes progress. Returns the levels uploaded.
   */
  pump(budgetMs: number, now: () => number): number {
    const gl = this.gl;
    const t0 = now();
    let n = 0;
    while (this.queue.length > 0) {
      const job = this.queue[0] as { up: PageUpload; next: number };
      const up = job.up;
      const a = up.array < 0 ? this.terrain : this.arrays[up.array];
      if (!a || up.layer >= a.layers) {
        this.queue.shift();
        continue;
      }
      const lv = up.levels[job.next] as { width: number; height: number; data: Uint8Array };
      const pageLevel = up.firstLevel + job.next;
      const texLevel = pageLevel - a.offset;
      job.next++;
      if (job.next >= up.levels.length) this.queue.shift();
      if (texLevel < 0 || texLevel >= a.levels) continue;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, a.tex);
      const info = FORMATS[a.format];
      if (up.format !== a.format) throw new Error(`upload of ${up.format} into a ${a.format} array`);
      if (info.compressed)
        gl.compressedTexSubImage3D(
          gl.TEXTURE_2D_ARRAY,
          texLevel,
          0,
          0,
          up.layer,
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
          up.layer,
          lv.width,
          lv.height,
          1,
          a.format === 'r8' ? gl.RED : gl.RGBA,
          gl.UNSIGNED_BYTE,
          lv.data,
        );
      }
      this.uploadedBytes += lv.data.byteLength;
      const before = (a.have[up.layer] as number) & a.need;
      a.have[up.layer] = (a.have[up.layer] as number) | (1 << pageLevel);
      if (pageLevel === 0 && a.kind === 'colour') a.minLod[up.layer] = 0;
      if (((a.have[up.layer] as number) & a.need) !== before) this.residencyChanged();
      n++;
      if (now() - t0 >= budgetMs) break;
    }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    this.uploadMs += now() - t0;
    return n;
  }

  /** Whether page `layer` of array `array` is resident (every level of the mode but level 0). */
  resident(array: number, layer: number): boolean {
    const a = this.arrays[array];
    if (!a) return false;
    return ((a.have[layer] as number) & a.need) === a.need;
  }

  /** Whether level 0 of a colour page is in. */
  hasLevel0(array: number, layer: number): boolean {
    const a = this.arrays[array];
    return a !== undefined && ((a.have[layer] as number) & 1) !== 0;
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

  /** Forgets every upload (after a lost context, the arrays are re-created and refilled). */
  dispose(): void {
    const gl = this.gl;
    for (const a of this.arrays) gl.deleteTexture(a.tex);
    if (this.terrain) gl.deleteTexture(this.terrain.tex);
    this.queue.length = 0;
  }

  takeStats(): { bytes: number; ms: number } {
    const r = { bytes: this.uploadedBytes, ms: this.uploadMs };
    this.uploadedBytes = 0;
    this.uploadMs = 0;
    return r;
  }
}

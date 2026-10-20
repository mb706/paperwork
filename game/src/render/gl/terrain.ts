// The terrain pass (10 §6.5, §9.9): one quad per visible chunk through the terrain shader, which reads the chunk's
// tile ids (a layer of an R8UI array), its shore texture when it has water or trees (a layer of an RG8 array), the
// material textures (an array with one 512² layer per tile type) and a 256-entry tile table (material layer, flags,
// tint). Chunk layers are given out as chunks enter the held set and taken back when they leave; the shore textures
// are rebuilt within a per-frame budget, so a jump of the view never stalls a frame.
//
// C4-r1 1 and 7: the caches belong to one world (a new world, the mirror's epoch, empties them, whatever coordinates
// it reuses); they grow when the held chunks need more layers (the old layers copied on the GPU), up to the GPU's
// layer limit, and past it visible chunks take the layers of chunks out of view, least recently drawn first. A chunk
// that could not get a shore layer stays pending and is tried again.

import type { JsonTile } from '../../shared/gen/protos.ts';
import type { ChunkView, Mirror } from '../mirror.ts';
import { chunkId, OV } from '../mirror.ts';
import { type Camera, CHUNK_TILES, scaleOf } from '../projection.ts';
import { CRISP_TILES, hex, PAPER_TONE, TERRAIN, TILE_FALLBACK, WATER_TILES } from '../style.ts';
import {
  buildIds,
  buildShore,
  ID_SIZE,
  needsShore,
  SHORE_BORDER,
  SHORE_SIZE,
  ShoreScratch,
} from '../terrain-data.ts';
import { createProgram, type Program } from './program.ts';
import { TERRAIN_FS, TERRAIN_VS } from './shaders.ts';

/** Washes of the materials the asset build makes (A3 §3.1), to tint one into another (TILE_FALLBACK). */
const MATERIAL_WASH: Record<string, string> = {
  grass: '#e2e6c6',
  dirt: '#e9dcc0',
  sand: '#efe2bf',
  water: '#c4dbe2',
  'deep-water': '#aecbd8',
  'out-of-map': '#ece3cb',
};
/** A flat wash per tile type when no material at all is available (the fixture atlas has none). */
const FLAT_WASH: Record<string, string> = {
  ...MATERIAL_WASH,
  'out-of-map': '#b9b2a2',
  'dry-dirt': '#e6d2ad',
  'red-desert': '#e8c9b0',
};

interface Slot {
  idLayer: number;
  shoreLayer: number;
  /** The neighbourhood signature the layers were built from. */
  sig: number;
  shoreSig: number;
  /** The frame it was last prepared, and last in view (eviction takes the least recently seen out of view). */
  frame: number;
  seen: number;
}

const VERTEX_BYTES = 32;

export class TerrainPass {
  readonly gl: WebGL2RenderingContext;
  readonly prog: Program;
  ids: WebGLTexture;
  shore: WebGLTexture;
  readonly tiles: WebGLTexture;
  readonly vao: WebGLVertexArrayObject;
  readonly vbo: WebGLBuffer;
  idCapacity: number;
  shoreCapacity: number;
  /** The GPU's limit on array layers: the caches grow up to it. */
  private readonly maxLayers: number;
  /** The mirror epoch the cached layers belong to (C4-r1 1). */
  private epoch = -1;
  private copyFbo: WebGLFramebuffer | null = null;
  private vboBytes = 0;
  private readonly slots = new Map<number, Slot>();
  private readonly freeIds: number[] = [];
  private readonly freeShore: number[] = [];
  private readonly isWater = new Uint8Array(256);
  private readonly idBuf = new Uint8Array(ID_SIZE * ID_SIZE);
  private readonly shoreBuf = new Uint8Array(SHORE_SIZE * SHORE_SIZE * 2);
  private readonly scratch = new ShoreScratch();
  private trees = new Float64Array(512);
  private vertices = new ArrayBuffer(VERTEX_BYTES * 4 * 64);
  private vf32 = new Float32Array(this.vertices);
  private vi32 = new Int32Array(this.vertices);
  /** Computed uniforms (origin, target, scale, lining fade), passed as typed arrays. */
  private readonly uni = new Float32Array(8);
  private frameNo = 0;
  /** The chunks drawn and the shore textures built in the last frame (the HUD). */
  drawn = 0;
  shoresBuilt = 0;
  /** Whether some material is missing (drawn as a wash). */
  readonly materialLayers: Map<string, number>;

  /** Per tree species: 1 when the atlas can draw it (an undrawable tree tints no woodland). */
  private readonly treeDrawable: Uint8Array;

  constructor(
    gl: WebGL2RenderingContext,
    tileProtos: readonly JsonTile[],
    materialLayers: Map<string, number>,
    treeDrawable: Uint8Array,
    idCapacity = 192,
    shoreCapacity = 96,
  ) {
    this.gl = gl;
    this.materialLayers = materialLayers;
    this.treeDrawable = treeDrawable;
    this.maxLayers = (gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number) || 256;
    this.idCapacity = Math.min(idCapacity, this.maxLayers);
    this.shoreCapacity = Math.min(shoreCapacity, this.maxLayers);
    this.prog = createProgram(gl, TERRAIN_VS, TERRAIN_FS, 'terrain');
    // the uniforms that never change, once (they live in the program object; per frame they would box doubles)
    const p = this.prog.u;
    gl.useProgram(this.prog.program);
    if (p.uMatTiles) gl.uniform1f(p.uMatTiles, TERRAIN.materialTiles);
    if (p.uWarp) gl.uniform1f(p.uWarp, TERRAIN.warpTiles);
    if (p.uWarpCell) gl.uniform1f(p.uWarpCell, TERRAIN.warpCellTiles);
    if (p.uKerb) gl.uniform3fv(p.uKerb, TERRAIN.kerb);
    if (p.uKerbAlpha) gl.uniform1f(p.uKerbAlpha, TERRAIN.kerbAlpha);
    if (p.uLiningInk) gl.uniform3fv(p.uLiningInk, TERRAIN.liningInk);
    if (p.uLiningAlpha) gl.uniform1f(p.uLiningAlpha, TERRAIN.liningAlpha);
    if (p.uLining) gl.uniform1fv(p.uLining, TERRAIN.lining);
    if (p.uShore) gl.uniform3fv(p.uShore, TERRAIN.shore);
    if (p.uShoreAlpha) gl.uniform1f(p.uShoreAlpha, TERRAIN.shoreAlpha);
    if (p.uShorePx) gl.uniform1f(p.uShorePx, TERRAIN.shorePx);
    if (p.uWoodland) gl.uniform3fv(p.uWoodland, WOODLAND_RATIO);
    if (p.uWoodlandAlpha) gl.uniform1f(p.uWoodlandAlpha, TERRAIN.woodlandAlpha);
    if (p.uIds) gl.uniform1i(p.uIds, 0);
    if (p.uSdf) gl.uniform1i(p.uSdf, 1);
    if (p.uMats) gl.uniform1i(p.uMats, 2);
    if (p.uTiles) gl.uniform1i(p.uTiles, 3);
    gl.useProgram(null);
    const tiles = gl.createTexture();
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    if (!tiles || !vao || !vbo) throw new Error('terrain: GL allocation failed');
    this.tiles = tiles;
    this.vao = vao;
    this.vbo = vbo;
    this.ids = this.array(gl.R8UI, ID_SIZE, this.idCapacity, false);
    this.shore = this.array(gl.RG8, SHORE_SIZE, this.shoreCapacity, true);
    for (let i = this.idCapacity - 1; i >= 0; i--) this.freeIds.push(i);
    for (let i = this.shoreCapacity - 1; i >= 0; i--) this.freeShore.push(i);
    this.uploadTileTable(tileProtos);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.enableVertexAttribArray(2);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, VERTEX_BYTES, 0);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, VERTEX_BYTES, 8);
    gl.vertexAttribIPointer(2, 2, gl.INT, VERTEX_BYTES, 16);
    gl.vertexAttribIPointer(3, 2, gl.INT, VERTEX_BYTES, 24);
    gl.bindVertexArray(null);
  }

  /** The tile table: per tile id (rgb tint, a = material layer + 256 · flags), flags bit 0 crisp, bit 1 water. */
  private uploadTileTable(tiles: readonly JsonTile[]): void {
    const gl = this.gl;
    const data = new Float32Array(256 * 4);
    const hasAny = this.materialLayers.size > 0;
    const waterLayer = this.materialLayers.get('water') ?? this.materialLayers.get('deep-water');
    tiles.forEach((t, id) => {
      if (id >= 256) return;
      let layer = this.materialLayers.get(t.name);
      let tint: [number, number, number] = [1, 1, 1];
      if (layer === undefined) {
        const fb = TILE_FALLBACK[t.name];
        const base = fb?.base ? this.materialLayers.get(fb.base) : undefined;
        if (fb && base !== undefined && fb.base) {
          layer = base;
          tint = ratio(hex(fb.wash), hex(MATERIAL_WASH[fb.base] ?? '#ece3cb'));
        } else if (fb && waterLayer !== undefined) {
          layer = waterLayer;
          tint = ratio(hex(fb.wash), hex(this.materialLayers.has('water') ? '#c4dbe2' : '#aecbd8'));
        } else if (!hasAny || layer === undefined) {
          tint = hex(FLAT_WASH[t.name] ?? fb?.wash ?? t.mapColor ?? '#ece3cb');
          if (!FLAT_WASH[t.name] && !fb) tint = mixPaper(hex(t.mapColor));
        }
      }
      const flags = (CRISP_TILES.has(t.name) ? 1 : 0) | (WATER_TILES.has(t.name) ? 2 : 0);
      this.isWater[id] = WATER_TILES.has(t.name) ? 1 : 0;
      data.set([tint[0], tint[1], tint[2], (layer ?? 255) + 256 * flags], id * 4);
    });
    gl.bindTexture(gl.TEXTURE_2D, this.tiles);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 256, 1, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /**
   * Releases the layers of chunks the mirror no longer holds (bound callbacks: no iterator per frame), and every
   * layer when the mirror holds another world (its epoch moved): chunk coordinates and revisions start again there.
   */
  private collect(mirror: Mirror): void {
    this.mirrorNow = mirror;
    if (mirror.epoch !== this.epoch) {
      this.epoch = mirror.epoch;
      this.slots.forEach(this.releaseAll);
      this.slots.clear();
    }
    if (this.slots.size > mirror.chunks.size || this.slotsSeen !== mirror.terrainRev)
      this.slots.forEach(this.release);
    this.slotsSeen = mirror.terrainRev;
  }
  private readonly releaseAll = (slot: Slot): void => {
    this.freeIds.push(slot.idLayer);
    if (slot.shoreLayer >= 0) this.freeShore.push(slot.shoreLayer);
  };
  private slotsSeen = -1;
  private readonly release = (slot: Slot, id: number): void => {
    if (this.mirrorNow?.chunks.has(id)) return;
    this.freeIds.push(slot.idLayer);
    if (slot.shoreLayer >= 0) this.freeShore.push(slot.shoreLayer);
    this.slots.delete(id);
  };

  /** The neighbourhood's signature: the chunk's and its eight neighbours' terrain revisions and presence. */
  private signature(mirror: Mirror, c: ChunkView): number {
    let h = 17;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const n = mirror.chunks.get(chunkId(c.cx + dx, c.cy + dy));
        const v = n?.tiles ? n.terrainRev + 1 : 0;
        h = (Math.imul(h, 31) + v + (n?.objectCount ?? 0) * 7) | 0;
      }
    return h & 0x3fffffff;
  }

  /** Tiles of chunk (x, y) from the mirror (bound once, so the per-frame walk allocates nothing). */
  private mirrorNow: Mirror | null = null;
  private readonly tilesOf = (x: number, y: number): Uint8Array | null =>
    this.mirrorNow?.chunks.get(chunkId(x, y))?.tiles ?? null;

  /** Held chunks whose shore texture is missing or stale (tests wait for 0 before a screenshot). */
  pending = 0;

  /** A chunk's slot, its tile ids rebuilt when its neighbourhood changed; null over capacity. */
  private slotOf(mirror: Mirror, c: ChunkView): Slot | null {
    const gl = this.gl;
    let slot = this.slots.get(c.id);
    if (!slot) {
      if (this.freeIds.length === 0 && !this.growIds()) this.evict(true);
      const idLayer = this.freeIds.pop();
      if (idLayer === undefined) return null; // every layer holds a chunk in view: drawn next frame
      slot = { idLayer, shoreLayer: -1, sig: 0, shoreSig: -1, frame: 0, seen: 0 };
      this.slots.set(c.id, slot);
    }
    const sig = this.signature(mirror, c);
    if (sig !== slot.sig || slot.sig === 0) {
      buildIds(this.tilesOf, c.cx, c.cy, this.idBuf);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.ids);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        0,
        0,
        slot.idLayer,
        ID_SIZE,
        ID_SIZE,
        1,
        gl.RED_INTEGER,
        gl.UNSIGNED_BYTE,
        this.idBuf,
      );
      slot.sig = sig;
    }
    return slot;
  }

  /** Rebuilds a chunk's shore texture (water distance and woodland), or frees it when nothing needs one. */
  private buildShoreOf(mirror: Mirror, c: ChunkView, slot: Slot): void {
    const gl = this.gl;
    buildIds(this.tilesOf, c.cx, c.cy, this.idBuf);
    const n = this.collectTrees(mirror, c.cx, c.cy);
    if (needsShore(this.idBuf, this.isWater, n)) {
      if (slot.shoreLayer < 0) {
        if (this.freeShore.length === 0 && !this.growShore()) this.evict(false);
        slot.shoreLayer = this.freeShore.pop() ?? -1;
      }
      // no layer to be had now: the chunk stays pending and is tried again (C4-r1 7)
      if (slot.shoreLayer < 0) return;
      buildShore(this.idBuf, this.isWater, this.trees, n, this.scratch, this.shoreBuf);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.shore);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        0,
        0,
        slot.shoreLayer,
        SHORE_SIZE,
        SHORE_SIZE,
        1,
        gl.RG,
        gl.UNSIGNED_BYTE,
        this.shoreBuf,
      );
      this.shoresBuilt++;
    } else if (slot.shoreLayer >= 0) {
      this.freeShore.push(slot.shoreLayer);
      slot.shoreLayer = -1;
    }
    slot.shoreSig = slot.sig;
  }

  /**
   * Prepares the held chunks: tile ids at once (cheap), shore textures within `budgetMs` (at least one per frame),
   * the visible chunks first and then the held margin around them, so a chunk is usually ready before it scrolls in.
   */
  private prepare(
    mirror: Mirror,
    cx0: number,
    cy0: number,
    cx1: number,
    cy1: number,
    budgetMs: number,
    now: () => number,
  ): void {
    this.mirrorNow = mirror;
    this.shoresBuilt = 0;
    this.pending = 0;
    this.pr.cx0 = cx0;
    this.pr.cy0 = cy0;
    this.pr.cx1 = cx1;
    this.pr.cy1 = cy1;
    this.pr.budget = budgetMs;
    this.pr.now = now;
    // the clock is read only when a shore texture is to be built (a steady frame reads none, C4-r1 10)
    this.pr.t0 = -1;
    // every visible chunk's slot is marked first, so eviction never takes one it has not reached yet
    mirror.chunks.forEach(this.markVisible);
    for (let pass = 0; pass < 2; pass++) {
      this.pr.pass = pass;
      mirror.chunks.forEach(this.prepareOne);
    }
  }
  private readonly markVisible = (c: ChunkView): void => {
    const pr = this.pr;
    if (c.cx < pr.cx0 || c.cx > pr.cx1 || c.cy < pr.cy0 || c.cy > pr.cy1) return;
    const slot = this.slots.get(c.id);
    if (slot !== undefined) slot.seen = this.frameNo;
  };
  private readonly pr = { cx0: 0, cy0: 0, cx1: 0, cy1: 0, budget: 0, t0: 0, pass: 0, now: (): number => 0 };
  private readonly prepareOne = (c: ChunkView): void => {
    const mirror = this.mirrorNow;
    const pr = this.pr;
    if (mirror === null || !c.tiles) return;
    const visible = c.cx >= pr.cx0 && c.cx <= pr.cx1 && c.cy >= pr.cy0 && c.cy <= pr.cy1;
    if (visible !== (pr.pass === 0)) return;
    const slot = this.slotOf(mirror, c);
    if (slot === null) {
      this.pending++;
      return;
    }
    slot.frame = this.frameNo;
    if (visible) slot.seen = this.frameNo;
    if (slot.shoreSig === slot.sig) return;
    if (pr.t0 < 0) pr.t0 = pr.now();
    if (this.shoresBuilt === 0 || pr.now() - pr.t0 < pr.budget) this.buildShoreOf(mirror, c, slot);
    if (slot.shoreSig !== slot.sig) this.pending++;
  };

  /**
   * Draws the visible chunks after preparing the held ones (shore textures within `shoreBudgetMs`): one quad each.
   * `rect` is the visible rectangle in tiles.
   */
  draw(
    mirror: Mirror,
    cam: Camera,
    rect: Float64Array,
    ox: number,
    oy: number,
    tw: number,
    th: number,
    materials: WebGLTexture | null,
    shoreBudgetMs: number,
    now: () => number,
  ): void {
    const gl = this.gl;
    this.frameNo++;
    this.collect(mirror);
    const cx0 = Math.floor((rect[0] as number) / CHUNK_TILES);
    const cy0 = Math.floor((rect[1] as number) / CHUNK_TILES);
    const cx1 = Math.floor(((rect[2] as number) - 1e-9) / CHUNK_TILES);
    const cy1 = Math.floor(((rect[3] as number) - 1e-9) / CHUNK_TILES);
    const S = scaleOf(cam);
    this.prepare(mirror, cx0, cy0, cx1, cy1, shoreBudgetMs, now);
    let quads = 0;
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = mirror.chunks.get(chunkId(cx, cy));
        if (!c?.tiles) continue;
        const slot = this.slots.get(c.id);
        if (slot === undefined) continue;
        // the quad: device px from the canvas centre (f64 → f32), chunk-local tile coordinates 0…32
        const x0 = (cx * CHUNK_TILES - cam.cx) * S;
        const y0 = (cy * CHUNK_TILES - cam.cy) * S;
        const x1 = x0 + CHUNK_TILES * S;
        const y1 = y0 + CHUNK_TILES * S;
        // a stale shore texture (a neighbour just changed) is kept until its rebuild, so the lining never flickers
        // a stale shore texture (a neighbour changed, or no layer yet) is kept until its rebuild: no flicker
        const shoreLayer = slot.shoreLayer;
        const o = this.reserve(quads) * 8;
        const f = this.vf32;
        const n = this.vi32;
        for (let v = 0; v < 4; v++) {
          const at = o + v * 8;
          f[at] = (v & 1) === 0 ? x0 : x1;
          f[at + 1] = v < 2 ? y0 : y1;
          f[at + 2] = (v & 1) === 0 ? 0 : CHUNK_TILES;
          f[at + 3] = v < 2 ? 0 : CHUNK_TILES;
          n[at + 4] = cx;
          n[at + 5] = cy;
          n[at + 6] = slot.idLayer;
          n[at + 7] = shoreLayer;
        }
        quads++;
      }
    this.drawn = quads;
    if (quads === 0) return;
    const p = this.prog;
    gl.useProgram(p.program);
    // computed values go through typed arrays: a double passed to a WebGL call is boxed
    const u = this.uni;
    u[0] = ox;
    u[1] = oy;
    u[2] = tw;
    u[3] = th;
    u[4] = S;
    u[5] = Math.min(1, Math.max(0, (S - (TERRAIN.liningMinScale - 2)) / 4));
    gl.uniform2fv(p.u.uOrigin as WebGLUniformLocation, u, 0, 2);
    gl.uniform2fv(p.u.uTarget as WebGLUniformLocation, u, 2, 2);
    gl.uniform1fv(p.u.uS as WebGLUniformLocation, u, 4, 1);
    gl.uniform1fv(p.u.uLiningFade as WebGLUniformLocation, u, 5, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.ids);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.shore);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, materials);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.tiles);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.vf32, gl.STREAM_DRAW, 0, quads * 4 * (VERTEX_BYTES / 4));
    this.vboBytes = quads * 4 * VERTEX_BYTES;
    gl.drawElements(gl.TRIANGLES, quads * 6, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  /** Binds the batcher's index buffer into the terrain VAO (one shared index buffer, 10 §6.3). */
  useIndex(index: WebGLBuffer): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bindVertexArray(null);
  }

  /** Makes room for quad `q`'s four vertices; returns its first vertex index. */
  private reserve(q: number): number {
    if ((q + 1) * 4 * VERTEX_BYTES > this.vertices.byteLength) {
      const next = new ArrayBuffer(this.vertices.byteLength * 2);
      new Uint8Array(next).set(new Uint8Array(this.vertices));
      this.vertices = next;
      this.vf32 = new Float32Array(next);
      this.vi32 = new Int32Array(next);
    }
    return q * 4;
  }

  /** An R8UI (ids) or RG8 (shores) array of `layers` layers of size² texels. */
  private array(format: number, size: number, layers: number, linear: boolean): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (tex === null) throw new Error('terrain: GL allocation failed');
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, format, size, size, layers);
    const f = linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    return tex;
  }

  /** The array grown to `layers` layers, the old layers copied over on the GPU; the old array is deleted. */
  private regrow(
    old: WebGLTexture,
    oldLayers: number,
    layers: number,
    format: number,
    size: number,
    linear: boolean,
  ): WebGLTexture {
    const gl = this.gl;
    const tex = this.array(format, size, layers, linear);
    this.copyFbo ??= gl.createFramebuffer();
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.copyFbo);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    for (let l = 0; l < oldLayers; l++) {
      gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, old, 0, l);
      gl.copyTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, l, 0, 0, size, size);
    }
    gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, null, 0, 0);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    gl.deleteTexture(old);
    return tex;
  }

  /** Doubles the tile-id layers (up to the GPU's limit); false when it cannot. */
  private growIds(): boolean {
    const next = Math.min(this.maxLayers, this.idCapacity * 2);
    if (next <= this.idCapacity) return false;
    this.ids = this.regrow(this.ids, this.idCapacity, next, this.gl.R8UI, ID_SIZE, false);
    for (let i = next - 1; i >= this.idCapacity; i--) this.freeIds.push(i);
    this.idCapacity = next;
    return true;
  }

  /** Doubles the shore layers (up to the GPU's limit); false when it cannot. */
  private growShore(): boolean {
    const next = Math.min(this.maxLayers, this.shoreCapacity * 2);
    if (next <= this.shoreCapacity) return false;
    this.shore = this.regrow(this.shore, this.shoreCapacity, next, this.gl.RG8, SHORE_SIZE, true);
    for (let i = next - 1; i >= this.shoreCapacity; i--) this.freeShore.push(i);
    this.shoreCapacity = next;
    return true;
  }

  /**
   * Frees a layer (a tile-id layer, else a shore layer) by evicting the chunk out of view seen least recently;
   * false when every holder is in view.
   */
  private evict(ids: boolean): boolean {
    this.victim = null;
    this.victimSeen = Number.POSITIVE_INFINITY;
    this.victimIds = ids;
    this.slots.forEach(this.pickVictim);
    const v = this.victim as Slot | null;
    if (v === null) return false;
    if (ids) {
      this.freeIds.push(v.idLayer);
      if (v.shoreLayer >= 0) this.freeShore.push(v.shoreLayer);
      this.slots.delete(this.victimKey);
    } else {
      this.freeShore.push(v.shoreLayer);
      v.shoreLayer = -1;
      v.shoreSig = -1;
    }
    return true;
  }
  private victim: Slot | null = null;
  private victimKey = 0;
  private victimSeen = 0;
  private victimIds = true;
  private readonly pickVictim = (slot: Slot, key: number): void => {
    if (slot.seen === this.frameNo) return;
    if (!this.victimIds && slot.shoreLayer < 0) return;
    if (slot.seen < this.victimSeen) {
      this.victim = slot;
      this.victimKey = key;
      this.victimSeen = slot.seen;
    }
  };

  /** GPU bytes: the tile-id and shore caches, the tile table and the vertex buffer (C4-r1 8). */
  bytes(): number {
    return (
      ID_SIZE * ID_SIZE * this.idCapacity +
      SHORE_SIZE * SHORE_SIZE * 2 * this.shoreCapacity +
      256 * 16 +
      this.vboBytes
    );
  }

  /** Tree positions (tiles from the chunk's origin) within reach of chunk (cx, cy)'s shore texture. */
  private collectTrees(mirror: Mirror, cx: number, cy: number): number {
    let n = 0;
    const reach = SHORE_BORDER;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const c = mirror.chunks.get(chunkId(cx + dx, cy + dy));
        if (!c || c.objectCount === 0) continue;
        const v = c.objectView;
        for (let i = 0; i < c.objectCount; i++) {
          if (v.getUint8(i * 16 + OV.kind) !== 0) continue;
          if (this.treeDrawable[v.getUint16(i * 16 + OV.id, true)] !== 1) continue;
          const x = v.getInt32(i * 16 + OV.x, true) / 256 - cx * CHUNK_TILES;
          const y = v.getInt32(i * 16 + OV.y, true) / 256 - cy * CHUNK_TILES;
          if (x < -reach - 2 || y < -reach - 2 || x > CHUNK_TILES + reach + 2 || y > CHUNK_TILES + reach + 2)
            continue;
          if ((n + 1) * 2 > this.trees.length) {
            const t = new Float64Array(this.trees.length * 2);
            t.set(this.trees);
            this.trees = t;
          }
          this.trees[n * 2] = x;
          this.trees[n * 2 + 1] = y;
          n++;
        }
      }
    return n;
  }

  get resident(): number {
    return this.slots.size;
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.ids);
    gl.deleteTexture(this.shore);
    if (this.copyFbo) gl.deleteFramebuffer(this.copyFbo);
    gl.deleteTexture(this.tiles);
    gl.deleteBuffer(this.vbo);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.prog.program);
  }
}

/** The woodland wash as a multiplier of the paper (A3 §3.1: a 30 % wash of #c9dca8). */
const WOODLAND_RATIO = Float32Array.from(
  [0, 1, 2],
  (i) => (TERRAIN.woodland[i] as number) / (PAPER_TONE[i] as number),
);

function ratio(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [
    (a[0] as number) / (b[0] as number),
    (a[1] as number) / (b[1] as number),
    (a[2] as number) / (b[2] as number),
  ];
}

/** A map colour pulled toward the paper (an unknown tile type's wash). */
function mixPaper(c: [number, number, number]): [number, number, number] {
  return [
    c[0] * 0.25 + (PAPER_TONE[0] as number) * 0.75,
    c[1] * 0.25 + (PAPER_TONE[1] as number) * 0.75,
    c[2] * 0.25 + (PAPER_TONE[2] as number) * 0.75,
  ];
}

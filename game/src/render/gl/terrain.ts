// The terrain pass (10 §6.5, §9.9): one quad per visible chunk through the terrain shader, which reads the chunk's
// tile ids (a layer of an R8UI array), its shore texture when it has water or trees (a layer of an RG8 array), the
// material textures (an array with one 512² layer per tile type) and a 256-entry tile table (material layer, flags,
// tint). Chunk layers are given out as chunks enter the held set and taken back when they leave; the shore textures
// are rebuilt within a per-frame budget, so a jump of the view never stalls a frame.

import type { JsonTile } from '../../shared/gen/protos.ts';
import type { ChunkView, Mirror } from '../mirror.ts';
import { OV } from '../mirror.ts';
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
  frame: number;
}

const VERTEX_BYTES = 32;

export class TerrainPass {
  readonly gl: WebGL2RenderingContext;
  readonly prog: Program;
  readonly ids: WebGLTexture;
  readonly shore: WebGLTexture;
  readonly tiles: WebGLTexture;
  readonly vao: WebGLVertexArrayObject;
  readonly vbo: WebGLBuffer;
  readonly idCapacity: number;
  readonly shoreCapacity: number;
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
  private frameNo = 0;
  /** The chunks drawn and the shore textures built in the last frame (the HUD). */
  drawn = 0;
  shoresBuilt = 0;
  /** Whether some material is missing (drawn as a wash). */
  readonly materialLayers: Map<string, number>;

  constructor(
    gl: WebGL2RenderingContext,
    tileProtos: readonly JsonTile[],
    materialLayers: Map<string, number>,
    idCapacity = 192,
    shoreCapacity = 96,
  ) {
    this.gl = gl;
    this.materialLayers = materialLayers;
    this.idCapacity = idCapacity;
    this.shoreCapacity = shoreCapacity;
    this.prog = createProgram(gl, TERRAIN_VS, TERRAIN_FS, 'terrain');
    const ids = gl.createTexture();
    const shore = gl.createTexture();
    const tiles = gl.createTexture();
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    if (!ids || !shore || !tiles || !vao || !vbo) throw new Error('terrain: GL allocation failed');
    this.ids = ids;
    this.shore = shore;
    this.tiles = tiles;
    this.vao = vao;
    this.vbo = vbo;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, ids);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R8UI, ID_SIZE, ID_SIZE, idCapacity);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, shore);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RG8, SHORE_SIZE, SHORE_SIZE, shoreCapacity);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    for (let i = idCapacity - 1; i >= 0; i--) this.freeIds.push(i);
    for (let i = shoreCapacity - 1; i >= 0; i--) this.freeShore.push(i);
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

  /** Releases the layers of chunks the mirror no longer holds. */
  private collect(mirror: Mirror): void {
    for (const [key, slot] of this.slots)
      if (!mirror.chunks.has(key)) {
        this.freeIds.push(slot.idLayer);
        if (slot.shoreLayer >= 0) this.freeShore.push(slot.shoreLayer);
        this.slots.delete(key);
      }
  }

  /** The neighbourhood's signature: the chunk's and its eight neighbours' terrain revisions and presence. */
  private signature(mirror: Mirror, c: ChunkView): number {
    let h = 17;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const n = mirror.chunks.get(chunkKeyOf(c.cx + dx, c.cy + dy));
        const v = n?.tiles ? n.terrainRev + 1 : 0;
        h = (Math.imul(h, 31) + v + (n?.objectCount ?? 0) * 7) | 0;
      }
    return h;
  }

  /**
   * Draws the visible chunks: (re)builds their data as needed (shore textures within `shoreBudgetMs`), then one quad
   * each. `rect` is the visible rectangle in tiles.
   */
  draw(
    mirror: Mirror,
    cam: Camera,
    rect: Float64Array,
    origin: [number, number],
    target: [number, number],
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
    const t0 = now();
    this.shoresBuilt = 0;
    let quads = 0;
    const src = (x: number, y: number) => mirror.chunks.get(chunkKeyOf(x, y))?.tiles ?? null;
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = mirror.chunks.get(chunkKeyOf(cx, cy));
        if (!c?.tiles) continue;
        let slot = this.slots.get(c.key);
        if (!slot) {
          const idLayer = this.freeIds.pop();
          if (idLayer === undefined) continue; // over capacity: the paper shows through (logged by the HUD)
          slot = { idLayer, shoreLayer: -1, sig: 0, shoreSig: 0, frame: 0 };
          this.slots.set(c.key, slot);
        }
        slot.frame = this.frameNo;
        const sig = this.signature(mirror, c);
        if (sig !== slot.sig || slot.sig === 0) {
          buildIds(src, cx, cy, this.idBuf);
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
        if (slot.shoreSig !== sig && (this.shoresBuilt === 0 || now() - t0 < shoreBudgetMs)) {
          buildIds(src, cx, cy, this.idBuf);
          const n = this.collectTrees(mirror, cx, cy);
          if (needsShore(this.idBuf, this.isWater, n)) {
            if (slot.shoreLayer < 0) slot.shoreLayer = this.freeShore.pop() ?? -1;
            if (slot.shoreLayer >= 0) {
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
            }
          } else if (slot.shoreLayer >= 0) {
            this.freeShore.push(slot.shoreLayer);
            slot.shoreLayer = -1;
          }
          slot.shoreSig = sig;
        }
        // the quad: device px from the canvas centre (f64 → f32), chunk-local tile coordinates 0…32
        const x0 = (cx * CHUNK_TILES - cam.cx) * S;
        const y0 = (cy * CHUNK_TILES - cam.cy) * S;
        const x1 = x0 + CHUNK_TILES * S;
        const y1 = y0 + CHUNK_TILES * S;
        // a stale shore texture (a neighbour just changed) is kept until its rebuild, so the lining never flickers
        const shoreLayer = slot.shoreLayer;
        this.vertex(quads * 4, x0, y0, 0, 0, cx, cy, slot.idLayer, shoreLayer);
        this.vertex(quads * 4 + 1, x1, y0, CHUNK_TILES, 0, cx, cy, slot.idLayer, shoreLayer);
        this.vertex(quads * 4 + 2, x0, y1, 0, CHUNK_TILES, cx, cy, slot.idLayer, shoreLayer);
        this.vertex(quads * 4 + 3, x1, y1, CHUNK_TILES, CHUNK_TILES, cx, cy, slot.idLayer, shoreLayer);
        quads++;
      }
    this.drawn = quads;
    if (quads === 0) return;
    const p = this.prog;
    gl.useProgram(p.program);
    gl.uniform2f(p.u.uOrigin as WebGLUniformLocation, origin[0], origin[1]);
    gl.uniform2f(p.u.uTarget as WebGLUniformLocation, target[0], target[1]);
    gl.uniform1f(p.u.uS as WebGLUniformLocation, S);
    gl.uniform1f(p.u.uMatTiles as WebGLUniformLocation, TERRAIN.materialTiles);
    gl.uniform1f(p.u.uWarp as WebGLUniformLocation, TERRAIN.warpTiles);
    gl.uniform1f(p.u.uWarpCell as WebGLUniformLocation, TERRAIN.warpCellTiles);
    gl.uniform3fv(p.u.uKerb as WebGLUniformLocation, TERRAIN.kerb);
    gl.uniform1f(p.u.uKerbAlpha as WebGLUniformLocation, TERRAIN.kerbAlpha);
    gl.uniform3fv(p.u.uLiningInk as WebGLUniformLocation, TERRAIN.liningInk);
    gl.uniform1f(p.u.uLiningAlpha as WebGLUniformLocation, TERRAIN.liningAlpha);
    gl.uniform1fv(p.u.uLining as WebGLUniformLocation, TERRAIN.lining);
    const fade = Math.min(1, Math.max(0, (S - (TERRAIN.liningMinScale - 2)) / 4));
    gl.uniform1f(p.u.uLiningFade as WebGLUniformLocation, fade);
    gl.uniform3fv(p.u.uShore as WebGLUniformLocation, TERRAIN.shore);
    gl.uniform1f(p.u.uShoreAlpha as WebGLUniformLocation, TERRAIN.shoreAlpha);
    gl.uniform1f(p.u.uShorePx as WebGLUniformLocation, TERRAIN.shorePx);
    gl.uniform3fv(p.u.uWoodland as WebGLUniformLocation, ratio(TERRAIN.woodland, PAPER_TONE));
    gl.uniform1f(p.u.uWoodlandAlpha as WebGLUniformLocation, TERRAIN.woodlandAlpha);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.ids);
    gl.uniform1i(p.u.uIds as WebGLUniformLocation, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.shore);
    gl.uniform1i(p.u.uSdf as WebGLUniformLocation, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, materials);
    if (p.u.uMats) gl.uniform1i(p.u.uMats, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.tiles);
    gl.uniform1i(p.u.uTiles as WebGLUniformLocation, 3);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.vf32, gl.STREAM_DRAW, 0, quads * 4 * (VERTEX_BYTES / 4));
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

  private vertex(
    i: number,
    x: number,
    y: number,
    lx: number,
    ly: number,
    cx: number,
    cy: number,
    idLayer: number,
    shoreLayer: number,
  ): void {
    if ((i + 1) * VERTEX_BYTES > this.vertices.byteLength) {
      const next = new ArrayBuffer(this.vertices.byteLength * 2);
      new Uint8Array(next).set(new Uint8Array(this.vertices));
      this.vertices = next;
      this.vf32 = new Float32Array(next);
      this.vi32 = new Int32Array(next);
    }
    const o = i * 8;
    this.vf32[o] = x;
    this.vf32[o + 1] = y;
    this.vf32[o + 2] = lx;
    this.vf32[o + 3] = ly;
    this.vi32[o + 4] = cx;
    this.vi32[o + 5] = cy;
    this.vi32[o + 6] = idLayer;
    this.vi32[o + 7] = shoreLayer;
  }

  /** Tree positions (tiles from the chunk's origin) within reach of chunk (cx, cy)'s shore texture. */
  private collectTrees(mirror: Mirror, cx: number, cy: number): number {
    let n = 0;
    const reach = SHORE_BORDER;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const c = mirror.chunks.get(chunkKeyOf(cx + dx, cy + dy));
        if (!c || c.objectCount === 0) continue;
        const v = c.objectView;
        for (let i = 0; i < c.objectCount; i++) {
          if (v.getUint8(i * 16 + OV.kind) !== 0) continue;
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
    gl.deleteTexture(this.tiles);
    gl.deleteBuffer(this.vbo);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.prog.program);
  }
}

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

export function chunkKeyOf(cx: number, cy: number): number {
  return (((cx + 32768) << 16) | ((cy + 32768) & 0xffff)) >>> 0;
}

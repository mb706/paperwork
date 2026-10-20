// Binary world description: written by gen/generate.ts, read by ts/kernel.ts and rust/src/lib.rs.
// Layout: a sequence of sections. Each section is a 16-byte header (u32 tag, u32 type, u32 count, u32 0)
// followed by `count` little-endian values (type 1 = i32, type 2 = f64), padded to 8 bytes.
// The order of sections is fixed (the SEC numbering); readers check every tag.

export const MAGIC = 0x50415057; // "PAPW"
export const VERSION = 1;

export const SEC = {
  HEADER: 1, //        i32[24]  see H below
  ITEM_STACK: 2, //    i32[nItems]
  RECIPE_I: 3, //      i32[nRecipes*12]  nIn, k0,a0, k1,a1, k2,a2, nOut, p0,b0, p1,b1
  RECIPE_F: 4, //      f64[nRecipes]     time (s at speed 1)
  IPROTO_F: 5, //      f64[nIProtos*3]   rotation (turns/tick), extension (tiles/tick), move energy (J/tick)
  MPROTO_F: 6, //      f64[nMProtos]     work energy (J/tick)
  EPROTO_F: 7, //      f64[nEProtos*2]   buffer capacity (J), drain (J/tick)
  EPROTO_I: 8, //      i32[nEProtos]     demand class: 0 normal, 1 interruptible
  LINE_I: 9, //        i32[nLines*9]     len, speed, next, prev, count, front, back, cap (pow2), off
  LINE_GEOM: 10, //    i32[nLines*4]     endX, endY (1/256 tile), dir (0 +x, 1 +y, 2 -x, 3 -y), lane offset (1/256 tile)
  ITEM_KEY: 11, //     i32[itemHeap]     per line: items front→back at off .. off+count-1
  ITEM_GAP: 12, //     i32[itemHeap]     slack to the item in front (0 = compressed); unused for the front item
  INS_I: 13, //        i32[nIns*13]      proto, state, held, heldN, cap, srcKind, src, srcPos, dstKind, dst, dstPos, elec, entity
  INS_F: 14, //        f64[nIns*6]       theta, ext, pickTheta, pickExt, dropTheta, dropExt
  MACH_I: 15, //       i32[nMach*11]     proto, kind, recipe, crafting, inv, nIn, nOut, crafts, elec, outLine, outPos
  MACH_F: 16, //       f64[nMach*2]      progress, speed
  CHEST_I: 17, //      i32[nChests*3]    inv, nSlots, entity
  SLOT_I: 18, //       i32[nSlots*3]     key, count, limit
  CONS_I: 19, //       i32[nCons*2]      eproto, network
  CONS_F: 20, //       f64[nCons]        buffer (J)
  NET_I: 21, //        i32[nNets*2]      first consumer, end consumer
  NET_F: 22, //        f64[nNets*5]      generation (J/tick), solar peak (J/tick), accumulator energy, capacity, rate (J/tick)
  ENT_I: 23, //        i32[nEnts*5]      kind, sprite, x2, y2 (tile centre x2), ref (pool index)
  CHUNK_I: 24, //      i32[nChunks*6]    dynOff, dynCount, staticOff, staticCount, lineOff, lineCount
  CHUNK_DYN: 25, //    i32[...]          entity ids of inserters and machines, per chunk
  CHUNK_STATIC: 26, // i32[...]          entity ids of belts, chests, poles, decor, per chunk
  CHUNK_LINES: 27, //  i32[...]          line ids touching each chunk
} as const;

export const H = {
  magic: 0, version: 1, nItems: 2, nRecipes: 3, nIProtos: 4, nMProtos: 5, nEProtos: 6, nLines: 7, itemHeap: 8,
  nIns: 9, nMach: 10, nChests: 11, nSlots: 12, nCons: 13, nNets: 14, nEnts: 15, chunksX: 16, chunksY: 17,
  nChunkDyn: 18, nChunkStatic: 19, nChunkLines: 20, nodeCap: 21, seed: 22, reserved: 23,
} as const;
export const HEADER_LEN = 24;

export class Writer {
  private parts: Uint8Array[] = [];
  private size = 0;
  private put(tag: number, type: number, bytes: Uint8Array, count: number): void {
    const head = new Uint32Array([tag, type, count, 0]);
    this.parts.push(new Uint8Array(head.buffer));
    this.parts.push(bytes);
    const pad = (8 - (bytes.byteLength & 7)) & 7;
    if (pad) this.parts.push(new Uint8Array(pad));
    this.size += 16 + bytes.byteLength + pad;
  }
  i32(tag: number, values: ArrayLike<number>): void {
    const a = Int32Array.from(values);
    this.put(tag, 1, new Uint8Array(a.buffer), a.length);
  }
  f64(tag: number, values: ArrayLike<number>): void {
    const a = Float64Array.from(values);
    this.put(tag, 2, new Uint8Array(a.buffer), a.length);
  }
  finish(): ArrayBuffer {
    const out = new Uint8Array(this.size);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.byteLength;
    }
    return out.buffer;
  }
}

export class Reader {
  private pos = 0;
  private readonly buf: ArrayBuffer;
  private readonly dv: DataView;
  constructor(buf: ArrayBuffer) {
    this.buf = buf;
    this.dv = new DataView(buf);
  }
  private head(tag: number, type: number): number {
    const t = this.dv.getUint32(this.pos, true);
    const ty = this.dv.getUint32(this.pos + 4, true);
    const n = this.dv.getUint32(this.pos + 8, true);
    if (t !== tag || ty !== type) throw new Error(`world format: expected section ${tag}/${type}, got ${t}/${ty}`);
    this.pos += 16;
    return n;
  }
  i32(tag: number): Int32Array {
    const n = this.head(tag, 1);
    const a = new Int32Array(this.buf.slice(this.pos, this.pos + n * 4));
    this.pos += (n * 4 + 7) & ~7;
    return a;
  }
  f64(tag: number): Float64Array {
    const n = this.head(tag, 2);
    const a = new Float64Array(this.buf.slice(this.pos, this.pos + n * 8));
    this.pos += n * 8;
    return a;
  }
}

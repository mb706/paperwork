// Little-endian byte writer and reader (10 §15: every binary format is little-endian). The writer grows
// as needed; the reader never assumes alignment (DataView).

const TEXT = new TextEncoder();
const UTF8 = new TextDecoder('utf-8', { fatal: true });

export class ByteWriter {
  private buf: Uint8Array;
  private view: DataView;
  private pos = 0;

  constructor(capacity = 4096) {
    this.buf = new Uint8Array(capacity);
    this.view = new DataView(this.buf.buffer);
  }

  get length(): number {
    return this.pos;
  }

  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.pos + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number): this {
    this.checkInt(v, 0, 0xff, 'u8');
    this.ensure(1);
    this.view.setUint8(this.pos, v);
    this.pos += 1;
    return this;
  }

  u16(v: number): this {
    this.checkInt(v, 0, 0xffff, 'u16');
    this.ensure(2);
    this.view.setUint16(this.pos, v, true);
    this.pos += 2;
    return this;
  }

  u32(v: number): this {
    this.checkInt(v, 0, 0xffffffff, 'u32');
    this.ensure(4);
    this.view.setUint32(this.pos, v, true);
    this.pos += 4;
    return this;
  }

  u64(v: bigint): this {
    if (v < 0n || v > 0xffffffffffffffffn) throw new RangeError(`u64 out of range: ${v}`);
    this.ensure(8);
    this.view.setBigUint64(this.pos, v, true);
    this.pos += 8;
    return this;
  }

  i8(v: number): this {
    this.checkInt(v, -0x80, 0x7f, 'i8');
    this.ensure(1);
    this.view.setInt8(this.pos, v);
    this.pos += 1;
    return this;
  }

  i16(v: number): this {
    this.checkInt(v, -0x8000, 0x7fff, 'i16');
    this.ensure(2);
    this.view.setInt16(this.pos, v, true);
    this.pos += 2;
    return this;
  }

  i32(v: number): this {
    this.checkInt(v, -0x80000000, 0x7fffffff, 'i32');
    this.ensure(4);
    this.view.setInt32(this.pos, v, true);
    this.pos += 4;
    return this;
  }

  i64(v: bigint): this {
    this.ensure(8);
    this.view.setBigInt64(this.pos, v, true);
    this.pos += 8;
    return this;
  }

  f32(v: number): this {
    this.ensure(4);
    this.view.setFloat32(this.pos, v, true);
    this.pos += 4;
    return this;
  }

  f64(v: number): this {
    this.ensure(8);
    this.view.setFloat64(this.pos, v, true);
    this.pos += 8;
    return this;
  }

  bool(v: boolean): this {
    return this.u8(v ? 1 : 0);
  }

  bytes(b: Uint8Array): this {
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
    return this;
  }

  /** A `u16` byte length, then UTF-8 (the `str` encoding of 10 §8.1 and §15.2's name tables). */
  str16(s: string): this {
    const b = TEXT.encode(s);
    this.u16(b.length);
    return this.bytes(b);
  }

  /** Zero bytes up to the next multiple of `align` (counted from the start of this writer). */
  pad(align: number): this {
    const n = (align - (this.pos % align)) % align;
    this.ensure(n);
    this.buf.fill(0, this.pos, this.pos + n);
    this.pos += n;
    return this;
  }

  /** Overwrites a `u32` at an earlier offset (lengths written after their content). */
  patchU32(at: number, v: number): void {
    this.checkInt(v, 0, 0xffffffff, 'u32');
    if (at + 4 > this.pos) throw new RangeError(`patch beyond the end: ${at}`);
    this.view.setUint32(at, v, true);
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }

  private checkInt(v: number, lo: number, hi: number, what: string): void {
    if (!Number.isInteger(v) || v < lo || v > hi) throw new RangeError(`${what} out of range: ${v}`);
  }
}

export class ByteReader {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  pos = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.bytes.length - this.pos;
  }

  private need(n: number): void {
    if (this.pos + n > this.bytes.length) throw new RangeError(`read past the end at ${this.pos} (+${n})`);
  }

  u8(): number {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f64(): number {
    this.need(8);
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  take(n: number): Uint8Array {
    this.need(n);
    const b = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }

  str16(): string {
    return UTF8.decode(this.take(this.u16()));
  }
}

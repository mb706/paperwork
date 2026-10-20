// The sprite batcher (10 §6.3): expanded quads in growable typed arrays, one static Uint32 index buffer for 2¹⁶
// quads per draw, and per stream two GL buffers that alternate frame by frame (the upload replaces the whole used
// range, which orphans the old storage). Measured on SwiftShader (Appendix A): expanded quads beat instancing 5–30×.
//
// Vertex (20 bytes): pos 2×f32 (device px from the canvas centre, subtracted from the camera in f64 before the
// f32 store), uv 2×u16 normalised, layer u16 + flags u16, tint RGBA8.

export const VERTEX_BYTES = 20;
const QUAD_WORDS = 20;
export const QUADS_PER_DRAW = 65536;

export class Stream {
  buf = new ArrayBuffer(QUAD_WORDS * 4 * 1024);
  f32 = new Float32Array(this.buf);
  u32 = new Uint32Array(this.buf);
  quads = 0;

  reset(): void {
    this.quads = 0;
  }

  private grow(): void {
    const next = new ArrayBuffer(this.buf.byteLength * 2);
    new Uint8Array(next).set(new Uint8Array(this.buf));
    this.buf = next;
    this.f32 = new Float32Array(next);
    this.u32 = new Uint32Array(next);
  }

  /**
   * One quad: corners top-left (x0, y0), top-right (x1, y1), bottom-left (x2, y2), bottom-right (x3, y3); uv corners
   * u0, v0 (top-left) to u1, v1 (bottom-right) as u16; layer; flags; tint as RGBA8 (r in the low byte).
   */
  quad(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    layerFlags: number,
    tint: number,
  ): void {
    if ((this.quads + 1) * QUAD_WORDS > this.u32.length) this.grow();
    const f = this.f32;
    const u = this.u32;
    let o = this.quads * QUAD_WORDS;
    f[o] = x0;
    f[o + 1] = y0;
    u[o + 2] = (u0 | (v0 << 16)) >>> 0;
    u[o + 3] = layerFlags;
    u[o + 4] = tint;
    o += 5;
    f[o] = x1;
    f[o + 1] = y1;
    u[o + 2] = (u1 | (v0 << 16)) >>> 0;
    u[o + 3] = layerFlags;
    u[o + 4] = tint;
    o += 5;
    f[o] = x2;
    f[o + 1] = y2;
    u[o + 2] = (u0 | (v1 << 16)) >>> 0;
    u[o + 3] = layerFlags;
    u[o + 4] = tint;
    o += 5;
    f[o] = x3;
    f[o + 1] = y3;
    u[o + 2] = (u1 | (v1 << 16)) >>> 0;
    u[o + 3] = layerFlags;
    u[o + 4] = tint;
    this.quads++;
  }

  /** An axis-aligned quad whose uv words (u|v<<16 at its four corners) are precomputed at `uv[uo…uo+3]`. */
  rect(
    l: number,
    t: number,
    w: number,
    h: number,
    uv: Uint32Array,
    uo: number,
    lf: number,
    tint: number,
  ): void {
    if ((this.quads + 1) * QUAD_WORDS > this.u32.length) this.grow();
    const f = this.f32;
    const u = this.u32;
    const o = this.quads * QUAD_WORDS;
    const r = l + w;
    const b = t + h;
    f[o] = l;
    f[o + 1] = t;
    u[o + 2] = uv[uo] as number;
    u[o + 3] = lf;
    u[o + 4] = tint;
    f[o + 5] = r;
    f[o + 6] = t;
    u[o + 7] = uv[uo + 1] as number;
    u[o + 8] = lf;
    u[o + 9] = tint;
    f[o + 10] = l;
    f[o + 11] = b;
    u[o + 12] = uv[uo + 2] as number;
    u[o + 13] = lf;
    u[o + 14] = tint;
    f[o + 15] = r;
    f[o + 16] = b;
    u[o + 17] = uv[uo + 3] as number;
    u[o + 18] = lf;
    u[o + 19] = tint;
    this.quads++;
  }
}

/** RGBA8 tint, r in the low byte (as the vertex stores it). */
export function rgba8(r: number, g: number, b: number, a: number): number {
  return (byte(r) | (byte(g) << 8) | (byte(b) << 16) | (byte(a) << 24)) >>> 0;
}
function byte(x: number): number {
  const v = Math.round(x * 255);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
export const WHITE = 0xffffffff;

/** The GL side of the streams: the shared index buffer and two buffers per stream, alternating. */
export class GlBatcher {
  readonly gl: WebGL2RenderingContext;
  readonly vao: WebGLVertexArrayObject;
  readonly index: WebGLBuffer;
  private readonly buffers: WebGLBuffer[][] = [];
  private flip = 0;
  /** Bytes uploaded in the last frame (the HUD). */
  uploaded = 0;
  draws = 0;

  constructor(gl: WebGL2RenderingContext, streams: number) {
    this.gl = gl;
    const vao = gl.createVertexArray();
    const index = gl.createBuffer();
    if (vao === null || index === null) throw new Error('batcher: GL allocation failed');
    this.vao = vao;
    this.index = index;
    gl.bindVertexArray(vao);
    const idx = new Uint32Array(QUADS_PER_DRAW * 6);
    for (let q = 0; q < QUADS_PER_DRAW; q++) {
      const v = q * 4;
      const o = q * 6;
      idx[o] = v;
      idx[o + 1] = v + 1;
      idx[o + 2] = v + 2;
      idx[o + 3] = v + 2;
      idx[o + 4] = v + 1;
      idx[o + 5] = v + 3;
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    for (let l = 0; l < 4; l++) gl.enableVertexAttribArray(l);
    gl.bindVertexArray(null);
    for (let s = 0; s < streams; s++) {
      const a = gl.createBuffer();
      const b = gl.createBuffer();
      if (a === null || b === null) throw new Error('batcher: GL allocation failed');
      this.buffers.push([a, b]);
    }
  }

  beginFrame(): void {
    this.flip ^= 1;
    this.uploaded = 0;
    this.draws = 0;
  }

  /** Uploads stream `s`'s quads into this frame's buffer. */
  upload(s: number, st: Stream): void {
    if (st.quads === 0) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[s]?.[this.flip] as WebGLBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, st.u32, gl.STREAM_DRAW, 0, st.quads * QUAD_WORDS);
    this.uploaded += st.quads * QUAD_WORDS * 4;
  }

  /** Draws stream `s` (already uploaded this frame) with the bound program, in runs of 2¹⁶ quads. */
  draw(s: number, st: Stream): void {
    if (st.quads === 0) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[s]?.[this.flip] as WebGLBuffer);
    for (let first = 0; first < st.quads; first += QUADS_PER_DRAW) {
      const n = Math.min(QUADS_PER_DRAW, st.quads - first);
      const base = first * 4 * VERTEX_BYTES;
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, VERTEX_BYTES, base);
      gl.vertexAttribPointer(1, 2, gl.UNSIGNED_SHORT, true, VERTEX_BYTES, base + 8);
      gl.vertexAttribIPointer(2, 2, gl.UNSIGNED_SHORT, VERTEX_BYTES, base + 12);
      gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, VERTEX_BYTES, base + 16);
      gl.drawElements(gl.TRIANGLES, n * 6, gl.UNSIGNED_INT, 0);
      this.draws++;
    }
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    for (const pair of this.buffers) for (const b of pair) gl.deleteBuffer(b);
    gl.deleteBuffer(this.index);
    gl.deleteVertexArray(this.vao);
  }
}

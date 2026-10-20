// A recording WebGL2 stub for Vitest (Node has no WebGL): enough of WebGL2RenderingContext for the renderer's
// bookkeeping to run (texture storage and uploads, buffers, framebuffers, errors, limits) and nothing it draws.
// Unknown constants are stable distinct numbers and unknown methods do nothing, so the code under test needs no
// edits; tests inject allocation failures and read what was created, uploaded and deleted.

export interface StubTexture {
  id: number;
  target: number;
  levels: number;
  internalFormat: number;
  width: number;
  height: number;
  depth: number;
  deleted: boolean;
  /** Every upload: level, layer (z offset; 0 for 2D) and size. */
  uploads: {
    level: number;
    x: number;
    y: number;
    z: number;
    width: number;
    height: number;
    data: number[] | null;
  }[];
  /** Layers copied in from a framebuffer (copyTexSubImage3D). */
  copies: { z: number }[];
}

export interface StubOptions {
  maxArrayLayers?: number;
  maxTextureSize?: number;
  extensions?: string[];
}

const KNOWN: Record<string, number> = {
  NO_ERROR: 0,
  INVALID_ENUM: 0x0500,
  INVALID_VALUE: 0x0501,
  INVALID_OPERATION: 0x0502,
  OUT_OF_MEMORY: 0x0505,
  FRAMEBUFFER_COMPLETE: 0x8cd5,
  MAX_ARRAY_TEXTURE_LAYERS: 0x88ff,
  MAX_TEXTURE_SIZE: 0x0d33,
  MAX_3D_TEXTURE_SIZE: 0x8073,
  TEXTURE_2D: 0x0de1,
  TEXTURE_3D: 0x806f,
  TEXTURE_2D_ARRAY: 0x8c1a,
  ARRAY_BUFFER: 0x8892,
  ELEMENT_ARRAY_BUFFER: 0x8893,
};

export class GlStub {
  readonly textures: StubTexture[] = [];
  readonly buffers = new Map<object, { bytes: number; deleted: boolean }>();
  /** Calls by name (the ones the stub implements, plus every no-op). */
  readonly calls = new Map<string, number>();
  readonly opts: Required<StubOptions>;
  private errors: number[] = [];
  private bound = new Map<number, StubTexture | null>();
  private boundBuffer = new Map<number, object | null>();
  private nextId = 1;
  private storageCalls = 0;
  /** texStorage calls (1-based) that fail with an error instead of allocating, and the error. */
  failStorage = new Map<number, number>();
  /** Fails a storage call (with OUT_OF_MEMORY) when this says so: (target, levels, width, height, depth). */
  failWhen: ((target: number, levels: number, w: number, h: number, d: number) => boolean) | null = null;
  /** Fails every storage call whose bytes exceed this (a GPU with that much free memory). */
  memoryLimit = Number.POSITIVE_INFINITY;
  allocatedBytes = 0;

  constructor(opts: StubOptions = {}) {
    this.opts = {
      maxArrayLayers: opts.maxArrayLayers ?? 256,
      maxTextureSize: opts.maxTextureSize ?? 4096,
      extensions: opts.extensions ?? ['EXT_color_buffer_float'],
    };
  }

  count(name: string): number {
    return this.calls.get(name) ?? 0;
  }
  private note(name: string): void {
    this.calls.set(name, (this.calls.get(name) ?? 0) + 1);
  }

  /** Live (created, not deleted) textures. */
  live(): StubTexture[] {
    return this.textures.filter((t) => !t.deleted);
  }

  getError(): number {
    return this.errors.shift() ?? 0;
  }
  getParameter(p: number): number {
    if (p === KNOWN.MAX_ARRAY_TEXTURE_LAYERS) return this.opts.maxArrayLayers;
    if (p === KNOWN.MAX_TEXTURE_SIZE || p === KNOWN.MAX_3D_TEXTURE_SIZE) return this.opts.maxTextureSize;
    return 0;
  }
  getExtension(name: string): object | null {
    return this.opts.extensions.includes(name) ? {} : null;
  }
  isContextLost(): boolean {
    return false;
  }

  createTexture(): object {
    this.note('createTexture');
    const t: StubTexture = {
      id: this.nextId++,
      target: 0,
      levels: 0,
      internalFormat: 0,
      width: 0,
      height: 0,
      depth: 0,
      deleted: false,
      uploads: [],
      copies: [],
    };
    this.textures.push(t);
    return t;
  }
  deleteTexture(t: StubTexture | null): void {
    this.note('deleteTexture');
    if (t && !t.deleted) {
      t.deleted = true;
      this.allocatedBytes -= this.bytesOf(t);
    }
  }
  bindTexture(target: number, t: StubTexture | null): void {
    this.bound.set(target, t);
    if (t) t.target = target;
  }
  private bytesOf(t: StubTexture): number {
    // 4 bytes per texel, every level: a conservative stand-in (tests compare counts, not exact bytes)
    let b = 0;
    for (let l = 0; l < t.levels; l++)
      b += Math.max(1, t.width >> l) * Math.max(1, t.height >> l) * Math.max(1, t.depth) * 4;
    return b;
  }
  private storage(target: number, levels: number, fmt: number, w: number, h: number, d: number): void {
    this.storageCalls++;
    const t = this.bound.get(target);
    const fail = this.failStorage.get(this.storageCalls);
    if (!t) {
      this.errors.push(KNOWN.INVALID_OPERATION as number);
      return;
    }
    if (fail !== undefined) {
      this.errors.push(fail);
      return;
    }
    if (this.failWhen?.(target, levels, w, h, d)) {
      this.errors.push(KNOWN.OUT_OF_MEMORY as number);
      return;
    }
    if (target === KNOWN.TEXTURE_2D_ARRAY && d > this.opts.maxArrayLayers) {
      this.errors.push(KNOWN.INVALID_VALUE as number);
      return;
    }
    if (w > this.opts.maxTextureSize || h > this.opts.maxTextureSize) {
      this.errors.push(KNOWN.INVALID_VALUE as number);
      return;
    }
    Object.assign(t, { levels, internalFormat: fmt, width: w, height: h, depth: d });
    const bytes = this.bytesOf(t);
    if (this.allocatedBytes + bytes > this.memoryLimit) {
      Object.assign(t, { levels: 0, width: 0, height: 0, depth: 0 });
      this.errors.push(KNOWN.OUT_OF_MEMORY as number);
      return;
    }
    this.allocatedBytes += bytes;
  }
  texStorage3D(target: number, levels: number, fmt: number, w: number, h: number, d: number): void {
    this.note('texStorage3D');
    this.storage(target, levels, fmt, w, h, d);
  }
  texStorage2D(target: number, levels: number, fmt: number, w: number, h: number): void {
    this.note('texStorage2D');
    this.storage(target, levels, fmt, w, h, 1);
  }
  texImage2D(target: number, level: number, fmt: number, w: number, h: number): void {
    this.note('texImage2D');
    const t = this.bound.get(target);
    if (t)
      Object.assign(t, {
        levels: Math.max(t.levels, level + 1),
        internalFormat: fmt,
        width: w,
        height: h,
        depth: 1,
      });
  }
  private upload(
    target: number,
    level: number,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    data: unknown,
  ): void {
    const t = this.bound.get(target);
    if (!t) {
      this.errors.push(KNOWN.INVALID_OPERATION as number);
      return;
    }
    const d = data instanceof Uint8Array && data.length <= 16 ? Array.from(data) : null;
    t.uploads.push({ level, x, y, z, width: w, height: h, data: d });
  }
  texSubImage3D(
    target: number,
    level: number,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    _d: number,
    _f: number,
    _t: number,
    data: unknown,
  ): void {
    this.note('texSubImage3D');
    this.upload(target, level, x, y, z, w, h, data);
  }
  compressedTexSubImage3D(
    target: number,
    level: number,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    _d: number,
    _f: number,
    data: unknown,
  ): void {
    this.note('compressedTexSubImage3D');
    this.upload(target, level, x, y, z, w, h, data);
  }
  texSubImage2D(
    target: number,
    level: number,
    x: number,
    y: number,
    w: number,
    h: number,
    _f: number,
    _t: number,
    data: unknown,
  ): void {
    this.note('texSubImage2D');
    this.upload(target, level, x, y, 0, w, h, data);
  }
  copyTexSubImage3D(target: number, _level: number, _x: number, _y: number, z: number): void {
    this.note('copyTexSubImage3D');
    this.bound.get(target)?.copies.push({ z });
  }

  createBuffer(): object {
    this.note('createBuffer');
    const b = {};
    this.buffers.set(b, { bytes: 0, deleted: false });
    return b;
  }
  deleteBuffer(b: object | null): void {
    this.note('deleteBuffer');
    const e = b ? this.buffers.get(b) : undefined;
    if (e) e.deleted = true;
  }
  bindBuffer(target: number, b: object | null): void {
    this.boundBuffer.set(target, b);
  }
  bufferData(
    target: number,
    src: number | ArrayBufferView,
    _usage: number,
    offset?: number,
    length?: number,
  ): void {
    this.note('bufferData');
    const b = this.boundBuffer.get(target);
    const e = b ? this.buffers.get(b) : undefined;
    if (!e) return;
    if (typeof src === 'number') e.bytes = src;
    else if (length !== undefined) e.bytes = length * ((src as Uint32Array).BYTES_PER_ELEMENT ?? 1);
    else e.bytes = src.byteLength - (offset ?? 0);
  }

  createShader(): object {
    return {};
  }
  getShaderParameter(): boolean {
    return true;
  }
  createProgram(): object {
    return {};
  }
  getProgramParameter(_p: object, pname: number): number | boolean {
    return pname === STUB_CONST('ACTIVE_UNIFORMS') ? 0 : true;
  }
  getActiveUniform(): null {
    return null;
  }
  getUniformLocation(): object {
    return {};
  }
  createFramebuffer(): object {
    return {};
  }
  checkFramebufferStatus(): number {
    return KNOWN.FRAMEBUFFER_COMPLETE as number;
  }
  createVertexArray(): object {
    return {};
  }
}

const constants = new Map<string, number>(Object.entries(KNOWN));
let nextConstant = 0x10000;
/** The stub's number for a GL constant name. */
export function STUB_CONST(name: string): number {
  let v = constants.get(name);
  if (v === undefined) {
    v = nextConstant++;
    constants.set(name, v);
  }
  return v;
}

/** A WebGL2RenderingContext over a GlStub: constants are numbers, unknown methods do nothing. */
export function glStub(opts: StubOptions = {}): { gl: WebGL2RenderingContext; s: GlStub } {
  const s = new GlStub(opts);
  const noop = new Map<string, () => undefined>();
  const gl = new Proxy(s, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop in target) {
        const v = (target as unknown as Record<string, unknown>)[prop];
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      }
      if (/^[A-Z][A-Z0-9_]*$/.test(prop)) return STUB_CONST(prop);
      let f = noop.get(prop);
      if (!f) {
        f = () => {
          target.calls.set(prop, (target.calls.get(prop) ?? 0) + 1);
          return undefined;
        };
        noop.set(prop, f);
      }
      return f;
    },
  }) as unknown as WebGL2RenderingContext;
  return { gl, s };
}

/** A canvas stand-in for Renderer.create in Node: its context is the stub's. */
export function stubCanvas(gl: WebGL2RenderingContext, width = 960, height = 540): HTMLCanvasElement {
  const listeners = new Map<string, Set<(e: Event) => void>>();
  return {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    style: {},
    getContext: () => gl,
    addEventListener: (t: string, f: (e: Event) => void) => {
      let set = listeners.get(t);
      if (!set) {
        set = new Set();
        listeners.set(t, set);
      }
      set.add(f);
    },
    removeEventListener: (t: string, f: (e: Event) => void) => listeners.get(t)?.delete(f),
    dispatch: (t: string) => {
      for (const f of listeners.get(t) ?? []) f({ type: t, preventDefault() {} } as unknown as Event);
    },
  } as unknown as HTMLCanvasElement;
}

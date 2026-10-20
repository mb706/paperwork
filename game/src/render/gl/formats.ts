// GPU texture formats (10 §9.2): the probe that picks one per codec, and their sizes for §6.13's accounting.
// Each compressed format counts only if its extension exists *and* uploading one block into a small texture array
// with compressedTexSubImage3D leaves getError() at 0. The asset worker then transcodes to the first that passed.

/** The GPU formats the renderer can sample, by the name the asset worker transcodes to. */
export type GpuFormat = 'bc7' | 'astc' | 'bc3' | 'etc2' | 'rgba8' | 'bc4' | 'eac_r11' | 'r8';

export interface FormatInfo {
  /** The WebGL extension, or null for an uncompressed format. */
  ext: string | null;
  /** The extension's enum name (compressed) or the internal format (uncompressed). */
  enumName: string;
  /** Bytes per 4×4 block (compressed) or per texel (uncompressed). */
  blockBytes: number;
  compressed: boolean;
  /** Bytes per texel on the GPU. */
  bytesPerTexel: number;
  /** One channel (shadow masks). */
  single: boolean;
}

export const FORMATS: Record<GpuFormat, FormatInfo> = {
  bc7: {
    ext: 'EXT_texture_compression_bptc',
    enumName: 'COMPRESSED_RGBA_BPTC_UNORM_EXT',
    blockBytes: 16,
    compressed: true,
    bytesPerTexel: 1,
    single: false,
  },
  astc: {
    ext: 'WEBGL_compressed_texture_astc',
    enumName: 'COMPRESSED_RGBA_ASTC_4x4_KHR',
    blockBytes: 16,
    compressed: true,
    bytesPerTexel: 1,
    single: false,
  },
  bc3: {
    ext: 'WEBGL_compressed_texture_s3tc',
    enumName: 'COMPRESSED_RGBA_S3TC_DXT5_EXT',
    blockBytes: 16,
    compressed: true,
    bytesPerTexel: 1,
    single: false,
  },
  etc2: {
    ext: 'WEBGL_compressed_texture_etc',
    enumName: 'COMPRESSED_RGBA8_ETC2_EAC',
    blockBytes: 16,
    compressed: true,
    bytesPerTexel: 1,
    single: false,
  },
  rgba8: { ext: null, enumName: 'RGBA8', blockBytes: 4, compressed: false, bytesPerTexel: 4, single: false },
  bc4: {
    ext: 'EXT_texture_compression_rgtc',
    enumName: 'COMPRESSED_RED_RGTC1_EXT',
    blockBytes: 8,
    compressed: true,
    bytesPerTexel: 0.5,
    single: true,
  },
  eac_r11: {
    ext: 'WEBGL_compressed_texture_etc',
    enumName: 'COMPRESSED_R11_EAC',
    blockBytes: 8,
    compressed: true,
    bytesPerTexel: 0.5,
    single: true,
  },
  r8: { ext: null, enumName: 'R8', blockBytes: 1, compressed: false, bytesPerTexel: 1, single: true },
};

/** 10 §9.2's fallback order for colour, light and icons (XUBC7), and for shadows (ETC1S). */
export const COLOUR_ORDER: readonly GpuFormat[] = ['bc7', 'astc', 'bc3', 'etc2', 'rgba8'];
export const SHADOW_ORDER: readonly GpuFormat[] = ['bc4', 'eac_r11', 'r8'];

/** The probe's result: each format's verdict, and the chosen format per codec family. */
export interface FormatProbe {
  results: Record<GpuFormat, 'ok' | 'no extension' | `upload error ${number}`>;
  colour: GpuFormat;
  shadow: GpuFormat;
}

/** The GL internal format enum of a GPU format on this context (after its extension is enabled). */
export function glFormat(gl: WebGL2RenderingContext, f: GpuFormat): number {
  const info = FORMATS[f];
  if (!info.compressed) return f === 'r8' ? gl.R8 : gl.RGBA8;
  const ext = gl.getExtension(info.ext as string) as Record<string, number> | null;
  const v = ext?.[info.enumName];
  if (typeof v !== 'number') throw new Error(`${f}: ${info.ext} is not available`);
  return v;
}

/**
 * Probes every format on its own (10 §9.2): the extension must exist, and uploading one block into a 4×4 texture
 * array must leave getError() at 0. `deny` drops formats (tests force the fallbacks with it).
 */
export function probeFormats(
  gl: WebGL2RenderingContext,
  deny: readonly GpuFormat[] = [],
  transcodable?: { xubc7: readonly string[]; etc1s: readonly string[] },
): FormatProbe {
  const results = {} as FormatProbe['results'];
  for (const name of Object.keys(FORMATS) as GpuFormat[]) {
    const info = FORMATS[name];
    if (deny.includes(name)) {
      results[name] = 'no extension';
      continue;
    }
    if (!info.compressed) {
      results[name] = 'ok';
      continue;
    }
    const ext = gl.getExtension(info.ext as string) as Record<string, number> | null;
    const internal = ext?.[info.enumName];
    if (typeof internal !== 'number') {
      results[name] = 'no extension';
      continue;
    }
    while (gl.getError() !== gl.NO_ERROR) {
      /* drain */
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, internal, 4, 4, 1);
    gl.compressedTexSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      0,
      0,
      0,
      4,
      4,
      1,
      internal,
      new Uint8Array(info.blockBytes),
    );
    const err = gl.getError();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    gl.deleteTexture(tex);
    results[name] = err === gl.NO_ERROR ? 'ok' : `upload error ${err}`;
  }
  // the first format the GPU took that the transcoder can also make (rgba8 and r8 need no transcoder)
  const can = (f: GpuFormat, from: readonly string[] | undefined) =>
    f === 'rgba8' || f === 'r8' || from === undefined || from.includes(f);
  const colour = COLOUR_ORDER.find((f) => results[f] === 'ok' && can(f, transcodable?.xubc7)) ?? 'rgba8';
  const shadow = SHADOW_ORDER.find((f) => results[f] === 'ok' && can(f, transcodable?.etc1s)) ?? 'r8';
  return { results, colour, shadow };
}

/** Bytes of one level of a `size`² layer in format f (compressed formats round up to 4×4 blocks). */
export function levelBytes(f: GpuFormat, size: number): number {
  const info = FORMATS[f];
  if (!info.compressed) return size * size * info.blockBytes;
  const b = Math.max(1, Math.ceil(size / 4));
  return b * b * info.blockBytes;
}

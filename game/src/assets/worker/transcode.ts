// KTX2 → GPU format (10 §9.2): XUBC7 (colour, light, icons, terrain) to BC7, ASTC 4×4, BC3, ETC2 RGBA or RGBA8;
// ETC1S (shadow masks) to BC4, EAC R11 or R8; uncompressed `rgba8` files taken as they are. The Basis module is
// passed in, so the same code runs in the asset worker and in Node's tests.

import { type Ktx2Header, readKtx2Header, rgba8Levels } from './ktx2.ts';
import type { FileCodec, TargetFormat } from './protocol.ts';

/** The parts of Basis Universal 2.50's `basis_transcoder` the worker uses (embind). */
export interface BasisModule {
  initializeBasis(): void;
  isFormatSupported(format: number, basisTexFormat: number): boolean;
  basis_tex_format: Record<string, { value: number }>;
  KTX2File: new (data: Uint8Array) => BasisKtx2File;
  transcoder_texture_format: Record<string, { value: number }>;
}
export interface BasisKtx2File {
  isValid(): boolean;
  getWidth(): number;
  getHeight(): number;
  getLevels(): number;
  isXUBC7(): boolean;
  isETC1S(): boolean;
  startTranscoding(): boolean;
  getImageTranscodedSizeInBytes(level: number, layer: number, face: number, format: number): number;
  transcodeImage(
    dst: Uint8Array,
    level: number,
    layer: number,
    face: number,
    format: number,
    getAlphaForOpaqueFormats: number,
    channel0: number,
    channel1: number,
  ): number;
  close(): void;
  delete(): void;
}

/** Basis's names for the target formats (resolved by name, so a renumbered enum cannot break the worker). */
const BASIS_FORMAT: Record<TargetFormat, string> = {
  bc7: 'cTFBC7_RGBA',
  astc: 'cTFASTC_4x4_RGBA',
  bc3: 'cTFBC3_RGBA',
  etc2: 'cTFETC2_RGBA',
  rgba8: 'cTFRGBA32',
  bc4: 'cTFBC4_R',
  eac_r11: 'cTFETC2_EAC_R11',
  r8: 'cTFRGBA32',
};

const TARGETS: TargetFormat[] = ['bc7', 'astc', 'bc3', 'etc2', 'rgba8', 'bc4', 'eac_r11', 'r8'];

/**
 * The targets the transcoder can make from XUBC7 and ETC1S. The stock 2.50 build cannot make EAC R11 from ETC1S
 * (measured: isFormatSupported is false and transcodeImage fails), so shadows fall back from BC4 straight to R8.
 */
export function transcodable(B: BasisModule): Record<'xubc7' | 'etc1s', TargetFormat[]> {
  const T = B.basis_tex_format;
  const F = B.transcoder_texture_format;
  const of = (src: string) =>
    TARGETS.filter((t) => {
      const f = F[BASIS_FORMAT[t]]?.value;
      const s = T[src]?.value;
      return f !== undefined && s !== undefined && B.isFormatSupported(f, s);
    });
  return { xubc7: of('cXUBC7'), etc1s: of('cETC1S') };
}

export interface Level {
  width: number;
  height: number;
  data: Uint8Array;
}

export class TranscodeError extends Error {
  override name = 'TranscodeError';
}

/** The levels of one KTX2 file from `fromLevel` on, in `target`. `basis` may be null for rgba8 files. */
export function transcodeFile(
  basis: BasisModule | null,
  bytes: Uint8Array,
  codec: FileCodec,
  target: TargetFormat,
  fromLevel: number,
): Level[] {
  if (codec === 'rgba8') {
    const lv = rgba8Levels(bytes, fromLevel);
    return lv.map((l) => {
      if (target === 'r8' && l.channels === 4)
        return { width: l.width, height: l.height, data: redOf(l.data) };
      if (target === 'rgba8' && l.channels === 1)
        return { width: l.width, height: l.height, data: greyToRgba(l.data) };
      return { width: l.width, height: l.height, data: l.data };
    });
  }
  if (basis === null) throw new TranscodeError('no transcoder for a supercompressed KTX2');
  const header: Ktx2Header = readKtx2Header(bytes);
  const fmt = basis.transcoder_texture_format[BASIS_FORMAT[target]]?.value;
  if (fmt === undefined) throw new TranscodeError(`the transcoder has no ${BASIS_FORMAT[target]}`);
  const k = new basis.KTX2File(bytes);
  try {
    if (!k.isValid()) throw new TranscodeError('the transcoder refuses the file');
    if (codec === 'xubc7' && !k.isXUBC7()) throw new TranscodeError('expected XUBC7');
    if (codec === 'etc1s' && !k.isETC1S()) throw new TranscodeError('expected ETC1S');
    if (!k.startTranscoding()) throw new TranscodeError('startTranscoding failed');
    const out: Level[] = [];
    for (let l = fromLevel; l < k.getLevels(); l++) {
      const w = Math.max(1, header.width >> l);
      const h = Math.max(1, header.height >> l);
      const n = k.getImageTranscodedSizeInBytes(l, 0, 0, fmt);
      const dst = new Uint8Array(n);
      if (!k.transcodeImage(dst, l, 0, 0, fmt, 0, -1, -1)) throw new TranscodeError(`level ${l} failed`);
      out.push({ width: w, height: h, data: target === 'r8' ? redOf(dst) : dst });
    }
    return out;
  } finally {
    k.close();
    k.delete();
  }
}

function redOf(rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4] as number;
  return out;
}

function greyToRgba(r: Uint8Array): Uint8Array {
  const out = new Uint8Array(r.length * 4);
  for (let i = 0; i < r.length; i++) {
    const v = r[i] as number;
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return out;
}

// KTX2 (Khronos KTX 2.0) as the asset build writes it (scripts/assets/ktx2.py): the header, the level index and the
// first DFD block, read without allocating more than the result. Uncompressed `rgba8` pages (the golden set's tiny
// atlas) are taken level by level from the file; XUBC7 and ETC1S go to the Basis transcoder (transcode.ts).
// The upload contract the build states in every DFD (C6-r1 finding 1): transfer KHR_DF_TRANSFER_LINEAR (sample as
// UNORM, never through an sRGB format) and premultiplied alpha except for shadow masks.

export const KTX2_IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
export const VK_R8G8B8A8_UNORM = 37;
export const VK_R8_UNORM = 9;
export const KHR_DF_TRANSFER_LINEAR = 1;
export const KHR_DF_FLAG_ALPHA_PREMULTIPLIED = 1;

export interface Ktx2Header {
  vkFormat: number;
  typeSize: number;
  width: number;
  height: number;
  layers: number;
  faces: number;
  levels: number;
  supercompression: number;
  /** Per level: byte offset, byte length (as stored), uncompressed length. */
  levelIndex: { offset: number; length: number; uncompressed: number }[];
  model: number;
  transfer: number;
  flags: number;
}

export class Ktx2Error extends Error {
  override name = 'Ktx2Error';
}

export function readKtx2Header(b: Uint8Array): Ktx2Header {
  if (b.length < 80) throw new Ktx2Error('truncated KTX2 header');
  for (let i = 0; i < 12; i++) if (b[i] !== KTX2_IDENTIFIER[i]) throw new Ktx2Error('not a KTX2 file');
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u32 = (o: number) => v.getUint32(o, true);
  const levels = Math.max(1, u32(40));
  const levelIndex: Ktx2Header['levelIndex'] = [];
  for (let l = 0; l < levels; l++) {
    const o = 80 + l * 24;
    if (o + 24 > b.length) throw new Ktx2Error('truncated level index');
    const offset = Number(v.getBigUint64(o, true));
    const length = Number(v.getBigUint64(o + 8, true));
    const uncompressed = Number(v.getBigUint64(o + 16, true));
    if (offset + length > b.length) throw new Ktx2Error(`level ${l} lies outside the file`);
    levelIndex.push({ offset, length, uncompressed });
  }
  const dfdOff = u32(48);
  const dfdLen = u32(52);
  let model = 0;
  let transfer = 0;
  let flags = 0;
  if (dfdLen >= 28 && dfdOff + 16 <= b.length) {
    const w2 = u32(dfdOff + 12);
    model = w2 & 0xff;
    transfer = (w2 >>> 16) & 0xff;
    flags = w2 >>> 24;
  }
  return {
    vkFormat: u32(12),
    typeSize: u32(16),
    width: u32(20),
    height: u32(24),
    layers: u32(32),
    faces: u32(36),
    levels,
    supercompression: u32(44),
    levelIndex,
    model,
    transfer,
    flags,
  };
}

/** The levels of an uncompressed RGBA8 or R8 KTX2 (no supercompression), from `fromLevel` on, as copies. */
export function rgba8Levels(
  b: Uint8Array,
  fromLevel: number,
): { width: number; height: number; data: Uint8Array; channels: number }[] {
  const h = readKtx2Header(b);
  if (h.supercompression !== 0 || (h.vkFormat !== VK_R8G8B8A8_UNORM && h.vkFormat !== VK_R8_UNORM))
    throw new Ktx2Error(
      `not an uncompressed RGBA8/R8 KTX2 (vkFormat ${h.vkFormat}, scheme ${h.supercompression})`,
    );
  const channels = h.vkFormat === VK_R8G8B8A8_UNORM ? 4 : 1;
  const out = [];
  for (let l = fromLevel; l < h.levels; l++) {
    const w = Math.max(1, h.width >> l);
    const ht = Math.max(1, h.height >> l);
    const li = h.levelIndex[l] as Ktx2Header['levelIndex'][number];
    if (li.length !== w * ht * channels)
      throw new Ktx2Error(`level ${l}: ${li.length} bytes for ${w}×${ht}×${channels}`);
    out.push({ width: w, height: ht, data: b.slice(li.offset, li.offset + li.length), channels });
  }
  return out;
}

// Uncompressed KTX2 (Khronos KTX 2.0 specification, https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html)
// for the tiny atlas's `rgba8` pages (10 §15.7: "an uncompressed KTX2 that needs no transcoder"): one 2D
// image, RGBA8, no supercompression, its mip levels stored smallest first, with the Basic Data Format
// Descriptor the specification requires. `readKtx2` is the strict reader the tests use.

export const VK_FORMAT_R8G8B8A8_UNORM = 37;
export const VK_FORMAT_R8G8B8A8_SRGB = 43;
const IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

/** The Basic Data Format Descriptor of RGBA8 (Khronos Data Format 1.3 §5), sRGB or linear. */
function dfd(srgb: boolean): Uint8Array {
  const samples = [
    { channel: 0, offset: 0 },
    { channel: 1, offset: 8 },
    { channel: 2, offset: 16 },
    { channel: 15, offset: 24 },
  ];
  const blockSize = 24 + 16 * samples.length;
  const out = new DataView(new ArrayBuffer(4 + blockSize));
  out.setUint32(0, 4 + blockSize, true); // dfdTotalSize
  out.setUint32(4, 0, true); // vendorId 0 (Khronos), descriptorType 0 (basic)
  out.setUint32(8, 2 | (blockSize << 16), true); // versionNumber 2, descriptorBlockSize
  // colorModel 1 (RGBSDA), colorPrimaries 1 (BT.709), transferFunction 2 (sRGB) or 1 (linear), flags 0
  out.setUint32(12, 1 | (1 << 8) | ((srgb ? 2 : 1) << 16), true);
  out.setUint32(16, 0, true); // texelBlockDimension0–3: 1×1×1×1 (stored minus one)
  out.setUint32(20, 4, true); // bytesPlane0 = 4
  out.setUint32(24, 0, true); // bytesPlane4–7
  samples.forEach((s, i) => {
    const at = 28 + 16 * i;
    // bitOffset, bitLength − 1 = 7, channelType; an sRGB texture's alpha is linear (KHR_DF_SAMPLE_DATATYPE_LINEAR)
    const qualifiers = srgb && s.channel === 15 ? 0x10 : 0;
    out.setUint32(at, s.offset | (7 << 16) | ((s.channel | qualifiers) << 24), true);
    out.setUint32(at + 4, 0, true); // samplePosition0–3
    out.setUint32(at + 8, 0, true); // sampleLower
    out.setUint32(at + 12, 255, true); // sampleUpper
  });
  return new Uint8Array(out.buffer);
}

export interface Level {
  width: number;
  height: number;
  /** width × height × 4 bytes, rows top to bottom. */
  rgba: Uint8Array;
}

/** Writes a KTX2 file holding `levels` (level 0 first in the array), which may start at any mip level. */
export function writeKtx2(levels: readonly Level[], srgb: boolean): Uint8Array {
  const first = levels[0];
  if (!first) throw new Error('no levels');
  const d = dfd(srgb);
  const headerSize = 12 + 9 * 4 + 4 * 4 + 2 * 8; // identifier, header, index (dfd and kvd u32 pairs, sgd u64 pair): 80
  const levelIndexSize = 24 * levels.length;
  const dfdOffset = headerSize + levelIndexSize;
  let at = dfdOffset + d.length;
  // Levels: smallest first in the file, each at a multiple of lcm(texel block size 4, 4) = 4.
  const offsets = new Array<number>(levels.length);
  for (let i = levels.length - 1; i >= 0; i--) {
    at = Math.ceil(at / 4) * 4;
    offsets[i] = at;
    at += (levels[i] as Level).rgba.length;
  }
  const out = new Uint8Array(at);
  const v = new DataView(out.buffer);
  out.set(IDENTIFIER, 0);
  let p = 12;
  const u32 = (x: number) => {
    v.setUint32(p, x, true);
    p += 4;
  };
  const u64 = (x: number) => {
    v.setBigUint64(p, BigInt(x), true);
    p += 8;
  };
  u32(srgb ? VK_FORMAT_R8G8B8A8_SRGB : VK_FORMAT_R8G8B8A8_UNORM);
  u32(1); // typeSize
  u32(first.width);
  u32(first.height);
  u32(0); // pixelDepth: 2D
  u32(0); // layerCount: not an array texture
  u32(1); // faceCount
  u32(levels.length);
  u32(0); // supercompressionScheme: none
  u32(dfdOffset);
  u32(d.length);
  u32(0); // kvdByteOffset
  u32(0); // kvdByteLength
  u64(0); // sgdByteOffset
  u64(0); // sgdByteLength
  levels.forEach((l, i) => {
    u64(offsets[i] as number);
    u64(l.rgba.length);
    u64(l.rgba.length); // uncompressedByteLength
  });
  out.set(d, dfdOffset);
  levels.forEach((l, i) => {
    out.set(l.rgba, offsets[i] as number);
  });
  return out;
}

/** Reads a KTX2 file as `writeKtx2` writes it, checking every field the specification constrains. */
export function readKtx2(b: Uint8Array): { vkFormat: number; levels: Level[] } {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  IDENTIFIER.forEach((x, i) => {
    if (b[i] !== x) throw new Error('not KTX2');
  });
  const vkFormat = v.getUint32(12, true);
  if (vkFormat !== VK_FORMAT_R8G8B8A8_SRGB && vkFormat !== VK_FORMAT_R8G8B8A8_UNORM)
    throw new Error(`vkFormat ${vkFormat}`);
  if (v.getUint32(16, true) !== 1) throw new Error('typeSize');
  const width = v.getUint32(20, true);
  const height = v.getUint32(24, true);
  if (v.getUint32(28, true) !== 0 || v.getUint32(32, true) !== 0 || v.getUint32(36, true) !== 1)
    throw new Error('not a 2D image');
  const levelCount = v.getUint32(40, true);
  if (v.getUint32(44, true) !== 0) throw new Error('supercompressed');
  const dfdOffset = v.getUint32(48, true);
  const dfdLength = v.getUint32(52, true);
  if (v.getUint32(dfdOffset, true) !== dfdLength) throw new Error('dfdTotalSize');
  const levels: Level[] = [];
  let last = Number.POSITIVE_INFINITY;
  for (let i = 0; i < levelCount; i++) {
    const at = 80 + 24 * i;
    const off = Number(v.getBigUint64(at, true));
    const len = Number(v.getBigUint64(at + 8, true));
    const w = Math.max(1, width >> i);
    const h = Math.max(1, height >> i);
    if (len !== w * h * 4 || Number(v.getBigUint64(at + 16, true)) !== len)
      throw new Error(`level ${i} length`);
    if (off % 4 !== 0 || off + len > b.length) throw new Error(`level ${i} offset`);
    if (off >= last) throw new Error('levels must be stored smallest first');
    last = off;
    levels.push({ width: w, height: h, rgba: b.subarray(off, off + len) });
  }
  return { vkFormat, levels };
}

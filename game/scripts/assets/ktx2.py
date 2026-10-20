"""Uncompressed KTX2 (Khronos KTX 2.0) writer and reader: the `rgba8` codec of 10 §15.7, which needs no transcoder.

    write(path, levels, kind='colour')    # levels: uint8 arrays, level 0 first; (h, w, 4) RGBA8 or (h, w) R8
    levels = read_levels(path)            # float32 arrays in [0, 1], (h, w, 4) or (h, w, 1)

Formats: VK_FORMAT_R8G8B8A8_UNORM (37) for colour, light and icon pages, VK_FORMAT_R8_UNORM (9) for shadow pages.
The data format descriptor is the Basic DFD (KHR_DF_MODEL_RGBSDA, BT.709 primaries, a linear transfer function as
UNORM formats require; colour pages set KHR_DF_FLAG_ALPHA_PREMULTIPLIED). The pages hold premultiplied, display-
encoded values, which the renderer samples as UNORM, without an sRGB decode, as the Survey composite assumes
(10 §9.1's verified composition is in that space). No supercompression; levels are stored smallest first, each
aligned to 4 bytes (lcm of the texel size and 4), as the specification requires.
"""

import struct

import numpy as np

IDENTIFIER = bytes([0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A])
VK_R8G8B8A8_UNORM = 37
VK_R8_UNORM = 9
KHR_DF_MODEL_RGBSDA = 1
KHR_DF_PRIMARIES_BT709 = 1
KHR_DF_TRANSFER_LINEAR = 1
KHR_DF_FLAG_ALPHA_PREMULTIPLIED = 1
CHANNELS = (0, 1, 2, 15)          # R, G, B, alpha (KHR_DF_CHANNEL_RGBSDA_*)


def _dfd(nch, premultiplied):
    block_size = 24 + 16 * nch
    words = [0,                                                     # vendorId 0 | descriptorType 0 (basic)
             2 | (block_size << 16),                                # versionNumber 2 | descriptorBlockSize
             KHR_DF_MODEL_RGBSDA | (KHR_DF_PRIMARIES_BT709 << 8) | (KHR_DF_TRANSFER_LINEAR << 16)
             | ((KHR_DF_FLAG_ALPHA_PREMULTIPLIED if premultiplied else 0) << 24),
             0,                                                     # texel block dimensions 1x1x1x1 (stored - 1)
             nch,                                                   # bytesPlane0
             0]
    for c in range(nch):
        words += [(8 * c) | (7 << 16) | (CHANNELS[c] << 24), 0, 0, 255]
    body = struct.pack(f'<{len(words)}I', *words)
    return struct.pack('<I', 4 + len(body)) + body


def _kvd():
    def entry(k, v):
        kv = k.encode() + b'\0' + v.encode() + b'\0'
        e = struct.pack('<I', len(kv)) + kv
        return e + b'\0' * (-len(e) % 4)
    return entry('KTXwriter', 'paperwork asset build (game/scripts/assets/ktx2.py)')


def write(path, levels, kind='colour'):
    grey = levels[0].ndim == 2 or levels[0].shape[2] == 1
    nch = 1 if grey else 4
    vk = VK_R8_UNORM if grey else VK_R8G8B8A8_UNORM
    h, w = levels[0].shape[:2]
    n = len(levels)
    dfd = _dfd(nch, premultiplied=not grey and kind != 'light')
    kvd = _kvd()
    header_len = 12 + 9 * 4 + 4 * 4 + 2 * 8 + n * 24
    dfd_off = header_len
    kvd_off = dfd_off + len(dfd)
    data_start = kvd_off + len(kvd)
    data_start += -data_start % 4
    # the level data, smallest level first in the file
    offsets = [0] * n
    blob = b''
    pos = data_start
    for lv in reversed(range(n)):
        raw = np.ascontiguousarray(levels[lv], np.uint8).tobytes()
        pad = -pos % 4
        blob += b'\0' * pad
        pos += pad
        offsets[lv] = (pos, len(raw))
        blob += raw
        pos += len(raw)
    out = bytearray()
    out += IDENTIFIER
    out += struct.pack('<9I', vk, 1, w, h, 0, 0, 1, n, 0)
    out += struct.pack('<4I', dfd_off, len(dfd), kvd_off, len(kvd))
    out += struct.pack('<2Q', 0, 0)
    for lv in range(n):
        o, ln = offsets[lv]
        out += struct.pack('<3Q', o, ln, ln)
    out += dfd + kvd
    out += b'\0' * (data_start - len(out))
    out += blob
    with open(path, 'wb') as f:
        f.write(bytes(out))
    return len(out)


def read_levels(path):
    with open(path, 'rb') as f:
        d = f.read()
    if d[:12] != IDENTIFIER:
        raise ValueError(f'{path}: not a KTX2 file')
    vk, ts, w, h, depth, layers, faces, n, sc = struct.unpack_from('<9I', d, 12)
    if sc != 0 or vk not in (VK_R8G8B8A8_UNORM, VK_R8_UNORM):
        raise ValueError(f'{path}: not an uncompressed RGBA8 or R8 KTX2 (vkFormat {vk}, scheme {sc})')
    nch = 4 if vk == VK_R8G8B8A8_UNORM else 1
    idx = 12 + 9 * 4 + 4 * 4 + 2 * 8
    out = []
    for lv in range(max(1, n)):
        o, ln, uln = struct.unpack_from('<3Q', d, idx + 24 * lv)
        lw, lh = max(1, w >> lv), max(1, h >> lv)
        a = np.frombuffer(d, np.uint8, count=ln, offset=o).reshape(lh, lw, nch)
        out.append(a.astype(np.float32) / 255.0)
    return out

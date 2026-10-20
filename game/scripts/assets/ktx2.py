"""KTX2 (Khronos KTX 2.0) for the asset build: the uncompressed `rgba8` writer and reader of 10 §15.7 (the fixture's
codec, which needs no transcoder), a header reader for every KTX2 the build makes, and the upload contract that
their data format descriptors (DFDs) must state.

    write(path, levels, kind='colour')    # levels: uint8 arrays, level 0 first; (h, w, 4) RGBA8 or (h, w) R8
    levels = read_levels(path)            # float32 arrays in [0, 1], (h, w, 4) or (h, w, 1)
    h = read_header(path_or_bytes)        # vkFormat, size, levels, supercompression, DFD model/transfer/flags
    data = set_premultiplied(data)        # the DFD's KHR_DF_FLAG_ALPHA_PREMULTIPLIED, set in place of a copy
    errs = contract_errors(h, kind, codec, size, levels)

**The upload contract** (10 §9.1's verified composition, §9.2, §15.7). Every page holds premultiplied, display-
encoded values. The renderer samples them as UNORM, never through an sRGB format (no decode to linear), blends
colour and icons premultiplied and adds light. Shadows are a one-channel mask. So every file's DFD says:
  * transfer function KHR_DF_TRANSFER_LINEAR (1): "upload as UNORM". A loader that honours KHR_DF_TRANSFER_SRGB
    would pick BC7_SRGB / SRGB8_ALPHA8 and darken every colour;
  * KHR_DF_FLAG_ALPHA_PREMULTIPLIED (1) for the RGBA arrays (colour, light, icon; terrain, which is opaque, too),
    so no loader multiplies by alpha again; 0 for shadow masks;
  * BT.709 primaries.
By codec: `rgba8` is VK_FORMAT_R8G8B8A8_UNORM (37) or, for shadows, VK_FORMAT_R8_UNORM (9), with the basic DFD
(KHR_DF_MODEL_RGBSDA) and no supercompression; `xubc7` is VK_FORMAT_UNDEFINED with basisu 2.50's XUBC7 colour model
(170) and supercompression scheme (6); `etc1s` is VK_FORMAT_UNDEFINED, KHR_DF_MODEL_ETC1S (163), BasisLZ (1).
The rgba8 writer stores levels smallest first, each aligned to 4 bytes (lcm of the texel size and 4), as the
specification requires.
"""

import os
import struct

import numpy as np

IDENTIFIER = bytes([0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A])
VK_UNDEFINED = 0
VK_R8G8B8A8_UNORM = 37
VK_R8_UNORM = 9
KHR_DF_MODEL_RGBSDA = 1
KHR_DF_MODEL_ETC1S = 163
KHR_DF_MODEL_XUBC7 = 170          # basisu 2.50's colour model for XUBC7 (measured: basisu -info)
SS_NONE, SS_BASISLZ, SS_XUBC7 = 0, 1, 6        # supercompression schemes (XUBC7: as basisu 2.50 writes it)
KHR_DF_PRIMARIES_BT709 = 1
KHR_DF_TRANSFER_LINEAR = 1
KHR_DF_TRANSFER_SRGB = 2
KHR_DF_FLAG_ALPHA_PREMULTIPLIED = 1
CHANNELS = (0, 1, 2, 15)          # R, G, B, alpha (KHR_DF_CHANNEL_RGBSDA_*)
HEADER_LEN = 12 + 9 * 4 + 4 * 4 + 2 * 8         # up to the level index

# The arrays (and terrain) whose values are premultiplied colour; shadow masks are not.
PREMULTIPLIED = {'colour': True, 'light': True, 'icon': True, 'terrain': True, 'shadow': False}
CODEC_FORMAT = {
    'rgba8': dict(model=KHR_DF_MODEL_RGBSDA, scheme=SS_NONE),
    'xubc7': dict(vk=VK_UNDEFINED, model=KHR_DF_MODEL_XUBC7, scheme=SS_XUBC7),
    'etc1s': dict(vk=VK_UNDEFINED, model=KHR_DF_MODEL_ETC1S, scheme=SS_BASISLZ),
}


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
    dfd = _dfd(nch, premultiplied=PREMULTIPLIED[kind] and not grey)
    kvd = _kvd()
    header_len = HEADER_LEN + n * 24
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
    with open(path + '.tmp', 'wb') as f:
        f.write(bytes(out))
    os.replace(path + '.tmp', path)
    return len(out)


def read_levels(path):
    with open(path, 'rb') as f:
        d = f.read()
    h = read_header(d, path)
    if h['scheme'] != SS_NONE or h['vkFormat'] not in (VK_R8G8B8A8_UNORM, VK_R8_UNORM):
        raise ValueError(f'{path}: not an uncompressed RGBA8 or R8 KTX2 (vkFormat {h["vkFormat"]}, '
                         f'scheme {h["scheme"]})')
    nch = 4 if h['vkFormat'] == VK_R8G8B8A8_UNORM else 1
    out = []
    for lv in range(max(1, h['levels'])):
        o, ln, uln = struct.unpack_from('<3Q', d, HEADER_LEN + 24 * lv)
        lw, lh = max(1, h['width'] >> lv), max(1, h['height'] >> lv)
        a = np.frombuffer(d, np.uint8, count=ln, offset=o).reshape(lh, lw, nch)
        out.append(a.astype(np.float32) / 255.0)
    return out


def read_header(src, name=None):
    """The header fields and the first DFD block's model, primaries, transfer and flags of a KTX2 file (a path or
    its bytes)."""
    if isinstance(src, (bytes, bytearray)):
        d = bytes(src)
    else:
        name = name or src
        with open(src, 'rb') as f:
            d = f.read()
    if d[:12] != IDENTIFIER:
        raise ValueError(f'{name}: not a KTX2 file')
    vk, ts, w, h, depth, layers, faces, n, sc = struct.unpack_from('<9I', d, 12)
    dfd_off, dfd_len, kvd_off, kvd_len = struct.unpack_from('<4I', d, 48)
    if dfd_len < 4 + 24 or dfd_off + dfd_len > len(d):
        raise ValueError(f'{name}: DFD of {dfd_len} bytes at {dfd_off}')
    total, w0, w1, w2 = struct.unpack_from('<4I', d, dfd_off)
    return dict(vkFormat=vk, typeSize=ts, width=w, height=h, depth=depth, layers=layers, faces=faces, levels=n,
                scheme=sc, dfdOffset=dfd_off, vendor=w0 & 0x1FFFF, descriptorType=w0 >> 17,
                model=w2 & 0xFF, primaries=(w2 >> 8) & 0xFF, transfer=(w2 >> 16) & 0xFF, flags=w2 >> 24)


def set_premultiplied(data):
    """The KTX2 bytes with the first (basic) DFD block's KHR_DF_FLAG_ALPHA_PREMULTIPLIED set. basisu 2.50 has no
    option for the flag; it is metadata that the transcoder only reports, so the pixel data is untouched."""
    h = read_header(data)
    if h['vendor'] != 0 or h['descriptorType'] != 0:
        raise ValueError(f'not a basic DFD block (vendor {h["vendor"]}, type {h["descriptorType"]})')
    out = bytearray(data)
    out[h['dfdOffset'] + 4 + 8 + 3] |= KHR_DF_FLAG_ALPHA_PREMULTIPLIED
    return bytes(out)


def contract_errors(h, kind, codec, size, levels):
    """The upload contract (module docstring) for one file of array `kind` (or 'terrain') made with `codec`, whose
    level 0 is `size` px square and which holds `levels` levels."""
    errs = []
    fmt = CODEC_FORMAT[codec]
    if codec == 'rgba8':
        want_vk = VK_R8_UNORM if kind == 'shadow' else VK_R8G8B8A8_UNORM
    else:
        want_vk = fmt['vk']
    want_flags = KHR_DF_FLAG_ALPHA_PREMULTIPLIED if PREMULTIPLIED[kind] else 0
    for field, want in (('vkFormat', want_vk), ('scheme', fmt['scheme']), ('model', fmt['model']),
                        ('primaries', KHR_DF_PRIMARIES_BT709), ('transfer', KHR_DF_TRANSFER_LINEAR),
                        ('flags', want_flags), ('width', size), ('height', size), ('levels', levels),
                        ('depth', 0), ('faces', 1)):
        if h[field] != want:
            errs.append(f'{field} {h[field]}, not {want}')
    if h['layers'] > 1:
        errs.append(f'{h["layers"]} array layers in one file')
    return errs

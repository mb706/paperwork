"""Uncompressed RGBA8 .DDS writer with a mipmap chain: the source basisu encodes when the build supplies its own
levels (10 §9.2 step 6: levels are box-filtered halvings of the premultiplied page, not basisu's filter)."""

import struct

import numpy as np

DDSD_CAPS, DDSD_HEIGHT, DDSD_WIDTH, DDSD_PITCH, DDSD_PIXELFORMAT, DDSD_MIPMAPCOUNT = 0x1, 0x2, 0x4, 0x8, 0x1000, 0x20000
DDPF_ALPHAPIXELS, DDPF_RGB = 0x1, 0x40
DDSCAPS_COMPLEX, DDSCAPS_TEXTURE, DDSCAPS_MIPMAP = 0x8, 0x1000, 0x400000


def write_dds(path, levels):
    """levels: list of uint8 arrays (h, w, 4) RGBA, each half the previous."""
    h, w = levels[0].shape[:2]
    n = len(levels)
    flags = DDSD_CAPS | DDSD_HEIGHT | DDSD_WIDTH | DDSD_PITCH | DDSD_PIXELFORMAT | (DDSD_MIPMAPCOUNT if n > 1 else 0)
    caps = DDSCAPS_TEXTURE | ((DDSCAPS_COMPLEX | DDSCAPS_MIPMAP) if n > 1 else 0)
    pf = struct.pack('<IIIIIIII', 32, DDPF_RGB | DDPF_ALPHAPIXELS, 0, 32, 0x000000ff, 0x0000ff00, 0x00ff0000,
                     0xff000000)
    header = struct.pack('<IIIIIII', 124, flags, h, w, w * 4, 0, n) + b'\0' * 44 + pf + struct.pack(
        '<IIIII', caps, 0, 0, 0, 0)
    with open(path, 'wb') as f:
        f.write(b'DDS ' + header)
        for lv in levels:
            f.write(np.ascontiguousarray(lv, np.uint8).tobytes())

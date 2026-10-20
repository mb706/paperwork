"""Shared helpers of the asset build's Python steps (10 §9.2): paths, PNG I/O, colour science, canonical JSON.

Images are float32 arrays in [0, 1]. Atlas images are premultiplied RGBA from the post step on; everything before
it is straight alpha, as Blender writes it.
"""

import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.abspath(os.path.join(HERE, '..', '..'))
ROOT = os.path.abspath(os.path.join(GAME, '..'))
BLENDER_SRC = os.path.join(GAME, 'assets', 'blender')
SVG_SRC = os.path.join(GAME, 'assets', 'svg')
FONT_SRC = os.path.join(GAME, 'assets', 'fonts')
TEXTURE_SRC = os.path.join(GAME, 'assets', 'textures')
DATA = os.path.join(ROOT, 'design', 'spec', 'data')
CACHE = os.path.join(GAME, '.cache', 'assets')
PUBLIC = os.path.join(GAME, 'public')
sys.path.insert(0, BLENDER_SRC)

PAPER_HEX = '#ece3cb'
INK_HEX = '#2b2723'


def read_png(path):
    im = Image.open(path)
    if im.mode == 'P':
        im = im.convert('RGBA')
    a = np.asarray(im)
    if a.dtype == np.uint16 or im.mode in ('I;16', 'I;16B', 'I'):
        a = a.astype(np.float32) / 65535.0
    else:
        a = a.astype(np.float32) / 255.0
    if a.ndim == 2:
        a = a[..., None]
    return a


def to8(a):
    return np.clip(np.floor(a * 255.0 + 0.5), 0, 255).astype(np.uint8)


def write_png(path, a, optimize=False):
    """Write float [0, 1] as an 8-bit PNG (1, 3 or 4 channels). Deterministic bytes (no time chunks)."""
    a8 = to8(a)
    if a8.ndim == 3 and a8.shape[2] == 1:
        a8 = a8[..., 0]
    tmp = path + '.tmp.png'
    Image.fromarray(a8).save(tmp, optimize=optimize)
    os.replace(tmp, path)


def premul(rgba):
    out = rgba.copy()
    out[..., :3] *= out[..., 3:4]
    return out


def unpremul(rgba):
    out = rgba.copy()
    a = out[..., 3:4]
    out[..., :3] = np.where(a > 1e-6, out[..., :3] / np.maximum(a, 1e-6), 0)
    return out


def box_down(img, f=2):
    """Box filter by an integer factor (pads to a multiple of f with zeros): the levels of a premultiplied page."""
    h, w = img.shape[:2]
    H, W = -(-h // f) * f, -(-w // f) * f
    c = img.shape[2] if img.ndim == 3 else 1
    pad = np.zeros((H, W, c), np.float32)
    pad[:h, :w] = img.reshape(h, w, c)
    return pad.reshape(H // f, f, W // f, f, c).mean(axis=(1, 3))


def hexc(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], np.float32)


def srgb2lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin2srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def lab(rgb):
    lin = srgb2lin(np.clip(rgb, 0, 1))
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]], np.float32)
    xyz = lin @ m.T / np.array([0.95047, 1.0, 1.08883], np.float32)
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def over_paper(pm, paper=PAPER_HEX):
    """Composite a premultiplied RGBA over the survey paper: what the ground shows."""
    return pm[..., :3] + (1 - pm[..., 3:4]) * hexc(paper)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def dump_json(path, obj, indent=1):
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(obj, f, indent=indent, sort_keys=True)
        f.write('\n')
    os.replace(tmp, path)


def load_json(path):
    with open(path) as f:
        return json.load(f)

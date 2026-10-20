"""KTX2 encoding with basisu 2.50 (10 §9.2 step 7) and its cache.

    data = encode(levels, codec, kind, tag)    # the KTX2 bytes; cached in .cache/assets/ktx2/<key>.ktx2

`levels` are uint8 arrays, level 0 first: the build's own box-filtered halvings of the premultiplied page (§9.2
step 6), written as an uncompressed mipmapped DDS that basisu encodes keeping the supplied levels (verified), so
the levels are ours, not basisu's filter. Codecs (ARGS):
  xubc7  -xubc7 -quality 90 -linear    colour, light and icon pages; terrain materials
  etc1s  -etc1s -q 255 -linear         shadow masks (grey)
`-linear` makes basisu write KHR_DF_TRANSFER_LINEAR, the upload contract of ktx2.py ("sample as UNORM"). For XUBC7
it also switches the encoder's error metric from sRGB to linear weights: measured on the M0 pages within 0.1 dB and
0.02 dE of the sRGB setting, in BC7 and in every fallback format. basisu has no option for
KHR_DF_FLAG_ALPHA_PREMULTIPLIED, so it is set after encoding for the premultiplied kinds; every result is checked
against ktx2.contract_errors before it is cached.

The cache key covers the levels, the codec and kind, and the encoder's signature: the SHA-256 of the basisu binary
and its version line, and of this module's, dds.py's and ktx2.py's sources. A new encoder build or a change of the
encoding or metadata code therefore never reuses a stale file (codex C6-r1 finding 6).
"""

import hashlib
import os
import shutil
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as K  # noqa: E402
import dds  # noqa: E402
import ktx2  # noqa: E402

KTX_CACHE = os.path.join(K.CACHE, 'ktx2')
ARGS = {
    'xubc7': ['-xubc7', '-quality', '90', '-linear'],
    'etc1s': ['-etc1s', '-q', '255', '-linear'],
}
_SIG = {}


def encoder_signature():
    """The basisu binary's SHA-256 and version line plus the SHA-256 of the encoding code (cached per process)."""
    if 'sig' not in _SIG:
        exe = shutil.which('basisu')
        if exe is None:
            raise RuntimeError('basisu is not on PATH (10 §9.2: basisu 2.50 in ~/.local/opt, see CLAUDE.md)')
        r = subprocess.run([exe, '-version'], capture_output=True, text=True)
        version = next((ln.strip() for ln in r.stdout.splitlines() if 'Basis Universal' in ln), r.stdout[:200])
        h = hashlib.sha256()
        h.update(K.sha256_file(os.path.realpath(exe)).encode())
        h.update(version.encode())
        for f in ('encode.py', 'dds.py', 'ktx2.py'):
            h.update(f.encode())
            h.update(K.sha256_file(os.path.join(HERE, f)).encode())
        _SIG['sig'] = h.hexdigest()
        _SIG['version'] = version
    return _SIG['sig']


def as_rgba(lv):
    if lv.ndim == 2 or lv.shape[2] == 1:
        g = lv.reshape(lv.shape[0], lv.shape[1])
        return np.stack([g, g, g, np.full_like(g, 255)], -1)
    return lv


def run_basisu(levels, codec, src_dds, out_ktx2):
    """Encode `levels` with the codec's arguments (no cache, no metadata fix): the raw basisu output."""
    dds.write_dds(src_dds, [as_rgba(lv) for lv in levels])
    r = subprocess.run(['basisu', '-ktx2', '-no_stats'] + ARGS[codec] + [src_dds, '-output_file', out_ktx2],
                       capture_output=True, text=True)
    os.remove(src_dds)
    if r.returncode != 0:
        raise RuntimeError(f'basisu failed ({r.returncode}):\n{r.stdout[-2000:]}{r.stderr[-2000:]}')


def finish(data, kind):
    """Apply the upload contract's metadata to basisu's output."""
    return ktx2.set_premultiplied(data) if ktx2.PREMULTIPLIED[kind] else data


def encode(levels, codec, kind, tag):
    """The KTX2 bytes of `levels` (uint8, level 0 first) for an array of `kind`; cached by content and encoder."""
    os.makedirs(KTX_CACHE, exist_ok=True)
    h = hashlib.sha256()
    h.update(encoder_signature().encode())
    h.update(f'{codec}|{kind}|{ktx2.PREMULTIPLIED[kind]}'.encode())
    for lv in levels:
        h.update(str(lv.shape).encode())
        h.update(np.ascontiguousarray(lv).tobytes())
    key = h.hexdigest()
    out = os.path.join(KTX_CACHE, key + '.ktx2')
    if not os.path.exists(out):
        tmp = os.path.join(KTX_CACHE, f'{key}.{os.getpid()}.tmp.ktx2')
        try:
            run_basisu(levels, codec, os.path.join(KTX_CACHE, f'{key}.{os.getpid()}.dds'), tmp)
        except RuntimeError as e:
            raise RuntimeError(f'{tag}: {e}') from None
        with open(tmp, 'rb') as f:
            data = finish(f.read(), kind)
        errs = ktx2.contract_errors(ktx2.read_header(data, tag), kind, codec, levels[0].shape[1], len(levels))
        if errs:
            os.remove(tmp)
            raise RuntimeError(f'{tag}: the encoded KTX2 breaks the upload contract: {"; ".join(errs)}')
        with open(tmp, 'wb') as f:
            f.write(data)
        os.replace(tmp, out)
    with open(out, 'rb') as f:
        return f.read()

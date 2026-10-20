"""B2 texture-format study, step 6 (codex B2-r1 finding 5): the quality of every fallback GPU format.

    taskset -c 0-7 gamedev-python -I design/asset-study/texfmt/fallback_quality.py

Transcodes the chosen KTX2 files (XUBC7 quality 90 for colour; ETC1S for shadows; encode.py made them) to each
GPU format of the fallback chains with `basisu -unpack`, decodes the result as the GPU would, and measures it
against the source page with encode.py's metrics. Writes design/art/out/texfmt/fallback.json.
"""

import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from encode import ENC, PAGES, metrics, read  # noqa: E402

FORMATS = {'bc7': 6, 'astc4x4': 10, 'bc3': 3, 'etc2_rgba': 1, 'rgba32': 13, 'bc4': 4, 'eac_r11': 20}


def unpack(ktx2, code, outdir):
    os.makedirs(outdir, exist_ok=True)
    subprocess.run(['basisu', '-unpack', '-format_only', str(code), '-no_ktx', ktx2, '-output_path', outdir],
                   check=True, capture_output=True)
    lv0 = lambda f: 'level_0_' in f or 'level_' not in f
    c = [f for f in os.listdir(outdir) if '_rgba_' in f and lv0(f)] or [f for f in os.listdir(outdir) if '_rgb_' in f and lv0(f)]
    return read(os.path.join(outdir, sorted(c)[0]))


def main():
    out = {}
    for page, variant, fmts in (('colour-high', 'xubc7-q90', ['bc7', 'astc4x4', 'bc3', 'etc2_rgba']),
                                ('colour-normal', 'xubc7-q90', ['bc7', 'astc4x4', 'bc3', 'etc2_rgba']),
                                ('icons', 'xubc7-q90', ['bc7', 'astc4x4', 'bc3', 'etc2_rgba']),
                                ('shadow-normal', 'etc1s-q255', ['bc4', 'eac_r11'])):
        src = read(os.path.join(PAGES, f'{page}.png'))
        ktx2 = os.path.join(ENC, page, f'{variant}.ktx2')
        for fmt in fmts:
            dec = unpack(ktx2, FORMATS[fmt], os.path.join(ENC, page, f'{variant}.fallback-{fmt}'))
            dec = dec[..., :src.shape[2]] if dec.shape[2] >= src.shape[2] else dec
            m = metrics(src, dec)
            out[f'{page} {fmt}'] = m
            print(page, fmt, json.dumps(m), flush=True)
    json.dump(out, open(os.path.join(ENC, '..', 'fallback.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()

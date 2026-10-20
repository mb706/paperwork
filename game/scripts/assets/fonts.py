"""Font subsets (10 §9.3): WOFF2 subsets of the UI's OFL faces, their licences and a coverage report.

    gamedev-python game/scripts/assets/fonts.py --out .cache/assets/fonts.json

Faces (A3 §12; 10 §9.3's table): Libre Franklin 400, 600, 800 (printed text; window titles in ExtraBold
capitals), Courier Prime 400, 700 (typed values), Titillium Web 400, 600 (world labels, §6.11). Sources and
licences are committed in game/assets/fonts/ (SIL Open Font License 1.1; OFL-*.txt). Subsets keep Basic Latin,
Latin-1, Latin Extended-A, Greek, general punctuation, super- and subscripts, the letterlike ℓ, arrows and the
mathematical signs the text canon uses, with the features kern, liga, lnum, tnum and case where a face has them.
Output: public/fonts/<face>.<hash8>.woff2, the licences and the index public/fonts/fonts.<hash8>.json (faces and
coverage; the manifest's dom.fonts names it), written additively like the atlases: a hashed name is its content, so
the files the published manifest names are never touched (build-assets.ts collects unreferenced ones after a
successful publish). The result (--out) lists every file for the inventory and names the index.

Coverage: every character of the text canon (design/spec/data/text.yaml) and the locale (game/locale/en.yaml, when
it exists) is looked up in each subset; a face that lacks one fails the build (§9.3: no player-facing string may
fall back to a system font).
"""

import argparse
import hashlib
import json
import os
import shutil
import sys

import yaml
from fontTools import subset
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as K  # noqa: E402

FONTS_OUT = os.path.join(K.PUBLIC, 'fonts')
FACES = [
    ('LibreFranklin-Regular', 'Libre Franklin', 400, 'OFL-LibreFranklin.txt', 'Impallari Type'),
    ('LibreFranklin-SemiBold', 'Libre Franklin', 600, 'OFL-LibreFranklin.txt', 'Impallari Type'),
    ('LibreFranklin-ExtraBold', 'Libre Franklin', 800, 'OFL-LibreFranklin.txt', 'Impallari Type'),
    ('CourierPrime-Regular', 'Courier Prime', 400, 'OFL-CourierPrime.txt', 'Quote-Unquote Apps'),
    ('CourierPrime-Bold', 'Courier Prime', 700, 'OFL-CourierPrime.txt', 'Quote-Unquote Apps'),
    ('TitilliumWeb-Regular', 'Titillium Web', 400, 'OFL-TitilliumWeb.txt', 'Accademia di Belle Arti di Urbino'),
    ('TitilliumWeb-SemiBold', 'Titillium Web', 600, 'OFL-TitilliumWeb.txt', 'Accademia di Belle Arti di Urbino'),
]
RANGES = [(0x20, 0x7E), (0xA0, 0xFF), (0x100, 0x17F), (0x370, 0x3FF), (0x2000, 0x206F), (0x2070, 0x209F),
          (0x2190, 0x21FF)]
SINGLES = [0x2113, 0x2212, 0x2264, 0x2265, 0x2248, 0x221A, 0x221E, 0x230A, 0x230B, 0x2026, 0x00D7]
FEATURES = ['kern', 'liga', 'clig', 'calt', 'ccmp', 'locl', 'mark', 'mkmk', 'lnum', 'tnum', 'case']


def unicodes():
    out = set(SINGLES)
    for a, b in RANGES:
        out.update(range(a, b + 1))
    return sorted(out)


def canon_chars():
    chars = set()

    def walk(v):
        if isinstance(v, str):
            chars.update(v)
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)

    for p in (os.path.join(K.DATA, 'text.yaml'), os.path.join(K.GAME, 'locale', 'en.yaml')):
        if os.path.exists(p):
            with open(p) as f:
                walk(yaml.safe_load(f))
    return {c for c in chars if c >= ' ' and c not in '­'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    os.makedirs(FONTS_OUT, exist_ok=True)
    wanted = unicodes()
    canon = canon_chars()
    files, faces, missing = [], [], {}
    for stem, family, weight, licence, foundry in FACES:
        src = os.path.join(K.FONT_SRC, stem + '.ttf')
        opts = subset.Options()
        opts.flavor = 'woff2'
        opts.layout_features = FEATURES
        opts.name_IDs = ['*']
        opts.name_languages = ['*']
        opts.notdef_outline = True
        opts.recalc_timestamp = False
        opts.drop_tables += ['DSIG']
        font = TTFont(src, recalcTimestamp=False)
        sub = subset.Subsetter(options=opts)
        sub.populate(unicodes=wanted)
        sub.subset(font)
        tmp = os.path.join(FONTS_OUT, f'{stem}.{os.getpid()}.tmp.woff2')
        font.flavor = 'woff2'
        font.save(tmp)
        with open(tmp, 'rb') as f:
            data = f.read()
        sha = hashlib.sha256(data).hexdigest()
        name = f'{stem}.{sha[:8]}.woff2'
        os.replace(tmp, os.path.join(FONTS_OUT, name))
        cmap = font.getBestCmap()
        lacks = sorted(c for c in canon if ord(c) not in cmap)
        if lacks:
            missing[stem] = ''.join(lacks)
        faces.append(dict(family=family, weight=weight, style='normal', file=f'fonts/{name}', bytes=len(data),
                          sha256=sha, licence=f'fonts/{licence}', foundry=foundry, glyphs=len(font.getGlyphOrder())))
        files.append(dict(file=f'fonts/{name}', bytes=len(data)))
        print(f'[fonts] {stem}: {len(data) / 1e3:.1f} kB, {len(font.getGlyphOrder())} glyphs'
              + (f', lacks {len(lacks)} canon characters' if lacks else ''), flush=True)
    for lic in sorted({f[3] for f in FACES}):
        tmp = os.path.join(FONTS_OUT, f'{lic}.{os.getpid()}.tmp')
        shutil.copy(os.path.join(K.FONT_SRC, lic), tmp)
        os.replace(tmp, os.path.join(FONTS_OUT, lic))
        files.append(dict(file=f'fonts/{lic}', bytes=os.path.getsize(os.path.join(FONTS_OUT, lic))))
    total = sum(f['bytes'] for f in faces)
    print(f'[fonts] {len(faces)} faces, {total / 1e3:.0f} kB', flush=True)
    index = (json.dumps(dict(faces=faces, missing=missing), indent=1, sort_keys=True) + '\n').encode()
    name = f'fonts.{hashlib.sha256(index).hexdigest()[:8]}.json'
    tmp = os.path.join(FONTS_OUT, f'{name}.{os.getpid()}.tmp')
    with open(tmp, 'wb') as f:
        f.write(index)
    os.replace(tmp, os.path.join(FONTS_OUT, name))
    files.append(dict(file=f'fonts/{name}', bytes=len(index)))
    K.dump_json(a.out, dict(faces=faces, files=files, missing=missing, total_bytes=total, index=f'fonts/{name}'))
    if missing:
        for stem, chars in sorted(missing.items()):
            print(f'[fonts] FAIL {stem} lacks {len(chars)} canon character(s): {chars!r}', flush=True)
        sys.exit(1)


if __name__ == '__main__':
    main()

"""B2 texture-format study, step 5 (codex B2-r1 finding 10): what block-isolated cells cost in page occupancy.

    gamedev-python -I design/asset-study/texfmt/pack_alignment.py

Packs A3's 120 trimmed Survey sprites (High) into 2048² pages with MaxRects, each sprite in a cell made of its
rectangle plus a gutter g on every side, the cell's position and size rounded up to a multiple of a. A cell is
block-isolated down to level L when a = 4 · 2^L (BC7 and ASTC blocks are 4×4), and filters correctly at level L
when g ≥ 2^L. Prints the occupancy (sprite pixels ÷ the pixels of the pages used, the last page counted by its
used height) for each (a, g).
"""

import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from make_pages import MaxRects, inked, trim, premul, SPR  # noqa: E402


def main():
    sizes = []
    for entity in sorted(os.listdir(SPR)):
        if entity == 'icons':
            continue
        man = json.load(open(os.path.join(SPR, entity, 'manifest.json')))
        for stem in sorted(man):
            if not os.path.exists(os.path.join(SPR, entity, f'{stem}.normal.png')):
                continue
            c = inked(entity, stem)
            t, _ = trim(premul(c))
            sizes.append((t.shape[1], t.shape[0]))
    content = sum(w * h for w, h in sizes)
    print(f'{len(sizes)} sprites, {content / 1e6:.2f} Mpx of trimmed sprite')
    out = {}
    for a, g in ((2, 1), (8, 8), (16, 8), (16, 16), (32, 8), (32, 16)):
        cells = [(-(-(w + 2 * g) // a) * a, -(-(h + 2 * g) // a) * a) for w, h in sizes]
        order = sorted(range(len(cells)), key=lambda i: -cells[i][0] * cells[i][1])
        pages = [MaxRects(2048, 2048)]
        used_h = [0]
        for i in order:
            w, h = cells[i]
            for p, mr in enumerate(pages):
                pos = mr.insert(w, h)
                if pos is not None:
                    used_h[p] = max(used_h[p], pos[1] + h)
                    break
            else:
                pages.append(MaxRects(2048, 2048))
                pos = pages[-1].insert(w, h)
                used_h.append(pos[1] + h)
        area = 2048 * 2048 * (len(pages) - 1) + 2048 * used_h[-1]
        cell_area = sum(w * h for w, h in cells)
        out[f'a{a} g{g}'] = dict(occupancy=round(content / area, 3), cell_overhead=round(cell_area / content - 1, 3), pages=len(pages))
        print(f'align {a:2d} gutter {g:2d}: cells +{100 * (cell_area / content - 1):.0f}% over the sprites, occupancy {content / area:.3f}, pages {len(pages)}')
    json.dump(out, open(os.path.join(HERE, '..', '..', '..', 'design', 'art', 'out', 'texfmt', 'pack_alignment.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()

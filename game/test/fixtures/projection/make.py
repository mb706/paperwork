"""The projection fixtures of 10 §15.7: the expected quads of the calibration sprite (the unit cube of §9.1) at
(zoom, dpr) = (1, 1), (1, 2), (0.5, 1), (3, 1) and (2, 2), at positions with negative and large coordinates.

    gamedev-python game/test/fixtures/projection/make.py

The frame is the calibration cube's as the asset build's post step trims and anchors it (C6's projection test,
game/test/assets/projection.py; .cache/assets/calibration/post/set.json): 336 × 208 level-0 px of the colour array
at 64 px per tile, anchor (40, 104). The quads come from scripts/assets/manifest.py's `quad` (the Python twin of
src/render/projection.ts), so the TypeScript is checked against independent code (test/render/projection.test.ts).
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', '..', 'scripts', 'assets'))
import manifest as MF  # noqa: E402

FRAME = [0, 0, 40, 40, 336, 208, 40, 104]          # [array, layer, x, y, w, h, ax, ay]: the cube's colour frame
MAN = dict(arrays=[dict(kind='colour', pxPerTile=64, pageSize=512, levels=2, codec='rgba8')], frames=[FRAME])
COMBOS = [(1, 1), (1, 2), (0.5, 1), (3, 1), (2, 2)]
CAMERAS = [(0.0, 0.0), (-3.25, 7.5), (100.5, -40.25), (-1000.0, -1000.0), (1048576.5, -524288.25)]
ANCHORS = [(0.5, 0.5), (-0.5, -0.5), (12.5, -7.0), (-1000.5, 2000.5), (1048580.0, -524290.5)]


def dumps(v, ind=0):
    """JSON as Biome formats it (objects one key per line, scalar arrays on one line), so `npm run ci` passes."""
    pad = '  ' * (ind + 1)
    end = '  ' * ind
    if isinstance(v, dict):
        return '{\n' + ',\n'.join(f'{pad}{json.dumps(k)}: {dumps(x, ind + 1)}' for k, x in v.items()) + f'\n{end}}}'
    if isinstance(v, list) and not any(isinstance(x, (dict, list)) for x in v):
        return '[' + ', '.join(json.dumps(x) for x in v) + ']'
    if isinstance(v, list):
        return '[\n' + ',\n'.join(pad + dumps(x, ind + 1) for x in v) + f'\n{end}]'
    return json.dumps(v)


def main():
    for zoom, dpr in COMBOS:
        cases = []
        for cx, cy in CAMERAS:
            cam = dict(cx=cx, cy=cy, zoom=zoom, dpr=dpr)
            for ex, ey in ANCHORS:
                q, uv = MF.quad(MAN, 0, cam, ex, ey)
                cases.append(dict(camera=cam, anchor=[ex, ey], quad=q, uv=uv))
        out = dict(note='10 §15.7: device px from the canvas centre; made by make.py from manifest.py.quad',
                   frame=FRAME, array=MAN['arrays'][0], zoom=zoom, dpr=dpr, cases=cases)
        name = f'z{zoom:g}-dpr{dpr:g}.json'
        with open(os.path.join(HERE, name), 'w') as f:
            f.write(dumps(out) + '\n')
        print(name, len(cases))


if __name__ == '__main__':
    main()

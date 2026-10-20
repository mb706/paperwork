"""Build the mocks for one style: 1920x1080 at the default zoom (1x = 32 px per tile) and at 0.3x.

    gamedev-python design/art/proto/mock.py kodachrome [--no-ui] [--tag final] [--only 1x|0.3x]

1x: the 60 x 33.75-tile view is composed from High sprites (64 px/tile) and box-downscaled 2x,
which is what the engine's mipmapped sampling does at zoom 1. 0.3x: the 200 x 112.5-tile view is
composed from Normal sprites (32 px/tile) and box-downscaled to 1920 px. Both get the HUD.
Outputs: design/art/mocks/<style>[-<tag>]-1x.png and -0.3x.png, plus a 2x crop for detail.
"""

import argparse
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import post  # noqa: E402
import scene  # noqa: E402
import layouts  # noqa: E402
import ui  # noqa: E402

MOCKS = os.path.join(HERE, '..', 'mocks')


def overlay(img, hud):
    a = hud[..., 3:4]
    return img * (1 - a) + hud[..., :3] * a


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('style')
    ap.add_argument('--no-ui', action='store_true')
    ap.add_argument('--tag', default='')
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    st = a.style
    tag = f'-{a.tag}' if a.tag else ''
    os.makedirs(MOCKS, exist_ok=True)
    work = os.path.join(HERE, '..', 'out', 'mockwork')
    os.makedirs(work, exist_ok=True)
    t0 = time.time()
    L = layouts.slice_scene(wide=True)
    print(f'[mock] layout {len(L.ents)} entities, {len(L.items)} items, {time.time() - t0:.1f}s', flush=True)
    hud = None
    if not a.no_ui:
        mm = ui.minimap(L, st, (37, 17), tiles=120, px=2)
        hud = ui.hud(st, mm, os.path.join(work, f'hud-{st}.png'))
    if a.only in ('', '1x'):
        img = scene.compose(L, st, layouts.VIEW_1X, 64)
        scene.save(img, os.path.join(work, f'{st}{tag}-2x.png'))
        img1 = post.downscale(img, 2)
        if hud is not None:
            img1 = overlay(img1, hud)
        scene.save(img1, os.path.join(MOCKS, f'{st}{tag}-1x.png'))
        print(f'[mock] 1x done {time.time() - t0:.1f}s', flush=True)
    if a.only in ('', '0.3x'):
        img = scene.compose(L, st, layouts.VIEW_03, 32)
        img3 = post.resize(img, 1920 / img.shape[1])[:1080]
        if hud is not None:
            img3 = overlay(img3, hud)
        scene.save(img3, os.path.join(MOCKS, f'{st}{tag}-0.3x.png'))
        print(f'[mock] 0.3x done {time.time() - t0:.1f}s', flush=True)


if __name__ == '__main__':
    main()

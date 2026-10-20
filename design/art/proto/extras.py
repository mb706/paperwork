"""Extras for the recommended direction: night, the era ladder, animation strips.

    gamedev-python design/art/proto/extras.py night survey      # mocks/<style>-final-night.png
    gamedev-python design/art/proto/extras.py eras survey       # mocks/<style>-final-eras.png
    gamedev-python design/art/proto/extras.py anim survey keypunch   # out/anim/<style>-keypunch.gif + check

Night (survey): the plate becomes a cyanotype, the 1842 blueprint process: paper turns Prussian
blue, ink turns pale; the engine's light layer (fires, lamps) then reveals the day colours where it
falls, so lit machines keep their colour coding. In the engine this is the day table driving a LUT
blend (10 §6.2 steps 7 and 9).
"""

import glob
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import post  # noqa: E402
import scene  # noqa: E402
import layouts  # noqa: E402
import ui  # noqa: E402

MOCKS = os.path.join(HERE, '..', 'mocks')
FONT = os.path.join(HERE, '..', 'out', 'fonts', 'LibreFranklin-SemiBold.ttf')


def cyanotype(day, light, strength=1.0):
    lum = (day * np.array([0.2126, 0.7152, 0.0722])).sum(-1, keepdims=True)
    deep = post.hexc('#13304f')
    pale = post.hexc('#d6e4ec')
    cy = pale + (deep - pale) * np.clip((lum - 0.12) / 0.80, 0, 1)
    # keep a trace of the wash colours so belts and machines stay coded
    cy = cy * 0.82 + (day * np.array([0.45, 0.55, 0.85])) * 0.18
    li = np.clip(light.max(-1, keepdims=True) * 1.6, 0, 1)
    reveal = np.clip(ndi.gaussian_filter(li[..., 0], 6)[..., None] * 1.4, 0, 1)
    out = cy * (1 - reveal) + day * reveal
    out = 1 - (1 - out) * (1 - np.clip(light * 0.9, 0, 1))
    return np.clip(out * strength + cy * (1 - strength), 0, 1)


def night(style):
    L = layouts.slice_scene(wide=True)
    img, light = scene.compose(L, style, layouts.VIEW_1X, 64, return_light=True)
    n = cyanotype(img, light)
    n1 = post.downscale(n, 2)
    mm = ui.minimap(L, style, (37, 17), tiles=120, px=2)
    hud = ui.hud(style, mm, os.path.join(HERE, '..', 'out', 'mockwork', f'hud-{style}-night.png'))
    a = hud[..., 3:4]
    n1 = n1 * (1 - a) + hud[..., :3] * a
    scene.save(n1, os.path.join(MOCKS, f'{style}-final-night.png'))
    print('[night] done')


def eras(style):
    """The same plate across the arc: Memo-tier machine (1945), Report-tier (stored program, late
    1950s), takeoff-era Research hall; plus the town block skin of the period."""
    items = [('assembling-machine-1', 'assembling-machine-1-S-f00', ('Assembling machine 1', 'Memo tier: plugboard')),
             ('assembling-machine-2', 'assembling-machine-2-S-f00', ('Assembling machine 2', 'Report tier: stored program')),
             ('research-hall', 'research-hall-S-f00', ('Research hall', 'System card tier: accelerator hall'))]
    grass = __import__('terrain').materials(style, 64, tiles=['grass'])['grass']
    font = ImageFont.truetype(FONT, 19)
    cells = []
    for eid, stem, label in items:
        spr = scene.sprite(style, eid, stem, 64)
        if spr is None:
            continue
        rgba, sh = spr['rgba'], spr['shadow']
        h, w = rgba.shape[:2]
        H, W = h + 70, max(w + 40, 330)
        g = np.tile(grass, (H // grass.shape[0] + 1, W // grass.shape[1] + 1, 1))[:H, :W].copy()
        ox, oy = 20, 10
        hat = post.hatch(h, w, 7.0, 1.7, -45) * np.clip(sh * 1.4, 0, 1)
        reg = g[oy:oy + h, ox:ox + w]
        reg[...] = reg * (1 - 0.55 * hat[..., None]) + post.hexc('#2b2723') * 0.55 * hat[..., None]
        scene.blit(g, rgba, ox, oy)
        im = Image.fromarray((np.clip(g, 0, 1) * 255).astype(np.uint8))
        d = ImageDraw.Draw(im)
        d.text((14, H - 58), label[0], fill=(43, 39, 35), font=font)
        d.text((14, H - 33), label[1], fill=(93, 83, 69), font=font)
        cells.append(np.asarray(im))
    Hm = max(c.shape[0] for c in cells)
    out = np.full((Hm, sum(c.shape[1] for c in cells) + 12 * (len(cells) - 1), 3), (236, 227, 203), np.uint8)
    x = 0
    for c in cells:
        out[Hm - c.shape[0]:, x:x + c.shape[1]] = c
        x += c.shape[1] + 12
    Image.fromarray(out).save(os.path.join(MOCKS, f'{style}-final-eras.png'))
    print('[eras] done', out.shape)


def anim(style, eid):
    """Assemble an entity's 16 frames into a GIF and check frame registration: pixels outside the
    animated parts must be identical across frames (10 §9.5 #2)."""
    d = os.path.join(scene.SPRITES, style, eid)
    man = json.load(open(os.path.join(d, 'manifest.json')))
    pre = eid + '-S-f'
    stems = sorted(s for s in man if s.startswith(pre) and len(s) == len(pre) + 2)   # 'keypunch-S-f05'
    frames = []
    for s in stems:
        c = post.read_png(os.path.join(d, f'{s}.colour.png'))
        if scene.S.STYLES[style]['render'] == 'flat':
            n = post.read_png(os.path.join(d, f'{s}.normal.png'))
            a = post.read_png(os.path.join(d, f'{s}.aux.png'))
            c = post.survey_ink(c, n, a, style, seed=0)
        frames.append(c)
    stack = np.stack(frames)
    var = stack[..., :3].std(0).max(-1)
    moving = var > 0.02
    frac = float(moving.mean())
    outd = os.path.join(HERE, '..', 'out', 'anim')
    os.makedirs(outd, exist_ok=True)
    pngs = []
    bg = post.hexc('#ece3cb') if style == 'survey' else post.hexc('#5a6e3c')
    for k, f in enumerate(frames):
        g = np.ones(f.shape[:2] + (3,), np.float32) * bg
        g = g * (1 - f[..., 3:4]) + f[..., :3] * f[..., 3:4]
        p = os.path.join(outd, f'{style}-{eid}-{k:02d}.png')
        scene.save(g, p)
        pngs.append(p)
    gif = os.path.join(outd, f'{style}-{eid}.gif')
    subprocess.run(['gifski', '--quiet', '--fps', '16', '-o', gif] + pngs, check=True)
    strip = np.concatenate([np.asarray(Image.open(p)) for p in pngs[:8]], 1)
    Image.fromarray(strip).save(os.path.join(outd, f'{style}-{eid}-strip.png'))
    print(f'[anim] {eid}: {len(frames)} frames, moving pixels {frac * 100:.1f}% of the canvas, gif {gif}')


if __name__ == '__main__':
    cmd, style = sys.argv[1], sys.argv[2]
    if cmd == 'night':
        night(style)
    elif cmd == 'eras':
        eras(style)
    elif cmd == 'anim':
        anim(style, sys.argv[3])

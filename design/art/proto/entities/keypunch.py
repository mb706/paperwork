"""keypunch (2x2): 'desk-sized keypunch, card hopper on top, cream and steel-blue' (items.yaml);
'Transcribes records into tokens, one card at a time. Burns fuel.' (entities.yaml). The burner is a
small cast-iron stove-engine at the back-left that drives the machine through a belt; its door glows
while working. Animation (16 frames): a card travels from the hopper side to the stacker."""

import math

META = dict(size=(2, 2), height=1.62, directions=['S'], frames=16, light=True)


def build(P, direction='S', frame=0, variant=0, state='working'):
    o = []
    working = state == 'working'
    # floor plate
    o.append(P.box(1.90, 1.86, 0.03, 0, 0, 0.0, mat='concrete', bevel=0.01, name='floor'))
    # desk cabinet (steel blue) on feet, shifted east to leave room for the burner
    dx = 0.18
    for x in (-0.56 + dx, 0.70 + dx):
        for y in (-0.36, 0.62):
            o.append(P.box(0.08, 0.08, 0.06, x, y, 0.04, mat='cast_iron', bevel=0.01, name='foot'))
    o.append(P.box(1.40, 1.10, 0.64, dx + 0.07, 0.13, 0.10, mat='enamel_blue', bevel=0.03, name='cabinet'))
    o.append(P.box(0.52, 0.02, 0.40, dx - 0.20, -0.43, 0.20, mat='steel_dark', bevel=0.0, name='kick'))
    o.append(P.box(0.40, 0.02, 0.10, dx + 0.42, -0.43, 0.56, mat='enamel_blue', bevel=0.01, name='drawer'))
    o.append(P.box(0.10, 0.02, 0.025, dx + 0.42, -0.445, 0.60, mat='brass', bevel=0.0, name='pull'))
    # desk top (cream)
    o.append(P.box(1.52, 1.24, 0.05, dx + 0.07, 0.12, 0.74, mat='enamel_cream', bevel=0.015, name='top'))
    # machine body with sloped front
    o.append(P.wedge(1.36, 0.56, 0.30, 0.48, dx + 0.07, 0.40, 0.79, mat='enamel_cream', name='body'))
    o.append(P.box(1.30, 0.06, 0.06, dx + 0.07, 0.10, 1.03, mat='cast_iron', bevel=0.0, name='card_bed'))
    o.append(P.box(0.18, 0.02, 0.05, dx + 0.07, 0.115, 0.86, mat='brass', bevel=0.0, name='plate'))
    # keyboard: sloped base + keys
    kb_x, kb_y = dx + 0.18, -0.26
    o.append(P.wedge(0.70, 0.30, 0.04, 0.10, kb_x, kb_y, 0.79, mat='enamel_cream', name='kbbase'))
    for r in range(3):
        y = kb_y - 0.10 + r * 0.09
        z = 0.79 + 0.04 + (0.06 * (r + 0.5) / 3) + 0.005
        for c in range(9):
            x = kb_x - 0.29 + c * 0.072 + (0.03 if r == 1 else 0)
            o.append(P.box(0.05, 0.05, 0.03, x, y, z, mat='bakelite', bevel=0.006, name='key'))
    # hopper (right) with cream cards, stacker (left)
    o.append(P.taper_box(0.40, 0.34, 0.26, 1.12, 1.1, dx + 0.52, 0.42, 1.10, mat='enamel_blue', bevel=0.02,
                         name='hopper'))
    o.append(P.box(0.24, 0.12, 0.10, dx + 0.52, 0.42, 1.30, mat='paper_cream', bevel=0.004, name='cards_in'))
    o.append(P.box(0.40, 0.30, 0.10, dx - 0.42, 0.40, 1.10, mat='enamel_blue', bevel=0.02, name='stacker'))
    for k in range(4):
        o.append(P.box(0.24, 0.12, 0.012, dx - 0.42 + 0.01 * (k % 2), 0.40, 1.20 + k * 0.014, mat='paper_cream',
                       bevel=0.0, name='cards_out'))
    # a card in transit along the bed
    t = (frame % 16) / 16.0
    cx = dx + 0.52 - t * 0.94
    o.append(P.box(0.19, 0.085, 0.006, cx, 0.10, 1.095, mat='paper_cream', bevel=0.0, name='card'))
    # pilot lamp
    o.append(P.sphere(0.035, dx + 0.70, 0.13, 1.13, mat='lamp' if working else 'glass_dark', seg=12))
    # the burner: stove-engine with flywheel and drive belt, stovepipe
    sx, sy = -0.66, 0.46
    o.append(P.cyl(0.22, 0.58, sx, sy, 0.04, mat='cast_iron', seg=20, name='stove'))
    o.append(P.cyl(0.25, 0.05, sx, sy, 0.60, mat='steel_dark', seg=20, name='stove_top'))
    o.append(P.box(0.18, 0.06, 0.16, sx, sy - 0.21, 0.16, mat='steel_dark', bevel=0.01, name='door'))
    o.append(P.box(0.11, 0.02, 0.08, sx, sy - 0.245, 0.19, mat='fire' if working else 'cast_iron', bevel=0.0))
    o.append(P.cyl(0.055, 0.95, sx - 0.06, sy + 0.08, 0.65, mat='steel_dark', seg=12, name='stovepipe'))
    o.append(P.cyl(0.075, 0.06, sx - 0.06, sy + 0.08, 1.58, mat='steel_dark', seg=12, name='pipecap'))
    ang = (frame % 16) / 16 * 2 * math.pi
    o.append(P.cyl(0.13, 0.04, sx + 0.10, sy - 0.05, 0.80, mat='steel_bare', axis='Y', seg=16, name='flywheel'))
    o.append(P.box(0.20, 0.03, 0.02, sx + 0.10, sy - 0.075, 0.80, mat='steel_dark', rot=(0, ang, 0), bevel=0.0))
    o.append(P.tube([(sx + 0.10, sy - 0.07, 0.92), (dx - 0.52, 0.40, 0.98)], 0.015, 'rubber', seg=6, name='belt'))
    return o

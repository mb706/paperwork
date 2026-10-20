"""seminar (3x3): "Factorio's lab with a long table and chairs under the dome; one extra socket on
the side for a staff unit" (items.yaml); 'Consumes papers. Needs staff.' An octagonal brick base,
a glass dome on brass ribs, inside a seminar table with chairs, papers on the table and a blackboard.
Working: the pendant lamp under the dome is lit (colour and light passes). The staff socket on the
east side is drawn empty (no Researcher in the slice; 09 §2.4)."""

import math

META = dict(size=(3, 3), height=2.05, directions=['S'], frames=1, light=True)


def build(P, direction='S', frame=0, variant=0, state='working'):
    o = []
    working = state == 'working'
    o.append(P.cyl(1.46, 0.20, 0, 0, 0.0, mat='concrete', seg=8, name='plinth'))
    o.append(P.cyl(1.38, 0.30, 0, 0, 0.20, mat='brick', seg=8, name='wall'))
    o.append(P.cyl(1.40, 0.04, 0, 0, 0.50, mat='brass', seg=8, name='trim'))
    zf = 0.54
    o.append(P.cyl(1.30, 0.02, 0, 0, zf, mat='concrete', seg=32, bevel=0.0, name='floor'))
    # table
    zt = zf + 0.42
    o.append(P.box(1.50, 0.56, 0.05, 0, -0.05, zt, mat='wood', bevel=0.012, name='tabletop'))
    for x in (-0.66, 0.66):
        for y in (-0.27, 0.17):
            o.append(P.box(0.05, 0.05, 0.42, x, y, zf, mat='wood', bevel=0.0, name='leg'))
    # papers on the table (memos: white with a red head band)
    r = P.rng(5)
    for k in range(6):
        x = -0.55 + k * 0.22 + r.uniform(-0.04, 0.04)
        y = -0.12 + r.uniform(-0.12, 0.12)
        a = r.uniform(-0.4, 0.4)
        o.append(P.box(0.16, 0.21, 0.006, x, y, zt + 0.05, mat='paper', bevel=0.0, rot=(0, 0, a), name='sheet'))
        if k % 2 == 0:
            o.append(P.box(0.16, 0.035, 0.007, x - 0.07 * math.sin(a), y + 0.085 * math.cos(a), zt + 0.051,
                           mat='red_band', bevel=0.0, rot=(0, 0, a), name='band'))
    # chairs
    for side in (-1, 1):
        for x in (-0.48, 0.0, 0.48):
            y = -0.05 + side * 0.48
            o.append(P.box(0.24, 0.22, 0.04, x, y, zf + 0.30, mat='wood', bevel=0.008, name='seat'))
            o.append(P.box(0.24, 0.03, 0.30, x, y + side * 0.11, zf + 0.34, mat='wood', bevel=0.006, name='back'))
            for lx in (-0.09, 0.09):
                o.append(P.box(0.03, 0.03, 0.30, x + lx, y, zf, mat='wood', bevel=0.0, name='cleg'))
    # blackboard at the north
    o.append(P.box(1.10, 0.06, 0.62, 0, 0.92, zf + 0.30, mat='wood', bevel=0.01, name='bb_frame'))
    o.append(P.box(1.00, 0.04, 0.52, 0, 0.90, zf + 0.35, mat='blackboard', bevel=0.0, name='bb'))
    for (x, z, w) in [(-0.30, 0.75, 0.30), (-0.25, 0.68, 0.40), (0.15, 0.78, 0.22), (0.20, 0.62, 0.34), (-0.20, 0.55, 0.18)]:
        o.append(P.box(w, 0.01, 0.012, x, 0.875, zf + z, mat='chalk', bevel=0.0, name='chalk'))
    for x in (-0.50, 0.50):
        o.append(P.box(0.05, 0.05, 0.30, x, 0.92, zf, mat='wood', bevel=0.0, name='bb_leg'))
    # dome: glass with brass ribs, base ring and lantern cap
    R = 1.32
    o.append(P.hemisphere(R, 0, 0, zf, mat='glass', seg=40, name='dome'))
    o.append(P.torus(R, 0.035, 0, 0, zf + 0.01, mat='brass', seg=48, seg_minor=8, name='ring'))
    for k in range(8):
        a = k * math.pi / 4 + math.pi / 8
        pts = []
        for j in range(13):
            phi = j / 12 * (math.pi / 2 - 0.14)
            pts.append((R * math.cos(phi) * math.cos(a), R * math.cos(phi) * math.sin(a), zf + R * math.sin(phi)))
        o.append(P.tube(pts, 0.025, 'brass', seg=6, name='rib'))
    o.append(P.cyl(0.20, 0.12, 0, 0, zf + R - 0.03, mat='brass', seg=16, name='lantern'))
    o.append(P.cone(0.12, 0.16, 0, 0, zf + R + 0.09, mat='brass', seg=12, name='finial'))
    # schoolhouse pendant: a milk-glass globe on a cord, lit while the Seminar works (visible from the
    # 45-degree camera, unlike a shaded bulb); unlit it is plain white glass
    o.append(P.cyl(0.008, 0.40, 0, -0.05, zf + R - 0.42, mat='steel_dark', seg=6, bevel=0.0, name='cord'))
    o.append(P.cyl(0.05, 0.05, 0, -0.05, zf + R - 0.46, mat='brass', seg=12, name='fitter'))
    o.append(P.sphere(0.15, 0, -0.05, zf + R - 0.60, mat='lamp' if working else 'trim_white', seg=20, name='globe'))
    if working:
        o.append(P.point_light(0, -0.05, zf + R - 0.80, power=40.0, color='#ffc874', radius=0.10))
    # staff socket (east): an empty bay with a brass plate
    o.append(P.box(0.34, 0.56, 0.56, 1.30, 0.0, 0.20, mat='steel_paint', bevel=0.025, name='socket'))
    o.append(P.box(0.06, 0.40, 0.34, 1.48, 0.0, 0.30, mat='cast_iron', bevel=0.0, name='bay'))
    o.append(P.box(0.02, 0.18, 0.06, 1.47, 0.0, 0.66, mat='brass', bevel=0.0, name='plate'))
    return o

"""small-electric-pole (1x1): 'wooden pole with one crossarm' (items.yaml). Creosoted pole, one
crossarm with two green-glass insulators on steel pins. Wire attachment points: WIRES (local metres)."""

META = dict(size=(1, 1), height=3.05, directions=['S'], frames=1, margin=0.6)
WIRES = [(-0.36, 0.0, 2.80), (0.36, 0.0, 2.80)]


def build(P, direction='S', frame=0, variant=0, state='working'):
    o = []
    o.append(P.cyl(0.085, 2.95, 0, 0, 0.0, mat='wood_pole', seg=14, r_top=0.065, name='pole'))
    o.append(P.cone(0.07, 0.08, 0, 0, 2.95, mat='wood_pole', seg=14))
    o.append(P.box(0.92, 0.09, 0.09, 0, 0, 2.62, mat='wood_pole', bevel=0.01, name='crossarm'))
    for x in (-0.25, 0.25):
        o.append(P.tube([(0, 0.0, 2.45), (x, 0.0, 2.62)], 0.012, 'steel_dark', seg=6, name='brace'))
    for x, y, z in WIRES:
        o.append(P.cyl(0.012, 0.10, x, y, 2.71, mat='steel_dark', seg=6, bevel=0.0, name='pin'))
        o.append(P.cyl(0.045, 0.07, x, y, 2.74, mat='insulator', seg=12, r_top=0.035, name='insulator'))
        o.append(P.cyl(0.03, 0.03, x, y, 2.81, mat='insulator', seg=12, name='ins_top'))
    o.append(P.box(0.10, 0.02, 0.14, 0, -0.085, 1.6, mat='steel_bare', bevel=0.004, name='tag'))
    return o

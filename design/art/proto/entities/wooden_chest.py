"""wooden-chest, displayed as 'File drawer' (1x1): 'small wooden filing drawer with a brass label
holder (Factorio's wooden chest, as office furniture)' (items.yaml). Two-drawer oak cabinet."""

META = dict(size=(1, 1), height=0.95, directions=['S'], frames=1, margin=0.4)


def build(P, direction='S', frame=0, variant=0, state='working'):
    o = []
    o.append(P.box(0.80, 0.66, 0.06, 0, 0.02, 0.0, mat='wood', bevel=0.01, name='plinth'))
    o.append(P.box(0.78, 0.64, 0.84, 0, 0.02, 0.06, mat='wood', bevel=0.025, name='case'))
    o.append(P.box(0.82, 0.68, 0.04, 0, 0.02, 0.90, mat='wood', bevel=0.012, name='top'))
    for k, z in enumerate((0.12, 0.50)):
        o.append(P.box(0.68, 0.04, 0.34, 0, -0.31, z, mat='wood', bevel=0.015, name='drawer'))
        o.append(P.box(0.20, 0.02, 0.07, 0, -0.335, z + 0.22, mat='brass', bevel=0.004, name='label_holder'))
        o.append(P.box(0.16, 0.022, 0.045, 0, -0.337, z + 0.232, mat='paper', bevel=0.0, name='label'))
        o.append(P.box(0.14, 0.04, 0.035, 0, -0.35, z + 0.10, mat='brass', bevel=0.008, name='pull'))
    return o

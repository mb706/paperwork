"""iron-chest (1x1): 'iron chest' (items.yaml). Riveted iron box with a hasp."""

META = dict(size=(1, 1), height=0.75, directions=['S'], frames=1, margin=0.4)


def build(P, direction='S', frame=0, variant=0, state='working'):
    o = []
    o.append(P.box(0.80, 0.70, 0.62, 0, 0, 0.0, mat='steel_dark', bevel=0.03, name='box'))
    o.append(P.box(0.84, 0.74, 0.10, 0, 0, 0.60, mat='steel_dark', bevel=0.02, name='lid'))
    for x in (-0.40, 0.40):
        o.append(P.box(0.05, 0.74, 0.70, x, 0, 0.0, mat='cast_iron', bevel=0.01, name='strap'))
    o.append(P.box(0.12, 0.04, 0.16, 0, -0.37, 0.48, mat='brass', bevel=0.006, name='hasp'))
    return o

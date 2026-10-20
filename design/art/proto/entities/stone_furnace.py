"""stone-furnace (2x2): 'white quartz-block furnace with a glowing mouth (Factorio's stone furnace in
quartz)' (items.yaml). A squat pile of dressed quartz blocks with a vertical front, an iron-framed
arched mouth to the south and a round chimney at the back. Working: the mouth glows (colour pass
and light pass); smoke is a render-time particle, not in the sprite."""

META = dict(size=(2, 2), height=1.62, directions=['S'], frames=1, light=True)


def build(P, direction='S', frame=0, variant=0, state='working'):
    o = []
    q = 'quartz_stone'
    o.append(P.taper_box(1.88, 1.82, 0.12, 0.99, 0.99, z0=0.0, mat=q, bevel=0.03, name='plinth'))
    # body: front stays vertical (top shifted south), back and sides batter inwards
    o.append(P.taper_box(1.76, 1.66, 0.80, 0.86, 0.84, z0=0.12, mat=q, bevel=0.05, name='body', top_dy=-0.133))
    o.append(P.taper_box(1.50, 1.38, 0.24, 0.80, 0.74, z0=0.92, mat=q, bevel=0.05, name='crown', top_dy=-0.12))
    # round stone chimney at the back, iron cap
    o.append(P.cyl(0.22, 0.46, 0.18, 0.26, 1.0, mat=q, seg=20, name='chimney'))
    o.append(P.cyl(0.25, 0.07, 0.18, 0.26, 1.42, mat='steel_dark', seg=20, name='cap'))
    o.append(P.cyl(0.15, 0.02, 0.18, 0.26, 1.485, mat='cast_iron', seg=16, bevel=0.0, name='flue'))
    # mouth: iron frame + arch, dark recess, fire in two layers
    working = state == 'working'
    o.append(P.box(0.70, 0.07, 0.48, 0, -0.84, 0.16, mat='steel_dark', bevel=0.015, name='frame'))
    o.append(P.cyl(0.35, 0.07, 0, -0.84, 0.64, mat='steel_dark', axis='Y', seg=28, name='arch'))
    o.append(P.box(0.52, 0.08, 0.44, 0, -0.86, 0.18, mat='cast_iron', bevel=0.0, name='recess'))
    o.append(P.cyl(0.26, 0.08, 0, -0.86, 0.62, mat='cast_iron', axis='Y', seg=24, bevel=0.0, name='recess_arch'))
    o.append(P.box(0.44, 0.06, 0.36, 0, -0.875, 0.20, mat='fire_dim' if working else 'cast_iron', bevel=0.0, name='glow'))
    o.append(P.cyl(0.22, 0.06, 0, -0.875, 0.56, mat='fire_dim' if working else 'cast_iron', axis='Y', seg=20, bevel=0.0))
    if working:
        o.append(P.box(0.30, 0.04, 0.20, 0, -0.89, 0.20, mat='fire', bevel=0.0, name='core'))
        o.append(P.cyl(0.15, 0.04, 0, -0.89, 0.40, mat='fire', axis='Y', seg=16, bevel=0.0))
    # sill and corner tie plates
    o.append(P.box(0.84, 0.14, 0.06, 0, -0.88, 0.12, mat='cast_iron', bevel=0.012, name='sill'))
    for x in (-0.78, 0.78):
        o.append(P.box(0.10, 0.04, 0.10, x, -0.845, 0.66, mat='steel_dark', bevel=0.01, name='tie'))
        o.append(P.box(0.10, 0.04, 0.10, x, -0.845, 0.22, mat='steel_dark', bevel=0.01, name='tie'))
    return o

"""iron-chest (1x1): items.yaml 'ISO: iron chest' (Factorio's iron chest). A riveted iron strongbox, knee-high (in
this projection heights read 1:1, so a taller box reads as a locker): a plain body under an overhanging lid, two
straps over the lid and down the front, angle irons at the corners, a brass hasp and a low plinth. Detail sits on
the top and the south face (A3 §6); no part animates."""

META = dict(
    kind='entity',
    size=(1, 1),
    height=0.56,
    dirs=[8],
    states=['working'],
    margin=0.4,
    ink='machine',
)

BODY_Z, LID_Z, LID_H = 0.05, 0.40, 0.12


def build(P, dir=8, variant=0, state='working'):
    o = {}
    o['plinth'] = P.box(0.86, 0.78, 0.05, 0, 0.0, 0.0, mat='cast_iron', bevel=0.012, name='plinth')
    o['body'] = P.box(0.80, 0.70, LID_Z - BODY_Z, 0, 0.0, BODY_Z, mat='iron_chest', bevel=0.025, name='body')
    o['lid'] = P.box(0.86, 0.76, LID_H, 0, 0.0, LID_Z, mat='iron_chest', bevel=0.03, name='lid')
    o['lid_seam'] = P.box(0.82, 0.72, 0.02, 0, 0.0, LID_Z - 0.015, mat='cast_iron', bevel=0.0, name='lid_seam')
    top = LID_Z + LID_H
    for k, x in enumerate((-0.25, 0.25)):
        # a strap runs over the lid from back to front and down the south face
        o[f'strap_top{k}'] = P.box(0.10, 0.80, 0.022, x, 0.0, top - 0.004, mat='cast_iron', bevel=0.008,
                                   name='strap')
        o[f'strap_front{k}'] = P.box(0.10, 0.05, top - BODY_Z, x, -0.375, BODY_Z, mat='cast_iron', bevel=0.008,
                                     name='strap')
        for z in (0.13, 0.30):
            o[f'bolt{k}{z}'] = P.cyl(0.027, 0.02, x, -0.405, z, mat='steel_bare', axis='Y', seg=10, bevel=0.0,
                                     name='bolt')
    for sx in (-1, 1):
        for sy in (-1, 1):
            o[f'corner{sx}{sy}'] = P.box(0.07, 0.07, LID_Z - BODY_Z + 0.02, sx * 0.385, sy * 0.335, BODY_Z,
                                         mat='cast_iron', bevel=0.01, name='corner')
    o['hasp_plate'] = P.box(0.16, 0.055, 0.14, 0, -0.375, LID_Z - 0.04, mat='brass', bevel=0.006, name='hasp_plate')
    o['hasp'] = P.box(0.07, 0.07, 0.10, 0, -0.38, LID_Z - 0.12, mat='brass', bevel=0.006, name='hasp')
    o['handle'] = P.box(0.22, 0.035, 0.03, 0, -0.395, LID_Z + 0.05, mat='steel_dark', bevel=0.006, name='handle')
    return o

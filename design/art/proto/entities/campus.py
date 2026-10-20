"""campus (8x8): 'quadrangle of brick halls around a lawn, era skin by the field (01 §5.3)'
(world.yaml). Three halls (north, east, west) around a lawn with crossing paths; the north hall
carries a cupola. Era skin 1."""

from entities._building import hall

META = dict(size=(8, 8), height=6.5, directions=['S'], frames=1, margin=0.3)


def build(P, direction='S', frame=0, variant=0, state=''):
    o = []
    r = P.rng(77)
    o.append(P.box(7.9, 7.9, 0.05, 0, 0, 0.0, mat='lawn', bevel=0.0, name='lawn'))
    o += hall(P, 6.0, 2.0, 3, 0, 2.7, roof='hip', storey_h=1.0, cupola=True)
    o += hall(P, 1.9, 4.4, 2, -2.9, -0.6, roof='gable_y', storey_h=1.0, win_cols=2, door=False)
    o += hall(P, 1.9, 4.4, 2, 2.9, -0.6, roof='gable_y', storey_h=1.0, win_cols=2, door=False)
    o.append(P.box(0.5, 5.6, 0.02, 0, -1.0, 0.05, mat='concrete', bevel=0.0, name='path'))
    o.append(P.box(3.8, 0.5, 0.02, 0, -1.0, 0.05, mat='concrete', bevel=0.0, name='path'))
    for (x, y) in [(-1.2, -2.6), (1.2, -2.6), (-1.2, 0.4), (1.2, 0.4)]:
        o.append(P.cyl(0.07, 0.9, x, y, 0.05, mat='bark', seg=8))
        o.append(P.blob(0.55, x, y, 1.35, mat='leaf', seed=r.randint(0, 99), rough=0.25, subdiv=3))
    return o

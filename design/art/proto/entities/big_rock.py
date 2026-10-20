"""big-rock (2x2): 'ISO big rock, paler, with milky quartz veins' (world.yaml)."""

META = dict(size=(2, 2), height=1.25, directions=['S'], frames=1, variants=2, margin=0.4)


def build(P, direction='S', frame=0, variant=0, state=''):
    o = []
    r = P.rng(40 + variant)
    o.append(P.rock(0.95, 0, 0.05, 0.0, mat='rock', seed=r.randint(0, 99), squash=0.75, rough=0.32, subdiv=4,
                    name='main'))
    o.append(P.rock(0.45, 0.62, -0.42, 0.0, mat='rock', seed=r.randint(0, 99), squash=0.7, rough=0.3, name='side'))
    o.append(P.rock(0.35, -0.70, -0.45, 0.0, mat='rock', seed=r.randint(0, 99), squash=0.7, rough=0.3, name='side'))
    for k in range(3):
        o.append(P.rock(0.16, r.uniform(-0.4, 0.4), r.uniform(-0.75, -0.45), r.uniform(0.35, 0.65),
                        mat='rock_quartz', seed=r.randint(0, 99), squash=0.5, rough=0.2, name='vein'))
    return o

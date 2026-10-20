"""tree (1x1 collision): temperate broadleaf (variants 0-2) and conifers (3-4), ISO trees by biome
(world.yaml; 01 §2). Leaf stage 1 (full). The canopy is a cluster of noisy blobs in two greens."""

import math

META = dict(size=(1, 1), height=4.6, directions=['S'], frames=1, variants=5, margin=1.6)


def build(P, direction='S', frame=0, variant=0, state='full'):
    o = []
    r = P.rng(100 + variant)
    if variant < 3:
        h = 1.6 + 0.3 * r.random()
        o.append(P.cyl(0.13, h, 0, 0, 0.0, mat='bark', seg=10, r_top=0.08, name='trunk'))
        for k in range(3):
            a = r.uniform(0, 2 * math.pi)
            o.append(P.tube([(0, 0, h * 0.75), (0.45 * math.cos(a), 0.45 * math.sin(a), h + 0.45)], 0.05, 'bark',
                            seg=6, name='branch'))
        cz = h + 1.0
        R = 1.15 + 0.2 * r.random()
        # crown: a ring of clusters plus a top, each cluster several small blobs (foliage silhouette)
        centres = []
        for k in range(7):
            a = k * 2 * math.pi / 6 + r.uniform(-0.3, 0.3)
            rr = 0 if k == 6 else R * 0.55
            centres.append((rr * math.cos(a), rr * math.sin(a) * 0.9, cz + (0.45 if k == 6 else r.uniform(-0.25, 0.25)),
                            R * (0.62 if k == 6 else r.uniform(0.50, 0.60))))
        for k, (x, y, z, s) in enumerate(centres):
            mat = 'leaf' if (k + variant) % 3 else 'leaf_dark'
            o.append(P.blob(s * 0.85, x, y, z, mat=mat, seed=r.randint(0, 999), rough=0.18, subdiv=3, freq=3.0,
                            name='core'))
            for j in range(5):
                b = r.uniform(0, 2 * math.pi)
                e = r.uniform(-0.6, 0.9)
                d = s * 0.75
                o.append(P.blob(s * r.uniform(0.32, 0.45), x + d * math.cos(b) * math.cos(e),
                                y + d * math.sin(b) * math.cos(e), z + d * math.sin(e) * 0.8, mat=mat,
                                seed=r.randint(0, 999), rough=0.3, subdiv=2, freq=3.5, name='leafcluster'))
    else:
        h = 0.7
        o.append(P.cyl(0.11, 1.0, 0, 0, 0.0, mat='bark', seg=8, r_top=0.06, name='trunk'))
        tiers = 5
        for k in range(tiers):
            rr = 1.05 * (1 - k / tiers) + 0.18
            z0 = h + k * 0.62
            c = P.cone(rr, 1.05, 0, 0, z0, mat='conifer', seg=14, name='tier')
            o.append(c)
        o.append(P.cone(0.18, 0.55, 0, 0, h + tiers * 0.62, mat='conifer', seg=10))
    return o

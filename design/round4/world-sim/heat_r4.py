"""R4-world: thermal-plant heat under DECISIONS §24 (03 §1.1, §1.6).

Uses the reference field of tools/ref/heat_calib3.py (= round1/F-data/calib3.py, which implements
03 §1.2 exactly): C 20 MJ/K, diffusion 2% per neighbour every 64 ticks above 15 MJ, loss k*H + 2 kW.
§24: boilers, heat exchangers and reactors emit no conversion heat; steam engines, steam turbines and
fusion generators emit 2 x their current electrical output in their own chunk. Totals equal round 2's
(a boiler's two engines emit 3.6 MW as the boiler did), so F's calibration table (03 §1.6) stands;
only nuclear changes, because a block's turbines spread over several chunks.
Run: gamedev-python design/round4/world-sim/heat_r4.py   (from /home/mewse/browsergame)
"""
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, '..', '..', '..', 'tools', 'ref', 'heat_calib3.py')
ns = {}
exec(open(REF).read().split('# early:')[0], ns)      # field(), m(), sq() exactly as the reference
field, sq = ns['field'], ns['sq']

n = 64
K = np.full((n, n), 0.005)
c = 30


def profile(e, label, hours=3.0, kappa=K, theta=14.0):
    T = theta + field(e, kappa, hours=hours, n=n)
    row = ' '.join(f'{T[c, c + d]:.0f}' for d in range(0, 10))
    print(f'{label}\n   T along +x from the block edge chunk (°C): {row}')
    for lim, name in ((25, 'Accelerator class (25 °C)'), (35, 'Cluster class (35 °C)'), (40, 'Computer/Network class (40 °C)')):
        d = next((d for d in range(0, 20) if T[c, c + d] <= lim), None)
        print(f'   first chunk at <= {lim} °C (full speed, {name}): {d} chunks from the block edge chunk')
    return T


if __name__ == '__main__':
    print('== Fission, 2 x 2 block: 480 MW electric, 960 MW emitted by 83 turbines (5.82 MW each, 2x)')
    # turbines spread east of the reactors: 3 x 2 chunks of turbines (160 MW each); reactor chunks emit 0
    e = sq(n, c - 2, c - 1, 3, 2, 960 / 6)
    T = profile(e, '  turbines over 3 x 2 chunks (compact layout)')
    print(f'   peak {T.max():.0f} °C')
    e = sq(n, c - 3, c - 1, 4, 3, 960 / 12)
    T = profile(e, '  turbines over 4 x 3 chunks (spread layout)')
    print(f'   peak {T.max():.0f} °C')
    print('  (round 2 rule, for comparison: all 960 MW in the reactor chunk)')
    T = profile(sq(n, c, c, 1, 1, 960.0), '  960 MW in one chunk')
    print('\n== One reactor alone: 40 MW electric, 7 turbines in one chunk, 80 MW emitted')
    profile(sq(n, c, c, 1, 1, 80.0), '  one chunk')
    print('\n== Fusion: one reactor, 100 MW electric, two generators in one chunk: 200 MW emitted')
    profile(sq(n, c, c, 1, 1, 200.0), '  one chunk')
    print('\n== 20 boilers (36 MW electric): 40 engines over 2 chunks emit 72 MW (= round 2 at the boilers)')
    profile(sq(n, c - 1, c, 2, 1, 36.0), '  two chunks')
    lake = K.copy(); lake[c - 6:c + 4, c - 6:c + 4] = 0.020
    print('\n== The 2 x 2 fission block on a lake shore (turbines over 3 x 2 chunks, a 10 x 10-chunk lake around them)')
    T = profile(sq(n, c - 2, c - 1, 3, 2, 960 / 6), '  lake', kappa=lake)
    print(f'   peak {T.max():.0f} °C')

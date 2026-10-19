import numpy as np
from heatsim2 import run, sq
n = 64
def S(e, kap, C, towers=None, hours=2.0):
    K = np.full((n, n), kap); A = np.full((n, n), 0.002)
    T, h = run(e, K, A, C=C, hours=hours, towers=towers, n=n)
    return T
mid  = sq(n, 29, 29, 6, 6, 150/36)
hall = sq(n, 31, 31, 2, 2, 12.5)
late = sq(n, 28, 28, 7, 7, 1000/49)
early= sq(n, 28, 32, 2, 1, 9.0) + sq(n, 31, 30, 3, 3, 2.0)
tw   = sq(n, 31, 31, 2, 2, 10.0)
print("kappa  C   | mid150 | hall50 | hall+40MW towers | late1GW | early plant/lab+4 | reach mid(>0.5K)")
for kap in (0.003, 0.005, 0.008):
    for C in (15, 20, 30):
        Tm = S(mid, kap, C); Th = S(hall, kap, C); Tt = S(hall, kap, C, towers=tw)
        Tl = S(late, kap, C); Te = S(early, kap, C)
        print(f"{kap:.3f} {C:3d} | {Tm[31,31]:6.1f} | {Th[31,31]:6.1f} | {Tt[31,31]:6.1f}           | {Tl[31,31]:7.1f} | {Te[32,28]:5.1f} / {Te[31,37]:4.1f}       | {(Tm>0.5).sum()}")

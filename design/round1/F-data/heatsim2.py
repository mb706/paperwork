"""Heat field v2: Factorio diffusion (2%/neighbour/64 ticks, min 15 MJ) +
Newton cooling sink  kappa_tile * H  + small constant sink a_tile  (BEND).
Display dT = H / C.
"""
import numpy as np

DT = 64 / 60.0
RATIO = 0.02
MIN = 15.0

def run(emit, kappa, a, C=100.0, hours=4.0, towers=None, n=96, ramp=5.0):
    H = np.zeros((n, n)); hist = []
    steps = int(hours * 3600 / DT)
    for s in range(steps):
        H += emit * DT
        out = np.where(H >= MIN, RATIO * H, 0.0)
        H -= 4 * out
        H[1:, :] += out[:-1, :]; H[:-1, :] += out[1:, :]
        H[:, 1:] += out[:, :-1]; H[:, :-1] += out[:, 1:]
        H -= (kappa * H + a) * DT
        if towers is not None:   # active absorber, full capacity above `ramp` K
            H -= towers * np.clip(H / C / ramp, 0, 1) * DT
        np.maximum(H, 0.0, out=H)
        if s % int(60 / DT) == 0:
            hist.append(H.max() / C)
    return H / C, hist

def sq(n, x, y, w, h, v):
    a = np.zeros((n, n)); a[y:y + h, x:x + w] = v; return a

def t63(hist):
    final = hist[-1]
    for i, v in enumerate(hist):
        if v >= 0.63 * final: return i  # minutes
    return None

def rep(name, T, hist, pts, sig=0.2):
    reach = (T > sig).sum()
    print(f"{name:34s} peak {T.max():6.1f} K | " +
          " ".join(f"{k}={T[y, x]:.1f}" for k, (x, y) in pts.items()) +
          f" | chunks>{sig}K: {reach} | t63={t63(hist)} min")

if __name__ == "__main__":
    n = 96
    for kap in (0.001, 0.002):
        K = np.full((n, n), kap); A = np.full((n, n), 0.005)
        print(f"\n### grass kappa={kap}/s (tau={1/kap/60:.0f} min), C=100 MJ/K, "
              f"lambda~{(0.02/DT/kap)**0.5:.1f} chunks")
        rep("early: 2 boilers + 3.6 MW", *run(sq(n, 48, 48, 1, 1, 3.6) + sq(n, 49, 47, 2, 2, 0.9), K, A),
            {"plant": (48, 48), "consumers": (49, 47)})
        rep("early+: 10 boilers + 18 MW", *run(sq(n, 46, 48, 2, 1, 9.0) + sq(n, 49, 46, 3, 3, 2.0), K, A),
            {"plant": (46, 48), "consumers": (50, 47), "lab 4 chunks off": (54, 47)})
        rep("mid: 150 MW solar 6x6", *run(sq(n, 45, 45, 6, 6, 150 / 36), K, A),
            {"centre": (48, 48), "edge": (50, 48), "+3 off": (53, 48)})
        rep("mid: 150 MW + steam waste", *run(sq(n, 45, 45, 6, 6, 150 / 36) + sq(n, 41, 47, 2, 2, 37.5), K, A),
            {"plant": (41, 47), "centre": (48, 48)})
        e = sq(n, 48, 48, 2, 2, 12.5)
        rep("hall 50 MW 2x2", *run(e, K, A), {"hall": (48, 48)})
        rep("hall + 4x10 MW towers", *run(e, K, A, towers=sq(n, 48, 48, 2, 2, 10.0)), {"hall": (48, 48)})
        K2 = K.copy(); K2[40:60, 50:70] = kap * 5
        rep("hall beside lake (5x kappa)", *run(e, K2, A), {"hall": (48, 48)})
        e = sq(n, 45, 45, 7, 7, 1000 / 49)
        rep("late: 1 GW over 7x7", *run(e, K, A), {"centre": (48, 48)})
        rep("late + 70% liquid-cooled away", *run(e * 0.3, K, A), {"centre": (48, 48)})

"""Calibrate a Factorio-style chunk field for waste heat.

Rule (ISO with Factorio 2.0 pollution):
  every 64 ticks: chunks with H >= MIN send RATIO*H to each of 4 neighbours;
  each chunk loses its terrain sink (constant, not below 0);
  emitters add their power (MW == MJ/s) * dt.
Display: dT [K] = H / C, C = heat capacity of a chunk's air+ground (MJ/K).
"""
import numpy as np, sys

DT = 64 / 60.0          # seconds per update
RATIO = 0.02
MIN = 15.0              # MJ

def run(emit, sink, C=20.0, hours=6.0, towers=None, n=96, report=()):
    """emit, sink: arrays (MW per chunk). towers: array of MW capacity per chunk."""
    H = np.zeros((n, n))
    steps = int(hours * 3600 / DT)
    hist = []
    for s in range(steps):
        H += emit * DT
        out = np.where(H >= MIN, RATIO * H, 0.0)
        H -= 4 * out
        H[1:, :] += out[:-1, :]
        H[:-1, :] += out[1:, :]
        H[:, 1:] += out[:, :-1]
        H[:, :-1] += out[:, 1:]
        # edges: whatever flowed off-grid is lost (grid is large enough)
        H -= sink * DT
        if towers is not None:
            H -= towers * DT
        np.maximum(H, 0.0, out=H)
        if s % int(600 / DT) == 0:
            hist.append(H.max() / C)
    return H / C, hist

def square(n, cx, cy, w, h, val):
    a = np.zeros((n, n)); a[cy:cy + h, cx:cx + w] = val; return a

def summary(name, T, hist, pts):
    cloud = (T > 0.75).sum()
    print(f"{name}: peak dT={T.max():.1f} K; cloud(>0.75K)={cloud} chunks; "
          + "; ".join(f"{k}={T[y, x]:.1f}K" for k, (x, y) in pts.items())
          + f"; peak at 1h/2h/4h/6h = "
          + "/".join(f"{hist[min(i, len(hist)-1)]:.1f}" for i in (6, 12, 24, 35)))

if __name__ == "__main__":
    n = 96
    for a_grass in (0.02, 0.04):
        sink = np.full((n, n), a_grass)
        print(f"\n=== grass sink {a_grass*1000:.0f} kW/chunk ===")
        # 1. early base: 2 boilers (3.6 MW waste) in 1 chunk; 3.6 MW consumers over 2x2 chunks next to it
        e = square(n, 48, 48, 1, 1, 3.6) + square(n, 49, 47, 2, 2, 0.9)
        T, h = run(e, sink, hours=6)
        summary("early 7.2 MW", T, h, {"boilers": (48, 48), "consumers": (49, 47), "2 chunks away": (52, 48)})
        # 2. mid base: 150 MW consumers over 6x6 + 150 MW steam waste in 2x2 at edge
        e = square(n, 45, 45, 6, 6, 150 / 36) + square(n, 41, 47, 2, 2, 150 / 4)
        T, h = run(e, sink, hours=8)
        summary("mid 300 MW", T, h, {"plant": (41, 47), "base centre": (48, 48), "base far edge": (50, 48)})
        # 2b. same base, solar powered (no plant waste)
        e = square(n, 45, 45, 6, 6, 150 / 36)
        T, h = run(e, sink, hours=8)
        summary("mid 150 MW solar", T, h, {"base centre": (48, 48), "edge": (50, 48)})
        # 3. compute hall 50 MW in 2x2 chunks, isolated
        e = square(n, 48, 48, 2, 2, 12.5)
        T, h = run(e, sink, hours=6)
        summary("hall 50 MW 2x2", T, h, {"hall": (48, 48)})
        # 3b. with 4 cooling towers of 10 MW each in the hall chunks
        T, h = run(e, sink, hours=6, towers=square(n, 48, 48, 2, 2, 10.0))
        summary("hall + 40 MW towers", T, h, {"hall": (48, 48)})
        # 3c. hall next to a lake (sink 0.2 MW/chunk on a 10x10 lake to the east)
        s2 = sink.copy(); s2[40:60, 50:70] = 0.2
        T, h = run(e, s2, hours=6)
        summary("hall by lake", T, h, {"hall": (48, 48)})

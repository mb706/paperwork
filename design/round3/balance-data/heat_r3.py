"""R3 heat re-run: 03-pressure §1.2 field (Factorio pollution engine + Newton cooling), with the final data's
power and heat numbers (DECISIONS §18: burners 3x, boilers emit fuel - steam = 2x output; §18a nuclear 2x passed on).
Every update of 64 ticks: emission; diffusion 2%/neighbour if H >= 15 MJ; H -= (kappa*H + 0.002) dt; towers; clamp.
T = theta + H/C, C = 20 MJ/K.  Throttle m = clamp(1 - (T - T*eff)/50, 0.5, 1).
"""
import numpy as np
DT = 64 / 60; RATIO = 0.02; MIN = 15.0; C = 20.0
CLS = {'computer': 40, 'cluster': 35, 'accelerator': 25}

def field(emit, kappa, hours=2.0, towers=None, n=48, compute=None, Tstar=None, theta=14.0, liquid=None):
    """emit: MW per chunk (non-throttling), compute: MW per chunk of throttling machines (draw unchanged, so
    the heat does not depend on m: guard 1). towers: MW capacity per chunk (cooling tower rule: full at dT>=5 K)."""
    H = np.zeros((n, n))
    e = emit + (compute if compute is not None else 0)
    for s in range(int(hours * 3600 / DT)):
        H += e * DT
        out = np.where(H >= MIN, RATIO * H, 0.0); H -= 4 * out
        H[1:, :] += out[:-1, :]; H[:-1, :] += out[1:, :]; H[:, 1:] += out[:, :-1]; H[:, :-1] += out[:, 1:]
        H -= (kappa * H + 0.002) * DT
        if towers is not None:
            H -= towers * np.clip(H / C / 5.0, 0, 1) * DT
        np.maximum(H, 0, out=H)
    return theta + H / C

def m(T, Ts):
    return float(np.clip(1 - (T - Ts) / 50, 0.5, 1))

def sq(n, x, y, w, h, v):
    a = np.zeros((n, n)); a[y:y + h, x:x + w] = v; return a

n = 48; K = np.full((n, n), 0.005); c = 24  # centre chunk index

def report(name, T, pts, cls=None, liquid_bonus=0):
    s = f"{name:62s} "
    for lab, (x, y) in pts.items():
        t = T[y, x]
        s += f"{lab} {t:5.1f}C"
        if cls:
            s += f" (m={m(t, CLS[cls] + liquid_bonus):.2f})"
        s += "  "
    print(s)

if __name__ == '__main__':
    print("== single-chunk response (temperate 14 C, grass): steady dT per MW in one isolated chunk")
    for P in (1, 2, 4, 8, 16):
        T = field(sq(n, c, c, 1, 1, P), K, hours=3)
        print(f"   {P:3d} MW in 1 chunk: centre {T[c,c]:.1f} C, neighbour {T[c,c+1]:.1f} C, 2 away {T[c,c+2]:.1f} C")
    print("\n== MEMO / early burner phase (fuel x3: stone furnace 270 kW, burner drill 450 kW, keypunch 270 kW)")
    e = sq(n, c, c, 1, 1, 7.2)  # 2 boilers: 2 x 3.6 MW loss
    e += sq(n, c + 2, c, 1, 1, 20 * 0.45)  # 20 burner drills on iron
    e += sq(n, c + 2, c + 1, 1, 1, 24 * 0.27 + 4 * 0.27)  # 24 stone furnaces + 4 keypunches
    T = field(e, K)
    report("2 boilers | 20 burner drills | 24 furnaces + 4 keypunches", T,
           {'plant': (c, c), 'drills': (c + 2, c), 'furnaces': (c + 2, c + 1), 'lab 2 chunks off': (c + 4, c + 1)})
    e2 = sq(n, c + 2, c, 1, 1, 20 * 0.15) + sq(n, c + 2, c + 1, 1, 1, 28 * 0.09) + sq(n, c, c, 1, 1, 7.2)
    T = field(e2, K)
    report("  same layout at F's round-1 burner draws (1x)", T,
           {'plant': (c, c), 'drills': (c + 2, c), 'furnaces': (c + 2, c + 1)})
    print("\n== REPORT end (~1 SPS red+green, 30 MW electric): smelting 88 steel furnaces 24 MW over 3x2, 17 boilers 61 MW in 2 chunks")
    e = sq(n, c - 6, c, 2, 1, 61.2 / 2)  # steam plant
    e += sq(n, c, c, 3, 2, 88 * 0.27 / 6)  # smelting
    e += sq(n, c + 3, c - 1, 3, 3, 10 / 9)  # main bus / assembly 10 MW
    for label, (x, y) in (('refinery block beside smelting', (c + 1, c + 2)), ('refinery block 3 chunks out', (c + 1, c + 5)),
                          ('refinery block beside steam plant', (c - 4, c))):
        ref = sq(n, x, y, 1, 1, 4 * 0.42 + 3 * 0.21)
        T = field(e, K, compute=ref)
        report(f"  {label}", T, {'refinery chunk': (x, y)}, cls='computer')
    T = field(e, K)
    report("  (no refinery) ", T, {'steam plant': (c - 6, c), 'smelting': (c + 1, c), 'assembly': (c + 4, c)})
    T = field(e, K, theta=28)
    report("  (no refinery) hot biome 28 C", T, {'steam plant': (c - 6, c), 'smelting': (c + 1, c), 'assembly': (c + 4, c)})
    print("\n== ARTICLE: experiment-loop Trainer blocks (cluster class, T* 35 C, 400 kW each)")
    for trainers, per_chunk in ((42, 21), (42, 14), (120, 30), (21, 21)):
        nch = int(np.ceil(trainers / per_chunk)); w = min(nch, 2); h = int(np.ceil(nch / w))
        ee = sq(n, c, c, w, h, trainers * 0.4 / (w * h))
        for theta, tl in ((14, 'temperate'), (28, 'hot'), (-5, 'cold')):
            T = field(np.zeros((n, n)), K, compute=ee, theta=theta)
            report(f"  {trainers} Trainers @{per_chunk}/chunk ({w}x{h} ch), {tl}", T, {'block': (c, c)}, cls='cluster')
        T = field(np.zeros((n, n)), K, compute=ee, towers=sq(n, c, c, w, h, 10.0))
        report(f"  {trainers} Trainers @{per_chunk}/chunk + 1 cooling tower/chunk, temperate", T, {'block': (c, c)}, cls='cluster')
        T = field(np.zeros((n, n)), K, compute=ee * 0.3)
        report(f"  {trainers} Trainers @{per_chunk}/chunk, 70% liquid (dry coolers elsewhere), temperate", T, {'block': (c, c)}, cls='cluster', liquid_bonus=15)
        T = field(np.zeros((n, n)), K, compute=ee)
        report(f"  {trainers} Trainers @{per_chunk}/chunk, 70% liquid, dry coolers in-chunk, temperate", T, {'block': (c, c)}, cls='cluster', liquid_bonus=15)
    print("\n== PREPRINT: beaconed Seminar block (Switch 480 kW, cluster class; Seminar 60 kW x (1 + 1.4 + 5.94) = 0.5 MW)")
    for sw, sem in ((20, 12), (10, 12), (32, 24)):
        P = sw * 0.48 + sem * 0.5
        T = field(np.zeros((n, n)), K, compute=sq(n, c, c, 1, 1, P))
        report(f"  {sem} Seminars + {sw} Switches in 1 chunk = {P:.1f} MW", T, {'block': (c, c)}, cls='cluster')
    print("\n== MODEL CARD: Frontier cluster 3.99 MW (accelerator class T* 25 C), alone in its chunk")
    for theta, tl in ((14, 'temperate'), (28, 'hot'), (-5, 'cold'), (17, 'spawn warm edge')):
        T = field(np.zeros((n, n)), K, compute=sq(n, c, c, 1, 1, 3.99), theta=theta)
        report(f"  frontier cluster, {tl}", T, {'cluster': (c, c)}, cls='accelerator')
    T = field(np.zeros((n, n)), K, compute=sq(n, c, c, 1, 1, 3.99), towers=sq(n, c, c, 1, 1, 10.0))
    report("  frontier cluster + 1 cooling tower, temperate", T, {'cluster': (c, c)}, cls='accelerator')
    T = field(np.zeros((n, n)), K, compute=sq(n, c, c, 1, 1, 3.99 + 40 * 0.4))
    report("  frontier cluster in a chunk with 40 Trainers (model-card checkpoints)", T, {'cluster': (c, c)}, cls='accelerator')
    print("\n== POWER PLANTS: nuclear 2x2 block (480 MW out, 960 MW emitted) over 2x2 chunks; 20-boiler plant (72 MW)")
    T = field(sq(n, c, c, 2, 2, 240.0), K, hours=3)
    row = ' '.join(f"{T[c, c + d]:.0f}" for d in range(0, 9))
    print(f"  nuclear 2x2, temperate: T along +x from the block (chunks 0..8): {row} C")
    for d in range(2, 12):
        if T[c, c + 1 + d] <= 25: print(f"  -> first chunk at <= 25 C (accelerator T*): {d} chunks beyond the block edge"); break
    for d in range(2, 12):
        if T[c, c + 1 + d] <= 35: print(f"  -> first chunk at <= 35 C (cluster T*): {d} chunks beyond the block edge"); break
    T = field(sq(n, c, c, 2, 1, 36.0), K, hours=3)
    row = ' '.join(f"{T[c, c + d]:.0f}" for d in range(0, 7))
    print(f"  20 boilers (72 MW) over 2 chunks: T along +x: {row} C")
    print("\n== TAKEOFF: Research halls (accelerator, T* 25 C)")
    for halls, tier_mw, w, h in ((20, 5, 2, 3), (20, 16, 2, 3), (100, 5, 5, 6)):
        P = halls * tier_mw
        ee = sq(n, c, c, w, h, P / (w * h))
        T = field(np.zeros((n, n)), K, compute=ee, hours=3)
        report(f"  {halls} halls x {tier_mw} MW = {P} MW over {w}x{h} chunks, air", T, {'centre': (c + w // 2, c + h // 2)}, cls='accelerator')
        T = field(np.zeros((n, n)), K, compute=ee * 0.1, hours=3)
        report(f"  ... 90% liquid, water exchangers off-site", T, {'centre': (c + w // 2, c + h // 2)}, cls='accelerator', liquid_bonus=15)

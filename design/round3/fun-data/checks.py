"""R3-fun evidence checks. Reuses F's exact heat update (round1/F-data/calib3.py) and the spec's numbers.
Run: gamedev-python /tmp/claude-1002/r3-fun/checks.py
"""
import math, random
import numpy as np

# ---------------------------------------------------------------- 1. heat: F's chunk rule (03 §1.2)
DT = 64 / 60; RATIO = 0.02; MIN = 15.0; C = 20.0

def field(emit, kappa, hours=2.0):
    n = emit.shape[0]
    H = np.zeros((n, n))
    for _ in range(int(hours * 3600 / DT)):
        H += emit * DT
        out = np.where(H >= MIN, RATIO * H, 0.0); H -= 4 * out
        H[1:, :] += out[:-1, :]; H[:-1, :] += out[1:, :]; H[:, 1:] += out[:, :-1]; H[:, :-1] += out[:, 1:]
        H -= (kappa * H + 0.002) * DT
        np.maximum(H, 0, out=H)
    return H / C

def sq(n, x, y, w, h, v):
    a = np.zeros((n, n)); a[y:y + h, x:x + w] = v; return a

n = 48; k = np.full((n, n), 0.005)
print("== 1. Heat around power plants (temperate ambient 14 C, grass kappa 0.005)")
cases = [
    ("1 reactor alone (40 MW out, 80 MW emitted), 1 chunk", sq(n, 24, 24, 1, 1, 80.0), k),
    ("2x2 reactor block (480 MW out, 960 MW emitted), 1 chunk", sq(n, 24, 24, 1, 1, 960.0), k),
    ("2x2 reactor block, emission spread over 2x2 chunks", sq(n, 24, 24, 2, 2, 240.0), k),
    ("40 boilers (72 MW electric, 144 MW emitted) over 2x2 chunks", sq(n, 24, 24, 2, 2, 36.0), k),
]
kw = k.copy(); kw[20:30, 20:30] = 0.02
cases.append(("2x2 reactor block on a lake (kappa 0.02 in a 10x10-chunk lake)", sq(n, 24, 24, 1, 1, 960.0), kw))
for name, e, kk in cases:
    dT = field(e, kk)
    row = dT[24, 24:36]
    print(f"  {name}")
    print("    dT by chunk distance east: " + ", ".join(f"{d}:{t:+.0f}K" for d, t in enumerate(row)))
    # distance at which an Accelerator-class machine (T* 25) at 14 C ambient keeps full speed (dT <= 11 K)
    ok = next((d for d, t in enumerate(row) if t <= 11), None)
    print(f"    first chunk east where a T*25 machine runs at 100%: {ok}")

# ---------------------------------------------------------------- 2. experiment loop (02 §7, 05 §7)
print("\n== 2. Experiment loop: machines at speed 1 for a given Article rate")
def loop(articles_per_min, t_analysis, t_meta, runs_per_experiment, meta=True, t_experiment=5.0, prose_per_benchmark_craft=30, benchmarks_per_craft=2):
    sig_per_s = articles_per_min / 60 / 2          # 1 significant result per 2 Articles
    runs_per_sig = 2.73 if meta else 20.0          # R2-D: 2.73 at steady state with Meta-analysis
    runs_per_s = sig_per_s * runs_per_sig
    experiments_per_s = runs_per_s / runs_per_experiment
    benchmarks_per_s = experiments_per_s           # 1 benchmark per experiment craft
    prose_per_s = benchmarks_per_s / benchmarks_per_craft * prose_per_benchmark_craft
    trainers_analysis = runs_per_s * t_analysis
    trainers_meta = sig_per_s * t_meta if meta else 0.0
    data_plants = experiments_per_s * t_experiment
    return dict(trainers_analysis=trainers_analysis, trainers_meta=trainers_meta, data_plants=data_plants,
                prose_per_s=prose_per_s, runs_per_s=runs_per_s)

for label, kw_ in (("CURRENT (Analysis 12 s, Meta 60 s, 1 run/experiment), with Meta-analysis", dict(t_analysis=12, t_meta=60, runs_per_experiment=1)),
                   ("CURRENT, before Meta-analysis", dict(t_analysis=12, t_meta=60, runs_per_experiment=1, meta=False)),
                   ("PROPOSED (Analysis 1.2 s, Meta 10 s, 2 runs/experiment), with Meta-analysis", dict(t_analysis=1.2, t_meta=10, runs_per_experiment=2)),
                   ("PROPOSED, before Meta-analysis", dict(t_analysis=1.2, t_meta=10, runs_per_experiment=2, meta=False))):
    for apm in (15, 60):
        r = loop(apm, **kw_)
        print(f"  {label} @ {apm} Articles/min: trainers Analysis {r['trainers_analysis']:.1f} + Meta {r['trainers_meta']:.1f}, "
              f"data plants {r['data_plants']:.1f}, prose {r['prose_per_s']:.1f}/s (Factorio sulfur slot: {apm/60/2*30/2:.1f} gas/s)")

print("\n  Bootstrap to the first 300 Articles (the Accelerators technology) plus the 40-result Meta-analysis seed, no meta during bootstrap:")
for label, t_an, rpe in (("CURRENT", 12, 1), ("PROPOSED", 1.2, 2)):
    sig_needed = 150 + 40
    runs = sig_needed * 20
    trainer_s = runs * t_an
    experiments = runs / rpe
    prose = experiments / 2 * 30
    crawl_basic = prose / 45 * 100
    print(f"    {label}: {runs:,} runs, {trainer_s/3600:.1f} trainer-hours (8 trainers: {trainer_s/8/60:.0f} min), "
          f"{prose:,.0f} prose = {crawl_basic:,.0f} crawl at Deduplication = {crawl_basic/10/3600:.1f} crawler-hours at 100% yield")

# ---------------------------------------------------------------- 3. hour-one geometry (01 §4, §5, §9)
print("\n== 3. Hour-one geometry: starting ore patches vs the college's coverage square (Monte Carlo of 01 §9 rules)")
random.seed(1)
N = 20000
inside_any = 0; dist_iron = []; dist_nearest = []
for _ in range(N):
    ang = random.uniform(0, 2 * math.pi)
    edge = random.uniform(40, 80)           # nearest town edge from spawn
    tc = (math.cos(ang) * (edge + 12), math.sin(ang) * (edge + 12))   # town centre (24x24 footprint)
    # campus 8x8 on the edge facing "the most buildable land": take the edge facing away from spawn with p=0.5, else a side edge
    side = random.choice(["away", "away", "left", "right"])
    ux, uy = math.cos(ang), math.sin(ang)
    if side == "away":
        cc = (tc[0] + ux * 8, tc[1] + uy * 8)
    elif side == "left":
        cc = (tc[0] - uy * 8, tc[1] + ux * 8)
    else:
        cc = (tc[0] + uy * 8, tc[1] - ux * 8)
    # coverage square: campus half-size 4 + R 48 = 52 (Chebyshev)
    R = 52
    patches = []
    for _p in range(4):
        d = random.uniform(30, 140); a = random.uniform(0, 2 * math.pi)
        patches.append((math.cos(a) * d, math.sin(a) * d))
    def cheb_dist(p):
        dx = max(0, abs(p[0] - cc[0]) - R); dy = max(0, abs(p[1] - cc[1]) - R)
        return math.hypot(dx, dy)
    ds = [cheb_dist(p) for p in patches]
    if min(ds) == 0:
        inside_any += 1
    dist_iron.append(ds[0]); dist_nearest.append(min(ds))
dist_iron.sort(); dist_nearest.sort()
print(f"  P(at least one of the 4 starting patches lies inside coverage): {inside_any/N:.0%}")
print(f"  Distance from the iron patch centre to the coverage square: median {dist_iron[N//2]:.0f} tiles, 90th pct {dist_iron[int(N*0.9)]:.0f}")
print(f"  Distance from the nearest patch to coverage: median {dist_nearest[N//2]:.0f}, 90th pct {dist_nearest[int(N*0.9)]:.0f}")

# ---------------------------------------------------------------- 4. staffing first binding (01 §8.1)
print("\n== 4. Staffing: when the starting college alone binds for a veteran's lab count")
def W_at(h):   # 01 §12.1 typical values, linear interpolation
    pts = [(0, 0), (1, 9), (3, 21), (6.1, 38), (8.3, 49), (10, 56), (12, 63), (13.3, 66)]
    for (a, wa), (b, wb) in zip(pts[:-1], pts[1:]):
        if a <= h <= b:
            return wa + (wb - wa) * (h - a) / (b - a)
    return 66
for h, labs in ((1, 10), (2, 14), (3, 20), (4.5, 24), (6, 30), (8, 40)):
    T = 8 * (1 + W_at(h) / 50)
    print(f"  {h:>4} h: {labs} Seminars, supply {T:.1f} -> satisfaction {min(1, T/labs):.0%}; throughput cap = {T:.1f} Seminar-equivalents x lab-speed bonus")

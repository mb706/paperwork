"""R2-W world dynamics calculator: W, j, sigma, staffing supply vs demand along E's pacing.

Assumptions (stated in 01-world.md / 03-pressure.md):
  - Literature year by game time: E's tier ends (1955 @0.3h, 1998 @6.1h, 2011 @8.3h,
    2018 @10h, 2023 @12h, 2024 @12.5h), linear in between; 1938 at t=0 (Switching circuits).
  - W: dW/dt = v0*gamma(W) + beta * dY_pub/dt, publication released over 10 min.
  - Staffing: T(W) = T0 * (1 + W/50); demand 1 per working Seminar.
  - Seminar demand along E's pacing: lab-seconds per tier / tier duration / (lab speed x boost).
"""
import math

V0 = 2.0
BETA = 0.5
LAG_S = 600.0

LIT = [(0.0, 1938), (0.3, 1955), (6.1, 1998), (8.3, 2011), (10.0, 2018), (12.0, 2023), (12.5, 2024), (99, 2024)]


def lit_year(t_h):
    for (t0, y0), (t1, y1) in zip(LIT[:-1], LIT[1:]):
        if t0 <= t_h <= t1:
            return y0 + (y1 - y0) * (t_h - t0) / (t1 - t0) if t1 > t0 else y1
    return LIT[-1][1]


def gamma(W, m=2.0, g=1.5):
    if W < 80:
        return 1.0
    return (m / g) ** ((min(W, 90) - 80) / 0.5) if W < 90 else 1.0


def j_of(W):
    if W <= 49:
        return 0.30
    if W <= 59:
        return 0.30 + 0.15 * (W - 49) / 10
    if W <= 67:
        return 0.45 + 0.10 * (W - 59) / 8
    return 0.55


def run_W(v0=V0, t_end_h=16.0, dt=10.0):
    W = 0.0
    Ypub = max(lit_year(0.0) - 1945, 0)
    pending = []  # (t_start, amount)
    out = []
    t = 0.0
    while t <= t_end_h * 3600:
        y = max(lit_year(t / 3600) - 1945, 0)
        if y > Ypub + 1e-9:
            pending.append((t, BETA * (y - Ypub)))
            Ypub = y
        rel = 0.0
        keep = []
        for (ts, amt) in pending:
            # linear release over LAG_S
            frac = min(dt, max(0.0, ts + LAG_S - t)) / LAG_S
            rel += amt * frac
            if t + dt < ts + LAG_S:
                keep.append((ts, amt))
        pending = keep
        W += v0 / 3600 * gamma(W) * dt + rel
        out.append((t / 3600, W, Ypub))
        t += dt
    return out


def at(series, th):
    best = min(series, key=lambda r: abs(r[0] - th))
    return best


# E's main-tree lab-seconds per tier (no Branch M) and tier windows (h)
TIERS = [
    ("red", 10175, 0.0, 0.3),
    ("green", 183450, 0.3, 6.1),
    ("blue", 217500, 6.1, 8.3),
    ("purple", 339000, 8.3, 10.0),
    ("yellow", 719250, 10.0, 12.0),
    ("white pre-closure (W02-W05)", 480000, 12.0, 13.3),
]
# lab speed multiplier (research speed techs) and seminar boost (modules, Switches) by tier
LABMULT = {"red": 1.0, "green": 1.25, "blue": 1.9, "purple": 2.5, "yellow": 3.2, "white pre-closure (W02-W05)": 3.5}
BOOST = {"red": 1.0, "green": 1.0, "blue": 1.0, "purple": 1.4, "yellow": 2.0, "white pre-closure (W02-W05)": 2.5}

if __name__ == "__main__":
    for v0 in (2.0, 2.9, 3.0):
        s = run_W(v0)
        print(f"v0={v0}:")
        for th in (0.5, 1, 3, 6.1, 8.3, 10, 12, 13.3, 14.1, 15, 16):
            t, W, Y = at(s, th)
            print(f"  t={th:5.1f} h  W={W:5.1f} (field {1945+int(W)})  Literature {1945+int(Y)}  j={j_of(W):.2f}  T-mult(1+W/50)={1+W/50:.2f}")
        # when W hits 70, 80, 90
        for target in (49, 59, 67, 70, 80, 90):
            hit = next((r for r in s if r[1] >= target), None)
            print(f"  W>={target}: t={hit[0]:.2f} h" if hit else f"  W>={target}: never by 16 h")
    print()
    s = run_W(2.0)
    print("Seminar demand along E's pacing vs staff from the starting college (T0=8):")
    for name, labs, t0, t1 in TIERS:
        dur = (t1 - t0) * 3600
        speed_units = labs / dur
        seminars = speed_units / (LABMULT[name] * BOOST[name])
        Wmid = at(s, (t0 + t1) / 2)[1]
        Wend = at(s, t1)[1]
        T = 8 * (1 + Wmid / 50)
        print(f"  {name:28s} {t0:4.1f}-{t1:4.1f} h  speed-1 seminars {speed_units:6.1f}  "
              f"seminars needed {seminars:5.1f}  start-college staff {T:5.1f}  (end {8*(1+Wend/50):.1f})")
    print()
    print("University supply T0*(1+W/50) at W=W(t):")
    for th in (1, 6.1, 8.3, 10, 12, 13.3):
        W = at(s, th)[1]
        f = 1 + W / 50
        print(f"  t={th:4.1f} h W={W:4.1f} x{f:.2f}: start 8 -> {8*f:.1f}; college 6 -> {6*f:.1f}; town 10 -> {10*f:.1f}; city 20 -> {20*f:.1f}; metro 40 -> {40*f:.1f}")
    print()
    # sigma: Feedback = Model cards / 3 + 100 per payload; a = 3e-4 per Feedback
    a = 3e-4
    for label, mc, runs in (("first run start (~12.5 h)", 5000, 1), ("closure (~13.3 h, 6 runs)", 13000, 6), ("closure, heavy deployment", 26000, 7)):
        fb = mc / 3 + 100 * runs
        Sig = a * fb
        sig = 0.9 * Sig / (1 + Sig)
        sig_wm = 0.9 * (Sig / 2) / (1 + Sig / 2)
        print(f"  {label}: Model cards {mc}, Feedback {fb:.0f}, Sigma {Sig:.2f}, sigma {sig:.2f} (with Watermarking all along {sig_wm:.2f})")

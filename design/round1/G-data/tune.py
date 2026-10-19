"""Grid search over the takeoff parameters against the experience targets."""
import itertools
import math
import sys
from dataclasses import replace

from takeoff import Params, simulate, summary, gen_doubling

OVERHANG = {   # halls running at closure; stockpiled cards; laid-out free slots; headroom MW
    "small":  dict(halls0=25,   cards0=500,  slots_free0=60,  P_head0=25,  Q_head0=25),
    "medium": dict(halls0=100,  cards0=1000, slots_free0=100, P_head0=50,  Q_head0=50),
    "large":  dict(halls0=400,  cards0=2000, slots_free0=150, P_head0=100, Q_head0=100),
    "huge":   dict(halls0=1500, cards0=4000, slots_free0=250, P_head0=200, Q_head0=200),
}


def run(base, overhang="medium", policy="greedy", **kw):
    p = replace(base, policy=policy, **OVERHANG[overhang], **kw)
    return simulate(p, log_every=5.0)


def dt_edges(res):
    d = gen_doubling(res)
    return (d[0][1] / 60 if d else math.nan), (d[-1][1] if d else math.nan)


def score(base, verbose=False):
    g = run(base)
    f = run(base, policy="frozen")
    nc = run(base, policy="no_cooling")
    npw = run(base, policy="no_power")
    sm = run(base, "small")
    lg = run(base, "large")
    hu = run(base, "huge")
    sg = summary(g)
    T = sg["t_end_min"]
    m = dict(
        greedy=T,
        frozen_ratio=summary(f)["t_end_min"] / T,
        last20=sg["last20_min"], last10=sg["last10_min"],
        small=summary(sm)["t_end_min"], large=summary(lg)["t_end_min"],
        huge=summary(hu)["t_end_min"],
        nocool=summary(nc)["t_end_min"] / T, nopow=summary(npw)["t_end_min"] / T,
    )
    d15, dend = dt_edges(g)
    m["dt15"] = d15
    m["dt_end_s"] = dend
    pen = 0.0
    pen += max(0, 40 - T) / 5 + max(0, T - 55) / 5
    pen += max(0, 1.8 - m["frozen_ratio"]) * 4
    pen += max(0, m["last20"] - 8) / 2
    pen += max(0, m["last10"] - 2)
    pen += max(0, 80 - m["small"]) / 20 + max(0, m["small"] - 150) / 20
    pen += max(0, m["huge"] - 10) / 2
    pen += max(0, 15 - m["large"]) / 5 + max(0, m["large"] - 25) / 5
    pen += max(0, 1.3 - m["nocool"]) * 3 + max(0, 1.3 - m["nopow"]) * 3
    m["pen"] = pen
    return m


if __name__ == "__main__":
    rows = []
    grid = dict(
        m=[1.8, 2.0, 2.2, 2.5],
        g=[1.3, 1.4, 1.5, 1.6],
        n_gen=[15, 20],
        C1=[1500, 2500, 4000],
    )
    keys = list(grid)
    for vals in itertools.product(*grid.values()):
        kw = dict(zip(keys, vals))
        if kw["m"] <= kw["g"]:
            continue
        base = Params(**kw)
        s = score(base)
        rows.append((s["pen"], kw, s))
    rows.sort(key=lambda x: x[0])
    for pen, kw, s in rows[:25]:
        r = math.log(kw["m"]) / math.log(kw["g"])
        print(f"pen={pen:6.2f} r={r:4.2f} {kw} " +
              " ".join(f"{k}={v:.2f}" for k, v in s.items() if k != "pen"))

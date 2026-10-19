"""Takeoff with the merged round-2 tree: E's post-closure techs + G's hardware techs (R2-D adds them).
Default order: one or two hardware techs after each of the first 12 Model generation levels."""
import math
from dataclasses import replace
import takeoff as T
import r2w_takeoff as R
from takeoff import Params, summary, GEN, PHYS, CAP, INF

ORDER = [  # (after MG level index j=1..), name, effect, cost = 0.15 * C(level j)
    (1, "Research scheduling", dict()),
    (1, "Two-phase cooling", dict(cool_task=2.0)),
    (2, "Wafer-scale integration", dict(tier=1)),
    (2, "Weight transplant", dict(transplant=True)),
    (3, "Fleet scheduling", dict(build=2.0)),
    (4, "Fusion power", dict(fusion=True)),
    (5, "Sparse inference", dict(pmult=0.75)),
    (6, "Photonic interconnect", dict(tier=2)),
    (7, "Microfluidic cooling", dict(cool_task=2.0)),
    (8, "Self-reproducing automata", dict(build=2.0, parallel=2)),
    (9, "Nanofabrication", dict(chain=2.0, chain_task=3.0)),
    (10, "Reversible logic", dict(tier=3)),
]


def tech_list(p):
    out = []
    for j in range(1, p.n_gen + 1):
        kind = CAP if j == p.n_gen else GEN
        out.append((f"Model generation {j + 5}", kind, p.C1 * p.g ** (j - 1), {}))
        if p.no_phys:
            continue
        for (jj, name, eff) in ORDER:
            if jj == j:
                out.append((name, PHYS, p.phi * p.C1 * p.g ** (j - 1), eff))
    if p.order == "gens_first":
        gens = [x for x in out if x[1] in (GEN, CAP)]
        phys = [x for x in out if x[1] == PHYS]
        cap = gens.pop()
        out = gens + phys + [cap]
    return out


R.tech_list = tech_list
T.tech_list = tech_list
T.apply_tech = R.patched_apply


def fmt(sec):
    return f"{sec:.1f} s" if sec < 90 else f"{sec/60:.1f} min"


def run(oh="medium", **kw):
    return R._simulate(replace(Params(), **R.OVERHANG[oh], **kw), 2.0)


if __name__ == "__main__":
    ref = run()
    s = summary(ref)
    print("REF", {k: (round(v, 2) if isinstance(v, float) else v) for k, v in s.items()})
    prev = 0.0
    for name, kind, t, cost in ref["done"]:
        print(f"| {name} | {cost:,.0f} | {t/60:.2f} | {fmt(t - prev)} |")
        prev = t
    print("doubling:")
    for name, t, dt, Rv in R.gen_doubling2(ref):
        print(f"  {name}: {fmt(dt)} R={Rv:.3g}")
    # best 10-min window tech count
    times = sorted(d[2] for d in ref["done"])
    best = max(sum(1 for x in times if a - 600 < x <= a) for a in times)
    print("best 10-min window techs:", best, "->", best * 6, "per hour")
    print("BRAKES")
    for pol in ["greedy", "slow", "no_cooling", "no_power", "autopilot", "frozen"]:
        ss = summary(run(policy=pol))
        print(f"  {pol:11s} {ss['t_end_min']:.1f} min ratio {ss['t_end_min']/s['t_end_min']:.2f} last20 {ss['last20_min']:.1f} last10 {ss['last10_min']*60:.0f}s bind {ss['bind']}")
    print("time share of builder tasks:", {k: round(v / sum(ref['task_time'].values()), 2) for k, v in ref['task_time'].items()})
    print("OVERHANG")
    for oh in ["small", "medium", "large", "huge"]:
        a = summary(run(oh)); f = summary(run(oh, policy="frozen"))
        print(f"  {oh}: active {a['t_end_min']:.1f}, no building {f['t_end_min']:.1f}")
    print("SWEEP")
    for h in [10, 25, 40, 60, 100, 160, 250, 400, 630, 1000, 1600, 4000]:
        kw = dict(halls0=h, cards0=int(5 * h), slots_free0=max(60, h // 2), P_head0=max(25.0, 0.5 * h), Q_head0=max(25.0, 0.5 * h))
        pa = replace(Params(), **kw)
        a = summary(R._simulate(pa, 5.0)); fz = summary(R._simulate(replace(pa, policy="frozen"), 5.0))
        print(f"  {h}: {a['t_end_min']:.1f} / {fz['t_end_min']:.1f}")
    print("RETURNS")
    for r in [0.8, 1.0, 1.2, 1.5, 1.71, 2.0, 2.5]:
        m = 1.5 ** r
        a = summary(run(m=m)); b = summary(run(m=m, order="gens_first")); f = summary(run(m=m, policy="frozen"))
        print(f"  r={r} m={m:.3f}: interleaved {a['t_end_min']:.1f}, gens-first {b['t_end_min']:.1f}, frozen {f['t_end_min']:.1f}, last20 {a['last20_min']:.1f}")
    print("HOLLOW")
    for h in [0.1, 0.2, 0.4, 0.5]:
        print(f"  h={h}: {summary(run(hollow=h))['t_end_min']:.1f}")
    print("NO HW:", round(summary(run(no_phys=True))['t_end_min'], 1))
    # post-victory: G's inf tech replaced by Energy per operation; just report R at end

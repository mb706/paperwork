"""R2-W: G's takeoff model re-run with the round-2 tree.

Changes against G's takeoff.py (round 1):
  - Hardware techs are E's (renamed per DECISIONS) plus the finale-gated
    blueprint deployer ("Self-directed construction", A's adopt list):
      Research scheduling (no sim effect), Wafer-scale integration (Accelerator 2),
      Weight transplant (in-place hall upgrade becomes possible),
      Fusion power, Photonic interconnect (Accelerator 3),
      Self-directed construction (build x2, two builds at once),
      Reversible logic (Accelerator 4).
    G's Two-phase cooling, Fleet scheduling, Sparse inference, Microfluidic
    cooling and Nanofabrication are not in E's tree and are dropped.
  - Upgrading halls in place only after Weight transplant.
  - The capstone is Model generation 25 itself (the 20th level); no separate capstone.
  - Costs: Model generation L = 2400 * 1.5^(L-6); hardware tech after level L = 0.15 * that.
"""
import math
import sys
from dataclasses import replace

import takeoff as T
from takeoff import Params, simulate, summary, gen_doubling, GEN, PHYS, CAP, INF

E_PHYS = [
    ("Research scheduling",        dict()),
    ("Wafer-scale integration",    dict(tier=1)),
    ("Weight transplant",          dict(transplant=True)),
    ("Fusion power",               dict(fusion=True)),
    ("Photonic interconnect",      dict(tier=2)),
    ("Self-directed construction", dict(build=2.0, parallel=2)),
    ("Reversible logic",           dict(tier=3)),
]

_orig_apply = T.apply_tech


def apply_tech(kind, eff, st, p):
    if eff.get("transplant"):
        st.transplant = True
    _orig_apply(kind, eff, st, p)


def tech_list(p):
    gens = [(f"Model generation {j + 5}", GEN, p.C1 * p.g ** (j - 1), {}) for j in range(1, p.n_gen + 1)]
    phys = [] if p.no_phys else list(E_PHYS)
    out = []
    if p.order == "gens_first":
        out = list(gens)
        for k, (name, eff) in enumerate(phys):
            j = min(k + 1, p.n_gen)
            out.append((name, PHYS, p.phi * p.C1 * p.g ** (j - 1), eff))
    else:
        k = 0
        for j, gt in enumerate(gens, start=1):
            out.append(gt)
            if k < len(phys):
                name, eff = phys[k]
                out.append((name, PHYS, p.phi * p.C1 * p.g ** (j - 1), eff))
                k += 1
    # the last Model generation is the capstone: mark it
    for i in range(len(out) - 1, -1, -1):
        if out[i][1] == GEN:
            name, kind, cost, eff = out[i]
            out[i] = (name, CAP, cost, eff)
            # CAP must also count as a generation for G
            break
    return out


def patched_apply(kind, eff, st, p):
    if kind == CAP:
        st.G += 1
        return
    apply_tech(kind, eff, st, p)


# simulate() upgrades halls if p.upgrade; we gate it on st.transplant by wrapping the state
_orig_init = T.init_state


def init_state(p):
    st = _orig_init(p)
    st.transplant = False
    return st


def simulate_r2(p, log_every=2.0):
    T.tech_list = tech_list
    T.apply_tech = patched_apply
    T.init_state = init_state
    # gate the in-place upgrade on Weight transplant: emulate by toggling p.upgrade per step
    # simplest: run G's loop with a custom copy (see below)
    return _simulate(p, log_every)


def _simulate(p, log_every):
    st = init_state(p)
    techs = tech_list(p)
    n_main = len(techs)
    done, log = [], []
    next_log = 0.0
    t = 0.0
    t_cap = None

    def current_tech():
        if st.tech_i < n_main:
            return techs[st.tech_i]
        if t_cap is not None and p.post_t > 0:
            return T.inf_tech(p, st.post_L + 1)
        return None

    while t < p.max_t:
        if t_cap is not None and t >= t_cap + p.post_t:
            break
        R, W, u, bind, D = T.rates(st, p)
        if t >= next_log:
            log.append(T._snap(t, st, p))
            next_log += log_every
        rem = p.dt
        while rem > 1e-12:
            tech = current_tech()
            if tech is None:
                break
            name, kind, cost, eff = tech
            need = cost - st.progress
            if R > 0 and R * rem >= need:
                tau = need / R
                rem -= tau
                st.progress = 0.0
                patched_apply(kind, eff, st, p)
                if kind != INF:
                    st.tech_i += 1
                tc = t + (p.dt - rem)
                done.append((name, kind, tc, cost))
                if kind == CAP:
                    t_cap = tc
                R, W, u, bind, D = T.rates(st, p)
            else:
                st.progress += R * rem
                rem = 0.0
        if t_cap is not None and p.post_t <= 0:
            break
        if p.policy != "frozen":
            st.cards += st.A_rate / 60.0 * p.dt
            while st.cards >= p.cards_per_hall:
                old_k = next((k for k in range(st.tier) if st.halls[k] > 0), None)
                if p.upgrade and st.transplant and old_k is not None:
                    st.halls[old_k] -= 1
                    st.halls[st.tier] += 1
                elif st.slots_free >= 1:
                    st.slots_free -= 1
                    st.halls[st.tier] += 1
                else:
                    break
                st.cards -= p.cards_per_hall
        for task in list(st.tasks):
            task[1] -= p.dt
            st.task_time[task[0]] = st.task_time.get(task[0], 0.0) + p.dt
            if task[1] <= 0:
                T.finish_task(task, st, p)
                st.tasks.remove(task)
        while len(st.tasks) < st.parallel:
            k = T.choose_task(st, p, [x[0] for x in st.tasks])
            if k is None:
                break
            T.start_task(k, st, p)
        t += p.dt
    log.append(T._snap(t, st, p))
    return dict(done=done, log=log, finished=t_cap is not None, task_time=st.task_time,
                t_end=t_cap if t_cap is not None else math.inf, params=p, techs=techs)


def gen_doubling2(res):
    import bisect
    log = res["log"]
    ts = [x["t"] for x in log]
    out = []
    prev_t, prev_R = 0.0, log[0]["R"]
    for name, kind, t, cost in res["done"]:
        if kind not in (GEN, CAP):
            continue
        i = bisect.bisect_left(ts, t)
        R_after = log[min(i, len(log) - 1)]["R"]
        if R_after > prev_R and t > prev_t:
            out.append((name, t, (t - prev_t) * math.log(2) / math.log(R_after / prev_R), R_after))
        prev_t, prev_R = t, R_after
    return out


OVERHANG = {
    "small":  dict(halls0=25,   cards0=500,  slots_free0=60,  P_head0=25,  Q_head0=25),
    "medium": dict(halls0=100,  cards0=1000, slots_free0=100, P_head0=50,  Q_head0=50),
    "large":  dict(halls0=400,  cards0=2000, slots_free0=150, P_head0=100, Q_head0=100),
    "huge":   dict(halls0=1500, cards0=4000, slots_free0=250, P_head0=200, Q_head0=200),
}


def run(overhang="medium", **kw):
    p = replace(Params(), **OVERHANG[overhang], **kw)
    return _simulate(p, 2.0)


def fmt(sec):
    if sec < 90:
        return f"{sec:.1f} s"
    return f"{sec/60:.1f} min"


if __name__ == "__main__":
    T.tech_list = tech_list
    T.apply_tech = patched_apply
    ref = run()
    s = summary(ref)
    print("REFERENCE (100 halls, active, r=1.71):", {k: (round(v, 2) if isinstance(v, float) else v) for k, v in s.items()})
    print()
    print("| Tech | Cost (units) | Done at (min) | Took |")
    prev = 0.0
    for name, kind, t, cost in ref["done"]:
        print(f"| {name} | {cost:,.0f} | {t/60:.2f} | {fmt(t - prev)} |")
        prev = t
    print()
    print("doubling per generation:")
    for name, t, dt, R in gen_doubling2(ref):
        print(f"  {name}: {fmt(dt)}  R={R:.3g}")
    print()
    print("BRAKES:")
    for pol in ["greedy", "slow", "no_cooling", "no_power", "autopilot", "frozen"]:
        r = run(policy=pol)
        ss = summary(r)
        print(f"  {pol:11s} takeoff {ss['t_end_min']:.1f} min  ratio {ss['t_end_min']/s['t_end_min']:.2f}  last20 {ss['last20_min']:.1f} min  last10 {ss['last10_min']*60:.0f} s  bind {ss['bind']}")
    print()
    print("OVERHANG:")
    for oh in ["small", "medium", "large", "huge"]:
        a = summary(run(oh))
        f = summary(run(oh, policy="frozen"))
        print(f"  {oh:6s} active {a['t_end_min']:.1f} min, no building {f['t_end_min']:.1f} min")
    print()
    print("SWEEP halls -> active / no-building:")
    for h in [10, 25, 40, 60, 100, 160, 250, 400, 630, 1000, 1600, 4000]:
        kw = dict(halls0=h, cards0=int(5 * h), slots_free0=max(60, h // 2), P_head0=max(25.0, 0.1 * 5 * h), Q_head0=max(25.0, 0.1 * 5 * h))
        pa = replace(Params(), **kw)
        a = summary(_simulate(pa, 5.0))
        fz = summary(_simulate(replace(pa, policy="frozen"), 5.0))
        print(f"  {h:5d}: {a['t_end_min']:.1f} / {fz['t_end_min']:.1f}")
    print()
    print("RETURNS r (g=1.5):")
    for r in [0.8, 1.0, 1.2, 1.5, 1.71, 2.0, 2.5]:
        m = 1.5 ** r
        a = summary(run(m=m))
        b = summary(run(m=m, order="gens_first"))
        f = summary(run(m=m, policy="frozen"))
        print(f"  r={r:.2f} m={m:.3f}: interleaved {a['t_end_min']:.1f}, gens-first {b['t_end_min']:.1f}, no building {f['t_end_min']:.1f}, last20 {a['last20_min']:.1f}")
    print()
    print("HOLLOW WORK:")
    for h in [0.0, 0.1, 0.2, 0.4, 0.5]:
        a = summary(run(hollow=h))
        print(f"  h={h}: {a['t_end_min']:.1f} min")
    print()
    print("NO HARDWARE TECHS:", summary(run(no_phys=True))["t_end_min"])

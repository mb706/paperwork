"""R1-G takeoff model: the late game as a production process the game simulates.

Aggregate of per-entity rules the game would run:
  - Universities (pre-placed, crafting speed 1, no modules, no bonuses) and Compute
    halls loaded with weights craft Frontier papers with the same recipe.
  - Labs turn papers into research units; every Generation multiplies research per
    paper by m (global, retroactive, like Factorio's research bonuses).
  - Halls draw power as interruptible load and emit heat equal to it;
    utilisation u = min(1, P_avail / D, Q_eff / D).
  - The player is a builder working one task at a time (two after
    Self-directed construction).
  - After the capstone, Generation N+ continues as an infinite tech with r < 1.

Units: time s, power MW, research in tech units, papers per s.
"""
from __future__ import annotations

import bisect
import math
from dataclasses import dataclass, field

GEN, PHYS, CAP, INF = "gen", "phys", "cap", "inf"

# Physical techs of the takeoff segment, in default research order.
PHYS_TECHS = [
    ("Two-phase cooling",          dict(cool_task=2.0)),
    ("Accelerator 2",              dict(tier=1)),
    ("Fleet scheduling",           dict(build=2.0)),
    ("Fusion power",               dict(fusion=True)),
    ("Sparse inference",           dict(pmult=0.75)),
    ("Accelerator 3",              dict(tier=2)),
    ("Microfluidic cooling",       dict(cool_task=2.0)),
    ("Deployer",                   dict(build=2.0, parallel=2)),
    ("Nanofabrication",            dict(chain=2.0, chain_task=3.0)),
    ("Accelerator 4",              dict(tier=3)),
    ("Reversible logic",           dict(pmult=0.5)),
]


@dataclass
class Params:
    # ---- research production -------------------------------------------
    m: float = 2.0            # research-per-paper multiplier per Generation
    g: float = 1.5            # cost growth per Generation (r = ln m / ln g)
    C1: float = 2400.0        # units for Generation 1
    n_gen: int = 20
    phi: float = 0.15         # physical tech cost / cost of the Generation before it
    cap_mult: float = 1.0     # capstone = cap_mult * C1 * g**n_gen
    T_paper: float = 60.0     # s per Frontier paper at crafting speed 1
    n_univ: int = 0           # cards written by towns (0 under R1-B: towns staff seminars instead)
    # ---- compute halls: (crafting speed, MW at full load) by tier ----------
    hall_tiers: tuple = ((1.0, 5.0), (3.0, 8.0), (8.0, 12.0), (20.0, 16.0))
    cards_per_hall: int = 20
    # ---- state at loop closure (the overhang) ----------------------------
    halls0: int = 100
    P_base: float = 800.0     # non-compute load, MW
    P_head0: float = 50.0     # generation beyond P_base + halls0 demand
    Q_head0: float = 50.0     # cooling beyond halls0 heat
    slots_free0: int = 100
    cards0: int = 1000
    A_rate0: float = 60.0     # accelerator cards per minute
    L_cap0: float = 3.0       # papers/s the labs can consume (at least 1.25x closure flow)
    # ---- player tasks: (base seconds, capacity added) --------------------
    task_power: tuple = (480.0, 480.0)        # nuclear 2x2: 8 min, +480 MW
    task_power_fusion: tuple = (480.0, 2400.0)
    task_cool: tuple = (300.0, 400.0)          # cooling block: 5 min, +400 MW
    task_chain: tuple = (600.0, 40.0)          # +40 cards/min
    task_slots: tuple = (180.0, 100)
    task_labs: tuple = (180.0, 5.0)
    heat_floor: float = 0.5   # R1-F: throttling never goes below 50 % speed
    hollow: float = 0.0       # R1-F hollow work: share of cards wasted by AI-staffed seminars
    policy: str = "greedy"    # greedy | frozen | autopilot | no_cooling | no_power | slow
    horizon: float = 360.0
    headroom: float = 1.10
    order: str = "interleaved"  # interleaved | gens_first
    phys_every: int = 1
    upgrade: bool = True        # new card tiers upgrade existing halls first (upgrade planner)
    no_phys: bool = False       # drop all physical techs (ablation)
    # ---- after victory ---------------------------------------------------
    post_t: float = 0.0       # s to keep simulating after the capstone
    post_m: float = 1.1       # Generation N+ effect per level
    post_g: float = 2.0       # Generation N+ cost growth per level
    max_t: float = 10 * 3600.0
    dt: float = 1.0


def tech_list(p: Params):
    """Takeoff tree in research order: (name, kind, cost, effect)."""
    gens = [(f"Generation {j}", GEN, p.C1 * p.g ** (j - 1), {}) for j in range(1, p.n_gen + 1)]
    phys = [] if p.no_phys else list(PHYS_TECHS)
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
            if j % p.phys_every == 0 and k < len(phys):
                name, eff = phys[k]
                out.append((name, PHYS, p.phi * p.C1 * p.g ** (j - 1), eff))
                k += 1
    out.append(("Capstone", CAP, p.cap_mult * p.C1 * p.g ** p.n_gen, {}))
    return out


def inf_tech(p: Params, L: int):
    return (f"Generation {p.n_gen}+{L}", INF, p.C1 * p.g ** p.n_gen * p.post_g ** L, {})


@dataclass
class State:
    G: int = 0
    halls: list = field(default_factory=lambda: [0, 0, 0, 0])
    tier: int = 0
    slots_free: float = 0.0
    cards: float = 0.0
    A_rate: float = 0.0
    P_gen: float = 0.0
    Q_eff: float = 0.0
    cool_task_mult: float = 1.0
    pmult: float = 1.0
    L_cap: float = 0.0
    b: float = 1.0
    parallel: int = 1
    fusion: bool = False
    chain_task_mult: float = 1.0
    tasks: list = field(default_factory=list)
    tech_i: int = 0
    progress: float = 0.0
    task_time: dict = field(default_factory=dict)
    post_L: int = 0
    post_mult: float = 1.0


def hall_demand(st, p):
    return st.pmult * sum(n * p.hall_tiers[k][1] for k, n in enumerate(st.halls))


def hall_speed(st, p):
    return sum(n * p.hall_tiers[k][0] for k, n in enumerate(st.halls))


def rates(st, p):
    """(R units/s, W cards/s, u, binding label, D MW).
    Power: compute is interruptible load, u_p = min(1, P_avail/D).
    Heat (R1-F): throttle m = clamp(1 - (T - T*)/50 K, 0.5, 1); in aggregate T - T* = 50 K x
    the uncooled share of the heat actually emitted, so m = clamp(Q/(u_p D), floor, 1).
    Throttled machines keep drawing power (pure loss)."""
    D = hall_demand(st, p)
    P_avail = max(0.0, st.P_gen - p.P_base)
    if D > 0:
        up = min(1.0, P_avail / D)
        emitted = max(up * D, 1e-9)
        mh = max(p.heat_floor, min(1.0, st.Q_eff / emitted))
        u = up * mh
    else:
        up = mh = u = 1.0
    W = u * hall_speed(st, p) / p.T_paper + p.n_univ / p.T_paper
    W = W * (1.0 - p.hollow)
    W_used = min(W, st.L_cap)
    R = W_used * p.m ** st.G * st.post_mult
    if up < 1.0 - 1e-9 and up <= mh:
        bind = "power"
    elif mh < 1.0 - 1e-9:
        bind = "cooling"
    elif W > st.L_cap + 1e-9:
        bind = "labs"
    else:
        bind = "compute"
    return R, W, u, bind, D


def init_state(p):
    st = State()
    st.halls = [p.halls0, 0, 0, 0]
    st.slots_free = p.slots_free0
    st.cards = p.cards0
    st.A_rate = p.A_rate0
    D0 = p.halls0 * p.hall_tiers[0][1]
    st.P_gen = p.P_base + D0 + p.P_head0
    st.Q_eff = D0 + p.Q_head0
    W0 = (p.halls0 * p.hall_tiers[0][0] + p.n_univ) / p.T_paper
    st.L_cap = max(p.L_cap0, 1.25 * W0)
    return st


def apply_tech(kind, eff, st, p):
    if kind == GEN:
        st.G += 1
        return
    if kind == INF:
        st.post_mult *= p.post_m
        st.post_L += 1
        return
    if "cool_task" in eff:
        st.cool_task_mult *= eff["cool_task"]
    if "tier" in eff:
        st.tier = max(st.tier, eff["tier"])
    if "build" in eff:
        st.b *= eff["build"]
    if "parallel" in eff:
        st.parallel = eff["parallel"]
    if eff.get("fusion"):
        st.fusion = True
    if "pmult" in eff:
        st.pmult *= eff["pmult"]
    if "chain" in eff:
        st.A_rate *= eff["chain"]
    if "chain_task" in eff:
        st.chain_task_mult *= eff["chain_task"]


def choose_task(st, p, busy):
    """Greedy builder: the resource with the highest projected pressure, else grow compute."""
    if p.policy in ("frozen", "autopilot"):
        return None
    R, W, u, bind, D = rates(st, p)
    halls_per_s = st.A_rate / 60.0 / p.cards_per_hall
    dD = halls_per_s * st.pmult * p.hall_tiers[st.tier][1]
    dW = halls_per_s * p.hall_tiers[st.tier][0] / p.T_paper
    P_avail = st.P_gen - p.P_base
    allowed = {"power", "cool", "chain", "slots", "labs"}
    if p.policy == "no_cooling":
        allowed.discard("cool")
    if p.policy == "no_power":
        allowed.discard("power")
    allowed -= set(busy)
    H = p.horizon
    D_h = D + dD * H
    W_full = hall_speed(st, p) / p.T_paper + p.n_univ / p.T_paper
    W_h = W_full + dW * H
    eps = 1e-9
    cands = {
        "power": p.headroom * D_h / max(P_avail, eps),
        "cool": p.headroom * D_h / max(st.Q_eff, eps),
        "slots": (st.cards / p.cards_per_hall + halls_per_s * H) / max(st.slots_free, eps),
        "labs": p.headroom * W_h / max(st.L_cap, eps),
    }
    cands = {k: v for k, v in cands.items() if k in allowed}
    if cands:
        k = max(cands, key=cands.get)
        if cands[k] >= 1.0:
            return k
    return "chain" if "chain" in allowed else None


def start_task(kind, st, p):
    if kind == "power":
        base, amt = p.task_power_fusion if st.fusion else p.task_power
    elif kind == "cool":
        base, amt = p.task_cool
        amt *= st.cool_task_mult
    elif kind == "chain":
        base, amt = p.task_chain
        amt *= st.chain_task_mult
    elif kind == "slots":
        base, amt = p.task_slots
    elif kind == "labs":
        base, amt = p.task_labs
    else:
        raise ValueError(kind)
    slow = 2.0 if p.policy == "slow" else 1.0
    st.tasks.append([kind, base * slow / st.b, amt])


def finish_task(task, st, p):
    kind, _, amt = task
    if kind == "power":
        st.P_gen += amt
    elif kind == "cool":
        st.Q_eff += amt
    elif kind == "chain":
        st.A_rate += amt
    elif kind == "slots":
        st.slots_free += amt
    elif kind == "labs":
        st.L_cap += amt


def _snap(t, st, p):
    R, W, u, bind, D = rates(st, p)
    return dict(t=t, R=R, W=W, u=u, bind=bind, D=D, G=st.G,
                halls=sum(st.halls), halls_by_tier=list(st.halls), speed=hall_speed(st, p),
                P_avail=st.P_gen - p.P_base, Q=st.Q_eff,
                A_rate=st.A_rate, L_cap=st.L_cap, tech_i=st.tech_i,
                busy=",".join(x[0] for x in st.tasks))


def simulate(p: Params, log_every: float = 2.0):
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
            return inf_tech(p, st.post_L + 1)
        return None

    while t < p.max_t:
        if t_cap is not None and t >= t_cap + p.post_t:
            break
        R, W, u, bind, D = rates(st, p)
        if t >= next_log:
            log.append(_snap(t, st, p))
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
                apply_tech(kind, eff, st, p)
                if kind != INF:
                    st.tech_i += 1
                tc = t + (p.dt - rem)
                done.append((name, kind, tc, cost))
                if kind == CAP:
                    t_cap = tc
                R, W, u, bind, D = rates(st, p)
            else:
                st.progress += R * rem
                rem = 0.0
        if t_cap is not None and p.post_t <= 0:
            break
        if p.policy != "frozen":
            st.cards += st.A_rate / 60.0 * p.dt
            while st.cards >= p.cards_per_hall:
                old_k = next((k for k in range(st.tier) if st.halls[k] > 0), None)
                if p.upgrade and old_k is not None:
                    st.halls[old_k] -= 1          # upgrade planner: replace oldest cards in place
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
                finish_task(task, st, p)
                st.tasks.remove(task)
        while len(st.tasks) < st.parallel:
            k = choose_task(st, p, [x[0] for x in st.tasks])
            if k is None:
                break
            start_task(k, st, p)
        t += p.dt
    log.append(_snap(t, st, p))
    return dict(done=done, log=log, finished=t_cap is not None, task_time=st.task_time,
                t_end=t_cap if t_cap is not None else math.inf, params=p, techs=techs)


def gen_doubling(res):
    """Doubling time of R across each Generation interval:
    (t_j - t_{j-1}) * ln2 / ln(R_j / R_{j-1}), R sampled right after each completion."""
    log = res["log"]
    ts = [x["t"] for x in log]
    out = []
    prev_t, prev_R = 0.0, log[0]["R"]
    for name, kind, t, cost in res["done"]:
        if kind != GEN:
            continue
        i = bisect.bisect_left(ts, t)
        R_after = log[min(i, len(log) - 1)]["R"]
        if R_after > prev_R and t > prev_t:
            out.append((t, (t - prev_t) * math.log(2) / math.log(R_after / prev_R), R_after))
        prev_t, prev_R = t, R_after
    return out


def summary(res):
    done = [d for d in res["done"] if d[1] != INF]
    t_end = res["t_end"]
    times = [d[2] for d in done]
    n = len(times)

    def span_last(k):
        return (t_end - times[n - k - 1]) / 60 if n > k else math.nan
    log = [x for x in res["log"] if x["t"] <= t_end]
    bind_share = {}
    for a, b in zip(log[:-1], log[1:]):
        bind_share[a["bind"]] = bind_share.get(a["bind"], 0) + (b["t"] - a["t"])
    tot = sum(bind_share.values()) or 1
    return dict(n_techs=n, t_end_min=t_end / 60, last20_min=span_last(20),
                last10_min=span_last(10), R0=res["log"][0]["R"],
                R_end=log[-1]["R"] if log else math.nan,
                halls_end=log[-1]["halls"] if log else 0,
                P_end=log[-1]["P_avail"] if log else 0,
                bind={k: round(v / tot, 2) for k, v in bind_share.items()})


if __name__ == "__main__":
    for pol in ["frozen", "autopilot", "greedy", "slow", "no_cooling", "no_power"]:
        r = simulate(Params(policy=pol))
        s = summary(r)
        print(f"{pol:11s}", {k: (round(v, 2) if isinstance(v, float) else v) for k, v in s.items()})
    r = simulate(Params(post_t=3600), log_every=5)
    print("post:", summary(r)["t_end_min"], r["done"][-3:], r["log"][-1]["R"])

"""Whole-game arc: stylized pre-loop pacing, the talent plateau, the overhang it
produces, the takeoff (takeoff.simulate), the field's frontier line, and after-victory.

Pre-loop numbers are ASSUMPTIONS standing in for R1-E's tree (Factorio-like pacing
for an experienced player); the takeoff is the simulated part.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, replace

from takeoff import Params, simulate, GEN, CAP, INF


@dataclass
class Prelude:
    """Pre-loop pacing (ASSUMPTION standing in for R1-E's tree): research is factory-bound
    (Factorio-like, doubling every T_d) until town staff caps the seminars (R1-B L9);
    then it grows only as universities are claimed and the world level W rises."""
    R_a: float = 0.04            # material research rate at t=0 (units/s)
    T_d_h: float = 2.0           # its doubling time while factory-bound (h)
    k: float = 1.0235            # cost growth per tech (~15 techs/h at the factory-bound pace)
    c0: float = 9.55             # first tech's cost (units)
    n_pre: int = 192             # techs before the loop closes
    t_bind_h: float = 11.0       # staffing starts to bind
    staff_growth_per_h: float = 0.08   # capped research grows 8 %/h (claims + W)
    halls_at_bind: int = 30      # accelerator halls already running other recipes at t_bind
    hall_rate_pre: float = 0.6   # halls/min added during the plateau (typical player)
    launch_delay_min: float = 0.0
    n_univ: int = 6              # universities claimed by closure


def factory_rate(t_s, pre: Prelude):
    return pre.R_a * 2 ** (t_s / (pre.T_d_h * 3600))


def capped_rate(t_s, pre: Prelude):
    tb = pre.t_bind_h * 3600
    if t_s <= tb:
        return factory_rate(t_s, pre)
    return factory_rate(tb, pre) * (1 + pre.staff_growth_per_h * (t_s - tb) / 3600)


def material_techs(pre: Prelude, dt=10.0):
    """Completion times of the pre-loop techs at min(factory, staff) rate."""
    out, t, i, prog = [], 0.0, 0, 0.0
    trace = []
    while i < pre.n_pre:
        r = capped_rate(t, pre)
        prog += r * dt
        t += dt
        if int(t) % 300 == 0:
            trace.append((t, r, factory_rate(t, pre)))
        cost = pre.c0 * pre.k ** i
        while prog >= cost and i < pre.n_pre:
            prog -= cost
            out.append((f"T{i+1}", "pre" if t <= pre.t_bind_h * 3600 else "capped", t, cost))
            i += 1
            cost = pre.c0 * pre.k ** i
    return out, trace


def overhang_params(halls0: int, base: Params, nU: int) -> Params:
    """Closure state for a given number of halls: stock and space scale with it."""
    return replace(base, halls0=halls0, cards0=int(5 * halls0), slots_free0=max(60, halls0 // 2),
                   P_head0=max(25.0, 0.1 * 5 * halls0), Q_head0=max(25.0, 0.1 * 5 * halls0))


def whole_game(pre: Prelude = Prelude(), base: Params = Params(), post_t: float = 0.0):
    mats, trace = material_techs(pre)
    t_close = mats[-1][2] + pre.launch_delay_min * 60
    tb = pre.t_bind_h * 3600
    halls0 = int(round(pre.halls_at_bind + pre.hall_rate_pre * max(0.0, t_close - tb) / 60))
    p = replace(overhang_params(halls0, base, pre.n_univ), post_t=post_t)
    res = simulate(p, log_every=2.0)
    return dict(pre=pre, mats=mats, whites=[], t_close=t_close, halls0=halls0,
                nU=pre.n_univ, trace=trace, takeoff=res)


# ---------------------------------------------------------------------------
# The field's frontier line (hook for R1-C section 5)
# dF/dt = v0 * gamma(F) + beta * dY_pub/dt
#   F: field-years since 1945; Y_pub: the player's year from *published* (material-pack)
#   techs; Frontier papers are internal and do not leak.
#   gamma(F) = 1 below F_auto, then (m/g)^((F - F_auto)/y_gen): the field's own takeoff.
# ---------------------------------------------------------------------------
@dataclass
class Field:
    v0_per_h: float = 2.0     # field-years per hour of play, before its own takeoff
    beta: float = 0.5         # field-years gained per year you publish
    F_auto: float = 80.0      # 2025: the field's loop can close
    y_gen: float = 0.5        # field-years per field generation
    m: float = 2.0
    g: float = 1.5
    F_cap: float = 90.0       # 2035 = the field's Generation 20 (its capstone)


def field_line(game, fld: Field = Field(), t_end_s=None):
    """Integrate F(t). Player year: published techs spread 1945 -> 2025 over material techs."""
    mats = game["mats"]
    n = len(mats)
    years = {i: 80.0 * (i + 1) / n for i in range(len(mats))}
    t_mat = [m[2] for m in mats]
    Y_pub_at = lambda t: 80.0 * sum(1 for x in t_mat if x <= t) / n
    t_end_s = t_end_s or (game["t_close"] + 20 * 3600)
    F, t, dt = 0.0, 0.0, 30.0
    out = []
    Yprev = 0.0
    t_auto = t_fcap = None
    while t <= t_end_s:
        Y = Y_pub_at(t)
        dY = (Y - Yprev)
        Yprev = Y
        gamma = 1.0 if F < fld.F_auto else (fld.m / fld.g) ** ((F - fld.F_auto) / fld.y_gen)
        F += fld.v0_per_h / 3600 * gamma * dt + fld.beta * dY
        if t_auto is None and F >= fld.F_auto:
            t_auto = t
        if t_fcap is None and F >= fld.F_cap:
            t_fcap = t
            out.append((t, F, Y))
            break
        out.append((t, F, Y))
        t += dt
    return out, t_auto, t_fcap

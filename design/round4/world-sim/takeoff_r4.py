"""R4-world: the takeoff re-simulated for round 4 (04-endgame §0, §4–§7; 03 §3.2, §4).

G's model (round2/W-sim/takeoff.py, unchanged) with R2-W's round-2 tree (r2w_full.py), and the
round-4 rules:
  - DECISIONS §23c: takeoff technologies take 60 s per unit. Seminar capacity is counted in System
    cards per second, so 60 s per unit halves what each Seminar consumes.
  - §23: Seminar capacity at closure = human staff x lab speed 3.5 / 60 s. Reference closure state:
    the starting college plus one college linked by Terminal, 2 x 12 + 2 x 8 = 40 staff at
    T = T0 x min(2, 1 + 0.08 W) (at its ceiling of 2 at closure under round 4's 1 + W/25 too), so 2.33 cards/s. Researchers are the builder's 'labs' task:
    180 s for +2.5 cards/s (round 2's 180 s for +5 at 30 s per unit). G's floor (capacity >=
    1.25 x the closure flow) is kept for the overhang sweep: a player who stocks a big overhang
    also prepares Researcher Seminars (Automated research unlocks both).
  - §25: halls take no modules and no Switch effects (G's model never had them).
  - §30: Nanofabrication +100% on the base accelerator only (G's chain = 2.0, unchanged).
  - Hollow work (03 §4) applies only to the Researcher-staffed share of Seminar work.
  - Dennard scaling does not apply to the Accelerator class (03 §1.4), so hall power is G's.
Run: gamedev-python design/round4/world-sim/takeoff_r4.py   (from /home/mewse/browsergame)
"""
import math
import os
import sys
from dataclasses import replace

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'round2', 'W-sim'))

import takeoff as T  # noqa: E402
import r2w_takeoff as R  # noqa: E402
import r2w_full as F  # noqa: E402

T.tech_list = F.tech_list
T.apply_tech = R.patched_apply

UNIT_S = 60.0
LAB_SPEED = 3.5
STAFF_REF = 2 * 12 + 2 * 8            # starting college + one Terminal-linked college at the x2 cap
HUMAN_REF = STAFF_REF * LAB_SPEED / UNIT_S
LABS_TASK = (180.0, 2.5)
HOLLOW = {'h': 0.0}                   # hollow share on Researcher-staffed Seminars

_orig_rates = T.rates


def rates(st, p):
    """G's rates with hollow work on the Researcher share only: human capacity first."""
    D = T.hall_demand(st, p)
    P_avail = max(0.0, st.P_gen - p.P_base)
    if D > 0:
        up = min(1.0, P_avail / D)
        emitted = max(up * D, 1e-9)
        mh = max(p.heat_floor, min(1.0, st.Q_eff / emitted))
        u = up * mh
    else:
        up = mh = u = 1.0
    W = u * T.hall_speed(st, p) / p.T_paper + p.n_univ / p.T_paper
    Lh = min(getattr(st, 'L_human', st.L_cap), st.L_cap)
    used_h = min(W, Lh)
    used_r = max(0.0, min(W, st.L_cap) - Lh)
    R_ = (used_h + used_r * (1.0 - HOLLOW['h'])) * p.m ** st.G * st.post_mult
    if up < 1.0 - 1e-9 and up <= mh:
        bind = 'power'
    elif mh < 1.0 - 1e-9:
        bind = 'cooling'
    elif W > st.L_cap + 1e-9:
        bind = 'labs'
    else:
        bind = 'compute'
    return R_, W, u, bind, D


T.rates = rates


def run(oh='medium', human=HUMAN_REF, researchers=True, floor=False, hollow=0.0, labs_task=LABS_TASK, **kw):
    p = replace(T.Params(), **(R.OVERHANG[oh] if isinstance(oh, str) else oh), **kw)
    p = replace(p, task_labs=labs_task if researchers else (180.0, 0.0))
    orig = R.init_state

    def init_state(pp):
        st = orig(pp)
        W0 = pp.halls0 * pp.hall_tiers[0][0] / pp.T_paper
        st.L_human = human
        st.L_cap = max(human, 1.25 * W0) if (floor and researchers) else human
        return st
    R.init_state = init_state
    HOLLOW['h'] = hollow
    try:
        res = R._simulate(p, 2.0)
    finally:
        R.init_state = orig
        HOLLOW['h'] = 0.0
    return res


def fmt(sec):
    return f'{sec:.1f} s' if sec < 90 else f'{sec / 60:.1f} min'


def leak(res, human=HUMAN_REF, boost=2.5):
    """Hall-hours and Researcher-Seminar-hours (tier 4) from the log; Researcher Seminars =
    (capacity above human) x 60 s / (lab speed 3.5 x boost)."""
    log = res['log']
    hh = sh = 0.0
    for a, b in zip(log[:-1], log[1:]):
        dt = (b['t'] - a['t']) / 3600
        hh += a['halls'] * dt
        sh += max(0.0, a['L_cap'] - human) * UNIT_S / (LAB_SPEED * boost) * dt
    return hh, sh


if __name__ == '__main__':
    print(f'Reference closure: {STAFF_REF} staff x {LAB_SPEED} / {UNIT_S:.0f} s = {HUMAN_REF:.2f} cards/s of human Seminar capacity')
    ref = run()
    s = T.summary(ref)
    print('REF', {k: (round(v, 2) if isinstance(v, float) else v) for k, v in s.items()})
    prev = 0.0
    for name, kind, t, cost in ref['done']:
        print(f'| {name} | {cost:,.0f} | {t / 60:.2f} | {fmt(t - prev)} |')
        prev = t
    print('doubling per level:')
    for name, t, dt, Rv in R.gen_doubling2(ref):
        print(f'  {name}: {fmt(dt)}')
    times = sorted(d[2] for d in ref['done'])
    best = max(sum(1 for x in times if a - 600 < x <= a) for a in times)
    print('best 10-min window:', best, '->', best * 6, 'per hour')
    tt = ref['task_time']; tot = sum(tt.values())
    print('builder time shares:', {k: round(v / tot, 2) for k, v in tt.items()})
    print('Seminar capacity at end (cards/s):', round(ref['log'][-1]['L_cap'], 2), ' halls at end:', ref['log'][-1]['halls'],
          ' by tier', ref['log'][-1]['halls_by_tier'], ' compute MW at end', round(ref['log'][-1]['D'], 0))
    print('\nRESEARCHERS (reference closure state):')
    for lab, human in (('start college only (24 staff)', 24 * LAB_SPEED / UNIT_S), ('reference (40 staff)', HUMAN_REF),
                       ('+ a second college (56 staff)', 56 * LAB_SPEED / UNIT_S), ('+ college + town (64 staff)', 64 * LAB_SPEED / UNIT_S),
                       ('+ 2 colleges + town (80 staff)', 80 * LAB_SPEED / UNIT_S)):
        a = T.summary(run(human=human)); b = T.summary(run(human=human, researchers=False))
        print(f'  {lab:32s} human {human:4.2f}/s: with Researchers {a["t_end_min"]:5.1f} min, without {b["t_end_min"]:5.1f} min (bind {b["bind"]})')
    print('\nBRAKES:')
    for pol in ['greedy', 'slow', 'no_cooling', 'no_power', 'autopilot', 'frozen']:
        ss = T.summary(run(policy=pol))
        print(f'  {pol:11s} {ss["t_end_min"]:.1f} min ratio {ss["t_end_min"] / s["t_end_min"]:.2f} last20 {ss["last20_min"]:.1f} last10 {ss["last10_min"] * 60:.0f}s bind {ss["bind"]}')
    print('\nOVERHANG (named states, G floor on Seminars):')
    for oh in ['small', 'medium', 'large', 'huge']:
        a = T.summary(run(oh, floor=True)); f = T.summary(run(oh, floor=True, policy='frozen'))
        print(f'  {oh}: active {a["t_end_min"]:.1f}, no building {f["t_end_min"]:.1f}')
    print('SWEEP halls -> active / no building:')
    for h in [10, 25, 40, 60, 100, 160, 250, 400, 630, 1000, 1600, 4000]:
        kw = dict(halls0=h, cards0=int(5 * h), slots_free0=max(60, h // 2), P_head0=max(25.0, 0.5 * h), Q_head0=max(25.0, 0.5 * h))
        a = T.summary(run(kw, floor=True)); fz = T.summary(run(kw, floor=True, policy='frozen'))
        print(f'  {h}: {a["t_end_min"]:.1f} / {fz["t_end_min"]:.1f}')
    print('\nRETURNS:')
    for r in [1.2, 1.71, 2.0]:
        m = 1.5 ** r
        a = T.summary(run(m=m)); b = T.summary(run(m=m, order='gens_first')); f = T.summary(run(m=m, policy='frozen'))
        print(f'  r={r} m={m:.3f}: interleaved {a["t_end_min"]:.1f}, gens-first {b["t_end_min"]:.1f}, no building {f["t_end_min"]:.1f}, last20 {a["last20_min"]:.1f}')
    print('\nHOLLOW (Researcher share only):')
    for h in [0.1, 0.2, 0.4, 0.5]:
        print(f'  h={h}: {T.summary(run(hollow=h))["t_end_min"]:.1f}')
    print('NO HARDWARE TECHS:', round(T.summary(run(no_phys=True))['t_end_min'], 1))
    print('\nLEAK (tier 4; 0.01/h x 4 x (1 - v) x (1 - 0.2 n_ver)):')
    for oh in ['small', 'medium', 'large', 'huge']:
        res = run(oh, floor=True)
        hh, sh = leak(res)
        for lab, v, n in (('Standard, n_ver 0', 0, 0), ('Standard, n_ver 3', 0, 3), ('Verified, n_ver 2', 0.5, 2), ('Audited, n_ver 4', 0.75, 4)):
            k = 0.01 * 4 * (1 - v) * (1 - 0.2 * n)
            print(f'  {oh:6s} {res["t_end"] / 60:5.1f} min, hall-h {hh:6.1f}, Researcher-Seminar-h {sh:5.1f} | {lab}: {k * (hh + sh):.2f} compromises')

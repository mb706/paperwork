"""R4-world: staffing retune (DECISIONS §23) on balance's competent-player model, plus the takeoff
with and without Researchers at 60 s per takeoff unit.

Pre-closure pacing reuses round3/balance-data/pacing.py (research lists, Y_pub publication model,
linear competent factory calibrated to Factorio 2.0's red..yellow tree at 6/8/12 h). Changes:
  - demand rule of §23a: a Seminar's staff demand = its speed multiplier from modules and Switches
    (lab-speed research is free), so the research cap is  staff x L  (L = 1 + lab-speed bonuses);
  - supply T = T0 x g(W) with a parametrised g;
  - claims: (time, T0) pairs; a Terminal claim may start no earlier than Time-sharing + delay.
Takeoff reuses round2/W-sim (G's takeoff.py through r2w_full/r2w_takeoff), with Seminar capacity at
closure = human staff x L / 60 s (no floor), and Researchers as the builder's "labs" task.

Round 5 (R5-gate, R5-play item 1): the adopted supply law is read from the data
(meta.staffing.supply: T = T0 x min(max_multiplier, 1 + per_field_year x W)); per_field_year went from
0.04 (round 4, 1 + W/25) to 0.08 (1 + W/12.5), so supply reaches its ceiling at W = 12.5. Round 4's
law stays in the comparison rows. The round-4 output is kept as staffing_r4.out.orig.

Run: gamedev-python design/round4/world-sim/staffing_r4.py   (from /home/mewse/browsergame)
"""
import math
import os
import sys
from dataclasses import replace

HERE = os.path.dirname(os.path.abspath(__file__))
BAL = os.path.join(HERE, '..', '..', 'round3', 'balance-data')
WSIM = os.path.join(HERE, '..', '..', 'round2', 'W-sim')
sys.path.insert(0, BAL)
sys.path.insert(0, WSIM)

from pacing import factorio_list, research_order, linear, COPRO  # noqa: E402
from pacing import our_list as _our_list_balance  # noqa: E402
import yaml  # noqa: E402

DATA = os.path.join(HERE, '..', '..', 'spec', 'data')


def our_list():
    """balance's research list, with each technology's publication year taken as round 4 defines it
    (01 §12.1, DECISIONS §35): the latest year in its structured `citation`, for `regime: cited` only.
    (balance's loader read a top-level `year` field, which the round-4 data no longer has.)"""
    techs = {t['id']: t for t in yaml.safe_load(open(os.path.join(DATA, 'technologies.yaml')))}
    out = _our_list_balance()
    for x in out:
        t = techs[x['id']]
        cit = t.get('citation')
        cits = cit if isinstance(cit, list) else ([cit] if isinstance(cit, dict) else [])
        years = [c['year'] for c in cits if isinstance(c, dict) and c.get('year')]
        if t.get('year'):
            years.append(t['year'])
        x['year'] = max(years) if years and t.get('regime', 'cited') == 'cited' else None
    # A technology gated behind a higher-tier prerequisite is researched in that tier (Game theory sits
    # behind Paraphrase generation, so it is a blue-gated Report-pack tech; R4-data, 05 Objection 2).
    order = ['memo', 'report', 'article', 'preprint', 'model-card', 'system-card']
    byid = {x['id']: x for x in out}
    memo = {}

    def eff(i):
        if i in memo:
            return memo[i]
        x = byid.get(i)
        if x is None:
            return 0
        memo[i] = order.index(x['tier'])
        memo[i] = max([memo[i]] + [eff(p) for p in x['pre']])
        return memo[i]
    for x in out:
        x['tier'] = order[eff(x['id'])]
    return out
import takeoff as T  # noqa: E402
import r2w_takeoff as R  # noqa: E402
import r2w_full as F  # noqa: E402

T.tech_list = F.tech_list
T.apply_tech = R.patched_apply

T0 = {'starting-college': 12, 'college-town': 8, 'town': 12, 'city': 24, 'metropolis': 48}


# ---------------------------------------------------------------- supply laws g(W)
def g_old(W):            # round 2: 1 + W/50
    return 1 + W / 50


def g_fun(W):            # FUN-02: 1 + W/25 to W 40, then 2.6 + (W-40)/50
    return 1 + W / 25 if W <= 40 else 2.6 + (W - 40) / 50


def g_sat(W, cap=2.0, w0=20.0):   # saturating: cap - (cap-1) e^(-W/w0)
    return cap - (cap - 1) * math.exp(-W / w0)


def g_knee(W, slope1=1 / 25, knee=25, slope2=1 / 100):  # piecewise: fast to the knee, then slow
    return 1 + slope1 * W if W <= knee else 1 + slope1 * knee + slope2 * (W - knee)


def g_cap(cap, slope=1 / 25):   # round 4's law with cap = 2.0: T0 x min(cap, 1 + W/25)
    return lambda W: min(cap, 1 + slope * W)


_SUPPLY = yaml.safe_load(open(os.path.join(DATA, 'meta.yaml')))['staffing']['supply']


def g_data(W):            # ADOPTED (01 §8.1), read from meta.staffing.supply (0.08 per field-year since round 5)
    return min(_SUPPLY['max_multiplier'], 1 + _SUPPLY['per_field_year'] * W)


# ---------------------------------------------------------------- pre-closure pacing
def simulate(lst, Ffac, g, unis, switch_n=8, v0=2.0, beta=0.5, dt=10.0, module_delay_h=0.25,
             t_max_h=40, terminal=None):
    """unis: [(t_h, T0)] fixed claims; terminal: [(delay_h after Time-sharing, T0)] claims."""
    order = research_order(lst)
    t = 0.0; W = 0.0; Ypub = 0.0; pending = []
    L = 1.0
    i = 0; prog = 0.0
    tier_end = {}; trace = []; researched_at = {}
    claims = list(unis)
    added_terminal = False
    while i < len(order) and t < t_max_h * 3600:
        th = t / 3600
        if terminal and not added_terminal and 'time-sharing' in researched_at:
            claims += [(researched_at['time-sharing'] + d, t0) for d, t0 in terminal]
            added_terminal = True
        staff = sum(t0 * g(W) for (tc, t0) in claims if th >= tc)
        cap = staff * L                       # hard rule: boosts raise demand as much as speed
        f = Ffac(th)
        Rr = min(f, cap)
        bound = 'staff' if cap < f else 'factory'
        if int(t) % 600 == 0:
            trace.append(dict(t=th, W=W, staff=staff, L=L, F=f, cap=cap, R=Rr, sat=min(1.0, cap / f), bound=bound))
        prog += Rr * dt
        while i < len(order) and prog >= order[i]['ls']:
            prog -= order[i]['ls']
            x = order[i]
            researched_at[x['id']] = th
            L += x['lab']
            if x['year']:
                y = x['year'] - 1945
                if y > Ypub:
                    pending.append((t, beta * (y - Ypub))); Ypub = y
            tier_end[x['tier']] = th
            i += 1
        rel = 0.0; keep = []
        for (ts, amt) in pending:
            rel += amt * min(dt, max(0.0, ts + 600 - t)) / 600
            if t + dt < ts + 600:
                keep.append((ts, amt))
        pending = keep
        W += v0 / 3600 * dt + rel
        t += dt
    return tier_end, trace, researched_at, claims


# ---------------------------------------------------------------- takeoff at 60 s per unit
def takeoff(L_cap, researchers=True, unit_s=60.0, oh='medium', labs_task=(180.0, 2.5), **kw):
    """L_cap: human Seminar capacity at closure in System cards per second (no floor).
    Researchers: the builder's 'labs' task adds Researcher-staffed Seminar capacity
    (labs_task = (seconds, +cards/s)); at 60 s per unit half of round 2's (180 s, +5)."""
    p = replace(T.Params(), **R.OVERHANG[oh], **kw)
    p = replace(p, L_cap0=L_cap, task_labs=labs_task if researchers else (180.0, 0.0))
    orig = R.init_state

    def init_state(pp):
        st = orig(pp)
        st.L_cap = L_cap          # no 1.25 x W0 floor: capacity is what staff provides
        return st
    R.init_state = init_state
    try:
        res = R._simulate(p, 2.0)
    finally:
        R.init_state = orig
    return T.summary(res), res


def human_capacity(staff, L=3.5, unit_s=60.0):
    return staff * L / unit_s


if __name__ == '__main__':
    fl = factorio_list(); ol = our_list(); tot = sum(x['ls'] for x in fl)
    # The adopted law (01 §8.1) is the data's: T = T0 x min(2, 1 + 0.08 W) since round 5. Neighbours for
    # comparison: round 4's 1 + W/25, round 2's 1 + W/50, FUN-02's two-slope law, and lower caps.
    adopted = f"ADOPTED min({_SUPPLY['max_multiplier']:g},1+{_SUPPLY['per_field_year']:g}W)"
    laws = {adopted: g_data, 'round 4: min(2,1+W/25)': g_cap(2.0), 'min(1.8,1+W/25)': g_cap(1.8),
            'min(1.75,1+W/25)': g_cap(1.75), 'round 2: 1+W/50': g_old, 'FUN-02 two-slope': g_fun,
            'saturating 2-e^(-W/20)': g_sat}
    S, C, TW = T0['starting-college'], T0['college-town'], T0['town']
    for hours in (6.0, 8.0, 12.0):
        k = 2 * tot / (hours * hours * 3600)
        te0, _, ra0, _ = simulate(ol, linear(k), g_old, [(0.0, 1e9)])
        t_term = max(ra0['time-sharing'], ra0['packet-switching']) + 0.3   # Terminals need data lines
        print(f'\n######## {hours:.0f}-h competent profile; uncapped tier ends',
              {a: round(b, 2) for a, b in te0.items()}, f' Terminal link at {t_term:.2f} h')
        scen = (('no claim', [(0.0, S)]), ('+college by Terminal', [(0.0, S), (t_term, C)]),
                ('+2 colleges', [(0.0, S), (t_term, C), (t_term + 1.0, C)]),
                ('+college +town', [(0.0, S), (t_term, C), (t_term + 1.5, TW)]))
        for lname, g in laws.items():
            for sname, unis in scen:
                te, tr, ra, claims = simulate(ol, linear(k), g, unis)
                sb = [x for x in tr if x['bound'] == 'staff']
                at = lambda h: min(tr, key=lambda r: abs(r['t'] - h))
                sats = ' '.join(f"{h}:{at(h)['sat'] * 100:3.0f}" for h in (1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11))
                staff_c = sum(t0 for _, t0 in claims) * g(70)
                d = {a: round(te[a] - te0[a], 2) for a in te}
                print(f"  {lname:24s} {sname:20s} | 1 h staff {at(1)['staff']:4.1f} | sat% {sats} | bound {len(sb) * 600 / 3600:3.1f} h"
                      f" | later: R{d['report']} A{d['article']} P{d['preprint']} Y{d['model-card']} W{d['system-card']}"
                      f" | closure staff {staff_c:4.0f} -> {human_capacity(staff_c):.2f} cards/s")
    print('\n######## Takeoff (60 s per unit) against human Seminar capacity at closure (takeoff_r4.py has the reference)')
    for cap in (1.4, 1.7, 2.0, 2.3, 2.6, 3.0, 3.5, 4.0, 5.0, 6.0):
        a, _ = takeoff(cap, True)
        b, _ = takeoff(cap, False)
        print(f'  human {cap:4.1f} cards/s (staff {cap * 60 / 3.5:5.1f}): with Researchers {a["t_end_min"]:5.1f} min, without {b["t_end_min"]:5.1f} min')

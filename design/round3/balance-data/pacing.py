"""R3 balance: pacing to each tier, and the staffing cap T(W) against a competent player's factory.

Model
  research rate (lab-equivalents, i.e. speed-1 lab-seconds per second)
      R(t) = min( F(t), CAP(t) )
  F(t)   factory-limited rate of a competent Factorio veteran: linear ramp k*t, k calibrated so that
         Factorio 2.0's whole red..yellow non-military finite tree (1.32 M lab-s) is done at 8.0 h
         (E's 2-h-doubling curve is kept as a second profile, 'E-pace').
  CAP(t) = sum over claimed universities of T0*(1+W/50)  x  L(t) x B(t)       (soft rule, 01 §8.3)
         = same with B = 1                                                     (hard rule, R2-W's option)
  L(t)   1 + researched laboratory-speed bonuses
  B(t)   1 + 2 x best Coprocessor speed + Switch effect 1.5*sqrt(n)*2*s (n Switches per Seminar), s = best module
  W(t)   = W + v0/3600 dt + 0.5 x rise in Y_pub (released over 600 s)
Research order: tier by tier (memo..model-card), all non-M finite techs of the tier, topologically;
then the white pre-closure techs (Chain of thought, Self-play, Test-time compute, Automated research).
"""
import json, math, collections, sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
EDATA = os.path.join(HERE, '..', '..', 'round1', 'E-data')
from load import techs as OUR, T as OT
from tiers import tier_of, labsec

ORDER = ['memo', 'report', 'article', 'preprint', 'model-card', 'system-card']
WHITE_PRE = ['chain-of-thought', 'self-play', 'test-time-compute', 'automated-research']

def our_list():
    out = []
    for t in OUR:
        if not t.get('cost') or t.get('max_level') == 'infinite':
            continue
        tr = tier_of(t)
        if '+M' in tr or tr == 'proceedings':
            continue
        if tr == 'system-card' and t['id'] not in WHITE_PRE:
            continue
        ls = labsec(t)
        eff = (t.get('unlocks') or {}).get('effects') or []
        lab = sum(e.get('value', 0) for e in eff if e['type'] == 'laboratory-speed')
        rad = [e.get('value', e.get('multiplier')) for e in eff if e['type'] == 'staffing-radius']
        out.append(dict(id=t['id'], pre=[p for p in t.get('prerequisites') or []], ls=ls, tier=tr,
                        year=t.get('year'), lab=lab, unlock=(t.get('unlocks') or {}).get('recipes') or []))
    return out

def factorio_list():
    d = json.load(open(os.path.join(EDATA, 'tech2077.json'))) + \
        json.load(open(os.path.join(EDATA, 'techq.json')))
    ab = {"automation-science-pack": "memo", "logistic-science-pack": "report", "military-science-pack": "M",
          "chemical-science-pack": "article", "production-science-pack": "preprint", "utility-science-pack": "model-card",
          "space-science-pack": "system-card"}
    out = []
    for t in d:
        u = t.get('unit')
        if not u or t.get('max_level') == 'infinite' or 'count' not in u:
            continue
        ing = [ab[x[0]] for x in u['ingredients']]
        if 'M' in ing or 'system-card' in ing:
            continue
        hi = max(ing, key=ORDER.index)
        lab = sum(e.get('modifier', 0) for e in t.get('effects', []) if e.get('type') == 'laboratory-speed')
        out.append(dict(id=t['name'], pre=t.get('prerequisites', []), ls=u['count'] * u['time'], tier=hi,
                        year=None, lab=lab, unlock=[e.get('recipe') for e in t.get('effects', []) if e.get('type') == 'unlock-recipe']))
    return out

def research_order(lst):
    ids = {x['id'] for x in lst}
    byid = {x['id']: x for x in lst}
    done, order = set(), []
    def add(x):
        if x['id'] in done: return
        for p in x['pre']:
            if p in byid: add(byid[p])
        done.add(x['id']); order.append(x)
    for tr in ORDER:
        for x in lst:
            if x['tier'] == tr: add(x)
    return order

# module data
COPRO = {'pipelining': 0.2, 'vector-processing': 0.3, 'systolic-arrays': 0.5}

def simulate(lst, F, rule='soft', unis=((0.0, 8),), switch_n=8, v0=2.0, beta=0.5, dt=10.0, cap_on=True,
             module_delay_h=0.25, t_max_h=40):
    order = research_order(lst)
    t = 0.0; W = 0.0; Ypub = 0.0; pending = []
    L = 1.0; best_mod = 0.0; switch = False
    i = 0; prog = 0.0
    tier_end = {}; trace = []
    researched_at = {}
    while i < len(order) and t < t_max_h * 3600:
        th = t / 3600
        # boosts (installed after a delay)
        best_mod = max([COPRO[k] for k in COPRO if k in researched_at and researched_at[k] + module_delay_h <= th] + [0])
        switch = 'data-parallelism' in researched_at and researched_at['data-parallelism'] + module_delay_h <= th
        B = 1 + 2 * best_mod
        if switch:
            B += 1.5 * math.sqrt(switch_n) * 2 * best_mod
        staff = sum(T0 * (1 + W / 50) for (t0, T0) in unis if th >= t0)
        cap = staff * L * (B if rule == 'soft' else 1.0)
        f = F(th)
        R = min(f, cap) if cap_on else f
        bound = 'staff' if (cap_on and cap < f) else 'factory'
        if int(t) % 600 == 0:
            trace.append((th, W, staff, L, B, f, cap, R, bound))
        prog += R * dt
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
            if t + dt < ts + 600: keep.append((ts, amt))
        pending = keep
        W += v0 / 3600 * dt + rel
        t += dt
    return tier_end, trace, researched_at

def linear(k):
    return lambda th: max(k * th, 0.5)

def epace(th):  # E's assumption: exponential, 2 h doubling, white tier at 12 h (G's prelude R_a=0.04 units/s ~ 0.4 lab-eq)
    return 2.0 * 2 ** (th / 2.0)

if __name__ == '__main__':
    fl = factorio_list(); ol = our_list()
    tot = sum(x['ls'] for x in fl)
    print('Factorio R..Y non-M finite lab-s', tot, ' ours R..Y non-M + white pre-closure', sum(x['ls'] for x in ol))
    # calibrate k: Factorio whole tree at 8 h
    k = 2 * tot / (8 * 8 * 3600)
    print(f'k = {k:.2f} lab-equivalents per hour')
    te, tr, _ = simulate(fl, linear(k), cap_on=False)
    print('Factorio competent (uncapped):', {a: round(b, 2) for a, b in te.items()})
    te, tr, _ = simulate(ol, linear(k), cap_on=False)
    print('Ours, same factory, no staffing:', {a: round(b, 2) for a, b in te.items()})
    for rule in ('soft', 'hard'):
        for label, unis in (('start college only', ((0, 8),)),
                            ('+college at 2 h', ((0, 8), (2.0, 6))),
                            ('+college 2 h +town 4 h', ((0, 8), (2.0, 6), (4.0, 10))),
                            ('+college 2 h +town 4 h +town 6 h', ((0, 8), (2.0, 6), (4.0, 10), (6.0, 10)))):
            te, tr, ra = simulate(ol, linear(k), rule=rule, unis=unis)
            staffb = sum(1 for x in tr if x[8] == 'staff') * 600 / 3600
            print(f'{rule:4s} {label:34s}', {a: round(b, 2) for a, b in te.items()}, f'staff-bound {staffb:.1f} h')
    print('\nTrace, soft rule, starting college only (t, W, staff, L, B, F, CAP, R, bound):')
    te, tr, ra = simulate(ol, linear(k), rule='soft')
    for row in tr[::3]:
        print('  ' + ' '.join(f'{v:7.2f}' if isinstance(v, float) else str(v) for v in row))
    print('\nTrace, hard rule, starting college only:')
    te, tr, ra = simulate(ol, linear(k), rule='hard')
    for row in tr[::3]:
        print('  ' + ' '.join(f'{v:7.2f}' if isinstance(v, float) else str(v) for v in row))
    print('\nE-pace profile (2-h doubling), soft, start college only:')
    te, tr, ra = simulate(ol, epace, rule='soft')
    print({a: round(b, 2) for a, b in te.items()}, 'staff-bound h', sum(1 for x in tr if x[8] == 'staff') * 600 / 3600)
    te, tr, ra = simulate(ol, epace, cap_on=False)
    print('E-pace uncapped', {a: round(b, 2) for a, b in te.items()})

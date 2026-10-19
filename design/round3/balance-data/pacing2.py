import math
from pacing import *
fl = factorio_list(); ol = our_list()
tot = sum(x['ls'] for x in fl)
def sim(rule, unis, k, **kw):
    # rule: soft | hard | noswitch
    if rule == 'noswitch':
        te, tr, ra = simulate(ol, linear(k), rule='soft', unis=unis, switch_n=0, **kw)
    else:
        te, tr, ra = simulate(ol, linear(k), rule=rule, unis=unis, **kw)
    sb = [x for x in tr if x[8] == 'staff']
    return te, tr, sum(1 for _ in sb) * 600 / 3600, (min(x[0] for x in sb) if sb else None), (max(x[0] for x in sb) if sb else None)
for hours in (6.0, 8.0, 12.0):
    k = 2 * tot / (hours * hours * 3600)
    print(f'\n### profile: Factorio R..Y at {hours} h  (k = {k:.1f} lab-eq/h)')
    te, _, _ = simulate(fl, linear(k), cap_on=False)
    print('  Factorio uncapped     ', {a: round(b, 2) for a, b in te.items()})
    te, _, _ = simulate(ol, linear(k), cap_on=False)
    print('  ours uncapped         ', {a: round(b, 2) for a, b in te.items()})
    for rule in ('soft', 'noswitch', 'hard'):
        for label, unis in (('start', ((0, 8),)), ('+college@2h', ((0, 8), (2.0, 6))), ('+college@2h+town@4h', ((0, 8), (2.0, 6), (4.0, 10)))):
            te, tr, sbh, s0, s1 = sim(rule, unis, k)
            print(f'  {rule:8s} {label:20s}', {a: round(b, 2) for a, b in te.items()}, f'| staff-bound {sbh:.1f} h ({s0}–{s1})')

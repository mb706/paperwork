from pacing import *
fl = factorio_list(); ol = our_list(); tot = sum(x['ls'] for x in fl)
print("profile | rule | T0 | claims | tier ends (h) | staff-bound h")
for hours in (6.0, 8.0, 12.0):
    k = 2 * tot / (hours * hours * 3600)
    te, _, _ = simulate(ol, linear(k), cap_on=False)
    print(f"{hours:4.0f}-h  uncapped                     ", {a: round(b, 2) for a, b in te.items()})
    for rule, sw, T0, claims in (('soft', 8, 8, ()), ('soft', 8, 8, ((2.0, 6),)), ('H3', 0, 12, ()), ('H3', 0, 12, ((3.0, 6),)), ('hard', 8, 12, ()), ('hard', 8, 12, ((3.0, 6),))):
        unis = ((0, T0),) + claims
        te, tr, ra = simulate(ol, linear(k), rule='hard' if rule == 'hard' else 'soft', unis=unis, switch_n=sw)
        sb = [x for x in tr if x[8] == 'staff']
        print(f"{hours:4.0f}-h  {rule:4s} T0={T0:2d} claims={len(claims)}        ", {a: round(b, 2) for a, b in te.items()}, f"| {len(sb)*600/3600:.1f} h" + (f" ({sb[0][0]:.1f}-{sb[-1][0]:.1f})" if sb else ''))

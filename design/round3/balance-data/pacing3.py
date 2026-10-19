from pacing import *
fl = factorio_list(); ol = our_list(); tot = sum(x['ls'] for x in fl)
k = 2 * tot / (8 * 8 * 3600)
for T0 in (8, 10, 12, 16):
    for rule, sw in (('soft', 8), ('noswitch', 0), ('hard', 8)):
        te, tr, ra = simulate(ol, linear(k), rule='soft' if rule != 'hard' else 'hard', unis=((0, T0),), switch_n=sw)
        sb = [x for x in tr if x[8] == 'staff']
        sat3 = [x for x in tr if abs(x[0] - 3.0) < 1e-6][0]
        print(f"T0={T0:2d} {rule:8s} green end {te['report']:.2f} h, yellow end {te['model-card']:.2f}, white {te['system-card']:.2f} | staff-bound {len(sb)*600/3600:.1f} h | at 3 h: cap {sat3[6]:.0f} vs factory {sat3[5]:.0f} lab-eq")
# hour-one block satisfaction
for T0 in (8, 10, 12):
    te, tr, ra = simulate(ol, linear(k), unis=((0, T0),))
    r1 = [x for x in tr if abs(x[0] - 1.0) < 1e-6][0]
    print(f"T0={T0}: at 1 h W={r1[1]:.1f}, staff {r1[2]:.1f} -> 10-Seminar block {min(1, r1[2]/10)*100:.0f}%")

"""Experiment loop variants: machines and power per 1 Article/s (LP), against Factorio's blue."""
import copy
import lines as Lm
from lines import solve, machines, mining, OUR_MACH, OUR_W, OUR_RAW_MINE, our_recipe_table, factorio_recipe_table, F_W, F_MACH, F_RAW_MINE, fmt

def variant(times=None, article=None, forbid=()):
    OT = our_recipe_table(forbid=forbid)
    for rid, t in (times or {}).items():
        if rid in OT: OT[rid]['time'] = t
    if article:
        OT['article'] = article
    return OT

FT = factorio_recipe_table(forbid=('basic-oil-processing', 'coal-liquefaction'))
frec, fimp, _ = solve(FT, {'chemical-science-pack': 1}, F_W)
fm, fel, fbu, _ = machines(FT, frec, F_MACH)
print(f"Factorio blue: {sum(fm.values()):.0f} machines, {fel:.1f} MW electric; sulfur chem plants {frec.get('sulfur',0)*1/1:.2f}")
A4 = dict(cat='crafting', time=48, net={'engine-unit': -4, 'processor': -6, 'significant-result': -1, 'article': 4})
cases = [
    ('as data (12 s / 60 s / 5 s)', {}, None),
    ('R2-D knob: Analysis 1.2 s', {'analysis': 1.2}, None),
    ('Analysis 1.2, Meta 6, Experiment 0.5', {'analysis': 1.2, 'meta-analysis': 6, 'experiment': 0.5}, None),
    ('Analysis 2, Meta 12, Experiment 1', {'analysis': 2, 'meta-analysis': 12, 'experiment': 1}, None),
    ('1 SR per 4 Articles (4E+6P+1SR->4, 48 s)', {}, A4),
    ('1 SR per 4 Articles + Analysis 6 s, Meta 30 s', {'analysis': 6, 'meta-analysis': 30}, A4),
]
print(f"{'variant':48s} | {'no Meta-analysis':^44s} | {'Meta-analysis':^44s}")
for name, times, art in cases:
    row = []
    for forbid in (('meta-analysis', 'meta-analysis-baselines'), ('meta-analysis-baselines',)):
        OT = variant(times, art, forbid)
        rec, imp, void = solve(OT, {'article': 1}, OUR_W)
        mm, el, bu, cls = machines(OT, rec, OUR_MACH)
        loopm = mm.get('trainer', 0) + sum(rec.get(r, 0) * OT[r]['time'] for r in ('experiment', 'benchmark'))
        row.append(f"{sum(mm.values()):4.0f} mach, Tr {mm.get('trainer',0):5.1f}, DP {mm.get('data-plant',0):5.1f}, {el:5.1f} MW, crawl {imp.get('crawl',0):5.1f}")
    print(f"{name:48s} | {row[0]} | {row[1]}")
# bootstrap: 40 SR at no-meta rates and the 200 Articles for the Meta-analysis tech
for name, times, art in cases[:4]:
    ta = times.get('analysis', 12); te = times.get('experiment', 5)
    runs = 40 * 20 + 100 * 20
    print(f"{name:48s} bootstrap (Meta-analysis tech 200 Articles + 40 SR stock): {runs} runs = {runs*ta/3600:.1f} Trainer-h, {runs*te/3600:.1f} Data-plant-h")

print("\nProposed: Analysis 12 -> 2.4 s, Meta-analysis 60 -> 12 s, Experiment 5 -> 1 s")
for forbid, lab in ((('meta-analysis', 'meta-analysis-baselines'), 'no Meta-analysis'), (('meta-analysis-baselines',), 'Meta-analysis')):
    OT = variant({'analysis': 2.4, 'meta-analysis': 12, 'experiment': 1}, None, forbid)
    rec, imp, void = solve(OT, {'article': 1}, OUR_W)
    mm, el, bu, cls = machines(OT, rec, OUR_MACH)
    print(f"  {lab:18s}: {sum(mm.values()):.0f} machines ({sum(mm.values())/95:.2f}x Factorio's 95), {el:.1f} MW ({el/9.2:.2f}x), Trainers {mm.get('trainer',0):.1f}, Data plants {mm.get('data-plant',0):.1f}, crawl {imp.get('crawl',0):.1f}/s")
runs = 40 * 20 + 100 * 20
print(f"  bootstrap: {runs} runs = {runs*2.4/3600:.2f} Trainer-h, {runs*1/3600:.2f} Data-plant-h (vs 9.3 / 3.9 now)")

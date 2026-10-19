from load import *
from tiers import tier_of, labsec, closure
import collections
from lines import our_recipe_table, solve, OUR_W
OT = our_recipe_table(forbid=('meta-analysis-baselines',))
rec_per = {}
for p in ('memo','report','article','proceedings','preprint','model-card'):
    r, imp, v = solve(OT, {p: 1}, OUR_W); rec_per[p] = imp.get('records', 0)
r, imp, v = solve(OT, {'run-shard': 0.1, 'post-training-payload': 0.001}, OUR_W); rec_per['system-card(run)'] = imp.get('records', 0)
r, imp, v = solve(OT, {'dataset': 1}, OUR_W); rec_per['dataset'] = imp.get('records', 0)
print('records per pack:', {k: round(v, 3) for k, v in rec_per.items()})
def packs(ids):
    c = collections.Counter()
    for x in ids:
        t = T[x]; co = t.get('cost')
        if not co or 'count' not in co: continue
        for p, a in co['packs'].items(): c[p] += co['count'] * a
    return c
allfin = [t['id'] for t in techs if t.get('cost') and 'count' in t['cost']]
nonM = [x for x in allfin if 'proceedings' not in T[x]['cost']['packs']]
nonM_noTakeoff = [x for x in nonM if not (list(T[x]['cost']['packs']) == ['system-card'])]
path = [x for x in closure('automated-research') if T[x].get('cost') and 'count' in T[x]['cost']]
for label, ids in (('closure path only', path), ('all non-M finite (no takeoff)', nonM_noTakeoff), ('all finite incl. M (no takeoff)', [x for x in allfin if list(T[x]['cost']['packs']) != ['system-card']])):
    c = packs(ids)
    runs_cards = c.get('system-card', 0)
    recs = c.get('memo', 0) * rec_per['memo'] + c.get('preprint', 0) * rec_per['preprint'] + c.get('model-card', 0) * rec_per['model-card'] + c.get('proceedings', 0) * rec_per['proceedings'] + runs_cards * rec_per['system-card(run)']
    print(f"{label:34s} packs {dict(c)}  -> records {recs:,.0f}  (memo {c.get('memo',0)*rec_per['memo']:,.0f}, P+Y {(c.get('preprint',0)+c.get('model-card',0))*3.333:,.0f}, runs {runs_cards*rec_per['system-card(run)']:,.0f})")

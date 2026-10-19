"""R3 balance: production lines at 1 pack/s for our spec data and Factorio 2.0 (LP over recipes).
Usage: gamedev-python lines.py
"""
import json, math, sys, os
import numpy as np
from scipy.optimize import linprog
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load import recipes as OUR_RECIPES, E as OUR_E, I as OUR_I

FD = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'round1', 'E-data', 'recipe2077.json')

def j_amounts(r, j):
    """Return products with amounts_by_j evaluated."""
    abj = r.get('amounts_by_j')
    prods = [dict(p) for p in r['products']]
    if abj:
        for p in prods:
            if p['id'] in abj:
                p['amount'] = eval(abj[p['id']].replace('^', '**'), {'j': j})
    return prods

def our_recipe_table(j=0.30, forbid=()):
    out = {}
    for r in OUR_RECIPES:
        if r['id'] in forbid or r.get('container') or r.get('pseudo') and r['id'] != 'launch':
            continue
        if r['category'] == 'recycling':
            continue
        net = {}
        for ing in r['ingredients']:
            net[ing['id']] = net.get(ing['id'], 0) - ing['amount']
        for p in j_amounts(r, j):
            amt = p['amount'] * p.get('probability', 1.0)
            net[p['id']] = net.get(p['id'], 0) + amt
        out[r['id']] = dict(cat=r['category'], time=r['time'], net=net)
    return out

def factorio_recipe_table(forbid=()):
    rr = json.load(open(FD))
    out = {}
    for r in rr:
        if r.get('parameter') or r['name'] in forbid:
            continue
        cat = r.get('category', 'crafting')
        if cat in ('recycling', 'parameters'):
            continue
        if 'barrel' in r['name'] and r['name'] != 'barrel':
            continue
        net = {}
        for ing in r.get('ingredients', []):
            net[ing['name']] = net.get(ing['name'], 0) - ing['amount']
        for p in r.get('results', []):
            amt = p.get('amount', (p.get('amount_min', 0) + p.get('amount_max', 0)) / 2)
            amt *= p.get('probability', 1.0)
            net[p['name']] = net.get(p['name'], 0) + amt
        out[r['name']] = dict(cat=cat, time=r.get('energy_required', 0.5), net=net)
    return out

def solve(table, target, raw_w, extra_demand=None, allowed=None, eps=1e-4):
    """Minimise weighted raw use to make `target` (dict item->rate). Byproducts may be voided."""
    rids = [k for k in table if allowed is None or k in allowed]
    items = sorted({i for k in rids for i in table[k]['net']} | set(target) | set(raw_w))
    ix = {it: n for n, it in enumerate(items)}
    nR, nI = len(rids), len(items)
    raws = [it for it in items if it in raw_w]
    # variables: recipes (nR), imports (len(raws)), voids (nI)
    nV = nR + len(raws) + nI
    A = np.zeros((nI, nV)); b = np.zeros(nI)
    for c, k in enumerate(rids):
        for it, a in table[k]['net'].items():
            A[ix[it], c] += a
    for c, it in enumerate(raws):
        A[ix[it], nR + c] += 1
    for c in range(nI):
        A[c, nR + len(raws) + c] -= 1
    for it, v in target.items():
        b[ix[it]] += v
    cost = np.zeros(nV)
    for c, k in enumerate(rids):
        cost[c] = eps * table[k]['time']
    for c, it in enumerate(raws):
        cost[nR + c] = raw_w[it]
    cost[nR + len(raws):] = 1e-6
    res = linprog(cost, A_eq=A, b_eq=b, bounds=[(0, None)] * nV, method='highs')
    if res.status != 0:
        raise RuntimeError(res.message)
    x = res.x
    rec = {k: x[c] for c, k in enumerate(rids) if x[c] > 1e-9}
    imp = {it: x[nR + c] for c, it in enumerate(raws) if x[nR + c] > 1e-9}
    void = {it: x[nR + len(raws) + c] for c, it in enumerate(items) if x[nR + len(raws) + c] > 1e-9}
    return rec, imp, void

# ---- machines ---------------------------------------------------------------
OUR_MACH = {  # category -> (machine id, speed, kW electric, kW burner, heat class)
    'smelting': ('steel-furnace', 2, 0, 270, None),
    'transcription': ('tokenizer', 2, 180, 0, 'computer'),
    'crafting': ('assembling-machine-2', 0.75, 150, 0, None),
    'crafting-with-fluid': ('assembling-machine-2', 0.75, 150, 0, None),
    'chemistry': ('chemical-plant', 1, 210, 0, None),
    'data-refining': ('data-refinery', 1, 420, 0, 'computer'),
    'data-processing': ('data-plant', 1, 210, 0, 'computer'),
    'training': ('trainer', 1, 400, 0, 'cluster'),
    'centrifuging': ('centrifuge', 1, 350, 0, None),
    'serving': ('endpoint', 1, 1000, 0, 'cluster'),
    'frontier-run': ('frontier-cluster', 1, 3990, 0, 'accelerator'),
    'launch': ('frontier-cluster(launch)', 1, 0, 0, None),
    'research-run': ('research-hall', 1, 5000, 0, 'accelerator'),
}
F_MACH = {
    'smelting': ('steel-furnace', 2, 0, 90, None),
    'crafting': ('assembling-machine-2', 0.75, 150, 0, None),
    'advanced-crafting': ('assembling-machine-2', 0.75, 150, 0, None),
    'crafting-with-fluid': ('assembling-machine-2', 0.75, 150, 0, None),
    'chemistry': ('chemical-plant', 1, 210, 0, None),
    'oil-processing': ('oil-refinery', 1, 420, 0, None),
    'rocket-building': ('rocket-silo', 1, 4000, 0, None),
    'centrifuging': ('centrifuge', 1, 350, 0, None),
}
OUR_RAW_MINE = {'iron-ore': 0.5, 'copper-ore': 0.5, 'coal': 0.5, 'quartz': 0.5, 'records': 0.5, 'uranium-ore': 0.25}
F_RAW_MINE = {'iron-ore': 0.5, 'copper-ore': 0.5, 'coal': 0.5, 'stone': 0.5, 'uranium-ore': 0.25}

def machines(table, rec, mach, override=None):
    out = {}; elec = 0.0; burn = 0.0; by_class = {}
    for k, x in rec.items():
        cat = table[k]['cat']
        m = (override or {}).get(k) or mach.get(cat)
        if m is None:
            m = (cat, 1, 0, 0, None)
        name, speed, kw, bkw, hc = m
        n = x * table[k]['time'] / speed
        out[name] = out.get(name, 0) + n
        elec += n * kw / 1000; burn += n * bkw / 1000
        if hc:
            by_class[hc] = by_class.get(hc, 0) + n * kw / 1000
    return out, elec, burn, by_class

def mining(imp, rates, crawl_yield=1.0):
    n = {}; kw = 0
    for it, v in imp.items():
        if it in rates:
            n['drills'] = n.get('drills', 0) + v / rates[it]; kw += v / rates[it] * 90
        if it in ('crawl', 'crude-oil'):
            k = v / (10 * crawl_yield)
            n['crawlers/pumpjacks@%d%%' % (crawl_yield * 100)] = k; kw += k * 90
        if it == 'water':
            n['offshore'] = v / 1200
    return n, kw / 1000

OUR_W = {'iron-ore': 1, 'copper-ore': 1, 'coal': 1, 'quartz': 1, 'uranium-ore': 1, 'records': 20, 'crawl': 1, 'water': 0.001, 'wood': 5}
F_W = {'iron-ore': 1, 'copper-ore': 1, 'coal': 1, 'stone': 1, 'uranium-ore': 1, 'crude-oil': 1, 'water': 0.001, 'wood': 5}

PAIRS = [('memo', 'automation-science-pack'), ('report', 'logistic-science-pack'),
         ('article', 'chemical-science-pack'), ('proceedings', 'military-science-pack'),
         ('preprint', 'production-science-pack'), ('model-card', 'utility-science-pack'),
         ('system-card', 'space-science-pack')]

def fmt(d, nd=1):
    return ', '.join(f"{k} {v:.{nd}f}" for k, v in sorted(d.items(), key=lambda kv: -kv[1]))

def run_pair(ours, theirs, our_forbid=(), j=0.30, label='', our_allowed=None, verbose=True, our_mach=None):
    OT = our_recipe_table(j=j, forbid=our_forbid)
    FT = factorio_recipe_table(forbid=('basic-oil-processing', 'coal-liquefaction', 'solid-fuel-from-heavy-oil', 'solid-fuel-from-petroleum-gas'))
    # our side
    if ours == 'system-card':
        # 1000 cards per launch of 100 run shards + payload; per card: 0.1 shard + 0.001 payload
        tgt = {'run-shard': 0.1, 'post-training-payload': 0.001}
    else:
        tgt = {ours: 1.0}
    rec, imp, void = solve(OT, tgt, OUR_W, allowed=our_allowed)
    mm, el, bu, cls = machines(OT, rec, our_mach or OUR_MACH)
    mi, mel = mining(imp, OUR_RAW_MINE)
    if theirs == 'space-science-pack':
        ftgt = {'rocket-part': 0.1, 'satellite': 0.001}
    else:
        ftgt = {theirs: 1.0}
    frec, fimp, fvoid = solve(FT, ftgt, F_W)
    fm, fel, fbu, _ = machines(FT, frec, F_MACH)
    fmi, fmel = mining(fimp, F_RAW_MINE)
    res = dict(ours=dict(rec=rec, imp=imp, void=void, mach=mm, elec=el + mel, burn=bu, cls=cls, mine=mi),
               theirs=dict(rec=frec, imp=fimp, void=fvoid, mach=fm, elec=fel + fmel, burn=fbu, mine=fmi))
    if verbose:
        print(f"\n=== {ours} {label} vs {theirs} (1 pack/s)")
        print("  ours  raw:", fmt(imp, 2))
        print("  F2.0  raw:", fmt(fimp, 2))
        print("  ours  machines:", fmt(mm), '| mining', fmt(mi))
        print("  F2.0  machines:", fmt(fm), '| mining', fmt(fmi))
        print(f"  ours  power: electric {el + mel:.2f} MW (computing classes {fmt(cls,2)}), burner {bu:.2f} MW")
        print(f"  F2.0  power: electric {fel + fmel:.2f} MW, burner {fbu:.2f} MW")
        print(f"  ours  machine total {sum(mm.values()):.0f} vs F {sum(fm.values()):.0f}; void {fmt(void,2)}")
    return res

if __name__ == '__main__':
    for ours, theirs in PAIRS:
        if ours == 'article':
            run_pair(ours, theirs, our_forbid=('meta-analysis', 'meta-analysis-baselines'), label='[no Meta-analysis]')
            run_pair(ours, theirs, our_forbid=('meta-analysis-baselines',), label='[Meta-analysis]')
        else:
            run_pair(ours, theirs, our_forbid=('meta-analysis-baselines',))

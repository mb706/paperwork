import json, collections
T = json.load(open('/tmp/claude-1002/R1-E/tree.json'))
fact = json.load(open('/tmp/claude-1002/R1-E/tech2077.json')) + json.load(open('/tmp/claude-1002/R1-E/techq.json'))
FB = {t['name']: t for t in fact}
def closure(graph, x, seen=None):
    seen = set() if seen is None else seen
    for p in graph[x]:
        if p not in seen: seen.add(p); closure(graph, p, seen)
    return seen
def cost_ours(tid):
    c = T[tid]['cost']
    return (c[0], c[1], c[2]) if isinstance(c[0], int) else None
def labsec_ours(ids):
    tot = 0; packs = collections.Counter()
    for i in ids:
        c = cost_ours(i)
        if c: tot += c[0]*c[2]; [packs.__setitem__(L, packs[L]+c[0]) for L in c[1]]
    return tot, packs
G = {k: v['pre'] for k, v in T.items()}
FG = {k: v.get('prerequisites', []) for k, v in FB.items()}
ab = {"automation-science-pack":"R","logistic-science-pack":"G","military-science-pack":"M","chemical-science-pack":"B","production-science-pack":"P","utility-science-pack":"Y","space-science-pack":"W"}
def labsec_f(ids):
    tot = 0; packs = collections.Counter()
    for i in ids:
        u = FB[i].get('unit')
        if u and 'count' in u:
            tot += u['count']*u['time']
            for x in u['ingredients']: packs[ab[x[0]]] += u['count']
    return tot, packs
# rocket: Factorio = closure(rocket-silo) + rocket-silo ; ours = closure(scaling_laws)+scaling_laws + preference_tuning closure
f_ids = closure(FG, 'rocket-silo') | {'rocket-silo'}
o_ids = closure(G, 'scaling_laws') | {'scaling_laws'} | closure(G, 'preference_tuning') | {'preference_tuning'}
fl, fp = labsec_f(f_ids); ol, op = labsec_ours(o_ids)
print(f"to first launch: Factorio {len(f_ids)} techs, {fl:,} lab-s, packs {dict(fp)}")
print(f"to first run:    ours     {len(o_ids)} techs, {ol:,} lab-s, packs {dict(op)}  ratio {ol/fl:.3f}")
extra = sorted(o_ids - {T[k]['id'] for k in T if T[k]['fid'] and T[k]['fid'] in f_ids})
print("extra techs on our path:", [T[i]['name'] for i in extra])
# whole finite tree, non-M
def is_finite_nonM(t): return isinstance(t['cost'][0], int) and t['branch'] != 'M'
fin = [k for k,t in T.items() if is_finite_nonM(t)]
ffin = [k for k,t in FB.items() if t.get('unit') and 'count' in t['unit'] and not any(x[0]=='military-science-pack' for x in t['unit']['ingredients'])]
a,b = labsec_ours(fin); c,d = labsec_f(ffin)
print(f"finite non-M: ours {len(fin)} techs {a:,} lab-s; Factorio {len(ffin)} techs {c:,} lab-s; ratio {a/c:.3f}")
# per tier lab-seconds non-M
for tier in "RGBPYW":
    o = [k for k in fin if T[k]['tier']==tier]
    print(tier, "ours", len(o), f"{labsec_ours(o)[0]:,}")
# Literature year vs progress: order = tier then topo (prereqs first) ; only non-M main tree + triggers
tierord = "SRGBPYW"
done=set(); seq=[]
def ready(k): return all(p in done for p in T[k]['pre'])
main=[k for k,t in T.items() if t['branch']!='M' and not t['infinite']]
need=set(main)
for k in main: need|=closure(G,k)
pool=[k for k in need if not T[k]['infinite']]
while pool:
    cand = [k for k in pool if ready(k)]
    cand.sort(key=lambda k: (tierord.index(T[k]['tier']), T[k]['branch']=='M', labsec_ours([k])[0]))
    k = cand[0]; seq.append(k); done.add(k); pool.remove(k)
cum=0; lit=0; total=labsec_ours(seq)[0]
marks=[]; last_tier=None
rows=[]
for k in seq:
    cum += labsec_ours([k])[0]
    if T[k]['regime']=='H': lit=max(lit,T[k]['year'])
    rows.append((k, T[k]['tier'], cum/total, lit))
print("\nLiterature year at fraction of finite main-tree lab-seconds:")
for f in [0.01,0.02,0.05,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.0]:
    r = next(r for r in rows if r[2]>=f-1e-9)
    print(f"  {f:4.0%}  tier {r[1]}  Literature {r[3]}  ({T[r[0]]['name']})")
print("\nLiterature at completion of each pack gateway:")
for g in ['basic_research','linear_programming','statistical_learning','deep_learning','expected_utility','scaling_laws','in_context_learning']:
    r = next(r for r in rows if r[0]==g)
    print(f"  {T[g]['name']:22s} at {r[2]:6.1%} of main-tree lab-s, Literature {r[3]}")
json.dump([(T[k]['name'],r[1],round(r[2],4),r[3]) for k,r in zip(seq,rows)], open('/tmp/claude-1002/R1-E/lit_curve.json','w'))

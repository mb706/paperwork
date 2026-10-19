import json, sys, collections
d = json.load(open("tech2077.json")) + json.load(open("techq.json"))
ab = {"automation-science-pack":"R","logistic-science-pack":"G","military-science-pack":"M","chemical-science-pack":"B","production-science-pack":"P","utility-science-pack":"Y","space-science-pack":"W"}
order="RGMBPYW"
tier = collections.Counter(); packs = collections.Counter(); labsec = collections.Counter()
mil = 0; inf=0; trig=0
rows=[]
for t in d:
    u=t.get("unit")
    if not u: trig+=1; tier["trigger"]+=1; continue
    ing=[ab[x[0]] for x in u["ingredients"]]
    top=max(ing, key=lambda c: order.index(c) if c!="M" else -1)
    # tier = highest non-military pack
    hi = max((c for c in ing if c!="M"), key=order.index)
    key = hi + ("+M" if "M" in ing else "")
    if t.get("max_level")=="infinite": inf+=1; tier["infinite"]+=1; continue
    tier[key]+=1
    c=u["count"]
    for x in u["ingredients"]:
        packs[ab[x[0]]]+=c*x[1]
    labsec[key]+=c*u["time"]
print("techs by tier:", dict(tier), "triggers:",trig,"infinite:",inf, "total:",len(d))
print("total packs (finite techs):", dict(packs))
print("lab-seconds by tier:", {k:v for k,v in labsec.items()})
# main path (non-military) totals
packs2=collections.Counter(); n=0
for t in d:
    u=t.get("unit")
    if not u or t.get("max_level")=="infinite": continue
    ing=[ab[x[0]] for x in u["ingredients"]]
    if "M" in ing: continue
    n+=1
    for x in u["ingredients"]: packs2[ab[x[0]]]+=u["count"]*x[1]
print("non-military finite techs:", n, dict(packs2))

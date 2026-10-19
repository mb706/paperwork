import re, sys, subprocess
from collections import Counter
txt = subprocess.run([sys.executable, "-I", "scripts/parse_recipes.py", "fdata/recipe.lua"], capture_output=True, text=True).stdout
rec = {}
for line in txt.splitlines():
    m = re.match(r'(\S+) \[[^\]]*\]: (.*) -> (.*)$', line)
    if not m: continue
    name, ins, outs = m.groups()
    def parse(s):
        out = []
        for part in s.split(' + '):
            part = part.strip()
            if not part: continue
            mm = re.match(r'([0-9.]+) ([a-z0-9-]+)(\(F\))?(@p([0-9.]+))?', part)
            out.append((mm.group(2), float(mm.group(1)) * (float(mm.group(5)) if mm.group(5) else 1)))
        return out
    rec[name] = (parse(ins), parse(outs))
raw = {"iron-ore","copper-ore","coal","stone","water","crude-oil","uranium-ore","wood"}
maker = {}
prefer = {"petroleum-gas": "basic-oil-processing", "heavy-oil": "advanced-oil-processing", "light-oil": "advanced-oil-processing", "solid-fuel": "solid-fuel-from-light-oil"}
for n,(i,o) in rec.items():
    if n.startswith(("parameter","fill-","empty-")) or "barrel" in n: continue
    for p,a in o: maker.setdefault(p, n)
maker.update(prefer)
memo = {}
def cost(item):
    if item in raw: return Counter({item:1.0})
    if item in memo: return memo[item]
    n = maker[item]; ins, outs = rec[n]
    amt = sum(a for p,a in outs if p == item)
    c = Counter()
    for p,a in ins:
        for k,v in cost(p).items(): c[k] += v*a/amt
    memo[item] = c; return c
for pack in ["automation-science-pack","logistic-science-pack","chemical-science-pack","military-science-pack","production-science-pack","utility-science-pack"]:
    c = cost(pack)
    print(pack, ", ".join(f"{k} {v:.1f}" for k,v in sorted(c.items(), key=lambda kv:-kv[1])))
c = Counter()
for k,v in cost("rocket-part").items(): c[k]+=v*100
for k,v in cost("satellite").items(): c[k]+=v
print("per launch /1000 packs:", ", ".join(f"{k} {v/1000:.1f}" for k,v in sorted(c.items(), key=lambda kv:-kv[1])))

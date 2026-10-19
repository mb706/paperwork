"""R3 accuracy check: UI text fields (name, desc, note, handbook_note) against 08 rules: US spelling, never-list words (robot, bot), "you"/"your", and symbols. Run from the repo root:  gamedev-python design/round3/accuracy-data/textrules.py"""
import yaml, re
import sys
base = sys.argv[1] if len(sys.argv) > 1 else 'design/spec/data/'
pat = re.compile(r"\b(neighbour[s]?|labelled|armour(ed)?|colour|behaviour|aluminium|centre|robot(ic)?s?|bots?|σ|you|your)\b", re.I)
for f in ['technologies.yaml','items.yaml','entities.yaml','enemies.yaml','recipes.yaml']:
    for x in yaml.safe_load(open(base+f)):
        for k in ('name','desc','note','handbook_note'):
            v = x.get(k)
            if isinstance(v,str):
                for m in pat.finditer(v):
                    print(f"{f}:{x['id']}:{k}: '{m.group(0)}' in: {v[:110]}")

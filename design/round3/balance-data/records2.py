from pacing import our_list, research_order
from load import T
order = research_order(our_list())
rec = {'memo': 1.0, 'preprint': 3.333, 'model-card': 3.333, 'system-card': 5.75}
cum = 0; out = {}
for x in order:
    c = T[x['id']]['cost']
    for p, a in c['packs'].items():
        cum += c['count'] * a * rec.get(p, 0)
    out[x['tier']] = cum
print({k: round(v) for k, v in out.items()})

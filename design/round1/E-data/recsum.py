import json, sys
d = json.load(open(sys.argv[1]))
def items(lst):
    out=[]
    for x in lst or []:
        if isinstance(x, dict):
            out.append(f"{x.get('amount', x.get('amount_min'))} {x['name']}{'(fl)' if x.get('type')=='fluid' else ''}")
        else:
            out.append(f"{x[1]} {x[0]}")
    return ", ".join(out)
start=[]
for r in d:
    if r.get("type")!="recipe": continue
    en = r.get("enabled", True)
    line = f"{r['name']} | {r.get('category','crafting')} | {r.get('energy_required',0.5)}s | {items(r.get('ingredients'))} -> {items(r.get('results'))}"
    if en is not False: start.append(line)
    if sys.argv[2:] and any(k in r['name'] for k in sys.argv[2:]): print("REC", line, "| enabled" if en is not False else "")
print("\nSTART-ENABLED:")
print("\n".join(start))

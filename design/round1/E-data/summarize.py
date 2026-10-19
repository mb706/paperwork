import json, sys
d = json.load(open(sys.argv[1]))
ab = {"automation-science-pack":"R","logistic-science-pack":"G","military-science-pack":"M","chemical-science-pack":"B","production-science-pack":"P","utility-science-pack":"Y","space-science-pack":"W"}
def eff(e):
    t = e.get("type")
    if t == "unlock-recipe": return e["recipe"]
    if t in ("nothing",): return "nothing:"+str(e.get("effect_description",""))
    m = e.get("modifier")
    rest = {k:v for k,v in e.items() if k not in ("type","modifier","icons","icon","icon_size")}
    return f"{t}({m}{','+json.dumps(rest) if rest else ''})"
for i,t in enumerate(d):
    if t.get("type") != "technology":
        print("NONTECH", t.get("type"), t.get("name")); continue
    u = t.get("unit") or {}
    ing = "".join(ab.get(x[0] if isinstance(x,list) else x.get("name"),"?") for x in u.get("ingredients",[]))
    cnt = u.get("count", u.get("count_formula"))
    trig = t.get("research_trigger")
    cost = f"{cnt}x{ing}@{u.get('time')}s" if u else "TRIGGER "+json.dumps(trig)
    ml = t.get("max_level")
    print(f"{i:3d} {t['name']} | pre={','.join(t.get('prerequisites',[]))} | {cost}{' max='+str(ml) if ml else ''}{' upg' if t.get('upgrade') else ''} | {'; '.join(eff(e) for e in t.get('effects',[]))}")

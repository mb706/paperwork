import json, collections, importlib.util, re
BASE = "/tmp/claude-1002/R1-E/"
T = json.load(open(BASE + "tree.json"))
dropped = json.load(open(BASE + "dropped.json"))
spec = importlib.util.spec_from_file_location("tree_data", BASE + "tree_data.py")
D = importlib.util.module_from_spec(spec); spec.loader.exec_module(D)
NAME = {k: v["name"] for k, v in T.items()}
GN = {v: k for k, v in D.GLOSS.items() if v}

def cost_s(t):
    c = t["cost"]
    if c[0] == "trigger": return "Trigger: " + c[1]
    if c[0] == "start": return "Researched at start"
    if c[0] == "formula":
        lv = c[4] if len(c) > 4 else "∞"
        return f"{c[1]} × {c[2]} · {c[3]} s (L = {'7' if False else ''}{lv})" if lv != "∞" else f"{c[1]} × {c[2]} · {c[3]} s, infinite"
    return f"{c[0]:,} × {c[1]} · {c[2]} s"

def pre_s(t):
    return ", ".join(NAME[p] for p in t["pre"]) or "—"

def unl_s(t):
    u = "; ".join(t["unlocks"])
    if t["id"] in dropped:
        u += " (dropped: " + ", ".join(x.replace("-", " ") for x in dropped[t["id"]]) + ")"
    return u or "—"

def cite_s(t):
    return t["cite"] if t["cite"] else ("beyond the literature" if t["regime"] == "F" else "—")

def tag_s(t):
    return t["tag"]

def esc(s):
    return s.replace("|", "\\|")

def table(rows, code_prefix, start=1):
    out = ["| Code | Technology | Mirrors | Tag | Prerequisites | Cost | Unlocks / effect | Definition | Citation |",
           "|---|---|---|---|---|---|---|---|---|"]
    for i, t in enumerate(rows, start):
        name = t["name"] + (" ★" if t.get("essential") else "")
        out.append("| " + " | ".join(esc(x) for x in [f"{code_prefix}{i:02d}", f"**{name}**", t["mirrors"], tag_s(t),
                    pre_s(t), cost_s(t), unl_s(t), t["defn"], cite_s(t)]) + " |")
        t["code"] = f"{code_prefix}{i:02d}"
    return "\n".join(out)

def series_table(rows, code_prefix):
    out = ["| Code | Level | Mirrors | Prerequisites | Cost | Effect |", "|---|---|---|---|---|---|"]
    for i, t in enumerate(rows, 1):
        out.append("| " + " | ".join(esc(x) for x in [f"{code_prefix}{i:02d}", f"**{t['name']}**", t["mirrors"],
                   pre_s(t), cost_s(t), unl_s(t)]) + " |")
        t["code"] = f"{code_prefix}{i:02d}"
    return "\n".join(out)

# order techs topologically within groups (stable by original insertion = Factorio file order)
ids = list(T)
pos = {k: i for i, k in enumerate(ids)}
def topo(group):
    g = set(group); done = set(); res = []
    rem = sorted(group, key=lambda k: pos[k])
    while rem:
        for k in rem:
            if all((p not in g) or (p in done) for p in T[k]["pre"]):
                res.append(k); done.add(k); rem.remove(k); break
    return res

GROUPS = [
 ("Science", "basic_research linear_programming game_theory statistical_learning deep_learning expected_utility "
             "in_context_learning artificial_intelligence"),
 ("Production", "tabulation stored_program cluster_computing steel_processing zone_refining electric_furnace concrete "
                "engine landfill electric_mining maintenance explosives cliff_explosives brushless_motors lubricant "
                "integrated_circuit accelerators memory_wall synthetics mobile_robotics enrichment_cascade "
                "fuel_reprocessing"),
 ("Logistics", "logistics logistics_2 logistics_3 servomechanisms batch_processing railway semaphores automobile "
               "fluid_wagon disk_storage radar lamp"),
 ("Data", "crawling text_categorization spam_filtering information_theory paraphrase_generation curated_corpora "
          "mass_digitization synthetic_detection watermarking"),
 ("Power", "steam_power rural_electrification substations photovoltaics batteries accumulators in_situ_leaching "
           "isotope_separation nuclear_power fusion_power"),
 ("Heat", "evaporative_cooling liquid_cooling immersion_cooling"),
 ("Research", "citation_index time_sharing web_search open_source_libraries automatic_differentiation code_generation "
              "expert_systems"),
 ("Compute", "perceptron pipelining vector_processing systolic_arrays backpropagation convolution attention cmos "
             "model_compression quantization data_parallelism"),
 ("Quality", "rejection_sampling beam_search tree_search expert_iteration interpretability scalable_oversight "
             "formal_verification"),
 ("Agents", "automated_planning multi_agent_systems instruction_tuning personal_assistant personal_assistant_2"),
 ("Circuit", "cybernetics lateral_inhibition packet_switching"),
 ("Equipment", "wearable_computing portable_solar night_vision belt_immunity personal_battery personal_battery_2 "
               "powered_suit exoskeleton"),
 ("Endgame", "scaling_laws preference_tuning chain_of_thought self_play test_time_compute automated_research "
             "model_generation wafer_scale_integration photonic_interconnect reversible_logic "
             "research_scheduling weight_transplant"),
]
GOF = {}
for gi, (g, names) in enumerate(GROUPS):
    for n in names.split(): GOF[n] = (gi, g)
_topo_old = topo
def topo(group):
    base = _topo_old(group)
    rank = {k: i for i, k in enumerate(base)}
    return sorted(base, key=lambda k: (GOF.get(k, (99, ""))[0], rank[k]))
TRIG_ORDER = ["prior_art", "steam_power", "switching_circuits", "basic_research", "learning_curve",
              "text_categorization", "isotope_separation", "in_context_learning"]
def sel(pred): return [k for k in ids if pred(T[k])]
is_trig = lambda t: t["cost"][0] in ("trigger", "start")
main = lambda t: t["branch"] != "M" and not t["series"] and not is_trig(t)
out = {}
out["triggers"] = table([T[k] for k in TRIG_ORDER], "T", start=0)
def clos(x, seen=None):
    seen = set() if seen is None else seen
    for p in T[x]["pre"]:
        if p not in seen: seen.add(p); clos(p, seen)
    return seen
for tier, pfx in [("R", "R"), ("G", "G"), ("B", "B"), ("P", "P"), ("Y", "Y")]:
    rows = topo(sel(lambda t, tier=tier: main(t) and t["tier"] == tier and not t["infinite"]))
    out[tier] = table([T[k] for k in rows], pfx)
wrows = topo(sel(lambda t: main(t) and t["tier"] == "W" and not t["infinite"]))
pre_c = [k for k in wrows if "automated_research" not in clos(k)]
post_c = [k for k in wrows if "automated_research" in clos(k)]
out["W"] = table([T[k] for k in pre_c], "W")
out["W2"] = table([T[k] for k in post_c], "W", start=len(pre_c) + 1)
out["W_inf"] = table([T[k] for k in topo(sel(lambda t: t["branch"] != "M" and t["infinite"] and not t["series"]))], "I")
# non-M series
ser_order = ["batch_size", "inference_speed", "context_length", "braking_force", "mining_productivity", "dennard"]
srows = []
for s in ser_order:
    srows += topo(sel(lambda t, s=s: t["series"] == s))
out["series"] = series_table([T[k] for k in srows], "S")
# Branch M
for tier in "RGBPYW":
    rows = topo(sel(lambda t, tier=tier: t["branch"] == "M" and not t["series"] and t["tier"] == tier and not t["infinite"]))
    out["M" + tier] = table([T[k] for k in rows], "M" + tier)
mser = ["projectile_damage", "rate_of_fire", "explosive_yield", "monitor_throughput", "laser_damage", "laser_rate", "arc_damage",
        "interceptor_count", "artillery"]
mrows = []
for s in mser:
    mrows += topo(sel(lambda t, s=s: t["series"] == s))
out["Mseries"] = series_table([T[k] for k in mrows], "MS")
json.dump(out, open(BASE + "tables.json", "w"), ensure_ascii=False)
json.dump({k: T[k].get("code") for k in T}, open(BASE + "codes.json", "w"))
missing = [k for k in T if not T[k].get("code")]
print("unrendered:", missing)
for k, v in out.items(): print(k, v.count("\n") - 1, "rows")

fact = json.load(open(BASE + "tech2077.json")) + json.load(open(BASE + "techq.json"))
dt = json.load(open(BASE + "dropped_techs.json"))
byf = {v["fid"]: v for v in T.values() if v.get("fid")}
def fdisp(fid):
    x = fid.replace("-", " "); x = x[0].upper() + x[1:]
    return x.replace("mk2", "MK2")
rows = []
for t in sorted(fact, key=lambda t: fdisp(t["name"])):
    f = t["name"]
    if f in byf: rows.append((fdisp(f), f"{byf[f]['code']} {byf[f]['name']}"))
    else: rows.append((fdisp(f), "dropped: " + dt[f]))
half = (len(rows) + 1) // 2
lines = ["| Factorio | Here | Factorio | Here |", "|---|---|---|---|"]
for i in range(half):
    a = rows[i]; b = rows[i + half] if i + half < len(rows) else ("", "")
    lines.append(f"| {a[0]} | {a[1]} | {b[0]} | {b[1]} |")
out["coverage"] = "\n".join(lines)
g = [(k, v) for k, v in D.GLOSS.items()]
H_SRC = set("Memo Report Proceedings Article Preprint Model card|Seminar|Tabulator|Computer|Cluster|Crawler|Data refinery|Trainer|Switch|Verifier|Data lake|Agent hub|Frontier cluster|Memory bank|Logic board|Processor|Accelerator|Label|Run shard|Post-training payload|Construction agent|Logistic agent|Drive".replace("Memo Report Proceedings Article Preprint Model card", "Memo|Report|Proceedings|Article|Preprint|Model card").split("|"))
F_SRC = set("Fence|Magazine|AP magazine|DU magazine|Evaluation set|Monitor|Repair kit|Interceptor 1|Interceptor 2|Interceptor 3".split("|"))
gl = [(k, v, "H" if v in H_SRC else ("F" if v in F_SRC else "E")) for k, v in g
      if v and re.sub(r"[^a-z0-9]", "", v.lower()) != re.sub(r"[^a-z0-9]", "", k.lower())]
gl.sort(key=lambda x: x[1])
half = (len(gl) + 1) // 2
lines = ["| Factorio | Name here | Src | Factorio | Name here | Src |", "|---|---|---|---|---|---|"]
for i in range(half):
    a = gl[i]; b = gl[i + half] if i + half < len(gl) else ("", "", "")
    lines.append(f"| {a[0]} | {a[1]} | {a[2]} | {b[0]} | {b[1]} | {b[2]} |")
out["glossary"] = "\n".join(lines)
json.dump(out, open(BASE + "tables.json", "w"), ensure_ascii=False)
print("coverage rows", len(rows), "glossary rows", len(gl))

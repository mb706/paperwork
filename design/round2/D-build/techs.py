# Technologies: E's tree (round1/E-data/tree.json) with unlock targets renamed to D's recipe ids,
# plus the additions DECISIONS, G, A and R2-W require. See 05-research.md for the change list.
import json, re

E_TREE = "/home/mewse/browsergame/design/round1/E-data/tree.json"
E_CODES = "/home/mewse/browsergame/design/round1/E-data/codes.json"

PACK = {"R": "memo", "G": "report", "M": "proceedings", "B": "article", "P": "preprint", "Y": "model-card",
        "W": "system-card"}
ERA = {"S": "Prior art", "R": "Automatic computation", "G": "Programming", "B": "Statistical learning",
       "P": "Deep learning", "Y": "Agents", "W": "Takeoff"}

# E id -> our id (kebab-case of the final name)
ID_MAP = {
    "synthetics": "cross-validation",
    "spam_filtering": "sulfur-processing", "memory_wall": "warehouse-scale-computing",
    "mass_digitization": "synthetic-data", "electric_mining": "electric-mining-drill",
    "tree_search": "monte-carlo-tree-search",
}
DROP = {"model_generation_inf"}   # G: Generations end at the capstone; replaced by Energy per operation

# renamed techs: (name, definition, citation or None, year or None). Reasons in 05 "Renamed from E".
RENAMED = {
    "synthetics": ("Cross-validation", "Fit on part of the data; score on the rest.",
                   "Stone, 1974; Geisser, 1975", 1975),
    "spam_filtering": ("Sulfur processing", "Sulfur and its acid, recovered from coal.", None, None),
    "memory_wall": ("Warehouse-scale computing", "A building of servers run as one computer.",
                    "Barroso & Hölzle, 2009", 2009),
    "mass_digitization": ("Synthetic data", "Data drawn from a model fitted to real data.", "Rubin, 1993", 1993),
}
# definition or citation fixes on kept names
DEF_FIX = {
    "landfill": ("Sand fills water.", None, None),
    "thermal_management": ("More heat moved per cooler.", None, None),
    "electric_furnace": ("Smelting and transcription on grid power.", None, None),
    "reversible_logic": ("Computation that erases nothing, so dissipates less.", "Bennett, 1973", 1973),
    "model_generation": ("The previous generation trained this one.", "Moto-oka, 1982", 1982),
    "in_context_learning": ("A trained model learns a task from its prompt.", "Brown et al., 2020", 2020),
}

DRIVES = ["crawl", "junk", "text", "prose"]
BARRELS = ["water", "sulfuric-acid", "lubricant", "coolant"]

UNLOCKS = {
    "prior_art": ["iron-plate", "copper-plate", "silicon", "token", "iron-gear-wheel", "iron-stick", "transport-belt",
                  "burner-inserter", "wooden-chest", "iron-chest", "stone-furnace", "burner-mining-drill", "keypunch"],
    "steam_power": ["pipe", "pipe-to-ground", "offshore-pump", "boiler", "steam-engine"],
    "switching_circuits": ["copper-cable", "logic-board", "seminar", "inserter", "small-electric-pole"],
    "basic_research": ["memo"],
    "text_categorization": ["data-refinery", "data-plant", "deduplication"],
    "isotope_separation": ["centrifuge", "uranium-processing"],
    "electric_mining": ["electric-mining-drill"], "maintenance": ["repair-pack"], "radar": ["radar"],
    "tabulation": ["assembling-machine-1", "long-handed-inserter"],
    "linear_programming": ["report"], "steel_processing": ["steel-plate", "steel-chest"],
    "servomechanisms": ["fast-inserter"], "logistics": ["underground-belt", "splitter"], "lamp": ["small-lamp"],
    "ballistics": ["magazine"], "protective_clothing": ["heavy-armor"], "fire_control": ["gun-turret"],
    "fences": ["fence"],
    "statistical_learning": ["article"], "stored_program": ["assembling-machine-2"], "zone_refining": ["steel-furnace"],
    "concrete": ["concrete", "hazard-concrete", "refined-concrete", "refined-hazard-concrete"],
    "engine": ["engine-unit"], "landfill": ["landfill"], "explosives": ["explosives"],
    "cliff_explosives": ["cliff-explosives"], "synthetics": ["dataset", "benchmark"],
    "integrated_circuit": ["processor", "wafer"],
    "logistics_2": ["fast-transport-belt", "fast-underground-belt", "fast-splitter"],
    "railway": ["rail", "locomotive", "cargo-wagon"], "semaphores": ["train-stop", "rail-signal", "rail-chain-signal"],
    "automobile": ["car"],
    "disk_storage": ["drive", "data-lake"] + [f"{a}-{f}-drive" for f in DRIVES for a in ("fill", "empty")],
    "fluid_wagon": ["fluid-wagon", "data-wagon"], "batch_processing": ["bulk-inserter"],
    "spam_filtering": ["chemical-plant", "sulfur", "sulfuric-acid"], "crawling": ["crawler"],
    "photovoltaics": ["solar-panel"], "rural_electrification": ["medium-electric-pole", "big-electric-pole"],
    "batteries": ["battery"], "accumulators": ["accumulator"], "evaporative_cooling": ["cooling-tower"],
    "perceptron": ["trainer", "checkpoint"], "pipelining": ["coprocessor"], "backpropagation": ["learned-controller"],
    "cmos": ["distilled-controller"], "rejection_sampling": ["comparator"],
    "cybernetics": ["decider-combinator", "arithmetic-combinator", "constant-combinator", "power-switch",
                    "programmable-speaker", "display-panel"],
    "packet_switching": ["data-line", "underground-line", "repeater"],
    "wearable_computing": ["modular-suit"], "portable_solar": ["portable-solar-panel"], "night_vision": ["night-vision"],
    "belt_immunity": ["belt-immunity"], "personal_battery": ["personal-battery"],
    "game_theory": ["proceedings"], "penetration_testing": ["ap-magazine"], "gates": ["gate"],
    "land_mines": ["land-mine"], "reference_monitor": ["monitor", "evaluation-set"], "rocketry": ["rocket"],
    "energy_shield": ["energy-shield"], "interceptors": ["interceptor-bay", "interceptor"],
    "deep_learning": ["preprint", "endpoint", "ratings"], "expected_utility": ["model-card"],
    "accelerators": ["accelerator"], "memory_wall": ["rack"], "electric_furnace": ["electric-furnace", "tokenizer"],
    "lubricant": ["lubricant"], "brushless_motors": ["electric-engine-unit"], "mobile_robotics": ["drone-frame"],
    "paraphrase_generation": ["quality-filtering", "denoising", "rephrasing", "adversarial-set"],
    "curated_corpora": ["corpus"], "substations": ["substation"],
    "nuclear_power": ["nuclear-reactor", "heat-exchanger", "heat-pipe", "steam-turbine", "uranium-fuel-cell"],
    "liquid_cooling": ["coolant", "dry-cooler", "water-exchanger"],
    "vector_processing": ["coprocessor-2"], "convolution": ["learned-controller-2"],
    "model_compression": ["distilled-controller-2"], "beam_search": ["comparator-2"],
    "automated_planning": ["agent-hub", "passive-provider-chest", "storage-chest", "construction-agent"],
    "multi_agent_systems": ["agent-hub", "passive-provider-chest", "storage-chest", "logistic-agent"],
    "personal_assistant": ["personal-assistant"], "lateral_inhibition": ["selector-combinator"],
    "powered_suit": ["powered-suit"], "personal_battery_2": ["personal-battery-2"], "exoskeleton": ["exoskeleton"],
    "tank": ["tank"], "explosive_rocketry": ["explosive-rocket"],
    "laser_turret": ["laser-turret"], "energy_shield_2": ["energy-shield-2"],
    "personal_laser_defense": ["personal-laser-defense"], "discharge_defense": ["discharge-defense"],
    "interceptors_2": ["interceptor-2"],
    "cluster_computing": ["assembling-machine-3"], "enrichment_cascade": ["kovarex-enrichment-process"],
    "fuel_reprocessing": ["nuclear-fuel-reprocessing"],
    "logistics_3": ["express-transport-belt", "express-underground-belt", "express-splitter"],
    "mass_digitization": ["synthetic-data"], "data_parallelism": ["switch"],
    "systolic_arrays": ["coprocessor-3"], "attention": ["learned-controller-3"], "quantization": ["distilled-controller-3"],
    "tree_search": ["comparator-3"], "expert_iteration": ["verifier", "scrap-recycling"],
    "arc_turret": ["arc-turret"],
    "instruction_tuning": ["active-provider-chest", "requester-chest", "buffer-chest"],
    "personal_assistant_2": ["personal-assistant-2"],
    "scaling_laws": ["frontier-cluster", "run-shard"], "preference_tuning": ["post-training-payload", "launch"],
    "depleted_uranium": ["du-magazine"],
    "electromagnetic_pulse": ["emp-warhead"], "powered_suit_2": ["powered-suit-2"],
    "portable_reactor": ["portable-reactor"], "interceptors_3": ["interceptor-3"],
    "artillery": ["artillery-wagon", "artillery-turret", "artillery-shell"], "embodied_agents": ["legged-agent"],
    "automated_research": ["researcher", "research-hall", "research-run", "copy-weights"],
    "fusion_power": ["fusion-reactor", "fusion-generator", "fusion-power-cell"],
    "wafer_scale_integration": ["accelerator-2"], "photonic_interconnect": ["accelerator-3"],
    "reversible_logic": ["accelerator-4"],
}


def eff(t, **kw):
    return dict({"type": t}, **kw)


# explicit effects (replace E's free text where it is not a plain bonus)
EFFECTS = {
    "learning_curve": [eff("character-mining-speed", value=1.0)],
    "expert_systems": [eff("character-crafting-speed", value=1.0)],
    "memex": [eff("character-inventory-slots", value=10)],
    "cybernetics": [eff("unlock-circuit-network")],
    "packet_switching": [eff("exchange-taps"), eff("radar-circuit-relay"), eff("staffing-radius", multiplier=1.5)],
    "web_search": [eff("laboratory-speed", value=0.4), eff("staffing-radius", multiplier=1.5)],
    "liquid_cooling": [eff("liquid-cooling", fraction=0.7)],
    "immersion_cooling": [eff("liquid-cooling", fraction=0.9)],
    "in_situ_leaching": [eff("mining-with-fluid")],
    "automated_planning": [eff("create-ghost-on-entity-death")],
    "multi_agent_systems": [eff("character-logistic-requests"), eff("character-logistic-trash-slots", value=30)],
    "instruction_tuning": [eff("vehicle-logistics")],
    "rejection_sampling": [eff("unlock-quality", quality="selected"), eff("unlock-quality", quality="verified")],
    "scalable_oversight": [eff("unlock-quality", quality="audited")],
    "formal_verification": [eff("unlock-quality", quality="reference")],
    "synthetic_detection": [eff("synthetic-detection")],
    "watermarking": [eff("deployment-sigma", multiplier=0.5)],
    "interpretability": [eff("show-model-quality"), eff("hollow-work-free")],
    "rollback_recovery": [eff("rollback")],
    "chain_of_thought": [eff("system-cards-per-run", value=0.5)],
    "self_play": [eff("recipe-productivity", recipes=["run-shard"], value=0.2)],
    "test_time_compute": [eff("hall-mode", output=0.5, energy=1.0)],
    "research_scheduling": [eff("research-queue-auto")],
    "weight_transplant": [eff("weight-transplant")],
    "model_generation": [eff("research-per-paper", multiplier=2.0, note="m = 1.5^r; 2.0 at the default r = 1.71")],
    "research_productivity": [eff("research-productivity", value=0.1)],
    "self_driving_labs": [eff("laboratory-speed", value=0.2)],
    "process_node": [eff("recipe-productivity", recipes=["accelerator"], value=0.1)],
    "algorithmic_progress": [eff("recipe-productivity", recipes=["run-shard"], value=0.1)],
    "thermal_management": [eff("cooling-capacity", entities=["cooling-tower", "dry-cooler", "water-exchanger"], value=0.1)],
    "interceptors": [eff("interceptor-escort-cap", value=4)],
    "batch_processing": [eff("bulk-inserter-capacity-bonus", value=1)],
    "artificial_intelligence": [], "information_theory": [], "laser": [], "defense_in_depth": [],
    "in_context_learning": [], "prior_art": [], "automated_research": [], "fusion_power": [],
    "wafer_scale_integration": [], "photonic_interconnect": [], "reversible_logic": [], "preference_tuning": [],
    "scaling_laws": [], "evaporative_cooling": [], "arc_turret": [],
}
for n in range(1, 6):
    EFFECTS[f"dennard_scaling_{n}"] = [eff("computing-energy", value=-0.08)]

# cost overrides (G and R2-W for the takeoff tier; DECISIONS §12 for geometric infinites)
COST = {
    "wafer_scale_integration": (540, "W", 30), "photonic_interconnect": (2734, "W", 30),
    "reversible_logic": (13840, "W", 30), "fusion_power": (1215, "W", 30),
    "research_scheduling": (360, "W", 30), "weight_transplant": (540, "W", 30),
}
FORMULA = {  # E id -> (formula, first_level, max_level)
    "model_generation": ("2400*1.5^(L-6)", 6, 24),
    "mining_productivity_4": ("2500*1.5^(L-4)", 4, "infinite"),
    "interceptor_count_5": ("1000*1.5^(L-5)", 5, "infinite"),
}

AMMO_CAT = {"magazine": ("ammo-damage", "bullet"), "gun turret": ("turret-attack", "gun-turret"),
            "cannon shell": ("ammo-damage", "cannon-shell"), "rocket": ("ammo-damage", "rocket"),
            "land mine": ("ammo-damage", "landmine"), "laser": ("ammo-damage", "laser"),
            "laser beam": ("ammo-damage", "beam"), "discharge": ("ammo-damage", "electric"),
            "arc": ("ammo-damage", "arc")}
RATE_CAT = {"magazine": "bullet", "rocket": "rocket", "cannon shell": "cannon-shell", "laser": "laser",
            "artillery shell": "artillery-shell"}


def pct(s):
    return round(float(s) / 100, 4)


def parse_effects(strings):
    out = []
    for s in strings:
        m = re.match(r"(Lab speed|Mining productivity|Agent speed|Braking force|Artillery range|Monitor cleaning rate) \+(\d+)%$", s)
        if m:
            t = {"Lab speed": "laboratory-speed", "Mining productivity": "mining-productivity",
                 "Agent speed": "worker-robot-speed", "Braking force": "train-braking-force-bonus",
                 "Artillery range": "artillery-range", "Monitor cleaning rate": "monitor-rate"}[m.group(1)]
            out.append(eff(t, value=pct(m.group(2))))
            continue
        m = re.match(r"(Agent cargo|Bulk inserter capacity|Inserter capacity|Escort cap) \+(\d+)$", s)
        if m:
            t = {"Agent cargo": "worker-robot-storage", "Bulk inserter capacity": "bulk-inserter-capacity-bonus",
                 "Inserter capacity": "inserter-stack-size-bonus", "Escort cap": "interceptor-escort-cap"}[m.group(1)]
            out.append(eff(t, value=int(m.group(2))))
            continue
        m = re.match(r"Damage: (.*)$", s)
        if m:
            for part in m.group(1).split(", "):
                mm = re.match(r"(.*) \+(\d+)%$", part.strip())
                if mm.group(1) == "cannon shell":   # no tank cannon (L14)
                    continue
                t, cat = AMMO_CAT[mm.group(1)]
                out.append(eff(t, **({"turret": cat} if t == "turret-attack" else {"category": cat}),
                               value=pct(mm.group(2))))
            continue
        m = re.match(r"Fire rate: (.*)$", s)
        if m:
            for part in m.group(1).split(", "):
                mm = re.match(r"(.*) \+(\d+)%$", part.strip())
                if mm.group(1) == "cannon shell":   # no tank cannon (L14)
                    continue
                out.append(eff("gun-speed", category=RATE_CAT[mm.group(1)], value=pct(mm.group(2))))
            continue
        raise ValueError(f"unparsed effect: {s!r}")
    return out


def norm_formula(f):
    return f.replace("−", "-").replace("×", "*").replace(" ", "")


def kebab(s):
    return s.replace("_", "-")


NEW_TECHS = [
    # id, code, name, prereqs, cost (count, letters, time) | formula, unlocks, effects, definition, citation, year, mirrors, extra
    dict(id="fluid-handling", code="G42", name="Fluid handling", prerequisites=["stored-program", "engine"],
         cost=(50, "RG", 15), recipes=["storage-tank", "pump", "barrel"] +
         [f"{a}-{f}-barrel" for f in BARRELS for a in ("fill", "empty")],
         definition="Tanks, pumps and barrels for water and acid.", citation=None, year=None,
         mirrors="fluid-handling (physical side; Disk storage is the data side)", era="Programming"),
    dict(id="hypothesis-testing", code="G43", name="Hypothesis testing", prerequisites=["perceptron"],
         cost=(100, "RG", 30), recipes=["experiment", "analysis"],
         definition="Reject the null when chance alone rarely explains the data.",
         citation="Fisher, 1925; Neyman & Pearson, 1933", year=1933, mirrors="new (A's experiment loop)", era="Programming"),
    dict(id="meta-analysis", code="B28", name="Meta-analysis", prerequisites=["hypothesis-testing", "statistical-learning"],
         cost=(200, "RGB", 30), recipes=["meta-analysis", "meta-analysis-baselines"], definition="Pool many studies' results into one estimate.",
         citation="Glass, 1976", year=1976, mirrors="new (A: Kovarex's shape)", era="Statistical learning"),
    dict(id="model-generation-25", code="W13", name="Model generation 25", prerequisites=["model-generation"],
         cost=(5320411, "W", 30), recipes=["final-report", "launch-final"],
         effects=[eff("research-per-paper", multiplier=2.0, note="m = 1.5^r; 2.0 at the default r = 1.71")],
         definition="The previous generation trained this one.", citation="Moto-oka, 1982", year=1982,
         mirrors="new (capstone; G's Generation 20 and capstone in one level)", era="Takeoff", essential=True),
    dict(id="two-phase-cooling", code="W14", name="Two-phase cooling", prerequisites=["automated-research", "liquid-cooling"],
         cost=(360, "W", 30), recipes=[],
         effects=[eff("cooling-capacity", entities=["dry-cooler", "water-exchanger"], multiplier=2.0)],
         definition="Coolant boils at the chip; the vapor carries the heat.", citation=None, year=None,
         mirrors="new (G)", era="Takeoff"),
    dict(id="fleet-scheduling", code="W15", name="Fleet scheduling", prerequisites=["automated-research"],
         cost=(810, "W", 30), recipes=[], effects=[eff("construction-agent-speed", value=1.0),
                                                   eff("agent-hub-charging", multiplier=2.0)],
         definition="Agents are routed as one fleet, not one by one.", citation=None, year=None,
         mirrors="new (G)", era="Takeoff"),
    dict(id="sparse-inference", code="W16", name="Sparse inference", prerequisites=["automated-research"],
         cost=(1823, "W", 30), recipes=[], effects=[eff("hall-energy", multiplier=0.75)],
         definition="Each step runs only part of the network.", citation=None, year=None,
         mirrors="new (G)", era="Takeoff"),
    dict(id="microfluidic-cooling", code="W17", name="Microfluidic cooling", prerequisites=["two-phase-cooling"],
         cost=(4101, "W", 30), recipes=[],
         effects=[eff("cooling-capacity", entities=["cooling-tower", "dry-cooler", "water-exchanger"], multiplier=2.0)],
         definition="Coolant flows through channels etched into the die.", citation="Tuckerman & Pease, 1981",
         year=1981, mirrors="new (G)", era="Takeoff"),
    dict(id="self-reproducing-automata", code="W18", name="Self-reproducing automata",
         prerequisites=["fleet-scheduling"], cost=(6151, "W", 30), recipes=["deployer", "area-scanner"],
         definition="A machine that builds from a description, its own included.", citation="von Neumann, 1966",
         year=1966, mirrors="new (G's Deployer; A: finale only)", era="Takeoff"),
    dict(id="nanofabrication", code="W19", name="Nanofabrication", prerequisites=["wafer-scale-integration"],
         cost=(9226, "W", 30), recipes=[],
         effects=[eff("recipe-productivity", recipes=["accelerator", "accelerator-2", "accelerator-3", "accelerator-4"],
                      value=1.0)],
         definition="Devices built at the scale of molecules.", citation=None, year=None, mirrors="new (G)", era="Takeoff"),
    dict(id="energy-per-operation", code="I07", name="Energy per operation", prerequisites=["model-generation-25"],
         formula=("1000*2^L", 1, "infinite", "W", 30), recipes=[],
         effects=[eff("hall-energy", multiplier=0.9, floor="θ/4800 K of the building's chunk",
                      note="power × [f + (1 − f)·0.9^L], f = θ_K/4800 K")],
         definition="Erasing a bit dissipates at least kT ln 2.", citation="Landauer, 1961", year=1961,
         mirrors="new (G; points to the expansion)", era="Takeoff"),
]

PREREQ_ADD = {   # our ids; each closes a hidden prerequisite (see 05 "Structural changes")
    "integrated-circuit": ["sulfur-processing"],          # wafers take sulfuric acid
    "sulfur-processing": ["fluid-handling"],              # chemistry after pipes and tanks (cliff explosives need a barrel)
    "game-theory": ["paraphrase-generation"],             # Proceedings: adversarial sets come from junk
    "warehouse-scale-computing": ["batteries"],           # the Rack holds batteries
    "fluid-wagon": ["fluid-handling", "packet-switching"],  # storage tank; the data wagon's data lines
    "statistical-learning": ["hypothesis-testing"],       # Articles take significant results
    "expected-utility": ["deep-learning"],                # Model cards take Ratings from Endpoints (R2-W)
}

TRIGGER = {
    "prior_art": {"type": "start"},
    "steam_power": {"type": "craft-item", "item": "iron-plate", "count": 50},
    "switching_circuits": {"type": "craft-item", "item": "copper-plate", "count": 10},
    "basic_research": {"type": "craft-item", "item": "seminar", "count": 1},
    "learning_curve": {"type": "craft-item", "item": "steel-plate", "count": 50},
    "text_categorization": {"type": "mine-entity", "entity": "exchange"},
    "isotope_separation": {"type": "mine-entity", "entity": "uranium-ore-patch"},
    "in_context_learning": {"type": "launch", "item": "post-training-payload"},
}


def build_techs():
    tree = json.load(open(E_TREE))
    codes = json.load(open(E_CODES))
    out = []
    for eid, t in tree.items():
        if eid in DROP:
            continue
        tid = ID_MAP.get(eid, kebab(eid))
        name, defn, cite, year = t["name"], t["defn"], t["cite"], t["year"]
        if eid in RENAMED:
            name, defn, cite, year = RENAMED[eid]
        if eid in DEF_FIX:
            defn, c2, y2 = DEF_FIX[eid]
            if c2:
                cite, year = c2, y2
        name = name.replace("★", "").strip()
        tech = {"id": tid, "name": name, "code": codes.get(eid, ""), "era": ERA.get(t["tier"], "")}
        pre = [ID_MAP.get(p, kebab(p)) for p in t["pre"] if p not in DROP]
        tech["prerequisites"] = pre
        cost = t["cost"]
        if eid in TRIGGER:
            tech["trigger"] = TRIGGER[eid]
        elif cost[0] == "formula":
            _, f, letters, time, _levels = cost
            if eid in FORMULA:
                f, first, mx = FORMULA[eid]
            else:
                f = norm_formula(f)
                mm = re.search(r"(\d+)\+$", t["name"])      # E names infinite techs "Name N+"
                first, mx = (int(mm.group(1)) if mm else 1), "infinite"
            tech["count_formula"] = f
            tech["first_level"] = first
            tech["max_level"] = mx
            tech["cost"] = {"time": time, "packs": {PACK[c]: 1 for c in letters}}
            tech["name"] = re.sub(r"\s*\d+\+$", "", name)
        else:
            count, letters, time = COST.get(eid, cost)
            tech["cost"] = {"count": count, "time": time, "packs": {PACK[c]: 1 for c in letters}}
        tech["unlocks"] = {"recipes": list(UNLOCKS.get(eid, []))}
        effects = EFFECTS.get(eid)
        if effects is None:
            # E's effect strings are the ones with a bonus; the rest name recipes (mapped in UNLOCKS)
            effects = parse_effects([s for s in t["unlocks"] if re.search(r"[+]|Damage:|Fire rate:", s)])
        if effects:
            tech["unlocks"]["effects"] = effects
        tech["mirrors"] = t["fid"] or "new"
        tech["definition"] = defn
        tech["citation"] = cite
        tech["year"] = year
        if t["essential"]:
            tech["essential"] = True
        if t["upgrade"]:
            tech["upgrade"] = True
        if t["branch"] == "M":
            tech["branch"] = "M"
        tech["_e"] = eid
        out.append(tech)
    for n in NEW_TECHS:
        tech = {"id": n["id"], "name": n["name"], "code": n["code"], "era": n["era"],
                "prerequisites": list(n["prerequisites"])}
        if "formula" in n:
            f, first, mx, letters, time = n["formula"]
            tech["count_formula"] = f
            tech["first_level"] = first
            tech["max_level"] = mx
            tech["cost"] = {"time": time, "packs": {PACK[c]: 1 for c in letters}}
        else:
            count, letters, time = n["cost"]
            tech["cost"] = {"count": count, "time": time, "packs": {PACK[c]: 1 for c in letters}}
        tech["unlocks"] = {"recipes": list(n["recipes"])}
        if n.get("effects"):
            tech["unlocks"]["effects"] = n["effects"]
        tech["mirrors"] = n["mirrors"]
        tech["definition"] = n["definition"]
        tech["citation"] = n["citation"]
        tech["year"] = n["year"]
        if n.get("essential"):
            tech["essential"] = True
        out.append(tech)
    ids = {t["id"] for t in out}
    for tid, adds in PREREQ_ADD.items():
        t = next(x for x in out if x["id"] == tid)
        for a in adds:
            assert a in ids, a
            if a not in t["prerequisites"]:
                t["prerequisites"].append(a)
    # Model generation: levels 6-24 (the capstone level 25 is its own tech)
    mg = next(x for x in out if x["id"] == "model-generation")
    mg["name"] = "Model generation"
    return out

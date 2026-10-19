# New entities and edits to D's entities: heat (F), staffing (B L9 / R2-W), deployment (F), endgame (G).

def E(id, name, type, size, energy, mirrors, desc, **kw):
    d = {"id": id, "name": name, "type": type, "size": size, "item": id, "energy": energy}
    d.update(kw)
    d["mirrors"] = mirrors
    d["desc"] = desc
    return d


EL = lambda kw, **x: dict({"source": "electric", "kw": kw}, **x)
NONE = {"source": "none", "kw": 0}

HALL_TIERS = [
    {"item": "accelerator", "speed": 1, "kw": 5000},
    {"item": "accelerator-2", "speed": 3, "kw": 8000},
    {"item": "accelerator-3", "speed": 8, "kw": 12000},
    {"item": "accelerator-4", "speed": 20, "kw": 16000},
]

NEW_ENTITIES = [
    # cooling (F §1.1; R2-W sizes and powers)
    E("cooling-tower", "Cooling tower", "cooler", [3, 3], EL(300), "new (F: active heat sink; Space Age biochamber's role)",
      "Absorbs heat in its chunk. Consumes water and power.", module_slots=2, consumes=["water"],
      heat={"removes_kw": 10000, "full_rate_dt_k": 5, "water_per_mj": 0.4425}),
    E("dry-cooler", "Dry cooler", "cooler", [2, 2], EL(200), "new (F)", "Rejects coolant heat into the air of its chunk.",
      consumes=["coolant"], produces=["coolant"],
      heat={"removes_kw": 20000, "coolant_in_min_c": 45, "coolant_out_c": 30}),
    E("water-exchanger", "Water exchanger", "cooler", [3, 3], EL(500), "new (F)",
      "Rejects coolant heat into the water it touches.", consumes=["coolant"], produces=["coolant"],
      heat={"removes_kw": 50000, "coolant_in_min_c": 45, "coolant_out_c": 30, "into": "the touched water tile's chunk"},
      extra={"placement": "must touch water"}),
    # containment (Contained preset) and the Wild line
    E("monitor", "Monitor", "turret", [2, 2], EL(300), "flamethrower-turret (tech slot); gun turret's role",
      "Cleans one compromised machine in range every 5 s.", consumes=["evaluation-set"],
      extra={"range": 24, "clean_interval_s": 5, "ammo": "evaluation-set"}),
    E("fence", "Fence", "wall", [1, 1], NONE, "stone-wall", "Stops bodies, not signals.",
      extra={"health": 350, "resist": {"acid": 0.8}}),
    E("gate", "Gate", "gate", [1, 1], NONE, "gate", "Opens for the player and vehicles.", extra={"health": 350}),
    E("gun-turret", "Gun turret", "turret", [2, 2], NONE, "gun-turret", "Fires magazines. Range 18.",
      consumes=["magazine", "ap-magazine", "du-magazine"],
      extra={"health": 400, "range": 18, "shots_per_s": 10, "ammo_category": "bullet"}),
    E("laser-turret", "Laser turret", "turret", [2, 2], EL(1200), "laser-turret",
      "Fires on grid power. Its power is heat.",
      extra={"health": 1000, "range": 24, "damage": 20, "shots_per_s": 1.5, "kj_per_shot": 800,
             "note": "kw is the draw while firing"}),
    E("arc-turret", "Arc turret", "turret", [3, 3], EL(3000), "tesla-turret (Space Age)",
      "Arcs between targets. Runaway bodies have no electric resistance.",
      extra={"range": 30, "damage_type": "electric", "chains": True,
             "note": "Space Age Tesla turret values; kw is an estimate to check against the 2.0 data"}),
    E("artillery-turret", "Artillery turret", "turret", [3, 3], NONE, "artillery-turret",
      "Fires at replicators within 224 tiles.", consumes=["artillery-shell"],
      extra={"health": 2000, "range": 224, "auto_targets": "replicators"}),
    E("artillery-wagon", "Artillery wagon", "other", [2, 6], NONE, "artillery-wagon", "Artillery on rails.",
      consumes=["artillery-shell"], extra={"range": 224, "rail_vehicle": True}),
    E("interceptor-bay", "Interceptor bay", "turret", [2, 2], EL(200), "new (F: defender capsules, launched by a building)",
      "Holds 20 interceptors and launches them at intruders within 30 tiles.",
      consumes=["interceptor", "interceptor-2", "interceptor-3"], extra={"capacity": 20, "dispatch_radius": 30,
                                                                       "note": "kw is the recharge draw; F gives none"}),
    E("land-mine", "Land mine", "other", [1, 1], NONE, "land-mine", "Triggers when a body steps on it."),
    E("tank", "Tank", "other", [3, 4], {"source": "burner", "kw": 600, "fuel_categories": ["chemical"]}, "tank (unarmed: L14)",
      "An armored tracked vehicle. 80 slots.", extra={"slots": 80, "weapons": [],
      "note": "no cannon or machine gun: the player never fights (B L14); turrets, artillery and legged agents fire on their own"}),
    E("legged-agent", "Legged agent", "other", [3, 3], NONE, "spidertron", "Walks over cliffs. Directed by remote.",
      consumes=["rocket", "explosive-rocket", "emp-warhead"],
      extra={"grid": [10, 6], "slots": 80, "note": "power from its equipment grid"}),
    # deployment and endgame
    E("endpoint", "Endpoint", "assembler", [3, 3], EL(1000), "new (F's deployment building)",
      "Serves a checkpoint to a town. Returns ratings.", crafting_speed=1, categories=["serving"], module_slots=2,
      heat={"class": "cluster", "liquid_cooling": True}, deploys=True,
      extra={"placement": "on an exchange tap; keeps working after the exchange closes to crawlers",
             "model_tier": "its checkpoint's: 1/2/3 after Deep learning/Attention/Instruction tuning; 4 for a frontier checkpoint"}),
    E("research-hall", "Research hall", "assembler", [7, 7], EL(5000, priority="interruptible"), "new (G: accelerator hall)",
      "Writes System cards. Runs on 20 accelerators and a frontier checkpoint.",
      crafting_speed=1, categories=["research-run"], module_slots=4,
      heat={"class": "accelerator", "liquid_cooling": True}, deploys=True,
      extra={"accelerator_load": 20, "tiers": HALL_TIERS, "weights_slot": "frontier-checkpoint",
             "note": "speed and draw follow the loaded accelerator tier; the frontier checkpoint in the weights slot is not consumed"}),
    E("fusion-reactor", "Fusion reactor", "reactor", [6, 6],
      {"source": "burner", "kw": 100000, "fuel_categories": ["fusion"]}, "fusion-reactor (Space Age)",
      "Fuses hydrogen isotopes into plasma. Each active neighbour adds 100%.",
      consumes=["fusion-power-cell"], produces=["plasma"], heat={"emission": "conversion"},
      extra={"electric_kw": 10000, "plasma_per_s": 4, "plasma_mw": 100, "feeds_generators": 2,
             "neighbour_bonus": "+100% per adjacent active reactor (as fission)"}),
    E("fusion-generator", "Fusion generator", "generator", [3, 5], NONE, "fusion-generator (Space Age)",
      "50 MW from plasma.", consumes=["plasma"], heat={"emission": "none"},
      extra={"max_kw": 50000, "plasma_per_s": 2}),
    E("verifier", "Verifier", "furnace", [2, 4], EL(180), "recycler",
      "Rejects what fails. Returns a quarter of a rejected item's ingredients.",
      crafting_speed=0.5, categories=["recycling"], module_slots=4,
      extra={"returns": 0.25, "note": "every item has a generated recycling recipe (ISO); only scrap's is listed"}),
    E("deployer", "Constructor", "other", [1, 1], NONE, "new (Recursive Blueprints' deployer chest; G's Deployer; named Constructor, DECISIONS §19)",
      "Builds the blueprint it holds where a circuit signal says.",
      extra={"holds": "one blueprint or blueprint book",
             "circuit": "deploy blueprint N at X,Y with rotation R; deconstruct or upgrade an area; copy a blueprint",
             "built_by": "construction agents (ghosts)"}),
    E("area-scanner", "Area scanner", "combinator", [1, 1], EL(50), "new (Recursive Blueprints' scanner)",
      "Reports what lies in an area as signals.",
      extra={"reads": "resources, entities and ghosts in a rectangle set by signals"}),
]

# D's entities: fields added or replaced (desc comes from text_items.DESC)
COMPUTING = {"data-refinery": "computer", "data-plant": "computer", "tokenizer": "computer",
             "trainer": "cluster", "switch": "cluster", "frontier-cluster": "accelerator"}

ENTITY_EDITS = {
    "boiler": {"categories": None, "consumes": ["water"], "produces": ["steam"], "heat": {"emission": "conversion"}},
    "heat-exchanger": {"categories": None, "consumes": ["water"], "produces": ["steam"], "heat": {"emission": "none"}},
    "steam-engine": {"consumes": ["steam"], "heat": {"emission": "none"}},
    "steam-turbine": {"consumes": ["steam"], "heat": {"emission": "none"}},
    "nuclear-reactor": {"categories": None,
                        "energy": {"source": "burner", "kw": 40000, "fuel_categories": ["nuclear"]},
                        "consumes": ["uranium-fuel-cell"], "produces": ["depleted-uranium-fuel-cell"],
                        "heat": {"emission": "twice-output"}},
    "offshore-pump": {"produces": ["water"]},
    "seminar": {"staff_slots": 1, "staff_demand": 1},
    "frontier-cluster": {"extra": {"parts_required": 100, "idle_kw": 250, "payload": "post-training-payload or final-report",
                                   "returns": "1000 system-card + 1 frontier-checkpoint"}},
}

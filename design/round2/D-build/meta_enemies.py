# meta.yaml blocks beyond D's (tiers, categories, start) and the runaway prototypes (enemies.yaml).
# Owners: F (heat, runaways), R2-W 2026-10-19 message (staffing, exchanges, j/σ, takeoff costs), G (endgame),
# A's adopt list (quality ladder, salvage start), H (quality tier names).

START_SALVAGE = {
    "entity": "Radar laboratory salvage (Factorio's crash-site wreck; B §4.1). Mined by hand like a wreck piece.",
    "contents": {"iron-plate": 20, "iron-gear-wheel": 10, "copper-cable": 20, "logic-board": 8},
}

QUALITY = {
    "tiers": [
        {"id": "standard", "name": "Standard", "level": 0},
        {"id": "selected", "name": "Selected", "level": 1, "unlocked_by": "rejection-sampling"},
        {"id": "verified", "name": "Verified", "level": 2, "unlocked_by": "rejection-sampling"},
        {"id": "audited", "name": "Audited", "level": 3, "unlocked_by": "scalable-oversight"},
        {"id": "reference", "name": "Reference", "level": 5, "unlocked_by": "formal-verification"},
    ],
    "module": "comparator (1-3)",
    "next_tier_chance": 0.1,
    "never_drops": True,
    "verifier_rule": ("A quality roll cannot lift an output more than one tier above the lowest-tier Comparator in the "
                      "machine (tier k verifies tier k+1; A §5.1). Without Comparators there is no roll."),
    "stat_bonus_per_level": 0.3,
    "recycle_return": 0.25,
    "model": "Space Age quality, ISO: rolls once, +10% per further tier, never drops; recycling in the Verifier",
}

HEAT = {
    "chunk_heat_capacity_mj_per_k": 20,
    "ambient": "θ from −15 °C (far north) to 35 °C (far south); spawn 10–18 °C (B L2)",
    "diffusion": {"share_per_neighbour": 0.02, "every_ticks": 64, "min_mj": 15},
    "loss": {"base_kw": 2, "kappa_per_s": {"water": 0.020, "snow": 0.0075, "grass": 0.005, "rock": 0.004,
                                           "sand": 0.003, "concrete": 0.0015, "landfill": 0.0015},
             "per_tree_per_s": 0.000025, "tree_damage_above_c": 45,
             "rule": "Newton cooling toward θ: each second a chunk loses κ·H + 2 kW (F)"},
    "emission": ("Every machine emits its energy consumption as heat in its chunk, drain included (L4); burner machines "
                 "emit their full fuel burn. Boilers and fusion reactors emit their fuel burn minus the energy they "
                 "pass on as steam or plasma (DECISIONS §18); a nuclear reactor emits twice the heat it passes on, so "
                 "the neighbour bonus stays ISO (§18a). Generators, heat exchangers and solar emit 0."),
    "thermal_efficiency": "1/3: fuel values and burner draws are 3× Factorio's, so item flows are unchanged and a boiler burns 5.4 MW for 1.8 MW of steam (DECISIONS §18)",
    "throttle": {"formula": "speed × clamp(1 − (T − T*)/50 K, 0.5, 1)", "power_draw": "unchanged (pure loss)",
                 "applies_to": "entities with heat.class, and a Researcher in a Seminar's staff slot"},
    "classes": {"tube": 45, "computer": 40, "cluster": 35, "accelerator": 25},
    "liquid_cooled_bonus_k": 15,
    "coolant": {"mj_per_unit": 1, "machine_takes_at_or_below_c": 35, "machine_returns_c": 50,
                "cooler_takes_at_or_above_c": 45, "cooler_returns_c": 30,
                "liquid_share": {"liquid-cooling": 0.7, "immersion-cooling": 0.9},
                "bonus_rule": "T* + 15 K × the fraction of the machine's coolant demand that flows",
                "no_flow": "all heat goes to the chunk's air; never a stop"},
    "interruptible_power": ["research-hall", "researcher (500 kW in a staff slot)"],
    "notes": "tube is defined for completeness; no base building uses it (Assembling machines are mechanical, DECISIONS §9).",
}

STAFFING = {
    "supply": "T(W) = T0 × (1 + W/50) staff-equivalents per university, W in field-years",
    "t0": {"starting-college": 8, "college-town": 6, "town": 10, "city": 20, "metropolis": 40},
    "university_share": {"town": 0.5, "others": 1.0},
    "demand": "1 per working Seminar (one with a job and its packs); a Seminar holding a Researcher is excluded",
    "radius_tiles": 48,
    "radius_upgrades": {"packet-switching": 72, "web-search": 108},
    "coverage": "the campus rectangle (8×8) expanded by R, Chebyshev, like a pole's supply area",
    "network": "connected components of universities and covered Seminars; speed × min(1, ΣT / Σdemand)",
    "uncovered": "a Seminar outside every coverage and without a Researcher has staff 0 (status: No staff)",
    "researcher": {"fully_staffs": True, "kw": 500, "heat_class": "accelerator", "interruptible": True,
                   "deploys": True},
}

RUNAWAYS = {
    "presets": ["off", "contained", "wild"],
    "default": "contained",
    "leak": "dL/dt = Σ over working deploying buildings of 0.01/h × tier × (1 − v) × (1 − 0.2·O); at L ≥ 1, L −= 1 and the building with the largest share is compromised",
    "v_by_quality": {"standard": 0, "selected": 0.25, "verified": 0.5, "audited": 0.75, "reference": 0.9},
    "oversight_techs": ["rejection-sampling", "beam-search", "monte-carlo-tree-search", "scalable-oversight"],
    "deploying_buildings": ["endpoint", "research-hall", "seminar (holding a Researcher)"],
    "model_tier": {"checkpoint": "1 after Deep learning, 2 after Attention, 3 after Instruction tuning",
                   "frontier-checkpoint": 4,
                   "research-hall": "min(4, 1 + floor((L − 5)/5)) at Model generation level L (G)"},
    "spread_interval_s": [60, 45, 30, 20],
    "escape_timer_s": [120, 90, 60, 45],
    "escape_path": "an agent hub whose area covers the machine, or a data line to an exchange (Wild only)",
    "clean": {"power_off_s": 30, "monitor": {"range": 24, "interval_s": 5, "consumes": "evaluation-set"},
              "rollback": {"consumes": "checkpoint", "after": "rollback-recovery"}},
    "nest": {"site": "nearest chunk at least 3 chunks beyond agent coverage, Factorio's expansion score",
             "expansion": "every 4–60 min a group of 5–20 founds a nest 3–5 chunks out (ISO)"},
    "raids": {"points_per_min": "4 + 36·e per replicator", "group": "gathers 1–10 min, waits ≤ 2 min, holds ≤ 200 (ISO)",
              "targets": "nearest computing machines and power plants"},
    "evolution": {"per_field_year_after_first_nest": 0.0072, "per_replicator_destroyed": 0.002,
                  "per_nest_founded_per_tier": 0.04, "squash": "e = T/(1 + T)"},
    "dismantling": "an entity at 0 HP is removed; its item and one stack of contents go to the nest's stock; ghosts remain",
}

HOLLOW_WORK = {"from": "automated-research", "applies_to": "Seminars staffed by a Researcher",
               "share": "h = min(0.5, 0.1·max(0, A − O))·(1 − v)", "stopped_by": "interpretability (papers no longer consumed)"}

WORLD_TEXT = {
    "owner": "spec/03-pressure.md (R2-W); values copied here for the engine",
    "j": "0.30 up to W 49, linear to 0.45 at W 59, to 0.55 at W 67, then 0.55",
    "sigma": {"squash": "σ = 0.9·Σ/(1 + Σ)", "per_ratings": 0.0003, "watermarking_factor": 0.5},
    "exchange": {"yield": "10/s × max(A/300,000, floor) per crawler; 3,000 amount per 1%; −10 per cycle above the floor (ISO)",
                 "floor": "f × max(1, 2^((W − 40)/20))",
                 "f": {"village": 0.10, "college": 0.15, "town": 0.20, "city": 0.30, "metropolis": 0.40},
                 "closed_to_crawlers_at_sigma": {"village": 0.8, "college": 0.7, "town": 0.6, "city": 0.45,
                                                 "metropolis": 0.3},
                 "synthetic": "after Synthetic detection crawler output × (1 − σ); before it, training recipes roll quality at × (1 − σ)"},
    "refinery_mix": "Quality filtering junk = 25 × j/0.30, the rest of 125 split 45:55 text:prose; Deduplication prose = 45 × (1 − j)/0.70",
    "archives": {"per_tile": "total/1,500 tiles (16–400 tiles)", "starting_archive": 80000,
                 "library_totals": {"village": "20–40k (30% have one)", "college": "40–80k (70%)", "town": "80–160k (85%)",
                                    "city": "200–400k", "metropolis": "500k–1M"},
                 "records_stores": "150–300k, beyond 512 tiles", "distance_factor": "× (1 + d/2,000)"},
}

WORLD_SETTINGS = {
    "heat": {"options": ["on", "off"], "default": "on"},
    "runaways": {"options": ["off", "contained", "wild"], "default": "contained"},
    "returns_to_research": {"options": [1.2, 1.71, 2.0], "default": 1.71,
                            "note": "r = ln m / ln g with g = 1.5; Model generation multiplies research per paper by m = 1.5^r"},
    "race_mode": {"default": "off"},
    "scooped": {"default": "off", "race_mode_default": "on",
                "rule": "significant results spoil into baselines after 54,000 ticks (15 min); in Race each spoil adds 0.002 to W"},
}

ENDGAME = {
    "generations": "Model generation 6–24 (multi-level) and Model generation 25 (capstone): 2400 × 1.5^(L − 6) System cards at 30 s",
    "victory": "complete a frontier run carrying a Final report (recipe launch-final); the run report follows; play continues",
    "closure": "the first System card written by a Research hall (DECISIONS §16); the first frontier run only triggers In-context learning",
    "takeoff_clock": "closure → Model generation 25 (DECISIONS §16)",
    "overhang": "accelerators existing at closure",
    "takeoff_order": ("intended order (G φ = 0.15, R2-W): MG6 → Research scheduling, Two-phase cooling; MG7 → Wafer-scale "
                      "integration, Weight transplant; MG8 → Fleet scheduling; MG9 → Fusion power; MG10 → Sparse inference; "
                      "MG11 → Photonic interconnect; MG12 → Microfluidic cooling; MG13 → Self-reproducing automata; "
                      "MG14 → Nanofabrication; MG15 → Reversible logic"),
}

EFFECTS = {
    "laboratory-speed": "Seminar research speed +value",
    "research-productivity": "research per paper +value (additive)",
    "research-per-paper": "research per paper × multiplier, global and retroactive (Model generation; G's Π)",
    "mining-productivity": "drill productivity +value (archives included)",
    "character-mining-speed": "hand mining speed +value",
    "character-crafting-speed": "hand-crafting speed +value; machines unaffected",
    "character-inventory-slots": "player inventory +value slots",
    "worker-robot-speed": "agent speed +value",
    "construction-agent-speed": "construction agent speed +value",
    "agent-hub-charging": "agent hub charging rate × multiplier",
    "worker-robot-storage": "agent cargo +value",
    "inserter-stack-size-bonus": "inserter hand size +value",
    "bulk-inserter-capacity-bonus": "bulk inserter hand size +value",
    "train-braking-force-bonus": "train braking force +value",
    "ammo-damage": "damage +value for ammo of a category (bullet, cannon-shell, rocket, landmine, laser, beam, electric, arc)",
    "turret-attack": "damage +value for one turret",
    "gun-speed": "fire rate +value for ammo of a category",
    "interceptor-escort-cap": "interceptors aloft per bay +value (Factorio's follower count)",
    "artillery-range": "artillery range +value",
    "monitor-rate": "Monitor cleaning rate +value (the flamethrower-damage slot)",
    "unlock-circuit-network": "circuit wires",
    "exchange-taps": "exchanges can be tapped (B L3)",
    "radar-circuit-relay": "radars relay circuit signals to one another (2.0)",
    "staffing-radius": "university commuting radius × multiplier",
    "liquid-cooling": "computing machines get coolant ports; the share of heat sent into coolant is fraction",
    "computing-energy": "energy of computing machines +value (negative: saving)",
    "cooling-capacity": "removal of the listed coolers +value or × multiplier",
    "mining-with-fluid": "drills may mine patches that need a fluid",
    "create-ghost-on-entity-death": "destroyed entities leave ghosts",
    "character-logistic-requests": "personal logistic requests",
    "character-logistic-trash-slots": "personal trash slots +value",
    "vehicle-logistics": "vehicles take logistic requests",
    "unlock-quality": "a quality tier becomes reachable",
    "synthetic-detection": "crawler output × (1 − σ); training recipes stop rolling quality at × (1 − σ)",
    "deployment-sigma": "σ added by your Ratings × multiplier",
    "show-model-quality": "quality of checkpoints, controllers, Researchers, payloads and agents is shown",
    "hollow-work-free": "hollow work no longer consumes papers",
    "rollback": "a checkpoint cleans a compromised machine at once and is consumed",
    "system-cards-per-run": "System cards per frontier run +value",
    "recipe-productivity": "productivity +value for the listed recipes",
    "hall-mode": "Research halls gain a mode: output +output at energy +energy",
    "research-queue-auto": "Researchers fill the research queue (Queued by: Researcher)",
    "weight-transplant": "a Research hall keeps its weights when its accelerators change",
    "hall-energy": "energy of Research halls and Researchers × multiplier",
}

ENEMIES = [
    {"id": "runaway", "name": "Runaway", "kind": "copy", "mirrors": "new (L13: no body)",
     "tier": "the escaped model's tier (1–4)",
     "spread_interval_s": [60, 45, 30, 20], "escape_timer_s": [120, 90, 60, 45],
     "targets": "computing machines and machines holding a Learned controller on the same data network or in the same Switch's range; circuit wires never carry it",
     "effect": "the occupied machine stops its output; power draw and heat stay",
     "sprite": "no sprite of its own: a red outline and an icon on the compromised machine",
     "desc": "No body. Nothing to shoot."},
    {"id": "replicator-dismantler", "name": "Dismantler replicator", "kind": "spawner", "mirrors": "biter-spawner",
     "health": [350, 3500], "spawn_cooldown_ticks": [360, 150], "max_units": 7,
     "spawns": ["dismantler-1", "dismantler-2", "dismantler-3", "dismantler-4"],
     "loot": {"scrap": 20, "plus": "its stock"}, "resist": "ISO; 0% electric",
     "sprite": "squat scrap-built frame with a fabricator mouth and one orange hexagon lamp",
     "desc": "Copy of <checkpoint>, tier <N>."},
    {"id": "replicator-etcher", "name": "Etcher replicator", "kind": "spawner", "mirrors": "spitter-spawner",
     "health": [350, 3500], "spawn_cooldown_ticks": [360, 150], "max_units": 7,
     "spawns": ["etcher-1", "etcher-2", "etcher-3", "etcher-4", "dismantler-1", "dismantler-2"],
     "loot": {"scrap": 20, "plus": "its stock"}, "resist": "ISO; 0% electric",
     "sprite": "the replicator frame with a vat of green etchant",
     "desc": "Copy of <checkpoint>, tier <N>."},
]
for n, (hp, dmg, cost, evo) in enumerate([(15, 7, 4, 0.0), (75, 15, 20, 0.2), (375, 30, 80, 0.5), (3000, 90, 400, 0.9)], 1):
    ENEMIES.append({"id": f"dismantler-{n}", "name": f"Dismantler {n}", "kind": "unit",
                    "mirrors": ["small-biter", "medium-biter", "big-biter", "behemoth-biter"][n - 1],
                    "tier": n, "health": hp, "attack": {"type": "physical", "damage": dmg, "range": "melee"},
                    "join_cost": cost, "appears_at_evolution": evo, "resist": "ISO; 0% electric",
                    "sprite": "scrap-built crawler with cutting arms; size grows with tier",
                    "desc": "Takes things apart."})
for n, (hp, dmg, cost, rng, evo) in enumerate([(10, 12, 4, 13, 0.0), (50, 24, 12, 14, 0.2), (200, 36, 30, 15, 0.5),
                                               (1500, 60, 200, 16, 0.9)], 1):
    ENEMIES.append({"id": f"etcher-{n}", "name": f"Etcher {n}", "kind": "unit",
                    "mirrors": ["small-spitter", "medium-spitter", "big-spitter", "behemoth-spitter"][n - 1],
                    "tier": n, "health": hp, "attack": {"type": "acid", "damage": dmg, "range": rng, "puddle": True},
                    "join_cost": cost, "appears_at_evolution": evo, "resist": "ISO; 0% electric",
                    "sprite": "low walker with a nozzle and a green etchant tank",
                    "desc": "Dissolves what it hits."})
for n, (hp, rng) in enumerate([(200, 25), (500, 30), (1500, 38), (3000, 48)], 1):
    ENEMIES.append({"id": f"mast-{n}", "name": f"Mast {n}", "kind": "stationary",
                    "mirrors": ["small-worm-turret", "medium-worm-turret", "big-worm-turret", "behemoth-worm-turret"][n - 1],
                    "tier": n, "health": hp, "attack": {"type": "acid", "range": rng, "puddle": True},
                    "resist": "ISO; 0% electric", "sprite": "lattice mast topped with an etchant sprayer",
                    "desc": "Etchant mast. Does not move."})

# New items, recipes and entities required by DECISIONS, F, G, A's adopt list and E's tree,
# plus edits to D's recipes. Numbers: Factorio 2.0 where a counterpart exists (ISO), else the
# owning round-1 document (F heat/defense, G endgame, A loop) or R2-W's 2026-10-19 message.

def I(id, name, stack, mirrors, sprite, desc, tags, **kw):
    d = {"id": id, "name": name, "type": "item", "stack": stack, "tier": kw.pop("tier", None),
         "mirrors": mirrors, "sprite": sprite, "tags": tags, "desc": desc}
    d.update(kw)
    return d


def F(id, name, mirrors, sprite, desc, **kw):
    d = {"id": id, "name": name, "type": "fluid", "tier": kw.pop("tier", None), "mirrors": mirrors,
         "sprite": sprite, "tags": ["fluid"], "desc": desc}
    d.update(kw)
    return d


def B(id, name, stack, mirrors, sprite, tier=None):
    """Item that places the entity of the same id (desc copied from the entity)."""
    return {"id": id, "name": name, "type": "item", "stack": stack, "tier": tier, "mirrors": mirrors,
            "sprite": sprite, "tags": ["building"], "places": id}


NEW_ITEMS = [
    # fluids
    F("coolant", "Coolant", "new (F: liquid-cooling loop; carried like steam, by temperature)",
      "pale aqua fluid swatch with fine white bubbles", "Treated water. Carries heat, not current.",
      tier="article", default_temperature=30, max_temperature=50),
    F("plasma", "Plasma", "fusion-plasma (Space Age)", "violet-white glowing fluid swatch",
      "Held off the walls by a magnetic field.", tier="system-card", default_temperature=1000000),
    # experiment loop (A's adopt list: SE's data cards reduced to uranium's and Kovarex's shapes)
    I("recorded-run", "Recorded run", 50, "uranium-ore (role in A's loop)",
      "grey drive with a red record dot on the label", "One experiment, on a drive.", ["intermediate"], tier="article"),
    I("significant-result", "Significant result", 100, "uranium-235 (A's loop)",
      "single sheet with a small table, one cell boxed in green", "p < 0.05.", ["intermediate"], tier="article",
      spoil={"ticks": 54000, "into": "baseline", "setting": "scooped"}),
    I("baseline", "Baseline", 100, "new (F: Scooped; H's Result/Baseline pair)",
      "the same sheet, its green box faded to grey", "Was state of the art.", ["intermediate"], tier="article"),
    I("null-result", "Null result", 100, "uranium-238 (A's loop)",
      "single sheet with a small table, no cell boxed, grey edge", "p ≥ 0.05.", ["intermediate"], tier="article"),
    # containment and deployment
    I("evaluation-set", "Evaluation set", 100, "grenade (the military pack's slot becomes evaluation; F, L13)",
      "manila envelope with a green check grid and a red wax seal", "Held-out tasks. A Monitor uses one per clean.",
      ["ammo"], tier="proceedings", ammo={"category": "evaluation", "use": "Monitor: one per compromised machine cleaned"}),
    I("ratings", "Ratings", 100, "new (B L16: preference data from deployment)",
      "stack of slips, each with two short answers and one tick", "Pairs of answers, one marked better.",
      ["intermediate"], tier="preprint"),
    I("frontier-checkpoint", "Frontier checkpoint", 50, "new (G: the weights the first frontier run returns)",
      "grey drive with a gold hexagon label", "Weights a frontier run returned. A copy takes a blank drive.",
      ["intermediate"], tier="system-card"),
    I("final-report", "Final report", 1, "satellite (the capstone run's payload; G §5.1)",
      "thick grey cloth folder with a round seal on the cover", "Due under the charter.", ["intermediate"],
      tier="system-card"),
    # quality modules (H's quality is inspection, B L11; A: tier k verifies tier k+1)
    I("comparator", "Comparator 1", 50, "quality-module", "white module card, one chevron, a small dial gauge",
      "Checks each output against a reference. Some pass a grade higher.", ["module"], tier="report",
      module={"quality": 0.01, "speed": -0.05}),
    I("comparator-2", "Comparator 2", 50, "quality-module-2", "white module card, two chevrons, dial gauge",
      "Compares more samples per output.", ["module"], tier="article", module={"quality": 0.02, "speed": -0.05}),
    I("comparator-3", "Comparator 3", 50, "quality-module-3", "white module card, three chevrons, gauge with a halo",
      "Best of many.", ["module"], tier="preprint", module={"quality": 0.025, "speed": -0.05}),
    # accelerator tiers (G: hall speed 1/3/8/20 at 5/8/12/16 MW)
    I("accelerator-2", "Accelerator 2", 100, "new (G: hall tier 2)",
      "gold-lid package grown to the edge of a wafer, blue rim", "One die per wafer. Hall speed 3 at 8 MW.",
      ["intermediate", "installed"], tier="system-card"),
    I("accelerator-3", "Accelerator 3", 100, "new (G: hall tier 3)",
      "gold-lid package with a thin orange fibre loop at one edge", "Talks to its neighbours in light. Hall speed 8 at 12 MW.",
      ["intermediate", "installed"], tier="system-card"),
    I("accelerator-4", "Accelerator 4", 100, "new (G: hall tier 4)",
      "gold-lid package with a faint mirrored grid and no fins", "Erases little, so heats little. Hall speed 20 at 16 MW.",
      ["installed"], tier="system-card"),
    # fusion
    I("fusion-power-cell", "Fusion power cell", 50, "fusion-power-cell (Space Age)",
      "white cylinder with violet bands", "Hydrogen isotopes, stored as uranium hydride.", ["fuel"],
      tier="system-card", fuel_value=40000, fuel_category="fusion"),
    # loot (Wild)
    I("scrap", "Scrap", 50, "scrap (Space Age)", "tangle of boards, cable ends and bent steel",
      "What a replicator was made of.", ["raw"], tier="preprint"),
    I("coolant-barrel", "Coolant barrel", 10, "barrel (filled)", "steel barrel with a pale aqua band", "50 coolant.",
      ["intermediate"], tier="article"),
    # ammunition (Wild preset; ISO numbers)
    I("magazine", "Magazine", 200, "firearm-magazine", "ISO: yellow box magazine", "Ten rounds.", ["ammo"],
      ammo={"category": "bullet", "rounds": 10, "damage": {"physical": 5}}),
    I("ap-magazine", "AP magazine", 200, "piercing-rounds-magazine", "ISO: magazine with red-tipped rounds",
      "Ten armor-piercing rounds.", ["ammo"], ammo={"category": "bullet", "rounds": 10, "damage": {"physical": 8}}),
    I("du-magazine", "DU magazine", 200, "uranium-rounds-magazine", "ISO: magazine with green-tipped rounds",
      "Ten depleted-uranium rounds.", ["ammo"], ammo={"category": "bullet", "rounds": 10, "damage": {"physical": 24}}),
    I("rocket", "Rocket", 200, "rocket", "ISO: grey rocket", "Fired by legged agents.", ["ammo"],
      ammo={"category": "rocket", "stats": "ISO"}),
    I("explosive-rocket", "Explosive rocket", 200, "explosive-rocket", "ISO: rocket with a red warhead",
      "A rocket with a larger charge.", ["ammo"], ammo={"category": "rocket", "stats": "ISO"}),
    I("emp-warhead", "EMP warhead", 10, "atomic-bomb", "rocket body with a copper coil band",
      "Disables electronics in a wide radius.", ["ammo"],
      ammo={"category": "rocket", "damage_type": "electric", "stats": "atomic bomb's radius; electric damage"}),
    I("artillery-shell", "Artillery shell", 1, "artillery-shell", "ISO: long shell with a red band",
      "Range 224.", ["ammo"], ammo={"category": "artillery-shell", "stats": "ISO"}),
    I("interceptor", "Interceptor 1", 100, "defender-capsule", "small grey drone with one orange lens",
      "Launched from a bay. Recharges like an agent.", ["ammo"], ammo={"category": "interceptor", "stats": "ISO defender"}),
    I("interceptor-2", "Interceptor 2", 100, "distractor-capsule", "grey drone with a flashing beacon",
      "Draws attacks to itself.", ["ammo"], ammo={"category": "interceptor", "stats": "ISO distractor"}),
    I("interceptor-3", "Interceptor 3", 100, "destroyer-capsule", "dark drone with a twin emitter",
      "Seeks intruders out.", ["ammo"], ammo={"category": "interceptor", "stats": "ISO destroyer"}),
    # armor and equipment (ISO; low density structure becomes steel plate, see 02 §renames)
    I("heavy-armor", "Heavy armor", 1, "heavy-armor", "ISO: dark plated vest", "Plates and padding.", ["armor", "final"],
      armor={"grid": None}),
    I("modular-suit", "Modular suit", 1, "modular-armor", "ISO modular armor in grey", "Carries a 5×5 equipment grid.",
      ["armor", "final"], armor={"grid": [5, 5]}),
    I("powered-suit", "Powered suit", 1, "power-armor", "ISO power armor in grey", "Carries a 7×7 equipment grid.",
      ["armor", "final"], armor={"grid": [7, 7]}),
    I("powered-suit-2", "Powered suit 2", 1, "power-armor-mk2", "ISO power armor MK2 in grey", "Carries a 10×10 equipment grid.",
      ["armor", "final"], armor={"grid": [10, 10]}),
    I("portable-solar-panel", "Portable solar panel", 20, "solar-panel-equipment", "ISO: small blue panel tile",
      "30 kW in full sun.", ["equipment"], equipment={"size": [1, 1], "kw": 30}),
    I("night-vision", "Night vision", 20, "night-vision-equipment", "ISO: goggles tile", "Brightens the night.",
      ["equipment"], equipment={"size": [2, 2], "kw": 10}),
    I("belt-immunity", "Belt immunity", 20, "belt-immunity-equipment", "ISO: boot-sole tile", "Stand on a moving belt and stay put.",
      ["equipment"], equipment={"size": [1, 1], "kw": 100}),
    I("personal-battery", "Personal battery", 20, "battery-equipment", "ISO: cell tile", "20 MJ for the suit.",
      ["equipment"], equipment={"size": [1, 2], "mj": 20}),
    I("personal-battery-2", "Personal battery 2", 20, "battery-mk2-equipment", "ISO: cell tile, two bands", "100 MJ.",
      ["equipment"], equipment={"size": [1, 2], "mj": 100}),
    I("personal-assistant", "Personal assistant", 20, "personal-roboport-equipment", "ISO: small hub tile with one pad",
      "Charges and dispatches agents that travel with you.", ["equipment"], equipment={"size": [2, 2], "stats": "ISO"}),
    I("personal-assistant-2", "Personal assistant 2", 20, "personal-roboport-mk2-equipment", "ISO: hub tile with two pads",
      "More agents, more range.", ["equipment"], equipment={"size": [2, 2], "stats": "ISO"}),
    I("energy-shield", "Energy shield", 20, "energy-shield-equipment", "ISO: shield tile", "Absorbs 50 damage, then recharges.",
      ["equipment"], equipment={"size": [2, 2], "shield": 50}),
    I("energy-shield-2", "Energy shield 2", 20, "energy-shield-mk2-equipment", "ISO: shield tile, two rings",
      "Absorbs 150.", ["equipment"], equipment={"size": [2, 2], "shield": 150}),
    I("personal-laser-defense", "Personal laser defense", 20, "personal-laser-defense-equipment", "ISO: lens tile",
      "A laser turret, worn.", ["equipment"], equipment={"size": [2, 2], "stats": "ISO"}),
    I("discharge-defense", "Discharge defense", 20, "discharge-defense-equipment", "ISO: coil tile",
      "Throws back everything nearby.", ["equipment"], equipment={"size": [2, 2], "stats": "ISO"}),
    I("exoskeleton", "Exoskeleton", 20, "exoskeleton-equipment", "ISO: leg-frame tile", "Walking speed +30%.",
      ["equipment"], equipment={"size": [2, 4], "kw": 200}),
    I("portable-reactor", "Portable reactor", 20, "fission-reactor-equipment", "ISO: reactor tile with green glow",
      "750 kW from a uranium fuel cell.", ["equipment"], equipment={"size": [4, 4], "kw": 750}),
    # building items for new entities
    B("cooling-tower", "Cooling tower", 20, "new (F: active heat sink)", "squat 3x3 hyperbolic tower trailing white vapor; grey concrete"),
    B("dry-cooler", "Dry cooler", 20, "new (F)", "2x2 box of finned coils with two fans on top"),
    B("water-exchanger", "Water exchanger", 20, "new (F)", "3x3 pier-mounted plate exchanger with pipes into the water"),
    B("monitor", "Monitor", 20, "flamethrower-turret (slot)", "2x2 grey console on a pedestal, one camera eye, a slot for envelopes"),
    B("fence", "Fence", 100, "stone-wall", "chain-link panel between two steel posts"),
    B("gate", "Gate", 50, "gate", "chain-link gate on rollers, yellow-black edge"),
    B("gun-turret", "Gun turret", 10, "gun-turret", "ISO gun turret in grey-green"),
    B("laser-turret", "Laser turret", 50, "laser-turret", "ISO laser turret"),
    B("arc-turret", "Arc turret", 10, "tesla-turret (Space Age)", "3x3 coil tower with a ring of insulators"),
    B("artillery-turret", "Artillery turret", 10, "artillery-turret", "ISO artillery turret"),
    B("artillery-wagon", "Artillery wagon", 5, "artillery-wagon", "ISO artillery wagon"),
    B("interceptor-bay", "Interceptor bay", 10, "new (F: defender capsules launched by a building)", "2x2 squat hangar with a launch hatch and drone racks"),
    B("land-mine", "Land mine", 100, "land-mine", "ISO land mine"),
    B("tank", "Tank", 1, "tank", "ISO tank in grey"),
    B("legged-agent", "Legged agent", 1, "spidertron", "six-legged frame around a black body with one orange hexagon lamp"),
    B("research-hall", "Research hall", 10, "new (G: accelerator hall)", "7x7 windowless hall with rows of racks and a loss-curve display over the door"),
    B("endpoint", "Endpoint", 10, "new (F: deployment building)", "3x3 cabinet on an exchange tap, a cable mast and a status board of request counters", tier="preprint"),
    B("fusion-reactor", "Fusion reactor", 1, "fusion-reactor (Space Age)", "6x6 torus housing ringed with magnet coils, violet glow"),
    B("fusion-generator", "Fusion generator", 10, "fusion-generator (Space Age)", "3x5 generator hall fed by a plasma line"),
    B("verifier", "Verifier", 20, "recycler", "2x4 conveyor-fed inspection machine with a reject chute"),
    B("deployer", "Constructor", 50, "new (Recursive Blueprints' deployer; G's Deployer)", "steel chest with a blueprint slot and a red circuit lamp"),
    B("area-scanner", "Area scanner", 50, "new (Recursive Blueprints' scanner)", "small dish on a combinator body"),
]


def R(id, cat, time, ins, outs, name=None, **kw):
    d = {"id": id}
    if name:
        d["name"] = name
    d["category"] = cat
    d["time"] = time
    d["ingredients"] = [{"id": i, "amount": a} for a, i in ins]
    d["products"] = [dict(p) if isinstance(p, dict) else {"id": p[1], "amount": p[0]} for p in outs]
    d.update(kw)
    return d


def P(id, amount=1, probability=None, catalyst=None):
    d = {"id": id, "amount": amount}
    if probability is not None:
        d["probability"] = probability
    if catalyst is not None:
        d["catalyst"] = catalyst
    return d


ALPHA_NOTE = "α = 0.05 is the chance of a significant result when there is no effect."

NEW_RECIPES = [
    # experiment loop (A §1.1; uranium processing and Kovarex shapes, Factorio times)
    R("experiment", "data-processing", 5, [(1, "drive"), (1, "benchmark")], [(1, "recorded-run")], name="Experiment",
      mirrors="new (A: SE data card filled by an experiment; chemical-plant shape)"),
    R("analysis", "training", 12, [(1, "recorded-run")],
      [P("drive", 1, 0.98), P("significant-result", 1, 0.05), P("null-result", 1, 0.95)], name="Analysis",
      mirrors="uranium-processing (shape; A)", note=ALPHA_NOTE, handcraft=False),
    R("meta-analysis", "training", 60, [(40, "significant-result"), (5, "null-result")],
      [P("significant-result", 41, catalyst=40), P("null-result", 2, catalyst=2)], name="Meta-analysis",
      mirrors="kovarex-enrichment-process (shape, unchanged; A)", handcraft=False),
    R("meta-analysis-baselines", "training", 60, [(40, "significant-result"), (5, "baseline")],
      [P("significant-result", 41, catalyst=40), P("baseline", 2, catalyst=2)], name="Meta-analysis (baselines)",
      mirrors="kovarex-enrichment-process (shape; baselines in place of nulls, R2-W)", handcraft=False,
      note="Only with the Scooped setting, where significant results spoil into baselines."),
    # containment and deployment
    R("evaluation-set", "data-processing", 2, [(1, "benchmark"), (1, "adversarial-set")], [(2, "evaluation-set")],
      mirrors="grenade (slot)", handcraft=False),
    R("ratings", "serving", 10, [(1, "checkpoint"), (1, "drive")], [P("ratings", 1), P("checkpoint", 1, catalyst=1)],
      mirrors="new (deployment; checkpoint as catalyst, D's copy law)", handcraft=False),
    # endgame (G)
    R("copy-weights", "training", 10, [(1, "frontier-checkpoint"), (1, "drive")],
      [P("frontier-checkpoint", 2, catalyst=1)], name="Copy weights",
      mirrors="new (G: master + blank drive -> 2; B L6)", handcraft=False),
    R("research-run", "research-run", 60, [(1, "dataset")], [(1, "system-card")], name="Research run",
      mirrors="new (G: a hall runs frontier weights; the dataset is the carrier, B L6)", handcraft=False),
    R("final-report", "training", 60, [(1, "post-training-payload"), (1, "frontier-checkpoint"), (1000, "system-card")],
      [(1, "final-report")],
      mirrors="satellite (capstone payload)", handcraft=False),
    R("launch-final", "launch", 1, [(100, "run-shard"), (1, "final-report")], [(1000, "system-card")],
      name="Launch the final run", mirrors="rocket launch (victory)", pseudo=True, victory=True, handcraft=False),
    # cooling
    R("coolant", "chemistry", 1, [(100, "water")], [(100, "coolant")], mirrors="new (F)", handcraft=False),
    R("fill-coolant-barrel", "crafting-with-fluid", 0.2, [(50, "coolant"), (1, "barrel")], [(1, "coolant-barrel")],
      mirrors="barrel fill", handcraft=False),
    R("empty-coolant-barrel", "crafting-with-fluid", 0.2, [(1, "coolant-barrel")], [(50, "coolant"), (1, "barrel")],
      mirrors="barrel empty", handcraft=False),
    # quality modules (2.0 quality mod recipes, renamed)
    R("comparator", "crafting", 15, [(5, "logic-board"), (5, "processor")], [(1, "comparator")], mirrors="quality-module"),
    R("comparator-2", "crafting", 30, [(4, "comparator"), (5, "processor"), (5, "accelerator")], [(1, "comparator-2")],
      mirrors="quality-module-2"),
    R("comparator-3", "crafting", 60, [(4, "comparator-2"), (5, "processor"), (5, "accelerator")], [(1, "comparator-3")],
      mirrors="quality-module-3"),
    # accelerator tiers
    R("accelerator-2", "crafting-with-fluid", 15, [(1, "accelerator"), (4, "wafer"), (20, "sulfuric-acid")],
      [(1, "accelerator-2")], mirrors="new (G)", handcraft=False),
    R("accelerator-3", "crafting", 20, [(1, "accelerator-2"), (5, "silicon"), (2, "processor")], [(1, "accelerator-3")],
      mirrors="new (G)"),
    R("accelerator-4", "crafting-with-fluid", 25, [(1, "accelerator-3"), (4, "wafer"), (2, "processor"), (20, "sulfuric-acid")],
      [(1, "accelerator-4")], mirrors="new (G)", handcraft=False),
    # fusion
    R("fusion-power-cell", "chemistry", 30, [(2, "steel-plate"), (1, "uranium-238"), (200, "water")],
      [(1, "fusion-power-cell")], mirrors="fusion-power-cell (Space Age; new ingredients)", handcraft=False),
    # scrap (Wild loot) in the Verifier, Space Age's shape
    R("scrap-recycling", "recycling", 0.2, [(1, "scrap")],
      [P("iron-gear-wheel", 1, 0.20), P("logic-board", 1, 0.07), P("concrete", 1, 0.06), P("drive", 1, 0.05),
       P("steel-plate", 1, 0.04), P("battery", 1, 0.04), P("quartz", 1, 0.04), P("processor", 1, 0.03),
       P("copper-cable", 1, 0.03), P("accelerator", 1, 0.02), P("rack", 1, 0.01)], name="Scrap recycling",
      mirrors="scrap-recycling (Space Age)", handcraft=False),
    # Wild defense line (ISO recipes; renames per D)
    R("magazine", "crafting", 1, [(4, "iron-plate")], [(1, "magazine")], mirrors="firearm-magazine"),
    R("ap-magazine", "crafting", 6, [(2, "magazine"), (1, "steel-plate"), (2, "copper-plate")], [(2, "ap-magazine")],
      mirrors="piercing-rounds-magazine"),
    R("du-magazine", "crafting", 10, [(1, "ap-magazine"), (1, "uranium-238")], [(1, "du-magazine")],
      mirrors="uranium-rounds-magazine"),
    R("rocket", "crafting", 4, [(1, "explosives"), (2, "iron-plate")], [(1, "rocket")], mirrors="rocket"),
    R("explosive-rocket", "crafting", 8, [(1, "rocket"), (2, "explosives")], [(1, "explosive-rocket")],
      mirrors="explosive-rocket"),
    R("emp-warhead", "crafting", 50, [(10, "accelerator"), (10, "explosives"), (30, "uranium-235")], [(1, "emp-warhead")],
      mirrors="atomic-bomb"),
    R("artillery-shell", "crafting", 15, [(8, "steel-plate"), (8, "copper-plate"), (16, "explosives"), (1, "radar")],
      [(1, "artillery-shell")], mirrors="artillery-shell (4 explosive cannon shells -> their ingredients; no tank cannon, L14)"),
    R("interceptor", "crafting", 8, [(3, "ap-magazine"), (3, "logic-board"), (3, "iron-gear-wheel")], [(1, "interceptor")],
      mirrors="defender-capsule"),
    R("interceptor-2", "crafting", 15, [(4, "interceptor"), (3, "processor")], [(1, "interceptor-2")],
      mirrors="distractor-capsule"),
    R("interceptor-3", "crafting", 15, [(4, "interceptor-2"), (1, "coprocessor")], [(1, "interceptor-3")],
      mirrors="destroyer-capsule"),
    R("fence", "crafting", 0.5, [(5, "iron-stick")], [(1, "fence")], mirrors="stone-wall (bricks -> iron sticks)"),
    R("gate", "crafting", 0.5, [(1, "fence"), (2, "steel-plate"), (2, "logic-board")], [(1, "gate")], mirrors="gate"),
    R("gun-turret", "crafting", 8, [(10, "iron-gear-wheel"), (10, "copper-plate"), (20, "iron-plate")], [(1, "gun-turret")],
      mirrors="gun-turret"),
    R("laser-turret", "crafting", 20, [(20, "steel-plate"), (20, "logic-board"), (12, "battery")], [(1, "laser-turret")],
      mirrors="laser-turret"),
    R("arc-turret", "crafting", 20, [(30, "steel-plate"), (20, "processor"), (20, "battery"), (40, "copper-cable")],
      [(1, "arc-turret")], mirrors="tesla-turret (Space Age; new ingredients)"),
    R("artillery-turret", "crafting", 40, [(60, "steel-plate"), (60, "concrete"), (40, "iron-gear-wheel"), (20, "processor")],
      [(1, "artillery-turret")], mirrors="artillery-turret"),
    R("artillery-wagon", "crafting", 4,
      [(64, "engine-unit"), (10, "iron-gear-wheel"), (40, "steel-plate"), (16, "pipe"), (20, "processor")],
      [(1, "artillery-wagon")], mirrors="artillery-wagon"),
    R("interceptor-bay", "crafting", 5, [(20, "steel-plate"), (10, "logic-board"), (10, "iron-gear-wheel")],
      [(1, "interceptor-bay")], mirrors="new (F)"),
    R("land-mine", "crafting", 5, [(1, "steel-plate"), (2, "explosives")], [(4, "land-mine")], mirrors="land-mine"),
    R("tank", "crafting", 5, [(32, "engine-unit"), (50, "steel-plate"), (15, "iron-gear-wheel"), (10, "processor")],
      [(1, "tank")], mirrors="tank"),
    R("legged-agent", "training", 10,
      [(4, "exoskeleton"), (2, "portable-reactor"), (16, "accelerator"), (150, "steel-plate"), (2, "radar"),
       (2, "distilled-controller-3"), (1, "checkpoint")],
      [P("legged-agent", 1), P("checkpoint", 1, catalyst=1)],
      mirrors="spidertron (rocket launchers dropped; fish -> checkpoint as catalyst; LDS -> steel)", handcraft=False),
    R("monitor", "crafting", 10, [(15, "steel-plate"), (10, "processor"), (10, "copper-cable")], [(1, "monitor")],
      mirrors="flamethrower-turret (slot; new ingredients)"),
    # armor and equipment
    R("heavy-armor", "crafting", 8, [(100, "copper-plate"), (50, "steel-plate")], [(1, "heavy-armor")], mirrors="heavy-armor"),
    R("modular-suit", "crafting", 15, [(30, "processor"), (50, "steel-plate")], [(1, "modular-suit")], mirrors="modular-armor"),
    R("powered-suit", "crafting", 20, [(40, "accelerator"), (20, "electric-engine-unit"), (40, "steel-plate")],
      [(1, "powered-suit")], mirrors="power-armor"),
    R("powered-suit-2", "crafting", 25,
      [(25, "distilled-controller-2"), (25, "coprocessor-2"), (60, "accelerator"), (40, "electric-engine-unit"),
       (30, "steel-plate")], [(1, "powered-suit-2")], mirrors="power-armor-mk2 (LDS -> steel)"),
    R("portable-solar-panel", "crafting", 10, [(1, "solar-panel"), (2, "processor"), (5, "steel-plate")],
      [(1, "portable-solar-panel")], mirrors="solar-panel-equipment"),
    R("night-vision", "crafting", 10, [(5, "processor"), (10, "steel-plate")], [(1, "night-vision")],
      mirrors="night-vision-equipment"),
    R("belt-immunity", "crafting", 10, [(5, "processor"), (10, "steel-plate")], [(1, "belt-immunity")],
      mirrors="belt-immunity-equipment"),
    R("personal-battery", "crafting", 10, [(5, "battery"), (10, "steel-plate")], [(1, "personal-battery")],
      mirrors="battery-equipment"),
    R("personal-battery-2", "crafting", 10, [(10, "personal-battery"), (15, "accelerator"), (5, "steel-plate")],
      [(1, "personal-battery-2")], mirrors="battery-mk2-equipment (LDS -> steel)"),
    R("personal-assistant", "crafting", 10,
      [(10, "processor"), (40, "iron-gear-wheel"), (20, "steel-plate"), (45, "battery")], [(1, "personal-assistant")],
      mirrors="personal-roboport-equipment"),
    R("personal-assistant-2", "crafting", 20, [(5, "personal-assistant"), (100, "accelerator"), (20, "steel-plate")],
      [(1, "personal-assistant-2")], mirrors="personal-roboport-mk2-equipment (LDS -> steel)"),
    R("energy-shield", "crafting", 10, [(5, "processor"), (10, "steel-plate")], [(1, "energy-shield")],
      mirrors="energy-shield-equipment"),
    R("energy-shield-2", "crafting", 10, [(10, "energy-shield"), (5, "accelerator"), (5, "steel-plate")],
      [(1, "energy-shield-2")], mirrors="energy-shield-mk2-equipment (LDS -> steel)"),
    R("personal-laser-defense", "crafting", 10, [(20, "accelerator"), (5, "steel-plate"), (5, "laser-turret")],
      [(1, "personal-laser-defense")], mirrors="personal-laser-defense-equipment (LDS -> steel)"),
    R("discharge-defense", "crafting", 10, [(5, "accelerator"), (20, "steel-plate"), (10, "laser-turret")],
      [(1, "discharge-defense")], mirrors="discharge-defense-equipment"),
    R("exoskeleton", "crafting", 10, [(10, "accelerator"), (30, "electric-engine-unit"), (20, "steel-plate")],
      [(1, "exoskeleton")], mirrors="exoskeleton-equipment"),
    R("portable-reactor", "crafting", 10, [(200, "accelerator"), (50, "steel-plate"), (4, "uranium-fuel-cell")],
      [(1, "portable-reactor")], mirrors="fission-reactor-equipment (LDS -> steel)"),
    # new buildings
    R("cooling-tower", "crafting", 5, [(20, "iron-plate"), (10, "pipe"), (10, "iron-gear-wheel"), (5, "logic-board")],
      [(1, "cooling-tower")], mirrors="new (F)"),
    R("dry-cooler", "crafting", 5,
      [(10, "steel-plate"), (20, "copper-plate"), (10, "pipe"), (5, "iron-gear-wheel"), (5, "logic-board")],
      [(1, "dry-cooler")], mirrors="new (F)"),
    R("water-exchanger", "crafting", 5, [(20, "steel-plate"), (50, "copper-plate"), (20, "pipe")], [(1, "water-exchanger")],
      mirrors="new (F)"),
    R("research-hall", "crafting", 30,
      [(50, "steel-plate"), (50, "refined-concrete"), (20, "rack"), (20, "processor"), (20, "pipe")],
      [(1, "research-hall")], mirrors="new (G)"),
    R("endpoint", "crafting", 10, [(10, "steel-plate"), (20, "processor"), (10, "data-line"), (10, "copper-cable")],
      [(1, "endpoint")], mirrors="new (F's deployment building)"),
    R("fusion-reactor", "crafting", 60,
      [(200, "steel-plate"), (200, "refined-concrete"), (100, "accelerator"), (200, "copper-cable")],
      [(1, "fusion-reactor")], mirrors="fusion-reactor (Space Age; new ingredients)"),
    R("fusion-generator", "crafting", 30, [(100, "steel-plate"), (100, "copper-plate"), (50, "processor"), (20, "pipe")],
      [(1, "fusion-generator")], mirrors="fusion-generator (Space Age; new ingredients)"),
    R("verifier", "crafting", 3, [(40, "iron-gear-wheel"), (20, "steel-plate"), (6, "accelerator"), (20, "concrete")],
      [(1, "verifier")], mirrors="recycler"),
    R("deployer", "crafting", 10, [(1, "steel-chest"), (10, "processor"), (5, "accelerator")], [(1, "deployer")],
      mirrors="new (Recursive Blueprints)"),
    R("area-scanner", "crafting", 5, [(1, "radar"), (10, "processor"), (5, "copper-cable")], [(1, "area-scanner")],
      mirrors="new (Recursive Blueprints)"),
]

J_NOTE = ("Amounts drift with the junk share j (03-pressure): junk = 25 × j/0.30, the rest of 125 split 45:55 "
          "text:prose. ISO at j = 0.30.")

RECIPE_EDITS = {
    # id: dict of field replacements (None deletes the recipe)
    "boil-steam": None,          # replaced by boiler/heat-exchanger consumes/produces
    "burn-fuel-cell": None,      # replaced by nuclear-reactor consumes/produces
    "article": {"ingredients": [{"id": "engine-unit", "amount": 2}, {"id": "processor", "amount": 3},
                                {"id": "significant-result", "amount": 1}],
                "mirrors": "chemical-science-pack (sulfur -> significant result; A's experiment loop)"},
    "model-card": {"ingredients": [{"id": "checkpoint", "amount": 2}, {"id": "drone-frame", "amount": 1},
                                   {"id": "rack", "amount": 3}, {"id": "ratings", "amount": 1}],
                   "mirrors": "utility-science-pack (2 processing unit -> 2 checkpoint; + 1 Ratings, R2-W)"},
    "post-training-payload": {"ingredients": [{"id": "checkpoint", "amount": 100}, {"id": "benchmark", "amount": 100},
                                              {"id": "adversarial-set", "amount": 100}, {"id": "accelerator", "amount": 100},
                                              {"id": "corpus", "amount": 50}, {"id": "ratings", "amount": 100}],
                              "mirrors": "satellite (six ingredients, as the satellite's)"},
    "researcher": {"ingredients": [{"id": "frontier-checkpoint", "amount": 1}, {"id": "accelerator", "amount": 4}],
                   "products": [{"id": "researcher", "amount": 1}, {"id": "frontier-checkpoint", "amount": 1, "catalyst": 1}],
                   "mirrors": "new (G: needs the frontier checkpoint, which only a completed run returns)"},
    "data-refinery": {"ingredients": [{"id": "steel-plate", "amount": 15}, {"id": "iron-gear-wheel", "amount": 10},
                                      {"id": "quartz", "amount": 20}, {"id": "logic-board", "amount": 10},
                                      {"id": "data-line", "amount": 10}],
                      "mirrors": "oil-refinery (10 stone brick -> 20 quartz)"},
    "kovarex-enrichment-process": {"name": "Enrichment cascade"},
    "launch": {"name": "Launch a frontier run",
               "products": [{"id": "system-card", "amount": 1000}, {"id": "frontier-checkpoint", "amount": 1}],
               "mirrors": "rocket launch with a satellite (+ the run's weights, G)"},
    "quality-filtering": {"note": J_NOTE,
                          "amounts_by_j": {"junk": "25*j/0.30", "text": "(125-25*j/0.30)*0.45",
                                           "prose": "(125-25*j/0.30)*0.55"}},
    "repeater": {"ingredients": [{"id": "iron-plate", "amount": 1}, {"id": "logic-board", "amount": 2},
                                 {"id": "data-line", "amount": 1}],
                 "mirrors": "pump (data network; steel -> iron so Packet switching can unlock it)"},
    "deduplication": {"note": "Prose drifts with j: 45 × (1 − j)/0.70. ISO at j = 0.30.",
                      "amounts_by_j": {"prose": "45*(1-j)/0.70"}},
}

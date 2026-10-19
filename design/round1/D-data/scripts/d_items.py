# R1-D production economy: items and fluids (non-building). v2 (aligned with B-ontology and H-tone-bible names)
R, G, B, K, P, Y, W = ("memo", "report", "article", "proceedings", "preprint", "model-card", "system-card")
TIERS = [R, G, B, K, P, Y, W]


def I(id, name, stack, tier, mirrors, sprite, tags, group, **extra):
    d = dict(id=id, name=name, type="item", stack=stack, tier=tier, mirrors=mirrors,
             sprite=sprite, tags=tags, group=group)
    d.update(extra)
    return d


def F(id, name, tier, mirrors, sprite, group, **extra):
    d = dict(id=id, name=name, type="fluid", tier=tier, mirrors=mirrors, sprite=sprite,
             tags=["fluid"], group=group)
    d.update(extra)
    return d


ITEMS = [
    # ---------- raw solids ----------
    I("wood", "Wood", 100, R, "wood", "ISO: two crossed brown logs", ["raw", "fuel"], "raw", fuel_value=2, fuel_category="chemical"),
    I("coal", "Coal", 50, R, "coal", "ISO: black lumps", ["raw", "fuel"], "raw", fuel_value=4, fuel_category="chemical"),
    I("iron-ore", "Iron ore", 50, R, "iron-ore", "ISO: blue-grey rock chunks", ["raw"], "raw"),
    I("copper-ore", "Copper ore", 50, R, "copper-ore", "ISO: orange rocks with green flecks", ["raw"], "raw"),
    I("quartz", "Quartz", 50, R, "stone", "heap of milky-white faceted crystals, faint pink cast; the brightest raw item", ["raw"], "raw",
      desc="Silicon dioxide. About 60% of the continental crust, by weight."),
    I("uranium-ore", "Uranium ore", 50, B, "uranium-ore", "ISO: dark rock with glowing green specks", ["raw"], "raw"),
    I("records", "Records", 50, R, "iron-ore (role: a basic ore)", "bundle of yellowed papers tied with a string cross; manila, soft edges", ["raw"], "raw",
      desc="Boxes of records. Finite."),
    # ---------- fluids ----------
    F("water", "Water", R, "water", "ISO blue", "fluid"),
    F("steam", "Steam", R, "steam", "ISO white", "fluid"),
    F("sulfuric-acid", "Sulfuric acid", B, "sulfuric-acid", "ISO yellow-green", "fluid"),
    F("lubricant", "Lubricant", B, "lubricant", "ISO green", "fluid"),
    F("crawl", "Crawl", B, "crude-oil", "near-black with white static speckle", "fluid", desc="Raw. Mostly copies."),
    F("junk", "Junk", B, "heavy-oil", "muddy brown-grey", "fluid", desc="Not nothing. Can be rephrased."),
    F("text", "Text", B, "light-oil", "warm amber", "fluid"),
    F("prose", "Prose", B, "petroleum-gas", "pale ice-cyan", "fluid", desc="Deduplicated, filtered, readable."),
    # ---------- plates (smelted) ----------
    I("iron-plate", "Iron plate", 100, R, "iron-plate", "ISO", ["intermediate"], "plate"),
    I("copper-plate", "Copper plate", 100, R, "copper-plate", "ISO", ["intermediate"], "plate"),
    I("steel-plate", "Steel plate", 100, G, "steel-plate", "ISO", ["intermediate"], "plate"),
    I("silicon", "Silicon", 100, G, "stone-brick (furnace slot) / plastic-bar (bulk role)", "dark metallic lump with a blue-violet sheen and sharp facets", ["intermediate"], "plate",
      desc="Quartz with the oxygen removed."),
    I("token", "Token", 100, R, "copper-plate (role)", "short stack of cream punched cards, top-left corner cut, two rows of holes", ["intermediate"], "plate",
      desc="One instance of one type."),
    # ---------- components ----------
    I("iron-gear-wheel", "Iron gear wheel", 100, R, "iron-gear-wheel", "ISO", ["intermediate"], "component"),
    I("iron-stick", "Iron stick", 100, R, "iron-stick", "ISO", ["intermediate"], "component"),
    I("copper-cable", "Copper cable", 200, R, "copper-cable", "ISO", ["intermediate"], "component"),
    I("logic-board", "Logic board", 200, R, "electronic-circuit", "small olive-green board carrying one glass vacuum tube (orange filament glow) and three copper traces", ["intermediate"], "component",
      desc="Gates on a board. Relays, then tubes, then transistors."),
    I("wafer", "Wafer", 100, B, "plastic-bar", "iridescent silver disc etched with a fine grid, flat notch at the bottom", ["intermediate"], "component",
      desc="Silicon, polished flat to a few atoms."),
    I("processor", "Processor", 200, B, "advanced-circuit", "black chip with two rows of silver legs on a small red board", ["intermediate"], "component",
      desc="Executes stored programs. Binned by clock speed."),
    I("accelerator", "Accelerator", 100, B, "processing-unit", "square package with a gold lid, ringed by four small dark memory stacks, blue rim", ["intermediate"], "component",
      desc="Multiplies matrices."),
    I("sulfur", "Sulfur", 50, B, "sulfur", "ISO", ["intermediate"], "component"),
    I("battery", "Battery", 200, B, "battery", "ISO", ["intermediate"], "component"),
    I("explosives", "Explosives", 50, B, "explosives", "ISO", ["intermediate"], "component"),
    I("engine-unit", "Engine unit", 50, G, "engine-unit", "ISO", ["intermediate"], "component"),
    I("electric-engine-unit", "Electric engine unit", 50, B, "electric-engine-unit", "ISO", ["intermediate"], "component"),
    I("drone-frame", "Drone frame", 50, B, "flying-robot-frame", "X-shaped quadcopter frame, four grey rotor rings, no lights", ["intermediate"], "component",
      desc="A body. Loaded with a planner or with weights."),
    I("rack", "Rack", 50, Y, "low-density-structure", "tall black cabinet, front of thin horizontal slats, one copper busbar stripe", ["intermediate"], "component",
      desc="19 inches wide, 42 U high. Battery backup."),
    # ---------- data products ----------
    I("dataset", "Dataset", 100, B, "plastic-bar", "sealed grey drive with an ice-cyan label band", ["intermediate"], "data",
      desc="Deduplicated. Smaller than what went in."),
    I("benchmark", "Benchmark", 50, B, "sulfur", "sealed manila envelope printed with a green grid of check boxes", ["intermediate"], "data",
      desc="Each use leaks a little."),
    I("adversarial-set", "Adversarial set", 50, K, "lubricant (direct use of the heavy fraction)", "manila envelope crossed by a black-and-red hazard stripe", ["intermediate"], "data",
      desc="Inputs chosen to be answered wrong."),
    I("corpus", "Corpus", 20, W, "rocket-fuel", "three wide tape reels stacked, amber banding", ["intermediate"], "data",
      desc="Ten datasets, mixed."),
    I("checkpoint", "Checkpoint", 50, B, "new (catalyst; consumed where Factorio consumes a productivity module)", "grey drive with an orange hexagon label", ["intermediate"], "data",
      desc="Weights on a drive. Copying recipes return it."),
    # ---------- modules (Factorio colours: speed blue, productivity orange, efficiency green) ----------
    I("coprocessor", "Coprocessor 1", 50, B, "speed-module", "blue module card, one chevron", ["module"], "module", module=dict(speed=0.2, consumption=0.5),
      desc="More arithmetic for the machine's control loop."),
    I("coprocessor-2", "Coprocessor 2", 50, P, "speed-module-2", "blue card with heat-sink fins, two chevrons", ["module"], "module", module=dict(speed=0.3, consumption=0.6)),
    I("coprocessor-3", "Coprocessor 3", 50, Y, "speed-module-3", "long blue card with a fan shroud, three chevrons", ["module"], "module", module=dict(speed=0.5, consumption=0.7)),
    I("learned-controller", "Learned controller 1", 50, B, "productivity-module", "orange module card, one chevron, small glowing hexagon", ["module"], "module",
      module=dict(productivity=0.04, speed=-0.05, consumption=0.4, pollution=0.05), desc="Weights copied from a checkpoint. More yield, slower, hungrier."),
    I("learned-controller-2", "Learned controller 2", 50, P, "productivity-module-2", "orange card, two chevrons", ["module"], "module",
      module=dict(productivity=0.06, speed=-0.1, consumption=0.6, pollution=0.07)),
    I("learned-controller-3", "Learned controller 3", 50, Y, "productivity-module-3", "orange card, three chevrons, hexagon with a halo", ["module"], "module",
      module=dict(productivity=0.1, speed=-0.15, consumption=0.8, pollution=0.1)),
    I("distilled-controller", "Distilled controller 1", 50, B, "efficiency-module", "green module card, one chevron, small hexagon", ["module"], "module",
      module=dict(consumption=-0.3), desc="Most of the teacher at a fraction of the watts."),
    I("distilled-controller-2", "Distilled controller 2", 50, P, "efficiency-module-2", "green card, two chevrons", ["module"], "module", module=dict(consumption=-0.4)),
    I("distilled-controller-3", "Distilled controller 3", 50, Y, "efficiency-module-3", "green card, three chevrons", ["module"], "module", module=dict(consumption=-0.5)),
    # ---------- frontier run ----------
    I("run-shard", "Run shard", 5, W, "rocket-part", "flat translucent slab with a lattice of dots", ["intermediate"], "frontier",
      desc="One training step of a hundred."),
    I("post-training-payload", "Post-training payload", 1, W, "satellite", "small glass cube holding an orange hexagon, gold base", ["intermediate"], "frontier",
      desc="Preference data and a reward model. Without it a run returns a base model and no system card."),
    I("researcher", "Researcher", 10, W, "new (hook for G and B's L9)", "slim black box with a single orange hexagon and a green status lamp", ["final"], "frontier",
      desc="Staffs a seminar. Four accelerators and a checkpoint; the checkpoint is returned."),
    # ---------- nuclear (ISO) ----------
    I("uranium-235", "Uranium-235", 100, B, "uranium-235", "ISO", ["intermediate"], "nuclear"),
    I("uranium-238", "Uranium-238", 100, B, "uranium-238", "ISO", ["intermediate"], "nuclear"),
    I("uranium-fuel-cell", "Uranium fuel cell", 50, B, "uranium-fuel-cell", "ISO", ["fuel"], "nuclear", fuel_value=8000, fuel_category="nuclear"),
    I("depleted-uranium-fuel-cell", "Depleted uranium fuel cell", 50, B, "depleted-uranium-fuel-cell", "ISO", ["intermediate"], "nuclear"),
    # ---------- terrain (ISO) ----------
    I("concrete", "Concrete", 100, G, "concrete", "ISO", ["intermediate"], "terrain"),
    I("hazard-concrete", "Hazard concrete", 100, G, "hazard-concrete", "ISO", ["final"], "terrain"),
    I("refined-concrete", "Refined concrete", 100, B, "refined-concrete", "ISO", ["final"], "terrain"),
    I("refined-hazard-concrete", "Refined hazard concrete", 100, B, "refined-hazard-concrete", "ISO", ["final"], "terrain"),
    I("landfill", "Landfill", 100, G, "landfill", "ISO (pale sand fill)", ["final"], "terrain"),
    I("cliff-explosives", "Cliff explosives", 20, B, "cliff-explosives", "ISO", ["final"], "terrain"),
    # ---------- containers ----------
    I("barrel", "Barrel", 10, G, "barrel", "ISO: empty steel barrel", ["intermediate"], "container"),
    I("drive", "Drive", 10, G, "barrel (data side)", "flat grey cartridge with two visible reels, blank label", ["intermediate"], "container",
      desc="Random access."),
    # ---------- science packs: the publication ladder (H), Factorio colours, one silhouette ----------
    I(R, "Memo", 200, R, "automation-science-pack", "typed sheet with a red header band and a carbon-copy edge", ["science-pack"], "paper",
      desc="Typed, carbon-copied, filed."),
    I(G, "Report", 200, G, "logistic-science-pack", "stapled report, green cover, number in the corner", ["science-pack"], "paper",
      desc="Numbered, bound, mailed on request."),
    I(B, "Article", 200, B, "chemical-science-pack", "two-column page, blue header bar", ["science-pack"], "paper", desc="Refereed."),
    I(K, "Proceedings", 200, K, "military-science-pack", "grey bound volume with a red stripe", ["science-pack"], "paper", desc="Presented once, then printed."),
    I(P, "Preprint", 200, P, "production-science-pack", "loose sheets with a purple vertical stamp in the left margin", ["science-pack"], "paper",
      desc="Posted. Not reviewed. Cited."),
    I(Y, "Model card", 200, Y, "utility-science-pack", "yellow card printed with a small table", ["science-pack"], "paper",
      desc="States what the model was tested on."),
    I(W, "System card", 2000, W, "space-science-pack", "white card with a grey table and no author line", ["science-pack"], "paper",
      desc="Returned by a frontier run. Not written by anyone."),
    # ---------- other ----------
    I("repair-pack", "Repair pack", 100, R, "repair-pack", "ISO", ["final"], "other"),
    I("construction-agent", "Construction agent", 50, B, "construction-robot", "drone with orange accents", ["final"], "agent",
      desc="Builds ghosts within range of a hub."),
    I("logistic-agent", "Logistic agent", 50, B, "logistic-robot", "drone with yellow-and-blue accents", ["final"], "agent",
      desc="Moves items between hub chests."),
]

BARRELLED = [("water", "barrel"), ("sulfuric-acid", "barrel"), ("lubricant", "barrel"),
             ("crawl", "drive"), ("junk", "drive"), ("text", "drive"), ("prose", "drive")]
for fl, cont in BARRELLED:
    fname = next(i["name"] for i in ITEMS if i["id"] == fl)
    ITEMS.append(I(f"{fl}-{cont}", f"{fname} {cont}", 10, G if cont == "barrel" else B,
                   f"{fl}-barrel" if cont == "barrel" else "barrel (filled)",
                   f"{cont} with a {fname.lower()}-coloured band", ["intermediate"], "container-filled"))

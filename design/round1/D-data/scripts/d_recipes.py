# R1-D recipes, v2. Rc(id, category, time, ingredients, products, mirrors, unlock, **opts)
from d_items import R, G, B, K, P, Y, W, BARRELLED


def Rc(id, cat, time, ins, outs, mirrors, unlock, **opts):
    def norm(d):
        out = []
        for k, v in d.items():
            e = {"id": k, "amount": v[0], **v[1]} if isinstance(v, tuple) else {"id": k, "amount": v}
            out.append(e)
        return out
    d = dict(id=id, category=cat, time=time, ingredients=norm(ins), products=norm(outs), mirrors=mirrors, unlock=unlock)
    d.update(opts)
    return d


S = "start"
CAT = lambda n: (n, {"catalyst": n})  # returned amount
RECIPES = [
    # ---- smelting (furnaces) ----
    Rc("iron-plate", "smelting", 3.2, {"iron-ore": 1}, {"iron-plate": 1}, "iron-plate", S),
    Rc("copper-plate", "smelting", 3.2, {"copper-ore": 1}, {"copper-plate": 1}, "copper-plate", S),
    Rc("steel-plate", "smelting", 16, {"iron-plate": 5}, {"steel-plate": 1}, "steel-plate", "steel-processing"),
    Rc("silicon", "smelting", 3.2, {"quartz": 1}, {"silicon": 1}, "stone-brick (the 4th ore's furnace slot; 1:1 like a plate)", "semiconductors"),
    # ---- transcription (keypunch, tokenizer) ----
    Rc("token", "transcription", 3.2, {"records": 1}, {"token": 1}, "copper-plate", S),
    # ---- crafting: components ----
    Rc("iron-gear-wheel", "crafting", 0.5, {"iron-plate": 2}, {"iron-gear-wheel": 1}, "iron-gear-wheel", S),
    Rc("iron-stick", "crafting", 0.5, {"iron-plate": 1}, {"iron-stick": 2}, "iron-stick", S),
    Rc("copper-cable", "crafting", 0.5, {"copper-plate": 1}, {"copper-cable": 2}, "copper-cable", S),
    Rc("logic-board", "crafting", 0.5, {"iron-plate": 1, "copper-cable": 3}, {"logic-board": 1}, "electronic-circuit", S),
    Rc("processor", "crafting", 6, {"wafer": 2, "copper-cable": 4, "logic-board": 2}, {"processor": 1}, "advanced-circuit", "integrated-circuits"),
    Rc("accelerator", "crafting-with-fluid", 10, {"logic-board": 20, "processor": 2, "sulfuric-acid": 5}, {"accelerator": 1}, "processing-unit", "accelerators"),
    Rc("engine-unit", "crafting", 10, {"steel-plate": 1, "iron-gear-wheel": 1, "pipe": 2}, {"engine-unit": 1}, "engine-unit", "engine"),
    Rc("electric-engine-unit", "crafting-with-fluid", 10, {"engine-unit": 1, "logic-board": 2, "lubricant": 15}, {"electric-engine-unit": 1}, "electric-engine-unit", "electric-engine"),
    Rc("drone-frame", "crafting", 20, {"electric-engine-unit": 1, "battery": 2, "steel-plate": 1, "logic-board": 3}, {"drone-frame": 1}, "flying-robot-frame", "planning-agents"),
    Rc("rack", "crafting", 15, {"steel-plate": 2, "copper-plate": 20, "battery": 5}, {"rack": 1}, "low-density-structure (5 plastic -> 5 battery)", "racks"),
    Rc("construction-agent", "crafting", 0.5, {"drone-frame": 1, "logic-board": 2}, {"construction-agent": 1}, "construction-robot", "planning-agents"),
    Rc("repair-pack", "crafting", 0.5, {"logic-board": 2, "iron-gear-wheel": 2}, {"repair-pack": 1}, "repair-pack", S),
    # ---- coal chemistry (chemical plant) ----
    Rc("sulfur", "chemistry", 1, {"coal": 2, "water": 30}, {"sulfur": 2}, "sulfur (2 coal replace 30 petroleum gas)", "coal-chemistry"),
    Rc("sulfuric-acid", "chemistry", 1, {"sulfur": 5, "iron-plate": 1, "water": 100}, {"sulfuric-acid": 50}, "sulfuric-acid", "coal-chemistry"),
    Rc("lubricant", "chemistry", 1, {"coal": 1, "water": 10}, {"lubricant": 10}, "lubricant (coal replaces heavy oil)", "lubricant"),
    Rc("wafer", "chemistry", 1, {"silicon": 1, "sulfuric-acid": 20}, {"wafer": 2}, "plastic-bar (silicon + acid replace coal + gas)", "integrated-circuits", name="Photolithography"),
    Rc("battery", "chemistry", 4, {"iron-plate": 1, "copper-plate": 1, "sulfuric-acid": 20}, {"battery": 1}, "battery", "battery"),
    Rc("explosives", "chemistry", 4, {"sulfur": 1, "coal": 1, "water": 10}, {"explosives": 2}, "explosives", "explosives"),
    # ---- data refining (data refinery) ----
    Rc("deduplication", "data-refining", 5, {"crawl": 100}, {"prose": 45}, "basic-oil-processing", "information-retrieval", name="Deduplication"),
    Rc("quality-filtering", "data-refining", 5, {"crawl": 100, "water": 50}, {"junk": 25, "text": 45, "prose": 55}, "advanced-oil-processing", "quality-filtering", name="Quality filtering"),
    Rc("synthetic-data", "data-refining", 5, {"checkpoint": 1, "token": 10, "junk": 25, "water": 50},
       {"junk": 90, "text": 20, "prose": 10, "checkpoint": CAT(1)}, "coal-liquefaction (+ generator as catalyst)", "synthetic-data", name="Synthetic data"),
    # ---- data processing (data plant) ----
    Rc("denoising", "data-processing", 2, {"junk": 40, "water": 30}, {"text": 30}, "heavy-oil-cracking", "quality-filtering", name="Denoising"),
    Rc("rephrasing", "data-processing", 2, {"text": 30, "water": 30}, {"prose": 20}, "light-oil-cracking", "quality-filtering", name="Rephrasing"),
    Rc("dataset", "data-processing", 1, {"prose": 20, "token": 1}, {"dataset": 2}, "plastic-bar", "datasets"),
    Rc("benchmark", "data-processing", 1, {"prose": 30, "water": 30}, {"benchmark": 2}, "sulfur", "datasets"),
    Rc("adversarial-set", "data-processing", 1, {"junk": 10}, {"adversarial-set": 1}, "lubricant (heavy fraction's direct use)", "adversarial-examples"),
    Rc("corpus", "data-processing", 15, {"dataset": 10, "text": 10}, {"corpus": 1}, "rocket-fuel (dataset plays solid fuel)", "corpora"),
    # ---- training (trainer): weights are made here; copies need the original back ----
    Rc("checkpoint", "training", 60, {"dataset": 10}, {"checkpoint": 1}, "new (cost is compute time and data, not material)", "machine-learning"),
    Rc("learned-controller", "training", 15, {"checkpoint": 1, "processor": 5, "logic-board": 5}, {"learned-controller": 1, "checkpoint": CAT(1)},
       "productivity-module (+ checkpoint as catalyst)", "machine-learning"),
    Rc("distilled-controller", "training", 15, {"checkpoint": 1, "processor": 5, "logic-board": 5}, {"distilled-controller": 1, "checkpoint": CAT(1)},
       "efficiency-module (+ teacher as catalyst)", "distillation"),
    Rc("logistic-agent", "training", 0.5, {"checkpoint": 1, "drone-frame": 1, "processor": 2}, {"logistic-agent": 1, "checkpoint": CAT(1)},
       "logistic-robot (+ checkpoint as catalyst)", "learned-agents"),
    Rc("post-training-payload", "training", 5, {"checkpoint": 100, "benchmark": 100, "adversarial-set": 100, "accelerator": 100, "corpus": 50},
       {"post-training-payload": 1}, "satellite", "frontier-run"),
    Rc("researcher", "training", 30, {"checkpoint": 1, "accelerator": 4}, {"researcher": 1, "checkpoint": CAT(1)}, "new (G's AI researcher)", "frontier-run"),
    # ---- modules (assemblers): tier 1 coprocessor; tiers 2-3 of all three families ----
    Rc("coprocessor", "crafting", 15, {"processor": 5, "logic-board": 5}, {"coprocessor": 1}, "speed-module", "machine-learning"),
    Rc("coprocessor-2", "crafting", 30, {"coprocessor": 4, "processor": 5, "accelerator": 5}, {"coprocessor-2": 1}, "speed-module-2", "modules-2"),
    Rc("coprocessor-3", "crafting", 60, {"coprocessor-2": 4, "processor": 5, "accelerator": 5}, {"coprocessor-3": 1}, "speed-module-3", "modules-3"),
    Rc("learned-controller-2", "crafting", 30, {"learned-controller": 4, "processor": 5, "accelerator": 5}, {"learned-controller-2": 1}, "productivity-module-2", "modules-2"),
    Rc("learned-controller-3", "crafting", 60, {"learned-controller-2": 4, "processor": 5, "accelerator": 5}, {"learned-controller-3": 1}, "productivity-module-3", "modules-3"),
    Rc("distilled-controller-2", "crafting", 30, {"distilled-controller": 4, "processor": 5, "accelerator": 5}, {"distilled-controller-2": 1}, "efficiency-module-2", "modules-2"),
    Rc("distilled-controller-3", "crafting", 60, {"distilled-controller-2": 4, "processor": 5, "accelerator": 5}, {"distilled-controller-3": 1}, "efficiency-module-3", "modules-3"),
    # ---- frontier run ----
    Rc("run-shard", "frontier-run", 3, {"accelerator": 10, "rack": 10, "corpus": 10}, {"run-shard": 1}, "rocket-part", "frontier-run"),
    # ---- science packs ----
    Rc(R, "crafting", 5, {"token": 1, "iron-gear-wheel": 1}, {R: 1}, "automation-science-pack (copper plate -> token)", S),
    Rc(G, "crafting", 6, {"inserter": 1, "transport-belt": 1}, {G: 1}, "logistic-science-pack", "report"),
    Rc(B, "crafting", 24, {"engine-unit": 2, "processor": 3, "benchmark": 1}, {B: 2}, "chemical-science-pack (sulfur -> benchmark)", "article"),
    Rc(K, "crafting", 10, {"adversarial-set": 1, "benchmark": 1, "logic-board": 2}, {K: 2}, "military-science-pack (ingredients replaced)", "adversarial-examples"),
    Rc(P, "crafting", 21, {"tokenizer": 1, "checkpoint": 1, "rail": 30}, {P: 3}, "production-science-pack (productivity module -> checkpoint)", "preprint"),
    Rc(Y, "crafting", 21, {"checkpoint": 2, "drone-frame": 1, "rack": 3}, {Y: 3}, "utility-science-pack (2 processing unit -> 2 checkpoint)", "model-card"),
    # ---- nuclear (ISO) ----
    Rc("uranium-processing", "centrifuging", 12, {"uranium-ore": 10},
       {"uranium-235": (1, {"probability": 0.007}), "uranium-238": (1, {"probability": 0.993})}, "uranium-processing", "uranium-processing", name="Uranium processing"),
    Rc("uranium-fuel-cell", "crafting", 10, {"iron-plate": 10, "uranium-235": 1, "uranium-238": 19}, {"uranium-fuel-cell": 10}, "uranium-fuel-cell", "nuclear-power"),
    Rc("nuclear-fuel-reprocessing", "centrifuging", 60, {"depleted-uranium-fuel-cell": 5}, {"uranium-238": 3}, "nuclear-fuel-reprocessing", "kovarex", name="Nuclear fuel reprocessing"),
    Rc("kovarex-enrichment-process", "centrifuging", 60, {"uranium-235": 40, "uranium-238": 5},
       {"uranium-235": (41, {"catalyst": 40}), "uranium-238": (2, {"catalyst": 2})}, "kovarex-enrichment-process", "kovarex", name="Kovarex enrichment process"),
    # ---- terrain (ISO; quartz plays stone) ----
    Rc("concrete", "crafting-with-fluid", 10, {"quartz": 10, "iron-ore": 1, "water": 100}, {"concrete": 10}, "concrete (5 stone brick -> 10 quartz)", "concrete"),
    Rc("hazard-concrete", "crafting", 0.25, {"concrete": 10}, {"hazard-concrete": 10}, "hazard-concrete", "concrete"),
    Rc("refined-concrete", "crafting-with-fluid", 15, {"concrete": 20, "iron-stick": 8, "steel-plate": 1, "water": 100}, {"refined-concrete": 10}, "refined-concrete", "refined-concrete"),
    Rc("refined-hazard-concrete", "crafting", 0.25, {"refined-concrete": 10}, {"refined-hazard-concrete": 10}, "refined-hazard-concrete", "refined-concrete"),
    Rc("landfill", "crafting", 0.5, {"quartz": 50}, {"landfill": 1}, "landfill", "landfill"),
    Rc("cliff-explosives", "crafting", 8, {"explosives": 10, "barrel": 1, "logic-board": 1}, {"cliff-explosives": 1}, "cliff-explosives (grenade -> logic board)", "cliff-explosives"),
    # ---- containers ----
    Rc("barrel", "crafting", 1, {"steel-plate": 1}, {"barrel": 1}, "barrel", "fluid-handling"),
    Rc("drive", "crafting", 1, {"steel-plate": 1}, {"drive": 1}, "barrel", "telecommunication"),
]

for fl, cont in BARRELLED:
    tech = "fluid-handling" if cont == "barrel" else "telecommunication"
    RECIPES.append(Rc(f"fill-{fl}-{cont}", "crafting-with-fluid", 0.2, {fl: 50, cont: 1}, {f"{fl}-{cont}": 1}, f"{fl}-barrel fill", tech))
    RECIPES.append(Rc(f"empty-{fl}-{cont}", "crafting-with-fluid", 0.2, {f"{fl}-{cont}": 1}, {fl: 50, cont: 1}, f"{fl}-barrel empty", tech))

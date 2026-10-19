# R1-E tech tree data. Mirrors Factorio 2.0.77 base + quality mod (202 techs) plus BEND additions.
# Each Factorio tech maps to one of ours; prerequisites and costs are derived from Factorio's own data
# unless overridden. Run build_tree.py to validate and render.

# ---------------------------------------------------------------- packs
PACKS = {
    # factorio pack id : (letter, our name, color)
    "automation-science-pack": ("R", "Memo", "red"),
    "logistic-science-pack": ("G", "Report", "green"),
    "military-science-pack": ("M", "Proceedings", "black"),
    "chemical-science-pack": ("B", "Article", "blue"),
    "production-science-pack": ("P", "Preprint", "purple"),
    "utility-science-pack": ("Y", "Model card", "yellow"),
    "space-science-pack": ("W", "System card", "white"),
}
ORDER = "RGMBPYW"
# Latest citation year allowed at each tier (the Literature counter must not run ahead of the tier).
TIER_END = {"S": 1945, "R": 1955, "G": 1998, "B": 2011, "P": 2018, "Y": 2024, "W": 2024}
TIER_NAME = {"S": "Start", "R": "Red", "G": "Green", "B": "Blue", "P": "Purple", "Y": "Yellow", "W": "White"}

# ---------------------------------------------------------------- recipe/item glossary (Factorio -> name used here)
# Source: H = H-tone-bible, C = consensus (design-space), E = this doc (provisional), L = literal Factorio name kept.
GLOSS = {
    "iron-plate": "Iron plate", "copper-plate": "Copper plate", "uranium-ore": "Uranium ore",
    "pipe": "Pipe", "pipe-to-ground": "Pipe to ground", "offshore-pump": "Offshore pump", "boiler": "Boiler",
    "steam-engine": "Steam engine", "copper-cable": "Copper cable", "electronic-circuit": "Logic board",
    "lab": "Seminar", "inserter": "Inserter", "small-electric-pole": "Small electric pole",
    "automation-science-pack": "Memo", "logistic-science-pack": "Report", "military-science-pack": "Proceedings",
    "chemical-science-pack": "Article", "production-science-pack": "Preprint", "utility-science-pack": "Model card",
    "electric-mining-drill": "Electric mining drill", "repair-pack": "Repair pack", "radar": "Radar",
    "assembling-machine-1": "Tabulator", "assembling-machine-2": "Computer", "assembling-machine-3": "Cluster",
    "long-handed-inserter": "Long-handed inserter", "steel-plate": "Steel plate", "steel-chest": "Memory bank",
    "fast-inserter": "Fast inserter", "underground-belt": "Underground belt", "splitter": "Splitter",
    "small-lamp": "Lamp", "medium-electric-pole": "Medium electric pole", "big-electric-pole": "Big electric pole",
    "iron-stick": "Iron stick", "steel-furnace": "Steel furnace", "concrete": "Concrete",
    "hazard-concrete": "Hazard concrete", "refined-concrete": "Refined concrete",
    "refined-hazard-concrete": "Refined hazard concrete", "engine-unit": "Engine unit", "landfill": "Landfill",
    "fast-transport-belt": "Fast belt", "fast-underground-belt": "Fast underground belt", "fast-splitter": "Fast splitter",
    "solar-panel": "Solar panel", "rail": "Rail", "locomotive": "Locomotive", "cargo-wagon": "Cargo wagon",
    "train-stop": "Train stop", "rail-signal": "Rail signal", "rail-chain-signal": "Chain signal", "car": "Car",
    "storage-tank": "Data lake", "pump": "Pump", "barrel": "Drive", "pumpjack": "Crawler",
    "oil-refinery": "Data refinery", "chemical-plant": "Trainer", "basic-oil-processing": "Basic refining",
    "solid-fuel-from-petroleum-gas": "Solid fuel (from junk)", "sulfuric-acid": "Sulfuric acid", "sulfur": "Label",
    "plastic-bar": "Plastic", "advanced-circuit": "Processor", "fluid-wagon": "Fluid wagon", "accumulator": "Accumulator",
    "battery": "Battery", "explosives": "Explosives", "cliff-explosives": "Cliff explosives",
    "arithmetic-combinator": "Arithmetic combinator", "decider-combinator": "Decider combinator",
    "constant-combinator": "Constant combinator", "power-switch": "Power switch",
    "programmable-speaker": "Programmable speaker", "display-panel": "Display panel",
    "selector-combinator": "Selector combinator",
    "speed-module": "Speed module 1", "speed-module-2": "Speed module 2", "speed-module-3": "Speed module 3",
    "productivity-module": "Productivity module 1", "productivity-module-2": "Productivity module 2",
    "productivity-module-3": "Productivity module 3", "efficiency-module": "Efficiency module 1",
    "efficiency-module-2": "Efficiency module 2", "efficiency-module-3": "Efficiency module 3",
    "quality-module": "Quality module 1", "quality-module-2": "Quality module 2", "quality-module-3": "Quality module 3",
    "bulk-inserter": "Bulk inserter", "modular-armor": "Modular suit", "solar-panel-equipment": "Portable solar panel",
    "night-vision-equipment": "Night vision", "belt-immunity-equipment": "Belt immunity equipment",
    "battery-equipment": "Personal battery", "battery-mk2-equipment": "Personal battery 2",
    "processing-unit": "Accelerator", "advanced-oil-processing": "Advanced refining",
    "heavy-oil-cracking": "Heavy-fraction cracking", "light-oil-cracking": "Light-fraction cracking",
    "solid-fuel-from-heavy-oil": "Solid fuel (from code)", "solid-fuel-from-light-oil": "Solid fuel (from prose)",
    "lubricant": "Lubricant", "electric-engine-unit": "Electric engine unit", "flying-robot-frame": "Drone frame",
    "roboport": "Agent hub", "passive-provider-chest": "Passive provider chest", "storage-chest": "Storage chest",
    "construction-robot": "Construction agent", "logistic-robot": "Logistic agent",
    "active-provider-chest": "Active provider chest", "requester-chest": "Requester chest", "buffer-chest": "Buffer chest",
    "rocket-fuel": "Curated corpus", "low-density-structure": "Memory stack", "substation": "Substation",
    "electric-furnace": "Electric furnace", "centrifuge": "Centrifuge", "uranium-processing": "Uranium processing",
    "nuclear-reactor": "Nuclear reactor", "heat-exchanger": "Heat exchanger", "heat-pipe": "Heat pipe",
    "steam-turbine": "Steam turbine", "uranium-fuel-cell": "Uranium fuel cell",
    "kovarex-enrichment-process": "Enrichment cascade", "nuclear-fuel": "Nuclear fuel",
    "nuclear-fuel-reprocessing": "Fuel reprocessing", "coal-liquefaction": "Liquefaction",
    "express-transport-belt": "Express belt", "express-underground-belt": "Express underground belt",
    "express-splitter": "Express splitter", "beacon": "Switch", "recycler": "Verifier",
    "power-armor": "Powered suit", "exoskeleton-equipment": "Exoskeleton",
    "personal-roboport-equipment": "Personal assistant", "personal-roboport-mk2-equipment": "Personal assistant 2",
    "rocket-silo": "Frontier cluster", "rocket-part": "Run shard", "satellite": "Post-training payload",
    "cargo-landing-pad": None,  # omitted in base (no platforms)
    # Branch M (military analog; names assume feral code per brainstorm 03, pending F)
    "firearm-magazine": "Signature cartridge", "piercing-rounds-magazine": "Heuristic cartridge",
    "uranium-rounds-magazine": "Classifier cartridge", "gun-turret": "Watchdog", "stone-wall": "Firewall",
    "gate": "Port", "grenade": "Demolition charge", "cluster-grenade": "Cluster charge", "land-mine": "Tripwire",
    "laser-turret": "Detector", "flamethrower-turret": "Sanitizer", "flamethrower-ammo": "Sanitizer canister",
    "rocket": "Interceptor", "explosive-rocket": "Explosive interceptor", "cannon-shell": "Breaching round",
    "explosive-cannon-shell": "Explosive breaching round", "uranium-cannon-shell": "Hardened breaching round",
    "explosive-uranium-cannon-shell": "Hardened explosive breaching round", "artillery-shell": "Reaper",
    "artillery-turret": "Reaper launcher", "artillery-wagon": "Reaper wagon", "atomic-bomb": "EMP warhead",
    "tank": "Armored vehicle", "spidertron": "Legged agent", "defender-capsule": "Sentry agent",
    "distractor-capsule": "Honeypot", "destroyer-capsule": "Hunter agent", "poison-capsule": "Sinkhole",
    "slowdown-capsule": "Tarpit", "heavy-armor": "Heavy suit", "power-armor-mk2": "Powered suit 2",
    "energy-shield-equipment": "Personal firewall", "energy-shield-mk2-equipment": "Personal firewall 2",
    "personal-laser-defense-equipment": "Personal detector", "discharge-defense-equipment": "Circuit breaker",
    "fission-reactor-equipment": "Portable reactor",
    # dropped (no handheld weapons)
    "submachine-gun": None, "shotgun": None, "shotgun-shell": None, "piercing-shotgun-shell": None,
    "combat-shotgun": None, "rocket-launcher": None, "flamethrower": None,
}

AMMO = {"bullet": "cartridge", "shotgun-shell": None, "grenade": "charge", "landmine": "tripwire",
        "rocket": "interceptor", "cannon-shell": "breaching round", "flamethrower": "sanitizer",
        "laser": "detector", "beam": "detector beam", "electric": "circuit breaker",
        "artillery-shell": "Reaper"}
TURRET = {"gun-turret": "watchdog", "flamethrower-turret": "sanitizer"}
QUALITY = {"uncommon": "Selected", "rare": "Verified", "epic": "Audited", "legendary": "Reference"}

# ---------------------------------------------------------------- mapping of every Factorio tech
# fields: id, name, tag, def (definition clause, <=10 words), cite, year, regime (H historical / L literal / F beyond),
# optional: unlocks (override list of strings), add_pre (our ids), drop_pre (our ids), note, branch ("M" for Branch M)
F = {}
def m(fid, **kw):
    F[fid] = kw

# ---- triggers and red
m("steam-power", id="steam_power", name="Steam power", tag="ISO", regime="L",
  defn="Boiling water drives the generator.")
m("electronics", id="switching_circuits", name="Switching circuits", tag="ISO", regime="H",
  defn="Relays and tubes compute Boolean logic.", cite="Shannon, 1938", year=1938)
m("automation-science-pack", id="basic_research", name="Basic research", tag="ISO", regime="H",
  defn="Research performed without thought of practical ends.", cite="Bush, 1945", year=1945)
m("electric-mining-drill", id="electric_mining", name="Electric mining drill", tag="ISO", regime="L",
  defn="Drills powered from the grid.")
m("repair-pack", id="maintenance", name="Maintenance", tag="ISO", regime="L",
  defn="Replace the failing part before the machine stops.")
m("radar", id="radar", name="Radar", tag="ISO", regime="L",
  defn="Pulsed microwaves locate distant objects.")
m("automation", id="tabulation", name="Tabulation", tag="ISO", regime="H",
  defn="Machines count and sort punched cards.", cite="Hollerith, 1890", year=1890)
m("logistic-science-pack", id="linear_programming", name="Linear programming", tag="ISO", regime="H",
  defn="Optimize a linear objective under linear constraints.", cite="Kantorovich, 1939; Dantzig, 1947", year=1947)
m("steel-processing", id="steel_processing", name="Steel processing", tag="ISO", regime="L",
  defn="Iron, refined again in the furnace.")
m("steel-axe", id="learning_curve", name="Learning curve", tag="ISO", regime="H",
  defn="Unit cost falls with each doubling of output.", cite="Wright, 1936", year=1936)
m("fast-inserter", id="servomechanisms", name="Servomechanisms", tag="ISO", regime="H",
  defn="Feedback control of position and speed.", cite="Hazen, 1934", year=1934)
m("logistics", id="logistics", name="Logistics", tag="ISO", regime="L", defn="Belts that cross under and divide.")
m("lamp", id="lamp", name="Lamp", tag="ISO", regime="L", defn="Electric light.")

# ---- green (main)
m("automation-2", id="stored_program", name="Stored program", tag="ISO", regime="H",
  defn="Instructions are kept in memory alongside data.", cite="von Neumann, 1945", year=1945)
m("electric-energy-distribution-1", id="rural_electrification", name="Rural electrification", tag="ISO", regime="L",
  defn="The grid reaches every outpost.")
m("advanced-material-processing", id="zone_refining", name="Zone refining", tag="ISO", regime="H",
  defn="A molten zone sweeps impurities to one end.", cite="Pfann, 1952", year=1952)
m("concrete", id="concrete", name="Concrete", tag="ISO", regime="L", defn="Floors for heavy machines.")
m("engine", id="engine", name="Engine", tag="ISO", regime="L", defn="Pistons turn a shaft.")
m("landfill", id="landfill", name="Landfill", tag="ISO", regime="L", defn="Stone fills water.")
m("logistics-2", id="logistics_2", name="Logistics 2", tag="ISO", regime="L", defn="Belts at 30 items per second.")
m("toolbelt", id="memex", name="Memex", tag="ISO", regime="H",
  defn="A desk that stores a person's records.", cite="Bush, 1945", year=1945)
m("solar-energy", id="photovoltaics", name="Photovoltaics", tag="ISO", regime="H",
  defn="Silicon junctions turn light into current.", cite="Chapin, Fuller & Pearson, 1954", year=1954)
m("railway", id="railway", name="Railway", tag="ISO", regime="L", defn="Steel wheels on steel rails.")
m("automated-rail-transportation", id="semaphores", name="Semaphores", tag="ISO", regime="H",
  defn="A signal admits one occupant at a time.", cite="Dijkstra, 1965", year=1965)
m("automobilism", id="automobile", name="Automobile", tag="ISO", regime="L", defn="Personal transport between outposts.")
m("fluid-handling", id="disk_storage", name="Disk storage", tag="ISO", regime="H",
  defn="Random-access storage on spinning platters.", cite="Noyes & Dickinson, 1956", year=1956)
m("oil-gathering", id="crawling", name="Crawling", tag="ISO", regime="H",
  defn="A program follows links and copies what it finds.", cite="Koster, 1994", year=1994)
m("oil-processing", id="text_categorization", name="Text categorization", tag="ISO", regime="H",
  defn="Documents are sorted by their statistics.", cite="Cavnar & Trenkle, 1994", year=1994)
m("sulfur-processing", id="spam_filtering", name="Spam filtering", tag="ISO", regime="H",
  defn="Unwanted messages are flagged by probability.", cite="Sahami et al., 1998", year=1998)
m("plastics", id="synthetics", name="Synthetics", tag="ISO", regime="H",
  defn="Made, not mined.", cite="Rubin, 1993", year=1993)
m("advanced-circuit", id="integrated_circuit", name="Integrated circuit", tag="ISO", regime="H",
  defn="Many transistors on one die.", cite="Kilby, 1958; Noyce, 1959", year=1959)
m("fluid-wagon", id="fluid_wagon", name="Fluid wagon", tag="ISO", regime="L", defn="A tank on rails.")
m("research-speed-1", id="citation_index", name="Citation index", tag="ISO", regime="H",
  defn="Papers indexed by the papers that cite them.", cite="Garfield, 1955", year=1955)
m("research-speed-2", id="time_sharing", name="Time-sharing", tag="ISO", regime="H",
  defn="One machine, many users at once.", cite="Corbató, Merwin-Daggett & Daley, 1962", year=1962)
m("electric-energy-accumulators", id="accumulators", name="Accumulators", tag="ISO", regime="L",
  defn="Store current for the night.")
m("battery", id="batteries", name="Batteries", tag="ISO", regime="L", defn="Charge stored chemically.")
m("explosives", id="explosives", name="Explosives", tag="ISO", regime="L", defn="Stored energy, released at once.")
m("cliff-explosives", id="cliff_explosives", name="Cliff explosives", tag="ISO", regime="L", defn="Removes cliffs.")
m("flammables", id="information_theory", name="Information theory", tag="ISO", regime="H",
  defn="A message is a number of bits.", cite="Shannon, 1948", year=1948)
m("circuit-network", id="cybernetics", name="Cybernetics", tag="ISO", regime="H",
  defn="Control by feedback; a decider is a threshold unit.", cite="McCulloch & Pitts, 1943; Wiener, 1948", year=1948)
m("modules", id="perceptron", name="Perceptron", tag="ISO", regime="H",
  defn="Threshold units whose weights are set by example.", cite="Rosenblatt, 1958", year=1958,
  add_pre=["artificial_intelligence"], unlocks=["Module slots (gateway; Weights if D defines it)"])
m("speed-module", id="pipelining", name="Pipelining", tag="ISO", regime="H",
  defn="Overlap the stages of successive instructions.", cite="Buchholz, 1962", year=1962)
m("productivity-module", id="backpropagation", name="Backpropagation", tag="ISO", regime="H",
  defn="Errors pass backward to set every weight.",
  cite="Linnainmaa, 1970; Werbos, 1974; Rumelhart, Hinton & Williams, 1986", year=1986)
m("efficiency-module", id="cmos", name="CMOS", tag="ISO", regime="H",
  defn="Logic that draws power only when it switches.", cite="Wanlass & Sah, 1963", year=1963)
m("quality-module", id="rejection_sampling", name="Rejection sampling", tag="ISO", regime="H",
  defn="Sample, test, keep what passes.", cite="von Neumann, 1951", year=1951)
m("mining-productivity-1", id="mining_productivity_1", name="Mining productivity 1", tag="ISO", regime="L",
  defn="More from every deposit.", series="mining_productivity")
m("bulk-inserter", id="batch_processing", name="Batch processing", tag="ISO", regime="L",
  defn="Collect a full load, then move it at once.")
for i, n in enumerate(["1", "2", "3", "4", "5", "6", "7"]):
    m(f"inserter-capacity-bonus-{n}", id=f"batch_size_{n}", name=f"Batch size {n}", tag="ISO", regime="L",
      defn="Larger hands per swing.", series="batch_size")
m("chemical-science-pack", id="statistical_learning", name="Statistical learning", tag="ISO", regime="H",
  defn="Learning as estimation, with bounds on the error.",
  cite="Vapnik & Chervonenkis, 1971; Vapnik, 1995", year=1995, add_pre=["artificial_intelligence"])
m("modular-armor", id="wearable_computing", name="Wearable computing", tag="ISO", regime="H",
  defn="A computer worn on the body.", cite="Thorp, 1998", year=1998)
m("solar-panel-equipment", id="portable_solar", name="Portable solar", tag="ISO", regime="L",
  defn="A solar cell for the suit.")
m("night-vision-equipment", id="night_vision", name="Night vision", tag="ISO", regime="L", defn="Amplified starlight.")
m("belt-immunity-equipment", id="belt_immunity", name="Belt immunity", tag="ISO", regime="L",
  defn="Belts no longer carry you.")
m("battery-equipment", id="personal_battery", name="Personal battery", tag="ISO", regime="L",
  defn="Stored charge for the suit.")

# ---- blue (main)
m("processing-unit", id="accelerators", name="Accelerators", tag="ISO", regime="H",
  defn="Matrix arithmetic on hardware built for graphics.", cite="Raina, Madhavan & Ng, 2009", year=2009)
m("advanced-oil-processing", id="paraphrase_generation", name="Paraphrase generation", tag="ISO", regime="H",
  defn="A model rewrites text in other words.", cite="Quirk, Brockett & Dolan, 2004", year=2004)
m("lubricant", id="lubricant", name="Lubricant", tag="ISO", regime="L", defn="Less friction, less wear.")
m("electric-engine", id="brushless_motors", name="Brushless motors", tag="ISO", regime="H",
  defn="Commutation by electronics instead of brushes.", cite="Wilson & Trickey, 1962", year=1962)
m("robotics", id="mobile_robotics", name="Mobile robotics", tag="ISO", regime="H",
  defn="A robot that plans its own movements.", cite="Nilsson, 1969", year=1969)
m("construction-robotics", id="automated_planning", name="Automated planning", tag="ISO", regime="H",
  defn="Search for a sequence of actions that reaches a goal.", cite="Fikes & Nilsson, 1971", year=1971)
m("logistic-robotics", id="multi_agent_systems", name="Multi-agent systems", tag="ISO", regime="H",
  defn="Agents bid for tasks and coordinate deliveries.", cite="Smith, 1980", year=1980)
for n in ["1", "2", "3", "4", "5", "6"]:
    m(f"worker-robots-speed-{n}", id=f"inference_speed_{n}", name=f"Inference speed {n}" + ("+" if n == "6" else ""),
      tag="ISO", regime="L",
      defn="Agents act sooner.", series="inference_speed")
for n in ["1", "2", "3"]:
    m(f"worker-robots-storage-{n}", id=f"context_length_{n}", name=f"Context length {n}", tag="ISO", regime="L",
      defn="Agents carry more per trip.", series="context_length")
m("rocket-fuel", id="curated_corpora", name="Curated corpora", tag="ISO", regime="H",
  defn="Data selected, cleaned and labelled for training.", cite="Deng et al., 2009", year=2009)
m("low-density-structure", id="memory_wall", name="Memory wall", tag="ISO", regime="H",
  defn="Processors outpace memory; bandwidth becomes the limit.", cite="Wulf & McKee, 1995", year=1995)
m("research-speed-3", id="web_search", name="Web search", tag="ISO", regime="H",
  defn="Pages ranked by the links that point to them.", cite="Brin & Page, 1998", year=1998)
m("research-speed-4", id="open_source_libraries", name="Open-source libraries", tag="ISO", regime="H",
  defn="Shared, reviewed implementations of standard methods.", cite="Pedregosa et al., 2011", year=2011)
m("electric-energy-distribution-2", id="substations", name="Substations", tag="ISO", regime="L",
  defn="Power for a whole block.")
m("advanced-material-processing-2", id="electric_furnace", name="Electric furnace", tag="ISO", regime="L",
  defn="Smelting by electricity.")
m("laser", id="anomaly_detection", name="Anomaly detection", tag="ISO", regime="H", branch="M",
  defn="Flag what departs from normal behaviour.", cite="Denning, 1987", year=1987)
for n in ["1", "2", "3", "4", "5", "6", "7"]:
    m(f"braking-force-{n}", id=f"braking_force_{n}", name=f"Braking force {n}", tag="ISO", regime="L",
      defn="Trains stop in less track.", series="braking_force")
m("speed-module-2", id="vector_processing", name="Vector processing", tag="ISO", regime="H",
  defn="One instruction applied to many operands.", cite="Flynn, 1966", year=1966)
m("productivity-module-2", id="convolution", name="Convolution", tag="ISO", regime="H",
  defn="The same weights at every position.", cite="Fukushima, 1980; LeCun et al., 1989", year=1989)
m("efficiency-module-2", id="model_compression", name="Model compression", tag="ISO", regime="H",
  defn="A small model trained on a large model's outputs.",
  cite="Buciluǎ, Caruana & Niculescu-Mizil, 2006", year=2006)
m("quality-module-2", id="beam_search", name="Beam search", tag="ISO", regime="H",
  defn="Keep the best few partial answers at each step.", cite="Lowerre, 1976", year=1976)
m("uranium-mining", id="in_situ_leaching", name="In-situ leaching", tag="ISO", regime="L",
  defn="Acid pumped through the ore body dissolves the metal.")
m("uranium-processing", id="isotope_separation", name="Isotope separation", tag="ISO", regime="L",
  defn="Spin out the lighter isotope.")
m("nuclear-power", id="nuclear_power", name="Nuclear power", tag="ISO", regime="L", defn="Fission heat raises steam.")
m("mining-productivity-2", id="mining_productivity_2", name="Mining productivity 2", tag="ISO", regime="L",
  defn="More from every deposit.", series="mining_productivity")
m("mining-productivity-3", id="mining_productivity_3", name="Mining productivity 3", tag="ISO", regime="L",
  defn="More from every deposit.", series="mining_productivity")
m("mining-productivity-4", id="mining_productivity_4", name="Mining productivity 4+", tag="ISO", regime="L",
  defn="More from every deposit.", series="mining_productivity")
m("power-armor", id="powered_suit", name="Powered suit", tag="ISO", regime="L", defn="A suit with its own motors.")
m("exoskeleton-equipment", id="exoskeleton", name="Exoskeleton", tag="ISO", regime="L", defn="Motors that move your legs.")
m("personal-roboport-equipment", id="personal_assistant", name="Personal assistant", tag="ISO", regime="H",
  defn="Agents that follow you and build what you mark.", cite="Myers et al., 2007", year=2007)
m("personal-roboport-mk2-equipment", id="personal_assistant_2", name="Personal assistant 2", tag="ISO", regime="L",
  defn="More agents, more range.")
m("battery-mk2-equipment", id="personal_battery_2", name="Personal battery 2", tag="ISO", regime="L",
  defn="More stored charge.")
m("advanced-combinators", id="lateral_inhibition", name="Lateral inhibition", tag="ISO", regime="H",
  defn="The strongest signals suppress their neighbours.", cite="Hartline, 1949", year=1949)

# ---- purple
m("production-science-pack", id="deep_learning", name="Deep learning", tag="ISO", regime="H",
  defn="Many layers, trained end to end.", cite="Hinton, Osindero & Teh, 2006", year=2006)
m("automation-3", id="cluster_computing", name="Cluster computing", tag="ISO", regime="H",
  defn="Commodity machines joined into one computer.", cite="Sterling et al., 1995", year=1995)
m("logistics-3", id="logistics_3", name="Logistics 3", tag="ISO", regime="L", defn="Belts at 45 items per second.")
m("effect-transmission", id="data_parallelism", name="Data parallelism", tag="ISO", regime="H",
  defn="Many accelerators share one job; each adds less.", cite="Dean et al., 2012", year=2012)
m("coal-liquefaction", id="mass_digitization", name="Mass digitization", tag="ISO", regime="H",
  defn="Whole libraries scanned and converted to text.", cite="Michel et al., 2011", year=2011)
m("kovarex-enrichment-process", id="enrichment_cascade", name="Enrichment cascade", tag="ISO", regime="L",
  defn="Recirculate the enriched stream.")
m("nuclear-fuel-reprocessing", id="fuel_reprocessing", name="Fuel reprocessing", tag="ISO", regime="L",
  defn="Recover uranium from spent cells.")
m("speed-module-3", id="systolic_arrays", name="Systolic arrays", tag="ISO", regime="H",
  defn="Operands pulse through a grid of multiply-add cells.", cite="Kung & Leiserson, 1978", year=1978)
m("productivity-module-3", id="attention", name="Attention", tag="ISO", regime="H",
  defn="Every token weighs every other token.",
  cite="Bahdanau, Cho & Bengio, 2015; Vaswani et al., 2017", year=2017)
m("efficiency-module-3", id="quantization", name="Quantization", tag="ISO", regime="H",
  defn="Fewer bits per weight.", cite="Jacob et al., 2018", year=2018)
m("quality-module-3", id="tree_search", name="Monte Carlo tree search", tag="ISO", regime="H",
  defn="Simulate many continuations; expand the most promising.",
  cite="Coulom, 2006; Kocsis & Szepesvári, 2006", year=2006)
m("research-speed-5", id="automatic_differentiation", name="Automatic differentiation", tag="ISO", regime="H",
  defn="Exact derivatives of any program, computed mechanically.", cite="Wengert, 1964", year=1964)
m("recycling", id="expert_iteration", name="Expert iteration", tag="ISO", regime="H",
  defn="Generate, keep the best, train on it, repeat.", cite="Anthony, Tian & Barber, 2017", year=2017)

# ---- yellow
m("utility-science-pack", id="expected_utility", name="Expected utility", tag="ISO", regime="H",
  defn="Rank outcomes by probability-weighted utility.",
  cite="Bernoulli, 1738; von Neumann & Morgenstern, 1944", year=1944)
m("logistic-system", id="instruction_tuning", name="Instruction tuning", tag="ISO", regime="H",
  defn="Models trained to follow written requests.", cite="Wei et al., 2022", year=2022)
m("research-speed-6", id="code_generation", name="Code generation", tag="ISO", regime="H",
  defn="Models write the experiment code.", cite="Chen et al., 2021", year=2021)
m("epic-quality", id="scalable_oversight", name="Scalable oversight", tag="ISO", regime="H",
  defn="Supervise work that people cannot check directly.",
  cite="Amodei et al., 2016; Irving, Christiano & Amodei, 2018", year=2018, add_pre=["interpretability"])
m("rocket-silo", id="scaling_laws", name="Scaling laws", tag="ISO", regime="H",
  defn="Loss falls as a power law in scale.", cite="Kaplan et al., 2020; Hoffmann et al., 2022", year=2022,
  unlocks=["Frontier cluster", "Run shard"],
  note="Satellite moved to Preference tuning; cargo landing pad omitted (no platforms in base).")

# ---- white
m("space-science-pack", id="in_context_learning", name="In-context learning", tag="ISO", regime="H",
  defn="A trained model learns a task from its prompt.", cite="Brown et al., 2020", year=2020,
  add_pre=["preference_tuning"],
  unlocks=["System card (each completed frontier run with a payload returns 1,000)"])
m("legendary-quality", id="formal_verification", name="Formal verification", tag="ISO", regime="H",
  defn="A machine-checked proof that the program is correct.", cite="Floyd, 1967; Hoare, 1969", year=1969)

# ---------------------------------------------------------------- Branch M (military analog). Names pending F.
m("military", id="debugging", name="Debugging", tag="BEND", regime="L", branch="M",
  defn="Find the fault; remove it.", unlocks=["Signature cartridge"],
  note="No handheld weapons; the first watchdog ammunition instead (Factorio starts with it).")
m("gun-turret", id="watchdogs", name="Watchdogs", tag="ISO", regime="L", branch="M",
  defn="A monitor that acts on what it detects.")
m("stone-wall", id="firewalls", name="Firewalls", tag="ISO", regime="L", branch="M",
  defn="A wall built to stop a spreading fire.")
m("heavy-armor", id="protective_clothing", name="Protective clothing", tag="ISO", regime="L", branch="M",
  defn="Layers that absorb damage.")
m("military-2", id="heuristic_scanning", name="Heuristic scanning", tag="ISO", regime="H", branch="M",
  defn="Flag code that behaves like known threats.", cite="Cohen, 1987", year=1987)
m("gate", id="ports", name="Ports", tag="ISO", regime="L", branch="M", defn="A door in the firewall.")
m("military-science-pack", id="game_theory", name="Game theory", tag="ISO", regime="H", branch="M",
  defn="Strategy against an opponent who strategizes back.", cite="von Neumann, 1928", year=1928)
m("defender", id="sentry_agents", name="Sentry agents", tag="ISO", regime="L", branch="M",
  defn="Agents that escort you and fire on threats.")
m("energy-shield-equipment", id="personal_firewall", name="Personal firewall", tag="ISO", regime="L", branch="M",
  defn="A firewall for one person.")
m("energy-shield-mk2-equipment", id="personal_firewall_2", name="Personal firewall 2", tag="ISO", regime="L",
  branch="M", defn="A stronger personal firewall.")
m("land-mine", id="tripwires", name="Tripwires", tag="ISO", regime="H", branch="M",
  defn="Any change to a watched object raises the alarm.", cite="Kim & Spafford, 1994", year=1994)
m("flamethrower", id="input_sanitization", name="Input sanitization", tag="ISO", regime="L", branch="M",
  defn="Wash every input before it is used.", unlocks=["Sanitizer", "Sanitizer canister"])
m("rocketry", id="countermeasures", name="Countermeasures", tag="ISO", regime="L", branch="M",
  defn="Interceptors launched at incoming threats.", unlocks=["Interceptor"],
  note="Interceptors are fired by Legged agents.")
m("explosive-rocketry", id="countermeasures_2", name="Countermeasures 2", tag="ISO", regime="L", branch="M",
  defn="Interceptors with an explosive payload.")
m("military-3", id="tarpits", name="Tarpits", tag="ISO", regime="L", branch="M",
  defn="Hold the connection open; the attacker waits.", unlocks=["Tarpit", "Sinkhole"])
m("laser-turret", id="intrusion_detection", name="Intrusion detection", tag="ISO", regime="H", branch="M",
  defn="Audit records reveal intrusions.", cite="Anderson, 1980", year=1980)
m("tank", id="armored_vehicle", name="Armored vehicle", tag="ISO", regime="L", branch="M",
  defn="A tracked vehicle that breaches heaps.")
m("distractor", id="honeypots", name="Honeypots", tag="ISO", regime="H", branch="M",
  defn="A decoy that attracts and holds attackers.", cite="Cheswick, 1992", year=1992)
m("personal-laser-defense-equipment", id="personal_detector", name="Personal detector", tag="ISO", regime="L",
  branch="M", defn="A detector worn on the suit.")
m("discharge-defense-equipment", id="circuit_breaker", name="Circuit breaker", tag="ISO", regime="L", branch="M",
  defn="A discharge that throws back everything nearby.")
m("military-4", id="cluster_charges", name="Cluster charges", tag="ISO", regime="L", branch="M",
  defn="One charge that scatters many.", unlocks=["Cluster charge"])
m("uranium-ammo", id="learned_classifiers", name="Learned classifiers", tag="ISO", regime="H", branch="M",
  defn="Detectors trained on examples, not written by hand.", cite="Kolter & Maloof, 2006", year=2006)
m("atomic-bomb", id="electromagnetic_pulse", name="Electromagnetic pulse", tag="ISO", regime="L", branch="M",
  defn="A burst that destroys unshielded electronics.")
m("power-armor-mk2", id="powered_suit_2", name="Powered suit 2", tag="ISO", regime="L", branch="M",
  defn="The largest equipment grid.")
m("fission-reactor-equipment", id="portable_reactor", name="Portable reactor", tag="ISO", regime="L", branch="M",
  defn="A fission reactor for the suit.")
m("destroyer", id="hunter_agents", name="Hunter agents", tag="ISO", regime="L", branch="M",
  defn="Escorts that seek threats out.")
m("artillery", id="counter_worms", name="Counter-worms", tag="ISO", regime="L", branch="M",
  defn="A program that hunts a worm across the network.")
m("spidertron", id="embodied_agents", name="Embodied agents", tag="ISO", regime="H", branch="M",
  defn="An agent with legs, remotely directed.", cite="Brooks, 1991", year=1991)
for n in ["1", "2", "3", "4", "5", "6", "7"]:
    m(f"physical-projectile-damage-{n}", id=f"signature_coverage_{n}",
      name=f"Signature coverage {n}" + ("+" if n == "7" else ""), tag="ISO", regime="L", branch="M",
      defn="More known threats recognized.", series="signature_coverage")
for n in ["1", "2", "3", "4", "5", "6"]:
    m(f"weapon-shooting-speed-{n}", id=f"scan_rate_{n}", name=f"Scan rate {n}", tag="ISO", regime="L", branch="M",
      defn="Faster scanning.", series="scan_rate")
for n in ["1", "2", "3", "4", "5", "6", "7"]:
    m(f"stronger-explosives-{n}", id=f"charge_yield_{n}", name=f"Charge yield {n}" + ("+" if n == "7" else ""),
      tag="ISO", regime="L", branch="M", defn="Stronger charges.", series="charge_yield")
for n in ["1", "2", "3", "4", "5", "6", "7"]:
    m(f"refined-flammables-{n}", id=f"sanitizer_strength_{n}",
      name=f"Sanitizer strength {n}" + ("+" if n == "7" else ""), tag="ISO", regime="L", branch="M",
      defn="Stronger sanitizer.", series="sanitizer_strength")
for n in ["1", "2", "3", "4", "5", "6", "7"]:
    m(f"laser-weapons-damage-{n}", id=f"detector_precision_{n}",
      name=f"Detector precision {n}" + ("+" if n == "7" else ""), tag="ISO", regime="L", branch="M",
      defn="Detectors hit harder.", series="detector_precision")
for n in ["1", "2", "3", "4", "5", "6", "7"]:
    m(f"laser-shooting-speed-{n}", id=f"detector_throughput_{n}", name=f"Detector throughput {n}", tag="ISO",
      regime="L", branch="M", defn="Detectors fire faster.", series="detector_throughput")
for n in ["1", "2", "3", "4", "5"]:
    m(f"follower-robot-count-{n}", id=f"escort_size_{n}", name=f"Escort size {n}" + ("+" if n == "5" else ""),
      tag="ISO", regime="L", branch="M", defn="More escorts at once.", series="escort_size")
m("artillery-shell-range-1", id="reaper_range", name="Reaper range", tag="ISO", regime="L", branch="M",
  defn="Reapers reach farther.", series="reaper")
m("artillery-shell-speed-1", id="reaper_reload", name="Reaper reload", tag="ISO", regime="L", branch="M",
  defn="Reapers fire sooner.", series="reaper")

# ---------------------------------------------------------------- BEND additions (no Factorio mirror)
# cost: (count, letters, time) | ("formula", str, letters, time) | ("trigger", str) | ("start",)
BEND = [
    dict(id="prior_art", name="Prior art", tier="S", tag="BEND", regime="L", cost=("start",), pre=[],
         unlocks=["Stone furnace", "Burner mining drill", "Iron gear wheel", "Transport belt", "Burner inserter",
                  "Wooden chest", "Iron chest", "Smelting (iron, copper, stone brick)", "Archive processing (per D)"],
         defn="Known before the game begins.",
         note="Cosmetic root node showing the start recipes (Factorio has these enabled with no node). "
              "No firearm magazine and no pistol at start."),
    dict(id="artificial_intelligence", name="Artificial intelligence", tier="R", tag="BEND", regime="H",
         cost=(10, "R", 60), pre=["basic_research"], unlocks=["No effect; required by Perceptron, Expert systems, "
                                                              "Statistical learning"],
         defn="Proposed as a two-month, ten-man study.", cite="McCarthy, Minsky, Rochester & Shannon, 1955",
         year=1955, note="H's set-piece: ten memos, as the proposal asked for ten men."),
    dict(id="expert_systems", name="Expert systems", tier="G", tag="BEND", regime="H", cost=(100, "RG", 30),
         pre=["artificial_intelligence", "linear_programming"],
         unlocks=["Hand-crafting speed +100%. Does not apply to machines."],
         defn="Rules written by hand, consulted by machine.", cite="Feigenbaum, 1977", year=1977),
    dict(id="packet_switching", name="Packet switching", tier="G", tag="BEND", regime="H", cost=(100, "RG", 30),
         pre=["cybernetics", "radar"], unlocks=["Radars relay circuit signals to one another"],
         defn="Messages cut into packets, each routed independently.", cite="Baran, 1964; Davies, 1966", year=1966,
         note="Gates 2.0's radar signal relay. The 'Networking' node if F wakes feral code with networking."),
    dict(id="dennard_scaling_1", name="Dennard scaling 1", tier="G", tag="BEND", regime="H", cost=(100, "RG", 30),
         pre=["cmos"], unlocks=["Electric machines -4% energy"], defn="Smaller transistors, same power per area.",
         cite="Dennard et al., 1974", year=1974, series="dennard"),
    dict(id="dennard_scaling_2", name="Dennard scaling 2", tier="G", tag="BEND", regime="H", cost=(200, "RG", 30),
         pre=["dennard_scaling_1"], unlocks=["Electric machines -4% energy"],
         defn="Smaller transistors, same power per area.", cite="Dennard et al., 1974", year=1974, series="dennard"),
    dict(id="dennard_scaling_3", name="Dennard scaling 3", tier="B", tag="BEND", regime="H", cost=(250, "RGB", 30),
         pre=["dennard_scaling_2", "statistical_learning"], unlocks=["Electric machines -4% energy"],
         defn="Smaller transistors, same power per area.", cite="Dennard et al., 1974", year=1974, series="dennard"),
    dict(id="dennard_scaling_4", name="Dennard scaling 4", tier="B", tag="BEND", regime="H", cost=(500, "RGB", 30),
         pre=["dennard_scaling_3"], unlocks=["Electric machines -4% energy"],
         defn="Smaller transistors, same power per area.", cite="Dennard et al., 1974", year=1974, series="dennard"),
    dict(id="dennard_scaling_5", name="Dennard scaling 5", tier="B", tag="BEND", regime="H", cost=(500, "RGB", 30),
         pre=["dennard_scaling_4"], unlocks=["Electric machines -4% energy. No further levels exist."],
         defn="Smaller transistors, same power per area.", cite="Dennard et al., 1974", year=1974, series="dennard"),
    dict(id="preference_tuning", name="Preference tuning", tier="Y", tag="BEND", regime="H",
         cost=(200, "RGBPY", 30), pre=["scaling_laws"], unlocks=["Post-training payload"],
         defn="Tune against a reward fitted to human comparisons.",
         cite="Christiano et al., 2017; Ouyang et al., 2022", year=2022,
         note="Factorio unlocks the satellite with the silo; here post-training is its own, cheap idea (keeps pacing)."),
    dict(id="interpretability", name="Interpretability", tier="Y", tag="BEND", regime="H", cost=(1000, "RGBPY", 60),
         pre=["expected_utility", "attention"],
         unlocks=["Quality of model items is shown (checkpoint-type modules, Researchers, payloads, agents); "
                  "before this it reads '?' and filters cannot sort by it"],
         defn="Read what a trained network computes.", cite="Olah et al., 2018", year=2018,
         note="D5 / brainstorm 03 reveal. Optional: drop if hidden quality tests badly."),
    dict(id="automated_research", name="Automated research", tier="W", tag="BEND", regime="H",
         cost=(1000, "RGBPYW", 60), pre=["in_context_learning"],
         unlocks=["Researcher (4 Accelerators + 1 Checkpoint -> 1 Researcher + 1 Checkpoint returned)",
                  "Research cluster (writes System cards)", "Model generation (infinite)"],
         defn="Machines do the research that improves the machines.", cite="Good, 1965", year=1965,
         note="Closes the loop. Takeoff clock starts here (G)."),
    dict(id="chain_of_thought", name="Chain of thought", tier="W", tag="BEND", regime="H",
         cost=(2000, "RGBPYW", 60), pre=["automated_research"], unlocks=["Model generation multiplier m +0.15"],
         defn="Intermediate steps written out before the answer.", cite="Wei et al., 2022", year=2022),
    dict(id="self_play", name="Self-play", tier="W", tag="BEND", regime="H", cost=(2000, "RGBPYW", 60),
         pre=["automated_research"],
         unlocks=["Model generation multiplier m +0.15", "Research clusters no longer consume Curated corpora (lever d)"],
         defn="The model generates its own training opponents.", cite="Samuel, 1959; Silver et al., 2017", year=2017),
    dict(id="test_time_compute", name="Test-time compute", tier="W", tag="BEND", regime="H",
         cost=(3000, "RGBPYW", 60), pre=["chain_of_thought"], unlocks=["Model generation multiplier m +0.15"],
         defn="Spend compute per answer instead of per model.", cite="Snell et al., 2024", year=2024),
    dict(id="synthetic_curriculum", name="Synthetic curriculum", tier="W", tag="BEND", regime="F",
         cost=(5000, "W", 60), pre=["self_play", "test_time_compute"], unlocks=["Model generation multiplier m +0.15"],
         defn="The model orders its own data.", note="Beyond the literature (H 5.1 #39)."),
    dict(id="research_scheduling", name="Research scheduling", tier="W", tag="BEND", regime="F",
         cost=(5000, "W", 60), pre=["automated_research"],
         unlocks=["Researchers fill the research queue ('Queued by: Researcher')"],
         defn="Researchers choose the next technology.", note="Beyond the literature (H 5.1 #41). Presentation BEND."),
    dict(id="weight_transplant", name="Weight transplant", tier="W", tag="BEND", regime="F",
         cost=(5000, "W", 60), pre=["automated_research"],
         unlocks=["Recipe: Researcher moves to higher-quality Accelerators; the old Accelerators are returned"],
         defn="Weights move to new hardware without retraining.", note="Beyond the literature (H 5.1 #40)."),
    # infinite BENDs
    dict(id="research_productivity", name="Research productivity", tier="W", tag="BEND", regime="H",
         cost=("formula", "2^(L-1)×1000", "RGBPYW", 60), pre=["in_context_learning"],
         unlocks=["Research productivity +10%"], defn="Each idea costs more research than the last.",
         cite="Bloom, Jones, Van Reenen & Webb, 2020", year=2020, infinite=True,
         note="Space Age research productivity (+10%/level, 1.2^L×1000 at 120 s); cost doubles here (H)."),
    dict(id="self_driving_labs", name="Self-driving labs", tier="W", tag="BEND", regime="H",
         cost=("formula", "2^(L-1)×1000", "RGBPYW", 60), pre=["in_context_learning", "code_generation"],
         unlocks=["Lab speed +20%"], defn="Experiments chosen, run and read by machine.", cite="King et al., 2009",
         year=2009, infinite=True, note="Research speed 7+."),
    dict(id="process_node", name="Process node", tier="W", tag="BEND", regime="H",
         cost=("formula", "2^(L-1)×1000", "RGBPYW", 60), pre=["in_context_learning"],
         unlocks=["Accelerator productivity +10%"], defn="Transistors per die double; so does the fab's cost.",
         cite="Moore, 1965", year=1965, infinite=True,
         note="Space Age processing-unit productivity; Rock's law as the cost curve (H)."),
    dict(id="algorithmic_progress", name="Algorithmic progress", tier="W", tag="BEND", regime="H",
         cost=("formula", "1.5^L×2000", "RGBPYW", 60), pre=["in_context_learning"],
         unlocks=["Run shard productivity +10%"], defn="The same loss for less compute.", cite="Ho et al., 2024",
         year=2024, infinite=True, note="Space Age rocket part productivity, same formula."),
    dict(id="compute_efficiency", name="Compute efficiency", tier="W", tag="BEND", regime="H",
         cost=("formula", "1.5^L×1000", "RGBPYW", 60), pre=["automated_research"],
         unlocks=["Research cluster energy -10% (multiplicative); floor 10% of base"],
         defn="Computations per joule double, toward a physical floor.",
         cite="Landauer, 1961; Koomey et al., 2011", year=2011, infinite=True, note="Optional (lever q)."),
    dict(id="model_generation", name="Model generation", tier="W", tag="BEND", regime="F",
         cost=("formula", "2^(L-1)×1000", "W", 30), pre=["automated_research"],
         unlocks=["Researcher output ×m (m₀ = 1.5); Researcher energy ×q (q = 1.0)"],
         defn="The previous generation trained this one.", infinite=True,
         note="The RSI lever. Costs System cards only. Beyond the literature."),
]

# Factorio-derived prerequisite overrides beyond add_pre (none needed so far), and the tier for each mirrored tech
# is computed from its packs.

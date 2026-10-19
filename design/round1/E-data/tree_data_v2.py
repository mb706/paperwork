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
    "electric-mining-drill": "Electric mining drill", "repair-pack": "Repair kit", "radar": "Radar",
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
    "firearm-magazine": "Magazine", "piercing-rounds-magazine": "AP magazine",
    "uranium-rounds-magazine": "DU magazine", "gun-turret": "Gun turret", "stone-wall": "Fence",
    "gate": "Gate", "grenade": "Charge", "cluster-grenade": "Cluster charge", "land-mine": "Land mine",
    "laser-turret": "Laser turret", "flamethrower-turret": None, "flamethrower-ammo": None,
    "rocket": "Rocket", "explosive-rocket": "Explosive rocket", "cannon-shell": "Cannon shell",
    "explosive-cannon-shell": "Explosive cannon shell", "uranium-cannon-shell": "DU cannon shell",
    "explosive-uranium-cannon-shell": "Explosive DU cannon shell", "artillery-shell": "Artillery shell",
    "artillery-turret": "Artillery turret", "artillery-wagon": "Artillery wagon", "atomic-bomb": "EMP warhead",
    "tank": "Tank", "spidertron": "Legged agent", "defender-capsule": "Interceptor 1",
    "distractor-capsule": "Interceptor 2", "destroyer-capsule": "Interceptor 3", "poison-capsule": "Poison capsule",
    "slowdown-capsule": "Slowdown capsule", "heavy-armor": "Heavy armor", "power-armor-mk2": "Powered suit 2",
    "energy-shield-equipment": "Energy shield", "energy-shield-mk2-equipment": "Energy shield 2",
    "personal-laser-defense-equipment": "Personal laser defense", "discharge-defense-equipment": "Discharge defense",
    "fission-reactor-equipment": "Portable reactor",
    # dropped (no handheld weapons)
    "submachine-gun": None, "shotgun": None, "shotgun-shell": None, "piercing-shotgun-shell": None,
    "combat-shotgun": None, "rocket-launcher": None, "flamethrower": None,
}

AMMO = {"bullet": "magazine", "shotgun-shell": None, "grenade": "charge", "landmine": "land mine",
        "rocket": "rocket", "cannon-shell": "cannon shell", "flamethrower": None,
        "laser": "laser", "beam": "laser beam", "electric": "discharge",
        "artillery-shell": "artillery shell"}
TURRET = {"gun-turret": "gun turret", "flamethrower-turret": None}
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
  defn="A program follows links and copies what it finds.", cite="Koster, 1994", year=1994,
  add_pre=["packet_switching"])
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

# ---------------------------------------------------------------- Branch M (military analog), per F-pressure Variant A
# Ferals are physical agent bodies; defenses keep Factorio-literal names (F 3.3). No handheld weapons.
m("military", id="ballistics", name="Ballistics", tag="BEND", regime="L", branch="M",
  defn="Projectiles, aimed and fed by machine.", unlocks=["Magazine"],
  note="No handheld weapons, so no pistol or SMG; magazines feed gun turrets only.")
m("gun-turret", id="fire_control", name="Fire control", tag="ISO", regime="H", branch="M",
  defn="Predict where the target will be; aim there.", cite="Wiener, 1949", year=1949)
m("stone-wall", id="fences", name="Fences", tag="ISO", regime="L", branch="M", defn="A barrier around the site.")
m("heavy-armor", id="protective_clothing", name="Protective clothing", tag="ISO", regime="L", branch="M",
  defn="Layers that absorb damage.")
m("military-2", id="armor_piercing", name="Armor piercing", tag="ISO", regime="L", branch="M",
  defn="Hardened rounds for hardened bodies.", unlocks=["AP magazine", "Charge (ingredient only)"])
m("gate", id="gates", name="Gates", tag="ISO", regime="L", branch="M", defn="A fence that opens.")
m("military-science-pack", id="game_theory", name="Game theory", tag="ISO", regime="H", branch="M",
  defn="Strategy against an opponent who strategizes back.", cite="von Neumann, 1928", year=1928)
m("defender", id="interceptors", name="Interceptors", tag="BEND", regime="L", branch="M",
  defn="Drones launched from a bay at intruders.", unlocks=["Interceptor bay", "Interceptor 1", "Interceptor count +4"],
  note="F: launched by a building, never thrown.")
m("distractor", id="interceptors_2", name="Interceptors 2", tag="BEND", regime="L", branch="M",
  defn="Decoy interceptors that draw attacks.", unlocks=["Interceptor 2"])
m("destroyer", id="interceptors_3", name="Interceptors 3", tag="BEND", regime="L", branch="M",
  defn="Interceptors that seek intruders out.", unlocks=["Interceptor 3"])
m("energy-shield-equipment", id="energy_shield", name="Energy shield", tag="ISO", regime="L", branch="M",
  defn="A field that absorbs damage.")
m("energy-shield-mk2-equipment", id="energy_shield_2", name="Energy shield 2", tag="ISO", regime="L", branch="M",
  defn="A stronger field.")
m("land-mine", id="land_mines", name="Land mines", tag="ISO", regime="L", branch="M", defn="Charges that wait.")
m("flamethrower", id="flamethrower", drop=True, reason="No combustible fluid (the crawl is text); F's Arc turret takes the slot")
m("rocketry", id="rocketry", name="Rocketry", tag="ISO", regime="L", branch="M",
  defn="Self-propelled projectiles.", unlocks=["Rocket"], note="Fired by Legged agents; no rocket launcher.")
m("explosive-rocketry", id="explosive_rocketry", name="Explosive rocketry", tag="ISO", regime="L", branch="M",
  defn="Rockets with an explosive payload.")
m("military-3", id="area_denial", name="Area denial", tag="BEND", regime="L", branch="M",
  defn="Slow or corrode everything in an area.", unlocks=["Slowdown capsule", "Poison capsule"],
  note="F to rule: launched by Interceptor bays or Legged agents, never thrown.")
m("laser", id="laser", name="Laser", tag="ISO", regime="H", branch="M",
  defn="Coherent light from stimulated emission.", cite="Maiman, 1960", year=1960)
m("laser-turret", id="laser_turret", name="Laser turret", tag="ISO", regime="L", branch="M",
  defn="A turret that fires on electricity.")
m("tank", id="tank", name="Tank", tag="ISO", regime="L", branch="M", defn="An armored tracked vehicle.",
  note="Vehicle-mounted cannon; F to confirm against 'no handheld weapons'.")
m("personal-laser-defense-equipment", id="personal_laser_defense", name="Personal laser defense", tag="ISO",
  regime="L", branch="M", defn="A laser turret worn on the suit.")
m("discharge-defense-equipment", id="discharge_defense", name="Discharge defense", tag="ISO", regime="L",
  branch="M", defn="A discharge that throws back everything nearby.")
m("military-4", id="cluster_munitions", name="Cluster munitions", tag="BEND", regime="L", branch="M",
  defn="One charge that scatters many.", unlocks=["Cluster charge (artillery and Legged-agent use)"])
m("uranium-ammo", id="depleted_uranium", name="Depleted uranium", tag="ISO", regime="L", branch="M",
  defn="Dense metal left over from enrichment.")
m("atomic-bomb", id="electromagnetic_pulse", name="Electromagnetic pulse", tag="BEND", regime="L", branch="M",
  defn="A burst that destroys unshielded electronics.",
  note="Ferals have 0% electric resistance (F); delivered by artillery or Legged agents.")
m("power-armor-mk2", id="powered_suit_2", name="Powered suit 2", tag="ISO", regime="L", branch="M",
  defn="The largest equipment grid.")
m("fission-reactor-equipment", id="portable_reactor", name="Portable reactor", tag="ISO", regime="L", branch="M",
  defn="A fission reactor for the suit.")
m("artillery", id="artillery", name="Artillery", tag="ISO", regime="L", branch="M",
  defn="Guns that outrange anything that walks.")
m("spidertron", id="embodied_agents", name="Embodied agents", tag="ISO", regime="H", branch="M",
  defn="An agent with legs, remotely directed.", cite="Brooks, 1991", year=1991)
for n in ["1", "2", "3", "4", "5", "6", "7"]:
    m(f"physical-projectile-damage-{n}", id=f"projectile_damage_{n}",
      name=f"Projectile damage {n}" + ("+" if n == "7" else ""), tag="ISO", regime="L", branch="M",
      defn="Harder-hitting rounds.", series="projectile_damage")
for n in ["1", "2", "3", "4", "5", "6"]:
    m(f"weapon-shooting-speed-{n}", id=f"rate_of_fire_{n}", name=f"Rate of fire {n}", tag="ISO", regime="L",
      branch="M", defn="Faster cycling.", series="rate_of_fire")
for n in ["1", "2", "3", "4", "5", "6", "7"]:
    m(f"stronger-explosives-{n}", id=f"explosive_yield_{n}", name=f"Explosive yield {n}" + ("+" if n == "7" else ""),
      tag="ISO", regime="L", branch="M", defn="Stronger charges.", series="explosive_yield")
for n in ["1", "2", "3", "4", "5", "6", "7"]:
    m(f"refined-flammables-{n}", id=f"refined_flammables_{n}", drop=True,
      reason="Flamethrower dropped; replaced by Arc damage")
for n in ["1", "2", "3", "4", "5", "6", "7"]:
    m(f"laser-weapons-damage-{n}", id=f"laser_damage_{n}",
      name=f"Laser damage {n}" + ("+" if n == "7" else ""), tag="ISO", regime="L", branch="M",
      defn="Lasers hit harder.", series="laser_damage")
for n in ["1", "2", "3", "4", "5", "6", "7"]:
    m(f"laser-shooting-speed-{n}", id=f"laser_rate_{n}", name=f"Laser rate of fire {n}", tag="ISO",
      regime="L", branch="M", defn="Lasers fire faster.", series="laser_rate")
for n in ["1", "2", "3", "4", "5"]:
    m(f"follower-robot-count-{n}", id=f"interceptor_count_{n}", name=f"Interceptor count {n}" + ("+" if n == "5" else ""),
      tag="ISO", regime="L", branch="M", defn="More interceptors in the air.", series="interceptor_count")
m("artillery-shell-range-1", id="artillery_range", name="Artillery range", tag="ISO", regime="L", branch="M",
  defn="Shells reach farther.", series="artillery")
m("artillery-shell-speed-1", id="artillery_reload", name="Artillery reload", tag="ISO", regime="L", branch="M",
  defn="Shells fire sooner.", series="artillery")

# ---------------------------------------------------------------- BEND additions (no Factorio mirror)
# cost: (count, letters, time) | ("formula", str, letters, time) | ("trigger", str) | ("start",)
BEND = [
    dict(id="prior_art", name="Prior art", tier="S", tag="BEND", regime="L", cost=("start",), pre=[],
         unlocks=["Stone furnace", "Burner mining drill", "Iron gear wheel", "Transport belt", "Burner inserter",
                  "Wooden chest", "Iron chest", "Smelting (iron, copper, stone brick)", "Archive processing (per D)"],
         defn="Known before the game begins.",
         note="Cosmetic root showing the start recipes (Factorio enables these with no node). "
              "No pistol, no magazine at start."),
    dict(id="artificial_intelligence", name="Artificial intelligence", tier="R", tag="BEND", regime="H",
         cost=(10, "R", 60), pre=["basic_research"],
         unlocks=["No effect; required by Perceptron, Expert systems, Statistical learning"],
         defn="Proposed as a two-month, ten-man study.", cite="McCarthy, Minsky, Rochester & Shannon, 1955",
         year=1955, note="H's set-piece: ten memos, as the proposal asked for ten men."),
    dict(id="expert_systems", name="Expert systems", tier="G", tag="BEND", regime="H", cost=(100, "RG", 30),
         pre=["artificial_intelligence", "linear_programming"],
         unlocks=["Hand-crafting speed +100%. Does not apply to machines."],
         defn="Rules written by hand, consulted by machine.", cite="Feigenbaum, 1977", year=1977),
    dict(id="packet_switching", name="Packet switching", tier="G", tag="BEND", regime="H", cost=(100, "RG", 30),
         pre=["cybernetics", "radar"],
         unlocks=["Exchanges can be tapped (B, L3)", "Radars relay circuit signals to one another",
                  "Staffing radius +50% (if B's staffing is adopted)"],
         defn="Messages cut into packets, each routed independently.", cite="Baran, 1964; Davies, 1966", year=1966,
         note="The 'networking' idea: gates Crawling, so the crawl (oil) needs it."),
    dict(id="evaporative_cooling", name="Evaporative cooling", tier="G", tag="BEND", regime="L", cost=(75, "RG", 30),
         pre=["steam_power", "linear_programming"], unlocks=["Cooling tower (F: removes up to 10 MW from its chunk)"],
         defn="Evaporating water carries heat away."),
    dict(id="liquid_cooling", name="Liquid cooling", tier="B", tag="BEND", regime="L", cost=(150, "RGB", 30),
         pre=["evaporative_cooling", "disk_storage", "statistical_learning"],
         unlocks=["Coolant fluid boxes on compute entities (tier 2+)", "Dry cooler", "Water exchanger"],
         defn="Coolant carries heat from the chip to the outside."),
    dict(id="dennard_scaling_1", name="Dennard scaling 1", tier="B", tag="BEND", regime="H", cost=(100, "RGB", 30),
         pre=["cmos", "statistical_learning"], unlocks=["Compute entities −8% energy"],
         defn="Smaller transistors, same power per area.", cite="Dennard et al., 1974", year=1974, series="dennard"),
    dict(id="dennard_scaling_2", name="Dennard scaling 2", tier="B", tag="BEND", regime="H", cost=(200, "RGB", 30),
         pre=["dennard_scaling_1"], unlocks=["Compute entities −8% energy"],
         defn="Smaller transistors, same power per area.", cite="Dennard et al., 1974", year=1974, series="dennard"),
    dict(id="dennard_scaling_3", name="Dennard scaling 3", tier="P", tag="BEND", regime="H", cost=(250, "RGBP", 30),
         pre=["dennard_scaling_2", "deep_learning"], unlocks=["Compute entities −8% energy"],
         defn="Smaller transistors, same power per area.", cite="Dennard et al., 1974", year=1974, series="dennard"),
    dict(id="dennard_scaling_4", name="Dennard scaling 4", tier="P", tag="BEND", regime="H", cost=(300, "RGBP", 30),
         pre=["dennard_scaling_3"], unlocks=["Compute entities −8% energy"],
         defn="Smaller transistors, same power per area.", cite="Dennard et al., 1974", year=1974, series="dennard"),
    dict(id="dennard_scaling_5", name="Dennard scaling 5", tier="P", tag="BEND", regime="H", cost=(400, "RGBP", 30),
         pre=["dennard_scaling_4"], unlocks=["Compute entities −8% energy. No further levels exist."],
         defn="Smaller transistors, same power per area.", cite="Dennard et al., 1974", year=1974, series="dennard"),
    dict(id="hardware_class_a3", name="Hardware class A3", tier="P", tag="BEND", regime="H",
         cost=(200, "RGBP", 30), pre=["liquid_cooling", "deep_learning"],
         unlocks=["Thermal throttling threshold +5 K"], defn="Equipment rated for a hotter inlet.",
         cite="ASHRAE, 2011", year=2011),
    dict(id="hardware_class_a4", name="Hardware class A4", tier="Y", tag="BEND", regime="H",
         cost=(300, "RGBPY", 30), pre=["hardware_class_a3", "expected_utility"],
         unlocks=["Thermal throttling threshold +5 K (total +10 K)"], defn="Equipment rated for a hotter inlet still.",
         cite="ASHRAE, 2011", year=2011),
    dict(id="immersion_cooling", name="Immersion cooling", tier="Y", tag="BEND", regime="L",
         cost=(500, "RGBPY", 30), pre=["liquid_cooling", "expected_utility", "deep_learning"],
         unlocks=["Liquid-cooled share of compute heat 70% → 90%"], defn="The whole board sits in coolant."),
    dict(id="synthetic_detection", name="Synthetic detection", tier="Y", tag="BEND", regime="H",
         cost=(300, "RGBY", 30), pre=["expected_utility", "spam_filtering"],
         unlocks=["The world's generated text counts half in σ at Crawlers"],
         defn="Classifiers that flag machine-written text.", cite="Solaiman et al., 2019", year=2019),
    dict(id="watermarking", name="Watermarking", tier="Y", tag="BEND", regime="H", cost=(300, "RGBY", 30),
         pre=["synthetic_detection", "instruction_tuning"], unlocks=["Your own deployed generations count half in σ"],
         defn="Generated text carries a statistical signature.", cite="Kirchenbauer et al., 2023", year=2023),
    dict(id="preference_tuning", name="Preference tuning", tier="Y", tag="BEND", regime="H",
         cost=(200, "RGBPY", 30), pre=["scaling_laws"], unlocks=["Post-training payload"],
         defn="Tune against a reward fitted to human comparisons.",
         cite="Christiano et al., 2017; Ouyang et al., 2022", year=2022,
         note="Factorio unlocks the satellite with the silo; here post-training is its own, cheap idea (keeps pacing)."),
    dict(id="interpretability", name="Interpretability", tier="Y", tag="BEND", regime="H", cost=(1000, "RGBPY", 60),
         pre=["expected_utility", "attention"],
         unlocks=["Quality of model items is shown (checkpoint-type modules, Researchers, payloads, agents); "
                  "before this it reads '?' and filters cannot sort by it",
                  "Hollow work no longer consumes papers (F 6.2)"],
         defn="Read what a trained network computes.", cite="Olah et al., 2018", year=2018,
         note="D5 / brainstorm 03 reveal. Optional: drop the hidden-quality half if it tests badly."),
    # ---- white, before the loop closes (paid in System cards from frontier runs; staff-bound per B/G)
    dict(id="chain_of_thought", name="Chain of thought", tier="W", tag="BEND", regime="H",
         cost=(2000, "RGBPYW", 60), pre=["in_context_learning"],
         unlocks=["System cards per frontier run +50% (1,000 → 1,500)"],
         defn="Intermediate steps written out before the answer.", cite="Wei et al., 2022", year=2022),
    dict(id="self_play", name="Self-play", tier="W", tag="BEND", regime="H", cost=(2000, "RGBPYW", 60),
         pre=["in_context_learning"], unlocks=["Run shard productivity +20%"],
         defn="The model generates its own training opponents.", cite="Samuel, 1959; Silver et al., 2017", year=2017),
    dict(id="test_time_compute", name="Test-time compute", tier="W", tag="BEND", regime="H",
         cost=(3000, "RGBPYW", 60), pre=["chain_of_thought"],
         unlocks=["Research halls: a mode for +50% output at +100% energy"],
         defn="Spend compute per answer instead of per model.", cite="Snell et al., 2024", year=2024),
    dict(id="automated_research", name="Automated research", tier="W", tag="BEND", regime="H",
         cost=(1000, "RGBPYW", 60), pre=["test_time_compute", "self_play"],
         unlocks=["Researcher (4 Accelerators + 1 Checkpoint → 1 Researcher + 1 Checkpoint returned)",
                  "Research hall (writes System cards)", "Model generation"],
         defn="Machines do the research that improves the machines.", cite="Good, 1965", year=1965,
         note="Closes the loop. The takeoff clock starts when the first Research hall is powered (G)."),
    dict(id="formal_verification_placeholder", skip=True),
    # ---- white, after the loop closes (System cards only)
    dict(id="model_generation", name="Model generation 1–20", tier="W", tag="BEND", regime="F",
         cost=("formula", "1.5^(L−1)×1000", "W", 30, "1–20"), pre=["automated_research"],
         unlocks=["Researcher output ×m per level (m = 2.0, r = 1.71 at G's g = 1.5)",
                  "Level 20 ends the run (capstone; H's run report)"],
         defn="The previous generation trained this one.", note="The RSI lever (G). Beyond the literature."),
    dict(id="model_generation_inf", name="Model generation 21+", tier="W", tag="BEND", regime="F",
         cost=("formula", "2^(L−20)×2.2M", "W", 30, "∞"), pre=["model_generation"],
         unlocks=["Researcher output ×1.1 per level (r ≈ 0.14; G)"], defn="Diminishing returns again.",
         infinite=True),
    dict(id="wafer_scale_integration", name="Wafer-scale integration", tier="W", tag="BEND", regime="F",
         cost=(2000, "W", 30), pre=["automated_research"],
         unlocks=["Accelerator 2 (Researcher speed 3 at 8 MW per hall; G)"], defn="One chip the size of the wafer."),
    dict(id="fusion_power", name="Fusion power", tier="W", tag="BEND", regime="F", cost=(4000, "W", 30),
         pre=["automated_research", "nuclear_power"],
         unlocks=["Fusion reactor", "Fusion generator", "Fusion power cell (Space Age numbers)"],
         defn="Light nuclei fused for net electric power."),
    dict(id="photonic_interconnect", name="Photonic interconnect", tier="W", tag="BEND", regime="F",
         cost=(8000, "W", 30), pre=["wafer_scale_integration"],
         unlocks=["Accelerator 3 (speed 8 at 12 MW per hall; G)"], defn="Light carries data between chips."),
    dict(id="reversible_logic", name="Reversible logic", tier="W", tag="BEND", regime="F", cost=(32000, "W", 30),
         pre=["photonic_interconnect"], unlocks=["Accelerator 4 (speed 20 at 16 MW per hall; G)"],
         defn="Computation that erases nothing, so dissipates less."),
    dict(id="research_scheduling", name="Research scheduling", tier="W", tag="BEND", regime="F",
         cost=(5000, "W", 30), pre=["automated_research"],
         unlocks=["Researchers fill the research queue ('Queued by: Researcher')"],
         defn="Researchers choose the next technology.", note="H 5.1 #41. Presentation BEND."),
    dict(id="weight_transplant", name="Weight transplant", tier="W", tag="BEND", regime="F", cost=(5000, "W", 30),
         pre=["wafer_scale_integration"],
         unlocks=["Recipe: a Researcher moves to newer Accelerators; the old ones are returned"],
         defn="Weights move to new hardware without retraining.", note="H 5.1 #40."),
    # ---- conventional infinites (all packs), as Factorio's post-launch research
    dict(id="research_productivity", name="Research productivity", tier="W", tag="BEND", regime="H",
         cost=("formula", "2^(L−1)×1000", "RGBPYW", 60, "∞"), pre=["in_context_learning"],
         unlocks=["Research productivity +10%"], defn="Each idea costs more research than the last.",
         cite="Bloom, Jones, Van Reenen & Webb, 2020", year=2020, infinite=True,
         note="Space Age research productivity (+10%/level at 1.2^L×1000, 120 s); cost doubles here (H)."),
    dict(id="self_driving_labs", name="Self-driving labs", tier="W", tag="BEND", regime="H",
         cost=("formula", "2^(L−1)×1000", "RGBPYW", 60, "∞"), pre=["in_context_learning", "code_generation"],
         unlocks=["Lab speed +20%"], defn="Experiments chosen, run and read by machine.", cite="King et al., 2009",
         year=2009, infinite=True, note="Research speed 7+."),
    dict(id="process_node", name="Process node", tier="W", tag="BEND", regime="H",
         cost=("formula", "2^(L−1)×1000", "RGBPYW", 60, "∞"), pre=["in_context_learning"],
         unlocks=["Accelerator productivity +10%"], defn="Transistors per die double; so does the fab's cost.",
         cite="Moore, 1965", year=1965, infinite=True,
         note="Space Age processing-unit productivity; Rock's law as the cost curve (H)."),
    dict(id="algorithmic_progress", name="Algorithmic progress", tier="W", tag="BEND", regime="H",
         cost=("formula", "1.5^L×2000", "RGBPYW", 60, "∞"), pre=["in_context_learning"],
         unlocks=["Run shard productivity +10%"], defn="The same loss for less compute.", cite="Ho et al., 2024",
         year=2024, infinite=True, note="Space Age rocket part productivity, same formula."),
    dict(id="thermal_management", name="Thermal management", tier="W", tag="BEND", regime="L",
         cost=("formula", "1.5^L×1000", "RGBPYW", 60, "∞"), pre=["immersion_cooling", "in_context_learning"],
         unlocks=["Cooling tower capacity +10%"], defn="More heat moved per tower.", infinite=True,
         note="F's infinite cooling lever."),
    # ---- Branch M additions (F)
    dict(id="arc_turret", name="Arc turret", tier="P", tag="BEND", regime="L", cost=(300, "RGMBP", 30),
         pre=["laser_turret", "deep_learning"], unlocks=["Arc turret (Space Age Tesla turret stats)"],
         defn="Chain lightning between targets.", branch="M",
         note="F: Space Age's Tesla turret moved to the Preprint tier. Ferals resist 0% electric."),
    dict(id="arc_damage_1", name="Arc damage 1", tier="P", tag="BEND", regime="L", cost=(250, "RGMBP", 30),
         pre=["arc_turret"], unlocks=["Damage: arc +30%, discharge +30%"], defn="Stronger arcs.", branch="M",
         series="arc_damage"),
    dict(id="arc_damage_2", name="Arc damage 2", tier="Y", tag="BEND", regime="L", cost=(500, "RGMBPY", 60),
         pre=["arc_damage_1", "expected_utility"], unlocks=["Damage: arc +40%, discharge +40%"],
         defn="Stronger arcs.", branch="M", series="arc_damage"),
    dict(id="arc_damage_3", name="Arc damage 3", tier="W", tag="BEND", regime="L", cost=(1000, "RGMBPYW", 60),
         pre=["arc_damage_2", "in_context_learning"], unlocks=["Damage: arc +70%, discharge +70%"],
         defn="Stronger arcs.", branch="M", series="arc_damage"),
    dict(id="arc_damage_4", name="Arc damage 4+", tier="W", tag="BEND", regime="L",
         cost=("formula", "2^(L−3)×1000", "RGMBPYW", 60, "∞"), pre=["arc_damage_3"],
         unlocks=["Damage: arc +70%, discharge +70%"], defn="Stronger arcs.", branch="M", series="arc_damage",
         infinite=True),
    dict(id="off_switch", name="Off-switch", tier="P", tag="BEND", regime="H", cost=(150, "RGMBP", 30),
         pre=["game_theory", "automated_planning", "deep_learning"],
         unlocks=["Override transmitter", "Shutdown key (1 logic board → 10)"],
         defn="An agent that permits its own shutdown.", cite="Hadfield-Menell et al., 2017", year=2017, branch="M",
         note="Optional (F). Shuts down tier-1 ferals, half of tier 2, none above."),
]
BEND = [b for b in BEND if not b.get("skip")]

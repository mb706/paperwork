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
         cost=(500, "RGBPY", 30), pre=["liquid_cooling", "expected_utility"],
         unlocks=["Liquid-cooled share of compute heat 70% → 90%"], defn="The whole board sits in coolant."),
    dict(id="synthetic_detection", name="Synthetic detection", tier="Y", tag="BEND", regime="H",
         cost=(300, "RGBPY", 30), pre=["expected_utility", "spam_filtering"],
         unlocks=["The world's generated text counts half in σ at Crawlers"],
         defn="Classifiers that flag machine-written text.", cite="Solaiman et al., 2019", year=2019),
    dict(id="watermarking", name="Watermarking", tier="Y", tag="BEND", regime="H", cost=(300, "RGBPY", 30),
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

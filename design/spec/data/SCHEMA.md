# Spec data schema (v2)

The game's prototypes live as YAML in this directory: one file per kind, each a top-level list (except `meta.yaml` and `text.yaml`, which are mappings). They are the single source of truth for the design spec, and the game build converts them to JSON (10 §2.4). `tools/validate_spec.py` checks them; run it after every edit:

    gamedev-python tools/validate_spec.py design/spec/data

The tables in `spec/02-economy.md` and `spec/05-research.md` are generated from these files:

    gamedev-python tools/render_spec.py

v2 (round 4, R4-data) adds the fields marked **v2**. Every v0 and v1 file still validates (`tools/testdata/spec-mini` is the v0 regression case): each v2 check is switched on by the data that needs it (`meta.checks`, `meta.citation_rules`, the presence of `tiles.yaml`, `world.yaml`, `text.yaml`).

| File | Kind | Owner |
|---|---|---|
| `items.yaml`, `recipes.yaml`, `entities.yaml`, `technologies.yaml`, `resources.yaml`, `enemies.yaml` | prototype lists | R4-data |
| `tiles.yaml` **v2**, `world.yaml` **v2** | prototype lists | R4-data |
| `meta.yaml` | mapping: global settings and rules | R4-data |
| `text.yaml` **v2** | mapping: engine-readable text | R4-ui (see the section below) |

## General rules

- `id`: kebab-case, unique *within* each kind. Sharing an id across kinds is idiomatic, as in Factorio: the item `assembling-machine-1`, the recipe that makes it and the entity it places all use one name, and a technology may share its name with the recipe it unlocks.
- `name`: the display name (08 §5.1 #1: at most 24 characters for things, 28 for technologies).
- `mirrors`: the Factorio 2.0 (or Space Age) counterpart's internal name, or `new (...)` with the source. **v2 parse rule** (impl J23): the engine overlay's defaults id is the leading `[a-z0-9-]+` token; `new` means no defaults, and the overlay must then give the entity in full.
- `tier`: the science tier in which the thing first matters, as a science-pack item id (`meta.tiers`).
- Units: amounts are numbers; times are seconds at crafting speed 1; power is kW; energy is MJ (kJ where the field says `_kj`); fluids are in units; temperatures are °C, temperature differences K.
- Optional fields are omitted rather than written as `null`, except where null has a meaning (`walking_speed`, `kappa_per_s`, `unlocked_by`, `armor.grid`). The validator warns about a null anywhere else: it is usually a YAML slip, such as an unquoted comma inside a flow mapping.
- Numbers that text repeats are not written into the text (08 P17). A string may name a data path in braces, the **placeholder**:
  - `{extra.clean_interval_s}` — a path relative to the object that holds the string;
  - `{meta.runaways.clean.power_off_s}` — a `meta.yaml` path;
  - `{entity.<id>.<path>}`, also `item.`, `recipe.`, `tile.`, `technology.` (alias `tech.`), `world.` — a field of another object; `extra.` may be skipped (`{entity.boiler.water_per_s}`), a list of `{id, amount}` may be indexed by id (`recipe.x.products.prose`) or position, and `cost_ratio` gives a multi-level technology's cost ratio between its first two levels;
  - `{path:%}` prints a fraction as a percent; in `text.yaml`, `{a / b}` prints the ratio of two paths;
  - runtime variables the engine fills in (`{checkpoint}`, `{tier}`, …) are allowed only in `enemies.yaml` and `text.yaml`.
- **Expressions (v2, impl J18).** `count_formula`, `field_year`, `amounts_by_j` and `meta.world.model_collapse.speed_factor` share one grammar: numbers, `+ − * / ^`, parentheses, and the variables `L` (technology level), `j` (junk share), `sigma` and `c` (synthetic share and crawl share, model collapse only). `^` is exponentiation and needs an integer right operand after substitution. The data stage compiles each expression once; the validator evaluates them at sample points.

## Text budget and register (v2; DECISIONS §34, 08 §5.1)

- **Descriptions only where they add something.** About one item or building in five carries a `desc`; a building item never has its own, it shows its entity's. A technology's `desc` is its **definition clause** only (one clause, ≤ 10 words; at most one technology in three has any text beyond its effects and citation). Unlocks, effect lines and the short citation are generated from `unlocks`, `meta.effects.<type>.line` and `citation`, never written into `desc`.
- `note` (technologies, **v2**): one sentence the tooltip prints after the effect lines (*Expert systems*: "Does not apply to machines.").
- `handbook_note` (**v2**, any kind, and `meta.start.salvage`): at most two sentences for the Handbook (Factoriopedia) entry, stating a rule or definition (08 §9.3). It replaces recipes' v1 `note`.
- The validator applies 08's text rules to every `name`, `desc`, `note` and `handbook_note`: the never-list (08 §10.2, with `meta.checks.never_list_exempt_names`), US spelling, no second person, no `!` or ellipsis, no bare σ, placeholders that resolve, item descriptions ≤ 60 characters (`meta.checks.long_item_desc_ok` lists the 34-line keep-list's exceptions), the ten-word definition, and the budgets above (warnings).

## meta.yaml (a mapping)

```yaml
tiers: [memo, report, article, proceedings, preprint, model-card, system-card]   # science-pack item ids, in order
crafting_categories: [crafting, smelting, ...]
fuel_categories: [chemical, nuclear, fusion]
town_classes: [starting-college, college-town, village, town, city, metropolis]  # v2 (N16): the one enum
start:
  inventory: {burner-mining-drill: 1, stone-furnace: 1, iron-plate: 8}
  recipes: []                 # enabled without research; empty because Prior art (trigger start) holds them
  salvage:                    # v2 (DECISIONS §33): the one definition of the spawn wreck
    name: Laboratory salvage
    desc: ...                 # and handbook_note
    within_tiles: 16
    mining_time: 1            # per wreck piece and for the crate
    wreck_pieces: 6
    per_piece: {iron-plate: 5}
    crate: {radar: 1, logic-board: 10, copper-cable: 20}
  guarantees: {inside_starting_coverage: [iron-ore-patch, ...], starting_archive_records: 80000, college: {...}, starting_patches: {...}, buildable: {...}, lake: {...}, forest: {...}, no_cliffs_within_tiles: 32}   # v2 (DECISIONS §32); 01 §9 typed by D1
checks: {require_sprite: true, text_rules: true, never_list_exempt_names: [...], long_item_desc_ok: [...]}
citation_rules: {build_year: 2026, min_age_years: 2, era_end: {Automatic computation: 1955, ...}}   # v2 (08 §9.3)
```

The other blocks are read by the engine. v2 turns their formulas into numbers (impl J1); each block keeps a `formula_ref` to the chapter that states the rule in prose, and text under a key named `rule` or `note` is commentary.

| Block | Contents | Prose owner |
|---|---|---|
| `quality` | `tiers` (id, name, level, unlocked_by), `modules`, `next_tier_chance`, `never_drops`, `verifier_rule` (1 + the **lowest** Comparator tier index, by the Comparator's quality), `catalysts`, `recipe_quality`, `entity_stats` (ISO 2.0 table in the engine overlay), `stat_bonus_per_level`, `recycle_return` | 02 §6; A §5.1; impl L5 |
| `heat` | `chunk_heat_capacity_mj_per_k`, `tree_damage_c`, `ambient` (base, gradient, noise, clamp, spawn range), `sunlight`, **D1** `daylight` (`ticks_per_day`, `dusk`, `evening`, `morning`, `dawn`, `min_brightness`: Factorio 2.0's day, 25,200 ticks), `diffusion`, `loss` (κ from `tiles.yaml`, trees, leaf timer), `emission` (the vocabulary below), `throttle` (`span_k`, `floor`, scope incl. Switches), `classes` ({class: T* °C}: tube, computer, network, cluster, accelerator), `liquid_cooled_bonus_k`, `coolant` (temperatures, `filter_rule`, shares), `interruptible_power` | 03 §1 |
| `staffing` | `radius`, **D1** `every_ticks` (the recompute cadence), `supply` (`per_field_year`, `max_multiplier`), `t0` per town class, `university_share`, `demand` (`base`, `min`, **D1** `window_ticks` (w's window), the module-and-Switch rule), `coverage`, `network` (universities, Seminars, Terminals), `terminal` | 01 §8 |
| `runaways` | presets, `leak` (`per_hour`, `verification_step`, `every_ticks`, `working_share`, threshold and removal rules), `v_by_quality`, `verification_techs`, `deploying_buildings`, `model_tier` (`endpoint` {technology: tier}, the highest researched; `research-hall` and `seminar` 4), `spread` (per infection, `interval_s`, links), `compromised` (signal, locks, frozen state), escape, `clean` (power-off, Monitor, rollback input), nest, raids, evolution | 03 §3 |
| `hollow_work` | `per_tier`, `cap`, `frontier_tier`, formula, `display` (Yield) | 03 §4 |
| `world` | v1's `world_text`, renamed. `w0`, `v0`, `v0_race`, `v0_race_hard`, `beta`, `publication_lag_s`, `y_pub_start`, `y_pub_rule`, `literature_rule`, `world_sigma_from_w`, `world_sigma_per_field_year`, `gamma` (`from_w`, `to_w`, `w_per_generation`), `race_spoil_w` (W added per spoiled Significant result in Race), `refinery_mix` (a pointer to `amounts_by_j`), `j.breakpoints`, `sigma` (`squash_max`, `per_ratings`, `watermarking_factor`), `model_collapse` (`applies_to`, `crawl_recipes`, `synthetic_recipes`, `window_ticks`, `speed_factor`), `exchange` (yield constants; `floor` {`rise_from_w`, `doubling_w`}; `f` and closing σ per town class; `starting_tap_initial_yield`), `archives` (`tiles` {`records_per_tile`, `min`, `max`}, per-class `library_totals` as [min, max, chance], `records_stores` {`total`, `beyond_tiles`, **D1** `cell_tiles`, `probability`, `min_town_distance_tiles`}, `distance_factor` {`scale_tiles`}); **D1** `every_ticks` (the integration step), and worldgen v1's numbers: `biomes` (01 §2: `order`, `upper_c`, `blend_k`, `trees`, `boreal_moist`, `boreal_snow_below_c`, `tundra_rock_share`, `lake_moisture_base`), `patches` (01 §4: the shared constants and, per solid resource, `start` {`amount`, `per_tile`, `tiles`}, `cell_tiles`, `probability`, `radius_tiles`, `per_tile`, `not_within_tiles`), `towns` (01 §5: the grid, distance bands, site rules, street layout, per class `footprint_tiles`, `probability` per band and `exchange` {`chance`, `taps`, `initial_yield`}, tap placement, era skins). These three cite their section in `note`: the formula_refs registry does not list 01 §2, §4 or §5 yet | 01 §2, §4–§7, §12; 03 §2 |
| `world_settings` | map settings: heat, staffing, runaways, `returns_to_research` (options, `labels`, default, `g`: the default r is ln 2 / ln g, written as its exact double and shown as 1.71, so that m = 2; R5-gate D12b), race mode, Scooped (`forced_in_race`), hollow work, climate compass. The Advanced tab's numeric knobs (07 §17) are not data yet | 00 §6; 04 §4 |
| `endgame` | generation cost, closure (it researches the hidden `loop-closed`), victory, takeoff clock, overhang, and **`takeoff_order`** (R5-gate D10): the list *Research scheduling* follows (04 §5.1). An entry is a technology id, or `{id: level}` for one level of a finite multi-level technology; an infinite technology's id stands for its next level and may only be last. The validator checks that it holds every level of every technology paid in System cards alone, once each, after every entry it requires | 04 |
| `damage_categories` | (R5-gate D13; Wild) the one list of damage categories. `ammo-damage` and `gun-speed` effects name them; every damage dealer declares one (below). The validator checks both directions | 03 §3.6 |
| `effects` | every technology effect type: `{line, rule}`. `line` is the generated tooltip line, with fields `{pct}` (signed percent of `value`), `{n}` (signed count), `{mult}` (×`multiplier`, or ×m from the world setting for `multiplier_from`), `{fraction}`, `{amount}` (`pct` or `mult`), `{category}`, `{turret}`, `{recipes}`, `{entities}`, `{quality}`, `{output}`, `{energy}`; `rule` is the engine semantics | 05 |

**Heat emission vocabulary** (`entities.<id>.heat.emission`; DECISIONS §24): absent — the entity emits what it draws (electric: drawn energy including drain; burner: fuel burned); `twice-output` — a thermal generator emits 2 × its current electrical output in its own chunk; `none` — the conversion emits nothing (boilers, heat exchangers, reactors), but a separate electric draw is still emitted. `waste_heat: true` adds the heat a reactor generates and can neither pass on nor store.

## items.yaml

```yaml
- id: iron-plate
  name: Iron plate
  type: item            # item | fluid
  stack: 100            # items only
  tier: memo
  mirrors: iron-plate
  sprite: "ISO: two stacked blue-grey plates, bevelled"   # the 32 px icon note; required when meta.checks.require_sprite
  # fuel_value: 12      # optional, MJ, on fuels (coal shown); with fuel_category (3× Factorio's, DECISIONS §18)
  # fuel_category: chemical
  places: stone-furnace # optional: the entity this item places (it then has no desc of its own)
  places_tile: concrete # v2, optional: the tile this item places (tiles.yaml; the tile names it in placed_by)
  tags: [intermediate]
  desc: "..."           # optional (budget above)
```

- Fluids: `type: fluid`, no stack; optional `default_temperature` (omitted: 15 °C), `max_temperature` (omitted: the default temperature) and **v2** `heat_capacity_kj_per_k` (omitted: 1). Factorio 2.0's values (base/prototypes/fluid.lua, factorio-data 2.0.77): water 15 °C, at most 100 °C, 2 kJ/K; steam 15 °C, at most 5,000 °C, 0.2 kJ/K; the oil family, sulfuric acid and lubricant 25 °C. Water's ten times steam's heat capacity is 2.0's 1 water → 10 steam, so a boiler's water and its steam carry the same energy (the validators check it, D1-r1).
- Recognized tags (an item with a starred tag is never a "dead end"): raw, intermediate, science-pack, building, fluid, fuel, module\*, ammo\*, final\*, equipment\*, armor\*, installed\* (loaded into a building, not consumed: accelerator tiers in a Research hall), staff\* (goes into a Seminar's staff slot).
- Type blocks, all optional:
  - `module: {speed, productivity, consumption, quality}`: fractions (+0.2 = +20%), Factorio 2.0's values including the speed modules' quality penalty. Factorio's pollution multiplier is gone: heat follows energy.
  - `ammo: {category, damage_category, rounds, damage, damage_type, use, stats}` (`damage` a number or a map by damage type; `use` documents a non-weapon consumer, such as the Monitor's Evaluation set; `damage_category`, from `meta.damage_categories`, where the slot category is not the damage category: the Interceptors' slot is `interceptor`, their damage `bullet`, `laser` or `beam`); `armor: {grid: [w, h] | null}`; `equipment: {size: [w, h], kw | mj | shield | stats, ammo_category}` (`ammo_category` on equipment that deals damage, from `meta.damage_categories`).
  - `staff: {fully_staffs, kw, heat_class, liquid_cooling, interruptible, deploys, model_tier, draws, energy_scaled_by}`: an item for the Seminar's staff slot (the Researcher). `energy_scaled_by` lists the effect types that scale its draw (only `compute-energy-floor`: not modules, not Dennard).
  - `spoil: {ticks, into, setting}`: Space Age spoilage, only under the named setting.

## resources.yaml (patches that drills, pumps or offshore pumps extract)

```yaml
- id: iron-ore-patch
  name: Iron ore
  kind: solid           # solid | fluid | offshore
  yields: iron-ore
  mining_time: 1        # solids: seconds per unit at mining speed 1
  infinite: false       # fluid wells: true; the yield floor is the world's (meta.world.exchange), not min_yield
  # requires_fluid: sulfuric-acid   # optional (uranium): drills need it; the character mines by hand without it (ISO, impl U56)
  autoplace: "where it spawns, for people; the numbers are meta.world.patches (ores, 01 §4), meta.world.towns and meta.world.archives (exchanges and archives, 01 §5–§7)"
  mirrors: iron-ore
```
Fluid resources are extracted by `pumpjack` entities. Trees and rocks are world objects (`world.yaml`), not resources.

## recipes.yaml

```yaml
- id: iron-gear-wheel
  name: Iron gear wheel          # optional; defaults to the first product's name
  category: crafting
  time: 0.5
  ingredients: [{id: iron-plate, amount: 2}]
  products: [{id: iron-gear-wheel, amount: 1}]
  handcraft: true                # default true for category crafting, false otherwise
  allow_productivity: true       # v2: default false (DECISIONS §30)
  mirrors: iron-gear-wheel
```
- Product fields: `probability` (0..1, an independent roll per craft, as uranium processing); `catalyst` (the amount returned; productivity does not apply to it; the UI marks it "(returned)"); **v2** `affected_by_quality: false`, required on every product with a catalyst (impl L5): the returned amount never rolls quality and comes back at its ingredient's quality; only the rest rolls. An ingredient that also appears as a product is consumed net of what comes back.
- **v2** `allow_productivity`: true on 47 recipes: the mirrors of Factorio 2.0's 42 eligible recipes (smelting and transcription, intermediates, chemistry, the data refinery and its crackings, the data products, the papers, run shards and the uranium recipes; several of ours mirror the same Factorio recipe), plus the four recipes of the experiment loop (02 §6). Productivity modules and `recipe-productivity` effects apply only to these.
- Other fields: `pseudo: true` (a mechanic written as a recipe so the validator can check it: the three launches); `victory: true` (`launch-final`); `container: fill | empty` (barrels and drives; unlocked with the container, so the closure check skips them); `shared_unlock: true`; `amounts_by_j: {product: expression}` (the refinery's drift with the junk share; the expression grammar above); **v2** `handbook_note` (was `note`).

## entities.yaml (placeable buildings and vehicles)

```yaml
- id: assembling-machine-1
  name: Assembling machine 1
  type: assembler                   # see the type list below
  size: [3, 3]
  item: assembling-machine-1
  energy: {source: electric, kw: 75, drain_kw: 2.5}   # source: electric | burner | heat | none
  crafting_speed: 0.5               # assemblers, furnaces, labs (research speed), rocket silos
  categories: [crafting]
  mining_speed: 0.5                 # drills
  module_slots: 0
  consumes: [steam]                 # fluids/items the entity itself uses up
  produces: [steam]                 # what it outputs without a recipe
  extra: {}                         # type-specific fields
  mirrors: assembling-machine-1
  desc: "..."                       # optional (budget above)
  handbook_note: "..."              # v2, optional
```
Types: `assembler`, `furnace`, `mining-drill`, `offshore-pump`, `pumpjack`, `lab`, `belt`, `underground-belt`, `splitter`, `inserter`, `chest`, `pipe`, `pipe-to-ground`, `pump`, `storage-tank`, `boiler`, `generator`, `solar-panel`, `accumulator`, `reactor`, `heat-pipe`, `heat-exchanger`, `electric-pole`, `roboport`, `logistic-chest`, `rail`, `train-stop`, `rail-signal`, `locomotive`, `cargo-wagon`, `fluid-wagon`, `beacon`, `radar`, `wall`, `gate`, `turret`, `rocket-silo`, `combinator`, `lamp`, `cooler`, `other`.

Fields beyond the example:
- `energy`: burner sources add `fuel_categories`; **v2** `drain_kw` (ISO: crafting machines 1/30 of their draw, inserters 0.4–1 kW, pumps 1 kW; omitted = 0); **v2** `per_movement_kj`, `per_rotation_kj` (inserters, ISO; the burner inserter's are ×3 by DECISIONS §18 and it has no fixed `kw`); `priority: interruptible` (Research halls; G); `priority: lamp` (exactly the lamps: Factorio's `usage_priority = "lamp"`, entities.lua 2.0.77). A lamp is normal demand (10 §5.7's first class) while it is lit and demands nothing while dark; it lights at its own darkness threshold, staggered between the overlay's `darkness_off` and `darkness_on` (Factorio's lamp group, FFF-229). An electric inserter's `kw` is its maximum movement power, Factorio 2.0's rotation plus extension power: 60 × (rotation speed × `per_rotation_kj` + extension speed × `per_movement_kj`), with the speeds of the engine overlay (14.7 kW for the inserter; the data stage checks it, D1).
- **Typed `extra` fields the engine reads** (J1; D1 typed the M1 ones and the cheap later ones):
  - electric poles: `wire_reach` (Factorio's maximum_wire_distance) and `supply_area_distance` (half the side of the supply square, from the pole's centre: 2.5 is 5 × 5), each at most 64;
  - belts, underground belts and splitters: `items_per_s`, both lanes; the belt speed in positions per tick derives from it (15 → 8; 10 §2.4). An underground belt or a splitter runs at its tier's belt speed, and `max_gap` is an underground belt's longest gap (Factorio's max_distance − 1);
  - steam generators: `steam_per_s` (Factorio's fluid_usage_per_tick × 60), `min_temperature_c` (the fluid box's minimum_temperature) and `max_temperature_c` (maximum_temperature); `max_kw` must equal `steam_per_s` × (`max_temperature_c` − 15 °C) × steam's heat capacity. Boilers and heat exchangers make 10 steam per water (`steam_per_s` = 10 × `water_per_s`), and the water and the steam carry the same energy (`water_per_s` × water's heat capacity = `steam_per_s` × steam's). Every temperature these name (`temp_c`, `min_temperature_c`, `max_temperature_c`) lies between the default and the maximum temperature of the fluid made or used. Both validators check all of these (validate_spec.py and the data stage, D1-r1);
  - radars: `sector_range_chunks` and `energy_per_sector_mj` (the long-range scan: Factorio's max_distance_of_sector_revealed and energy_per_sector), `nearby_range_chunks` and `energy_per_nearby_scan_kj` (the continuous one);
  - Switches (beacons): `supply_area_distance` (3: a 9 × 9 area) and `profile` (`inverse-sqrt`: n Switches each count 1/√n, FFF-409);
  - the Frontier cluster: `payloads` (the items its payload slot takes) and `empty_launch` (a launch without a payload is allowed); what a launch returns is its pseudo recipe's products. The validator checks both against the launch recipes;
  - turrets: `auto_targets` is an enum (`replicators`).
- Still prose, waiting for their milestone (pm/reports/D1.md): the Terminal's `fluid_box` (M2), the Constructor's `holds`, `circuit`, `signals` and `built_by` and the Area scanner's `reads`, `signals` and `rescan` (M3), and a cooler's `heat.into` (M3).
- `heat` (03 §1): `class` (a key of `meta.heat.classes`: the entity is a computing machine and throttles), `liquid_cooling: true` (coolant boxes after *Liquid cooling*), `while: researcher` (the Seminar is accelerator class only while a Researcher is installed; its coolant box exists from *Liquid cooling* whatever the slot holds and needs flow only while a Researcher is installed, `meta.heat.coolant.seminar_box`; a build without the Researcher, such as M1's, emits the Seminar as not computing, and a capability manifest whose build holds both must read `entities.heat.while`, D1-r1), `emission` and `waste_heat` (the vocabulary above). Coolers: `removes_kw`, plus `full_rate_dt_k` and `water_per_mj` (cooling tower) or `coolant_in_min_c`, `coolant_out_c` and `into` (dry cooler, water exchanger).
- **v2** `effect_receiver: {uses_module_effects, uses_beacon_effects}` (Factorio 2.0's names; default true): the Research hall takes neither (DECISIONS §25).
- **v2** `allowed_effects`: the module effects an entity accepts (the cooling tower: `[consumption]`).
- **v2** `placement: {must_be_on: <resource id>} | {must_touch: <tile id or list>}` (Crawler and Endpoint on an exchange; offshore pump and water exchanger on water or deep water, ISO).
- `staff_slots`, `staff_demand` (B L9): the Seminar's single staff slot and its demand at speed 1. Demand combines as demand_i = `staff_demand` × wᵢ × max(`demand.min`, `demand.base` + Σ module and Switch speed), with `meta.staffing.demand`; the data's 1, 1 and 0.2 give 01 §8.3's formula.
- `deploys: true` (F): a deploying building for the leak (`meta.runaways`).
- The Research hall's `extra`: `accelerator_slots`, `weights_slots`, `weights_item`, `tiers` (speed, kw and drain per accelerator tier), `mixed_tiers`, `runs_when`, `loading`, `upgrade`, `output_returns_accelerators`, `accelerator_quality` (impl L1).
- **Damage dealers** (R5-gate D13): every entity that deals damage carries `extra.ammo_category`, a value of `meta.damage_categories` (the gun turret `bullet`, the laser turret `laser`, the arc turret `arc`, artillery `artillery-shell`, the land mine `landmine`, the Legged agent `rocket`); bonuses reach it through that category.
- The fusion reactor's `extra`: `plasma_mw` and `plasma_per_s` give the plasma's energy per unit (25 MJ; the validator checks the fusion generator's `max_kw` and `plasma_per_s` against it), and `neighbor_bonus` raises plasma output without more fuel, as in Space Age (R5-gate D12d).

## technologies.yaml

```yaml
- id: tabulation                    # the real R05 (it mirrors Factorio's automation)
  name: Tabulation
  code: R05                         # E's code (R/G/B/P/Y/W tiers, T triggers, S series, M Branch M, I infinite)
  era: Automatic computation        # E's era of the tier; sets the citation year limit (meta.citation_rules)
  regime: cited                     # v2 (DECISIONS §35): cited | infrastructure | beyond
  prerequisites: [basic-research]
  cost: {count: 10, time: 10, packs: {memo: 1}}     # per unit: 1 red pack, 10 s; 10 units
  unlocks:
    recipes: [assembling-machine-1, long-handed-inserter]
    effects: []                     # e.g. [{type: mining-productivity, value: 0.1}]; types listed in meta.effects
  # essential: true                 # Factorio's essential flag (pack gateways, silo, capstone)
  # hidden: true                    # round 5: never shown or queued; a trigger technology that only gates (Loop closed)
  # upgrade: true                   # Factorio's upgrade flag (series levels)
  # branch: M                       # E's Branch M (the Proceedings branch)
  mirrors: automation
  citation:                         # v2: cited technologies only; a list, oldest first
  - authors: ["Hollerith, H."]      # "Surname, I." strings, at most ten; more_authors: true after ten; role: editor for an edited book
    year: 1889
    title: An electric tabulating system   # sentence case; a non-English title in the original (Latin script), English in [brackets]
    venue: The School of Mines Quarterly, 10(3), 238–255   # journal, volume(issue), pages; proceedings; publisher; report number; arXiv id
    kind: article                   # article | book | chapter | report | thesis | preprint | patent
    url: https://...                # a DOI URL where one exists
  desc: "Machines pass work to machines without a hand between."   # the definition clause only
  note: "..."                       # v2, optional
  handbook_note: "..."              # v2, optional
```
- **Regimes** (DECISIONS §35, 08 §9.3): `cited` technologies carry a `citation`; `infrastructure` (literal engineering, uncited) and `beyond` (past the literature) carry none. `beyond` technologies carry `field_year` (a number, or an expression in L: *Model generation* `2025+0.5*(L-5)`), which feeds "years ahead" (01 §12.1); the Literature readout counts `cited` technologies only. The short form "(Surname, Year)" (two to four authors all named, five or more "et al."), the long form (08 §9.2) and the technology's year (the latest citation year) are generated. Validator: every citation year ≤ build year − 2 and ≤ its era's end; no corporate author; `beyond` text carries no future word.
- Exactly one of `cost` and `trigger`. **Trigger types**: `start` (researched when the game begins), `craft-item` (`item`, `count`), `craft-recipe` (`recipe`, `count`: completed crafts of that recipe by any machine of the force; round 5), `mine-entity` (`entity`: an entity or a resource id), `build-entity`, `research`, `launch` (`item`: the payload a completed frontier run must carry).
- **`hidden: true`** (round 5, R5-gate D9; Factorio's `hidden`): the technology has no card, no queue entry, no toast and no research log line, and counts in no readout or statistic. It must be a trigger technology and unlock nothing: it only gates its dependents. The one in use is *Loop closed* (`loop-closed`, `craft-recipe` of `research-run`, count 1): the closure event of DECISIONS §16 as a technology, the prerequisite of *Model generation* and of the takeoff hardware, so every technology paid in System cards alone waits for closure (04 §5).
- **Multi-level techs** (finite or infinite): `count_formula` (an expression in L), `first_level` (default 1) and `max_level` (an int, or `infinite`). `cost` then has `time` and `packs` but no `count`. The unit count at a level is the formula's value **rounded half up** (10 §5.12; *Model generation* 12: 27,337.5 → 27,338); the validator, the renderer and the engine all use the rounded count. Infinite techs have geometric costs (DECISIONS §12). A prerequisite on a finite multi-level technology is met at its `max_level`, on an infinite one at its first level (impl U19).
- Effects carry `value` (additive fraction or count), `multiplier`, or a type-specific key (`category`, `turret`, `quality`, `recipes`, `entities`, `fraction`, `output`, `energy`, `floor_temperature_k`). **v2:** `research-per-paper` carries `multiplier_from: returns_to_research` (m = g^r from `meta.world_settings`), never a literal (impl J14); `recipe-productivity` may name only recipes with `allow_productivity`.
- Technologies paid in System cards alone take 60 s per unit (DECISIONS §23c).

## enemies.yaml

The runaway prototypes (F §1.3; DECISIONS §6). The validator checks loot items and counts loot as produced; the engine reads the rest. `kind`: copy (the in-base runaway: `targets`, `spread`, `effect`), spawner, unit, stationary. Descriptions may use the runtime variables `{checkpoint}` and `{tier}`.
```yaml
- id: dismantler-1
  name: Dismantler 1
  kind: unit
  mirrors: small-biter
  tier: 1                # a nest's units never exceed the escaped model's tier
  health: 15             # spawners: [at evolution 0, at evolution 1]
  attack: {type: physical, damage: 7, range: melee}
  join_cost: 4
  appears_at_evolution: 0.0
  resist: "ISO; 0% electric"
  loot: {scrap: 20}
  sprite: "..."
  desc: "Takes things apart."
```

Other enemy fields in use: spawners carry `spawns` (unit ids, weakest first), `max_units` and `spawn_cooldown_ticks` ([at evolution 0, at evolution 1], ISO); the in-base `runaway` carries `targets`, `spread`, `effect`, `escape_timer_s` and `spread_interval_s` (per model tier 1–4; the engine reads `meta.runaways`, these are copies); an `attack` may add `puddle: true` (acid, ISO); `loot` may add `plus: its stock` (a nest drops what it has dismantled).

## tiles.yaml (v2; impl B3)

```yaml
- id: concrete
  name: Concrete
  kappa_per_s: 0.0015      # Newton-cooling coefficient, 03 §1.2; null only for out-of-map
  buildable: true
  walking_speed: 1.4       # Factorio's walking_speed_modifier; null = neither walkable nor drivable
  map_color: '#626262'
  placed_by: concrete      # optional: the item that places it (that item's places_tile names this tile)
  minable_back: true
  placed_on: [water]       # optional: tiles it may be placed on (landfill)
  biome: [temperate]       # optional: biomes whose worldgen uses it (01 §2)
  town: true               # optional: a town footprint tile (unbuildable)
```
A chunk's κ is the mean of its 1,024 tiles' `kappa_per_s` plus its trees (`meta.heat.loss`). The list covers the ground tiles, water, the four concretes, landfill, the two town tiles and `out-of-map`.

## world.yaml (v2; impl J9)

Things worldgen places and the player mines or clicks but never builds.
```yaml
- id: huge-rock
  name: Huge rock
  kind: rock               # tree | rock | town-building | campus | landmark
  size: [3, 3]             # collision footprint, tiles
  mining_time: 3           # hand mining, ISO (decoratives.lua 2.0.77)
  yields: {quartz: [24, 50], coal: [24, 50]}    # n, or [min, max]; counted as producible by the validator
  collides: true
  cosmetic: false          # landmarks: no function beyond a tooltip
  selectable: true         # optional; campus: gui: university
  sprite: "..."
```
Trees also carry `leaf_stages` (4). A `note` on a world object is commentary for people, never UI text. Town buildings are `town-block` tiles; the Laboratory salvage is defined only in `meta.start.salvage` (DECISIONS §33).

## text.yaml (v2; owned by R4-ui)

Engine-readable text: the strings live here once; their rules and reasons are in 08. Shape:
- `tips`: list of `{id, text, requires: [setting], asserts?: [comparison]}` (loading tips, 08 §7).
- `tips_and_tricks`: list of `{id, title, requires, unlocked_by: <technology id> | null, text, asserts?}`.
- `milestones`: list of `{id, kind: produce | build | research | event, target}`; `target` is an item, entity or technology id, or for `event` one of `frontier-run-returned-cards`, `loop-closed`, `researcher-installed`, `archive-depleted`, `exchange-closed`.
- `achievements`: list of `{id, name, text, condition: {type, ...params}, requires?, asserts?, arc: early | mid | late, mirrors?, why}`; `type` is one of 08 §6's condition registry (the validator's list, or `condition_types` in the file); params named `item`, `items`, `into`, `vehicle`, `entity`, `technology`, `not_researched`, `resource`, `recipe` must be ids of that kind; `regime` one of the three regimes. An achievement's `text` may restate its own condition's numbers as digits: P17's one exemption (DECISIONS §41). Every number in digits in it must be one of its condition's values (as is, as a percent of a share, or a duration in minutes or hours); names that contain digits (*Model generation 25*) are not numbers. Anything else is a placeholder, or, in words, carries an `asserts` entry.
- `town_names` (`first_by_climate`, `second`, `blocklist`, `university`, `library`, `records_store`, and `uniqueness` {`within_cells`, `redraws`, `suffix`}: a town's name is unique within 8 town cells, by the cell-hash priority, R5-gate D1) and `world_text` (town, university, library, records store, exchange: `desc`, `handbook_note`).
- `requires` vocabulary and meaning (a string applies only when every token is met):
  - map settings (`meta.world_settings`): `heat` (Heat on), `staffing` (staffing on; off in *Sandbox*), `runaways` (Runaways not Off), `hollow-work` (`hollow_work` on), `race` (`race_mode` Race or Race, hard), `scooped` (Scooped on, which Race forces);
  - systems no setting turns off: `exchanges` (Crawlers and exchange tapping, M2), `quality` (M3), `agents` (M3). They are met when the system is in the build (10 §12), so a milestone build never shows a string about a system it lacks.
- `asserts`: `"<lhs> <op> <rhs>"`, op one of `== != < > <= >=`, each side arithmetic over numbers and placeholder paths, or a quoted string against a path. A string that states a data number in words ("twice", "a third") carries the assert that proves it.
- Validator: ids exist; placeholders resolve; asserts hold (an assert it cannot evaluate is a warning); no `!` or ellipsis; achievement names ≤ 30 characters and conditions ≤ 100; every achievement has a *Why*.

## What the validator checks

Schema per kind; id uniqueness; references (items, entities, recipes, resources, tiles, world objects, tiers, categories, fuel categories, heat classes, effect types, quality tiers, salvage, loot, placement targets, meta lists); the technology prerequisite DAG; that every recipe is unlocked (warning when more than once without `shared_unlock`); that every item is produced (recipes, resources, entities, loot, world objects) and used; a **research playthrough** in waves proving every technology reachable (a `craft-recipe` trigger is met once its recipe is unlocked, its ingredients obtainable and a machine of its category placeable); a **closure check** warning about hidden prerequisites (a technology whose packs, trigger target or unlocked recipes need something no prerequisite unlocks: Factorio's gateway rule). **v2:** expressions (`meta.world.model_collapse.speed_factor` evaluated over σ and c, within [0, 1]); stray nulls (a warning); town-class keys in every per-class map; that every value the data holds twice agrees (the starting archive, the Watermarking factor, the liquid shares, the runaway timers and presets, the deploying and interruptible lists, the hall's tier-1 numbers, the Verifier's return, the quality unlocks); catalyst quality flags; productivity eligibility; `research-per-paper` without literals; heat-emission vocabulary; effect receivers and allowed effects; the `mirrors` parse rule; tiles and world objects; regimes and citations; UI-text rules and budgets; effect-line coverage; `text.yaml`. **Round 5:** `craft-recipe` triggers and `hidden` technologies (a trigger, no unlocks); `meta.endgame.takeoff_order` (every System-card-only level once, in prerequisite order); `meta.damage_categories` against the bonuses and the dealers; the plasma's energy per unit (fusion reactor against generator); the digits in achievement texts against their conditions. **D1:** the typed engine values (pole and Switch areas within 64 tiles; every belt, underground belt and splitter at a whole belt speed, and undergrounds and splitters at a belt tier's; boilers' 1 : 10; a steam generator's power against its steam flow and temperature; radar scans; the Frontier cluster's payloads against the launch recipes; the day cycle's order) and worldgen v1's tables (biome bounds ascending; a patch row for every solid resource but the archives, a starting patch exactly for the starting-coverage ores, each starting amount = per tile × tiles; one P(town) per distance band and class probabilities summing to 1 in each). It then prints pack totals, regime counts and the raw cost of each pack (first recipe per item, catalysts net).

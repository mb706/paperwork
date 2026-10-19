#### Raw resources (7)

| Item | Stack | Tier | Mirrors | Sprite (32 px) | Tooltip (proposal) |
|---|---|---|---|---|---|
| **Wood** `wood` | 100 | red | wood | ISO: two crossed brown logs |  |
| **Coal** `coal` | 50 | red | coal | ISO: black lumps |  |
| **Iron ore** `iron-ore` | 50 | red | iron-ore | ISO: blue-grey rock chunks |  |
| **Copper ore** `copper-ore` | 50 | red | copper-ore | ISO: orange rocks with green flecks |  |
| **Quartz** `quartz` | 50 | red | stone | heap of milky-white faceted crystals, faint pink cast; the brightest raw item | Silicon dioxide. About 60% of the continental crust, by weight. |
| **Uranium ore** `uranium-ore` | 50 | blue | uranium-ore | ISO: dark rock with glowing green specks |  |
| **Records** `records` | 50 | red | iron-ore (role: a basic ore) | bundle of yellowed papers tied with a string cross; manila, soft edges | Boxes of records. Finite. |

#### Fluids (8)

| Item | Stack | Tier | Mirrors | Sprite (32 px) | Tooltip (proposal) |
|---|---|---|---|---|---|
| **Water** `water` | fluid | red | water | ISO blue |  |
| **Steam** `steam` | fluid | red | steam | ISO white |  |
| **Sulfuric acid** `sulfuric-acid` | fluid | blue | sulfuric-acid | ISO yellow-green |  |
| **Lubricant** `lubricant` | fluid | blue | lubricant | ISO green |  |
| **Crawl** `crawl` | fluid | blue | crude-oil | near-black with white static speckle | Raw. Mostly copies. |
| **Junk** `junk` | fluid | blue | heavy-oil | muddy brown-grey | Not nothing. Can be rephrased. |
| **Text** `text` | fluid | blue | light-oil | warm amber |  |
| **Prose** `prose` | fluid | blue | petroleum-gas | pale ice-cyan | Deduplicated, filtered, readable. |

#### Plates (5)

| Item | Stack | Tier | Mirrors | Sprite (32 px) | Tooltip (proposal) |
|---|---|---|---|---|---|
| **Iron plate** `iron-plate` | 100 | red | iron-plate | ISO |  |
| **Copper plate** `copper-plate` | 100 | red | copper-plate | ISO |  |
| **Steel plate** `steel-plate` | 100 | green | steel-plate | ISO |  |
| **Silicon** `silicon` | 100 | green | stone-brick (furnace slot) / plastic-bar (bulk role) | dark metallic lump with a blue-violet sheen and sharp facets | Quartz with the oxygen removed. |
| **Token** `token` | 100 | red | copper-plate (role) | short stack of cream punched cards, top-left corner cut, two rows of holes | One instance of one type. |

#### Components (14)

| Item | Stack | Tier | Mirrors | Sprite (32 px) | Tooltip (proposal) |
|---|---|---|---|---|---|
| **Iron gear wheel** `iron-gear-wheel` | 100 | red | iron-gear-wheel | ISO |  |
| **Iron stick** `iron-stick` | 100 | red | iron-stick | ISO |  |
| **Copper cable** `copper-cable` | 200 | red | copper-cable | ISO |  |
| **Logic board** `logic-board` | 200 | red | electronic-circuit | small olive-green board carrying one glass vacuum tube (orange filament glow) and three copper traces | Gates on a board. Relays, then tubes, then transistors. |
| **Wafer** `wafer` | 100 | blue | plastic-bar | iridescent silver disc etched with a fine grid, flat notch at the bottom | Silicon, polished flat to a few atoms. |
| **Processor** `processor` | 200 | blue | advanced-circuit | black chip with two rows of silver legs on a small red board | Executes stored programs. Binned by clock speed. |
| **Accelerator** `accelerator` | 100 | blue | processing-unit | square package with a gold lid, ringed by four small dark memory stacks, blue rim | Multiplies matrices. |
| **Sulfur** `sulfur` | 50 | blue | sulfur | ISO |  |
| **Battery** `battery` | 200 | blue | battery | ISO |  |
| **Explosives** `explosives` | 50 | blue | explosives | ISO |  |
| **Engine unit** `engine-unit` | 50 | green | engine-unit | ISO |  |
| **Electric engine unit** `electric-engine-unit` | 50 | blue | electric-engine-unit | ISO |  |
| **Drone frame** `drone-frame` | 50 | blue | flying-robot-frame | X-shaped quadcopter frame, four grey rotor rings, no lights | A body. Loaded with a planner or with weights. |
| **Rack** `rack` | 50 | yellow | low-density-structure | tall black cabinet, front of thin horizontal slats, one copper busbar stripe | 19 inches wide, 42 U high. Battery backup. |

#### Data products (5)

| Item | Stack | Tier | Mirrors | Sprite (32 px) | Tooltip (proposal) |
|---|---|---|---|---|---|
| **Dataset** `dataset` | 100 | blue | plastic-bar | sealed grey drive with an ice-cyan label band | Deduplicated. Smaller than what went in. |
| **Benchmark** `benchmark` | 50 | blue | sulfur | sealed manila envelope printed with a green grid of check boxes | Each use leaks a little. |
| **Adversarial set** `adversarial-set` | 50 | gray | lubricant (direct use of the heavy fraction) | manila envelope crossed by a black-and-red hazard stripe | Inputs chosen to be answered wrong. |
| **Corpus** `corpus` | 20 | white | rocket-fuel | three wide tape reels stacked, amber banding | Ten datasets, mixed. |
| **Checkpoint** `checkpoint` | 50 | blue | new (catalyst; consumed where Factorio consumes a productivity module) | grey drive with an orange hexagon label | Weights on a drive. Copying recipes return it. |

#### Modules: where compute lives (9)

| Item | Stack | Tier | Mirrors | Sprite (32 px) | Tooltip (proposal) |
|---|---|---|---|---|---|
| **Coprocessor 1** `coprocessor` | 50 | blue | speed-module | blue module card, one chevron | More arithmetic for the machine's control loop. |
| **Coprocessor 2** `coprocessor-2` | 50 | purple | speed-module-2 | blue card with heat-sink fins, two chevrons |  |
| **Coprocessor 3** `coprocessor-3` | 50 | yellow | speed-module-3 | long blue card with a fan shroud, three chevrons |  |
| **Learned controller 1** `learned-controller` | 50 | blue | productivity-module | orange module card, one chevron, small glowing hexagon | Weights copied from a checkpoint. More yield, slower, hungrier. |
| **Learned controller 2** `learned-controller-2` | 50 | purple | productivity-module-2 | orange card, two chevrons |  |
| **Learned controller 3** `learned-controller-3` | 50 | yellow | productivity-module-3 | orange card, three chevrons, hexagon with a halo |  |
| **Distilled controller 1** `distilled-controller` | 50 | blue | efficiency-module | green module card, one chevron, small hexagon | Most of the teacher at a fraction of the watts. |
| **Distilled controller 2** `distilled-controller-2` | 50 | purple | efficiency-module-2 | green card, two chevrons |  |
| **Distilled controller 3** `distilled-controller-3` | 50 | yellow | efficiency-module-3 | green card, three chevrons |  |

#### Frontier run (3)

| Item | Stack | Tier | Mirrors | Sprite (32 px) | Tooltip (proposal) |
|---|---|---|---|---|---|
| **Run shard** `run-shard` | 5 | white | rocket-part | flat translucent slab with a lattice of dots | One training step of a hundred. |
| **Post-training payload** `post-training-payload` | 1 | white | satellite | small glass cube holding an orange hexagon, gold base | Preference data and a reward model. Without it a run returns a base model and no system card. |
| **Researcher** `researcher` | 10 | white | new (hook for G and B's L9) | slim black box with a single orange hexagon and a green status lamp | Staffs a seminar. Four accelerators and a checkpoint; the checkpoint is returned. |

#### Papers (science packs) (7)

| Item | Stack | Tier | Mirrors | Sprite (32 px) | Tooltip (proposal) |
|---|---|---|---|---|---|
| **Memo** `memo` | 200 | red | automation-science-pack | typed sheet with a red header band and a carbon-copy edge | Typed, carbon-copied, filed. |
| **Report** `report` | 200 | green | logistic-science-pack | stapled report, green cover, number in the corner | Numbered, bound, mailed on request. |
| **Article** `article` | 200 | blue | chemical-science-pack | two-column page, blue header bar | Refereed. |
| **Proceedings** `proceedings` | 200 | gray | military-science-pack | grey bound volume with a red stripe | Presented once, then printed. |
| **Preprint** `preprint` | 200 | purple | production-science-pack | loose sheets with a purple vertical stamp in the left margin | Posted. Not reviewed. Cited. |
| **Model card** `model-card` | 200 | yellow | utility-science-pack | yellow card printed with a small table | States what the model was tested on. |
| **System card** `system-card` | 2000 | white | space-science-pack | white card with a grey table and no author line | Returned by a frontier run. Not written by anyone. |

#### Agents (2)

| Item | Stack | Tier | Mirrors | Sprite (32 px) | Tooltip (proposal) |
|---|---|---|---|---|---|
| **Construction agent** `construction-agent` | 50 | blue | construction-robot | drone with orange accents | Builds ghosts within range of a hub. |
| **Logistic agent** `logistic-agent` | 50 | blue | logistic-robot | drone with yellow-and-blue accents | Moves items between hub chests. |

#### Nuclear (ISO) (4)

| Item | Stack | Tier | Mirrors | Sprite (32 px) | Tooltip (proposal) |
|---|---|---|---|---|---|
| **Uranium-235** `uranium-235` | 100 | blue | uranium-235 | ISO |  |
| **Uranium-238** `uranium-238` | 100 | blue | uranium-238 | ISO |  |
| **Uranium fuel cell** `uranium-fuel-cell` | 50 | blue | uranium-fuel-cell | ISO |  |
| **Depleted uranium fuel cell** `depleted-uranium-fuel-cell` | 50 | blue | depleted-uranium-fuel-cell | ISO |  |

#### Terrain (ISO) (6)

| Item | Stack | Tier | Mirrors | Sprite (32 px) | Tooltip (proposal) |
|---|---|---|---|---|---|
| **Concrete** `concrete` | 100 | green | concrete | ISO |  |
| **Hazard concrete** `hazard-concrete` | 100 | green | hazard-concrete | ISO |  |
| **Refined concrete** `refined-concrete` | 100 | blue | refined-concrete | ISO |  |
| **Refined hazard concrete** `refined-hazard-concrete` | 100 | blue | refined-hazard-concrete | ISO |  |
| **Landfill** `landfill` | 100 | green | landfill | ISO (pale sand fill) |  |
| **Cliff explosives** `cliff-explosives` | 20 | blue | cliff-explosives | ISO |  |

#### Containers (2)

| Item | Stack | Tier | Mirrors | Sprite (32 px) | Tooltip (proposal) |
|---|---|---|---|---|---|
| **Barrel** `barrel` | 10 | green | barrel | ISO: empty steel barrel |  |
| **Drive** `drive` | 10 | green | barrel (data side) | flat grey cartridge with two visible reels, blank label | Random access. |

#### Other (1)

| Item | Stack | Tier | Mirrors | Sprite (32 px) | Tooltip (proposal) |
|---|---|---|---|---|---|
| **Repair pack** `repair-pack` | 100 | red | repair-pack | ISO |  |

| Building | Type | Size | Speed | Power | Slots | Emis./min | Notes | Recipe (time) | Mirrors | Unlock |
|---|---|---|---|---|---|---|---|---|---|---|
| **Burner mining drill** | mining-drill | 2×2 | 0.25 | 150 kW burner | 0 | 12 |  | 3 Iron gear wheel + 1 Stone furnace + 3 Iron plate (2) | burner-mining-drill | start |
| **Electric mining drill** | mining-drill | 3×3 | 0.5 | 90 kW | 3 | 10 |  | 3 Logic board + 5 Iron gear wheel + 10 Iron plate (2) | electric-mining-drill | start |
| **Offshore pump** | offshore-pump | 1×2 |  | – |  |  | pumping_per_s=1200 | 3 Pipe + 2 Iron gear wheel (0.5) | offshore-pump | start |
| **Crawler** | pumpjack | 3×3 | 1 | 90 kW | 2 | 10 |  | 5 Steel plate + 10 Iron gear wheel + 5 Logic board + 10 Data line (5) | pumpjack | information-retrieval |
| **Stone furnace** | furnace | 2×2 | 1 | 90 kW burner | 0 | 2 | crafts: smelting | 5 Quartz (0.5) | stone-furnace | start |
| **Steel furnace** | furnace | 2×2 | 2 | 90 kW burner | 0 | 4 | crafts: smelting | 6 Steel plate + 10 Quartz (3) | steel-furnace | advanced-material-processing |
| **Electric furnace** | furnace | 3×3 | 2 | 180 kW | 2 | 1 | crafts: smelting | 10 Steel plate + 5 Processor + 10 Quartz (5) | electric-furnace | advanced-material-processing-2 |
| **Keypunch** | furnace | 2×2 | 1 | 90 kW burner | 0 | 2 | crafts: transcription | 2 Iron gear wheel + 3 Iron plate (0.5) | stone-furnace (data smelter) | start |
| **Tokenizer** | furnace | 3×3 | 2 | 180 kW | 2 | 1 | crafts: transcription | 10 Steel plate + 5 Processor + 10 Dataset (5) | electric-furnace (data smelter) | tokenization |
| **Assembling machine 1** | assembler | 3×3 | 0.5 | 75 kW | 0 | 4 | crafts: crafting | 3 Logic board + 5 Iron gear wheel + 9 Iron plate (0.5) | assembling-machine-1 | automation |
| **Assembling machine 2** | assembler | 3×3 | 0.75 | 150 kW | 2 | 3 | crafts: crafting/crafting-with-fluid | 2 Steel plate + 3 Logic board + 5 Iron gear wheel + 1 Assembling machine 1 (0.5) | assembling-machine-2 | automation-2 |
| **Assembling machine 3** | assembler | 3×3 | 1.25 | 375 kW | 4 | 2 | crafts: crafting/crafting-with-fluid | 4 Coprocessor 1 + 2 Assembling machine 2 (0.5) | assembling-machine-3 | automation-3 |
| **Chemical plant** | assembler | 3×3 | 1 | 210 kW | 3 | 4 | crafts: chemistry | 5 Steel plate + 5 Iron gear wheel + 5 Logic board + 5 Pipe (5) | chemical-plant | coal-chemistry |
| **Data refinery** | assembler | 5×5 | 1 | 420 kW | 3 | 6 | crafts: data-refining | 15 Steel plate + 10 Iron gear wheel + 10 Concrete + 10 Logic board + 10 Data line (8) | oil-refinery | information-retrieval |
| **Data plant** | assembler | 3×3 | 1 | 210 kW | 3 | 4 | crafts: data-processing | 5 Steel plate + 5 Iron gear wheel + 5 Logic board + 5 Data line (5) | chemical-plant (data side) | datasets |
| **Trainer** | assembler | 3×3 | 1 | 400 kW | 4 | 4 | crafts: training | 10 Steel plate + 10 Iron gear wheel + 10 Processor + 10 Copper cable (5) | centrifuge (special 3x3 maker); recipes mirror modules | machine-learning |
| **Centrifuge** | assembler | 3×3 | 1 | 350 kW | 2 | 4 | crafts: centrifuging | 100 Concrete + 50 Steel plate + 100 Processor + 100 Iron gear wheel (4) | centrifuge | uranium-processing |
| **Seminar** | lab | 3×3 | 1 | 60 kW | 2 | 0 |  | 10 Logic board + 10 Iron gear wheel + 4 Transport belt (2) | lab | start |
| **Switch** | beacon | 3×3 |  | 480 kW | 2 |  | distribution_efficiency=1.5, supply_area=9x9, profile=1/sqrt(n) | 20 Processor + 20 Logic board + 10 Steel plate + 10 Copper cable (15) | beacon | interconnect |
| **Frontier cluster** | rocket-silo | 9×9 | 1 | 3.99 MW | 4 | 0 | crafts: frontier-run/launch; parts_required=100, idle_kw=250, payload=post-training-payload, returns=1000 system-card | 1000 Steel plate + 1000 Concrete + 100 Pipe + 200 Accelerator + 200 Electric engine unit (30) | rocket-silo | frontier-run |
| **Boiler** | boiler | 3×2 |  | 1.8 MW burner |  | 30 | steam_per_s=60, temp_c=165 | 1 Stone furnace + 4 Pipe (0.5) | boiler | start |
| **Steam engine** | generator | 3×5 |  | – |  |  | max_kw=900 | 8 Iron gear wheel + 5 Pipe + 10 Iron plate (0.5) | steam-engine | start |
| **Solar panel** | solar-panel | 3×3 |  | – |  |  | peak_kw=60 | 5 Steel plate + 15 Logic board + 5 Silicon (10) | solar-panel | semiconductors |
| **Accumulator** | accumulator | 2×2 |  | – |  |  | capacity_mj=5, flow_kw=300 | 2 Iron plate + 5 Battery (10) | accumulator | battery |
| **Nuclear reactor** | reactor | 5×5 |  | 40 MW burner |  |  | heat_mw=40, neighbour_bonus=+100% per adjacent active reactor | 500 Concrete + 500 Steel plate + 500 Processor + 500 Copper plate (8) | nuclear-reactor | nuclear-power |
| **Heat pipe** | heat-pipe | 1×1 |  | – |  |  |  | 10 Steel plate + 20 Copper plate (1) | heat-pipe | nuclear-power |
| **Heat exchanger** | heat-exchanger | 3×2 |  | 10 MW |  |  | steam_per_s=103.09, temp_c=500 | 10 Steel plate + 100 Copper plate + 10 Pipe (3) | heat-exchanger | nuclear-power |
| **Steam turbine** | generator | 3×5 |  | – |  |  | max_kw=5820 | 50 Iron gear wheel + 50 Copper plate + 20 Pipe (3) | steam-turbine | nuclear-power |
| **Small electric pole** | electric-pole | 1×1 |  | – |  |  | wire_reach=7.5, supply=5x5 | 1 Wood + 2 Copper cable (0.5) → 2 | small-electric-pole | start |
| **Medium electric pole** | electric-pole | 1×1 |  | – |  |  | wire_reach=9, supply=7x7 | 4 Iron stick + 2 Steel plate + 2 Copper cable (0.5) | medium-electric-pole | electric-energy-distribution-1 |
| **Big electric pole** | electric-pole | 2×2 |  | – |  |  | wire_reach=32, supply=4x4 | 8 Iron stick + 5 Steel plate + 4 Copper cable (0.5) | big-electric-pole | electric-energy-distribution-1 |
| **Substation** | electric-pole | 2×2 |  | – |  |  | wire_reach=18, supply=18x18 | 10 Steel plate + 5 Processor + 6 Copper cable (0.5) | substation | electric-energy-distribution-2 |
| **Transport belt** | belt | 1×1 |  | – |  |  | items_per_s=15 | 1 Iron plate + 1 Iron gear wheel (0.5) → 2 | transport-belt | start |
| **Fast transport belt** | belt | 1×1 |  | – |  |  | items_per_s=30 | 5 Iron gear wheel + 1 Transport belt (0.5) | fast-transport-belt | logistics-2 |
| **Express transport belt** | belt | 1×1 |  | – |  |  | items_per_s=45 | 10 Iron gear wheel + 1 Fast transport belt + 20 Lubricant (0.5) | express-transport-belt | logistics-3 |
| **Underground belt** | underground-belt | 1×1 |  | – |  |  | max_gap=4 | 10 Iron plate + 5 Transport belt (1) → 2 | underground-belt | logistics |
| **Fast underground belt** | underground-belt | 1×1 |  | – |  |  | max_gap=6 | 40 Iron gear wheel + 2 Underground belt (2) → 2 | fast-underground-belt | logistics-2 |
| **Express underground belt** | underground-belt | 1×1 |  | – |  |  | max_gap=8 | 80 Iron gear wheel + 2 Fast underground belt + 40 Lubricant (2) → 2 | express-underground-belt | logistics-3 |
| **Splitter** | splitter | 2×1 |  | – |  |  |  | 5 Logic board + 5 Iron plate + 4 Transport belt (1) | splitter | logistics |
| **Fast splitter** | splitter | 2×1 |  | – |  |  |  | 1 Splitter + 10 Iron gear wheel + 10 Logic board (2) | fast-splitter | logistics-2 |
| **Express splitter** | splitter | 2×1 |  | – |  |  |  | 1 Fast splitter + 10 Iron gear wheel + 10 Processor + 80 Lubricant (2) | express-splitter | logistics-3 |
| **Burner inserter** | inserter | 1×1 |  | 105 kW burner |  |  |  | 1 Iron plate + 1 Iron gear wheel (0.5) | burner-inserter | start |
| **Inserter** | inserter | 1×1 |  | 13.2 kW |  |  |  | 1 Logic board + 1 Iron gear wheel + 1 Iron plate (0.5) | inserter | start |
| **Long-handed inserter** | inserter | 1×1 |  | 20 kW |  |  |  | 1 Iron gear wheel + 1 Iron plate + 1 Inserter (0.5) | long-handed-inserter | automation |
| **Fast inserter** | inserter | 1×1 |  | 46 kW |  |  |  | 2 Logic board + 2 Iron plate + 1 Inserter (0.5) | fast-inserter | fast-inserter |
| **Bulk inserter** | inserter | 1×1 |  | 132 kW |  |  |  | 15 Iron gear wheel + 15 Logic board + 1 Processor + 1 Fast inserter (0.5) | bulk-inserter | bulk-inserter |
| **Wooden chest** | chest | 1×1 |  | – |  |  | slots=16 | 2 Wood (0.5) | wooden-chest | start |
| **Iron chest** | chest | 1×1 |  | – |  |  | slots=32 | 8 Iron plate (0.5) | iron-chest | start |
| **Steel chest** | chest | 1×1 |  | – |  |  | slots=48 | 8 Steel plate (0.5) | steel-chest | steel-processing |
| **Active provider chest** | logistic-chest | 1×1 |  | – |  |  |  | 1 Steel chest + 3 Logic board + 1 Processor (0.5) | active-provider-chest | learned-agents |
| **Passive provider chest** | logistic-chest | 1×1 |  | – |  |  |  | 1 Steel chest + 3 Logic board + 1 Processor (0.5) | passive-provider-chest | planning-agents |
| **Storage chest** | logistic-chest | 1×1 |  | – |  |  |  | 1 Steel chest + 3 Logic board + 1 Processor (0.5) | storage-chest | planning-agents |
| **Buffer chest** | logistic-chest | 1×1 |  | – |  |  |  | 1 Steel chest + 3 Logic board + 1 Processor (0.5) | buffer-chest | learned-agents |
| **Requester chest** | logistic-chest | 1×1 |  | – |  |  |  | 1 Steel chest + 3 Logic board + 1 Processor (0.5) | requester-chest | learned-agents |
| **Pipe** | pipe | 1×1 |  | – |  |  |  | 1 Iron plate (0.5) | pipe | start |
| **Pipe to ground** | pipe-to-ground | 1×1 |  | – |  |  | max_gap=9 | 10 Pipe + 5 Iron plate (0.5) → 2 | pipe-to-ground | start |
| **Pump** | pump | 1×2 |  | 29 kW |  |  |  | 1 Engine unit + 1 Steel plate + 1 Pipe (2) | pump | fluid-handling |
| **Storage tank** | storage-tank | 3×3 |  | – |  |  | capacity=25000 | 20 Iron plate + 5 Steel plate (3) | storage-tank | fluid-handling |
| **Data line** | pipe | 1×1 |  | – |  |  |  | 1 Copper plate (0.5) | pipe (data network) | telecommunication |
| **Underground line** | pipe-to-ground | 1×1 |  | – |  |  | max_gap=9 | 10 Data line + 5 Iron plate (0.5) → 2 | pipe-to-ground (data) | telecommunication |
| **Repeater** | pump | 1×2 |  | 29 kW |  |  |  | 1 Steel plate + 2 Logic board + 1 Data line (2) | pump (data) | telecommunication |
| **Data lake** | storage-tank | 3×3 |  | – |  |  | capacity=25000 | 20 Iron plate + 5 Steel plate (3) | storage-tank (data) | telecommunication |
| **Rail** | rail | 2×2 |  | – |  |  |  | 1 Quartz + 1 Iron stick + 1 Steel plate (0.5) → 2 | rail | railway |
| **Train stop** | train-stop | 2×2 |  | – |  |  |  | 5 Logic board + 6 Iron plate + 6 Iron stick + 3 Steel plate (0.5) | train-stop | railway |
| **Rail signal** | rail-signal | 1×1 |  | – |  |  |  | 1 Logic board + 5 Iron plate (0.5) | rail-signal | railway |
| **Rail chain signal** | rail-signal | 1×1 |  | – |  |  |  | 1 Logic board + 5 Iron plate (0.5) | rail-chain-signal | railway |
| **Locomotive** | locomotive | 2×6 |  | 600 kW burner |  |  |  | 20 Engine unit + 10 Logic board + 30 Steel plate (4) | locomotive | railway |
| **Cargo wagon** | cargo-wagon | 2×6 |  | – |  |  | slots=40 | 10 Iron gear wheel + 20 Iron plate + 20 Steel plate (1) | cargo-wagon | railway |
| **Fluid wagon** | fluid-wagon | 2×6 |  | – |  |  | capacity=50000 | 10 Iron gear wheel + 16 Steel plate + 8 Pipe + 1 Storage tank (1.5) | fluid-wagon | fluid-wagon |
| **Data wagon** | fluid-wagon | 2×6 |  | – |  |  | capacity=50000 | 10 Iron gear wheel + 16 Steel plate + 8 Data line + 1 Data lake (1.5) | fluid-wagon (data) | fluid-wagon |
| **Agent hub** | roboport | 4×4 |  | 50 kW |  |  |  | 45 Steel plate + 45 Iron gear wheel + 45 Processor (5) | roboport | planning-agents |
| **Radar** | radar | 3×3 |  | 300 kW |  |  |  | 5 Logic board + 5 Iron gear wheel + 10 Iron plate (0.5) | radar | start |
| **Car** | other | 2×3 |  | 600 kW burner |  |  |  | 8 Engine unit + 20 Iron plate + 5 Steel plate (2) | car | automobilism |
| **Lamp** | lamp | 1×1 |  | 5 kW |  |  |  | 1 Logic board + 3 Copper cable + 1 Iron plate (0.5) | small-lamp | optics |
| **Threshold unit** | combinator | 1×2 |  | 1 kW |  |  |  | 5 Copper cable + 5 Logic board (0.5) | decider-combinator | circuit-network |
| **Arithmetic unit** | combinator | 1×2 |  | 1 kW |  |  |  | 5 Copper cable + 5 Logic board (0.5) | arithmetic-combinator | circuit-network |
| **Bias unit** | combinator | 1×1 |  | – |  |  |  | 5 Copper cable + 2 Logic board (0.5) | constant-combinator | circuit-network |
| **Selector unit** | combinator | 1×2 |  | 1 kW |  |  |  | 2 Processor + 5 Threshold unit (0.5) | selector-combinator | advanced-combinators |
| **Power switch** | other | 2×2 |  | – |  |  |  | 5 Iron plate + 5 Copper cable + 2 Logic board (2) | power-switch | circuit-network |
| **Programmable speaker** | other | 1×1 |  | 2 kW |  |  |  | 3 Iron plate + 4 Iron stick + 5 Copper cable + 4 Logic board (2) | programmable-speaker | circuit-network |
| **Display panel** | other | 1×1 |  | – |  |  |  | 1 Iron plate + 1 Logic board (0.5) | display-panel | circuit-network |

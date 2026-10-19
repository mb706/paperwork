| Unlock group | Packs | Prerequisites | Unlocks |
|---|---|---|---|
| Automation `automation` | red | – | Assembling machine 1, Long-handed inserter |
| Logistics `logistics` | red | – | Underground belt, Splitter |
| Optics `optics` | red | – | Lamp |
| Fast inserter `fast-inserter` | red | automation | Fast inserter |
| Steel processing `steel-processing` | red | – | Steel plate, Steel chest |
| Report `report` | red | automation | Report |
| Transistor `semiconductors` | red, green | report, steel-processing | Silicon, Solar panel |
| Automation 2 `automation-2` | red, green | report, steel-processing | Assembling machine 2 |
| Fluid handling `fluid-handling` | red, green | report | Barrel, Pump, Storage tank |
| Engine `engine` | red, green | report, steel-processing | Engine unit |
| Logistics 2 `logistics-2` | red, green | logistics, report | Fast transport belt, Fast underground belt, Fast splitter |
| Railway `railway` | red, green | engine, logistics-2 | Rail, Train stop, Rail signal, Rail chain signal, Locomotive, Cargo wagon |
| Automobilism `automobilism` | red, green | engine | Car |
| Electric energy distribution 1 `electric-energy-distribution-1` | red, green | report, steel-processing | Medium electric pole, Big electric pole |
| Concrete `concrete` | red, green | report | Concrete, Hazard concrete |
| Landfill `landfill` | red, green | report | Landfill |
| Threshold logic `circuit-network` | red, green | report | Threshold unit, Arithmetic unit, Bias unit, Power switch, Programmable speaker, Display panel |
| Telecommunication `telecommunication` | red, green | report | Drive, Data line, Underground line, Repeater, Data lake |
| Advanced material processing `advanced-material-processing` | red, green | steel-processing, report | Steel furnace |
| Fluid wagon `fluid-wagon` | red, green | railway, fluid-handling, telecommunication | Fluid wagon, Data wagon |
| Coal chemistry `coal-chemistry` | red, green | fluid-handling | Sulfur, Sulfuric acid, Chemical plant |
| Information retrieval `information-retrieval` | red, green | telecommunication, fluid-handling, concrete | Deduplication, Crawler, Data refinery |
| Datasets `datasets` | red, green | information-retrieval | Dataset, Benchmark, Data plant |
| Integrated circuit `integrated-circuits` | red, green | semiconductors, coal-chemistry | Processor, Photolithography |
| Article `article` | red, green | integrated-circuits, datasets, engine | Article |
| Lubricant `lubricant` | red, green, blue | coal-chemistry, article | Lubricant |
| Battery `battery` | red, green, blue | coal-chemistry, article | Battery, Accumulator |
| Explosives `explosives` | red, green, blue | coal-chemistry, article | Explosives |
| Cliff explosives `cliff-explosives` | red, green, blue | explosives | Cliff explosives |
| Accelerator `accelerators` | red, green, blue | article | Accelerator |
| Machine learning `machine-learning` | red, green, blue | article | Checkpoint, Coprocessor 1, Learned controller 1, Trainer |
| Distillation `distillation` | red, green, blue | machine-learning | Distilled controller 1 |
| Electric engine `electric-engine` | red, green, blue | lubricant | Electric engine unit |
| Planning `planning-agents` | red, green, blue | electric-engine, battery, machine-learning | Drone frame, Construction agent, Passive provider chest, Storage chest, Agent hub |
| Advanced material processing 2 `advanced-material-processing-2` | red, green, blue | article, advanced-material-processing | Electric furnace |
| Electric energy distribution 2 `electric-energy-distribution-2` | red, green, blue | article, electric-energy-distribution-1 | Substation |
| Adversarial examples `adversarial-examples` | red, green, blue | article | Adversarial set, Proceedings |
| Quality filtering `quality-filtering` | red, green, blue | article, information-retrieval | Quality filtering, Denoising, Rephrasing |
| Tokenization `tokenization` | red, green, blue | article, datasets | Tokenizer |
| Preprint `preprint` | red, green, blue | tokenization, machine-learning, railway | Preprint |
| Uranium processing `uranium-processing` | red, green, blue | article, concrete | Uranium processing, Centrifuge |
| Nuclear power `nuclear-power` | red, green, blue | uranium-processing | Uranium fuel cell, Fission (reactor), Nuclear reactor, Heat pipe, Heat exchanger, Steam turbine |
| Refined concrete `refined-concrete` | red, green, blue | concrete, article | Refined concrete, Refined hazard concrete |
| Advanced combinators `advanced-combinators` | red, green, blue | circuit-network, article | Selector unit |
| Bulk inserter `bulk-inserter` | red, green, blue | fast-inserter, article | Bulk inserter |
| Learned agents `learned-agents` | red, green, blue | planning-agents, machine-learning | Logistic agent, Active provider chest, Buffer chest, Requester chest |
| Kovarex enrichment process `kovarex` | red, green, blue, purple | nuclear-power, preprint | Nuclear fuel reprocessing, Kovarex enrichment process |
| Automation 3 `automation-3` | red, green, blue, purple | preprint, machine-learning | Assembling machine 3 |
| Interconnect `interconnect` | red, green, blue, purple | preprint, accelerators | Switch |
| Modules 2 `modules-2` | red, green, blue, purple | preprint, accelerators, distillation | Coprocessor 2, Learned controller 2, Distilled controller 2 |
| Logistics 3 `logistics-3` | red, green, blue, purple | preprint, lubricant, logistics-2 | Express transport belt, Express underground belt, Express splitter |
| Racks `racks` | red, green, blue, purple | preprint, battery | Rack |
| Synthetic data `synthetic-data` | red, green, blue, purple | quality-filtering, machine-learning, preprint | Synthetic data |
| Model card `model-card` | red, green, blue, purple | racks, planning-agents, machine-learning | Model card |
| Modules 3 `modules-3` | red, green, blue, purple, yellow | modules-2, model-card | Coprocessor 3, Learned controller 3, Distilled controller 3 |
| Corpora `corpora` | red, green, blue, purple, yellow | model-card, quality-filtering | Corpus |
| Frontier run `frontier-run` | red, green, blue, purple, yellow | corpora, racks, modules-3, interconnect | Post-training payload, Run shard, Launch the run, Researcher, Frontier cluster |

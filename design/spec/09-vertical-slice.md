# 09 — Vertical slice (milestone 1)

*Round 4, R4-ui. Binding: `DECISIONS.md` §15 and §17 (scope), §21 (the implementability rules), §23 (staffing), §24 (heat at the generators), §32 (a compact start), §33 (the salvage), §34–§35 (text and citations). Engine plan: 10 §12 M1. Content is generated from `spec/data` by `tools/render_slice.py` (§1).*

**One-line summary.** Factorio's opening through green science, in a browser, with three things Factorio does not have from minute one: records from a town's archive, Seminars that need staff from a university in range, and a heat field you can see. 23 technologies, 1,535 Memos and 1,285 Reports of research, done in two and a half to three and a half hours by a Factorio veteran. The item, recipe and building counts are §1's.

---

## 0. Definition

- **Milestone 1 ends** when every technology in the slice is researched. The technology screen then shows 07 §5.1's end-state line, `Research complete. Literature 1969. Technologies beyond the literature: 0.`, the same line the full game shows at its end.
- **"The Report tier"** here means the Report-tier technologies whose content belongs to the slice's systems (§2.5). The rest of the tier needs the data chain, coal chemistry, trains, the circuit network and data lines, or Branch M, which arrive in later milestones (§2.6).
- **Peaceful by construction** (DECISIONS §15). Runaways need deployments, which arrive at Preprint, and the slice contains no deploying, computing or containment entity. Nothing in the slice can fight, be compromised or throttle (S-G9).
- **What the slice proves.**
  1. The hand, the screens and the feel of Factorio in a browser: I's M0 and M1, DECISIONS §17's veteran tools and QoL tools, statistics and the Handbook.
  2. The three new things that exist from minute one, at their real numbers: archives, staffing, heat.
  3. The readouts that carry the theme: the charter, Literature, Field and the citations.
  4. Determinism, saves and performance on 10 §11's reference machine.

### 0.1 M1 reading list

M1 is built from this file, `spec/data` (including `text.yaml`, `tiles.yaml` and `world.yaml`), 07 and 10, plus `round1/I-ui-controls.md`, which 07 §0 makes binding. These sections of the other chapters are normative for M1; the rest of 00–08 is context.

| Need | Where |
|---|---|
| Content: ids, the filter, its numbers | §2 (generated) and `spec/data` |
| Controls, the context resolver, the capture layer, GUIs, the feel tests F1–F28, the `InputAction` list | I in full (I §1–§6, §8.2), as amended by 07 |
| The slice's screens and overlays | 07: every row or section tagged [S]; the untagged 07 sections that §6 below names (§5.1–§5.4 without their after-closure rows, §6.1–§6.2 without the Researcher statuses, §7.1, §12, §13.5, §18, §19); and 07 §23 (icons and sprites) |
| Text: voice, budgets, readouts, statuses, alerts, log lines, citations, names | 08 §0–§1, §4.6–§4.7, §5, §8–§10; `text.yaml` (loading tips, tips and tricks, milestones, town names) |
| Worldgen: terrain, tiles, world objects, the climate compass, patches, towns, archives, exchanges as scenery, the starting area | 01 §2–§7, §9 |
| Staffing | 01 §8.1–§8.5, §8.7 |
| W, Field and Literature | 01 §12.1 |
| Heat: emission, the field, the throttle, the guards, calibration, readouts, Heat off | 03 §1.1–§1.7, §1.9; the reference script `tools/ref/heat_calib3.py` (S-G4) |
| Engine, data stage, tests and performance | 10 §2–§11, §12 M0–M1 |

No other round-1 document is needed. The icon and sprite rules (D §12 in round 1) are 07 §23. A §2's first-hour rule is restated in §7.1. The heat calibration's constants and expected values are in S-G4, and its script is in the repository.

---

## 1. Data and verification

The slice is a **filter over the full data**, never a separate data set (10 §2.4). Its source is four keys of the manifest in §2.7: the technologies, the resources, the scenery and the tiers. `tools/render_slice.py`:
- derives everything else from `spec/data`: the start recipes (Prior art's unlocks), the recipes (everything Prior art and the listed technologies unlock), the items (their closure, plus fluids, resource and world-object yields, the start inventory, the salvage, trigger targets and papers), the entities, the tiles and the world objects;
- runs the derived data set through `tools/validate_spec.py`'s own functions: the technology DAG, coverage, the research playthrough, closures, pack totals and raw costs;
- checks that every listed id exists, that prerequisites stay inside the slice, that no pseudo recipe enters, and that every Memo- or Report-tier technology left out has a reason in §2.6;
- rewrites the output below and all of §2.

`design/round3/impl-data/r3_xref.py` (its section C) checks the manifest independently against the data. Re-run both after any data change. A failing run blocks M1.

<!-- render_slice:verification -->
```
$ gamedev-python tools/render_slice.py
items 55, fluids 2, resources 7, scenery 1, recipes 48, entities 32, technologies 23, tiles 18
research playthrough (validate_spec): 23 techs reachable in 5 waves
papers consumed by research: memo=1,535, report=1,285; Seminar-seconds 40,625
Literature at the end of the slice: 1969; technologies beyond the literature: 0
raw cost of 1 memo: iron-ore 2, records 1
raw cost of 1 report: iron-ore 5.5, copper-ore 1.5
WARN  item uranium-ore: dead end (never consumed, placed, burned, or tagged final)
0 errors, 1 warnings
```
<!-- /render_slice:verification -->

Every ingredient of every slice recipe is a slice item. Every slice recipe is unlocked exactly once. The start set is exactly Prior art's unlocks. The one warning is expected: uranium ore is generated beyond 512 tiles and hand-minable (ISO), and nothing in the slice consumes it.

---

## 2. Content

<!-- render_slice:content -->
### 2.1 Resources, scenery, tiles and world objects

| Id | Name | Yields | In the slice |
|---|---|---|---|
| `iron-ore-patch` | Iron ore | `iron-ore` | Starting patch (01 §4, §9); hand and drills |
| `copper-ore-patch` | Copper ore | `copper-ore` | Starting patch (01 §4, §9) |
| `coal-patch` | Coal | `coal` | Starting patch (01 §4, §9) |
| `quartz-patch` | Quartz | `quartz` | Starting patch (01 §4, §9); rocks also yield quartz |
| `archive` | Archive | `records` | Library stacks at colleges and towns; records stores beyond 512 tiles (01 §6). Mined like ore |
| `water` | Water | `water` | Offshore pump |
| `uranium-ore-patch` | Uranium ore | `uranium-ore` | Generated beyond 512 tiles; nothing in the slice uses the ore |
| `exchange` | Exchange | — | Scenery: generated with towns, tooltip only; no Crawler or Endpoint exists |

**Tiles (18):** concrete, deep-water, dirt, dry-dirt, grass, hazard-concrete, ice, landfill, out-of-map, red-desert, refined-concrete, refined-hazard-concrete, rock-ground, sand, snow, town-block, town-street, water. κ, buildability, walking speed and map colour are `tiles.yaml`'s.

**World objects** (`world.yaml`; generated by worldgen, never built): tree (Tree, yields wood 4); big-rock (Big rock, yields quartz 20); huge-rock (Huge rock, yields quartz 24–50, coal 24–50); big-sand-rock (Big sand rock, yields quartz 19–25); campus (University); exchange-office (Exchange); mine-entrance (Mine entrance). The **Laboratory salvage** is `meta.start.salvage` (§4); town buildings are town-block tiles.

### 2.2 Items and fluids (57)

- **Raw (7):** `wood`, `coal`, `iron-ore`, `copper-ore`, `quartz`, `uranium-ore`, `records`.
- **Fluids (2):** `water`, `steam`.
- **Intermediates (9):** `iron-plate`, `copper-plate`, `steel-plate`, `silicon`, `token`, `iron-gear-wheel`, `iron-stick`, `copper-cable`, `logic-board`.
- **Papers (2):** `memo`, `report`.
- **Tile items (5):** `concrete`, `hazard-concrete`, `refined-concrete`, `refined-hazard-concrete`, `landfill`.
- **Buildings (32):** the items that place the entities of §2.4.

### 2.3 Recipes (48)

| Category | Recipes (time at speed 1) |
|---|---|
| smelting | `iron-plate` 3.2 s, `copper-plate` 3.2 s, `silicon` 3.2 s, `steel-plate` 16 s |
| transcription | `token` 3.2 s |
| crafting | `iron-gear-wheel` 0.5 s, `iron-stick` 0.5 s, `transport-belt` 0.5 s, `burner-inserter` 0.5 s, `wooden-chest` 0.5 s, `iron-chest` 0.5 s, `stone-furnace` 0.5 s, `burner-mining-drill` 2 s, `keypunch` 0.5 s, `pipe` 0.5 s, `pipe-to-ground` 0.5 s, `offshore-pump` 0.5 s, `boiler` 0.5 s, `steam-engine` 0.5 s, `copper-cable` 0.5 s, `logic-board` 0.5 s, `seminar` 2 s, `inserter` 0.5 s, `small-electric-pole` 0.5 s, `memo` 5 s, `report` 6 s, `electric-mining-drill` 2 s, `assembling-machine-1` 0.5 s, `long-handed-inserter` 0.5 s, `steel-chest` 0.5 s, `radar` 0.5 s, `fast-inserter` 0.5 s, `underground-belt` 1 s, `splitter` 1 s, `small-lamp` 0.5 s, `assembling-machine-2` 0.5 s, `steel-furnace` 3 s, `hazard-concrete` 0.25 s, `refined-hazard-concrete` 0.25 s, `landfill` 0.5 s, `fast-transport-belt` 0.5 s, `fast-underground-belt` 2 s, `fast-splitter` 2 s, `solar-panel` 10 s, `medium-electric-pole` 0.5 s, `big-electric-pole` 0.5 s |
| crafting-with-fluid | `concrete` 10 s, `refined-concrete` 15 s |

The start set is Prior art's unlocks (§2.5). No pseudo recipe is in the slice: a boiler turns water into steam natively, 1 : 10 (10 §5.8).

### 2.4 Entities (32)

| Group | Id | Name | Size | Energy | Speed | Modules | Note |
|---|---|---|---|---|---|---|---|
| Extraction | `burner-mining-drill` | Burner mining drill | 2×2 | burner 450 kW | 0.25 | 0 |  |
| Extraction | `electric-mining-drill` | Electric mining drill | 3×3 | electric 90 kW | 0.5 | 3 |  |
| Extraction | `offshore-pump` | Offshore pump | 1×2 | — | — | 0 |  |
| Smelting and transcription | `keypunch` | Keypunch | 2×2 | burner 270 kW | 1 | 0 | A burner data smelter: records → tokens (01 §11) |
| Smelting and transcription | `steel-furnace` | Steel furnace | 2×2 | burner 270 kW | 2 | 0 |  |
| Smelting and transcription | `stone-furnace` | Stone furnace | 2×2 | burner 270 kW | 1 | 0 |  |
| Assembly | `assembling-machine-1` | Assembling machine 1 | 3×3 | electric 75 kW | 0.5 | 0 |  |
| Assembly | `assembling-machine-2` | Assembling machine 2 | 3×3 | electric 150 kW | 0.75 | 2 |  |
| Research | `seminar` | Seminar | 3×3 | electric 60 kW | 1 | 2 | Plus the staff slot (DECISIONS §7), drawn and dimmed; no Researcher exists in the slice |
| Power | `big-electric-pole` | Big electric pole | 2×2 | — | — | 0 |  |
| Power | `boiler` | Boiler | 3×2 | burner 5,400 kW | — | 0 | 1 water → 10 steam (10 §5.8); emits no heat itself (DECISIONS §24) |
| Power | `medium-electric-pole` | Medium electric pole | 1×1 | — | — | 0 |  |
| Power | `small-electric-pole` | Small electric pole | 1×1 | — | — | 0 |  |
| Power | `solar-panel` | Solar panel | 3×3 | — | — | 0 | Output × sunlight s(y) × daylight (01 §3) |
| Power | `steam-engine` | Steam engine | 3×5 | — | — | 0 | Emits 2 × its current output as heat (DECISIONS §24) |
| Belts | `fast-splitter` | Fast splitter | 2×1 | — | — | 0 |  |
| Belts | `fast-transport-belt` | Fast transport belt | 1×1 | — | — | 0 |  |
| Belts | `fast-underground-belt` | Fast underground belt | 1×1 | — | — | 0 |  |
| Belts | `splitter` | Splitter | 2×1 | — | — | 0 |  |
| Belts | `transport-belt` | Transport belt | 1×1 | — | — | 0 |  |
| Belts | `underground-belt` | Underground belt | 1×1 | — | — | 0 |  |
| Inserters | `burner-inserter` | Burner inserter | 1×1 | burner 150 kJ per move | — | 0 |  |
| Inserters | `fast-inserter` | Fast inserter | 1×1 | electric 46 kW | — | 0 |  |
| Inserters | `inserter` | Inserter | 1×1 | electric 13.2 kW | — | 0 |  |
| Inserters | `long-handed-inserter` | Long-handed inserter | 1×1 | electric 20 kW | — | 0 |  |
| Storage | `iron-chest` | Iron chest | 1×1 | — | — | 0 |  |
| Storage | `steel-chest` | Steel chest | 1×1 | — | — | 0 |  |
| Storage | `wooden-chest` | File drawer | 1×1 | — | — | 0 | Displayed as File drawer |
| Fluids | `pipe` | Pipe | 1×1 | — | — | 0 |  |
| Fluids | `pipe-to-ground` | Pipe to ground | 1×1 | — | — | 0 |  |
| Other | `radar` | Radar | 3×3 | electric 300 kW | — | 0 | One more comes in the salvage crate (§4) |
| Other | `small-lamp` | Lamp | 1×1 | electric 5 kW | — | 0 |  |

### 2.5 Technologies (23, plus the start node)

Costs are the data's, which are Factorio 2.0's for every mirrored technology. "M" = Memo, "M+R" = Memo and Report. Effect lines are `meta.effects`' templates (08 §5.4). The citation column is 08 §9.1's short form, or the regime of a technology that cites nothing.

| Id | Name | Mirrors | Prerequisites | Cost | Unlocks or effect | Citation |
|---|---|---|---|---|---|---|
| `prior-art` | Prior art | new | — | Researched at start | `iron-plate`, `copper-plate`, `silicon`, `token`, `iron-gear-wheel`, `iron-stick`, `transport-belt`, `burner-inserter`, `wooden-chest`, `iron-chest`, `stone-furnace`, `burner-mining-drill`, `keypunch` | — (infrastructure) |
| `steam-power` | Steam power | steam-power | — | Trigger: craft 50 `iron-plate` | `pipe`, `pipe-to-ground`, `offshore-pump`, `boiler`, `steam-engine` | — (infrastructure) |
| `switching-circuits` | Switching circuits | electronics | — | Trigger: craft 10 `copper-plate` | `copper-cable`, `logic-board`, `seminar`, `inserter`, `small-electric-pole` | Shannon, 1938 |
| `basic-research` ★ | Basic research | automation-science-pack | steam-power, switching-circuits | Trigger: craft 1 `seminar` | `memo` | Bush, 1945 |
| `learning-curve` | Learning curve | steel-axe | steel-processing | Trigger: craft 50 `steel-plate` | Hand mining speed +100% | Wright, 1936 |
| `linear-programming` ★ | Linear programming | logistic-science-pack | basic-research | 75 × M · 5 s | `report` | Kantorovich, 1939; Dantzig, 1949 |
| `artificial-intelligence` | Artificial intelligence | new | basic-research | 10 × M · 60 s | No effect | McCarthy, Minsky, Rochester & Shannon, 1955 |
| `electric-mining-drill` | Electric mining drill | electric-mining-drill | basic-research | 25 × M · 10 s | `electric-mining-drill` | — (infrastructure) |
| `tabulation` | Tabulation | automation | basic-research | 10 × M · 10 s | `assembling-machine-1`, `long-handed-inserter` | Hollerith, 1889 |
| `steel-processing` | Steel processing | steel-processing | basic-research | 50 × M · 5 s | `steel-plate`, `steel-chest` | — (infrastructure) |
| `radar` | Radar | radar | basic-research | 20 × M · 10 s | `radar` | — (infrastructure) |
| `servomechanisms` | Servomechanisms | fast-inserter | basic-research | 30 × M · 15 s | `fast-inserter` | Hazen, 1934 |
| `logistics` | Logistics | logistics | basic-research | 20 × M · 15 s | `underground-belt`, `splitter` | — (infrastructure) |
| `lamp` | Lamp | lamp | basic-research | 10 × M · 15 s | `small-lamp` | — (infrastructure) |
| `stored-program` | Stored program | automation-2 | tabulation, steel-processing, linear-programming | 40 × M+R · 15 s | `assembling-machine-2` | von Neumann, 1945 |
| `regenerative-furnace` | Regenerative furnace | advanced-material-processing | steel-processing, linear-programming | 75 × M+R · 30 s | `steel-furnace` | — (infrastructure) |
| `concrete` | Concrete | concrete | regenerative-furnace, stored-program | 250 × M+R · 30 s | `concrete`, `hazard-concrete`, `refined-concrete`, `refined-hazard-concrete` | — (infrastructure) |
| `landfill` | Landfill | landfill | linear-programming | 50 × M+R · 30 s | `landfill` | — (infrastructure) |
| `logistics-2` | Logistics 2 | logistics-2 | logistics, linear-programming | 200 × M+R · 30 s | `fast-transport-belt`, `fast-underground-belt`, `fast-splitter` | — (infrastructure) |
| `photovoltaics` | Photovoltaics | solar-energy | steel-processing, linear-programming | 250 × M+R · 30 s | `solar-panel` | Chapin, Fuller & Pearson, 1954 |
| `rural-electrification` | Rural electrification | electric-energy-distribution-1 | steel-processing, linear-programming | 120 × M+R · 30 s | `medium-electric-pole`, `big-electric-pole` | — (infrastructure) |
| `citation-index` | Citation index | research-speed-1 | stored-program | 100 × M+R · 30 s | Seminar speed +20% | Garfield, 1955 |
| `expert-systems` | Expert systems | new | artificial-intelligence, linear-programming | 100 × M+R · 30 s | Hand-crafting speed +100%; Does not apply to machines | Buchanan, Sutherland & Feigenbaum, 1969 |
| `memex` | Memex | toolbelt | linear-programming | 100 × M+R · 30 s | Inventory +10 slots | Bush, 1945 |

**Totals.** 40,625 Seminar-seconds; 1,535 Memos; 1,285 Reports. Regimes: 12 cited, 11 infrastructure, 0 beyond the literature. The latest citation is 1969 (Expert systems), the Literature at the end of the slice.

### 2.6 Out of the slice, and why

| Memo- and Report-tier technologies | Reason |
|---|---|
| *Maintenance* | Repair packs have nothing to repair: no damage source exists in the slice |
| *Engine*, *Disk storage*, *Fluid handling* | No consumer in the slice; pumps and tanks need the engine |
| *Railway*, *Semaphores*, *Automobile*, *Fluid wagon* | Trains and vehicles: I's M4 UI, 10 §12 M2 |
| *Cybernetics*, *Packet switching*, *Time-sharing* | The circuit network and data lines (I's M3 UI, 10 §12 M2); Time-sharing's Terminal needs data lines, so Time-sharing leaves with them. R stays 48 in the slice |
| *Crawling*, *Text categorization*, *Cross-validation*, *Sulfur processing*, *Integrated circuit*, *Information theory*, *Explosives*, *Batteries*, *Accumulators*, *Batch processing*, *Batch size 1*, *Batch size 2*, *Mining productivity 1*, *Statistical learning*, *Hypothesis testing*, *Perceptron* | The data chain (with the Trainer and checkpoints), coal chemistry and chips: the next milestone (10 §12 M2) |
| *Cliff explosives* | Cliff explosives need *Terminal ballistics* (Branch M), so they come with M3 (10 §12) |
| *Pipelining*, *Backpropagation*, *CMOS*, *Rejection sampling* | Modules and quality: later milestones (10 §12 M2, M3) |
| *Wearable computing*, *Portable solar*, *Night vision*, *Belt immunity*, *Personal battery* | Equipment: needs Branch M and integrated circuits |
| *Evaporative cooling* | Cooling: nothing throttles in the slice (§11 #1) |
| *Ballistics*, *Protective clothing*, *Fire control*, *Fences*, *Gates*, *Terminal ballistics*, *Game theory*, *Projectile damage 1*, *Projectile damage 2*, *Rate of fire 1*, *Rate of fire 2*, *Explosive yield 1* | Branch M: peaceful by construction, no weapons (DECISIONS §3) |

### 2.7 Slice manifest

The build filter of 10 §2.4. Source keys: `technologies`, `resources`, `scenery` and `tiers`. Every other key is derived by `tools/render_slice.py`; never edit it by hand.

```yaml
slice:
  technologies: [steam-power, switching-circuits, basic-research, learning-curve, linear-programming, artificial-intelligence, electric-mining-drill, tabulation, steel-processing, radar, servomechanisms, logistics, lamp, stored-program, regenerative-furnace, concrete, landfill, logistics-2, photovoltaics, rural-electrification, citation-index, expert-systems, memex]
  start_recipes: [iron-plate, copper-plate, silicon, token, iron-gear-wheel, iron-stick, transport-belt, burner-inserter, wooden-chest, iron-chest, stone-furnace, burner-mining-drill, keypunch]   # = prior-art's unlocks
  recipes: unlocked   # every recipe unlocked by prior-art or a listed technology (48)
  items: [assembling-machine-1, assembling-machine-2, big-electric-pole, boiler, burner-inserter, burner-mining-drill, coal, concrete, copper-cable, copper-ore, copper-plate, electric-mining-drill, fast-inserter, fast-splitter, fast-transport-belt, fast-underground-belt, hazard-concrete, inserter, iron-chest, iron-gear-wheel, iron-ore, iron-plate, iron-stick, keypunch, landfill, logic-board, long-handed-inserter, medium-electric-pole, memo, offshore-pump, pipe, pipe-to-ground, quartz, radar, records, refined-concrete, refined-hazard-concrete, report, seminar, silicon, small-electric-pole, small-lamp, solar-panel, splitter, steam, steam-engine, steel-chest, steel-furnace, steel-plate, stone-furnace, token, transport-belt, underground-belt, uranium-ore, water, wood, wooden-chest]
  entities: [assembling-machine-1, assembling-machine-2, big-electric-pole, boiler, burner-inserter, burner-mining-drill, electric-mining-drill, fast-inserter, fast-splitter, fast-transport-belt, fast-underground-belt, inserter, iron-chest, keypunch, long-handed-inserter, medium-electric-pole, offshore-pump, pipe, pipe-to-ground, radar, seminar, small-electric-pole, small-lamp, solar-panel, splitter, steam-engine, steel-chest, steel-furnace, stone-furnace, transport-belt, underground-belt, wooden-chest]
  tiles: [concrete, deep-water, dirt, dry-dirt, grass, hazard-concrete, ice, landfill, out-of-map, red-desert, refined-concrete, refined-hazard-concrete, rock-ground, sand, snow, town-block, town-street, water]
  world_objects: [tree, big-rock, huge-rock, big-sand-rock, campus, exchange-office, mine-entrance]   # world.yaml; generated, hand-mined or clicked
  resources: [iron-ore-patch, copper-ore-patch, coal-patch, quartz-patch, archive, water, uranium-ore-patch]
  scenery: [exchange]   # generated with towns, tooltip only; exempt from closure
  tiers: [memo, report]
```
<!-- /render_slice:content -->

**Literature in the slice** runs from 1938 (*Switching circuits*, about minute five, when the header reads "7 years behind" the 1945 field) to 1969 (*Expert systems*, cited to DENDRAL). By hour three the Field has gained about 6 field-years from time and 12 from publication: the Site's papers raise Y_pub from 1945 to 1969, at β = 0.5 (01 §12.1). A finished slice therefore reads about "6 years ahead" (Field ≈ 1963). *Tabulation*'s 1889 never shows as Literature, because *Basic research*'s 1945 always precedes it, and it never adds to W, because Y_pub starts at 1945 (S-G6).

---

## 3. Systems in and out

| System | In the slice | Notes |
|---|---|---|
| Character: walk, reach, hand-craft, hand-mine (archives and the salvage included) | **In** | I §3; no weapons (07 §1) |
| **Veteran tools** (DECISIONS §17): smart belt dragging, fast-replace, copy and paste of entity settings, undo and redo, with the ghosts that undo creates | **In** | I §3.4, §3.10, §3.11; 10 §12 M1a; feel tests F1–F3, F7, F13, F16, F17, F24 |
| **QoL tools** (DECISIONS §17): rate calculator (Alt+X), status lights, trimmed collision (walking between buildings), the milestone log | **In** | 07 §15, §16 |
| Belts (yellow and red, undergrounds, splitters), inserters (burner, electric, long-handed, fast) | **In** | ISO |
| Assembling machines 1–2, stone and steel furnaces | **In** | ISO |
| Keypunch and the `token` chain | **In** | A burner data smelter: records → tokens |
| Mining (burner and electric drills) | **In** | ISO; archives mine like ore |
| Steam power: offshore pump, boiler, steam engine | **In** | ISO flows. A boiler makes 10 steam per water (10 §5.8); fuel values and burner draws are ×3 (DECISIONS §18); heat is emitted at the engines (DECISIONS §24) |
| Solar panels and the climate compass's sunlight factor | **In** | 01 §3; daytime only (no accumulators) |
| Electric network (small, medium and big poles) | **In** | ISO |
| Fluids: water and steam; water into Assembling machine 2 for concrete | **In** | ISO |
| Radar and charting; lamps; day and night | **In** | ISO |
| **Seminars and staffing** | **In** | 01 §8: coverage, T(W), the demand rule, networks, satisfaction. The Terminal is not in the slice (§2.6) |
| **Heat field** | **In** | 03 §1: emission, diffusion, Newton cooling toward ambient θ, tree leaf loss above 45 °C. The throttle code exists and is tested on a dev entity (S-G10); no slice entity computes |
| **Climate compass** | **In** | 01 §3 |
| **World numbers** | **In: W only** | W advances by time and publication. j is constant at 0.30 and not shown; σ = 0; no leak |
| Research: triggers, the queue of 7, Literature and Field readouts, citations (short form in tooltips, the References block in the detail panel and the Handbook, credits) | **In** | I §4.9; 07 §5, §12, §13.5; the data's structured citations (DECISIONS §35) |
| **Map generation with towns and archives** | **In** | 01 §2–§9. Exchanges and records stores are generated; records stores are mineable archives |
| Charter | **In** | 07 §14 |
| Data chain (crawlers, refinery, data lines), coal chemistry, modules and Switches, trains, vehicles, the circuit network, agents, blueprints and planners, quality | **Out** | Later milestones (10 §12) |
| Runaways, leak, containment, Branch M, Proceedings | **Out** | Peaceful by construction |
| Cooling tower, liquid cooling | **Out** | Nothing to cool (§11 #1) |
| Takeoff, run report, achievements | **Out** | A dev preview of the report only (§9) |

---

## 4. Map generation in the slice

01 §2–§9 in full: terrain and biomes, the climate compass, the starting patches, towns on the 256-tile grid, archives at towns and records stores beyond 512 tiles, exchanges (scenery), uranium beyond 512 tiles, and 01 §9's guarantees for the starting area. In short (01 §9 is authoritative):

- **The starting college town** (24 × 24). Its campus sits on the footprint edge facing spawn, 16–32 tiles from spawn with a lateral offset of at most 16 tiles, so spawn and the whole footprint lie inside the campus's coverage square (R = 48). That square holds at least 7,500 buildable tiles, including a 40 × 40 buildable square.
- **A compact start** (DECISIONS §32). The four starting patches (iron, copper, coal and quartz, whole blobs) and the starting archive lie inside the same coverage square, at least 2 tiles from the footprint, 6 from each other and 3 from spawn. The opening is one site, as Factorio's is (S-G16).
- **Its archive** holds exactly 80,000 records. **Its university** is a college with T₀ = 12 (DECISIONS §23).
- A lake of at least 400 tiles within 128 tiles of spawn (spawn lies inside the coverage square, so the lake is always within 128 tiles of it); a forest of at least 200 trees within 64 tiles; θ at spawn 11–17 °C; no cliffs within 32 tiles.
- **The Laboratory salvage** within 16 tiles of spawn (`meta.start.salvage`, DECISIONS §33): six wreck pieces of 5 iron plates each, and a crate holding 1 radar, 10 logic boards and 20 copper cables. Each piece and the crate are hand-mined.
- **The starting inventory** is `meta.start.inventory`: a burner mining drill, a stone furnace and 8 iron plates. No weapon.

**Slice records budget.** 1,535 Memos need 1,535 records. The starting archive holds 80,000, 52 times the slice's need. It runs out around the Model card tier (01 §6.4), not in the slice.

---

## 5. Numbers in the slice

All from 01 unless noted. They are listed here so the slice build can be checked against them.

Tests quote W, not hours: W depends on how fast the player researches. A competent player reaches W ≈ 7 at one hour and ends the slice near W ≈ 18; E's slower pace gives W ≈ 9 at one hour.

| Quantity | Rule | At W = 7 | At W = 18 (slice end) |
|---|---|---|---|
| W (field-years) | v₀ = 2.0 per hour, plus publication: β = 0.5 field-years per year that Y_pub rises, released evenly over 600 s; Y_pub starts at 1945 (01 §12.1) | Field 1952 | Field 1963 |
| Starting college supply | T = T₀ × min(2, 1 + 0.08·W), T₀ = 12 (01 §8.1); the ceiling, 24, from W = 12.5 | 18.7 | 24.0 |
| Coverage | The campus's 8 × 8 tiles expanded by R = 48 on every side (Chebyshev); a Seminar is covered when its centre is inside (01 §8.2) | — | — |
| Demand | Per Seminar: its working share of the last 60 ticks × max(0.2, 1 + module speed + Switch speed). Lab-speed research is free (01 §8.3). The slice has no modules and no Switches, so a Seminar that works all the time demands exactly 1 | 10 for ten Seminars | 1 per Seminar |
| Satisfaction | min(1, supply ÷ demand) per network, every 60 ticks; displayed rounded half up (01 §8.4) | 100% for ten Seminars | 100% up to 24 Seminars; 80% for 30 |
| Junk share j | 0.30, constant, not displayed | — | — |
| Synthetic share σ | 0, not displayed | — | — |
| Ambient θ | clamp(14 + y/80 + n, −15, 35) °C, with n simplex noise of ±3 K at a 512-tile wavelength (01 §3) | — | — |
| Heat field | 03 §1.2: emission; diffusion of 2% of H to each neighbour every 64 ticks while H ≥ 15 MJ; Newton loss κ·H + 2 kW with κ per tile (`tiles.yaml`) plus 0.000025 s⁻¹ per healthy tree; C = 20 MJ/K per chunk; tree leaf loss above 45 °C | — | — |

**What staffing does in the slice.** From the first Seminar, the cap is a number on screen: the Seminar GUI, its tooltip, the University window and the coverage overlay all show supply, demand and satisfaction (01 §8.7; S-G17). A ten-Seminar block next to the starting college runs at 100% in hour one with nearly half of its supply to spare (18.7 against 10). The supply reaches its ceiling, 24, at W = 12.5 (Field 1957, about 1.5 h), so the cap binds in the slice only for a player who keeps more than 24 Seminars working; such a player sees "Understaffed" and has the three levers of 07 §7.2: Seminars near another university, *Citation index* (lab-speed research raises output per staffed Seminar and costs no staff), or, before the ceiling, waiting for the field. For a competent player with no claim the cap binds later, briefly in early Article (90%; 01 §8.8, DECISIONS §23b).

**What heat does in the slice.** The field is visible from minute one: ambient on the map before anything is built; warm spots at the steam engines once they run (a 10-boiler plant's 20 engines reach about 40 °C in a temperate start; S-G4); tree leaf loss near hot plants in warm biomes; concrete and towns as small heat islands. It changes no production number. It teaches the map that will matter once the data chain's computing machines arrive, late in the Report tier (03 §1.3).

---

## 6. UI subset

DECISIONS §15 and §17: I's M0 and M1; from I's M2 the veteran tools (2.1–2.4), production statistics (2.7), the Handbook (2.8) and the read-only part of the chart (2.6); and DECISIONS §17's QoL tools. Everything game-specific that the slice's systems need is added; each addition is tagged [S] in 07. 10 §12 sizes the whole slice at 38–48 agent-days (M1a logistics core, M1b power, machines, research and world, M1c content, art and audio).

| From I | Items | 10 §12 |
|---|---|---|
| M0 | 0.1–0.9: action map and capture layer, camera, hover and reach, cursor stack, build preview, drag-build (axis lock, belts lock-to-line, pole spacing, underground pairing), hand mining, quickbar, dev overlays | M0, M1a |
| M1 | 1.1–1.9: character screen and crafting, chain crafting and the queue, transfers, entity GUIs (chest, furnace, Keypunch as furnace, drills, assembler with recipe chooser, inserter, Seminar, boiler, steam engine, offshore pump, network bars), tooltips, statuses and warning icons, alt-mode, technology screen, Esc menu, saves, main menu, Controls settings | M1a, M1b |
| M2 2.1–2.4 | Smart belt dragging (R-bend, auto-undergrounds, "Too far to connect", early poles); fast-replace for all groups; copy and paste of entity settings with sweep; undo and redo, with the ghost left by undoing a removal (07 §1) | M1a |
| M2 2.7 | Production statistics: Items (with the Papers pseudo-item), Fluids, Buildings, **Heat** | M1b |
| M2 2.8 | Handbook (Factoriopedia): merged entries, Used in, Unlocked by, Made in, accepted fuel, its own back and forward history, Alt+click everywhere | M1b |
| M2 2.6, read-only part | Chart renderer, zoom-out transition, overlay toggle grid, minimap, map labels for towns. Not: remote building or configuring, tags, pins, search | M1b |

| Game-specific ([S] in 07) | Items |
|---|---|
| Overlays | Heat: map toggle, minimap in alt-mode, legend, chunk tooltip (07 §3.2). Staffing: contextual tint while holding a Seminar, hover highlights, warning icons, map toggle (07 §3.3) |
| World | World strip (Field only), World window (Field graph, Charter button), `/world` (07 §4) |
| Research | The Literature, Field and gap header; the research tooltip with Papers per minute, the Literature line and Staff-limited; queue bylines; definitions, generated effect lines, notes and short citations in tooltips; the References block in the detail panel (07 §5) |
| Seminar and staffing | The Seminar GUI with its staffing line and the dimmed staff slot; the University window's top bars and levers; town, campus, archive and exchange tooltips; the ambient line on ground tiles (07 §6–§7) |
| Handbook additions | Town, University, Library, Records store, Exchange and Laboratory salvage pages; the Notes block with references (07 §12) |
| Start and end | Charter (07 §14); the end-state line; credits as references (07 §13.5) |
| Milestones | Message-log lines and `/milestones` (07 §15; `text.yaml`) |
| QoL (DECISIONS §17) | Rate calculator with Alt+X, status lights, trimmed collision (07 §16) |
| Help | Tips and tricks reduced to `text.yaml`'s four entries (a text and a still image; no simulations); the loading screen with tips filtered by `requires` |
| New game | Seed; presets Default, Sandbox, Rich resources and Island; Resources and Terrain tabs; Heat on/off (07 §17) |
| Browser | Saves in IndexedDB or OPFS, autosave, export and import, the run history (07 §19.2's per-browser store, renamed by R5-gate D4), the two-tab lock, pause and autosave on a hidden tab, the persistence notice; master, music and effects volume (07 §19–§20) |

**Left for M1.5** (10 §12; its exit is all of F1–F28): ghost building by hand (Shift+LMB) and filling ghosts; full remote view (remote GUIs, the ghost cursor, mining as a deconstruction mark); pins, tags and map search; quickbar pages and the copper-wire tool; browse history (Alt+←/→); number fields with math; the chest limit bar; the splitter GUI; electric-network graphs; even distribution; graphics settings beyond I's defaults.

---

## 7. Acceptance tests

### 7.1 Pacing: the first hour as short as vanilla's

**The rule** (A §2, restated so that M1 needs no round-1 document): the first hour stays as short as Factorio's. A mechanic that lengthens it must earn the minutes in fun, and a first-hour failure in the comparison playtest blocks the slice's release.

**Structural checks (data, automated):**

| # | Check |
|---|---|
| P-1 | No burner-only intermediate exists, and nothing the burner phase builds is useless before the Article tier (the Keypunch serves until the Tokenizer) |
| P-2 | The Memo chain adds exactly one raw resource (records) and one building (Keypunch) to Factorio's red-science chain; everything else is ISO |
| P-3 | `tools/render_slice.py` reports 0 errors: every technology reachable; totals 1,535 Memos, 1,285 Reports and 40,625 Seminar-seconds |
| P-4 | The trigger technologies are Factorio 2.0's: Steam power on 50 iron plates, Switching circuits on 10 copper plates, Basic research on one Seminar |

**Scripted opening (deterministic regression test).** A veteran's opening, recorded once as input actions on a fixed seed (Playwright through the real input layer, I §6), then replayed on every build. The game time at each milestone must meet its target and must not regress by more than 5% between builds:

| Milestone (message-log line or event) | Target game time |
|---|---|
| First burner drill mining iron | ≤ 1:30 |
| Switching circuits (10 copper plates) | ≤ 6:00 |
| Steam power (50 iron plates) | ≤ 8:00 |
| First Keypunch transcribing records | ≤ 8:00 |
| First Seminar crafted (Basic research) | ≤ 12:00 |
| First Memo | ≤ 12:00 |
| Electricity reaches a Seminar inside coverage | ≤ 15:00 |
| First technology researched | ≤ 16:00 |
| Tabulation (Assembling machine 1) | ≤ 20:00 |
| Memos made by assemblers fed by inserters | ≤ 40:00 |
| Linear programming | ≤ 45:00 |
| First Report | ≤ 55:00 |
| Reports made by assemblers fed by inserters | ≤ 1:15:00 |
| All 23 technologies | ≤ 3:15:00 |

**Factorio comparison (human playtest).** The user plays the slice and, on the same day, Factorio 2.0 on default settings with enemies off, recording the same milestones. The Factorio equivalents are: first lab running, automation researched, red and green science automated, and the 21 mirrored technologies researched (research speed 1 included). Pass: the slice is no more than 10% slower at every milestone in the first hour, and no more than 15% slower at the end.

### 7.2 Feel tests from I §6

**In the slice:** F1–F25, F27 and F28. F1–F3, F7, F13, F16, F17 and F24 test DECISIONS §17's veteran tools. F15's second half (the ghost cursor when the setting is on) moves to M1.5 with the ghost cursor. F25 runs on the read-only chart: Tab opens the chart, zooming out reaches the chart, zooming in returns, Tab returns to the character at the same zoom.

**Left for M1.5:** F26 (remote GUIs).

### 7.3 Game-specific tests

| # | Test | Pass |
|---|---|---|
| S-G1 | **Map guarantees** over 1,000 seeds (01 §4, §9) | Every guarantee of 01 §9 holds on every seed, the compact start included (S-G16); the same seed yields identical chunk hashes in two runs |
| S-G2 | **Archive and Keypunch** | A burner drill on the archive outputs records; a Keypunch makes a token every 3.2 s at speed 1 with fuel; hand-mining the archive gives records; a Memo is hand-craftable from a token and a gear |
| S-G3 | **Staffing** (01 §8) | A Seminar inside coverage with demand ≤ supply researches at full speed. Outside every coverage: "No staff" and zero progress. With supply S and working Seminars whose demand sums to D > S: "Understaffed: p%" with p = 100·S/D rounded half up, and progress exactly S/D × base. Example: at W = 9 the starting college supplies 12 × 1.72 = 20.64; twenty-five Seminars working all the time read "Understaffed: 83%" and research at 0.8256 × base. *Citation index* changes their speed and not their demand. Idle Seminars add no demand. A change shows within 60 ticks. UI-G4, UI-G5, UI-G6 |
| S-G4 | **Heat field** against `tools/ref/heat_calib3.py` | The script's "early" case, run in the engine. A 64 × 64-chunk map of grass (κ 0.005 s⁻¹), ambient 15 °C everywhere, C = 20 MJ/K, Δt = 64/60 s, diffusion 2% to each neighbour above 15 MJ, loss κH + 2 kW. Sources (chunk coordinates as in the script, x east, y south): 18 MW into each of the two plant chunks (28, 32) and (29, 32) (the 20 steam engines of 10 boilers at full load, 2 × 18 MW, DECISIONS §24) and 2 MW into each chunk of the 3 × 3 block x 31–33, y 30–32, one empty chunk east of the plant (18 MW of consumers). After 30 game-minutes the field is steady. Expected over ambient: the plant chunks (28, 32) +24.7 K and (29, 32) +25.4 K; the empty chunk between them and the block, (30, 32), +13.0 K; the block's corner nearest the plant, (31, 32), +10.1 K (the script's "computer next to plant"); the block's centre (32, 31) +9.0 K. Every chunk is within **0.5 K** of the script. The Heat statistics tab balances against the field (UI-G9). With Heat off, no field runs and no heat UI appears (UI-G3) |
| S-G5 | **Climate compass** | θ at sample chunks equals 01 §3's formula; solar output equals 60 kW × s(y) × daylight |
| S-G6 | **Readouts** | UI-G7. With no research, Field advances 2.0 field-years per game hour. Researching *Tabulation* (1889) adds nothing to W (Y_pub starts at 1945). Researching *Expert systems* (1969) after a Literature of 1955 adds exactly 7 field-years, released evenly over the next 600 s |
| S-G7 | **Charter** | UI-G11; the World window's Charter button shows the same text |
| S-G8 | **Handbook** | UI-G20. Alt+LMB on a town, a campus, the archive, an exchange and the salvage opens their pages; the salvage page's note reads "Surplus from a wartime laboratory." and the radar's tooltip carries no description |
| S-G9 | **Peaceful by construction** | No slice entity has a thermal class, deploys or contains. Over the scripted run plus two hours idle, the throttle, leak, compromise and runaway counters stay at zero, and only Factorio's own alert types exist |
| S-G10 | **Throttle path** | A dev-only computing test entity with T\* = 40 °C in a 46 °C chunk runs at exactly 1 − 6/50 = 88% speed at full power draw, and shows "Throttled by heat" |
| S-G11 | **QoL** | UI-G12, UI-G13, UI-G14 |
| S-G12 | **Saves** | Save and load preserve the state hash (W, Y_pub and its pending releases, milestone times and every timer included; 10 §8.1); export and import round-trip; autosave rotates three slots; UI-G16, UI-G17 |
| S-G13 | **Determinism** | Replaying the scripted opening yields identical state hashes every 600 ticks, twice in Chrome and once in Firefox |
| S-G14 | **Browser capture** | UI-G15; I's capture self-test (Tab, Alt, Alt+letters including Alt+X, Mouse4/5, RMB, MMB, Ctrl+Wheel) passes in Chrome and Firefox |
| S-G15 | **End state** | After the 23rd technology the technology screen reads `Research complete. Literature 1969. Technologies beyond the literature: 0.` The credits list the slice's cited technologies in long form, in research order, then its infrastructure technologies by name |

### 7.4 Hour-one compactness and legibility

| # | Test | Pass |
|---|---|---|
| S-G16 | **A compact start** (DECISIONS §32; worldgen sweep, 1,000 seeds) | On every seed, each of the iron, copper, coal and quartz starting patches and the starting archive satisfies 01 §9's rule for the starting college's coverage. Reported, not gated: the side of the smallest square holding spawn, the campus, the nearest tile of each of those five and of the guaranteed lake (median and 95th percentile) |
| S-G17 | **Staffing is legible from the first Seminar** (scripted opening) | While the first Seminar is in the cursor, every campus in view shows its coverage square. Within 60 ticks of the first Seminar being placed, its GUI's staffing line, its docked tooltip and the University window's top bar show the same supply, demand and satisfaction, and they equal the simulation's values (rounded half up) |
| S-G18 | **The cap is visible before it binds** (scripted opening, 1:00:00) | Ten working Seminars read "Staff 100%" with supply above demand; the research tooltip shows no "Staff-limited" line; the University window lists the supply, the demand and the three levers of 07 §7.2 |
| S-G19 | **Binding is legible** (a scripted variant that adds Seminars until demand exceeds supply) | Every Seminar of the network shows "Understaffed: p%" and the yellow warning icon; the research tooltip shows "Staff-limited (p%)"; the University window shows the same p; p is the simulation's satisfaction rounded half up |

---

## 8. Performance

10 §11 owns the reference machine, the workload and every target. Its slice row is M1's acceptance criterion; this file restates none of it.

---

## 9. Stubbed or deferred

| What | In the slice build |
|---|---|
| Runaways, leak, containment | Absent from the data. The Runaways preset is not shown on the new-game screen. Code paths never entered (S-G9) |
| j and σ | j = 0.30 constant, σ = 0; neither shown |
| Exchanges | Generated with towns, with tooltips; no Crawler or Endpoint exists |
| Records stores | Generated beyond 512 tiles and mineable: they are ordinary archives |
| Throttling | Implemented; exercised only by the dev entity (S-G10) |
| Cooling tower, liquid cooling | Not in the data |
| Staff slot | Drawn and dimmed; the Researcher prototype is absent (its silhouette is an icon asset only) |
| Terminal | Not in the data: *Time-sharing* needs data lines (§2.6) |
| Doubling-time readout, history string | Implemented and unit-tested (UI-G8); never visible, because the loop cannot close |
| Closure panel, run report, race result | The dev command `/dev-run-report` renders them with fixed sample data, for UI review |
| Achievements | Not tracked (I: P2) |
| Credits | Generated references of the slice's cited technologies, then names (S-G15) |
| Tips and tricks | `text.yaml`'s four entries, without simulations |
| Main menu background | A static image |
| Town era skins | The first two of five (W < 15 and 15–35, 01 §5.3); the slice ends near W ≈ 18 |
| Audio | I §3.12's minimum set and one placeholder ambient track |
| Sprites and icons | The data's `sprite` lines under 07 §23's rules; placeholders allowed where an asset is missing, flagged in the Handbook's dev view |

---

## 10. Build order within the slice

| Step | Content | Depends on |
|---|---|---|
| S0 | I's M0 (input, camera, hover, cursor, build, drag, mining, quickbar, dev overlays); the deterministic tick and `__game` hooks | Architecture (10) |
| S1 | World generation: terrain, biomes, climate compass, starting patches, the starting college town (footprint, campus, archive), the salvage; then the town grid with town names unique within 8 cells (01 §5.3, 10 §5.18; R5-gate D1), records stores, exchanges, uranium | S0 |
| S2 | I's M1 entity GUIs, crafting, the technology screen with the triggers and the slice tree; Keypunch and tokens; DECISIONS §17's veteran tools | S0 |
| S3 | Staffing: coverage, networks, satisfaction, statuses, overlay, the Seminar GUI's staffing line, the University window's bars and levers | S1, S2 |
| S4 | Heat: field, emission, diffusion, cooling, tree leaf loss, overlay on the map and minimap, Heat statistics, the dev throttle entity, S-G4; temperatures by 07 §0's precision table (R5-gate D2) | S1, S2 |
| S5 | Chart (read-only), minimap, overlay registry, town labels | S1 |
| S6 | Research readouts and citations, World strip and window, charter, milestones, the end-state line, credits; numbers by 07 §0's precision table (R5-gate D2) | S2 |
| S7 | Production statistics and the Handbook with Notes and References | S2 |
| S8 | Rate calculator, status lights, trimmed collision | S2 |
| S9 | Saves, autosave, export and import, the run history, two-tab lock, hidden-tab pause; main menu, new-game screen, loading tips (every `requires: []` tip, later content included: R5-gate D3, 08 §7), tips and tricks | S0 |
| S10 | The scripted opening, the tests of §7, 10 §11's performance runs, the Factorio comparison playtest | All |

---

## 11. Objections

1. **Nothing throttles in the slice**, so the heat field changes no number in milestone 1. The slice still ships the field, because DECISIONS §15 asks for the overlay from minute one and siting habits form early. *Evaporative cooling* stays out of the slice until something can throttle; its Report-tier place in the full game is right (03 §1.5, guard 3), so no change is requested.

*Resolved since round 2:* the veteran tools are in the slice (DECISIONS §17); a boiler's heat no longer exceeds its fuel (DECISIONS §18, §24); the lake-to-coverage distance and the compact start are 01 §9's guarantees (DECISIONS §32).

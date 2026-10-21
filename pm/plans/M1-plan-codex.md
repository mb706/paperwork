M1 should run as **one main simulation track, with a second agent handling work in separately owned modules**. Budget **about 44 implementation sessions**, plus **9–12 sessions for review fixes and playtest changes**. Generated code and rendered outputs do not count toward the line estimates.

Scope follows [09](/home/mewse/browsergame/design/spec/09-vertical-slice.md), [10](/home/mewse/browsergame/design/spec/10-architecture.md), [07](/home/mewse/browsergame/design/spec/07-ui.md), and [08](/home/mewse/browsergame/design/spec/08-text.md). D1 supplies design data; the packages below consume and implement it.

**Foundations and working rules**

Finish and review C8 and D1 before opening new implementation sessions. Establish a green, tagged M0 baseline; reconcile their reports with STATUS, which contains stale follow-ups—for example, C1c already integrated `sounds.yaml`.

Packages 01–03 establish the shared contracts, lifecycle hooks and GUI roles needed for independent system work. Extend M0’s framework rather than replace it.

Package 01 must:

- Move every M1-consumed field from the data stage’s omitted list into typed binary/JSON output. Include geometry, fluid boxes, staffing, heat, world settings, effects and citations.
- Freeze saved/derived/presentation classifications, canonical ordering, units, masks, projection revisions and migration defaults.
- Agree belt masks with C6 and inserter rest-pose semantics with C4.
- Establish tested development capability subsets. Enable the complete M1 manifest only when implemented; release builds cannot use `--allow-incomplete`.

Keep C1c’s golden ownership. Add focused M1 reference cases and packet fixtures incrementally. Under [IMPL-14](/home/mewse/browsergame/pm/DECISIONS-IMPL.md:60), mechanical bumps change no expected values and require compatibility entries where applicable. Expected-value changes require manager approval first and Codex review. Schema or data changes that alter digests are **value changes**. The sim must never regenerate expectations to validate itself.

**Ordered work packages**

Each system package includes scenario tests, packet/projection integration, affected UI, renderer behavior, asset sources and sound hooks. “Exit” below adds package-specific evidence to that common requirement.

Layers: **R** Rust sim, **W** shell, **V** renderer, **U** UI, **A** assets, **O** audio, **D** data, **T** text. Sizes are handwritten code/tests/model scripts in thousands of lines.

| ID / title / scope | Deliverables and exit criteria | Depends | kLOC / sessions | Layers | Main risk |
|---|---|---|---|---|---|
| **01 Contracts and M1 fixtures** — 10 §15, §8.3 | Generated M1 layouts, prototype fields, compatibility ledger, fake examples, reference fixtures and first migration support. Cross-language codecs and M0 regression pass. | C8, D1 | 4–6 / 2 | R W V U D T | Incorrect expectations |
| **02 Entity lifecycle extensions** — 10 §4.5–4.6, §5.2 | Kind dispatch, slot roles, acceptance rules, topology notifications, wake and production hooks. Creation/removal/save/load conserve state and rebuild derived structures. | 01 | 3–5 / 2 | R W D | Missed invalidation |
| **03 Entity GUI framework** — 10 §7; I §4.6 | Role-driven panels, recipe chooser, fluid/energy gauges, preview holes and status components. Fake fixtures cover each M1 GUI kind and target disappearance. | 01 | 2–3 / 1 | U V W T | Role drift |
| **04 Terrain and resource worldgen** — 09 §4; 10 §5.18 | Biomes, climate, resources, trees, rocks and terrain materials. Deterministic chunks across native/inline/worker generation; climate tests pass. | 02 | 3–5 / 2 | R W V A D | Generation order |
| **05 Hand production and ground items** — 10 §5.1 | Chain crafting, sim-projected craftable counts, reservations, cascade refunds, cancellation spills, pickup/drop and quickbar completion. F10 and conservation cases pass. | 02, 03 | 3–5 / 2 | R U V A O | Refund loss |
| **06 Towns and compact start** — 09 §4; 10 §5.18 | Pure town/campus lookup, names, archives, scenery, salvage and town skins. S-G1/S-G16 pass across 1,000 seeds; institution picking/tooltips work. | 04, 03 | 4–6 / 2 | R W V U A D T | Unbounded naming work |
| **07 Burner production** — 10 §5.5–5.7 | Burner drill, furnace, Keypunch and all chests; fuel, outputs, GUIs, animations and working sounds. G8/S-G2 pass. | 05, 06 | 3–5 / 2 | R V U A O | Fuel-flow fidelity |
| **08 Belts: transport core** — 10 §5.3 | Straight/curved lanes, compression, side-loading, canonical lines/ranks, character carrying, gap packets and retirement. G1/G4/R21 pass through topology edits and reload. | 07 | 4–6 / 2 | R V U A O | Canonical rebuilds |
| **09 Inserters end to end** — 10 §5.4 | Four slice types, target acceptance, burner self-fuelling, hand motion, previews and sounds. G5–G7 and mixed-lane R22 pass. | 08 | 4–6 / 2 | R V U A O | Timing calibration |
| **10 Belt routing and smart dragging** — 10 §5.2–5.3; I §3.4 | Undergrounds, splitters, fast variants, pairing, R-bends and auto-undergrounds. G2/G3 and F1–F3 pass; removal returns every item. | 09 | 4–6 / 2 | R V U A O T | Drag edge cases |
| **11 Electric foundation and daylight** — 10 §5.7 | Pole attachment, auto-wiring, components, buffers and demand classes; solar, lamps and shared daylight. Split/rejoin, brownout and climate-solar tests pass. | 02, 07 | 3–5 / 2 | R V U A O | Network splits |
| **12 Water-to-electricity slice** — 10 §5.7–5.8 | Offshore pump, pipes, undergrounds, segments, boiler and engines. G11, mixing/extent/conservation tests pass; heat hooks emit at generators. | 11 | 4–6 / 2 | R V U A O | Steam accounting |
| **13 Powered production and tiles** — 10 §5.5–5.6 | Electric drills, assemblers 1–2, steel furnace, fluid recipes and placeable tiles. G9/G10/G12 pass; all 48 recipes execute in their permitted producers. | 09, 12 | 2–3 / 1 | R V U A O | Recipe coverage |
| **14 Veteran construction tools** — 10 §5.2; 07 §16 | Fast-replace, settings sweep, undo/redo, undo ghosts and trimmed collision. Inventory/settings/wires survive replacement; specified F-tests and UI-G14 pass. | 10, 11, 13 | 3–5 / 2 | R V U T | Inverse operations |
| **15 Research end to end** — 10 §5.5, §5.12; 07 §5 | Seminars, seven-entry queue, prerequisites, triggers, bonuses, technology UI, citations, completion credits and milestone hooks. G14 and all 23 technology paths pass with test staffing. | 13 | 4–6 / 2 | R W V U A O D T | Unlock deadlocks |
| **16 Staffing and world readouts** — 10 §5.10–5.11; 07 §3–7 | Coverage networks, saved demand windows, W/publication releases, University and World windows, overlay and research readouts. S-G3/G6/G17–19 pass. | 06, 15, 17 | 4–6 / 2 | R V U A T | Demand feedback |
| **17 Chart, minimap and radar** — 10 §5.19, §6.9–6.10 | Chart storage/cache, pristine images, radar, town labels, overlay registry and viewport transitions. F25 passes; caches stay bounded. Include radar animated-shadow pipeline support. | 06, 11 | 4–6 / 2 | R W V U A O T | Cache growth |
| **18 Heat end to end** — 10 §5.9; 07 §3.2, §11 | Emissions, diffusion, sinks, leaves, overlays, Heat statistics and dev throttle entity. S-G4/G15/R15/R28 heat pass; accounting balances. | 12, 16, 17 | 4–6 / 2 | R V U A T | Edge accounting |
| **19 Statistics and rate calculator** — 10 §5.20; 07 §11, §16 | Item/fluid/building graphs, Papers pseudo-item, selection tool and sim-computed rates. UI-G12/G13 pass; current/full-speed rates match production functions. | 13, 15 | 3–5 / 2 | R W V U T | Duplicated arithmetic |
| **20 Handbook and text audit** — 07 §12; 08 §5, §9 | Merged entries, relationships, search/history, world pages, notes and references. Alt-click works; audit C5’s pending labels and remaining renderer notices. | 03, 06 | 2–3 / 1 | U A D T | Text/data drift |
| **21 Browser game flow** — 07 §14, §17–20; 10 §8 | New-game presets/preview, charter, menus, tips/stills, settings, import/export, autosave, Run history, takeover and visibility behavior. S-G7/G12 and UI-G16/G17 pass. | 02, 03 | 3–5 / 2 | W U A T | Storage failures |
| **22 Slice audio production** — 10 §9.4 | Complete remaining SFX/variants, recordings and AAC fallback; reuse C7’s Era I/II engine. Event-map coverage, decode/loop/loudness and preliminary CPU checks pass. | 01 | 2–3 / 1 | O A D | CPU margin |
| **23 Shipping and streaming** — 10 §9.6–9.7 | Lazy screens/groups/greyboxes, hashed assets, cache/update behavior and loading notices. Byte inventory and throttled cold/warm/no-service-worker tests pass. | 15, 20–22 | 3–5 / 2 | W V U A O | Download budget |
| **24 Integrated acceptance** — 09 §7; 10 §10–12 | Complete opening script, replay bundles, browser benchmarks, galleries and human-playtest fixes. Full M1 exit gate passes. | All | 3–5 / 2 | All | Pacing failures |

**Two-agent schedule**

A wave waits for both packages’ reviews and merges. One-session packages leave spare capacity for fixes. Codex reviews every package while implementers are idle, keeping even a strict total-agent interpretation within two.

| Wave | Slot A | Slot B |
|---|---|---|
| 0 | Existing C8 | Existing D1 |
| 1 | 01 | — |
| 2 | 02 | 03 |
| 3 | 04 | 22 |
| 4 | 05 | 06 |
| 5 | 07 | 21 |
| 6 | 08 | 20 |
| 7 | 09 | — |
| 8 | 10 | — |
| 9 | 11 | — |
| 10 | 12 | 17 |
| 11 | 13 | — |
| 12 | 15 | 14 |
| 13 | 16 | 19 |
| 14 | 18 | 23 |
| 15 | 24 | — |

The critical path runs through contracts → lifecycle → production → belts/inserters → electricity/steam → assemblers → research/staffing → heat → acceptance. Idle capacity is deliberate around coupled logistics and power changes.

Parallel pairs require ownership of separate files: worldgen versus hand rules; machine modules versus browser flow; fluids versus chart modules; research versus construction; staffing versus statistics; heat versus loaders. Package 02 establishes system-local dispatch seams. **Shared roots**—`tick.rs`, `project.rs`, `extract.rs`, `renderer.ts`, `scene.ts`, input resolver, app composition, schema/generated files and capability declarations—have one owner per wave; wiring lands serially at merge. Separate worktrees alone do not prevent conflicts.

Assign distinct Playwright ports, preserve asset caches, and serialize heavy rendering and absolute benchmark measurements.

**Art and audio production**

Asset work belongs inside each system’s sessions and estimate. Reuse C6’s rig, layered pipeline, existing character, Keypunch, belt and inserter sources, plus A3 prototypes.

Production order is landscape/resources → towns/salvage → burner machines → logistics → power → assemblers/Seminar/radar. Package 06 adds town-object lighting; 17 adds radar shadows. Cover all **32 entities, 55 item plus two fluid icons, 23 technology icons**, both town skins, world objects, warning glyphs and the UI-only Researcher silhouette. Package 21 supplies the static menu image and four tutorial stills.

Review encoded contact sheets, animations and belt lineups at 16/32 px, day/night and DPR 1/2. Enforce registration, composition, confusability and decision-13 compression floors across shipped formats. Missing art requires an explicit Handbook dev flag.

Package 22 completes roughly **30 SFX/90 files total**, rather than rebuilding C7. System packages connect working-state snapshots and events. Preserve historical silence and failure fallbacks. Lazy-load unavailable entities’ greyboxes to address the reported **5.6 MB first-frame forecast against 5 MB**.

**QA and playtest gates**

Every merge runs affected scenarios, native/WASM checks, relevant input E2E, inspected screenshots and CI. New state participates immediately in save/load, NO_SLEEP, continuation and mirror equivalence; topology packages also compare incremental versus canonical rebuilds.

Human checkpoints:

- **Wave 5:** burner-playable build—mine archives, transcribe tokens, craft, transport manually, save/reload. Test reach, hand behavior and opening compactness.
- **Wave 13:** research-playable build with real staffing; automate Memos/Reports and begin the full-tree pacing run.
- **Wave 15:** complete slice, comparison playtest and real-GPU/audio calibration.

Release requires:

- All 23 technologies; **1,535 Memos, 1,285 Reports, 40,625 Seminar-seconds**; exact Literature-1969 completion line.
- Every 09 §7.1 timing target, including all technologies by **3:15**, with ≤5% scripted regression. Same-day Factorio comparison: ≤10% slower through hour one, ≤15% at completion.
- F1–F25, F27/F28 with specified exclusions; S-G1–S-G19, including peaceful counters through two additional idle hours.
- G1–G12/G14–G16 with §12’s applicable exclusions; required R-scenarios, including test-prototype prerequisites, heat edges and smart belts. G13 remains deferred; M1 segment boundaries remain tested.
- Identical native/Node/Chrome/Firefox traces; complete save/import/export and recovery tests; green M1 manifest.
- `slice-3h`, `worldgen-frontier` and every §11 slice budget: 60 UPS/FPS, tick mean ≤1 ms/p99 ≤2 ms, worker memory ≤150 MB, save ≤5 MB, downloads ≤30 MB, cold/warm start ≤8/3 seconds.
- User-laptop Era I/II offline audio load ≤3.5% average/6.5% worst second, plus real-GPU validation. SwiftShader cannot certify performance.

**Top risks**

Timing fidelity needs early belt/inserter calibration, before larger factories obscure errors. UI breadth needs package-level input tests and strict M1.5 deferrals. Determinism needs saved-state and topology tests from each feature’s first merge. Art/download and audio margins need measured inventories and laptop checks before final QA. Pacing needs early human sessions and reserved rework capacity.

Package 01 must also record an acceptance ruling for conflicting Heat-off wording: 09’s “no heat UI” versus 07’s ambient-only map. Do this before freezing tests.
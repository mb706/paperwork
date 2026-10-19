# R3 — Implementability: can Claude code this without guessing?

*Round 3 critic (Opus), 2026-10-19. Lens: cross-file consistency, undefined behaviour, missing parameters, the vertical slice's self-sufficiency, and gaps between the spec and `10-architecture.md`. I read the whole spec (00–10, `data/*.yaml`, `data/SCHEMA.md`), `DECISIONS.md`, and the round-1 sources where the spec cites them as normative (I, F-data). I did not edit the spec or data.*

**Tools** (in `design/round3/impl-data/`, read-only, rerun after the revision):

| Script | What it checks | Result today |
|---|---|---|
| `r3_xref.py` | A: backtick ids in prose against every YAML id and meta vocabulary. B: kebab tokens inside YAML values. C: the 09 slice manifest against the final data (ids, closure, Prior art, every §2.5 row). D: 08's text placeholders. E: every "NN §X.Y" chapter cross-reference | 4 dangling ids, 13 manifest failures, 2 unresolved placeholders; all 411 section references resolve |
| `r3_checks.py` | 30 literal regression checks, one per cross-file contradiction found below (C01–C30) | 0 pass, 30 fail |

`gamedev-python tools/validate_spec.py design/spec/data` still passes (0 errors, 0 warnings). Its checks are sound but stop at the YAML. Every finding below lies between files, or between the data and what the engine must know.

---

## 0. Verdict

- **The core is codeable.** 10's engine plan is unusually complete: the determinism contract, struct-of-arrays pools, NO_SLEEP equivalence, the golden tests and the bug-bundle loop. The heat field (03 §1.2) is fully numeric, and F's `calib3.py` implements exactly the update order 03 states (I diffed them). Staffing as a power-network analogue is a clean union-find. Every cross-reference between chapters resolves. The slice's research totals reproduce from the data: 1,735 Memos, 1,485 Reports, 46,625 Seminar-seconds.
- **The vertical slice is not buildable from 09 + data + 07 + 10 alone.** 09 was written against round-1 ids and is stale in four ways: two dangling ids, a manifest that fails the data stage's own closure check, a scope that contradicts DECISIONS §17, and a deferred-test list that contradicts 10. It also needs data that exists nowhere: tile prototypes, one canonical salvage list, and the citation regime and long-form references its UI shows. Beyond that, M1 needs round-1 I (normative by 07 §0), D §12 for icon rules and F's `calib3.py` for the heat golden. **4 M1 blockers, all mechanical to fix.**
- **The later milestones are under-specified exactly where the theme adds mechanics:** Research-hall loading, the lifecycle of a compromised machine, rollback delivery, leak accounting, the quality ladder with catalysts, and Research scheduling. **6 later-milestone blockers.** Each comes with an exact proposed rule below.
- **The `meta.yaml` blocks are mostly prose.** SCHEMA and 10 say the engine reads them, but formulas such as T(W), j(W), the leak, the ambient model and the W parameters are English sentences. Either make them numbers or make the prose chapters the declared source of the formulas (J1).

**Counts:** 4 M1 blockers (B), 6 later blockers (L), 24 majors (J), 30 minors (N). §6 catalogues 64 places where an implementer would have to invent a rule (U1–U64), and §7 lists 31 missing parameters (P1–P31).

---

## 1. M1 blockers (fix before coding the slice)

### B1. 09 is stale against the final data, DECISIONS §17 and 10's M1 plan
- **Location.** 09 §1, §2.3, §2.5, §2.7, §6 ("Not in the slice"), §7.2 (deferred F-tests), §11 #1 and #3; 10 §12 M1 and §14 #2.
- **Evidence** (`r3_xref.py` C; `r3_checks.py` C11):
  - The technology `electric-mining` does not exist; the data's id is `electric-mining-drill` (09:113).
  - The recipe `boil-steam` does not exist. 02 §9 #7 removed it, yet 09 §2.3, the manifest's "plus boil-steam" and 10 §14 #2 still use it.
  - *Prior art* in the data also unlocks `silicon` and `iron-stick` (02 §9 #13 is deliberate). 09 puts them under *Photovoltaics* and *Rural electrification*, whose data unlocks no longer include them.
  - *Concrete* in the data unlocks `refined-concrete` and `refined-hazard-concrete` (ISO for 2.0). Neither is in the slice's item list, so 10 §2.4's manifest closure check ("every ingredient, unlock and placed entity is inside the filter") **rejects the manifest**.
  - The resources `exchange` and `uranium-ore-patch` are in the manifest, but their products `crawl` and `uranium-ore` are not. Hand-mining uranium (ISO) would create an item the slice build lacks.
  - 09 §6 says smart belts, fast-replace, copy/paste and undo are not in the slice, and §7.2 defers F1–F3, F7, F13, F16, F17 and F24. DECISIONS §17 and 10 §12 M1a put all of them in, together with the ghosts that undo creates. 09 §11 #1 and #3 argue for changes that have since been adopted (DECISIONS §17, §18).
- **Fix.** Regenerate 09 §2 from the YAML with a script, as 02 and 05 are, and replace the manifest with:

```yaml
slice:
  technologies: [steam-power, switching-circuits, basic-research, learning-curve, linear-programming,
    artificial-intelligence, electric-mining-drill, tabulation, steel-processing, radar, servomechanisms,
    logistics, lamp, stored-program, zone-refining, concrete, landfill, logistics-2, photovoltaics,
    rural-electrification, citation-index, time-sharing, expert-systems, memex]
  start_recipes: from-prior-art        # never restated; the data stage reads prior-art's unlocks
  start_inventory: from-meta-start
  items: [<09's 54>, refined-concrete, refined-hazard-concrete, uranium-ore]   # uranium-ore: hand-mined, no recipe uses it
  recipes: every non-pseudo recipe unlocked by a listed technology or by prior-art
  resources: [iron-ore-patch, copper-ore-patch, coal-patch, quartz-patch, archive, water, trees, uranium-ore-patch]
  scenery: [exchange]                  # generated with towns, tooltip only; exempt from closure; no extractor exists
  tiers: [memo, report]
```

- Rewrite 09 §6's "Not in the slice" paragraph to DECISIONS §17's list. Move F1–F3, F7, F13, F16, F17 and F24 into §7.2's slice tests, and delete §11 #1 and #3.
- Tie §1's verification output to the regenerated manifest, not to a scratchpad script that no longer exists.
- The research totals do not change. I recomputed them from the data: 1,735 / 1,485 / 46,625.

### B2. Two canonical salvage lists, and two names
- **Location.** 01 §9 and 09 §4 against `meta.start.salvage`; 10 §5.18 stage 10. Checks C02 and C03.
- **Evidence.**
  - 01 and 09 specify six wreck pieces of 5 `iron-plate` each (30 in total) and a crate with 1 `radar`, 10 `logic-board` and 20 `copper-cable`.
  - The data has `{iron-plate: 20, iron-gear-wheel: 10, copper-cable: 20, logic-board: 8}`, with no radar and no split between pieces and crate.
  - The radar's tooltip in `entities.yaml` ("Surplus from a wartime laboratory.") presumes the radar *is* in the salvage.
  - Names: the data says "Radar laboratory salvage" and 10 says "Rad Lab salvage", although 00 §9 #12 and 08 §10.4 settled on **Laboratory salvage**.
  - S-G1 tests one of the two lists.
- **Fix.** Adopt 01's list (it carries the radar joke) and make it structured:

```yaml
start:
  salvage:
    name: Laboratory salvage
    within_tiles: 16
    pieces: {count: 6, mining_time: 1, yields: {iron-plate: 5}}
    crate:  {mining_time: 1, yields: {radar: 1, logic-board: 10, copper-cable: 20}}
```

- Change 10's stage 10 to "Laboratory salvage".

### B3. There are no tile prototypes
- **Location.**
  - `data/` has no tile kind, and SCHEMA defines none.
  - `meta.heat.loss.kappa_per_s` is keyed by terrain *class*: water, snow, grass, rock, sand, concrete and landfill.
  - The items `concrete`, `hazard-concrete`, `refined-concrete`, `refined-hazard-concrete` and `landfill` have no `places` field.
  - 10 §4.3, §4.4 and §6.5 and 01 §2 and §5.3 all assume tile ids. Check C04.
- **Problem.** M1 worldgen, the heat field's κ, the renderer's terrain shader, concrete and landfill placement, town streets and walking speed all key off tile ids that nobody defines. 01 §2's biome table names tiles (snow and ice, rock, dirt, grass, dry dirt, red desert, sand). 03 §1.2 gives their κ, but omits ice, dirt, dry dirt, red desert, deep water, refined and hazard concrete, and the town tiles.
- **Fix.** Add `data/tiles.yaml` and a SCHEMA section. Each tile has `id`, `name`, `kappa_per_s`, `buildable`, `walking_speed` (ISO), `map_color`, optional `placed_by` (item id), `minable_back` (bool) and `biome`. Initial list, with κ from 03 §1.2:

| id | κ (s⁻¹) | buildable | walking | placed by | note |
|---|---|---|---|---|---|
| `grass`, `dirt` | 0.005 | yes | 1.0 | — | temperate, boreal |
| `dry-dirt`, `red-desert` | 0.003 | yes | 1.0 | — | steppe (01 §2 says 0.003–0.004; pick 0.003) |
| `sand` | 0.003 | yes | 1.0 | — | desert |
| `snow`, `ice` | 0.0075 | yes | 1.0 | — | tundra; boreal patches |
| `rock-ground` | 0.004 | yes | 1.0 | — | tundra 30% |
| `water`, `deep-water` | 0.020 | no | — | — | offshore pumps and water exchangers |
| `landfill` | 0.0015 | yes | 1.0 | `landfill` | on water only |
| `concrete`, `hazard-concrete` | 0.0015 | yes | ISO (1.4) | same-named items | |
| `refined-concrete`, `refined-hazard-concrete` | 0.0015 | yes | ISO (1.5) | same-named items | |
| `town-street` | 0.0015 | no | 1.0 | — | walkable, drivable |
| `town-block` | 0.0015 | no | — | — | blocks the player and vehicles (01 §5.3) |
| `out-of-map` | — | no | — | — | bounded maps (10 §5.18) |

- Give the five items `places_tile: <id>`. Replace `kappa_per_s` in meta with a pointer to the tile list.

### B4. Citation regime and long-form references are missing, yet the slice shows them
- **Location.**
  - 08 §9.3 requires `regime: cited | infrastructure | beyond` and structured `cite: [{authors, year, title, venue, …}]`.
  - The data has only a `citation` string and `year` (checks C06 and C07).
  - 07 §5.1–§5.2 and 09 §6 put the References block and the end-state line in the slice; 09 §9 puts credits as references there too.
- **Problem.**
  - S-G15 expects "Technologies beyond the literature: 0". Without `regime` the engine cannot tell the 10 uncited infrastructure technologies in the slice (Steam power, Steel processing, Radar …) from "beyond" ones.
  - The References block, the Handbook references and the credits need titles and venues that exist nowhere in the repo. P18 (08 §1.2) forbids inventing them.
  - E's `tree.json` had the regime (L/H/F), but R2-D dropped it. Two technologies changed status in round 2: *Model generation* now cites Moto-oka (1982), which 01 §12.1 says must not count, and *Reversible logic* now cites Bennett (1973).
- **Fix.**
  1. Add `regime` to all 250 technologies: port E's L→infrastructure, H→cited, F→beyond, then set the round-2 additions by hand.
  2. Mark *Model generation* and *Model generation 25* `regime: beyond` with `display_citation: Moto-oka, 1982`. Such a citation shows in the tooltip but never counts toward Literature.
  3. Decide *Reversible logic* (cited or beyond) explicitly.
  4. Add `field_year` to `beyond` technologies (01 §12.1: Model generation L = 2025 + 0.5 × (L − 5); the others 2025).
  5. For M1: either add verified `cite` blocks for the 14 cited slice technologies, or descope the References block and credits from M1 and say so in 09 §6.

---

## 2. Later-milestone blockers (fix before M3/M4)

### L1. The Research hall's load and upgrade model is undefined (M4)
- **Location.** 04 §2.3 and §6 ("upgrades replace the oldest first"); 07 §6.5 ("if R2-D makes it a slot rather than a recipe catalyst"; "flying text per swap"); 10 §5.5; `entities.yaml` `research-hall.extra`; `meta.effects.weight-transplant` (C24).
- **Problem.** None of these say:
  - who may load accelerators (inserters? agents?);
  - whether a hall runs with fewer than 20;
  - what a hall with mixed tiers does, although swapping "per swap" makes mixed tiers the normal state during an upgrade;
  - where swapped-out accelerators go;
  - what the hall shows when unloaded;
  - whether loaded accelerators' quality matters.
- The two definitions of *Weight transplant* also differ. 04: without it, accelerators cannot be swapped. `meta.effects`: "a Research hall keeps its weights when its accelerators change", which implies the weights are lost otherwise.
- **Fix.** These rules, in 04 §2.3, 10 §5.5 and SCHEMA:
  1. A hall has an **accelerator inventory** of 20 single-item slots and a **weights slot** (1). Inserters may insert accelerators of any tier into empty accelerator slots and one `frontier-checkpoint` into an empty weights slot. They never remove either. Construction agents deliver both as item requests (the module-request path). Hand transfer works both ways.
  2. A hall runs only with 20 accelerators and a weights item. Otherwise its status reads **Missing accelerators (n / 20)** or **No weights** (red).
  3. **Mixed tiers:** speed = Σᵢ s(tierᵢ)/20 and power = Σᵢ p(tierᵢ)/20. The GUI's "Tier" label shows the lowest loaded tier.
  4. **Without Weight transplant,** a full accelerator inventory is locked: no insertion and no hand removal. Mining the hall returns everything (04).
  5. **With Weight transplant,** inserting a higher-tier accelerator into a full hall replaces the lowest-tier loaded one (ties: lowest slot index). The replaced one goes to the hall's **output inventory** with the System cards, where inserters can take it. Delete "keeps its weights" from `meta.effects`.
  6. The quality of loaded accelerators is ignored. The hall entity's own quality applies, as for any crafting machine. The weights item's quality sets v (03 §3.1).

### L2. Rollback delivery contradicts the slot rules (M3)
- **Location.** 03 §3.4 ("through the Endpoint's input, the hall's weights, the Seminar's staff slot or the controller's module slot … Inserters (circuit-enabled) and construction agents … can deliver it"), 07 §10.4 and 10 §5.17, against 07 §6.2 ("Accepts: Researcher. Everything else is refused … Inserters do not insert into it"). Module slots accept only modules (ISO). Check C28.
- **Problem.**
  - A Researcher-staffed Seminar cannot receive a frontier checkpoint through its staff slot, and a controller machine cannot receive a checkpoint through a module slot.
  - The hall's weights slot is already full.
  - Rollback for compromised computing machines without controllers (Data refinery, Trainer, Switch, Frontier cluster) has no defined item at all.
- **Fix.** One hidden mechanism:
  - Every susceptible machine has a **rollback input** that exists only while it is compromised and accepts exactly one item of its **rollback type**: `checkpoint` when the infection tier is 1–3, `frontier-checkpoint` when it is 4.
  - It is fed like an ammo slot: by hand, fast transfer, an enabled inserter, or an agent item request.
  - The item is consumed on arrival and the machine is clean at once.
  - No other slot changes its acceptance rules. 07 §10.1's GUI band shows this input outlined.
  - The Endpoint needs no exception: a checkpoint inserted into a compromised Endpoint goes to the rollback input first.

### L3. A compromised machine's lifecycle has gaps that decide whether containment works (M3)
- **Location.** 03 §3.3–§3.4; 07 §10.1–§10.2 and UI-G18; 10 §5.17; 08 §6 #18.
- **Problem.**
  1. **The tripwire depends on an unstated rule.** If the Compromised signal stops when the machine loses power, a switch wired `Compromised > 0` closes again on the next tick, the 30 s never accrue and UI-G18 fails.
  2. Nothing says whether a compromised machine may be **mined, deconstructed, fast-replaced, upgraded or have its modules removed**. Items carry no state (10 §14 #7), so mining it and placing it again would clean it at once. Construction agents could then clean whole clusters by blueprint. That would make power switches, Monitors and rollback pointless.
  3. Whether a compromised machine still **consumes** ingredients or papers is unstated.
  4. "Powered" (for spread and infection) is undefined.
  5. Whether the 30 s counter resets on a brownout tick is undefined.
  6. A spread timer that fires while the machine is unpowered has no defined outcome.
- **Fix** (10 §5.17 and 03 §3.3):
  1. **Compromised = 1** is output on every connected wire while the flag is set, **whether or not the machine has power**.
  2. A compromised entity cannot be mined, deconstructed, fast-replaced, upgraded or emptied of modules, Researchers, accelerators or weights. The reason string is "Compromised. Cut its power first." Deconstruction marks may be placed, and agents skip the entity until it is clean.
  3. While compromised, crafting and research progress is frozen. Nothing is consumed or produced. Inventories keep ISO insertion limits. The machine draws its full *working* power, not its idle drain, and emits it as heat. Its leak share stops accruing.
  4. *Powered* means an electric satisfaction > 0 in the current tick, in the entity's own class.
  5. The zero-power counter counts consecutive ticks at satisfaction 0 and resets on any tick above 0.
  6. Spread timers run from the moment of compromise. A fire while unpowered does nothing, and the timer keeps cycling. Cleaning cancels the timer.

### L4. Leak accounting is inconsistent, and so is the Research hall's tier (M3)
- **Location.** 03 §3.1–§3.2; 10 §5.11 and §5.17; `meta.runaways.leak` and `.model_tier`; 02 Objection 9; `round2/W-sim/leak_est.py`. Check C15.
- **Problem.**
  - 03 keeps L ("accumulated since the last compromise", "L −= 1") and per-building shares ℓᵢ ("reset to 0") as two variables. 10 writes "L = Σℓᵢ". After a compromise, the two readings give different next-compromise times.
  - Nothing covers a building removed from L, or L reaching 1 when every deploying building is already compromised.
  - **Hall tier:** 03 and 10 say 4. `meta` says `min(4, 1 + floor((L − 5)/5))`. 02 asks 03 to decide. `leak_est.py`, the source of 03's "7–8 compromises", uses 4.
- **Fix.** Each 60 ticks, for every working, non-compromised deploying building i, with Δ = (0.01/3600) × Aᵢ × (1 − vᵢ) × (1 − 0.2·O) per second:
  - ℓᵢ += Δ and L += Δ.
  - When a building is removed, L −= ℓᵢ, floored at 0.
  - When L ≥ 1, pick the non-compromised deploying building with the largest ℓᵢ (ties: lowest serial). If there is none, hold L at 1. Otherwise compromise it, set ℓᵢ = 0 and L −= 1.
  - *Working* means its crafting or research progress advanced this tick.
  - Hall tier: **4** (03). Delete meta's formula and resolve 02 Objection 9.
  - Correct 10 §5.11's "L = Σℓᵢ".

### L5. Quality: the verifier ladder is ambiguous twice, and catalysts are unspecified (M3)
- **Location.** `meta.quality.verifier_rule` and 02 §6 ("lowest-tier Comparator") against 10 §5.16 ("1 + the highest verifier tier") (C16); A §5.1; 03 §2.2 and §3.1; 10 §4.3 and §5.16; `meta.quality.stat_bonus_per_level`.
- **Problem.**
  1. **Lowest or highest.** The data takes the lowest Comparator in the machine; 10 takes the highest.
  2. **What "tier k" means.** A §5.1 ("tier k+1 only from machines with tier-k verifiers") means the Comparator's *quality*. The data's "Comparator (1-3)" invites reading the module *number*.
  3. **Tier versus level.** The data's levels are 0, 1, 2, 3, 5 (ISO legendary = 5), so "k + 1" must be computed on the tier index, not the level.
  4. **Catalysts.** Every checkpoint recipe (Ratings, controllers, Logistic agent, Synthetic data, Researcher, Copy weights, Meta-analysis) returns a catalyst. If quality rolls apply to the whole result, as Factorio 2.0 does by default, then an Endpoint or a Copy-weights Trainer with Comparators upgrades the *returned* checkpoint for free. Leak v and hollow work then improve as a by-product of serving.
  5. **Recipe quality.** Under ISO 2.0 every ingredient must match the recipe's quality. A Verified Endpoint therefore needs Verified drives too; the spec never says so.
  6. **Entity stats.** 10 promises "a per-quality table in the data" of entity stat multipliers. The data has the single scalar `stat_bonus_per_level: 0.3`.
- **Fix.**
  - **Max output tier index = 1 + the lowest tier index among the machine's Comparators**, capped by the unlocked tiers. With no Comparator there is no roll. Quality modules never go in Switches (ISO).
  - **Catalyst products set `affected_by_quality: false`** (Factorio's own per-product flag, added in 2.1.7, inside the 2.0 + 2.1 baseline of DECISIONS; `round1/I-data/changelog.txt` line 827). They return at their ingredient's quality. Only the non-catalyst remainder rolls. That is B L6 made literal: copying returns the original unchanged.
  - Recipe quality stays ISO: every ingredient, the catalyst included, matches the recipe quality. v for an Endpoint is the recipe quality.
  - Add `meta.quality.entity_stats`, a per-type table of the 2.0 stats that scale and by how much, or state "ISO 2.0 table" and make 10's overlay carry it.

### L6. Research scheduling can stall the takeoff (M4)
- **Location.** 04 §5.1; 10 §5.12; the technologies data.
- **Problem.** "Otherwise the available technology with the lowest remaining cost" counts research units. *Research productivity* L1 (1,000 units of all six papers), the Branch-M infinites and *Self-driving labs* L1 cost less than most hardware technologies. A Researcher block fed only System cards would queue a technology it cannot research and stop there.
- **Fix.** Candidates are technologies whose cost is **System cards only**, available, and not already queued. First the next *Model generation* level, then the lowest remaining units, ties in data order. Auto-queued entries carry "Queued by: Researcher". The rule appends only while the queue holds fewer than 7 entries and at least one Researcher is installed.

---

## 3. Majors (fix in this design phase)

| # | Location | Problem (evidence) | Proposed fix |
|---|---|---|---|
| **J1** | `meta.yaml` (staffing, world_text, runaways, hollow_work, heat.ambient, heat.throttle); SCHEMA "each read by the engine"; 10 App. B; 08 P17 | The blocks the engine is said to read are English formulas: T(W), j(W), the leak, h, the ambient model, the floor. The W parameters (v₀ 2.0, β 0.5, 600 s, the world σ term 0.05 per field-year from W = 70) are absent (C08). 01 §13 and 10 call the block `meta.world`; the data calls it `world_text`. The placeholders `{heat.tree_damage_c}` and `{staffing.radius}` do not resolve (`r3_xref` D) | Split each block into numbers plus a `formula_ref: "01 §8.1"`. At minimum add `staffing: {supply_per_field_year: 0.02}`, `world: {v0: 2.0, v0_race: 2.9, v0_race_hard: 3.0, beta: 0.5, publication_release_s: 600, y_pub_start: 1945, world_sigma_from_w: 70, world_sigma_per_field_year: 0.05}`, `heat.ambient: {base_c: 14, per_tile_south: 0.0125, noise_amp_k: 3, noise_wavelength: 512, clamp: [-15, 35], sun: {per_tile_south: 1/5700, clamp: [0.6, 1.3]}}`, `heat.throttle: {span_k: 50, floor: 0.5}`, `runaways.leak: {per_hour: 0.01, oversight_step: 0.2}`, `hollow_work: {per_tier: 0.1, cap: 0.5, frontier_tier: 4}`. Fix 08's placeholder paths, or rename the keys to `tree_damage_c` and `radius` |
| **J2** | 10 §8.1 save sections | No section holds W (own and publication terms), Y_pub and the queue of pending publication releases, Σ, L and ℓᵢ, the race state, milestone times, achievement progress, closure and overhang snapshots, run-report accumulators, the timer wheel and heap (spread, escape, ghost expiry, tree leaf timers) or the RNG stream states. S-G12 ("save and load preserve the state hash") cannot pass without them | Add `GLOBALS` (canonical JSON), `TIMERS` as `(dueTick, entitySerial, eventCode)` re-keyed by serial on load, and `RNG` (xoshiro states). Per-chunk leaf counters go in `CHUNKS`, and a leaf change clears the pristine flag. State the rule "everything not listed as derived is saved" next to the derived list |
| **J3** | `entities.yaml` boiler and heat-exchanger; 09 §2.3; 10 §5.8, G11, §14 #2 (C01) | Water consumption appears nowhere in the data. 10 hard-codes 1 water : 10 steam. Factorio 2.0 confirms it: `round1/I-data/changelog.txt` line 4306 (version 2.0.7), "1 Water will now produce 10 Steam in boilers/heat exchangers". Steam's energy per unit, which the steam-engine draw needs, also depends on fluid heat capacities that are in no data | Add `extra.water_per_s: 6` to the boiler and `10.309` to the heat exchanger. Add `heat_capacity_kj_per_k` to `water` and `steam` with 2.0's values (the accuracy audit to confirm). Delete every mention of `boil-steam` |
| **J4** | 10 §5.4 inserter table (burner: 50 kJ per movement and rotation); DECISIONS §18; `entities.yaml` burner-inserter `kw: 315` | §18 triples every burner draw so that fuel item flows stay ISO, but 10's per-movement energy for the burner inserter is the unscaled 50 kJ. Built as written, the inserter burns a third of ISO's coal, and the data's 315 kW disagrees with ISO 2.0's 144 kW × 3 (the wiki's 2.0.7 history) | State that every burner energy number in the overlay (burner inserter energy per movement and rotation, and any other burner `energy_per_*`) is ×3. Derive the data's `kw` from it, or delete it for inserters |
| **J5** | 01 §8.3–§8.5; 10 §5.10; 07 §3.3, §6.1 | (a) Is an unpowered Seminar with papers "working"? (b) Demand flickers as inserters refill. (c) Idle, unpowered and Researcher Seminars: are they graph nodes? 01 §8.4 and 10 rebuild the graph "when a Researcher is added", which implies they are not. (d) The display rounding for "Understaffed: 79%" | U1–U3, U7: demand = the fraction of the last 60 ticks in which the Seminar had a job, its papers (or a unit in progress), power > 0 and was not compromised. Every covered Seminar is a node whatever its state, so topology changes only with Seminars, universities or R. A Researcher only sets that Seminar's demand to 0 and staff to 1. Percentages round half up |
| **J6** | 01 §12.1, 07 §5.1, 09 S-G6, UI-G7 | Y_pub has no initial value. If it starts at 0 or undefined, *Tabulation* (Hollerith, 1890) adds β × 1,890 field-years. Literature (07, trigger technologies included) and Y_pub (material papers only) are different quantities under one word | Y_pub starts at 1945. ΔY = max(0, year − Y_pub) over researched `regime: cited` technologies whose cost includes a non-System-card paper. Literature = the maximum `year` over researched `regime: cited` technologies (triggers included), "—" before any. Track W_own and W_pub separately for the Field tooltip; γ(W) multiplies only W_own |
| **J7** | 09 §8 against 10 §11, §6.12, §9.6 (C12, C13) | Two reference machines: 09 has a 2022 i5-1240P / Iris Xe / 16 GB, 10 a 2019–2020 UHD 620 / 8 GB. 10 §11 quotes "09 §8's numbers": tick ≤ 4 ms mean and ≤ 8 ms p99, heap ≤ 1 GB, stall ≤ 50 ms, download ≤ 60 MB. 10 §6.12 cites "≥ 30 FPS (09 §8)". None of these are in 09 §8, which says ≤ 1 ms per tick, ≤ 150 MB heap and a ≤ 100 ms stall. M1's exit criteria are therefore ambiguous | One table, owned by 10 §11 and only referenced by 09 §8. Pick one reference machine; I suggest 10's, keeping 09's as the "target". Delete the phantom quotations |
| **J8** | 07 §0 ("Every rule … in I applies"); 09 header and §7.2; 10 §5–§7, §10.2, G15; 10 §9.1 (D §8–§12) | M1 depends on round-1 documents outside `spec/`. I covers controls, GUIs, the 28 feel tests and the `InputAction` list (I §8.2). D §12 holds the icon family rules. F-data holds the heat reference script. Revisions to I would not show in the spec. 10 G15 cites `heatsim2.py` (C = 100 MJ/K, κ 0.001–0.002, not 03's model), while 03 §1.6 names `calib3.py`, which matches 03 exactly (C14). The tolerances differ: 1 K (09 S-G4), 0.5 K and ±2 °C (G15) | Move I into the spec as `07a-controls-baseline.md`, frozen, with 07 as its amendment list. Copy D §12's legibility rules into 07 or 10 §9. Copy `calib3.py` to `design/spec/ref/` and point G15 and S-G4 at it with one tolerance (0.5 K at steady state) |
| **J9** | 01 §2, §5.3, §6.2, §9; 10 §5.18 and §4.4 | The world objects have no prototypes: trees (wood per tree), rocks (yield "quartz and coal", amounts "ISO"), wreck pieces and crate (mining times), town buildings, the campus block, the cosmetic exchange office and the mine entrance. 10's overlay field list has no place for them | A `data/world.yaml` with `trees: {wood: 4, mining_time: 0.5}`, rocks as Factorio 2.0's three sizes with stone → quartz (big 20 quartz; huge 24–50 quartz + 24–50 coal), the salvage (B2), and town parts (footprint tiles as B3, building blocks with collision boxes and no health, an 8×8 campus with selection box, the exchange office and mine entrance as cosmetic `town` entities) |
| **J10** | 03 §1.1–§1.2, §1.4; 10 §5.9, §5.18; 07 §11, UI-G9 | Rules an implementer must invent: (a) the chunk of an even-sized entity centred on a chunk line; (b) out-of-map neighbours, since 10 §5.9 says ungenerated neighbours are "lost at the map edge" while §5.18 says heat "does not diffuse into" out-of-map chunks; (c) the Heat tab has no "map edge" sink row, so UI-G9's balance fails; (d) the water exchanger's target tile; (e) when the 10-minute tree timer starts and resets; (f) how a clamp at H = 0 is booked | U8–U12 |
| **J11** | 01 §5.3–§5.4, §6.1, §9; `resources.archive.autoplace`; `meta.world_text.archives.per_tile` | (a) Water inside a footprint (≤ 15% allowed): town tile or water? (b) May undergrounds and pipes-to-ground pass under town tiles? (c) "Faces the most buildable land" has no metric. (d) Is "coverage contains at least 60 × 60 buildable tiles" a square or a count? (e) "Amount per tile ≈ total/1,500" in the data contradicts 01's "area = total/1,500" and could be read as 53 records per tile. "Exactly 80,000" needs an integer distribution rule | U51–U55 |
| **J12** | 03 §1.3 (the Switch in the Cluster class); 10 §5.9 | Throttling scales "crafting or research speed". A Switch has neither, so the throttle on the most common computing building is undefined | U13: a Switch's transmitted effect is multiplied by its m before the 1/√n profile, and its draw is unchanged |
| **J13** | `technologies.yaml` `model-generation-25.prerequisites: [model-generation]`; 05 Objection 8 | The data cannot name a level, and no rule says when a multi-level technology counts as researched. Read naively, *Model generation 25* becomes available after level 6 | U19: a prerequisite on a finite multi-level technology is met at its `max_level`, on an infinite one at its first level |
| **J14** | `model-generation`, `model-generation-25` effects `multiplier: 2.0` (C27); 04 §4 | The data hard-codes m = 2.0 with a note. Under the 1.2 and 2.0 presets the data is wrong, and an engine reading it ignores the world setting | Write `multiplier_from: returns-to-research` (m = 1.5^r), or have the data stage reject a literal on `research-per-paper` |
| **J15** | 04 §3.1–§3.3; 10 §5.5, §5.7, §14 #3; `meta.effects.hall-energy`, `computing-energy`; 04 §5 | (a) Accumulator charging versus interruptible load is still unconfirmed. Under 10's order (normal → interruptible → charging), a solar base that builds Research halls stops charging its accumulators and browns out its *normal* load at night, which breaks "a shortfall slows compute before it slows the factory". (b) Does the Researcher draw 500 kW when idle? (c) 04 §3.2's v_seminar omits u_p while 10 uses min(base, u_p). (d) *Sparse inference*: 04 says halls only, `meta` says halls and Researchers (C23). (e) *Dennard scaling*: additive or multiplicative, and does it reach halls and Researchers? 10 §5.12 calls it a "T* offset" (C22) | U16–U18, U5: order normal → accumulator charging → interruptible, with discharge serving normal first, then interruptible (this matches both 03 §1.8's "after every other consumer" and 04 §3.1's P_available). The Researcher draws only while the Seminar is working. The Researcher-Seminar multiplier = min(sat_normal, u_p) × m_h. Sparse inference applies to halls only (a separate effect type from `energy-per-operation`, which covers both). Dennard is additive with the module consumption bonus on every entity with `heat.class`, the Researcher's 500 kW included, floored at −80% (ISO) |
| **J16** | 10 §5.7 ("fuel energy in minus heat out to the pipes"), §5.9 ("Reactors and fusion generators"); DECISIONS §18a (C21) | 10 contradicts §18a and names the fusion *generator* instead of the reactor. Neither covers a reactor at 1,000 °C whose heat nobody takes: Factorio keeps burning the fuel, and under "2 × heat passed on" it would emit nothing | Emission = 2 × P_gen + P_waste. P_gen = 40 MW × (1 + active neighbours) while fuel burns. P_waste = generated heat that would raise the reactor above 1,000 °C. Fix 10's wording |
| **J17** | 10 §2.4 ("a milestone manifest, starting with the slice's"), §12 M2–M4 | Only the slice has a manifest. M2–M4 split by system, not tier: Comparators unlock at Report (`rejection-sampling`), agents (`automated-planning`) and nuclear (`nuclear-power`) at Article. So "M2 = Article tier" excludes Article technologies whose closure must be checked | Write M2, M3 and M4 manifests now as data filters (technologies plus explicit exclusions), checked by the same closure test |
| **J18** | 10 §5.5 ("product rule from a code registry … There is no expression language in the data"); `recipes.yaml` `amounts_by_j` (C25); `count_formula` | The data already uses two expression languages (`count_formula` in L, `amounts_by_j` in j). 10 plans neither, only a named rule `world-text-mix` that the data never names | One data-stage expression compiler (numbers, + − × ÷, `^` with an integer right operand after substitution, parentheses, variables `L` and `j`), compiled to closures and cached. Drop the registry name, or keep `world-text-mix` and delete the strings |
| **J19** | 08 §8.2; 07 §6, §8.4, §10; 10 §5.5's status table | Missing statuses: hall *Missing accelerators (n / 20)* and *No weights*; *Compute short of power* (a separate status in 10, "Low power" in 07, absent from 08); dry cooler or water exchanger with coolant below 45 °C; a cooling tower without water; a Researcher Seminar in Heat-off and Staffing-off maps | U59: add the statuses above to 08 §8.2 with LEDs. Use 07's choice ("Low power" plus the tooltip line "Compute is supplied last.") and delete 10's separate status |
| **J20** | 03 §1.4; 10 §5.8; `entities.yaml` coolers | (a) Coolant temperature filters on fluid boxes are implied, not stated. (b) What happens when one segment mixes hot and cold coolant? (c) Which module effects apply to a cooling tower (2 slots)? | U48–U49: machine coolant inputs have `max_temperature: 35`, cooler inputs `min_temperature: 45`. A segment outside a box's range does not flow into it (q falls, heat goes to the air). Cooling towers accept only consumption effects |
| **J21** | 04 §8–§9; 07 §5.1; 10 §5.11, §5.20 | The doubling time has no sampling cadence or history length. The run-report measurements are loose: peak power summed over networks? Peak research rate with a sliding window? Ties in most-produced item? | U24, P20–P23 |
| **J22** | `technologies.packet-switching` `exchange-taps`; `resources.exchange.autoplace` ("Tappable after Packet switching") against 01 §7.1 (after *Crawling*); 07 §4.1 | `exchange-taps` has no defined effect: the Crawler already requires *Crawling*, and the Endpoint *Deep learning* | Delete the effect. The Junk-share readout appears with *Crawling* (07). Fix the autoplace text |
| **J23** | 10 §2.4 overlay "defaults per `mirrors` id"; entities whose `mirrors` is free text | `mirrors` values like "stone-furnace (data smelter)", "new (F: …)" and "flamethrower-turret (tech slot); gun turret's role" have no parse rule. The Monitor would inherit a 2×3 flamethrower box for a 2×2 entity | Rule: the defaults id is the leading `[a-z0-9-]+` token; `new` means no defaults, and the data stage then demands a full overlay entry. Give `monitor` an explicit overlay |
| **J24** | 01 §5.2, 07 §3.3 | There is no deterministic hue rule for staffing networks. "One hue per network" changes colour whenever networks merge or split | U60: hue index = (lowest university serial in the network) mod 8, from a fixed 8-hue palette |

---

## 4. Minors

| # | Location | Problem | Fix |
|---|---|---|---|
| N1 | `meta.heat.ambient` (C10) | Spawn 10–18 °C here; 01 §3 and §9 and 09 §4 say 11–17 | 11–17 |
| N2 | SCHEMA "`emission: loss` with `loss_factor: 2`" (C26) | The data uses `conversion`, `twice-output` and `none` | Rewrite the SCHEMA entry |
| N3 | `meta.runaways.clean.rollback` (C17) | `consumes: checkpoint` only | `checkpoint` (tiers 1–3) or `frontier-checkpoint` (tier 4), per L2 |
| N4 | `meta.runaways.escape_path` (C18) | "An agent hub whose area covers the machine" drops 03 §3.6's Logistic-agent condition and the exchange-tap case | Copy 03 §3.6 |
| N5 | `enemies.yaml` `runaway.targets` (C19) | Lists 2 of the 4 links and only Learned controllers | Copy 03 §3.1 and §3.3 |
| N6 | `entities.yaml` `endpoint.extra.model_tier`, 02 §8 (C20) | "4 for a frontier checkpoint", but no serving recipe takes one (03 §9 #3) | Delete the clause |
| N7 | 06 §3.3 (C29) | "Only in Race"; 00 §6 and 03 §5 make Scooped an opt-in setting forced on in Race | "Opt-in, and always on in Race" |
| N8 | `resources.exchange.min_yield: 0.2` (C30) | Superseded by the floor F(W) (01 §13) | Delete, or document it as ignored |
| N9 | 10 §5.18 stage 10 | "Rad Lab salvage" | "Laboratory salvage" |
| N10 | 10 §2.4 and M0 | "Until R2-D lands … round1/D-data" | Point at `spec/data` |
| N11 | 00 §10; 09 §1; 10 G17, App. A | Scripts cited at session-scratchpad paths that are gone (`sim/`, `slice/make_slice.py`). The W sims now live in `round2/W-sim/` | Repoint, and commit the slice generator under `tools/` |
| N12 | 00 §9 #5; 04 §13 #1 | "The 4 module slots are still my proposal"; the data has 4 | Mark resolved |
| N13 | 07 §25 #1 and #3; 08 §14 #5; 09 §11 #1 and #3; 01 §14 #3 | Objections resolved since (DECISIONS §17, §18, §20), still listed as open | Mark resolved or delete |
| N14 | 07 §8.1 "as F defines it" | Pre-§18 wording for the thermal-plant loss | "Fuel burned − energy passed on (DECISIONS §18); reactors 2 × heat passed on (§18a)" |
| N15 | `meta.effects.ammo-damage` mentions `cannon-shell`; `monitor-rate` mentions `flamethrower-damage` | Vestiges of dropped content | Remove from the descriptions |
| N16 | `meta.staffing.t0` key `college-town` against `world_text.exchange.f` key `college` | Two vocabularies for one town class | One enum: `village, college-town, town, city, metropolis` (+ `starting-college`) |
| N17 | `meta.staffing.radius_upgrades: {packet-switching: 72, web-search: 108}` and the techs' `staffing-radius ×1.5` | Two sources for one number | Keep the effects; derive the table |
| N18 | 04 §2.5; 10 §5.2 (the Constructor scans areas) against data (a separate `area-scanner` entity) | Two designs for scanning | Keep the data's split; update 04 §2.5 and 10 §5.2 |
| N19 | 07 §17 World tab | "Race mode: off / on" has no *Race, hard* (v₀ 3.0) from 00 §6 and 01 §12.1 | Add it, or make v₀ the Advanced field only |
| N20 | 00 §8 E7, 02 §6, `items.yaml` (Comparator) against 08 §10.1 ("proposal: Sampler 1–3") | Unsettled name | Decide (data: Comparator) |
| N21 | `technologies.explosive-yield-1` | No effect and no unlock: a dead technology, since grenades became Evaluation sets | Give it the rocket or land-mine bonus, or remove it |
| N22 | 09 S-G4 "within 1 K"; 10 G15 "0.5 K" and "±2 °C" | Three tolerances for one case | One (see J8) |
| N23 | UI-G4, UI-G5 | Seminar centres are half-integers and coverage edges integers, so "centre exactly on the edge" cannot happen, and "47 and 49 tiles" should read 47.5 and 48.5 | Restate per U3 |
| N24 | 08 §5.1 volume line | "240 technology definitions"; the data has 250 | Update |
| N25 | 08 §6 #6 *Town and gown*, #7 *Station wagon*, #8 *Sneakernet*, #14 *Jevons paradox* | The conditions admit several readings | U63 |
| N26 | 01 §12.1 table (3 h: Field 1965) against 09 §5 (Field 1966) | Off by one | Round W consistently, or print W to 0.1 |
| N27 | 02 and 05 objections both re-list the same 13 items | Duplicate hand-written blocks will diverge | Render one block in each file, from one source |
| N28 | 10 §5.12 "catchment radius" | The data's effect is named `staffing-radius` | Use the data's names in 10's examples |
| N29 | 07 §6.5 "if R2-D makes it a slot rather than a recipe catalyst" | Settled: it is a weights slot (04, data) | Remove the conditional |
| N30 | Drains | 03 §1.1 and 10 §5.9 emit "drain included", but no drain value appears in the data or in 10's overlay list | Add `energy.drain_kw` to the data (ISO values); heat is a design quantity under P17 |

---

## 5. Cross-file consistency: what the scripts found

**Dangling ids** (`r3_xref.py` A):
- `boil-steam` at 09:94 and 10:2056;
- `electric-mining` at 09:113;
- `world-text-mix` at 10:710, a product rule the data never names.

The 42 other unmatched backtick tokens are UI registry ids, control ids and tooling names. They are legitimately non-data and are listed in the script's ignore set.

**Manifest** (C): the 13 failures quoted in B1.

**YAML internals** (B): only vocabulary vestiges (N15).

**Placeholders** (D): `{heat.tree_damage_c}` and `{staffing.radius}` (J1).

**Section references** (E): 411 checked, 0 dangling.

**Contradictions between files** (`r3_checks.py`, all 30 failing today):

| Check | Files in tension | Issue |
|---|---|---|
| C01 | data, 09 §2.3, 10 §5.8 / G11 / §14 #2, 02 §9 #7 | J3 |
| C02, C03 | meta, 01 §9, 09 §4, 10 §5.18, 00 §9 #12 | B2, N9 |
| C04, C05 | data, 01, 10 | B3, J9 |
| C06, C07 | data, 08 §9.3, 07 §5, 09 §6 / §9 | B4 |
| C08, C09 | meta, 01 §12–§13, 10 App. B, 08 | J1 |
| C10 | meta, 01 §3 / §9, 09 §4 | N1 |
| C11 | 09 §6 / §7.2, DECISIONS §17, 10 §12 | B1 |
| C12, C13 | 09 §8, 10 §6.12 / §9.6 / §11 | J7 |
| C14 | 10 G15, 03 §1.6 | J8 |
| C15 | meta, 03 §3.1, 10 §5.17, 02 Obj. 9 | L4 |
| C16 | meta / 02 §6, 10 §5.16 | L5 |
| C17, C18, C19, C20 | meta / enemies / entities, 03 | N3–N6 |
| C21, C22 | 10 §5.7 / §5.9 / §5.12, DECISIONS §18a, data | J16, J15 |
| C23, C24 | meta.effects, 04 §2.3 / §5 | J15, L1 |
| C25 | 10 §5.5, recipes | J18 |
| C26 | SCHEMA, data | N2 |
| C27 | data, 04 §4 | J14 |
| C28 | 07 §6.2, 03 §3.4, 07 §10.4 | L2 |
| C29 | 06 §3.3, 00 §6, 03 §5 | N7 |
| C30 | resources, 01 §13 | N8 |

---

## 6. Undefined behaviour: every place an implementer would have to invent a rule

Each entry gives the case, what the spec says, and a proposed exact rule. The ranked issues above cite these numbers.

### Staffing (01 §8, 10 §5.10)

| # | Case | Spec today | Proposed rule |
|---|---|---|---|
| U1 | What "working" means for demand | "A research job and the papers it needs" (01 §8.3); power, compromise and inserter gaps unstated | Demand = the fraction of the last 60 ticks in which the Seminar had a job, the papers for the current unit (or a unit in progress), electric satisfaction > 0, and no compromise |
| U2 | Graph nodes | "Universities and covered Seminars"; but the graph is rebuilt "when a Researcher is added" | Every Seminar whose centre is covered is a node, whatever its state. A Researcher changes demand and staff, never topology |
| U3 | Coverage geometry | "Centre inside the square" | Campus tiles [x₀, x₀+8) × [y₀, y₀+8). Covered iff x₀ − R ≤ cₓ < x₀ + 8 + R (and likewise for y). Seminar centres are half-integers, so ties cannot occur |
| U4 | Universities in ungenerated chunks | Silent | Universities come from the pure town function, so a campus counts whether or not its chunk is generated |
| U5 | Researcher Seminar when compute power fails | 10 §5.5: min of the two satisfactions; 04 §3.2 omits u_p; 10 §14 #3 open | Speed multiplier = min(sat_normal, u_p) × m_h. Staff = 1 and demand = 0 regardless. The 500 kW is demanded only while the Seminar is working. Status "Low power" plus the line "Compute is supplied last."; u_p = 0 reads "No power" |
| U6 | Staffing off (Sandbox) | staff = 1 everywhere | The staff slot stays. A Researcher behaves as usual (500 kW, leak, hollow work); its staffing effect is moot |
| U7 | Rounding of displayed percentages | Silent (S-G3 expects 0.787 → "79%") | Round half up to an integer percent; the simulation keeps the exact value |

### Heat (03 §1, 10 §5.9)

| # | Case | Spec today | Proposed rule |
|---|---|---|---|
| U8 | Which chunk an entity belongs to | "The chunk of the entity's centre" | (⌊cₓ/32⌋, ⌊c_y/32⌋) of the geometric centre. Even-sized entities centred on a chunk line go east or south. The same chunk is used for emission, throttle reads and cooler sinks |
| U9 | Water exchanger target | "The chunk of the water tile it touches" | The water tile at its pumping position (overlay-defined, as for the offshore pump) |
| U10 | Edges | Ungenerated neighbours "receive nothing" (lost); out-of-map "does not diffuse into" | Ungenerated: the share leaves and is booked under a **Map edge** sink row (needed for UI-G9). Out-of-map: the share is not sent (reflecting edge) |
| U11 | Tree leaf timer | "One stage per 10 minutes above 45 °C" | Per chunk, accumulate update time while T > 45 °C. At every 600 s accumulated, each tree drops one stage. Reset the accumulator when T ≤ 45 °C. A leaf change clears the pristine flag |
| U12 | Clamp at 0 | "Never below 0" | Book the actual removal, not the computed one |
| U13 | Switch throttle | Undefined | Transmitted effects × m, before the 1/√n profile; draw unchanged |
| U14 | Frontier cluster throttle | Accelerator class | Run-shard crafting speed × m. The launch sequence is not throttled |
| U15 | Throttled machines and the leak | Silent | A throttled machine is still working |

### Power (04 §3, 10 §5.7)

| # | Case | Spec today | Proposed rule |
|---|---|---|---|
| U16 | Accumulator charging versus interruptible load | 10 chose normal → interruptible → charging and asked 04 to confirm; 04 silent | Normal → accumulator charging → interruptible. Discharge serves normal first, then interruptible |
| U17 | Scope of hall-power multipliers | *Sparse inference* "halls" (04) against "halls and Researchers" (meta) | Halls only for *Sparse inference*; halls and Researchers for *Energy per operation*; two effect types |
| U18 | *Dennard scaling* | "−8% per level"; additive or multiplicative unsaid; 10 calls it a T* offset | Additive to the consumption bonus on every entity with `heat.class` and on the Researcher's 500 kW; total consumption bonus floored at −80% (ISO) |

### Research (05, 04 §5, 10 §5.12)

| # | Case | Spec today | Proposed rule |
|---|---|---|---|
| U19 | Multi-level prerequisites | Not stated | Met at the finite `max_level`; met at the first level for infinite technologies |
| U20 | Research scheduling candidates | "Lowest remaining cost" | L6 |
| U21 | Y_pub start and membership | Absent | J6 |
| U22 | Field tooltip terms | "Own work … From your papers …" | Store W_own and W_pub; γ(W) scales only W_own |
| U23 | m under other presets | Data literal 2.0 | J14 |
| U24 | Doubling-time sampling | "Ring buffer" | Sample R̄ every 6 ticks into a ring covering the last 2 h; older history at 60 ticks. w uses the previous DT. Append to the history when DT ≤ half the last appended entry. Saved |
| U25 | Research-hall load, mixed tiers, swaps, statuses, accelerator quality | Partial and conflicting | L1 |

### Runaways (03 §3, 10 §5.17)

| # | Case | Spec today | Proposed rule |
|---|---|---|---|
| U26 | L against Σℓᵢ; removal; no candidate | Conflicting | L4 |
| U27 | "Working" for the leak | "Crafting / writing / researching" | Progress advanced this tick |
| U28 | What a compromised machine consumes | "Stops producing" | L3 item 3 |
| U29 | "Powered" | Undefined | Satisfaction > 0 this tick, in its own class |
| U30 | Spread timer while unpowered | Undefined | L3 item 6 |
| U31 | Brownout during the 30 s | "Brownouts do not count" | Any tick above 0 resets the counter |
| U32 | Compromised signal without power | Undefined | Output regardless of power (L3 item 1) |
| U33 | Mining, deconstructing, fast-replacing or upgrading a compromised machine | Undefined | Refused (L3 item 2) |
| U34 | Rollback input | Contradicts the slot rules | L2 |
| U35 | Monitor range, cycle and power | "Range 24, every 5 s" | Centre-to-centre distance ≤ 24. The cycle advances at satisfaction × (1 + Σ monitor-rate). It holds when charged and fires on the tick a target appears; it consumes a set only when it cleans |
| U36 | Link predicates | "Inside one Switch's area"; "a network that holds a Logistic agent" | Footprint overlaps the 9×9 supply area (ISO beacon test). Logistic agents counted in hubs and in flight, per network |
| U37 | Endpoint tier | "Current value" | A global value from the three technologies (delete "4 for a frontier checkpoint") |
| U38 | Hall tier | 4 against a formula | 4 (L4) |
| U39 | Runaways off | "L is not simulated" | Also: no Compromised signal, Monitors inert, the rollback input never exists |
| U40 | Nest siting near towns (M5) | Silent | Never on town tiles or within 32 tiles of a footprint |

### Quality (02 §6, 10 §5.16)

| # | Case | Spec today | Proposed rule |
|---|---|---|---|
| U41 | Verifier ladder | Lowest against highest; tier against module number | L5 |
| U42 | Catalyst quality | Unstated | L5: `affected_by_quality: false` on catalyst products |
| U43 | Model collapse multiplier | "× (1 − σ) of its normal chance" | Multiplies the module quality chance q before the cap; the 10% further-tier chance is unchanged |
| U44 | Entity stat table | A scalar 0.3 | L5 |
| U45 | Quality of loaded accelerators | Unstated | Ignored (L1 item 6) |

### Exchanges and fluids (01 §7, 03 §1.4, 10 §5.6, §5.8)

| # | Case | Spec today | Proposed rule |
|---|---|---|---|
| U46 | The `exchange-taps` effect | No meaning | J22 |
| U47 | `min_yield` on the exchange | 0.2 against the floor | Delete |
| U48 | Coolant temperature filters | Implied | J20 |
| U49 | Cooling tower module effects | 2 slots | Consumption effects only |
| U50 | Machines with both data and pipe boxes | Category per box (10 §5.8) | Already defined. List the box categories per entity in the overlay, as data where the design cares (refinery: crawl and data out on `data`, water on `default`, coolant on `default`) |

### Towns and worldgen (01 §4–§9, 10 §5.18)

| # | Case | Spec today | Proposed rule |
|---|---|---|---|
| U51 | Water inside a footprint | Silent | Every footprint tile becomes a town tile (land) |
| U52 | Undergrounds, pipes-to-ground and data lines under towns; wires over towns | "Nothing can be built on a town tile" | Allowed: only the two ends occupy tiles (ISO tunnel rule). Wires may span towns |
| U53 | Campus edge | "Faces the most buildable land" | For each edge, count buildable tiles of its R = 48 coverage strip outside the footprint. Take the maximum; ties go N, E, S, W |
| U54 | "60 × 60 buildable tiles" | Ambiguous | An axis-aligned 60 × 60 square of buildable tiles (resources allowed, water, cliffs and town tiles not) fully inside the coverage |
| U55 | Exact archive totals | "Exactly 80,000"; area rule | n = clamp(round(total/1,500), 16, 400) tiles. Each gets ⌊total/n⌋, and the first (total mod n) tiles in row-major order get +1 |
| U56 | Hand-mining resources that require a fluid | Silent | ISO (allowed); the slice manifest includes `uranium-ore` (B1). Or ban it as a BEND, but say which |
| U57 | Town era skins at chunk granularity | "By W" | Global, switched at the thresholds; no per-town hysteresis |
| U58 | Records stores near the map bounds | Silent | Rejected when any blob tile is out of map |

### UI states (07, 08)

| # | Case | Spec today | Proposed rule |
|---|---|---|---|
| U59 | Statuses missing from 08 §8.2 | — | Research hall: **Missing accelerators (n / 20)** (red), **No weights** (red). Dry cooler and water exchanger: **No hot coolant** (yellow). Cooling tower: ISO "Low input fluid" plus "Removing: X / 10 MW". Researcher Seminar: "Low power" plus "Compute is supplied last."; "Throttled by heat"; "Compromised" |
| U60 | Staffing hues | "One hue per network" | J24 |
| U61 | Save contents | Partial | J2 |
| U62 | Constructor scanning | Two designs | N18 |
| U63 | Achievement conditions | Prose | *Town and gown*: working Seminars staffed from five distinct universities at one tick (any networks). *Station wagon*: a car whose inventory holds ≥ 80 stacks of drive items (any `-drive`) travels 1,000 tiles cumulatively without its drive count falling. *Sneakernet*: a train carrying ≥ 1 drive completes a path of > 1,000 tiles. *Jevons paradox*: mean electricity consumption over the 60 min after the 100th Distilled controller is installed exceeds the mean over the 60 min before |
| U64 | Ties for the most-produced item | Silent | Higher count first, then item order in the data |

---

## 7. Missing parameters

| # | Mechanic | Missing | Proposed value or source |
|---|---|---|---|
| P1 | Boiler and heat exchanger | water per steam | 1 : 10 (2.0; J3) |
| P2 | Steam and water | heat capacity per unit and K | 2.0 values (accuracy audit) |
| P3 | Every electric entity | drain kW | ISO (N30) |
| P4 | Burner energy per movement and rotation | ×3 scaling | 150 kJ for the burner inserter (J4) |
| P5 | Tiles | κ, walking speed, buildability, map colour | B3 |
| P6 | Rocks, trees, wreck pieces, crate | yields, mining times | J9, B2 |
| P7 | Day–night curve | breakpoints | ISO: dusk 0.25, evening 0.45, morning 0.55, dawn 0.75 of 25,000 ticks; min light 0.15 (accuracy audit to confirm) |
| P8 | Sunlight s(y) granularity | per tile or per chunk | Per chunk centre, like θ |
| P9 | Ambient noise | function and octaves | simplex-noise 4.0.3, one octave at 512 tiles, amplitude 3 K, seed stream `ambient` |
| P10 | Town layout | street width and block size | Cosmetic, but fix it for determinism: 2-tile streets every 8 tiles, as a generator spec |
| P11 | W model | v₀, β, lag, Y_pub₀, world σ term as data | J1, J6 |
| P12 | Staffing supply slope | 1/50 as data | J1 |
| P13 | Leak, hollow work, throttle constants | as data | J1 |
| P14 | Milestones list | which items, buildings and technologies count | 07 §15 describes it; add `data/milestones.yaml` with ids |
| P15 | Loading tips | data file | 08 §7's table as `data/tips.yaml` with `requires` |
| P16 | Town-name word lists | data file | 08 §10.4 as `data/names.yaml` |
| P17 | Quality stats per entity type | table | L5 |
| P18 | Research hall statuses and slots | counts | L1 |
| P19 | Staff-limited readout | which Seminars count | "Working on the current research" (07 §5.4); make it the minimum over those, as written |
| P20 | Doubling time | sample cadence, history | U24 |
| P21 | Peak power | measured where | Sum of all electric production on the surface, as a 60-s sliding mean of per-tick totals |
| P22 | Peak research rate | window resolution | Completion timestamps; the 600-s window slides per tick |
| P23 | Overhang | moment | At the tick the closure event fires, before that tick's inserter phase |
| P24 | Frontier-run loss curve | per-run constants | Every run uses the defaults (07 §13.1), or define them per run |
| P25 | Monitor | power behaviour | U35 |
| P26 | Staffing supply multiplier (Advanced) | range | 0.25×–4× in 0.25 steps |
| P27 | Field pace (Advanced) | range | 0.5–6.0 field-years per hour |
| P28 | Coolant fill | initial coolant temperature | 30 °C (`default_temperature`) |
| P29 | Spoilage (Scooped) | stack freshness merge | ISO Space Age (stated in 03 §5; 10 §14 #4 plans it) |
| P30 | Research-hall power with mixed tiers | formula | L1 item 3 |
| P31 | Hand mining of an archive | speed | ISO 0.5 × (1 + bonuses) ÷ mining time 1 (10 §5.1). Already defined; listed only to confirm |

---

## 8. Can M1 be built from 09 + data + 07 + 10 alone?

**No.** The table shows what an M1 implementer needs, where it is and whether it suffices.

| Need | Where it lives | Enough? |
|---|---|---|
| Content ids and the manifest | 09 §2, data | **No.** B1 (stale) |
| Controls, context resolver, capture layer, GUIs, feel tests, `InputAction` list | **round1/I** (normative by 07 §0); 07 amends; 10 §7.5 implements | Only with I (J8) |
| Worldgen: terrain, biomes, climate, patches, towns, archives, starting guarantees | 01 §2–§9; 10 §5.18 restates parts | 01 needed. Tiles and world objects missing (B3, J9); edge rules U51–U58 |
| Staffing | 01 §8, 07 §3.3 / §6–§7, 10 §5.10 | Yes, apart from U1–U7 |
| Heat field and throttle | 03 §1, 10 §5.9, 09 §5 | Yes, apart from U8–U12 and the reference script (J8) |
| W, Field, Literature | 01 §12.1, 07 §5.1 | Y_pub₀ and regime missing (J6, B4) |
| Steam | data, 10 §5.8 | Ratio only in 10's prose (J3) |
| Charter, statuses, log lines, tips, names, citations | 08 §3, §4.6–§4.7, §5.2–§5.3, §7, §8, §10.4 | 08 needed. Long-form citations missing (B4) |
| Salvage | 01 §9 against data | Contradictory (B2) |
| Art rules | D §8–§12 (round 1); data `sprite` lines | D §12 needed (J8) |
| Golden references | 10 §10.3; F-data `calib3.py` | Wrong script cited (J8) |
| Performance exit criteria | 09 §8 against 10 §11 | Contradictory (J7) |
| Save format | 10 §8 | Globals missing (J2) |

**To make it self-sufficient:**
1. Fix B1–B4.
2. Move I into `spec/` (J8).
3. Add to 09 a short **"M1 reading list"** that makes these normative: 01 §2–§9, §12.1; 03 §1.1–§1.3, §1.7, §1.9; 08 §3, §4.6–§4.7, §5.2–§5.3, §7, §8, §10.4. (09 already relies on them, but by scattered citation.)

---

## 9. Architecture gaps

**Required by the spec, not planned by 10:**
1. Tile prototypes and world-object prototypes in the data stage (B3, J9). 10 §2.4's overlay field list has neither.
2. Global sim state, timers and RNG in the save (J2).
3. One expression compiler for `count_formula` and `amounts_by_j` (J18).
4. Milestone manifests M2–M4 (J17).
5. Placement rules as data: `must_be_on: exchange` (Crawler, Endpoint), `must_touch: water` (water exchanger, offshore pump). 10 §5.2 names `must_be_on`, but neither the overlay list nor the data carries it. The data holds it as free text in `extra.placement`.
6. Recipe quality selection (2.0's recipe-with-quality, which the catalyst rule in L5 depends on).
7. The rollback input (L2), the hall's accelerator and weights inventories plus its output for swapped accelerators (L1), and the locks on compromised entities (L3).
8. Text data files: milestones, tips, name lists, achievements with machine-readable conditions. 10 §2.4 validates "achievement conditions named in the data", but no data names any.
9. Factorio's per-product `affected_by_quality` flag (L5).

**Planned by 10, not backed by the spec:**
1. "T* offsets (Dennard)" (10 §5.12). The spec defines Dennard as an energy cut (J15).
2. "Reactors … fuel energy in minus heat out" (10 §5.7). It contradicts §18a (J16).
3. The `world-text-mix` product rule (J18).
4. "A per-quality table in the data" (10 §5.16). The data has a scalar (L5).
5. The Constructor's scanning command (10 §5.2). The data has a separate Area scanner (N18).
6. "09 §8's slice numbers": tick ≤ 4 ms, heap ≤ 1 GB, stall ≤ 50 ms, download ≤ 60 MB, ≥ 30 FPS. None exist in 09 (J7).
7. G15's reference script `heatsim2.py`. It does not implement 03's model (J8).
8. `meta.world` (App. B). The data names the block `world_text` and lacks the W fields (J1).

---

## 10. What is good and must not be lost

- **Data first, validated.** One YAML source, a validator with a research playthrough and closure checks, and 02 and 05 rendered from it. Extend the same discipline to the slice manifest, tiles, world objects and text files; don't replace it.
- **10's determinism contract.**
  - The `detmath` bans and the counter-based RNG keyed by entity serial and craft count.
  - Sleeping as a pure optimisation, proven by NO_SLEEP equivalence.
  - Saves and replays hashed across browsers.
  - Bug bundles replayed headlessly.

  This is what lets Claude debug a real-time game it cannot watch.
- **The heat model is complete and reproducible.** 03 §1.2's update order, constants and guards match F's `calib3.py` line for line. The four anti-cascade guards are engine invariants with tests. Keep it numeric; only the edge rules (U8–U12) need adding.
- **Staffing as a power network** (union-find, a satisfaction ratio, coverage squares, the overlay drawn from the simulation's own predicate) is the right shape. Fill in U1–U7; don't redesign it.
- **Interruptible compute** as one extra priority class, and **closure as a one-shot event** (`loopClosed`), are minimal, testable engine hooks for the endgame.
- **The rate calculator and every tooltip read the same `effectiveRate()` functions as the simulation** (10 §5.20; 07 §0: "the UI must draw exactly the predicate the simulation uses"). That rule prevents a whole class of bugs.
- **08's P17** (every number in text is a data placeholder, and the build fails on a mismatch) is exactly the guard this project needs. Make the placeholders resolve (J1); don't drop it.
- **The slice numbers hold against the final data** (1,735 / 1,485 / 46,625), and **all 411 chapter cross-references resolve**. The stale parts of 09 are ids and lists, not structure.
- **The takeoff is simulated and reproducible.** The sims are committed in `round2/W-sim/` (repoint the citations, N11), and G17 makes them a golden test.

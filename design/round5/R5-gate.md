# R5-gate: start-coding readiness

*Round 5, final gatekeeper (Opus), with authority to edit every spec file, tool and check script. Inputs: `round3/BRIEF.md`, `DECISIONS.md`, `PROCESS.md`, the whole spec, `round5/R5-play.md`, and the coordinator's list of accepted R5-play items. Written 2026-10-19.*

## 0. Verdict

**Ready to start coding.** Every check is green, the vertical slice (M1) is specified completely enough to build without guessing, and M2–M5 are specified down to engine rules. Nothing open blocks M0 or M1. Fifteen decision items remain (§4), each with a recommendation: seven majors for M3 and M4 (D5–D11), four minor ones that touch M1 (D1–D4), and minor or later ones (D12–D15).

| Check (from `/home/mewse/browsergame`) | Result |
|---|---|
| `gamedev-python tools/validate_spec.py design/spec/data` | 0 errors, 0 warnings; 250 technologies reachable in 26 waves |
| `gamedev-python tools/validate_spec.py tools/testdata/spec-mini` | 0 errors, 0 warnings |
| `gamedev-python design/round3/impl-data/r3_checks.py` | 30 passed, 0 failed |
| `gamedev-python design/round3/impl-data/r3_xref.py` | clean; 703 section references, 0 dangling |
| `gamedev-python tools/render_slice.py --check` | 0 errors, 1 expected warning (uranium ore is a dead end in the slice) |
| `gamedev-python tools/render_spec.py --check` (new) | 02 and 05 match the data |
| `design/round4/arch-data/manifests.py` | M1–M5 filters close; counts as 10 §12 states |
| `design/round4/world-sim/*.py` | all five reproduce their saved `.out` byte for byte |

## 1. What I checked, and how

1. **Baseline.** Ran every check (all green at the start), the five round-4 sims (all reproduced their `.out`), the manifests, and every round-3 script.
2. **Pass 1, as the M1 implementer.** I read 09, 01, 07, 00, 04, 06 and 03 §0–§6 in full, 10 §0–§8 and §10–§14 in full, 10 §5.13–§5.17, SCHEMA in full, 08's M1-normative sections and `text.yaml`. Where prose quotes data, I checked it against the YAML and the sims by script. Examples: S-G4 against `heat_calib3.py`, run chunk by chunk; the hall counts, power and doubling times against `takeoff_r4.out`; the counts against `manifests.py`. I also checked that every `I §x.y` reference in the spec resolves to a heading in `round1/I-ui-controls.md`.
3. **Pass 2, as the M2–M5 implementer.** Five read-only helpers re-read the M2–M5 material in parallel:
   - pressure and world: 03, 00, 01 §6–§13;
   - endgame and research: 04, 05, 06;
   - architecture: 10 against every owning chapter;
   - UI and text: 07, 08, `text.yaml`;
   - the data contract: SCHEMA, the YAML, the generators, the validator's coverage.

   Each cross-checked against 10, the data and DECISIONS. Before acting on any finding I re-verified it against the files: they found about 150 items, with a good deal of overlap. Section 2 lists what I fixed, section 3 what remains.
4. **Negative tests** for every check I added: a broken placeholder, a stale 05 and 09, a flow-map comma, a bad expression variable, and a duplicated value made to disagree. Each fails as it should.

## 2. What I fixed

### 2.1 R5-play items the coordinator accepted

| # | Item | Done |
|---|---|---|
| 1 | Staffing supply slope 0.04 → **0.08** per field-year | `meta.staffing.supply.per_field_year`. `staffing_r4.py`, `arc_r4.py` and `takeoff_r4.py` now read the law from the data, keeping round 4's law as a comparison row. Outputs were regenerated, and the round-4 staffing and arc outputs kept as `*.out.orig` (the takeoff output did not change). Verified: the takeoff output is byte-identical; staffing's round-4 rows reproduce the old adopted rows exactly; tier ends move by ≤ 0.01 h. New numbers: 18.7 staff at hour one (was 15.4); the ceiling of 24 reached at W = 12.5 (Field 1957, about 1.5 h); the 6-h player at 92% at hour one (was 75%); the competent player's 92% bind before *Citation index* gone; Article (90%) and later unchanged. Updated 00 §4, 01 §8.1, §8.7, §8.8 and §13, 03 §7, 07 §6.1, §7.1 and §7.2, 09 §5 and S-G3 (new example: 20.64 / 25 → 83%), and 05 (re-rendered) |
| 2 | The Trainer's falling-loss progress bar | 07 §13.1: Checkpoint, Post-training payload and Final report use the cluster's curve, p = craft progress; the other nine Trainer recipes keep Factorio's bar |
| 3 | The campus's "working Seminars" counts town-staffed Seminars only | 07 §7.1 and §7.2 (the top bar is the simulation's town supply against town demand; Researcher Seminars appear once on each side of the graphs only); 08 §4.7 |
| 4 | The plateau knob's playtest trigger, pre-registered | 04 §1: more than 2 h from the first frontier run that returns cards to closure, at the first user playtest that reaches closure, adopts the four-run counts (1,000 / 1,000 / 2,000 / 1,000), with no further discussion. 10 §12 M4's exit records that measurement |
| 6 | Three nits | *Threat monitoring*'s `desc` ("Watch the audit trail for misuse."); the α note in 07 §12 and 08 §9.3 aligned to the data's wording; the Terminals tip's last sentence is now a rule ("A data line is a link for the machines on it (Containment).") |
| 5 | Citations for the takeoff hardware | Not done, as instructed; see §4 D14 |

### 2.2 Data (`spec/data`)

- **meta.yaml:**
  - a flow-map comma had turned part of `runaways.nest.site` into a bogus null key;
  - numbers that existed only inside prose are now fields: `world.gamma` {80, 90, 0.5}, `world.exchange.floor` {40, 20}, `world.archives.tiles` {1,500, 16, 400} and `distance_factor` {2,000}, `runaways.raids.points_per_min` {4, 36}, `runaways.model_tier.endpoint` {deep-learning: 1, attention: 2, instruction-tuning: 3}, with the rule "the highest researched" (*Instruction tuning* does not require *Attention*);
  - `university_share` lists all six town classes;
  - `world_settings.scooped` is locked on in Race (`forced_in_race`), and `world_settings.staffing` exists;
  - the leak's removal rule covers a Researcher taken out, and "powered" has its timing;
  - the `laboratory-speed` effect multiplies module speed, and `cooling-capacity` reads Π multipliers × (1 + Σ values);
  - ten `formula_ref`s were added, and a stale comment fixed.
- **recipes.yaml:** `launch-final` returns a frontier checkpoint, as 04 §2.2 says every completed run does.
- **entities.yaml:**
  - the Research hall's `desc` is "The first System card written here closes the loop." (07 promised it in the tooltip; the old line restated stats);
  - the hall and Terminal status strings follow 08;
  - offshore pumps and water exchangers may touch deep water (ISO).
- **technologies.yaml:** *Threat monitoring* (R5-play).
- **text.yaml:**
  - three strings that said "within {staffing.radius} tiles" now stay true after R grows;
  - *field-advances* is now literally true for trigger technologies and years before 1945;
  - `{world.beta}` → `{meta.world.beta}` (SCHEMA reserves `world.` for world objects);
  - the header defines the `requires` tokens and `cost_ratio`.
- **SCHEMA.md:**
  - the productivity count (47 = 42 + 4) and the rounding rule for multi-level costs;
  - the real R05 as the technology example, plus the item and resource examples;
  - the nullable fields and the null warning;
  - the `requires` vocabulary with meanings, `must_touch` lists, and how `staff_demand` combines with `meta.staffing.demand`;
  - the undocumented enemy, ammo, world-object and meta fields;
  - the validator's new checks.

### 2.3 Tools and scripts

- **`tools/validate_spec.py`:**
  - multi-level unit counts round half up;
  - the expression grammar accepts σ and c, and `model_collapse.speed_factor` is evaluated within [0, 1];
  - town-class keys are checked on the two converted maps;
  - stray nulls raise a warning;
  - the values the data holds twice must agree (thirteen checks: the starting archive, Watermarking, the liquid shares, the runaway timers and presets, the deploying and interruptible lists, the hall's tier-1 numbers, the Verifier's return, the quality unlocks);
  - `must_touch` accepts a list.
- **`tools/render_spec.py`:**
  - a `--check` mode;
  - rounded costs, and takeoff tables that read the data with one m (05's two takeoff totals now agree);
  - "W, takeoff" counts 14, not 15 (*Energy per operation* is infinite);
  - "49-minute" → 50;
  - objection numbers and the Researcher's 90 characters are computed;
  - the infinite-cost sentence and the Branch M heading;
  - the staffing ceiling prints W = 12.5.
- **`tools/render_slice.py`:**
  - the burner inserter showed "burner 0 kW" (it has 150 kJ per move);
  - `--check` now also fails on a stale 09;
  - in 09 §2.6, *Cliff explosives* moves to M3 (it needs *Terminal ballistics*) and *Perceptron* to the data chain (it unlocks the Trainer).
- **`round3/accuracy-data/yearcheck.py`** (the known loose end): ported to the structured citations. Its four checks run in their round-4 form; 0 issues. The docstring says `validate_spec.check_citations` is authoritative.
- **`round3/balance-data/load.py`** (the known loose end): it now derives each technology's `year` from its structured citations, regime `cited` only, as 01 §12.1 does. `pacing.py`'s publication term had silently stayed at 1945. The round-4 sims, which import it, are unchanged byte for byte. Its docstring marks the round-3 scripts as historical: their staffing model predates DECISIONS §23.
- **`round4/world-sim/{staffing,arc,takeoff}_r4.py`:** the supply law is read from the data (§2.1).

### 2.4 Chapters

- **00:** §4: 19 staff at hour one; supply doubles by 1957; the Trainer and first Checkpoint are Report-tier (*Perceptron*), not Article.
- **01:**
  - §8.1, §8.7, §8.8 re-simulated;
  - §9's lake wording;
  - §5.3's tooltip reference;
  - §8.4: the network hue keys on the university id (universities have no serial);
  - §12.1: run lengths 15–37 min, not 20–35; the Field tooltip's wording; Your year floored;
  - §13: 0.08.
- **03:**
  - §1.2: the tower's ΔT uses H after Newton cooling (the golden script's order);
  - §1.3: a Switch transmits speed and consumption only (ISO);
  - §1.4: solar cuts power's heat to a third, not half; q is defined over time and at 0 / 0; capacity effects compound;
  - §1.5: guard 3 names the Trainer as the first computing machine;
  - §1.7: the Heat tab books dry coolers and water exchangers as sources, with one sink row per terrain class;
  - §2.1 and §7: j labels;
  - §3.1: the Endpoint tier is the highest researched;
  - §3.2: wᵢ "same shape" rather than "same measure"; a removed Researcher counts as removal;
  - §3.3: when "powered" is read;
  - §3.4: rollback items go to the rollback input first in any machine;
  - §6: the race countdown sits on the World strip; the race line reads the most advanced cluster.
- **04:**
  - §1: the first-run line, and the pre-registered knob;
  - §2.1: the final run's returns;
  - §2.3: inventories and status wording;
  - §2.4: objection reference;
  - §3.1: interruptible demand only for running halls;
  - §3.2: v_hall includes the hall's quality;
  - §5.1: *Energy per operation* after *Model generation 25*, not after victory;
  - §7: the 1,000 halls are Standard quality;
  - §8: Peak power ≈ 1,950 MW. The old 2,800 was installed capacity, not production;
  - §9: the Bonuses example (m = 1.5^1.71 ≈ 2.0004, so ×1.05M, not 2²⁰ exactly); the doubling readout's first window, its zero-rate rule and its first entry; four more achievement rows;
  - §10: the Seed is the expansion's last payload, not its first.
- **06:** §3.5: the moon's floor is 1/120 of full power, about a seventh of the continent's, not 1/120 of it.
- **07:**
  - §5.1: the end state reads 29 beyond the literature, with a counting rule (the "187" was a round-1 placeholder); the Gap is floored;
  - the World strip, window and `/world` mocks agree with the data (no "Junk 45%" at 1984); `/world` omits hidden entries;
  - §6.5: the hall's closure line, and "?" before *Interpretability*;
  - §8.1: the fusion reactor's heat line; the Switch's limit is 40 °C;
  - §9.2 and UI-G26: c is Site-wide;
  - §11: Heat-tab sources and sinks; the most-produced item comes from exact totals;
  - §13.3: Fastest doubling 0.70 s, the duration format and the sim's value;
  - §16.1: the rate calculator mock (64 stone furnaces, not 6.4);
  - §16.2: the status lights' None row;
  - small consistency fixes: hexagon, keybinding name, crafting group, "Linked:".
- **08:**
  - the end-state example;
  - the World mocks;
  - §5.4: `{amount}`, `{output}`, `{energy}` and list joins defined;
  - §8.4: log lines name the archive, cover only tapped exchanges, and give research milestones for `/milestones`;
  - §10.1: "Verification 1–4" is not a technology series; the replicator names; a dead "05 Objection 12" reference;
  - §10.2: never-list exemptions for *Scalable oversight* and Factorio's Advanced tab; dropped a nonexistent "alignment" quality tier.
- **09:**
  - §0.1 lists the untagged 07 sections the slice needs;
  - §4: the lake;
  - §5 and S-G3: staffing;
  - **S-G4:** the "+10.1 K" chunk is the consumer block's corner, (31, 32). The chunk between the plant and the block is +13.0 K, so the test as written would have failed a correct engine.
- **10:**
  - **§5.5:** the Seminar formula *added* lab-speed research to module speed, while 04 and the sims *multiply*. Found by three reviewers; fixed;
  - **new Frontier-cluster engine rules:** shards, payload slot, launch, completion products, events, compromise;
  - **§8.1:** belts, fluid segments, circuit frames and trains were listed as "derived, never saved" although they hold state. Their topology is derived and their contents are saved and hashed;
  - §4.6: the phase of the Monitors, and which tick's satisfaction a spread timer reads;
  - the Research hall's drain, interruptible demand, output and input inventories; test-time mode read from data;
  - the drill formula (productivity no longer depletes);
  - cooler capacity multipliers; the coolant field names;
  - the doubling readout's gaps; unit rounding; the `mine-entity` trigger (Crawlers count, or M2 dead-ends at *Text categorization*);
  - g^r; the Switch's quality scaling (+0.2 per level, ISO); locomotive power;
  - the university id encoding; the starting exchange tap;
  - exact all-time totals for the run report (Float32 cannot hold 18,204,311);
  - status strings live in `locale/en.yaml`, not `text.yaml`;
  - the container recipes are all explicit;
  - §12: milestone contents and exits match the manifests (cliff explosives M3, radar M1, hollow work M4, R9 tier 4 and *Nanofabrication* M4, S-G1–S-G19, G17's 5%, Biology in M7);
  - G15 chunk coordinates; G17's reference script is `takeoff_r4.py`; R11's year 1889; 245 halls;
  - `npm run check` runs both render checks;
  - a `set_research_scheduling` input action.

## 3. Remaining issues, by severity

**Blocker:** none. **Major**, each a design decision to settle before its milestone (details and recommendations in §4): D5–D8 (M3) and D9–D11 (M4). **Minor:** D1–D4 (M1) and D12–D15 in §4, plus these, which need no decision:

| # | Where | Issue |
|---|---|---|
| m1 | data | A few engine-read fields are still strings an engine must parse: pole `extra.supply` ("5x5"), the Switch's `supply_area` ("9x9"), `enemies.runaway.tier` (prose), and the Frontier cluster's `extra.returns` and `payload` (prose duplicates of the pseudo-recipes, which 10 now names as the source). Convert them when M2–M5 touch those entities |
| m2 | data | Three names exceed 08's 24-character budget: "Depleted uranium fuel cell", "Nuclear fuel reprocessing" and "Meta-analysis (baselines)". The first two are ISO names; exempt them in `meta.checks` |
| m3 | data | `library_totals` uses positional triples explained by a `_note` |
| m4 | text | `note` means UI text on technologies and commentary in `meta`, `extra` and world objects. SCHEMA now says which; renaming the commentary keys to `comment` would remove the ambiguity |
| m5 | 07 §17 | The Advanced tab's knobs (heat model, leak-rate multiplier, staffing radius) have no ranges or defaults in the data (M2+) |
| m6 | `DECISIONS.md` | Round 5's accepted changes (the 0.08 slope, the plateau trigger and the items above that changed rules) are not recorded there; the coordinator should add them |

## 4. Decisions for the user or Claude

Ordered by the milestone that needs them. Each has a recommendation that is ready to paste.

**Applied** (R5-apply, 2026-10-19, after DECISIONS §40–§42 accepted D1–D13 and D15 as recommended and deferred D14): the last column names the files that carry each decision; `R5-apply.md` is the log.

| # | Milestone | Decision | Recommendation | Applied (R5-apply) |
|---|---|---|---|---|
| D1 | M1 (S1) | **Town names cannot be "unique per map".** Towns are a pure function of (seed, cell), the map is endless, and the pools hold about 200 names per climate band (UI review #9) | Unique within 8 cells (2,048 tiles), resolved by the cell-hash priority already used for the 64-tile footprint rule (10 §5.18): draw, reject a name held by a higher-priority town within 8 cells, redraw up to 8 times, then append " II". Change 08 §10.4's "unique per map" to match | Applied: 01 §5.3, 08 §10.4, 10 §5.18, 09 §10 (S1); `text.yaml` (`town_names.uniqueness`), SCHEMA |
| D2 | M1 (S4, S6) | **One precision table** for numbers shown on several surfaces (synthetic share "3.1%" on the strip vs "31%" on the Trainer row; chunk temperature to one decimal or as an integer) | Add to 07 §0: shares as an integer % everywhere, with one decimal below 10%; temperatures to one decimal in the chunk tooltip and the ground hover and as integers in entity lines; durations by §5.1's format | Applied: 07 §0 (the table), §4.1–§4.3, §7.1, §8.1, UI-G27; 08 §4.7, §8.6, §10.3; 09 §10 (S4, S6) |
| D3 | M1 (S9) | **Loading tips with `requires: []` that mention later content** (*bloom*, *kaplan*) show in the slice | Keep them: they are true facts, and the slice player is a Factorio veteran. Otherwise give them `requires: [exchanges]` | Applied: 08 §7; 09 §10 (S9). The tips keep `requires: []` |
| D4 | M1 (S9) | **"Records store"** is both the per-browser history store (07 §19.2, §20) and an in-world archive | Rename the browser store **Run history** | Applied: 07 §13.3, §19.2, §20; 09 §6, §10 (S9); 10 §5.20, §8.2 (IndexedDB store `runHistory`) |
| D5 | M3 | **Machines that hold a controller:** 03 §3.1 makes them susceptible, but the immune list names Seminars without a Researcher, cooling buildings and the Verifier, all of which take controllers | "Immune unless holding a Learned or Distilled controller: furnaces, drills, plain assemblers, Crawlers, Seminars without a Researcher, cooling buildings, the Verifier. Always immune: belts, inserters, power plants, Terminals, Monitors, the Constructor, towns" | Applied: 03 §3.1; 10 §5.17; `meta.runaways.susceptible` |
| D6 | M3 | **Are links transitive?** 03 says "linked to any powered member"; 10 builds union-find link clusters, so A reaches C through an unpowered B | One hop: two machines are linked when they share one data-line network, exchange, Switch area or hub area. The overlay's clusters show the eventual reach | Applied: 03 §3.3; 10 §5.17, R8; `meta.runaways.spread.hop_rule`; `enemies.yaml` (runaway targets) |
| D7 | M3 | **Circuit connectors on susceptible machines.** The tripwire needs the Compromised signal, but labs, beacons, furnaces and silos have no connector in Factorio | Give every susceptible type a connector that outputs only the Compromised signal where 2.0 has none | Applied: 03 §3.3; 07 §10.1; 10 §5.15; `meta.runaways.compromised.connector` |
| D8 | M3 | **The leak tooltip with mixed deployments** (tiers 1–3 and 4; quality hidden before *Interpretability*) | "Largest share: {building} at ({x}, {y}), tier {t}, {quality}. Rate {r} per hour from {n} deployments. Verification {o} of 4.", using that building's tier and quality ("?" before *Interpretability*) | Applied: 03 §3.2; 07 §4.1, §10.6; 08 §4.7, §5.2; 01 §12.4; 10 §5.17 |
| D9 | M4 | **Takeoff technologies can be researched before closure.** All of *Model generation* 6–25 costs about 9,600 frontier-run cards, so a player can research the whole takeoff before building a hall: Takeoff then reads seconds or a negative time, and *Hard takeoff* is trivial. The Constructor can also arrive before closure, against 04 §2.5 | Gate every System-card-only technology behind the closure event: a new trigger type `craft-recipe` (`recipe: research-run`, count 1) on a hidden technology *Loop closed*, made a prerequisite of *Model generation* and the hardware line | Applied: `technologies.yaml` (`loop-closed`, T08, hidden; seven prerequisites), `meta.endgame.closure`, `text.yaml` (the closing-the-loop entry); `tools/validate_spec.py` (craft-recipe trigger, `hidden`), `tools/render_spec.py`, SCHEMA; 04 §1, §2.5, §5; 07 §5.2, UI-G28; 08 §4.6, §8.4; 10 §5.5, §5.12, §12, R18; 00 §7–§9; 02 and 05 regenerated. The five round-4 sims reproduce their `.out` unchanged |
| D10 | M4 | **The scheduler's order.** "Next Model generation level, else the fewest units" fills the 7-slot queue with hardware while level k+1 is unavailable, so hardware is researched at low Π and the takeoff runs slower than 04 §5's reference | Append one entry per check: the first technology in `meta.endgame.takeoff_order`, extended with levels 16–25 and then *Energy per operation*, that is neither researched nor queued and whose prerequisites are all researched. If there is none, append nothing | Applied: `meta.endgame.takeoff_order` (a list, extended with levels 16–25 and *Energy per operation*), `meta.effects.research-queue-auto`; validator (order check), renderer, SCHEMA; 04 §5.1 and §13 #6 (read strictly, with a pass-over clause; `R5-apply-d10.py`); 07 §5.3; 10 §5.12, R13; 00 §8–§9 |
| D11 | M4 | **The doubling-time readout around dips.** After any dip (an empty queue, a blackout) DT measures the seconds since the dip, which corrupts *Fastest doubling* and the history | DT(t) = t − max{s ≥ closure : R̂(s) ≤ R̄(t)/2}, where R̂ is the running maximum of R̄. Record *Fastest doubling* and history entries only at new maxima | Applied: 04 §8, §9, §12; 07 §5.1, UI-G29; 08 §4.1; 10 §5.11, §5.20, R19; 01 §13.1 |
| D12 | M4 | Smaller endgame points | (a) Peak research rate counts finite technologies only, or *Energy per operation*'s cheap levels after the capstone inflate it from 144 to about 240 per hour. (b) Make the default r exactly ln 2 / ln 1.5 (shown as 1.71), so that m = 2. (c) *Priority* requires the race to have been won (a `race_won` parameter); a later victory shows the report again without the race line. (d) Plasma: 25 MJ per unit (from `plasma_mw / plasma_per_s`), and the fusion neighbour bonus raises plasma output without fuel, as Space Age does. (e) The Constructor's and Area scanner's signals follow the Recursive Blueprints mod's tables; the scanner rescans when a chunk version in its rectangle changes. (f) "Powered" for a Researcher Seminar means min(normal satisfaction, u_p) > 0. (g) A Seminar's coolant box exists from *Liquid cooling* and needs flow only while a Researcher is installed. (h) The Final-report run's curve falls 1.92 → 1.66 (L∞ 1.6, B 0.32). (i) An achievements window (07 §13.7, M4) | Applied: (a) 04 §8, 08 §4.1, 10 §5.20. (b) `meta.world_settings.returns_to_research`, renderer, 04 §9, §12, 07 §17, 10 §5.12. (c) `text.yaml` (*Priority*, `race_won`), 03 §6, 04 §8–§9, 07 §13.4, 08 §4.3, §6, 10 §5.20. (d) `entities.yaml` (fusion reactor), validator (plasma check), SCHEMA, 10 §5.7. (e) `entities.yaml` (Constructor, Area scanner), 04 §2.5, 10 §5.2. (f) `meta.runaways.compromised.powered`, 01 §8.6, 03 §3.3, 04 §2.4, 10 §5.17. (g) `meta.heat.coolant.seminar_box`, SCHEMA, 01 §8.6, 03 §1.4, 04 §2.4, 07 §8.3, 10 §5.9. (h) 07 §13.1, 08 §4.2, §8.4. (i) 07 §13.7, §18, 04 §9, 08 §6, 10 §5.20, §12 |
| D13 | M5 | Wild-only gaps | Damage categories: add `meta.damage_categories` and `extra.ammo_category` on every damage dealer; "arc" bonuses apply to the arc turret. The escape timer re-arms after every expiry; with no agent hubs, measure the nest distance from the Site's built area | Applied: `meta.damage_categories`, `meta.effects.ammo-damage`, `extra.ammo_category` on the turrets, artillery, land mine and Legged agent (`entities.yaml`), damage categories on the Interceptors and the defense equipment (`items.yaml`), `meta.runaways.escape_rule` and `nest.site`; validator, SCHEMA; 03 §3.6; 10 §5.17, R20 |
| D14 | later | **R5-play #5** (deferred by the coordinator): cite the takeoff hardware that has literature: wafer-scale integration (1984), optical interconnects (1984), mixtures of experts (1991) | Verify the sources first (P18). The change is mechanically inert, because System-card technologies never publish | Not applied: deferred to a later content pass (DECISIONS §42); noted where the hardware is listed: 04 §5, 05 §6 (via `tools/render_spec.py`) and a comment in `technologies.yaml` |
| D15 | taste | Minor text calls | Keep *Interpretability*'s note "It was always there." (R5-play praised it; the UI review called it a wink). Allow `asserts` on achievements, or exempt an achievement's own condition from P17. Keep the leak bar, or drop it to honour 08's "no meter" | Applied: 08 §1.2 (P17's exemption), §2 (the leak bar), §5.2 (*Interpretability*'s note kept), §6, §12; 07 §4.1; `text.yaml` header; SCHEMA (`asserts` on achievements); validator (an achievement's digits against its condition) |

## 5. Readiness verdict

**Start M0 and M1 now.** The data contract is validated and documented, the slice is a generated filter with its tests, and the engine plan has an exact rule for every M1 system. Every number M1 tests against was re-derived from data or a simulation during this gate: S-G3, S-G4, the staffing table, the heat golden, the manifest counts. The four M1 decisions (D1–D4) are small and can be settled during S1 and S9. Settle D5–D8 before M3 and D9–D12 before M4 (all settled since: DECISIONS §40, applied by R5-apply). The spec's entry point is `spec/README.md`.

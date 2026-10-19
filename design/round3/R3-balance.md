# R3 — Quantitative balance critique

*Round 3 critic, lens: run the numbers. Every figure below comes from a script in `design/round3/balance-data/` run against the final `spec/data/*.yaml` and the Factorio 2.0 dumps in `round1/E-data/`. The scripts run from any directory with `gamedev-python <script>`; the Appendix maps each section to its script.*

**Method in one paragraph.** Production lines are solved by linear programming over every recipe, ours and Factorio's: 1 pack/s, raw use minimised, byproducts may be voided, catalysts and probabilities netted. Machines are set at the mid-game standard: Assembling machine 2, steel furnaces, chemical plants, refineries, Data plants, Trainers and Tokenizers at speed 1–2, drills at 0.5/s. Pacing uses a *competent Factorio veteran*. That player's factory supports a research rate that rises linearly, calibrated so that Factorio 2.0's whole red–yellow non-military tree (1.32 M lab-seconds) finishes at 8.0 h; the same factory is then run on our tree, with and without the staffing cap. 6-h and 12-h variants bracket it. Heat re-runs 03 §1.2's exact field rule. The takeoff re-runs R2-W's `r2w_full.py` unchanged and reproduces 49.0 min to the decimal, then varies one assumption at a time.

---

## Ranked issues

### B1 — blocker: which recipes accept productivity is unspecified, and some chains multiply without bound

- **Where.** `data/SCHEMA.md` (recipes); `recipes.yaml`; `technologies.yaml` `nanofabrication`.
- **What's wrong.**
  - Factorio lets productivity modules work only on recipes flagged `allow_productivity`; in 2.0 base that is 42 recipes.
  - Our schema has no such field, and no spec chapter says which recipes accept Learned controllers.
  - Learned controllers are reachable in the vertical slice: *Backpropagation* (G31) is a green technology. So the engine needs the rule at M1.
- **Evidence.** Left open, the rule decides three outcomes:
  - **Research halls.** If *Research run* accepts productivity, four Learned controllers 3 give +40% System cards per Dataset. That is a research multiplier missing from 04's model.
  - **The experiment loop.** If *Analysis* and *Meta-analysis* accept it, as uranium processing and Kovarex do in 2.0, Significant results rise by up to 1.4×.
  - **The accelerator chain.** Accelerator → Accelerator 2 → 3 → 4 is a chain of four recipes. *Nanofabrication* gives +100% to all four (`recipes: [accelerator, accelerator-2, accelerator-3, accelerator-4]`), so one base accelerator yields 2⁴ = **16** tier-4 accelerators. G's model assumed ×2 (`chain=2.0`). If modules also apply, up to Factorio's +300% cap, the chain multiplies by up to 4⁴ = 256.
- **Fix.**
  1. Add a recipe field `allow_productivity: true` (default false) to SCHEMA. Set it on the mirrors of Factorio's 42:
     - smelting and transcription (plates, steel, silicon, token);
     - gear, stick, cable, logic board, processor, accelerator, engine, electric engine, drone frame, rack, barrel, drive;
     - sulfur, acid, lubricant, wafer, battery, explosives;
     - deduplication, quality-filtering, denoising, rephrasing, synthetic-data (coal liquefaction: catalyst ignored);
     - dataset, benchmark, adversarial-set, corpus (plastic, sulfur and rocket-fuel slots);
     - all seven paper recipes, run-shard (rocket part);
     - experiment, analysis (uranium processing), meta-analysis (Kovarex, catalyst excluded);
     - uranium-processing, kovarex-enrichment-process, nuclear-fuel-reprocessing, uranium-fuel-cell.
  2. Leave it **false** on `checkpoint` (it fills the productivity module's slot in Preprint), `research-run`, `accelerator-2/3/4`, `copy-weights`, `researcher`, `ratings`, `post-training-payload` and `final-report`.
  3. `technologies.yaml` `nanofabrication`: `recipes: [accelerator, accelerator-2, accelerator-3, accelerator-4]` → `recipes: [accelerator]`. One base step at +100% doubles the output of every tier, which is G's ×2.

### M1 — major: staffing binds in the green tier and nowhere else, so the Researcher is mechanically irrelevant

- **Where.** 01 §8.1, §8.3, §8.7, §8.8 and §14 Objection 1; `meta.yaml` `staffing`; 04 §2.4.
- **Evidence (§2 below; `pacing*.py`).**
  - **01 §8.8 was computed on E's 2-hour-doubling pace,** under which the cap **never binds at all** (re-run: 0.0 h staff-bound).
  - **A competent player is staff-bound from about 0.8 h**, in early green, not in Article as §8.8 says. By 2–3 h the factory could feed 23–34 lab-equivalents, but the starting college supplies 11, so a factory-sized Seminar block sits at 39–50% satisfaction. Without a claim the green tier stretches from 3.1 h to 4.3 h (+38%).
  - **One college claimed at 2 h removes almost all of it.** Green then takes +0.27 h, and only 2.3 h of the game are staff-bound.
  - **Switches dissolve the cap at Preprint.** A boosted Seminar runs at lab speed 2.9–3.5 × 6.24 (2 Coprocessor 3 plus 8 Switches), the work of 18–22 speed-1 Seminars. At yellow the starting college's cap is about 365 lab-equivalents against a factory of about 90.
  - **G's plateau is run-bound, not talent-bound.** The white phase is six frontier runs (§2).
  - **The Researcher does nothing measurable.** At closure the starting college's human Seminars supply 18.4 staff × 3.5 × 6.24 ÷ 30 s ≈ **13.4 System cards/s**. Re-running the reference takeoff with Seminar capacity frozen at that value and **no Researchers** gives **48.4 min, against 49.0** with them. The takeoff never needs more than about 6 cards/s: capacity frozen at 6.3 gives 48.8 min, at 4.3 gives 52.3, at 3.2 gives 60.7. DECISIONS §7's centrepiece ("the bottleneck the takeoff removes") removes nothing.
- **Fix (option B, recommended; it is R2-W's own fallback plus two numbers).**
  1. `meta.staffing.demand`: `1 per working Seminar` → **`1 + the Seminar's speed bonus from modules and Switches (lab-speed research is free); a Seminar holding a Researcher demands 0`**. 01 §8.3 gets the same sentence. The Seminar GUI shows it ("Staff demand 2.4").
  2. `meta.staffing.t0.starting-college`: **8 → 12**, which also changes 01 §8.1 and §9.
     - It softens the slice's green-tier squeeze: green takes +0.2 h rather than +1.2 h for an 8-h player with no claim.
     - Hour one still meets 01's legibility target: 13.7 staff at 1 h, so a ten-Seminar block is at 100% and the cap is shown on the overlay.
  3. `technologies.yaml`: `cost.time` **30 → 60** for `model-generation`, `model-generation-25` and the 12 takeoff hardware technologies.
     - This makes them match the white technologies (60 s) and doubles the Seminar time each System card needs.
     - Takeoff times are unchanged when Researchers are built: 48.4–50.7 min in every claim scenario.
- **Result of option B** (`wsim_r3/r3_optionB.py`), takeoff with and without Researchers, by universities claimed:

| Universities at closure | Human capacity (cards/s, 60 s per unit) | Takeoff with Researchers | Takeoff without |
|---|---|---|---|
| Starting college only | 1.6 (floor 2.1) | 50.6 min | **86.1 min** |
| + 1 college | 2.4 | 50.7 min | **77.2 min** |
| + college + town | 3.7 | 48.9 min | 55.9 min |
| + college + 2 towns | 5.0 | 48.5 min | 50.0 min |

  - **Pre-closure cost** for an 8-h player with only the starting college: the white phase's lab time ends 0.5 h later (10.24 h against 9.75 h uncapped). One claim removes that.
  - For a fast 6-h player with no claim it is +2.6 h, so towns must be claimed. That is the intended game.
- **Lighter alternative (option A)** if the hard rule feels un-Factorio.
  - Switches affect a Seminar **only while it holds a Researcher**; a Seminar counts as a computing machine then. Keep the demand rule and set T₀ = 12.
  - Human capacity at closure is then 27 staff × 3.5 × 2 ÷ 60 s ≈ 3.2 cards/s, and the takeoff without Researchers is about 61 min. Claims erode this faster than under B.
- **Either way, rewrite 01 §8.8** with the competent-pace table of §2 below, and restate its targets:
  - *first bind at about 1 h, legible;*
  - *one claim by mid-green keeps a competent player near the factory's pace;*
  - *without Researchers the takeoff runs 1.5× slower.*
  - Delete Objection 1's claim that the cap "binds in Article".

### M2 — major: Research halls take modules and Switches that 04's model ignores; efficiency modules delete the power and heat brakes

- **Where.**
  - `entities.yaml` `research-hall` (`module_slots: 4`);
  - 04 §2.3 ("Module slots 4 (proposal)"), §3.1 (`(1 + module energy)`), §3.2 (`(1 + Σ module and Switch speed)`);
  - 00 §2 pillar 5 ("braked by power, heat and accelerators").
- **Evidence** (`wsim_r3/r3_modules.py`).
  - **Efficiency modules.** Two Distilled controllers 2 (−40% each) reach Factorio's −80% energy floor, so a hall draws 1 MW instead of 5, at the cost of 10 extra accelerators per hall.
    - The reference takeoff time barely moves (49.0 → 49.3 min).
    - What binds changes completely: from compute 35% / power 33% / cooling 31% to **compute 91% / cooling 9% / power 0%**.
    - The pillar's power and heat brakes vanish for any veteran who puts efficiency modules in halls. Heat falls 5× with power.
  - **Speed modules.** Four Coprocessors 3 plus eight Switches give a hall ×7.2 speed at ×9.7 power.
    - The overhang statistic (accelerators) then understates hall throughput 7×.
    - The *Hard takeoff* threshold of about 1,000 halls in 04 §7 no longer means anything.
- **Fix.**
  - `research-hall.module_slots`: **4 → 0**. Add `extra.switches: none`, with the line "A hall's speed is its accelerators' tier; Switches and modules do not apply."
  - 04 §2.3: replace "Module slots | 4 (proposal…)" with "Module slots | none; not affected by Switches".
  - 04 §3.1: delete `· (1 + module energy)`. 04 §3.2: delete `· (1 + Σ module and Switch speed)` from `v_hall`.
  - G's model and every 04 number then describe the game as specified. The Frontier cluster keeps its 4 slots (ISO silo).

### M3 — major: the experiment loop makes the Article line 3.1× Factorio's blue before Meta-analysis and 1.6× after

- **Where.** `recipes.yaml`: `experiment`, `analysis`, `meta-analysis`, `meta-analysis-baselines`. Also 02 §7 and 02 Objection 1.
- **Evidence** (`exploop.py`, LP at 1 Article/s; Factorio's blue line is 95 machines and 9.2 MW without mining):

| Article line | Machines | × Factorio | Electric MW | × Factorio | Trainers | Data plants | Crawl/s (Factorio crude 38) |
|---|---|---|---|---|---|---|---|
| As data, no Meta-analysis | 291 | **3.06** | 72.9 | **7.9** | 120 | 63.5 | 154 |
| As data, Meta-analysis | 149 | 1.57 | 27.5 | 3.0 | 42.3 | 8.7 | 21 |
| R2-D's knob (Analysis 1.2 s), no Meta-analysis | 183 | 1.93 | 29.7 | 3.2 | 12.0 | 63.5 | 154 |
| R2-D's knob, Meta-analysis | 134 | 1.41 | 21.6 | 2.3 | 27.5 | 8.7 | 21 |
| **Proposed, no Meta-analysis** | 155 | 1.63 | 26.1 | 2.8 | 24.0 | 23.5 | 154 |
| **Proposed, Meta-analysis** | **110** | **1.15** | **12.8** | **1.39** | **8.5** | **3.2** | **21** |

- **Why the line is so heavy.**
  - The loop replaces the sulfur slot, which Factorio fills with 0.25 chemical plants per blue pack/s, with an Analysis recipe that is 10× slower per input than uranium processing: 12 s per *one* run, where uranium takes 12 s per *ten* ore.
  - R2-D's own knob (Analysis 1.2 s) leaves Experiment at 5 s, so 63 Data plants remain. With Analysis that fast, Meta-analysis at 60 s also becomes *worse* in Trainer time than plain Analysis (27.5 against 12 Trainers): the Kovarex incentive inverts.
- **Fix.** Scale all three times together and keep Kovarex's 1 : 5 ratio between Analysis and Meta-analysis:
  - `analysis.time` **12 → 2.4**;
  - `meta-analysis.time` and `meta-analysis-baselines.time` **60 → 12**;
  - `experiment.time` **5 → 1**.
- **What the fix keeps.**
  - α = 0.05, the 40-catalyst bootstrap and the File drawer joke stay untouched.
  - Meta-analysis stays a large upgrade: 1.6× → 1.15× machines and 7.3× less prose.
  - The bootstrap (200 Articles for the technology plus a 40-result stock = 2,800 runs) drops from 9.3 to 1.9 Trainer-hours. That is still a Kovarex-style grind, about 11 minutes with 10 Trainers.
  - Update 02 §7's build-size paragraph accordingly.

### M4 — major: fusion reactors with neighbours emit zero or negative heat, and 10-architecture contradicts DECISIONS §18a

- **Where.** `entities.yaml` `fusion-reactor` (`heat.emission: conversion`; `neighbour_bonus: '+100% per adjacent active reactor'`); DECISIONS §18a; 03 §1.1; 10-architecture §5.9.
- **What's wrong.**
  - §18a exempted the fission reactor because its neighbour bonus creates heat without fuel. The data gives the fusion reactor the same bonus but keeps the conversion rule:
    - one reactor alone emits 300 − 100 = 200 MW;
    - a reactor with two neighbours (300 MW of plasma) emits **0**;
    - with three neighbours it emits −100 MW.
  - So fusion blocks, which arrive mid-takeoff with *Fusion power*, become heat-free power. A fission 2×2 block, by contrast, emits 960 MW.
  - 10 §5.9 also states "the general rule is energy conservation… Reactors and fusion generators follow the same rule from their data". Read literally, that zeroes fission blocks too.
- **Fix.**
  - `fusion-reactor.heat.emission`: `conversion` → **`twice-output`** (2 × plasma energy passed on).
  - DECISIONS §18a and 03 §1.1: "For the nuclear and the fusion reactor…".
  - 10 §5.9: replace "Reactors and fusion generators follow the same rule from their data" with "**An entity's `heat.emission` field decides: `conversion` (boilers) = fuel − exported; `twice-output` (nuclear and fusion reactors) = 2 × heat or plasma passed on; `none` (generators, heat exchangers, turbines) = 0.**"

### M5 — major: what a throttled Switch does is undefined, so beacon blocks are thermally free

- **Where.** 03 §1.3 ("crafting or research speed × m"); `entities.yaml` `switch` (`heat.class: cluster`).
- **What's wrong.** A Switch neither crafts nor researches, and Seminars without a Researcher never throttle. So the hottest mid-game block, beaconed Seminars at up to 27 MW per chunk (40 °C, §3), carries no thermal consequence the spec defines.
- **Fix.** Add to 03 §1.3: "**A throttled Switch transmits its modules' effects × m** (speed, productivity, consumption and quality alike); its own draw is unchanged." Mirror it in 10 §5.9 step 5.

### M6 — major: in Contained mode a single compromise can take the whole base in about 4 minutes through logistic-agent links

- **Where.** 03 §3.3 (links, spread); `meta.runaways.spread_interval_s`.
- **Evidence.**
  - Any agent-hub network holding one Logistic agent links every susceptible machine in its area. That includes every machine holding a Learned or Distilled controller.
  - A late base therefore forms one cluster of about 500–3,000 machines. Spread doubles every 20 s at tier 4, so the whole base falls in 20 s × log₂ N = **3.0–3.8 min**, and in 9–12 min at tier 1.
  - A 40-hall Switch block falls in 1.8 min, which is fine: the player drew that boundary and a tripwire answers in one tick.
  - The logistic network is not a boundary anyone draws on purpose. Logistic agents are blue-tier and used everywhere.
- **Fix.**
  - 03 §3.3 Spread: "Within a **Switch area or a data-line network**, every compromised machine copies itself each interval (exponential). Along **agent and exchange links**, each *infection* adds one machine per interval (an agent carries one copy per trip)."
  - Add `spread_rule: {switch: per_machine, data_line: per_machine, agents: per_infection, exchange: per_infection}` to `meta.runaways`.
  - At tier 4 that is 3 machines a minute base-wide: visible, catchable, still costly.

### M7 — major: the Research hall's model tier contradicts itself, changing takeoff compromises 3×

- **Where.** 03 §3.1 (`research-hall`: tier 4); `meta.yaml` `runaways.model_tier.research-hall`: `'min(4, 1 + floor((L − 5)/5))'`; 05 Objection 9.
- **Evidence** (`wsim_r3/r3_leak.py`, reference takeoff, 174 hall-hours):

| Quality and Oversight | Halls at tier 4 (03) | Tier by Model-generation level (meta) |
|---|---|---|
| Standard, O = 0 | 6.95 | 2.17 |
| Standard, O = 3 (anyone who researched the three quality-line techs) | 2.78 | 0.87 |
| Verified, O = 2 | 2.08 | 0.65 |

- **Fix.** Halls run the frontier checkpoint, which is tier 4 everywhere else (Researcher, Rollback). So set `meta.runaways.model_tier.research-hall` → **`4`** and delete G's formula.
- **Also correct 03 §3.2.** "7–8 compromises" holds only with O = 0. Most players will have O = 3: *Rejection sampling*, *Beam search* and *MCTS* unlock the Comparators. State the realistic figure, about 3 per takeoff and about 0.15 before closure.
- If more containment work is wanted, raise the leak `0.01/h` → `0.03/h`, which gives about 8 compromises per takeoff at O = 3.

### M8 — major: σ at the first run spans 0.12–0.69 depending on how much of the tree the player researches

- **Where.** 01 §12.3 (calibration "σ ≈ 0.3 at the first run", which assumed 5,000 Model cards); `meta.world_text.sigma.per_ratings: 0.0003`.
- **Evidence** (`sigma.py`). Ratings are forced: 1 per 3 Model cards, plus 100 per run.

| Model cards researched before the first run | σ at the first run, a = 3·10⁻⁴ | σ at closure | σ at the first run, a = 2·10⁻⁴ | σ at closure |
|---|---|---|---|---|
| Path only: 1,200 | 0.12 | 0.47 | 0.08 | 0.38 |
| Main yellow without *Scalable oversight*: 8,700 | 0.43 | 0.58 | 0.34 | 0.50 |
| Whole main yellow tier: 13,700 | **0.53** | 0.63 | 0.43 | 0.55 |
| Including Branch M: 33,450 | 0.69 | 0.73 | 0.62 | 0.67 |

- **Why it matters.**
  - A player who researches the yellow tier closes **city** exchanges (0.45), the richest crawl sources, before the first run.
  - That cost follows research volume, not a deployment choice, which breaks 03 §0 rule 2 ("pressure follows only quantities the player controls").
- **Fix.**
  - `sigma.per_ratings` **0.0003 → 0.0002**.
  - Recalibrate 01 §12.3: "metropolises close during yellow, cities around closure."
  - State the range in 03 §2.3's table.

### Minor issues

- **m1. Pacing tables use E's 2-hour-doubling pace,** which is about 2× too slow for the tiers before yellow (§2).
  - Where: 00 §4 "Hours", 01 §12.1 W table, 10-architecture §11 ("Slice ~3 h", "Mid: Article ~8 h").
  - Competent tier ends: red 0.7 h, green 3.1–4.3 h, blue 4.5–5.8 h, purple 6.1–7.2 h, yellow 8.5–9.3 h, against E's 0.3 / 6.1 / 8.3 / 10 / 12.
  - Closure and victory still land near 12–13.5 h, because the white phase is six frontier runs.
  - Fix: replace the hours column with §2's table and add a column "competent".
- **m2. Records budget understated.**
  - Where: 01 §6.4.
  - Preprints and Model cards cost 3.33 records each (Datasets in the Tokenizer and the Checkpoint), not about 1.
  - By closure on the main tree the total is **273 k**, not 185 k (path-only 124 k; with Branch M 485 k). The starting 80 k archive runs out early in Model card (cumulative 67 k at the end of Preprint, 166 k at the end of Model card).
  - Fix: correct the table and say "3–4 further archives by closure".
- **m3. Heat is invisible through Article at spawn latitudes.**
  - Where: 03 §7, "Report" and "Article" rows.
  - Refineries beside a 61 MW steam plant: 34 °C, m = 1.00. The Article's 42-Trainer loop: 22–25 °C.
  - The first throttling at typical density appears in hot biomes (Trainers 0.67–0.92), beacon blocks (m = 0.91 at 27 MW per chunk) and the Frontier cluster in warm or Trainer-dense chunks (0.85–0.87).
  - Fix: reword the Report row to "only in hot biomes" and the Article row to "Trainer blocks in hot biomes". No number change needed; the takeoff wall is where heat is meant to bind.
- **m4. Nuclear exclusion zone.**
  - A 2×2 fission block (960 MW emitted) holds about 490 °C in-block, 243 °C one chunk out, 74 °C at three chunks and 24 °C at six.
  - Accelerator-class machines must sit **≥ 6 chunks (≈ 190 tiles)** away; Cluster-class ≥ 5.
  - Fix: add the row to 03 §1.6's calibration table so the rule is legible before the takeoff. Clamp the overlay legend at 100 °C ("100+").
- **m5. Monitors are near-immunity, and Evaluation sets are not a logistics test.**
  - A Monitor cleans within 5 s, so a compromise in range is gone before its first spread (20–60 s). One Monitor per link cluster suffices.
  - A whole game uses tens of Evaluation sets.
  - Optional fix if a supply line is wanted: `monitor` consumes 1 Evaluation set per 60 s while any working susceptible machine is in range (the reusable-holdout cost, B L13).
- **m6. Race presets are calibrated to E's pace.**
  - Once the publication term saturates (+39.5 at Literature 2024), W reaches 90 at about 42.2 / v₀ h. That is 14.1 h at v₀ = 3.0, a "coin toss" only for a player who reaches the capstone at 14 h.
  - A competent player reaches it at about 12.3–13.8 h and wins by 0.3–1.8 h.
  - Fix: *Race, hard* v₀ 3.0 → **3.4** (W = 90 at 12.4 h). Keep *Race* at 2.9.
- **m7. The white phase is six frontier runs of run-bound plateau.**
  - Factorio needs one launch. Here a run costs about 385 machines' worth of production per System card/s (Factorio's space science: 361).
  - The 8,000 System cards (six runs, the first included) take **1.5 h** with run material for 1.5 cards/s and **3.7 h** at 0.6 cards/s. E's table allows 1.3 h.
  - Fix: document it in 04 §1. If playtests drag, the knob is the white techs' counts (2,000/2,000/3,000/1,000 → 1,000/1,000/2,000/1,000 = 4 runs).
- **m8. Proceedings is light.** 15 machines and 2.5 MW per pack/s, against Factorio's military pack at 35 machines and 6.1 MW. That is acceptable for an optional pack. If parity is wanted, `proceedings` takes `+1 evaluation-set` per craft.
- **m9. The Researcher Seminar has unstated rules.**
  - Fix: `seminar` gets `heat: {class: accelerator, liquid_cooling: true, while: researcher}`.
  - The Researcher's 500 kW is not scaled by module consumption.
  - Its staff is u_p (it works only while powered). Today 04 §3.2 `v_seminar` omits u_p.
- **m10. Performance: effect bursts.**
  - After the capstone (Π ≈ 10⁶), each infinite technology completes 13–20 levels within seconds.
  - Recompute per-entity modifiers once per tick per effect type, not once per level: 6,000 machines × 30 levels in one tick is about 2–5 ms.
  - Everything else in §7 is within 10 §11's budgets.

---

## 1. Production lines at 1 pack/s, against Factorio 2.0 (`lines.py`)

Machines exclude drills, which are shown separately. Electric figures include mining; "burner" is coal burnt in steel furnaces and emitted as heat (×3 Factorio's under §18).

| Pack (ours / Factorio) | Machines: ours / F | Drills: ours / F | Electric MW: ours / F | Burner heat MW: ours / F | Crawl / crude | Notes |
|---|---|---|---|---|---|---|
| Memo / red | 12 / 12 | 6 / 6 | 1.9 / 1.6 | 0.9 / 0.4 | – | ISO; 1.6 Tokenizers, or 3.2 Keypunches, replace copper furnaces |
| Report / green | 23 / 23 | 14 / 14 | 3.0 / 3.0 | 3.0 / 1.0 | – | identical |
| Article / blue, no Meta-analysis | **291** / 95 | 51 / 42 | **78.9** / 13.3 | 12.4 / 3.5 | 154 / 38 | the experiment loop: 120 Trainers, 63 Data plants (M3) |
| Article / blue, Meta-analysis | 149 / 95 | 50 / 42 | 32.1 / 13.3 | 11.6 / 3.5 | 21 / 38 | 42 Trainers (16.9 MW of Cluster-class load) |
| Proceedings / black | 15 / 35 | 6 / 43 | 2.5 / 6.1 | 1.1 / 1.8 | 7.5 / – | light (m8) |
| Preprint / purple | 237 / 265 | 140 / 173 | 31.6 / 29.4 | 43.1 / 16.8 | 68 / 68 | 20 Trainers for Checkpoints; 3.33 records per pack |
| Model card / yellow | 252 / 272 | 139 / 174 | 50.5 / 36.5 | 29.9 / 13.9 | 68 / 107 | 40 Trainers (16 MW); 31 chemical plants for batteries |
| System card / white | 385 / 361 | 274 / 234 | 62.3 / 52.1 | 54.7 / 18.1 | 127 / 204 | water 681/s (F 210); 5.75 records per card |

**Reading.**
- Every tier except the Article is within ±10% of Factorio's machine count, and Proceedings is lighter.
- Power is 1.0–1.4× Factorio's (Proceedings 0.4×), with the Article at 2.4–6×, because Trainers draw 400 kW where Factorio's matching steps run in assemblers.
- Furnace heat is 3× Factorio's, by §18.
- At 1 SPS of every pack (Meta-analysis running) the base is about 1,070 machines, 630 drills, 30 crawlers, about 185 MW electric plus about 35 MW of Seminars and Switches, and 145 MW of furnace heat. That is the shape of Factorio's 1-SPS base.

## 2. Pacing and the staffing cap (`pacing.py` … `pacing4.py`)

**Lab time.** Per tier, ours exceeds Factorio's (05 §7):

| Red | Green | Blue | Purple | Yellow |
|---|---|---|---|---|
| +6% | +7% | +10% | +9% | +16% |

Cumulative tier-end times are only 3–6% later.

On top of that sits a new white tier before closure: 480,000 lab-seconds and 8,000 System cards from six runs.

**Tier end times in hours** (8-h competent profile; lab time only, frontier runs not included):

| Tier end | Factorio 2.0, uncapped | Ours, no staffing | Ours, T₀ 8, no claim | Ours, T₀ 8, college claimed at 2 h | Ours, option B (T₀ 12, hard rule), no claim | E's table (00 §4) |
|---|---|---|---|---|---|---|
| Red | 0.68 | 0.70 | 0.70 | 0.70 | 0.70 | 0.3 |
| Green | 2.99 | 3.11 | **4.29** | 3.38 | 3.31 | 6.1 |
| Blue | 4.34 | 4.52 | 5.83 | 4.71 | 4.82 | 8.3 |
| Purple | 5.82 | 6.07 | 7.16 | 6.21 | 6.33 | 10.0 |
| Yellow | 8.00 | 8.47 | 9.29 | 8.57 | 8.77 | 12.0 |
| White techs (lab time) | – | 9.75 | 10.46 | 9.84 | 10.24 | 13.3 |

- **6-h (fast) profile:** green ends at 2.3 h uncapped and at 4.15 h with T₀ 8 and no claim.
- **12-h (relaxed) profile:** the cap binds only from 2.3 to 4.5 h, and one claim removes it.
- **E's 2-hour-doubling pace** reproduces E's table (1.15 / 6.8 / 8.8 / 10.5 / 12.4 / 13.2 h) and is never staff-bound.

**The cap over time** (current rule, starting college only, 8-h profile). The cap is staff × L × B; satisfaction is what a factory-sized Seminar block would see.

| t (h) | W | Staff | Lab speed L | Boost B | Factory (lab-eq) | Cap (lab-eq) | Satisfaction |
|---|---|---|---|---|---|---|---|
| 1.0 | 7 | 9.1 | 1.0 | 1.0 | 11.5 | 9.1 | 79% |
| 2.0 | 19 | 11.0 | 1.0 | 1.0 | 22.9 | 11.0 | 48% |
| 2.5 | 20 | 11.2 | 1.0 | 1.0 | 28.6 | 11.2 | **39%** |
| 3.5 | 36 | 13.8 | 1.5 | 1.0 | 40.1 | 20.7 | 52% |
| 4.5 | 39 | 14.2 | 1.5 | 1.4 | 51.5 | 29.8 | 58% |
| 6.0 | 45 | 15.2 | 2.4 | 1.6 | 68.7 | 58.4 | 85% |
| 7.0 | 51 | 16.1 | 2.9 | **6.24** (Switches) | 80.2 | 291 | free from here on |
| 13.3 (closure) | 64 | 18.4 | 3.5 | 6.24 | — | 402 = 13.4 cards/s at 30 s/unit | — |

**The whole arc** for a competent player:
- yellow ends at about 8.5–9.3 h and the first run comes about 0.5 h later;
- six runs at 20–35 min each (run material for about 0.6–1.2 System cards/s) bring closure at about 11–13 h;
- the 49-min takeoff puts the capstone at about 12–14 h, close to the spec's 14.1 h.

The early tiers run about 2× faster than E's table, and the white phase is longer than E allows (m7).

## 3. Heat re-run (`heat_r3.py`; 03 §1.2's rule exactly; temperate 14 °C on grass unless stated)

- **Single-chunk response.**
  - Diffusion (7.5% of H per second) is 15× faster than Newton loss (0.5%/s), so heat spreads over a footprint of about 10 chunks.
  - Into one chunk, 4 MW gives +3.6 K at its centre and 16 MW gives +15 K. Density matters only over several chunks.
- **Memo / burner phase** (2 boilers, 20 burner drills, 24 stone furnaces, 4 Keypunches):
  - plant 23 °C, drills 27 °C, furnaces 26 °C;
  - with §18's ×3 burner draws, burners run about +7 K over F's 1× figures;
  - harmless: nothing throttles, and trees are fine below 45 °C.
- **Report end** (17 boilers, 61 MW, plus 24 MW of smelting and 10 MW of assembly):
  - steam plant 55 °C (69 °C in a hot biome), smelting 26 °C;
  - a refinery block beside the plant is at 34 °C, m = 1.00 (0.84 hot).
- **Article Trainer blocks:**

| Block | Temperate | Hot | Cold |
|---|---|---|---|
| 42 Trainers at 21 per chunk | 25 °C | 39 °C, m 0.92 | 6 °C |
| 120 Trainers (no Meta-analysis) at 30 per chunk | 38 °C, m 0.95 | 52 °C, m 0.67 | — |

  - One cooling tower per chunk, or 70% liquid cooling with coolers elsewhere, brings every case to 16–21 °C.
- **Preprint beacon blocks:** 12 Seminars + 20 Switches in 1 chunk (15.6 MW) 29 °C; 24 + 32 (27.4 MW) 40 °C, so Switches at m = 0.91 (see M5).
- **Frontier cluster alone (3.99 MW):**
  - 17.5 °C temperate, 31.5 °C hot (m 0.87);
  - 32.7 °C in a chunk shared with 40 Trainers (m 0.85);
  - one cooling tower brings it to 15 °C.
- **Power plants:** see m4 for the fission block. Twenty boilers (72 MW) give 62 °C in-plant, 34 °C at one chunk and 23 °C at two.
- **Takeoff:** 20 tier-4 halls (320 MW over 2×3 chunks) reach 153 °C air-cooled, so m = 0.5; 90% liquid-cooled they reach 28 °C, m = 1.0. F's table (03 §1.6) reproduces exactly: `round1/F-data/calib3.py` is unchanged and still valid, because boiler and fission emission equal F's "2× output".
- **The anti-cascade guards hold.**
  - Emission does not depend on m, and the floor is 0.5.
  - Interruptible compute is a negative feedback: less power means less heat.
  - The one positive loop, trees, is bounded at κ × 1/1.5 and never touches machines.
  - The exceptions are spec gaps, not spirals: fusion (M4) and Switches (M5).

## 4. The experiment loop: see M3

The Kovarex bootstrap is: *Meta-analysis* research (200 Articles = 100 Significant results) plus a 40-result stock, which is 2,800 analyses.

| | Trainer-hours | Data-plant-hours | With 10 Trainers |
|---|---|---|---|
| Now | 9.3 | 3.9 | ≈ 56 min |
| Proposed | 1.9 | 0.8 | ≈ 11 min |

R2-D's "about 42 Trainers at speed 1 per 60 Articles/min" is confirmed: 42.3.

## 5. Runaways, Contained (M6, M7, m5)

**Leak.** 0.01/h × tier × (1 − v) × (1 − 0.2·O) per working deploying building.
- **Before closure:** 3–5 tier-3 Endpoints for about 3 h give 0.36 compromises at O = 0 and **0.15 at O = 3**.
- **During the takeoff:** 150–195 hall-hours whatever the overhang (the large overhangs have more halls for less time), so the counts in M7.

**Spread** (per machine, doubling each interval):

| Cluster | Tier 4 | Tier 1 |
|---|---|---|
| 40-hall Switch block | 1.8 min | 5.3 min |
| Logistic network, about 2,000 machines | 3.7 min | 11 min |

**Containment throughput.**
- A Monitor cleans 0.2 machines/s (0.52 with *Monitor throughput* 1–6), against spread of k ÷ 20 s. So a Monitor in range wins whenever it engages before k = 4.
- In practice it cleans the first compromise before the first spread.
- A fully fallen cluster needs about k ÷ 4 Monitors, or a 30-second blackout.
- Evaluation sets used: about 1–2 per compromise.

**Verdict.** Contained is fair and legible: the leak is deterministic, and the next building is named in advance. It is light, and it collapses to "one Monitor per cluster". The unfair part is the base-wide logistic link (M6).

## 6. Takeoff re-run (`round2/W-sim/r2w_full.py` unchanged; R3 variants in `wsim_r3/`)

- **Reproduced exactly.** 49.0 min. Doubling time 10.0 min → 1.0 s. Last 20 techs in 6.2 min, last 10 in 57 s. Peak 144 techs/h. Binding: compute 35 / power 33 / cooling 31 / Seminars 1%. Brakes: half-speed builder 60.3, no cooling 65.9, no power 74.3, no building 105.6 min.
- **Returns to research (r):**

| r | 1.2 | 1.71 | 2.0 |
|---|---|---|---|
| Active builder (min) | 70.2 | 49.0 | 41.7 |
| No building (min) | 267 | 106 | 79 |

  The best order depends on r: the "gens-first" order is 88.4 / 48.5 / 40.1 min. That holds.
- **Overhang:**

| Halls at closure | 25 | 100 | 400 | 1,500 |
|---|---|---|---|---|
| Takeoff (min) | 64 | 49 | 22 | 6.7 |

  The sweep matches 04 §7. *Hard takeoff* needs about 1,000 halls: 20,000 accelerators and 5 GW, with M2 fixed.
- **Final data against the model's inputs.**
  - Costs, hall tiers, the 60-s *Research run* and the φ costs all match the YAML.
  - The model does **not** contain:
    - modules and Switches on halls (M2);
    - *Nanofabrication*'s ×16 chain (B1; after the fix it is ×2, which the model already has);
    - the Researcher's irrelevance (M1);
    - the Dataset input: about 9,600 Datasets over the takeoff (4,800 records, 96 k prose). That is light, because cards needed per level fall as 0.75^k.
  - Hollow work at the typical O = 3 is h = 0.1 for standard Researchers, about +7% if Researchers did all the Seminar work. That is negligible under the current rule, and it matters under M1 option B.

## 7. Scale against 10 §11's performance targets

- **Closure base at 1–1.5 SPS** (§1 × 1.5): about 1.6 k machines, 0.95 k drills, about 0.1 k Seminars and Switches. With Factorio's usual ratios (about 3 inserters and 15–30 belt tiles per machine) that is roughly 5 k inserters, 30–50 k belt tiles and **60–90 k entities**. That is about half of the "Late" budget (150 k entities, 6 k machines), so there is headroom for a 3–5 SPS player.
- **Takeoff.**
  - The reference adds 100 → 241 halls and about 2 GW. Fission: 4–5 2×2 blocks of about 200 entities each, so about 1 k entities.
  - The *Hard takeoff* megaproject (1,000+ halls, 5 GW, about 11 blocks) adds about 12 k entities. That is within the 400 k stretch target, but above the "Takeoff" row's 250–500 halls. Note it there.
- **Simulation costs that scale with the new systems:**

| System | Cost |
|---|---|
| Heat chunks (base plus about 3-chunk margin, about 1 k chunks ÷ 64 ticks) | about 16 chunk-updates per tick |
| Staffing recompute | O(Seminars) every 60 ticks |
| Spread with M6's fix | per-infection nearest-neighbour queries, a few per second |

  All negligible. The only spike found is m10.

---

## What is good and must not be lost

- **Tiers keep Factorio's shape.** Memo and Report lines are identical to Factorio's. Preprint, Model card and System card are within ±10% in machines and close in raw ore and crude-equivalent. Lab time per tier is +6–16%, but cumulative tier-end times are only 3–6% later. R2-D's data really is "Factorio's numbers, re-skinned".
- **Heat's numbers are sound.** Newton cooling gives a local field with a footprint of about 10 chunks. F's calibration reproduces exactly under §18's conversion, so §18 changed item flows by nothing and plant heat by nothing. The four guards hold. Liquid cooling plus off-site exchangers is a clean answer to the takeoff's thermal wall (153 °C → 28 °C).
- **The takeoff model is robust.** 49.0 min reproduces exactly. Its r-dependence (the order of hardware against software flips at r ≈ 1.7) and the overhang curve, from 64 min at 25 halls to 6.7 min at 1,500, are real, legible strategy. Keep G's φ = 0.15 costs and geometric infinites.
- **The leak is deterministic, and the next compromise is named.** That legibility is exactly right. Keep it whatever rates are chosen.
- **The experiment loop's shape** (α = 0.05, the File drawer, Kovarex's 40 catalyst) is worth keeping. Only its clock is wrong (M3).
- **Records as finite low-background ore** (3.33 per Preprint and per Model card, 5.75 per System card) produce a real data wall that pushes expansion like ore depletion does. Keep the recipe amounts; fix only the budget text (m2).
- **The staffing UI design** (the coverage overlay like power poles, "Understaffed 74%", the university panel) is the right vehicle. M1 changes only the numbers it shows.

---

## Appendix: scripts (`design/round3/balance-data/`)

| Script | Computes | Sections |
|---|---|---|
| `load.py` | Loads `spec/data/*.yaml` | all |
| `lines.py` | LP production lines at 1 pack/s, ours and Factorio's (`round1/E-data/recipe2077.json`) | §1 |
| `exploop.py` | Experiment-loop variants and bootstrap | M3, §4 |
| `tiers.py` | Lab-seconds by tier; gateway prerequisite closures | §2 |
| `pacing.py`, `pacing2.py`, `pacing3.py`, `pacing4.py` | Competent-player pacing; staffing rules (soft, hard, Switch-less), T₀ and claims; 6/8/12-h profiles | M1, §2 |
| `heat_r3.py` | 03 §1.2 field with the final data's emitters, per tier | M5, m3, m4, §3 |
| `records.py`, `records2.py` | Records per pack and cumulative by tier | m2 |
| `sigma.py` | σ at the first run and at closure by research completeness, for a = 3·10⁻⁴ and 2·10⁻⁴ | M8 |
| `wsim_r3/r3_modules.py` | Takeoff with efficiency and speed modules in halls | M2 |
| `wsim_r3/r3_leak.py` | Takeoff compromises under both hall-tier rules | M7 |
| `wsim_r3/r3_labs.py` | Takeoff against fixed Seminar capacity (Researcher relevance) | M1 |
| `wsim_r3/r3_optionB.py` | Option B: hard rule, T₀ 12, 60 s per unit, with and without Researchers | M1 |

The `wsim_r3/` scripts import R2-W's unchanged `round2/W-sim/` modules. R2-W's own scratch copies (00 §10) are already preserved there.

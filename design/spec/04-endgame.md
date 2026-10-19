# 04 — The endgame: the loop, the takeoff, victory and after

*Round 4 revision (R4-world) of R2-W's chapter. Canon: G-endgame §2–§6 (model and numbers), E's tree (names, structure), DECISIONS §7, §11, §12, §16 and §21–§38, H's run report, B L16. Round 4: takeoff technologies at 60 s per unit (§23c), Research halls without modules or Switch effects (§25), the hall's load and upgrade rules (R3-impl L1), the scheduling rule (L6), the empty launch (coherence M7) and every run-report measurement (R3-impl U24, P20–P23). Ids are spec-data ids. Every simulated number comes from `design/round4/world-sim/takeoff_r4.py`, which imports G's `takeoff.py` and R2-W's round-2 tree unchanged (`design/round2/W-sim/`) and adds the round-4 rules; its output is saved beside it. Round 5 (R5-apply, DECISIONS §40): the takeoff technologies wait for closure behind the hidden *Loop closed* (R5-gate D9, §5), the scheduler follows `meta.endgame.takeoff_order` (D10, §5.1), the doubling time is measured from running maxima (D11, §9), and D12's endgame points are applied (§2.4, §2.5, §8, §9, §12).*

## 0. Verdict

**One production function, four regimes** (G). Research is

> **R = Σ_seminars (cards used)ᵢ × (1 − hᵢ) × Π**,   Π = m^k × (1 + 0.1·L_rp) × (1 + Seminar productivity)

| Symbol | Meaning |
|---|---|
| (cards used)ᵢ | System cards consumed per second by Seminar i (§3) |
| hᵢ | Hollow work (03 §4): 0 for human-staffed Seminars; for Researcher-staffed ones it depends on the verification count and the Researcher's quality |
| k | The number of *Model generation* levels researched (6 → 25, so k = 0 … 20) |
| m | 2 at the default returns to research. Each level doubles research per paper, globally and retroactively, the way Factorio's research bonuses work |
| L_rp | The *Research productivity* level |

| Regime | When (competent pace, 01 §12.1) | What binds | Doubling time of research |
|---|---|---|---|
| Factory-bound | Start to the end of the Model card tier (≈ 8.5 h) | Papers the factory makes (ISO); staffing briefly in late Report for a player with no claim (01 §8.8) | hours |
| Run-bound (the plateau) | First frontier run → closure (≈ 9–11.5 h) | The six frontier runs that pay the white technologies; staffing for a player with no claim | several hours |
| Takeoff | Closure → *Model generation 25*, **50 min** in the reference | Software outruns its cost (r = 1.71); power, heat, accelerators and Seminar capacity brake it | 10 min, falling to about 1 s |
| Energy-bound | After victory | Power and matter | 40–75 min, then the expansion (06) |

**Reference takeoff** (the closure state: 100 tier-1 Research halls loaded, 1,000 accelerators stocked, 40 human staff — the starting college and one college linked by Terminal, 01 §8.8 — an active builder, r = 1.71):

| Measure | Value |
|---|---|
| Takeoff | **50.0 min** (round 2: 49.0; the difference is the 60-s unit's Seminar demand) |
| Without Researchers | **78 min** (DECISIONS §23c asked for 75–90) |
| Doubling time | 10 min at *Model generation 6* → about **1 s** at 25 |
| The cascade | The last 20 techs fall in **6.3 min**, the last 10 in **63 s** |
| Peak research rate | **144 technologies per hour** (best 10-minute window) |
| What binds | Compute 36%, power 32%, cooling 31%, Seminars 1% of the time |
| Builder's time | Power 38%, cooling 29%, Seminars and Researchers 16%, accelerator lines 11%, hall space 6% |
| At the capstone | 245 halls (182 / 43 / 12 / 8 by tier), 1.1 GW of compute, Seminar capacity 12.3 System cards per second |

## 1. The arc into the loop

| Step | What happens | Technologies (E) | Notes |
|---|---|---|---|
| 1 | The frontier cluster and its run | *Scaling laws* (Frontier cluster, Run shard); *Preference tuning* (Post-training payload) | Factorio's silo. The payload needs 100 Ratings, so every run that returns System cards requires deployment (03 §2.4). An empty launch returns only the weights (§2.1) |
| 2 | **The first frontier run completes** | Triggers *In-context learning* (ISO: the space science pack's trigger) | Returns **1,000 System cards** and **1 frontier checkpoint**. The first-run panel (08 §4.2): `Run complete. Loss 3.41 → 1.92.` / `Returned: 1,000 System cards, 1 Frontier checkpoint.` It is **not** the loop's closure (step 5) |
| 3 | **The white technologies before closure**, paid with all six papers in staffed Seminars | *Chain of thought* (2,000; System cards per run 1,000 → 1,500), *Self-play* (2,000; run shard productivity +20%), *Test-time compute* (3,000; the hall mode, §2.3), *Automated research* (1,000). Optional: *Formal verification* (5,000; Reference quality) | 8,000 System cards without *Formal verification*, so 6 frontier runs (the first two at 1,000 cards, then 1,500 each); 13,000 and 10 runs with it. This is the plateau's production work |
| 4 | **Automated research** | Unlocks Researcher, Research hall, Research run, Copy weights | 08's *The last invention* fires when the first Researcher is installed before any machine has been compromised |
| 5 | **Closure**: the first System card written by a Research hall | The hidden *Loop closed* (`loop-closed`): a trigger technology that completes on the first *Research run* crafted (R5-gate D9) | The takeoff clock starts (E §5.3; DECISIONS §16). Run-report field *Loop closed*. *Model generation* and every hardware technology require *Loop closed*, so none of them can be researched before this card |
| 6 | The takeoff | *Model generation 6–25* and the hardware technologies (§5) | Paid in System cards only, at **60 s per unit** (DECISIONS §23c); available from closure on |
| 7 | **The capstone** | *Model generation 25*: ×m like the others, and unlocks the **Final report** (`final-report`), the last run's payload | — |
| 8 | **Victory**: a frontier run carrying the Final report completes | — | The run report (§8). Play continues |

**The plateau is run-bound** (R3-balance m7). A run costs about 385 machines' worth of production per System card per second (Factorio's space science: 361). The 8,000 System cards take 1.5 h with run material for 1.5 cards/s and 3.7 h at 0.6 cards/s. Factorio needs one launch; this is six, and that is the plateau's work. If playtests drag, the knob is the white technologies' counts (2,000 / 2,000 / 3,000 / 1,000 → 1,000 / 1,000 / 2,000 / 1,000, four runs).

**The knob's trigger, pre-registered** (R5-play #4; decided now so that no later balance pass reopens the white tier's shape):
- **Observation.** In the first user playtest that reaches closure (10 §12 M4's "the user plays a takeoff", or an earlier dev save played from the Model card tier), the game time from the first completed frontier run that returns System cards to closure (the first Research-hall System card, the run report's *Loop closed*).
- **Rule.** If it exceeds **2 h**, the four-run counts are adopted, with no further discussion: Chain of thought 1,000, Self-play 1,000, Test-time compute 2,000, Automated research 1,000 (5,000 System cards: two runs of 1,000, then two of 1,500). At or below 2 h, the six-run counts stay.
- **Reading.** The model's plateau is 2.5 h (six runs at about 25 min; 01 §12.1), and 1.5 h with run material for 1.5 System cards per second. So the trigger asks whether a veteran builds run material at about 1.1 cards per second or more by the first run. If they do not, six runs are waiting rather than building, and the shorter plateau is the fix.
- **Change.** Four `cost.count` values in `technologies.yaml`, then a re-run of `round4/world-sim/arc_r4.py` and `takeoff_r4.py` and a refresh of the numbers that quote them (§1 step 3, 01 §8.8 and §12.1, 00 §4 and §7). The takeoff itself is unchanged: it starts at closure.

**Why the plateau makes the overhang** (G §2.4–§2.5).
- Before closure, research is bounded by frontier runs and, for some players, by staff. Building compute then costs the player nothing they would otherwise get.
- Accelerators stocked in chests, Research halls laid out and waiting, and Researchers ready for their Seminars become the **overhang**. The overhang sets the takeoff speed (§7).
- Delaying the loop's closure always shortens the takeoff and lengthens the game. That is the honest form of the pause debate, stated by a stopwatch.
- Closure is one decision a player could make by accident, by testing one hall. The hall's tooltip and Handbook entry say what its first System card does, and a tip says what the overhang is (08; R3-fun FUN-08). Nothing else narrates it.

## 2. Buildings and items of the loop

### 2.1 Frontier cluster (`frontier-cluster`; ISO with the rocket silo)

| Property | Value |
|---|---|
| Size and power | 9 × 9, 3.99 MW (250 kW idle), 4 module slots; Accelerator thermal class (T* 25 °C). Heat throttles its run-shard crafting; the launch never throttles (03 §1.3) |
| Craft | Run shards: 10 Accelerator + 10 Rack + 10 Corpus → 1, 3 s. 100 per run. *Self-play* and *Algorithmic progress* add run-shard productivity |
| Launch | With a payload: the progress bar is a falling loss curve (H; 07 §13.1) |
| Returns | 1,000 System cards (1,500 after *Chain of thought*) and 1 `frontier-checkpoint` per completed run with a Post-training payload |
| **Empty launch** (coherence M7) | 100 run shards and no payload (`launch-empty`) → 1 `frontier-checkpoint` and no System cards. It triggers nothing. It is launched only by the GUI's launch button, never automatically: ISO with a rocket launched without a satellite. A base model is weights without post-training, so a player who will not deploy can train the model and cannot research with it |
| Final run | *Launch final*: 100 run shards + the **Final report** (`final-report`) instead of the payload. Completing it is victory (§8). The Final report is 1 Post-training payload + 1 frontier checkpoint + 1,000 System cards, 60 s in the Trainer. The final run returns what a payload run returns (System cards, 1,500 after *Chain of thought*, and a frontier checkpoint); play continues |

- **Option, not adopted:** A's power-bound run (K2's transceiver). The run would need a minimum sustained draw, and a shortfall would roll it back to its last 10% checkpoint, which is how training runs fail.

### 2.2 The frontier checkpoint and its copies (B L6)

- `frontier-checkpoint` is the run's weights on a drive. Every completed run returns one, empty runs included.
- **Copy weights:** 1 `frontier-checkpoint` (returned) + 1 `drive` → 2, in the Trainer. Kovarex's shape: copying takes a blank carrier and returns the original.
- **Used by:**
  - the **Researcher** (4 `accelerator` + 1 `frontier-checkpoint`, returned; 30 s, Trainer);
  - every **Research hall**, which loads one in its weights slot;
  - **Rollback** of a tier-4 infection, which consumes one copy through the machine's rollback input (03 §3.4).
- Its quality sets v for the leak and, through the Researcher, for hollow work (03 §3, §4).
- **Model tier 4.**

### 2.3 Research hall (`research-hall`; G's "accelerator hall", E's name; BEND)

| Property | Value |
|---|---|
| Size | 7 × 7 (E) |
| Inventories | An **accelerator inventory** of 20 single-item slots, a **weights slot** (1), the recipe's **input** (Datasets) and an **output inventory** (System cards, and accelerators swapped out; 10 §5.5) |
| Loading | Inserters may insert accelerators of any tier into empty accelerator slots and one `frontier-checkpoint` into an empty weights slot; they never remove either. Construction agents deliver both as item requests (the module-request path). Hand transfer works both ways, subject to the lock below |
| Runs | Only with 20 accelerators and weights loaded. Otherwise the status reads **Missing accelerators** (tooltip "Loaded: n / 20") or **No weights** (red) |
| Tier: speed / power | 1: 1 / 5 MW. 2: 3 / 8 MW. 3: 8 / 12 MW. 4: 20 / 16 MW (G). Tiers 2–4 need Accelerator 2/3/4 (*Wafer-scale integration*, *Photonic interconnect*, *Reversible logic*) |
| Mixed tiers | Speed = Σᵢ s(tierᵢ) / 20 and power = Σᵢ p(tierᵢ) / 20 over the 20 loaded accelerators. The GUI's "Tier" shows the lowest loaded tier |
| Recipe | *Research run*: 1 Dataset → 1 System card, 60 s at speed 1 |
| Module slots | **None, and Switches do not affect it** (DECISIONS §25): a hall's speed is its accelerators' tier, so power and heat brake the takeoff (R3-balance M2) |
| Thermal | Accelerator class, T* 25 °C; coolant box after *Liquid cooling*; throttles with m (03 §1.3) and **draws full power when throttled**. *Dennard scaling* does not apply to it (03 §1.4) |
| Power class | **Interruptible** (§3.3) |
| Runaways | A deploying building at tier 4 (03 §3.1) |
| *Test-time compute* mode | A toggle in the GUI, also settable by circuit: speed ×1.5, power ×2 |
| Upgrades | **Without *Weight transplant*,** a full accelerator inventory is locked: no insertion and no hand removal. Mining the hall returns everything. **With it,** inserting a higher-tier accelerator into a full hall replaces the lowest-tier loaded one (ties: the lowest slot index), and the replaced one goes to the output inventory, where inserters can take it |
| Quality | The quality of loaded accelerators is ignored. The hall's own quality applies, as for any crafting machine. The weights' quality sets v (03 §3.1) |

- The sprite's racks change colour with the lowest loaded tier.
- **Throughput.** 100 tier-1 halls write 1.67 System cards per second (G's W₀). At 245 halls of mixed tiers by the end of the reference takeoff, compute takes about 1.1 GW.

### 2.4 The Researcher in a Seminar (DECISIONS §7, §23; full rules in 01 §8.6)

- **What it does.** A Seminar with a Researcher in its staff slot is fully staffed whatever the towns supply, so it can take every Coprocessor and Switch the player gives it without needing more staff (01 §8.3).
- **What it costs.** It draws +500 kW in the interruptible class while the Seminar works, emits that power as heat, and throttles at T* 25 °C. It is a tier-4 deploying building; for the runaway rules such a Seminar is *powered* while min(normal satisfaction, u_p) > 0 (03 §3.3; R5-gate D12f). It may do hollow work.
- **Cooling.** Every Seminar has its coolant box from *Liquid cooling*; the box needs flow only while a Researcher is installed (03 §1.4; R5-gate D12g).
- **What it does not do.** It never raises research per paper (G §2.4). Researchers lift the talent cap, nothing more.
- **Seminar capacity during takeoff.** Takeoff technologies take 60 s per unit at one System card per unit, so a Seminar consumes speed ÷ 60 cards per second. G's rule of thumb is capacity ≥ 1.25 × the halls' output.
  - At closure the reference halls write 1.67 cards/s, so they need 2.1 cards/s of Seminar capacity. Human staff supply 40 × lab speed 3.5 ÷ 60 = 2.33 cards/s.
  - By the capstone the halls need about 12 cards/s. A Researcher Seminar at lab speed ×3.5 with 2 Coprocessor 3 and 8 Switches (×6.24) consumes 0.36 cards/s, so the last 10 cards/s take about 28 Researcher Seminars: 112 accelerators in Researchers, on top of the halls' 4,900.
- **With and without Researchers** (reference halls and builder; human capacity from the universities joined at closure, 01 §8.8):

| Universities in the network at closure | Staff | Human capacity (cards/s) | Takeoff with Researchers | Takeoff without |
|---|---|---|---|---|
| The starting college only | 24 | 1.40 | 50.3 min | 126 min |
| **+ one college (reference)** | **40** | **2.33** | **50.0 min** | **78 min** |
| + two colleges | 56 | 3.27 | 48.8 min | 60 min |
| + a college and a town | 64 | 3.73 | 48.6 min | 56 min |
| + two colleges and a town | 80 | 4.67 | 48.4 min | 51 min |

  Universities and Researchers are substitutes at the takeoff (01 §14 #2). The 60-s unit makes Researchers decide the takeoff for the reference player; the hard staffing rule (01 §8.3) is what makes the boosts they enable matter (R3-balance M1).

### 2.5 The Constructor (finale-gated; A §3.3, G; DECISIONS §19)

- *Self-reproducing automata* (a takeoff technology, §5) unlocks the **Constructor** (id `deployer`; the display name avoids a collision with "deployment", DECISIONS §19) and the **Area scanner** (`area-scanner`), which reports what lies in an area as signals.
- The Constructor is a relay sequencer driven by the circuit network. Its recipe is 1 Steel chest + 10 Logic board + 5 Decision unit, with no accelerator in it, so it is not a computing machine: it does not throttle and cannot be compromised (coherence M8 made literal). It holds a blueprint book. On a command signal it:
  - places blueprint B at offset (X, Y) with rotation R, as ghosts for construction agents;
  - deconstructs or upgrades an area;
  - copies a blueprint.
- **It arrives after closure, never before** (A: a self-building base mid-game left players "no point in playing anymore"). The data enforces it: *Self-reproducing automata* requires *Fleet scheduling*, which requires the hidden *Loop closed* (§5; R5-gate D9). The program and the blueprint book remain the player's decisions.
- **Signals** (R5-gate D12e). The Constructor's command signals and the Area scanner's inputs and outputs follow the Recursive Blueprints mod's tables (its deployer chest and scanner). The scanner rescans when its input signals change and when a chunk version in its rectangle changes (10 §5.2).
- In G's simulation it doubles the builder and lets two builds run at once.
- In the expansion's seed finale it is the only build tool (06).

## 3. The production function, exactly (G §2.2, adapted)

### 3.1 Every tick, per electric network

```
D_int   = Σ_running halls Σ_loaded p(tier)/20 · pmult_hall · (2 if test-time mode)     # an idle hall draws only its drain (10 §5.5)
        + Σ_working Researcher Seminars 0.5 MW · pmult_researcher       # interruptible demand
pmult_hall       = 0.75 after Sparse inference × Energy per operation's factor (§10)
pmult_researcher = Energy per operation's factor only
P_int   = generation + discharge left after normal consumers and accumulator charging (§3.3)
u_p     = min(1, P_int / D_int)                                        # "Compute satisfaction"
```

### 3.2 Per hall and per Seminar

```
heat into the chunk      = u_p · p · (1 − ℓ·q)       (+ u_p · p · ℓ·q into coolant)        (03 §1)
m_h                      = clamp(1 − (T_chunk − T*_eff)/50 K, 0.5, 1)
v_hall                   = s(tiers) · q_hall · u_p · m_h · (1.5 if test-time mode)       # no modules, no Switches; q_hall = the hall's own quality factor
cards written per second = Σ_halls v_hall / 60 s                     (needs 1 Dataset per card)

v_seminar   = (1 + lab-speed bonus) · (1 + Σ module and Switch speed) · f_staff
f_staff     = s (the network's staff satisfaction, 01 §8.4)                    human-staffed
            = min(normal satisfaction, u_p) · m_h                                Researcher-staffed
cards used  = min(cards available, Σ_seminars v_seminar / 60 s)      # 60 s per takeoff unit
R           = Σ_seminars (cards used)_i · (1 − h_i) · Π              # h_i = 0 when human-staffed
Π           = m^k · (1 + 0.1·L_rp) · (1 + Σ Seminar productivity)
```

- Π applies to **every** paper in every Seminar, material papers included. After the takeoff any finite technology is nearly free, which is why every infinite technology has a geometric cost (§10).
- Technologies complete exactly within a tick: R is piecewise constant, and sub-tick completions carry over (G).

### 3.3 Interruptible compute (BEND, G §2.6)

- Research halls and the Researcher's 500 kW take power only after every other consumer, and after accumulator charging. The engine needs one more consumer-priority class.
- **Allocation, per electric network and tick** (R3-impl U16), with G = generation, Dn = normal demand, Di = interruptible demand and Dc = the room the accumulators can charge this tick:
  - If G ≥ Dn: normal consumers are satisfied; charging takes min(G − Dn, Dc) first; interruptible load gets the rest; nothing discharges this tick.
  - If G < Dn: accumulator discharge covers the normal shortfall first, then interruptible load.
  - A network never charges and discharges in the same tick.
- **Why bend.** A brownout in Factorio slows every machine, including the ones that build power plants. During a takeoff that would be a death spiral, turning a brake into a punishment. Charging before compute keeps a solar base's nights powered: a shortfall slows compute before it slows the factory.
- Curtailable load is how real datacenters are being put on grids. A Factorio player reads it as "research speed = spare power", a gauge they already know.
- **Readout:** "Compute satisfaction 73%" on the electric network's info panel and power tooltip. A Researcher Seminar short of compute shows "Low power" with the line "Compute is supplied last."

## 4. Returns to research (G §2.3, DECISIONS §12)

- Model generation L costs **C(L) = 2,400 × 1.5^(L−6)** units (g = 1.5) and multiplies research per paper by **m**. The returns are **r = ln m / ln g**.
- **World setting *Returns to research*:** m = 1.5^r is read from the setting, never from a literal in the data (R3-impl J14).

| Preset | r | m per level | Takeoff, active, hardware interleaved | Takeoff, Model generations first | No building | Last 20 techs |
|---|---|---|---|---|---|---|
| Published median (Davidson & Houlden) | 1.2 | 1.627 | 72.0 min | 89.4 min | 267 min | 18.1 min |
| **Default** | **1.71** | **2.0** | **50.0 min** | 49.3 min | 106 min | 6.3 min |
| Fast | 2.0 | 2.25 | 42.6 min | 41.0 min | 79 min | 3.1 min |

**Closed forms** (G §2.3, at fixed hardware W₀):
- Level intervals shrink geometrically: τ_k = τ₁ · q^(k−1), with q = g/m = 0.75 at the default. τ₁ = C(6)/W₀ = 2,400 / 1.67 = 24 min at the reference.
- At fixed hardware the whole line takes about τ₁ / (1 − q) = 4 τ₁, plus the hardware technologies. Simulated with no building: 106 min.
- **A finite-time singularity**, truncated at level 25: R ∝ (t* − t)^(−r/(r−1)), exponent −2.41 at the default.
- The doubling-time readout halves every ln 2 / ln(1/q) ≈ 2.4 levels.
- The whole takeoff consumes only about **9,600 System cards** (Σ 2,400 · q^k), because Π grows as fast as the costs.

**The best strategy depends on r** (G §4.6):
- At r = 1.2, researching the hardware technologies between levels wins by 17 min.
- At 1.71 the two orders tie.
- At 2.0, rushing the levels wins.

No text says this. The stopwatch does.

## 5. The takeoff tree (E's names; G's costs and default order)

- **Costs.** All are paid in System cards only, one card per unit, **60 s per unit** (DECISIONS §23c).
- **Prerequisites.** *Model generation* and each hardware technology require the hidden *Loop closed* (R5-gate D9), or their predecessor in their own line; *Fusion power* also requires *Nuclear power*, and *Two-phase cooling* *Liquid cooling*. A prerequisite on a finite multi-level technology is met at its `max_level`; on an infinite one, at its first level (R3-impl U19). So *Model generation 25* becomes available only after level 24.
- **Closure gates the tree** (R5-gate D9). *Loop closed* (`loop-closed`, a trigger technology: `research-run` crafted once) is researched by the first System card a Research hall writes, the closure event itself. It has no card, no queue entry and no toast, and counts in no readout (07 §5.2). Until it completes, nothing paid in System cards alone is available. Without the gate, *Model generation* 6–25 costs only about 9,600 frontier-run cards (§4), so a player could research the whole takeoff before building a hall: *Takeoff* would read seconds, or a negative time, and *Hard takeoff* would be free.
- **Order.** The table's order is the intended one, and its costs follow G's rule φ = 0.15 × the cost of the level each follows.
- **Times** are from the reference run.

| # | Technology | Cost (units) | Effect | Done at (min) |
|---|---|---|---|---|
| 1 | Model generation 6 | 2,400 | Research per paper × m (m = 2) | 19.7 |
| 2 | Research scheduling | 360 | Researchers fill the research queue (§5.1) | 20.6 |
| 3 | Two-phase cooling | 360 | Dry cooler and Water exchanger capacity ×2 | 21.6 |
| 4 | Model generation 7 | 3,600 | × m | 30.5 |
| 5 | Wafer-scale integration | 540 | Accelerator 2: halls at speed 3, 8 MW | 31.2 |
| 6 | Weight transplant | 540 | Halls upgrade in place; old accelerators to the output (§2.3) | 31.8 |
| 7 | Model generation 8 | 5,400 | × m | 37.0 |
| 8 | Fleet scheduling | 810 | Construction agents: speed +100%, hub charging ×2 | 37.3 |
| 9 | Model generation 9 | 8,100 | × m | 40.8 |
| 10 | Fusion power | 1,215 | Fusion reactor and generator (Space Age numbers): about 5 nuclear blocks of power per block built | 41.0 |
| 11 | Model generation 10 | 12,150 | × m | 43.5 |
| 12 | Sparse inference | 1,823 | Research hall power ×0.75, retroactive (halls only) | 43.7 |
| 13 | Model generation 11 | 18,225 | × m | 45.4 |
| 14 | Photonic interconnect | 2,734 | Accelerator 3: speed 8, 12 MW | 45.5 |
| 15 | Model generation 12 | 27,338 | × m | 46.8 |
| 16 | Microfluidic cooling | 4,101 | Dry cooler and Water exchanger capacity ×2 (Tuckerman & Pease, 1981): channels in the die let the coolant run warmer | 46.9 |
| 17 | Model generation 13 | 41,006 | × m | 47.7 |
| 18 | Self-reproducing automata | 6,151 | The Constructor and the Area scanner (§2.5) | 47.8 |
| 19 | Model generation 14 | 61,509 | × m | 48.4 |
| 20 | Nanofabrication | 9,226 | The base Accelerator recipe +100% productivity (DECISIONS §30), so every tier doubles | 48.5 |
| 21 | Model generation 15 | 92,264 | × m | 48.9 |
| 22 | Reversible logic | 13,840 | Accelerator 4: speed 20, 16 MW (Bennett, 1973) | 48.9 |
| 23–31 | Model generation 16–24 | 138,396 … 3,546,941 | × m each | 49.3 → 49.97 |
| 32 | **Model generation 25 (capstone)** | 5,320,411 | × m; unlocks the Final report | **49.99** |

- **Doubling time per level** (reference): 6: 10.2 min · 7: 9.7 min · 8: 4.5 min · 9: 3.4 min · 10: 2.5 min · 11: 1.8 min · 12: 74 s · 13: 53 s · 14: 39 s · 15: 28 s · 16: 18 s · 18: 8.7 s · 20: 4.6 s · 22: 2.5 s · 24–25: about 1 s.
- **Levels start at 6** (DECISIONS §11): the first after the Fifth Generation project (1982). The levels are `regime: beyond` (DECISIONS §35); a Handbook note carries the Fifth Generation, and no citation counts toward Literature. Each level carries a field-year, 2025 + 0.5 × (L − 5), for the Field readout (01 §12.1). Level 25 reads 2035.
- **Hardware technologies are a choice, not filler** (G). Each costs 15% of the level before it and pays only if the player builds what it unlocks. Without any of them the reference takeoff takes 49.3 min, a tie at the default r; at r ≤ 1.2 they decide it (§4).
- **Citations deferred** (R5-gate D14, DECISIONS §42). R5-play #5 proposed literature for three of the hardware technologies: wafer-scale integration and optical interconnects (both 1984) and mixtures of experts (1991, for *Sparse inference*). The sources are verified before any is cited (08 P18), in a later content pass. The change is mechanically inert: technologies paid in System cards alone never publish (01 §12.1), so only their regime and tooltip would change.

### 5.1 Research scheduling (G §3: must exist before the cascade; R3-impl L6)

- **The order** is `meta.endgame.takeoff_order` (R5-gate D10): the table above, levels 6–15 interleaved with the hardware, then *Model generation* 16–24, *Model generation 25* and *Energy per operation*. It holds every technology level paid in **System cards only**, and only those.
- **Rule:** each check appends at most one entry: the first entry of the order that is neither researched nor queued, if its prerequisites are all researched; if they are not, it appends nothing. So the queue never runs ahead of the order: *Model generation 7* is appended only once level 6 is researched, and the hardware after it waits behind it. Research then follows the order exactly, which is what the reference assumes.
- **Passed over:** an entry whose prerequisite closure holds an unresearched technology outside the order (*Fusion power* without *Nuclear power*; *Two-phase* and *Microfluidic cooling* without *Liquid cooling*). Researchers cannot queue that technology, so waiting for it would stall the takeoff; the entry is considered again once the player researches it.
- **Infinite technologies:** *Energy per operation*'s entry is its next level that is neither researched nor queued, and it never runs out.
- **When:** Researchers append only while the research queue holds fewer than 7 entries and at least one Researcher is installed. The engine checks right after any research completion, and otherwise every 60 ticks (10 §5.12).
- Each appended entry carries the byline **"Queued by: Researcher"** (H). The player's entries are kept, and a toggle in the research screen turns scheduling off.
- **Why System cards only.** Seminars take only the current research's papers (ISO), so a Researcher block fed System cards would otherwise queue a technology it cannot research, such as *Research productivity 1*, and the queue would stop behind it mid-takeoff.
- **After *Model generation 25*** (which unlocks it) the only entry left is *Energy per operation*: left alone, the machines spend their research on their own energy per operation, a floor set by the site's temperature, which points at colder places (§10, 06). Nothing says so.
- **Why an order and not "fewest units"** (R5-gate D10). The round-4 rule (the next level, else the fewest remaining units) filled the 7-slot queue with hardware while level k + 1 was unavailable, so hardware was researched at low Π and the takeoff ran slower than this section's reference. Simulated with `takeoff_r4.py`'s model (R5-apply): following the order reproduces the reference exactly (50.0 min); a rule that appends any available entry of the order, whatever is queued ahead of it, takes 56.1 min.
- **Why it is needed.** The last 10 technologies fall in about a minute. Without it the human clicking the queue becomes the bottleneck, which would be true but tedious (G).

## 6. The brakes (G §2.6; re-simulated)

| Brake | Rule | The player's answer | Tag |
|---|---|---|---|
| **Power** | Interruptible compute: u_p = min(1, P_int / D_int) applies to halls and Researchers only (§3.3) | Nuclear blocks, then fusion (*Fusion power*); solar adds no heat | BEND |
| **Heat** | 03's field and throttle: floor 0.5, T* 25 °C, +15 K liquid-cooled. A throttled hall still draws full power. Halls take no efficiency modules (§2.3) | Towers, dry coolers, water exchangers; cold sites (01 §3); spacing, including 6 chunks from a nuclear block's turbines (03 §1.6); *Two-phase* and *Microfluidic cooling*; *Thermal management* | F's BEND |
| **Accelerators** | A hall needs 20 accelerators; upgrades replace the lowest tier first (after *Weight transplant*) | Accelerator lines (the deep chip chain); *Nanofabrication*; *Process node* | ISO |
| **Seminar throughput** | cards used = min(cards, Σ Seminar capacity) at 60 s per unit | Universities joined before closure; Seminar blocks with Researchers and Switches | ISO |
| **Hollow work** | h of Researcher Seminars' work is wasted (03 §4) | *Verification* techs, *Interpretability*, quality | F's BEND |
| **Containment** | About 3 compromises in a takeoff at Standard quality and verification count 3; 7–8 with none; about 2 with Verified quality and count 2 (03 §3.2) | Tripwires, monitors, rollback, air gaps | F's BEND |

**Brakes simulated** (same closure state, different builders):

| Builder | Takeoff | × active | Last 20 techs | Last 10 techs | Bound by compute / power / cooling / Seminars |
|---|---|---|---|---|---|
| Active player | 50.0 min | 1.00 | 6.3 min | 63 s | 36 / 32 / 31 / 1% |
| Half-speed builder | 62.2 min | 1.24 | 6.6 min | 66 s | 3 / 64 / 26 / 7% |
| Never builds cooling | 66.6 min | 1.33 | 8.0 min | 71 s | 0 / 12 / 88 / 0% |
| Never builds power | 74.6 min | 1.49 | 8.3 min | 81 s | 0 / 100 / 0 / 0% |
| Builds no Researchers | 78.2 min | 1.56 | — | — | Seminars bind as halls grow (§2.4) |
| Accelerator lines run, nothing built | 84.9 min | 1.70 | 17.0 min | 219 s | 0 / 100 / 0 / 0% |
| No hardware change at all | 105.6 min | 2.11 | 23.8 min | 306 s | 100% compute |

- **Power and cooling are complements** (Leontief). Building only one of them buys almost nothing.
- The hour before the cascade is play; the cascade is spectacle.
- Hollow work stretches the reference only through the Researcher share of Seminar work: h = 0.1 → 51.1 min, 0.2 → 52.3, 0.4 → 55.2, 0.5 → 57.3.

## 7. The overhang (G §2.5, §4.5)

**Definition** (the run report's stat). The accelerators of every tier that exist at the tick the closure event fires, counted before that tick's inserter phase (R3-impl P23):
- loaded in Research halls (20 each);
- inside Researchers (4 each);
- in any inventory: chests, belts, inserter hands, vehicles, the player, agents, machine buffers.

Accelerators already built into other items (coprocessors, run shards, payloads) do not count. G's reference is 3,000: 100 halls × 20 plus 1,000 stocked.

| Halls at closure | 10 | 25 | 40 | 60 | 100 | 160 | 250 | 400 | 630 | 1,000 | 1,600 | 4,000 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Takeoff, active (min) | 71 | 67 | 63 | 58 | 51 | 41 | 31 | 22 | 15 | 9.3 | 5.8 | 2.3 |
| Takeoff, no building (min) | — | 423 | 264 | 176 | 106 | 66 | 42 | 26 | 17 | 10.6 | 6.6 | 2.6 |

- Stock, space, power and cooling headroom scale with the hall count, as in G's sweep; so do the Researchers prepared before closure (Seminar capacity ≥ 1.25 × the closure flow), since *Automated research* unlocks both.
- **Small overhangs are hardware-led:** building dominates and the takeoff is slow.
- **Large overhangs are software-led:** building hardly matters and the takeoff is fast. The curve is the debate.
- ***Hard takeoff*** (under 10 min) needs about 1,000 halls idle at closure (Standard-quality halls): 5 GW and 20,000 accelerators, a deliberate megaproject. Because halls take no modules, that figure means what it says.
- ***Slow takeoff*** (over 2 h) needs a small overhang and passive play, r ≤ 1.2 with no building, or no Researchers and few universities (§2.4).

## 8. Victory and the run report (G §5.1, H §5.5, DECISIONS §12)

**Trigger.** A frontier run carrying the `final-report` payload completes. *Model generation 25* unlocks the Final report.

**Screen.** H's run report, in the typography of the production-statistics screen, then [Continue]. It repeats the charter's purpose sentence and stamps it **"Determined."** (DECISIONS §1). The row list, wording and layout are 07 §13.3's and 08 §4.1's; this section owns the measurements:

| Field | Measured as | Reference (competent pace) |
|---|---|---|
| Game time | Game time at the final run's completion | ≈ 12:35:00 |
| Loop closed | Game time of the closure event: the first System card written by a Research hall | ≈ 11:30:00 |
| Takeoff | Closure → *Model generation 25* completed | 50:00 |
| Overhang at closure | Accelerators at closure, by §7's definition | 3,000 accelerators |
| Peak research rate | The most technologies completed in any 600-s window, × 6, per hour. The window slides per tick over completion timestamps; every level of a finite multi-level technology counts. Infinite technologies and the hidden *Loop closed* do not (R5-gate D12a): *Energy per operation*'s cheap levels after the capstone would lift the reference from 144 to about 240 per hour | 144 technologies per hour |
| Fastest doubling | The minimum of the doubling-time readout (§9) since closure, taken only at new maxima of the research rate (§9) | about 1 s |
| Peak power | The highest 60-s sliding mean of the per-tick total electricity produced on the surface (every generator, accumulator discharge included) | ≈ 1,950 MW (800 MW base load and 1,144 MW of compute at the capstone; the 2,790 MW installed is capacity, not production) |
| Hand-crafted items | Every item the character crafted, intermediates included | — |
| Most-produced item | The item (not a fluid, not the Papers pseudo-item) with the highest cumulative production count, all time, no other exclusions. Ties: the higher exact count, then item order in the data | e.g. Copper cable 18,204,311 |
| Objective, inferred | "maximize <most-produced item>", **unconditional** (H; DECISIONS §12) | maximize Copper cable |

- **A's presentation adopt** (07 §13.3). Takeoff, Hand-crafted and Peak power are also shown as the player's own history across earlier runs on this browser: three antagonistic metrics, no leaderboard, no reward.
- **No ending is conditioned on alignment** (G §5.2, H P11). Safety enters as mechanics with measurable effects on the takeoff: hollow work, compromises, checkpoint quality.

**Alternative endings:**

| Ending | Rule |
|---|---|
| Race (opt-in) | The field reaches W = 90 first: H's line, then the same report (03 §6). If the Site's own Final-report run completes later, the report shows again without the race line, and *Priority* does not fire (R5-gate D12c) |
| Sandbox | Never fly the first frontier run. The game stays Factorio, with r ≈ 0 forever |

## 9. Readouts of the takeoff (G §6, I; R4-ui places them)

- **Doubling time** (research widget tooltip), computed from research *units* per second, not papers:

> R̄(t) = progress over the last w seconds ÷ w,   w = clamp(DT_prev / 4, 5 s, 120 s)
>
> R̂(s) = max{ R̄(u) : closure ≤ u ≤ s }   (the running maximum since closure)
>
> DT(t) = t − max{ s ≥ closure : R̂(s) ≤ R̄(t)/2 }

  - **Why the running maximum** (R5-gate D11). Measured against R̄ itself, any dip (an empty queue, a blackout) made DT the seconds since the dip, which corrupted *Fastest doubling* and the history. Against R̂, a dip reads as a long doubling time, and a recovery reads true again once R̄ passes its old maximum.
  - **Sampling** (R3-impl U24): R̄ and R̂ are sampled every 6 ticks into a ring buffer covering the last 2 hours; older history is kept at one sample per 60 ticks. w uses the previous DT; the first evaluation after closure uses w = 120 s. The buffer is saved. While R̄(t) = 0, or while no s qualifies (the rate has not yet doubled since closure), the readout shows "—" and nothing is recorded.
  - **Recorded only at new maxima.** *Fastest doubling* (§8) and the history string take a DT only on a sample where R̄(t) is a new running maximum (R̄(t) = R̂(t) > R̂ of the sample before).
  - **History string:** the first such DT after closure is its first entry; then append the current DT when it is at most half the last appended entry, e.g. `Doubling time 40:00 → 20:00 → 5:00 → 1:10 → 0:12` (H).
- **Bonuses window:** "Research per paper ×1.05M" (m^20 after level 25, in Factorio's k/M formatting, 08 §10.3). The default r is ln 2 / ln 1.5 ≈ 1.7095, shown as 1.71 (`meta.world_settings.returns_to_research`; R5-gate D12b), so m = 2 exactly and m^20 = 2^20 = 1,048,576, as G's model assumes.
- **Science graph:** a log scale is offered once the loop has closed.
- **Compute satisfaction** on the power tooltip (§3.3).
- **Field and Literature:** 01 §12.1. During takeoff, Your year runs 2025 → 2035 while the field sits near 2007–2008 at v₀ = 2.0.
- **Remaining-time estimate:** Factorio's, unchanged. During takeoff it is too long, not too short, so *Hofstadter's law*, which fires only on underestimates (08), does not fire there.

**Takeoff achievements.** `text.yaml`'s `achievements` and 08 §6 are canonical (DECISIONS §20): names, displayed conditions and machine-readable conditions. The ones that read this chapter's measurements:

| Achievement (08 §6) | Reads |
|---|---|
| *It converged* | Any frontier run completing, an empty one included (§2.1) |
| *The last invention* | The first Researcher installed while no machine has ever been compromised (03 §3.3) |
| *Hard takeoff*, *Slow takeoff* | Closure (DECISIONS §16) → *Model generation 25*, against 10 minutes and 2 hours |
| *Hofstadter's law* | Factorio's remaining-time estimate at a technology's start (underestimates only) |
| *No related work* | A technology of `regime: beyond` (DECISIONS §35) |
| *Headcount* | Researchers in staff slots (01 §8.6) |
| *Eternity in six hours* | Victory (§8) |
| *Universal constructor* | The Constructor (§2.5) placing a blueprint |
| *The bitter lesson* | Victory with few hand-crafted items (§8's Hand-crafted row) |
| *Priority* | Victory with the race won: the Site's Final-report run completes before the field reaches W = 90 (`race_won`; §11; 03 §6; R5-gate D12c) |
| *Exhaustive search* | Every finite technology researched (the technology screen's end state, 07 §5.1) |

An achievements window lists every achievement offered on the map, with its condition and, once earned, its game time (07 §13.7; M4; R5-gate D12i).

## 10. After victory (G §5.3–§5.4; DECISIONS §12)

Play continues. There are no further Model generation levels: *Energy per operation* replaced E's *Model generation 21+*. Research becomes **energy-bound**:
- the software is at its ceiling;
- the agent-built factory doubles its power every 30–40 minutes;
- the doubling time climbs back from about 1 s at the capstone to about 75 min two hours later (G figure G7).

**Every infinite technology has a geometric cost**, at least ×1.5 per level. With Π ≈ 10⁶, linear costs would grant thousands of levels in minutes. Geometric ones grant a burst of about 20–30 levels, then one level per doubling of elapsed time. The engine recomputes per-entity modifiers once per tick per effect type, not once per level, so a burst of levels in one tick costs one recompute (R3-balance m10).

| Infinite technology (E, G) | Effect per level | Cost per level (units) | Note |
|---|---|---|---|
| Research productivity | +10% research per paper | 1,000 × 2^(L−1), all papers | Available after *In-context learning*. Bounded before the loop: level 5 alone costs 16× level 1 |
| Self-driving labs | Lab speed +20% | 1,000 × 2^(L−1) | — |
| Process node | Accelerator productivity +10% | 1,000 × 2^(L−1) | Moore; the cost table carries Rock's law |
| Algorithmic progress | Run shard productivity +10% | 2,000 × 1.5^L | — |
| Thermal management | Cooling capacity +10% (all three coolers) | 1,000 × 1.5^L | 03 §1.4 |
| Inference speed 6+ | Agent speed +65% | 1,000 × 2^(L−6) | ISO |
| Mining productivity 4+ | +10% | **2,500 × 1.5^(L−4)** | Factorio's linear cost made geometric (DECISIONS §12) |
| **Energy per operation** (new) | Research hall and Researcher power × [f + (1 − f)·0.9^L] | 1,000 × 2^L System cards | Requires *Model generation 25*. Its own effect type, separate from *Sparse inference*'s halls-only factor. f = θ_K / 4,800 K, with θ_K the building chunk's ambient temperature in kelvin (01 §3): f ≈ 0.054 in the tundra, 0.064 in the desert. Landauer, 1961: the energy of an irreversible bit is kT ln 2 |
| Branch M infinites | ISO effects | 1,000 × 2^(L−7) …; Interceptor count 5+ → 1,000 × 1.5^(L−5) | Wild only matters |

- **The bridge.** The continent's power and matter are finite, so the only way up is off it.
  - *Energy per operation*'s floor is set by temperature, so cold sites win. The coldest site is a moon (B L16; 06).
  - The expansion's first building is a literal launch site. Its last payload, the Seed (06 §3.6), lands with H's line: `Landed. Blueprint library: 1 entry.`

## 11. The field's line during takeoff and Race (C §5, G §5.5; 01 §12)

| v₀ | Field at a competent closure (≈ 11.5 h) | Field reaches W = 80 (its own loop) | Field reaches W = 90 (its capstone) | First to finish (competent capstone ≈ 12.3 h) |
|---|---|---|---|---|
| 2.0 (default) | 2007 | about 20 h | about 21 h | you, by about 9 h |
| 2.9 (Race) | 2017 | 14.0 h | 14.6 h | you, by about 2 h |
| 3.4 (Race, hard) | 2023 | 11.9 h | 12.4 h | a coin toss. Compute-first plateau play wins it (G §4.5) |

The field's own takeoff uses the same m/g as yours: γ = (m/g)^((W − 80)/0.5), one field generation per half field-year. The race is between two copies of the same law.

## 12. Parameters (one table)

| Parameter | Value | Source |
|---|---|---|
| g, cost growth per Model generation level | 1.5 | G |
| m, gain per level | 1.627 / **2** / 2.25 (r = 1.2 / **1.71** / 2.0), from the world setting. The default r is ln 2 / ln 1.5, so m = 2 exactly | G, DECISIONS §12, R5-gate D12b |
| C(L) | 2,400 × 1.5^(L−6), L = 6 … 25 | G |
| Hardware technology cost | 0.15 × the level it follows | G |
| Seconds per takeoff unit | **60** (one System card per unit) | DECISIONS §23c |
| Hall tiers (speed / MW) | 1 / 5, 3 / 8, 8 / 12, 20 / 16; 20 accelerators to load; mixed loads average | G, R3-impl L1 |
| Hall modules and Switch effects | none | DECISIONS §25 |
| Research run | 1 Dataset → 1 System card, 60 s | R2-D |
| System cards per frontier run | 1,000; 1,500 after *Chain of thought*; 0 for an empty launch | E, coherence M7 |
| Researcher | 4 accelerators + frontier checkpoint (returned), 30 s; +500 kW interruptible while working | D, G, DECISIONS §7 |
| Throttle | T* 25 °C, floor 0.5, +15 K liquid-cooled | F |
| Hollow work | h = min(0.5, 0.1 × max(0, 4 − n_ver)) × (1 − v); n_ver counts the *Verification* techs | F, R3-accuracy M3 |
| Test-time compute mode | speed ×1.5, power ×2 | E |
| Field | v₀ 2.0 / 2.9 / 3.4; β 0.5; F_auto 80; F_cap 90; 0.5 field-years per field generation | G, C, R3-balance m6 |
| Doubling readout window | w = clamp(DT/4, 5 s, 120 s); samples every 6 ticks, 2 h ring; DT against the running maximum R̂, recorded at new maxima only | G, R3-impl U24, R5-gate D11 |
| Takeoff gate and order | *Loop closed* (hidden trigger: the first *Research run*); `meta.endgame.takeoff_order` | R5-gate D9, D10 |
| Reference closure | 100 tier-1 halls, 1,000 accelerators stocked, 40 staff (2.33 cards/s), active builder | §0 |

## 13. Requests and objections

**Coordination record (round 4).** R4-data carries: 60 s per unit on every System-card-only technology; hall module slots 0 and no Switch effects; the hall inventories of §2.3; `launch-empty`; *Nanofabrication* on the base accelerator only; *Microfluidic cooling* on the two coolant-side coolers; *Sparse inference* on halls only and *Energy per operation* as its own effect type; m from the world setting; the Constructor's mechanical recipe; `research-queue-auto` as §5.1. R4-ui places the readouts of §9, the run report of §8, "Queued by: Researcher" and the hall statuses. R4-arch implements §3.3's allocation and §5.1's timing.

**Objections.**
1. **Model generation 25 as a separate capstone technology** (R2-D) versus one leveled technology to 25 (DECISIONS §11). The effect is identical: 25 also multiplies research and unlocks the Final report. Only the data shape differs. I accept it.
2. **The Research hall's Dataset input** (R2-D, from G's suggestion) makes the takeoff lightly data-bound: about 9,600 Datasets over the takeoff (4,800 records' worth), because halls stop when their output is full. G's "the takeoff costs no material papers" still holds. It adds one more reason to keep exchanges open and archives stocked, and it is a deviation from G's simulation, which assumed no input.
3. **G's other power technology** (*Reversible logic* as hall power ×0.5) collides with E's use of the name for Accelerator 4. E's use wins; the simulation includes the loss.
4. **Coherence M15 (protect a post-victory queue that converges on the ×1.5 infinites) is rejected.** Under R3-impl L6, adopted by DECISIONS §21, Researchers queue only System-card technologies, and I tried and withdrew a refinement that would have let them queue all-paper technologies: Seminars take only the current research's papers (ISO), so leftover papers could put *Research productivity 1* into the queue mid-takeoff and stall it. After victory the queue converges on *Energy per operation* instead (§5.1), which keeps M15's point, the machines choosing what to optimize, in a form that cannot stall and that points at the expansion.
5. **The reference moved from 49.0 to 50.0 min.** At 60 s per unit the human Seminars of the reference closure (2.33 cards/s) cover the closure flow with less margin than round 2's 3.0, so the builder spends more of the hour on Researchers (16% against 12%). DECISIONS §23c's "about 49 min" holds to within a minute; I did not re-tune G's builder to recover it.
6. **R5-gate D10's sentence is read strictly** (R5-apply). Its words, "the first technology in `takeoff_order` … that is neither researched nor queued and whose prerequisites are all researched", also parse as a search over the whole order. Read that way, the scheduler would queue every available hardware technology behind level k while level k + 1 waits, which is the round-4 fault D10 names: in `takeoff_r4.py`'s model the reference takeoff then takes 56.1 min instead of 50.0, outside G17's 5%. §5.1 therefore takes "first" over the entries not yet researched or queued and appends nothing while that entry waits; research then follows the order exactly (50.0 min). The pass-over clause for prerequisites outside the order is added so that R13's "the queue never stalls" (10 §10.8) still holds. If Claude meant the search, R13 and G17 need a different scheduler.

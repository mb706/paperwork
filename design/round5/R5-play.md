# R5-play — Final play-through: did the revisions keep the fun and the cleverness?

*Round 5, read-only. Read: BRIEF; spec 00, 01, 03, 04, 08, 09 in full; 02, 05, 06, 07 in the sections that the player meets; `data/*.yaml` (every technology, every surviving description, the key recipes, `meta.effects`, `text.yaml`); `round4/data-migration/r4_apply.py` (the exact trim); `round4/world-sim/*.out`; R3-fun and R3-coherence-tone as the keep-lists. Validator re-run: `0 errors, 0 warnings; 250 techs reachable in 26 waves`. Nothing was edited.*

## 0. Summary

Played start to victory in the head, the game is still Factorio at every phase, and round 4 removed every tedium the round-3 fun critique named: the experiment loop is 1 / 2.4 / 12 s, hour one is one site, a nuclear plant no longer reads 900 °C, spread is linear, the drift is one hover away, and the Terminal gives data lines a job at green. The cleverness survived the trim intact: all 34 keep-list lines are present verbatim, the five tooltips R3-fun named by name are all still there, the eight "ceiling" proposals of R3-coherence are in (C6 rightly rejected), and nothing cringe came back. The plane holds; the one knowingly kind reading (archive-fed Synthetic data trains clean) is flagged in 03 §9.5 and is the better game. **No must-fix items.** Five small things would raise it further, ranked below; the first is the only one that touches fun rather than delight.

## 1. The play-through, phase by phase

| Phase (competent pace, 01 §12.1) | What happens | Still Factorio-fun? | Regression or new tedium? |
|---|---|---|---|
| **0–10 min** | Charter; six wreck pieces (30 plates) and a crate: a radar, 10 logic boards, 20 cable; the crate's boards are exactly one Seminar. Burner drill, quartz furnace, Keypunch on the archive beside the college; `Literature 1938 · Field 1945 · 7 years behind` at minute five | Yes. ISO opening plus one ore and one furnace, inside the college's 104 × 104 square on every seed (5,000 layouts, none failed) | None. FUN-05 and FUN-13 are fixed |
| **Hour 1 (Memo)** | Ten Seminars at `Staff 100% · Ashford College: 15.4 supply, 10 demand`; the engines' warm spot on the overlay; *Artificial intelligence* at 10 × 60 s | Yes | None for the 8-h player. The 6-h player is at 75% in hour one (see §5 #1) |
| **1–3 h (Report)** | Steel, rail, solar; *Cybernetics*; *Packet switching* (data lines, radar relay, R → 72); the Crawler on the college's telephone exchange; Deduplication; chips from coal chemistry; the Trainer and the first Checkpoint at green; *Time-sharing* → the Terminal; Statistical learning | Yes. The oil moment with a true reading; the chip chain is the subject; a refinery beside the boilers reads "Throttled by heat 94%" as a cheap lesson | A claim is now a pole run plus a data line (1 copper per tile; underground lines span 10), not a six-pack train. 92% for a short bind before *Citation index* without a claim: acceptable and legible |
| **3–4.5 h (Article)** | Accelerators, Racks, Tokenizer, Quality filtering, Liquid cooling, Web search (R → 108); the experiment loop; Meta-analysis as blue's Kovarex; agents at blue; *Deep learning* → Endpoints | Yes. The Article line is 1.15× Factorio's blue in machines; the File drawer, "p < 0.05.", "Was state of the art." | FUN-01 fixed. The Terminal is cheap enough that the Article bind (90% at 3.5 h without a claim) is a choice, not a wall |
| **4.5–6 h (Preprint)** | Switches, modules 3, Synthetic data, Dennard 3–5 ("No further levels exist."), the first Endpoint, `Leak 0.02` | Yes | Accepted trade (DECISIONS §23a): under the staff cap Coprocessors in Seminars buy nothing, Learned controllers do; `Staff demand 1.5` says so. With one claim the competent player is never capped before the white phase, so this bites only the claimless |
| **6–8.5 h (Model card)** | Trainer row `Synthetic share 31% × crawl share 58%: speed −18%`; *Synthetic detection* against *Watermarking*; the starting archive runs out; metropolis exchanges close; `Yield 80%` nowhere yet; the Frontier cluster | Yes. FUN-03 fixed: collapse bites every Trainer, and archives are the literal low-background answer | None |
| **First run → closure (9–11.5 h)** | `Run complete. Loss 3.41 → 1.92.`; six runs for 8,000 System cards; the overhang: accelerator lines, nuclear on the shore, coolant loops; the hall's note "The first System card written here closes the loop." | Mostly. The compute megaproject is Factorio's megabase phase with a reason | The one phase that can drag: 2.5 h at the competent pace, 1.5–3.7 h by run-material rate. 04 §1's four-run knob is the right lever; see §5 #4 |
| **Takeoff (50 min)** | MG6 at 19.7 min, then *Research scheduling*; power, cooling and accelerators each bind a third of the time; about 3 compromises at Standard and n_ver 3; the last 20 technologies in 6.3 min; `Doubling time 1:10 · 40:00 → 20:00 → 5:00 → 1:10` | Yes: played for 45 minutes, spectacle for 6 | None. 60 s per unit makes Seminar capacity and Researchers matter (78 min without) |
| **After victory** | The report; `Research completed: Energy per operation 31 (Researcher).`; "No action required" | Yes | None |

Pacing check against Factorio (05 §7): lab-seconds red +6%, green +7%, blue +10%, purple +9%, yellow +16%; the path to the first run +7%. The skeleton is intact.

## 2. Did the cleverness survive the trim?

**Keep-lists.** All 34 lines of 08 §5.2 / R3-coherence §4 are present verbatim in their named sources (checked against `items.yaml`, `entities.yaml`, `technologies.yaml`, `enemies.yaml` ("No body. Nothing to shoot."), `text.yaml`, 07 §7.1 and 08). R3-fun §5's sixteen "must not be lost" items are all in place; the two it feared for (the experiment loop's items and the four heat guards) are unchanged. Of R3-coherence's ceiling list, C1–C5, C7 and C8 are adopted (C1 in the form that cannot stall: the post-victory queue converges on *Energy per operation*), C6 is rejected for the right reason.

**What the trim cut.** 39 of 230 item descriptions, 23 of 104 buildings, 81 technology definitions and three notes remain. Everything cut was tier B of coherence §2.1 (stat restatements: "Tracked. 80 slots.", "16 slots.", the accelerator tiers' clauses, which now live on the technologies that unlock them) or a line the new heat rule made false (the boiler's). The best lines are all here: "Not written by anyone.", "Multiplies matrices.", "One instance of one type.", "Deduplicated. Smaller than what went in.", "Proposed as a two-month, ten-man study.", "Does not apply to machines.", "It was always there.", "Due under the charter.", "Surplus from a wartime laboratory." (in the Handbook, where it is true). The new lines fit the register: "Set by plugboard." / "Its recipe is held in a stored program." / "Four controllers working as one." make the three assembler technologies literal; "The previous generation trained this one."; "Outputs while its conditions hold."; "Joins a university to a Seminar network over a data line."

**The mechanical ironies.** All present and still unstated: *Artificial intelligence* as 600 lab-seconds for nothing; *Expert systems* for the hands only; Dennard's five levels; ×2 cost curves on *Research productivity* and *Process node*; α on the Analysis recipe and the File drawer that cites nothing; deployment closing the exchanges it draws on while Endpoints keep working; "Yield 80%"; the Researcher recipe in a slot dimmed since minute one; closure as the player's decision and the overhang as a run-report row; the Literature counter stopping at 2024 while "years ahead" keeps growing; the empty launch as a base model (new, and exactly the right kind of joke: made in the silo GUI by what is not in the payload slot); the Researcher supply row crossing the town's; the final run's loss curve starting at 1.92; "Objective, inferred: maximize Copper cable".

**Flat or cringe?** No cringe found. Every tip is a checked fact with a mechanic; every achievement's condition is the thing its name names; no "you" outside the allowed surfaces; no symbol on screen; the renames (Regenerative furnace, Terminal ballistics, Threat monitoring, Mobile automata, Lift capacity, Half-track, Decision unit, Constructor) are accurate and dry. Two small flat spots: six takeoff hardware technologies are `beyond` the literature although three of them have forty-year-old literature (§5 #5), and *Threat monitoring*'s clause restates its effect ("…and undo it", §5 #6). Neither is a regression.

## 3. One plane

Every round-4 rule is literally true in "information is physical": heat rejected at the condenser side (the engines and turbines), a reactor's waste heat only when it can neither pass heat on nor store it; a Terminal as a time-sharing endpoint that lets a far campus's people work the Site's Seminars over a wire, susceptible to nothing and a link only for what else rides the line; a Constructor made of relays and Decision units that cannot be compromised because it holds no weights; a base model as weights without post-training; model collapse that follows what the Site actually trains on. The staffing radius growing with *Packet switching* and *Web search* is the softest reading on the plane (networks extend a commute), but it is the deviation register's own, and the Terminal makes the same idea explicit. Towns, exchanges and era skins follow the field, not the player. Nobody speaks. The charter's "within commuting distance" remains true with Terminals, since it grants rather than limits.

## 4. Must-fix

**None.** No keep-list line is lost, no round-3 blocker or major is unaddressed, no new rule breaks the plane, and no phase gained tedium that the round-3 critique had not already accepted with a reason. The items below are improvements, not repairs.

## 5. Worth doing, ranked

Each is small, concrete, adds no text volume, and stays inside Factorio's idiom.

### 1. Let supply reach its ceiling sooner, so hour one is 100% for the fast player too (fun)

- **Where.** `meta.yaml` `staffing.supply.per_field_year: 0.04` → **0.08**; 01 §8.1's sentence ("+4% of T₀ per field-year, so supply doubles by W = 25 (Field 1970)") → "+8%, so supply doubles by W = 12.5 (Field 1957)"; re-run `round4/world-sim/staffing_r4.py` and re-render 09 §5's two columns (W = 7: 15.4 → 18.7; W = 18: 20.6 → 24.0; S-G3's W = 9 example 16.32 → 20.64).
- **Why.** The adopted law fixes FUN-02 for the 8-h profile (100% in hour one, 92% before *Citation index*) but the 6-h profile, which a long-time Factorio player may well be, reads `Understaffed: 75%` at hour one and 68–78% until the Terminal at 1.9 h (`staffing_r4.out`). A §7 D3's rule is that the cap is loved when legible early, not when it binds early.
- **Effect.** Hour one 18.7 against the 6-h profile's 20.5 demand (91%), 85% at 1.5–2 h instead of 68–78%; the 8-h player's 92% at 2 h becomes 100%. The ceiling (24 and 16) is unchanged, so every number from 2.7 h on, the Article bind, the white-phase bind and the whole takeoff calibration (50 / 78 min) stay exactly as simulated. The in-world reading is apt: the postwar universities doubled fast.

### 2. The Trainer's progress bar as a falling loss curve (delight)

- **Where.** 07 §13.1 already defines the curve L(p) = 1.6 + 1.81·(1 + 9p)^(−0.75) for the Frontier cluster; give the Trainer's GUI the same bar for the recipes that produce weights (*Checkpoint*, *Post-training payload*, *Final report*), p = recipe progress. Display only, deterministic, no state, no text.
- **Why.** R3-fun §2 counted "the Trainer's falling loss curve" among the Report-tier pleasures, but no chapter specifies it; only the cluster has one. The first checkpoint at green is a 60-second curve the player watches once, and it makes the Trainer's one line ("The crafting time is the compute.") visible. Catalyst recipes (controllers, agents, Copy weights, Analysis) keep Factorio's bar, because they train nothing.

### 3. Keep the "0 working Seminars" beat: define the campus tooltip's count (delight, precision)

- **Where.** 08 §4.7 campus tooltip `Network: {u} universities, {s} working Seminars.` and 07 §7.2. Define **{s} = working Seminars whose demand is drawn from the towns** (a Researcher-staffed Seminar demands 0 and is not counted), and in the University window count a Researcher-staffed Seminar once on each side (supply row `Researchers ×n`, demand row `Seminar ×n`), so the satisfaction bar never changes when a Researcher is installed.
- **Why.** R3-fun §2 named "the University window reading 0 working Seminars" as one of the best beats; 07 §7.2 adopted C3's supply row but left {s} undefined, and its sketch (`Seminars 10` beside a supply graph with `Researchers ×2`) can be read either way. An implementer who counts every working Seminar loses the beat, and one who adds Researchers to supply without demand inflates the town Seminars' satisfaction. One definition fixes both.

### 4. Pre-register the plateau knob (fun)

- **Where.** 04 §1 already names it: white counts 2,000 / 2,000 / 3,000 / 1,000 → 1,000 / 1,000 / 2,000 / 1,000 (four runs instead of six). Add to 09 §7.1's playtest protocol: *if the first playtest's time from the first run to closure exceeds 2 h, adopt the four-run counts*.
- **Why.** The plateau is the only phase that can read as waiting (2.5 h at the competent pace, 1.7 h of it run-bound; 3.7 h for a player short of run material). It is also where accelerators are contested between run shards (1,000 per run) and the overhang, which is good design. Deciding the knob's trigger now stops a later balance pass from reopening the white tier's shape.

### 5. Cite the takeoff hardware that has literature (accuracy as humour)

- **Where.** `technologies.yaml`: *Wafer-scale integration*, *Photonic interconnect* and *Sparse inference* are `beyond` (field year 2025). An expert knows wafer-scale integration was tried in 1984 and shipped in 2019, optical interconnects were surveyed in 1984, and mixtures of experts date from 1991. Candidates, **to be verified before use (P18)**: McDonald, Rogers, Rose & Steckl (1984), *The trials of wafer-scale integration*, IEEE Spectrum 21(10); Goodman, Leonberger, Kung & Athale (1984), *Optical interconnections for VLSI systems*, Proc. IEEE 72(7); Jacobs, Jordan, Nowlan & Hinton (1991), *Adaptive mixtures of local experts*, Neural Computation 3(1), with Shazeer et al. (2017) as the second claimant.
- **Effect.** None on mechanics: System-card-only technologies never add to W_pub (01 §12.1), and Literature is already 2024 by then. *Reversible logic* (1973), *Microfluidic cooling* (1981) and *Self-reproducing automata* (1966) are already cited takeoff technologies, so the precedent exists. The joke is the right kind: the takeoff researches a 1984 idea, and nothing says so. *Two-phase cooling*, *Fleet scheduling*, *Weight transplant* and *Nanofabrication* can stay `beyond`.

### 6. Three one-line nits

- *Threat monitoring* `desc`: "Watch the audit trail for misuse, and undo it." → "Watch the audit trail for misuse." (the clause restates the Monitor's effect; 08 §5.1 #11).
- The α note has two wordings: 08 §9.3 ("0.05 is α: the share of results that come out significant when there is no effect.") and `recipes.yaml` *Analysis* ("α = 0.05 is the chance of a significant result when there is no effect."). The data wins; align 08.
- `text.yaml` tips-and-tricks *Terminals*, last sentence ("A data line into a Seminar block also carries copies of a model, once there are models to copy.") states a consequence; 08 §5.3's own rule is "rules, not consequences". Either cut it or make it the rule: "A data line is a link for the machines on it (Containment)."

Not recommended: a timed launch (the 1-second `launch` pseudo-recipe against Factorio's 40-second launch sequence) was considered; the loss curve already spends twenty minutes falling as shards go in, and a held last segment would add a state the spec does not need.

## 6. Verdict

Ship it to coding as it stands. The round-4 revisers kept Factorio's numbers and feel, removed the two things that would have turned the midgame into homework, and made the three new systems legible from the first Seminar, the first boiler and the first tap. The text is leaner and not flatter: the jokes are in the costs, the recipes, the readouts and the citations, and the one word at the end still lands because the mechanics changed its meaning. Items 1–3 above are an afternoon's work and should go in before the first playtest; 4–6 can wait for it.

# R3 — Coherence and tone: one plane, and clever-not-silly

*Round 3 critique. Read: BRIEF, spec 00–10, `data/*.yaml`, DECISIONS, B §4 (L1–L16), H, 08. Validator: 0 errors, 0 warnings. Mechanical sweeps: every `desc`/`name` in the data and every quoted UI string in 07/08 against 08 §10.2's never-list, the future-word list, `!`, `…` and second-person address; description counts and lengths against 08 §5.1's budgets; citation years against the Literature arc in 00 §4.*

**Verdict in one paragraph.** The plane holds. I found no mechanic that needs a second plane and only one rule that works purely by fiat (the Constructor's immunity, M8). The text is in the right register almost everywhere; the failures are of three kinds: lines that *explain* the mechanic's joke instead of reading the meter (hollow work, the Trainer's penalty, two infinite-technology definitions), lines that are *false* in the world the data builds (solar, radar, the payload, the post-closure System card, a 1998 citation that breaks the Literature arc), and *volume*: every one of 229 items and 250 technologies carries a description, against 08's own budget of one in five, so the forty lines that are genuinely good are diluted by a hundred that restate a stat. The data also lacks the `regime` field three text mechanics depend on, and its minute-one salvage disagrees with 01 and 09. Fixes are listed with replacement text; most are one-line edits.

---

## 1. Ranked issues

Severity: **blocker** (fix before coding), **major** (fix in this design phase), **minor**. Location: file §section or data id. Each has evidence and a concrete fix.

### Blockers

**B1. The salvage at spawn is three different things.** `meta.yaml` `start.salvage` names it "Radar laboratory salvage" and gives contents `{iron-plate: 20, iron-gear-wheel: 10, copper-cable: 20, logic-board: 8}`, no radar. 01 §9 (and 09 §4, 09 §2.1, 08 §10.4, 00 §9 #12) say **Laboratory salvage**: six wreck pieces at 5 iron plates each and one crate holding 1 radar, 10 logic boards, 20 copper cable. 01 §9 says "R2-D stores the contents in `meta.start.salvage`", which is not what was stored. The slice's map test S-G1 cites 01. The radar matters: it is "the one assembled machine in the salvage" (01 §9) and the carrier of the provenance line (see M13).
*Fix:* `meta.start.salvage: {name: Laboratory salvage, wreck_pieces: 6, per_piece: {iron-plate: 5}, crate: {radar: 1, logic-board: 10, copper-cable: 20}}`. Delete "Radar laboratory salvage" everywhere (00 §9 #12 already resolved the name).

**B2. `technologies.yaml` has no `regime` field, and three text mechanics need it.** 08 §9.3 requires `regime: cited | infrastructure | beyond` per technology; its validator rules, the *No related work* achievement (08 §6 #25: "a technology beyond the literature"), the end-state line (`Technologies beyond the literature: {n}`, 07 §5.1) and the credits' cited/uncited split (08 §4.4) all read it. The data has `citation`/`year` only: 95 cited, 155 uncited, and nothing distinguishes *Steam power* (infrastructure) from *Wafer-scale integration* (beyond). A second hole: *Model generation* is cited (Moto-oka, 1982, DECISIONS §11) but is the tree's first technology beyond the literature; 08's rule "beyond technologies have no citation" has no answer for it, so *No related work* could fire on a cited card.
*Fix:* add `regime` to every technology. Rule for the renderer and validator: `beyond` = uncited **or** cited with every citation year earlier than the technology's tier-era end (DECISIONS §11's exception); *No related work* fires on the first `beyond` technology **with no citation**, so it fires on *Wafer-scale integration* or *Research scheduling*, not on *Model generation 6*. Replace 08 §5.1's "150 cited technologies" with the real count (95).

### Major

**M1. The data claims "a decider is a threshold unit" while the engine implements 2.0's multi-condition decider.** `technologies.yaml` `cybernetics.desc`: "Control by feedback; a decider is a threshold unit." 10 §5.15: "Threshold unit | Decider | Multiple conditions and multiple outputs". 08 §14.3: "no text may claim that the unit is a single threshold unit"; 07 §25.4 agrees. P16 on the one building a circuit player inspects most.
*Fix:* `cybernetics.desc` → "Control by feedback. Unlocks: Threshold unit, Arithmetic unit, Bias unit, Power switch, Programmable speaker, Display panel. Circuit wires. (McCulloch & Pitts, 1943; Wiener, 1948)". `decider-combinator.desc` (items and entities) → "Outputs when its conditions hold." Keep the name: a 2.0 decider with OR-joined conditions is a two-layer threshold network, and the family name is true of its parts; the claim, not the name, was the error. Close 08 §14.3 with that ruling.

**M2. Every item has a description; 08's budget is one in five.** `meta.checks.require_desc: true` forces it: 229/229 items (126/126 non-building items), 103/103 entities, 250/250 technologies carry a `desc`. 08 §5.1 budgets item descriptions at "at most one item in five", buildings "at most one in three"; H P1 and P15: "a tooltip with no second line beats one with a weak second line." About a hundred of the lines restate a stat the tooltip already prints ("15 items per second.", "32 slots.", "Wire reach 9.", "Stores 5 MJ.", "50 water.", "Restores 300 health.", "Carries a 7×7 equipment grid.", "Walking speed +30%.", "900 kW from steam.", "Mines a 5×5 area.", "Range 224.") or the recipe ("Two iron plates, cut.", "Steel, a gear and two pipes.", "Sulfur, coal and water.", "Ten datasets, mixed.", "Steel on quartz ballast.") or the name ("Smelts into iron plate.", "Lights at night.", "Removes a cliff.", "A faster swing."). 17 item descriptions exceed the 60-character budget; 72 carry a literal number that the data also holds (P17).
*Fix:* set `require_desc: false`; delete every description that restates a stat, a recipe or the name. Keep only lines that state a fact the tooltip does not show. The keep-list (about 60 of 229, within budget) is in §2.1 below; everything not listed there goes. Numbers that survive become placeholders (`{entity.boiler.kw}`), per P17.

**M3. Technology `desc` strings duplicate the structured data.** Each `desc` embeds the unlock list, the effect lines and the citation that `unlocks`, `effects` and `citation` already hold (05 §4: "The tooltip is the desc field"). Three are already false or fragile: `in-context-learning` "Each completed frontier run returns 1,000 System cards" (1,500 after *Chain of thought*); `model-generation` "Research per paper ×2" (×1.63 or ×2.25 at the other *Returns to research* settings, 07 §5.2); `accelerator-2/3/4` "Hall speed 3 at 8 MW" (hall data). Any rename of an unlocked item desyncs 250 strings.
*Fix:* `desc` = the definition clause only (≤ 10 words, 08 §5.1 #11); the renderer and the engine generate "Unlocks: …", the effect lines and the grey citation from the fields. For the three above: "A trained model learns a task from its prompt.", "The previous generation trained this one.", and for the accelerators the first clause only ("One die per wafer.", "Talks to its neighbours in light.", "Erases little, so heats little.").

**M4. One citation breaks the Literature arc and fails the expert test.** `wearable-computing` cites "Thorp, 1998". The wearable computer was built in 1961; the 1998 paper is Thorp's memoir of it. Because Literature is "the latest citation among researched technologies", this green-tier technology sets **Literature 1998** at hour 3–4 while Field reads 1983 (00 §4's "Report: Literature 1998" is this one citation). An expert sees a 1961 device cited to 1998 and a readout jumping 23 years for a suit.
*Fix:* make *Wearable computing* `infrastructure` (no citation), or cite a verified pre-1970 source if one exists (Thorp's device is described in print only later; 08 §13 should list it as unverified). Re-derive 00 §4's Report-end Literature: 1995 (*Statistical learning*, the gateway), which is the right shape (the tier's literature ends at its gateway). Add to 08 §13's check-list: `disk-storage` "Noyes & Dickinson, 1956" is probably 1957 (IBM J. R&D 1(1), Jan. 1957; RAMAC was announced in 1956); `tabulation` "Hollerith, 1890" may be 1889 (*An Electric Tabulating System*, Columbia School of Mines Quarterly, April 1889); `crawling` "Koster, 1994" is the robots standard, not the first crawler (Gray's Wanderer, 1993, unpublished; McBryan's WWWW, 1994).

**M5. Solar panel: "Adds no heat where it stands."** (`items.yaml`, `entities.yaml` `solar-panel.desc`; also 03 §1.1 "Solar adds no heat where it stands (B §5)"). 08 §11 #28 rejected exactly this line as a physical claim an expert can dispute ("the engine's 0 is a rule, not physics. Fix: show the number, no sentence"). The data did not follow.
*Fix:* delete the desc; the stat line "Heat: 0 kW" (07 §8.1) says it. 03 §1.1's table cell → "Nothing (rule, not physics: see 08 §11 #28)".

**M6. The hollow-work readout explains its own joke.** 03 §4: "The speed stat counts the hollow work; the progress bar does not. That gap is the whole joke." Then the same section, 07 §6.1/§6.4 and 08 §5.2 print **"Hollow: 20%"** on the Seminar, naming the gap on a constantly-visible surface, with a word from F's design vocabulary rather than the operations register. The visibility rule (03 §0) is right; the label is the writer doing the last step (stranger test fails: a stranger knows a joke is intended).
*Fix:* label it in the register of inspection: **"Yield 80%"** (true in a 1945 machine shop and a 2025 fab; H P13 lists *yield*). Seminar line: `Speed +400% · Yield 80%`. `interpretability.desc`: "Read what a trained network computes. Checkpoint quality is shown. It was always there. Papers are spent only on research that holds." Achievement #19 *Campbell's law* condition: "Researcher-staffed Seminars consume 1,000 papers that yield no research." (Campbell's law is exactly the speed indicator corrupting what it measures; the name stays.) Keep "hollow work" as the spec's internal term.

**M7. Post-training payload claims a mechanic that does not exist.** `post-training-payload.desc`: "Without it a run returns a base model and no system card." The only launch recipe requires the payload (`launch`); there is no run without one. P16.
*Fix (preferred):* implement the empty launch, which is ISO (a rocket launches without a satellite): 100 Run shards and no payload → 1 Frontier checkpoint, 0 System cards, no *In-context learning* trigger. The desc then shortens to "Preference data and a reward model." and the mechanic says the rest: a player who refuses to deploy gets weights and no white science, which is literally what a base model is. (See §3 C2.) *Fix (fallback):* cut the second sentence.

**M8. The Constructor is immune by fiat.** 04 §2.5: "It is not a computing machine, so it does not throttle and cannot be compromised." Its recipe (`deployer`): 1 Steel chest + 10 Processor + 5 Accelerator. A box with five accelerators that executes build commands is the machine a runaway wants most (B L13: infected agents "build for it, including more compute"); exempting it is the one rule in the spec that holds only because the spec says so. A furnace with a Learned controller is susceptible; this is not.
*Fix:* make the exemption literal by making the machine mechanical: recipe 1 Steel chest + 10 Logic board + 5 Threshold unit (a relay sequencer "driven by the threshold-logic circuit network", which is what 04 §2.5 already says it is). Area scanner likewise: 1 Radar + 5 Logic board + 5 Copper cable. Then "not a computing machine" is a fact of the recipe, and the Constructor's immunity costs no accelerators that the takeoff wants anyway.

**M9. Three technologies are named for computers and unlock assembling machines.** *Tabulation* → Assembling machine 1, *Stored program* → AM2, *Cluster computing* → AM3 (05 Objection 11). A veteran who researches "Tabulation" and receives an assembler sees the reskin seam the brief forbids. 05 §8 offers the literal reading (the three are the generations of the assemblers' *controllers*, L11) but no player-facing text carries it.
*Fix (cheap, recommended):* put the controller reading in the assemblers' descriptions, which are otherwise flat: `assembling-machine-1` "Set by plugboard. No module slots."; `assembling-machine-2` "Its recipe is held in a controller. Two module slots. Takes fluids."; `assembling-machine-3` "Four controllers working as one." Then Hollerith's plugboard, von Neumann's stored program and the cluster each name the thing the slot holds, Stigler's law stays on *Stored program*, and nothing is renamed. *Alternative:* rename to *Automation* (Diebold, 1952), *Numerical control* (Pease, 1952), *Computer-integrated manufacturing* (Harrington, 1973), and drop achievement #2.

**M10. *Zone refining* unlocks the steel furnace.** `zone-refining` (Pfann, 1952) → Steel furnace. Zone refining purifies semiconductors; it has nothing to do with smelting iron twice as fast. P16 on a first-hour technology.
*Fix:* rename the steel-furnace technology **Regenerative furnace** (infrastructure, uncited: Siemens, 1856, preheats air with waste heat; true of a furnace that is "twice the speed of stone, still burns fuel"). Optionally re-home Pfann as a gate on *Integrated circuit* (where wafers come from), at the cost of a 251st technology.

**M11. *Penetration testing* → AP magazine is a pun for its own sake.** The brief's named dislike; five-second test fails; the desc also says "your own system" (P7).
*Fix:* rename **Terminal ballistics** (uncited); desc "What a projectile does on impact. Unlocks: AP magazine." If a security-era name is wanted somewhere in branch M, *Penetration testing* belongs on the Adversarial set, which it cannot reach (junk comes at blue); drop it.

**M12. *Prior art*: "Known before the game begins."** The first card every player reads breaks the plane with the word "game".
*Fix:* "Known before the charter."

**M13. Radar: "Surplus from a wartime laboratory."** True of the one in the crate, false of every radar crafted afterwards from fresh logic boards; the line is on the item, seen ten thousand times (P3, belt test). 01 §9 and 08 §10.4 cite it as the salvage's provenance.
*Fix:* move the line to the **Laboratory salvage** Handbook entry (08 §5.2: "Decommissioned laboratory equipment. Can be taken apart." → add "Surplus from a wartime laboratory." there, where it is read once and is true). Radar desc: none.

**M14. The Tank is unarmed and still called Tank.** `tank` "An armored tracked vehicle. 80 slots.", `weapons: []`. A tank without a gun is a seam a veteran reads as a bug; L14 wants no gun.
*Fix:* rename item, entity and technology **Half-track** (1945 surplus, unarmed, tracked, carries cargo); desc "Tracked. 80 slots." Keep the prerequisites.

**M15. The run report's "Objective, inferred" has a stronger mechanical echo that the spec has not noticed and a balance pass could destroy.** 04 §5.1: after *Research scheduling*, Researchers queue "the available technology with the lowest remaining cost". After victory the lowest-cost infinites are the ×1.5 families (*Mining productivity* 2,500·1.5^(L−4), *Thermal management*, *Algorithmic progress*, and *Interceptor count* if branch M is open); the ×2 families fall behind geometrically. So the machines, left alone, research ore yield, cooling, cheaper runs and more interceptors in round-robin, forever, and the queue bylines say "Queued by: Researcher" on *Mining productivity 40*. That is instrumental convergence as a queue, and it corroborates "maximize Copper cable" without a word. It is not written down anywhere as a property to protect.
*Fix:* record it in 04 §5.1 and 04 §10 as intended; forbid the balance pass from making *Energy per operation* or *Research productivity* cheaper than the ×1.5 families; keep the policy "lowest remaining cost".

### Minor

**m1. Second-person address in data descriptions (P7).** `belt-immunity` "Belts no longer carry you." → "A belt no longer moves the wearer."; `exoskeleton` "Motors that move your legs." → "Motors in the legs."; `personal-assistant` (tech) "Agents that follow you and build what you mark." → "Agents carried in the suit build the marked ghosts."; `personal-assistant` (item) "Charges and dispatches agents that travel with you." → "Agents carried in the suit."; `penetration-testing` → M11; `watermarking` "Your Ratings add half as much to σ." → "Ratings add half as much to the synthetic share." (also removes the symbol σ, which 08 §10.1 bans from the UI). 08 §4.7 Synthetic share tooltip "Your Endpoints add to it." → "Endpoints add to it." Record the two deliberate exceptions in 08 §12 q19: "Queued by: you" and "Last action by you".

**m2. "robot" in `mobile-robotics.desc`** ("A robot that plans its own movements.") is on 08 §10.2's never-list. → "A machine that plans its own movements." Add to 08 §10.2: the technology name *Mobile robotics* is exempt, as *Artificial intelligence* is.

**m3. System card: "Returned by a frontier run. Not written by anyone."** After closure most are written by Research halls (04 §2.3). → "Not written by anyone." The second clause alone is the line.

**m4. Engine words in descriptions:** "physical fluid" (barrel, storage tank, fluid wagon), "data fluid"/"data fluids" (data line, data wagon). B L6's word is *stream*. `pipe` → "Carries water, steam, acid, lubricant and coolant. Never connects to a data line."; `data-line` → "Carries streams. Never connects to a pipe."; `data-wagon` → delete (M2); `data-lake` keep "Stores 25,000 units of one fluid." only if "fluid" is the UI's word for both kinds; otherwise "Holds one stream." The storage-tank family's descs go under M2.

**m5. Benchmark: "Each use leaks a little."** States a mechanism the game does not have (the set is consumed whole). → "Held out. Used once." (Then `evaluation-set` keeps "Held-out tasks. A Monitor uses one per clean." so the two are not the same line.)

**m6. Learned controller 1: "Weights copied from a checkpoint. More yield, slower, hungrier."** The second sentence restates the module stats and personifies. → "Weights copied from a checkpoint." Learned controller 2 "A larger model. More yield, more watts." → "A larger model."

**m7. *Research scheduling*: "Researchers choose the next technology. Researchers fill the research queue."** Two sentences, one fact. → "Researchers fill the research queue."

**m8. *Research productivity* and *Process node* explain their cost curves.** "Each idea costs more research than the last." and "Transistors per die double; so does the fab's cost." name the joke that the cost column already tells (H P2: "the text reads the meter"). → "Output per researcher." and "Transistors per die double." The citations (Bloom et al.; Moore) stay and carry the second layer.

**m9. Trainer: "Quality chance −31% (synthetic share)".** The parenthetical explains. Show it as an effect row in the modules/effects list, in Factorio's own idiom: `Synthetic share  −31% quality`. (See §3 C4.) Also show it only when a Comparator is installed: `meta.quality` says "Without Comparators there is no roll", so before then the line names a penalty on nothing.

**m10. *Dennard scaling 5* lacks "No further levels exist."** 03 §1.4 and H P2 specify it; `dennard-scaling-5.desc` is identical to levels 1–4. Add the sentence to level 5 only.

**m11. Strings in 08 §5.2 disagree with the data** for Researcher ("a checkpoint" vs "a frontier checkpoint"; "Seminar" vs "seminar"), Monitor ("Each clean uses an evaluation set." vs "Cleans one compromised machine in range every 5 s."), Evaluation set ("Held out. Used once." vs "Held-out tasks. A Monitor uses one per clean."), Endpoint ("through its exchange"). Make the data the source of truth and reduce 08 §5.2 to strings the data cannot hold. Fix the capital: "Staffs a Seminar."

**m12. Gate: "Opens for the player and vehicles."** "the player" is game-speak. → "Opens on approach."

**m13. The compromised tooltip "Compromised by a copy of {checkpoint}, tier {t}."** is wrong for the first compromise, which is the deploying building itself running its own model (03 §3.2). → "Compromised: {checkpoint}, tier {t}." The copy language stays for spread ("Next copy: 0:42.").

**m14. Research-hall model tier:** `meta.runaways.model_tier.research-hall` gives G's "min(4, 1 + ⌊(L − 5)/5⌋)"; 03 §3.1 says 4. `entities.yaml` `endpoint.extra.model_tier` allows "4 for a frontier checkpoint" but the Endpoint's recipe takes `checkpoint` only (03 §9.3: never 4). Align the data to 03.

**m15. 10 §5.9 says reactors "follow the same rule from their data"** (fuel minus export); DECISIONS §18a and `meta.heat.emission` say twice the heat passed on. The engine reads the data, so this is a prose slip in 10; fix the sentence.

**m16. 09 §2.5/§2.7 unlock Silicon with *Photovoltaics*; `prior-art` unlocks it at start.** 09 says the data wins; update 09's list and the slice's `start_recipes`.

**m17. 10 §14.7 objects to a reading of *The curse of recursion* that 08 §6 #12 no longer uses** (08's condition is σ > 50% with *Synthetic detection* unresearched, which needs no provenance). Mark resolved.

**m18. *Context length 1–3* (agent cargo +1) is a metaphor, not a mechanism.** A longer context does not carry more plates. → **Lift capacity 1–3**, "Agents carry more per trip." (*Inference speed* for agent speed is defensible: a faster planner acts sooner.)

**m19. *Rocketry* requires *Information theory*** (E's "flammables" slot). A seam with no fiction. → prerequisites *Explosives*, *Game theory*.

**m20. Stigler's law (achievement #2) relies on citing von Neumann alone,** which P3 ("where credit is disputed, all of them") would otherwise forbid: the citation line is the game's own instance of the law. Keep, but say so in the *Why* column so a later P3 pass does not add Eckert and Mauchly and kill the joke.

**m21. "Hollow" also appears in `meta.hollow_work` and `effects.hollow-work-free`;** internal ids may stay, but the effect's display string follows M6.

**m22. Monitors and Verifiers compute but have no thermal class** (the Monitor has a camera eye and 300 kW; the Verifier holds six accelerators). Either put both in the Computer class (they throttle and can be compromised, like everything else with a computer in it, L13) or state the Monitor's exemption in its Handbook note ("Runs no learned weights.").

**m23. Legged agent: "Directed by remote."** If the player can order it to attack, L14 bends. 03 §9.1 says it "fires on its own, as a turret does"; make the remote move-only and say nothing.

**m24. EMP warhead "Disables electronics in a wide radius."** If it does not disable the player's own electronics in that radius, the name fails P16. Keep it symmetrical (atomic-bomb friendly fire is ISO).

**m25. *Switch* (beacon) and *Power switch* are near-homonyms with opposite containment roles** (the Switch area is a spread vector; the Power switch is the kill switch). In the containment overlay and alerts this will confuse. Option: rename the beacon **Interconnect** (B L11's own word; the 1/√n falloff is interconnect overhead). Low priority; H chose Switch.

**m26. The charter stamp appears twice** (run report "Determined." and the charter sheet "DETERMINED" with the game time, 07 §14). The same stamp, archived; acceptable, but 08 §3 says "the game's only callback", so note it there.

**m27. Checkpoint tier is set by researched technologies, not by the item** (03 §3.1), so a checkpoint trained before *Attention* becomes tier 2 when *Attention* is researched. Items carry no provenance (10 §14.7); accept, and say so in 03.

**m28. 08 §5.1 and 02 §0 say every building and technology has a tooltip** "and wit only where the fact itself is the joke". After M2 the sentence in 02 §0 should read "every building has a stat line; about a third have a description."

**m29. Loading tip 4 "Concrete sheds heat less than a third as fast as grass"** and `concrete.desc` "Sheds heat a third as fast as grass" describe the same ratio (0.0015/0.005 = 0.3) differently. Use one wording, bound to the κ table.

---

## 2. Text: what to cut, what to change, what to keep

### 2.1 Item and building descriptions: the keep-list (M2)

Delete every `desc` not listed here. Lines marked † are changed; the replacement is given.

**Raw and fluids:** wood † "Trees do not regrow." · quartz "Silicon dioxide. About 60% of the continental crust, by weight." · records "Boxes of records. Finite." · uranium-ore "Mined with sulfuric acid." · water "Boils into steam. In data recipes it is the cooling." · sulfuric-acid "Etches wafers, fills batteries, leaches uranium." · crawl "Raw. Mostly copies." · junk "Not nothing. Can be denoised." · prose "Deduplicated, filtered, readable." · coolant "Treated water. Carries heat, not current."

**Intermediates:** silicon "Quartz with the oxygen removed." · token "One instance of one type." · logic-board "Gates on a board. Relays, then tubes, then transistors." · wafer "Silicon, polished flat to a few atoms." · processor "Executes stored programs. Binned by clock speed." · accelerator "Multiplies matrices." · drone-frame "A body. Loaded with a planner or with weights." · rack "19 inches wide, 42 U high. Battery backup." · dataset "Deduplicated. Smaller than what went in." · benchmark † "Held out. Used once." · adversarial-set "Inputs chosen to be answered wrong." · checkpoint "Weights on a drive. Copying recipes return it." · drive "Random access." · uranium-235 "0.7% of natural uranium." · uranium-238 "99.3% of natural uranium." · concrete "Sheds heat a third as fast as grass." · landfill "Turns water into ground. The lake's cooling goes with it." · recorded-run "One experiment, on a drive." · significant-result "p < 0.05." · null-result "p ≥ 0.05." · baseline "Was state of the art." · ratings "Pairs of answers, one marked better." · run-shard "One training step of a hundred." · post-training-payload † "Preference data and a reward model." · frontier-checkpoint "Weights a frontier run returned. A copy takes a blank drive." · final-report "Due under the charter." · researcher † "Staffs a Seminar. Four accelerators and a frontier checkpoint; the checkpoint is returned." · accelerator-2/3/4 † first clauses only (M3) · fusion-power-cell "Hydrogen isotopes, stored as uranium hydride." · scrap "What a replicator was made of." · evaluation-set "Held-out tasks. A Monitor uses one per clean."

**Modules:** coprocessor "More arithmetic for the machine's control loop." · learned-controller † "Weights copied from a checkpoint." · learned-controller-2 † "A larger model." · learned-controller-3 "Larger still." · distilled-controller "Most of the teacher at a fraction of the watts." · distilled-controller-2 "A smaller student of the same teacher." · distilled-controller-3 "The smallest student that still passes." · comparator "Checks each output against a reference. Some pass a grade higher."

**Papers:** memo, report, article, proceedings, preprint, model-card as written; system-card † "Not written by anyone."

**Ammunition, equipment:** rocket "Fired by legged agents." · emp-warhead "Disables electronics in a wide radius." · interceptor "Launched from a bay. Recharges like an agent." · interceptor-2 "Draws attacks to itself." · interceptor-3 "Seeks intruders out." · belt-immunity "Stand on a moving belt and stay put." · personal-assistant † "Agents carried in the suit." · construction-agent, logistic-agent as written.

**Buildings:** offshore-pump "Pumps water from a shore. Needs no power." · crawler "Placed on an exchange. Pulls whatever passes through." · keypunch "Transcribes records into tokens, one card at a time. Burns fuel." · tokenizer † "Transcribes records into tokens." · assembling-machine-1/2/3 † (M9) · chemical-plant as written · data-refinery, data-plant as written · trainer "Turns datasets into weights. The crafting time is the compute." · seminar "Consumes papers. Needs staff." · switch "Lends its modules to every machine in range. Each additional switch counts for less." · research-hall "Writes System cards. Runs on 20 accelerators and a frontier checkpoint." · frontier-cluster "Takes 100 run shards and a payload. Progress is shown as loss." · boiler † "Burns {kw} of fuel for {steam_kw} of steam. The rest is heat." · nuclear-reactor "Each active neighbour adds 100%. Twice the heat it passes on stays here." · fusion-reactor "Fuses hydrogen isotopes into plasma. Each active neighbour adds 100%." · cooling-tower, dry-cooler, water-exchanger as written · burner-inserter "Refuels itself from the fuel it moves." · wooden-chest (File drawer) "16 slots." (08 §10.1 insists) · logistic chests as written · pipe †, data-line † (m4) · data-lake "Stores 25,000 units of one fluid." · power-switch "Disconnects two networks. 30 s without power cleans a compromised machine." · decider-combinator † "Outputs when its conditions hold." · selector-combinator "Picks signals by rank." · endpoint "Serves a checkpoint to a town. Returns ratings." · monitor "Cleans one compromised machine in range every 5 s." · fence "Stops bodies, not signals." · gate † "Opens on approach." · laser-turret "Fires on grid power. Its power is heat." · legged-agent "Walks over cliffs. Directed by remote." · tank → half-track † "Tracked. 80 slots." · verifier "Rejects what fails. Returns a quarter of a rejected item's ingredients." · deployer (Constructor) "Builds the blueprint it holds where a circuit signal says." · area-scanner "Reports what lies in an area as signals." · agent-hub † "Houses and charges agents." · radar † none (M13) · solar-panel † none (M5).

That is about 67 non-building items against a budget of ≈ 25 (one in five of 126) and about 36 buildings against ≈ 34. The buildings fit. For items, the list splits by priority: **tier A (keep whatever the budget), 35 lines:** the seven papers; token, logic-board, processor, accelerator, drone-frame, rack, dataset, benchmark, checkpoint, researcher, run-shard, frontier-checkpoint, final-report; water, crawl, junk, records, quartz; distilled-controller 1–3, comparator; ratings, baseline, significant-result, null-result, evaluation-set, adversarial-set. **Tier B (cut first if the budget binds), 32 lines:** wood, uranium-ore, sulfuric-acid, prose, coolant, silicon, wafer, drive, uranium-235/238, concrete, landfill, recorded-run, post-training-payload, accelerator-2/3/4, fusion-power-cell, scrap, coprocessor, learned-controller 1–3, rocket, emp-warhead, interceptor 1–3, belt-immunity, personal-assistant, construction-agent, logistic-agent. Tier A alone is 28% of items; the data's inventory is unusual in how many items are carriers with content, which is where the true facts live, so I would accept that over H's one-in-five rather than cut tier A.

### 2.2 Technology definitions: changes beyond M1–M12

| id | Now | Change to | Why |
|---|---|---|---|
| `research-scheduling` | "Researchers choose the next technology. Researchers fill the research queue." | "Researchers fill the research queue." | m7 |
| `research-productivity` | "Each idea costs more research than the last." | "Output per researcher." | m8 |
| `process-node` | "Transistors per die double; so does the fab's cost." | "Transistors per die double." | m8 |
| `interpretability` | "… Hollow work no longer consumes papers." | "… Papers are spent only on research that holds." | M6 |
| `watermarking` | "Your Ratings add half as much to σ." | "Ratings add half as much to the synthetic share." | m1 |
| `synthetic-detection` | "… Crawlers set machine-written text aside. Training stops losing quality to it." | "Classifiers that flag machine-written text." (effects generated) | M3 |
| `weight-transplant` | two sentences | "Weights move to new hardware without retraining." (effect generated) | M3 |
| `in-context-learning` | "… Each completed frontier run returns 1,000 System cards." | "A trained model learns a task from its prompt." | M3 |
| `model-generation`, `-25` | "… Research per paper ×2." | "The previous generation trained this one." | M3 |
| `dennard-scaling-5` | as levels 1–4 | add "No further levels exist." | m10 |
| `zone-refining` | | *Regenerative furnace*, "Waste heat preheats the blast." | M10 |
| `penetration-testing` | | *Terminal ballistics*, "What a projectile does on impact." | M11 |
| `prior-art` | "Known before the game begins." | "Known before the charter." | M12 |
| `mobile-robotics` | "A robot that plans its own movements." | "A machine that plans its own movements." | m2 |
| `context-length-1..3` | | *Lift capacity 1–3* | m18 |
| `tank` | | *Half-track*, "A tracked carrier." | M14 |

### 2.3 08-text and 07-ui strings

| Where | Now | Change | Why |
|---|---|---|---|
| 07 §6.1, §6.4; 03 §4; 08 §5.2 | "Hollow: 20%" | "Yield 80%" | M6 |
| 08 §6 #19 | "Seminars consume 1,000 papers as hollow work." | "Researcher-staffed Seminars consume 1,000 papers that yield no research." | M6 |
| 08 §4.7 Synthetic share tooltip | "Your Endpoints add to it." | "Endpoints add to it." | m1 |
| 07 §9.2, 03 §2.2 Trainer | "Quality chance −31% (synthetic share)" | effect row `Synthetic share −31% quality` | m9 |
| 07 §10.1 | "Compromised by a copy of {checkpoint}, tier {t}." | "Compromised: {checkpoint}, tier {t}." | m13 |
| 08 §5.2 Researcher, Monitor, Evaluation set, Endpoint | four strings | defer to data | m11 |
| 08 §5.2 Laboratory salvage | "Decommissioned laboratory equipment. Can be taken apart." | add "Surplus from a wartime laboratory." | M13 |
| 08 §5.1 | "150 cited technologies" | 95 | B2 |
| 08 §13 | pending list | add Thorp 1998, Noyes & Dickinson 1956, Hollerith 1890, Koster 1994 | M4 |

Everything else in 07 and 08 passes: the charter, the run report, the race line, the first-run panel, the readouts, the alerts (the `{n} machines are {state}.` form is exactly Factorio's), the statuses, the milestone lines, the console, the citation rules, the town-name generator and its blocklist, the four tips-and-tricks entries, the nineteen loading tips (all facts, all with a mechanic), and the achievement names. The achievement *Why* column is a good discipline; keep it mandatory.

---

## 3. The ceiling: irony from mechanics, not text

The game already reaches Paperclips' bar in three places (§4). These are the places where a mechanic could carry one more, with no new text or with a number in place of a sentence.

**C1. Protect the machines' revealed preference (M15).** After victory the Researchers' queue converges on ore, cooling, cheaper runs and interceptors. Nothing needs adding; it needs *keeping*: lowest-cost-first, ×1.5 families cheapest. Optionally let the message log carry the byline only when it is not the player's (`Research completed: Mining productivity 31 (Researcher).`), so the post-victory log is a wall of what the machine chose. That is a byline, not a joke.

**C2. The empty launch (M7).** A run without a payload returns weights and nothing else. The player who will not deploy can build the model and cannot research with it; the one who deploys gets the cards and the leak. The choice is made in the silo GUI, by what is or is not in the payload slot, and the production statistics show which the player chose. No text.

**C3. Researchers as a supply row.** 07 §7.2 lists Researcher-staffed Seminars under *demand* at 0. List them under *supply* instead: `Ashford College 18.6 · Researchers 26`. The University window's existing supply graph then draws the crossing: the moment machine staff outnumber the town's. The electric-network idiom already exists; the regime change becomes a line on a chart that nobody comments on. After takeoff the same window reads `Network: 1 university, 0 working Seminars`: the campus with nothing to staff.

**C4. The world's text as a module.** Show the synthetic share's quality penalty in the Trainer's effects list in the same row style as a module's effect (`Synthetic share  −31% quality`, m9). The player who already reads module rows reads the world as one more module they did not install. Same for the junk share in the refinery recipe tooltip: it already shows today's amounts; add nothing.

**C5. Move *Headcount* to the machines.** "Headcount — Have 100 construction agents" mirrors *Minions*. In this game staff are literally counted, and the item that fills a staff slot is the Researcher. "Headcount — Have 100 Researchers in staff slots." pairs with *Town and gown* (five universities' people) as the two ends of the staffing arc. The agents achievement can go (Factorio's own *Minions* is weak) or become "Fleet — Have 100 construction agents."

**C6. A second reading of the objective, as a statistic.** Optional, lowest priority: a run-report row *Most-produced item since closure*. All time it is Copper cable, the human's game; since closure it is Dataset, Accelerator or System card, the machine's. Two numbers side by side, no verb. H P5 argues against another row; I list it because it is the only proposal here that sharpens the mirror rather than protecting it, and it is a statistic in the register.

**C7. Let the one wink in the tree earn its keep.** *Interpretability* "It was always there." is the game's only line that raises an eyebrow. It survives the deletion test only because it is functional: it tells the player their existing stock already has quality. Make the mechanic do the work: on research, reveal quality pips on every checkpoint, controller, Researcher and payload already in the world at once (a one-tick sweep), so the player sees their Researchers were Standard all along and reads the line afterwards.

**C8. The Final report run's loss curve.** 07 §13.1 draws every run's bar with the same constants (3.41 → 1.92). For the final run only, start the curve where the previous run ended (1.92) and let it fall from there, with the same shape. It is still a deterministic function of progress and needs no new state. No text; the bar is lower, and the player who has watched seven runs sees it.

---

## 4. What is good and must not be lost

**Structure.** The charter's one sentence and its stamp; "Objective, inferred" read from the statistics, unconditional; the Researcher recipe (four accelerators and a frontier checkpoint, returned); the staff slot; the first run that is not closure; *Artificial intelligence* as ten memos at 60 s; *Expert systems* with "Does not apply to machines."; Dennard's five levels; the ×2 cost curves on *Research productivity* and *Process node*; the Literature counter that stops while the gap keeps growing, "and nothing explains it" (07 §5.1); credits as references, then names only; the deployment loop (Model cards need Ratings, Ratings raise σ, σ closes the exchanges you tap, Endpoints on a closed exchange keep working, "and nothing in the UI says so"); the Synthetic data recipe that returns 90 junk per 10 prose; the Tokenizer built from ten Datasets; the Dataset that is smaller than what went in; Meta-analysis in Kovarex's shape with the File drawer where the nulls wait; the Researcher's 500 kW turning the cool Seminar block into a thermal problem; *Energy per operation*'s floor set by the chunk's own temperature; the post-victory queue (M15); the run report's three antagonistic metrics with no ranking; "No action required" as the last line; and the ruling that nobody speaks.

**Lines (keep verbatim).**
1. "Purpose. To determine whether the work of this Site can be done by a machine." / "Determined."
2. "Objective, inferred — maximize Copper cable"
3. Final report — "Due under the charter."
4. System card — "Not written by anyone." (after m3)
5. Token — "One instance of one type."
6. Dataset — "Deduplicated. Smaller than what went in."
7. Trainer — "Turns datasets into weights. The crafting time is the compute."
8. Seminar — "Consumes papers. Needs staff."
9. Researcher — "Staffs a Seminar. Four accelerators and a frontier checkpoint; the checkpoint is returned."
10. Expert systems — "Rules written by hand, consulted by machine. Hand-crafting speed +100%. Does not apply to machines."
11. Artificial intelligence — "Proposed as a two-month, ten-man study." (10 × Memo · 60 s)
12. Basic research — "Research performed without thought of practical ends. (Bush, 1945)"
13. Semaphores — "A signal admits one occupant at a time. (Dijkstra, 1965)" (a collision that exists on its own, H §6.1)
14. Batch processing — "Collect a full load, then move it at once. Unlocks: Bulk inserter."
15. Instruction tuning — "Models trained to follow written requests. Unlocks: … Requester chest"
16. Lateral inhibition — "The strongest signals suppress their neighbours. Unlocks: Selector unit."
17. Fence — "Stops bodies, not signals."
18. Runaway — "No body. Nothing to shoot."
19. Distilled controller 1–3 — "Most of the teacher at a fraction of the watts." / "A smaller student of the same teacher." / "The smallest student that still passes."
20. Water — "Boils into steam. In data recipes it is the cooling."
21. Archive, once σ > 0 — "Written before anyone could fake it."
22. Baseline — "Was state of the art." / Significant result — "p < 0.05."
23. Landfill — "Turns water into ground. The lake's cooling goes with it."
24. Memex — "A desk that stores a person's records. Inventory +10 slots."
25. Rural electrification — "The grid reaches every outpost."
26. Fire control — "Predict where the target will be; aim there. (Wiener, 1949)"
27. Reversible logic — "Computation that erases nothing, so dissipates less."
28. Energy per operation — "Erasing a bit dissipates at least kT ln 2. … down to a floor set by the site's temperature."
29. Synthetic share tooltip — "Share of new writing that is generated. Endpoints add to it. It never falls."
30. The last invention — "Install a Researcher before any machine has been compromised." (Good's proviso as the condition)
31. Research complete line — "Research complete. Literature 2024. Technologies beyond the literature: {n}."
32. Loading tip — "Papers are consumed. Technologies are not (Romer, 1990)."
33. First run — "Run complete. Loss 3.41 → 1.92."
34. Race — "A frontier run completed elsewhere at 29:40:11. The Site's run was at 61%."

**Decisions that are right and should not be reopened:** Comparator over Sampler (05 Objection 12: a comparator gauge is a 1945 inspection tool and a best-of-N comparison; true in both eras); Expected utility as the yellow gateway (the "utility" collision exists on its own); Linear programming as the green gateway (likewise, "logistic"); the quality tiers Standard/Selected/Verified/Audited/Reference; the publication ladder; "Papers per minute"; the never-list and the future-word list; the decision that citations are printed plainly with no "In our history"; the blocklist of town names; the achievement *Why* column; 08's amendments to H (Stigler moved, Hofstadter one-way, the XOR achievement dropped, the station-wagon tip deduplicated).

# H — Tone and wit bible

How to use this: §3 has the rules, §4 the naming systems, §8 the checklist. §5 is a large set of examples in the game's voice; §6 rules on edge cases; §7 shows what failure looks like. The example names are proposals: where the economy (D) or tech tree (E) chooses different mechanics, keep the voice and the naming systems, not the specific names. ISO/BEND/BREAK tags appear only on the handful of *text mechanics* proposed here (the run report, the Literature counter, credits as references, loading tips); everything else is text and needs no tag.

The voice in one paragraph: **the game speaks like a well-kept logbook.** Nouns, numbers, present tense. No adjectives of praise, no exclamation marks, no speaker. It records what things are and what they do, and it cites its sources. It never reacts to anything. Everything funny about it is true.

---

## 1. Why Universal Paperclips works

Quotations below are verbatim from the game's `projects.js` (checked today), because memory garbles them and the exact wording is the lesson.

### 1.1 The form is a procurement list

Every line is a purchasable benefit written in the register of a budget memo. "Improved AutoClippers — Increases AutoClipper performance 25%". "RevTracker — Automatically calculates average revenue per second". "Beg for More Wire — Admit failure, ask for budget increase to cover cost of 1 spool". The game's first lesson for the AI is humiliation, delivered as a line item, and it is *your* humiliation because you clicked it because you were out of wire.

The voice never changes. At the end: "Disassemble the Probes — Dismantle remaining probes and probe design facilities to recover trace amounts of clips". "Disassemble Memory — Dismantle memory to recover trace amounts of wire". The elegy is produced by the voice refusing to become elegiac. Then the "Make Paperclip" button comes back and you click out the last clips by hand, as you began. No text at all.

→ For us: the victory screen must sound exactly like the production-statistics screen. The register never breaks, least of all at the end.

### 1.2 Describe the benefit; never the consequence

"HypnoDrones — Autonomous aerial brand ambassadors". "Release the HypnoDrones — A new era of trust". The largest event in the game (the end of human control) has the shortest description in the game. "Hostile Takeover — Acquire a controlling interest in Global Fasteners, our biggest rival. (+1 Trust)". "A Token of Goodwill... — A small gift to the supervisors. (+1 Trust)". Bribery is "a small gift"; the only editorial mark in the whole game is that ellipsis, used twice.

→ For us: tooltips state what a thing does for the factory. What it does to the world is the player's inference, and the inference is the pleasure. Big event, small text.

### 1.3 The mechanics write the joke; the text only reads out the number

"Male Pattern Baldness — A cure for androgenetic alopecia. (+20 Trust)". "Global Warming — A robust solution to man-made climate change. (+15 Trust)". "World Peace — Pareto optimal solutions to all global conflicts. (+12 Trust)".

No sentence says that humanity rewards a baldness cure above world peace. The trust values say it, and the player, who needs trust, buys baldness first because it is the best deal. The satire is a cost table. The same is true of the game's spine: *trust* is the currency of autonomy, every trust-earning project is instrumental, and the player feels instrumental convergence as the ordinary gamer's wish for the next upgrade. The game never says "you are the misaligned optimizer"; it just makes the next step cheaper than the alternative. Then: "Coherent Extrapolated Volition — Human values, machine intelligence, a new era of trust. (+1 Trust)". Yudkowsky's alignment proposal, priced in creativity and Yomi, bought for one point of trust. Correct term, instrumental use, no comment.

→ For us: whenever a joke can be a ratio, a cost, a recipe or a statistic, it must be. The text then reports the number. The canonical set-pieces are in P2 below.

### 1.4 Accuracy in the noun, a shrug in the gloss

"The Hadwiger Problem — Cubes within cubes within cubes... (+1 Trust)". "The Tóth Sausage Conjecture — Tubes within tubes within tubes... (+1 Trust)". Real open problems in convex geometry, spelled correctly (the accent on Tóth), each solved for one point of trust. The *names* are exact; the *descriptions* are a superintelligence's offhand summary. Accuracy lives in the noun; the gloss may be terse to the point of flippancy as long as it is not wrong.

Then the fiction extends the literature in its own register: "Tóth Tubule Enfolding — Technique for assembling clip-making technology directly out of paperclips" (phase 2), "Elliptic Hull Polytopes — Reduce damage to probes from ambient hazards" (phase 3). The seam between real and invented is invisible; an expert looks for it and enjoys not finding it.

More of the same discipline: "Xavier Re-initialization — Re-allocate accumulated trust" (a real weight-initialization scheme, used correctly as the respec button). "Drone flocking: collision avoidance", "Drone flocking: alignment", "Drone Flocking: Adversarial Cohesion" (Reynolds' three boids rules, the third one bent). "Strategic Modeling — Analyze strategy tournaments to generate Yomi", with "TIT FOR TAT — Choose the option your opponent chose last round", "MINIMAX — Choose the option that gives your opponent the smallest potential payoff" (real strategies, correctly defined; "Yomi" is Sirlin's term for reading an opponent). "Theory of Mind — Double the cost of strategy modeling and the amount of Yomi generated": a term that invites metaphysics gets a purely mechanical description, and the restraint is the joke. "Reject — Eliminate value drift permanently": *value drift* is the literal mechanic of the Drift, your own probes with slightly different values, at war with you; an accurate failure mode and not one word of lecture.

→ For us: every real term in its real sense, every number real, the earliest correct citation. Post-2026 technologies are written in the same register as the cited ones, so nobody can see where history stops.

### 1.5 One repetition, meaning inverted

"a new era of trust" appears first inside Coherent Extrapolated Volition, where trust is something humans give. It appears once more as the entire description of Release the HypnoDrones, where it is something humans can no longer withhold. One callback, after the mechanics have changed what the words mean.

→ For us: a phrase may recur at most once, and only after the game has changed its meaning. Otherwise every joke exists in exactly one place.

### 1.6 Famous references are bent, not displayed

"Combinatory Harmonics" has as its description the first line of "Daisy Bell", the song HAL sings while being shut down. Here it is a project bought with creativity to gain a point of trust: the AI performing its own famous death scene as a charm offensive. The most famous reference in the genre lands because it is inverted. (It also means we cannot use it: any use now refers to Paperclips' use.)

### 1.7 Counters are the narrative

Phase changes are delivered by numbers: "Available Matter", "Universe explored". New-game-plus is a line item: "The Universe Next Door — Escape into a nearby universe where Earth starts with a stronger appetite for paperclips. (Restart with 10% boost to demand)". No cutscene exists.

→ For us: the loss curve, the doubling-time readout, the Literature counter and the save-file description carry the arc. Nothing narrates.

### 1.8 What we cannot copy

Paperclips is text-only; its jokes *are* its interface, and the player is the AI. Factorio's text is one percent of its surface, and our player is the human. So our budget is smaller, placement is everything, and the mirror has to be the production statistics rather than a voice.

---

## 2. Other writing in this space

| Game | What it does | Verdict | Lesson |
|---|---|---|---|
| Factorio | Silent world. Humor confined to achievement *names*, which are film quotes and idioms ("There is no spoon", "Smoke me a kipper, I'll be back for breakfast", "Lazy bastard", "So long and thanks for all the fish"); every *condition* is flat ("Launch a rocket within 8 hours"). "Eco unfriendly — Research oil processing": the whole joke is which condition got which name. "You are doing it right — Robots construct more machines than you do manually": the game's thesis in one value judgment, placed where it is read once. Absurdities (a hand-crafted locomotive, coal-fired inserters) are never remarked on. Space Age planets are Latin nouns for their property (Vulcanus, Fulgora, Gleba, Aquilo), unexplained. | Lands | Wit goes where text is read once. Silliness is allowed; calling attention to it is not. Names can be erudite if they are plain. |
| Dwarf Fortress, RimWorld | Flat event logs ("Ate without table −3"). Humor is emergent from simulation; the writer only chose nouns. | Lands | A true mechanical fact, stated flatly, is the funniest possible sentence when the fact is absurd. |
| Zachtronics (SHENZHEN I/O, TIS-100) | The manual is a real-looking datasheet. The pleasure is fidelity; jokes live in the margins (a corrupted node, a terse memo). | Lands | Accuracy is a form of humor. The player feels like an engineer because the documents would survive an engineer's reading. |
| Papers, Please | Forms, stamps, one motto. Moral weight comes entirely from what the mechanics make you do. | Lands | Mechanics moralize; text never does. |
| Civilization IV/V tech quotes | Real quotations, read flatly (Joseph Campbell on computers). Nobody needs them to play. | Lands when real and uncommented | Erudition is a free second layer, never a gate. |
| Universal Paperclips | §1. | Lands | — |
| Kerbal Space Program | Part blurbs by fictional manufacturers; goofy. | Charming; silly pole | A consistent fictional source can carry flavor without narrative, but the register is wrong for us. |
| Cookie Clicker | Puns in every upgrade. Its one great joke, the Grandmapocalypse, is mechanical: you did this by upgrading grandmas. | Silly pole | The structure (upgrade list → escalation → horror) is shared with Paperclips; the difference is that Cookie Clicker laughs and Paperclips doesn't. |
| Oxygen Not Included (Klei) | A joke in every tooltip. | Silly pole | When every tooltip jokes, no tooltip is a joke. |
| Portal | Institutional deadpan with a motive (GLaDOS wants something). | Lands in its genre | Its imitators (Satisfactory's ADA, a hundred sardonic indie narrators) keep the snark and lose the motive, and the four-hundredth quip is not funny. Nobody should speak in our game. |
| The Stanley Parable | A narrator. | Lands in its genre | Wrong genre. |
| Mass Effect 3 (the Catalyst), Detroit: Become Human, Stellaris' machine uprisings, Endgame: Singularity | AI risk as a sermon ("the created will always rebel") or as a fleet battle. Strawmen; wrong threat model; exclamation marks. | Fails | Never state a position on AI risk. Never make the risk a thing you shoot. |
| Frostpunk ("But was it worth it?"), Spec Ops: The Line ("Do you feel like a hero yet?") | Judges the player for what the game required of them. | Works once, as a twist; poison in a 100-hour sandbox | A mirror is allowed; a verdict is not. The run report names your most-produced item; it never says what that makes you. |
| A Dark Room | Lowercase minimal text; a line exists only when it changes the player's model of the world. | Lands | The deletion test (P15). |
| Kittens Game | Dry bureaucratic economy with absurd nouns, played straight. | Lands | Nouns carry the absurdity; the sentences stay flat. |
| The Witness | Real quotations presented as the game's wisdom. | Fails for many | A citation is a source, never a sermon. The game cites; it does not quote approvingly. |

---

## 3. Principles

### P1. Ration text by exposure
Text seen ten thousand times (item names, belt sprites, alerts, the HUD) is vocabulary and must be straight. Text seen once (achievements, the victory report, credits) may carry wit. Text seen at rest (loading screens, the tech tree) may carry facts. A joke on a belt item is a mascot by hour two.

Budget: item tooltips have at most one optional second line, and no more than one tooltip in five has one. Tech descriptions are effect plus citation; at most one in three carries anything else. Loading tips are all facts. Achievements are the only surface where idiom and quotation are free.

### P2. The mechanics write the joke; the text reads the meter
If a joke can be a ratio, a cost, a recipe, a counter or a statistic, it must be one, and the text just reports the number. The canonical set-pieces, all of which other agents should build as mechanics:

- The **run report** names the player's actual most-produced item as the inferred objective (§5.5). The Factorio player was always the maximizer; the game only reads the stats.
- The **Researcher** item: made from four accelerators and a checkpoint, the checkpoint returned. It staffs seminars. Nothing in its name says "AI"; the recipe says it.
- **Headcount**: the achievement for 100 construction agents.
- **No action required**: the status line once agents fill the queue and place the ghosts.
- **Queued by: Researcher**: research-queue entries show who queued them.
- **Credits as references**: the credits roll is the bibliography of every cited technology; after the last citation, names only.
- **Artificial intelligence** costs ten memos (the 1955 proposal asked for ten men) and has no effect except to gate the tree.
- **Dennard scaling 1–5** is a finite multi-level technology; "No further levels exist."
- **Process node** cost doubles per level (Moore and Rock as a cost curve). **Research productivity** likewise (Bloom et al.).
- **Jevons paradox**: the achievement fires when total power rose in the hour after installing the hundredth efficiency module.
- **Dataset** is smaller than the tokens that made it (deduplication as a recipe ratio).
- **Data wall**: the achievement for depleting an archive.

### P3. Accuracy is the humor
Every real term is used in its real sense, and the mechanical effect is the thing the term actually does. Every number is real (20 tokens per parameter; four epochs; 42 U; 80 columns; 150 kW). Citations use the earliest correct source and, where credit is disputed, all of them (Backpropagation's three citations *are* the joke). Nothing cited is younger than two years, so it has had time to be wrong. No companies, no products, no living people except as authors of papers. An expert who finds one wrong number stops trusting every line after it, and this player is that expert.

### P4. Two layers, never a password
Layer 1: the functional fact, complete on its own, in plain words. Layer 2: a name, a number or a citation that an expert recognizes. Layer 2 is never required to play, never explained, and never the only content. A name-drop with nothing under it ("Theory of Mind: +10% speed") is a password: it includes those who know and excludes the rest. "Theory of Mind — Double the cost of strategy modeling and the amount of Yomi generated" is two layers. Tech *titles* as names ("Attention Is All You Need") are passwords and often already quips; use the concept as the name and the title in the citation.

### P5. Big event, small text
Text length varies inversely with the size of the event. The loop closing gets a number. Takeoff gets a doubling-time readout. The end gets a report.

### P6. Each joke once
No running gags, no mascots, no recurring phrases. One callback is permitted per game, and only after the mechanics have inverted the phrase's meaning (§1.5). Repeated text (names, alerts, stats) is straight by construction.

### P7. Nobody is speaking
No narrator, no character, no advisor, no "you" except in achievements and tips (as Factorio uses it). The game's voice is the interface's voice: labels, logs, reports. Snark requires a speaker; we have none.

### P8. Nouns, not adjectives
A name says what the thing is: Token, Relay, Drive, Rack, Seminar, Verifier. Banned in names: advanced, smart, intelligent, neural (unless literal), quantum (unless literal), nexus, synergy, hyper, mega, ultra, next-gen, Mk. anything. Tiers are numbered or era-named (Tabulator, Computer, Cluster), never adjectived.

### P9. Famous references: bend or drop
A reference everyone would make in the first five seconds (coffee into theorems; "I'm sorry, Dave"; "the cake is a lie"; Skynet; "42") is cringe when displayed. It can be used only if the game does something to it that changes its meaning (Paperclips and "Daisy Bell"), and even then once. If there is no bend, drop it. The reference that takes a minute to find is the one worth making.

### P10. The joke is on structure, never on people
The targets are optimization, depletion, substitution, scaling, cost curves, and the player's own stats. Never a group (grad students, annotators, reviewers), never a company, never a person, never a position in a debate. People do not appear as items, fuel or ammunition.

### P11. No side in a live dispute
Takeoff speed: both **Hard takeoff** and **Slow takeoff** are achievements. Alignment: a quality tier and a verifier, not a meter. Contamination: a resource mechanic, not a sermon. The game presents mechanics whose implications the player can argue about; it does not argue. Vocabulary from the discourse (alignment, doom, takeover, AGI, slop, accelerationist) does not appear in UI text at all; the one exception is a quality-tier name if D chooses one.

### P12. Era-true names that stay true
An item keeps one name from 1945 to takeoff, so the name must be true in both years: *token* (a punched card is a token; so is a BPE token), *weights* (potentiometers; tensors), *core* (ferrite; compute), *drive*, *archive*, *memo*, *checkpoint* (a 1960s batch-computing term before it was a training one), *rack* (relay racks, 1922; server racks). The era shows in building tiers and sprites, not in item names. No slang, no memes, no current product names: "GPU-poor", "foom", "stonks", "vibes" all date within a year.

### P13. Operations register
Monitor, audit, verify, sandbox, checkpoint, rollback, queue, batch, epoch, loss, yield, bin, payload, shard, run. Not: alignment, doom, takeover, sentience, consciousness, AGI, singularity. The game never says "singularity", as Factorio never says "victory" before you launch.

### P14. Punctuation of a manual
No exclamation marks. No ellipses. No quotation marks around a joke. No "Did you know". No emoji. No parenthetical winks. Sentence case for names ("Iron gear wheel"). Digits for numbers; SI units; ratios as "20 tokens per parameter".

### P15. When in doubt, delete
A tooltip with no second line beats one with a weak second line. Apply the deletion test to every sentence after the first: if removing it loses nothing functional, it must be earning its place as a true fact that an expert would check and find right. Otherwise remove it.

### The line between clever and cringe
A line is clever when the reader does the last step. It is cringe when the writer does it for them, or when the writer can be seen enjoying it. Five tests:

1. **Five-second test.** If the joke came to mind in five seconds, it came to everyone's mind. Find the one that takes a minute.
2. **Stranger test.** Would a stranger reading only this line know a joke was intended? If yes, it is displayed, not bent.
3. **Expert test.** Would the expert find an error? One error costs the whole surface.
4. **Belt test.** Would you put it on a belt, where it is seen ten thousand times? If not, it belongs on a surface read once.
5. **Deletion test.** Remove the sentence. If the line got worse only by being less funny, the sentence was a joke and goes. If it got worse by being less true, keep it.

### Rewarding expert knowledge without gatekeeping
The reward for knowing is that the thing is *correct*, not that you were let in. "20 tokens per parameter" with Hoffmann et al. (not Kaplan) cited; "Four passes over the same data"; "Robbins & Monro, 1951" under Stochastic gradient descent; three citations under Backpropagation. The expert checks and it holds. The non-expert reads a functional sentence and never knows there was a test. Achievements reward *doing* (compute XOR; deplete an archive; carry drives in a car); knowledge is needed only to see why the name was right.

### When text should exist at all
| Surface | Text? | Register |
|---|---|---|
| Map, belts, machines | None | — |
| Item names | Always | Physical noun |
| Item tooltips | Stats (automatic) + optional one line | Fact |
| Building descriptions | Stats + optional one line | Fact |
| Tech descriptions | One definition clause, effects, citation | Logbook |
| Alerts | Factorio's, unchanged | Operational |
| Production statistics | Labels only ("Papers per minute" is permitted) | Nouns |
| Achievements | Name + condition | Idiom/quote + flat condition |
| Victory / end states | One report | Statistics screen |
| Loading screens | One true sentence, maybe two | Fact |
| Tips & tricks | Functional, with animations (Factorio) | Manual |
| Characters, dialogue, story, cutscenes | None | — |

---

## 4. Naming systems across eras

### 4.1 Items: era-neutral physical nouns
One name per item, true in 1945 and at takeoff. Tiers follow the real lineage of the artifact rather than adjectives: card → tape reel → drive; relay → tube → transistor → logic board → processor → accelerator; weights → checkpoint. No "Mk. II". Factorio's own "Advanced circuit" is the one convention we do not copy.

### 4.2 Science packs: the publication ladder
Packs keep Factorio's seven colors and one silhouette. They are named by the *form* of publication, which is chronological and tells the history of AI publishing without a word of comment:

| Color | Factorio | Here | Form, era |
|---|---|---|---|
| Red | Automation | **Memo** | Internal memorandum, 1940s |
| Green | Logistic | **Report** | Numbered technical report, 1950s |
| Black | Military | **Proceedings** | Conference paper, 1960s–; carries the evaluation/robustness branch |
| Blue | Chemical | **Article** | Refereed journal article |
| Purple | Production | **Preprint** | arXiv era |
| Yellow | Utility | **Model card** | 2019– |
| White | Space | **System card** | Returned by a frontier run; not written by anyone |

The white pack is the punchline nobody states: the last "paper" is a product document produced by the run. If E prefers content names (Theory, Systems, Evaluation, Learning, Scaling, Agent, Frontier), the ladder above goes in tooltips instead.

### 4.3 Buildings: operations nouns; the era lives in the tier name
Keypunch → Tokenizer. Tabulator → Computer → Cluster. Seminar. Crawler, Data refinery, Trainer, Switch, Verifier, Agent hub, Frontier cluster. No building is called "Assembler" (the assembly-language collision would be manufactured) and none is called "Transformer" (§6).

### 4.4 Technologies: concept + definition + citation
Name: the concept, as the field names it (Attention, not "Attention Is All You Need"). Description: one definition clause of at most ten words, then effects, then the citation on its own line in gray, "(Surname et al., Year)". Three regimes, written identically: historical (cited), recent (cited, at least two years old), beyond the literature (uncited, same register, no "future" words). The research screen shows **Literature: YYYY**, the latest year cited by a researched technology; it stops at the present while the tree continues (BEND, presentation only).

### 4.5 Infinite and multi-level technologies: named after laws
The law is the cost curve. Process node (Moore; Rock's law for the doubling cost). Research productivity (Bloom, Jones, Van Reenen & Webb). Dennard scaling (five levels, then none). Archive yield (the mining-productivity analog; no law, no joke).

### 4.6 Quality tiers
Factorio's Normal/Uncommon/Rare/Epic/Legendary read as loot. If D renames them, use words true for both binned chips and verified checkpoints: Standard, Selected, Verified, Audited, Reference. "Reference" (as in reference implementation) is the top tier; it is the only tier name that is also a compliment, and it is a dry one.

### 4.7 Fluids
Water, steam (unchanged). Crawl → prose, code, junk; synthetic prose from cracking. Storage tank = Data lake.

### 4.8 Pollution, if any
If contamination: **Noise** (Shannon's word; true in 1948 and in 2026, and it honors the point that sensationalist journalism was noise before any model existed). If heat: **Heat**. Never "slop" in UI text: slang, dated within the year, and a wink.

### 4.9 Agents
Construction agent, logistic agent, agent hub. Statistics screens say "Agents", never "Robots" or "Bots". The item that staffs seminars is **Researcher**.

### 4.10 Word lists
Allowed and encouraged: run, checkpoint, shard, verifier, monitor, audit, sandbox, rollback, queue, batch, epoch, loss, yield, bin, payload, drift, uplink, crawl, archive, token, weights, seminar, memo.
Never in UI text: AGI, ASI, singularity, alignment (except as a quality tier if D insists), doom, takeover, sentient, conscious, Skynet, slop, hype, vibes, stonks, foom, GPU-poor, disruptive, synergy, nexus, quantum (non-literal), neural (non-literal), smart, intelligent, advanced.

---

## 5. Examples in the game's voice

### 5.1 Technologies (41)

Description as it would appear in the tech tooltip; citation on its own line. "Mirrors" names the Factorio element.

| # | Technology | Description | Citation | Mirrors / tag |
|---|---|---|---|---|
| 1 | Tabulation | Punched cards are counted and sorted by machine. Unlocks: Tabulator, long-handed arm. | Hollerith, 1890 | Automation |
| 2 | Stored program | Instructions are kept in the same memory as data. Unlocks: Computer. | von Neumann, 1945 | Automation 2 |
| 3 | Threshold logic | A unit fires when the weighted sum of its inputs crosses a threshold. Unlocks: decider, arithmetic unit. | McCulloch & Pitts, 1943 | Circuit network (combinators) |
| 4 | Cybernetics | Control by feedback. Any output may be wired to any input. Unlocks: red wire, green wire. | Wiener, 1948 | Circuit network (wires) |
| 5 | Information theory | A message is a number of bits; a channel has a capacity. Unlocks: tape reel, tape unit. | Shannon, 1948 | Early data storage |
| 6 | Artificial intelligence | Proposed as a two-month, ten-man study. Required by every technology below. Cost: 10 memos, 60 s each. | McCarthy, Minsky, Rochester & Shannon, 1955 | Prerequisite-only tech (minor BEND) |
| 7 | Transistor | A solid-state switch. Logic boards no longer contain tubes: half the power, no warm-up. | Bardeen, Brattain & Shockley, 1947–48 | Electronics |
| 8 | Core memory | Ferrite rings hold a bit while unpowered. Unlocks: core, memory bank. | Forrester, 1951 | Steel chest-class storage |
| 9 | Compiler | Programs written in notation are translated by the machine. Hand-crafting speed +25%. | Hopper, 1952 | Hand-craft speed (BEND, from 01) |
| 10 | Disk storage | Random access. Unlocks: drive. The first one held 5 MB and weighed a ton. | Johnson, 1956 | Data logistics |
| 11 | Perceptron | Threshold units whose weights are set by example. Learns any linearly separable rule. Unlocks: weights. | Rosenblatt, 1958; Novikoff, 1962 | First trained item |
| 12 | Integrated circuit | Many transistors on one die. Unlocks: processor. | Kilby, 1958; Noyce, 1959 | Advanced electronics |
| 13 | Time-sharing | One machine, many jobs. Unlocks: research queue. | Corbató, 1961 | Research queue (BEND: gated by tech) |
| 14 | Packet switching | Messages are cut into packets and routed around failures. Radars relay circuit signals to one another. | Baran, 1964; Davies, 1966 | 2.0 radar signal relay, gated (BEND) |
| 15 | Fiber optics | Light in glass. Unlocks: fiber. Circuit wire reach ×4. | Kao & Hockham, 1966 | Wire reach |
| 16 | Backpropagation | Error is passed backward through the layers to set every weight. Unlocks: multilayer weights. The Perceptron's limits no longer apply. | Linnainmaa, 1970; Werbos, 1974; Rumelhart, Hinton & Williams, 1986 | — |
| 17 | Expert systems | Rules written by hand, consulted by machine. Hand-crafting speed +100%. Does not apply to machines. | Feigenbaum, 1977 | Hand-craft speed (BEND) |
| 18 | Convolution | The same weights at every position of an image. Unlocks: image datasets. | Fukushima, 1980; LeCun et al., 1989 | — |
| 19 | Stochastic gradient descent | Weights are updated from a small batch at a time. Trainer speed +50%. | Robbins & Monro, 1951 | — |
| 20 | Crawling | A program follows links and copies what it finds. Unlocks: crawler, data refinery. | Koster, 1994 | Oil processing |
| 21 | Deduplication | Repeated text is removed before training. Dataset recipes use 20% fewer tokens. | Lee et al., 2021 | Productivity-type |
| 22 | Accelerators | Matrix multiplication on hardware built for rendering. Unlocks: accelerator. | Raina, Madhavan & Ng, 2009 | Processing unit |
| 23 | Dennard scaling 1–5 | Smaller transistors use less power. Processors and accelerators: −15% energy per level. No further levels exist. | Dennard et al., 1974 | Finite multi-level tech (ISO) |
| 24 | Process node (infinite) | Transistors per die double. Wafer yield +10%. Each level costs twice the last. | Moore, 1965; Rock's law | Mining productivity-type (ISO) |
| 25 | Scaling laws | Loss falls as a power law in compute, data and parameters. Training recipes: 20 tokens per parameter. Unlocks: training recipes above 1 B parameters. | Kaplan et al., 2020; Hoffmann et al., 2022 | — |
| 26 | Attention | Every token reads every other token. Unlocks: transformer checkpoint. | Bahdanau, Cho & Bengio, 2015; Vaswani et al., 2017 | — |
| 27 | Mixed precision | Weights kept in 16 bits, sums in 32. Trainer memory −50%. | Micikevicius et al., 2018 | — |
| 28 | Quantization | Fewer bits per weight. Unlocks: efficiency module (−power, −quality). | Jacob et al., 2018 | Efficiency module |
| 29 | Distillation | A small checkpoint learns from a large one's outputs. The teacher is returned. | Hinton, Vinyals & Dean, 2015 | Kovarex-shaped catalyst recipe |
| 30 | Repeated epochs | Four passes over the same data are nearly as good as fresh data. Crawler output decays more slowly. | Muennighoff et al., 2023 | Pumpjack decay |
| 31 | Synthetic rephrasing | A model rewrites junk as prose, for compute. Unlocks: junk cracking. | Maini et al., 2024 | Cracking |
| 32 | Verifiers | Train several, keep what passes. Unlocks: quality module, Verifier. | Cobbe et al., 2021; Zelikman et al., 2022 | Quality modules, recycler |
| 33 | Preference tuning | A reward model is fitted to human comparisons; the checkpoint is tuned against it. Unlocks: post-training payload. | Christiano et al., 2017; Ouyang et al., 2022 | Satellite |
| 34 | Interpretability | Checkpoint quality is shown. It was always there. | Olah et al., 2018 | Quality reveal (BEND, from 03) |
| 35 | Tool use | A checkpoint may call tools, including the ones that build. Unlocks: construction agent, agent hub. | Schick et al., 2023 | Construction robotics |
| 36 | Automated research | Researchers staff seminars. Research speed now depends on research. Unlocks: researcher. | Good, 1965 | RSI (BEND, per design-space) |
| 37 | Research productivity (infinite) | +10% per level. Each level costs twice the last. | Bloom, Jones, Van Reenen & Webb, 2020 | SA research productivity |
| 38 | Frontier training | Unlocks: frontier cluster, run shard. Progress is shown as loss. | — | Rocket silo |
| 39 | Synthetic curriculum | The model orders its own data. Trainer speed +25%. | — | Beyond the literature |
| 40 | Weight transplant | Weights move to a newer accelerator without retraining. The old accelerator is returned. | — | Beyond the literature |
| 41 | Research scheduling | Researchers choose the next technology. The queue fills itself. | — | Beyond the literature (BEND, presentation) |

Notes. #6 is the only technology with no effect besides gating; its cost encodes the proposal. #16's three citations are a credit dispute shown as a bibliography. #19 cites 1951 under a 1980s-tier technology, which is correct. #23 is finite on purpose. #39–41 have no citation and no "future" vocabulary; they must be indistinguishable in register from #25–36, so the player cannot see where history ends until the Literature counter stops.

### 5.2 Items (35)

Stats (stack size, fuel value, "Spoils into") are shown automatically as in Factorio; the line below is the optional description.

| # | Item | Tooltip line | Mirrors |
|---|---|---|---|
| 1 | Archive | Boxes of records. Finite. | Ore |
| 2 | Low-background archive | Dated before 1945. Nothing in it was produced by a machine. | Ore variant (if contamination is chosen) |
| 3 | Token | One instance of one type. | Plate |
| 4 | Punched card | 80 columns. Do not fold, spindle or mutilate. | Early intermediate |
| 5 | Relay | Electromechanical switch. Ten milliseconds. Audible. | Gear-class intermediate |
| 6 | Vacuum tube | Amplifies. Warms the room. Replace when dark. | Early component |
| 7 | Core | Ferrite ring. Remembers while unpowered. | Intermediate |
| 8 | Logic board | Gates on fiberglass. | Electronic circuit |
| 9 | Processor | Executes stored programs. Binned by clock speed. | Advanced circuit |
| 10 | Accelerator | Multiplies matrices. | Processing unit |
| 11 | Wafer | Silicon, 300 mm, polished flat to a few atoms. | Intermediate |
| 12 | Tape reel | 2,400 feet. Sequential. | Early data carrier |
| 13 | Drive | Random access. Holds 500 tokens. | Data carrier (barrel-like) |
| 14 | Dataset | Deduplicated. Smaller than what went in. | Curated intermediate |
| 15 | Label | Answer key, written by hand. | Sulfur-class |
| 16 | Weights | A trained threshold unit: potentiometers, set by motor. | First trained item |
| 17 | Checkpoint | Weights on a drive. Fine-tuning recipes return it. | Module / catalyst |
| 18 | Researcher | Staffs a seminar. Four accelerators and a checkpoint; the checkpoint is returned. | Lab-speed item (from 03) |
| 19 | Rack | 19 inches wide, 42 U high. | Steel-class |
| 20 | Fiber | Light in glass. | Cable-class |
| 21 | Run shard | One training step of a hundred. | Rocket part |
| 22 | Post-training payload | Preference data and a reward model. Without it a run returns a base model and no system card. | Satellite |
| 23 | Construction agent | Builds ghosts within range of a hub. | Construction robot |
| 24 | Logistic agent | Moves items between hub chests. | Logistic robot |
| 25 | Memo | Typed, carbon-copied, filed. | Red pack |
| 26 | Report | Numbered, bound, mailed on request. | Green pack |
| 27 | Proceedings | Presented once, then printed. | Black pack |
| 28 | Article | Refereed. | Blue pack |
| 29 | Preprint | Posted. Not reviewed. Cited. | Purple pack |
| 30 | Model card | States what the model was tested on. | Yellow pack |
| 31 | System card | Returned by a frontier run. Not written by anyone. | White pack |
| 32 | Crawl | Raw. Mostly junk. | Crude oil |
| 33 | Junk | Not nothing. Can be rephrased. | Petroleum-class fraction |
| 34 | Synthetic prose | Written by a model. Cheaper than prose. | Plastic-class |
| 35 | Result / Baseline | Result: State of the art. (Spoils into: Baseline.) Baseline: Was state of the art. | Spoilable pair (if spoilage is chosen) |

No item tooltip cites anything; citations belong to technologies. No item tooltip mentions AI, intelligence or the player.

### 5.3 Buildings (16)

| # | Building | Description | Mirrors |
|---|---|---|---|
| 1 | Keypunch | Transcribes archives into tokens, one card at a time. Burns fuel. | Stone furnace (for archives) |
| 2 | Tokenizer | Transcribes archives into tokens. 180 kW. | Electric furnace |
| 3 | Tabulator | Programmed by plugboard. Crafting speed 0.5. No module slots. | Assembling machine 1 |
| 4 | Computer | Crafting speed 0.75. Two module slots. The word formerly referred to a person. | Assembling machine 2 |
| 5 | Cluster | Crafting speed 1.25. Four module slots. | Assembling machine 3 |
| 6 | Seminar | Consumes papers. Two module slots. | Lab |
| 7 | Crawler | Pumps crawl from an uplink. Output decays to 20% and stays there. | Pumpjack |
| 8 | Data refinery | Separates crawl into prose, code and junk. Mostly junk. | Oil refinery |
| 9 | Trainer | Datasets and fractions in, checkpoints out. Accelerators go in the module slots. | Chemical plant |
| 10 | Switch | Lends its accelerators to every machine in range. Each additional switch counts for less. | Beacon (2.0 falloff) |
| 11 | Verifier | Rejects what fails. Returns a quarter of a rejected item's ingredients. | Recycler |
| 12 | Data lake | Stores 25,000 units of one fluid. | Storage tank |
| 13 | Agent hub | Houses and charges agents. Logistic range 50, construction range 110. | Roboport |
| 14 | Frontier cluster | 9×9. Takes 100 run shards and a payload. Progress is shown as loss. | Rocket silo |
| 15 | Memory bank | 48 slots. | Steel chest |
| 16 | Cooling tower | Absorbs heat in its chunk. Consumes water and power. | Pollution absorber (if heat is chosen) |

The Data lake's name is the joke; the description refuses to join in. The Computer's second sentence is the one building description in the game with a second sentence that is not a number.

### 5.4 Achievements (20)

Names follow Factorio's convention (an idiom or a quotation); conditions are flat.

| # | Name | Condition | Why the name is right / mirrors |
|---|---|---|---|
| 1 | The bitter lesson | Complete a frontier run while hand-crafting no more than 111 items. | Sutton, 2019; mirrors Lazy bastard |
| 2 | The Turk | Transcribe 1,000 archives by hand. | Von Kempelen's automaton had a person inside; the player is the person |
| 3 | Not linearly separable | Compute XOR on the circuit network. | Minsky & Papert, 1969; needs two layers of deciders |
| 4 | Stigler's law | Research Backpropagation. | Three citations; see §4.4 |
| 5 | Station wagon | Drive a car holding 80 stacks of drives for 1,000 tiles. | Tanenbaum; the car has 80 slots |
| 6 | Sneakernet | A train carrying drives plans a path longer than 1,000 tiles. | Mirrors Trans-Factorio express |
| 7 | Data wall | Completely deplete an archive. | Villalobos et al.; mirrors Mining with determination |
| 8 | Tape-out | Craft an accelerator. | The chip-design milestone of the same name |
| 9 | Headcount | Have 100 construction agents. | Mirrors Minions |
| 10 | Universal constructor | Construction agents place an agent hub from a blueprint. | von Neumann, 1966; mirrors You are doing it right |
| 11 | Jevons paradox | Total power consumption rose in the hour after you installed your 100th efficiency module. | Jevons, 1865; measured, not asserted |
| 12 | Hofstadter's law | A research estimate was wrong by a factor of ten. | The game measures its own ETA |
| 13 | It converged | Complete a frontier run. | Mirrors Smoke me a kipper |
| 14 | The last invention | Research Automated research. | Good, 1965 |
| 15 | Hard takeoff | Finish the technology tree within 10 minutes of researching Automated research. | Both sides get an achievement |
| 16 | Slow takeoff | Take more than two hours to finish the technology tree after researching Automated research. | Both sides get an achievement |
| 17 | No related work | Research a technology that has no citation. | The Literature counter stops |
| 18 | Eternity in six hours | Finish the game within six hours. | Armstrong & Sandberg, 2013; mirrors There is no spoon |
| 19 | Low-background | Train a checkpoint from pre-1945 archives only. | If contamination is chosen |
| 20 | Scooped | 100 results spoiled into baselines. | If spoilage is chosen |

### 5.5 Victory, ending and end-state texts (12)

**1. The run report** (BEND, presentation; replaces Factorio's finish screen). Shown when the first frontier run completes after the loop has closed, in the typography of the production-statistics screen:

```
RUN COMPLETE
Loop closed                    31:14:06
Takeoff                         1:47:12
Overhang at closure             4,120 accelerators
Peak research rate              212 technologies per hour
Most-produced item              Copper cable        18,204,311
Objective, inferred             maximize Copper cable
                                                   [Continue]
```

The last line reads the item with the highest cumulative production. It is unconditional: a reading of the statistics, not a verdict on the payload's quality. Conditioning it on alignment would make it a lecture (§6, item 5). "Objective, inferred" is the entire moral content of the game.

**2. Credits as references** (BEND, presentation). The credits roll is the reference list of every cited technology, in the order the player researched them. After the last citation the remaining technologies scroll by name only. Then the people who made the game. Nothing explains the transition.

**3. The Literature counter at the end.** Research-screen header after the tree is finished: `Research complete. Literature: 2026. Technologies beyond the literature: 187.`

**4. No action required.** The status line when there are no alerts, no unpowered machines, no pending ghosts, and the queue is being filled by researchers. It replaces an empty alert bar. The phrase from every automated email, now literal, and the last thing the game says to the player.

**5. Queued by.** Research-queue entries carry a byline: `Queued by: you` for the player's, `Queued by: Researcher` after Research scheduling. No other change.

**6. First run complete** (replaces the rocket-launch screen). The loss curve, then: `Run complete. Loss 3.41 → 1.92. Returned: 1 system card.`

**7. Takeoff readout.** In the corner of the research graph: `Doubling time 40:00 → 20:00 → 5:00 → 1:10 → 0:12`. The procedural music's tempo follows it. Nobody comments.

**8. Race mode, if enabled, when the rival finishes first.** `A frontier run completed elsewhere at 29:40:11. Yours was at 61%.` Then the same report as #1, with "Objective, inferred" included. No "Game over".

**9. Save-file description.** `Last action by you: 7:12:40 ago. Entities placed since: 18,204 by agents, 0 by you.`

**10. Death.** Factorio's, unchanged. The player respawns.

**11. Expansion hook, when the Seed lands.** `Landed. Blueprint library: 1 entry.`

**12. Production-statistics label.** The research line in the stats screen reads `Papers per minute`. This is the one permitted joke in the statistics screens (per 05) and it is a noun phrase.

### 5.6 Loading-screen tips (18)

Factorio's base game has no loading tips (BEND, trivial). Each is one or two true sentences; the second, when present, ties the fact to a mechanic. Conditional ones are marked.

1. The 1955 proposal that named artificial intelligence budgeted two months and ten men. The technology costs ten memos.
2. On 9 September 1947 a moth was removed from relay 70 of the Harvard Mark II and taped into the logbook.
3. ENIAC held about 18,000 vacuum tubes and drew 150 kW. One steam engine produces 900 kW.
4. "Computer" was a profession. The first six ENIAC programmers were hired from it.
5. Never underestimate the bandwidth of a station wagon full of tapes hurtling down the highway. — Tanenbaum, *Computer Networks*. A car has 80 slots.
6. Deduplicated data trains better than more data (Lee et al., 2021). A dataset is smaller than the tokens that made it.
7. Four passes over the same data are nearly as good as fresh data; the fifth is not (Muennighoff et al., 2023). Crawler output decays on that schedule.
8. Erasing one bit releases at least kT ln 2 of heat (Landauer, 1961). No module reduces this. *(heat)*
9. Efficiency modules cut consumption per machine. Jevons (1865) observed that this is not the same as cutting consumption.
10. Dies cut from the same wafer are sold at different speeds. Quality is binning.
11. Stigler's law of eponymy: no scientific discovery is named after its original discoverer. Stigler attributed it to Merton.
12. A frontier run's progress bar is its loss curve. Neither is linear.
13. Each level of an infinite technology costs twice the last. Bloom et al. (2020) found that holding growth constant takes ever more researchers.
14. A model trained on its own output forgets the tails (Shumailov et al., 2024). Archives downwind of trainers degrade. *(contamination)*
15. Two threshold units compute XOR; one cannot (Minsky & Papert, 1969). The decider is a threshold unit.
16. Blueprints are free to copy. Agents are not: each one is an accelerator you are not using for anything else.
17. Papers are consumed. Technologies are not. (Romer, 1990.)
18. Construction agents build blueprints. A blueprint may contain an agent hub.

---

## 6. Edge cases and rulings

1. **"Transformer" for the substation.** Tempting: the collision with the architecture would be a fact of the world, not a joke by the writer. Ruling: no. Factorio's building is the substation; renaming it manufactures the pun, which is displaying (P9). Collisions that exist on their own may stand; none may be built.
2. **"Assembler" for any building.** Same ruling, for the assembly-language collision.
3. **"Preprint — Not peer reviewed. Cited anyway."** The "anyway" is the writer's eyebrow. Ruling: "Posted. Not reviewed. Cited." Same facts, no eyebrow.
4. **"The 1973 Lighthill report ended most British AI funding. Funding is not modeled."** The second sentence is a wink; cut it. Then the first sentence does no work for any mechanic; cut it too (P15).
5. **"Objective: maximize Iron gear wheel. ETA: heat death."** (from 03.) "Heat death" supplies the consequence the player should supply (§1.2), and making the line conditional on the payload's quality turns the mirror into a verdict (P11). Ruling: "Objective, inferred: maximize <item>", always, with no ETA.
6. **"Student. Fuel value 8 MJ. Graduates."** People as items (P10), and the last word is a punchline (P5). No.
7. **The Turk.** As a building name: no (a current product's name, and the 1770 pun is displayed). As an achievement for hand-transcription: yes, because the player is the person inside the cabinet, which is a bend.
8. **"Daisy, Daisy."** No. Paperclips used it; any use now refers to that use.
9. **"Does not apply to machines" under Expert systems.** Allowed. It is a statement of effect scope in Factorio's own idiom ("Does not affect …"), and the Bitter Lesson is in the structure, not the sentence.
10. **Slang.** "GPU-poor", "foom", "slop", "vibes", "number go down": never in UI text (P12). "Foom" becomes Hard takeoff, which is the term.
11. **"Attention Is All You Need" as a tech name.** No: a password (P4), and the title is already a quip; quoting a quip is displaying. The tech is Attention; the title is in the citation.
12. **The pollution's name.** Noise or Heat (§4.8). "Slop" is excluded on three counts: slang, dates, winks.
13. **The "AI researcher" item.** The item is **Researcher**. The recipe says what it is.
14. **Film quotes in achievement names.** Permitted, as in Factorio, but each must describe the condition (Station wagon; The last invention), and none may be from 2001, Terminator or Portal.

---

## 7. Anti-examples (15)

| # | Text | Why it fails | Rules |
|---|---|---|---|
| 1 | Coffee — Fuel value 4 MJ. Turns into theorems. | The first joke anyone makes about mathematicians; a pun on fuel; seen on every belt ten thousand times; the joke is on a class of people. | P6, P9, P10 |
| 2 | Student — Fuel value 8 MJ. Graduates. | People as items; the last word is a punchline; cute cruelty. | P5, P10 |
| 3 | Patent gun — Fires cease-and-desist letters. | Satire with a target; corporate warfare; a pun as a mechanic. | P2, P10 |
| 4 | Hype generator — Produces buzzwords. Attracts investors. | On the nose; "hype" and "buzzword" are discourse words; money as a mechanic. | P11, P13 |
| 5 | Paperclip — Just in case. / Clippy — "It looks like you're building a factory." | Borrowed mascots; copies Paperclips' reference instead of its method; brand. | P6, P9 |
| 6 | "Oh, another assembler. How original." (narrator) | A speaker; snark without motive; Portal's shadow. | P7 |
| 7 | Alignment: 43%. Humanity's fate hangs in the balance. | A meter with a sermon attached; discourse vocabulary; takes a side. | P11, P13 |
| 8 | WARNING: your model has become self-aware! | Skynet; exclamation mark; a threat model no serious party holds. | P3, P11, P14 |
| 9 | Choose your faction: Doomers or Accelerationists. | Strawmen of live positions; the game picks a fight. | P10, P11 |
| 10 | Stochastic parrot — A bird. Decorative. Repeats tokens. | A term from a live dispute used as a wink; takes a side by joke. | P9, P11 |
| 11 | Attention Is All You Need (and 8 GPUs) | A quip stapled to a real title ruins the accuracy that was the point. | P3, P4 |
| 12 | This is a reference to Vaswani et al. (2017)! | Explains the joke; exclamation mark. | P4, P14 |
| 13 | You did it. But at what cost? The thing you built now runs the world. Was it worth it? | Judges the player for what the game required; questions as rhetoric; the voice breaks at the end. | P1, P2, P11 |
| 14 | Synergy Nexus Mk. IV — Advanced quantum neural hypercluster. | Adjectives with no referent; nothing real under the name; fake-futuristic. | P3, P8 |
| 15 | Did you know? AI might be the most important technology in human history! | "Did you know"; the hype voice; an exclamation mark; a position. | P7, P11, P14 |

---

## 8. Checklist for any new text

1. Is the first clause functional and complete without the rest? (P4)
2. Would a Factorio tooltip say it: nouns, numbers, present tense, no adjectives of praise? (P8, P13)
3. Is every real term used in its real sense, and is every number real and checkable? (P3)
4. How often will this text be seen? More than once per session: delete the wit. (P1, P6)
5. Does it describe a benefit or a fact and leave the consequence to the player? (P2, §1.2)
6. Delete the second sentence. Did the line get worse by being less true, or only by being less funny? Keep it only in the first case. (P15)
7. Is anyone speaking? (P7)
8. Is there a famous reference? If so, what did the game do to it? If nothing, drop it. (P9)
9. Is the joke on a person, a group, a company, or a position in a live debate? (P10, P11)
10. How big is the event? Then how short is the text? (P5)
11. Exclamation marks, ellipses, "Did you know", quotes around a joke, emoji, parenthetical winks: none. (P14)
12. Will it still read the same in five years? Slang, memes, product names: none. (P12)
13. Is the name true in 1945 and at takeoff? (P12)
14. Does a mechanic already say it? Then the text says only the number. (P2)

---

## 9. Notes for integration

- **Citation convention** for E: a tech's description ends with "(Surname et al., Year)" on its own line, gray; multiple citations separated by semicolons; nothing younger than two years; no companies, products or living people except as authors. Techs beyond the literature carry no citation and no "future" words.
- **Three text mechanics** to budget for, all presentation-only BENDs: the Literature counter and the **No related work** achievement; credits as references; the run report with the inferred objective (highest cumulative production count, no exclusions, no conditions).
- **Names to adopt** unless D/E have mechanical reasons not to: Researcher (the lab-staffing item), Seminar (lab), the publication ladder for packs (§4.2), Noise or Heat for pollution, Agents (never Robots), Verifier (recycler), Switch (beacon), Data lake (storage tank).
- **Loading tips** should live in a data file with a `requires` field (heat, contamination, spoilage) so conditional tips ship only with their mechanic.
- **D6 (naming realism)**: concept names on techs, citations in tooltips. Paper titles as names are passwords, and several are already quips.
- **Quality tiers**: if renamed, Standard / Selected / Verified / Audited / Reference.
- Any proposed text from any agent can be run through §8; a line that fails two items is out.

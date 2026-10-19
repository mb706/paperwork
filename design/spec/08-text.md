# 08 — Text canon

*Round 4, R4-ui. Canon: `round1/H-tone-bible.md` (H), which this file summarises, applies and amends in a few places, each marked. Also `round1/A-mods-and-genre.md` §6 (A) and `DECISIONS.md` §1, §5, §12, §13, §34–§37 and the accuracy refinements. Round 5 (R5-apply, DECISIONS §40–§41): town names unique within 8 cells (§10.4), one precision table (§10.3), tips kept (§7), the leak tooltip (§4.7), the closure line (§4.6), *Priority* (§6), the Final report's run (§4.2), and the taste calls: the leak bar, `asserts` on achievements and *Interpretability*'s note (§2, §6, §5.2).*

**Where the strings live.** This file holds the rules, the budgets, the reasons and the strings of the UI itself (readouts, statuses, alerts, log lines, the charter, the run report). Every other player-visible string lives in the data, once:
- names, descriptions, Handbook notes, technology definitions, technology notes and citations: `spec/data/*.yaml` (R4-data);
- effect lines: `meta.effects.<type>.line` (§5.4);
- loading tips, tips and tricks, milestones, achievements, town names and the strings of generated world objects: `spec/data/text.yaml` (R4-ui).

---

## 0. The voice

**The game speaks like a well-kept logbook.** Nouns, numbers, present tense. No adjectives of praise, no exclamation marks, no speaker. It records what things are and what they do, and it cites its sources. It never reacts. Everything funny about it is true. (H, opening paragraph; read H §1 for why Universal Paperclips works and H §5 for 140 examples.)

The game's text is about one percent of its surface. Placement does the work: wit goes where text is read once, facts where it is read at rest, and nothing where it is read ten thousand times.

---

## 1. Principles

### 1.1 H's fifteen, in one line each

| | Principle |
|---|---|
| P1 | Ration text by exposure: straight where seen constantly, facts where read at rest, wit only where read once |
| P2 | The mechanics write the joke; the text reads the meter. If a joke can be a ratio, cost, recipe or counter, it must be |
| P3 | Accuracy is the humour: real terms in their real sense, real numbers, earliest correct citation, nothing younger than two years |
| P4 | Two layers, never a password: a complete functional first layer; an expert's second layer that is never required |
| P5 | Big event, small text |
| P6 | Each joke once; one callback per game, and only after the mechanics inverted its meaning |
| P7 | Nobody is speaking: no narrator, no advisor, no "you" outside achievements, tips and statistics categories |
| P8 | Nouns, not adjectives; tiers numbered or era-named |
| P9 | Famous references are bent or dropped |
| P10 | The joke is on structure, never on people, groups, companies or positions |
| P11 | No side in a live dispute; discourse vocabulary never appears |
| P12 | Era-true names that stay true from 1945 to takeoff; no slang, memes or product names |
| P13 | Operations register: monitor, audit, verify, rollback, queue, batch, run |
| P14 | Punctuation of a manual: no exclamation marks, ellipses, quotation marks around jokes, "Did you know", emoji, winks |
| P15 | When in doubt, delete |

**The five tests** (H §3): five-second, stranger, expert, belt, deletion. A line that fails two items of the checklist (§12) is out.

**P7's two standing exceptions.** "Queued by: you" (§4.6) and "Last action by you" (§8.5) are statistics categories: the byline of an action, not an address. Every other "you" or "your" outside achievements and tips is a defect.

### 1.2 Three additions from integration

| | Principle | Source |
|---|---|---|
| **P16 Named-concept accuracy** | The mechanism must satisfy the name. A technology, building, achievement or tip that uses a real concept must behave as the concept does, and the condition must be the thing the name names. Accurate nouns over an inaccurate mechanism is the failure this game is most exposed to, because its player checks | A §6 rule 4 |
| **P17 Numbers are bound to data** | Every number in text that the data also holds is a template placeholder (`{staffing.radius}`), never a literal. A number written in words ("twice", "a third") carries an assertion the build evaluates. A build test fails when text disagrees with the data. Balancing must never leave a false sentence behind. **One exemption** (DECISIONS §41): an achievement's displayed condition may restate its own `condition`'s numbers, which the validator checks against it (§6) | Integration |
| **P18 Sourced before use** | A historical claim enters the game only after it is checked against its source; claims not yet checked are listed in §13 and stay out of text | Coordinator; A §2, §3.1 |

---

## 2. Paperclips rules, reconciled (A §6)

| A's rule | H's principle | Applied here |
|---|---|---|
| 1. Regime changes are priced line items | P5, P2 | Loop closure and takeoff are technologies with one-clause definitions; the doubling-time readout is the only narration of takeoff |
| 2. The cost table carries the satire | P2 | *Artificial intelligence* costs ten Memos at 60 s each (the 1955 proposal's ten men), *Dennard scaling* stops at 5, *Research productivity* and *Process node* double in cost (Bloom et al.; Rock's law, which no text names); the experiment line makes publication bias a recipe (A §1.1) |
| 3. Exact noun, terse gloss | P3, P4 | Concept names; a definition clause of at most ten words |
| 4. The mechanism must satisfy the name | **P16 (new)** | Validator checks (§12) and the rulings in §6, §7 and §14 |
| 5. Counters are the narrative | H §1.7 | Literature, Field, years ahead, doubling-time history, milestone log, save description, run report |
| 6. Capability and cost in one formula, no meter | P11 | The leak accumulator shows a number and its terms; hollow work shows as a yield; nothing is a "safety" meter. The Leak's bar to 1.00 stays (DECISIONS §41): it is a mechanical counter toward a threshold in the evolution factor's slot, not a morality meter |
| 7. Exact integers in final displays | P5 | The run report prints exact integers (§4) |
| 8. One change of register | H §1.1 | Text never changes register. One unique audio cue for one event (the loop closing) belongs to the audio spec |
| 9. Trust the inference | H §1.2 | Benefits, never consequences |
| 10. Make the cynical move optimal, unstated | P2, P11 | Skipping verification is cheap until hollow work and leaks bite; delaying the launch shortens takeoff (04 §7); deployments close the exchanges they draw on (03 §2.3). None of it is stated |
| 11. Deterministic rules, authored text | — | No generated text at runtime. Procedural names come from closed, reviewed word lists (§10.4) |

### 2.1 Corrections to H

- **H §1.4 overstates Strategic Modeling's accuracy.** Paperclips names TIT FOR TAT and MINIMAX correctly, but each payoff cell is `Math.ceil(Math.random()*10)`, so most tournaments are not Prisoner's Dilemmas (A; confirmed against the game's `main.js` by the round-3 accuracy audit). The nouns are exact and the game under them is not: that is P16's failure, not its model.
- **H §1.1's "the only editorial mark in the whole game is that ellipsis, used twice"** misses the ellipses under the Hadwiger and Tóth projects (A). P14's ban stands regardless.

---

## 3. The charter

Shown once at the start of every new game (`07-ui.md` §14).

```
FEDERAL CHARTER
Research Site · 1945

1. A research Site is established on the land shown in the attached survey.
2. Purpose. To determine whether the work of this Site can be done by a machine.
3. The Site is funded without condition.
4. Towns are not part of the Site. The Site may draw its staff from any university within commuting distance.

[Back]                                                      [Begin]
```

**Why each line survives the deletion test.**

| Line | Function |
|---|---|
| Header, 1945 | The only date in the world (B L15) |
| §1 | The map the player just previewed is the Site; "the attached survey" is that preview |
| §2 | The operative sentence, verbatim from DECISIONS §1. "The work of this Site" is research, which includes building the machine; the recursion is left to the reader |
| §3 | Why there is no money (B §4.1), stated as a term of the grant |
| §4 | Two rules the player needs in the first ten minutes: towns cannot be built on, and staff come from universities in range (B L3, L9) |

**Cut, and why:** a reporting clause ("The Site reports by memorandum") tied to the first paper; it passed the stranger test and failed the deletion test. An issuing authority with names: no real institutions, no people.

**The callback.** At victory the run report repeats §2 verbatim and adds one word, **Determined.** (DECISIONS §1). The sentence opened the game as a question and closes it as a settled one; the mechanics changed its meaning, which is the one condition under which P6 allows a callback. This is the game's only callback; no other text may use one. The same stamp also appears on the archived charter sheet (`07-ui.md` §14): one stamp, filed twice, not a second callback.

### 3.1 Title and tagline

**Title:** *Paperwork*. **Tagline:** *Information is physical.*
- **Where they appear:** only on the main menu (`07-ui.md` §18) and as the browser tab's title (the title alone).
- **Never explained in the game.**
  - The title is true on first contact: the science packs are papers (Memo → System card), and the factory mass-produces them.
  - The tagline is the game's founding law (B's ontology, 00 §3). That is what makes the title literal: papers are things on belts.
- **Source.** The tagline quotes the title of Landauer, R. (1991). Information is physical. *Physics Today*, 44(5), 23–29. It is listed in the credits' References like a cited technology, and nowhere else.

---

## 4. Endings, readouts and the run report

### 4.1 Run report (victory)

Shown when a frontier run carrying the Final report completes (04 §8; `07-ui.md` §13.3). Typography of the production-statistics window. Every measurement (sampling, windows, the moment of each snapshot, ties) is defined in 04 §8–§9; this table owns the labels and formats.

| Row | Definition (04 §8) | Format | Example |
|---|---|---|---|
| (purpose) | Charter §2, verbatim | Sentence | To determine whether the work of this Site can be done by a machine. |
| (stamp) | — | One word | Determined. |
| Game time | Game time at this run's completion | `H:MM:SS` | 14:15:40 |
| Loop closed | Game time of closure: the first System card written by a Research hall (DECISIONS §16). Not the first frontier run | `H:MM:SS` | 13:20:02 |
| Takeoff | Loop closed → *Model generation 25* researched | `H:MM:SS` | 0:49:02 |
| Overhang at closure | Accelerators existing at closure: loaded in Research halls, inside Researchers, and in every inventory; not those built into other items | Integer + "accelerators" | 3,000 accelerators |
| Peak research rate | Technologies completed in the best 10-minute window, × 6; every level of a finite multi-level technology counts; infinite technologies do not (R5-gate D12a) | Integer + "technologies per hour" | 144 technologies per hour |
| Fastest doubling | Smallest doubling time after closure, taken at new maxima of the research rate (04 §9; R5-gate D11) | Duration format | 0.70 s |
| Peak power | Highest one-minute mean of the electricity produced on the surface | Integer + "MW" | 2,843 MW |
| Hand-crafted items | Every item the character crafted, intermediates included | Integer | 4,812 |
| Most-produced item | The real item with the highest cumulative production (Items tab, All); not the Papers pseudo-item, not fluids. Ties: the higher exact count, then data order | Icon, name, integer | Copper cable 18,204,311 |
| Objective, inferred | "maximize " + that item's name | Lowercase verb | maximize Copper cable |

**Rules.** Exact integers with thousands separators, no k or M (A rule 7). No adjectives. No row is conditional on how the run went: *Objective, inferred* is unconditional, a reading of the statistics and never a verdict on the payload's quality (H §5.5, §6 item 5). "Objective, inferred" is the entire moral content of the game. Rows with no value show "—". No second reading of the objective is added (coherence C6 offered "Most-produced item since closure"): one row carries it, and H P5 keeps the report short.

**Previous runs** (A §5.2): three labels only, *Takeoff*, *Hand-crafted*, *Peak power*, under the heading "Previous runs on this browser". No ranking words.

### 4.2 Frontier runs

The first run that returns System cards triggers *In-context learning*; it is **not** closure (DECISIONS §16). Panel and log line:

```
Run complete. Loss 3.41 → 1.92.
Returned: 1,000 System cards, 1 Frontier checkpoint.
```

- The loss values are the run's displayed curve (`07-ui.md` §13.1).
- The returned line lists exactly what the data returns: 1,000 System cards, 1,500 after *Chain of thought*, and one frontier checkpoint per run (04 §2.1). Item names are the data's.
- **An empty run** (no payload; 04 §2.1) writes only `Run complete. Loss {a} → {b}.` and `Returned: 1 Frontier checkpoint.` to the log. Weights and nothing else: a base model, and the text says only what came back.
- Later runs that return cards write only the first line to the log.
- **The Final report's run** writes `Run complete. Loss 1.92 → 1.66.`: its curve starts where the others end (`07-ui.md` §13.1; R5-gate D12h). The run report follows.

*Amended from H §5.5 #6, which read "Returned: 1 system card"; the data returns 1,000 per run, and every run also returns a frontier checkpoint (04).*

### 4.3 Race mode result

```
A frontier run completed elsewhere at 29:40:11. The Site's run was at 61%.
```

The percentage is the run progress, on its loss-curve bar, of the Site's most advanced Frontier cluster, 0% if none is running (03 §6). Followed by the run report, "Determined." included: the charter's question was answered, by someone. If the Site's own Final-report run completes later, the run report shows again without this line (R5-gate D12c). *Amended from H's "Yours was at 61%": P7 allows "you" in achievements, tips and statistics categories, not in a report's sentences.*

### 4.4 Credits as references (H §5.5 #2)

- After a run: a heading **References**, then the long citation (§9.2) of every researched `cited` technology in the order this run researched them; then the run's other researched technologies (infrastructure and beyond the literature) by name only, with no heading and no explanation; then the heading **Made by** and the people who made the game.
- From the main menu: the same in tree order.

### 4.5 "No action required"

The grey status line in the alert area once nothing needs the player and Researchers fill the queue (`07-ui.md` §13.6). The phrase of every automated notice, now literal, and the last thing the game says.

### 4.6 Research readouts

| String | Where | Example |
|---|---|---|
| `Literature {year} · Field {year} · {gap}` | Technology screen header; research tooltip | Literature 1955 · Field 1951 · 4 years ahead |
| `{n} years ahead` / `{n} years behind` / `1 year ahead` / `1 year behind` / `Level` | Gap = the Site's year − the field's (01 §12.1); its tooltip: `The Site's newest technology, against the field.` | 7 years behind |
| `Staff-limited ({p}%)` | Research tooltip while staffing limits the current research (01 §8.7) | Staff-limited (74%) |
| `Literature —` | Before any cited technology | Literature — · Field 1945 |
| `Doubling time {d} · {history}` | After closure (the first Research-hall System card) | Doubling time 1:10 · 40:00 → 20:00 → 5:00 → 1:10 |
| `Research complete. Literature {year}. Technologies beyond the literature: {n}.` | End state; {n} counts researched `beyond` levels (each *Model generation* level once), so 0 in the slice and 29 when the tree is complete | Research complete. Literature 2024. Technologies beyond the literature: 29. |
| `Papers per minute: {n}` | Research tooltip (H §5.5 #12, the one permitted noun-phrase joke in the statistics) | Papers per minute: 16 |
| `Queued by: you` / `Queued by: Researcher` | Queue entry tooltip (P7's exception) | — |
| `Available once the loop closes: the first System card written by a Research hall.` | The card and detail panel of a technology that requires the hidden *Loop closed*, and *Start research*'s refusal, until closure (`07-ui.md` §5.2; R5-gate D9). *Loop closed* itself never appears: no card, toast or `Research completed` line | — |

- **Literature** is the latest citation year among researched `regime: cited` technologies, trigger technologies included; `beyond` and `infrastructure` technologies never count (01 §12.1, DECISIONS §35). *Amended from H §5.5 #3, which printed "Literature: 2026": the two-year rule stops the counter at the build year minus two (2024 as of this writing), so the number is computed, never written.*
- Percentages in readouts round half up; the simulation keeps the exact value (`07-ui.md` §0).

### 4.7 World readouts

| String | Example |
|---|---|
| Strip | `Field 2000 · Junk 40% · Synthetic 31%` / `Leak 0.37` (shares by `07-ui.md` §0's precision table: one decimal below 10%) |
| Field tooltip | `Field 2000.6. The field's own work: 17.0 years. The Site's papers: 38.6 years.` |
| Junk share tooltip | `Share of new human writing that is junk. Set by the field's era.` |
| Synthetic share tooltip | `Share of new writing that is generated. Endpoints add to it. It never falls.` |
| Leak tooltip | `At 1.00 the deployment with the largest share is compromised. Largest share: {building} at ({x}, {y}), tier {t}, {quality}. Rate {r} per hour from {n} deployments. Verification {o} of 4.` {t} and {quality} are the named building's own, {quality} "?" before *Interpretability* (R5-gate D8) |
| Campus tooltip | `{university}. Staff {staff} ({base} × {factor}). Network: {u} universities, {s} working Seminars.` {s} counts only working Seminars that draw staff from the towns; a Researcher-staffed Seminar is never counted, so a network staffed entirely by Researchers reads `0 working Seminars` (07 §7.1) |
| Seminar staffing line | `Staff {p}% · {university}: {supply} supply, {demand} demand` or `Staff 100% · Researcher` |
| Seminar staff demand (when modules or Switches change it) | `Staff demand {d}` |
| Ground tile, last line | `Ambient {ambient} °C · Sunlight {sun}%`, plus `Chunk {chunk} °C` when Heat is on |
| Trainer, synthetic text (before *Synthetic detection*, while its recipe trains on text) | `Synthetic share {synthetic}% × crawl share {crawl}%: speed −{slowdown}%` |
| Crawler, after *Synthetic detection* | `Synthetic text discarded: {synthetic}%` |
| Race mode, after the Field entry | `2035 in {h:mm:ss}` (the field's projected time to its run); tooltip `The field's run completes when it reaches 2035.` |
| *Wild*, after the first nest | `Runaway evolution {e}%` |
| Deploying building info box | `Leak share {share}` |

Placeholders are named in words; the symbols W, j, σ, L and O are never displayed (§10.1). *Verification* counts the four verifier-line technologies (03 §3.1; DECISIONS, accuracy refinements); the word "Oversight" is not used for it.

---

## 5. Inventory of text surfaces and budgets

### 5.1 Every surface

| # | Surface | Seen | Register | Budget | Wit allowed | Source of strings |
|---|---|---|---|---|---|---|
| 1 | Item, fluid, entity, recipe names | Constantly | Physical noun | ≤ 24 characters, sentence case | None | Data `name` |
| 2 | Item and entity descriptions | Often | Fact | One line ≤ 60 characters; only where it adds a fact the tooltip does not show: about one item or entity in five (DECISIONS §34). Never a stat, a recipe or the name restated | Rarely, as a true fact | Data `desc` |
| 3 | Handbook notes | At rest | Definition | ≤ 2 sentences, only where a rule or definition must be stated | None | Data `handbook_note` |
| 4 | Stat labels and units | Constantly | Label | Fixed vocabulary (§10) | None | UI |
| 5 | Entity statuses | Constantly | Operational | ≤ 28 characters, Factorio's vocabulary plus §8.2 | None | UI |
| 6 | Flying text | Constantly | Operational | ≤ 28 characters | None | UI |
| 7 | Alerts | Often | Operational | ≤ 60 characters, in the form `{n} {things} are {state}.` | None | §8.1 |
| 8 | Toasts | Often | Operational | ≤ 40 characters | None | §8.3 |
| 9 | Message-log and milestone lines | Often | Log | ≤ 64 characters after the time stamp; a longer record is two lines | None | §8.4; milestones in `text.yaml` |
| 10 | Technology names | At rest | Concept | ≤ 28 characters | Erudite allowed, quips never | Data |
| 11 | Technology definitions | At rest | Logbook | One clause ≤ 10 words, only where it says something the name and the citation do not: about one technology in three. None for an infrastructure technology named after what it unlocks (*Lamp*, *Steel processing*), or for the later levels of a series. Never a restatement of unlocks or effects (DECISIONS §34) | Yes, via accuracy | Data `desc` |
| 12 | Effect lines | At rest | Generated | One per effect, from its template (§5.4) | None | Data `meta.effects` |
| 13 | Technology notes | At rest | Logbook | One sentence after the effect lines, only for a scope note (*Expert systems*: "Does not apply to machines.") | Yes, via accuracy | Data `note` |
| 14 | Citations, short and long | At rest | Bibliographic | Generated from data (§9) | The accuracy is the reward | Data `citation` |
| 15 | Research and world readouts | Often | Counters | §4.6, §4.7 | None | UI |
| 16 | Loading tips | At rest, once each | Fact | 1–2 sentences, ≤ 200 characters; the second ties the fact to a mechanic | Through facts only | `text.yaml` (§7) |
| 17 | Tips and tricks | At rest | Manual | ≤ 120 words per entry plus its image or animation | None | `text.yaml` (§5.3) |
| 18 | Achievements | Once | Idiom or quotation, flat condition | Name ≤ 30 characters, condition ≤ 100 | The main wit surface | `text.yaml` (§6) |
| 19 | Charter | Once per game | Statute | ≤ 80 words | None displayed | §3 |
| 20 | First-run panel, race line | Once | Report | One or two lines | None | §4.2, §4.3 |
| 21 | Run report | Once per run | Statistics | Labels ≤ 22 characters; one purpose line, one stamp | Structural only | §4.1 |
| 22 | Credits | Once | Bibliography | Generated | Structural | §4.4 |
| 23 | Main menu, settings, map-settings labels and descriptions | Often | Label | Factorio's labels; descriptions one sentence | None | UI |
| 24 | Control names | Rarely | Label | Factorio's, renamed per §10 | None | UI |
| 25 | Save names and descriptions | At rest | Log | Default name = the starting town; description §8.5 | The §8.5 line only | UI |
| 26 | Console help and outputs | Rarely | Operational | One line per command | None | §8.6 |
| 27 | Town, university, library names | Constantly (map labels) | Proper noun | §10.4 generator | None; blocklist | `text.yaml` |
| 28 | Item groups and subgroups | Often | Label | ≤ 20 characters | None | Data |
| 29 | Bonuses window | At rest | Generated | From the effect templates ("Research per paper ×1,024") | None | UI |
| 30 | Browser notices and errors | Rarely | Operational | ≤ 2 sentences, the second states the fix | None | UI |
| 31 | Changelog | Rarely | Log | Same register | None | Build |

**Volume, for planning** (the data as of round 4): about 350 names (items, entities, recipes, technologies); about 60 item and entity descriptions (39 of 230 items, 23 of 104 entities); 81 technology definitions; 90 cited, 149 infrastructure and 11 beyond-the-literature technologies; 30 achievements; 20 loading tips; 7 tips-and-tricks entries; 25 alerts; about 90 statuses; about 600 UI labels.

### 5.2 Lines that must survive, and where they live

DECISIONS §34 keeps the coherence critic's 34-line keep-list verbatim, with the accuracy audit's corrections applied (DECISIONS §36). A build test asserts that each line exists, verbatim, in its source.

| # | Line | Source |
|---|---|---|
| 1 | "Purpose. To determine whether the work of this Site can be done by a machine." / "Determined." | §3, §4.1 |
| 2 | "Objective, inferred — maximize Copper cable" (the item is computed) | §4.1 |
| 3 | Final report: "Due under the charter." | `items.yaml` |
| 4 | System card: "Not written by anyone." | `items.yaml` |
| 5 | Token: "One instance of one type." | `items.yaml` |
| 6 | Dataset: "Deduplicated. Smaller than what went in." | `items.yaml` |
| 7 | Trainer: "Turns datasets into weights. The crafting time is the compute." | `entities.yaml` |
| 8 | Seminar: "Consumes papers. Needs staff." | `entities.yaml` |
| 9 | Researcher: "Staffs a Seminar. Four accelerators and a frontier checkpoint; the checkpoint is returned." | `items.yaml` |
| 10 | Expert systems: "Rules written by hand, consulted by machine." + "Hand-crafting speed +100%" + "Does not apply to machines." | `technologies.yaml` (desc, effect line, note) |
| 11 | Artificial intelligence: "Proposed as a two-month, ten-man study." (10 × Memo · 60 s) | `technologies.yaml` |
| 12 | Basic research: "Research performed without thought of practical ends. (Bush, 1945)" | `technologies.yaml` |
| 13 | Semaphores: "A signal admits one occupant at a time. (Dijkstra, 1965)" | `technologies.yaml` |
| 14 | Batch processing: "Collect a full load, then move it at once." + "Unlocks: Bulk inserter." | `technologies.yaml` |
| 15 | Instruction tuning: "Models trained to follow written requests." + its unlocks (Requester chest) | `technologies.yaml` |
| 16 | Lateral inhibition: "The strongest signals suppress their neighbors." + "Unlocks: Selector unit." | `technologies.yaml` |
| 17 | Fence: "Stops bodies, not signals." | `entities.yaml` |
| 18 | Runaway: "No body. Nothing to shoot." | `enemies.yaml` |
| 19 | Distilled controller 1–3: "Most of the teacher at a fraction of the watts." / "A smaller student of the same teacher." / "The smallest student that still passes." | `items.yaml` |
| 20 | Water: "Boils into steam. In data recipes it is the cooling." | `items.yaml` |
| 21 | Archive, once the synthetic share is above 0: "Written before any text was generated." (accuracy §2.4 replaces "Written before anyone could fake it.") | 01 §6.3; `07-ui.md` §7.1 |
| 22 | Baseline: "Was state of the art." / Significant result: "p < 0.05." | `items.yaml` |
| 23 | Landfill: "Turns water into ground. The lake's cooling goes with it." | `items.yaml` |
| 24 | Memex: "A desk that stores a person's records." + "Inventory +10 slots" | `technologies.yaml` |
| 25 | Rural electrification: "The grid reaches every outpost." | `technologies.yaml` |
| 26 | Fire control: "Predict where the target will be; aim there. (Wiener, 1949)" | `technologies.yaml` |
| 27 | Reversible logic: "Computation that erases nothing, so dissipates less." | `technologies.yaml` |
| 28 | Energy per operation: "Erasing a bit dissipates at least kT ln 2." + its floor line | `technologies.yaml` |
| 29 | Synthetic share tooltip: "Share of new writing that is generated. Endpoints add to it. It never falls." | §4.7 |
| 30 | The last invention: "Install a Researcher before any machine has been compromised." | `text.yaml` |
| 31 | "Research complete. Literature 2024. Technologies beyond the literature: {n}." (the year is computed) | §4.6 |
| 32 | Loading tip: "Papers are consumed. Technologies are not (Romer, 1990)." | `text.yaml` |
| 33 | First run: "Run complete. Loss 3.41 → 1.92." | §4.2 |
| 34 | Race: "A frontier run completed elsewhere at 29:40:11. The Site's run was at 61%." | §4.3 |

Replacements adopted from round 3 (coherence §2.3 and accuracy), in this file's surfaces:

| Where | Was | Now | Why |
|---|---|---|---|
| Seminar stat line (`07-ui.md` §6.1, §6.4) | `Hollow: 20%` | `Yield 80%` | The label read the joke; *yield* is the inspection word (coherence M6) |
| §6 *Campbell's law* | "Seminars consume 1,000 papers as hollow work." | "Researcher-staffed Seminars consume 1,000 papers that yield no research." | Same |
| §4.7 Synthetic share tooltip | "Your Endpoints add to it." | "Endpoints add to it." | P7 |
| §4.7 Field tooltip, §8.6 `/world` | "From your papers", "your papers" | "The Site's papers" | P7 |
| §4.6 gap tooltip | "Your newest technology, against the field." | "The Site's newest technology, against the field." | P7 |
| §4.7 Leak tooltip | "Oversight {o} of 4" | "Verification {o} of 4" | Three of the four techs are search methods, not oversight (accuracy M3) |
| §4.7 Trainer | "Quality chance −31% (synthetic share)" | "Synthetic share 31% × crawl share 58%: speed −18%" | Model collapse follows what the Site trains on (accuracy M4, DECISIONS §31); the explanation in parentheses is gone (coherence m9) |
| §8.2 compromised tooltip | "Compromised by a copy of {checkpoint}, tier {t}." | "Compromised: {checkpoint}, tier {t}." | The first compromise is the deploying building's own model, not a copy (coherence m13) |
| §4.7 Leak tooltip (round 5) | "Largest share: {building} at ({x}, {y}). Rate {r} per hour: {n} deployments, tier {t}, {quality}." | "Largest share: {building} at ({x}, {y}), tier {t}, {quality}. Rate {r} per hour from {n} deployments." | With deployments of several tiers and qualities, one tier and one quality can only be the named building's (R5-gate D8) |

**Round 5 rulings** (DECISIONS §41, R5-gate D15). *Interpretability*'s note "It was always there." stays. R5-play praised it; the UI review read it as a wink, but the line states what the mechanic does: the quality it shows existed before it was shown. The Leak's bar stays (§2 #6). An achievement's text may restate its own condition's numbers (§6).
| Laboratory salvage Handbook note | — | "Surplus from a wartime laboratory." (moved from the radar's description) | True of the crate's radar, false of every crafted one (coherence M13) |

### 5.3 Tips and tricks

Factorio's tips are functional and may address the player (H §3). The canonical entries are `text.yaml`'s `tips_and_tricks`: four ship with the slice (Heat, Staff, Records and tokens, The field), each with a still image; three more unlock with technologies, as Factorio's do (Terminals with *Time-sharing*, Containment with *Deep learning* when Runaways is not Off, Closing the loop with *Automated research*). Rules:
- At most 120 words; numbers are placeholders (P17).
- They state rules, not consequences: Containment says how a machine is cleaned, not that a base can fall.
- The Staff entry states 01 §8.3's demand rule exactly: one staff per working Seminar, more when modules or Switches make it faster; research-speed technologies cost none.

### 5.4 Effect lines

Every technology effect type has one line template, `meta.effects.<type>.line`, which the tooltip, the detail panel, the Bonuses window and 05's tables all render. Fields: `{pct}` (a signed percent, "+20%"), `{mult}` ("×1.5", the × included), `{n}` (a signed count), `{fraction}` (a percent), `{amount}` (`{pct}` for a `value`, `{mult}` for a `multiplier`), `{output}` and `{energy}` (the *hall-mode* fields, as `{pct}`), `{category}`, `{turret}`, `{recipes}`, `{entities}`, `{quality}`. Lists print as names joined by ", " with " and " before the last.
- The template is the data's; this file sets the wording rules, and changes go to R4-data.
- **Wording:** the noun the UI uses elsewhere ("Seminar speed", never "Lab speed"; "Hand-crafting speed"; "Inventory +10 slots"). No symbols (σ, Π, m). No "you". No explanation of why.
- **Computed values:** *Model generation*'s line prints the world setting's multiplier ("Research per paper ×2" at the default; ×1.63 and ×2.25 at the other presets; `multiplier_from: returns_to_research`), never a literal in the text.
- A technology's tooltip is: its definition clause (`desc`), its unlocks and effect lines (generated), its `note`, then its short citation in grey (§9.1). The `desc` never repeats an unlock or an effect.

---

## 6. Achievements

The canonical list (30 entries) is `text.yaml`'s `achievements`: name, displayed condition, a machine-readable `condition` the engine's registry evaluates (10 §5.20), the arc, the settings it requires, the Factorio achievement it mirrors, and a *Why* for reviewers. This section holds the rules and the rulings.

**Rules.**
- Names follow Factorio's convention (an idiom or a quotation); conditions are flat (H §5.4).
- **Win** means completing the frontier run that carries the Final report, when the run report appears. **Closing the loop** means the first System card written by a Research hall (DECISIONS §16).
- Every condition is the thing the name names (P16), and every condition is machine-readable: a registry type plus ids that exist in the data (the validator checks them). A condition the engine cannot evaluate from state and statistics is not an achievement.
- The *Why* is mandatory, reviewed by a person, and never shown in the game.
- An achievement whose system is off for the map (Heat off, Runaways Off, staffing off, Race or Scooped off) is not offered; `requires` says which.
- **Numbers** (DECISIONS §41; R5-gate D15). The displayed condition may restate its own `condition`'s numbers as digits ("Craft 1,000 Memos by hand."): P17's one exemption, because the condition is the data and the line restates it in the same entry. The validator checks every such digit against the condition's values. A number that belongs to other data is a placeholder, and a number in words that is not the condition's own carries an `asserts` entry, as tips do.
- **The achievements window** (`07-ui.md` §13.7, M4; R5-gate D12i) lists the achievements offered on the map with their displayed conditions; the *Why* never shows.
- Achievements are off while console cheats are used (ISO).
- 04 §9 quotes the conditions from `text.yaml`; this file and `text.yaml` are canonical (DECISIONS §20).

**Arc coverage:** six are reachable in the slice's era (*The Turk*, *Stigler's law*, *Heat island*, *Hofstadter's law*, *The endless frontier*, *Town and gown*), eight in the mid-game, sixteen from the frontier runs on.

**Condition registry** (the types `text.yaml` uses; the engine implements each; 10 §5.20):

| Type | Fires when |
|---|---|
| handcraft-count {item, at_least} | The character has crafted that many of the item, intermediates of a queued chain included |
| research {technology} / research-regime {regime} / research-all-finite | That technology, any technology of that regime, or every finite technology is researched |
| chunk-above-ambient {kelvin} | Any chunk's T − θ reaches the value |
| research-overrun {factor} | A technology completes after more than factor × the remaining-time estimate the research widget showed at its start (no estimate, no fire) |
| build-distance {entity, tiles} | The entity is built at that Euclidean distance from spawn |
| universities-staffing {at_least} | On one tick, working Seminars draw staff from that many distinct universities |
| vehicle-carry-distance {vehicle, items, stacks_at_least, tiles} | The vehicle travels that far while holding at least that many stacks of the items; the distance resets when the count falls |
| train-carry-path {items, tiles} | A train holding any of the items completes a path longer than the value |
| resource-depleted {resource} / exchange-closed {tapped} | A patch of the resource is mined out / an exchange the Site taps closes to crawlers |
| mine-count-while {resource, at_least, synthetic_share_above} | That much has been mined from the resource while the synthetic share was above the value |
| craft-while {item, trainer_slowdown_above, not_researched} | The item is crafted while synthetic text slows its Trainer by more than the value, with the technology unresearched |
| recipe-set {recipe} | A machine's recipe is set to it |
| power-rise-after-install {item, nth, window_s} | Mean electricity consumption over the window after the nth installation of the item exceeds the mean over the window before |
| installed-count {item, slot, at_least} | That many of the item sit in slots of that kind at once |
| constructor-places {entity} / agents-built-more / switch-cuts-compromised | A Constructor places a blueprint containing the entity / agents have built more entities than the character / a power switch opens on a circuit condition fed by the Compromised signal of a machine it then powers off |
| hollow-papers {at_least} / throttled-at-once {at_least} | That many papers spent on hollow work / that many computing machines throttled on one tick |
| frontier-run / install-before-compromise {item} | Any frontier run completes (an empty one included) / the item is installed while no machine has ever been compromised |
| takeoff-time {at_most_s or more_than_s} | Closure → *Model generation 25* within, or beyond, the time |
| win {handcrafted_at_most, game_time_at_most_s, race_won} | Victory with the stated statistic; `race_won`: in a race mode, with the Site's Final-report run completed before the field reached W = 90 (R5-gate D12c) |
| spoil-count {item, into, at_least} | That many of the item have spoiled into the other |

**Rejected or changed from H §5.4 (round 2):**

| H's entry | Ruling |
|---|---|
| Stigler's law on Backpropagation | Backpropagation is not named after anyone, so the law does not apply (P16). Moved to Stored program. Backpropagation's three citations stay the joke, silently |
| The Turk on hand transcription | Transcription is a furnace category (D); it cannot be done by hand. Moved to hand-crafted Memos |
| Not linearly separable (XOR) | A 2.0 decider with OR-joined conditions computes XOR alone, so the condition would not need two layers (P16). Dropped |
| Low-background on pre-1945 archives only | Checkpoints need prose from crawl (D), so the condition was impossible. Rewritten |
| Hofstadter's law "wrong by a factor of ten" | During takeoff estimates are too *long*, the opposite of the law (G §6 expected it to fire there). Restricted to underestimates |
| Tape-out on crafting an accelerator | Tape-out precedes manufacture. Moved to setting the recipe |
| The last invention on researching Automated research | Moved to installing the machine, with Good's proviso as the condition |
| Universal constructor on agents building an agent hub | Agents are crafted, not built from a description; the Constructor (04 §2.5) reads a blueprint, so a Constructor placing a Constructor is von Neumann's case exactly. Moved |

**Round 4 changes:**

| Entry | Ruling |
|---|---|
| *Headcount* | Moved from 100 construction agents to 100 Researchers in staff slots (coherence C5): in this game staff are literally counted, and with *Town and gown* it marks the two ends of the staffing arc. Factorio's *Minions* has no counterpart now |
| *Campbell's law* | "…consume 1,000 papers that yield no research" (coherence M6) |
| *The curse of recursion* | The model-collapse penalty now follows what the Site trains on (accuracy M4, DECISIONS §31): "Train a checkpoint while synthetic text slows its Trainer by more than half." The slowdown is the synthetic share of the crawled text times the crawl's share of the Site's text, so the condition is met exactly when more than half of what the Site trains on is generated text it crawled |
| *Station wagon*, *Town and gown*, *Sneakernet*, *Jevons paradox* | Conditions made exact (impl U63) |
| *Eternity in six hours* | *Why* corrected: the six hours in Armstrong & Sandberg (2013) are the Sun's output needed to start the expansion, not a duration; the condition bends the title into a clock, as Factorio's *There is no spoon* does (accuracy §2.5) |
| *Station wagon* | *Why*: the line is popularised by Tanenbaum (1988), paraphrasing earlier sources; its attribution is itself a case of Stigler's law (accuracy §2.5) |
| *Stigler's law* | *Why* records that the single-name citation is load-bearing (coherence m20; §9.1's exception) |

---

## 7. Loading tips

The canonical tips are `text.yaml`'s `tips`: one or two true sentences each, the second tying the fact to a mechanic (H §5.6), with `requires` (heat, staffing, exchanges, quality, runaways, agents) so the loading screen picks only tips that hold for the map being loaded. Numbers are placeholders, or carry an `asserts` entry when written in words (P17). The accuracy audit verified every fact the tips state (R3-accuracy §4).

**Changes from H §5.6 (round 2):**

| H's tip | Ruling |
|---|---|
| 1, the ten-man proposal and "The technology costs ten memos" | The cost is the joke; a tip that points at it spoils it (P2, P4). The proposal is already the technology's definition. Dropped |
| 2, the Mark II moth | The first anecdote every programmer knows, with no bend and no mechanic (P9). Dropped |
| 5, the station wagon | Used by an achievement (P6). Dropped |
| 7, "Crawler output decays on that schedule" | False: crawlers decay as pumpjacks do, not by epochs (P16). The fact kept, the false link removed (*muennighoff*) |
| 9, Jevons | Used by an achievement (P6). Dropped |
| 11, Stigler's law | Used by an achievement (P6). Dropped |
| 12, "Neither is linear" | A wink (P14). Rewritten around Kaplan et al. (*kaplan*) |
| 13, "Each level of an infinite technology costs twice the last" | Not every infinite technology doubles (04 §10). Narrowed to Research productivity (*bloom*) |
| 14, archives "downwind of trainers" | Under ontology D information has no place (B L1). Rewritten (*shumailov*); citation moved to the 2023 preprint (earliest correct source) |
| 15, "The decider is a threshold unit" | False for multi-condition deciders (P16). Dropped |
| 16, "each one is an accelerator" | False for the data's agents. Dropped |

**Round 4 changes:**

| Tip | Ruling |
|---|---|
| Concrete "sheds heat less than a third as fast as grass" | Dropped, with the concrete item's matching line: two wordings of one number drift (coherence m29), and the Heat entry of the tips and tricks already orders the ground types |
| *power-station* (new) | The DECISIONS §24 heat rule as a fact about real plants: a third of the fuel becomes electricity, the rest leaves at the condenser, which here is the generator's chunk |
| *staffing-demand* (new) | 01 §8.3's demand rule, which a veteran would otherwise discover by surprise |
| *field-advances* | "half a year" → `{world.beta}` field-years (P17) |
| *lee-dedup* | "keeps 45 of every 100 units" → "keeps less than half of the crawl it reads": the 45 drifts with the junk share (03 §2.1) |
| *holdout* | Unchanged; now literally true, because a Monitor consumes an evaluation set only when it cleans (07 §10.3) |

**Round 5** (R5-gate D3, DECISIONS §40). Tips with `requires: []` may name content a build does not contain yet (*bloom* names *Research productivity*, *kaplan* the frontier cluster, both shown in the slice): they are true facts, and the slice's player is a Factorio veteran. They keep `requires: []`.

---

## 8. Alerts, statuses, notices, log lines

### 8.1 Alerts (types in `07-ui.md` §22; Factorio's own alerts unchanged)

| Type | Overview row | Singular |
|---|---|---|
| Thermal throttling | `{n} machines are throttled by heat.` | `1 machine is throttled by heat.` |
| Compromised | `{n} machines are compromised.` | `1 machine is compromised.` |
| No evaluation sets | `{n} Monitors have no evaluation sets.` | `1 Monitor has no evaluation sets.` |
| Closed to crawlers | `The exchange at {town} has closed to crawlers.` | — |
| Escaped (*Wild*) | `A copy has escaped and founded a nest.` | — |
| Entity dismantled (*Wild*) | `{n} entities were dismantled.` | `1 entity was dismantled.` |
| Being dismantled (*Wild*) | `{n} entities are being dismantled.` | `1 entity is being dismantled.` |
| Field (race mode) | `The field is one year from its run.` | — |

### 8.2 Entity statuses (added to Factorio's vocabulary)

| Status | LED | Entity | Tooltip line, when there is one |
|---|---|---|---|
| No staff | red | Seminar (01 §8.5) | — |
| Understaffed: {p}% | yellow | Seminar | — |
| Working (Researcher) | green | Seminar with a Researcher | — |
| Low power | yellow (ISO) | Research hall; Seminar with a Researcher, when compute satisfaction is below 1 | `Compute is supplied last.` |
| No power | red (ISO) | The same, when compute satisfaction is 0 | `Compute is supplied last.` |
| Throttled by heat | yellow | Computing machines; a Seminar with a Researcher | `Chunk {chunk} °C · limit {limit} °C · speed {speed}%` |
| Compromised | red | Susceptible machines (03 §3.1) | `Compromised: {checkpoint}, tier {t}.` · `Next copy: {m:ss}.` · `Escapes in {m:ss}. Path out: {exchange / data line / logistic agents}.` (*Wild*) · `Air-gapped.` |
| Missing accelerators | red | Research hall | `Loaded: {n} / 20` |
| No weights | red | Research hall | — |
| No hot coolant | yellow | Dry cooler, water exchanger | — |
| Low input fluid | yellow (ISO) | Cooling tower without water | `Removing: {x} / {y} MW` |
| Watching | green | Monitor | — |
| Cleaning | green | Monitor; power switch | `Cleaning: {m:ss}` |
| No evaluation sets | red | Monitor | — |
| Closed to crawlers | red | Crawler (01 §7.5) | — |
| Working | green (ISO) | Terminal linked to a Terminal at another university (01 §8.9) | `Linked: {universities}` |
| Not linked | yellow | Terminal with no linked Terminal at a different university | — |
| No university in range | red | Terminal | — |

`{t}` is the infection's model tier; `Next copy` is the infection's shared spread timer (03 §3.3).

### 8.3 Flying text, toasts and refusals

| Event | String |
|---|---|
| Rollback | `Rolled back` (flying text) |
| A compromised machine refuses mining, deconstruction, fast-replace, upgrade or removal of its modules, Researcher, accelerators or weights (03 §3.3) | `Compromised. Cut its power.` (flying text; the error sound) |
| A full Research hall refuses an accelerator before *Weight transplant* | `Needs Weight transplant` (flying text) |
| A Research hall swaps a loaded accelerator for a higher tier | `Swapped` (flying text) |
| Research completed | `Research completed: {technology}` (toast, I §4.10) |
| Autosave | `Autosaving` while writing, `Autosaved` when done. *Never "Autosaving…": P14 bans the ellipsis* |
| Achievement | `Achievement: {name}` with the condition as the second line |

### 8.4 Message log and milestones

Every line is prefixed with the game time, `H:MM:SS`. The milestone list is `text.yaml`'s `milestones` (07 §15); each kind prints one template.

| Event | Line |
|---|---|
| Research, queued by the player | `Research completed: {technology}.` |
| Research, queued by a Researcher | `Research completed: {technology} (Researcher).` |
| Milestone, kind `produce` | `First {item}.` |
| Milestone, kind `build` | `First {building} built.` |
| Milestone, kind `research` | none of its own in the log: the research line already logs it; `/milestones` prints `Research completed: {technology}.` |
| First frontier run that returns System cards | Two lines: `Run complete. Loss {a} → {b}.` and `Returned: {n} System cards, 1 Frontier checkpoint.` |
| Empty frontier run | Two lines: `Run complete. Loss {a} → {b}.` and `Returned: 1 Frontier checkpoint.` |
| Later frontier runs | `Run complete. Loss {a} → {b}.` (the Final report's run: 1.92 → 1.66) |
| Loop closed (the first Research-hall System card) | `Loop closed.` It is also when the hidden *Loop closed* technology completes, which writes no research line of its own |
| First Researcher installed | `First Researcher installed.` |
| A tapped exchange closes to crawlers (untapped ones close silently, as for the alert) | `Exchange at {town} closed to crawlers.` |
| Archive depleted | `{archive} depleted.` (its name, §10.4: "Library of Ashford depleted.", "Birch Hill records store depleted.") |

No line comments on any other. After victory the log fills with `Research completed: Energy per operation 31 (Researcher).` and nothing else: a byline, not a joke (coherence C1).

### 8.5 Save description

Shown in the Load list when the player's last action is at least ten minutes older than the save (`07-ui.md` §19.2):

```
Last action by you: 7:12:40 ago. Entities placed since: 18,204 by agents.
```

*Amended from H §5.5 #9, which added "0 by you". Placed entities count as actions, so that count is zero by construction: removing it loses only the joke, and H's own deletion test removes it.* Otherwise the description is game time and current research.

### 8.6 Console

| Command | Output |
|---|---|
| `/world` | `Field {field:.1} (own work {own:.1}, the Site's papers {pub:.1}). Junk share {junk}%. Synthetic share {synthetic}%. Leak {leak:.2} ({n} deployments).` The shares as on the strip (`07-ui.md` §0's precision table; R5-gate D2) |
| `/milestones` | One line per milestone reached, as §8.4 |
| Help lines | `/world: Prints the field, the junk and synthetic shares and the leak.` · `/milestones: Prints the milestones reached so far.` |

---

## 9. Citations

### 9.1 Short form (technology tooltip, detail panel, tips)

- `(Surname, Year)`; two to four authors all named, `&` before the last: `(Rumelhart, Hinton & Williams, 1986)`, `(McCarthy, Minsky, Rochester & Shannon, 1955)`; five or more: `(Vaswani et al., 2017)`.
- Several citations in one line, chronological, separated by semicolons: `(Linnainmaa, 1970; Werbos, 1974; Rumelhart, Hinton & Williams, 1986)`.
- **Which year.** The version of record, except for work that its field cites by its preprint (arXiv-era machine learning: `Kaplan et al., 2020`, `Shumailov et al., 2023`). Patented inventions are cited by filing year (`Kilby, 1959; Noyce, 1959`).
- **Disputed priority:** every claimant is cited, each by the year of their own first publication (`Borel, 1921; von Neumann, 1928`). **One exception:** *Stored program* cites von Neumann alone; the omission is the subject of the *Stigler's law* achievement, and a reviser must not "fix" it.
- Name particles as the person wrote them: `von Neumann`, `Van Reenen`.
- On its own line, grey, after the effects and the note. Never in item tooltips (H §5.2).

### 9.2 Long form (technology detail panel, Handbook references, credits)

APA-style, compact. Up to ten authors listed in full; beyond ten, the first ten and "et al.".

- Article: `Shannon, C. E. (1948). A mathematical theory of communication. Bell System Technical Journal, 27(3), 379–423.`
- Unpublished or report: `McCarthy, J., Minsky, M. L., Rochester, N., & Shannon, C. E. (1955). A proposal for the Dartmouth summer research project on artificial intelligence.`
- Book: `Wiener, N. (1948). Cybernetics: Or control and communication in the animal and the machine. Technology Press; John Wiley & Sons; Hermann et Cie.` (the 1948 imprints, as the data holds them; "MIT Press" is the 1961 second edition's)
- Preprint: `Surname, I., et al. (Year). Title. arXiv:NNNN.NNNNN.`

### 9.3 Data and rules

- **Per technology** (`technologies.yaml`, DECISIONS §35): `regime: cited | infrastructure | beyond`. A cited technology carries `citation`, a list of `{authors: ["Shannon, C. E.", …], year, title, venue?, url?, kind?}`. A beyond technology carries `field_year` (a number, or an expression in L for the multi-level *Model generation*). The short form, the long form and the technology's year (the latest year among its citations) are generated.
- ***Model generation 6–25*** is `beyond` and cites nothing. The Fifth Generation project (Moto-oka, 1982) appears only in its Handbook note (`handbook_note`), which explains nothing else (DECISIONS §11, §35).
- **Validator:** every `cited` technology has at least one citation with authors, year and title; no year later than the build year minus two (H P3); no year later than its tier's era end (E §3); no corporate author; `beyond` technologies have no citation, have a `field_year`, and use no word from the future list (§10.2); `infrastructure` technologies have no citation and do not count toward *No related work*.
- **Handbook references** (`07-ui.md` §12): under the heading `References`, the unlocking technology's name, then its long citations, one per line. The **Note** above them, when present, is the entry's `handbook_note`: at most two sentences that state a rule or a definition, such as the University's staffing rule or, on the experiment recipes, `α = 0.05 is the chance of a significant result when there is no effect.` (the data's `handbook_note` on *Analysis*) (A §1.1).
- **No frames.** A citation is printed plainly: no "In our history:", no "As shown by". *(B L15 suggested "In our history: 1948"; the frame is a wink at the fiction.)*

---

## 10. Naming quick-reference

### 10.1 Systems

| Thing | System | Examples | Rules |
|---|---|---|---|
| Items | Physical nouns, true in 1945 and at takeoff; tiers follow the artifact's lineage | Token, Records, Logic board, Processor, Accelerator, Checkpoint, Drive, Rack | One name per item for the whole game; no adjectives, no "Mk."; module tiers are numbers |
| Fluids | Physical, or the data fractions | Water, Steam, Sulfuric acid, Lubricant; Crawl, Junk, Text, Prose | Data fluids keep oil's brightness order (`07-ui.md` §23) |
| Papers | The publication ladder | Memo, Report, Proceedings, Article, Preprint, Model card, System card | Factorio's colors, one silhouette |
| Buildings | Factorio's name where it is literal; an operations noun where it is new | Assembling machine 1–3, Stone furnace, Boiler; Keypunch, Seminar, Trainer, Crawler, Data refinery, Switch, Frontier cluster, Monitor, Cooling tower, Endpoint, Research hall, Terminal, **Constructor** | Tiers numbered. Never "Transformer" for the substation (H §6.1). The blueprint-placing building of 04 §2.5 is displayed as **Constructor**, not "Deployer": UI text says "deployment" for Endpoints, Research halls and Researcher Seminars, and a constructor that builds from a description is von Neumann's term. The id stays `deployer`. The unarmed armored vehicle is never "Tank" (DECISIONS §38) |
| Modules | Control electronics | Coprocessor 1–3, Learned controller 1–3, Distilled controller 1–3, Comparator 1–3 | Comparator, the quality module, is a verifier and a machine-shop gauge (00 §9 #24) |
| Combinators | Units | **Decision unit**, Arithmetic unit, Bias unit, Selector unit | The decider is a Decision unit: 2.0's deciders combine conditions with AND and OR, so no text may call one a threshold unit (DECISIONS, accuracy refinements). Description: "Outputs while its conditions hold." (level-triggered, never "when its input crosses a threshold") |
| Experiment line (A §1.1) | Research-method nouns, used in their exact sense | Significant result, Null result, Meta-analysis, *File drawer* (a chest tier) | The File drawer carries no description and no citation: the name is the whole reference (H P2). α is defined once, in the Analysis recipe's Handbook note (§9.3), never in a tooltip. Significant result's and Baseline's lines are 03 §5's ("p < 0.05." / "Was state of the art.") |
| Technologies | The concept as the field names it; the title goes in the citation | Switching circuits, Linear programming, Stored program, Attention, Mobile automata | ≤ 28 characters; titles of papers are never names (H P4) |
| Multi-level and infinite | Laws, and lines whose cost curve is the law | Dennard scaling 1–5, Process node, Research productivity, Model generation 6–25 (*Verification* is not a series: it is the readout "Verification {o} of 4", counting four separately named technologies, 03 §3.1) | Generation numbering starts at 6, the first after the Fifth Generation project (DECISIONS §11); nothing explains it |
| Quality tiers | Inspection words | Standard, Selected, Verified, Audited, Reference | — |
| Agents | Agents | Construction agent, Logistic agent, Agent hub | Never "robot" or "bot", in any label or statistic |
| Runaways (*Wild*) | F's names, numbered | Dismantler replicator, Etcher replicator, Mast 1–4, Dismantler 1–4, Etcher 1–4 | — |
| World numbers | Plain nouns | Field, Literature, Junk share, Synthetic share, Leak, Verification, Yield | Symbols (W, j, σ, L, O, h) never appear in the UI |
| Windows | Plain nouns | Handbook (Factorio's Factoriopedia), Technologies, Production statistics, Remote view, World, Charter, Run report, Milestones, Rate calculator; a university's window takes the university's name | — |
| Statistics | — | Papers (the research pseudo-item), Heat, Containment | — |
| Heat and temperature | The field is always qualified: "Chunk 38 °C", "Ambient 14 °C", the Heat overlay and tab. Nuclear heat entities keep Factorio's "Temperature: 500 °C" | — | Never "Heat" alone for a heat pipe's state |
| Saves | The starting town's name by default | Ashford | — |

### 10.2 Words

**Encouraged:** run, checkpoint, shard, verifier, monitor, audit, sandbox, rollback, queue, batch, epoch, loss, yield, bin, payload, drift, crawl, archive, token, weights, seminar, memo (H §4.10); field, literature, staff, campus, heat, leak, clean, contain, verification.

**Never in UI text:** H's list (AGI, ASI, singularity, alignment, doom, takeover, sentient, conscious, Skynet, slop, hype, vibes, stonks, foom, GPU-poor, disruptive, synergy, nexus, quantum and neural unless literal, smart, intelligent, advanced, except Factorio's own *Advanced* settings tab), plus: victory, congratulations, game over, superintelligence, rogue, misaligned, safety, risk, existential, accelerationist, decelerationist, robot, bot, deployer, oversight (the count is Verification; the technology name *Scalable oversight* is the exception), "AI" (except inside the technology name *Artificial intelligence*), "Did you know", "In our history".

**Future words** (forbidden in `beyond` technologies so their register matches the cited ones): future, next-generation, novel, revolutionary, breakthrough, someday, eventually.

### 10.3 Numbers and units

Digits, never words, for quantities, except where an assertion binds the word (P17). SI units: kW, MW, MJ, GJ; °C for temperatures and K for differences ("30 K above ambient"). Time `H:MM:SS`, `M:SS`, or `0.99 s` below a second. Factorio's smart formatting (k, M) everywhere except the run report, which prints exact integers with thousands separators. Ratios as "20 tokens per parameter". Percent with no space ("45%"); percentages round half up. **Precision** follows `07-ui.md` §0's one table (R5-gate D2): shares as an integer %, with one decimal below 10%; temperatures to one decimal in the chunk tooltip and the ground hover, as integers in entity lines; durations in the time format above. A chunk or ambient temperature above 100 °C displays as "100+ °C" (`07-ui.md` §3.2); a heat entity's own temperature ("Temperature: 500 °C") is not clamped. US spelling in every player-visible string ("neighbor", "labeled", "color").

### 10.4 Towns and institutions (generator)

The word lists, the blocklist and the name patterns are `text.yaml`'s `town_names`. The rules:

| Rule | Spec |
|---|---|
| Town name | A first element chosen by the town's climate band (cold, temperate, warm; 01 §3) and a second element, joined (Ashford, Millbrook, Cedarton) or spaced for the few two-word forms (Clear Springs, Pine Junction) |
| Blocklist | Places tied to computing, AI, weapons or famous universities, and brand-like forms (Dartmouth, Bletchley, Los Alamos, Oak Ridge, Palo Alto, …), any form with Silicon or Valley, and every word of §10.2's never-list. The generator rejects and redraws |
| Uniqueness | Unique within 8 town cells (2,048 tiles), deterministic by seed (R5-gate D1). "Unique per map" cannot hold: towns are a pure function of (seed, cell), the map is endless and each climate band's pool holds about 200 names. The generator draws, rejects a name held by a higher-priority town within 8 cells (the cell-hash priority of the 64-tile footprint rule, `10-architecture.md` §5.18) and redraws up to 8 times, then appends " II" (" III" if that is held too). The numbers are `text.yaml`'s `town_names.uniqueness` |
| University | `{Town} College` for college towns, the starting college included; `{Town} University` for towns, cities and metropolises (01 §5.3) |
| Salvage | The spawn wreck is **Laboratory salvage**, not "Rad Lab salvage" (01 §9): the MIT Radiation Laboratory is a real institution, and B L15 keeps real history in citations. Its Handbook note says where the crate's radar came from: "Surplus from a wartime laboratory." (the Rad Lab closed on 31 December 1945) |
| Library and records store | `Library of {Town}`; an archive away from towns is `{Element} Hill records store` (or Mine, Quarry) |
| Exchange | By the field's era: telegraph office, telephone exchange, internet exchange (01 §5.3). No dates |

---

## 11. Anti-patterns

H §7's fifteen stand (coffee into theorems; students as fuel; patent guns; hype generators; Paperclips' own mascots; narrators; alignment meters with sermons; "self-aware"; faction strawmen; stochastic parrots; quips stapled to titles; explained references; judging the player; adjective soup; "Did you know"). Found during integration and review:

| # | Text | Why it fails | Fix |
|---|---|---|---|
| 16 | `Autosaving...` | Ellipsis (P14) | `Autosaving` |
| 17 | Stigler's law for Backpropagation | No eponym; the law does not apply (P16) | Stored program |
| 18 | Hofstadter's law firing when research is faster than estimated | Inverts the law (P16) | Underestimates only |
| 19 | "Crawler output decays on that schedule" | States a mechanism the game does not have (P16) | Remove the link |
| 20 | "Returned: 1 system card" | Contradicts the data (P3) | Bind to data |
| 21 | "Literature: 2026" | Contradicts the two-year rule (P3) | Computed |
| 22 | "Each one is an accelerator you are not using" | False for the data's agents (P3) | Dropped |
| 23 | "The decider is a threshold unit", "a decider is a threshold unit" | False for a multi-condition decider (P16) | Decision unit |
| 24 | "Neither is linear" | A wink (P14) | Rewritten |
| 25 | "Victory", "You win", "Congratulations", "Game over" | Factorio's finish-screen language; ours is a report (P5) | The run report |
| 26 | A literal number in text that the data also holds | Drifts after balancing into a false sentence (P17) | Placeholder |
| 27 | A tip that names a set-piece's punchline ("The technology costs ten memos") | Spoils the cost table (P2, P4) | Dropped |
| 28 | "Solar panels add no heat" as a physical claim | Panels darker than the ground they cover warm it; the engine's 0 is a rule, not physics (P3) | Show the number ("Heat: 0 kW"), no sentence |
| 29 | Two jokes on one source (a Jevons tip and the Jevons achievement) | P6 | Keep the mechanical one |
| 30 | A company or product as a citation's author ("OpenAI, 2023") | P3, P10 | Human authors or no citation |
| 31 | "In our history: 1948" | A wink at the fiction | Plain citation |
| 32 | A town named Silicon Ridge, Oakridge or Valleyview | A displayed reference (P9) | Blocklist |
| 33 | Report or charter sentences addressed to "you" | A speaker (P7) | Statistics categories only |
| 34 | "Entities placed since: 18,204 by agents, 0 by you" | The zero is structural; the clause exists only to be funny (P15) | Cut the clause |
| 35 | Explaining α, hollow work or the leak in a tooltip's second line ("so that's publication bias") | The inference is the player's (H §1.2) | A definition in the Handbook note, no comment |
| 36 | "Hollow: 20%" on the Seminar | Names the joke on a constantly visible surface, in design vocabulary (P1, P13) | "Yield 80%" |
| 37 | "Known before the game begins." | The word "game" breaks the plane | "Known before the charter." |
| 38 | "Surplus from a wartime laboratory." on every radar | True of one radar, false of every crafted one (P3) | The salvage's Handbook note |
| 39 | A technology definition that restates its unlocks, its effects or a stat | Duplicates the data and drifts (P17); the effect lines are generated | The definition clause only (§5.4) |
| 40 | "Oversight 3 of 4" counting search methods | Category error to an expert (P16) | "Verification" |
| 41 | A definition clause that contradicts the paper cited beside it ("trained end to end" beside Hinton, Osindero & Teh, 2006) | The player reads the citation (P3, P16) | Check every clause against its citation |
| 42 | "Your Ratings add half as much to σ." | A symbol and a "you" in UI text (§10.1, P7) | "Ratings add half as much to the synthetic share." |

---

## 12. Checklist for any new text

H §8's fourteen questions, plus five:

1. Is the first clause functional and complete without the rest? (P4)
2. Would a Factorio tooltip say it? (P8, P13)
3. Is every real term used in its real sense, and every number real and checkable? (P3)
4. How often will it be seen? More than once per session: no wit. (P1, P6)
5. Does it describe a benefit or a fact, and leave the consequence to the player? (P2)
6. Delete the second sentence: did the line get worse by being less true, or only less funny? (P15)
7. Is anyone speaking? (P7)
8. Is there a famous reference, and what did the game do to it? (P9)
9. Is the joke on a person, group, company or position? (P10, P11)
10. How big is the event, and how short is the text? (P5)
11. Exclamation marks, ellipses, "Did you know", quotes around a joke, emoji, winks? (P14)
12. Will it read the same in five years? (P12)
13. Is the name true in 1945 and at takeoff? (P12)
14. Does a mechanic already say it? Then the text says only the number. (P2)
15. **Does the mechanism satisfy the name?** For an achievement: is the condition the thing the name names? (P16)
16. **Is every number a data placeholder, or asserted?** An achievement's own condition is the one exemption. (P17)
17. **Is every historical claim checked against its source, earliest correct, at least two years old?** (P18, P3)
18. **Is this a callback?** Then it must be §3's, the only one. (P6)
19. **Is "you" an address or a statistics category?** Only the second, outside achievements and tips; the two standing categories are "Queued by: you" and "Last action by you". (P7)

**Automated checks** (in `tools/validate_spec.py` and the build): placeholder resolution and `asserts` (16); citation rules (§9.3); the never-list and future-word list against every string (§10.2); punctuation (no `!`, `...`, `…`, emoji) against every string; the symbols W, j, σ, L, O, h and the words "you"/"your" outside the allowed surfaces; US spelling; the description budget (§5.1 #2); the keep-list (§5.2); every achievement has a non-empty *Why*, reviewed by a person (15), and a known condition type with existing ids.

---

## 13. Claims pending verification

The round-3 accuracy audit checked every claim this file and `text.yaml` use against primary sources (R3-accuracy §4): the ENIAC tube count and power, the six ENIAC programmers, Licklider's interim, Good's proviso, Hadfield-Menell et al., Campbell, Stigler and the EDVAC title page, Lee et al., Muennighoff et al., Shumailov et al., Armstrong & Sandberg, Sutton, Rosenthal's file drawer, Hofstadter, von Kempelen, Jevons, low-background steel and the Rad Lab's closing date. Still unchecked, and therefore unused (P18):

| Claim | Status |
|---|---|
| Radar hardware became early computer memory (A §2) | Unverified; unused |
| The dating of hardware interrupts (A §3.1) | Unverified; unused |

---

## 14. Objections

1. **H's examples needed the expert test too.** Several of H's set-pieces failed P16 or P3 on contact with the mechanics (§6, §7 and the amendments in §4). They are changed here rather than kept "as canon", because P3 is H's own first rule. H's method is unchanged.
2. **B L15's "In our history: 1948"** is replaced by plain citations (§9.3). B owns the ontology; the frame is text, and it winks.
3. **The description budget (DECISIONS §34) against the data's carriers.** About one in five items and entities leaves room for the keep-list and little else, while this game's items are unusually often carriers whose content is the fact (Dataset, Checkpoint, Ratings, Baseline). If the budget binds, the coherence critic's tier B goes first and tier A stays even above one in five; R4-data applies it.

*Resolved since round 2:* "Threshold unit" (now Decision unit, DECISIONS §37 and the accuracy refinements); 04 §9's achievement conditions (04 §9 now quotes `text.yaml`, DECISIONS §20); the boiler's heat (DECISIONS §18, §24).

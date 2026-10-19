# R3 — Expert accuracy audit

*Round 3 critic. Lens: expert accuracy. The game's only player knows AI history and the AI-safety literature, and 08 §1.2 (P16, P18) makes accuracy the humour, so every name, citation, date and gloss must hold up, and every concept's mechanical effect must be what the concept is.*

**Scope.** All 250 technologies in `data/technologies.yaml`: 95 carry a citation, with 113 citation entries and 106 distinct works. Every factual `desc` in `items.yaml`, `entities.yaml` and `enemies.yaml`, plus the `note` fields in `recipes.yaml`. The historical and technical claims in spec 00, 01, 03, 04, 06, 07 and 08: the charter, run report, achievements and their *Why* column, loading tips, and the long-form citation examples.

**Method.**
- The data was extracted by script.
- Every citation was checked against primary or near-primary sources: publisher and DOI records, arXiv, ACL Anthology, PMLR/NeurIPS proceedings, IEEE/ACM records, RAND, the Dijkstra archive, Google Patents, Nobel lectures and scanned proceedings. Wikipedia was used only as a pointer.
- Each concept's effect was compared with the concept.
- Scripts and notes are in `/tmp/claude-1002/r3-accuracy/` (`extract.py`, `extract_items.py`, `yearcheck.py`, `textrules.py`, `draft_notes.md`).

**Already consistent.** Every technology's `year` equals the latest year in its citation, and no citation year exceeds its tier's era end (08 §9.3). All "et al." uses except one follow 08 §9.1's author-count rule.

**Rules for the replacements below.**
- New definition clauses keep 08 §5.1's budget of ten words or fewer.
- New citations follow 08 §9.1.
- Every changed year was re-checked against its tier's era end.

**Verdict.** There are no blockers. Most of the bibliography is right, often impressively so. The errors fall into four groups:
1. **Definition clauses that contradict the paper cited beside them:** *Deep learning*, *Formal verification*, *Process node*, *Embodied agents*, *Data parallelism*, *Expert iteration*, *Integrated circuit*, *Switching circuits*. This group is the most visible to this player.
2. **Mechanics whose effect misstates the concept:** the "Threshold unit", the "Oversight" count, the model-collapse penalty, *Watermarking*, and as minor items *Microfluidic cooling* and the *Reference monitor*.
3. **Years that break 08's own rules:** Hollerith, Dantzig, Kung & Leiserson, Kilby/Noyce, and the dispute rule for Borel and Baran.
4. **A handful of physics slips in item tooltips.**

Two fixes touch code (§1 M3 and M4) and should land before those systems are written. Everything else is data text.

---

## 1. Major issues (ranked)

### M1. The decider is named "Threshold unit", and *Cybernetics* says "a decider is a threshold unit"

**Where:**
- `items.yaml` and `entities.yaml`, `decider-combinator`: name and desc.
- `technologies.yaml`, `cybernetics`: desc.
- 08 §10.1 (Combinators row) and §14 #3.
- 03 §3.4 (Power switch row: "wire the cluster's machines to a Threshold unit").
- 10 (combinator table).
- 07 §25 #4.

**Claims:** the name "Threshold unit"; the desc "Outputs when its input crosses a threshold."; and *Cybernetics*: "Control by feedback; a decider is a threshold unit."

**Facts:**
- Factorio 2.0's decider takes "multiple conditions with and/or combinations" and several outputs ([FFF-384](https://factorio.com/blog/post/fff-384)). Spec 10 implements exactly that ("Multiple conditions and multiple outputs, per-wire input selection").
- A linear threshold unit (McCulloch & Pitts 1943; Rosenblatt 1958) computes only linearly separable functions ([pointer](https://en.wikipedia.org/wiki/Perceptrons_(book))). One 2.0 decider computes XOR: (A≠0 AND B=0) OR (A=0 AND B≠0).
- A decider also outputs *while* its condition holds. It is level-triggered, so "when its input crosses" (edge-triggered) is wrong even for a 1.x decider.
- The *Cybernetics* clause is the exact sentence that 08 §14 #3 forbids: "no text may claim that the unit is a single threshold unit."

**Fix.**

| Location | Replacement |
|---|---|
| `decider-combinator` name (items, entities) | **Decision unit** (id unchanged). It keeps the family (Arithmetic, Bias, Selector unit), says what Factorio's "decider" does, and is true in 1945. Avoid "Logic unit", which collides with the Logic board |
| `decider-combinator` desc | `Outputs while its conditions hold.` |
| `cybernetics` desc | `Control by feedback, computed by networks of simple units. Unlocks: Decision unit, Arithmetic unit, Bias unit, Power switch, Programmable speaker, Display panel. Circuit wires. (McCulloch & Pitts, 1943; Wiener, 1948)` |
| 08 §10.1 Combinators row | `Decision unit, Arithmetic unit, Bias unit, Selector unit` |
| 08 §14 #3, 07 §25 #4 | Mark resolved: renamed |
| 03 §3.4, 10 | "Threshold unit" → "Decision unit" |

**Why the citations still fit:**
- McCulloch & Pitts (1943) is about the logic of nets of simple units, not about feedback ([doi:10.1007/BF02478259](https://doi.org/10.1007/BF02478259)). It now supports "networks of simple units".
- Wiener (1948) supports "control by feedback".
- If a reviser prefers a feedback-only gloss ("Control by feedback."), cite (Rosenblueth, Wiener & Bigelow, 1943; Wiener, 1948). Rosenblueth et al. write: "All purposeful behavior may be considered to require negative feed-back" ([doi:10.1086/286788](https://doi.org/10.1086/286788)).
- "Bias unit" for the constant combinator is correct (a constant input, as a network's bias unit) and should stay.

**Cross-reference.** R3-coherence-tone M1 fixes the same *Cybernetics* sentence, but keeps the name. Its argument: an OR of conditions is a two-layer threshold network, so the family name is true of the parts.
- I would still rename. "Unit" names a single neuron, and a building that is a network of units is not one. This player will test XOR on it, as 07 §25 #4 already notes.
- If the name stays, both fixes agree on the rest: drop the clause from *Cybernetics*, and the desc must describe conditions, not a crossing.
- R3-coherence-tone's Constructor recipe ("5 Threshold unit") follows whichever name is chosen.

### M2. *Deep learning*'s definition contradicts its citation

**Where:** `deep-learning` desc.

**Claim:** "Many layers, trained end to end. … (Hinton, Osindero & Teh, 2006)"

**Fact:** The paper is the canonical case of *not* training end to end. Its abstract says: "a fast, greedy algorithm that can learn deep, directed belief networks one layer at a time … used to initialize a slower learning procedure that fine-tunes the weights" (*Neural Computation* 18(7):1527–1554; [PubMed](https://pubmed.ncbi.nlm.nih.gov/16764513/)). Every ML academic knows this paper for greedy layer-wise pre-training.

**Fix:** `Many layers of features, learned one layer at a time. Unlocks: Preprint, Endpoint, Ratings. (Hinton, Osindero & Teh, 2006)`

The alternative keeps "trained end to end" and cites end-to-end training within the Article era (≤ 2011): (Cireşan, Meier, Gambardella & Schmidhuber, 2010), *Neural Computation* 22(12). The first fix is better: the 2006 paper is what the field calls the start of deep learning, and the corrected clause is its actual contribution.

### M3. "Oversight" counts four search methods

**Where:**
- 08 §4.7 and 07 §4 (leak tooltip: `… {quality}. Oversight {o} of 4.`).
- 03 §3.1 ("**Oversight** O = the number of these researched: *Rejection sampling*, *Beam search*, *Monte Carlo tree search*, *Scalable oversight*"), §3.2, §4 (table and text), §7.
- 04 §6 ("*Oversight* techs") and §12.
- `meta.yaml` `runaways.oversight_techs` and `hollow_work.share`.

**Facts:**
- Rejection sampling (von Neumann 1951), beam search (Lowerre 1976) and MCTS (Coulom 2006; Kocsis & Szepesvári 2006) are sampling and search methods.
- In the safety literature, "oversight" means supervising a model's behaviour. Amodei et al. (2016) §5 introduced the term "scalable oversight" ([arXiv:1606.06565](https://arxiv.org/abs/1606.06565)).
- E's own tree names the line correctly: "Oversight 1–4 are the verifier line … Verification research therefore cuts F's leak" (`round1/E-tech-tree.md` §5.2).

**Why it matters:**
- To this player, the UI line "Oversight 3 of 4" after researching beam search and MCTS is a category error.
- It also empties 03 §4's design claim that "*Oversight* and *Interpretability* are … takeoff accelerators, not an alignment tax", because three of the four are capability methods.

**Fix (no balance change).** Rename the count **Verification** everywhere. The four techs stay. This matches the Comparator ladder ("tier k verifies tier k+1"), and "verifier" is on 08 §10.2's encouraged list.

| Location | Change |
|---|---|
| 08 §4.7 and 07 §4 | `… tier {t}, {quality}. Verification {o} of 4.` |
| 03 §3.1, §3.2, §4, §7; 04 §6, §12 | "Oversight count O" → "Verification count O". §4 becomes: "*Verification* and *Interpretability* are therefore takeoff accelerators …" |
| `meta.yaml` | `runaways.oversight_techs` → `verification_techs` |

*Alternative, with a balance change:* to keep the word "Oversight" and G's point, point O at genuine oversight techs (*Reference monitor*, *Preference tuning*, *Scalable oversight*, *Formal verification*) and re-run `leak_est.py`.

### M4. The model-collapse penalty ignores where the training text came from

**Where:**
- 01 §7.4; 03 §2.2 (table and readout); 00 §8 P7.
- `meta.yaml` `world_text.exchange.synthetic` and `effects.synthetic-detection`.
- 08 §6 #12 (*The curse of recursion*) and its *Why*.

**Claim:** Before *Synthetic detection*, "every training-category recipe rolls quality at × (1 − σ)", where σ is the world's synthetic share of new writing.

**Fact:** Model collapse comes from what a model is trained on: "tails of the original content distribution disappear" when models train on generated data (Shumailov et al., *Nature* 631:755–759, 2024; preprint 2023; [doi:10.1038/s41586-024-07566-y](https://doi.org/10.1038/s41586-024-07566-y)). Its size follows the synthetic fraction *of the training data*.

**Why the current rule is wrong:**
- In the data, a Dataset is 20 prose + 1 token (`recipes.yaml: dataset`).
- Prose comes either from crawl (Quality filtering, Deduplication) or from *Synthetic data*, which runs on archive Tokens.
- A Site training only on archives, which are "σ = 0 forever" (DECISIONS §5, 01 §6.3, "low-background data"), is penalised exactly as much as one training on crawl.
- So the game's own low-background idea has no effect on training, which is the opposite of the analogy. The loading tip "Archives were written before any of it" (08 §7 #15) is then mechanically empty.

**Fix (deterministic, global, computed from production statistics as Factorio's are):**
- σ_train = σ × c.
- c is the share of the Site's text and prose produced in the last 10 minutes that came from crawl recipes (Quality filtering, Deduplication), out of text and prose from crawl recipes plus *Synthetic data*. c = 0 if nothing was produced.
- Before *Synthetic detection*, training recipes roll quality at × (1 − σ_train). After it, nothing changes: no penalty, and crawl × (1 − σ).

| Location | Replacement |
|---|---|
| Trainer readout (03 §2.2) | `Quality chance −18% (synthetic share 31% × crawl share 58%)` |
| 08 §6 #12 condition | `Train a checkpoint while more than half of the Site's new text is synthetic and Synthetic detection is not researched.` (σ_train > 0.5) |
| 00 §8 P7 | `training quality × (1 − σ × crawl share)` |

**Balance:**
- A crawl-only Site (c = 1) plays exactly as now.
- An archive-heavy Site gets the payoff DECISIONS §5 promises, limited by finite archives. That is the intended "the past runs out" tension.

**Cross-reference.** R3-fun FUN-03 points out that the penalty is inert without Comparators, and makes it bite through Trainer speed as well. The two fixes compose: use σ_train in both the speed and the quality penalty.

### M5. *Process node* attributes Rock's law to Moore (1965)

**Where:** `process-node` desc.

**Claim:** "Transistors per die double; so does the fab's cost. … (Moore, 1965)"

**Facts:**
- Moore (1965) says nothing about fab cost. It predicts that the complexity for minimum component cost doubles each year, and that cost per component falls (*Electronics* 38(8):114–117; [scan](https://www.cs.utexas.edu/~fussell/courses/cs352h/papers/moore.pdf)).
- Fab cost doubling (about every four years) is "Rock's law", or "Moore's second law", aired in the mid-1990s and never published by Arthur Rock ([IEEE Spectrum](https://spectrum.ieee.org/5-commandments)). 04 §10's note "Moore; Rock's law" already knows this; the tooltip does not.

**Fix:** `Components per chip double at a steady rate. Accelerator productivity +10%. (Moore, 1965)`

The cost table's doubling (1,000 × 2^(L−1)) still says Rock's law silently, as 08's rule 2 ("the cost table carries the satire") wants.

### M6. *Formal verification*: "machine-checked" is not what Floyd and Hoare did

**Where:** `formal-verification` desc.

**Claim:** "A machine-checked proof that the program is correct. … (Floyd, 1967; Hoare, 1969)"

**Facts:**
- Floyd (1967, "Assigning meanings to programs", *Proc. Symp. Appl. Math.* 19:19–32) and Hoare (1969, *CACM* 12(10):576–580) give pencil-and-paper proof methods.
- The first mechanical program verifier is King's 1969 CMU thesis, *A Program Verifier* ([Boyer & Moore's history](https://www.cs.utexas.edu/~boyer/jar.pdf)).

**Fix (keeps the stronger clause, which suits the Reference tier):** `A machine-checked proof that the program is correct. Quality tier: Reference. (Floyd, 1967; Hoare, 1969; King, 1969)`. The year is unchanged.

*Alternative:* keep the citation and write `A proof that the program meets its specification.`

### M7. *Crawling* cites the robots.txt convention, not a crawler

**Where:** `crawling` desc.

**Claim:** "A program follows links and copies what it finds. … (Koster, 1994)"

**Facts:**
- Koster's 1994 items are not sources for crawling:
  - "A Standard for Robot Exclusion" (robots.txt) is a mailing-list consensus of 30 June 1994, not a publication. It is about keeping crawlers *out*.
  - ALIWEB (WWW94) explicitly avoids web-traversing robots ([paper](https://archives.iw3c2.org/www1/PdfWWW94/aliweb.pdf)).
- The first crawler papers were both presented at the First WWW Conference, Geneva, May 1994 ([proceedings index](https://archives.iw3c2.org/www1/PrelimProcs.html)):
  - Eichmann, "The RBSE Spider — Balancing effective search against Web load";
  - McBryan, "GENVL and WWWW: Tools for taming the Web".

**Fix:** `A program follows links and copies what it finds. Unlocks: Crawler. (Eichmann, 1994; McBryan, 1994)`. The year is unchanged.

*Note for H:* robots.txt is the real origin of "closed to crawlers". It belongs to the *Walled garden* idea, uncited, because it is not a publication (08 §9).

### M8. *Watermarking*'s effect says something watermarking does not do, in forbidden notation

**Where:**
- `watermarking` desc.
- 01 §12.3 (increments table); 03 §2.2.

**Claim:** "Generated text carries a statistical signature. Your Ratings add half as much to σ."

**Facts:**
- A watermark makes generated text *detectable*: anyone holding the key can test for it (Kirchenbauer et al., ICML 2023, [PMLR 202](https://proceedings.mlr.press/v202/kirchenbauer23a.html)). It does not make less text generated.
- σ is defined as "Share of new writing that is generated" (08 §4.7). Halving your contribution is true only if someone filters the marked text, and the tooltip never says so.
- The string also breaks two of 08's rules: symbols never appear in the UI (§10.1, "σ"), and no "you" in technology text (P7, "Your").

**Fix:** `Generated text carries a signature that exchanges can filter. Ratings add half as much to the synthetic share. (Kirchenbauer et al., 2023)`

In 01 §12.3, the increment row becomes "Halved after *Watermarking*: exchanges filter much of the marked text."

### M9. *Embodied agents*: "remotely directed" contradicts Brooks

**Where:** `embodied-agents` desc.

**Claim:** "An agent with legs, remotely directed. (Brooks, 1991)"

**Fact:** Brooks's thesis is on-board, situated control with no central planner. "All computation should be done on board the robots … so that the robots could run tether-free and without any communication link" ("Intelligence without reason", MIT AI Memo 1293, prepared for IJCAI-91; [pdf](https://jmvidal.cse.sc.edu/library/brooks91a.pdf)). The legged robot is Genghis: Brooks (1989), "A robot that walks: Emergent behaviors from a carefully evolved network", *Neural Computation* 1(2):253–262 ([doi](https://doi.org/10.1162/neco.1989.1.2.253)).

**Fix:** `Legs coordinated by local reflexes, not a central plan. Unlocks: Legged agent. (Brooks, 1989)`. The year changes 1991 → 1989, which is fine for the Model-card era.

The clause is also true of the spidertron, whose legs place themselves while the player sets only the destination.

---

## 2. Minor issues

### 2.1 Citations: years, author lists, 08 §9.1's own rules

| Tech (id) | Now | Fact (source) | Fix |
|---|---|---|---|
| `tabulation` | (Hollerith, 1890) | 1890 is the census and his PhD year. The system was first published as "An electric tabulating system", *The Quarterly* (Columbia School of Mines) 10(16):238–255, April 1889; patents 395,781–3 were granted 8 Jan 1889 ([Columbia](https://columbia.edu/cu/computinghistory/hollerith.html)) | **(Hollerith, 1889)**, year 1889 |
| `linear-programming` | (Kantorovich, 1939; Dantzig, 1947) | Dantzig published nothing in 1947. The simplex method took shape then; his first memo is Feb 1948 (USAF, internal); the open literature starts with "Programming of interdependent activities: II", *Econometrica* 17(3/4):200–211, 1949 ([doi](https://doi.org/10.2307/1905523)) | **(Kantorovich, 1939; Dantzig, 1949)**, year 1949 (Memo era end 1955: fine) |
| `systolic-arrays` | (Kung & Leiserson, 1978) | The symposium was Nov 1978; the version of record is *Sparse Matrix Proceedings 1978*, SIAM 1979, pp. 256–282, and Kung cites it as 1979 ([CMU report](https://www.eecs.harvard.edu/htk/static/files/1978-cmu-cs-report-kung-leiserson.pdf)) | **(Kung & Leiserson, 1979)** |
| `integrated-circuit` | (Kilby, 1958; Noyce, 1959) | Mixes Kilby's demonstration year with Noyce's filing year. Kilby filed 6 Feb 1959 (granted 1964; TI announced in March 1959); Noyce filed 30 Jul 1959 (granted 25 Apr 1961) ([US2981877](https://patents.google.com/patent/US2981877A/en); [Kilby's Nobel lecture](https://www.nobelprize.org/uploads/2018/06/kilby-lecture.pdf)) | **(Kilby, 1959; Noyce, 1959)**, year unchanged. Add to 08 §9.1: "Patented inventions are cited by filing year." |
| `test-time-compute` | (Snell et al., 2024) | **Four** authors: Snell, Lee, Xu & Kumar ([arXiv:2408.03314](https://arxiv.org/abs/2408.03314)). 08 §9.1 names 2–4 authors in full | **(Snell, Lee, Xu & Kumar, 2024)** |
| `instruction-tuning` | (Wei et al., 2022) | Collides with *Chain of thought*'s (Wei et al., 2022), a different paper; both print identically in the credits. FLAN's preprint is 3 Sep 2021 and coined "instruction tuning" ([arXiv:2109.01652](https://arxiv.org/abs/2109.01652)) | **(Wei et al., 2021)** |
| `game-theory` | (von Neumann, 1928) | A famous priority dispute: Borel (1921), *C. R. Acad. Sci.* 173:1304–1308, had mixed strategies; Fréchet and von Neumann argued it out in *Econometrica* 21(1), 1953. 08 §9.1 says every claimant is cited | **(Borel, 1921; von Neumann, 1928)**, year unchanged |
| `packet-switching` | (Baran, 1964; Davies, 1966) | Disputed priority means first publication counts. Baran's RAND P-2626 (Sep 1962) already has "standard message blocks"; 1964 is its IEEE reprint ([RAND](https://www.rand.org/pubs/papers/P2626.html)). Davies 1966 is right, and he coined "packet" | **(Baran, 1962; Davies, 1966)**, year unchanged |
| `stored-program` | (von Neumann, 1945) | Correct: the EDVAC draft's title page carries only his name ([scan](http://archive.computerhistory.org/resources/text/Knuth_Don_X4100/PDF_index/k-8-pdf/k-8-u2593-Draft-EDVAC.pdf)). But priority is disputed (Eckert & Mauchly, *Automatic High Speed Computing: A Progress Report on the EDVAC*, 30 Sep 1945), so 08 §9.1 would force a second name, and that would break the *Stigler's law* achievement, which needs the single name | Keep it. Add to 08 §9.1: "One exception: *Stored program* cites von Neumann alone; the omission is §6 #2's subject." Without this line, a careful reviser will "fix" the joke away |
| 08 §9.2 example | Wiener, N. (1948). *Cybernetics* … MIT Press. | No "MIT Press" existed in 1948: the Technology Press was renamed MIT Press in the early 1960s. The 1948 first edition was published by Hermann & Cie, Paris, and in the US by the Technology Press (MIT) with John Wiley & Sons ([review imprint, *JSL*](https://resolve.cambridge.org/core/journals/journal-of-symbolic-logic/article/abs/norbert-wiener-cybernetics-or-control-and-communication-in-the-animal-and-the-machine-the-technology-press-john-wiley-sons-inc-new-york-hermann-et-ie-paris-1948-194-pp/B03748034673BCFF03E9B65D3067D5A7)). "MIT Press" is right only for the 2nd edition (1961) | `Wiener, N. (1948). Cybernetics: Or control and communication in the animal and the machine. Technology Press; Wiley; Hermann & Cie.` |

### 2.2 Definition clauses that misdescribe their source

| Tech (id) | Now | Fact (source) | Replacement clause |
|---|---|---|---|
| `data-parallelism` | Many accelerators share one job; each adds less. | DistBelief ran on "tens of thousands of CPU cores" (Dean et al., NIPS 2012, [abstract](https://papers.nips.cc/paper_files/paper/2012/hash/6aca97005c68f1206823815f66102863-Abstract.html)) | `Many machines share one job; each adds less.` |
| `integrated-circuit` | Many transistors on one die. | Kilby's first IC (12 Sep 1958) had **one** transistor and a distributed RC network ([Nobel lecture](https://www.nobelprize.org/uploads/2018/06/kilby-lecture.pdf)). What defines it is every component formed in one semiconductor body | `A whole circuit made in one piece of semiconductor.` |
| `expert-iteration` | Generate, keep the best, train on it, repeat. | ExIt is a tree-search expert plus a network that imitates it; there is no keep-the-best filter ([arXiv:1705.08439](https://arxiv.org/abs/1705.08439)). The current clause is the later LLM usage | `Search finds better answers; the model learns them; repeat.` (fits both usages) |
| `switching-circuits` | Relays and tubes compute Boolean logic. | Shannon (1938) treats relay contacts and switches only; the thesis has no "tube" ([doi](https://doi.org/10.1109/T-AIEE.1938.5057767)) | `Relays and switches compute Boolean logic.` |
| `learning-curve` | Unit cost falls with each doubling of output. | Wright's 80% rule is about average labour cost against **cumulative** quantity ([scan](https://www.uvm.edu/pdodds/research/papers/others/1936/wright1936a.pdf)) | `Average cost falls with each doubling of cumulative output.` |
| `expected-utility` | Rank outcomes by probability-weighted utility. | Outcomes have utilities; gambles (actions) are ranked by their probability-weighted utility (Bernoulli 1738; von Neumann & Morgenstern 1944) | `Rank gambles by their probability-weighted utility.` |
| `information-theory` (optional) | A message is a number of bits. | Shannon measures information in bits and sets meaning aside: "semantic aspects of communication are irrelevant to the engineering problem" (1948, p. 379) | `Information measured in bits, apart from meaning.` |

### 2.3 Mechanics whose effect strains the concept

- **`microfluidic-cooling`** ("Coolant flows through channels etched into the die. Cooler capacity ×2").
  - The ×2 includes the **Cooling tower**, which in this game takes heat out of the chunk's air (`desc`: "Absorbs heat in its chunk") and never touches the coolant loop.
  - Microchannels lower the resistance between the die and the coolant (Tuckerman & Pease, *IEEE EDL* 2(5), 1981: 790 W/cm²). They cannot change a cooling tower.
  - Literal fix: Microfluidic raises the liquid-cooled limit, `T*_eff = T* + 30 K × q` (was 15 K), with desc `Coolant flows through channels etched into the die. Liquid-cooled limit +15 K.`
  - Minimal fix: drop `cooling-tower` from the effect's entity list.
  - Either way, re-run G's takeoff sim, where cooling binds 31% of the time.
- **`reference-monitor`.**
  - A reference monitor *mediates every access*, which means prevention (Anderson 1972). The Monitor it unlocks *cleans* a compromised machine every 5 s, which is detection plus response.
  - Cheap fix: rename the tech **Threat monitoring**, desc `Watch the audit trail for misuse, and undo it. Unlocks: Monitor, Evaluation set. (Anderson, 1980)`. This is James P. Anderson's own 1980 report, *Computer Security Threat Monitoring and Surveillance*, the origin of intrusion detection ([CERIAS](https://cerias.purdue.edu/apps/reports_and_papers/view/907)). The year changes 1972 → 1980, within the Programming era.
  - Alternative: keep the name and make the Monitor *prevent* infection of machines in range, one Evaluation set per blocked copy.
- **`context-length-1..3`** ("Agents carry more per trip. Agent cargo +1").
  - Context length is not payload. It is the kind of pun the brief rules out, and it fails P16 because agents carry matter (B L1).
  - Rename **Lift capacity 1–3**; descs unchanged. R3-coherence-tone m18 reaches the same name independently.
- **Recipe `wafer`, named "Photolithography".**
  - Photolithography patterns circuits *onto* a wafer; it does not make blank wafers.
  - Fix: drop the `name`, so the recipe displays as "Wafer". If the noun is wanted, give it to the Processor recipe, where patterning happens.
  - `integrated-circuit` desc then reads `Unlocks: Processor, Wafer.`
- **Coprocessor 1–3 (speed modules)** omit Factorio 2.0's quality penalty of −1%, −1.5% and −2.5%, added in 2.0.7 ([wiki](https://wiki.factorio.com/Speed_module)). 00 §8 claims module numbers are ISO. Add `quality: -0.01 / -0.015 / -0.025`.
- **`web-search`'s "Staffing radius ×1.5"** is a weak fit, since ranking pages does not extend a commute. It is acceptable as written. If a reviser wants a literal home, remote work came with *Time-sharing*'s remote terminals, though moving it shifts staffing to green.

### 2.4 Item and entity descriptions (physics and facts)

| id | Now | Fact (source) | Replacement |
|---|---|---|---|
| `solar-panel` (items, entities) | Adds no heat where it stands. | 08 §11 #28 itself rules this out: panels darker than the ground warm it, and the engine's 0 is a rule | `60 kW in full sun.` (bind to data per P17) |
| `fusion-reactor` (items, entities) | Fuses hydrogen isotopes into plasma. … neighbour … | Fusion turns hydrogen isotopes into helium (and neutrons); the plasma is the heated fuel, not the product | `Heats hydrogen isotopes into a fusing plasma. Each active neighbor adds 100%.` |
| `lubricant` | Pressed from coal. | Nothing is pressed. Coal-derived lubricant is made from coal and steam via syngas (Fischer–Tropsch); the recipe is coal + water in a chemical plant | `Synthesized from coal and steam.` |
| `sulfuric-acid` | Etches wafers, fills batteries, leaches uranium. | In wafer processing, sulfuric acid cleans and strips resist (the sulfuric–peroxide "piranha" clean); silicon is etched by other chemistries | `Cleans wafers, fills batteries, leaches uranium.` |
| `quartz` | Silicon dioxide. About 60% of the continental crust, by weight. | SiO₂ as an oxide component is 60.6 wt% of the bulk crust (Rudnick & Gao; [doi](https://doi.org/10.1016/B0-08-043751-6/03016-4)), mostly bound in feldspars. The mineral quartz is about 12% by volume. Under a "Quartz" header the line reads as the mineral | `Silicon dioxide. Silica is 60% of the continental crust.` |
| archive tooltip (01 §6.3; also its prose "before anyone could fake text") | Written before anyone could fake it. | People forged text long before 1945. What archives predate is *generated* text, the game's own word for σ | `Written before any text was generated.` |
| `agent-hub` | Logistic range 50, construction range 110. | These are areas (50 × 50 and 110 × 110; radii 25 and 55), which is how Factorio labels them ([wiki](https://wiki.factorio.com/Roboport)) | `Houses and charges agents. Logistic area 50 × 50, construction area 110 × 110.` |
| `accelerator-4` | Erases little, so heats little. Hall speed 20 at 16 MW. | It draws more power than tier 3 (16 MW against 12 MW) but much less per unit of speed (0.8 against 1.5 MW). Bennett: dissipation "per logical step" | `Erases little, so heats less per operation. Hall speed 20 at 16 MW.` |
| `isotope-separation` (tech) | Spin out the lighter isotope. | In a gas centrifuge the **heavier** U-238 goes to the rotor wall and U-235 stays near the axis ([NRC](https://www.nrc.gov/reading-rm/doc-collections/fact-sheets/enrichment.html)). "Spin out the lighter" reads backwards | `Spinning gas sends the heavier isotope to the wall.` |
| `arc-turret` | Runaway bodies have no electric resistance. | Read physically, zero resistance means no Joule heating, so the arc would do nothing. Factorio means 0% damage resistance | `Arcs between targets. Runaways take full electric damage.` |
| `mobile-robotics` (tech name and desc) | Mobile robotics / "A robot that plans …" | Correct concept, but "robot" is on 08 §10.2's never-list. Nilsson's own title is "A Mobile Automaton" | Name **Mobile automata**; desc `A machine that plans its own movements. …` |

### 2.5 Prose claims (spec text, not UI)

| Where | Claim | Fact (source) | Fix |
|---|---|---|---|
| 03 §1.2 | "C = 20 MJ/K (about the heat capacity of a chunk's air and topsoil)" | 20 MJ/K over 1,024 m² is the air up to about 16 m, or about 9 mm of soil. A real boundary layer (~1 km) plus the soil's daily depth (~10 cm) holds 10–60× more | "(a game constant chosen for a 3-minute response)" |
| 03 §1.4 | "1 water per 2.26 MJ removed (the latent heat of 1 kg)" | 2.26 MJ/kg is the latent heat at 100 °C; at a tower's 25–30 °C it is 2.43 ([NIST](https://webbook.nist.gov/chemistry/fluid/)) | "1 water per 2.43 MJ (latent heat at 30 °C; 4.1 water/s at full)" |
| 06 §1 Mercury | "Regolith (iron, silicon, aluminium)" | MESSENGER found Mercury's surface iron-poor (~1.5 wt% Fe); the iron is in the core ([NASA fact sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/mercuryfact.html)). The 6–7× flux, polar ice and θ ≈ −170 °C (annual average) are right | "Regolith (silicon, magnesium, sulfur; little iron)" |
| 08 §6 #28 *Why* | Eternity in six hours: "Armstrong & Sandberg (2013) … the expansion's own route" | The six hours are **energy**, not time: "only about six hours of the sun's energy is needed to commence the colonisation of the entire universe"; dismantling Mercury takes 31 years ([doi](https://doi.org/10.1016/j.actaastro.2013.04.002)). The condition "Win within six hours" bends the title into a speedrun (P9). That is allowed, but the *Why* should say so | *Why*: "Armstrong & Sandberg (2013): six hours of the Sun's output launch the expansion. Bent to a clock, as Factorio's There is no spoon" |
| 08 §6 #7 *Why* | "Tanenbaum's station wagon full of tapes" | Tanenbaum popularised the line (*Computer Networks*, 2nd ed., 1988), paraphrasing Warren Jackson (c. 1985); variants go back to the early 1970s ([Wikiquote](https://en.wikiquote.org/wiki/Andrew_S._Tanenbaum)). Its attribution is itself a case of Stigler's law. Reviewers only | *Why*: "popularised by Tanenbaum (1988)" |
| 08 §13 | Pending list | Now verified: ENIAC's tubes and power, the six programmers, Licklider, Good's proviso, Hadfield-Menell et al., Campbell, Stigler and the EDVAC title page, Lee, Muennighoff, Shumailov, Armstrong & Sandberg, Sutton, Rosenthal (§4 below) | Close §13 except "radar hardware became computer memory" and "hardware interrupts", which were not checked |

### 2.6 Found in passing (rules and consistency; not accuracy)

- **03 §3.4** says Evaluation sets come "from *Penetration testing*"; the data unlocks them with *Reference monitor*.
- **Salvage disagrees three ways:**
  - `meta.yaml` `start.salvage` has entity "Radar laboratory salvage" and contents {iron-plate 20, iron-gear-wheel 10, copper-cable 20, logic-board 8};
  - 01 §9 has six wreck pieces at 5 iron each, plus a crate with 1 radar, 10 logic-board and 20 copper-cable;
  - 10 §(starting area) says "The Rad Lab salvage", against 08 §10.4.
- **US spelling (08 §10.3):** "neighbour(s)" in `lateral-inhibition`, `accelerator-3`, `nuclear-reactor` (×2) and `fusion-reactor` (×2); "labelled" in `curated-corpora`.
- **"You" in technology text (P7).** R3-coherence-tone m1 flags the same strings; either wording works.

  | Tech | Now | Replacement |
  |---|---|---|
  | `belt-immunity` | "Belts no longer carry you." | `Belts no longer carry the wearer.` |
  | `exoskeleton` | "…move your legs." | `Motors that move the wearer's legs.` |
  | `personal-assistant` | "…follow you and build what you mark." | `Agents that follow the wearer and build what is marked.` |
  | `penetration-testing` | "Attack your own system…" | `Attack the system to find what fails.` |
  | `watermarking` | — | Covered by M8 |

---

## 3. Earlier sources under 08's "earliest correct citation" rule (P3)

None of the current citations below is wrong; each has a verified earlier claimant.
- **Recommended:** Maron (1961), a 33-year gap behind a mostly language-identification paper.
- **Optional:** the rest, at H's discretion.
- Year changes are marked; all stay within their era.

| Tech | Now | Earlier correct source (verified) | Suggested citation |
|---|---|---|---|
| `text-categorization` (**recommended**) | Cavnar & Trenkle, 1994 | Maron (1961), "Automatic indexing: an experimental inquiry", *JACM* 8(3):404–417: Bayesian assignment of documents to categories ([record](https://projects.csail.mit.edu/jacm/References/maron1961:404.html)) | (Maron, 1961); year 1961 |
| `scaling-laws` | Kaplan 2020; Hoffmann 2022 | Hestness et al. (2017), power-law error scaling across four domains ([arXiv:1712.00409](https://arxiv.org/abs/1712.00409)) | (Hestness et al., 2017; Kaplan et al., 2020; Hoffmann et al., 2022) |
| `accelerators` | Raina, Madhavan & Ng, 2009 | Oh & Jung (2004), *Pattern Recognition* 37(6):1311–1314, a neural network on a GPU ([doi](https://doi.org/10.1016/j.patcog.2004.01.013)) | (Oh & Jung, 2004; Raina, Madhavan & Ng, 2009) |
| `self-driving-labs` | King et al., 2009 | King et al. (2004), *Nature* 427:247–252: devises, runs and interprets experiments ([PubMed](https://pubmed.ncbi.nlm.nih.gov/14724639/)) | (King et al., 2004) |
| `algorithmic-progress` | Ho et al., 2024 | Hernandez & Brown (2020): 44× less compute for AlexNet-level results; Ho et al. cite it as the original ([arXiv:2005.04305](https://arxiv.org/abs/2005.04305)) | (Hernandez & Brown, 2020; Ho et al., 2024) |
| `chain-of-thought` | Wei et al., 2022 | Nye et al. (2021), scratchpads (arXiv, Nov 2021); Ling et al. (2017), rationales, ACL ([anthology](https://aclanthology.org/P17-1015/)) | (Nye et al., 2021; Wei et al., 2022) |
| `instruction-tuning` | Wei et al., 2022 | Mishra, Khashabi, Baral & Hajishirzi (arXiv, Apr 2021) fine-tuned on instructions first ([arXiv:2104.08773](https://arxiv.org/abs/2104.08773)) | (Mishra, Khashabi, Baral & Hajishirzi, 2021; Wei et al., 2021) |
| `synthetic-detection` | Solaiman et al., 2019 | Badaskar, Agarwal & Arora (2008), IJCNLP: classifiers telling real from machine-generated articles ([anthology](https://aclanthology.org/I08-2115/)); also Zellers et al. (May 2019) | (Badaskar, Agarwal & Arora, 2008) |
| `quantization` | Jacob et al., 2018 | Vanhoucke, Senior & Mao (2011), 8-bit weights and activations, NIPS workshop ([Google](https://research.google/pubs/pub37631/)) | (Vanhoucke, Senior & Mao, 2011; Jacob et al., 2018) |
| `rollback-recovery` | Randell, 1975 | Chandy & Ramamoorthy (1972), "Rollback and recovery strategies for computer programs", *IEEE TC* C-21(6):546–556: the exact name ([Crossref](https://api.crossref.org/works/10.1109/TC.1972.5009007)) | (Chandy & Ramamoorthy, 1972; Randell, 1975) |
| `statistical-learning` | Vapnik & Chervonenkis, 1971 | The same results in *Doklady* 181(4):781–783, 1968 ([mathnet](https://www.mathnet.ru/eng/dan34016)) | (Vapnik & Chervonenkis, 1968; Vapnik, 1995) |
| `perceptron` | Rosenblatt, 1958 | Cornell Aeronautical Lab report 85-460-1, Jan 1957 (bibliographic records; [Nagy](https://sites.ecse.rpi.edu/~nagy/PDF_chrono/2011_Nagy_Pace_FR.pdf)) | (Rosenblatt, 1957); year 1957 |
| `expert-systems` | Feigenbaum, 1977 | Feigenbaum (1977) is a retrospective; DENDRAL is Buchanan, Sutherland & Feigenbaum (1969), *Machine Intelligence* 4:209–254 ([contents](https://www.doc.ic.ac.uk/~shm/MI/mi4.html)) | (Buchanan, Sutherland & Feigenbaum, 1969). Year 1977 → 1969, which changes 09's "Literature in the slice runs to 1977" |

**Keep as is, though earlier work exists:**
- Dennard et al. (1974): the canonical scaling paper; IEDM 1972 came first.
- Dijkstra (1965): the field's date; EWD35 is from about 1962.
- Coulom (2006): the conference year; the LNCS volume is 2007.
- Bahdanau et al. (2015): ICLR; arXiv 2014.
- Wiener (1949): Kolmogorov 1939/41 was independent.
- Buchholz (1962): Eckert's LARC (1956) overlapped instructions earlier.
- Flynn (1966): coined SIMD.
- von Neumann (1966): the Hixon talk of 1948 came first.
- Smith (1980): the IJCAI-77 short paper came first.
- Linde (1975): Karger & Schell (1974) came first.

---

## 4. Verified correct (safe for revisers)

### Technology citations: authors, year and gloss all hold

- **Founders and computing:**
  - Shannon 1938 (*Trans. AIEE* 57(12)); Bush 1945 ("Basic research is performed without thought of practical ends", verbatim); Bush 1945 (the memex "consists of a desk", verbatim).
  - von Neumann 1945; Hazen 1934; Dijkstra 1965 (EWD35 says the term is "borrowed from the railways", so *Semaphores* unlocking rail signals is historically exact).
  - Chapin, Fuller & Pearson 1954; Wiener 1949; Garfield 1955; Corbató, Merwin-Daggett & Daley 1962; Pfann 1952; Noyes & Dickinson 1956; Wilson & Trickey 1962; Wanlass & Sah 1963; Buchholz (ed.) 1962; Flynn 1966; Wengert 1964; Davies 1966; Maiman 1960.
  - Landauer 1961; Bennett 1973 ("dissipating considerably less than kT … per logical step").
  - McCulloch & Pitts 1943; Wiener 1948; Kantorovich 1939; Anderson 1972; Linde 1975; Randell 1975.
  - Tuckerman & Pease 1981; Dennard et al. 1974 (6 authors); Moore 1965 (first clause); Sterling et al. 1995 (6 authors); von Neumann 1966; Moto-oka (ed.) 1982 (ICOT April 1982 to 1992).
- **AI and statistics:**
  - Rosenblatt 1958; Samuel 1959 (self-play explicit); Silver et al. 2017.
  - McCarthy, Minsky, Rochester & Shannon 1955 ("a 2 month, 10 man study", verbatim).
  - von Neumann 1951 (rejection method); von Neumann 1928; Bernoulli 1738; von Neumann & Morgenstern 1944; Stone 1974; Geisser 1975; Vapnik & Chervonenkis 1971; Vapnik 1995.
  - Linnainmaa 1970; Werbos 1974; Rumelhart, Hinton & Williams 1986; Fukushima 1980 (shared weights confirmed); LeCun et al. 1989 (7 authors).
  - Nilsson 1969; Fikes & Nilsson 1971; Smith 1980; Feigenbaum 1977; Lowerre 1976; Hartline 1949; Fisher 1925; Neyman & Pearson 1933.
  - Glass 1976 (coined "meta-analysis"); Rosenthal 1979 (coined "file drawer problem"); Rubin 1993 (*JOS* 9(2):461–468); Good 1965.
- **Modern ML:**
  - Brin & Page 1998; Thorp 1998; Quirk, Brockett & Dolan 2004; Buciluǎ, Caruana & Niculescu-Mizil 2006 (the data correctly uses U+01CE ǎ); Coulom 2006; Kocsis & Szepesvári 2006.
  - Myers et al. 2007 (10 authors); Raina, Madhavan & Ng 2009; Deng et al. 2009; Barroso & Hölzle 2009; King et al. 2009; Pedregosa et al. 2011.
  - Bahdanau, Cho & Bengio 2015; Vaswani et al. 2017; Amodei et al. 2016 (§5 "Scalable Oversight"); Irving, Christiano & Amodei 2018; Christiano et al. 2017; Ouyang et al. 2022; Anthony, Tian & Barber 2017; Jacob et al. 2018; Olah et al. 2018; Solaiman et al. 2019.
  - Kaplan et al. 2020; Hoffmann et al. 2022; Brown et al. 2020 (coins "in-context learning"); Bloom, Jones, Van Reenen & Webb 2020; Chen et al. 2021; Wei et al. 2022 (chain of thought); Kirchenbauer et al. 2023; Ho et al. 2024.
- **Author counts:** every "et al." has five or more authors, except Snell (§2.1).

### Achievements, tips, charter

- **Historical facts:**
  - The Turk (von Kempelen, 1770).
  - *Stigler's law* (Stigler 1980, *Trans. NY Acad. Sci.* 39:147–157; the stored-program design is a standard instance).
  - Hofstadter's law ("It always takes longer than you expect, even when you take into account Hofstadter's Law", *GEB* 1979).
  - Bush 1945; low-background steel (pre-1945; Scapa Flow); Jevons 1865.
- **Quotations and paraphrases:**
  - Good 1965's proviso, verbatim on p. 33. The condition really is "the part most quotations omit".
  - Licklider 1960 ("a fairly long interim").
  - Hadfield-Menell, Dragan, Abbeel & Russell (arXiv Nov 2016; IJCAI 2017).
  - Campbell (Occasional Paper #8, Dec 1976; *Eval. Program Plann.* 1979).
  - Sutton (13 March 2019; the paraphrase is fair).
  - Shumailov et al. (2023; "tails … disappear"); Tape-out; the Power wall.
- **Tips:**
  - ENIAC: 17,468 tubes, 150 kW (US Army; some sources say 174 kW, so "about 150 kW" is fine).
  - Six programmers chosen from the 80–100 women computers.
  - Landauer kT ln 2 (scales with T).
  - Romer 1990 ("a nonrival, partially excludable good").
  - Muennighoff et al. 2023 ("up to 4 epochs … negligible changes"); Lee et al. 2021 ("fewer train steps"); Kaplan; binning.
- **Paperclips:** 08 §2.1's correction of H is right: each tournament's payoffs are `Math.ceil(Math.random()*10)` ([main.js](https://www.decisionproblem.com/paperclips/main.js)).

### Prose and data numbers

- **ASHRAE (03 §1.3):** A2 35 °C, A3 40 °C, A4 45 °C, H1 25 °C. These are the allowable maxima. H1 is new in the 5th edition (2021), recommended 18–22 °C and allowable 15–25 °C ([ASHRAE card](https://www.ashrae.org/file%20library/technical%20resources/bookstore/supplemental%20files/therm-gdlns-5th-r-e-refcard.pdf)).
- **History:**
  - MIT Rad Lab closed 31 Dec 1945 ([MIT News](https://news.mit.edu/1996/radlab-1030)).
  - Iron Mountain records storage from 1951, in an iron mine near Livingston, NY.
- **Recent and AI-forecasting facts:**
  - Llama 3: 419 unexpected interruptions in 54 days.
  - DeepMind 2016: up to 40% less cooling energy.
  - Davidson & Houlden (2025): median r = 1.2, log-uniform 0.4–3.6 ([Forethought](https://www.forethought.org/research/how-quick-and-big-would-a-software-intelligence-explosion-be)). Their r (software doublings per doubling of cumulative research input) is exactly the game's r = ln m / ln g.
- **04's mathematics:** the closed forms (exponent −r/(r−1) = −2.41, about 9,600 cards, q = 0.75, 2²⁰) are correct.
- **Factorio facts:**
  - Decider AND/OR (FFF-384); 0.15 removed alien artifacts; roboport areas 50×50 and 110×110.
  - Spawn evolution thresholds 0.2/0.5/0.9; worm and biter HP; expansion every 4–60 min; groups of up to 200.
  - "Lazy bastard" is 111 items and "There is no spoon" is 8 h ([wiki](https://wiki.factorio.com/Achievements)).
  - Module numbers are right apart from the speed penalty (§2.3).
- **Grabby aliens:** fronts are visible before arrival for s < c (Hanson et al. 2021, [arXiv:2102.01522](https://arxiv.org/abs/2102.01522)).
- **Mercury:** 6.67× Earth's flux; polar ice.
- **Fusion power cell:** "stored as uranium hydride" is true (JET used uranium beds; ITER switched from ZrCo to depleted uranium).
- **Uranium:** U-235 0.7% and U-238 99.3%.
- **Other names and citations:**
  - Rosenthal (1979) is *Psychological Bulletin* 86(3):638–641.
  - 05 #11's alternatives exist: Diebold 1952 (Van Nostrand), Pease 1952 (*Sci. Am.* 187(3)), Harrington 1973 (Industrial Press).
  - Chinchilla's "20 tokens per parameter" is a fair derived ratio, not a quotation.

### Names that make claims

- **Combinators:** Bias unit, Arithmetic unit, Selector unit.
- **Modules:**
  - Comparator (a verifier; also a machine-shop gauge).
  - Coprocessor.
  - Learned and Distilled controller (teacher and student are distillation's own vocabulary).
- **Quality tiers:** Standard, Selected, Verified, Audited, Reference (inspection words).
- **Infrastructure:** Switch with 1/√n; Data lake; Rack ("19 inches wide, 42 U high").
- **Items:** Token ("One instance of one type": Peirce's type–token distinction); File drawer.
- **Other technologies:** *Inference speed* (perception latency really does limit a drone's safe speed); *Batch size*.

---

## 5. What is good and must not be lost

1. **The experiment line is Rosenthal verbatim.** Analysis yields exactly 5% Significant and 95% Null under α = 0.05. That is Rosenthal's (1979) "extreme view": "the journals are filled with the 5% of the studies that show Type I errors, while the file drawers are filled with the 95% … nonsignificant" (abstract, [doi:10.1037/0033-2909.86.3.638](https://doi.org/10.1037/0033-2909.86.3.638); quoted in [Scargle 1999](https://arxiv.org/pdf/physics/9909033)). So every Significant result in the game is a false positive, and the nulls go in the *File drawer*.
   - *Meta-analysis* (40 Significant + 5 Null → 41 Significant + 2 Null: the 40 are returned and 3 nulls are pooled into one more Significant result) is consistent. Rosenthal's fail-safe N, (Σz)²/2.706 − k, for 40 studies at z ≈ 2 is about 2,300 nulls, so 3 cannot overturn the pooled result.
   - Never raise P(significant) above α, and never explain it.
2. **The Dartmouth cost** ("two-month, ten-man", ten Memos at 60 s) is verbatim.
3. ***Stigler's law* on *Stored program*.** Protect it with the one-line exception in 08 §9.1 (§2.1).
4. **Good's proviso as the condition of *The last invention*,** and **Hofstadter's law firing on underestimates only.**
5. **Physics carried by mechanics:**
   - *Energy per operation*'s floor scales with absolute temperature (f = θ_K / 4,800 K), as kT ln 2 does.
   - *Dennard scaling* stops at 5.
   - *Process node* and *Research productivity* double in cost (Rock's law and Bloom et al., said only by the cost table).
6. **The returns setting.** r = ln m / ln g is the literature's r, the 1.2 preset is Davidson & Houlden's median, and the finite-time-singularity algebra is right.
7. **Model generation starts at 6, after the Fifth Generation.** A curiosity for H, *not* to cite: ICOT itself built a "Model Generation Theorem Prover" (MGTP; Fujita & Hasegawa, ICLP 1991; [ICOT museum](https://www.airc.aist.go.jp/aitec-icot/ICOT/Museum/IFS/abst/022.html)). The sense of "model" differs, so it would be a pun.
8. **Small true facts that reward the expert:**
   - Semaphores unlocks rail signals (Dijkstra took the word from railways).
   - The fusion cell's uranium hydride.
   - Binning as quality.
   - The off-switch game where "the machine gets no move".
   - The Licklider interim.
   - The telegraph → telephone → internet exchange.
   - The radar "Surplus from a wartime laboratory" (the Rad Lab closed on 31 Dec 1945).
9. **The low-background idea.** M4 makes it true in the mechanics too.

---

## Appendix: method notes

- **Extraction.** `extract.py` (technologies → `techs.json` and `techs_dump.txt`), `extract_items.py` (item, entity, enemy and resource descs), `textrules.py` (US spelling, never-list words, "you" and symbols in UI fields) and `yearcheck.py` (year against citation, and era end). All are in `/tmp/claude-1002/r3-accuracy/`.
- **Verification.** Four parallel verification passes covered early computing, AI classics, modern ML, and the prose and achievement claims. Every error and fix in §1–§3 carries its source. The §4 items were checked the same way, and their URLs are in `design/round3/accuracy-data/sources-log.md`. Nothing was accepted from memory alone. Claims no pass could confirm are named as unchecked in §2.5 (08 §13 row).
- **Reusable checks.** `design/round3/accuracy-data/` also holds `yearcheck.py` and `textrules.py`. Run them with `gamedev-python`, then re-run after the revisers' edits.
- **Not covered here.** Balance, tone and the ontology are other critics' lenses, except where an accuracy fix forces a balance re-run (M4; §2.3 *Microfluidic cooling*).

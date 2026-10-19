## 11. Calibration against Factorio 2.0

Raw cost per pack, computed the same way for both games (first recipe that makes each item; crude and crawl through *basic* processing, so divide both by ≈ 2.2 for full cracking). Factorio's column is computed from the 2.0 base prototypes.

| Pack | Factorio 2.0 | Here | Reading |
|---|---|---|---|
| Red | 2 iron, 1 copper | 2 iron, 1 records | Copper's red-science job goes to the archive |
| Green | 5.5 iron, 1.5 copper | identical | ISO |
| Blue | 12.0 iron, 7.5 copper, 1.5 coal, 83 crude | 12.6 iron, 7.5 copper, 3.0 coal, 1.5 quartz, **17 crawl** | The fab's acid replaces plastic; data is light in this era |
| Gray | 5.8 iron, 0.5 copper, 5 coal, 10 stone | 1.0 iron, 1.5 copper, **37 crawl** | No weapons: an evaluation pack is made of data |
| Purple | 52.5 iron, 19.2 copper, 11.7 stone, 3.3 coal, 148 crude | 48.2 iron, 8.3 copper, 6.7 quartz, 3.3 coal, 3.3 records, **148 crawl**, + 20 trainer-seconds | Crawl matches crude exactly |
| Yellow | 33.3 iron, 49.8 copper, 3.8 coal, 246 crude | 24.3 iron, 28.2 copper, 11.8 coal, 3.3 records, **148 crawl**, + 40 trainer-seconds | Checkpoints cost compute time, not processors. If round 3 wants the metal back, give the Trainer's checkpoint recipe 2 processors |
| White (per pack; a run returns 1000) | 42.5 iron, 69.3 copper, 5.0 coal, 528 crude | 44.4 iron, 69.0 copper, 14.9 coal, 5.8 records, 2.2 quartz, **286 crawl** | Metals match to 5% |

**Ratio cheat sheet (all transfer):** 3 cable : 2 logic-board assemblers. One wafer plant feeds one processor per second (as one plastic plant feeds one red circuit). Accelerator = blue circuit (10 s, 20 + 2 + 5 acid). 20 : 5 : 17 refinery : denoise : rephrase. Smelting 3.2 s, steel 16 s. Packs 5 / 6 / 24 (→2) / 10 (→2) / 21 (→3) / 21 (→3) s. Module crafts 15 / 30 / 60 s. Belts 15 / 30 / 45, inserters, poles, power: ISO. The one new rhythm is the checkpoint: **60 s in a Trainer**.

**Tuning knobs for round 3:** checkpoint time (compute share of yellow), datasets per checkpoint (data share), Benchmark yield (blue-tier data load), sulfur's coal cost (coal share), Trainer power.

## 12. Legibility rules (32 px on a belt)

1. **Two palettes.** Matter keeps Factorio's metals and board colours. Information is paper and drives: cream, manila, white sheets; grey drives with one coloured label. A belt's colour says whether it carries matter or information before you can read any icon.
2. **Families share one silhouette; type is colour, tier is one detail** (05's rule, Factorio's practice):
   - Papers: one sheet silhouette, Factorio's seven colours.
   - Modules: Factorio's card and colours (blue speed, orange productivity, green efficiency); chevrons for tier.
   - Envelopes: Benchmark (green check grid) and Adversarial set (hazard stripe).
   - Drives: blank Drive, Dataset (cyan label), Checkpoint (orange hexagon), filled drives (a band in the fluid's colour).
   - Chips: green board with a tube → black DIP chip on red board → gold-lid package ringed by memory stacks.
3. **A hexagon means weights.** It appears on the Checkpoint, both controller families, the Researcher and the payload, and nowhere else; coprocessors (hardware only) have none.
4. **Fluids.** Data runs in flat black cables with a content stripe, physical fluids in grey pipes. Data fluids copy oil's brightness order so "heavier is darker" transfers: Crawl near-black with static, Junk muddy brown, Text amber, Prose pale ice-cyan.
5. **Ore extremes.** Quartz is the brightest raw item, Silicon the darkest plate (violet sheen). Records are the only soft-edged raw item.
6. Every sprite is checked at 32 px against its belt neighbours before it is accepted.

## 13. Deviation register

| # | Change | Tag | What it buys |
|---|---|---|---|
| 1 | Quartz plays stone; silicon is its furnace product; no stone brick (recipes use quartz or concrete) | BEND | Sand → silicon → chips is the subject; quartz replaces stone instead of joining it |
| 2 | Archives (records) as a fifth basic ore, at towns | BEND | The data wall is literal depletion, and towns become destinations (B L3) |
| 3 | Exchanges at towns, decaying to the rate of new writing | BEND (placement) | Oil's decay curve with a true reading (B L8) |
| 4 | Data lines never connect to pipes | BEND | Coherence and legibility; costs four entities |
| 5 | Coal chemistry supplies sulfur, acid and lubricant | BEND | Keeps Factorio's physical chemistry without a second oil chain |
| 6 | Wafer replaces plastic in the red circuit; batteries replace plastic in the rack | BEND | The fab and the rack in the late game; plastic had no theme |
| 7 | Data smelters (Keypunch, Tokenizer): a second furnace family, two tiers | BEND | Transcription is the 1945 job and tokenization the 2015 one |
| 8 | Checkpoint item; models as catalysts (Kovarex shape) | BEND | Non-rival weights without breaking conservation (B L6); one good model makes accelerators the binding input |
| 9 | Trainer (new building) | BEND | Training is the subject's central act and deserves a building and a power bill |
| 10 | Modules named as control electronics | BEND (names only) | Literal in every machine (B L11); numbers ISO |
| 11 | Proceedings made of benchmarks and adversarial sets, so it follows blue | BEND | The military pack becomes evaluation (B, F, H) |
| 12 | Preprint and Model card consume checkpoints | BEND | Papers report trained models; data demand scales with the era |
| 13 | No weapons, ammunition, turrets or armour | BREAK (F's and B's) | No natives on this plane |
| 14 | No solid, rocket or nuclear fuel | BEND | Oil products; trains burn coal, which in 1945 they did |
| 15 | Construction agents run planners (no checkpoint); logistic agents need one | BEND | The 1970s planning robots and the 2010s learned agents both happen |

Everything else is ISO: belts, inserters, splitters, undergrounds, chests, poles, steam, solar, accumulators, nuclear, trains, signals, landfill, concrete, cliffs, repair packs, circuit network (renamed units), module and beacon numbers, the silo's 100 parts and 1000-pack return.

## 14. Hooks and open questions for other agents

- **B.** Adopted: towns host archives and exchanges; information only on carriers; copying = catalyst + blank carrier; compute is a rate; modules are control electronics; L9 staffing. Proposed numbers: 0–1 archive per town, 1–4 exchange taps.
- **E.** Appendix A is a gating skeleton, not a tree. Hard requirements: tokens and the keypunch at start; silicon and solar at green; coal chemistry, data lines and the data refinery by late green (where oil processing sits); the Trainer at blue; quality filtering at blue; Switches and Assembling machine 3 at purple; racks before yellow; the frontier run needs all five main packs.
- **F.** Heat is power (B L4/L5), so the emissions column is only Factorio's reference. Computing machines that throttle: Tokenizer, Data plant, Data refinery, Trainer, Seminar, Frontier cluster. The Keypunch is mechanical. F's (1 − s) multiplier applies to crawler output. The cooling tower is F's building.
- **G.** The Researcher recipe and its staff-equivalents. Frontier-cluster power: keep Factorio's 4 MW, or raise it (suggested 40 MW active) so the run is visibly power-bound. Infinite techs that scale learned-controller productivity are the RSI lever (§6).
- **H.** Adopted H's ladder and names. Differences, for H to rule on:
  - Assembling machine 1/2/3 kept. A Tabulator, Computer or Cluster cannot press a gear (B's bar). If an era name is wanted: Machine shop → Transfer machine → Robot cell.
  - Fractions Junk / Text / Prose, not prose / code / junk. Code has no crackable role; it can return as a second well type later.
  - Benchmark, not Label, in the sulfur slot. The held-out set is what is used up; labels are inside it.
  - Data line, not Fiber: copper first, glass later.
  - The Trainer is not the chemical-plant analog; the Data plant is.
- **I.** Typed fluid ports (pipe vs line) in entity GUIs, and "(returned)" on catalyst ingredients in recipe tooltips, as Factorio shows Kovarex.
- **Later, optional.** Quality as best-of-N with a verifier (H's tiers Standard / Selected / Verified / Audited / Reference; recycler = Verifier). A gated media archive (images and video, B L10) as a uranium-like ore in the yellow tier. Code as a second well type.

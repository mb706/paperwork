# Claude's own notes (written before reading the agent reports)

## Principle
The meme's "combiner thing" diagram *is* the genre, and it's the good part. So: keep Factorio's mechanics, choose the theme for (1) legibility, (2) **rhymes** — places where the real story of AI already has the same structure as a Factorio system, so the mechanics feel motivated instead of relabeled — and (3) a few deviations only where the theme adds fun Factorio can't have.
Test for every mapping: does a Factorio veteran's intuition (ratios, buses, belts, "add more drills") transfer unchanged?

## The key structural insight: rival vs. non-rival
Factorio already splits the world into **rival goods** (items: consumed, conserved, moved on belts) and **non-rival knowledge** (the tech tree: researched once, applies everywhere, forever). That is exactly the economics of research.
- Items = rival inputs and work products: compute-hours, chips, power, data, drafts, experiments, trained checkpoints, printed papers.
- Tech tree = know-how (backprop, attention, RLHF …). This answers the user's question: "technology" is not an item. The *artifact* is an item (a GPU, a trained model); the *idea* is a tech node, just like Factorio's "Electronics" tech vs. the "electronic circuit" item.
- Science packs = papers/results; labs = the venues where the field digests them (reading groups → conferences → journals).
- Non-rivalry of artifacts like model weights: Factorio already has **catalyst recipes** (Kovarex returns its U-235). "Fine-tune" recipes that take model weights + data + compute and return the weights plus outputs express "copying is cheap" without breaking conservation of mass. ISO.

## Candidate frames (substrate + player + time span)
1. **Industrial AI stack on a physical world** (a procedural continent, not literal Earth). Resources: quartz sand, copper, rare earths, coal/uranium, water, *data wells* (raw corpora), *talent springs* (universities, renewable like oil wells). Player: a founder/engineer avatar. Time: 1940s computing → singularity, via tech tiers. Highest isomorphism; endless map preserved; academia lives in the science packs and the tech tree.
2. **Map of ideas**: regions are fields, patches are veins of open problems that deplete ("ideas are getting harder to find" is literally ore depletion), fog = unknown unknowns. The freshest option, but physicality and belt legibility suffer, and chips and power don't fit.
3. **Seed AI in a compute substrate**: the player *is* the AI, so RSI is the whole game; malware is the enemy; heat/entropy is pollution; the net is the endless map. Coherent, but it loses the post-WWII arc and drifts toward Tron cliché.
4. **Eras as planets** (the Space Age template): Academia → Industry → Cyberspace → Orbit. The most ambitious and the biggest scope risk — better as an expansion path *after* frame 1 works.

Lean: frame 1 for the base game. Frames 3 and 2 later become post-AGI "planets" (an expansion), the way Space Age extends Factorio.

## Rhymes (the gold list)
| Factorio | AI research | Note |
|---|---|---|
| Crude oil → refinery → cracking | Raw web crawl → data refinery (dedup, filter) → curated corpora; cracking ≈ synthetic data / distillation | "Data is the new oil" is already a meme |
| Green → red → blue circuits | Transistors → ICs → GPUs/accelerators | Factorio's electronics chain is the AI hardware chain |
| Steam → solar → nuclear | Datacenter power, including labs buying nuclear plants | Literally true |
| Speed / productivity / efficiency modules | Capability boosts (more pollution) / scaling tricks / safety measures | **Module trade-offs are the alignment tax** |
| Beacons | Knowledge spillover: Bell Labs, PARC, a star advisor boosting nearby groups | |
| Ore depletion | Low-hanging fruit runs out | |
| Construction/logistic bots | AI agents doing the work | Automation of automation = AI automating R&D: the late game *is* RSI |
| Infinite research-speed tech | Make it compound → the intelligence explosion as the climax | The tech tree finishing itself ever faster |
| Rocket silo + launch | Frontier training cluster + the AGI run | |
| Coal in the burner phase | Coffee ("a mathematician is a device for turning coffee into theorems" — Rényi) | Easter egg |
| Spoilage (Gleba) | Publish or perish: results go stale / get scooped | Space Age-style twist |
| Quality / recycler | Benchmark tiers / distillation | |
| Evolution factor | The world's capability level outside your control | |
| Blueprints | Open-source repos / reproducible methods | |
| Circuit network | Programming and orchestration | |

## Antagonists
Options: peaceful mode; software **bugs → worms** (Factorio literally has worms); rogue/feral automation driven by unaligned optimization pressure; competitor labs (too smart, cringe-prone); regulation as creeping no-build zones; AI winters as periodic temporal shocks; grabby aliens as a timer.
My favorite: **pollution = unaligned optimization pressure**, emitted by capability-heavy production (speed modules raise it, "safety" modules lower it), diffusing across the map and absorbed by oversight infrastructure, triggering feral agents that attack your infrastructure; evolution rises with the global capability level. Defense: red-team turrets, sandbox walls, interpretability scanners. The progression "bugs → worms → agents" keeps it witty. Risk: preachiness — keep it purely mechanical (no lectures), make the alignment tax a genuine optimization choice, and keep a peaceful-mode switch.

## Novel elements worth a careful hill-climb
- **RSI climax**: compounding research speed at the end of the tech tree.
- **Rewind**: scrub the deterministic simulation back to see where a jam started.
- **Compute as a second network** (electricity → datacenters → a compute grid that research buildings consume): a BEND the theme strongly motivates, since compute is *the* resource of AI.
- **Spoilage of results** as a mid- or late-game twist.

## Open problems
- How academia (people, ideas) appears without "people on belts": talent as a fluid from universities (hiring pipelines), as fuel, or abstracted into building upkeep. Moving humans as items reads grim.
- Visual legibility of abstract items: render them as physical artifacts — paper stacks, punch cards, tape reels, drives, chip trays, glowing checkpoint crystals.
- Endless map vs. Earth realism: use a fictional procedural continent.

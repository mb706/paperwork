# 02 — World and player (Opus lens)

**TL;DR.** I'd keep the world physical and endless, and keep the avatar who walks around. Factorio's own arc of automating yourself away can then tell the human → AI story.

My recommended frame is **A "Frontier"**:
- **World:** a research reservation, starting in 1946.
- **Player:** a researcher whose line of successors ends as an AI agent.
- **Ending:** returns to research rise above 1, so takeoff is a real change of phase. "Returns to research" here means how much each unit of research speeds up further research.

The "space of ideas" goes where it is cheap and strong. It is the research screen now. Later it becomes abstract surfaces in the style of Space Age (frame D).

## 1. What the map does in Factorio

Any substrate has to do these jobs. "Endless exploration" is only the part you see.

1. **Inputs exist only in patches.** So they need logistics.
2. **Distance costs infrastructure:** belts, poles, pipes, rails. Layout matters, and trains emerge.
3. **Space is scarce locally but not globally.** You trade compact builds against sprawl, and the main bus gives way to city blocks.
4. **Patches run out.** Outposts move and the rail network grows.
5. **Texture:** water, cliffs, trees, nests. No two bases look alike.
6. **The avatar's locality fades.** Early on you work with your hands. Later, bots and remote view make you an architect.

Pollution ties growth to the environment.

**Test for any substrate:** do these jobs hold *literally*, so the player's physical intuitions predict the rules? Or only *by fiat*?

## 2. Candidate substrates

| Substrate | What exploring means | Patches, and why they run out | Terrain and obstacles | Verdict |
|---|---|---|---|---|
| **Physical frontier** (Earth-like; the industrial AI stack) | Choosing sites for ore, water, cold and sun. That is literally how datacenters get sited | Ores run out. **Data wells** decay to a floor, like crude oil: once the stock of human text has been scraped, only the new flow remains. That is the real "data wall" | Lakes (cooling, pumps), cliffs, forests (paper), cold north, sunny south | **ISO.** All six jobs hold literally |
| **Campus / office** | Nothing to explore; you buy more floor space | Supply crates | Walls, rooms | **BREAK**: no frontier. Big Pharma works like this, and it is a smaller game for that reason. Use it only as the opening clearing, or as a Factorissimo-style interior later |
| **Idea landscape** (fields as biomes) | Discovery. Fog of war is ignorance; radar is a survey paper | Open problems in each field. Patches run out as the low-hanging fruit is picked (Bloom et al., *Are Ideas Getting Harder to Find?*) | A sea of ignorance (landfill = a new formalism). Cliffs are impossibility theorems; cliff explosives are "simplifying assumptions" | Same mechanics, but a **BREAK** in intuition. Jobs 2–3 hold only by fiat |
| **Cyberspace / compute** | Crawling | Datasets run out | Firewalls, paywalls, robots.txt | **BREAK.** There is no physical bottleneck, it is a Tron cliché, and nothing exists before about 1970 |
| **Eras as planets** | A fresh map for each era | — | — | **BREAK.** Travel is one-way, so the persistent base you keep rebuilding is lost. Eras belong in tech tiers instead |
| **Domains as planets** (fab island, the Web, orbit) | Space Age structure | Each planet has its own mechanic | Per planet | Same structure as Space Age (ISO). This is the expansion layer |
| **Inside the model** | Your own network | Features in superposition are mixed ore; a sparse autoencoder (SAE) is the recycler | The residual stream is a pre-built main bus | A wildcard surface for late game |

**Time span.**
- *All of science* has too many eras for about six tiers, and AI ends up as a footnote.
- *2012 → singularity* is all GPUs, with no primitive start.
- *1946 → singularity* gives about six eras for about six tiers. Its burner phase writes itself: relays, punched cards, vacuum tubes.
- Show the historical year of your newest tech as flavor, e.g. "9 years ahead of history". There is no clock pressure.

## 3. Candidate identities

| Identity | What it keeps | What it loses | Verdict |
|---|---|---|---|
| Researcher or founder avatar | Hand-crafting, walking, the burner phase, a sense of scale | One person can't live from 1946 to the singularity (fix below) | **ISO** |
| Institution / invisible hand | The late-game feel | The first five hours, and the arc of replacing yourself | **BREAK.** You get there anyway: bots plus remote view *are* the invisible hand |
| Seed AI | A coherent bootstrap; recursive self-improvement (RSI) in the first person | The history of academia and industry. It also feels derived from Universal Paperclips, and if humans exist, they become the biters | Works only on an empty planet (frame C) |
| Human → AI transition | Everything | Nothing, as long as it uses systems that already exist | **ISO**, plus narrative. Recommended |

**Key observation: Factorio already acts out the Bitter Lesson.** That is Sutton's point that general methods which scale with compute beat clever hand-built ones.

| Factorio system (unchanged) | Human → AI reading |
|---|---|
| Hand-craft queue | You are a human computer. This is GOFAI (classic hand-coded AI): clever and manual, and it doesn't scale |
| First assembler | The Tabulator. Historically, the first computers replaced *human computers*. So the game's first automation step is history's first automation of thinking |
| Construction bots + blueprints | Drones, later agents, carrying out your designs |
| Remote view | Your presence becomes networked |
| Infinite research | Self-improvement with diminishing returns: each level costs more for the same fixed gain |
| **New endgame** | Returns to research rise above 1, which means takeoff (**BEND**) |

The theme tells its story without new systems; only the last row is new.

**Lifespan fix.** The avatar is a *line of successors*, not one person. Its sprite changes with each era: a 1946 suit and slide rule, a 1975 beard and printout, a 1998 laptop, a 2022 fleece vest, and finally an agent chassis. This is cosmetic only.

## 4. Four coherent frames

### A — "Frontier": physical reservation · human → AI successors · 1946 → singularity

**Premise.** A remote research reservation in the style of Los Alamos, empty by design. The outside world exists offscreen. It touches the map only at features: archives, cable landings on the coast, and possibly universities as sources of talent.

**Map.** Like Nauvis, plus a *climate compass*:
- The colder north makes cooling cheaper.
- The sunnier south favors solar.
- Coasts give water and cable landings.

This is a **BEND**, because Nauvis biomes are mostly cosmetic. It turns every expansion into a siting decision, which is the real game of the 2020s: power, water, cooling, land. Rare inputs such as tin for EUV and gallium sit in small, distant patches. Patches get richer with distance from spawn, as in Factorio (ISO).

**Tiers and eras.**

| Factorio tier | Era |
|---|---|
| Burner | Relays and punched cards |
| Electric | Vacuum tubes, then transistors |
| Oil | Integrated circuits and the Net: photoresist, plastics, data refining |
| Robots | Drones, GPUs |
| Nuclear | Gigawatt campuses (compare the Three Mile Island restart) |
| Rocket | Takeoff |
| Space Age | Orbit (heat leaves only through radiators, since space has no convection), the Moon, then Mercury taken apart for a Dyson swarm. Dyson Sphere Program shows this endgame is fun |

**First 10 minutes.** These follow Factorio beat for beat (ISO):
1. Hand-mine copper, iron and coal, and chop trees for paper. This is a **BEND**: wood matters early, because papers are made of paper.
2. Hand-craft relays and punched cards.
3. Place steam shovels and kilns.
4. A burner **Tabulator** makes red **Computation** packs from cards and a relay.
5. The packs feed a **Seminar room** (the lab), which researches *Stored-program computer*.

**Hour 20.**
- City blocks on rails.
- Fab blocks: quartz → wafer → lithography (photoresist from the oil chain, tin plasma for EUV) → die → packaging with HBM → accelerator.
- Crawler outposts on coastal cable landings feed a data refinery, which splits raw crawl into prose, code and spam. A synthetic-data loop runs alongside it.
- Training clusters turn tokens and power into **checkpoints**. Checkpoints feed the labs and **deployment servers**. A deployment server is a beacon: it gives nearby machines a boost without being used up. That brings in the fact that information can be copied, through an existing system.
- You spend most of your time in remote view.

**Endgame.** The last research is *Automated research*. After it, capability raises the research rate, and research raises capability. If that loop is tuned to grow faster than exponentially, the singularity is a literal blow-up in finite time, not an arbitrary goal. The amount of compute built before the unlock (the "hardware overhang") sets how fast takeoff goes. So the debate is a mechanic, not narration.

**Pressure.** There are no natives. Use peaceful mode, or an impersonal pressure: heat pollution that slows hot chunks, or hype that triggers an AI winter. The pollution lens decides.

**Risk.** It could feel like "Factorio with chips", because ideas appear only as science packs and tech names.

### B — "Noosphere": idea landscape · thinker avatar · all of science → AI

**Map and items.** Biomes are fields: Logic, Probability, Optimization, Neuroscience, Linguistics. You spawn in "textbook country". Items are glyph tokens, such as ∑ lemma, ∇ gradient and ⊢ proof. Power is compute.

**Making geography matter.** Interdisciplinary recipes run only in machines that straddle a border between two fields. This works like Space Age's surface conditions, applied per field, and it makes borders the most valuable land. **BEND**.

**First 10 minutes.** Hand-gather observations on a Probability patch, and derive lemmas at a burner **Chalkboard**.

**Hour 20.** "Trains of thought" carry results between distant fields to arrays of theorem provers.

**Where it fails.**
- Distance has nothing to refer to: why is a prover 30 tiles from Logic worse off? So the layout puzzle loses its intuitions.
- Chips, power and data, which is the Bitter Lesson story, collapse into an abstract power grid.
- The puns (lines of inquiry, the sea of ignorance) are where cringe gets in.
- Nothing lives there.
- It drifts toward shapez: a fine genre, but a lighter one, and not Factorio.

### C — "Seed": empty exoplanet · you are a von Neumann probe's AI · landing → daughter probes

**Premise.** Factorio's premise, one to one: crash, bootstrap, launch. The natives are a local ecosystem, so biters stay as they are (ISO).

**RSI in the first person (BEND).** Every bit of compute you build raises your own crafting speed, reach and research speed.

**First 10 minutes.** You have one manipulator arm, and it is slow because your onboard compute is tiny.

**Hour 20.** Compute at planetary scale, and research that speeds itself up.

**Ending.** You launch daughter probes, as in Hanson's "grabby aliens" model.

**Where it fails.** It drops the 1946 → labs history you chose, and the theme is thin.

**Best use.** As A's epilogue, where you play as the AI that A produced.

### D — "Stack & Surfaces": A's home world + abstract planets reached by Uplinks

**Home.** Frame A, unchanged.

**Mid-game: The Web.** This is the Fulgora equivalent: islands of signal in a sea of spam.
- Crawl rigs mine "raw crawl".
- Recyclers (filtering, deduplication) return prose, code, math or spam at random, by fixed odds.
- Quality means data quality.
- At hour 20 you balance recycler outputs, delete spam, and send curated token drives home.

**Late game: Latent Space.** This surface is the inside of your own model.
- A pre-built residual-stream bus crosses the map. In Elhage et al.'s framing, the residual stream really is a main bus.
- Features in superposition are mixed ore, and a sparse autoencoder is the recycler.
- The output is interpretability results, which unlock efficiency techs.
- Never turn alignment into widgets. "Make 1,000 alignment packs" would make the problem look trivial, and this player in particular would notice.

**Travel.** An Uplink (like the rocket silo) and a Downlink.

**Where it fails.** It costs a lot of content, and shipping crates into cyberspace is metaphysically odd. Space Age did prove that several surfaces can be fun.

## 5. Scorecard against Factorio's sources of fun

●●● strong · ●● adequate · ● weak

| Source of fun | A Frontier | B Noosphere | C Seed | D Stack & Surfaces |
|---|---|---|---|---|
| Layout puzzle with recipes that make intuitive sense | ●●● | ●● | ●●● | ●●● |
| Automating yourself away | ●●● | ●● | ●● (you rise; you aren't replaced) | ●●● |
| Patches run out, so you expand | ●●● | ●●● | ●●● | ●●● |
| Exploring has a purpose beyond ore | ●●● | ●● | ●● | ●●● |
| Outside pressure | ●● | ● | ●●● | ●● |
| Shape of the endgame | ●●● | ●● | ●●● | ●●● |
| Resonance for an ML expert | ●●● | ●● | ●● | ●●● |
| Items legible on belts (media, chips, wafers vs glyphs) | ●●● | ●● | ●●● | ●●● |
| Can be built as a vertical slice | ●●● | ●● | ●●● | ● (●●● if A comes first) |
| Novelty beyond Factorio | ●● | ●●● | ● | ●●● |

## 6. Recommendation

**Build A, and let D (or C) be its Space Age.**

1. **It is the top of the hill.** Only a physical substrate keeps all six of the map's jobs literal. Water, cold, sun and distance mean what the player already thinks they mean.
2. **It is also the subject's real substrate.** Recent AI progress has been held back by chips, power, cooling, land and data. An ML expert will recognize datacenter siting and the data wall as real, and that recognition is where the wit comes from.
3. **The identity costs almost nothing.** Factorio's arc already is the human → AI arc. The one real deviation is the endgame, where returns to research rise above 1.
   - Whether they do is a central question in takeoff models. Here, takeoff speed comes out of the player's own factory (the hardware overhang). So the game acts out the fast-vs-slow debate without taking a side.
   - It also replaces Factorio's weakest phase, the megabase plateau, with a change of phase.
4. **Endless exploration survives.** It gains a second reason to explore, siting, on top of ore.
5. **The idea-space wish is placed, not dropped.**
   - The research screen becomes the map of ideas, with no change to the UI. Techs are named after real papers: *A Logical Calculus of the Ideas Immanent in Nervous Activity*, *Attention Is All You Need*.
   - Abstract surfaces arrive once the base game is proven. That is where Space Age spent its novelty budget.
6. **Vertical slice:** 1946–65 only. Burner and electric tiers, red and green packs, steam power, an endless map, peaceful mode.

**Tone rule.** Use one literal joke per system, and put it in a tooltip. An example: a burner-era Mathematician's Office that runs on coffee, after Rényi's "a mathematician is a device for turning coffee into theorems". Play the takeoff straight: the production graph goes vertical, and nobody narrates.

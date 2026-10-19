# 06 — The expansion layer (outline only)

*Round 4 revision (R4-world) of R2-W's outline. DECISIONS §14 asks for an outline: surfaces, one twist each, their papers, how they connect; no full data. Canon: B L14 and L16, C §4 (the Stacks), G §5.4 (the bridge), A §9 #10 (one twist per surface) and A §7 (no late-game waiting). Round 4 corrects Mercury's resources (R3-accuracy §2.5) and Scooped's availability (R3-impl N7). Paper names are placeholders for H and R4-ui.*

## 0. Why there is an expansion at all

After victory, research is **energy-bound** (04 §10):
- the software is at its ceiling;
- *Energy per operation* approaches a floor set by temperature (f = T / 4,800 K).

The continent's power and matter are finite and its ground is warm, so the only way up is off it.

In the base game "takeoff" is a metaphor. In the expansion it is literal: **its first building is a launch site** (B L16).

Every surface is a literal place reached by literal transport. No abstract planets (DECISIONS §3). AI-for-science content goes **where its subject actually is**:
- biology where life is;
- materials where energy is abundant;
- physics where it is cold;
- data where the records are.

**The rules each surface obeys:**
- **One twist** that relearns one Factorio habit, as each Space Age planet does (A: planet mods that add one constraint to untouched vanilla are the liked ones). Everything else is ISO.
- **No timer that the player can only wait out** (A: Warptorio's "you mostly wait"). Anything that moves on its own must be something the player can build ahead of, or around.
- **Runaways stay on the home surface** (F §4). Deployment is a continental act.

## 1. The surfaces

| # | Surface (Space Age slot) | What it literally is | **The twist** | Main resources | Paper (placeholder) | Exports home |
|---|---|---|---|---|---|---|
| 0 | **Launch site** (the base game's last building) | A launch complex on the continent | — (ISO: Space Age's rocket silo and cargo pods) | — | — | — |
| 1 | **Orbit and platforms** (space platforms) | Platforms in orbit: sun without night | **Vacuum: radiators are the only sink.** No ground, no air, no Newton cooling. A platform's heat leaves only through radiator area, P = ε·σ_SB·A·(T⁴ − T_bg⁴) (heat's law, 03, with the field removed). Radiators are the platform's pollution control (B L16) | Asteroid chunks (ISO): iron, carbon, ice | none; platforms are transport, as in Space Age | Orbital compute (cold-sided, radiator-limited) |
| 2 | **The Stacks** (Fulgora) | A national legal-deposit repository in an old salt mine under the continent, reached by a shaft lift, not a rocket. Every published work on the continent must arrive here. Shelved in accession order (C §4) | **x is accession date, and the Present moves.** Shelves of 16 tiles per field-year; the newest shelf is the loading dock. East of it are empty halls you can build in before material arrives (C §4.2) | Uncatalogued records (Paper, Tape, Disk, Web and Stream bands); Fresh records at the Present | **Provenance** (teal, C §4.6) | Held-out sets (spoil as the Present moves on); corpora sorted by band |
| 3 | **Biology** (Gleba), on the home continent | Wet labs beside forests, lakes and soil: living samples, where life is (B L16) | **Spoilage.** Cultures and samples perish (Gleba's rules unchanged). The only place in the game where anything rots, because only living things do | Samples from forests, lakes and soil (ISO-style patches, renewable as trees are not) | *Protocol* (placeholder) | Designed enzymes and materials; the *Self-driving labs* line's physical half |
| 4 | **Mercury** (Vulcanus) | The innermost planet: sunlit plains at 6–7× the continent's solar flux; permanently shadowed polar craters holding ice | **Power is launched, not built.** Mass drivers fling collector statites into the swarm, and each one launched adds fixed power to Mercury's grid forever (the Dyson swarm, A's Dyson adopt). There are no generators and no fuel | Regolith (silicon, magnesium, sulfur; little iron: MESSENGER found the surface iron-poor, the iron is in the core), polar ice | *Ephemeris* (placeholder): the positions of the swarm | Power-dense products: fabricated accelerators, heavy materials |
| 5 | **A cold outer moon** (Aquilo) | An icy moon at about 40 K | **Heat is the input; compute is the heater.** Mechanical machines freeze without heat (Aquilo's rule). Computing machines run near the Landauer floor (f ≈ 1/120), and their waste heat keeps the base alive. The home continent's pollutant is this surface's fuel | Ice, ammonia, cryogenic gases | *Data release* (placeholder): physics in the cold, cryogenic detectors and superconductors | Cheap compute: the place where System cards are written for the least energy |
| 6 | **Interstellar** (the finale; Space Age's deep-space slot) | Neighbouring star systems, light-years apart | **Light-lag.** No remote view, no ghosts, no help from home after launch. A seed builds only from its blueprint library through its Constructor (04 §2.5; A §3.3: the only build tool, BREAK) | Whatever the system has | — (the finale is scored, not researched) | — |

## 2. How they connect

```
Continent ──launch site──> Orbit / platforms ──platform routes──> Mercury
   │  │                          │                                 │
   │  └──shaft lift──> the Stacks └──platform routes──> cold moon <─┘
   │
   └── Biology (on the continent itself)

All surfaces ──(after their papers)──> Seed launcher ──> interstellar seeds
```

- **Platforms (ISO with Space Age)** carry cargo between orbit, Mercury and the moon. The player rides them (B L14: from overseer to passenger).
- **The Stacks is entered by a shaft lift**, an inter-surface cargo elevator on the continent: Space Age's cargo-pod logic pointed downward. A repository is not in the sky (C: "on the same physical world").
- **Biology** is a production line on the home continent, unlocked by its own technologies after victory. It has no separate surface, because life is here.
- **Each surface's paper** gates the next surface's technologies. All four, plus System cards, gate the Seed launcher, as Space Age's promethium science gates the end.
- **Energy per operation** ties them together. Its floor follows the site's temperature, so the same technology is worth more on the moon than at home: a reason to ship the compute there, not a rule.

## 3. Notes per surface

### 3.1 Orbit and platforms

- Platform heat uses 03's emission rules (every joule used is heat; thermal generators reject 2 × their output, 03 §1.1) with the field replaced by a single platform-wide pool and radiator entities.
- Compute in orbit is limited by radiator area. Sunlight has no night, so solar is steady, ×1.4 the continent's peak.
- **Optional lead from C §6:** a frontier training run as a platform trip. The route is training steps, hazards are loss spikes and hardware faults (Llama 3's 419 interruptions), and arrival is convergence. Not adopted; listed so it is not lost.

### 3.2 The Stacks (C §4, adopted with A's guard)

- **Mining and sorting (C §4.3–§4.4).** Scanners (drills) mine shelves. The Cataloguer sorts records into Text, Code, Image, Labels, Junk and Synthetic by band, using Fulgora's recycler shape.
- **The quality loop.** Space Age's quality loop is data cleaning.
- **The synthetic share at deposition** is s = min(0.9, 0.1 × model generations deployed since the deployment era): the home world's σ, drawn as a stripe on the floor.
- **Held-out sets** come only from Fresh records at the Present. They spoil in exactly the time the Present takes to cross one shelf. This is the one honest use of the phrase "time travel" in the game: a model tested on data from after its cutoff (C §4.5).
- **Mains power:** fixed 20 MW per substation, one per ten shelves (C §4.7). Rationing is the puzzle.
- **A's risk and its answer.** C's late brake, verification gated by held-out sets at the Present's rate, could become a wait. Three things keep it a building problem:
  1. It gates only the optional top quality tiers (Audited and Reference verification, and the monitors that face tier-4 runaways), never progress.
  2. Fresh-record intake scales with how much of the dock's 400-tile width the player covers. The Present also speeds up as the field's W rises, from 0.5 to 2–3 tiles per minute in the field's own takeoff (C).
  3. A slow escape valve: *Generated held-out sets* (self-play) at 10× cost, capped at Audited.
- *Synthetic detection*'s false-positive rate (10%, lowered by the infinite *Detector calibration*) lives here, where C put it. The base game's detector is ideal (01 §7.4).

### 3.3 Biology (on the continent)

- Spoilage applies only to this line. The base game's single spoiling item is Scooped's, an opt-in setting that is always on in Race (03 §5).
- **Products** are materials and enzymes that other surfaces need: catalysts for Mercury's thin films, cryoprotectants for the moon. That gives the line exports, not just a paper.

### 3.4 Mercury

- **The swarm grid (DSP's Dyson sphere, adopted for the expansion by A).** Each statite launched adds fixed MW to the grid.
- **Siting** is between the sunlit plains, where the power is, and the polar craters, where the cold is (θ ≈ −170 °C). The climate compass returns at planetary scale.
- **No moving terminator.** A habitable band that walks would be a treadmill.

### 3.5 The cold moon

- The inverse of home. Pipes and machines need heat (heat pipes, Aquilo's rule), computing machines supply it, and *Energy per operation*'s floor there is 1/120 of full power, about a seventh of the continent's (f ≈ 0.054–0.064, 04 §10).
- "Physics in the cold" (B L16): superconducting magnets and cryogenic detectors. Its paper gates the seed's propulsion and power.

### 3.6 The finale: seeds against a grabby frontier (C §6; brainstorm 03; A §4.2)

- **Seeds.** You send seeds: a blueprint book and a kit, from a Seed launcher. Each lands in a neighbouring system and builds only from its blueprints through its Constructor. Light-lag forbids remote view.
- **On landing:** `Landed. Blueprint library: 1 entry.` (H). A seed's first build is a main bus.
- **The frontier.** A grabby civilization's expansion front advances at a fixed, visible fraction of c. This is C's sweeping-frontier win condition, moved here, where the moving line is physics.
- **Scoring** (A's Nullius adaptation). Each settled system is scored on several inspectable conditions of a self-sustaining base: power positive, a working seed launcher, a stocked blueprint library. The scoring is deterministic and previewable before launch.
- **Against waiting.** The race is decided by how fast seeds are built and launched. The frontier's speed never changes, so there is no timer to sit out.
- **Not adopted, kept as a candidate (A §6):** drifted seeds whose own run report infers another objective. It needs H's ruling on the callback (P6).

## 4. Order of work (for later rounds)

1. Launch site and platforms (Space Age's engine work).
2. The Stacks, which reuses the base game's data chain and needs no new transport.
3. Mercury.
4. The moon.
5. Biology.
6. The finale.

Each surface ships with its one twist, its paper and its exports, and nothing else new (A §9 #10).

## 5. Objections

1. **The Stacks' access by shaft lift** places a Fulgora-slot surface under the home continent. DECISIONS lists it after orbit and platforms. I read that list as content, not route order, because a legal-deposit repository is literal only on the ground (C, B L16).
2. **Biology on the continent** is not in DECISIONS §14's list. It is B L16's "AI-for-science content goes where its subject actually is", given Gleba's slot. Drop it if the expansion should have exactly the five places DECISIONS names.

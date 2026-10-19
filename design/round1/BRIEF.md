# Brief for design agents (round 1)

## Who and what
- **The user** (the only player): an academic in AI/ML, somewhat in the LessWrong sphere (AI takeoff, intelligence explosion, singularity), and a long-time Factorio player. They know Factorio 2.0, ML and the AI-safety discourse deeply; ideas must hold up to that.
- **The goal**: a single-player 2D browser game that is fun *for the same reasons Factorio is fun*, themed around AI research: academic and industry-funded research → big labs → recursive self-improvement → singularity (and beyond, as an expansion layer).
- **The builder**: Claude (an AI). TypeScript + WebGL2 in the browser, a deterministic fixed-tick simulation, pre-rendered Blender sprites and SVG, procedural/MIDI audio.
- **The UI**: Factorio's UI, menus and keybindings will be copied faithfully.

## Design principles (from the user)

1. **"Near the top of a hill most paths lead downhill."** Factorio is a proven local optimum, so keep its mechanics and even its numbers. A reskin is cheap and orthogonal to what makes Factorio fun. Deviate only deliberately, where the theme makes the game *better*. Tag every proposal:
   - **ISO**: Factorio's mechanic, kept.
   - **BEND**: a small, deliberate deviation.
   - **BREAK**: a large deviation.
   
   Justify each BEND or BREAK by the fun it adds.
2. **Coherence on one plane.** Everything must live in one consistent ontology of what the world is. The user's example: "if Factorio's pollution is 'slop', that would mean we are in some sense in cyberspace or memetic space?" They also noted that slop predates AI: technology-enabled, human-generated slop such as sensationalist journalism. A good idea that doesn't fit the chosen plane must be adapted or dropped.
3. **Clever, not silly.** Humor should be the kind someone thinks about and finds clever in non-obvious ways.
   - The reference is **Universal Paperclips** (Frank Lantz): real concepts used accurately, irony that emerges from the mechanics, understated text.
   - Overdone or cringe: "burns coffee to get ideas" (the Rényi quote), on-the-nose satire, puns for their own sake, strawmen of AI-risk positions, "patent guns".
4. **Concrete and complete.** This design phase must produce a spec we can start coding from: resources, items, recipes, buildings, tech tree, and mechanics with numbers. Think ahead.

## Where we are
- Read `/home/mewse/browsergame/design/design-space.md` first. It synthesizes the first brainstorm. The raw reports are in `/home/mewse/browsergame/design/brainstorm/`: 00 is Claude's notes, 01–05 are agents.
- **Consensus so far** (not final):
  - **World:** a physical, endless, procedural world (a fictional continent), starting around 1945.
  - **Player:** an embodied researcher avatar.
  - **Economy:** no money. Papers are the science packs, and the tech tree holds non-rival ideas.
  - **Industry:** the data refinery plays oil; electricity is literal.
  - **Systems:**
    - Bots are AI agents.
    - The circuit network is threshold logic.
    - Quality is best-of-N with a verifier.
  - **Arc:** the rocket is a frontier training run. The endgame is recursive self-improvement, with returns to research crossing 1.
  - **Opposition:** rivals appear only as timers. The first vertical slice is peaceful.
- **Open**:
  - the pollution analog (slop or noise, heat, …);
  - the biters;
  - talent;
  - where compute lives (modules/beacons, checkpoints, …);
  - naming realism;
  - the spacetime-map wildcard.

## Conventions
- Several agents work in parallel on different parts. Other round-1 outputs may appear in `/home/mewse/browsergame/design/round1/` while you work; read them if useful, but don't wait for them. Define cross-references by name; integration resolves conflicts later.
- Be concrete: names, numbers, recipes. Use Factorio 2.0 (+ Space Age) numbers as the default skeleton where applicable, and say which Factorio element each thing mirrors.
- You may disagree with the consensus; say why.
- Write your full output to the file path given in your task (markdown). Your final message: a summary of at most 300 words, plus the path. Don't paste the full document into the final message.
- Don't touch other files in the repo. Scratch scripts belong in `/tmp/claude-1002/` or a subfolder named after your task.

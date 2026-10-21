You are a senior technical program manager and game-engine architect. Draft the **work-package plan for milestone M1** (the vertical slice) of the browser game *Paperwork*, a faithful Factorio 2.0-like about AI research. The plan will be executed by Claude Opus coding agents, under a hard constraint: **at most 2 agents run at the same time**. Codex (you) reviews every package. Each agent session can produce roughly 1.5–3k lines of reviewed, tested code.

**Current state (M0 is nearly complete).** Look at `pm/STATUS.md`, `pm/DECISIONS-IMPL.md` and the reports in `pm/reports/` (C1a–C1c, C2, C3, C4, C5, C6, C7). On `dev` there are:
- a Rust→WASM sim with M0's systems (character, chests, hand mining and crafting, worldgen v0, saves, digests);
- a TypeScript worker shell;
- a WebGL2 renderer in the "Survey" art style;
- a SolidJS UI with Factorio's keybindings;
- a generative audio runtime;
- an asset pipeline (Blender to KTX2);
- a machine-readable schema with code generation, and a frozen golden test set.

A separate package (D1) is making the design data M1-ready right now: typed values, the engine overlay, and an M1 capability manifest.

**Read:**
- `design/spec/09-vertical-slice.md`, which defines M1;
- `design/spec/10-architecture.md`: §12 (M0 and M1), §5 (systems), §6 (rendering), §7 (UI), §9 (assets and audio), §10 (testing) and §15 (the contracts);
- `design/spec/07-ui.md` (the UI deltas), `design/spec/08-text.md`, `design/spec/README.md` (the M1 reading order);
- `design/DECISIONS.md`.

**Produce a plan with:**
1. **An ordered list of work packages for M1.** For each: id, title, scope (spec sections), deliverables, exit criteria, its dependencies, rough size in lines and agent sessions, risks, and which layers it touches (Rust sim, shell, renderer, UI, assets, audio, data, text).

   Prefer **vertical slices by game system**. For example, "belts end to end": sim, packet, renderer, UI, art, sound and tests. Horizontal layers only where a shared foundation must come first, such as the entity framework, the electric network, or the entity GUI framework. Keep each package to one or two agent sessions.
2. **A schedule under the 2-agent limit,** with critical-path reasoning: which pairs can safely run in parallel without file conflicts, and what must be sequential.
3. **The shared foundations that must land first,** and why. Schema changes and golden-set extensions for M1 need care (see `pm/DECISIONS-IMPL.md` 14).
4. **The art and audio production plan** for M1's entities, items and icons, which runs alongside the code.
5. **QA:** integration points, playtest milestones (when a human-playable build first exists), and the M1 exit gate per 09 and 10 §12.
6. **The top risks,** and how the plan mitigates them.

Be concrete and realistic. Output at most 2,500 words of Markdown. Do not modify any files.

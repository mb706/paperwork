# C5: UI and input v0 (M0 UI package)

**Owner:** one Opus agent, in its own git worktree (the manager sets it up). Commit to your worktree branch at milestones, with messages ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The manager merges.
- **Writes to:**
  - `game/src/ui/**`;
  - `game/locale/en.*` (the UI strings; you own the keys of `prototypes.json.localeKeys` per C1b open issue 4);
  - UI wiring in `game/src/app/`, keeping it minimal and documented;
  - UI tests and Playwright specs under `game/e2e/`;
  - `CLAUDE.md` (a short UI section);
  - `pm/reports/C5.md`.
- **Must not touch:** the crates, the schema and generated code, `render/`, `audio/`, the sim worker, `design/**`, the golden set.

## Context

The M0 contract gate has passed. The fake sim (`?sim=fake`) produces every M0 projection; the golden set holds their expected records.

The UI is **Factorio's UI, faithfully**: its layout, menus and keybindings. The user explicitly wants Factorio's "wicked good UI" copied, keybindings included. The skin is *Survey*'s 1945 federal paperwork: manila, typewriter, the HUD from A3's mocks. The UI skin parts and font subsets come from the asset pipeline (C6, in another worktree); use placeholders in the same format until they land.

## Read

- `CLAUDE.md`, `pm/README.md`, `pm/DECISIONS-IMPL.md`.
- `design/spec/07-ui.md` (the UI deltas) and `design/round1/I-ui-controls.md` §1–§6 and §8.2 (Factorio's UI and controls, faithfully).
- `design/spec/08-text.md` §0–§1, §4.6–§4.7, §5 and §8–§10, plus `design/spec/data/text.yaml`. All player-facing text comes from the text canon; never invent strings.
- `design/art/DIRECTION.md` (the UI skin section) and the A3 mocks in `design/art/mocks/` (the HUD).
- `design/spec/10-architecture.md`:
  - **§7** (the UI layer: SolidJS, structure, data flow, styling, input, rules);
  - §3.4 (the view model);
  - §15.3 (actions: you own the action encoder side);
  - §15.5 (projections and subscriptions: you decode them);
  - §12 (M0 scope: the Solid shell, Window and Slot, the character screen's skeleton on real projections, the input core with action map, capture layer, resolver skeleton and action encoder).
- `game/schema/README.md`; the golden set's README.

## Deliver

1. **The Solid shell:** layering of the DOM UI over the canvas, the Window and Slot components in the Survey skin, and tooltips at M0's scope.
2. **The main menu:** "PAPERWORK" with "Information is physical." (07 §18, 08 §3.1, DECISIONS §44). Only the M0 entries work (new game, load, settings, quit-equivalent); the rest are present and disabled, or as 07 says.
3. **The character screen skeleton** on real projections: `CHARACTER`, `INVENTORY` and `STATS` from the fake sim. Slot interactions encode real actions.
4. **The input core:**
   - the action map with **Factorio's default keybindings** (I §1–§6);
   - the capture layer, the resolver skeleton, and the action encoder;
   - keyboard and mouse, with the right hold, repeat and modifier semantics;
   - the settings shape for rebinding (the UI for it can be M1).
5. **The HUD at M0's scope:** the quickbar shell, and the `HUD` projection.
6. **Tests:**
   - Vitest for decoding projections into UI state, and for input resolution;
   - Playwright specs that drive the real input layer against the fake sim and check the encoded actions;
   - screenshots of the main menu and the character screen. View them and judge them critically.

## Quality bar

- **UI time** ≤ 2 ms per frame with the character screen open (§11).
- **Input latency** ≤ 2 frames.
- **A window opens** in ≤ 100 ms.
- The feel must match Factorio: snappy, precise, keyboard-first.
- `npm run ci` is green in your worktree.

## Report

`pm/reports/C5.md`. Your final message is at most 200 words, and includes your worktree path and branch.

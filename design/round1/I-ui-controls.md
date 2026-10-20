# R1-I — Factorio 2.0 UI and controls: reference spec

**Task:** R1-I. **Audience:** the programmer implementing the game's UI.

**What this is:** a theme-independent spec of Factorio 2.0's controls, screens and interaction rules, precise enough to implement from. It specifies:
- structure and behaviour, not art;
- names as Factorio's own (the tone bible, R1-H, supplies display names);
- numbers as Factorio's, unless a section says otherwise.

**One-line summary.** Copy Factorio's input model (a rebindable action map resolved by context), its around 25 screens, and its around 40 small "feel" rules exactly. Add a thin browser-capture layer. Build in this order:
1. The cursor, building and mining loop.
2. The character screen and crafting.
3. Entity GUIs.
4. The technology screen.
5. The map, statistics and encyclopedia.
6. The blueprint, bot and circuit UIs, later.

---

## 0. Scope, baseline, conventions

**Baseline:**
- **Factorio 2.0** is the baseline: release 2.0.7 (20 Oct 2024) through 2.0.77.
- **Factorio 2.1** went experimental in June 2026 (2.1.22 as of 15 Oct 2026). Wube calls it the last major update; it is mostly quality of life. Its UI deltas are marked **[2.1]**. They are adopted by default because they are cheap and strictly better, and each is flagged so it can be dropped.
- Space Age-only UI (surfaces, platforms, quality, spoilage) is listed only where it shapes a shared widget. It is marked **SA** and is out of scope for the base game.

**Tags (from the BRIEF):**
- Everything untagged is **ISO**.
- **BEND** and **BREAK** are justified where they appear.
- §7 collects all of them.

**Priorities** (used in every table):

| Tag | Meaning |
|---|---|
| **P0** | Core loop. The vertical slice is unplayable without it. |
| **P1** | "Veteran-complete" slice. A Factorio veteran reaches for it within the first hour, so the slice does not *feel* like Factorio without it. |
| **P2** | Mid-game: blueprints, bots, circuits, logistics. These are unlocked by tech beyond green science. |
| **P3** | Late game or expansion: trains, quality, multiple surfaces. |
| **N/A** | Combat or multiplayer. The binding is reserved but unimplemented in a peaceful single-player slice. |
| **dev** | Debug or developer tooling. Useful from day one, not a player feature. |

**Notation:**
- Mouse: LMB / RMB / MMB, Wheel↑ / Wheel↓, Mouse4 / Mouse5 (back / forward buttons).
- **Press** is edge-triggered. **Hold** is level-triggered. **Drag** is hold plus move.
- **Control IDs** are Factorio's internal names (the `LinkedGameControl` list in the 2.1 Lua API). The input code and the settings screen can mirror them 1:1.

**Units:**
- GUI px at UI scale 100% (1920×1080).
- 60 ticks/s.
- 1 tile = 1 m = 32 px at zoom 1.0.

**Sources** are listed in §9:
- the wiki controls page;
- `LinkedGameControl` and `defines.input_action` from the Lua API;
- the `factorio-data` repo files `custom-inputs.lua`, `shortcuts.lua`, `utility-constants.lua`, `style.lua` and `entities.lua`;
- the 2.0 and 2.1 changelog;
- FFF 362–443;
- screenshots.

Claims inferred rather than read from a source are marked *(inferred)*.

---

## 1. Input system (the architecture every binding relies on)

### 1.1 The action map
- Factorio has about 190 named controls (§2). Each has a **primary** and an **alternative** binding: the Controls screen has two columns.
- A binding is one key or mouse button plus an exact modifier set from {Ctrl, Shift, Alt}. On macOS, Ctrl-bindings default to Cmd (Factorio does this). This also dodges macOS's Ctrl+click = right-click.
- **Shared bindings are intentional.** Q is both `pipette` and `clear-cursor`. Shift+LMB is bound to more than a dozen controls (`build-ghost`, `paste-entity-settings`, `stack-transfer`, `craft-all`, `cancel-craft-all`, `remove-pole-cables`, `select-for-cancel-deconstruct`, `place-in-chat`, `add-station`, …). LMB alone is bound to `build`, `open-gui`, `craft`, `pick-item`, `select-for-blueprint`, `drag-map` and more. A context resolver (§1.4) picks exactly one. The rebinding screen therefore warns about conflicts but allows them.
- **Movement keys** (WASD) and other *hold* controls ignore extra modifiers: you can walk while holding Shift or Ctrl. Press controls require an exact modifier match. Factorio's `block_modifiers` flag is the exception mechanism.

### 1.2 Physical keys and labels
- Store bindings as **physical keys**: `KeyboardEvent.code`. Factorio switched to scan codes in 0.17 so that AZERTY layouts work.
- Render key labels from `navigator.keyboard.getLayoutMap()` where it exists (Chromium). Otherwise use a built-in table keyed by `code`.
- Mouse buttons come from `PointerEvent.button`: 0 = LMB, 1 = MMB, 2 = RMB, 3 = Mouse4, 4 = Mouse5.
- **Wheel:**
  1. Normalise `deltaMode` (lines and pages to px).
  2. Accumulate the delta.
  3. Emit one "notch" per about 100 px.

  Each notch is one zoom or scroll step. Trackpads then behave.

### 1.3 Event semantics
- **Ignore OS auto-repeat** (`event.repeat`) for game controls; text fields still get repeats. Factorio never rotates twice because a key was held.
- **Hold controls** are level-triggered:
  - movement;
  - `mine`;
  - `build` (drag-build);
  - `build-ghost` and `super-forced-build` (drag);
  - `pick-items`;
  - `drop-cursor` (one item per new tile while moving);
  - `fast-entity-transfer` / `fast-entity-split` (sweep);
  - `paste-entity-settings` (sweep);
  - all `select-*` (area drag);
  - `activate-tooltip`;
  - `drag-map`;
  - `shoot-*` (N/A).
- **On window blur** (`blur`, `visibilitychange`), release every held control. This prevents stuck keys after alt-tabbing.
- **When a text field has focus**, game controls are suspended, with these exceptions:
  - Esc (unfocus / cancel);
  - Enter (confirm). **[2.1]** Enter in a *search* field just unfocuses it.
  - Tab (next field);
  - Ctrl+F (focus search).

  List boxes accept ↑ / ↓ while searching (2.0).
- **Gameplay vs UI state.** Every gameplay input becomes an **input action** that enters the deterministic simulation at the next tick. This mirrors Factorio's `InputAction` model; §8.2 lists the actions. Pure UI state never enters the sim: open windows, hover, tooltips, camera, scroll positions and search text.

### 1.4 Context resolution: what a click or key *means*

The resolver evaluates these contexts in order and uses the first that applies:

| # | Context | Description |
|---|---|---|
| 1 | Text | A text field has focus. |
| 2 | GUI | The pointer is over a GUI element (window, HUD, quickbar, …). |
| 3 | Modal | A dialog is open, or an area-selection drag is in progress. |
| 4 | Tool | The cursor holds a selection tool: empty blueprint, deconstruction or upgrade planner, copy or cut tool, RTS / spidertron tool. |
| 5 | Placeable | The cursor holds a placeable: an item with a place result, a ghost item, a filled blueprint or paste tool, the rail planner, or a tile item. |
| 6 | Usable | The cursor holds a usable item: a capsule or remote (RMB = use). |
| 7 | Other item | The cursor holds any other item. |
| 8 | Empty | The cursor is empty. |

In the world, the resolver also knows:
- the **selected** object (hovered entity, ghost, ground item, resource, tree, rock, else tile);
- whether it is **in reach**;
- whether we are in **remote view**.

| Input | GUI | Tool | Placeable | Empty / other item (world) |
|---|---|---|---|---|
| **LMB** | Click element. On a slot, pick / place / merge / swap (§3.8). Crafting slot: craft 1. Queue slot: cancel 1. Tech: select. | Start area *select* | Build at cursor (§3.3). If the build is blocked only by the selected entity and that entity has a GUI, **open it instead** *(inferred)*. | Open the selected entity's GUI (reach-checked; any distance in remote view). In remote view with nothing selected: drag map. |
| **LMB drag** | (Window title bar: move window) | Extend selection | **Drag-build** (§3.4) | Map: pan |
| **Shift+LMB** | Slot: stack transfer. Crafting slot: craft all. Queue: cancel all. Tech: enqueue. | *Alt-select*. Deconstruction / upgrade planner: cancel marks. Blueprint: create without the setup dialog. | **Build ghost** (forced: trees and rocks in the way are marked for removal). | Over an entity: paste entity settings (hold to sweep). Over a pole with no compatible copy source: remove its cables. Chat open: insert a link to the hovered object. |
| **Ctrl+LMB** | Slot: inventory transfer (every stack of that item; on an empty slot, *everything*) | Deselect | Rail planner: obstacle avoidance | **Fast entity transfer** (hold to sweep; §3.8) |
| **Ctrl+Shift+LMB** | — | Deconstruction planner: super-forced (entities *and* tiles) | **Super-forced build** | — |
| **Alt+LMB** | Open the hovered item / recipe / technology in Factoriopedia | ← | ← | Open the selected entity / resource / tile in Factoriopedia |
| **Ctrl+Alt+LMB** | — | — | — | Map ping (MP; N/A) |
| **RMB** | Slot: cursor split (empty hand: take half, rounded up; holding items: put one). Item with its own GUI (blueprint, book, planner, armor): open it. Crafting slot: craft 5. Queue: cancel 5. | *Reverse select* (upgrade planner: downgrade; deconstruction planner: invert filters) | Same as Empty: mine (hold) | **Mine** the selected object (hold). Usable item: **use** at cursor. |
| **Shift+RMB** | Slot: stack split (half to the other inventory). Filtered slot: copy filter. | *Alt-reverse select* *(inferred default)* | — | **Copy entity settings** from the selected entity. Spidertron remote: queue a waypoint (P3). |
| **Ctrl+RMB** | Slot: inventory split (half of every stack of that item; empty slot = half of all) | — | — | **Fast entity split** (half the hand into the entity, or half the entity's output to you) |
| **Alt+RMB** | — | — | — | **Pin** the selected entity or position (§4.11) |
| **MMB** | Slot: toggle filter. Quickbar slot: clear it. | — | — | — |
| **Wheel** | Scroll pane: scroll. **[2.1]** Shift+Wheel scrolls horizontally. Over the minimap: Shift+Alt+Wheel zooms it (**[2.1]** Shift+Wheel). | ← | ← | **Zoom.** Shift+Wheel: cycle a held blueprint book or the clipboard history. Otherwise, over a docked tooltip, scroll it (2.0.44). Otherwise zoom (the alternative zoom binding). Alt+Wheel: quality ± (SA). |
| **Q** | Over a slot or recipe: pipette that item (2.0) | Clear cursor | Clear cursor | Empty hand: **pipette** the selected object. Item in hand: **clear cursor**. |
| **E** | If any window is open: **confirm** (= the window's green button if it has one, else close). Otherwise: open the character screen. | | | |
| **Esc** | In order: text focused → unfocus. Dialog → cancel. Window open → close it. Area selection in progress → cancel it. Remote view → leave it. Otherwise → game menu. | | | |
| **R / Shift+R** | — | Rotate the held blueprint | Rotate the build direction | Rotate the selected built entity (any distance, 2.0) |
| **H / V** | — | Flip the held blueprint | Flip the held item | Flip the selected entity (if it has a valid symmetry) |

**E vs Esc is a rule, not an accident** (FFF-362, 1.1).
- E = confirm (= the green button).
- Esc = cancel (= the [X] button).

Players set something up and press E. Making E confirm stopped dialogs from discarding their input. A green-button click and E both play the same confirm sound.

### 1.5 Browser capture layer — BEND (mandatory, invisible when it works)

The game is a page, so some Factorio defaults collide with browser defaults. The goal is **zero changed default bindings**. Achieve this by intercepting events and using the Keyboard Lock API where it exists.

| Factorio default | Browser behaviour | Handling |
|---|---|---|
| Tab (map) | Focus traversal | `preventDefault` on keydown while the game canvas or document is focused |
| Space (shoot, N/A) | Page scroll | `preventDefault` |
| Alt (alt-mode) | Firefox shows the menu bar on Alt key-up; Windows menu focus | `preventDefault` on keydown *and* keyup of AltLeft / AltRight |
| Alt+letter (Alt+B/D/U/C/G/R/T/A/E/L/F/Y) | Alt+D focuses the address bar; Firefox menu access keys (Alt+F/E/V/B/T/H) | `preventDefault` on keydown. Verify per browser at startup with a self-test page. |
| Alt+← / Alt+→, Mouse4 / Mouse5 (GUI back / forward) | Browser history navigation | `preventDefault` on keydown and on `mouseup` / `auxclick` for buttons 3–4. Fallback: a `history.pushState` trap plus `beforeunload` while a game is loaded. |
| RMB | Context menu | `preventDefault` on `contextmenu` |
| MMB | Autoscroll (Windows); X11 primary-selection paste (Linux) | `preventDefault` on `pointerdown` with button 1 |
| Ctrl+Wheel, Ctrl+Numpad± / 0 (UI scale) | Browser zoom | Wheel listener with `{passive:false}` plus `preventDefault`. Map trackpad pinch (which arrives as Ctrl+Wheel) to game zoom. |
| Ctrl+Z / Y / C / X / V / F | Editing, find | `preventDefault`. Blueprint-string import (P2) reads the `paste` event or the Clipboard API. |
| F1–F3 (character-screen tabs), F4–F10 and Ctrl+F3–F8 (debug and dev keys) | F1 help, F3 find-next, F5 reload, F6 address bar, F7 caret browsing, F10 menu bar, Ctrl+F5 hard reload | `preventDefault` on keydown. Losing one in some browser costs only a dev key or a tab shortcut. |
| F11, F12 | Fullscreen, devtools | Leave to the browser. The game offers its own fullscreen toggle (Graphics settings). |
| Ctrl+W / T / N / Tab | Reserved by the browser, cannot be intercepted | Not Factorio defaults. If a player binds them, the Controls screen warns "reserved by the browser unless the game runs fullscreen with Keyboard Lock". |
| Esc in fullscreen | Exits fullscreen | Chromium: `navigator.keyboard.lock()` after `requestFullscreen()`. Esc is then delivered to the game, and holding Esc exits. Elsewhere: treat `fullscreenchange`-to-windowed as an Esc press. |

**Other browser hygiene:**
- `user-select: none` on the game UI (not on text fields).
- `dragstart` → `preventDefault` on icons.
- Disable double-tap zoom with `touch-action: none` on the canvas.

### 1.6 Hotkey hints

Every tooltip that mentions a control renders the **currently bound** key in the hotkey colour. Examples:
- "Create artillery targeting remote (**Alt + T**)";
- "**Right-click** to activate";
- "Press **T** to start a new research".

Generate hints from the live binding table so that rebinding updates every hint.

---

## 2. Default keybindings (complete, Factorio 2.0 PC defaults)

**How to read the tables:**
- "—" means unbound by default but rebindable.
- The **Alt** column is the second binding column.
- Controller-only controls (`alternative-gui-move-*`, `toggle-free-cursor`, `show-quick-panel`, `next/previous-quick-panel-page/tab`, `close-menu`) are omitted; they are N/A.
- Editor controls are listed in §2.11 because their game-speed keys are useful for dev.

### 2.1 Movement

| Control ID | Default | Alt | Effect | Pri |
|---|---|---|---|---|
| `move-up` / `move-down` / `move-left` / `move-right` | W / S / A / D | — | Walk. Eight directions from key combinations. Running speed 0.15 tiles/tick (≈ 9 tiles/s; the wiki quotes 8.9). Remote view: pan the camera. | P0 |

### 2.2 Basic interaction

| Control ID | Default | Alt | Effect | Pri |
|---|---|---|---|---|
| `open-character-gui` | E | — | Open the character screen (inventory + crafting [+ logistics]) | P0 |
| `confirm-gui` | E | — | With a window open: confirm (green button) or close (§1.4) | P0 |
| `open-gui` | LMB | — | Open the selected entity (reach 10; any distance in remote view) | P0 |
| `mine` | RMB (hold) | — | Mine the selected entity, resource, tree, rock or ground item (§3.7) | P0 |
| `build` | LMB | — | Build the cursor item; drag-build while held (§3.3–3.4) | P0 |
| `build-ghost` | Shift+LMB | — | Build a ghost. Forced: trees and rocks in the way get deconstruction marks; landfill ghosts are added over water if unlocked. No range limit. | P1 |
| `super-forced-build` | Ctrl+Shift+LMB | — | Like a ghost, but also marks *your* colliding entities for deconstruction, replaces ghosts and tiles, and auto-places undergrounds when crossing belts (FFF-383) | P2 |
| `clear-cursor` | Q | — | Return the cursor stack to its origin (§3.2). Also cancels wire placement and rail planning. | P0 |
| `pipette` | Q | — | Put the item that builds the selected object into the cursor (§3.13) | P0 |
| `rotate` | R | — | Rotate the cursor item or the selected entity clockwise | P0 |
| `reverse-rotate` | Shift+R | — | Counter-clockwise | P0 |
| `flip-horizontal` | H | — | Mirror the cursor item, blueprint or selected entity (§3.3) | P1 |
| `flip-vertical` | V | — | " | P1 |
| `pick-items` | F (hold) | — | Pick up items on the ground and on belts within 1 tile of the character | P0 |
| `drop-cursor` | Z | — | Drop one item from the cursor at the cursor position (ground or belt lane), or insert it into the selected entity. Hold and move to keep dropping. | P0 |
| `show-info` | Alt | — | Toggle **alt-mode** (§3.14) | P0 |
| `hide-tall-entities` | — | — | **[2.1]** Toggle visibility of elevated rails (SA) | P3 |
| `shoot-enemy` | Space | — | Shoot the enemy nearest the cursor | N/A |
| `shoot-selected` | Shift+Space | — | Shoot whatever is selected | N/A |
| `next-weapon` | C | — | Cycle weapon slots | N/A |
| `toggle-driving` | Enter | — | Enter or leave an adjacent vehicle (3 tiles) | P2 |
| `zoom-in` / `zoom-out` | Wheel↑ / Wheel↓ | Shift+Wheel↑ / ↓ | Zoom the world or map (§3.15). The Shift variant only acts when Shift+Wheel isn't consumed by book or clipboard cycling or tooltip scrolling. | P0 |
| `use-item` | RMB | — | Use a capsule or remote at the cursor | P2 |
| `alternative-use-item` | Shift+RMB | — | Queue a command (spidertron remote) | P3 |
| `toggle-console` | ` (grave) | — | Open or close chat and console (§4.19) | P0 dev / P1 |
| `copy-entity-settings` | Shift+RMB | — | Remember the selected entity as the settings source | P1 |
| `paste-entity-settings` | Shift+LMB (hold to sweep) | — | Paste onto the selected entity (§3.10) | P1 |
| `controller-gui-logistics-tab` | F1 | — | Character screen → Logistics (tabbed mode) | P2 |
| `controller-gui-character-tab` | F2 | — | Character screen → Character / inventory | P2 |
| `controller-gui-crafting-tab` | F3 | — | Character screen → Crafting | P2 |
| `toggle-rail-layer` | G | — | Rail planner: ground ↔ elevated (SA) | P3 |

### 2.3 Advanced interaction (selection tools, map, misc.)

| Control ID | Default | Alt | Effect | Pri |
|---|---|---|---|---|
| `select-for-blueprint` | LMB (drag) | — | Area-select with a blueprint, planner or copy tool | P2 |
| `select-for-cancel-deconstruct` | Shift+LMB (drag) | — | Alt-select: cancel deconstruction or upgrade marks. Blueprint: skip the setup dialog. | P2 |
| `select-for-super-forced-deconstruct` | Ctrl+Shift+LMB (drag) | — | Deconstruct everything including tiles | P2 |
| `reverse-select` | RMB (drag) | — | Upgrade planner: downgrade. Deconstruction planner: invert the white/blacklist for this drag. | P2 |
| `alt-reverse-select` | Shift+RMB (drag) *(inferred)* | — | Tool-specific fourth mode | P2 |
| `deselect` | Ctrl+LMB | — | Remove from the current selection (RTS tool, selections) | P2 |
| `cycle-blueprint-forwards` / `-backwards` | Shift+Wheel↑ / ↓ | — | Next or previous blueprint in a held book | P2 |
| `focus-search` | Ctrl+F | — | Focus the search field of the open window. With no window: map search in remote view. | P1 |
| `larger-terrain-building-area` / `smaller-…` | Numpad+ / Numpad− | — | Tile brush size, 1×1 up to the build reach | P2 |
| `remove-pole-cables` | Shift+LMB | — | Disconnect all copper wires of the selected pole, then circuit wires | P1 |
| `build-with-obstacle-avoidance` | Ctrl+LMB | — | Rail planner: ghost rails that avoid trees, rocks and cliffs | P3 |
| `add-station` / `add-temporary-station` | Shift+LMB / Ctrl+LMB | — | Train schedule editing from the map or minimap | P3 |
| `rename-all` | Ctrl+LMB | — | In rename dialogs: rename every object with this name | P3 |
| `fast-wait-condition` | Shift+LMB | — | Platform schedule (SA) | N/A |
| `drag-map` | LMB | — | Pan the map (map or remote view only) | P1 |
| `move-tag` | LMB | Shift+LMB | Drag a map tag | P1 |
| `place-in-chat` | Shift+LMB | — | Chat open: insert a rich-text link (item, recipe, position, entity) | P2 |
| `place-ping` | Ctrl+Alt+LMB | — | Map ping (multiplayer) | N/A |
| `pin` | Alt+RMB | — | Pin the selected entity or position (§4.11) | P1 |
| `activate-tooltip` | Shift (hold) | — | Show a tooltip immediately when the tooltip delay is long or "never" | P1 |
| `next-surface` / `previous-surface` | ↓ / ↑ | — | Remote view: cycle surfaces (SA) | P3 |
| `cycle-quality-up` / `-down` | Alt+Wheel↑ / ↓ | — | Quality of the cursor item or selection (SA) | P3 |
| `scroll-tooltip-up` / `-down` | Shift+Wheel↑ / ↓ | — | Scroll a tall docked tooltip (2.0.44) | P1 |
| `visualize-entity-fluid-segments` | — | — | **[2.1]** Persistently show the fluid segment of the selected entity | P2 |

### 2.4 Crafting

| Control ID | Default | Effect | Pri |
|---|---|---|---|
| `craft` | LMB | On a recipe: queue 1 craft | P0 |
| `craft-5` | RMB | Queue 5 | P0 |
| `craft-all` | Shift+LMB | Queue as many as the inventory allows, including chained intermediates. A free recipe queues one stack (2.0.15). | P0 |
| `cancel-craft` | LMB | On a crafting-queue slot: cancel 1 | P0 |
| `cancel-craft-5` | RMB | Cancel 5 | P0 |
| `cancel-craft-all` | Shift+LMB | Cancel the whole entry | P0 |

### 2.5 Inventory (inside GUIs) and fast transfer (world)

| Control ID | Default | Effect | Pri |
|---|---|---|---|
| `pick-item` | LMB | Pick up or put down a stack (§3.8) | P0 |
| `stack-transfer` | Shift+LMB | Move this stack to the *other* open inventory | P0 |
| `inventory-transfer` | Ctrl+LMB | Move all stacks of this item; on an empty slot, all items | P0 |
| `fast-entity-transfer` | Ctrl+LMB | World: hand → entity, or (empty hand) entity output → you. Hold to sweep. | P0 |
| `cursor-split` | RMB | Empty hand: take half (rounded up). Holding items: place one. | P0 |
| `stack-split` | Shift+RMB | Move half this stack to the other inventory | P0 |
| `inventory-split` | Ctrl+RMB | Move half of all stacks of this item (rounded up); empty slot = half of everything | P0 |
| `fast-entity-split` | Ctrl+RMB | World: half of the hand → entity, or half of the entity's output → you | P0 |
| `toggle-filter` | MMB | Set or clear a slot filter (character inventory, car or wagon trunks); on the quickbar, clear the slot | P2 (quickbar part P1) |
| `open-item` | RMB | Open an item that has its own GUI (blueprint, book, planner, armor grid) | P2 |
| `copy-inventory-filter` / `paste-inventory-filter` | Shift+RMB / Shift+LMB | Copy or paste a slot filter | P2 |

### 2.6 Quickbar

| Control ID | Default | Effect | Pri |
|---|---|---|---|
| `quick-bar-button-1` … `-10` | 1 … 9, 0 | Activate a slot of the **top** visible bar (§4.2). **[2.1]** On an *empty* slot this is a "quick pipette": it pipettes and assigns the result to the slot (2.1.21). | P0 |
| `quick-bar-button-1-secondary` … `-10-secondary` | — | The same for the **second** visible bar. Players often bind Ctrl+1…0. Warn in the Controls screen that browsers use Ctrl+1–9 (Linux Chrome: Alt+1–8) for tab switching, and that this may not be interceptable outside fullscreen with Keyboard Lock. | P1 |
| `action-bar-select-page-1` … `-10` | Shift+1 … Shift+0 | Show page N in the top visible bar | P1 |
| `rotate-active-quick-bars` | X | Cycle the visible bars: the bottom one goes to the top | P1 |
| `next-active-quick-bar` / `previous-active-quick-bar` | — | Top bar → page +1 / −1 (wraps 10 ↔ 1) | P1 |

### 2.7 Tools

| Control ID | Default | Alt | Effect | Pri |
|---|---|---|---|---|
| `copy` / `cut` / `paste` | Ctrl+C / Ctrl+X / Ctrl+V | — | Copy-area tool, cut tool (copy + deconstruction marks), paste the latest copy | P2 |
| `cycle-clipboard-forwards` / `-backwards` | Shift+Wheel↑ / ↓ | — | Cycle the last 20 copies while holding the paste tool (`clipboard_history_size` = 20) | P2 |
| `undo` | Ctrl+Z | — | Undo (§3.11) | P1 |
| `redo` | Ctrl+Y | Ctrl+Shift+Z | Redo | P1 |
| `give-blueprint` | Alt+B | — | Empty blueprint into the cursor | P2 |
| `give-blueprint-book` | — | — | Empty book into the cursor | P2 |
| `give-deconstruction-planner` | Alt+D | — | | P2 |
| `give-upgrade-planner` | Alt+U | — | | P2 |
| `give-copper-wire` | Alt+C | — | Abstract copper-wire tool: click pole A then pole B to connect or disconnect. No item is consumed (FFF-379). The shortcut unlocks with *Electronics*. | P1 |
| `give-red-wire` / `give-green-wire` | Alt+R / Alt+G | — | Circuit-wire tools | P2 |
| `give-spidertron-remote` | Alt+A | — | RTS tool (FFF-404) | P3 |
| `give-artillery-targeting-remote` / `give-discharge-defense-remote` | Alt+T / Alt+Y | — | | N/A |
| `toggle-personal-roboport` | Alt+F | — | (Alt+R before 2.0) | P2 |
| `toggle-personal-logistic-requests` | Alt+L | — | | P2 |
| `toggle-equipment-movement-bonus` | Alt+E | — | Exoskeleton on/off | P3 |

### 2.8 Panels (windows)

| Control ID | Default | Alt | Effect | Pri |
|---|---|---|---|---|
| `toggle-menu` | Esc | — | Close the top window, leave remote view, or open the game menu (§1.4) | P0 |
| `toggle-map` | Tab | M | Open or close remote view (the map) | P0 (read-only chart) → P1 (full remote view) |
| `open-technology-gui` | T | — | Technology screen | P0 |
| `production-statistics` | P | — | Production statistics | P1 |
| `logistic-networks` | L | — | Logistic networks overview | P2 |
| `toggle-blueprint-library` | B | — | Blueprint library | P2 |
| `open-trains-gui` | O | — | Trains overview | P3 |
| `open-factoriopedia` | Alt+LMB | — | Factoriopedia page for the hovered thing | P1 |
| `back` / `forward` | Alt+← / Alt+→ | Mouse4 / Mouse5 | GUI browse history across Factoriopedia, technologies, remote view, library, … (FFF-397) | P1 |

### 2.9 Miscellaneous

| Control ID | Default | Effect | Pri |
|---|---|---|---|
| `pause-game` | Pause | Pause or unpause (single player) | P0 |
| `confirm-message` | Tab | Dismiss a tutorial or scenario message box | P2 |
| `previous-mod` | Backspace (Mouse4) | Mods GUI | N/A |
| `connect-train` / `disconnect-train` | J / K | Couple or uncouple rolling stock | P3 |
| `submit-feedback` | — | (Wube bug-report helper) | N/A |
| `next-player-in-replay` | F10 | Replays | N/A |
| `move-blueprint-absolute-grid-up/down/left/right` | Ctrl+↑/↓/←/→ | Held blueprint: shift the absolute-grid offset (FFF-404) | P2 |
| `move-blueprint-entities-up/down/left/right` | Shift+↑/↓/←/→ | Held blueprint: shift the grid position | P2 |
| `toggle-blueprint-snap-to-grid` | — | **[2.1]** Toggle snapping of the held blueprint | P2 |
| `play-next-track` / `play-previous-track` / `pause-resume-music` | — | Music controls (up to 5 previous tracks remembered) | P1 |

### 2.10 Debug and visibility toggles

| Control ID | Default | Effect | Pri |
|---|---|---|---|
| `debug-toggle-gui-visibility` | Ctrl+Shift+F4 | **Hide all GUI** (screenshots) | P1 |
| `debug-toggle-debug-settings` | F4 | Debug-options window: per-mode checklists (§4.21) | dev |
| `debug-toggle-basic` | F5 | Toggle the "debug" overlay set (FPS/UPS, cursor position, …) | dev |
| `debug-reset-zoom` / `debug-reset-zoom-2x` | F9 / Shift+F9 | Zoom 1.0 / 2.0 (a forum report says Ctrl+F9 for 2×; use Shift+F9 as the wiki does) | P1 |
| `debug-toggle-atlas-gui` | Ctrl+F3 | Sprite-atlas viewer | dev |
| `toggle-gui-debug` / `toggle-gui-style-view` / `toggle-gui-shadows` / `toggle-gui-glows` | Ctrl+F5 / F6 / F7 / F8 | Outline widgets; style tooltips; shadows; glows | dev |
| `open-prototypes-gui` | Ctrl+Shift+E | Browse all prototypes (our data tables) | dev |
| `open-prototype-explorer-gui` | Ctrl+Shift+F | Prototype page of the hovered thing | dev |
| `increase-ui-scale` / `decrease-ui-scale` / `reset-ui-scale` | Ctrl+Numpad+ / Ctrl+Numpad− / Ctrl+Numpad0 | UI scale in 25% steps; reset = automatic | P1 |
| `slash-editor` | Ctrl+Shift+F11 | Map editor | N/A (dev later) |
| `toggle-entity` | — | Pause or unpause the selected entity | dev |

### 2.11 Editor controls worth keeping as dev keys

| Control ID | Default | Use in our game |
|---|---|---|
| `editor-speed-up` / `editor-speed-down` / `editor-reset-speed` | Shift+Numpad+ / Shift+Numpad− / Shift+Numpad* | **dev:** game speed ×2 / ÷2 / 1. Pairs with the deterministic `__game.step(n)` hook. |
| `editor-tick-once` / `editor-toggle-pause` | Numpad. / Numpad0 | **dev:** single-step the simulation |
| others (`editor-next-variation`, clone brush, …) | MMB, Shift+MMB, … | N/A |

### 2.12 Mouse and keyboard behaviour outside the control list

| Interaction | Behaviour | Pri |
|---|---|---|
| Hover | Selects the object under the cursor: selection box, related highlights, docked entity info (§3.1) | P0 |
| Drag a window's title bar | Moves the window; position is remembered per window type | P0 |
| Double-click a technology | Enqueue (= Shift+LMB) | P0 |
| Drag to reorder | Research queue (2.0.21), pins (2.0.35), logistic requests within a section, deconstruction and upgrade filters | P1 / P2 |
| Click the minimap | Opens remote view centred there | P1 |
| Hover an alert slot | Alert icons appear over affected entities; off-screen ones get edge arrows (FFF-363) | P2 |
| Hover a pin | Live camera preview; click = remote view at the pin (FFF-423) | P1 |
| Number fields | Accept math and suffixes: `10k`, `10*50k`, `10^6`, `3*7+7k` (FFF-388) | P1 |
| Text fields | Tab moves to the next field and selects its text; Ctrl+A, C, V, X; rich-text icon picker button in relevant fields (later) | P1 |
| Search | Case- and accent-insensitive (2.0.16). It filters live as you type. | P0 |

---

## 3. Interaction semantics: the rules that make it feel like Factorio

Each rule below is small; together they are the "wicked good" feel. Implement them literally. §6 turns them into acceptance tests.

### 3.1 Hover, selection, reach

**What is selected:**
- Every frame, the object under the cursor becomes **selected**: an entity, ghost, item on the ground, resource, tree, rock or cliff; otherwise the tile.
- Overlaps resolve by selection priority. Inserters and poles beat belts; ghosts behave exactly like real entities (2.0).

**How selection is drawn:**
- Corner brackets around the selection box.
- **Related highlights:**
  - inserters that would take from or put into the entity (0.17);
  - a pole's supply area;
  - a drill's mining area;
  - the paired underground or pipe-to-ground;
  - the electric network on hover of a pole (tooltip only).
- The **docked entity info panel** shows the selected entity (§4.8.3).

**Reach** (character prototype values):

| Distance | Value | Applies to |
|---|---|---|
| `reach_distance` | 10 | Open, fast transfer, paste settings |
| `build_distance` | 10 | Build real entities |
| `drop_item_distance` | 10 | Drop (Z) |
| `reach_resource_distance` | 2.7 | Mining resources |
| `item_pickup_distance` | 1 | Picking up ground items |
| `loot_pickup_distance` | 2 | Loot |
| `enter_vehicle_distance` | 3 | Entering vehicles |

- Distance is measured from the character to the target's bounding box.
- An out-of-reach attempt gives flying text **"Cannot reach"** plus the error sound.
- **Not reach-limited** (2.0):
  - rotate and flip of built entities;
  - ghost placement;
  - deconstruction marks;
  - everything in remote view.

### 3.2 The cursor stack ("hand")

**States:**
- empty;
- **item stack** (count + origin slot);
- **ghost item** (no count; places ghosts);
- **tool** (blueprint / book / planner / copy-cut-paste / wire / remote);
- **selection in progress**.

**Picking up:**
- LMB on a slot, a quickbar slot or pipette moves a stack into the cursor.
- The origin slot shows a **hand marker** and is reserved: auto-sort and incoming items skip it while you hold the stack (0.17).
- The quickbar count includes the hand.

**Q returns the stack:**
- to its origin slot (merging first);
- a library blueprint goes back to the library;
- a temporary copy-paste blueprint is discarded (it stays in clipboard history);
- a ghost cursor simply clears.

**Q when the stack does not fit** (corrected 2026-10-20 from Factorio 2.0.77 tests, C1c):
- **Picked up from the player's own inventory:** the origin slot keeps its hand marker and stays reserved, so Q
  always puts the stack back there, even when every other slot is full.
- **Picked up from any other inventory** (a chest, an entity: no hand marker, and the source keeps no slot for
  it): Q puts as much as fits into the main inventory (topping up partial stacks of the item, then empty slots)
  and keeps the rest in the cursor. Nothing goes back to the source inventory and nothing is spilled.
- **Whenever anything stays in the cursor** (also when nothing fits): the flying text at the mouse cursor reads
  `Cannot put away the Iron plate. Player inventory is full.` (locale
  `cant-clear-cursor=Cannot put away the __1__. Player inventory is full.`; changelog 0.17.2). Q is never
  refused: it does what fits.

**Auto-replenish:** while building, when the hand stack runs out it refills from the main inventory with the same item. When none remain:
- the hand empties;
- or, with *Pick ghost item if no items are available* on (Interface; default off), it becomes a **ghost cursor** for that item.

**Persistence:**
- The hand persists across opening and closing any window.
- Windows are **non-modal**: with the inventory open you can still walk (WASD) and build with the hand.

**In remote view**, every pick yields a ghost cursor. You cannot teleport items, so building places ghosts.

**Build direction:**
- The cursor carries one current direction. It persists between placements and item switches.
- R / Shift+R and pipette set it (pipette copies the source entity's direction).
- *(Inferred: persistence across item switches.)*

### 3.3 Building one entity

**Snapping:**
- Odd footprints centre on the cursor tile.
- Even footprints snap to the nearest tile corner.

**Preview:** the entity sprite, semi-transparent, tinted from `utility-constants.build_preview_tints`. Themes may change hue but not semantics.

| State | Tint (RGBA) | Meaning |
|---|---|---|
| buildable | (0.4, 1, 0.4, 1) green | Can build here now |
| buildable_too_far | (0.6, 0.6, 0.3, 0.1) faint yellow | Valid spot but out of reach (a ghost via Shift is still possible) |
| not_buildable | (1, 0.4, 0.4, 1) red | Collision, water, needs resources, … |
| ignorable | (0.4, 0.4, 1, 1) blue | Blueprint entity exactly over an identical entity (no conflict) |

**Context previews while holding** (these do much of the teaching):
- **Any electric entity:** every pole's supply area tinted. A held pole also shows its own supply area and links to the poles it would connect to.
- **Mining drill:**
  - its mining area;
  - the ore under it;
  - **"Expected resources"** in the tooltip.

  It is placeable only if the area touches a minable resource.
- **Inserter:** pickup and drop markers; the source and target entities are highlighted.
- **Underground belt / pipe-to-ground:** a line to the partner it would pair with; **green at maximum distance** (FFF-388).
- **Belt:** which neighbours it would connect to.
- **Assembler / furnace / lab:** inserters that would serve it are highlighted.
- **Radar:** coverage on the minimap.
- **Offshore pump:**
  - placeable only on a shoreline;
  - **auto-orients to face the water**;
  - fluid icon of what it will pump.

**Placing:**
- LMB consumes one item and plays the build sound (sized: small, medium, large).
- Failure → flying text with the **reason**. Examples (wording ours):
  - "Can't build here: Iron chest in the way";
  - "Can't build on water";
  - "Out of reach";
  - "Must be placed over resources";
  - "Not enough room";
  - "Would mix fluids" (0.17).

  Plus the build-error sound.

**Rotate (R) and flip (H/V):**
- The selected built entity rotates instantly at any distance (2.0, FFF-380). Rotation and flip are undoable (2.0.56).
- Entity-specific rules:
  - inserters turn 90°;
  - drills turn their output;
  - **underground belts swap input ↔ output of the pair** (reverses flow);
  - pumps reverse;
  - crafting machines rotate their fluid boxes.
- Flip mirrors around the entity's axis of symmetry and is refused for asymmetric entities ("can't be flipped"). In 2.0 this covers assemblers (mirrors fluid ports); **[2.1]** adds inserters, burner drills and pumpjacks.
- The held item or blueprint rotates and flips the same way.

**Fast-replace.** Placing an item over an existing entity of the same `fast_replaceable_group` **replaces** it.

| Group | Members |
|---|---|
| `transport-belt` | belts, undergrounds, splitters of all tiers, cross-type |
| `inserter` | burner, inserter, fast, bulk (long-handed is its own group) |
| `container` | wooden, iron, steel chests |
| `furnace` | stone, steel |
| `assembling-machine` | tiers 1–3 |
| `electric-pole` | poles (in 2.0 also "by moving": dragging new poles over old ones) |
| `pipe` | pipe ↔ pipe-to-ground |
| `lab`, `boiler`, `steam-engine`, `offshore-pump`, `radar` | each with itself |

Fast-replace:
- Returns the old entity's item to your inventory. It is refused with "Not enough space" if the item can't fit *(inferred)*.
- Keeps **contents** (chest items, machine inputs and outputs, fuel), **settings** (recipe, filters, limits, circuit wires) and **wires**.
- **Changes direction** if the held direction differs. For belts this is the standard way to turn a belt.
- Works on ghosts and with ghost-building (1.1): ghost-placing over a real entity creates an upgrade order plus a direction change. This matters later, when there are bots.

**Ghosts** (Shift+LMB, P1):
- Semi-transparent, using the 2.0 "ghost shader" look (blue hologram, shimmer). Ghosts change tint once a robot is assigned to them.
- No range limit.
- Placing the real item onto a ghost builds it with the ghost's stored settings (recipe, direction).
- Ghosts the player places last forever. Ghosts of destroyed entities expire after 1 week.
- Without bots (the slice), ghosts are planning marks that you fill by hand.
- **Forced build (Shift):** trees and rocks in the way get deconstruction marks. Cliffs only once cliff explosives are researched (FFF-388).
- **Super-forced (Ctrl+Shift):** P2.

**Ghosts with bots** (P2: these are the rules the ghost UI must already support):

**Who builds a ghost.** A construction robot builds it when either holds:
- the logistic network covering it has the item and a free robot;
- the player's **personal roboport** is in range and the item is in the player's inventory. Personal robots fly from the player and return to them.

Robots take the item from the network (or the player) and fly it to the ghost. Tile ghosts are scheduled separately from entity ghosts, so floors never starve buildings (0.17).

**Feedback:**
- A ghost **changes tint once a robot is assigned** (FFF-380). You can see at a glance which ghosts are being served.
- Ghosts that can't be served raise the alerts *"X entities are missing the material for construction"* and *"… missing construction robots"* (§4.14).
- The map colours robots by role: construction yellow, personal green, mobile cyan (§4.11).

**Ghosts left by destruction:**
- After *Construction robotics* is researched, destroyed buildings leave a ghost.
- It carries the old settings and expires after 1 week, shown by a purple time bar.

**Orders that ride on ghosts.** Item requests (fuel, modules) attached to a ghost are delivered together with the build:
- from a remote GUI ghost picker (§4.6);
- from fast-transferring modules onto a ghost **[2.1]**.

**Super-forced placement (P2):**
- Marks colliding player entities for deconstruction.
- The ghost waits until they are removed.
- Over belts it auto-places underground ghosts (FFF-383).

### 3.4 Drag building (hold LMB and move)

**General:**
- While LMB is held with a placeable, every cursor move tries to build the next entity.
- The line **locks to the axis of the first movement**. Entities are placed **adjacent** (step = footprint), so a row of furnaces or assemblers is a single gesture.
- Each placement is reach-checked. You can walk along while dragging (WASD + LMB); "build on the edge of reach while moving" is tuned so that lines don't gap (1.1.x).
- One drag = **one undo action** (2.0.34).
- A drag also **fast-replaces** what it passes over: dragging fast belts over yellow ones upgrades them; dragging with a different direction re-orients.
- "Interrupted when there is nothing to build from in the cursor" (2.0).

**Belts (smart belt building; Interface setting, default on; 1.1.9+):**
1. **Lock to line:** belt drags stay in a straight line in the drag direction (setting "lock belt building to line", default on). Belts face the direction of travel.
2. **Bend by rotating:** while dragging, press **R** (or Shift+R). The belt under construction turns, and the drag continues in the new direction ("fast belt bending" tip). One key press makes a corner without releasing the mouse.
3. **Obstacle traversal:** when the drag runs into an obstacle (an entity, a *perpendicular* belt, or a belt you must not side-load) and you hold undergrounds of the same tier:
   - an **underground entrance** goes on the last free tile before the obstacle;
   - the matching **exit** goes on the first free tile after it, as soon as the cursor reaches it;
   - if the gap exceeds the tier's maximum, flying text "Too far to connect" (2.0.x).

   Without undergrounds, the drag stops at the obstacle instead of side-loading. In 2.0.48+, a splitter that already has something on the lane also counts as an obstacle.
4. **Overbuilding a gap:** dragging across a gap in an existing belt line with belts on both sides makes the underground there too (2.0.7).
5. **Do not** implement 2.0.61's "drag back to remove the belts you just built": Wube reverted it in 2.0.66.

**Underground belts and pipes-to-ground (2.0 "smart dragging"):** holding one and dragging places pairs at the **maximum span**:
- the entrance first;
- then an exit at max distance;
- the next entrance adjacent to it;
- and so on.

The starting piece may be an existing one (1.1).

| Item | `max_distance` | Gap (tiles) |
|---|---|---|
| Underground belt (yellow) | 5 | 4 |
| Fast underground belt | 7 | 6 |
| Express underground belt | 9 | 8 |
| Pipe-to-ground | 10 | 9 |

**Electric poles:**
- Dragging builds the next pole **once the distance to the last pole reaches the wire reach** (small pole 7.5, medium 9) (1.1.x).
- If you pass unpowered entities that would otherwise be left uncovered, it places the pole **early** to cover them ("pole-dragging coverage" tip).
- Poles **auto-connect** to all poles within reach that have **no common neighbour** (avoids redundant triangles). 2.0 removed the old 5-connection cap.
- If the starting pole carries circuit wires, dragging carries them along (2.0).
- When a pole is removed, wires are re-routed between its neighbours like copper wires (2.0).

**Pipes:**
- Plain drag, with the same lock-to-line behaviour.
- Previews refuse fluid mixing ("Would mix fluids").
- **[2.1]** A fluid-mixing warning icon shows until the conflict is resolved.

### 3.5 Underground pairing (belts and pipes)
- With an underground in hand, the preview searches **backwards** along the held direction for an unpaired entrance of the same type within max distance. If found, the preview becomes the **exit** and draws a connecting line, **green when exactly at max range** (2.0).
- Placing the exit pairs them. An underground placed with no partner in range is an entrance.
- The pairing is blocked if a ghost or underground of the same type in between would take the pair (0.13 rule). It can be blocked by certain tiles (2.0; SA lava, space).
- **Rotating** either end reverses the pair. A lone underground can be rotated to act as a lane blocker (classic trick, keep it).
- Belt-side rule: the half of an underground tile with a belt can accept side-loading; the tunnel half blocks it. This is mechanics, but the preview must show it.

### 3.6 Inserter orientation — ISO: there is no auto-orientation
- Factorio does **not** auto-orient inserters. Orientation is the cursor's build direction, which persists, so a row of inserters keeps the same orientation (drag-build or repeated clicks).
- What makes it feel good instead:
  1. The preview shows the **pickup and drop points**, and **highlights** the entity the inserter would take from and the one it would put into.
  2. Pipette copies direction.
  3. Alt-mode draws the arrows on placed inserters.
  4. R on a placed inserter turns it in place, at any distance.
  5. Ghost long inserters spawn pre-stretched (2.0.25; cosmetic).
- *Rejected BEND:* "smart" orientation (e.g. belt → machine by default). It would fight 10+ years of muscle memory and give a veteran wrong guesses on ambiguous tiles. Real auto-orientation exists only where the answer is unique: **offshore pump** (faces water) and **underground exits** (pairing, §3.5).

### 3.7 Mining (by hand)

**Hold RMB on the selected object:**
- Mining progress shows as a thin bar centred above the quickbar *(position inferred)*.
- Mining speed: character mining speed 0.5 × (1 + bonuses).
- Time = `mining_time` / speed:

| Target | `mining_time` | Hand time |
|---|---|---|
| Ore | 1 | 2 s per item |
| Most buildings | 0.1–0.3 | 0.2–0.6 s |
| Trees, rocks | prototype-specific | longer |

**Behaviour while holding:**
- Holding keeps mining: the same ore again and again, or the next entity the cursor sweeps over (**drag-mining**).
- Resources need reach 2.7; entities need 10.

**Results:**
- Results go to the inventory with flying text "+1 Iron ore (57)" (icon, delta, new total).
- Mining an entity with contents (chest, furnace, assembler) moves the contents into the inventory too.
- **When the result does not fit** (corrected 2026-10-20 from Factorio 2.0.77 tests, C1c):
  - Mining is **not** refused up front: the progress bar fills normally.
  - At completion nothing is removed (the ore amount, the entity and the tree all stay) and nothing is dropped
    on the ground. The bottom-left message reads `Cannot insert Iron ore. Inventory is full.`
  - While the mine button is held, the bar restarts and the cycle repeats: mining goes on, and the message
    repeats at each completion.
  - If part of the result fits, mining delivers until the inventory is full.
  - Changelog 2.0.67: "Changed manual mining when the inventory is full to not drop the mined result on the
    ground." Before 2.0.67 the result was dropped.
- **Mining an entity whose contents do not all fit** (corrected 2026-10-20 from Factorio 2.0.77 tests, C1c): at completion the contents that fit move into the
  inventory, the first slots first (flying text such as "+300 Copper plate (300)"), the bottom-left message
  `Cannot insert Copper plate. Inventory is full.` appears, and the entity stays with the remaining contents.
  If the contents fit but the entity's own item does not, the contents move and the entity stays. The next
  completion tries again (changelog 0.10.9: "the mining just fails, while player gets as many items from the
  chest as possible").
- Deconstruction-marked entities can still be hand-mined.

**Other mining cases:**
- **Ground items:** RMB mines them; F picks up everything within 1 tile, including items on belts next to you.
- **Remote view:** "mine" on an entity = mark it for deconstruction (FFF-380).
- **Undo:** hand-mining a built entity is undoable (it becomes a ghost to rebuild).

### 3.8 Inventories and transfers

**Inside any GUI showing two inventories** (always *player inventory left, entity right*, FFF-363), on slot *s*:

| Input | Hand empty | Hand holds item X |
|---|---|---|
| LMB | Pick up the whole stack of *s* | *s* empty: put the hand down. *s* holds X: merge up to the stack size. *s* holds Y: **swap**. |
| RMB | Take **half** (rounded up) | Put **one** X into *s* (if allowed) |
| Shift+LMB | Move stack *s* to the other inventory | (same, acts on *s*) |
| Ctrl+LMB | Move **every** stack of that item to the other inventory. On an **empty** slot: move **everything**. | ← |
| Shift+RMB | Move **half** of stack *s* to the other inventory | ← |
| Ctrl+RMB | Move half of all stacks of that item (rounded up). Empty slot: half of everything. | ← |
| MMB | Toggle a filter on *s* (P2) | Filter *s* to X |
| Z | Insert one item into *s* (2.0.35) | |

**Transfer details:**
- **Destination rules:** the destination is the "other" inventory: the entity's *accepting* slots (fuel → fuel slot, ingredients → input, science → lab), or the player's main inventory.
- **Filtered or restricted slots** reject wrong items silently and show their filter icon. Furnace result slots accept only results of that furnace (0.17).
- **Only the character screen open:** shift-transfers move guns, ammo and armor into the equipment slots on the HUD. With a logistics panel (P2) they move items to trash.
- **Auto-sort:** the main inventory **auto-sorts** by item order (group → subgroup → order string). Filtered slots and the hand slot keep their place; partial stacks merge. This is an Interface setting, on by default.
- **Partial transfers** (corrected 2026-10-20 from Factorio 2.0.77 tests, C1c): Shift and Ctrl transfers move what fits and leave the rest in the source slot.
  - **Player inventory → entity:** no message and no flying text, whether part or nothing fits.
  - **Entity → player inventory:** what fits moves; when something does not, the bottom-left message reads
    `Cannot insert Iron plate. Inventory is full.`

**The inventory limit** (the red X bar of chests; 2.0.77 tooltip: "Limit part of the inventory so it cannot be
filled by machines") (corrected 2026-10-20 from Factorio 2.0.77 tests, C1c):
- **Respect the limit** (fill only the slots before the bar, and never top up a stack sitting in a red slot):
  inserters; logistic and construction robots; Shift+LMB and Ctrl+LMB from the player's inventory (partially if
  needed; silently nothing when the usable slots are full); Ctrl+LMB / Ctrl+RMB on the chest in the world; Z;
  script inserts (`LuaInventory.insert`).
- **Bypass the limit:** LMB with a stack in the cursor places it in a red slot; RMB places one item there. Wiki
  "Stack": "the player is still free to manually place items in the unused (red) slots".
- **Taking items out is never limited:** the player picks up from red slots, and fast transfer out of the chest
  takes red-slot items too (kovarex, forums t=21002: "The restriction is restriction of input, not of output").
- **Lowering the bar below occupied slots** leaves the items where they are; the chest then accepts nothing more
  until those slots drain.

**Fast transfer in the world** (Ctrl+LMB / Ctrl+RMB on an entity; hold and sweep across many entities, each entity once per sweep):

| Hand | Ctrl+LMB | Ctrl+RMB |
|---|---|---|
| Holding X | Insert as much of the hand as the entity accepts where an inserter would put it: fuel slot, recipe inputs, furnace source, lab packs, chest, module slots | Insert half of the hand |
| Empty | Take what an inserter would take: assembler / furnace **output**, lab packs, chest contents (all that fit) | Take half |

- Flying text per transfer: "−50 Coal (12)" or "+48 Iron plate (312)".
- **When not everything fits** (corrected 2026-10-20 from Factorio 2.0.77 tests, C1c): holding X, the entity takes what fits (below its limit bar), with the
  flying text "−50 Iron plate (450)", and the cursor refills from the inventory; when nothing fits, nothing
  happens and no text appears. Empty-handed, what fits comes into the player's inventory with "+N" texts and the
  rest stays in the entity; the game shows `Cannot insert Iron plate. Inventory is full.` for what stayed, as it
  does for Shift/Ctrl transfers into a full inventory (*inferred from that test; this exact case was not
  tested*).
- Reach-checked (10).
- **[2.1]** Fast-transferring modules onto ghosts creates module requests.

### 3.9 Hand crafting and the crafting queue

**Crafting panel slots** (§4.4):
- A recipe slot shows a **count** = how many you can craft *now*, including chained intermediates. It shows nothing when 0.
- A **red background** marks recipes the character cannot hand-craft: smelting, fluid ingredients, or a category the character lacks.
- **Newly unlocked recipes** are highlighted (orange slot plus a "!" badge, also on the group tab) **until hovered** (1.1; setting "recipe notifications", default on).

**Click semantics:**
- LMB = 1; RMB = 5; Shift+LMB = all.
- **A request is clamped to what can be crafted now** (corrected 2026-10-20 from Factorio 2.0.77 tests, C1c): with ingredients for fewer crafts than asked
  (including chain-crafted intermediates), the affordable number is queued, without a message. Tested: RMB
  (craft 5) with plates for 3 gears queued 3; a chain request with raw materials for 2 inserters queued 2
  inserters with their intermediates (2 gears, 3 copper cable, 2 circuits). The Lua API agrees:
  `begin_crafting{count=5}` returned 3 and documents "The count that was actually started crafting".
- **Only when nothing can be crafted:** the flying text at the cursor reads **`Not enough ingredients.`** (locale
  `not-enough-ingredients=Not enough ingredients.`), with the error sound. Nothing is queued. (corrected 2026-10-20 from Factorio 2.0.77 tests, C1c)

**Tooltip colouring:**
- missing raw ingredients in **red**;
- ingredients that will be **chain-crafted** in **orange**.

**Chain crafting** (do exactly this):
1. For each ingredient, use the inventory first, *excluding* items reserved by earlier queue entries.
2. If short, and the ingredient has a hand-craftable recipe, recursively queue that intermediate (depth-first). Intermediates appear as **separate queue entries before** the parent, drawn in a "promised" style (`promised_crafting_queue_slot`).
3. Surplus from intermediate crafts is **available to later crafts in the same request** (0.13.14). Items you explicitly ordered are never consumed by other orders.
4. If a raw shortfall remains, the request shrinks to the count that can be crafted; only a count of zero is refused (`Not enough ingredients.`). (corrected 2026-10-20 from Factorio 2.0.77 tests, C1c)

**Queueing and progress:**
- **Ingredients are removed from the inventory at enqueue time.** Cancelling returns them, cascading through intermediates; intermediates already finished stay crafted.
- **A cancel is never refused** (corrected 2026-10-20 from Factorio 2.0.77 tests, C1c): the refund goes into the main inventory as far as it fits, and the rest
  is dropped on the ground around the character, with the bottom-left message `Cannot insert Iron plate.
  Inventory is full.` Tested: with one free slot, a 160-plate refund put 100 in the inventory and dropped 60; with
  a full inventory all 152 plates were dropped. An item already crafted but waiting for space is dropped too.
  Sources: Rseding91, forums t=93124 and t=131258.
- Consecutive clicks on the same recipe **merge** into one queue entry with a count.
- Craft time = recipe energy / crafting speed 1.0 (most early recipes take 0.5 s). Hand crafting runs at 1×, and machines have their own speeds (assembler 1: 0.5).
- Products go to the main inventory, with flying text "+1 Iron gear wheel (13)".
- Crafting **pauses** while the product can't fit (0.15): the queue holds at 100 % progress, nothing is dropped,
  and the bottom-left message reads `Cannot insert Iron gear wheel. Inventory is full.`; the craft finishes once
  space frees up. (corrected 2026-10-20 from Factorio 2.0.77 tests, C1c)
- Hand-crafted items count in production statistics (0.17).

**Crafting queue on the HUD** (bottom-left; §4.5):
- Slots 40 px, 10 per row (`crafting_queue_slots_per_row` = 10).
- The first slot shows the progress bar. Each slot shows the remaining count.
- Hover = recipe tooltip. LMB / RMB / Shift+LMB cancel 1 / 5 / all.

**Hand-crafting interplay:**
- **Do not** auto-craft on pipette or quickbar use; Factorio doesn't.
- The convenience is the queue itself plus *craft-all*.

### 3.10 Copy and paste entity settings (Shift+RMB → Shift+LMB)

**Copying:**
- Shift+RMB on a source remembers **that entity** (not a snapshot). The source must still exist when you paste.
- Only the last source is remembered (0.12).

**Pasting:**
- Shift+LMB on a target pastes. Hold Shift+LMB and move to paste onto every compatible entity you sweep over.
- In character view each target must be within reach (10). In remote view there is no limit.
- Pasting is **undoable** (2.0, FFF-412).

**What transfers:**

| From → to | Transfers |
|---|---|
| Same entity type or its upgrade tier | Everything in its GUI: recipe (assemblers), filters, stack-size override and conditions (inserters), chest limit bar, splitter priority and filter, circuit and logistic conditions, combinator settings, lamp colour, train stop names and colour |
| Crafting machine → requester chest (P2) | Requests sized for about **30 s** of that machine's crafting |
| Crafting machine → (filter) inserter or splitter *(inferred)* | Filter set to the recipe's product / ingredients. Verify in playtest; low priority. |

### 3.11 Undo / redo (Ctrl+Z, Ctrl+Y / Ctrl+Shift+Z)

**Scope:**
- manual build and mine;
- blueprint placement (including the wires it created and the settings it overwrote);
- deconstruction, upgrade and cancel orders;
- copy-paste of entity settings;
- wire edits;
- rotate and flip (2.0.56).

Hand-rotation spam is merged *(design: one action per entity per 2 s)*. A drag-build is one action.

**Feedback:**
- Flying text near the cursor describes what was undone: "Undo construction of Small electric pole", "Undo deconstruction of 33 entities".
- Undoing an action **older than 1 minute** asks for confirmation. The dialog previews the affected entities: ghosts to be built, highlights to be removed.
- The undo/redo shortcut buttons have tooltips that preview the next action and where it happens (FFF-412).

**How undo is realised:** undone *removals* come back as **ghosts**. With no bots (the slice), rebuild them by hand or with the item.
- *Slice-specific BEND (small):* if the player holds the item and is in reach, undo of a just-mined entity rebuilds it directly. Justification: no bots in the slice, so pure-ISO undo would leave ghosts the player must hand-fill.
- Alternative: keep ISO and accept ghosts. **Recommendation: keep ISO**, because ghost-filling by hand is fast with drag-build, and it teaches ghosts early.

### 3.12 Feedback channels (what the player sees and hears)

**Feedback channels:**

| Channel | Used for | Spec |
|---|---|---|
| **Flying text** (world space, rises and fades) | Inventory deltas, errors, undo info, "Not enough ingredients", "Cannot reach" | Lifetime `flying_text_ttl` = 80 ticks (1.33 s). Stack and offset repeats so they don't overlap. Icon + text. Errors in the warning colour. |
| **Error sound** | Every refused action | One "cannot" sound family, rate-limited (≤ 1 per 100 ms) |
| **Entity status LED + text** | In every entity GUI and tooltip | Three diode colours (`entity_status_diode`): **green** working / normal; **yellow** degraded (low power, low input fluid, charging); **red** stopped for any reason (no power, no fuel, no recipe, output full, waiting for source items, no ingredients, missing science packs, no research in progress, no minable resources, waiting for space in destination, marked for deconstruction, …). Use Factorio's `entity_status` vocabulary (74 values in 2.1). |
| **Warning icons on entities** (blinking, world space) | No power (red bolt), low power, **not plugged in** (unplugged plug), **no fuel** (red flame), missing fluid, **resources depleted** (drill), pipeline over-extended, too far from roboport (P2) | Shown only when relevant, visible at all zooms, also on the map |
| **Alerts** (HUD) | Global events | §4.14 |
| **Notifications / toasts** | Research completed (with unlocked recipe icons), autosave, achievements | §4.14 |
| **Tooltips** | Everything hoverable | §4.8 |
| **UI sounds** | GUI click, tab, open and close (per entity type, 2.0), inventory move (per item material, FFF-396), pipette, rotate, build (sized), mine (per material), craft finished, research finished, confirm (green button / E), alert | Audio is another agent's job. This list is the minimum set the UI must trigger. |

### 3.13 Pipette (Q with an empty hand)

| Target | Result |
|---|---|
| Built entity | The item that builds it, as a stack from the inventory, with **the entity's direction** (and flip). An entity marked for upgrade gives the *upgrade target* (2.0). |
| Ghost | That item (or a ghost cursor if you have none and the ghost setting is on) |
| Resource tile | The **best mining drill** you carry (fastest) |
| Water / fluid tile | **Offshore pump** (2.0) |
| Placeable tile (stone path, concrete) | That tile item (2.0) |
| Item on ground | That item (2.0.29) |
| GUI slot, recipe, crafting slot, logistic slot, quickbar slot, selection-list entry | That item (2.0) |
| Map tag | A copy of the tag (2.0) |
| Nothing in inventory | Nothing (flying text) — or a ghost cursor with the ghost setting |
| **[2.1]** Number key on an *empty* quickbar slot | Pipette *and* assign that slot |

### 3.14 Alt-mode (Alt toggles; default off)

Alt-mode shows the following overlays:

| Entity | Overlay | Pri |
|---|---|---|
| Crafting machines (assembler, chemical plant, refinery, centrifuge) | **Recipe icon** at the centre on a dark rounded backdrop | P0 |
| Furnaces | Current product icon | P0 |
| Mining drills | **Output arrow** at the drop position | P0 |
| Inserters | **Pickup and drop arrows** (Interface setting "show inserter arrows in alt-mode", default on); filter icons if filters are set | P0 / P2 |
| Splitters | Input and output priority arrows; filter icon | P1 |
| Fluid entities (boiler, steam engine, offshore pump, assembler with fluid boxes, pipe-to-ground pairs) | **Fluid connection arrows** (input / output) | P0 |
| Machines, labs, drills, beacons | Installed **module icons** along the bottom | P2 |
| Pumps | Fluid filter icon | P2 |
| Requester / buffer chests | Requested item icons. Storage chest: filter icon. | P2 |
| Train stops | Names | P3 |
| Combinators | Operation and signals | P2 |
| Minimap | Pollution layer appears only in alt-mode (keep for our pollution analogue) | P1 |
| **[2.1]** Holding a fluid entity | Pipeline visualisation only in alt-mode | P2 |

Alt-mode does **not** show chest contents in vanilla. Keep it that way: the docked tooltip shows contents on hover.

### 3.15 Camera, zoom, map transition

**Character view:**
- The camera is centred on the character.
- The wheel zooms *(the step is about ×1.1 per notch in world view and about ×1.25 in the map; community-measured)*.
- The closest zoom is **3×** (the engine default for most controllers, per the Lua API `ZoomLimits` docs).
- F9 resets to 1×; Shift+F9 = 2×.
- **[2.1]** Interface option "zoom towards cursor".

**Zooming out:**
- Zooming out past the furthest game-view zoom **switches seamlessly into remote view (chart rendering)**. Factorio 2.0 merged the zoom controls: "removed functionality to zoom in without leaving chart view". Shift no longer blocks the switch.
- Zooming in on the map past the threshold renders the real world again in radar-covered or nearby chunks. Elsewhere it shows the last charted snapshot under fog.
- Furthest-zoom numbers are configurable. Defaults:
  - game view to about 200 tiles across at 16:9 *(inferred)*;
  - chart to about 1/32 (default map zoom ≈ 0.031).

**Remote view** (Tab / M, or zoom out): the camera detaches from the character.
- WASD or LMB-drag pans.
- Tab / M / Esc returns to the character.
- **Everything you can do locally you can do remotely** (FFF-380), with a ghost cursor:
  - open and configure any charted entity, including ghosts;
  - rotate and flip;
  - mine = deconstruction mark;
  - paste settings;
  - selection tools;
  - pins, tags, search.
- Closing a window opened remotely and pressing **Alt+←** returns you to where you were (browse history).

**Fog of war:**
- Uncharted chunks are black.
- Charted chunks not currently watched (no radar or character coverage) render as the last snapshot, dimmed. This also applies in normal view in 2.0.

**Charting:** the character reveals 5×5 chunks around itself. Radar coverage belongs to the economy spec; this spec only consumes "charted / visible" flags.

---

## 4. Screens and panels

### 4.0 GUI framework (shared by every window)

**Window anatomy:**
- **Title bar:**
  - title at left (heading font, 18 px bold);
  - a ridged **drag handle** filling the gap;
  - **frame action buttons** at right (24 px): search 🔍, back / forward ◀ ▶ (where history applies), extra actions (e.g. circuit-network and logistic-network connection buttons on entities), close ✕.
- **Body:** *deep* panels (dark, inset: inventories, lists, previews) and *shallow* panels (lighter: settings).
- **Padding:** 8 px (top 4) inside frames; spacing on a 4 px grid.

**Slots:**
- **40×40 px**, icon 32 px.
- **Count** at bottom-right in a bold outlined font.
- **Durability / ammo / health bar** under the icon.
- Optional **quality** pip at bottom-left (SA).
- States:
  - normal;
  - hover (highlight);
  - selected / hand (marked);
  - red (invalid or not craftable);
  - yellow / orange (new or attention);
  - filter (filter icon dimmed in an empty slot).
- Grids are **10 slots wide**:
  - `inventory_width`;
  - `select_slot_row_count`;
  - `logistic_slots_per_row`;
  - `crafting_queue_slots_per_row` (all = 10).
- Selection lists show item-group tabs **6 per row** (`select_group_row_count` = 6).

**Other widgets:**
- **Buttons:** min 108×28; green = confirm; red = destructive; grey = normal; a small square icon button is a "tool button".
- **Tabs:** min width 84; a badge shows counts or "!".
- **Fonts:** 14 px default; 12 small; 18 large / heading-1; 15 heading-2. Specific typefaces are theme-dependent.
- **Tooltips:**
  - frame 88% opacity with background blur;
  - description max width 356 px;
  - follow the cursor, flipping away from screen edges (10 px border);
  - the entity tooltip docks right by default (§4.8.3).

**Window rules:**
- **One "main" window at a time** (character screen, an entity, tech, statistics, Factoriopedia, library, …). Opening another replaces it and pushes the old one onto the **browse history** (Alt+← / → or the arrow buttons).
- Small dialogs (rename, choose item, confirm) stack modally on top.
- Windows remember their position per window type. Default position: centred.
- **E confirms, Esc cancels** (§1.4).
- The **game keeps running** while windows are open, except:
  - the **technology screen** pauses single player (hidden setting `technology-gui-pauses-game` = true);
  - the **game menu** (Esc) pauses single player.
- **Search** exists "in every window where it's even remotely relevant" (FFF-400). Ctrl+F focuses it.

**UI scale:**
- Automatic by window height (100% at 1080p, 125% at 1440p, 150% at 4K-class windows; mirror Factorio's auto scale).
- Ctrl+Numpad± steps 25%. The scale multiplies all GUI px; world rendering is independent.

### 4.1 The HUD (screen map)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ [toasts: research done, autosave]      ┌────────────────────────────────────┐ │
│                                        │ Research widget  (icon, name, bar) │ │
│                                        │ Side-menu buttons (2 rows × 6)     │ │
│                                        │ Minimap  (≈ 240×240)               │ │
│                                        │ Pins list (edit ✎ / delete 🗑)     │ │
│                                        │ Docked entity info (tooltip)       │ │
│                                        └────────────────────────────────────┘ │
│    (off-screen pin and alert arrows at the screen edges, with distance)       │
│                                                                               │
│ [chat / console log, fades]                                                   │
│ [crafting queue 10/row]                                                       │
│                        [  mining progress bar  ]           [alert slots]      │
│ [armor|gun×3 / ammo×3]  [1|quickbar 10][2|quickbar 10]     [shortcut bar ⋮]   │
└───────────────────────────────────────────────────────────────────────────────┘
```

| Element | Content and behaviour | Pri |
|---|---|---|
| **Research widget** | Idle: "Press **T** to start a new research." Researching: technology icon, name, green progress bar, %. Click → technology screen. Tooltip → *Science production information* (§4.10). | P0 |
| **Side-menu buttons** (above the minimap, 2 rows of 6 icon buttons, each with a hotkey tooltip) | Open: technology (T), production statistics (P), logistic networks (L), blueprint library (B), bonuses, Factoriopedia, trains (O), achievements, tips and tricks, players (MP only), and **[2.1]** alerts configuration. Show only the unlocked ones. | P1 (tech button P0) |
| **Minimap** | Chart of the area around the character. Click → remote view there. Shift+Alt+Wheel zooms (**[2.1]** Shift+Wheel). Shows radar coverage while holding a radar. The pollution layer shows in alt-mode. Can be hidden in settings. | P1 |
| **Pins list** | Under the minimap: one row per pin (icon, caption, ✎, 🗑). Drag to reorder. Hover = camera preview. | P1 |
| **Docked entity info** | The selected entity's tooltip, docked right under the pins (default). Scrolls with Shift+Wheel when tall. | P0 |
| **Weapons and armor panel** (bottom-left) | Armor slot (character portrait), 3 gun slots with 3 ammo slots under them, a health bar along the left edge. Click a slot to put the hand in or take from it. In a vehicle, the vehicle's panel appears beside it. Peaceful slice: show only armor, or hide entirely (decided by R1-F / R1-B). | N/A–P2 |
| **Crafting queue** | Above the weapons panel (§4.5) | P0 |
| **Chat log** | Above the crafting queue. Messages stay fully opaque, then fade during their last 2 s. Duration is a setting. | P1 |
| **Quickbar** | Bottom centre (§4.2) | P0 |
| **Shortcut bar** | Right of the quickbar (§4.3) | P0 (alt-mode button) / P1 |
| **Alert slots** | Just above the shortcut bar (§4.14) | P2 |
| **Mining progress bar** | Centred above the quickbar while mining by hand | P0 |
| **Toasts** | Top left (our choice): research completed (icon + unlocked recipe icons; click = open the technology), autosave, achievements | P0 (research) |
| **Edge arrows** | Pins and hovered alerts: arrow at the screen edge plus caption and distance ("Cleanup nests (651 m)") | P1 |
| **Hide GUI** | Ctrl+Shift+F4 hides everything above | P1 |

### 4.2 Quickbar

**Layout:**
- **10 pages × 10 slots.** 1–4 pages are visible as stacked rows (Interface "Active quickbars", **default 2**). The top visible row is the "primary" one.
- A **page-number button** sits left of each row. Clicking it lists all 10 pages; clicking one moves it into that row.
- The quickbar **is not an inventory**: slots are links to an *item type* (or to a blueprint, book or planner in the inventory or library).

**Slot display:**
- The total count of that item you carry (hand included), at bottom-right.
- **Dimmed with no number** when you carry none.
- Highlighted while that item is in the hand.

**Setting a slot:**
- LMB on an empty slot opens the item chooser (only unlocked items unless "show all").
- LMB or MMB on an empty slot **with an item in hand** links that item.
- MMB clears a slot (macOS: Cmd+RMB).
- A slot must be cleared before re-linking, unless the Interface option *change quickbar slot by clicking with a different item* is on (default off).
- **[2.1]** The number key on an empty slot = quick pipette and assign.

**Using a slot:**
- LMB (or key 1–0) puts **one stack** of that item into the hand; RMB puts half a stack.
- If you carry none:
  - nothing happens ("No items" flying text);
  - with *Pick ghost item if no items are available*, you get a ghost cursor instead.
- Using a slot while holding something else **replaces** the hand: the old stack returns to its slot.
- RMB on a blueprint, book or planner slot opens its GUI.

**Keys:** 1…0 = top row; secondary 1…0 = second row (unbound); Shift+1…0 = choose the page for the top row; X = rotate rows.

**Persistence:** saved per player in the save.

### 4.3 Shortcut bar

**Layout:**
- Icon buttons (56 px since 2.0.18), right of the quickbar.
- Rows: Interface "Shortcut bar rows"; up to 12 wide (2.0).
- The **⋮** button opens the configuration popup: a checkbox per shortcut plus a drag handle to reorder.

**Button types:**
- **Toggle:** pressed look while on (alt-mode yellow when active).
- **Spawn:** puts a tool in the cursor.
- **Action:** undo / redo, disabled when there is nothing to do.

**Tooltip:** name + hotkey ("Make blueprint (**Alt + B**)"), description, and a "When in cursor:" usage list.

**Contents and unlocks** (base `shortcuts.lua`):

| Shortcut | Unlock |
|---|---|
| Alt-mode | Always |
| Undo, redo, copy, cut, paste, import string, blueprint, blueprint book, deconstruction planner, upgrade planner | *Construction robotics* (once researched in any save; `/unlock-shortcut-bar` unlocks all) |
| Copper wire | *Electronics* |
| Red / green wire | *Circuit network* |
| Personal roboport / exoskeleton toggles | Their equipment techs |
| Spidertron, artillery, discharge remotes | Their techs |
| **[2.1]** Toggle tall entities | SA |

**Slice:**
- Alt-mode (P0) and copper wire (P1).
- Ctrl+Z works from the start even though the undo *button* appears later (ISO).

### 4.4 Character screen (E)

**Default "flat" layout** (Interface *Flat character GUI*, default on since 1.1): three side-by-side panels in one window.

```
┌ Character ───────────── [color] ┬ Logistics (after research) ─┬ Crafting ──────────── [🔍][✕] ┐
│ Main inventory 10 × 8 (=80)     │ ☑ Personal logistics         │ [Logistics][Production]        │
│ (scrolls if bonuses add rows)   │ ☐ Trash unrequested          │ [Intermediates][Combat]        │
│ auto-sorted, hand marker,       │ sections ▸ request slots     │ ┌10 cols────────────────────┐  │
│ filtered slots                  │ [Add section]                │ │ one row per subgroup;      │  │
│                                 │ Trash slots (10/row)         │ │ slot = recipe icon +       │  │
│                                 │                              │ │ craftable count            │  │
└─────────────────────────────────┴──────────────────────────────┴────────────────────────────────┘
```

**Character (inventory) panel:**
- 80 slots base (`inventory_size` = 80); bonuses add rows.
- Title "Character" (or the player name), a colour-picker button, and a scroll pane.
- Since 1.1 the old *Character* tab is gone: guns, armor and stats live on the HUD.

**Logistics panel (P2):**
- Personal logistic requests in named **sections** (logistic groups, FFF-382) with min/max per item;
- "Trash unrequested";
- trash slots.
- Absent until researched.

**Crafting panel:**
- Item-group tabs: 4 in the base game (Logistics, Production, Intermediate products, Combat). Each tab gets a "!" badge if it contains a new recipe.
- The grid below is **10 columns**. Each **item subgroup starts a new row**; within a row, items are sorted by `order`.
- Only **unlocked** recipes are listed.
- A search field (Ctrl+F) filters across all groups.

**Recipe slot:**
- **count** = craftable now (0 → no number);
- **red background** = not hand-craftable;
- dimmed = 0 craftable;
- **new-recipe** orange highlight with "!" until hovered.
- Tooltip §4.8.2. Clicks per §2.4.

**Tabbed layout** (setting off, or small windows): one panel with tabs Logistics / Character / Crafting, switched with F1 / F2 / F3. This is also how wide GUIs (rocket silo, hub) fall back on small screens.

**Window size:** each 10-wide panel of 40 px slots needs ≈ 440 px.
- The slice has two panels (inventory + crafting), ≈ 880 px, which fits 1280×720 at 100% scale.
- With the logistics panel (P2), the flat window needs ≈ 1320 px. Below the needed width (after UI scale), **auto-switch to the tabbed layout**. That is how Factorio handles wide GUIs on small screens.

### 4.5 Crafting queue (HUD, bottom-left) — P0
- A row of 40 px slots above the weapons panel, wrapping at 10 per row, filled left to right in execution order.
- **Slot 1** shows a progress bar; each slot shows its remaining count.
- **Intermediate** (auto-queued) entries use the "promised" style (darker or tinted).
- Hover = recipe tooltip, plus *(BEND, small)* "≈ N s remaining for this entry / the whole queue". This is pure information, cheap and veteran-friendly. If vanilla lacks it, keep it because it changes nothing mechanically.
- LMB / RMB / Shift+LMB = cancel 1 / 5 / all. Cancelling an entry also cancels its auto-queued intermediates and refunds ingredients.
- The queue is visible even when the character screen is closed. When it empties, the panel collapses.

### 4.6 Entity GUIs (open with LMB)

**Common skeleton** (1.1 unification, FFF-363; 2.0 additions, FFF-426). The **player inventory** is always the left panel; the **entity panel** is on the right:
1. **Status line:** LED (green / yellow / red) + status text (§3.12).
2. **Preview:** a live, animated view of the entity on a checkerboard backdrop. It spans the panel width with a unified height (about 150–230 px at 100% scale in the 1.1 / 2.0 screenshots).
3. **Entity-specific body** (below).
4. **Title-bar buttons:** circuit-network ⛓ and logistic-network 📶 connection buttons when the entity supports them (2.0: always visible) — P2. Rename ✎ where entities have labels. Close ✕.

**Status texts:** use Factorio's `entity_status` vocabulary as a checklist:
- working;
- no power / low power;
- no fuel;
- not plugged in;
- no recipe;
- item ingredient shortage;
- fluid ingredient shortage;
- output full;
- waiting for source items;
- waiting for space in destination;
- no minable resources;
- missing science packs;
- no research in progress;
- marked for deconstruction;
- disabled by control behaviour; …

**Per-entity bodies (vertical slice):**

| Entity | Body (top to bottom) | Pri |
|---|---|---|
| **Chest** (wooden 16, iron 32, steel 48 slots) | Title = chest name. A 10-wide inventory grid. A **limit bar**: a red ✕ button at the end of the last slot; click it, then click a slot to set the limit there. Slots beyond the limit turn red. Inserters won't fill red slots; the player can. To clear the limit, set it past the last slot again *(inferred)*. | P0 (limit P1) |
| **Stone / steel furnace** | Status, preview. Row: **source slot** → progress bar → **result slot**. Row: **fuel slot** with a "burning" bar (remaining energy of the current fuel item). **[2.1]** recipe info line (current smelting recipe). Furnaces pick their recipe from the input automatically; there is no recipe chooser. Only compatible results can be placed in the result slot (0.17). | P0 |
| **Assembling machine** | Status, preview. **Recipe line** (2.0, FFF-426): recipe icon + **recipe name** + gear ⚙ "change recipe" button. Hovering the recipe line shows the *recipe* tooltip; Alt+click opens the recipe in Factoriopedia. Row: **ingredient slots** (one per ingredient, counts shown) → progress bar (plus a purple productivity bar) → **product slot(s)**. Slots behave as normal inventory slots: item tooltip, Alt+click → item page. Below: **module slots** (2 on assembler 2; P2). **No recipe set:** the body is the **recipe chooser** (§4.7). Choosing a recipe returns any incompatible items to the player. Changing the recipe returns contents to the player. | P0 |
| **Inserter** | Status (e.g. "Waiting for space in destination"), preview, the **held-item** slot (shows what's in the hand). **Filters** (all inserters in 2.0): checkbox *Use filters*, whitelist / blacklist switch, **5 filter slots** (`filter_count` = 5) — P2. **Override stack size:** checkbox + slider + number field (1 … current bonus cap) — P2. Circuit / logistic buttons — P2. | P0 (status + held item) |
| **Burner mining drill** | Status, preview. **Fuel slot** + burn bar. **Mining progress** bar. Resource readout: "Mining: [ore icon] Iron ore", "Resources remaining: 12 345" (under the drill's area). Output goes to the tile in front; no output slot. | P0 |
| **Electric mining drill** | As above without fuel; energy satisfaction is in the tooltip. 3 module slots (P2). | P0 |
| **Lab** | Status ("Working" / "No research in progress" / "Missing science packs"). Science-pack input slots: one per pack type the game defines, **filtered** (packs not yet unlocked are dimmed). Module slots (2; P2). Research progress is shown in the research widget, not duplicated here. | P0 |
| **Boiler** | Status, preview, **fuel slot** + burn bar. **Fluid boxes:** water in, steam out, drawn as vertical gauges with fluid icon, amount and temperature in the tooltip ("Steam 200/200, 165 °C"). | P0 |
| **Steam engine** | Status, preview, steam fluid gauge, **power output** "x kW / 900 kW". | P0 |
| **Offshore pump** | Status, preview, output fluid + rate (1 200/s). 2.0: optional fluid filter (P2). | P0 |
| **Electric pole** | Opens **Electric network info** (§4.16) for that pole's network. Hover tooltip: network satisfaction. | P1 (basic bars P0) |
| **Splitter** | Input priority (left / none / right) and output priority switches, filter slot | P1 |
| **Pipe / storage tank** | Fluid name, amount, temperature. **[2.1]** pipeline statistics and "visualize segment" checkbox. | P1 |
| **Belt / underground** | No GUI unless the circuit network is connected (P2) | — |
| **Radar** | Status, preview, scanning progress | P1 |

**Remote opening (P1 with remote view):**
- Any entity, and **any ghost** (configure before it's built: FFF-380), can be opened from remote view.
- The left panel then is **not** your inventory, because items can't teleport. Inventory slots show a **ghost picker**: clicking a slot with a ghost cursor creates an *item request* (fuel, modules) that robots will deliver; removing creates a removal request.
- In the slice (no bots) a remote GUI is configuration-only: recipe, filters, limits.

### 4.7 Choosers (recipe, item, signal)

**Recipe chooser** (assembler with no recipe; the gear button):
- **Group tabs** (6 per row), a grid of the **recipes this machine can craft**, and a **search** field.
- Unresearched recipes are hidden. Recipes with **too many ingredients** for the machine are shown **red** (0.17).
- The hover tooltip is the recipe tooltip. Click = set the recipe.

**Item chooser** (quickbar slot, filters, logistic requests, deconstruction filters): the same layout over items. It shows unlocked items only, unless the Interface option *show all items in selection lists*. Esc cancels.

**Count dialogs** (requests, limits): a number field (math allowed) plus a slider. E / Enter confirms.

### 4.8 Tooltips

**General rules:**
- Floating tooltips appear after the tooltip delay (setting). Hold **Shift** to show one immediately.
- Tooltips are layered panels:
  - a **title band** (name; for merged entries "(Recipe/Item/Entity)");
  - a description;
  - stat lines in "**Label:** value" form, with a ◆ marker where a value differs by quality (SA);
  - sections separated by rules.
- Every value uses **smart number formatting**: k / M suffixes, units W / J, time "1m35s".

**4.8.1 Item tooltip** (any item slot):
- name and description;
- for fuels, **Fuel value: 4 MJ**;
- **Stack size**;
- for placeable items, the key **entity stats** (crafting speed, energy consumption, max health, size);
- *(Our addition, information only:)* a footer hint "**Alt + click**: recipes, uses and sources". Factoriopedia answers "made in / used in"; vanilla item tooltips stop at the stats.
- Empty special slots show what they accept ("Fuel: [wood][coal][solid fuel]", 1.1.9).

**4.8.2 Recipe tooltip** (crafting slot, recipe chooser, assembler recipe line):

```
┌ Electronic circuit (Recipe) ─────────────────────────┐
│ Ingredients:                                          │
│   [ico] 1 × Iron plate                                │  red = missing
│   [ico] 3 × Copper cable                              │  orange = will be hand-crafted
│   ⏱ 0.5 s  Crafting time                              │
│ Products: (only if >1 or probabilistic)              │
│ Total raw:   [ico] 1  [ico] 1.5                       │  (only if ≠ ingredients)
│ Made in:  [character] [assembler 1] [assembler 2] …  │
├───────────────────────────────────────────────────────┤
│ (item tooltip of the main product)                    │
└───────────────────────────────────────────────────────┘
```

- **Total raw** decomposes through *hand-craftable* recipes only; it stops at anything the character can't craft (staff: it shows "what you need to craft this by hand").
- In the crafting panel, the count line gives "Craftable now: N" *(our phrasing; the same number as the slot badge)*.

**4.8.3 Entity tooltip** (hovering the world). It **docks to the right side** under the pins by default (Interface *Entity tooltip on the side*; floating with a delay is optional). Order (FFF-426 screenshot):
1. name;
2. description;
3. **status** (LED + text);
4. for crafting machines, the **recipe** with a **throughput line**: `[ingredients] 28.1 [ingredient] 84.4 ⇒ [product] 56.3 /s` at the machine's actual speed (2.0; "takes ghosts into account" in 2.1);
5. **Crafting speed** (with bonus %), Productivity, Pollution / m;
6. **Products finished** (count);
7. **Contents** (icons with counts);
8. energy section:
   - **"Consumes electricity":** Max. consumption, Min. consumption, an *Electricity* satisfaction bar;
   - **"Consumes burnable fuel":** fuel remaining.
9. **Health** x / y (only when damaged, or always: setting).

Drill: Mining speed, **Resources remaining** in its area, the resource. Pole: network satisfaction and a link "click for network info". Resource tile: name, **Amount** remaining, mining time. Tree / rock: mining time, results. Belt: speed (items/s).

**4.8.4 Technology tooltip:**
- name, state (Researched / Available / Unavailable), description;
- **Cost:** pack icons × units, ⏱ time per unit — or **Trigger:** "Craft 50 [Iron plate]";
- **Prerequisites** (missing ones red);
- **Effects** (unlock icons, bonus lines);
- action hints: "**Click** to select, **Shift+click** or double-click to add to the queue".

**4.8.5 Shortcut and quickbar tooltips:** name (hotkey), description, "When in cursor:" usage lines, the clear-slot hint (quickbar).

### 4.9 Technology screen (T) — P0

Single player: opening it **pauses the game**.

```
┌ Research queue ───────────────────────┬ Technology tree ─────────────── [◀][▶][✕] ┐
│ [cur][q1][q2][q3][q4][q5][q6]  (7)    │                    ☐ Show only essential   │
├ Logistics 2 (Available) ──────────────┤        (prerequisites above)               │
│ [big card] Cost: [R]1 [G]1 ⏱30 ×200   │              [ Automation science ]        │
│            Effects: [ico][ico][ico]   │         [Logistics]  [Logistic science]    │
│            Description…               │             ┏━━━━━━━━━━━━━━━━━━┓           │
│            [Start research]           │             ┃  LOGISTICS 2     ┃ selected  │
├ List of technologies ────────── [🔍] ─┤             ┗━━━━━━━━━━━━━━━━━━┛           │
│ [card][card][card][card][card][card]… │   [dep] [dep] [dep]   (dependents below)   │
│ 7 per row, scroll                     │   ⇣ more                                   │
└───────────────────────────────────────┴────────────────────────────────────────────┘
```

**Technology card** (`technology_slot` style):
- **72×100 px** (the selected one is larger);
- the icon;
- a **level band** (multi-level technologies);
- an **ingredient strip** (20 px; 16 px pack icons overlapping by 4);
- a 4 px green **progress bar** when partially researched;
- a queue-position badge when queued.

**Card states** (colour-coded; keep the semantics, theme the hues):

| State | Factorio colour | Meaning |
|---|---|---|
| researched | green | done |
| available | tan / yellow | all prerequisites researched |
| conditionally available | orange | every missing prerequisite is already queued |
| unavailable | red | missing prerequisites |
| disabled | grey | not enabled |

**Left column:**
1. **Research queue:** up to **7** entries. The first is the current research, with a progress bar.
   - Drag to **reorder** (2.0.21).
   - Hover → red ✕ to remove.
   - A removed or cancelled technology keeps its partial progress: progress is per technology, never lost.
   - The queue is **always on** (FFF-376).
2. **Selected technology:** title "Name (State)", a big card.
   - **Cost:** `[pack×n]… ⏱ t × units` (per unit; research time = t × units / Σ lab speed).
   - **Trigger technologies** show the trigger instead: "Craft 50 [Iron plate]" / "Mine [crude oil]" / "Craft [lab]".
     - *BEND (small, informational):* show progress "23 / 50".
     - Trigger technologies cannot be queued for lab research. They complete instantly when the trigger fires while they are available, then toast as usual.
     - "Craft" triggers count production by **any** producer of the force, machines included. Iron plates come from furnaces, never from the hand, so Steam power's "craft 50 iron plates" can only be met that way.
   - **Effects:** unlock icons (recipes, bonuses), each with a tooltip.
   - Description.
   - **[Start research]**: puts the technology in the queue. If prerequisites are missing, it **queues the missing prerequisites first, in dependency order** *(inferred; the community wiki only says "adds to the queue")*. If the queue would exceed 7: refuse with "Research queue is full".
3. **List of technologies:**
   - cards **7 per row**;
   - sorted: available → conditionally available → unavailable → researched (infinite technologies last, 2.0);
   - a search field (matches technology names **and** the names of what they unlock);
   - Shift+click or double-click to enqueue.

**Right column (tree):**
- A **focus graph** of the selected technology:
  - its full **prerequisite closure above**;
  - its **dependents below**, with dashed ⇣ stubs where more follow.
- Edges are orthogonal lines.
- Click a node to select it; the view re-centres on it.
- Pan by dragging; the scroll wheel scrolls.
- "**Show only essential technologies**" filters to the `essential` flag (the main path).
- This is **not** a global left-to-right map. See §7 on R1-C's "field line".

**History:** ◀ ▶ go back and forward through selected technologies (the generic browse history replaced "select previous technology" in 2.0.22).

### 4.10 Research progress and notifications — P0
- **Research widget** (HUD top-right): §4.1.
- **Tooltip** "Science production information" (FFF-423):
  - a line graph of science per minute over the **last 10 minutes**;
  - **Progress:** 91 / 200;
  - **Science per minute:** 16;
  - **Remaining time estimate:** 6m35s (from the last minute's rate).
- **Research completed** toast:
  - technology icon + "Research completed: Logistics 2" + the icons of unlocked recipes;
  - click = open the technology;
  - fades after about 10 s (stackable).
- **New-recipe highlights** in the crafting panel until hovered (setting, default on).
- When the queue empties: the widget shows the "Press T" prompt. *(Optional BEND: one soft chime.)*

### 4.11 Map / remote view (Tab, M) — P0 read-only, P1 full

**Title bar:** "Remote view", a **search** field + 🔍, ◀ ▶ (history), ⟲ (return to the character), ✕. The side column (research widget, buttons, minimap) stays visible on the right. **Quickbar and shortcut bar stay** (you can build remotely).

**Rendering:**
- **Chart rendering** when zoomed out: a simplified colour per tile and entity type.
  - Friendly entities: blue-grey shades by type.
  - Ghosts: purple.
  - Resources: their map colour.
  - Ore-patch outlines and labels with amounts appear when searched.
- **Real rendering** when zoomed in, for chunks currently visible to radar or character. Elsewhere: the last snapshot, under fog.
- Uncharted: black.

**Map overlay toggles:**
- Where: a grid of 12 small icon toggles in the side column (2.0) beside "Add tag" / "Add ping".
- Built as a **registry** (BEND-6), so new overlays plug in.
- Base set:
  - electric network (poles + coverage);
  - logistic networks (P2);
  - turret ranges (N/A);
  - **pollution** (heat map; our pollution analogue: R1-F);
  - tags;
  - player names (N/A);
  - train stations (P3);
  - worker robots (P2; colour by role: logistic white, construction yellow, personal green, mobile cyan, "delivering to me" red);
  - rail signals (P3);
  - **recipe icons** on machines;
  - **pipelines** (2.0);
  - **resources** highlight.
- R1-C's *age / builder* overlay goes here.

**Map tags** (P1):
- "Add tag" → a dialog with an **icon chooser + text** (rich text).
- Tags render as icon plus label on the map (and in game view since 2.0).
- Drag a tag to move it (FFF-388); pipette copies it; there is an edit and delete dialog.
- Searchable.

**Search** (Ctrl+F in remote view, P1, FFF-400 / 426):
- Finds:
  - **production** ("where is X made": machines whose recipe produces X; grouped);
  - **resources** (each patch with its total "Iron ore 7.8M", "(occupied)" if drills are on it; computed on a worker thread over charted chunks);
  - **tags**;
  - train stops (last).
- Results: a list with a **pin** button each. Matches are outlined and labelled on the map. Click → centre on it.

**Pins** (P1, FFF-400 / 423):
- Per player.
- Sources: Alt+RMB on any entity or position; the pin button on search results and alerts; automatic for your **corpse** (N/A).
- On-screen marker. When off-screen, an **edge arrow with caption and distance**.
- The pins list sits under the minimap. **Edit** (✎) opens: caption, "always show arrow" checkbox, camera zoom. **Delete** (🗑). Drag to reorder.
- Hover a pin row → **live camera** preview. Click → remote view at the pin.
- A pinned **resource patch** shows its remaining amount, live (2.0.34).

**Minimap:**
- Same chart renderer, fixed scale around the character.
- Click → remote view there.
- Zoom with Shift+Alt+Wheel.
- While holding a radar: coverage shown.

### 4.12 Production statistics (P) — P1

```
┌ [planet] Nauvis production ─────────────────────────────────────── [🔍][✕] ┐
│ [5s][1m][10m][1h][10h][50h][250h][1000h][All]                               │
│ (Items)(Fluids)(Buildings)(Pollution)(Kills)                                │
│ ┌ Production ── ☐ Global  [All (separate) ▾][⟲] ┐┌ Consumption ── … ───────┐ │
│ │ line graph (y auto-scaled, x = time axis)     ││ line graph              │ │
│ ├───────────────────────────────────────────────┤├─────────────────────────┤ │
│ │ [ico 5.8k] ███████████░  5.9k/m  │ [ico] … 2 col││ …                      │ │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Time ranges:** **5 s, 1 m, 10 m, 1 h, 10 h, 50 h, 250 h, 1000 h, All**. The chosen precision persists (2.0.15).

**Tabs:**

| Tab | Content | Pri |
|---|---|---|
| Items | Includes the special **"Science"** item: research progress actually produced, counting lab productivity (FFF-408) | P1 |
| Fluids | | P1 |
| Buildings | Placed / removed | P1 |
| Pollution | Our analogue (R1-F): produced by source vs absorbed by sink | P1 |
| Kills | | N/A |

**Halves:**
- Production | Consumption, each with:
  - a line graph;
  - a **Global statistics** checkbox (all surfaces; SA);
  - a quality dropdown (SA);
  - a red ⟲ "reset filter".
- Under each, a **2-column list** of rows: icon with a **total-in-window badge**, a bar in the graph line's colour (relative to the top item), and a **rate per minute** ("5.9k/m"; staff: "for production speed there are items/m").

**Interaction:**
- Hover a row → its graph line is highlighted (2.0).
- Click rows → **filter** the graph to the clicked items (additive). ⟲ resets.
- Hover the graph → tooltip with values at that time, and *what the two numbers mean* (2.0).
- Search filters the rows.
- Sorted by rate, descending.

**Data:** the sim keeps per-item counters in ring buffers per precision. Factorio samples 300 points per precision window (*inferred*; any fixed count works). This is *simulation-side* state (deterministic), read by the UI.

### 4.13 Factoriopedia (Alt+LMB on anything; side button) — P1

**Left:** item-group tabs, two rows of 6:
- Logistics, Production, Intermediates, Combat, Fluids, Signals;
- Enemies, Environment, Tiles, Unsorted / Other;
- (base: hide groups with no entries).

Below the tabs: a 10-wide grid of entries. The title bar has search, ◀ ▶ history, ✕. **[2.1]** adds a **pin** toggle ("stay open while working") and a **hide unresearched** toggle (remembered per save).

**Right:** the entry page. **Recipe, item and entity are merged into one entry** when they belong together: "Small electric pole (Recipe/Item/Entity)". Page blocks, in order, each only when relevant:

| Block | Content |
|---|---|
| Header | Icon, name, "(Recipe/Item/Entity)", product count ("2 ×") |
| Preview | Animated entity on a checkerboard |
| Stats box | Wire reach, supply area, crafting speed, pollution, energy, **Stack size**, base health, resistances, fuel value, … (◆ = quality-dependent, SA) |
| Energy | "Consumes burnable fuel" + **Accepted fuel** icons, or "Consumes electricity" + consumption |
| Ingredients | `n × name` rows + ⏱ crafting time; alternative recipes listed |
| Products | if more than one |
| Made in / Can craft | Machines that make it / recipes a machine can make |
| Mined by / Mining result | resources ↔ drills |
| **Unlocked by** | Technology card (click → technology screen) |
| **Used in** | Grid of every recipe using this item (the key answer to "what do I make with this?") |
| Recycling | SA |
| Notes | *BEND-5: optional citation / lore line* (see §7) |

**Navigation:**
- Every icon in a page is clickable, which makes browsing a graph walk.
- ◀ ▶ and Alt+← / → go through the history.
- Alt+click inside Factoriopedia also navigates.
- Hidden or unresearched entries are shown with a "not yet researched" mark, or hidden with the [2.1] toggle.

### 4.14 Alerts and notifications — P2 (warning icons on entities: P0)

**Alert slots** (above the shortcut bar):
- One slot per active **alert type**, with a count.
- **Hover** → the alert icons appear over the affected entities on screen, with **edge arrows** for off-screen ones (FFF-363). The tooltip lists counts and sample entity icons.
- **Click** → the **Alert overview** window (FFF-400):
  - grouped by surface;
  - each row: [pin] [icon] "12 entities are missing the material for construction.";
  - hover a row → a **camera tooltip** of the location (FFF-423);
  - click → remote view there.
- Alerts last 5–30 s by type.

**Base alert types:**

| Type | Duration |
|---|---|
| entity destroyed | 30 s |
| entity under attack | 10 s |
| no material for construction | 10 s |
| not enough construction robots | 10 s |
| not enough repair packs | 10 s |
| no storage | 5 s |
| train out of fuel | 5 s |
| turret fire | off by default |
| train no path | — |
| turret out of ammo | — |
| no roboport storage | — |
| pipeline overextended | — |
| fluid mixing | — |
| custom (programmable speaker) | 10 s |

**Configuration:**
- **Alert configuration** (side button since 2.1.18; [2.1] GUI): enable or disable and mute or unmute per type.
- Peaceful slice: none of the base types fire. The panel exists for our pressure systems (R1-F), e.g. a "slop" alert.

**Notifications:** toasts (§4.1).

### 4.15 Blueprint library, blueprints, books, planners — P2

**Blueprint library (B):**
- Tabs **My blueprints** (personal, shared across saves) | **Game blueprints** (in the save).
- A grid of records (80 px cells). Drag to organise; books nest.
- Everything in it is free and unlimited; it can be pinned to the quickbar.
- Taking a record into the cursor returns it on Q.
- Search; import string button; delete with confirmation.

**Blueprint creation:**
- Hold an empty blueprint and drag-select. On release, the **Setup** dialog opens:
  - 4 icon slots (auto-chosen);
  - name, description;
  - the component list with per-component toggles;
  - options: grid snapping (size, absolute / relative position), include tiles / modules / trains;
  - **Parametrise** button (2.0);
  - [Create] (green).
- Shift+drag skips the dialog.
- Holding a blueprint: R / H / V rotate and flip. Shift+arrows / Ctrl+arrows nudge the grid (FFF-404). Place with LMB, Shift (forced), Ctrl+Shift (super-forced).
- **Preview colours:** green (buildable), red (blocked), blue (identical entity already there).
- Placing over identical entities **applies their settings** (recipes, filters, wires) without conflict.

**Copy / cut / paste (Ctrl+C / X / V):**
- Copy and cut use the same selection. Shift-drag opens the full blueprint setup.
- The clipboard keeps 20 entries (Shift+Wheel cycles them).
- Copy captures everything except item contents.

**Deconstruction planner (Alt+D):**
- LMB drag: mark (red ✕). Shift: cancel. RMB: invert filters for this drag. Ctrl+Shift: everything including tiles.
- Tiles are taken only if the area has no entities.
- **Filter GUI:** entities and tiles tabs, whitelist / blacklist, "trees and rocks only", tile mode (normal / never / always / only).
- Ghosts are removed instantly.

**Upgrade planner (Alt+U):**
- Rows of "from → to" mappings (dynamic size, up to 250 rows). Module install and upgrade rows (2.0).
- RMB drag = downgrade. Shift = cancel.
- Also applies to blueprints (via the slot in the blueprint GUI).

### 4.16 Electric network info (click a pole) — P1 (bars P0)

```
┌ Electric network info ─────────────────────────────────────────── [🔍][✕] ┐
│ Satisfaction ⓘ 1.7MW/1.7MW █████ │ Production ⓘ 1.7/7.8MW ██░░ │ Accumulator … │
│ [5s][1m][10m][1h][10h][50h][250h][1000h][All]                              │
│ Consumption graph [All ▾][⟲] │ Production graph [All ▾][⟲] │ Accumulator graph │
│ rows: [ico ×n] ███ 900 kW    │ rows: [steam engine ×8] 1.1 MW │ rows …         │
└────────────────────────────────────────────────────────────────────────────┘
```

**Top bars:**
- **Satisfaction:** consumption actually met / demanded. The bar turns yellow below 100% and red below 50%.
- **Production:** current output / maximum.
- **Accumulator charge:** MJ (the third graph since 2.0, FFF-408).

**Lists:** grouped by entity type with counts. Rows highlight their graph line on hover. The network is per pole (only the clicked network).

**Supply priority:**
- **Displayed only.**
- Order: solar, then steam engines / turbines, then accumulators.
- The economy spec owns the rule.

### 4.17 Bonuses, achievements, tips and tricks — P2
- **Bonuses** (side button): a list of research-derived modifiers. Examples: mining productivity, inserter capacity, lab speed, worker-robot speed.
- **Achievements:** N/A unless we add our own (R1-H).
- **Tips and tricks:** an index with search and *animated simulations* of each mechanic. The categories mirror Factorio's list:
  - game interaction: alt-mode, E-confirm, clear cursor, pipette, stack transfers, entity transfers, Z-dropping, bulk crafting, rotating assemblers, entity flip;
  - inserters;
  - electric network;
  - copy-paste;
  - drag building: poles, coverage, undergrounds, fast belt bending, fast obstacle traversing;
  - ghost building;
  - fast-replace: direction, belt ↔ splitter, belt ↔ underground.

  Tips trigger contextually (e.g. after 200 belts are built by dragging). **This list is also the checklist for §6.**

### 4.18 Logistic networks (L) — P2
Per network: robots (idle / total by type), items stored, requests. Hover a network → highlight its area. (Since 2.0, roboports can also have robot requests.)

### 4.19 Chat and console (`) — P0 dev / P1

**Layout:** a one-line input at the bottom-left, with the log above it (scrollable while open, fading lines when closed).

**Input:**
- Plain text → a log message: single player, so it is just a notes line.
- `/command` → a command.

**Commands** (single player subset):
- `/help`;
- `/time`;
- `/seed`;
- `/screenshot`;
- `/clear`;
- `/unlock-shortcut-bar`;
- `/alerts`;
- `/editor` (dev);
- `/cheat` and `/c <js>` (dev; disables achievements).

**Rich-text links:** Shift+click an object while the chat is open to insert `[item=…]`, `[gps=x,y]`, … Clicking a gps link opens remote view there.

**Message log:** also receives system messages ("Research completed", autosave).

### 4.20 Menus, saves, settings

**Main menu** (browser BEND: no Exit):
- **Continue** (loads the most recent save);
- **New game**;
- **Load game**;
- **Settings**;
- **Tips and tricks**;
- **Credits**;
- **Changelog** *(BEND: links the build's changelog)*.

The background shows a live **factory simulation** of one of a few curated saves (Factorio 1.1+; P2: a static image first).

**New game:**
- Seed;
- preset;
- map-generation sliders (resources: frequency, size, richness; water; cliffs; peaceful / enemies per R1-F), with a **map preview**;
- difficulty and recipe presets from R1-D / E.
- The **research queue is always on** (FFF-376).

**Game menu** (Esc; pauses single player):
- Continue;
- Save game;
- Load game;
- Settings;
- Tips and tricks;
- Exit to main menu (with an unsaved-progress confirmation).

**Save / load (BEND-3):**
- Saves are stored in browser storage (IndexedDB / OPFS).
- Each save has a name, a **last modified** time and a thumbnail.
- **Sort by name or date** (2.0, FFF-388), search, delete.
- **Export / import** a save as a file.
- **Autosave** every N minutes into a rotating set of slots (Other: interval default 5 min, 3 slots; "non-blocking" saving: serialise in a worker).

**Settings window** (tabs left or top; search field, 1.1):

| Tab | Options to implement (defaults) | Pri |
|---|---|---|
| **Interface** | **Interface:** UI scale (auto); language; **Flat character GUI** (on); **Active quickbars** 1–4 (2); shortcut bar rows (1); show minimap (on); entity tooltip on the side (on); entity tooltip delay (0 ms); GUI tooltip delay (about 0.4 s *(inferred)*); recipe notifications (on); show inserter arrows in alt-mode (on); show research-completed toasts (on); chat message duration. **Interaction:** **Pick ghost item if no items are available** (off); **smart belt building** (on); **lock belt building to line** (on); auto-sort main inventory (on); change quickbar slot by clicking with a different item (off); show all items in selection lists (off); **[2.1]** zoom towards cursor; **[2.1]** fluid visualisation when holding fluid entities (alt-mode only). | P0 / P1 |
| **Graphics** | Fullscreen; render resolution scale; FPS limit; **colour filter** (none / protanopia / deuteranopia / tritanopia: Factorio ships LUTs for these); ghost animation (on; 2.0.14); smoke and decoratives; screenshot hiding. | P1 |
| **Sound** | Master, music, game effects, GUI, alerts, environment, walking, ambient; **mute per category** (2.0.36); music skip and pause controls. | P1 |
| **Controls** | The full action list grouped as in §2. Two columns (primary, alternative). Click a cell and press the combination to bind; RMB clears; conflicts are listed under the control; per-control reset and **Reset all**; search. Mouse: wheel zoom sensitivity *(our addition)*; vehicle driving mode heading / steering. | P0 |
| **Other** | Autosave interval and slots; show tips and tricks; **[dev]** "The rest": Ctrl+Alt+click Settings reveals raw config (`technology-gui-pauses-game`, …). | P1 |

### 4.21 Debug overlays (F4 / F5) — dev
- **F4:** the debug settings window. Two "folders": **always** (shown permanently) and **debug** (shown while F5 is on). A checklist per folder, with search.
- **Implement first:**
  - `show-fps` (FPS / UPS);
  - `show-detailed-info` (cursor tile position, zoom, entity and chunk counts);
  - `show-time-usage` (per-system ms per tick, average / min / max over 100 ticks);
  - `show-tile-grid` (tiles and chunk borders);
  - `show-collision-rectangles`;
  - `show-selection-rectangles`;
  - `show-entity-positions`;
  - `show-debug-info-in-tooltips`.
- These pay for themselves during development and match a veteran's expectations.

---

## 5. Prioritized implementation order

**The vertical slice is red and green science, peaceful:**
- burner → electric power;
- belts and inserters;
- steam power;
- about 15 technologies.

**Principle.** Build the *hand* first (cursor, building, mining, drag rules), because the feel lives there. Then the screens the slice can't run without. Then the screens a veteran reaches for in the first hour.

**Sizes:** S ≈ ½–1 day, M ≈ 2–4 days, L ≈ 1–2 weeks of focused implementation, for an implementer with the data model already in place.

### M0 — Input and "hand" core (P0)

| # | Item | Size |
|---|---|---|
| 0.1 | Action map, two binding columns, `KeyboardEvent.code`; context resolver (§1.4); browser capture layer (§1.5); blur releases held keys | M |
| 0.2 | Camera: follow the character, wheel zoom (closest 3×), F9 / Shift+F9 | S |
| 0.3 | Hover selection: selection box, selection priority, reach checks, docked entity tooltip (name, status, contents) | M |
| 0.4 | Cursor stack model: hand marker, Q = pipette / clear, auto-replenish, persistence across windows | M |
| 0.5 | Build preview (tints, snapping, previews for poles, drills, inserters, undergrounds, offshore pump), LMB build, R / Shift+R (also built entities), failure flying texts + error sound | M |
| 0.6 | Drag-build: axis lock and adjacent placement; belts lock-to-line; poles at max reach + "no common neighbour" auto-connect; underground pairing + green max-range preview | L |
| 0.7 | Mining: RMB hold, progress bar, drag-mining, "+N item (total)" flying text, inventory-full refusal; F pickup; Z drop (one per tile while held) | M |
| 0.8 | Quickbar: 2 visible rows × 10, keys 1–0, set and clear slots, counts and dimming | M |
| 0.9 | Dev: F4 / F5 overlays (FPS / UPS, tile grid, collision boxes), dev console (`), game-speed and step keys | S |

### M1 — First playable loop (P0): red science is achievable at the end

| # | Item | Size |
|---|---|---|
| 1.1 | Character screen, flat: inventory (80, auto-sort), **crafting panel** (4 groups, subgroup rows, craftable counts, red / new highlights, search) | L |
| 1.2 | Hand crafting with **chain crafting**, reserve at enqueue, merged entries, **crafting queue HUD**, cancel 1 / 5 / all with cascade refund, pause when full, "Not enough ingredients" | M |
| 1.3 | Inventory transfer table (§3.8) in every two-inventory window; **fast entity transfer / split with sweep** | M |
| 1.4 | Entity GUIs: chest, stone furnace, burner and electric drill, **assembler + recipe chooser + recipe line**, inserter (status + held item), lab, boiler, steam engine, offshore pump, electric-network bars | L |
| 1.5 | Tooltips: item, **recipe** (ingredients colouring, time, total raw, made in), **entity** (status, recipe throughput, energy, contents), technology; hotkey hints | M |
| 1.6 | Status LEDs + world warning icons (no power, low power, not plugged in, no fuel, resources depleted) | S |
| 1.7 | **Alt-mode** overlays: recipe and product icons, inserter arrows, drill arrows, fluid connection arrows; shortcut bar with the alt-mode button | M |
| 1.8 | **Technology screen** (queue of 7 with drag-reorder, details with cost or trigger, list with search, focus tree, start research with prerequisites), pause in single player, research widget + science tooltip, research toast, new-recipe highlights | L |
| 1.9 | Esc menu (pause), **save / load / autosave** (IndexedDB), main menu (Continue / New / Load / Settings), **Controls settings** (rebinding), Interface basics | M |

### M2 — Veteran-complete slice (P1): green science; the slice ships at the end of M2

| # | Item | Size |
|---|---|---|
| 2.1 | **Smart belt building:** R-bend while dragging, auto-underground over obstacles, "Too far to connect"; smart underground and pipe-to-ground dragging at max span; pole early placement for coverage | M |
| 2.2 | **Fast-replace** for all groups (belt ↔ underground ↔ splitter, pipe ↔ pipe-to-ground, chests, inserters, furnaces, assemblers, poles by moving), keeping contents and settings, direction change | M |
| 2.3 | **Copy / paste entity settings** (Shift+RMB / Shift+LMB, sweep) | S |
| 2.4 | **Undo / redo** (build, mine, paste, rotate, flip; merged drags; flying text; confirm if older than 1 min) | M |
| 2.5 | Ghost building (Shift+LMB), ghost filling by hand; flip H / V (assemblers with fluid ports, blueprint-ready) | M |
| 2.6 | **Remote view:** chart renderer, zoom-out transition, pan, remote open and configure, ghost cursor, mine = deconstruction mark, overlay registry (electric network, pollution analogue, resources, recipe icons, pipelines), tags, minimap, **map search** (production, resources, tags), **pins** (edge arrows, camera) | L |
| 2.7 | **Production statistics** (items, fluids, buildings, pollution; all 9 ranges; Science item; filter, hover-highlight; per-minute rates) | M |
| 2.8 | **Factoriopedia** (merged entries, Used in, Unlocked by, Made in, accepted fuel, history, Alt+click everywhere) | M |
| 2.9 | Browse history (Alt+← / →, Mouse4 / 5); Ctrl+F everywhere; number fields with math | S |
| 2.10 | Chest limit bar; splitter GUI; pipe and fluid info; electric network graphs (3 graphs, 9 ranges) | M |
| 2.11 | Quickbar pages (Shift+1–0, X, page picker), secondary bar keys, [2.1] quick pipette; copper-wire tool (Alt+C) + remove cables (Shift+LMB) | S |
| 2.12 | Settings: Graphics (colour-blind LUTs, fullscreen with Keyboard Lock), Sound (categories, mute, music keys); hide GUI; UI scale keys; console commands | M |

### M3 — Mid-game UI (P2), shipped together with the technologies that unlock it
Each line unlocks with the tech that introduces it:
- blueprints, books, **blueprint library**, copy / cut / paste with clipboard history, grid nudging, string import / export, later parametrisation;
- **deconstruction and upgrade planners**, super-forced build and deconstruct;
- construction and logistic bot UIs: personal roboport toggle, robot map colours, logistic networks (L), the **logistics panel** with groups and trash;
- **alerts** (+ our pressure alerts, R1-F) and alert configuration;
- circuit wires and network GUIs; modules and beacons UI;
- inventory slot filters;
- bonuses GUI;
- tips and tricks with simulations;
- vehicles.

### M4 — Late or expansion (P3)
- Trains (rail planner incl. remote, train GUI with schedules and interrupts, trains overview, stop GUI);
- quality UI (Alt+Wheel);
- multi-surface remote view (surfaces list, ↑ / ↓);
- RTS tool;
- elevated rails toggle.

**What the slice can safely skip** (ISO features that only matter later):
- blueprints and planners;
- bots;
- circuits;
- alerts (no alert types fire in a peaceful, bot-less factory);
- inventory filters;
- trains;
- quality;
- weapons, armor and shooting;
- logistic requests;
- tips and tricks.

Reserve their bindings from day one so that muscle memory never collides.

---

## 6. Feel tests (acceptance criteria for M0–M2)

Each test is deterministic: drive the real input layer through Playwright, step the sim with `__game.step(n)`, and assert on game state.

| # | Given | Do | Expect |
|---|---|---|---|
| F1 | 20 belts + 2 undergrounds in inventory; a N–S belt across the path | Hold LMB with belts, drag 10 tiles east across it | E-facing belts; an underground pair straddling the N–S belt; the N–S belt untouched (no side-load); undergrounds −2 |
| F2 | Same, but no undergrounds | Same drag | Belt line stops before the obstacle; no side-loading |
| F3 | Dragging belts east | Press R mid-drag, continue south | A corner, then S-facing belts; one undo action for the whole drag |
| F4 | Underground entrance placed facing E | Hover 5 tiles east with an underground in hand | Preview shows the exit paired with a **green** line; at 6 tiles, no pairing |
| F5 | Placed pair | R on one end | Both ends swap input / output (flow reverses) |
| F6 | 10 small poles | Drag 30 tiles straight | A pole every 7 tiles (the largest whole-tile spacing within wire reach 7.5), each connected to its predecessor only |
| F7 | Same, with an unpowered assembler beside the path | Drag past it | A pole is placed early so the assembler is covered |
| F8 | 50 coal in hand; 3 stone furnaces in a row, each already holding 40 coal | Ctrl+LMB sweep across them | Each furnace gets 10 (its fuel slot is full at one stack of 50); 20 coal remain in hand; one flying text per transfer |
| F9 | 50 coal in hand, an empty furnace | Ctrl+RMB on it | Half the hand (25) inserted |
| F10 | 2 iron plates + 3 copper plates, nothing else | Read the electronic-circuit slot, then LMB it | The slot showed **2** before the click (3 plates → 6 cables → 2 circuits). Queue: [copper cable ×2 (promised)] then [circuit ×1]. 1 iron + 2 copper plates removed. When done: 1 circuit + 1 surplus cable in inventory. |
| F11 | F10's queue, before anything finished | Shift+LMB the circuit entry | The whole chain is cancelled; 1 iron + 2 copper plates are back (2 iron + 3 copper in total) |
| F12 | No iron | LMB the gear recipe | "Not enough ingredients" flying text + error sound; nothing queued |
| F13 | Assembler A set to gears; B, C, D unset | Shift+RMB A, then hold Shift+LMB and sweep B–D | B–D set to gears; pressing Ctrl+Z three times reverts them (each paste is one undo action *(inferred)*) |
| F14 | Inventory full | Hold RMB on an iron-ore tile | Mining refused, "Inventory full"; nothing on the ground |
| F15 | Furnace selected, empty hand, 0 furnaces in inventory | Q | Nothing is picked (flying text); with the ghost setting on, the cursor holds a furnace ghost |
| F16 | Holding a yellow belt over an E-facing yellow belt | Rotate to S and click | The existing belt turns S (fast-replace changes direction); no item consumed net |
| F17 | Fast belt in hand over a yellow belt line | Drag along it | The line upgrades; the yellow belts are returned to the inventory |
| F18 | Technology X needs A and B; A researched, B not | Select X, Start research | Queue = [B, X]; X shows "conditionally available" while B is queued |
| F19 | Queue of 7 | Start research on another technology | Refused: "Research queue is full" |
| F20 | Character screen open | E | Closes. A dialog with a green button: E = confirm, Esc = cancel. No window open: Esc → game menu (paused). |
| F21 | Tech screen open (single player) | Advance wall time | The sim does not tick (paused) |
| F22 | Holding an inserter | Hover between a belt and a chest | Preview highlights the belt (pickup) and the chest (drop); no auto-rotation |
| F23 | Offshore pump in hand | Hover a shoreline | The preview faces the water and is green |
| F24 | A building placed 1 min 30 s ago | Ctrl+Z | Confirmation dialog with preview; on confirm, a ghost appears where the building was |
| F25 | Any state | Tab, zoom out, zoom back in, Tab | Remote view chart, real render when zoomed in, back to the character at the same zoom |
| F26 | Assembler in remote view (beyond reach) | LMB on it | GUI opens; recipe can be changed; the left panel is not the character inventory |
| F27 | Alt-mode on | — | Assemblers show recipe icons, inserters show arrows, drills show output arrows, boilers show fluid arrows |
| F28 | Rebind `rotate` to T | Press T over a belt | The belt rotates; T no longer opens technologies; the Controls screen lists the conflict |

---

## 7. Deviations and cross-references

### 7.1 BEND / BREAK list

| ID | Tag | What | Why (fun or necessity) |
|---|---|---|---|
| BEND-1 | BEND (necessity) | Browser capture layer (§1.5): intercept Tab, Space, Alt, Alt+letters, Alt+arrows, Mouse4 / 5, RMB, MMB, Ctrl+Wheel, debug F-keys; Keyboard Lock in fullscreen; macOS Cmd mapping. **Zero default bindings changed.** | A page must not steal a veteran's muscle memory. |
| BEND-2 | BEND (scope) | Single-player UI only: no players list, pings, permissions or admin. Chat becomes a notes / message log. | Nothing to show; keeps the build small. |
| BEND-3 | BEND (necessity) | Saves in browser storage, plus file export / import; no Steam cloud. | Platform. |
| BEND-4 | BEND (tiny, information only) | Trigger-technology progress "23 / 50"; crafting-queue time remaining; "Craftable now: N" line. Adopt each only if vanilla lacks it. | Pure information; no mechanic changes. |
| BEND-5 | BEND | Factoriopedia **Notes** block for real citations and history (the "concept names on techs, citations in tooltips" middle ground of design-space D6). The tone bible (R1-H) writes them. | Gives the theme a home that never clutters the HUD; Paperclips-style understatement lives there. |
| BEND-6 | BEND | Map-overlay **registry**: our pollution analogue (R1-F) and R1-C's *age / builder* overlay plug in like Factorio's pollution layer. | One plane, one mechanism; R1-C's salvage costs nothing. |
| BEND-7 | BEND, deferred | R1-C's "field line" (the field's year vs yours). The 2.0 tree is a **focus graph** with no global time axis, so a dashed vertical line has nowhere to live without a new full-tree view (BREAK-sized). **Recommend:** a "Field: 7 years behind you" readout in the research widget tooltip and the technology-screen header, plus a second curve on the 10-minute science graph. | The feeling R1-C wants, at ISO cost. |
| BEND-8 | Ordering, not mechanics | Factoriopedia and production statistics move *into* the slice (M2), not after it. | All names are new to the player, so "what is this for / where is it used" matters more than in Factorio, where veterans know the recipes by heart. |
| — | Rejected BEND | Inserter auto-orientation; auto-crafting on pipette or quickbar; undo that rebuilds instead of ghosting. | Each fights Factorio muscle memory for a small gain. |
| — | Not copied | Multiplayer UI, mods GUI, map editor (dev only), replays, Steam integrations, controller quick panel (could return later via the Gamepad API). | Out of scope. |

### 7.2 Hooks for other round-1 specs (by name)
- **R1-D (production economy):** the crafting grid's layout *is* the item-group / subgroup / order data. Define 4 hand-crafting groups mirroring Logistics / Production / Intermediates / Combat (or our equivalents) and subgroups per row. Also flag the recipe categories the character can hand-craft (everything else shows red).
- **R1-E (research and tech tree):** technology cards need, per technology:
  - cost, or a **trigger** (craft-item, mine-entity, craft-fluid, build-entity, …);
  - prerequisites;
  - effects;
  - the `essential` flag;
  - a level for multi-level technologies;
  - an optional historical year (for BEND-7).
- **R1-F (pressure systems):** the pollution-analogue overlay, the "Pollution" statistics tab semantics, the peaceful / enemy toggle on the new-game screen, and alert types (if any).
- **R1-B (ontology):** does the avatar have health, armor or weapons? This decides whether the bottom-left weapons panel exists in the slice.
- **R1-H (tone):** display names for every window ("Factoriopedia", "Technology", "Production statistics"), flying-text and toast strings, Factoriopedia notes, status texts.
- **R1-C (spacetime):** the age / builder overlay (BEND-6) and the field readout (BEND-7).
- **Audio** (later round): the UI sound list in §3.12.

---

## 8. Implementation notes for the builder

### 8.1 Where to render what
| Layer | Tech | Why |
|---|---|---|
| World, ghosts, previews, selection boxes, alt-mode icons, warning icons, edge arrows | WebGL2 (same pass as the world) | Hundreds of world-anchored icons each frame |
| Windows, HUD bars, tooltips, choosers, settings | **DOM** (absolutely positioned, CSS grid for 10-wide slot grids, `pointer-events` only on panels) | Text, scrolling, IME, text fields, search, accessibility and fast iteration; slot counts are small (≤ a few hundred visible) |
| Graphs (statistics, power, science), minimap, chart | Canvas2D (or a WebGL texture) | Line graphs and chart tiles |
| Icons everywhere | One sprite atlas, used both as WebGL UVs and as CSS `background-position` | One source of truth |

**Rules:**
- The DOM UI renders from immutable sim snapshots once per frame. Diff, don't rebuild.
- Never read layout inside the frame loop.
- Flying text can be DOM or WebGL; under about 20 at a time, DOM is fine.

### 8.2 Simulation input actions (the UI → sim API)

Mirror Factorio's `defines.input_action` (≈ 300 in 2.1). The slice needs these (UI-only state such as windows, hover and camera never goes through here):

| Area | Actions |
|---|---|
| Movement | `start_walking(dir8)`, `stop_walking` |
| Mining | `begin_mining(target)`, `begin_mining_terrain(pos)`, `stop_mining`, `change_picking_state(on)` |
| Building | `build(item, pos, dir, flip, mode: normal \| ghost \| superforced, drag_id)`, `stop_drag_build(drag_id)`, `rotate_entity(e, reverse)`, `flip_entity(e, axis)`, `remove_cables(pole)`, `wire_dragging(from, to)` |
| Cursor | `pipette(target)`, `clear_cursor`, `set_ghost_cursor(item)`, `quick_bar_pick_slot(i)`, `quick_bar_set_slot(i, item)`, `change_active_quick_bar(page)` |
| Inventory | `cursor_transfer(slot)`, `cursor_split(slot)`, `stack_transfer(slot)`, `stack_split(slot)`, `inventory_transfer(slot)`, `inventory_split(slot)`, `fast_entity_transfer(e)`, `fast_entity_split(e)`, `drop_item(pos \| e)`, `set_filter(slot, item)`, `set_inventory_bar(e, n)` |
| Crafting | `craft(recipe, count \| all)`, `cancel_craft(index, count)` |
| Entities | `setup_assembling_machine(e, recipe)`, `reset_assembling_machine(e)`, `set_inserter_max_stack_size`, `set_splitter_priority`, `copy_entity_settings(src)`, `paste_entity_settings(dst)` |
| Research | `start_research(tech)` (queues prerequisites), `cancel_research(tech)`, `move_research(from, to)` |
| Meta | `undo`, `redo`, `write_to_console(text)`; P1: `add_pin` / `edit_pin` / `remove_pin`, `edit_custom_tag` / `delete_custom_tag` (UI-owned but saved) |

**Rules:**
- Every action is validated in the sim (reach, items, collisions).
- The sim answers with **feedback events** that the UI renders: flying text, sound, error reason.
- The sim never calls UI code.

### 8.3 Data-driven UI
- Crafting grid order, Factoriopedia pages, tooltips, the recipe chooser and technology cards are **all generated from prototype data** (items, recipes, entities, technologies, groups). No per-item UI code.
- Entity GUIs come from a small set of **kinds** (container, furnace, crafting machine, inserter, drill, lab, generator, fluid box, pole, splitter), each composed from widgets: status, preview, slot row, progress bar, fluid gauge, energy line.

### 8.4 Test and dev hooks
- `window.__game.step(n)` (CLAUDE.md).
- `__game.dispatch(action)`.
- `__game.query(...)` for assertions.
- `__game.ui.open(name)` to screenshot every window in CI (Playwright → PNG → review).
- Dev keys: F4 / F5 overlays, the speed keys of §2.11, ` console.

---

## 9. Sources
- Factorio wiki, raw wikitext fetched 2026-10-19:
  - *Controls*, *Tutorial:Keyboard shortcuts*;
  - *Crafting*, *Quickbar*, *Shortcut bar*, *Copy and paste*, *Blueprint*, *Blueprint library*;
  - *Deconstruction planner*, *Upgrade planner*, *Ghost*, *Player*, *Stack*;
  - *Research*, *Technologies* (trigger technologies), *Production statistics*, *Alerts*;
  - *Electric system*, *Mining*, *Settings*, *Debug mode*, *Quick panel*, *Belt transport system*, *Underground belt*, *Pipe to ground*, *Offshore pump*, *Tutorial:Quick start guide*.
  - https://wiki.factorio.com/Controls
- Factorio Lua API 2.1.22:
  - `LinkedGameControl` (the complete control list): https://lua-api.factorio.com/latest/types/LinkedGameControl.html
  - `defines` (`input_action`, `entity_status`, `entity_status_diode`, `alert_type`, `gui_type`): https://lua-api.factorio.com/latest/defines.html
  - `ZoomLimits` / `ZoomSpecification` (default closest zoom 3×);
  - `TechnologyTrigger` types.
- `wube/factorio-data` (GitHub, master = 2.1.22):
  - `changelog.txt` (2.0.7 major, features, GUI and changes sections; 2.0.8–2.0.77; 2.1.7–2.1.22; 1.1.0, 1.1.9, 0.17.0);
  - `base/prototypes/custom-inputs.lua`, `shortcuts.lua`, `item-groups.lua`, `technology.lua`, `tips-and-tricks.lua`, `entity/entities.lua`, `transport-belts.lua`;
  - `core/prototypes/utility-constants.lua` (build tints, flying-text TTL, clipboard size, grid widths), `style.lua` (slot 40, technology slot 72×100, frame paddings), `fonts.lua`.
  - https://github.com/wube/factorio-data
- Friday Facts:
  - 362 (ghost building, E vs Esc);
  - 363 (entity GUI unification, flat character GUI, alert arrows, recipe notifications, belt lock-to-line);
  - 364 (smart belt building);
  - 374, 376 (trigger technologies, research queue always on), 379 (abstract items, shortcut bar), 380 (remote view, ghost shader), 382 (logistic groups), 383 (super-forced building), 388 (number expressions, underground max-range tint, tags), 394 (flipping), 397 (Factoriopedia, browse history);
  - 400 (map search, pins, alerts GUI), 404 (pipette everything, blueprint grid nudging), 405, 408 (statistics), 412 (undo / redo), 423 (research tooltip, pin and alert cameras), 426 (resource search, throughput tooltip, assembler recipe line);
  - 440 (2.1 plan), 442 (2.1 flipping).
  - https://factorio.com/blog/post/fff-397 (pattern for all)
- Forum threads:
  - flip-key defaults ([2.0.6] flip issues, p=620953);
  - map-zoom switching removed in 2.0 (p=624434);
  - research queue drag-and-drop in 2.0.21 (p=623094);
  - "Not Enough Ingredients" flying text (t=67592);
  - offshore pump auto-orientation (p=296853);
  - production rates in items/m (p=30260).
- Screenshots reviewed (FFF and wiki):
  - remote view with surfaces and the side column;
  - research tooltip;
  - alert overview;
  - pins and HUD;
  - assembler GUI (2.0);
  - entity tooltip with throughput;
  - Factoriopedia pages;
  - technology screen;
  - production statistics;
  - electric network info;
  - flat character GUI;
  - inserter GUI;
  - crafting panel with counts and new-recipe badges;
  - logistics panel.

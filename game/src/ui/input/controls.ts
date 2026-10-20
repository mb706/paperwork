// The action map (I §1.1, §2; 07 §21; 10 §7.5): every named control with Factorio 2.0's PC default bindings,
// a primary and an alternative column, its group (the Controls screen's sections, I §2) and whether it is a
// hold control (level-triggered, I §1.3). Control ids are Factorio's (`LinkedGameControl`), so the settings
// screen and the hotkey hints mirror them 1:1; display names live in locale/en.yaml under `controls`.
//
// A binding is one physical input plus an exact modifier set (I §1.1). Inputs are stored as physical keys,
// `KeyboardEvent.code` (I §1.2), or as mouse buttons and wheel notches in the same namespace:
//   'KeyW', 'Digit1', 'F4', 'NumpadAdd' …        KeyboardEvent.code
//   'Alt', 'Shift', 'Ctrl'                        a modifier key alone (either side)
//   'Mouse0' … 'Mouse4'                           PointerEvent.button: 0 LMB, 1 MMB, 2 RMB, 3 Mouse4, 4 Mouse5
//   'WheelUp', 'WheelDown'                        one wheel notch (I §1.2)
// On macOS, Ctrl in a default binding means Cmd (I §1.1); the input core maps Meta to Ctrl there.

/** Modifier bits. */
export const CTRL = 1;
export const SHIFT = 2;
export const ALT = 4;

export interface Binding {
  code: string;
  mods: number;
}

export type ControlGroup =
  | 'movement'
  | 'basic'
  | 'advanced'
  | 'crafting'
  | 'inventory'
  | 'quickbar'
  | 'tools'
  | 'panels'
  | 'misc'
  | 'debug'
  | 'editor'
  | 'ours';

/** I's priorities: P0 core, P1 veteran-complete, P2 mid-game, P3 late, N/A reserved, dev. */
export type Priority = 'P0' | 'P1' | 'P2' | 'P3' | 'N/A' | 'dev';

export interface ControlDef {
  id: string;
  group: ControlGroup;
  /** Level-triggered: active while held; extra modifiers are ignored (I §1.1, §1.3). */
  hold: boolean;
  primary: Binding | null;
  alternative: Binding | null;
  pri: Priority;
}

/** The groups in the Controls screen's order (I §2.1–§2.11, then 07 §21's additions). */
export const GROUPS: readonly ControlGroup[] = [
  'movement',
  'basic',
  'advanced',
  'crafting',
  'inventory',
  'quickbar',
  'tools',
  'panels',
  'misc',
  'debug',
  'editor',
  'ours',
];

/** A binding from Factorio's notation: "Ctrl+Shift+KeyE", "Mouse0", "Alt+WheelUp". */
export function bind(spec: string): Binding {
  const parts = spec.split('+');
  const code = parts.pop() as string;
  let mods = 0;
  for (const p of parts) {
    if (p === 'Ctrl') mods |= CTRL;
    else if (p === 'Shift') mods |= SHIFT;
    else if (p === 'Alt') mods |= ALT;
    else throw new Error(`bad modifier ${p} in ${spec}`);
  }
  return { code, mods };
}

const DEFS: ControlDef[] = [];
function def(
  group: ControlGroup,
  id: string,
  primary: string | null,
  pri: Priority,
  opts: { hold?: boolean; alt?: string } = {},
): void {
  DEFS.push({
    id,
    group,
    hold: opts.hold ?? false,
    primary: primary === null ? null : bind(primary),
    alternative: opts.alt === undefined ? null : bind(opts.alt),
    pri,
  });
}
const HOLD = { hold: true };

// I §2.1 Movement.
def('movement', 'move-up', 'KeyW', 'P0', HOLD);
def('movement', 'move-down', 'KeyS', 'P0', HOLD);
def('movement', 'move-left', 'KeyA', 'P0', HOLD);
def('movement', 'move-right', 'KeyD', 'P0', HOLD);

// I §2.2 Basic interaction.
def('basic', 'open-character-gui', 'KeyE', 'P0');
def('basic', 'confirm-gui', 'KeyE', 'P0');
def('basic', 'open-gui', 'Mouse0', 'P0');
def('basic', 'mine', 'Mouse2', 'P0', HOLD);
def('basic', 'build', 'Mouse0', 'P0', HOLD);
def('basic', 'build-ghost', 'Shift+Mouse0', 'P1', HOLD);
def('basic', 'super-forced-build', 'Ctrl+Shift+Mouse0', 'P2', HOLD);
def('basic', 'clear-cursor', 'KeyQ', 'P0');
def('basic', 'pipette', 'KeyQ', 'P0');
def('basic', 'rotate', 'KeyR', 'P0');
def('basic', 'reverse-rotate', 'Shift+KeyR', 'P0');
def('basic', 'flip-horizontal', 'KeyH', 'P1');
def('basic', 'flip-vertical', 'KeyV', 'P1');
def('basic', 'pick-items', 'KeyF', 'P0', HOLD);
def('basic', 'drop-cursor', 'KeyZ', 'P0', HOLD);
def('basic', 'show-info', 'Alt', 'P0');
def('basic', 'hide-tall-entities', null, 'P3');
def('basic', 'shoot-enemy', 'Space', 'N/A', HOLD);
def('basic', 'shoot-selected', 'Shift+Space', 'N/A', HOLD);
def('basic', 'next-weapon', 'KeyC', 'N/A');
def('basic', 'toggle-driving', 'Enter', 'P2');
def('basic', 'zoom-in', 'WheelUp', 'P0', { alt: 'Shift+WheelUp' });
def('basic', 'zoom-out', 'WheelDown', 'P0', { alt: 'Shift+WheelDown' });
def('basic', 'use-item', 'Mouse2', 'P2');
def('basic', 'alternative-use-item', 'Shift+Mouse2', 'P3');
def('basic', 'toggle-console', 'Backquote', 'P1');
def('basic', 'copy-entity-settings', 'Shift+Mouse2', 'P1');
def('basic', 'paste-entity-settings', 'Shift+Mouse0', 'P1', HOLD);
def('basic', 'controller-gui-logistics-tab', 'F1', 'P2');
def('basic', 'controller-gui-character-tab', 'F2', 'P2');
def('basic', 'controller-gui-crafting-tab', 'F3', 'P2');
def('basic', 'toggle-rail-layer', 'KeyG', 'P3');

// I §2.3 Advanced interaction.
def('advanced', 'select-for-blueprint', 'Mouse0', 'P2', HOLD);
def('advanced', 'select-for-cancel-deconstruct', 'Shift+Mouse0', 'P2', HOLD);
def('advanced', 'select-for-super-forced-deconstruct', 'Ctrl+Shift+Mouse0', 'P2', HOLD);
def('advanced', 'reverse-select', 'Mouse2', 'P2', HOLD);
def('advanced', 'alt-reverse-select', 'Shift+Mouse2', 'P2', HOLD);
def('advanced', 'deselect', 'Ctrl+Mouse0', 'P2');
def('advanced', 'cycle-blueprint-forwards', 'Shift+WheelUp', 'P2');
def('advanced', 'cycle-blueprint-backwards', 'Shift+WheelDown', 'P2');
def('advanced', 'focus-search', 'Ctrl+KeyF', 'P1');
def('advanced', 'larger-terrain-building-area', 'NumpadAdd', 'P2');
def('advanced', 'smaller-terrain-building-area', 'NumpadSubtract', 'P2');
def('advanced', 'remove-pole-cables', 'Shift+Mouse0', 'P1');
def('advanced', 'build-with-obstacle-avoidance', 'Ctrl+Mouse0', 'P3');
def('advanced', 'add-station', 'Shift+Mouse0', 'P3');
def('advanced', 'add-temporary-station', 'Ctrl+Mouse0', 'P3');
def('advanced', 'rename-all', 'Ctrl+Mouse0', 'P3');
def('advanced', 'fast-wait-condition', 'Shift+Mouse0', 'N/A');
def('advanced', 'drag-map', 'Mouse0', 'P1', HOLD);
def('advanced', 'move-tag', 'Mouse0', 'P1', { hold: true, alt: 'Shift+Mouse0' });
def('advanced', 'place-in-chat', 'Shift+Mouse0', 'P2');
def('advanced', 'place-ping', 'Ctrl+Alt+Mouse0', 'N/A');
def('advanced', 'pin', 'Alt+Mouse2', 'P1');
def('advanced', 'activate-tooltip', 'Shift', 'P1', HOLD);
def('advanced', 'next-surface', 'ArrowDown', 'P3');
def('advanced', 'previous-surface', 'ArrowUp', 'P3');
def('advanced', 'cycle-quality-up', 'Alt+WheelUp', 'P3');
def('advanced', 'cycle-quality-down', 'Alt+WheelDown', 'P3');
def('advanced', 'scroll-tooltip-up', 'Shift+WheelUp', 'P1');
def('advanced', 'scroll-tooltip-down', 'Shift+WheelDown', 'P1');
def('advanced', 'visualize-entity-fluid-segments', null, 'P2');

// I §2.4 Crafting.
def('crafting', 'craft', 'Mouse0', 'P0');
def('crafting', 'craft-5', 'Mouse2', 'P0');
def('crafting', 'craft-all', 'Shift+Mouse0', 'P0');
def('crafting', 'cancel-craft', 'Mouse0', 'P0');
def('crafting', 'cancel-craft-5', 'Mouse2', 'P0');
def('crafting', 'cancel-craft-all', 'Shift+Mouse0', 'P0');

// I §2.5 Inventory (inside GUIs) and fast transfer (world).
def('inventory', 'pick-item', 'Mouse0', 'P0');
def('inventory', 'stack-transfer', 'Shift+Mouse0', 'P0');
def('inventory', 'inventory-transfer', 'Ctrl+Mouse0', 'P0');
def('inventory', 'fast-entity-transfer', 'Ctrl+Mouse0', 'P0', HOLD);
def('inventory', 'cursor-split', 'Mouse2', 'P0');
def('inventory', 'stack-split', 'Shift+Mouse2', 'P0');
def('inventory', 'inventory-split', 'Ctrl+Mouse2', 'P0');
def('inventory', 'fast-entity-split', 'Ctrl+Mouse2', 'P0', HOLD);
def('inventory', 'toggle-filter', 'Mouse1', 'P2');
def('inventory', 'open-item', 'Mouse2', 'P2');
def('inventory', 'copy-inventory-filter', 'Shift+Mouse2', 'P2');
def('inventory', 'paste-inventory-filter', 'Shift+Mouse0', 'P2');

// I §2.6 Quickbar: 1 … 9, 0 for slots 1 … 10; Shift+digit chooses the top bar's page.
const DIGITS = [
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'Digit6',
  'Digit7',
  'Digit8',
  'Digit9',
  'Digit0',
];
DIGITS.forEach((d, i) => {
  def('quickbar', `quick-bar-button-${i + 1}`, d, 'P0');
});
DIGITS.forEach((_d, i) => {
  def('quickbar', `quick-bar-button-${i + 1}-secondary`, null, 'P1');
});
DIGITS.forEach((d, i) => {
  def('quickbar', `action-bar-select-page-${i + 1}`, `Shift+${d}`, 'P1');
});
def('quickbar', 'rotate-active-quick-bars', 'KeyX', 'P1');
def('quickbar', 'next-active-quick-bar', null, 'P1');
def('quickbar', 'previous-active-quick-bar', null, 'P1');

// I §2.7 Tools.
def('tools', 'copy', 'Ctrl+KeyC', 'P2');
def('tools', 'cut', 'Ctrl+KeyX', 'P2');
def('tools', 'paste', 'Ctrl+KeyV', 'P2');
def('tools', 'cycle-clipboard-forwards', 'Shift+WheelUp', 'P2');
def('tools', 'cycle-clipboard-backwards', 'Shift+WheelDown', 'P2');
def('tools', 'undo', 'Ctrl+KeyZ', 'P1');
def('tools', 'redo', 'Ctrl+KeyY', 'P1', { alt: 'Ctrl+Shift+KeyZ' });
def('tools', 'give-blueprint', 'Alt+KeyB', 'P2');
def('tools', 'give-blueprint-book', null, 'P2');
def('tools', 'give-deconstruction-planner', 'Alt+KeyD', 'P2');
def('tools', 'give-upgrade-planner', 'Alt+KeyU', 'P2');
def('tools', 'give-copper-wire', 'Alt+KeyC', 'P1');
def('tools', 'give-red-wire', 'Alt+KeyR', 'P2');
def('tools', 'give-green-wire', 'Alt+KeyG', 'P2');
def('tools', 'give-spidertron-remote', 'Alt+KeyA', 'P3');
def('tools', 'give-artillery-targeting-remote', 'Alt+KeyT', 'N/A');
def('tools', 'give-discharge-defense-remote', 'Alt+KeyY', 'N/A');
def('tools', 'toggle-personal-roboport', 'Alt+KeyF', 'P2');
def('tools', 'toggle-personal-logistic-requests', 'Alt+KeyL', 'P2');
def('tools', 'toggle-equipment-movement-bonus', 'Alt+KeyE', 'P3');

// I §2.8 Panels.
def('panels', 'toggle-menu', 'Escape', 'P0');
def('panels', 'toggle-map', 'Tab', 'P0', { alt: 'KeyM' });
def('panels', 'open-technology-gui', 'KeyT', 'P0');
def('panels', 'production-statistics', 'KeyP', 'P1');
def('panels', 'logistic-networks', 'KeyL', 'P2');
def('panels', 'toggle-blueprint-library', 'KeyB', 'P2');
def('panels', 'open-trains-gui', 'KeyO', 'P3');
def('panels', 'open-factoriopedia', 'Alt+Mouse0', 'P1');
def('panels', 'back', 'Alt+ArrowLeft', 'P1', { alt: 'Mouse3' });
def('panels', 'forward', 'Alt+ArrowRight', 'P1', { alt: 'Mouse4' });

// I §2.9 Miscellaneous.
def('misc', 'pause-game', 'Pause', 'P0');
def('misc', 'confirm-message', 'Tab', 'P2');
def('misc', 'previous-mod', 'Backspace', 'N/A');
def('misc', 'connect-train', 'KeyJ', 'P3');
def('misc', 'disconnect-train', 'KeyK', 'P3');
def('misc', 'submit-feedback', null, 'N/A');
def('misc', 'next-player-in-replay', 'F10', 'N/A');
for (const [d, k] of [
  ['up', 'ArrowUp'],
  ['down', 'ArrowDown'],
  ['left', 'ArrowLeft'],
  ['right', 'ArrowRight'],
] as const)
  def('misc', `move-blueprint-absolute-grid-${d}`, `Ctrl+${k}`, 'P2');
for (const [d, k] of [
  ['up', 'ArrowUp'],
  ['down', 'ArrowDown'],
  ['left', 'ArrowLeft'],
  ['right', 'ArrowRight'],
] as const)
  def('misc', `move-blueprint-entities-${d}`, `Shift+${k}`, 'P2');
def('misc', 'toggle-blueprint-snap-to-grid', null, 'P2');
def('misc', 'play-next-track', null, 'P1');
def('misc', 'play-previous-track', null, 'P1');
def('misc', 'pause-resume-music', null, 'P1');

// I §2.10 Debug and visibility toggles.
def('debug', 'debug-toggle-gui-visibility', 'Ctrl+Shift+F4', 'P1');
def('debug', 'debug-toggle-debug-settings', 'F4', 'dev');
def('debug', 'debug-toggle-basic', 'F5', 'dev');
def('debug', 'debug-reset-zoom', 'F9', 'P1');
def('debug', 'debug-reset-zoom-2x', 'Shift+F9', 'P1');
def('debug', 'debug-toggle-atlas-gui', 'Ctrl+F3', 'dev');
def('debug', 'toggle-gui-debug', 'Ctrl+F5', 'dev');
def('debug', 'toggle-gui-style-view', 'Ctrl+F6', 'dev');
def('debug', 'toggle-gui-shadows', 'Ctrl+F7', 'dev');
def('debug', 'toggle-gui-glows', 'Ctrl+F8', 'dev');
def('debug', 'open-prototypes-gui', 'Ctrl+Shift+KeyE', 'dev');
def('debug', 'open-prototype-explorer-gui', 'Ctrl+Shift+KeyF', 'dev');
def('debug', 'increase-ui-scale', 'Ctrl+NumpadAdd', 'P1');
def('debug', 'decrease-ui-scale', 'Ctrl+NumpadSubtract', 'P1');
def('debug', 'reset-ui-scale', 'Ctrl+Numpad0', 'P1');
def('debug', 'slash-editor', 'Ctrl+Shift+F11', 'N/A');
def('debug', 'toggle-entity', null, 'dev');

// I §2.11 Editor controls kept as dev keys (game speed and single steps; 10 §3.5).
def('editor', 'editor-speed-up', 'Shift+NumpadAdd', 'dev');
def('editor', 'editor-speed-down', 'Shift+NumpadSubtract', 'dev');
def('editor', 'editor-reset-speed', 'Shift+NumpadMultiply', 'dev');
def('editor', 'editor-tick-once', 'NumpadDecimal', 'dev');
def('editor', 'editor-toggle-pause', 'Numpad0', 'dev');

// 07 §21: our added controls; no Factorio default changes.
def('ours', 'give-rate-calculator', 'Alt+KeyX', 'P1');
def('ours', 'toggle-status-lights', null, 'P1');
def('ours', 'open-world', null, 'P1');
def('ours', 'toggle-world-strip', null, 'P1');
def('ours', 'open-milestones', null, 'P1');
def('ours', 'open-university', null, 'P1');

/** Every control, in the Controls screen's order. */
export const CONTROLS: readonly ControlDef[] = DEFS;

export const CONTROL_BY_ID: ReadonlyMap<string, ControlDef> = new Map(DEFS.map((d) => [d.id, d]));

/** Inputs the browser keeps for itself unless the game runs fullscreen with Keyboard Lock (I §1.5). */
export const BROWSER_RESERVED: readonly Binding[] = [
  bind('Ctrl+KeyW'),
  bind('Ctrl+KeyT'),
  bind('Ctrl+KeyN'),
  bind('Ctrl+Tab'),
  bind('Ctrl+Shift+Tab'),
  bind('Ctrl+Shift+KeyT'),
  bind('Ctrl+Shift+KeyN'),
  ...DIGITS.slice(0, 9).map((d) => bind(`Ctrl+${d}`)),
];

export const sameBinding = (a: Binding | null, b: Binding | null): boolean =>
  a !== null && b !== null && a.code === b.code && a.mods === b.mods;

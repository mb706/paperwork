// The action map (I §2, 07 §21): Factorio's defaults, the matching rules of I §1.1, the settings shape for
// rebinding, conflicts. UI-G15: a fresh profile's table equals I §2 plus §21's additions.
import { describe, expect, it } from 'vitest';
import { BindingTable, defaultKeybindings, sanitizeKeybindings } from './bindings.ts';
import { ALT, bind, CONTROL_BY_ID, CONTROLS, CTRL, SHIFT } from './controls.ts';

/**
 * I §2's defaults, restated from the spec's tables independently of controls.ts (P0/P1 rows and every row that
 * shares a binding), as "primary | alternative".
 */
const I2: Record<string, string> = {
  'move-up': 'KeyW',
  'move-down': 'KeyS',
  'move-left': 'KeyA',
  'move-right': 'KeyD',
  'open-character-gui': 'KeyE',
  'confirm-gui': 'KeyE',
  'open-gui': 'Mouse0',
  mine: 'Mouse2',
  build: 'Mouse0',
  'build-ghost': 'Shift+Mouse0',
  'super-forced-build': 'Ctrl+Shift+Mouse0',
  'clear-cursor': 'KeyQ',
  pipette: 'KeyQ',
  rotate: 'KeyR',
  'reverse-rotate': 'Shift+KeyR',
  'flip-horizontal': 'KeyH',
  'flip-vertical': 'KeyV',
  'pick-items': 'KeyF',
  'drop-cursor': 'KeyZ',
  'show-info': 'Alt',
  'shoot-enemy': 'Space',
  'shoot-selected': 'Shift+Space',
  'next-weapon': 'KeyC',
  'toggle-driving': 'Enter',
  'zoom-in': 'WheelUp | Shift+WheelUp',
  'zoom-out': 'WheelDown | Shift+WheelDown',
  'use-item': 'Mouse2',
  'alternative-use-item': 'Shift+Mouse2',
  'toggle-console': 'Backquote',
  'copy-entity-settings': 'Shift+Mouse2',
  'paste-entity-settings': 'Shift+Mouse0',
  'controller-gui-logistics-tab': 'F1',
  'controller-gui-character-tab': 'F2',
  'controller-gui-crafting-tab': 'F3',
  'toggle-rail-layer': 'KeyG',
  'select-for-blueprint': 'Mouse0',
  'select-for-cancel-deconstruct': 'Shift+Mouse0',
  'select-for-super-forced-deconstruct': 'Ctrl+Shift+Mouse0',
  'reverse-select': 'Mouse2',
  'alt-reverse-select': 'Shift+Mouse2',
  deselect: 'Ctrl+Mouse0',
  'focus-search': 'Ctrl+KeyF',
  'larger-terrain-building-area': 'NumpadAdd',
  'smaller-terrain-building-area': 'NumpadSubtract',
  'remove-pole-cables': 'Shift+Mouse0',
  'drag-map': 'Mouse0',
  'move-tag': 'Mouse0 | Shift+Mouse0',
  'place-ping': 'Ctrl+Alt+Mouse0',
  pin: 'Alt+Mouse2',
  'activate-tooltip': 'Shift',
  craft: 'Mouse0',
  'craft-5': 'Mouse2',
  'craft-all': 'Shift+Mouse0',
  'cancel-craft': 'Mouse0',
  'cancel-craft-5': 'Mouse2',
  'cancel-craft-all': 'Shift+Mouse0',
  'pick-item': 'Mouse0',
  'stack-transfer': 'Shift+Mouse0',
  'inventory-transfer': 'Ctrl+Mouse0',
  'fast-entity-transfer': 'Ctrl+Mouse0',
  'cursor-split': 'Mouse2',
  'stack-split': 'Shift+Mouse2',
  'inventory-split': 'Ctrl+Mouse2',
  'fast-entity-split': 'Ctrl+Mouse2',
  'toggle-filter': 'Mouse1',
  'quick-bar-button-1': 'Digit1',
  'quick-bar-button-10': 'Digit0',
  'quick-bar-button-1-secondary': '',
  'action-bar-select-page-1': 'Shift+Digit1',
  'action-bar-select-page-10': 'Shift+Digit0',
  'rotate-active-quick-bars': 'KeyX',
  copy: 'Ctrl+KeyC',
  cut: 'Ctrl+KeyX',
  paste: 'Ctrl+KeyV',
  undo: 'Ctrl+KeyZ',
  redo: 'Ctrl+KeyY | Ctrl+Shift+KeyZ',
  'give-blueprint': 'Alt+KeyB',
  'give-deconstruction-planner': 'Alt+KeyD',
  'give-upgrade-planner': 'Alt+KeyU',
  'give-copper-wire': 'Alt+KeyC',
  'give-red-wire': 'Alt+KeyR',
  'give-green-wire': 'Alt+KeyG',
  'give-spidertron-remote': 'Alt+KeyA',
  'give-artillery-targeting-remote': 'Alt+KeyT',
  'give-discharge-defense-remote': 'Alt+KeyY',
  'toggle-personal-roboport': 'Alt+KeyF',
  'toggle-personal-logistic-requests': 'Alt+KeyL',
  'toggle-equipment-movement-bonus': 'Alt+KeyE',
  'toggle-menu': 'Escape',
  'toggle-map': 'Tab | KeyM',
  'open-technology-gui': 'KeyT',
  'production-statistics': 'KeyP',
  'logistic-networks': 'KeyL',
  'toggle-blueprint-library': 'KeyB',
  'open-trains-gui': 'KeyO',
  'open-factoriopedia': 'Alt+Mouse0',
  back: 'Alt+ArrowLeft | Mouse3',
  forward: 'Alt+ArrowRight | Mouse4',
  'pause-game': 'Pause',
  'confirm-message': 'Tab',
  'connect-train': 'KeyJ',
  'disconnect-train': 'KeyK',
  'debug-toggle-gui-visibility': 'Ctrl+Shift+F4',
  'debug-toggle-debug-settings': 'F4',
  'debug-toggle-basic': 'F5',
  'debug-reset-zoom': 'F9',
  'debug-reset-zoom-2x': 'Shift+F9',
  'debug-toggle-atlas-gui': 'Ctrl+F3',
  'increase-ui-scale': 'Ctrl+NumpadAdd',
  'decrease-ui-scale': 'Ctrl+NumpadSubtract',
  'reset-ui-scale': 'Ctrl+Numpad0',
  'editor-speed-up': 'Shift+NumpadAdd',
  'editor-speed-down': 'Shift+NumpadSubtract',
  'editor-reset-speed': 'Shift+NumpadMultiply',
  'editor-tick-once': 'NumpadDecimal',
  'editor-toggle-pause': 'Numpad0',
  // 07 §21: the one added default
  'give-rate-calculator': 'Alt+KeyX',
  'toggle-status-lights': '',
  'open-world': '',
};

const fmt = (b: { code: string; mods: number } | null) =>
  b === null
    ? ''
    : `${b.mods & CTRL ? 'Ctrl+' : ''}${b.mods & SHIFT ? 'Shift+' : ''}${b.mods & ALT ? 'Alt+' : ''}${b.code}`;

describe('the default action map (I §2, 07 §21)', () => {
  it('matches the spec tables for every control they list (UI-G15)', () => {
    const t = new BindingTable(defaultKeybindings());
    for (const [id, want] of Object.entries(I2)) {
      expect(CONTROL_BY_ID.has(id), id).toBe(true);
      const [p, a] = t.get(id);
      expect([fmt(p), fmt(a)].filter((x) => x !== '').join(' | '), id).toBe(want);
    }
  });

  it('has unique ids, the hold flags of I §1.3, and every quickbar slot', () => {
    expect(new Set(CONTROLS.map((c) => c.id)).size).toBe(CONTROLS.length);
    const holds = CONTROLS.filter((c) => c.hold).map((c) => c.id);
    for (const id of [
      'move-up',
      'mine',
      'build',
      'build-ghost',
      'pick-items',
      'drop-cursor',
      'fast-entity-transfer',
      'paste-entity-settings',
      'activate-tooltip',
      'drag-map',
    ])
      expect(holds, id).toContain(id);
    for (const id of ['rotate', 'open-character-gui', 'clear-cursor', 'craft', 'pick-item'])
      expect(holds).not.toContain(id);
    for (let i = 1; i <= 10; i++) expect(CONTROL_BY_ID.has(`quick-bar-button-${i}`)).toBe(true);
  });

  it('changes no Factorio default: the only addition with a default is Alt+X (07 §21)', () => {
    const ours = CONTROLS.filter((c) => c.group === 'ours');
    expect(ours.filter((c) => c.primary !== null).map((c) => c.id)).toEqual(['give-rate-calculator']);
    // Alt+X is free among Factorio's defaults.
    const t = new BindingTable();
    expect(t.match('KeyX', ALT).map((m) => m.control.id)).toEqual(['give-rate-calculator']);
  });
});

describe('matching (I §1.1)', () => {
  const t = new BindingTable();
  it('press controls need the exact modifiers', () => {
    expect(t.match('KeyR', 0).map((m) => m.control.id)).toEqual(['rotate']);
    expect(t.match('KeyR', SHIFT).map((m) => m.control.id)).toEqual(['reverse-rotate']);
    expect(t.match('KeyR', CTRL)).toEqual([]);
  });
  it('hold controls ignore extra modifiers: walking while holding Shift or Ctrl', () => {
    expect(t.match('KeyW', SHIFT).map((m) => [m.control.id, m.exact])).toEqual([['move-up', false]]);
    expect(t.match('KeyW', CTRL | SHIFT).map((m) => m.control.id)).toEqual(['move-up']);
  });
  it('lists exact matches before looser hold matches (Ctrl+RMB: fast split before mining)', () => {
    const ids = t.match('Mouse2', CTRL).map((m) => m.control.id);
    expect(ids.indexOf('fast-entity-split')).toBeLessThan(ids.indexOf('mine'));
    expect(ids).toContain('inventory-split');
  });
  it('shares bindings on purpose: LMB is build, open-gui, craft, pick-item and more', () => {
    const ids = t.match('Mouse0', 0).map((m) => m.control.id);
    for (const id of ['open-gui', 'build', 'craft', 'cancel-craft', 'pick-item', 'drag-map'])
      expect(ids).toContain(id);
  });
});

describe('rebinding (the settings shape; I §4.20 Controls)', () => {
  it('rebinds, clears and restores a column', () => {
    const t = new BindingTable().rebind('rotate', 'primary', bind('KeyT'));
    expect(t.get('rotate')[0]).toEqual({ code: 'KeyT', mods: 0 });
    expect(t.settings.overrides).toEqual({ rotate: { primary: { code: 'KeyT', mods: 0 } } });
    const cleared = t.rebind('rotate', 'primary', null);
    expect(cleared.get('rotate')[0]).toBeNull();
    const restored = cleared.rebind('rotate', 'primary', undefined);
    expect(restored.get('rotate')[0]).toEqual({ code: 'KeyR', mods: 0 });
    expect(restored.settings.overrides).toEqual({});
  });

  it('lists a conflict the player made, not the shared defaults (F28)', () => {
    const t0 = new BindingTable();
    expect(t0.conflicts('build')).toEqual([]);
    expect(t0.conflicts('open-character-gui')).toEqual([]);
    const t = t0.rebind('rotate', 'primary', bind('KeyT'));
    expect(t.conflicts('rotate')).toEqual(['open-technology-gui']);
    expect(t.conflicts('open-technology-gui')).toEqual(['rotate']);
    expect(t.match('KeyT', 0).map((m) => m.control.id)).toEqual(['rotate', 'open-technology-gui']);
  });

  it('sanitizes stored settings: unknown shapes fall back to the defaults', () => {
    expect(sanitizeKeybindings(null)).toEqual(defaultKeybindings());
    expect(sanitizeKeybindings({ version: 2, overrides: {} })).toEqual(defaultKeybindings());
    const s = sanitizeKeybindings({
      version: 1,
      overrides: {
        rotate: { primary: { code: 'KeyT', mods: 0 }, alternative: { code: '', mods: 0 } },
        mine: { primary: null },
        bad: 7,
        worse: { primary: { code: 'KeyA', mods: 99 } },
      },
    });
    expect(s.overrides).toEqual({ rotate: { primary: { code: 'KeyT', mods: 0 } }, mine: { primary: null } });
    expect(new BindingTable(s).get('mine')).toEqual([null, null]);
  });
});

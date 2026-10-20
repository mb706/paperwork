// Input resolution (I §1.3–§1.5, §3; 10 §7.5): DOM-shaped events through the real InputCore and Resolver,
// asserting on the sim actions the encoder sends and on the UI state. No DOM: elements are stand-ins that answer
// `closest()` for slots and GUI panels, as the real ones do.
import { beforeEach, describe, expect, it } from 'vitest';
import { type Action, decodeAction } from '../../shared/gen/actions.ts';
import type { PrototypesJson } from '../../shared/gen/protos.ts';
import { InventoryType } from '../../shared/gen/types.ts';
import type { GameStore } from '../store/game.ts';
import { Protos } from '../store/protos.ts';
import { UiState } from '../store/ui.ts';
import { FollowCamera } from '../world/camera.ts';
import type { Selection } from '../world/select.ts';
import { BindingTable } from './bindings.ts';
import { bind } from './controls.ts';
import { InputCore, type KeyLike, type PointerLike, type WheelLike } from './core.ts';
import { ActionEncoder } from './encoder.ts';
import { Resolver } from './resolver.ts';
import { NONE_REF, registerSlot, type SlotRef, serialRef } from './slots.ts';

// ---------------------------------------------------------------------------------------------- fixtures

const protosJson = {
  item: [
    { name: 'iron-chest', icon: 'item/iron-chest', places: 0, stack: 50, group: 0, subgroup: 0, order: 'a' },
    {
      name: 'iron-plate',
      icon: 'item/iron-plate',
      places: null,
      stack: 100,
      group: 0,
      subgroup: 0,
      order: 'b',
    },
  ],
  entity: [
    {
      name: 'iron-chest',
      type: 'chest',
      item: 0,
      size: [1, 1],
      rotatable: false,
      selectionBox: [-0.5, -0.5, 0.5, 0.5],
      collisionBox: [-0.35, -0.35, 0.35, 0.35],
      selectionPriority: 50,
    },
  ],
  recipe: [],
  groups: [],
  subgroups: [],
  resource: [{ name: 'iron-ore-patch', kind: 'solid' }],
  tile: [],
  fluid: [],
  strings: {},
  localeKeys: { AlertType: [], FailReason: [], FlyingText: [], Status: [] },
} as unknown as PrototypesJson;

interface FakeEl {
  tagName: string;
  isConnected: boolean;
  closest(sel: string): FakeEl | null;
}
const element = (kind: 'world' | 'gui' | 'slot' | 'text'): FakeEl => {
  const el: FakeEl = {
    tagName: kind === 'text' ? 'INPUT' : 'DIV',
    isConnected: true,
    closest: (sel) =>
      (sel === '[data-slot]' && kind === 'slot') ||
      (sel === '[data-gui]' && (kind === 'gui' || kind === 'slot'))
        ? el
        : null,
  };
  return el;
};

const key = (code: string, mods: Partial<KeyLike> = {}): KeyLike & { prevented: boolean } => {
  const e = {
    code,
    repeat: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    prevented: false,
    preventDefault() {
      e.prevented = true;
    },
    ...mods,
  };
  return e;
};
const mouse = (
  button: number,
  target: FakeEl,
  x = 100,
  y = 100,
  mods: Partial<PointerLike> = {},
): PointerLike => ({
  button,
  clientX: x,
  clientY: y,
  target: target as unknown as EventTarget,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  preventDefault() {},
  ...mods,
});

class Rig {
  ui = new UiState();
  protos = new Protos(protosJson, null);
  camera = new FollowCamera();
  hand = { key: 0xffff, count: 0, origin: -1, ghost: false };
  character = {
    hand: this.hand,
    quickbarPage: 0,
    main: [] as { key: number; count: number; filter: number }[],
  };
  sent: Action[] = [];
  encoder = new ActionEncoder();
  /** What the world shows at each pointer x (tests place selections by x). */
  world = new Map<number, Selection>();
  focused: FakeEl | null = null;
  resolver: Resolver;
  core: InputCore;
  table = new BindingTable();
  constructor() {
    this.camera.setViewport(0, 0, 800, 600);
    this.encoder.bind(
      {
        act: (first, buf) => {
          const v = new DataView(buf);
          let at = 0;
          while (at < buf.byteLength) {
            const type = v.getUint16(at, true);
            const len = v.getUint16(at + 2, true);
            this.sent.push(decodeAction(type, new Uint8Array(buf, at + 4, len)));
            at += 4 + len;
          }
          expect(first).toBeGreaterThan(0);
        },
      },
      0,
    );
    this.ui.screen[1]('game');
    this.resolver = new Resolver({
      ui: this.ui,
      game: { character: this.character } as unknown as GameStore,
      protos: this.protos,
      encoder: this.encoder,
      world: {
        camera: this.camera,
        active: () => true,
        pickAt: (x) => this.world.get(x) ?? { kind: 'tile', tx: 0, ty: 0 },
        character: () => ({ x: 0, y: 0 }),
        zoomBy: (n) => this.camera.zoomBy(n),
        setZoom: (z) => this.camera.setZoom(z),
        setSelection: () => {},
      },
      commands: {
        refuse: () => {},
        togglePause: () => {},
        speed: () => {},
        stepOnce: () => {},
        uiScale: () => {},
        focusSearch: () => false,
        hasGui: (proto) => proto === 0,
        dev: true,
      },
    });
    this.core = new InputCore(this.table, this.resolver, {
      isGui: (el) => el?.closest('[data-gui]') != null,
      focused: () => this.focused as unknown as Element,
    });
  }
  /** The actions sent since the last call (flushes the encoder's queue first). */
  take(): Action[] {
    this.encoder.flush();
    const out = this.sent;
    this.sent = [];
    return out;
  }
  tap(code: string, mods: Partial<KeyLike> = {}): void {
    this.core.keydown(key(code, mods));
    this.core.keyup(key(code, mods));
  }
  click(button: number, target: FakeEl, x = 100, mods: Partial<PointerLike> = {}): void {
    this.core.pointermove(mouse(button, target, x, 100, mods));
    this.core.pointerdown(mouse(button, target, x, 100, mods));
    this.core.pointerup(mouse(button, target, x, 100, mods));
  }
}

const WORLD = element('world');
const chestAt = (serial: number): Selection & { kind: 'entity' } => ({
  kind: 'entity',
  serial,
  proto: 0,
  x2: 1,
  y2: 1,
  dir: 0,
  flags: 0,
});

let r: Rig;
beforeEach(() => {
  r = new Rig();
});

// ---------------------------------------------------------------------------------------------- tests

describe('movement (I §2.1)', () => {
  it('combines WASD into eight directions and stops when all are released', () => {
    r.core.keydown(key('KeyW'));
    r.core.keydown(key('KeyD'));
    r.core.keyup(key('KeyW'));
    r.core.keyup(key('KeyD'));
    expect(r.take()).toEqual([
      { type: 'start_walking', input_gen: 0, dir: 0 },
      { type: 'start_walking', input_gen: 0, dir: 2 },
      { type: 'start_walking', input_gen: 0, dir: 4 },
      { type: 'stop_walking', input_gen: 0 },
    ]);
  });

  it('ignores auto-repeat and keeps walking while Shift is pressed (I §1.3, §1.1)', () => {
    r.core.keydown(key('KeyS'));
    r.core.keydown(key('KeyS', { repeat: true }));
    r.core.keydown(key('ShiftLeft', { shiftKey: true }));
    r.core.keydown(key('KeyA', { shiftKey: true }));
    expect(r.take().map((a) => (a.type === 'start_walking' ? a.dir : a.type))).toEqual([8, 10]);
  });

  it('releases every held input on blur (I §1.3)', () => {
    r.core.keydown(key('KeyW'));
    r.core.releaseAll();
    expect(r.take().map((a) => a.type)).toEqual(['start_walking', 'stop_walking']);
    r.core.keyup(key('KeyW'));
    expect(r.take()).toEqual([]);
  });

  it('suspends game keys while a text field has focus, except Esc (I §1.3)', () => {
    r.focused = element('text');
    r.core.keydown(key('KeyW'));
    r.core.keydown(key('KeyE'));
    expect(r.take()).toEqual([]);
    expect(r.ui.window[0]()).toBeNull();
  });
});

describe('mining (I §3.7)', () => {
  it('holds RMB on an entity, follows the cursor onto the next one, and stops on release', () => {
    r.world.set(100, chestAt(7));
    r.world.set(140, chestAt(9));
    r.core.pointermove(mouse(2, WORLD, 100));
    r.core.pointerdown(mouse(2, WORLD, 100));
    r.core.pointermove(mouse(2, WORLD, 140));
    r.core.pointerup(mouse(2, WORLD, 140));
    expect(r.take()).toEqual([
      { type: 'begin_mining', input_gen: 0, target: serialRef(7) },
      { type: 'begin_mining', input_gen: 0, target: serialRef(9) },
      { type: 'stop_mining', input_gen: 0 },
    ]);
  });

  it('stops when the cursor leaves every target and starts again on the next one (drag-mining)', () => {
    r.world.set(100, chestAt(7));
    r.world.set(160, chestAt(9));
    r.core.pointermove(mouse(2, WORLD, 100));
    r.core.pointerdown(mouse(2, WORLD, 100));
    r.core.pointermove(mouse(2, WORLD, 130)); // bare ground
    r.core.pointermove(mouse(2, WORLD, 160));
    r.core.pointerup(mouse(2, WORLD, 160));
    expect(r.take().map((a) => a.type)).toEqual([
      'begin_mining',
      'stop_mining',
      'begin_mining',
      'stop_mining',
    ]);
  });

  it('mines a resource tile at the tile centre', () => {
    r.world.set(100, { kind: 'resource', tx: 3, ty: -2, resource: 0, band: 1 });
    r.click(2, WORLD);
    expect(r.take()).toEqual([
      { type: 'begin_mining_terrain', input_gen: 0, kind: 0, pos: { x: 3 * 256 + 128, y: -2 * 256 + 128 } },
      { type: 'stop_mining', input_gen: 0 },
    ]);
  });
});

describe('fast transfer (I §3.8)', () => {
  it('sweeps with Ctrl+LMB: one transfer per entity per sweep', () => {
    r.world.set(100, chestAt(4));
    r.world.set(120, chestAt(5));
    const ctrl = { ctrlKey: true };
    r.core.pointermove(mouse(0, WORLD, 100, 100, ctrl));
    r.core.pointerdown(mouse(0, WORLD, 100, 100, ctrl));
    r.core.pointermove(mouse(0, WORLD, 120, 100, ctrl));
    r.core.pointermove(mouse(0, WORLD, 100, 100, ctrl));
    r.core.pointerup(mouse(0, WORLD, 100, 100, ctrl));
    expect(r.take()).toEqual([
      { type: 'fast_entity_transfer', target: serialRef(4) },
      { type: 'fast_entity_transfer', target: serialRef(5) },
    ]);
  });

  it('splits with Ctrl+RMB, not mining (the exact match wins)', () => {
    r.world.set(100, chestAt(4));
    r.click(2, WORLD, 100, { ctrlKey: true });
    expect(r.take()).toEqual([{ type: 'fast_entity_split', target: serialRef(4) }]);
  });
});

describe('GUI slots (I §3.8, §3.9, §4.5)', () => {
  const slotEl = (ref: SlotRef) => {
    const el = element('slot');
    registerSlot(el as unknown as Element, ref);
    return el;
  };
  const inv = (index: number, other: ReturnType<typeof serialRef> | null) =>
    slotEl({ kind: 'inventory', owner: NONE_REF, inv: InventoryType.main, index, other, key: () => 8 });

  it('maps the inventory controls to I §3.8 actions', () => {
    const el = inv(3, serialRef(42));
    const slot = { owner: NONE_REF, inv: InventoryType.main, slot: 3 };
    r.click(0, el);
    r.click(2, el);
    r.click(0, el, 100, { shiftKey: true });
    r.click(0, el, 100, { ctrlKey: true });
    r.click(2, el, 100, { shiftKey: true });
    r.click(2, el, 100, { ctrlKey: true });
    expect(r.take()).toEqual([
      { type: 'cursor_transfer', slot },
      { type: 'cursor_split', slot },
      { type: 'stack_transfer', from: slot, to: serialRef(42) },
      { type: 'inventory_transfer', from: slot, to: serialRef(42) },
      { type: 'stack_split', from: slot, to: serialRef(42) },
      { type: 'inventory_split', from: slot, to: serialRef(42) },
    ]);
  });

  it('sends no transfer when the window has no other inventory', () => {
    r.click(0, inv(0, null), 100, { shiftKey: true });
    expect(r.take()).toEqual([]);
  });

  it('crafts 1, 5 and all; cancels 1, 5 and all (I §2.4)', () => {
    const recipe = slotEl({ kind: 'recipe', recipe: 7 });
    const queue = slotEl({ kind: 'queue', index: 2 });
    r.click(0, recipe);
    r.click(2, recipe);
    r.click(0, recipe, 100, { shiftKey: true });
    r.click(0, queue);
    r.click(2, queue);
    r.click(0, queue, 100, { shiftKey: true });
    expect(r.take()).toEqual([
      { type: 'craft', recipe: 7, count: 1 },
      { type: 'craft', recipe: 7, count: 5 },
      { type: 'craft', recipe: 7, count: 0 },
      { type: 'cancel_craft', index: 2, count: 1 },
      { type: 'cancel_craft', index: 2, count: 5 },
      { type: 'cancel_craft', index: 2, count: 0 },
    ]);
  });

  it('a slot click never reaches the world behind the window', () => {
    r.world.set(100, chestAt(4));
    r.hand.count = 5;
    r.hand.key = 0;
    r.click(0, inv(1, null));
    expect(r.take().map((a) => a.type)).toEqual(['cursor_transfer']);
  });
});

describe('the cursor (I §3.2, §3.13)', () => {
  it('Q clears a held stack, and pipettes the selected entity with an empty hand', () => {
    r.world.set(100, chestAt(4));
    r.core.pointermove(mouse(0, WORLD, 100));
    r.hand.count = 3;
    r.hand.key = 8;
    r.tap('KeyQ');
    r.hand.count = 0;
    r.tap('KeyQ');
    expect(r.take()).toEqual([{ type: 'clear_cursor' }, { type: 'pipette', item: 0 }]);
  });

  it('builds with LMB and drags a line locked to the first axis, one drag id (I §3.3–§3.4)', () => {
    r.hand.count = 10;
    r.hand.key = 0;
    const at = (x: number, y: number) => r.camera.toScreen(x, y);
    const p0 = at(2.5, 3.5);
    const ev = (p: { x: number; y: number }) => ({ ...mouse(0, WORLD, p.x, 100, {}), clientY: p.y });
    r.core.pointermove(ev(p0));
    r.core.pointerdown(ev(p0));
    r.core.pointermove(ev(at(3.6, 3.7)));
    r.core.pointermove(ev(at(5.4, 4.2)));
    r.core.pointerup(ev(at(5.4, 4.2)));
    const sent = r.take();
    expect(sent.map((a) => (a.type === 'build' ? [a.pos.x2, a.pos.y2, a.drag_id] : a.type))).toEqual([
      [5, 7, 1],
      [7, 7, 1],
      [9, 7, 1],
      [11, 7, 1],
      'stop_drag_build',
    ]);
  });

  it('opens a chest instead of building onto it (I §1.4)', () => {
    r.hand.count = 10;
    r.hand.key = 0;
    const p = r.camera.toScreen(0.5, 0.5);
    r.world.set(p.x, { ...chestAt(4), x2: 1, y2: 1 });
    r.core.pointermove({ ...mouse(0, WORLD, p.x), clientY: p.y });
    r.core.pointerdown({ ...mouse(0, WORLD, p.x), clientY: p.y });
    r.core.pointerup({ ...mouse(0, WORLD, p.x), clientY: p.y });
    expect(r.take()).toEqual([]);
    expect(r.ui.window[0]()).toEqual({ kind: 'entity', serial: 4, proto: 0 });
  });
});

describe('windows and menus (I §1.4: E confirms, Esc cancels)', () => {
  it('E opens the character screen and E closes it', () => {
    r.tap('KeyE');
    expect(r.ui.window[0]()).toEqual({ kind: 'character' });
    r.tap('KeyE');
    expect(r.ui.window[0]()).toBeNull();
  });

  it('Esc closes the window, then opens the game menu, then closes it (F20)', () => {
    r.tap('KeyE');
    r.tap('Escape');
    expect(r.ui.window[0]()).toBeNull();
    expect(r.ui.gameMenu[0]()).toBe(false);
    r.tap('Escape');
    expect(r.ui.gameMenu[0]()).toBe(true);
    r.core.keydown(key('KeyW'));
    expect(r.take()).toEqual([]); // the game menu is modal
    r.tap('Escape');
    expect(r.ui.gameMenu[0]()).toBe(false);
  });

  it('a dialog takes E as its confirm and Esc as its cancel', () => {
    let confirmed = 0;
    const dialog = { title: '', text: '', confirm: '', cancel: '', onConfirm: () => confirmed++ };
    r.ui.dialog[1](dialog);
    r.tap('KeyE');
    expect(confirmed).toBe(1);
    r.ui.dialog[1](dialog);
    r.tap('Escape');
    expect(confirmed).toBe(1);
    expect(r.ui.dialog[0]()).toBeNull();
  });

  it('P toggles production statistics', () => {
    r.tap('KeyP');
    expect(r.ui.window[0]()).toEqual({ kind: 'stats' });
    r.tap('KeyP');
    expect(r.ui.window[0]()).toBeNull();
  });
});

describe('alt-mode, quickbar, zoom', () => {
  it('toggles alt-mode on an Alt tap, not on Alt+click or Alt+letter (deviation in the report)', () => {
    r.tap('AltLeft', { altKey: true });
    expect(r.ui.altMode[0]()).toBe(true);
    r.core.keydown(key('AltLeft', { altKey: true }));
    r.core.pointerdown(mouse(0, WORLD, 100, 100, { altKey: true }));
    r.core.keyup(key('AltLeft'));
    expect(r.ui.altMode[0]()).toBe(true);
    r.core.keydown(key('AltLeft', { altKey: true }));
    r.core.keydown(key('KeyX', { altKey: true }));
    r.core.keyup(key('AltLeft'));
    expect(r.ui.altMode[0]()).toBe(true);
  });

  it('sends the quickbar keys and pages (I §2.6)', () => {
    r.character.quickbarPage = 2;
    r.tap('Digit1');
    r.tap('Digit0');
    r.tap('Digit3', { shiftKey: true });
    expect(r.take()).toEqual([
      { type: 'quick_bar_pick_slot', slot: 20 },
      { type: 'quick_bar_pick_slot', slot: 29 },
      { type: 'change_active_quick_bar', page: 2 },
    ]);
  });

  it('accumulates wheel deltas into notches of 100 px (I §1.2)', () => {
    const w = (deltaY: number, deltaMode = 0): WheelLike => ({
      ...mouse(0, WORLD),
      deltaX: 0,
      deltaY,
      deltaMode,
    });
    r.core.wheel(w(-40));
    r.core.wheel(w(-40));
    expect(r.camera.zoom).toBe(1);
    r.core.wheel(w(-40));
    expect(r.camera.zoom).toBeCloseTo(1.1);
    r.core.wheel(w(3, 1)); // Firefox: 3 lines down is one notch
    expect(r.camera.zoom).toBeCloseTo(1);
  });
});

describe('the capture layer (I §1.5)', () => {
  it('keeps Tab, F5, Alt and Ctrl+Z from the browser and leaves F11 and F12 to it', () => {
    const tab = key('Tab');
    const f5 = key('F5');
    const f12 = key('F12');
    const altUp = key('AltLeft');
    const undo = key('KeyZ', { ctrlKey: true });
    r.core.keydown(tab);
    r.core.keydown(f5);
    r.core.keydown(f12);
    r.core.keydown(undo);
    r.core.keyup(altUp);
    expect([tab.prevented, f5.prevented, f12.prevented, undo.prevented, altUp.prevented]).toEqual([
      true,
      true,
      false,
      true,
      true,
    ]);
  });
});

describe('rebinding (F28)', () => {
  it('rotate bound to T rotates the selected entity', () => {
    r.core.setTable(r.table.rebind('rotate', 'primary', bind('KeyT')));
    r.world.set(100, chestAt(12));
    r.core.pointermove(mouse(0, WORLD, 100));
    r.tap('KeyT');
    expect(r.take()).toEqual([{ type: 'rotate_entity', target: serialRef(12), reverse: false }]);
  });
});

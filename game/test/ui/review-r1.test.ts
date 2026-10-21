// One test per codex C5-r1 finding that Node can run (pm/reviews/C5-r1.md), each failing on the reviewed code
// (f1ea52b; pm/reports/C5.md "Review response" says how that was checked). The findings that need a browser (7, 14,
// 17's focus handling, 19's viewport) are e2e/review-r1.spec.ts; 16 is test/ui/locale.test.ts; 9 is deferred.
import { createMemo, createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Action } from '../../src/shared/gen/actions.ts';
import { Writer } from '../../src/shared/gen/codec.ts';
import { type EventPayload, writeEvent } from '../../src/shared/gen/events.ts';
import { PacketFlags, PacketSection, PacketWriter } from '../../src/shared/gen/packet.ts';
import {
  type Character,
  CharacterCodec,
  type Hover,
  HoverCodec,
  ProjectionKind,
  UiRecordCodec,
  UiStatus,
} from '../../src/shared/gen/projections.ts';
import { BuildMode, InventoryType } from '../../src/shared/gen/types.ts';
import { clampPosition } from '../../src/ui/core/place.ts';
import { bind } from '../../src/ui/input/controls.ts';
import { ActionEncoder } from '../../src/ui/input/encoder.ts';
import { Resolver } from '../../src/ui/input/resolver.ts';
import { NONE_REF, queueRef, quickbarRef, registerSlot, type SlotRef } from '../../src/ui/input/slots.ts';
import { applyPacket } from '../../src/ui/packets.ts';
import { GameSession } from '../../src/ui/session.ts';
import { createStatRows, GameStore } from '../../src/ui/store/game.ts';
import { craftableFrom, craftableNow, type StatsView, statRows } from '../../src/ui/store/records.ts';
import { LAYER, UiState } from '../../src/ui/store/ui.ts';
import { element, type FakeEl, FakeHost, key, mountLayers, mouse, Rig, TestCamera, WORLD } from './rig.ts';

const flush = () => new Promise((r) => setTimeout(r, 0));

let r: Rig;
let unmount: () => void;
beforeEach(() => {
  r = new Rig();
  unmount = mountLayers(r.ui);
});
afterEach(() => unmount());

const slotEl = (ref: SlotRef): FakeEl => {
  const el = element('slot');
  registerSlot(el as unknown as Element, ref);
  return el;
};

/** A pointer event at a world position (the rig's camera: 800 × 600 px around (0, 0), 32 px a tile). */
const at = (wx: number, wy: number, target: FakeEl = WORLD, mods = {}) => {
  const p = r.camera.toScreen(wx, wy);
  return { ...mouse(0, target, p.x, p.y, mods) };
};

describe('C5-r1 1: a ghost drag builds ghosts all along (I §1.4, §3.4)', () => {
  it('every build of a Shift+LMB drag carries the ghost mode', () => {
    r.hand.count = 10;
    r.hand.key = 0;
    const shift = { shiftKey: true };
    r.core.pointermove(at(2.5, 3.5, WORLD, shift));
    r.core.pointerdown(at(2.5, 3.5, WORLD, shift));
    r.core.pointermove(at(4.6, 3.5, WORLD, shift));
    r.core.pointermove(at(6.6, 3.5, WORLD, shift));
    r.core.pointerup(at(6.6, 3.5, WORLD, shift));
    const builds = r.take().filter((a): a is Action & { type: 'build' } => a.type === 'build');
    expect(builds.length).toBe(5);
    expect(builds.map((b) => b.mode)).toEqual(builds.map(() => BuildMode.ghost));
  });
});

describe('C5-r1 2: a drag into the GUI builds nothing under it (I §1.4)', () => {
  it('pauses over a panel and resumes where the pointer comes back, without the covered steps', () => {
    r.hand.count = 50;
    r.hand.key = 0;
    const gui = element('gui');
    r.core.pointermove(at(0.5, 0.5));
    r.core.pointerdown(at(0.5, 0.5));
    r.core.pointermove(at(2.5, 0.5)); // locks the x axis: x2 = 1, 3, 5
    r.core.pointermove(at(5.5, 0.5, gui)); // over a window: nothing
    r.core.pointermove(at(8.5, 0.5, gui));
    r.core.pointermove(at(9.5, 0.5)); // back over the world at x2 = 19
    r.core.pointermove(at(10.5, 0.5)); // and on: x2 = 21
    r.core.pointerup(at(10.5, 0.5));
    const xs = r
      .take()
      .filter((a): a is Action & { type: 'build' } => a.type === 'build')
      .map((a) => a.pos.x2);
    expect(xs).toEqual([1, 3, 5, 19, 21]);
  });
});

describe('C5-r1 3: slot controls follow their bindings, keys included (I §1.1–§1.4)', () => {
  it('craft rebound to J crafts the hovered recipe; pipette rebound to T pipettes the hovered slot', () => {
    r.core.setTable(
      r.table.rebind('craft', 'primary', bind('KeyJ')).rebind('pipette', 'primary', bind('KeyT')),
    );
    const recipe = slotEl({ kind: 'recipe', recipe: 0 });
    r.core.pointermove(mouse(0, recipe));
    r.tap('KeyJ');
    const inv = slotEl({
      kind: 'inventory',
      owner: NONE_REF,
      inv: InventoryType.main,
      index: 4,
      other: null,
      key: () => 8,
    });
    r.core.pointermove(mouse(0, inv));
    r.tap('KeyT');
    expect(r.take()).toEqual([
      { type: 'craft', recipe: 0, count: 1 },
      { type: 'pipette', item: 8 },
    ]);
  });

  it('a key that is no slot control still acts while the pointer rests on a slot (WASD walks)', () => {
    r.core.pointermove(mouse(0, slotEl({ kind: 'recipe', recipe: 0 })));
    r.core.keydown(key('KeyW'));
    expect(r.take()).toEqual([{ type: 'start_walking', input_gen: 0, dir: 0 }]);
  });
});

describe('C5-r1 4: a quickbar slot acts on the page it shows (I §4.2)', () => {
  it('after the row changes page under it, a click picks from the new page', () => {
    createRoot((dispose) => {
      const [page, setPage] = createSignal(0);
      const el = slotEl(quickbarRef(page, 3, () => 8));
      r.click(0, el);
      setPage(1); // Shift+2: the row shows page 2 now, under the same element
      r.click(0, el);
      expect(r.take()).toEqual([
        { type: 'quick_bar_pick_slot', slot: 3 },
        { type: 'quick_bar_pick_slot', slot: 13 },
      ]);
      dispose();
    });
  });

  it('a queue slot cancels the entry it shows after the ones before it finished', () => {
    createRoot((dispose) => {
      const [i, setI] = createSignal(2);
      const el = slotEl(queueRef(i));
      setI(0); // the two entries before it finished: it is the head now
      r.click(0, el);
      expect(r.take()).toEqual([{ type: 'cancel_craft', index: 0, count: 1 }]);
      dispose();
    });
  });
});

describe('C5-r1 5: Q clears a held stack over every slot, and pipettes with an empty hand (I §3.2, §3.13)', () => {
  it('over a recipe, a queue entry and an inventory slot alike', () => {
    r.character.queue.push({ recipe: 0, count: 1, progress: 0, flags: 0 });
    const recipe = slotEl({ kind: 'recipe', recipe: 0 });
    const queue = slotEl({ kind: 'queue', index: 0 });
    r.hand.count = 3;
    r.hand.key = 8;
    for (const el of [recipe, queue]) {
      r.core.pointermove(mouse(0, el));
      r.tap('KeyQ');
    }
    r.hand.count = 0;
    r.hand.key = 0xffff;
    for (const el of [recipe, queue]) {
      r.core.pointermove(mouse(0, el));
      r.tap('KeyQ');
    }
    expect(r.take()).toEqual([
      { type: 'clear_cursor' },
      { type: 'clear_cursor' },
      { type: 'pipette', item: 0 }, // the recipe's product, the iron chest
      { type: 'pipette', item: 0 }, // the queued recipe's product
    ]);
  });
});

describe('C5-r1 6: Esc and E act on the top layer (I §1.4, §4.0)', () => {
  it('Esc in Game menu → Settings goes back to the menu; the next Esc closes the menu', () => {
    let page = 'menu';
    r.ui.gameMenu[1](true);
    const settings = r.layer(LAYER.gameMenuPage, () => {
      page = 'menu';
      settings.remove();
    });
    page = 'settings';
    r.tap('Escape');
    expect(page).toBe('menu');
    expect(r.ui.gameMenu[0]()).toBe(true);
    r.tap('Escape');
    expect(r.ui.gameMenu[0]()).toBe(false);
  });

  it("E presses the top layer's green button, not the newest one on screen", () => {
    const pressed: string[] = [];
    const window = r.layer(LAYER.window, () => {});
    const dialog = r.layer(LAYER.dialog, () => {});
    dialog.confirms.push({ press: () => pressed.push('dialog') > 0 });
    // A window's green button that mounted later (a re-render) is still under the dialog.
    window.confirms.push({ press: () => pressed.push('window') > 0 });
    r.tap('KeyE');
    expect(pressed).toEqual(['dialog']);
  });

  it('E on a layer whose green button is disabled does nothing; with no green button it closes', () => {
    let closed = 0;
    const l = r.layer(LAYER.window, () => closed++);
    l.confirms.push({ press: () => false });
    r.tap('KeyE');
    expect(closed).toBe(0);
    l.confirms.length = 0;
    r.tap('KeyE');
    expect(closed).toBe(1);
  });
});

describe('C5-r1 8: Alt toggles alt-mode as it goes down (I §2.2, §3.14)', () => {
  it('toggles on keydown, once per press, also when a click follows while it is held', () => {
    r.core.keydown(key('AltLeft', { altKey: true }));
    expect(r.ui.altMode[0]()).toBe(true);
    r.core.pointerdown(mouse(0, WORLD, 100, 100, { altKey: true }));
    r.core.keydown(key('AltLeft', { altKey: true, repeat: true }));
    r.core.keyup(key('AltLeft'));
    expect(r.ui.altMode[0]()).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------- packets

interface UiRec {
  sub: number;
  kind: number;
  status?: number;
  body?: Uint8Array;
}

/** A packet with these events (player 0, this tick) and UI records. */
function packet(tick: number, events: EventPayload[], ui: UiRec[], flags = 0): Uint8Array {
  const w = new Writer();
  const p = new PacketWriter(w, 2, tick, flags, 0xffff);
  p.section(PacketSection.events);
  for (const e of events) writeEvent(w, { tick, seq: 0, player: 0, flags: 0, surface: 0 }, e);
  p.end(events.length);
  p.section(PacketSection.ui);
  for (const u of ui)
    UiRecordCodec.write(w, {
      sub_id: u.sub,
      kind: u.kind,
      status: u.status ?? UiStatus.ok,
      version: 1,
      body: u.body ?? new Uint8Array(0),
    });
  p.end(ui.length);
  p.finish();
  return w.finish();
}

const character = (c: Partial<Character> = {}): Uint8Array =>
  CharacterCodec.encode({
    ...CharacterCodec.defaults(),
    serial: 1,
    flags: 1,
    hand_origin: 0xffff,
    hand_key: 0xffff,
    main: Array.from({ length: 80 }, () => ({ key: 0xffff, filter: 0xffff, count: 0 })),
    quickbar: Array.from({ length: 100 }, () => 0xffff),
    ...c,
  });

/** A GameStore, a resolver and an encoder on a fake host, wired as mount.tsx wires them. */
function world() {
  const host = new FakeHost();
  host.gen = 1;
  const ui = new UiState();
  ui.screen[1]('game');
  const game = new GameStore(host);
  const encoder = new ActionEncoder();
  encoder.bind(host);
  const camera = new TestCamera();
  const resolver = new Resolver({
    ui,
    game,
    protos: r.protos,
    encoder,
    world: {
      camera,
      active: () => true,
      pickAt: () => ({ kind: 'tile', tx: 0, ty: 0 }),
      character: () => ({ x: 0, y: 0 }),
      zoomBy: () => {},
      setZoom: () => {},
      setSelection: () => {},
    },
    commands: {
      refuse: () => {},
      togglePause: () => {},
      speed: () => {},
      stepOnce: () => {},
      uiScale: () => {},
      focusSearch: () => false,
      hasGui: () => true,
      dev: false,
    },
  });
  game.onCharacter = () => resolver.reassertHeld();
  game.start(0);
  const sub = (kind: number) => [...host.subs.entries()].find(([, s]) => s.kind === kind)?.[0] ?? -1;
  const apply = (bytes: Uint8Array) =>
    applyPacket(bytes, { game, player: 0, reassertHeld: () => resolver.reassertHeld(), present: () => {} });
  const acts = () => {
    encoder.flush();
    return host.acts.splice(0);
  };
  return { host, ui, game, encoder, resolver, sub, apply, acts };
}

describe('C5-r1 10: held inputs are sent again after the sim fenced them (10 §15.3, D22; 11 §2.6)', () => {
  it('W held through a release_inputs keeps walking: on the input generation moving, and on input_fenced', () => {
    const w = world();
    w.apply(
      packet(
        1,
        [],
        [{ sub: w.sub(ProjectionKind.character), kind: ProjectionKind.character, body: character() }],
      ),
    );
    w.acts();
    w.resolver.press([{ control: { id: 'move-up', hold: true } } as never], {
      code: 'KeyW',
      mods: 0,
      x: 0,
      y: 0,
      target: null,
    });
    expect(w.acts()).toEqual([{ type: 'start_walking', input_gen: 0, dir: 0 }]);
    // release_inputs at tick 2: the character's input generation is 1 now, its walking stopped
    w.apply(
      packet(
        2,
        [],
        [
          {
            sub: w.sub(ProjectionKind.character),
            kind: ProjectionKind.character,
            body: character({ input_gen: 1 }),
          },
        ],
      ),
    );
    expect(w.acts()).toEqual([{ type: 'start_walking', input_gen: 0, dir: 0 }]);
    // a start stamped before the release was fenced: the sim says so
    w.apply(packet(3, [{ type: 'input_fenced' }], []));
    expect(w.acts()).toEqual([{ type: 'start_walking', input_gen: 0, dir: 0 }]);
  });
});

describe('C5-r1 11: a new state generation drops everything of the old world (10 §3.4, §15.5)', () => {
  it("the character, the hover and the gestures go before the new world's first record; windows rebind by serial", async () => {
    const w = world();
    const session = new GameSession({ host: w.host, ui: w.ui, game: w.game, encoder: w.encoder });
    session.newGame(7);
    w.host.show(2);
    await flush();
    expect(w.ui.screen[0]()).toBe('game');
    const hover: Hover = { serial: 5, proto: 0, status: 1, contents: [] };
    w.apply(
      packet(
        1,
        [],
        [
          { sub: w.sub(ProjectionKind.character), kind: ProjectionKind.character, body: character() },
          { sub: 0, kind: ProjectionKind.hover, body: HoverCodec.encode(hover) },
        ],
      ),
    );
    expect(w.game.character.present).toBe(true);
    expect(w.game.hover()?.serial).toBe(5);
    // an open chest window
    let closed = 0;
    const inv = w.game.watchInventory(5, InventoryType.chest, () => closed++);
    const invSub = [...w.host.subs.entries()].find(([, s]) => s.kind === ProjectionKind.inventory)?.[0];
    // the host's trap recovery loads the last autosave: a new generation, shown with its first (empty) packet
    w.host.emit('generation', 3);
    expect(w.game.character.present).toBe(false);
    expect(w.game.hover()).toBeNull();
    w.apply(packet(0, [], [], PacketFlags.full));
    expect(w.game.character.present).toBe(false); // nothing of the old world stands in
    // the host re-sends the window's subscription to the new world; there the chest is gone, and the window closes
    expect(invSub !== undefined && w.host.subs.has(invSub)).toBe(true);
    w.apply(
      packet(1, [], [{ sub: invSub as number, kind: ProjectionKind.inventory, status: UiStatus.gone }]),
    );
    expect(closed).toBe(1);
    expect(w.host.subs.has(invSub as number)).toBe(false);
    inv.dispose();
  });

  it('the character comes back after the join of a new world, whose first tick it is created in', async () => {
    const w = world();
    const session = new GameSession({ host: w.host, ui: w.ui, game: w.game, encoder: w.encoder });
    session.newGame(7);
    w.host.show(2);
    await flush();
    // tick 0: no character yet; CHARACTER answers gone and the sim drops it
    w.apply(
      packet(
        0,
        [],
        [{ sub: w.sub(ProjectionKind.character), kind: ProjectionKind.character, status: UiStatus.gone }],
      ),
    );
    expect(w.sub(ProjectionKind.character)).toBe(-1);
    // tick 1: player_joined, and the subscription is made again
    w.apply(packet(1, [{ type: 'player_joined' }], []));
    const sub = w.sub(ProjectionKind.character);
    expect(sub).toBeGreaterThan(0);
    w.apply(packet(2, [], [{ sub, kind: ProjectionKind.character, body: character() }]));
    expect(w.game.character.present).toBe(true);
  });
});

describe('C5-r1 12: saved means stored and loadable (10 §8.2, §8.4)', () => {
  it('reports success only on `saved`, lists the stored saves as loadable, and loads them through the host', async () => {
    const w = world();
    const session = new GameSession({ host: w.host, ui: w.ui, game: w.game, encoder: w.encoder });
    w.host.saveReply = { t: 'saveFailed', id: 1, message: 'over quota' };
    expect(await session.saveGame('a')).toEqual({ ok: false, message: 'over quota' });
    w.host.saveReply = { t: 'saved', id: 2, bytes: 100, ms: 3, sha256: 'ab' };
    expect(await session.saveGame('a')).toEqual({ ok: true });
    expect(w.host.calls).toContain('save manual a');
    w.host.saves = [
      {
        name: 'a',
        reason: 'manual',
        bytes: 100,
        sha256: 'ab',
        tick: 600,
        seed: 7,
        playTimeTicks: 600,
        savedAt: '2026-10-21T00:00:00.000Z',
        prototypesHash: 'x',
        store: 'opfs',
      },
    ];
    expect(await session.listSaves()).toEqual([
      { id: 'a', name: 'a', tick: 600, date: Date.parse('2026-10-21T00:00:00.000Z'), loadable: true },
    ]);
    session.loadSave('a');
    expect(w.host.calls).toContain('loadSave a');
    expect(w.ui.screen[0]()).toBe('loading');
    w.host.show(4);
    await flush();
    expect(w.ui.screen[0]()).toBe('game');
    expect(session.suggestedName()).toBe('a');
  });

  it('a failed load returns to the menu with its reason', async () => {
    const w = world();
    const session = new GameSession({ host: w.host, ui: w.ui, game: w.game, encoder: w.encoder });
    session.loadSave('b');
    w.host.fail('does not match its SHA-256');
    await flush();
    expect(w.ui.screen[0]()).toBe('menu');
    expect(w.ui.notice[0]()).toContain('does not match its SHA-256');
  });
});

describe('C5-r1 13: recipe counts within the UI budget (10 §7.3: 2 ms a frame)', () => {
  it('100 recipes over 80 changing slots: one pass over the slots per change, well under 1 ms', () => {
    const w = world();
    const recipes = Array.from({ length: 100 }, (_, i) => [
      { kind: 'item', id: i % 20, amount: 1 + (i % 3) },
      { kind: 'item', id: (i * 7) % 20, amount: 2 },
    ]);
    let evaluations = 0;
    const counts = createRoot(() =>
      recipes.map((ing) =>
        createMemo(() => {
          evaluations += 1;
          return craftableFrom(ing, w.game.totals());
        }),
      ),
    );
    const sub = w.sub(ProjectionKind.character);
    const times: number[] = [];
    const old: number[] = [];
    for (let n = 0; n < 60; n++) {
      const main = Array.from({ length: 80 }, (_, i) => ({
        key: (i % 20) * 8,
        filter: 0xffff,
        count: (i * 13 + n * (i % 5)) % 50,
      }));
      const bytes = packet(n, [], [{ sub, kind: ProjectionKind.character, body: character({ main }) }]);
      const before = evaluations;
      const t0 = performance.now();
      w.apply(bytes);
      for (const c of counts) c();
      times.push(performance.now() - t0);
      expect(evaluations - before).toBeLessThanOrEqual(recipes.length);
      // The reviewed code: every recipe slot scanned the inventory per ingredient, from each of its bindings.
      const t1 = performance.now();
      for (const ing of recipes) for (let k = 0; k < 3; k++) craftableNow(ing, w.game.character.main);
      old.push(performance.now() - t1);
    }
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1] as number;
    expect(median(times)).toBeLessThan(1);
    expect(median(times)).toBeLessThan(median(old));
  });
});

describe('C5-r1 15: updates keep the identity of what did not come or go', () => {
  it('a hover record that changes a count updates that content in place', () => {
    const w = world();
    const body = (count: number) =>
      HoverCodec.encode({
        serial: 5,
        proto: 0,
        status: 1,
        contents: [
          { key: 8, count },
          { key: 16, count: 3 },
        ],
      });
    w.apply(packet(1, [], [{ sub: 0, kind: ProjectionKind.hover, body: body(4) }]));
    const first = w.game.hover()?.contents[0];
    w.apply(packet(2, [], [{ sub: 0, kind: ProjectionKind.hover, body: body(5) }]));
    expect(w.game.hover()?.contents[0]).toBe(first);
    expect(w.game.hover()?.contents[0]?.count).toBe(5);
  });

  it('a statistics row keeps its identity when its rate changes', () => {
    createRoot((dispose) => {
      const view = (n: number): StatsView => ({
        precision: 1,
        tab: 0,
        totals: new Map([
          [(1 << 24) | 2, { produced: n, consumed: 0 }],
          [(1 << 24) | 0, { produced: 1, consumed: 0 }],
        ]),
        series: new Map(),
      });
      const [stats, setStats] = createSignal<StatsView | null>(view(10));
      const rows = createStatRows(stats, 'produced', () => 600);
      const row = rows()[0];
      setStats(view(12));
      expect(rows()[0]).toBe(row);
      expect(rows()[0]?.total).toBe(12);
      dispose();
    });
  });
});

describe('C5-r1 17: the keyboard reaches the GUI (I §1.3, §1.5)', () => {
  it("on a focused button Tab and Space are the browser's; on the page itself they are the game's", () => {
    r.focused = element('button');
    const tab = key('Tab');
    const space = key('Space');
    r.core.keydown(tab);
    r.core.keydown(space);
    expect([tab.prevented, space.prevented]).toEqual([false, false]);
    r.focused = null;
    const tab2 = key('Tab');
    r.core.keydown(tab2);
    expect(tab2.prevented).toBe(true);
  });

  it('in the menus Tab moves the focus (no game runs)', () => {
    r.ui.screen[1]('menu');
    const tab = key('Tab');
    r.core.keydown(tab);
    expect(tab.prevented).toBe(false);
  });

  it('Enter on a focused slot is its left click; Shift+Enter its Shift+click', () => {
    const recipe = slotEl({ kind: 'recipe', recipe: 0 });
    r.focused = recipe;
    r.core.keydown(key('Enter'));
    r.core.keydown(key('Enter', { shiftKey: true }));
    expect(r.take()).toEqual([
      { type: 'craft', recipe: 0, count: 1 },
      { type: 'craft', recipe: 0, count: 0 },
    ]);
  });
});

describe('C5-r1 18: an IME keeps its keys (composition)', () => {
  it('Enter that commits a candidate neither confirms nor leaves the field', () => {
    let blurred = 0;
    let confirmed = 0;
    const field = { ...element('text'), blur: () => blurred++ };
    r.focused = field;
    const l = r.layer(LAYER.window, () => {});
    l.confirms.push({ press: () => ++confirmed > 0 });
    const composing = key('Enter', { isComposing: true });
    const safari = key('Enter', { keyCode: 229 });
    r.core.keydown(composing);
    r.core.keydown(safari);
    expect([blurred, confirmed, composing.prevented, safari.prevented]).toEqual([0, 0, false, false]);
    r.core.keydown(key('Enter'));
    expect([blurred, confirmed]).toEqual([1, 1]);
  });
});

describe('C5-r1 19: a window stays reachable when the viewport shrinks (I §4.0)', () => {
  it('a remembered position is clamped into the viewport; a window too big sits at the top left', () => {
    expect(clampPosition(1200, 300, 600, 400, 800, 600)).toEqual({ x: 200, y: 200 });
    expect(clampPosition(-50, -20, 600, 400, 800, 600)).toEqual({ x: 0, y: 0 });
    expect(clampPosition(100, 100, 900, 700, 800, 600)).toEqual({ x: 0, y: 0 });
  });
});

describe('C5-r1 20: all-time rates divide by the time played (I §4.12)', () => {
  it('ten items in ten seconds are 60/m; nothing at tick 0', () => {
    const v: StatsView = {
      precision: 8,
      tab: 0,
      totals: new Map([[(1 << 24) | 2, { produced: 10, consumed: 0 }]]),
      series: new Map(),
    };
    expect(statRows(v, 'produced', 600)[0]?.rate).toBeCloseTo(60);
    expect(statRows(v, 'produced', 0)[0]?.rate).toBe(0);
    // a fixed window is its own length: 10 in the last minute is 10/m
    expect(statRows({ ...v, precision: 1 }, 'produced', 600)[0]?.rate).toBeCloseTo(10);
  });
});

describe('the session over the host (C3 decision 5)', () => {
  it('the game menu pauses through the host; exit ends the world and returns to the menu', async () => {
    const w = world();
    const session = new GameSession({ host: w.host, ui: w.ui, game: w.game, encoder: w.encoder });
    session.newGame(1945);
    expect(w.host.calls).toContain('newGame 1945');
    w.host.show(2);
    await flush();
    session.setMenuPause(true);
    session.exitToMenu();
    expect(w.host.calls).toEqual(['newGame 1945', 'menuPause true', 'exit']);
    expect(w.ui.screen[0]()).toBe('menu');
    expect(w.host.subs.size).toBe(0);
    expect(w.encoder.bound).toBe(false);
  });

  it('a start superseded by another changes nothing when it settles late', async () => {
    const w = world();
    const session = new GameSession({ host: w.host, ui: w.ui, game: w.game, encoder: w.encoder });
    session.newGame(1);
    session.loadSave('b'); // the host rejects the first start as superseded
    await flush();
    expect(w.ui.screen[0]()).toBe('loading');
    w.host.show(3);
    await flush();
    expect(w.ui.screen[0]()).toBe('game');
  });
});

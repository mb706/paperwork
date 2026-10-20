// Test rigs for the UI's input layer and session, in Node (no DOM): DOM-shaped events through the real InputCore
// and Resolver; elements are stand-ins that answer `closest()` for slots and GUI panels, as the real ones do; the
// world is a map from pointer x to what is under it; the host is a fake with the SimHost's surface (src/ui/host.ts).
import { createEffect, createRoot, onCleanup } from 'solid-js';
import { expect } from 'vitest';
import type { NewWorld } from '../../src/shared/gen/abi.ts';
import { type Action, decodeAction } from '../../src/shared/gen/actions.ts';
import type { SubRequest } from '../../src/shared/gen/projections.ts';
import type { PrototypesJson } from '../../src/shared/gen/protos.ts';
import type { SaveInfo } from '../../src/shared/io-protocol.ts';
import type { SeqOp, SimToMain } from '../../src/shared/protocol.ts';
import type { WorldCamera } from '../../src/shared/world-view.ts';
import type { UiBound, UiHost, UiHostEvents } from '../../src/ui/host.ts';
import { BindingTable } from '../../src/ui/input/bindings.ts';
import { InputCore, type KeyLike, type PointerLike } from '../../src/ui/input/core.ts';
import { ActionEncoder } from '../../src/ui/input/encoder.ts';
import { Resolver } from '../../src/ui/input/resolver.ts';
import type { GameStore } from '../../src/ui/store/game.ts';
import { Protos } from '../../src/ui/store/protos.ts';
import { LAYER, UiState } from '../../src/ui/store/ui.ts';
import type { Selection } from '../../src/ui/world/select.ts';

export const protosJson = {
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
  recipe: [
    {
      name: 'iron-chest',
      icon: 'item/iron-chest',
      handcraft: true,
      enabledAtStart: true,
      time: 0.5,
      group: 0,
      subgroup: 0,
      order: 'a',
      ingredients: [{ kind: 'item', id: 1, amount: 8 }],
      products: [{ kind: 'item', id: 0, amount: 1 }],
    },
  ],
  groups: [],
  subgroups: [],
  resource: [{ name: 'iron-ore-patch', kind: 'solid' }],
  tile: [],
  fluid: [],
  strings: {},
  localeKeys: { AlertType: [], FailReason: [], FlyingText: [], Status: [] },
} as unknown as PrototypesJson;

/** A camera of 800 × 600 CSS px at zoom 1, centred on (0, 0), 32 px per tile (10 §15.7). */
export class TestCamera implements WorldCamera {
  cx = 0;
  cy = 0;
  zoom = 1;
  readonly width = 800;
  readonly height = 600;
  get scale(): number {
    return 32 * this.zoom;
  }
  toWorld(px: number, py: number): { x: number; y: number } {
    return {
      x: this.cx + (px - this.width / 2) / this.scale,
      y: this.cy + (py - this.height / 2) / this.scale,
    };
  }
  toScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: (wx - this.cx) * this.scale + this.width / 2,
      y: (wy - this.cy) * this.scale + this.height / 2,
    };
  }
  visible() {
    const a = this.toWorld(0, 0);
    const b = this.toWorld(this.width, this.height);
    return { x0: Math.floor(a.x), y0: Math.floor(a.y), x1: Math.ceil(b.x), y1: Math.ceil(b.y) };
  }
  zoomBy(n: number): void {
    this.zoom = Math.min(3, Math.max(0.3, this.zoom * 1.1 ** n));
  }
}

export interface FakeEl {
  tagName: string;
  isConnected: boolean;
  closest(sel: string): FakeEl | null;
  blur?: () => void;
  matches?: (sel: string) => boolean;
}

export const element = (kind: 'world' | 'gui' | 'slot' | 'text' | 'button'): FakeEl => {
  const el: FakeEl = {
    tagName: kind === 'text' ? 'INPUT' : kind === 'button' ? 'BUTTON' : kind === 'world' ? 'CANVAS' : 'DIV',
    isConnected: true,
    closest: (sel) =>
      (sel === '[data-slot]' && kind === 'slot') ||
      (sel === '[data-gui]' && (kind === 'gui' || kind === 'slot' || kind === 'button'))
        ? el
        : null,
    blur: () => {},
    matches: () => false,
  };
  return el;
};

export const WORLD = element('world');

export const key = (code: string, mods: Partial<KeyLike> = {}): KeyLike & { prevented: boolean } => {
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

export const mouse = (
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

export const chestAt = (serial: number, x2 = 1, y2 = 1): Selection & { kind: 'entity' } => ({
  kind: 'entity',
  serial,
  proto: 0,
  x2,
  y2,
  dir: 0,
  flags: 0,
});

/** Decodes an `act` buffer into its actions. */
export function decodeActs(buf: Uint8Array): Action[] {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: Action[] = [];
  let at = 0;
  while (at < buf.byteLength) {
    const type = v.getUint16(at, true);
    const len = v.getUint16(at + 2, true);
    out.push(decodeAction(type, buf.subarray(at + 4, at + 4 + len)));
    at += 4 + len;
  }
  return out;
}

export class Rig {
  ui = new UiState();
  protos = new Protos(protosJson, null);
  camera = new TestCamera();
  hand = { key: 0xffff, count: 0, origin: -1, ghost: false };
  character = {
    hand: this.hand,
    quickbarPage: 0,
    main: [] as { key: number; count: number; filter: number }[],
    queue: [] as { recipe: number; count: number; progress: number; flags: number }[],
  };
  sent: Action[] = [];
  seq = 1;
  encoder = new ActionEncoder();
  /** What the world shows at each pointer x (tests place selections by x). */
  world = new Map<number, Selection>();
  focused: FakeEl | null = null;
  resolver: Resolver;
  core: InputCore;
  table = new BindingTable();
  slotKeys: { code: string; mods: number }[] = [];

  constructor() {
    this.encoder.bind({
      act: (buf) => {
        const acts = decodeActs(buf);
        this.sent.push(...acts);
        const first = this.seq;
        this.seq += acts.length;
        expect(first).toBeGreaterThan(0);
        return first;
      },
    });
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
        setZoom: (z) => {
          this.camera.zoom = z;
        },
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
      inGame: () => this.ui.screen[0]() === 'game',
      slotKey: (el, code, mods) => {
        this.slotKeys.push({ code, mods });
        if (code !== 'Enter') return false;
        return this.resolver.activateSlot(
          el,
          this.table.match('Mouse0', mods).map((m) => m.control.id),
        );
      },
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
  /** A window as mounted (a layer of rank z whose [X] runs `close`), as the Window component registers it. */
  layer(z: number, close: () => void): { confirms: { press: () => boolean }[]; remove: () => void } {
    const { layer, remove } = this.ui.pushLayer(z, close);
    return { confirms: layer.confirms, remove };
  }
}

type Listeners = { [K in keyof UiHostEvents]: Set<UiHostEvents[K]> };

/** A host with SimHost's surface: worlds resolve when the test says so; calls are recorded. */
export class FakeHost implements UiHost {
  gen = 0;
  owner: boolean | null = true;
  private next = 1;
  readonly subs = new Map<number, Omit<SubRequest, 'sub_id'>>();
  readonly acts: Action[] = [];
  readonly calls: string[] = [];
  saves: SaveInfo[] = [];
  /** What `save` answers. */
  saveReply: SimToMain = { t: 'saved', id: 1, bytes: 10, ms: 1, sha256: '00' };
  private pending: { resolve: (b: UiBound) => void; reject: (e: Error) => void } | null = null;
  private readonly listeners: Listeners = {
    packet: new Set(),
    generation: new Set(),
    bound: new Set(),
    storage: new Set(),
    trap: new Set(),
  };

  on<K extends keyof UiHostEvents>(name: K, f: UiHostEvents[K]): () => void {
    (this.listeners[name] as Set<UiHostEvents[K]>).add(f);
    return () => (this.listeners[name] as Set<UiHostEvents[K]>).delete(f);
  }

  emit<K extends keyof UiHostEvents>(name: K, ...args: Parameters<UiHostEvents[K]>): void {
    for (const f of this.listeners[name] as Set<(...a: Parameters<UiHostEvents[K]>) => void>) f(...args);
  }

  private start(what: string): Promise<UiBound> {
    this.calls.push(what);
    this.pending?.reject(new Error('superseded'));
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
    });
  }

  newGame(settings: NewWorld): Promise<UiBound> {
    return this.start(`newGame ${settings.seed}`);
  }

  loadSave(name: string): Promise<UiBound> {
    return this.start(`loadSave ${name}`);
  }

  /** The replacement's first packet is shown: the generation switches, then the start resolves. */
  show(gen = this.gen + 1): void {
    this.gen = gen;
    this.emit('bound', { gen, tick: 0, players: [] });
    this.emit('generation', gen);
    const p = this.pending;
    this.pending = null;
    p?.resolve({ gen, tick: 0, players: [] });
  }

  fail(message: string): void {
    const p = this.pending;
    this.pending = null;
    p?.reject(new Error(message));
  }

  exit(): void {
    this.calls.push('exit');
    this.gen = 0;
  }

  act(actions: Uint8Array): number {
    if (this.gen === 0) throw new Error('no world');
    this.acts.push(...decodeActs(actions));
    return 1;
  }

  subscribe(req: Omit<SubRequest, 'sub_id'>): number {
    const id = this.next++;
    this.subs.set(id, req);
    return id;
  }

  resubscribe(id: number, req: Omit<SubRequest, 'sub_id'>): void {
    this.subs.set(id, req);
  }

  unsubscribe(ids: number[]): void {
    for (const id of ids) this.subs.delete(id);
  }

  save(reason: 'manual' | 'auto' | 'exit' | 'checkpoint', name?: string): Promise<SimToMain> {
    this.calls.push(`save ${reason} ${name ?? ''}`);
    return Promise.resolve(this.saveReply);
  }

  listSaves(): Promise<SaveInfo[]> {
    return Promise.resolve(this.saves);
  }

  storage(): Promise<{ usage: number; quota: number; persisted: boolean } | null> {
    return Promise.resolve({ usage: 1, quota: 2, persisted: false });
  }

  setMenuPause(on: boolean): void {
    this.calls.push(`menuPause ${on}`);
  }

  control(op: SeqOp): void {
    this.calls.push(`control ${JSON.stringify(op)}`);
  }

  takeOver(): void {
    this.calls.push('takeOver');
  }
}

/**
 * The layers the mounted windows register (store/ui.ts), without a DOM: the main window (rank 10, its [X] closes
 * it), the game menu (20, Continue is its green button) and a dialog (30, its confirm), as Window, GameMenu and
 * DialogLayer register them. Returns the function that ends it.
 */
export function mountLayers(ui: UiState): () => void {
  return createRoot((dispose) => {
    createEffect(() => {
      if (!ui.window[0]()) return;
      const { remove } = ui.pushLayer(LAYER.window, () => ui.close());
      onCleanup(remove);
    });
    createEffect(() => {
      if (!ui.gameMenu[0]()) return;
      const { layer, remove } = ui.pushLayer(LAYER.gameMenu, () => ui.gameMenu[1](false));
      layer.confirms.push({
        press: () => {
          ui.gameMenu[1](false);
          return true;
        },
      });
      onCleanup(remove);
    });
    createEffect(() => {
      const d = ui.dialog[0]();
      if (!d) return;
      const { layer, remove } = ui.pushLayer(LAYER.dialog, () => ui.dialog[1](null));
      layer.confirms.push({
        press: () => {
          ui.dialog[1](null);
          d.onConfirm();
          return true;
        },
      });
      onCleanup(remove);
    });
    return dispose;
  });
}

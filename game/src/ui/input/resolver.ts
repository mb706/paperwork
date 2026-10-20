// The context resolver (I §1.4, 10 §7.5): what a click or key means. The input core hands it the controls an
// input matched (exact modifier matches first); it evaluates I's contexts in order (text, GUI, modal, tool,
// placeable, usable, other item, empty) against the UI state and the selection, and acts on the first control
// that applies: exactly one UI command or one sim action (encoded by the ActionEncoder) per input. M0's
// skeleton covers the hand loop of I §5 M0: walking, mining (with drag-mining), building with drag lines, the
// cursor (Q, rotate, pipette), I §3.8's slot table, fast transfers with sweeps, hand crafting and the queue, the
// quickbar keys, alt-mode, windows (E confirms, Esc cancels, I §1.4), zoom and the dev speed keys.
//
// Actions outside the current capability manifest are still encoded and sent: the sim refuses them with the
// developer reason `unsupported`, which shows nothing (10 §2.4, §15.6).
import type { Action } from '../../shared/gen/actions.ts';
import type { EntityRef, FinePos } from '../../shared/gen/types.ts';
import { BuildMode, MiningTarget } from '../../shared/gen/types.ts';
import type { GameStore } from '../store/game.ts';
import { NO_ITEM, type Protos } from '../store/protos.ts';
import type { UiState } from '../store/ui.ts';
import type { WorldCamera } from '../world/camera.ts';
import { inReach, type Selection, sameSelection } from '../world/select.ts';
import type { Match } from './bindings.ts';
import type { InputEvent, InputSink } from './core.ts';
import type { ActionEncoder } from './encoder.ts';
import { isGui, NONE_REF, type SlotRef, serialRef, slotAt } from './slots.ts';

/** What the resolver needs from the world view (the renderer's camera and mirror once wired, 10 §3.4). */
export interface WorldInput {
  readonly camera: WorldCamera;
  /** Whether a world is loaded and shown. */
  active(): boolean;
  /** The object under a viewport position (I §3.1), null outside the world. */
  pickAt(x: number, y: number): Selection | null;
  /** The character's position in tiles. */
  character(): { x: number; y: number } | null;
  zoomBy(notches: number): void;
  setZoom(z: number): void;
  /** The current hover selection changed (the view request's hovered_serial, the docked info). */
  setSelection(s: Selection | null): void;
}

/** UI commands the resolver issues that are not windows or actions. */
export interface Commands {
  /** Flying text owned by the UI ("Cannot reach" for opening a GUI out of reach), with the error sound. */
  refuse(reasonKey: string, x: number, y: number): void;
  togglePause(): void;
  speed(factor: number | null): void;
  stepOnce(): void;
  uiScale(step: number | null): void;
  focusSearch(): boolean;
  /** Whether an entity prototype has a GUI to open (I §4.6; M0: containers). */
  hasGui(proto: number): boolean;
  dev: boolean;
}

export interface ResolverHost {
  ui: UiState;
  game: GameStore;
  protos: Protos;
  encoder: ActionEncoder;
  world: WorldInput;
  commands: Commands;
}

const NORTH = 0;

/** Walking directions (§5.1): 8 ways, even Direction values clockwise from north. */
const WALK_DIR: Record<string, number> = {
  '0,-1': 0,
  '1,-1': 2,
  '1,0': 4,
  '1,1': 6,
  '0,1': 8,
  '-1,1': 10,
  '-1,0': 12,
  '-1,-1': 14,
};

export const fine = (v: number): number => Math.floor(v * 256 + 0.5);

interface DragBuild {
  id: number;
  item: number;
  dir: number;
  w: number;
  h: number;
  start: { x2: number; y2: number };
  last: { x2: number; y2: number };
  axis: 'x' | 'y' | null;
  placed: Set<string>;
  sent: boolean;
}

export class Resolver implements InputSink {
  private readonly h: ResolverHost;
  private readonly held = { up: false, down: false, left: false, right: false };
  private walkDir = -1;
  private mining: Selection | null = null;
  private miningHeld = false;
  private drag: DragBuild | null = null;
  private dragIds = 0;
  private sweep: { split: boolean; done: Set<number> } | null = null;
  private dropping: { tile: string } | null = null;
  private picking = false;
  private pointerX = 0;
  private pointerY = 0;
  private pointerEl: Element | null = null;
  private selection: Selection | null = null;
  /** The cursor's build direction (I §3.2: persists between placements and item switches). */
  buildDir = NORTH;

  constructor(host: ResolverHost) {
    this.h = host;
  }

  // ------------------------------------------------------------------------------------------ the sink

  press(matches: Match[], e: InputEvent): string | null {
    for (const m of matches) if (this.apply(m.control.id, e)) return m.control.id;
    return null;
  }

  release(control: string, _e: InputEvent): void {
    switch (control) {
      case 'move-up':
      case 'move-down':
      case 'move-left':
      case 'move-right':
        this.held[control.slice(5) as 'up'] = false;
        this.updateWalking();
        return;
      case 'mine':
        this.miningHeld = false;
        if (this.mining) this.send({ type: 'stop_mining', input_gen: 0 });
        this.mining = null;
        return;
      case 'build':
      case 'build-ghost':
        if (this.drag?.sent) this.send({ type: 'stop_drag_build', drag_id: this.drag.id });
        this.drag = null;
        return;
      case 'fast-entity-transfer':
      case 'fast-entity-split':
        this.sweep = null;
        return;
      case 'pick-items':
        if (this.picking) this.send({ type: 'change_picking_state', input_gen: 0, picking: false });
        this.picking = false;
        return;
      case 'drop-cursor':
        this.dropping = null;
        return;
      case 'activate-tooltip':
        this.h.ui.tooltipNow[1](false);
        return;
    }
  }

  move(x: number, y: number, target: Element | null): void {
    this.pointerX = x;
    this.pointerY = y;
    this.pointerEl = target;
    this.refreshSelection();
  }

  /**
   * Hit-tests the pointer again: a window opened or closed under a still pointer, or the element it was over
   * was replaced (a slot re-rendered). One layout read, only on those occasions.
   */
  retarget(): void {
    this.pointerEl = document.elementFromPoint(this.pointerX, this.pointerY);
    this.refreshSelection();
  }

  /** Re-picks the hover selection (pointer moves, and every packet while the world moves under it). */
  refreshSelection(): void {
    if (this.pointerEl && this.pointerEl.isConnected === false)
      this.pointerEl = document.elementFromPoint(this.pointerX, this.pointerY);
    const over = this.overWorld(this.pointerEl);
    const s = over ? this.h.world.pickAt(this.pointerX, this.pointerY) : null;
    if (!sameSelection(s, this.selection)) {
      this.selection = s;
      this.h.world.setSelection(s);
      this.onSelectionChanged();
    }
    if (this.drag) this.continueDrag();
    if (this.dropping) this.continueDrop();
  }

  releaseAll(): void {
    this.held.up = this.held.down = this.held.left = this.held.right = false;
    this.updateWalking();
    if (this.mining) this.send({ type: 'stop_mining', input_gen: 0 });
    this.mining = null;
    this.miningHeld = false;
    if (this.drag?.sent) this.send({ type: 'stop_drag_build', drag_id: this.drag.id });
    this.drag = null;
    this.sweep = null;
    if (this.picking) this.send({ type: 'change_picking_state', input_gen: 0, picking: false });
    this.picking = false;
    this.dropping = null;
    this.h.ui.tooltipNow[1](false);
  }

  textKey(code: string, mods: number, target: Element): boolean {
    // I §1.3: Esc unfocuses, Enter confirms ([2.1] in a search field it just unfocuses), Tab moves on, Ctrl+F
    // focuses the window's search.
    if (code === 'Escape') {
      (target as HTMLElement).blur();
      return true;
    }
    if (code === 'Enter' || code === 'NumpadEnter') {
      (target as HTMLElement).blur();
      if (!target.matches('[data-search]')) this.h.ui.pressConfirm();
      return true;
    }
    if (code === 'KeyF' && mods === 1) return this.h.commands.focusSearch();
    return false;
  }

  // ------------------------------------------------------------------------------------------ contexts

  private overWorld(el: Element | null): boolean {
    return this.h.ui.screen[0]() === 'game' && this.h.world.active() && !isGui(el);
  }

  private get inGame(): boolean {
    return this.h.ui.screen[0]() === 'game';
  }

  /** A dialog or the game menu: only E and Esc reach the game (I §1.4 context 3). */
  private get modal(): boolean {
    return this.h.ui.dialog[0]() !== null || (this.inGame && this.h.ui.gameMenu[0]());
  }

  private get hand() {
    return this.h.game.character.hand;
  }

  private handPlaceable(): number | undefined {
    const hand = this.hand;
    if (hand.count <= 0 || hand.ghost) return undefined;
    return this.h.protos.places(hand.key);
  }

  private send(a: Action): number {
    return this.h.encoder.send(a);
  }

  private cursorWorld(): { x: number; y: number } {
    return this.h.world.camera.toWorld(this.pointerX, this.pointerY);
  }

  private finePos(): FinePos {
    const w = this.cursorWorld();
    return { x: fine(w.x), y: fine(w.y) };
  }

  // ------------------------------------------------------------------------------------------ controls

  private apply(control: string, e: InputEvent): boolean {
    const ui = this.h.ui;
    // Window keys first: they apply in every context but text (handled by textKey).
    switch (control) {
      case 'toggle-menu':
        return this.escape();
      case 'confirm-gui':
        return this.confirm();
      case 'open-character-gui':
        if (!this.inGame || this.modal || ui.window[0]() !== null) return false;
        ui.open({ kind: 'character' });
        return true;
    }
    if (this.modal || !this.inGame) return false;

    const slot = e.code.startsWith('Mouse') || e.code === 'KeyQ' ? slotAt(this.pointerEl) : null;
    const mouse = e.code.startsWith('Mouse') || e.code.startsWith('Wheel');
    const target = mouse ? e.target : this.pointerEl;
    if (slot) return this.applySlot(control, slot);
    if (mouse && isGui(target)) return false; // a panel's own buttons act on click
    const world = this.overWorld(target);
    const sel = world ? this.h.world.pickAt(this.pointerX, this.pointerY) : null;

    switch (control) {
      case 'move-up':
      case 'move-down':
      case 'move-left':
      case 'move-right':
        this.held[control.slice(5) as 'up'] = true;
        this.updateWalking();
        return true;
      case 'open-gui':
        return world && sel?.kind === 'entity' && this.openEntity(sel);
      case 'build':
        return world && this.startBuild(BuildMode.normal);
      case 'build-ghost':
        return world && this.handPlaceable() !== undefined && this.startBuild(BuildMode.ghost);
      case 'mine':
        if (!world) return false;
        this.miningHeld = true;
        this.mine(sel);
        return true;
      case 'fast-entity-transfer':
      case 'fast-entity-split':
        if (!world || sel?.kind !== 'entity') return false;
        this.sweep = { split: control === 'fast-entity-split', done: new Set() };
        this.sweepOnto(sel);
        return true;
      case 'copy-entity-settings':
        if (!world || sel?.kind !== 'entity') return false;
        this.send({ type: 'copy_entity_settings', source: serialRef(sel.serial) });
        return true;
      case 'clear-cursor':
        if (this.hand.count <= 0 && !this.hand.ghost) return false;
        this.send({ type: 'clear_cursor' });
        return true;
      case 'pipette':
        return this.pipette(sel);
      case 'rotate':
      case 'reverse-rotate':
        return this.rotate(control === 'reverse-rotate', sel);
      case 'flip-horizontal':
      case 'flip-vertical':
        if (sel?.kind !== 'entity') return false;
        this.send({
          type: 'flip_entity',
          target: serialRef(sel.serial),
          axis: control === 'flip-horizontal' ? 0 : 1,
        });
        return true;
      case 'pick-items':
        this.picking = true;
        this.send({ type: 'change_picking_state', input_gen: 0, picking: true });
        return true;
      case 'drop-cursor':
        if (this.hand.count <= 0 || !world) return false;
        this.dropping = { tile: '' };
        this.continueDrop();
        return true;
      case 'show-info':
        ui.altMode[1](!ui.altMode[0]());
        return true;
      case 'activate-tooltip':
        ui.tooltipNow[1](true);
        return true;
      case 'zoom-in':
      case 'zoom-out':
        if (!world) return false;
        this.h.world.zoomBy(control === 'zoom-in' ? 1 : -1);
        return true;
      case 'debug-reset-zoom':
        this.h.world.setZoom(1);
        return true;
      case 'debug-reset-zoom-2x':
        this.h.world.setZoom(2);
        return true;
      case 'production-statistics':
        ui.toggle({ kind: 'stats' });
        return true;
      case 'back':
        ui.goBack();
        return true;
      case 'forward':
        ui.goForward();
        return true;
      case 'focus-search':
        return this.h.commands.focusSearch();
      case 'pause-game':
        this.h.commands.togglePause();
        return true;
      case 'debug-toggle-gui-visibility':
        ui.hideGui[1](!ui.hideGui[0]());
        return true;
      case 'increase-ui-scale':
        this.h.commands.uiScale(1);
        return true;
      case 'decrease-ui-scale':
        this.h.commands.uiScale(-1);
        return true;
      case 'reset-ui-scale':
        this.h.commands.uiScale(null);
        return true;
      case 'rotate-active-quick-bars':
        this.send({ type: 'change_active_quick_bar', page: (this.h.game.character.quickbarPage + 1) % 10 });
        return true;
      case 'editor-speed-up':
      case 'editor-speed-down':
      case 'editor-reset-speed':
        if (!this.h.commands.dev) return false;
        this.h.commands.speed(
          control === 'editor-reset-speed' ? null : control === 'editor-speed-up' ? 2 : 0.5,
        );
        return true;
      case 'editor-toggle-pause':
        if (!this.h.commands.dev) return false;
        this.h.commands.togglePause();
        return true;
      case 'editor-tick-once':
        if (!this.h.commands.dev) return false;
        this.h.commands.stepOnce();
        return true;
    }
    const qb = /^quick-bar-button-(\d+)$/.exec(control);
    if (qb) {
      const i = Number(qb[1]) - 1;
      this.send({ type: 'quick_bar_pick_slot', slot: this.h.game.character.quickbarPage * 10 + i });
      return true;
    }
    const page = /^action-bar-select-page-(\d+)$/.exec(control);
    if (page) {
      this.send({ type: 'change_active_quick_bar', page: Number(page[1]) - 1 });
      return true;
    }
    return false;
  }

  /** Esc (I §1.4): a dialog cancels; a window closes; otherwise the game menu opens or closes (it pauses). */
  private escape(): boolean {
    const ui = this.h.ui;
    const dialog = ui.dialog[0]();
    if (dialog) {
      ui.dialog[1](null);
      return true;
    }
    if (ui.screen[0]() === 'menu') {
      if (ui.menuPage[0]() === 'main') return false;
      ui.menuPage[1]('main');
      return true;
    }
    if (!this.inGame) return false;
    if (ui.gameMenu[0]()) {
      ui.gameMenu[1](false);
      return true;
    }
    if (ui.window[0]() !== null) {
      ui.close();
      return true;
    }
    ui.gameMenu[1](true);
    return true;
  }

  /**
   * E with a window open (I §1.4, FFF-362): the dialog's confirm; else the newest green button on screen (Play,
   * Confirm, the game menu's Continue); else the window closes.
   */
  private confirm(): boolean {
    const ui = this.h.ui;
    const dialog = ui.dialog[0]();
    if (dialog) {
      ui.dialog[1](null);
      dialog.onConfirm();
      return true;
    }
    if (ui.screen[0]() === 'menu') return ui.menuPage[0]() !== 'main' && ui.pressConfirm();
    if (!this.inGame) return false;
    if (ui.gameMenu[0]() || ui.window[0]() !== null) {
      if (ui.pressConfirm()) return true;
      if (ui.gameMenu[0]()) ui.gameMenu[1](false);
      else ui.close();
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------------------------------ GUI slots (I §3.8)

  private applySlot(control: string, s: SlotRef): boolean {
    switch (s.kind) {
      case 'inventory': {
        const slot = { owner: s.owner, inv: s.inv, slot: s.index };
        switch (control) {
          case 'pick-item':
            this.send({ type: 'cursor_transfer', slot });
            return true;
          case 'cursor-split':
            this.send({ type: 'cursor_split', slot });
            return true;
          case 'stack-transfer':
          case 'stack-split':
          case 'inventory-transfer':
          case 'inventory-split': {
            if (s.other === null) return false;
            const type = control.replace('-', '_') as 'stack_transfer';
            this.send({ type, from: slot, to: s.other });
            return true;
          }
          case 'toggle-filter': {
            const handKey = this.hand.count > 0 ? this.hand.key : NO_ITEM;
            this.send({ type: 'set_filter', slot, item: handKey !== NO_ITEM ? handKey : s.key() });
            return true;
          }
          case 'pipette':
            return this.pipetteItem(s.key());
          case 'clear-cursor':
            if (this.hand.count <= 0 && !this.hand.ghost) return false;
            this.send({ type: 'clear_cursor' });
            return true;
        }
        return false;
      }
      case 'recipe':
        if (control === 'craft' || control === 'craft-5' || control === 'craft-all') {
          this.send({
            type: 'craft',
            recipe: s.recipe,
            count: control === 'craft' ? 1 : control === 'craft-5' ? 5 : 0,
          });
          return true;
        }
        if (control === 'pipette') {
          const product = this.h.protos.recipe(s.recipe)?.products[0];
          return product?.kind === 'item' ? this.pipetteItem(product.id * 8) : false;
        }
        return false;
      case 'queue':
        if (control === 'cancel-craft' || control === 'cancel-craft-5' || control === 'cancel-craft-all') {
          this.send({
            type: 'cancel_craft',
            index: s.index,
            count: control === 'cancel-craft' ? 1 : control === 'cancel-craft-5' ? 5 : 0,
          });
          return true;
        }
        return false;
      case 'quickbar': {
        const linked = s.key();
        if (control === 'pick-item') {
          if (linked !== NO_ITEM) this.send({ type: 'quick_bar_pick_slot', slot: s.index });
          else if (this.hand.count > 0)
            this.send({ type: 'quick_bar_set_slot', slot: s.index, item: this.hand.key });
          else return false;
          return true;
        }
        if (control === 'toggle-filter') {
          // MMB clears a quickbar slot (I §4.2), or links the hand's item to an empty one.
          const item = linked !== NO_ITEM ? NO_ITEM : this.hand.count > 0 ? this.hand.key : NO_ITEM;
          if (linked === NO_ITEM && item === NO_ITEM) return false;
          this.send({ type: 'quick_bar_set_slot', slot: s.index, item });
          return true;
        }
        if (control === 'pipette') return linked !== NO_ITEM && this.pipetteItem(linked);
        return false;
      }
    }
  }

  // ------------------------------------------------------------------------------------------ the world

  private updateWalking(): void {
    const x = (this.held.right ? 1 : 0) - (this.held.left ? 1 : 0);
    const y = (this.held.down ? 1 : 0) - (this.held.up ? 1 : 0);
    const dir = x === 0 && y === 0 ? -1 : (WALK_DIR[`${x},${y}`] ?? -1);
    if (dir === this.walkDir) return;
    this.walkDir = dir;
    if (!this.h.encoder.bound) return;
    if (dir < 0) this.send({ type: 'stop_walking', input_gen: 0 });
    else this.send({ type: 'start_walking', input_gen: 0, dir });
  }

  /** LMB on an entity with a GUI (I §1.4): reach-checked, any distance in remote view (not M0). */
  private openEntity(sel: Selection & { kind: 'entity' }): boolean {
    if (!this.h.commands.hasGui(sel.proto)) return false;
    const c = this.h.world.character();
    if (c && !inReach(this.h.protos, sel, c.x, c.y, this.h.protos.character.reach)) {
      this.h.commands.refuse('fail-reason.out-of-reach', this.pointerX, this.pointerY);
      return true;
    }
    this.h.ui.open({ kind: 'entity', serial: sel.serial, proto: sel.proto });
    return true;
  }

  /** RMB held on the selection (I §3.7): an entity, a resource tile; drag-mining follows the cursor. */
  private mine(sel: Selection | null): void {
    if (!sel || sel.kind === 'tile') return;
    if (this.mining && sameSelection(this.mining, sel)) return;
    if (sel.kind === 'entity')
      this.send({ type: 'begin_mining', input_gen: 0, target: serialRef(sel.serial) });
    else
      this.send({
        type: 'begin_mining_terrain',
        input_gen: 0,
        kind: MiningTarget.resource_tile,
        pos: { x: sel.tx * 256 + 128, y: sel.ty * 256 + 128 },
      });
    this.mining = sel;
  }

  private onSelectionChanged(): void {
    const s = this.selection;
    // Drag-mining (I §3.7): the held button mines whatever minable thing the cursor reaches; off any target the
    // mining stops, and it starts again on the next one.
    if (this.miningHeld) {
      if (s && s.kind !== 'tile') this.mine(s);
      else if (this.mining) {
        this.send({ type: 'stop_mining', input_gen: 0 });
        this.mining = null;
      }
    }
    if (this.sweep && s?.kind === 'entity') this.sweepOnto(s);
  }

  /** Ctrl+click sweeps: each entity once per sweep (I §3.8 "Fast transfer in the world"). */
  private sweepOnto(sel: Selection & { kind: 'entity' }): void {
    const sw = this.sweep;
    if (!sw || sw.done.has(sel.serial)) return;
    sw.done.add(sel.serial);
    const target: EntityRef = serialRef(sel.serial);
    this.send(sw.split ? { type: 'fast_entity_split', target } : { type: 'fast_entity_transfer', target });
  }

  private pipette(sel: Selection | null): boolean {
    if (this.hand.count > 0 || this.hand.ghost) return false;
    if (sel?.kind !== 'entity') return false;
    const item = this.h.protos.entity(sel.proto)?.item;
    if (item === null || item === undefined) return false;
    return this.pipetteItem(item * 8, sel.dir);
  }

  private pipetteItem(key: number, dir?: number): boolean {
    if (key === NO_ITEM) return false;
    if (dir !== undefined) this.buildDir = dir;
    this.send({ type: 'pipette', item: key });
    return true;
  }

  private rotate(reverse: boolean, sel: Selection | null): boolean {
    const proto = this.handPlaceable();
    if (proto !== undefined) {
      if (!this.h.protos.entity(proto)?.rotatable) return true;
      this.buildDir = (this.buildDir + (reverse ? 12 : 4)) % 16;
      return true;
    }
    if (sel?.kind !== 'entity') return false;
    this.send({ type: 'rotate_entity', target: serialRef(sel.serial), reverse });
    return true;
  }

  /** The held placeable's footprint under the cursor (tiles), for the build preview; null when none applies. */
  preview(): { x0: number; y0: number; x1: number; y1: number } | null {
    const proto = this.handPlaceable();
    if (proto === undefined || !this.overWorld(this.pointerEl)) return null;
    const dir = this.h.protos.entity(proto)?.rotatable ? this.buildDir : NORTH;
    const w = this.cursorWorld();
    const p = this.placement(proto, dir, w.x, w.y);
    const [sw, sh] = this.h.protos.size(proto, dir);
    return { x0: p.x2 / 2 - sw / 2, y0: p.y2 / 2 - sh / 2, x1: p.x2 / 2 + sw / 2, y1: p.y2 / 2 + sh / 2 };
  }

  /** Where the held entity would stand: odd footprints centre on the tile, even ones snap to corners (I §3.3). */
  placement(proto: number, dir: number, wx: number, wy: number): { x2: number; y2: number } {
    const [w, h] = this.h.protos.size(proto, dir);
    const x2 = w % 2 === 1 ? 2 * Math.floor(wx) + 1 : 2 * Math.round(wx);
    const y2 = h % 2 === 1 ? 2 * Math.floor(wy) + 1 : 2 * Math.round(wy);
    return { x2, y2 };
  }

  /** LMB with a placeable (I §3.3–§3.4): build here, then drag a line locked to the first movement's axis. */
  private startBuild(mode: number): boolean {
    const proto = this.handPlaceable();
    if (proto === undefined) return false;
    const sel = this.h.world.pickAt(this.pointerX, this.pointerY);
    const dir = this.h.protos.entity(proto)?.rotatable ? this.buildDir : NORTH;
    const w = this.cursorWorld();
    const pos = this.placement(proto, dir, w.x, w.y);
    // Blocked only by the selected entity, and it has a GUI: open it instead (I §1.4, inferred).
    if (mode === BuildMode.normal && sel?.kind === 'entity' && this.h.commands.hasGui(sel.proto)) {
      const [sw, sh] = this.h.protos.size(proto, dir);
      const [ew, eh] = this.h.protos.size(sel.proto, sel.dir);
      const overlapX = Math.abs(pos.x2 - sel.x2) < sw + ew;
      const overlapY = Math.abs(pos.y2 - sel.y2) < sh + eh;
      if (overlapX && overlapY) return this.openEntity(sel);
    }
    const [fw, fh] = this.h.protos.size(proto, dir);
    this.drag = {
      id: ++this.dragIds,
      item: this.hand.key,
      dir,
      w: fw,
      h: fh,
      start: pos,
      last: pos,
      axis: null,
      placed: new Set(),
      sent: false,
    };
    this.place(pos, mode);
    return true;
  }

  private place(pos: { x2: number; y2: number }, mode: number = BuildMode.normal): void {
    const d = this.drag;
    if (!d) return;
    const k = `${pos.x2},${pos.y2}`;
    if (d.placed.has(k)) return;
    d.placed.add(k);
    d.last = pos;
    d.sent = true;
    this.send({
      type: 'build',
      item: d.item,
      pos,
      dir: d.dir,
      flip: false,
      mode,
      flags: 1, // smart belt building, the Interface default (I §4.20); client-only (§7.6)
      drag_id: d.id,
    });
  }

  /** Drag-building (I §3.4): locked to the first movement's axis, adjacent steps of the footprint. */
  private continueDrag(): void {
    const d = this.drag;
    if (!d) return;
    const proto = this.h.protos.places(d.item);
    if (proto === undefined) return;
    const w = this.cursorWorld();
    const cur = this.placement(proto, d.dir, w.x, w.y);
    if (d.axis === null) {
      const dx = Math.abs(cur.x2 - d.start.x2);
      const dy = Math.abs(cur.y2 - d.start.y2);
      if (dx < 2 * d.w && dy < 2 * d.h) return;
      d.axis = dx / d.w >= dy / d.h ? 'x' : 'y';
    }
    const stepLen = d.axis === 'x' ? 2 * d.w : 2 * d.h;
    const from = d.axis === 'x' ? d.last.x2 : d.last.y2;
    const to = d.axis === 'x' ? cur.x2 : cur.y2;
    const n = Math.trunc((to - from) / stepLen);
    const sign = n < 0 ? -1 : 1;
    for (let i = 1; i <= Math.abs(n); i++) {
      const v = from + sign * i * stepLen;
      this.place(d.axis === 'x' ? { x2: v, y2: d.start.y2 } : { x2: d.start.x2, y2: v });
    }
  }

  /** Z held (I §2.2): one item per new tile, into the selected entity or onto the ground. */
  private continueDrop(): void {
    const d = this.dropping;
    if (!d || this.hand.count <= 0) return;
    const w = this.cursorWorld();
    const tile = `${Math.floor(w.x)},${Math.floor(w.y)}`;
    if (tile === d.tile) return;
    d.tile = tile;
    const sel = this.selection;
    this.send({
      type: 'drop_item',
      target: sel?.kind === 'entity' ? serialRef(sel.serial) : NONE_REF,
      pos: this.finePos(),
    });
  }
}

// Solid stores fed by decoded projection records (10 §7.2 `store/`, §7.3): CHARACTER (inventory, hand, quickbar,
// crafting queue, mining progress), HUD, the hover (sub_id 0), and per-window INVENTORY, ENTITY_PANEL and STATS
// subscriptions. Records update the stores with `reconcile`, so signals fire only for slots and fields that
// changed and only mounted components re-render (§7.3 step 3).
import { batch, createSignal, type Signal } from 'solid-js';
import { createStore, reconcile, type SetStoreFunction } from 'solid-js/store';
import type { CraftQueueView } from '../../shared/gen/projections.ts';
import { type Character, type Hover, ProjectionKind, type UiRecord } from '../../shared/gen/projections.ts';
import type { SlotView } from '../../shared/gen/types.ts';
import {
  applyStats,
  CHAR_FLAG,
  EMPTY_HAND,
  type HandView,
  handOf,
  type RecordOutcome,
  type StatsView,
} from './records.ts';
import { Subscriptions } from './subs.ts';

export interface CharacterState {
  present: boolean;
  serial: number;
  player: number;
  flags: number;
  quickbarPage: number;
  inputGen: number;
  miningProgress: number;
  hand: HandView;
  main: SlotView[];
  quickbar: number[];
  queue: CraftQueueView[];
}

const emptyCharacter = (): CharacterState => ({
  present: false,
  serial: 0,
  player: 0,
  flags: 0,
  quickbarPage: 0,
  inputGen: 0,
  miningProgress: 0,
  hand: EMPTY_HAND,
  main: [],
  quickbar: [],
  queue: [],
});

export interface InventoryState {
  status: 'waiting' | 'ok' | 'gone' | 'invalid';
  serial: number;
  inv: number;
  bar: number;
  slots: SlotView[];
}

export function characterOf(c: Character): CharacterState {
  return {
    present: true,
    serial: c.serial,
    player: c.player,
    flags: c.flags,
    quickbarPage: c.quickbar_page,
    inputGen: c.input_gen,
    miningProgress: c.mining_progress,
    hand: handOf({ kind: 'CHARACTER', ...c }),
    main: c.main,
    quickbar: c.quickbar,
    queue: c.queue,
  };
}

export class GameStore {
  readonly subs = new Subscriptions();
  readonly character: CharacterState;
  private readonly setCharacter: SetStoreFunction<CharacterState>;
  readonly tick: Signal<number> = createSignal(0);
  readonly hover: Signal<Hover | null> = createSignal<Hover | null>(null);
  /** Main-thread time spent applying the last packet's records, ms (the UI budget, §7.3 step 6). */
  lastApplyMs = 0;
  private characterSub = 0;
  private hudSub = 0;

  constructor() {
    const [c, set] = createStore<CharacterState>(emptyCharacter());
    this.character = c;
    this.setCharacter = set;
    this.subs.onHover((o) =>
      this.hover[1](o.status === 'ok' && o.projection.kind === 'HOVER' ? o.projection : null),
    );
  }

  /** The subscriptions every game screen needs: the player's CHARACTER and the HUD (§15.5). */
  startGame(player: number): void {
    if (this.characterSub === 0)
      this.characterSub = this.subs.subscribe(ProjectionKind.character, { target: player }, (o) => {
        if (o.status === 'ok' && o.projection.kind === 'CHARACTER')
          this.setCharacter(reconcile(characterOf(o.projection), { merge: true }));
        else if (o.status === 'gone') this.setCharacter({ present: false });
      });
    if (this.hudSub === 0)
      this.hudSub = this.subs.subscribe(ProjectionKind.hud, {}, (o) => {
        if (o.status === 'ok' && o.projection.kind === 'HUD') this.tick[1](o.projection.tick);
      });
  }

  /** Back to the menu: every subscription goes with the world. */
  endGame(): void {
    for (const id of [this.characterSub, this.hudSub]) if (id) this.subs.unsubscribe(id);
    this.characterSub = 0;
    this.hudSub = 0;
    batch(() => {
      this.setCharacter(reconcile(emptyCharacter()));
      this.hover[1](null);
      this.tick[1](0);
    });
  }

  /** Applies one packet's UI records. */
  applyUi(records: readonly UiRecord[]): void {
    const t0 = performance.now();
    batch(() => this.subs.route(records));
    this.lastApplyMs = performance.now() - t0;
  }

  get handCount(): number {
    return this.character.hand.count;
  }

  get mining(): boolean {
    return (this.character.flags & CHAR_FLAG.mining) !== 0;
  }

  /**
   * Subscribes to an entity inventory (INVENTORY, p0 = inventory type) for a window; returns its store and the
   * function that ends the subscription.
   */
  watchInventory(
    serial: number,
    inv: number,
    onGone: () => void,
  ): { state: InventoryState; dispose: () => void } {
    const [state, set] = createStore<InventoryState>({ status: 'waiting', serial, inv, bar: 0, slots: [] });
    const id = this.subs.subscribe(
      ProjectionKind.inventory,
      { target: serial, p0: inv },
      (o: RecordOutcome) => {
        if (o.status === 'ok' && o.projection.kind === 'INVENTORY')
          set(
            reconcile(
              {
                status: 'ok',
                serial: o.projection.serial,
                inv: o.projection.view.inv,
                bar: o.projection.view.bar,
                slots: o.projection.view.slots,
              },
              { merge: true },
            ),
          );
        else if (o.status === 'gone') {
          set('status', 'gone');
          onGone();
        } else if (o.status === 'invalid') set('status', 'invalid');
      },
    );
    return { state, dispose: () => this.subs.unsubscribe(id) };
  }

  /** Subscribes to STATS for the statistics window (p0 precision, p1 tab, p2 bit 0: with series). */
  watchStats(
    precision: number,
    tab: number,
  ): {
    stats: () => StatsView | null;
    set: (precision: number, tab: number) => void;
    dispose: () => void;
  } {
    const [stats, setStats] = createSignal<StatsView | null>(null, { equals: false });
    const id = this.subs.subscribe(ProjectionKind.stats, { p0: precision, p1: tab, p2: 1 }, (o) => {
      if (o.status === 'ok' && o.projection.kind === 'STATS') setStats(applyStats(stats(), o.projection));
    });
    return {
      stats,
      set: (p, t) => {
        setStats(null);
        this.subs.replace(id, { p0: p, p1: t, p2: 1 });
      },
      dispose: () => this.subs.unsubscribe(id),
    };
  }
}

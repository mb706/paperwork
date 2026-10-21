// Solid stores fed by decoded projection records (10 §7.2 `store/`, §7.3): CHARACTER (inventory, hand, quickbar,
// crafting queue, mining progress), HUD, the hover (sub_id 0), and per-window INVENTORY, ENTITY_PANEL and STATS
// subscriptions. Records update the stores with `reconcile`, so signals fire only for slots and fields that
// changed and only mounted components re-render (§7.3 step 3); lists reconcile by their keys (the hover's
// contents by item key), so a changed count updates its text and never rebuilds its row (C5-r1 15).
//
// Generations (10 §3.4; C5-r1 11): everything here belongs to the world shown. A new state generation empties the
// character, the hover and the tick before the new world's first record arrives, so nothing of the old world
// stands in for the new one (the loading screen, the reach hints, the resolver); the host sends every live
// subscription to the new world, and the CHARACTER subscription is made again if the old world had dropped it.
//
// The player's character exists only from the tick its player joins (a new world's first tick, §3.3): until then
// CHARACTER answers `gone` and the sim drops the subscription, so it is made again on the player's
// `player_joined` and on each new generation.
import { batch, createComputed, createMemo, createRoot, createSignal, type Signal } from 'solid-js';
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
  type StatRow,
  type StatsView,
  statRows,
} from './records.ts';
import { type SubSink, Subscriptions } from './subs.ts';

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

/** What the character's record changed that the input layer reacts to. */
export interface CharacterChange {
  /** The character appeared (a join, a new world). */
  appeared: boolean;
  /** Its input generation moved (a `release_inputs` fenced the held inputs, 10 §15.3, D22). */
  fenced: boolean;
}

export class GameStore {
  readonly subs: Subscriptions;
  readonly character: CharacterState;
  private readonly setCharacter: SetStoreFunction<CharacterState>;
  readonly tick: Signal<number> = createSignal(0);
  /** The hover record (sub_id 0), its contents reconciled by item key. */
  private readonly hoverStore: { h: Hover | null };
  private readonly setHoverStore: SetStoreFunction<{ h: Hover | null }>;
  /** Main-thread time spent applying the last packet's records, ms (the UI budget, §7.3 step 6). */
  lastApplyMs = 0;
  /** Per item key, how many the main inventory holds: one pass per inventory change (C5-r1 13). */
  readonly totals: () => ReadonlyMap<number, number>;
  /** Called when the character appears or its held inputs were fenced (the resolver sends them again). */
  onCharacter: ((c: CharacterChange) => void) | null = null;
  private player = 0;
  private characterSub = 0;
  private hudSub = 0;
  private playing = false;

  constructor(sink: SubSink) {
    this.subs = new Subscriptions(sink);
    const [c, set] = createStore<CharacterState>(emptyCharacter());
    this.character = c;
    this.setCharacter = set;
    const [h, setH] = createStore<{ h: Hover | null }>({ h: null });
    this.hoverStore = h;
    this.setHoverStore = setH;
    this.totals = createRoot(() =>
      createMemo(() => {
        const m = new Map<number, number>();
        for (const s of this.character.main) if (s.count > 0) m.set(s.key, (m.get(s.key) ?? 0) + s.count);
        return m;
      }),
    );
    this.subs.onHover((o) => {
      const v = o.status === 'ok' && o.projection.kind === 'HOVER' ? o.projection : null;
      if (v === null) this.setHoverStore('h', null);
      else if (this.hoverStore.h === null || this.hoverStore.h.serial !== v.serial)
        this.setHoverStore('h', v);
      else this.setHoverStore('h', reconcile(v, { key: 'key', merge: true }));
    });
  }

  /** The hover record (HOVER, sub_id 0), or null. */
  hover(): Hover | null {
    return this.hoverStore.h;
  }

  /** The subscriptions every game screen needs: the player's CHARACTER and the HUD (§15.5). */
  start(player: number): void {
    this.player = player;
    this.playing = true;
    this.ensureCharacter();
    if (this.hudSub === 0)
      this.hudSub = this.subs.subscribe(ProjectionKind.hud, {}, (o) => {
        if (o.status === 'ok' && o.projection.kind === 'HUD') {
          const tick = o.projection.tick;
          this.tick[1](tick);
          // A join this side missed (a dropped EVENTS section): ask again now and then while there is none.
          if (!this.character.present && this.characterSub === 0 && tick % 30 === 0) this.ensureCharacter();
        } else if (o.status !== 'ok') this.hudSub = 0;
      });
  }

  /** The CHARACTER subscription, made again when the sim dropped it (no character yet). */
  ensureCharacter(): void {
    if (!this.playing || this.characterSub !== 0) return;
    this.characterSub = this.subs.subscribe(ProjectionKind.character, { target: this.player }, (o) => {
      if (o.status === 'ok' && o.projection.kind === 'CHARACTER') {
        const was = this.character;
        const appeared = !was.present;
        const fenced = was.present && was.inputGen !== o.projection.input_gen;
        this.setCharacter(reconcile(characterOf(o.projection), { merge: true }));
        if (appeared || fenced) this.onCharacter?.({ appeared, fenced });
      } else {
        // gone (no character: not joined yet, or left) or invalid: the sim dropped the subscription
        this.characterSub = 0;
        this.setCharacter(reconcile(emptyCharacter()));
      }
    });
  }

  /** A player joined (the `player_joined` event): ours gets its CHARACTER subscription back. */
  playerJoined(player: number): void {
    if (player === this.player) this.ensureCharacter();
  }

  /**
   * A new state generation is shown (§3.4 step 3): the old world's character, hover and tick go before the new
   * world's first record; the host re-sends the live subscriptions, CHARACTER is made again if it was dropped.
   */
  newGeneration(): void {
    batch(() => {
      this.setCharacter(reconcile(emptyCharacter()));
      this.setHoverStore('h', null);
      this.tick[1](0);
    });
    if (this.hudSub === 0 && this.playing) this.start(this.player);
    else this.ensureCharacter();
  }

  /** Back to the menu: every subscription goes with the world. */
  end(): void {
    this.playing = false;
    this.subs.clear();
    this.characterSub = 0;
    this.hudSub = 0;
    batch(() => {
      this.setCharacter(reconcile(emptyCharacter()));
      this.setHoverStore('h', null);
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

/**
 * One half of the statistics window as a store reconciled by StatKey (C5-r1 15): a STATS record that changes a
 * rate updates that row's fields in place, so its DOM stays; rows come and go only with their keys.
 */
export function createStatRows(
  stats: () => StatsView | null,
  side: 'produced' | 'consumed',
  tick: () => number,
): () => StatRow[] {
  const [list, setList] = createStore<StatRow[]>([]);
  createComputed(() => setList(reconcile(statRows(stats(), side, tick()), { key: 'key' })));
  return () => list;
}

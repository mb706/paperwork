// What the UI uses of the App (10 §3.1, §3.4; C3's composition root): the simulation host and the world view, as
// structural types, because ui/ imports only ui/ and shared/ (10 §2.2). src/app/attach-ui.ts hands the real ones in
// (`app.host`, a SimHost; the WorldView from `attachRenderer`); tests hand in fakes.
//
// Ownership (C3-r1 16, C4-r1 12): the host owns worlds, state generations, seqs, the view request's numbering and
// the subscriptions it re-sends to a new world; the world view owns the camera, the view model and picking; the UI
// owns input, its stores and the screens.
import type { NewWorld } from '../shared/gen/abi.ts';
import type { SubRequest } from '../shared/gen/projections.ts';
import type { SaveInfo } from '../shared/io-protocol.ts';
import type { SeqOp, SimToMain } from '../shared/protocol.ts';

export type { WorldCamera, WorldPick, WorldViewApi } from '../shared/world-view.ts';

/** A world bound (§3.2 `bound`): its generation, tick and players' seq watermarks. */
export interface UiBound {
  gen: number;
  tick: number;
  players: { index: number; lastSeq: number; inputGen: number }[];
}

/** The host's events the UI listens to (SimHostEvents' subset). */
export interface UiHostEvents {
  /** A packet of the current generation; valid only during the call (the host acks it after the listeners). */
  packet: (bytes: Uint8Array, gen: number) => void;
  /** The shown world changed generation (§3.4 step 3): everything of the old world is dropped. */
  generation: (gen: number) => void;
  bound: (b: UiBound) => void;
  /** Whether this tab owns the saves (§8.2): the read-only notice and *Take over*. */
  storage: (s: { owner: boolean; reason?: string }) => void;
  /** The world trapped (§3.6); the host reloads the last autosave. */
  trap: (t: { gen: number; tick: number; message: string; report: string | null }) => void;
}

/** The simulation host as the UI drives it (src/app/sim-host.ts's SimHost satisfies it). */
export interface UiHost {
  /** The shown generation, 0 when no world is shown. */
  readonly gen: number;
  /** Whether this tab owns the saves; null until the IO worker knows. */
  readonly owner: boolean | null;
  on<K extends keyof UiHostEvents>(name: K, f: UiHostEvents[K]): () => void;
  /** Starts a world in a fresh worker (§3.4); resolves once its first packet is shown. */
  newGame(settings: NewWorld): Promise<UiBound>;
  /** Loads a stored save (the IO worker reads and checks it). */
  loadSave(name: string): Promise<UiBound>;
  /** Ends the shown world (back to the menu). */
  exit(): void;
  /** Encoded actions, back to back (§15.3); returns the first one's seq. Throws without a world. */
  act(actions: Uint8Array): number;
  /** A subscription (§15.5); the host allocates its sub_id and re-sends it to every new world. */
  subscribe(req: Omit<SubRequest, 'sub_id'>): number;
  resubscribe(id: number, req: Omit<SubRequest, 'sub_id'>): void;
  unsubscribe(ids: number[]): void;
  /** Resolves with `saved` only after the IO worker wrote, checked and published the save (§8.2, §8.4). */
  save(reason: 'manual' | 'auto' | 'exit' | 'checkpoint', name?: string): Promise<SimToMain>;
  listSaves(): Promise<SaveInfo[]>;
  storage(): Promise<{ usage: number; quota: number; persisted: boolean } | null>;
  /** The game menu pauses single player (I §4.0). */
  setMenuPause(on: boolean): void;
  /** Pause, resume, speed and steps (S14). */
  control(op: SeqOp): void;
  /** *Take over* the saves from another tab (§8.2). */
  takeOver(): void;
}

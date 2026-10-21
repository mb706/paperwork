// The UI's shared services, handed to every component through one Solid context: the prototype view, the
// stores, the binding table (hotkey hints), the resolver's hooks and the session's commands.
import { createContext, useContext } from 'solid-js';
import type { SoundSettings } from '../host.ts';
import type { BindingTable } from '../input/bindings.ts';
import type { ActionEncoder } from '../input/encoder.ts';
import type { GameStore } from '../store/game.ts';
import type { DomManifest, Protos } from '../store/protos.ts';
import type { UiState } from '../store/ui.ts';
import type { Selection } from '../world/select.ts';

/** The menus' and the game menu's commands (session.ts implements them over the host). */
export interface SessionApi {
  newGame(seed: number): void;
  /** The stored saves, newest first (§8.2). */
  listSaves(): Promise<SaveEntry[]>;
  loadSave(name: string): void;
  /**
   * Saves the game under `name`. Resolves `ok` only once the IO worker has written, checked and published it, so
   * it can be loaded (10 §8.2, §8.4); otherwise with the reason.
   */
  saveGame(name: string): Promise<{ ok: true } | { ok: false; message: string }>;
  /** The name the save dialog suggests: the loaded save's, else the map's seed. */
  suggestedName(): string;
  exitToMenu(): void;
  /** Single player pauses while the game menu is open (I §4.0). */
  setMenuPause(paused: boolean): void;
  /** Storage use for the main menu's footer (07 §18), or null when the browser does not say. */
  storage(): Promise<{ used: number; quota: number } | null>;
  /** Whether this tab owns the saves (§8.2 "One tab at a time"); null until the IO worker knows. */
  owner(): boolean | null;
  /** *Take over* (07 §19.2): the other tab saves and drops to read-only. */
  takeOver(): void;
}

export interface SaveEntry {
  /** The save's name (its id in storage). */
  id: string;
  name: string;
  /** Game time in ticks. */
  tick: number;
  /** Milliseconds since the epoch. */
  date: number;
  loadable: boolean;
}

export interface UiServices {
  protos: () => Protos | null;
  /** The sprite manifest's DOM part (the skin, glyphs, icon sheets), present before any world is loaded. */
  dom: DomManifest | null;
  game: GameStore;
  ui: UiState;
  bindings: () => BindingTable;
  setBindings: (b: BindingTable) => void;
  encoder: ActionEncoder;
  session: SessionApi;
  selection: () => Selection | null;
  build: { build: string; buildHash: string; dev: boolean };
  /** Whether an entity prototype has a window (I §4.6; M0: containers). */
  hasGui: (proto: number) => boolean;
  /** Current UI scale (I §4.0). */
  scale: () => number;
  /** The viewport in CSS px. */
  viewport: () => { w: number; h: number };
  /** The viewport, in GUI px after the UI scale, is too narrow for the flat character screen (I §4.4). */
  narrow: () => boolean;
  /** The UI scale setting in percent, 0 for automatic. */
  uiScaleSetting: () => number;
  setUiScaleSetting: (v: number) => void;
  /** Suspends game input (the Controls screen's capture). */
  setInputEnabled: (on: boolean) => void;
  /** A UI sound by its sounds.yaml name (ui-click, error …); the app wires it to the audio module. */
  sound: (name: string) => void;
  /** The Sound tab's settings as stored (I §4.20). */
  soundSettings: () => SoundSettings;
  /** Applies volumes at once (the Sound tab previews while a slider moves); `keep` also stores them. */
  setSoundSettings: (s: SoundSettings, keep: boolean) => void;
}

export const Services = createContext<UiServices>();

export function useServices(): UiServices {
  const s = useContext(Services);
  if (!s) throw new Error('UI services missing');
  return s;
}

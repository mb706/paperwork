// The UI's shared services, handed to every component through one Solid context: the prototype view, the
// stores, the binding table (hotkey hints), the resolver's hooks and the session's commands.
import { createContext, useContext } from 'solid-js';
import type { BindingTable } from '../input/bindings.ts';
import type { ActionEncoder } from '../input/encoder.ts';
import type { GameStore } from '../store/game.ts';
import type { DomManifest, Protos } from '../store/protos.ts';
import type { UiState } from '../store/ui.ts';
import type { Selection } from '../world/select.ts';

/** What the app provides for the menus and the game menu (src/app/session.ts implements it). */
export interface SessionApi {
  newGame(seed: number): void;
  /** The saves the storage layer lists (newest first). */
  listSaves(): Promise<SaveEntry[]>;
  loadSave(id: string): void;
  saveGame(): Promise<boolean>;
  exitToMenu(): void;
  /** Single player pauses while the game menu is open (I §4.0). */
  setMenuPause(paused: boolean): void;
  /** Storage use for the main menu's footer (07 §18), or null when the browser does not say. */
  storage(): Promise<{ used: number; quota: number } | null>;
}

export interface SaveEntry {
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
  /** The UI scale setting in percent, 0 for automatic. */
  uiScaleSetting: () => number;
  setUiScaleSetting: (v: number) => void;
  /** Suspends game input (the Controls screen's capture). */
  setInputEnabled: (on: boolean) => void;
  /** A UI sound by its sounds.yaml name (ui-click, error …); the app wires it to the audio module. */
  sound: (name: string) => void;
}

export const Services = createContext<UiServices>();

export function useServices(): UiServices {
  const s = useContext(Services);
  if (!s) throw new Error('UI services missing');
  return s;
}

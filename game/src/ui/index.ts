// The UI layer's public entry (10 §7): everything the app (src/app/) uses from src/ui/.
export type {
  CharacterFacts,
  DomManifest,
  SaveEntry,
  SessionApi,
  UiHandle,
  UiHost,
  UiHostEvents,
  UiOptions,
  UiTestHooks,
  WorldViewApi,
} from './mount.tsx';
export { characterFacts, mountUi } from './mount.tsx';

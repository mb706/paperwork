// The UI layer's public entry (10 §7): everything the app (src/app/) uses from src/ui/.
export type {
  CharacterFacts,
  DomManifest,
  SaveEntry,
  SessionApi,
  SimPort,
  UiHandle,
  UiOptions,
  UiTestHooks,
} from './mount.tsx';
export { mountUi } from './mount.tsx';

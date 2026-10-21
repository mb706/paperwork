// The UI layer's public entry (10 §7): everything the app (src/app/) uses from src/ui/.
export type {
  CharacterFacts,
  DomManifest,
  SaveEntry,
  SessionApi,
  SoundCategory,
  SoundSettings,
  UiAudio,
  UiHandle,
  UiHost,
  UiHostEvents,
  UiOptions,
  UiTestHooks,
  WorldViewApi,
} from './mount.tsx';
export { characterFacts, mountUi, SOUND_CATEGORIES } from './mount.tsx';

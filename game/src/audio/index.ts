// The audio layer's public API (10 §9.4; `audio/` imports only itself and `shared/`, 10 §2.2). The app wires
// it: it imports the worklet modules' URLs with Vite's `?worker&url` and passes them in, routes decoded
// packets and the HUD's music feed to it, and the UI calls the settings hooks and `unlock()`.
//
//   import bankUrl from '../audio/worklet/bank.ts?worker&url';
//   const audio = new AudioSystem({ worklets: { bank: bankUrl } });
//   void audio.preload();                       // at page load
//   menu.onFirstGesture(() => audio.unlock());  // inside the first click or key handler (07 §18)

export { encodePacket, StandinPacket } from './feed/standin.ts';
export type { AudioEventRecord, AudioPacketView, MusicFeed, ProtoInfo, WorkingRecord } from './feed/types.ts';
export { EVENT } from './feed/types.ts';
export type { Fetcher, Priority } from './loading/packs.ts';
export type { AudioSettings, Category } from './mixer/volumes.ts';
export { CATEGORIES, defaultSettings, sanitizeSettings } from './mixer/volumes.ts';
export type { Ticker } from './music/scheduler.ts';
export type { ListenerView } from './sfx/spatial.ts';
export type { AudioMode, AudioOptions, AudioState, AudioStatus } from './system.ts';
export { AudioSystem, ENGINE_RATE } from './system.ts';

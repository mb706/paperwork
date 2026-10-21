// Audio on the App (10 §9.4, §15.6; C7's runtime, attached by C9): main.ts's one line,
// `const audio = await attachAudio(app, world)`, after the renderer and before the UI, which drives it through the
// structural `UiAudio` (src/ui/host.ts): GUI sounds, the Sound tab's volumes, and what shows (the main menu's
// recording, or a game's music program from its seed). Everything else follows the world by itself:
//   - every packet of the shown world → `onRenderPacket`: EVENTS (the event map of sounds.yaml) and AUDIO_WORKING
//     (working loops); historical events and events older than 30 ticks never sound (§15.6), a new state generation
//     resets the SFX, and loops fade when packets stop (catch-up, fast-forward, a hidden page);
//   - the HUD's records (the UI's subscription) → `onHud`, the music feed (Literature year, activity, closure);
//   - the camera after every packet and frame → `setView` (Factorio's attenuation and pan, §9.4);
//   - the world's pause, any reason (the game menu, the player's pause, a hidden page) → `setPaused` (test mode
//     excepted: its worlds are paused by design and stepped);
//   - the local character's mover, as the renderer draws it: a footstep on each run cycle (A4 §7.3: tied to the walk
//     cycle, about 3.7 a second at running speed) and a hammer strike on each swing of the mining clip (Factorio
//     plays its mining sound on the swing too); none when the world skips ticks (a catch-up, a load), since
//     historical motion never sounds;
//   - the page's first gesture (pointerdown or keydown, in the capture phase, so inside the handler) unlocks the
//     AudioContext, and any later one while the browser keeps it blocked (07 §18; §9.4 "User activation").
// `window.__game.audio` (dev builds): the system and its status, for tests.

import { entitySizes, protoInfoOf } from '../audio/feed/protos.ts';
import { AudioSystem } from '../audio/index.ts';
import type { ScriptEvent, SessionScript } from '../audio/offline.ts';
import bankUrl from '../audio/worklet/bank.ts?worker&url';
import { decodePacket, MoverCodec } from '../shared/gen/packet.ts';
import { HudCodec, ProjectionKind, UiRecordCodec, UiStatus } from '../shared/gen/projections.ts';
import type { PrototypesJson } from '../shared/gen/protos.ts';
import { MoverFlags } from '../shared/gen/types.ts';
import { chunkId } from '../shared/world-view.ts';
import type { SoundSettings, UiAudio } from '../ui/index.ts';
import type { App } from './app.ts';
import type { WorldView } from './world-view.ts';

/** The local player in single player (§3.3). */
const LOCAL_PLAYER = 0;
/** Fine positions per tile (§15.4). */
const POS_ONE = 256;
/** The run clip's tiles per cycle when the sprite manifest does not say (C6's character: 2.3). */
const RUN_CYCLE_TILES = 2.3;
/** The mining clip: one swing a second, the hammer striking at 0.6 of it (C6's character, frame 9.6 of 16). */
const SWING_TICKS = 60;
const STRIKE_AT = 36;
/**
 * More ticks than this between two packets: the world caught up or fast-forwarded, and its motion is not heard
 * (§15.6's 30 ticks for events); fewer is a packet that covers a few ticks (a busy main thread), heard at most twice.
 */
const MAX_GAP_TICKS = 30;

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

/** The footstep surface of a tile type: concrete for paved tiles, else grass (M0's two footstep sounds). */
export function footstepSurface(tile: string | undefined): 'grass' | 'concrete' {
  return tile !== undefined && (tile.includes('concrete') || tile === 'town-street') ? 'concrete' : 'grass';
}

export interface AttachedAudio extends UiAudio {
  readonly system: AudioSystem;
}

export async function attachAudio(app: App, world: WorldView): Promise<AttachedAudio> {
  const protos = await fetchJson<PrototypesJson>('/data/prototypes.json');
  const sprites = await fetchJson<{
    sets?: Record<string, { parts?: Record<string, { cycleTiles?: number }> }>;
  }>('/atlases/sprites.json').catch(() => null);
  const runCycle =
    Object.values(sprites?.sets ?? {}).find((s) => s.parts?.run?.cycleTiles)?.parts?.run?.cycleTiles ??
    RUN_CYCLE_TILES;
  // dev builds keep the last sounds played, by name, for the tests (`__game.audio.played()`)
  const played: string[] = [];
  const audio = new AudioSystem({
    worklets: { bank: bankUrl },
    soundIds: protos.sounds,
    prototypesHash: protos.prototypesHash,
    proto: protoInfoOf(protos),
    ...(app.hooks
      ? {
          onPlayed: (name: string) => {
            played.push(name);
            if (played.length > 500) played.splice(0, played.length - 500);
          },
        }
      : {}),
  });
  audio.setLocalPlayer(LOCAL_PLAYER);
  void audio.preload();

  // dev builds: a session's audio inputs, recorded for an offline render (`__game.audio.record`, C9): the packets
  // with events or working sounds, the sounds this page plays itself, the camera; timed by game ticks
  let rec: { tick0: number; tick: number; events: ScriptEvent[] } | null = null;
  const sound = (name: string, x?: number, y?: number) => {
    if (x === undefined || y === undefined) audio.ui(name);
    else audio.at(name, x, y);
    if (rec && rec.tick0 >= 0)
      rec.events.push({
        t: (rec.tick - rec.tick0) / 60,
        sound: x === undefined || y === undefined ? { name } : { name, x, y },
      });
  };

  // the first gesture, and any later one while the browser keeps the context blocked (07 §18)
  const gesture = () => {
    if (audio.state !== 'running' && audio.state !== 'closed') audio.unlock();
  };
  addEventListener('pointerdown', gesture, { capture: true });
  addEventListener('keydown', gesture, { capture: true });

  // the listener: the camera, after each packet (the view follows the character) and each drawn frame
  const listen = () => {
    const c = world.camera;
    if (c.scale <= 0 || c.width <= 0) return;
    audio.setView({
      cx: c.cx,
      cy: c.cy,
      halfWidth: Math.min(64, c.width / c.scale / 2),
      zoom: c.zoom,
      mapView: false,
    });
  };
  world.onFrame(listen);

  // the world's pause, whatever its reason (test mode's worlds are paused by design and stepped)
  app.host.on('clock', (c) => audio.setPaused(c.paused && !app.test));

  // the local character's motion as the renderer draws it: footsteps on the run cycle, strikes on the mining clip
  const me = { tick: -1, x: 0, y: 0, walked: 0 };
  app.host.on('generation', () => {
    me.tick = -1;
  });
  const character = () => {
    const mv = world.model.movers;
    for (let i = 0; i < mv.count; i++) {
      const o = i * MoverCodec.SIZE;
      if (mv.view.getUint8(o + MoverCodec.OFFSET.kind) !== 0) continue;
      if (mv.view.getUint16(o + MoverCodec.OFFSET.aux, true) !== LOCAL_PLAYER) continue;
      return o;
    }
    return -1;
  };
  const surfaceAt = (x: number, y: number) => {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    const c = world.model.chunks.get(chunkId(Math.floor(tx / 32), Math.floor(ty / 32)));
    const id = c?.tiles?.[(((ty % 32) + 32) % 32) * 32 + (((tx % 32) + 32) % 32)];
    return footstepSurface(id === undefined ? undefined : protos.tile[id]?.name);
  };
  const motion = (tick: number) => {
    const o = character();
    if (o < 0) {
      me.tick = -1;
      return;
    }
    const v = world.model.movers.view;
    const x = v.getInt32(o + MoverCodec.OFFSET.x, true) / POS_ONE;
    const y = v.getInt32(o + MoverCodec.OFFSET.y, true) / POS_ONE;
    const mining = (v.getUint8(o + MoverCodec.OFFSET.flags) & MoverFlags.mining) !== 0;
    const gap = tick - me.tick;
    if (me.tick >= 0 && gap > 0 && gap <= MAX_GAP_TICKS) {
      me.walked += Math.hypot(x - me.x, y - me.y);
      let steps = 0;
      while (me.walked >= runCycle) {
        me.walked -= runCycle;
        if (steps++ < 2) sound(`footstep-${surfaceAt(x, y)}`, x, y);
      }
      let strikes = 0;
      if (mining)
        for (let t = me.tick + 1; t <= tick; t++)
          if (t % SWING_TICKS === STRIKE_AT && strikes++ < 2) sound('mine-ore', x, y);
    } else me.walked = runCycle / 2; // the first step half a cycle in
    me.tick = tick;
    me.x = x;
    me.y = y;
  };

  // the music feed: the HUD's records (the UI subscribes HUD for every game screen)
  const hud = (section: { bytes: Uint8Array; count: number } | undefined) => {
    if (!section) return;
    const b = section.bytes;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let o = 0;
    for (let i = 0; i < section.count && o + UiRecordCodec.PREFIX <= b.byteLength; i++) {
      const len = dv.getUint32(o + UiRecordCodec.OFFSET.len, true);
      if (
        dv.getUint16(o + UiRecordCodec.OFFSET.kind, true) === ProjectionKind.hud &&
        dv.getUint16(o + UiRecordCodec.OFFSET.status, true) === UiStatus.ok
      ) {
        audio.onHud(HudCodec.decode(b.subarray(o + UiRecordCodec.PREFIX, o + UiRecordCodec.PREFIX + len)));
        return;
      }
      o += (UiRecordCodec.PREFIX + len + 3) & ~3;
    }
  };

  app.host.on('packet', (bytes) => {
    let p: ReturnType<typeof decodePacket>;
    try {
      p = decodePacket(bytes);
    } catch {
      return; // the UI reports a packet it cannot decode
    }
    audio.onRenderPacket(p);
    hud(p.sections.find((s) => s.name === 'UI'));
    if (rec) {
      if (rec.tick0 < 0) rec.tick0 = p.header.tick;
      rec.tick = p.header.tick;
      const c = world.camera;
      const view = { cx: c.cx, cy: c.cy, halfWidth: Math.min(64, c.width / c.scale / 2 || 32), zoom: c.zoom };
      const audible = p.sections.some((s) => s.name === 'EVENTS' || s.name === 'AUDIO_WORKING');
      rec.events.push({
        t: (p.header.tick - rec.tick0) / 60,
        view,
        ...(audible ? { packet: [...bytes] } : {}),
      });
    }
    motion(p.header.tick);
    listen();
  });

  let inGame = false;
  const attached: AttachedAudio = {
    system: audio,
    ui: (name) => sound(name),
    setSettings: (s: SoundSettings) => audio.setSettings(s),
    scene: (s) => {
      if ('menu' in s) {
        if (inGame) audio.endGame();
        inGame = false;
        audio.playMenu();
      } else {
        inGame = true;
        audio.startGame(s.game);
      }
    },
  };
  app.hooks?.register({
    audio: {
      system: audio,
      status: () => audio.status(),
      played: () => [...played],
      /** Starts recording the session's audio inputs (`stop` returns them, with the prototypes' footprints). */
      record: () => {
        rec = { tick0: -1, tick: 0, events: [] };
      },
      stop: (): SessionScript => {
        const events = rec?.events ?? [];
        rec = null;
        return { events, entitySizes: entitySizes(protos) };
      },
    },
  });
  return attached;
}

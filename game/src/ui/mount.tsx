// The UI layer's entry (10 §7): mounts the Solid shell over the world canvas and wires the input core, the
// resolver, the action encoder, the projection stores and the M0 world stand-in. The app (src/app/) owns the sim
// worker and hands this module decoded packets and a port; the UI never reads simulation state directly (§7.3).
//
//   const ui = mountUi({ root, canvas, protos, dom, build, session, character });
//   ui.loading(0.2);                          // a world is starting
//   ui.bound(port, player, lastSeq);          // `bound`: actions and subscriptions flow (§3.2 seq rule)
//   ui.packet(decodePacket(bytes), events);   // every packet of the current state generation
//   ui.unbound();                             // the world is gone (back to the menu)
import { createEffect, createSignal, Match, on, onCleanup, Show, Switch } from 'solid-js';
import { render } from 'solid-js/web';
import { EVENT_STALE_TICKS, type EventHeader, type EventPayload, readEvents } from '../shared/gen/events.ts';
import type { Packet, ViewRequest } from '../shared/gen/packet.ts';
import { readUiRecords } from '../shared/gen/projections.ts';
import type { PrototypesJson } from '../shared/gen/protos.ts';
import { Services, type SessionApi, type UiServices } from './core/context.ts';
import { Tooltip } from './core/Tooltip.tsx';
import { CursorStack } from './hud/CursorStack.tsx';
import { FlyingTexts } from './hud/flying.ts';
import { Hud } from './hud/Hud.tsx';
import { dataString, formatCount, setDataStrings, t } from './i18n/locale.ts';
import { BindingTable } from './input/bindings.ts';
import { InputCore } from './input/core.ts';
import { ActionEncoder, type ActPort } from './input/encoder.ts';
import { loadKeyboardLayout, setMac } from './input/keys.ts';
import { Resolver } from './input/resolver.ts';
import { isGui } from './input/slots.ts';
import { DialogLayer, GameMenu, Loading } from './menu/GameMenu.tsx';
import { MainMenu } from './menu/MainMenu.tsx';
import { autoScale, loadSettings, saveSettings } from './settings.ts';
import { GameStore } from './store/game.ts';
import { type CharacterFacts, type DomManifest, Protos } from './store/protos.ts';
import type { SubPort } from './store/subs.ts';
import { UiState } from './store/ui.ts';
import { CharacterScreen } from './windows/CharacterScreen.tsx';
import { EntityWindow } from './windows/EntityWindow.tsx';
import { StatsWindow } from './windows/StatsWindow.tsx';
import { FollowCamera } from './world/camera.ts';
import { Mirror } from './world/mirror.ts';
import { Plate } from './world/plate.ts';
import { pick, type Selection, sameSelection } from './world/select.ts';

export type { SaveEntry, SessionApi } from './core/context.ts';
export type { CharacterFacts, DomManifest } from './store/protos.ts';

/** The world's port as the UI uses it: actions, subscriptions and the view request (§3.2). */
export interface SimPort extends ActPort, SubPort {
  view(v: ViewRequest): void;
}

export interface UiOptions {
  root: HTMLElement;
  /** The world canvas under the DOM (the renderer's; the M0 stand-in plate draws on it when `plate`). */
  canvas: HTMLCanvasElement;
  build: { build: string; buildHash: string; dev: boolean };
  session: SessionApi;
  /** The sprite manifest's DOM part (icons, the skin), when the asset build has run. */
  dom: DomManifest | null;
  /** Draw the stand-in plate (no renderer yet). */
  plate: boolean;
  /** Pauses, speeds and steps (sequencer control, S14): single player and dev keys. */
  control?: (op: 'pause' | 'resume' | { speed: number } | { step: number }) => void;
  /** The UI sound hook (the audio module's `ui(name)`). */
  sound?: (name: string) => void;
}

export interface UiHandle {
  /** The prototypes of the world about to run (the M1 build in fake mode). */
  setPrototypes(json: PrototypesJson, character?: CharacterFacts): void;
  loading(progress: number): void;
  bound(port: SimPort, player: number, lastSeq: number): void;
  packet(p: Packet): void;
  unbound(): void;
  notice(text: string | null): void;
  /** Test hooks (`window.__ui` in dev builds). */
  readonly test: UiTestHooks;
  dispose(): void;
}

export interface UiTestHooks {
  sent(): { seq: number; type: string; action: unknown; at: number }[];
  state(): {
    screen: string;
    window: string | null;
    gameMenu: boolean;
    altMode: boolean;
    hand: { key: number; count: number; origin: number };
    main: { key: number; count: number }[];
    queue: { recipe: number; count: number }[];
    selection: Selection | null;
    camera: { x: number; y: number; zoom: number };
    flying: string[];
    problems: string[];
    applyMs: number;
  };
  /** Viewport px of a world position (tests click entities through the real input layer). */
  toScreen(x: number, y: number): { x: number; y: number };
  entities(): { serial: number; proto: number; name: string; x: number; y: number }[];
  character(): { x: number; y: number } | null;
}

const DEV_REASONS = new Set([1, 2, 3, 4, 5]);

export function mountUi(o: UiOptions): UiHandle {
  const settings = loadSettings();
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  setMac(mac);
  void loadKeyboardLayout();
  const ui = new UiState();
  const game = new GameStore();
  const encoder = new ActionEncoder();
  const camera = new FollowCamera();
  const mirror = new Mirror();
  const [protos, setProtos] = createSignal<Protos | null>(null);
  const [bindings, setBindingsSignal] = createSignal(new BindingTable(settings.keybindings));
  const [selection, setSelection] = createSignal<Selection | null>(null, { equals: sameSelection });
  const [scaleSetting, setScaleSetting] = createSignal(settings.interface.uiScale);
  const [viewport, setViewport] = createSignal({ w: window.innerWidth, h: window.innerHeight });
  const scale = () => (scaleSetting() > 0 ? scaleSetting() / 100 : autoScale(viewport().h));
  let port: SimPort | null = null;
  let player = 0;
  let characterSerial = 0;
  let viewSeq = 0;
  let lastView = '';
  let worldTick = 0;
  let paused = false;
  let speed = 1;
  const plate = o.plate ? new Plate(o.canvas, protos) : null;

  const persist = () =>
    saveSettings({
      version: 1,
      keybindings: bindings().settings,
      interface: { uiScale: scaleSetting() },
    });

  const hasGui = (proto: number) => protos()?.entity(proto)?.type === 'chest';

  const services: UiServices = {
    protos,
    dom: o.dom,
    game,
    ui,
    bindings,
    setBindings: (b) => {
      setBindingsSignal(b);
      core.setTable(b);
      persist();
    },
    encoder,
    session: o.session,
    selection,
    build: o.build,
    hasGui,
    scale,
    uiScaleSetting: scaleSetting,
    setUiScaleSetting: (v) => {
      setScaleSetting(v);
      persist();
    },
    setInputEnabled: (on) => core.setEnabled(on),
    sound: (name) => o.sound?.(name),
  };

  const flying = new FlyingTexts(o.root, (key) => {
    const p = protos();
    const name = p?.itemByKey(key)?.icon;
    if (!p || !name || !p.hasIcon(name)) return null;
    const ref = p.icon(name);
    const url = ref ? p.sheet(ref.group, 64) : null;
    if (!ref || !url) return null;
    const el = document.createElement('span');
    el.className = 'icon flying-icon';
    const z = 20;
    el.style.cssText = `width:${z}px;height:${z}px;background-image:url("/${url}");background-size:${ref.columns * z}px ${ref.rows * z}px;background-position:-${(ref.index % ref.columns) * z}px -${Math.floor(ref.index / ref.columns) * z}px`;
    return el;
  });

  const characterPos = (): { x: number; y: number } | null => {
    const m = characterSerial ? mirror.mover(characterSerial) : undefined;
    return m ? { x: m.x / 256, y: m.y / 256 } : null;
  };

  const resolver = new Resolver({
    ui,
    game,
    get protos() {
      return protos() as Protos;
    },
    encoder,
    world: {
      camera,
      active: () => port !== null && protos() !== null,
      pickAt: (x, y) => {
        const p = protos();
        if (!p || port === null) return null;
        const w = camera.toWorld(x, y);
        return pick(mirror, p, w.x, w.y);
      },
      character: characterPos,
      zoomBy: (n) => camera.zoomBy(n),
      setZoom: (z) => camera.setZoom(z),
      setSelection: (s) => setSelection(s),
    },
    commands: {
      refuse: (key, x, y) => {
        const w = camera.toWorld(x, y);
        flying.add(t(key), w.x, w.y, { error: true });
        o.sound?.('error');
      },
      togglePause: () => {
        paused = !paused;
        o.control?.(paused ? 'pause' : 'resume');
      },
      speed: (f) => {
        speed = f === null ? 1 : Math.min(64, Math.max(1 / 64, speed * f));
        o.control?.({ speed });
      },
      stepOnce: () => o.control?.({ step: 1 }),
      uiScale: (step) => {
        if (step === null) setScaleSetting(0);
        else {
          const cur = Math.round(scale() * 100);
          setScaleSetting(Math.min(300, Math.max(50, cur + step * 25)));
        }
        persist();
      },
      focusSearch: () => {
        const btn = document.querySelector<HTMLButtonElement>('[data-testid="crafting-search-button"]');
        const field = document.querySelector<HTMLInputElement>('[data-window] [data-search]');
        if (field) {
          field.focus();
          return true;
        }
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      },
      hasGui,
      dev: o.build.dev,
    },
  });
  const core = new InputCore(bindings(), resolver, { mac, isGui });
  core.attach(window);

  // ---------------------------------------------------------------------------------------- the frame loop

  let raf = 0;
  let lastMirror = -1;
  let lastCam = '';
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const pos = characterPos();
    if (pos) camera.follow(pos.x, pos.y);
    const camKey = `${camera.cx},${camera.cy},${camera.zoom}`;
    if (camKey !== lastCam || mirror.version !== lastMirror) {
      lastCam = camKey;
      lastMirror = mirror.version;
      resolver.refreshSelection();
      sendView();
      if (plate && ui.screen[0]() === 'game') plate.draw(mirror, camera, selection(), characterSerial);
    }
    flying.frame(camera, now, scale());
  };
  raf = requestAnimationFrame(frame);

  const resize = () => {
    setViewport({ w: window.innerWidth, h: window.innerHeight });
    camera.setViewport(0, 0, window.innerWidth, window.innerHeight);
    plate?.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
    lastCam = '';
  };
  window.addEventListener('resize', resize);
  resize();

  function sendView(): void {
    if (!port) return;
    const v = camera.visible();
    const sel = selection();
    const hovered = sel?.kind === 'entity' ? sel.serial : 0;
    const flags = (1 << 3) | (ui.altMode[0]() ? 1 << 4 : 0);
    const key = `${v.x0},${v.y0},${v.x1},${v.y1},${camera.zoom.toFixed(3)},${hovered},${flags}`;
    if (key === lastView) return;
    lastView = key;
    viewSeq += 1;
    const req: ViewRequest = {
      view_seq: viewSeq,
      surface: 0,
      flags,
      ...v,
      zoom: camera.zoom,
      hovered_serial: hovered,
      audio_half_range: Math.min(64, (v.x1 - v.x0) / 2),
      chart_x0: 0,
      chart_y0: 0,
      chart_x1: 0,
      chart_y1: 0,
    };
    mirror.sentView(req);
    port.view(req);
  }

  // ---------------------------------------------------------------------------------------- events

  const flyingFor = (h: EventHeader, e: EventPayload): void => {
    const p = protos();
    if (!p) return;
    if (e.type === 'flying_text') {
      const x = e.pos.x / 256;
      const y = e.pos.y / 256;
      const name = p.itemName(e.item);
      if (e.text === 1) {
        const n = `${e.count > 0 ? '+' : ''}${formatCount(e.count)}`;
        const text =
          e.total >= 0
            ? t('flying.item-delta-total', n, name, formatCount(e.total))
            : t('flying.item-delta', n, name);
        flying.add(text, x, y, { item: e.item });
      } else {
        const key = p.json.localeKeys.FlyingText.find((k) => k.value === e.text)?.key;
        if (key) flying.add(t(key, name), x, y, { error: e.text === 4 || e.text === 5 });
      }
    } else if (e.type === 'action_failed' && h.player === player) {
      if (DEV_REASONS.has(e.reason)) return;
      const key = p.json.localeKeys.FailReason.find((k) => k.value === e.reason)?.key;
      if (!key) return;
      let arg = '';
      if (e.reason === 20) {
        const ent = mirror.entity(e.serial);
        arg = ent
          ? p.entityName(ent.proto)
          : p.entityName(p.json.entity.findIndex((x) => x.type === 'character'));
      } else if (e.reason === 21) {
        const tile = mirror.tileAt(Math.floor(e.pos.x / 256), Math.floor(e.pos.y / 256));
        const tl = tile === null ? undefined : p.json.tile[tile];
        arg = tl ? dataString(tl.localeName, tl.name) : '';
      }
      flying.add(t(key, arg), e.pos.x / 256, e.pos.y / 256, { error: true });
    } else if (e.type === 'entity_mined') ui.forgetEntity(e.serial);
  };

  // ---------------------------------------------------------------------------------------- mount

  const dispose = render(
    () => (
      <Services.Provider value={services}>
        <div class="ui-scale" style={{ zoom: String(scale()) }}>
          <Switch>
            <Match when={ui.screen[0]() === 'menu'}>
              <MainMenu />
            </Match>
            <Match when={ui.screen[0]() === 'loading'}>
              <Loading />
            </Match>
            <Match when={ui.screen[0]() === 'game'}>
              <Hud />
              <Windows />
              <GameMenu />
            </Match>
          </Switch>
          <DialogLayer />
          <Tooltip />
          <CursorStack />
        </div>
      </Services.Provider>
    ),
    o.root,
  );

  function Windows() {
    const w = () => ui.window[0]();
    onCleanup(() => ui.tooltip[1](null));
    // A window that opens or closes under a still pointer changes what the pointer is over (GUI or world).
    createEffect(
      on(
        () => [ui.window[0](), ui.gameMenu[0](), ui.dialog[0]()],
        () => {
          ui.tooltip[1](null);
          resolver.retarget();
        },
        { defer: true },
      ),
    );
    return (
      <Show when={w()} keyed>
        {(win) => (
          <Switch>
            <Match when={win.kind === 'character'}>
              <CharacterScreen />
            </Match>
            <Match when={win.kind === 'entity' && win}>
              {(e) => {
                const ent = e() as { serial: number; proto: number };
                return <EntityWindow serial={ent.serial} proto={ent.proto} />;
              }}
            </Match>
            <Match when={win.kind === 'stats'}>
              <StatsWindow />
            </Match>
          </Switch>
        )}
      </Show>
    );
  }

  const handle: UiHandle = {
    setPrototypes(json, character) {
      setDataStrings(json.strings);
      setProtos(new Protos(json, o.dom, character));
    },
    loading(progress) {
      ui.resetGame();
      ui.screen[1]('loading');
      ui.loadingProgress[1](progress);
    },
    bound(p, playerIndex, lastSeq) {
      port = p;
      player = playerIndex;
      paused = false;
      speed = 1;
      lastView = '';
      mirror.clear();
      encoder.bind(p, lastSeq);
      game.subs.attach(p);
      game.startGame(playerIndex);
    },
    packet(p) {
      const t0 = performance.now();
      mirror.apply(p);
      worldTick = p.header.tick;
      for (const s of p.sections) {
        if (s.name === 'UI') game.applyUi(readUiRecords(s.bytes, s.count));
        else if (s.name === 'EVENTS') {
          for (const { header, payload } of readEvents(s.bytes, s.count)) {
            if ((header.flags & 1) !== 0 || header.tick + EVENT_STALE_TICKS < worldTick) continue;
            flyingFor(header, payload);
          }
        }
      }
      if (game.character.present && game.character.serial !== characterSerial)
        characterSerial = game.character.serial;
      if (ui.screen[0]() === 'loading' && game.character.present) ui.screen[1]('game');
      game.lastApplyMs = performance.now() - t0;
    },
    unbound() {
      port = null;
      encoder.bind(null);
      game.subs.attach(null);
      game.endGame();
      mirror.clear();
      flying.clear();
      characterSerial = 0;
      ui.resetGame();
      ui.screen[1]('menu');
      ui.menuPage[1]('main');
    },
    notice(text) {
      ui.notice[1](text);
    },
    test: {
      sent: () => encoder.log.map((x) => ({ seq: x.seq, type: x.action.type, action: x.action, at: x.at })),
      state: () => {
        const c = game.character;
        const w = ui.window[0]();
        return {
          screen: ui.screen[0](),
          window: w ? (w.kind === 'entity' ? `entity:${w.serial}` : w.kind) : null,
          gameMenu: ui.gameMenu[0](),
          altMode: ui.altMode[0](),
          hand: { key: c.hand.key, count: c.hand.count, origin: c.hand.origin },
          main: c.main.map((s) => ({ key: s.key, count: s.count })),
          queue: c.queue.map((q) => ({ recipe: q.recipe, count: q.count })),
          selection: selection(),
          camera: { x: camera.cx, y: camera.cy, zoom: camera.zoom },
          flying: [...o.root.querySelectorAll('.flying span')].map((x) => x.textContent ?? ''),
          problems: [...game.subs.problems],
          applyMs: game.lastApplyMs,
        };
      },
      toScreen: (x, y) => camera.toScreen(x, y),
      entities: () => {
        const p = protos();
        return [...mirror.entities()].map((e) => ({
          serial: e.serial,
          proto: e.proto,
          name: p?.json.entity[e.proto]?.name ?? '',
          x: e.x2 / 2,
          y: e.y2 / 2,
        }));
      },
      character: characterPos,
    },
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      core.detach();
      dispose();
    },
  };
  return handle;
}

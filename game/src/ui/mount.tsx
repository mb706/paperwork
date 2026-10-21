// The UI layer's entry (10 §7): mounts the Solid shell over the world canvas and wires the input core, the
// resolver, the action encoder, the projection stores and the world overlay to the App (src/app/attach-ui.ts hands
// in its host and C4's world view, as the structural types of ./host.ts). The UI never reads simulation state
// directly (§7.3): it sees the host's packets (UI records and events), and the world through the world view's
// camera, picking and view model.
//
//   const ui = mountUi({ root, host: app.host, world, protos, dom, build });
//   // the main menu starts worlds through the host; ui.test is `__game.ui` in dev builds
import { createEffect, createSignal, Match, on, onCleanup, Show, Switch } from 'solid-js';
import { render } from 'solid-js/web';
import type { EventHeader, EventPayload } from '../shared/gen/events.ts';
import type { PrototypesJson } from '../shared/gen/protos.ts';
import { Services, type UiServices } from './core/context.ts';
import { Tooltip } from './core/Tooltip.tsx';
import type { UiHost, WorldViewApi } from './host.ts';
import { CursorStack } from './hud/CursorStack.tsx';
import { FlyingTexts } from './hud/flying.ts';
import { Hud } from './hud/Hud.tsx';
import { formatCount, setDataStrings, t } from './i18n/locale.ts';
import { BindingTable } from './input/bindings.ts';
import { InputCore } from './input/core.ts';
import { ActionEncoder } from './input/encoder.ts';
import { loadKeyboardLayout, setMac } from './input/keys.ts';
import { type Commands, Resolver } from './input/resolver.ts';
import { gridMove, isGui } from './input/slots.ts';
import { DialogLayer, GameMenu, Loading, StorageNotice } from './menu/GameMenu.tsx';
import { MainMenu } from './menu/MainMenu.tsx';
import { applyPacket } from './packets.ts';
import { GameSession, LOCAL_PLAYER } from './session.ts';
import { autoScale, loadSettings, saveSettings } from './settings.ts';
import { GameStore } from './store/game.ts';
import { type CharacterFacts, type DomManifest, Protos } from './store/protos.ts';
import { UiState } from './store/ui.ts';
import { CharacterScreen } from './windows/CharacterScreen.tsx';
import { EntityWindow } from './windows/EntityWindow.tsx';
import { StatsWindow } from './windows/StatsWindow.tsx';
import { type Preview, WorldOverlay } from './world/overlay.ts';
import {
  dist2,
  footprintFree,
  modelEntities,
  modelEntity,
  modelResources,
  modelTile,
  type PreviewState,
  type Selection,
  sameSelection,
} from './world/select.ts';

export type { SaveEntry, SessionApi } from './core/context.ts';
export type { UiHost, UiHostEvents, WorldViewApi } from './host.ts';
export type { CharacterFacts, DomManifest } from './store/protos.ts';
export { characterFacts } from './store/protos.ts';

export interface UiOptions {
  /** The UI's root, over the world canvas. */
  root: HTMLElement;
  /** The App's simulation host (C3's SimHost). */
  host: UiHost;
  /** The App's world view (C4's renderer): camera, picking, the view model. */
  world: WorldViewApi;
  build: { build: string; buildHash: string; dev: boolean };
  /** The page's prototype build (prototypes.json). */
  protos: PrototypesJson;
  character?: CharacterFacts | undefined;
  /** The sprite manifest's DOM part (icons, the skin), when the asset build has run. */
  dom: DomManifest | null;
  /** The UI sound hook (the audio module's `ui(name)`). */
  sound?: (name: string) => void;
  /** F4 and F5 (I §4.21, dev builds): the world view's debug overlays and timings. */
  debugKey?: Commands['debugKey'];
}

export interface UiHandle {
  readonly session: GameSession;
  /** Test hooks (`__game.ui` in dev builds). */
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
    messages: string[];
    problems: string[];
    applyMs: number;
    gen: number;
    present: boolean;
  };
  /** Viewport px of a world position (tests click entities through the real input layer). */
  toScreen(x: number, y: number): { x: number; y: number };
  entities(): { serial: number; proto: number; name: string; x: number; y: number }[];
  /** The resource tiles the view model holds, at their centres. */
  resources(): { x: number; y: number; name: string }[];
  character(): { x: number; y: number } | null;
  /** The last 600 packet applications and UI frames, ms. */
  perf(): { packet: number[]; frame: number[] };
}

const DEV_REASONS = new Set([1, 2, 3, 4, 5]);
/** GUI px the flat character screen needs: two 10-wide panels and the frame (I §4.4: about 880 at 100 %). */
const FLAT_MIN_WIDTH = 920;

export function mountUi(o: UiOptions): UiHandle {
  const settings = loadSettings();
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  setMac(mac);
  void loadKeyboardLayout();
  setDataStrings(o.protos.strings);
  const ui = new UiState();
  const game = new GameStore(o.host);
  const encoder = new ActionEncoder();
  const protos = new Protos(o.protos, o.dom, o.character);
  const world = o.world;
  const [bindings, setBindingsSignal] = createSignal(new BindingTable(settings.keybindings));
  const [selection, setSelection] = createSignal<Selection | null>(null, { equals: sameSelection });
  const [scaleSetting, setScaleSetting] = createSignal(settings.interface.uiScale);
  const [viewport, setViewport] = createSignal({ w: window.innerWidth, h: window.innerHeight });
  const scale = () => (scaleSetting() > 0 ? scaleSetting() / 100 : autoScale(viewport().h));
  let paused = false;
  let speed = 1;

  const persist = () =>
    saveSettings({
      version: 1,
      keybindings: bindings().settings,
      interface: { uiScale: scaleSetting() },
    });

  const hasGui = (proto: number) => protos.entity(proto)?.type === 'chest';

  // The layers under the UI's root: the world overlay (selection brackets, the build preview), then the shell.
  const overlay = new WorldOverlay(o.root);
  const shell = document.createElement('div');
  shell.className = 'ui-shell';
  o.root.append(shell);

  const flying = new FlyingTexts(o.root, (key) => {
    const name = protos.itemByKey(key)?.icon;
    if (!name || !protos.hasIcon(name)) return null;
    const ref = protos.icon(name);
    const url = ref ? protos.sheet(ref.group, 64) : null;
    if (!ref || !url) return null;
    const el = document.createElement('span');
    el.className = 'icon flying-icon';
    const z = 20;
    el.style.cssText = `width:${z}px;height:${z}px;background-image:url("/${url}");background-size:${ref.columns * z}px ${ref.rows * z}px;background-position:-${(ref.index % ref.columns) * z}px -${Math.floor(ref.index / ref.columns) * z}px`;
    return el;
  });

  const resolver = new Resolver({
    ui,
    game,
    protos,
    encoder,
    world: {
      camera: world.camera,
      active: () => session.gen !== 0 && world.active(),
      pickAt: (x, y) => (session.gen !== 0 ? world.pickAt(x, y) : null),
      character: () => world.character(),
      zoomBy: (n) => world.zoomBy(n),
      setZoom: (z) => world.setZoom(z),
      setSelection: (s) => {
        setSelection(s);
        // The hovered entity is the view request's hovered_serial, which drives the HOVER projection (§15.4).
        world.setHovered(s?.kind === 'entity' ? s.serial : 0);
      },
    },
    commands: {
      refuse: (key, x, y) => {
        const w = world.camera.toWorld(x, y);
        flying.add(t(key), w.x, w.y, { error: true });
        o.sound?.('error');
      },
      togglePause: () => {
        paused = !paused;
        o.host.control(paused ? 'pause' : 'resume');
      },
      speed: (f) => {
        speed = f === null ? 1 : Math.min(64, Math.max(1 / 64, speed * f));
        o.host.control({ speed });
      },
      stepOnce: () => o.host.control({ step: 1 }),
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
      ...(o.debugKey ? { debugKey: o.debugKey } : {}),
      dev: o.build.dev,
    },
  });
  const core = new InputCore(bindings(), resolver, {
    mac,
    isGui,
    inGame: () => ui.screen[0]() === 'game',
    // A focused slot (C5-r1 17): Enter is its left click (with the held modifiers), the context-menu key its right
    // click, the arrows move to the next slot.
    slotKey: (el, code, mods) => {
      if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space' || code === 'ContextMenu') {
        const button = code === 'ContextMenu' ? 'Mouse2' : 'Mouse0';
        return resolver.activateSlot(
          el,
          bindings()
            .match(button, mods)
            .map((m) => m.control.id),
        );
      }
      return gridMove(el, code);
    },
  });
  core.attach(window);

  const session = new GameSession({
    host: o.host,
    ui,
    game,
    encoder,
    onGeneration: () => {
      // Everything derived from the old world goes (§3.4); the world view emptied its model already.
      resolver.newWorld();
      flying.clear();
      setSelection(null);
      overlay.clear();
      world.follow(LOCAL_PLAYER);
    },
    onLeave: () => {
      resolver.newWorld();
      flying.clear();
      setSelection(null);
      overlay.clear();
    },
  });
  // The character appeared (a join, a load) or its held inputs were fenced: what is still held is sent again.
  game.onCharacter = () => resolver.reassertHeld();

  const services: UiServices = {
    protos: () => protos,
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
    session,
    selection,
    build: o.build,
    hasGui,
    scale,
    viewport,
    narrow: () => viewport().w / scale() < FLAT_MIN_WIDTH,
    uiScaleSetting: scaleSetting,
    setUiScaleSetting: (v) => {
      setScaleSetting(v);
      persist();
    },
    setInputEnabled: (on) => core.setEnabled(on),
    sound: (name) => o.sound?.(name),
  };

  // ---------------------------------------------------------------------------------------- the frame loop

  let raf = 0;
  /** What the overlay and the selection were last computed from (numbers only: the loop allocates nothing). */
  const last = { cx: Number.NaN, cy: Number.NaN, zoom: 0, w: 0, h: 0, packets: -1, epoch: -1 };
  let lastPreview: Preview | null = null;
  let lastSel: Selection | null = null;
  let previewKey = '';
  let previewState: PreviewState = 'buildable';
  /** The last 600 packet applications and frames, in ms (the UI budget, 10 §7.3 step 6 and §11). */
  const perf = { packet: [] as number[], frame: [] as number[] };
  const record = (list: number[], ms: number) => {
    list.push(ms);
    if (list.length > 600) list.shift();
  };
  /** The held placeable's preview (I §3.3): its tint from the view model, recomputed when it or the world moves. */
  const preview = (): Preview | null => {
    const pv = resolver.preview();
    if (!pv) return null;
    const box = { x0: pv.x0, y0: pv.y0, x1: pv.x1, y1: pv.y1 };
    const key = `${pv.x0},${pv.y0},${pv.x1},${pv.y1},${pv.ghost},${world.model.packets}`;
    if (key !== previewKey) {
      previewKey = key;
      const c = world.character();
      const reach = protos.character.build;
      previewState = pv.ghost
        ? 'ghost'
        : !footprintFree(world.model, protos, box)
          ? 'blocked'
          : c && dist2(c.x, c.y, box) > reach * reach
            ? 'too-far'
            : 'buildable';
    }
    return { box, state: previewState, item: pv.item };
  };
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (ui.screen[0]() !== 'game' || session.gen === 0) return;
    const t0 = performance.now();
    const cam = world.camera;
    const m = world.model;
    const moved =
      cam.cx !== last.cx ||
      cam.cy !== last.cy ||
      cam.zoom !== last.zoom ||
      cam.width !== last.w ||
      cam.height !== last.h ||
      m.packets !== last.packets ||
      m.epoch !== last.epoch;
    if (moved) {
      last.cx = cam.cx;
      last.cy = cam.cy;
      last.zoom = cam.zoom;
      last.w = cam.width;
      last.h = cam.height;
      last.packets = m.packets;
      last.epoch = m.epoch;
      resolver.refreshSelection();
    }
    const pv = preview();
    const sel = selection();
    const previewMoved =
      pv?.box.x0 !== lastPreview?.box.x0 ||
      pv?.box.y0 !== lastPreview?.box.y0 ||
      pv?.state !== lastPreview?.state ||
      (pv === null) !== (lastPreview === null);
    if (moved || previewMoved || sel !== lastSel) {
      lastPreview = pv;
      lastSel = sel;
      overlay.draw(cam, protos, sel, pv);
    }
    flying.frame(cam, now, scale());
    record(perf.frame, performance.now() - t0);
  };
  raf = requestAnimationFrame(frame);

  const resize = () => {
    setViewport({ w: window.innerWidth, h: window.innerHeight });
    overlay.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
    last.w = 0; // the overlay was cleared: draw it again
  };
  window.addEventListener('resize', resize);
  resize();

  // ---------------------------------------------------------------------------------------- packets and events

  const flyingFor = (h: EventHeader, e: EventPayload): void => {
    if (e.type === 'flying_text') {
      // Flying text is the acting player's own (Factorio's local flying text); others' stays theirs.
      if (h.player !== LOCAL_PLAYER && h.player !== 0xffff) return;
      const x = e.pos.x / 256;
      const y = e.pos.y / 256;
      const name = protos.itemName(e.item);
      if (e.text === 1) {
        const n = `${e.count > 0 ? '+' : ''}${formatCount(e.count)}`;
        const text =
          e.total >= 0
            ? t('flying.item-delta-total', n, name, formatCount(e.total))
            : t('flying.item-delta', n, name);
        flying.add(text, x, y, { item: e.item });
      } else {
        const key = protos.json.localeKeys.FlyingText.find((k) => k.value === e.text)?.key;
        if (!key) return;
        if (e.text === 4) {
          // "Cannot insert X. Inventory is full." is the bottom-left message (I §3.7–§3.9, Factorio 2.0.77).
          ui.addMessage(t(key, name), true);
        } else if (e.text === 5) {
          // "Cannot put away the X. …" is flying text at the mouse cursor (I §3.2).
          const ptr = core.pointer();
          const at = world.camera.toWorld(ptr.x, ptr.y);
          flying.add(t(key, name), at.x, at.y, { error: true });
        } else flying.add(t(key, name), x, y);
      }
    } else if (e.type === 'action_failed' && h.player === LOCAL_PLAYER) {
      if (DEV_REASONS.has(e.reason)) return;
      const key = protos.json.localeKeys.FailReason.find((k) => k.value === e.reason)?.key;
      if (!key) return;
      let arg = '';
      if (e.reason === 20) {
        const ent = modelEntity(world.model, e.serial);
        arg = ent
          ? protos.entityName(ent.proto)
          : protos.entityName(protos.json.entity.findIndex((x) => x.type === 'character'));
      } else if (e.reason === 21) {
        const tile = modelTile(world.model, Math.floor(e.pos.x / 256), Math.floor(e.pos.y / 256));
        arg = tile === null ? '' : protos.tileName(tile);
      }
      flying.add(t(key, arg), e.pos.x / 256, e.pos.y / 256, { error: true });
      o.sound?.('error');
    } else if (e.type === 'entity_mined') ui.forgetEntity(e.serial);
  };

  const offPacket = o.host.on('packet', (bytes) => {
    const t0 = performance.now();
    applyPacket(bytes, {
      game,
      player: LOCAL_PLAYER,
      reassertHeld: () => resolver.reassertHeld(),
      present: flyingFor,
    });
    record(perf.packet, performance.now() - t0);
  });

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
              <StorageNotice />
            </Match>
          </Switch>
          <DialogLayer />
          <Tooltip />
          <CursorStack />
        </div>
      </Services.Provider>
    ),
    shell,
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
    session,
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
          camera: { x: world.camera.cx, y: world.camera.cy, zoom: world.camera.zoom },
          flying: [...o.root.querySelectorAll('.flying span')].map((x) => x.textContent ?? ''),
          messages: ui.messages[0]().map((m) => m.text),
          problems: [...game.subs.problems],
          applyMs: game.lastApplyMs,
          gen: session.gen,
          present: c.present,
        };
      },
      toScreen: (x, y) => world.camera.toScreen(x, y),
      entities: () =>
        [...modelEntities(world.model)].map((e) => ({
          serial: e.serial,
          proto: e.proto,
          name: protos.json.entity[e.proto]?.name ?? '',
          x: e.x2 / 2,
          y: e.y2 / 2,
        })),
      resources: () =>
        [...modelResources(world.model)].map((r) => ({
          x: r.tx + 0.5,
          y: r.ty + 0.5,
          name: protos.json.resource[r.resource]?.name ?? '',
        })),
      character: () => world.character(),
      perf: () => ({ packet: [...perf.packet], frame: [...perf.frame] }),
    },
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      offPacket();
      core.detach();
      dispose();
    },
  };
  return handle;
}

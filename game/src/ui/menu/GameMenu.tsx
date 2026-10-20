// The game menu (Esc; I §4.20): Continue, Save game, Load game, Settings, Tips and tricks, Exit to main menu (with
// an unsaved-progress confirmation). It pauses single player while open (I §4.0). Each page opened over it (Save
// game, Load game, Settings) is a layer of its own: Esc and its [X] go back to the menu, E presses its green button
// (store/ui.ts layers). The loading screen (07 §18: a progress bar; the loading tip joins when the data stage exports
// the tips), confirmation dialogs and the saves' read-only notice live here too.
import {
  createEffect,
  createResource,
  createSignal,
  For,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { type SaveEntry, useServices } from '../core/context.ts';
import { Button, Panel, Window } from '../core/Window.tsx';
import { formatDuration, t } from '../i18n/locale.ts';
import { LAYER } from '../store/ui.ts';
import { SettingsWindow } from '../windows/SettingsWindow.tsx';

export function GameMenu(): JSX.Element {
  const s = useServices();
  const [page, setPage] = createSignal<'menu' | 'settings' | 'load' | 'save'>('menu');
  createEffect(() => {
    const open = s.ui.gameMenu[0]();
    s.session.setMenuPause(open);
    if (!open) setPage('menu');
  });
  onCleanup(() => s.session.setMenuPause(false));
  const close = () => s.ui.gameMenu[1](false);
  const back = () => setPage('menu');
  const exit = () =>
    s.ui.dialog[1]({
      title: t('menu.exit-to-main-menu'),
      text: t('menu.unsaved-progress'),
      confirm: t('menu.exit'),
      cancel: t('button.cancel'),
      red: true,
      onConfirm: () => s.session.exitToMenu(),
    });
  return (
    <Show when={s.ui.gameMenu[0]()}>
      <div class="menu-veil" data-gui="" />
      <div class="game-menu-layer">
        <Window
          id="game-menu"
          title={t('menu.game-menu')}
          testid="game-menu"
          class={page() === 'menu' ? 'game-menu' : 'game-menu hidden'}
          layer={LAYER.gameMenu}
          onClose={close}
        >
          <div class="menu-column">
            <Button variant="confirm" onClick={close} testid="game-menu-continue">
              {t('menu.continue')}
            </Button>
            <Button
              onClick={() => setPage('save')}
              disabled={s.session.owner() === false}
              testid="game-menu-save"
            >
              {t('menu.save-game')}
            </Button>
            <Button onClick={() => setPage('load')} testid="game-menu-load">
              {t('menu.load-game')}
            </Button>
            <Button onClick={() => setPage('settings')} testid="game-menu-settings">
              {t('menu.settings')}
            </Button>
            <Button disabled>{t('menu.tips-and-tricks')}</Button>
            <Button variant="red" onClick={exit} testid="game-menu-exit">
              {t('menu.exit-to-main-menu')}
            </Button>
          </div>
        </Window>
        <Switch>
          <Match when={page() === 'settings'}>
            <SettingsWindow onClose={back} layer={LAYER.gameMenuPage} />
          </Match>
          <Match when={page() === 'load'}>
            <LoadWindow onBack={back} layer={LAYER.gameMenuPage} />
          </Match>
          <Match when={page() === 'save'}>
            <SaveWindow onBack={back} onSaved={close} />
          </Match>
        </Switch>
      </div>
    </Show>
  );
}

/**
 * Save game (I §4.20 BEND-3): a name (the loaded save's, else the map's seed) and [Save]. The window stays until
 * the save is stored and checked (10 §8.2), then the game goes on; a failure shows its reason.
 */
function SaveWindow(props: { onBack: () => void; onSaved: () => void }): JSX.Element {
  const s = useServices();
  const [name, setName] = createSignal(s.session.suggestedName());
  const [busy, setBusy] = createSignal(false);
  const [failed, setFailed] = createSignal<string | null>(null);
  const save = async () => {
    const n = name().trim();
    if (n === '' || busy()) return;
    setBusy(true);
    setFailed(null);
    const r = await s.session.saveGame(n);
    setBusy(false);
    if (r.ok) props.onSaved();
    else setFailed(r.message);
  };
  return (
    <Window
      id="save-game"
      title={t('menu.save-game')}
      onClose={props.onBack}
      layer={LAYER.gameMenuPage}
      modal
      testid="window-save-game"
    >
      <Panel class="save-panel">
        <label class="field-row">
          <span>{t('load.name')}</span>
          <input
            class="pw-textfield typed"
            data-testid="save-name"
            value={name()}
            maxLength={64}
            onInput={(e) => setName(e.currentTarget.value)}
          />
        </label>
        <Show when={failed()}>
          {(m) => (
            <p class="notice-line error" data-testid="save-failed">
              {t('save.failed', m())}
            </p>
          )}
        </Show>
      </Panel>
      <div class="dialog-buttons">
        <Button onClick={props.onBack} testid="save-back">
          {t('button.back')}
        </Button>
        <Button
          variant="confirm"
          disabled={busy() || name().trim() === ''}
          onClick={() => void save()}
          testid="save-confirm"
        >
          {t('save.save')}
        </Button>
      </div>
    </Window>
  );
}

/** Load game (I §4.20 BEND-3): the stored saves, newest first, with game time and date; [Back] and [Load]. */
export function LoadWindow(props: { onBack: () => void; layer: number }): JSX.Element {
  const s = useServices();
  const [saves] = createResource(() => s.session.listSaves());
  const [chosen, setChosen] = createSignal<string | null>(null);
  const list = (): SaveEntry[] => saves() ?? [];
  const pick = () => chosen() ?? list().find((x) => x.loadable)?.id ?? null;
  return (
    <Window
      id="load-game"
      title={t('load.title')}
      onClose={props.onBack}
      layer={props.layer}
      testid="window-load-game"
    >
      <Panel class="load-panel">
        <Show when={list().length > 0} fallback={<p class="empty">{t('load.empty')}</p>}>
          <div class="save-list" data-testid="save-list" role="listbox" aria-label={t('load.title')}>
            <div class="save-row header" aria-hidden="true">
              <span>{t('load.name')}</span>
              <span>{t('load.game-time')}</span>
              <span>{t('load.date')}</span>
            </div>
            <For each={list()}>
              {(sv) => (
                <button
                  type="button"
                  class="save-row"
                  role="option"
                  aria-selected={pick() === sv.id}
                  classList={{ selected: pick() === sv.id, disabled: !sv.loadable }}
                  data-testid={`save-${sv.name}`}
                  onClick={() => setChosen(sv.id)}
                  onDblClick={() => sv.loadable && s.session.loadSave(sv.id)}
                >
                  <span>{sv.name}</span>
                  <span class="typed">{formatDuration(sv.tick / 60)}</span>
                  <span class="typed">
                    {new Date(sv.date).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </Panel>
      <div class="dialog-buttons">
        <Button onClick={props.onBack} testid="load-back">
          {t('button.back')}
        </Button>
        <Button
          variant="confirm"
          disabled={pick() === null}
          testid="load-confirm"
          onClick={() => {
            const id = pick();
            if (id) s.session.loadSave(id);
          }}
        >
          {t('load.load')}
        </Button>
      </div>
    </Window>
  );
}

/** A modal confirmation (I §4.0: small dialogs stack on top; E = the green or red button, Esc = cancel). */
export function DialogLayer(): JSX.Element {
  const s = useServices();
  return (
    <Show when={s.ui.dialog[0]()} keyed>
      {(d) => (
        <>
          <div class="menu-veil dialog-veil" data-gui="" />
          <Window
            id="dialog"
            title={d.title}
            modal
            layer={LAYER.dialog}
            onClose={() => s.ui.dialog[1](null)}
            testid="dialog"
          >
            <Panel>
              <p class="dialog-text">{d.text}</p>
            </Panel>
            <div class="dialog-buttons">
              <Button onClick={() => s.ui.dialog[1](null)} testid="dialog-cancel">
                {d.cancel}
              </Button>
              <Button
                variant={d.red ? 'red' : 'confirm'}
                primary
                testid="dialog-confirm"
                onClick={() => {
                  s.ui.dialog[1](null);
                  d.onConfirm();
                }}
              >
                {d.confirm}
              </Button>
            </div>
          </Window>
        </>
      )}
    </Show>
  );
}

/**
 * The saves' owner (07 §19.2, 10 §8.2 "One tab at a time"): while another tab owns them this one cannot save,
 * and *Take over* asks that tab to save and let go.
 */
export function StorageNotice(): JSX.Element {
  const s = useServices();
  return (
    <Show when={s.session.owner() === false}>
      <div class="storage-notice pw-frame" data-gui="" data-testid="storage-notice" role="status">
        <span>{t('storage.other-tab')}</span>
        <Button onClick={() => s.session.takeOver()} testid="take-over">
          {t('storage.take-over')}
        </Button>
      </div>
    </Show>
  );
}

/** The loading screen (07 §18): a progress bar, until the world's first packet. */
export function Loading(): JSX.Element {
  const s = useServices();
  return (
    <div class="loading" data-gui="" data-testid="loading">
      <div class="loading-card pw-frame">
        <h1 class="title">{t('loading.title')}</h1>
        <div
          class="loading-bar pw-progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(s.ui.loadingProgress[0]() * 100)}
        >
          <span
            class="pw-progress-fill"
            style={{ width: `${Math.round(s.ui.loadingProgress[0]() * 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

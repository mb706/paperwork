// The game menu (Esc; I §4.20): Continue, Save game, Load game, Settings, Tips and tricks, Exit to main menu (with
// an unsaved-progress confirmation). It pauses single player while open (I §4.0). The loading screen (07 §18:
// a progress bar; the loading tip joins when the data stage exports the tips) and confirmation dialogs live here
// too.
import {
  createEffect,
  createResource,
  createSignal,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { useServices } from '../core/context.ts';
import { Button, Panel, Window } from '../core/Window.tsx';
import { t } from '../i18n/locale.ts';
import { SettingsWindow } from '../windows/SettingsWindow.tsx';

export function GameMenu(): JSX.Element {
  const s = useServices();
  const [page, setPage] = createSignal<'menu' | 'settings' | 'load'>('menu');
  const [saving, setSaving] = createSignal(false);
  const [savedOnce, setSavedOnce] = createSignal(false);
  createEffect(() => {
    const open = s.ui.gameMenu[0]();
    s.session.setMenuPause(open);
    if (!open) setPage('menu');
  });
  onCleanup(() => s.session.setMenuPause(false));
  const close = () => s.ui.gameMenu[1](false);
  const save = async () => {
    setSaving(true);
    const ok = await s.session.saveGame();
    setSaving(false);
    if (ok) setSavedOnce(true);
  };
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
        <Switch>
          <Match when={page() === 'menu'}>
            <Window id="game-menu" title={t('menu.game-menu')} testid="game-menu" class="game-menu">
              <div class="menu-column">
                <Button variant="confirm" onClick={close} testid="game-menu-continue">
                  {t('menu.continue')}
                </Button>
                <Button onClick={() => void save()} disabled={saving()} testid="game-menu-save">
                  {savedOnce() ? t('menu.saved') : t('menu.save-game')}
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
          </Match>
          <Match when={page() === 'settings'}>
            <SettingsWindow onClose={() => setPage('menu')} />
          </Match>
          <Match when={page() === 'load'}>
            <InGameLoad onBack={() => setPage('menu')} />
          </Match>
        </Switch>
      </div>
    </Show>
  );
}

function InGameLoad(props: { onBack: () => void }): JSX.Element {
  const s = useServices();
  const [saves] = createResource(() => s.session.listSaves());
  return (
    <Window id="load-game" title={t('load.title')} onClose={props.onBack} testid="window-load-game">
      <Panel class="load-panel">
        <Show when={(saves() ?? []).length > 0} fallback={<p class="empty">{t('load.empty')}</p>}>
          <div class="save-list">
            {(saves() ?? []).map((sv) => (
              <button
                type="button"
                class="save-row"
                classList={{ disabled: !sv.loadable }}
                onDblClick={() => sv.loadable && s.session.loadSave(sv.id)}
              >
                <span>{sv.name}</span>
              </button>
            ))}
          </div>
        </Show>
      </Panel>
      <div class="dialog-buttons">
        <Button onClick={props.onBack}>{t('button.back')}</Button>
      </div>
    </Window>
  );
}

/** A modal confirmation (I §4.0: small dialogs stack on top; E = the green or red button, Esc = cancel). */
export function DialogLayer(): JSX.Element {
  const s = useServices();
  return (
    <Show when={s.ui.dialog[0]()}>
      {(d) => (
        <>
          <div class="menu-veil dialog-veil" data-gui="" />
          <Window id="dialog" title={d().title} modal testid="dialog">
            <Panel>
              <p class="dialog-text">{d().text}</p>
            </Panel>
            <div class="dialog-buttons">
              <Button onClick={() => s.ui.dialog[1](null)} testid="dialog-cancel">
                {d().cancel}
              </Button>
              <Button
                variant={d().red ? 'red' : 'confirm'}
                testid="dialog-confirm"
                onClick={() => {
                  const dd = d();
                  s.ui.dialog[1](null);
                  dd.onConfirm();
                }}
              >
                {d().confirm}
              </Button>
            </div>
          </Window>
        </>
      )}
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
        <div class="loading-bar pw-progress-track">
          <span
            class="pw-progress-fill"
            style={{ width: `${Math.round(s.ui.loadingProgress[0]() * 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

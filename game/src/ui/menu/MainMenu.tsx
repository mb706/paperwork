// The main menu (07 §18, I §4.20; 08 §3.1, DECISIONS §44): the wordmark *Paperwork* in capitals with the tagline
// *Information is physical.* beneath it (no other screen shows either), then I's list in I's order with the
// browser BEND (no Exit): Continue (hidden when there is no save), New game, Load game, Settings, Tips and tricks,
// Credits, Changelog; Achievements joins in M4. M0 works: New game, Load game, Settings. The footer shows the
// build and the storage use. The first click or key anywhere also starts the audio (07 §18; the app's hook).
import { createResource, createSignal, type JSX, Match, Show, Switch } from 'solid-js';
import { useServices } from '../core/context.ts';
import { labelTip, useTip } from '../core/tip.ts';
import { Button, Panel, Window } from '../core/Window.tsx';
import { t } from '../i18n/locale.ts';
import { LAYER } from '../store/ui.ts';
import { SettingsWindow } from '../windows/SettingsWindow.tsx';
import { LoadWindow, StorageNotice } from './GameMenu.tsx';

const MB = 1024 * 1024;
const fmtBytes = (n: number) =>
  n >= 1024 * MB ? `${Math.round(n / (1024 * MB))} GB` : `${Math.round(n / MB)} MB`;

export function MainMenu(): JSX.Element {
  const s = useServices();
  const [saves, { refetch }] = createResource(() => s.session.listSaves());
  // A save made, or a world left: the list (and Continue) is current when the main page shows.
  const [storage] = createResource(() => s.session.storage());
  const page = () => s.ui.menuPage[0]();
  const go = (p: 'main' | 'new-game' | 'load' | 'settings') => {
    s.ui.menuPage[1](p);
    if (p === 'main' || p === 'load') void refetch();
  };
  const latest = () => (saves() ?? []).find((x) => x.loadable);
  const footer = () => {
    const st = storage();
    const build = `${s.build.build}${s.build.dev ? ' (dev)' : ''}`;
    return st
      ? t('menu.footer', build, fmtBytes(st.used), fmtBytes(st.quota))
      : t('menu.footer-no-storage', build);
  };
  return (
    <div class="main-menu" data-gui="" data-testid="main-menu">
      <div class="pw-fibre menu-fibre" />
      <header class="wordmark">
        <h1 data-testid="wordmark">{t('game.title')}</h1>
        <p class="tagline">{t('game.tagline')}</p>
      </header>
      <Switch>
        <Match when={page() === 'main'}>
          <div class="menu-frame pw-frame" data-testid="menu-buttons">
            <div class="pw-fibre window-fibre" />
            <Show when={latest()}>
              {(save) => (
                <Button testid="menu-continue" onClick={() => s.session.loadSave(save().id)}>
                  {t('menu.continue')}
                </Button>
              )}
            </Show>
            <Button testid="menu-new-game" onClick={() => go('new-game')}>
              {t('menu.new-game')}
            </Button>
            <Button testid="menu-load-game" onClick={() => go('load')}>
              {t('menu.load-game')}
            </Button>
            <Button testid="menu-settings" onClick={() => go('settings')}>
              {t('menu.settings')}
            </Button>
            <Button testid="menu-tips" disabled>
              {t('menu.tips-and-tricks')}
            </Button>
            <Button testid="menu-credits" disabled>
              {t('menu.credits')}
            </Button>
            <Button testid="menu-changelog" disabled>
              {t('menu.changelog')}
            </Button>
          </div>
        </Match>
        <Match when={page() === 'new-game'}>
          <NewGame onBack={() => go('main')} />
        </Match>
        <Match when={page() === 'load'}>
          <LoadWindow onBack={() => go('main')} layer={LAYER.menuPage} />
        </Match>
        <Match when={page() === 'settings'}>
          <SettingsWindow onClose={() => go('main')} layer={LAYER.menuPage} />
        </Match>
      </Switch>
      <Show when={s.ui.notice[0]()}>
        <p class="menu-notice" data-testid="menu-notice" role="alert">
          {s.ui.notice[0]()}
        </p>
      </Show>
      <StorageNotice />
      <footer class="menu-footer typed" data-testid="menu-footer">
        <span data-testid="menu-build">{footer()}</span>
      </footer>
    </div>
  );
}

/** New game (07 §17) at M0's scope: the seed, [Back] and [Play]; map settings and presets arrive with M1. */
function NewGame(props: { onBack: () => void }): JSX.Element {
  const s = useServices();
  const [seed, setSeed] = createSignal(1945);
  const roll = () => setSeed(Math.floor(Math.random() * 4294967295));
  return (
    <Window
      id="new-game"
      title={t('new-game.title')}
      onClose={props.onBack}
      layer={LAYER.menuPage}
      testid="window-new-game"
    >
      <Panel class="new-game-panel">
        <label class="field-row">
          <span>{t('new-game.seed')}</span>
          <input
            class="pw-textfield typed"
            data-testid="seed"
            inputMode="numeric"
            value={String(seed())}
            onInput={(e) => {
              const v = Number(e.currentTarget.value.replace(/\D/g, ''));
              if (Number.isFinite(v)) setSeed(Math.min(v, 4294967295));
            }}
          />
          <button
            type="button"
            class="frame-button pw-button"
            {...useTip(labelTip(() => t('new-game.random-seed')))}
            onClick={roll}
          >
            <span class="typed">#</span>
          </button>
        </label>
      </Panel>
      <div class="dialog-buttons">
        <Button onClick={props.onBack} testid="new-game-back">
          {t('button.back')}
        </Button>
        <Button variant="confirm" testid="new-game-play" onClick={() => s.session.newGame(seed())}>
          {t('new-game.play')}
        </Button>
      </div>
    </Window>
  );
}

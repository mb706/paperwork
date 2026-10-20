// The main menu (07 §18, I §4.20; 08 §3.1, DECISIONS §44): the wordmark *Paperwork* in capitals with the tagline
// *Information is physical.* beneath it (no other screen shows either), then I's list in I's order with the
// browser BEND (no Exit): Continue (hidden when there is no save), New game, Load game, Settings, Tips and tricks,
// Credits, Changelog; Achievements joins in M4. M0 works: New game, Load game, Settings. The footer shows the
// build and the storage use. The first click or key anywhere also starts the audio (07 §18; the app's hook).
import { createResource, createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import { type SaveEntry, useServices } from '../core/context.ts';
import { Button, Panel, Window } from '../core/Window.tsx';
import { formatDuration, t } from '../i18n/locale.ts';
import { SettingsWindow } from '../windows/SettingsWindow.tsx';

const MB = 1024 * 1024;
const fmtBytes = (n: number) =>
  n >= 1024 * MB ? `${Math.round(n / (1024 * MB))} GB` : `${Math.round(n / MB)} MB`;

export function MainMenu(): JSX.Element {
  const s = useServices();
  const [saves, { refetch }] = createResource(() => s.session.listSaves());
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
          <LoadGame saves={saves() ?? []} onBack={() => go('main')} />
        </Match>
        <Match when={page() === 'settings'}>
          <SettingsWindow onClose={() => go('main')} />
        </Match>
      </Switch>
      <Show when={s.ui.notice[0]()}>
        <p class="menu-notice" data-testid="menu-notice">
          {s.ui.notice[0]()}
        </p>
      </Show>
      <footer class="menu-footer typed" data-testid="menu-footer">
        <span data-testid="build-status">{footer()}</span>
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
    <Window id="new-game" title={t('new-game.title')} onClose={props.onBack} testid="window-new-game">
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
            title={t('new-game.random-seed')}
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

/** Load game (I §4.20 BEND-3): the saves, newest first, with game time and date; [Back] and [Load]. */
function LoadGame(props: { saves: SaveEntry[]; onBack: () => void }): JSX.Element {
  const s = useServices();
  const [chosen, setChosen] = createSignal<string | null>(null);
  const pick = () => chosen() ?? props.saves.find((x) => x.loadable)?.id ?? null;
  return (
    <Window id="load-game" title={t('load.title')} onClose={props.onBack} testid="window-load-game">
      <Panel class="load-panel">
        <Show when={props.saves.length > 0} fallback={<p class="empty">{t('load.empty')}</p>}>
          <div class="save-list" data-testid="save-list">
            <div class="save-row header">
              <span>{t('load.name')}</span>
              <span>{t('load.game-time')}</span>
              <span>{t('load.date')}</span>
            </div>
            <For each={props.saves}>
              {(sv) => (
                <button
                  type="button"
                  class="save-row"
                  classList={{ selected: pick() === sv.id, disabled: !sv.loadable }}
                  onClick={() => setChosen(sv.id)}
                  onDblClick={() => sv.loadable && s.session.loadSave(sv.id)}
                >
                  <span>{sv.name}</span>
                  <span class="typed">{formatDuration(sv.tick / 60)}</span>
                  <span class="typed">{new Date(sv.date).toLocaleString()}</span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </Panel>
      <div class="dialog-buttons">
        <Button onClick={props.onBack}>{t('button.back')}</Button>
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

// Settings (I §4.20), M0's shape: tabs Interface, Graphics, Sound, Controls, Other; [Back] discards and
// [Confirm] applies (E confirms, Esc cancels, I §1.4). Controls lists every control of the action map grouped as
// I §2, with the primary and alternative columns: click a cell and press a key, button or wheel to bind it (Esc
// cancels the capture), right-click clears it; conflicts with other controls are listed under the control
// (allowed, I §1.1), as are inputs the browser keeps for itself; per-control reset and Reset all; search.
// Interface holds the UI scale; the other tabs fill in with their systems.
import { createMemo, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { useServices } from '../core/context.ts';
import { labelTip, useTip } from '../core/tip.ts';
import { Button, Panel, Window } from '../core/Window.tsx';
import { t } from '../i18n/locale.ts';
import type { BindingTable } from '../input/bindings.ts';
import {
  ALT,
  type Binding,
  BROWSER_RESERVED,
  CONTROLS,
  type ControlDef,
  CTRL,
  GROUPS,
  SHIFT,
  sameBinding,
} from '../input/controls.ts';
import { bindingLabel, isMac } from '../input/keys.ts';
import { controlName } from '../input/names.ts';

type Tab = 'interface' | 'graphics' | 'sound' | 'controls' | 'other';
const TABS: Tab[] = ['interface', 'graphics', 'sound', 'controls', 'other'];
const SCALES = [0, 75, 100, 125, 150, 175, 200];

export function SettingsWindow(props: { onClose: () => void }): JSX.Element {
  const s = useServices();
  const [tab, setTab] = createSignal<Tab>('controls');
  const [table, setTable] = createSignal<BindingTable>(s.bindings());
  const [scale, setScale] = createSignal(s.uiScaleSetting());
  const apply = () => {
    s.setBindings(table());
    s.setUiScaleSetting(scale());
    props.onClose();
  };
  return (
    <Window
      id="settings"
      title={t('window.settings')}
      onClose={props.onClose}
      testid="window-settings"
      class="settings"
    >
      <div class="tabs">
        <For each={TABS}>
          {(x) => (
            <button
              type="button"
              class={`tab ${tab() === x ? 'pw-tab-selected' : 'pw-tab'}`}
              data-testid={`settings-tab-${x}`}
              disabled={x !== 'controls' && x !== 'interface'}
              onClick={() => setTab(x)}
            >
              {t(`settings.${x}`)}
            </button>
          )}
        </For>
      </div>
      <Panel class="settings-panel">
        <Show when={tab() === 'controls'}>
          <ControlsTab table={table()} setTable={setTable} />
        </Show>
        <Show when={tab() === 'interface'}>
          <div class="field-row">
            <span>{t('settings.ui-scale')}</span>
            <select
              class="pw-textfield"
              data-testid="ui-scale"
              value={String(scale())}
              onChange={(e) => setScale(Number(e.currentTarget.value))}
            >
              <For each={SCALES}>
                {(v) => <option value={String(v)}>{v === 0 ? t('settings.ui-scale-auto') : `${v}%`}</option>}
              </For>
            </select>
          </div>
        </Show>
      </Panel>
      <div class="dialog-buttons">
        <Button onClick={props.onClose} testid="settings-back">
          {t('button.back')}
        </Button>
        <Button variant="confirm" onClick={apply} testid="settings-confirm">
          {t('button.confirm')}
        </Button>
      </div>
    </Window>
  );
}

function ControlsTab(props: { table: BindingTable; setTable: (b: BindingTable) => void }): JSX.Element {
  const s = useServices();
  const [query, setQuery] = createSignal('');
  const [capture, setCapture] = createSignal<{ id: string; column: 'primary' | 'alternative' } | null>(null);
  const visible = createMemo(() => {
    const q = query().trim().toLowerCase();
    return GROUPS.map((g) => ({
      group: g,
      controls: CONTROLS.filter(
        (c) =>
          c.group === g &&
          c.pri !== 'N/A' &&
          (q === '' || controlName(c.id).toLowerCase().includes(q) || c.id.includes(q)),
      ),
    })).filter((g) => g.controls.length > 0);
  });
  // While capturing, the next key, button or wheel notch is the binding (the input core is suspended).
  const listen = (e: Event) => {
    const cap = capture();
    if (!cap) return;
    let b: Binding | null = null;
    const mods = (ev: KeyboardEvent | MouseEvent) =>
      (ev.ctrlKey || (isMac() && ev.metaKey) ? CTRL : 0) | (ev.shiftKey ? SHIFT : 0) | (ev.altKey ? ALT : 0);
    if (e instanceof KeyboardEvent) {
      if (e.type !== 'keydown') return;
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') {
        stop();
        return;
      }
      const lone = /^(Control|Shift|Alt|Meta)(Left|Right)$/.exec(e.code);
      if (lone) return; // wait for the key it modifies; a lone modifier binds on its release
      b = { code: e.code, mods: mods(e) };
    } else if (e instanceof WheelEvent) {
      e.preventDefault();
      b = { code: e.deltaY < 0 ? 'WheelUp' : 'WheelDown', mods: mods(e) };
    } else if (e instanceof PointerEvent && e.type === 'pointerdown') {
      if ((e.target as Element).closest('[data-binding-cell]') === null && e.button === 0) return;
      e.preventDefault();
      e.stopPropagation();
      b = { code: `Mouse${e.button}`, mods: mods(e) };
    }
    if (b) {
      props.setTable(props.table.rebind(cap.id, cap.column, b));
      stop();
    }
  };
  const loneUp = (e: KeyboardEvent) => {
    const cap = capture();
    const lone = /^(Control|Shift|Alt)(Left|Right)$/.exec(e.code);
    if (!cap || !lone) return;
    e.preventDefault();
    const code = lone[1] === 'Control' ? 'Ctrl' : (lone[1] as string);
    props.setTable(props.table.rebind(cap.id, cap.column, { code, mods: 0 }));
    stop();
  };
  const stop = () => {
    setCapture(null);
    window.removeEventListener('keydown', listen, true);
    window.removeEventListener('keyup', loneUp, true);
    window.removeEventListener('pointerdown', listen, true);
    window.removeEventListener('wheel', listen, true);
    s.setInputEnabled(true);
  };
  onCleanup(stop);
  const start = (id: string, column: 'primary' | 'alternative') => {
    stop();
    setCapture({ id, column });
    s.setInputEnabled(false);
    // The click that started the capture has passed its pointerdown already, so it is never taken as the binding.
    window.addEventListener('keydown', listen, true);
    window.addEventListener('keyup', loneUp, true);
    window.addEventListener('pointerdown', listen, true);
    window.addEventListener('wheel', listen, { capture: true, passive: false });
  };
  const reserved = (c: ControlDef) =>
    props.table.get(c.id).some((b) => b !== null && BROWSER_RESERVED.some((r) => sameBinding(r, b)));
  return (
    <div class="controls-tab" data-testid="controls-tab">
      <div class="controls-head">
        <input
          class="search pw-textfield"
          data-search=""
          data-testid="controls-search"
          placeholder={t('button.search')}
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <Button onClick={() => props.setTable(resetAll(props.table))} testid="controls-reset-all">
          {t('button.reset-all')}
        </Button>
      </div>
      <div class="controls-list">
        <div class="control-row header">
          <span>{t('settings.control')}</span>
          <span>{t('settings.primary')}</span>
          <span>{t('settings.alternative')}</span>
          <span />
        </div>
        <For each={visible()}>
          {(g) => (
            <>
              <h3 class="control-group">{t(`control-group.${g.group}`)}</h3>
              <For each={g.controls}>
                {(c) => {
                  const cols = () => props.table.get(c.id);
                  const conflicts = () => props.table.conflicts(c.id);
                  return (
                    <div class="control-entry" data-testid={`control-${c.id}`}>
                      <div class="control-row">
                        <span>{controlName(c.id)}</span>
                        <For each={['primary', 'alternative'] as const}>
                          {(col, i) => (
                            <button
                              type="button"
                              class="binding-cell pw-textfield typed"
                              classList={{ capturing: capture()?.id === c.id && capture()?.column === col }}
                              data-binding-cell=""
                              data-testid={`bind-${c.id}-${col}`}
                              onClick={() => start(c.id, col)}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                props.setTable(props.table.rebind(c.id, col, null));
                              }}
                            >
                              {capture()?.id === c.id && capture()?.column === col
                                ? t('settings.press-a-key')
                                : bindingLabel(cols()[i()] ?? null)}
                            </button>
                          )}
                        </For>
                        <button
                          type="button"
                          class="frame-button pw-button reset"
                          {...useTip(labelTip(() => t('button.reset')))}
                          onClick={() =>
                            props.setTable(
                              props.table
                                .rebind(c.id, 'primary', undefined)
                                .rebind(c.id, 'alternative', undefined),
                            )
                          }
                        >
                          <span class="typed">↺</span>
                        </button>
                      </div>
                      <Show when={conflicts().length > 0}>
                        <div class="conflict" data-testid={`conflict-${c.id}`}>
                          {t('settings.conflicts', conflicts().map(controlName).join(', '))}
                        </div>
                      </Show>
                      <Show when={reserved(c)}>
                        <div class="conflict">{t('settings.reserved')}</div>
                      </Show>
                    </div>
                  );
                }}
              </For>
            </>
          )}
        </For>
      </div>
    </div>
  );
}

function resetAll(table: BindingTable): BindingTable {
  let out = table;
  for (const id of Object.keys(table.settings.overrides))
    out = out.rebind(id, 'primary', undefined).rebind(id, 'alternative', undefined);
  return out;
}

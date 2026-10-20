// The HUD at M0's scope (I §4.1–§4.5; 07 §2; A3's mock): the quickbar (two visible rows of the ten pages, page
// buttons at left, counts of what is carried, dimmed when none, highlighted while that item is in the hand), the
// shortcut bar (alt-mode), the crafting queue (bottom left: the head's progress, counts, cancel clicks), the hand
// mining bar above the quickbar, and the docked entity info at the right (the HOVER projection, sub_id 0).
import { createMemo, For, type JSX, Show } from 'solid-js';
import { useServices } from '../core/context.ts';
import { Glyph, Icon } from '../core/Icon.tsx';
import { Slot } from '../core/Slot.tsx';
import { labelTip, useTip } from '../core/tip.ts';
import { formatCount, formatDuration, t } from '../i18n/locale.ts';
import { bindingLabel } from '../input/keys.ts';
import { NO_ITEM } from '../store/protos.ts';
import { countOf } from '../store/records.ts';

export function Hud(): JSX.Element {
  const s = useServices();
  return (
    <div class="hud" classList={{ hidden: s.ui.hideGui[0]() }} data-testid="hud">
      <div class="hud-left">
        <MessageLog />
        <CraftingQueue />
      </div>
      <div class="hud-bottom">
        <MiningBar />
        <div class="hud-bars">
          <Quickbar />
          <ShortcutBar />
        </div>
      </div>
      <DockedInfo />
    </div>
  );
}

/** The message log (I §4.1 "Chat log", BEND-2): notices such as "Cannot insert …", fading out after a while. */
function MessageLog(): JSX.Element {
  const s = useServices();
  return (
    <div class="message-log" data-testid="message-log">
      <For each={s.ui.messages[0]()}>
        {(m) => <div class={`message${m.error ? ' message-error' : ''}`}>{m.text}</div>}
      </For>
    </div>
  );
}

function Quickbar(): JSX.Element {
  const s = useServices();
  const c = s.game.character;
  const total = (key: number) =>
    countOf(c.main, key) + (c.hand.key === key && !c.hand.ghost ? c.hand.count : 0);
  return (
    <div class="quickbar pw-frame" data-gui="" data-slot-grid="" data-testid="quickbar">
      <For each={[0, 1]}>
        {(row) => {
          const page = () => (c.quickbarPage + row) % 10;
          return (
            <div class="quickbar-row">
              <button
                type="button"
                class="page-button pw-button"
                data-testid={`quickbar-page-${row}`}
                {...useTip(labelTip(() => t('controls.action-bar-select-page', page() + 1)))}
              >
                <span class="typed">{page() + 1}</span>
              </button>
              <div class="quickbar-slots pw-panel">
                <For each={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]}>
                  {(i) => {
                    const index = () => page() * 10 + i;
                    const key = () => c.quickbar[index()] ?? NO_ITEM;
                    const n = () => (key() === NO_ITEM ? 0 : total(key()));
                    // The descriptor reads the page when used: Shift+1…0 changes it under the same element.
                    const ref = {
                      kind: 'quickbar' as const,
                      get index() {
                        return index();
                      },
                      key,
                    };
                    return (
                      <Slot
                        slot={ref}
                        icon={key() === NO_ITEM ? null : (s.protos()?.itemIcon(key()) ?? null)}
                        label={key() === NO_ITEM ? '' : (s.protos()?.itemName(key()) ?? '')}
                        count={n() > 0 ? n() : null}
                        dim={key() !== NO_ITEM && n() === 0}
                        hand={key() !== NO_ITEM && c.hand.key === key() && c.hand.count > 0}
                        tooltip={() =>
                          key() === NO_ITEM
                            ? null
                            : {
                                kind: 'item',
                                id: key(),
                                hint:
                                  row === 0
                                    ? bindingLabel(s.bindings().get(`quick-bar-button-${i + 1}`)[0])
                                    : '',
                              }
                        }
                        testid={`quickbar-${row}-${i}`}
                      />
                    );
                  }}
                </For>
              </div>
            </div>
          );
        }}
      </For>
    </div>
  );
}

function ShortcutBar(): JSX.Element {
  const s = useServices();
  const tip = useTip(
    labelTip(
      () => t('controls.show-info'),
      () => bindingLabel(s.bindings().get('show-info')[0]),
    ),
  );
  return (
    <div class="shortcut-bar pw-frame" data-gui="" data-testid="shortcut-bar">
      <button
        type="button"
        class={`shortcut ${s.ui.altMode[0]() ? 'pw-button-pressed shortcut-on' : 'pw-button'}`}
        data-testid="shortcut-alt-mode"
        onClick={() => s.ui.altMode[1](!s.ui.altMode[0]())}
        {...tip}
      >
        <Glyph name="alt-mode" size={28} />
      </button>
    </div>
  );
}

function MiningBar(): JSX.Element {
  const s = useServices();
  const c = s.game.character;
  return (
    <Show when={(c.flags & 4) !== 0 && c.miningProgress > 0}>
      <div class="mining-bar pw-progress-track" data-testid="mining-bar">
        <span class="pw-progress-fill" style={{ width: `${Math.round(c.miningProgress * 100)}%` }} />
      </div>
    </Show>
  );
}

function CraftingQueue(): JSX.Element {
  const s = useServices();
  const c = s.game.character;
  const hint = () => {
    const b = s.bindings();
    return t(
      'hint.cancel-craft',
      bindingLabel(b.get('cancel-craft')[0]),
      bindingLabel(b.get('cancel-craft-5')[0]),
      bindingLabel(b.get('cancel-craft-all')[0]),
    );
  };
  /** Seconds left in the queue up to and including entry i (I §4.5's BEND: time remaining). */
  const remaining = createMemo(() => {
    const out: number[] = [];
    let acc = 0;
    for (const e of c.queue) {
      const time = s.protos()?.recipe(e.recipe)?.time ?? 0;
      acc += time * (e.count - e.progress);
      out.push(acc);
    }
    return out;
  });
  return (
    <Show when={c.queue.length > 0}>
      <div class="crafting-queue pw-frame" data-gui="" data-testid="crafting-queue">
        <div class="slot-grid" data-slot-grid="">
          <For each={c.queue}>
            {(e, i) => (
              <Slot
                slot={{
                  kind: 'queue',
                  get index() {
                    return i();
                  },
                }}
                icon={s.protos()?.recipe(e.recipe)?.icon ?? 'fx/missing'}
                label={s.protos()?.recipeName(e.recipe) ?? ''}
                count={e.count}
                progress={i() === 0 ? e.progress : null}
                promised={(e.flags & 1) !== 0}
                tooltip={() => ({
                  kind: 'queue',
                  id: e.recipe,
                  hint: `${t('tooltip.queue-remaining', formatDuration(remaining()[i()] ?? 0))}\n${hint()}`,
                })}
                testid={`queue-${i()}`}
              />
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}

/** The docked entity info (I §4.8.3): the selection's name, description, status and contents. */
function DockedInfo(): JSX.Element {
  const s = useServices();
  const sel = () => s.selection();
  /** The hover record, once it names the selected entity (HOVER, sub_id 0). */
  const live = () => {
    const h = s.game.hover();
    const x = sel();
    return x?.kind === 'entity' && h && h.serial === x.serial ? h : null;
  };
  /** The name and description come from the data at once; status and contents follow with the record. */
  const head = () => {
    const x = sel();
    const p = s.protos();
    if (!x || !p) return null;
    if (x.kind === 'entity') return { name: p.entityName(x.proto), desc: p.entityDescription(x.proto) };
    if (x.kind === 'resource') return { name: p.resourceName(x.resource), desc: '' };
    return null;
  };
  return (
    <Show when={head()}>
      {(hd) => (
        <div class="docked pw-frame" data-gui="" data-testid="docked-info">
          <h1 class="title">{hd().name}</h1>
          <Show when={hd().desc || (live()?.status ?? 0) !== 0 || (live()?.contents.length ?? 0) > 0}>
            <div class="panel pw-panel docked-card">
              <Show when={hd().desc}>
                <div class="tip-desc">{hd().desc}</div>
              </Show>
              <Show when={live()}>
                {(h) => (
                  <>
                    <Show when={h().status !== 0}>
                      <div class="status-line">
                        <span class={`led led-${ledOf(h().status)}`} />
                        <span>{statusText(s, h().status)}</span>
                      </div>
                    </Show>
                    <Show when={h().contents.length > 0}>
                      <div class="tip-line">{t('tooltip.contents')}</div>
                      <div class="contents">
                        <For each={h().contents}>
                          {(c) => (
                            <span class="content-item">
                              <Icon
                                name={s.protos()?.itemIcon(c.key) ?? 'fx/missing'}
                                size={24}
                                label={s.protos()?.itemName(c.key) ?? ''}
                              />
                              <span class="typed">{formatCount(c.count)}</span>
                            </span>
                          )}
                        </For>
                      </div>
                    </Show>
                  </>
                )}
              </Show>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}

/** A status's diode colour (I §3.12 `entity_status_diode`; 08 §8.2). */
export function ledOf(status: number): 'green' | 'yellow' | 'red' {
  if ([1, 2, 64, 65, 66, 67].includes(status)) return 'green';
  if ([4, 10, 12, 18, 19, 68, 69, 70, 71].includes(status)) return 'yellow';
  return 'red';
}

export function statusText(s: ReturnType<typeof useServices>, status: number): string {
  const key = s.protos()?.json.localeKeys.Status.find((x) => x.value === status)?.key;
  return key ? t(key) : '';
}

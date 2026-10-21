// Floating tooltips (I §4.8): a title band with the name, the description, stat lines in "Label: value" form,
// sections separated by rules; at most 356 px wide; beside the anchor, flipped away from the screen edges (10 px
// border). Item tooltips (§4.8.1) and recipe tooltips (§4.8.2: ingredients, missing ones red, crafting time,
// products when more than one, "Craftable now"), and the hotkey hints of the live binding table (I §1.6).
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { formatDuration, t } from '../i18n/locale.ts';
import { craftableFrom } from '../store/records.ts';
import { useServices } from './context.ts';
import { Icon } from './Icon.tsx';
import { placeTooltip } from './place.ts';

export function Tooltip(): JSX.Element {
  const s = useServices();
  let el: HTMLDivElement | undefined;
  let ro: ResizeObserver | null = null;
  const anchor = () => s.ui.tooltip[0]();
  /** The content, followed while the tooltip is open (a slot that empties closes it). */
  const tip = () => anchor()?.content() ?? null;
  const open = createMemo(() => tip() !== null);
  /** The tooltip's size, from a ResizeObserver: content updates (a queue's time left) never read layout. */
  const [size, setSize] = createSignal<{ w: number; h: number } | null>(null, {
    equals: (a, b) => a === b || (a !== null && b !== null && a.w === b.w && a.h === b.h),
  });
  onCleanup(() => ro?.disconnect());
  // Placed when the anchor or the size changes; content updates alone do not move it (C5-r1 14).
  createEffect(() => {
    const a = anchor();
    const sz = size();
    if (!a || !sz || !el) return;
    const p = placeTooltip(a, sz, s.viewport(), s.scale());
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.style.visibility = 'visible';
  });
  const attach = (e: HTMLDivElement) => {
    el = e;
    setSize(null);
    ro?.disconnect();
    if (typeof ResizeObserver === 'undefined') {
      queueMicrotask(() => setSize({ w: e.offsetWidth, h: e.offsetHeight }));
      return;
    }
    // The observer reports after layout; its offset sizes are then clean (GUI px, before the UI scale's zoom).
    ro = new ResizeObserver(() => setSize({ w: e.offsetWidth, h: e.offsetHeight }));
    ro.observe(e);
  };
  return (
    <Show when={open()}>
      <div ref={attach} class="tooltip pw-tooltip" style={{ visibility: 'hidden' }} data-testid="tooltip">
        <Show when={tip()} keyed={false}>
          {(tp) => (
            <>
              <Switch>
                <Match when={tp().kind === 'item'}>
                  <ItemTip itemKey={tp().id} />
                </Match>
                <Match when={tp().kind === 'recipe'}>
                  <RecipeTip recipe={tp().id} />
                </Match>
                <Match when={tp().kind === 'queue'}>
                  <RecipeTip recipe={tp().id} queue />
                </Match>
                <Match when={tp().kind === 'text'}>
                  <div class="tip-title">{tp().text}</div>
                </Match>
                <Match when={tp().kind === 'label'}>
                  <div class="tip-label">{tp().text}</div>
                </Match>
              </Switch>
              <Show when={tp().hint}>
                <div class="tip-hint">{tp().hint}</div>
              </Show>
            </>
          )}
        </Show>
      </div>
    </Show>
  );
}

function ItemTip(props: { itemKey: number }): JSX.Element {
  const s = useServices();
  const p = () => s.protos();
  return (
    <>
      <div class="tip-title">{p()?.itemName(props.itemKey)}</div>
      <Show when={p()?.itemDescription(props.itemKey)}>
        <div class="tip-desc">{p()?.itemDescription(props.itemKey)}</div>
      </Show>
      <div class="tip-line">
        <span>{t('tooltip.stack-size')}</span>
        <span class="typed">{p()?.stackSize(props.itemKey)}</span>
      </div>
    </>
  );
}

function RecipeTip(props: { recipe: number; queue?: boolean }): JSX.Element {
  const s = useServices();
  const r = () => s.protos()?.recipe(props.recipe);
  const totals = () => s.game.totals();
  const name = (kind: string, id: number) =>
    kind === 'item' ? (s.protos()?.itemName(id * 8) ?? '') : (s.protos()?.json.fluid[id]?.name ?? '');
  const icon = (kind: string, id: number) =>
    kind === 'item'
      ? (s.protos()?.item(id)?.icon ?? 'fx/missing')
      : (s.protos()?.json.fluid[id]?.icon ?? 'fx/missing');
  return (
    <Show when={r()}>
      {(rec) => (
        <>
          <div class="tip-title">{t('tooltip.recipe', s.protos()?.recipeName(props.recipe) ?? '')}</div>
          <div class="tip-section">{t('tooltip.ingredients')}</div>
          <For each={rec().ingredients}>
            {(ing) => (
              <div
                class="tip-ingredient"
                classList={{
                  missing:
                    !props.queue && ing.kind === 'item' && (totals().get(ing.id * 8) ?? 0) < ing.amount,
                }}
              >
                <Icon name={icon(ing.kind, ing.id)} size={16} label={name(ing.kind, ing.id)} />
                <span class="typed">{ing.amount}</span>
                <span>× {name(ing.kind, ing.id)}</span>
              </div>
            )}
          </For>
          <div class="tip-ingredient">
            <span class="typed">{formatDuration(rec().time)}</span>
            <span>{t('tooltip.crafting-time')}</span>
          </div>
          <Show when={rec().products.length > 1}>
            <div class="tip-section">{t('tooltip.products')}</div>
            <For each={rec().products}>
              {(pr) => (
                <div class="tip-ingredient">
                  <Icon name={icon(pr.kind, pr.id)} size={16} label={name(pr.kind, pr.id)} />
                  <span class="typed">{pr.amount}</span>
                  <span>× {name(pr.kind, pr.id)}</span>
                </div>
              )}
            </For>
          </Show>
          <Show when={!rec().handcraft}>
            <div class="tip-line missing">{t('tooltip.not-handcraftable')}</div>
          </Show>
          <Show when={!props.queue && rec().handcraft}>
            <div class="tip-line">
              {t('tooltip.craftable-now', craftableFrom(rec().ingredients, totals()))}
            </div>
          </Show>
          <Show when={rec().products[0]?.kind === 'item'}>
            <hr class="tip-rule" />
            <ItemTip itemKey={(rec().products[0]?.id ?? 0) * 8} />
          </Show>
        </>
      )}
    </Show>
  );
}

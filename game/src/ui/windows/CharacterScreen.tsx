// The character screen (E; I §4.4), flat layout: the Character panel (the main inventory, 10 wide, the hand
// marker on the stack's origin slot) beside the Crafting panel (item-group tabs, one row per subgroup, 10 columns,
// craftable counts, red for what cannot be crafted by hand, search over every group). On real projections:
// CHARACTER for the inventory and the hand; slot clicks and recipe clicks go through the input core as actions.
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import type { EntityRef } from '../../shared/gen/types.ts';
import { InventoryType } from '../../shared/gen/types.ts';
import { useServices } from '../core/context.ts';
import { Icon } from '../core/Icon.tsx';
import { Slot } from '../core/Slot.tsx';
import { labelTip, useTip } from '../core/tip.ts';
import { CloseButton, FrameButton, TitleGroup, Window } from '../core/Window.tsx';
import { t } from '../i18n/locale.ts';
import { bindingLabel } from '../input/keys.ts';
import { NONE_REF } from '../input/slots.ts';
import { NO_ITEM } from '../store/protos.ts';
import { craftableFrom } from '../store/records.ts';
import { LAYER } from '../store/ui.ts';

/** The player's main inventory as a grid of slots; `other` is the window's other inventory (I §3.8). */
export function MainInventory(props: { other: EntityRef | null; testid?: string }): JSX.Element {
  const s = useServices();
  const c = s.game.character;
  const hand = () => c.hand;
  return (
    <div class="slot-grid" data-slot-grid="" data-testid={props.testid ?? 'main-inventory'}>
      <For each={c.main}>
        {(slot, i) => {
          const isOrigin = () => hand().origin === i() && hand().count > 0 && slot.count === 0;
          const key = () => (isOrigin() ? hand().key : slot.key);
          return (
            <Slot
              slot={{
                kind: 'inventory',
                owner: NONE_REF,
                inv: InventoryType.main,
                get index() {
                  return i();
                },
                get other() {
                  return props.other;
                },
                key: () => slot.key,
              }}
              icon={key() === NO_ITEM ? null : (s.protos()?.itemIcon(key()) ?? null)}
              label={key() === NO_ITEM ? '' : (s.protos()?.itemName(key()) ?? '')}
              count={isOrigin() ? null : slot.count}
              hand={isOrigin()}
              tooltip={() => (slot.key === NO_ITEM ? null : { kind: 'item', id: slot.key })}
              testid={`inv-${i()}`}
            />
          );
        }}
      </For>
    </div>
  );
}

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function CharacterScreen(): JSX.Element {
  const s = useServices();
  const [group, setGroup] = createSignal(0);
  const [searching, setSearching] = createSignal(false);
  const [query, setQuery] = createSignal('');
  let search: HTMLInputElement | undefined;
  const groups = () => s.protos()?.craftGroups ?? [];
  /** The rows to show: the selected group's, or every group's matches while searching (I §4.4). */
  const rows = createMemo(() => {
    const q = fold(query().trim());
    const gs = groups();
    if (q === '') return gs[Math.min(group(), gs.length - 1)]?.rows ?? [];
    const p = s.protos();
    return gs
      .flatMap((g) => g.rows)
      .map((r) => ({ ...r, recipes: r.recipes.filter((id) => fold(p?.recipeName(id) ?? '').includes(q)) }))
      .filter((r) => r.recipes.length > 0);
  });
  const hint = () => {
    const b = s.bindings();
    return t(
      'hint.craft',
      bindingLabel(b.get('craft')[0]),
      bindingLabel(b.get('craft-5')[0]),
      bindingLabel(b.get('craft-all')[0]),
    );
  };
  const toggleSearch = () => {
    const on = !searching();
    setSearching(on);
    if (on) {
      if (tabbed()) s.ui.charTab[1]('crafting');
      queueMicrotask(() => search?.focus());
    } else setQuery('');
  };
  /** The tabbed layout below the width the flat one needs (I §4.4); F2 and F3 switch its tabs. */
  const tabbed = () => s.narrow();
  const tab = () => s.ui.charTab[0]();
  const searchButton = () => (
    <FrameButton
      glyph="search"
      title={t('button.search')}
      hint={bindingLabel(s.bindings().get('focus-search')[0])}
      onClick={toggleSearch}
      pressed={searching()}
      testid="crafting-search-button"
    />
  );
  return (
    <Window
      id="character"
      testid="character-screen"
      layer={LAYER.window}
      onClose={() => s.ui.close()}
      header={
        <Show
          when={tabbed()}
          fallback={
            <div class="title-columns">
              <TitleGroup title={t('window.character')} class="col-inventory" />
              <TitleGroup title={t('window.crafting')} class="col-crafting">
                {searchButton()}
                <CloseButton onClose={() => s.ui.close()} />
              </TitleGroup>
            </div>
          }
        >
          <div class="title-columns">
            <div class="title-group col-crafting">
              <For each={['character', 'crafting'] as const}>
                {(x) => (
                  <button
                    type="button"
                    class={`title-tab ${tab() === x ? 'title-tab-on' : ''}`}
                    data-testid={`character-tab-${x}`}
                    onClick={() => s.ui.charTab[1](x)}
                    {...useTip(
                      labelTip(
                        () => t(`window.${x}`),
                        () => bindingLabel(s.bindings().get(`controller-gui-${x}-tab`)[0]),
                      ),
                    )}
                  >
                    {t(`window.${x}`)}
                  </button>
                )}
              </For>
              <div class="drag pw-title-rule" />
              <Show when={tab() === 'crafting'}>{searchButton()}</Show>
              <CloseButton onClose={() => s.ui.close()} />
            </div>
          </div>
        </Show>
      }
    >
      <div class="character-columns" classList={{ tabbed: tabbed() }}>
        <div class="panel pw-panel col-inventory" classList={{ hidden: tabbed() && tab() !== 'character' }}>
          <MainInventory other={null} />
        </div>
        <div class="col-crafting crafting" classList={{ hidden: tabbed() && tab() !== 'crafting' }}>
          <Show when={searching()}>
            <input
              ref={search}
              class="search pw-textfield"
              data-search=""
              data-testid="crafting-search"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
            />
          </Show>
          <div class="group-tabs" classList={{ dimmed: query().trim() !== '' }}>
            <For each={groups()}>
              {(g, i) => (
                <button
                  type="button"
                  class={`group-tab ${group() === i() ? 'pw-tab-selected' : 'pw-tab'}`}
                  data-testid={`group-${g.name}`}
                  onClick={() => setGroup(i())}
                  {...useTip(labelTip(() => t(`item-group-name.${g.name}`)))}
                >
                  <Icon
                    name={s.protos()?.groupIcon(g) ?? 'fx/missing'}
                    size={48}
                    label={t(`item-group-name.${g.name}`)}
                  />
                </button>
              )}
            </For>
          </div>
          <div class="panel pw-panel recipe-panel" data-slot-grid="" data-testid="recipe-grid">
            <For each={rows()}>
              {(row) => (
                <div class="slot-grid recipe-row">
                  <For each={row.recipes}>
                    {(id) => {
                      const r = () => s.protos()?.recipe(id);
                      // One lookup per ingredient in the shared per-item totals, recomputed only when they change
                      // (C5-r1 13); the slot's DOM updates only when its own count does.
                      const can = createMemo(() => {
                        const rec = r();
                        return rec?.handcraft ? craftableFrom(rec.ingredients, s.game.totals()) : 0;
                      });
                      return (
                        <Slot
                          slot={{ kind: 'recipe', recipe: id }}
                          icon={r()?.icon ?? 'fx/missing'}
                          label={s.protos()?.recipeName(id) ?? ''}
                          count={can() > 0 ? can() : null}
                          red={r()?.handcraft === false}
                          dim={r()?.handcraft !== false && can() === 0}
                          tooltip={() => ({ kind: 'recipe', id, hint: hint() })}
                          testid={`recipe-${r()?.name ?? id}`}
                        />
                      );
                    }}
                  </For>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </Window>
  );
}

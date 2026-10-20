// Entity windows (I §4.6), M0's kind: the container. The player's inventory is always the left panel and the
// entity's the right (FFF-363); the chest's slots come from its INVENTORY projection (10 §15.5), slots from the
// limit bar on are red (I §3.8). The window subscribes on open and unsubscribes on close; when the chest is gone
// (status 1) the window closes (§7.3 rule 4). Transfers between the two use I §3.8's table through the bindings.
import { For, type JSX, onCleanup } from 'solid-js';
import { InventoryType } from '../../shared/gen/types.ts';
import { useServices } from '../core/context.ts';
import { Slot } from '../core/Slot.tsx';
import { CloseButton, TitleGroup, Window } from '../core/Window.tsx';
import { t } from '../i18n/locale.ts';
import { NONE_REF, serialRef } from '../input/slots.ts';
import { NO_ITEM } from '../store/protos.ts';
import { MainInventory } from './CharacterScreen.tsx';

export function EntityWindow(props: { serial: number; proto: number }): JSX.Element {
  const s = useServices();
  const watch = s.game.watchInventory(props.serial, InventoryType.chest, () =>
    s.ui.forgetEntity(props.serial),
  );
  onCleanup(watch.dispose);
  const inv = watch.state;
  const name = () => s.protos()?.entityName(props.proto) ?? '';
  return (
    <Window
      id="entity-container"
      testid="entity-window"
      header={
        <div class="title-columns">
          <TitleGroup title={t('window.character')} class="col-inventory" />
          <TitleGroup title={name()} class="col-entity">
            <CloseButton onClose={() => s.ui.close()} />
          </TitleGroup>
        </div>
      }
    >
      <div class="character-columns">
        <div class="panel pw-panel col-inventory">
          <MainInventory other={serialRef(props.serial)} />
        </div>
        <div class="panel pw-panel col-entity" data-testid="entity-inventory">
          <div class="slot-grid">
            <For each={inv.slots}>
              {(slot, i) => (
                <Slot
                  slot={{
                    kind: 'inventory',
                    owner: serialRef(props.serial),
                    inv: InventoryType.chest,
                    index: i(),
                    other: NONE_REF,
                    key: () => slot.key,
                  }}
                  icon={slot.key === NO_ITEM ? null : (s.protos()?.itemIcon(slot.key) ?? null)}
                  label={slot.key === NO_ITEM ? '' : (s.protos()?.itemName(slot.key) ?? '')}
                  count={slot.count}
                  limited={i() >= inv.bar}
                  tooltip={() => (slot.key === NO_ITEM ? null : { kind: 'item', id: slot.key })}
                  testid={`chest-${i()}`}
                />
              )}
            </For>
          </div>
        </div>
      </div>
    </Window>
  );
}

// The cursor stack (I §3.2): the hand's item and count drawn at the mouse pointer, over the GUI and the world (the
// renderer adds the build preview over the world once wired). It follows the pointer with a transform only.
import { type JSX, onCleanup, onMount, Show } from 'solid-js';
import { useServices } from '../core/context.ts';
import { Icon } from '../core/Icon.tsx';
import { formatCount } from '../i18n/locale.ts';

export function CursorStack(): JSX.Element {
  const s = useServices();
  let el: HTMLDivElement | undefined;
  const hand = () => s.game.character.hand;
  const move = (e: PointerEvent) => {
    if (!el) return;
    const k = s.scale();
    el.style.transform = `translate(${e.clientX / k + 6}px, ${e.clientY / k + 6}px)`;
  };
  onMount(() => window.addEventListener('pointermove', move, { passive: true }));
  onCleanup(() => window.removeEventListener('pointermove', move));
  return (
    <div ref={el} class="cursor-stack" data-testid="cursor-stack">
      <Show when={hand().count > 0 || hand().ghost}>
        <div class="cursor-item" classList={{ ghost: hand().ghost }}>
          <Icon
            name={s.protos()?.itemIcon(hand().key) ?? 'fx/missing'}
            label={s.protos()?.itemName(hand().key) ?? ''}
          />
          <Show when={!hand().ghost}>
            <span class="count">{formatCount(hand().count)}</span>
          </Show>
        </div>
      </Show>
    </div>
  );
}

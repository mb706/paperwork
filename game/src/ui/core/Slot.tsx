// The slot (I §4.0; A3 §12): a 40 × 40 card with a red top rule, a 32-px icon, the count at bottom-right in the
// typed face. States: hover, the hand marker on the stack's origin slot (I §3.2), red (not craftable by hand),
// dimmed (none carried, nothing craftable), a progress bar (the crafting queue's head). Clicks are not handled
// here: the slot registers what it is, and the input core resolves the binding (I §1.4, §3.8).
//
// Keyboard (C5-r1 17): a slot is a button named by its item and count for assistive technology; one slot per grid
// is in the tab order (a roving tabindex, `input/slots.ts` moves it with the arrows), and Enter is its left click
// (the input core resolves it, so the button's own click does nothing).
import { type JSX, onMount, Show } from 'solid-js';
import { formatCount } from '../i18n/locale.ts';
import { registerSlot, type SlotRef } from '../input/slots.ts';
import type { TipContent } from '../store/ui.ts';
import { Icon } from './Icon.tsx';
import { useTip } from './tip.ts';

export interface SlotProps {
  slot?: SlotRef;
  /** The icon's manifest name ('item/iron-plate'), or null for an empty slot. */
  icon: string | null;
  /** The name the missing-icon stand-in abbreviates. */
  label?: string;
  count?: number | null;
  hand?: boolean;
  red?: boolean;
  dim?: boolean;
  /** 0–1 progress (the crafting queue's first slot). */
  progress?: number | null;
  /** A darker "promised" entry (chain-crafted intermediates, I §3.9). */
  promised?: boolean;
  /** Slots from the limit bar on (I §3.8: red). */
  limited?: boolean;
  /** The tooltip's content, read reactively while it is open (it follows the slot's contents). */
  tooltip?: () => TipContent | null;
  testid?: string;
}

export function Slot(props: SlotProps): JSX.Element {
  const tip = useTip(() => props.tooltip?.() ?? null);
  let el: HTMLButtonElement | undefined;
  const cls = () =>
    [
      'slot',
      props.hand ? 'pw-slot-selected slot-hand' : props.limited ? 'pw-slot-disabled slot-limited' : 'pw-slot',
      props.red ? 'slot-red' : '',
      props.dim ? 'slot-dim' : '',
      props.promised ? 'slot-promised' : '',
    ].join(' ');
  const name = () => {
    const n = props.count;
    return n !== null && n !== undefined && n !== 0 && props.label
      ? `${props.label} ${formatCount(n)}`
      : (props.label ?? '');
  };
  // The first slot of its grid is the grid's tab stop.
  onMount(() => {
    if (el && el.parentElement?.querySelector(':scope > [data-slot]') === el) el.tabIndex = 0;
  });
  return (
    <button
      type="button"
      ref={(e) => {
        el = e;
        if (props.slot) registerSlot(e, props.slot);
      }}
      class={cls()}
      data-slot=""
      data-testid={props.testid}
      tabIndex={-1}
      aria-label={name()}
      {...tip}
    >
      <Show when={props.icon}>
        {(icon) => <Icon name={icon()} label={props.label ?? ''} class="slot-icon" />}
      </Show>
      <Show when={props.count !== null && props.count !== undefined && props.count !== 0}>
        <span class="count" aria-hidden="true">
          {formatCount(props.count as number)}
        </span>
      </Show>
      <Show when={props.progress !== null && props.progress !== undefined}>
        <span class="slot-progress">
          <span class="pw-progress-fill" style={{ width: `${Math.round((props.progress ?? 0) * 100)}%` }} />
        </span>
      </Show>
    </button>
  );
}

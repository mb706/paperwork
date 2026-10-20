// The slot (I §4.0; A3 §12): a 40 × 40 card with a red top rule, a 32-px icon, the count at bottom-right in the
// typed face. States: hover, the hand marker on the stack's origin slot (I §3.2), red (not craftable by hand),
// dimmed (none carried, nothing craftable), a progress bar (the crafting queue's head). Clicks are not handled
// here: the slot registers what it is, and the input core resolves the binding (I §1.4, §3.8).
import { type JSX, onCleanup, Show } from 'solid-js';
import { formatCount } from '../i18n/locale.ts';
import { registerSlot, type SlotRef } from '../input/slots.ts';
import type { TipContent } from '../store/ui.ts';
import { useServices } from './context.ts';
import { Icon } from './Icon.tsx';

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

/** GUI tooltip delay (I §4.20: about 0.4 s); Shift shows it at once (`activate-tooltip`). */
const TOOLTIP_DELAY_MS = 400;

export function Slot(props: SlotProps): JSX.Element {
  const s = useServices();
  let timer = 0;
  let el: HTMLDivElement | undefined;
  let mine = false;
  const show = () => {
    const content = props.tooltip;
    if (!content || !el) return;
    const r = el.getBoundingClientRect();
    mine = true;
    s.ui.tooltip[1]({ x: r.left, y: r.top, w: r.width, h: r.height, content });
  };
  const enter = () => {
    window.clearTimeout(timer);
    if (s.ui.tooltipNow[0]()) show();
    else timer = window.setTimeout(show, TOOLTIP_DELAY_MS);
  };
  const leave = () => {
    window.clearTimeout(timer);
    if (mine) s.ui.tooltip[1](null);
    mine = false;
  };
  onCleanup(() => {
    window.clearTimeout(timer);
    if (mine) s.ui.tooltip[1](null);
  });
  const cls = () =>
    [
      'slot',
      props.hand ? 'pw-slot-selected slot-hand' : props.limited ? 'pw-slot-disabled slot-limited' : 'pw-slot',
      props.red ? 'slot-red' : '',
      props.dim ? 'slot-dim' : '',
      props.promised ? 'slot-promised' : '',
    ].join(' ');
  return (
    <div
      ref={(e) => {
        el = e;
        if (props.slot) registerSlot(e, props.slot);
      }}
      class={cls()}
      data-slot=""
      data-testid={props.testid}
      onPointerEnter={enter}
      onPointerLeave={leave}
      onPointerDown={() => {
        window.clearTimeout(timer);
      }}
    >
      <Show when={props.icon}>
        {(name) => <Icon name={name()} label={props.label ?? ''} class="slot-icon" />}
      </Show>
      <Show when={props.count !== null && props.count !== undefined && props.count !== 0}>
        <span class="count">{formatCount(props.count as number)}</span>
      </Show>
      <Show when={props.progress !== null && props.progress !== undefined}>
        <span class="slot-progress">
          <span class="pw-progress-fill" style={{ width: `${Math.round((props.progress ?? 0) * 100)}%` }} />
        </span>
      </Show>
    </div>
  );
}

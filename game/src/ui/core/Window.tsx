// The window (I §4.0; A3 §12): a manila folder frame; the title at left in ExtraBold capitals, a ruled drag handle
// filling the gap, frame action buttons at right (search, close). Dragging the title bar moves the window, and
// the position is remembered per window type; the default is centred. Content panels inside are index cards.
import { type JSX, onCleanup, Show } from 'solid-js';
import { t } from '../i18n/locale.ts';
import { bindingLabel } from '../input/keys.ts';
import { windowPositions } from '../store/ui.ts';
import { useServices } from './context.ts';
import { Glyph } from './Icon.tsx';
import { labelTip, useTip } from './tip.ts';

export interface WindowProps {
  /** The window type: its remembered position's key. */
  id: string;
  title?: string;
  onClose?: () => void;
  /** Extra frame action buttons, left of the close button. */
  actions?: JSX.Element;
  /** A custom title bar (the character screen's two titled columns); replaces title and actions. */
  header?: JSX.Element;
  children: JSX.Element;
  testid?: string;
  /** A dialog sits above the game windows and is modal (I §4.0). */
  modal?: boolean;
  class?: string;
}

export function Window(props: WindowProps): JSX.Element {
  const s = useServices();
  let el: HTMLDivElement | undefined;
  const saved = windowPositions.get(props.id);
  let stop: (() => void) | null = null;
  onCleanup(() => stop?.());
  const drag = (e: PointerEvent) => {
    if (e.button !== 0 || !el || (e.target as Element).closest('button, input')) return;
    e.preventDefault();
    const scale = s.scale();
    const r = el.getBoundingClientRect();
    const ox = e.clientX - r.left;
    const oy = e.clientY - r.top;
    const move = (m: PointerEvent) => {
      if (!el) return;
      const x = Math.max(0, Math.min(window.innerWidth - 40, m.clientX - ox)) / scale;
      const y = Math.max(0, Math.min(window.innerHeight - 30, m.clientY - oy)) / scale;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.transform = 'none';
      windowPositions.set(props.id, { x, y });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      stop = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    stop = up;
  };
  return (
    <div
      ref={el}
      class={`window pw-frame ${props.modal ? 'window-modal' : ''} ${props.class ?? ''}`}
      data-gui=""
      data-window={props.id}
      data-testid={props.testid ?? `window-${props.id}`}
      style={saved ? { left: `${saved.x}px`, top: `${saved.y}px`, transform: 'none' } : undefined}
    >
      <div class="pw-fibre window-fibre" />
      <Show
        when={props.header}
        fallback={
          <Show when={props.title !== undefined || props.onClose}>
            <div class="titlebar" onPointerDown={drag}>
              <Show when={props.title}>
                <h1 class="title">{props.title}</h1>
              </Show>
              <div class="drag pw-title-rule" />
              {props.actions}
              <Show when={props.onClose}>
                <CloseButton onClose={() => props.onClose?.()} />
              </Show>
            </div>
          </Show>
        }
      >
        <div class="titlebar" onPointerDown={drag}>
          {props.header}
        </div>
      </Show>
      <div class="window-body">{props.children}</div>
    </div>
  );
}

/** A frame action button (I §4.0: 24 px, at the title bar's right). */
export function FrameButton(props: {
  glyph: string;
  title: string;
  /** The hotkey hint (I §1.6), from the live bindings. */
  hint?: string;
  onClick: () => void;
  testid?: string;
  pressed?: boolean;
}): JSX.Element {
  const tip = useTip(
    labelTip(
      () => props.title,
      () => props.hint ?? '',
    ),
  );
  return (
    <button
      type="button"
      class={`frame-button ${props.pressed ? 'pw-button-pressed' : 'pw-button'}`}
      aria-label={props.title}
      data-testid={props.testid}
      onClick={() => props.onClick()}
      {...tip}
    >
      <Glyph name={props.glyph} size={16} />
    </button>
  );
}

export function CloseButton(props: { onClose: () => void }): JSX.Element {
  const s = useServices();
  return (
    <FrameButton
      glyph="close"
      title={t('button.close')}
      hint={bindingLabel(s.bindings().get('toggle-menu')[0])}
      onClick={props.onClose}
      testid="close"
    />
  );
}

/** A content panel: a cream index card ruled in pale blue (deep: inventories and lists). */
export function Panel(props: {
  children: JSX.Element;
  class?: string;
  title?: string;
  testid?: string;
}): JSX.Element {
  return (
    <div class={`panel pw-panel ${props.class ?? ''}`} data-testid={props.testid}>
      <Show when={props.title}>
        <h2 class="panel-title">{props.title}</h2>
      </Show>
      {props.children}
    </div>
  );
}

export function Button(props: {
  children: JSX.Element;
  onClick?: () => void;
  variant?: 'normal' | 'confirm' | 'red';
  disabled?: boolean;
  testid?: string;
  class?: string;
}): JSX.Element {
  const s = useServices();
  const skin = () =>
    props.disabled
      ? 'pw-button-disabled'
      : props.variant === 'confirm'
        ? 'pw-button-confirm'
        : props.variant === 'red'
          ? 'pw-button-red'
          : 'pw-button';
  // A green button is what E presses (I §1.4: E = confirm = the green button; a click and E sound alike).
  if (props.variant === 'confirm')
    onCleanup(
      s.ui.addConfirm(() => {
        if (props.disabled) return false;
        s.sound('ui-click');
        props.onClick?.();
        return true;
      }),
    );
  return (
    <button
      type="button"
      class={`button ${skin()} button-${props.variant ?? 'normal'} ${props.class ?? ''}`}
      disabled={props.disabled}
      data-confirm={props.variant === 'confirm' ? '' : undefined}
      data-testid={props.testid}
      onClick={() => props.onClick?.()}
    >
      {props.children}
    </button>
  );
}

/** A title of one column inside a custom title bar, with its ruled drag handle. */
export function TitleGroup(props: { title: string; children?: JSX.Element; class?: string }): JSX.Element {
  return (
    <div class={`title-group ${props.class ?? ''}`}>
      <h1 class="title">{props.title}</h1>
      <div class="drag pw-title-rule" />
      {props.children}
    </div>
  );
}

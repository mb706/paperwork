// The window (I §4.0; A3 §12): a manila folder frame; the title at left in ExtraBold capitals, a ruled drag handle
// filling the gap, frame action buttons at right (search, close). Dragging the title bar moves the window, and
// the position is remembered per window type; the default is centred. Content panels inside are index cards.
//
// - A window with a `layer` rank is one E and Esc act on (store/ui.ts layers): Esc is its [X], E its newest
//   enabled green button (a `Button variant="confirm"` inside it registers there).
// - A remembered or dragged position is clamped to the viewport whenever the viewport or the UI scale changes, so
//   a window is never stranded off screen; a window larger than the viewport sits at its top left and its body
//   scrolls (C5-r1 19).
// - A modal window takes the focus when it opens, keeps Tab inside it, and gives the focus back when it closes
//   (C5-r1 17).
import { createContext, createEffect, type JSX, on, onCleanup, onMount, Show, useContext } from 'solid-js';
import { t } from '../i18n/locale.ts';
import { bindingLabel } from '../input/keys.ts';
import { type Layer, windowPositions } from '../store/ui.ts';
import { useServices } from './context.ts';
import { Glyph } from './Icon.tsx';
import { labelTip, useTip } from './tip.ts';

/** The layer a component sits in (its green buttons register there). */
export const LayerContext = createContext<Layer | null>(null);

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
  /** The stacking rank of the window's layer (LAYER in store/ui.ts); with it, Esc calls `onClose`. */
  layer?: number;
  class?: string;
}

/** Focusable elements inside a container, in tab order (no tabindex > 0 is used). */
const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps a position inside the viewport: the window's top left at least 0, its far edge inside when it fits. */
export function clampPosition(
  x: number,
  y: number,
  w: number,
  h: number,
  vw: number,
  vh: number,
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(x, vw - w)),
    y: Math.max(0, Math.min(y, vh - h)),
  };
}

export function Window(props: WindowProps): JSX.Element {
  const s = useServices();
  let el: HTMLDivElement | undefined;
  let stop: (() => void) | null = null;
  onCleanup(() => stop?.());
  const reg = props.layer !== undefined ? s.ui.pushLayer(props.layer, () => props.onClose?.()) : null;
  if (reg) onCleanup(reg.remove);

  /** Places the window at a GUI-px position, clamped to the viewport (a layout read: only on these occasions). */
  const place = (x: number, y: number, remember: boolean) => {
    if (!el) return;
    const scale = s.scale();
    const vp = s.viewport();
    const p = clampPosition(x, y, el.offsetWidth, el.offsetHeight, vp.w / scale, vp.h / scale);
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.style.transform = 'none';
    if (remember) windowPositions.set(props.id, p);
  };
  onMount(() => {
    const saved = windowPositions.get(props.id);
    if (saved) place(saved.x, saved.y, false);
  });
  // The viewport or the UI scale changed: a moved window is clamped again (a centred one stays centred).
  createEffect(
    on(
      () => [s.viewport(), s.scale()],
      () => {
        const saved = windowPositions.get(props.id);
        if (saved && el?.style.transform === 'none') place(saved.x, saved.y, false);
      },
      { defer: true },
    ),
  );

  const drag = (e: PointerEvent) => {
    if (e.button !== 0 || !el || (e.target as Element).closest('button, input')) return;
    e.preventDefault();
    const scale = s.scale();
    const r = el.getBoundingClientRect();
    const ox = e.clientX - r.left;
    const oy = e.clientY - r.top;
    const move = (m: PointerEvent) => place((m.clientX - ox) / scale, (m.clientY - oy) / scale, true);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      stop = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    stop = up;
  };

  if (props.modal) {
    // The focus moves in (the first field, else the first button) and comes back to where it was on close.
    const before = document.activeElement as HTMLElement | null;
    onMount(() => {
      el?.addEventListener('keydown', trap);
      const first =
        el?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled])') ??
        el?.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    });
    onCleanup(() => {
      if (before?.isConnected && before !== document.body) before.focus();
      else (document.activeElement as HTMLElement | null)?.blur?.();
    });
  }
  /** Tab stays inside a modal window (it wraps at either end). */
  const trap = (e: KeyboardEvent) => {
    if (!props.modal || e.key !== 'Tab' || !el) return;
    const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    const at = document.activeElement;
    if (e.shiftKey && (at === first || !el.contains(at))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (at === last || !el.contains(at))) {
      e.preventDefault();
      first.focus();
    }
  };

  const body = (
    <div
      ref={el}
      class={`window pw-frame ${props.modal ? 'window-modal' : ''} ${props.class ?? ''}`}
      data-gui=""
      data-window={props.id}
      data-testid={props.testid ?? `window-${props.id}`}
      {...(props.modal ? { role: 'dialog', 'aria-modal': 'true', 'aria-label': props.title } : {})}
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
  return reg ? <LayerContext.Provider value={reg.layer}>{body}</LayerContext.Provider> : body;
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
      aria-pressed={props.pressed === undefined ? undefined : props.pressed}
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
  /** E presses it (the layer's confirm, I §1.4); the default for the green button. */
  primary?: boolean;
  disabled?: boolean;
  testid?: string;
  class?: string;
}): JSX.Element {
  const s = useServices();
  const layer = useContext(LayerContext);
  const skin = () =>
    props.disabled
      ? 'pw-button-disabled'
      : props.variant === 'confirm'
        ? 'pw-button-confirm'
        : props.variant === 'red'
          ? 'pw-button-red'
          : 'pw-button';
  // A green button is what E presses in its layer (I §1.4: E = confirm = the green button; a click and E sound
  // alike).
  if ((props.primary ?? props.variant === 'confirm') && layer) {
    const entry = {
      press: () => {
        if (props.disabled) return false;
        s.sound('ui-click');
        props.onClick?.();
        return true;
      },
    };
    layer.confirms.push(entry);
    onCleanup(() => {
      const i = layer.confirms.indexOf(entry);
      if (i >= 0) layer.confirms.splice(i, 1);
    });
  }
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

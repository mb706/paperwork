// Tooltip triggers (I §4.8): after the GUI tooltip delay (I §4.20, about 0.4 s), or at once while Shift
// (`activate-tooltip`) is held, also when Shift goes down while the pointer already rests on the anchor (C5-r1 7);
// the content is read reactively while it shows. Used by slots and by every button that names itself (frame
// buttons, tabs, shortcuts), so all tooltips are the skinned ones, never the browser's.
import { createEffect, on, onCleanup } from 'solid-js';
import type { TipContent } from '../store/ui.ts';
import { useServices } from './context.ts';

const DELAY_MS = 400;

export interface TipHandlers {
  onPointerEnter: (e: PointerEvent) => void;
  onPointerLeave: () => void;
  onPointerDown: () => void;
}

export function useTip(content: () => TipContent | null): TipHandlers {
  const s = useServices();
  let timer = 0;
  let mine = false;
  /** The anchor the pointer rests on, while it does. */
  let over: Element | null = null;
  const show = (el: Element) => {
    window.clearTimeout(timer);
    if (!el.isConnected || content() === null) return;
    const r = el.getBoundingClientRect();
    mine = true;
    s.ui.tooltip[1]({ x: r.left, y: r.top, w: r.width, h: r.height, content });
  };
  const hide = () => {
    window.clearTimeout(timer);
    over = null;
    if (mine) s.ui.tooltip[1](null);
    mine = false;
  };
  onCleanup(hide);
  // Shift pressed during the delay: the hovered anchor's tooltip shows now.
  createEffect(
    on(
      () => s.ui.tooltipNow[0](),
      (now) => {
        if (now && over && !mine) show(over);
      },
      { defer: true },
    ),
  );
  return {
    onPointerEnter: (e) => {
      const el = e.currentTarget as Element;
      over = el;
      window.clearTimeout(timer);
      if (s.ui.tooltipNow[0]()) show(el);
      else timer = window.setTimeout(() => show(el), DELAY_MS);
    },
    onPointerLeave: hide,
    onPointerDown: () => window.clearTimeout(timer),
  };
}

/** A button's tooltip: its name, and the hotkey hint of the live binding when it has one (I §1.6). */
export const labelTip = (text: () => string, hint?: () => string) => (): TipContent => ({
  kind: 'label',
  id: 0,
  text: text(),
  ...(hint ? { hint: hint() } : {}),
});

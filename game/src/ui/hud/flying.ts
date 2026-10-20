// Flying text (I §3.12; 10 §6.11: DOM, under about 20 at once): world-anchored lines that rise and fade over
// `flying_text_ttl` = 80 ticks (1.33 s), an item icon before the text where there is one, errors in the warning
// colour. A new line at the spot of older ones pushes them up, so lines never overlap. Positions are projected
// through the camera every frame with transforms only (no layout reads, §7.3 step 5).
import type { WorldCamera } from '../world/camera.ts';

export const FLYING_TTL_MS = (80 * 1000) / 60;
const RISE_TILES = 1.2;
const LINE_PX = 18;
const MAX = 24;
/** Lines this close (tiles) share a stack. */
const NEAR = 1.5;

interface Line {
  el: HTMLDivElement;
  x: number;
  y: number;
  born: number;
  /** Extra height (CSS px) the newer lines below pushed it up by; it never shrinks. */
  push: number;
}

export class FlyingTexts {
  private readonly root: HTMLDivElement;
  private lines: Line[] = [];
  private readonly iconFor: (key: number) => HTMLElement | null;

  constructor(parent: HTMLElement, iconFor: (key: number) => HTMLElement | null) {
    this.root = document.createElement('div');
    this.root.className = 'flying-layer';
    parent.appendChild(this.root);
    this.iconFor = iconFor;
  }

  /** Adds a line at world (x, y) in tiles; `item` adds that item's icon before the text. */
  add(text: string, x: number, y: number, opts: { error?: boolean; item?: number } = {}): void {
    const el = document.createElement('div');
    el.className = `flying${opts.error ? ' flying-error' : ''}`;
    el.dataset.testid = 'flying-text';
    if (opts.item !== undefined) {
      const icon = this.iconFor(opts.item);
      if (icon) el.appendChild(icon);
    }
    const span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    this.lines.push({ el, x, y, born: performance.now(), push: 0 });
    this.root.appendChild(el);
    while (this.lines.length > MAX) this.lines.shift()?.el.remove();
  }

  /** Moves and fades every line; drops the expired ones; pushes older lines above newer ones nearby. */
  frame(camera: WorldCamera, now: number, scale: number): void {
    if (this.lines.length === 0) return;
    this.lines = this.lines.filter((l) => {
      if (now - l.born < FLYING_TTL_MS) return true;
      l.el.remove();
      return false;
    });
    const pxPerTile = (camera.toScreen(0, 1).y - camera.toScreen(0, 0).y) / scale;
    const rise = (l: Line) => ((now - l.born) / FLYING_TTL_MS) * RISE_TILES * pxPerTile + l.push;
    // Newest first: each older line nearby must sit at least one line above every newer one.
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const a = this.lines[i] as Line;
      for (let j = i - 1; j >= 0; j--) {
        const b = this.lines[j] as Line;
        if (Math.abs(a.x - b.x) >= NEAR || Math.abs(a.y - b.y) >= NEAR) continue;
        const gap = rise(b) - rise(a);
        if (gap < LINE_PX) b.push += LINE_PX - gap;
      }
    }
    for (const l of this.lines) {
      const age = (now - l.born) / FLYING_TTL_MS;
      const p = camera.toScreen(l.x, l.y);
      const x = p.x / scale;
      const y = p.y / scale - rise(l);
      l.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      l.el.style.opacity = age < 0.7 ? '1' : String(1 - (age - 0.7) / 0.3);
    }
  }

  clear(): void {
    for (const l of this.lines) l.el.remove();
    this.lines = [];
  }

  get count(): number {
    return this.lines.length;
  }
}

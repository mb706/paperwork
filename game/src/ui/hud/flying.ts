// Flying text (I §3.12; 10 §6.11: DOM, under about 20 at once): world-anchored lines that rise and fade over
// `flying_text_ttl` = 80 ticks (1.33 s), an item icon before the text where there is one, errors in the warning
// colour. Repeats at the same spot stack upward so they never overlap. Positions are projected through the camera
// every frame with transforms only (no layout reads, §7.3 step 5).
import type { WorldCamera } from '../world/camera.ts';

export const FLYING_TTL_MS = (80 * 1000) / 60;
const RISE_TILES = 1.2;
const LINE_PX = 18;
const MAX = 24;

interface Line {
  el: HTMLDivElement;
  x: number;
  y: number;
  born: number;
  slot: number;
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
    const now = performance.now();
    // Stack on lines still young at about the same spot.
    let slot = 0;
    for (const l of this.lines)
      if (Math.abs(l.x - x) < 1.5 && Math.abs(l.y - y) < 1.5 && now - l.born < FLYING_TTL_MS * 0.8)
        slot = Math.max(slot, l.slot + 1);
    this.lines.push({ el, x, y, born: now, slot });
    this.root.appendChild(el);
    while (this.lines.length > MAX) this.lines.shift()?.el.remove();
  }

  /** Moves and fades every line; drops the expired ones. */
  frame(camera: WorldCamera, now: number, scale: number): void {
    if (this.lines.length === 0) return;
    const keep: Line[] = [];
    for (const l of this.lines) {
      const age = (now - l.born) / FLYING_TTL_MS;
      if (age >= 1) {
        l.el.remove();
        continue;
      }
      const p = camera.toScreen(l.x, l.y - age * RISE_TILES);
      const x = p.x / scale;
      const y = p.y / scale - l.slot * LINE_PX;
      l.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      l.el.style.opacity = age < 0.7 ? '1' : String(1 - (age - 0.7) / 0.3);
      keep.push(l);
    }
    this.lines = keep;
  }

  clear(): void {
    for (const l of this.lines) l.el.remove();
    this.lines = [];
  }

  get count(): number {
    return this.lines.length;
  }
}

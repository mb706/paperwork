// What the UI draws over the world (I §3.1, §3.3): the hover selection's four corner brackets, and the build
// preview of the held placeable: its footprint tinted by `build_preview_tints` (green buildable, faint yellow out of
// reach, red blocked, blue for a ghost) with the item's icon. A transparent Canvas2D layer between the world canvas
// (C4's renderer) and the DOM UI, drawn with the camera the last frame used (`WorldViewApi.camera`), so it never
// drifts from the world under it. The renderer owns everything else in the world.
import type { WorldCamera } from '../../shared/world-view.ts';
import type { Protos } from '../store/protos.ts';
import { type Box, entityBox, type PreviewState, type Selection } from './select.ts';

export interface Preview {
  box: Box;
  state: PreviewState;
  /** The held item key (its icon is drawn in the footprint). */
  item: number;
}

/** I §3.3's tints (RGBA 0–1): buildable, buildable_too_far, not_buildable; a ghost in the blueprint blue. */
const TINT: Record<PreviewState, [number, number, number, number]> = {
  buildable: [0.4, 1, 0.4, 1],
  'too-far': [0.6, 0.6, 0.3, 0.1],
  blocked: [1, 0.4, 0.4, 1],
  ghost: [0.4, 0.4, 1, 1],
};
const BRACKET = '#e8b748';

const rgba = ([r, g, b]: number[], a: number) =>
  `rgba(${Math.round((r ?? 0) * 255)}, ${Math.round((g ?? 0) * 255)}, ${Math.round((b ?? 0) * 255)}, ${a})`;

export class WorldOverlay {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D | null;
  private dpr = 1;
  private readonly sheets = new Map<string, HTMLImageElement>();
  private drawn = false;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'world-overlay';
    this.canvas.setAttribute('aria-hidden', 'true');
    parent.prepend(this.canvas);
    this.g = this.canvas.getContext('2d');
  }

  resize(w: number, h: number, dpr: number): void {
    this.dpr = Math.min(2, dpr || 1);
    this.canvas.width = Math.max(1, Math.round(w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(h * this.dpr));
    this.drawn = true; // a resize clears the canvas: draw again
  }

  clear(): void {
    if (!this.g || !this.drawn) return;
    this.g.setTransform(1, 0, 0, 1, 0, 0);
    this.g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawn = false;
  }

  draw(camera: WorldCamera, p: Protos, sel: Selection | null, preview: Preview | null): void {
    this.clear();
    const g = this.g;
    if (!g || (!preview && (!sel || sel.kind === 'tile'))) return;
    this.drawn = true;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const S = camera.scale;
    if (preview) {
      const a = camera.toScreen(preview.box.x0, preview.box.y0);
      const w = (preview.box.x1 - preview.box.x0) * S;
      const h = (preview.box.y1 - preview.box.y0) * S;
      const tint = TINT[preview.state];
      g.fillStyle = rgba(tint, preview.state === 'too-far' ? 0.12 : 0.28);
      g.fillRect(a.x, a.y, w, h);
      g.strokeStyle = rgba(tint, preview.state === 'too-far' ? 0.35 : 0.9);
      g.lineWidth = 1.5;
      g.strokeRect(a.x + 0.75, a.y + 0.75, w - 1.5, h - 1.5);
      const size = Math.min(w, h) * 0.8;
      g.globalAlpha = preview.state === 'too-far' ? 0.35 : 0.7;
      this.icon(p, p.itemIcon(preview.item), a.x + w / 2, a.y + h / 2, size);
      g.globalAlpha = 1;
    }
    if (sel && sel.kind !== 'tile') {
      const b =
        sel.kind === 'entity'
          ? entityBox(p, sel)
          : { x0: sel.tx, y0: sel.ty, x1: sel.tx + 1, y1: sel.ty + 1 };
      const a = camera.toScreen(b.x0, b.y0);
      const c = camera.toScreen(b.x1, b.y1);
      const k = Math.min(0.3 * S, (c.x - a.x) / 2.5);
      g.strokeStyle = BRACKET;
      g.lineWidth = 2.5;
      g.beginPath();
      for (const [x, y, dx, dy] of [
        [a.x, a.y, 1, 1],
        [c.x, a.y, -1, 1],
        [a.x, c.y, 1, -1],
        [c.x, c.y, -1, -1],
      ] as const) {
        g.moveTo(x + dx * k, y);
        g.lineTo(x, y);
        g.lineTo(x, y + dy * k);
      }
      g.stroke();
    }
  }

  /** An item icon from the DOM sheets (10 §9.3); nothing while its sheet loads or when the art has none. */
  private icon(p: Protos, name: string, cx: number, cy: number, size: number): void {
    if (!this.g || !p.hasIcon(name)) return;
    const ref = p.icon(name);
    const url = ref ? p.sheet(ref.group, 64) : null;
    if (!ref || !url) return;
    let img = this.sheets.get(url);
    if (!img) {
      img = new Image();
      img.src = `/${url}`;
      this.sheets.set(url, img);
    }
    if (!img.complete || img.naturalWidth === 0) return;
    const col = ref.index % ref.columns;
    const row = Math.floor(ref.index / ref.columns);
    this.g.drawImage(img, col * 64, row * 64, 64, 64, cx - size / 2, cy - size / 2, size, size);
  }
}

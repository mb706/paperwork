// The M0 stand-in for the world view, until the renderer (C4) is wired: a flat Canvas2D map of the held chunks
// (tile map colours, resource dots, entity footprints with their item icons, the character), with Factorio's
// corner brackets around the hover selection (I §3.1). It exists so the input layer can be played and tested
// against the fake sim; it reads the same mirror and camera the resolver uses. The app passes `?render=none` or
// wires C4's renderer to turn it off.
import { initials } from '../core/initials.ts';
import type { Protos } from '../store/protos.ts';
import type { FollowCamera } from './camera.ts';
import type { Mirror } from './mirror.ts';
import { entityBox, type Selection } from './select.ts';

const PAPER = '#ece3cb';
const INK = '#2b2723';
const ORE: Record<string, string> = {
  iron: '#8496a8',
  copper: '#d58c62',
  coal: '#4a4a4c',
  quartz: '#f6e9ea',
  stone: '#b8a07a',
  uranium: '#8fb06a',
};

export class Plate {
  private readonly g: CanvasRenderingContext2D;
  private readonly chunkImages = new Map<number, { canvas: HTMLCanvasElement; tiles: Uint8Array }>();
  private readonly sheets = new Map<string, HTMLImageElement>();
  private dpr = 1;
  private readonly canvas: HTMLCanvasElement;
  private readonly protos: () => Protos | null;

  constructor(canvas: HTMLCanvasElement, protos: () => Protos | null) {
    this.canvas = canvas;
    this.protos = protos;
    const g = canvas.getContext('2d', { alpha: false });
    if (!g) throw new Error('no 2D context for the stand-in plate');
    this.g = g;
  }

  resize(width: number, height: number, dpr: number): void {
    this.dpr = Math.min(2, dpr);
    const w = Math.round(width * this.dpr);
    const h = Math.round(height * this.dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  private tileColours(): string[] {
    return (this.protos()?.json.tile ?? []).map((t) => t.mapColor || PAPER);
  }

  private chunkImage(key: number, tiles: Uint8Array): HTMLCanvasElement {
    const cached = this.chunkImages.get(key);
    if (cached && cached.tiles === tiles) return cached.canvas;
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const g = c.getContext('2d');
    const colours = this.tileColours();
    if (g) {
      for (let i = 0; i < 1024; i++) {
        g.fillStyle = colours[tiles[i] ?? 0] ?? PAPER;
        g.fillRect(i & 31, i >> 5, 1, 1);
      }
    }
    this.chunkImages.set(key, { canvas: c, tiles });
    return c;
  }

  private sheet(url: string): HTMLImageElement {
    let img = this.sheets.get(url);
    if (!img) {
      img = new Image();
      img.src = `/${url}`;
      this.sheets.set(url, img);
    }
    return img;
  }

  draw(mirror: Mirror, camera: FollowCamera, selection: Selection | null, characterSerial: number): void {
    const g = this.g;
    const p = this.protos();
    const dpr = this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = PAPER;
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!p) return;
    const S = camera.scale * dpr;
    const ox = (camera.width / 2) * dpr - camera.cx * S;
    const oy = (camera.height / 2) * dpr - camera.cy * S;
    const toX = (wx: number) => ox + wx * S;
    const toY = (wy: number) => oy + wy * S;
    g.imageSmoothingEnabled = false;
    for (const c of mirror.chunks.values()) {
      if (!c.tiles) continue;
      g.globalAlpha = 0.32;
      g.drawImage(this.chunkImage(c.key, c.tiles), toX(c.cx * 32), toY(c.cy * 32), 32 * S, 32 * S);
      g.globalAlpha = 1;
      for (const r of c.resources) {
        const name = p.json.resource[r.resource]?.name ?? '';
        const ore = Object.keys(ORE).find((k) => name.includes(k));
        g.fillStyle = ore ? (ORE[ore] as string) : '#9a8c70';
        const tx = c.cx * 32 + (r.tile & 31);
        const ty = c.cy * 32 + (r.tile >> 5);
        const rad = S * (0.1 + (7 - r.band) * 0.018);
        g.beginPath();
        g.arc(toX(tx + 0.5), toY(ty + 0.5), rad, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.imageSmoothingEnabled = true;
    g.lineWidth = Math.max(1, 1.2 * dpr);
    for (const e of mirror.entities()) {
      const b = entityBox(p, e, false);
      const x = toX(b.x0);
      const y = toY(b.y0);
      const w = (b.x1 - b.x0) * S;
      const h = (b.y1 - b.y0) * S;
      const ghost = (e.flags & 1) !== 0;
      g.fillStyle = ghost ? 'rgba(125, 159, 192, 0.35)' : 'rgba(244, 236, 216, 0.92)';
      g.fillRect(x, y, w, h);
      g.strokeStyle = ghost ? '#5a8ac0' : INK;
      g.setLineDash(ghost ? [4 * dpr, 3 * dpr] : []);
      g.strokeRect(x, y, w, h);
      g.setLineDash([]);
      const item = p.entity(e.proto)?.item;
      const icon = item === null || item === undefined ? '' : (p.item(item)?.icon ?? '');
      if (!this.icon(p, icon, x + w / 2, y + h / 2, Math.min(w, h) * 0.8) && w > 18 * dpr) {
        g.fillStyle = '#5d5345';
        g.font = `700 ${Math.round(Math.min(w, h) * 0.32)}px 'Courier Prime', monospace`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(initials(p.entityName(e.proto)), x + w / 2, y + h / 2);
      }
      if ((e.flags & 2) !== 0) {
        g.strokeStyle = '#b5352a';
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + w, y + h);
        g.moveTo(x + w, y);
        g.lineTo(x, y + h);
        g.stroke();
      }
    }
    for (const m of mirror.movers) {
      const x = toX(m.x / 256);
      const y = toY(m.y / 256);
      g.fillStyle = m.serial === characterSerial ? '#c9533d' : '#7d9fc0';
      g.strokeStyle = INK;
      g.beginPath();
      g.arc(x, y, 0.3 * S, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    if (selection && selection.kind !== 'tile') this.brackets(p, selection, toX, toY, S);
  }

  /** Draws an item icon from the DOM sheets; false when the art has none (or its sheet is still loading). */
  private icon(p: Protos, name: string, cx: number, cy: number, size: number): boolean {
    if (!p.hasIcon(name)) return false;
    const ref = p.icon(name);
    const url = ref ? p.sheet(ref.group, 64) : null;
    if (!ref || !url) return false;
    const img = this.sheet(url);
    if (!img.complete || img.naturalWidth === 0) return true;
    const col = ref.index % ref.columns;
    const row = Math.floor(ref.index / ref.columns);
    this.g.drawImage(img, col * 64, row * 64, 64, 64, cx - size / 2, cy - size / 2, size, size);
    return true;
  }

  /** Factorio's selection: four corner brackets around the selection box (I §3.1). */
  private brackets(
    p: Protos,
    s: Selection,
    toX: (x: number) => number,
    toY: (y: number) => number,
    S: number,
  ): void {
    const b = s.kind === 'entity' ? entityBox(p, s) : { x0: s.tx, y0: s.ty, x1: s.tx + 1, y1: s.ty + 1 };
    const x0 = toX(b.x0);
    const y0 = toY(b.y0);
    const x1 = toX(b.x1);
    const y1 = toY(b.y1);
    const k = Math.min(0.3 * S, (x1 - x0) / 2.5);
    const g = this.g;
    g.strokeStyle = '#e8b748';
    g.lineWidth = Math.max(2, 2.5 * this.dpr);
    g.beginPath();
    for (const [x, y, dx, dy] of [
      [x0, y0, 1, 1],
      [x1, y0, -1, 1],
      [x0, y1, 1, -1],
      [x1, y1, -1, -1],
    ] as const) {
      g.moveTo(x + dx * k, y);
      g.lineTo(x, y);
      g.lineTo(x, y + dy * k);
    }
    g.stroke();
  }
}

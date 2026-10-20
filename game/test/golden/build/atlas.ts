// The golden set's tiny atlas (10 §15.7, §15.10): §15.7's fixture manifest (one set of every kind, with
// explicit index tables) over placeholder pages in `codec: rgba8` (uncompressed KTX2), and its cases.json:
// packet-shaped inputs with the draws §15.7's programs must produce. Every frame is a numbered placeholder
// (its frame id in a 3 × 5 font on a tinted plate), so a screenshot shows which frame was drawn.
import { createHash } from 'node:crypto';
import { type Level, writeKtx2 } from './ktx2.ts';

/** The tiny atlas's arrays (§15.7 "arrays"): small pages and low densities, the manifest's format exactly. */
export const ARRAYS = [
  { kind: 'colour', pxPerTile: 16, pageSize: 512, levels: 2, codec: 'rgba8' },
  { kind: 'shadow', pxPerTile: 8, pageSize: 256, levels: 1, codec: 'rgba8' },
  { kind: 'light', pxPerTile: 8, pageSize: 128, levels: 1, codec: 'rgba8' },
  { kind: 'icon', pxPerTile: 16, pageSize: 128, levels: 1, codec: 'rgba8' },
] as const;
const COLOUR = 0;
const SHADOW = 1;
const LIGHT = 2;
const ICON = 3;

/** §15.7's named constants the cases use. */
export const PX_PER_TILE = 32;
export const BELT_ITEM_SIZE = 0.5;

/** The axis vocabulary (§15.7), version 1. */
export const AXES_VERSION = 1;

type Frame = [number, number, number, number, number, number, number, number];
interface Part {
  axes: string[];
  shape: number[];
  map?: Record<string, number[]>;
  table: number[][];
  pivot?: [number, number];
  length?: number;
  fps?: number;
  cycleTiles?: number;
}
interface SetDef {
  kind: 'entity' | 'inserter' | 'object' | 'resource' | 'mover' | 'icon';
  group: string;
  size?: [number, number];
  parts: Record<string, Part | Part[]>;
  shoulder?: [number, number];
  animShadow?: boolean;
}

// --------------------------------------------------------------------------------------------- painting

const FONT: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
};

class Page {
  readonly size: number;
  readonly rgba: Uint8Array;
  private shelfX = 0;
  private shelfY = 0;
  private shelfH = 0;
  constructor(size: number) {
    this.size = size;
    this.rgba = new Uint8Array(size * size * 4);
  }
  /** A cell for a w × h frame: a multiple of 32 px, with 8 px of gutter around the frame (§15.7 "Cells"). */
  cell(w: number, h: number): { x: number; y: number } | null {
    const cw = Math.ceil((w + 16) / 32) * 32;
    const ch = Math.ceil((h + 16) / 32) * 32;
    if (this.shelfX + cw > this.size) {
      this.shelfX = 0;
      this.shelfY += this.shelfH;
      this.shelfH = 0;
    }
    if (this.shelfY + ch > this.size) return null;
    const at = { x: this.shelfX + 8, y: this.shelfY + 8 };
    this.shelfX += cw;
    if (ch > this.shelfH) this.shelfH = ch;
    return at;
  }
  px(x: number, y: number, c: readonly number[]): void {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    const i = (y * this.size + x) * 4;
    this.rgba.set(c, i);
  }
  /** A placeholder: a tinted plate with a dark border and the frame id. */
  paint(x: number, y: number, w: number, h: number, id: number, tint: readonly number[], alpha = 255): void {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const edge = i === 0 || j === 0 || i === w - 1 || j === h - 1;
        this.px(
          x + i,
          y + j,
          edge ? [43, 39, 35, alpha] : [tint[0] as number, tint[1] as number, tint[2] as number, alpha],
        );
      }
    const digits = String(id);
    const tw = digits.length * 4 - 1;
    const ox = x + Math.max(1, Math.floor((w - tw) / 2));
    const oy = y + Math.max(1, Math.floor((h - 5) / 2));
    [...digits].forEach((ch, k) => {
      (FONT[ch] as string[]).forEach((row, r) => {
        [...row].forEach((bit, c) => {
          if (bit === '1' && ox + k * 4 + c < x + w - 1 && oy + r < y + h - 1)
            this.px(ox + k * 4 + c, oy + r, [20, 18, 16, alpha]);
        });
      });
    });
  }
  /** Level 1: a 2 × 2 box filter. */
  half(): Level {
    const s = this.size / 2;
    const out = new Uint8Array(s * s * 4);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++)
        for (let c = 0; c < 4; c++) {
          const at = (yy: number, xx: number) => this.rgba[(yy * this.size + xx) * 4 + c] as number;
          out[(y * s + x) * 4 + c] =
            (at(2 * y, 2 * x) + at(2 * y, 2 * x + 1) + at(2 * y + 1, 2 * x) + at(2 * y + 1, 2 * x + 1) + 2) >>
            2;
        }
    return { width: s, height: s, rgba: out };
  }
}

/** Builds pages and the frame list together. */
class Packer {
  readonly frames: Frame[] = [];
  readonly pages: Page[][] = ARRAYS.map(() => []);
  /** Adds a frame of w × h level-0 px with anchor (ax, ay), painted with its own id; returns its id. */
  frame(
    array: number,
    w: number,
    h: number,
    ax: number,
    ay: number,
    tint: readonly number[],
    alpha = 255,
  ): number {
    const id = this.frames.length;
    const pages = this.pages[array] as Page[];
    let page = pages[pages.length - 1];
    let at = page?.cell(w, h) ?? null;
    if (!page || !at) {
      page = new Page(ARRAYS[array]?.pageSize as number);
      pages.push(page);
      at = page.cell(w, h);
      if (!at) throw new Error(`a ${w}×${h} frame does not fit a page of array ${array}`);
    }
    page.paint(at.x, at.y, w, h, id, tint, alpha);
    this.frames.push([array, pages.length - 1, at.x, at.y, w, h, ax, ay]);
    return id;
  }
  /** A frame that is a sub-rectangle of an existing frame's image (a base cut into pieces, §9.1). */
  piece(of: number, x: number, y: number, w: number, h: number): number {
    const f = this.frames[of] as Frame;
    this.frames.push([f[0], f[1], f[2] + x, f[3] + y, w, h, f[6] - x, f[7] - y]);
    return this.frames.length - 1;
  }
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const same16 = () => range(16).map(() => 0);
const fourWay = () => range(16); // identity: rails, signals and four-way sets index all 16 directions

// --------------------------------------------------------------------------------------------- the sets

export function buildAtlas(): {
  manifest: Record<string, unknown>;
  sets: Record<string, SetDef>;
  frames: Frame[];
  files: Map<string, Uint8Array>;
} {
  const p = new Packer();
  const sets: Record<string, SetDef> = {};
  const T = {
    furnace: [205, 160, 120],
    belt: [190, 190, 120],
    ins: [200, 170, 90],
    char: [120, 160, 210],
    signal: [210, 120, 120],
    tree: [110, 170, 100],
    ore: [150, 160, 180],
    loco: [170, 120, 190],
    radar: [120, 190, 190],
    chest: [180, 150, 110],
    grey: [170, 170, 170],
    shadow: [0, 0, 0],
    light: [255, 220, 150],
    icon: [230, 200, 140],
  };

  // The stone furnace (2 × 2): F₀ cut into four pieces around the animated region R, 16 layer frames of R,
  // an idle image, a shadow and a light (the §15.7 example's structure).
  // F₀ is 32 × 40 level-0 px with its ground anchor at (16, 24); R, the animated region, is 16 × 16 at (8, 16).
  const f0 = p.frame(COLOUR, 32, 40, 16, 24, T.furnace);
  const pieces = [
    p.piece(f0, 0, 0, 32, 16),
    p.piece(f0, 0, 32, 32, 8),
    p.piece(f0, 0, 16, 8, 16),
    p.piece(f0, 24, 16, 8, 16),
  ];
  const layer = range(16).map(() => p.frame(COLOUR, 16, 16, 8, 8, T.furnace));
  const idle = p.frame(COLOUR, 32, 40, 16, 24, T.furnace);
  const fShadow = p.frame(SHADOW, 24, 16, 8, 8, T.shadow, 160);
  const fLight = p.frame(LIGHT, 8, 8, 4, 4, T.light);
  sets['entity/stone-furnace'] = {
    kind: 'entity',
    group: 'core',
    size: [2, 2],
    parts: {
      base: { axes: ['dir'], shape: [1], map: { dir: same16() }, table: [pieces] },
      layers: [
        { axes: ['dir', 'frame'], shape: [1, 16], map: { dir: same16() }, table: layer.map((f) => [f]) },
      ],
      idle: { axes: ['dir'], shape: [1], map: { dir: same16() }, table: [[idle]] },
      shadow: { axes: ['dir'], shape: [1], map: { dir: same16() }, table: [[fShadow]] },
      light: { axes: ['dir'], shape: [1], map: { dir: same16() }, table: [[fLight]] },
    },
  };

  // A transport belt with masks: four directions of 16 (empty entries elsewhere), three mask shapes
  // (0 straight, 1 from the left, 2 from the right; every other mask value draws straight), four frames.
  const beltBase: number[][] = [];
  const beltLayer: number[][] = [];
  for (let d = 0; d < 16; d++)
    for (let m = 0; m < 3; m++) {
      const four = d % 4 === 0;
      beltBase.push(four ? [p.frame(COLOUR, 16, 16, 8, 8, T.belt)] : []);
      for (let f = 0; f < 4; f++) beltLayer.push(four ? [p.frame(COLOUR, 16, 16, 8, 8, T.belt)] : []);
    }
  const mask = range(256).map((v) => (v === 1 ? 1 : v === 2 ? 2 : 0));
  sets['entity/transport-belt'] = {
    kind: 'entity',
    group: 'core',
    size: [1, 1],
    parts: {
      base: { axes: ['dir', 'mask'], shape: [16, 3], map: { dir: fourWay(), mask }, table: beltBase },
      layers: [
        {
          axes: ['dir', 'mask', 'frame'],
          shape: [16, 3, 4],
          map: { dir: fourWay(), mask },
          table: beltLayer,
        },
      ],
    },
  };

  // An inserter with pivots: a four-way platform, an arm (pivot and length) and two hands, each with its shadow.
  const plat = range(16).map((d) => (d % 4 === 0 ? [p.frame(COLOUR, 16, 16, 8, 8, T.ins)] : []));
  const platS = range(16).map((d) => (d % 4 === 0 ? [p.frame(SHADOW, 8, 8, 4, 4, T.shadow, 160)] : []));
  const arm = p.frame(COLOUR, 4, 16, 2, 14, T.ins);
  const armS = p.frame(SHADOW, 4, 8, 2, 7, T.shadow, 160);
  const open = p.frame(COLOUR, 14, 12, 7, 9, T.ins);
  const openS = p.frame(SHADOW, 4, 4, 2, 3, T.shadow, 160);
  const closed = p.frame(COLOUR, 14, 12, 7, 9, T.ins);
  const closedS = p.frame(SHADOW, 4, 4, 2, 3, T.shadow, 160);
  const one = (f: number, extra: Partial<Part> = {}): Part => ({
    axes: [],
    shape: [],
    table: [[f]],
    ...extra,
  });
  sets['entity/inserter'] = {
    kind: 'inserter',
    group: 'core',
    size: [1, 1],
    shoulder: [0, -2],
    parts: {
      platform: { axes: ['dir'], shape: [16], map: { dir: fourWay() }, table: plat },
      platform_shadow: { axes: ['dir'], shape: [16], map: { dir: fourWay() }, table: platS },
      arm: one(arm, { pivot: [2, 14], length: 12 }),
      arm_shadow: one(armS, { pivot: [2, 7], length: 6 }),
      hand_open: one(open, { pivot: [7, 9] }),
      hand_open_shadow: one(openS, { pivot: [2, 3] }),
      hand_closed: one(closed, { pivot: [7, 9] }),
      hand_closed_shadow: one(closedS, { pivot: [2, 3] }),
    },
  };

  // The character: three clips of 8 orientations, idle 4 frames, run and mine 16, with shadows alike (shadow
  // frames shared across a clip's frames: a set may share frames between combinations).
  const clip = (frames: number, extra: Partial<Part>): [Part, Part] => {
    const table: number[][] = [];
    const shadow: number[][] = [];
    for (let o = 0; o < 8; o++) {
      const s = p.frame(SHADOW, 8, 4, 2, 2, T.shadow, 160);
      for (let f = 0; f < frames; f++) {
        table.push([p.frame(COLOUR, 16, 16, 8, 14, T.char)]);
        shadow.push([s]);
      }
    }
    return [
      { axes: ['orientation', 'frame'], shape: [8, frames], table, ...extra },
      { axes: ['orientation', 'frame'], shape: [8, frames], table: shadow, ...extra },
    ];
  };
  const [cIdle, cIdleS] = clip(4, { fps: 8 });
  const [cRun, cRunS] = clip(16, { cycleTiles: 2 });
  const [cMine, cMineS] = clip(16, { fps: 30 });
  sets['mover/character'] = {
    kind: 'mover',
    group: 'core',
    parts: {
      idle: cIdle,
      run: cRun,
      mine: cMine,
      idle_shadow: cIdleS,
      run_shadow: cRunS,
      mine_shadow: cMineS,
    },
  };

  // A rail signal with lights: all 16 directions, and a light part whose `light` axis maps status values
  // (fixture codes until M2 defines them: 0 red, 1 yellow, 2 green, every other value red).
  const sigBase = range(16).map(() => [p.frame(COLOUR, 16, 16, 8, 14, T.signal)]);
  const sigLight = range(3).map(() => [p.frame(LIGHT, 4, 4, 2, 2, T.light)]);
  sets['entity/rail-signal'] = {
    kind: 'entity',
    group: 'core',
    size: [1, 1],
    parts: {
      base: { axes: ['dir'], shape: [16], map: { dir: range(16) }, table: sigBase },
      light: {
        axes: ['light'],
        shape: [3],
        map: { light: range(256).map((v) => (v === 1 ? 1 : v === 2 ? 2 : 0)) },
        table: sigLight,
      },
    },
  };

  // A tree with shape × stage (4 × 5), and shadows by shape.
  const treeBase = range(20).map(() => [p.frame(COLOUR, 16, 24, 8, 22, T.tree)]);
  const treeS = range(4).map(() => [p.frame(SHADOW, 12, 8, 4, 4, T.shadow, 160)]);
  sets['object/tree-oak'] = {
    kind: 'object',
    group: 'core',
    parts: {
      base: { axes: ['shape', 'stage'], shape: [4, 5], map: { stage: range(5) }, table: treeBase },
      shadow: { axes: ['shape'], shape: [4], table: treeS },
    },
  };

  // A resource with shape × band (6 × 8).
  sets['resource/iron-ore-patch'] = {
    kind: 'resource',
    group: 'core',
    parts: {
      base: {
        axes: ['shape', 'band'],
        shape: [6, 8],
        table: range(48).map(() => [p.frame(COLOUR, 16, 16, 8, 8, T.ore)]),
      },
    },
  };

  // A locomotive with 64 orientations (its shadow shares a frame per 8 orientations).
  const locoS = range(8).map(() => p.frame(SHADOW, 12, 8, 6, 4, T.shadow, 160));
  sets['mover/locomotive'] = {
    kind: 'mover',
    group: 'core',
    parts: {
      base: {
        axes: ['orientation'],
        shape: [64],
        table: range(64).map(() => [p.frame(COLOUR, 16, 16, 8, 8, T.loco)]),
      },
      shadow: { axes: ['orientation'], shape: [64], table: range(64).map((o) => [locoS[o >> 3] as number]) },
    },
  };

  // The radar (3 × 3): a static base, a 16-frame layer (the dish) and an animated shadow (§9.1 animShadow).
  const radarBase = p.frame(COLOUR, 48, 56, 24, 32, T.radar);
  sets['entity/radar'] = {
    kind: 'entity',
    group: 'core',
    size: [3, 3],
    animShadow: true,
    parts: {
      base: { axes: ['dir'], shape: [1], map: { dir: same16() }, table: [[radarBase]] },
      layers: [
        {
          axes: ['dir', 'frame'],
          shape: [1, 16],
          map: { dir: same16() },
          table: range(16).map(() => [p.frame(COLOUR, 16, 16, 8, 24, T.radar)]),
        },
      ],
      shadow: {
        axes: ['dir', 'frame'],
        shape: [1, 16],
        map: { dir: same16() },
        table: range(16).map(() => [p.frame(SHADOW, 24, 16, 8, 8, T.shadow, 160)]),
      },
    },
  };

  // What the golden packets draw: M0's chest (with its greybox), and the M0 items' icons.
  sets['entity/iron-chest'] = {
    kind: 'entity',
    group: 'core',
    size: [1, 1],
    parts: {
      base: {
        axes: ['dir'],
        shape: [1],
        map: { dir: same16() },
        table: [[p.frame(COLOUR, 16, 18, 8, 10, T.chest)]],
      },
      shadow: {
        axes: ['dir'],
        shape: [1],
        map: { dir: same16() },
        table: [[p.frame(SHADOW, 12, 8, 4, 4, T.shadow, 160)]],
      },
    },
  };
  sets['greybox/iron-chest'] = {
    kind: 'entity',
    group: 'core',
    size: [1, 1],
    parts: {
      base: {
        axes: ['dir'],
        shape: [1],
        map: { dir: same16() },
        table: [[p.frame(COLOUR, 16, 18, 8, 10, T.grey)]],
      },
    },
  };
  for (const item of ['iron-chest', 'iron-ore', 'iron-plate'])
    sets[`item/${item}`] = {
      kind: 'icon',
      group: 'core',
      parts: { icon: one(p.frame(ICON, 16, 16, 8, 8, T.icon)) },
    };

  // Pages: colour pages split level 0 from level 1 (§15.7 "files"); the other arrays have one file per page.
  const files = new Map<string, Uint8Array>();
  const pages = ARRAYS.map((a, ai) =>
    (p.pages[ai] as Page[]).map((page, li) => {
      const srgb = a.kind === 'colour' || a.kind === 'icon';
      const level0: Level = { width: page.size, height: page.size, rgba: page.rgba };
      const out: { group: string; files: string[]; bytes: number[] } = {
        group: 'core',
        files: [],
        bytes: [],
      };
      const add = (name: string, bytes: Uint8Array) => {
        files.set(`atlases/${name}`, bytes);
        out.files.push(`atlases/${name}`);
        out.bytes.push(bytes.length);
      };
      if (a.kind === 'colour') {
        add(`${a.kind}-core-${li}.h.ktx2`, writeKtx2([level0], srgb));
        add(`${a.kind}-core-${li}.n.ktx2`, writeKtx2([page.half()], srgb));
      } else add(`${a.kind}-core-${li}.ktx2`, writeKtx2([level0], srgb));
      return out;
    }),
  );
  const manifest = {
    version: 2,
    style: 'golden-tiny-1',
    axesVersion: AXES_VERSION,
    prototypesHash: null as string | null,
    arrays: ARRAYS,
    pages,
    frames: p.frames,
    sets,
    dom: { icons: {}, tech: {} },
  };
  return { manifest, sets, frames: p.frames, files };
}

export const sha256Hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

// --------------------------------------------------------------------------------------------- the cases

/** §15.7's position hash: the shape of a tree, rock, resource tile or decorative the packet does not carry. */
export function posHash(x: number, y: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca77);
  h ^= h >>> 13;
  return h >>> 0;
}

export interface Camera {
  cx: number;
  cy: number;
  zoom: number;
  dpr: number;
}

interface Quad {
  frame: number;
  array: number;
  layer: number;
  /** The quad's corners in device pixels from the canvas centre: the frame's top-left, top-right,
   * bottom-right, bottom-left after placement (and rotation). */
  corners: [number, number][];
  /** (u0, v0, u1, v1): the frame's rectangle ÷ its page's level-0 size. */
  uv: [number, number, number, number];
}

interface Draw {
  pass: 'colour' | 'shadow' | 'light';
  set: string;
  part: string;
  frames: number[];
  quads: Quad[];
  /** Light strength 0–1 (light pass only). */
  strength?: number;
  /** An empty table entry: the renderer draws the entity's greybox and logs once (§15.7). */
  greybox?: boolean;
}

/** Rounds away float noise so the JSON stays readable; consumers compare with a 10⁻³ device-px tolerance. */
const r6 = (v: number): number => {
  const x = Math.round(v * 1e6) / 1e6;
  return x === 0 ? 0 : x;
};

export function makeCases(atlas: ReturnType<typeof buildAtlas>): Record<string, unknown> {
  const { sets, frames } = atlas;
  const S = (c: Camera) => PX_PER_TILE * c.zoom * c.dpr;
  const P = (frame: number) => ARRAYS[(frames[frame] as Frame)[0]]?.pxPerTile as number;
  const pageSize = (frame: number) => ARRAYS[(frames[frame] as Frame)[0]]?.pageSize as number;
  const uv = (f: Frame, size: number): [number, number, number, number] => [
    r6(f[2] / size),
    r6(f[3] / size),
    r6((f[2] + f[4]) / size),
    r6((f[3] + f[5]) / size),
  ];

  /** §15.7 "Placing a sprite frame": k = S ÷ P; left = (ex − cx)·S − ax·k; top = (ey − cy)·S − ay·k. */
  const place = (frame: number, ex: number, ey: number, c: Camera): Quad => {
    const f = frames[frame] as Frame;
    const k = S(c) / P(frame);
    const left = (ex - c.cx) * S(c) - f[6] * k;
    const top = (ey - c.cy) * S(c) - f[7] * k;
    const w = f[4] * k;
    const h = f[5] * k;
    return {
      frame,
      array: f[0],
      layer: f[1],
      corners: [
        [r6(left), r6(top)],
        [r6(left + w), r6(top)],
        [r6(left + w), r6(top + h)],
        [r6(left), r6(top + h)],
      ],
      uv: uv(f, pageSize(frame)),
    };
  };

  /** A part drawn rotated by θ turns (clockwise from north) about its pivot placed at `at`, its length
   * stretched by `stretch` (§15.7 `inserter`). */
  const rotated = (
    frame: number,
    pivot: [number, number],
    at: [number, number],
    theta: number,
    stretch: number,
    c: Camera,
  ): Quad => {
    const f = frames[frame] as Frame;
    const k = S(c) / P(frame);
    const phi = 2 * Math.PI * theta;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const corner = (fx: number, fy: number): [number, number] => {
      const dx = (fx - pivot[0]) * k;
      const dy = (fy - pivot[1]) * k * stretch;
      return [r6(at[0] + dx * cos - dy * sin), r6(at[1] + dx * sin + dy * cos)];
    };
    return {
      frame,
      array: f[0],
      layer: f[1],
      corners: [corner(0, 0), corner(f[4], 0), corner(f[4], f[5]), corner(0, f[5])],
      uv: uv(f, pageSize(frame)),
    };
  };

  const part = (set: string, name: string): Part => {
    const s = sets[set] as SetDef;
    const x = name.startsWith('layers[')
      ? (s.parts.layers as Part[])[Number(name.slice(7, -1))]
      : s.parts[name];
    if (!x || Array.isArray(x)) throw new Error(`no part ${set} ${name}`);
    return x;
  };
  /** The table entry for axis values: each axis's index (map or rule), flattened row-major (§15.7). */
  const entry = (pt: Part, values: Record<string, number>): number[] => {
    let flat = 0;
    pt.axes.forEach((axis, i) => {
      const v = values[axis];
      if (v === undefined) throw new Error(`no value for axis ${axis}`);
      const idx = pt.map?.[axis] ? (pt.map[axis][v] as number) : v;
      if (idx < 0 || idx >= (pt.shape[i] as number)) throw new Error(`index ${idx} outside ${axis}`);
      flat = flat * (pt.shape[i] as number) + idx;
    });
    return pt.table[flat] as number[];
  };
  const drawPart = (
    pass: Draw['pass'],
    set: string,
    name: string,
    values: Record<string, number>,
    ex: number,
    ey: number,
    c: Camera,
    strength?: number,
  ): Draw => {
    const fr = entry(part(set, name), values);
    const d: Draw = { pass, set, part: name, frames: fr, quads: fr.map((f) => place(f, ex, ey, c)) };
    if (strength !== undefined) d.strength = r6(strength);
    if (fr.length === 0) d.greybox = true;
    return d;
  };
  const frameOf = (pt: Part, phase: number): number =>
    Math.floor((phase * (pt.shape[pt.axes.indexOf('frame')] as number)) / 65536);

  type EntityIn = {
    serial: number;
    x2: number;
    y2: number;
    proto: number;
    alt_icon: number;
    dir: number;
    flip: number;
    quality: number;
    variant: number;
    status: number;
    flags: number;
  };
  type DynIn = {
    x2: number;
    y2: number;
    serial: number;
    proto: number;
    phase: number;
    dir: number;
    state: number;
    light: number;
    quality: number;
  };
  const view = (x2: number, y2: number, dir = 0, variant = 0, status = 0): EntityIn => ({
    serial: 7,
    x2,
    y2,
    proto: 0,
    alt_icon: 0xffff,
    dir,
    flip: 0,
    quality: 0,
    variant,
    status,
    flags: 0,
  });
  const dynOf = (e: EntityIn, phase: number, state: number, light: number): DynIn => ({
    x2: e.x2,
    y2: e.y2,
    serial: e.serial,
    proto: e.proto,
    phase,
    dir: e.dir,
    state,
    light,
    quality: 0,
  });

  /** §15.7 `entity`: base and layers (or idle), then light, then shadow. */
  const entityDraws = (set: string, e: EntityIn, dyn: DynIn | null, c: Camera): Draw[] => {
    const s = sets[set] as SetDef;
    const ex = e.x2 / 2;
    const ey = e.y2 / 2;
    const out: Draw[] = [];
    const v = { dir: e.dir, mask: e.variant };
    const phase = dyn ? dyn.phase : 0;
    const working = !dyn || dyn.state === 1;
    if (!working && s.parts.idle) out.push(drawPart('colour', set, 'idle', v, ex, ey, c));
    else {
      out.push(drawPart('colour', set, 'base', v, ex, ey, c));
      ((s.parts.layers as Part[] | undefined) ?? []).forEach((pt, i) => {
        out.push(drawPart('colour', set, `layers[${i}]`, { ...v, frame: frameOf(pt, phase) }, ex, ey, c));
      });
    }
    const light = s.parts.light as Part | undefined;
    if (light) {
      if (light.axes.includes('light'))
        out.push(drawPart('light', set, 'light', { ...v, light: e.status }, ex, ey, c, 1));
      else if (dyn && dyn.light > 0) out.push(drawPart('light', set, 'light', v, ex, ey, c, dyn.light / 255));
    }
    const shadow = s.parts.shadow as Part | undefined;
    if (shadow)
      out.push(
        drawPart(
          'shadow',
          set,
          'shadow',
          shadow.axes.includes('frame') ? { ...v, frame: frameOf(shadow, phase) } : v,
          ex,
          ey,
          c,
        ),
      );
    return out;
  };

  /** §15.7 `inserter`: the platform, the arm stretched from the shoulder Q to the hand Hp, the hand, the held icon. */
  const inserterDraws = (
    set: string,
    e: EntityIn,
    hand: { theta: number; ext: number; held: number; held_count: number },
    heldIcon: string | null,
    c: Camera,
  ): Draw[] => {
    const s = sets[set] as SetDef;
    const ex = e.x2 / 2;
    const ey = e.y2 / 2;
    const theta = hand.theta / 65536;
    const r = hand.ext / 4096;
    const kc = S(c) / ARRAYS[COLOUR].pxPerTile;
    const anchor: [number, number] = [(ex - c.cx) * S(c), (ey - c.cy) * S(c)];
    const shoulder = s.shoulder as [number, number];
    const Q: [number, number] = [anchor[0] + shoulder[0] * kc, anchor[1] + shoulder[1] * kc];
    const Hp: [number, number] = [
      Q[0] + r * S(c) * Math.sin(2 * Math.PI * theta),
      Q[1] - r * S(c) * Math.cos(2 * Math.PI * theta),
    ];
    const reach = Math.hypot(Hp[0] - Q[0], Hp[1] - Q[1]);
    const out: Draw[] = [];
    const rot = (pass: Draw['pass'], name: string, at: [number, number], stretchTo: number | null): Draw => {
      const pt = part(set, name);
      const fr = entry(pt, {});
      const k = S(c) / P(fr[0] as number);
      const stretch = stretchTo === null ? 1 : stretchTo / ((pt.length as number) * k);
      return {
        pass,
        set,
        part: name,
        frames: fr,
        quads: fr.map((f) => rotated(f, pt.pivot as [number, number], at, theta, stretch, c)),
      };
    };
    out.push(drawPart('colour', set, 'platform', { dir: e.dir }, ex, ey, c));
    out.push(rot('colour', 'arm', Q, reach));
    const handPart = hand.held !== 0xffff ? 'hand_closed' : 'hand_open';
    out.push(rot('colour', handPart, Hp, null));
    if (heldIcon) {
      const f = entry(part(heldIcon, 'icon'), {})[0] as number;
      out.push({
        pass: 'colour',
        set: heldIcon,
        part: 'icon',
        frames: [f],
        quads: [iconQuad(f, Hp, BELT_ITEM_SIZE * S(c))],
      });
    }
    out.push(drawPart('shadow', set, 'platform_shadow', { dir: e.dir }, ex, ey, c));
    out.push(rot('shadow', 'arm_shadow', Q, reach));
    out.push(rot('shadow', `${handPart}_shadow`, Hp, null));
    return out;
  };

  /** An icon centred on a screen point at `size` device pixels (§15.7 "Icons"). */
  const iconQuad = (frame: number, at: [number, number], size: number): Quad => {
    const f = frames[frame] as Frame;
    const l = at[0] - size / 2;
    const t = at[1] - size / 2;
    return {
      frame,
      array: f[0],
      layer: f[1],
      corners: [
        [r6(l), r6(t)],
        [r6(l + size), r6(t)],
        [r6(l + size), r6(t + size)],
        [r6(l), r6(t + size)],
      ],
      uv: uv(f, pageSize(frame)),
    };
  };

  const moverDraws = (
    set: string,
    m: { x: number; y: number; vx: number; vy: number; orientation: number; flags: number },
    dt: number,
    distance: number,
    c: Camera,
  ): Draw[] => {
    const ex = (m.x + m.vx * dt) / 256;
    const ey = (m.y + m.vy * dt) / 256;
    const orient = (shape: number) => Math.floor((m.orientation * shape) / 65536 + 0.5) % shape;
    if (set === 'mover/character') {
      const clip = (m.flags & 1) !== 0 ? 'mine' : m.vx !== 0 || m.vy !== 0 ? 'run' : 'idle';
      const pt = part(set, clip);
      const n = pt.shape[1] as number;
      const frame =
        clip === 'run'
          ? Math.floor((distance / (pt.cycleTiles as number)) * 16) % 16
          : Math.floor((dt / 60) * (pt.fps as number)) % n;
      const v = { orientation: orient(8), frame };
      return [
        drawPart('colour', set, clip, v, ex, ey, c),
        drawPart('shadow', set, `${clip}_shadow`, v, ex, ey, c),
      ];
    }
    const v = { orientation: orient(64) };
    return [drawPart('colour', set, 'base', v, ex, ey, c), drawPart('shadow', set, 'shadow', v, ex, ey, c)];
  };

  const cases: Record<string, unknown>[] = [];
  const add = (name: string, camera: Camera, input: Record<string, unknown>, draws: Draw[], note?: string) =>
    cases.push({ name, camera, input, draws, ...(note ? { note } : {}) });
  const cam = (cx: number, cy: number, zoom = 1, dpr = 1): Camera => ({ cx, cy, zoom, dpr });

  // The stone furnace: without DYN (frame 0), working (phase → frame, light), idle (the idle image).
  const furnace = view(-8, 6); // a 2 × 2 entity's centre lies on a tile corner: even x2 and y2
  add(
    'furnace without DYN: base pieces and layer frame 0, shadow',
    cam(-4, 2),
    { set: 'entity/stone-furnace', entity: furnace, dyn: null },
    entityDraws('entity/stone-furnace', furnace, null, cam(-4, 2)),
  );
  const fw = dynOf(furnace, 40000, 1, 200);
  add(
    'furnace working at phase 40000: layer frame 9, light at 200/255',
    cam(-4, 2, 1, 2),
    { set: 'entity/stone-furnace', entity: furnace, dyn: fw },
    entityDraws('entity/stone-furnace', furnace, fw, cam(-4, 2, 1, 2)),
  );
  const fi = dynOf(furnace, 40000, 0, 0);
  add(
    'furnace idle: the idle image, no light',
    cam(-4, 2, 0.5),
    { set: 'entity/stone-furnace', entity: furnace, dyn: fi },
    entityDraws('entity/stone-furnace', furnace, fi, cam(-4, 2, 0.5)),
  );
  // A belt: mask 1 facing east, its layer following DYN; a diagonal direction holds an empty entry.
  const belt = view(201, -401, 4, 1);
  const bw = dynOf(belt, 50000, 1, 0);
  add(
    'belt east, mask 1 (from the left), phase 50000: layer frame 3',
    cam(100.5, -200.5, 3),
    { set: 'entity/transport-belt', entity: belt, dyn: bw },
    entityDraws('entity/transport-belt', belt, bw, cam(100.5, -200.5, 3)),
  );
  const beltBad = view(201, -401, 2, 0);
  add(
    'belt facing north-east: an empty table entry (greybox)',
    cam(100.5, -200.5),
    { set: 'entity/transport-belt', entity: beltBad, dyn: null },
    entityDraws('entity/transport-belt', beltBad, null, cam(100.5, -200.5)),
  );
  // An inserter swinging at θ = 0.375 with a plate, and an empty one at θ = 0.
  const ins = view(11, 7, 8);
  add(
    'inserter facing south, θ 0.375, reach 1.2 tiles, holding a plate',
    cam(5, 3, 2, 2),
    {
      set: 'entity/inserter',
      entity: ins,
      hand: { theta: 24576, ext: 4915, held: 16, held_count: 1 },
      heldIcon: 'item/iron-plate',
    },
    inserterDraws(
      'entity/inserter',
      ins,
      { theta: 24576, ext: 4915, held: 16, held_count: 1 },
      'item/iron-plate',
      cam(5, 3, 2, 2),
    ),
  );
  add(
    'inserter facing east, θ 0, reach 0.7 tiles, empty hand',
    cam(5, 3),
    {
      set: 'entity/inserter',
      entity: view(11, 7, 4),
      hand: { theta: 0, ext: 2867, held: 0xffff, held_count: 0 },
      heldIcon: null,
    },
    inserterDraws(
      'entity/inserter',
      view(11, 7, 4),
      { theta: 0, ext: 2867, held: 0xffff, held_count: 0 },
      null,
      cam(5, 3),
    ),
  );
  // The character: idle, running (frame from distance), mining (mine wins over run).
  const ch = {
    serial: 1,
    proto: 1,
    kind: 0,
    flags: 0,
    x: -2560,
    y: 384,
    vx: 0,
    vy: 0,
    base_tick: 100,
    orientation: 16384,
    aux: 0,
  };
  add(
    'character idle facing east, 37 ticks after base_tick (8 fps)',
    cam(-10, 1),
    { set: 'mover/character', mover: ch, ticksSinceBase: 37, distance: 0 },
    moverDraws('mover/character', ch, 37, 0, cam(-10, 1)),
  );
  const run = { ...ch, vx: 27, vy: -27, orientation: 8192 };
  add(
    'character running north-east, 3 ticks extrapolated, 1.3 tiles walked',
    cam(-10, 1, 1, 2),
    { set: 'mover/character', mover: run, ticksSinceBase: 3, distance: 1.3 },
    moverDraws('mover/character', run, 3, 1.3, cam(-10, 1, 1, 2)),
  );
  const mine = { ...run, flags: 1, orientation: 61440 };
  add(
    'character mining while moving: the mine clip, facing north-north-west (rounds to north)',
    cam(-10, 1),
    { set: 'mover/character', mover: mine, ticksSinceBase: 10, distance: 1.3 },
    moverDraws('mover/character', mine, 10, 1.3, cam(-10, 1)),
  );
  // A rail signal: all 16 directions; its light from the status (fixture codes).
  const sig = view(-31, -61, 6, 0, 2);
  add(
    'rail signal facing south-east, status 2: green light',
    cam(-15, -30),
    { set: 'entity/rail-signal', entity: sig, dyn: null },
    entityDraws('entity/rail-signal', sig, null, cam(-15, -30)),
  );
  // A tree (shape from the position hash, stage from the variant) and a resource tile (shape × band).
  const tree = { id: 0, kind: 0, variant: 3, x: -5000, y: 7000, count: 0 };
  const tx = tree.x / 256;
  const ty = tree.y / 256;
  const tShape = posHash(tree.x, tree.y) % 4;
  add(
    'tree at (−5000, 7000)/256: shape posHash % 4, stage 3',
    cam(-20, 27),
    { set: 'object/tree-oak', object: tree, shapeIndex: tShape },
    [
      drawPart(
        'colour',
        'object/tree-oak',
        'base',
        { shape: tShape, stage: tree.variant },
        tx,
        ty,
        cam(-20, 27),
      ),
      drawPart('shadow', 'object/tree-oak', 'shadow', { shape: tShape }, tx, ty, cam(-20, 27)),
    ],
  );
  const res = { tile: 37, resource: 0, band: 5 };
  const rtx = -2 * 32 + (res.tile % 32);
  const rty = 1 * 32 + Math.floor(res.tile / 32);
  const rShape = posHash(rtx, rty) % 6;
  add(
    'iron ore in chunk (−2, 1), tile 37: shape posHash(tx, ty) % 6, band 5',
    cam(-59.5, 33),
    { set: 'resource/iron-ore-patch', chunk: [-2, 1], resource: res, tileXY: [rtx, rty], shapeIndex: rShape },
    [
      drawPart(
        'colour',
        'resource/iron-ore-patch',
        'base',
        { shape: rShape, band: res.band },
        rtx + 0.5,
        rty + 0.5,
        cam(-59.5, 33),
      ),
    ],
  );
  // A locomotive with 64 orientations at large coordinates.
  const loco = {
    serial: 99,
    proto: 0,
    kind: 2,
    flags: 0,
    x: 25600000,
    y: -12800000,
    vx: 0,
    vy: 0,
    base_tick: 0,
    orientation: 12345,
    aux: 0,
  };
  add(
    'locomotive at (100000, −50000) tiles, orientation 12345: index round(12345 × 64 / 65536) = 12',
    cam(100000, -50000, 0.5),
    { set: 'mover/locomotive', mover: loco, ticksSinceBase: 0, distance: 0 },
    moverDraws('mover/locomotive', loco, 0, 0, cam(100000, -50000, 0.5)),
  );
  // The radar: its dish layer and its animated shadow both follow the phase.
  const radar = view(1, 1);
  const rw = dynOf(radar, 12288, 1, 0);
  add(
    'radar working at phase 12288: dish frame 3, shadow frame 3',
    cam(0, 0, 2, 2),
    { set: 'entity/radar', entity: radar, dyn: rw },
    entityDraws('entity/radar', radar, rw, cam(0, 0, 2, 2)),
  );
  // M0's chest, as the golden packets draw it, and an icon at a belt item's size.
  const chest = view(73, -5);
  add(
    "iron chest (the golden packets' chest A)",
    cam(40, 0),
    { set: 'entity/iron-chest', entity: chest, dyn: null },
    entityDraws('entity/iron-chest', chest, null, cam(40, 0)),
  );
  const plateIcon = entry(part('item/iron-plate', 'icon'), {})[0] as number;
  add(
    'iron plate icon centred at (2.25, −0.75), BELT_ITEM_SIZE 0.5 tile',
    cam(2, -1, 1, 2),
    { set: 'item/iron-plate', centre: [2.25, -0.75], sizeTiles: BELT_ITEM_SIZE },
    [
      {
        pass: 'colour',
        set: 'item/iron-plate',
        part: 'icon',
        frames: [plateIcon],
        quads: [iconQuad(plateIcon, [(2.25 - 2) * 64, (-0.75 + 1) * 64], 0.5 * 64)],
      },
    ],
  );
  return {
    version: 1,
    note:
      "Expected draws of §15.7's programs over manifest.json: device pixels from the canvas centre, S = 32 × zoom × dpr; " +
      'compare corners and uv with a tolerance of 0.001. Passes: colour, shadow, light. README.md "The tiny atlas" states the readings this file fixes.',
    constants: { PX_PER_TILE, BELT_ITEM_SIZE },
    cases,
  };
}

/** JSON with sorted keys, arrays of numbers on one line (frames and tables stay readable). */
export function prettyJson(v: unknown, indent = ''): string {
  const inner = `${indent}  `;
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === 'number' || typeof x === 'string' || x === null))
      return `[${v.map((x) => JSON.stringify(x)).join(', ')}]`;
    if (v.every((x) => Array.isArray(x) && x.every((y: unknown) => typeof y === 'number')))
      return v.length === 0
        ? '[]'
        : `[\n${v.map((x) => `${inner}${prettyJson(x, inner)}`).join(',\n')}\n${indent}]`;
    return v.length === 0
      ? '[]'
      : `[\n${v.map((x) => `${inner}${prettyJson(x, inner)}`).join(',\n')}\n${indent}]`;
  }
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v).sort();
    if (keys.length === 0) return '{}';
    return `{\n${keys.map((k) => `${inner}${JSON.stringify(k)}: ${prettyJson((v as Record<string, unknown>)[k], inner)}`).join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(v);
}

/** The atlas's files under sprites/: the manifest, its pages and the cases. */
export function atlasFiles(prototypesHash: string): Map<string, Uint8Array> {
  const a = buildAtlas();
  a.manifest.prototypesHash = prototypesHash;
  const files = new Map<string, Uint8Array>(a.files);
  const text = (s: string) => new TextEncoder().encode(s);
  files.set('atlases/sprites.json', text(`${prettyJson(a.manifest)}\n`));
  files.set('cases.json', text(`${prettyJson(makeCases(a))}\n`));
  return files;
}

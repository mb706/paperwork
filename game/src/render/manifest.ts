// The sprite manifest, version 2 (10 §15.7): its JSON shape, the checks the renderer makes when it loads one, and
// the compiled form the drawing programs read. Every part's explicit index table is flattened once into typed
// arrays, so drawing never touches a string or allocates: a lookup turns axis values into an entry (a run of frame
// ids) with the one flatten rule (row-major over `axes`, the last fastest). `scripts/assets/manifest.py` is the
// Python twin; both run test/fixtures/sprites/cases.json.

/** The closed axis vocabulary (10 §15.7), versioned by `axesVersion`. */
export const AXES = ['dir', 'mask', 'shape', 'stage', 'band', 'light', 'orientation', 'frame'] as const;
export type AxisName = (typeof AXES)[number];
export const AXES_VERSION = 1;
export const MANIFEST_VERSION = 2;
export const AXIS = {
  dir: 0,
  mask: 1,
  shape: 2,
  stage: 3,
  band: 4,
  light: 5,
  orientation: 6,
  frame: 7,
} as const;
const AXIS_COUNT = 8;

export type ArrayKind = 'colour' | 'shadow' | 'light' | 'icon';
export const ARRAY_KINDS: readonly ArrayKind[] = ['colour', 'shadow', 'light', 'icon'];
/** Array kind codes: the manifest lists the arrays in this order (sprites.schema.json). */
export const KIND = { colour: 0, shadow: 1, light: 2, icon: 3 } as const;
export type Codec = 'xubc7' | 'etc1s' | 'rgba8';

export interface ManifestArray {
  kind: ArrayKind;
  pxPerTile: number;
  pageSize: number;
  levels: number;
  codec: Codec;
}
export interface ManifestPage {
  group: string;
  /** Colour: [level 0, levels 1…]; the other arrays: one file. */
  files: string[];
  bytes: number[];
  sha256?: string[];
}
export interface ManifestPart {
  axes: AxisName[];
  shape: number[];
  map?: Partial<Record<AxisName, number[]>>;
  table: number[][];
  pivot?: [number, number];
  length?: number;
  fps?: number;
  cycleTiles?: number;
}
export type SetKind = 'entity' | 'inserter' | 'object' | 'resource' | 'mover' | 'icon';
export interface ManifestSet {
  kind: SetKind;
  group: string;
  size?: [number, number];
  parts: Record<string, ManifestPart | ManifestPart[]>;
  shoulder?: [number, number];
  shadowShoulder?: [number, number];
  animShadow?: true;
  animLight?: true;
  smoke?: [number, number][];
  framesPerTile?: number;
  lightFrom?: 'status' | 'dyn';
  radiusTiles?: number;
}
export interface ManifestTerrain {
  pxPerTile: number;
  size: number;
  levels: number;
  codec: 'xubc7' | 'rgba8';
  tiles: Record<string, { file: string; bytes: number; sha256?: string; group: string }>;
}
export interface SpriteManifest {
  version: number;
  axesVersion: number;
  prototypesHash: string;
  style?: string;
  arrays: ManifestArray[];
  pages: ManifestPage[][];
  frames: number[][];
  sets: Record<string, ManifestSet>;
  dom?: unknown;
  terrain?: ManifestTerrain;
}

/** A refused manifest (10 §15.7: "The renderer refuses an unknown version or axis vocabulary"). */
export class ManifestError extends Error {
  override name = 'ManifestError';
}

/** A compiled part: its axes as codes, maps as typed arrays, and its table as (start, count) pairs. */
export interface Part {
  name: string;
  axes: Int32Array;
  shape: Int32Array;
  /** Per axis position: the value → index map, or null. */
  maps: (Int32Array | null)[];
  /** Per flattened index: [start, count] into the atlas's `entryFrames`. */
  entries: Int32Array;
  /** The position of the `frame` axis in `axes`, or −1. */
  frameAxis: number;
  /** The frame axis's length (0 without one). */
  frameCount: number;
  pivotX: number;
  pivotY: number;
  length: number;
  fps: number;
  cycleTiles: number;
}

export const SET_KIND = { entity: 0, inserter: 1, object: 2, resource: 3, mover: 4, icon: 5 } as const;

/** A compiled set. The named parts the programs use are resolved once; `parts` holds every part by name. */
export interface SpriteSet {
  name: string;
  index: number;
  kind: number;
  group: string;
  sizeW: number;
  sizeH: number;
  parts: Map<string, Part>;
  base: Part | null;
  idle: Part | null;
  layers: Part[];
  shadow: Part | null;
  light: Part | null;
  icon: Part | null;
  // inserter
  platform: Part | null;
  platformShadow: Part | null;
  arm: Part | null;
  armShadow: Part | null;
  handOpen: Part | null;
  handOpenShadow: Part | null;
  handClosed: Part | null;
  handClosedShadow: Part | null;
  shoulderX: number;
  shoulderY: number;
  shadowShoulderX: number;
  shadowShoulderY: number;
  // mover clips (the character) and plain movers (base/shadow)
  clipIdle: Part | null;
  clipRun: Part | null;
  clipMine: Part | null;
  clipIdleShadow: Part | null;
  clipRunShadow: Part | null;
  clipMineShadow: Part | null;
  framesPerTile: number;
  lightFromStatus: boolean;
  /** Chimney points (level-0 px of the colour array from the anchor), flattened x, y. */
  smoke: Float64Array;
  /** Every page (array · 65,536 + layer) a frame of this set lies on: residency checks. */
  pageKeys: Int32Array;
}

/** The compiled manifest. */
export class Atlas {
  readonly json: SpriteManifest;
  /** 8 numbers per frame: [array, layer, x, y, w, h, ax, ay] (level-0 px). */
  readonly frames: Float64Array;
  readonly frameCount: number;
  /** Every part entry's frame ids, concatenated (parts point into it). */
  readonly entryFrames: Int32Array;
  readonly sets: SpriteSet[] = [];
  readonly byName = new Map<string, SpriteSet>();
  /** The array index of each kind (colour, shadow, light, icon). */
  readonly arrayOfKind = new Int32Array(4);
  /** The kind of each array (KIND codes). */
  readonly kindOfArray: Int32Array;
  readonly pxPerTile: Float64Array;
  readonly pageSize: Float64Array;

  constructor(json: SpriteManifest) {
    checkManifest(json);
    this.json = json;
    const n = json.frames.length;
    this.frameCount = n;
    this.frames = new Float64Array(n * 8);
    for (let i = 0; i < n; i++) {
      const fr = json.frames[i] as number[];
      for (let j = 0; j < 8; j++) this.frames[i * 8 + j] = fr[j] as number;
    }
    const na = json.arrays.length;
    this.kindOfArray = new Int32Array(na);
    this.pxPerTile = new Float64Array(na);
    this.pageSize = new Float64Array(na);
    this.arrayOfKind.fill(-1);
    json.arrays.forEach((a, i) => {
      const k = KIND[a.kind];
      this.kindOfArray[i] = k;
      if (this.arrayOfKind[k] === -1) this.arrayOfKind[k] = i;
      this.pxPerTile[i] = a.pxPerTile;
      this.pageSize[i] = a.pageSize;
    });
    // Entries first, so every part can point into one array.
    let total = 0;
    for (const s of Object.values(json.sets))
      for (const p of Object.values(s.parts))
        for (const q of Array.isArray(p) ? p : [p]) for (const e of q.table) total += e.length;
    this.entryFrames = new Int32Array(total);
    let at = 0;
    const compilePart = (setName: string, name: string, q: ManifestPart): Part => {
      const axes = new Int32Array(q.axes.length);
      const maps: (Int32Array | null)[] = [];
      let frameAxis = -1;
      q.axes.forEach((a, i) => {
        const code = AXES.indexOf(a);
        if (code < 0) throw new ManifestError(`${setName}.${name}: unknown axis ${a}`);
        axes[i] = code;
        if (a === 'frame') frameAxis = i;
        const m = q.map?.[a];
        maps.push(m ? Int32Array.from(m) : null);
      });
      const shape = Int32Array.from(q.shape);
      let combos = 1;
      for (const k of q.shape) combos *= k;
      if (q.table.length !== combos)
        throw new ManifestError(
          `${setName}.${name}: ${q.table.length} entries for shape ${q.shape.join('×')}`,
        );
      const entries = new Int32Array(combos * 2);
      q.table.forEach((e, i) => {
        entries[i * 2] = at;
        entries[i * 2 + 1] = e.length;
        for (const f of e) {
          if (!(f >= 0 && f < n)) throw new ManifestError(`${setName}.${name}: frame ${f} out of range`);
          this.entryFrames[at++] = f;
        }
      });
      return {
        name,
        axes,
        shape,
        maps,
        entries,
        frameAxis,
        frameCount: frameAxis >= 0 ? (shape[frameAxis] as number) : 0,
        pivotX: q.pivot?.[0] ?? Number.NaN,
        pivotY: q.pivot?.[1] ?? Number.NaN,
        length: q.length ?? Number.NaN,
        fps: q.fps ?? Number.NaN,
        cycleTiles: q.cycleTiles ?? Number.NaN,
      };
    };
    for (const [name, s] of Object.entries(json.sets)) {
      const parts = new Map<string, Part>();
      const layers: Part[] = [];
      for (const [pn, p] of Object.entries(s.parts)) {
        if (Array.isArray(p)) {
          for (const [i, q] of p.entries()) layers.push(compilePart(name, `${pn}[${i}]`, q));
        } else parts.set(pn, compilePart(name, pn, p));
      }
      const get = (k: string) => parts.get(k) ?? null;
      const pages = new Set<number>();
      for (const part of [...parts.values(), ...layers])
        for (let i = 0; i < part.entries.length; i += 2)
          for (let j = 0; j < (part.entries[i + 1] as number); j++) {
            const f = this.entryFrames[(part.entries[i] as number) + j] as number;
            pages.add((this.frames[f * 8] as number) * 65536 + (this.frames[f * 8 + 1] as number));
          }
      const set: SpriteSet = {
        name,
        index: this.sets.length,
        kind: SET_KIND[s.kind],
        group: s.group,
        sizeW: s.size?.[0] ?? 1,
        sizeH: s.size?.[1] ?? 1,
        parts,
        base: get('base'),
        idle: s.kind === 'mover' ? null : get('idle'),
        layers,
        shadow: get('shadow'),
        light: get('light'),
        icon: get('icon'),
        platform: get('platform'),
        platformShadow: get('platform_shadow'),
        arm: get('arm'),
        armShadow: get('arm_shadow'),
        handOpen: get('hand_open'),
        handOpenShadow: get('hand_open_shadow'),
        handClosed: get('hand_closed'),
        handClosedShadow: get('hand_closed_shadow'),
        shoulderX: s.shoulder?.[0] ?? 0,
        shoulderY: s.shoulder?.[1] ?? 0,
        shadowShoulderX: s.shadowShoulder?.[0] ?? 0,
        shadowShoulderY: s.shadowShoulder?.[1] ?? 0,
        clipIdle: s.kind === 'mover' ? get('idle') : null,
        clipRun: get('run'),
        clipMine: get('mine'),
        clipIdleShadow: get('idle_shadow'),
        clipRunShadow: get('run_shadow'),
        clipMineShadow: get('mine_shadow'),
        framesPerTile: s.framesPerTile ?? 0,
        lightFromStatus: s.lightFrom === 'status',
        smoke: Float64Array.from((s.smoke ?? []).flat()),
        pageKeys: Int32Array.from([...pages].sort((a, b) => a - b)),
      };
      this.sets.push(set);
      this.byName.set(name, set);
    }
  }

  set(name: string): SpriteSet | null {
    return this.byName.get(name) ?? null;
  }

  /** The array kind (KIND code) of frame f. */
  kindOf(f: number): number {
    return this.kindOfArray[this.frames[f * 8] as number] as number;
  }

  /** pxPerTile of frame f's array. */
  pxOf(f: number): number {
    return this.pxPerTile[this.frames[f * 8] as number] as number;
  }
}

/** The checks 10 §15.7 asks of the renderer: version, axis vocabulary, the four arrays in order. */
export function checkManifest(m: SpriteManifest): void {
  if (m.version !== MANIFEST_VERSION)
    throw new ManifestError(`sprites.json version ${m.version}; this renderer reads ${MANIFEST_VERSION}`);
  if (m.axesVersion !== AXES_VERSION)
    throw new ManifestError(`sprites.json axesVersion ${m.axesVersion}; this renderer reads ${AXES_VERSION}`);
  if (!Array.isArray(m.arrays) || m.arrays.length !== 4)
    throw new ManifestError('sprites.json must list the colour, shadow, light and icon arrays');
  m.arrays.forEach((a, i) => {
    if (a.kind !== ARRAY_KINDS[i]) throw new ManifestError(`array ${i} is ${a.kind}, not ${ARRAY_KINDS[i]}`);
    if (!(a.pageSize > 0 && a.pxPerTile > 0 && a.levels >= 1))
      throw new ManifestError(`array ${a.kind}: bad size`);
  });
  if (!Array.isArray(m.pages) || m.pages.length !== 4)
    throw new ManifestError('sprites.json must list pages per array');
}

/** Scratch axis values for `lookup` (indexed by AXIS codes). */
export function axisValues(): Int32Array {
  return new Int32Array(AXIS_COUNT);
}

/**
 * The entry of part p for axis values `vals` (AXIS-indexed packet values: dir, mask, the position hash for shape,
 * stage, band, light, orientation and phase as turns × 65,536). `frameIndex` ≥ 0 gives the frame axis's index
 * directly (belts' and movers' clocks). Returns the flattened index (use `entryStart`/`entryCount`), or −1 when a
 * value lies outside the part (a malformed packet value).
 */
export function lookup(p: Part, vals: Int32Array, frameIndex = -1): number {
  let idx = 0;
  const axes = p.axes;
  for (let i = 0; i < axes.length; i++) {
    const a = axes[i] as number;
    const n = p.shape[i] as number;
    const v = vals[a] as number;
    let k: number;
    const m = p.maps[i];
    if (a === AXIS.frame && frameIndex >= 0) k = frameIndex % n;
    else if (m !== null && m !== undefined) {
      if (v < 0 || v >= m.length) return -1;
      k = m[v] as number;
    } else if (a === AXIS.orientation) k = Math.floor((v * n) / 65536 + 0.5) % n;
    else if (a === AXIS.frame) k = Math.floor((v * n) / 65536) % n;
    else if (a === AXIS.shape) k = (v >>> 0) % n;
    else k = v;
    if (k < 0 || k >= n) return -1;
    idx = idx * n + k;
  }
  return idx;
}

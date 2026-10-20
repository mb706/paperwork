// A SpriteSink that records draws in the shape of test/fixtures/sprites/cases.json's expectations (the Python twin's
// `draws_for` dicts), so the renderer's programs can be compared with scripts/assets/manifest.py case by case.
import { ARRAY_KINDS, type Atlas, type SpriteSet } from '../../src/render/manifest.ts';
import { PART, SINK_ARGS, type SpriteSink } from '../../src/render/programs.ts';

export interface RecordedDraw {
  part: string;
  frames: number[];
  quads?: number[][];
  uvs?: number[][];
  passes?: string[];
  alpha?: number;
  fallback?: string;
  pass?: string;
  pivot?: number[];
  at?: number[];
  rotation_turns?: number;
  scale?: number;
  stretch?: number;
  item?: number;
  size_tiles?: number;
  /** The set the part belongs to (not in cases.json). */
  set?: string;
  /** The stream each frame went to (not in cases.json). */
  streams: number[];
}

const CLIPS = ['idle', 'run', 'mine'];

export function partName(code: number, index: number): string {
  switch (code) {
    case PART.base:
      return 'base';
    case PART.idle:
      return 'idle';
    case PART.layer:
      return `layers[${index}]`;
    case PART.light:
      return 'light';
    case PART.shadow:
      return 'shadow';
    case PART.platform:
      return 'platform';
    case PART.platformShadow:
      return 'platform_shadow';
    case PART.arm:
      return 'arm';
    case PART.armShadow:
      return 'arm_shadow';
    case PART.handOpen:
      return 'hand_open';
    case PART.handOpenShadow:
      return 'hand_open_shadow';
    case PART.handClosed:
      return 'hand_closed';
    case PART.handClosedShadow:
      return 'hand_closed_shadow';
    case PART.clip:
      return CLIPS[index] as string;
    case PART.clipShadow:
      return `${CLIPS[index]}_shadow`;
    case PART.icon:
      return 'icon';
    case PART.held:
      return 'held';
    default:
      return `part${code}`;
  }
}

export class Recorder implements SpriteSink {
  readonly args = new Float64Array(SINK_ARGS);
  draws: RecordedDraw[] = [];
  private current: RecordedDraw | null = null;
  private fallbackName: string | null = null;
  private readonly atlas: Atlas;
  constructor(atlas: Atlas) {
    this.atlas = atlas;
  }

  reset(): void {
    this.draws = [];
    this.current = null;
    this.fallbackName = null;
  }

  /** Ends a program's draws: the next program starts without a fallback mark. */
  endItem(): void {
    this.current = null;
    this.fallbackName = null;
  }

  part(code: number, index: number, set: SpriteSet | null): void {
    const d: RecordedDraw = { part: partName(code, index), frames: [], streams: [] };
    if (set) d.set = set.name;
    if (this.fallbackName !== null) d.fallback = this.fallbackName;
    this.draws.push(d);
    this.current = d;
  }

  fallback(set: SpriteSet): void {
    this.fallbackName = set.name;
  }

  private cur(): RecordedDraw {
    if (!this.current) this.part(-1, 0, null);
    return this.current as RecordedDraw;
  }

  quad(stream: number, f: number): void {
    const [left, top, w, h, alpha] = this.args as unknown as [number, number, number, number, number];
    const d = this.cur();
    const fr = this.atlas.frames;
    const a = fr[f * 8] as number;
    const P = this.atlas.pageSize[a] as number;
    const x = fr[f * 8 + 2] as number;
    const y = fr[f * 8 + 3] as number;
    const fw = fr[f * 8 + 4] as number;
    const fh = fr[f * 8 + 5] as number;
    d.frames.push(f);
    d.streams.push(stream);
    d.quads = [...(d.quads ?? []), [left, top, w, h]];
    d.uvs = [...(d.uvs ?? []), [x / P, y / P, (x + fw) / P, (y + fh) / P]];
    d.passes = [...(d.passes ?? []), ARRAY_KINDS[this.atlas.kindOf(f)] as string];
    if (d.part === 'light') d.alpha = alpha;
  }

  rotated(stream: number, f: number): void {
    const [pivotX, pivotY, atX, atY, turns, k, stretch] = this.args as unknown as number[] as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const d = this.cur();
    d.frames.push(f);
    d.streams.push(stream);
    d.pass = ARRAY_KINDS[this.atlas.kindOf(f)] as string;
    d.pivot = [pivotX, pivotY];
    d.at = [atX, atY];
    d.rotation_turns = turns;
    d.scale = k;
    if (d.part === 'arm' || d.part === 'arm_shadow') d.stretch = stretch;
  }

  held(item: number): void {
    const [atX, atY, sizeTiles] = this.args as unknown as [number, number, number];
    const d = this.cur();
    d.item = item;
    d.at = [atX, atY];
    d.size_tiles = sizeTiles;
  }
}

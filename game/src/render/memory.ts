// GPU memory (10 §6.13): the sprite resolution modes, what each allocates, and the choice among them. Each array is
// allocated once at load with immutable storage, as many layers as the manifest has pages and every level of the
// mode, so nothing grows and the peak is the steady state. The renderer picks the highest mode that fits its budget
// (and allocates without OUT_OF_MEMORY); the player may choose a lower one.

import { FORMATS, type GpuFormat, levelBytes } from './gl/formats.ts';
import type { ArrayKind, SpriteManifest } from './manifest.ts';

export type ResolutionMode = 'high' | 'normal' | 'low';
export const MODES: readonly ResolutionMode[] = ['high', 'normal', 'low'];

/**
 * The budgets (10 §6.13's table): High ≤ 256 MB (the slice's; the full game's is 768), Normal and Low ≤ 192 MB.
 * Everything the game allocates counts, not only the atlases.
 */
export const MODE_BUDGET_MB: Record<ResolutionMode, number> = { high: 256, normal: 192, low: 192 };

/** Levels a mode drops from the top of each array (colour: High 0, Normal 1, Low 2; shadows at most 1). */
export function levelOffset(kind: ArrayKind | 'terrain', mode: ResolutionMode, levels: number): number {
  const want = mode === 'high' ? 0 : mode === 'normal' ? 1 : 2;
  const cap = kind === 'shadow' ? 1 : kind === 'light' || kind === 'icon' ? 0 : want;
  return Math.max(0, Math.min(want, cap, levels - 1));
}

export interface ArrayAllocation {
  kind: ArrayKind | 'terrain' | 'chunks' | 'target' | 'buffer' | 'lut';
  name: string;
  format: string;
  size: number;
  levels: number;
  layers: number;
  bytes: number;
}

export interface Allocation {
  mode: ResolutionMode;
  items: ArrayAllocation[];
  atlasBytes: number;
  otherBytes: number;
  total: number;
}

/** The frame's render targets at w × h device px: the RGBA8 scene, the half-resolution R8 shadow mask and light. */
export function targetBytes(w: number, h: number, halfFloat: boolean): number {
  const hw = Math.ceil(w / 2);
  const hh = Math.ceil(h / 2);
  return w * h * 4 + hw * hh + hw * hh * (halfFloat ? 8 : 4);
}

/**
 * What the mode choice reserves for the sprite vertex buffers (the live accounting counts them as they are):
 * §6.12's late base at 0.3×, 100,000 quads of 80 bytes, in two alternating buffers.
 */
export const VERTEX_RESERVE_BYTES = 2 * 100_000 * 80;

/** The renderer's allocations besides the atlases at a viewport of w × h device px (10 §6.13's "other" row). */
export function otherAllocations(
  w: number,
  h: number,
  halfFloat: boolean,
  chunkLayers: number,
  sdfLayers: number,
): ArrayAllocation[] {
  const hw = Math.ceil(w / 2);
  const hh = Math.ceil(h / 2);
  return [
    {
      kind: 'target',
      name: 'scene (RGBA8)',
      format: 'rgba8',
      size: w,
      levels: 1,
      layers: 1,
      bytes: w * h * 4,
    },
    {
      kind: 'target',
      name: 'shadow (R8, half)',
      format: 'r8',
      size: hw,
      levels: 1,
      layers: 1,
      bytes: hw * hh,
    },
    {
      kind: 'target',
      name: `light (${halfFloat ? 'RGBA16F' : 'RGBA8'}, half)`,
      format: halfFloat ? 'rgba16f' : 'rgba8',
      size: hw,
      levels: 1,
      layers: 1,
      bytes: hw * hh * (halfFloat ? 8 : 4),
    },
    {
      kind: 'buffer',
      name: 'sprite vertex buffers (reserve: the late base at 0.3×)',
      format: 'f32',
      size: 0,
      levels: 1,
      layers: 1,
      bytes: VERTEX_RESERVE_BYTES,
    },
    {
      kind: 'buffer',
      name: 'quad index buffer',
      format: 'u32',
      size: 0,
      levels: 1,
      layers: 1,
      bytes: 65536 * 6 * 4,
    },
    {
      kind: 'lut',
      name: 'cyanotype LUT 32³',
      format: 'rgba8',
      size: 32,
      levels: 1,
      layers: 32,
      bytes: 32 * 32 * 32 * 4,
    },
    {
      kind: 'chunks',
      name: 'chunk tile ids (R8UI 38²)',
      format: 'r8ui',
      size: 38,
      levels: 1,
      layers: chunkLayers,
      bytes: 38 * 38 * chunkLayers,
    },
    {
      kind: 'chunks',
      name: 'chunk shore and woodland (RG8 152²)',
      format: 'rg8',
      size: 152,
      levels: 1,
      layers: sdfLayers,
      bytes: 152 * 152 * 2 * sdfLayers,
    },
  ];
}

/** The format an array is stored in: its codec decides the family, the probe the member. */
export function arrayFormat(codec: string, kind: ArrayKind, colour: GpuFormat, shadow: GpuFormat): GpuFormat {
  if (codec === 'rgba8') return kind === 'shadow' ? 'r8' : 'rgba8';
  return kind === 'shadow' ? shadow : colour;
}

/** What `mode` allocates for the manifest's arrays and terrain, plus `other`. */
export function allocationOf(
  m: SpriteManifest,
  colour: GpuFormat,
  shadow: GpuFormat,
  mode: ResolutionMode,
  other: ArrayAllocation[],
): Allocation {
  const items: ArrayAllocation[] = [];
  m.arrays.forEach((a, i) => {
    const layers = m.pages[i]?.length ?? 0;
    const f = arrayFormat(a.codec, a.kind, colour, shadow);
    const off = levelOffset(a.kind, mode, a.levels);
    const size = a.pageSize >> off;
    const levels = a.levels - off;
    let per = 0;
    for (let l = 0; l < levels; l++) per += levelBytes(f, Math.max(1, size >> l));
    items.push({ kind: a.kind, name: a.kind, format: f, size, levels, layers, bytes: per * layers });
  });
  const t = m.terrain;
  if (t) {
    const n = Object.keys(t.tiles).length;
    const f = t.codec === 'rgba8' ? 'rgba8' : colour;
    const off = levelOffset('terrain', mode, t.levels);
    const size = t.size >> off;
    let per = 0;
    for (let l = 0; l < t.levels - off; l++) per += levelBytes(f, Math.max(1, size >> l));
    items.push({
      kind: 'terrain',
      name: 'terrain materials',
      format: f,
      size,
      levels: t.levels - off,
      layers: n,
      bytes: per * n,
    });
  }
  const atlasBytes = items.reduce((s, x) => s + x.bytes, 0);
  const otherBytes = other.reduce((s, x) => s + x.bytes, 0);
  return { mode, items: [...items, ...other], atlasBytes, otherBytes, total: atlasBytes + otherBytes };
}

/** The highest mode whose allocation fits its budget (10 §6.13 "Choosing the mode"); Low when none does. */
export function chooseMode(
  m: SpriteManifest,
  colour: GpuFormat,
  shadow: GpuFormat,
  other: ArrayAllocation[],
  floor: ResolutionMode = 'high',
): Allocation {
  const start = MODES.indexOf(floor);
  for (let i = start; i < MODES.length; i++) {
    const a = allocationOf(m, colour, shadow, MODES[i] as ResolutionMode, other);
    if (a.total <= (MODE_BUDGET_MB[MODES[i] as ResolutionMode] as number) * 1024 * 1024) return a;
  }
  return allocationOf(m, colour, shadow, 'low', other);
}

export const MB = 1024 * 1024;
export const formatBytes = (f: string): number => (f in FORMATS ? FORMATS[f as GpuFormat].bytesPerTexel : 4);

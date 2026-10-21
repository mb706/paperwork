// The style constants (10 §15.7 "Named constants", IMPL-5): the art direction fills these in without changing any
// format. The values are *Survey*'s (design/art/DIRECTION.md §3–§5, §11; 10 §9.8–§9.9); another style is another
// table. The shaders read them as uniforms, so a change here needs no GLSL edit.

/** sRGB hex → [r, g, b] in 0–1 (display-encoded, as the pages hold them). */
export function hex(h: string): [number, number, number] {
  const v = Number.parseInt(h.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export const STYLE_NAME = 'survey-1';

/** The paper (A3 §3.1): the clear colour and the tone a missing terrain material falls back to. */
export const PAPER_TONE = hex('#ece3cb');
export const CLEAR_COLOUR = PAPER_TONE;
/** Ink, brown-black, never #000 (A3 §3.1). */
export const INK_COLOUR = hex('#2b2723');

/** 10 §5.7: the darkest the day gets; the night grade's strength is (1 − daylight) ÷ (1 − AMBIENT_FLOOR). */
export const AMBIENT_FLOOR = 0.15;

/**
 * SHADOW_COMPOSITE (A3 §4.2, 10 §9.8): world-anchored hatching at −45° through the MAX-blended shadow mask, period
 * 7/64 tile, line 1.7/64 tile, 55 % ink, plus a 6 % darkening; band-limited below 3 device px per period. The mask
 * is boosted ×1.4 (the half-resolution target is soft).
 */
export const SHADOW = {
  periodTiles: 7 / 64,
  widthTiles: 1.7 / 64,
  ink: 0.55,
  darken: 0.06,
  maskGain: 1.4,
} as const;

/** LIGHT_COMPOSITE_DAY (A3 §4.3): a warm watercolour stain, colour × (1 − 0.6 · a · (1 − hue)). */
export const LIGHT_DAY_STAIN = 0.6;

/**
 * NIGHT_GRADE (A3 §4.4, 10 §9.8): the cyanotype (Herschel, 1842). Paper goes to Prussian blue, ink to pale, 18 % of
 * the day colour stays; the light reveals the day colours (reveal = a · 1.6 · 1.4) and adds itself (× 0.9).
 */
export const CYANOTYPE_DEEP = hex('#13304f');
export const CYANOTYPE_PALE = hex('#d6e4ec');
export const NIGHT = {
  lumLow: 0.12,
  lumRange: 0.8,
  keep: 0.82,
  trace: 0.18,
  traceTint: [0.45, 0.55, 0.85] as const,
  reveal: 1.6 * 1.4,
  lightAdd: 0.9,
} as const;
/** The cyanotype LUT's size per axis (10 §9.8: 32³ RGBA8). */
export const CYANOTYPE_LUT_SIZE = 32;

/** Items on a belt and held items are drawn at half a tile (A3 §2). */
export const BELT_ITEM_SIZE = 0.5;

/** SHADOW_REACH (A3 §2): a cast shadow falls 1.43 × height east and 0.39 × height south (culling). */
export const SHADOW_REACH = { east: 1.43, south: 0.39 } as const;

/**
 * Terrain (10 §6.5, §9.9; A3 §11): soft edges warped by world-anchored value noise (0.32 tile amplitude on 1.6-tile
 * cells) and blended over 0.55 tile; crisp types keep exact edges with an inked kerb; water-lining at fixed
 * distances from the shore with an inked shoreline; the woodland tint under tree clusters.
 */
export const TERRAIN = {
  warpTiles: 0.32,
  warpCellTiles: 1.6,
  blendSigmaTiles: 0.55,
  /** The materials cover 8 × 8 tiles each (512² at 64 px per tile). */
  materialTiles: 8,
  kerb: hex('#3b332b'),
  kerbAlpha: 0.75,
  /** Lines parallel to the shore, tiles from it, each fading with its distance (1 − d ÷ 4). */
  lining: [0.12, 0.3, 0.52, 0.8, 1.15, 1.6, 2.2, 3.0] as const,
  liningInk: hex('#56809a'),
  liningAlpha: 0.75,
  /** The lining fades out below this many device px per tile (A3: "fades below 0.5×"). */
  liningMinScale: 16,
  shore: hex('#3f5f74'),
  shoreAlpha: 0.85,
  /** The shoreline's half-width in device px (the emulation's 1.6 − |d − 0.5|). */
  shorePx: 1.6,
  woodland: hex('#c9dca8'),
  woodlandAlpha: 0.3,
  woodlandRadiusTiles: 1.6,
  woodlandBlurTiles: 0.6,
  /**
   * The ground a resource deposit lies on (A3's mocks put every resource tile on dirt, `design/art/proto/layouts.py`):
   * resource tiles draw this tile type's material, blended into their neighbours like any soft boundary (C9).
   */
  depositTile: 'dirt',
} as const;

/** Tile types with crisp edges (10 §6.5): town streets and blocks, the concretes, the map's edge. */
export const CRISP_TILES: ReadonlySet<string> = new Set([
  'town-street',
  'town-block',
  'concrete',
  'refined-concrete',
  'hazard-concrete',
  'refined-hazard-concrete',
  'out-of-map',
]);
/** Water types: the shore distance and the lining are measured from them. */
export const WATER_TILES: ReadonlySet<string> = new Set(['water', 'deep-water']);

/**
 * A tile type the atlas has no material for (the fake sim's M1 tiles on the M0 art, or a page not yet resident)
 * draws a flat wash: a near material's grain with a tint, or the paper. The washes are A3 §3.1's; the base is a
 * material of the same family. `null` base means the paper grain of whatever water material exists.
 */
export const TILE_FALLBACK: Readonly<Record<string, { base: string | null; wash: string }>> = {
  'dry-dirt': { base: 'dirt', wash: '#e6d2ad' },
  'red-desert': { base: 'sand', wash: '#e8c9b0' },
  landfill: { base: 'dirt', wash: '#e9dcc0' },
  'rock-ground': { base: 'dirt', wash: '#dcd6cb' },
  'town-street': { base: null, wash: '#e8e2d2' },
  'town-block': { base: null, wash: '#ecd2c8' },
  concrete: { base: null, wash: '#ecd2c8' },
  'refined-concrete': { base: null, wash: '#ecd2c8' },
  'hazard-concrete': { base: null, wash: '#e6c8b6' },
  'refined-hazard-concrete': { base: null, wash: '#e6c8b6' },
  snow: { base: null, wash: '#eef1f2' },
  ice: { base: null, wash: '#d8e6ec' },
};

/** Smoke (A3 §8, 10 §9.8): three inked puffs per chimney of a working burner, drifting east, fading over 2 s. */
export const SMOKE = {
  puffs: 3,
  lifeTicks: 120,
  /** Drift over a puff's life, tiles: east and up. */
  driftEast: 0.9,
  rise: 1.1,
  /** Puff size at birth and at death, tiles. */
  sizeFrom: 0.35,
  sizeTo: 0.8,
  alpha: 0.8,
} as const;

/** The debug overlays' colours (F4/F5; dev only, never graded). */
export const DEBUG_COLOURS = {
  tileGrid: [0.17, 0.15, 0.14, 0.18],
  chunkGrid: [0.71, 0.21, 0.16, 0.85],
  collision: [0.31, 0.48, 0.24, 0.9],
  selection: [0.35, 0.5, 0.75, 0.9],
  position: [0.71, 0.21, 0.16, 1],
} as const;

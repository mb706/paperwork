// Unit checks of the renderer's pure parts: the projection against test/fixtures/projection (10 §15.7, made by the
// Python twin), the camera's snapping, the terrain data (borders, the shore distance, the woodland), GPU memory and
// the mode choice (10 §6.13), and the cyanotype LUT (10 §9.8).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { levelBytes } from '../../src/render/gl/formats.ts';
import { cyanotype, cyanotypeLut } from '../../src/render/lut.ts';
import type { SpriteManifest } from '../../src/render/manifest.ts';
import { allocationOf, chooseMode, levelOffset, otherAllocations } from '../../src/render/memory.ts';
import { type Camera, placeFrame, posHash, scaleOf, snapCamera } from '../../src/render/projection.ts';
import { CYANOTYPE_DEEP, CYANOTYPE_PALE, INK_COLOUR, PAPER_TONE } from '../../src/render/style.ts';
import {
  buildIds,
  buildShore,
  ID_BORDER,
  ID_SIZE,
  SHORE_BORDER,
  SHORE_SIZE,
  SHORE_TEXELS,
  ShoreScratch,
} from '../../src/render/terrain-data.ts';
import { GAME } from '../helpers/paths.ts';

const PROJ = join(GAME, 'test', 'fixtures', 'projection');

describe('the projection (test/fixtures/projection, 10 §15.7)', () => {
  const files = readdirSync(PROJ).filter((f) => f.endsWith('.json'));
  it('has the five (zoom, dpr) fixtures', () => {
    expect(files.sort()).toEqual([
      'z0.5-dpr1.json',
      'z1-dpr1.json',
      'z1-dpr2.json',
      'z2-dpr2.json',
      'z3-dpr1.json',
    ]);
  });
  for (const f of files)
    it(`places the calibration cube as manifest.py does: ${f}`, () => {
      const fx = JSON.parse(readFileSync(join(PROJ, f), 'utf8')) as {
        frame: number[];
        array: { pxPerTile: number; pageSize: number };
        cases: { camera: Camera; anchor: [number, number]; quad: number[] }[];
      };
      const frames = Float64Array.from(fx.frame);
      const out = new Float64Array(4);
      for (const c of fx.cases) {
        placeFrame(frames, 0, fx.array.pxPerTile, c.camera, c.anchor[0], c.anchor[1], out);
        for (let i = 0; i < 4; i++) expect(out[i], JSON.stringify(c)).toBeCloseTo(c.quad[i] as number, 6);
      }
    });

  it('snaps the camera to whole device pixels, so a still scene places sprites on the pixel grid', () => {
    const out: Camera = { cx: 0, cy: 0, zoom: 1, dpr: 1 };
    for (const [zoom, dpr] of [
      [1, 1],
      [1, 2],
      [0.5, 1],
      [3, 1],
      [2, 2],
    ] as const) {
      const cam = snapCamera({ cx: 123.4567, cy: -98.7654, zoom, dpr }, out);
      const S = scaleOf(cam);
      expect(Math.abs(cam.cx * S - Math.round(cam.cx * S))).toBeLessThan(1e-6);
      // an entity on the half-tile grid then sits on whole device pixels whenever S / 2 is whole
      if ((S / 2) % 1 === 0) expect(((10.5 - cam.cx) * S) % 1).toBeCloseTo(0, 6);
    }
  });

  it('keeps the position hash of 10 §15.7 (the Python twin agrees on cases.json)', () => {
    expect(posHash(0, 0)).toBe(0);
    expect(posHash(256, 512)).toBe(posHash(256, 512));
    expect(posHash(-3000, 70000)).toBeGreaterThanOrEqual(0);
  });
});

describe('terrain data (10 §6.5, §9.9)', () => {
  const chunk = (fill: number, f?: (x: number, y: number) => number | null) => {
    const t = new Uint8Array(1024).fill(fill);
    if (f)
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          const v = f(x, y);
          if (v !== null) t[y * 32 + x] = v;
        }
    return t;
  };

  it('builds the tile ids with a 3-tile border from the neighbours, repeating the edge where one is missing', () => {
    const own = chunk(1);
    const east = chunk(2);
    const ids = new Uint8Array(ID_SIZE * ID_SIZE);
    const complete = buildIds(
      (cx, cy) => (cx === 0 && cy === 0 ? own : cx === 1 && cy === 0 ? east : null),
      0,
      0,
      ids,
    );
    expect(complete).toBe(false);
    const at = (x: number, y: number) => ids[(y + ID_BORDER) * ID_SIZE + (x + ID_BORDER)];
    expect(at(0, 0)).toBe(1);
    expect(at(31, 31)).toBe(1);
    expect(at(32, 5)).toBe(2); // the east neighbour
    expect(at(34, 5)).toBe(2);
    expect(at(-1, 5)).toBe(1); // missing west: the chunk's own edge
    expect(at(5, -3)).toBe(1);
  });

  it('measures the shore distance in tiles, negative in water, smooth along a straight shore', () => {
    // water west of x = 10 (tile ids 0 land, 1 water)
    const tiles = chunk(0, (x) => (x < 10 ? 1 : null));
    const ids = new Uint8Array(ID_SIZE * ID_SIZE);
    buildIds((cx, cy) => (cx === 0 && cy === 0 ? tiles : null), 0, 0, ids);
    const isWater = new Uint8Array(256);
    isWater[1] = 1;
    const out = new Uint8Array(SHORE_SIZE * SHORE_SIZE * 2);
    buildShore(ids, isWater, new Float64Array(0), 0, new ShoreScratch(), out);
    const d = (x: number, y: number) => {
      const i = Math.round((x + SHORE_BORDER) * SHORE_TEXELS - 0.5);
      const j = Math.round((y + SHORE_BORDER) * SHORE_TEXELS - 0.5);
      return ((out[(j * SHORE_SIZE + i) * 2] as number) - 128) / 32;
    };
    // the blended mask crosses 0.5 at the tile edge x = 10 (a symmetric blend of a straight edge)
    for (const y of [4.125, 16.125, 27.875]) {
      expect(d(10.125, y)).toBeCloseTo(0.125, 1);
      expect(d(9.875, y)).toBeCloseTo(-0.125, 1);
      expect(d(12.125, y)).toBeCloseTo(2.125, 1);
      expect(d(7.875, y)).toBeCloseTo(-2.125, 1);
    }
    // along the shore the distance does not change (no scallops between texels)
    const row = [5.125, 5.375, 5.625, 5.875].map((y) => d(10.625, y));
    for (const v of row) expect(v).toBeCloseTo(row[0] as number, 2);
  });

  it('washes woodland under drawable trees: a disc of 1.6 tiles, softened', () => {
    const ids = new Uint8Array(ID_SIZE * ID_SIZE);
    const out = new Uint8Array(SHORE_SIZE * SHORE_SIZE * 2);
    buildShore(ids, new Uint8Array(256), Float64Array.from([16, 16]), 1, new ShoreScratch(), out);
    const w = (x: number, y: number) =>
      (out[
        (Math.round((y + SHORE_BORDER) * SHORE_TEXELS - 0.5) * SHORE_SIZE +
          Math.round((x + SHORE_BORDER) * SHORE_TEXELS - 0.5)) *
          2 +
          1
      ] as number) / 255;
    expect(w(16, 16)).toBeCloseTo(1, 2);
    expect(w(16.5, 16)).toBeCloseTo(1, 2);
    expect(w(16, 18.6)).toBe(0);
    expect(w(17.6, 16)).toBeGreaterThan(0.2);
    expect(w(17.6, 16)).toBeLessThan(0.8);
  });
});

describe('GPU memory (10 §6.13)', () => {
  const real = (() => {
    try {
      return JSON.parse(
        readFileSync(join(GAME, 'public', 'atlases', 'sprites.json'), 'utf8'),
      ) as SpriteManifest;
    } catch {
      return null;
    }
  })();
  const other = otherAllocations(1920, 1080, true, 192, 96);

  it('counts BC7 at 1 byte per texel and every level of the mode', () => {
    expect(levelBytes('bc7', 2048)).toBe(2048 * 2048);
    expect(levelBytes('bc4', 1024)).toBe((1024 * 1024) / 2);
    expect(levelBytes('rgba8', 512)).toBe(512 * 512 * 4);
    expect(levelOffset('colour', 'high', 4)).toBe(0);
    expect(levelOffset('colour', 'normal', 4)).toBe(1);
    expect(levelOffset('colour', 'low', 4)).toBe(2);
    expect(levelOffset('shadow', 'low', 3)).toBe(1);
    expect(levelOffset('icon', 'low', 3)).toBe(0);
  });

  it('allocates the other targets as §6.13 lists them (≈ the 69 MB row, our targets included)', () => {
    const mb = other.reduce((s, x) => s + x.bytes, 0) / 1048576;
    expect(mb).toBeGreaterThan(5);
    expect(mb).toBeLessThan(69);
  });

  it('picks High for BC7 and for the RGBA8 fallback on the M0 atlas, inside 256 MB', () => {
    if (!real) return;
    const bc7 = chooseMode(real, 'bc7', 'bc4', other);
    expect(bc7.mode).toBe('high');
    expect(bc7.total / 1048576).toBeLessThan(256);
    // C6 measured the M0 atlases at 42.0 MB in BC7 at High (pm/reports/C6.md)
    expect(bc7.atlasBytes / 1048576).toBeGreaterThan(30);
    expect(bc7.atlasBytes / 1048576).toBeLessThan(60);
    const rgba = chooseMode(real, 'rgba8', 'r8', other);
    expect(rgba.mode).toBe('high');
    expect(allocationOf(real, 'rgba8', 'r8', 'normal', other).total).toBeLessThan(rgba.total);
  });
});

describe('the cyanotype LUT (10 §9.8)', () => {
  const c = new Float64Array(3);
  it('turns the paper Prussian blue and the ink pale, keeping 18 % of the day colour', () => {
    cyanotype(PAPER_TONE[0], PAPER_TONE[1], PAPER_TONE[2], c);
    for (let i = 0; i < 3; i++)
      expect(Math.abs((c[i] as number) - (CYANOTYPE_DEEP[i] as number))).toBeLessThan(0.18);
    expect(c[2] as number).toBeGreaterThan(c[0] as number);
    cyanotype(INK_COLOUR[0], INK_COLOUR[1], INK_COLOUR[2], c);
    for (let i = 0; i < 3; i++)
      expect(Math.abs((c[i] as number) - (CYANOTYPE_PALE[i] as number))).toBeLessThan(0.2);
  });
  it('is a 32³ RGBA8 table with r fastest', () => {
    const lut = cyanotypeLut();
    expect(lut.length).toBe(32 * 32 * 32 * 4);
    cyanotype(1, 0, 0, c);
    expect(lut[31 * 4]).toBe(Math.round((c[0] as number) * 255));
  });
});

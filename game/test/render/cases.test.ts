// 10 §15.7 "Fixtures and versions": the renderer's drawing programs against test/fixtures/sprites/cases.json, whose
// expected draws the asset build computed with scripts/assets/manifest.py (the Python twin). Every case: the same
// parts in the same order, the same frames, quads, uvs, passes, alphas, fallbacks, and for the inserter's rotated
// parts the same pivots, points, turns, scales and stretches.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Atlas, type SpriteManifest } from '../../src/render/manifest.ts';
import {
  AT,
  drawEntity,
  drawIcon,
  drawInserter,
  drawMover,
  drawObject,
  drawResource,
  entityInput,
  iconFrame,
  inserterInput,
  moverInput,
  STREAM,
} from '../../src/render/programs.ts';
import type { Camera } from '../../src/render/projection.ts';
import { type RecordedDraw, Recorder } from './recorder.ts';

const DIR = join(import.meta.dirname, '..', 'fixtures', 'sprites');
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as SpriteManifest;
const cases = JSON.parse(readFileSync(join(DIR, 'cases.json'), 'utf8')) as {
  projection: { PX_PER_TILE: number; HEIGHT_SCALE: number };
  cases: {
    name: string;
    program: string;
    set: string;
    camera: Camera;
    input: Record<string, unknown>;
    expect: Record<string, unknown>[];
  }[];
};
const atlas = new Atlas(manifest);

/** greybox/<prototype>: the fixture's sets are named after the data's default, entity/<name>. */
const greyboxOf = (name: string) => atlas.set(`greybox/${name.split('/')[1]}`);

function run(c: (typeof cases.cases)[number]): RecordedDraw[] {
  const rec = new Recorder(atlas);
  const a = c.input;
  const cam = c.camera;
  const s = atlas.set(c.set);
  switch (c.program) {
    case 'entity': {
      const e = entityInput();
      e.x2 = a.x2 as number;
      e.y2 = a.y2 as number;
      e.dir = (a.dir as number) ?? 0;
      e.variant = (a.variant as number) ?? 0;
      e.status = (a.status as number) ?? 0;
      const dyn = a.dyn as { state: number; phase: number; light: number } | null;
      e.hasDyn = dyn !== null && dyn !== undefined;
      e.state = dyn?.state ?? 0;
      e.phase = dyn?.phase ?? 0;
      e.light = dyn?.light ?? 0;
      e.tick = (a.tick as number) ?? 0;
      e.beltSpeed = (a.beltSpeed as number) ?? 0;
      drawEntity(atlas, rec, cam, s, greyboxOf(c.set), e, STREAM.object);
      break;
    }
    case 'inserter': {
      const h = inserterInput();
      h.x2 = a.x2 as number;
      h.y2 = a.y2 as number;
      h.dir = a.dir as number;
      h.theta = a.theta as number;
      h.ext = a.ext as number;
      h.held = a.held as number;
      drawInserter(atlas, rec, cam, s, greyboxOf(c.set), h, STREAM.object);
      break;
    }
    case 'object':
      drawObject(atlas, rec, cam, s!, a.x as number, a.y as number, a.variant as number, STREAM.object);
      break;
    case 'resource':
      drawResource(atlas, rec, cam, s!, a.tx as number, a.ty as number, a.band as number);
      break;
    case 'mover': {
      const m = moverInput();
      m.x = a.x as number;
      m.y = a.y as number;
      m.vx = (a.vx as number) ?? 0;
      m.vy = (a.vy as number) ?? 0;
      m.flags = (a.flags as number) ?? 0;
      m.orientation = a.orientation as number;
      m.distance = (a.distance as number) ?? 0;
      m.seconds = (a.seconds as number) ?? 0;
      drawMover(atlas, rec, cam, s!, m, STREAM.object);
      break;
    }
    case 'icon': {
      const at = a.at as [number, number];
      const f = iconFrame(atlas, s) >= 0 ? iconFrame(atlas, s) : iconFrame(atlas, atlas.set('fx/missing'));
      AT[0] = at[0];
      AT[1] = at[1];
      AT[3] = (a.sizeTiles as number) ?? 0.5;
      drawIcon(atlas, rec, cam, f, STREAM.groundIcon);
      break;
    }
    default:
      throw new Error(c.program);
  }
  return rec.draws;
}

/** Rounds like manifest.py: quads 4 decimals, uvs 6, turns/scale/stretch/alpha 6, points 4. */
function normalise(d: RecordedDraw): Record<string, unknown> {
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
  const out: Record<string, unknown> = { part: d.part, frames: d.frames };
  if (d.part === 'held') {
    out.frames = undefined;
    out.item = d.item;
    out.at = d.at?.map(r4);
    out.size_tiles = d.size_tiles;
    return out;
  }
  if (d.pass !== undefined) {
    out.pass = d.pass;
    out.pivot = d.pivot;
    out.at = d.at?.map(r4);
    out.rotation_turns = r6(d.rotation_turns as number);
    out.scale = r6(d.scale as number);
    if (d.stretch !== undefined) out.stretch = r6(d.stretch);
  } else {
    out.quads = (d.quads ?? []).map((q) => q.map(r4));
    out.uvs = (d.uvs ?? []).map((q) => q.map(r6));
    out.passes = d.passes ?? [];
    if (d.alpha !== undefined) out.alpha = r6(d.alpha);
  }
  if (d.fallback !== undefined) out.fallback = d.fallback;
  return out;
}

function close(a: unknown, b: unknown, path: string): void {
  if (typeof a === 'number' && typeof b === 'number') {
    expect(Math.abs(a - b), `${path}: ${a} vs ${b}`).toBeLessThanOrEqual(2e-4);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    expect(a.length, `${path}.length`).toBe(b.length);
    for (const [i, x] of a.entries()) close(x, b[i], `${path}[${i}]`);
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
    const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
    expect(ka.sort(), `${path} keys`).toEqual(kb.sort());
    for (const k of ka)
      close((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    return;
  }
  expect(a, path).toEqual(b);
}

describe('test/fixtures/sprites/cases.json (10 §15.7)', () => {
  it('has the projection constants the renderer uses', () => {
    expect(cases.projection).toEqual({ PX_PER_TILE: 32, HEIGHT_SCALE: 1 });
    expect(cases.cases.length).toBeGreaterThanOrEqual(60);
  });
  for (const c of cases.cases)
    it(c.name, () => {
      const got = run(c).map(normalise);
      close(got, c.expect, c.name);
    });
});

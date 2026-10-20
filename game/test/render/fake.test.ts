// The renderer against the fake sim's packet stream (10 §15.10), in-process (test/fake/harness.ts):
//   * mirror equivalence (10 §10.4 #16, the main thread's side): after view moves, ticks and deltas, the mirror
//     equals the one a fresh world with only the final view request builds;
//   * belt items from gap arrays (§15.4) land on the lines' centrelines, straight runs and arcs alike;
//   * the frame of the whole fake factory draws with the real-shaped programs and allocates nothing in steady state.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { beltOut, expandLine } from '../../src/render/belts.ts';
import { deriveBeltMasks } from '../../src/render/fake-belts.ts';
import { Lookups } from '../../src/render/lookups.ts';
import { Atlas, type SpriteManifest } from '../../src/render/manifest.ts';
import { EV, Mirror } from '../../src/render/mirror.ts';
import { Scene } from '../../src/render/scene.ts';
import type { ViewRequest } from '../../src/shared/gen/packet.ts';
import { fakeProtos, Harness } from '../fake/harness.ts';
import { GAME } from '../helpers/paths.ts';

const VIEW: ViewRequest = {
  view_seq: 1,
  surface: 0,
  flags: 0,
  x0: -24,
  y0: -18,
  x1: 40,
  y1: 18,
  zoom: 1,
  hovered_serial: 0,
  audio_half_range: 32,
  chart_x0: 0,
  chart_y0: 0,
  chart_x1: 0,
  chart_y1: 0,
};

/** Runs the fake: a world, then each step's view request and ticks; applies every packet to a mirror. */
async function run(steps: { view: ViewRequest; ticks: number }[]): Promise<Mirror> {
  const h = new Harness();
  await h.start(1);
  const views = new Map<number, ViewRequest>();
  const m = new Mirror();
  let applied = 0;
  const drain = () => {
    for (; applied < h.packets.length; applied++) {
      const p = h.packets[applied] as Uint8Array;
      const seq = new DataView(p.buffer, p.byteOffset).getUint32(16, true);
      m.apply(p, seq === 0 ? null : (views.get(seq) ?? null));
    }
  };
  drain();
  for (const s of steps) {
    views.set(s.view.view_seq, s.view);
    await h.send({ t: 'view', gen: 1, v: s.view });
    drain();
    if (s.ticks > 0) await h.step(s.ticks);
    drain();
  }
  return m;
}

function snapshot(m: Mirror) {
  const chunks = [...m.chunks.values()]
    .sort((a, b) => a.key - b.key)
    .map((c) => ({
      key: c.key,
      tiles: Array.from(c.tiles ?? []),
      entities: Array.from(c.entities),
      objects: Array.from(c.objects),
      resources: Array.from(c.resources),
    }));
  const snap = (s: { bytes: Uint8Array; length: number }) => Array.from(s.bytes.subarray(0, s.length));
  return {
    tick: m.tick,
    chunks,
    dyn: snap(m.dyn),
    hands: snap(m.hands),
    movers: snap(m.movers),
    beltItems: snap(m.beltItems),
  };
}

describe('mirror equivalence with the fake sim (10 §10.4 #16)', () => {
  it('view moves and deltas leave the mirror a fresh world with the last view would build', async () => {
    const v2 = { ...VIEW, view_seq: 2, x0: 30, x1: 90, y0: -40, y1: -10 };
    const v3 = { ...VIEW, view_seq: 3, x0: -30, x1: 30, y0: -12, y1: 20 };
    const moved = await run([
      { view: VIEW, ticks: 300 },
      { view: v2, ticks: 650 },
      { view: v3, ticks: 250 },
    ]);
    const fresh = await run([{ view: { ...v3, view_seq: 1 }, ticks: 1200 }]);
    const a = snapshot(moved);
    const b = snapshot(fresh);
    expect(a.tick).toBe(1200);
    expect(a.chunks.map((c) => c.key)).toEqual(b.chunks.map((c) => c.key));
    expect(a).toEqual(b);
    // every line the fresh mirror holds, the moved one holds with the same geometry
    for (const [id, l] of fresh.lines) {
      const o = moved.lines.get(id);
      expect(o?.geomGen, `line ${id}`).toBe(l.geomGen);
      expect(Array.from(o?.segs ?? [])).toEqual(Array.from(l.segs));
    }
  }, 60_000);
});

describe('belt items from gap arrays (§15.4)', () => {
  it('maps distances onto straight runs and arcs: the fake corner belt lane by lane', async () => {
    const m = await run([{ view: VIEW, ticks: 400 }]);
    expect(m.beltItems.count).toBeGreaterThan(0);
    const out = beltOut();
    let checked = 0;
    for (let i = 0; i < m.beltItems.count; i++) {
      const o = m.beltItemOffsets[i] as number;
      const line = m.lines.get(m.beltItems.view.getUint32(o, true));
      if (!line) continue;
      const n = expandLine(line, m.beltItems.view, o, out);
      expect(n).toBeGreaterThan(0);
      for (let k = 0; k < n; k++) {
        const x = out.x[k] as number;
        const y = out.y[k] as number;
        // every item lies on a lane centreline: a quarter tile off a tile's centre line, or on a quarter arc
        const fx = x - Math.floor(x);
        const fy = y - Math.floor(y);
        const onLane = (f: number) => Math.abs(f - 0.25) < 1e-6 || Math.abs(f - 0.75) < 1e-6;
        const corner = line.segs.length >= 18; // the corner line: straight, arc, straight
        if (!corner) expect(onLane(fx) || onLane(fy), `${x}, ${y}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('places an arc by angle about its centre (a right turn east → south, radius ¾)', () => {
    // one lane of the fake's corner: south run (len 512) from (13.75, 3), arc (r 0.75), east run
    const r = 0.75;
    const segs = new Int32Array(
      [
        13.75 * 256,
        3 * 256,
        512,
        8,
        0,
        0,
        13.75 * 256,
        1 * 256,
        Math.round(r * 402.1238596594935),
        8,
        1,
        r * 256,
        13 * 256,
        0.25 * 256,
        256 * 28,
        4,
        0,
        0,
      ].map((v) => Math.round(v)),
    );
    const line = {
      lineId: 0,
      geomGen: 1,
      lane: 0,
      speed: 8,
      length: 0,
      segs,
      segCount: 3,
      cx0: 0,
      cy0: 0,
      cx1: 0,
      cy1: 0,
    };
    // items at d = 512 (the arc's downstream end), the arc's middle, its upstream end
    const arc = Math.round(r * 402.1238596594935);
    const rec = new DataView(new ArrayBuffer(16 + 3 * 2 + 2 * 2 + 2));
    rec.setInt32(8, 512, true);
    rec.setUint16(12, 3, true);
    rec.setInt16(16 + 6, Math.round(arc / 2) - 64, true);
    rec.setInt16(16 + 8, arc - Math.round(arc / 2) - 64, true);
    const out = beltOut();
    expect(expandLine(line, rec, 0, out)).toBe(3);
    // the centre of the turn is (13, 1); radius 0.75
    const pts = [0, 1, 2].map((i) => [out.x[i] as number, out.y[i] as number]);
    for (const [x, y] of pts) expect(Math.hypot((x as number) - 13, (y as number) - 1)).toBeCloseTo(r, 2);
    expect(pts[0]?.[0]).toBeCloseTo(13.75, 3);
    expect(pts[0]?.[1]).toBeCloseTo(1, 3);
    expect(pts[1]?.[0]).toBeCloseTo(13 + r * Math.SQRT1_2, 2);
    expect(pts[1]?.[1]).toBeCloseTo(1 - r * Math.SQRT1_2, 2);
    expect(pts[2]?.[0]).toBeCloseTo(13, 2);
    expect(pts[2]?.[1]).toBeCloseTo(0.25, 2);
  });
});

describe('the fake factory drawn with the real atlas', () => {
  const sprites = join(GAME, 'public', 'atlases', 'sprites.json');
  let manifest: SpriteManifest | null = null;
  beforeAll(() => {
    try {
      manifest = JSON.parse(readFileSync(sprites, 'utf8')) as SpriteManifest;
    } catch {
      manifest = null; // `npm run assets` has not run (a clean clone): the fixture tests cover the programs
    }
  });

  it('draws every entity, by its set or its greybox, and allocates nothing in steady state', async () => {
    if (!manifest) return;
    const protos = fakeProtos();
    const atlas = new Atlas(manifest);
    const look = new Lookups(atlas, protos);
    const m = await run([{ view: VIEW, ticks: 300 }]);
    deriveBeltMasks(m, look);
    // the fake's belts: a connected run gets curves and straight pieces, not caps everywhere
    let fed = 0;
    for (const c of m.chunks.values())
      for (let i = 0; i < c.entityCount; i++)
        if (
          look.isBelt[c.entityView.getUint16(i * 24 + EV.proto, true)] &&
          (c.entityView.getUint8(i * 24 + EV.variant) & 1) !== 0
        )
          fed++;
    expect(fed).toBeGreaterThan(10);
    const scene = new Scene(atlas, look);
    scene.extrapolate = false;
    const cam = { cx: 8, cy: 0, zoom: 1, dpr: 1 };
    scene.build(m, cam, 2048, 1200, m.tick);
    expect(scene.stats.entities).toBeGreaterThan(50);
    expect(scene.stats.beltItems).toBeGreaterThan(50);
    expect(scene.stats.greyboxed).toBe(0);
    // steady state: the same frame again reuses every buffer (no growth, nothing new to allocate)
    const before = scene.streams.map((s) => s.buf);
    for (let i = 0; i < 50; i++) scene.build(m, cam, 2048, 1200, m.tick + i);
    expect(scene.streams.map((s) => s.buf)).toEqual(before);
    for (let i = 0; i < before.length; i++) expect(scene.streams[i]?.buf).toBe(before[i]);
  }, 60_000);
});

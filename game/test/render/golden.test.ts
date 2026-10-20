// The renderer's side of the golden set (test/golden/README.md "Renderer (C4)"): decode packets/* and the
// packet-transitions trace's packets in order into the mirror, and draw them with the tiny atlas
// (test/fixtures/sprites) and the golden prototypes (sprite names) at 1× and 0.3×. Checks the retained state against
// the generated decoder's reading of the same bytes, the draw list against the projection formula, and the three
// rules: an entity that leaves a re-sent chunk's list is gone, a chunk that leaves the held set is dropped, an absent
// snapshot section (MOVERS) means none.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Lookups } from '../../src/render/lookups.ts';
import { Atlas, type SpriteManifest } from '../../src/render/manifest.ts';
import { chunkIdOfKey, EV, Mirror, MO, PacketError } from '../../src/render/mirror.ts';
import { STREAM } from '../../src/render/programs.ts';
import type { Camera } from '../../src/render/projection.ts';
import { Scene } from '../../src/render/scene.ts';
import { DecodeError } from '../../src/shared/gen/codec.ts';
import {
  chunkXY,
  decodePacket,
  heldChunks,
  type ViewRequest,
  ViewRequestCodec,
} from '../../src/shared/gen/packet.ts';
import type { PrototypesJson } from '../../src/shared/gen/protos.ts';
import { decodeAll } from '../helpers/packets.ts';
import { GAME } from '../helpers/paths.ts';
import { Recorder } from './recorder.ts';

const GOLDEN = join(GAME, 'test', 'golden', 'm0');
const SPRITES = join(GAME, 'test', 'fixtures', 'sprites');
const file = (p: string) => new Uint8Array(readFileSync(join(GOLDEN, p)));
const protos = JSON.parse(readFileSync(join(GOLDEN, 'protos', 'prototypes.json'), 'utf8')) as PrototypesJson;
const manifest = JSON.parse(readFileSync(join(SPRITES, 'manifest.json'), 'utf8')) as SpriteManifest;
const atlas = new Atlas(manifest);
const view = ViewRequestCodec.decode(file('view.bin'));
const FLOW = ['tick-0000-full', 'tick-0000', 'tick-0001', 'tick-0600'] as const;

/** The chunk records of a packet as the generated decoder reads them. */
function decodedChunks(bytes: Uint8Array) {
  const p = decodeAll(bytes);
  const get = (name: string) =>
    (p.sections.find((s) => s.name === name)?.records ?? []) as Record<string, unknown>[];
  return { p, get };
}

/** Builds the frame of `mirror` at `cam` on a w × h canvas with a recorder on the scene. */
function frame(mirror: Mirror, cam: Camera, w = 1280, h = 720) {
  const look = new Lookups(atlas, protos);
  const scene = new Scene(atlas, look);
  const rec = new Recorder(atlas);
  scene.tap = rec;
  scene.extrapolate = false;
  scene.build(mirror, cam, w, h, mirror.tick);
  return { scene, rec, look };
}

describe('the golden flow into the mirror (test/golden/m0/packets)', () => {
  const mirror = new Mirror();
  const states = new Map<string, { chunks: number; entities: number; movers: number; tick: number }>();
  for (const n of FLOW) {
    mirror.apply(file(`packets/${n}.bin`), n.endsWith('full') ? null : view);
    let entities = 0;
    for (const c of mirror.chunks.values()) entities += c.entityCount;
    states.set(n, { chunks: mirror.chunks.size, entities, movers: mirror.movers.count, tick: mirror.tick });
  }

  it('holds the view request held set: every chunk of it that exists', () => {
    const held = heldChunks(view);
    expect(held).not.toBeNull();
    // the 96 × 96 map is chunks −2…1; the held set x −1…2, y −2…1 holds 12 of them
    expect(states.get('tick-0000-full')).toEqual({ chunks: 0, entities: 0, movers: 0, tick: 0 });
    expect(states.get('tick-0000')).toMatchObject({ chunks: 12, entities: 2, movers: 1, tick: 0 });
    expect(states.get('tick-0001')?.chunks).toBe(12);
    expect(states.get('tick-0600')?.tick).toBe(600);
  });

  it('retains exactly what the generated decoder reads, chunk by chunk', () => {
    const m = new Mirror();
    for (const n of FLOW) {
      const bytes = file(`packets/${n}.bin`);
      m.apply(bytes, n.endsWith('full') ? null : view);
      const { get } = decodedChunks(bytes);
      for (const rec of get('CHUNK_ENTITIES')) {
        const c = m.chunks.get(chunkIdOfKey(rec.chunk_key as number));
        expect(c, `chunk ${chunkXY(rec.chunk_key as number)}`).toBeDefined();
        const list = rec.entities as { serial: number; x2: number; y2: number; proto: number; dir: number }[];
        expect(c?.entityCount).toBe(list.length);
        list.forEach((e, i) => {
          const v = c?.entityView as DataView;
          expect(v.getUint32(i * 24 + EV.serial, true)).toBe(e.serial);
          expect(v.getInt32(i * 24 + EV.x2, true)).toBe(e.x2);
          expect(v.getInt32(i * 24 + EV.y2, true)).toBe(e.y2);
          expect(v.getUint16(i * 24 + EV.proto, true)).toBe(e.proto);
        });
      }
      for (const rec of get('CHUNK_TILES')) {
        const c = m.chunks.get(chunkIdOfKey(rec.chunk_key as number));
        expect(Array.from(c?.tiles ?? [])).toEqual(rec.tiles);
      }
      for (const rec of get('CHUNK_RESOURCES'))
        expect(m.chunks.get(chunkIdOfKey(rec.chunk_key as number))?.resourceCount).toBe(
          (rec.resources as unknown[]).length,
        );
      const movers = get('MOVERS');
      expect(m.movers.count).toBe(movers.length);
      movers.forEach((mv, i) => {
        expect(m.movers.view.getUint32(i * 32 + MO.serial, true)).toBe(mv.serial);
        expect(m.movers.view.getInt32(i * 32 + MO.x, true)).toBe(mv.x);
      });
    }
  });

  for (const zoom of [1, 0.3])
    it(`draws the tick-600 world at ${zoom}× from the tiny atlas: chests, ore, the characters`, () => {
      const cam: Camera = { cx: (view.x0 + view.x1) / 2, cy: (view.y0 + view.y1) / 2, zoom, dpr: 1 };
      // a canvas over the whole held area (chunks −1…2 × −2…1), so nothing is culled and every record must draw
      const { rec, scene } = frame(mirror, cam, Math.ceil(260 * 32 * zoom), Math.ceil(260 * 32 * zoom));
      const S = 32 * zoom;
      // every chest of a held chunk inside the view (plus margin) draws entity/iron-chest's base and shadow
      const chests = rec.draws.filter((d) => d.set === 'entity/iron-chest' && d.part === 'base');
      let expected = 0;
      for (const c of mirror.chunks.values()) expected += c.entityCount;
      expect(chests.length).toBe(expected);
      for (const c of mirror.chunks.values())
        for (let i = 0; i < c.entityCount; i++) {
          const x = c.entityView.getInt32(i * 24 + EV.x2, true) / 2;
          const y = c.entityView.getInt32(i * 24 + EV.y2, true) / 2;
          const f = chests.find((d) => {
            const fr = atlas.frames;
            const fid = d.frames[0] as number;
            const k = S / (atlas.pxPerTile[fr[fid * 8] as number] as number);
            const q = d.quads?.[0] as number[];
            return (
              Math.abs((q[0] as number) - ((x - cam.cx) * S - (fr[fid * 8 + 6] as number) * k)) < 1e-6 &&
              Math.abs((q[1] as number) - ((y - cam.cy) * S - (fr[fid * 8 + 7] as number) * k)) < 1e-6
            );
          });
          expect(f, `the chest at ${x}, ${y}`).toBeDefined();
        }
      expect(rec.draws.filter((d) => d.set === 'entity/iron-chest' && d.part === 'shadow').length).toBe(
        expected,
      );
      // ore: one picture per resource tile in the drawn chunks, anchored at the tile's centre
      const ore = rec.draws.filter((d) => d.set === 'resource/iron-ore-patch' && d.part === 'base');
      let tiles = 0;
      for (const c of mirror.chunks.values()) tiles += c.resourceCount;
      expect(ore.length).toBe(tiles);
      // the characters: the idle clip (no velocity), on the object stream, with their shadows
      const chars = rec.draws.filter((d) => d.set === 'mover/character' && d.part === 'idle');
      expect(chars.length).toBe(mirror.movers.count);
      for (const d of chars) expect(d.streams).toEqual([STREAM.object]);
      expect(scene.stats.greyboxed).toBe(0);
      // nothing in the golden world is missing from the tiny atlas (the README's coverage rule)
      expect(new Lookups(atlas, protos).missing).toEqual([]);
    });

  it('sorts the objects by (bottom y, x, serial): later rows draw over earlier ones', () => {
    const cam: Camera = { cx: 40, cy: 0, zoom: 0.3, dpr: 1 };
    const { rec } = frame(mirror, cam);
    const objects = rec.draws.filter(
      (d) => d.streams[0] === STREAM.object && (d.part === 'base' || d.part === 'idle'),
    );
    const ys = objects.map((d) => {
      const q = d.quads?.[0] as number[];
      const fid = d.frames[0] as number;
      const k = (32 * 0.3) / (atlas.pxPerTile[atlas.frames[fid * 8] as number] as number);
      return (q[1] as number) + (atlas.frames[fid * 8 + 7] as number) * k; // the anchor's screen y
    });
    for (let i = 1; i < ys.length; i++)
      expect(ys[i] as number).toBeGreaterThanOrEqual((ys[i - 1] as number) - 16);
  });
});

interface Trace {
  traces: { name: string; calls: { call: string; in: string | null; out: string | null; note?: string }[] }[];
}

describe('the packet-transitions trace (abi/traces.json)', () => {
  const trace = (JSON.parse(readFileSync(join(GOLDEN, 'abi', 'traces.json'), 'utf8')) as Trace).traces.find(
    (t) => t.name === 'packet-transitions',
  );
  it('applies every packet in order with the view it answers, and keeps the retirement rules', () => {
    expect(trace).toBeDefined();
    const m = new Mirror();
    let first = true;
    let v: ViewRequest | null = null;
    const notes: { note: string; chunks: number; movers: number; serials: number[]; inHeld: boolean }[] = [];
    for (const c of trace?.calls ?? []) {
      if (c.call !== 'sim_extract' || !c.out) continue;
      if (c.in) v = ViewRequestCodec.decode(file(c.in));
      const bytes = file(c.out);
      decodePacket(bytes); // the generated decoder accepts what the mirror applies
      m.apply(bytes, first ? null : v);
      const serials: number[] = [];
      for (const ch of m.chunks.values())
        for (let i = 0; i < ch.entityCount; i++)
          serials.push(ch.entityView.getUint32(i * 24 + EV.serial, true));
      // every chunk the mirror holds lies in the held set of the view this packet answers
      const h = v === null || first ? null : heldChunks(v);
      let inHeld = true;
      for (const ch of m.chunks.values())
        if (h && (ch.cx < h.cx0 || ch.cx > h.cx1 || ch.cy < h.cy0 || ch.cy > h.cy1)) inHeld = false;
      notes.push({
        note: c.note ?? '',
        chunks: m.chunks.size,
        movers: m.movers.count,
        serials: serials.sort((a, b) => a - b),
        inHeld,
      });
      first = false;
    }
    const at = (s: string) => notes.find((n) => n.note.startsWith(s));
    const appears = at('chest C appears');
    const mined = at('chest C is mined');
    expect(appears && mined).toBeTruthy();
    // chest C is the serial that appears, then leaves its re-sent chunk's list
    const added = (appears?.serials ?? []).filter((s) => !(at('tick 0')?.serials ?? []).includes(s));
    expect(added.length).toBe(1);
    expect(mined?.serials).not.toContain(added[0]);
    for (const n of notes) expect(n.inHeld, n.note).toBe(true);
    // the view moves south-west: the chunks that leave its held set are dropped (x −2…0, y −1…1 of the map stay,
    // nine), and MOVERS is absent, which means none (no character stands in them)
    const away = at('the view leaves every held chunk');
    expect(away).toMatchObject({ chunks: 9, movers: 0 });
    // and comes back: every per-chunk record afresh
    const back = at('and comes back');
    expect(back?.chunks).toBeGreaterThan(0);
    expect(back?.movers).toBeGreaterThan(0);
  });
});

describe('the packet walker refuses what the generated decoder refuses', () => {
  const base = file('packets/tick-0000.bin');
  const cases: [string, (b: Uint8Array) => Uint8Array][] = [
    ['as it is', (b) => b],
    ['truncated', (b) => b.slice(0, b.length - 8)],
    ['bad magic', (b) => set(b, 0, 0x50)],
    ['bad version', (b) => set(b, 4, 9)],
    ['an unknown flag', (b) => set(b, 6, 0x80)],
    ['a directory entry of an unknown type', (b) => set(b, 32, 99)],
    ['an unsorted directory', (b) => swapEntries(b, 0, 1)],
    ['a misaligned section', (b) => setU32(b, 32 + 4, new DataView(b.buffer).getUint32(32 + 4, true) + 4)],
    ['a wrong record version', (b) => set(b, 32 + 2, 7)],
    ['a fixed section with a wrong count', (b) => setU32(b, 32 + 12, 11)],
  ];
  for (const [name, mutate] of cases)
    it(name, () => {
      const bytes = mutate(base.slice());
      let gen: unknown = null;
      let ours: unknown = null;
      try {
        decodePacket(bytes);
      } catch (e) {
        gen = e;
      }
      try {
        new Mirror().apply(bytes, view);
      } catch (e) {
        ours = e;
      }
      expect(ours === null, `${name}: the mirror ${ours ? 'refused' : 'accepted'} it`).toBe(gen === null);
      if (gen) expect(gen).toBeInstanceOf(DecodeError);
      if (ours) expect(ours).toBeInstanceOf(PacketError);
    });
});

function set(b: Uint8Array, at: number, v: number): Uint8Array {
  b[at] = v;
  return b;
}
function setU32(b: Uint8Array, at: number, v: number): Uint8Array {
  new DataView(b.buffer, b.byteOffset).setUint32(at, v, true);
  return b;
}
function swapEntries(b: Uint8Array, i: number, j: number): Uint8Array {
  const a = b.slice(32 + i * 16, 32 + i * 16 + 16);
  b.copyWithin(32 + i * 16, 32 + j * 16, 32 + j * 16 + 16);
  b.set(a, 32 + j * 16);
  return b;
}

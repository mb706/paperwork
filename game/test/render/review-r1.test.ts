// One test (or more) per finding of codex's C4-r1 review (pm/reviews/C4-r1.md), each failing on the reviewed code.
// GL-side findings run the renderer on a recording WebGL2 stub (gl-stub.ts); the browser-only one (11, odd
// backing heights) is in e2e/render.spec.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AssetLoader, type LoadedFile, type LoaderManifest } from '../../src/assets/loader.ts';
import type { AssetRequest, FromWorker, ToWorker } from '../../src/assets/worker/protocol.ts';
import {
  eastLine,
  entitiesSection,
  ev,
  objectsSection,
  packet,
  resourcesSection,
  type Section,
  tilesSection,
  viewOf,
} from '../../src/dev/scenes.ts';
import { beltOut, expandLine } from '../../src/render/belts.ts';
import { TerrainPass } from '../../src/render/gl/terrain.ts';
import { Lookups } from '../../src/render/lookups.ts';
import { Atlas, type SpriteManifest } from '../../src/render/manifest.ts';
import { Mirror } from '../../src/render/mirror.ts';
import { pick, selectionTable, turnBox } from '../../src/render/pick.ts';
import { AT, drawIcon, STREAM } from '../../src/render/programs.ts';
import type { Camera } from '../../src/render/projection.ts';
import { Renderer } from '../../src/render/renderer.ts';
import { Scene } from '../../src/render/scene.ts';
import { Writer } from '../../src/shared/gen/codec.ts';
import {
  BeltGeomCodec,
  BeltItemsCodec,
  PacketFlags,
  PacketSection,
  type ViewRequest,
} from '../../src/shared/gen/packet.ts';
import type { PrototypesJson } from '../../src/shared/gen/protos.ts';
import { GAME } from '../helpers/paths.ts';
import { glStub, STUB_CONST, stubCanvas } from './gl-stub.ts';
import { Recorder } from './recorder.ts';

const GOLDEN = join(GAME, 'test', 'golden', 'm0');
const SPRITES = join(GAME, 'test', 'fixtures', 'sprites');
/** A fresh copy of the tiny atlas's manifest (tests edit it). */
const tinyJson = () => JSON.parse(readFileSync(join(SPRITES, 'manifest.json'), 'utf8')) as SpriteManifest;
const goldenProtos = () =>
  JSON.parse(readFileSync(join(GOLDEN, 'protos', 'prototypes.json'), 'utf8')) as PrototypesJson;

/** The golden prototypes plus a transport belt, and the oak as a decorative too. */
function protosWithBelt(): PrototypesJson {
  const p = goldenProtos();
  const chest = p.entity.find((e) => e.name === 'iron-chest') as PrototypesJson['entity'][number];
  p.entity.push({ ...chest, name: 'transport-belt', type: 'belt', sprite: 'entity/transport-belt' });
  p.decoratives = ['object/tree-oak'];
  return p;
}

function mirrorOf(sections: Section[], view: ViewRequest): Mirror {
  const m = new Mirror();
  m.apply(packet(sections, 1, 1), view);
  return m;
}

function build(
  manifest: SpriteManifest,
  protos: PrototypesJson,
  mirror: Mirror,
  cam: Camera,
  w: number,
  h: number,
) {
  const atlas = new Atlas(manifest);
  const scene = new Scene(atlas, new Lookups(atlas, protos));
  const rec = new Recorder(atlas);
  scene.tap = rec;
  scene.extrapolate = false;
  scene.build(mirror, cam, w, h, mirror.tick);
  return { scene, rec, atlas };
}

describe('C4-r1 2: culling by conservative bounds, not by the anchor', () => {
  it('draws the shadow of an entity seven tiles west of the view that reaches 4.75 tiles into it', () => {
    const m = tinyJson();
    // the chest's shadow: 45 px of the 4-px-per-tile shadow array, 11.25 tiles east of its anchor (the big pole's
    // greybox shadow reaches as far)
    const f = m.frames.length;
    m.frames.push([1, 0, 0, 0, 45, 8, 0, 4]);
    (m.sets['entity/iron-chest'] as { parts: Record<string, { table: number[][] }> }).parts.shadow = {
      ...(m.sets['entity/iron-chest'] as { parts: Record<string, { table: number[][] }> }).parts.shadow,
      table: [[f]],
    } as never;
    const protos = goldenProtos();
    const chest = protos.entity.findIndex((e) => e.name === 'iron-chest');
    // 640 × 360 px at 1× around (0, 0): tiles −10 … 10 across; the chest at x = −16.5
    const mirror = mirrorOf(
      [tilesSection(-1, -1, 0, 0, () => 0), entitiesSection(-1, -1, 0, 0, [ev(2, chest, -33, 1)])],
      viewOf(-10, -6, 10, 6),
    );
    const { scene } = build(m, protos, mirror, { cx: 0, cy: 0, zoom: 1, dpr: 1 }, 640, 360);
    expect(scene.streams[STREAM.shadow]?.quads).toBe(1);
  });
});

describe('C4-r1 3: the ground sublayers in order across chunks', () => {
  it('draws decoratives, then resources, then floor entities, whatever chunk each is in', () => {
    const protos = protosWithBelt();
    const belt = protos.entity.findIndex((e) => e.name === 'transport-belt');
    const sections = [
      tilesSection(0, 0, 1, 0, () => 0),
      // a belt on tile (31, 5), in chunk 0; an ore tile at (32, 5) and a decorative at (33.5, 5.5), in chunk 1
      entitiesSection(0, 0, 1, 0, [ev(2, belt, 63, 11)]),
      resourcesSection(0, 0, 1, 0, [{ tx: 32, ty: 5, resource: 0, band: 0 }]),
      objectsSection(0, 0, 1, 0, [{ kind: 4, id: 0, x: 33 * 256 + 128, y: 5 * 256 + 128 }]),
    ];
    const mirror = mirrorOf(sections, viewOf(20, -5, 44, 15));
    const { rec } = build(tinyJson(), protos, mirror, { cx: 32, cy: 5, zoom: 1, dpr: 1 }, 1280, 720);
    const ground = rec.draws.filter((d) => d.streams.includes(STREAM.ground)).map((d) => d.set);
    expect(ground).toEqual(['object/tree-oak', 'resource/iron-ore-patch', 'entity/transport-belt']);
  });
});

describe('C4-r1 10: belt items expanded, culled and emitted in one pass', () => {
  it('places only the items near the view of a 400-tile line, exactly where expandLine puts them', () => {
    const protos = goldenProtos();
    const plate = protos.item.findIndex((i) => i.name === 'iron-plate') * 8;
    // one straight lane from x = −200 to 200 at y = 0.25: 1,600 items, every 64 positions (a quarter tile)
    const l = eastLine(0, -200, 200, 0.25, 8, [plate], 64);
    const geom = new Writer(1 << 12);
    const its = new Writer(1 << 14);
    BeltGeomCodec.write(geom, l.geom);
    BeltItemsCodec.write(its, l.items);
    const mirror = mirrorOf(
      [
        { type: PacketSection.belt_geom, count: 1, bytes: geom.finish() },
        { type: PacketSection.belt_items, count: 1, bytes: its.finish() },
      ],
      viewOf(-10, -6, 10, 6),
    );
    const cam: Camera = { cx: 0.3, cy: 0, zoom: 1, dpr: 1 };
    const { scene, rec, atlas } = build(tinyJson(), protos, mirror, cam, 640, 360);
    // what the reference expansion places within the view (and the icon's half size around it)
    const line = mirror.lines.get(0);
    if (line === undefined) throw new Error('no line');
    const out = beltOut(2048);
    const n = expandLine(line, mirror.beltItems.view, mirror.beltItemOffsets[0] as number, out);
    expect(n).toBe(1600);
    const want = new Recorder(atlas);
    const look = new Lookups(atlas, protos);
    // the view is x ∈ [cx − 10, cx + 10], y ∈ [−5.625, 5.625] tiles; items are chosen with their size around it
    const m = 0.5;
    for (let k = 0; k < n; k++) {
      const x = out.x[k] as number;
      const y = out.y[k] as number;
      if (x < cam.cx - 10 - m || x > cam.cx + 10 + m || y < -5.625 - m || y > 5.625 + m) continue;
      AT[0] = x;
      AT[1] = y;
      AT[3] = 0.5;
      drawIcon(atlas, want, cam, look.itemFrame(out.key[k] as number), STREAM.groundIcon);
    }
    const quads = (r: Recorder) =>
      r.draws.filter((d) => d.streams.includes(STREAM.groundIcon)).flatMap((d) => d.quads ?? []);
    expect(quads(rec)).toEqual(quads(want));
    expect(quads(rec).length).toBeGreaterThan(70);
    // and only those were placed, not the other 1,500
    expect(scene.stats.beltItemsPlaced).toBeLessThan(120);
  });
});

// ------------------------------------------------------------------------------------- the GL side, on the stub

const tile = (p: PrototypesJson, name: string) => p.tile.findIndex((t) => t.name === name);

function stubRenderer(manifest: SpriteManifest, protos: PrototypesJson, w = 960, h = 540) {
  const { gl, s } = glStub();
  const canvas = stubCanvas(gl, w, h);
  const r = Renderer.create({ canvas, atlas: new Atlas(manifest), protos }) as Renderer;
  return { r, s, gl, canvas };
}

/** Uploads to live textures of an internal format, as (texture id, layer) pairs. */
const uploadsOf = (s: ReturnType<typeof glStub>['s'], format: string) =>
  s.textures
    .filter((t) => t.internalFormat === STUB_CONST(format))
    .flatMap((t) => t.uploads.map((u) => `${t.id}:${u.z}`));

describe('C4-r1 1: terrain after a world replacement', () => {
  it('rebuilds the tile ids and shores of chunks whose coordinates the new world reuses', () => {
    const protos = goldenProtos();
    const { r, s } = stubRenderer(tinyJson(), protos);
    const view = viewOf(-8, -8, 8, 8);
    const grass = tile(protos, 'grass');
    const water = tile(protos, 'water');
    r.applyPacket(packet([tilesSection(-1, -1, 0, 0, () => grass)], 1, 1, PacketFlags.full), view);
    r.frame(16);
    const ids = uploadsOf(s, 'R8UI').length;
    expect(ids).toBeGreaterThan(0);
    expect(uploadsOf(s, 'RG8')).toEqual([]);
    // another world at the same coordinates: water where the grass was (its chunks' revisions start again)
    r.applyPacket(packet([tilesSection(-1, -1, 0, 0, () => water)], 1, 1, PacketFlags.full), view);
    r.frame(32);
    expect(uploadsOf(s, 'R8UI').length).toBeGreaterThan(ids);
    expect(uploadsOf(s, 'RG8').length).toBeGreaterThan(0);
  });
});

describe('C4-r1 7: terrain caches at wide views', () => {
  it('gives every visible chunk its tile ids and its shore when they outnumber the layers, and retries', () => {
    const protos = goldenProtos();
    const water = tile(protos, 'water');
    const { gl, s } = glStub();
    // caches of 4 tile-id layers and 2 shore layers; 3 × 3 chunks of water in view
    const pass = new TerrainPass(gl, protos.tile, new Map(), new Uint8Array(1), 4, 2);
    const mirror = mirrorOf([tilesSection(-1, -1, 1, 1, () => water)], viewOf(-40, -40, 72, 72));
    const rect = Float64Array.from([-32, -32, 64, 64]);
    const cam: Camera = { cx: 16, cy: 16, zoom: 0.3, dpr: 1 };
    for (let f = 0; f < 40; f++) pass.draw(mirror, cam, rect, 480, 270, 960, 540, null, 1000, () => 0);
    expect(pass.drawn).toBe(9);
    expect(pass.pending).toBe(0);
    // nine distinct shore layers were built (in whatever arrays the cache grew to)
    const live = s.live().filter((t) => t.internalFormat === STUB_CONST('RG8'));
    const layers = new Set(live.flatMap((t) => [...t.uploads.map((u) => u.z), ...t.copies.map((c) => c.z)]));
    expect(layers.size).toBeGreaterThanOrEqual(9);
  });
});

/** The tiny atlas with `pages` colour pages (copies of its one page). */
function manyPages(pages: number): SpriteManifest {
  const m = tinyJson();
  const page = m.pages[0]?.[0];
  if (!page) throw new Error('no colour page');
  m.pages[0] = Array.from({ length: pages }, () => ({ ...page }));
  return m;
}

const level = (size: number, bytes = 4) => ({
  width: size,
  height: size,
  data: new Uint8Array(size * size * bytes),
});

describe('C4-r1 5: allocation failures and the eviction safety net', () => {
  it('deletes every texture of a failed attempt before trying the next mode', () => {
    const { gl, s } = glStub();
    s.failStorage.set(2, STUB_CONST('OUT_OF_MEMORY'));
    const r = Renderer.create({
      canvas: stubCanvas(gl),
      atlas: new Atlas(tinyJson()),
      protos: goldenProtos(),
    });
    expect(r).not.toBeNull();
    // the attempt's first array and the failed one are gone; nothing live lacks its storage
    expect(s.count('deleteTexture')).toBeGreaterThanOrEqual(2);
    expect(s.live().filter((t) => t.target === STUB_CONST('TEXTURE_2D_ARRAY') && t.depth === 0)).toEqual([]);
  });

  it('treats any allocation error as a failure, not only OUT_OF_MEMORY', () => {
    const { gl, s } = glStub();
    s.failStorage.set(1, STUB_CONST('INVALID_VALUE'));
    const r = Renderer.create({
      canvas: stubCanvas(gl),
      atlas: new Atlas(tinyJson()),
      protos: goldenProtos(),
    });
    expect(r?.memory().mode).not.toBe('high');
    expect(s.live().filter((t) => t.target === STUB_CONST('TEXTURE_2D_ARRAY') && t.depth === 0)).toEqual([]);
  });

  it('shares fewer layers than pages, least recently used, when even Low does not fit', () => {
    const { gl, s } = glStub();
    // a GPU that fits at most two colour layers
    s.failWhen = (target, _l, w, _h, d) => target === STUB_CONST('TEXTURE_2D_ARRAY') && w >= 256 && d > 2;
    const r = Renderer.create({
      canvas: stubCanvas(gl),
      atlas: new Atlas(manyPages(6)),
      protos: goldenProtos(),
    }) as Renderer;
    expect(r).not.toBeNull();
    expect(r.memory().mode).toBe('low');
    const t = r.textures;
    if (!t) throw new Error('no textures');
    expect(t.arrays[0]?.layers).toBe(2);
    const up = (page: number) =>
      r.enqueuePage({ array: 0, layer: page, format: 'rgba8', firstLevel: 1, levels: [level(256)] });
    // frames until the uploads are in (2 ms of uploads per frame: a loaded machine takes more than one)
    let now = 0;
    const drain = () => {
      for (let i = 0; i < 20 && (i === 0 || r.pending() > 0); i++) {
        now += 16;
        r.frame(now);
      }
    };
    up(0);
    up(1);
    drain();
    expect([t.resident(0, 0), t.resident(0, 1)]).toEqual([true, true]);
    up(2);
    drain();
    // page 0 was used least recently: it gave its layer to page 2
    expect([t.resident(0, 0), t.resident(0, 1), t.resident(0, 2)]).toEqual([false, true, true]);
  });
});

describe('C4-r1 8: GPU accounting', () => {
  it('counts the sprite vertex buffers, and the targets at their current size', () => {
    const protos = goldenProtos();
    const chest = protos.entity.findIndex((e) => e.name === 'iron-chest');
    const { r, canvas } = stubRenderer(tinyJson(), protos);
    const before = r.memory().totalMb;
    // 2,000 chests in view: 4,000 sprite quads (base and shadow), 80 bytes each, in two alternating buffers
    const list = Array.from({ length: 2000 }, (_, i) =>
      ev(i + 1, chest, 2 * ((i % 50) - 25) + 1, 2 * (Math.floor(i / 50) - 20) + 1),
    );
    r.applyPacket(packet([entitiesSection(-1, -1, 0, 0, list)], 1, 1), viewOf(-30, -30, 30, 30));
    r.camera.zoom = 0.3;
    r.frame(16);
    r.frame(32);
    const buffers = r.memory().totalMb - before;
    expect(buffers).toBeGreaterThanOrEqual((2 * 4000 * 80) / 1048576 - 0.01);
    // a larger window: the scene and half targets grow with it
    Object.assign(canvas, { clientWidth: 1920, clientHeight: 1080 });
    r.frame(48);
    const grown = r.memory().totalMb - before - buffers;
    expect(grown).toBeGreaterThan(((1920 * 1080 - 960 * 540) * 4 * 1.25) / 1048576);
  });
});

describe('C4-r1 8: the budget before a resize allocates', () => {
  it('steps the atlases down a mode when a larger window would exceed the budget, and renegotiates', () => {
    const { gl } = glStub();
    const canvas = stubCanvas(gl, 960, 540);
    let renegotiated = 0;
    const r = Renderer.create({
      canvas,
      atlas: new Atlas(tinyJson()),
      protos: goldenProtos(),
      onRestored: () => renegotiated++,
    }) as Renderer;
    r.frame(16);
    expect(r.memory().mode).toBe('high');
    // 7,000 × 7,000 device px of targets (6.25 bytes per px: 306 MB) do not fit High's 256 MB
    Object.assign(canvas, { clientWidth: 7000, clientHeight: 7000 });
    r.frame(32);
    expect(r.memory().mode).not.toBe('high');
    expect(renegotiated).toBeGreaterThan(0);
  });
});

describe('C4-r1 9: the LOD clamp of every layer', () => {
  it('shares layers when the atlas has more pages than the GPU allows', () => {
    const { gl } = glStub({ maxArrayLayers: 8 });
    const r = Renderer.create({
      canvas: stubCanvas(gl),
      atlas: new Atlas(manyPages(12)),
      protos: goldenProtos(),
    });
    expect(r?.textures?.arrays[0]).toMatchObject({ pages: 12, layers: 8 });
    expect(r?.textures?.evicting).toBe(true);
  });

  it('tracks and uploads the clamp of layers above 63', () => {
    const { r, s } = stubRenderer(manyPages(70), goldenProtos());
    // level 0 of page 64 arrives: its layer samples level 0 from now on
    r.enqueuePage({ array: 0, layer: 64, format: 'rgba8', firstLevel: 0, levels: [level(512)] });
    r.frame(16);
    const lod = s.textures.flatMap((t) =>
      t.uploads.filter((u) => u.x === 64 && u.width === 1 && u.data?.[0] === 0),
    );
    expect(lod.length).toBe(1);
  });
});

describe('C4-r1 10: no clock read in a steady frame', () => {
  it('draws without performance.now() while the timings are off', () => {
    const { r } = stubRenderer(tinyJson(), goldenProtos());
    r.frame(16);
    r.frame(32);
    const spy = vi.spyOn(performance, 'now');
    r.frame(48);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ------------------------------------------------------------------------------------------- the asset loader

class FakeWorker extends EventTarget {
  readonly sent: ToWorker[] = [];
  postMessage(m: ToWorker): void {
    this.sent.push(m);
  }
  answer(m: FromWorker): void {
    this.dispatchEvent(new MessageEvent('message', { data: m }));
  }
  wanted(): AssetRequest[] {
    return this.sent.flatMap((m) => (m.t === 'want' ? m.reqs : []));
  }
}

function loaderOf(offsets: number[], extra: Partial<ConstructorParameters<typeof AssetLoader>[0]> = {}) {
  const w = new FakeWorker();
  const files: LoadedFile[] = [];
  const loader = new AssetLoader({
    worker: w as unknown as Worker,
    manifest: tinyJson() as unknown as LoaderManifest,
    base: 'http://x/',
    colour: 'rgba8',
    shadow: 'r8',
    levelOffset: offsets,
    terrainOffset: 0,
    terrainTiles: [],
    onFile: (f) => files.push(f),
    ...extra,
  });
  return { w, files, loader };
}

const fileOf = (r: AssetRequest, epoch = r.epoch ?? 0): FromWorker =>
  ({
    t: 'file',
    id: r.id,
    epoch,
    format: 'rgba8',
    levels: [{ width: 4, height: 4, data: new ArrayBuffer(64) }],
    fromLevel: r.fromLevel,
    bytes: 10,
    fetchMs: 1,
    transcodeMs: 1,
  }) as FromWorker;
const retryOf = (r: AssetRequest, attempt: number): FromWorker =>
  ({ t: 'retry', id: r.id, epoch: r.epoch ?? 0, attempt, error: 'HTTP 404', delayMs: 1000 }) as FromWorker;
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('C4-r1 4: readiness and the core error', () => {
  it('rejects readiness after the fourth failure of a core file, says so, and retries on request', async () => {
    const errors: string[] = [];
    const { w, loader } = loaderOf([0, 0, 0, 0], { onCoreError: (m: string) => errors.push(m) } as never);
    loader.start();
    const reqs = w.wanted();
    const shadow = reqs.find((r) => r.url === 'shadow-core-0.ktx2') as AssetRequest;
    for (const r of reqs) if (r !== shadow) w.answer(fileOf(r));
    let outcome = 'waiting';
    loader.ready().then(
      () => {
        outcome = 'ready';
      },
      () => {
        outcome = 'failed';
      },
    );
    for (let a = 1; a <= 3; a++) w.answer(retryOf(shadow, a));
    await settle();
    expect(outcome).toBe('waiting');
    w.answer(retryOf(shadow, 4));
    await settle();
    expect(outcome).toBe('failed');
    expect(errors.length).toBe(1);
    // Retry asks again at once, and a delivery then makes the core ready
    w.sent.length = 0;
    (loader as unknown as { retry(): void }).retry();
    expect(w.sent.some((m) => m.t === 'retry' && (m as { ids: number[] }).ids.includes(shadow.id))).toBe(
      true,
    );
    let again = false;
    void loader.ready().then(() => {
      again = true;
    });
    w.answer(fileOf(shadow));
    await settle();
    expect(again).toBe(true);
  });

  it('is settled with an optional file that failed: it retries in the background with its placeholder', async () => {
    const { w, loader } = loaderOf([0, 0, 0, 0]);
    loader.start();
    for (const r of w.wanted()) w.answer(fileOf(r));
    // High level 0 of a drawn page, which fails
    w.sent.length = 0;
    loader.update([], [0]);
    const h = w.wanted()[0] as AssetRequest;
    expect(h.level0).toBe(true);
    expect((loader as unknown as { settled(): boolean }).settled()).toBe(false);
    w.answer(retryOf(h, 1));
    await settle();
    expect((loader as unknown as { settled(): boolean }).settled()).toBe(true);
  });
});

describe('C4-r1 6: an upload epoch per allocation', () => {
  it('asks for every page again with the new levels after a reallocation, and drops older replies', async () => {
    // first allocated at a mode that skips the colour page's level 1 (and the shadow's level 0)
    const { w, files, loader } = loaderOf([2, 1, 0, 0]);
    loader.start();
    const first = w.wanted();
    expect(first.find((r) => r.url === 'colour-core-0.n.ktx2')?.fromLevel).toBe(1);
    for (const r of first) w.answer(fileOf(r));
    const delivered = files.length;
    // the context came back and High allocated: every level, every page, a new epoch
    w.sent.length = 0;
    (loader as unknown as { reconfigure(c: object): void }).reconfigure({
      colour: 'rgba8',
      shadow: 'r8',
      levelOffset: [0, 0, 0, 0],
      terrainOffset: 0,
    });
    expect(w.sent[0]).toMatchObject({ t: 'init' });
    const again = w.wanted();
    expect(again.map((r) => r.url).sort()).toEqual(first.map((r) => r.url).sort());
    const colour = again.find((r) => r.url === 'colour-core-0.n.ktx2') as AssetRequest;
    expect(colour.fromLevel).toBe(0);
    // a file of the old allocation arriving late is not handed to the renderer; the new one is
    w.answer(fileOf(colour, (colour.epoch ?? 0) - 1));
    await settle();
    expect(files.length).toBe(delivered);
    w.answer(fileOf(colour));
    await settle();
    expect(files.length).toBe(delivered + 1);
    expect(files.at(-1)?.firstLevel).toBe(1);
  });
});

describe('C4-r1 5: an evicted page is fetched again', () => {
  it('asks again for a page that gave its layer away once it is drawn', async () => {
    const { w, loader } = loaderOf([0, 0, 0, 0]);
    loader.start();
    for (const r of w.wanted()) w.answer(fileOf(r));
    w.sent.length = 0;
    (loader as unknown as { evicted(a: number, p: number): void }).evicted(1, 0);
    loader.update([1 << 16], []);
    expect(w.wanted().map((r) => r.url)).toEqual(['shadow-core-0.ktx2']);
  });
});

// ------------------------------------------------------------------------------------------- the UI's boundary

describe('C4-r1 12: picking for the UI (src/shared/world-view.ts)', () => {
  it('picks by selection box and priority, turned boxes, then resources, then tiles; null outside the world', () => {
    const protos = goldenProtos();
    const chest = protos.entity.findIndex((e) => e.name === 'iron-chest');
    // a long, low-priority entity under the chest, and a 1 × 3 one turned east
    const base = protos.entity[chest] as PrototypesJson['entity'][number];
    protos.entity.push({ ...base, name: 'pad', selectionBox: [-2, -0.5, 2, 0.5], selectionPriority: 10 });
    protos.entity.push({
      ...base,
      name: 'long',
      selectionBox: [-0.5, -1.5, 0.5, 1.5],
      selectionPriority: 50,
    });
    const pad = protos.entity.length - 2;
    const long = protos.entity.length - 1;
    const mirror = mirrorOf(
      [
        tilesSection(0, 0, 0, 0, () => 0),
        entitiesSection(0, 0, 0, 0, [ev(2, chest, 9, 9), ev(3, pad, 9, 9), ev(4, long, 21, 9, 4)]),
        resourcesSection(0, 0, 0, 0, [{ tx: 6, ty: 6, resource: 0, band: 2 }]),
      ],
      viewOf(-8, -8, 40, 40),
    );
    const sel = selectionTable(protos);
    // the chest (priority 50) over the pad (10) where both are
    expect(pick(mirror, sel, 4.6, 4.4)).toMatchObject({ kind: 'entity', serial: 2 });
    // the pad alone a tile and a half away
    expect(pick(mirror, sel, 6.2, 4.4)).toMatchObject({ kind: 'entity', serial: 3 });
    // turned east, the 1 × 3 box lies along x
    expect(turnBox(-0.5, -1.5, 0.5, 1.5, 4)).toEqual([-1.5, -0.5, 1.5, 0.5]);
    expect(pick(mirror, sel, 11.9, 4.6)).toMatchObject({ kind: 'entity', serial: 4 });
    expect(pick(mirror, sel, 10.5, 5.6)).toMatchObject({ kind: 'tile', tx: 10, ty: 5 });
    // a resource tile, a bare tile, and no world
    expect(pick(mirror, sel, 6.5, 6.5)).toMatchObject({ kind: 'resource', tx: 6, ty: 6, band: 2 });
    expect(pick(mirror, sel, 20.5, 20.5)).toEqual({ kind: 'tile', tx: 20, ty: 20 });
    expect(pick(mirror, sel, 100, 100)).toBeNull();
  });
});

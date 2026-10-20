// Scenes for the renderer's gallery (src/dev/gallery.html): render packets written with the generated codecs, so
// the renderer draws them exactly as it draws the sim's.
//   * survey: C6's preview scene (scripts/assets/preview.py) on the fake's M1 prototypes, which have the M0 art's
//     keypunch, belt and inserters: a pond with water-lining, a dirt patch, the iron-ore patch, a belt loop with
//     items, chests, a working keypunch whose firebox is lit (DYN.light 255) beside an idle one, inserters at four
//     poses, greyboxes, characters in each clip, the map's edge. Day or night.
//   * bench: §6.12's scenes, sized by count: entities on a grid (chests, greyboxes, keypunches) and belt lines full of
//     items, for the main thread's frame cost.

import { Writer } from '../shared/gen/codec.ts';
import {
  BeltGeomCodec,
  BeltItemsCodec,
  ChunkEntitiesCodec,
  ChunkResourcesCodec,
  ChunkTilesCodec,
  chunkKey,
  DynCodec,
  type EntityView,
  InserterHandCodec,
  MoverCodec,
  PacketSection,
  PacketWriter,
  type ViewRequest,
} from '../shared/gen/packet.ts';
import type { PrototypesJson } from '../shared/gen/protos.ts';

const T = (protos: PrototypesJson, name: string) => protos.tile.findIndex((t) => t.name === name);
const E = (protos: PrototypesJson, name: string) => {
  const i = protos.entity.findIndex((e) => e.name === name);
  if (i < 0) throw new Error(`no entity ${name} in ${protos.build}`);
  return i;
};
const I = (protos: PrototypesJson, name: string) => protos.item.findIndex((t) => t.name === name) * 8;

interface Section {
  type: number;
  count: number;
  bytes: Uint8Array;
}

/** A packet from sections (ascending type), as `sim_extract` writes them. */
export function packet(sections: Section[], tick: number, daylight: number): Uint8Array {
  const w = new Writer(1 << 16);
  const sorted = [...sections].sort((a, b) => a.type - b.type);
  const p = new PacketWriter(w, sorted.length, tick, 0, Math.round(daylight * 65535));
  for (const s of sorted) {
    p.section(s.type);
    w.bytes(s.bytes);
    p.end(s.count);
  }
  p.finish();
  return w.finish();
}

/** A view request for the tile rectangle [x0, x1) × [y0, y1). */
export function viewOf(x0: number, y0: number, x1: number, y1: number, seq = 1): ViewRequest {
  return {
    view_seq: seq,
    surface: 0,
    flags: 0,
    x0,
    y0,
    x1,
    y1,
    zoom: 1,
    hovered_serial: 0,
    audio_half_range: 32,
    chart_x0: 0,
    chart_y0: 0,
    chart_x1: 0,
    chart_y1: 0,
  };
}

function ev(
  serial: number,
  proto: number,
  x2: number,
  y2: number,
  dir = 0,
  variant = 0,
  flags = 0,
): EntityView {
  return { serial, x2, y2, proto, alt_icon: 0xffff, dir, flip: 0, quality: 0, variant, status: 0, flags };
}

/** Chunk tiles for chunks cx0…cx1 × cy0…cy1 from `tileAt(x, y)`. */
function tilesSection(
  cx0: number,
  cy0: number,
  cx1: number,
  cy1: number,
  tileAt: (x: number, y: number) => number,
): Section {
  const w = new Writer(1 << 14);
  let n = 0;
  for (let cy = cy0; cy <= cy1; cy++)
    for (let cx = cx0; cx <= cx1; cx++) {
      const tiles: number[] = [];
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) tiles.push(tileAt(cx * 32 + x, cy * 32 + y));
      ChunkTilesCodec.write(w, { chunk_key: chunkKey(cx, cy), surface: 0, flags: 0, version: 1, tiles });
      n++;
    }
  return { type: PacketSection.chunk_tiles, count: n, bytes: w.finish() };
}

/** Entities grouped into their chunks' records (every chunk of the rectangle, empty ones too). */
function entitiesSection(cx0: number, cy0: number, cx1: number, cy1: number, list: EntityView[]): Section {
  const w = new Writer(1 << 14);
  let n = 0;
  for (let cy = cy0; cy <= cy1; cy++)
    for (let cx = cx0; cx <= cx1; cx++) {
      const mine = list
        .filter((e) => e.x2 >> 6 === cx && e.y2 >> 6 === cy)
        .sort((a, b) => a.serial - b.serial);
      ChunkEntitiesCodec.write(w, { chunk_key: chunkKey(cx, cy), surface: 0, version: 1, entities: mine });
      n++;
    }
  return { type: PacketSection.chunk_entities, count: n, bytes: w.finish() };
}

function resourcesSection(
  cx0: number,
  cy0: number,
  cx1: number,
  cy1: number,
  list: { tx: number; ty: number; resource: number; band: number }[],
): Section {
  const w = new Writer(1 << 12);
  let n = 0;
  for (let cy = cy0; cy <= cy1; cy++)
    for (let cx = cx0; cx <= cx1; cx++) {
      const mine = list
        .filter((r) => r.tx >> 5 === cx && r.ty >> 5 === cy)
        .map((r) => ({ tile: (r.ty - cy * 32) * 32 + (r.tx - cx * 32), resource: r.resource, band: r.band }))
        .sort((a, b) => a.tile - b.tile);
      ChunkResourcesCodec.write(w, { chunk_key: chunkKey(cx, cy), surface: 0, version: 1, resources: mine });
      n++;
    }
  return { type: PacketSection.chunk_resources, count: n, bytes: w.finish() };
}

/** A straight lane from (x0, y) east to (x1, y) (tiles, its centreline), items every `every` positions. */
function eastLine(
  id: number,
  x0: number,
  x1: number,
  y: number,
  speed: number,
  keys: number[],
  every: number,
) {
  const length = Math.round((x1 - x0) * 256);
  const geom = {
    line_id: id,
    geom_gen: id + 1,
    lane: id & 1,
    speed,
    length,
    segments: [{ x: Math.round(x1 * 256), y: Math.round(y * 256), len: length, dir: 4, turn: 0, radius: 0 }],
  };
  const n = Math.max(0, Math.floor((length - 32) / every) + 1);
  const itemKeys = Array.from({ length: n }, (_, i) => keys[i % keys.length] as number);
  const items = {
    line_id: id,
    geom_gen: id + 1,
    front_gap: 32,
    keys: itemKeys,
    gaps: Array.from({ length: Math.max(0, n - 1) }, () => every - 64),
  };
  return { geom, items };
}

/** C6's preview scene (scripts/assets/preview.py), drawn by the renderer: see the module comment. */
export function surveyScene(
  protos: PrototypesJson,
  night: boolean,
): { packet: Uint8Array; view: ViewRequest; centre: [number, number] } {
  const grass = T(protos, 'grass');
  const dirt = T(protos, 'dirt');
  const water = T(protos, 'water');
  const deep = T(protos, 'deep-water');
  const sand = T(protos, 'sand');
  const oom = T(protos, 'out-of-map');
  const tileAt = (tx: number, ty: number) => {
    const x = tx + 0.5;
    const y = ty + 0.5;
    if (x > 12) return oom;
    let t = grass;
    if ((x + 9.5) ** 2 / 26 + (y - 3.5) ** 2 / 12 < 1) t = dirt;
    if ((x + 11) ** 2 / 16 + (y + 5) ** 2 / 9 < 1) t = water;
    if ((x + 11.5) ** 2 / 5 + (y + 5.5) ** 2 / 3 < 1) t = deep;
    if ((x + 11) ** 2 / 26 + (y + 5) ** 2 / 17 < 1 && t === grass) t = sand;
    return t;
  };
  const [cx0, cy0, cx1, cy1] = [-1, -1, 0, 0];
  const sections: Section[] = [tilesSection(cx0, cy0, cx1, cy1, tileAt)];
  // the iron-ore patch: bands fall off from its centre
  const ore = protos.resource.findIndex((r) => r.name === 'iron-ore-patch');
  const res: { tx: number; ty: number; resource: number; band: number }[] = [];
  for (let ty = 1; ty < 7; ty++)
    for (let tx = -13; tx < -5; tx++) {
      const d = Math.hypot((tx + 9.5) / 3.6, (ty - 3.5) / 2.2);
      if (d < 1)
        res.push({ tx, ty, resource: ore, band: Math.max(0, Math.min(7, Math.round(7 * (1.15 - d)))) });
    }
  let serial = 10;
  const ents: EntityView[] = [];
  const add = (name: string, x2: number, y2: number, dir = 0, variant = 0, flags = 0) => {
    const e = ev(serial++, E(protos, name), x2, y2, dir, variant, flags);
    ents.push(e);
    return e;
  };
  // a belt loop: east along y = 0, a curve north, back west along y = −2 ending in a cap (preview.py's masks)
  const [Ea, Na, Wa] = [4, 0, 12];
  const cells: [number, number, number, number][] = [];
  for (let x = -3; x < 3; x++) cells.push([x, 0, Ea, x > -3 ? 1 | 8 : 8]);
  cells.push([3, 0, Na, 2 | 8], [3, -1, Na, 1 | 8], [3, -2, Wa, 4 | 8]);
  for (let x = 2; x > -3; x--) cells.push([x, -2, Wa, 1 | (x > -2 ? 8 : 0)]);
  for (const [x, y, d, mask] of cells) add('transport-belt', 2 * x + 1, 2 * y + 1, d, mask);
  add('iron-chest', -1, -7);
  add('iron-chest', 1, -7);
  add('wooden-chest', 3, -7); // a set the M0 art lacks: its greybox
  const kp1 = add('keypunch', 14, -8, 8);
  const kp2 = add('keypunch', 20, -8, 8);
  const ins = [
    add('inserter', -1, -5, 0),
    add('inserter', 3, -5, 0),
    add('burner-inserter', 11, -1, 4),
    add('inserter', 15, -1, 8),
  ];
  // greyboxes of a few entities in a row (preview.py), facing south
  let gx = -12;
  for (const name of [
    'assembling-machine-1',
    'stone-furnace',
    'offshore-pump',
    'small-electric-pole',
    'steam-engine',
  ]) {
    const p = protos.entity[E(protos, name)];
    const [w, h] = (p?.size ?? [1, 1]) as [number, number];
    add(name, 2 * gx + w, 12 + h, 8);
    gx += w + 1;
  }
  sections.push(entitiesSection(cx0, cy0, cx1, cy1, ents));
  sections.push(resourcesSection(cx0, cy0, cx1, cy1, res));
  // DYN: the working keypunch lit, the idle one dark
  const dyn = new Writer();
  for (const [e, state, light] of [
    [kp1, 1, 255],
    [kp2, 0, 0],
  ] as const)
    DynCodec.write(dyn, {
      x2: e.x2,
      y2: e.y2,
      serial: e.serial,
      proto: e.proto,
      phase: state === 1 ? 20000 : 0,
      dir: e.dir,
      state,
      light,
      quality: 0,
    });
  sections.push({ type: PacketSection.dyn, count: 2, bytes: dyn.finish() });
  // HANDS: four poses (preview.py)
  const plate = I(protos, 'iron-plate');
  const oreItem = I(protos, 'iron-ore');
  const hands = new Writer();
  const poses: [number, number, number][] = [
    [0, 1, plate],
    [0.5, 1, 0xffff],
    [0.25, 0.9, oreItem],
    [0.375, 1.1, 0xffff],
  ];
  ins.forEach((e, i) => {
    const [theta, ext, held] = poses[i] as [number, number, number];
    InserterHandCodec.write(hands, {
      x2: e.x2,
      y2: e.y2,
      serial: e.serial,
      proto: e.proto,
      held,
      theta: Math.round(theta * 65536) & 0xffff,
      ext: Math.round(ext * 4096),
      dir: e.dir,
      held_count: held === 0xffff ? 0 : 1,
    });
  });
  sections.push({ type: PacketSection.hands, count: ins.length, bytes: hands.finish() });
  // items on the east run's two lanes (y = 0.25 and 0.75)
  const l0 = eastLine(0, -3, 3, 0.25, 8, [oreItem, oreItem, plate], 80);
  const l1 = eastLine(1, -3, 3, 0.75, 8, [plate], 96);
  const geom = new Writer();
  BeltGeomCodec.write(geom, l0.geom);
  BeltGeomCodec.write(geom, l1.geom);
  sections.push({ type: PacketSection.belt_geom, count: 2, bytes: geom.finish() });
  const items = new Writer();
  BeltItemsCodec.write(items, l0.items);
  BeltItemsCodec.write(items, l1.items);
  sections.push({ type: PacketSection.belt_items, count: 2, bytes: items.finish() });
  // characters in each clip
  const character = protos.entity.findIndex((e) => e.type === 'character');
  const movers = new Writer();
  const chars: [number, number, number, number, number][] = [
    [-3.5, -3.5, 4, 0, 0],
    [8.5, 2.5, 2, 1, 0],
    [-6.5, 3.4, 6, 0, 1],
    [2.5, 3.5, 3, 1, 0],
    [10.5, -1.5, 0, 0, 0],
  ];
  chars.forEach(([x, y, o, run, mine], i) => {
    MoverCodec.write(movers, {
      serial: 900 + i,
      proto: character,
      kind: 0,
      flags: mine,
      x: Math.round(x * 256),
      y: Math.round(y * 256),
      vx: run ? 8 : 0,
      vy: 0,
      base_tick: 600,
      orientation: o * 8192,
      aux: i,
    });
  });
  sections.push({ type: PacketSection.movers, count: chars.length, bytes: movers.finish() });
  return {
    packet: packet(sections, 600, night ? 0 : 1),
    view: viewOf(-24, -14, 18, 14),
    centre: [0.5, -0.5],
  };
}

/**
 * §6.12's frame-cost scenes, a dense factory in a view of w × h tiles: rows of 1×1 entities (iron chests, inserters
 * at rest, greybox poles) alternating with rows of belts carrying compressed items (4 per lane per tile), up to
 * `entities` entities and `items` belt items. The frame's quad count is in the renderer's stats.
 */
export function benchScene(
  protos: PrototypesJson,
  entities: number,
  items: number,
  w: number,
  h: number,
): { packet: Uint8Array; view: ViewRequest } {
  const grass = T(protos, 'grass');
  const x0 = -Math.ceil(w / 2);
  const y0 = -Math.ceil(h / 2);
  const x1 = x0 + w;
  const y1 = y0 + h;
  const cx0 = x0 >> 5;
  const cy0 = y0 >> 5;
  const cx1 = (x1 - 1) >> 5;
  const cy1 = (y1 - 1) >> 5;
  const sections: Section[] = [tilesSection(cx0, cy0, cx1, cy1, () => grass)];
  const kinds = [
    E(protos, 'iron-chest'),
    E(protos, 'inserter'),
    E(protos, 'iron-chest'),
    E(protos, 'small-electric-pole'),
  ];
  const belt = E(protos, 'transport-belt');
  const ents: EntityView[] = [];
  const plate = I(protos, 'iron-plate');
  const geom = new Writer();
  const its = new Writer();
  let lines = 0;
  let placed = 0;
  let itemsLeft = items;
  let serial = 10;
  for (let ty = y0; ty < y1; ty++) {
    const beltRow = (ty - y0) % 2 === 1;
    if (!beltRow) {
      for (let tx = x0; tx < x1 && placed < entities; tx++) {
        ents.push(ev(serial++, kinds[placed % kinds.length] as number, 2 * tx + 1, 2 * ty + 1, 4));
        placed++;
      }
      continue;
    }
    if (itemsLeft <= 0 && placed >= entities) continue;
    for (let tx = x0; tx < x1; tx++)
      ents.push(ev(serial++, belt, 2 * tx + 1, 2 * ty + 1, 4, tx === x0 ? 8 : 9));
    for (const lane of [0.25, 0.75]) {
      if (itemsLeft <= 0) break;
      const n = Math.min(itemsLeft, (x1 - x0) * 4);
      const l = eastLine(lines, x0, x1, ty + lane, 8, [plate], 64);
      l.items.keys = l.items.keys.slice(0, n);
      l.items.gaps = l.items.gaps.slice(0, Math.max(0, n - 1));
      BeltGeomCodec.write(geom, l.geom);
      BeltItemsCodec.write(its, l.items);
      itemsLeft -= l.items.keys.length;
      lines++;
    }
  }
  sections.push(entitiesSection(cx0, cy0, cx1, cy1, ents));
  if (lines > 0) {
    sections.push({ type: PacketSection.belt_geom, count: lines, bytes: geom.finish() });
    sections.push({ type: PacketSection.belt_items, count: lines, bytes: its.finish() });
  }
  return { packet: packet(sections, 600, 1), view: viewOf(x0, y0, x1, y1) };
}

/** One iron chest at tile (0, 0) on grass (the golden prototypes): the pixel-exact placement check. */
export function singleScene(
  protos: PrototypesJson,
  night: boolean,
): { packet: Uint8Array; view: ViewRequest } {
  const grass = T(protos, 'grass');
  const sections: Section[] = [
    tilesSection(-1, -1, 0, 0, () => grass),
    entitiesSection(-1, -1, 0, 0, [ev(2, E(protos, 'iron-chest'), 1, 1)]),
  ];
  return { packet: packet(sections, 1, night ? 0 : 1), view: viewOf(-8, -8, 8, 8) };
}

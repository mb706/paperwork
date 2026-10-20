// A debug picture of the fake sim's packet stream (not a renderer: a check that the geometry it sends is
// coherent). Applies the packets to a mirror as §3.4 says and draws tiles by map colour, entities as boxes,
// resources, trees, belt items walked along BELT_GEOM's segments, inserter hands and movers.
//   node test/fake/snapshot.ts <out.png> [ticks]
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { readEvents } from '../../src/shared/gen/events.ts';
import type {
  BeltGeom,
  BeltItems,
  ChunkEntities,
  ChunkObjects,
  ChunkResources,
  ChunkTiles,
  InserterHand,
  Mover,
  ViewRequest,
} from '../../src/shared/gen/packet.ts';
import { decodeAll } from '../helpers/packets.ts';
import { fakeProtos, Harness } from './harness.ts';

const PX = 12;
const VIEW: ViewRequest = {
  view_seq: 1,
  surface: 0,
  flags: 1 << 3,
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

export async function snapshot(out: string, ticks: number): Promise<void> {
  const protos = fakeProtos();
  const h = new Harness(protos);
  await h.start();
  await h.send({ t: 'view', gen: 1, v: VIEW });
  await h.act(1, { type: 'start_walking', input_gen: 0, dir: 6 });
  for (let t = 0; t < ticks; t += 60) await h.step(60);
  const tiles = new Map<number, ChunkTiles>();
  const ents = new Map<number, ChunkEntities>();
  const objs = new Map<number, ChunkObjects>();
  const ress = new Map<number, ChunkResources>();
  const geoms = new Map<string, BeltGeom>();
  let snap: Record<string, unknown[]> = {};
  let events = 0;
  for (const bytes of h.packets) {
    const p = decodeAll(bytes);
    snap = {};
    for (const s of p.sections) {
      for (const r of s.records) {
        if (s.name === 'CHUNK_TILES') tiles.set((r as ChunkTiles).chunk_key, r as ChunkTiles);
        else if (s.name === 'CHUNK_ENTITIES') ents.set((r as ChunkEntities).chunk_key, r as ChunkEntities);
        else if (s.name === 'CHUNK_OBJECTS') objs.set((r as ChunkObjects).chunk_key, r as ChunkObjects);
        else if (s.name === 'CHUNK_RESOURCES') ress.set((r as ChunkResources).chunk_key, r as ChunkResources);
        else if (s.name === 'BELT_GEOM')
          geoms.set(`${(r as BeltGeom).line_id}/${(r as BeltGeom).geom_gen}`, r as BeltGeom);
        else if (s.name === 'BELT_RETIRE')
          geoms.delete(`${(r as { line_id: number }).line_id}/${(r as { geom_gen: number }).geom_gen}`);
      }
      if (s.name === 'EVENTS') events += s.records.length;
      snap[s.name] = s.records;
    }
  }
  void readEvents;
  const W = (VIEW.x1 - VIEW.x0) * PX;
  const H = (VIEW.y1 - VIEW.y0) * PX;
  const png = new PNG({ width: W, height: H });
  const put = (x: number, y: number, c: number[]) => {
    const px = Math.round((x - VIEW.x0) * PX);
    const py = Math.round((y - VIEW.y0) * PX);
    if (px < 0 || py < 0 || px >= W || py >= H) return;
    png.data.set([c[0] as number, c[1] as number, c[2] as number, 255], (py * W + px) * 4);
  };
  const rect = (x0: number, y0: number, x1: number, y1: number, c: number[]) => {
    for (let y = y0; y < y1; y += 1 / PX) for (let x = x0; x < x1; x += 1 / PX) put(x, y, c);
  };
  const dot = (x: number, y: number, r: number, c: number[]) => rect(x - r, y - r, x + r, y + r, c);
  const hex = (s: string) => [
    Number.parseInt(s.slice(1, 3), 16),
    Number.parseInt(s.slice(3, 5), 16),
    Number.parseInt(s.slice(5, 7), 16),
  ];
  for (const c of tiles.values()) {
    const cx = (c.chunk_key >>> 16) - 32768;
    const cy = (c.chunk_key & 0xffff) - 32768;
    c.tiles.forEach((t, i) => {
      const x = cx * 32 + (i % 32);
      const y = cy * 32 + Math.floor(i / 32);
      rect(x, y, x + 1, y + 1, hex(protos.tile[t]?.mapColor ?? '#ff00ff'));
    });
  }
  for (const c of ress.values()) {
    const cx = (c.chunk_key >>> 16) - 32768;
    const cy = (c.chunk_key & 0xffff) - 32768;
    for (const r of c.resources)
      dot(
        cx * 32 + (r.tile % 32) + 0.5,
        cy * 32 + Math.floor(r.tile / 32) + 0.5,
        0.15 + (7 - r.band) * 0.03,
        [60 + r.resource * 40, 60, 140],
      );
  }
  for (const c of objs.values())
    for (const o of c.objects)
      dot(
        o.x / 256,
        o.y / 256,
        o.kind === 0 ? 0.3 : 0.45,
        o.kind === 0 ? [30, 90 + o.variant * 25, 30] : [110, 100, 90],
      );
  for (const c of ents.values())
    for (const e of c.entities) {
      const proto = protos.entity[e.proto] as { collisionBox: number[]; type: string };
      const [a, b, cc, d] = proto.collisionBox as [number, number, number, number];
      const col =
        e.flags & 1
          ? [120, 160, 230]
          : e.flags & 2
            ? [230, 100, 100]
            : proto.type === 'belt'
              ? [200, 180, 60]
              : proto.type === 'inserter'
                ? [220, 140, 40]
                : [90, 80, 70];
      rect(e.x2 / 2 + a, e.y2 / 2 + b, e.x2 / 2 + cc, e.y2 / 2 + d, col);
    }
  // Belt items: walk each line's segments from the downstream end (§15.4).
  for (const it of (snap.BELT_ITEMS ?? []) as BeltItems[]) {
    const g = geoms.get(`${it.line_id}/${it.geom_gen}`);
    if (!g) continue;
    let d = it.front_gap;
    it.keys.forEach((_, i) => {
      if (i > 0) d += 64 + (it.gaps[i - 1] as number);
      let left = d;
      for (const s of g.segments) {
        if (left > s.len) {
          left -= s.len;
          continue;
        }
        const [dx, dy] = s.dir === 0 ? [0, -1] : s.dir === 4 ? [1, 0] : s.dir === 8 ? [0, 1] : [-1, 0];
        const ex = s.x / 256;
        const ey = s.y / 256;
        if (s.turn === 0) dot(ex - dx * (left / 256), ey - dy * (left / 256), 0.14, [240, 240, 240]);
        else {
          const r = s.radius / 256;
          const cxa = ex + r * (s.turn > 0 ? -dy : dy);
          const cya = ey + r * (s.turn > 0 ? dx : -dx);
          const ang = -(s.turn * (left / 256)) / r;
          const vx = ex - cxa;
          const vy = ey - cya;
          dot(
            cxa + vx * Math.cos(ang) - vy * Math.sin(ang),
            cya + vx * Math.sin(ang) + vy * Math.cos(ang),
            0.14,
            [255, 255, 255],
          );
        }
        break;
      }
    });
  }
  for (const hd of (snap.HANDS ?? []) as InserterHand[]) {
    const th = (hd.theta / 65536) * 2 * Math.PI;
    const r = hd.ext / 4096;
    dot(
      hd.x2 / 2 + r * Math.sin(th),
      hd.y2 / 2 - r * Math.cos(th),
      0.12,
      hd.held === 0xffff ? [40, 40, 40] : [255, 60, 60],
    );
  }
  for (const m of (snap.MOVERS ?? []) as Mover[])
    dot(m.x / 256, m.y / 256, 0.35, m.aux === 0 ? [255, 0, 200] : [0, 200, 255]);
  writeFileSync(out, PNG.sync.write(png));
  console.log(
    `snapshot at tick ${h.sim.tick}: ${h.packets.length} packets, ${events} events, sections of the last: ${Object.keys(snap).join(' ')}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`)
  await snapshot(process.argv[2] ?? 'fake.png', Number(process.argv[3] ?? 600));

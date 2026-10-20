// `?sim=fake` on the placeholder page (10 §15.10): boots the fake sim worker on the dev server's fake prototype
// build, plays the main thread's part of §3.2 and §3.4 (a state generation, the view and the subscriptions after
// the FULL packet, acks), decodes every packet with the generated decoder and shows what arrives. WASD walks the
// character. The renderer, UI and audio packages replace this page; `window.__fake` drives it in tests
// (`step(n)` in `?test=1`, `act(action)`, `status()`).
import { NewWorldCodec } from '../shared/gen/abi.ts';
import { type Action, actionBytes } from '../shared/gen/actions.ts';
import { Reader } from '../shared/gen/codec.ts';
import { ChunkEntitiesCodec, decodePacket, PacketFlags, type ViewRequest } from '../shared/gen/packet.ts';
import { ProjectionKind, readUiRecords, type SubRequest } from '../shared/gen/projections.ts';
import type { MainToSim, SimToMain } from '../shared/protocol.ts';

type Show = (id: string, text: string) => void;

interface FakeStatus {
  tick: number;
  packets: number;
  bytes: number;
  sections: string[];
  /** The projection kinds with an `ok` record so far (projections.yaml names). */
  projections: string[];
  errors: string[];
}

declare global {
  interface Window {
    __fake?: { step(n: number): void; act(a: Action): void; status(): FakeStatus };
  }
}

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

const GEN = 1;

/** The view: the factory east of the spawn point, audio on, the hover on the iron chest of the gear line. */
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

const sub = (sub_id: number, kind: number, target: number, p0 = 0, p1 = 0, p2 = 0): SubRequest => ({
  sub_id,
  kind,
  flags: 0,
  target,
  p0,
  p1,
  p2,
  p3: 0,
});
/**
 * The M0 projections without a target (CHARACTER of player 0, HUD, STATS at precision 1 with series, DEBUG),
 * and one outside M0's manifest (RESEARCH: status 2, unsupported). INVENTORY, ENTITY_PANEL and the hover follow
 * once the first CHUNK_ENTITIES names a chest and an assembler.
 */
const SUBS: SubRequest[] = [sub(1, 2, 0), sub(2, 1, 0), sub(3, 7, 0, 1, 0, 1), sub(4, 10, 0), sub(5, 6, 0)];
const KIND_NAMES = new Map(
  Object.entries(ProjectionKind).map(([name, id]) => [id as number, name.toUpperCase()]),
);

export async function runFake(show: Show): Promise<void> {
  const test = new URLSearchParams(location.search).get('test') === '1';
  const [manifest, protos] = await Promise.all([
    json<{ build: string; buildHash: string; dev: boolean }>('/data/fake/build-manifest.json'),
    json<{ build: string; entity: { type: string }[]; item: unknown[] }>('/data/fake/prototypes.json'),
  ]);
  show('build-status', `${manifest.build} (fake sim's build) · ${manifest.buildHash.slice(0, 12)}`);
  show('data-status', `${protos.build}: ${protos.item.length} items, ${protos.entity.length} entities`);
  const worker = new Worker(new URL('./workers/fake-sim.ts', import.meta.url), {
    type: 'module',
    name: 'sim',
  });
  const send = (m: MainToSim, transfer: Transferable[] = []) => worker.postMessage(m, { transfer });
  const status: FakeStatus = { tick: 0, packets: 0, bytes: 0, sections: [], projections: [], errors: [] };
  const seen = new Set<string>();
  const kinds = new Set<string>();
  let targeted = false;
  let seq = 0;
  const act = (a: Action) => {
    const bytes = actionBytes(a);
    seq += 1;
    send({ t: 'act', gen: GEN, firstSeq: seq, actions: bytes.buffer as ArrayBuffer }, [
      bytes.buffer as ArrayBuffer,
    ]);
  };
  worker.addEventListener('message', (e: MessageEvent<SimToMain>) => {
    const m = e.data;
    if (m.t === 'ready') {
      if (test) send({ t: 'seq', op: 'pause' });
      send({ t: 'world', gen: GEN, op: 'new', settings: { ...NewWorldCodec.defaults(), seed: 1945 } });
    } else if (m.t === 'pkt') {
      const len = new DataView(m.buf).getUint32(24, true);
      try {
        const p = decodePacket(new Uint8Array(m.buf, 0, len));
        if (p.header.state_gen === GEN) {
          status.packets += 1;
          status.bytes += len;
          status.tick = p.header.tick;
          for (const s of p.sections) {
            seen.add(s.name);
            if (s.name === 'UI')
              for (const r of readUiRecords(s.bytes, s.count))
                if (r.status === 0) kinds.add(KIND_NAMES.get(r.kind) ?? String(r.kind));
            if (s.name === 'CHUNK_ENTITIES' && !targeted) targeted = target(s.bytes, s.count);
          }
          status.sections = [...seen].sort();
          status.projections = [...kinds].sort();
          // The new generation's first packet: (re)send the view and every subscription (§3.4 step 3).
          if ((p.header.flags & PacketFlags.full) !== 0) {
            targeted = false;
            send({ t: 'view', gen: GEN, v: VIEW });
            send({ t: 'sub', gen: GEN, subs: SUBS });
          }
        }
      } catch (err) {
        status.errors.push(String(err));
        console.error('fake sim packet', err);
      }
      send({ t: 'ack', buf: m.buf }, [m.buf]);
      show(
        'sim-status',
        `fake sim · tick ${status.tick} · ${status.packets} packets · ${status.sections.join(' ')}`,
      );
    } else if (m.t === 'log') {
      (m.level === 'error' ? console.error : m.level === 'warn' ? console.warn : console.info)(m.msg);
    }
  });
  // A chest to hover and open (INVENTORY, main inventory p0 = 2) and an assembler's panel.
  const target = (bytes: Uint8Array, count: number): boolean => {
    const r = new Reader(bytes);
    let chest = 0;
    let assembler = 0;
    for (let i = 0; i < count; i++)
      for (const e of ChunkEntitiesCodec.read(r).entities) {
        if (e.flags !== 0) continue; // not a ghost, not marked
        const type = protos.entity[e.proto]?.type;
        if (type === 'chest' && chest === 0) chest = e.serial;
        if (type === 'assembler' && assembler === 0) assembler = e.serial;
      }
    if (chest === 0 || assembler === 0) return false;
    send({ t: 'view', gen: GEN, v: { ...VIEW, view_seq: 2, hovered_serial: chest } });
    send({ t: 'sub', gen: GEN, subs: [sub(6, 3, chest, 2), sub(7, 4, assembler)] });
    return true;
  };
  window.__fake = { step: (n) => send({ t: 'seq', op: { step: n } }), act, status: () => status };
  // `?fakeDay=N` shortens the fake's day to N ticks (Factorio's is 25,000), to see the night and the lamps.
  const day = Number(new URLSearchParams(location.search).get('fakeDay') ?? 0);
  const build = day > 0 ? { ...manifest, fake: { dayTicks: day } } : manifest;
  send({ t: 'boot', build, module: null, ioPort: null, genPorts: [] });

  // WASD walks the character (a stand-in: the UI package's input layer replaces it).
  const held = new Set<string>();
  const walk = () => {
    const x = (held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0);
    const y = (held.has('s') ? 1 : 0) - (held.has('w') ? 1 : 0);
    if (x === 0 && y === 0) return act({ type: 'stop_walking', input_gen: 0 });
    const dirs: Record<string, number> = {
      '0,-1': 0,
      '1,-1': 2,
      '1,0': 4,
      '1,1': 6,
      '0,1': 8,
      '-1,1': 10,
      '-1,0': 12,
      '-1,-1': 14,
    };
    act({ type: 'start_walking', input_gen: 0, dir: dirs[`${x},${y}`] ?? 0 });
  };
  addEventListener('keydown', (e) => {
    if ('wasd'.includes(e.key) && !held.has(e.key)) {
      held.add(e.key);
      walk();
    }
  });
  addEventListener('keyup', (e) => {
    if (held.delete(e.key)) walk();
  });
}
